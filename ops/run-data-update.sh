#!/bin/bash
# ops/run-data-update.sh
# bansik.tw 每週資料更新（境外主機，2026-09-29 起）。
#
# pnpm build 會更新 sitemap lastmod 帳 src/lastmod.json（變了的頁記成今天），一起 commit。
#
# 為什麼分兩台：來源幾乎都是政府網站，擋海外 IP（這台實測全數連線逾時）。
# 比照 seh.tw 的分工——
#   ① 台灣主機（tw8）只抓：每週跑 research/scripts/sync.py --due，把 work/、state.json、archive/
#      投遞到這台的 write-only inbox（rrsync -wo -no-del），最後才寫 DONE（內含 MANIFEST 的 sha256）。
#      tw8 端腳本是 ops/fetch-taiwan.sh。
#   ② 這台做其餘：驗 MANIFEST → 解析（districts → build → renames → make_site_data）→ 守門
#      → pnpm test／build → 有實質變更才 commit 並 push main（push 觸發 deploy.yml 部署）。
#
# 守門（任一條不過就不推，發 Slack）：
#   - 機構總數比上一版少超過 10%：多半是某個來源這輪沒抓成功，不是真的關了一成機構。
#   - 除了 generated_at 以外沒有任何變化：不推（避免每週一個空 commit 讓 lastmod 全站變動）。
#   - renames.py 找到更名候選：照推，但在 Slack 列出來請人確認後寫進 aliases.json。
#
# 環境變數：
#   BANSIK_INBOX     inbox 位置（預設 /root/.config/bansik/intake/inbox）
#   BANSIK_PY        Python（需 pdfplumber、pandas、openpyxl、odfpy；預設 /root/.local/share/bansik-venv/bin/python）
#   BANSIK_DRY=1     只解析與守門、印出差異，不 commit／push（第一次接上時用）
#
# 排程：/etc/cron.d/bansik-data，每週一台北 10:00（tw8 那輪是 07:30）。
# 鎖：與 seo-ops 反思／大腦共用 /tmp/seo-claude-bansik.tw.lock，三者不會同時改工作樹。
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
INBOX="${BANSIK_INBOX:-/root/.config/bansik/intake/inbox}"
PY="${BANSIK_PY:-/root/.local/share/bansik-venv/bin/python}"
STATE_DIR="/root/.config/bansik/data-update"
BUILD="$STATE_DIR/build"
LOG="$STATE_DIR/run.log"
LOCK_FILE="/tmp/seo-claude-bansik.tw.lock"
SEO_OPS="/mnt/yao-care/seo-ops"
export PATH="/root/.local/bin:/usr/local/bin:/usr/bin:/bin:$PATH"

mkdir -p "$STATE_DIR"
exec >> "$LOG" 2>&1
log() { printf '%s  %s\n' "$(date '+%Y-%m-%d %H:%M:%S%z')" "$*"; }
notify() { node "$SEO_OPS/bin/slack-send.mjs" --site bansik.tw --text "$1" >/dev/null 2>&1 || log "Slack 發送失敗"; }
revert() { git checkout -q -- src/data src/lastmod.json research 2>/dev/null; git clean -fdq -- src/data research/archive 2>/dev/null; }
fail() { log "失敗：$1"; notify "🔴 bansik.tw 資料更新 $(TZ=Asia/Taipei date +%-m/%-d)：$1（沒有上線，舊資料照常）"; exit 1; }

exec 200>"$LOCK_FILE"
flock -w 3600 200 || fail "等鎖超過 60 分"

# ── 1. 有沒有新投遞 ───────────────────────────
[ -f "$INBOX/DONE" ] || { log "inbox 沒有 DONE，這週 tw8 沒投遞"; notify "🟡 bansik.tw 資料更新 $(TZ=Asia/Taipei date +%-m/%-d)：台灣主機這週沒有送資料來，跳過（查 tw8 的 /var/lib/bansik/fetch.log，最常見是最近改過 README 列的 3 個抓取檔、tw8 還沒重裝）"; exit 0; }
if [ -f "$STATE_DIR/last-import" ] && ! [ "$INBOX/DONE" -nt "$STATE_DIR/last-import" ]; then
  log "DONE 沒比上次新，跳過"; exit 0
fi
( cd "$INBOX" && sha256sum --quiet -c MANIFEST.sha256 ) || fail "投遞檔案的 sha256 對不上（傳輸中斷或還沒送完）"

# ── 2. 工作樹 ─────────────────────────────────
cd "$ROOT" || fail "找不到 $ROOT"
[ -z "$(git status --porcelain -- src/data src/lastmod.json research)" ] || fail "工作樹 src/data 或 research 有未提交的修改"
git pull -q --rebase || fail "git pull 失敗"

count() { python3 -c "import json,glob;print(sum(len(json.load(open(f)).get('entities',[])) for f in glob.glob('src/data/counties/*.json')))"; }
BEFORE=$(count)

# ── 3. 解析 ───────────────────────────────────
cp "$INBOX/state.json" research/state.json
[ -d "$INBOX/archive" ] && rsync -a "$INBOX/archive/" research/archive/
rm -rf "$BUILD"; mkdir -p "$BUILD"

