// EMBERWING — online multiplayer session inside a Level (2 players: co-op or versus)
// Model: each client flies its own phoenix locally (instant response) and streams its state.
// The room host simulates the shared world (enemies, boss, waves, storm, beacon, team embers)
// and streams snapshots + events; the guest renders those and sends requests (pickups, kills, flares).
import { add, sub, scl, madd, norm, len, dist, clamp, damp, lerp, cross, basis, mul, trs, xformPt, TAU } from '../core/math.js';
import { Enemy, Maw } from './enemies.js';

const TYPES = ['drifter', 'lancer', 'leech', 'orb'];
const r1 = v => Math.round(v * 10) / 10, r2 = v => Math.round(v * 100) / 100;
export const PVP_TIME = 240;

/** remote player (rendered ghost + the proxy the host's enemies can target) */
class Remote {
  constructor(info) {
    this.remote = true; this.id = info.id; this.name = info.name || 'لاعب'; this.skin = info.skin;
    this.p = [0, -1e5, 0]; this.tp = null; this.v = [0, 0, 0]; this.yaw = 0; this.pitch = 0; this.roll = 0; this.wing = { sh: 0.1, el: 0.05, sw: 0 };
    this.dashT = 0; this.dead = 1; this.grounded = false; this.flame = 1; this.score = 0; this.carried = 0; this.inv = 0; this.hurtCD = 0; this.seen = 0; this.tips = [];
  }
  vel() { return this.v; }
  apply(m) {
    this.tp = m.p; this.v = m.v || [0, 0, 0]; this.seen = performance.now();
    if (!this.started || dist(this.p, m.p) > 600) { this.p = m.p.slice(); this.started = true; }
    this.tyaw = m.y; this.tpitch = m.pi; this.troll = m.r;
    this.wing = { sh: m.w[0], el: m.w[1], sw: m.w[2] };
    this.dashT = m.d ? 0.3 : 0; this.dead = m.dd ? 1 : 0; this.grounded = !!m.gr; this.flame = m.fl; this.score = m.sc || 0; this.carried = m.ca || 0; this.inv = m.iv ? 1 : 0;
  }
  update(dt) {
    if (!this.tp) return;
    this.hurtCD = Math.max(0, this.hurtCD - dt);
    // dead-reckoning toward the latest state (+ a little prediction)
    const age = Math.min(0.25, (performance.now() - this.seen) / 1000);
    const goal = madd(this.tp, this.v, age);
    this.p = [damp(this.p[0], goal[0], 12, dt), damp(this.p[1], goal[1], 12, dt), damp(this.p[2], goal[2], 12, dt)];
    const ang = (a, b) => { let d = b - a; while (d > Math.PI) d -= TAU; while (d < -Math.PI) d += TAU; return a + d * (1 - Math.exp(-14 * dt)); };
    this.yaw = ang(this.yaw, this.tyaw || 0); this.pitch = damp(this.pitch, this.tpitch || 0, 14, dt); this.roll = damp(this.roll, this.troll || 0, 14, dt);
  }
  fwd() { const cp = Math.cos(this.pitch); return [-Math.sin(this.yaw) * cp, Math.sin(this.pitch), -Math.cos(this.yaw) * cp]; }
}

export function drawPhoenix(R, M, s, o) {
  const f = s.fwd(), upW = [0, 1, 0], r = norm(cross(f, upW)), u0 = cross(r, f);
  const cr = Math.cos(s.roll), sr = Math.sin(s.roll), u = norm([u0[0] * cr + r[0] * sr, u0[1] * cr + r[1] * sr, u0[2] * cr + r[2] * sr]);
  const B = basis(s.p, f, u, 1.6);
  R.draw(M.body, B, o);
  R.draw(M.tail, mul(B, trs([0, 0.6, 6.5], 0, 1, -s.pitch * 0.3 + (s.grounded ? 0.5 : 0), 0)), o);
  const W = s.wing, tips = [];
  for (const k of [1, -1]) {
    const inner = mul(B, trs([k * 2.8, 0.9, -1.2], -k * W.sw, 1, 0, k * W.sh));
    const outer = mul(inner, trs([k * 12, 0, 0], -k * W.sw * 0.6, 1, 0, k * W.el));
    R.draw(k > 0 ? M.wiR : M.wiL, inner, o); R.draw(k > 0 ? M.woR : M.woL, outer, o);
    tips.push(xformPt(outer, [k * 15, 0, 6]));
  }
  return tips;
}

