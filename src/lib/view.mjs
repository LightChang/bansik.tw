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

// ── 縣市首頁「這個月齡該做的事」──────────────────────────────
// 建置期用預設月齡先輸出一次，瀏覽器載入後再依家長選的月齡重畫，兩邊共用這幾個函式。
// 不跑 JS 的爬蟲與 AI 工具原本只看到空的 #track／#now，標題問的答案整段不在 HTML 裡。
// data 的欄位：county、timeline、ear、earConfirm、pre、after（見 [county]/index.astro 的 payload）。

/** 預設月齡：沒有網址參數、也沒有記住的月齡時用這個 */
export const DEFAULT_AGE = 27;

/** 月齡軸：六次發展篩檢，標出已過、現在、還沒到 */
export function trackHtml(timeline, age) {
  return screenings(timeline).map((t, i) => {
    const cls = inBand(t, age) ? 'current' : (age >= num(t.month_max) ? 'done' : '');
    return `<div class="stop ${cls}"><b>第 ${i + 1} 次</b>${esc(t.age_label)}</div>`;
  }).join('');
}

// 0–5 個月大：發展篩檢還沒開始，但這個階段最焦慮的家長不該只看到「等 6 個月再說」。
function newbornNote(data, m) {
  const first = data.timeline.filter((t) => t.kind === '兒童預防保健')
    .sort((a, b) => num(a.month_min) - num(b.month_min))[0];
  const bits = [];
  if (first) {
    const done = m >= num(first.month_max);
    bits.push(`<span class="recap-item"><b>${done ? '應該已經做過' : '現在這一項'}</b>
      ${esc(first.title)}（${esc(first.age_label)}）</span>`);
  }
  if (data.ear) {
    bits.push(`<span class="recap-item"><b>出生後就該做</b>新生兒聽力篩檢，
      ${esc(data.county)}有 ${data.ear} 家篩檢院所${
        data.earConfirm ? `、${data.earConfirm} 家確診醫院` : ''}</span>`);
  }
  if (!bits.length) return '';
  return `<div class="recap">${bits.join('')}</div>
    <p class="handover">發展篩檢從滿 6 個月才開始，但這段期間不是沒事做——
      <b>聽力問題越早發現，越不會拖到語言發展</b>。這兩項都在兒童健康手冊裡。</p>`;
}

function handoverNote(data) {
  if (!data.pre) return '';
  return `<p class="handover"><b>入學後「發展遲緩」這個身分會消失</b>——全國學前有
    <span class="num">${data.pre.toLocaleString()}</span> 名發展遲緩學生，國小一年級以後是
    <span class="num">${data.after}</span> 人。這不是人不見了，是這個類別只用在學前；
    要繼續拿到特教資源，得在入學前的鑑定改判其他障別。
    <span class="src">教育部特殊教育通報統計</span></p>`;
}

/** 「現在就是這一次」那一張：這個月齡落在第幾次篩檢、同期還有什麼、檢核表在哪 */
export function nowHtml(data, age) {
  const SCREENS = screenings(data.timeline);
  const current = SCREENS.find((t) => inBand(t, age));
  const next = SCREENS.find((t) => num(t.month_min) > age);
  const idx = current ? SCREENS.indexOf(current) + 1 : (next ? SCREENS.indexOf(next) + 1 : null);
  const check = data.timeline.find((t) => t.kind === '線上發展檢核表' && inBand(t, age));
  const others = data.timeline.filter((t) => inBand(t, age)
    && ['兒童預防保健', '家長紀錄事項', '學前特教安置'].includes(t.kind));

  let head;
  if (current) {
    head = `<div class="eyebrow">現在就是這一次</div>
      <h2>第 ${idx} 次兒童發展篩檢</h2>
      <p class="when">${esc(current.age_label)}，由專科醫師就粗大動作、精細動作、
        語言認知、社會發展四面向檢查。</p>`;
  } else if (next) {
    head = `<div class="eyebrow">這個月齡還沒有排定的發展篩檢</div>
      <h2>下一次是第 ${idx} 次</h2>
      <p class="when">${esc(next.age_label)}　在那之前仍可以自己觀察與紀錄。</p>
      ${newbornNote(data, age)}`;
  } else {
    head = `<div class="eyebrow">已滿 7 歲，超過早期療育的年齡範圍</div>
      <h2>六次兒童發展篩檢到這裡結束</h2>
      <p class="when">早期療育的對象是「未滿 7 歲」，滿 7 歲後由學校的特教系統接手。
        但<b>漏做的篩檢不會自動補</b>——下面是六次的年齡區間，可以回頭對一次。</p>
      <div class="recap">${SCREENS.map((t, i) =>
        `<span class="recap-item"><b>第 ${i + 1} 次</b>${esc(t.age_label)}</span>`).join('')}</div>
      ${handoverNote(data)}`;
  }

  const action = check
    ? `<div class="action"><span class="tag">先自己做</span>
        <span><a href="${esc(check.url)}" target="_blank" rel="noopener">${esc(check.title)}</a></span>
        <span>${esc(check.detail).replace(/(\d+ 題為警訊題)/, '<span class="warn">$1</span>')}</span></div>`
    : '';
  const also = others.length
    ? `<p class="also">同一時期還有：${others.map((o) =>
        '<b>' + esc(o.title.replace(/兒童健康手冊「|」/g, '')) + '</b>').join('、')}</p>`
    : '';
  return head + action + also;
}
