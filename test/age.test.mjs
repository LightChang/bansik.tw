// 月齡頁（/age/）的底稿與對照邏輯
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ageData, shared } from '../src/lib/data.mjs';
import { checksFor, bandForMonth, visitNo, overlaps } from '../src/lib/age.mjs';

const A = ageData();
const tl = shared().timeline;

test('時段：10 段、網址不重複、首尾相接涵蓋 0.5 到 84 個月', () => {
  assert.equal(A.bands.length, 10);
  assert.equal(new Set(A.bands.map((b) => b.slug)).size, A.bands.length);
  assert.equal(A.bands[0].month_min, 0.5);
  assert.equal(A.bands.at(-1).month_max, 84);
  for (let i = 1; i < A.bands.length; i++) {
    assert.equal(A.bands[i].month_min, A.bands[i - 1].month_max, A.bands[i].slug);
  }
});

test('每段都有手冊題目，警訊題只從 4 個月那段開始', () => {
  for (const b of A.bands) {
    assert.ok(b.items.length >= 5, b.slug);
    for (const x of b.items) assert.ok(x.text && !x.text.startsWith('※'), x.text);
  }
  assert.equal(A.bands[0].items.filter((x) => x.alert).length, 0);
  assert.equal(A.bands[1].items.filter((x) => x.alert).length, 0);
  assert.ok(A.bands.slice(2).every((b) => b.items.some((x) => x.alert)));
});

test('每段都對得到一次兒童預防保健，且預防保健 1–9 次各被用到', () => {
  const used = new Set();
  for (const b of A.bands) {
    const { prevent } = checksFor(b, tl);
    assert.ok(prevent.length >= 1, b.slug);
    for (const t of prevent) {
      const n = visitNo(t.title);
      assert.ok(A.prevent[String(n)], `第 ${n} 次沒有服務項目`);
      used.add(n);
    }
  }
  assert.deepEqual([...used].sort((a, b) => a - b), [1, 2, 3, 4, 5, 6, 7, 8, 9]);
});

test('左閉右開：4–6 個月那段不含從 6 個月開始的發展篩檢', () => {
  const b = A.bands.find((x) => x.slug === '4-6-months');
  assert.equal(checksFor(b, tl).screening.length, 0);
  assert.equal(overlaps(4, 6, 6, 10), false);
});

test('常見月數都找得到頁：6、7、8 個月 → 6-9-months；10、11 → 9-12-months；0 → 第一段', () => {
  for (const m of [6, 7, 8]) assert.equal(bandForMonth(A.bands, m).slug, '6-9-months');
  for (const m of [10, 11]) assert.equal(bandForMonth(A.bands, m).slug, '9-12-months');
  assert.equal(bandForMonth(A.bands, 3).slug, '2-4-months');
  assert.equal(bandForMonth(A.bands, 5).slug, '4-6-months');
  assert.equal(bandForMonth(A.bands, 0).slug, '0-2-months');
  assert.equal(bandForMonth(A.bands, 84), null);
});

test('國健署分齡量表：9 份、題目逐字（★ ○ 記號另存，內文沒有 PDF 私用字元）、每份都有對到的月齡頁', async () => {
  const { scalesFor, scaleCount } = await import('../src/lib/age.mjs');
  assert.equal(A.scales.length, 9);
  assert.equal(A.scales.reduce((n, s) => n + scaleCount(s), 0), 139);
  const marks = A.scales.flatMap((s) => s.domains.flatMap((d) => d.items.map((x) => x.mark)));
  assert.equal(marks.filter((m) => m === '★').length, 34);
  assert.equal(marks.filter((m) => m === '○').length, 9);
  // 內文不該留下記號或 PDF 的私用字元（U+E000–U+F8FF，量表用 Wingdings 印 ★ ○）
  const BAD = new RegExp(`[★○${String.fromCharCode(0xe000)}-${String.fromCharCode(0xf8ff)}]`);
  for (const s of A.scales) {
    assert.ok(s.domains.length >= 3, s.key);
    assert.match(s.file, /^https:\/\/www\.hpa\.gov\.tw\/Pages\/ashx\/GetFile\.ashx\?lang=c&type=2&sid=[0-9a-f]{32}$/);
    assert.ok(A.bands.some((b) => scalesFor(b, A.scales).includes(s)), `${s.key} 沒有對到任何頁`);
    for (const d of s.domains) {
      assert.deepEqual(d.items.map((x) => x.no), d.items.map((_, i) => i + 1), `${s.key} ${d.domain}`);
      for (const x of d.items) {
        assert.ok(x.text.length >= 5, `${s.key} ${d.domain} ${x.no}`);
        assert.doesNotMatch(x.text + x.note, BAD, `${s.key} ${d.domain} ${x.no}`);
        assert.ok(['', '★', '○'].includes(x.mark), `${s.key} ${d.domain} ${x.no}`);
        assert.equal(x.lines, undefined, '比對用的 lines 不該進站台資料');
      }
    }
  }
});

