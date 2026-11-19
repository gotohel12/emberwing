// EMBERWING — procedural world construction: floating islands, flora, ruins, beacon, layout of objectives
import { Batch, worldPal } from '../gfx/assets.js';
import { rng, fbm, noise3, mixc, TAU, dist, clamp, trs } from '../core/math.js';

const darker = (c, k) => [c[0] * k, c[1] * k, c[2] * k];

export function buildWorld(W, lib) {
  const R = rng(W.seed), rand = (a, b) => a + (b - a) * R(), pick = arr => arr[Math.floor(R() * arr.length)];
  const islands = [];
  // beacon island at centre
  islands.push({ x: 0, z: 0, top: 260, r: 640, depth: 900, kind: 'beacon' });
  const a0 = R() * TAU, sp = W.spread;
  islands.push({ x: Math.cos(a0) * sp * 0.88, z: Math.sin(a0) * sp * 0.88, top: 120, r: 380, depth: 520, kind: 'start' });
  let tries = 0;
  while (islands.length < W.islands && tries++ < 4000) {
    const ang = R() * TAU, rr = Math.sqrt(R()) * sp * 1.02, r = rand(150, 470);
    const c = { x: Math.cos(ang) * rr, z: Math.sin(ang) * rr, top: rand(-220, 640), r, depth: r * rand(1.1, 1.9), kind: 'isle' };
    if (islands.every(o => Math.hypot(o.x - c.x, o.z - c.z) > o.r + c.r + 260)) islands.push(c);
  }
  const start = islands[1], beacon = islands[0];
  // route: from start toward beacon through intermediate islands (greedy)
  const route = [start]; let cur = start; const used = new Set([0, 1]);
  for (let k = 0; k < 6; k++) {
    let best = -1, bs = 1e18;
    islands.forEach((o, i) => { if (used.has(i)) return; const d1 = Math.hypot(o.x - cur.x, o.z - cur.z), d2 = Math.hypot(o.x, o.z), dc = Math.hypot(cur.x, cur.z); if (d2 > dc - 150) return; const s = d1 * 0.8 + d2 * 0.4; if (s < bs) { bs = s; best = i; } });
    if (best < 0) break; used.add(best); cur = islands[best]; route.push(cur);
  }
  route.push(beacon);
  // ---- meshes (Blender models instanced into static batches)
  const pal = worldPal(W.pal), C = {};
  const get = n => (n in C ? C[n] : (C[n] = lib.has(n) ? lib.mesh(n, pal) : null));
  const q = W.quality || 1;
  islands.forEach((I, k) => { I.S = new Batch(); I.F = new Batch(); islandMesh(I.S, I.F, I, W, R, get, k, q); });
  beacon.S.add(get('beacon'), mtx(beacon.x, beacon.top, beacon.z, 0, 1, 1, 1));
  // ---- shrines (checkpoints) on route islands at 1/3 and 2/3
  const shrines = [];
  for (const k of [Math.floor(route.length / 3), Math.floor(route.length * 2 / 3)]) {
    const I = route[Math.max(1, Math.min(route.length - 2, k))];
    if (shrines.some(s => s.isle === I)) continue;
    const p = [I.x + I.r * 0.25, I.top + 6, I.z - I.r * 0.15]; shrines.push({ p, isle: I, lit: false });
    I.S.add(get('shrine'), mtx(p[0], p[1] - 5, p[2], R() * TAU, 1, 1, 1));
  }
  // ---- rings along the route (between consecutive route islands, raised)
  const rings = [];
  for (let i = 0; i < route.length - 1 && rings.length < W.rings; i++) {
    const A = route[i], B = route[i + 1];
    for (const t of [0.35, 0.7]) {
      if (rings.length >= W.rings) break;
      const x = A.x + (B.x - A.x) * t, z = A.z + (B.z - A.z) * t, y = Math.max(A.top, B.top) + 160 + Math.sin(i * 1.7 + t * 5) * 120;
      const yaw = Math.atan2(B.x - A.x, B.z - A.z); rings.push({ p: [x, y, z], yaw, r: 70, hit: false, pulse: 0 });
    }
  }
  while (rings.length < W.rings) { const I = pick(islands); rings.push({ p: [I.x, I.top + rand(200, 420), I.z], yaw: R() * TAU, r: 70, hit: false, pulse: 0 }); }
  // ---- embers: trails between islands, halos above islands, loops in rings
  const embers = [];
  const addE = p => { if (embers.length < W.embers) embers.push({ p, base: p.slice(), got: false, ph: R() * TAU }); };
  for (let i = 0; i < route.length - 1; i++) { const A = route[i], B = route[i + 1]; for (let k = 1; k <= 9; k++) { const t = k / 10; addE([A.x + (B.x - A.x) * t, Math.max(A.top, B.top) + 90 + Math.sin(t * Math.PI) * 140, A.z + (B.z - A.z) * t]); } }
  for (const g of rings) for (let k = 0; k < 3; k++) addE([g.p[0] + Math.sin(g.yaw) * (k - 1) * 90, g.p[1], g.p[2] + Math.cos(g.yaw) * (k - 1) * 90]);
  let guard = 0;
  while (embers.length < W.embers && guard++ < 500) {
    const I = pick(islands), n = 5 + Math.floor(R() * 5), rad = I.r * rand(0.4, 0.9), h = I.top + rand(60, 220), off = R() * TAU;
    for (let k = 0; k < n; k++) addE([I.x + Math.cos(off + k / n * TAU) * rad, h + Math.sin(k * 1.3) * 25, I.z + Math.sin(off + k / n * TAU) * rad]);
  }
  // ---- feathers: under an island, high in the sky, near the storm edge
  const feathers = [];
  const deep = islands.filter(o => o.kind === 'isle').sort((a, b) => b.depth - a.depth)[0] || beacon;
  feathers.push({ p: [deep.x, deep.top - deep.depth - 70, deep.z], got: false, hint: 'تحت جزيرة' });
  const tall = islands.filter(o => o.kind === 'isle').sort((a, b) => b.top - a.top)[0] || beacon;
  feathers.push({ p: [tall.x, tall.top + 1250, tall.z], got: false, hint: 'عالي فوق' });
  const far = islands.filter(o => o.kind === 'isle').sort((a, b) => Math.hypot(b.x, b.z) - Math.hypot(a.x, a.z))[0] || beacon;
  const fa = Math.atan2(far.z, far.x); feathers.push({ p: [Math.cos(fa) * (sp + 700), far.top + 300, Math.sin(fa) * (sp + 700)], got: false, hint: 'عند حافة العاصفة' });
  // ---- enemy patrol anchors
  const anchors = islands.filter(o => o !== start).map(o => [o.x, o.top + 220, o.z]);
  const spawn = { p: [start.x, start.top + 8, start.z], yaw: Math.atan2(start.x, start.z) };
  return { islands, route, shrines, rings, embers, feathers, anchors, spawn, beacon, chunks: islands.map(I => { const c = { c: [I.x, I.top - I.depth * 0.3, I.z], r: Math.max(I.r * 1.25, I.depth * 0.7) + (I.kind === 'beacon' ? 400 : 120), s: I.S.build(), f: I.F.build() }; delete I.S; delete I.F; return c; }) };
}

