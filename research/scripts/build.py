"""把 work/ 的原始檔解析成可用資料集，輸出到 build/。

用法（需要 pdfplumber 與 pandas，本機在 /Users/lightman/miniforge3/bin/python）：
    python build.py [work_dir] [build_dir]

輸出（資料層用 CSV，行數少的表另外匯一份 md 方便直接翻）：
    entity.csv        每家機構一列（跨來源合併）
    entity_raw.csv    每個來源說的每家機構一列（保真，追來源用）
    observation.csv   時間點上觀察到的值（放名額日、預約方式…）
    relation.csv      機構之間與機構對縣市／行政區的關係
    stats.csv(.md)    所有統計併成一張長表
    materials.json(.md)  教育素材清單
    manifest.json     每個原始檔的大小、sha256、抓取時間
"""
import collections
import csv
import glob
import hashlib
import html
import json
import os
import re
import sys
import unicodedata
import zipfile
from datetime import datetime, timezone

WORK = sys.argv[1] if len(sys.argv) > 1 else 'work'
BUILD = sys.argv[2] if len(sys.argv) > 2 else 'build'
os.makedirs(BUILD, exist_ok=True)

MD_MAX_ROWS = 1500   # 超過這個行數就不匯 md，md 是給人翻的不是給機器讀的


def W(*p):
    return os.path.join(WORK, *p)


def B(*p):
    return os.path.join(BUILD, *p)


def raw(path):
    with open(path, 'rb') as f:
        return f.read().decode('utf-8', errors='ignore')


def strip_tags(s):
    return html.unescape(re.sub(r'<[^>]+>', '', s)).strip()


def write_csv(name, rows, cols, also_md=False):
    with open(B(name), 'w', newline='') as f:
        w = csv.DictWriter(f, fieldnames=cols, extrasaction='ignore')
        w.writeheader()
        for r in rows:
            w.writerow(r)
    if also_md and len(rows) <= MD_MAX_ROWS:
        md = name.rsplit('.', 1)[0] + '.md'
        with open(B(md), 'w') as f:
            f.write('| ' + ' | '.join(cols) + ' |\n')
            f.write('|' + '---|' * len(cols) + '\n')
            for r in rows:
                vals = [str(r.get(c, '')).replace('|', '\\|').replace('\n', ' ') for c in cols]
                f.write('| ' + ' | '.join(vals) + ' |\n')
    return len(rows)


# --------------------------------------------------------------- 名稱與地址正規化
def norm(s):
    s = unicodedata.normalize('NFKC', s or '').replace('㇐', '一').replace('台', '臺')
    return re.sub(r'[\s　()（）\-－、,，]', '', s)


STRIP = ['醫療財團法人', '醫療社團法人', '財團法人', '社團法人', '學校財團法人', '天主教',
         '佛教', '基督教', '台灣基督長老教會', '臺灣基督長老教會', '馬偕醫療', '附設民眾診療服務處']


def core(s):
    s = norm(s)
    s = re.sub(r'(委託|醫療合作).*$', '', s)
    for w in STRIP:
        s = s.replace(norm(w), '')
    return s


def addr_core(a):
    a = norm(a)
    a = re.sub(r'^\d{3,6}', '', a)
    m = re.search(r'(.+?[路街道])(.*?段)?(\d+巷)?(\d+弄)?(\d+)號', a)
    if not m:
        return a[:12]
    road = re.sub(r'^.*?[市縣](.*?[區鄉鎮市])?', '', m.group(1))
    seg = (m.group(2) or '')
    for zh, ar in [('一段', '1段'), ('二段', '2段'), ('三段', '3段'), ('四段', '4段')]:
        seg = seg.replace(zh, ar)
    return road + seg + m.group(5)


# --------------------------------------------------------------- 健保名冊與比對
def load_nhi():
    rows = json.load(open(W('nhi_roster.json')))
    active = [r for r in rows
              if not r['CONT_E_DATE'] and r['HOSP_TYPE'] in ('01', '02', '03', '04', '06', '08', '10')]
    by_core = collections.defaultdict(list)
    for r in active:
        by_core[core(r['HOSP_NAME'])].append(r)
    return active, by_core


def load_alias():
    """人工維護的更名對照（aliases.json）：名稱比對處理不了改制與院區重組。

    以前這份只在 collect_raw 裡套用，所以動態層（各縣市衛生局頁）享受不到——
    國健署全國聯絡資訊那 51 家裡，配不到代碼的 3 家有 2 家其實這裡早就記過了。
    改成在 matcher 裡套，所有呼叫 match() 的地方一次受惠。
    """
    path = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'aliases.json')
    if not os.path.exists(path):
        return {}
    return {(a['county'], core(a['name'])): a['hosp_id']
            for a in json.load(open(path)).get('hosp_id_alias', [])}


def make_matcher(active, by_core):
    alias = load_alias()
    by_id = {r['HOSP_ID']: r for r in active}

    def match(name, addr):
        c = core(name)
        if c in by_core and len(by_core[c]) == 1:
            return by_core[c][0], 'name'
        ac = addr_core(addr)
        cand = [r for r in active
                if ac and ac == addr_core(r['HOSP_ADDR'])
                and '居家' not in r['HOSP_NAME'] and '護理' not in r['HOSP_NAME']]
        if len(cand) == 1:
            return cand[0], 'addr'
        if cand:
            best = [r for r in cand if r['HOSP_CNT_TYPE'] in '123']
            if len(best) == 1:
                return best[0], 'addr+hosp'
        cty = norm(addr)[:3]
        sub = [r for r in active
               if r['HOSP_CNT_TYPE'] in '123' and norm(r['HOSP_ADDR'])[:3] == cty
               and (c in core(r['HOSP_NAME']) or core(r['HOSP_NAME']) in c)
               and len(core(r['HOSP_NAME'])) >= 4]
        if len(sub) == 1:
            return sub[0], 'substr'
        # 更名對照放最後：前面的規則都配不到才查，才不會蓋掉正常比對。
        # county 取地址前三字（「宜蘭縣」「新竹市」都是三字）；addr 有時只給縣市，兩種都吃。
        hit = alias.get((cty, c))
        if hit and hit in by_id:
            return by_id[hit], 'alias'
        return None, 'none'
    return match


