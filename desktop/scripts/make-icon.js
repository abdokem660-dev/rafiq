/* Generates build/icon.png (512), icon.ico (multi-size) from Rafiq's feather mark. */
'use strict';

const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const OUT = path.join(__dirname, '..', 'build');
const SIZES = [16, 24, 32, 48, 64, 128, 256, 512];
const ICO_SIZES = new Set([16, 24, 32, 48, 64, 128, 256]);

function svg(size, { padding = 0.16, rounded = true } = {}) {
  const pad = size * padding;
  const inner = size - pad * 2;
  const r = rounded ? size * 0.22 : 0;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#23252E"/>
      <stop offset="1" stop-color="#101116"/>
    </linearGradient>
    <linearGradient id="gold" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#F7E27A"/>
      <stop offset="1" stop-color="#DFC033"/>
    </linearGradient>
  </defs>
  <rect x="0" y="0" width="${size}" height="${size}" rx="${r}" fill="url(#bg)"/>
  <rect x="${size * 0.035}" y="${size * 0.035}" width="${size * 0.93}" height="${size * 0.93}" rx="${r * 0.86}" fill="none" stroke="#3A3D48" stroke-width="${Math.max(1, size * 0.006)}"/>
  <g transform="translate(${pad} ${pad}) scale(${inner / 100})" fill="none" stroke="url(#gold)" stroke-width="5.2" stroke-linecap="round" stroke-linejoin="round">
    <path d="M38 88 C38 88 36 55 38 35 C40 18 52 10 58 12 C64 14 56 28 48 38"/>
    <path d="M48 38 C42 44 30 52 26 60 C22 68 24 74 30 76 C36 78 44 72 52 62 C60 52 72 42 80 38"/>
    <path d="M66 82 C68 82 74 80 76 80" stroke-width="5.6"/>
  </g>
</svg>`;
}

function icoFromPngs(entries) {
  // ICO container with PNG payloads (supported since Vista).
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(entries.length, 4);
  const dir = Buffer.alloc(16 * entries.length);
  let offset = 6 + dir.length;
  entries.forEach(({ size, png }, i) => {
    const b = i * 16;
    dir.writeUInt8(size >= 256 ? 0 : size, b);
    dir.writeUInt8(size >= 256 ? 0 : size, b + 1);
    dir.writeUInt8(0, b + 2);
    dir.writeUInt8(0, b + 3);
    dir.writeUInt16LE(1, b + 4);
    dir.writeUInt16LE(32, b + 6);
    dir.writeUInt32LE(png.length, b + 8);
    dir.writeUInt32LE(offset, b + 12);
    offset += png.length;
  });
  return Buffer.concat([header, dir, ...entries.map((e) => e.png)]);
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const entries = [];
  for (const size of SIZES) {
    const png = await sharp(Buffer.from(svg(size))).png({ compressionLevel: 9 }).toBuffer();
    if (ICO_SIZES.has(size)) entries.push({ size, png });
    if (size === 512) fs.writeFileSync(path.join(OUT, 'icon.png'), png);
    if (size === 256) fs.writeFileSync(path.join(OUT, 'logo-256.png'), png);
    if (size === 256) fs.writeFileSync(path.join(OUT, 'icon-256.png'), png);
  }
  fs.writeFileSync(path.join(OUT, 'icon.ico'), icoFromPngs(entries));
  fs.writeFileSync(path.join(OUT, 'icon.svg'), svg(512));
  console.log('icon written:', SIZES.join(', '));
})().catch((err) => { console.error(err); process.exit(1); });