/** column-major T * Ry * S */
export function mtx(x, y, z, ry, sx, sy, sz) {
  const c = Math.cos(ry), s = Math.sin(ry);
  return new Float32Array([c * sx, 0, -s * sx, 0, 0, sy, 0, 0, s * sz, 0, c * sz, 0, x, y, z, 1]);
}

const TPL = ['island0', 'island1', 'island2'];
function islandMesh(S, F, I, W, R, get, k, q) {
  const cx = I.x, cz = I.z, top = I.top, r = I.r;
  const tpl = I.kind === 'beacon' ? 'island1' : TPL[k % 3];
  S.add(get(tpl), mtx(cx, top, cz, R() * TAU, r / 100, I.depth / 100, r / 100));
  if (I.kind === 'beacon') {
    for (let k2 = 0; k2 < 40 * q; k2++) { const a = R() * TAU, rr = 300 + R() * (r * 0.85 - 300); F.add(get('tuft'), mtx(cx + Math.cos(a) * rr, top, cz + Math.sin(a) * rr, R() * TAU, 1.1, 1.1, 1.1)); }
    return;
  }
  const kind = W.flora;
  const nTrees = Math.floor((r / 55 + R() * 3) * (0.5 + 0.5 * q));
  for (let k2 = 0; k2 < nTrees; k2++) {
    const a = R() * TAU, rr = Math.sqrt(R()) * r * 0.8, x = cx + Math.cos(a) * rr, z = cz + Math.sin(a) * rr, s = 0.7 + R() * 0.75;
    const M = mtx(x, top - 1.5, z, R() * TAU, s, s * (0.9 + R() * 0.25), s);
    S.add(get('tree_' + kind + '_s'), M); const f = get('tree_' + kind + '_f'); if (f) F.add(f, M);
  }
  for (let k2 = 0; k2 < 3 + R() * 5; k2++) { const a = R() * TAU, rr = Math.sqrt(R()) * r * 0.85, s = 0.8 + R() * 2.2; S.add(get(R() < 0.5 ? 'rock0' : 'rock1'), mtx(cx + Math.cos(a) * rr, top - s * 2, cz + Math.sin(a) * rr, R() * TAU, s, s * (0.7 + R() * 0.6), s)); }
  for (let k2 = 0; k2 < (r / 34) * q; k2++) { const a = R() * TAU, rr = Math.sqrt(R()) * r * 0.88, s = 0.75 + R() * 0.45; F.add(get('tuft'), mtx(cx + Math.cos(a) * rr, top, cz + Math.sin(a) * rr, R() * TAU, s, s, s)); }
  if (R() < 0.45) { const a = R() * TAU, rr = r * 0.45; S.add(get('ruin'), mtx(cx + Math.cos(a) * rr, top - 2, cz + Math.sin(a) * rr, R() * TAU, 1, 1, 1)); }
}

/** island collision: returns {n, d} push-out or null for sphere at p with radius rad */
export function collide(islands, p, rad) {
  for (const I of islands) {
    const dx = p[0] - I.x, dz = p[2] - I.z, hd = Math.hypot(dx, dz);
    if (hd > I.r * 1.15 + rad) continue;
    const yTop = I.top + 8, yBot = I.top - I.depth;
    if (p[1] > yTop + rad || p[1] < yBot - rad) continue;
    const t = clamp((I.top - p[1]) / I.depth, 0, 1), R = I.r * (t < 0.06 ? 1 : Math.pow(1 - t, 1.25)) * 0.95;
    if (hd > R + rad) continue;
    const up = yTop + rad - p[1], side = R + rad - hd;
    if (p[1] > I.top - 20 && up < side * 1.5 + 30) return { n: [0, 1, 0], d: up, top: true, I };
    const nx = hd > 1e-3 ? dx / hd : 1, nz = hd > 1e-3 ? dz / hd : 0;
    return { n: [nx, t > 0.06 ? 0.35 : 0, nz], d: side, top: false, I };
  }
  return null;
}
export function groundBelow(islands, p) {
  let best = -1e9;
  for (const I of islands) { if (Math.hypot(p[0] - I.x, p[2] - I.z) < I.r * 0.95 && I.top < p[1] + 5) best = Math.max(best, I.top); }
  return best;
}
export { dist };
