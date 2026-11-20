// ARVEX SURVIVAL — day/night cycle + weather → renderer environment, audio ambience, temperature
import { hex, lerp, clamp, mixc, norm } from '../core/math.js';

export const DAY_SEC = 2400; // one in-game day = 40 real minutes
const K = [ // time-of-day keyframes
  { t: 0.00, top: '#05070c', hor: '#0e1420', bot: '#05070a', sun: '#2a3348', amb: '#1a2233', gnd: '#0a0c10', fog: '#0c111a', grade: [0.78, 0.86, 1.08], exp: 1.25, stars: 1 },
  { t: 0.20, top: '#0a0f1c', hor: '#1c2232', bot: '#07090c', sun: '#3a3f55', amb: '#1d2536', gnd: '#0b0d10', fog: '#151a26', grade: [0.85, 0.88, 1.05], exp: 1.2, stars: 0.8 },
  { t: 0.255, top: '#2a3550', hor: '#d0805a', bot: '#2a2420', sun: '#ff9a5a', amb: '#5a5a6a', gnd: '#2a241e', fog: '#a07a68', grade: [1.08, 0.96, 0.9], exp: 1.05, stars: 0.1 },
  { t: 0.32, top: '#4d77a8', hor: '#c9c3b2', bot: '#3a3a36', sun: '#ffe2b8', amb: '#8a98a8', gnd: '#4a4234', fog: '#b6bcc0', grade: [1.02, 1.0, 0.97], exp: 1, stars: 0 },
  { t: 0.50, top: '#3f73b0', hor: '#b9cad6', bot: '#40433f', sun: '#fff3dc', amb: '#9aaabb', gnd: '#545040', fog: '#b3c3cf', grade: [1, 1, 1], exp: 1, stars: 0 },
  { t: 0.68, top: '#4672a6', hor: '#d0c7ad', bot: '#3d3b35', sun: '#ffe0b0', amb: '#94a0aa', gnd: '#4e4636', fog: '#bfbcb0', grade: [1.03, 1.0, 0.95], exp: 1, stars: 0 },
  { t: 0.745, top: '#2c3a5a', hor: '#e07a45', bot: '#2a221c', sun: '#ff8040', amb: '#6a5a5a', gnd: '#2c241c', fog: '#b07258', grade: [1.12, 0.95, 0.85], exp: 1.05, stars: 0.05 },
  { t: 0.80, top: '#0f1424', hor: '#3a2a35', bot: '#0a0a0c', sun: '#5a4060', amb: '#2a2a3a', gnd: '#0e0e12', fog: '#2a2430', grade: [0.9, 0.88, 1.02], exp: 1.15, stars: 0.6 },
  { t: 1.00, top: '#05070c', hor: '#0e1420', bot: '#05070a', sun: '#2a3348', amb: '#1a2233', gnd: '#0a0c10', fog: '#0c111a', grade: [0.78, 0.86, 1.08], exp: 1.25, stars: 1 }
].map(k => Object.assign({}, k, { top: hex(k.top), hor: hex(k.hor), bot: hex(k.bot), sun: hex(k.sun), amb: hex(k.amb), gnd: hex(k.gnd), fog: hex(k.fog) }));

export const WEATHER = {
  clear: { cloud: 0.18, dark: 0, rain: 0, fog: 1, wind: 0.25, light: 0, name: ['صحو', 'Clear'] },
  cloudy: { cloud: 0.62, dark: 0.25, rain: 0, fog: 0.85, wind: 0.45, light: 0, name: ['غائم', 'Cloudy'] },
  rain: { cloud: 0.85, dark: 0.55, rain: 0.7, fog: 0.6, wind: 0.6, light: 0, name: ['مطر', 'Rain'] },
  storm: { cloud: 1, dark: 0.8, rain: 1, fog: 0.45, wind: 1, light: 1, name: ['عاصفة', 'Storm'] },
  fog: { cloud: 0.5, dark: 0.15, rain: 0, fog: 0.22, wind: 0.12, light: 0, name: ['ضباب', 'Fog'] }
};
const NEXT = { clear: [['clear', 4], ['cloudy', 3], ['fog', 1]], cloudy: [['clear', 3], ['cloudy', 2], ['rain', 3], ['fog', 1]], rain: [['cloudy', 3], ['rain', 2], ['storm', 1.5]], storm: [['rain', 3], ['cloudy', 1]], fog: [['clear', 2], ['cloudy', 2]] };

