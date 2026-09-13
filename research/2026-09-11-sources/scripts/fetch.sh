#!/usr/bin/env bash
# 抓取所有來源的原始檔到目前目錄（建議在 work/ 下執行）。
# 用法：mkdir -p work && cd work && bash ../scripts/fetch.sh
# 不用 -e：單一來源逾時或改版時，其餘來源要照抓完，最後再看缺哪些檔案
set -uo pipefail
UA="Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/128 Safari/537.36"

# 1. 社家署資源查詢：13 個分類，每類一頁即全量（無分頁）
mkdir -p sfaa
for q in "1&qtype2=1" "1&qtype2=2" "1&qtype2=3" "1&qtype2=4" "1&qtype2=5" "1&qtype2=6" "1&qtype2=7" "1&qtype2=8" \
         "2&qtype2=4" "2&qtype2=5" "2&qtype2=7&qtype3=1" "2&qtype2=7&qtype3=3" "2&qtype2=7&qtype3=9"; do
  f="sfaa/$(echo "$q" | tr '&=' '__').html"
  curl -sSL -m 120 -A "$UA" -o "$f" "https://system.sfaa.gov.tw/cecm/resourceView/detail2?qtype1=$q"
  sleep 1
done

# 2. 國健署 115 年聯評中心名單 PDF（sid 每年換，換年時到 nodeid=1602&pid=548 頁重找）
curl -sSL -m 60 -A "$UA" -o hpa115.pdf \
  "https://www.hpa.gov.tw/Pages/ashx/GetFile.ashx?lang=c&type=1&sid=ee3c4c006a4b475faadf4a8ad7d0ee9f"

# 3. 健保署特約醫療院所名冊（API 每次最多 1000 筆）
python3 - <<'EOF'
import json, urllib.request, time
rows, off = [], 0
while True:
    u = f"https://info.nhi.gov.tw/api/iode0010/v1/rest/datastore/A21030000I-D2100G-001?limit=1000&offset={off}"
    r = json.load(urllib.request.urlopen(u, timeout=60))['result']['records']
    rows += r; off += 1000
    if len(r) < 1000: break
    time.sleep(0.3)
json.dump(rows, open('nhi_roster.json', 'w'), ensure_ascii=False)
print('nhi_roster', len(rows))
EOF

# 4. 醫事司「醫療機構與人員基本資料」（年更 ODS，含各類治療師人數）
curl -sSL -m 180 -A "$UA" -o moh_inst.ods "https://www.mohw.gov.tw/dl-96581-66dbb751-f83a-416a-a998-893222e20fef.html"

# 5. 兒童醫療健康資訊整合平台匯出（憑證 2026-09-10 過期，暫用 -k；只讀公開資料）
curl -sSLk -m 60 -A "$UA" -o hfk_joint.ods \
  "https://healthforkids.mohw.gov.tw/HospitalMap/Export?id=47bd252c33cc4ff68a49f772f69e02f6&city=&district=&keys="
curl -sSLk -m 120 -A "$UA" -o hfk_screen.ods \
  "https://healthforkids.mohw.gov.tw/HospitalMap/Export?id=920da57226144ffab67339c1a5f2fec1&city=&district=&keys="

# 6. 衛福部統計處 2.5.4–2.5.8 早療統計表
mkdir -p stats
for p in "254:dl-22258-cd347bc1-efc1-46c5-b953-ae34795427a3" "255:dl-22259-01f318e0-b99f-47f4-b21b-34b51fdf9a75" \
         "256:dl-22261-dfdd3673-5316-4500-afd5-a5e2bf26e779" "257:dl-22262-b0439eab-2785-467c-8ad4-d7b83c211914" \
         "258:dl-22892-4263b013-4806-44bf-be0d-13cf87c994d9"; do
  curl -sSL -m 60 -A "$UA" -o "stats/${p%%:*}.xlsx" "https://www.mohw.gov.tw/${p#*:}.html"
done
