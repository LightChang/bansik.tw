// 各縣市早療補助資料（research/scripts/subsidies.json → src/data/counties/*.json 的 subsidy）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { counties, county } from '../src/lib/data.mjs';

const raw = JSON.parse(readFileSync(new URL('../research/scripts/subsidies.json', import.meta.url), 'utf8')).counties;

test('22 縣市都有讀過官方原文的補助規則，站台資料與 subsidies.json 一致', () => {
  assert.equal(raw.length, 22);
  for (const { code, name } of counties()) {
    const s = county(code).subsidy;
    assert.ok(s, name);
    assert.equal(s.status, 'verified', name);
    assert.match(s.verified_at, /^\d{4}-\d{2}-\d{2}$/, name);
    assert.match(s.source_url, /^https?:\/\//, name);
    assert.ok(Number.isInteger(s.monthly_max_general) && Number.isInteger(s.monthly_max_low_income), name);
    assert.deepEqual(s, raw.find((x) => x.county === name), `${name}：src/data 與 subsidies.json 不同步`);
  }
});

test('澎湖：115-05-19 修訂計畫，療育費上限 6,000／8,000、交通費分開計，存檔是 tw8 代抓的 PDF', () => {
  const s = raw.find((x) => x.county === '澎湖縣');
  assert.match(s.rule_name, /115 年 5 月 19 日/);
  assert.equal(s.monthly_max_general, 6000);
  assert.equal(s.monthly_max_low_income, 8000);
  assert.match(s.transport, /^與療育費分開計算/);
  assert.equal(s.apply_window, '自就診日起三個月內');
  assert.equal(s.archived, 'research/archive/tw8-2026-09-28/penghu/202605191143110.pdf');
});

test('宜蘭：115 年計畫，出處是社會處頁，金額 4,000／6,000，交通費照原文級距', () => {
  const s = raw.find((x) => x.county === '宜蘭縣');
  assert.equal(s.source_url, 'https://sntroot.e-land.gov.tw/cp.aspx?n=10389');
  assert.equal(s.monthly_max_general, 4000);
  assert.equal(s.monthly_max_low_income, 6000);
  assert.match(s.transport, /1,000 元.*2,000 元.*2,500 元/);
  assert.match(s.file_url, /Download\.ashx\?u=.+&n=/);
  assert.match(s.providers_list.url, /Download\.ashx\?u=.+&n=/);
});
