// ARVEX SURVIVAL — procedural audio: adaptive ambient score, environment beds (wind, rain, surf, birds, crickets, fire),
// positional sound effects. Everything is synthesised at runtime (0 bytes of audio files).
const NOTE = n => 440 * Math.pow(2, (n - 69) / 12);
const MOODS = {
  menu: { tempo: 62, prog: [[45, 52, 57, 60], [41, 48, 53, 57], [43, 50, 55, 59], [40, 47, 52, 55]], scale: [57, 59, 60, 64, 67, 69, 72], density: 0.5 },
  day: { tempo: 70, prog: [[50, 57, 62, 66], [47, 54, 59, 62], [43, 50, 55, 59], [45, 52, 57, 61]], scale: [62, 64, 66, 69, 71, 74], density: 0.25 },
  night: { tempo: 56, prog: [[44, 51, 56, 59], [40, 47, 52, 56], [42, 49, 54, 57], [39, 46, 51, 54]], scale: [56, 58, 59, 63, 66, 68], density: 0.18 },
  danger: { tempo: 96, prog: [[45, 52, 57, 60], [46, 53, 58, 61], [43, 50, 55, 58], [41, 48, 53, 56]], scale: [57, 58, 60, 63, 64], density: 0.6 }
};

// firearm sound profiles by recoil-pattern name: [loudness, crack Hz, body Hz, thump Hz, tail seconds]
const SHOTS = { pistol: [0.9, 3400, 1500, 170, 0.5], revolver: [1.1, 2900, 1050, 140, 0.8], smg: [0.8, 3800, 1800, 190, 0.35], ak: [1.15, 2600, 1100, 128, 0.95], lr: [1.0, 3200, 1500, 150, 0.7],
  semi: [1.05, 2800, 1200, 140, 0.8], bolt: [1.4, 2200, 850, 105, 1.7], shotgun: [1.45, 1800, 620, 95, 1.25] };
