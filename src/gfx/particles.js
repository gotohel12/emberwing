// EMBERWING — pooled CPU particles (additive glow + alpha smoke)
export class Particles {
  constructor(max = 4000) { this.max = max; this.list = []; this.mult = 1; this.outA = []; this.outB = []; }
  /** spec: p, v, life, s0, s1, c0, c1, a, g (gravity), drag, blend:'add'|'alpha' */
  emit(spec, n = 1) {
    const k = Math.max(0, Math.round(n * this.mult + (Math.random() < (n * this.mult) % 1 ? 1 : 0)));
    for (let i = 0; i < k; i++) {
      if (this.list.length >= this.max) this.list.shift();
      const s = typeof spec === 'function' ? spec(i) : spec;
      this.list.push({ p: s.p.slice(), v: s.v ? s.v.slice() : [0, 0, 0], t: 0, life: s.life || 1, s0: s.s0 || 10, s1: s.s1 == null ? s.s0 || 10 : s.s1, c0: s.c0 || [1, 1, 1], c1: s.c1 || s.c0 || [1, 1, 1], a: s.a == null ? 1 : s.a, g: s.g || 0, drag: s.drag || 0, blend: s.blend || 'add' });
    }
  }
  update(dt) {
    const L = this.list; let j = 0;
    for (let i = 0; i < L.length; i++) {
      const q = L[i]; q.t += dt; if (q.t >= q.life) continue;
      const dr = Math.exp(-q.drag * dt);
      q.v[0] *= dr; q.v[1] = q.v[1] * dr - q.g * dt; q.v[2] *= dr;
      q.p[0] += q.v[0] * dt; q.p[1] += q.v[1] * dt; q.p[2] += q.v[2] * dt;
      L[j++] = q;
    }
    L.length = j;
  }
  build() {
    const A = this.outA, B = this.outB; A.length = 0; B.length = 0;
    for (const q of this.list) {
      const k = q.t / q.life, fade = k < 0.15 ? k / 0.15 : 1 - (k - 0.15) / 0.85;
      const c = [q.c0[0] + (q.c1[0] - q.c0[0]) * k, q.c0[1] + (q.c1[1] - q.c0[1]) * k, q.c0[2] + (q.c1[2] - q.c0[2]) * k];
      (q.blend === 'add' ? A : B).push({ p: q.p, s: q.s0 + (q.s1 - q.s0) * k, c, a: q.a * fade });
    }
    return [A, B];
  }
  clear() { this.list.length = 0; }
}
