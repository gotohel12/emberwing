// ARVEX SURVIVAL — network client: server browser API, WebSocket session, reconnect, state sync.
import { ITEMS } from '../game/items.js';
export const API = (() => {
  const h = location.hostname, p = location.port;
  if ((h === 'localhost' || h === '127.0.0.1') && p && p !== '47331') return location.origin; // local dev server
  if (/onrender\.com$/.test(h)) return location.origin;
  return 'https://emberwing.onrender.com'; // desktop launcher, GitHub Pages mirror, file://
})();
const wsUrl = base => base.replace(/^http/, 'ws') + '/ws';

export class Net {
  constructor(app) { this.app = app; this.ws = null; this.status = 'off'; this.handlers = {}; this.ping = null; this.counts = { server: 0, total: 0, servers: 0, survivors: 0 }; this.server = null; this.queue = []; }
  on(t, f) { (this.handlers[t] = this.handlers[t] || []).push(f); }
  emit(t, m) { for (const f of this.handlers[t] || []) f(m); }
  async api(path, opts) { const ctl = new AbortController(), to = setTimeout(() => ctl.abort(), 9000); try { const r = await fetch(API + path, Object.assign({ signal: ctl.signal, cache: 'no-store' }, opts)); if (!r.ok) throw new Error('HTTP ' + r.status); return await r.json(); } finally { clearTimeout(to); } }
  async servers() {
    const d = await this.api('/api/servers');
    const hosts = [...new Set(d.servers.map(s => s.host || API))], pings = {};
    await Promise.all(hosts.map(async h => { try { const t0 = performance.now(); await fetch(h + '/api/ping', { cache: 'no-store' }); const t1 = performance.now(); await fetch(h + '/api/ping', { cache: 'no-store' }); pings[h] = Math.round(Math.min(t1 - t0, performance.now() - t1)); } catch (e) { pings[h] = null; } }));
    for (const s of d.servers) s.ping = pings[s.host || API];
    return d;
  }
  /** connect to a game server; resolves on 'welcome' */
  join(serverId, hello) {
    this.close(true); this.wantServer = serverId; this.hello = hello; this.retry = 0;
    return new Promise((res, rej) => { this._res = res; this._rej = rej; this.open(); });
  }
  open() {
    const ws = new WebSocket(wsUrl(API) + '?server=' + encodeURIComponent(this.wantServer)); this.ws = ws; this.status = 'connecting';
    const timeout = setTimeout(() => { if (this.status === 'connecting') { try { ws.close(); } catch (e) {} } }, 25000);
    ws.onopen = () => { clearTimeout(timeout); this.send(Object.assign({ t: 'hello' }, this.hello, { resume: !!this.server })); };
    ws.onmessage = ev => { let m; try { m = JSON.parse(ev.data); } catch (e) { return; } this.handle(m); };
    ws.onclose = ev => {
      clearTimeout(timeout); const was = this.status; this.status = 'off'; this.stopPing();
      if (this.closing) return;
      if (was === 'connecting' && !this.server) { if (this._rej) { this._rej(new Error(ev.reason || 'connect')); this._rej = null; } return; }
      // in-game drop: reconnect with backoff, keep the session running
      if (this.server && this.retry < 8) { this.retry++; this.status = 'reconnecting'; this.emit('reconnecting', { n: this.retry }); setTimeout(() => { if (!this.closing) this.open(); }, Math.min(8000, 800 * this.retry)); }
      else if (this.server) { this.emit('lost', {}); }
    };
    ws.onerror = () => {};
  }
  handle(m) {
    switch (m.t) {
      case 'welcome': this.status = 'on'; this.retry = 0; this.id = m.id; this.server = m.server; this.counts = m.counts || this.counts; this.startPing(); if (this._res) { this._res(m); this._res = null; } else this.emit('resumed', m); break;
      case 'queue': this.status = 'queue'; this.emit('queue', m); break;
      case 'reject': this.closing = true; if (this._rej) { this._rej(Object.assign(new Error(m.msg || m.code), { code: m.code, info: m })); this._rej = null; } else this.emit('kick', m); try { this.ws.close(); } catch (e) {} break;
      case 'pong': this.ping = Math.round(performance.now() - m.k); if (m.counts) this.counts = m.counts; break;
      case 'counts': this.counts = m.counts; break;
      default: this.emit(m.t, m);
    }
  }
  startPing() { this.stopPing(); this._pt = setInterval(() => this.send({ t: 'ping', k: performance.now() }), 2500); this.send({ t: 'ping', k: performance.now() }); }
  stopPing() { if (this._pt) clearInterval(this._pt); this._pt = null; }
  send(m) { if (this.ws && this.ws.readyState === 1) this.ws.send(JSON.stringify(m)); }
  close(silent) { this.closing = true; this.stopPing(); if (this.ws) { try { this.ws.close(1000, 'leave'); } catch (e) {} } this.ws = null; this.status = 'off'; this.server = null; this.closing = !!silent ? false : false; }
}

