// ARVEX backend — base rules, decided on the server: building privilege (Base Core), locks, structural support,
// damage to structures and deployables, explosives, upkeep and decay, loot dropped by destroyed containers.
// Players and the survivors' AI go through the same functions, so the rules are identical for both.
import crypto from 'crypto';
import { ITEMS, PIECES, pieceHP, pieceCost, BASE, deployHP, blastDamage, upkeepCost } from '../../src/game/items.js';

const PIECE_IDS = Object.keys(PIECES);
const MELEE_TIER = [1, 0.1, 0.02, 0.01], BULLET_TIER = [0.6, 0.05, 0.01, 0.004];   // what tools and bullets do to twig / wood / stone / metal
const hashCode = (id, code) => crypto.createHash('sha256').update('ARVEX-LOCK:' + id + ':' + code).digest('hex').slice(0, 24);
const isCode = c => typeof c === 'string' && /^\d{4}$/.test(c);

export class Rules {
  /** sh: the shard (W, clock, mode, opsOut, drops…) · hooks: { hurtPlayers(pos, radius, dmg, by), hurtBots(pos, radius, dmg, by), notify(th, msg), onRaid(building, by) } */
  constructor(sh, hooks = {}) { this.sh = sh; this.hooks = hooks; this.booms = new Map(); this.codes = {}; this.uid = 1; this.decayT = 0; this.cores = null; this.tries = new Map(); }
  get W() { return this.sh.W; }
  emit(op) { this.sh.opsOut.push(op); }
  id(p) { return p + this.sh.id.replace(/[^a-z0-9]/gi, '') + Date.now().toString(36).slice(-5) + (this.uid++).toString(36); }
  get pvp() { return this.sh.mode === 'pvp' || this.sh.mode === 'hardcore'; }
  /** may this owner's things be raided? everything on PvP / hardcore; on PvE only what the survivors (AI) own; nothing on build servers */
  raidable(owner) { return this.pvp || (this.sh.mode === 'pve' && typeof owner === 'string' && owner.startsWith('B:')); }

  // ---------------------------------------------------------------- base cores and privilege
  coreList() { if (!this.cores) { this.cores = []; for (const d of this.W.deploys.values()) if (d.kind === 'core') this.cores.push(d); } return this.cores; }
  /** the core that covers a position (nearest within the radius), or null */
  coreAt(x, z) { let best = null, bd = BASE.coreRadius; for (const c of this.coreList()) { const d = Math.hypot(c.x - x, c.z - z); if (d < bd) { bd = d; best = c; } } return best; }
  authed(core, th) { return !!core && (core.owner === th || (core.auth || []).includes(th)); }
  /** may `th` build / place / upgrade here? false when a core he is not authorised on covers the spot */
  canBuild(th, x, z) { for (const c of this.coreList()) if (Math.hypot(c.x - x, c.z - z) < BASE.coreRadius && !this.authed(c, th)) return false; return true; }
  owns(th, o) { return !o.owner || o.owner === th || this.authed(this.coreAt(o.x != null ? o.x : this.W.buildings.get(o.b).x, o.z != null ? o.z : this.W.buildings.get(o.b).z), th); }
  /** may `th` open / use this door, gate or container? */
  canUse(th, d) {
    if (d.owner === th) return true;
    if (d.lock) return (d.lock.auth || []).includes(th) || (d.lock.k === 'key' && this.authed(this.coreAt(d.x, d.z), th));
    return this.raidable(d.owner) || this.authed(this.coreAt(d.x, d.z), th);                      // no lock: open to anyone where raiding is on
  }

