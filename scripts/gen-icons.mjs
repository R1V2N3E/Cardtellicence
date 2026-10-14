// Renders the app icon SVG to the PNG sizes iOS/Android need (uses Playwright's Chromium).
import { chromium } from 'playwright-core';
import { writeFileSync } from 'node:fs';

const svg = (pad) => `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#1b2140"/><stop offset="1" stop-color="#0b0e18"/>
    </linearGradient>
    <linearGradient id="jp" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ff5a5f"/><stop offset="1" stop-color="#c81e3a"/></linearGradient>
    <linearGradient id="de" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffd23f"/><stop offset="1" stop-color="#f59e0b"/></linearGradient>
  </defs>
  <rect width="512" height="512" fill="url(#bg)"/>
  <g transform="translate(256 256) scale(${pad}) translate(-256 -256)">
    <rect x="96" y="128" width="170" height="236" rx="18" fill="url(#jp)" transform="rotate(-10 181 246)"/>
    <circle cx="176" cy="238" r="34" fill="#fff" opacity=".92" transform="rotate(-10 181 246)"/>
    <rect x="246" y="128" width="170" height="236" rx="18" fill="url(#de)" transform="rotate(10 331 246)"/>
    <path d="M286 300 L326 252 L352 276 L392 214" stroke="#0b0e18" stroke-width="22" fill="none" stroke-linecap="round" stroke-linejoin="round" transform="rotate(10 331 246)"/>
    <path d="M200 412 h112 l-22 -20 M312 412 l-22 20" stroke="#3ddc84" stroke-width="18" fill="none" stroke-linecap="round" stroke-linejoin="round"/>
  </g>
</svg>`;

const out = new URL('../public/icons/', import.meta.url);
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell' });
const page = await browser.newPage();
for (const [name, size, pad] of [['apple-touch-icon.png', 180, 1], ['icon-192.png', 192, 1], ['icon-512.png', 512, 1], ['icon-maskable-512.png', 512, 0.78]]) {
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(`<style>html,body{margin:0}svg{width:${size}px;height:${size}px;display:block}</style>${svg(pad)}`);
  writeFileSync(new URL(name, out), await page.screenshot({ type: 'png' }));
}
writeFileSync(new URL('icon.svg', out), svg(1).trim());
await browser.close();
console.log('icons written');