test('量表對到頁：6 個月以前沒有；12–18 個月、3–5 歲各對到兩份；其他各一份', async () => {
  const { scalesFor } = await import('../src/lib/age.mjs');
  const keys = (slug) => scalesFor(A.bands.find((b) => b.slug === slug), A.scales).map((s) => s.key);
  for (const slug of ['0-2-months', '2-4-months', '4-6-months']) assert.deepEqual(keys(slug), []);
  assert.deepEqual(keys('6-9-months'), ['6-9個月']);
  assert.deepEqual(keys('9-12-months'), ['9-12個月']);
  assert.deepEqual(keys('12-18-months'), ['12-15個月', '15-18個月']);
  assert.deepEqual(keys('18-24-months'), ['18-24個月']);
  assert.deepEqual(keys('2-3-years'), ['2-3歲']);
  assert.deepEqual(keys('3-5-years'), ['3-4歲', '4-5歲']);
  assert.deepEqual(keys('5-7-years'), ['5-7歲']);
});

test('量表出處：清單頁網址、更新日期、下載日期、授權聲明原文', () => {
  const S = A.sources.scales;
  assert.equal(S.url, 'https://www.hpa.gov.tw/Pages/List.aspx?nodeid=4821');
  assert.match(S.list_updated, /^\d{4}-\d{2}-\d{2}$/);
  assert.match(S.fetched, /^\d{4}-\d{2}-\d{2}$/);
  assert.equal(S.rights, '本量表之著作財產權屬於衛生福利部國民健康署，使用須經授權');
});

test('社家署線上檢核表題目：13 層 160 題、★ 67 題，題數與 2026-09-12 的紀錄相同，每層都有題目', () => {
  const S = A.sfaa;
  const prev = shared().materials['社家署線上兒童發展檢核表'];
  assert.equal(S.length, 13);
  assert.equal(S.reduce((n, s) => n + s.items.length, 0), 160);
  assert.equal(S.flatMap((s) => s.items).filter((x) => x.mark === '★').length, 67);
  const levels = tl.filter((t) => t.kind === '線上發展檢核表').map((t) => t.age_label);
  assert.equal(levels.length, 13, '社家署線上檢核表是 13 層');
  assert.deepEqual(levels.filter((l) => !S.some((s) => s.label === l)), [], '每層都有題目原文');
  assert.equal(A.sources.checklist.missing, undefined, '不再有未取得的年齡層');
  const s15 = S.find((s) => s.key === '15m');
  assert.equal(s15.label, '1歲3個月(1歲2個月16天~1歲5個月15天)');
  assert.equal(s15.items.length, 12);
  assert.equal(s15.items[0].text, '能不須扶束西自己站起來');
  assert.equal(s15.items[1].text, '可以放手自己走', '09-12 計數漏掉的第 2 題');
  for (const s of S) {
    assert.ok(levels.includes(s.label), s.label);
    assert.equal(prev[s.label].items, s.items.length, s.label);
    assert.equal(prev[s.label].alerts, s.items.filter((x) => x.mark === '★').length, s.label);
    assert.ok(s.month_min < s.month && s.month < s.month_max, s.label);
    assert.deepEqual(s.items.map((x) => x.no), s.items.map((_, i) => i + 1), s.label);
    for (const x of s.items) {
      assert.ok(x.text.length >= 5, `${s.key} ${x.no}`);
      assert.doesNotMatch(x.text + x.note, /[<>★]|&[a-z]+;/, `${s.key} ${x.no}`);
      assert.ok(['', '★'].includes(x.mark));
    }
  }
});