# --------------------------------------------------------------- 各來源解析
SFAA_CATS = {
    '1_qtype2_1': '評估醫院', '1_qtype2_2': '聯合評估中心', '1_qtype2_3': '其他經許可辦理評估之醫院',
    '1_qtype2_4': '新生兒聽力確診醫院', '1_qtype2_5': '新生兒聽力篩檢院所', '1_qtype2_6': '通報轉介中心',
    '1_qtype2_7': '個案管理中心', '1_qtype2_8': '服務-教育單位', '2_qtype2_4': '療育-醫療單位',
    '2_qtype2_5': '療育-教育單位', '2_qtype2_7_qtype3_1': '早療機構',
    '2_qtype2_7_qtype3_3': '社區療育據點', '2_qtype2_7_qtype3_9': '其他社福單位',
}
SFAA_MEDICAL = {'評估醫院', '聯合評估中心', '其他經許可辦理評估之醫院',
                '新生兒聽力確診醫院', '新生兒聽力篩檢院所', '療育-醫療單位'}

# 一家機構常同時屬於多個分類，主分類取這個順序裡最靠前的
CAT_PRIORITY = ['聯合評估中心', '評估醫院', '其他經許可辦理評估之醫院', '兒童發展篩檢院所',
                '新生兒聽力確診醫院', '新生兒聽力篩檢院所', '療育-醫療單位', '早療機構',
                '社區療育據點', '通報轉介中心', '個案管理中心', '療育-教育單位',
                '服務-教育單位', '其他社福單位']
SOURCE_PRIORITY = {'hpa': 0, 'healthforkids': 1, 'sfaa': 2}

# 家長的旅程順序：每個分類落在哪一步，做「下一步去哪」用
JOURNEY = {
    '兒童發展篩檢院所': 1, '新生兒聽力篩檢院所': 1, '新生兒聽力確診醫院': 1,
    '通報轉介中心': 2, '個案管理中心': 2,
    '聯合評估中心': 3, '評估醫院': 3, '其他經許可辦理評估之醫院': 3,
    '療育-醫療單位': 4, '早療機構': 4, '社區療育據點': 4, '其他社福單位': 4,
    '療育-教育單位': 5, '服務-教育單位': 5,
}

# 官方分類名是給機關看的，家長看不懂「療育-醫療單位」跟「其他經許可辦理評估之醫院」差在哪。
# plain_cat 是頁面上要顯示的說法，cat 保留原值不動（比對與追來源都靠它）。
PLAIN_CAT = {
    '兒童發展篩檢院所': '做發展篩檢的診所',
    '新生兒聽力篩檢院所': '做新生兒聽力篩檢的院所',
    '新生兒聽力確診醫院': '聽力有問題時做確診的醫院',
    '通報轉介中心': '不知道從哪開始，先打這裡',
    '個案管理中心': '有人陪你走完流程的地方',
    '聯合評估中心': '做完整發展評估的醫院',
    '評估醫院': '也能做評估的醫院',
    '其他經許可辦理評估之醫院': '也能做評估的醫院',
    '療育-醫療單位': '在醫院做治療',
    '早療機構': '早療機構（整天或半天的課）',
    '社區療育據點': '社區裡的療育據點',
    '療育-教育單位': '幼兒園裡的療育',
    '服務-教育單位': '學前特教資源',
    '其他社福單位': '其他社福單位',
}


def parse_sfaa():
    out = []
    for f in sorted(glob.glob(W('sfaa', '*.html'))):
        key = os.path.basename(f)[:-5]
        s = raw(f)
        s = s[s.find('insidePage'):s.find('隱私權保護政策')]
        toks = re.split(r'(<h3>[^<]*</h3>|<div class="panel panel-default">)', s)
        county = None
        for i, t in enumerate(toks):
            if t.startswith('<h3>'):
                county = strip_tags(t)
            elif t.startswith('<div class="panel panel-default">'):
                body = toks[i + 1]
                name = strip_tags(re.search(r'<h4 class="panel-title">(.*?)</h4>', body, re.S).group(1))
                rec = {'source': 'sfaa', 'cat': SFAA_CATS[key], 'county': county, 'name': name}
                pb = body[body.find('panel-body'):]
                rec['links'] = sorted({html.unescape(u) for u in re.findall(r'href="(http[^"]+)"', pb)
                                       if 'google.com/maps' not in u})
                # 機構自己的網址：動態層（放名額日、預約方式）唯一的入口。
                # sfaa.gov.tw 的連結是名錄站自己的說明頁，不是機構官網，排掉。
                own = [u for u in rec['links'] if 'sfaa.gov.tw' not in u]
                rec['url'] = own[0] if own else ''
                for p in re.findall(r'<p>(.*?)</p>', pb, re.S):
                    t2 = strip_tags(p)
                    mm = re.match(r'(郵遞區號|地址|電話|服務內容|服務區域|服務方式|更新日期|辦理單位)[：:](.*)', t2, re.S)
                    if mm:
                        rec[mm.group(1)] = mm.group(2).strip()
                out.append(rec)
    return out


def parse_hpa():
    """國健署名單。重點中心只用淺紅底標示，沒有文字欄位，要讀色塊。"""
    import pdfplumber
    pink = (1.0, 0.788235, 0.788235)
    pdf = pdfplumber.open(W('hpa115.pdf'))
    key = set()
    for p in pdf.pages:
        boxes = [r for r in p.rects if r.get('fill') and tuple(r.get('non_stroking_color') or ()) == pink]
        for w in p.extract_words():
            if re.fullmatch(r'\d{1,2}', w['text']) and w['x0'] < 60:
                cy = (w['top'] + w['bottom']) / 2
                if any(r['top'] <= cy <= r['bottom'] and r['x0'] <= w['x0'] + 3 <= r['x1'] for r in boxes):
                    key.add(int(w['text']))
    rows = []
    for p in pdf.pages:
        for t in p.extract_tables():
            for r in t:
                if r and r[0] and r[0].strip().isdigit():
                    n = int(r[0])
                    clean = lambda x: unicodedata.normalize('NFKC', x or '').replace('㇐', '一').replace('\n', '')
                    rows.append({'source': 'hpa', 'cat': '聯合評估中心', 'seq': n,
                                 'county': clean(r[1]), 'name': clean(r[2]),
                                 '電話': unicodedata.normalize('NFKC', r[3] or '').replace('\n', ' / '),
                                 '地址': clean(r[4]), 'tier': '重點' if n in key else '一般'})
    return rows


