// ARVEX SURVIVAL — deterministic island generator (pure: shared by client and server)
// World: SIZE x SIZE metres centred on 0. Water level y = 0. Heightmap at CELL metres.
export const SIZE = 1536, CELL = 2, GRID = SIZE / CELL + 1, HALF = SIZE / 2, WATER = 0;
export const HMIN = -40, HMAX = 170;

function mkRng(seed) { let s = (seed >>> 0) || 1; return () => { s ^= s << 13; s >>>= 0; s ^= s >> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; }; }
function hash2(x, y, s) { let h = (x * 374761393 + y * 668265263 + s * 1442695041) | 0; h = (h ^ (h >>> 13)) * 1274126177; return ((h ^ (h >>> 16)) >>> 0) / 4294967296; }
function vnoise(x, y, s) {
  const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi, u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
  const a = hash2(xi, yi, s), b = hash2(xi + 1, yi, s), c = hash2(xi, yi + 1, s), d = hash2(xi + 1, yi + 1, s);
  return (a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v) * 2 - 1;
}
function fbm(x, y, s, o = 5, g = 0.5) { let a = 1, f = 1, t = 0, n = 0; for (let i = 0; i < o; i++) { t += a * vnoise(x * f, y * f, s + i * 31); n += a; a *= g; f *= 2.03; } return t / n; }
function ridged(x, y, s, o = 5) { let a = 1, f = 1, t = 0, n = 0; for (let i = 0; i < o; i++) { let v = 1 - Math.abs(vnoise(x * f, y * f, s + i * 17)); v *= v; t += a * v; n += a; a *= 0.5; f *= 2.1; } return t / n; }
const smooth = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

