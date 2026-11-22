// ARVEX backend — the survivors: AI players simulated on the server (server-authoritative).
// They gather, craft, build and upgrade bases, lock them, raid other bases with explosives, loot boxes and bodies,
// defend their own base, fight with melee, bows and firearms, take cover, run when badly hurt and work in small teams.
// Every change they make to the world goes through the same Rules the players use.
//
// Cost control: a survivor near a real player is simulated at the full 10 Hz (collision, line of sight, aiming).
// Further away it is updated twice a second, and beyond ~380 m (or on an empty server) every three seconds with
// straight-line movement and time-based work. Each client only receives the survivors around it.
import { ITEMS, RECIPES, GATHER, PICKUP, LOOT, rollLoot, pieceCost, pieceHP, PIECES, BASE, deployHP } from '../../src/game/items.js';
import { NODE_TYPES, RESPAWN, WATER, HALF } from '../../src/world/terrain.js';
import { CELL_S, WALL_H, ANIMALS } from '../../src/gfx/models.js';
import { ANIMAL_LOOT } from '../../src/game/items.js';

const S = CELL_S, H = WALL_H, TAU = Math.PI * 2;
const R_ACTIVE = 140, R_MID = 380;                       // simulation rings around real players (metres)
const SEND = [[70, 1], [170, 3], [430, 10]];             // network rings: radius, send every N ticks
const EYE = 1.62, RECIPE = Object.fromEntries(RECIPES.map(r => [r.out, r]));
const rnd = (a, b) => a + Math.random() * (b - a), pick = a => a[(Math.random() * a.length) | 0], clamp = (v, a, b) => v < a ? a : v > b ? b : v;
const d2 = (ax, az, bx, bz) => { const dx = ax - bx, dz = az - bz; return dx * dx + dz * dz; };
const wrap = a => { while (a > Math.PI) a -= TAU; while (a < -Math.PI) a += TAU; return a; };

// names: ordinary player handles, Arabic and English. They are listed in the game as "survivors", never counted as players.
const N1 = ['Salem', 'Faisal', 'Hamad', 'Rayan', 'Turki', 'Nawaf', 'Saud', 'Majed', 'Ziyad', 'Bader', 'Yazeed', 'Khalid', 'Fahad', 'Sultan', 'Mishal', 'Talal', 'Rakan', 'Abdullah', 'Omar', 'Hassan', 'Ali', 'Yousef', 'Ibrahim', 'Saad', 'Nasser', 'Waleed', 'Tariq', 'Zaid', 'Anas', 'Moath',
  'Ghost', 'Viper', 'Raven', 'Wolf', 'Falcon', 'Shadow', 'Storm', 'Hunter', 'Rogue', 'Drift', 'Ember', 'Frost', 'Blaze', 'Onyx', 'Nomad', 'Ranger', 'Scout', 'Hawk', 'Bolt', 'Ash', 'Flint', 'Cobra', 'Jackal', 'Lynx', 'Titan', 'Warden', 'Reaper', 'Saber', 'Vandal', 'Mako'];
const N2 = ['', '', '', '_KSA', '_77', '_x', '99', '_SA', '07', '_Pro', 'X', '_1', '_966', '2k', '_ZX', '_Q8', '_UAE', '11', '_GG', '_OG'];
const N3 = ['سالم', 'أبو فهد', 'الصقر', 'ذيب', 'نمر', 'أبو نواف', 'الشبح', 'راكان', 'أبو سعود', 'الجوكر', 'قناص', 'أبو تركي', 'فهد', 'الزعيم', 'أبو خالد', 'صياد', 'برق', 'أبو ريان', 'عقاب', 'الليث'];
function makeName(used) { for (let k = 0; k < 40; k++) { const n = Math.random() < 0.22 ? pick(N3) + (Math.random() < 0.5 ? ' ' + ((Math.random() * 90 + 10) | 0) : '') : pick(N1) + pick(N2); if (n.length <= 16 && !used.has(n)) { used.add(n); return n; } } const n = 'Survivor' + ((Math.random() * 9000 + 1000) | 0); used.add(n); return n; }

// gear ladders (what a survivor carries at each level of progress)
const TOOLS = [['rock', 'rock'], ['stone_hatchet', 'stone_pickaxe'], ['metal_hatchet', 'metal_pickaxe']];
const GUNS = [null, 'revolver', 'pump_shotgun', 'semi_rifle'];
const MELEE = ['rock', 'wooden_spear', 'stone_spear', 'machete', 'sword'];
const ARMOR = [0, 0.14, 0.27, 0.4, 0.46];
const ITEM_IDX = Object.keys(ITEMS); const IDX = Object.fromEntries(ITEM_IDX.map((k, i) => [k, i]));
export { ITEM_IDX };

export class BotSim {
  /** sh: shard (W, T, nodes, clock, mode, env, animals, players, opsOut) · rules: Rules · io: { hurt(playerConn, msg), fx(pos, msg, radius), killed(playerConn, bot) } */
  constructor(sh, rules, io) {
    this.sh = sh; this.rules = rules; this.io = io; this.bots = []; this.byId = new Map(); this.teams = new Map(); this.names = new Set();
    this.nextBot = 1; this.nextTeam = 1; this.frame = 0; this.target = 0; this.grid = new Map(); this.stat = { ms: 0, active: 0, mid: 0, far: 0, kills: 0, raids: 0, built: 0 };
    this.peace = sh.mode === 'build'; this.raidPlayers = sh.mode === 'pvp' || sh.mode === 'hardcore'; this.hostilePlayers = sh.mode !== 'build'; this.pve = sh.mode === 'pve'; this.spawnT = 0; this.teamT = 0; this.booted = false;
  }
  get W() { return this.sh.W; } get T() { return this.sh.T; }
  uid(p) { return this.rules.id(p); }

  // ================================================================== population
  /** called every tick: keep the number of survivors at `target` (a few per second, so a restart or a full server never stalls a tick) */
  populate(dt) {
    this.spawnT -= dt; if (this.spawnT > 0) return; this.spawnT = this.booted ? 0.5 : 0.05;
    const n = this.bots.length;
    if (n < this.target) { const want = Math.min(this.booted ? 2 : 12, this.target - n); this.spawnTeam(want); }
    else if (n > this.target) this.removeOne();
    if (n >= this.target) this.booted = true;
  }
  /** one new team of 1–4: every second team starts with a finished base and good gear, the others on a beach with a rock */
  spawnTeam(max) {
    const size = Math.min(max, Math.random() < 0.3 ? 1 : Math.random() < 0.5 ? 2 : Math.random() < 0.6 ? 3 : 4);
    const established = this.estToggle = !this.estToggle;
    const team = { id: this.nextTeam++, size, members: [], stock: {}, step: 0, plan: null, base: null, established, aggr: rnd(0.15, 1), wealth: established ? rnd(0.35, 1) : 0, hostile: new Map(), alert: null, raid: null, bench: 0, furnaces: 0, raidT: rnd(600, 2400), thinkT: rnd(0, 4), want: null, smelt: 0, seen: 0 };
    team.owner = 'B:' + this.sh.id + ':' + team.id; this.teams.set(team.id, team);
    let home = null;
    if (established) { home = this.findSite(null, 3); if (home) { this.makePlan(team, home); this.prebuild(team); } else team.established = false; }
    const sp = team.base ? [team.base.cx, team.base.cz] : (() => { const s = pick(this.sh.spawns); return [s[0], s[2]]; })();
    for (let i = 0; i < size; i++) this.addBot(team, sp[0] + rnd(-3, 3), sp[1] + rnd(-3, 3));
    if (!team.base) team.home = sp;
    return team;
  }
  addBot(team, x, z) {
    const n = this.nextBot++, tier = team.established ? Math.max(1, Math.round(team.wealth * 3.2)) : 0;
    const b = { id: 'b' + n, n, name: makeName(this.names), team, pos: [x, 0, z], yaw: rnd(0, TAU), pitch: 0, spd: 0, crouch: 0, swing: 0, item: 'rock', light: 0, dead: 0, tired: 0,
      hp: 100, tier, skill: clamp(rnd(0.5, 0.9) + tier * 0.02, 0.5, 0.95), aggr: clamp(team.aggr + rnd(-0.15, 0.15), 0, 1), inv: {}, carry: 0, gun: null, mag: 0, ammo: 0, bow: null, arrows: 0, melee: 'rock', tools: 0, armor: 0, meds: 0, bombs: 0, charges: 0,
      state: 'idle', t: 0, goal: null, path: null, wp: 0, tgt: null, seenT: 0, acqT: 0, fireCd: 0, burst: 0, reloadT: 0, strafe: 1, strafeT: 0, cover: null, coverT: 0, lookT: rnd(0, 0.4), stuck: 0, lastX: x, lastZ: z, stuckT: 0,
      lod: 2, acc: 0, nearD: 1e9, healT: 0, respawn: 0, swingT: 0, jobT: 0, node: null, by: null, hurtT: -99, phase: 0, look: (Math.random() * 64) | 0, lastSeen: null };
    b.pos[1] = this.groundY(x, z); this.equip(b); team.members.push(b); this.bots.push(b); this.byId.set(b.id, b);
    this.sh.rosterOut && this.sh.rosterOut({ t: 'bj', b: this.rosterEntry(b) });
    return b;
  }
  rosterEntry(b) { return [b.n, b.name, b.team.id, b.look]; }
  roster() { return this.bots.map(b => this.rosterEntry(b)); }
  /** gear for the survivor's level: tools, melee, bow or firearm with ammunition, armour, medicine, explosives */
  equip(b) {
    const t = b.tier; b.tools = Math.min(2, t >= 3 ? 2 : t >= 1 ? 1 : 0); b.melee = MELEE[Math.min(4, t)]; b.armor = ARMOR[Math.min(4, t)];
    if (t >= 1) { b.bow = t >= 2 ? 'crossbow' : 'bow'; b.arrows = 24; }
    if (t >= 2) { b.gun = GUNS[Math.min(3, t - 1 + (Math.random() < 0.35 ? 1 : 0))]; const Rg = ITEMS[b.gun].ranged; b.mag = Rg.cap; b.ammo = Rg.cap * (4 + t * 2); }
    b.meds = t >= 1 ? 1 + (t >> 1) : 0; if (t >= 3 && !this.peace) { b.bombs = (Math.random() * 3) | 0; }
    b.item = b.gun || b.bow || b.melee;
  }
  /** a real player took a slot, or the tick governor lowered the target: the survivor furthest from every player leaves */
  removeOne() {
    let best = null, bd = -1; for (const b of this.bots) { const d = b.tgt ? b.nearD * 0.3 : b.nearD; if (d > bd) { bd = d; best = b; } }
    if (best) this.removeBot(best);
  }
  removeBot(b) {
    const i = this.bots.indexOf(b); if (i < 0) return; this.bots.splice(i, 1); this.byId.delete(b.id); this.names.delete(b.name);
    const T = b.team; T.members = T.members.filter(x => x !== b); if (!T.members.length) this.teams.delete(T.id);   // its base stays and decays like any abandoned base
    this.sh.rosterOut && this.sh.rosterOut({ t: 'bl', n: b.n });
  }
  groundY(x, z) { const h = this.T.height(x, z); return h < WATER - 1.25 ? WATER - 1.25 : h; }