def ods_rows(path):
    x = zipfile.ZipFile(path).read('content.xml').decode('utf-8')
    out = []
    for r in re.findall(r'<table:table-row[^>]*>(.*?)</table:table-row>', x, re.S):
        cells = []
        for m in re.finditer(r'<table:table-cell([^>]*?)(?:/>|>(.*?)</table:table-cell>)', r, re.S):
            rep = re.search(r'number-columns-repeated="(\d+)"', m.group(1))
            n = min(int(rep.group(1)), 50) if rep else 1
            v = html.unescape(re.sub(r'<[^>]+>', '',
                                     re.sub(r'</text:p>\s*<text:p[^>]*>', '\n', m.group(2) or ''))).strip()
            cells += [v] * n
        while cells and not cells[-1]:
            cells.pop()
        if cells:
            out.append(cells)
    return out


def parse_hfk(ods_name, page_name, cat):
    """就醫地圖：清單在匯出檔，座標在頁面 JS（pTGMarkerN 與列表順序一致）。"""
    rows = ods_rows(W(ods_name))[1:]
    coords = []
    page = W(page_name)
    if os.path.exists(page):
        s = raw(page)
        coords = re.findall(r'pTGMarker\d+\s*=\s*new TGOS\.Marker\(pMap,\s*new TGOS\.Point\(([\d.]+),\s*([\d.]+)\)', s)
    out = []
    for i, r in enumerate(rows):
        rec = {'source': 'healthforkids', 'cat': cat, 'county': r[1], 'district': r[2],
               'name': r[3], '電話': r[4] if len(r) > 4 else '',
               '地址': (r[1] + r[2] + r[5]) if len(r) > 5 else '',
               'note': r[8] if len(r) > 8 else ''}
        if i < len(coords):
            rec['lng'], rec['lat'] = coords[i][0], coords[i][1]
        out.append(rec)
    return out


# --------------------------------------------------------------- entity 兩份輸出
RAW_COLS = ['entity_key', 'source', 'cat', 'county', 'district', 'name', '地址', '電話',
            'hosp_id', 'tier', 'match', 'lat', 'lng', 'url', '服務區域', '服務方式', '服務內容',
            '辦理單位', '更新日期', 'note']
ENTITY_COLS = ['entity_key', 'name', 'plain_cat', 'cat', 'cats', 'journey_step', 'county', 'district',
               'address', 'tel', 'url', 'hosp_id', 'tier', 'lat', 'lng', 'geo_level',
               'sources', 'source_updated']


def collect_raw():
    active, by_core = load_nhi()
    match = make_matcher(active, by_core)
    ents = []
    for r in parse_sfaa():
        m, how = match(r['name'], r.get('地址', '')) if r['cat'] in SFAA_MEDICAL else (None, 'skip')
        ents.append({**r, 'hosp_id': m['HOSP_ID'] if m else None, 'match': how})
    for r in parse_hpa():
        m, how = match(r['name'], r['地址'])
        ents.append({**r, 'hosp_id': m['HOSP_ID'] if m else None, 'match': how})
    for r in parse_hfk('hfk_joint.ods', 'hfk_joint_page.html', '聯合評估中心'):
        m, how = match(r['name'], r['地址'])
        ents.append({**r, 'hosp_id': m['HOSP_ID'] if m else None, 'match': how})
    for r in parse_hfk('hfk_screen.ods', 'hfk_screen_page.html', '兒童發展篩檢院所'):
        m, how = match(r['name'], r['地址'])
        ents.append({**r, 'hosp_id': m['HOSP_ID'] if m else None, 'match': how})
    # 名稱比對處理不了更名（例如陽明大學→陽明交通大學），用人工 alias 補這一段
    alias_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'aliases.json')
    if os.path.exists(alias_path):
        alias = {(a['county'], core(a['name'])): a['hosp_id']
                 for a in json.load(open(alias_path)).get('hosp_id_alias', [])}
        for e in ents:
            hit = alias.get((e.get('county'), core(e['name'])))
            if hit and not e.get('hosp_id'):
                e['hosp_id'], e['match'] = hit, 'alias'

    # 有醫事機構代碼就用代碼，社福單位退回「縣市＋正規化名稱」
    for e in ents:
        e['entity_key'] = e['hosp_id'] or ('x:' + (e.get('county') or '') + ':' + core(e['name']))
    return ents


def merge_entities(raws):
    """同一家機構在三個來源各一筆，合併成一列。

    欄位衝突時按 hpa > healthforkids > sfaa 取值：國健署是聯評中心的官方定義，
    就醫地圖有座標，社家署則是服務時間與服務區域的唯一來源。
    """
    groups = collections.defaultdict(list)
    for r in raws:
        groups[r['entity_key']].append(r)
    out = []
    for key, rows in groups.items():
        rows = sorted(rows, key=lambda r: SOURCE_PRIORITY.get(r['source'], 9))
        first = rows[0]
        cats = list(dict.fromkeys(r['cat'] for r in rows))
        main_cat = min(cats, key=lambda c: CAT_PRIORITY.index(c) if c in CAT_PRIORITY else 99)

        def pick(field):
            for r in rows:
                if r.get(field):
                    return r[field]
            return ''
        out.append({
            'entity_key': key,
            'name': first['name'],
            'plain_cat': PLAIN_CAT.get(main_cat, main_cat),
            'cat': main_cat,
            'cats': ';'.join(cats),
            'url': pick('url'),
            'journey_step': JOURNEY.get(main_cat, ''),
            'county': pick('county'),
            'district': pick('district'),
            'address': re.sub(r'^\d{3,6}', '', pick('地址')),   # 各來源郵遞區號寫法不一，統一去掉
            'tel': pick('電話'),
            'hosp_id': first.get('hosp_id') or '',
            'tier': pick('tier'),
            'lat': pick('lat'),
            'lng': pick('lng'),
            'sources': ';'.join(dict.fromkeys(r['source'] for r in rows)),
            'source_updated': pick('更新日期'),
        })
    out.sort(key=lambda r: (r['cat'], r['county'], r['name']))
    return out


