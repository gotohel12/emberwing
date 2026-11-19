// QA: phone-sized touch session
const { chromium } = require('/opt/npm-tools/node_modules/playwright');
(async () => {
  const b = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const ctx = await b.newContext({ viewport: { width: 844, height: 390 }, hasTouch: true, isMobile: true, deviceScaleFactor: 3, userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1' });
  const p = await ctx.newPage(); const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.goto('http://localhost:8095/'); await p.waitForFunction(() => window.EMBERWING && EMBERWING.ui.screen === 'title', null, { timeout: 40000 });
  await p.screenshot({ path: '/tmp/ew_m_title.png' });
  console.log('preset', await p.evaluate(() => EMBERWING.S.preset + ' ' + EMBERWING.R.w + 'x' + EMBERWING.R.h));
  await p.tap('[data-a=new]'); await p.waitForTimeout(500); await p.tap('[data-a=storyskip]');
  await p.waitForFunction(() => EMBERWING.level && EMBERWING.state === 'play', null, { timeout: 40000 }); await p.waitForTimeout(800);
  const box = async s => p.evaluate(s => { const r = document.querySelector(s).getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2]; }, s);
  const flap = await box('#touch .flap'), stick = await box('#touch .stick');
  const cdp = await ctx.newCDPSession(p);
  const touch = (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts.map((q, i) => ({ x: q[0], y: q[1], id: i })) });
  await touch('touchStart', [flap, stick]); await p.waitForTimeout(100);
  await touch('touchMove', [flap, [stick[0] + 40, stick[1] - 40]]); await p.waitForTimeout(1800);
  await p.screenshot({ path: '/tmp/ew_m_fly.png' });
  const st = await p.evaluate(() => { const P = EMBERWING.level.player, I = EMBERWING.input; return { g: P.grounded, y: P.p[1] | 0, yaw: P.yaw.toFixed(2), tx: I.touch.x.toFixed(2), ty: I.touch.y.toFixed(2), flap: I.touch.flap }; });
  await touch('touchEnd', []);
  console.log('touch flight', JSON.stringify(st), errs.length ? errs : 'NO ERRORS');
  await b.close();
})();
