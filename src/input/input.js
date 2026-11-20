// ARVEX SURVIVAL — unified input: keyboard + mouse (pointer lock), gamepads (standard / raw PlayStation), touch.
// Movement output is camera-relative and fixed: move[0] = right(+)/left(−), move[1] = forward(+)/back(−).
const DEF_KEYS = {
  forward: ['KeyW', 'ArrowUp'], back: ['KeyS', 'ArrowDown'], left: ['KeyA', 'ArrowLeft'], right: ['KeyD', 'ArrowRight'],
  jump: ['Space'], crouch: ['ControlLeft', 'KeyC'], sprint: ['ShiftLeft'], walk: ['AltLeft'],
  attack: ['Mouse0'], aim: ['Mouse2'], interact: ['KeyE'], reload: ['KeyR'], inventory: ['Tab', 'KeyI'], craft: ['KeyQ'], drop: ['KeyG'], map: ['KeyM'], chat: ['Enter'], pause: ['Escape']
};
export const ACTIONS = ['forward', 'back', 'left', 'right', 'jump', 'crouch', 'sprint', 'walk', 'attack', 'aim', 'interact', 'reload', 'inventory', 'craft', 'drop', 'map'];
export const ACTION_NAMES = {
  forward: ['للأمام', 'Forward'], back: ['للخلف', 'Backward'], left: ['يسار', 'Left'], right: ['يمين', 'Right'], jump: ['قفز', 'Jump'], crouch: ['انحناء', 'Crouch'], sprint: ['ركض سريع', 'Sprint'], walk: ['مشي هادي', 'Walk'],
  attack: ['ضرب / استخدام', 'Attack / Use'], aim: ['تصويب / قائمة', 'Aim / Menu'], interact: ['تفاعل', 'Interact'], reload: ['تلقيم / تدوير', 'Reload / Rotate'], inventory: ['الحقيبة', 'Inventory'], craft: ['الصناعة', 'Crafting'], drop: ['رمي الغرض', 'Drop item'], map: ['الخريطة', 'Map']
};

