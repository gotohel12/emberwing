// EMBERWING — procedural audio: adaptive music (calm + combat layers), wind bed, sound effects
const NOTE = n => 440 * Math.pow(2, (n - 69) / 12);
// per-world harmonic palettes (MIDI roots + chord shapes)
const MOODS = {
  menu: { tempo: 76, prog: [[50, 57, 62, 66], [47, 54, 59, 62], [43, 50, 55, 59], [45, 52, 57, 61]], scale: [62, 64, 66, 69, 71, 74, 76, 78] },
  dawn: { tempo: 84, prog: [[50, 57, 62, 66], [55, 59, 62, 67], [47, 54, 59, 62], [52, 57, 61, 64]], scale: [62, 64, 66, 69, 71, 74, 76, 78] },
  glass: { tempo: 92, prog: [[52, 59, 64, 67], [48, 55, 60, 64], [55, 62, 67, 71], [50, 57, 62, 66]], scale: [64, 66, 67, 71, 72, 74, 76, 79] },
  thunder: { tempo: 104, prog: [[45, 52, 57, 60], [41, 48, 53, 57], [43, 50, 55, 58], [40, 47, 52, 55]], scale: [57, 59, 60, 62, 64, 65, 67, 69] },
  ash: { tempo: 96, prog: [[49, 56, 61, 64], [45, 52, 57, 61], [47, 54, 59, 62], [44, 51, 56, 59]], scale: [61, 63, 64, 66, 68, 69, 71, 73] },
  hollow: { tempo: 112, prog: [[38, 45, 50, 53], [39, 46, 51, 54], [36, 43, 48, 51], [41, 48, 53, 56]], scale: [50, 51, 53, 55, 57, 58, 62, 63] },
  victory: { tempo: 96, prog: [[50, 57, 62, 66], [55, 62, 67, 71], [57, 64, 69, 73], [50, 57, 62, 66]], scale: [62, 66, 69, 74, 78, 81] }
};

