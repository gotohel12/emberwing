// ARVEX SURVIVAL — procedural model library (high-detail, art-directed, deterministic)
// Everything is built in code from the same palette, so it stays consistent and costs ~0 bytes of download.
import { MeshBuilder } from './mesh.js';
import { rng, hex, mixc, norm, TAU } from '../core/math.js';

const C = {
  bark: hex('#4a3a2c'), barkD: hex('#2f251c'), barkL: hex('#6a5442'), birch: hex('#d9d4c7'), birchD: hex('#3a3632'),
  pine: hex('#2b4a2e'), pineD: hex('#1c3420'), pineL: hex('#3f6a3a'), oak: hex('#3e5f2c'), oakL: hex('#5e7f36'), oakD: hex('#2a4420'), birchLeaf: hex('#7b9a3a'), birchLeafL: hex('#a9b84a'),
  stone: hex('#77736b'), stoneD: hex('#4e4b46'), stoneL: hex('#9a958b'), moss: hex('#4f6332'), ore: hex('#b0652e'), oreL: hex('#d98a45'),
  wood: hex('#8a6440'), woodD: hex('#5c4128'), woodL: hex('#a77d52'), plank: hex('#7d5a39'), metal: hex('#6d7378'), metalD: hex('#43484d'), metalL: hex('#9aa1a6'), rust: hex('#7a4a2a'),
  concrete: hex('#8b8880'), concreteD: hex('#5f5d58'), cloth: hex('#8a8064'), skin: hex('#c79a78'), sleeve: hex('#3b3f3a'), glove: hex('#4a3b2e'),
  hemp: hex('#5f7f32'), hempL: hex('#8aa648'), berry: hex('#a3243a'), fire: hex('#ff8a3a')
};
export const PAL = C;
const jit = (c, R, k = 0.08) => [c[0] * (1 + (R() - 0.5) * k), c[1] * (1 + (R() - 0.5) * k), c[2] * (1 + (R() - 0.5) * k)];
const sway = k => -(1 + k);
// model detail: 0 low · 1 medium · 2 high-poly · 3 extra-poly (set from graphics settings)
export const DETAIL = { q: 2 };
export function setDetail(q) { DETAIL.q = Math.max(0, Math.min(3, q | 0)); }
/** one foliage card (two triangles) centred at c, facing roughly n, swaying with weight k */
function leafCard(m, c, n, w, h, col, k, R, tilt = 0.6) {
  const up = Math.abs(n[1]) > 0.9 ? [1, 0, 0] : [0, 1, 0];
  let t = norm([n[1] * up[2] - n[2] * up[1], n[2] * up[0] - n[0] * up[2], n[0] * up[1] - n[1] * up[0]]);
  const a = R() * TAU, ca = Math.cos(a), sa = Math.sin(a), b = norm([n[1] * t[2] - n[2] * t[1], n[2] * t[0] - n[0] * t[2], n[0] * t[1] - n[1] * t[0]]);
  t = [t[0] * ca + b[0] * sa, t[1] * ca + b[1] * sa, t[2] * ca + b[2] * sa]; const u = norm([n[1] * t[2] - n[2] * t[1], n[2] * t[0] - n[0] * t[2], n[0] * t[1] - n[1] * t[0]]);
  const droop = [0, -tilt * h * 0.5, 0], P = (x, y) => [c[0] + t[0] * x + u[0] * y + (y > 0 ? droop[0] : 0), c[1] + t[1] * x + u[1] * y + (y > 0 ? droop[1] : 0), c[2] + t[2] * x + u[2] * y + (y > 0 ? droop[2] : 0)];
  const nn = norm([n[0] * 0.6, n[1] * 0.6 + 0.4, n[2] * 0.6]), dark = mixc(col, [0, 0, 0], 0.28), e = sway(k), e2 = sway(k * 1.4);
  const p0 = P(-w / 2, -h / 2), p1 = P(w / 2, -h / 2), p2 = P(w * 0.55, h * 0.1), p3 = P(0, h / 2), p4 = P(-w * 0.55, h * 0.1);
  m.vert(p0, nn, dark, e); m.vert(p1, nn, dark, e); m.vert(p2, nn, col, e2); m.vert(p0, nn, dark, e); m.vert(p2, nn, col, e2); m.vert(p3, nn, col, e2); m.vert(p0, nn, dark, e); m.vert(p3, nn, col, e2); m.vert(p4, nn, col, e2);
}

// ------------------------------------------------------------------ trees
export function tree(type, seed, lod = 0) {
  if (lod) return treeLow(type, seed);
  if (DETAIL.q >= 2) return treeHigh(type, seed);
  const R = rng(seed * 9301 + 49297), m = new MeshBuilder();
  if (type === 'pine') {
    const H = 9 + R() * 5;
    m.lathe(0, -0.4, 0, [[0.44, 0], [0.38, 0.3], [0.35, 0.8], [0.3, H * 0.35], [0.24, H * 0.55], [0.18, H * 0.7], [0.1, H * 0.86], [0.04, H]], 14, (i) => mixc(C.barkD, C.bark, i / 4), 0, (a, i) => Math.sin(a * 5 + i) * 0.06);
    // roots
    for (let k = 0; k < 7; k++) { const a = k / 7 * TAU + R(); m.tube([0, 0.45, 0], [Math.cos(a) * 0.55, 0.05, Math.sin(a) * 0.55], 0.15, 0.11, 8, C.barkD); m.tube([Math.cos(a) * 0.55, 0.05, Math.sin(a) * 0.55], [Math.cos(a) * 1.05, -0.2, Math.sin(a) * 1.05], 0.11, 0.04, 7, C.barkD, 0, true); }
    for (let k = 0; k < 12; k++) { const a = R() * TAU, y = H * (0.25 + R() * 0.6), L = (1 - y / H) * 2.2 + 0.4; m.tube([0, y, 0], [Math.cos(a) * L, y - 0.3, Math.sin(a) * L], 0.05, 0.015, 5, C.barkD, t => t ? sway(0.05) : 0); }
    const tiers = 12 + Math.floor(R() * 4);
    for (let t = 0; t < tiers; t++) {
      const k = t / tiers, y = H * (0.24 + k * 0.72), r = (1 - k) * (2.7 + R() * 0.6) + 0.3, hgt = 1.2 + (1 - k) * 0.7;
      const col = jit(mixc(C.pineD, C.pine, 0.3 + k * 0.6), R);
      const seg = 18;
      // drooping skirt with jagged rim (two rings, the outer one hangs down)
      const pts = [];
      for (let s = 0; s < seg; s++) { const a = s / seg * TAU + t * 0.7, rr = r * (0.82 + R() * 0.32); pts.push([Math.cos(a) * rr, y - 0.35 - R() * 0.25, Math.sin(a) * rr, a]); }
      const top = [0, y + hgt, 0];
      for (let s = 0; s < seg; s++) {
        const a = pts[s], b = pts[(s + 1) % seg], mid = [(a[0] + b[0]) * 0.36, y + 0.15, (a[2] + b[2]) * 0.36];
        const ca = jit(col, R, 0.12), sw = sway(0.03 + k * 0.05), swr = sway(0.06 + k * 0.08);
        const n1 = norm([a[0] * 0.6, 1, a[2] * 0.6]), n2 = norm([b[0] * 0.6, 1, b[2] * 0.6]), nt = [0, 1, 0];
        m.vert(top, nt, mixc(ca, C.pineL, 0.25), sw); m.vert([b[0], b[1], b[2]], n2, mixc(ca, C.pineD, 0.3), swr); m.vert([a[0], a[1], a[2]], n1, mixc(ca, C.pineD, 0.3), swr);
        // under-side (darker) so it reads from below
        m.vert([a[0], a[1], a[2]], [0, -1, 0], mixc(ca, C.pineD, 0.7), swr); m.vert([b[0], b[1], b[2]], [0, -1, 0], mixc(ca, C.pineD, 0.7), swr); m.vert(mid, [0, -1, 0], C.pineD, sw);
      }
    }
    return { mb: m, r: 0.42, h: H };
  }
  if (type === 'oak' || type === 'birch') {
    const birch = type === 'birch', H = birch ? 7 + R() * 3 : 6 + R() * 3, tr = birch ? 0.24 : 0.5;
    const barkC = i => birch ? (i % 2 ? C.birch : mixc(C.birch, C.birchD, 0.12)) : mixc(C.barkD, C.bark, i / 4);
    m.lathe(0, -0.4, 0, [[tr * 1.6, 0], [tr * 1.15, 0.4], [tr, 0.9], [tr * 0.92, H * 0.3], [tr * 0.85, H * 0.5], [tr * 0.72, H * 0.68], [tr * 0.6, H * 0.8]], 16, barkC, 0, (a, i) => Math.sin(a * 4 + i * 2) * (birch ? 0.03 : 0.09));
    if (birch) for (let k = 0; k < 7; k++) { const y = 0.6 + R() * H * 0.7, a = R() * TAU; m.box(Math.cos(a) * tr * 0.92, y, Math.sin(a) * tr * 0.92, 0.12, 0.05, 0.12, C.birchD); }
    const branches = birch ? 6 : 7 + Math.floor(R() * 3), clusters = [];
    for (let b = 0; b < branches; b++) {
      const a = b / branches * TAU + R() * 0.8, y0 = H * (0.45 + R() * 0.25), L = (birch ? 1.6 : 2.4) + R() * 1.2;
      const end = [Math.cos(a) * L, y0 + L * (0.5 + R() * 0.4), Math.sin(a) * L];
      m.tube([0, y0, 0], end, tr * 0.42, tr * 0.16, 6, birch ? C.birch : C.bark, (t) => t ? sway(0.04) : 0);
      clusters.push(end);
      const mid = [end[0] * 0.55, y0 + (end[1] - y0) * 0.55, end[2] * 0.55], a2 = a + (R() - 0.5) * 1.6, L2 = L * 0.5, e2 = [mid[0] + Math.cos(a2) * L2, mid[1] + L2 * 0.6, mid[2] + Math.sin(a2) * L2];
      m.tube(mid, e2, tr * 0.2, tr * 0.08, 6, birch ? C.birch : C.bark, t => t ? sway(0.05) : 0); clusters.push(e2);
    }
    clusters.push([0, H * 0.95, 0]); clusters.push([R() - 0.5, H * 0.82, R() - 0.5]);
    for (const [cx, cy, cz] of clusters) {
      const rr = ((birch ? 1.1 : 1.65) + R() * 0.7), sd = Math.floor(R() * 1e6), base = birch ? C.birchLeaf : C.oak;
      m.ico(cx, cy, cz, rr * 1.1, rr * 0.85, rr * 1.1, 2, u => 1 + Math.sin(u[0] * 7 + sd) * 0.13 + Math.sin(u[1] * 9 + u[2] * 6 + sd) * 0.1,
        (p, n) => { const lt = 0.5 + n[1] * 0.4 + (Math.sin(p[0] * 3 + p[2] * 2 + sd) * 0.08); return jit(mixc(birch ? C.oakD : C.oakD, birch ? C.birchLeafL : C.oakL, Math.max(0, Math.min(1, lt))), R, 0.1); },
        p => sway(0.05 + Math.max(0, p[1] - H * 0.4) * 0.012));
    }
    return { mb: m, r: tr, h: H + 2 };
  }
  // dead tree
  const H = 5 + R() * 3;
  m.lathe(0, -0.3, 0, [[0.36, 0], [0.28, 0.6], [0.2, H * 0.6], [0.06, H]], 8, (i) => mixc(hex('#3b342d'), hex('#6b6258'), i / 4), 0, (a, i) => Math.sin(a * 6 + i) * 0.07);
  for (let b = 0; b < 4; b++) { const a = R() * TAU, y0 = H * (0.35 + R() * 0.45), L = 1 + R() * 1.4; m.tube([0, y0, 0], [Math.cos(a) * L, y0 + L * 0.7, Math.sin(a) * L], 0.09, 0.02, 5, hex('#5b5249')); }
  return { mb: m, r: 0.3, h: H };
}

