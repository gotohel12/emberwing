// EMBERWING — online server (Mohsen ~ Danial)
// Serves the game (public/) and runs 2-player rooms over WebSocket: co-op and versus.
// The room creator's client is the authority for the shared world; this server manages rooms,
// matchmaking, validation and relaying. No accounts, no secrets.
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const { WebSocketServer } = require('ws');

const PORT = process.env.PORT || 8080;
const PUB = path.join(__dirname, '..', 'public');
const VERSION = require('../package.json').version;
const MAX_MSG = 16 * 1024;
const MODES = ['coop', 'pvp'];

/* ---------------- static files ---------------- */
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.webmanifest': 'application/manifest+json',
  '.png': 'image/png', '.ico': 'image/x-icon', '.svg': 'image/svg+xml', '.woff': 'font/woff', '.woff2': 'font/woff2', '.bin': 'application/octet-stream', '.txt': 'text/plain; charset=utf-8' };
function serveStatic(req, res) {
  let url = decodeURIComponent((req.url || '/').split('?')[0]);
  if (url === '/') url = '/index.html';
  const file = path.normalize(path.join(PUB, url));
  if (!file.startsWith(PUB)) { res.writeHead(403); return res.end(); }
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) { res.writeHead(404, { 'content-type': 'text/plain' }); return res.end('not found'); }
    const ext = path.extname(file).toLowerCase();
    const noCache = ext === '.html' || url === '/sw.js' || ext === '.webmanifest';
    res.writeHead(200, { 'content-type': TYPES[ext] || 'application/octet-stream', 'cache-control': noCache ? 'no-cache' : 'public, max-age=3600', 'x-content-type-options': 'nosniff' });
    fs.createReadStream(file).pipe(res);
  });
}
const server = http.createServer((req, res) => {
  if (req.url === '/health') { res.writeHead(200, { 'content-type': 'application/json' }); return res.end(JSON.stringify({ ok: true, version: VERSION, rooms: rooms.size, players: clients.size })); }
  if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405); return res.end(); }
  serveStatic(req, res);
});

