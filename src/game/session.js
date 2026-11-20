// ARVEX SURVIVAL — game session: ties world, player, inventory, crafting, building, combat, animals, weather,
// containers, saving and rendering together. Every world mutation goes through apply(op) so solo and
// multiplayer behave identically (solo applies locally; online the server validates and broadcasts).
import { World, rayCyl, raySphere, CH, NCH } from '../world/world.js';
import { NODE_TYPES, RESPAWN, WATER, HALF } from '../world/terrain.js';
import { Player, MOVE } from './player.js';
import { PlayerInventory, Container, makeItem, WEAR_SLOTS } from './inventory.js';
import { ITEMS, RECIPES, GATHER, PICKUP, rollLoot, pieceHP, pieceCost, PIECES, PIECE_ORDER, TIERS, nameOf } from './items.js';
import { Builder, REASONS } from './building.js';
import { AnimalSim } from './animals.js';
import { Env } from './env.js';
import { BL, gripPt } from '../gfx/blender.js';
import { debris as debrisModel, viewModel, animalParts, humanParts, arrowMesh, piece, deployable, ANIMALS, CELL_S, WALL_H, tree as treeModel } from '../gfx/models.js';
import { trs, mul, clamp, lerp, damp, rng, norm, hex, mixc } from '../core/math.js';

const SAVE_KEY = 'arvex.world.v1';
export const LEVEL_XP = l => 60 * (l - 1) * (l - 1) + 40 * (l - 1);

