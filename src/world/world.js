// ARVEX SURVIVAL — client world: terrain chunks (LOD), merged prop batches, grass, collision hash,
// raycasting, resource nodes, POIs, structures, deployables, ground drops.
import { Terrain, layoutWorld, SIZE, HALF, CELL, GRID, WATER, HMIN, HMAX, NODE_TYPES, RESPAWN } from './terrain.js';
import { MeshBuilder } from '../gfx/mesh.js';
import { tree, rock, plant, crate, barrel, poi, piece, deployable, grassBlade, CELL_S, WALL_H, PAL, DETAIL } from '../gfx/models.js';
import { trs, rng, mixc, hex, clamp } from '../core/math.js';
import { ITEMS, PIECES } from '../game/items.js';

export const CH = 64, NCH = SIZE / CH;
const COLS = {
  sand: hex('#b9a77f'), sandW: hex('#8f7f5d'), grass: hex('#5a7434'), grassD: hex('#46602a'), grassY: hex('#7e8a3e'), forest: hex('#3b4a26'), forestD: hex('#2e3a1f'),
  dirt: hex('#5d4a35'), rock: hex('#6f6a62'), rockD: hex('#4f4b45'), snow: hex('#e6e8ea'), under: hex('#5b5a45'), deep: hex('#2c3a35')
};

