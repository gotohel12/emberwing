// ARVEX backend core: structured logging, atomic JSON collections, request helpers, rate limiting.
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

// ------------------------------------------------------------------ logging (levels + in-memory ring for the admin panel)
const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 };
const MIN_LEVEL = LEVELS[(process.env.LOG_LEVEL || (process.env.NODE_ENV === 'production' ? 'info' : 'debug')).toLowerCase()] || LEVELS.info;
const RING_SIZE = 600;
const ring = [];
const SECRET_KEYS = /pass(word)?|secret|token|key|cookie|authorization|totp|code/i;

/** strip anything that looks like a secret before it reaches a log line */
export function redact(v, depth = 0) {
  if (v == null || typeof v !== 'object' || depth > 4) return v;
  if (Array.isArray(v)) return v.map(x => redact(x, depth + 1));
  const o = {};
  for (const k of Object.keys(v)) o[k] = SECRET_KEYS.test(k) ? '[redacted]' : redact(v[k], depth + 1);
  return o;
}
function emit(level, scope, msg, meta) {
  if (LEVELS[level] < MIN_LEVEL) return;
  const entry = { ts: new Date().toISOString(), level, scope, msg: String(msg), meta: meta ? redact(meta) : undefined };
  ring.push(entry); if (ring.length > RING_SIZE) ring.shift();
  const line = `${entry.ts} ${level.toUpperCase().padEnd(5)} [${scope}] ${entry.msg}${entry.meta ? ' ' + JSON.stringify(entry.meta) : ''}`;
  (level === 'error' ? console.error : console.log)(line);
}
export const logger = scope => ({
  debug: (m, meta) => emit('debug', scope, m, meta), info: (m, meta) => emit('info', scope, m, meta),
  warn: (m, meta) => emit('warn', scope, m, meta), error: (m, meta) => emit('error', scope, m, meta)
});
export const recentLogs = () => ring.slice();

// ------------------------------------------------------------------ persistence
/** one JSON file per collection, written atomically (tmp + rename) and debounced */
export class Store {
  constructor(dir) { this.dir = dir; fs.mkdirSync(dir, { recursive: true }); this.cols = new Map(); }
  col(name, def) {
    if (this.cols.has(name)) return this.cols.get(name);
    const file = path.join(this.dir, name + '.json'), store = this;
    let data = def, corrupt = false;
    try { data = JSON.parse(fs.readFileSync(file, 'utf8')); }
    catch (e) { if (e.code !== 'ENOENT') { corrupt = true; try { fs.renameSync(file, file + '.corrupt-' + Date.now()); } catch (_) {} } }
    const c = { name, data, corrupt, dirty: false, timer: null,
      save() { this.dirty = true; if (!this.timer) this.timer = setTimeout(() => this.flush(), 250); },
      flush() { clearTimeout(this.timer); this.timer = null; if (!this.dirty) return; this.dirty = false; const tmp = file + '.tmp'; fs.writeFileSync(tmp, JSON.stringify(this.data)); fs.renameSync(tmp, file); store.lastWrite = Date.now(); } };
    this.cols.set(name, c); return c;
  }
  flushAll() { for (const c of this.cols.values()) c.flush(); }
  /** real health probe: can we write and read back inside the data directory? */
  probe() {
    const f = path.join(this.dir, '.probe');
    try { const v = String(Date.now()); fs.writeFileSync(f, v); const ok = fs.readFileSync(f, 'utf8') === v; fs.unlinkSync(f); return { ok, lastWrite: this.lastWrite || null }; }
    catch (e) { return { ok: false, error: e.code || e.message }; }
  }
}

