// 機構改名轉址：前後兩版比對、轉址表合併、建置時接到底
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { matchRenames, mergeRedirects, redirectPages, telKey } from '../src/lib/placeredirects.mjs';
import { counties, placeRedirectsFor } from '../src/lib/data.mjs';

const v = (slug, address = '', tel = '', hosp_id = '') => ({ slug, name: slug, address, tel, hosp_id });

test('telKey：只取第一支號碼的數字', () => {
  assert.equal(telKey('07-7497717、7497921'), '077497717');
  assert.equal(telKey('04-8960271分機249、142'), '048960271');
});

test('matchRenames：entity_key、健保代碼、地址電話三種證據，配不到的列 gone', () => {
  const prev = { k: {
    a: v('甲診所'),
    b: v('乙中心(日間、時段)', '高雄市苓雅區義勇路149號', '07-7497717'),
    c: v('丙醫院', 'x路1號', '02-1', '0123456789'),
    d: v('丁幼兒園(時段)', '某路2號', '06-9'),
    e: v('戊據點', '同一棟1號', '03-1'),
    f: v('己據點', '同一棟1號', '03-1'),
  } };
  const next = { k: {
    a: v('甲小兒科診所'),
    b2: v('乙中心(日間)', '高雄市苓雅區義勇路149號', '07-7497717、7497921'),
    c2: v('丙醫院新院區', 'y路9號', '02-2', '0123456789'),
    e2: v('戊據點新', '同一棟1號', '03-1'),
    f2: v('己據點新', '同一棟1號', '03-1'),
  } };
  const { renames, gone } = matchRenames(prev, next);
  const m = Object.fromEntries(renames.map((r) => [r.from, r.to]));
  assert.equal(m['甲診所'], '甲小兒科診所');
  assert.equal(m['乙中心(日間、時段)'], '乙中心(日間)');
  assert.equal(m['丙醫院'], '丙醫院新院區');
  // 同址同電話兩筆以上不配（共用總機），寧可不轉也不轉錯
  assert.deepEqual(gone.map((g) => g.slug).sort(), ['丁幼兒園(時段)', '己據點', '戊據點'].sort());
});

test('matchRenames：只差在 NFC 的不算改名', () => {
  const { renames } = matchRenames({ k: { a: v('樂生') } }, { k: { a: v('樂生') } });
  assert.equal(renames.length, 0);
});

test('mergeRedirects＋redirectPages：一路接到底、舊網址又有頁面時頁面優先、接不到的 dropped', () => {
  const t = [];
  mergeRedirects(t, [{ county: 'k', from: 'A', to: 'B' }], '2026-09-01');
  mergeRedirects(t, [{ county: 'k', from: 'B', to: 'C' }, { county: 'k', from: 'X', to: 'Y' }], '2026-10-01');
  assert.equal(mergeRedirects(t, [{ county: 'k', from: 'A', to: 'B' }], '2026-10-02'), 0);
  const live = new Map([['C', '丙'], ['X', '又回來了']]);
  const { pages, dropped } = redirectPages(t, 'k', live);
  assert.deepEqual(pages.map((p) => [p.from, p.to]).sort(), [['A', 'C'], ['B', 'C']]);
  assert.equal(dropped.length, 0);
  const r2 = redirectPages([{ county: 'k', from: 'P', to: 'Q' }], 'k', new Map());
  assert.equal(r2.pages.length, 0);
  assert.equal(r2.dropped[0].from, 'P');
});

// 轉不過去的列只在建置時逐筆警告、不擋部署（一筆壞掉不該讓整週資料上不了線），
// 這裡只釘住已知案例：2026-09-29 名錄把「(日間、時段)」改成「(日間)」，舊網址曾 404
test('已知改名案例：高雄聖淵啟仁中心的舊網址轉到新網址', () => {
  assert.ok(counties().some((c) => c.code === 'kaohsiung'));
  const { pages } = placeRedirectsFor('kaohsiung');
  const r = pages.find((p) => p.from === '財團法人高雄市私立聖淵啟仁中心(身心障礙福利機構)(日間、時段)');
  assert.ok(r, '轉址表少了已知案例');
  assert.equal(r.to, '財團法人高雄市私立聖淵啟仁中心(身心障礙福利機構)(日間)');
});
