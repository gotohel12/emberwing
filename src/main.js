// EMBERWING — application shell: boot, settings, game flow, save, main loop, PWA updates
import { Renderer } from './gfx/renderer.js';
import { Particles } from './gfx/particles.js';
import { Audio } from './audio/audio.js';
import { Input } from './input/input.js';
import { UI } from './ui/ui.js';
import { Level } from './game/level.js';
import { WORLDS, DIFF, UPGRADES } from './world/worlds.js';
import { SKINS } from './gfx/models.js';
import { loadSave, writeSave, freshSave, wipeSave } from './game/save.js';
import { ModelLib } from './gfx/assets.js';
import { phoenixModels } from './game/level.js';
import { Net } from './net/net.js';

const VERSION = '2.0.0';
const PRESETS = {
  low: { scale: 0.6, maxDpr: 1, bloom: false, particles: 0.45, detail: 0.45 },
  medium: { scale: 0.8, maxDpr: 1.25, bloom: true, particles: 0.75, detail: 0.7 },
  high: { scale: 1, maxDpr: 1.5, bloom: true, particles: 1, detail: 1 },
  ultra: { scale: 1, maxDpr: 2, bloom: true, particles: 1.4, detail: 1.3 }
};
const SDEF = { preset: 'high', scale: 1, maxDpr: 1.5, bloom: true, particles: 1, detail: 1, showFps: false, master: 0.8, music: 0.55, sfx: 0.85, amb: 0.6, hints: true, shake: true, flashes: true, uiScale: 1, hiContrast: false, subtitles: true, touchSize: 1 };

