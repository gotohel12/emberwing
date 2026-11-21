// ARVEX — admin backend test: auth, sessions, RBAC, security, moderation, reports, tickets, content, releases, rollback, remote config, audit.
// Run against a fresh server:  ADMIN_KEY=<owner key> DATA_DIR=<empty dir> PORT=8093 node server/server.mjs
//                              node tests/admin.test.mjs http://127.0.0.1:8093 <owner key>
import WebSocket from 'ws';
import fs from 'fs';
import crypto from 'crypto';
const BASE = process.argv[2] || 'http://127.0.0.1:8093', OWNER_KEY = process.argv[3] || 'test-owner-key-123', A = BASE + '/api/admin/v1';
const VERSION = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url))).version;
let pass = 0, fail = 0; const ok = (c, m) => { if (c) { pass++; console.log('  ✓', m); } else { fail++; console.log('  ✗', m); } };
const sleep = ms => new Promise(r => setTimeout(r, ms));
class Client {            // a browser-like client: keeps the session cookie and sends the CSRF token
  constructor() { this.cookie = ''; this.csrf = ''; }
  async req(method, path, body, raw) {
    const h = {}; if (this.cookie) h.cookie = this.cookie; if (this.csrf && method !== 'GET') h['x-arvex-csrf'] = this.csrf; if (body && !raw) h['content-type'] = 'application/json';
    const r = await fetch(A + path, { method, headers: h, body: raw ? body : body ? JSON.stringify(body) : undefined });
    const sc = r.headers.get('set-cookie'); if (sc) this.cookie = sc.split(';')[0];
    let j = null; try { j = await r.json(); } catch (e) {} return { s: r.status, j: j || {}, h: r.headers };
  }
  get(p) { return this.req('GET', p); } post(p, b) { return this.req('POST', p, b || {}); } patch(p, b) { return this.req('PATCH', p, b); } del(p, b) { return this.req('DELETE', p, b || {}); }
  async login(username, password, code) { const r = await this.post('/login', { username, password, code }); if (r.j.csrf) this.csrf = r.j.csrf; return r; }
}
const pub = async (path, opt) => { const r = await fetch(BASE + path, opt); let j = {}; try { j = await r.json(); } catch (e) {} return { s: r.status, j }; };
function ws(server, hello) { return new Promise(res => { const w = new WebSocket(BASE.replace(/^http/, 'ws') + '/ws?server=' + server), c = { ws: w, msgs: [] }; c.send = m => w.send(JSON.stringify(m)); c.wait = (t, ms = 3000) => new Promise(r => { const f = c.msgs.find(m => m.t === t); if (f) return r(f); const to = setTimeout(() => r(null), ms); const iv = setInterval(() => { const g = c.msgs.find(m => m.t === t); if (g) { clearTimeout(to); clearInterval(iv); r(g); } }, 40); setTimeout(() => clearInterval(iv), ms + 50); }); w.on('message', d => c.msgs.push(JSON.parse(d))); w.on('open', () => { c.send(Object.assign({ t: 'hello', version: VERSION, name: 'T' }, hello)); res(c); }); }); }
const PW = 'correct-horse-42-battery';

