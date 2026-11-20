// ARVEX SURVIVAL — animal AI (pure logic: runs on the client in solo and on the server in multiplayer)
// states: idle · wander · flee · chase · attack · dead
import { ANIMALS } from '../gfx/models.js';
import { ANIMAL_LOOT } from './items.js';

export const POP = { deer: 34, boar: 22, wolf: 14, bear: 5 };
const BEHAVIOUR = {
  deer: { aggro: 0, sight: 24, flee: 1, dmg: 0 }, boar: { aggro: 0.5, sight: 12, flee: 0, dmg: 10, rate: 1.2, reach: 1.4 },
  wolf: { aggro: 1, sight: 32, flee: 0.25, dmg: 13, rate: 1.0, reach: 1.6, bleed: 0.35 }, bear: { aggro: 1, sight: 20, flee: 0, dmg: 30, rate: 1.7, reach: 2.1, bleed: 0.6 }
};

export class AnimalSim {
  constructor(terrain, collide, seed = 7) {
    this.T = terrain; this.collide = collide; this.list = []; this.uid = 1; this.r = mk(seed); this.t = 0; this.spawnT = 0;
  }
  goodSpot(type, x, z) {
    const h = this.T.height(x, z); if (h < 1.5 || h > 95 || this.T.slope(x, z) > 0.38) return false;
    const b = this.T.biome(x, z); if (type === 'bear' || type === 'wolf') return b === 3 || b === 4 || b === 2; if (type === 'deer') return b === 2 || b === 3; return b === 2 || b === 3 || b === 1;
  }
  spawn(type, players) {
    for (let k = 0; k < 40; k++) {
      const x = (this.r() * 2 - 1) * 650, z = (this.r() * 2 - 1) * 650;
      if (!this.goodSpot(type, x, z)) continue;
      if (players.some(p => Math.hypot(p.pos[0] - x, p.pos[2] - z) < 70)) continue;
      const A = ANIMALS[type], a = { id: 'a' + (this.uid++), type, x, y: this.T.height(x, z), z, yaw: this.r() * 6.28, hp: A.hp, state: 'wander', tx: x, tz: z, t: 0, spd: 0, phase: 0, atk: 0, harvest: null, hurtBy: null, hurtT: -99 };
      this.list.push(a); return a;
    }
    return null;
  }
  populate(players, initial) {
    for (const type in POP) { const alive = this.list.filter(a => a.type === type && a.state !== 'dead').length; for (let i = alive; i < POP[type]; i++) if (!this.spawn(type, players) || !initial) break; }
  }
  hurt(a, dmg, by) {
    if (a.state === 'dead') return null;
    a.hp -= dmg; a.hurtBy = by; a.hurtT = this.t;
    if (a.hp <= 0) { a.hp = 0; a.state = 'dead'; a.deadAt = this.t; a.spd = 0; a.harvest = ANIMAL_LOOT[a.type].map(([id, n]) => [id, n]); return 'dead'; }
    const B = BEHAVIOUR[a.type];
    if (B.flee >= 1 || (B.flee > 0 && a.hp < ANIMALS[a.type].hp * B.flee)) { a.state = 'flee'; a.t = 7; a.threat = by; }
    else { a.state = 'chase'; a.target = by; a.t = 25; }
    return 'hurt';
  }
  /** players: [{id, pos, crouch, dead}] ; onAttack(animal, player, dmg, bleed) */
  update(dt, players, onAttack, isNight) {
    this.t += dt;
    this.spawnT -= dt; if (this.spawnT <= 0) { this.spawnT = 20; this.populate(players, false); this.list = this.list.filter(a => !(a.state === 'dead' && this.t - a.deadAt > 300)); }
    for (const a of this.list) {
      // far from every player: cheap update
      let near = null, nd = 1e9; for (const p of players) { if (p.dead) continue; const d = Math.hypot(p.pos[0] - a.x, p.pos[2] - a.z); if (d < nd) { nd = d; near = p; } }
      if (a.state === 'dead') continue;
      const A = ANIMALS[a.type], B = BEHAVIOUR[a.type];
      if (nd > 320) { a.t -= dt; continue; }
      a.t -= dt; a.atk -= dt;
      const sight = B.sight * (isNight && a.type === 'wolf' ? 1.3 : 1) * (near && near.crouch ? 0.55 : 1);
      // perception
      if (a.state === 'wander' || a.state === 'idle') {
        if (near && nd < sight) {
          if (B.aggro >= 1) { a.state = 'chase'; a.target = near.id; a.t = 20; }
          else if (B.flee >= 1) { a.state = 'flee'; a.threat = near.id; a.t = 6; }
          else if (a.type === 'boar' && nd < 4) { a.state = 'flee'; a.threat = near.id; a.t = 3; }
        }
      }
      let goal = null, speed = 0;
      const tp = a.target != null ? players.find(p => p.id === a.target) : null, th = a.threat != null ? players.find(p => p.id === a.threat) : null;
      switch (a.state) {
        case 'idle': if (a.t <= 0) this.pickWander(a); break;
        case 'wander': goal = [a.tx, a.tz]; speed = A.walk; if (Math.hypot(a.tx - a.x, a.tz - a.z) < 1.5 || a.t <= 0) { a.state = 'idle'; a.t = 2 + this.r() * 6; } break;
        case 'flee': if (!th || a.t <= 0) { this.pickWander(a); break; } { const dx = a.x - th.pos[0], dz = a.z - th.pos[2], d = Math.hypot(dx, dz) || 1; goal = [a.x + dx / d * 10, a.z + dz / d * 10]; speed = A.speed; } break;
        case 'chase':
          if (!tp || tp.dead || a.t <= 0) { a.target = null; this.pickWander(a); break; }
          { const d = Math.hypot(tp.pos[0] - a.x, tp.pos[2] - a.z); if (d > sight * 2.2 && this.t - a.hurtT > 6) { a.target = null; this.pickWander(a); break; }
            goal = [tp.pos[0], tp.pos[2]]; speed = d < 6 ? A.speed * 0.8 : A.speed;
            if (d < B.reach && Math.abs(tp.pos[1] - a.y) < 1.8) { speed = 0; a.yaw = Math.atan2(tp.pos[0] - a.x, -(tp.pos[2] - a.z)); if (a.atk <= 0) { a.atk = B.rate; a.bite = 0.35; onAttack && onAttack(a, tp, B.dmg, this.r() < (B.bleed || 0)); } }
            if (B.flee > 0 && a.hp < A.hp * B.flee) { a.state = 'flee'; a.threat = tp.id; a.t = 8; } }
          break;
      }
      if (a.bite > 0) a.bite -= dt;
      // steering
      if (goal && speed > 0) {
        let want = Math.atan2(goal[0] - a.x, -(goal[1] - a.z));
        for (const off of [0, 0.6, -0.6, 1.2, -1.2, 2.0, -2.0]) { const yy = want + off, lx = a.x + Math.sin(yy) * 3, lz = a.z - Math.cos(yy) * 3; const h = this.T.height(lx, lz); if (h > 0.6 && this.T.slope(lx, lz) < 0.5) { want = yy; break; } }
        let dy = want - a.yaw; while (dy > Math.PI) dy -= 2 * Math.PI; while (dy < -Math.PI) dy += 2 * Math.PI; a.yaw += dy * Math.min(1, dt * 5);
      }
      a.spd += (speed - a.spd) * Math.min(1, dt * 4);
      if (a.spd > 0.05) {
        let nx = a.x + Math.sin(a.yaw) * a.spd * dt, nz = a.z - Math.cos(a.yaw) * a.spd * dt;
        if (this.T.height(nx, nz) < 0.3) { nx = a.x; nz = a.z; a.yaw += 1.5; if (a.state === 'wander') this.pickWander(a); }
        if (this.collide) [nx, nz] = this.collide(nx, nz, a.y, A.h, A.len * 0.35);
        a.x = nx; a.z = nz;
      }
      a.y += (this.T.height(a.x, a.z) - a.y) * Math.min(1, dt * 12);
      a.phase += a.spd * dt * (2.2 / A.legL);
    }
  }
  pickWander(a) { a.state = 'wander'; for (let k = 0; k < 8; k++) { const ang = this.r() * 6.28, d = 8 + this.r() * 22, x = a.x + Math.sin(ang) * d, z = a.z - Math.cos(ang) * d; if (this.goodSpot(a.type, x, z)) { a.tx = x; a.tz = z; a.t = 20; return; } } a.state = 'idle'; a.t = 3; }
  harvest(a, mult) {
    if (a.state !== 'dead' || !a.harvest) return [];
    const out = [];
    for (const h of a.harvest) { if (h[1] <= 0) continue; const k = Math.max(1, Math.round((h[0] === 'raw_meat' ? 1.5 : 3) * mult)); const n = Math.min(h[1], k); h[1] -= n; out.push([h[0], n]); }
    if (a.harvest.every(h => h[1] <= 0)) a.gone = true;
    return out;
  }
  serialize() { return this.list.filter(a => !a.gone).map(a => ({ id: a.id, type: a.type, x: +a.x.toFixed(2), y: +a.y.toFixed(2), z: +a.z.toFixed(2), yaw: +a.yaw.toFixed(2), hp: Math.round(a.hp), state: a.state, spd: +a.spd.toFixed(2), bite: a.bite > 0 ? 1 : 0, harvest: a.harvest })); }
}
function mk(seed) { let s = seed >>> 0 || 1; return () => { s ^= s << 13; s >>>= 0; s ^= s >> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; }; }
