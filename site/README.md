# 靜態站：產生與部署

`bansik.tw` 的實際網站。資料來自 [`../research/build/`](../research/build/)，這裡只負責把它變成可以放上 GitHub Pages 的靜態檔案。

## 產生

```bash
cd research
/Users/lightman/miniforge3/bin/python ../site/build_site.py
```

輸出到 `site/dist/`：

```
dist/
  index.html          全國首頁：22 縣市入口與資料說明
  taichung/index.html 縣市頁（單頁應用，內頁走 hash 路由）
  new_taipei/index.html
  …共 22 個縣市
  CNAME               bansik.tw
  .nojekyll           GitHub Pages 不要跑 Jekyll（否則底線開頭的檔名會被忽略）
```

`dist/` 是產生物，不進版控；進版控的是產生腳本、模板與 `counties.json`。

## 網址結構

一個縣市一頁：`https://bansik.tw/taichung/`。內頁（檢查時程、全部機構、分布圖、補助、素材）走 hash 路由，所以縣市頁只有一個網址。

這是刻意的取捨：拆成多頁（`/taichung/places/`）才吃得到 SEO 長尾，但要重寫路由與產生流程。先照現況上線，內容穩定後再拆。

## 從 artifact 移植過來要補的骨架

原型是發布到 artifact 平台的，那個平台會自動把頁面內容包進 `<!doctype html><head>…</head><body>`，所以 `taichung.template.html` **本身沒有這些標籤**——直接放上 GitHub Pages 會是破的文件：中文可能亂碼、手機不會依裝置寬度縮放。

`build_site.py` 負責補上這一層：

- `<!doctype html>` 與 `<html lang="zh-Hant">`
- `<meta charset="utf-8">`（沒有它，中文在某些伺服器設定下會亂碼）
- `<meta name="viewport" content="width=device-width,initial-scale=1">`（沒有它，手機會用 980px 虛擬視窗渲染，先前所有 390px 的量測都會失效）
- `<meta name="description">`：每個縣市各自的描述，給搜尋結果用
- `img { max-width: 100% }`：平台原本代勞的基本 reset

模板自己已經有 `box-sizing`、`margin: 0`、`html, body { height: 100% }` 與 `color-scheme`，這些不重複加。

## 部署（需要 GitHub 帳號與網域設定，不是腳本能做的）

1. 在 GitHub 建 repo 並把這個 repo 推上去。
2. Settings → Pages → Source 選 `GitHub Actions` 或 `Deploy from a branch`，目錄指向 `site/dist`。
3. 自訂網域填 `bansik.tw`（`dist/CNAME` 已經帶了）。
4. 在網域註冊商設 DNS：`A` 指向 GitHub Pages 的四組 IP，或 `CNAME` 指向 `<帳號>.github.io`。
5. 等憑證簽發後開啟 Enforce HTTPS。

`archive/` 有 35MB（來源端不留歷史、只能自己存的快照），最大單檔 16.5MB，都在 GitHub 的限制內。