console.log('Bootstrap + authentication');
const owner = new Client();
let r = await owner.get('/bootstrap'); ok(r.s === 200 && r.j.needsSetup === true && r.j.version === VERSION, 'fresh server asks for owner setup and reports the version');
r = await owner.post('/setup', { ownerKey: 'wrong-key-000', username: 'mohsen', password: PW }); ok(r.s === 403 && r.j.error === 'bad_owner_key', 'setup refuses a wrong owner key');
r = await owner.post('/setup', { ownerKey: OWNER_KEY, username: 'mohsen', password: 'short1' }); ok(r.s === 400 && r.j.error === 'weak_password', 'setup refuses a weak password');
r = await owner.post('/setup', { ownerKey: OWNER_KEY, username: 'mohsen', password: PW }); ok(r.s === 200, 'owner account created with the owner key');
r = await owner.post('/setup', { ownerKey: OWNER_KEY, username: 'other', password: PW }); ok(r.s === 409, 'setup cannot run twice');
r = await owner.get('/dashboard'); ok(r.s === 401 && r.j.error === 'no_session', 'unauthenticated request → 401 no_session');
r = await new Client().login('mohsen', 'not-the-password1'); ok(r.s === 401 && r.j.error === 'bad_credentials', 'wrong password → 401');
r = await owner.login('mohsen', PW); ok(r.s === 200 && r.j.user.role === 'OWNER' && r.j.csrf && /HttpOnly/.test(r.h.get('set-cookie')) && /SameSite=Strict/.test(r.h.get('set-cookie')), 'login → HttpOnly SameSite=Strict session cookie + CSRF token');
r = await owner.get('/me'); ok(r.s === 200 && r.j.permissions.includes('manage_security'), 'session resolves; owner has manage_security');
{ const saved = owner.csrf; owner.csrf = 'bogus'; r = await owner.post('/staff', { username: 'x1x', role: 'ADMIN', password: PW }); ok(r.s === 403 && r.j.error === 'csrf', 'state-changing request without the CSRF token → 403'); owner.csrf = saved; }
{ const bad = new Client(); bad.cookie = 'arvex_admin=' + 'a'.repeat(64); r = await bad.get('/me'); ok(r.s === 401 && r.j.error === 'invalid_session', 'forged session token → 401 invalid_session'); }

console.log('Staff + RBAC');
for (const [u, role] of [['adam', 'ADMIN'], ['dev1', 'DEVELOPER'], ['mod1', 'MODERATOR'], ['sup1', 'SUPPORT']]) { r = await owner.post('/staff', { username: u, role, password: PW }); if (r.s !== 200) console.log(r.j); }
r = await owner.get('/staff'); ok(r.j.staff.length === 5, 'owner created ADMIN, DEVELOPER, MODERATOR and SUPPORT accounts');
const adminC = new Client(), dev = new Client(), modC = new Client(), sup = new Client();
await adminC.login('adam', PW); await dev.login('dev1', PW); await modC.login('mod1', PW); await sup.login('sup1', PW);
const sees = async (c, p) => (await c.get(p)).s;
ok(await sees(modC, '/releases') === 403 && await sees(sup, '/releases') === 403 && await sees(dev, '/releases') === 200, 'releases: developer yes, moderator no, support no');
ok(await sees(sup, '/security') === 403 && await sees(adminC, '/security') === 403 && await sees(owner, '/security') === 200, 'security page: owner only');
ok(await sees(modC, '/reports') === 200 && await sees(sup, '/reports') === 403 && await sees(sup, '/tickets') === 200 && await sees(modC, '/tickets') === 403, 'moderator sees reports not tickets; support sees tickets not reports');
ok(await sees(dev, '/players') === 403 && await sees(modC, '/players') === 200 && await sees(dev, '/audit') === 200 && await sees(modC, '/audit') === 403, 'players and audit log follow the permission matrix');
r = await modC.post('/releases', { version: '10.0.1', channel: 'stable' }); ok(r.s === 403, 'moderator cannot create a release');
r = await sup.patch('/config', { flags: { weather: false } }); ok(r.s === 403, 'support cannot change settings');
r = await adminC.post('/staff', { username: 'evil', role: 'OWNER', password: PW }); ok(r.s === 403 && r.j.error === 'rank', 'admin cannot create an owner');
r = await adminC.patch('/staff/mohsen', { disabled: true }); ok(r.s === 403, 'admin cannot disable the owner');
r = await adminC.post('/staff/adam/owner', { confirm: true, reason: 'promote me', password: PW }); ok(r.s === 403, 'admin cannot grant owner role (needs manage_security)');
r = await owner.patch('/staff/mohsen', { disabled: true }); ok(r.s === 403, 'owner cannot disable their own account');
r = await owner.post('/staff/mohsen/owner', { confirm: true, reason: 'step down', password: PW, owner: false }); ok(r.s === 409 && r.j.error === 'last_owner', 'the last owner cannot be removed');
r = await owner.post('/staff', { username: 'a', role: 'ADMIN', password: PW }); ok(r.s === 400, 'bad input (username) → 400');
r = await owner.req('POST', '/staff', '{not json', true); ok(r.s === 400 && r.j.error === 'bad_json', 'malformed JSON → 400');

