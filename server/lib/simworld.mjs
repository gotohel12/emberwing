// ARVEX backend — the server's own copy of the collision world (terrain, trees, rocks, ruins, structures, deployables).
// It is the same World class the client uses, without any meshes, so the survivors' AI walks, hides and shoots through
// exactly the geometry a player meets. Also: structural support rules and a coarse navigation grid.
import { World } from '../../src/world/world.js';
import { NODE_TYPES, HALF, WATER } from '../../src/world/terrain.js';
import { PIECES } from '../../src/game/items.js';
import { CH } from '../../src/world/world.js';

export class SimWorld extends World {
  constructor(seed, T, nodes, pois, spawns) {
    super(seed); this.T = T; this.nodes = nodes; this.pois = pois; this.spawns = spawns; this.ready = true;
    for (const n of nodes) { n.kind = NODE_TYPES[n.type].kind; n.cx = Math.floor((n.x + HALF) / CH); n.cz = Math.floor((n.z + HALF) / CH); }
    this.indexNodes(); for (const n of nodes) this.addNodeCollider(n);
    for (const p of pois) this.addPoiColliders(p);
    this.dirtyBuildings = { add() {}, clear() {}, [Symbol.iterator]: function* () {} };   // nothing is meshed here
    this.nav = new Nav(T);
  }
  // ---------------------------------------------------------------- support rules (same as the client's placement rules)
  cellBase(b, i, j, l) { const st = this.structAt(b, i, j, l, 'cell'); return !!st && (l === 0 ? st.piece === 'foundation' : st.piece === 'floor'); }
  /** can this piece stand where it is? `skip` = a structure to treat as already gone */
  supported(st, skip) {
    const b = st.b, { i, j, l, side } = st, at = (ii, jj, ll, kind, sd) => { const x = this.structAt(b, ii, jj, ll, kind, sd); return x && x !== skip ? x : null; };
    const base = (ii, jj, ll) => { const x = at(ii, jj, ll, 'cell'); return !!x && (ll === 0 ? x.piece === 'foundation' : x.piece === 'floor'); };
    const kind = PIECES[st.piece].kind;
    if (st.piece === 'foundation') return true;
    if (kind === 'edge') { const ni = side === 0 ? i + 1 : i, nj = side === 1 ? j + 1 : j, below = l > 0 && at(i, j, l - 1, 'edge', side); return base(i, j, l) || base(ni, nj, l) || !!below; }
    if (st.piece === 'stairs') return base(i, j, l);
    if (kind === 'cell') {
      const walls = [at(i, j, l - 1, 'edge', 0), at(i - 1, j, l - 1, 'edge', 0), at(i, j, l - 1, 'edge', 1), at(i, j - 1, l - 1, 'edge', 1)].some(Boolean);
      const pillars = [[0, 0], [-1, 0], [0, -1], [-1, -1]].some(([a, c]) => at(i + a, j + c, l - 1, 'corner'));
      const adj = st.piece === 'floor' && [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([a, c]) => { const n = at(i + a, j + c, l, 'cell'); return n && n.piece === 'floor' && n.supported; });
      return walls || pillars || adj;
    }
    return [[0, 0], [1, 0], [0, 1], [1, 1]].some(([a, c]) => base(i + a, j + c, l));
  }
  /** after something was removed from building b: everything that lost its support, bottom-up (returns the pieces to remove) */
  unsupported(b) {
    const out = [], gone = new Set(); let again = true, guard = 0;
    while (again && guard++ < 12) {
      again = false;
      for (const st of this.structuresOf(b)) {
        if (gone.has(st)) continue;
        const b2 = st.b, real = this.structAt.bind(this);
        this.structAt = (bb, i, j, l, kind, sd) => { const x = real(bb, i, j, l, kind, sd); return x && gone.has(x) ? null : x; };
        const ok = this.supported(st); this.structAt = real;
        if (!ok) { gone.add(st); out.push(st); again = true; }
      }
    }
    return out;
  }
}