  // ---------------------------------------------------------------- structures
  /** validate and add one building piece. Returns the structure or a refusal string. */
  placeStructure(th, st, b, opts = {}) {
    const W = this.W; if (!st || typeof st.id !== 'string' || !PIECE_IDS.includes(st.piece)) return 'bad';
    const i = st.i | 0, j = st.j | 0, l = st.l | 0, side = st.side == null ? undefined : st.side | 0;
    if (Math.abs(i) > 40 || Math.abs(j) > 40 || l < 0 || l > 8) return 'bad';
    let B = W.buildings.get(st.b), created = false;
    if (!B) {
      if (!b || st.piece !== 'foundation' || i || j || l) return 'noSupport';
      if (!Number.isFinite(b.x + b.y + b.z + b.ry) || Math.abs(b.x) > 760 || Math.abs(b.z) > 760) return 'bad';
      if (!this.canBuild(th, b.x, b.z)) return 'priv';
      for (const o of W.buildings.values()) if (o.owner !== th && Math.hypot(o.x - b.x, o.z - b.z) < 12 && !this.authed(this.coreAt(o.x, o.z), th)) return 'priv';
      B = { id: String(b.id).slice(0, 24), x: +b.x, y: +b.y, z: +b.z, ry: +b.ry, owner: th }; if (W.buildings.has(B.id)) return 'bad'; W.buildings.set(B.id, B); created = true;
    } else {
      if (B.owner !== th && this.sh.mode !== 'build' && !this.authed(this.coreAt(B.x, B.z), th)) return 'priv';
      if (!this.canBuild(th, B.x, B.z)) return 'priv';
    }
    const kind = PIECES[st.piece].kind, lookup = kind === 'edge' ? W.structAt(B.id, i, j, l, 'edge', side) : st.piece === 'stairs' ? W.structAt(B.id, i, j, l, 'stairs') : kind === 'corner' ? W.structAt(B.id, i, j, l, 'corner') : W.structAt(B.id, i, j, l, 'cell');
    if (lookup || W.structures.has(st.id)) { if (created) W.buildings.delete(B.id); return 'occupied'; }
    const s = { id: st.id.slice(0, 24), b: B.id, piece: st.piece, tier: 0, hp: pieceHP(st.piece, 0), i, j, l, side: kind === 'edge' ? (side ? 1 : 0) : undefined, rot: st.rot | 0, owner: th, supported: false, at: Date.now(), t: this.sh.clock };
    if (st.piece === 'foundation' && !created && ![[1, 0], [-1, 0], [0, 1], [0, -1]].some(([a, c]) => W.cellBase(B.id, i + a, j + c, 0))) return 'noSupport';
    if (st.piece !== 'foundation' && !W.supported(s)) return 'noSupport';
    if (kind === 'cell' && st.piece !== 'foundation' && st.piece !== 'stairs') { const walls = [W.structAt(B.id, i, j, l - 1, 'edge', 0), W.structAt(B.id, i - 1, j, l - 1, 'edge', 0), W.structAt(B.id, i, j, l - 1, 'edge', 1), W.structAt(B.id, i, j - 1, l - 1, 'edge', 1)].some(Boolean); s.supported = walls || [[0, 0], [-1, 0], [0, -1], [-1, -1]].some(([a, c]) => W.structAt(B.id, i + a, j + c, l - 1, 'corner')); }
    if (opts.tier) { s.tier = opts.tier; s.hp = pieceHP(s.piece, s.tier); }
    W.addStructure(s); this.emit({ t: 'st+', st: s, b: B }); return s;
  }
  upgradeStructure(th, id, tier) {
    const s = this.W.structures.get(id); if (!s) return false; tier = Math.max(0, Math.min(3, tier | 0)); if (tier <= s.tier) return false;
    if (!this.owns(th, s)) return false; s.tier = tier; s.hp = pieceHP(s.piece, tier); s.t = this.sh.clock; this.emit({ t: 'stU', id, patch: { tier, hp: s.hp } }); return true;
  }
  repairStructure(th, id, hp) {
    const s = this.W.structures.get(id); if (!s || !this.owns(th, s)) return false; const max = pieceHP(s.piece, s.tier), v = Math.min(max, Math.max(s.hp, +hp || 0)); if (v <= s.hp) return false;
    s.hp = Math.min(v, s.hp + max * 0.26); s.t = this.sh.clock; this.emit({ t: 'stU', id, patch: { hp: s.hp } }); return true;
  }
  /** remove a structure, whatever stood on it, and the doors fitted in it */
  removeStructure(id, why) {
    const W = this.W, s = W.structures.get(id); if (!s) return false;
    for (const d of [...W.deploys.values()]) if (d.on === id) this.removeDeploy(d.id, true);
    W.removeStructure(id, true); this.emit({ t: 'st-', id });
    for (const u of W.unsupported(s.b)) { for (const d of [...W.deploys.values()]) if (d.on === u.id) this.removeDeploy(d.id, true); W.removeStructure(u.id, true); this.emit({ t: 'st-', id: u.id }); }
    // deployables that stood on the removed floor lose their footing
    if (s.piece === 'foundation' || s.piece === 'floor') { const { p } = { p: [W.buildings.get(s.b).x, 0, W.buildings.get(s.b).z] }; for (const d of [...W.deploys.values()]) if (d.onSt === id) this.removeDeploy(d.id, true); }
    if (!W.structuresOf(s.b).length) W.buildings.delete(s.b);
    return true;
  }
  /** damage from a tool, a bullet or a blast. `by`: owner id of the attacker, `kind`: melee | bullet | blast | decay */
  damageStructure(id, dmg, by, kind) {
    const s = this.W.structures.get(id); if (!s || !(dmg > 0)) return 0;
    if (kind !== 'decay' && !this.raidable(s.owner) && by !== s.owner && !this.owns(by, s)) return 0;               // no raiding on PvE / build servers
    if (kind === 'melee') dmg *= MELEE_TIER[s.tier]; else if (kind === 'bullet') dmg *= BULLET_TIER[s.tier];
    s.hp -= dmg; if (kind !== 'decay') { s.t = this.sh.clock; if (by !== s.owner && this.hooks.onRaid) this.hooks.onRaid(s, by); }
    if (s.hp <= 0) { this.removeStructure(id, kind); return dmg; }
    const max = pieceHP(s.piece, s.tier), step = Math.round(s.hp / max * 10); if (kind !== 'decay' || step !== s.hpS) { s.hpS = step; this.emit({ t: 'stU', id, patch: { hp: Math.round(s.hp * 10) / 10 } }); }
    return dmg;
  }