export class Terrain {
  constructor(seed = 1337) {
    this.seed = seed >>> 0;
    this.h = new Float32Array(GRID * GRID);
    this.moist = new Float32Array(GRID * GRID);
    this.rivers = [];
    this.lakes = [];
  }
  /** builds the heightmap; yields between rows so the UI can show progress */
  *generateSteps() {
    const s = this.seed, R = mkRng(s * 7 + 3);
    // mountain range axis + rivers + lakes are chosen first so the height pass can carve them
    const ma = R() * Math.PI * 2; this.mtn = { x: Math.cos(ma) * 260, z: Math.sin(ma) * 260, a: ma + Math.PI / 2 };
    for (let k = 0; k < 2; k++) {
      const a0 = ma + (k ? 0.9 : -0.9) + (R() - 0.5) * 0.5, pts = [];
      let x = this.mtn.x * 0.6, z = this.mtn.z * 0.6, dir = a0;
      for (let i = 0; i < 120; i++) { pts.push([x, z]); dir += vnoise(i * 0.15, k * 9, s + 77) * 0.22; { const out = Math.atan2(z, x); let d = out - dir; while (d > Math.PI) d -= Math.PI * 2; while (d < -Math.PI) d += Math.PI * 2; dir += d * 0.07; } x += Math.cos(dir) * 8; z += Math.sin(dir) * 8; if (Math.hypot(x, z) > HALF * 0.92) break; }
      this.rivers.push(pts);
    }
    for (let k = 0; k < 3; k++) { const a = R() * Math.PI * 2, r = 120 + R() * 260; this.lakes.push({ x: Math.cos(a) * r, z: Math.sin(a) * r, r: 26 + R() * 30 }); }
    const rivSeg = []; for (const pts of this.rivers) for (let i = 0; i < pts.length - 1; i++) rivSeg.push([pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1], i / pts.length]);
    const rivGrid = new Map(); const RG = 48;
    for (const sg of rivSeg) { const gx = Math.floor((sg[0] + sg[2]) / 2 / RG), gz = Math.floor((sg[1] + sg[3]) / 2 / RG); for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) { const k = (gx + dx) + ',' + (gz + dz); if (!rivGrid.has(k)) rivGrid.set(k, []); rivGrid.get(k).push(sg); } }
    const riverDist = (x, z) => { const L = rivGrid.get(Math.floor(x / RG) + ',' + Math.floor(z / RG)); if (!L) return [1e9, 0]; let best = 1e9, bt = 0; for (const [ax, az, bx, bz, t] of L) { const vx = bx - ax, vz = bz - az, l2 = vx * vx + vz * vz || 1; let u = ((x - ax) * vx + (z - az) * vz) / l2; u = Math.max(0, Math.min(1, u)); const d = Math.hypot(x - ax - vx * u, z - az - vz * u); if (d < best) { best = d; bt = t; } } return [best, bt]; };
    const mx = this.mtn.x, mz = this.mtn.z, mca = Math.cos(this.mtn.a), msa = Math.sin(this.mtn.a);
    for (let j = 0; j < GRID; j++) {
      const z = j * CELL - HALF;
      for (let i = 0; i < GRID; i++) {
        const x = i * CELL - HALF;
        // island mask with a noisy coastline
        const r = Math.hypot(x, z) / HALF + fbm(x * 0.004, z * 0.004, s + 1, 4) * 0.22 + fbm(x * 0.02, z * 0.02, s + 2, 3) * 0.035;
        const land = 1 - smooth(0.55, 0.86, r);
        // rolling hills + plateau terraces
        let hh = 6 + fbm(x * 0.006, z * 0.006, s + 3, 5) * 22 + fbm(x * 0.022, z * 0.022, s + 4, 3) * 4;
        // mountain range: ridged noise along an axis
        const lx = (x - mx) * mca + (z - mz) * msa, lz = -(x - mx) * msa + (z - mz) * mca;
        const band = Math.exp(-(lz * lz) / (2 * 120 * 120)) * Math.exp(-(lx * lx) / (2 * 380 * 380));
        hh += band * (40 + ridged(x * 0.006, z * 0.006, s + 5, 5) * 125);
        hh += Math.max(0, fbm(x * 0.01, z * 0.01, s + 6, 4)) * 18 * land;
        let hgt = -34 + (hh + 34) * land;
        // beaches: flatten the band just above the waterline
        if (hgt > -2 && hgt < 5) hgt = -2 + (hgt + 2) * 0.55 + Math.max(0, hgt - 3) * 1.575; // continuous at both ends
        // rivers (carve to below sea level, so the ocean plane fills them)
        const [rd, rt] = riverDist(x, z); const rw = 6 + rt * 9;
        if (rd < rw * 3.2) { const k = smooth(rw * 3.2, rw * 0.6, rd); hgt = hgt * (1 - k) + Math.min(hgt, -1.8 - rt * 1.4) * k; }
        for (const L of this.lakes) { const d = Math.hypot(x - L.x, z - L.z) + fbm(x * 0.05, z * 0.05, s + 9, 2) * 8; if (d < L.r * 1.9) { const k = smooth(L.r * 1.9, L.r * 0.6, d); hgt = hgt * (1 - k) + Math.min(hgt, -2.6 - (1 - d / (L.r * 1.9)) * 3) * k; } }
        const idx = j * GRID + i;
        this.h[idx] = Math.max(HMIN, Math.min(HMAX, hgt));
        this.moist[idx] = fbm(x * 0.005 + 40, z * 0.005 - 20, s + 8, 4) * 0.5 + 0.5;
      }
      if ((j & 31) === 0) yield j / GRID;
    }
    yield 1;
  }
  generate() { for (const _ of this.generateSteps()); return this; }
  /** bilinear height at world x,z */
  height(x, z) {
    const fx = (x + HALF) / CELL, fz = (z + HALF) / CELL;
    if (fx < 0 || fz < 0 || fx >= GRID - 1 || fz >= GRID - 1) return HMIN;
    const i = Math.floor(fx), j = Math.floor(fz), u = fx - i, v = fz - j, k = j * GRID + i, H = this.h;
    // match the triangulation used by the mesh (split along a->d diagonal)
    if (u + v <= 1) return H[k] + (H[k + 1] - H[k]) * u + (H[k + GRID] - H[k]) * v;
    return H[k + GRID + 1] + (H[k + GRID] - H[k + GRID + 1]) * (1 - u) + (H[k + 1] - H[k + GRID + 1]) * (1 - v);
  }
  normal(x, z) { const e = 1, a = this.height(x - e, z), b = this.height(x + e, z), c = this.height(x, z - e), d = this.height(x, z + e); const nx = a - b, nz = c - d, ny = 2 * e, l = Math.hypot(nx, ny, nz); return [nx / l, ny / l, nz / l]; }
  slope(x, z) { return 1 - this.normal(x, z)[1]; }
  moisture(x, z) { const i = Math.round((x + HALF) / CELL), j = Math.round((z + HALF) / CELL); if (i < 0 || j < 0 || i >= GRID || j >= GRID) return 0; return this.moist[j * GRID + i]; }
  inBounds(x, z) { return Math.abs(x) < HALF - 4 && Math.abs(z) < HALF - 4; }
  /** biome id: 0 ocean 1 beach 2 grass 3 forest 4 rock 5 snow */
  biome(x, z) {
    const h = this.height(x, z), sl = this.slope(x, z), m = this.moisture(x, z);
    if (h < -0.2) return 0; if (h < 2.6 && sl < 0.12) return 1;
    if (h > 112) return 5; if (h > 70 || sl > 0.32) return 4;
    return m > 0.52 ? 3 : 2;
  }
  /** low-res copy for the water shader texture */
  downsample(n) { const out = new Float32Array(n * n); for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) out[j * n + i] = this.height(-HALF + (i + 0.5) / n * SIZE, -HALF + (j + 0.5) / n * SIZE); return out; }
}