export class Input {
  constructor() {
    this.keys = new Set(); this.prev = {}; this.mouse = { dx: 0, dy: 0, locked: false, wheel: 0 };
    this.binds = JSON.parse(JSON.stringify(DEF_KEYS));
    this.set = { sens: 1, invertY: false, deadzone: 0.16, vib: true, padSens: 1, toggleCrouch: false };
    this.touch = { mx: 0, mz: 0, ldx: 0, ldy: 0, jump: 0, crouch: 0, sprint: 0, attack: 0, aim: 0, interact: 0, reload: 0, active: false };
    this.device = 'kb'; this.padName = ''; this.padSeen = false; this.navRepeat = {}; this.listeners = []; this.gameActive = false; this.hotPressed = -1; this.crouchLatch = false;
    addEventListener('keydown', e => {
      if (this.capture) { e.preventDefault(); const f = this.capture; this.capture = null; f(e.code); return; }
      if (e.target && (e.target.tagName === 'INPUT' && !['range', 'checkbox'].includes(e.target.type) || e.target.tagName === 'TEXTAREA')) return;
      this.keys.add(e.code); this.device = 'kb';
      if (/^Digit[1-6]$/.test(e.code)) this.hotPressed = +e.code[5] - 1;
      if (this.gameActive && ['Space', 'Tab', 'ControlLeft', 'ShiftLeft', 'AltLeft', 'ArrowUp', 'ArrowDown', 'KeyQ'].includes(e.code)) e.preventDefault();
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
    addEventListener('wheel', e => { if (this.gameActive && this.mouse.locked) this.mouse.wheel += Math.sign(e.deltaY); }, { passive: true });
    document.addEventListener('pointerlockchange', () => { this.mouse.locked = !!document.pointerLockElement; });
    addEventListener('gamepadconnected', e => { this.padSeen = true; this.padName = e.gamepad.id; this.device = 'pad'; this.emit('pad', e.gamepad); });
    addEventListener('gamepaddisconnected', () => this.emit('padoff'));
  }
  on(f) { this.listeners.push(f); }
  emit(t, d) { for (const f of this.listeners) f(t, d); }
  lock(canvas) { if (this.isTouch()) return; try { const r = canvas.requestPointerLock && canvas.requestPointerLock(); if (r && r.catch) r.catch(() => {}); } catch (e) {} }
  unlock() { try { if (document.pointerLockElement) document.exitPointerLock(); } catch (e) {} }
  isTouch() { return matchMedia('(pointer:coarse)').matches || ('ontouchstart' in window && !matchMedia('(pointer:fine)').matches); }
  load(saved) { if (saved && saved.binds) for (const k in DEF_KEYS) if (saved.binds[k]) this.binds[k] = saved.binds[k]; if (saved && saved.set) Object.assign(this.set, saved.set); }
  dump() { return { binds: this.binds, set: this.set }; }
  resetBinds() { this.binds = JSON.parse(JSON.stringify(DEF_KEYS)); }
  has(list) { for (const k of list) if (this.keys.has(k)) return true; return false; }
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
      if (p.mapping === 'standard' || !sony) s = { lx: ax(0), ly: ax(1), rx: ax(2), ry: ax(3), A: b(0), B: b(1), X: b(2), Y: b(3), LB: b(4), RB: b(5), LT: bv(6), RT: bv(7), back: b(8), start: b(9), LS: b(10), RS: b(11), up: b(12), down: b(13), left: b(14), right: b(15) };
      else s = { lx: ax(0), ly: ax(1), rx: ax(2), ry: ax(5), A: b(1), B: b(2), X: b(0), Y: b(3), LB: b(4), RB: b(5), LT: b(6) ? 1 : 0, RT: b(7) ? 1 : 0, back: b(8), start: b(9), LS: b(10), RS: b(11), up: false, down: false, left: false, right: false };
      s.sony = sony; s.pad = p;
      if (s.A || s.B || s.X || s.Y || s.start || Math.abs(s.lx) > 0.5 || Math.abs(s.ly) > 0.5 || s.RT > 0.5) { this.device = 'pad'; this.padSeen = true; this.padName = p.id; this.padSony = sony; }
      out.push(s);
    }
    return out;
  }
  dz(v) { const d = this.set.deadzone; return Math.abs(v) < d ? 0 : Math.sign(v) * (Math.abs(v) - d) / (1 - d); }
  edge(name, on) { const e = on && !this.prev[name]; this.prev[name] = on; return e ? 1 : 0; }
  /** gameplay state, once per frame. dt for gamepad look integration */
  read(dt) {
    const B = this.binds, o = { move: [0, 0], lookX: 0, lookY: 0 };
    const msens = 0.0022 * this.set.sens;
    o.lookX = this.mouse.dx * msens; o.lookY = -this.mouse.dy * msens * (this.set.invertY ? -1 : 1);
    this.mouse.dx = 0; this.mouse.dy = 0; o.wheel = this.mouse.wheel; this.mouse.wheel = 0;
    // keyboard: D/→ = +right, A/← = −right, W/↑ = +forward, S/↓ = −forward
    o.move[0] = (this.has(B.right) ? 1 : 0) - (this.has(B.left) ? 1 : 0);
    o.move[1] = (this.has(B.forward) ? 1 : 0) - (this.has(B.back) ? 1 : 0);
    let jump = this.has(B.jump), crouch = this.has(B.crouch), sprint = this.has(B.sprint), attack = this.has(B.attack), aim = this.has(B.aim), interact = this.has(B.interact), reload = this.has(B.reload), inv = false, craft = false, drop = this.has(B.drop), map = false, pause = false, chat = false;
    o.walk = this.has(B.walk); let hotNext = false, hotPrev = false;
    for (const s of this.pads()) {
      const lx = this.dz(s.lx), ly = this.dz(s.ly), rx = this.dz(s.rx), ry = this.dz(s.ry);
      if (Math.abs(lx) > Math.abs(o.move[0])) o.move[0] = lx;
      if (Math.abs(ly) > Math.abs(o.move[1])) o.move[1] = -ly; // stick up (−1) → forward (+1)
      const ps = 2.6 * this.set.padSens * dt; o.lookX += Math.sign(rx) * rx * rx * ps; o.lookY += -Math.sign(ry) * ry * ry * ps * 0.75 * (this.set.invertY ? -1 : 1);
      jump = jump || s.A; crouch = crouch || s.B; sprint = sprint || s.LS; attack = attack || s.RT > 0.5; aim = aim || s.LT > 0.5; interact = interact || s.X; reload = reload || s.RS; inv = inv || s.Y; pause = pause || s.start; drop = drop || s.down; map = map || s.back;
      if (this.edge('padRB', s.RB)) hotNext = true; if (this.edge('padLB', s.LB)) hotPrev = true;
    }
    const T = this.touch;
    if (T.active) {
      if (Math.abs(T.mx) > Math.abs(o.move[0])) o.move[0] = T.mx; if (Math.abs(T.mz) > Math.abs(o.move[1])) o.move[1] = T.mz;
      o.lookX += T.ldx * 0.0055 * this.set.sens; o.lookY += -T.ldy * 0.0055 * this.set.sens; T.ldx = 0; T.ldy = 0;
      jump = jump || T.jump; sprint = sprint || T.sprint; attack = attack || T.attack; aim = aim || T.aim; interact = interact || T.interact; reload = reload || T.reload;
      if (this.edge('tCrouch', T.crouch)) this.crouchLatch = !this.crouchLatch;
      if (T.sprint && T.mz > 0.85) sprint = true;
    }
    if (this.set.toggleCrouch && !T.active) { if (this.edge('kCrouch', crouch)) this.crouchLatch = !this.crouchLatch; o.crouch = this.crouchLatch; } else o.crouch = crouch || (T.active && this.crouchLatch);
    const ml = Math.hypot(o.move[0], o.move[1]); if (ml > 1) { o.move[0] /= ml; o.move[1] /= ml; }
    o.jump = jump; o.jumpPress = this.edge('jump', jump); o.sprint = sprint; o.attack = attack; o.attackPress = this.edge('attack', attack); o.attackRelease = !attack && this.prev.attackWas ? 1 : 0; this.prev.attackWas = attack;
    o.aim = aim; o.aimPress = this.edge('aim', aim); o.aimRelease = !aim && this.prev.aimWas ? 1 : 0; this.prev.aimWas = aim;
    o.interact = this.edge('interact', interact); o.interactHold = interact; o.reload = this.edge('reload', reload); o.inventory = this.edge('inv', inv); o.craft = this.edge('craft', craft); o.drop = this.edge('drop', drop); o.map = this.edge('map', map); o.pause = this.edge('pause', pause); o.chat = this.edge('chat', chat);
    o.hot = this.hotPressed; this.hotPressed = -1; o.hotNext = hotNext || o.wheel > 0; o.hotPrev = hotPrev || o.wheel < 0;
    return o;
  }
  /** menu navigation edges with auto-repeat */
  nav(dt) {
    const st = { up: this.keys.has('ArrowUp'), down: this.keys.has('ArrowDown'), left: this.keys.has('ArrowLeft'), right: this.keys.has('ArrowRight'), ok: this.keys.has('Enter'), back: this.keys.has('Escape') };
    for (const s of this.pads()) { st.up = st.up || s.up || s.ly < -0.6; st.down = st.down || s.down || s.ly > 0.6; st.left = st.left || s.left || s.lx < -0.6; st.right = st.right || s.right || s.lx > 0.6; st.ok = st.ok || s.A; st.back = st.back || s.B; }
    const out = {};
    for (const k in st) {
      const r = this.navRepeat[k] || (this.navRepeat[k] = { on: false, t: 0 });
      if (st[k] && !r.on) { out[k] = 1; r.t = 0.38; } else if (st[k] && ['up', 'down', 'left', 'right'].includes(k)) { r.t -= dt; if (r.t <= 0) { out[k] = 1; r.t = 0.11; } }
      r.on = st[k];
    }
    return out;
  }
  rumble(strong, weak, ms) {
    if (!this.set.vib) return;
    for (const s of this.pads()) { const a = s.pad.vibrationActuator; if (a && a.playEffect) a.playEffect('dual-rumble', { duration: ms, strongMagnitude: strong, weakMagnitude: weak }).catch(() => {}); }
    if (this.isTouch() && navigator.vibrate && strong > 0.4) navigator.vibrate(Math.min(ms, 80));
  }
  keyName(c) {
    const M = { Space: 'SPACE', ShiftLeft: 'SHIFT', ShiftRight: 'R-SHIFT', ControlLeft: 'CTRL', ControlRight: 'R-CTRL', AltLeft: 'ALT', Escape: 'ESC', Enter: 'ENTER', Mouse0: 'LMB', Mouse1: 'MMB', Mouse2: 'RMB', ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→', Tab: 'TAB' };
    return M[c] || c.replace(/^Key|^Digit/, '');
  }
}
