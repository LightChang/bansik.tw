#!/bin/bash
# ops/fetch-taiwan.sh
# bansik.tw 台灣端抓取器（tw8，2026-09-29 起）。比照 seh.tw 的 ops/fetch-taiwan-only.sh：
# 台灣主機只抓、不碰 git、不解析、不 build；解析與上線在境外主機的 ops/run-data-update.sh。
#
# 【tw8 不 clone repo】只放抓取需要的 8 個檔，目錄結構照 repo（fetch_all.sh 靠相對路徑找另外三支）：
#   B=https://raw.githubusercontent.com/LightChang/bansik.tw/main
#   H=/opt/bansik-fetch
#   for f in ops/fetch-taiwan.sh research/state.json research/scripts/sync.py research/scripts/sources.json \
#            research/scripts/fetch_all.sh research/2026-09-11-sources/scripts/fetch.sh \
#            research/2026-09-12-education/scripts/fetch_edu.sh research/2026-09-12-topics/scripts/fetch_topics.sh; do
#     mkdir -p "$H/$(dirname $f)" && curl -fsSL "$B/$f" -o "$H/$f" || { echo "失敗：$f"; break; }; done
# 不自動更新（不讓台灣主機每週執行新下載的程式），但每輪會比對（見下方 FILES）：
#   遠端取不到（repo 轉 private、404）或內容跟本機不同 → 這輪中止、不投遞，fetch.log 寫明原因。
#   境外那邊收不到 DONE 就會在 Slack 發 🟡，不會悄悄拿舊版跑下去。改版時重跑上面這段即可。
# 相依只有系統 python3（標準函式庫）、curl、rsync；不需要 pandas／pdfplumber。
#
#   ① 第一次（DATA/work 是空的）：research/scripts/fetch_all.sh 整批抓一輪，建立完整原始檔。
#   ② 之後每週：research/scripts/sync.py --due，只抓到期的來源（頻率見 research/scripts/sources.json）。
#   ③ 產生 MANIFEST.sha256（work/ 與 state.json），rsync 投遞 work/ → state.json → archive/ → MANIFEST，
#      最後才送 DONE。境外以 DONE 比上次新、且 MANIFEST 驗得過，當作「這輪送完了」。
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

# 本機檔案要跟 repo 一致（state.json 不比，那是這台自己在寫的起點）
RAW="https://raw.githubusercontent.com/LightChang/bansik.tw/main"
FILES="ops/fetch-taiwan.sh research/scripts/sync.py research/scripts/sources.json research/scripts/fetch_all.sh
  research/2026-09-11-sources/scripts/fetch.sh research/2026-09-12-education/scripts/fetch_edu.sh
  research/2026-09-12-topics/scripts/fetch_topics.sh"
for f in $FILES; do
  remote=$(curl -fsSL -m 30 "$RAW/$f" | sha256sum | cut -d' ' -f1; exit "${PIPESTATUS[0]}") \
    || { log "中止：取不到 $RAW/$f（repo 轉 private 或檔案搬走？），不投遞"; exit 1; }
  [ -f "$f" ] && [ "$(sha256sum < "$f" | cut -d' ' -f1)" = "$remote" ] \
    || { log "中止：$f 跟 repo 版本不同，請重跑檔頭的下載段落，不投遞"; exit 1; }
done

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
