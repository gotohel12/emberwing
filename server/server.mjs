// ARVEX SURVIVAL — backend (Node + ws)
// · serves the web game (public/) and the launcher distribution (manifest + files with HTTP Range resume)
// · runs several independent game servers ("shards") in one process, each with its own world, save and schedule
// · server-authoritative: world state, animals, fires/furnaces, day/night + weather, player counts, playtime
// · automatic restart cycle per shard every 5 days, staggered so shards never restart together
// · REST API: /api/servers /api/news /api/profile /api/versions /api/ping /health (+ admin with ADMIN_KEY)
import http from 'http';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import { WebSocketServer } from 'ws';
import { Terrain, layoutWorld, NODE_TYPES, RESPAWN } from '../src/world/terrain.js';
import { AnimalSim } from '../src/game/animals.js';
import { Env } from '../src/game/env.js';
import { ITEMS, rollLoot } from '../src/game/items.js';
import { ANIMALS } from '../src/gfx/models.js';
import { createAdmin } from './lib/admin.mjs';
import { logger, cmpVersion, isVersion, clientIp, RateLimiter } from './lib/core.mjs';

const __dir = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dir, '..'), PUB = process.env.PUBLIC_DIR ? path.resolve(process.env.PUBLIC_DIR) : path.join(ROOT, 'public');   // PUBLIC_DIR: serve another build folder (the tests use a small copy)
const PKG = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')), VERSION = PKG.version;
// build identity: written by tools/build.mjs next to the bundle, so game, launcher manifest, backend and admin all report the same build
const BUILD = (() => { try { const b = JSON.parse(fs.readFileSync(path.join(PUB, 'build.json'), 'utf8')); if (b.version === VERSION) return b; } catch (e) {} return { product: 'ARVEX SURVIVAL', version: VERSION, id: VERSION + '-dev', date: new Date().toISOString().slice(0, 10) }; })();
const PROTOCOL_MIN = '10.0.0';   // oldest client the game-server protocol still understands
const PORT = +process.env.PORT || 8080;
const DATA = process.env.DATA_DIR || path.join(ROOT, 'data');
const ADMIN_KEY = process.env.ADMIN_KEY || '';
const ADMIN_HASH = process.env.ADMIN_HASH || 'c53ec26b1deda7b1853825fb6afd644bf221da530a2b92a87d77edcd4c220f2a'; // sha256 of the owner's admin key (the key itself is never stored)
const isAdminKey = k => typeof k === 'string' && k.length > 6 && (crypto.createHash('sha256').update(k).digest('hex') === ADMIN_HASH || (ADMIN_KEY && k === ADMIN_KEY));
const DAY = 86400e3, CYCLE = +process.env.RESTART_MS || 5 * DAY, GRACE = 30e3, STARTING = 12e3;
const WARN_AT = [60, 30, 15, 10, 5, 1].map(m => m * 60e3).concat([30e3, 10e3]);
const REGION = process.env.REGION || 'eu';
fs.mkdirSync(DATA, { recursive: true });
const slog = logger('game'); const log = (...a) => slog.info(a.map(x => (typeof x === 'string' ? x : x && x.message ? x.message : JSON.stringify(x))).join(' '));