  // ================================================================== bases: site, plan, building
  /** a flat, dry, free spot. near: [x,z] or null (anywhere on the island) */
  findSite(near, cells) {
    const T = this.T, W = this.W, half = cells * S / 2 + 2;
    for (let k = 0; k < 160; k++) {
      let x, z; if (near) { const a = rnd(0, TAU), r = rnd(40, 110 + k * 3); x = near[0] + Math.cos(a) * r; z = near[1] + Math.sin(a) * r; } else { const a = rnd(0, TAU), r = Math.sqrt(Math.random()) * HALF * 0.78; x = Math.cos(a) * r; z = Math.sin(a) * r; }
      if (Math.abs(x) > HALF - 60 || Math.abs(z) > HALF - 60) continue;
      let lo = 1e9, hi = -1e9, ok = true;
      for (let a = -1; a <= 1 && ok; a++) for (let c = -1; c <= 1; c++) { const h = T.height(x + a * half, z + c * half); if (h < 2.2 || h > 82 || T.slope(x + a * half, z + c * half) > 0.24) { ok = false; break; } lo = Math.min(lo, h); hi = Math.max(hi, h); }
      if (!ok || hi - lo > 2.3) continue;
      if (this.sh.pois.some(p => d2(p.x, p.z, x, z) < 55 * 55)) continue;
      if ((this.sh.spawns || []).some(p => d2(p[0], p[2], x, z) < 95 * 95)) continue;                       // the beaches where players arrive stay free of bases
      let clash = false; for (const b of W.buildings.values()) if (d2(b.x, b.z, x, z) < 62 * 62) { clash = true; break; } if (clash) continue;
      for (const p of this.sh.players.values()) if (d2(p.pos[0], p.pos[2], x, z) < 90 * 90) { clash = true; break; } if (clash) continue;   // never pop a base into existence next to a player
      let rock = false; for (const n of W.nearNodes(x, z, half + 3)) if (n.alive && n.type === 'boulder') { rock = true; break; } if (rock) continue;
      return { x, z, y: hi + 0.15, ry: ((Math.random() * 4) | 0) * Math.PI / 2 + rnd(-0.3, 0.3) };
    }
    return null;
  }
  /** the whole base as an ordered list of steps; walls first, comfort and defences later, like a player's build order */
  makePlan(team, site) {
    const size = team.size || team.members.length || 1, big = team.wealth > 0.72 || size >= 3, nx = big ? 3 : 2, nz = 2, floors = team.wealth > 0.55 ? 2 : 1, P = [];
    const b = { id: this.uid('b'), x: site.x, y: site.y, z: site.z, ry: site.ry }, st = (piece, i, j, l, side, rot) => P.push({ k: 'st', piece, i, j, l, side, rot });
    const dep = (item, u, v, ry, extra) => P.push(Object.assign({ k: 'dep', item, u, v, ry }, extra));
    for (let i = 0; i < nx; i++) for (let j = 0; j < nz; j++) st('foundation', i, j, 0);
    const ring = l => { for (let j = 0; j < nz; j++) { st(l && j === 0 ? 'window' : 'wall', -1, j, l, 0); st(l && j === nz - 1 ? 'window' : 'wall', nx - 1, j, l, 0); } for (let i = 0; i < nx; i++) { st('wall', i, -1, l, 1); st(l === 0 && i === 0 ? 'doorway' : l && i === 1 ? 'window' : 'wall', i, nz - 1, l, 1); } };
    ring(0); P.push({ k: 'door', item: 'wooden_door' });
    for (let i = 0; i < nx; i++) for (let j = 0; j < nz; j++) if (!(floors === 2 && i === nx - 1 && j === 0)) st(floors === 2 ? 'floor' : 'roof', i, j, 1);
    dep('base_core', -0.85, -0.95, 0); dep('storage_box', 0.55, -1.05, 0);
    for (let m = 0; m < size; m++) dep('sleeping_bag', -0.9 + m * 1.05, (nz - 1) * S + 0.55, 0);
    dep('furnace', nx * S + 1.2, 0.6, 0, { out: 1 });
    P.push({ k: 'up', tier: 1 }); P.push({ k: 'lock', item: 'key_lock', on: 'door' });
    dep('workbench1', (nx - 1) * S + 0.3, (nz - 1) * S + 0.95, Math.PI); dep('large_box', (nx - 1) * S + 0.55, -0.95, 0);
    team.essential = P.length;                                    // a finished starter base: every established team has at least this
    P.push({ k: 'up', tier: 2 }); P.push({ k: 'door', item: 'metal_door', lock: 'code_lock' });
    if (floors === 2) { st('stairs', nx - 1, 0, 0, undefined, 1); ring(1); for (let i = 0; i < nx; i++) for (let j = 0; j < nz; j++) st('roof', i, j, 2); dep('storage_box', 0.4, 0.4, 1.2, { l: 1 }); P.push({ k: 'up', tier: 2 }); }
    if (team.wealth > 0.45 || size >= 3) {
      const Hs = Math.ceil((Math.max(nx, nz) * S / 2 + 5.5) / 3) * 3, n = Math.round(2 * Hs / 3), cu = (nx - 1) * S / 2, cv = (nz - 1) * S / 2, stone = team.wealth > 0.8;
      for (let side = 0; side < 4; side++) for (let m = 0; m < n; m++) {
        const a = -Hs + 1.5 + 3 * m, [u, v, ry] = side === 0 ? [cu + a, cv + Hs, 0] : side === 1 ? [cu + a, cv - Hs, Math.PI] : side === 2 ? [cu + Hs, cv + a, Math.PI / 2] : [cu - Hs, cv + a, -Math.PI / 2];
        const gate = side === 0 && m === (n >> 1);
        P.push({ k: 'wall', item: gate ? 'wooden_gate' : stone ? 'high_wall_stone' : 'high_wall_wood', u, v, ry, lock: gate ? 'key_lock' : null });
      }
      P.push({ k: 'wall', item: 'watchtower', u: cu + Hs - 2.4, v: cv - Hs + 5.4, ry: Math.PI, tower: 1 });
    }
    dep('workbench2', 0.3, (nz - 1) * S - 0.6, Math.PI / 2); dep('campfire', -3.6, (nz - 1) * S + 4, 0, { out: 1 });
    if (team.wealth > 0.8) P.push({ k: 'up', tier: 3, edges: 1 });
    team.plan = P; team.base = { b, nx, nz, floors, cx: 0, cz: 0, made: false, ids: [], door: null, core: null, boxes: [], bags: [], tower: null, gate: null };
    const c = this.W.toWorld(b, (nx - 1) * S / 2, 0, (nz - 1) * S / 2); team.base.cx = c[0]; team.base.cz = c[2]; team.base.cy = b.y;
    const d = this.W.toWorld(b, 0, 0, (nz - 1) * S + S / 2 + 2.2); team.base.out = [d[0], d[2]];   // the spot in front of the door
    team.home = [c[0], c[2]]; team.step = 0; team.upI = 0;
    return P;
  }
  stepCost(team, sp) {
    if (sp.k === 'st') return pieceCost(sp.piece, 0);
    if (sp.k === 'up') return null;                                  // paid piece by piece
    if (sp.k === 'lock') { const r = RECIPE[sp.item], c = {}; for (const k in r.req) c[k] = r.req[k]; return c; }
    const need = {}; const add = id => { const r = RECIPE[id]; if (r) for (const k in r.req) need[k] = (need[k] || 0) + Math.ceil(r.req[k] / r.n); };
    add(sp.item); if (sp.lock) add(sp.lock); return need;
  }
  has(team, need) { for (const k in need) if ((team.stock[k] || 0) < need[k]) return false; return true; }
  take(team, need) { for (const k in need) team.stock[k] = (team.stock[k] || 0) - need[k]; team.dirty = true; }
  /** carry out the next step of the plan. free: prebuilt bases pay nothing. Returns true when a step was done. */
  buildStep(team, free) {
    const P = team.plan, base = team.base, W = this.W, rules = this.rules; if (!P || team.step >= P.length) return false;
    const sp = P[team.step], b = base.b;
    if (sp.k === 'up') {                                               // upgrade the next piece that is below the tier
      const list = W.structuresOf(b.id).filter(s => s.tier < sp.tier && (!sp.edges || PIECES[s.piece].kind === 'edge'));
      if (!list.length) { team.step++; return true; }
      const s = list[0], cost = pieceCost(s.piece, sp.tier); if (!free) { if (!this.has(team, cost)) return false; this.take(team, cost); }
      rules.upgradeStructure(team.owner, s.id, sp.tier); return true;
    }
    const cost = this.stepCost(team, sp); if (!free) { if (!this.has(team, cost)) return false; }
    if (sp.k === 'lock') { const d = W.deploys.get(sp.on === 'door' ? base.door : base.gate); if (d && !d.lock) this.lockIt(team, d, sp.item); }
    else if (sp.k === 'st') {
      if (sp.piece === 'foundation' && !base.made) for (const n of W.nearNodes(base.cx, base.cz, Math.max(base.nx, base.nz) * S / 2 + 2.5)) if (n.alive && n.kind !== 'deco') this.sh.setNode(n, false, this.sh.clock + 3600);   // clear the plot
      const r = rules.placeStructure(team.owner, { id: this.uid('s'), b: b.id, piece: sp.piece, i: sp.i, j: sp.j, l: sp.l, side: sp.side, rot: sp.rot || 0 }, base.made ? null : b);
      if (typeof r === 'string') { team.step++; return r === 'occupied'; }
      base.made = true; base.ids.push(r.id); if (sp.piece === 'doorway') base.doorway = r.id; if (sp.piece === 'foundation' && !base.f0) base.f0 = r.id;
    } else if (sp.k === 'door') {
      if (base.door) { rules.removeDeploy(base.door, false); base.door = null; }
      const dw = W.structures.get(base.doorway); if (!dw) { team.step++; return true; }
      const t = W.structureTransform(dw), r = rules.placeDeploy(team.owner, { id: this.uid('p'), item: sp.item, x: t.p[0], y: t.p[1], z: t.p[2], ry: t.ry, on: dw.id }, { free: true });
      if (typeof r !== 'string') { r.bot = team.id; base.door = r.id; if (sp.lock) this.lockIt(team, r, sp.lock); }
    } else {
      const l = sp.l || 0, p = W.toWorld(b, sp.u, l * H, sp.v); let y = p[1];
      if (sp.k === 'wall' || sp.out) { y = this.T.height(p[0], p[2]); if (y < 0.6 || this.T.slope(p[0], p[2]) > 0.5) { team.step++; return true; } }
      const r = rules.placeDeploy(team.owner, { id: this.uid('p'), item: sp.item, x: p[0], y, z: p[2], ry: b.ry + sp.ry, onSt: sp.k === 'dep' && !sp.out && !l ? base.f0 : undefined }, { free: true });
      if (typeof r !== 'string') {
        r.bot = team.id; const kind = r.kind;
        if (kind === 'core') { base.core = r.id; r.auth = [team.owner]; } else if (kind === 'box') base.boxes.push(r.id); else if (kind === 'bag') base.bags.push(r.id); else if (kind === 'bench') team.bench = Math.max(team.bench, ITEMS[sp.item].deploy.level);
        else if (kind === 'furnace') team.furnaces++; else if (kind === 'tower') base.tower = r.id; else if (kind === 'gate') { base.gate = r.id; if (sp.lock) this.lockIt(team, r, sp.lock); }
      }
    }
    if (!free) this.take(team, cost); team.step++; this.stat.built++; return true;
  }
  lockIt(team, d, lockItem) { const code = String((Math.random() * 9000 + 1000) | 0); this.rules.addLock(team.owner, d.id, ITEMS[lockItem].lock, code); if (d.lock) d.lock.auth = [team.owner]; }
  /** established teams: the base stands from the first second, built to a stage that matches the team's wealth, with stocked boxes */
  prebuild(team) {
    const P = team.plan, stop = Math.max(team.essential, Math.floor(P.length * clamp(0.35 + team.wealth * 0.75, 0.4, 1))); let guard = 0;
    while (team.step < stop && guard++ < 900) this.buildStep(team, true);
    const w = team.wealth, st = team.stock;
    Object.assign(st, { wood: Math.round(rnd(1500, 6000) * w), stone: Math.round(rnd(1000, 5000) * w), metal_frag: Math.round(rnd(200, 1500) * w), cloth: Math.round(rnd(40, 200)), scrap: Math.round(rnd(30, 260) * w), metal_ore: Math.round(rnd(0, 400) * w),
      cooked_meat: Math.round(rnd(4, 14)), bandage: Math.round(rnd(1, 5)), pistol_ammo: Math.round(rnd(12, 60) * w), rifle_ammo: w > 0.6 ? Math.round(rnd(10, 50) * w) : 0, shotgun_shell: w > 0.5 ? Math.round(rnd(6, 24)) : 0, arrow: Math.round(rnd(8, 30)),
      powder: w > 0.6 ? Math.round(rnd(60, 500) * w) : 0, rope: Math.round(rnd(0, 4)), hide: Math.round(rnd(0, 40)) });
    if (w > 0.75 && !this.peace) { st.powder_bomb = (Math.random() * 4) | 0; st.breach_charge = Math.random() < 0.5 ? 1 + ((Math.random() * 2) | 0) : 0; }
    for (const k in st) if (!st[k]) delete st[k];
    this.syncBoxes(team);
  }
  /** the team's stock physically lies in its boxes (so a raider finds it there) */
  syncBoxes(team) {
    const base = team.base; team.dirty = false; if (!base || !base.boxes.length) return; const W = this.W, slots = [];
    for (const [id, n0] of Object.entries(team.stock)) { let n = Math.floor(n0); const I = ITEMS[id]; if (!I) continue; while (n > 0 && slots.length < 42) { const k = Math.min(n, I.stack); slots.push({ id, n: k }); n -= k; } }
    let at = 0; for (const bid of base.boxes) { const d = W.deploys.get(bid); if (!d || !d.inv) continue; const inv = new Array(d.inv.length).fill(null); for (let i = 0; i < inv.length && at < slots.length; i++) inv[i] = slots[at++]; d.inv = inv; this.rules.emit({ t: 'depU', id: bid, patch: { inv } }); }
  }
  /** a player moved things in one of the team's boxes: the stock is what is really in the boxes now */
  boxesChanged(teamId) { const team = this.teams.get(teamId); if (!team || !team.base) return; const st = {}; for (const bid of team.base.boxes) { const d = this.W.deploys.get(bid); if (d && d.inv) for (const s of d.inv) if (s && ITEMS[s.id]) st[s.id] = (st[s.id] || 0) + s.n; } team.stock = st; }
  /** upkeep for a survivors' core comes out of the team's stock */
  payUpkeep(core, cost) { const team = this.teams.get(core.bot); if (!team) return false; for (const k in cost) if ((team.stock[k] || 0) < cost[k]) { team.want = team.want || {}; team.want[k] = (team.want[k] || 0) + cost[k] * 6; return (team.stock[k] || 0) >= cost[k] * 0.25 ? (this.take(team, Object.fromEntries(Object.entries(cost).map(([a, b]) => [a, Math.min(b, team.stock[a] || 0)]))), true) : false; } this.take(team, cost); return true; }

