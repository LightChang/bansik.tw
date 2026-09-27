// 單一機構頁：/changhua/places/<機構名稱>/
//
// 家長在 Google 搜的多半是機構全名（「上巧語言治療所」「予泰心理暨職能聯合治療所」），
// 縣市的全部機構頁一頁列上百家，名稱只是表格裡的一格，搜尋結果很難指到它。
// 所以名錄裡的每一家都給一個自己的網址，網址直接用機構名稱，跟行政區頁用區名同一個風格。
//
// 這個檔不讀檔，astro.config.mjs（sitemap 過濾）與頁面都會 import。
import { SERVICE_TYPES } from './facets.mjs';

/** 名錄類別的白話說明。只描述「這張名單是什麼」，不評價機構本身。 */
export const CAT_TEXT = {
  '聯合評估中心': '兒童發展聯合評估中心（國健署補助）',
  '評估醫院': '經認可辦理兒童發展評估的醫院',
  '其他經許可辦理評估之醫院': '經許可辦理兒童發展評估的醫院',
  '療育-醫療單位': '早期療育醫療單位',
  '療育-教育單位': '早期療育教育單位',
  '社區療育據點': '社區療育據點',
  '早療機構': '早期療育機構',
  '通報轉介中心': '發展遲緩兒童通報轉介中心',
  '個案管理中心': '發展遲緩兒童個案管理中心',
  '兒童發展篩檢院所': '兒童發展篩檢院所',
  '新生兒聽力篩檢院所': '新生兒聽力篩檢院所',
  '新生兒聽力確診醫院': '新生兒聽力確診醫院',
  '服務-教育單位': '學前特教服務單位',
  '其他社福單位': '其他社福單位',
};

export const catList = (e) => (e.cats || e.cat || '').split(';').filter(Boolean);

/** 名稱裡網址不能用的字換掉、空白拿掉。同縣市同名的機構另外加行政區，見 placeSlugs() */
const clean = (s) => s.replace(/[/?#%\\]/g, '-').replace(/\s+/g, '');

/**
 * 這個縣市每一家的網址片段：Map(entity_key → slug)。
 * 同名的機構（新北兩家「吳婦產科診所」）後面接行政區；
 * 撞到行政區頁或類型頁的網址也一樣加行政區，免得兩頁搶同一個網址。
 */
export function placeSlugs(c) {
  const reserved = new Set([
    ...Object.keys(c.districts || {}),
    ...SERVICE_TYPES.map((t) => t.slug),
  ]);
  const count = new Map();
  for (const e of c.entities) {
    const s = clean(e.name);
    count.set(s, (count.get(s) || 0) + 1);
  }
  const out = new Map();
  const used = new Set();
  for (const e of c.entities) {
    let s = clean(e.name);
    if (count.get(s) > 1 || reserved.has(s)) s = `${s}-${e.district || '未分區'}`;
    let k = s;
    for (let i = 2; used.has(k); i++) k = `${s}-${i}`;
    used.add(k);
    out.set(e.entity_key, k);
  }
  return out;
}

export const placeUrl = (code, slug) => `/${code}/places/${encodeURIComponent(slug)}/`;

// 只列在兒童發展篩檢或新生兒聽力篩檢名單上的一般診所（婦產科、家醫科、衛生所），
// 頁面上能講的只有「這家可以做篩檢」一件事；名稱裡有兒科的例外，家長會直接搜小兒科。
const SCREEN_ONLY = new Set(['兒童發展篩檢院所', '新生兒聽力篩檢院所']);

/**
 * 要不要讓搜尋引擎收錄。回傳 null＝收錄；字串＝不收錄的理由（頁面註解與檢查用）。
 *
 * 資料只有名錄那幾欄，每家能寫的東西差不多，所以門檻看的是「這一頁對搜尋的人有沒有答案」：
 *   - 地址沒有門牌、或電話不像電話：連最基本的「在哪、怎麼聯絡」都給不出來
 *   - 只列在篩檢名單上的一般診所：跟早療沒有其他關聯，一頁只有一句話
 *   - 學校與幼兒園的療育時段（療育-教育單位）：名稱多是「某某國小(時段)」，
 *     家長不會拿它來搜，收錄了只是佔掉新站的檢索額度
 * 不收錄的頁照樣產生、照樣從清單頁連過去，只是加 noindex 並排除在 sitemap 外。
 */
export function noindexReason(e) {
  const cats = catList(e);
  if (!/\d+號/.test(e.address || '')) return '地址沒有門牌號碼';
  if ((e.tel || '').replace(/\D/g, '').length < 7) return '沒有可用的電話';
  if (cats.every((k) => SCREEN_ONLY.has(k)) && !/兒科|小兒|兒童/.test(e.name)) {
    return '只列在篩檢名單上的一般診所';
  }
  if (cats.every((k) => k === '療育-教育單位')) return '學校或幼兒園的療育時段';
  return null;
}

/**
 * 標題上的服務關鍵字，照家長的搜尋寫法：「語言治療・早療」「兒童發展評估」。
 * 只用名錄類別與名稱裡已經寫出來的東西，不替機構加它沒登記的服務。
 */
export function serviceWords(e) {
  const cats = catList(e);
  const words = [];
  for (const t of SERVICE_TYPES) {
    if (['screening', 'pediatrics', 'early-intervention'].includes(t.slug)) continue;
    if (t.match(e)) words.push(t.label);
  }
  if (cats.some((k) => /療育|早療機構/.test(k))) words.push('早療');
  if (cats.some((k) => /通報轉介|個案管理/.test(k))) words.push('早療通報與個案管理');
  if (cats.includes('兒童發展篩檢院所')) words.push('兒童發展篩檢');
  if (cats.some((k) => /新生兒聽力/.test(k))) words.push('新生兒聽力篩檢');
  // 社家署早期療育資源名錄裡的社福單位與學前特教單位，名錄本身就是早療資源
  if (cats.some((k) => k === '其他社福單位' || k === '服務-教育單位')) words.push('早療資源');
  return [...new Set(words)].slice(0, 3);
}

/** schema.org 型別。醫院 → Hospital；醫療類名單 → MedicalClinic；其他 → LocalBusiness */
export function schemaType(e) {
  const cats = catList(e);
  if (/醫院/.test(e.name)) return 'Hospital';
  if (cats.some((k) => /醫療單位|篩檢院所|評估|聽力確診/.test(k)) || /診所|治療所|衛生所/.test(e.name)) {
    return 'MedicalClinic';
  }
  return 'LocalBusiness';
}