/** wires a running online Session to the Net: snapshots in, player state out */
export function attachSession(app, sess, welcome) {
  const net = app.net, S = welcome.snapshot;
  sess.myId = welcome.id; sess.ownerId = welcome.owner || welcome.id; app.isAdmin = !!welcome.admin;
  for (const b of S.buildings) sess.world.buildings.set(b.id, b);
  for (const st of S.structures) sess.world.addStructure(st);
  for (const d of S.deploys) { sess.world.addDeploy(d); if (d.open) sess.world.setDoor(sess.world.deploys.get(d.id), true); }
  for (const d of S.drops) sess.world.addDrop(d);
  for (const [id, alive, resp, hp, inv] of S.nodes) { const n = sess.world.nodes[id]; if (!n) continue; if (!alive) sess.world.setNodeAlive(n, false, resp); n.hp = hp; if (inv) n.inv = inv; }
  sess.netAnimals = (S.animals || []).map(a => Object.assign({ phase: 0 }, a));
  for (const b of S.booms || []) sess.applyLocal({ t: 'boom+', bm: b });
  // survivors (AI players run by the server): who they are comes once, where they are comes with the stream of states
  sess.botInfo = new Map((welcome.bots || []).map(b => [b[0], { name: b[1], team: b[2], look: b[3] }])); sess.itemIdx = welcome.itemIdx || Object.keys(ITEMS);
  for (const d of sess.world.deploys.values()) if (d.kind === 'core' && (d.owner === sess.ownerId || (d.auth || []).includes(sess.ownerId))) sess.authCores.add(d.id);
  const botState = e => { const id = 'b' + e[0]; let r = sess.remote.get(id); const now = performance.now();
    if (!r) { const inf = sess.botInfo.get(e[0]) || { name: sess.tr(['ناجي', 'Survivor']), look: e[0] }; r = { id, bot: true, name: inf.name, team: inf.team, look: inf.look, pos: [e[1], e[2], e[3]], tp: [e[1], e[2], e[3]], yaw: e[4], ty: e[4], pitch: 0, phase: 0, spd: 0, up: now, iv: 0.1 }; sess.remote.set(id, r); }
    r.iv = Math.min(1.2, Math.max(0.09, (now - r.up) / 1000)); r.up = now; r.tp[0] = e[1]; r.tp[1] = e[2]; r.tp[2] = e[3]; r.ty = e[4]; const f = e[5]; r.crouch = f & 1; r.swing = f & 2; r.light = f & 4; r.dead = f & 8; r.tired = f & 16; r.spd = e[6]; r.item = e[7] >= 0 ? sess.itemIdx[e[7]] : ''; r.pitch = e[8] || 0; };
  if (welcome.env) sess.env.restore(welcome.env);
  for (const p of welcome.players || []) if (p.id !== welcome.id) addRemote(sess, p);
  if (welcome.player && welcome.player.state) { sess.player.restore(welcome.player.state); sess.inv.restore(welcome.player.inv); sess.recalcWear(); }
  else if (welcome.spawn) { const sp = welcome.spawn; sess.player.pos = [sp[0], sess.world.height(sp[0], sp[2]) + 0.1, sp[2]]; sess.player.yaw = Math.atan2(-sp[0], sp[2]); }
  const L = app.ui;
  const handlers = {
    op: m => sess.applyLocal(m.op),
    ops: m => { for (const op of m.ops) sess.applyLocal(op); },
    bs: m => { for (const e of m.l) botState(e); },
    bj: m => { const b = m.b; sess.botInfo.set(b[0], { name: b[1], team: b[2], look: b[3] }); },
    bl: m => { sess.botInfo.delete(m.n); sess.remote.delete('b' + m.n); },
    bfx: m => sess.botShot(m),
    deny: m => sess.onDeny(m),
    lockRes: m => sess.onLockRes(m),
    coreInfo: m => { if (m.me) sess.authCores.add(m.id); else sess.authCores.delete(m.id); sess.coreInfo = m; L.refreshContainer(); },
    raid: m => { L.notice(sess.tr(['قاعدتك تنضرب!', 'Your base is under attack!']), 'err'); app.audio.play('warn'); },
    ps: m => { for (const s of m.list) { if (s.id === sess.myId) continue; let r = sess.remote.get(s.id); if (!r) r = addRemote(sess, s); Object.assign(r, { tp: s.p, yaw: s.yaw, pitch: s.pitch, spd: s.spd, crouch: s.crouch, swing: s.swing, item: s.item, light: s.light, dead: s.dead, tired: s.tired }); } },
    an: m => { const prev = new Map((sess.netAnimals || []).map(a => [a.id, a])); sess.netAnimals = m.list.map(a => { const p = prev.get(a.id); if (p) { p.tx = a.x; p.ty = a.y; p.tz = a.z; Object.assign(p, { yaw: a.yaw, hp: a.hp, state: a.state, spd: a.spd, bite: a.bite, harvest: a.harvest, type: a.type }); return p; } return Object.assign({ phase: 0, tx: a.x, ty: a.y, tz: a.z }, a); }); },
    env: m => { sess.env.time = m.env.time; if (m.env.next !== sess.env.next) sess.env.setWeather(m.env.next); },
    join: m => { if (m.id !== sess.myId) { addRemote(sess, m); L.notice(`<b>${esc(m.name)}</b> ${sess.tr(['دخل السيرفر', 'joined the server'])}`, 'ok'); app.audio.play('join'); } },
    leave: m => { const r = sess.remote.get(m.id); sess.remote.delete(m.id); if (r) { L.notice(`<b>${esc(r.name)}</b> ${sess.tr(['طلع من السيرفر', 'left the server'])}`, 'warn'); app.audio.play('leave'); } },
    chat: m => L.chatLine(m.name, m.msg, m.sys),
    grant: m => sess.onGrant(m),
    hurt: m => { const P = sess.player; if (m.src) sess.lastHurt = m; if (m.bleed) P.effects.bleed = Math.min(40, (P.effects.bleed || 0) + 8); P.damage(m.dmg, m.kind, { t: sess.t, onHurt: (d, type) => sess.onHurt(d, type), onDeath: (type) => sess.onDeath(type, m.src) }, m.src); },
    harvest: m => { for (const [id, n] of m.items) sess.give(id, n); },
    killed: m => { sess.stats.kills++; sess.addXP(m.xp || 10); L.toast(sess.tr(['قتلت ', 'Killed ']) + sess.tr(m.name), 'signal'); },
    fx: m => { if (m.k === 'shot') sess.audio.play('bowshot', 0.8, m.p); if (m.k === 'gun') sess.audio.play('gun_' + (['pistol', 'rifle', 'shotgun'].includes(m.g) ? m.g : 'pistol'), 1, m.p); },
    teleport: m => { const P = sess.player; P.pos = m.p.slice(); P.vel = [0, 0, 0]; if (m.why !== 'home') L.toast(sess.tr(['انتقلت بواسطة الأدمن', 'Teleported by an admin']), 'info'); },
    give: m => { sess.give(m.id, m.n); },
    heal: () => { const P = sess.player; P.hp = 100; P.food = Math.max(P.food, 80); P.water = Math.max(P.water, 80); P.effects = {}; L.toast(sess.tr(['تعالجت', 'Healed']), 'ok'); },
    restart: m => { if (m.in <= 30000) net.send({ t: 'persist', state: sess.player.serialize(), inv: sess.inv.serialize() }); const min = Math.round(m.in / 60000), sec = Math.round(m.in / 1000); const txt = m.in >= 60000 ? sess.tr(['ريستارت السيرفر بعد ', 'Server restart in ']) + min + sess.tr([' دقيقة', ' min']) : sess.tr(['ريستارت السيرفر بعد ', 'Server restart in ']) + sec + sess.tr([' ثانية', ' s']); L.notice(txt, 'warn'); L.chatLine('', txt, true); app.audio.play('warn'); },
    profile: m => { app.serverProfile = m.profile; },
    kick: m => app.onKicked(m),
    reconnecting: () => L.notice(sess.tr(['انقطع الاتصال — نحاول نرجع…', 'Connection lost — reconnecting…']), 'warn'),
    resumed: m => { L.notice(sess.tr(['رجع الاتصال', 'Reconnected']), 'ok'); },
    lost: () => app.onConnectionLost()
  };
  net.handlers = {}; for (const k in handlers) net.on(k, handlers[k]);
  // outgoing player state at 10 Hz + inventory/vitals persistence every 15 s
  clearInterval(app._stT); clearInterval(app._saveT);
  app._stT = setInterval(() => { if (net.status !== 'on') return; const P = sess.player, it = sess.inv.activeItem(); net.send({ t: 'st', p: P.pos.map(v => +v.toFixed(2)), yaw: +P.yaw.toFixed(3), pitch: +P.pitch.toFixed(2), spd: +P.speedNow.toFixed(1), crouch: P.crouch > 0.5 ? 1 : 0, swing: sess.held.swing > 0 ? 1 : 0, item: it ? it.id : '', light: it && it.id === 'torch' ? 1 : 0, dead: P.dead ? 1 : 0, tired: P.stam < 25 ? 1 : 0 }); }, 100);
  app._saveT = setInterval(() => { if (net.status === 'on' && !sess.player.dead) net.send({ t: 'persist', state: sess.player.serialize(), inv: sess.inv.serialize() }); }, 15000);
}
function addRemote(sess, p) { const r = { id: p.id, name: p.name, pos: (p.p || [0, 0, 0]).slice(), tp: (p.p || [0, 0, 0]).slice(), yaw: p.yaw || 0, pitch: 0, phase: 0, spd: 0 }; sess.remote.set(p.id, r); return r; }
/** smooth remote entities toward their latest network targets */
export function interpolate(sess, dt) {
  const k = 1 - Math.exp(-12 * dt);
  const now = performance.now();
  for (const r of sess.remote.values()) {
    if (r.bot) { if (now - r.up > 4500) { sess.remote.delete(r.id); continue; } const kb = 1 - Math.exp(-dt * 3.2 / r.iv); for (let i = 0; i < 3; i++) r.pos[i] += (r.tp[i] - r.pos[i]) * kb; let dy = r.ty - r.yaw; while (dy > Math.PI) dy -= 2 * Math.PI; while (dy < -Math.PI) dy += 2 * Math.PI; r.yaw += dy * Math.min(1, dt * 10); r.phase += (r.dead ? 0 : r.spd || 0) * dt * 2.2; continue; }
    for (let i = 0; i < 3; i++) r.pos[i] += (r.tp[i] - r.pos[i]) * k; r.phase += (r.spd || 0) * dt * 2.2;
  }
  for (const a of sess.netAnimals || []) { if (a.tx != null) { a.x += (a.tx - a.x) * k; a.y += (a.ty - a.y) * k; a.z += (a.tz - a.z) * k; } a.phase = (a.phase || 0) + (a.spd || 0) * dt * 2.4; }
}
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