export class Audio {
  constructor() { this.ctx = null; this.vol = { master: 0.8, music: 0.4, sfx: 0.85, amb: 0.7 }; this.mood = 'menu'; this.combat = 0; this.step = 0; this.nextT = 0; this.amb = { wind: 0.2, rain: 0, surf: 0, birds: 0, crickets: 0, fire: 0, under: 0 }; this.listener = { p: [0, 0, 0], f: [0, 0, -1] }; }
  init() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return;
    const c = this.ctx = new AC();
    this.master = c.createGain(); this.master.connect(c.destination);
    this.under = c.createBiquadFilter(); this.under.type = 'lowpass'; this.under.frequency.value = 20000; this.under.connect(this.master);
    const comp = c.createDynamicsCompressor(); comp.threshold.value = -12; comp.ratio.value = 4; comp.connect(this.under); this.bus = comp;
    this.music = c.createGain(); this.music.connect(this.bus); this.sfx = c.createGain(); this.sfx.connect(this.bus); this.ambG = c.createGain(); this.ambG.connect(this.bus);
    this.rev = c.createConvolver(); const len = c.sampleRate * 2.4, ir = c.createBuffer(2, len, c.sampleRate);
    for (let ch = 0; ch < 2; ch++) { const d = ir.getChannelData(ch); for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2.8); }
    this.rev.buffer = ir; this.revG = c.createGain(); this.revG.gain.value = 0.3; this.rev.connect(this.revG); this.revG.connect(this.bus);
    const nb = c.createBuffer(1, c.sampleRate * 2, c.sampleRate), nd = nb.getChannelData(0); for (let i = 0; i < nd.length; i++) nd[i] = Math.random() * 2 - 1; this.noiseBuf = nb;
    // brown noise for wind/surf
    const bb = c.createBuffer(1, c.sampleRate * 4, c.sampleRate), bd = bb.getChannelData(0); let last = 0; for (let i = 0; i < bd.length; i++) { last = (last + 0.02 * (Math.random() * 2 - 1)) / 1.02; bd[i] = last * 3.5; } this.brownBuf = bb;
    const bed = (buf, type, f, q) => { const s = c.createBufferSource(); s.buffer = buf; s.loop = true; const F = c.createBiquadFilter(); F.type = type; F.frequency.value = f; F.Q.value = q; const G = c.createGain(); G.gain.value = 0; s.connect(F); F.connect(G); G.connect(this.ambG); s.start(0, Math.random() * 2); return { F, G }; };
    this.bWind = bed(this.brownBuf, 'bandpass', 380, 0.6); this.bRain = bed(this.noiseBuf, 'highpass', 1800, 0.4); this.bRainLow = bed(this.brownBuf, 'lowpass', 600, 0.5); this.bSurf = bed(this.brownBuf, 'lowpass', 500, 0.7); this.bFire = bed(this.noiseBuf, 'bandpass', 900, 1.2);
    this.applyVol(); this.nextT = c.currentTime + 0.1; this.chirpT = 0; this.cricketT = 0; this.crackT = 0;
  }
  applyVol() { if (!this.ctx) return; const t = this.ctx.currentTime; this.master.gain.setTargetAtTime(this.vol.master, t, 0.05); this.music.gain.setTargetAtTime(this.vol.music * 0.5, t, 0.05); this.sfx.gain.setTargetAtTime(this.vol.sfx, t, 0.05); this.ambG.gain.setTargetAtTime(this.vol.amb, t, 0.05); }
  setMood(m) { if (MOODS[m] && m !== this.mood) { this.mood = m; this.step = 0; } }
  setListener(p, f) { this.listener.p = p; this.listener.f = f; }
  /** per-frame: ambience targets {wind, rain, surf, birds, crickets, fire, under}, combat 0..1 */
  update(amb, combat) {
    if (!this.ctx) return;
    const c = this.ctx, t = c.currentTime; Object.assign(this.amb, amb); this.combat += ((combat || 0) - this.combat) * 0.03;
    const A = this.amb;
    this.bWind.G.gain.setTargetAtTime(0.05 + A.wind * 0.3, t, 0.4); this.bWind.F.frequency.setTargetAtTime(260 + A.wind * 700 + Math.sin(t * 0.3) * 120 * A.wind, t, 0.5);
    this.bRain.G.gain.setTargetAtTime(A.rain * 0.16 * (A.sheltered ? 0.45 : 1), t, 0.5); this.bRainLow.G.gain.setTargetAtTime(A.rain * 0.22, t, 0.5);
    this.bSurf.G.gain.setTargetAtTime(A.surf * (0.18 + 0.14 * Math.sin(t * 0.45)), t, 0.3); this.bFire.G.gain.setTargetAtTime(A.fire * 0.05, t, 0.3);
    this.under.frequency.setTargetAtTime(A.under ? 500 : 20000, t, 0.08);
    if (A.birds > 0.05 && t > this.chirpT) { this.chirpT = t + 0.6 + Math.random() * 3.5 / A.birds; this.bird(t, A.birds); }
    if (A.crickets > 0.05 && t > this.cricketT) { this.cricketT = t + 0.25 + Math.random() * 0.6; this.cricket(t, A.crickets); }
    if (A.fire > 0.05 && t > this.crackT) { this.crackT = t + 0.05 + Math.random() * 0.35; this.noise(t, 0.03, 0.06 * A.fire * Math.random(), 2500 + Math.random() * 3000, 'bandpass', this.ambG, 2); }
    const M = MOODS[this.mood], spb = 60 / M.tempo / 2;
    while (this.nextT < t + 0.25) { this.tick(this.nextT, M, spb); this.nextT += spb; this.step++; }
  }
  tick(t, M, spb) {
    const s = this.step, bar = Math.floor(s / 8) % M.prog.length, ch = M.prog[bar], beat = s % 8;
    if (beat === 0 && (s / 8) % 2 === 0) for (const n of ch) this.pad(t, NOTE(n), spb * 16, 0.035);
    if (beat === 0) this.bass(t, NOTE(ch[0] - 12), spb * 6, 0.09);
    if (Math.random() < M.density * 0.35) this.pluck(t, NOTE(M.scale[Math.floor(Math.random() * M.scale.length)] + (Math.random() < 0.3 ? 12 : 0)), 0.035);
    const k = this.combat;
    if (k > 0.08) { if (beat % 4 === 0) this.kick(t, 0.45 * k); if (beat === 4) this.snare(t, 0.16 * k); this.noise(t, 0.04, (beat % 2 ? 0.03 : 0.06) * k, 7000, 'highpass', this.music); if (beat % 2 === 0) this.osc('sawtooth', NOTE(ch[0] - 12), t, spb * 0.9, 0.035 * k, this.music, 0.01); }
  }
  osc(type, f, t, d, g, dest, attack = 0.01) { const c = this.ctx, o = c.createOscillator(), G = c.createGain(); o.type = type; o.frequency.setValueAtTime(f, t); G.gain.setValueAtTime(0.0001, t); G.gain.exponentialRampToValueAtTime(Math.max(g, 0.0002), t + attack); G.gain.exponentialRampToValueAtTime(0.0001, t + d); o.connect(G); G.connect(dest); o.start(t); o.stop(t + d + 0.05); return { o, G }; }
  pad(t, f, d, g) { const c = this.ctx, F = c.createBiquadFilter(); F.type = 'lowpass'; F.frequency.value = 900; F.connect(this.music); F.connect(this.rev); for (const det of [-6, 6]) { const x = this.osc('sawtooth', f, t, d, g, F, d * 0.35); x.o.detune.value = det; } }
  bass(t, f, d, g) { const c = this.ctx, F = c.createBiquadFilter(); F.type = 'lowpass'; F.frequency.value = 300; F.connect(this.music); this.osc('triangle', f, t, d, g, F, 0.05); }
  pluck(t, f, g) { const c = this.ctx, F = c.createBiquadFilter(); F.type = 'lowpass'; F.frequency.setValueAtTime(2600, t); F.frequency.exponentialRampToValueAtTime(400, t + 0.6); F.connect(this.music); F.connect(this.rev); this.osc('triangle', f, t, 1.4, g, F, 0.004); }
  kick(t, g) { const c = this.ctx, o = c.createOscillator(), G = c.createGain(); o.frequency.setValueAtTime(130, t); o.frequency.exponentialRampToValueAtTime(42, t + 0.18); G.gain.setValueAtTime(g, t); G.gain.exponentialRampToValueAtTime(0.0001, t + 0.3); o.connect(G); G.connect(this.music); o.start(t); o.stop(t + 0.35); }
  snare(t, g) { this.noise(t, 0.16, g, 1800, 'highpass', this.music); }
  noise(t, d, g, f, type = 'highpass', dest = this.sfx, q = 0.8) { const c = this.ctx, s = c.createBufferSource(), F = c.createBiquadFilter(), G = c.createGain(); s.buffer = this.noiseBuf; F.type = type; F.frequency.setValueAtTime(f, t); F.Q.value = q; G.gain.setValueAtTime(Math.max(g, 0.0001), t); G.gain.exponentialRampToValueAtTime(0.0001, t + d); s.connect(F); F.connect(G); G.connect(dest); s.start(t, Math.random()); s.stop(t + d + 0.05); return { F, G, s }; }
  bird(t, k) { const base = 2400 + Math.random() * 1800, n = 2 + Math.floor(Math.random() * 4), p = this.panner([this.listener.p[0] + (Math.random() - 0.5) * 60, this.listener.p[1] + 8, this.listener.p[2] + (Math.random() - 0.5) * 60]); for (let i = 0; i < n; i++) { const o = this.osc('sine', base, t + i * 0.11, 0.09, 0.02 * k, p, 0.005); o.o.frequency.exponentialRampToValueAtTime(base * (1.2 + Math.random() * 0.4), t + i * 0.11 + 0.07); } }
  cricket(t, k) { const p = this.panner([this.listener.p[0] + (Math.random() - 0.5) * 30, this.listener.p[1], this.listener.p[2] + (Math.random() - 0.5) * 30]); for (let i = 0; i < 3; i++) this.osc('square', 4300 + Math.random() * 200, t + i * 0.045, 0.025, 0.006 * k, p, 0.002); }
  panner(pos) {
    const c = this.ctx, p = c.createPanner(); p.panningModel = 'equalpower'; p.distanceModel = 'inverse'; p.refDistance = 3; p.maxDistance = 120; p.rolloffFactor = 1.2;
    const L = this.listener;
    // listener-relative position (robust on every browser)
    const dx = pos[0] - L.p[0], dy = pos[1] - L.p[1], dz = pos[2] - L.p[2], f = L.f, r = [-f[2], 0, f[0]], rl = Math.hypot(r[0], r[2]) || 1;
    const x = (dx * r[0] + dz * r[2]) / rl, z = -(dx * f[0] + dz * f[2]) / (Math.hypot(f[0], f[2]) || 1);
    if (p.positionX) { p.positionX.value = x; p.positionY.value = dy; p.positionZ.value = z; } else p.setPosition(x, dy, z);
    p.connect(this.sfx); return p;
  }
  /** surface: grass|sand|rock|wood|metal|water|snow */
  footstep(surface, k = 1) {
    if (!this.ctx) return; const t = this.ctx.currentTime, S = this.sfx, v = (0.7 + Math.random() * 0.3) * k;
    switch (surface) {
      case 'sand': this.noise(t, 0.12, 0.09 * v, 1400, 'bandpass', S, 0.6); break;
      case 'rock': this.noise(t, 0.05, 0.12 * v, 2200, 'bandpass', S, 1.5); this.osc('sine', 180 + Math.random() * 40, t, 0.06, 0.05 * v, S, 0.002); break;
      case 'wood': this.osc('triangle', 120 + Math.random() * 30, t, 0.09, 0.1 * v, S, 0.002); this.noise(t, 0.05, 0.06 * v, 900, 'bandpass', S, 2); break;
      case 'metal': this.osc('square', 300 + Math.random() * 60, t, 0.08, 0.03 * v, S, 0.002); this.noise(t, 0.08, 0.05 * v, 3500, 'bandpass', S, 3); break;
      case 'water': { const n = this.noise(t, 0.25, 0.12 * v, 900, 'lowpass', S, 1); n.F.frequency.exponentialRampToValueAtTime(300, t + 0.2); break; }
      case 'snow': this.noise(t, 0.14, 0.08 * v, 3000, 'lowpass', S, 0.4); break;
      default: this.noise(t, 0.09, 0.08 * v, 2600, 'bandpass', S, 0.5); this.noise(t, 0.06, 0.05 * v, 500, 'lowpass', S, 0.5);
    }
  }
  /** positional or 2D sound effects */
  /** UI sounds have their own slider; 1.25 keeps the old loudness at the default 80 % */
  uiVol() { return (this.vol.ui == null ? 0.8 : this.vol.ui) * 1.25; }
  /** a firearm going off. pat: the weapon's sound profile (its recoil pattern name). pos: where it was fired, for somebody else's shot —
   *  those carry much further than other sounds, arrive late by the speed of sound and lose their top end with distance. mech: 'pump' | 'bolt' action afterwards. */
  gunshot(pat, k = 1, pos, mech) {
    if (!this.ctx) return; const c = this.ctx, [g, hi, mid, lo, tail] = SHOTS[pat] || SHOTS[pat === 'rifle' ? 'semi' : 'pistol'], L = this.listener;
    let t = c.currentTime, S = this.sfx, far = 0;
    if (pos) { const d = Math.hypot(pos[0] - L.p[0], pos[1] - L.p[1], pos[2] - L.p[2]); far = Math.min(1, d / 280); t += Math.min(0.9, d / 343);
      const p = this.panner(pos); p.refDistance = 24; p.rolloffFactor = 1; p.maxDistance = 700; const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 700 + 15000 * Math.pow(1 - far, 2.2); lp.connect(p); S = lp; }
    const v = g * k, near = 1 - far, j = 0.94 + Math.random() * 0.12;
    this.noise(t, 0.03, 0.8 * v * (0.3 + near * 0.7), hi * j, 'highpass', S, 0.6);                                                  // the crack
    const b = this.noise(t, 0.1 + tail * 0.06, 0.75 * v, mid * j, 'bandpass', S, 0.7); b.F.frequency.exponentialRampToValueAtTime(mid * 0.35, t + 0.1);   // the body
    const o = this.osc('sine', lo * j, t, 0.2 + tail * 0.08, 0.6 * v, S, 0.001); o.o.frequency.exponentialRampToValueAtTime(lo * 0.3, t + 0.16);          // the thump in the chest
    const lw = this.noise(t, 0.22 + tail * 0.1, 0.5 * v, 800, 'lowpass', S, 0.7); lw.F.frequency.exponentialRampToValueAtTime(110, t + 0.2);
    const tl = this.noise(t + 0.03, tail, 0.2 * v, 1500, 'lowpass', S, 0.4); tl.F.frequency.exponentialRampToValueAtTime(200, t + tail);                 // the roll-off across open ground
    this.noise(t + 0.02, tail, 0.2 * v * (pos ? 0.5 + far * 0.5 : 1), 650, 'lowpass', this.rev, 0.5);
    if (pos) return;
    this.noise(t + 0.04, 0.018, 0.07, 4300, 'bandpass', this.sfx, 4); this.osc('triangle', 1900, t + 0.04, 0.02, 0.02, this.sfx, 0.001);                // the action cycling
    const clack = (dt, f) => { this.noise(t + dt, 0.05, 0.13, f, 'bandpass', this.sfx, 3); this.osc('triangle', f * 0.35, t + dt, 0.04, 0.05, this.sfx, 0.001); };
    if (mech === 'pump') { clack(0.42, 1700); clack(0.6, 1400); } else if (mech === 'bolt') { clack(0.5, 2300); clack(0.68, 1500); clack(0.95, 1900); clack(1.1, 2600); }
  }
  play(name, k = 1, pos) {
    if (!this.ctx) return; if (name.startsWith('gun_')) return this.gunshot(name.slice(4), k, pos);
    const c = this.ctx, t = c.currentTime, S = pos ? this.panner(pos) : this.sfx;
    switch (name) {
      case 'swing': { const n = this.noise(t, 0.18, 0.12 * k, 600, 'bandpass', S, 0.8); n.F.frequency.exponentialRampToValueAtTime(2200, t + 0.15); break; }
      case 'chop': this.osc('triangle', 105 + Math.random() * 25, t, 0.12, 0.13 * k, S, 0.002); this.noise(t, 0.08, 0.08 * k, 1500, 'bandpass', S, 1.4); this.noise(t + 0.02, 0.2, 0.03 * k, 4000, 'highpass', S); break;
      case 'treefall': { const n = this.noise(t, 1.8, 0.12, 700, 'lowpass', S, 0.7); n.F.frequency.exponentialRampToValueAtTime(160, t + 1.6); [0.1, 0.35, 0.7].forEach(d => this.noise(t + d, 0.12, 0.08, 1800, 'bandpass', S, 2)); this.noise(t + 1.6, 0.7, 0.16, 300, 'lowpass', S); break; }
      case 'stone': this.osc('triangle', 700 + Math.random() * 250, t, 0.05, 0.035 * k, S, 0.001); this.noise(t, 0.07, 0.1 * k, 3400, 'bandpass', S, 1.8); this.noise(t, 0.14, 0.035 * k, 900, 'lowpass', S); break;
      case 'ore': this.osc('triangle', 1300 + Math.random() * 400, t, 0.2, 0.035 * k, S, 0.001); this.osc('sine', 2600, t, 0.14, 0.018, S, 0.001); this.noise(t, 0.08, 0.1 * k, 3400, 'bandpass', S, 1.8); break;
      case 'rockbreak': { const n = this.noise(t, 0.6, 0.14, 1100, 'lowpass', S, 0.7); n.F.frequency.exponentialRampToValueAtTime(200, t + 0.5); for (let i = 0; i < 5; i++) this.noise(t + 0.05 + Math.random() * 0.4, 0.05, 0.04, 2500 + Math.random() * 2000, 'bandpass', S, 2); break; }
      case 'crumble': for (let i = 0; i < 3; i++) this.noise(t + Math.random() * 0.15, 0.04, 0.025 * k, 2000 + Math.random() * 2500, 'bandpass', S, 2); break;
      case 'splinter': this.noise(t, 0.25, 0.07 * k, 2200, 'bandpass', S, 1); this.osc('triangle', 180, t, 0.08, 0.05 * k, S, 0.002); break;
      case 'flesh': this.noise(t, 0.12, 0.22 * k, 700, 'lowpass', S, 1.2); this.osc('sine', 110, t, 0.08, 0.1 * k, S, 0.002); break;
      case 'wood_hit': this.osc('triangle', 150, t, 0.12, 0.18 * k, S, 0.002); this.noise(t, 0.08, 0.12 * k, 1500, 'bandpass', S, 1.5); break;
      case 'metal_hit': this.osc('square', 680, t, 0.25, 0.05 * k, S, 0.001); this.osc('triangle', 1450, t, 0.4, 0.04 * k, S, 0.001); this.noise(t, 0.08, 0.12, 4000, 'bandpass', S, 2); break;
      case 'bowdraw': { const o = this.osc('sawtooth', 70, t, 0.6, 0.025, S, 0.3); o.o.frequency.linearRampToValueAtTime(110, t + 0.6); this.noise(t, 0.5, 0.03, 2000, 'bandpass', S, 6); break; }
      case 'bowshot': this.osc('triangle', 220, t, 0.12, 0.2, S, 0.001); { const n = this.noise(t, 0.3, 0.15, 3000, 'bandpass', S, 1); n.F.frequency.exponentialRampToValueAtTime(600, t + 0.3); } break;
      case 'xbowshot': this.osc('square', 140, t, 0.1, 0.18, S, 0.001); this.noise(t, 0.16, 0.3, 1800, 'bandpass', S, 1); this.osc('triangle', 900, t + 0.02, 0.2, 0.05, S, 0.001); break;
      case 'reload': this.noise(t, 0.06, 0.12, 2500, 'bandpass', S, 3); this.osc('square', 320, t + 0.25, 0.05, 0.05, S, 0.001); this.noise(t + 0.5, 0.06, 0.12, 2200, 'bandpass', S, 3); break;
      case 'empty': this.osc('square', 1800, t, 0.03, 0.04, this.sfx, 0.001); break;
      case 'impact': this.noise(t, 0.05, 0.12 * k, 2500, 'bandpass', S, 2); break;
      case 'arrowhit': this.osc('triangle', 300, t, 0.08, 0.15 * k, S, 0.001); this.noise(t, 0.06, 0.14, 1200, 'bandpass', S, 2); break;
      case 'silenced': { const n = this.noise(t, 0.09, 0.22 * k, 1900, 'bandpass', S, 1.2); n.F.frequency.exponentialRampToValueAtTime(600, t + 0.08); this.osc('triangle', 180, t, 0.05, 0.08 * k, S, 0.001); this.noise(t + 0.02, 0.06, 0.05, 5200, 'highpass', S); break; }
      case 'headshot': this.osc('sine', 2300, t, 0.07, 0.09, this.sfx, 0.001); this.osc('triangle', 1150, t + 0.03, 0.12, 0.06, this.sfx, 0.001); this.noise(t, 0.03, 0.08, 5000, 'highpass', this.sfx); break;
      case 'hitmarker': this.osc('sine', 1500, t, 0.05, 0.07, this.sfx, 0.001); break;
      case 'hurt': { this.noise(t, 0.22, 0.35 * k, 500, 'lowpass', this.sfx, 1); const o = this.osc('sawtooth', 160, t, 0.2, 0.06 * k, this.sfx, 0.004); o.o.frequency.exponentialRampToValueAtTime(90, t + 0.2); break; }
      case 'death': { const o = this.osc('sawtooth', 220, t, 1.4, 0.12, this.sfx, 0.01); o.o.frequency.exponentialRampToValueAtTime(40, t + 1.3); this.noise(t, 1.4, 0.3, 500, 'lowpass', this.sfx); this.pad(t + 0.4, NOTE(45), 3, 0.05); break; }
      case 'jump': this.noise(t, 0.1, 0.06, 900, 'bandpass', this.sfx, 0.6); break;
      case 'land': this.noise(t, 0.16, 0.18 * k, 400, 'lowpass', this.sfx, 0.6); this.osc('sine', 80, t, 0.12, 0.12 * k, this.sfx, 0.002); break;
      case 'splash': { const n = this.noise(t, 0.6, 0.3 * k, 1500, 'lowpass', S, 0.7); n.F.frequency.exponentialRampToValueAtTime(300, t + 0.5); break; }
      case 'eat': for (let i = 0; i < 3; i++) this.noise(t + i * 0.16, 0.08, 0.12, 1800 + Math.random() * 800, 'bandpass', this.sfx, 1.5); break;
      case 'drink': for (let i = 0; i < 4; i++) { const o = this.osc('sine', 300 + Math.random() * 120, t + i * 0.2, 0.12, 0.08, this.sfx, 0.01); o.o.frequency.exponentialRampToValueAtTime(180, t + i * 0.2 + 0.1); } break;
      case 'bandage': this.noise(t, 0.5, 0.08, 3000, 'bandpass', this.sfx, 0.7); this.noise(t + 0.6, 0.4, 0.06, 2500, 'bandpass', this.sfx, 0.7); break;
      case 'craft': this.noise(t, 0.08, 0.08, 2000, 'bandpass', this.sfx, 2); this.osc('triangle', 300, t + 0.1, 0.08, 0.04, this.sfx, 0.002); break;
      case 'craftdone': [67, 71, 74].forEach((n, i) => this.osc('triangle', NOTE(n), t + i * 0.06, 0.3, 0.05, this.sfx, 0.003)); break;
      case 'pickup': this.osc('sine', 700, t, 0.08, 0.06, this.sfx, 0.002); this.osc('sine', 1050, t + 0.05, 0.1, 0.05, this.sfx, 0.002); break;
      case 'explode': { const n = this.noise(t, 1.7, 0.95 * k, 900, 'lowpass', S, 0.6); n.F.frequency.exponentialRampToValueAtTime(70, t + 1.4); this.osc('sine', 62, t, 0.9, 0.5 * k, S, 0.004); this.osc('triangle', 38, t, 1.3, 0.35 * k, S, 0.01); this.noise(t, 0.09, 0.5 * k, 3200, 'highpass', S); for (let i = 0; i < 6; i++) this.noise(t + 0.3 + Math.random() * 0.9, 0.06, 0.05 * k, 1500 + Math.random() * 2500, 'bandpass', S, 2); break; }
      case 'fuse': { const n = this.noise(t, 0.5, 0.05 * k, 5200, 'highpass', S); this.osc('square', 1900, t, 0.04, 0.03 * k, S, 0.001); this.osc('square', 1900, t + 0.25, 0.04, 0.03 * k, S, 0.001); break; }
      case 'lock': this.osc('square', 520, t, 0.04, 0.06, S, 0.001); this.noise(t + 0.05, 0.05, 0.1, 3000, 'bandpass', S, 3); this.osc('triangle', 240, t + 0.08, 0.06, 0.06, S, 0.001); break;
      case 'build': this.osc('triangle', 110, t, 0.2, 0.25, S, 0.002); this.noise(t, 0.2, 0.2, 900, 'bandpass', S, 1); this.osc('triangle', 140, t + 0.12, 0.2, 0.18, S, 0.002); break;
      case 'upgrade': this.noise(t, 0.4, 0.2, 1200, 'bandpass', S, 0.8); [60, 64, 67].forEach((n, i) => this.osc('triangle', NOTE(n), t + i * 0.07, 0.25, 0.06, this.sfx, 0.003)); break;
      case 'demolish': { const n = this.noise(t, 0.8, 0.18, 800, 'lowpass', S, 0.7); n.F.frequency.exponentialRampToValueAtTime(150, t + 0.7); for (let i = 0; i < 4; i++) this.noise(t + Math.random() * 0.4, 0.06, 0.05, 1800, 'bandpass', S, 2); break; }
      case 'door': { const o = this.osc('sawtooth', 90, t, 0.35, 0.05, S, 0.05); o.o.frequency.linearRampToValueAtTime(140, t + 0.3); this.osc('triangle', 120, t + 0.32, 0.1, 0.12, S, 0.002); break; }
      case 'open': this.noise(t, 0.15, 0.08, 1200, 'bandpass', this.sfx, 1); this.osc('triangle', 220, t, 0.08, 0.05, this.sfx, 0.002); break;
      case 'close': this.osc('triangle', 160, t, 0.1, 0.08, this.sfx, 0.002); break;
      case 'firelight': { const n = this.noise(t, 0.8, 0.2, 400, 'lowpass', S, 0.8); n.F.frequency.exponentialRampToValueAtTime(2500, t + 0.4); break; }
      case 'deer': { const o = this.osc('sawtooth', 600, t, 0.35, 0.05, S, 0.02); o.o.frequency.exponentialRampToValueAtTime(380, t + 0.3); break; }
      case 'wolf': { const o = this.osc('sine', 380, t, 2.4, 0.09, S, 0.4); o.o.frequency.linearRampToValueAtTime(620, t + 0.8); o.o.frequency.linearRampToValueAtTime(420, t + 2.3); const o2 = this.osc('sine', 760, t, 2.4, 0.02, this.rev, 0.4); o2.o.frequency.linearRampToValueAtTime(1240, t + 0.8); break; }
      case 'growl': { this.noise(t, 0.9, 0.3, 220, 'lowpass', S, 2); this.osc('sawtooth', 70, t, 0.9, 0.08, S, 0.1); break; }
      case 'grunt': this.noise(t, 0.25, 0.25, 350, 'lowpass', S, 2); this.osc('square', 95, t, 0.2, 0.05, S, 0.01); break;
      case 'bite': this.noise(t, 0.1, 0.3, 1400, 'bandpass', S, 1); this.osc('square', 140, t, 0.08, 0.08, S, 0.002); break;
      case 'thunder': { const n = this.noise(t, 3.2, 0.55 * k, 250, 'lowpass', this.sfx, 0.7); n.F.frequency.exponentialRampToValueAtTime(60, t + 3); const n2 = this.noise(t, 0.3, 0.3 * k, 1500, 'lowpass', this.sfx); break; }
      case 'ui': this.osc('sine', 900, t, 0.05, 0.045 * this.uiVol(), this.sfx, 0.002); break;
      case 'uiok': this.osc('triangle', 660, t, 0.08, 0.06 * this.uiVol(), this.sfx, 0.002); this.osc('triangle', 990, t + 0.05, 0.1, 0.05 * this.uiVol(), this.sfx, 0.002); break;
      case 'uiback': this.osc('triangle', 500, t, 0.07, 0.05 * this.uiVol(), this.sfx, 0.002); break;
      case 'fail': [55, 52].forEach((n, i) => this.osc('triangle', NOTE(n), t + i * 0.1, 0.18, 0.06, this.sfx, 0.004)); break;
      case 'warn': this.osc('square', 880, t, 0.1, 0.04, this.sfx, 0.002); this.osc('square', 880, t + 0.16, 0.1, 0.04, this.sfx, 0.002); break;
      case 'join': [64, 69].forEach((n, i) => this.osc('sine', NOTE(n), t + i * 0.08, 0.2, 0.04, this.sfx, 0.004)); break;
      case 'leave': [69, 64].forEach((n, i) => this.osc('sine', NOTE(n), t + i * 0.08, 0.2, 0.035, this.sfx, 0.004)); break;
      case 'levelup': [60, 64, 67, 72].forEach((n, i) => this.osc('triangle', NOTE(n), t + i * 0.08, 0.5, 0.06, this.rev, 0.004)); break;
    }
  }
}
