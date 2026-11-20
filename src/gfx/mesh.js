// ARVEX SURVIVAL — procedural mesh builder. Vertex = pos(3) normal(3) color(3) + emissive/sway(1)
// the 4th colour channel: 0..1 = emissive, < -0.5 = wind sway weight (-(1+k))
import { cross, sub, norm, xformPt, TAU, add, scl, dot, len } from '../core/math.js';

export class MeshBuilder {
  constructor() { this.v = []; }
  get count() { return this.v.length / 10; }
  vert(p, n, c, e = 0) { this.v.push(p[0], p[1], p[2], n[0], n[1], n[2], c[0], c[1], c[2], e); }
  tri(a, b, c, col, e = 0, n) {
    const nn = n || norm(cross(sub(b, a), sub(c, a)));
    this.vert(a, nn, col, e); this.vert(b, nn, col, e); this.vert(c, nn, col, e);
  }
  /** smooth triangle with per-vertex normals and colors */
  triS(a, b, c, na, nb, nc, ca, cb, cc, e = 0) { this.vert(a, na, ca, e); this.vert(b, nb, cb, e); this.vert(c, nc, cc, e); }
  quad(a, b, c, d, col, e = 0) { this.tri(a, b, c, col, e); this.tri(a, c, d, col, e); }
  box(cx, cy, cz, sx, sy, sz, col, e = 0) {
    const x0 = cx - sx / 2, x1 = cx + sx / 2, y0 = cy - sy / 2, y1 = cy + sy / 2, z0 = cz - sz / 2, z1 = cz + sz / 2;
    this.quad([x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0], col, e);
    this.quad([x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1], col, e);
    this.quad([x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1], col, e);
    this.quad([x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0], col, e);
    this.quad([x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1], col, e);
    this.quad([x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0], col, e);
  }
  /** lathe around Y: profile = [[r, y], ...] bottom->top; colFn(i, t) per ring */
  lathe(cx, cy, cz, prof, seg, colFn, e = 0, jitter = null) {
    const rings = prof.map(([r, y], i) => {
      const ring = [];
      for (let s = 0; s <= seg; s++) {
        const a = (s % seg) / seg * TAU; let rr = r;
        if (jitter) rr *= 1 + jitter(a, i);
        ring.push([cx + Math.cos(a) * rr, cy + y, cz + Math.sin(a) * rr]);
      }
      return ring;
    });
    for (let i = 0; i < rings.length - 1; i++) {
      const c = colFn(i, i / Math.max(1, rings.length - 2));
      for (let s = 0; s < seg; s++) {
        const a = rings[i][s], b = rings[i][s + 1], c2 = rings[i + 1][s + 1], d = rings[i + 1][s];
        this.tri(a, d, c2, c, e); this.tri(a, c2, b, c, e);
      }
    }
    return rings;
  }
  cyl(cx, cy, cz, r0, r1, h, seg, col, e = 0, caps = true) {
    this.lathe(cx, cy, cz, [[r0, 0], [r1, h]], seg, () => col, e);
    if (caps) for (let s = 0; s < seg; s++) {
      const a0 = s / seg * TAU, a1 = (s + 1) / seg * TAU;
      if (r1 > 0) this.tri([cx, cy + h, cz], [cx + Math.cos(a1) * r1, cy + h, cz + Math.sin(a1) * r1], [cx + Math.cos(a0) * r1, cy + h, cz + Math.sin(a0) * r1], col, e);
      if (r0 > 0) this.tri([cx, cy, cz], [cx + Math.cos(a0) * r0, cy, cz + Math.sin(a0) * r0], [cx + Math.cos(a1) * r0, cy, cz + Math.sin(a1) * r0], col, e);
    }
  }
  /** ellipsoid, smooth shaded */
  ell(cx, cy, cz, rx, ry, rz, col, e = 0, seg = 14, rings = 9, colFn = null) {
    const P = (i, j) => { const th = i / rings * Math.PI, ph = j / seg * TAU; const n = [Math.sin(th) * Math.cos(ph), Math.cos(th), Math.sin(th) * Math.sin(ph)]; return { p: [cx + n[0] * rx, cy + n[1] * ry, cz + n[2] * rz], n: norm([n[0] / rx, n[1] / ry, n[2] / rz]) }; };
    for (let i = 0; i < rings; i++) for (let j = 0; j < seg; j++) {
      const a = P(i, j), b = P(i, j + 1), c = P(i + 1, j + 1), d = P(i + 1, j);
      const cc = colFn ? colFn(a.p) : col;
      if (i > 0) this.triS(a.p, c.p, b.p, a.n, c.n, b.n, cc, cc, cc, e);
      if (i < rings - 1) this.triS(a.p, d.p, c.p, a.n, d.n, c.n, cc, cc, cc, e);
    }
  }
  /** append another builder transformed by matrix m (normals rotated, assumes uniform scale) */
  append(o, m) {
    for (let i = 0; i < o.v.length; i += 10) {
      const p = xformPt(m, [o.v[i], o.v[i + 1], o.v[i + 2]]);
      const n = [m[0] * o.v[i + 3] + m[4] * o.v[i + 4] + m[8] * o.v[i + 5], m[1] * o.v[i + 3] + m[5] * o.v[i + 4] + m[9] * o.v[i + 5], m[2] * o.v[i + 3] + m[6] * o.v[i + 4] + m[10] * o.v[i + 5]];
      const nn = norm(n);
      this.v.push(p[0], p[1], p[2], nn[0], nn[1], nn[2], o.v[i + 6], o.v[i + 7], o.v[i + 8], o.v[i + 9]);
    }
  }