# --------------------------------------------------------------- 行政區與座標
DIST_RE = re.compile(r'^(?:臺|台|新)?[^\s]{1,3}?[縣市](.{1,4}?[區鄉鎮市])')


def fill_geo(entities):
    """補行政區，並給沒有座標的機構一個區級座標。

    社家署名錄只給地址不給行政區，3,073 家裡有 1,695 家的 district 是空的，
    但地址開頭一定是「縣市＋區鄉鎮市」，抽得出來（實測 1,695 家全中）。

    座標則是 1,378 家有（只有就醫地圖那個來源給），其餘沒有。逐筆地理編碼走不通
    （Nominatim 對臺灣完整地址與街道查詢一律回空），所以退一步用行政區中心點，
    並用 geo_level 標明哪些是門牌精度、哪些只是區級，頁面上不能混為一談。
    """
    import districts as D
    idx = D.load()
    filled = geo_exact = geo_dist = 0
    for e in entities:
        if not e.get('district'):
            m = DIST_RE.match(e.get('address') or '')
            if m:
                e['district'] = m.group(1)
                filled += 1
        if e.get('lat'):
            e['geo_level'] = 'address'
            geo_exact += 1
            continue
        hit = D.find(idx, e.get('county'), e.get('district') or '')
        if hit:
            e['lat'], e['lng'] = hit
            e['geo_level'] = 'district'
            geo_dist += 1
        else:
            e['geo_level'] = ''
    return {'district_filled': filled, 'geo_address': geo_exact, 'geo_district': geo_dist,
            'geo_none': len(entities) - geo_exact - geo_dist}


# --------------------------------------------------------------- relation
def build_relations(raws, entities):
    """機構對縣市、對服務區域、對辦理單位的關係。

    服務區域必須當成 relation：通報轉介中心寫「服務區域：全新北市」，
    有些療育單位收外縣市，只用地址縣市會漏掉。
    """
    rels = []
    key_by_core = {}
    for e in entities:
        key_by_core.setdefault((e['county'], core(e['name'])), e['entity_key'])
    for e in entities:
        if e['county']:
            rels.append({'from_key': e['entity_key'], 'rel': 'in_county', 'to': e['county'], 'to_key': ''})
        if e['district']:
            rels.append({'from_key': e['entity_key'], 'rel': 'in_district',
                         'to': e['county'] + e['district'], 'to_key': ''})
    seen = set()
    for r in raws:
        key = r['entity_key']
        for d in re.split(r'[,，、]', r.get('服務區域', '') or ''):
            d = d.strip()
            if d and (key, d) not in seen:
                seen.add((key, d))
                rels.append({'from_key': key, 'rel': 'serves_area', 'to': d, 'to_key': ''})
        op = (r.get('辦理單位') or '').strip()
        if op:
            rels.append({'from_key': key, 'rel': 'operated_by', 'to': op,
                         'to_key': key_by_core.get((r.get('county'), core(op)), '')})
    # 同一家機構在多個來源各出現一次，關係會跟著重複，這裡收斂成唯一的三元組
    uniq, seen_rel = [], set()
    for r in rels:
        k = (r['from_key'], r['rel'], r['to'])
        if k not in seen_rel:
            seen_rel.add(k)
            uniq.append(r)
    return uniq


