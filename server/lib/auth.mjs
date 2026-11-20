// ARVEX admin authentication: scrypt password hashes, server-side sessions, CSRF tokens, brute-force limits, TOTP 2FA.
import crypto from 'crypto';
import { sha256, rid, HttpError, bad, clean } from './core.mjs';

const SCRYPT = { N: 16384, r: 8, p: 1, keylen: 32 };
export const SESSION_TTL = 12 * 3600e3;          // absolute lifetime
export const SESSION_IDLE = 2 * 3600e3;          // idle timeout
export const PASSWORD_MIN = 10;
const LOGIN_MAX = 5, LOGIN_WINDOW = 15 * 60e3;   // per IP+username and per IP

export function hashPassword(pw) {
  const salt = crypto.randomBytes(16);
  const h = crypto.scryptSync(String(pw), salt, SCRYPT.keylen, { N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p });
  return `scrypt$${SCRYPT.N}$${salt.toString('base64')}$${h.toString('base64')}`;
}
export function verifyPassword(pw, stored) {
  const m = /^scrypt\$(\d+)\$([^$]+)\$([^$]+)$/.exec(stored || ''); if (!m) return false;
  const want = Buffer.from(m[3], 'base64');
  const got = crypto.scryptSync(String(pw), Buffer.from(m[2], 'base64'), want.length, { N: +m[1], r: SCRYPT.r, p: SCRYPT.p });
  return crypto.timingSafeEqual(want, got);
}
export function checkPasswordPolicy(pw) {
  if (typeof pw !== 'string' || pw.length < PASSWORD_MIN) throw bad('weak_password', `Password must be at least ${PASSWORD_MIN} characters`);
  if (pw.length > 200) throw bad('weak_password', 'Password is too long');
  if (!/[a-zA-Z]/.test(pw) || !/[0-9]/.test(pw)) throw bad('weak_password', 'Password needs letters and numbers');
}
export const validUsername = u => typeof u === 'string' && /^[a-zA-Z0-9_.-]{3,24}$/.test(u);

// ------------------------------------------------------------------ TOTP (RFC 6238, SHA-1, 30 s, 6 digits)
const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
export function newTotpSecret() { const b = crypto.randomBytes(20); let bits = '', out = ''; for (const x of b) bits += x.toString(2).padStart(8, '0'); for (let i = 0; i < bits.length; i += 5) out += B32[parseInt(bits.slice(i, i + 5).padEnd(5, '0'), 2)]; return out; }
function b32decode(s) { let bits = ''; for (const ch of s.replace(/=+$/, '').toUpperCase()) { const v = B32.indexOf(ch); if (v < 0) continue; bits += v.toString(2).padStart(5, '0'); } const out = []; for (let i = 0; i + 8 <= bits.length; i += 8) out.push(parseInt(bits.slice(i, i + 8), 2)); return Buffer.from(out); }
export function totpCode(secret, t = Date.now()) {
  const counter = Buffer.alloc(8); counter.writeBigUInt64BE(BigInt(Math.floor(t / 30000)));
  const h = crypto.createHmac('sha1', b32decode(secret)).update(counter).digest(), o = h[h.length - 1] & 15;
  return String(((h[o] & 127) << 24 | h[o + 1] << 16 | h[o + 2] << 8 | h[o + 3]) % 1e6).padStart(6, '0');
}
export function verifyTotp(secret, code, t = Date.now()) {
  if (!/^\d{6}$/.test(String(code || ''))) return false;
  for (const d of [-1, 0, 1]) { const c = totpCode(secret, t + d * 30000); if (crypto.timingSafeEqual(Buffer.from(c), Buffer.from(String(code)))) return true; }
  return false;
}

// ------------------------------------------------------------------ sessions
/** Sessions live server-side; the browser only holds an opaque random id in an HttpOnly cookie plus a CSRF token. */
export class Sessions {
  constructor(col, limiter) { this.col = col; this.limiter = limiter; if (!this.col.data || typeof this.col.data !== 'object') this.col.data = {}; this.sweep(); setInterval(() => this.sweep(), 5 * 60e3).unref(); }
  create(user, ip, ua) {
    const token = rid(32), id = sha256(token), t = Date.now();
    this.col.data[id] = { id: id.slice(0, 12), user: user.username, csrf: rid(16), created: t, seen: t, expires: t + SESSION_TTL, ip, ua: clean(ua, 120) };
    this.col.save(); return { token, session: this.col.data[id] };
  }
  /** returns the session or throws 401 with a precise code (missing / invalid / expired) */
  resolve(token) {
    if (!token) throw new HttpError(401, 'no_session', 'Sign in to continue');
    const s = this.col.data[sha256(token)];
    if (!s) throw new HttpError(401, 'invalid_session', 'This session is not valid. Sign in again.');
    const t = Date.now();
    if (t > s.expires || t - s.seen > SESSION_IDLE) { delete this.col.data[sha256(token)]; this.col.save(); throw new HttpError(401, 'expired_session', 'Your session expired. Sign in again.'); }
    if (t - s.seen > 30e3) { s.seen = t; this.col.save(); }
    return s;
  }
  revoke(token) { const k = sha256(token || ''); if (this.col.data[k]) { delete this.col.data[k]; this.col.save(); return true; } return false; }
  revokeById(shortId, username) { let n = 0; for (const [k, s] of Object.entries(this.col.data)) if (s.id === shortId && (!username || s.user === username)) { delete this.col.data[k]; n++; } if (n) this.col.save(); return n; }
  revokeUser(username, exceptShortId) { let n = 0; for (const [k, s] of Object.entries(this.col.data)) if (s.user === username && s.id !== exceptShortId) { delete this.col.data[k]; n++; } if (n) this.col.save(); return n; }
  list(username) { return Object.values(this.col.data).filter(s => !username || s.user === username).map(s => ({ id: s.id, user: s.user, created: s.created, seen: s.seen, expires: s.expires, ip: s.ip, ua: s.ua })); }
  sweep() { const t = Date.now(); let n = 0; for (const [k, s] of Object.entries(this.col.data)) if (t > s.expires || t - s.seen > SESSION_IDLE) { delete this.col.data[k]; n++; } if (n) this.col.save(); }
  // brute-force protection: both the address and the address+account pair are limited
  loginBlocked(ip, username) { return this.limiter.peek('login-ip:' + ip, LOGIN_MAX * 4) || this.limiter.peek(`login:${ip}:${username}`, LOGIN_MAX); }
  loginFailed(ip, username) { this.limiter.hit('login-ip:' + ip, LOGIN_MAX * 4, LOGIN_WINDOW); this.limiter.hit(`login:${ip}:${username}`, LOGIN_MAX, LOGIN_WINDOW); }
  loginSucceeded(ip, username) { this.limiter.reset(`login:${ip}:${username}`); }
}
