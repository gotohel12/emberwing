const { chromium } = require('/opt/npm-tools/node_modules/playwright');
(async () => {
  const b = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const p = await (await b.newContext({ viewport: { width: 1280, height: 720 } })).newPage(); const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.goto('http://localhost:8095/'); await p.waitForFunction(() => window.EMBERWING && EMBERWING.ui.screen === 'title', null, { timeout: 40000 });
  for (const wi of [0, 1, 2, 3, 4]) {
    await p.evaluate(wi => { EMBERWING.save.worlds = [1, 1, 1, 1, 1].map(() => ({ done: true })); EMBERWING.playWorld(wi, true); }, wi);
    await p.waitForFunction(() => EMBERWING.level && EMBERWING.state === 'play', null, { timeout: 40000 });
    await p.evaluate(() => { const L = EMBERWING.level, P = L.player, I = L.world.route[2] || L.world.route[1]; P.grounded = false; P.p = [I.x + 600, I.top + 260, I.z + 300]; P.yaw = Math.atan2(600, 300); P.s = 220; P.pitch = -0.1; L.hints = []; });
    await p.keyboard.down('Space'); await p.waitForTimeout(1200); await p.keyboard.up('Space'); await p.waitForTimeout(900);
    await p.screenshot({ path: `/tmp/ew_s_${wi}.png` });
  }
  console.log(errs.length ? errs : 'NO ERRORS'); await b.close();
})();
