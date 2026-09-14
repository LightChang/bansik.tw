import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';

// 22 個縣市頁 + 全國首頁，全部靜態產生（getStaticPaths），沒有伺服器端。
// 資料在建置期從 src/data/ 讀進來，執行期不對外要任何東西——
// 這個站的讀者是家長，網路條件不一定好，能在建置期算完的就不要留到瀏覽器。
export default defineConfig({
  site: 'https://bansik.tw',
  integrations: [sitemap()],
  build: {
    // 產出 /taichung/index.html 而不是 /taichung.html，
    // 網址才會是 bansik.tw/taichung/（結尾有斜線，跟 CNAME 那版一致）
    format: 'directory',
  },
});
