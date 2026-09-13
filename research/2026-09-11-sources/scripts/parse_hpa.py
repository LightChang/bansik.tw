# 解析國健署聯評中心名單 PDF → hpa115.json
# 重點中心在 PDF 裡只以「淺紅底」標示，沒有文字欄位；這裡用序號儲存格底下的填色色塊判讀。
# 需要 pdfplumber（本機在 /Users/lightman/miniforge3/bin/python）。
import json
import re
import unicodedata

import pdfplumber

PINK = (1.0, 0.788235, 0.788235)


def clean(x):
    # PDF 用了康熙部首「⾧」（NFKC 可轉）與 CJK 筆畫「㇐」（NFKC 不轉，要手動換）
    return unicodedata.normalize('NFKC', x or '').replace('㇐', '一').replace('\n', '')


pdf = pdfplumber.open('hpa115.pdf')
key = set()
for p in pdf.pages:
    pink = [r for r in p.rects if r.get('fill') and tuple(r.get('non_stroking_color') or ()) == PINK]
    for w in p.extract_words():
        if re.fullmatch(r'\d{1,2}', w['text']) and w['x0'] < 60:
            cy = (w['top'] + w['bottom']) / 2
            if any(r['top'] <= cy <= r['bottom'] and r['x0'] <= w['x0'] + 3 <= r['x1'] for r in pink):
                key.add(int(w['text']))

rows = []
for p in pdf.pages:
    for t in p.extract_tables():
        for r in t:
            if r and r[0] and r[0].strip().isdigit():
                n = int(r[0])
                rows.append({'seq': n, 'county': clean(r[1]), 'name': clean(r[2]),
                             'tel': unicodedata.normalize('NFKC', r[3] or '').replace('\n', ' / '),
                             'address': clean(r[4]), 'tier': '重點' if n in key else '一般'})
json.dump(rows, open('hpa115.json', 'w'), ensure_ascii=False, indent=1)
print(len(rows), '筆，重點', sum(r['tier'] == '重點' for r in rows))
