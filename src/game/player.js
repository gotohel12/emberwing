// EMBERWING — Ember the phoenix: flight model, abilities, animation, rendering
import { clamp, damp, lerp, add, scl, madd, norm, cross, len, basis, mul, trs, xformPt, TAU } from '../core/math.js';
import { collide, groundBelow } from '../world/build.js';

const G = 270;
export class Player {
  constructor(game, spawn, up) {
    this.g = game; this.up = up || { wing: 0, heart: 0, dash: 0, flare: 0, magnet: 0 };
    this.maxFlame = 100 + this.up.heart * 25; this.maxSta = 100 + this.up.wing * 30;
    this.dashCDMax = 3.2 * (1 - this.up.dash * 0.14); this.flareR = 330 + this.up.flare * 70; this.magnet = 70 + this.up.magnet * 35;
    this.respawn(spawn, 1);
    this.t = 0; this.flapPh = 0; this.wing = { sh: 0.1, el: 0.05, sw: 0 }; this.mPitch = 0; this.lastStroke = 0;
  }
  respawn(sp, flameK) {
    this.p = sp.p.slice(); this.yaw = sp.yaw; this.pitch = 0; this.roll = 0; this.s = 0; this.vy = 0;
    this.flame = this.maxFlame * flameK; this.sta = this.maxSta; this.dashT = 0; this.dashCD = 0; this.flareCD = 0; this.inv = 2; this.grounded = true; this.dead = 0; this.leeched = 0; this.hitT = 0;
  }
  fwd() { const cp = Math.cos(this.pitch); return [-Math.sin(this.yaw) * cp, Math.sin(this.pitch), -Math.cos(this.yaw) * cp]; }
  vel() { return madd(scl(this.fwd(), this.s), [0, 1, 0], this.vy); }
  speed() { return len(this.vel()); }
  hurt(dmg, from) {
    if (this.inv > 0 || this.dashT > 0 || this.dead) return false;
    this.flame -= dmg * this.g.diff.dmg; this.inv = 0.9; this.hitT = 0.35;
    if (from) { const d = norm([this.p[0] - from[0], 0, this.p[2] - from[2]]); this.p = madd(this.p, d, 12); this.vy += 60; }
    this.g.fx('hit'); return true;
  }
  update(dt, inp) {
    const g = this.g; this.t += dt;
    this.takeoffT = Math.max(0, (this.takeoffT || 0) - dt); this.inv = Math.max(0, this.inv - dt); this.dashCD = Math.max(0, this.dashCD - dt); this.flareCD = Math.max(0, this.flareCD - dt); this.hitT = Math.max(0, this.hitT - dt);
    if (this.dead) return;
    const dive = inp.dive > 0.3 && !this.grounded;
    // ---- steering
    if (Math.abs(inp.mx) + Math.abs(inp.my) > 0) { this.yaw -= inp.mx * 0.0024; this.mPitch = clamp(this.mPitch + inp.my * 0.0026, -1.15, 1.0); }
    else this.mPitch = damp(this.mPitch, 0, 0.5, dt);
    const turn = -inp.x * (this.s < 110 ? 2.4 : 1.85) * (this.grounded ? 1.3 : 1);
    this.yaw += turn * dt;
    let pt = clamp(inp.y * 0.85 + this.mPitch, -1.2, 1.0);
    if (dive) pt = -1.15 * inp.dive;
    if (this.s < 38 && !this.grounded && !inp.flap) pt = Math.min(pt, -0.35);
    this.pitch = damp(this.pitch, pt, dive ? 4.5 : 3.2, dt);
    // ---- grounded (perched on an island)
    if (this.grounded) {
      this.sta = Math.min(this.maxSta, this.sta + 40 * dt); this.pitch = 0; this.vy = 0;
      this.s = damp(this.s, inp.y > 0.3 ? 40 : 0, 4, dt);
      if (inp.flap || inp.y > 0.5 || inp.dash) { this.grounded = false; this.vy = 150; this.s = Math.max(this.s, 80); this.p[1] += 6; this.pitch = 0.35; this.takeoffT = 0.7; this.g.audio.play('flap', 1.2); }
      this.p = madd(this.p, this.fwd(), this.s * dt);
      const gb = groundBelow(g.world.islands, this.p); if (gb < this.p[1] - 30) this.grounded = false; else if (gb > -1e8) this.p[1] = gb + 8;
    } else {
      // ---- flight physics
      const flapping = inp.flap && this.sta > 0;
      this.s += -G * Math.sin(this.pitch) * dt * (flapping && this.pitch > 0 ? 0.35 : 1);
      this.s -= this.s * Math.abs(this.s) * (dive ? 0.00055 : 0.0011) * dt;
      if (this.s < 135) this.s += 62 * dt;
      if (inp.flap && this.sta > 0) {
        this.flapPh += dt * 14; this.sta -= 22 * dt; this.vy += 300 * dt; if (this.s < 210) this.s += 85 * dt;
        if (this.flapPh - this.lastStroke > Math.PI * 2) { this.lastStroke = this.flapPh; g.audio.play('flap', 0.8); g.particles.emit(() => ({ p: madd(this.p, [Math.random() - 0.5, -0.5, Math.random() - 0.5], 10), v: [Math.random() * 40 - 20, -60, Math.random() * 40 - 20], life: 0.5, s0: 4, s1: 1, c0: this.trail[0], c1: this.trail[1], drag: 2 }), 6); }
      } else { this.sta = Math.min(this.maxSta, this.sta + 16 * dt); this.flapPh += dt * 2; }
      if (this.s < 38) this.vy -= 70 * dt;
      this.vy -= 22 * dt; this.vy *= Math.exp(-1.6 * dt);
      // dash
      if (inp.dash && this.dashCD <= 0) { this.dashT = 0.55; this.dashCD = this.dashCDMax; this.s = Math.max(this.s, 430); this.vy *= 0.3; g.fx('dash'); }
      if (this.dashT > 0) { this.dashT -= dt; this.s = Math.max(this.s, 380); }
      this.s = clamp(this.s, 0, 460);
      this.p = madd(this.p, this.vel(), dt);
      if (this.p[1] > 2600) this.vy -= (this.p[1] - 2600) * 2 * dt;
    }
    // flare
    if (inp.flare && this.flareCD <= 0) {
      if (g.carried >= 5 || g.diffKey === 'story') { if (g.diffKey !== 'story') g.carried -= 5; this.flareCD = 1.4; g.flare(this.p, this.flareR); }
      else { g.toast('الوهج يحتاج 5 جمرات', 'warn'); this.flareCD = 0.5; g.audio.play('warn'); }
    }
    // ---- collisions with islands
    const c = collide(g.world.islands, this.p, 8);
    if (c) {
      this.p = madd(this.p, c.n, c.d);
      if (c.top) {
        const v = this.vel();
        if (v[1] < -230 || (this.s > 300 && this.pitch < -0.5)) { this.hurt(12); this.vy = 140; g.audio.play('bump', 1); g.shake(0.6); }
        else if (this.s < 150 && !dive && this.dashT <= 0 && this.takeoffT <= 0 && v[1] <= 5 && !inp.flap) { this.grounded = true; this.vy = 0; this.s = Math.min(this.s, 30); }
        else { this.vy = Math.max(this.vy, 30); this.pitch = Math.max(this.pitch, 0.05); }
      } else {
        const fast = this.s > 220; this.s *= 0.45; this.yaw += Math.PI * 0.6 * (Math.random() < 0.5 ? 1 : -1); this.vy += 40;
        g.audio.play('bump', 0.8); g.shake(0.4); if (fast) this.hurt(10);
      }
    }
    // ---- animation pose
    const W = this.wing, k = 10 * dt;
    let sh, el, sw;
    if (this.grounded) { sh = -0.5; el = 0.4; sw = 1.35; }
    else if (this.dashT > 0) { sh = 0.15; el = 0.1; sw = 1.25; }
    else if (dive) { sh = 0.35; el = 0.2; sw = 0.95; }
    else if (inp.flap && this.sta > 0) { sh = Math.sin(this.flapPh) * 0.95 + 0.1; el = Math.sin(this.flapPh - 0.7) * 0.6; sw = 0.1 + Math.cos(this.flapPh) * 0.12; }
    else { sh = 0.1 + Math.sin(this.t * 1.6) * 0.05 - this.pitch * 0.1; el = 0.06 + Math.sin(this.t * 1.6 - 0.5) * 0.04; sw = 0.05 + clamp(this.s / 460, 0, 1) * 0.35; }
    W.sh = lerp(W.sh, sh, Math.min(1, k * 1.5)); W.el = lerp(W.el, el, Math.min(1, k * 1.5)); W.sw = lerp(W.sw, sw, Math.min(1, k));
    const rollT = clamp(turn * 0.42 - inp.mx * 0.004, -1.1, 1.1);
    this.roll = damp(this.roll, this.grounded ? 0 : rollT, 5, dt);
    // fire trail
    const sp = this.s / 460, tips = this.tips || [];
    for (const tp of tips) if (sp > 0.25 || this.dashT > 0) g.particles.emit({ p: tp, v: [0, 0, 0], life: 0.35 + sp * 0.4, s0: 3 + sp * 3, s1: 0.5, c0: this.trail[0], c1: this.trail[1], a: 0.9 }, this.dashT > 0 ? 2 : 0.6);
    if (this.dashT > 0) g.particles.emit(() => ({ p: madd(this.p, [Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5], 14), v: scl(this.fwd(), -120), life: 0.35, s0: 7, s1: 1, c0: this.trail[0], c1: this.trail[1], a: 0.7 }), 3);
    if (this.flame < this.maxFlame * 0.3 && Math.random() < 0.3) g.particles.emit({ p: this.p.slice(), v: [0, 30, 0], life: 0.8, s0: 6, s1: 14, c0: [0.25, 0.22, 0.25], c1: [0.1, 0.1, 0.1], a: 0.5, blend: 'alpha' });
  }
  get trail() { return this.skin.trail; }
  render(R, M) {
    if (this.dead) return;
    const f = this.fwd(), upW = [0, 1, 0], r = norm(cross(f, upW)), u0 = cross(r, f);
    const cr = Math.cos(this.roll), sr = Math.sin(this.roll), u = norm([u0[0] * cr + r[0] * sr, u0[1] * cr + r[1] * sr, u0[2] * cr + r[2] * sr]);
    const bob = this.grounded ? 0 : Math.sin(this.flapPh) * 0.8;
    const B = basis([this.p[0], this.p[1] + bob, this.p[2]], f, u, 1.6);
    const blink = this.inv > 0 && !this.grounded && Math.floor(this.t * 16) % 2 === 0;
    const o = { emit: this.dashT > 0 ? 0.5 : this.hitT > 0 ? 0.6 : 0, tint: this.hitT > 0 ? [1, 1, 1, 0.5] : null };
    if (blink) return;
    R.draw(M.body, B, o);
    R.draw(M.tail, mul(B, trs([0, 0.6, 6.5], 0, 1, -this.pitch * 0.3 + (this.grounded ? 0.5 : 0), 0)), o);
    const W = this.wing, tips = [];
    for (const s of [1, -1]) {
      const inner = mul(B, trs([s * 2.8, 0.9, -1.2], -s * W.sw, 1, 0, s * W.sh));
      const outer = mul(inner, trs([s * 12, 0, 0], -s * W.sw * 0.6, 1, 0, s * W.el));
      R.draw(s > 0 ? M.wiR : M.wiL, inner, o); R.draw(s > 0 ? M.woR : M.woL, outer, o);
      tips.push(xformPt(outer, [s * 15, 0, 6]));
    }
    tips.push(xformPt(B, [0, 0.4, 16]));
    this.tips = tips;
  }
}
