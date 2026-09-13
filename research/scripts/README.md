# 資料準備腳本

三套抓取腳本（分別對應三次實測）＋ 一支解析腳本，統一入口是 `prepare.sh`。

## 用法

```bash
# 一鍵：抓取 → 解析 → 輸出 build/
bash research/scripts/prepare.sh

# 原始檔已在 work/，只重跑解析
bash research/scripts/prepare.sh --build-only

# 連兩個大型素材 PDF 一起抓（兒童健康手冊 25MB、性教育教材手冊 102MB）
WITH_BIG_PDF=1 bash research/scripts/prepare.sh
```

相依：`pdfplumber`（讀國健署名單的色塊）、`pandas` + `openpyxl`（讀統計 xlsx）。
本機用 `/Users/lightman/miniforge3/bin/python`，要換直譯器就設 `PYTHON=...`。

## 檔案

| 檔案 | 作用 |
|---|---|
| `prepare.sh` | 入口：呼叫 `fetch_all.sh` 再跑 `build.py` |
| `fetch_all.sh` | 依序跑三套抓取腳本，全部落在同一個 `work/`，另補抓就醫地圖頁面（座標在頁面 JS，匯出檔沒有） |
| `build.py` | 把 `work/` 的原始檔解析成 `build/` 的資料集 |
| `aliases.json` | 人工維護的機構對照。名稱比對處理不了更名（陽明大學→陽明交通大學、臺大新竹分院→新竹臺大分院新竹醫院），這裡補上；另記錄「刻意不合併」的案例與理由（彰基本院 vs 彰基兒童醫院是兩個機構） |
| `make_prototype.py` | 切出單一縣市的原型資料（預設臺中市）。`serves_area` 先聚合成「每個行政區有幾家、分別什麼類型」，不然光臺中就 7,787 列關係，頁面吃不下 |

頁面原型本身在 [`../prototype/`](../prototype/)：`make_prototype.py` 產資料、`prototype/build_page.py` 把資料注入模板，產出可直接發布的單檔頁面。
| `../2026-09-11-sources/scripts/` | 機構名錄與統計的抓取與解析（`fetch.sh`、`parse_sfaa.py`、`parse_hpa.py`、`match.py`、`odsread.py`） |
| `../2026-09-12-education/scripts/fetch_edu.sh` | 三方教育素材 |
| `../2026-09-12-topics/scripts/fetch_topics.sh` | 性平／兒少保／特教 |

三支抓取腳本都**刻意不用 `set -e`**：單一來源逾時或改版時，其餘來源要照抓完，最後再看缺哪些檔案。

## 定時更新（依頻率只抓到期的）

`prepare.sh` 是「整批重抓」，日常更新用 `sync.py`：它讀 `sources.json` 的 `cadence`，只抓 `next_due` 已過的來源。

```bash
python scripts/sync.py --list            # 每個來源的頻率、上次抓取、下次到期
python scripts/sync.py --due --dry-run   # 這次會抓什麼，不動手
python scripts/sync.py --due             # 抓到期的（cron 用這個）
python scripts/sync.py --only nhi_roster # 指定來源，忽略到期與否
python scripts/sync.py --due --with-big  # 連 25MB / 102MB 兩份手冊一起檢查
```

| 檔案 | 作用 |
|---|---|
| `sources.json` | 機器可讀的來源清單：URL、取得方式（get／post／api_paged）、`cadence`、是否 `archive`、是否 `big` |
| `sync.py` | 排程抓取：算到期、抓、比對 sha256、內容變了就存快照、更新 `work/state.json` |
| `crontab.example` | cron 範例，每天跑一次 `--due` 即可，不必為每種頻率各排一條 |

`prepare.sh` 與 `sync.py` **不共用狀態**：`prepare.sh` 是整批重抓、不寫 `state.json`，所以第一次改用 `sync.py` 時全部來源都會被判定到期而抓一輪，之後才會依頻率分流。要跳過這一輪就先跑 `sync.py --all` 建立基準。

