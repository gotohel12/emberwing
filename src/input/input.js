// EMBERWING — unified input: keyboard, mouse (pointer lock), any gamepad (standard + raw PlayStation/Xbox maps), touch
const DEF_KEYS = {
  up: ['KeyW', 'ArrowUp'], down: ['KeyS', 'ArrowDown'], left: ['KeyA', 'ArrowLeft'], right: ['KeyD', 'ArrowRight'],
  flap: ['Space'], dive: ['ControlLeft', 'KeyC'], dash: ['ShiftLeft', 'Mouse0'], flare: ['KeyE', 'Mouse2'], pause: ['Escape', 'KeyP']
};
export const ACTION_NAMES = { up: 'طيران لفوق', down: 'نزول لتحت', left: 'يسار', right: 'يمين', flap: 'رفرفة (طيران لفوق)', dive: 'غطس', dash: 'اندفاع ناري', flare: 'وهج النور', pause: 'إيقاف' };

export class Input {
  constructor() {
    this.keys = new Set(); this.prev = {}; this.mouse = { dx: 0, dy: 0, locked: false };
    this.binds = JSON.parse(JSON.stringify(DEF_KEYS));
    this.set = { sens: 1, invertY: false, deadzone: 0.18, vib: true, mouseSteer: true };
    this.touch = { x: 0, y: 0, flap: 0, dive: 0, dash: 0, flare: 0, active: false };
    this.device = 'kb'; this.padName = ''; this.padSeen = false; this.navRepeat = {};
    this.listeners = [];
    addEventListener('keydown', e => {
      if (this.capture) { e.preventDefault(); const f = this.capture; this.capture = null; f(e.code); return; }
      if (e.target && e.target.tagName === 'INPUT' && !['range', 'checkbox'].includes(e.target.type)) return;
      this.keys.add(e.code); this.device = 'kb';
      if (this.gameActive && ['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Tab', 'ControlLeft', 'ShiftLeft'].includes(e.code)) e.preventDefault();
    });
    addEventListener('keyup', e => this.keys.delete(e.code));
    addEventListener('blur', () => this.keys.clear());
    addEventListener('mousedown', e => {
      if (this.capture) { e.preventDefault(); const f = this.capture; this.capture = null; f('Mouse' + e.button); return; }
      if (this.gameActive && e.target && e.target.id === 'gl') { this.keys.add('Mouse' + e.button); this.device = 'kb'; }
    });
    addEventListener('mouseup', e => this.keys.delete('Mouse' + e.button));
    addEventListener('contextmenu', e => { if (this.gameActive) e.preventDefault(); });
    addEventListener('mousemove', e => { if (this.mouse.locked) { this.mouse.dx += e.movementX || 0; this.mouse.dy += e.movementY || 0; } });
    document.addEventListener('pointerlockchange', () => { this.mouse.locked = !!document.pointerLockElement; });
    addEventListener('gamepadconnected', e => { this.padSeen = true; this.padName = e.gamepad.id; this.device = 'pad'; this.emit('pad', e.gamepad); });
    addEventListener('gamepaddisconnected', () => this.emit('padoff'));
  }
  on(f) { this.listeners.push(f); }
  emit(t, d) { for (const f of this.listeners) f(t, d); }
  lock(canvas) { if (!this.set.mouseSteer || this.isTouch()) return; try { const r = canvas.requestPointerLock && canvas.requestPointerLock(); if (r && r.catch) r.catch(() => {}); } catch (e) {} }
  unlock() { try { if (document.pointerLockElement) document.exitPointerLock(); } catch (e) {} }
  isTouch() { return matchMedia('(pointer:coarse)').matches || 'ontouchstart' in window; }
  load(saved) { if (saved && saved.binds) for (const k in DEF_KEYS) if (saved.binds[k]) this.binds[k] = saved.binds[k]; if (saved && saved.set) Object.assign(this.set, saved.set); }
  dump() { return { binds: this.binds, set: this.set }; }
  resetBinds() { this.binds = JSON.parse(JSON.stringify(DEF_KEYS)); }
  has(list) { for (const k of list) if (this.keys.has(k)) return true; return false; }
  /** read every connected pad and normalise it to a standard layout */
  pads() {
    let arr = []; try { arr = navigator.getGamepads ? [...navigator.getGamepads()] : []; } catch (e) {}
    const out = [];
    for (const p of arr) {
      if (!p || !p.connected) continue;
      const b = i => { const x = p.buttons[i]; return x ? (typeof x === 'object' ? (x.pressed || x.value > 0.5) : x > 0.5) : false; };
      const bv = i => { const x = p.buttons[i]; return x ? (typeof x === 'object' ? x.value : x) : 0; };
      const ax = i => p.axes[i] || 0;
      const sony = /054c|playstation|dualshock|dualsense/i.test(p.id) || (/wireless controller/i.test(p.id) && !/xbox|045e|microsoft/i.test(p.id));
      let s;
      if (p.mapping === 'standard' || !sony) {
        s = { lx: ax(0), ly: ax(1), rx: ax(2), ry: ax(3), A: b(0), B: b(1), X: b(2), Y: b(3), LB: b(4), RB: b(5), LT: bv(6), RT: bv(7), back: b(8), start: b(9), up: b(12), down: b(13), left: b(14), right: b(15) };
        if (p.mapping !== 'standard' && p.axes.length >= 6 && p.buttons.length < 12) { s.LT = (ax(2) + 1) / 2; s.RT = (ax(5) + 1) / 2; s.rx = ax(3); s.ry = ax(4); }
      } else {
        // raw DirectInput PlayStation layout: 0 ▢ 1 ✕ 2 ◯ 3 △ 4 L1 5 R1 6 L2 7 R2 8 share 9 options
        s = { lx: ax(0), ly: ax(1), rx: ax(2), ry: ax(5), A: b(1), B: b(2), X: b(0), Y: b(3), LB: b(4), RB: b(5), LT: b(6) ? 1 : (ax(3) + 1) / 2 * (p.axes.length > 5 ? 1 : 0), RT: b(7) ? 1 : (ax(4) + 1) / 2 * (p.axes.length > 5 ? 1 : 0), back: b(8), start: b(9), up: false, down: false, left: false, right: false };
        if (p.axes.length > 9) { const h = ax(9); if (h > -1.1 && h < 1.1 && Math.abs(h) < 1.05) { s.up = Math.abs(h + 1) < 0.1; s.right = Math.abs(h + 0.43) < 0.1; s.down = Math.abs(h - 0.14) < 0.1; s.left = Math.abs(h - 0.71) < 0.1; } }
      }
      s.sony = sony; s.id = p.id; s.index = p.index; s.pad = p;
      const any = s.A || s.B || s.X || s.Y || s.start || Math.abs(s.lx) > 0.5 || Math.abs(s.ly) > 0.5 || s.RT > 0.5;
      if (any) { this.device = 'pad'; this.padSeen = true; this.padName = p.id; this.padSony = sony; }
      out.push(s);
    }
    return out;
  }
  dz(v) { const d = this.set.deadzone; return Math.abs(v) < d ? 0 : Math.sign(v) * (Math.abs(v) - d) / (1 - d); }
  /** gameplay state, call once per frame */
  read() {
    const B = this.binds, o = { x: 0, y: 0, flap: 0, dive: 0, dash: 0, flare: 0, pause: 0, mx: this.mouse.dx, my: this.mouse.dy };
    this.mouse.dx = 0; this.mouse.dy = 0;
    o.x = (this.has(B.right) ? 1 : 0) - (this.has(B.left) ? 1 : 0);
    o.y = (this.has(B.up) ? 1 : 0) - (this.has(B.down) ? 1 : 0);
    o.flap = this.has(B.flap) ? 1 : 0; o.dive = this.has(B.dive) ? 1 : 0;
    let dash = this.has(B.dash), flare = this.has(B.flare), pause = this.has(B.pause);
    for (const s of this.pads()) {
      const lx = this.dz(s.lx), ly = this.dz(s.ly);
      if (Math.abs(lx) > Math.abs(o.x)) o.x = lx;
      if (Math.abs(ly) > Math.abs(o.y)) o.y = -ly;
      if (s.A) o.flap = 1; if (s.LT > 0.35) o.dive = Math.max(o.dive, s.LT);
      if (s.RB || s.X || s.RT > 0.6) dash = true; if (s.B || s.LB) flare = true; if (s.start) pause = true;
    }
    if (this.touch.active) { if (Math.abs(this.touch.x) > Math.abs(o.x)) o.x = this.touch.x; if (Math.abs(this.touch.y) > Math.abs(o.y)) o.y = this.touch.y; o.flap |= this.touch.flap; o.dive = Math.max(o.dive, this.touch.dive); dash = dash || this.touch.dash; flare = flare || this.touch.flare; }
    o.dash = dash && !this.prev.dash ? 1 : 0; o.flare = flare && !this.prev.flare ? 1 : 0; o.pause = pause && !this.prev.pause ? 1 : 0;
    this.prev.dash = dash; this.prev.flare = flare; this.prev.pause = pause;
    o.x *= this.set.sens; o.y *= this.set.sens * (this.set.invertY ? -1 : 1);
    o.x = Math.max(-1, Math.min(1, o.x)); o.y = Math.max(-1, Math.min(1, o.y));
    o.mx *= this.set.sens; o.my = -o.my * this.set.sens * (this.set.invertY ? -1 : 1);
    return o;
  }
  /** menu navigation edges (keyboard arrows / pad dpad+stick / confirm / back) with auto-repeat */
  nav(dt) {
    const st = { up: this.keys.has('ArrowUp'), down: this.keys.has('ArrowDown'), left: this.keys.has('ArrowLeft'), right: this.keys.has('ArrowRight'), ok: this.keys.has('Enter'), back: this.keys.has('Escape') };
    for (const s of this.pads()) {
      st.up = st.up || s.up || s.ly < -0.6; st.down = st.down || s.down || s.ly > 0.6; st.left = st.left || s.left || s.lx < -0.6; st.right = st.right || s.right || s.lx > 0.6;
      st.ok = st.ok || s.A; st.back = st.back || s.B || s.start && false;
      st.start = st.start || s.start;
    }
    const out = {};
    for (const k in st) {
      const r = this.navRepeat[k] || (this.navRepeat[k] = { on: false, t: 0 });
      if (st[k] && !r.on) { out[k] = 1; r.t = 0.38; }
      else if (st[k] && ['up', 'down', 'left', 'right'].includes(k)) { r.t -= dt; if (r.t <= 0) { out[k] = 1; r.t = 0.11; } }
      r.on = st[k];
    }
    return out;
  }
  rumble(strong, weak, ms) {
    if (!this.set.vib) return;
    for (const s of this.pads()) { const a = s.pad.vibrationActuator; if (a && a.playEffect) a.playEffect('dual-rumble', { duration: ms, strongMagnitude: strong, weakMagnitude: weak }).catch(() => {}); }
    if (this.isTouch() && navigator.vibrate && strong > 0.5) navigator.vibrate(Math.min(ms, 120));
  }
  keyName(c) {
    const M = { Space: 'SPACE', ShiftLeft: 'L-SHIFT', ShiftRight: 'R-SHIFT', ControlLeft: 'L-CTRL', ControlRight: 'R-CTRL', Escape: 'ESC', Enter: 'ENTER', Mouse0: 'كليك يسار', Mouse1: 'كليك الوسط', Mouse2: 'كليك يمين', ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→', Tab: 'TAB' };
    return M[c] || c.replace(/^Key|^Digit/, '');
  }
}