# --------------------------------------------------------------- observation
def build_observations(entities=None):
    """動態層：在某個時間點觀察到的值。

    目前只有少數中心公布這類資訊（13 家抽查中 1 家有放名額日），
    所以這張表本來就會很短——那正是這個題目的現況，不是解析失敗。

    這裡也要做名稱比對：動態頁只寫醫院名，但 observation 要能 join 回 entity，
    所以先換成醫事機構代碼，配不到才退回「縣市＋正規化名稱」。
    """
    active, by_core = load_nhi()
    match = make_matcher(active, by_core)

    # 比對優先用已經建好的 entity：它合併過多來源、套過 alias、有完整地址。
    # 動態頁通常只給「機構名＋縣市」沒有門牌，而直接跟健保名冊比在兩種情況會失敗——
    # 同名跨縣市的診所（「大心診所」全臺 5 家，name 規則要求唯一才算數），
    # 以及非醫院層級（substr 規則限定 HOSP_CNT_TYPE in '123'）。
    # 嘉義市有 4 家診所就是這樣配不到，明明 entity.csv 裡就有同名的那一家。
    by_name = {}
    for e in (entities or []):
        by_name.setdefault((e.get('county'), core(e['name'])), e['entity_key'])

    def key_for(name, county, addr=''):
        """回傳 entity_key：先查 entity，再退回健保名冊，都沒有才用縣市＋名稱組。"""
        hit = by_name.get((county, core(name)))
        if hit:
            return hit
        m, _ = match(name, addr or county)
        return m['HOSP_ID'] if m else 'x:' + (county or '') + ':' + core(name)

    obs = []

    def mtime(path):
        return datetime.fromtimestamp(os.path.getmtime(path), timezone.utc).isoformat()[:19]

    # 中山醫附醫：每月開放下個月門診名額，公告會預告三個月
    f = W('dyn', 'csh.html')
    if os.path.exists(f):
        s = raw(f)
        txt = html.unescape(re.sub(r'<[^>]+>', ' ', s))
        for m in re.finditer(r'(\d{3})\s*年\s*(\d{1,2})\s*月份[^：:]{0,30}[：:]\s*(\d{3})/(\d{1,2})/(\d{1,2})', txt):
            roc_y, mon, ry, rm, rd = m.groups()
            obs.append({'entity_key': '1317040011', 'observed_at': mtime(f), 'source': 'csh_quota',
                        'field': 'quota_release_date',
                        'value': f'{int(ry) + 1911:04d}-{int(rm):02d}-{int(rd):02d}',
                        'note': f'{roc_y}年{mon}月份門診名額開放日'})
        cap = re.search(r'約有\s*(\d+)\s*[-–~]\s*(\d+)\s*名', txt)
        if cap:
            obs.append({'entity_key': '1317040011', 'observed_at': mtime(f), 'source': 'csh_quota',
                        'field': 'monthly_capacity', 'value': f'{cap.group(1)}-{cap.group(2)}',
                        'note': '每月評估名額（原文區間）'})

    # 新北市衛生局：各聯評中心的預約方式（只有方式，沒有等候天數）
    f = W('dyn', 'ntpc_booking.html')
    if os.path.exists(f):
        s = raw(f)
        for tr in re.findall(r'<tr[^>]*>(.*?)</tr>', s, re.S):
            tds = [strip_tags(td) for td in re.findall(r'<td[^>]*>(.*?)</td>', tr, re.S)]
            if len(tds) >= 3 and ('醫院' in tds[0] or '診所' in tds[0]):
                method = re.sub(r'\s+', ' ', tds[2])[:200]
                if method:
                    key = key_for(tds[0], '新北市')
                    obs.append({'entity_key': key, 'observed_at': mtime(f),
                                'source': 'ntpc_booking', 'field': 'booking_method',
                                'value': method, 'note': tds[0]})

    # 臺中市衛生局：10 家聯評中心的電話。同樣沒有等候天數，但分機值得存——
    # 這頁標了哪支分機是初評、哪支是複評，比總機號碼有用得多。
    # 這頁比新北多一欄地址，所以 match 給地址而不是只給縣市，配得比較準。
    f = W('dyn', 'tc_health.html')
    if os.path.exists(f):
        s = raw(f)
        for tr in re.findall(r'<tr[^>]*>(.*?)</tr>', s, re.S):
            tds = [strip_tags(td) for td in re.findall(r'<td[^>]*>(.*?)</td>', tr, re.S)]
            if len(tds) >= 3 and ('醫院' in tds[0] or '診所' in tds[0]):
                tel = re.sub(r'\s+', ' ', tds[2]).strip()[:120]
                # 表頭第一欄就叫「醫院名稱」，含「醫院」二字會被當成資料列，
                # 產生一筆叫「醫院名稱」的假機構。要求電話欄真的有數字就能擋掉
                # （表頭那欄是「電話」兩個字），比寫死標題字串穩。
                if not tel or not re.search(r'\d', tel):
                    continue
                name = re.sub(r'\s+', ' ', tds[0]).strip()
                key = key_for(name, '臺中市', tds[1])
                obs.append({'entity_key': key, 'observed_at': mtime(f),
                            'source': 'tc_health', 'field': 'booking_tel',
                            'value': tel, 'note': name})

    # 國健署全國聯絡資訊：一頁 PDF 涵蓋 22 縣市共 51 家的電話（多數含分機）。
    # 這份比逐縣市翻衛生局頁有效得多——衛生局那條路查了 5 個縣市才拿到 3 個可解析的頁面。
    # 版面是左右兩欄併排的表格，所以一列裡有兩組「縣市／醫院／電話」，要每 3 欄切一次；
    # 縣市欄只在該縣市第一列出現，其餘是空字串，要沿用上一個值。
    f = W('dyn', 'hpa_centers.pdf')
    if os.path.exists(f):
        import pdfplumber
        county = None
        for page in pdfplumber.open(f).pages:
            for t in page.extract_tables():
                for r in t:
                    cells = [(c or '').replace('\n', '') for c in r]
                    if not cells or cells[0].strip() == '縣市':
                        continue
                    for i in range(0, len(cells), 3):
                        chunk = cells[i:i + 3]
                        if len(chunk) < 3:
                            continue
                        c, name, tel = [x.strip() for x in chunk]
                        if c:
                            county = c
                        if not (name and tel) or '醫院名稱' in name:
                            continue
                        key = key_for(name, county or '')
                        obs.append({'entity_key': key, 'observed_at': mtime(f),
                                    'source': 'hpa_contacts', 'field': 'booking_tel',
                                    'value': re.sub(r'\s+', ' ', tel)[:120], 'note': name})

    # 嘉義市衛生局：目前唯一有「門診時間」的縣市彙整頁（新北、臺中都只有電話）。
    # 欄位是 序號 || 院所名稱 || 電話 || 門診時間，用序號是不是數字來認資料列——
    # 這頁的院所包含「嘉義市西區衛生所」，用「醫院／診所」認會漏掉衛生所。
    f = W('dyn', 'cy_health.html')
    if os.path.exists(f):
        s = raw(f)
        for tr in re.findall(r'<tr[^>]*>(.*?)</tr>', s, re.S):
            tds = [strip_tags(td) for td in re.findall(r'<td[^>]*>(.*?)</td>', tr, re.S)]
            if len(tds) < 4 or not tds[0].strip().isdigit():
                continue
            # 機構名裡有換行與 tab（例如「衛生福利部嘉義醫院\n\t\t\t(非聯合評估門診)」），
            # strip_tags 只去頭尾空白，中間的要自己壓掉，不然 note 會髒、也可能影響比對
            name = re.sub(r'\s+', ' ', tds[1]).strip()
            key = key_for(name, '嘉義市')
            for field, raw_val in (('booking_tel', tds[2]), ('clinic_hours', tds[3])):
                val = re.sub(r'\s+', ' ', raw_val).strip()[:200]
                if val:
                    obs.append({'entity_key': key, 'observed_at': mtime(f),
                                'source': 'cy_health', 'field': field,
                                'value': val, 'note': name})
    return obs


# --------------------------------------------------------------- stats 單一長表
def cell(v):
    return str(v).replace('\u3000', '').strip()


