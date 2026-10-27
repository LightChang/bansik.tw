// 機構改名轉址表（src/data/place-redirects.json）維護。規則見 src/lib/placeredirects.mjs。
//
//   node scripts/place-redirects.mjs update [--base <rev>]
//       比對 <rev>（預設 HEAD）與工作樹的資料，改名的機構把「舊網址→新網址」併進表。
//       每週資料更新在 commit 前跑這一步（ops/run-data-update.sh），新改名自動進表。
//   node scripts/place-redirects.mjs history
//       從 git 歷史裡每一版資料（含網址規則 placepages.mjs 的變動）逐版比對，重算整張表。
//       補舊案例、或懷疑表漏了時用。
//
// 兩種模式都會逐筆印出配對證據，以及「網址不見了、但配不到新網址」的機構（不轉址，多半是不在名錄上了）。
// 前後兩版各用「當版的」placepages.mjs 算網址：網址規則本身改過（NFC、撞名加行政區）也算得對。
import { readFileSync, writeFileSync, readdirSync, mkdtempSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { matchRenames, mergeRedirects } from '../src/lib/placeredirects.mjs';

const ROOT = resolve(new URL('..', import.meta.url).pathname);
const TABLE = join(ROOT, 'src/data/place-redirects.json');
const PATHS = ['src/data/counties', 'src/lib/placepages.mjs', 'src/lib/facets.mjs'];
// 單一機構頁從這個 commit 開始才有，更早的版本沒有機構頁網址可轉
const FIRST = 'bf20748';

const git = (...a) => execFileSync('git', ['-C', ROOT, ...a], { encoding: 'utf-8', maxBuffer: 1 << 28 }).trim();
const today = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Taipei' });

let n = 0;
/** 某個目錄（工作樹或 git archive 解開的版本）的機構頁網址索引 */
async function indexOf(dir) {
  // 同一個路徑 import 兩次會拿到快取，所以加查詢字串讓每一版各載一次
  const { placeSlugs } = await import(`${pathToFileURL(join(dir, 'src/lib/placepages.mjs'))}?v=${n++}`);
  const out = {};
  const cdir = join(dir, 'src/data/counties');
  for (const f of readdirSync(cdir).filter((x) => x.endsWith('.json'))) {
    const c = JSON.parse(readFileSync(join(cdir, f), 'utf-8'));
    const slugs = placeSlugs(c);
    out[c.code] = {};
    for (const e of c.entities) {
      out[c.code][e.entity_key] = {
        slug: slugs.get(e.entity_key), name: e.name, address: e.address, tel: e.tel, hosp_id: e.hosp_id || '',
      };
    }
  }
  return out;
}

async function indexAt(rev) {
  const dir = mkdtempSync(join(tmpdir(), 'bansik-redirects-'));
  try {
    const tar = execFileSync('git', ['-C', ROOT, 'archive', rev, ...PATHS], { maxBuffer: 1 << 28 });
    execFileSync('tar', ['-x', '-C', dir], { input: tar });
    return await indexOf(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function load() {
  try {
    return JSON.parse(readFileSync(TABLE, 'utf-8'));
  } catch {
    return {
      $comment: '機構改名轉址表：舊機構頁網址（from）→ 新網址（to），由 scripts/place-redirects.mjs 產生，建置時在舊網址產生轉址頁。規則見 src/lib/placeredirects.mjs。人工補的列也可以，evidence 要寫清楚證據。',
      redirects: [],
    };
  }
}
const save = (t) => writeFileSync(TABLE, `${JSON.stringify(t, null, 2)}\n`);

function report(label, { renames, gone }) {
  for (const r of renames) console.log(`[轉址] ${label} ${r.county}: ${r.from} → ${r.to}（${r.evidence}）`);
  for (const g of gone) console.log(`[不轉址] ${label} ${g.county}: ${g.slug} 這一版沒有了，也配不到改名後的網址（${g.entity_key}）`);
}

const [mode = 'update', ...rest] = process.argv.slice(2);
const table = load();

if (mode === 'update') {
  const bi = rest.indexOf('--base');
  const base = bi >= 0 ? rest[bi + 1] : 'HEAD';
  const res = matchRenames(await indexAt(base), await indexOf(ROOT));
  report(`${base}→工作樹`, res);
  const added = mergeRedirects(table.redirects, res.renames, today());
  save(table);
  console.log(`[place-redirects] 改名 ${res.renames.length} 筆（表上新增或更新 ${added} 筆）、配不到 ${res.gone.length} 筆；表共 ${table.redirects.length} 筆`);
} else if (mode === 'history') {
  const revs = git('rev-list', '--reverse', `${FIRST}^..HEAD`, '--', ...PATHS).split('\n').filter(Boolean);
  let prev = await indexAt(revs[0]);
  let total = 0;
  for (const rev of revs.slice(1)) {
    const cur = await indexAt(rev);
    const res = matchRenames(prev, cur);
    const since = git('show', '-s', '--format=%cs', rev);
    report(rev.slice(0, 7), res);
    total += mergeRedirects(table.redirects, res.renames.map((r) => ({ ...r, commit: rev.slice(0, 7) })), since);
    prev = cur;
  }
  save(table);
  console.log(`[place-redirects] 掃過 ${revs.length} 版，表上新增或更新 ${total} 筆；表共 ${table.redirects.length} 筆`);
} else {
  console.error('用法：node scripts/place-redirects.mjs update [--base <rev>] | history');
  process.exit(2);
}