class App {
  constructor() {
    this.VERSION = VERSION;
    this.isDesktop = /^(127\.0\.0\.1|localhost)$/.test(location.hostname) && location.port === '47331';
    this.S = Object.assign({}, SDEF, this.ls('emberwing.settings') || {});
    if (!this.ls('emberwing.settings')) this.S = Object.assign(this.S, this.autoPreset());
    this.save = loadSave();
    this.input = new Input(); this.input.load(this.ls('emberwing.input'));
    this.audio = new Audio(); this.particles = new Particles(5000);
    const cv = document.getElementById('gl');
    try { this.R = new Renderer(cv); } catch (e) { document.getElementById('fatal').innerHTML = `<h1>EMBERWING</h1><p>ما قدرنا نشغّل الرسوم (WebGL) على هالجهاز أو المتصفح. جرّب كروم أو سفاري محدّث.</p><small>${String(e.message).slice(0, 160)}</small>`; document.getElementById('fatal').classList.add('on'); throw e; }
    this.ui = new UI(this); this.ui.buildHUD(); document.body.classList.toggle('touch', this.input.isTouch());
    this.net = new Net(this); this.mp = null;
    this.level = null; this.menuLevel = null; this.state = 'boot'; this.paused = false; this.clock = 0; this.fps = 60; this.prevScreen = 'title';
    this.applySettings();
    addEventListener('resize', () => this.R.resize());
    addEventListener('keydown', e => { if (this.state === 'play' && (e.code === 'Escape' || e.code === 'KeyP') && !this.input.capture) { e.preventDefault(); (this.paused || this.mpMenu) ? this.resume() : this.pause(); } });
    document.addEventListener('visibilitychange', () => { if (document.hidden && this.state === 'play' && !this.paused) this.pause(); });
    document.addEventListener('pointerlockchange', () => { if (!document.pointerLockElement && this.state === 'play' && !this.paused && this.input.set.mouseSteer && !this.input.isTouch() && this.input.device === 'kb') this.pause(); });
    cv.addEventListener('click', () => { if (this.state === 'play' && !this.paused) this.input.lock(cv); });
    this.input.on((t) => { if (t === 'pad') { this.ui.toast('🎮 يد التحكم اتصلت', 'ok'); if (this.ui.screen === 'title') this.ui.title(); } if (t === 'padoff') this.ui.toast('🎮 يد التحكم انفصلت', 'warn'); });
    addEventListener('pointerdown', () => this.audio.init(), { once: false });
    addEventListener('keydown', () => this.audio.init());
    if (this.isDesktop) { const ping = () => fetch('/__ping', { cache: 'no-store' }).catch(() => {}); ping(); setInterval(ping, 5000); }
    this.boot();
  }
  ls(k) { try { return JSON.parse(localStorage.getItem(k) || 'null'); } catch (e) { return null; } }
  autoPreset() { const touch = matchMedia('(pointer:coarse)').matches, weak = (navigator.hardwareConcurrency || 4) <= 4 && (navigator.deviceMemory || 4) <= 3; const k = touch ? (weak ? 'low' : 'medium') : 'high'; return Object.assign({ preset: k }, PRESETS[k]); }
  applyPreset(p) { if (PRESETS[p]) Object.assign(this.S, PRESETS[p]); }
  applySettings() {
    const S = this.S;
    this.R.setQuality({ scale: S.scale, bloom: S.bloom, maxDpr: S.maxDpr });
    this.particles.mult = S.particles; this.treeQ = S.detail || 1;
    Object.assign(this.audio.vol, { master: S.master, music: S.music, sfx: S.sfx, amb: S.amb }); this.audio.applyVol();
    document.documentElement.style.setProperty('--ui', S.uiScale); document.documentElement.style.setProperty('--tsz', S.touchSize);
    document.body.classList.toggle('hic', !!S.hiContrast); document.body.classList.toggle('nosub', !S.subtitles);
  }
  persist() { try { localStorage.setItem('emberwing.settings', JSON.stringify(this.S)); localStorage.setItem('emberwing.input', JSON.stringify(this.input.dump())); } catch (e) {} writeSave(this.save); }
  async boot() {
    const tips = ['اغطس عشان تجمع سرعة، وارفع خشمك عشان تطلع فوق ببلاش', 'المزارات ترجع لهبك وتصير نقطة رجوع', 'الاندفاع الناري يخليك ما تنضرب وتكسر الأعداء', 'الريش مخفي: تحت الجزر، فوق بالعالي، وعند حافة العاصفة'];
    this.ui.loading(0.05, tips[0]);
    for (let k = 0; k < 3 && !this.lib; k++) {
      try { this.lib = await ModelLib.load('assets/ew_models.bin?v=' + VERSION); }
      catch (e) { console.warn(e); this.ui.loading(0.1, 'نعيد تحميل الموديلات…'); await new Promise(r => setTimeout(r, 800)); }
    }
    if (!this.lib) { document.getElementById('fatal').innerHTML = '<h1>EMBERWING</h1><p>ما قدرنا نحمّل ملفات اللعبة. تأكد من الإنترنت وحدّث الصفحة.</p>'; document.getElementById('fatal').classList.add('on'); return; }
    for (let i = 3; i <= 10; i++) { this.ui.loading(i / 10, tips[Math.floor(i / 3) % tips.length]); await new Promise(r => setTimeout(r, 50)); if (i === 5) this.startMenuScene(); }
    this.state = 'menu'; this.ui.title(); this.registerSW();
    this.loop(performance.now());
  }
  startMenuScene() {
    if (this.menuLevel) return;
    const wi = Math.min(this.nextWorld(), WORLDS.length - 1);
    this.menuLevel = new Level(this, WORLDS[wi], wi, { demo: true, DIFF, diff: 'normal', up: this.save.up, skin: this.skinObj() });
    this.audio.setMood('menu');
  }
  skinObj() { return SKINS.find(s => s.id === this.save.skin) || SKINS[0]; }
  nextWorld() { for (let i = 0; i < WORLDS.length; i++) if (!(this.save.worlds[i] && this.save.worlds[i].done)) return i; return WORLDS.length - 1; }
  // ---------- navigation
  go(name) {
    const from = this.ui.screen; if (!['settings', 'help', 'worlds', 'aerie', 'credits'].includes(from)) this.prevScreen = from;
    ({ worlds: () => this.ui.worlds(), aerie: () => this.ui.aerie(), settings: () => this.ui.settings(), credits: () => this.ui.credits(), help: () => this.ui.controlsHelp() })[name]();
  }
  back() {
    const p = this.prevScreen;
    if (p === 'pause') this.ui.pause(!!this.mpMenu); else if (p === 'results') this.ui.results(this.result, WORLDS[this.result.idx], this.result.idx === WORLDS.length - 1);
    else if (p === 'ending') this.ui.ending(); else this.ui.title();
  }
  newGame() { const keep = { diff: this.save.diff }; this.save = Object.assign(freshSave(), keep); this.persist(); this.playWorld(0); }
  wipe() { wipeSave(); this.save = freshSave(); this.persist(); this.ui.toast('انمسح التقدم', 'warn'); this.ui.title(); }
  buy(id) {
    const u = UPGRADES.find(x => x.id === id), lv = this.save.up[id], c = u.cost[lv];
    if (c == null) return; if (this.save.wallet < c) { this.audio.play('fail'); this.ui.toast('ما يكفي جمر — العب العوالم وجمّع أكثر', 'warn'); return; }
    this.save.wallet -= c; this.save.up[id]++; this.persist(); this.audio.play('buy'); this.ui.toast(`${u.name} ↑ مستوى ${this.save.up[id]}`, 'gold'); this.ui.aerie();
  }
  skin(id) {
    const k = SKINS.find(s => s.id === id); if (!k) return;
    if (!this.save.skins.includes(id)) { if (this.save.wallet < k.cost) { this.audio.play('fail'); this.ui.toast('ما يكفي جمر', 'warn'); return; } this.save.wallet -= k.cost; this.save.skins.push(id); this.audio.play('buy'); }
    this.save.skin = id; this.persist(); this.ui.aerie();
    if (this.menuLevel) { this.menuLevel.dispose(); this.menuLevel = null; this.startMenuScene(); }
  }
  // ---------- game flow
  playWorld(i, skipStory) {
    this.audio.init();
    const start = () => {
      this.ui.loading(0.3, 'نبني الجزر…');
      setTimeout(() => {
        if (this.level) this.level.dispose(); if (this.menuLevel) { this.menuLevel.dispose(); this.menuLevel = null; }
        this.level = new Level(this, WORLDS[i], i, { DIFF, diff: this.save.diff, up: this.save.up, skin: this.skinObj() });
        this.save.seenIntro = true; this.persist();
        this.audio.setMood(WORLDS[i].music); this.ui.hide(); this.ui.hudOn(true); this.state = 'play'; this.paused = false; this.input.gameActive = true;
        this.ui.banner(WORLDS[i].en, WORLDS[i].name);
        this.input.lock(this.R.cv);
      }, 60);
    };
    const r = this.save.worlds[i];
    if (skipStory || (r && r.done)) start(); else this.ui.story(i, start);
  }
  pause() { if (this.state !== 'play' || this.paused) return; if (this.level && this.level.mp) { this.input.unlock(); this.input.gameActive = false; this.mpMenu = true; this.ui.pause(true); this.ui.hudOn(true); return; } this.paused = true; this.input.unlock(); this.input.gameActive = false; this.ui.pause(); this.ui.hudOn(false); }
  resume() { if (this.mpMenu) { this.mpMenu = false; this.ui.hide(); this.input.gameActive = true; this.input.lock(this.R.cv); return; } this.paused = false; this.ui.hide(); this.ui.hudOn(true); this.input.gameActive = true; this.input.lock(this.R.cv); }
  toMenu() {
    if (this.level && this.level.mp) { this.mpMenu = false; this.net.send({ t: 'leave' }); }
    this.state = 'menu'; this.paused = false; this.input.unlock(); this.input.gameActive = false; this.ui.hudOn(false);
    if (this.level) { this.level.dispose(); this.level = null; }
    this.startMenuScene(); this.ui.title();
  }
  finishLevel(r) {
    const S = this.save, prev = S.worlds[r.idx] || {};
    const rank = m => ({ gold: 3, silver: 2, bronze: 1 }[m] || 0);
    S.worlds[r.idx] = { done: true, best: prev.best ? Math.min(prev.best, r.time) : r.time, medal: rank(r.medal) >= rank(prev.medal) ? r.medal : prev.medal, feathers: [0, 1, 2].map(k => !!(r.feathers[k] || (prev.feathers && prev.feathers[k]))) };
    S.wallet += r.reward; S.totalEmbers += r.collected; S.playTime += r.time; this.persist();
    this.result = r; this.state = 'results'; this.input.unlock(); this.input.gameActive = false; this.ui.hudOn(false);
    this.ui.results(r, WORLDS[r.idx], r.idx === WORLDS.length - 1); this.prevScreen = 'results';
  }
  // ---------- online (2 players)
  async online() {
    this.audio.init();
    this.ui.onlineConnecting(0);
    try { await this.net.connect(s => this.ui.onlineConnecting(s)); }
    catch (e) { this.ui.onlineError('ما قدرنا نوصل للسيرفر. تأكد من الإنترنت وجرب بعد شوي.'); return; }
    if (!this._netHooks) {
      this._netHooks = true;
      this.net.on('room', () => { if (this.ui.screen === 'room' || this.ui.screen === 'online') this.ui.room(); });
      this.net.on('error', m => { this.ui.toast(m.msg || 'خطأ', 'warn'); this.audio.play('fail'); });
      this.net.on('start', m => this.startMP(m));
      this.net.on('left', m => { if (this.state !== 'play') this.ui.toast('صاحبك طلع من الغرفة', 'warn'); });
      this.net.on('disconnect', () => { if (this.state !== 'play') { this.ui.toast('انقطع الاتصال', 'warn'); if (['room', 'online'].includes(this.ui.screen)) this.ui.title(); } });
    }
    if (this.net.room) this.ui.room(); else this.ui.online();
  }
  setName(n) { this.save.name = String(n || '').replace(/[<>&"'`]/g, '').trim().slice(0, 16); this.persist(); this.net.send({ t: 'hello', name: this.save.name || 'لاعب', skin: this.save.skin }); }
  startMP(m) {
    const me = m.players.find(p => p.id === this.net.id), peer = m.players.find(p => p.id !== this.net.id); if (!me || !peer) return;
    const role = m.host === this.net.id ? 'host' : 'guest', W = WORLDS[m.world];
    this.ui.loading(0.4, m.mode === 'pvp' ? 'جهّز نفسك للمواجهة…' : 'نطير سوا…');
    setTimeout(() => {
      if (this.level) this.level.dispose(); if (this.menuLevel) { this.menuLevel.dispose(); this.menuLevel = null; }
      const peerSkin = SKINS.find(s => s.id === peer.skin) || SKINS[1];
      const mp = { net: this.net, role, mode: m.mode, me, peer, peerModels: phoenixModels(this.R, this.lib, peerSkin) };
      this.mp = { mode: m.mode, world: m.world };
      this.level = new Level(this, W, m.world, { DIFF, diff: m.diff, up: this.save.up, skin: this.skinObj(), mp });
      this.level.mp.peerTrail = peerSkin.trail;
      this.audio.setMood(m.mode === 'pvp' ? 'thunder' : W.music); this.ui.hide(); this.ui.hudOn(true); this.state = 'play'; this.paused = false; this.input.gameActive = true;
      this.ui.banner(m.mode === 'pvp' ? 'VERSUS' : 'CO-OP', m.mode === 'pvp' ? `ضد ${peer.name} — أول واحد يوصل ${W.need} نقطة` : `مع ${peer.name} — ${W.name}`);
      this.input.lock(this.R.cv);
    }, 60);
  }
  mpFinish(r) {
    this.input.unlock(); this.input.gameActive = false; this.ui.hudOn(false); this.state = 'results';
    if (r.coop) { const S = this.save; S.wallet += r.reward; S.totalEmbers += r.collected; const prev = S.worlds[r.idx]; if (!prev || !prev.done) S.worlds[r.idx] = { done: true, best: r.time, medal: null, feathers: [false, false, false] }; this.persist(); }
    else { this.save.wallet += Math.round(r.me * (r.win ? 2 : 1)); this.persist(); }
    if (this.net.room && this.net.room.host === this.net.id) this.net.send({ t: 'end' });
    this.result = r; this.ui.mpResults(r);
  }
  mpAbort(why) {
    if (this.state !== 'play') return;
    setTimeout(() => { if (this.level && this.level.mp) this.backToRoom(); }, 2500);
  }
  backToRoom() {
    this.state = 'menu'; this.paused = false; this.input.unlock(); this.input.gameActive = false; this.ui.hudOn(false);
    if (this.level) { this.level.dispose(); this.level = null; }
    this.startMenuScene();
    if (this.net.connected && this.net.room) this.ui.room(); else this.ui.title();
  }
  quit() { try { fetch('/__quit', { method: 'POST' }).catch(() => {}); } catch (e) {} setTimeout(() => window.close(), 150); }
  // ---------- PWA updates: tell players when a new version is live
  registerSW() {
    if (!('serviceWorker' in navigator) || !/^https?:$/.test(location.protocol)) return;
    navigator.serviceWorker.register('sw.js').then(reg => {
      const watch = w => w && w.addEventListener('statechange', () => { if (w.state === 'installed' && navigator.serviceWorker.controller) { this.waiting = w; this.ui.updatePrompt(); } });
      if (reg.waiting && navigator.serviceWorker.controller) { this.waiting = reg.waiting; this.ui.updatePrompt(); }
      reg.addEventListener('updatefound', () => watch(reg.installing));
      setInterval(() => reg.update().catch(() => {}), 10 * 60 * 1000);
      document.addEventListener('visibilitychange', () => { if (!document.hidden) reg.update().catch(() => {}); });
    }).catch(() => {});
    let reloaded = false; navigator.serviceWorker.addEventListener('controllerchange', () => { if (this.updating && !reloaded) { reloaded = true; location.reload(); } });
  }
  applyUpdate() { this.updating = true; if (this.waiting) this.waiting.postMessage('skipWaiting'); else location.reload(); }
  // ---------- main loop
  loop(now) {
    const dt = Math.min(0.05, Math.max(0.0005, (now - (this.last || now)) / 1000)); this.last = now; this.clock += dt;
    this.fps = this.fps * 0.95 + (1 / dt) * 0.05;
    try {
      // menu navigation (keyboard / gamepad)
      if (this.ui.screen) { const n = this.input.nav(dt); if (Object.keys(n).length) { this.audio.init(); this.ui.nav(n); } }
      else this.input.nav(dt);
      const L = this.state === 'play' || this.state === 'results' ? this.level : this.menuLevel;
      if (L) {
        if (this.state === 'play' && !this.paused) {
          let inp = this.input.read(); if (inp.pause) { if (this.mpMenu) this.resume(); else this.pause(); }
          if (this.mpMenu) inp = { x: 0, y: 0, flap: 0, dive: 0, dash: 0, flare: 0, mx: 0, my: 0 };
          const steps = dt > 1 / 45 ? 2 : 1; for (let k = 0; k < steps; k++) L.update(dt / steps, k === 0 ? inp : Object.assign({}, inp, { dash: 0, flare: 0, mx: 0, my: 0 }));
          this.ui.hud(L.hud(), this.R, this.fps);
        } else if (this.state === 'results' || (this.state === 'play' && this.paused)) { this.R.fx.flash = 0; L.particles.update(this.paused ? 0 : dt); L.updateCamera(this.paused ? 0 : dt); this.audio.update(0, 0); }
        else L.update(dt, null);
        L.render();
      }
    } catch (e) { console.error(e); if (!this._errShown) { this._errShown = true; this.ui.toast('صار خطأ — ' + String(e.message).slice(0, 60), 'warn'); } }
    requestAnimationFrame(t => this.loop(t));
  }
}
window.EMBERWING = new App();