// ------------------------------------------------------------------ small utilities
export const sha256 = b => crypto.createHash('sha256').update(b).digest('hex');
export const rid = (n = 8) => crypto.randomBytes(n).toString('hex');
export const now = () => Date.now();
export const clean = (s, n) => String(s == null ? '' : s).replace(/[<>&"'`\u0000-\u001f]/g, '').trim().slice(0, n);
/** multi-line text (messages, notes): keeps newlines, strips control chars and markup brackets */
export const cleanText = (s, n) => String(s == null ? '' : s).replace(/[<>\u0000-\u0009\u000b-\u001f]/g, '').trim().slice(0, n);
export const clampNum = (v, a, b, d = 0) => { v = Number(v); return Number.isFinite(v) ? Math.max(a, Math.min(b, v)) : d; };
const SEMVER = /^(\d{1,4})\.(\d{1,4})(?:\.(\d{1,4}))?$/;
export const isVersion = v => typeof v === 'string' && SEMVER.test(v);
export function cmpVersion(a, b) {
  const pa = SEMVER.exec(a) || [], pb = SEMVER.exec(b) || [];
  for (let i = 1; i <= 3; i++) { const x = +(pa[i] || 0), y = +(pb[i] || 0); if (x !== y) return x < y ? -1 : 1; }
  return 0;
}

// ------------------------------------------------------------------ HTTP helpers
export class HttpError extends Error { constructor(status, code, message, extra) { super(message || code); this.status = status; this.code = code; this.extra = extra; } }
export const bad = (code, message) => new HttpError(400, code, message);
const SECURITY_HEADERS = { 'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer', 'cache-control': 'no-store' };
export function sendJSON(res, status, obj, headers) {
  res.writeHead(status, Object.assign({ 'content-type': 'application/json; charset=utf-8' }, SECURITY_HEADERS, headers));
  res.end(JSON.stringify(obj));
}
export function readBody(req, limit = 64 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = []; let size = 0, done = false;
    req.on('data', d => { if (done) return; size += d.length; if (size > limit) { done = true; reject(new HttpError(413, 'too_large', 'Request body is too large')); req.resume(); return; } chunks.push(d); });
    req.on('end', () => { if (!done) resolve(Buffer.concat(chunks)); });
    req.on('error', e => { if (!done) reject(e); });
  });
}
export async function readJSON(req, limit) {
  const b = await readBody(req, limit); if (!b.length) return {};
  let v; try { v = JSON.parse(b.toString('utf8')); } catch (e) { throw bad('bad_json', 'Body is not valid JSON'); }
  if (!v || typeof v !== 'object' || Array.isArray(v)) throw bad('bad_json', 'Body must be a JSON object');
  return v;
}
/** client address: the first X-Forwarded-For hop only when we run behind a trusted proxy (Render sets RENDER=true) */
const TRUST_PROXY = process.env.TRUST_PROXY ? process.env.TRUST_PROXY === '1' : !!process.env.RENDER;
export function clientIp(req) {
  const xf = TRUST_PROXY && req.headers['x-forwarded-for'];
  return (xf ? String(xf).split(',')[0].trim() : req.socket.remoteAddress || '').replace(/^::ffff:/, '');
}
export function parseCookies(req) {
  const out = {}; for (const part of String(req.headers.cookie || '').split(';')) { const i = part.indexOf('='); if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim()); }
  return out;
}

// ------------------------------------------------------------------ rate limiting (fixed window, in memory)
export class RateLimiter {
  constructor() { this.hits = new Map(); setInterval(() => this.sweep(), 60e3).unref(); }
  /** returns 0 when allowed, otherwise the number of seconds to wait */
  hit(key, max, windowMs) {
    const t = Date.now(); let h = this.hits.get(key);
    if (!h || t - h.start >= windowMs) { h = { start: t, n: 0, windowMs }; this.hits.set(key, h); }
    h.n++; return h.n > max ? Math.max(1, Math.ceil((h.start + windowMs - t) / 1000)) : 0;
  }
  peek(key, max) { const h = this.hits.get(key); return h && Date.now() - h.start < h.windowMs && h.n >= max ? Math.max(1, Math.ceil((h.start + h.windowMs - Date.now()) / 1000)) : 0; }
  reset(key) { this.hits.delete(key); }
  sweep() { const t = Date.now(); for (const [k, h] of this.hits) if (t - h.start >= h.windowMs) this.hits.delete(k); }
}

/** paginate + sort an array: page is 1-based, size is capped */
export function paginate(list, q, maxSize = 100) {
  const size = Math.round(clampNum(q.get('size'), 1, maxSize, 25)), page = Math.round(clampNum(q.get('page'), 1, 1e6, 1));
  const total = list.length, pages = Math.max(1, Math.ceil(total / size));
  return { items: list.slice((page - 1) * size, page * size), page, size, total, pages };
}
