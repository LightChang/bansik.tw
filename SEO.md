# SEO：被 Google 收錄、排得到

管的是「Google 抓不抓得到、收不收錄、有沒有人從搜尋進來」。
AI 引擎那兩軸另外寫在 [AEO.md](AEO.md)、[GEO.md](GEO.md)。

> **這份文件不寫任何現況數字。**
> 收錄幾頁、曝光多少、哪幾頁有問題——這些每天都在變，寫進來的當下就開始過期，
> 而讀的人會拿過期數字當現況判斷。所以每一項指標只留「怎麼查」與「什麼算問題」，
> 數字請自己跑指令拿。要留紀錄就把指令輸出原樣貼進當次的工作紀錄，不要回填到這裡。

前置：所有 `google-api.mjs` 指令都需要金鑰（預設 `~/.config/bansik/gsc-key.json`），
申請與權限設定見該腳本開頭的註解。`dist/` 的檢查要先 `npm run build`。

---

## 1. 監看指標

| 指標 | 怎麼查 | 什麼算問題 |
|---|---|---|
| 服務帳號還連得上 GSC／GA 嗎 | `node scripts/google-api.mjs check` | 非 0 結束。權限掉到 `siteRestrictedUser` 就送不了 sitemap |
| sitemap 有沒有被讀到 | `node scripts/google-api.mjs submit` | 錯誤或警告不是 0；或「下載」欄長期停在「尚未」 |
| 收錄狀態（全站） | `node scripts/google-api.mjs inspect` | 末尾「要修的 N 頁」有列出東西 |
| 收錄狀態（單頁） | `node scripts/google-api.mjs inspect <網址> …` | 同上 |
| 搜尋成效 | `node scripts/google-api.mjs queries [天數]` | 有曝光但 CTR 明顯低於同站其他頁 → title／description 要改 |
| 有沒有人真的進來 | `node scripts/google-api.mjs realtime` | 自己開了站卻查不到 → GA 沒載入，見 §3 |
| sitemap 網址數 vs 實際頁數 | `curl -s https://bansik.tw/sitemap-0.xml \| grep -o '<loc>' \| wc -l`<br>`find dist -name index.html \| wc -l` | 兩者不相等。（404 頁不算在內：它是 `dist/404.html`，不是 `index.html`，也刻意不進 sitemap） |
| 重複的 title／description | 見 §2 的指令 | 有任何一組完全重複 |
| 重複的 canonical | `grep -rho 'rel="canonical" href="[^"]*' dist --include='index.html' \| sort \| uniq -d \| wc -l` | 不是 0 |

---

## 2. 重複 title／description

```bash
npm run build
python3 - <<'PY'
import re, pathlib, collections
t=collections.Counter(); d=collections.Counter()
for p in pathlib.Path('dist').rglob('index.html'):
    h=p.read_text(encoding='utf-8')[:4000]
    m=re.search(r'<title>(.*?)</title>', h); t[m.group(1) if m else '(無 title)']+=1
    m=re.search(r'name="description" content="(.*?)"', h); d[m.group(1) if m else '(無 description)']+=1
print('重複 title：', [k for k,v in t.items() if v>1] or '無')
print('重複 description：', [(k[:30]+'…', v) for k,v in d.items() if v>1] or '無')
PY
```

只讀每頁前 4000 字元，因為 `<head>` 一定在那之內；整頁讀進來會慢十幾倍。

判準：**任何一組完全重複都要處理**。每個縣市底下都存在、但內容全國通用的內頁
（素材頁那種）最容易踩到——內容一樣、description 也一樣，Google 會只留一頁。
要嘛讓每頁真的不同，要嘛收斂成單一網址，不要留著一批互為重複的頁。

---

## 3. 判讀陷阱

**還沒被檢索 ≠ 有錯誤。** Google 沒抓過的頁面，URL Inspection API 會回
`verdict: NEUTRAL` 加一整排 `*_UNSPECIFIED`（`robotsTxtState`、`pageFetchState`、
`indexingState` 都是）。新站剛送完 sitemap 時大半頁面都長這樣。

`inspect` 曾經把這些全列進「要修的」，把真正的問題淹掉。現在的判準是
**沒有 `lastCrawlTime` 且 `pageFetchState` 未定 → 跳過不報**，只報已經被抓過的頁面。
改動見 `scripts/google-api.mjs` 的 `problems()`。

相應地，這三種狀態都**不是**站台的錯，不要為它們改東西：

- `Google 無法辨識的網址`：還沒抓到，等就好
- `已找到 - 目前尚未建立索引`：知道了但還沒抓
- `已檢索 - 目前尚未建立索引`：抓了但 Google 決定先不收，這是它的判斷

要確認這幾頁本身沒毛病，跑一次就夠：

```bash
curl -s -o /dev/null -w "%{http_code}\n" <網址>          # 200
curl -s <網址> | grep -o 'rel="canonical"[^>]*'          # 指向自己
curl -s <網址> | grep -c 'name="robots"'                 # 0（沒有 noindex）
curl -s https://bansik.tw/sitemap-0.xml | grep -c <網址>  # 在 sitemap 裡
```

**GA 的即時報表查不到自己的瀏覽，不一定是 GA 壞了。** 無頭瀏覽器會被 GA 當成機器人濾掉，
用真的瀏覽器開一次再查。要確認頁面本身有沒有載入 GA，改看原始碼裡有沒有評估 ID：

```bash
curl -s https://bansik.tw/taichung/ | grep -c 'G-L05CG61N7H'
```

**GSC 的資料有 2～3 天延遲。** `queries` 已經自動避開最後 3 天，不要自己改成查到昨天，
那幾天的數字之後還會變。

---

## 4. 不要做的事

- **不要用 Indexing API 推頁面。** 它只接受 `JobPosting` 與 `BroadcastEvent`，
  拿來推一般頁面違反使用條款。新頁面靠 sitemap，`inspect` 只能查狀態、不會加速收錄。
- **不要把 `inspect` 排進高頻排程。** URL Inspection 每個資源每天 2000 次、每分鐘 600 次。
  全站掃一次的量看 §1 第一條指令自己算。
- **不要為了「還沒收錄」反覆重送 sitemap。** 重送不會讓 Google 早一點來。
