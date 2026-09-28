"""國健署兒童發展篩檢量表 9 份分齡 PDF → scales.json（題目「敘述」欄逐字抄錄）。

    python3 -m venv /tmp/v && /tmp/v/bin/pip install pdfplumber
    /tmp/v/bin/python research/2026-09-28-age/extract_scales.py   → research/2026-09-28-age/scales.json
    python3 research/2026-09-28-age/verify_scales.py              （只用 poppler 的 pdftotext 逐行比對）

站主 2026-09-28 回報國健署已授權本站引用分齡篩檢量表（見 README〈引用許可〉）。
原檔存在 research/archive/hpa_scales/2026-09-28/（含 SHA256SUMS 與清單頁 list_nodeid4821.html）。

作法：每頁找表頭「敘述」所在欄的左右框線，再用橫框線切出每題的儲存格，只取儲存格內的字。
只抄「敘述」欄（題目本身，含量表印在題目下的「說明：」「註：」），通過標準、不通過標準、計分不抄。
量表在部分題目前印 ★ 或 ○（PDF 內是 Wingdings 的 U+F0AB／U+F0A1，2-3 歲那份是一般的 ★），
原樣記成 mark，量表本身沒有圖例說明兩個記號的意思。
4-5 歲精細動作第 2 題儲存格裡有一張剪紙示意圖，圖上標「10x 0.8cm」，那是圖說不是題目文字，排除。
"""
import json
import os
import re

import pdfplumber

HERE = os.path.dirname(os.path.abspath(__file__))
ARCH = os.path.join(HERE, '..', 'archive', 'hpa_scales', '2026-09-28')
LIST = 'https://www.hpa.gov.tw/Pages/List.aspx?nodeid=4821'

# 清單頁上的下載連結（list_nodeid4821.html 內原樣）；月齡區間左閉右開，與 shared.json timeline 相同
SCALES = [
    ('6-9個月', '6 至 9 個月', 6, 9, '30622249a1cb443397ace253bb2b5814'),
    ('9-12個月', '9 至 12 個月', 9, 12, '8cfdd9d6994e4c3c908decc7462f2843'),
    ('12-15個月', '12 至 15 個月', 12, 15, '6ad1939917b64e5580adec8f3269617b'),
    ('15-18個月', '15 至 18 個月', 15, 18, '7cfed325e2a0415c9b9f42cbeee90b3d'),
    ('18-24個月', '18 至 24 個月', 18, 24, '24c6485756e646dfbca0bd9c123c8514'),
    ('2-3歲', '2 至 3 歲', 24, 36, '4fb5b4fa890e46ee8ba3d40133a27aa4'),
    ('3-4歲', '3 至 4 歲', 36, 48, '8f89611525b24ccf9a58917750ebeb20'),
    ('4-5歲', '4 至 5 歲', 48, 60, '4207ef2fe40c4629b1d7dd0fc048d764'),
    ('5-7歲', '5 至 7 歲', 60, 84, 'c11cb05170ee46c4b289e247af41d303'),
]
DROP = {'10x 0.8cm'}
NOTE = re.compile(r'^(說明：|註：|例：|舉例：|請孩子跟著唸)')
MARKS = {'\uf0ab': '★', '★': '★', '\uf0a1': '○'}  # 題目前的記號（Wingdings 私用字元 → 原本的字形）
PUA = re.compile('[\uf000-\uf0ff★]')


def rules(p):
    """橫線（含畫成細長矩形的框線）依 y 分組；直線取 x"""
    segs = list(p.rects) + list(p.lines)
    hs, vs = {}, set()
    for r in segs:
        if r['bottom'] - r['top'] <= 2:
            hs.setdefault(round(r['top']), []).append((r['x0'], r['x1']))
        elif r['x1'] - r['x0'] <= 2:
            vs.add(round(r['x0'], 1))
    return hs, sorted(vs)


def spans(segs, L, R):
    cur = L
    for a, b in sorted(segs):
        if b < L or a > R:
            continue
        if a <= cur + 2:
            cur = max(cur, b)
    return cur >= R - 3


def join(lines):
    s = ''
    for l in lines:
        # PDF 裡英數字與中文之間有空白，斷行處把空白補回；中文與中文之間不補
        if s and (re.match(r'[A-Za-z0-9]', s[-1]) and not re.match(r'[，。、；：？！）』」]', l[0])
                  or re.match(r'[A-Za-z0-9]', l[0]) and not re.match(r'[，。、；：？！（『「]', s[-1])):
            s += ' '
        s += l
    return s


def page_items(p):
    words = p.extract_words()
    hdr = [w for w in words if w['text'] == '敘述']
    if not hdr:
        return None
    h = hdr[0]
    hs, vs = rules(p)
    L = max(v for v in vs if v < h['x0'] - 1)
    R = min(v for v in vs if v > h['x1'] + 1)
    ys = sorted(y for y, s in hs.items() if spans(s, L, R) and y > h['bottom'])
    ys = [y for i, y in enumerate(ys) if i == 0 or y - ys[i - 1] > 3]
    domain = ''.join(w['text'] for w in sorted(words, key=lambda w: w['x0'])
                     if h['top'] - 30 < w['top'] and w['bottom'] <= h['top'] - 1 and w['x0'] < 300)
    nums = [w for w in words if re.fullmatch(r'\d+\.', w['text']) and w['x0'] < L - 30]
    items = []
    for a, b in zip(ys, ys[1:]):
        ns = [w for w in nums if w['top'] >= a - 1 and w['bottom'] <= b + 1]
        if not ns:
            continue
        t = p.crop((L, a, R, b)).extract_text(x_tolerance=1.5) or ''
        lines = [l.strip() for l in t.split('\n') if l.strip()]
        mark = MARKS.get(lines[0][0], '') if lines else ''
        lines = [PUA.sub('', l).strip() for l in lines]
        lines = [l for l in lines if l and l not in DROP]
        k = next((i for i, l in enumerate(lines) if i > 0 and NOTE.match(l)), len(lines))
        items.append({
            'no': int(ns[0]['text'][:-1]),
            'mark': mark,
            'text': join(lines[:k]),
            'note': join(lines[k:]),
            'lines': lines,  # 原 PDF 的分行，給 verify_scales.py 逐行比對用
        })
    assert len(items) == len(nums), (p.page_number, len(items), len(nums))
    assert [x['no'] for x in items] == list(range(1, len(items) + 1)), p.page_number
    return {'domain': domain, 'page': p.page_number, 'items': items}


def main():
    out = []
    for key, label, mmin, mmax, sid in SCALES:
        path = os.path.join(ARCH, f'{key}.pdf')
        with pdfplumber.open(path) as pdf:
            domains = [d for d in (page_items(p) for p in pdf.pages) if d]
            pages = len(pdf.pages)
        out.append({
            'key': key, 'label': label, 'month_min': mmin, 'month_max': mmax,
            'title': f'兒童發展篩檢量表({key})',
            'file': f'https://www.hpa.gov.tw/Pages/ashx/GetFile.ashx?lang=c&type=2&sid={sid}',
            'archived': f'research/archive/hpa_scales/2026-09-28/{key}.pdf',
            'pages': pages,
            'domains': domains,
        })
    dst = os.path.join(HERE, 'scales.json')
    json.dump(out, open(dst, 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
    print('scales', len(out), 'items', sum(len(d['items']) for s in out for d in s['domains']), '→', dst)


if __name__ == '__main__':
    main()