export class World {
  constructor(seed) {
    this.seed = seed; this.T = new Terrain(seed); this.ready = false;
    this.chunks = new Map(); this.hash = new Map(); this.HC = 8;
    this.structures = new Map(); this.buildings = new Map(); this.deploys = new Map(); this.drops = new Map();
    this.nodeById = []; this.listeners = []; this.uid = 1;
    this.modelCache = new Map(); this.quality = 1; this.viewDist = 520;
    this.dirtyBuildings = new Set();
  }
  *load() {
    for (const p of this.T.generateSteps()) yield p * 0.7;
    const L = layoutWorld(this.T); this.nodes = L.nodes; this.pois = L.pois; this.spawns = L.spawns;
    for (const n of this.nodes) { const t = NODE_TYPES[n.type]; n.hp = t.hp; n.alive = true; n.respawn = 0; n.kind = t.kind; n.cx = Math.floor((n.x + HALF) / CH); n.cz = Math.floor((n.z + HALF) / CH); }
    yield 0.75;
    this.poiMeshes = this.pois.map(p => { const g = poi(p.kind, p.seed); const M = trs([p.x, p.y, p.z], p.rot); for (const b of g.boxes) this.addBoxCollider(rotPt(b.c, p.rot, p), b.h, b.ry + p.rot, { poi: p.id }); return { p, mb: g.mb, M }; });
    for (const n of this.nodes) this.addNodeCollider(n);
    yield 0.85;
    this.waterTex = this.T.downsample(512);
    this.ready = true; yield 1;
  }
  height(x, z) { return this.T.height(x, z); }
  // ------------------------------------------------------------------ collision hash
  hkey(x, z) { return (Math.floor(x / this.HC) + 1000) * 4000 + Math.floor(z / this.HC) + 1000; }
  hashAdd(c, x0, z0, x1, z1) { c.keys = []; for (let x = Math.floor(x0 / this.HC); x <= Math.floor(x1 / this.HC); x++) for (let z = Math.floor(z0 / this.HC); z <= Math.floor(z1 / this.HC); z++) { const k = (x + 1000) * 4000 + z + 1000; let L = this.hash.get(k); if (!L) this.hash.set(k, L = []); L.push(c); c.keys.push(k); } return c; }
  hashRemove(c) { if (!c || !c.keys) return; for (const k of c.keys) { const L = this.hash.get(k); if (L) { const i = L.indexOf(c); if (i >= 0) L.splice(i, 1); } } c.keys = null; }
  addCircle(x, z, r, y0, y1, ref) { return this.hashAdd({ t: 'c', x, z, r, y0, y1, ref }, x - r, z - r, x + r, z + r); }
  addBoxCollider(c, h, ry, ref, walk) { const e = Math.hypot(h[0], h[2]); return this.hashAdd({ t: 'b', c, h, ry, cs: Math.cos(ry), sn: Math.sin(ry), ref, walk }, c[0] - e, c[2] - e, c[0] + e, c[2] + e); }
  near(x, z, r, fn) { const seen = new Set(); for (let gx = Math.floor((x - r) / this.HC); gx <= Math.floor((x + r) / this.HC); gx++) for (let gz = Math.floor((z - r) / this.HC); gz <= Math.floor((z + r) / this.HC); gz++) { const L = this.hash.get((gx + 1000) * 4000 + gz + 1000); if (L) for (const c of L) if (!seen.has(c)) { seen.add(c); fn(c); } } }
  addNodeCollider(n) {
    const t = NODE_TYPES[n.type]; if (!n.alive || !t.r) return;
    if (t.kind === 'tree') n.col = this.addCircle(n.x, n.z, t.r * n.s, n.y - 1, n.y + 14, { node: n.id });
    else if (t.kind === 'rock' || t.kind === 'deco') n.col = this.addCircle(n.x, n.z, (n.type === 'boulder' ? 3.2 : 1.15) * n.s, n.y - 1, n.y + (n.type === 'boulder' ? 3.5 : 1.4) * n.s, { node: n.id });
    else if (t.kind === 'loot' || t.kind === 'barrel') n.col = this.addCircle(n.x, n.z, t.r, n.y - 0.5, n.y + 1, { node: n.id });
  }
  /** ground height under (x,z) for a body whose feet are at y (walkable platforms within step height) */
  ground(x, z, y, step = 0.55) {
    let g = this.T.height(x, z);
    this.near(x, z, 0.5, c => {
      if (c.t !== 'b' || !c.walk) return;
      const dx = x - c.c[0], dz = z - c.c[2], lx = dx * c.cs - dz * c.sn, lz = dx * c.sn + dz * c.cs;
      if (Math.abs(lx) > c.h[0] + 0.05 || Math.abs(lz) > c.h[2] + 0.05) return;
      let top = c.c[1] + c.h[1];
      if (c.walk === 'stairs') top = c.c[1] - c.h[1] + clamp((c.h[2] - lz) / (2 * c.h[2]), 0, 1) * c.h[1] * 2;
      if (top <= y + step && top > g) g = top;
    });
    return g;
  }
  /** push a vertical capsule (radius r, from y to y+h) out of colliders; returns corrected [x,z] */
  collide(x, z, y, h, r) {
    for (let it = 0; it < 3; it++) {
      let moved = false;
      this.near(x, z, r + 1, c => {
        if (c.off) return;
        if (c.t === 'c') {
          if (y + h < c.y0 || y > c.y1) return;
          const dx = x - c.x, dz = z - c.z, d = Math.hypot(dx, dz), m = c.r + r;
          if (d < m && d > 1e-5) { x = c.x + dx / d * m; z = c.z + dz / d * m; moved = true; }
        } else {
          const top = c.c[1] + c.h[1], bot = c.c[1] - c.h[1];
          if (y + h < bot || y >= top - 0.6) return; // can step onto things lower than 0.6m above feet
          const dx = x - c.c[0], dz = z - c.c[2]; let lx = dx * c.cs - dz * c.sn, lz = dx * c.sn + dz * c.cs;
          const ex = c.h[0] + r, ez = c.h[2] + r;
          if (Math.abs(lx) < ex && Math.abs(lz) < ez) {
            const px = ex - Math.abs(lx), pz = ez - Math.abs(lz);
            if (px < pz) lx = Math.sign(lx || 1) * ex; else lz = Math.sign(lz || 1) * ez;
            x = c.c[0] + lx * c.cs + lz * c.sn; z = c.c[2] - lx * c.sn + lz * c.cs; moved = true;
          }
        }
      });
      if (!moved) break;
    }
    return [x, z];
  }
  /** ceiling: lowest box bottom above head within a column */
  ceiling(x, z, y, h) { let ce = 1e9; this.near(x, z, 0.4, c => { if (c.t !== 'b' || c.off) return; const dx = x - c.c[0], dz = z - c.c[2], lx = dx * c.cs - dz * c.sn, lz = dx * c.sn + dz * c.cs; if (Math.abs(lx) > c.h[0] || Math.abs(lz) > c.h[2]) return; const bot = c.c[1] - c.h[1]; if (bot >= y + 0.6 && bot < ce) ce = bot; }); return ce; }
  // ------------------------------------------------------------------ raycast (interaction / hits)
  /** returns nearest {t, kind, ref, p} among nodes, structures, deployables, drops, terrain */
  raycast(o, d, maxD, opts = {}) {
    let best = { t: maxD, kind: null };
    const steps = Math.ceil(maxD / 0.25);
    // terrain march
    if (!opts.noTerrain) for (let i = 1; i <= steps; i++) { const t = i * maxD / steps, p = [o[0] + d[0] * t, o[1] + d[1] * t, o[2] + d[2] * t]; if (p[1] < this.T.height(p[0], p[2])) { best = { t, kind: 'terrain', p }; break; } }
    const mx = o[0] + d[0] * maxD / 2, mz = o[2] + d[2] * maxD / 2;
    this.near(mx, mz, maxD / 2 + 3, c => {
      if (c.off && !opts.all) return;
      let t = null;
      if (c.t === 'c') t = rayCyl(o, d, c.x, c.z, c.r + (opts.pad || 0), c.y0, c.y1);
      else t = rayOBB(o, d, c);
      if (t != null && t < best.t) best = { t, kind: c.ref.node != null ? 'node' : c.ref.st != null ? 'structure' : c.ref.dep != null ? 'deploy' : c.ref.poi != null ? 'poi' : 'other', ref: c.ref, col: c };
    });
    for (const dr of this.drops.values()) { const t = raySphere(o, d, [dr.x, dr.y + 0.25, dr.z], 0.45); if (t != null && t < best.t) best = { t, kind: 'drop', ref: { drop: dr.id } }; }
    for (const n of this.nearNodes(o[0], o[2], maxD + 2)) { if (!n.alive || n.kind !== 'pick') continue; const t = raySphere(o, d, [n.x, n.y + 0.4, n.z], 0.75); if (t != null && t < best.t) best = { t, kind: 'node', ref: { node: n.id } }; }
    if (best.kind) best.p = best.p || [o[0] + d[0] * best.t, o[1] + d[1] * best.t, o[2] + d[2] * best.t];
    return best;
  }
  nearNodes(x, z, r) { const out = [], cx0 = Math.floor((x - r + HALF) / CH), cx1 = Math.floor((x + r + HALF) / CH), cz0 = Math.floor((z - r + HALF) / CH), cz1 = Math.floor((z + r + HALF) / CH); for (let i = cx0; i <= cx1; i++) for (let j = cz0; j <= cz1; j++) { const c = this.chunkNodes && this.chunkNodes.get(i * 100 + j); if (c) for (const n of c) if (Math.abs(n.x - x) < r && Math.abs(n.z - z) < r) out.push(n); } return out; }
  indexNodes() { this.chunkNodes = new Map(); for (const n of this.nodes) { const k = n.cx * 100 + n.cz; if (!this.chunkNodes.has(k)) this.chunkNodes.set(k, []); this.chunkNodes.get(k).push(n); } }
  // ------------------------------------------------------------------ node state changes
  setNodeAlive(n, alive, respawnAt = 0) {
    if (n.alive === alive) return;
    n.alive = alive; n.respawn = respawnAt;
    if (!alive) { this.hashRemove(n.col); n.col = null; } else { n.hp = NODE_TYPES[n.type].hp; this.addNodeCollider(n); }
    const c = this.chunks.get(n.cx * 100 + n.cz); if (c) c.propsDirty = true;
  }
  updateRespawns(now) { if (!this._rT || now - this._rT > 5) { this._rT = now; for (const n of this.nodes) if (!n.alive && n.respawn && now >= n.respawn) this.setNodeAlive(n, true); } }
  // ------------------------------------------------------------------ meshes
  baseModel(type, variant, lod = 0) {
    const k = type + ':' + variant + ':' + lod + ':' + DETAIL.q; let m = this.modelCache.get(k); if (m) return m;
    const t = NODE_TYPES[type];
    if (t.kind === 'tree') m = tree(type, variant * 17 + 3, lod).mb; else if (t.kind === 'rock' || t.kind === 'deco') m = rock(type, variant * 29 + 5, lod).mb;
    else if (t.kind === 'pick') m = plant(type, variant * 13 + 1).mb; else if (type === 'crate') m = crate(variant); else m = barrel();
    this.modelCache.set(k, m); return m;
  }
  buildTerrain(ci, cj, lod) {
    const step = lod ? 4 : 1, n = Math.floor(CH / CELL / step) + 1, verts = n * n, skirt = 4 * n, v = new Float32Array((verts + skirt) * 10), idx = [];
    const x0 = ci * CH - HALF, z0 = cj * CH - HALF, T = this.T;
    const vcol = (x, z, h, nrm) => {
      const sl = 1 - nrm[1], m = T.moisture(x, z), nz = Math.sin(x * 0.13 + z * 0.07) * 0.5 + Math.sin(x * 0.031 - z * 0.05) * 0.5;
      let c;
      if (h < -0.5) c = mixc(COLS.under, COLS.deep, clamp(-h / 10, 0, 1));
      else if (h < 2.4) c = mixc(COLS.sandW, COLS.sand, clamp((h + 0.5) / 1.8, 0, 1));
      else { c = mixc(COLS.grass, m > 0.52 ? COLS.forest : COLS.grassY, clamp((m - 0.38) * 3, 0, 1)); c = mixc(c, m > 0.52 ? COLS.forestD : COLS.grassD, 0.5 + nz * 0.5);
        if (h < 3.6) c = mixc(COLS.sand, c, (h - 2.4) / 1.2);
        if (h > 62) c = mixc(c, COLS.rock, clamp((h - 62) / 14, 0, 1)); }
      const rockK = clamp((sl - 0.2) * 4, 0, 1); c = mixc(c, mixc(COLS.rockD, COLS.rock, 0.5 + nz * 0.4), rockK);
      if (h > 108) c = mixc(c, COLS.snow, clamp((h - 108) / 10, 0, 1) * (1 - rockK * 0.7));
      if (sl > 0.08 && sl < 0.25 && h > 3) c = mixc(c, COLS.dirt, 0.25);
      return c;
    };
    let o = 0;
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
      const x = x0 + i * CELL * step, z = z0 + j * CELL * step, h = T.height(x, z), nrm = T.normal(x, z), c = vcol(x, z, h, nrm);
      v.set([x, h, z, nrm[0], nrm[1], nrm[2], c[0], c[1], c[2], 0], o); o += 10;
    }
    for (let j = 0; j < n - 1; j++) for (let i = 0; i < n - 1; i++) { const a = j * n + i, b = a + 1, c = a + n, d = c + 1; idx.push(a, c, b, b, c, d); }
    // skirts (hide LOD cracks)
    const edge = []; for (let i = 0; i < n; i++) edge.push(i); for (let j = 1; j < n; j++) edge.push(j * n + n - 1); for (let i = n - 2; i >= 0; i--) edge.push((n - 1) * n + i); for (let j = n - 2; j > 0; j--) edge.push(j * n);
    const base = verts; edge.forEach((e, k) => { for (let q = 0; q < 10; q++) v[(base + k) * 10 + q] = v[e * 10 + q]; v[(base + k) * 10 + 1] -= 3; });
    for (let k = 0; k < edge.length; k++) { const a = edge[k], b = edge[(k + 1) % edge.length], c2 = base + k, d = base + (k + 1) % edge.length; idx.push(a, b, c2, b, d, c2); }
    return { v: v.subarray(0, (base + edge.length) * 10), i: new Uint16Array(idx) };
  }
  /** model key for a node at a given LOD (0 full · 2 one step lighter · 1 far) */
  propKey(n, lod) { const t = NODE_TYPES[n.type], variant = n.type === 'crate' ? (n.tier || 1) : n.id % (t.kind === 'tree' ? 5 : 4); return n.type + ':' + variant + ':' + lod + ':' + DETAIL.q; }
  modelFor(key) {
    let m = this.modelCache.get(key); if (m) return m;
    const [type, v, lod] = key.split(':'), variant = +v, L = +lod, t = NODE_TYPES[type], save = DETAIL.q;
    if (L === 2) DETAIL.q = Math.max(1, save - 1);
    if (t.kind === 'tree') m = tree(type, variant * 17 + 3, L === 1 ? 1 : 0).mb; else if (t.kind === 'rock' || t.kind === 'deco') m = rock(type, variant * 29 + 5, L === 1 ? 1 : 0).mb;
    else if (t.kind === 'pick') m = plant(type, variant * 13 + 1).mb; else if (type === 'crate') m = crate(variant); else m = barrel();
    DETAIL.q = save; this.modelCache.set(key, m); return m;
  }
  /** per-chunk instance lists: Map(modelKey → Float32Array [x,y,z,yaw,scale]*) */
  buildInstances(ci, cj, lod) {
    const out = new Map(), list = this.chunkNodes.get(ci * 100 + cj) || [];
    for (const n of list) {
      if (!n.alive) continue; const t = NODE_TYPES[n.type];
      if (lod === 1 && t.kind === 'pick') continue;
      const k = this.propKey(n, t.kind === 'tree' || t.kind === 'rock' || t.kind === 'deco' ? lod : 0);
      let a = out.get(k); if (!a) out.set(k, a = []);
      a.push(n.x, n.y - (t.kind === 'tree' ? 0.15 : 0), n.z, n.rot, t.kind === 'loot' || t.kind === 'barrel' ? 1 : n.s);
    }
    for (const [k, a] of out) out.set(k, new Float32Array(a));
    return out;
  }
  buildGrass(ci, cj) {
    const m = new MeshBuilder(), R = rng(ci * 7919 + cj * 104729 + this.seed), x0 = ci * CH - HALF, z0 = cj * CH - HALF, T = this.T;
    const N = Math.round(1700 * this.grassDensity * (DETAIL.q >= 3 ? 1.6 : DETAIL.q >= 2 ? 1.25 : 1));
    for (let k = 0; k < N; k++) {
      const x = x0 + R() * CH, z = z0 + R() * CH, h = T.height(x, z);
      if (h < 3.2 || h > 70) { R(); R(); R(); R(); continue; }
      const sl = T.slope(x, z); if (sl > 0.22) { R(); R(); R(); R(); continue; }
      const mo = T.moisture(x, z), col = mixc(mixc(COLS.grass, COLS.grassY, R() * 0.6), mo > 0.52 ? COLS.forest : COLS.grassD, R() * 0.5);
      grassBlade(m, x, h - 0.03, z, R, col, 0.28 + R() * 0.38 + (mo > 0.5 ? 0.15 : 0));
    }
    return m.v.length ? m.toArray() : null;
  }
  // ------------------------------------------------------------------ structures & buildings
  newId(prefix) { return prefix + (Date.now() % 1e7).toString(36) + (this.uid++).toString(36); }
  buildingFrame(b) { return { o: [b.x, b.y, b.z], cs: Math.cos(b.ry), sn: Math.sin(b.ry) }; }
  toWorld(b, u, y, v) { const c = Math.cos(b.ry), s = Math.sin(b.ry); return [b.x + u * c + v * s, b.y + y, b.z - u * s + v * c]; }
  toLocal(b, p) { const c = Math.cos(b.ry), s = Math.sin(b.ry), dx = p[0] - b.x, dz = p[2] - b.z; return [dx * c - dz * s, p[1] - b.y, dx * s + dz * c]; }
  structureTransform(st) {
    const b = this.buildings.get(st.b), S = CELL_S, H = WALL_H;
    if (PIECES[st.piece].kind === 'cell') { const p = this.toWorld(b, st.i * S, st.l * H, st.j * S); return { p, ry: b.ry + (st.rot || 0) * Math.PI / 2 }; }
    if (PIECES[st.piece].kind === 'corner') { const p = this.toWorld(b, st.i * S + S / 2, st.l * H, st.j * S + S / 2); return { p, ry: b.ry }; }
    const u = st.i * S + (st.side === 0 ? S / 2 : 0), v = st.j * S + (st.side === 1 ? S / 2 : 0);
    return { p: this.toWorld(b, u, st.l * H, v), ry: b.ry + (st.side === 0 ? Math.PI / 2 : 0) };
  }
  addStructure(st) {
    if (this.structures.has(st.id)) this.removeStructure(st.id, true);
    this.structures.set(st.id, st);
    const { p, ry } = this.structureTransform(st), S = CELL_S, H = WALL_H, ref = { st: st.id };
    const k = st.piece;
    if (k === 'foundation') st.cols = [this.addBoxCollider([p[0], p[1] - 0.7, p[2]], [S / 2, 0.7, S / 2], ry, ref, true)];
    else if (k === 'floor' || k === 'roof') st.cols = [this.addBoxCollider([p[0], p[1] - 0.09, p[2]], [S / 2, 0.09, S / 2], ry, ref, true)];
    else if (k === 'stairs') st.cols = [this.addBoxCollider([p[0], p[1] + H / 2, p[2]], [0.7, H / 2, S / 2], ry, ref, 'stairs')];
    else if (k === 'pillar') st.cols = [this.addBoxCollider([p[0], p[1] + H / 2, p[2]], [0.16, H / 2, 0.16], ry, ref)];
    else { // walls: build as segments so doorways/windows are passable
      const th = 0.12, seg = (u0, u1, y0, y1) => { const cu = (u0 + u1) / 2, c = Math.cos(ry), s = Math.sin(ry); return this.addBoxCollider([p[0] + cu * c, p[1] + (y0 + y1) / 2, p[2] - cu * s], [(u1 - u0) / 2, (y1 - y0) / 2, th], ry, ref, y1 < H - 0.2 ? true : false); };
      if (k === 'wall') st.cols = [seg(-S / 2, S / 2, 0, H)];
      else if (k === 'doorway') st.cols = [seg(-S / 2, -0.55, 0, H), seg(0.55, S / 2, 0, H), seg(-0.55, 0.55, 2.2, H)];
      else st.cols = [seg(-S / 2, -0.6, 0, H), seg(0.6, S / 2, 0, H), seg(-0.6, 0.6, 0, 1.1), seg(-0.6, 0.6, 2.1, H)];
    }
    this.dirtyBuildings.add(st.b);
  }
  removeStructure(id, keepDoor) {
    const st = this.structures.get(id); if (!st) return;
    for (const c of st.cols || []) this.hashRemove(c);
    this.structures.delete(id); this.dirtyBuildings.add(st.b);
    if (!keepDoor) for (const d of this.deploys.values()) if (d.on === id) this.removeDeploy(d.id);
  }
  structAt(b, i, j, l, kind, side) { for (const st of this.structures.values()) { if (st.b !== b || st.l !== l) continue; const pk = PIECES[st.piece].kind; if (kind === 'cell' && pk === 'cell' && st.i === i && st.j === j && st.piece !== 'stairs') return st; if (kind === 'stairs' && st.piece === 'stairs' && st.i === i && st.j === j) return st; if (kind === 'edge' && pk === 'edge' && st.i === i && st.j === j && st.side === side) return st; if (kind === 'corner' && pk === 'corner' && st.i === i && st.j === j) return st; } return null; }
  buildingMesh(bid) {
    const m = new MeshBuilder();
    for (const st of this.structures.values()) {
      if (st.b !== bid) continue;
      const key = st.piece + ':' + st.tier; let base = this.modelCache.get(key); if (!base) { base = piece(st.piece, st.tier, 3); this.modelCache.set(key, base); }
      const { p, ry } = this.structureTransform(st); m.place(base, p, ry);
    }
    return m.v.length ? m.toArray() : null;
  }
  // ------------------------------------------------------------------ deployables & drops
  addDeploy(d) {
    if (this.deploys.has(d.id)) this.removeDeploy(d.id);
    const it = ITEMS[d.item], k = it.deploy.kind; d.kind = k; this.deploys.set(d.id, d);
    if (!d.inv && it.deploy.slots) d.inv = new Array(it.deploy.slots).fill(null);
    const key = 'dep:' + d.item; let base = this.modelCache.get(key); if (!base) { base = deployable(k, it.deploy); this.modelCache.set(key, base); }
    d.mesh = base;
    const ref = { dep: d.id };
    if (k === 'door') { d.col = this.addBoxCollider([d.x, d.y + 1.1, d.z], [0.55, 1.1, 0.08], d.ry, ref); d.col.off = !!d.open; }
    else if (k === 'bench') d.col = this.addBoxCollider([d.x, d.y + 0.6, d.z], [1, 0.6, 0.45], d.ry, ref);
    else if (k === 'bag') d.col = this.addBoxCollider([d.x, d.y + 0.1, d.z], [0.45, 0.12, 0.95], d.ry, ref);
    else if (k === 'box') { const s = it.deploy.big ? 1.35 : 1; d.col = this.addBoxCollider([d.x, d.y + 0.35 * s, d.z], [0.52 * s, 0.36 * s, 0.32 * s], d.ry, ref, true); }
    else d.col = this.addCircle(d.x, d.z, it.deploy.r || 0.6, d.y - 0.3, d.y + (k === 'furnace' ? 2 : 0.5), ref);
    return d;
  }
  removeDeploy(id) { const d = this.deploys.get(id); if (!d) return; this.hashRemove(d.col); this.deploys.delete(id); }
  setDoor(d, open) { d.open = open; if (d.col) d.col.off = open; }
  addDrop(dr) { this.drops.set(dr.id, dr); return dr; }
  // ------------------------------------------------------------------ helpers
  isWater(x, z, y) { return this.T.height(x, z) < WATER - 0.2 && y < WATER + 0.5; }
}

