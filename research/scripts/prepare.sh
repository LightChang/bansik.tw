#!/usr/bin/env bash
# 一鍵備妥資料：抓取 → 解析 → 輸出 build/
#   bash research/scripts/prepare.sh
# 只重新解析（原始檔已在 work/）：
#   bash research/scripts/prepare.sh --build-only
# 連兩個大型素材 PDF 一起抓（約 +130MB）：
#   WITH_BIG_PDF=1 bash research/scripts/prepare.sh
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(dirname "$HERE")"
WORK="$ROOT/work"
BUILD="$ROOT/build"
# build.py 需要 pdfplumber 與 pandas
PYTHON="${PYTHON:-/Users/lightman/miniforge3/bin/python}"

if [ "${1:-}" != "--build-only" ]; then
  bash "$HERE/fetch_all.sh" "$WORK"
fi

"$PYTHON" "$HERE/build.py" "$WORK" "$BUILD"
echo
echo "資料集在 $BUILD"
ls -la "$BUILD"
