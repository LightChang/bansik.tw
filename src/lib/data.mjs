// 建置期的讀檔層。只有 getStaticPaths 與 frontmatter 會呼叫這裡，
// 不要在 <script> 裡 import 這個檔——它用 node:fs，會把瀏覽器的打包弄壞。
import { readFileSync } from 'node:fs';

// 用 process.cwd() 不用 import.meta.url：這個檔會被 Astro 打包進
// dist/.prerender/chunks/，打包後的 import.meta.url 指向那個目錄，
// `new URL('../data/…', import.meta.url)` 會解析成 dist/.prerender/data/…
// 而不是 src/data/。build 一律從專案根目錄跑，cwd 才是穩的。
const ROOT = process.cwd();

// 22 個縣市 × 7 個頁面 = 154 次 getStaticPaths/frontmatter 呼叫。
// 沒有快取的話 shared.json（111 KB）會被讀 154 次、counties.json 更多，
// 純粹浪費在重複的 JSON.parse 上。
const CACHE = new Map();
function read(rel) {
  if (!CACHE.has(rel)) {
    CACHE.set(rel, JSON.parse(readFileSync(`${ROOT}/src/data/${rel}`, 'utf-8')));
  }
  return CACHE.get(rel);
}

export const counties = () => read('counties.json').counties;
export const siteIndex = () => read('index.json');
export const shared = () => read('shared.json');
export const county = (code) => canonDistricts(read(`counties/${code}.json`));

/**
 * 行政區名稱歸一。資料層有少數機構的行政區少了後綴（桃園「平鎮」、高雄「前鎮」、
 * 臺南「新市」），跟圖資的「平鎮區」被當成兩個區：篩選器出現兩個選項、分布圖只算到一半。
 * 地名本身以區鄉鎮市結尾，make_site_data.py 的 variants() 去尾字比對不到，
 * 所以在讀檔時補一次：對不到座標、但補上後綴對得到的，就併進那一區。
 * 就地改寫並做記號，快取裡的同一份物件只處理一次。
 */
function canonDistricts(c) {
  if (c._canon) return c;
  const geo = c.district_geo || {};
  const fix = (d) => {
    if (!d || geo[d]) return d;
    const hit = [...'區鄉鎮市'].map((s) => d + s).find((v) => geo[v]);
    return hit || d;
  };
  for (const e of c.entities) e.district = fix(e.district);
  const merged = {};
  for (const [k, v] of Object.entries(c.districts)) {
    const to = fix(k);
    if (!merged[to]) {
      merged[to] = { ...v, keys: [...v.keys] };
    } else {
      merged[to].located += v.located;
      merged[to].keys.push(...v.keys);
      // serving 是「服務範圍含這一區」的家數，兩個寫法各算一次會重複，留原本有座標那一筆的
      if (to === k) merged[to].serving = v.serving;
    }
  }
  c.districts = merged;
  Object.defineProperty(c, '_canon', { value: true });
  return c;
}

/** 每個縣市頁都要的那一組：縣市資料 + 共用資料 */
export function countyBundle(code) {
  return { c: county(code), s: shared() };
}

/** 六個內頁的網址與標題，頁尾與內頁導覽共用一份 */
export const SUBPAGES = [
  ['checkups', '這個年齡的所有檢查'],
  ['steps', '完整流程五步'],
  ['places', '全部機構'],
  ['map', '哪一區有幾家'],
  ['subsidy', '補助怎麼申請'],
  ['materials', '看懂發展的素材'],
];

/** 22 個縣市頁共用的 getStaticPaths */
export function countyPaths() {
  return counties().map((c) => ({ params: { county: c.code }, props: { meta: c } }));
}