test('社家署檢核表題目每層只放一頁：依名目月齡落在哪個時段', async () => {
  const { sfaaFor } = await import('../src/lib/age.mjs');
  const keys = (slug) => sfaaFor(A.bands.find((b) => b.slug === slug), A.sfaa).map((s) => s.key);
  assert.deepEqual(keys('0-2-months'), []);
  assert.deepEqual(keys('2-4-months'), []);
  assert.deepEqual(keys('4-6-months'), ['4m']);
  assert.deepEqual(keys('6-9-months'), ['6m']);
  assert.deepEqual(keys('9-12-months'), ['9m']);
  assert.deepEqual(keys('12-18-months'), ['12m', '15m']);
  assert.deepEqual(keys('18-24-months'), ['18m']);
  assert.deepEqual(keys('2-3-years'), ['24m', '30m']);
  assert.deepEqual(keys('3-5-years'), ['36m', '42m', '48m']);
  assert.deepEqual(keys('5-7-years'), ['60m', '72m']);
  assert.equal(A.bands.flatMap((b) => sfaaFor(b, A.sfaa)).length, A.sfaa.length);
});

test('社家署檢核表出處：網址、表單端點、取得日期、頁尾版權原文', () => {
  const C = A.sources.checklist;
  assert.equal(C.url, 'https://system.sfaa.gov.tw/cecm/');
  assert.equal(C.form, 'https://system.sfaa.gov.tw/cecm/screenView/form');
  assert.match(C.fetched, /^\d{4}-\d{2}-\d{2}$/);
  assert.equal(C.rights, '©2015衛生福利部社會及家庭署 版權所有');
  assert.match(C.note, /社家署同意/);
});

test('社家署檢核表示意圖：200 張都有 WebP、寬高與檔案相符、單張與每頁位元組有上限', async () => {
  const fs = await import('node:fs');
  const { sfaaFor } = await import('../src/lib/age.mjs');
  const dir = new URL('../public/age/sfaa/', import.meta.url);
  const all = A.sfaa.flatMap((s) => s.items.flatMap((x) => x.imgs));
  assert.equal(all.length, 200);
  assert.equal(new Set(all.map((g) => g.file)).size, 200);
  assert.deepEqual(fs.readdirSync(dir).sort(), all.map((g) => g.file).sort(), 'public/age/sfaa/ 只放用到的圖');
  for (const s of A.sfaa) for (const x of s.items) assert.equal(x.imgs.length, x.figs, `${s.key} ${x.no}`);
  for (const g of all) {
    const buf = fs.readFileSync(new URL(g.file, dir));
    assert.equal(buf.toString('ascii', 8, 12), 'WEBP', g.file);
    // VP8 有損格式：寬高在 frame header（14 bit，存的就是實際像素數）
    assert.equal(buf.toString('ascii', 12, 16), 'VP8 ', g.file);
    assert.deepEqual([buf.readUInt16LE(26) & 0x3fff, buf.readUInt16LE(28) & 0x3fff], [g.w, g.h], g.file);
    assert.ok(buf.length <= 16 * 1024, `${g.file} ${buf.length} bytes`);
  }
  for (const b of A.bands) {
    const bytes = sfaaFor(b, A.sfaa).flatMap((s) => s.items.flatMap((x) => x.imgs))
      .reduce((n, g) => n + fs.statSync(new URL(g.file, dir)).size, 0);
    assert.ok(bytes <= 400 * 1024, `${b.slug} 示意圖共 ${bytes} bytes`);
  }
});
