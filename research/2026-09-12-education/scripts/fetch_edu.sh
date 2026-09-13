#!/usr/bin/env bash
# 抓取三方教育素材來源。建議在 work/ 下執行：
#   mkdir -p work && cd work && bash ../scripts/fetch_edu.sh
# 不用 -e：單一來源逾時或改版時，其餘來源要照抓完，最後再看缺哪些檔案
set -uo pipefail
UA="Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/128 Safari/537.36"

# --- 照顧者 ---

# 1. 社家署線上兒童發展檢核表：13 個年齡層，用不同生日觸發
#    對照表：4個月/6個月/9個月/1歲/1歲3個月/1歲半/2歲/2歲半/3歲/3歲半/4歲/5歲/6歲
mkdir -p screen
for d in 2026/06/20 2026/03/01 2025/12/01 2025/09/01 2025/06/01 2025/03/01 \
         2024/09/01 2024/01/15 2023/09/10 2023/03/10 2022/09/10 2021/01/05 2020/09/10; do
  curl -sSLk -m 45 -A "$UA" -d "birthDt=$d" \
    -o "screen/$(echo "$d" | tr / _).html" "https://system.sfaa.gov.tw/cecm/screenView/form"
  sleep 1
done

# 2. 社家署宣導資料清單（教材專區是空的，不用抓）
curl -sSLk -m 60 -A "$UA" -o cecm_video.html "https://system.sfaa.gov.tw/cecm/videoView/index"

# 3. 國健署兒童發展篩檢量表／圖卡規格／服務方案
curl -sSLk -m 60 -A "$UA" -o hpa_scale.html "https://www.hpa.gov.tw/Pages/List.aspx?nodeid=4821"
curl -sSLk -m 60 -A "$UA" -o hpa_card.html  "https://www.hpa.gov.tw/Pages/List.aspx?nodeid=4822"
curl -sSLk -m 60 -A "$UA" -o hpa_plan.html  "https://www.hpa.gov.tw/Pages/List.aspx?nodeid=4824"

# 4. 兒童健康手冊（中文版 115 年 6 月，103 頁 25MB；sid 改版會換，改版時到 EBook 頁重找）
curl -sSLk -m 60 -A "$UA" -o hpa_kidbook.html "https://www.hpa.gov.tw/Pages/EBook.aspx?nodeid=1139"
if [ "${WITH_BIG_PDF:-1}" = "1" ]; then   # 25MB，只取清單時可設 WITH_BIG_PDF=0 跳過
  curl -sSLk -m 180 -A "$UA" -o kidbook.pdf \
    "https://www.hpa.gov.tw/Pages/ashx/GetFile.ashx?lang=c&type=1&sid=fa4a5fb2ccf0444ca1a6dbfbee7bdf5a"
fi

# 5. 臺北市早療資源手冊清單（手冊本體是圖檔 PDF，無文字層）
curl -sSLk -m 60 -A "$UA" -o tp_manual.html "https://www.eirrc.gov.taipei/cp.aspx?n=9A9EA69C37BA30E5"

# --- 被照顧者（孩子本人）---

# 6. CRPD 手語繪本與學習單（頁面 4-7MB，圖片為 base64 內嵌；解析要切片）
curl -sSLk -m 90 -A "$UA" -o crpd_1521.html \
  "https://crpd.sfaa.gov.tw/BulletinCtrl?func=getBulletin&p=b_2&c=G&bulletinId=1521"
curl -sSLk -m 120 -A "$UA" -o crpd_book.pdf \
  "https://crpd.sfaa.gov.tw/BulletinCtrl?func=downloadFile&type=file&id=3293&code=CACEC5C8C0CDCEC6C2C2CFCBCDC8C7CB"
curl -sSLk -m 120 -A "$UA" -o crpd_sheet.pdf \
  "https://crpd.sfaa.gov.tw/BulletinCtrl?func=downloadFile&type=file&id=2705&code=828F8C8580898B878C8F8D8C84888C87"

# --- 朋友（老師、同學、手足）---

# 7. 臺北市融合教育現場教學手冊（9 冊＋1 指引；上冊第六章為發展遲緩）
curl -sSLk -m 60 -A "$UA" -o doe_list.html \
  "https://www.doe.gov.taipei/News.aspx?n=09EB907447DBD66F&sms=69B4E6B26379EE4E"

# 8. 教育部特教萬事屋教案（僅 5 筆）
curl -sSLk -m 60 -A "$UA" -o spehouse.html "https://proj.moe.edu.tw/spehouse/News.aspx?n=6045&sms=14337"

# 9. 天使心家族手足專區（官方無手足素材，這是民間唯一有系統的）
curl -sSLk -m 60 -A "$UA" -o ahh_qa.html "https://ah-h.org/siblings/common_qa?cat=1"

# --- 統計 ---

# 10. 教育部特殊教育各障礙類別學生人數（含學前「發展遲緩」）
curl -sSLk -m 90 -A "$UA" -o setstat.csv \
  "https://quality.data.gov.tw/dq_download_csv.php?nid=176892&md5_url=9c4fedaef2f50543ab5f8b9d7c374698"

# 註：健康九九 health99.hpa.gov.tw 全站重導迴圈，curl 取不到，需要真實瀏覽器。
