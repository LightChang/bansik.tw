"""把原型資料注入 HTML 模板，產出單一自足的頁面。

    python build_page.py [template] [data] [out]
    預設：taichung.template.html ../build/prototype_taichung.json taichung.html

換一個縣市（模板不必動，文案會跟著換）：

    python ../scripts/make_prototype.py 高雄市 ../build /tmp/proto_ks.json
    python build_page.py taichung.template.html /tmp/proto_ks.json /tmp/kaohsiung.html

做兩件事：
1. `__DATA__` → 整包資料。直接內嵌而不是另外 fetch，因為 artifact 的 CSP 對外部
   請求很嚴，內嵌最不會出事。單頁目前約 400KB，對 16MB 的上限來說還很寬裕。
2. `__COUNTY__` → 縣市名。只有 <title> 與 <h1> 這兩處靜態 HTML 需要替換——
   artifact 的標題是發布時從檔案掃出來的，交給 JS 改會讓 22 個縣市共用同一個標題。
   頁面內文的縣市名一律讀 DATA.county，不要再寫死。
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
# 縣市名在 <title> 與 <h1> 裡，這兩處是靜態 HTML（artifact 的標題是發布時從檔案
# 掃出來的，改不了就會 22 個縣市共用同一個標題），所以在這裡換掉而不是交給 JS。
# 頁面內文的縣市名一律用 DATA.county，不要再寫死。
# __NAV__ 是靜態站的跨縣市導覽（site/build_site.py 會填）。artifact 版只有一個縣市，
# 沒有地方可切換，所以置換成空字串——留著未置換的佔位符會直接印在畫面上。
html = (tpl.replace('__COUNTY__', data['county'])
           .replace('__NAV__', '')
           .replace('__DATA__', blob))
open(OUT, 'w', encoding='utf-8').write(html)

print(f'{OUT}  {os.path.getsize(OUT) // 1024} KB')
print(f"  機構 {len(data['entities'])}　年齡軸 {len(data['timeline'])}　"
      f"行政區 {len(data['districts'])}　動態 {len(data['observations'])}　統計 {len(data['stats'])}")
