// ARVEX SURVIVAL — application shell: boot, settings, profile, menus, solo + online flow, main loop, PWA updates
import { Renderer } from './gfx/renderer.js';
import { Particles } from './gfx/particles.js';
import { Audio } from './audio/audio.js';
import { Input } from './input/input.js';
import { UI } from './ui/ui.js';
import { Session } from './game/session.js';
import { Net, attachSession, interpolate, API } from './net/net.js';
import { norm } from './core/math.js';
import { setDetail, DETAIL } from './gfx/models.js';
import { ITEMS, RECIPES } from './game/items.js';
import { makeItem } from './game/inventory.js';

const VERSION = '1.1.0';
const ADMIN_HASH = 'c53ec26b1deda7b1853825fb6afd644bf221da530a2b92a87d77edcd4c220f2a';
const PRESETS = {
  low: { detail: 0, scale: 0.65, maxDpr: 1, bloom: false, particles: 0.5, viewDist: 300, propDist: 180, grass: 0 },
  medium: { detail: 1, scale: 0.85, maxDpr: 1.25, bloom: true, particles: 0.8, viewDist: 420, propDist: 260, grass: 0.4 },
  high: { detail: 2, scale: 1, maxDpr: 1.5, bloom: true, particles: 1, viewDist: 560, propDist: 360, grass: 0.8 },
  ultra: { detail: 3, scale: 1, maxDpr: 2, bloom: true, particles: 1.3, viewDist: 720, propDist: 480, grass: 1 }
};
const SDEF = { detail: 3, preset: 'high', scale: 1, maxDpr: 1.5, bloom: true, particles: 1, viewDist: 560, propDist: 360, grass: 0.8, fov: 78, showFps: false, master: 0.8, music: 0.4, sfx: 0.85, amb: 0.7, hints: true, shake: true, showClock: true, uiScale: 1, hiContrast: false, reduceMotion: false, touchSize: 1, lang: 'ar' };
const TIPS = [['اقطع الأشجار بالحجر أول شي، وبعدين اصنع فأس حجري.', 'Start by chopping trees with your rock, then craft a stone hatchet.'], ['النار تدفّيك بالليل وتطبخ اللحم. اللحم النيء ممكن يسممك.', 'A campfire keeps you warm at night and cooks meat. Raw meat can poison you.'], ['الذيابة تطلع أكثر بالليل وتصيد بمجموعات.', 'Wolves roam more at night and hunt in packs.'], ['حط كيس نوم داخل قاعدتك عشان ترجع له لما تموت.', 'Put a sleeping bag inside your base to respawn there.'], ['طوّر قاعدتك بالمطرقة: قش ← خشب ← حجر ← حديد.', 'Upgrade your base with the hammer: twig → wood → stone → metal.'], ['الصناديق في الأنقاض فيها خردة، والخردة تحتاجها لطاولة العمل.', 'Crates in ruins hold scrap, which you need for a workbench.']];

