// QA: fake Xbox-standard and raw PlayStation gamepads -> menu navigation + flight input
const { chromium } = require('/opt/npm-tools/node_modules/playwright');
(async () => {
  const b = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  for (const kind of ['xbox', 'ps-raw']) {
    const p = await (await b.newContext({ viewport: { width: 1280, height: 720 } })).newPage(); const errs = [];
    p.on('pageerror', e => errs.push(e.message));
    await p.addInitScript(kind => {
      const btn = () => Array.from({ length: 17 }, () => ({ pressed: false, value: 0 }));
      window.__pad = { id: kind === 'xbox' ? 'Xbox Wireless Controller (STANDARD GAMEPAD Vendor: 045e Product: 0b13)' : 'Wireless Controller (Vendor: 054c Product: 09cc)', index: 0, connected: true, mapping: kind === 'xbox' ? 'standard' : '', axes: kind === 'xbox' ? [0, 0, 0, 0] : [0, 0, 0, -1, -1, 0, 0, 0, 0, 3.28], buttons: btn(), timestamp: 0 };
      navigator.getGamepads = () => [window.__pad, null, null, null];
      window.__press = (i, on) => { window.__pad.buttons[i] = { pressed: on, value: on ? 1 : 0 }; };
    }, kind);
    await p.goto('http://localhost:8095/'); await p.waitForFunction(() => window.EMBERWING && EMBERWING.ui.screen === 'title', null, { timeout: 30000 }); await p.waitForTimeout(300);
    const A = kind === 'xbox' ? 0 : 1, DOWN = 13;
    const tap = async i => { await p.evaluate(i => __press(i, true), i); await p.waitForTimeout(120); await p.evaluate(i => __press(i, false), i); await p.waitForTimeout(160); };
    // stick down to move focus, then A to open worlds
    await p.evaluate(() => { __pad.axes[1] = 0.9; }); await p.waitForTimeout(150); await p.evaluate(() => { __pad.axes[1] = 0; }); await p.waitForTimeout(200);
    const foc = await p.evaluate(() => { const f = document.querySelector('.foc'); return f ? f.dataset.a : null; });
    await tap(A); await p.waitForTimeout(400);
    const scr = await p.evaluate(() => EMBERWING.ui.screen);
    const back = kind === 'xbox' ? 1 : 2; await tap(back); await p.waitForTimeout(300);
    const scr2 = await p.evaluate(() => EMBERWING.ui.screen);
    // start world 1 via first button (A on focused 'new')
    await p.evaluate(() => EMBERWING.playWorld(0, true)); await p.waitForFunction(() => EMBERWING.level && EMBERWING.state === 'play', null, { timeout: 30000 }); await p.waitForTimeout(500);
    await p.evaluate(A => __press(A, true), A); await p.evaluate(() => { __pad.axes[1] = -1; }); await p.waitForTimeout(2000);
    const st = await p.evaluate(() => { const P = EMBERWING.level.player; return { grounded: P.grounded, y: Math.round(P.p[1]), sta: Math.round(P.sta), device: EMBERWING.input.device, sony: EMBERWING.input.padSony }; });
    await p.evaluate(A => __press(A, false), A);
    await tap(kind === 'xbox' ? 5 : 5); const dash = await p.evaluate(() => EMBERWING.level.player.dashCD > 0);
    await tap(9); const paused = await p.evaluate(() => EMBERWING.paused);
    console.log(kind, JSON.stringify({ focusAfterDown: foc, openedScreen: scr, afterBack: scr2, flight: st, dash, pausedByStart: paused }), errs.length ? errs : 'NO ERRORS');
    await p.close();
  }
  await b.close();
})();
