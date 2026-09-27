// 建置時的站內連結檢查（Astro integration，astro:build:done）。
// dist 內每個 HTML 的 href／src，凡是站內（/ 開頭，或 https://bansik.tw/…）的，
// 去掉 ?query 與 #hash、URL 解碼後，必須對到 dist 裡真的存在的檔案：
//   /a/ → a/index.html；/a/b.png → a/b.png；/a → a、a.html 或 a/index.html。
// 比對是位元組精確的：非 NFC 的連結（CJK 相容字）對不到 NFC 的頁面目錄，會在這裡被抓出來。
// 有任何壞連結就丟例外讓 build 失敗。
import { readFile, readdir } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const SITE_ORIGIN = 'https://bansik.tw';
const ATTR = /\s(?:href|src)\s*=\s*"([^"]*)"/gi;

async function listFiles(dir, base = dir, out = new Set()) {
  for (const ent of await readdir(dir, { withFileTypes: true })) {
    const p = join(dir, ent.name);
    if (ent.isDirectory()) await listFiles(p, base, out);
    else out.add(relative(base, p).split(sep).join('/'));
  }
  return out;
}

/** 站內連結 → dist 相對路徑的候選；站外或非網頁連結回 null */
export function linkTargets(href) {
  let h = href.trim().replace(/&amp;/g, '&');
  if (h.startsWith(SITE_ORIGIN)) h = h.slice(SITE_ORIGIN.length) || '/';
  if (!h.startsWith('/') || h.startsWith('//')) return null;
  h = h.replace(/[?#].*$/, '');
  let p;
  try { p = decodeURIComponent(h).slice(1); } catch { return ['<無法解碼>']; }
  if (p === '' || p.endsWith('/')) return [`${p}index.html`];
  return [p, `${p}.html`, `${p}/index.html`];
}

/** @returns {{ pages: number, links: number, broken: { page: string, href: string }[] }} */
export async function checkLinks(dir) {
  const distDir = dir instanceof URL ? fileURLToPath(dir) : dir;
  const files = await listFiles(distDir);
  const broken = [];
  let pages = 0;
  let links = 0;
  for (const f of files) {
    if (!f.endsWith('.html')) continue;
    pages++;
    const html = await readFile(join(distDir, f), 'utf8');
    for (const m of html.matchAll(ATTR)) {
      const t = linkTargets(m[1]);
      if (!t) continue;
      links++;
      if (!t.some((x) => files.has(x))) broken.push({ page: `/${f}`, href: m[1] });
    }
  }
  return { pages, links, broken };
}

export default function linksCheck() {
  return {
    name: 'links-check',
    hooks: {
      'astro:build:done': async ({ dir, logger }) => {
        const { pages, links, broken } = await checkLinks(dir);
        for (const b of broken) logger.error(`${b.page} → ${b.href}`);
        logger.info(`站內連結：${pages} 頁、${links} 個連結，壞掉 ${broken.length}`);
        if (broken.length) throw new Error(`站內連結指向不存在的檔案 ${broken.length} 個`);
      },
    },
  };
}
