import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { placeSlugs, noindexReason } from './src/lib/placepages.mjs';
import { lastmodFor } from './src/lib/lastmod.mjs';

// 單一機構頁裡資料太少的那些（見 noindexReason）頁面上是 noindex，
// sitemap 也要一起排除：送進 sitemap 又叫 Google 不要收，是自相矛盾的訊號。
function noindexPaths() {
  const out = new Set();
  const dir = './src/data/counties';
  for (const f of readdirSync(dir)) {
    const c = JSON.parse(readFileSync(`${dir}/${f}`, 'utf-8'));
    const slugs = placeSlugs(c);
    for (const e of c.entities) {
      if (noindexReason(e)) out.add(`/${c.code}/places/${slugs.get(e.entity_key)}/`);
    }
  }
  return out;
}
const NOINDEX = noindexPaths();

// 22 個縣市頁 + 全國首頁，全部靜態產生（getStaticPaths），沒有伺服器端。
// 資料在建置期從 src/data/ 讀進來，執行期不對外要任何東西——
// 這個站的讀者是家長，網路條件不一定好，能在建置期算完的就不要留到瀏覽器。
export default defineConfig({
  site: 'https://bansik.tw',
  integrations: [sitemap({
    filter: (page) => !NOINDEX.has(decodeURIComponent(new URL(page).pathname)),
    // lastmod 是頁面內容真正變更的日期，不是建置日期，規則見 src/lib/lastmod.mjs
    serialize(item) {
      const path = decodeURIComponent(new URL(item.url).pathname);
      const file = `./dist${path}index.html`;
      const date = lastmodFor(path, existsSync(file) ? readFileSync(file, 'utf-8') : null);
      return date ? { ...item, lastmod: date } : item;
    },
  })],
  build: {
    // 產出 /taichung/index.html 而不是 /taichung.html，
    // 網址才會是 bansik.tw/taichung/（結尾有斜線，跟 CNAME 那版一致）
    format: 'directory',
  },
});