// ------------------------------------------------------------- resource + POI layout (deterministic)
export const NODE_TYPES = {
  pine: { hp: 120, kind: 'tree', r: 0.45, yield: 'wood' }, oak: { hp: 150, kind: 'tree', r: 0.6, yield: 'wood' }, birch: { hp: 100, kind: 'tree', r: 0.35, yield: 'wood' }, dead: { hp: 60, kind: 'tree', r: 0.35, yield: 'wood' },
  rock: { hp: 140, kind: 'rock', r: 1.1, yield: 'stone' }, metal: { hp: 180, kind: 'rock', r: 1.1, yield: 'metal_ore' }, boulder: { hp: 9e9, kind: 'deco', r: 2.4 },
  hemp: { hp: 1, kind: 'pick', r: 0, yield: 'cloth' }, berry: { hp: 1, kind: 'pick', r: 0, yield: 'berries' }, stump: { hp: 1, kind: 'pick', r: 0, yield: 'wood' }, stones: { hp: 1, kind: 'pick', r: 0, yield: 'stone' },
  crate: { hp: 1, kind: 'loot', r: 0.6 }, barrel: { hp: 40, kind: 'barrel', r: 0.45 }
};
export const RESPAWN = { tree: 900, rock: 1200, pick: 420, loot: 1200, barrel: 900 };

