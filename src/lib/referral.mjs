// 通報轉介中心與個案管理中心是「依行政區分工」的：臺中 8 處各管幾個區，臺北 1 處通報轉介加 6 處分區個管。
// 以前各頁一律拿名錄第一筆（或「地址在同一區」的那一筆），北屯區的家長看到的是只管中區、西區、西屯區的第一區中心。
// 這裡改用社家署名錄每一筆的「服務區域」欄（entity.sfaa[].area）決定誰管哪一區。
// 名錄沒寫到的區不猜：退回全縣市都收的那一處；連那一處都沒有，就只列全部，讓家長自己對。
// 純函式，不讀檔，建置期與瀏覽器都可以 import。

const norm = (s) => String(s || '').replace(/台/g, '臺').replace(/\(.*?\)|（.*?）/g, '').trim();

/** 一筆通報／個管單位的服務區域：wide＝全縣市，list＝名錄寫出的區名 */
export function areasOf(e) {
  const list = new Set();
  let wide = false;
  for (const s of e.sfaa || []) {
    for (const raw of String(s.area || '').split(/[,，、]/)) {
      const a = norm(raw);
      if (!a) continue;
      if (/^全|全區$/.test(a)) wide = true;
      else list.add(a);
    }
  }
  return { wide, list: [...list] };
}

const isIntake = (e) => e.cat === '通報轉介中心';

/** 縣市內全部通報轉介／個管單位，附服務區域；通報轉介中心排前面，全縣市的再排前面 */
export function referralsOf(c) {
  const towns = new Set((c.towns || []).map(norm));
  return c.entities
    .filter((e) => e.journey_step === '2')
    .map((e) => {
      const { wide, list } = areasOf(e);
      // 名錄逐區寫滿全縣市所有區的，也算全縣市（桃園市通報轉介中心列了 13 區）
      const all = wide || (towns.size > 0 && [...towns].every((t) => list.includes(t)));
      return { e, wide: all, areas: list };
    })
    .sort((a, b) => (isIntake(b.e) - isIntake(a.e)) || (b.wide - a.wide)
      || a.e.name.localeCompare(b.e.name, 'zh-Hant'));
}

/** 「負責哪些區」給人看的寫法 */
export const areaText = (r) => (r.wide ? '全縣市' : r.areas.join('、') || '名錄未寫');

/**
 * 全縣市只要打一支的情況下回傳那一處；要看住哪一區才知道打哪支，回傳 null。
 * 新竹市兩處都寫三個區，任一處都對，取第一處。
 */
export function firstCall(c) {
  const refs = referralsOf(c);
  if (!refs.length) return null;
  const intakes = refs.filter((r) => isIntake(r.e));
  const pool = intakes.length ? intakes : refs;
  const wide = pool.find((r) => r.wide);
  if (wide) return wide;
  return pool.length === 1 ? pool[0] : null;
}

/**
 * 住在 district 的家長該打哪支：intake 是通報轉介（第一通電話），
 * caseMgr 是負責這一區的個案管理中心（通報後跟著孩子的那一處）。
 * 名錄沒寫到這一區時 intake 退回全縣市那一處，matched=false。
 */
export function referralFor(c, district) {
  const refs = referralsOf(c);
  const d = norm(district);
  const covers = (r) => r.wide || (d && r.areas.includes(d));
  const intakes = refs.filter((r) => isIntake(r.e));
  let intake = intakes.filter((r) => !r.wide && covers(r));
  if (!intake.length) intake = intakes.filter((r) => r.wide);
  if (!intake.length) intake = refs.filter(covers);
  const caseMgr = refs.filter((r) => !isIntake(r.e) && !r.wide && covers(r));
  const matched = intake.some((r) => r.areas.includes(d)) || caseMgr.length > 0
    || intake.some((r) => r.wide);
  return { intake: intake.slice(0, 1), caseMgr: caseMgr.slice(0, 1), matched, all: refs };
}

/**
 * 名額公告：醫院每月公告「下個月門診名額幾號開放」。舊寫法取最早那一筆，
 * 結果首頁寫「下次開放名額 2026-10-22」，但那天早就過了、後面還有 11-19 那一筆。
 * 改取日期最新的一筆，連同醫院原文的月份說明一起顯示，不自己寫「下次」。
 */
export function latestQuota(observations, key) {
  const hit = observations
    .filter((o) => o.entity_key === key && o.field === 'quota_release_date')
    .sort((a, b) => (a.value < b.value ? 1 : -1))[0];
  if (!hit) return null;
  const what = String(hit.note || '').replace(/開放日$/, '') || '門診名額';
  return { date: hit.value, what, text: `${what}開放日 ${hit.value}` };
}
