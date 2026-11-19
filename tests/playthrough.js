// QA: headless bot plays each world legitimately (no teleport) by stepping the simulation directly
const { chromium } = require('/opt/npm-tools/node_modules/playwright');
(async () => {
  const b = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const p = await (await b.newContext({ viewport: { width: 640, height: 360 } })).newPage(); const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.goto('http://localhost:8095/'); await p.waitForFunction(() => window.EMBERWING && EMBERWING.ui.screen === 'title', null, { timeout: 40000 });
  for (let wi = +(process.env.FROM||0); wi < +(process.env.TO||5); wi++) {
    const diff = process.env.DIFF || 'normal';
    const r = await p.evaluate(({ wi, diff }) => {
      EMBERWING.save.diff = diff; EMBERWING.playWorld(wi, true);
      return new Promise(res => setTimeout(() => {
        const L = EMBERWING.level, P = L.player, B = L.world.beacon; EMBERWING.state = 'sim';
        const out = { hits: 0, deaths: 0 }; let lastFlame = P.flame;
        const steer = (tgt, flapBias = 0) => {
          const d = [tgt[0] - P.p[0], tgt[1] - P.p[1], tgt[2] - P.p[2]];
          const want = Math.atan2(-d[0], -d[2]); let dy = want - P.yaw; while (dy > Math.PI) dy -= 2 * Math.PI; while (dy < -Math.PI) dy += 2 * Math.PI;
          const hd = Math.hypot(d[0], d[2]), pitchW = Math.atan2(d[1], hd);
          return { x: Math.max(-1, Math.min(1, -dy * 2)), y: Math.max(-1, Math.min(1, pitchW * 1.5)), flap: (d[1] > 40 || P.s < 70) && P.sta > 15 ? 1 : flapBias, dive: 0, dash: 0, flare: 0, mx: 0, my: 0 };
        };
        let t = 0, dt = 1 / 30;
        for (; t < 900 && !L.lit; t += dt) {
          let inp;
          if (L.carried < L.need) {
            let best = null, bd = 1e9; for (const e of L.world.embers) { if (e.got || Math.hypot(e.p[0], e.p[2]) > L.stormR - 250) continue; const d = Math.hypot(e.p[0] - P.p[0], e.p[1] - P.p[1], e.p[2] - P.p[2]) + Math.hypot(e.p[0], e.p[2]) * 0.15; if (d < bd) { bd = d; best = e; } }
            inp = steer(best ? best.p : [B.x, B.top + 300, B.z]);
          } else { const a = Math.atan2(P.p[2] - B.z, P.p[0] - B.x) + 0.5; inp = steer([B.x + Math.cos(a) * 450, B.top + 250, B.z + Math.sin(a) * 450]); }
          const near = L.enemies.find(e => Math.hypot(e.p[0] - P.p[0], e.p[1] - P.p[1], e.p[2] - P.p[2]) < 160);
          if (near && P.dashCD <= 0) inp.dash = 1; else if (near && L.carried > L.need + 5 && P.flareCD <= 0) inp.flare = 1;
          if (L.boss) { const c = L.boss.cores.find(c => c.alive && c.hot); if (c) { inp = steer(L.boss.corePos(c)); if (P.dashCD <= 0 && Math.hypot(...L.boss.corePos(c).map((v, i) => v - P.p[i])) < 600) inp.dash = 1; } }
          L.update(dt, inp);
          if (P.flame < lastFlame - 1) out.hits++; lastFlame = P.flame; if (P.dead && !out._d) { out._d = 1; (out.dl = out.dl || []).length < 6 && out.dl.push([Math.round(P.p[0]), Math.round(P.p[1]), Math.round(P.p[2]), Math.round(P.flame), Math.round(Math.hypot(P.p[0], P.p[2])), Math.round(L.stormR), Math.round(t)]); } if (!P.dead) out._d = 0;
        }
        out.lit = L.lit; out.time = Math.round(L.time); out.collected = L.collected; out.deaths = L.deaths || 0; out.kills = L.kills; out.rings = L.ringsHit; out.need = L.need; out.flame = Math.round(P.flame); out.boss = !!L.world.feathers;
        out.medal = L.lit ? L.result().medal : null; out.medalT = L.W.medal;
        EMBERWING.state = 'play'; res(out);
      }, 900));
    }, { wi, diff });
    console.log('world', wi + 1, JSON.stringify(r));
  }
  console.log(errs.length ? errs.join('\n') : 'NO ERRORS'); await b.close();
})();
