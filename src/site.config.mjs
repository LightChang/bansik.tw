// 站台層級的外部服務設定。
//
// 這些值本來就會出現在每一頁的原始碼裡，不是機密，所以可以直接寫死在這裡。
// 但 CI 用環境變數覆蓋更好改——換 GA 帳號不必動程式碼。
// GitHub Actions 從 repository variables 帶進來（vars，不是 secrets）。

/**
 * GA4 評估 ID。要關掉 GA 就把這裡的預設值改成空字串。
 *
 * 用 `||` 不用 `??`：workflow 寫的是 `BANSIK_GA_ID: ${{ vars.BANSIK_GA_ID }}`，
 * repository variable 沒設時 CI 拿到的是空字串而不是 undefined，`??` 會把空字串
 * 當成有值，整站就沒有 GA——上線第一天就是這樣漏掉的。
 */
export const GA_MEASUREMENT_ID = process.env.BANSIK_GA_ID || 'G-L05CG61N7H';

/**
 * 只有在這些主機名底下才真的載入 GA。
 *
 * ID 寫死在程式裡，代價是 `npm run dev`、本機 `npm run build`、以及任何 fork
 * 出去的部署都會送資料進來，把正式統計弄髒。所以改在瀏覽器端擋：
 * 主機名對不上就連 gtag.js 都不去要。
 */
export const GA_HOSTS = ['bansik.tw', 'www.bansik.tw'];

/**
 * Search Console 的 HTML 標記驗證碼（`google-site-verification` 的 content）。
 * 空字串＝不輸出。apex 網域建議改用 DNS TXT 驗證，這個欄位是備案。
 */
export const GSC_VERIFICATION = process.env.BANSIK_GSC_TOKEN || '';
