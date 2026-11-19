// EMBERWING — a run through one world: objectives, storm, beacon, waves, hazards, camera, rendering
import { add, sub, scl, madd, norm, len, dist, clamp, damp, lerp, vdamp, mixc, basis, trs, m4, TAU } from '../core/math.js';
import { buildWorld, groundBelow } from '../world/build.js';
import { Player } from './player.js';
import { Enemy, Maw } from './enemies.js';
import { MP, drawPhoenix } from './mp.js';
import * as MD from '../gfx/models.js';
import { skinPal, enemyPal, worldPal } from '../gfx/assets.js';

export class Level {
  constructor(app, W, idx, opts) {
    this.app = app; this.W = W; this.idx = idx; this.R = app.R; this.audio = app.audio; this.particles = app.particles; this.input = app.input;
    this.diffKey = opts.diff || 'normal'; this.diff = opts.DIFF[this.diffKey];
    this.world = buildWorld(Object.assign({ quality: app.treeQ || 1 }, W), app.lib);
    this.chunks = this.world.chunks.map(c => ({ c: c.c, r: c.r, s: this.R.upload(c.s), f: this.R.upload(c.f) }));
    this.env = JSON.parse(JSON.stringify(W.env)); this.env.fogH = W.env.seaY + 500; this.R.setEnv(this.env);
    this.player = new Player(this, this.world.spawn, opts.up); this.player.skin = opts.skin;
    this.need = Math.round(W.need * this.diff.needK); this.carried = 0; this.collected = 0; this.kills = 0;
    this.time = 0; this.charge = 0; this.lit = false; this.endT = 0; this.combat = 0; this.feathers = 0; this.ringsHit = 0;
    this.stormT = W.stormT * this.diff.storm; this.stormR = W.stormR0; this.checkpoint = { p: this.world.spawn.p.slice(), yaw: this.world.spawn.yaw };
    this.enemies = []; this.waveT = 0; this.waveI = 0; this.boss = null; this.bossDone = !W.boss; this.lightT = 4; this.bolts = []; this.drops = [];
    this.cam = { p: add(this.world.spawn.p, [0, 60, 120]), t: this.world.spawn.p.slice(), shake: 0, fov: 1.15 };
    this.hints = W.tutorial ? ['steer', 'flap', 'embers', 'rings', 'dash', 'flare', 'beacon'] : []; this.hintT = 2;
    this.deadT = 0; this.combo = 0; this.comboT = 0; this.msgT = 0;
    // models
    this.M = makeModels(this.R, app.lib, W, opts.skin);
    // initial enemies
    const E = W.enemies, anchors = this.world.anchors;
    this.mp = opts.mp ? new MP(this, opts.mp) : null;
    const eK = this.mp ? (this.mp.host ? (this.mp.pvp ? 0.5 : 1.25) : 0) : 1;
    let ai = 0; for (const type of ['drifter', 'lancer', 'leech']) for (let i = 0; i < Math.round((E[type] || 0) * this.diff.enemy * eK); i++) { const a = anchors[(ai++ * 3 + 1) % anchors.length]; if (dist(a, this.world.spawn.p) > 900) this.enemies.push(new Enemy(type, a, a)); }
    this.demo = !!opts.demo; if (this.demo) { this.enemies.length = 0; this.player.grounded = false; this.player.s = 160; this.player.p[1] += 300; this.player.inv = 1e9; }
    this.particles.clear();
  }
  autopilot() {
    const P = this.player, B = this.world.beacon, a = Math.atan2(P.p[2] - B.z, P.p[0] - B.x) + 0.35, R = 1100;
    const tgt = [B.x + Math.cos(a) * R, B.top + 380 + Math.sin(this.time * 0.4) * 160, B.z + Math.sin(a) * R];
    const want = Math.atan2(-(tgt[0] - P.p[0]), -(tgt[2] - P.p[2])); let dy = want - P.yaw; while (dy > Math.PI) dy -= 2 * Math.PI; while (dy < -Math.PI) dy += 2 * Math.PI;
    return { x: clamp(-dy * 1.5, -1, 1), y: clamp((tgt[1] - P.p[1]) / 200, -0.6, 0.6), flap: P.p[1] < tgt[1] - 60 && P.sta > 30 ? 1 : 0, dive: 0, dash: 0, flare: 0, mx: 0, my: 0 };
  }
  dispose() { const R = this.R; for (const c of this.chunks) { R.free(c.s); R.free(c.f); } for (const k in this.M) R.free(this.M[k]); if (this.mp) { this.mp.dispose(); for (const k in this.mp.peerModels) R.free(this.mp.peerModels[k]); } }
  // ---------- events used by player/enemies
  fx(kind) {
    if (kind === 'hit') { this.audio.play('hit'); this.shake(0.7); this.flash([1, 0.2, 0.1], 0.35); this.input.rumble(0.8, 0.5, 220); }
    if (kind === 'dash') { this.audio.play('dash'); this.shake(0.25); this.R.fx.ab = 1; this.input.rumble(0.3, 0.6, 160); }
  }
  shake(k) { if (this.app.S.shake) this.cam.shake = Math.max(this.cam.shake, k); }
  flash(c, a) { if (this.app.S.flashes === false) a *= 0.25; this.R.fx.flash = Math.max(this.R.fx.flash, a); this.R.fx.flashC = c; }
  toast(t, kind) { this.app.ui.toast(t, kind); }
  spawnEnemy(type, p) { const e = new Enemy(type, p, p); if (type !== 'orb') e.v = scl(norm(sub(this.player.p, p)), 100); this.enemies.push(e); return e; }
  dropEmbers(p, n) {
    const list = [];
    for (let i = 0; i < n; i++) { const e = { id: this.mp ? this.mp.nextDropId() : 0, p: madd(p, [Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5], 50), base: null, got: false, ph: Math.random() * TAU, drop: 8 }; this.world.embers.push(e); list.push(e); }
    if (this.mp) this.mp.onDrops(list);
  }
  flare(p, r) { this.flareAt(p, r, false); if (this.mp) this.mp.onFlare(p, r); }
  flareAt(p, r, remote) {
    if (!remote) { this.audio.play('flare'); this.flash(mixc(this.player.trail[0], [1, 1, 1], 0.5), 0.35); this.shake(0.5); this.input.rumble(0.5, 0.8, 300); }
    else this.audio.play('flare', 0.5);
    this.particles.emit({ p: p.slice(), life: 0.6, s0: 30, s1: r * 1.1, c0: [1, 0.95, 0.8], c1: this.player.trail[1], a: 0.7 });
    this.particles.emit(() => { const a = Math.random() * TAU, b = (Math.random() - 0.5) * Math.PI; const d = [Math.cos(a) * Math.cos(b), Math.sin(b), Math.sin(a) * Math.cos(b)]; return { p: p.slice(), v: scl(d, r * 1.6), life: 0.55, s0: 9, s1: 2, c0: this.player.trail[0], c1: this.player.trail[1], drag: 2.5 }; }, 70);
    for (const e of this.enemies) {
      const d = dist(e.p, p); if (d > r + e.r) continue;
      if (e.type === 'lancer') { e.stun = 2.2; e.state = 'patrol'; e.v = scl(norm(sub(e.p, p)), 500); e.cool = 3; }
      else { if (e.type === 'leech' && e.attached > 0) e.attached = 0; e.kill(this); }
    }
  }
  // ---------- main update
  update(dt, inp) {
    const P = this.player, W = this.W, A = this.audio;
    if (this.demo) { this.time += dt; P.update(dt, this.autopilot()); this.particles.update(dt); this.audio.update(0.3, 0); this.updateCamera(dt); return; }
    const mp = this.mp, auth = !mp || mp.host, coop = !mp || !mp.pvp;
    if (mp) mp.pre(dt);
    if (!this.lit) this.time += dt;
    this.R.fx.flash = Math.max(0, this.R.fx.flash - dt * 1.8); this.R.fx.ab = Math.max(0, this.R.fx.ab - dt * 2.5);
    // death / respawn
    if (P.dead) {
      this.deadT -= dt;
      if (this.deadT <= 0) {
        let cp = this.checkpoint; const B = this.world.beacon;
        if (Math.hypot(cp.p[0], cp.p[2]) > this.stormR - 350) cp = { p: [B.x + B.r * 0.55, B.top + 10, B.z], yaw: Math.PI / 2 };
        P.respawn(cp, 0.75); this.toast('رجعت من آخر نقطة آمنة — لا تستسلم', 'warn');
      }
    } else if (P.flame <= 0 || P.p[1] < W.env.seaY + 60) {
      if (P.p[1] < W.env.seaY + 60 && P.flame > 0) this.toast('طحت في بحر الغيم!', 'warn');
      P.dead = 1; this.deadT = 2.2; A.play('death'); this.shake(1); if (auth || !coop) this.carried = Math.floor(this.carried * 0.75); if (mp && !mp.host && coop) mp.onDeath(); this.deaths = (this.deaths || 0) + 1;
      this.particles.emit(() => ({ p: P.p.slice(), v: [(Math.random() - 0.5) * 400, Math.random() * 300, (Math.random() - 0.5) * 400], life: 1.4, s0: 10, s1: 1, c0: P.trail[0], c1: [0.2, 0.05, 0], g: 200, drag: 1 }), 60);
    }
    P.update(dt, this.lit && this.endT > 1.2 ? { x: 0, y: 0, flap: 0, dive: 0, dash: 0, flare: 0, mx: 0, my: 0 } : inp);
    // storm
    const tk = clamp(this.time / this.stormT, 0, 1);
    if (!this.lit) { if (auth) this.stormR = lerp(W.stormR0, W.stormR1, tk * tk * (3 - 2 * tk)); }
    else this.stormR = Math.min(30000, this.stormR + dt * 6000);
    const pr = Math.hypot(P.p[0], P.p[2]);
    this.outside = !P.dead && pr > this.stormR;
    if (this.outside && !this.lit) { P.flame -= dt * 14 * this.diff.dmg * (tk >= 1 ? 1.8 : 1); if (Math.random() < 0.1) this.shake(0.2); }
    // embers
    const mag = P.magnet;
    for (const e of this.world.embers) {
      if (e.got) continue;
      if (e.drop > 0) { e.drop -= dt; if (e.drop <= 0) { e.got = true; continue; } }
      if (e.base) e.p[1] = e.base[1] + Math.sin(this.time * 2 + e.ph) * 6;
      const d = dist(e.p, P.p);
      if (d < mag && !P.dead) { e.p = madd(e.p, norm(sub(P.p, e.p)), Math.min(d, (500 + (mag - d) * 6) * dt)); e.base = null; }
      if (d < 18 && !P.dead) {
        e.got = true; this.carried++; this.collected++; if (mp) mp.onPickup(e); this.comboT = 1.1; this.combo = Math.min(7, this.combo + 1); A.play('ember', this.combo);
        this.particles.emit({ p: e.p.slice(), life: 0.35, s0: 6, s1: 26, c0: [1, 0.95, 0.7], c1: P.trail[1], a: 0.8 });
      }
    }
    this.comboT -= dt; if (this.comboT <= 0) this.combo = 0;
    // rings
    for (const g of this.world.rings) {
      g.pulse = Math.max(0, g.pulse - dt);
      const n = [Math.sin(g.yaw), 0, Math.cos(g.yaw)], rel = sub(P.p, g.p), along = rel[0] * n[0] + rel[2] * n[2], radial = len(madd(rel, n, -along));
      if (!g.hit && Math.abs(along) < 22 && radial < g.r && !P.dead) {
        g.hit = true; g.pulse = 1; this.ringsHit++; P.s = Math.max(P.s, 300); P.vy = Math.max(P.vy, 40); P.sta = P.maxSta; A.play('ring'); this.shake(0.15); this.R.fx.ab = 0.6;
        this.particles.emit(() => { const a = Math.random() * TAU; return { p: add(g.p, [Math.cos(a) * g.r * n[2], Math.sin(a) * g.r, -Math.cos(a) * g.r * n[0]]), v: scl(P.fwd(), 150), life: 0.6, s0: 6, s1: 1, c0: [1, 1, 1], c1: W.pal.accent }; }, 40);
      }
    }
    // feathers
    for (const f of this.world.feathers) if (!f.got && dist(f.p, P.p) < 45 && !P.dead) { f.got = true; this.feathers++; A.play('feather'); this.toast(`ريشة السماء ${this.feathers}/3 🪶`, 'gold'); this.flash([1, 0.9, 0.6], 0.25); }
    // shrines (checkpoints)
    this.world.shrines.forEach((s, si) => { if (dist(s.p, P.p) < 140 && !P.dead) {
      if (!s.lit) { s.lit = true; A.play('shrine'); this.toast('مزار مضاء — نقطة رجوع ✓', 'ok'); if (mp) mp.onShrine(si); }
      if (P.flame < P.maxFlame) P.flame = Math.min(P.maxFlame, P.flame + 40 * dt);
      this.checkpoint = { p: [s.p[0], s.p[1] + 60, s.p[2]], yaw: P.yaw };
    } });
    // beacon charging
    const B = this.world.beacon, hb = Math.hypot(P.p[0] - B.x, P.p[2] - B.z);
    const zone = Q => { const h = Math.hypot(Q.p[0] - B.x, Q.p[2] - B.z); return !Q.dead && !this.lit && h < 760 && h > 120 && Q.p[1] > B.top - 60 && Q.p[1] < B.top + 900; };
    this.inZone = zone(P);
    const peerZ = mp && mp.host && mp.peer.tp ? zone(mp.peer) : false;
    if (coop && (this.inZone || peerZ)) {
      if (this.carried >= this.need || this.charge > 0) {
        const can = this.bossDone || this.charge < 0.5, nIn = (this.inZone && (P.s > 40 || P.grounded) ? 1 : 0) + (peerZ ? 1 : 0);
        if (auth && can && nIn) { this.charge = Math.min(1, this.charge + dt / 30 * (nIn > 1 ? 1.5 : 1)); }
        if (this.inZone && can) { this.chargeSnd = (this.chargeSnd || 0) - dt; if (this.chargeSnd <= 0) { this.chargeSnd = 0.5; A.play('charge', this.charge); } }
        if (this.inZone && Math.random() < 0.5) this.particles.emit({ p: P.p.slice(), v: scl(norm(sub([B.x, B.top + 340, B.z], P.p)), 600), life: Math.max(0.2, hb / 650), s0: 5, s1: 2, c0: [1, 0.9, 0.6], c1: P.trail[1] });
        if (auth && W.boss && !this.boss && this.charge >= 0.5 && !this.bossDone) { this.boss = new Maw([B.x, B.top + 720, B.z]); this.toast('الفم الأجوف صحى!', 'hot'); A.play('boss'); this.app.ui.banner('HOLLOW MAW', 'الفم الأجوف'); if (mp) mp.onBoss(this.boss.c); }
        if (auth) { this.waveT -= dt; if (this.waveT <= 0) this.spawnWave(peerZ && !this.inZone ? mp.peer.p : P.p); }
      } else if (this.inZone) { this.msgT -= dt; if (this.msgT <= 0) { this.msgT = 3; this.toast(`المنارة تحتاج ${this.need} جمرة — معك ${this.carried}`, 'warn'); } }
    }
    if (this.boss) { this.boss.update(dt, this); if (this.boss.dead && !this.bossDone) { this.bossDone = true; } if (this.boss.dead && this.boss.deathT > 4) this.boss = null; }
    if (!this.lit && this.charge >= 1 && auth && coop) { this.lightBeacon(); if (mp) mp.onLit(); }
    // hazards: lightning
    if (W.lightning && !this.lit) {
      this.lightT -= dt;
      if (auth && this.lightT <= 0) {
        const T = mp && mp.peer.tp && !mp.peer.dead && (P.dead || Math.random() < 0.5) ? mp.peer : P;
        this.lightT = (2.8 + Math.random() * 3) * (mp ? 0.75 : 1);
        if (!T.dead) { const a = Math.random() * TAU, r = Math.random() * 380, v = T.vel(); const b = { p: [T.p[0] + Math.cos(a) * r + v[0] * 0.8, T.p[1], T.p[2] + Math.sin(a) * r + v[2] * 0.8], t: 1.35 }; this.bolts.push(b); if (T === P) A.play('warn'); if (mp) mp.onBolt(b); }
      }
      for (const b of this.bolts) {
        b.t -= dt;
        if (b.t > 0) { if (Math.random() < 0.7) { const a = Math.random() * TAU; this.particles.emit({ p: [b.p[0] + Math.cos(a) * 110, b.p[1] + (Math.random() - 0.5) * 300, b.p[2] + Math.sin(a) * 110], life: 0.25, s0: 7, c0: [0.7, 0.9, 1], a: 0.9 }); } }
        else if (!b.fired) {
          b.fired = true; A.play('thunder'); this.flash([0.85, 0.92, 1], 0.55); this.shake(0.5);
          for (let y = -600; y < 1600; y += 26) this.particles.emit({ p: [b.p[0] + (Math.random() - 0.5) * 40, b.p[1] + y, b.p[2] + (Math.random() - 0.5) * 40], life: 0.35, s0: 22, s1: 4, c0: [1, 1, 1], c1: [0.5, 0.7, 1] });
          if (!P.dead && Math.hypot(P.p[0] - b.p[0], P.p[2] - b.p[2]) < 120) P.hurt(30);
        }
      }
      this.bolts = this.bolts.filter(b => b.t > -0.5);
    }
    // enemies
    let near = 0;
    for (const e of this.enemies) {
      e.update(dt, this); if (e.dead) continue;
      const d = dist(e.p, P.p); if (d < 900) near++;
      if (P.dead) continue;
      if (d < e.r + 12) {
        if (P.dashT > 0) { e.kill(this); this.shake(0.3); }
        else if (e.type === 'leech') { if (!e.attached && e.stun <= 0) { e.attached = 7; this.toast('علقة! اندفع أو استخدم الوهج', 'warn'); A.play('leech'); } }
        else if (e.stun <= 0) { if (P.hurt(e.type === 'lancer' ? 28 : e.type === 'orb' ? 15 : 18, e.p)) { if (e.type === 'orb') e.kill(this); else { e.stun = 1; e.v = scl(norm(sub(e.p, P.p)), 300); } } }
      }
    }
    this.enemies = this.enemies.filter(e => !e.dead);
    if (auth) { P.leeched = this.enemies.some(e => e.attached > 0 && !(e.attTo && e.attTo.remote)); if (P.leeched) P.s *= Math.exp(-0.25 * dt); }
    if (mp && !mp.host) for (const g of mp.ghosts.values()) if (dist(g.p, P.p) < 900) near++;
    this.combat = clamp(near / 3 + (this.inZone && this.carried >= this.need ? 0.6 : 0) + (this.boss || (mp && mp.boss) ? 1 : 0), 0, 1);
    if (mp) mp.post(dt);
    // tutorial hints
    this.updateHints(dt);
    // victory sequence
    if (this.lit) { this.endT += dt; this.env.fogF = lerp(this.env.fogF, this.W.env.fogF * 1.6, dt * 0.5); if (this.endT > 7 && !this.finished) { this.finished = true; if (mp) { mp.ended = true; this.app.mpFinish(Object.assign(this.result(), { coop: true, peer: mp.peer.name })); } else this.app.finishLevel(this.result()); } }
    this.particles.update(dt);
    this.audio.update(clamp(P.s / 420, 0, 1), this.lit ? 0 : this.combat);
    this.updateCamera(dt);
  }
  spawnWave(at) {
    const W = this.W, wave = W.waves[this.waveI % W.waves.length]; this.waveI++; this.waveT = 8 / this.diff.enemy;
    const n = Math.round(wave[1] * this.diff.enemy * (this.mp ? 1.4 : 1)), c = at || this.player.p;
    for (let i = 0; i < n; i++) { const a = Math.random() * TAU, p = [c[0] + Math.cos(a) * 1100, c[1] + 150 + Math.random() * 250, c[2] + Math.sin(a) * 1100]; this.spawnEnemy(wave[0], p); this.particles.emit({ p, life: 0.8, s0: 80, s1: 10, c0: [0.5, 0.2, 0.9], c1: [0.1, 0, 0.2] }); }
    if (this.waveI === 1) this.toast('الفراغ يهاجم المنارة!', 'hot');
  }
  lightBeacon() {
    this.lit = true; this.endT = 0; const B = this.world.beacon, A = this.audio;
    A.play('beacon'); A.setMood('victory'); this.flash([1, 0.95, 0.8], 0.9); this.shake(1.2); this.input.rumble(1, 1, 700);
    for (const e of this.enemies) e.kill(this);
    const c = [B.x, B.top + 340, B.z];
    this.particles.emit(() => { const a = Math.random() * TAU, b = (Math.random() - 0.2) * Math.PI * 0.6; return { p: c, v: [Math.cos(a) * Math.cos(b) * 1400, Math.sin(b) * 900, Math.sin(a) * Math.cos(b) * 1400], life: 2.5, s0: 22, s1: 3, c0: [1, 1, 0.9], c1: this.W.pal.accent, drag: 0.8 }; }, 400);
    this.app.ui.banner(this.W.en + ' — LIT', 'المنارة اشتعلت!');
    // brighten world
    const E = this.env; E.skyTop = mixc(E.skyTop, [0.45, 0.65, 1], 0.4); E.skyHor = mixc(E.skyHor, [1, 0.9, 0.75], 0.4); E.sunC = mixc(E.sunC, [1, 0.95, 0.85], 0.5); E.fogC = mixc(E.fogC, [1, 0.92, 0.8], 0.3); E.stars = 0;
  }
  result() {
    const t = this.time, M = this.W.medal, medal = t <= M[0] ? 'gold' : t <= M[1] ? 'silver' : t <= M[2] ? 'bronze' : null;
    const bonus = { gold: 150, silver: 90, bronze: 40 }[medal] || 0;
    return { idx: this.idx, time: t, medal, feathers: this.world.feathers.map(f => f.got), collected: this.collected, kills: this.kills, rings: this.ringsHit, deaths: this.deaths || 0, reward: this.collected + this.feathers * 50 + bonus, bonus };
  }
  updateHints(dt) {
    if (!this.hints.length) { this.app.ui.hint(null); return; }
    this.hintT -= dt; const h = this.hints[0], P = this.player;
    const done = { steer: this.time > 5 && !P.grounded, flap: P.p[1] > this.world.spawn.p[1] + 120, embers: this.collected >= 8, rings: this.ringsHit >= 1, dash: P.dashCD > 0, flare: this.kills > 0 || P.flareCD > 0, beacon: this.inZone }[h];
    this.app.ui.hint(h);
    if (done && this.hintT <= 0) { this.hints.shift(); this.hintT = 1.2; this.audio.play('uiok'); }
  }
  updateCamera(dt) {
    const P = this.player, C = this.cam;
    let eye, tgt;
    if (this.demo) {
      const B = this.world.beacon, a = this.time * 0.05; tgt = madd(P.p, [0, 1, 0], -20); eye = [P.p[0] + Math.cos(a) * 240, P.p[1] + 60, P.p[2] + Math.sin(a) * 240];
      C.p = vdamp(C.p, eye, 2, dt); C.t = vdamp(C.t, tgt, 5, dt); C.fov = 0.95;
    } else if (this.lit && this.endT > 1.2) {
      const B = this.world.beacon, a = this.endT * 0.25 + 0.8; tgt = [B.x, B.top + 400, B.z]; eye = [B.x + Math.cos(a) * 1500, B.top + 650, B.z + Math.sin(a) * 1500];
      C.p = vdamp(C.p, eye, 1.5, dt); C.t = vdamp(C.t, tgt, 2, dt); C.fov = damp(C.fov, 1.0, 2, dt);
    } else {
      const v = P.vel(), hv = Math.hypot(v[0], v[2]);
      const dir = P.grounded || hv < 20 ? P.fwd() : norm([v[0], 0, v[2]]);
      const fwdH = norm([dir[0], 0, dir[2]]), sp = clamp(P.s / 460, 0, 1);
      const back = 110 + sp * 50, high = 38 + Math.max(-0.4, -P.pitch) * 40;
      eye = [P.p[0] - fwdH[0] * back, P.p[1] + high - P.pitch * 55, P.p[2] - fwdH[2] * back];
      tgt = madd(P.p, P.fwd(), 60); tgt[1] += 10;
      // keep camera above the cloud sea and out of the islands
      const gb = groundBelow(this.world.islands, eye); if (eye[1] < gb + 20) eye[1] = gb + 20;
      if (P.dead) { eye = madd(C.p, [0, 1, 0], dt * 40); tgt = P.p; }
      C.p = vdamp(C.p, eye, P.dashT > 0 ? 6 : 8, dt); C.t = vdamp(C.t, tgt, 14, dt);
      C.fov = damp(C.fov, 1.08 + sp * 0.32 + (P.dashT > 0 ? 0.12 : 0), 4, dt);
    }
    C.shake = Math.max(0, C.shake - dt * 2);
    const sk = C.shake * C.shake * 8, sh = [(Math.random() - 0.5) * sk, (Math.random() - 0.5) * sk, (Math.random() - 0.5) * sk];
    this.R.camera(add(C.p, sh), add(C.t, sh), C.fov);
  }
  // ---------- rendering
  render() {
    const R = this.R, M = this.M, P = this.player, W = this.W, t = this.time; R.time = this.app.clock;
    // storm tint on fog when outside
    const E = this.env; E.fogN = this.outside ? 200 : W.env.fogN; E.fogF = this.outside ? 2200 : (this.lit ? E.fogF : W.env.fogF);
    R.begin();
    const I = m4();
    const eye = R.eye, F = R.camF, far = (E.fogF || 9000) + 400, tanH = Math.tan(0.62 * (this.cam.fov || 1.1)) * Math.max(1, R.w / R.h) + 0.15;
    for (const c of this.chunks) {
      const dx = c.c[0] - eye[0], dy = c.c[1] - eye[1], dz = c.c[2] - eye[2], d = Math.hypot(dx, dy, dz);
      if (d - c.r > far) continue;
      const along = dx * F[0] + dy * F[1] + dz * F[2];
      if (along < -c.r) continue;
      if (d > c.r && along > 0 && Math.sqrt(Math.max(0, d * d - along * along)) - c.r > along * tanH * 1.2) continue;
      R.draw(c.s, I); R.draw(c.f, I, { sway: 0.03 });
    }
    // shrines flames
    for (const s of this.world.shrines) R.draw(M.flame, trs([s.p[0], s.p[1] + 58, s.p[2]], t, s.lit ? 0.4 + Math.sin(t * 9) * 0.03 : 0.12), { tint: s.lit ? null : [0.3, 0.3, 0.35, 0.8] });
    // beacon flame
    const B = this.world.beacon, bc = this.lit ? 1.6 : 0.2 + this.charge * 1.2;
    R.draw(M.flame, trs([B.x, B.top + 328, B.z], t * 0.5, bc * (1 + Math.sin(t * 7) * 0.04)), { tint: this.charge > 0 || this.lit ? null : [0.2, 0.2, 0.25, 0.85] });
    // rings & feathers
    for (const g of this.world.rings) R.draw(g.hit ? M.ringHit : M.ring, trs(g.p, g.yaw, 1 + g.pulse * 0.4), { emit: g.hit ? 0 : 0.2 + Math.sin(t * 4) * 0.15, tint: g.hit ? [0.4, 0.4, 0.45, 0.6] : null });
    for (const f of this.world.feathers) if (!f.got) R.draw(M.feather, trs([f.p[0], f.p[1] + Math.sin(t * 2) * 8, f.p[2]], t * 1.5, 1.2, 0, Math.sin(t) * 0.2), { emit: 0.3 });
    // characters
    P.render(R, M);
    for (const e of this.enemies) e.render(R, M);
    if (this.boss) this.boss.render(R, M);
    if (this.mp) this.mp.render(R, M);
    // shadow
    const gb = groundBelow(this.world.islands, P.p);
    if (gb > -1e8 && !P.dead) { const h = P.p[1] - gb; if (h < 900) R.drawBlend(M.shadow, trs([P.p[0], gb + 2, P.p[2]], 0, 16 + h * 0.03), { alpha: clamp(0.45 - h / 2000, 0.05, 0.45) }); }
    // additive: beacon light column, storm wall
    if (this.lit || this.charge > 0) R.drawAdd(M.column, trs([B.x, B.top + 330, B.z], t * 0.2, this.lit ? 1.4 : 0.4 + this.charge), { alpha: this.lit ? 0.5 : 0.12 + this.charge * 0.2 });
    if (this.stormR < 25000 && !this.demo) R.drawBlend(M.storm, mul2(trs([0, 0, 0], t * 0.03, 1), this.stormR), { alpha: 0.9, vAlpha: true });
    // ember particles + effect particles
    const glow = [];
    for (const e of this.world.embers) if (!e.got && dist(e.p, P.p) < 5000) { const k = 0.8 + Math.sin(t * 5 + e.ph) * 0.2; glow.push({ p: e.p, s: 9 * k, c: [1, 0.78, 0.35], a: 1 }); glow.push({ p: e.p, s: 3.2, c: [1, 1, 0.9], a: 1 }); }
    for (const f of this.world.feathers) if (!f.got) glow.push({ p: f.p, s: 70 + Math.sin(t * 3) * 10, c: [1, 0.85, 0.5], a: 0.35 });
    for (const s of this.world.shrines) glow.push({ p: [s.p[0], s.p[1] + 70, s.p[2]], s: s.lit ? 90 : 30, c: s.lit ? W.pal.accent : [0.5, 0.5, 0.6], a: 0.5 });
    glow.push({ p: [B.x, B.top + 360, B.z], s: 120 + this.charge * 500 + (this.lit ? 900 : 0), c: W.pal.accent, a: 0.45 });
    for (const b of this.bolts) if (b.t > 0) glow.push({ p: b.p, s: 220 * (1.4 - b.t), c: [0.6, 0.8, 1], a: 0.25 });
    for (const e of this.enemies) if (e.type === 'drifter') glow.push({ p: madd(e.p, e.fwd, 11), s: 22, c: [0.7, 0.3, 1], a: 0.6 });
    if (this.inZone) glow.push({ p: P.p, s: 50, c: P.trail[0], a: 0.4 });
    if (this.mp) this.mp.glow(glow, t);
    const [add_, alpha_] = this.particles.build();
    R.particles(alpha_, 'alpha'); R.particles(glow.concat(add_), 'add');
    R.end();
  }
  hud() {
    const P = this.player, B = this.world.beacon;
    return { flame: P.flame / P.maxFlame, sta: P.sta / P.maxSta, carried: this.carried, need: this.need, charge: this.charge, time: this.time, stormLeft: Math.max(0, this.stormT - this.time), outside: this.outside, dash: 1 - P.dashCD / P.dashCDMax, flare: 1 - P.flareCD / 1.4, feathers: this.feathers, boss: (this.boss && !this.boss.dead) ? this.boss.alive / 3 : (this.mp && this.mp.boss && !this.mp.boss.dead) ? this.mp.boss.alive / 3 : null, inZone: this.inZone, lit: this.lit, beaconP: [B.x, B.top + 340, B.z], speed: P.s, leeched: P.leeched, combo: this.combo, dead: P.dead, mp: this.mp ? this.mp.hud() : null };
  }
}
function mul2(M, s) { const o = new Float32Array(M); o[0] *= s; o[2] *= s; o[8] *= s; o[10] *= s; return o; }

