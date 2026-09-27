// 建置時的 JSON-LD 驗證（Astro integration，astro:build:done）。
//
// 1. vendor/seo-ops-jsonld/validate.mjs＋rules.json（官方文件查證的共用規則）掃整個 dist，
//    頁型要求讀 jsonld-pages.json 的 pages。
// 2. jsonld-pages.json 的 dataPages：網址用萬用字元分不出來的頁型（/<縣市>/places/<中文>/ 同時是
//    行政區頁與機構頁），依 src/data 算出每一頁的網址與應有類型，逐頁檢查。
// 有任何錯誤就丟例外讓 build 失敗（CI 不部署），並逐條列出頁面與原因。
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  validateDist, filterIssues, formatIssue, loadRules, extractJsonLd,
} from '../vendor/seo-ops-jsonld/validate.mjs';
import { counties, county } from '../src/lib/data.mjs';
import { typePages, districtPages } from '../src/lib/facets.mjs';
import { placeSlugs, schemaType } from '../src/lib/placepages.mjs';

const ROOT = new URL('../', import.meta.url);

/**
 * dataPages：{ 頁面路徑: 應有的類型[] }。
 * 路徑轉 NFC：名錄有 CJK 相容字（樂 U+F914 等），Astro 寫檔時會正規化成 NFC，不轉會對不到 dist。
 */
export function dataPageTypes() {
  const out = new Map();
  const set = out.set.bind(out);
  out.set = (k, v) => set(k.normalize('NFC'), v);
  for (const { code } of counties()) {
    const c = county(code);
    for (const { type } of typePages(c)) out.set(`/${code}/places/${type.slug}/`, ['ItemList']);
    for (const { district } of districtPages(c)) out.set(`/${code}/places/${district}/`, ['ItemList']);
    const slugs = placeSlugs(c);
    for (const e of c.entities) out.set(`/${code}/places/${slugs.get(e.entity_key)}/`, [schemaType(e)]);
  }
  return out;
}

function topLevelTypes(html) {
  const types = new Set();
  for (const b of extractJsonLd(html)) {
    for (const item of [].concat(b.data ?? [])) {
      if (!item || typeof item !== 'object') continue;
      const nodes = Array.isArray(item['@graph']) ? [...item['@graph'], item] : [item];
      for (const n of nodes) for (const t of [].concat(n?.['@type'] ?? [])) types.add(t);
    }
  }
  return types;
}

/** dist 目錄 → 驗證結果（build hook 與測試共用） */
export async function checkDist(dir) {
  const distDir = dir instanceof URL ? fileURLToPath(dir) : dir;
  const site = JSON.parse(await readFile(new URL('jsonld-pages.json', ROOT), 'utf8'));
  const { pages, issues } = await validateDist(distDir, { rules: await loadRules(), site });
  for (const [page, want] of dataPageTypes()) {
    const file = join(distDir, page, 'index.html');
    if (!existsSync(file)) {
      issues.push({ page, block: null, type: null, path: null, code: 'missing-page', severity: 'error',
        message: '資料裡有這一頁，dist 裡沒有', source: null });
      continue;
    }
    const have = topLevelTypes(await readFile(file, 'utf8'));
    for (const t of want) {
      if (!have.has(t)) issues.push({ page, block: null, type: t, path: null, code: 'missing-page-type',
        severity: 'error', message: `此頁型（jsonld-pages.json dataPages）必須輸出 ${t}`, source: null });
    }
  }
  return { pages, issues };
}

export default function jsonldCheck() {
  return {
    name: 'jsonld-check',
    hooks: {
      'astro:build:done': async ({ dir, logger }) => {
        const { pages, issues } = await checkDist(dir);
        const warnings = issues.filter((i) => i.severity === 'warning');
        for (const i of warnings) logger.warn(formatIssue(i));
        const errors = filterIssues(issues, 'error');
        for (const i of errors) logger.error(formatIssue(i));
        logger.info(`JSON-LD：${pages} 頁，錯誤 ${errors.length}，警告 ${warnings.length}`);
        if (errors.length) {
          throw new Error(`JSON-LD 驗證失敗 ${errors.length} 則（規則：vendor/seo-ops-jsonld/rules.json、jsonld-pages.json）`);
        }
      },
    },
  };
}