console.log('Sessions + 2FA');
r = await owner.post('/me/2fa/setup'); const secret = r.j.secret; ok(r.s === 200 && /^[A-Z2-7]{32}$/.test(secret), '2FA setup returns a base32 secret');
const totp = (s, t = Date.now()) => { const B = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'; let bits = ''; for (const ch of s) bits += B.indexOf(ch).toString(2).padStart(5, '0'); const key = Buffer.from(bits.match(/.{8}/g).map(b => parseInt(b, 2))); const cnt = Buffer.alloc(8); cnt.writeBigUInt64BE(BigInt(Math.floor(t / 30000))); const h = crypto.createHmac('sha1', key).update(cnt).digest(), o = h[19] & 15; return String(((h[o] & 127) << 24 | h[o + 1] << 16 | h[o + 2] << 8 | h[o + 3]) % 1e6).padStart(6, '0'); };
r = await owner.post('/me/2fa/enable', { code: '000000' }); ok(r.s === 400, 'wrong 2FA code is refused');
r = await owner.post('/me/2fa/enable', { code: totp(secret) }); ok(r.s === 200, '2FA enabled with a valid code');
const owner2 = new Client(); r = await owner2.login('mohsen', PW); ok(r.s === 401 && r.j.error === 'totp_required', 'login now requires the 2FA code');
r = await owner2.login('mohsen', PW, totp(secret)); ok(r.s === 200, 'login with password + 2FA code');
r = await owner.get('/me/sessions'); ok(r.j.sessions.length === 2 && r.j.sessions.some(s => s.current), 'both owner sessions are listed');
r = await owner.del('/me/sessions/' + r.j.sessions.find(s => !s.current).id); ok(r.j.revoked === 1 && (await owner2.get('/me')).s === 401, 'revoking a session invalidates it immediately');
await owner.post('/me/2fa/disable', { password: PW });
r = await sup.post('/logout'); ok(r.s === 200 && (await sup.get('/me')).s === 401, 'logout invalidates the session server-side'); await sup.login('sup1', PW);
{ const b = new Client(); let last; for (let i = 0; i < 7; i++) last = await b.login('dev1', 'wrong-password-' + i); ok(last.s === 429 && last.j.error === 'locked' && last.h.get('retry-after'), 'brute force: account locks after repeated failures (429 + Retry-After)'); r = await b.login('dev1', PW); ok(r.s === 429, 'correct password is still refused while locked'); }

console.log('Players + moderation (enforced by the game server)');
const p1 = await ws('eu-1', { name: 'Griefer' }), w1 = await p1.wait('welcome'), p2 = await ws('eu-1', { name: 'Victim' }), w2 = await p2.wait('welcome');
ok(w1 && w2 && w1.build && w1.flags, 'two players joined; welcome carries build id + feature flags');
r = await modC.get('/players?q=grief'); const g = r.j.items[0]; ok(r.s === 200 && g && g.status === 'online' && g.server === 'eu-1', 'player search finds the online player');
r = await modC.post(`/players/${g.id}/warn`, { reason: 'x' }); ok(r.s === 400 && r.j.error === 'reason_required', 'moderation needs a reason');
r = await modC.post(`/players/${g.id}/warn`, { reason: 'Stop destroying bases' }); await sleep(200); ok(r.s === 200 && p1.msgs.some(m => m.t === 'chat' && /WARNING/.test(m.msg)), 'warn reaches the player in game');
r = await modC.post(`/players/${g.id}/mute`, { reason: 'Spam in chat', minutes: 5 }); p1.send({ t: 'chat', msg: 'hello all' }); await sleep(400); ok(r.s === 200 && !p2.msgs.some(m => m.t === 'chat' && m.msg === 'hello all') && p1.msgs.some(m => m.t === 'chat' && /muted/.test(m.msg)), 'muted player\'s chat is dropped by the server');
p2.send({ t: 'chat', msg: '/report Griefer he is cheating with speed hack' }); await sleep(400); ok(p2.msgs.some(m => m.t === 'chat' && /Report R-\d{6}/.test(m.msg)), 'in-game /report creates a report');
r = await modC.post(`/players/${g.id}/ban`, { reason: 'Cheating', hours: 1 }); ok(r.s === 400 && r.j.error === 'confirm_required', 'ban needs explicit confirmation');
r = await modC.post(`/players/${g.id}/ban`, { reason: 'Cheating', hours: 1, confirm: true }); const rej = await p1.wait('reject'); ok(r.s === 200 && r.j.ban.until > Date.now() && rej && rej.code === 'kicked', 'temp ban kicks the player and stores a real expiry');
const p1b = await ws('eu-2', { name: 'Griefer', token: w1.token }), rej2 = await p1b.wait('reject'); ok(rej2 && rej2.code === 'banned' && /Cheating/.test(rej2.msg), 'banned token is rejected on every server (server-side ban)');
r = await modC.post(`/players/${g.id}/unban`, { reason: 'Appeal accepted' }); const p1c = await ws('eu-2', { name: 'Griefer', token: w1.token }); ok(r.s === 200 && await p1c.wait('welcome'), 'unban lets the player back in'); p1c.ws.close();
r = await modC.get(`/players/${g.id}`); ok(r.j.history.length >= 4 && r.j.history.every(h => h.by === 'mod1' && h.reason && h.at), 'moderation history keeps moderator, reason and timestamp');

console.log('Reports + tickets');
r = await modC.get('/reports?status=open'); const rep = r.j.items[0]; ok(rep && rep.target.name === 'Griefer' && rep.reporter.name === 'Victim' && rep.category === 'cheating' && rep.evidence && typeof rep.evidence.distance === 'number', 'report has reporter, target, category and server-captured evidence');
r = await modC.patch('/reports/' + rep.id, { status: 'resolved' }); ok(r.s === 400 && r.j.error === 'note_required', 'resolving needs a note');
r = await modC.patch('/reports/' + rep.id, { status: 'escalated', priority: 'high', assignee: 'adam', note: 'Needs an admin look' }); ok(r.s === 200 && r.j.report.status === 'escalated' && r.j.report.trail.length === 2, 'escalate + assign + audit trail');
r = await pub('/api/tickets', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ subject: 'Update fails', message: 'The launcher shows ARVEX-U003 every time.', category: 'update', code: 'ARVEX-U003', launcher: VERSION }) }); const tk = r.j; ok(r.s === 201 && /^T-\d{6}$/.test(tk.id) && tk.key, 'player opens a support ticket and gets a private key');
r = await pub(`/api/tickets/${tk.id}?key=wrong`); ok(r.s === 404, 'ticket cannot be read without its key');
r = await sup.post(`/tickets/${tk.id}/reply`, { message: 'internal: looks like a CDN miss', internal: true }); r = await sup.post(`/tickets/${tk.id}/reply`, { message: 'Please run Repair from the launcher.' });
r = await pub(`/api/tickets/${tk.id}?key=${tk.key}`); ok(r.j.messages.length === 2 && r.j.status === 'pending' && !JSON.stringify(r.j).includes('CDN miss'), 'player sees the staff reply, never the internal note');
r = await sup.patch('/tickets/' + tk.id, { status: 'closed' }); r = await sup.patch('/tickets/' + tk.id, { status: 'open' }); ok(r.j.ticket.status === 'open', 'ticket close + reopen');

