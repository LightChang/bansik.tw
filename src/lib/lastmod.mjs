// sitemap 的 <lastmod>：每一頁「內容真正變更」的日期，不是建置日期。
//
// 做法是一本進版控的帳 src/lastmod.json：{ 路徑: [內容雜湊, 日期] }。
//   - 雜湊只算 dist 頁面裡 <main> 的內容（head 裡的資產檔名、GA 碼不算），
//     另外剔除標了 data-lastmod-skip 的區塊（「最近新增的機構」清單本身就是從這本帳算出來的，
//     算進去會讓帳與頁面互相牽動）。
//   - 建置時（astro.config.mjs 的 sitemap serialize）重算雜湊：跟帳上一樣 → 用帳上的日期；
//     不一樣或帳上沒有 → 用目前這個 commit 的日期（同一個 commit 重建幾次都一樣）。
//   - `pnpm run build` 在 astro build 之後跑 `scripts/lastmod.mjs update`，把變了的頁記成今天，
//     帳要跟著 commit。自動化只跑 `npx astro build` 不更新帳也沒關係，會落到上面的 commit 日期。
// 重建兩次日期不能變：`pnpm run check:lastmod`。
import { readFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { execSync } from 'node:child_process';

const ROOT = process.cwd();
export const LEDGER_PATH = `${ROOT}/src/lastmod.json`;

let cache = null;
/** { '/taichung/': ['雜湊', '2026-09-27'], … } */
export function ledger() {
  if (!cache) cache = existsSync(LEDGER_PATH) ? JSON.parse(readFileSync(LEDGER_PATH, 'utf-8')) : {};
  return cache;
}

/** 頁面內容的雜湊：只看 <main>，剔除 data-lastmod-skip 區塊 */
export function contentHash(html) {
  const m = html.match(/<main[\s\S]*<\/main>/);
  const body = (m ? m[0] : html).replace(/<section[^>]*data-lastmod-skip[\s\S]*?<\/section>/g, '');
  return createHash('sha1').update(body).digest('hex').slice(0, 12);
}

let commitDate;
/** 目前 commit 的日期（YYYY-MM-DD）；拿不到 git 就是 null，sitemap 那一頁就不給 lastmod */
export function headDate() {
  if (commitDate === undefined) {
    try {
      commitDate = execSync('git log -1 --format=%cs', { cwd: ROOT, encoding: 'utf-8' }).trim() || null;
    } catch {
      commitDate = null;
    }
  }
  return commitDate;
}

/** dist 裡某個路徑（/taichung/places/）的 lastmod */
export function lastmodFor(path, html) {
  const hit = ledger()[path];
  if (hit && html && hit[0] === contentHash(html)) return hit[1];
  return headDate();
}
