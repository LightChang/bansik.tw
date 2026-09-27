// sitemap lastmod 的帳（src/lastmod.json）維護與檢查。說明見 src/lib/lastmod.mjs。
//
//   node scripts/lastmod.mjs update   建置後跑：內容雜湊變了的頁記成今天（臺北時間），新頁同理，
//                                     dist 裡已經沒有的頁從帳上拿掉。沒變的頁日期不動。
//   node scripts/lastmod.mjs check    連建兩次，比對兩次 sitemap 的 <lastmod> 完全一樣，
//                                     且每個網址都有 lastmod、沒有晚於今天的日期。
import { readFileSync, writeFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { join } from 'node:path';
import { contentHash, LEDGER_PATH } from '../src/lib/lastmod.mjs';

const DIST = 'dist';
const today = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Taipei' });

function* pages(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) yield* pages(p);
    else if (name === 'index.html') yield p;
  }
}

function update() {
  const old = existsSync(LEDGER_PATH) ? JSON.parse(readFileSync(LEDGER_PATH, 'utf-8')) : {};
  const next = {};
  let changed = 0;
  for (const file of pages(DIST)) {
    const path = `/${file.slice(DIST.length + 1, -'index.html'.length)}`;
    const h = contentHash(readFileSync(file, 'utf-8'));
    if (old[path] && old[path][0] === h) {
      next[path] = old[path];
    } else {
      next[path] = [h, today()];
      changed++;
    }
  }
  const sorted = Object.fromEntries(Object.keys(next).sort().map((k) => [k, next[k]]));
  writeFileSync(LEDGER_PATH, `${JSON.stringify(sorted, null, 0).replace(/\],"/g, '],\n"')}\n`);
  const removed = Object.keys(old).filter((k) => !next[k]).length;
  console.log(`lastmod：${Object.keys(next).length} 頁，${changed} 頁更新日期，${removed} 頁移除`);
}

function sitemapLastmods() {
  const xml = readdirSync(DIST)
    .filter((f) => /^sitemap-\d+\.xml$/.test(f))
    .map((f) => readFileSync(join(DIST, f), 'utf-8'))
    .join('');
  const urls = [...xml.matchAll(/<url>([\s\S]*?)<\/url>/g)].map((m) => ({
    loc: (m[1].match(/<loc>(.*?)<\/loc>/) || [])[1],
    lastmod: (m[1].match(/<lastmod>(.*?)<\/lastmod>/) || [])[1],
  }));
  return urls;
}

function check() {
  const build = () => execSync('npx astro build', { stdio: 'ignore' });
  build();
  const a = sitemapLastmods();
  build();
  const b = sitemapLastmods();
  const errs = [];
  const bm = new Map(b.map((u) => [u.loc, u.lastmod]));
  for (const u of a) {
    if (!u.lastmod) errs.push(`沒有 lastmod：${u.loc}`);
    else if (u.lastmod.slice(0, 10) > today()) errs.push(`晚於今天：${u.loc} ${u.lastmod}`);
    if (bm.get(u.loc) !== u.lastmod) errs.push(`兩次建置不同：${u.loc} ${u.lastmod} → ${bm.get(u.loc)}`);
  }
  if (a.length !== b.length) errs.push(`兩次網址數不同：${a.length} → ${b.length}`);
  const dist = {};
  for (const u of a) dist[(u.lastmod || '無').slice(0, 10)] = (dist[(u.lastmod || '無').slice(0, 10)] || 0) + 1;
  console.log(`sitemap ${a.length} 個網址，lastmod 分布：`, dist);
  if (errs.length) {
    console.error(errs.slice(0, 20).join('\n'));
    process.exit(1);
  }
  console.log('lastmod 檢查通過：連建兩次完全一致');
}

const cmd = process.argv[2];
if (cmd === 'update') update();
else if (cmd === 'check') check();
else {
  console.error('用法：node scripts/lastmod.mjs update|check');
  process.exit(2);
}