console.log('Announcements + changelog → launcher feeds');
r = await adminC.post('/announcements', { title: ['اختبار', 'Double XP weekend'], short: ['', 'Earn twice the XP until Sunday.'], body: ['', 'Details'], tag: 'event', priority: 3 }); const ann = r.j.announcement;
ok(r.s === 200 && ann.status === 'draft' && !(await pub('/api/news')).j.news.some(n => n.id === ann.id), 'draft announcement is not public');
r = await adminC.post(`/announcements/${ann.id}/publish`); const news = (await pub('/api/news')).j.news; ok(news[0].id === ann.id, 'published announcement is first in /api/news (priority order)');
r = await adminC.patch('/announcements/' + ann.id, { expiresAt: Date.now() + 400, publishAt: null }); await sleep(600); ok(!(await pub('/api/news')).j.news.some(n => n.id === ann.id), 'expired announcement disappears');
r = await adminC.post('/announcements', { title: ['', 'Scheduled post'], publishAt: Date.now() + 500 }); const sch = r.j.announcement; await adminC.post(`/announcements/${sch.id}/schedule`); const before = (await pub('/api/news')).j.news.some(n => n.id === sch.id); await sleep(700); ok(!before && (await pub('/api/news')).j.news.some(n => n.id === sch.id), 'scheduled announcement goes live at its time');
const HOT = VERSION.replace(/\d+$/, n => +n + 1); r = await dev.post('/changelog', { version: HOT, summary: 'Hotfix', fixes: ['Fixed a crash on load'], knownIssues: ['Rain is loud'] }); ok(r.s === 200 && !(await pub('/api/versions')).j.versions.some(v => v.version === HOT), 'draft changelog entry is not public');
await dev.post('/changelog/' + HOT + '/publish'); r = await pub('/api/versions'); ok(r.j.versions[0].version === HOT && r.j.versions[0].fixes[0] === 'Fixed a crash on load' && r.j.current === VERSION, 'published changelog reaches /api/versions');
await dev.post('/changelog/' + HOT + '/unpublish'); await dev.del('/changelog/' + HOT, { confirm: true });

