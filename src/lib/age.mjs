// 月齡頁（/age/…）的純函式：把手冊的月齡時段對到 shared.json timeline 裡的各項檢查。
// 不讀檔，讀檔在 data.mjs（ageData、shared）。測試見 test/age.test.mjs。
import { num } from './view.mjs';

/** 月齡區間是否重疊（左閉右開，跟站上其他月齡判斷同一套） */
export const overlaps = (aMin, aMax, bMin, bMax) => aMin < bMax && bMin < aMax;

/**
 * 某個時段會碰到的檢查：兒童預防保健、兒童發展篩檢、分齡量表、社家署線上檢核表。
 * 一律從 timeline 依月齡重疊算出來，不在頁面上另寫一份時程。
 * @param {{ month_min: number, month_max: number }} band
 * @param {any[]} timeline shared.json 的 timeline
 */
export function checksFor(band, timeline) {
  const hit = (kind) => timeline
    .filter((t) => t.kind === kind
      && overlaps(band.month_min, band.month_max, num(t.month_min), num(t.month_max)))
    .sort((a, b) => num(a.month_min) - num(b.month_min));
  return {
    prevent: hit('兒童預防保健'),
    screening: hit('兒童發展篩檢'),
    scales: hit('分齡篩檢量表'),
    checklists: hit('線上發展檢核表'),
  };
}

/** 「兒童預防保健第4次」→ 4 */
export const visitNo = (title) => Number((String(title).match(/第(\d+)次/) || [])[1]) || null;

/** 月數 → 該看哪一頁（取第一個涵蓋它的時段；0 個月歸第一段） */
export function bandForMonth(bands, m) {
  return bands.find((b) => m >= b.month_min && m < b.month_max)
    || (m < bands[0].month_min ? bands[0] : null);
}

export const ageUrl = (slug) => `/age/${slug}/`;
