#!/usr/bin/env node
// Search Console 與 GA4 的 API 操作，走 bansik-tw 這個專屬 GCP 專案（獨立配額）。
//
//   node scripts/google-api.mjs check                 服務帳號看得到 GSC 資源與 GA 評估 ID 嗎
//   node scripts/google-api.mjs submit                送 sitemap 給 GSC，並列出 GSC 目前的 sitemap 狀態
//   node scripts/google-api.mjs inspect [網址…]       查網址的收錄狀態；不給網址就查 sitemap 裡全部
//   node scripts/google-api.mjs realtime              GA4 最近 30 分鐘有沒有收到資料
//
// 不用 Indexing API：它只接受 JobPosting 與 BroadcastEvent，拿來推一般頁面違反使用條款。
// 新頁面靠 sitemap；inspect 只是查狀態，不會加速收錄。
//
// 憑證：服務帳號 bansik-index@bansik-tw.iam.gserviceaccount.com 的 JSON 金鑰，**機密**。
//   預設讀 ~/.config/bansik/gsc-key.json；CI 用 GOOGLE_SERVICE_ACCOUNT_JSON 放整份 JSON。
// 權限不在 GCP 那邊，要在兩個產品裡各加一次這個 email：
//   Search Console → bansik.tw → 設定 → 使用者和權限 → 權限「完整」（送 sitemap 要完整）
//   GA → 管理 → 資源存取權管理 → 角色「檢視者」
//
// 沒有第三方套件，JWT 用 node:crypto 自己簽（同 seh.tw/scripts/gsc-pull.mjs）。

import { createSign } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const SITE = 'sc-domain:bansik.tw';
const SITEMAP = 'https://bansik.tw/sitemap-index.xml';
const GA_ID = 'G-L05CG61N7H';
const SCOPES = [
  'https://www.googleapis.com/auth/webmasters',          // 送 sitemap 要寫入權限
  'https://www.googleapis.com/auth/analytics.readonly',
];
// 網址檢查 API 每個資源每天 2000 次、每分鐘 600 次；156 頁一次查完沒問題，但別排進高頻排程
const INSPECT_GAP_MS = 150;

const b64url = (b) => Buffer.from(b).toString('base64url');

async function loadKey() {
  if (process.env.GOOGLE_SERVICE_ACCOUNT_JSON) return JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON);
  const file = process.env.BANSIK_GOOGLE_KEY ?? path.join(os.homedir(), '.config', 'bansik', 'gsc-key.json');
  try {
    return JSON.parse(await readFile(file, 'utf-8'));
  } catch {
    console.error(`讀不到金鑰 ${file}。重建：gcloud iam service-accounts keys create ${file} `
      + '--iam-account bansik-index@bansik-tw.iam.gserviceaccount.com');
    process.exit(2);
  }
}

async function accessToken(key) {
  const now = Math.floor(Date.now() / 1000);
  const claim = {
    iss: key.client_email, scope: SCOPES.join(' '),
    aud: 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3600,
  };
  const body = `${b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))}.${b64url(JSON.stringify(claim))}`;
  const sig = createSign('RSA-SHA256').update(body).end().sign(key.private_key).toString('base64url');
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: `${body}.${sig}` }),
  });
  const json = await res.json();
  if (!res.ok) {
    console.error(`取 token 失敗 HTTP ${res.status}：${JSON.stringify(json)}`);
    process.exit(1);
  }
  return json.access_token;
}

