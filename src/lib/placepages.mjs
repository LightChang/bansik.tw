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

/**
 * 名稱裡網址不能用的字換掉、空白拿掉。同縣市同名的機構另外加行政區，見 placeSlugs()。
 * 先轉 NFC：名錄有 CJK 相容字（「樂」U+F914 等），Astro 寫出的頁面目錄是 NFC，
 * 連結、sitemap 排除清單若用原字就會指到不存在的網址。
 */
const clean = (s) => s.normalize('NFC').replace(/[/?#%\\]/g, '-').replace(/\s+/g, '');

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
 *
 * 2026-10-02 放寬（站主核准）：
 *   - 門牌判斷先去空白、轉半形，也認國字數字：名錄常寫「49 號」「一號」，舊規則誤判成沒有門牌。
 *   - 療育提供者（療育-醫療單位、早療機構、社區療育據點，或名稱有治療所／發展中心／早療／療育）
 *     有行政區就收錄，即使地址是「行動式服務」「未設置據點」：家長搜的是機構名稱本身。
 */
const HOUSE_NO = /[0-9一二三四五六七八九十百零〇]+號/;
const TREATMENT_CATS = new Set(['療育-醫療單位', '早療機構', '社區療育據點']);
export const hasHouseNo = (addr) => HOUSE_NO.test((addr || '').normalize('NFKC').replace(/\s+/g, ''));
export const isTreatmentProvider = (e) => catList(e).some((k) => TREATMENT_CATS.has(k))
  || /治療所|發展中心|早療|療育/.test(e.name);

export function noindexReason(e) {
  const cats = catList(e);
  if (!hasHouseNo(e.address) && !(isTreatmentProvider(e) && e.district)) return '地址沒有門牌號碼';
  if ((e.tel || '').replace(/\D/g, '').length < 7) return '沒有可用的電話';
  // 名稱看得出兒童服務的例外（小兒科、兒童、愛兒、婦兒、親子、婦幼、幼安…），家長會拿名稱直接搜；
  // 家醫科本身看不出，但列在兒童發展篩檢名單上就是有做兒童服務，也收錄。
  const childNamed = /兒|親子|幼/.test(e.name)
    || (/家醫|家庭醫學/.test(e.name) && cats.includes('兒童發展篩檢院所'));
  if (cats.every((k) => SCREEN_ONLY.has(k)) && !childNamed) {
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
  // 「予泰心理暨職能聯合治療所」這種合寫的名稱，類型頁的比對（要連著寫「職能治療」）抓不到，
  // 標題另外從名稱裡的治療類別字補上。只看名稱裡寫出來的字。
  if (cats.some((k) => /療育/.test(k)) && /治療/.test(e.name)) {
    for (const [re, w] of [[/語言/, '語言治療'], [/職能/, '職能治療'], [/物理/, '物理治療'], [/心理/, '心理治療']]) {
      if (re.test(e.name)) words.push(w);
    }
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

// 名錄全名前後常掛著法人別與登記註記：「社團法人全腦科學教育協會(時段)」「財團法人…(日間、時段)」。
// 搜尋結果標題只顯示前二十多個字，家長搜的是中間那段本名，所以 <title> 與 description 把本名放前面。
// 只拿掉「法人別」與「服務型態／健保特約／核可日期」這類註記；委託經營、院區、服務區域等括號
// 是在區分不同單位，一律保留。H1、內文、JSON-LD 仍用名錄全名（站規：不改機構名稱）。
const LEGAL_PREFIX = /^(社團法人|財團法人)(?=.{2,})/;
const NOTE_WORD = '(?:時段|日間|到宅|健保特約|專辦|走動式|\\d{2,3}\\.\\d{1,2}\\.\\d{1,2}核可)';
const TRAILING_NOTE = new RegExp(`\\s*[(（]${NOTE_WORD}(?:[、,，]\\s*${NOTE_WORD})*[)）]\\s*$`);

/** 單一名稱的本名：去掉開頭法人別與結尾註記。去完少於兩個字就回傳原名。 */
export function coreName(name) {
  const s = name.replace(TRAILING_NOTE, '').replace(LEGAL_PREFIX, '').trim();
  return s.length >= 2 ? s : name;
}

/**
 * 這個縣市每一家在標題用的名稱：Map(entity_key → 名稱)。
 * 同縣市兩家去掉註記後同名（「某中心(日間)」與「某中心(時段)」），兩家都改回全名，免得標題重複。
 */
export function titleNames(c) {
  const core = new Map(c.entities.map((e) => [e.entity_key, coreName(e.name)]));
  const count = new Map();
  for (const e of c.entities) {
    const k = core.get(e.entity_key);
    if (k !== e.name) count.set(k, (count.get(k) || 0) + 1);
  }
  const full = new Set(c.entities.map((e) => e.name));
  const out = new Map();
  for (const e of c.entities) {
    const k = core.get(e.entity_key);
    out.set(e.entity_key, k === e.name || (count.get(k) === 1 && !full.has(k)) ? k : e.name);
  }
  return out;
}