export class Audio {
  constructor() { this.ctx = null; this.vol = { master: 0.8, music: 0.55, sfx: 0.85, amb: 0.6 }; this.mood = 'menu'; this.combat = 0; this.speed = 0; this.step = 0; this.nextT = 0; }
  init() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return;
    const c = this.ctx = new AC();
    this.master = c.createGain(); this.master.connect(c.destination);
    const comp = c.createDynamicsCompressor(); comp.threshold.value = -14; comp.ratio.value = 4; comp.connect(this.master); this.bus = comp;
    this.music = c.createGain(); this.music.connect(this.bus);
    this.sfx = c.createGain(); this.sfx.connect(this.bus);
    this.ambG = c.createGain(); this.ambG.connect(this.bus);
    // reverb (generated impulse)
    this.rev = c.createConvolver(); const len = c.sampleRate * 2.6, ir = c.createBuffer(2, len, c.sampleRate);
    for (let ch = 0; ch < 2; ch++) { const d = ir.getChannelData(ch); for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2.6); }
    this.rev.buffer = ir; this.revG = c.createGain(); this.revG.gain.value = 0.35; this.rev.connect(this.revG); this.revG.connect(this.bus);
    // noise buffer
    const nb = c.createBuffer(1, c.sampleRate * 2, c.sampleRate), nd = nb.getChannelData(0); for (let i = 0; i < nd.length; i++) nd[i] = Math.random() * 2 - 1; this.noiseBuf = nb;
    // wind bed
    const w = c.createBufferSource(); w.buffer = nb; w.loop = true; this.windF = c.createBiquadFilter(); this.windF.type = 'bandpass'; this.windF.frequency.value = 400; this.windF.Q.value = 0.7;
    this.windG = c.createGain(); this.windG.gain.value = 0; w.connect(this.windF); this.windF.connect(this.windG); this.windG.connect(this.ambG); w.start();
    this.applyVol(); this.nextT = c.currentTime + 0.1;
  }
  applyVol() { if (!this.ctx) return; const t = this.ctx.currentTime; this.master.gain.setTargetAtTime(this.vol.master, t, 0.05); this.music.gain.setTargetAtTime(this.vol.music * 0.5, t, 0.05); this.sfx.gain.setTargetAtTime(this.vol.sfx, t, 0.05); this.ambG.gain.setTargetAtTime(this.vol.amb, t, 0.05); }
  setMood(m) { if (MOODS[m]) { this.mood = m; this.step = 0; } }
  /** called every frame */
  update(speed01, combat01) {
    if (!this.ctx) return;
    const c = this.ctx, t = c.currentTime;
    this.speed = speed01; this.combat += (combat01 - this.combat) * 0.05;
    this.windG.gain.setTargetAtTime(0.02 + speed01 * speed01 * 0.22, t, 0.15); this.windF.frequency.setTargetAtTime(250 + speed01 * 1600, t, 0.2);
    const M = MOODS[this.mood], spb = 60 / M.tempo / 2; // eighth notes
    while (this.nextT < t + 0.25) { this.tick(this.nextT, M, spb); this.nextT += spb; this.step++; }
  }
  tick(t, M, spb) {
    const s = this.step, bar = Math.floor(s / 8) % M.prog.length, ch = M.prog[bar], beat = s % 8;
    if (beat === 0) for (const n of ch) this.pad(t, NOTE(n), spb * 8, 0.05);
    if (beat === 0) this.bass(t, NOTE(ch[0] - 12), spb * 3, 0.16);
    if (beat === 4) this.bass(t, NOTE(ch[0] - 12), spb * 2, 0.1);
    // arpeggio (calm layer)
    const arp = [0, 2, 1, 3, 2, 1, 3, 2][beat]; if (Math.random() < 0.82) this.pluck(t, NOTE(ch[arp] + 12), 0.05 + this.speed * 0.02);
    if (Math.random() < 0.12 && this.mood !== 'menu') this.bell(t, NOTE(M.scale[Math.floor(Math.random() * M.scale.length)] + 12), 0.035);
    // combat layer: drums + driving bass
    const k = this.combat;
    if (k > 0.05) {
      if (beat % 4 === 0) this.kick(t, 0.5 * k);
      if (beat % 4 === 2) this.snare(t, 0.22 * k);
      this.hat(t, (beat % 2 ? 0.05 : 0.09) * k);
      if (beat % 2 === 1) this.bass(t, NOTE(ch[0] - 12 + (beat === 7 ? 7 : 0)), spb * 0.9, 0.1 * k);
    } else if (beat === 0 && this.mood !== 'menu') this.kick(t, 0.12);
  }
  // ---------- instruments
  osc(type, f, t, d, g, dest, attack = 0.01, rel = null) {
    const c = this.ctx, o = c.createOscillator(), G = c.createGain(); o.type = type; o.frequency.setValueAtTime(f, t);
    G.gain.setValueAtTime(0, t); G.gain.linearRampToValueAtTime(g, t + attack); G.gain.exponentialRampToValueAtTime(0.0001, t + (rel || d));
    o.connect(G); G.connect(dest); o.start(t); o.stop(t + (rel || d) + 0.05); return { o, G };
  }
  pad(t, f, d, g) {
    const c = this.ctx, F = c.createBiquadFilter(); F.type = 'lowpass'; F.frequency.setValueAtTime(900 + this.combat * 900, t); F.connect(this.music); F.connect(this.rev);
    for (const det of [-7, 0, 7]) { const x = this.osc('sawtooth', f, t, d, g / 3, F, d * 0.35, d * 1.05); x.o.detune.value = det; }
  }
  bass(t, f, d, g) { const c = this.ctx, F = c.createBiquadFilter(); F.type = 'lowpass'; F.frequency.value = 420; F.connect(this.music); this.osc('triangle', f, t, d, g, F, 0.01); this.osc('sine', f / 2, t, d, g * 0.6, F, 0.01); }
  pluck(t, f, g) { const c = this.ctx, F = c.createBiquadFilter(); F.type = 'lowpass'; F.frequency.setValueAtTime(3200, t); F.frequency.exponentialRampToValueAtTime(500, t + 0.3); F.connect(this.music); F.connect(this.rev); this.osc('square', f, t, 0.35, g, F, 0.004); }
  bell(t, f, g) { const x = this.osc('sine', f, t, 1.6, g, this.rev, 0.005); this.osc('sine', f * 2.76, t, 0.6, g * 0.4, this.rev, 0.005); return x; }
  kick(t, g) { const c = this.ctx, o = c.createOscillator(), G = c.createGain(); o.frequency.setValueAtTime(140, t); o.frequency.exponentialRampToValueAtTime(40, t + 0.18); G.gain.setValueAtTime(g, t); G.gain.exponentialRampToValueAtTime(0.0001, t + 0.3); o.connect(G); G.connect(this.music); o.start(t); o.stop(t + 0.35); }
  noise(t, d, g, f, type = 'highpass', dest = this.music, q = 0.8) { const c = this.ctx, s = c.createBufferSource(), F = c.createBiquadFilter(), G = c.createGain(); s.buffer = this.noiseBuf; F.type = type; F.frequency.setValueAtTime(f, t); F.Q.value = q; G.gain.setValueAtTime(g, t); G.gain.exponentialRampToValueAtTime(0.0001, t + d); s.connect(F); F.connect(G); G.connect(dest); s.start(t, Math.random()); s.stop(t + d + 0.05); return { F, G }; }
  snare(t, g) { this.noise(t, 0.16, g, 1800); this.osc('triangle', 190, t, 0.1, g * 0.5, this.music); }
  hat(t, g) { this.noise(t, 0.05, g, 7000); }
  // ---------- sfx
  play(name, k = 1) {
    if (!this.ctx) return; const t = this.ctx.currentTime, S = this.sfx;
    switch (name) {
      case 'flap': { const n = this.noise(t, 0.22, 0.25 * k, 500, 'bandpass', S, 1.2); n.F.frequency.exponentialRampToValueAtTime(180, t + 0.2); break; }
      case 'ember': { const f = NOTE(74 + [0, 2, 4, 7, 9, 12, 14, 16][Math.min(7, k | 0)]); this.osc('sine', f, t, 0.35, 0.12, S, 0.003); this.osc('sine', f * 2, t, 0.2, 0.05, this.rev, 0.003); break; }
      case 'feather': for (let i = 0; i < 5; i++) this.osc('sine', NOTE(76 + [0, 4, 7, 12, 16][i]), t + i * 0.07, 0.8, 0.09, this.rev, 0.004); break;
      case 'ring': { const o = this.osc('sine', 500, t, 0.4, 0.12, S, 0.005); o.o.frequency.exponentialRampToValueAtTime(1400, t + 0.3); this.noise(t, 0.4, 0.15, 2500, 'highpass', S); break; }
      case 'dash': { const n = this.noise(t, 0.45, 0.4, 300, 'lowpass', S, 1); n.F.frequency.exponentialRampToValueAtTime(3000, t + 0.15); this.osc('sawtooth', 110, t, 0.3, 0.12, S, 0.01); break; }
      case 'flare': { this.kick(t, 0.6); const n = this.noise(t, 1.2, 0.35, 2000, 'lowpass', S); n.F.frequency.exponentialRampToValueAtTime(200, t + 1); this.osc('sine', NOTE(62), t, 1.2, 0.15, this.rev, 0.01); this.osc('sine', NOTE(69), t, 1.2, 0.1, this.rev, 0.01); break; }
      case 'hit': { this.noise(t, 0.3, 0.4, 900, 'lowpass', S); const o = this.osc('square', 220, t, 0.25, 0.12, S, 0.003); o.o.frequency.exponentialRampToValueAtTime(70, t + 0.25); break; }
      case 'bump': this.noise(t, 0.2, 0.25 * k, 400, 'lowpass', S); break;
      case 'kill': { const o = this.osc('sawtooth', 600, t, 0.4, 0.1, S, 0.003); o.o.frequency.exponentialRampToValueAtTime(60, t + 0.4); this.noise(t, 0.5, 0.25, 1200, 'bandpass', S); break; }
      case 'leech': this.osc('sine', 90 + Math.random() * 20, t, 0.15, 0.08, S, 0.01); break;
      case 'shrine': for (let i = 0; i < 3; i++) this.osc('sine', NOTE(69 + i * 5), t + i * 0.1, 1.4, 0.1, this.rev, 0.01); break;
      case 'charge': this.osc('triangle', NOTE(50 + Math.round(k * 24)), t, 0.2, 0.06, S, 0.01); break;
      case 'beacon': { this.kick(t, 0.8); [62, 66, 69, 74, 78, 81].forEach((n, i) => this.bell(t + i * 0.09, NOTE(n), 0.12)); this.noise(t, 2.5, 0.25, 3000, 'highpass', this.rev); break; }
      case 'death': { const o = this.osc('sawtooth', 300, t, 1.2, 0.15, S, 0.01); o.o.frequency.exponentialRampToValueAtTime(40, t + 1.2); this.noise(t, 1.2, 0.3, 600, 'lowpass', S); break; }
      case 'warn': this.osc('square', 880, t, 0.12, 0.05, S, 0.003); break;
      case 'thunder': { const n = this.noise(t, 2.4, 0.5, 300, 'lowpass', S); n.F.frequency.exponentialRampToValueAtTime(80, t + 2); break; }
      case 'lancer': { const o = this.osc('sawtooth', 200, t, 0.6, 0.08, S, 0.2); o.o.frequency.exponentialRampToValueAtTime(800, t + 0.6); break; }
      case 'boss': { this.osc('sawtooth', 55, t, 2, 0.2, S, 0.2); this.noise(t, 2, 0.3, 200, 'lowpass', this.rev); break; }
      case 'ui': this.osc('sine', 880, t, 0.06, 0.06, S, 0.002); break;
      case 'uiok': this.osc('sine', 660, t, 0.1, 0.07, S, 0.002); this.osc('sine', 990, t + 0.06, 0.12, 0.06, S, 0.002); break;
      case 'uiback': this.osc('sine', 520, t, 0.08, 0.06, S, 0.002); break;
      case 'buy': [72, 76, 79, 84].forEach((n, i) => this.osc('triangle', NOTE(n), t + i * 0.05, 0.25, 0.07, S, 0.003)); break;
      case 'fail': [60, 58, 55].forEach((n, i) => this.osc('triangle', NOTE(n), t + i * 0.18, 0.5, 0.08, S, 0.01)); break;
    }
  }
}
