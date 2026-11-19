// EMBERWING — Blender model library (assets/ew_models.bin, written by blender/ew_build.py)
// Every face has a role; every vertex has (shade, blend, emit). Colours are resolved at load time
// from a palette function role -> [colourA, colourB] so one model serves every world / skin / enemy.
import { mixc } from '../core/math.js';

export class ModelLib {
  constructor(buf) {
    const dv = new DataView(buf);
    const magic = String.fromCharCode(...new Uint8Array(buf, 0, 4));
    if (magic !== 'EWM1') throw new Error('bad model file');
    const n = dv.getUint32(4, true);
    this.head = JSON.parse(new TextDecoder().decode(new Uint8Array(buf, 8, n)));
    this.base = 8 + n; this.buf = buf; this.roles = this.head.roles; this.cache = {};
  }
  static async load(url) {
    const r = await fetch(url); if (!r.ok) throw new Error('models ' + r.status);
    return new ModelLib(await r.arrayBuffer());
  }
  has(name) { return !!this.head.meshes[name]; }
  info(name) { return this.head.meshes[name]; }
  raw(name) {
    if (this.cache[name]) return this.cache[name];
    const m = this.head.meshes[name]; if (!m) return null;
    const b = this.base;
    const r = {
      v: m.v, c: m.c, q: m.q, lo: m.lo, hi: m.hi,
      pos: new Int16Array(this.buf, b + m.po, m.v * 3),
      nrm: new Int8Array(this.buf, b + m.no, m.v * 4),
      att: new Uint8Array(this.buf, b + m.ao, m.v * 4),
      idx: new Uint16Array(this.buf, b + m.io, m.i)
    };
    return (this.cache[name] = r);
  }
  /** decode into the renderer's vertex format (pos3 nrm3 rgb3 emit1). opts: {mirror, emitK} */
  mesh(name, pal, opts = {}) {
    const r = this.raw(name); if (!r) return null;
    const out = new Float32Array(r.v * 10), sx = opts.mirror ? -1 : 1, ek = opts.emitK == null ? 1 : opts.emitK;
    const roles = this.roles, cols = roles.map(ro => pal(ro));
    for (let i = 0; i < r.v; i++) {
      const o = i * 10;
      out[o] = (r.pos[i * 3] * r.q + r.c[0]) * sx; out[o + 1] = r.pos[i * 3 + 1] * r.q + r.c[1]; out[o + 2] = r.pos[i * 3 + 2] * r.q + r.c[2];
      out[o + 3] = r.nrm[i * 4] / 127 * sx; out[o + 4] = r.nrm[i * 4 + 1] / 127; out[o + 5] = r.nrm[i * 4 + 2] / 127;
      const role = r.att[i * 4], shade = r.att[i * 4 + 1] / 255 * 1.6, bl = r.att[i * 4 + 2] / 255, em = r.att[i * 4 + 3] / 255;
      const pc = cols[role] || [[1, 0, 1], [1, 0, 1]], A = pc[0], B = pc[1];
      out[o + 6] = (A[0] + (B[0] - A[0]) * bl) * shade; out[o + 7] = (A[1] + (B[1] - A[1]) * bl) * shade; out[o + 8] = (A[2] + (B[2] - A[2]) * bl) * shade;
      out[o + 9] = Math.min(1, em * ek * (pc[2] == null ? 1 : pc[2]));
    }
    return { v: out, i: r.idx };
  }
}