class App {
  constructor() {
    this.VERSION = VERSION;
    this.isDesktop = /^(127\.0\.0\.1|localhost)$/.test(location.hostname) && location.port === '47331';
    this.S = Object.assign({}, SDEF, this.ls('arvex.settings') || {});
    if (!this.ls('arvex.settings')) Object.assign(this.S, this.autoPreset());
    this.profile = this.ls('arvex.profile') || { id: rid(), name: 'Survivor' + Math.floor(Math.random() * 9000 + 1000), token: null, favs: [], recent: [] };
    this.input = new Input(); this.input.load(this.ls('arvex.input'));
    this.audio = new Audio(); this.particles = new Particles(5000); this.net = new Net(this);
    const cv = document.getElementById('gl');
    try { this.R = new Renderer(cv); } catch (e) { const f = document.getElementById('fatal'); f.innerHTML = `<div><img src="brand/arvex-logo-dark.svg" alt="ARVEX" style="height:48px"><p>${this.lang === 'en' ? 'This device or browser can\'t run WebGL. Try an up-to-date Chrome, Edge or Safari.' : 'هالجهاز أو المتصفح ما يدعم رسوم WebGL. جرّب كروم أو إيدج أو سفاري محدّث.'}</p><small>${String(e.message).slice(0, 160)}</small></div>`; f.classList.add('on'); throw e; }
    this.setLang(this.S.lang, true);
    this.ui = new UI(this); this.ui.buildHUD(); this.ui.buildTouch(); document.body.classList.toggle('touch', this.input.isTouch());
    this.state = 'boot'; this.paused = false; this.fps = 60; this.prevScreen = 'title'; this.sess = null; this.sessStart = 0; this.news = null; this.serverSummary = null; this.serverProfile = null;
    this.applySettings();
    addEventListener('resize', () => this.R.resize());
    addEventListener('keydown', e => this.onKey(e));
    document.addEventListener('visibilitychange', () => { if (document.hidden && this.state === 'play' && !this.paused) this.pause(); if (document.hidden && this.sess && !this.sess.online) this.sess.save(); });
    document.addEventListener('pointerlockchange', () => { if (!document.pointerLockElement && this.state === 'play' && !this.paused && !this.ui.modalOpen() && !this.input.isTouch() && !this._lockGrace && this.sess && !this.sess.player.dead) this.pause(); });
    cv.addEventListener('click', () => { if (this.state === 'play' && !this.paused && !this.ui.modalOpen()) this.lockPointer(); });
    this.input.on(t => { if (t === 'pad') this.ui.toast(this.lang === 'en' ? 'Controller connected' : 'يد التحكم اتصلت', 'ok'); if (t === 'padoff') this.ui.toast(this.lang === 'en' ? 'Controller disconnected' : 'يد التحكم انفصلت', 'warn'); });
    addEventListener('pointerdown', () => this.audio.init()); addEventListener('keydown', () => this.audio.init());
    addEventListener('beforeunload', () => { if (this.sess && !this.sess.online) this.sess.save(); });
    if (this.isDesktop) { const ping = () => fetch('/__ping', { cache: 'no-store' }).catch(() => {}); ping(); setInterval(ping, 5000); }
    this.dev = { ITEMS, RECIPES, makeItem }; // used by automated tests
    this.checkAdmin(this.profile.adminKey);
    this.boot();
  }
  ls(k) { try { return JSON.parse(localStorage.getItem(k) || 'null'); } catch (e) { return null; } }
  persist() { try { localStorage.setItem('arvex.settings', JSON.stringify(this.S)); localStorage.setItem('arvex.input', JSON.stringify(this.input.dump())); localStorage.setItem('arvex.profile', JSON.stringify(this.profile)); } catch (e) {} }
  get lang() { return this.S.lang === 'en' ? 'en' : 'ar'; }
  setLang(l, silent) { this.S.lang = l; document.documentElement.lang = l === 'en' ? 'en' : 'ar'; document.documentElement.dir = l === 'en' ? 'ltr' : 'rtl'; if (!silent && this.ui) { if (this.state === 'menu') this.ui.title(); } }
  autoPreset() { const touch = matchMedia('(pointer:coarse)').matches, weak = (navigator.hardwareConcurrency || 4) <= 4 && (navigator.deviceMemory || 4) <= 4; const k = touch ? (weak ? 'low' : 'medium') : weak ? 'medium' : 'high'; return Object.assign({ preset: k }, PRESETS[k], { detail: touch ? (weak ? 0 : 1) : weak ? 2 : 3 }); }
  applyPreset(p) { if (PRESETS[p]) Object.assign(this.S, PRESETS[p]); }
  applySettings() {
    const S = this.S;
    if (S.detail == null) S.detail = 3;
    if (DETAIL.q !== S.detail) { setDetail(S.detail); if (this.sess) { for (const m of this.sess.propGpu.values()) this.R.free(m); this.sess.propGpu.clear(); const W = this.sess.world; for (const ch of W.chunks.values()) { ch.propsDirty = true; if (ch.g && ch.g.b) this.R.free(ch.g); ch.g = null; } } }
    this.R.setQuality({ scale: S.scale, bloom: S.bloom, maxDpr: S.maxDpr }); this.particles.mult = S.particles;
    Object.assign(this.audio.vol, { master: S.master, music: S.music, sfx: S.sfx, amb: S.amb }); this.audio.applyVol();
    document.documentElement.style.setProperty('--ui', S.uiScale); document.documentElement.style.setProperty('--tsz', S.touchSize);
    document.body.classList.toggle('hic', !!S.hiContrast);
    if (this.sess && this.sess.world.grassDensity !== S.grass) { this.sess.world.grassDensity = S.grass; for (const ch of this.sess.world.chunks.values()) { if (ch.g && ch.g.b) this.R.free(ch.g); ch.g = null; } }
  }
  tip() { const t = TIPS[Math.floor(Math.random() * TIPS.length)]; return t[this.lang === 'en' ? 1 : 0]; }
  // ------------------------------------------------------------------ boot
  async boot() {
    const ph = (a, e) => this.lang === 'en' ? e : a;
    this.ui.loading(0.02, this.tip(), ph('نجهّز المحرك', 'Starting engine'));
    this.fetchMeta();
    const save = Session.loadSave();
    await this.buildSession({ seed: save ? save.seed : 1337 + Math.floor(Math.random() * 1e6) }, save, (p, phase) => this.ui.loading(0.05 + p * 0.9, null, phase));
    this.ui.loading(1, null, ph('جاهز', 'Ready'));
    this.state = 'menu'; this.audio.setMood('menu'); this.ui.title(); this.registerSW();
    this.last = performance.now(); requestAnimationFrame(t => this.loop(t));
  }
  async buildSession(opts, save, progress) {
    if (this.sess) { this.sess.dispose(); this.sess = null; }
    const s = new Session(this, opts), ph = (a, e) => this.lang === 'en' ? e : a; let lastT = performance.now();
    for (const p of s.load(save)) {
      const phase = p < 0.55 ? ph('نبني التضاريس', 'Generating terrain') : p < 0.65 ? ph('نزرع الغابات والموارد', 'Placing forests and resources') : p < 0.8 ? ph('نبني الأنقاض', 'Building ruins') : p < 0.9 ? ph('نجهّز الحيوانات', 'Waking the wildlife') : ph('نجهّز عالمك', 'Preparing your world');
      if (performance.now() - lastT > 30) { progress(p, phase); await new Promise(r => setTimeout(r, 0)); lastT = performance.now(); }
    }
    this.sess = s; this.sessSave = save; return s;
  }
  async fetchMeta() {
    try { const n = await this.net.api('/api/news'); this.news = n.news; } catch (e) { this.news = LOCAL_NEWS; }
    try { const d = await this.net.api('/api/servers'); this.serverList = d.servers; this.serverSummary = summary(d.servers); } catch (e) { this.serverSummary = null; }
    if (this.profile.token) try { const p = await this.net.api('/api/profile?token=' + encodeURIComponent(this.profile.token)); this.serverProfile = p.profile; } catch (e) {}
    if (this.state === 'menu' && this.ui.screen === 'title') this.ui.title();
  }
  hasSave() { return Session.loadSave(); }
  /** the owner's admin key is checked against a SHA-256 hash; the key itself is never in the code */
  async checkAdmin(key) {
    if (!key) { this.isAdmin = false; return false; }
    try { const h = [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(key)))].map(b => b.toString(16).padStart(2, '0')).join(''); this.isAdmin = h === ADMIN_HASH; } catch (e) { this.isAdmin = false; }
    return this.isAdmin;
  }
  localStats() { return (this.sess && !this.sess.online ? this.sess.stats : (Session.loadSave() || {}).stats) || {}; }
  profileTotal() { return (this.serverProfile ? this.serverProfile.total : 0) + (this.localStats().playTime || 0); }
  favs() { return this.profile.favs || []; } recent() { return this.profile.recent || []; }
  toggleFav(id) { const f = this.favs(); const i = f.indexOf(id); if (i >= 0) f.splice(i, 1); else f.push(id); this.profile.favs = f; this.persist(); }
  setName(n) { n = String(n || '').replace(/[<>&"'`]/g, '').trim().slice(0, 16); if (n.length < 2) { this.ui.toast(this.lang === 'en' ? 'Name is too short' : 'الاسم قصير', 'warn'); return; } this.profile.name = n; this.persist(); this.ui.toast(this.lang === 'en' ? 'Saved' : 'انحفظ', 'ok'); if (this.profile.token) this.net.api('/api/profile', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ token: this.profile.token, name: n }) }).catch(() => {}); }
  sessionTime() { return this.state === 'play' || this.paused ? (performance.now() - this.sessStart) / 1000 : 0; }
  // ------------------------------------------------------------------ navigation
  go(name) { const from = this.ui.screen; if (!['settings', 'profile', 'about', 'credits', 'controlsHelp', 'help', 'guide'].includes(from)) this.prevScreen = from || 'title'; this.ui[name](); }
  back() { const p = this.prevScreen; if (p === 'pause') this.ui.pause(); else if (p === 'servers') this.openServers(); else this.ui.title(); }
  toTitle() { if (this.sess && this.sess.online) this.leaveOnline(); else { this.state = 'menu'; this.ui.title(); } }
  // ------------------------------------------------------------------ solo
  async playSolo(fresh) {
    this.audio.init();
    if (fresh) { Session.wipeSave(); this.ui.loading(0, this.tip()); await this.buildSession({ seed: 1337 + Math.floor(Math.random() * 1e6) }, null, (p, ph) => this.ui.loading(p, null, ph)); }
    else if (!this.sess || this.sess.online) { const save = Session.loadSave(); this.ui.loading(0, this.tip()); await this.buildSession({ seed: save ? save.seed : 1337 }, save, (p, ph) => this.ui.loading(p, null, ph)); }
    this.enterPlay();
    if (fresh || !this.sessSave) this.ui.toast(this.lang === 'en' ? 'You washed up on ARVEX. Gather wood and stone.' : 'وصلت لجزيرة ARVEX. اجمع خشب وحجر.', 'signal', 5000);
  }
  enterPlay() { this.ui.hide(); this.ui.hudOn(true); this.state = 'play'; this.paused = false; this.input.gameActive = true; this.sessStart = performance.now(); this.lockPointer(); this.sess.save && !this.sess.online && this.sess.save(); }
  lockPointer() { if (this.state !== 'play' || this.input.isTouch()) return; this._lockGrace = true; setTimeout(() => this._lockGrace = false, 400); this.input.lock(this.R.cv); }
  pause() { if (this.state !== 'play' || this.paused) return; if (this.ui.ov.classList.contains('on')) this.ui.closeInventory(); this.paused = true; this.input.unlock(); this.input.gameActive = false; this.ui.pause(); this.prevScreen = 'pause'; if (this.sess && !this.sess.online) this.sess.save(); }
  resume() { this.paused = false; this.ui.hide(); this.ui.hudOn(true); this.input.gameActive = true; this.lockPointer(); }
  saveQuit() { if (this.sess.online) { this.leaveOnline(); return; } this.sess.save(); this.paused = false; this.state = 'menu'; this.input.unlock(); this.input.gameActive = false; this.ui.hudOn(false); this.ui.title(); }
  wipe() { Session.wipeSave(); this.ui.toast(this.lang === 'en' ? 'World deleted' : 'انمسح العالم', 'warn'); this.buildSession({ seed: 1337 + Math.floor(Math.random() * 1e6) }, null, () => {}).then(() => this.ui.settings('gameplay')); }
  quit() { if (this.sess && !this.sess.online) this.sess.save(); if (this.isDesktop) fetch('/__quit').catch(() => {}); setTimeout(() => window.close(), 200); }
  // ------------------------------------------------------------------ online
  async openServers(refresh) {
    this.prevScreen = 'title'; if (!this.serverList || refresh) this.ui.servers(null); else this.ui.servers(this.serverList);
    try { const d = await this.net.servers(); this.serverList = d.servers; this.serverSummary = summary(d.servers); if (this.ui.screen === 'servers') this.ui.servers(this.serverList); }
    catch (e) { if (this.ui.screen === 'servers') this.ui.servers(this.serverList || [], this.lang === 'en' ? 'The ARVEX network is not reachable. Check your internet and try again.' : 'شبكة ARVEX ما ترد. تأكد من الإنترنت وحاول مرة ثانية.'); }
  }
  async joinServer(id) {
    const s = (this.serverList || []).find(x => x.id === id); if (!s) return;
    if (s.version !== VERSION) { this.ui.netError(this.lang === 'en' ? 'Version mismatch' : 'الإصدار مختلف', (this.lang === 'en' ? `This server runs ${s.version}, you have ${VERSION}. Update through the ARVEX launcher.` : `السيرفر على ${s.version} وأنت على ${VERSION}. حدّث من لانشر ARVEX.`)); return; }
    if (!['online', 'full'].includes(s.status)) { this.ui.toast(this.lang === 'en' ? 'Server is not available' : 'السيرفر مو متاح حالياً', 'warn'); return; }
    this.audio.init(); this.ui.connecting(this.lang === 'en' ? 'Connecting to ' + s.name : 'نتصل بـ ' + s.name);
    const queueH = m => this.ui.queue(Object.assign({ name: s.name }, m)); this.net.handlers = {}; this.net.on('queue', queueH);
    let welcome;
    try { welcome = await this.net.join(id, { token: this.profile.token, pid: this.profile.id, name: this.profile.name, version: VERSION, adminKey: this.profile.adminKey || undefined }); }
    catch (e) { const msg = { full: this.lang === 'en' ? 'The server is full.' : 'السيرفر ممتلئ.', version: this.lang === 'en' ? 'Your game version is not supported.' : 'إصدار لعبتك مو مدعوم.', restarting: this.lang === 'en' ? 'The server is restarting. Try again in a minute.' : 'السيرفر يسوي ريستارت. جرّب بعد دقيقة.', maintenance: this.lang === 'en' ? 'The server is under maintenance.' : 'السيرفر تحت الصيانة.', duplicate: this.lang === 'en' ? 'You are already connected from another window.' : 'أنت متصل من نافذة ثانية.' }[e.code] || (this.lang === 'en' ? 'Could not connect to the server.' : 'ما قدرنا نتصل بالسيرفر.'); this.ui.netError(s.name, msg); return; }
    this.profile.token = welcome.token; this.profile.recent = [id].concat(this.recent().filter(x => x !== id)).slice(0, 8); this.persist();
    this.serverProfile = welcome.profile;
    this.ui.loading(0, this.tip());
    const sess = await this.buildSession({ seed: welcome.seed, online: true, myId: welcome.id }, null, (p, ph) => this.ui.loading(p, null, ph));
    attachSession(this, sess, welcome);
    this.enterPlay();
    this.ui.notice(`<b>${esc(welcome.server.name)}</b> · ${welcome.counts.server}/${welcome.server.max}`, 'signal');
  }
  leaveQueue() { this.net.close(); this.openServers(); }
  leaveOnline() { this.net.send({ t: 'persist', state: this.sess.player.serialize(), inv: this.sess.inv.serialize() }); clearInterval(this._stT); clearInterval(this._saveT); this.net.close(); this.paused = false; this.state = 'menu'; this.input.unlock(); this.input.gameActive = false; this.ui.hudOn(false); this.fetchMeta(); const save = Session.loadSave(); this.buildSession({ seed: save ? save.seed : 1337 }, save, () => {}).then(() => { this.openServers(true); }); this.ui.loading(0.5, this.tip()); }
  onKicked(m) { clearInterval(this._stT); this.state = 'menu'; this.input.unlock(); this.ui.hudOn(false); const why = m.code === 'restart' ? (this.lang === 'en' ? 'The server is restarting. Your progress was saved.' : 'السيرفر يسوي ريستارت. تقدمك انحفظ.') : (m.msg || ''); this.ui.netError(this.lang === 'en' ? 'Disconnected' : 'انقطع الاتصال', why); }
  onConnectionLost() { clearInterval(this._stT); this.state = 'menu'; this.input.unlock(); this.ui.hudOn(false); this.ui.netError(this.lang === 'en' ? 'Connection lost' : 'انقطع الاتصال', this.lang === 'en' ? 'We could not reconnect to the server.' : 'ما قدرنا نرجع للسيرفر.'); }
  // ------------------------------------------------------------------ keys
  onKey(e) {
    if (this.input.capture) return;
    const ui = this.ui, code = e.code, B = this.input.binds;
    if (this.state !== 'play') { if (code === 'Escape' && ui.screen && !['title', 'loading', 'deathscr'].includes(ui.screen)) { e.preventDefault(); this.back(); } return; }
    if (ui.chatOpen) return;
    if (code === 'Escape') { e.preventDefault(); if (ui.wheelState) return ui.wheelPick(-1); if (ui.mapOpen) return ui.toggleMap(); if (ui.ov.classList.contains('on')) return ui.closeInventory(); if (this.paused) { if (ui.screen === 'pause') this.resume(); else this.back(); return; } if (this.sess.player.dead) return; this.pause(); return; }
    if (this.paused || this.sess.player.dead) return;
    if (B.inventory.includes(code)) { e.preventDefault(); ui.ov.classList.contains('on') ? ui.closeInventory() : ui.openInventory('inv'); return; }
    if (B.craft.includes(code)) { e.preventDefault(); if (ui.ov.classList.contains('on') && ui.invTab === 'craft') ui.closeInventory(); else ui.openInventory('craft'); return; }
    if (B.map.includes(code)) { e.preventDefault(); ui.toggleMap(); return; }
    if (code === 'F8' || code === 'Backquote') { e.preventDefault(); if (this.isAdmin) ui.adminPanel(); return; }
    if (code === 'KeyH') { e.preventDefault(); this.pause(); this.go('guide'); return; }
    if (B.chat.includes(code) && this.sess.online) { e.preventDefault(); ui.openChat(); return; }
  }
  // ------------------------------------------------------------------ loop
  loop(now) {
    const dt = Math.min(0.05, Math.max(0.001, (now - this.last) / 1000)); this.last = now; this.fps += (1 / dt - this.fps) * 0.05;
    const s = this.sess;
    try {
      if (s && this.state === 'play') {
        const inp = this.input.read(dt);
        if (inp.pause && !this.paused) this.pause();
        if (inp.inventory && !this.paused && !s.player.dead) this.ui.ov.classList.contains('on') ? this.ui.closeInventory() : this.ui.openInventory('inv');
        if (inp.map && !this.paused) this.ui.toggleMap();
        if (!this.paused || s.online) { s.update(dt, this.paused ? Object.assign(inp, { move: [0, 0], lookX: 0, lookY: 0 }) : inp); if (s.online) interpolate(s, dt); }
        s.particles.update(dt); s.render(dt); this.ui.updateHUD(dt);
      } else if (s) { this.menuCamera(dt); s.particles.update(dt); }
      this.audio.update && s && this.state !== 'play' && this.audio.update({ wind: 0.35, rain: 0, surf: 0.4, birds: 0.3, crickets: 0, fire: 0 }, 0);
    } catch (err) { console.error(err); if (!this._errShown) { this._errShown = true; this.ui.toast('Error: ' + err.message, 'err', 8000); } }
    requestAnimationFrame(t => this.loop(t));
  }
  menuCamera(dt) {
    const s = this.sess, R = this.R; this.menuT = (this.menuT || 0) + dt * (this.S.reduceMotion ? 0.3 : 1);
    const a = this.menuT * 0.018 + 2.4, r = 380, cx = Math.cos(a) * r, cz = Math.sin(a) * r, h = Math.max(s.world.height(cx, cz), 0) + 70;
    const look = [Math.cos(a + 0.9) * 120, 25, Math.sin(a + 0.9) * 120];
    s.env.time = 0.665 + Math.sin(this.menuT * 0.01) * 0.02; s.env.update(0, false);
    const save = s.player.pos.slice(), sy = s.player.yaw, sp = s.player.pitch, d = norm([look[0] - cx, look[1] - h, look[2] - cz]);
    s.player.pos = [cx, h - 1.62, cz]; s.player.yaw = Math.atan2(d[0], -d[2]); s.player.pitch = Math.asin(d[1]); s.player.camY = 1.62; s.player.bobAmp = 0; s.player.land = 0;
    s.t += dt; const hide = s.player.dead; s.player.dead = true; const ap = s.app.S.propDist; s.render(dt); s.player.dead = hide;
    s.player.pos = save; s.player.yaw = sy; s.player.pitch = sp;
  }
  // ------------------------------------------------------------------ PWA
  registerSW() {
    if (!('serviceWorker' in navigator) || location.protocol === 'file:' || this.isDesktop) return;
    navigator.serviceWorker.register('sw.js').then(reg => {
      const show = w => { const u = document.getElementById('update'); u.className = 'on ax-panel'; u.innerHTML = `<span>${this.lang === 'en' ? 'A new ARVEX update is ready' : 'فيه تحديث جديد لـ ARVEX'}</span><button class="ax-btn primary sm">${this.lang === 'en' ? 'Update now' : 'حدّث الحين'}</button>`; u.querySelector('button').onclick = () => { w.postMessage('skipWaiting'); }; };
      if (reg.waiting) show(reg.waiting);
      reg.addEventListener('updatefound', () => { const w = reg.installing; w && w.addEventListener('statechange', () => { if (w.state === 'installed' && navigator.serviceWorker.controller) show(w); }); });
    }).catch(() => {});
    const had = !!navigator.serviceWorker.controller; let reloaded = false; navigator.serviceWorker.addEventListener('controllerchange', () => { if (reloaded || !had) return; reloaded = true; if (this.sess && !this.sess.online) this.sess.save(); location.reload(); });
  }
}
function summary(list) { return { online: list.reduce((a, s) => a + s.players, 0), servers: list.length, up: list.filter(s => s.status === 'online' || s.status === 'full').length }; }
function rid() { const a = new Uint8Array(12); (crypto.getRandomValues ? crypto.getRandomValues(a) : a.forEach((_, i) => a[i] = Math.random() * 256)); return [...a].map(x => x.toString(16).padStart(2, '0')).join(''); }
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const LOCAL_NEWS = [{ id: 'launch', tag: 'update', date: '2026-11-20', title: ['ARVEX SURVIVAL 1.0', 'ARVEX SURVIVAL 1.0'], short: ['الإصدار الأول: الجزيرة والبناء والصناعة والحيوانات والسيرفرات.', 'First release: the island, building, crafting, wildlife and servers.'], body: ['أهلاً بك في ARVEX. هذا أول إصدار ومعه الجزيرة كاملة، نظام البناء، الصناعة، الحيوانات، الطقس، والسيرفرات الأونلاين.', 'Welcome to ARVEX. The first release ships the full island, building, crafting, wildlife, weather and online servers.'] }];

import { loadBlenderModels } from './gfx/blender.js';
loadBlenderModels();
window.ARVEX = new App();