  // ---------------------------------------------------------------- deployables
  placeDeploy(th, d, opts = {}) {
    const it = d && ITEMS[d.item]; if (!it || !it.deploy || typeof d.id !== 'string') return 'bad';
    if (!Number.isFinite(d.x + d.y + d.z + d.ry) || Math.abs(d.x) > 780 || Math.abs(d.z) > 780) return 'bad';
    if (!opts.free && !this.canBuild(th, d.x, d.z)) return 'priv';
    if (this.W.deploys.has(d.id)) return 'bad';
    if (it.deploy.kind === 'door' || it.deploy.kind === 'core') { if (it.deploy.kind === 'door') { const on = this.W.structures.get(d.on); if (!on || on.piece !== 'doorway') return 'noDoorway'; for (const o of this.W.deploys.values()) if (o.on === d.on) return 'occupied'; } else if (this.coreAt(d.x, d.z)) return 'priv'; }
    const nd = { id: d.id.slice(0, 24), item: d.item, kind: it.deploy.kind, x: +d.x, y: +d.y, z: +d.z, ry: +d.ry, owner: th, on: d.on ? String(d.on).slice(0, 24) : undefined, onSt: d.onSt ? String(d.onSt).slice(0, 24) : undefined, hp: deployHP(d.item), t: this.sh.clock };
    if (it.deploy.slots) nd.inv = new Array(it.deploy.slots).fill(null);
    if (nd.kind === 'core') { nd.auth = [th]; nd.paid = this.sh.clock + BASE.upkeepEvery; this.cores = null; }
    this.W.addDeploy(nd); this.emit({ t: 'dep+', d: nd }); return nd;
  }
  /** take a deployable out of the world; `loot` drops what it held as a bag anyone can open */
  removeDeploy(id, loot) {
    const W = this.W, d = W.deploys.get(id); if (!d) return false;
    if (loot && d.inv) { const items = d.inv.filter(Boolean); if (items.length) this.dropBag([d.x, d.y + 0.2, d.z], items, 900); }
    if (d.kind === 'core') this.cores = null; delete this.codes[id];
    W.removeDeploy(id); this.emit({ t: 'dep-', id }); return true;
  }
  damageDeploy(id, dmg, by, kind) {
    const d = this.W.deploys.get(id); if (!d || !(dmg > 0)) return 0; const mat = ITEMS[d.item].deploy.mat == null ? 1 : ITEMS[d.item].deploy.mat;
    if (kind !== 'decay' && !this.raidable(d.owner) && by !== d.owner && !this.owns(by, d)) return 0;
    if (kind === 'melee') dmg *= [1, 0.35, 0.05, 0.02][mat]; else if (kind === 'bullet') dmg *= [0.6, 0.12, 0.02, 0.008][mat];
    if (d.hp == null) d.hp = deployHP(d.item); d.hp -= dmg; if (kind !== 'decay') { d.t = this.sh.clock; if (by !== d.owner && this.hooks.onRaid) this.hooks.onRaid(d, by); }
    if (d.hp <= 0) { this.removeDeploy(id, true); return dmg; }
    const step = Math.round(d.hp / deployHP(d.item) * 10); if (kind !== 'decay' || step !== d.hpS) { d.hpS = step; this.emit({ t: 'depU', id, patch: { hp: Math.round(d.hp) } }); }
    return dmg;
  }
  dropBag(p, items, ttl = 900) { const dr = { id: this.id('d'), x: p[0], y: p[1], z: p[2], ry: Math.random() * 6.28, bag: true, items: items.slice(0, 40), until: this.sh.clock + ttl }; this.sh.drops.set(dr.id, dr); this.emit({ t: 'drop+', dr }); return dr; }