export class Session {
  constructor(app, opts) {
    this.app = app; this.R = app.R; this.audio = app.audio; this.particles = app.particles; this.opts = opts;
    this.online = !!opts.online; this.seed = opts.seed || 1337; this.now = 0; this.t = 0;
    this.world = new World(this.seed); this.env = new Env(this.seed); this.inv = new PlayerInventory(); this.builder = new Builder(this);
    this.queue = []; this.projectiles = []; this.falling = []; this.debris = []; this.remote = new Map(); this.hits = []; this.feed = [];
    this.stats = { xp: 0, level: 1, kills: 0, deaths: 0, crafted: 0, built: 0, gathered: 0, playTime: 0, sessions: 1, first: Date.now() };
    this.held = { anim: 0, swing: 0, cd: 0, draw: 0, reload: 0, model: null, id: null, equipT: 0 };
    this.ui = app.ui; this.meshes = { terrain: new Map(), props: new Map(), grass: new Map(), buildings: new Map() };
    this.vm = new Map(); this.propGpu = new Map(); this.openCont = null; this.mode = null; this.pieceSel = 'foundation'; this.aim = 0; this.shake = 0; this.recoil = 0; this.hurtFx = 0;
    this.bag = null; this.myId = opts.myId || 'local'; this.ownerId = opts.ownerId || this.myId; this.creative = false;
  }
  // ================================================================== loading
  *load(saved) {
    this.world.quality = this.app.S.preset === 'ultra' ? 2 : 1; this.world.grassDensity = this.app.S.grass;
    for (const p of this.world.load()) yield p * 0.8;
    this.world.indexNodes();
    this.R.setHeightTex(this.world.waterTex, 512, 1536, -40, 170);
    this.poiGpu = this.world.poiMeshes.map(pm => ({ m: this.R.upload(pm.mb), M: pm.M, p: pm.p }));
    yield 0.85;
    this.animals = new AnimalSim(this.world.T, (x, z, y, h, r) => this.world.collide(x, z, y, h, r), this.seed);
    this.animalGpu = {}; for (const k in ANIMALS) { const P = animalParts(k); this.animalGpu[k] = { body: this.R.upload(P.body), head: this.R.upload(P.head), legU: this.R.upload(P.legU), legL: this.R.upload(P.legL), tail: this.R.upload(P.tail), def: P.def }; }
    this.humanCache = new Map();
    this.arrowGpu = this.R.upload(arrowMesh());
    this.bagGpu = this.R.upload(deployable('bag')); this.dropGpu = this.R.upload(dropMesh());
    yield 0.9;
    if (!this.online && saved) this.restore(saved);
    if (!this.player) this.spawnFresh();
    if (!this.online) this.animals.populate([this.pseudoPlayer()], true);
    yield 1;
  }
  spawnFresh() {
    const sp = this.world.spawns[Math.floor(Math.random() * this.world.spawns.length)] || [0, 20, 0];
    this.player = new Player([sp[0], this.world.height(sp[0], sp[2]) + 0.1, sp[2]]);
    this.player.yaw = Math.atan2(-sp[0], sp[2]); // look inland
    this.inv.clearAll(); this.inv.belt.slots[0] = makeItem('rock'); this.inv.belt.slots[1] = makeItem('torch'); this.inv.active = 0;
    this.inv.main.add('bandage', 1); this.inv.main.add('berries', 3);
    this.recalcWear();
  }
  pseudoPlayer() { const p = this.player; return { id: this.myId, pos: p.pos, crouch: p.crouch > 0.5, dead: p.dead }; }
  // ================================================================== world ops (single mutation path)
  apply(op, fromServer) {
    if (this.online && !fromServer && op.t !== 'local') { this.app.net.send({ t: 'op', op }); if (!['st+', 'dep+'].includes(op.t)) this.applyLocal(op); return; }
    this.applyLocal(op);
  }
  applyLocal(op) {
    const W = this.world;
    switch (op.t) {
      case 'node': { const n = W.nodes[op.id]; if (!n) break; if (op.hp != null) n.hp = op.hp; if (op.alive != null) W.setNodeAlive(n, op.alive, op.respawn || 0); if (op.inv !== undefined) n.inv = op.inv; break; }
      case 'b+': W.buildings.set(op.b.id, op.b); break;
      case 'st+': if (op.b && !W.buildings.has(op.b.id)) W.buildings.set(op.b.id, op.b); W.addStructure(op.st); break;
      case 'st-': W.removeStructure(op.id); break;
      case 'stU': { const st = W.structures.get(op.id); if (st) { Object.assign(st, op.patch); W.dirtyBuildings.add(st.b); } break; }
      case 'dep+': W.addDeploy(op.d); break;
      case 'dep-': W.removeDeploy(op.id); break;
      case 'depU': { const d = W.deploys.get(op.id); if (d) { if (op.patch.open != null) W.setDoor(d, op.patch.open); Object.assign(d, op.patch); } break; }
      case 'drop+': W.addDrop(op.dr); break;
      case 'drop-': W.drops.delete(op.id); break;
      case 'dropU': { const dr = W.drops.get(op.id); if (dr) dr.items = op.items; break; }
    }
  }
  // ================================================================== main update
  update(dt, inp) {
    this.t += dt; this.now += dt; this.stats.playTime += dt;
    const P = this.player, W = this.world, uiOpen = this.app.ui.modalOpen();
    if (!this.online) { this.env.update(dt); W.updateRespawns(this.now); }
    else this.env.update(dt, false);
    if (uiOpen) { inp = Object.assign({}, inp, { move: [0, 0], lookX: 0, lookY: 0, attack: false, attackPress: 0, jumpPress: 0, jump: false, aim: false, interact: 0, reload: 0, sprint: false }); }
    const it = this.inv.activeItem(), I = it && ITEMS[it.id];
    this.aim = damp(this.aim, inp.aim && I && I.ranged ? 1 : 0, 14, dt);
    // ---- movement + look (with aim sensitivity)
    inp.lookX *= 1 - this.aim * 0.4; inp.lookY *= 1 - this.aim * 0.4;
    const enc = 1;
    P.update(dt, Object.assign({}, inp, { lookY: inp.lookY + this.recoil * dt * 6 }), W, { t: this.t, aiming: this.aim > 0.5, encumber: enc, sfx: (n, k) => this.audio.play(n, k), step: pl => this.footstep(pl) });
    this.recoil = damp(this.recoil, 0, 10, dt);
    // ---- vitals
    const fire = this.fireWarmth(), sheltered = this.isSheltered();
    P.vitals(dt, { temp: this.env.temperature(P.pos[1]), rain: this.env.cur.rain }, { t: this.t, fireWarmth: fire + (I && I.warm ? I.warm : 0), sheltered, onHurt: (d, type) => this.onHurt(d, type), onDeath: (type, src) => this.onDeath(type, src) });
    // ---- hotbar
    if (!uiOpen) {
      if (inp.hot >= 0) this.selectSlot(inp.hot);
      else if (inp.hotNext) this.selectSlot((this.inv.active + 1) % 6); else if (inp.hotPrev) this.selectSlot((this.inv.active + 5) % 6);
    }
    // ---- held item logic
    if (!P.dead) this.updateHeld(dt, inp, uiOpen);
    // ---- interaction
    this.focus = P.dead ? null : this.findFocus();
    if (!uiOpen && inp.interact && this.focus) this.interact(this.focus);
    if (!uiOpen && inp.drop) this.dropActive();
    // ---- crafting queue
    this.updateQueue(dt);
    // ---- deployable processing (fires, furnaces)
    this.updateDeployables(dt);
    // ---- projectiles, falling trees
    this.updateProjectiles(dt); this.updateFalling(dt); this.updateDebris(dt);
    // ---- animals
    if (!this.online) this.animals.update(dt, [this.pseudoPlayer()], (a, tp, dmg, bleed) => this.animalAttack(a, dmg, bleed), this.env.isNight);
    // ---- audio ambience
    this.updateAudio(dt);
    // ---- fx
    this.shake = damp(this.shake, 0, 7, dt); this.hurtFx = damp(this.hurtFx, 0, 2.5, dt);
    this.R.fx.hurt = Math.max(this.hurtFx, P.hp < 25 && !P.dead ? (0.25 + Math.sin(this.t * 4) * 0.1) * (1 - P.hp / 25) : 0);
    this.R.fx.flash = Math.max(this.env.flash * 0.6, this.R.fx.flash - dt * 2);
    if (this.env.thunder) this.audio.play('thunder', 1);
    // ---- level / autosave
    if (!this.online && (this._saveT = (this._saveT || 0) + dt) > 30) { this._saveT = 0; this.save(); }
    this.feed = this.feed.filter(f => this.t - f.t < 4.5);
    if ((this._objT = (this._objT || 0) + dt) > 1) { this._objT = 0; this.checkObjectives(); }
  }
  // ================================================================== held items
  selectSlot(i) {
    if (i === this.inv.active && this.held.equipT > 0) return;
    this.inv.active = i; this.held.equipT = 0.35; this.held.swing = 0; this.held.draw = 0; this.held.reload = 0; this.mode = null;
    const it = this.inv.activeItem(); if (it && ITEMS[it.id].plan) this.mode = 'plan'; else if (it && ITEMS[it.id].deploy) this.mode = 'deploy'; else if (it && ITEMS[it.id].hammer) this.mode = 'hammer';
    this.audio.play('ui'); this.inv.changed('select');
  }
  updateHeld(dt, inp, uiOpen) {
    const H = this.held, it = this.inv.activeItem(), I = it && ITEMS[it.id], P = this.player;
    H.equipT = Math.max(0, H.equipT - dt); H.cd = Math.max(0, H.cd - dt); H.anim += dt;
    if (!it) { this.mode = null; if (H.swing > 0) H.swing = Math.max(0, H.swing - dt); return; }
    if (I.plan) this.mode = 'plan'; else if (I.deploy) this.mode = 'deploy'; else if (I.hammer) this.mode = 'hammer'; else this.mode = null;
    if (uiOpen || H.equipT > 0) return;
    // ---- building plan
    if (this.mode === 'plan') {
      if (inp.reload) { this.builder.rot = (this.builder.rot + 1) % 24; this.audio.play('ui'); }
      if (inp.aimPress) this.ui.wheel('plan');
      this.cand = this.builder.candidate(this.pieceSel, P.eye(), P.lookDir());
      if (inp.attackPress) { if (this.cand.ok) this.placeStructure(this.cand); else { this.audio.play('fail'); this.ui.toast(this.tr(REASONS[this.cand.reason] || ['—', '—']), 'warn'); } }
      return;
    }
    if (this.mode === 'deploy') {
      if (inp.reload) { this.builder.rot = (this.builder.rot + 1) % 8; this.audio.play('ui'); }
      this.cand = this.builder.deployCandidate(it.id, P.eye(), P.lookDir());
      if (inp.attackPress) { if (this.cand.ok) this.placeDeploy(this.cand); else { this.audio.play('fail'); this.ui.toast(this.tr(REASONS[this.cand.reason] || ['—', '—']), 'warn'); } }
      return;
    }
    this.cand = null;
    if (this.mode === 'hammer') { if (inp.aimPress) { const f = this.focusStructure(); if (f) this.ui.wheel('hammer', f); } }
    // ---- ranged
    if (I.ranged) {
      const Rg = I.ranged;
      if (H.reload > 0) { H.reload -= dt; if (H.reload <= 0) { const n = Math.min(Rg.cap - (it.ammo || 0), this.inv.count(Rg.ammo)); if (n > 0) { this.inv.take({ [Rg.ammo]: n }); it.ammo = (it.ammo || 0) + n; } H.reload = 0; this.inv.changed('ammo'); } return; }
      if ((it.ammo || 0) <= 0) { if (Rg.gun && inp.attackPress) this.audio.play('empty'); if ((Rg.draw > 0 || inp.reload || (Rg.gun && inp.attackPress)) && this.inv.count(Rg.ammo) > 0) { H.reload = Rg.reload; this.audio.play('reload'); } else if (inp.attackPress) { this.audio.play('fail'); this.ui.toast(this.tr(['ما عندك أسهم', 'No arrows']), 'warn'); } return; }
      if (Rg.gun) { // firearms: semi-auto, magazine, manual reload with R
        if (inp.attackPress && H.cd <= 0) { this.fireGun(it, I); H.cd = Rg.rate; }
        if (inp.reload && (it.ammo || 0) < Rg.cap && this.inv.count(Rg.ammo) > 0) { H.reload = Rg.reload; this.audio.play('reload'); }
        return;
      }
      if (Rg.draw > 0) { // bow: hold to draw, release to fire
        if (inp.attack) { if (H.draw === 0) this.audio.play('bowdraw'); H.draw = Math.min(1, H.draw + dt / Rg.draw); P.stam = Math.max(0, P.stam - dt * 4); }
        else if (H.draw > 0) { if (H.draw > 0.25) this.fire(it, I, H.draw); H.draw = 0; }
      } else if (inp.attackPress && H.cd <= 0) { this.fire(it, I, 1); H.cd = 0.3; }
      if (inp.reload && Rg.draw === 0 && (it.ammo || 0) < Rg.cap && this.inv.count(Rg.ammo) > 0) { H.reload = Rg.reload; this.audio.play('reload'); }
      return;
    }
    // ---- aim assist on touch screens: gently turn toward the nearest tree/rock/animal in front while attacking
    if (I.melee && inp.attack && this.app.input.isTouch()) this.aimAssist(dt, I.melee.range + 0.6);
    // ---- melee / gather / hammer
    if (I.melee) {
      if (H.swing > 0) {
        const prev = H.swing; H.swing -= dt; const hitAt = I.melee.rate * 0.55;
        if (prev > hitAt && H.swing <= hitAt) this.meleeHit(it, I);
        if (H.swing < 0) H.swing = 0;
      } else if (inp.attack && H.cd <= 0) {
        if (P.stam < I.melee.stam * 0.5) { if (inp.attackPress) this.audio.play('fail'); return; }
        H.swing = I.melee.rate; H.cd = I.melee.rate; P.stam = Math.max(0, P.stam - I.melee.stam); this.audio.play('swing', 0.8);
      }
    }
  }
  aimAssist(dt, range) {
    const P = this.player, e = P.eye(); let best = null, bs = 0.62;
    const consider = (x, y, z) => { const dx = x - e[0], dy = y - e[1], dz = z - e[2], d = Math.hypot(dx, dy, dz); if (d > range + 1.2 || d < 0.3) return; const want = Math.atan2(dx, -dz); let dyaw = want - P.yaw; while (dyaw > Math.PI) dyaw -= 2 * Math.PI; while (dyaw < -Math.PI) dyaw += 2 * Math.PI; const sc = Math.abs(dyaw); if (sc < bs) { bs = sc; best = { dyaw, pitch: Math.atan2(dy, Math.hypot(dx, dz)) }; } };
    for (const n of this.world.nearNodes(e[0], e[2], range + 2)) if (n.alive && ['tree', 'rock', 'barrel'].includes(NODE_TYPES[n.type].kind)) consider(n.x, n.y + (NODE_TYPES[n.type].kind === 'tree' ? 1.3 : 0.6), n.z);
    for (const a of this.animalList()) consider(a.x, a.y + ANIMALS[a.type].h * 0.6, a.z);
    if (best) { const k = Math.min(1, dt * 6); P.yaw += best.dyaw * k; P.pitch += (best.pitch - P.pitch) * k * 0.6; }
  }
  meleeHit(it, I) {
    const P = this.player, o = P.eye(), d = P.lookDir(), range = I.melee.range;
    // animals first (sphere tests), then remote players, then world
    let best = null, bt = range;
    for (const a of this.animalList()) { const A = ANIMALS[a.type], c = [a.x, a.y + A.h * 0.75, a.z], t = raySphere(o, d, c, A.len * 0.55); if (t != null && t < bt) { bt = t; best = { kind: 'animal', a, p: [o[0] + d[0] * t, o[1] + d[1] * t, o[2] + d[2] * t] }; } }
    for (const r of this.remote.values()) { if (r.dead) continue; const t = rayCyl(o, d, r.pos[0], r.pos[2], 0.4, r.pos[1], r.pos[1] + 1.8); if (t != null && t < bt) { bt = t; best = { kind: 'player', r, p: [o[0] + d[0] * t, o[1] + d[1] * t, o[2] + d[2] * t] }; } }
    const h = this.world.raycast(o, d, range, { pad: 0.15 });
    if (h.kind && h.t < bt) best = { kind: h.kind, ref: h.ref, p: h.p, col: h.col };
    if (!best) return;
    this.shake = Math.max(this.shake, 0.15); this.app.input.rumble(0.3, 0.2, 60);
    const wear = n => { if (it.cond != null) { it.cond -= n; if (it.cond <= 0) { const i = this.inv.belt.slots.indexOf(it); if (i >= 0) this.inv.belt.slots[i] = null; this.ui.toast(this.tr(['انكسر ', 'Broke: ']) + nameOf(it.id, this.app.lang), 'warn'); this.audio.play('fail'); } this.inv.changed('cond'); } };
    if (best.kind === 'animal') {
      const a = best.a;
      if (a.state === 'dead') { const g = I.gather && I.gather.flesh; const got = this.harvestAnimal(a, g ? g[1] : 0.3); this.blood(best.p, 4); this.audio.play('flesh', 1, best.p); for (const [id, n] of got) this.give(id, n); this.addXP(1); wear(1); return; }
      this.damageAnimal(a, I.melee.dmg, best.p); wear(1); return;
    }
    if (best.kind === 'player') { this.app.net.send({ t: 'hitPlayer', id: best.r.id, dmg: I.melee.dmg, kind: 'melee' }); this.hitMarker(); this.blood(best.p, 5); this.audio.play('flesh', 1, best.p); return; }
    if (best.kind === 'node') {
      const n = this.world.nodes[best.ref.node], nt = NODE_TYPES[n.type];
      if (nt.kind === 'barrel') { n.hp -= I.melee.dmg; this.audio.play('metal_hit', 1, best.p); this.sparks(best.p, 6); if (n.hp <= 0) this.breakBarrel(n); wear(1); return; }
      if (nt.kind === 'tree' || nt.kind === 'rock') {
        const cls = nt.kind === 'tree' ? 'tree' : 'rock', g = (I.gather && I.gather[cls]) || [4, 0.1];
        const dmg = g[0], G = GATHER[n.type === 'metal' ? 'metal' : cls];
        const yieldN = Math.max(1, Math.round(G.per * g[1] * (0.85 + Math.random() * 0.3)));
        this.give(G.item, yieldN, true); if (G.extra) this.give(G.extra[0], Math.round(G.extra[1] * g[1]), true);
        if (cls === 'tree') { this.audio.play('chop', 1, best.p); this.chips(best.p, [0.55, 0.4, 0.26], 8); this.spawnDebris('wood', best.p, 2, 0.1, 2, 2); this.leaves(n, 6); } else { this.audio.play(n.type === 'metal' ? 'ore' : 'stone', 1, best.p); this.chips(best.p, n.type === 'metal' ? [0.8, 0.5, 0.25] : [0.6, 0.58, 0.55], 10); this.sparks(best.p, 3); this.spawnDebris(n.type === 'metal' ? 'ore' : 'rock', best.p, 2, 0.1, 2.5, 2.2); }
        const hp = n.hp - dmg; this.stats.gathered += yieldN; this.addXP(1); wear(1);
        if (hp <= 0) { this.give(G.item, G.bonus, true); this.apply({ t: 'node', id: n.id, hp: 0, alive: false, respawn: this.now + RESPAWN[cls] }); if (cls === 'tree') { this.fellTree(n); this.leaves(n, 40); } else { this.audio.play('rockbreak', 1, best.p); this.chips([n.x, n.y + 0.6, n.z], [0.55, 0.53, 0.5], 30); this.spawnDebris(n.type === 'metal' ? 'ore' : 'rock', [n.x, n.y + 0.5, n.z], 16, 0.9, 4, 3.5); this.dust([n.x, n.y + 0.4, n.z], 10); } this.addXP(4); }
        else this.apply({ t: 'node', id: n.id, hp });
        this.nodeShake = { id: n.id, t: 0.25 };
        return;
      }
      if (nt.kind === 'deco') { this.audio.play('stone', 0.6, best.p); this.chips(best.p, [0.6, 0.58, 0.55], 4); return; }
    }
    if (best.kind === 'structure') {
      const st = this.world.structures.get(best.ref.st); if (!st) return;
      if (I.hammer) { this.hammerRepair(st); return; }
      const dmg = I.melee.dmg * [1, 0.1, 0.02, 0.01][st.tier]; this.audio.play(st.tier >= 2 ? 'stone' : 'wood_hit', 1, best.p);
      this.damageStructure(st, dmg); wear(1); return;
    }
    if (best.kind === 'deploy') { this.audio.play('wood_hit', 1, best.p); return; }
    if (best.kind === 'terrain' || best.kind === 'poi') { this.audio.play('wood_hit', 0.5, best.p); this.chips(best.p, [0.4, 0.35, 0.28], 5); }
  }
  fire(it, I, power) {
    const P = this.player, Rg = I.ranged, o = P.eye(), d0 = P.lookDir();
    const moving = P.speedNow > 1 ? 1.6 : 1, spread = Rg.spread * (1 - this.aim * 0.7) * moving * (1.4 - power * 0.4) * Math.PI / 180;
    const r = P.right(), u = [0, 1, 0], ax = (Math.random() - 0.5) * 2 * spread, ay = (Math.random() - 0.5) * 2 * spread;
    const d = norm([d0[0] + r[0] * ax + u[0] * ay, d0[1] + ay, d0[2] + r[2] * ax]), spd = Rg.speed * (0.45 + 0.55 * power);
    this.projectiles.push({ p: [o[0] + d[0] * 0.5, o[1] + d[1] * 0.5 - 0.05, o[2] + d[2] * 0.5], v: [d[0] * spd, d[1] * spd, d[2] * spd], t: 0, dmg: Rg.dmg * (0.4 + 0.6 * power), owner: this.myId, item: Rg.ammo });
    it.ammo = (it.ammo || 1) - 1; if (it.cond != null) it.cond -= 1;
    this.recoil = Rg.recoil * 0.06; this.shake = Math.max(this.shake, Rg.recoil * 0.12);
    this.audio.play(Rg.draw > 0 ? 'bowshot' : 'xbowshot'); this.inv.changed('ammo');
    if (this.online) this.app.net.send({ t: 'fx', k: 'shot', p: o, d });
  }
  /** hitscan firearms with spread, pellets, tracers, muzzle flash and recoil */
  fireGun(it, I) {
    const P = this.player, Rg = I.ranged, o = P.eye(), d0 = P.lookDir(), r = P.right();
    const moving = P.speedNow > 1 ? 1.8 : 1, crouch = P.crouch > 0.5 ? 0.7 : 1, base = Rg.spread * (1 - this.aim * 0.75) * moving * crouch * Math.PI / 180;
    for (let k = 0; k < (Rg.pellets || 1); k++) {
      const ax = (Math.random() - 0.5) * 2 * base, ay = (Math.random() - 0.5) * 2 * base, d = norm([d0[0] + r[0] * ax, d0[1] + ay, d0[2] + r[2] * ax]);
      let bt = Rg.range, hit = null;
      for (const a of this.animalList()) { if (a.state === 'dead') continue; const A = ANIMALS[a.type], t = raySphere(o, d, [a.x, a.y + A.h * 0.75, a.z], A.len * 0.5); if (t != null && t < bt) { bt = t; hit = { a }; } }
      for (const rp of this.remote.values()) { if (rp.dead) continue; const t = rayCyl(o, d, rp.pos[0], rp.pos[2], 0.38, rp.pos[1], rp.pos[1] + 1.8); if (t != null && t < bt) { bt = t; hit = { rp }; } }
      const w = this.world.raycast(o, d, bt); if (w.kind) { bt = w.t; hit = { w }; }
      const end = [o[0] + d[0] * bt, o[1] + d[1] * bt, o[2] + d[2] * bt], fall = Math.max(0.4, 1 - bt / Rg.range * 0.6);
      if (hit && hit.a) this.damageAnimal(hit.a, Rg.dmg * fall, end);
      else if (hit && hit.rp) { this.app.net.send({ t: 'hitPlayer', id: hit.rp.id, dmg: Rg.dmg * fall, kind: 'bullet' }); this.hitMarker(); this.blood(end, 5); }
      else if (hit && hit.w) { this.chips(end, [0.5, 0.47, 0.42], 4); this.sparks(end, 2); if (k === 0) this.audio.play('impact', 0.7, end); if (hit.w.kind === 'structure') { const st = this.world.structures.get(hit.w.ref.st); if (st) this.damageStructure(st, Rg.dmg * [0.6, 0.05, 0.01, 0.004][st.tier]); } }
      const mz = [o[0] + d0[0] * 0.8 + r[0] * 0.12, o[1] - 0.08, o[2] + d0[2] * 0.8 + r[2] * 0.12];
      for (let s = 0; s < 6; s++) { const f = 0.15 + s / 6 * 0.85; if (bt * f > 2) this.particles.emit({ p: [mz[0] + (end[0] - mz[0]) * f, mz[1] + (end[1] - mz[1]) * f, mz[2] + (end[2] - mz[2]) * f], v: [0, 0, 0], life: 0.06, s0: 0.05, s1: 0.02, c0: [1, 0.85, 0.5], a: 0.7 }, 1); }
    }
    const mz = [o[0] + d0[0] * 0.75 + r[0] * 0.1, o[1] - 0.07, o[2] + d0[2] * 0.75 + r[2] * 0.1];
    this.particles.emit(() => ({ p: mz, v: [d0[0] * 3 + (Math.random() - 0.5), d0[1] * 3 + (Math.random() - 0.5), d0[2] * 3 + (Math.random() - 0.5)], life: 0.08, s0: 0.12, s1: 0.03, c0: [1, 0.8, 0.4], c1: [1, 0.4, 0.1], a: 1 }), 6);
    this.particles.emit({ p: mz, v: [d0[0], 0.6, d0[2]], life: 1, s0: 0.08, s1: 0.4, c0: [0.5, 0.5, 0.5], a: 0.25, drag: 1, blend: 'alpha' }, 3);
    this.flash = { t: 0.06, p: mz };
    it.ammo = (it.ammo || 1) - 1; if (it.cond != null) it.cond -= 0.5;
    this.recoil = Rg.recoil * 0.05 * (1 - this.aim * 0.4); this.player.yaw += (Math.random() - 0.5) * Rg.recoil * 0.006; this.held.kick = 1; this.shake = Math.max(this.shake, Rg.recoil * 0.1);
    this.audio.play('gun_' + Rg.gun, 1); this.app.input.rumble(0.6, 0.4, 90); this.inv.changed('ammo');
    if (this.online) this.app.net.send({ t: 'fx', k: 'gun', g: Rg.gun, p: o });
  }
  updateProjectiles(dt) {
    const W = this.world;
    for (const pr of this.projectiles) {
      if (pr.dead) continue; pr.t += dt;
      const step = [pr.v[0] * dt, pr.v[1] * dt, pr.v[2] * dt], L = Math.hypot(...step), d = [step[0] / L, step[1] / L, step[2] / L];
      if (!pr.remote) {
        for (const a of this.animalList()) { if (a.state === 'dead') continue; const A = ANIMALS[a.type], t = raySphere(pr.p, d, [a.x, a.y + A.h * 0.75, a.z], A.len * 0.5); if (t != null && t <= L) { this.damageAnimal(a, pr.dmg, pr.p); pr.dead = true; break; } }
        if (!pr.dead) for (const r of this.remote.values()) { if (r.dead) continue; const t = rayCyl(pr.p, d, r.pos[0], r.pos[2], 0.4, r.pos[1], r.pos[1] + 1.8); if (t != null && t <= L) { this.app.net.send({ t: 'hitPlayer', id: r.id, dmg: pr.dmg, kind: 'arrow' }); this.hitMarker(); pr.dead = true; break; } }
      }
      if (!pr.dead) { const h = W.raycast(pr.p, d, L); if (h.kind) { pr.dead = true; pr.stuck = h.p; this.audio.play('arrowhit', 0.8, h.p); this.chips(h.p, [0.5, 0.45, 0.35], 4); if (!pr.remote && Math.random() < 0.65 && h.kind !== 'node') this.spawnDrop(h.p, [{ id: 'arrow', n: 1 }], 60); } }
      if (!pr.dead) { pr.p[0] += step[0]; pr.p[1] += step[1]; pr.p[2] += step[2]; pr.v[1] -= 9.8 * dt; if (pr.t > 6) pr.dead = true; }
    }
    this.projectiles = this.projectiles.filter(p => !p.dead || (p.stuck && p.t < 0.05));
  }
  // ================================================================== animals
  animalList() { return this.online ? (this.netAnimals || []) : this.animals.list; }
  damageAnimal(a, dmg, p) {
    this.blood(p, 6); this.audio.play('flesh', 1, p); this.hitMarker();
    if (this.online) { this.app.net.send({ t: 'hitAnimal', id: a.id, dmg }); return; }
    const r = this.animals.hurt(a, dmg, this.myId);
    if (a.type === 'deer') this.audio.play('deer', 1, [a.x, a.y, a.z]); else if (a.type === 'bear') this.audio.play('growl', 1, [a.x, a.y, a.z]); else this.audio.play('grunt', 1, [a.x, a.y, a.z]);
    if (r === 'dead') { this.stats.kills++; this.addXP({ deer: 10, boar: 14, wolf: 18, bear: 45 }[a.type]); this.ui.toast(this.tr(['قتلت ', 'Killed ']) + this.tr(ANIMAL_NAMES[a.type]), 'signal'); }
  }
  harvestAnimal(a, mult) { if (this.online) { this.app.net.send({ t: 'harvest', id: a.id, mult }); return []; } return this.animals.harvest(a, Math.max(0.3, mult)); }
  animalAttack(a, dmg, bleed) {
    const P = this.player; this.audio.play('bite', 1, [a.x, a.y + 0.5, a.z]);
    P.damage(dmg, 'animal', { t: this.t, onHurt: (d, type) => this.onHurt(d, type), onDeath: (type) => this.onDeath(type, a.type) }, a.type);
    if (bleed) P.effects.bleed = Math.min(40, (P.effects.bleed || 0) + 8);
  }
  // ================================================================== interaction
  findFocus() {
    const P = this.player, o = P.eye(), d = P.lookDir(), h = this.world.raycast(o, d, 2.8);
    for (const a of this.animalList()) { if (a.state !== 'dead') continue; const t = raySphere(o, d, [a.x, a.y + 0.4, a.z], 0.8); if (t != null && t < (h.kind ? h.t : 2.8)) return { kind: 'corpse', a, t }; }
    if (h.kind === 'node') { const n = this.world.nodes[h.ref.node]; if (!n || !n.alive) return null; const k = NODE_TYPES[n.type].kind; if (k === 'pick' || k === 'loot') return { kind: k, n, t: h.t }; if (k === 'tree' || k === 'rock' || k === 'barrel') return { kind: 'hit', n, t: h.t }; return null; }
    if (h.kind === 'deploy') { const dp = this.world.deploys.get(h.ref.dep); return dp ? { kind: 'deploy', d: dp, t: h.t } : null; }
    if (h.kind === 'drop') { const dr = this.world.drops.get(h.ref.drop); return dr ? { kind: 'drop', dr, t: h.t } : null; }
    if (h.kind === 'structure') return { kind: 'structure', st: this.world.structures.get(h.ref.st), t: h.t };
    // drinking: looking at water nearby, or standing in it
    const lookWater = (() => { for (let t = 0.5; t < 3; t += 0.25) { const p = [o[0] + d[0] * t, o[1] + d[1] * t, o[2] + d[2] * t]; if (p[1] < WATER + 0.05 && this.world.height(p[0], p[2]) < WATER - 0.1) return true; if (p[1] < this.world.height(p[0], p[2])) return false; } return false; })();
    if (lookWater || (P.pos[1] < WATER + 0.3 && this.world.height(P.pos[0], P.pos[2]) < WATER - 0.2)) return { kind: 'water' };
    return null;
  }
  focusStructure() { const P = this.player, h = this.world.raycast(P.eye(), P.lookDir(), 4); return h.kind === 'structure' ? this.world.structures.get(h.ref.st) : null; }
  focusLabel() {
    const f = this.focus; if (!f) return null; const L = this.app.lang;
    switch (f.kind) {
      case 'pick': return [this.tr(['اجمع', 'Gather']) + ' ' + this.tr(PICK_NAMES[f.n.type]), 'E'];
      case 'loot': return [this.tr(['افتح الصندوق', 'Open crate']), 'E'];
      case 'hit': return [NODE_TYPES[f.n.type].kind === 'tree' ? this.tr(['اقطع بالفأس', 'Chop with a hatchet']) : NODE_TYPES[f.n.type].kind === 'barrel' ? this.tr(['اكسر البرميل', 'Break the barrel']) : this.tr(['اكسر بالمعول', 'Mine with a pickaxe']), 'LMB'];
      case 'corpse': return [this.tr(['اسلخ بأداة', 'Harvest with a tool']) + ' · ' + this.tr(ANIMAL_NAMES[f.a.type]), 'LMB'];
      case 'drop': return [f.dr.bag ? this.tr(['افتح الحقيبة', 'Open backpack']) : this.tr(['التقط', 'Pick up']) + ' ' + (f.dr.items[0] ? nameOf(f.dr.items[0].id, L) : ''), 'E'];
      case 'water': return [this.tr(['اشرب', 'Drink']) + (this.jugInHand() ? ' / ' + this.tr(['عبّي القارورة', 'Fill jug']) : ''), 'E'];
      case 'structure': return this.mode === 'hammer' && f.st ? [this.tr(['إصلاح', 'Repair']) + ' · ' + this.tr(['كليك يمين: تطوير', 'RMB: upgrade']), 'LMB'] : null;
      case 'deploy': {
        const d = f.d, k = d.kind; if (k === 'door') return [d.open ? this.tr(['سكّر الباب', 'Close door']) : this.tr(['افتح الباب', 'Open door']), 'E'];
        if (k === 'bench') return [nameOf(d.item, L) + ' · ' + this.tr(['افتح الصناعة', 'Open crafting']), 'E'];
        if (k === 'bag') return [this.tr(['نقطة الرجوع', 'Respawn point']), ''];
        return [this.tr(['افتح', 'Open']) + ' ' + nameOf(d.item, L), 'E'];
      }
    }
    return null;
  }
  jugInHand() { const it = this.inv.activeItem(); return it && it.id === 'water_jug' ? it : null; }
  interact(f) {
    const P = this.player;
    switch (f.kind) {
      case 'pick': {
        const n = f.n; for (const [id, a, b] of PICKUP[n.type]) this.give(id, a + Math.floor(Math.random() * (b - a + 1)), true);
        this.audio.play('pickup'); this.apply({ t: 'node', id: n.id, alive: false, respawn: this.now + RESPAWN.pick }); this.addXP(1); break;
      }
      case 'loot': {
        const n = f.n;
        if (!n.inv) { const items = rollLoot(n.tier > 1 ? 'crate2' : 'crate1'); n.inv = new Array(12).fill(null); items.forEach((x, i) => { n.inv[i] = Object.assign(makeItem(x.id, x.n), { n: x.n }); }); if (!this.online) this.apply({ t: 'node', id: n.id, inv: n.inv }); }
        this.openContainer({ kind: 'crate', n, slots: n.inv, title: nameOf('storage_box', this.app.lang) }); this.audio.play('open'); break;
      }
      case 'drop': {
        const dr = f.dr;
        if (dr.bag || dr.items.length > 1) { this.openContainer({ kind: 'drop', dr, slots: padTo(dr.items, Math.max(12, dr.items.length)), title: this.tr(['حقيبة', 'Backpack']) }); this.audio.play('open'); break; }
        const left = this.inv.giveItem(Object.assign({}, dr.items[0])); if (left > 0) { dr.items[0].n = left; this.ui.toast(this.tr(['الحقيبة مليانة', 'Inventory full']), 'warn'); this.apply({ t: 'dropU', id: dr.id, items: dr.items }); }
        else { this.feedAdd(dr.items[0].id, dr.items[0].n); this.apply({ t: 'drop-', id: dr.id }); }
        this.audio.play('pickup'); break;
      }
      case 'water': {
        const jug = this.jugInHand(); if (jug && jug.jug < 100) { jug.jug = 100; this.audio.play('drink'); this.ui.toast(this.tr(['عبّيت القارورة', 'Jug filled']), 'ok'); this.inv.changed('jug'); break; }
        P.water = Math.min(100, P.water + 18); this.audio.play('drink'); break;
      }
      case 'deploy': {
        const d = f.d;
        if (d.kind === 'door') { this.apply({ t: 'depU', id: d.id, patch: { open: !d.open } }); this.audio.play('door', 1, [d.x, d.y + 1, d.z]); break; }
        if (d.kind === 'bench') { this.ui.openInventory('craft'); break; }
        if (d.inv) { this.openContainer({ kind: 'deploy', d, slots: d.inv, title: nameOf(d.item, this.app.lang) }); this.audio.play('open'); }
        break;
      }
    }
  }
  openContainer(c) { c.cont = new Container(c.slots.length, 'ext'); c.cont.slots = c.slots; this.openCont = c; this.ui.openInventory('container'); }
  closeContainer() {
    const c = this.openCont; if (!c) return; this.openCont = null;
    if (c.kind === 'crate') { if (c.cont.isEmpty()) this.apply({ t: 'node', id: c.n.id, alive: false, inv: null, respawn: this.now + RESPAWN.loot }); else this.apply({ t: 'node', id: c.n.id, inv: c.cont.slots }); }
    else if (c.kind === 'drop') { const items = c.cont.slots.filter(Boolean); if (!items.length) this.apply({ t: 'drop-', id: c.dr.id }); else this.apply({ t: 'dropU', id: c.dr.id, items }); }
    else if (c.kind === 'deploy') this.apply({ t: 'depU', id: c.d.id, patch: { inv: c.cont.slots } });
    this.audio.play('close');
  }
  containerChanged() { const c = this.openCont; if (c && c.kind === 'deploy' && this.online) this.apply({ t: 'depU', id: c.d.id, patch: { inv: c.cont.slots } }); }
  // ================================================================== items: use / give / drop
  give(id, n, feed) {
    if (n <= 0) return; const left = this.inv.give(id, n);
    if (left > 0) { const P = this.player, f = P.forward(); this.spawnDrop([P.pos[0] + f[0], P.pos[1] + 0.5, P.pos[2] + f[2]], [{ id, n: left }]); this.ui.toast(this.tr(['الحقيبة مليانة — انرمى على الأرض', 'Inventory full — dropped on the ground']), 'warn'); }
    if (feed !== false) this.feedAdd(id, n - left);
  }
  feedAdd(id, n) { if (n <= 0) return; const last = this.feed.find(f => f.id === id && this.t - f.t < 1.5); if (last) { last.n += n; last.t = this.t; } else this.feed.push({ id, n, t: this.t }); if (this.feed.length > 6) this.feed.shift(); }
  useItem(cont, i) {
    const it = cont.slots[i]; if (!it) return; const I = ITEMS[it.id], P = this.player;
    if (I.eat) { const E = I.eat; if (E.food) P.food = Math.min(100, P.food + E.food); if (E.water) P.water = Math.min(100, P.water + E.water); if (E.hp) P.hp = Math.min(100, P.hp + E.hp); if (E.poison && Math.random() < E.poison) { P.effects.poison = (P.effects.poison || 0) + 12; this.ui.toast(this.tr(['تسممت من اللحم النيء', 'Food poisoning from raw meat']), 'err'); } this.audio.play('eat'); this.consume(cont, i); return true; }
    if (I.jug != null) { if (it.jug >= 25) { it.jug -= 25; P.water = Math.min(100, P.water + 25); this.audio.play('drink'); this.inv.changed('jug'); } else { this.ui.toast(this.tr(['القارورة فاضية — عبّها من الموية', 'The jug is empty — fill it at water']), 'warn'); this.audio.play('fail'); } return true; }
    if (I.heal) { const H = I.heal; P.hp = Math.min(100, P.hp + H.hp); if (H.regen) P.effects.regen = (P.effects.regen || 0) + H.regen; if (H.stopBleed) delete P.effects.bleed; if (H.cure) delete P.effects.poison; this.audio.play('bandage'); this.consume(cont, i); return true; }
    if (I.wear) { const di = WEAR_SLOTS.indexOf(I.wear.slot); PlayerInventory.move(cont, i, this.inv.wear, di); this.recalcWear(); this.audio.play('ui'); this.inv.changed('wear'); return true; }
    return false;
  }
  consume(cont, i) { const it = cont.slots[i]; it.n--; if (it.n <= 0) cont.slots[i] = null; this.inv.changed('use'); }
  recalcWear() { const a = this.inv.armor(); this.player.armor = a.armor; this.player.ins = a.ins; }
  dropActive() { const i = this.inv.active, it = this.inv.belt.slots[i]; if (!it) return; this.dropItem(this.inv.belt, i); }
  dropItem(cont, i, n) {
    const it = cont.slots[i]; if (!it) return; const P = this.player, f = P.forward(), amt = Math.min(it.n, n || it.n);
    const out = Object.assign({}, it, { n: amt }); it.n -= amt; if (it.n <= 0) cont.slots[i] = null;
    this.spawnDrop([P.pos[0] + f[0] * 1.2, P.pos[1] + 0.8, P.pos[2] + f[2] * 1.2], [out]); this.audio.play('uiback'); this.inv.changed('drop');
  }
  spawnDrop(p, items, ttl = 600, bag = false) {
    const g = this.world.ground(p[0], p[2], p[1] + 0.5, 1.2);
    const dr = { id: this.world.newId('d'), x: p[0], y: Math.max(g, p[1] < g ? g : g), z: p[2], items, bag, until: this.now + ttl, ry: Math.random() * 6.28 };
    this.apply({ t: 'drop+', dr }); return dr;
  }
  breakBarrel(n) { const items = rollLoot('barrel').map(x => ({ id: x.id, n: x.n })); this.apply({ t: 'node', id: n.id, alive: false, respawn: this.now + RESPAWN.barrel }); if (items.length) this.spawnDrop([n.x, n.y + 0.3, n.z], items, 300); this.audio.play('splinter', 1, [n.x, n.y, n.z]); this.spawnDebris('metal', [n.x, n.y + 0.5, n.z], 10, 0.4, 3, 3); this.addXP(2); }
  // ================================================================== crafting
  benchLevel() { let L = 0; const p = this.player.pos; for (const d of this.world.deploys.values()) if (d.kind === 'bench' && Math.hypot(d.x - p[0], d.z - p[2]) < 4 && Math.abs(d.y - p[1]) < 3) L = Math.max(L, ITEMS[d.item].deploy.level); return L; }
  canCraft(r, n = 1) { const req = {}; for (const k in r.req) req[k] = r.req[k] * n; if (this.creative) return { ok: true, bench: true, res: true, req: {} }; return { ok: this.inv.has(req) && this.benchLevel() >= r.bench, bench: this.benchLevel() >= r.bench, res: this.inv.has(req), req }; }
  craft(r, n = 1) {
    const c = this.canCraft(r, n); if (!c.ok) { this.audio.play('fail'); this.ui.toast(c.bench ? this.tr(['ناقصك موارد', 'Missing resources']) : this.tr(['تحتاج طاولة عمل مستوى ', 'Needs Workbench Lv.']) + r.bench, 'warn'); return false; }
    this.inv.take(c.req); this.queue.push({ r, n, left: n, t: this.creative ? 0.05 : r.time, total: r.time, req: c.req }); this.audio.play('craft'); return true;
  }
  cancelCraft(i) { const q = this.queue[i]; if (!q) return; const per = {}; for (const k in q.r.req) per[k] = q.r.req[k] * q.left; for (const k in per) this.give(k, per[k], false); this.queue.splice(i, 1); this.audio.play('uiback'); this.inv.changed('cancel'); }
  updateQueue(dt) {
    const q = this.queue[0]; if (!q) return;
    q.t -= dt;
    if (q.t <= 0) { q.left--; this.give(q.r.out, q.r.n); this.stats.crafted++; this.addXP(Math.ceil(q.r.time)); this.audio.play('craftdone'); if (q.left <= 0) this.queue.shift(); else q.t = q.r.time; }
  }
  // ================================================================== building
  placeStructure(c) {
    if (!this.creative) this.inv.take(c.cost);
    let bid = c.b, b = null;
    if (!bid) { b = { id: this.world.newId('b'), x: c.newB.x, y: c.newB.y, z: c.newB.z, ry: c.newB.ry, owner: this.ownerId }; bid = b.id; }
    const st = { id: this.world.newId('s'), b: bid, piece: c.piece, tier: 0, hp: pieceHP(c.piece, 0), i: c.i, j: c.j, l: c.l, side: c.side, rot: c.rot || 0, owner: this.ownerId, supported: c.supported, at: Date.now() };
    this.apply({ t: 'st+', st, b }); this.audio.play('build', 1, c.p); this.stats.built++; this.addXP(3);
    this.dust(c.p, 14);
  }
  placeDeploy(c) {
    const it = this.inv.activeItem(); if (!it) return;
    const d = { id: this.world.newId('p'), item: it.id, x: c.p[0], y: c.p[1], z: c.p[2], ry: c.ry, owner: this.ownerId, on: c.on };
    this.consume(this.inv.belt, this.inv.active);
    this.apply({ t: 'dep+', d }); this.audio.play('build', 0.7, c.p); this.addXP(2);
    if (d.item === 'sleeping_bag') this.ui.toast(this.tr(['كيس النوم صار نقطة رجوعك', 'Sleeping bag set as your respawn point']), 'ok');
  }
  hammerRepair(st) {
    const cost = this.builder.repairCost(st); if (!cost) { this.audio.play('wood_hit'); return; }
    if (!this.inv.has(cost)) { this.audio.play('fail'); this.ui.toast(this.tr(['ما عندك موارد للإصلاح', 'Not enough resources to repair']), 'warn'); return; }
    this.inv.take(cost); const max = pieceHP(st.piece, st.tier); this.apply({ t: 'stU', id: st.id, patch: { hp: Math.min(max, st.hp + max * 0.25) } }); this.audio.play('upgrade', 0.5, this.world.structureTransform(st).p);
  }
  upgrade(st, tier) {
    const cost = pieceCost(st.piece, tier); if (!this.inv.has(cost) && !this.creative) { this.audio.play('fail'); this.ui.toast(this.tr(['ناقصك موارد', 'Missing resources']), 'warn'); return; }
    if (!this.creative) this.inv.take(cost);
    this.apply({ t: 'stU', id: st.id, patch: { tier, hp: pieceHP(st.piece, tier) } }); const p = this.world.structureTransform(st).p; this.audio.play('upgrade', 1, p); this.dust([p[0], p[1] + 1, p[2]], 20); this.addXP(5);
  }
  demolish(st) {
    const p = this.world.structureTransform(st).p; this.spawnDebris(['plank', 'plank', 'rock', 'metal'][st.tier], [p[0], p[1] + 1.2, p[2]], 14, 1.2, 3, 2.5);
    // refuse to pull out supports: anything above relies on it
    this.apply({ t: 'st-', id: st.id }); this.audio.play('demolish', 1, p); this.dust([p[0], p[1] + 1, p[2]], 26);
    const c = pieceCost(st.piece, st.tier); for (const k in c) this.give(k, Math.floor(c[k] * 0.3), false);
  }
  damageStructure(st, dmg) { const hp = st.hp - dmg; if (hp <= 0) { this.demolishNoRefund(st); } else this.apply({ t: 'stU', id: st.id, patch: { hp } }); }
  demolishNoRefund(st) { const p = this.world.structureTransform(st).p; this.spawnDebris(['plank', 'plank', 'rock', 'metal'][st.tier], [p[0], p[1] + 1.2, p[2]], 14, 1.2, 3, 2.5); this.apply({ t: 'st-', id: st.id }); this.audio.play('demolish', 1, p); this.dust([p[0], p[1] + 1, p[2]], 26); }
  // ================================================================== deployables runtime
  updateDeployables(dt) {
    if (this.online) return; // server runs these online
    for (const d of this.world.deploys.values()) {
      if (!d.lit || !d.inv) continue;
      d.burn = (d.burn || 0) - dt; d.work = (d.work || 0) + dt;
      if (d.burn <= 0) { const wi = d.inv.findIndex(s => s && s.id === 'wood'); if (wi < 0) { d.lit = false; continue; } d.inv[wi].n--; if (!d.inv[wi].n) d.inv[wi] = null; d.burn = d.kind === 'furnace' ? 4 : 6; }
      if (d.kind === 'campfire' && d.work >= 10) { d.work = 0; const ri = d.inv.findIndex(s => s && s.id === 'raw_meat'); if (ri >= 0) { d.inv[ri].n--; if (!d.inv[ri].n) d.inv[ri] = null; addTo(d.inv, 'cooked_meat', 1); } }
      if (d.kind === 'furnace' && d.work >= 2) { d.work = 0; const oi = d.inv.findIndex(s => s && s.id === 'metal_ore'); if (oi >= 0) { d.inv[oi].n--; if (!d.inv[oi].n) d.inv[oi] = null; addTo(d.inv, 'metal_frag', 1); } }
      if (this.openCont && this.openCont.d === d) this.ui.refreshContainer();
    }
  }
  toggleLit(d) { const lit = !d.lit; if (lit && !d.inv.some(s => s && s.id === 'wood')) { this.audio.play('fail'); this.ui.toast(this.tr(['حط خشب كوقود', 'Add wood as fuel']), 'warn'); return; } this.apply({ t: 'depU', id: d.id, patch: { lit } }); if (lit) this.audio.play('firelight', 1, [d.x, d.y, d.z]); }
  fireWarmth() { let w = 0; const p = this.player.pos; for (const d of this.world.deploys.values()) if (d.lit) { const r = Math.hypot(d.x - p[0], d.z - p[2]); if (r < 5) w = Math.max(w, (1 - r / 5) * 16); } return w; }
  isSheltered() { const p = this.player.pos; return this.world.ceiling(p[0], p[2], p[1], 1.8) < p[1] + 8; }
  // ================================================================== damage / death / respawn
  onHurt(d, type) {
    this.hurtFx = Math.min(1, this.hurtFx + d / 25); this.shake = Math.max(this.shake, Math.min(0.6, d / 30)); if (!['cold', 'starve', 'thirst', 'bleed', 'poison'].includes(type) || d > 2) this.audio.play('hurt', Math.min(1, d / 20));
    this.app.input.rumble(0.7, 0.5, 160); this.lastDmgDir = type;
  }
  onDeath(type, src) {
    this.stats.deaths++; this.audio.play('death'); this.app.input.unlock();
    const P = this.player, items = this.inv.allItems().map(x => Object.assign({}, x));
    if (items.length) this.spawnDrop([P.pos[0], P.pos[1] + 0.3, P.pos[2]], items, 1200, true);
    this.inv.clearAll(); this.queue = []; this.recalcWear();
    this.deathInfo = { type, src, at: this.now, pos: P.pos.slice() };
    if (this.online) this.app.net.send({ t: 'died', cause: type, src });
    this.ui.death(this.deathInfo);
  }
  respawn(atBag) {
    let sp = null;
    if (atBag) { const bag = [...this.world.deploys.values()].find(d => d.kind === 'bag' && d.owner === this.ownerId); if (bag) sp = [bag.x + 0.8, bag.y + 0.1, bag.z]; }
    if (!sp) { const s = this.world.spawns[Math.floor(Math.random() * this.world.spawns.length)]; sp = [s[0], this.world.height(s[0], s[2]) + 0.1, s[2]]; }
    const P = new Player(sp); P.yaw = Math.atan2(-sp[0], sp[2]); P.food = 55; P.water = 55; P.hp = 60; this.player = P;
    this.inv.belt.slots[0] = makeItem('rock'); this.inv.belt.slots[1] = makeItem('torch'); this.inv.active = 0; this.inv.changed('respawn'); this.recalcWear();
    this.ui.hideDeath(); this.app.lockPointer();
  }
  /** first-time objectives: teach gathering → crafting → building a first base */
  checkObjectives() {
    const o = this.stats.obj || 0; if (o >= OBJECTIVES.length) return;
    const mine = p => [...this.world.structures.values()].filter(st => st.owner === this.ownerId && st.piece === p).length;
    const dep = k => [...this.world.deploys.values()].some(d => d.owner === this.ownerId && d.item === k);
    const ok = [() => this.inv.count('wood') >= 200, () => this.inv.count('stone') >= 100, () => this.inv.count('stone_hatchet') + this.inv.count('stone_pickaxe') > 0, () => this.inv.count('plan') > 0,
      () => mine('foundation') >= 1, () => mine('wall') + mine('window') >= 3 && mine('doorway') >= 1, () => dep('wooden_door') || dep('metal_door'), () => dep('campfire'), () => dep('sleeping_bag')][o];
    if (ok && ok()) { this.stats.obj = o + 1; this.addXP(15); this.audio.play('craftdone'); this.ui.toast('✓ ' + this.tr(OBJECTIVES[o].t), 'ok', 3500); }
  }
  objectiveInfo() {
    const o = this.stats.obj || 0; if (o >= OBJECTIVES.length) return null;
    const O = OBJECTIVES[o], prog = o === 0 ? Math.min(200, this.inv.count('wood')) + '/200' : o === 1 ? Math.min(100, this.inv.count('stone')) + '/100' : '';
    return { n: o + 1, total: OBJECTIVES.length, t: this.tr(O.t), h: this.tr(O.h), prog };
  }
  addXP(n) { const before = this.stats.level; this.stats.xp += n; while (this.stats.xp >= LEVEL_XP(this.stats.level + 1)) this.stats.level++; if (this.stats.level > before) { this.audio.play('levelup'); this.ui.toast(this.tr(['مستوى جديد ', 'Level up ']) + this.stats.level, 'signal'); } }
  // ================================================================== audio
  footstep(pl) {
    const p = pl.pos, h = this.world.height(p[0], p[2]);
    let s = 'grass'; if (pl.swimming || h < WATER + 0.1 && p[1] < WATER + 0.4) s = 'water'; else if (Math.abs(p[1] - h) > 0.15) { const st = this.standingOn(); s = st && st.tier >= 2 ? (st.tier === 3 ? 'metal' : 'rock') : 'wood'; } else { const b = this.world.T.biome(p[0], p[2]); s = b === 1 ? 'sand' : b === 4 ? 'rock' : b === 5 ? 'snow' : 'grass'; }
    this.audio.footstep(s, pl.sprinting ? 1.2 : pl.crouch > 0.5 ? 0.45 : 0.85);
    if (s === 'water' || s === 'sand') this.particles.emit({ p: [p[0], p[1] + 0.05, p[2]], v: [(Math.random() - 0.5), 0.8, (Math.random() - 0.5)], life: 0.5, s0: 0.12, s1: 0.3, c0: s === 'water' ? [0.8, 0.85, 0.9] : [0.7, 0.62, 0.5], a: 0.35, g: 3, blend: 'alpha' }, 3);
  }
  standingOn() { const p = this.player.pos; let best = null; this.world.near(p[0], p[2], 0.5, c => { if (c.t === 'b' && c.ref.st && Math.abs(c.c[1] + c.h[1] - p[1]) < 0.3) best = this.world.structures.get(c.ref.st); }); return best; }
  updateAudio(dt) {
    const P = this.player, E = this.env, W = this.world, p = P.pos;
    this.audio.setListener(P.eye(), P.lookDir());
    let surf = 0; for (let a = 0; a < 8; a++) { const x = p[0] + Math.cos(a * 0.785) * 30, z = p[2] + Math.sin(a * 0.785) * 30; if (W.height(x, z) < -1) surf += 1 / 8; }
    const b = W.T.biome(p[0], p[2]), forest = b === 3 ? 1 : b === 2 ? 0.5 : 0.1, night = E.isNight;
    this.audio.update({ wind: E.cur.wind * (0.6 + Math.max(0, p[1] - 30) / 80), rain: E.cur.rain, surf, birds: !night && E.cur.rain < 0.3 ? forest : 0, crickets: night && E.cur.rain < 0.3 ? forest * 0.8 : 0, fire: Math.min(1, this.fireWarmth() / 10), under: P.headUnder, sheltered: this.isSheltered() }, this.combatLevel());
    this.audio.setMood(this.combatLevel() > 0.3 ? 'danger' : night ? 'night' : 'day');
    if (night && Math.random() < dt * 0.008) { const a = this.animalList().find(x => x.type === 'wolf' && x.state !== 'dead'); if (a) this.audio.play('wolf', 1, [a.x, a.y + 1, a.z]); }
  }
  combatLevel() { let k = 0; for (const a of this.animalList()) if (a.state === 'chase') { const d = Math.hypot(a.x - this.player.pos[0], a.z - this.player.pos[2]); k = Math.max(k, 1 - d / 40); } return k; }
  // ================================================================== VFX helpers
  chips(p, col, n) { this.particles.emit(() => ({ p, v: [(Math.random() - 0.5) * 4, Math.random() * 3 + 1, (Math.random() - 0.5) * 4], life: 0.6 + Math.random() * 0.4, s0: 0.05, s1: 0.03, c0: col, a: 1, g: 9, drag: 1, blend: 'alpha' }), n); this.particles.emit({ p, v: [0, 0.5, 0], life: 0.8, s0: 0.15, s1: 0.5, c0: mixc(col, [0.8, 0.8, 0.8], 0.5), a: 0.25, blend: 'alpha' }, 2); }
  sparks(p, n) { this.particles.emit(() => ({ p, v: [(Math.random() - 0.5) * 6, Math.random() * 4, (Math.random() - 0.5) * 6], life: 0.3 + Math.random() * 0.3, s0: 0.03, s1: 0.01, c0: [1, 0.8, 0.4], c1: [1, 0.3, 0.1], a: 1, g: 9 }), n); }
  blood(p, n) { this.particles.emit(() => ({ p, v: [(Math.random() - 0.5) * 3, Math.random() * 2.5, (Math.random() - 0.5) * 3], life: 0.5 + Math.random() * 0.3, s0: 0.06, s1: 0.04, c0: [0.5, 0.04, 0.03], a: 0.9, g: 9, blend: 'alpha' }), n); }
  dust(p, n) { this.particles.emit(() => ({ p: [p[0] + (Math.random() - 0.5) * 2, p[1] + Math.random() * 0.5, p[2] + (Math.random() - 0.5) * 2], v: [(Math.random() - 0.5) * 1.5, Math.random() * 1, (Math.random() - 0.5) * 1.5], life: 1.2 + Math.random(), s0: 0.3, s1: 1.1, c0: [0.62, 0.56, 0.48], a: 0.3, drag: 1.5, blend: 'alpha' }), n); }
  spawnDebris(kind, p, n, spread = 0.4, up = 3, speed = 2.5) {
    for (let i = 0; i < n; i++) {
      const v = Math.floor(Math.random() * 6), key = 'deb:' + kind + v; if (!this.vm.has(key)) this.vm.set(key, this.R.upload(debrisModel(kind, v)));
      const a = Math.random() * 6.28;
      this.debris.push({ m: this.vm.get(key), p: [p[0] + Math.cos(a) * spread * Math.random(), p[1] + Math.random() * spread, p[2] + Math.sin(a) * spread * Math.random()], v: [Math.cos(a) * speed * (0.4 + Math.random()), up * (0.5 + Math.random()), Math.sin(a) * speed * (0.4 + Math.random())], r: [Math.random() * 6, Math.random() * 6, Math.random() * 6], w: [(Math.random() - 0.5) * 12, (Math.random() - 0.5) * 12, (Math.random() - 0.5) * 12], t: 0, life: 4 + Math.random() * 2, s: 0.8 + Math.random() * 0.5 });
    }
    if (this.debris.length > 180) this.debris.splice(0, this.debris.length - 180);
  }
  updateDebris(dt) {
    for (const d of this.debris) {
      d.t += dt; d.v[1] -= 14 * dt; for (let k = 0; k < 3; k++) { d.p[k] += d.v[k] * dt; d.r[k] += d.w[k] * dt; }
      const g = this.world.ground(d.p[0], d.p[2], d.p[1] + 0.3, 0.5);
      if (d.p[1] < g + 0.04) { d.p[1] = g + 0.04; if (d.v[1] < -1.5 && !d.landed) { d.landed = 1; if (Math.random() < 0.3) this.audio.play('crumble', 0.6, d.p); } d.v[1] *= -0.3; d.v[0] *= 0.6; d.v[2] *= 0.6; for (const k of [0, 1, 2]) d.w[k] *= 0.7; }
    }
    this.debris = this.debris.filter(d => d.t < d.life);
  }
  drawDebris() { for (const d of this.debris) { const sc = d.s * Math.min(1, (d.life - d.t) * 1.5); this.R.draw(d.m, trs(d.p, d.r[1], sc, d.r[0], d.r[2])); } }
  leaves(n, cnt) { const t = NODE_TYPES[n.type]; if (t.kind !== 'tree' || n.type === 'dead') return; const col = n.type === 'pine' ? [0.16, 0.29, 0.17] : n.type === 'birch' ? [0.48, 0.6, 0.23] : [0.24, 0.37, 0.17]; this.particles.emit(() => ({ p: [n.x + (Math.random() - 0.5) * 4, n.y + 3 + Math.random() * 4, n.z + (Math.random() - 0.5) * 4], v: [(Math.random() - 0.5) * 1.2, -0.6 - Math.random() * 0.5, (Math.random() - 0.5) * 1.2], life: 2.2 + Math.random(), s0: 0.06, s1: 0.05, c0: col, a: 0.95, g: 0.4, drag: 0.6, blend: 'alpha' }), cnt); }
  hitMarker() { this.hits.push({ t: this.t }); this.audio.play('hitmarker'); }
  fellTree(n) { this.audio.play('treefall', 1, [n.x, n.y + 3, n.z]); const P = this.player, ang = Math.atan2(n.x - P.pos[0], -(n.z - P.pos[2])); this.falling.push({ n, t: 0, ang, model: this.R.upload(treeModel(n.type, (n.id % 5) * 17 + 3).mb) }); }
  updateFalling(dt) { for (const f of this.falling) { f.t += dt; if (f.t > 1.6 && !f.dusted) { f.dusted = true; const L = 7; const lp = [f.n.x + Math.sin(f.ang) * L * 0.6, f.n.y + 0.5, f.n.z - Math.cos(f.ang) * L * 0.6]; this.dust([f.n.x + Math.sin(f.ang) * L, f.n.y, f.n.z - Math.cos(f.ang) * L], 30); this.spawnDebris('wood', lp, 8, 2, 2.5, 2); this.shake = Math.max(this.shake, 0.12); } } this.falling = this.falling.filter(f => { if (f.t > 3.2) { this.R.free(f.model); return false; } return true; }); }
  // ================================================================== save / restore (solo)
  serialize() {
    const W = this.world;
    return {
      v: 1, seed: this.seed, now: this.now, env: this.env.serialize(), player: this.player.serialize(), inv: this.inv.serialize(), stats: this.stats, queue: this.queue.map(q => ({ id: q.r.out, left: q.left, t: q.t })),
      nodes: W.nodes.filter(n => !n.alive || n.inv || n.hp < NODE_TYPES[n.type].hp).map(n => [n.id, n.alive ? 1 : 0, Math.round(n.respawn), Math.round(n.hp), n.inv || 0]),
      buildings: [...W.buildings.values()], structures: [...W.structures.values()].map(s => { const o = Object.assign({}, s); delete o.cols; return o; }),
      deploys: [...W.deploys.values()].map(d => ({ id: d.id, item: d.item, x: d.x, y: d.y, z: d.z, ry: d.ry, owner: d.owner, on: d.on, inv: d.inv, lit: d.lit, open: d.open })),
      drops: [...W.drops.values()].filter(d => d.until > this.now), saved: Date.now()
    };
  }
  restore(s) {
    const W = this.world; this.now = s.now || 0; this.env.restore(s.env); this.player = new Player(s.player.pos); this.player.restore(s.player); this.inv.restore(s.inv); Object.assign(this.stats, s.stats || {}); this.stats.sessions = (this.stats.sessions || 0) + 1;
    for (const [id, alive, resp, hp, inv] of s.nodes || []) { const n = W.nodes[id]; if (!n) continue; if (!alive) W.setNodeAlive(n, false, resp); n.hp = hp; if (inv) n.inv = inv; }
    for (const b of s.buildings || []) W.buildings.set(b.id, b);
    for (const st of s.structures || []) W.addStructure(st);
    for (const d of s.deploys || []) { W.addDeploy(d); if (d.open) W.setDoor(W.deploys.get(d.id), true); }
    for (const d of s.drops || []) W.addDrop(d);
    for (const q of s.queue || []) { const r = RECIPES.find(x => x.out === q.id); if (r) this.queue.push({ r, n: q.left, left: q.left, t: q.t, total: r.time, req: r.req }); }
    this.recalcWear();
  }
  save() { if (this.online) return; try { localStorage.setItem(SAVE_KEY, JSON.stringify(this.serialize())); this.lastSave = Date.now(); } catch (e) { console.warn('save failed', e); } }
  static loadSave() { try { return JSON.parse(localStorage.getItem(SAVE_KEY) || 'null'); } catch (e) { return null; } }
  static wipeSave() { try { localStorage.removeItem(SAVE_KEY); } catch (e) {} }
  tr(pair) { return pair[this.app.lang === 'en' ? 1 : 0]; }
  // ================================================================== rendering
  render(dt) {
    const R = this.R, W = this.world, P = this.player, Q = this.app.S;
    const env = this.env.build(Q.viewDist); R.setEnv(env); R.time = this.t;
    // camera
    const eye = P.eye(); const tiredK = Math.max(0, 1 - P.stam / 25), pant = Math.sin(this.t * 4.6) * 0.012 * tiredK; const bobY = Math.sin(P.bob * 2) * 0.045 * P.bobAmp * (1 + tiredK * 0.6) + pant, bobX = Math.cos(P.bob) * 0.03 * P.bobAmp * (1 + tiredK * 0.8);
    const sh = this.shake * (Q.shake ? 1 : 0), shx = (Math.random() - 0.5) * sh * 0.08, shy = (Math.random() - 0.5) * sh * 0.08;
    const r = P.right(); const cam = [eye[0] + r[0] * bobX + shx, eye[1] + bobY - P.land + shy, eye[2] + r[2] * bobX];
    if (P.dead) { cam[1] = P.pos[1] + 0.35; }
    const d = P.lookDir(), fov = (Q.fov * Math.PI / 180) * (1 - this.aim * 0.28) * (P.sprinting ? 1.04 : 1);
    R.camera(cam, [cam[0] + d[0], cam[1] + d[1], cam[2] + d[2]], fov, [0, 1, 0], 0.1, Q.viewDist + 200);
    // lights: fires, torch, deployables
    const lights = [];
    if (this.flash && this.flash.t > 0) { this.flash.t -= dt; lights.push({ p: this.flash.p, c: [1, 0.75, 0.4], r: 4, d2: 0 }); }
    const it = this.inv.activeItem(); if (it && ITEMS[it.id].light && !P.dead) lights.push({ p: [cam[0] + r[0] * 0.3 + d[0] * 0.5, cam[1] - 0.1, cam[2] + r[2] * 0.3 + d[2] * 0.5], c: [1, 0.62, 0.3], r: 2.2 + Math.sin(this.t * 17) * 0.08 });
    for (const dp of W.deploys.values()) if (dp.lit) lights.push({ p: [dp.x, dp.y + 0.8, dp.z], c: [1, 0.55, 0.22], r: 2.6 + Math.sin(this.t * 13 + dp.x) * 0.15 + Math.sin(this.t * 31) * 0.1, d2: (dp.x - cam[0]) ** 2 + (dp.z - cam[2]) ** 2 });
    for (const rp of this.remote.values()) if (rp.light && !rp.dead) lights.push({ p: [rp.pos[0], rp.pos[1] + 1.6, rp.pos[2]], c: [1, 0.6, 0.3], r: 2, d2: (rp.pos[0] - cam[0]) ** 2 + (rp.pos[2] - cam[2]) ** 2 });
    lights.sort((a, b) => (a.d2 || 0) - (b.d2 || 0)); const lk = clamp(1 - env.sunDir[1] * 2.2, 0.28, 1); R.setLights(lights.slice(0, 6).map(L => ({ p: L.p, c: L.c, r: L.r * lk })));
    // fire particles
    for (const dp of W.deploys.values()) if (dp.lit && Math.hypot(dp.x - cam[0], dp.z - cam[2]) < 80) { const top = dp.kind === 'furnace' ? 2.0 : 0.3; this.particles.emit({ p: [dp.x + (Math.random() - 0.5) * 0.3, dp.y + top, dp.z + (Math.random() - 0.5) * 0.3], v: [(Math.random() - 0.5) * 0.4, 1.2 + Math.random(), (Math.random() - 0.5) * 0.4], life: 0.6, s0: 0.25, s1: 0.05, c0: [1, 0.6, 0.2], c1: [0.9, 0.2, 0.05], a: 0.9 }, dt * 40); this.particles.emit({ p: [dp.x, dp.y + top + 0.6, dp.z], v: [(Math.random() - 0.5) * 0.3 + env.wind * 0.5, 1, (Math.random() - 0.5) * 0.3], life: 2.5, s0: 0.3, s1: 1.4, c0: [0.25, 0.24, 0.23], a: 0.22, drag: 0.3, blend: 'alpha' }, dt * 6); }
    if (it && ITEMS[it.id].light && !P.dead) { const tp = [cam[0] + r[0] * 0.28 + d[0] * 0.55, cam[1] + 0.12, cam[2] + r[2] * 0.28 + d[2] * 0.55]; }
    if (Q.shadows > 0) this.drawShadows(cam, env); else R.noShadow();
    R.begin();
    this.drawTerrain(cam, env);
    for (const pg of this.poiGpu) if (dist2(pg.p, cam) < (Q.viewDist + 60) ** 2) R.draw(pg.m, pg.M, { detail: 0.6 });
    this.drawBuildings(); this.drawDeploys(cam); this.drawDrops(cam); this.drawAnimals(cam); this.drawRemote(cam); this.drawFalling(); this.drawDebris(); this.drawProjectiles();
    this.drawPreview();
    R.water(WATER, Math.max(900, Q.viewDist * 1.5));
    const [pa, pb] = this.particles.build(); R.particles(pb, 'alpha'); R.particles(pa, 'add');
    R.rain(env.rain * (P.headUnder ? 0 : 1) * (this.isSheltered() ? 0.25 : 1), [env.wind * 3, 0, env.wind * 1.4]);
    if (!P.dead) this.drawViewModel(dt, fov, cam, d, r);
    R.end();
  }
  drawTerrain(cam, env) {
    const R = this.R, W = this.world, Q = this.app.S, VD = Q.viewDist, planes = frustum(R.vp), I4 = IDENT;
    const ci0 = Math.max(0, Math.floor((cam[0] + HALF - VD) / CH)), ci1 = Math.min(NCH - 1, Math.floor((cam[0] + HALF + VD) / CH));
    const cj0 = Math.max(0, Math.floor((cam[2] + HALF - VD) / CH)), cj1 = Math.min(NCH - 1, Math.floor((cam[2] + HALF + VD) / CH));
    let builds = 0; const budget = this._firstFrame ? 3 : 999; this._firstFrame = true; const batch = new Map();
    for (let i = ci0; i <= ci1; i++) for (let j = cj0; j <= cj1; j++) {
      const cx = i * CH - HALF + CH / 2, cz = j * CH - HALF + CH / 2, dd = Math.hypot(cx - cam[0], cz - cam[2]);
      if (dd > VD + CH) continue;
      const ch = W.chunks.get(i * 100 + j) || (W.chunks.set(i * 100 + j, { i, j }), W.chunks.get(i * 100 + j));
      if (!sphereVisible(planes, [cx, W.height(cx, cz) + 20, cz], CH * 0.9 + 40)) continue;
      const lod = dd > 220 ? 1 : 0;
      if (ch.lod !== lod || !ch.t) { if (builds++ > budget && ch.t) { } else { if (ch.t) R.free(ch.t); ch.t = R.upload(W.buildTerrain(i, j, lod)); ch.lod = lod; } }
      R.draw(ch.t, I4, { detail: 1 });
      // props: instanced, three LOD rings (full detail near, one step lighter mid, silhouette far)
      const propD = Math.min(VD, Q.propDist);
      if (dd < propD + CH * 0.7) {
        const lod = dd < 70 ? 0 : dd < 130 ? 2 : 1;
        if (!ch.inst || ch.propsDirty || ch.instLod !== lod) { ch.inst = W.buildInstances(i, j, lod); ch.propsDirty = false; ch.instLod = lod; }
        for (const [k, a] of ch.inst) { let L = batch.get(k); if (!L) batch.set(k, L = []); L.push(a); }
      } else if (ch.inst && dd > propD + CH * 1.5) ch.inst = null;
      if (Q.grass > 0 && dd < 90) { if (!ch.g) ch.g = R.upload(W.buildGrass(i, j)) || { n: 0 }; if (ch.g.n) R.draw(ch.g, I4); }
      else if (ch.g && dd > 130) { R.free(ch.g); ch.g = null; }
    }
    // one instanced draw per model
    for (const [k, arrs] of batch) {
      let g = this.propGpu.get(k); if (!g) { g = this.R.upload(W.modelFor(k)) || { n: 0 }; this.propGpu.set(k, g); }
      let n = 0; for (const a of arrs) n += a.length; if (!this._ib || this._ib.length < n) this._ib = new Float32Array(Math.max(n, 4096) * 1.5 | 0);
      let o = 0; for (const a of arrs) { this._ib.set(a, o); o += a.length; }
      this.R.drawInstanced(g, this._ib, n / 5);
    }
  }
  drawShadows(cam, env) {
    const R = this.R, W = this.world, Q = this.app.S, rad = Q.shadows >= 2048 ? 75 : 55;
    const light = env.sun, day = env.sunDir[1] > 0.02, k = day ? clamp(env.sunDir[1] * 4, 0.35, 0.92) * (1 - env.cloudDark * 0.6) : 0.35 * env.stars;
    if (k < 0.05 || light[1] < 0.06) { R.noShadow(); return; }
    const c = [cam[0] + this.player.lookDir()[0] * rad * 0.45, cam[1], cam[2] + this.player.lookDir()[2] * rad * 0.45];
    R.beginShadow(c, light, rad, Q.shadows, k);
    for (const ch of W.chunks.values()) { if (!ch.t) continue; const cx = ch.i * CH - HALF + CH / 2, cz = ch.j * CH - HALF + CH / 2; if (Math.abs(cx - c[0]) > rad + CH || Math.abs(cz - c[2]) > rad + CH) continue; R.drawShadow(ch.t, IDENT); if (ch.p) R.drawShadow(ch.p, IDENT); }
    for (const m of this.meshes.buildings.values()) R.drawShadow(m, IDENT);
    for (const pg of this.poiGpu) if (dist2(pg.p, c) < (rad + 40) ** 2) R.drawShadow(pg.m, pg.M);
    for (const d of W.deploys.values()) if (dist2([d.x, d.y, d.z], c) < rad * rad) R.drawShadow(this.depMesh(d.item), trs([d.x, d.y, d.z], d.ry));
    for (const a of this.animalList()) { if (dist2([a.x, a.y, a.z], c) > rad * rad) continue; const G = this.animalGpu[a.type]; R.drawShadow(G.body, trs([a.x, a.y + (a.state === 'dead' ? G.def.h * 0.25 : G.def.legL + G.def.h * 0.16), a.z], -a.yaw, 1, 0, a.state === 'dead' ? 1.5 : 0)); }
    for (const rp of this.remote.values()) if (dist2(rp.pos, c) < rad * rad) this.drawHuman(rp, true);
    for (const f of this.falling) R.drawShadow(f.model, f.M || IDENT);
    R.endShadow();
  }
  drawBuildings() {
    const R = this.R, W = this.world;
    for (const bid of W.dirtyBuildings) { const old = this.meshes.buildings.get(bid); if (old) R.free(old); const m = W.buildingMesh(bid); if (m) this.meshes.buildings.set(bid, R.upload(m)); else this.meshes.buildings.delete(bid); }
    W.dirtyBuildings.clear();
    for (const m of this.meshes.buildings.values()) R.draw(m, IDENT, { detail: 0.8 });
  }
  depMesh(item) { const k = 'g:' + item; if (!this.vm.has(k)) this.vm.set(k, this.R.upload(this.world.modelCache.get('dep:' + item) || deployable(ITEMS[item].deploy.kind, ITEMS[item].deploy))); return this.vm.get(k); }
  drawDeploys(cam) {
    const R = this.R;
    for (const d of this.world.deploys.values()) {
      if (dist2([d.x, d.y, d.z], cam) > 200 * 200) continue;
      let M = trs([d.x, d.y, d.z], d.ry);
      if (d.kind === 'door') { const hinge = [-0.53, 0, 0], a = d.open ? -1.45 : 0; M = mul(M, mul(trs(hinge, 0), mul(trs([0, 0, 0], a), trs([0.53, 0, 0], 0)))); }
      R.draw(this.depMesh(d.item), M, { emit: d.lit && d.kind === 'campfire' ? 0.05 : 0 });
    }
  }
  drawDrops(cam) { const R = this.R; for (const dr of this.world.drops.values()) { if (dr.until && dr.until < this.now) { this.world.drops.delete(dr.id); continue; } if (dist2([dr.x, dr.y, dr.z], cam) > 120 * 120) continue; R.draw(dr.bag ? this.bagGpu : this.dropGpu, trs([dr.x, dr.y + (dr.bag ? 0 : 0.12 + Math.sin(this.t * 2 + dr.x) * 0.03), dr.z], dr.ry + (dr.bag ? 0 : this.t * 0.6), dr.bag ? 0.8 : 1)); } }
  drawAnimals(cam) {
    const R = this.R;
    for (const a of this.animalList()) {
      if (a.gone || dist2([a.x, a.y, a.z], cam) > 220 * 220) continue;
      const G = this.animalGpu[a.type], A = G.def, dead = a.state === 'dead';
      const n = this.world.T.normal(a.x, a.z), pitch = dead ? 0 : Math.atan2(n[0] * Math.sin(a.yaw) - n[2] * Math.cos(a.yaw), n[1]) * 0.6;
      const roll = dead ? 1.5 : 0;
      const base = trs([a.x, a.y + (dead ? A.h * 0.25 : A.legL + A.h * 0.16), a.z], -a.yaw, 1, pitch, roll);
      const ph = a.phase || 0, gait = Math.min(1, (a.spd || 0) / A.walk) * (dead ? 0 : 1), run = (a.spd || 0) > A.walk * 1.5;
      const bounce = Math.abs(Math.sin(ph)) * 0.05 * gait * (run ? 2 : 1);
      const body = mul(base, trs([0, bounce, 0], 0, 1, run ? Math.sin(ph * 2) * 0.05 : 0));
      R.draw(G.body, body);
      const headM = mul(body, trs([0, A.neck * 0.65, -A.len * 0.45 - A.neck * 0.55], 0, 1, (a.bite ? -0.5 : 0) + (a.state === 'idle' && !dead ? 0.7 + Math.sin(this.t * 0.7 + a.x) * 0.2 : 0) + Math.sin(ph * 2) * 0.05 * gait));
      R.draw(G.head, headM);
      const legs = [[-1, -1, 0], [1, -1, Math.PI], [-1, 1, Math.PI], [1, 1, 0]];
      for (const [sx, sz, off] of legs) {
        const sw = Math.sin(ph + off) * 0.55 * gait * (run ? 1.3 : 1), knee = Math.max(0, -Math.cos(ph + off)) * 0.8 * gait;
        const hip = mul(body, trs([sx * A.len * 0.18, -A.h * 0.1, sz * A.len * 0.38], 0, 1, sw));
        R.draw(G.legU, hip); R.draw(G.legL, mul(hip, trs([0, -A.legL * 0.5, 0.02], 0, 1, sz < 0 ? knee : -knee)));
      }
      R.draw(G.tail, mul(body, trs([0, 0.05, A.len * 0.55], 0, 1, Math.sin(this.t * 3 + a.x) * 0.2 - 0.2)));
    }
  }
  humanGpuFor(r) {
    const tints = ['#4a4f45', '#3d4a5c', '#5c4a3a', '#2f3b33', '#5a3a3a', '#4b4458', '#6b5e45', '#36454f'];
    let h = 0; for (const ch of String(r.id)) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
    const key = BL.ready ? h % (this.app && this.app.input && this.app.input.isTouch() ? 4 : 8) : h % 64; let g = this.humanCache.get(key); if (g) return g;
    const H = humanParts(hex(tints[h % tints.length]), key + 1); g = {}; for (const k in H) g[k] = this.R.upload(H[k]); this.humanCache.set(key, g); return g;
  }
  /** skeletal animation for other players: walk/run cycle, crouch, attack swing, idle breathing, death fall, look pitch */
  drawHuman(r, shadow) {
    if (this.blv !== BL.ver) { this.blv = BL.ver; this.humanCache && this.humanCache.clear(); this.vm && this.vm.clear(); }
    const R = this.R, G = this.humanGpuFor(r), D = shadow ? (m, M) => R.drawShadow(m, M) : (m, M) => R.draw(m, M);
    const sp = r.spd || 0, g = Math.min(1, sp / 4.6), run = Math.min(1, Math.max(0, (sp - 4) / 3)), ph = r.phase || 0, cr = r.crouch ? 1 : 0;
    r.swingT = r.swing ? (r.swingT || 0) + 0.016 : 0; r.cr = (r.cr || 0) + (cr - (r.cr || 0)) * 0.15; r.dk = (r.dk || 0) + ((r.dead ? 1 : 0) - (r.dk || 0)) * 0.08;
    r.tk = (r.tk || 0) + ((r.tired ? 1 : 0) - (r.tk || 0)) * 0.05; const tk = r.tk, idleT = tk * (1 - g);   // exhausted: hunched, heavy breathing, hands on knees when stopped
    const c = r.cr, breathe = Math.sin(this.t * (1.7 + tk * 3.2) + (r.id.length)) * (0.012 + tk * 0.03) * (1 - g * 0.6), bob = Math.abs(Math.sin(ph)) * (0.03 + run * 0.04 + tk * 0.025) * g;
    const RG = BL.rig, hipY = (RG ? RG.root[1] : 0.95) - c * 0.36 + bob - r.dk * 0.75 - idleT * 0.1;
    const root = trs([r.pos[0], r.pos[1] + hipY, r.pos[2]], -r.yaw, 1, 0, r.dk * 1.5);
    D(G.pelvis, root);
    const lean = 0.06 * g + 0.14 * run + c * 0.32 - (r.swingT > 0 ? 0.1 : 0) + tk * (0.18 * g + idleT * 0.55);
    const torso = mul(root, trs([0, 0.08, 0], Math.sin(ph) * 0.08 * g, 1 + breathe, lean));
    D(G.torso, torso);
    D(G.head, mul(torso, trs(RG ? RG.neck : [0, BL.ready ? 0.505 : 0.56, 0], 0, 1, Math.max(-0.7, Math.min(0.7, -(r.pitch || 0) * 0.7)) - lean * 0.6)));
    for (const sd of [-1, 1]) {
      const legSw = Math.sin(ph + (sd > 0 ? 0 : Math.PI)) * (0.45 + run * 0.35) * g, knee = Math.max(0, Math.sin(ph + (sd > 0 ? 0 : Math.PI) - 1.2)) * (0.7 + run * 0.6) * g;
      const thigh = mul(root, trs(RG ? [sd * RG.hip[0], RG.hip[1], RG.hip[2]] : [sd * 0.1, -0.02, 0], 0, 1, legSw + c * 1.25 - lean * 0.3 + idleT * 0.35, sd * 0.03));
      const L_ = sd < 0 && G.legU_l; D(L_ ? G.legU_l : G.legU, thigh); D(L_ ? G.legL_l : G.legL, mul(thigh, trs(RG ? [sd * RG.knee[0], RG.knee[1], RG.knee[2]] : [0, -0.44, 0.012], 0, 1, -(knee + c * 2.1 + idleT * 0.45))));
      const armSw = -Math.sin(ph + (sd > 0 ? 0 : Math.PI)) * (0.4 + run * 0.35) * g, attack = sd > 0 && r.swingT > 0 ? Math.sin(Math.min(1, (r.swingT % 0.7) / 0.7) * Math.PI * 2) : 0;
      const up = sd > 0 && r.item ? 0.5 : 0, rx = armSw * (1 - tk * 0.4) + up * (1 - idleT) + (attack > 0 ? attack * 2.2 : attack * 0.6) + breathe * 3 + idleT * 0.75;
      const sh = mul(torso, trs(RG ? [sd * RG.sh[0], RG.sh[1], RG.sh[2]] : [sd * 0.2, 0.38, 0], 0, 1, rx, sd * (0.08 + c * 0.05)));
      D(sd < 0 && G.armU_l ? G.armU_l : G.armU, sh); const fore = mul(sh, trs(RG ? [sd * RG.el[0], RG.el[1], RG.el[2]] : [0, -0.31, 0.01], 0, 1, 0.25 + g * 0.35 + run * 0.5 + (sd > 0 && r.item ? 0.6 : 0)));
      D(sd < 0 && G.armL_l ? G.armL_l : G.armL, fore);
      if (sd > 0 && r.item && ITEMS[r.item]) { const mdl = ITEMS[r.item].model; if (mdl) { const k = 'held:' + mdl; if (!this.vm.has(k)) this.vm.set(k, R.upload(viewModel(mdl, true))); D(this.vm.get(k), mul(fore, trs(RG ? gripPt(RG, sd) : [0, -0.33, -0.01], 0, 1.05, -1.45))); } }
    }
  }
  drawRemote(cam) { for (const rp of this.remote.values()) if (dist2(rp.pos, cam) < 300 * 300) this.drawHuman(rp, false); }
  drawFalling() { for (const f of this.falling) { const k = Math.min(1, f.t / 1.8), a = k * k * 1.5, sink = Math.max(0, f.t - 2.2) * 1.5; const M = mul(trs([f.n.x, f.n.y - 0.15 - sink, f.n.z], -f.ang), trs([0, 0, 0], 0, f.n.s, -a)); f.M = M; this.R.draw(f.model, M); } }
  drawProjectiles() { for (const pr of this.projectiles) { const v = pr.v, yaw = Math.atan2(v[0], -v[2]), pitch = Math.atan2(v[1], Math.hypot(v[0], v[2])); this.R.draw(this.arrowGpu, trs(pr.p, -yaw, 1, pitch)); } }
  drawPreview() {
    const c = this.cand; if (!c || this.app.ui.modalOpen()) return;
    const R = this.R, tint = c.ok ? [0.35, 0.85, 0.45, 0.7] : [0.95, 0.25, 0.2, 0.7];
    let key, mb;
    if (c.piece) { key = 'pv:' + c.piece; if (!this.vm.has(key)) this.vm.set(key, R.upload(piece(c.piece, 0, 3))); }
    else { key = 'g:' + c.item; this.depMesh(c.item); }
    R.drawBlend(this.vm.get(key), trs(c.p, c.ry), { tint, alpha: 0.45 + Math.sin(this.t * 6) * 0.08 });
  }
  drawViewModel(dt, fov, cam, d, r) {
    const R = this.R, it = this.inv.activeItem(), I = it && ITEMS[it.id], P = this.player, H = this.held;
    const model = I ? (I.model || (I.deploy ? 'hands' : 'hands')) : 'hands';
    if (this.blv !== BL.ver) { this.blv = BL.ver; this.humanCache.clear(); this.vm.clear(); }
    if (!this.vm.has('vm:' + model)) this.vm.set('vm:' + model, R.upload(viewModel(model)));
    // hand-space → world: right r, up u, forward d
    const u = norm([r[1] * d[2] - r[2] * d[1], r[2] * d[0] - r[0] * d[2], r[0] * d[1] - r[1] * d[0]]);
    const sway = P.bobAmp, bx = Math.cos(P.bob) * 0.012 * sway, by = Math.abs(Math.sin(P.bob)) * 0.014 * sway;
    let ox = 0.27 - this.aim * 0.27, oy = -0.25 + this.aim * 0.1, oz = -0.5, rx = 0, ry = 0, rz = 0;
    if (I && I.ranged) { ox = 0.16 - this.aim * 0.16; oy = -0.15 + this.aim * 0.05; if (I.ranged.draw > 0) { ry = 0; rz = -0.25 + this.aim * 0.25; oz = -0.48 + H.draw * 0.05; } }
    if (I && I.ranged && I.ranged.gun) { const two = I.ranged.gun !== 'pistol'; ox = (two ? 0.14 : 0.18) - this.aim * (two ? 0.14 : 0.18); oy = -0.16 + this.aim * (two ? 0.075 : 0.09); oz = -0.36; rx = 0; rz = 0; ry = 0; H.kick = Math.max(0, (H.kick || 0) - dt * 9); oz += H.kick * 0.06; rx += H.kick * 0.18; }
    if (I && (I.model === 'spear_w' || I.model === 'spear_s')) { rx = -1.2; oy = -0.12; oz = -0.3; }
    // swing animation: wind up then strike
    if (I && I.melee && H.swing > 0) { const k = 1 - H.swing / I.melee.rate, s = k < 0.5 ? k / 0.5 : 1 - (k - 0.5) / 0.5, strike = k < 0.55 ? -Math.sin(k / 0.55 * Math.PI * 0.5) * 0.5 : Math.sin((k - 0.55) / 0.45 * Math.PI) * 1.4;
      if (I.model === 'spear_w' || I.model === 'spear_s') { oz += -Math.sin(k * Math.PI) * 0.35; } else { rx += strike * 0.9 - s * 0.3; ry += s * 0.3; ox -= s * 0.08; } }
    if (H.equipT > 0) oy -= H.equipT * 0.8;
    if (H.reload > 0) { rx += 0.6; oy -= 0.1; }
    if (P.sprinting) { ry += 0.5; rx += -0.25; ox -= 0.03; }
    oy += by + P.land * 0.5; ox += bx;
    const p = [cam[0] + r[0] * ox + u[0] * oy + d[0] * -oz, cam[1] + r[1] * ox + u[1] * oy + d[1] * -oz, cam[2] + r[2] * ox + u[2] * oy + d[2] * -oz];
    const B = new Float32Array([r[0], r[1], r[2], 0, u[0], u[1], u[2], 0, -d[0], -d[1], -d[2], 0, p[0], p[1], p[2], 1]);
    const M = mul(B, trs([0, 0, 0], ry, 0.82, rx, rz));
    R.beginViewModel(Math.min(fov, 1.2));
    R.draw(this.vm.get('vm:' + model), M);
    if (I && I.ranged && !I.ranged.gun && ((it.ammo || 0) > 0 || H.draw > 0)) R.draw(this.arrowGpu, mul(M, trs([0, 0.02, -0.1 + H.draw * 0.18], 0, 1, 0)));
    R.endViewModel();
    if (I && I.light) { const tp = [M[12] + M[4] * 0.33, M[13] + M[5] * 0.33, M[14] + M[6] * 0.33]; this.particles.emit({ p: tp, v: [(Math.random() - 0.5) * 0.2, 0.5, (Math.random() - 0.5) * 0.2], life: 0.25, s0: 0.03, s1: 0.01, c0: [1, 0.7, 0.3], a: 0.8 }, dt * 30); }
  }
  dispose() { const R = this.R; for (const ch of this.world.chunks.values()) { R.free(ch.t); R.free(ch.g); } for (const m of this.propGpu.values()) R.free(m); for (const m of this.meshes.buildings.values()) R.free(m); for (const m of this.vm.values()) R.free(m); for (const p of this.poiGpu || []) R.free(p.m); this.particles.clear(); }
}