/** 回傳 { ok, status, json }，由呼叫端決定失敗怎麼講，因為 403 在 GSC 與 GA 的意思不同。 */
async function call(token, url, { method = 'GET', body } = {}) {
  const res = await fetch(url, {
    method,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json = {};
  try { json = text ? JSON.parse(text) : {}; } catch { json = { raw: text.slice(0, 300) }; }
  return { ok: res.ok, status: res.status, json };
}

function fail(what, r, hint) {
  console.error(`${what} 失敗 HTTP ${r.status}：${JSON.stringify(r.json).slice(0, 400)}`);
  if (hint) console.error(hint);
  process.exit(1);
}

const GSC = 'https://www.googleapis.com/webmasters/v3';
const site = encodeURIComponent(SITE);

async function gscCheck(token, email) {
  const r = await call(token, `${GSC}/sites`);
  if (!r.ok) fail('列出 GSC 資源', r, 'GCP 專案 bansik-tw 有啟用 searchconsole.googleapis.com 嗎？');
  const mine = (r.json.siteEntry ?? []).find((s) => s.siteUrl === SITE);
  if (!mine) {
    console.error(`GSC：服務帳號看不到 ${SITE}。到 Search Console → 設定 → 使用者和權限 → 新增使用者，`
      + `填 ${email}，權限選「完整」。`);
    return null;
  }
  console.log(`GSC：${SITE}　權限 ${mine.permissionLevel}`);
  if (mine.permissionLevel === 'siteRestrictedUser' || mine.permissionLevel === 'siteUnverifiedUser') {
    console.error('GSC：「受限」只能讀，送 sitemap 需要「完整」。');
  }
  return mine;
}

async function gaFind(token, email) {
  const r = await call(token, 'https://analyticsadmin.googleapis.com/v1beta/accountSummaries?pageSize=200');
  if (!r.ok) fail('列出 GA 帳戶', r, 'GCP 專案 bansik-tw 有啟用 analyticsadmin.googleapis.com 嗎？');
  for (const acc of r.json.accountSummaries ?? []) {
    for (const p of acc.propertySummaries ?? []) {
      const s = await call(token, `https://analyticsadmin.googleapis.com/v1beta/${p.property}/dataStreams`);
      const hit = (s.json.dataStreams ?? []).find((d) => d.webStreamData?.measurementId === GA_ID);
      if (hit) {
        console.log(`GA：${GA_ID} → ${p.property}（${p.displayName}），串流網址 ${hit.webStreamData.defaultUri}`);
        return p.property;
      }
    }
  }
  console.error(`GA：服務帳號找不到 ${GA_ID}。到 GA → 管理 → 資源存取權管理 → 新增，填 ${email}，角色「檢視者」。`);
  return null;
}

async function submit(token) {
  const put = await call(token, `${GSC}/sites/${site}/sitemaps/${encodeURIComponent(SITEMAP)}`, { method: 'PUT' });
  if (!put.ok) fail('送 sitemap', put, '403 通常是 GSC 權限只有「受限」，要改成「完整」。');
  console.log(`已送出 ${SITEMAP}`);
  const list = await call(token, `${GSC}/sites/${site}/sitemaps`);
  if (!list.ok) fail('列出 sitemap', list);
  for (const s of list.json.sitemap ?? []) {
    const n = (s.contents ?? []).map((c) => `${c.type} 送出 ${c.submitted}`).join('、') || '尚未處理';
    console.log(`  ${s.path}　送出 ${s.lastSubmitted ?? '-'}　下載 ${s.lastDownloaded ?? '尚未'}`
      + `　錯誤 ${s.errors ?? 0}　警告 ${s.warnings ?? 0}　${n}`);
  }
}

async function sitemapUrls() {
  const index = await (await fetch(SITEMAP)).text();
  const urls = [];
  for (const [, loc] of index.matchAll(/<loc>([^<]+)<\/loc>/g)) {
    const xml = await (await fetch(loc)).text();
    for (const [, u] of xml.matchAll(/<loc>([^<]+)<\/loc>/g)) urls.push(u);
  }
  return urls;
}

async function inspect(token, urls) {
  if (!urls.length) urls = await sitemapUrls();
  const tally = {};
  for (const u of urls) {
    const r = await call(token, 'https://searchconsole.googleapis.com/v1/urlInspection/index:inspect',
      { method: 'POST', body: { inspectionUrl: u, siteUrl: SITE, languageCode: 'zh-TW' } });
    if (!r.ok) fail(`檢查 ${u}`, r, r.status === 429 ? '撞到配額（每天 2000 次、每分鐘 600 次）。' : undefined);
    const idx = r.json.inspectionResult?.indexStatusResult ?? {};
    const state = idx.coverageState ?? idx.verdict ?? '未知';
    tally[state] = (tally[state] ?? 0) + 1;
    console.log(`${u}\t${state}\t上次檢索 ${idx.lastCrawlTime ?? '-'}`);
    await new Promise((ok) => setTimeout(ok, INSPECT_GAP_MS));
  }
  console.log(`\n共 ${urls.length} 頁：${Object.entries(tally).map(([k, v]) => `${k} ${v}`).join('、')}`);
}

async function realtime(token, property) {
  const r = await call(token, `https://analyticsdata.googleapis.com/v1beta/${property}:runRealtimeReport`, {
    method: 'POST',
    body: { dimensions: [{ name: 'unifiedScreenName' }], metrics: [{ name: 'activeUsers' }, { name: 'eventCount' }] },
  });
  if (!r.ok) fail('GA 即時報表', r, 'GCP 專案 bansik-tw 有啟用 analyticsdata.googleapis.com 嗎？');
  const rows = r.json.rows ?? [];
  if (!rows.length) console.log('GA 最近 30 分鐘：沒有資料');
  for (const row of rows) {
    console.log(`  ${row.dimensionValues[0].value}　使用者 ${row.metricValues[0].value}　事件 ${row.metricValues[1].value}`);
  }
}

const [cmd = 'check', ...rest] = process.argv.slice(2);
const key = await loadKey();
const token = await accessToken(key);
console.log(`服務帳號 ${key.client_email}`);

if (cmd === 'check') {
  const gsc = await gscCheck(token, key.client_email);
  const ga = await gaFind(token, key.client_email);
  if (!gsc || !ga) process.exit(1);
} else if (cmd === 'submit') {
  if (!(await gscCheck(token, key.client_email))) process.exit(1);
  await submit(token);
} else if (cmd === 'inspect') {
  if (!(await gscCheck(token, key.client_email))) process.exit(1);
  await inspect(token, rest);
} else if (cmd === 'realtime') {
  const property = await gaFind(token, key.client_email);
  if (!property) process.exit(1);
  await realtime(token, property);
} else {
  console.error(`不認得的指令 ${cmd}。可用：check、submit、inspect、realtime`);
  process.exit(2);
}
