// EMBERWING — procedural models: the phoenix, Hollow creatures, rings, feathers, beacon flame, storm wall
import { MeshBuilder } from './mesh.js';
import { hex, mixc, TAU, trs } from '../core/math.js';
const H = hex;

/** Phoenix — local frame: +X right, +Y up, -Z forward. Wingspan ~ 34 units. */
export function phoenix(skin) {
  const S = skin || { body: H('#ff5a1f'), belly: H('#ffc04a'), wing: H('#ff7a1a'), tip: H('#ffe27a'), beak: H('#ffd25a'), eye: [1, 1, 1], glow: 0.35 };
  const body = new MeshBuilder();
  body.ell(0, 0, 0, 3.6, 3.4, 8.5, S.body, S.glow * 0.5, 14, 9, p => mixc(S.belly, S.body, Math.min(1, Math.max(0, (p[1] + 2.5) / 5))));
  body.ell(0, 2.4, -7.6, 3.0, 2.9, 3.4, S.body, S.glow * 0.4, 12, 8);              // head
  for (const sx of [-1, 1]) body.ell(sx * 1.6, 3.2, -9.6, 0.55, 0.6, 0.5, S.eye, 1, 6, 4);
  // crest
  const crest = new MeshBuilder(); for (let i = 0; i < 3; i++) crest.cyl(0, 0, 0, 0.7, 0, 6 - i, 4, i ? S.tip : S.wing, 0.8);
  for (let i = 0; i < 3; i++) body.append(crest, trs([(i - 1) * 0.8, 4.5, -6.6 + i * 0.6], 0, 1, -0.9 - i * 0.15, (i - 1) * 0.25));
  // fix beak orientation (cyl is along +y): rebuild as a cone pointing -z
  const beak = new MeshBuilder(); beak.cyl(0, 0, 0, 1.15, 0, 4.4, 6, S.beak, 0.25); body.append(beak, trs([0, 2.0, -10.2], 0, 1, -Math.PI / 2, 0));
  // tail fan
  const tail = new MeshBuilder();
  for (let i = -2; i <= 2; i++) {
    const a = i * 0.22, L = 17 - Math.abs(i) * 2.2, w = 1.6;
    const p0 = [0, 0, 0], p1 = [Math.sin(a) * L - w, 0.2, Math.cos(a) * L], p2 = [Math.sin(a) * (L + 3), 0, Math.cos(a) * (L + 3)], p3 = [Math.sin(a) * L + w, 0.2, Math.cos(a) * L];
    tail.tri(p0, p1, p2, mixc(S.wing, S.tip, 0.4), 0.55); tail.tri(p0, p2, p3, mixc(S.wing, S.tip, 0.6), 0.6);
  }
  // wings: inner (shoulder at x=0) and outer (elbow at x=0). Built for the RIGHT side (+x), mirrored for left.
  const wingInner = side => {
    const m = new MeshBuilder(), s = side;
    for (let i = 0; i < 5; i++) {
      const x0 = i * 2.4, x1 = x0 + 2.6, chord = 9 - i * 0.6;
      m.quad([s * x0, 0, -2.5], [s * x1, 0, -2.4], [s * x1, -0.2, chord - 2.4], [s * x0, -0.2, chord - 2.5], mixc(S.body, S.wing, i / 5), S.glow * 0.4);
      m.tri([s * x0, 0, chord - 2.6], [s * x1, -0.2, chord - 2.4], [s * (x0 + 1.3), -0.4, chord + 1.6], mixc(S.wing, S.tip, 0.5), 0.5);
    }
    return m;
  };
  const wingOuter = side => {
    const m = new MeshBuilder(), s = side;
    for (let i = 0; i < 7; i++) {
      const x0 = i * 2.2, x1 = x0 + 2.4, chord = 7 - i * 0.55, sw = i * 0.9;
      m.quad([s * x0, 0, -2.2 + sw * 0.3], [s * x1, 0, -2.0 + sw * 0.35], [s * x1, -0.15, chord - 1.6 + sw], [s * x0, -0.15, chord - 1.8 + sw], mixc(S.wing, S.tip, i / 8), 0.35 + i * 0.05);
      m.tri([s * x0, -0.1, chord - 1.8 + sw], [s * x1, -0.15, chord - 1.6 + sw], [s * (x0 + 1.4), -0.3, chord + 4 + sw], mixc(S.tip, [1, 1, 0.85], 0.3), 0.75);
    }
    return m;
  };
  return { body, tail, wiL: wingInner(-1), wiR: wingInner(1), woL: wingOuter(-1), woR: wingOuter(1) };
}