export class Env {
  constructor(seed = 1) { this.time = 0.36; this.w = 'clear'; this.next = 'clear'; this.blend = 1; this.wT = 300; this.cur = Object.assign({}, WEATHER.clear); this.flash = 0; this.r = mk(seed); this.thunderQ = []; this.fogBase = 520; }
  get hours() { return (this.time * 24) % 24; }
  get isNight() { return this.time < 0.235 || this.time > 0.79; }
  clock() { const h = Math.floor(this.hours), m = Math.floor((this.hours - h) * 60); return (h < 10 ? '0' : '') + h + ':' + (m < 10 ? '0' : '') + m; }
  setWeather(w, instant) { if (!WEATHER[w]) return; this.next = w; this.blend = instant ? 1 : 0; if (instant) this.w = w; this.wT = 360 + this.r() * 480; }
  update(dt, authoritative = true) {
    // night runs ~1.7x faster so most of the play time is daylight
    const night = this.isNight ? 1.7 : 1;
    this.time = (this.time + dt / DAY_SEC * night) % 1;
    if (authoritative) { this.wT -= dt; if (this.wT <= 0) { const opts = NEXT[this.w], tot = opts.reduce((a, b) => a + b[1], 0); let r = this.r() * tot; for (const [w, p] of opts) { r -= p; if (r <= 0) { this.setWeather(w); break; } } } }
    if (this.blend < 1) { this.blend = Math.min(1, this.blend + dt / 45); if (this.blend >= 1) this.w = this.next; }
    const A = WEATHER[this.w], B = WEATHER[this.next], k = this.blend * this.blend * (3 - 2 * this.blend);
    for (const f of ['cloud', 'dark', 'rain', 'fog', 'wind', 'light']) this.cur[f] = lerp(A[f], B[f], k);
    // lightning
    this.flash = Math.max(0, this.flash - dt * 3);
    if (this.cur.light > 0.5 && this.r() < dt * 0.06 * this.cur.light) { this.flash = 0.9; this.thunderQ.push(1.2 + this.r() * 3); }
    this.thunder = false; this.thunderQ = this.thunderQ.map(t => t - dt).filter(t => { if (t <= 0) { this.thunder = true; return false; } return true; });
  }
  /** renderer environment */
  build(viewDist) {
    const t = this.time; let i = 0; while (i < K.length - 2 && K[i + 1].t <= t) i++;
    const a = K[i], b = K[i + 1], f = clamp((t - a.t) / (b.t - a.t), 0, 1), s = f * f * (3 - 2 * f), W = this.cur;
    const L = (x, y) => mixc(x, y, s), dark = W.dark;
    // sun path: east → south → west; moon opposite
    const ang = (t - 0.25) * Math.PI * 2, sunDir = norm([Math.cos(ang) * 0.9, Math.sin(ang), 0.35]);
    const moon = norm([-sunDir[0], -sunDir[1] * 0.9 + 0.15, -sunDir[2]]);
    const dayK = clamp(sunDir[1] * 4 + 0.2, 0, 1);
    const light = sunDir[1] > -0.02 ? sunDir : moon;
    const sunC = mixc(L(a.sun, b.sun), [0.18, 0.2, 0.26], dark * 0.75), grey = c => mixc(c, [0.42, 0.45, 0.48].map(v => v * (0.3 + 0.7 * dayK)), dark * 0.7);
    const fogC = grey(L(a.fog, b.fog)), fogF = viewDist * W.fog * (1 - W.rain * 0.25), fogN = Math.min(fogF * 0.35, 40 + fogF * 0.12);
    return {
      skyTop: grey(L(a.top, b.top)), skyHor: grey(L(a.hor, b.hor)), skyBot: L(a.bot, b.bot), sun: light, sunDir, moon, sunC: dayK > 0 ? sunC : mixc([0.2, 0.24, 0.34], [0.12, 0.13, 0.16], dark),
      amb: grey(L(a.amb, b.amb)), gnd: L(a.gnd, b.gnd), fogC, fogN, fogF, fogH: 8 + (1 - W.fog) * 30, stars: lerp(a.stars, b.stars, s) * (1 - W.cloud * 0.8), cloud: W.cloud, cloudDark: dark,
      grade: L(a.grade, b.grade), exposure: lerp(a.exp, b.exp, s) * (1 - dark * 0.08), wind: 0.2 + W.wind * 1.1, wet: clamp(W.rain * 1.2, 0, 1), rain: W.rain,
      waterShal: mixc([0.15, 0.4, 0.4], [0.06, 0.12, 0.14], 1 - dayK * 0.85), waterDeep: mixc([0.03, 0.11, 0.16], [0.01, 0.03, 0.05], 1 - dayK * 0.85),
      bloom: 0.75 + (1 - dayK) * 0.35, vig: 0.8, sat: 1.04 - dark * 0.2, con: 1.07, lift: [0.012, 0.014, 0.02]
    };
  }
  /** ambient temperature at altitude h */
  temperature(h) { const t = this.time, day = Math.sin((t - 0.3) * Math.PI * 2) * 0.5 + 0.5; return 7 + day * 14 - Math.max(0, h - 25) * 0.09 - this.cur.rain * 5 - this.cur.wind * 2; }
  serialize() { return { time: +this.time.toFixed(5), w: this.w, next: this.next, blend: +this.blend.toFixed(3) }; }
  restore(s) { if (!s) return; this.time = s.time; this.w = s.w; this.next = s.next; this.blend = s.blend; }
}
function mk(seed) { let s = seed >>> 0 || 1; return () => { s ^= s << 13; s >>>= 0; s ^= s >> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; }; }
