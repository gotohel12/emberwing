// EMBERWING — the Hollow: Drifter (chaser), Lancer (telegraphed charge), Leech (ember thief), void orbs, Hollow Maw boss
import { add, sub, scl, madd, norm, len, dist, clamp, damp, basis, TAU, lerp } from '../core/math.js';

const PURPLE = [0.7, 0.36, 1], PINK = [1, 0.24, 0.55], GREEN = [0.36, 1, 0.7];
let UID = 1;
export class Enemy {
  constructor(type, p, anchor) {
    this.id = UID++; this.type = type; this.p = p.slice(); this.v = [0, 0, 0]; this.anchor = anchor || p.slice();
    this.state = 'patrol'; this.t = Math.random() * 10; this.stun = 0; this.dead = false; this.fwd = [0, 0, -1];
    this.r = type === 'drifter' ? 16 : type === 'lancer' ? 14 : type === 'orb' ? 12 : 10;
    this.cool = 0; this.aim = null; this.attached = 0; this.life = type === 'orb' ? 7 : 1e9;
  }
  update(dt, g) {
    const P = this.attached > 0 && this.attTo ? this.attTo : g.mp ? g.mp.targetFor(this) : g.player, toP = sub(P.p, this.p), d = len(toP), k = g.diff.enemy;
    this.t += dt; this.stun = Math.max(0, this.stun - dt); this.cool = Math.max(0, this.cool - dt);
    if (this.type === 'orb') { this.life -= dt; if (this.life <= 0) this.dead = true; }
    if (this.stun > 0) { this.v = scl(this.v, Math.exp(-2 * dt)); this.p = madd(this.p, this.v, dt); return; }
    let want = [0, 0, 0], spd = 0;
    if (this.type === 'drifter') {
      if (d < 750 && !P.dead) { this.state = 'chase'; want = norm(toP); spd = 150 * k; }
      else { this.state = 'patrol'; const a = this.t * 0.4; const tgt = [this.anchor[0] + Math.cos(a) * 260, this.anchor[1] + Math.sin(this.t * 0.7) * 60, this.anchor[2] + Math.sin(a) * 260]; want = norm(sub(tgt, this.p)); spd = 70; }
      this.v = add(scl(this.v, Math.exp(-1.8 * dt)), scl(want, spd * 1.8 * dt));
      if (len(this.v) > spd) this.v = scl(norm(this.v), spd);
      if (Math.random() < 0.4) g.particles.emit({ p: madd(this.p, [Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5], 18), v: [0, 10, 0], life: 0.9, s0: 9, s1: 18, c0: [0.12, 0.05, 0.2], c1: [0.05, 0.02, 0.08], a: 0.55, blend: 'alpha' });
    } else if (this.type === 'lancer') {
      if (this.state === 'charge') {
        this.p = madd(this.p, this.v, dt); this.chargeT -= dt;
        g.particles.emit({ p: this.p.slice(), v: [0, 0, 0], life: 0.4, s0: 10, s1: 2, c0: PINK, c1: [0.3, 0, 0.2], a: 0.9 }, 1);
        if (this.chargeT <= 0) { this.state = 'patrol'; this.cool = 2.6 / k; this.v = scl(this.v, 0.1); }
        this.fwd = norm(this.v); return;
      }
      if (this.state === 'aim') {
        this.aimT -= dt; this.aim = madd(P.p, P.vel(), 0.25); this.fwd = norm(sub(this.aim, this.p));
        if (Math.random() < 0.6) g.particles.emit({ p: madd(this.p, this.fwd, 30 + Math.random() * 300), v: [0, 0, 0], life: 0.15, s0: 4, c0: PINK, a: 0.7 });
        if (this.aimT <= 0) { this.state = 'charge'; this.chargeT = 1.5; this.v = scl(this.fwd, 680 * Math.min(1.25, k)); g.audio.play('lancer'); }
        this.v = scl(this.v, Math.exp(-4 * dt)); this.p = madd(this.p, this.v, dt); return;
      }
      if (d < 1100 && this.cool <= 0 && !P.dead) { this.state = 'aim'; this.aimT = 1.15 / Math.min(1.2, k); g.audio.play('warn'); }
      const a = this.t * 0.3; const tgt = [this.anchor[0] + Math.cos(a) * 320, this.anchor[1] + 80, this.anchor[2] + Math.sin(a) * 320];
      want = norm(sub(tgt, this.p)); spd = 90; this.v = add(scl(this.v, Math.exp(-2 * dt)), scl(want, spd * 2 * dt)); this.fwd = norm(this.v[0] || this.v[2] ? this.v : [0, 0, -1]);
    } else if (this.type === 'leech') {
      if (this.attached > 0) {
        this.attached -= dt; const off = [Math.sin(this.t * 3) * 10, -6, Math.cos(this.t * 3) * 10]; this.p = add(P.p, off);
        this.drain = (this.drain || 0) + dt; if (this.drain > 0.55) { this.drain = 0; if (P.remote && g.mp.pvp) g.mp.ev('drain'); else if (g.carried > 0) { g.carried--; g.audio.play('leech'); g.particles.emit({ p: P.p.slice(), v: [0, 60, 0], life: 0.6, s0: 6, s1: 1, c0: [1, 0.7, 0.3], c1: GREEN, a: 1 }); } }
        if (this.attached <= 0 || P.dashT > 0 || P.dead) { this.attached = 0; this.attTo = null; this.stun = 1.5; this.v = [0, 150, 0]; if (P.dashT > 0) this.kill(g); }
        return;
      }
      if (d < 900 && !P.dead) { want = norm(toP); spd = 210 * k; } else { const a = this.t * 0.5; const tgt = [this.anchor[0] + Math.cos(a) * 200, this.anchor[1] - 60, this.anchor[2] + Math.sin(a) * 200]; want = norm(sub(tgt, this.p)); spd = 80; }
      this.v = add(scl(this.v, Math.exp(-2.5 * dt)), scl(want, spd * 2.5 * dt)); if (len(this.v) > spd) this.v = scl(norm(this.v), spd);
    } else if (this.type === 'orb') {
      want = norm(toP); this.v = add(scl(this.v, Math.exp(-0.8 * dt)), scl(want, 260 * dt)); if (len(this.v) > 240) this.v = scl(norm(this.v), 240);
      g.particles.emit({ p: this.p.slice(), v: [0, 0, 0], life: 0.5, s0: 14, s1: 2, c0: [0.8, 0.3, 1], c1: [0.2, 0, 0.4], a: 0.8 });
    }
    this.p = madd(this.p, this.v, dt);
    if (len(this.v) > 1) this.fwd = norm(this.v);
  }
  kill(g) {
    if (this.dead) return; this.dead = true; g.kills++; if (g.mp) g.mp.onKill(this);
    const c = this.type === 'lancer' ? PINK : this.type === 'leech' ? GREEN : PURPLE;
    g.particles.emit(() => ({ p: this.p.slice(), v: [(Math.random() - 0.5) * 500, (Math.random() - 0.5) * 500, (Math.random() - 0.5) * 500], life: 0.8, s0: 10, s1: 1, c0: c, c1: [0.1, 0, 0.2], drag: 3 }), 26);
    g.particles.emit({ p: this.p.slice(), life: 0.35, s0: 20, s1: 120, c0: [1, 0.9, 1], c1: c, a: 0.8 });
    g.audio.play('kill'); if (this.type !== 'orb') { g.dropEmbers(this.p, this.type === 'drifter' ? 3 : 2); }
  }
  render(R, M) {
    const m = this.type === 'drifter' ? M.drifter : this.type === 'lancer' ? M.lancer : this.type === 'leech' ? M.leech : M.orb;
    const glow = this.type === 'lancer' && this.state === 'aim' ? 0.4 + 0.4 * Math.sin(this.t * 30) : this.stun > 0 ? 0.3 : 0;
    const s = this.type === 'drifter' ? 1 + Math.sin(this.t * 3) * 0.05 : 1;
    R.draw(m, basis(this.p, this.fwd, [0, 1, 0], s), { emit: glow, tint: this.stun > 0 ? [1, 1, 1, 0.25] : null });
  }
}