/* ---------------- rooms ---------------- */
const rooms = new Map();      // code -> room
const clients = new Set();
let NEXT = 1;
const CODE_CH = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
function newCode() { for (;;) { let c = ''; for (let i = 0; i < 4; i++) c += CODE_CH[Math.floor(Math.random() * CODE_CH.length)]; if (!rooms.has(c)) return c; } }
const clean = (s, n) => String(s == null ? '' : s).replace(/[<>&"'`\u0000-\u001f]/g, '').trim().slice(0, n);
const int = (v, a, b, d) => { v = Math.floor(Number(v)); return Number.isFinite(v) ? Math.max(a, Math.min(b, v)) : d; };
function send(c, m) { if (c && c.ws.readyState === 1) c.ws.send(typeof m === 'string' ? m : JSON.stringify(m)); }
function roomInfo(r) { return { t: 'room', code: r.code, mode: r.mode, world: r.world, diff: r.diff, open: r.open, host: r.players[0] && r.players[0].id, players: r.players.map(p => ({ id: p.id, name: p.name, skin: p.skin, ready: p.ready })), playing: r.playing }; }
function broadcast(r, m) { const s = JSON.stringify(m); for (const p of r.players) send(p, s); }
function leave(c, why) {
  const r = c.room; if (!r) return; c.room = null; c.ready = false;
  r.players = r.players.filter(p => p !== c);
  if (!r.players.length) { rooms.delete(r.code); return; }
  broadcast(r, { t: 'left', id: c.id, why: why || 'left' });
  if (r.playing) { r.playing = false; broadcast(r, { t: 'abort', why: 'peer_left' }); }
  for (const p of r.players) p.ready = false;
  broadcast(r, roomInfo(r));
}
function join(c, r) {
  if (c.room) leave(c);
  if (r.players.length >= 2 || r.playing) return send(c, { t: 'error', code: 'full', msg: 'الغرفة مليانة أو اللعب بدأ' });
  r.players.push(c); c.room = r; c.ready = false;
  broadcast(r, roomInfo(r));
}

/* ---------------- websocket ---------------- */
const wss = new WebSocketServer({ server, maxPayload: MAX_MSG, perMessageDeflate: false });
wss.on('connection', (ws, req) => {
  const c = { id: NEXT++, ws, name: 'لاعب', skin: 'ember', room: null, ready: false, alive: true, bucket: 60, last: Date.now() };
  clients.add(c);
  send(c, { t: 'welcome', id: c.id, version: VERSION });
  ws.on('pong', () => { c.alive = true; });
  ws.on('message', (data, isBinary) => {
    if (isBinary) return;
    // simple token-bucket rate limit (~60 msgs/s sustained)
    const now = Date.now(); c.bucket = Math.min(120, c.bucket + (now - c.last) * 0.06); c.last = now;
    if (c.bucket < 1) return; c.bucket -= 1;
    let m; try { m = JSON.parse(data.toString()); } catch (e) { return; }
    if (!m || typeof m.t !== 'string') return;
    const r = c.room;
    switch (m.t) {
      case 'hello': c.name = clean(m.name, 16) || 'لاعب'; c.skin = clean(m.skin, 12) || 'ember'; if (r) broadcast(r, roomInfo(r)); break;
      case 'create': {
        if (c.room) leave(c);
        const mode = MODES.includes(m.mode) ? m.mode : 'coop';
        const room = { code: newCode(), mode, world: int(m.world, 0, 4, 0), diff: ['story', 'normal', 'hard'].includes(m.diff) ? m.diff : 'normal', open: !!m.open, players: [], playing: false, created: Date.now() };
        rooms.set(room.code, room); join(c, room); break;
      }
      case 'join': {
        const code = clean(m.code, 4).toUpperCase(), room = rooms.get(code);
        if (!room) return send(c, { t: 'error', code: 'nocode', msg: 'ما فيه غرفة بهالكود' });
        join(c, room); break;
      }
      case 'quick': {
        const mode = MODES.includes(m.mode) ? m.mode : 'coop';
        let room = null;
        for (const x of rooms.values()) if (x.open && x.mode === mode && !x.playing && x.players.length === 1 && x.players[0] !== c) { room = x; break; }
        if (room) join(c, room);
        else { if (c.room) leave(c); const nr = { code: newCode(), mode, world: int(m.world, 0, 4, 0), diff: 'normal', open: true, players: [], playing: false, created: Date.now() }; rooms.set(nr.code, nr); join(c, nr); }
        break;
      }
      case 'leave': leave(c); send(c, { t: 'lobby' }); break;
      case 'config': if (r && r.players[0] === c && !r.playing) { if (m.world != null) r.world = int(m.world, 0, 4, r.world); if (MODES.includes(m.mode)) r.mode = m.mode; if (['story', 'normal', 'hard'].includes(m.diff)) r.diff = m.diff; for (const p of r.players) p.ready = false; broadcast(r, roomInfo(r)); } break;
      case 'ready': if (r && !r.playing) { c.ready = !!m.v; broadcast(r, roomInfo(r)); } break;
      case 'start':
        if (r && r.players[0] === c && !r.playing && r.players.length === 2 && r.players[1].ready) {
          r.playing = true; r.seed = Math.floor(Math.random() * 1e9);
          broadcast(r, { t: 'start', mode: r.mode, world: r.world, diff: r.diff, seed: r.seed, host: c.id, players: r.players.map(p => ({ id: p.id, name: p.name, skin: p.skin })) });
          broadcast(r, roomInfo(r));
        } break;
      case 'end': if (r && r.players[0] === c && r.playing) { r.playing = false; for (const p of r.players) p.ready = false; broadcast(r, roomInfo(r)); } break;
      // in-game relays: state (unreliable-ish, latest wins), events, host snapshots
      case 'st': case 'ev': case 'snap':
        if (r && r.playing) { if (m.t === 'snap' && r.players[0] !== c) return; m.f = c.id; const s = JSON.stringify(m); for (const p of r.players) if (p !== c) send(p, s); }
        break;
      case 'ping': send(c, { t: 'pong', k: m.k }); break;
    }
  });
  ws.on('close', () => { leave(c, 'disconnect'); clients.delete(c); });
  ws.on('error', () => {});
});
// heartbeat + stale room cleanup
setInterval(() => {
  for (const c of clients) { if (!c.alive) { try { c.ws.terminate(); } catch (e) {} continue; } c.alive = false; try { c.ws.ping(); } catch (e) {} }
  const now = Date.now();
  for (const [k, r] of rooms) if (!r.players.length || (now - r.created > 6 * 3600e3)) rooms.delete(k);
}, 15000);

server.listen(PORT, () => console.log(`EMBERWING server v${VERSION} on :${PORT}`));
module.exports = { server };
