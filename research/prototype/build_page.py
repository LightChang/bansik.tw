"""把原型資料注入 HTML 模板，產出單一自足的頁面。

    python build_page.py [template] [data] [out]
    預設：taichung.template.html ../build/prototype_taichung.json taichung.html

資料直接內嵌而不是另外 fetch：artifact 的 CSP 對外部請求很嚴，內嵌最不會出事，
283KB 對單頁來說也還好。
"""
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
TPL = sys.argv[1] if len(sys.argv) > 1 else os.path.join(HERE, 'taichung.template.html')
DATA = sys.argv[2] if len(sys.argv) > 2 else os.path.join(HERE, '..', 'build', 'prototype_taichung.json')
OUT = sys.argv[3] if len(sys.argv) > 3 else os.path.join(HERE, 'taichung.html')

tpl = open(TPL, encoding='utf-8').read()
data = json.load(open(DATA, encoding='utf-8'))
# 分隔符壓到最小，並避開資料裡萬一出現的 </script>
blob = json.dumps(data, ensure_ascii=False, separators=(',', ':')).replace('</', '<\\/')

if '__DATA__' not in tpl:
    sys.exit('模板裡找不到 __DATA__ 佔位符')
html = tpl.replace('__DATA__', blob)
open(OUT, 'w', encoding='utf-8').write(html)

print(f'{OUT}  {os.path.getsize(OUT) // 1024} KB')
print(f"  機構 {len(data['entities'])}　年齡軸 {len(data['timeline'])}　"
      f"行政區 {len(data['districts'])}　動態 {len(data['observations'])}　統計 {len(data['stats'])}")
