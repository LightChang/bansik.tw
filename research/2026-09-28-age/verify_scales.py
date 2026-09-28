"""scales.json 逐行比對原檔（只用 poppler 的 pdftotext，與抽取用的 pdfplumber 是兩套引擎）。

    python3 research/2026-09-28-age/verify_scales.py

1. 每份分齡 PDF 的 sha256 與 research/archive/hpa_scales/2026-09-28/SHA256SUMS 相同。
2. 每題「敘述」儲存格的每一行（NFKC、去空白後）都是該頁 `pdftotext -layout` 某一行的連續子字串，
   而且 text＋note 正好是這些行接起來（只差空白）。
3. 同一題也出現在國健署另一份檔案「9 次發展篩檢檢核總表」裡（該檔把 9 份量表合訂成 53 頁），
   各份量表在總表裡的題目逐行、依序對得上。
"""
import hashlib
import json
import os
import re
import subprocess
import unicodedata

HERE = os.path.dirname(os.path.abspath(__file__))
ARCH = os.path.join(HERE, '..', 'archive', 'hpa_scales', '2026-09-28')


def norm(s):
    s = unicodedata.normalize('NFKC', s)
    return re.sub(r'[\s\uf000-\uf0ff★]', '', s)


def pages(path):
    t = subprocess.run(['pdftotext', '-layout', path, '-'], capture_output=True, text=True, check=True).stdout
    return [[norm(l) for l in pg.split('\n')] for pg in t.split('\f')]


sums = dict(reversed(l.split()) for l in open(os.path.join(ARCH, 'SHA256SUMS'), encoding='utf-8'))
S = json.load(open(os.path.join(HERE, 'scales.json'), encoding='utf-8'))
book = pages(os.path.join(ARCH, '9次發展篩檢檢核總表.pdf'))
book_text = '\n'.join('\n'.join(pg) for pg in book)
n = pos = 0
for s in S:
    f = os.path.join(ARCH, f"{s['key']}.pdf")
    assert hashlib.sha256(open(f, 'rb').read()).hexdigest() == sums[f"{s['key']}.pdf"], f
    pg = pages(f)
    for d in s['domains']:
        lines = pg[d['page'] - 1]
        for x in d['items']:
            assert norm(x['text'] + x['note']) == norm(''.join(x['lines'])), (s['key'], x['no'])
            for l in x['lines']:
                assert any(norm(l) in L for L in lines), (s['key'], d['domain'], x['no'], l)
                i = book_text.find(norm(l), pos)
                assert i >= 0, ('總表找不到', s['key'], d['domain'], x['no'], l)
                pos = i
            n += 1
print('OK', len(S), 'scales', n, 'items：逐行對得上分齡 PDF 與 9 次總表')
