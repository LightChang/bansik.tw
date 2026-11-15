import { test } from 'node:test';
import assert from 'node:assert/strict';
import { contentHash } from '../src/lib/lastmod.mjs';

const page = (date, extra = '') =>
  `<head>x</head><main><table><caption>臺北市的名錄。資料產生於 ${date}。</caption><tr><td>甲診所${extra}</td></tr></table>` +
  `<footer>資料產生於 ${date}。</footer></main>`;

test('只有「資料產生於」日期變了，雜湊不變', () => {
  assert.equal(contentHash(page('2026-11-08')), contentHash(page('2026-11-15')));
});

test('名單內容真的變了，雜湊要變', () => {
  assert.notEqual(contentHash(page('2026-11-15')), contentHash(page('2026-11-15', '、乙診所')));
});

test('頁尾（site-ft）改了，雜湊不變', () => {
  const a = '<main><p>名單</p><footer class="site-ft"><a href="/">首頁</a></footer></main>';
  const b = '<main><p>名單</p><footer class="site-ft"><a href="/">首頁</a><a href="/about/">關於本站</a></footer></main>';
  assert.equal(contentHash(a), contentHash(b));
});