def build_stats():
    import pandas as pd
    rows = []

    # 早療通報：縣市 × 年
    path = W('stats', '254.xlsx')
    if os.path.exists(path):
        for sheet, df in pd.read_excel(path, sheet_name=None, header=None, dtype=str).items():
            if not re.fullmatch(r'\d{4}', str(sheet).strip()):
                continue
            for _, r in df.iterrows():
                name = cell(r[0])
                if re.fullmatch(r'[臺台]?[北中南東西]?.{1,4}[縣市]', name) and str(r[2]).strip().isdigit():
                    rows.append({'metric': '早療通報人數', 'dim1': '縣市', 'dim1_value': name,
                                 'dim2': '', 'dim2_value': '', 'year': sheet.strip(),
                                 'value': int(r[2]), 'source': '衛福部統計處 2.5.4'})

    # 特教學生數：障別 × 教育階段
    path = W('setstat.csv')
    if os.path.exists(path):
        with open(path, encoding='utf-8') as f:
            for r in csv.DictReader(f):
                cat = r.pop('障礙類別')
                for stage, n in r.items():
                    if n and n.strip().isdigit():
                        rows.append({'metric': '特教學生數', 'dim1': '障礙類別', 'dim1_value': cat,
                                     'dim2': '教育階段', 'dim2_value': stage.replace('(人數)', ''),
                                     'year': '', 'value': int(n), 'source': '教育部 data.gov.tw 176892'})

    # 兒少受虐人數：年齡層 × 性別
    path = W('s356.xlsx')
    if os.path.exists(path):
        for sheet, df in pd.read_excel(path, sheet_name=None, header=None, dtype=str).items():
            if not re.fullmatch(r'\d{4}', str(sheet).strip()):
                continue
            ages = [cell(v).replace('\n', ' ') for v in df.iloc[4].tolist()]
            hdr = [(i, a.split(' ')[0]) for i, a in enumerate(ages) if '歲' in a]
            for _, r in df.iterrows():
                if cell(r[0]) != '總計':
                    continue
                for i, a in hdr:
                    for off, sex in ((0, '男'), (1, '女')):
                        v = str(r[i + off]).strip()
                        if v.isdigit():
                            rows.append({'metric': '兒少受虐人數', 'dim1': '年齡層', 'dim1_value': a,
                                         'dim2': '性別', 'dim2_value': sex, 'year': sheet.strip(),
                                         'value': int(v), 'source': '衛福部統計處 3.5.6'})
                break

    # 性侵害被害人：身心障礙別
    path = W('s322.xlsx')
    if os.path.exists(path):
        for sheet, df in pd.read_excel(path, sheet_name=None, header=None, dtype=str).items():
            if not re.fullmatch(r'\d{4}', str(sheet).strip()):
                continue
            hdr = [cell(v).replace('\n', '') for v in df.iloc[5].tolist()]
            groups = [cell(v).replace('\n', '') for v in df.iloc[4].tolist()]
            try:
                start = next(i for i, v in enumerate(groups) if '身心障礙別' in v)
            except StopIteration:
                continue
            labels = [(i, hdr[i]) for i in range(start, min(start + 12, len(hdr))) if hdr[i]]
            for _, r in df.iterrows():
                if cell(r[0]) != '總計' or not str(r[3]).strip().isdigit():
                    continue
                for i, lab in labels:
                    v = str(r[i]).strip()
                    if v.isdigit():
                        rows.append({'metric': '性侵害被害人數', 'dim1': '身心障礙別', 'dim1_value': lab,
                                     'dim2': '', 'dim2_value': '', 'year': sheet.strip(),
                                     'value': int(v), 'source': '衛福部統計處 3.2.2'})
                break
    return rows


# --------------------------------------------------------------- 年齡時間軸
# 兒童健康手冊裡的兩張憑證表，區間照原文（work/kidbook.pdf p.1-2）。
# 注意是兩套不同的東西：預防保健 9 次、發展篩檢 6 次，常被混為一談。
CHECKUP_9 = [('出生後2週至2個月', 0.5, 2), ('2至4個月', 2, 4), ('4至6個月', 4, 6),
             ('6個月至1歲', 6, 12), ('1歲至1歲半', 12, 18), ('1歲半至2歲', 18, 24),
             ('2歲至3歲', 24, 36), ('3歲至5歲', 36, 60), ('5歲至未滿7歲', 60, 84)]
SCREEN_6 = [('6至10個月', 6, 10), ('10個月至1歲半', 10, 18), ('1歲半至2歲', 18, 24),
            ('2歲至3歲', 24, 36), ('3歲至5歲', 36, 60), ('5歲至未滿7歲', 60, 84)]
# 學前特教的安置階段，年齡依學制推算（setstat.csv 的欄位名只有班別沒有年齡）
PRESCHOOL = [('學前-幼幼班', 24, 36), ('學前-小班', 36, 48),
             ('學前-中班', 48, 60), ('學前-大班', 60, 72)]


def age_to_months(txt):
    """把『1歲半』『15個月』『未滿7歲』這類寫法換成月數。"""
    t = txt.replace('未滿', '').strip()
    m = re.match(r'(\d+)\s*歲\s*(\d+)\s*個月', t)
    if m:
        return int(m.group(1)) * 12 + int(m.group(2))
    m = re.match(r'(\d+)\s*歲半', t)
    if m:
        return int(m.group(1)) * 12 + 6
    m = re.match(r'(\d+)\s*歲', t)
    if m:
        return int(m.group(1)) * 12
    m = re.match(r'(\d+)\s*個月', t)
    if m:
        return int(m.group(1))
    return None


