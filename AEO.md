# AEO：成為搜尋結果上面那段直接答案

管的是 Google 的 AI Overviews 與精選摘要——使用者問「臺中哪裡可以做兒童發展評估」，
上面那段話是不是抄自這個站。收錄本身看 [SEO.md](SEO.md)，被 AI 聊天工具引用看 [GEO.md](GEO.md)。

> **這份文件不寫任何現況數字。**
> 有幾頁有結構化資料、哪幾個查詢有曝光——這些會變，寫死就會誤導。
> 每項指標只留「怎麼查」與「什麼算問題」，數字自己跑指令拿。

前置：`dist/` 的檢查要先 `npm run build`；GSC 指令需要金鑰，見 `scripts/google-api.mjs` 開頭。

---

## 1. 這個站要被抄的是哪幾句

家長問的是有時效、有地點的問題：「27 個月大要做什麼檢查」「新北哪裡可以評估」
「早療補助怎麼申請」。答案要能**單獨一句話成立**——引擎抄走那一句時，不會因為
少了前後文而變成錯的。

所以判準不是「頁面有沒有講到」，而是「**有沒有一句話自己就答得完整**」。
「拉動月齡，下面就會顯示這個月齡該做的事」這種句子，抄出去等於沒答。

---

## 2. 監看指標

| 指標 | 怎麼查 | 什麼算問題 |
|---|---|---|
| 結構化資料（JSON-LD） | `grep -rl 'application/ld+json' dist --include='index.html' \| wc -l` | 小於可收錄頁數（`find dist -name index.html \| wc -l`） |
| 每頁第一段是不是自足的答案 | `grep -o 'class="lead">[^<]*' dist/<縣市>/index.html` | 句子裡有「下面」「上面」「這裡」這種指代，或不含縣市名與具體數量 |
| 有沒有小標可供擷取 | `grep -rL '<h2' dist --include='index.html' \| wc -l` | 不是 0（每頁至少要有一個 `h2`） |
| 表格有沒有 caption | `grep -rho '<table[^>]*>' dist --include='index.html' \| wc -l` 對照 `grep -rho '<caption' dist --include='index.html' \| wc -l` | 兩者差距大＝多數表格沒有說明，引擎不知道那張表在講什麼 |
| 主要內容需不需要跑 JS 才看得到 | `curl -s https://bansik.tw/taichung/places/ \| grep -c '<tbody id="ftbody"></tbody>'` | 回 1＝機構列表是瀏覽器端塞進去的，純文字擷取只拿得到空表格（細節見 GEO.md §3） |
| 哪些查詢已經有曝光 | `node scripts/google-api.mjs queries 28` | 有曝光、平均排名在前幾名、但點擊是 0 → 很可能被 AI Overviews 直接答掉了，該檢查那一段話寫得對不對 |

---

## 3. 判讀陷阱

**曝光有、點擊 0，不等於頁面沒用。** 那正是被當成直接答案的典型樣子。
要判斷答得對不對，去看那一頁被抄的段落本身，不要只看 CTR 掉了就改 title。

**沒有資料時不要調整。** 上線初期 `queries` 會回「沒有資料」，那是延遲與樣本不足，
不是寫得不好。沒有資料就不做關鍵字層級的調整——這時候能做的只有結構（§2 前四項）。

**`grep -c` 在單行 HTML 上會騙人。** Astro 產出的頁面整份是一行，`grep -c` 數的是
「有幾行含有」而不是「出現幾次」，永遠回 1。要數次數一律用 `grep -o … | wc -l`。

---

## 4. 已知缺口

不寫「目前有幾頁」，只寫要補什麼、補完怎麼驗：

- **JSON-LD**：目前沒有任何結構化資料（跑 §2 第一條確認）。這個站合適的型別是
  `MedicalClinic`／`GovernmentOffice`（機構）、`FAQPage`（常見問題）、
  `BreadcrumbList`（麵包屑）。補完後第一條指令的數字要等於可收錄頁數。
- **素材頁在每個縣市底下都有一份，內容與 description 完全相同**（驗法見 SEO.md §2）。
  對 AEO 的影響是引擎不知道該抄哪一頁。
- **頁尾「資料產生於」後面缺一個分隔符**，日期會直接黏住下一句的「來源：」，抄出去連成一團：

  ```bash
  grep -o '資料產生於[^<]*' dist/taichung/index.html
  ```
