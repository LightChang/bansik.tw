// 結構化資料（JSON-LD）的唯一產生處。
//
// 規則（站主 2026-09-27 拍板）：以官方文件為準、集中產生、資料同源、安全輸出、建置時驗證。
//   - 所有節點都在這裡組；頁面只把「頁面上已經顯示的那份資料」傳進來，不另外寫一份。
//   - 輸出只走 src/components/JsonLd.astro（Base.astro 的 <head> 裡一個），用 serializeJsonLd() 跳脫 `<`。
//   - 只填資料裡真的有的欄位；醫療機構的資訊不補、不猜。
//   - 各類型的必填欄位與 Google 支援狀況見 vendor/seo-ops-jsonld/rules.json；
//     哪個頁型必須有哪個類型見 jsonld-pages.json。建置完由 astro.config.mjs 的 jsonld-check 驗證。

export const CONTEXT = 'https://schema.org';

/** 站名：導覽列顯示的與結構化資料用的是同一個字串 */
export const SITE_NAME = 'bansik｜兒童發展地圖';

/** 物件 → <script type="application/ld+json"> 的內容，`<` 跳脫規則見 scriptjson.mjs */
export { scriptJson as serializeJsonLd } from './scriptjson.mjs';

export const orgId = (site) => `${site}/#organization`;
export const websiteId = (site) => `${site}/#website`;

/**
 * WebSite：Google 網站名稱（site names）要在首頁放 WebSite 的 name、url。只在首頁輸出這一塊；
 * 首頁的 WebPage 以 @id 參照它，其他頁在 isPartOf 內帶同一個 @id 的節點。
 * https://developers.google.com/search/docs/appearance/site-names
 */
export function webSite(site) {
  return {
    '@context': CONTEXT,
    '@type': 'WebSite',
    '@id': websiteId(site),
    name: SITE_NAME,
    url: `${site}/`,
    inLanguage: 'zh-Hant-TW',
    publisher: { '@id': orgId(site) },
  };
}

/**
 * Organization：站台身分的最小可驗證版本。沒有登記在案的統編、地址、電話或對外聯絡窗口，
 * 那些欄位不編。只在首頁輸出，其他頁以 @id 參照。
 */
export function organization(site) {
  return {
    '@context': CONTEXT,
    '@type': 'Organization',
    '@id': orgId(site),
    name: SITE_NAME,
    url: `${site}/`,
    description:
      '臺灣兒童發展篩檢與早期療育的資源地圖。以孩子的月齡為入口，回答三件事：'
      + '現在該做哪一次檢查、附近哪裡可以評估與療育、補助怎麼申請。',
    logo: `${site}/apple-touch-icon.png`,
  };
}

/**
 * WebPage。dateModified 用資料產生日（不是建置時間）；citation 只列傳進來、帶 url 的來源。
 * home：首頁已另外輸出 webSite()，isPartOf 只放 @id 參照。
 * @param {{ site: string, url: string, title: string, description?: string, dataDate?: string,
 *           citations?: { name: string, url?: string, dateModified?: string }[], home?: boolean }} p
 */
export function webPage({ site, url, title, description, dataDate, citations = [], home = false }) {
  const cites = citations.filter((e) => e.url);
  return {
    '@context': CONTEXT,
    '@type': 'WebPage',
    name: title,
    ...(url ? { url } : {}),
    inLanguage: 'zh-Hant-TW',
    isPartOf: home
      ? { '@id': websiteId(site) }
      : {
          '@type': 'WebSite',
          '@id': websiteId(site),
          name: SITE_NAME,
          url: `${site}/`,
          publisher: { '@id': orgId(site) },
        },
    ...(description ? { description } : {}),
    ...(dataDate ? { dateModified: dataDate.slice(0, 10) } : {}),
    ...(cites.length
      ? {
          citation: cites.map((e) => ({
            '@type': 'CreativeWork',
            name: e.name,
            url: e.url,
            ...(e.dateModified ? { dateModified: e.dateModified } : {}),
          })),
        }
      : {}),
  };
}

/**
 * BreadcrumbList。Google 規定至少 2 項（首頁、404 只有「全國」一層），不足就不輸出（回 null）。
 * https://developers.google.com/search/docs/appearance/structured-data/breadcrumb
 * @param {{ name: string, url: string }[]} crumbs
 */
export function breadcrumbList(crumbs) {
  if (!crumbs || crumbs.length < 2) return null;
  return {
    '@context': CONTEXT,
    '@type': 'BreadcrumbList',
    itemListElement: crumbs.map((c, i) => ({
      '@type': 'ListItem', position: i + 1, name: c.name, item: c.url,
    })),
  };
}

/**
 * 單一機構。type 由 placepages.mjs 的 schemaType() 決定（Hospital／MedicalClinic／LocalBusiness）。
 * Google Local business 必填 name、address；其餘只放名錄裡有的。
 * 座標只到行政區的不放 geo——那是整區共用的點，不是門牌。
 * @param {any} e 名錄一筆（頁面表格用的同一筆）
 * @param {{ type: string, county: string }} p
 */
export function place(e, { type, county }) {
  return {
    '@context': CONTEXT,
    '@type': type,
    name: e.name,
    address: {
      '@type': 'PostalAddress',
      streetAddress: e.address,
      ...(e.district ? { addressLocality: e.district } : {}),
      addressRegion: county,
      addressCountry: 'TW',
    },
    ...(e.tel ? { telephone: e.tel } : {}),
    ...(e.url ? { url: e.url } : {}),
    ...(e.geo_level === 'address' && e.lat && e.lng
      ? { geo: { '@type': 'GeoCoordinates', latitude: Number(e.lat), longitude: Number(e.lng) } }
      : {}),
    // 健保醫事機構代碼：只有比對到健保署特約醫療院所名冊的才有
    ...(e.hosp_id
      ? { identifier: { '@type': 'PropertyValue', propertyID: '健保醫事機構代碼', value: e.hosp_id } }
      : {}),
    // 服務區域：社家署名錄「服務區域」欄原文，逗號拆開去重；頁面表格列的是同一欄
    ...(serviceAreas(e).length ? { areaServed: serviceAreas(e) } : {}),
  };
}

/** 社家署名錄登記的服務區域（原文以逗號分隔），去重後照原順序 */
export function serviceAreas(e) {
  const out = [];
  for (const r of e.sfaa || []) {
    for (const a of (r.area || '').split(/[,，、]/)) {
      const s = a.trim();
      if (s && !out.includes(s)) out.push(s);
    }
  }
  return out;
}

/**
 * 名單頁的 ItemList（每筆是 Place）。Google 對 Place 清單沒有強化結果，
 * 留著是讓引擎讀得出這張表是機構清單；欄位與頁面表格同一份 list。
 */
export function placeItemList(name, list) {
  return {
    '@context': CONTEXT,
    '@type': 'ItemList',
    name,
    numberOfItems: list.length,
    itemListElement: list.map((e, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      item: {
        '@type': 'Place',
        name: e.name,
        ...(e.address ? { address: e.address } : {}),
        ...(e.tel ? { telephone: e.tel } : {}),
        ...(e.url ? { url: e.url } : {}),
      },
    })),
  };
}