  // ================================================================== tick
  tick(dt, players) {
    const t0 = performance.now(), sh = this.sh; this.frame++; this.players = players; this.night = sh.env.isNight; this.populate(dt);
    const bots = this.bots, f = this.frame;
    // spatial grid of survivors (64 m cells) for perception, rebuilt twice a second
    if (f % 5 === 0) { const g = this.grid; g.clear(); for (const b of bots) { if (b.dead) continue; const k = ((b.pos[0] + 2048) >> 6) * 128 + ((b.pos[2] + 2048) >> 6); let L = g.get(k); if (!L) g.set(k, L = []); L.push(b); } }
    let nA = 0, nM = 0, nF = 0;
    for (let i = 0; i < bots.length; i++) {
      const b = bots[i]; b.acc += dt;
      if ((f + b.n) % 10 === 0) { let nd = 1e9; for (const p of players) { const d = d2(p.pos[0], p.pos[2], b.pos[0], b.pos[2]); if (d < nd) nd = d; } b.nearD = Math.sqrt(nd); b.lod = b.nearD < R_ACTIVE ? 0 : b.nearD < R_MID ? 1 : 2; }
      const due = b.lod === 0 ? (nA++, true) : b.lod === 1 ? (nM++, (f + b.n) % 5 === 0) : (nF++, (f + b.n) % 30 === 0);
      if (due) { try { this.update(b, b.acc); } catch (e) { b.state = 'idle'; b.tgt = null; b.goal = null; b.node = null; if (!this.err || this.frame - this.err > 600) { this.err = this.frame; console.error('survivor update failed: ' + (e.stack || e.message)); } this.errors = (this.errors || 0) + 1; } b.acc = 0;
        // safety net: a position that is not a number or left the island never reaches the players; the survivor is put back where he last stood
        const px = b.pos[0], pz = b.pos[2]; if (!(px > -770 && px < 770 && pz > -770 && pz < 770) || !Number.isFinite(b.pos[1])) { const gx = Number.isFinite(b.okX) ? b.okX : b.team.base ? b.team.base.cx : 0, gz = Number.isFinite(b.okZ) ? b.okZ : b.team.base ? b.team.base.cz : 0; b.pos[0] = gx; b.pos[2] = gz; b.pos[1] = this.groundY(gx, gz); b.state = 'idle'; b.goal = null; b.path = null; b.tgt = null; this.stat.fixed = (this.stat.fixed || 0) + 1; } else { b.okX = px; b.okZ = pz; } }
    }
    if ((this.teamT -= dt) <= 0) { this.teamT = 1; let k = 0; for (const team of this.teams.values()) if ((team.id + (f / 10 | 0)) % 4 === 0 || team.alert) { this.teamThink(team, 4); k++; } }
    const st = this.stat; st.active = nA; st.mid = nM; st.far = nF; st.ms += (performance.now() - t0 - st.ms) * 0.05;
  }
  /** states for one client: the survivors around it, nearer ones more often. [n, x, y, z, yaw, flags, speed, item, pitch] */
  statesFor(px, pz, frame) {
    const out = [], bots = this.bots;
    for (let i = 0; i < bots.length; i++) {
      const b = bots[i], d = d2(b.pos[0], b.pos[2], px, pz); let every = 0;
      if (d < 4900) every = 1; else if (d < 28900) every = 3; else if (d < 184900) every = 10; else continue;
      if (every > 1 && (frame + b.n) % every) continue;
      out.push([b.n, Math.round(b.pos[0] * 10) / 10, Math.round(b.pos[1] * 10) / 10, Math.round(b.pos[2] * 10) / 10, Math.round(b.yaw * 100) / 100, (b.crouch ? 1 : 0) | (b.swing ? 2 : 0) | (b.light ? 4 : 0) | (b.dead ? 8 : 0) | (b.tired ? 16 : 0), Math.round(b.spd * 10) / 10, IDX[b.item] == null ? -1 : IDX[b.item], Math.round(b.pitch * 10) / 10]);
    }
    return out;
  }

