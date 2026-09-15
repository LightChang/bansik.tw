"""把 research/build/ 的五張表切成 Astro 建置期要讀的 JSON。

    cd research && python3 ../scripts/make_site_data.py [build_dir]
    預設 build_dir = build，輸出到 ../src/data/

和 research/scripts/make_prototype.py 的差別：那支是給單頁原型用的，每個縣市
產一份「什麼都有」的自足 JSON。這支是給 22 頁的靜態站用的，多做一件事——
**把跨縣市相同的內容抽成一份共用檔**。

實測（22 個縣市檔逐位元組比對）：
  timeline    22 個縣市只有 1 種內容
  materials   22 個縣市只有 1 種內容
  stats       扣掉「早療通報人數」後只有 1 種（448 列、88 KB）
所以照原本的作法，每頁都會扛一份相同的 120 KB，22 頁重複約 2 MB。
現在拆成 shared.json 一份，縣市檔只留真正屬於自己的東西。

「早療通報人數」是唯一按縣市分的統計，留在縣市檔裡。
"""
import collections
import csv
import json
import os
import sys
import unicodedata
from datetime import datetime, timezone

BUILD = sys.argv[1] if len(sys.argv) > 1 else 'build'
HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, '..', 'src', 'data')

ENTITY_FIELDS = ['entity_key', 'name', 'plain_cat', 'cat', 'cats', 'journey_step', 'district',
                 'address', 'tel', 'url', 'tier', 'lat', 'lng', 'geo_level', 'sources']

# 按縣市分的統計只有這一個 metric，其餘都是全國共用
COUNTY_METRIC = '早療通報人數'


def rows(name):
    path = os.path.join(BUILD, name)
    return list(csv.DictReader(open(path))) if os.path.exists(path) else []


def dump(obj, *parts):
    path = os.path.join(OUT, *parts)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    json.dump(obj, open(path, 'w', encoding='utf-8'),
              ensure_ascii=False, separators=(',', ':'))
    return os.path.getsize(path)


SUFFIX = '區鄉鎮市'


def norm(s):
    return unicodedata.normalize('NFKC', s or '').replace('台', '臺')


def variants(name):
    """行政區名可能的寫法，依可信度排序，取第一個命中。

    不要用「去尾字再比對」那種寫法：`前鎮` 去尾字會變成 `前`，而 `前鎮區` 去尾字
    是 `前鎮`，兩邊永遠對不上。地名本身就以區鄉鎮市結尾的（前鎮、新市、平鎮）
    全會被多砍一個字。

    這裡處理兩種真實落差：
    - 改制前後：桃園 2014 年升格，圖資寫「中壢市」、機構資料寫「中壢區」
    - 機構資料省略後綴：寫「前鎮」而圖資是「前鎮區」
    """
    n = norm(name)
    yield n
    if n and n[-1] in SUFFIX:
        stem = n[:-1]
        for s in SUFFIX:
            yield stem + s
    else:
        for s in SUFFIX:
            yield n + s


def subsidy_table():
    path = os.path.join(HERE, '..', 'research', 'scripts', 'subsidies.json')
    if not os.path.exists(path):
        return {}
    return {c['county']: c for c in json.load(open(path, encoding='utf-8'))['counties']}


def materials():
    path = os.path.join(BUILD, 'materials.json')
    return json.load(open(path, encoding='utf-8')) if os.path.exists(path) else {}


counties = json.load(open(os.path.join(OUT, 'counties.json'), encoding='utf-8'))['counties']
generated_at = datetime.now(timezone.utc).isoformat(timespec='seconds')

all_entities = rows('entity.csv')
all_stats = rows('stats.csv')
all_relations = rows('relation.csv')
district_rows = rows('district.csv')
subsidies = subsidy_table()

# ── 共用檔：跨縣市完全相同的部分 ──────────────────────────
shared = {
    'generated_at': generated_at,
    'timeline': rows('timeline.csv'),
    'materials': materials(),
    'stats': [s for s in all_stats if s['metric'] != COUNTY_METRIC],
}
shared_size = dump(shared, 'shared.json')

