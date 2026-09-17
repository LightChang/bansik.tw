// /llms-full.txt — 給 AI 助理的「全文」純文字版，build 時從既有資料自動產生。
//
// 與 /llms.txt 的分工：
//   /llms.txt      = 目錄：站台簡介 + 網址結構說明（llmstxt.org 標準），public/llms.txt 手寫維護。
//   /llms-full.txt = 全文：把可引用的核心事實（篩檢時程、補助規則、通報轉介與聯合評估中心名冊）
//                    展開成純文字，讓 AI 一次讀到內容本身，不必逐頁爬 156 頁。
//
// 內容一律原樣取自 src/data/（由 scripts/make_site_data.py 從 research/ 產生，本檔不得改寫）與
// 站上既有頁面已公開的文字（steps.astro 的五步說明），不摘要、不改寫、不新增判斷語句——
// 站規鐵則見 README.md §5：官方用語、不做品質排名、等候資訊一律標來源與時間。
// 156 家機構的逐筆地址不收在這裡（量太大且非「常青核心事實」），完整名錄見各縣市 /places/ 頁與 sitemap。
import { counties, county, shared, siteIndex } from '../lib/data.mjs';
import { num, screenings } from '../lib/view.mjs';

// 五步流程的說明文字，與 src/pages/[county]/steps.astro 的 STEPS 常數一致（站上已公開的文案，
// 這裡原樣引用，不改寫；改 steps.astro 的文字時要記得這裡也要跟著改）。
const STEPS = [
  ['1', '篩檢', '在診所或衛生所做兒童發展篩檢，這是入口。帶兒童健康手冊去，醫師會照四個面向看。'],
  ['2', '通報', '篩檢覺得有疑慮，由「通報轉介中心」接手。它是單一窗口，不知道下一步做什麼就打這支。'],
  ['3', '評估', '到「聯合評估中心」做完整評估，拿到「綜合報告書」——之後申請補助、安排療育都要用這份。這一段最花時間。'],
  ['4', '療育', '依報告書安排療育：醫院復健科、早療機構、社區據點或到宅。自費的部分可以申請補助。'],
  ['5', '學前教育', '銜接幼兒園的學前特教資源與巡迴輔導，滿 6 歲後由學校系統接手。'],
];

