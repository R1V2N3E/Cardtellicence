// Renders the app icon SVG to the PNG sizes iOS/Android need (uses Playwright's Chromium).
import { chromium } from 'playwright-core';
import { writeFileSync } from 'node:fs';

const mark = `
<defs>
 <linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#B794FF"/><stop offset=".5" stop-color="#7C6CFF"/><stop offset="1" stop-color="#2ED8F0"/></linearGradient>
 <linearGradient id="g2" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#3BE3F5"/><stop offset="1" stop-color="#1B8FD0"/></linearGradient>
</defs>
<rect x="25" y="9" width="27" height="38" rx="6" transform="rotate(14 38.5 28)" fill="url(#g2)" opacity=".9"/>
<g transform="rotate(-8 26 34)">
 <rect x="12" y="14" width="28" height="40" rx="6.5" fill="url(#g)"/>
 <rect x="12.75" y="14.75" width="26.5" height="38.5" rx="5.75" fill="none" stroke="#fff" stroke-opacity=".35" stroke-width="1.5"/>
 <path d="M17.5 44 L23 37.5 L27.5 40.5 L34.5 29.5 M29.3 30.4 L35 28.5 L35.7 34.4" fill="none" stroke="#0B0A1F" stroke-width="3.6" stroke-linecap="round" stroke-linejoin="round"/>
</g>
<path d="M50 4.5 C50.9 10 52 11.1 57.5 12 C52 12.9 50.9 14 50 19.5 C49.1 14 48 12.9 42.5 12 C48 11.1 49.1 10 50 4.5Z" fill="#fff"/>`;
const svg = (pad) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
<defs>
 <radialGradient id="a1" cx=".15" cy=".05" r=".8"><stop offset="0" stop-color="#6D4BFF" stop-opacity=".55"/><stop offset="1" stop-color="#6D4BFF" stop-opacity="0"/></radialGradient>
 <radialGradient id="a2" cx=".95" cy="1" r=".75"><stop offset="0" stop-color="#16C6E0" stop-opacity=".35"/><stop offset="1" stop-color="#16C6E0" stop-opacity="0"/></radialGradient>
</defs>
<rect width="512" height="512" fill="#0A0A16"/><rect width="512" height="512" fill="url(#a1)"/><rect width="512" height="512" fill="url(#a2)"/>
<g transform="translate(256 256) scale(${6.9*pad}) translate(-33 -30.5)">${mark}</g></svg>`;

const out = new URL('../public/icons/', import.meta.url);
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell' });
const page = await browser.newPage();
for (const [name, size, pad] of [['apple-touch-icon.png', 180, 1], ['icon-192.png', 192, 1], ['icon-512.png', 512, 1], ['icon-maskable-512.png', 512, 0.8]]) {
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(`<style>html,body{margin:0}svg{width:${size}px;height:${size}px;display:block}</style>${svg(pad)}`);
  writeFileSync(new URL(name, out), await page.screenshot({ type: 'png' }));
}
writeFileSync(new URL('icon.svg', out), svg(1).trim());
await browser.close();
console.log('icons written');