def build_timeline():
    """年齡時間軸：幾個月大該做什麼。

    這是本站的骨幹之一（另一半是地圖）。資料分散在四個地方，
    這裡把它們對到同一條月齡軸上：政策時程、家長自填、醫師用量表、學前安置。
    """
    rows = []

    def add(kind, step, label, lo, hi, title, detail='', source='', url=''):
        rows.append({'kind': kind, 'journey_step': step, 'age_label': label,
                     'month_min': lo, 'month_max': hi, 'title': title,
                     'detail': detail, 'source': source, 'url': url})

    for i, (label, lo, hi) in enumerate(CHECKUP_9, 1):
        add('兒童預防保健', 1, label, lo, hi, f'兒童預防保健第{i}次',
            '健保給付，含衛教指導', '國健署兒童健康手冊',
            'https://www.hpa.gov.tw/Pages/EBook.aspx?nodeid=1139')
    for i, (label, lo, hi) in enumerate(SCREEN_6, 1):
        add('兒童發展篩檢', 1, label, lo, hi, f'兒童發展篩檢服務第{i}次',
            '由專科醫師就粗大動作、精細動作、語言認知、社會發展四面向篩檢',
            '國健署兒童健康手冊', 'https://www.hpa.gov.tw/Pages/EBook.aspx?nodeid=1139')
    for label, lo, hi in CHECKUP_9:
        add('家長紀錄事項', 1, label, lo, hi, f'兒童健康手冊「{label}家長紀錄事項」',
            '家長自行觀察紀錄', '國健署兒童健康手冊',
            'https://www.hpa.gov.tw/Pages/EBook.aspx?nodeid=1139')

    # 國健署分齡量表：醫師篩檢時實際使用的工具
    if os.path.exists(W('hpa_scale.html')):
        seen = set()
        for t in re.findall(r'title="([^"]*兒童發展篩檢量表\([^"]*)"', raw(W('hpa_scale.html'))):
            t = re.sub(r'\(格式為 pdf\)\(另開新視窗\)', '', html.unescape(t)).strip()
            m = re.search(r'\(([\d一二三四五六七八九十]+)\s*[-–~至]\s*(\d+)\s*(個月|歲)\)', t)
            if not m or t in seen:
                continue
            seen.add(t)
            unit = m.group(3)
            lo = age_to_months(m.group(1) + unit)
            hi = age_to_months(m.group(2) + unit)
            if lo is not None and hi is not None:
                add('分齡篩檢量表', 1, f'{m.group(1)}-{m.group(2)}{unit}', lo, hi, t,
                    '醫師篩檢使用', '國健署兒童發展篩檢量表',
                    'https://www.hpa.gov.tw/Pages/List.aspx?nodeid=4821')

    # 社家署線上檢核表：家長可以自己先做的那一份
    for f in sorted(glob.glob(W('screen', '*.html'))):
        s = raw(f)
        b = re.search(r'((\d+(?:個月|歲\d*個?月?半?))\(([^)]{3,40})\))', s)
        if not b:
            continue
        label, short, span = b.group(1), b.group(2), b.group(3)
        lo_txt, hi_txt = (span.split('~') + [''])[:2]

        def bound(t):
            # 原文用「3個月16天~5個月15天」界定，也就是 3.5 到 5.5 個月。
            # 截成整數會讓相鄰兩層在邊界那個月重疊，所以帶「天」的一律加半個月。
            v = age_to_months(re.sub(r'\d+\s*天\s*$', '', t))
            return None if v is None else (v + 0.5 if re.search(r'\d+\s*天\s*$', t) else v)

        lo, hi = bound(lo_txt), bound(hi_txt)
        items = [strip_tags(m) for m in re.findall(r'<label[^>]*>(.*?)</label>', s, re.S)]
        dev = [i for i in items
               if re.match(r'^[★☆]?\s*\d+[\.、]\s*\S', i)
               and not re.match(r'^\d+\.(先天|產前|腦部|家族)', i) and len(i) > 12]
        add('線上發展檢核表', 1, label, lo, hi, f'{short}兒童發展檢核表',
            f'{len(dev)} 題，其中 {sum(1 for i in dev if i.startswith("★"))} 題為警訊題',
            '社家署線上檢核', 'https://system.sfaa.gov.tw/cecm/')

    for label, lo, hi in PRESCHOOL:
        add('學前特教安置', 5, label, lo, hi, f'{label}特殊教育安置',
            '發展遲緩幼兒可經鑑輔會安置', '教育部特教統計',
            'https://data.gov.tw/dataset/176892')

    rows.sort(key=lambda r: (r['month_min'] if r['month_min'] is not None else 999, r['kind']))
    return rows