// ------------------------------------------------------------------ persistence (atomic JSON files)
function readJSON(f, def) { try { return JSON.parse(fs.readFileSync(path.join(DATA, f), 'utf8')); } catch (e) { return def; } }
function writeJSON(f, obj) { const p = path.join(DATA, f), tmp = p + '.tmp'; fs.writeFileSync(tmp, JSON.stringify(obj)); fs.renameSync(tmp, p); }
const profiles = readJSON('profiles.json', {});
let profilesDirty = false; const saveProfiles = () => { if (profilesDirty) { writeJSON('profiles.json', profiles); profilesDirty = false; } };
const hashToken = t => crypto.createHash('sha256').update(String(t)).digest('hex').slice(0, 32);
const clean = (s, n) => String(s == null ? '' : s).replace(/[<>&"'`\u0000-\u001f]/g, '').trim().slice(0, n);
const num = (v, a, b, d = 0) => { v = Number(v); return Number.isFinite(v) ? Math.max(a, Math.min(b, v)) : d; };

// ------------------------------------------------------------------ shard configuration
const DEFAULT_SHARDS = [
  { id: 'eu-1', name: 'ARVEX | MAIN #1', mode: 'pve', max: 50, seed: 20261 },
  { id: 'eu-2', name: 'ARVEX | PVP #2', mode: 'pvp', max: 50, seed: 40977 },
  { id: 'eu-3', name: 'ARVEX | BUILD #3', mode: 'build', max: 40, seed: 77311 },
  { id: 'eu-4', name: 'ARVEX | HARDCORE #4', mode: 'hardcore', max: 30, seed: 13093 }
];
const SHARD_CFG = process.env.SERVERS_JSON ? JSON.parse(process.env.SERVERS_JSON) : DEFAULT_SHARDS;
const schedule = readJSON('schedule.json', {});

class Shard {
  constructor(cfg, index, total) {
    Object.assign(this, { id: cfg.id, name: cfg.name, mode: cfg.mode, max: cfg.max, seed: cfg.seed, region: cfg.region || REGION, map: cfg.map || 'ARVEX ISLAND' });
    this.players = new Map(); this.queue = []; this.maintenance = false; this.locked = false; this.chatLog = []; this.phase = 'starting';
    // restart schedule survives process restarts/deploys; first cycle is staggered by shard index
    const sc = schedule[this.id];
    this.cycleStart = sc ? sc.cycleStart : Date.now() - CYCLE * (index / total);
    this.nextRestart = sc ? sc.nextRestart : this.cycleStart + CYCLE;
    this.warned = new Set(); this.boot();
  }
  boot(fromRestart) {
    if (fromRestart) { this.cycleStart = Date.now(); this.nextRestart = this.cycleStart + CYCLE; this.warned.clear(); persistSchedule(); } // the 5-day cycle starts when the server is back up
    this.startedAt = Date.now(); this.phase = 'starting'; this.lastTick = Date.now();
    this.T = new Terrain(this.seed).generate(); const L = layoutWorld(this.T); this.spawns = L.spawns;
    this.nodes = L.nodes.map(n => ({ id: n.id, type: n.type, x: n.x, y: n.y, z: n.z, tier: n.tier, hp: NODE_TYPES[n.type].hp, alive: true, respawn: 0, inv: null }));
    const save = readJSON(`world-${this.id}.json`, null);
    this.clock = 0; this.buildings = new Map(); this.structures = new Map(); this.deploys = new Map(); this.drops = new Map(); this.store = {};
    this.env = new Env(this.seed); this.env.time = 0.33;
    if (save && save.v === 1) {
      this.clock = save.clock || 0; this.env.restore(save.env);
      for (const [id, alive, resp, hp, inv] of save.nodes || []) { const n = this.nodes[id]; if (n) Object.assign(n, { alive: !!alive, respawn: resp, hp, inv: inv || null }); }
      for (const b of save.buildings || []) this.buildings.set(b.id, b);
      for (const s of save.structures || []) this.structures.set(s.id, s);
      for (const d of save.deploys || []) this.deploys.set(d.id, d);
      for (const d of save.drops || []) this.drops.set(d.id, d);
      this.store = save.players || {};
    }
    this.animals = new AnimalSim(this.T, null, this.seed + 7); this.animals.populate([], true);
    this.depDirty = new Set(); this.opsOut = [];
    log(`[${this.id}] world ready · ${this.structures.size} structures · next restart ${new Date(this.nextRestart).toISOString()}`);
    setTimeout(() => { if (this.phase === 'starting') this.phase = 'online'; }, STARTING);
  }
  serializeWorld() {
    return { v: 1, id: this.id, savedAt: Date.now(), clock: this.clock, env: this.env.serialize(),
      nodes: this.nodes.filter(n => !n.alive || n.inv || n.hp < NODE_TYPES[n.type].hp).map(n => [n.id, n.alive ? 1 : 0, Math.round(n.respawn), Math.round(n.hp), n.inv || 0]),
      buildings: [...this.buildings.values()], structures: [...this.structures.values()], deploys: [...this.deploys.values()], drops: [...this.drops.values()], players: this.store };
  }
  save() { try { writeJSON(`world-${this.id}.json`, this.serializeWorld()); } catch (e) { log(`[${this.id}] save failed`, e.message); } }
  snapshot() { const s = this.serializeWorld(); return { nodes: s.nodes, buildings: s.buildings, structures: s.structures, deploys: s.deploys, drops: s.drops, animals: this.animals.serialize() }; }
  // real health: the shard tick must have run recently (event loop alive, simulation not stuck)
  status() {
    if (this.maintenance) return 'maintenance';
    if (this.phase === 'restarting') return 'restarting';
    if (this.phase === 'starting') return 'starting';
    if (Date.now() - this.lastTick > 5000) return 'unavailable';
    if (this.players.size >= this.max) return 'full';
    return 'online';
  }
  info() { return { id: this.id, name: this.name, status: this.status(), players: this.players.size, max: this.max, queue: this.queue.length, map: this.map, mode: this.mode, region: this.region, version: VERSION, build: BUILD.id, locked: this.locked, uptime: Date.now() - this.startedAt, nextRestart: Math.max(0, this.nextRestart - Date.now()), restartCycle: CYCLE }; }
  broadcast(m, except) { const s = typeof m === 'string' ? m : JSON.stringify(m); for (const c of this.players.values()) if (c !== except) send(c, s); }
  // ---------------------------------------------------------------- simulation tick (10 Hz)
  tick(dt) {
    this.lastTick = Date.now(); if (this.phase === 'restarting') return;
    this.clock += dt; this.env.update(dt, true);
    const pl = [...this.players.values()].map(c => ({ id: c.id, pos: c.pos, crouch: c.crouch, dead: c.dead }));
    this.animals.update(dt, pl, (a, tp, dmg, bleed) => { const c = this.players.get(tp.id); if (c) send(c, { t: 'hurt', dmg: this.mode === 'build' ? dmg * 0.3 : this.mode === 'hardcore' ? dmg * 1.4 : dmg, kind: 'animal', src: a.type, bleed }); }, this.env.isNight);
    // node respawns
    if ((this._rT = (this._rT || 0) + dt) > 5) { this._rT = 0; for (const n of this.nodes) if (!n.alive && n.respawn && this.clock >= n.respawn) { n.alive = true; n.hp = NODE_TYPES[n.type].hp; n.inv = null; n.respawn = 0; this.opsOut.push({ t: 'node', id: n.id, alive: true, hp: n.hp, inv: null }); }
      for (const d of this.drops.values()) if (d.until && d.until < this.clock) { this.drops.delete(d.id); this.opsOut.push({ t: 'drop-', id: d.id }); } }
    // fires & furnaces
    for (const d of this.deploys.values()) {
      if (!d.lit || !d.inv) continue;
      d.burn = (d.burn || 0) - dt; d.work = (d.work || 0) + dt;
      if (d.burn <= 0) { const wi = d.inv.findIndex(s => s && s.id === 'wood'); if (wi < 0) { d.lit = false; this.depDirty.add(d.id); continue; } d.inv[wi].n--; if (!d.inv[wi].n) d.inv[wi] = null; d.burn = d.kind === 'furnace' ? 4 : 6; this.depDirty.add(d.id); }
      const cook = (from, to, every) => { if (d.work >= every) { d.work = 0; const i = d.inv.findIndex(s => s && s.id === from); if (i >= 0) { d.inv[i].n--; if (!d.inv[i].n) d.inv[i] = null; addTo(d.inv, to, 1); this.depDirty.add(d.id); } } };
      if (d.kind === 'campfire') cook('raw_meat', 'cooked_meat', 10); if (d.kind === 'furnace') cook('metal_ore', 'metal_frag', 2);
    }
    if ((this._dT = (this._dT || 0) + dt) > 1) { this._dT = 0; for (const id of this.depDirty) { const d = this.deploys.get(id); if (d) this.opsOut.push({ t: 'depU', id, patch: { inv: d.inv, lit: !!d.lit } }); } this.depDirty.clear(); }
    if (this.opsOut.length) { this.broadcast({ t: 'ops', ops: this.opsOut }); this.opsOut = []; }
    // player states 10 Hz, animals 5 Hz (per-player radius), env every 10 s
    if (this.players.size) {
      const ps = { t: 'ps', list: [...this.players.values()].map(c => ({ id: c.id, p: c.pos, yaw: c.yaw, pitch: c.pitch, spd: c.spd, crouch: c.crouch, swing: c.swing, item: c.item, light: c.light, dead: c.dead, tired: c.tired })) };
      this.broadcast(ps);
      if ((this._aT = (this._aT || 0) + dt) > 0.2) { this._aT = 0; const all = this.animals.serialize(); for (const c of this.players.values()) send(c, { t: 'an', list: all.filter(a => Math.abs(a.x - c.pos[0]) < 260 && Math.abs(a.z - c.pos[2]) < 260) }); }
      if ((this._eT = (this._eT || 0) + dt) > 10) { this._eT = 0; this.broadcast({ t: 'env', env: this.env.serialize() }); }
    }
  }
  // ---------------------------------------------------------------- restart cycle
  schedTick() {
    if (this.phase === 'restarting') return;
    const left = this.nextRestart - Date.now();
    for (const w of WARN_AT) if (left <= w && left > w - 15e3 && !this.warned.has(w)) { this.warned.add(w); this.broadcast({ t: 'restart', in: w, phase: 'warn' }); log(`[${this.id}] restart warning T-${w / 1000}s`); }
    if (left <= 0 && this.phase !== 'restarting') this.restart('scheduled');
  }
  restart(why) {
    log(`[${this.id}] RESTART (${why}) · saving ${this.players.size} players`);
    this.phase = 'restarting';
    for (const c of this.players.values()) { flushPlaytime(c); }
    this.save(); saveProfiles();
    for (const c of [...this.players.values()]) { send(c, { t: 'reject', code: 'restart', msg: 'Server restarting' }); c.leaving = true; try { c.ws.close(4000, 'restart'); } catch (e) {} }
    this.players.clear(); this.queue.forEach(c => { send(c, { t: 'reject', code: 'restarting' }); try { c.ws.close(); } catch (e) {} }); this.queue = [];
    setTimeout(() => { try { this.boot(true); } catch (e) { log(`[${this.id}] boot failed`, e); this.phase = 'restarting'; } }, GRACE); // grace period, then a clean boot from the saved world
  }
}
const shards = new Map(); SHARD_CFG.forEach((c, i) => shards.set(c.id, new Shard(c, i, SHARD_CFG.length)));
function persistSchedule() { const o = {}; for (const s of shards.values()) o[s.id] = { cycleStart: s.cycleStart, nextRestart: s.nextRestart }; writeJSON('schedule.json', o); }
persistSchedule();
const totalPlayers = () => [...shards.values()].reduce((a, s) => a + s.players.size, 0);
const counts = sh => ({ server: sh ? sh.players.size : 0, total: totalPlayers(), servers: shards.size });

// ------------------------------------------------------------------ playtime (server clock is the only source)
function profileOf(tokenHash) { return profiles[tokenHash]; }
function flushPlaytime(c) { if (!c.prof || !c.joinedAt) return; const now = Date.now(), d = Math.max(0, now - (c.flushedAt || c.joinedAt)) / 1000; c.prof.total = (c.prof.total || 0) + d; c.prof.last = now; c.flushedAt = now; profilesDirty = true; }
const publicProfile = p => p ? { name: p.name, total: Math.round(p.total || 0), sessions: p.sessions || 0, first: p.first, last: p.last } : null;

// ------------------------------------------------------------------ live-ops backend (auth, RBAC, releases, moderation, remote config…)
const kickTh = (th, msg) => { let n = 0; for (const sh of shards.values()) for (const c of [...sh.players.values(), ...sh.queue]) if (c.th === th) { send(c, { t: 'reject', code: 'kicked', msg: msg || 'Removed by staff' }); c.kicked = true; setTimeout(() => { try { c.ws.close(); } catch (e) {} }, 100); n++; } return n; };
const admin = createAdmin({ dataDir: DATA, pubDir: PUB, serverDir: __dir, build: BUILD, game: {
  protocolMin: PROTOCOL_MIN, isOwnerKey: k => isAdminKey(k), profiles: () => profiles, totalPlayers: () => totalPlayers(), shardInfo: () => [...shards.values()].map(s => s.info()),
  onlineMap: () => { const m = new Map(); for (const sh of shards.values()) for (const c of sh.players.values()) m.set(c.th, { server: sh.id, id: c.id, ip: c.ip }); return m; },
  sendTo: (th, msg) => { for (const sh of shards.values()) for (const c of sh.players.values()) if (c.th === th) send(c, msg); }, kick: kickTh,
  scheduleRestart: (id, ms) => { const sh = shards.get(id); sh.nextRestart = Date.now() + ms; sh.warned.clear(); persistSchedule(); },
  setShardMaintenance: (id, on) => { const sh = shards.get(id); sh.maintenance = on; if (on) for (const c of [...sh.players.values()]) if (!c.admin) kickTh(c.th, 'Server maintenance'); },
  setShardLock: (id, on) => { shards.get(id).locked = on; },
  broadcast: (id, msg) => { let n = 0; for (const sh of shards.values()) if (!id || sh.id === id) { sh.broadcast({ t: 'chat', sys: 1, msg: '[ARVEX] ' + msg }); n += sh.players.size; } return n; },
  saveAll: () => { for (const s of shards.values()) s.save(); profilesDirty = true; saveProfiles(); },
  onRelease: r => { for (const sh of shards.values()) sh.broadcast({ t: 'chat', sys: 1, msg: `ARVEX ${r.version} is available. Restart the launcher to update.` }); },
  onConfig: pc => { if (pc.maintenance.on) for (const sh of shards.values()) for (const c of [...sh.players.values()]) if (!c.admin) kickTh(c.th, pc.maintenance.message[1] || 'Maintenance'); for (const sh of shards.values()) sh.broadcast({ t: 'config', flags: pc.flags }); }
} });
const manifestFor = ch => admin.releases.manifestFor(ch, { minVersion: admin.effectiveMinVersion(), forceUpdate: admin.config.forceUpdate.on });
const ADMIN_UI = path.join(__dir, 'admin-ui');
const ADMIN_CSP = "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; font-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'";

// ------------------------------------------------------------------ HTTP
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.ico': 'image/x-icon', '.svg': 'image/svg+xml', '.woff': 'font/woff', '.woff2': 'font/woff2', '.txt': 'text/plain; charset=utf-8', '.exe': 'application/octet-stream', '.zip': 'application/zip', '.bin': 'application/octet-stream' };
const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': 'content-type', 'access-control-allow-methods': 'GET,POST,OPTIONS' };
function json(res, code, obj) { res.writeHead(code, Object.assign({ 'content-type': 'application/json', 'cache-control': 'no-store' }, CORS)); res.end(JSON.stringify(obj)); }
function serveFile(req, res, file, opts = {}) {
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) { res.writeHead(404, { 'content-type': 'text/plain' }); return res.end('not found'); }
    if (opts.etag && req.headers['if-none-match'] === opts.etag) { res.writeHead(304, Object.assign({ etag: opts.etag, 'cache-control': 'no-cache' }, CORS)); return res.end(); }
    if (opts.etag) opts.headers = Object.assign({ etag: opts.etag, 'cache-control': 'no-cache' }, opts.headers);   // always revalidated, so a deploy is picked up at once; unchanged files cost a 304
    if (opts.gz && !req.headers.range && /\bgzip\b/.test(req.headers['accept-encoding'] || '')) { // precompressed copy (same bytes every time, cached on disk by content hash)
      const ext0 = path.extname(file).toLowerCase(), noCache0 = ext0 === '.html' || file.endsWith('sw.js') || ext0 === '.webmanifest' || file.endsWith('build.json');
      res.writeHead(200, Object.assign({ 'content-type': TYPES[ext0] || 'application/octet-stream', 'content-encoding': 'gzip', 'content-length': opts.gz.size, vary: 'accept-encoding', 'x-content-type-options': 'nosniff', 'cache-control': 'public, max-age=3600' }, noCache0 ? { 'cache-control': 'no-cache' } : null, opts.headers, CORS));
      if (req.method === 'HEAD') return res.end(); return fs.createReadStream(opts.gz.path).pipe(res);
    }
    const ext = path.extname(file).toLowerCase(), noCache = ext === '.html' || file.endsWith('sw.js') || ext === '.webmanifest' || file.endsWith('build.json');
    const h = Object.assign({ 'content-type': TYPES[ext] || 'application/octet-stream', 'accept-ranges': 'bytes', 'x-content-type-options': 'nosniff', 'cache-control': opts.immutable ? 'public, max-age=31536000, immutable' : noCache ? 'no-cache' : 'public, max-age=3600' }, opts.headers, CORS);
    const range = req.headers.range && /^bytes=(\d*)-(\d*)$/.exec(req.headers.range);
    if (range) { // resumable downloads for the launcher
      let a = range[1] === '' ? st.size - +range[2] : +range[1], b = range[1] !== '' && range[2] !== '' ? +range[2] : st.size - 1;
      if (a >= st.size || a > b) { res.writeHead(416, Object.assign(h, { 'content-range': `bytes */${st.size}` })); return res.end(); }
      res.writeHead(206, Object.assign(h, { 'content-range': `bytes ${a}-${b}/${st.size}`, 'content-length': b - a + 1 }));
      if (req.method === 'HEAD') return res.end(); return fs.createReadStream(file, { start: a, end: b }).pipe(res);
    }
    res.writeHead(200, Object.assign(h, { 'content-length': st.size })); if (req.method === 'HEAD') return res.end(); fs.createReadStream(file).pipe(res);
  });
}
function body(req) { return new Promise((res) => { let b = ''; req.on('data', d => { b += d; if (b.length > 8192) req.destroy(); }); req.on('end', () => { try { res(JSON.parse(b || '{}')); } catch (e) { res({}); } }); }); }
const httpLimiter = new RateLimiter();
const server = http.createServer(async (req, res) => {
  let u, p; try { u = new URL(req.url, 'http://x'); p = decodeURIComponent(u.pathname); } catch (e) { res.writeHead(400); return res.end(); }
  if (req.method === 'OPTIONS') { res.writeHead(204, CORS); return res.end(); }
  try {
    if (p === '/health') { const list = [...shards.values()].map(s => s.info()), h = admin.health(), ok = list.every(s => s.status !== 'unavailable') && h.database.ok; return json(res, ok ? 200 : 503, { ok, version: VERSION, build: BUILD.id, players: totalPlayers(), servers: list.map(s => ({ id: s.id, status: s.status, players: s.players })), services: { api: h.api.ok, database: h.database.ok, storage: h.storage.ok, cdn: h.cdn.ok, launcher: h.launcher.ok, game: h.game.ok } }); }
    if (p === '/api/ping') return json(res, 200, { t: Date.now() });
    if (p === '/api/servers') { const host = process.env.PUBLIC_URL || ''; return json(res, 200, { version: VERSION, build: BUILD.id, servers: [...shards.values()].map(s => Object.assign(s.info(), host ? { host } : {})), total: totalPlayers() }); }
    if (p === '/api/profile') {
      if (req.method === 'POST') { const b = await body(req), h = hashToken(b.token || ''), pr = b.token && profileOf(h); if (!pr) return json(res, 404, { error: 'unknown' }); const n = clean(b.name, 16); if (n.length >= 2) { pr.name = n; profilesDirty = true; } return json(res, 200, { profile: publicProfile(pr) }); }
      const t = u.searchParams.get('token'), pr = t && profileOf(hashToken(t)); return pr ? json(res, 200, { profile: publicProfile(pr) }) : json(res, 404, { error: 'unknown' });
    }
    // staff API (session cookie + CSRF + RBAC + audit) and the admin panel itself
    if (p.startsWith(admin.API + '/') || p === admin.API) return void await admin.handleAdmin(req, res, u, p);
    if (p === '/admin' || p === '/admin/') return serveFile(req, res, path.join(ADMIN_UI, 'index.html'), { headers: { 'content-security-policy': ADMIN_CSP, 'x-frame-options': 'DENY', 'cache-control': 'no-store' } });
    if (p.startsWith('/admin/')) { const f = path.normalize(path.join(ADMIN_UI, p.slice(7))); if (!f.startsWith(ADMIN_UI + path.sep)) { res.writeHead(403); return res.end(); } return serveFile(req, res, f, { headers: { 'content-security-policy': ADMIN_CSP, 'x-frame-options': 'DENY', 'cache-control': 'no-cache' } }); }
    if (p.startsWith('/api/admin/')) { // legacy key-based endpoints kept for scripts; every call is audited
      const w = httpLimiter.hit('legacy:' + clientIp(req), 20, 60e3); if (w) return json(res, 429, { error: 'rate_limited', retryAfter: w });
      if (!ADMIN_KEY || req.headers['x-admin-key'] !== ADMIN_KEY) return json(res, 403, { error: 'forbidden' });
      const sh = shards.get(u.searchParams.get('server')); if (!sh) return json(res, 404, { error: 'no such server' });
      if (p === '/api/admin/restart') { sh.nextRestart = Date.now() + num(u.searchParams.get('in'), 0, 3600e3, 60e3); sh.warned.clear(); persistSchedule(); admin.legacyAudit('server.restart', sh.id, clientIp(req)); return json(res, 200, sh.info()); }
      if (p === '/api/admin/maintenance') { sh.maintenance = u.searchParams.get('on') === '1'; admin.legacyAudit('server.maintenance', sh.id, clientIp(req), { on: sh.maintenance }); return json(res, 200, sh.info()); }
      return json(res, 404, {});
    }
    // public live-ops API: remote config, news, changelog, telemetry, support tickets
    if (p.startsWith('/api/')) { if (await admin.handlePublic(req, res, u, p, CORS)) return; return json(res, 404, { error: 'not_found', message: 'No such endpoint' }); }
    // launcher distribution: signed manifest per channel, release files with HTTP Range, precompressed blobs
    if (p === '/launcher/latest.json' || p === '/launcher/manifest.json') {
      const m = manifestFor(u.searchParams.get('channel') || 'stable'); if (!m) return json(res, 503, { error: 'no_release', message: 'No release is published on this channel' });
      if (p === '/launcher/manifest.json') return json(res, 200, m);
      const v = admin.publicConfig(); return json(res, 200, { product: m.product, version: m.version, buildId: m.buildId, channel: m.channel, releaseDate: m.releaseDate, minVersion: m.minVersion, mandatory: m.mandatory, required: m.required, total: m.total, compressedTotal: m.compressedTotal, files: m.files.length, manifest: '/launcher/manifest.json?channel=' + m.channel, manifestSha256: m.sha256, signed: !!m.signature, notes: m.releaseNotes, news: '/api/news', maintenance: v.maintenance, forceUpdate: v.forceUpdate });
    }
    const fm = /^\/launcher\/files\/([^/]+)\/(.+)$/.exec(p);
    if (fm) { const f = admin.releases.filePath(fm[1], fm[2]); if (!f) return json(res, 410, { error: 'gone', message: 'This file is not part of an available release', current: BUILD.id }); return serveFile(req, res, f, { immutable: true }); }
    const gm = /^\/launcher\/gz\/([a-f0-9]{64})$/.exec(p);
    if (gm) { const f = admin.releases.gzPath(gm[1]); if (!f || !fs.existsSync(f)) return json(res, 404, { error: 'not_found' }); return serveFile(req, res, f, { immutable: true }); }
    if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405); return res.end(); }
    let url = p === '/' ? '/index.html' : p; const file = path.normalize(path.join(PUB, url));
    if (!file.startsWith(PUB)) { res.writeHead(403); return res.end(); }
    const wf = admin.releases.webFile(url.slice(1)); serveFile(req, res, file, wf ? { gz: wf.gz, etag: wf.etag } : {});
  } catch (e) { slog.error('request failed: ' + (e.stack || e.message)); if (!res.headersSent) json(res, 500, { error: 'internal', message: 'Server error' }); else res.end(); }
});

