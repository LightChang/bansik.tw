// 機構頁網址 NFC、站內連結檢查、<script> 內 JSON 跳脫
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { placeSlugs, placeUrl } from '../src/lib/placepages.mjs';
import { scriptJson } from '../src/lib/scriptjson.mjs';
import { checkLinks, linkTargets } from '../scripts/links-check.mjs';
import { counties, county } from '../src/lib/data.mjs';

// 「樂」U+F914、「療」U+F9C1、「龍」U+F9C4 是 CJK 相容字，NFC 後是 U+6A02、U+7642、U+9F8D
const COMPAT = '衛生福利部樂生療養院(迴龍院區)(時段)';
const NFC = '衛生福利部樂生療養院(迴龍院區)(時段)';

test('placeSlugs：含相容字的名稱轉成 NFC，連結＝Astro 實際寫出的頁面路徑', async () => {
  assert.notEqual(COMPAT, NFC);
  const c = { districts: { 龜山區: {} }, entities: [{ entity_key: 'k1', name: COMPAT, district: '龜山區' }] };
  const slug = placeSlugs(c).get('k1');
  assert.equal(slug, NFC);
  const href = placeUrl('taoyuan', slug);
  assert.equal(decodeURIComponent(href), `/taoyuan/places/${NFC}/`);

  // 實際寫一個 NFC 目錄，確認連結檢查認得、非 NFC 的連結會被抓
  const dir = await mkdtemp(join(tmpdir(), 'links-'));
  try {
    await mkdir(join(dir, 'taoyuan/places', NFC), { recursive: true });
    await writeFile(join(dir, 'taoyuan/places', NFC, 'index.html'), '<p>x</p>');
    const bad = `/taoyuan/places/${encodeURIComponent(COMPAT)}/`;
    await writeFile(join(dir, 'index.html'), `<a href="${href}">ok</a><a href="${bad}">bad</a><a href="https://example.com/">x</a>`);
    const r = await checkLinks(dir);
    assert.deepEqual(r.broken.map((b) => b.href), [bad]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('實際資料：所有機構網址片段都是 NFC', () => {
  for (const { code } of counties()) {
    for (const s of placeSlugs(county(code)).values()) assert.equal(s, s.normalize('NFC'), `${code} ${s}`);
  }
});

test('linkTargets：站內／站外判斷與候選檔名', () => {
  assert.equal(linkTargets('https://example.com/a'), null);
  assert.equal(linkTargets('//cdn.example.com/a.js'), null);
  assert.equal(linkTargets('#top'), null);
  assert.deepEqual(linkTargets('/taichung/?a=1#x'), ['taichung/index.html']);
  assert.deepEqual(linkTargets('https://bansik.tw/'), ['index.html']);
  assert.deepEqual(linkTargets('/favicon.svg'), ['favicon.svg', 'favicon.svg.html', 'favicon.svg/index.html']);
});

test('scriptJson：< 全部跳脫，textContent 經 JSON.parse 還原成原值', () => {
  const payload = { name: '</script><script>alert(1)</script>', note: '<!-- x', list: ['a<b'] };
  const s = scriptJson(payload);
  assert.ok(!s.includes('<'));
  assert.deepEqual(JSON.parse(s), payload);
});