# 投遞只保證「送來的檔沒壞」，不保證「該有的都有」：來源失效時 tw8 照樣送 DONE
# （2026-09-29 第一輪 hpa115.pdf 因 TLS＋403 沒抓到就是這樣）。所以這裡拿 sources.json
# 的應有清單對一次：缺的檔用 research/archive/<來源>/ 最新一份補上並在 Slack 註明；
# 連存檔都沒有的也列出來，交給下面的解析與機構數守門決定能不能上。
WORK="$STATE_DIR/work"
rsync -a --delete "$INBOX/work/" "$WORK/"
FILLED=""; MISSING=""
while IFS=$'\t' read -r sid out url big; do
  [ -e "$WORK/$out" ] && continue
  snap=$(ls -d research/archive/"$sid"/*/ 2>/dev/null | sort | tail -1)
  if [ -n "$snap" ] && [ -f "$snap$out" ]; then
    mkdir -p "$WORK/$(dirname "$out")"; cp "$snap$out" "$WORK/$out"
    FILLED="$FILLED $out（$(basename "$snap")）"
  elif [ "$url" != - ] && { [ -f "$STATE_DIR/cache/$out" ] || { mkdir -p "$STATE_DIR/cache/$(dirname "$out")" \
       && curl -fsSL --connect-timeout 15 -m 180 -o "$STATE_DIR/cache/$out.tmp" "$url" \
       && mv "$STATE_DIR/cache/$out.tmp" "$STATE_DIR/cache/$out"; }; }; then
    # 標了 big 的大檔 tw8 平常不抓；這台連得到的（鄉鎮界圖資在 GitHub、已停更）抓一次存 cache
    mkdir -p "$WORK/$(dirname "$out")"; cp "$STATE_DIR/cache/$out" "$WORK/$out"
    FILLED="$FILLED $out（境外直抓）"
  elif [ "$big" != 1 ]; then
    # big 的教材 PDF 平常就不抓、解析也不讀，不列（免得每週一則一樣的提醒）
    MISSING="$MISSING $out"
  fi
done < <(python3 -c '
import json
for s in json.load(open("research/scripts/sources.json"))["sources"]:
    outs = [(f["out"], f.get("url", "") if s.get("method") == "get" else "", f.get("big") or s.get("big")) for f in s.get("files", []) + s.get("posts", [])]
    outs += [(s["out"], "", s.get("big"))] if "out" in s else []
    for o, u, b in outs: print(s["id"], o, u or "-", int(bool(b)), sep="\t")')
[ -n "$FILLED" ] && log "用存檔補上：$FILLED"
[ -n "$MISSING" ] && log "缺檔且沒有存檔：$MISSING"
( cd research \
  && "$PY" scripts/districts.py "$WORK" "$BUILD" \
  && "$PY" scripts/build.py "$WORK" "$BUILD" \
  && "$PY" scripts/renames.py "$BUILD" entity_prev.csv \
  && "$PY" ../scripts/make_site_data.py "$BUILD" ) || { revert; fail "解析失敗（看 $LOG）"; }

AFTER=$(count)
if [ "$AFTER" -lt $(( BEFORE * 9 / 10 )) ]; then
  revert
  fail "機構數從 $BEFORE 掉到 $AFTER（少超過一成），多半是有來源沒抓到"
fi

# 只有 generated_at 變的話不推
REAL=$(git diff --unified=0 -- src/data research/state.json research/archive research/entity_prev.csv \
  | grep -E '^[+-][^+-]' | grep -vc '"generated_at"' || true)
UNTRACKED=$(git ls-files --others --exclude-standard -- src/data research/archive | wc -l)
if [ "$REAL" -eq 0 ] && [ "$UNTRACKED" -eq 0 ]; then
  revert
  touch "$STATE_DIR/last-import"
  log "資料沒有實質變化（機構 $AFTER）"
  exit 0
fi

RENAMES=$(( $(wc -l < "$BUILD/rename_candidates.csv" 2>/dev/null || echo 1) - 1 ))
[ "$RENAMES" -lt 0 ] && RENAMES=0
STAT=$(git diff --shortstat -- src/data)

if [ "${BANSIK_DRY:-0}" = 1 ]; then
  log "DRY：機構 $BEFORE → $AFTER；$STAT；更名候選 $RENAMES；存檔補上：${FILLED:-無}；缺檔：${MISSING:-無}"
  git diff --stat -- src/data research | tail -20
  revert
  exit 0
fi

# ── 4. 測試與建置（CI 還會再跑一次，這裡先擋掉壞資料）──
pnpm -s test >/dev/null || { revert; fail "pnpm test 沒過"; }
pnpm -s build >/dev/null || { revert; fail "pnpm build 沒過"; }

# ── 5. 提交 ───────────────────────────────────
git add src/data src/lastmod.json research/state.json research/archive research/entity_prev.csv
git commit -qm "資料：每週更新（機構 $BEFORE → $AFTER）

台灣主機 tw8 抓取、境外主機解析。$STAT" || fail "git commit 失敗"
git push -q || { git reset -q --hard HEAD~1; fail "git push 失敗"; }
touch "$STATE_DIR/last-import"
log "已推送：機構 $BEFORE → $AFTER；$STAT；更名候選 $RENAMES"

MSG="🟢 bansik.tw 資料更新 $(TZ=Asia/Taipei date +%-m/%-d)：機構 $BEFORE → $AFTER 家，已上線"
[ -n "$FILLED" ] && MSG="$MSG
🟡 這輪沒抓到、改用舊存檔：$FILLED"
[ -n "$MISSING" ] && MSG="$MSG
🟡 這輪沒抓到、也沒有存檔：$MISSING"
if [ "$RENAMES" -gt 0 ]; then
  MSG="$MSG
⚠️ 有 $RENAMES 組疑似更名要人確認（地址電話相同、名稱不同）。確認後寫進 research/scripts/aliases.json：
$(tail -n +2 "$BUILD/rename_candidates.csv" | head -5)"
fi
notify "$MSG"
