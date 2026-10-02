// node --test test/（pnpm test）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  serializeJsonLd, breadcrumbList, place, placeItemList, webPage, webSite, organization,
} from '../src/lib/jsonld.mjs';
import { validateHtml, extractJsonLd, filterIssues, loadRules } from '../vendor/seo-ops-jsonld/validate.mjs';

const rules = await loadRules();
const SITE = 'https://bansik.tw';
const html = (...objs) =>
  `<!doctype html><html><head>${objs
    .map((o) => `<script type="application/ld+json">${serializeJsonLd(o)}</script>`)
    .join('')}</head><body></body></html>`;
const errors = (h, page = '/x/') => filterIssues(validateHtml(h, { page, rules }), 'error');

test('serializeJsonLd：< 一律跳脫，解析後值不變', () => {
  const obj = { name: '</script><script>alert(1)</script><!-- x', n: 1 };
  const s = serializeJsonLd(obj);
  assert.ok(!s.includes('<'));
  assert.deepEqual(JSON.parse(s), obj);
  const blocks = extractJsonLd(html(obj));
  assert.equal(blocks.length, 1);
  assert.equal(blocks[0].parseError, null);
  assert.deepEqual(blocks[0].data, obj);
  assert.equal(errors(html({ '@context': 'https://schema.org', '@type': 'Thing', ...obj })).length, 0);
});

test('未跳脫的 JSON.stringify 會被驗證器抓到（對照組）', () => {
  const raw = `<script type="application/ld+json">${JSON.stringify({ '@context': 'https://schema.org', '@type': 'Thing', name: '</script>' })}</script>`;
  assert.ok(errors(raw).some((i) => i.code === 'script-truncated'));
});

test('breadcrumbList：不足 2 項不輸出', () => {
  assert.equal(breadcrumbList([{ name: '全國', url: `${SITE}/` }]), null);
  assert.equal(breadcrumbList([]), null);
  const b = breadcrumbList([{ name: '全國', url: `${SITE}/` }, { name: '臺中市', url: `${SITE}/taichung/` }]);
  assert.equal(errors(html(b)).length, 0);
});

test('place：必填 name、address 由名錄帶入，沒有的欄位不出現', () => {
  const e = { name: '某某診所', address: '臺中市西區某路1號', district: '西區', tel: '04-0000000', geo_level: 'district', lat: '24.1', lng: '120.6' };
  const ld = place(e, { type: 'MedicalClinic', county: '臺中市' });
  assert.equal(ld.name, e.name);
  assert.equal(ld.address.streetAddress, e.address);
  assert.ok(!('url' in ld));
  assert.ok(!('geo' in ld), '座標只到行政區不放 geo');
  assert.equal(errors(html(ld)).length, 0);
  const bad = { ...ld }; delete bad.address;
  assert.ok(errors(html(bad)).some((i) => i.code === 'missing-required'));
  assert.ok(!('identifier' in ld) && !('areaServed' in ld), '名錄沒有代碼與服務區域就不出現');
});

test('place：健保代碼與社家署服務區域照名錄帶入', () => {
  const e = {
    name: '某某治療所', address: '臺中市西區某路1號', district: '西區', hosp_id: '1234567890',
    sfaa: [{ cat: '療育-醫療單位', area: '西區,南區' }, { cat: '早療機構', area: '南區、北區' }],
  };
  const ld = place(e, { type: 'MedicalClinic', county: '臺中市' });
  assert.deepEqual(ld.identifier, { '@type': 'PropertyValue', propertyID: '健保醫事機構代碼', value: '1234567890' });
  assert.deepEqual(ld.areaServed, ['西區', '南區', '北區']);
  assert.equal(errors(html(ld)).length, 0);
});

test('首頁節點與名單頁通過驗證', () => {
  const nodes = [
    webPage({ site: SITE, url: `${SITE}/`, title: 't', home: true }),
    webSite(SITE),
    organization(SITE),
    placeItemList('名單', [{ name: 'A', address: 'x', tel: '1', url: 'https://a.example/' }, { name: 'B' }]),
  ];
  assert.equal(errors(html(...nodes), '/').length, 0);
});
