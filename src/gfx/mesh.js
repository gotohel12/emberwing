// EMBERWING — procedural mesh builder. Vertex = pos(3) normal(3) color(3) + emissive(1)
import { cross, sub, norm, xformPt, TAU } from '../core/math.js';

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
}