console.log('Release pipeline: draft → upload → verify → QA → approve → publish → rollback');
const man0 = (await pub('/launcher/manifest.json')).j; ok(man0.version === VERSION && man0.buildId && man0.files.length > 10 && man0.files.every(f => /^[a-f0-9]{64}$/.test(f.sha256) && f.size > 0), 'bundled build is the active stable release with a full hashed manifest');
r = await dev.post('/releases', { version: '9.0.0', channel: 'stable' }); ok(r.s === 200, 'draft created'); await dev.del('/releases/' + r.j.release.id, { confirm: true, reason: 'test cleanup' });
r = await dev.post('/releases', { version: VERSION.replace(/\d+$/, n => +n + 1), channel: 'stable', base: man0.buildId, summary: 'Test release' }); const rel = r.j.release; ok(r.s === 200 && rel.status === 'draft' && rel.files === man0.files.length, 'draft based on the active build copies its files');
r = await dev.req('PUT', `/releases/${rel.id}/files?path=../../etc/passwd`, Buffer.from('x'), true); ok(r.s === 400 && r.j.error === 'bad_path', 'path traversal in an upload is refused');
r = await dev.post(`/releases/${rel.id}/status`, { to: 'qa' }); ok(r.s === 409, 'cannot skip stages (draft → qa)');
await dev.post(`/releases/${rel.id}/status`, { to: 'testing' }); r = await dev.post(`/releases/${rel.id}/status`, { to: 'qa' }); ok(r.s === 409 && r.j.error === 'not_verified', 'cannot reach QA before verification');
r = await dev.post(`/releases/${rel.id}/verify`); ok(r.s === 200 && r.j.ok === false && r.j.problems.some(p => /build\.json/.test(p)), 'verify catches the version mismatch in build.json');
const newBuild = JSON.stringify({ product: 'ARVEX SURVIVAL', version: rel.version, id: rel.id }), marker = Buffer.from('/* hotfix ' + Date.now() + ' */');
await dev.req('PUT', `/releases/${rel.id}/files?path=build.json`, Buffer.from(newBuild), true); r = await dev.req('PUT', `/releases/${rel.id}/files?path=hotfix.js`, marker, true); ok(r.s === 200 && r.j.file.sha256 === crypto.createHash('sha256').update(marker).digest('hex'), 'upload returns the server-computed SHA-256');
r = await dev.post(`/releases/${rel.id}/verify`); ok(r.j.ok === true, 'verify passes');
await dev.post(`/releases/${rel.id}/status`, { to: 'qa' }); r = await dev.post(`/releases/${rel.id}/publish`, { confirm: true }); ok(r.s === 409 && r.j.error === 'not_approved', 'cannot publish before approval');
await dev.post(`/releases/${rel.id}/status`, { to: 'approved' }); r = await dev.req('PUT', `/releases/${rel.id}/files?path=late.js`, Buffer.from('late'), true); ok(r.s === 409 && r.j.error === 'locked', 'files are locked once the release leaves testing');
r = await dev.get(`/patches?from=${encodeURIComponent(man0.buildId)}&to=${encodeURIComponent(rel.id)}`); ok(r.j.patch.files.length === 2 && r.j.patch.size < r.j.patch.fullSize / 100, `patch is a real delta: ${r.j.patch.files.length} files, ${r.j.patch.size} bytes instead of ${r.j.patch.fullSize}`);
r = await dev.get(`/patches?from=${encodeURIComponent(rel.id)}&to=${encodeURIComponent(man0.buildId)}`); ok(r.s === 400 && r.j.error === 'wrong_base', 'patch refuses a base newer than its target');
r = await dev.post(`/releases/${rel.id}/publish`, { confirm: true, mandatory: true }); ok(r.s === 200 && r.j.release.status === 'published' && r.j.release.activeOn.includes('stable'), 'published');
const man1 = (await pub('/launcher/manifest.json')).j; ok(man1.version === rel.version && man1.buildId === rel.id && man1.mandatory === true && man1.files.some(f => f.path === 'hotfix.js'), 'launcher manifest switches to the new release at once (cache invalidated)');
const hf = man1.files.find(f => f.path === 'hotfix.js'), got = Buffer.from(await (await fetch(BASE + hf.url)).arrayBuffer()); ok(got.equals(marker), 'release file downloads byte-identical from its manifest URL');
const big = man1.files.find(f => f.gzUrl); if (big) { const gz = Buffer.from(await (await fetch(BASE + big.gzUrl)).arrayBuffer()); const z = await import('zlib'); ok(gz.length === big.compressedSize && crypto.createHash('sha256').update(z.gunzipSync(gz)).digest('hex') === big.sha256, `compressed blob matches (${big.path}: ${big.size} → ${big.compressedSize} bytes)`); }
r = await (await fetch(BASE + hf.url, { headers: { range: 'bytes=3-8' } })); ok(r.status === 206 && (await r.text()) === marker.toString().slice(3, 9), 'HTTP Range works on release files (resume)');
r = await dev.post('/releases/rollback', { channel: 'stable', confirm: true }); ok(r.s === 400 && r.j.error === 'reason_required', 'rollback needs a reason');
r = await dev.post('/releases/rollback', { channel: 'stable', confirm: true, reason: 'Crash spike after publish' }); const man2 = (await pub('/launcher/manifest.json')).j; ok(r.s === 200 && r.j.to === man0.buildId && man2.buildId === man0.buildId, 'rollback restores the previous release for the launcher');
r = await dev.get('/releases/' + rel.id); ok(r.j.release.status === 'archived', 'rolled-back release is archived');