export const SKINS = [
  { id: 'ember', name: 'جذوة', cost: 0, body: H('#ff5a1f'), belly: H('#ffc04a'), wing: H('#ff7a1a'), tip: H('#ffe27a'), beak: H('#ffd25a'), eye: [1, 1, 1], glow: 0.35, trail: [H('#ffd27a'), H('#ff4a14')] },
  { id: 'azure', name: 'لهب أزرق', cost: 400, body: H('#2a7bff'), belly: H('#9fe3ff'), wing: H('#3d9bff'), tip: H('#d6f6ff'), beak: H('#e9f7ff'), eye: [1, 1, 1], glow: 0.45, trail: [H('#bff0ff'), H('#2a6bff')] },
  { id: 'jade', name: 'يشم', cost: 600, body: H('#16b37a'), belly: H('#b8ffb0'), wing: H('#22d28a'), tip: H('#e6ff9a'), beak: H('#fff2a8'), eye: [1, 1, 1], glow: 0.4, trail: [H('#e8ff9a'), H('#14b06a')] },
  { id: 'royal', name: 'ملكي', cost: 900, body: H('#7a2bff'), belly: H('#ffd36b'), wing: H('#a85cff'), tip: H('#ffe8a3'), beak: H('#ffd36b'), eye: [1, 1, 1], glow: 0.5, trail: [H('#ffe08a'), H('#8a3bff')] },
  { id: 'solar', name: 'شمسي', cost: 1400, body: H('#fff1c2'), belly: H('#ffffff'), wing: H('#ffd56b'), tip: H('#ffffff'), beak: H('#ffb13a'), eye: H('#ff7a1a'), glow: 0.8, trail: [H('#ffffff'), H('#ffc34a')] }
];