/** accumulates many transformed model instances into chunks of <= 65535 vertices (16-bit indices) */
export class Batch {
  constructor() { this.chunks = []; this.cur = null; }
  _chunk(nv) {
    if (!this.cur || this.cur.nv + nv > 65535) { this.cur = { v: [], i: [], nv: 0 }; this.chunks.push(this.cur); }
    return this.cur;
  }
  /** add decoded mesh {v,i} with a 4x4 column-major matrix (may be non-uniform) */
  add(m, M) {
    if (!m) return;
    const nv = m.v.length / 10, ch = this._chunk(nv), base = ch.nv, V = m.v;
    // normal matrix = inverse transpose of upper 3x3
    const a = M[0], b = M[4], c = M[8], d = M[1], e = M[5], f = M[9], g = M[2], h = M[6], k = M[10];
    const A = e * k - f * h, B = -(d * k - f * g), C = d * h - e * g;
    const D = -(b * k - c * h), E = a * k - c * g, F = -(a * h - b * g);
    const G = b * f - c * e, H = -(a * f - c * d), K = a * e - b * d;
    const out = new Float32Array(V.length);
    for (let i = 0; i < V.length; i += 10) {
      const x = V[i], y = V[i + 1], z = V[i + 2];
      out[i] = M[0] * x + M[4] * y + M[8] * z + M[12]; out[i + 1] = M[1] * x + M[5] * y + M[9] * z + M[13]; out[i + 2] = M[2] * x + M[6] * y + M[10] * z + M[14];
      const nx = V[i + 3], ny = V[i + 4], nz = V[i + 5];
      let X = A * nx + B * ny + C * nz, Y = D * nx + E * ny + F * nz, Z = G * nx + H * ny + K * nz;
      const l = Math.hypot(X, Y, Z) || 1; out[i + 3] = X / l; out[i + 4] = Y / l; out[i + 5] = Z / l;
      out[i + 6] = V[i + 6]; out[i + 7] = V[i + 7]; out[i + 8] = V[i + 8]; out[i + 9] = V[i + 9];
    }
    ch.v.push(out);
    const I = new Uint16Array(m.i.length); for (let j = 0; j < m.i.length; j++) I[j] = m.i[j] + base;
    ch.i.push(I); ch.nv += nv;
  }
  /** also accept a procedural MeshBuilder (non-indexed) */
  addBuilder(mb) {
    const nv = mb.v.length / 10; if (!nv) return;
    for (let s = 0; s < nv; s += 60000) {
      const n = Math.min(60000, nv - s), ch = this._chunk(n), base = ch.nv;
      ch.v.push(new Float32Array(mb.v.slice(s * 10, (s + n) * 10)));
      const I = new Uint16Array(n); for (let j = 0; j < n; j++) I[j] = base + j; ch.i.push(I); ch.nv += n;
    }
  }
  build() {
    return this.chunks.map(ch => {
      let nv = 0, ni = 0; for (const a of ch.v) nv += a.length; for (const a of ch.i) ni += a.length;
      const v = new Float32Array(nv), i = new Uint16Array(ni); let o = 0, p = 0;
      for (const a of ch.v) { v.set(a, o); o += a.length; }
      for (const a of ch.i) { i.set(a, p); p += a.length; }
      return { v, i };
    });
  }
}

// ---------------------------------------------------------------- palettes
const D = (c, k) => [c[0] * k, c[1] * k, c[2] * k];
const STONE = [[0.9, 0.86, 0.78], [0.6, 0.57, 0.52]], GOLD = [[1.0, 0.78, 0.38], [0.62, 0.42, 0.16]];
export function worldPal(P) {
  return role => {
    switch (role) {
      case 'GRASS': return [P.grass, P.grass2];
      case 'ROCK': return [P.rock, P.rock2];
      case 'LEAF': return [P.leaf, P.leaf2];
      case 'TRUNK': return [P.trunk, D(P.trunk, 0.6)];
      case 'ACCENT': return [P.accent, [1, 1, 1]];
      case 'FLOWER': return [P.flower, P.accent];
      case 'STONE': return STONE;
      case 'GOLD': return GOLD;
      case 'GATE': return [D(P.accent, 0.8), [1, 0.95, 0.85], 0.35];
      case 'FEATHER': return [[1, 0.5, 0.14], [1, 0.93, 0.62]];
      default: return [P.rock, P.rock2];
    }
  };
}
export function skinPal(S) {
  const g = Math.max(0.5, (S.glow || 0.35) / 0.35);
  return role => {
    switch (role) {
      case 'P_BODY': return [S.body, S.belly, g];
      case 'P_WING': return [S.wing, S.tip, g];
      case 'P_TIP': return [S.tip, mixc(S.tip, [1, 1, 1], 0.6), g];
      case 'P_BEAK': return [S.beak, D(S.beak, 0.45), 1];
      case 'P_EYE': return [S.eye || [1, 1, 1], [0.03, 0.02, 0.02], 1];
      default: return [S.body, S.wing, g];
    }
  };
}
export const ENEMY_PAL = {
  drifter: { dark: [0.07, 0.04, 0.12], dark2: [0.24, 0.12, 0.36], glow: [0.72, 0.36, 1.0] },
  lancer: { dark: [0.07, 0.035, 0.09], dark2: [0.3, 0.08, 0.2], glow: [1.0, 0.24, 0.55] },
  leech: { dark: [0.04, 0.08, 0.06], dark2: [0.1, 0.24, 0.16], glow: [0.36, 1.0, 0.69] },
  orb: { dark: [0.07, 0.04, 0.12], dark2: [0.24, 0.12, 0.36], glow: [0.8, 0.4, 1.0] },
  maw: { dark: [0.05, 0.03, 0.08], dark2: [0.2, 0.1, 0.36], glow: [0.75, 0.42, 1.0] },
  core: { dark: [0.09, 0.05, 0.15], dark2: [0.3, 0.12, 0.4], glow: [1.0, 0.35, 0.82] }
};
export function enemyPal(k) {
  const E = ENEMY_PAL[k] || ENEMY_PAL.drifter;
  return role => {
    if (role === 'E_GLOW') return [E.glow, mixc(E.glow, [1, 1, 1], 0.7)];
    if (role === 'E_EYE') return [[1, 0.97, 1], [0.02, 0.0, 0.03]];
    return [E.dark, E.dark2];
  };
}
