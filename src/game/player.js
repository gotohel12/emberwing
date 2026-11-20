// ARVEX SURVIVAL — first-person player: movement (camera-relative WASD), physics, vitals, status effects
// Axis convention (fixed): yaw = 0 looks toward -Z. forward = (sin yaw, 0, -cos yaw), right = (cos yaw, 0, sin yaw).
// W = +forward, S = -forward, D = +right, A = -right. Mouse right → yaw increases → turn right.
import { clamp, damp, lerp } from '../core/math.js';
import { WATER } from '../world/terrain.js';

export const MOVE = {
  walk: 3.0, run: 4.6, sprint: 7.2, crouch: 1.9, swim: 2.6, accel: 11, airAccel: 2.2, decel: 13, jump: 5.4, gravity: 19,
  eye: 1.62, eyeCrouch: 1.02, height: 1.8, heightCrouch: 1.15, radius: 0.34
};

export class Player {
  constructor(spawn) {
    this.pos = spawn.slice(); this.vel = [0, 0, 0]; this.yaw = 0; this.pitch = 0;
    this.onGround = false; this.crouch = 0; this.swimming = false; this.headUnder = false;
    this.hp = 100; this.food = 70; this.water = 70; this.stam = 100; this.temp = 20; this.comfort = 0;
    this.effects = {}; // bleed, poison, regen, wet, cold, comfort, wellfed
    this.dead = false; this.bob = 0; this.bobAmp = 0; this.land = 0; this.fallStart = null;
    this.camY = MOVE.eye; this.speedNow = 0; this.sprinting = false; this.armor = 0; this.ins = 0;
    this.stepDist = 0; this.lastHit = 0; this.kills = 0;
  }
  forward() { return [Math.sin(this.yaw), 0, -Math.cos(this.yaw)]; }
  right() { return [Math.cos(this.yaw), 0, Math.sin(this.yaw)]; }
  lookDir() { const cp = Math.cos(this.pitch); return [Math.sin(this.yaw) * cp, Math.sin(this.pitch), -Math.cos(this.yaw) * cp]; }
  eye() { return [this.pos[0], this.pos[1] + this.camY, this.pos[2]]; }
  /** in: {mx,my (look deltas, radians), move:[x,z] (x=right, z=forward, -1..1), sprint, crouch, jump} */
  update(dt, inp, world, ctx) {
    if (this.dead) return;
    // ---- look
    this.yaw += inp.lookX; this.pitch = clamp(this.pitch + inp.lookY, -1.52, 1.52);
    // ---- water state
    const feetY = this.pos[1], terr = world.height(this.pos[0], this.pos[2]);
    const depth = WATER - terr, wasSwim = this.swimming;
    this.swimming = depth > 1.25 && feetY < WATER - 0.9;
    this.headUnder = this.pos[1] + this.camY < WATER - 0.05 + Math.sin(ctx.t * 1.3) * 0.05 && depth > 0.3;
    // ---- crouch
    const wantCrouch = inp.crouch && !this.swimming;
    if (!wantCrouch && this.crouch > 0.5) { const ceil = world.ceiling(this.pos[0], this.pos[2], this.pos[1], MOVE.height); if (ceil < this.pos[1] + MOVE.height + 0.05) { inp.crouch = true; } }
    this.crouch = damp(this.crouch, (inp.crouch && !this.swimming) ? 1 : 0, 12, dt);
    // ---- target speed
    const mv = inp.move, mlen = Math.min(1, Math.hypot(mv[0], mv[1]));
    const tired = this.stam < 4, wantSprint = inp.sprint && mv[1] > 0.3 && !this.swimming && this.crouch < 0.5 && !tired && !ctx.aiming;
    this.sprinting = wantSprint && mlen > 0.1;
    let speed = this.swimming ? MOVE.swim : this.crouch > 0.5 ? MOVE.crouch : this.sprinting ? MOVE.sprint : inp.walk ? MOVE.walk : MOVE.run;
    if (ctx.aiming) speed = Math.min(speed, MOVE.walk); if (ctx.encumber) speed *= ctx.encumber;
    if (this.effects.cold > 0.5) speed *= 0.9; if (this.hp < 20) speed *= 0.85;
    const f = this.forward(), r = this.right();
    // camera-relative wish direction: right * x + forward * z  (W → +forward, D → +right)
    let wx = r[0] * mv[0] + f[0] * mv[1], wz = r[2] * mv[0] + f[2] * mv[1]; const wl = Math.hypot(wx, wz); if (wl > 1) { wx /= wl; wz /= wl; }
    const tvx = wx * speed, tvz = wz * speed;
    // ---- horizontal acceleration (smooth accel / decel)
    const acc = this.onGround || this.swimming ? (mlen > 0.05 ? MOVE.accel : MOVE.decel) : MOVE.airAccel;
    this.vel[0] = damp(this.vel[0], tvx, acc, dt); this.vel[2] = damp(this.vel[2], tvz, acc, dt);
    // ---- vertical
    if (this.swimming) {
      const surf = WATER - 1.25; let vy = (surf - this.pos[1]) * 3; if (inp.jump) vy += 2.4; if (inp.crouch) vy -= 3;
      this.vel[1] = damp(this.vel[1], vy, 4, dt); this.fallStart = null;
    } else {
      this.vel[1] -= MOVE.gravity * dt;
      if (inp.jumpPress && this.onGround && this.stam > 6 && this.crouch < 0.5) { this.vel[1] = MOVE.jump; this.onGround = false; this.stam -= 7; ctx.sfx && ctx.sfx('jump'); }
    }
    // ---- integrate with collision (substeps keep fast movement stable)
    const steps = Math.max(1, Math.ceil(Math.hypot(this.vel[0], this.vel[2]) * dt / 0.25));
    const h = lerp(MOVE.height, MOVE.heightCrouch, this.crouch);
    for (let s = 0; s < steps; s++) {
      const sdt = dt / steps;
      let nx = this.pos[0] + this.vel[0] * sdt, nz = this.pos[2] + this.vel[2] * sdt, ny = this.pos[1] + this.vel[1] * sdt;
      [nx, nz] = world.collide(nx, nz, ny, h, MOVE.radius);
      if (!world.T.inBounds(nx, nz)) { nx = this.pos[0]; nz = this.pos[2]; }
      const g = world.ground(nx, nz, ny, this.onGround ? 0.6 : 0.25);
      // steep slopes: slide back instead of climbing
      const nrm = world.T.normal(nx, nz), onTerrain = Math.abs(g - world.height(nx, nz)) < 0.05;
      if (onTerrain && nrm[1] < 0.62 && g > this.pos[1] + 0.02 && !this.swimming) { nx = this.pos[0] + nrm[0] * 0.02; nz = this.pos[2] + nrm[2] * 0.02; }
      const ceil = world.ceiling(nx, nz, ny, h); if (ny + h > ceil && this.vel[1] > 0) { ny = ceil - h; this.vel[1] = 0; }
      if (ny <= g + 0.001) {
        if (!this.onGround && this.vel[1] < -3) this.landed(-this.vel[1], ctx);
        ny = g; if (this.vel[1] < 0) this.vel[1] = 0; this.onGround = true;
      } else if (this.onGround && ny - g < 0.45 && this.vel[1] <= 0 && !this.swimming) { ny = g; this.vel[1] = 0; } // stick to slopes / stairs going down
      else this.onGround = false;
      this.pos[0] = nx; this.pos[1] = ny; this.pos[2] = nz;
    }
    if (this.swimming) this.onGround = false;
    // ---- stamina
    const hs = Math.hypot(this.vel[0], this.vel[2]); this.speedNow = hs;
    if (this.sprinting && hs > 2) this.stam -= 13 * dt; else if (this.swimming && hs > 0.5) this.stam -= 3 * dt;
    else this.stam += (this.onGround ? 16 : 6) * dt * (this.food > 10 ? 1 : 0.4) * (this.water > 10 ? 1 : 0.5);
    this.stam = clamp(this.stam, 0, 100);
    // ---- camera: eye height, bob, landing dip
    this.camY = damp(this.camY, lerp(MOVE.eye, MOVE.eyeCrouch, this.crouch), 14, dt);
    const moving = this.onGround && hs > 0.5;
    this.bobAmp = damp(this.bobAmp, moving ? Math.min(1, hs / MOVE.sprint) : 0, 8, dt);
    this.bob += hs * dt * (this.sprinting ? 1.35 : 1.6);
    this.land = damp(this.land, 0, 8, dt);
    if (moving) { this.stepDist += hs * dt; const stride = this.sprinting ? 2.2 : this.crouch > 0.5 ? 1.2 : 1.7; if (this.stepDist > stride) { this.stepDist = 0; ctx.step && ctx.step(this); } }
    if (this.swimming && !wasSwim) ctx.sfx && ctx.sfx('splash');
  }
  landed(v, ctx) {
    this.land = Math.min(0.25, v * 0.02); ctx.sfx && ctx.sfx('land', Math.min(1, v / 12));
    if (v > 11) { const dmg = (v - 11) * 7; this.damage(dmg, 'fall', ctx); if (dmg > 20) this.effects.bleed = Math.max(this.effects.bleed || 0, 10); }
  }
  /** damage with armour; type: melee|animal|arrow|fall|cold|starve|thirst|bleed|poison|drown */
  damage(n, type, ctx, src) {
    if (this.dead || n <= 0) return 0;
    let d = n; if (['melee', 'animal', 'arrow'].includes(type)) d *= 1 - clamp(this.armor, 0, 0.7);
    this.hp -= d; this.lastHit = ctx.t; this.lastHitType = type; this.lastHitSrc = src;
    if (ctx.onHurt) ctx.onHurt(d, type, src);
    if (this.hp <= 0) { this.hp = 0; this.dead = true; this.deathCause = type; if (ctx.onDeath) ctx.onDeath(type, src); }
    return d;
  }
  /** vitals tick: hunger, thirst, temperature, effects */
  vitals(dt, env, ctx) {
    if (this.dead) return;
    const act = this.sprinting ? 2.2 : this.speedNow > 0.5 ? 1.3 : 1;
    this.food = clamp(this.food - dt * 0.055 * act, 0, 100); this.water = clamp(this.water - dt * 0.085 * act * (this.temp > 30 ? 1.4 : 1), 0, 100);
    // temperature: ambient + insulation + fire − wet
    const wet = this.effects.wet || 0;
    let target = env.temp + this.ins - wet * 7 + (ctx.fireWarmth || 0) + (this.swimming ? -6 : 0);
    this.temp = damp(this.temp, target, 0.25, dt);
    if (this.swimming || env.rain > 0.2 && !ctx.sheltered) this.effects.wet = Math.min(30, wet + dt * (this.swimming ? 6 : env.rain * 1.5)); else if (wet > 0) this.effects.wet = Math.max(0, wet - dt * ((ctx.fireWarmth || 0) > 0 ? 2 : 0.4));
    this.effects.cold = this.temp < 5 ? clamp((5 - this.temp) / 10, 0, 1) : 0;
    this.effects.comfort = (ctx.fireWarmth || 0) > 2 || ctx.sheltered ? 1 : 0;
    this.effects.wellfed = this.food > 80 && this.water > 70 ? 1 : 0;
    if (this.effects.cold > 0) this.damage(dt * this.effects.cold * 0.9, 'cold', ctx);
    if (this.food <= 0) this.damage(dt * 0.6, 'starve', ctx); if (this.water <= 0) this.damage(dt * 0.9, 'thirst', ctx);
    if (this.effects.bleed > 0) { const b = Math.min(this.effects.bleed, dt * 1.2); this.effects.bleed -= b; this.damage(b, 'bleed', ctx); if (this.effects.bleed <= 0) delete this.effects.bleed; }
    if (this.effects.poison > 0) { const p = Math.min(this.effects.poison, dt * 0.8); this.effects.poison -= p; this.damage(p, 'poison', ctx); this.food = Math.max(0, this.food - p * 0.5); if (this.effects.poison <= 0) delete this.effects.poison; }
    if (this.effects.regen > 0) { const r = Math.min(this.effects.regen, dt * 3); this.effects.regen -= r; this.hp = Math.min(100, this.hp + r); if (this.effects.regen <= 0) delete this.effects.regen; }
    if (this.headUnder) { this.air = (this.air == null ? 12 : this.air) - dt; if (this.air < 0) this.damage(dt * 8, 'drown', ctx); } else this.air = Math.min(12, (this.air == null ? 12 : this.air) + dt * 4);
    // natural regen when fed and comfortable
    if (this.food > 50 && this.water > 50 && !this.effects.bleed && !this.effects.poison && ctx.t - this.lastHit > 8) this.hp = Math.min(100, this.hp + dt * (this.effects.comfort ? 0.35 : 0.12) * (this.effects.wellfed ? 2 : 1));
  }
  serialize() { return { pos: this.pos.map(v => +v.toFixed(2)), yaw: +this.yaw.toFixed(3), pitch: +this.pitch.toFixed(3), hp: +this.hp.toFixed(1), food: +this.food.toFixed(1), water: +this.water.toFixed(1), stam: Math.round(this.stam), temp: +this.temp.toFixed(1), effects: this.effects }; }
  restore(s) { if (!s) return; Object.assign(this, { pos: s.pos.slice(), yaw: s.yaw, pitch: s.pitch, hp: s.hp, food: s.food, water: s.water, stam: s.stam, temp: s.temp, effects: s.effects || {} }); this.dead = this.hp <= 0; }
}
