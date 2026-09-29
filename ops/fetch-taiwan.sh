#!/bin/bash
# ops/fetch-taiwan.sh
# bansik.tw 台灣端抓取器（tw8，2026-09-29 起）。比照 seh.tw 的 ops/fetch-taiwan-only.sh：
# 台灣主機只抓、不碰 git、不解析、不 build；解析與上線在境外主機的 ops/run-data-update.sh。
#
# 【tw8 不 clone repo】只放抓取需要的 8 個檔，目錄結構照 repo（fetch_all.sh 靠相對路徑找另外三支）。
# 安裝（也是改版後的更新方式）——網址釘在 commit SHA，內容不可變，不受 raw CDN 快取影響：
#   H=/opt/bansik-fetch
#   REF=$(curl -fsSL -H 'Accept: application/vnd.github.sha' https://api.github.com/repos/LightChang/bansik.tw/commits/main)
#   for f in ops/fetch-taiwan.sh research/state.json research/scripts/sync.py research/scripts/sources.json \
#            research/scripts/fetch_all.sh research/2026-09-11-sources/scripts/fetch.sh \
#            research/2026-09-12-education/scripts/fetch_edu.sh research/2026-09-12-topics/scripts/fetch_topics.sh; do
#     mkdir -p "$H/$(dirname $f)" && curl -fsSL "https://raw.githubusercontent.com/LightChang/bansik.tw/$REF/$f" -o "$H/$f" \
#       || { echo "失敗：$f，安裝未完成"; exit 1; }
#   done && echo "$REF" > "$H/.ref"
# 不自動更新（不讓台灣主機每週執行新下載的程式），但每輪用 GitHub compare API 查 .ref 到 main 之間
# 這 7 個抓取檔有沒有被改（state.json 不算）：有改、查不到（repo 轉 private、API 失敗）→ 這輪中止、不投遞，
# fetch.log 寫明原因；境外收不到 DONE 會在 Slack 發 🟡。
# 相依只有系統 python3（標準函式庫）、curl、rsync；不需要 pandas／pdfplumber。
#
# state.json／archive/ 放在 DATA 底下；第一次拿 $H/research/state.json 當起點。
# archive/ 只放這台新存的快照，境外 rsync 進 repo 時不刪舊的。
#
# 環境變數（repo 內不寫主機位址或憑證）：
#   BANSIK_INTAKE_TARGET  rsync 目標，例如 root@<境外主機>:（rrsync 已把根目錄限定在 inbox）必填
#   BANSIK_INTAKE_KEY     ssh 私鑰（預設 ~/.ssh/bansik_intake）
#   BANSIK_DATA           原始檔與狀態（預設 /var/lib/bansik）
#   BANSIK_PY             Python（預設 python3，只用標準函式庫）
#
# 排程：tw8 systemd timer，每週一台北 07:30。
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DATA="${BANSIK_DATA:-/var/lib/bansik}"
PY="${BANSIK_PY:-python3}"
KEY="${BANSIK_INTAKE_KEY:-$HOME/.ssh/bansik_intake}"
TARGET="${BANSIK_INTAKE_TARGET:-}"
LOG="$DATA/fetch.log"

mkdir -p "$DATA/work"
exec >> "$LOG" 2>&1
log() { printf '%s  %s\n' "$(date '+%Y-%m-%d %H:%M:%S%z')" "$*"; }
[ -n "$TARGET" ] || { log "沒設 BANSIK_INTAKE_TARGET"; exit 1; }

exec 200>"$DATA/.lock"
flock -n 200 || { log "上一輪還在跑"; exit 1; }

cd "$ROOT" || exit 1

# 安裝的版本（.ref）之後，repo 有沒有改過抓取檔
FILES="ops/fetch-taiwan.sh research/scripts/sync.py research/scripts/sources.json research/scripts/fetch_all.sh
  research/2026-09-11-sources/scripts/fetch.sh research/2026-09-12-education/scripts/fetch_edu.sh
  research/2026-09-12-topics/scripts/fetch_topics.sh"
[ -s .ref ] || { log "中止：沒有 .ref，安裝沒做完，不投遞"; exit 1; }
CHANGED=$(curl -fsSL -m 30 "https://api.github.com/repos/LightChang/bansik.tw/compare/$(cat .ref)...main" \
  | FILES="$FILES" python3 -c '
import json, os, sys
d = json.load(sys.stdin)
names = [f["filename"] for f in d.get("files", [])]
if len(names) >= 300:  # API 最多回 300 個檔，滿了就無法確定，當成有改
    print("差異超過 300 個檔，無法確認"); sys.exit(0)
print(" ".join(n for n in names if n in os.environ["FILES"].split()))
') || { log "中止：查不到 repo 版本差異（repo 轉 private 或 API 失敗？），不投遞"; exit 1; }
[ -z "$CHANGED" ] || { log "中止：repo 改過 $CHANGED，請重跑檔頭的安裝段落，不投遞"; exit 1; }

[ -f "$DATA/state.json" ] || cp research/state.json "$DATA/state.json"
mkdir -p "$DATA/archive"

if [ -z "$(ls -A "$DATA/work")" ]; then
  log "第一次：整批抓取"
  PYTHON="$PY" bash research/scripts/fetch_all.sh "$DATA/work" || log "整批抓取有來源失敗（見上方），照常投遞"
fi
"$PY" research/scripts/sync.py --due --work "$DATA/work" --state "$DATA/state.json" --archive "$DATA/archive" \
  || log "sync.py 回報錯誤，照常投遞已抓到的部分"

cd "$DATA" || exit 1
find work -type f -print0 | sort -z | xargs -0 sha256sum > MANIFEST.sha256
sha256sum state.json >> MANIFEST.sha256
date -Iseconds > DONE

SSH="ssh -i $KEY -o BatchMode=yes -o StrictHostKeyChecking=accept-new"
for part in work state.json archive MANIFEST.sha256 DONE; do
  rsync -a --partial -e "$SSH" "$part" "$TARGET" || { log "投遞 $part 失敗"; exit 1; }
done
log "投遞完成：$(wc -l < MANIFEST.sha256) 個檔"