export function layoutWorld(T) {
  const R = mkRng(T.seed * 13 + 5), nodes = [], pois = [];
  const add = (type, x, z, extra) => { const y = T.height(x, z); nodes.push(Object.assign({ id: nodes.length, type, x: +x.toFixed(2), y: +y.toFixed(2), z: +z.toFixed(2), rot: R() * Math.PI * 2, s: 0.85 + R() * 0.35 }, extra || {})); };
  // POIs first (ruins), so vegetation keeps out of them
  const tryPoi = (kind, n, minH, maxH) => {
    for (let k = 0, made = 0; k < 400 && made < n; k++) {
      const x = (R() * 2 - 1) * HALF * 0.75, z = (R() * 2 - 1) * HALF * 0.75, y = T.height(x, z);
      if (y < minH || y > maxH || T.slope(x, z) > 0.14) continue;
      let flat = true; for (let a = 0; a < 8; a++) { const yy = T.height(x + Math.cos(a) * 14, z + Math.sin(a) * 14); if (Math.abs(yy - y) > 3.5 || yy < 1) flat = false; }
      if (!flat || pois.some(p => Math.hypot(p.x - x, p.z - z) < 160)) continue;
      pois.push({ id: pois.length, kind, x, z, y, rot: Math.floor(R() * 4) * Math.PI / 2, seed: Math.floor(R() * 1e9) }); made++;
    }
  };
  tryPoi('outpost', 3, 3, 60); tryPoi('ruin', 5, 3, 90); tryPoi('tower', 2, 20, 110); tryPoi('camp', 4, 2, 40);
  const nearPoi = (x, z, r) => pois.some(p => Math.hypot(p.x - x, p.z - z) < r);
  // loot inside POIs
  for (const p of pois) {
    const n = p.kind === 'outpost' ? 4 : p.kind === 'camp' ? 2 : 3;
    for (let i = 0; i < n; i++) { const a = p.rot + i * 2.1 + 0.4, d = 3 + (i % 3) * 2.2; add(i % 2 ? 'barrel' : 'crate', p.x + Math.cos(a) * d, p.z + Math.sin(a) * d, { poi: p.id, tier: p.kind === 'outpost' || p.kind === 'tower' ? 2 : 1 }); }
  }
  // jittered grid scatter
  const STEP = 6;
  for (let gz = -HALF + 8; gz < HALF - 8; gz += STEP) for (let gx = -HALF + 8; gx < HALF - 8; gx += STEP) {
    const x = gx + (R() - 0.5) * STEP * 0.9, z = gz + (R() - 0.5) * STEP * 0.9, y = T.height(x, z);
    if (y < 0.4 || nearPoi(x, z, 18)) { R(); R(); continue; }
    const b = T.biome(x, z), sl = T.slope(x, z), m = T.moisture(x, z), r = R(), q = R();
    if (b === 3) { // forest
      if (r < 0.34) add(q < 0.55 ? 'pine' : q < 0.82 ? 'oak' : 'birch', x, z);
      else if (r < 0.37) add('berry', x, z); else if (r < 0.40) add('hemp', x, z); else if (r < 0.41) add('stump', x, z); else if (r < 0.425) add('rock', x, z);
    } else if (b === 2) { // grassland
      if (r < 0.055) add(q < 0.5 ? 'oak' : q < 0.8 ? 'birch' : 'pine', x, z);
      else if (r < 0.075) add('hemp', x, z); else if (r < 0.088) add('berry', x, z); else if (r < 0.1) add('rock', x, z); else if (r < 0.106) add('stones', x, z); else if (r < 0.11) add('dead', x, z);
    } else if (b === 4) { // rock
      if (r < 0.07) add(q < 0.62 ? 'rock' : 'metal', x, z); else if (r < 0.1 && sl < 0.45) add('boulder', x, z); else if (r < 0.12 && y < 90) add('pine', x, z); else if (r < 0.13) add('stones', x, z);
    } else if (b === 5) { if (r < 0.05) add('metal', x, z); else if (r < 0.08) add('boulder', x, z); }
    else if (b === 1) { if (r < 0.012) add('stump', x, z); else if (r < 0.02) add('stones', x, z); else if (r < 0.023) add('dead', x, z); }
  }
  // spawn points on beaches
  const spawns = [];
  for (let k = 0; k < 4000 && spawns.length < 24; k++) { const a = R() * Math.PI * 2, rr = HALF * (0.5 + R() * 0.4), x = Math.cos(a) * rr, z = Math.sin(a) * rr, y = T.height(x, z); if (y > 0.8 && y < 4 && T.slope(x, z) < 0.15) spawns.push([x, y, z]); }
  return { nodes, pois, spawns };
}