# --------------------------------------------------------------- 教育素材
def build_materials():
    out = {}
    bands = {}
    for f in sorted(glob.glob(W('screen', '*.html'))):
        s = raw(f)
        b = re.search(r'(\d+(?:個月|歲\d*個?月?半?)\([^)]{3,40}\))', s)
        items = [strip_tags(m) for m in re.findall(r'<label[^>]*>(.*?)</label>', s, re.S)]
        dev = [i for i in items
               if re.match(r'^[★☆]?\s*\d+[\.、]\s*\S', i)
               and not re.match(r'^\d+\.(先天|產前|腦部|家族)', i) and len(i) > 12]
        if b:
            bands[b.group(1)] = {'items': len(dev), 'alerts': sum(1 for i in dev if i.startswith('★')),
                                 'sample': dev[0][:60] if dev else ''}
    if bands:
        out['社家署線上兒童發展檢核表'] = bands

    def listing(path, pattern, keep=None):
        if not os.path.exists(path):
            return []
        s = raw(path)
        seen = []
        for u, t in re.findall(pattern, s):
            t = html.unescape(t).strip()
            if not t or (keep and not keep(t)):
                continue
            if t not in [a for a, _ in seen]:
                seen.append((t, html.unescape(u)))
        return [{'title': t, 'url': u} for t, u in seen]

    out['社家署宣導資料'] = listing(W('cecm_video.html'), r'href="(/cecm/videoView/detail/\d+)">([^<]+)')
    scales = []
    if os.path.exists(W('hpa_scale.html')):
        for t in re.findall(r'title="([^"]*兒童發展篩檢量表[^"]*)"', raw(W('hpa_scale.html'))):
            t = html.unescape(t).strip()
            if '格式為 pdf' not in t:
                continue
            t = re.sub(r'\(格式為 pdf\)\(另開新視窗\)$', '', t).strip()
            if t not in scales:
                scales.append(t)
    out['國健署兒童發展篩檢量表'] = sorted(scales)
    out['臺北市融合教育現場教學手冊'] = listing(
        W('doe_list.html'), r'<a[^>]*href="(News_Content[^"]*)"[^>]*>\s*([^<]*(?:融合教育|情緒行為問題)[^<]*)\s*</a>')
    gender = []
    for f in sorted(glob.glob(W('gender*_index.html'))):
        gender += listing(f, r'href="([^"]*m5_05_07_01[^"]*)"[^>]*>\s*([^<]{2,70})\s*</a>')
    seen = set()
    gender = [g for g in gender if not (g['title'] in seen or seen.add(g['title']))]
    out['教育部性平網特教教學資源'] = {
        'total': len(gender),
        'special_ed': [g for g in gender if '原住民族語' not in g['title']],
    }
    out['CRPD繪本'] = [
        {'title': '希兒與皮帝的神奇之旅（臺灣手語繪本，25頁）',
         'file': 'https://crpd.sfaa.gov.tw/BulletinCtrl?func=downloadFile&type=file&id=3293&code=CACEC5C8C0CDCEC6C2C2CFCBCDC8C7CB'},
        {'title': '學習單（注音版，2頁）',
         'file': 'https://crpd.sfaa.gov.tw/BulletinCtrl?func=downloadFile&type=file&id=2705&code=828F8C8580898B878C8F8D8C84888C87'},
        {'title': '每一個都要到 臺灣手語繪本',
         'page': 'https://crpd.sfaa.gov.tw/BulletinCtrl?func=getBulletin&p=b_2&c=G&bulletinId=842'},
    ]
    json.dump(out, open(B('materials.json'), 'w'), ensure_ascii=False, indent=1)

    with open(B('materials.md'), 'w') as f:
        f.write('# 教育素材清單\n\n')
        f.write('## 社家署線上兒童發展檢核表\n\n| 年齡層 | 發展題數 | 其中★警訊題 |\n|---|---|---|\n')

        def band_months(b):
            m = re.match(r'(\d+)歲(\d+)個月', b)      # 「1歲3個月」要排在「1歲」之後
            if m:
                return int(m.group(1)) * 12 + int(m.group(2))
            m = re.match(r'(\d+)(個月|歲)', b)
            if not m:
                return 999
            n = int(m.group(1))
            return n if m.group(2) == '個月' else n * 12 + (6 if '歲半' in b[:6] else 0)

        for k, v in sorted(out.get('社家署線上兒童發展檢核表', {}).items(), key=lambda kv: band_months(kv[0])):
            f.write(f"| {k} | {v['items']} | {v['alerts']} |\n")
        for key in ['國健署兒童發展篩檢量表', '社家署宣導資料', '臺北市融合教育現場教學手冊']:
            f.write(f'\n## {key}\n\n')
            for it in out.get(key, []):
                f.write(f"- {it if isinstance(it, str) else it['title']}\n")
        g = out['教育部性平網特教教學資源']
        f.write(f"\n## 教育部性平網特教教學資源（{g['total']} 筆，特教 {len(g['special_ed'])} 筆）\n\n")
        for it in g['special_ed']:
            f.write(f"- {it['title']}\n")
        f.write('\n## CRPD 繪本\n\n')
        for it in out['CRPD繪本']:
            f.write(f"- {it['title']}\n")
    return out


# --------------------------------------------------------------- 檔案指紋
def build_manifest():
    items = []
    for path in sorted(glob.glob(W('**', '*'), recursive=True)):
        if os.path.isdir(path):
            continue
        h = hashlib.sha256()
        with open(path, 'rb') as f:
            for chunk in iter(lambda: f.read(1 << 20), b''):
                h.update(chunk)
        st = os.stat(path)
        items.append({'file': os.path.relpath(path, WORK), 'bytes': st.st_size,
                      'sha256': h.hexdigest(),
                      'fetched_at': datetime.fromtimestamp(st.st_mtime, timezone.utc).isoformat()})
    json.dump({'generated_at': datetime.now(timezone.utc).isoformat(), 'files': items},
              open(B('manifest.json'), 'w'), ensure_ascii=False, indent=1)
    return items


if __name__ == '__main__':
    raws = collect_raw()
    ents = merge_entities(raws)
    geo = fill_geo(ents)
    print(f'行政區回填 {geo["district_filled"]} 家；座標：門牌 {geo["geo_address"]}、'
          f'區級 {geo["geo_district"]}、無 {geo["geo_none"]}')
    write_csv('entity_raw.csv', raws, RAW_COLS)
    write_csv('entity.csv', ents, ENTITY_COLS)
    print(f'entity_raw: {len(raws)} 列（每個來源說的每家機構）')
    # 座標要分兩種講：fill_geo 之後每家都有 lat，但其中大部分只是區中心點。
    # 印成「3073 家有座標」會讓人以為都是門牌精度。
    print(f'entity:     {len(ents)} 列（合併後每家一列），'
          f'{sum(1 for e in ents if e["hosp_id"])} 家有醫事機構代碼，'
          f'{geo["geo_address"]} 家門牌座標、{geo["geo_district"]} 家只有區級座標')
    for c, n in collections.Counter(e['cat'] for e in ents).most_common():
        print(f'    {n:5} {c}')

    rels = build_relations(raws, ents)
    write_csv('relation.csv', rels, ['from_key', 'rel', 'to', 'to_key'], also_md=True)
    print('relation:', len(rels), '列', dict(collections.Counter(r['rel'] for r in rels)))

    obs = build_observations(ents)
    write_csv('observation.csv', obs, ['entity_key', 'observed_at', 'source', 'field', 'value', 'note'],
              also_md=True)
    print('observation:', len(obs), '列', dict(collections.Counter(o['field'] for o in obs)))

    stats = build_stats()
    write_csv('stats.csv', stats,
              ['metric', 'dim1', 'dim1_value', 'dim2', 'dim2_value', 'year', 'value', 'source'],
              also_md=True)
    print('stats:', len(stats), '列', dict(collections.Counter(s['metric'] for s in stats)))

    tl = build_timeline()
    write_csv('timeline.csv', tl,
              ['kind', 'journey_step', 'age_label', 'month_min', 'month_max', 'title',
               'detail', 'source', 'url'], also_md=True)
    print('timeline:', len(tl), '列', dict(collections.Counter(t['kind'] for t in tl)))

    mats = build_materials()
    print('materials:', {k: (len(v) if not isinstance(v, dict) else len(v)) for k, v in mats.items()})
    print('manifest:', len(build_manifest()), '個原始檔')