  // ---------------------------------------------------------------- locks
  addLock(th, depId, kind, code) {
    const d = this.W.deploys.get(depId); if (!d || !['door', 'gate', 'box', 'core'].includes(d.kind)) return 'bad'; if (d.lock) return 'occupied';
    if (d.owner !== th && !this.authed(this.coreAt(d.x, d.z), th)) return 'priv';
    if (kind === 'code') { if (!isCode(code)) return 'code'; this.codes[depId] = hashCode(depId, code); }
    d.lock = { k: kind === 'code' ? 'code' : 'key', auth: [th] }; this.emit({ t: 'depU', id: depId, patch: { lock: { k: d.lock.k } } }); return d;
  }
  removeLock(th, depId) { const d = this.W.deploys.get(depId); if (!d || !d.lock || d.owner !== th && !d.lock.auth.includes(th)) return null; const k = d.lock.k; delete d.lock; delete this.codes[depId]; this.emit({ t: 'depU', id: depId, patch: { lock: null } }); return k; }
  /** a player types a code: five wrong tries lock him out of that lock for a minute */
  tryCode(th, depId, code) {
    const d = this.W.deploys.get(depId); if (!d || !d.lock || d.lock.k !== 'code') return 'bad';
    const key = th + ':' + depId, now = Date.now(), t = this.tries.get(key) || { n: 0, until: 0 }; if (t.until > now) return 'wait';
    if (!isCode(code) || this.codes[depId] !== hashCode(depId, code)) { t.n++; if (t.n >= 5) { t.n = 0; t.until = now + 60e3; } this.tries.set(key, t); return 'wrong'; }
    this.tries.delete(key); if (!d.lock.auth.includes(th)) d.lock.auth.push(th); if (d.lock.auth.length > 16) d.lock.auth.splice(1, 1); return 'ok';
  }
  setCoreAuth(th, depId, on) {
    const d = this.W.deploys.get(depId); if (!d || d.kind !== 'core') return false; if (d.lock && !this.canUse(th, d)) return false; d.auth = d.auth || [];
    if (on) { if (!d.auth.includes(th)) d.auth.push(th); if (d.auth.length > 12) d.auth.splice(1, 1); } else d.auth = d.auth.filter(x => x !== th || x === d.owner);
    return true;
  }

  // ---------------------------------------------------------------- explosives
  plant(th, by, item, p) {
    const ex = ITEMS[item] && ITEMS[item].explosive; if (!ex || !Array.isArray(p) || !p.every(Number.isFinite)) return null;
    const bm = { id: this.id('x'), item, x: +p[0].toFixed(2), y: +p[1].toFixed(2), z: +p[2].toFixed(2), fuse: ex.fuse, t: ex.fuse, owner: th, by };
    this.booms.set(bm.id, bm); this.emit({ t: 'boom+', bm: { id: bm.id, item, x: bm.x, y: bm.y, z: bm.z, fuse: ex.fuse } }); return bm;
  }
  explode(bm) {
    const W = this.W, ex = ITEMS[bm.item].explosive, p = [bm.x, bm.y, bm.z], R = ex.radius; this.booms.delete(bm.id);
    this.emit({ t: 'boom', id: bm.id, p, r: R });
    const hitS = [], hitD = [];
    W.near(bm.x, bm.z, R + 3, c => { if (c.ref.st != null) { if (!hitS.includes(c.ref.st)) hitS.push(c.ref.st); } else if (c.ref.dep != null) { if (!hitD.includes(c.ref.dep)) hitD.push(c.ref.dep); } });
    for (const id of hitS) { const s = W.structures.get(id); if (s) { const dmg = blastDamage(ex, s.tier, W.distToObj(s, p)); if (dmg > 0) this.damageStructure(id, dmg, bm.owner, 'blast'); } }
    for (const id of hitD) { const d = W.deploys.get(id); if (d) { const dmg = blastDamage(ex, ITEMS[d.item].deploy.mat == null ? 1 : ITEMS[d.item].deploy.mat, W.distToObj(d, p)); if (dmg > 0) this.damageDeploy(id, dmg, bm.owner, 'blast'); } }
    if (this.hooks.blast) this.hooks.blast(p, R * 1.6, ex.hurt, bm);
  }
  tickBooms(dt) { for (const bm of [...this.booms.values()]) { bm.t -= dt; if (bm.t <= 0) this.explode(bm); } }

