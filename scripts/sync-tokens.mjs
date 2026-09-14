// 從統一設計系統同步 token 檔。改 token 請改上游，不要改 src/styles/tokens.css。
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const SRC = '/Users/lightman/weiqi.kids/agent.system-integration-quality-control/templates/styles.css';
const DEST = new URL('../src/styles/tokens.css', import.meta.url);
const HEADER = `/* ============================================================
 * 本檔為統一設計系統的副本，請勿直接編輯。
 *
 * 來源：agent.system-integration-quality-control/templates/styles.css
 * 同步：npm run sync:tokens
 *
 * 需要新增樣式時寫在 src/styles/site.css，不要改這裡；
 * 需要調整 token 值時改上游來源檔再同步回來。
 * ============================================================ */

`;

const css = await readFile(SRC, 'utf-8');
// 全新 clone 時 src/styles/ 還不存在，writeFile 不會自己建目錄
await mkdir(dirname(fileURLToPath(DEST)), { recursive: true });
await writeFile(DEST, HEADER + css, 'utf-8');
process.stderr.write(`tokens 已同步：${css.length} bytes\n`);