  // ================================================================== team brain
  teamThink(team, dt) {
    const sh = this.sh, base = team.base; team.thinkT = 0;
    for (const [k, until] of team.hostile) if (until < sh.clock) team.hostile.delete(k);
    if (team.alert && sh.clock - team.alert.t > 45) team.alert = null;
    // smelting: furnaces turn ore into metal while there is wood (one ore every two seconds per furnace, as for players)
    if (team.furnaces && (team.stock.metal_ore || 0) > 0 && (team.stock.wood || 0) > 5) { const n = Math.min(team.stock.metal_ore, Math.floor(team.furnaces * dt / 2)); if (n > 0) { team.stock.metal_ore -= n; team.stock.metal_frag = (team.stock.metal_frag || 0) + n; team.stock.wood -= Math.ceil(n / 3); team.dirty = true; } }
    // what the team is short of: the next step of the plan, then gear, then (rich teams) explosives
    const want = {}; const need = c => { for (const k in c) { const miss = c[k] - (team.stock[k] || 0); if (miss > 0) want[k] = Math.max(want[k] || 0, miss); } };
    if (!base) { team.want = { wood: 900, stone: 300 }; if ((team.stock.wood || 0) + this.carried(team, 'wood') >= 700) { const site = this.findSite(team.home, 3); if (site) { this.makePlan(team, site); for (const m of team.members) m.state = 'idle'; } } return; }
    if (team.plan && team.step < team.plan.length) { const sp = team.plan[team.step]; if (sp.k === 'up') { const s = this.W.structuresOf(base.b.id).find(s => s.tier < sp.tier && (!sp.edges || PIECES[s.piece].kind === 'edge')); if (s) { const c = pieceCost(s.piece, sp.tier); for (const k in c) c[k] *= 4; need(c); } } else need(this.stepCost(team, sp)); }
    team.first = Object.keys(want);                                   // what the next building step is waiting for comes first
    const lvl = team.members.reduce((a, m) => Math.min(a, m.tier), 9);
    if (lvl < 1) need({ wood: 500, stone: 220 }); else if (team.furnaces) { if (lvl < 2) need({ wood: 400, metal_frag: 260 }); else if (lvl < 3) need({ metal_frag: 520, scrap: 60 }); else if (lvl < 4) need({ metal_frag: 900, scrap: 120 }); }
    if (want.metal_frag) { const ore = want.metal_frag - (team.stock.metal_ore || 0); if (ore > 0 && team.furnaces) want.metal_ore = ore; else if (!team.furnaces && team.first.includes('metal_frag')) want.scrap = Math.max(want.scrap || 0, 10); delete want.metal_frag; }   // metal comes from smelting ore (or, without a furnace yet, from scavenging)
    if (want.powder) { want.stone = Math.max(want.stone || 0, want.powder * 3); want.wood = Math.max(want.wood || 0, want.powder * 5); delete want.powder; }
    team.want = want;
    this.craftGear(team);
    if (team.dirty) this.syncBoxes(team);
    // raids: a team with explosives and a taste for it picks the nearest base it can open
    if (!this.peace && !team.raid && !team.alert && (team.raidT -= dt) <= 0) { team.raidT = rnd(900, 2400); this.planRaid(team); }
    if (team.raid && (sh.clock - team.raid.t > 600 || !this.raidTargetAlive(team.raid))) this.endRaid(team);
  }
  carried(team, id) { let n = 0; for (const m of team.members) n += m.inv[id] || 0; return n; }
  /** craft from the stock what moves the team forward: tools, weapons, ammunition, armour, medicine, powder and explosives */
  craftGear(team) {
    const st = team.stock, mk = (id, n = 1) => { const r = RECIPE[id]; if (!r || r.bench > team.bench) return false; const need = {}; for (const k in r.req) need[k] = r.req[k] * n; if (!this.has(team, need)) return false; this.take(team, need); st[id] = (st[id] || 0) + r.n * n; return true; };
    for (const m of team.members) {
      if (m.dead) continue;
      if (m.tier === 0 && (st.wood || 0) >= 420 && (st.stone || 0) >= 200) { this.take(team, { wood: 400, stone: 200 }); m.tier = 1; this.equip(m); }
      else if (m.tier === 1 && team.bench >= 1 && (st.metal_frag || 0) >= 260 && (st.wood || 0) >= 300) { this.take(team, { metal_frag: 260, wood: 300 }); m.tier = 2; this.equip(m); }
      else if (m.tier === 2 && team.bench >= 2 && (st.metal_frag || 0) >= 520 && (st.scrap || 0) >= 60) { this.take(team, { metal_frag: 520, scrap: 60 }); m.tier = 3; this.equip(m); }
      else if (m.tier === 3 && team.bench >= 2 && (st.metal_frag || 0) >= 900 && (st.scrap || 0) >= 120) { this.take(team, { metal_frag: 900, scrap: 120 }); m.tier = 4; this.equip(m); }
      if (m.gun) { const Rg = ITEMS[m.gun].ranged; if (m.ammo < Rg.cap * 2 && mk(Rg.ammo, 2)) { m.ammo += RECIPE[Rg.ammo].n * 2; st[Rg.ammo] -= RECIPE[Rg.ammo].n * 2; } else if (m.ammo < Rg.cap * 2 && (st[Rg.ammo] || 0) > 0) { const k = Math.min(st[Rg.ammo], Rg.cap * 3); st[Rg.ammo] -= k; m.ammo += k; team.dirty = true; } }
      if (m.bow && m.arrows < 8 && mk('arrow', 5)) { m.arrows += 10; st.arrow -= 10; }
      if (m.meds < 2 && mk('bandage', 2)) { m.meds += 2; st.bandage -= 2; }
    }
    if (!this.peace && team.aggr > 0.45 && team.bench >= 1 && team.step >= Math.min(team.plan ? team.plan.length : 0, 20)) {
      if ((st.powder || 0) < 260) mk('powder', 6);
      if (team.bench >= 2 && (st.breach_charge || 0) < 3) mk('breach_charge'); else if ((st.powder_bomb || 0) < 6) mk('powder_bomb');
    }
  }

  // ================================================================== raids
  raidTargetAlive(r) { return this.W.buildings.has(r.b) && (r.dep ? this.W.deploys.has(r.dep) : true); }
  planRaid(team) {
    const st = team.stock, power = (st.breach_charge || 0) * 4 + (st.powder_bomb || 0) + team.members.reduce((a, m) => a + m.bombs + m.charges * 4, 0);
    if (power < 5 || team.aggr < 0.5 || !team.base || team.members.filter(m => !m.dead).length < 1) return false;
    const W = this.W, hx = team.base.cx, hz = team.base.cz; let best = null, bd = 520 * 520;
    for (const b of W.buildings.values()) {
      if (b.owner === team.owner) continue; const isBot = typeof b.owner === 'string' && b.owner.startsWith('B:'); if (!isBot && !this.raidPlayers) continue;   // players' bases only where raiding is on
      const d = d2(b.x, b.z, hx, hz); if (d < bd && d > 30 * 30) { bd = d; best = b; }
    }
    if (!best) return false;
    // what is worth reaching: a box or the core of that base
    let goal = null; for (const d of W.deploys.values()) if ((d.kind === 'box' || d.kind === 'core') && d2(d.x, d.z, best.x, best.z) < 15 * 15) { if (!goal || d.kind === 'box') goal = d; }
    team.raid = { b: best.id, x: best.x, z: best.z, dep: goal ? goal.id : null, gx: goal ? goal.x : best.x, gy: goal ? goal.y : best.y, gz: goal ? goal.z : best.z, t: this.sh.clock, phase: 'go', boomT: 0, owner: best.owner };
    // hand the explosives to the raiders
    const raiders = team.members.filter(m => !m.dead); let i = 0;
    while ((st.breach_charge || 0) > 0) { raiders[i++ % raiders.length].charges++; st.breach_charge--; } while ((st.powder_bomb || 0) > 0) { raiders[i++ % raiders.length].bombs++; st.powder_bomb--; }
    team.dirty = true; for (const m of raiders) { m.state = 'raid'; m.goal = null; m.path = null; } this.stat.raids++;
    return true;
  }
  endRaid(team) { team.raid = null; for (const m of team.members) if (m.state === 'raid') { m.state = 'idle'; m.goal = null; } }
  /** someone damaged a structure or deployable: its owners come to defend */
  onRaid(obj, by) {
    const owner = obj.owner; if (typeof owner !== 'string' || !owner.startsWith('B:')) return; const team = this.teams.get(+owner.split(':')[2]); if (!team || !team.base) return;
    team.alert = { x: obj.x != null ? obj.x : team.base.cx, z: obj.z != null ? obj.z : team.base.cz, t: this.sh.clock, by }; if (by) team.hostile.set(by, this.sh.clock + 900);
  }

  // ================================================================== one survivor, one step
  update(b, dt) {
    if (dt > 4) dt = 4; const sh = this.sh;
    if (b.dead) { if ((b.respawn -= dt) <= 0) this.respawn(b); return; }
    b.t += dt; b.fireCd -= dt; b.swing = 0;
    if (b.hp < 100 && sh.clock - b.hurtT > 12) b.hp = Math.min(100, b.hp + dt * 0.6);
    // ---- perception (a few times a second near players, slower far away)
    if (!this.peace && (b.lookT -= dt) <= 0) { b.lookT = b.lod === 0 ? 0.35 : b.lod === 1 ? 0.9 : 3; this.perceive(b); }
    if (b.tgt) { if (this.combat(b, dt)) { this.finish(b, dt); return; } }
    if (b.hp < 45 && b.meds > 0 && sh.clock - b.hurtT > 2.5) { b.healT += dt; b.spd = 0; b.item = 'bandage'; if (b.healT > 2.4) { b.healT = 0; b.meds--; b.hp = Math.min(100, b.hp + 38); } this.finish(b, dt); return; }
    b.healT = 0;
    // ---- work
    switch (b.state) {
      case 'idle': this.decide(b); if (b.state === 'gather') this.doGather(b, 0.001); break;
      case 'gather': this.doGather(b, dt); break;
      case 'deposit': this.doDeposit(b, dt); break;
      case 'build': this.doBuild(b, dt); break;
      case 'loot': this.doLoot(b, dt); break;
      case 'scavenge': this.doScavenge(b, dt); break;
      case 'raid': this.doRaid(b, dt); break;
      case 'defend': this.doDefend(b, dt); break;
      case 'patrol': this.doPatrol(b, dt); break;
      default: b.state = 'idle';
    }
    this.finish(b, dt);
  }
  finish(b, dt) {
    b.phase += b.spd * dt; b.tired = b.hp < 30 ? 1 : 0;
    b.light = this.night && !b.tgt && b.lod < 2 && b.state !== 'raid' ? 1 : 0; if (b.light && !b.tgt && b.spd > 0.5 && b.state !== 'gather') b.item = 'torch';
  }
  /** pick the next job, like a player deciding what to do next */
  decide(b) {
    const team = b.team, base = team.base, sh = this.sh; b.goal = null; b.path = null; b.node = null; b.crouch = 0; b.t = 0; b.jobT = 0;
    if (team.alert && base && d2(b.pos[0], b.pos[2], base.cx, base.cz) < 420 * 420) { b.state = 'defend'; return; }
    if (team.raid) { b.state = 'raid'; return; }
    if (b.carry > 900 || (b.carry > 250 && this.wantsAny(team, b))) { b.state = base ? 'deposit' : 'gather'; if (!base) this.stash(b); else return; }
    if (base && team.plan && team.step < team.plan.length && this.canStep(team) && !team.builder) { team.builder = b; b.state = 'build'; return; }
    // a bag on the ground nearby is worth a detour
    if (!this.peace) for (const d of sh.drops.values()) if (d.bag && d2(d.x, d.z, b.pos[0], b.pos[2]) < 45 * 45 && !d.claim) { d.claim = b.id; b.state = 'loot'; b.goal = { drop: d.id, x: d.x, z: d.z }; return; }
    const want = team.want || {}, keys = Object.keys(want);
    if (keys.length) {
      const k = this.pickNeed(b, keys, want);
      if (k === 'scrap' || k === 'rope' || k === 'spring') { b.state = 'scavenge'; return; }
      if (!['wood', 'stone', 'metal_ore', 'cloth'].includes(k)) { b.state = base ? 'scavenge' : 'gather'; b.need = 'wood'; return; }
      b.state = 'gather'; b.need = k; return;
    }
    const low = ['wood', 'stone', 'metal_ore', 'cloth'].filter(k => (team.stock[k] || 0) < (k === 'cloth' ? 150 : 1800));
    if (base && (!low.length || Math.random() < 0.5)) { b.state = Math.random() < 0.25 && !this.peace ? 'scavenge' : 'patrol'; return; }
    b.state = 'gather'; b.need = low.length ? pick(low) : 'wood';
  }
  wantsAny(team, b) { const w = team.want; if (!w) return false; for (const k in w) if ((b.inv[k] || 0) > 0) return true; return false; }
  canStep(team) { const sp = team.plan[team.step]; if (sp.k === 'up') { const s = this.W.structuresOf(team.base.b.id).find(s => s.tier < sp.tier && (!sp.edges || PIECES[s.piece].kind === 'edge')); return !s || this.has(team, pieceCost(s.piece, sp.tier)); } return this.has(team, this.stepCost(team, sp)); }
  pickNeed(b, keys, want) { const first = b.team.first || []; let best = keys[0], bs = -1; for (const k of keys) { const s = (60 + want[k]) * (first.includes(k) ? 6 : 1) * (k === 'wood' ? 1 : k === 'stone' ? 1.1 : 1.6) * rnd(0.6, 1.4) / (1 + 2 * (b.team.members.filter(m => m !== b && m.need === k && m.state === 'gather').length)); if (s > bs) { bs = s; best = k; } } return best; }
  stash(b) { const st = b.team.stock; for (const k in b.inv) { st[k] = (st[k] || 0) + b.inv[k]; } b.inv = {}; b.carry = 0; b.team.dirty = true; }
  give(b, id, n) { if (n <= 0) return; b.inv[id] = (b.inv[id] || 0) + n; b.carry += n; }