function rotPt(c, ry, o) { const cs = Math.cos(ry), sn = Math.sin(ry); return [o.x + c[0] * cs + c[2] * sn, o.y + c[1], o.z - c[0] * sn + c[2] * cs]; }
export function rayCyl(o, d, cx, cz, r, y0, y1) {
  const ox = o[0] - cx, oz = o[2] - cz, a = d[0] * d[0] + d[2] * d[2]; if (a < 1e-8) return null;
  const b = 2 * (ox * d[0] + oz * d[2]), c = ox * ox + oz * oz - r * r, disc = b * b - 4 * a * c; if (disc < 0) return null;
  const t = (-b - Math.sqrt(disc)) / (2 * a); if (t < 0) return c < 0 ? 0 : null; const y = o[1] + d[1] * t; return y >= y0 && y <= y1 ? t : null;
}
export function raySphere(o, d, c, r) { const ox = o[0] - c[0], oy = o[1] - c[1], oz = o[2] - c[2], b = ox * d[0] + oy * d[1] + oz * d[2], cc = ox * ox + oy * oy + oz * oz - r * r, disc = b * b - cc; if (disc < 0) return null; const t = -b - Math.sqrt(disc); return t >= 0 ? t : (cc < 0 ? 0 : null); }
export function rayOBB(o, d, c) {
  const dx = o[0] - c.c[0], dy = o[1] - c.c[1], dz = o[2] - c.c[2];
  const lo = [dx * c.cs - dz * c.sn, dy, dx * c.sn + dz * c.cs], ld = [d[0] * c.cs - d[2] * c.sn, d[1], d[0] * c.sn + d[2] * c.cs];
  let t0 = -1e9, t1 = 1e9;
  for (let k = 0; k < 3; k++) { if (Math.abs(ld[k]) < 1e-9) { if (Math.abs(lo[k]) > c.h[k]) return null; continue; } let a = (-c.h[k] - lo[k]) / ld[k], b = (c.h[k] - lo[k]) / ld[k]; if (a > b) [a, b] = [b, a]; t0 = Math.max(t0, a); t1 = Math.min(t1, b); if (t0 > t1) return null; }
  return t1 < 0 ? null : Math.max(t0, 0);
}
export { SIZE, HALF, WATER, HMIN, HMAX, CELL, GRID };
