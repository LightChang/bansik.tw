"""社家署線上兒童發展檢核表：從 tw8 代抓的表單 HTML 抽出每一層的「發展里程檢核」題目原文。

    python3 research/2026-09-28-age/extract_sfaa.py   → research/2026-09-28-age/sfaa.json

來源：research/archive/tw8-2026-09-28/sfaa/band-*.html（臺灣主機 tw8 2026-09-29 代抓，
POST https://system.sfaa.gov.tw/cecm/screenView/form 帶 birthDt=yyyy/mm/dd；sha256 見同目錄 MANIFEST.md）。

抄錄規則：
  - 題目文字照網頁原樣，錯字也照抄（如「打閉」「束西」「蜜峰」「因来C」），不改寫、不補字。
  - HTML 排版造成的換行縮排拿掉；行內標籤（底線 span）只去標籤不加空白；原文裡本來就有的空白保留。
  - 表單上讓人填寫的欄位（<input>）以「＿」表示，例如「正確率：＿/6」「姊姊是＿？」；
    題目最後的整行作答框（6 歲第 4 題）不算題目文字，拿掉。
  - 題前的 ★ 另存 mark（網頁沒有圖例說明 ★ 的意思，站上照印不解釋）。
  - 題目下「計分：…」小字另存 note（只有 6 歲第 4 題有）。
  - 題目附的示意圖只記張數 figs，圖本身不轉載（頁尾「©2015衛生福利部社會及家庭署 版權所有」，
    網站沒有開放授權宣告）。
"""
import hashlib
import html
import json
import os
import re

HERE = os.path.dirname(os.path.abspath(__file__))
ARCH = os.path.join(HERE, '..', 'archive', 'tw8-2026-09-28', 'sfaa')

# 檔名 → 名目月齡（用來對到 /age/ 的頁：落在哪個時段的左閉右開區間就放哪頁）
BANDS = [('4m', 4), ('6m', 6), ('9m', 9), ('12m', 12), ('15m', 15), ('18m', 18), ('24m', 24), ('30m', 30),
         ('36m', 36), ('42m', 42), ('48m', 48), ('60m', 60), ('72m', 72)]


def months(s):
    """「1歲2個月15天」→ 月數（天數以 30 天折算後四捨五入到 0.5，跟 shared.json timeline 一致）"""
    m = re.fullmatch(r'(?:(\d+)歲)?(?:(\d+)個月)?(?:(\d+)天)?', s)
    y, mo, d = (int(x or 0) for x in m.groups())
    return round((y * 12 + mo + d / 30) * 2) / 2


def clean(fragment):
    s = re.sub(r'<input[^>]*>', '＿', fragment)
    s = re.sub(r'<br\s*/?>', '\n', s)
    s = re.sub(r'<[^>]+>', '', s)
    s = html.unescape(s)
    # 排版縮排：含換行的空白整段拿掉；行內空白保留一格
    s = re.sub(r'[ \t]*\n\s*', '\n', s)
    lines = [re.sub(r'[ \t]+', ' ', x).strip() for x in s.split('\n')]
    return [x for x in lines if x]


def parse(path):
    h = open(path, encoding='utf-8').read()
    label = re.search(r'<h4>([^<]+)</h4>\s*<input type="hidden" name="model" value="(\d+)"', h)
    title, model = label.group(1).strip(), label.group(2)
    rng = re.fullmatch(r'(.+?)\((.+?)~(.+?)\)', title)
    body = h[h.index('發展里程檢核'):h.index('請提交檢核表單')]
    items = []
    # 每題一個 form-group：題目在左欄，右邊兩欄是「是／否」
    for g in re.split(r'<div class="form-group">', body)[1:]:
        q = g.split('<div class="col-lg-2')[0]
        figs = len(re.findall(r'<img [^>]*screenView/cf100_', q))
        note = ''
        m = re.search(r'<span style="display: inline-block; font-size: 10pt">(.*?)</span>', q, re.S)
        if m:
            note = '\n'.join(clean(m.group(1)))
            q = q[:m.start()] + q[m.end():]
        q = re.sub(r'<img[^>]*>', '', q)
        # 6 歲第 4 題後面的整行作答框（checkDesc1）不是題目文字
        text = ''.join(clean(q)).rstrip('＿')
        mk = re.match(r'(★?)\s*(\d+)\.\s*(.*)', text, re.S)
        assert mk, (path, text)
        items.append({'no': int(mk.group(2)), 'mark': mk.group(1), 'text': mk.group(3).strip(),
                      'note': note, 'figs': figs})
    n_radio = len(set(re.findall(r'name="check(\d+)"', body)))
    assert n_radio == len(items), (path, n_radio, len(items))
    return {'label': title, 'short': rng.group(1), 'range': f'{rng.group(2)}~{rng.group(3)}',
            'month_min': months(rng.group(2)), 'month_max': months(rng.group(3)),
            'model': model, 'items': items}


out = []
for key, nominal in BANDS:
    path = os.path.join(ARCH, f'band-{key}.html')
    b = parse(path)
    b.update({'key': key, 'month': nominal, 'file': f'research/archive/tw8-2026-09-28/sfaa/band-{key}.html',
              'sha256': hashlib.sha256(open(path, 'rb').read()).hexdigest()})
    out.append(b)

dst = os.path.join(HERE, 'sfaa.json')
json.dump(out, open(dst, 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
print('bands', len(out), 'items', sum(len(b['items']) for b in out),
      '★', sum(x['mark'] == '★' for b in out for x in b['items']), '→', dst)
