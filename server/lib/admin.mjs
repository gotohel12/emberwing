// ARVEX admin + live-ops backend. Everything the admin panel and the launcher need beyond the game simulation:
// staff auth, RBAC, audit, moderation, reports, tickets, announcements, changelog, releases, remote config, health, telemetry.
// Request pipeline for every admin route:  authenticate → authorize (permission) → validate → execute → audit.
import fs from 'fs';
import os from 'os';
import path from 'path';
import crypto from 'crypto';
import { Store, RateLimiter, HttpError, bad, sendJSON, readJSON, readBody, clientIp, parseCookies, paginate, logger, recentLogs, clean, cleanText, clampNum, isVersion, cmpVersion, sha256, rid } from './core.mjs';
import { Sessions, hashPassword, verifyPassword, checkPasswordPolicy, validUsername, newTotpSecret, verifyTotp, SESSION_TTL } from './auth.mjs';
import { can, permissionsOf, matrix, outranks, isRole, ROLES } from './rbac.mjs';
import { AuditLog } from './audit.mjs';
import { Releases, CHANNELS } from './releases.mjs';

const log = logger('admin');
const API = '/api/admin/v1', COOKIE = 'arvex_admin';
const DAY = 86400e3;
const REPORT_STATUS = ['open', 'investigating', 'resolved', 'rejected', 'escalated'], TICKET_STATUS = ['open', 'pending', 'closed', 'archived'];
const PRIORITIES = ['low', 'medium', 'high', 'critical'], SEVERITIES = ['info', 'low', 'medium', 'high', 'critical'];
const TICKET_CATEGORIES = ['launcher', 'update', 'game', 'account', 'server', 'other'], REPORT_CATEGORIES = ['cheating', 'abuse', 'griefing', 'spam', 'name', 'other'];
const ANNOUNCE_TAGS = ['update', 'news', 'event', 'maintenance'];
const KNOWN_FLAGS = { weather: 'Dynamic weather (rain, storms, fog)', pvpDamage: 'Player-vs-player damage on PvP shards', newHud: 'v10 HUD with ammo, stamina and dynamic crosshair', reports: 'In-game /report command', tickets: 'Support tickets from the launcher', betaChannel: 'Offer the Beta channel in the launcher' };
const DEFAULT_CONFIG = { maintenance: { on: false, message: ['', ''], until: null, blockLaunch: false }, minVersion: null, forceUpdate: { on: false, reason: ['', ''] }, flags: { weather: true, pvpDamage: true, newHud: true, reports: true, tickets: true, betaChannel: false }, download: { concurrent: 3 }, rollbackThreshold: 25 };