  // ---------------------------------------------------------------- gathering
  nodeKind(need) { return need === 'wood' ? 'tree' : need === 'stone' ? 'rock' : need === 'metal_ore' ? 'metal' : need === 'cloth' ? 'hemp' : need === 'berries' ? 'berry' : 'tree'; }
  findNode(b, need) {
    const k = this.nodeKind(need), x = b.pos[0], z = b.pos[2]; let best = null, bd = 1e9;
    for (const r of [45, 110, 220]) {
      for (const n of this.W.nearNodes(x, z, r)) {
        if (!n.alive || n.busy && n.busy !== b.id && this.sh.clock - n.busyT < 30) continue;
        const ok = k === 'tree' ? n.kind === 'tree' : k === 'rock' ? n.type === 'rock' : k === 'metal' ? n.type === 'metal' : n.type === k; if (!ok) continue;
        const d = d2(n.x, n.z, x, z) * rnd(0.7, 1.3); if (d < bd && n.y > 0.3) { bd = d; best = n; }
      }
      if (best) break;
    }
    return best;
  }
  doGather(b, dt) {
    const sh = this.sh, need = b.need || 'wood';
    if (!b.node || !b.node.alive) {
      b.node = this.findNode(b, need);
      if (!b.node) { // nothing here: walk on (toward home, or inland) and try again
        if (!b.goal) { const h = b.team.home || [0, 0], a = rnd(0, TAU); b.goal = { x: clamp(h[0] + Math.cos(a) * rnd(60, 260), -700, 700), z: clamp(h[1] + Math.sin(a) * rnd(60, 260), -700, 700) }; }
        if (this.go(b, b.goal.x, b.goal.z, 4.6, dt, 6)) { b.goal = null; b.state = 'idle'; } return;
      }
      b.node.busy = b.id; b.node.busyT = sh.clock; b.goal = null; b.path = null;
    }
    const n = b.node, nt = NODE_TYPES[n.type], reach = (nt.r || 0.4) * (n.s || 1) + 1.25;
    if (!this.go(b, n.x, n.z, 4.6, dt, reach)) return;
    b.spd = 0; this.face(b, n.x, n.z, dt); n.busyT = sh.clock;
    if (nt.kind === 'pick') { const P = PICKUP[n.type]; for (const [id, a, c] of P) this.give(b, id, a + ((Math.random() * (c - a + 1)) | 0)); sh.setNode(n, false, sh.clock + RESPAWN.pick); sh.opsOut.push({ t: 'node', id: n.id, alive: false, respawn: n.respawn, hp: 0, inv: null }); b.node = null; this.doneWork(b); return; }
    const cls = nt.kind === 'tree' ? 'tree' : 'rock', tool = ITEMS[TOOLS[b.tools][cls === 'tree' ? 0 : 1]], g = tool.gather[cls], G = GATHER[n.type === 'metal' ? 'metal' : cls];
    b.item = tool.id;
    if (b.lod === 0) {                                                  // real swings: the node loses health and falls for everyone to see
      b.swingT -= dt; b.swing = b.swingT > tool.melee.rate * 0.4 ? 1 : 0;
      if (b.swingT <= 0) { b.swingT = tool.melee.rate; b.swing = 1; this.give(b, G.item, Math.max(1, Math.round(G.per * g[1] * rnd(0.85, 1.15)))); if (G.extra) this.give(b, G.extra[0], Math.round(G.extra[1] * g[1])); n.hp -= g[0];
        if (n.hp <= 0) { this.give(b, G.item, G.bonus); sh.setNode(n, false, sh.clock + RESPAWN[cls]); sh.opsOut.push({ t: 'node', id: n.id, hp: 0, alive: false, respawn: n.respawn, inv: null }); b.node = null; this.doneWork(b); }
        else sh.opsOut.push({ t: 'node', id: n.id, hp: n.hp, alive: true, respawn: 0, inv: n.inv }); }
    } else {                                                            // out of sight: the same yield per second, the node is left standing
      const hits = dt / tool.melee.rate * 0.6; this.give(b, G.item, Math.round(G.per * g[1] * hits + G.bonus * hits * g[0] / nt.hp)); if (G.extra) this.give(b, G.extra[0], Math.round(G.extra[1] * g[1] * hits));
      if ((b.jobT += dt) > 14) { b.jobT = 0; b.node = null; this.doneWork(b); }
    }
  }
  doneWork(b) { if (b.carry > 700 || (b.inv[b.need] || 0) >= Math.min(900, (b.team.want || {})[b.need] || 300)) b.state = 'idle'; }
  doDeposit(b, dt) {
    const base = b.team.base; if (!base) { this.stash(b); b.state = 'idle'; return; }
    if (!this.goHome(b, dt)) return;
    this.stash(b); b.state = 'idle';
  }
  /** walk to the base and through its door (opening and closing it) */
  goHome(b, dt, inside = true) {
    const base = b.team.base, far = d2(b.pos[0], b.pos[2], base.out[0], base.out[1]) > 9;
    if (b.lod > 0 || !inside) return this.go(b, base.out[0], base.out[1], 4.6, dt, 2.5);
    if (!b.inside) { if (far) { this.go(b, base.out[0], base.out[1], 4.6, dt, 1.2); return false; } this.door(b.team, true); b.inside = 1; }
    const tx = base.cx, tz = base.cz; if (this.go(b, tx, tz, 3, dt, 1.6, true)) { b.inside = 0; this.door(b.team, false); return true; }
    if (b.t > 14) { b.inside = 0; b.t = 0; return true; }
    return false;
  }
  door(team, open) { const d = this.W.deploys.get(team.base.door); if (!d || !!d.open === open) return; this.W.setDoor(d, open); this.rules.emit({ t: 'depU', id: d.id, patch: { open } }); const g = this.W.deploys.get(team.base.gate); if (g && !!g.open !== open) { this.W.setDoor(g, open); this.rules.emit({ t: 'depU', id: g.id, patch: { open } }); } }
  doBuild(b, dt) {
    const team = b.team, base = team.base; if (!base || team.step >= team.plan.length || !this.canStep(team)) { team.builder = null; b.state = 'idle'; return; }
    if (!this.go(b, base.out[0], base.out[1], 4.6, dt, 7)) return;
    b.spd = 0; this.face(b, base.cx, base.cz, dt); b.item = team.plan[team.step].k === 'up' ? 'hammer' : 'plan'; b.swing = 1;
    if ((b.jobT += dt) < (b.lod === 0 ? 1.4 : 0.6)) return; b.jobT = 0;
    this.buildStep(team, false);
    if (team.step >= team.plan.length || !this.canStep(team)) { team.builder = null; b.state = 'idle'; if (team.dirty) this.syncBoxes(team); }
  }
  doPatrol(b, dt) {
    const base = b.team.base; if (!base) { b.state = 'idle'; return; }
    if (!b.goal) { const a = rnd(0, TAU), r = rnd(14, 60); b.goal = { x: base.cx + Math.cos(a) * r, z: base.cz + Math.sin(a) * r, wait: rnd(2, 9) }; b.t = 0; }
    b.item = b.gun || b.bow || b.melee;
    if (this.go(b, b.goal.x, b.goal.z, 3, dt, 2)) { b.spd = 0; b.yaw += dt * 0.5 * (b.n % 2 ? 1 : -1); if ((b.goal.wait -= dt) <= 0) { b.goal = null; if (Math.random() < 0.4) b.state = 'idle'; } }
  }
  doScavenge(b, dt) {
    const sh = this.sh;
    if (b.lod > 0 && !b.goal) { const p = pick(sh.pois); b.goal = { poi: 1, x: p.x + rnd(-8, 8), z: p.z + rnd(-8, 8) }; }
    if (b.goal && b.goal.poi) { if (!this.go(b, b.goal.x, b.goal.z, 4.6, dt, 10)) { if (b.t > 240) { b.goal = null; b.state = 'idle'; } return; } b.spd = 0; if ((b.jobT += dt) < 25) return; b.jobT = 0; for (const it of rollLoot('crate1').concat(rollLoot('barrel'), rollLoot('barrel'))) this.takeItem(b, it); b.goal = null; b.state = b.carry > 40 ? 'deposit' : 'idle'; return; }
    if (!b.goal) { let best = null, bd = 1e12; for (const n of sh.nodes) if ((n.kind === 'loot' || n.kind === 'barrel') && n.alive) { const d = d2(n.x, n.z, b.pos[0], b.pos[2]) * rnd(0.6, 1.5); if (d < bd) { bd = d; best = n; } } if (!best) { b.state = 'gather'; b.need = 'wood'; return; } b.goal = { node: best, x: best.x, z: best.z }; }
    const n = b.goal.node; if (!n.alive) { b.goal = null; b.state = 'idle'; return; }
    if (!this.go(b, n.x, n.z, 4.6, dt, 1.6)) return;
    b.spd = 0; if ((b.jobT += dt) < 2) return; b.jobT = 0;
    const items = n.kind === 'loot' ? (n.inv ? n.inv.filter(Boolean) : rollLoot(n.tier > 1 ? 'crate2' : 'crate1')) : rollLoot('barrel');
    for (const it of items) this.takeItem(b, it);
    sh.setNode(n, false, sh.clock + RESPAWN[n.kind === 'loot' ? 'loot' : 'barrel']); n.inv = null; sh.opsOut.push({ t: 'node', id: n.id, hp: 0, alive: false, respawn: n.respawn, inv: null }); b.goal = null; b.state = 'idle';
  }
  /** an item picked up: weapons and ammunition are used at once, the rest is carried home */
  takeItem(b, it) {
    const I = ITEMS[it.id]; if (!I) return;
    if (I.ranged && I.ranged.gun) { if (!b.gun || I.ranged.dmg * (I.ranged.pellets || 1) > ITEMS[b.gun].ranged.dmg * (ITEMS[b.gun].ranged.pellets || 1)) { b.gun = it.id; b.mag = it.ammo || 0; } return; }
    if (I.cat === 'ammo') { if (b.gun && ITEMS[b.gun].ranged.ammo === it.id) b.ammo += it.n; else if (it.id === 'arrow') b.arrows += it.n; else this.give(b, it.id, it.n); return; }
    if (I.heal) { b.meds += it.n; return; } if (it.id === 'powder_bomb') { b.bombs += it.n; return; } if (it.id === 'breach_charge') { b.charges += it.n; return; }
    this.give(b, it.id, it.n);
  }
  doLoot(b, dt) {
    const sh = this.sh, d = b.goal && sh.drops.get(b.goal.drop); if (!d) { b.state = 'idle'; return; }
    if (!this.go(b, d.x, d.z, 4.6, dt, 1.5)) { if (b.t > 40) { d.claim = null; b.state = 'idle'; } return; }
    b.spd = 0; b.crouch = 1; if ((b.jobT += dt) < 1.6) return; b.jobT = 0; b.crouch = 0;
    for (const it of d.items) this.takeItem(b, it); sh.drops.delete(d.id); sh.opsOut.push({ t: 'drop-', id: d.id }); b.state = 'idle';
  }