/** high / extra-poly trees: branching structure, bark detail and thousands of individual foliage cards */
function treeHigh(type, seed) {
  const R = rng(seed * 9301 + 49297), m = new MeshBuilder(), X = DETAIL.q >= 3 ? 1.7 : 1;
  const bark = (a, i) => Math.sin(a * 9 + i * 1.7) * 0.05 + Math.sin(a * 23 + i) * 0.025;
  if (type === 'pine') {
    const H = 10 + R() * 6;
    m.lathe(0, -0.5, 0, [[0.52, 0], [0.4, 0.5], [0.36, 1.2], [0.31, H * 0.3], [0.2, H * 0.62], [0.08, H * 0.9], [0.02, H]], 16, (i) => mixc(C.barkD, C.barkL, (i % 2) * 0.35 + i / 14), 0, bark);
    for (let k = 0; k < 7; k++) { const a = k / 7 * TAU + R(); m.tube([Math.cos(a) * 0.1, 0.5, Math.sin(a) * 0.1], [Math.cos(a) * 1.1, -0.2, Math.sin(a) * 1.1], 0.19, 0.04, 7, C.barkD); }
    const whorls = Math.round(13 + R() * 4);
    for (let t = 0; t < whorls; t++) {
      const k = t / whorls, y = H * (0.2 + k * 0.76), L = (1 - k) * (3.1 + R() * 0.5) + 0.45, col = mixc(C.pineD, C.pine, 0.25 + k * 0.6);
      // dense fill cone so the crown never looks hollow
      m.lathe(0, y - 0.45, 0, [[L * 0.78, 0], [L * 0.45, 0.45], [0.05, 1.5 + (1 - k)]], 14, () => jit(mixc(col, C.pineD, 0.35), R, 0.1), 0, (a) => Math.sin(a * 7 + t) * 0.12);
      const boughs = Math.round((6 + (1 - k) * 4) * (X > 1 ? 1.3 : 1));
      for (let b = 0; b < boughs; b++) {
        const a = b / boughs * TAU + t * 0.9 + R() * 0.3, Lb = L * (0.8 + R() * 0.3), droop = 0.35 + R() * 0.35;
        const tip = [Math.cos(a) * Lb, y - droop * Lb * 0.45, Math.sin(a) * Lb], mid = [Math.cos(a) * Lb * 0.55, y + 0.05, Math.sin(a) * Lb * 0.55];
        m.tube([0, y, 0], mid, 0.05 * (1 - k * 0.5), 0.03, 4, C.barkD, () => sway(0.02)); m.tube(mid, tip, 0.03, 0.012, 4, C.bark, (q) => sway(0.03 + q * 0.05));
        const sprays = Math.round(7 * X);
        for (let n = 0; n < sprays; n++) {
          const q = 0.25 + n / sprays * 0.8, p = [mid[0] + (tip[0] - mid[0]) * (q - 0.25) / 0.8 + (R() - 0.5) * 0.3, mid[1] + (tip[1] - mid[1]) * (q - 0.25) / 0.8 + (R() - 0.3) * 0.25, mid[2] + (tip[2] - mid[2]) * (q - 0.25) / 0.8 + (R() - 0.5) * 0.3];
          leafCard(m, p, norm([Math.cos(a) * 0.4, 1, Math.sin(a) * 0.4]), 0.55 + R() * 0.25, 0.42, jit(mixc(col, C.pineL, R() * 0.45), R, 0.12), 0.06 + k * 0.06, R, 0.9);
        }
      }
    }
    return { mb: m, r: 0.5, h: H };
  }
  if (type === 'oak' || type === 'birch') {
    const birch = type === 'birch', H = birch ? 8 + R() * 3 : 7 + R() * 3, tr = birch ? 0.26 : 0.58;
    const barkC = i => birch ? (i % 3 === 1 ? mixc(C.birch, C.birchD, 0.55) : mixc(C.birch, C.birchD, 0.06 * (i % 2))) : mixc(C.barkD, C.barkL, (i % 2) * 0.3 + i / 16);
    m.lathe(0, -0.5, 0, [[tr * 1.9, 0], [tr * 1.25, 0.4], [tr * 1.05, 1.2], [tr * 0.95, H * 0.3], [tr * 0.8, H * 0.5], [tr * 0.6, H * 0.72], [tr * 0.35, H * 0.85]], 18, barkC, 0, (a, i) => birch ? bark(a, i) * 0.4 : bark(a, i) * 1.6);
    if (!birch) for (let k = 0; k < 8; k++) { const a = k / 8 * TAU + R() * 0.3; m.tube([Math.cos(a) * tr * 0.6, 0.6, Math.sin(a) * tr * 0.6], [Math.cos(a) * tr * 2.6, -0.25, Math.sin(a) * tr * 2.6], tr * 0.42, tr * 0.08, 8, C.barkD); }
    if (birch) for (let k = 0; k < 16; k++) { const y = 0.5 + R() * H * 0.75, a = R() * TAU; m.box(Math.cos(a) * tr * 0.97, y, Math.sin(a) * tr * 0.97, 0.16, 0.04, 0.16, C.birchD); }
    const clusters = [], main = birch ? 5 : 6 + Math.floor(R() * 2);
    for (let b = 0; b < main; b++) {
      const a = b / main * TAU + R() * 0.7, y0 = H * (0.42 + R() * 0.3), L = (birch ? 2 : 3) + R() * 1.4;
      const end = [Math.cos(a) * L, y0 + L * (0.45 + R() * 0.35), Math.sin(a) * L];
      m.tube([0, y0, 0], end, tr * 0.45, tr * 0.14, 9, birch ? C.birch : C.bark, (q) => q ? sway(0.04) : 0);
      for (let s2 = 0; s2 < 3; s2++) { const q = 0.45 + s2 * 0.2, base = [end[0] * q, y0 + (end[1] - y0) * q, end[2] * q], a2 = a + (R() - 0.5) * 1.8, L2 = 1.1 + R() * 0.9, e2 = [base[0] + Math.cos(a2) * L2, base[1] + 0.5 + R() * 0.8, base[2] + Math.sin(a2) * L2];
        m.tube(base, e2, tr * 0.16, tr * 0.05, 6, birch ? C.birch : C.bark, () => sway(0.06)); clusters.push([e2, 1.05 + R() * 0.35]); }
      clusters.push([end, 1.35 + R() * 0.4]);
    }
    clusters.push([[0, H * 0.98, 0], 1.7]); clusters.push([[(R() - 0.5) * 1.5, H * 0.86, (R() - 0.5) * 1.5], 1.5]);
    const base = birch ? C.birchLeaf : C.oak, hi = birch ? C.birchLeafL : C.oakL;
    for (const [c, r] of clusters) {
      const rr = r * (birch ? 0.85 : 1);
      m.ico(c[0], c[1], c[2], rr * 0.82, rr * 0.62, rr * 0.82, 1, u => 1 + Math.sin(u[0] * 7 + c[0]) * 0.1, (p, n) => jit(mixc(C.oakD, base, 0.35 + n[1] * 0.3), R, 0.08), () => sway(0.05));
      const cards = Math.round((birch ? 46 : 58) * X * rr);
      for (let i = 0; i < cards; i++) {
        const u = norm([R() * 2 - 1, R() * 1.6 - 0.5, R() * 2 - 1]), d = rr * (0.75 + R() * 0.45), p = [c[0] + u[0] * d, c[1] + u[1] * d * 0.78, c[2] + u[2] * d];
        const lt = Math.max(0, Math.min(1, 0.45 + u[1] * 0.45 + (R() - 0.5) * 0.3));
        leafCard(m, p, u, (birch ? 0.3 : 0.42) + R() * 0.16, (birch ? 0.36 : 0.46) + R() * 0.14, jit(mixc(mixc(C.oakD, base, 0.6), hi, lt), R, 0.1), 0.06 + Math.max(0, p[1] - H * 0.4) * 0.012, R, birch ? 1.1 : 0.5);
      }
    }
    return { mb: m, r: tr, h: H + 2 };
  }
  // dead tree, detailed
  const H = 6 + R() * 3;
  m.lathe(0, -0.4, 0, [[0.45, 0], [0.32, 0.5], [0.26, H * 0.4], [0.16, H * 0.75], [0.04, H]], 14, (i) => mixc(hex('#3b342d'), hex('#7a7065'), (i % 2) * 0.4 + i / 14), 0, (a, i) => bark(a, i) * 1.4);
  for (let b = 0; b < 7; b++) { const a = R() * TAU, y0 = H * (0.3 + R() * 0.55), L = 1.2 + R() * 1.6, e = [Math.cos(a) * L, y0 + L * 0.7, Math.sin(a) * L]; m.tube([0, y0, 0], e, 0.11, 0.025, 7, hex('#5b5249')); m.tube(e, [e[0] + Math.cos(a + 0.8) * 0.7, e[1] + 0.5, e[2] + Math.sin(a + 0.8) * 0.7], 0.025, 0.008, 4, hex('#6b6258')); }
  return { mb: m, r: 0.32, h: H };
}
/** distant-LOD tree: same silhouette and palette, ~1/8 of the triangles */
function treeLow(type, seed) {
  const R = rng(seed * 9301 + 49297), m = new MeshBuilder();
  if (type === 'pine') {
    const H = 9 + R() * 5; m.cyl(0, -0.4, 0, 0.4, 0.06, H, 5, C.bark, 0, false);
    for (let t = 0; t < 4; t++) { const k = t / 4, y = H * (0.25 + k * 0.62), r = (1 - k) * 2.8 + 0.5; m.lathe(0, y - 0.3, 0, [[r, 0], [0.05, 2.2 + (1 - k)]], 6, () => jit(mixc(C.pineD, C.pine, 0.3 + k * 0.6), R)); }
    return { mb: m, r: 0.42, h: H };
  }
  if (type === 'oak' || type === 'birch') {
    const birch = type === 'birch', H = birch ? 7 + R() * 3 : 6 + R() * 3, tr = birch ? 0.24 : 0.5;
    m.cyl(0, -0.4, 0, tr * 1.2, tr * 0.6, H * 0.85, 5, birch ? C.birch : C.bark, 0, false);
    for (let k = 0; k < 3; k++) { const a = k * 2.1 + R(), d = k === 2 ? 0 : 1.4; const rr = (birch ? 1.6 : 2.4) + R() * 0.6; m.ico(Math.cos(a) * d, H * (0.8 + k * 0.1), Math.sin(a) * d, rr * 1.1, rr * 0.85, rr * 1.1, 0, u => 1, (p, n) => jit(mixc(C.oakD, birch ? C.birchLeafL : C.oakL, 0.35 + n[1] * 0.35), R, 0.08)); }
    return { mb: m, r: tr, h: H + 2 };
  }
  const H = 5 + R() * 3; m.cyl(0, -0.3, 0, 0.3, 0.05, H, 5, hex('#5b5249'), 0, false); return { mb: m, r: 0.3, h: H };
}
// ------------------------------------------------------------------ rocks & ore
export function rock(type, seed, lod = 0) {
  const R = rng(seed * 7919 + 13), m = new MeshBuilder(), sd = R() * 100;
  const big = type === 'boulder', ore = type === 'metal';
  const rx = big ? 3 + R() * 2 : 1.2 + R() * 0.5, ry = big ? 2 + R() * 1.5 : 0.9 + R() * 0.4, rz = big ? 2.6 + R() * 2 : 1.1 + R() * 0.5;
  const disp = u => { let k = 1 + Math.sin(u[0] * 3.1 + sd) * 0.12 + Math.sin(u[1] * 5.3 + u[2] * 4.1 + sd) * 0.08 + Math.sin(u[2] * 11 + u[0] * 9 + sd) * 0.035 + Math.sin(u[0] * 23 + u[1] * 19 + sd) * 0.012 + Math.abs(Math.sin(u[1] * 7 + sd)) * -0.04; const flat = Math.max(0, -u[1] - 0.25); return k * (1 - flat * 0.6); };
  const sub = lod ? 1 : DETAIL.q >= 3 ? (big ? 4 : 4) : DETAIL.q >= 2 ? 3 : (big ? 3 : 2);
  const disp2 = DETAIL.q >= 2 && !lod ? u => disp(u) * (1 + Math.abs(Math.sin(u[1] * 13 + Math.sin(u[0] * 5 + sd) * 1.5)) * 0.035 - Math.max(0, Math.sin(u[0] * 17 + u[2] * 11 + sd)) * 0.03) : disp;
  m.ico(0, ry * 0.35, 0, rx, ry, rz, sub, disp2, (p, n, u) => {
    let c = mixc(C.stoneD, C.stoneL, 0.45 + n[1] * 0.35 + Math.sin(p[0] * 4 + p[2] * 3 + sd) * 0.08);
    if (n[1] > 0.6 && !ore) c = mixc(c, C.moss, (n[1] - 0.6) * 1.3 * (0.5 + 0.5 * Math.sin(p[0] * 2 + sd)));
    if (ore) { const v = Math.sin(u[0] * 9 + sd) * Math.sin(u[1] * 7 + u[2] * 8 + sd * 2); if (v > 0.25) c = mixc(C.ore, C.oreL, v); }
    return jit(c, R, 0.06);
  }, p => 0);
  if (!big && !lod) for (let k = 0; k < 3; k++) { const a = R() * TAU, d = rx * (0.9 + R() * 0.4); m.ico(Math.cos(a) * d, 0.05, Math.sin(a) * d, 0.25 + R() * 0.2, 0.18, 0.25, 1, null, () => jit(C.stoneD, R, 0.1)); }
  return { mb: m, r: Math.max(rx, rz) * 0.85, h: ry * 1.4 };
}