// ------------------------------------------------------------------ WebSocket game protocol
const conns = new Set(); let NEXT = 1;
function send(c, m) { if (c && c.ws.readyState === 1) c.ws.send(typeof m === 'string' ? m : JSON.stringify(m)); }
const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 64 * 1024, perMessageDeflate: { threshold: 2048 } });
wss.on('connection', (ws, req) => {
  const u = new URL(req.url, 'http://x'), sh = shards.get(u.searchParams.get('server'));
  const c = { id: 'p' + (NEXT++), ws, sh, ip: clientIp(req), pos: [0, 0, 0], yaw: 0, pitch: 0, spd: 0, crouch: 0, swing: 0, item: '', light: 0, dead: 0, bucket: 80, last: Date.now(), alive: true };
  conns.add(c);
  if (!sh) { send(c, { t: 'reject', code: 'unknown', msg: 'Unknown server' }); return ws.close(); }
  ws.on('pong', () => { c.alive = true; });
  ws.on('message', (data, bin) => {
    if (bin) return; const now = Date.now(); c.bucket = Math.min(160, c.bucket + (now - c.last) * 0.08); c.last = now; if (c.bucket < 1) return; c.bucket -= 1;
    let m; try { m = JSON.parse(data.toString()); } catch (e) { return; } if (!m || typeof m.t !== 'string') return;
    try { handle(c, m); } catch (e) { log('handler error', m.t, e.message); }
  });
  ws.on('close', () => leave(c));
});
function hello(c, m) {
  const sh = c.sh;
  // version window: at least the managed minimum, never newer than this server, same major protocol
  const minV = admin.effectiveMinVersion();
  if (!isVersion(m.version) || cmpVersion(m.version, minV) < 0 || cmpVersion(m.version, VERSION) > 0 || m.version.split('.')[0] !== VERSION.split('.')[0]) return reject(c, 'version', `Server runs ${VERSION} (minimum ${minV})`);
  c.admin = isAdminKey(m.adminKey);
  if (sh.maintenance && !c.admin) return reject(c, 'maintenance'); if (sh.phase === 'restarting') return reject(c, 'restarting');
  if (sh.locked && !c.admin) return reject(c, 'locked', 'This server is locked by staff');
  let token = typeof m.token === 'string' && /^[a-f0-9]{48}$/.test(m.token) ? m.token : null;
  if (!token) token = crypto.randomBytes(24).toString('hex');
  const th = hashToken(token);
  if (!c.admin) { const deny = admin.checkJoin(th, c.ip); if (deny) return reject(c, deny.code, deny.msg); }   // bans + global maintenance are enforced here, on the server
  // one connection per account across every shard (no duplicate players / player data)
  for (const s of shards.values()) for (const o of s.players.values()) if (o.th === th && o.ws.readyState === 1 && !o.kicked) return reject(c, 'duplicate', 'Already connected');
  if (sh.queue.some(o => o.th === th)) return reject(c, 'duplicate');
  c.token = token; c.th = th; c.name = clean(m.name, 16) || 'Survivor';
  let pr = profiles[th]; if (!pr) { pr = profiles[th] = { name: c.name, total: 0, sessions: 0, first: Date.now(), last: Date.now() }; } pr.name = c.name; c.prof = pr; profilesDirty = true;
  if (sh.players.size >= sh.max) { c.queued = true; sh.queue.push(c); send(c, { t: 'queue', pos: sh.queue.length, players: sh.players.size, max: sh.max }); return; }
  admit(c);
}
function admit(c) {
  const sh = c.sh; c.queued = false;
  c.prof.sessions = (c.prof.sessions || 0) + 1; c.joinedAt = Date.now(); c.flushedAt = c.joinedAt; profilesDirty = true;
  const st = sh.store[c.th];
  let spawn = st && st.state && st.state.pos && st.state.hp > 0 ? st.state.pos : (() => { const s = sh.spawns[Math.floor(Math.random() * sh.spawns.length)]; return [s[0], sh.T.height(s[0], s[2]) + 0.1, s[2]]; })();
  c.pos = spawn.slice(); c.fresh = true; sh.players.set(c.id, c);
  send(c, { t: 'welcome', id: c.id, owner: c.th, admin: !!c.admin, token: c.token, version: VERSION, build: BUILD.id, flags: admin.publicConfig().flags, seed: sh.seed, server: { id: sh.id, name: sh.name, mode: sh.mode, region: sh.region, map: sh.map, max: sh.max }, serverTime: Date.now(), sessionStart: c.joinedAt, spawn: c.pos,
    profile: publicProfile(c.prof), counts: counts(sh), env: sh.env.serialize(), snapshot: sh.snapshot(), players: [...sh.players.values()].filter(o => o !== c).map(o => ({ id: o.id, name: o.name, p: o.pos, yaw: o.yaw })),
    player: st && st.state && st.state.hp > 0 ? { state: st.state, inv: st.inv } : null });
  sh.broadcast({ t: 'join', id: c.id, name: c.name, p: c.pos }, c);
  sh.broadcast({ t: 'chat', sys: 1, msg: `${c.name} joined` }, c);
  log(`[${sh.id}] + ${c.name} (${sh.players.size}/${sh.max})`);
}
function reject(c, code, msg) { send(c, { t: 'reject', code, msg: msg || code }); setTimeout(() => { try { c.ws.close(); } catch (e) {} }, 50); }
function leave(c) {
  conns.delete(c); const sh = c.sh; if (!sh) return;
  if (c.queued) { sh.queue = sh.queue.filter(o => o !== c); sh.queue.forEach((o, i) => send(o, { t: 'queue', pos: i + 1, players: sh.players.size, max: sh.max })); return; }
  if (!sh.players.has(c.id)) return;
  flushPlaytime(c); sh.players.delete(c.id);
  if (!c.leaving) { sh.broadcast({ t: 'leave', id: c.id }); sh.broadcast({ t: 'chat', sys: 1, msg: `${c.name} left` }); }
  log(`[${sh.id}] - ${c.name} (${sh.players.size}/${sh.max})`);
  // free slot → admit the first player waiting in the queue
  while (sh.queue.length && sh.players.size < sh.max && sh.phase !== 'restarting') { const n = sh.queue.shift(); if (n.ws.readyState === 1) admit(n); }
  sh.queue.forEach((o, i) => send(o, { t: 'queue', pos: i + 1, players: sh.players.size, max: sh.max }));
}
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
function handle(c, m) {
  const sh = c.sh;
  if (m.t === 'hello') return hello(c, m);
  if (m.t === 'ping') return send(c, { t: 'pong', k: m.k, counts: counts(sh) });
  if (!sh.players.has(c.id)) return; // everything below needs an admitted player
  switch (m.t) {
    case 'st': if (Array.isArray(m.p) && m.p.length === 3) { const np = m.p.map(v => num(v, -900, 900)); if (dist(np, c.pos) < 40 || c.dead || c.fresh) { c.pos = np; c.fresh = false; } } c.yaw = num(m.yaw, -1e4, 1e4); c.pitch = num(m.pitch, -2, 2); c.spd = num(m.spd, 0, 20); c.crouch = m.crouch ? 1 : 0; c.swing = m.swing ? 1 : 0; c.item = clean(m.item, 20); c.light = m.light ? 1 : 0; c.dead = m.dead ? 1 : 0; c.tired = m.tired ? 1 : 0; break;
    case 'persist': if (m.state && m.inv) { const s = JSON.stringify(m); if (s.length < 40000) sh.store[c.th] = { state: m.state, inv: m.inv, at: Date.now() }; } break;
    case 'chat': {
      const msg = clean(m.msg, 160); if (!msg || Date.now() - (c.chatT || 0) < 800) return; c.chatT = Date.now();
      if (msg.startsWith('/report ')) return void reportCmd(c, msg.slice(8));
      const muted = admin.mutedUntil(c.th); if (muted) return send(c, { t: 'chat', sys: 1, msg: `You are muted for another ${Math.ceil((muted - Date.now()) / 60e3)} min.` });
      sh.chatLog.push({ at: Date.now(), th: c.th, name: c.name, msg }); if (sh.chatLog.length > 60) sh.chatLog.shift();
      sh.broadcast({ t: 'chat', name: c.name, msg }); break;
    }
    case 'op': worldOp(c, m.op); break;
    case 'hitAnimal': { const a = sh.animals.list.find(x => x.id === m.id), lim = hitLimit(c, m.kind); if (!a || !lim || dist([a.x, a.y, a.z], c.pos) > lim.range) return; const r = sh.animals.hurt(a, num(m.dmg, 0, lim.dmg), c.id); if (r === 'dead') send(c, { t: 'killed', name: { deer: ['غزال', 'Deer'], boar: ['خنزير بري', 'Boar'], wolf: ['ذيب', 'Wolf'], bear: ['دب', 'Bear'] }[a.type], xp: { deer: 10, boar: 14, wolf: 18, bear: 45 }[a.type] }); break; }
    case 'harvest': { const a = sh.animals.list.find(x => x.id === m.id); if (!a || dist([a.x, a.y, a.z], c.pos) > 6) return; const items = sh.animals.harvest(a, num(m.mult, 0.3, 2.5, 1)); if (items.length) send(c, { t: 'harvest', items }); break; }
    case 'hitPlayer': {
      if (!['pvp', 'hardcore'].includes(sh.mode)) return; const v = sh.players.get(m.id); if (!v || v.dead) return;
      if (!admin.flag('pvpDamage')) return; const d = dist(v.pos, c.pos), melee = m.kind === 'melee', lim = hitLimit(c, m.kind); if (!lim || d > lim.range) return;
      send(v, { t: 'hurt', dmg: num(m.dmg, 0, lim.dmg) * (sh.mode === 'hardcore' ? 1.3 : 1), kind: melee ? 'melee' : m.kind === 'bullet' ? 'bullet' : 'arrow', src: c.id }); break;
    }
    case 'died': { const k = sh.players.get(m.src); if (k && k !== c) send(k, { t: 'killed', name: [c.name, c.name], xp: 25 }); c.dead = 1; delete sh.store[c.th]; break; }
    case 'admin': adminCmd(c, m); break;
    case 'fx': sh.broadcast({ t: 'fx', k: clean(m.k, 10), g: clean(m.g, 10), p: Array.isArray(m.p) ? m.p.slice(0, 3) : c.pos }, c); break;
  }
}
// ------------------------------------------------------------------ server-side sanity checks for hits: the client proposes, the server caps
// damage is limited to what the held item can do, range to the weapon's reach, and rate to its fire rate (with a small burst for pellets / latency)
function hitLimit(c, kind) {
  const it = ITEMS[c.item], now = Date.now(), melee = kind === 'melee' || (!kind && !(it && it.ranged));
  const spec = melee ? (it && it.melee) || { dmg: 6, range: 1.6, rate: 0.6 } : it && it.ranged; if (!spec) return null;
  const burst = (spec.pellets || 1) + 2, per = Math.max(60, (spec.rate || 0.4) * 1000 * 0.7);
  c.hitTokens = Math.min(burst, (c.hitTokens == null ? burst : c.hitTokens) + (now - (c.hitAt || now)) / per * (spec.pellets || 1)); c.hitAt = now;
  if (c.hitTokens < 1) { c.hitDrops = (c.hitDrops || 0) + 1; if (c.hitDrops === 40) slog.warn(`[${c.sh.id}] ${c.name} exceeded the fire rate of ${c.item || 'hands'} 40 times`); return null; }
  c.hitTokens -= 1;
  return { dmg: spec.dmg * (melee ? 1.6 : 2.2), range: melee ? (spec.range || 1.8) + 3 : (spec.range || 120) * 1.15 + 8 };
}
function reportCmd(c, rest) {
  const sh = c.sh, sp = rest.trim().split(/\s+/), who = (sp.shift() || '').toLowerCase(), text = sp.join(' ');
  const tgt = [...sh.players.values()].find(o => o !== c && o.name.toLowerCase() === who) || [...sh.players.values()].find(o => o !== c && o.name.toLowerCase().startsWith(who) && who.length >= 3);
  if (!tgt || text.length < 4) return send(c, { t: 'chat', sys: 1, msg: 'Usage: /report <player name> <what happened>' });
  const r = admin.addReport({ reporter: { th: c.th, name: c.name }, target: { th: tgt.th, name: tgt.name }, server: sh.id, category: /cheat|hack|aim|speed/i.test(text) ? 'cheating' : /spam/i.test(text) ? 'spam' : /grief|raid|base/i.test(text) ? 'griefing' : 'abuse', text,
    evidence: { distance: Math.round(dist(c.pos, tgt.pos)), targetPos: tgt.pos.map(v => Math.round(v)), targetItem: tgt.item, mode: sh.mode, chat: sh.chatLog.filter(l => l.th === tgt.th).slice(-8).map(l => ({ at: l.at, msg: l.msg })) } });
  send(c, { t: 'chat', sys: 1, msg: r.error || `Report ${r.id} sent to the ARVEX staff. Thank you.` });
}
// ------------------------------------------------------------------ admin commands (owner only)
function adminCmd(c, m) {
  if (!c.admin) return; const sh = c.sh, tgt = m.target === 'me' ? c : sh.players.get(m.target), all = m.target === 'all' ? [...sh.players.values()].filter(x => x !== c) : tgt ? [tgt] : [];
  const tp = (who, p) => { who.pos = p.slice(); who.fresh = true; send(who, { t: 'teleport', p }); };
  switch (m.cmd) {
    case 'bring': for (const t of all) tp(t, [c.pos[0] + 1.5, c.pos[1] + 0.5, c.pos[2]]); break;
    case 'goto': if (tgt) tp(c, [tgt.pos[0] + 1.5, tgt.pos[1] + 0.5, tgt.pos[2]]); break;
    case 'tpxz': { const x = num(m.x, -760, 760), z = num(m.z, -760, 760), p = [x, Math.max(sh.T.height(x, z), 0) + 1, z]; for (const t of all) tp(t, p); break; }
    case 'heal': for (const t of all) send(t, { t: 'heal' }); break;
    case 'give': if (ITEMS[m.item]) for (const t of all) send(t, { t: 'give', id: m.item, n: num(m.n, 1, 10000, 1) | 0 }); break;
    case 'kick': for (const t of all) if (t !== c) { send(t, { t: 'reject', code: 'kicked', msg: clean(m.reason, 80) || 'Kicked by admin' }); t.leaving = false; setTimeout(() => { try { t.ws.close(); } catch (e) {} }, 100); } break;
    case 'time': sh.env.time = num(m.v, 0, 0.999); sh.broadcast({ t: 'env', env: sh.env.serialize() }); break;
    case 'weather': if (['clear', 'cloudy', 'rain', 'storm', 'fog'].includes(m.w)) { sh.env.setWeather(m.w, true); sh.broadcast({ t: 'env', env: sh.env.serialize() }); } break;
    case 'say': { const msg = clean(m.msg, 160); if (msg) sh.broadcast({ t: 'chat', sys: 1, msg: '[ADMIN] ' + msg }); break; }
    case 'restart': sh.nextRestart = Date.now() + num(m.in, 15e3, 3600e3, 60e3); sh.warned.clear(); persistSchedule(); sh.broadcast({ t: 'chat', sys: 1, msg: '[ADMIN] restart scheduled' }); break;
  }
  log(`[${sh.id}] admin ${c.name}: ${m.cmd} ${m.target || ''}`); admin.gameAudit(c.name, 'ingame.' + clean(m.cmd, 16), clean(String(m.target || ''), 24), { server: sh.id });
}
// ------------------------------------------------------------------ world operations (validated, applied, broadcast)
function owns(c, obj) { return !obj.owner || obj.owner === c.th; }
function worldOp(c, op) {
  const sh = c.sh; if (!op || typeof op.t !== 'string') return;
  const pvp = sh.mode === 'pvp' || sh.mode === 'hardcore', out = [];
  switch (op.t) {
    case 'node': {
      const n = sh.nodes[op.id | 0]; if (!n) return; if (dist([n.x, n.y, n.z], c.pos) > 12) return;
      if (op.hp != null) n.hp = Math.min(n.hp, num(op.hp, 0, 1e9));
      if (op.alive === false && n.alive) { const k = NODE_TYPES[n.type].kind; n.alive = false; n.respawn = sh.clock + (RESPAWN[k === 'loot' ? 'loot' : k] || 600); n.inv = null; }
      if (op.inv !== undefined && n.alive && NODE_TYPES[n.type].kind === 'loot') n.inv = Array.isArray(op.inv) ? op.inv.slice(0, 12) : null;
      // crates: the server rolls loot the first time anyone opens one
      if (op.inv && NODE_TYPES[n.type].kind === 'loot' && !n.rolled) { n.rolled = true; }
      out.push({ t: 'node', id: n.id, hp: n.hp, alive: n.alive, respawn: n.respawn, inv: n.inv }); break;
    }
    case 'st+': {
      const st = op.st; if (!st || typeof st.id !== 'string' || !['foundation', 'floor', 'wall', 'doorway', 'window', 'roof', 'stairs', 'pillar'].includes(st.piece)) return;
      if (op.b) { // new building: keep clear of other players' bases
        const b = op.b; if (Math.hypot(b.x - c.pos[0], b.z - c.pos[2]) > 14) return;
        for (const o of sh.buildings.values()) if (o.owner !== c.th && Math.hypot(o.x - b.x, o.z - b.z) < 12) return send(c, { t: 'chat', sys: 1, msg: 'Too close to another base' });
        sh.buildings.set(b.id, { id: clean(b.id, 24), x: num(b.x, -800, 800), y: num(b.y, -50, 200), z: num(b.z, -800, 800), ry: num(b.ry, -100, 100), owner: c.th });
      }
      const B = sh.buildings.get(st.b); if (!B) return; if (B.owner !== c.th && sh.mode !== 'build') return;
      for (const o of sh.structures.values()) if (o.b === st.b && o.piece === st.piece && o.i === st.i && o.j === st.j && o.l === st.l && o.side === st.side) return; // occupied
      const s = { id: clean(st.id, 24), b: st.b, piece: st.piece, tier: 0, hp: num(st.hp, 1, 2000), i: st.i | 0, j: st.j | 0, l: st.l | 0, side: st.side == null ? undefined : st.side | 0, rot: st.rot | 0, owner: c.th, supported: !!st.supported, at: Date.now() };
      sh.structures.set(s.id, s); out.push({ t: 'st+', st: s, b: sh.buildings.get(st.b) }); break;
    }
    case 'stU': { const s = sh.structures.get(op.id); if (!s || !op.patch) return; const p = {};
      if (op.patch.tier != null) { if (!owns(c, s)) return; p.tier = num(op.patch.tier, 0, 3) | 0; }
      if (op.patch.hp != null) { const hp = num(op.patch.hp, 0, 2000); if (hp < s.hp && !pvp && !owns(c, s)) return; p.hp = hp; }
      Object.assign(s, p); out.push({ t: 'stU', id: s.id, patch: p }); break; }
    case 'st-': { const s = sh.structures.get(op.id); if (!s) return; if (!owns(c, s) && !(pvp && s.hp <= 1)) return; sh.structures.delete(s.id); for (const d of [...sh.deploys.values()]) if (d.on === s.id) { sh.deploys.delete(d.id); out.push({ t: 'dep-', id: d.id }); } out.push({ t: 'st-', id: s.id }); break; }
    case 'dep+': { const d = op.d; if (!d || !ITEMS[d.item] || !ITEMS[d.item].deploy) return; if (Math.hypot(d.x - c.pos[0], d.z - c.pos[2]) > 10) return; const it = ITEMS[d.item];
      const nd = { id: clean(d.id, 24), item: d.item, kind: it.deploy.kind, x: num(d.x, -800, 800), y: num(d.y, -50, 200), z: num(d.z, -800, 800), ry: num(d.ry, -100, 100), owner: c.th, on: d.on ? clean(d.on, 24) : undefined, inv: it.deploy.slots ? new Array(it.deploy.slots).fill(null) : undefined };
      sh.deploys.set(nd.id, nd); out.push({ t: 'dep+', d: Object.assign({}, nd, { owner: c.id === undefined ? nd.owner : nd.owner }) }); break; }
    case 'dep-': { const d = sh.deploys.get(op.id); if (!d || !owns(c, d)) return; sh.deploys.delete(d.id); out.push({ t: 'dep-', id: d.id }); break; }
    case 'depU': { const d = sh.deploys.get(op.id); if (!d || !op.patch) return; if (dist([d.x, d.y, d.z], c.pos) > 8) return; const p = {};
      if (op.patch.open != null && d.kind === 'door') { if (!owns(c, d) && !pvp) return; p.open = !!op.patch.open; }
      if (op.patch.lit != null) p.lit = !!op.patch.lit;
      if (Array.isArray(op.patch.inv) && d.inv) { if (!owns(c, d) && !pvp) return; p.inv = op.patch.inv.slice(0, d.inv.length).map(s => s && ITEMS[s.id] ? { id: s.id, n: num(s.n, 1, ITEMS[s.id].stack) | 0, cond: s.cond, ammo: s.ammo, jug: s.jug } : null); }
      Object.assign(d, p); out.push({ t: 'depU', id: d.id, patch: p }); break; }
    case 'drop+': { const d = op.dr; if (!d || !Array.isArray(d.items)) return; const nd = { id: clean(d.id, 24), x: num(d.x, -800, 800), y: num(d.y, -50, 200), z: num(d.z, -800, 800), ry: num(d.ry, 0, 7), bag: !!d.bag, items: d.items.slice(0, 40).filter(s => s && ITEMS[s.id]), until: sh.clock + (d.bag ? 1200 : 600) }; sh.drops.set(nd.id, nd); out.push({ t: 'drop+', dr: nd }); break; }
    case 'dropU': { const d = sh.drops.get(op.id); if (!d || !Array.isArray(op.items)) return; d.items = op.items.slice(0, 40).filter(s => s && ITEMS[s.id]); out.push({ t: 'dropU', id: d.id, items: d.items }); break; }
    case 'drop-': { if (!sh.drops.has(op.id)) return; sh.drops.delete(op.id); out.push({ t: 'drop-', id: op.id }); break; }
    default: return;
  }
  for (const o of out) sh.broadcast({ t: 'op', op: o });
}
function addTo(inv, id, n) { for (const s of inv) if (s && s.id === id && s.n < ITEMS[id].stack) { s.n += n; return; } const i = inv.indexOf(null); if (i >= 0) inv[i] = { id, n }; }