export class Maw {
  constructor(center) { this.c = center; this.p = center.slice(); this.t = 0; this.phase = 'closed'; this.pt = 4; this.cores = [0, 1, 2].map(i => ({ a: i / 3 * TAU, alive: true, hot: false })); this.shot = 1.5; this.dead = false; this.deathT = 0; this.hitFlash = 0; this.enter = 0; }
  get alive() { return this.cores.filter(c => c.alive).length; }
  corePos(c) { return [this.p[0] + Math.cos(c.a + this.t * 0.35) * 320, this.p[1] + Math.sin(c.a + this.t * 0.35) * 320, this.p[2]]; }
  update(dt, g) {
    this.t += dt; this.hitFlash = Math.max(0, this.hitFlash - dt); this.enter = Math.min(1, this.enter + dt * 0.4);
    if (this.dead) { this.deathT += dt; if (Math.random() < 0.6) g.particles.emit({ p: madd(this.p, [Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5], 400), v: [0, 0, 0], life: 0.8, s0: 40, s1: 140, c0: [1, 0.8, 1], c1: [0.4, 0.1, 0.6], a: 0.8 }); return; }
    const PL = g.mp ? g.mp.players().filter(q => !q.dead) : [g.player];
    const P = PL.length ? PL.reduce((a, b) => dist(a.p, this.p) < dist(b.p, this.p) ? a : b) : g.player;
    const hurt = (Q, d, from) => { if (Q.remote) { if (Q.hurtCD <= 0) { Q.hurtCD = 0.9; g.mp.ev('hurt', { d, f: from.map(v => Math.round(v)) }); } } else Q.hurt(d, from); };
    // hover facing the player, keep between player and beacon
    const tgt = [this.c[0] + Math.sin(this.t * 0.3) * 250, this.c[1] + Math.sin(this.t * 0.5) * 80, this.c[2] + Math.cos(this.t * 0.3) * 250];
    this.p = [damp(this.p[0], tgt[0], 0.8, dt), damp(this.p[1], tgt[1], 0.8, dt), damp(this.p[2], tgt[2], 0.8, dt)];
    this.face = norm([P.p[0] - this.p[0], 0, P.p[2] - this.p[2]]);
    this.pt -= dt;
    if (this.phase === 'closed') {
      this.shot -= dt; if (this.shot <= 0) { this.shot = 1.3 / g.diff.enemy; g.spawnEnemy('orb', madd(this.p, norm(sub(P.p, this.p)), 160)); }
      if (this.pt <= 0) { this.phase = 'open'; this.pt = 5.5; const alive = this.cores.filter(c => c.alive); const c = alive[Math.floor(Math.random() * alive.length)]; if (c) c.hot = true; g.audio.play('boss'); g.toast('النواة مكشوفة — اندفع فيها!', 'hot'); }
    } else {
      if (this.pt <= 0) { this.phase = 'closed'; this.pt = 4.5; this.cores.forEach(c => c.hot = false); if (Math.random() < 0.6) g.spawnEnemy('drifter', madd(this.p, [Math.random() - 0.5, -0.3, Math.random() - 0.5], 400)); }
    }
    for (const c of this.cores) {
      if (!c.alive) continue; const cp = this.corePos(c);
      const hitter = c.hot ? PL.find(Q => dist(cp, Q.p) < 70 && Q.dashT > 0) : null;
      if (hitter) {
        c.alive = false; c.hot = false; this.hitFlash = 0.6; this.phase = 'closed'; this.pt = 3.5; g.shake(1.2); g.flash([1, 0.8, 1], 0.6); g.audio.play('beacon');
        g.particles.emit(() => ({ p: cp, v: [(Math.random() - 0.5) * 900, (Math.random() - 0.5) * 900, (Math.random() - 0.5) * 900], life: 1.2, s0: 18, s1: 1, c0: [1, 0.5, 0.9], c1: [0.3, 0, 0.5], drag: 2 }), 60);
        if (this.alive === 0) { this.dead = true; g.toast('الفم الأجوف انهزم!', 'gold'); }
        else g.toast(`باقي ${this.alive} نواة`, 'hot');
        if (g.mp) g.mp.onCore(this.alive);
      } else if (!c.hot) for (const Q of PL) if (dist(cp, Q.p) < 60) hurt(Q, 14, cp);
    }
    for (const Q of PL) if (dist(this.p, Q.p) < 230) hurt(Q, 25, this.p);
  }
  render(R, M) {
    const sc = this.dead ? Math.max(0.01, 1 - this.deathT * 0.4) : this.enter;
    R.draw(M.maw, basis(this.p, this.face || [0, 0, 1], [0, 1, 0], sc), { emit: this.phase === 'open' ? 0.2 : 0, tint: this.hitFlash > 0 ? [1, 1, 1, this.hitFlash] : null });
    if (this.dead) return;
    for (const c of this.cores) if (c.alive) R.draw(M.core, basis(this.corePos(c), [Math.sin(this.t), 0, Math.cos(this.t)], [0, 1, 0], c.hot ? 1.1 + Math.sin(this.t * 12) * 0.08 : 0.8), { emit: c.hot ? 0.6 : 0, tint: c.hot ? null : [0.15, 0.08, 0.25, 0.7] });
  }
}
