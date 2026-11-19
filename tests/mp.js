// EMBERWING 2-player online test: two real browsers, real WebSocket server
const { chromium } = require('/opt/npm-tools/node_modules/playwright');
const URL = process.env.URL || 'http://localhost:8095/';
(async () => {
  const b = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required'] });
  const mk = async (name) => { const ctx = await b.newContext({ viewport: { width: 960, height: 540 } }); const p = await ctx.newPage(); p.errs = []; p.on('pageerror', e => p.errs.push(name + ' PAGE ' + e.message + ' ' + (e.stack || '').split('\n')[1])); p.on('console', m => { if (m.type() === 'error') p.errs.push(name + ' CON ' + m.text()); }); await p.goto(URL); await p.waitForFunction(() => window.EMBERWING && EMBERWING.ui.screen === 'title', null, { timeout: 60000 }); return p; };
  const A = await mk('A'), B = await mk('B');
  const log = (...a) => console.log(...a);
  const click = async (p, a, v) => { await p.click(v != null ? `[data-a=${a}][data-v="${v}"]` : `[data-a=${a}]`); await p.waitForTimeout(300); };
  const mode = process.env.MODE || 'coop';
  // names
  for (const [p, n] of [[A, 'Mohsen'], [B, 'Danial']]) { await click(p, 'online'); await p.waitForFunction(() => EMBERWING.ui.screen === 'online' && document.querySelector('#mpname'), null, { timeout: 30000 }); await p.fill('#mpname', n); await click(p, 'mpname'); }
  await A.screenshot({ path: '/tmp/mp_online.png' });
  await click(A, 'mpcreate', mode); await A.waitForFunction(() => EMBERWING.ui.screen === 'room');
  const code = await A.evaluate(() => EMBERWING.net.room.code); log('room code', code);
  await B.fill('#mpcode', code); await click(B, 'mpjoin'); await B.waitForFunction(() => EMBERWING.ui.screen === 'room' && EMBERWING.net.room.players.length === 2);
  if (process.env.WORLD) { await click(A, 'mpworld', process.env.WORLD); await A.waitForTimeout(300); }
  await click(B, 'mpready', '1'); await A.waitForFunction(() => EMBERWING.net.room.players[1] && EMBERWING.net.room.players[1].ready);
  await A.screenshot({ path: '/tmp/mp_room.png' });
  await click(A, 'mpstart');
  await A.waitForFunction(() => EMBERWING.state === 'play' && EMBERWING.level && EMBERWING.level.mp, null, { timeout: 30000 });
  await B.waitForFunction(() => EMBERWING.state === 'play' && EMBERWING.level && EMBERWING.level.mp, null, { timeout: 30000 });
  log('both playing; roles', await A.evaluate(() => EMBERWING.level.mp.host), await B.evaluate(() => EMBERWING.level.mp.host));
  // both take off
  for (const p of [A, B]) { await p.keyboard.down('Space'); await p.keyboard.down('KeyW'); }
  await A.waitForTimeout(2500);
  for (const p of [A, B]) { await p.keyboard.up('Space'); await p.keyboard.up('KeyW'); }
  const st = p => p.evaluate(() => { const L = EMBERWING.level, M = L.mp, P = L.player; return { me: P.p.map(Math.round), peerSeen: !!M.peer.tp, peer: M.peer.p.map(Math.round), carried: L.carried, en: L.enemies.length, ghosts: M.ghosts.size, time: L.time.toFixed(1), storm: Math.round(L.stormR), boss: !!(L.boss || M.boss), ping: Math.round(EMBERWING.net.rtt) }; });
  log('A', JSON.stringify(await st(A))); log('B', JSON.stringify(await st(B)));
  // position check: B sees A where A is
  const aPos = await A.evaluate(() => EMBERWING.level.player.p), bSeesA = await B.evaluate(() => EMBERWING.level.mp.peer.p);
  log('sync error (units)', Math.round(Math.hypot(aPos[0] - bSeesA[0], aPos[1] - bSeesA[1], aPos[2] - bSeesA[2])));
  // bring B next to A for screenshot
  await B.evaluate(a => { const P = EMBERWING.level.player; P.p = [a[0] + 60, a[1] + 10, a[2] + 40]; P.yaw = EMBERWING.level.mp.peer.yaw; }, aPos);
  await A.waitForTimeout(900); await A.screenshot({ path: '/tmp/mp_A_sees_B.png' }); await B.screenshot({ path: '/tmp/mp_B_sees_A.png' });
  // guest picks up embers -> host team counter (coop)
  await B.evaluate(() => { const L = EMBERWING.level, P = L.player; L.world.embers.filter(e => !e.got).slice(0, 10).forEach(e => { e.p = P.p.slice(); e.base = null; }); });
  await A.waitForTimeout(1200);
  const gotA = await A.evaluate(() => EMBERWING.level.world.embers.filter(e => e.got).length), gotB = await B.evaluate(() => EMBERWING.level.world.embers.filter(e => e.got).length);
  log('embers got  A:', gotA, ' B:', gotB, ' carried A/B:', await A.evaluate(() => EMBERWING.level.carried), await B.evaluate(() => EMBERWING.level.carried));
  // enemy ghosts on B + guest dash kill
  const eB = await B.evaluate(() => [...EMBERWING.level.mp.ghosts.values()].map(g => ({ id: g.id, t: g.type, p: g.p.map(Math.round) })));
  log('B ghost enemies', eB.length, JSON.stringify(eB.slice(0, 3)));
  if (eB.length) {
    const kA0 = await A.evaluate(() => EMBERWING.level.enemies.length);
    const target = eB[0];
    await B.evaluate(t => { const P = EMBERWING.level.player; P.p = t.p.slice(); P.p[0] += 5; P.dashT = 0.5; P.inv = 2; P.grounded = false; }, target);
    await A.evaluate(t => { const e = EMBERWING.level.enemies.find(x => x.id === t.id); if (e) { e.stun = 3; e.v = [0, 0, 0]; } }, target);
    await B.waitForTimeout(900);
    log('guest dash kill -> host enemies', kA0, '->', await A.evaluate(() => EMBERWING.level.enemies.length), ' B ghosts', await B.evaluate(() => EMBERWING.level.mp.ghosts.size));
  }
  if (mode === 'coop') {
    // host enemy hurts guest: place a drifter on B
    const fl0 = await B.evaluate(() => { const P = EMBERWING.level.player; P.inv = 0; P.dashT = 0; return P.flame; });
    const bp = await B.evaluate(() => EMBERWING.level.player.p);
    await A.evaluate(p => { const L = EMBERWING.level; const e = L.spawnEnemy('drifter', p); e.v = [0, 0, 0]; }, bp);
    await B.waitForTimeout(1000);
    log('guest hurt by host enemy: flame', Math.round(fl0), '->', Math.round(await B.evaluate(() => EMBERWING.level.player.flame)));
    // charge the beacon via host team carried -> lit on both
    await A.evaluate(() => { const L = EMBERWING.level; L.carried = L.need; L.charge = 0.97; L.bossDone = true; const B = L.world.beacon, P = L.player; P.p = [B.x + 450, B.top + 200, B.z]; P.dead = 0; P.grounded = false; });
    await A.waitForFunction(() => EMBERWING.level && EMBERWING.level.lit, null, { timeout: 20000 });
    await B.waitForFunction(() => EMBERWING.level && EMBERWING.level.lit, null, { timeout: 20000 });
    log('beacon lit on both ✓');
    await A.waitForFunction(() => EMBERWING.ui.screen === 'mpres', null, { timeout: 90000 }); await B.waitForFunction(() => EMBERWING.ui.screen === 'mpres', null, { timeout: 90000 });
    await A.screenshot({ path: '/tmp/mp_res_A.png' });
    log('results on both ✓');
  } else {
    // versus: A carries embers, B dashes into A and steals half
    await A.evaluate(() => { EMBERWING.level.carried = 20; const P = EMBERWING.level.player; P.inv = 0; });
    const ap = await A.evaluate(() => EMBERWING.level.player.p);
    await B.evaluate(p => { const P = EMBERWING.level.player; P.p = [p[0] + 10, p[1], p[2]]; P.dashT = 0.5; P.grounded = false; }, ap);
    await B.waitForTimeout(1200);
    log('steal: A carried', await A.evaluate(() => EMBERWING.level.carried), ' B carried', await B.evaluate(() => EMBERWING.level.carried));
    // B deposits at beacon -> score, then reach target -> end
    await B.evaluate(() => { const L = EMBERWING.level, Bc = L.world.beacon, P = L.player; L.carried = 6; L.mp.score = L.need - 3; P.p = [Bc.x + 450, Bc.top + 200, Bc.z]; P.dead = 0; P.grounded = false; });
    for (let i = 0; i < 1; i++) { await B.waitForTimeout(3000); log('dbg B', JSON.stringify(await B.evaluate(() => { const L = EMBERWING.level; if (!L) return EMBERWING.ui.screen; return { z: L.inZone, c: L.carried, sc: L.mp.score, need: L.need, p: L.player.p.map(Math.round), dead: L.player.dead, t: L.time.toFixed(1), lit: L.lit }; })), 'A sees', JSON.stringify(await A.evaluate(() => EMBERWING.level ? EMBERWING.level.mp.peer.score : EMBERWING.ui.screen))); }
    await B.waitForFunction(() => EMBERWING.ui.screen === 'mpres', null, { timeout: 150000 }); await A.waitForFunction(() => EMBERWING.ui.screen === 'mpres', null, { timeout: 150000 });
    log('pvp result A:', JSON.stringify(await A.evaluate(() => ({ win: EMBERWING.result.win, me: EMBERWING.result.me, him: EMBERWING.result.him }))), 'B:', JSON.stringify(await B.evaluate(() => ({ win: EMBERWING.result.win, me: EMBERWING.result.me, him: EMBERWING.result.him }))));
    await B.screenshot({ path: '/tmp/mp_res_B.png' });
  }
  // back to room, then A leaves -> B notified
  await click(A, 'mproom'); await click(B, 'mproom');
  log('back in room', await A.evaluate(() => EMBERWING.ui.screen), await B.evaluate(() => EMBERWING.ui.screen));
  log('ERRORS', JSON.stringify(A.errs.concat(B.errs)));
  await b.close();
})().catch(e => { console.error('FAIL', e); process.exit(1); });