  /** displaced icosphere with smooth normals. disp(p unit) -> radius multiplier, colFn(p world, n) -> rgb */
  ico(cx, cy, cz, rx, ry, rz, sub_, disp, colFn, e = 0) {
    const t = (1 + Math.sqrt(5)) / 2;
    let V = [[-1, t, 0], [1, t, 0], [-1, -t, 0], [1, -t, 0], [0, -1, t], [0, 1, t], [0, -1, -t], [0, 1, -t], [t, 0, -1], [t, 0, 1], [-t, 0, -1], [-t, 0, 1]].map(norm);
    let F = [[0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11], [1, 5, 9], [5, 11, 4], [11, 10, 2], [10, 7, 6], [7, 1, 8], [3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8], [3, 8, 9], [4, 9, 5], [2, 4, 11], [6, 2, 10], [8, 6, 7], [9, 8, 1]];
    for (let s = 0; s < sub_; s++) {
      const cache = new Map(), mid = (a, b) => { const k = a < b ? a + '_' + b : b + '_' + a; if (cache.has(k)) return cache.get(k); V.push(norm(scl(add(V[a], V[b]), 0.5))); cache.set(k, V.length - 1); return V.length - 1; };
      const NF = []; for (const [a, b, c] of F) { const ab = mid(a, b), bc = mid(b, c), ca = mid(c, a); NF.push([a, ab, ca], [b, bc, ab], [c, ca, bc], [ab, bc, ca]); } F = NF;
    }
    const P = V.map(u => { const k = disp ? disp(u) : 1; return [cx + u[0] * rx * k, cy + u[1] * ry * k, cz + u[2] * rz * k]; });
    const N = P.map(() => [0, 0, 0]);
    for (const [a, b, c] of F) { const n = cross(sub(P[b], P[a]), sub(P[c], P[a])); for (const i of [a, b, c]) { N[i][0] += n[0]; N[i][1] += n[1]; N[i][2] += n[2]; } }
    const NN = N.map(n => norm(n)), CC = P.map((p, i) => colFn(p, NN[i], V[i]));
    for (const [a, b, c] of F) this.triS(P[a], P[c], P[b], NN[a], NN[c], NN[b], CC[a], CC[c], CC[b], typeof e === 'function' ? e(P[a]) : e);
    return this;
  }
  /** tapered tube from a to b (branches, limbs) */
  tube(a, b, r0, r1, seg, col, e = 0, caps = false) {
    const d = norm(sub(b, a)), up = Math.abs(d[1]) > 0.95 ? [1, 0, 0] : [0, 1, 0], u = norm(cross(d, up)), v = cross(u, d);
    const ring = (c, r) => { const out = []; for (let s = 0; s <= seg; s++) { const ang = (s % seg) / seg * TAU, ca = Math.cos(ang), sa = Math.sin(ang); out.push({ p: [c[0] + (u[0] * ca + v[0] * sa) * r, c[1] + (u[1] * ca + v[1] * sa) * r, c[2] + (u[2] * ca + v[2] * sa) * r], n: [u[0] * ca + v[0] * sa, u[1] * ca + v[1] * sa, u[2] * ca + v[2] * sa] }); } return out; };
    const A = ring(a, r0), B = ring(b, r1), cA = typeof col === 'function' ? col(0) : col, cB = typeof col === 'function' ? col(1) : col;
    const eA = typeof e === 'function' ? e(0) : e, eB = typeof e === 'function' ? e(1) : e;
    for (let s = 0; s < seg; s++) {
      this.vert(A[s].p, A[s].n, cA, eA); this.vert(B[s].p, B[s].n, cB, eB); this.vert(B[s + 1].p, B[s + 1].n, cB, eB);
      this.vert(A[s].p, A[s].n, cA, eA); this.vert(B[s + 1].p, B[s + 1].n, cB, eB); this.vert(A[s + 1].p, A[s + 1].n, cA, eA);
    }
    if (caps) for (let s = 0; s < seg; s++) { this.tri(b, B[s + 1].p, B[s].p, cB, eB); this.tri(a, A[s].p, A[s + 1].p, cA, eA); }
    return this;
  }
  /** oriented box: centre c, axes (unit) x,y,z with half sizes hx,hy,hz */
  obox(c, X, Y, Z, hx, hy, hz, col, e = 0) {
    const P = (sx, sy, sz) => [c[0] + X[0] * hx * sx + Y[0] * hy * sy + Z[0] * hz * sz, c[1] + X[1] * hx * sx + Y[1] * hy * sy + Z[1] * hz * sz, c[2] + X[2] * hx * sx + Y[2] * hy * sy + Z[2] * hz * sz];
    const q = (a, b, cc, d, n) => { this.tri(a, b, cc, col, e, n); this.tri(a, cc, d, col, e, n); };
    const nX = X, nY = Y, nZ = Z, m = v => [-v[0], -v[1], -v[2]];
    q(P(-1, 1, -1), P(-1, 1, 1), P(1, 1, 1), P(1, 1, -1), nY); q(P(-1, -1, 1), P(-1, -1, -1), P(1, -1, -1), P(1, -1, 1), m(nY));
    q(P(-1, -1, 1), P(1, -1, 1), P(1, 1, 1), P(-1, 1, 1), nZ); q(P(1, -1, -1), P(-1, -1, -1), P(-1, 1, -1), P(1, 1, -1), m(nZ));
    q(P(1, -1, 1), P(1, -1, -1), P(1, 1, -1), P(1, 1, 1), nX); q(P(-1, -1, -1), P(-1, -1, 1), P(-1, 1, 1), P(-1, 1, -1), m(nX));
    return this;
  }
  /** append builder o moved by translation t and yaw ry (and uniform scale s) */
  place(o, t, ry = 0, s = 1) {
    const c = Math.cos(ry), sn = Math.sin(ry), v = o.v, out = this.v;
    for (let i = 0; i < v.length; i += 10) {
      const x = v[i] * s, y = v[i + 1] * s, z = v[i + 2] * s, nx = v[i + 3], nz = v[i + 5];
      out.push(t[0] + x * c + z * sn, t[1] + y, t[2] - x * sn + z * c, nx * c + nz * sn, v[i + 4], -nx * sn + nz * c, v[i + 6], v[i + 7], v[i + 8], v[i + 9]);
    }
    return this;
  }
  toArray() { return new Float32Array(this.v); }
}