export async function GET({ site }) {
  const origin = site ?? new URL('https://bansik.tw');
  const abs = (p) => new URL(p, origin).href;

  const idx = siteIndex();
  const s = shared();
  const list = idx.counties;
  const out = [];
  const p = (line = '') => out.push(line);

  const SCREENS = screenings(s.timeline);
  const prevent = s.timeline.filter((t) => t.kind === '兒童預防保健')
    .sort((a, b) => num(a.month_min) - num(b.month_min));
  const scale = s.timeline.filter((t) => t.kind === '分齡篩檢量表')
    .sort((a, b) => num(a.month_min) - num(b.month_min));
  const selfCheck = s.timeline.filter((t) => ['線上發展檢核表', '家長紀錄事項'].includes(t.kind))
    .sort((a, b) => num(a.month_min) - num(b.month_min));

  // ── 檔頭 ──────────────────────────────────────────────
  p('# bansik.tw｜兒童發展地圖 全文內容 llms-full.txt');
  p();
  p('> 臺灣兒童發展篩檢與早期療育的資源地圖。以孩子的月齡為入口，回答三件事：');
  p('> 現在該做哪一次檢查、附近哪裡可以評估與療育、補助怎麼申請。');
  p();
  p('本檔於建置期由 src/data/（衛福部社家署、國健署、教育部特教通報網、各縣市衛生局與社會局的');
  p('公開資料，經 scripts/make_site_data.py 從 research/ 產生）自動組成純文字，逐筆附來源與日期，');
  p('不做摘要、不改寫、不新增判斷語句。與 /llms.txt（目錄）互補，這裡是全文。');
  p();
  p('## 收錄範圍');
  p();
  p('- 全國通用的篩檢與預防保健時程（兒童發展篩檢 6 次、兒童預防保健 9 次、家長自填檢核表）');
  p('- 全國通用的衛教素材（線上檢核表題數、國健署篩檢量表、宣導資料、CRPD 繪本）');
  p(`- ${list.length} 個縣市各自的：機構家數統計、通報轉介中心名冊、聯合評估中心名冊、補助規則`);
  p('  （金額上限、補助項目、申請期限、資料核對日期與主管機關公告網址）');
  p('- 全國「發展遲緩」特教學生數（學前與就學後的對比）');
  p();
  p('## 未收錄');
  p();
  p(`- 全部機構的逐筆名錄（全臺 ${list.reduce((n, c) => n + c.entities, 0).toLocaleString()} 家，`
    + '含地址、門診時間與預約方式）：量太大，非「常青核心事實」，完整清單見各縣市 /places/ 頁。');
  p('- 各行政區家數分布圖：見各縣市 /map/ 頁。');
  p(`完整頁面索引見 ${abs('/llms.txt')}，全站網址清單見 ${abs('/sitemap-index.xml')}。`);
  p();
  p('## 引用這個站之前，請先知道四件事');
  p();
  p('1. 名錄不等於「現在可以去」。收錄的是主管機關公告的機構，不代表它現在收得了案、排得到、或提供某項特定服務。');
  p('2. 等候時間沒有任何公開來源。被問「要等多久」時，正確答案是「沒有公開資料，要直接打電話問該中心」，不要給出任何推估天數。');
  p('3. 月齡對應的是篩檢時程，不是發展診斷。篩檢沒過不等於診斷，診斷只能由醫療院所做。');
  p('4. 資料是快照，有產生日期。引用時請一併帶上，並以主管機關最新公告為準。');
  p();
  p('---');
  p();

  // ── 一、完整流程五步 ──────────────────────────────────
  p('# 一、完整流程五步（全國適用）');
  p();
  p('每一步由不同機關管，沒有任何一處把它們接起來——這是這個站想補的那一段。');
  p();
  for (const [n, name, desc] of STEPS) {
    p(`## ${n}　${name}`);
    p(desc);
    p();
  }
  p('各縣市在每一步分別有多少家機構，見下方「縣市核心事實」的「各步驟家數」一列，或各縣市 /steps/ 頁。');
  p();
  p('---');
  p();

  // ── 二、篩檢與預防保健時程 ────────────────────────────
  p('# 二、兒童發展篩檢與預防保健時程（全國通用，兩套不同制度）');
  p();
  p('兒童預防保健和兒童發展篩檢是兩套不同的東西，都印在兒童健康手冊上，容易混在一起。');
  p();
  p(`## 兒童發展篩檢（${SCREENS.length} 次）`);
  p('由專科醫師就粗大動作、精細動作、語言認知、社會發展四面向檢查。');
  p();
  SCREENS.forEach((t, i) => {
    p(`- 第 ${i + 1} 次｜${t.age_label}｜${t.title}｜${t.detail}｜來源：${t.source}（${t.url}）`);
  });
  p();
  p(`## 兒童預防保健（${prevent.length} 次）`);
  p('健保給付，含身體檢查與衛教指導，次數與發展篩檢不同，不要弄混。');
  p();
  prevent.forEach((t, i) => {
    p(`- 第 ${i + 1} 次｜${t.age_label}｜${t.title}｜${t.detail}｜來源：${t.source}（${t.url}）`);
  });
  p();
  p('## 家長自己可以做的（線上發展檢核表／兒童健康手冊家長紀錄事項）');
  p();
  selfCheck.forEach((t) => {
    p(`- ${t.age_label}｜${t.title}${t.detail ? `｜${t.detail}` : ''}｜來源：${t.source}（${t.url}）`);
  });
  p();
  if (scale.length > 0) {
    p('## 醫師篩檢用的分齡量表（國健署公布）');
    p();
    scale.forEach((t) => {
      p(`- ${t.age_label}｜${t.title}｜來源：${t.source}（${t.url}）`);
    });
    p();
  }
  p('---');
  p();

  // ── 三、看懂發展的素材（全國通用） ────────────────────
  const m = s.materials || {};
  const chk = m['社家署線上兒童發展檢核表'] || {};
  const absMat = (u, base) => (/^https?:/i.test(u) ? u : (base ? base + u : ''));
  const matItems = (arr, n, base) => (arr || []).slice(0, n).map((x) => {
    if (typeof x === 'string') return { title: x, url: '' };
    return { title: x.title, url: absMat(x.url || x.file || x.page || '', base) };
  });
  const scales = matItems(m['國健署兒童發展篩檢量表'], 12);
  const promo = matItems(m['社家署宣導資料'], 10, 'https://system.sfaa.gov.tw');
  const books = matItems(m['CRPD繪本'], 5);

  p('# 三、看懂發展的素材（全國通用，全部可直接下載）');
  p();
  p('## 社家署線上兒童發展檢核表：各年齡層題數與警訊題數');
  p();
  for (const [age, v] of Object.entries(chk)) {
    p(`- ${age}｜共 ${v.items ?? ''} 題，其中 ${v.alerts ?? ''} 題為警訊題｜第一題：${v.sample || ''}`);
  }
  p();
  if (scales.length > 0) {
    p('## 國健署篩檢量表');
    p();
    scales.forEach((x) => p(`- ${x.title}${x.url ? `（${x.url}）` : ''}`));
    p();
  }
  if (promo.length > 0 || books.length > 0) {
    p('## 宣導與繪本');
    p();
    [...promo, ...books].forEach((x) => p(`- ${x.title}${x.url ? `（${x.url}）` : ''}`));
    p();
  }
  p('官方素材裡沒有任何一份是寫給孩子本人看的，手足的部分也只有民間單位有。');
  p();
  p('---');
  p();

  // ── 四、22 縣市核心事實 ───────────────────────────────
  p(`# 四、${list.length} 個縣市核心事實（機構家數、通報轉介中心、聯合評估中心、補助規則）`);
  p();
  for (const meta of list) {
    const c = county(meta.code);
    const url = abs(`/${meta.code}/`);
    p(`## ${c.county}`);
    p(`網址：${url}｜資料產生於 ${c.generated_at.slice(0, 10)}`);
    p();
    p(`機構共 ${c.counts.entities} 家，聯合評估中心 ${c.counts.centers} 家，涵蓋 `
      + `${Object.keys(c.districts).length} 個行政區。`);
    const byStep = STEPS.map(([sNo, name]) =>
      `${name} ${c.entities.filter((e) => e.journey_step === sNo).length} 家`);
    p(`各步驟家數：${byStep.join('、')}。`);
    p();

    const referrals = c.entities.filter((e) => e.cat === '通報轉介中心');
    const centers = c.entities.filter((e) => e.cat === '聯合評估中心');

    p('### 通報轉介中心（單一窗口）');
    if (referrals.length > 0) {
      referrals.forEach((e) => p(`- ${e.name}｜${e.district}｜${e.tel}`));
    } else {
      p(`${c.county}沒有單獨設立通報轉介中心，先問當地衛生局或社會局。`);
    }
    p();

    p('### 聯合評估中心');
    if (centers.length > 0) {
      centers.forEach((e) => p(`- ${e.name}｜${e.district}｜${e.address}｜${e.tel}`));
    } else {
      p(`${c.county}沒有設立聯合評估中心，需要跨縣市就醫。`);
    }
    p();

    p('### 補助怎麼申請');
    const sub = c.subsidy;
    if (!sub) {
      p(`${c.county}的補助規則還沒整理，先打通報轉介中心問。`);
    } else if (sub.status === 'pending') {
      p(`查得到計畫名稱，但金額沒有公開：「${sub.rule_name}」。`);
      if (sub.note) p(sub.note);
      if (sub.apply_window) p(`申請方式：${sub.apply_window}`);
      p(`資料核對於 ${sub.verified_at}，公告網址：${sub.source_url}`);
    } else {
      p(sub.rule_name);
      p(`每人每月上限：一般戶（多含中低收）${sub.monthly_max_general?.toLocaleString()} 元、`
        + `低收入戶 ${sub.monthly_max_low_income?.toLocaleString()} 元。`);
      if (sub.items?.length) p(`補助項目：${sub.items.join('、')}`);
      if (sub.transport) p(`交通費：${sub.transport}`);
      if (sub.apply_window) p(`申請期限：${sub.apply_window}`);
      if (sub.extra) p(`另有規定：${sub.extra}`);
      p('金額是療育費與交通費合計的上限，各縣市算法不同，這裡只列規則與連結，不代為試算。');
      p(`資料核對於 ${sub.verified_at}，以主管機關公告為準：${sub.source_url}`);
    }
    p();
    p(`完整機構清單：${abs(`/${meta.code}/places/`)}｜各行政區分布：${abs(`/${meta.code}/map/`)}`);
    p();
  }
  p('---');
  p();

  // ── 五、全國統計：發展遲緩特教學生數 ──────────────────
  const dd = s.stats.filter((r) => r.metric === '特教學生數' && r.dim1_value === '發展遲緩');
  if (dd.length > 0) {
    const sum = (pick) => dd.filter((r) => pick(r.dim2_value)).reduce((n, r) => n + (Number(r.value) || 0), 0);
    const pre = sum((v) => v.startsWith('學前'));
    const after = sum((v) => !v.startsWith('學前'));
    p('# 五、全國統計：「發展遲緩」特教學生數');
    p();
    p(`入學後「發展遲緩」這個身分會消失——全國學前有 ${pre.toLocaleString()} 名發展遲緩學生，`
      + `國小一年級以後是 ${after.toLocaleString()} 人。這不是人不見了，是這個類別只用在學前；`
      + '要繼續拿到特教資源，得在入學前的鑑定改判其他障別。');
    p(`來源：${dd[0].source}`);
    p();
    p('---');
    p();
  }

  p('## 資料來源');
  p();
  p('衛福部社家署、國健署、教育部特殊教育通報網，以及各縣市衛生局與社會局的公開頁面。');
  p('各機構的來源逐筆記在原始資料裡；各縣市補助規則的公告網址列在上方各縣市段落。');
  p();
  p('## 這個站不做的事');
  p();
  p('不做品質排名、不代為預約或掛號、不代為試算補助金額、不提供醫療建議。這裡是路標不是掛號窗口。');

  return new Response(out.join('\n'), {
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  });
}