  // ---------------------------------------------------------------- defending and raiding
  doDefend(b, dt) {
    const team = b.team, al = team.alert, base = team.base; if (!al || !base) { b.state = 'idle'; return; }
    b.item = b.gun || b.bow || b.melee;
    const tx = al.x + Math.cos(b.n) * 6, tz = al.z + Math.sin(b.n) * 6;
    if (this.go(b, tx, tz, 7, dt, 5)) { b.spd = 0; b.crouch = 1; b.yaw += dt * 0.8; if (this.sh.clock - al.t > 30) { team.alert = null; b.state = 'idle'; this.repair(team); } }
  }
  /** after a fight the builders patch what was hit (paid from the stock) */
  repair(team) { const W = this.W; let n = 0; for (const s of W.structuresOf(team.base.b.id)) { const max = pieceHP(s.piece, s.tier); if (s.hp < max * 0.95 && n++ < 12) { const c = pieceCost(s.piece, s.tier); for (const k in c) c[k] = Math.ceil(c[k] * (1 - s.hp / max) * 0.5); if (this.has(team, c)) { this.take(team, c); this.rules.repairStructure(team.owner, s.id, max); } } } }
  doRaid(b, dt) {
    const team = b.team, r = team.raid, W = this.W, sh = this.sh; if (!r) { b.state = 'idle'; return; }
    b.item = b.gun || b.bow || b.melee;
    const dist = Math.sqrt(d2(b.pos[0], b.pos[2], r.gx, r.gz));
    if (r.phase === 'go') { if (this.go(b, r.x, r.z, 5.4, dt, 26)) r.phase = 'breach'; return; }
    if (r.waitT > 0) { r.waitT -= dt; // an explosive is about to go off: stay back and low
      let ax = r.bx - b.pos[0], az = r.bz - b.pos[2], ad = Math.hypot(ax, az); if (!(ad > 0.01)) { ax = Math.cos(b.n); az = Math.sin(b.n); ad = 1; }   // standing on the charge itself (or it has no position): any way out is good
      if (ad < 9) this.go(b, b.pos[0] - ax / ad * 10, b.pos[2] - az / ad * 10, 6.5, dt, 1); else { b.spd = 0; b.crouch = 1; this.face(b, r.bx, r.bz, dt); } return; }
    b.crouch = 0;
    // reached the prize: empty the box (or break it open when it is locked), then go home
    const goal = r.dep && W.deploys.get(r.dep);
    if (dist < 2.2) {
      b.spd = 0; if ((b.jobT += dt) < 1.5) return; b.jobT = 0;
      if (goal && goal.inv && this.rules.canUse(team.owner, goal)) { for (const it of goal.inv) if (it) this.takeItem(b, it); goal.inv = goal.inv.map(() => null); this.rules.emit({ t: 'depU', id: goal.id, patch: { inv: goal.inv } }); if (goal.bot != null) this.boxesChanged(goal.bot); }
      else if (goal) { this.rules.damageDeploy(goal.id, 400, team.owner, 'blast'); for (const d of sh.drops.values()) if (d.bag && d2(d.x, d.z, r.gx, r.gz) < 9) { for (const it of d.items) this.takeItem(b, it); sh.drops.delete(d.id); sh.opsOut.push({ t: 'drop-', id: d.id }); } }
      // next box of this base, or done
      let next = null; for (const d of W.deploys.values()) if (d.kind === 'box' && d.id !== r.dep && d2(d.x, d.z, r.x, r.z) < 15 * 15 && d.inv && d.inv.some(Boolean)) { next = d; break; }
      if (next && sh.clock - r.t < 420) { r.dep = next.id; r.gx = next.x; r.gy = next.y; r.gz = next.z; } else { this.endRaid(team); for (const m of team.members) if (!m.dead) m.state = 'deposit'; }
      return;
    }
    // walk at the prize; whatever is in the way gets an explosive
    const moved = this.go(b, r.gx, r.gz, 4.6, dt, 1.8, true);
    if (b.lod === 2) { // far from everyone: the breach is resolved by the explosives' numbers, the structures really break
      if ((r.boomT -= dt) <= 0 && dist < 30) { r.boomT = 6; const hit = this.blocker(b, r); if (hit) { if (!this.useExplosive(b, hit.p, r)) { this.endRaid(team); } } }
      return;
    }
    if (b.stuckT > 0.8 || (b.spd < 0.4 && !moved)) { const hit = this.blocker(b, r); if (hit && hit.t < 3.2) { if (!this.useExplosive(b, hit.p, r)) { if (!team.members.some(m => m.bombs + m.charges > 0)) this.endRaid(team); } b.stuckT = 0; } }
  }
  /** the first structure or deployable between the survivor and the raid's goal */
  blocker(b, r) {
    const o = [b.pos[0], b.pos[1] + 1.1, b.pos[2]], dx = r.gx - o[0], dy = r.gy + 0.6 - o[1], dz = r.gz - o[2], L = Math.hypot(dx, dy, dz) || 1, h = this.W.raycast(o, [dx / L, dy / L, dz / L], Math.min(L, 40), { noTerrain: true });
    return h.kind === 'structure' || (h.kind === 'deploy' && h.ref.dep !== r.dep) ? h : null;
  }
  useExplosive(b, p, r) {
    const item = b.charges > 0 ? 'breach_charge' : b.bombs > 0 ? 'powder_bomb' : null; if (!item) { const mate = b.team.members.find(m => !m.dead && m.bombs + m.charges > 0 && d2(m.pos[0], m.pos[2], b.pos[0], b.pos[2]) < 400); if (mate) { if (mate.charges) { mate.charges--; b.charges++; } else { mate.bombs--; b.bombs++; } return this.useExplosive(b, p, r); } return false; }
    if (item === 'breach_charge') b.charges--; else b.bombs--;
    const bm = this.rules.plant(b.team.owner, b.id, item, p); if (!bm) return false; if (b.lod === 2) bm.t = 0.5;
    r.waitT = ITEMS[item].explosive.fuse + 0.6; r.bx = p[0]; r.bz = p[2]; return true;
  }