// ------------------------------------------------------------------ coarse navigation grid (A* over 24 m cells)
const NC = 24, NG = Math.floor(HALF * 2 / NC);
export class Nav {
  constructor(T) {
    this.cost = new Float32Array(NG * NG);
    for (let j = 0; j < NG; j++) for (let i = 0; i < NG; i++) {
      const x = -HALF + (i + 0.5) * NC, z = -HALF + (j + 0.5) * NC; let worst = 0, water = 0, hmax = -99;
      for (const [ox, oz] of [[0, 0], [-8, -8], [8, -8], [-8, 8], [8, 8]]) { const h = T.height(x + ox, z + oz); worst = Math.max(worst, T.slope(x + ox, z + oz)); if (h < WATER - 0.3) water++; hmax = Math.max(hmax, h); }
      let c = 1 + worst * 6; if (water >= 3) c = 3.2; if (worst > 0.5 || hmax > 125) c = 40; if (hmax < -6) c = 12;      // steep rock is nearly a wall, shallow water is slow, deep sea is avoided
      if (Math.hypot(x, z) > HALF * 0.97) c = 99;
      this.cost[j * NG + i] = c;
    }
    this.open = new Int32Array(NG * NG); this.g = new Float32Array(NG * NG); this.from = new Int32Array(NG * NG); this.stamp = new Int32Array(NG * NG); this.run = 0;
  }
  cell(x, z) { return Math.max(0, Math.min(NG - 1, Math.floor((z + HALF) / NC))) * NG + Math.max(0, Math.min(NG - 1, Math.floor((x + HALF) / NC))); }
  costAt(x, z) { return this.cost[this.cell(x, z)]; }
  /** way points (cell centres) from a to b; [] when they are in the same or neighbouring cells */
  path(ax, az, bx, bz) {
    const s = this.cell(ax, az), e = this.cell(bx, bz); if (s === e) return [];
    const run = ++this.run, g = this.g, from = this.from, stamp = this.stamp, cost = this.cost, heap = [], ei = e % NG, ej = (e / NG) | 0;
    const push = (n, f) => { heap.push([f, n]); let i = heap.length - 1; while (i > 0) { const p = (i - 1) >> 1; if (heap[p][0] <= heap[i][0]) break; [heap[p], heap[i]] = [heap[i], heap[p]]; i = p; } };
    const pop = () => { const t = heap[0], l = heap.pop(); if (heap.length) { heap[0] = l; let i = 0; for (;;) { const a = i * 2 + 1, b = a + 1; let m = i; if (a < heap.length && heap[a][0] < heap[m][0]) m = a; if (b < heap.length && heap[b][0] < heap[m][0]) m = b; if (m === i) break; [heap[m], heap[i]] = [heap[i], heap[m]]; i = m; } } return t; };
    g[s] = 0; stamp[s] = run; from[s] = -1; push(s, 0); let found = false, iter = 0;
    while (heap.length && iter++ < 6000) {
      const [, n] = pop(); if (n === e) { found = true; break; }
      const ni = n % NG, nj = (n / NG) | 0;
      for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
        if (!di && !dj) continue; const i = ni + di, j = nj + dj; if (i < 0 || j < 0 || i >= NG || j >= NG) continue;
        const m = j * NG + i, c = cost[m]; if (c >= 99) continue; const ng = g[n] + c * (di && dj ? 1.414 : 1);
        if (stamp[m] === run && g[m] <= ng) continue; g[m] = ng; stamp[m] = run; from[m] = n; push(m, ng + Math.hypot(i - ei, j - ej));
      }
    }
    if (!found) return [];
    const out = []; let n = e; while (n !== s && n >= 0) { out.push([-HALF + (n % NG + 0.5) * NC, -HALF + (((n / NG) | 0) + 0.5) * NC]); n = from[n]; }
    out.reverse(); out.pop(); out.push([bx, bz]); return out;
  }
}
