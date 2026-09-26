// 服務類型 × 縣市 × 行政區的靜態頁。
//
// 家長搜的是「台中兒童語言治療」「平鎮小兒科」這種「類型＋地點」，
// 而 /places/?d=平鎮區 這種查詢字串 Google 不當成獨立頁面收錄。
// 所以把有足夠家數的組合產生成真正的網址：
//   /taichung/places/speech-therapy/   類型（英文代碼，跟 places、map 一樣）
//   /taoyuan/places/平鎮區/              行政區（直接用區名，跟原本 ?d= 的值一致）
//   /taoyuan/places/平鎮區/screening/   行政區 × 類型
//
// 分類只用資料裡已有的欄位：社家署名錄的類別（cats）與機構名稱。
// 名稱沒寫出治療類別的單位（例如醫院復健科）就不硬歸類，寧可漏也不要猜。
// 這個檔不讀檔，建置期與瀏覽器都可以 import。

/** 門檻：低於這個家數就不出獨立頁，免得產生一堆只有一兩筆的薄頁 */
export const MIN_TYPE = 3;
export const MIN_DISTRICT = 8;
export const MIN_TYPE_DISTRICT = 5;

const has = (e, re) => re.test(e.cats || e.cat || '');
const named = (e, re) => re.test(e.name || '');
// 社家署名錄的療育單位（療育-醫療單位、療育-教育單位、社區療育據點…）
const THERAPY = /療育/;

/**
 * slug 是網址；label 是頁內短稱；title(S, n) 是 <title>，照家長的搜尋寫法；
 * h1(C) 用縣市全銜；basis 說明這一類是怎麼挑出來的，每頁都要照實寫出來。
 */
export const SERVICE_TYPES = [
  {
    slug: 'evaluation',
    label: '兒童發展評估',
    title: (S, n) => `${S}兒童發展評估｜聯合評估中心與評估醫院 ${n} 家`,
    h1: (C) => `${C}哪裡可以做兒童發展評估`,
    match: (e) => has(e, /聯合評估中心|評估醫院|其他經許可辦理評估之醫院/),
    basis: '國健署補助的兒童發展聯合評估中心，加上社家署名錄裡其他經認可辦理評估的醫院。'
      + '做完評估拿到綜合報告書，之後申請補助、安排療育都要用這份。',
  },
  {
    slug: 'speech-therapy',
    label: '語言治療',
    title: (S, n) => `${S}兒童語言治療所｜${n} 家名單與電話`,
    h1: (C) => `${C}兒童語言治療`,
    match: (e) => has(e, THERAPY) && named(e, /語言治療/),
    basis: '社家署早期療育單位名錄裡，名稱有「語言治療」的單位。',
  },
  {
    slug: 'occupational-therapy',
    label: '職能治療',
    title: (S, n) => `${S}兒童職能治療所｜${n} 家名單與電話`,
    h1: (C) => `${C}兒童職能治療`,
    match: (e) => has(e, THERAPY) && named(e, /職能治療/),
    basis: '社家署早期療育單位名錄裡，名稱有「職能治療」的單位。',
  },
  {
    slug: 'physical-therapy',
    label: '物理治療',
    title: (S, n) => `${S}兒童物理治療所｜${n} 家名單與電話`,
    h1: (C) => `${C}兒童物理治療`,
    match: (e) => has(e, THERAPY) && named(e, /物理治療/),
    basis: '社家署早期療育單位名錄裡，名稱有「物理治療」的單位。',
  },
  {
    slug: 'psychotherapy',
    label: '心理治療',
    title: (S, n) => `${S}兒童心理治療所與諮商所｜${n} 家名單與電話`,
    h1: (C) => `${C}兒童心理治療與心理諮商`,
    match: (e) => has(e, THERAPY) && named(e, /心理治療|心理諮商/),
    basis: '社家署早期療育單位名錄裡，名稱有「心理治療」或「心理諮商」的單位。',
  },
  {
    slug: 'rehabilitation',
    label: '復健科',
    title: (S, n) => `${S}兒童復健科診所｜早療 ${n} 家名單與電話`,
    h1: (C) => `${C}兒童復健科（早期療育）`,
    match: (e) => has(e, THERAPY) && named(e, /復健/),
    basis: '社家署早期療育單位名錄裡，名稱有「復健」的診所與醫院。',
  },
  {
    slug: 'pediatrics',
    label: '小兒科',
    title: (S, n) => `${S}小兒科診所｜可做兒童發展篩檢 ${n} 家`,
    h1: (C) => `${C}可做兒童發展篩檢的小兒科`,
    match: (e) => has(e, /兒童發展篩檢院所/) && named(e, /兒科|小兒/),
    basis: '兒童發展篩檢院所名單裡，名稱有「兒科」或「小兒」的診所與醫院。',
  },
  {
    slug: 'screening',
    label: '兒童發展篩檢',
    title: (S, n) => `${S}兒童發展篩檢院所｜${n} 家診所與醫院`,
    h1: (C) => `${C}哪裡可以做兒童發展篩檢`,
    match: (e) => has(e, /兒童發展篩檢院所/),
    basis: '可以做兒童發展篩檢的診所、醫院與衛生所。篩檢是入口，覺得有疑慮再往下一步走。',
  },
  {
    slug: 'early-intervention',
    label: '早療機構',
    title: (S, n) => `${S}早療機構與社區療育據點｜${n} 家`,
    h1: (C) => `${C}早療機構與社區療育據點`,
    match: (e) => has(e, /早療機構|社區療育據點/),
    basis: '社家署名錄裡的早療機構與社區療育據點。',
  },
];

