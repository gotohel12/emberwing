// EMBERWING smoke/QA test: boots, walks every menu, plays a world with real inputs, checks systems
const { chromium } = require('/opt/npm-tools/node_modules/playwright');
(async () => {
  const W = +process.env.W || 1280, H = +process.env.H || 720, mobile = !!process.env.MOBILE;
  const b = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required'] });
  const ctx = await b.newContext({ viewport: { width: W, height: H }, hasTouch: mobile, isMobile: mobile, deviceScaleFactor: mobile ? 2 : 1 });
  const p = await ctx.newPage(); const errs = [];
  p.on('pageerror', e => errs.push('PAGE ' + e.message + ' @ ' + (e.stack || '').split('\n')[1]));
  p.on('console', m => { if (m.type() === 'error') errs.push('CON ' + m.text()); });
  const tag = process.env.TAG || 'd';
  const sh = async n => { await p.waitForTimeout(300); await p.screenshot({ path: `/tmp/ew_${tag}_${n}.png` }); };
  const log = (...a) => console.log(...a);
  await p.goto('http://localhost:8095/'); await p.waitForTimeout(2500); await sh('01title');
  const clickA = async a => { await p.click(`[data-a=${a}]`); await p.waitForTimeout(350); };
  for (const s of ['worlds', 'aerie', 'credits']) { await clickA(s); await sh('02' + s); await clickA('back'); }
  await clickA('settings'); for (const t of ['gfx', 'audio', 'controls', 'game', 'access']) { await p.click(`[data-a=tab][data-v=${t}]`); await p.waitForTimeout(200); await sh('03set_' + t); }
  await p.selectOption('[data-s=preset]', 'ultra').catch(() => {}); await p.waitForTimeout(200);
  await clickA('back');
  // start game
  await clickA('new'); await sh('04story');
  await clickA('storyskip'); await p.waitForTimeout(1500); await sh('05start');
  const st = () => p.evaluate(() => { const L = EMBERWING.level; if (!L) return null; const P = L.player; return { y: Math.round(P.p[1]), s: Math.round(P.s), g: P.grounded, flame: Math.round(P.flame), sta: Math.round(P.sta), carried: L.carried, t: L.time.toFixed(1), en: L.enemies.length, rings: L.ringsHit, dead: P.dead }; });
  log('start', JSON.stringify(await st()));
  // take off and fly with keyboard
  await p.keyboard.down('Space'); await p.keyboard.down('KeyW'); await p.waitForTimeout(2500); await p.keyboard.up('KeyW');
  log('after flap', JSON.stringify(await st())); await sh('06flying');
  await p.keyboard.up('Space');
  await p.keyboard.down('KeyD'); await p.waitForTimeout(1200); await p.keyboard.up('KeyD'); await sh('07turn');
  await p.keyboard.press('ShiftLeft'); await p.waitForTimeout(300); await sh('08dash'); log('dash', JSON.stringify(await p.evaluate(() => ({ dashT: EMBERWING.level.player.dashT.toFixed(2), s: Math.round(EMBERWING.level.player.s) }))));
  // teleport through first ring / near embers to test pickups
  const res = await p.evaluate(() => { const L = EMBERWING.level, P = L.player, g = L.world.rings[0]; P.p = [g.p[0] - Math.sin(g.yaw) * 60, g.p[1], g.p[2] - Math.cos(g.yaw) * 60]; P.yaw = Math.atan2(-Math.sin(g.yaw), -Math.cos(g.yaw)); P.pitch = 0; P.s = 200; P.grounded = false; return true; });
  await p.waitForTimeout(1200); log('ring', JSON.stringify(await st()));
  await p.evaluate(() => { const L = EMBERWING.level, P = L.player; const e = L.world.embers.filter(e => !e.got).slice(0, 12); for (const x of e) x.p = P.p.slice(); });
  await p.waitForTimeout(500); log('embers', JSON.stringify(await st()));
  // flare
  await p.keyboard.press('KeyE'); await p.waitForTimeout(400); await sh('09flare');
  // pause menu
  await p.keyboard.press('Escape'); await p.waitForTimeout(400); await sh('10pause'); log('paused', await p.evaluate(() => EMBERWING.paused));
  await clickA('resume'); await p.waitForTimeout(300);
  // go to beacon with enough embers, charge it
  await p.evaluate(() => { const L = EMBERWING.level, P = L.player, B = L.world.beacon; L.carried = L.need; P.p = [B.x + 500, B.top + 250, B.z]; P.grounded = false; P.s = 160; P.yaw = 0; });
  await p.waitForTimeout(1500); await sh('11beacon'); log('zone', JSON.stringify(await p.evaluate(() => ({ inZone: EMBERWING.level.inZone, charge: EMBERWING.level.charge.toFixed(3), en: EMBERWING.level.enemies.length }))));
  await p.evaluate(() => { EMBERWING.level.charge = 0.995; }); await p.waitForTimeout(2500); await sh('12lit');
  log('lit', JSON.stringify(await p.evaluate(() => ({ lit: EMBERWING.level.lit }))));
  await p.evaluate(() => { EMBERWING.level.endT = 6.9; }); await p.waitForTimeout(1500); await sh('13results');
  log('state', await p.evaluate(() => EMBERWING.state), JSON.stringify(await p.evaluate(() => ({ wallet: EMBERWING.save.wallet, w0: EMBERWING.save.worlds[0] }))));
  // next world loads (story) and world 3/5 build
  await clickA('nextw'); await p.waitForTimeout(400); await clickA('storyskip'); await p.waitForTimeout(1500); await sh('14world2');
  for (const i of [2, 3, 4]) { await p.evaluate(i => { EMBERWING.playWorld(i, true); }, i); await p.waitForTimeout(1800); await p.evaluate(() => { const P = EMBERWING.level.player; P.grounded = false; P.p[1] += 300; P.s = 200; }); await p.waitForTimeout(800); await sh('15world' + (i + 1)); }
  // boss world: trigger boss
  await p.evaluate(() => { const L = EMBERWING.level, P = L.player, B = L.world.beacon; L.carried = L.need; L.charge = 0.52; P.p = [B.x + 500, B.top + 300, B.z]; P.inv = 100; });
  await p.waitForTimeout(2000); await sh('16boss'); log('boss', JSON.stringify(await p.evaluate(() => ({ boss: !!EMBERWING.level.boss, alive: EMBERWING.level.boss && EMBERWING.level.boss.alive }))));
  const perf = await p.evaluate(() => ({ fps: EMBERWING.fps.toFixed(1), draws: EMBERWING.R.stats.draws, tris: Math.round(EMBERWING.R.stats.tris), res: EMBERWING.R.w + 'x' + EMBERWING.R.h }));
  log('perf (software GL)', JSON.stringify(perf));
  await p.evaluate(() => EMBERWING.toMenu()); await p.waitForTimeout(800); await sh('17menu');
  console.log(errs.length ? errs.join('\n') : 'NO ERRORS'); await b.close();
})();
