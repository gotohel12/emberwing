const { chromium } = require('/opt/npm-tools/node_modules/playwright');
const fs = require('fs');
(async () => {
  const b = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--no-sandbox'] });
  const p = await b.newPage({ viewport: { width: 512, height: 512 } });
  const svg = `<svg viewBox="0 0 200 200" xmlns="http://www.w3.org/2000/svg"><defs><linearGradient id="cg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff3c4"/><stop offset=".45" stop-color="#ffb347"/><stop offset="1" stop-color="#e2461b"/></linearGradient><radialGradient id="bg" cx=".5" cy=".42" r=".75"><stop offset="0" stop-color="#3a1d52"/><stop offset=".6" stop-color="#14112a"/><stop offset="1" stop-color="#07060f"/></radialGradient><radialGradient id="cr" cx=".5" cy=".55" r=".5"><stop offset="0" stop-color="#ffcf6b" stop-opacity=".6"/><stop offset="1" stop-color="#ff5a1f" stop-opacity="0"/></radialGradient></defs>
  <rect width="200" height="200" rx="%R%" fill="url(#bg)"/><circle cx="100" cy="104" r="80" fill="url(#cr)"/>
  <g transform="translate(100 108) scale(%S%) translate(-100 -108)"><path fill="url(#cg)" d="M100 34c9 16 10 30 4 44 15-14 34-19 58-14-18 6-30 16-37 30 18-6 34-4 48 6-22 0-37 7-46 20 10 2 18 8 22 18-12-6-24-6-33 0l-7 30-7-30c-9-6-21-6-33 0 4-10 12-16 22-18-9-13-24-20-46-20 14-10 30-12 48-6-7-14-19-24-37-30 24-5 43 0 58 14-6-14-5-28 4-44z"/><circle cx="100" cy="84" r="6" fill="#fff8e0"/></g></svg>`;
  const shot = async (file, size, r, s) => { await p.setViewportSize({ width: size, height: size }); await p.setContent(`<html><body style="margin:0;background:transparent">${svg.replace('%R%', r).replace('%S%', s).replace('<svg', `<svg width="${size}" height="${size}"`)}</body></html>`); await p.screenshot({ path: file, omitBackground: true }); };
  await shot('public/icons/icon-512.png', 512, 44, 1.05); await shot('public/icons/icon-192.png', 192, 44, 1.05);
  await shot('public/icons/maskable-512.png', 512, 0, 0.78); await shot('public/icons/apple-touch-icon.png', 180, 0, 0.95);
  await shot('/tmp/ew_icon256.png', 256, 44, 1.05);
  await b.close(); console.log('icons ok');
})();