export const typeBySlug = (slug) => SERVICE_TYPES.find((t) => t.slug === slug);

/**
 * 標題用的縣市短稱，照搜尋習慣寫「台中」「桃園」。
 * 新竹、嘉義的縣與市是兩個不同縣市，後綴不能拿掉。
 */
export function shortCounty(name) {
  const n = name.replace(/^臺/, '台');
  if (/^(新竹|嘉義)/.test(n)) return n;
  return n.replace(/[市縣]$/, '');
}

const byName = (a, b) => a.name.localeCompare(b.name, 'zh-Hant');

/** 這個縣市所有達到門檻的類型頁：[{ type, list }] */
export function typePages(c) {
  return SERVICE_TYPES
    .map((type) => ({ type, list: c.entities.filter(type.match).sort(byName) }))
    .filter((p) => p.list.length >= MIN_TYPE);
}

/** 這個縣市所有達到門檻的行政區頁：[{ district, list }]，家數多的在前 */
export function districtPages(c) {
  const by = new Map();
  for (const e of c.entities) {
    if (!e.district) continue;
    if (!by.has(e.district)) by.set(e.district, []);
    by.get(e.district).push(e);
  }
  return [...by.entries()]
    .map(([district, list]) => ({ district, list: list.sort(byName) }))
    .filter((p) => p.list.length >= MIN_DISTRICT)
    .sort((a, b) => b.list.length - a.list.length || a.district.localeCompare(b.district, 'zh-Hant'));
}

/**
 * 行政區 × 類型頁。除了家數門檻，還要跟行政區頁本身拉開差距：
 * 如果那一區幾乎全是同一類，兩頁的名單會幾乎一樣，等於自己跟自己搶。
 */
export function typeDistrictPages(c) {
  const types = typePages(c).map((p) => p.type);
  const out = [];
  for (const { district, list } of districtPages(c)) {
    for (const type of types) {
      const sub = list.filter(type.match);
      if (sub.length >= MIN_TYPE_DISTRICT && list.length - sub.length >= 3) {
        out.push({ district, type, list: sub });
      }
    }
  }
  return out;
}

/** 網址。行政區是中文，href 裡要編碼；Astro 的 params 則給原字 */
export const typeUrl = (code, slug) => `/${code}/places/${slug}/`;
export const districtUrl = (code, d) => `/${code}/places/${encodeURIComponent(d)}/`;
export const typeDistrictUrl = (code, d, slug) => `/${code}/places/${encodeURIComponent(d)}/${slug}/`;
