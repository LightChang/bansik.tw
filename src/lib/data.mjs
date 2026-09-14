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
export const county = (code) => read(`counties/${code}.json`);

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
