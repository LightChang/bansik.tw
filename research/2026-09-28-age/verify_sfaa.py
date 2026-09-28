"""sfaa.json 逐題比對原檔。

    python3 research/2026-09-28-age/verify_sfaa.py

1. 13 份表單 HTML 的 sha256 與 research/archive/tw8-2026-09-28/MANIFEST.md 記的相同。
2. 每題 text（去掉「＿」與空白）是該份 HTML 可見文字（去標籤、去空白）的連續子字串；note 亦同。
3. 每份的題數、★ 題數與 2026-09-12 另一次抓取（src/data/shared.json 的 materials）記下的題數、警訊題數相同。
"""
import hashlib
import html
import json
import os
import re

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.join(HERE, '..', '..')
MANIFEST = open(os.path.join(HERE, '..', 'archive', 'tw8-2026-09-28', 'MANIFEST.md'), encoding='utf-8').read()
sums = dict((p, h) for h, _, p in re.findall(r'^([0-9a-f]{64})\s+(\d+)\s+(\S+)$', MANIFEST, re.M))
prev = json.load(open(os.path.join(ROOT, 'src', 'data', 'shared.json'), encoding='utf-8'))['materials']['社家署線上兒童發展檢核表']


def norm(s):
    return re.sub(r'[\s＿]', '', s)


def visible(path):
    h = open(path, encoding='utf-8').read()
    h = h[h.index('發展里程檢核'):h.index('請提交檢核表單')]
    return norm(html.unescape(re.sub(r'<[^>]+>', '', h)))


bad = 0
for b in json.load(open(os.path.join(HERE, 'sfaa.json'), encoding='utf-8')):
    path = os.path.join(ROOT, b['file'])
    rel = b['file'].split('tw8-2026-09-28/')[1]
    ok = hashlib.sha256(open(path, 'rb').read()).hexdigest() == sums[rel] == b['sha256']
    v = visible(path)
    for x in b['items']:
        for part in (x['text'], x['note']):
            if norm(part) not in v:
                ok = False
                print('  ✗', b['key'], x['no'], part[:40])
    p = prev.get(b['label'])
    if not p or p['items'] != len(b['items']) or p['alerts'] != sum(x['mark'] == '★' for x in b['items']):
        ok = False
        print('  ✗ 題數與 2026-09-12 不符', b['key'], p)
    print('✓' if ok else '✗', b['key'], len(b['items']))
    bad += not ok
missing = sorted(set(prev) - {b['label'] for b in json.load(open(os.path.join(HERE, 'sfaa.json'), encoding='utf-8'))})
print('2026-09-12 有、這次沒抓到的年齡層：', missing)
raise SystemExit(bad)