console.log('Remote config: maintenance, force update, minimum version, feature flags');
r = await adminC.patch('/config', { maintenance: { on: true, message: ['', ''] } }); ok(r.s === 400, 'maintenance needs a message');
r = await adminC.patch('/config', { maintenance: { on: true, message: ['صيانة', 'Upgrading the database'], until: Date.now() + 3600e3 } }); const cfgP = (await pub('/api/config')).j; ok(r.s === 200 && cfgP.maintenance.on && cfgP.maintenance.message[1] === 'Upgrading the database' && cfgP.maintenance.until, 'maintenance is public in /api/config with message + end time');
const pm = await ws('eu-3', { name: 'Late' }), rm = await pm.wait('reject'); ok(rm && rm.code === 'maintenance' && (await p2.wait('reject', 1500)), 'maintenance blocks new joins and removes online players');
await adminC.patch('/config', { maintenance: { on: false } });
r = await adminC.patch('/config', { forceUpdate: { on: true, reason: ['', 'Security fix'] } }); ok(r.s === 400 && r.j.error === 'confirm_required', 'force update needs confirmation');
r = await adminC.patch('/config', { forceUpdate: { on: true, reason: ['', 'Security fix'] }, confirm: true }); ok(r.s === 200 && (await pub('/launcher/manifest.json')).j.mandatory === true, 'force update makes the manifest mandatory');
await adminC.patch('/config', { forceUpdate: { on: false } });
r = await adminC.patch('/config', { minVersion: '99.0.0' }); ok(r.s === 400 && r.j.error === 'min_too_high', 'minimum version cannot exceed the published release');
r = await adminC.patch('/config', { flags: { nope: true } }); ok(r.s === 400 && r.j.error === 'unknown_flag', 'unknown feature flag is refused');
r = await adminC.patch('/config', { flags: { weather: false } }); ok((await pub('/api/config')).j.flags.weather === false, 'feature flag change is public'); await adminC.patch('/config', { flags: { weather: true } });
const old = await ws('eu-3', { name: 'Old', version: '1.2.0' }), ro = await old.wait('reject'); ok(ro && ro.code === 'version', 'client below the minimum supported version is refused by the game server');

