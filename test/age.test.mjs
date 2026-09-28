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
