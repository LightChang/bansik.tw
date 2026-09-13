#!/usr/bin/env bash
# 抓取性平／兒少保／特教三個領域的來源。建議在 work/ 下執行：
#   mkdir -p work && cd work && bash ../scripts/fetch_topics.sh
# 不用 -e：單一來源逾時或改版時，其餘來源要照抓完，最後再看缺哪些檔案
set -uo pipefail
UA="Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/128 Safari/537.36"

# --- 兒少保護 ---

# 1. 衛福部統計處：3.2.2 性侵害被害及嫌疑人（唯一有身心障礙別交叉）、
#    3.5.5 受虐類型、3.5.6 受虐人數、3.5.9 施虐者身分
curl -sSLk -m 90 -A "$UA" -o s322.xlsx "https://www.mohw.gov.tw/dl-22350-52e594ab-786b-4cdc-bd31-9fd4c2b279ed.html"
curl -sSLk -m 90 -A "$UA" -o s355.xlsx "https://www.mohw.gov.tw/dl-22366-a574ceb0-aaa9-42e9-a46e-f5bcbeb79983.html"
curl -sSLk -m 90 -A "$UA" -o s356.xlsx "https://www.mohw.gov.tw/dl-22367-6cf8f862-9c05-49e9-9f1c-25185bd8bc36.html"
curl -sSLk -m 90 -A "$UA" -o s359.xlsx "https://www.mohw.gov.tw/dl-22371-d9603162-6f01-4267-972c-1d61ed9b2a2e.html"
# 注意：xlsx 是多層表頭，欄位名在第 4-6 列。

# 2. 保護服務司：各場域兒少保護個案統計圖表（副檔名寫 .html，實際是 PDF）
curl -sSLk -m 90 -A "$UA" -o s_field.pdf "https://www.mohw.gov.tw/dl-92296-219ede4c-9935-4f2d-8cd4-1003f5537957.html"
file s_field.pdf   # 確認格式再決定解析器

# 3. 統計專區頁（要找新表的下載網址時用）
curl -sSLk -m 60 -A "$UA" -o dops_child.html "https://dep.mohw.gov.tw/DOPS/lp-1303-105-xCat-cat04.html"

# --- 性別平等教育 ---

# 4. 教育部性平網「特教教學資源」共 5 頁，73 筆（其中 57 筆為特教性平教材）
for n in "" /2 /3 /4 /5; do
  curl -sSLk -m 60 -A "$UA" -o "gender$(echo "$n" | tr -d /)_index.html" \
    "https://www.gender.edu.tw/web/index.php/m5/m5_05_07_index${n}?k="
  sleep 1
done

# 5. 教材檔案直連（路徑含中文，需 URL encode）：性教育教材手冊 306 頁 102MB
if [ "${WITH_BIG_PDF:-1}" = "1" ]; then   # 102MB，只取清單時可設 WITH_BIG_PDF=0 跳過
  curl -sSLk -m 300 -A "$UA" -o sexedu_manual.pdf \
    "https://www.gender.edu.tw/web/upload/SpecialResource/%E6%80%A7%E6%95%99%E8%82%B2%E6%95%99%E6%9D%90%E6%89%8B%E5%86%8A.pdf"
fi

# --- 特殊教育 ---

# 6. 特殊教育各障礙類別學生人數（含學前「發展遲緩」）
curl -sSLk -m 90 -A "$UA" -o setstat.csv \
  "https://quality.data.gov.tw/dq_download_csv.php?nid=176892&md5_url=9c4fedaef2f50543ab5f8b9d7c374698"

# 7. 縣市特教資源中心年報（唯一有行政區級發展遲緩人數的來源，以臺南市為例）
curl -sSLk -m 60 -A "$UA" -o serc_year.html \
  "https://serc.tn.edu.tw/category/%E5%87%BA%E7%89%88%E5%93%81/%E5%90%84%E5%AD%B8%E5%B9%B4%E5%BA%A6%E7%B5%B1%E8%A8%88%E5%B9%B4%E5%A0%B1/"
curl -sSLk -m 120 -A "$UA" -o serc_113.pdf \
  "https://serc.tn.edu.tw/wp-content/uploads/2025/11/113%E5%AD%B8%E5%B9%B4%E5%BA%A6%E7%89%B9%E6%AE%8A%E6%95%99%E8%82%B2%E7%B5%B1%E8%A8%88%E5%B9%B4%E5%A0%B1.pdf"

# 註：以下取不到，不用再試——
#   set.edu.tw（Big5+ASP，電子書區無連結）、special.moe.gov.tw（Vue SPA）、
#   sencir.spc.ntnu.edu.tw（JS 列表）、crc.sfaa.gov.tw 與 health99.hpa.gov.tw（302 無限重導）