console.log('Servers, dashboard, health, logs, audit');
r = await dev.post('/servers/eu-4/restart', { inSeconds: 600, reason: 'Apply config', confirm: true }); ok(r.s === 200 && r.j.servers.find(s => s.id === 'eu-4').nextRestart < 601e3, 'server restart is scheduled on the real shard');
r = await dev.post('/servers/eu-4/lock', { on: true }); const lk = await ws('eu-4', { name: 'Locked' }), rl = await lk.wait('reject'); ok(rl && rl.code === 'locked', 'locked server refuses players'); await dev.post('/servers/eu-4/lock', { on: false });
r = await owner.get('/dashboard'); ok(r.s === 200 && r.j.version === VERSION && r.j.buildId === man0.buildId && r.j.activeRelease.id === man0.buildId && r.j.health.database.ok && r.j.health.cdn.ok && Array.isArray(r.j.alerts) && r.j.servers.length === 4, 'dashboard: version, build, active release, health and alerts are consistent');
await pub('/api/telemetry', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ kind: 'launcher', code: 'ARVEX-U003', message: 'hash mismatch', version: VERSION, password: 'hunter2' }) });
r = await dev.get('/errors'); ok(r.j.items[0].code === 'ARVEX-U003' && !JSON.stringify(r.j).includes('hunter2'), 'launcher error report shows up for staff; unknown fields are not stored');
r = await owner.get('/audit?size=100'); const acts = r.j.items.map(e => e.action); ok(['auth.login', 'staff.create', 'moderation.tempban', 'release.publish', 'release.rollback', 'config.update', 'access.denied'].every(a => acts.includes(a)), 'audit log recorded logins, staff, moderation, release, config and denied access');
ok(r.j.items.every(e => e.actor && e.ts && e.hash && e.prev) && !JSON.stringify(r.j).includes(PW), 'audit entries carry actor/time/hash chain and never a password');
r = await owner.get('/audit/verify'); ok(r.j.ok === true && r.j.entries > 20, `audit hash chain verifies (${r.j.entries} entries)`);
r = await owner.req('DELETE', '/audit'); ok(r.s === 405 || r.s === 404, 'there is no API to delete or edit the audit log');
r = await owner.get('/search?q=grief'); ok(r.j.players.length === 1 && r.j.reports.length === 1, 'global search covers players and reports');
r = await owner.post('/backups'); ok(r.s === 200 && r.j.backup.result === 'ok' && r.j.backup.files > 3, 'backup snapshot created');
{ let last; for (let i = 0; i < 25; i++) last = await pub('/api/telemetry', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ kind: 'game', code: 'X' }) }); ok(last.s === 429, 'public endpoints are rate limited (429)'); }
for (const c of [p2, pm, old, lk, p1, p1b]) try { c.ws.close(); } catch (e) {}
console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
