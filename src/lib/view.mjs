// 建置期與瀏覽器都會用到的純函式。這裡不可以 import node:fs 之類的東西——
// 這個檔會被打包進瀏覽器的 bundle，讀檔的部分放在 data.mjs。

/** CSV 讀進來全是字串，空字串要當成「沒有值」而不是 0 */
export const num = (v) => (v === '' || v == null ? null : Number(v));

/**
 * 月齡是否落在這個項目的區間裡。左閉右開：age >= min && age < max。
 *
 * 兩端都曾經因為這個判斷式而落空過：所有 timeline 的 month_max 最大是 84，
 * 滑桿最大值也是 84，所以拉到底必然一筆都不中；另一端最早的項目 month_min
 * 是 0.5（出生後 2 週），所以 0 個月大也是一筆都不中。頁面要自己處理這兩端，
 * 不能假設隨便一個月齡都至少命中一筆。
 */
export const inBand = (t, age) => age >= num(t.month_min) && age < num(t.month_max);

/** 六次兒童發展篩檢，依月齡排序 */
export const screenings = (timeline) =>
  timeline.filter((t) => t.kind === '兒童發展篩檢')
    .sort((a, b) => num(a.month_min) - num(b.month_min));

/** 窄螢幕省掉括號裡的歲數換算，不然控制列在 390px 會被撐破 */
export function ageText(m, narrow) {
  if (m < 12 || narrow) return '個月大';
  const y = Math.floor(m / 12);
  const r = m % 12;
  return `個月大（${y} 歲${r ? ` ${r} 個月` : ''}）`;
}

/** 只給瀏覽器端組 innerHTML 用；Astro 模板裡的 {expr} 本來就會自動跳脫 */
export const esc = (s) =>
  String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

const OBS_LABEL = {
  clinic_hours: '門診',
  booking_method: '預約',
  booking_tel: '分機',
};

/**
 * 動態資訊（各縣市衛生局頁解析出來的門診時間、預約方式、分機）組成一行字。
 * 機構全表與類型／行政區頁共用，在建置期就組好，瀏覽器不必再帶一份 observation。
 */
export function obsLine(observations, key, tel) {
  const list = observations.filter((o) => o.entity_key === key);
  const parts = [];
  for (const f of ['clinic_hours', 'booking_method', 'booking_tel']) {
    const hit = list.find((o) => o.field === f);
    if (!hit) continue;
    // 電話別重複顯示：entity 存「(04)3604-5483」、衛生局頁存「04-36045483」，
    // 格式不同、字串比不出來，要比數字。但「分機12130(初評)」這種帶標註的要留著。
    // 「分機」兩個字本身不算資訊，先拿掉再判斷。
    if (f === 'booking_tel' && tel) {
      const extra = hit.value.replace(/分機/g, '');
      if (!/[一-鿿]/.test(extra) && extra.replace(/\D/g, '') === tel.replace(/\D/g, '')) continue;
    }
    parts.push(`${OBS_LABEL[f]}：${hit.value}`);
  }
  return parts.join('　');
}