  // ---------------------------------------------------------------- upkeep and decay (every 30 s of server time)
  tickDecay(dt) {
    this.decayT += dt; if (this.decayT < 30) return; const step = this.decayT; this.decayT = 0;
    const W = this.W, clock = this.sh.clock, byCore = new Map();
    // 1) every building is looked after by the core that covers its origin
    for (const b of W.buildings.values()) { const c = this.coreAt(b.x, b.z); b.core = c ? c.id : undefined; if (c) { let L = byCore.get(c.id); if (!L) byCore.set(c.id, L = []); L.push(b.id); } }
    // 2) cores pay upkeep from their own storage; a survivors' core is paid by its team's stock (hooks.botUpkeep)
    for (const c of this.coreList()) {
      if ((c.paid || 0) > clock) continue;
      const list = []; for (const bid of byCore.get(c.id) || []) for (const s of W.structuresOf(bid)) list.push(s);
      const cost = upkeepCost(list); let ok = true;
      if (c.bot != null) ok = this.hooks.botUpkeep ? this.hooks.botUpkeep(c, cost) : true;
      else { const have = k => (c.inv || []).reduce((a, s) => a + (s && s.id === k ? s.n : 0), 0); for (const k in cost) if (have(k) < cost[k]) ok = false;
        if (ok && list.length) { for (const k in cost) { let n = cost[k]; for (let i = 0; i < c.inv.length && n > 0; i++) { const s = c.inv[i]; if (s && s.id === k) { const t = Math.min(s.n, n); s.n -= t; n -= t; if (!s.n) c.inv[i] = null; } } } this.emit({ t: 'depU', id: c.id, patch: { inv: c.inv } }); } }
      if (ok) c.paid = clock + BASE.upkeepEvery; c.ok = ok ? 1 : 0;
    }
    // 3) decay: anything no paid-up core protects, once nobody has touched it for the grace time (twig rots much sooner)
    const coreOk = id => { const c = id && W.deploys.get(id); return !!c && (c.paid || 0) > clock; };
    for (const b of [...W.buildings.values()]) {
      if (coreOk(b.core)) continue;
      for (const s of W.structuresOf(b.id)) { if (clock - (s.t || 0) < (s.tier ? BASE.decayGrace : BASE.decayGrace / 3)) continue; this.damageStructure(s.id, pieceHP(s.piece, s.tier) * step / BASE.decayTime[s.tier], null, 'decay'); }
    }
    for (const d of [...W.deploys.values()]) {
      if (d.kind === 'core' ? (d.paid || 0) > clock : coreOk((this.coreAt(d.x, d.z) || {}).id)) continue;
      if (clock - (d.t || 0) < BASE.decayGrace) continue; this.damageDeploy(d.id, deployHP(d.item) * step / BASE.deployDecay, null, 'decay');
    }
  }
  /** how long a core can keep paying, for the base screen (seconds; Infinity when nothing needs paying) */
  upkeepInfo(core) {
    const W = this.W, list = []; for (const b of W.buildings.values()) if (this.coreAt(b.x, b.z) === core) for (const s of W.structuresOf(b.id)) list.push(s);
    const cost = upkeepCost(list); let periods = Infinity; const have = k => (core.inv || []).reduce((a, s) => a + (s && s.id === k ? s.n : 0), 0);
    for (const k in cost) periods = Math.min(periods, Math.floor(have(k) / cost[k]));
    return { cost, pieces: list.length, seconds: periods === Infinity ? -1 : Math.max(0, (core.paid || 0) - this.sh.clock) + periods * BASE.upkeepEvery };
  }
  serialize() { return { codes: this.codes, booms: [...this.booms.values()] }; }
  restore(s) { if (!s) return; this.codes = s.codes || {}; for (const b of s.booms || []) this.booms.set(b.id, b); }
}
export { MELEE_TIER, BULLET_TIER };