頻率對照（`sources.json` 的 `cadence_days`）：`daily` 1、`weekly` 7、`monthly` 30、`quarterly` 91、`semiannual` 182、`yearly` 365、`on_change` 30（內容穩定的教材，每月確認一次 hash）。

標了 `big` 的檔案（兒童健康手冊 25MB、性教育教材手冊 102MB）平常會跳過，並在狀態裡記 `pending_big`。只要之後帶 `--with-big` 執行，這些來源就算還沒到期也會被挑出來補抓——`crontab.example` 裡每月 1 號那條就是幹這件事的。

**標了 `archive: true` 的來源，內容變了就會另存到 `archive/<來源>/<日期>/`**（`big` 檔除外——102MB 的教材每改版存一份會把 archive 撐爆，它的版本資訊在 `state.json` 的 sha256 裡）。這些來源在官方端是覆蓋式更新（國健署年度名單、統計處各表、放名額公告、縣市年報），沒自己存就回不去了。

## 輸出（實測筆數）

| 檔案 | 內容 | 列數 |
|---|---|---|
| `entity.csv` | 一家機構一列。跨來源合併，欄位衝突取 hpa > healthforkids > sfaa；含 `cats`（全部身分）、`journey_step`（旅程第幾步）、`tier`、座標 | 3,075；1,177 有醫事機構代碼、1,378 有座標 |
| `entity_raw.csv` | 某個來源說的某家機構一列。同一機構同一分類可能重複，因為來源本身就重複登錄 | 3,835 |
| `observation.csv` `.md` | 某時間點觀察到的值：放名額日、每月名額、預約方式。`entity_key` 可直接 join `entity.csv` | 16 |
| `relation.csv` | `in_county` 3,075／`in_district` 1,378／`serves_area` 9,959／`operated_by` 64 | 14,476 |
| `stats.csv` `.md` | 四種統計併成一張長表：`metric, dim1, dim1_value, dim2, dim2_value, year, value, source` | 690 |
| `timeline.csv` `.md` | **年齡時間軸**：幾個月大該做什麼。預防保健 9 次、發展篩檢 6 次、家長紀錄 9 段、分齡量表 9 份、線上檢核表 13 層、學前安置 4 階段，統一對到月齡軸 | 50 |
| `materials.json` `.md` | 教育素材清單：檢核表 13 個年齡層（含題數與警訊題數）、宣導 27 筆、量表 10 份、融合教育 10 份、性平 73 筆（特教 57）、CRPD 繪本 | — |
| `manifest.json` | 每個原始檔的大小、sha256、抓取時間 | 72 個檔案 |

欄位定義與取用陷阱（`cat` 不等於來源筆數、性侵統計含「合計」列不能加總等）見 [`../SCHEMA.md`](../SCHEMA.md)。列數 ≤1500 的表會另外匯一份同名 `.md`。

`manifest.json` 是配合來源「不留歷史」的補救措施：名錄與動態類來源多半是覆蓋式更新，靠 sha256 比對才知道哪些檔案真的變了、哪些該另外存檔。

## 已知限制

- **聯評中心去重後 92 家，比國健署的 89 家多 3 家**：社家署與就醫地圖有三筆是更名未同步（陽明大學→陽明交通大學、臺大新竹分院→新竹臺大分院新竹醫院、彰基→彰基兒童醫院），對不到同一個代碼。要合併得靠人工 alias 檔。
- **社福類單位（通報轉介、個管、早療機構、社區據點、教育單位）一律不比對健保名冊**：同址常登記別的機構，比對會誤配。
- **座標只有就醫地圖那兩類有**（聯評 88、篩檢院所 1,393），社家署名錄沒有座標。
- 動態層（放名額日、預約方式）還沒有解析器，因為只有少數醫院公布，且每家模板不同——詳見 `../2026-09-11-sources/README.md` §4。
