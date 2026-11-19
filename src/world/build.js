// EMBERWING — procedural world construction: floating islands, flora, ruins, beacon, layout of objectives
import { MeshBuilder } from '../gfx/mesh.js';
import { rng, fbm, noise3, mixc, TAU, dist, clamp, trs } from '../core/math.js';

const darker = (c, k) => [c[0] * k, c[1] * k, c[2] * k];

export function buildWorld(W) {
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
  // ---- meshes
  const S = new MeshBuilder(), F = new MeshBuilder(), P = W.pal;
  for (const I of islands) islandMesh(S, F, I, W, R);
  // beacon tower
  beaconTower(S, beacon, P);
  // ---- shrines (checkpoints) on route islands at 1/3 and 2/3
  const shrines = [];
  for (const k of [Math.floor(route.length / 3), Math.floor(route.length * 2 / 3)]) {
    const I = route[Math.max(1, Math.min(route.length - 2, k))];
    if (shrines.some(s => s.isle === I)) continue;
    const p = [I.x + I.r * 0.25, I.top + 6, I.z - I.r * 0.15]; shrines.push({ p, isle: I, lit: false });
    shrineMesh(S, p, P);
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
  return { islands, route, shrines, rings, embers, feathers, anchors, spawn, beacon, static: S, foliage: F };
}

function islandMesh(S, F, I, W, R) {
  const P = W.pal, rings = 7, seg = 30, cx = I.x, cz = I.z, top = I.top, r = I.r;
  const hAt = (x, z) => top + fbm(x * 0.004, 0, z * 0.004, 3) * 26;
  const grassC = (x, z) => mixc(P.grass, P.grass2, clamp(0.5 + fbm(x * 0.006, 3, z * 0.006, 2), 0, 1));
  // top surface
  const pts = [];
  for (let i = 0; i <= rings; i++) {
    const row = [];
    for (let s = 0; s < seg; s++) {
      const a = s / seg * TAU, edgeN = 1 + noise3(Math.cos(a) * 2 + cx * 0.01, Math.sin(a) * 2, cz * 0.01) * 0.12, rr = r * edgeN * (i / rings);
      const x = cx + Math.cos(a) * rr, z = cz + Math.sin(a) * rr, y = hAt(x, z) - Math.pow(i / rings, 6) * 18;
      row.push([x, y, z]);
    }
    pts.push(row);
  }
  for (let i = 0; i < rings; i++) for (let s = 0; s < seg; s++) {
    const s2 = (s + 1) % seg, a = pts[i][s], b = pts[i][s2], c = pts[i + 1][s2], d = pts[i + 1][s];
    const col = mixc(grassC(a[0], a[2]), darker(P.grass, 0.85), i / rings * 0.35);
    if (i === 0) S.tri(a, c, d, col); else { S.tri(a, c, d, col); S.tri(a, b, c, col); }
  }
  // cliff band + jagged underside
  const edge = pts[rings], depth = I.depth, bands = 7;
  let prev = edge;
  for (let k = 1; k <= bands; k++) {
    const t = k / bands, ring = [];
    for (let s = 0; s < seg; s++) {
      const e = edge[s], a = s / seg * TAU, jag = 1 + noise3(Math.cos(a) * 3 + k * 0.7, k * 0.9, Math.sin(a) * 3 + cx * 0.01) * 0.28;
      const shrink = k === 1 ? 0.98 : Math.pow(1 - t, 1.25) * jag;
      ring.push([cx + (e[0] - cx) * shrink, top - 30 - (depth - 30) * Math.pow(t, 0.95) + (k === 1 ? 0 : noise3(s, k, cx) * 25), cz + (e[2] - cz) * shrink]);
    }
    const col = mixc(P.rock, P.rock2, t * 0.9);
    for (let s = 0; s < seg; s++) {
      const s2 = (s + 1) % seg, stripe = (k % 2 ? 1 : 0.88);
      S.quad(prev[s], prev[s2], ring[s2], ring[s], darker(col, stripe * (0.9 + 0.1 * Math.sin(s * 1.3))));
    }
    prev = ring;
  }
  const tip = [cx, top - depth - 40, cz];
  for (let s = 0; s < seg; s++) S.tri(prev[(s + 1) % seg], prev[s], tip, darker(P.rock2, 0.8));
  // hanging rocks / roots
  for (let k = 0; k < 4 + R() * 4; k++) { const a = R() * TAU, rr = r * (0.3 + R() * 0.5); S.cyl(cx + Math.cos(a) * rr, top - depth * (0.35 + R() * 0.3), cz + Math.sin(a) * rr, 0, 18 + R() * 30, 60 + R() * 120, 5, darker(P.rock2, 0.9)); }
  // crystals glowing in the underside
  if (R() < 0.6) for (let k = 0; k < 3; k++) { const a = R() * TAU, rr = r * (0.2 + R() * 0.4), y = top - depth * (0.3 + R() * 0.3); S.cyl(cx + Math.cos(a) * rr, y - 50, cz + Math.sin(a) * rr, 10, 0, 50 + R() * 40, 5, P.accent, 0.8); }
  if (I.kind === 'beacon') return;
  // flora + rocks + ruins on top
  const nTrees = Math.floor(r / 45 + R() * 4);
  for (let k = 0; k < nTrees; k++) {
    const a = R() * TAU, rr = Math.sqrt(R()) * r * 0.82, x = cx + Math.cos(a) * rr, z = cz + Math.sin(a) * rr, y = hAt(x, z) - 2;
    tree(F, S, W.flora, x, y, z, 0.7 + R() * 0.8, P, R);
  }
  for (let k = 0; k < 3 + R() * 5; k++) { const a = R() * TAU, rr = Math.sqrt(R()) * r * 0.85, x = cx + Math.cos(a) * rr, z = cz + Math.sin(a) * rr, s = 8 + R() * 22; S.ell(x, hAt(x, z) + s * 0.3, z, s * 1.3, s, s * 1.1, mixc(P.rock, P.rock2, R() * 0.4), 0, 7, 5); }
  // flowers / glow motes
  for (let k = 0; k < r / 12; k++) { const a = R() * TAU, rr = Math.sqrt(R()) * r * 0.9, x = cx + Math.cos(a) * rr, z = cz + Math.sin(a) * rr, y = hAt(x, z); F.cyl(x, y, z, 1.4, 0, 6 + R() * 6, 3, darker(P.grass2, 0.9)); if (R() < 0.35) F.ell(x, y + 9, z, 2.6, 2.6, 2.6, P.flower, 0.7, 5, 3); }
  // ruins
  if (R() < 0.45) { const a = R() * TAU, rr = r * 0.45, x = cx + Math.cos(a) * rr, z = cz + Math.sin(a) * rr, y = hAt(x, z); ruin(S, x, y, z, R, P); }
}

function tree(F, S, kind, x, y, z, k, P, R) {
  if (kind === 'round') {
    S.cyl(x, y, z, 6 * k, 3.5 * k, 60 * k, 6, P.trunk);
    for (let i = 0; i < 3; i++) F.ell(x + (R() - 0.5) * 22 * k, y + (62 + i * 14) * k, z + (R() - 0.5) * 22 * k, (32 - i * 6) * k, (26 - i * 4) * k, (32 - i * 6) * k, i === 2 && R() < 0.3 ? P.leaf2 : mixc(P.leaf, P.grass2, i * 0.2), 0, 9, 6);
  } else if (kind === 'crystal') {
    const n = 3 + Math.floor(R() * 3);
    for (let i = 0; i < n; i++) { const a = R() * TAU, t = 0.25 + R() * 0.4; const h = (60 + R() * 90) * k, rr = (9 + R() * 8) * k; const m = new MeshBuilder(); m.cyl(0, 0, 0, rr, 0, h, 6, i % 2 ? P.leaf : P.leaf2, 0.22); S.append(m, trs([x + Math.cos(a) * 6, y, z + Math.sin(a) * 6], R() * TAU, 1, Math.cos(a) * t, Math.sin(a) * t)); }
  } else if (kind === 'dead') {
    S.cyl(x, y, z, 5 * k, 1.5 * k, 80 * k, 5, P.trunk);
    for (let i = 0; i < 3; i++) { const m = new MeshBuilder(); m.cyl(0, 0, 0, 2.6 * k, 0.6 * k, 34 * k, 4, P.trunk); S.append(m, trs([x, y + (35 + i * 14) * k, z], R() * TAU, 1, 0.9, 0)); }
    if (R() < 0.5) F.ell(x, y + 84 * k, z, 4, 4, 4, P.leaf2, 1, 5, 3);
  } else if (kind === 'burning') {
    S.cyl(x, y, z, 7 * k, 3 * k, 70 * k, 6, P.trunk);
    for (let i = 0; i < 3; i++) F.cyl(x, y + (40 + i * 22) * k, z, (34 - i * 9) * k, 2 * k, 36 * k, 7, i ? P.leaf2 : P.leaf, 0.55 + i * 0.15);
  } else {
    // void spikes
    for (let i = 0; i < 3; i++) { const m = new MeshBuilder(); m.cyl(0, 0, 0, 8 * k, 0, (70 + R() * 70) * k, 5, i === 0 ? P.leaf : P.rock2, i === 0 ? 0.7 : 0); S.append(m, trs([x + (R() - 0.5) * 20, y, z + (R() - 0.5) * 20], R() * TAU, 1, (R() - 0.5) * 0.5, (R() - 0.5) * 0.5)); }
  }
}

function ruin(S, x, y, z, R, P) {
  const c = mixc(P.rock, [0.9, 0.88, 0.82], 0.5), n = 3 + Math.floor(R() * 3), a0 = R() * TAU;
  for (let i = 0; i < n; i++) { const a = a0 + i / n * TAU, h = 50 + R() * 70; S.cyl(x + Math.cos(a) * 60, y - 4, z + Math.sin(a) * 60, 10, 9, h, 8, c); if (R() < 0.6) S.box(x + Math.cos(a) * 60, y + h + 3, z + Math.sin(a) * 60, 26, 6, 26, c); }
  S.cyl(x, y - 2, z, 72, 72, 6, 16, darker(c, 0.85));
  S.cyl(x, y + 4, z, 16, 16, 3, 12, P.accent, 0.6);
}

function shrineMesh(S, p, P) {
  const c = [0.86, 0.84, 0.8];
  S.cyl(p[0], p[1] - 6, p[2], 46, 52, 10, 14, darker(c, 0.8));
  S.cyl(p[0], p[1] + 4, p[2], 14, 18, 46, 8, c);
  S.cyl(p[0], p[1] + 50, p[2], 26, 18, 10, 10, darker(c, 0.9));
  for (let i = 0; i < 4; i++) { const a = i / 4 * TAU + 0.4; S.cyl(p[0] + Math.cos(a) * 36, p[1] + 4, p[2] + Math.sin(a) * 36, 4, 3, 30, 5, P.accent, 0.4); }
}

function beaconTower(S, B, P) {
  const c = [0.9, 0.86, 0.78], d = darker(c, 0.7), x = B.x, z = B.z, y = B.top;
  S.cyl(x, y - 8, z, 260, 280, 14, 32, d);
  S.cyl(x, y + 4, z, 230, 240, 10, 32, c);
  for (let i = 0; i < 12; i++) { const a = i / 12 * TAU; S.cyl(x + Math.cos(a) * 205, y + 12, z + Math.sin(a) * 205, 14, 11, 120, 8, c); S.box(x + Math.cos(a) * 205, y + 136, z + Math.sin(a) * 205, 34, 10, 34, d); S.cyl(x + Math.cos(a) * 205, y + 141, z + Math.sin(a) * 205, 6, 6, 6, 6, P.accent, 0.7); }
  S.cyl(x, y + 12, z, 70, 52, 260, 12, c);
  S.cyl(x, y + 272, z, 56, 90, 40, 14, d);
  S.cyl(x, y + 312, z, 90, 70, 16, 14, c);
  for (let i = 0; i < 6; i++) { const a = i / 6 * TAU; S.cyl(x + Math.cos(a) * 80, y + 320, z + Math.sin(a) * 80, 6, 0, 70, 5, P.accent, 0.5); }
  // stair ring
  for (let i = 0; i < 24; i++) { const a = i / 24 * TAU; S.box(x + Math.cos(a) * 110, y + 12 + i * 10, z + Math.sin(a) * 110, 40, 6, 40, d); }
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
