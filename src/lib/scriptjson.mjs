// 資料 → 可直接放進 <script>（application/json、application/ld+json）的 JSON 字串。
// HTML 規範：script 內容遇到 `</script` 就結束，`<!--`、`<script` 也會改變解析狀態；
// 把 `<` 一律寫成 <，JSON.parse 後值不變。瀏覽器端 JSON.parse(textContent) 照常可用。
// https://html.spec.whatwg.org/multipage/scripting.html#restrictions-for-contents-of-script-elements
export const scriptJson = (obj) => JSON.stringify(obj).replace(/</g, '\\u003c');
