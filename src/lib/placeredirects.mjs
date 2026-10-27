// 機構改名轉址：舊的機構頁網址 → 新的機構頁網址。
//
// 機構頁網址用機構名稱（見 placepages.mjs），名錄裡的名稱一改（「(日間、時段)」變「(日間)」、
// 加掛地區前綴），網址跟著變，Google 已收錄的舊網址就 404。
// 轉址表是 src/data/place-redirects.json，由 scripts/place-redirects.mjs 比對前後兩版資料產生：
//   - 每週資料更新（ops/run-data-update.sh）在 commit 前跑 `update`，新改名自動進表
//   - `history` 從 git 歷史的資料檔重算一次全部（補舊案例、驗證表沒漏）
//
// 這個站在 GitHub Pages，沒有伺服器端，給不出真正的 HTTP 301。
// 退而用 Google 文件列的替代做法：舊網址產生一頁 meta refresh（0 秒）＋ canonical 指向新網址，
// Google 把 0 秒 meta refresh 當永久轉址處理
// （https://developers.google.com/search/docs/crawling-indexing/301-redirects#metarefresh）。
//
// 這個檔不讀檔，建置期、腳本、測試共用。

/** 地址比對用：全形轉半形、去空白、臺→台。 */
export const addrKey = (s) => (s || '').normalize('NFKC').replace(/\s+/g, '').replace(/臺/g, '台');

/** 電話比對用：只取第一支號碼的數字（「07-7497717、7497921」「04-8960271分機249」）。 */
export const telKey = (s) => ((s || '').split(/[、,，/;；#]|分機|轉/)[0] || '').replace(/\D/g, '');

/**
 * 比對前後兩版的機構頁網址。
 * idx：{ 縣市代碼: { entity_key: { slug, name, address, tel, hosp_id } } }
 *
 * 只看「舊版有、新版沒有的網址」與「新版才有的網址」兩邊，依序用三種證據配對：
 *   1. entity_key 相同（有健保代碼的機構 key 就是代碼，改名 key 不變，只有網址變）
 *   2. 健保醫事機構代碼相同
 *   3. 地址＋第一支電話相同，且兩邊各只有一筆（同一棟樓多個單位共用總機的不配）
 * 都配不到的舊網址回在 gone（多半是真的不在名錄上了），由呼叫端逐筆列出，不轉址。
 */
export function matchRenames(prev, next) {
  const renames = [];
  const gone = [];
  for (const code of Object.keys(prev).sort()) {
    const p = prev[code] || {};
    const n = next[code] || {};
    const liveNext = new Set(Object.values(n).map((v) => v.slug));
    const livePrev = new Set(Object.values(p).map((v) => v.slug));
    const lost = Object.entries(p).filter(([, v]) => !liveNext.has(v.slug));
    const added = Object.entries(n).filter(([, v]) => !livePrev.has(v.slug));
    const taken = new Set();
    const fp = (v) => (addrKey(v.address) && telKey(v.tel) ? `${addrKey(v.address)}|${telKey(v.tel)}` : null);
    const fpCount = (list) => {
      const m = new Map();
      for (const [, v] of list) { const f = fp(v); if (f) m.set(f, (m.get(f) || 0) + 1); }
      return m;
    };
    const lostFp = fpCount(lost);
    const addedFp = fpCount(added);
    for (const [key, v] of lost) {
      let hit = null;
      let evidence = '';
      const free = added.filter(([k]) => !taken.has(k));
      hit = free.find(([k]) => k === key);
      if (hit) evidence = 'entity_key 相同';
      if (!hit && v.hosp_id) {
        hit = free.find(([, w]) => w.hosp_id && w.hosp_id === v.hosp_id);
        if (hit) evidence = `健保代碼 ${v.hosp_id} 相同`;
      }
      const f = fp(v);
      if (!hit && f && lostFp.get(f) === 1 && addedFp.get(f) === 1) {
        hit = free.find(([, w]) => fp(w) === f);
        if (hit) evidence = `地址電話相同（${v.address}／${v.tel}）`;
      }
      // 只差在 Unicode 正規化（CJK 相容字轉 NFC）的不算改名：Astro 寫出的目錄本來就是 NFC，兩者是同一頁
      if (hit && hit[1].slug.normalize('NFC') === v.slug.normalize('NFC')) { taken.add(hit[0]); continue; }
      if (hit) {
        taken.add(hit[0]);
        renames.push({
          county: code, from: v.slug, to: hit[1].slug,
          from_name: v.name, to_name: hit[1].name, entity_key: hit[0], evidence,
        });
      } else {
        gone.push({ county: code, slug: v.slug, name: v.name, entity_key: key });
      }
    }
  }
  return { renames, gone };
}

/** 新的改名併進轉址表（同縣市同 from 以新的為準），回傳實際新增／更新的筆數。 */
export function mergeRedirects(table, renames, since) {
  let n = 0;
  for (const r of renames) {
    const i = table.findIndex((x) => x.county === r.county && x.from === r.from);
    const row = { ...r, since };
    if (i >= 0) {
      if (table[i].to === r.to) continue;
      table[i] = row;
    } else {
      table.push(row);
    }
    n++;
  }
  table.sort((a, b) => a.county.localeCompare(b.county) || a.since.localeCompare(b.since) || a.from.localeCompare(b.from));
  return n;
}

/**
 * 某縣市這次建置要產生的轉址頁。
 * live：Map(slug → 機構名稱)，這一版實際存在的機構頁；reserved：這一版其他頁用掉的網址（類型頁、行政區頁）。
 *
 * - 一路接到底：A→B、B 後來又改成 C，A 直接轉 C（不讓搜尋引擎跳兩次）
 * - 舊網址這一版又有頁面在用（撞名、改回原名）：頁面優先，不產生轉址
 * - 接到底仍不是現存機構頁（新名稱的機構後來也不在名錄上了）：不轉，回 dropped 讓建置逐筆列出
 */
export function redirectPages(table, code, live, reserved = new Set()) {
  const rows = table.filter((r) => r.county === code);
  const next = new Map(rows.map((r) => [r.from, r]));
  const pages = [];
  const dropped = [];
  for (const r of rows) {
    const nfc = r.from.normalize('NFC');
    if (live.has(nfc) || reserved.has(nfc)) continue;
    let to = r.to;
    const seen = new Set([r.from]);
    while (!live.has(to) && next.has(to) && !seen.has(to)) { seen.add(to); to = next.get(to).to; }
    if (live.has(to)) pages.push({ from: r.from, to, toName: live.get(to), fromName: r.from_name });
    else dropped.push({ ...r, reason: `新網址 ${to} 這一版沒有機構頁` });
  }
  return { pages, dropped };
}