export function drifter() {
  const m = new MeshBuilder(), dark = H('#140c22'), glow = H('#b25cff');
  m.ell(0, 0, 0, 12, 12, 12, dark, 0, 12, 8);
  for (let i = 0; i < 14; i++) { const a = i / 14 * TAU, b = (i % 3 - 1) * 0.6; const sp = new MeshBuilder(); sp.cyl(0, 0, 0, 3.4, 0, 15, 4, mixc(dark, glow, 0.15)); m.append(sp, trs([Math.cos(a) * 9 * Math.cos(b), Math.sin(b) * 9, Math.sin(a) * 9 * Math.cos(b)], -a + Math.PI / 2, 1, Math.PI / 2 - b, 0)); }
  m.ell(0, 1, -10.5, 5, 3.6, 2, glow, 1, 10, 6);
  m.ell(0, 1, -12, 2, 2, 1, [1, 0.9, 1], 1, 6, 4);
  return m;
}
export function lancer() {
  const m = new MeshBuilder(), dark = H('#120a1c'), glow = H('#ff3d8b');
  const body = new MeshBuilder(); body.cyl(0, 0, 0, 5, 0, 40, 6, dark); m.append(body, trs([0, 0, 6], 0, 1, -Math.PI / 2, 0));
  const tail = new MeshBuilder(); tail.cyl(0, 0, 0, 5, 1, 14, 6, dark); m.append(tail, trs([0, 0, 6], 0, 1, Math.PI / 2, 0));
  for (const s of [-1, 1]) m.tri([0, 0, 2], [s * 16, 0, 16], [0, 0, 12], mixc(dark, glow, 0.2));
  m.ell(0, 0, -30, 2.2, 2.2, 6, glow, 1, 8, 5);
  return m;
}
export function leech() {
  const m = new MeshBuilder(), dark = H('#0e1a14'), glow = H('#5dffb0');
  m.ell(0, 0, 0, 7, 6, 8, dark, 0, 10, 7);
  for (let i = 0; i < 6; i++) { const a = i / 6 * TAU; const t = new MeshBuilder(); t.cyl(0, 0, 0, 1.6, 0, 16, 4, mixc(dark, glow, 0.3), 0.2); m.append(t, trs([Math.cos(a) * 4, -2, Math.sin(a) * 4 + 4], a, 1, 1.9, 0)); }
  m.ell(-2.5, 2, -6.5, 1.6, 1.6, 1, glow, 1, 6, 4); m.ell(2.5, 2, -6.5, 1.6, 1.6, 1, glow, 1, 6, 4);
  return m;
}
export function maw() {
  const m = new MeshBuilder(), dark = H('#0b0714'), rim = H('#3a1f66'), glow = H('#c06bff');
  for (let i = 0; i < 18; i++) { const a = i / 18 * TAU; const p = new MeshBuilder(); p.box(0, 0, 0, 60, 160, 40, i % 2 ? dark : rim); m.append(p, trs([Math.cos(a) * 230, Math.sin(a) * 230, 0], 0, 1, 0, a + Math.PI / 2)); }
  for (let i = 0; i < 24; i++) { const a = i / 24 * TAU; const t = new MeshBuilder(); t.cyl(0, 0, 0, 14, 0, 90, 5, dark); m.append(t, trs([Math.cos(a) * 180, Math.sin(a) * 180, 10], 0, 1, Math.PI / 2, a - Math.PI / 2)); }
  m.ell(0, 0, 30, 150, 150, 40, H('#05030a'), 0, 18, 10);
  m.ell(0, 0, 0, 60, 60, 20, glow, 0.9, 14, 8);
  return m;
}
export function core() { const m = new MeshBuilder(); m.ell(0, 0, 0, 34, 34, 34, H('#ff5ad1'), 1, 12, 8); for (let i = 0; i < 8; i++) { const a = i / 8 * TAU; const s = new MeshBuilder(); s.cyl(0, 0, 0, 8, 0, 30, 4, H('#2a1446')); m.append(s, trs([Math.cos(a) * 30, Math.sin(a) * 30, 0], 0, 1, 0, a - Math.PI / 2)); } return m; }
export function ring(col) {
  const m = new MeshBuilder(), seg = 40, tube = 6, R = 70;
  for (let i = 0; i < seg; i++) for (let j = 0; j < 6; j++) {
    const a0 = i / seg * TAU, a1 = (i + 1) / seg * TAU, b0 = j / 6 * TAU, b1 = (j + 1) / 6 * TAU;
    const P = (a, b) => [Math.cos(a) * (R + Math.cos(b) * tube), Math.sin(a) * (R + Math.cos(b) * tube), Math.sin(b) * tube];
    m.quad(P(a0, b0), P(a1, b0), P(a1, b1), P(a0, b1), col, 0.9);
  }
  for (let i = 0; i < 8; i++) { const a = i / 8 * TAU; m.box(Math.cos(a) * (R + 10), Math.sin(a) * (R + 10), 0, 6, 6, 6, [1, 1, 1], 1); }
  return m;
}
export function feather() {
  const m = new MeshBuilder(), c1 = H('#ffe9a8'), c2 = H('#ff9a3a');
  for (let i = 0; i < 8; i++) { const y0 = i * 4, y1 = y0 + 4, w0 = Math.sin((i / 8) * Math.PI) * 7 + 1, w1 = Math.sin(((i + 1) / 8) * Math.PI) * 7 + 1; m.quad([-w0, y0, 0], [w0, y0, 0], [w1, y1, 0], [-w1, y1, 0], mixc(c2, c1, i / 8), 0.85); }
  m.cyl(0, -6, 0, 0.8, 0.5, 40, 4, c1, 0.9);
  return m;
}
export function flameMesh(col) { const m = new MeshBuilder(); m.cyl(0, 0, 0, 30, 0, 90, 10, col, 1); m.cyl(0, 0, 0, 18, 0, 130, 8, [1, 1, 0.85], 1); return m; }
export function column(col) { const m = new MeshBuilder(); m.cyl(0, 0, 0, 60, 30, 4000, 16, col, 1, false); return m; }
export function stormWall() {
  // smooth swirling curtain; vertex "emissive" slot carries alpha (drawn with vAlpha)
  const m = new MeshBuilder(), seg = 72, ys = [-1500, -600, 0, 500, 1100, 1800, 2600, 3600];
  const al = [0, 0.55, 0.8, 0.85, 0.8, 0.55, 0.25, 0];
  for (let i = 0; i < seg; i++) for (let j = 0; j < ys.length - 1; j++) {
    const a0 = i / seg * TAU, a1 = (i + 1) / seg * TAU;
    const c = (a, k) => mixc(H('#140a26'), H('#4a2380'), 0.35 + 0.35 * Math.sin(a * 5 + k * 1.3));
    const v = (a, k) => [Math.cos(a), ys[k], Math.sin(a)];
    const A = v(a0, j), B = v(a1, j), C = v(a1, j + 1), D = v(a0, j + 1), n = [-Math.cos(a0), 0, -Math.sin(a0)];
    m.triS(A, B, C, n, n, n, c(a0, j), c(a1, j), c(a1, j + 1)); m.v.splice(m.v.length - 30, 30, ...[A, B, C].flatMap((p, q) => [p[0], p[1], p[2], n[0], n[1], n[2], ...c([a0, a1, a1][q], [j, j, j + 1][q]), al[[j, j, j + 1][q]]]));
    m.triS(A, C, D, n, n, n, c(a0, j), c(a1, j + 1), c(a0, j + 1)); m.v.splice(m.v.length - 30, 30, ...[A, C, D].flatMap((p, q) => [p[0], p[1], p[2], n[0], n[1], n[2], ...c([a0, a1, a0][q], [j, j + 1, j + 1][q]), al[[j, j + 1, j + 1][q]]]));
  }
  return m;
}
export function shadowDisc() { const m = new MeshBuilder(); for (let i = 0; i < 16; i++) { const a0 = i / 16 * TAU, a1 = (i + 1) / 16 * TAU; m.tri([0, 0, 0], [Math.cos(a1), 0, Math.sin(a1)], [Math.cos(a0), 0, Math.sin(a0)], [0, 0, 0]); } return m; }
export function orb(col) { const m = new MeshBuilder(); m.ell(0, 0, 0, 10, 10, 10, col, 1, 8, 6); return m; }