export const OBJECTIVES = [
  { t: ['اجمع 200 خشب', 'Gather 200 wood'], h: ['اضرب الأشجار بالحجر (كليك يسار)', 'Hit trees with your rock (left click)'] },
  { t: ['اجمع 100 حجر', 'Gather 100 stone'], h: ['اضرب الصخور الرمادية', 'Hit the grey rocks'] },
  { t: ['اصنع فأس أو معول حجري', 'Craft a stone hatchet or pickaxe'], h: ['افتح الصناعة (Q) واختر فأس حجري', 'Open crafting (Q) and pick Stone Hatchet'] },
  { t: ['اصنع مخطط بناء', 'Craft a Building Plan'], h: ['الصناعة ← أدوات ← مخطط بناء', 'Crafting → Tools → Building Plan'] },
  { t: ['حط أساس', 'Place a foundation'], h: ['امسك المخطط، كليك يمين ← أساس، كليك يسار للوضع', 'Hold the plan, right-click → Foundation, left-click to place'] },
  { t: ['ابنِ 3 جدران وفتحة باب', 'Build 3 walls and a doorway'], h: ['صوّب على حافة الأساس واختر جدار / فتحة باب', 'Aim at the foundation edge and pick Wall / Doorway'] },
  { t: ['ركّب باب', 'Fit a door'], h: ['اصنع باب خشبي وصوّب على فتحة الباب', 'Craft a Wooden Door and aim at the doorway'] },
  { t: ['ولّع نار مخيم', 'Place a campfire'], h: ['النار تدفّيك وتطبخ اللحم', 'Fire keeps you warm and cooks meat'] },
  { t: ['حط كيس نوم داخل القاعدة', 'Put a sleeping bag inside'], h: ['ترجع له لما تموت', 'You respawn there when you die'] }
];
export const ANIMAL_NAMES = { deer: ['غزال', 'Deer'], boar: ['خنزير بري', 'Boar'], wolf: ['ذيب', 'Wolf'], bear: ['دب', 'Bear'] };
const PICK_NAMES = { hemp: ['قنب', 'Hemp'], berry: ['توت', 'Berries'], stump: ['حطب', 'Firewood'], stones: ['حجارة', 'Stones'] };
const IDENT = (() => { const m = new Float32Array(16); m[0] = m[5] = m[10] = m[15] = 1; return m; })();
const dist2 = (a, b) => (a[0] - b[0]) ** 2 + (a[2] - b[2]) ** 2;
function addTo(inv, id, n) { for (const s of inv) if (s && s.id === id && s.n < ITEMS[id].stack) { s.n += n; return; } const i = inv.indexOf(null); if (i >= 0) inv[i] = makeItem(id, n); }
function padTo(items, n) { const a = items.slice(); while (a.length < n) a.push(null); return a; }
function frustum(m) { const p = [], r = (a, b, c, d) => { const l = Math.hypot(a, b, c); p.push([a / l, b / l, c / l, d / l]); }; r(m[3] + m[0], m[7] + m[4], m[11] + m[8], m[15] + m[12]); r(m[3] - m[0], m[7] - m[4], m[11] - m[8], m[15] - m[12]); r(m[3] + m[1], m[7] + m[5], m[11] + m[9], m[15] + m[13]); r(m[3] - m[1], m[7] - m[5], m[11] - m[9], m[15] - m[13]); r(m[3] + m[2], m[7] + m[6], m[11] + m[10], m[15] + m[14]); return p; }
function sphereVisible(P, c, rad) { for (const p of P) if (p[0] * c[0] + p[1] * c[1] + p[2] * c[2] + p[3] < -rad) return false; return true; }
function dropMesh() { const m = new (piece('pillar', 0).constructor)(); m.box(0, 0.12, 0, 0.36, 0.24, 0.28, hex('#6b5a3e')); m.box(0, 0.25, 0, 0.38, 0.04, 0.3, hex('#4a3d2a')); m.box(0, 0.17, 0.145, 0.12, 0.08, 0.02, hex('#ff5a1f'), 0.5); return m; }