  // ================================================================== perception and combat
  hostileTo(b, other) {            // other: a survivor of another team
    const A = b.team, Bt = other.team; if (A === Bt) return false; if (A.hostile.has(Bt.owner)) return true;                    // they hurt us (the grudge fades after a few minutes)
    if (A.raid && A.raid.owner === Bt.owner || Bt.raid && Bt.raid.owner === A.owner) return true;
    if (b.lod === 2) return false;                                                                                 // nobody is near to see it: away from players they only fight over raids and old scores, so the world is not emptied by skirmishes
    if (A.base && A.aggr > 0.7 && d2(other.pos[0], other.pos[2], A.base.cx, A.base.cz) < 10 * 10) return true;      // trespassing at my base
    return A.aggr > 0.9 && b.tier > 0 && b.tier >= other.tier && (other.carry > 300 || other.tier > 0) && this.sh.clock > (A.calm || 0);   // bandits rob those worth robbing
  }
  hostileToPlayer(b, p) {
    if (!this.hostilePlayers || p.dead) return false; const T = b.team; if (T.hostile.has(p.th)) return true;       // he hurt us or raided us
    if (p.safeUntil > Date.now()) return false;                                              // somebody who just arrived or came back from the dead is left alone for a minute (unless he starts it)
    if (T.base && (!this.pve || T.aggr > 0.78) && d2(p.pos[0], p.pos[2], T.base.cx, T.base.cz) < 24 * 24) return true;      // trespassers at the base (on PvE only the bandit teams mind)
    if (T.raid && T.raid.owner === p.th) return true;
    const it = ITEMS[p.item]; if (!(it && (it.ranged || (it.melee && it.melee.dmg >= 30)))) return b.aggr > 0.88;   // somebody with empty hands or a rock is not worth the bullets: only the worst go for him
    return b.aggr > (this.pve ? 0.78 : 0.55);                                               // the rest depends on temperament (on PvE servers only the bandit teams attack on sight)
  }
  perceive(b) {
    const sh = this.sh, W = this.W, x = b.pos[0], z = b.pos[2], eye = [x, b.pos[1] + (b.crouch ? 1.0 : EYE), z];
    const sight = (this.night ? 52 : 100) * (b.lod === 2 ? 0.6 : 1); let best = null, bs = 1e9;
    const consider = (t, tx, ty, tz, crouch, isPl, loud) => {
      const dd = d2(tx, tz, x, z), r = sight * (crouch ? 0.6 : 1) * (loud ? 1.6 : 1); if (dd > r * r) return; const d = Math.sqrt(dd);
      if (d > 14 && Math.abs(wrap(Math.atan2(tx - x, -(tz - z)) - b.yaw)) > 1.75 && !loud && b.tgt !== t) return;       // behind him and quiet
      if (b.lod < 2 && !W.los(eye, [tx, ty + (crouch ? 0.8 : 1.3), tz])) return;
      const s = d * (isPl ? 0.85 : 1) * (b.tgt && b.tgt.e === t ? 0.6 : 1); if (s < bs) { bs = s; best = { e: t, pl: isPl }; }
    };
    for (const p of this.players) { if (p.dead) continue; if (this.hostileToPlayer(b, p)) consider(p, p.pos[0], p.pos[1], p.pos[2], p.crouch, true, sh.clock - (p.shotT || -99) < 4 || (this.night && p.light)); }
    const gx = (x + 2048) >> 6, gz = (z + 2048) >> 6;
    for (let a = -1; a <= 1; a++) for (let c = -1; c <= 1; c++) { const L = this.grid.get((gx + a) * 128 + gz + c); if (!L) continue; for (const o of L) { if (o === b || o.dead || o.team === b.team) continue; if (this.hostileTo(b, o)) consider(o, o.pos[0], o.pos[1], o.pos[2], o.crouch, false, sh.clock - (o.shotT || -99) < 4); } }
    if (best) { if (!b.tgt || b.tgt.e !== best.e) { b.acqT = sh.clock; b.burst = 0; } b.tgt = best; b.seenT = sh.clock; const e = best.e; b.lastSeen = [e.pos[0], e.pos[2]];
    }
    else if (b.tgt && sh.clock - b.seenT > (b.lod === 2 ? 9 : 6)) { b.tgt = null; b.cover = null; }
  }
  /** returns true while the survivor is busy fighting (its work waits) */
  combat(b, dt) {
    const sh = this.sh, W = this.W, tg = b.tgt, e = tg.e; if (e.dead || (tg.pl ? !sh.players.has(e.id) : !this.byId.has(e.id))) { b.tgt = null; b.cover = null; return false; }
    const ex = e.pos[0], ey = e.pos[1], ez = e.pos[2], dx = ex - b.pos[0], dz = ez - b.pos[2], d = Math.hypot(dx, dz) || 0.01, seen = sh.clock - b.seenT < 0.8;
    // badly hurt: break contact, get behind something, heal
    const mates = b.team.members.filter(m => m !== b && !m.dead && d2(m.pos[0], m.pos[2], b.pos[0], b.pos[2]) < 3600).length;
    if (b.hp < (mates ? 24 : 34) && (b.meds > 0 || b.hp < 20)) {
      b.crouch = 0; const home = b.team.base; let fx = b.pos[0] - dx / d * 30, fz = b.pos[2] - dz / d * 30; if (home && d2(home.cx, home.cz, b.pos[0], b.pos[2]) < 160 * 160) { fx = home.out[0]; fz = home.out[1]; }
      this.go(b, fx, fz, 7.2, dt, 2); b.item = b.melee; if (sh.clock - b.seenT > 3.5 || d > 70) { b.tgt = null; } return true;
    }
    const gun = b.gun && (b.mag > 0 || b.ammo > 0) ? ITEMS[b.gun] : null, bow = !gun && b.bow && b.arrows > 0 ? ITEMS[b.bow] : null, Rg = gun ? gun.ranged : bow ? bow.ranged : null;
    if (Rg) {
      b.item = gun ? b.gun : b.bow; const ideal = gun ? (Rg.gun === 'shotgun' ? 11 : Rg.gun === 'rifle' ? 48 : 24) : 22;
      // reload behind cover
      if (gun && b.mag <= 0) { if (b.reloadT <= 0) b.reloadT = Rg.reload; }
      if (b.reloadT > 0) { b.reloadT -= dt; if (b.reloadT <= 0) { const k = Math.min(Rg.cap, b.ammo); b.mag = k; b.ammo -= k; } }
      // movement: keep the weapon's distance, strafe in bursts, use a tree or rock as cover when there is one
      if (b.lod === 0) {
        if ((b.strafeT -= dt) <= 0) { b.strafeT = rnd(0.5, 1.5); b.strafe = Math.random() < 0.5 ? -1 : 1; if (Math.random() < 0.35) b.strafe = 0; b.crouch = b.strafe === 0 && d > 14 ? 1 : 0; }
        if ((b.coverT -= dt) <= 0) { b.coverT = rnd(2.5, 5); b.cover = d > 9 ? this.findCover(b, ex, ez) : null; }
        let mx, mz;
        if (b.cover && (b.reloadT > 0 || b.hp < 60 || b.burst <= 0)) { mx = b.cover[0]; mz = b.cover[1]; if (d2(mx, mz, b.pos[0], b.pos[2]) < 1.2) { b.spd = 0; b.crouch = 1; mx = null; } }
        else { const k = d > ideal * 1.25 ? 1 : d < ideal * 0.6 ? -1 : 0, px = -dz / d, pz = dx / d; mx = b.pos[0] + (dx / d * k * 4 + px * b.strafe * 4); mz = b.pos[2] + (dz / d * k * 4 + pz * b.strafe * 4); }
        if (mx != null) this.step(b, mx, mz, b.crouch ? 1.9 : d > ideal * 1.6 ? 6.4 : 3.6, dt, false);
      } else { const k = d > ideal * 1.3 ? 1 : 0; if (k) this.step(b, ex, ez, 5, dt, true); else b.spd = 0; }
      this.aimAt(b, ex, ey + (e.crouch ? 0.8 : 1.25), ez, dt);
      // fire: short bursts with pauses, only with a line of sight, after a human reaction time
      const react = 0.28 + (1 - b.skill) * 0.5;
      if (seen && b.reloadT <= 0 && b.fireCd <= 0 && sh.clock - b.acqT > react && d < (Rg.range || 70) * 1.05) {
        if (b.burst <= 0) { b.burst = gun ? (Rg.gun === 'shotgun' ? 1 : 2 + ((Math.random() * 4) | 0)) : 1; }
        if (gun) { b.mag--; } else b.arrows--;
        b.fireCd = (gun ? Rg.rate * rnd(1.25, 1.9) : Rg.reload + Rg.draw + rnd(0.3, 0.9)); if (--b.burst <= 0) b.fireCd += rnd(0.5, 1.3) + (1 - b.skill) * 0.6;
        this.shoot(b, tg, d, Rg, !!gun);
      }
      return true;
    }
    // no ranged weapon: close in and swing
    const M = ITEMS[b.melee].melee; b.item = b.melee; b.crouch = 0;
    if (d > M.range + 0.5) { if (b.lod === 0) this.step(b, ex, ez, d > 12 ? 7 : 5.2, dt, false); else this.step(b, ex, ez, 5.5, dt, true); if (d > 60 && sh.clock - b.seenT > 4) b.tgt = null; }
    else { b.spd = 0; }
    this.aimAt(b, ex, ey + 1.2, ez, dt);
    b.swingT -= dt; if (d <= M.range + 0.6 && b.swingT <= 0) { b.swingT = M.rate * rnd(1, 1.25); b.hitAt = sh.clock + M.rate * 0.45; }
    b.swing = b.swingT > M.rate * 0.35 ? 1 : 0;
    if (b.hitAt && sh.clock >= b.hitAt) { b.hitAt = 0; if (d <= M.range + 0.9 && Math.abs(ey - b.pos[1]) < 2.2) this.damage(b, tg, M.dmg * rnd(0.85, 1.1), 'melee'); }
    return true;
  }
  findCover(b, ex, ez) {
    const W = this.W, x = b.pos[0], z = b.pos[2]; let best = null, bd = 16 * 16;
    W.near(x, z, 14, c => { if (c.off) return; let cx, cz, r; if (c.t === 'c') { if (c.r < 0.3 || c.y1 - c.y0 < 1.2) return; cx = c.x; cz = c.z; r = c.r; } else { if (c.h[1] < 0.6) return; cx = c.c[0]; cz = c.c[2]; r = Math.max(c.h[0], c.h[2]); }
      const dd = d2(cx, cz, x, z); if (dd > bd) return; const vx = cx - ex, vz = cz - ez, vl = Math.hypot(vx, vz) || 1; if (vl < 6) return; bd = dd; best = [cx + vx / vl * (r + 0.7), cz + vz / vl * (r + 0.7)]; });
    return best;
  }
  aimAt(b, tx, ty, tz, dt) { const dx = tx - b.pos[0], dz = tz - b.pos[2], want = Math.atan2(dx, -dz), k = Math.min(1, dt * (5 + b.skill * 9)); b.yaw += wrap(want - b.yaw) * k; b.pitch += (Math.atan2(ty - (b.pos[1] + EYE), Math.hypot(dx, dz)) - b.pitch) * k; }
  face(b, tx, tz, dt) { b.yaw += wrap(Math.atan2(tx - b.pos[0], -(tz - b.pos[2])) - b.yaw) * Math.min(1, dt * 8); b.pitch *= 0.8; }
  /** one shot. The hit chance comes from skill, distance, how the target moves, the shooter's own movement and time on target. */
  shoot(b, tg, d, Rg, gun) {
    const sh = this.sh, e = tg.e, eye = [b.pos[0], b.pos[1] + (b.crouch ? 1.0 : EYE), b.pos[2]]; b.shotT = sh.clock;
    const tv = tg.pl ? (e.spd || 0) : e.spd, lateral = tv * Math.abs(Math.sin(wrap(Math.atan2(e.pos[0] - b.pos[0], -(e.pos[2] - b.pos[2])) - (e.yaw || 0))));
    const range = Rg.range || 70, settle = clamp((sh.clock - b.acqT - 0.2) / 1.1, 0.3, 1);
    let p = b.skill * Math.pow(clamp(1 - d / (range * 1.15), 0.06, 1), 0.75) / (1 + lateral * 0.2) * (b.spd > 1 ? 0.7 : 1) * (b.crouch ? 1.1 : 1) * settle * (this.night && d > 28 ? 0.72 : 1) * (e.crouch ? 0.85 : 1) * (b.hp < 40 ? 0.85 : 1);
    if (!gun) p *= clamp(1.15 - d / 55, 0.2, 1);
    const pellets = Rg.pellets || 1; let hits = 0; if (pellets > 1) { const pp = clamp(p * clamp(9 / d, 0.12, 1) * 1.2, 0, 0.95); for (let i = 0; i < pellets; i++) if (Math.random() < pp) hits++; } else if (Math.random() < p) hits = 1;
    const tx = e.pos[0], ty = e.pos[1] + (e.crouch ? 0.8 : 1.2), tz = e.pos[2]; let end;
    if (hits && (b.lod === 2 || this.W.los(eye, [tx, ty, tz]))) { end = [tx, ty, tz]; const fall = Math.max(0.4, 1 - d / range * 0.6); const delay = gun ? 0 : d / (Rg.speed || 60);
      if (delay > 0.15) setTimeout(() => { if (!b.dead || true) this.damage(b, tg, Rg.dmg * hits * fall, 'arrow'); }, delay * 1000); else this.damage(b, tg, Rg.dmg * hits * fall, gun ? 'bullet' : 'arrow'); }
    else { const m = 0.6 + d * 0.035; end = [tx + rnd(-m, m), ty + rnd(-m * 0.6, m * 0.6), tz + rnd(-m, m)]; }
    if (b.lod < 2) this.io.fx(eye, { t: 'bfx', k: gun ? 'gun' : 'bow', g: gun ? Rg.gun : '', n: b.n, p: eye.map(v => Math.round(v * 10) / 10), e: end.map(v => Math.round(v * 10) / 10), h: hits ? 1 : 0 }, gun ? 260 : 70);
  }
  /** damage dealt by a survivor to its target (a player or another survivor) */
  damage(b, tg, dmg, kind) {
    const e = tg.e; if (e.dead) return;
    if (tg.pl) { if (!this.sh.players.has(e.id)) return; this.io.hurt(e, { t: 'hurt', dmg: Math.round(dmg * (this.sh.mode === 'hardcore' ? 1.3 : 1) * 10) / 10, kind, src: b.id }); e.lastBot = b.id; }
    else this.hurtBot(e, dmg, kind, b);
  }
  /** a survivor takes damage. by: the attacking survivor, or a player connection (by.th) */
  hurtBot(b, dmg, kind, by) {
    if (b.dead || !(dmg > 0)) return false; const sh = this.sh;
    if (['melee', 'arrow', 'bullet', 'animal'].includes(kind)) dmg *= 1 - b.armor;
    b.hp -= dmg; b.hurtT = sh.clock; b.healT = 0;
    if (by && !this.peace) {
      const pl = !!by.ws, owner = pl ? by.th : by.team && by.team.owner;
      if (by.type) { /* an animal: fight back below */ } else if (owner && owner !== b.team.owner) { b.team.hostile.set(owner, sh.clock + (pl ? 600 : 200)); if (!b.tgt || b.tgt.e !== by) { b.tgt = { e: by, pl }; b.acqT = sh.clock - 0.2; } b.seenT = sh.clock;
        for (const m of b.team.members) if (m !== b && !m.dead && !m.tgt && d2(m.pos[0], m.pos[2], b.pos[0], b.pos[2]) < 130 * 130) { m.tgt = { e: by, pl }; m.acqT = sh.clock; m.seenT = sh.clock; } }
    }
    if (b.hp <= 0) { this.kill(b, by, kind); return true; }
    return false;
  }
  kill(b, by, kind) {
    const sh = this.sh; b.hp = 0; b.dead = 1; b.spd = 0; b.tgt = null; b.swing = 0; b.respawn = rnd(25, 50); b.state = 'idle'; b.goal = null; b.path = null; if (b.team.builder === b) b.team.builder = null; this.stat.kills++; { const c = this.stat.causes || (this.stat.causes = {}), k = !by ? kind || 'other' : by.type ? 'animal' : by.ws ? 'player' : (b.team.raid && by.team && b.team.raid.owner === by.team.owner) || (by.team && by.team.raid && by.team.raid.owner === b.team.owner) ? 'raid' : 'fight'; c[k] = (c[k] || 0) + 1; }
    // what he carried lies on the ground in a bag: resources, his weapon and ammunition, medicine, explosives
    const items = []; for (const k in b.inv) { let n = Math.floor(b.inv[k]); const I = ITEMS[k]; while (n > 0 && I && items.length < 30) { const q = Math.min(n, I.stack); items.push({ id: k, n: q }); n -= q; } }
    if (b.gun) { items.push({ id: b.gun, n: 1, ammo: Math.max(0, b.mag), cond: Math.round(ITEMS[b.gun].cond * rnd(0.3, 0.9)) }); if (b.ammo > 0) items.push({ id: ITEMS[b.gun].ranged.ammo, n: Math.min(b.ammo, 128) }); }
    else if (b.bow) { items.push({ id: b.bow, n: 1, ammo: 0, cond: Math.round(ITEMS[b.bow].cond * rnd(0.3, 0.9)) }); if (b.arrows > 0) items.push({ id: 'arrow', n: Math.min(64, b.arrows) }); }
    if (b.melee !== 'rock') items.push({ id: b.melee, n: 1, cond: Math.round((ITEMS[b.melee].cond || 100) * rnd(0.3, 0.9)) });
    if (b.meds > 0) items.push({ id: 'bandage', n: Math.min(5, b.meds) }); if (b.bombs > 0) items.push({ id: 'powder_bomb', n: b.bombs }); if (b.charges > 0) items.push({ id: 'breach_charge', n: b.charges });
    if (items.length) this.rules.dropBag([b.pos[0], b.pos[1] + 0.2, b.pos[2]], items, 900);
    b.inv = {}; b.carry = 0; b.gun = null; b.bow = null; b.mag = b.ammo = b.arrows = b.meds = b.bombs = b.charges = 0;
    if (by && by.ws) this.io.killed(by, b); else if (by && by.team) by.team.calm = sh.clock + rnd(120, 400);
  }
  respawn(b) {
    const team = b.team, base = team.base, W = this.W; b.dead = 0; b.hp = 100; b.tgt = null; b.inside = 0;
    const bag = base && base.bags.map(id => W.deploys.get(id)).find(Boolean);
    if (bag) { b.pos = [base.out[0] + rnd(-1, 1), 0, base.out[1] + rnd(-1, 1)]; if (Math.random() < 0.3) b.tier = Math.max(1, b.tier - 1); }
    else { const s = base ? [base.out[0], 0, base.out[1]] : pick(this.sh.spawns); b.pos = [s[0] + rnd(-2, 2), 0, s[2] + rnd(-2, 2)]; b.tier = Math.max(0, b.tier - 1); if (!base && !team.members.some(m => m !== b && !m.dead)) team.home = [b.pos[0], b.pos[2]]; }
    b.pos[1] = this.groundY(b.pos[0], b.pos[2]); this.equip(b); b.state = 'idle'; b.lastX = b.pos[0]; b.lastZ = b.pos[2];
  }
  /** an explosion near survivors */
  blast(p, radius, hurt, bm) { for (const b of this.bots) { if (b.dead) continue; const d = Math.hypot(b.pos[0] - p[0], b.pos[1] + 1 - p[1], b.pos[2] - p[2]); if (d < radius && (b.lod === 2 || this.W.los(p, [b.pos[0], b.pos[1] + 1, b.pos[2]]))) this.hurtBot(b, hurt * (1 - d / radius), 'blast', bm.by ? this.byId.get(bm.by) || null : null); } }
  /** animals bite survivors too (called from the animal simulation) */
  bitten(b, a, dmg) { if (b.dead) return; this.hurtBot(b, dmg, 'animal', a); if (!b.dead && !b.tgt) { const A = ANIMALS[a.type], w = b.gun && b.mag > 0 ? ITEMS[b.gun].ranged.dmg * 1.6 : ITEMS[b.melee].melee.dmg; if (this.sh.animals.hurt(a, w * rnd(0.8, 1.6), b.id) === 'dead') { for (const [id, n] of ANIMAL_LOOT[a.type]) this.give(b, id, Math.round(n * 0.6)); a.harvest = null; a.gone = true; } b.swing = 1; this.face(b, a.x, a.z, 1); } }
  /** a player fired nearby: survivors who hear it look that way */
  heard(p) { p.shotT = this.sh.clock; }

