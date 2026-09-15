#!/usr/bin/env node
// 由 public/favicon.svg 產生點陣圖示：apple-touch-icon.png 與 favicon.ico。
//
//   node scripts/make-icons.mjs
//
// 產物也進版控（它們是 public/ 的一部分，CI 只跑 astro build，不跑這支）。
// 改了 favicon.svg 才需要重跑。
//
// sharp 是 astro 的相依，不另外裝套件。
// ICO 直接包一張 32×32 的 PNG：ICO 容器允許 PNG 內容，現代瀏覽器都吃。

import sharp from 'sharp';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PUBLIC = path.resolve(fileURLToPath(import.meta.url), '..', '..', 'public');
const BG = '#f5f6f8';   // --bg-base：iOS 不支援透明，會自己鋪黑底
const svg = await readFile(path.join(PUBLIC, 'favicon.svg'));

// Apple 的圖示會被裁圓角，圖釘留白一點才不會被切到
await sharp(svg, { density: 900 })
  .resize(152, 152, { fit: 'contain', background: BG })
  .extend({ top: 14, bottom: 14, left: 14, right: 14, background: BG })
  .flatten({ background: BG })
  .png()
  .toFile(path.join(PUBLIC, 'apple-touch-icon.png'));

const png32 = await sharp(svg, { density: 900 }).resize(32, 32).png().toBuffer();

const header = Buffer.alloc(6);
header.writeUInt16LE(0, 0);        // reserved
header.writeUInt16LE(1, 2);        // type 1 = ICO
header.writeUInt16LE(1, 4);        // 一張圖
const entry = Buffer.alloc(16);
entry.writeUInt8(32, 0);           // 寬
entry.writeUInt8(32, 1);           // 高
entry.writeUInt8(0, 2);            // 調色盤色數，0 = 不用調色盤
entry.writeUInt8(0, 3);            // reserved
entry.writeUInt16LE(1, 4);         // color planes
entry.writeUInt16LE(32, 6);        // 每像素位元
entry.writeUInt32LE(png32.length, 8);
entry.writeUInt32LE(header.length + entry.length, 12);   // 圖檔位移
await writeFile(path.join(PUBLIC, 'favicon.ico'), Buffer.concat([header, entry, png32]));

console.log('寫出 public/apple-touch-icon.png、public/favicon.ico');
