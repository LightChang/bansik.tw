"""把 build/ 的資料切成單一縣市的原型資料，給頁面原型嵌入用。

    python make_prototype.py [縣市] [build_dir] [輸出檔]
    預設：臺中市 build build/prototype_taichung.json

只切一個縣市是刻意的：relation 全國有 14,476 列、光臺中的 serves_area 就 7,787 列，
整包嵌進頁面太重。這裡把 serves_area 先聚合成「每個行政區有幾家、分別是什麼類型」，
頁面要的是這個，不是原始關係。
"""
import collections
import csv
import json
import os
import sys
from datetime import datetime, timezone

COUNTY = sys.argv[1] if len(sys.argv) > 1 else '臺中市'
BUILD = sys.argv[2] if len(sys.argv) > 2 else 'build'
OUT = sys.argv[3] if len(sys.argv) > 3 else os.path.join(BUILD, 'prototype_taichung.json')

ENTITY_FIELDS = ['entity_key', 'name', 'plain_cat', 'cat', 'cats', 'journey_step', 'district',
                 'address', 'tel', 'url', 'tier', 'lat', 'lng', 'geo_level', 'sources']


def rows(name):
    path = os.path.join(BUILD, name)
    return list(csv.DictReader(open(path))) if os.path.exists(path) else []


ent = [e for e in rows('entity.csv') if e['county'] == COUNTY]
keys = {e['entity_key'] for e in ent}
by_key = {e['entity_key']: e for e in ent}

# 行政區：自己在該區的機構，加上「宣稱服務該區」的單位（依類型分層，不然一區 244 家沒法看）
serves = collections.defaultdict(lambda: collections.Counter())
for r in rows('relation.csv'):
    if r['rel'] == 'serves_area' and r['from_key'] in keys:
        e = by_key[r['from_key']]
        serves[r['to']][e['cat']] += 1

districts = {}
for e in ent:
    if e['district']:
        districts.setdefault(e['district'], {'located': 0, 'serving': {}})['located'] += 1
for area, counter in serves.items():
    districts.setdefault(area, {'located': 0, 'serving': {}})['serving'] = dict(counter.most_common())

data = {
    'county': COUNTY,
    'generated_at': datetime.now(timezone.utc).isoformat(timespec='seconds'),
    'timeline': rows('timeline.csv'),
    'entities': [{k: e.get(k, '') for k in ENTITY_FIELDS} for e in ent],
    'districts': districts,
    'observations': [o for o in rows('observation.csv') if o['entity_key'] in keys],
    'stats': [s for s in rows('stats.csv')
              if s['dim1_value'] == COUNTY or s['metric'] != '早療通報人數'],
    'counts': {
        'entities': len(ent),
        'by_cat': dict(collections.Counter(e['cat'] for e in ent).most_common()),
        'by_step': dict(collections.Counter(e['journey_step'] for e in ent).most_common()),
        'with_coords': sum(1 for e in ent if e['lat']),
    },
}

os.makedirs(os.path.dirname(OUT) or '.', exist_ok=True)
json.dump(data, open(OUT, 'w'), ensure_ascii=False, separators=(',', ':'))
print(f'{OUT}  {os.path.getsize(OUT) // 1024} KB')
print(f"  entity {data['counts']['entities']}　行政區 {len(districts)}　"
      f"timeline {len(data['timeline'])}　observation {len(data['observations'])}　stats {len(data['stats'])}")
print('  分類:', data['counts']['by_cat'])