  // ================================================================== movement
  /** walk toward (tx,tz); true when within `reach`. Near players: collision and steering; far away: straight along the navigation path */
  go(b, tx, tz, speed, dt, reach = 1.5, direct = false) {
    const dd = d2(b.pos[0], b.pos[2], tx, tz); if (dd <= reach * reach) { b.spd = 0; b.path = null; return true; }
    if (!direct && dd > 70 * 70) {                                                  // long way: follow the coarse path round mountains and lakes
      if (!b.path || b.pathTo !== tx + tz) { b.path = this.W.nav.path(b.pos[0], b.pos[2], tx, tz); b.wp = 0; b.pathTo = tx + tz; }
      while (b.wp < b.path.length - 1 && d2(b.pos[0], b.pos[2], b.path[b.wp][0], b.path[b.wp][1]) < 14 * 14) b.wp++;
      if (b.path.length) { const w = b.path[Math.min(b.wp, b.path.length - 1)]; tx = w[0]; tz = w[1]; }
    }
    this.step(b, tx, tz, speed, dt, b.lod > 0); return false;
  }
  step(b, tx, tz, speed, dt, coarse) {
    const T = this.T, W = this.W, x = b.pos[0], z = b.pos[2]; let dx = tx - x, dz = tz - z; const d = Math.hypot(dx, dz) || 0.001;
    const swim = T.height(x, z) < WATER - 1.2; if (swim) speed = Math.min(speed, 2.6);
    if (coarse) { const k = Math.min(1, speed * dt / d); b.pos[0] = x + dx * k; b.pos[2] = z + dz * k; b.pos[1] = this.groundY(b.pos[0], b.pos[2]); b.yaw = Math.atan2(dx, -dz); b.spd = speed; b.lastX = b.pos[0]; b.lastZ = b.pos[2]; b.stuckT = 0; return; }
    let want = Math.atan2(dx, -dz);
    // steering: the first heading that is not a cliff or a collider
    if (b.avoid && b.avoidT > 0) { b.avoidT -= dt; want += b.avoid; }
    else for (const off of [0, 0.55, -0.55, 1.1, -1.1, 1.8, -1.8]) { const yy = want + off, lx = x + Math.sin(yy) * 1.7, lz = z - Math.cos(yy) * 1.7, h = T.height(lx, lz); if (h - b.pos[1] > 1.6 || (h > b.pos[1] + 0.4 && T.normal(lx, lz)[1] < 0.6)) continue; const c = W.collide(lx, lz, b.pos[1], 1.8, 0.36); if (Math.abs(c[0] - lx) + Math.abs(c[1] - lz) > 0.6) continue; if (off) { b.avoid = off; b.avoidT = 0.35; } want = yy; break; }
    b.yaw += wrap(want - b.yaw) * Math.min(1, dt * 9);
    const sp = Math.min(speed, d / dt); let nx = x + Math.sin(b.yaw) * sp * dt, nz = z - Math.cos(b.yaw) * sp * dt;
    const c = W.collide(nx, nz, b.pos[1], 1.8, 0.34); nx = c[0]; nz = c[1];
    if (!T.inBounds(nx, nz)) { nx = x; nz = z; }
    const g = swim || T.height(nx, nz) < WATER - 1.25 ? WATER - 1.25 : W.ground(nx, nz, b.pos[1], b.stuckT > 0.5 ? 1.1 : 0.65);
    b.pos[0] = nx; b.pos[2] = nz; b.pos[1] += (g - b.pos[1]) * Math.min(1, dt * 14);
    const mv = Math.hypot(nx - x, nz - z); b.spd = mv / dt;
    if (mv < sp * dt * 0.3) { b.stuckT += dt; if (b.stuckT > 2.5) { b.avoid = (Math.random() < 0.5 ? -1 : 1) * rnd(1.2, 2.6); b.avoidT = 0.9; b.path = null; if (b.stuckT > 7) { b.stuckT = 0; if (b.state !== 'raid') { b.state = 'idle'; b.node = null; } } } } else b.stuckT = Math.max(0, b.stuckT - dt * 2);
  }

  // ================================================================== info
  info() { const st = this.stat; return { bots: this.bots.length, target: this.target, teams: this.teams.size, active: st.active, mid: st.mid, far: st.far, ms: Math.round(st.ms * 100) / 100, kills: st.kills, raids: st.raids, built: st.built, errors: this.errors || 0 }; }
}