// ------------------------------------------------------------------ small plants / pickups
export function plant(type, seed) {
  const R = rng(seed * 104729 + 7), m = new MeshBuilder();
  if (type === 'hemp') {
    for (let k = 0; k < 7; k++) {
      const a = R() * TAU, d = R() * 0.25, h = 1.1 + R() * 0.6, x = Math.cos(a) * d, z = Math.sin(a) * d, top = [x + (R() - 0.5) * 0.2, h, z + (R() - 0.5) * 0.2];
      m.tube([x, -0.05, z], top, 0.025, 0.012, 4, C.hemp, t => t ? sway(0.12) : 0);
      for (let l = 0; l < 4; l++) { const y = h * (0.35 + l * 0.17), la = R() * TAU, L = 0.32; const p0 = [x + (top[0] - x) * y / h, y, z + (top[2] - z) * y / h], p1 = [p0[0] + Math.cos(la) * L, y + 0.08, p0[2] + Math.sin(la) * L], pm = [p0[0] + Math.cos(la + 0.4) * L * 0.5, y + 0.1, p0[2] + Math.sin(la + 0.4) * L * 0.5], pn = [p0[0] + Math.cos(la - 0.4) * L * 0.5, y + 0.02, p0[2] + Math.sin(la - 0.4) * L * 0.5];
        m.vert(p0, [0, 1, 0], C.hemp, sway(0.1)); m.vert(pm, [0, 1, 0], C.hempL, sway(0.13)); m.vert(p1, [0, 1, 0], C.hempL, sway(0.16)); m.vert(p0, [0, 1, 0], C.hemp, sway(0.1)); m.vert(p1, [0, 1, 0], C.hempL, sway(0.16)); m.vert(pn, [0, 1, 0], C.hemp, sway(0.13)); }
    }
    return { mb: m, h: 1.6 };
  }
  if (type === 'berry') {
    for (let k = 0; k < 6; k++) { const a = R() * TAU, d = R() * 0.5; const cx = Math.cos(a) * d, cz = Math.sin(a) * d; m.ico(cx, 0.45 + R() * 0.3, cz, 0.5, 0.42, 0.5, 1, u => 1 + Math.sin(u[0] * 8 + k) * 0.12, (p, n) => jit(mixc(C.oakD, C.oak, 0.4 + n[1] * 0.4), R), () => sway(0.05)); }
    for (let k = 0; k < 16; k++) { const a = R() * TAU, d = 0.35 + R() * 0.4, y = 0.3 + R() * 0.6; m.ell(Math.cos(a) * d, y, Math.sin(a) * d, 0.055, 0.055, 0.055, jit(C.berry, R, 0.2), 0.08, 6, 4); }
    return { mb: m, h: 1 };
  }
  if (type === 'stump') {
    m.lathe(0, -0.1, 0, [[0.5, 0], [0.42, 0.3], [0.4, 0.55]], 10, i => mixc(C.barkD, C.bark, i / 2), 0, (a) => Math.sin(a * 5) * 0.06);
    m.cyl(0, 0.54, 0, 0.38, 0.38, 0.02, 10, C.woodL);
    m.tube([0.2, 0.15, 0], [1.6, 0.25, 0.4], 0.16, 0.13, 7, C.bark, 0, true);
    return { mb: m, h: 0.6 };
  }
  // stones pile
  for (let k = 0; k < 6; k++) { const a = R() * TAU, d = R() * 0.45; m.ico(Math.cos(a) * d, 0.1, Math.sin(a) * d, 0.22 + R() * 0.12, 0.15 + R() * 0.08, 0.22, 1, u => 1 + Math.sin(u[0] * 5 + k) * 0.1, (p, n) => jit(mixc(C.stoneD, C.stoneL, 0.4 + n[1] * 0.4), R)); }
  return { mb: m, h: 0.35 };
}

export function crate(tier) {
  const m = new MeshBuilder(), w = C.wood, d = C.woodD;
  m.box(0, 0.4, 0, 1.1, 0.78, 0.8, mixc(w, d, 0.2));
  for (let k = -1; k <= 1; k++) { m.box(k * 0.36, 0.4, 0.41, 0.34, 0.72, 0.03, k ? w : C.woodL); m.box(k * 0.36, 0.4, -0.41, 0.34, 0.72, 0.03, k ? C.woodL : w); }
  for (const x of [-0.53, 0.53]) for (const z of [-0.38, 0.38]) m.box(x, 0.4, z, 0.08, 0.82, 0.08, tier > 1 ? C.metalD : d);
  m.box(0, 0.8, 0, 1.14, 0.05, 0.84, tier > 1 ? C.metal : mixc(w, d, 0.4));
  if (tier > 1) { m.box(0, 0.55, 0.43, 0.2, 0.12, 0.03, hex('#c9a34a'), 0.15); }
  return m;
}
export function barrel() {
  const m = new MeshBuilder(), b = hex('#3d5566'), r = C.rust;
  m.lathe(0, 0, 0, [[0.38, 0], [0.43, 0.15], [0.45, 0.5], [0.43, 0.85], [0.38, 1.0]], 14, i => i % 2 ? mixc(b, r, 0.35) : b);
  m.cyl(0, 1.0, 0, 0.38, 0.38, 0.01, 14, mixc(b, r, 0.5));
  for (const y of [0.16, 0.84]) m.cyl(0, y - 0.025, 0, 0.455, 0.455, 0.05, 14, C.metalD, 0, false);
  return m;
}