// ------------------------------------------------------------------ timers
let lastT = Date.now();
setInterval(() => { const now = Date.now(), dt = Math.min(0.25, (now - lastT) / 1000); lastT = now; for (const s of shards.values()) s.tick(dt); }, 100);
setInterval(() => { for (const s of shards.values()) s.schedTick(); }, 1000);
setInterval(() => { for (const s of shards.values()) for (const c of s.players.values()) flushPlaytime(c); saveProfiles(); for (const s of shards.values()) if (s.phase !== 'restarting') s.save(); }, 60e3);
setInterval(() => { for (const c of conns) { if (!c.alive) { try { c.ws.terminate(); } catch (e) {} continue; } c.alive = false; try { c.ws.ping(); } catch (e) {} } for (const s of shards.values()) if (s.players.size) s.broadcast({ t: 'counts', counts: counts(s) }); }, 15e3);
function shutdown(sig) { log(`${sig}: saving all worlds`); for (const s of shards.values()) { for (const c of s.players.values()) flushPlaytime(c); s.save(); } saveProfiles(); persistSchedule(); admin.flushAll(); process.exit(0); }
process.on('SIGTERM', () => shutdown('SIGTERM')); process.on('SIGINT', () => shutdown('SIGINT'));
server.listen(PORT, () => log(`ARVEX SURVIVAL server ${VERSION} (build ${BUILD.id}) on :${PORT} · ${shards.size} servers · data in ${DATA}`));