export function createAdmin({ dataDir, pubDir, serverDir, build, game }) {
  const store = new Store(path.join(dataDir, 'admin')), limiter = new RateLimiter();
  const staff = store.col('staff', {}), sessions = new Sessions(store.col('sessions', {}), limiter), audit = new AuditLog(path.join(dataDir, 'admin'));
  const mod = store.col('moderation', { bans: [], warnings: [], mutes: {}, history: [] });
  const reports = store.col('reports', { seq: 0, items: [] }), tickets = store.col('tickets', { seq: 0, items: [] });
  const content = store.col('content', { announcements: [], changelog: [] }), telemetry = store.col('telemetry', { errors: [], updates: [] });
  const cfgCol = store.col('config', JSON.parse(JSON.stringify(DEFAULT_CONFIG)));
  const cfg = cfgCol.data; for (const k of Object.keys(DEFAULT_CONFIG)) if (cfg[k] == null) cfg[k] = JSON.parse(JSON.stringify(DEFAULT_CONFIG[k])); for (const f of Object.keys(DEFAULT_CONFIG.flags)) if (cfg.flags[f] == null) cfg.flags[f] = DEFAULT_CONFIG.flags[f];
  const backups = store.col('backups', { items: [] });
  const ipSalt = (() => { const c = store.col('salt', { v: rid(16) }); c.save(); return c.data.v; })();
  const ipHash = ip => sha256(ipSalt + ip).slice(0, 24);

  // ---------------------------------------------------------------- seed managed content from the files shipped in the repository
  const readRepo = f => { try { return JSON.parse(fs.readFileSync(path.join(serverDir, f), 'utf8')); } catch (e) { return {}; } };
  const repoVersions = readRepo('versions.json');
  for (const v of repoVersions.versions || []) if (!content.data.changelog.some(c => c.version === v.version)) content.data.changelog.push({ version: v.version, buildId: v.buildId || null, date: v.date, type: v.type || 'minor', required: !!v.required, summary: v.summary || '', features: v.features || [], improvements: v.improvements || v.notes || [], fixes: v.fixes || [], performance: v.performance || [], knownIssues: v.knownIssues || [], status: 'published', source: 'repo' });
  for (const n of readRepo('news.json').news || []) if (!content.data.announcements.some(a => a.id === n.id)) content.data.announcements.push(Object.assign({ priority: 1, status: 'published', publishAt: null, expiresAt: null, source: 'repo', createdBy: 'repo' }, n));
  content.data.changelog.sort((a, b) => cmpVersion(b.version, a.version)); content.save();
  const publicNotes = v => { const c = content.data.changelog.find(x => x.version === v && x.status === 'published'); return c ? { version: c.version, date: c.date, summary: c.summary, features: c.features, improvements: c.improvements, fixes: c.fixes, performance: c.performance, knownIssues: c.knownIssues } : null; };
  const releases = new Releases({ dataDir, pubDir, build, col: store.col('releases', {}), log: logger('release'), notesFor: publicNotes, signKey: process.env.ARVEX_SIGN_KEY || '' });

  // ---------------------------------------------------------------- helpers
  const ownerKeyOk = k => typeof k === 'string' && k.length > 6 && game.isOwnerKey(k);
  const staffView = s => ({ username: s.username, role: s.role, disabled: !!s.disabled, created: s.created, lastLogin: s.lastLogin || null, twoFactor: !!(s.totp && s.totp.enabled), sessions: sessions.list(s.username).length });
  const record = (ctx, action, target, extra = {}) => audit.write(Object.assign({ actor: ctx.user ? ctx.user.username : 'anonymous', role: ctx.user ? ctx.user.role : '-', action, target, ip: ipHash(ctx.ip), sid: ctx.session ? ctx.session.id : '' }, extra));
  const need = (v, msg) => { if (!v) throw bad('invalid', msg); return v; };
  const needReason = b => { const r = cleanText(b.reason, 300); if (r.length < 3) throw bad('reason_required', 'A reason is required for this action'); return r; };
  const needConfirm = b => { if (b.confirm !== true) throw bad('confirm_required', 'This action needs explicit confirmation'); };
  const pair = (v, n) => Array.isArray(v) ? [cleanText(v[0], n), cleanText(v[1], n)] : [cleanText(v, n), cleanText(v, n)];
  const lines = (v, max = 40) => (Array.isArray(v) ? v : String(v || '').split('\n')).map(x => cleanText(x, 300)).filter(Boolean).slice(0, max);
  const isoOrNull = v => { if (v == null || v === '') return null; const t = typeof v === 'number' ? v : Date.parse(v); if (!Number.isFinite(t)) throw bad('bad_date', 'Date is not valid'); return t; };
  const activeBan = (th, ipH) => mod.data.bans.find(b => !b.lifted && (!b.until || b.until > Date.now()) && (b.th === th || (ipH && b.ipHash && b.ipHash === ipH)));
  const eventLoop = { lag: 0 }; { let last = Date.now(); setInterval(() => { const t = Date.now(); eventLoop.lag = Math.max(0, t - last - 1000); last = t; }, 1000).unref(); }

  // ---------------------------------------------------------------- public (unauthenticated) surface
  const liveAnnouncements = () => { const t = Date.now(); return content.data.announcements.filter(a => (a.status === 'published' || (a.status === 'scheduled' && a.publishAt && a.publishAt <= t)) && (!a.expiresAt || a.expiresAt > t)).sort((a, b) => (b.priority || 0) - (a.priority || 0) || String(b.date).localeCompare(String(a.date))); };
  const publicConfig = () => ({ version: build.version, buildId: build.id, maintenance: cfg.maintenance.on ? { on: true, message: cfg.maintenance.message, until: cfg.maintenance.until, blockLaunch: !!cfg.maintenance.blockLaunch } : { on: false }, minVersion: effectiveMinVersion(), forceUpdate: cfg.forceUpdate.on ? { on: true, reason: cfg.forceUpdate.reason } : { on: false },
    flags: Object.assign({}, cfg.flags), channels: CHANNELS.filter(c => c === 'stable' || (c === 'beta' && cfg.flags.betaChannel)), download: { concurrent: cfg.download.concurrent }, checkIntervalSec: 180, signing: { enabled: releases.signing.enabled, keyId: releases.signing.keyId } });
  function effectiveMinVersion() { const a = releases.active('stable'), f = [cfg.minVersion, a && a.minVersion, game.protocolMin].filter(isVersion).sort(cmpVersion); return f.length ? f[f.length - 1] : '0.0.0'; }
  // the launcher executable shipped with this deployment: hashed (and signed when a key is configured) so launchers can verify a self-update
  const launcherInfo = (() => { const L = repoVersions.launcher; if (!L || !L.url) return null; try { const b = fs.readFileSync(path.join(pubDir, L.url.replace(/^\//, ''))), h = sha256(b), o = { version: L.version, url: L.url, size: b.length, sha256: h }; if (releases.key) o.sig = crypto.sign(null, Buffer.from(`ARVEX-LAUNCHER-1\n${L.version}\n${h}`), releases.key).toString('base64'); return o; } catch (e) { log.warn('launcher binary is missing from public' + L.url); return null; } })();
  const versionsPayload = () => { const a = releases.active('stable'); return { current: a ? a.version : build.version, build: a ? a.id : build.id, minVersion: effectiveMinVersion(), required: !!(cfg.forceUpdate.on || (a && a.mandatory)), launcher: launcherInfo,
    versions: content.data.changelog.filter(c => c.status === 'published').map(c => ({ version: c.version, buildId: c.buildId, date: c.date, type: c.type, required: !!c.required, summary: c.summary, features: c.features, improvements: c.improvements, fixes: c.fixes, performance: c.performance, knownIssues: c.knownIssues, notes: [].concat(c.features || [], c.improvements || [], c.fixes || [], c.performance || []) })) }; };
  function addTelemetry(kind, b, ip) {
    const e = { id: 'E-' + rid(4), at: Date.now(), kind, severity: SEVERITIES.includes(b.severity) ? b.severity : 'medium', code: clean(b.code, 24), message: cleanText(b.message, 400), version: clean(b.version, 16), build: clean(b.build, 40), platform: clean(b.platform, 24), launcher: clean(b.launcher, 16), src: ipHash(ip) };
    if (kind === 'update') { telemetry.data.updates.push({ at: e.at, ok: !!b.ok, op: clean(b.op, 12), from: clean(b.from, 16), to: clean(b.to, 16), code: e.code, src: e.src }); if (telemetry.data.updates.length > 1000) telemetry.data.updates.splice(0, telemetry.data.updates.length - 1000); if (b.ok) { telemetry.save(); return null; } }
    telemetry.data.errors.push(e); if (telemetry.data.errors.length > 500) telemetry.data.errors.splice(0, telemetry.data.errors.length - 500); telemetry.save(); return e;
  }
  const errorsLastHour = v => telemetry.data.errors.filter(e => e.at > Date.now() - 3600e3 && (!v || e.version === v)).length;

  async function handlePublic(req, res, u, p, cors) {
    const ip = clientIp(req), J = (code, obj, h) => { sendJSON(res, code, obj, Object.assign({}, cors, h)); return true; };
    const limit = (name, max, win) => { const w = limiter.hit(`${name}:${ip}`, max, win); if (w) throw new HttpError(429, 'rate_limited', 'Too many requests. Try again shortly.', { retryAfter: w }); };
    try {
      if (p === '/api/config') return J(200, publicConfig(), { 'cache-control': 'public, max-age=20' });
      if (p === '/api/news') return J(200, { news: liveAnnouncements().map(a => ({ id: a.id, tag: a.tag, date: a.date, priority: a.priority || 0, title: a.title, short: a.short, body: a.body, image: a.image || null, expiresAt: a.expiresAt || null })) });
      if (p === '/api/versions') return J(200, versionsPayload());
      if (p === '/api/changelog') return J(200, { changelog: versionsPayload().versions });
      if (p === '/api/telemetry' && req.method === 'POST') { limit('telemetry', 20, 60e3); const b = await readJSON(req, 4096); if (!['launcher', 'game', 'crash', 'update'].includes(b.kind)) throw bad('bad_kind', 'Unknown telemetry kind'); const e = addTelemetry(b.kind, b, ip); return J(202, { ok: true, id: e ? e.id : null }); }
      if (p === '/api/tickets' && req.method === 'POST') {
        if (!cfg.flags.tickets) throw new HttpError(503, 'tickets_off', 'Support tickets are turned off right now. Use discord.gg/arvex.');
        limit('ticket', 4, 10 * 60e3); const b = await readJSON(req, 16384), subject = cleanText(b.subject, 120), message = cleanText(b.message, 4000);
        if (subject.length < 4 || message.length < 10) throw bad('too_short', 'Write a subject and a few words about the problem');
        const key = rid(16), t = { id: 'T-' + String(++tickets.data.seq).padStart(6, '0'), keyHash: sha256(key), subject, category: TICKET_CATEGORIES.includes(b.category) ? b.category : 'other', priority: 'medium', status: 'open', contact: clean(b.contact, 80), createdAt: Date.now(), updatedAt: Date.now(), assignee: null,
          diag: { launcher: clean(b.launcher, 16), version: clean(b.version, 16), build: clean(b.build, 40), os: clean(b.os, 24), code: clean(b.code, 24) }, src: ipHash(ip), messages: [{ from: 'user', author: clean(b.name, 24) || 'Player', text: message, at: Date.now() }] };
        tickets.data.items.push(t); tickets.save(); return J(201, { id: t.id, key });
      }
      const tm = /^\/api\/tickets\/(T-\d{6})(\/reply)?$/.exec(p);
      if (tm) {
        limit('ticket-read', 60, 60e3); const t = tickets.data.items.find(x => x.id === tm[1]), key = u.searchParams.get('key') || req.headers['x-ticket-key'];
        if (!t || !key || sha256(String(key)) !== t.keyHash) throw new HttpError(404, 'no_ticket', 'Ticket not found');
        if (tm[2] && req.method === 'POST') { limit('ticket', 8, 10 * 60e3); if (t.status === 'archived') throw new HttpError(409, 'archived', 'This ticket is archived'); const b = await readJSON(req, 16384), text = cleanText(b.message, 4000); if (text.length < 2) throw bad('too_short', 'Message is empty'); t.messages.push({ from: 'user', author: 'Player', text, at: Date.now() }); t.updatedAt = Date.now(); if (t.status !== 'open') t.status = 'open'; tickets.save(); }
        return J(200, { id: t.id, subject: t.subject, category: t.category, status: t.status, createdAt: t.createdAt, updatedAt: t.updatedAt, messages: t.messages.filter(m => !m.internal).map(m => ({ from: m.from, author: m.from === 'staff' ? 'ARVEX Support' : m.author, text: m.text, at: m.at })) });
      }
    } catch (e) { return fail(res, e, cors); }
    return false;
  }
  function fail(res, e, extraHeaders) {
    if (e instanceof HttpError) { sendJSON(res, e.status, Object.assign({ error: e.code, message: e.message }, e.extra), Object.assign({}, extraHeaders, e.extra && e.extra.retryAfter ? { 'retry-after': String(e.extra.retryAfter) } : null)); return true; }
    const id = 'E-' + rid(4); log.error(`unhandled ${id}: ${e.stack || e.message}`); telemetry.data.errors.push({ id, at: Date.now(), kind: 'backend', severity: 'high', code: 'ARVEX-B500', message: String(e.message).slice(0, 300), version: build.version, build: build.id, platform: 'server' }); telemetry.save();
    sendJSON(res, 500, { error: 'internal', message: 'Something went wrong on the server. Quote this id to support: ' + id, id }, extraHeaders); return true;
  }

  // ---------------------------------------------------------------- admin routes
  const routes = [];
  const R = (method, pattern, perm, fn) => routes.push({ method, re: new RegExp('^' + pattern.replace(/:(\w+)/g, '(?<$1>[^/]+)') + '$'), perm, fn });
  const setCookie = (req, res, token, maxAge) => res.setHeader('set-cookie', `${COOKIE}=${token}; Path=/api/admin; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${(req.headers['x-forwarded-proto'] === 'https' || process.env.RENDER) ? '; Secure' : ''}`);
  const getStaff = name => { const s = staff.data[String(name).toLowerCase()]; if (!s) throw new HttpError(404, 'no_staff', 'Staff account not found'); return s; };
  const owners = () => Object.values(staff.data).filter(s => s.role === 'OWNER' && !s.disabled);

  // ---- bootstrap + authentication (no session yet)
  R('GET', '/bootstrap', null, async c => ({ needsSetup: !Object.keys(staff.data).length, version: build.version, buildId: build.id }));
  R('POST', '/setup', null, async c => {
    if (Object.keys(staff.data).length) throw new HttpError(409, 'already_setup', 'The owner account already exists');
    const w = limiter.hit('setup:' + c.ip, 5, 15 * 60e3); if (w) throw new HttpError(429, 'rate_limited', 'Too many attempts', { retryAfter: w });
    const b = await c.json(); if (!ownerKeyOk(b.ownerKey)) { record(c, 'auth.setup', b.username || '', { result: 'denied', reason: 'bad owner key' }); throw new HttpError(403, 'bad_owner_key', 'The owner key is not correct'); }
    if (!validUsername(b.username)) throw bad('bad_username', 'Username: 3-24 letters, digits, dot, dash or underscore'); checkPasswordPolicy(b.password);
    staff.data[b.username.toLowerCase()] = { username: b.username, role: 'OWNER', pass: hashPassword(b.password), created: Date.now() }; staff.save();
    record(c, 'auth.setup', b.username, { actor: b.username, role: 'OWNER' }); return { ok: true };
  });
  R('POST', '/login', null, async c => {
    const b = await c.json(), name = String(b.username || '').toLowerCase().slice(0, 40), wait = sessions.loginBlocked(c.ip, name);
    if (wait) throw new HttpError(429, 'locked', `Too many failed sign-ins. Try again in ${Math.ceil(wait / 60)} min.`, { retryAfter: wait });
    const s = staff.data[name], okPw = s && !s.disabled && verifyPassword(String(b.password || ''), s.pass);
    if (!okPw) { if (!s) verifyPassword('x', 'scrypt$16384$AAAAAAAAAAAAAAAAAAAAAA==$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA='); sessions.loginFailed(c.ip, name); record(c, 'auth.login', name, { actor: name || 'anonymous', result: 'denied', reason: s && s.disabled ? 'account disabled' : 'bad credentials' }); throw new HttpError(401, 'bad_credentials', 'Username or password is not correct'); }
    if (s.totp && s.totp.enabled) { if (!b.code) throw new HttpError(401, 'totp_required', 'Enter the 6-digit code from your authenticator app'); if (!verifyTotp(s.totp.secret, b.code)) { sessions.loginFailed(c.ip, name); record(c, 'auth.login', name, { actor: name, result: 'denied', reason: 'bad 2FA code' }); throw new HttpError(401, 'bad_totp', 'The 2FA code is not correct'); } }
    sessions.loginSucceeded(c.ip, name); const { token, session } = sessions.create(s, ipHash(c.ip), c.req.headers['user-agent']); s.lastLogin = Date.now(); staff.save();
    setCookie(c.req, c.res, token, Math.floor(SESSION_TTL / 1000)); audit.write({ actor: s.username, role: s.role, action: 'auth.login', target: s.username, ip: ipHash(c.ip), sid: session.id });
    return { user: staffView(s), permissions: permissionsOf(s.role), csrf: session.csrf, expires: session.expires };
  });

  // ---- session
  R('POST', '/logout', 'any', async c => { sessions.revoke(c.token); setCookie(c.req, c.res, '', 0); record(c, 'auth.logout', c.user.username); return { ok: true }; });
  R('GET', '/me', 'any', async c => ({ user: staffView(c.user), permissions: permissionsOf(c.user.role), csrf: c.session.csrf, expires: c.session.expires, roles: ROLES, version: build.version, buildId: build.id }));
  R('POST', '/me/password', 'any', async c => { const b = await c.json(); if (!verifyPassword(String(b.current || ''), c.user.pass)) throw new HttpError(403, 'bad_password', 'Current password is not correct'); checkPasswordPolicy(b.next); c.user.pass = hashPassword(b.next); staff.save(); const n = sessions.revokeUser(c.user.username, c.session.id); record(c, 'auth.password', c.user.username, { meta: { otherSessionsRevoked: n } }); return { ok: true, revoked: n }; });
  R('GET', '/me/sessions', 'any', async c => ({ sessions: sessions.list(c.user.username).map(s => Object.assign(s, { current: s.id === c.session.id })) }));
  R('DELETE', '/me/sessions/:id', 'any', async c => { const n = sessions.revokeById(c.params.id, c.user.username); record(c, 'auth.session.revoke', c.params.id); return { revoked: n }; });
  R('POST', '/me/2fa/setup', 'any', async c => { if (c.user.totp && c.user.totp.enabled) throw new HttpError(409, 'already_on', '2FA is already on'); const secret = newTotpSecret(); c.user.totp = { secret, enabled: false }; staff.save(); return { secret, otpauth: `otpauth://totp/ARVEX:${encodeURIComponent(c.user.username)}?secret=${secret}&issuer=ARVEX` }; });
  R('POST', '/me/2fa/enable', 'any', async c => { const b = await c.json(); if (!c.user.totp || !verifyTotp(c.user.totp.secret, b.code)) throw bad('bad_totp', 'The code is not correct'); c.user.totp.enabled = true; staff.save(); record(c, 'auth.2fa.enable', c.user.username); return { ok: true }; });
  R('POST', '/me/2fa/disable', 'any', async c => { const b = await c.json(); if (!verifyPassword(String(b.password || ''), c.user.pass)) throw new HttpError(403, 'bad_password', 'Password is not correct'); delete c.user.totp; staff.save(); record(c, 'auth.2fa.disable', c.user.username); return { ok: true }; });

  // ---- dashboard, health, search
  function health() {
    const db = store.probe(), shards = game.shardInfo(), manifest = releases.manifestFor('stable', { minVersion: effectiveMinVersion(), forceUpdate: cfg.forceUpdate.on });
    let disk = null; try { const s = fs.statfsSync(dataDir); disk = { free: s.bavail * s.bsize, total: s.blocks * s.bsize }; } catch (e) {}
    const cdnMissing = manifest ? manifest.files.filter(f => !releases.filePath(manifest.buildId, f.path) || !fs.existsSync(releases.filePath(manifest.buildId, f.path))).length : 0;
    const mem = process.memoryUsage();
    return { api: { ok: eventLoop.lag < 500, lagMs: eventLoop.lag, uptimeSec: Math.round(process.uptime()) }, auth: { ok: true, staff: Object.keys(staff.data).length, sessions: sessions.list().length }, database: { ok: db.ok, kind: 'json-files', lastWrite: db.lastWrite, error: db.error || null },
      storage: disk ? { ok: disk.free > 200 * 1048576, free: disk.free, total: disk.total, releases: releases.usage() } : { ok: true, free: null }, cdn: { ok: !!manifest && cdnMissing === 0, origin: 'self', files: manifest ? manifest.files.length : 0, missing: cdnMissing },
      launcher: { ok: !!manifest, manifestVersion: manifest ? manifest.version : null, signed: !!(manifest && manifest.signature), launcherVersion: launcherInfo ? launcherInfo.version : null }, game: { ok: shards.every(s => !['unavailable'].includes(s.status)), shards: shards.map(s => ({ id: s.id, status: s.status, players: s.players, max: s.max })) },
      process: { rss: mem.rss, heapUsed: mem.heapUsed, node: process.version, load: os.loadavg()[0] } };
  }
  function alerts() {
    const out = [], h = health(), open = reports.data.items.filter(r => r.status === 'open').length, act = releases.active('stable'), eh = errorsLastHour(act && act.version);
    for (const s of h.game.shards) if (s.status === 'unavailable') out.push({ severity: 'critical', kind: 'server_down', text: `Server ${s.id} is not responding` });
    if (!h.database.ok) out.push({ severity: 'critical', kind: 'database', text: 'Data directory is not writable' });
    if (!h.cdn.ok) out.push({ severity: 'high', kind: 'release_failed', text: `${h.cdn.missing} release file(s) are missing on disk` });
    if (eh >= cfg.rollbackThreshold) out.push({ severity: 'high', kind: 'error_spike', text: `${eh} errors in the last hour on ${act ? act.version : 'the active release'} — consider a rollback` });
    const failedUpd = telemetry.data.updates.filter(x => x.at > Date.now() - 3600e3 && !x.ok).length; if (failedUpd >= 5) out.push({ severity: 'medium', kind: 'update_failed', text: `${failedUpd} failed updates in the last hour` });
    if (open) out.push({ severity: open > 10 ? 'medium' : 'low', kind: 'new_report', text: `${open} open report(s)` });
    if (!h.launcher.signed) out.push({ severity: 'low', kind: 'unsigned', text: 'Update manifests are not signed (set ARVEX_SIGN_KEY)' });
    if (cfg.maintenance.on) out.push({ severity: 'info', kind: 'maintenance', text: 'Maintenance mode is on' });
    return out.sort((a, b) => SEVERITIES.indexOf(b.severity) - SEVERITIES.indexOf(a.severity));
  }
  function dashboard() {
    const act = releases.active('stable'), upd = telemetry.data.updates.filter(x => x.at > Date.now() - DAY), h = health();
    return { version: build.version, buildId: build.id, builtAt: build.date, activeRelease: act ? releases.view(act) : null, latestVersion: act ? act.version : build.version, minVersion: effectiveMinVersion(), playersOnline: game.totalPlayers(), servers: game.shardInfo(), health: h, alerts: alerts(),
      updates: { ok24h: upd.filter(x => x.ok).length, failed24h: upd.filter(x => !x.ok).length }, errors: { lastHour: errorsLastHour(), last24h: telemetry.data.errors.filter(e => e.at > Date.now() - DAY).length, recent: telemetry.data.errors.slice(-6).reverse() },
      reports: { open: reports.data.items.filter(r => r.status === 'open').length, recent: reports.data.items.slice(-5).reverse().map(reportView) }, tickets: { open: tickets.data.items.filter(t => t.status === 'open').length }, maintenance: cfg.maintenance, forceUpdate: cfg.forceUpdate, recentActions: audit.query({}).slice(0, 8), time: Date.now() };
  }
  R('GET', '/dashboard', 'view_dashboard', async c => dashboard());
  R('GET', '/health', 'view_dashboard', async c => health());
  R('GET', '/roles', 'view_dashboard', async c => ({ roles: ROLES, matrix: matrix() }));
  R('GET', '/search', 'view_dashboard', async c => {
    const q = clean(c.q.get('q'), 60).toLowerCase(), out = { players: [], reports: [], tickets: [], releases: [], logs: [] }; if (q.length < 2) return out; const role = c.user.role;
    if (can(role, 'view_users')) out.players = playerList().filter(p => p.name.toLowerCase().includes(q) || p.id.startsWith(q)).slice(0, 8);
    if (can(role, 'manage_reports')) out.reports = reports.data.items.filter(r => `${r.id} ${r.target.name} ${r.reporter.name} ${r.text}`.toLowerCase().includes(q)).slice(-8).reverse().map(reportView);
    if (can(role, 'manage_tickets')) out.tickets = tickets.data.items.filter(t => `${t.id} ${t.subject} ${t.contact}`.toLowerCase().includes(q)).slice(-8).reverse().map(ticketView);
    if (can(role, 'manage_releases')) out.releases = releases.list().filter(r => `${r.id} ${r.version} ${r.channel} ${r.status}`.toLowerCase().includes(q)).slice(0, 8);
    if (can(role, 'view_logs')) out.logs = audit.query({ q }).slice(0, 8);
    return out;
  });

  // ---- players + moderation
  function playerList() { const on = game.onlineMap(); return Object.entries(game.profiles()).map(([th, p]) => { const ban = activeBan(th), o = on.get(th); return { id: th, name: p.name || 'Survivor', status: ban ? 'banned' : o ? 'online' : 'offline', server: o ? o.server : null, playtime: Math.round(p.total || 0), sessions: p.sessions || 0, first: p.first, last: p.last, warnings: mod.data.warnings.filter(w => w.th === th).length, muted: !!(mod.data.mutes[th] && mod.data.mutes[th].until > Date.now()), ban: ban ? { reason: ban.reason, until: ban.until, by: ban.by } : null }; }); }
  const needPlayer = th => { const p = game.profiles()[th]; if (!p) throw new HttpError(404, 'no_player', 'Player not found'); return p; };
  function modAction(c, th, type, reason, extra = {}) { const p = needPlayer(th), e = Object.assign({ id: 'M-' + rid(4), type, th, name: p.name, reason, by: c.user.username, at: Date.now() }, extra); mod.data.history.push(e); if (mod.data.history.length > 5000) mod.data.history.shift(); mod.save(); record(c, 'moderation.' + type, th, { reason, meta: Object.assign({ player: p.name }, extra) }); return e; }
  R('GET', '/players', 'view_users', async c => { const q = clean(c.q.get('q'), 40).toLowerCase(), st = c.q.get('status'), sort = c.q.get('sort') || 'last'; let l = playerList().filter(p => (!q || p.name.toLowerCase().includes(q) || p.id.startsWith(q)) && (!st || p.status === st)); const key = { last: p => -(p.last || 0), name: p => p.name.toLowerCase(), playtime: p => -p.playtime, first: p => -(p.first || 0) }[sort] || (p => -(p.last || 0)); l.sort((a, b) => (key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0)); return paginate(l, c.q); });
  R('GET', '/players/:th', 'view_users', async c => { needPlayer(c.params.th); const p = playerList().find(x => x.id === c.params.th); return { player: p, history: mod.data.history.filter(h => h.th === p.id).reverse(), bans: mod.data.bans.filter(b => b.th === p.id).reverse(), reports: reports.data.items.filter(r => r.target.th === p.id || r.reporter.th === p.id).reverse().map(reportView) }; });
  R('POST', '/players/:th/warn', 'moderate_players', async c => { const b = await c.json(), reason = needReason(b), e = modAction(c, c.params.th, 'warn', reason); mod.data.warnings.push({ th: c.params.th, reason, by: c.user.username, at: e.at }); mod.save(); game.sendTo(c.params.th, { t: 'chat', sys: 1, msg: `[WARNING] ${reason}` }); return { ok: true, action: e }; });
  R('POST', '/players/:th/mute', 'moderate_players', async c => { const b = await c.json(), reason = needReason(b), mins = clampNum(b.minutes, 1, 60 * 24 * 30, 30), until = Date.now() + mins * 60e3; mod.data.mutes[c.params.th] = { until, reason, by: c.user.username }; const e = modAction(c, c.params.th, 'mute', reason, { until }); game.sendTo(c.params.th, { t: 'chat', sys: 1, msg: `You are muted for ${Math.round(mins)} min: ${reason}` }); return { ok: true, action: e }; });
  R('POST', '/players/:th/unmute', 'moderate_players', async c => { const b = await c.json(); delete mod.data.mutes[c.params.th]; const e = modAction(c, c.params.th, 'unmute', cleanText(b.reason, 300) || 'unmuted'); return { ok: true, action: e }; });
  R('POST', '/players/:th/kick', 'moderate_players', async c => { const b = await c.json(), reason = needReason(b), n = game.kick(c.params.th, reason); const e = modAction(c, c.params.th, 'kick', reason, { wasOnline: n > 0 }); return { ok: true, kicked: n, action: e }; });
  R('POST', '/players/:th/ban', 'moderate_players', async c => {
    const b = await c.json(), reason = needReason(b); needConfirm(b); needPlayer(c.params.th);
    if (activeBan(c.params.th)) throw new HttpError(409, 'already_banned', 'This player is already banned');
    const permanent = b.permanent === true, hours = permanent ? 0 : clampNum(b.hours, 1 / 60, 24 * 365, 24), until = permanent ? null : Date.now() + hours * 3600e3, on = game.onlineMap().get(c.params.th);
    const ban = { id: 'B-' + rid(4), th: c.params.th, name: needPlayer(c.params.th).name, ipHash: b.banAddress && on ? ipHash(on.ip) : null, reason, by: c.user.username, at: Date.now(), until, lifted: null };
    mod.data.bans.push(ban); const e = modAction(c, c.params.th, permanent ? 'ban' : 'tempban', reason, { until, banId: ban.id }); game.kick(c.params.th, `Banned: ${reason}`); return { ok: true, ban, action: e };
  });
  R('POST', '/players/:th/unban', 'moderate_players', async c => { const b = await c.json(), reason = needReason(b); let n = 0; for (const x of mod.data.bans) if (x.th === c.params.th && !x.lifted) { x.lifted = { by: c.user.username, at: Date.now(), reason }; n++; } if (!n) throw new HttpError(409, 'not_banned', 'This player is not banned'); const e = modAction(c, c.params.th, 'unban', reason); return { ok: true, lifted: n, action: e }; });
  R('GET', '/moderation', 'view_users', async c => { const type = c.q.get('type'), actor = c.q.get('actor'), q = clean(c.q.get('q'), 40).toLowerCase(); return paginate(mod.data.history.filter(h => (!type || h.type === type) && (!actor || h.by === actor) && (!q || `${h.name} ${h.reason}`.toLowerCase().includes(q))).reverse(), c.q); });
  R('GET', '/bans', 'view_users', async c => paginate(mod.data.bans.map(b => Object.assign({}, b, { active: !b.lifted && (!b.until || b.until > Date.now()), ipHash: b.ipHash ? 'address' : null })).reverse(), c.q));

  // ---- staff + security
  R('GET', '/staff', 'manage_staff', async c => ({ staff: Object.values(staff.data).map(staffView) }));
  R('POST', '/staff', 'manage_staff', async c => { const b = await c.json(); if (!validUsername(b.username)) throw bad('bad_username', 'Username: 3-24 letters, digits, dot, dash or underscore'); if (staff.data[b.username.toLowerCase()]) throw new HttpError(409, 'exists', 'That username is taken'); if (!isRole(b.role)) throw bad('bad_role', 'Unknown role'); if (!outranks(c.user.role, b.role)) throw new HttpError(403, 'rank', 'You can only create accounts below your own role'); checkPasswordPolicy(b.password); staff.data[b.username.toLowerCase()] = { username: b.username, role: b.role, pass: hashPassword(b.password), created: Date.now(), createdBy: c.user.username }; staff.save(); record(c, 'staff.create', b.username, { meta: { role: b.role } }); return { user: staffView(staff.data[b.username.toLowerCase()]) }; });
  R('PATCH', '/staff/:name', 'manage_staff', async c => {
    const s = getStaff(c.params.name), b = await c.json(), self = s.username === c.user.username, changes = {};
    if (!self && !outranks(c.user.role, s.role)) throw new HttpError(403, 'rank', 'You cannot change an account at or above your own role');
    if (b.role !== undefined && b.role !== s.role) { if (!isRole(b.role)) throw bad('bad_role', 'Unknown role'); if (self) throw new HttpError(403, 'self_role', 'You cannot change your own role'); if (!outranks(c.user.role, b.role)) throw new HttpError(403, 'rank', 'You can only grant roles below your own'); changes.role = [s.role, b.role]; s.role = b.role; }
    if (b.disabled !== undefined && !!b.disabled !== !!s.disabled) { if (self) throw new HttpError(403, 'self_disable', 'You cannot disable your own account'); if (s.role === 'OWNER' && owners().length <= 1) throw new HttpError(409, 'last_owner', 'The last owner account cannot be disabled'); s.disabled = !!b.disabled; changes.disabled = s.disabled; if (s.disabled) sessions.revokeUser(s.username); }
    if (b.password !== undefined) { if (self) throw bad('use_me', 'Change your own password from your profile'); checkPasswordPolicy(b.password); s.pass = hashPassword(b.password); changes.passwordReset = true; sessions.revokeUser(s.username); }
    if (!Object.keys(changes).length) throw bad('no_change', 'Nothing to change'); staff.save(); record(c, 'staff.update', s.username, { reason: cleanText(b.reason, 200), meta: changes }); return { user: staffView(s) };
  });
  R('DELETE', '/staff/:name', 'manage_staff', async c => { const s = getStaff(c.params.name), b = await c.json(); needConfirm(b); const reason = needReason(b); if (s.username === c.user.username) throw new HttpError(403, 'self_delete', 'You cannot delete your own account'); if (!outranks(c.user.role, s.role)) throw new HttpError(403, 'rank', 'You cannot delete an account at or above your own role'); sessions.revokeUser(s.username); delete staff.data[s.username.toLowerCase()]; staff.save(); record(c, 'staff.delete', s.username, { reason }); return { ok: true }; });
  R('POST', '/staff/:name/owner', 'manage_security', async c => { const s = getStaff(c.params.name), b = await c.json(); needConfirm(b); const reason = needReason(b); if (!verifyPassword(String(b.password || ''), c.user.pass)) throw new HttpError(403, 'bad_password', 'Confirm with your own password'); const make = b.owner !== false; if (!make && s.role === 'OWNER' && owners().length <= 1) throw new HttpError(409, 'last_owner', 'There must always be at least one owner'); if (!make && s.username === c.user.username) throw new HttpError(403, 'self_demote', 'Another owner has to remove your owner role'); const from = s.role; s.role = make ? 'OWNER' : 'ADMIN'; staff.save(); record(c, 'staff.owner', s.username, { reason, meta: { from, to: s.role } }); return { user: staffView(s) }; });
  R('GET', '/security', 'manage_security', async c => ({ signing: releases.signing, sessions: sessions.list(), audit: audit.verify(), matrix: matrix(), policy: { passwordMin: 10, sessionHours: SESSION_TTL / 3600e3, loginAttempts: 5, lockMinutes: 15 }, legacyAdminKey: !!process.env.ADMIN_KEY, staff: Object.values(staff.data).map(staffView) }));
  R('DELETE', '/sessions/:id', 'manage_security', async c => { const n = sessions.revokeById(c.params.id); record(c, 'security.session.revoke', c.params.id, { meta: { revoked: n } }); return { revoked: n }; });

  // ---- reports
  const reportView = r => ({ id: r.id, at: r.at, status: r.status, priority: r.priority, category: r.category, reporter: r.reporter, target: r.target, server: r.server, text: r.text, assignee: r.assignee, evidence: r.evidence, notes: r.notes, trail: r.trail });
  const getReport = id => { const r = reports.data.items.find(x => x.id === id); if (!r) throw new HttpError(404, 'no_report', 'Report not found'); return r; };
  R('GET', '/reports', 'manage_reports', async c => { const st = c.q.get('status'), pr = c.q.get('priority'), q = clean(c.q.get('q'), 40).toLowerCase(), as = c.q.get('assignee'); return paginate(reports.data.items.filter(r => (!st || r.status === st) && (!pr || r.priority === pr) && (!as || r.assignee === as) && (!q || `${r.id} ${r.target.name} ${r.reporter.name} ${r.text}`.toLowerCase().includes(q))).reverse().map(reportView), c.q); });
  R('GET', '/reports/:id', 'manage_reports', async c => ({ report: reportView(getReport(c.params.id)) }));
  R('PATCH', '/reports/:id', 'manage_reports', async c => {
    const r = getReport(c.params.id), b = await c.json(), did = [];
    if (b.status !== undefined && b.status !== r.status) { if (!REPORT_STATUS.includes(b.status)) throw bad('bad_status', 'Unknown status'); if (['resolved', 'rejected'].includes(b.status) && cleanText(b.note, 600).length < 3) throw bad('note_required', 'Add a note that explains the decision'); did.push(`status ${r.status} → ${b.status}`); r.status = b.status; }
    if (b.priority !== undefined && b.priority !== r.priority) { if (!PRIORITIES.includes(b.priority)) throw bad('bad_priority', 'Unknown priority'); did.push(`priority ${r.priority} → ${b.priority}`); r.priority = b.priority; }
    if (b.assignee !== undefined && b.assignee !== r.assignee) { if (b.assignee) getStaff(b.assignee); did.push(`assigned to ${b.assignee || 'nobody'}`); r.assignee = b.assignee || null; }
    const note = cleanText(b.note, 600); if (note) { r.notes.push({ by: c.user.username, at: Date.now(), text: note }); did.push('note'); }
    if (!did.length) throw bad('no_change', 'Nothing to change'); r.trail.push({ by: c.user.username, at: Date.now(), action: did.join(', ') }); reports.save(); record(c, 'report.update', r.id, { reason: note, meta: { changes: did } }); return { report: reportView(r) };
  });

  // ---- tickets
  const ticketView = t => ({ id: t.id, subject: t.subject, category: t.category, priority: t.priority, status: t.status, contact: t.contact, createdAt: t.createdAt, updatedAt: t.updatedAt, assignee: t.assignee, messages: t.messages.length, diag: t.diag });
  const getTicket = id => { const t = tickets.data.items.find(x => x.id === id); if (!t) throw new HttpError(404, 'no_ticket', 'Ticket not found'); return t; };
  R('GET', '/tickets', 'manage_tickets', async c => { const st = c.q.get('status'), pr = c.q.get('priority'), cat = c.q.get('category'), q = clean(c.q.get('q'), 40).toLowerCase(); return paginate(tickets.data.items.filter(t => (st ? t.status === st : t.status !== 'archived') && (!pr || t.priority === pr) && (!cat || t.category === cat) && (!q || `${t.id} ${t.subject} ${t.contact}`.toLowerCase().includes(q))).sort((a, b) => b.updatedAt - a.updatedAt).map(ticketView), c.q); });
  R('GET', '/tickets/:id', 'manage_tickets', async c => { const t = getTicket(c.params.id); return { ticket: Object.assign(ticketView(t), { thread: t.messages }) }; });
  R('POST', '/tickets/:id/reply', 'manage_tickets', async c => { const t = getTicket(c.params.id), b = await c.json(), text = cleanText(b.message, 4000); if (text.length < 2) throw bad('too_short', 'Message is empty'); if (t.status === 'archived') throw new HttpError(409, 'archived', 'Reopen the ticket first'); t.messages.push({ from: 'staff', author: c.user.username, text, at: Date.now(), internal: !!b.internal }); t.updatedAt = Date.now(); if (!b.internal && t.status === 'open') t.status = 'pending'; if (!t.assignee) t.assignee = c.user.username; tickets.save(); record(c, b.internal ? 'ticket.note' : 'ticket.reply', t.id); return { ticket: Object.assign(ticketView(t), { thread: t.messages }) }; });
  R('PATCH', '/tickets/:id', 'manage_tickets', async c => { const t = getTicket(c.params.id), b = await c.json(), did = []; if (b.status !== undefined && b.status !== t.status) { if (!TICKET_STATUS.includes(b.status)) throw bad('bad_status', 'Unknown status'); did.push(`status ${t.status} → ${b.status}`); t.status = b.status; } if (b.priority !== undefined && b.priority !== t.priority) { if (!PRIORITIES.includes(b.priority)) throw bad('bad_priority', 'Unknown priority'); did.push(`priority → ${b.priority}`); t.priority = b.priority; } if (b.assignee !== undefined && b.assignee !== t.assignee) { if (b.assignee) getStaff(b.assignee); t.assignee = b.assignee || null; did.push(`assigned to ${t.assignee || 'nobody'}`); } if (!did.length) throw bad('no_change', 'Nothing to change'); t.updatedAt = Date.now(); tickets.save(); record(c, 'ticket.update', t.id, { meta: { changes: did } }); return { ticket: Object.assign(ticketView(t), { thread: t.messages }) }; });

  // ---- announcements
  const getAnn = id => { const a = content.data.announcements.find(x => x.id === id); if (!a) throw new HttpError(404, 'no_announcement', 'Announcement not found'); return a; };
  function annFields(a, b) {
    if (b.title !== undefined) a.title = pair(b.title, 120); if (b.short !== undefined) a.short = pair(b.short, 240); if (b.body !== undefined) a.body = pair(b.body, 4000);
    if (b.tag !== undefined) { if (!ANNOUNCE_TAGS.includes(b.tag)) throw bad('bad_tag', 'Unknown tag'); a.tag = b.tag; }
    if (b.priority !== undefined) a.priority = Math.round(clampNum(b.priority, 0, 3, 1));
    if (b.publishAt !== undefined) a.publishAt = isoOrNull(b.publishAt); if (b.expiresAt !== undefined) a.expiresAt = isoOrNull(b.expiresAt);
    if (b.image !== undefined) { const im = String(b.image || ''); if (im && !/^brand\/[A-Za-z0-9._@-]+\.(png|svg)$/.test(im)) throw bad('bad_image', 'Image must be a file from the brand/ folder'); a.image = im || null; }
    if (!a.title || !a.title[1] || a.title[1].length < 3) throw bad('title_required', 'Write a title (English at least)');
    if (a.expiresAt && a.publishAt && a.expiresAt <= a.publishAt) throw bad('bad_dates', 'Expiry must be after the publish time');
    a.updatedAt = Date.now(); return a;
  }
  R('GET', '/announcements', 'manage_announcements', async c => { const st = c.q.get('status'); return paginate(content.data.announcements.filter(a => !st || a.status === st).slice().sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0) || String(b.date).localeCompare(String(a.date))), c.q); });
  R('POST', '/announcements', 'manage_announcements', async c => { const b = await c.json(), a = annFields({ id: 'a-' + rid(5), tag: 'news', priority: 1, status: 'draft', date: new Date().toISOString().slice(0, 10), title: ['', ''], short: ['', ''], body: ['', ''], publishAt: null, expiresAt: null, createdBy: c.user.username }, b); content.data.announcements.push(a); content.save(); record(c, 'announcement.create', a.id, { meta: { title: a.title[1] } }); return { announcement: a }; });
  R('PATCH', '/announcements/:id', 'manage_announcements', async c => { const a = getAnn(c.params.id); annFields(a, await c.json()); content.save(); record(c, 'announcement.update', a.id); return { announcement: a }; });
  R('POST', '/announcements/:id/:action', 'manage_announcements', async c => { const a = getAnn(c.params.id), act = c.params.action; if (act === 'publish') { a.status = 'published'; a.date = new Date().toISOString().slice(0, 10); a.publishAt = null; } else if (act === 'schedule') { if (!a.publishAt || a.publishAt <= Date.now()) throw bad('bad_dates', 'Set a publish time in the future first'); a.status = 'scheduled'; } else if (act === 'unpublish') a.status = 'draft'; else if (act === 'archive') a.status = 'archived'; else throw new HttpError(404, 'no_action', 'Unknown action'); a.updatedAt = Date.now(); content.save(); record(c, 'announcement.' + act, a.id, { meta: { title: a.title[1] } }); return { announcement: a }; });
  R('DELETE', '/announcements/:id', 'manage_announcements', async c => { const a = getAnn(c.params.id), b = await c.json(); needConfirm(b); if (a.status === 'published') throw new HttpError(409, 'published', 'Unpublish or archive it first'); content.data.announcements = content.data.announcements.filter(x => x !== a); content.save(); record(c, 'announcement.delete', a.id, { meta: { title: a.title[1] } }); return { ok: true }; });

  // ---- changelog
  const getLog = v => { const e = content.data.changelog.find(x => x.version === v); if (!e) throw new HttpError(404, 'no_changelog', 'Changelog entry not found'); return e; };
  function logFields(e, b) { if (b.buildId !== undefined) e.buildId = clean(b.buildId, 40) || null; if (b.date !== undefined) { if (!/^\d{4}-\d{2}-\d{2}$/.test(b.date)) throw bad('bad_date', 'Date must be YYYY-MM-DD'); e.date = b.date; } if (b.type !== undefined) e.type = ['major', 'minor', 'patch', 'hotfix'].includes(b.type) ? b.type : 'minor'; if (b.required !== undefined) e.required = !!b.required; if (b.summary !== undefined) e.summary = cleanText(b.summary, 600); for (const k of ['features', 'improvements', 'fixes', 'performance', 'knownIssues']) if (b[k] !== undefined) e[k] = lines(b[k]); return e; }
  R('GET', '/changelog', 'manage_changelog', async c => paginate(content.data.changelog, c.q));
  R('POST', '/changelog', 'manage_changelog', async c => { const b = await c.json(); if (!isVersion(b.version)) throw bad('bad_version', 'Version must look like 10.0.0'); if (content.data.changelog.some(x => x.version === b.version)) throw new HttpError(409, 'exists', 'This version already has a changelog entry'); const e = logFields({ version: b.version, buildId: null, date: new Date().toISOString().slice(0, 10), type: 'minor', required: false, summary: '', features: [], improvements: [], fixes: [], performance: [], knownIssues: [], status: 'draft', createdBy: c.user.username }, b); content.data.changelog.push(e); content.data.changelog.sort((a, b2) => cmpVersion(b2.version, a.version)); content.save(); record(c, 'changelog.create', e.version); return { entry: e }; });
  R('PATCH', '/changelog/:version', 'manage_changelog', async c => { const e = logFields(getLog(c.params.version), await c.json()); content.save(); releases.invalidate(); record(c, 'changelog.update', e.version); return { entry: e }; });
  R('POST', '/changelog/:version/:action', 'manage_changelog', async c => { const e = getLog(c.params.version), act = c.params.action; if (act === 'publish') { if (!e.summary && ![e.features, e.improvements, e.fixes, e.performance].some(l => l.length)) throw bad('empty', 'Write the notes before publishing'); e.status = 'published'; } else if (act === 'unpublish') e.status = 'draft'; else throw new HttpError(404, 'no_action', 'Unknown action'); content.save(); releases.invalidate(); record(c, 'changelog.' + act, e.version); return { entry: e }; });
  R('DELETE', '/changelog/:version', 'manage_changelog', async c => { const e = getLog(c.params.version), b = await c.json(); needConfirm(b); if (e.status === 'published') throw new HttpError(409, 'published', 'Unpublish it first'); content.data.changelog = content.data.changelog.filter(x => x !== e); content.save(); record(c, 'changelog.delete', e.version); return { ok: true }; });

  // ---- releases, builds, patches
  R('GET', '/releases', 'manage_releases', async c => { const st = c.q.get('status'), ch = c.q.get('channel'), v = c.q.get('version'); const d = releases.col.data; return Object.assign(paginate(releases.list().filter(r => (!st || r.status === st) && (!ch || r.channel === ch) && (!v || r.version === v)), c.q), { active: d.active, history: d.history, channels: CHANNELS, signing: releases.signing }); });
  R('POST', '/releases', 'manage_releases', async c => { const b = await c.json(), r = releases.createDraft({ version: b.version, channel: b.channel || 'stable', summary: b.summary, minVersion: b.minVersion, mandatory: b.mandatory, base: b.base }, c.user.username); record(c, 'release.create', r.id, { meta: { version: r.version, channel: r.channel, base: r.base || null } }); return { release: releases.view(r) }; });
  R('GET', '/releases/:id', 'manage_releases', async c => { const r = releases.get(c.params.id); return { release: releases.view(r), files: r.fileTable || [], problems: r.problems || [] }; });
  R('PATCH', '/releases/:id', 'manage_releases', async c => { const r = releases.get(c.params.id), b = await c.json(); if (['published', 'archived'].includes(r.status)) throw new HttpError(409, 'locked', 'Published releases are immutable; change the floor or force-update from Settings'); if (b.summary !== undefined) r.summary = cleanText(b.summary, 400); if (b.mandatory !== undefined) r.mandatory = !!b.mandatory; if (b.minVersion !== undefined) { if (b.minVersion && (!isVersion(b.minVersion) || cmpVersion(b.minVersion, r.version) > 0)) throw bad('bad_min_version', 'Minimum version must be a version no newer than the release'); r.minVersion = b.minVersion || null; } releases.col.save(); record(c, 'release.update', r.id); return { release: releases.view(r) }; });
  R('PUT', '/releases/:id/files', 'manage_releases', async c => { const buf = await readBody(c.req, 256 * 1024 * 1024), f = releases.putFile(c.params.id, c.q.get('path'), buf); record(c, 'release.file.put', c.params.id, { meta: { path: f.path, size: f.size, sha256: f.sha256 } }); return { file: f }; });
  R('DELETE', '/releases/:id/files', 'manage_releases', async c => { releases.deleteFile(c.params.id, c.q.get('path')); record(c, 'release.file.delete', c.params.id, { meta: { path: c.q.get('path') } }); return { ok: true }; });
  R('POST', '/releases/:id/verify', 'manage_releases', async c => { const v = releases.verify(c.params.id); record(c, 'release.verify', c.params.id, { result: v.ok ? 'ok' : 'failed', meta: { problems: v.problems.slice(0, 5), files: v.files } }); return v; });
  R('POST', '/releases/:id/status', 'manage_releases', async c => { const b = await c.json(), from = releases.get(c.params.id).status, r = releases.transition(c.params.id, b.to); record(c, 'release.status', r.id, { reason: cleanText(b.reason, 200), meta: { from, to: r.status } }); return { release: releases.view(r) }; });
  R('POST', '/releases/:id/publish', 'manage_releases', async c => { const b = await c.json(); needConfirm(b); const r = releases.publish(c.params.id, { mandatory: b.mandatory, minVersion: b.minVersion }, c.user.username); record(c, 'release.publish', r.id, { reason: cleanText(b.reason, 200), meta: { version: r.version, channel: r.channel, mandatory: r.mandatory, minVersion: r.minVersion } }); game.onRelease(r); return { release: releases.view(r) }; });
  R('POST', '/releases/rollback', 'manage_releases', async c => { const b = await c.json(); needConfirm(b); const reason = needReason(b), out = releases.rollback(b.channel || 'stable', c.user.username); record(c, 'release.rollback', out.to, { reason, meta: out }); telemetry.data.errors.push({ id: 'I-' + rid(4), at: Date.now(), kind: 'incident', severity: 'high', code: 'ARVEX-R001', message: `Rollback ${out.from} → ${out.to}: ${reason}`, version: build.version, build: out.from || '', platform: 'release' }); telemetry.save(); return out; });
  R('DELETE', '/releases/:id', 'manage_releases', async c => { const b = await c.json(); needConfirm(b); const reason = needReason(b); releases.remove(c.params.id); record(c, 'release.delete', c.params.id, { reason }); return { ok: true }; });
  R('GET', '/patches', 'manage_patches', async c => { const from = c.q.get('from'), to = c.q.get('to'); if (from && to) return { patch: releases.patch(from, to) }; const list = releases.list().filter(r => !r.filesGone), act = releases.active('stable'), out = []; if (act) for (const r of list) if (r.id !== act.id && cmpVersion(r.version, act.version) <= 0) { try { const p = releases.patch(r.id, act.id); out.push({ base: p.base, target: p.target, files: p.files.length, removed: p.removed.length, size: p.size, fullSize: p.fullSize, hash: p.hash, patchType: p.patchType }); } catch (e) {} } return { patches: out, releases: list.map(r => ({ id: r.id, version: r.version, status: r.status })) }; });

  // ---- servers
  const needShard = id => { if (!game.shardInfo().some(s => s.id === id)) throw new HttpError(404, 'no_server', 'Server not found'); return id; };
  R('GET', '/servers', 'view_dashboard', async c => ({ servers: game.shardInfo() }));
  R('POST', '/servers/:id/restart', 'manage_servers', async c => { const b = await c.json(); needConfirm(b); const reason = needReason(b), ms = clampNum(b.inSeconds, 15, 3600, 60) * 1000; game.scheduleRestart(needShard(c.params.id), ms); record(c, 'server.restart', c.params.id, { reason, meta: { inSeconds: ms / 1000 } }); return { servers: game.shardInfo() }; });
  R('POST', '/servers/:id/maintenance', 'manage_servers', async c => { const b = await c.json(); game.setShardMaintenance(needShard(c.params.id), !!b.on); record(c, 'server.maintenance', c.params.id, { reason: cleanText(b.reason, 200), meta: { on: !!b.on } }); return { servers: game.shardInfo() }; });
  R('POST', '/servers/:id/lock', 'manage_servers', async c => { const b = await c.json(); game.setShardLock(needShard(c.params.id), !!b.on); record(c, 'server.lock', c.params.id, { reason: cleanText(b.reason, 200), meta: { on: !!b.on } }); return { servers: game.shardInfo() }; });
  R('POST', '/servers/:id/broadcast', 'manage_servers', async c => { const b = await c.json(), msg = clean(b.message, 160); if (msg.length < 2) throw bad('too_short', 'Message is empty'); const n = game.broadcast(c.params.id === 'all' ? null : needShard(c.params.id), msg); record(c, 'server.broadcast', c.params.id, { meta: { message: msg, reached: n } }); return { reached: n }; });

  // ---- remote config, maintenance, force update, feature flags
  R('GET', '/config', 'manage_settings', async c => ({ config: cfg, flags: KNOWN_FLAGS, effectiveMinVersion: effectiveMinVersion(), protocolMin: game.protocolMin, public: publicConfig() }));
  R('PATCH', '/config', 'manage_settings', async c => {
    const b = await c.json(), did = {};
    if (b.maintenance !== undefined) { const m = b.maintenance || {}; if (m.on && !can(c.user.role, 'manage_servers')) throw new HttpError(403, 'forbidden', 'Maintenance mode needs the manage_servers permission'); cfg.maintenance = { on: !!m.on, message: pair(m.message, 300), until: isoOrNull(m.until), blockLaunch: m.blockLaunch === true }; if (cfg.maintenance.on && cfg.maintenance.message[1].length < 3) throw bad('message_required', 'Write the maintenance message players will see'); did.maintenance = cfg.maintenance.on; }
    if (b.minVersion !== undefined) { if (b.minVersion && !isVersion(b.minVersion)) throw bad('bad_version', 'Version must look like 10.0.0'); const act = releases.active('stable'); if (b.minVersion && act && cmpVersion(b.minVersion, act.version) > 0) throw bad('min_too_high', `Minimum version cannot be newer than the published release (${act.version})`); cfg.minVersion = b.minVersion || null; did.minVersion = cfg.minVersion; }
    if (b.forceUpdate !== undefined) { const f = b.forceUpdate || {}; if (f.on) { needConfirm(b); if (!can(c.user.role, 'manage_releases')) throw new HttpError(403, 'forbidden', 'Force update needs the manage_releases permission'); } cfg.forceUpdate = { on: !!f.on, reason: pair(f.reason, 300) }; if (cfg.forceUpdate.on && cfg.forceUpdate.reason[1].length < 3) throw bad('reason_required', 'Tell players why the update is required'); did.forceUpdate = cfg.forceUpdate.on; }
    if (b.flags !== undefined) { for (const [k, v] of Object.entries(b.flags || {})) { if (!(k in KNOWN_FLAGS)) throw bad('unknown_flag', `Unknown feature flag: ${k}`); if (cfg.flags[k] !== !!v) { cfg.flags[k] = !!v; (did.flags = did.flags || {})[k] = !!v; } } }
    if (b.download !== undefined) { cfg.download.concurrent = Math.round(clampNum((b.download || {}).concurrent, 1, 6, 3)); did.download = cfg.download; }
    if (b.rollbackThreshold !== undefined) { cfg.rollbackThreshold = Math.round(clampNum(b.rollbackThreshold, 1, 10000, 25)); did.rollbackThreshold = cfg.rollbackThreshold; }
    if (!Object.keys(did).length) throw bad('no_change', 'Nothing to change'); cfgCol.save(); releases.invalidate(); game.onConfig(publicConfig()); record(c, 'config.update', Object.keys(did).join(','), { reason: cleanText(b.reason, 200), meta: did }); return { config: cfg, public: publicConfig() };
  });

  // ---- logs, audit, errors, backups
  R('GET', '/logs', 'view_logs', async c => { const lv = c.q.get('level'), q = clean(c.q.get('q'), 60).toLowerCase(), sc = c.q.get('scope'); return paginate(recentLogs().filter(e => (!lv || e.level === lv) && (!sc || e.scope === sc) && (!q || e.msg.toLowerCase().includes(q))).reverse(), c.q, 200); });
  R('GET', '/audit', 'view_logs', async c => paginate(audit.query({ actor: c.q.get('actor') || undefined, action: c.q.get('action') || undefined, result: c.q.get('result') || undefined, from: c.q.get('from') || undefined, to: c.q.get('to') || undefined, q: c.q.get('q') || undefined }), c.q));
  R('GET', '/audit/verify', 'view_logs', async c => audit.verify());
  R('GET', '/errors', 'view_logs', async c => { const kind = c.q.get('kind'), sev = c.q.get('severity'), v = c.q.get('version'); return paginate(telemetry.data.errors.filter(e => (!kind || e.kind === kind) && (!sev || e.severity === sev) && (!v || e.version === v)).reverse(), c.q); });
  R('GET', '/backups', 'manage_settings', async c => ({ backups: backups.data.items.slice().reverse(), last: backups.data.items[backups.data.items.length - 1] || null, restore: 'manual' }));
  R('POST', '/backups', 'manage_settings', async c => {
    store.flushAll(); game.saveAll(); const id = new Date().toISOString().replace(/[:.]/g, '-'), dst = path.join(dataDir, 'backups', id); let files = 0, bytes = 0, result = 'ok';
    try { fs.mkdirSync(path.join(dst, 'admin'), { recursive: true }); for (const f of fs.readdirSync(path.join(dataDir, 'admin'))) if (/\.(json|log)$/.test(f) && f !== 'sessions.json') { fs.copyFileSync(path.join(dataDir, 'admin', f), path.join(dst, 'admin', f)); files++; bytes += fs.statSync(path.join(dst, 'admin', f)).size; } for (const f of fs.readdirSync(dataDir)) if (/\.json$/.test(f)) { fs.copyFileSync(path.join(dataDir, f), path.join(dst, f)); files++; bytes += fs.statSync(path.join(dst, f)).size; } } catch (e) { result = 'failed: ' + (e.code || e.message); }
    const item = { id, at: Date.now(), by: c.user.username, files, bytes, result }; backups.data.items.push(item); while (backups.data.items.length > 10) { const old = backups.data.items.shift(); fs.rmSync(path.join(dataDir, 'backups', old.id), { recursive: true, force: true }); } backups.save(); record(c, 'backup.create', id, { result: result === 'ok' ? 'ok' : 'failed', meta: { files, bytes } }); if (result !== 'ok') throw new HttpError(500, 'backup_failed', 'Backup failed: ' + result); return { backup: item };
  });

  // ---- realtime (server-sent events): a compact status frame every few seconds
  function stream(req, res, user) {
    res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store', 'x-accel-buffering': 'no' });
    const push = () => { const d = dashboard(); res.write(`data: ${JSON.stringify({ time: d.time, playersOnline: d.playersOnline, servers: d.servers.map(s => ({ id: s.id, status: s.status, players: s.players, max: s.max })), alerts: d.alerts, errors: d.errors.lastHour, openReports: d.reports.open, openTickets: d.tickets.open, activeRelease: d.activeRelease ? { id: d.activeRelease.id, version: d.activeRelease.version, status: d.activeRelease.status } : null, updates: d.updates })}\n\n`); };
    push(); const t = setInterval(push, 4000); req.on('close', () => clearInterval(t));
  }

  async function handleAdmin(req, res, u, p) {
    const sub = p.slice(API.length) || '/', ip = clientIp(req), ctx = { req, res, ip, q: u.searchParams, params: {}, user: null, session: null, token: null, json: () => readJSON(req, 256 * 1024) };
    try {
      const w = limiter.hit('admin:' + ip, 300, 60e3); if (w) throw new HttpError(429, 'rate_limited', 'Too many requests. Slow down.', { retryAfter: w });
      const methodRoutes = routes.filter(r => { const m = r.re.exec(sub); if (m) { r._m = m; return true; } return false; });
      const sse = sub === '/events' && req.method === 'GET';
      const route = methodRoutes.find(r => r.method === req.method);
      if (!route && !sse) throw new HttpError(methodRoutes.length ? 405 : 404, methodRoutes.length ? 'method_not_allowed' : 'not_found', methodRoutes.length ? 'Method not allowed' : 'No such endpoint');
      if (sse || route.perm) {                                                      // authenticate
        ctx.token = parseCookies(req)[COOKIE]; ctx.session = sessions.resolve(ctx.token); ctx.user = staff.data[ctx.session.user.toLowerCase()];
        if (!ctx.user || ctx.user.disabled) { sessions.revoke(ctx.token); throw new HttpError(401, 'invalid_session', 'This account is no longer active'); }
        if (req.method !== 'GET' && req.headers['x-arvex-csrf'] !== ctx.session.csrf) throw new HttpError(403, 'csrf', 'Security token is missing or stale. Reload the page.');
        const perm = sse ? 'view_dashboard' : route.perm;                              // authorize (server side, never the UI)
        if (perm !== 'any' && !can(ctx.user.role, perm)) { record(ctx, 'access.denied', `${req.method} ${sub}`, { result: 'denied', reason: 'missing ' + perm }); throw new HttpError(403, 'forbidden', `Your role (${ctx.user.role}) does not have the ${perm} permission`); }
      }
      if (sse) { stream(req, res, ctx.user); return true; }
      ctx.params = Object.fromEntries(Object.entries(route._m.groups || {}).map(([k, v]) => [k, decodeURIComponent(v)]));
      const out = await route.fn(ctx); sendJSON(res, 200, out == null ? { ok: true } : out); return true;
    } catch (e) { return fail(res, e); }
  }

  log.info(`admin backend ready · ${Object.keys(staff.data).length} staff · audit ${audit.entries.length} entries · signing ${releases.signing.enabled ? 'on (' + releases.signing.keyId + ')' : 'off'}`);
  return {
    API, releases, config: cfg, publicConfig, effectiveMinVersion, handlePublic, handleAdmin, health, flushAll: () => store.flushAll(), audit,
    /** called by the game server when a client says hello: returns a rejection or null */
    checkJoin(th, ip) { const b = activeBan(th, ipHash(ip)); if (b) return { code: 'banned', msg: `Banned${b.until ? ' until ' + new Date(b.until).toISOString().slice(0, 16).replace('T', ' ') + ' UTC' : ''}: ${b.reason}` }; if (cfg.maintenance.on) return { code: 'maintenance', msg: cfg.maintenance.message[1] || 'Maintenance' }; return null; },
    mutedUntil(th) { const m = mod.data.mutes[th]; return m && m.until > Date.now() ? m.until : 0; },
    flag: k => !!cfg.flags[k],
    addReport({ reporter, target, server, category, text, evidence }) {
      if (!cfg.flags.reports) return { error: 'Reports are turned off right now' };
      if (reports.data.items.filter(r => r.reporter.th === reporter.th && r.at > Date.now() - 10 * 60e3).length >= 3) return { error: 'You sent several reports already. Please wait a few minutes.' };
      const r = { id: 'R-' + String(++reports.data.seq).padStart(6, '0'), at: Date.now(), status: 'open', priority: 'medium', category: REPORT_CATEGORIES.includes(category) ? category : 'other', reporter, target, server, text: cleanText(text, 500), assignee: null, evidence, notes: [], trail: [{ by: 'system', at: Date.now(), action: 'created' }] };
      reports.data.items.push(r); reports.save(); return { id: r.id };
    },
    legacyAudit(action, target, ip, meta) { audit.write({ actor: 'legacy-admin-key', role: 'OWNER', action, target, ip: ipHash(ip), meta }); },
    gameAudit(name, action, target, meta) { audit.write({ actor: 'ingame:' + name, role: 'OWNER', action, target, meta }); }
  };
}