// ------------------------------------------------------------------ POIs (geometry + collision boxes)
export function poi(kind, seed) {
  const R = rng(seed), m = new MeshBuilder(), boxes = [];
  const solid = (cx, cy, cz, sx, sy, sz, col, ry = 0) => { const c = Math.cos(ry), s = Math.sin(ry); m.obox([cx, cy, cz], [c, 0, -s], [0, 1, 0], [s, 0, c], sx / 2, sy / 2, sz / 2, col); boxes.push({ c: [cx, cy, cz], h: [sx / 2, sy / 2, sz / 2], ry }); };
  const ruinedWall = (x0, z0, x1, z1, H, col) => {
    const L = Math.hypot(x1 - x0, z1 - z0), n = Math.max(2, Math.round(L / 1.2)), ry = -Math.atan2(z1 - z0, x1 - x0);
    for (let i = 0; i < n; i++) { const t = (i + 0.5) / n, h = H * (0.35 + R() * 0.65) * (R() < 0.15 ? 0.2 : 1); solid(x0 + (x1 - x0) * t, h / 2 - 0.3, z0 + (z1 - z0) * t, L / n + 0.02, h + 0.3, 0.45, jit(col, R, 0.1), ry); }
  };
  if (kind === 'ruin') {
    solid(0, -0.2, 0, 16, 0.6, 12, C.concreteD);
    ruinedWall(-8, -6, 8, -6, 4.5, C.concrete); ruinedWall(-8, -6, -8, 6, 4, C.concrete); ruinedWall(8, -6, 8, 1, 3.5, C.concrete); ruinedWall(-8, 6, -1, 6, 3, C.concrete);
    ruinedWall(-2, -6, -2, 1, 3, C.concrete);
    for (let k = 0; k < 7; k++) m.ico((R() - 0.5) * 18, 0.15, (R() - 0.5) * 14, 0.5 + R() * 0.6, 0.3, 0.5 + R() * 0.5, 1, u => 1 + Math.sin(u[0] * 6 + k) * 0.15, (p, n) => jit(mixc(C.concreteD, C.concrete, 0.5 + n[1] * 0.3), R));
    for (let k = 0; k < 8; k++) { const x = (R() - 0.5) * 14, z = (R() - 0.5) * 10; m.tube([x, 0, z], [x + (R() - 0.5) * 0.8, 1 + R() * 1.5, z + (R() - 0.5) * 0.8], 0.03, 0.03, 4, C.rust); }
  } else if (kind === 'outpost') {
    // timber shack, fence, watchtower
    solid(0, -0.15, 0, 7, 0.4, 5, C.woodD);
    for (const [x0, z0, x1, z1] of [[-3.5, -2.5, 3.5, -2.5], [-3.5, 2.5, -1, 2.5], [1, 2.5, 3.5, 2.5], [-3.5, -2.5, -3.5, 2.5], [3.5, -2.5, 3.5, 2.5]]) {
      const L = Math.hypot(x1 - x0, z1 - z0), ry = -Math.atan2(z1 - z0, x1 - x0); solid((x0 + x1) / 2, 1.4, (z0 + z1) / 2, L + 0.15, 2.8, 0.15, jit(C.plank, R), ry);
      for (let k = 0; k < 4; k++) { const t = (k + 0.5) / 4; m.box(x0 + (x1 - x0) * t, 1.4 + (k % 2 ? 0.4 : -0.5), z0 + (z1 - z0) * t, 0.12 + Math.abs(Math.sin(ry)) * L / 4, 0.06, 0.12 + Math.abs(Math.cos(ry)) * L / 4, C.woodD); }
    }
    m.obox([0, 3.2, -1.2], [1, 0, 0], norm([0, 1, 0.45]), norm([0, -0.45, 1]), 3.9, 0.08, 1.6, C.rust); m.obox([0, 3.2, 1.2], [1, 0, 0], norm([0, 1, -0.45]), norm([0, 0.45, 1]), 3.9, 0.08, 1.6, mixc(C.rust, C.metalD, 0.4));
    const tx = 7, tz = -4; for (const [dx, dz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) { m.tube([tx + dx * 1.2, -0.5, tz + dz * 1.2], [tx + dx * 0.9, 6.5, tz + dz * 0.9], 0.12, 0.1, 6, C.woodD); boxes.push({ c: [tx + dx * 1.05, 3, tz + dz * 1.05], h: [0.15, 3.5, 0.15], ry: 0 }); }
    for (let y = 1.5; y < 6; y += 1.6) m.box(tx, y, tz, 2.3, 0.08, 0.08, C.woodD), m.box(tx, y + 0.8, tz, 0.08, 0.08, 2.3, C.woodD);
    solid(tx, 6.5, tz, 2.6, 0.15, 2.6, C.plank); m.box(tx, 7.1, tz - 1.25, 2.6, 1.1, 0.08, C.plank); m.box(tx - 1.25, 7.1, tz, 0.08, 1.1, 2.6, C.plank);
    for (let k = 0; k < 14; k++) { const a = k / 14 * TAU, r = 12 + Math.sin(k * 3) * 1.5; if (k === 3 || k === 4) continue; m.tube([Math.cos(a) * r, -0.3, Math.sin(a) * r], [Math.cos(a) * r, 1.6 + R() * 0.3, Math.sin(a) * r], 0.09, 0.07, 5, C.woodD); const a2 = (k + 1) / 14 * TAU, r2 = 12 + Math.sin((k + 1) * 3) * 1.5; m.tube([Math.cos(a) * r, 1.1, Math.sin(a) * r], [Math.cos(a2) * r2, 1.1, Math.sin(a2) * r2], 0.05, 0.05, 4, C.wood); }
  } else if (kind === 'camp') {
    for (let k = 0; k < 3; k++) {
      const a = k * 2.1 + R(), d = 5, x = Math.cos(a) * d, z = Math.sin(a) * d, ry = -a + Math.PI / 2, c = Math.cos(ry), s = Math.sin(ry), col = jit(k % 2 ? C.cloth : hex('#5d6a4a'), R);
      const P = (lx, ly, lz) => [x + lx * c + lz * s, ly, z - lx * s + lz * c];
      m.quad(P(-1.3, 0, -1.5), P(-1.3, 0, 1.5), P(0, 1.8, 1.5), P(0, 1.8, -1.5), col); m.quad(P(1.3, 0, 1.5), P(1.3, 0, -1.5), P(0, 1.8, -1.5), P(0, 1.8, 1.5), mixc(col, [0, 0, 0], 0.15));
      m.tri(P(-1.3, 0, -1.5), P(0, 1.8, -1.5), P(1.3, 0, -1.5), mixc(col, [0, 0, 0], 0.25));
      boxes.push({ c: [x, 0.8, z], h: [1.2, 0.9, 1.5], ry });
    }
    for (let k = 0; k < 8; k++) { const a = k / 8 * TAU; m.ico(Math.cos(a) * 0.8, 0.1, Math.sin(a) * 0.8, 0.22, 0.16, 0.22, 1, null, () => jit(C.stoneD, R)); }
    for (let k = 0; k < 4; k++) { const a = k / 4 * TAU + 0.4; m.tube([Math.cos(a) * 0.5, 0.05, Math.sin(a) * 0.5], [-Math.cos(a) * 0.1, 0.45, -Math.sin(a) * 0.1], 0.07, 0.05, 5, hex('#2a2420')); }
    for (const a of [0.8, 2.6, 4.4]) m.tube([Math.cos(a) * 2.4 - 0.9, 0.2, Math.sin(a) * 2.4], [Math.cos(a) * 2.4 + 0.9, 0.2, Math.sin(a) * 2.4], 0.2, 0.2, 7, C.bark, 0, true);
  } else { // tower: steel lattice mast
    solid(0, -0.2, 0, 5, 0.6, 5, C.concreteD);
    const H = 22;
    for (const [dx, dz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) { m.tube([dx * 1.8, 0, dz * 1.8], [dx * 0.4, H, dz * 0.4], 0.09, 0.06, 5, C.metalD); boxes.push({ c: [dx * 1.6, 2, dz * 1.6], h: [0.15, 2.5, 0.15], ry: 0 }); }
    for (let y = 0; y < H - 2; y += 2.2) { const k0 = 1.8 - y / H * 1.4, k1 = 1.8 - (y + 2.2) / H * 1.4; for (const [a, b] of [[[-1, -1], [1, -1]], [[1, -1], [1, 1]], [[1, 1], [-1, 1]], [[-1, 1], [-1, -1]]]) { m.tube([a[0] * k0, y, a[1] * k0], [b[0] * k1, y + 2.2, b[1] * k1], 0.035, 0.035, 4, C.metal); } }
    m.ell(0, H + 0.4, 0, 0.25, 0.25, 0.25, hex('#ff3a20'), 0.9, 8, 6);
  }
  return { mb: m, boxes };
}

// ------------------------------------------------------------------ building pieces (cell 3m, wall 3m)
export const CELL_S = 3, WALL_H = 3;
const tierMat = t => [[hex('#9a7a52'), hex('#6e5536')], [C.plank, C.woodD], [C.stone, C.stoneD], [C.metal, C.metalD]][t];
function panel(m, x0, x1, y0, y1, z, th, tier, R) {
  // a flat panel in the XY plane, centred on z, styled by tier
  const [a, b] = tierMat(tier), w = x1 - x0, h = y1 - y0;
  if (w <= 0.01 || h <= 0.01) return;
  if (tier === 0) { // twig: frame + crossed sticks
    for (const x of [x0 + 0.06, x1 - 0.06]) m.box(x, (y0 + y1) / 2, z, 0.1, h, 0.1, b);
    for (const y of [y0 + 0.06, y1 - 0.06, (y0 + y1) / 2]) m.box((x0 + x1) / 2, y, z, w, 0.08, 0.08, a);
    const L = Math.hypot(w, h); m.tube([x0, y0, z], [x1, y1, z], 0.04, 0.04, 4, a); m.tube([x0, y1, z], [x1, y0, z], 0.04, 0.04, 4, a);
    return L;
  }
  if (tier === 1) { // vertical planks with gaps + horizontal battens
    const n = Math.max(1, Math.round(w / 0.3)); for (let i = 0; i < n; i++) { const px = x0 + (i + 0.5) * w / n; m.box(px, (y0 + y1) / 2, z, w / n - 0.02, h, th, jit(i % 3 ? a : mixc(a, b, 0.3), R, 0.12)); }
    for (const y of [y0 + h * 0.2, y1 - h * 0.2]) m.box((x0 + x1) / 2, y, z + th * 0.7, w, 0.14, 0.05, b), m.box((x0 + x1) / 2, y, z - th * 0.7, w, 0.14, 0.05, b);
    return;
  }
  if (tier === 2) { // running-bond masonry
    const rows = Math.max(1, Math.round(h / 0.42)); for (let r = 0; r < rows; r++) { const yy = y0 + (r + 0.5) * h / rows, off = r % 2 ? 0.45 : 0; let x = x0 - off; while (x < x1 - 0.01) { const xa = Math.max(x0, x), xb = Math.min(x1, x + 0.9); if (xb - xa > 0.05) m.box((xa + xb) / 2, yy, z, xb - xa - 0.03, h / rows - 0.03, th, jit(a, R, 0.16)); x += 0.9; } }
    m.box((x0 + x1) / 2, (y0 + y1) / 2, z, w - 0.02, h - 0.02, th * 0.8, b);
    return;
  }
  // metal: corrugated sheets + ribs + rivets
  const n = Math.max(1, Math.round(w / 1)); for (let i = 0; i < n; i++) { const px = x0 + (i + 0.5) * w / n; m.box(px, (y0 + y1) / 2, z, w / n - 0.03, h - 0.02, th, jit(i % 2 ? a : mixc(a, C.rust, 0.18), R, 0.08)); }
  for (const y of [y0 + 0.1, y1 - 0.1, (y0 + y1) / 2]) m.box((x0 + x1) / 2, y, z, w, 0.1, th + 0.06, b);
  for (let i = 0; i <= n; i++) for (const y of [y0 + 0.1, y1 - 0.1]) m.box(x0 + i * w / n, y, z, 0.05, 0.05, th + 0.1, C.metalL);
}
export function piece(type, tier, seed = 1) {
  const R = rng(seed * 31 + tier * 7 + 3), m = new MeshBuilder(), S = CELL_S, H = WALL_H, h = S / 2, [a, b] = tierMat(tier);
  if (type === 'foundation' || type === 'floor') {
    const th = type === 'foundation' ? 1.4 : 0.18;
    if (tier === 0) { m.box(0, -th / 2, 0, S, th, S, mixc(a, b, 0.3)); for (let i = 0; i < 6; i++) m.box(-h + (i + 0.5) * S / 6, 0.01, 0, 0.12, 0.04, S, b); }
    else if (tier === 1) { m.box(0, -th / 2 - 0.02, 0, S, th - 0.04, S, b); for (let i = 0; i < 10; i++) m.box(-h + (i + 0.5) * S / 10, -0.02, 0, S / 10 - 0.02, 0.06, S, jit(a, R, 0.14)); }
    else if (tier === 2) { m.box(0, -th / 2, 0, S, th, S, b); for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) m.box(-h + (i + 0.5) * S / 4, 0.01, -h + (j + 0.5) * S / 4, S / 4 - 0.05, 0.04, S / 4 - 0.05, jit(a, R, 0.12)); }
    else { m.box(0, -th / 2, 0, S, th, S, b); m.box(0, 0.005, 0, S - 0.1, 0.03, S - 0.1, a); for (let i = 0; i < 6; i++) m.box(-h + (i + 0.5) * S / 6, 0.03, 0, 0.04, 0.02, S - 0.2, C.metalL); }
    if (type === 'foundation') for (const x of [-h + 0.2, h - 0.2]) for (const z of [-h + 0.2, h - 0.2]) m.box(x, -th - 0.6, z, 0.35, 1.4, 0.35, b);
    return m;
  }
  if (type === 'wall' || type === 'doorway' || type === 'window') {
    const th = tier === 0 ? 0.1 : 0.2;
    if (type === 'wall') panel(m, -h, h, 0, H, 0, th, tier, R);
    if (type === 'doorway') { panel(m, -h, -0.55, 0, H, 0, th, tier, R); panel(m, 0.55, h, 0, H, 0, th, tier, R); panel(m, -0.55, 0.55, 2.2, H, 0, th, tier, R); m.box(0, 2.2, 0, 1.2, 0.12, th + 0.08, b); }
    if (type === 'window') { panel(m, -h, -0.6, 0, H, 0, th, tier, R); panel(m, 0.6, h, 0, H, 0, th, tier, R); panel(m, -0.6, 0.6, 0, 1.1, 0, th, tier, R); panel(m, -0.6, 0.6, 2.1, H, 0, th, tier, R); for (const x of [-0.2, 0.2]) m.box(x, 1.6, 0, 0.06, 1, 0.06, C.metalD); }
    return m;
  }
  if (type === 'roof') {
    const th = 0.14, top = [0, 1.25, 0], c = [[-h, 0, -h], [h, 0, -h], [h, 0, h], [-h, 0, h]];
    for (let i = 0; i < 4; i++) { const p = c[i], q = c[(i + 1) % 4]; m.tri(p, q, top, i % 2 ? a : mixc(a, b, 0.25)); m.tri([p[0], p[1] - th, p[2]], top, [q[0], q[1] - th, q[2]], b); m.quad(p, [p[0], p[1] - th, p[2]], [q[0], q[1] - th, q[2]], q, b); }
    if (tier > 0) for (let i = 0; i < 4; i++) { const p = c[i]; m.tube([p[0], 0.02, p[2]], [0, 1.27, 0], 0.05, 0.05, 4, b); }
    return m;
  }
  if (type === 'stairs') {
    const steps = 10; for (let i = 0; i < steps; i++) { const y = (i + 1) * H / steps, z = h - (i + 0.5) * S / steps; m.box(0, y - 0.06, z, 1.4, 0.12, S / steps + 0.02, jit(a, R, 0.1)); m.box(0, y / 2, z, 1.3, y, S / steps * 0.9, b); }
    for (const x of [-0.75, 0.75]) m.obox([x, H / 2 + 0.4, 0], [1, 0, 0], norm([0, 1, 1]), norm([0, -1, 1]), 0.05, 0.06, S * 0.72, b);
    return m;
  }
  // pillar
  m.box(0, H / 2, 0, 0.32, H, 0.32, a); m.box(0, 0.08, 0, 0.42, 0.16, 0.42, b); m.box(0, H - 0.08, 0, 0.42, 0.16, 0.42, b);
  return m;
}

// ------------------------------------------------------------------ deployables
export function deployable(kind, opt = {}) {
  const m = new MeshBuilder(), R = rng(7);
  if (kind === 'campfire') {
    for (let k = 0; k < 9; k++) { const a = k / 9 * TAU; m.ico(Math.cos(a) * 0.6, 0.08, Math.sin(a) * 0.6, 0.17, 0.13, 0.17, 1, null, (p, n) => jit(mixc(C.stoneD, C.stone, 0.4 + n[1] * 0.4), R)); }
    for (let k = 0; k < 5; k++) { const a = k / 5 * TAU; m.tube([Math.cos(a) * 0.45, 0.04, Math.sin(a) * 0.45], [0, 0.48, 0], 0.06, 0.035, 5, k % 2 ? hex('#2a2420') : C.bark); }
    m.cyl(0, 0, 0, 0.38, 0.3, 0.06, 10, hex('#1e1a17'));
    return m;
  }
  if (kind === 'furnace') {
    m.lathe(0, 0, 0, [[0.75, 0], [0.78, 0.2], [0.7, 0.9], [0.5, 1.3], [0.25, 1.5], [0.22, 2.0]], 10, i => jit(mixc(C.stoneD, C.stone, i / 5), R, 0.1));
    for (let i = 0; i < 4; i++) { const y = 0.2 + i * 0.3; m.cyl(0, y, 0, 0.79 - i * 0.03, 0.77 - i * 0.03, 0.04, 10, C.stoneD, 0, false); }
    m.box(0, 0.45, 0.68, 0.45, 0.36, 0.12, hex('#191513')); m.box(0, 0.45, 0.72, 0.36, 0.26, 0.04, hex('#ff6a2a'), 0.7);
    return m;
  }
  if (kind === 'box') {
    const s = opt.big ? 1.35 : 1;
    m.box(0, 0.35 * s, 0, 1.0 * s, 0.6 * s, 0.6 * s, C.woodD);
    for (let i = 0; i < 3; i++) m.box(0, (0.12 + i * 0.2) * s, 0.305 * s, 0.98 * s, 0.17 * s, 0.02, jit(C.plank, R, 0.15)), m.box(0, (0.12 + i * 0.2) * s, -0.305 * s, 0.98 * s, 0.17 * s, 0.02, jit(C.plank, R, 0.15));
    m.box(0, 0.66 * s, 0, 1.04 * s, 0.06 * s, 0.64 * s, C.wood); m.box(0, 0.5 * s, 0.32 * s, 0.12, 0.12, 0.03, opt.big ? C.metalL : C.metalD);
    for (const x of [-0.5, 0.5]) m.box(x * s, 0.35 * s, 0, 0.05, 0.62 * s, 0.62 * s, C.metalD);
    return m;
  }
  if (kind === 'bench') {
    const L = opt.level || 1, top = L > 1 ? C.metal : C.plank;
    m.box(0, 0.9, 0, 2, 0.1, 0.9, top); for (const x of [-0.9, 0.9]) for (const z of [-0.38, 0.38]) m.box(x, 0.45, z, 0.1, 0.9, 0.1, L > 1 ? C.metalD : C.woodD);
    m.box(0, 0.25, 0, 1.8, 0.05, 0.8, C.woodD); m.box(-0.5, 1.0, -0.15, 0.3, 0.1, 0.2, C.metalD); m.tube([0.3, 0.97, 0.1], [0.7, 0.97, -0.05], 0.03, 0.03, 5, C.wood); m.box(0.72, 1.0, -0.06, 0.12, 0.08, 0.04, C.metalL);
    m.box(0, 1.5, -0.42, 2, 1.1, 0.06, L > 1 ? C.metalD : C.woodD); for (let i = 0; i < 5; i++) m.box(-0.8 + i * 0.4, 1.55, -0.38, 0.05, 0.4 + (i % 2) * 0.2, 0.05, C.metalL);
    if (L > 1) { m.lathe(0.75, 0.95, 0.2, [[0.1, 0], [0.1, 0.3], [0.04, 0.35]], 8, () => hex('#a33')); }
    return m;
  }
  if (kind === 'bag') { m.ell(0, 0.08, 0, 0.42, 0.09, 0.95, hex('#5c6b3e'), 0, 12, 6); m.lathe(0, 0.0, -0.85, [[0.18, 0], [0.18, 0.84]], 10, () => hex('#4a5632')); return m; }
  if (kind === 'door') {
    const t = opt.tier || 1, col = t > 1 ? C.metal : C.plank;
    if (t > 1) { m.box(0, 1.08, 0, 1.06, 2.16, 0.08, col); for (const y of [0.3, 1.08, 1.86]) m.box(0, y, 0.05, 1.06, 0.1, 0.03, C.metalD); }
    else { for (let i = 0; i < 5; i++) m.box(-0.425 + i * 0.212, 1.08, 0, 0.2, 2.14, 0.07, jit(col, R, 0.15)); m.obox([0, 1.08, 0.045], norm([1, 0.9, 0]), norm([-0.9, 1, 0]), [0, 0, 1], 0.7, 0.06, 0.02, C.woodD); }
    m.box(0.4, 1.05, 0.07, 0.06, 0.16, 0.06, C.metalD);
    return m;
  }
  return m;
}

// ------------------------------------------------------------------ first-person view models (hand space: +x right, +y up, -z forward)
/** first-person arm: sleeve + cuff, forearm, wrist, palm, four curled fingers and a thumb wrapped round the grip */
function armMesh(m, side = 1, grip = [0, 0, 0], open = 0) {
  const [gx, gy, gz] = grip, sl = C.sleeve, sk = C.skin, gl = mixc(C.skin, [0.55, 0.36, 0.28], 0.12);
  const elbow = [gx + side * 0.07, gy - 0.36, gz + 0.46], wrist = [gx + side * 0.012, gy - 0.07, gz + 0.075];
  m.tube(elbow, [gx + side * 0.03, gy - 0.16, gz + 0.2], 0.068, 0.058, 12, sl);
  for (let k = 0; k < 3; k++) { const t = 0.2 + k * 0.25, p = [elbow[0] + (wrist[0] - elbow[0]) * t, elbow[1] + (wrist[1] - elbow[1]) * t, elbow[2] + (wrist[2] - elbow[2]) * t]; m.ell(p[0], p[1], p[2], 0.066 - k * 0.006, 0.02, 0.066 - k * 0.006, mixc(sl, [0, 0, 0], 0.12), 0, 10, 4); }
  m.tube([gx + side * 0.03, gy - 0.16, gz + 0.2], [gx + side * 0.022, gy - 0.115, gz + 0.13], 0.058, 0.062, 12, mixc(sl, [0, 0, 0], 0.2)); // cuff
  m.tube([gx + side * 0.022, gy - 0.115, gz + 0.13], wrist, 0.042, 0.035, 12, sk);
  // palm (back of the hand faces outward)
  m.ell(gx + side * 0.004, gy - 0.02, gz + 0.02, 0.042, 0.05, 0.03, gl, 0, 16, 12);
  m.ell(gx + side * 0.03, gy - 0.025, gz + 0.03, 0.02, 0.032, 0.022, mixc(gl, [0, 0, 0], 0.1), 0, 8, 6); // thenar pad
  for (let f = 0; f < 4; f++) { // fingers: two segments curling over the grip
    const fy = gy + 0.028 - f * 0.022, fx = gx - side * 0.03, c0 = [fx, fy, gz + 0.0], c1 = [fx - side * 0.012, fy - 0.003, gz - 0.032 - open * 0.03], c2 = [gx + side * (0.01 - open * 0.04), fy - 0.006, gz - 0.046 - open * 0.05];
    m.tube(c0, c1, 0.0115, 0.0105, 7, gl, 0, true); m.tube(c1, c2, 0.0105, 0.009, 7, mixc(gl, sk, 0.15), 0, true);
    m.ell(c0[0], c0[1], c0[2], 0.0125, 0.0125, 0.0125, mixc(gl, [0.4, 0.22, 0.18], 0.18), 0, 8, 6); m.ell(c1[0], c1[1], c1[2], 0.0108, 0.0108, 0.0108, mixc(gl, [0.4, 0.22, 0.18], 0.1), 0, 6, 4); m.ell(c2[0], c2[1], c2[2] - 0.004, 0.008, 0.007, 0.006, mixc(sk, [1, 0.9, 0.85], 0.35), 0, 6, 4);
  }
  const t0 = [gx + side * 0.03, gy - 0.01, gz + 0.012], t1 = [gx + side * 0.036, gy + 0.03, gz - 0.02], t2 = [gx + side * 0.02, gy + 0.045, gz - 0.04 - open * 0.03];
  m.tube(t0, t1, 0.014, 0.012, 7, gl, 0, true); m.tube(t1, t2, 0.012, 0.01, 7, mixc(gl, sk, 0.15), 0, true);
}
export function viewModel(model, itemOnly = false) {
  const m = new MeshBuilder(), R = rng(3); const arm = itemOnly ? () => {} : armMesh;
  const handle = (len, col = C.wood) => m.tube([0, -0.06, 0], [0, len, 0], 0.017, 0.015, 7, col, 0, true);
  switch (model) {
    case 'rock': arm(m, 1); m.ico(0, 0.03, -0.075, 0.065, 0.055, 0.07, 2, u => 1 + Math.sin(u[0] * 6) * 0.15 + Math.sin(u[1] * 11 + u[2] * 7) * 0.05, (p, n) => mixc(hex('#3f3d39'), hex('#6e6a63'), 0.35 + n[1] * 0.3)); break;
    case 'torch': arm(m, 1); handle(0.3); m.cyl(0, 0.22, 0, 0.026, 0.03, 0.08, 8, hex('#3a3026')); m.ell(0, 0.32, 0, 0.026, 0.04, 0.026, hex('#ff7a2a'), 0.55, 8, 6); break;
    case 'hatchet_s': case 'hatchet_m': { arm(m, 1); handle(0.42); const met = model === 'hatchet_m';
      if (met) { m.obox([0, 0.36, -0.06], [0, 0, 1], [0, 1, 0], [1, 0, 0], 0.08, 0.05, 0.008, C.metalL); m.box(0, 0.36, 0, 0.04, 0.07, 0.045, C.metalD); }
      else { m.ico(0, 0.36, -0.05, 0.03, 0.045, 0.075, 1, u => 1 + Math.sin(u[2] * 5) * 0.1, () => C.stone); for (let k = 0; k < 3; k++) m.cyl(0, 0.31 + k * 0.035, 0, 0.022, 0.022, 0.02, 7, C.cloth); }
      break; }
    case 'pick_s': case 'pick_m': { arm(m, 1); handle(0.44); const met = model === 'pick_m', col = met ? C.metalL : C.stone;
      m.tube([0, 0.38, 0.0], [0, 0.42, -0.17], 0.025, 0.006, 6, col); m.tube([0, 0.38, 0.0], [0, 0.41, 0.12], 0.025, 0.01, 6, col); m.box(0, 0.38, 0, 0.04, 0.05, 0.05, met ? C.metalD : C.cloth); break; }
    case 'knife': arm(m, 1); m.tube([0, -0.05, 0], [0, 0.07, 0], 0.016, 0.016, 6, C.cloth); m.obox([0, 0.15, 0], [0, 0, 1], [0, 1, 0], [1, 0, 0], 0.016, 0.09, 0.004, hex('#e6dccb')); break;
    case 'hammer': arm(m, 1); handle(0.34); m.box(0, 0.33, 0, 0.05, 0.05, 0.16, C.metalD); m.box(0, 0.33, -0.09, 0.06, 0.06, 0.03, C.metalL); break;
    case 'plan': { arm(m, 1); const X = [1, 0, 0], Y = norm([0, 0.94, 0.34]), Z = norm([0, -0.34, 0.94]); m.obox([0.01, 0.05, -0.07], X, Y, Z, 0.075, 0.003, 0.055, hex('#2d5b8a'));
      const line = (x0, z0, x1, z1) => { const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2; m.obox([0.01 + cx, 0.05 + Y[1] * 0.004 + Z[1] * cz, -0.07 + Y[2] * 0.004 + Z[2] * cz], X, Y, Z, Math.max(0.002, Math.abs(x1 - x0) / 2), 0.001, Math.max(0.002, Math.abs(z1 - z0) / 2), hex('#cfe2f3')); };
      line(-0.05, 0.03, 0.03, 0.03); line(-0.05, -0.03, 0.03, -0.03); line(-0.05, -0.03, -0.05, 0.03); line(0.03, -0.03, 0.03, 0.03); line(-0.01, -0.03, -0.01, 0.0); line(0.045, -0.04, 0.06, -0.04); break; }
    case 'spear_w': case 'spear_s': arm(m, 1); m.tube([0, -0.5, 0], [0, 0.9, 0], 0.016, 0.014, 7, C.woodL, 0, true); if (model === 'spear_s') m.lathe(0, 0.88, 0, [[0.03, 0], [0.035, 0.03], [0, 0.17]], 6, () => C.stone); else m.lathe(0, 0.88, 0, [[0.015, 0], [0, 0.12]], 6, () => C.wood); break;
    case 'machete': arm(m, 1); m.tube([0, -0.06, 0], [0, 0.08, 0], 0.02, 0.018, 7, hex('#2a2a2a')); m.obox([0, 0.27, -0.015], [0, 0, 1], [0, 1, 0], [1, 0, 0], 0.03, 0.2, 0.004, C.metalL); m.obox([0, 0.27, 0.012], [0, 0, 1], [0, 1, 0], [1, 0, 0], 0.006, 0.2, 0.005, C.metalD); break;
    case 'bow': { arm(m, -1, [0, 0, 0]); const pts = []; for (let i = 0; i <= 10; i++) { const t = i / 10 * 2 - 1; pts.push([0, t * 0.5, -0.05 + (1 - t * t) * 0.09]); } for (let i = 0; i < 10; i++) m.tube(pts[i], pts[i + 1], 0.013, 0.013, 6, i > 3 && i < 7 ? C.cloth : C.woodL); m.tube(pts[0], pts[10], 0.002, 0.002, 3, hex('#ddd6c8')); break; }
    case 'crossbow': arm(m, 1, [0, -0.04, 0.05]); arm(m, -1, [0, -0.02, -0.22]); m.box(0, 0, -0.12, 0.05, 0.05, 0.55, C.wood); m.box(0, -0.06, 0.06, 0.035, 0.12, 0.05, C.woodD); m.obox([0, 0.02, -0.36], [1, 0, 0], [0, 1, 0], [0, 0, 1], 0.27, 0.015, 0.015, C.metalD); m.tube([-0.27, 0.02, -0.36], [0, 0.02, -0.1], 0.002, 0.002, 3, hex('#ddd')); m.tube([0.27, 0.02, -0.36], [0, 0.02, -0.1], 0.002, 0.002, 3, hex('#ddd')); break;
    case 'sword': arm(m, 1); m.tube([0, -0.06, 0], [0, 0.1, 0], 0.019, 0.018, 8, hex('#3a2a1e')); m.box(0, 0.11, 0, 0.16, 0.02, 0.035, C.metalD); m.ell(0, -0.075, 0, 0.026, 0.02, 0.026, C.metalD, 0, 8, 6);
      m.obox([0, 0.52, -0.004], [0, 0, 1], [0, 1, 0], [1, 0, 0], 0.032, 0.4, 0.005, C.metalL); m.obox([0, 0.52, 0.004], [0, 0, 1], [0, 1, 0], [1, 0, 0], 0.006, 0.4, 0.007, C.metalD); m.lathe(0, 0.92, 0, [[0.03, 0], [0, 0.07]], 4, () => C.metalL); break;
    case 'revolver': arm(m, 1, [0, -0.02, 0.02]); m.obox([0, -0.02, 0.03], [1, 0, 0], norm([0, 1, 0.25]), norm([0, -0.25, 1]), 0.017, 0.06, 0.024, hex('#4a3426'));
      m.ell(0, -0.025, 0.035, 0.019, 0.06, 0.028, hex('#4a3426'), 0, 14, 10); m.box(0, 0.045, -0.035, 0.026, 0.035, 0.1, C.metalD);
      m.tube([0, 0.045, 0.0], [0, 0.045, -0.06], 0.031, 0.031, 18, C.metal, 0, true); for (let k = 0; k < 6; k++) { const a = k / 6 * TAU; m.tube([Math.cos(a) * 0.031, 0.045 + Math.sin(a) * 0.031, 0.002], [Math.cos(a) * 0.031, 0.045 + Math.sin(a) * 0.031, -0.062], 0.006, 0.006, 6, C.metalD); }
      m.tube([0, 0.06, -0.06], [0, 0.06, -0.21], 0.012, 0.011, 16, C.metalD, 0, true); m.tube([0, 0.042, -0.07], [0, 0.042, -0.17], 0.006, 0.006, 8, C.metal, 0, true); m.box(0, 0.07, -0.19, 0.004, 0.008, 0.01, C.metalD); m.tube([0, 0.03, 0.0], [0, -0.005, 0.0], 0.004, 0.004, 4, C.metalD); break;
    case 'rifle': arm(m, 1, [0, -0.03, 0.06]); arm(m, -1, [0, -0.015, -0.2]); m.obox([0, 0.0, 0.18], [1, 0, 0], norm([0, 1, -0.1]), norm([0, 0.1, 1]), 0.02, 0.05, 0.13, hex('#4a3426'));
      m.box(0, 0.025, -0.05, 0.036, 0.055, 0.22, C.metalD); m.box(0, -0.005, -0.18, 0.04, 0.045, 0.14, hex('#4a3426')); m.tube([0, 0.035, -0.17], [0, 0.035, -0.55], 0.011, 0.01, 10, C.metalD, 0, true);
      m.box(0, -0.045, -0.03, 0.022, 0.08, 0.04, C.metal); m.box(0, 0.06, -0.02, 0.012, 0.012, 0.09, C.metal); m.box(0, 0.066, -0.5, 0.004, 0.014, 0.006, C.metalD); break;
    case 'shotgun': arm(m, 1, [0, -0.03, 0.06]); arm(m, -1, [0, -0.025, -0.22]); m.obox([0, -0.005, 0.18], [1, 0, 0], norm([0, 1, -0.12]), norm([0, 0.12, 1]), 0.022, 0.055, 0.14, hex('#5a3c28'));
      m.box(0, 0.02, -0.04, 0.04, 0.05, 0.16, C.metalD); m.tube([0, 0.035, -0.1], [0, 0.035, -0.62], 0.014, 0.014, 12, C.metalD, 0, true); m.tube([0, 0.006, -0.1], [0, 0.006, -0.52], 0.011, 0.011, 10, C.metal, 0, true);
      m.box(0, 0.004, -0.24, 0.032, 0.03, 0.12, hex('#3a2a1e')); for (let k = 0; k < 4; k++) m.box(0, -0.012, -0.2 - k * 0.025, 0.034, 0.004, 0.006, hex('#2a1e15')); break;
    case 'hands': default: arm(m, 1); break;
  }
  return m;
}
export function arrowMesh() { const m = new MeshBuilder(); m.tube([0, 0, 0.35], [0, 0, -0.35], 0.006, 0.006, 4, C.woodL); m.lathe(0, 0, 0, [[0.015, 0], [0, 0.06]], 4, () => C.stone); const mm = new MeshBuilder(); mm.append(m, rotX(-Math.PI / 2, [0, 0, -0.35])); for (let k = 0; k < 3; k++) { const a = k / 3 * TAU; mm.tri([0, 0, 0.3], [Math.cos(a) * 0.025, Math.sin(a) * 0.025, 0.36], [0, 0, 0.38], hex('#e9e2d4')); } return mm; }
function rotX(a, t) { const c = Math.cos(a), s = Math.sin(a), m = new Float32Array(16); m[0] = 1; m[5] = c; m[6] = s; m[9] = -s; m[10] = c; m[12] = t[0]; m[13] = t[1]; m[14] = t[2]; m[15] = 1; return m; }

// ------------------------------------------------------------------ animals (articulated parts)
export const ANIMALS = {
  deer: { col: hex('#8a6440'), belly: hex('#c9b291'), len: 1.3, h: 1.05, legL: 0.95, head: 0.22, neck: 0.6, antlers: true, speed: 9, walk: 1.6, hp: 120 },
  boar: { col: hex('#4a3b30'), belly: hex('#6b5848'), len: 1.0, h: 0.62, legL: 0.42, head: 0.28, neck: 0.15, tusks: true, speed: 6.5, walk: 1.3, hp: 150 },
  wolf: { col: hex('#6b6560'), belly: hex('#a39b90'), len: 1.05, h: 0.72, legL: 0.62, head: 0.2, neck: 0.32, ears: true, tail: true, speed: 9.5, walk: 1.8, hp: 110 },
  bear: { col: hex('#3a2c22'), belly: hex('#4e3c2e'), len: 1.6, h: 1.05, legL: 0.6, head: 0.34, neck: 0.25, ears: true, speed: 7.5, walk: 1.2, hp: 420 }
};
export function animalParts(type) {
  const Sg = DETAIL.q >= 2 ? 1.7 : 1, sg = n => Math.round(n * Sg);
  const A = ANIMALS[type], R = rng(type.length * 99), body = new MeshBuilder(), head = new MeshBuilder(), legU = new MeshBuilder(), legL = new MeshBuilder(), tail = new MeshBuilder();
  const L = A.len, Hb = A.h, w = L * (type === 'bear' ? 0.42 : type === 'boar' ? 0.4 : 0.26);
  body.ell(0, 0, 0, w, Hb * 0.26 + (type === 'bear' ? 0.12 : 0), L * 0.55, A.col, 0, sg(16), sg(10), p => p[1] < -Hb * 0.08 ? A.belly : jit(A.col, R, 0.05));
  body.ell(0, 0.03, -L * 0.38, w * 0.9, Hb * 0.25, L * 0.25, A.col, 0, sg(12), sg(8));
  if (type === 'bear') body.ell(0, 0.18, -L * 0.2, w * 0.8, Hb * 0.18, L * 0.3, A.col, 0, 10, 7);
  // neck from front of body toward head pivot
  body.tube([0, 0.05, -L * 0.45], [0, A.neck * 0.65, -L * 0.45 - A.neck * 0.55], w * 0.55, w * 0.4, sg(9), A.col);
  // head (pivot at its back)
  const hs = A.head;
  head.ell(0, 0, -hs * 0.6, hs * 0.75, hs * 0.7, hs * 1.1, A.col, 0, sg(12), sg(8));
  head.ell(0, -hs * 0.18, -hs * 1.55, hs * 0.42, hs * 0.38, hs * 0.6, mixc(A.col, A.belly, 0.4), 0, 10, 7);
  head.ell(0, -hs * 0.12, -hs * 2.1, hs * 0.16, hs * 0.13, hs * 0.08, hex('#1a1614'), 0, 6, 4);
  for (const s of [-1, 1]) head.ell(s * hs * 0.45, hs * 0.2, -hs * 1.05, hs * 0.08, hs * 0.08, hs * 0.08, hex('#0d0b0a'), 0.05, 6, 4);
  if (A.ears || A.antlers) for (const s of [-1, 1]) head.lathe(s * hs * 0.45, hs * 0.45, -hs * 0.3, [[hs * 0.18, 0], [hs * 0.03, hs * 0.5]], 5, () => A.col);
  if (A.antlers) for (const s of [-1, 1]) { const b = [s * hs * 0.3, hs * 0.6, -hs * 0.55], t1 = [s * hs * 1.6, hs * 2.6, -hs * 0.1]; head.tube(b, t1, 0.025, 0.012, 5, hex('#d8c9a8')); head.tube([(b[0] + t1[0]) / 2, (b[1] + t1[1]) / 2, -hs * 0.35], [s * hs * 1.0, hs * 2.2, -hs * 1.2], 0.018, 0.008, 4, hex('#d8c9a8')); head.tube([b[0] + (t1[0] - b[0]) * 0.75, b[1] + (t1[1] - b[1]) * 0.75, -hs * 0.2], [s * hs * 2.1, hs * 2.5, -hs * 0.8], 0.014, 0.006, 4, hex('#d8c9a8')); }
  if (A.tusks) for (const s of [-1, 1]) head.tube([s * hs * 0.3, -hs * 0.3, -hs * 1.8], [s * hs * 0.5, hs * 0.05, -hs * 1.95], 0.025, 0.006, 5, hex('#efe6cf'));
  // legs (pivot at hip/knee, extend down -y)
  const lw = type === 'bear' ? 0.11 : type === 'boar' ? 0.07 : 0.055;
  legU.tube([0, 0.06, 0], [0, -A.legL * 0.5, 0.02], lw * 1.6, lw, sg(8), A.col);
  legL.tube([0, 0, 0], [0, -A.legL * 0.5, 0], lw, lw * 0.75, sg(7), mixc(A.col, A.belly, 0.2)); legL.ell(0, -A.legL * 0.5, -0.02, lw * 1.1, lw * 0.6, lw * 1.4, hex('#1d1915'), 0, 6, 4);
  if (A.tail) tail.tube([0, 0, 0], [0, -0.28, 0.32], 0.06, 0.03, 6, A.col); else tail.tube([0, 0, 0], [0, -0.06, 0.1], 0.03, 0.01, 4, A.col);
  return { body, head, legU, legL, tail, def: A };
}

// ------------------------------------------------------------------ remote player (humanoid parts)
/** remote player: anatomically proportioned humanoid (1.8 m), split at joints for skeletal animation.
 *  pivots: pelvis@hips, torso@waist, head@neck, upper arm@shoulder, forearm@elbow, thigh@hip, shin@knee */
export function humanParts(tint, seed = 1) {
  const R = rng(seed * 77 + 5), skin = mixc(C.skin, [0.45, 0.3, 0.22], R() * 0.6), hair = [hex('#1d1612'), hex('#3a2a1e'), hex('#5a4030'), hex('#141414')][Math.floor(R() * 4)];
  const shirt = tint || hex('#4a4f45'), shirtD = mixc(shirt, [0, 0, 0], 0.25), pants = hex('#3a352e'), pantsD = hex('#2b2722'), boot = hex('#2b2520'), belt = hex('#2a2018');
  const pelvis = new MeshBuilder(), torso = new MeshBuilder(), head = new MeshBuilder(), armU = new MeshBuilder(), armL = new MeshBuilder(), legU = new MeshBuilder(), legL = new MeshBuilder();
  pelvis.ell(0, 0.02, 0, 0.17, 0.115, 0.108, pants, 0, 18, 12); pelvis.ell(0, 0.09, 0, 0.165, 0.035, 0.105, belt, 0, 16, 4); pelvis.box(0, 0.09, -0.103, 0.05, 0.035, 0.01, hex('#8a7a5a'));
  // torso: abdomen, rib cage, pecs, shoulders, collar, neck, back
  torso.ell(0, 0.1, 0, 0.15, 0.13, 0.1, shirt, 0, 18, 12);
  torso.ell(0, 0.27, 0.005, 0.19, 0.19, 0.118, shirt, 0, 22, 16); torso.ell(0, 0.18, 0, 0.165, 0.12, 0.108, shirt, 0, 18, 12);
  for (const s of [-1, 1]) torso.ell(s * 0.17, 0.38, 0.005, 0.085, 0.07, 0.085, shirt, 0, 14, 10);
  torso.tube([0, 0.42, 0], [0, 0.5, 0.0], 0.1, 0.06, 14, shirtD); torso.tube([0, 0.44, 0.005], [0, 0.56, 0.01], 0.05, 0.045, 12, skin);
  torso.ell(0, 0.43, -0.07, 0.09, 0.025, 0.03, shirtD, 0, 10, 4); for (let k = 0; k < 4; k++) torso.box(0, 0.36 - k * 0.07, -0.118, 0.012, 0.012, 0.006, hex('#cfc6b4'));
  // head: skull, face planes, jaw, nose, eyes, brows, ears, hair
  head.ell(0, 0.105, 0.01, 0.092, 0.112, 0.104, skin, 0, 20, 16);
  head.ell(0, 0.045, -0.035, 0.07, 0.06, 0.07, skin, 0, 16, 12); head.ell(0, 0.012, -0.055, 0.046, 0.03, 0.04, mixc(skin, [0, 0, 0], 0.05), 0, 12, 8);
  head.lathe(0, 0.07, -0.098, [[0.016, 0], [0.012, 0.035], [0.004, 0.045]], 8, () => mixc(skin, [0.6, 0.3, 0.25], 0.08));
  for (const s of [-1, 1]) {
    head.ell(s * 0.033, 0.11, -0.088, 0.012, 0.007, 0.005, hex('#d9d2c8'), 0, 8, 6); head.ell(s * 0.033, 0.11, -0.092, 0.0055, 0.0055, 0.003, hex('#241a12'), 0, 8, 6);
    head.box(s * 0.036, 0.133, -0.088, 0.024, 0.006, 0.008, hair); head.ell(s * 0.093, 0.1, 0.01, 0.014, 0.028, 0.02, mixc(skin, [0.5, 0.2, 0.2], 0.1), 0, 8, 6);
    head.ell(s * 0.05, 0.065, -0.082, 0.022, 0.018, 0.012, mixc(skin, [0.7, 0.3, 0.3], 0.07), 0, 8, 6);
  }
  head.box(0, 0.04, -0.094, 0.026, 0.004, 0.006, mixc(skin, [0.45, 0.15, 0.15], 0.45));
  head.ico(0, 0.135, 0.022, 0.1, 0.085, 0.107, 2, u => u[1] < -0.1 && u[2] < 0 ? 0.6 : 1 + Math.sin(u[0] * 9 + u[2] * 7) * 0.03, () => jit(hair, R, 0.1));
  // limbs (+ elbow/knee caps so joints stay closed while bending)
  armU.ell(0, 0, 0, 0.064, 0.064, 0.064, shirt, 0, 12, 8); armU.tube([0, 0, 0], [0, -0.31, 0.01], 0.06, 0.048, 14, shirt);
  armL.ell(0, 0, 0, 0.047, 0.047, 0.047, shirt, 0, 10, 8); armL.tube([0, 0, 0], [0, -0.13, 0], 0.047, 0.043, 14, shirt); armL.tube([0, -0.13, 0], [0, -0.27, 0], 0.037, 0.031, 12, skin);
  armL.ell(0, -0.3, -0.008, 0.026, 0.045, 0.036, skin, 0, 10, 8); for (let f = 0; f < 4; f++) armL.tube([-0.018 + f * 0.012, -0.335, -0.012], [-0.02 + f * 0.012, -0.37, 0.004], 0.0075, 0.0065, 6, skin, 0, true); armL.tube([0.024, -0.3, -0.02], [0.03, -0.33, -0.035], 0.008, 0.007, 6, skin, 0, true);
  legU.ell(0, 0, 0, 0.098, 0.098, 0.098, pants, 0, 14, 10); legU.tube([0, 0, 0], [0, -0.44, 0.012], 0.096, 0.066, 16, pants); legU.ell(0, -0.2, -0.04, 0.05, 0.12, 0.03, pantsD, 0, 8, 6);
  legL.ell(0, 0, 0, 0.064, 0.064, 0.064, pants, 0, 10, 8); legL.tube([0, 0, 0], [0, -0.3, 0.01], 0.068, 0.054, 14, pants); legL.tube([0, -0.3, 0.01], [0, -0.4, 0.015], 0.058, 0.055, 12, boot);
  legL.ell(0, -0.445, -0.04, 0.055, 0.042, 0.125, boot, 0, 12, 8); legL.box(0, -0.48, -0.04, 0.11, 0.022, 0.25, hex('#1a1612'));
  return { pelvis, torso, head, armU, armL, legU, legL };
}

// ------------------------------------------------------------------ grass clump (merged per chunk)
export function grassBlade(m, x, y, z, R, col, h = 0.5) {
  const a = R() * TAU, w = 0.05, dx = Math.cos(a) * w, dz = Math.sin(a) * w, lx = (R() - 0.5) * 0.3, lz = (R() - 0.5) * 0.3;
  const mid = [x + lx * 0.35, y + h * 0.55, z + lz * 0.35], top = [x + lx, y + h, z + lz], cb = mixc(col, [0, 0, 0], 0.4), cm = col, ct = mixc(col, [0.85, 0.85, 0.55], 0.28), n = [0, 1, 0];
  m.vert([x - dx, y, z - dz], n, cb, 0); m.vert([x + dx, y, z + dz], n, cb, 0); m.vert([mid[0] + dx * 0.7, mid[1], mid[2] + dz * 0.7], n, cm, sway(0.08));
  m.vert([x - dx, y, z - dz], n, cb, 0); m.vert([mid[0] + dx * 0.7, mid[1], mid[2] + dz * 0.7], n, cm, sway(0.08)); m.vert([mid[0] - dx * 0.7, mid[1], mid[2] - dz * 0.7], n, cm, sway(0.08));
  m.vert([mid[0] - dx * 0.7, mid[1], mid[2] - dz * 0.7], n, cm, sway(0.08)); m.vert([mid[0] + dx * 0.7, mid[1], mid[2] + dz * 0.7], n, cm, sway(0.08)); m.vert(top, n, ct, sway(0.2));
}
/** debris pieces for destruction (rock chunks, wood splinters, planks, metal shards) */
export function debris(kind, seed) {
  const R = rng(seed * 131 + 7), m = new MeshBuilder();
  if (kind === 'rock' || kind === 'ore') { const sd = R() * 50; m.ico(0, 0, 0, 0.12 + R() * 0.1, 0.09 + R() * 0.07, 0.11 + R() * 0.09, 1, u => 1 + Math.sin(u[0] * 5 + sd) * 0.2, (p, n) => { let c = mixc(C.stoneD, C.stoneL, 0.4 + n[1] * 0.3); if (kind === 'ore' && R() < 0.4) c = C.ore; return c; }); }
  else if (kind === 'wood') { m.box(0, 0, 0, 0.06 + R() * 0.05, 0.03, 0.22 + R() * 0.2, mixc(C.woodL, C.wood, R())); m.box(0, 0.016, 0, 0.05, 0.004, 0.2, C.bark); }
  else if (kind === 'plank') { m.box(0, 0, 0, 0.12, 0.025, 0.45 + R() * 0.25, jit(C.plank, R, 0.15)); }
  else if (kind === 'metal') { m.obox([0, 0, 0], [1, 0, 0], norm([0, 1, 0.3]), norm([0, -0.3, 1]), 0.12, 0.008, 0.09, mixc(C.metal, C.rust, R() * 0.5)); }
  else { m.box(0, 0, 0, 0.15, 0.1, 0.12, C.concrete); }
  return m;
}