/** shared model set for a world (+ phoenix skins are made per player via phoenixModels) */
export function phoenixModels(R, lib, skin) {
  const sp = skinPal(skin);
  const k = { emitK: 0.42 }, km = { emitK: 0.42, mirror: true };
  return { body: R.upload(lib.mesh('phoenix_body', sp, k)), tail: R.upload(lib.mesh('phoenix_tail', sp, k)),
    wiR: R.upload(lib.mesh('phoenix_wing_in', sp, k)), wiL: R.upload(lib.mesh('phoenix_wing_in', sp, km)),
    woR: R.upload(lib.mesh('phoenix_wing_out', sp, k)), woL: R.upload(lib.mesh('phoenix_wing_out', sp, km)) };
}
export function makeModels(R, lib, W, skin) {
  const wp = worldPal(W.pal), white = () => [[1, 1, 1], [1, 1, 1]];
  return Object.assign(phoenixModels(R, lib, skin), {
    drifter: R.upload(lib.mesh('drifter', enemyPal('drifter'))), lancer: R.upload(lib.mesh('lancer', enemyPal('lancer'))), leech: R.upload(lib.mesh('leech', enemyPal('leech'))),
    orb: R.upload(lib.mesh('orb', enemyPal('orb'))), maw: R.upload(lib.mesh('maw', enemyPal('maw'))), core: R.upload(lib.mesh('core', enemyPal('core'))),
    ring: R.upload(lib.mesh('gate', wp, { emitK: 0.5 })), ringHit: R.upload(lib.mesh('gate', white, { emitK: 0.2 })), feather: R.upload(lib.mesh('feather', wp, { emitK: 0.7 })),
    flame: R.upload(MD.flameMesh(W.pal.accent)), column: R.upload(MD.column(mixc(W.pal.accent, [1, 1, 1], 0.4))),
    storm: R.upload(MD.stormWall()), shadow: R.upload(MD.shadowDisc()) });
}