export class MP {
  constructor(level, o) {
    this.L = level; this.net = o.net; this.host = o.role === 'host'; this.mode = o.mode; this.pvp = o.mode === 'pvp';
    this.me = o.me; this.peer = new Remote(o.peer); this.peerModels = o.peerModels;
    this.inbox = []; this.stT = 0; this.snapT = 0; this.ghosts = new Map(); this.boss = null; this.dropId = 100000; this.hitCD = 0; this.ended = false;
    this.lastPeer = performance.now(); this.score = 0;
    const N = this.net;
    this.offs = [N.on('st', m => this.inbox.push(m)), N.on('ev', m => this.inbox.push(m)), N.on('snap', m => this.inbox.push(m)),
      N.on('abort', () => this.peerGone('left')), N.on('left', () => this.peerGone('left')), N.on('disconnect', () => this.peerGone('net'))];
    level.world.embers.forEach((e, i) => { e.id = i; });
    if (this.pvp) { level.stormT = PVP_TIME; level.need = level.W.need; }
  }
  dispose() { for (const f of this.offs) f(); }
  players() { const a = [this.L.player]; if (this.host && !this.peer.dead && this.peer.tp) a.push(this.peer); return a; }
  /** nearest living player for enemy AI (host) */
  targetFor(e) {
    const P = this.L.player, Q = this.peer;
    if (!this.host || !Q.tp || Q.dead) return P;
    if (P.dead) return Q;
    return dist(e.p, Q.p) < dist(e.p, P.p) ? Q : P;
  }
  send(m) { this.net.send(m); }
  ev(k, d) { this.send(Object.assign({ t: 'ev', k }, d || {})); }
  peerGone(why) {
    if (this.gone || this.ended) return; this.gone = true;
    this.L.toast(why === 'net' ? 'انقطع الاتصال بالسيرفر' : `${this.peer.name} طلع من اللعبة`, 'warn');
    this.L.app.mpAbort(why);
  }
  // ------------------------------------------------------------ inbound
  pre(dt) {
    const L = this.L, P = L.player;
    this.hitCD = Math.max(0, this.hitCD - dt);
    for (const m of this.inbox.splice(0)) {
      this.lastPeer = performance.now();
      if (m.t === 'st') this.peer.apply(m);
      else if (m.t === 'snap') this.applySnap(m);
      else if (m.t === 'ev') this.onEv(m);
    }
    this.peer.update(dt);
    if (!this.host) for (const g of this.ghosts.values()) { g.p = [damp(g.p[0], g.tp[0], 10, dt), damp(g.p[1], g.tp[1], 10, dt), damp(g.p[2], g.tp[2], 10, dt)]; g.t += dt; }
    if (this.boss && !this.host) { const B = this.boss; B.p = [damp(B.p[0], B.tp[0], 6, dt), damp(B.p[1], B.tp[1], 6, dt), damp(B.p[2], B.tp[2], 6, dt)]; B.t += dt; }
  }
  onEv(m) {
    const L = this.L, P = L.player, A = L.audio;
    switch (m.k) {
      case 'eg': { const e = L.world.embers.find(x => x.id === m.i); if (e && !e.got) { e.got = true; if (this.host && !this.pvp) { L.carried++; } } break; }
      case 'drop': for (const d of m.d) L.world.embers.push({ id: d[0], p: [d[1], d[2], d[3]], base: null, got: false, ph: Math.random() * TAU, drop: 8 }); break;
      case 'kill': if (this.host) { const e = L.enemies.find(x => x.id === m.id); if (e) { e.kill(L); L.shake(0.15); } } break;
      case 'ek': { const g = this.ghosts.get(m.id); const p = g ? g.p : m.p; this.ghosts.delete(m.id); killFx(L, m.ty, p); break; }
      case 'flare': if (this.host) L.flareAt(m.p, m.r, true); else flareFx(L, m.p, m.r, this.peer); break;
      case 'hurt': if (!P.dead) P.hurt(m.d, m.f); break;
      case 'drain': if (L.carried > 0) { L.carried--; A.play('leech'); } break;
      case 'died': if (this.host && !this.pvp) L.carried = Math.floor(L.carried * 0.75); break;
      case 'shrine': { const s = L.world.shrines[m.i]; if (s && !s.lit) { s.lit = true; } break; }
      case 'bolt': L.bolts.push({ p: m.p, t: 1.35 }); A.play('warn'); break;
      case 'lit': if (!L.lit) L.lightBeacon(); break;
      case 'boss': if (!this.host && !this.boss) { this.boss = new Maw(m.p); this.boss.tp = m.p.slice(); L.toast('الفم الأجوف صحى!', 'hot'); A.play('boss'); L.app.ui.banner('HOLLOW MAW', 'الفم الأجوف'); } break;
      case 'core': L.shake(1.2); L.flash([1, 0.8, 1], 0.6); A.play('beacon'); L.toast(m.n ? `باقي ${m.n} نواة` : 'الفم الأجوف انهزم!', m.n ? 'hot' : 'gold'); break;
      case 'pvp': this.onPvpHit(m); break;
      case 'stolen': L.carried += m.n; L.toast(`سرقت ${m.n} جمرة من ${this.peer.name}! 🔥`, 'gold'); A.play('ring'); break;
      case 'end': this.finishPvp(m); break;
      case 'msg': L.toast(m.s, m.c || ''); break;
    }
  }
  applySnap(m) {
    const L = this.L;
    L.time = m.T; L.stormR = m.sr; L.charge = m.ch; L.bossDone = !!m.bd;
    if (!this.pvp) L.carried = m.c;
    const live = new Set();
    for (const q of m.e) {
      const [id, ti, x, y, z, fx, fy, fz, fl] = q; live.add(id);
      let g = this.ghosts.get(id);
      if (!g) { g = { id, type: TYPES[ti], p: [x, y, z], tp: [x, y, z], fwd: [fx, fy, fz], t: Math.random() * 10, stun: 0, state: 'patrol' }; this.ghosts.set(id, g); }
      g.tp = [x, y, z]; g.fwd = [fx, fy, fz]; g.stun = fl & 1 ? 1 : 0; g.state = fl & 2 ? 'aim' : 'patrol'; g.onMe = !!(fl & 4); g.r = g.type === 'drifter' ? 16 : g.type === 'lancer' ? 14 : g.type === 'orb' ? 12 : 10;
    }
    for (const id of [...this.ghosts.keys()]) if (!live.has(id)) this.ghosts.delete(id);
    if (m.b) {
      if (!this.boss) { this.boss = new Maw(m.b.p); this.boss.tp = m.b.p.slice(); }
      const B = this.boss; B.tp = m.b.p; B.face = m.b.f; B.phase = m.b.ph; B.dead = !!m.b.dd; B.deathT = m.b.dt; B.hitFlash = m.b.hf; B.enter = m.b.en; B.t = m.b.t;
      m.b.c.forEach((c, i) => { B.cores[i].alive = !!c[0]; B.cores[i].hot = !!c[1]; });
    } else if (this.boss && this.boss.dead) this.boss = null;
  }
  // ------------------------------------------------------------ outbound + host duties
  post(dt) {
    const L = this.L, P = L.player;
    // my state @ 20 Hz
    this.stT -= dt;
    if (this.stT <= 0) {
      this.stT = 0.05; const v = P.vel();
      this.send({ t: 'st', p: P.p.map(r1), v: v.map(r1), y: r2(P.yaw), pi: r2(P.pitch), r: r2(P.roll), w: [r2(P.wing.sh), r2(P.wing.el), r2(P.wing.sw)], d: P.dashT > 0 ? 1 : 0, dd: P.dead ? 1 : 0, gr: P.grounded ? 1 : 0, fl: r2(P.flame / P.maxFlame), sc: this.score, ca: L.carried, iv: P.inv > 0 ? 1 : 0 });
    }
    if (this.host) this.hostDuties(dt);
    else this.guestDuties(dt);
    if (this.pvp) this.pvpDuties(dt);
    if (performance.now() - this.lastPeer > 12000 && !this.ended) this.peerGone('net');
  }
  hostDuties(dt) {
    const L = this.L, Q = this.peer;
    // enemies vs the remote player
    if (Q.tp && !Q.dead) for (const e of L.enemies) {
      if (e.dead) continue;
      if (dist(e.p, Q.p) < e.r + 14) {
        if (Q.dashT > 0) { e.kill(L); continue; }
        if (e.type === 'leech') { if (!e.attached && e.stun <= 0) { e.attached = 7; e.attTo = Q; this.ev('msg', { s: 'علقة! اندفع أو استخدم الوهج', c: 'warn' }); } }
        else if (e.stun <= 0 && Q.hurtCD <= 0 && !Q.inv) { Q.hurtCD = 0.9; this.ev('hurt', { d: e.type === 'lancer' ? 28 : e.type === 'orb' ? 15 : 18, f: e.p.map(r1) }); if (e.type === 'orb') e.kill(L); else { e.stun = 1; e.v = scl(norm(sub(e.p, Q.p)), 300); } }
      }
    }
    // snapshot @ 10 Hz
    this.snapT -= dt;
    if (this.snapT <= 0) {
      this.snapT = 0.1;
      const e = L.enemies.filter(x => !x.dead).slice(0, 40).map(x => [x.id, TYPES.indexOf(x.type), r1(x.p[0]), r1(x.p[1]), r1(x.p[2]), r2(x.fwd[0]), r2(x.fwd[1]), r2(x.fwd[2]), (x.stun > 0 ? 1 : 0) | (x.state === 'aim' ? 2 : 0) | (x.attached > 0 && x.attTo === Q ? 4 : 0)]);
      const m = { t: 'snap', T: r1(L.time), sr: Math.round(L.stormR), c: L.carried, ch: Math.round(L.charge * 1000) / 1000, bd: L.bossDone ? 1 : 0, e };
      const B = L.boss;
      if (B) m.b = { p: B.p.map(r1), f: (B.face || [0, 0, 1]).map(r2), ph: B.phase, dd: B.dead ? 1 : 0, dt: r2(B.deathT), hf: r2(B.hitFlash), en: r2(B.enter), t: r2(B.t), c: B.cores.map(c => [c.alive ? 1 : 0, c.hot ? 1 : 0]) };
      this.send(m);
    }
  }
  guestDuties(dt) {
    const L = this.L, P = L.player;
    if (P.dead) return;
    // my dash breaks ghost enemies (host confirms)
    for (const g of this.ghosts.values()) {
      const d = dist(g.p, P.p);
      if (d < g.r + 14 && P.dashT > 0 && !g.req) { g.req = true; this.ev('kill', { id: g.id }); }
    }
    P.leeched = [...this.ghosts.values()].some(g => g.onMe);
    if (P.leeched) P.s *= Math.exp(-0.25 * dt);
  }
  // ------------------------------------------------------------ hooks called by Level
  onPickup(e) { this.ev('eg', { i: e.id }); }
  onDrops(list) { if (this.host) this.ev('drop', { d: list.map(e => [e.id, r1(e.p[0]), r1(e.p[1]), r1(e.p[2])]) }); }
  nextDropId() { return this.dropId++; }
  onKill(e) { if (this.host) this.ev('ek', { id: e.id, ty: e.type, p: e.p.map(r1) }); }
  onDeath() { this.ev('died'); }
  onShrine(i) { this.ev('shrine', { i }); }
  onFlare(p, r) {
    if (!this.host) this.ev('flare', { p: p.map(r1), r });
    else this.ev('flare', { p: p.map(r1), r });
    if (this.pvp && !this.peer.dead && dist(p, this.peer.p) < r + 20) this.ev('pvp', { a: 'flare', p: p.map(r1) });
  }
  onBolt(b) { this.ev('bolt', { p: b.p.map(r1) }); }
  onLit() { this.ev('lit'); }
  onBoss(p) { this.ev('boss', { p: p.map(r1) }); }
  onCore(n) { this.ev('core', { n }); }
  // ------------------------------------------------------------ versus
  pvpDuties(dt) {
    const L = this.L, P = L.player, Q = this.peer;
    // dash into the rival to steal half their embers
    if (!P.dead && !Q.dead && Q.tp && P.dashT > 0 && this.hitCD <= 0 && dist(P.p, Q.p) < 36) { this.hitCD = 1.2; this.ev('pvp', { a: 'dash' }); L.shake(0.6); L.audio.play('kill'); }
    // deposit into the beacon = score
    if (L.inZone && L.carried > 0) { this.depT = (this.depT || 0) - dt; if (this.depT <= 0) { this.depT = 0.12; L.carried--; this.score++; L.audio.play('charge', Math.min(1, this.score / L.need)); } }
    // host decides the end of the match
    if (this.host && !this.ended) {
      const tl = PVP_TIME - L.time;
      if (this.score >= L.need || Q.score >= L.need || tl <= 0) {
        const me = this.score, him = Q.score, w = me === him ? 0 : me > him ? this.me.id : this.peer.id;
        const m = { k: 'end', w, s: { [this.me.id]: me, [this.peer.id]: him } };
        this.ev('end', m); this.finishPvp(m);
      }
    }
  }
  onPvpHit(m) {
    const L = this.L, P = L.player;
    if (P.dead) return;
    if (m.a === 'dash') {
      if (P.inv > 0 && !P.hitT) return;
      const n = Math.ceil(L.carried / 2); L.carried -= n; P.hurt(10, this.peer.p);
      if (n > 0) { this.ev('stolen', { n }); L.toast(`${this.peer.name} سرق منك ${n} جمرة!`, 'hot'); } else L.toast(`${this.peer.name} صدمك!`, 'warn');
    } else if (m.a === 'flare') {
      const lost = Math.min(3, L.carried); L.carried -= lost; P.hurt(8, m.p); const d = norm(sub(P.p, m.p)); P.p = madd(P.p, d, 40); P.vy += 120;
      L.toast(`وهج ${this.peer.name} ضربك${lost ? ` (−${lost} جمر)` : ''}`, 'warn');
    }
  }
  finishPvp(m) {
    if (this.ended) return; this.ended = true;
    const L = this.L, win = m.w === this.me.id, draw = !m.w;
    L.app.mpFinish({ pvp: true, win, draw, me: m.s[this.me.id] || this.score, him: m.s[this.peer.id] || this.peer.score, peer: this.peer.name, time: L.time, collected: L.collected, kills: L.kills, idx: L.idx });
  }
  // ------------------------------------------------------------ rendering
  render(R, M) {
    const Q = this.peer;
    if (Q.tp && !Q.dead) {
      const o = { emit: Q.dashT > 0 ? 0.5 : 0 };
      Q.tips = drawPhoenix(R, this.peerModels, Q, o);
    }
    if (!this.host) {
      for (const g of this.ghosts.values()) {
        const m = M[g.type]; if (!m) continue;
        const glow = g.type === 'lancer' && g.state === 'aim' ? 0.4 + 0.4 * Math.sin(g.t * 30) : g.stun ? 0.3 : 0;
        R.draw(m, basis(g.p, g.fwd, [0, 1, 0], g.type === 'drifter' ? 1 + Math.sin(g.t * 3) * 0.05 : 1), { emit: glow, tint: g.stun ? [1, 1, 1, 0.25] : null });
      }
      if (this.boss) this.boss.render(R, M);
    }
  }
  glow(list, t) {
    const Q = this.peer;
    if (Q.tp && !Q.dead) {
      const tr = this.peerTrail || [[1, 0.8, 0.4], [1, 0.3, 0.1]];
      for (const tp of Q.tips || []) list.push({ p: tp, s: 5, c: tr[0], a: 0.8 });
      list.push({ p: Q.p, s: 26 + Math.sin(t * 6) * 3, c: tr[1], a: 0.35 });
    }
    if (!this.host) for (const g of this.ghosts.values()) if (g.type === 'drifter') list.push({ p: madd(g.p, g.fwd, 11), s: 22, c: [0.7, 0.3, 1], a: 0.6 });
  }
  hud(R) {
    const Q = this.peer;
    return { mode: this.mode, peer: Q.name, peerP: Q.tp && !Q.dead ? [Q.p[0], Q.p[1] + 26, Q.p[2]] : null, peerFlame: Q.flame, score: this.score, peerScore: Q.score, peerCarried: Q.carried, left: this.pvp ? Math.max(0, PVP_TIME - this.L.time) : null, ping: Math.round(this.net.rtt) };
  }
}

function killFx(L, type, p) {
  const c = type === 'lancer' ? [1, 0.24, 0.55] : type === 'leech' ? [0.36, 1, 0.7] : [0.7, 0.36, 1];
  L.particles.emit(() => ({ p: p.slice(), v: [(Math.random() - 0.5) * 500, (Math.random() - 0.5) * 500, (Math.random() - 0.5) * 500], life: 0.8, s0: 10, s1: 1, c0: c, c1: [0.1, 0, 0.2], drag: 3 }), 26);
  L.particles.emit({ p: p.slice(), life: 0.35, s0: 20, s1: 120, c0: [1, 0.9, 1], c1: c, a: 0.8 });
  L.audio.play('kill'); L.kills++;
}
function flareFx(L, p, r, who) {
  L.particles.emit({ p: p.slice(), life: 0.6, s0: 30, s1: r * 1.1, c0: [1, 0.95, 0.8], c1: [1, 0.5, 0.2], a: 0.7 });
}