# ── 縣市檔 ────────────────────────────────────────────
by_county = collections.defaultdict(list)
for e in all_entities:
    by_county[e['county']].append(e)

# serves_area 全國 14,476 列，先照 from_key 建索引，免得每個縣市都重掃一次
ent_by_key = {e['entity_key']: e for e in all_entities}
serves_by_county = collections.defaultdict(lambda: collections.defaultdict(collections.Counter))
for r in all_relations:
    if r['rel'] != 'serves_area':
        continue
    e = ent_by_key.get(r['from_key'])
    if e:
        serves_by_county[e['county']][r['to']][e['cat']] += 1

geo_by_county = collections.defaultdict(dict)
for r in district_rows:
    geo_by_county[r['county']][r['district']] = {'lat': float(r['lat']), 'lng': float(r['lng'])}

index = []
total = shared_size
for c in counties:
    name, code = c['name'], c['code']
    ent = by_county.get(name, [])
    keys = {e['entity_key'] for e in ent}

    districts = {}
    for e in ent:
        if e['district']:
            d = districts.setdefault(e['district'], {'located': 0, 'serving': {}, 'keys': []})
            d['located'] += 1
            d['keys'].append(e['entity_key'])
    for area, counter in serves_by_county.get(name, {}).items():
        d = districts.setdefault(area, {'located': 0, 'serving': {}, 'keys': []})
        d['serving'] = dict(counter.most_common())

    # 哪些鍵是真的行政區？權威來源是鄉鎮界圖資：對得到座標的就是真的。
    # serves_area（服務區域）會塞進「全新北市」「基隆市全區」這種根本不是行政區的字串，
    # 甚至混進解析殘渣（「全新北市(服務時間:週一至週五…)」）。這些留著會變成機構清單
    # 篩選器裡的選項，家長選了得到 0 筆。
    # 例外：對不到座標但有機構設籍的要留著，否則那些機構會從篩選器裡整個消失。
    county_geo = {norm(k): v for k, v in geo_by_county.get(name, {}).items()}
    dist_geo = {}
    real = {}
    for key, val in districts.items():
        hit = next((county_geo[v] for v in variants(key) if v in county_geo), None)
        if hit is not None:
            dist_geo[key] = hit
            real[key] = val
        elif val['located'] > 0:
            real[key] = val
    districts = real

    n_centers = sum(1 for e in ent if e['cat'] == '聯合評估中心')
    data = {
        'county': name,
        'code': code,
        'generated_at': generated_at,
        'subsidy': subsidies.get(name),
        'entities': [{k: e.get(k, '') for k in ENTITY_FIELDS} for e in ent],
        'districts': districts,
        'district_geo': dist_geo,
        'observations': [o for o in rows('observation.csv') if o['entity_key'] in keys],
        # 只有這個 metric 是按縣市分的，其餘全在 shared.json
        'stats': [s for s in all_stats
                  if s['metric'] == COUNTY_METRIC and s['dim1_value'] == name],
        'counts': {
            'entities': len(ent),
            'centers': n_centers,
            'by_cat': dict(collections.Counter(e['cat'] for e in ent).most_common()),
            'by_step': dict(collections.Counter(e['journey_step'] for e in ent).most_common()),
            'with_coords': sum(1 for e in ent if e['lat']),
        },
    }
    size = dump(data, 'counties', code + '.json')
    total += size
    index.append({'code': code, 'name': name, 'entities': len(ent), 'centers': n_centers,
                  'districts': len(districts)})
    print(f'{code:<16}{name:<4}{len(ent):>5} 家{size // 1024:>6} KB')

dump({'generated_at': generated_at, 'counties': index}, 'index.json')

print(f'\n共用檔 {shared_size // 1024} KB（timeline + materials + 全國統計 '
      f'{len(shared["stats"])} 列）')
print(f'22 縣市 + 共用 + 索引，合計 {total // 1024} KB')
print(f'機構 {sum(i["entities"] for i in index)} 家，聯評中心 {sum(i["centers"] for i in index)} 家')
