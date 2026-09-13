#!/usr/bin/env bash
# 依序執行三套抓取腳本，全部落在同一個 work 目錄。
#   bash research/scripts/fetch_all.sh [work_dir]
# 預設跳過兩個大型素材 PDF（合計約 130MB）；要一起抓：
#   WITH_BIG_PDF=1 bash research/scripts/fetch_all.sh
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(dirname "$HERE")"
WORK="${1:-$ROOT/work}"
export WITH_BIG_PDF="${WITH_BIG_PDF:-0}"
UA="Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/128 Safari/537.36"

mkdir -p "$WORK"
cd "$WORK"

echo "== 1/4 機構名錄與統計"
bash "$ROOT/2026-09-11-sources/scripts/fetch.sh" || echo "  警告：這一段有來源沒抓成功"

echo "== 2/4 教育素材"
bash "$ROOT/2026-09-12-education/scripts/fetch_edu.sh" || echo "  警告：這一段有來源沒抓成功"

echo "== 3/4 性平／兒少保／特教"
bash "$ROOT/2026-09-12-topics/scripts/fetch_topics.sh" || echo "  警告：這一段有來源沒抓成功"

# 就醫地圖的座標寫在頁面 JS（TGOS.Point），匯出檔沒有，要另外抓頁面
echo "== 4/4 就醫地圖頁面（取座標）"
curl -sSLk -m 60 -A "$UA" -o hfk_joint_page.html \
  "https://healthforkids.mohw.gov.tw/HospitalMap/?id=47bd252c33cc4ff68a49f772f69e02f6"
curl -sSLk -m 90 -A "$UA" -o hfk_screen_page.html \
  "https://healthforkids.mohw.gov.tw/HospitalMap/?id=920da57226144ffab67339c1a5f2fec1"

echo "完成，原始檔在 $WORK"
