// ARVEX — launcher + update system test. Self-contained: starts its own backend and the real launcher binary.
//   go build -o /tmp/arvex-launcher ./launcher   (tests/run-launcher.sh does this)
//   LAUNCHER_BIN=/tmp/arvex-launcher node tests/launcher.test.mjs
// Covers: fresh install, pause/resume, verify, corrupt + missing file repair, launch validation, publish → update (delta),
// mandatory update, interrupted download + resume, crash during install + recovery, low disk, server down, signed manifests
// (unsigned / wrong key refused), rollback, update lock, settings corruption + migration, uninstall.
import { spawn } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import crypto from 'crypto';
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..'), BIN = process.env.LAUNCHER_BIN || '/tmp/arvex-launcher';
const PORT = 8096, BASE = `http://127.0.0.1:${PORT}`, L = 'http://127.0.0.1:47330', H = { origin: L, 'content-type': 'application/json' }, OWNER = 'test-owner-key-123', PW = 'correct-horse-42-battery';
const VERSION = JSON.parse(fs.readFileSync(path.join(root, 'package.json'))).version;
let pass = 0, fail = 0; const ok = (c, m) => { if (c) { pass++; console.log('  ✓', m); } else { fail++; console.log('  ✗', m); } };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const tmp = n => fs.mkdtempSync(path.join(os.tmpdir(), n));
const keys = () => { const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519'); return { pub: publicKey.export({ format: 'der', type: 'spki' }).subarray(-32).toString('base64'), priv: privateKey.export({ format: 'der', type: 'pkcs8' }).toString('base64') }; };
const K = keys(), K2 = keys(), serverData = tmp('arvex-srv-'), data = tmp('arvex-lch-'), game = path.join(data, 'Game');
let srv = null, lch = null;
async function startServer(env = {}) { srv = spawn(process.execPath, ['server/server.mjs'], { cwd: root, env: Object.assign({}, process.env, { PORT: String(PORT), DATA_DIR: serverData, ADMIN_KEY: OWNER, LOG_LEVEL: 'warn', ARVEX_SIGN_KEY: K.priv }, env), stdio: ['ignore', 'ignore', 'inherit'] }); for (let i = 0; i < 100; i++) { try { if ((await fetch(BASE + '/api/ping')).ok) return; } catch (e) {} await sleep(200); } throw new Error('server did not start'); }
async function stopServer() { if (!srv) return; const p = srv; srv = null; p.kill('SIGKILL'); await new Promise(r => p.once('exit', r)); }
async function startLauncher(env = {}) { lch = spawn(BIN, ['-nowindow', '-data', data], { env: Object.assign({}, process.env, { ARVEX_SERVER: BASE, ARVEX_TEST_SIGN_PUB: K.pub }, env), stdio: 'ignore' }); lch.exited = new Promise(r => lch.once('exit', c => r(c))); for (let i = 0; i < 60; i++) { try { await st(); return; } catch (e) {} await sleep(150); } throw new Error('launcher did not start'); }
async function stopLauncher() { if (!lch) return; const p = lch; lch = null; p.kill('SIGKILL'); await p.exited; await sleep(150); }
const st = async () => (await fetch(L + '/api/state', { headers: H })).json();
const post = async (p, b = {}) => { const r = await fetch(L + '/api/' + p, { method: 'POST', headers: H, body: JSON.stringify(b) }); return { s: r.status, j: await r.json() }; };
const until = async (fn, ms = 60000) => { const t = Date.now(); let s; while (Date.now() - t < ms) { try { s = await st(); if (fn(s)) return s; } catch (e) {} await sleep(120); } return s; };
const idle = () => until(x => !x.busy && ['done', 'error', 'idle', 'offline'].includes(x.progress.phase));
const check = async () => { await post('check'); await sleep(900); return st(); };
const sha = f => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');
const installedOK = () => { const rec = JSON.parse(fs.readFileSync(path.join(game, '.arvex/installed.json'))); return Object.entries(rec.files).every(([p, h]) => fs.existsSync(path.join(game, p)) && sha(path.join(game, p)) === h); };
// ---- a tiny admin client used to publish releases the way staff would
const adm = { cookie: '', csrf: '' };
async function A(method, p, body, raw) { const h = { cookie: adm.cookie }; if (method !== 'GET') h['x-arvex-csrf'] = adm.csrf; if (body && !raw) h['content-type'] = 'application/json'; const r = await fetch(BASE + '/api/admin/v1' + p, { method, headers: h, body: raw ? body : body ? JSON.stringify(body) : undefined }); const sc = r.headers.get('set-cookie'); if (sc) adm.cookie = sc.split(';')[0]; const j = await r.json().catch(() => ({})); if (r.status >= 300) throw new Error(`${method} ${p} → ${r.status} ${JSON.stringify(j)}`); return j; }
async function adminLogin() { if ((await A('GET', '/bootstrap')).needsSetup) await A('POST', '/setup', { ownerKey: OWNER, username: 'owner', password: PW }); adm.cookie = ''; adm.csrf = (await A('POST', '/login', { username: 'owner', password: PW })).csrf; }
async function publish(version, files, opt = {}) {
  const base = (await (await fetch(BASE + '/launcher/manifest.json')).json()).buildId, rel = (await A('POST', '/releases', { version, channel: 'stable', base, summary: 'test ' + version })).release;
  await A('PUT', `/releases/${rel.id}/files?path=build.json`, Buffer.from(JSON.stringify({ product: 'ARVEX SURVIVAL', version, id: rel.id })), true);
  for (const [p, buf] of Object.entries(files)) await A('PUT', `/releases/${rel.id}/files?path=${p}`, buf, true);
  await A('POST', `/releases/${rel.id}/verify`); for (const to of ['testing', 'qa', 'approved']) await A('POST', `/releases/${rel.id}/status`, { to });
  await A('POST', `/releases/${rel.id}/publish`, { confirm: true, mandatory: !!opt.mandatory }); return rel.id;
}
const bump = n => VERSION.replace(/\d+$/, x => +x + n);

try {
  await startServer(); await adminLogin(); await startLauncher();
  console.log('Fresh install');
  let s = await until(x => x.latest, 15000);
  ok(s.online && s.latest === VERSION && s.latestBuild && s.launcher && s.gameSize > 0, `launcher reads the release: ${s.latest} build ${s.latestBuild}, ${(s.gameSize / 1048576).toFixed(1)} MB`);
  ok(s.signature === 'verified', 'manifest signature verified with the pinned Ed25519 key');
  ok(!s.installed && s.block && s.block.code === 'ARVEX-L002' && s.updateSize < s.gameSize * 0.6 && s.updateFiles > 10, `not installed; download is ${(s.updateSize / 1048576).toFixed(1)} MB compressed instead of ${(s.gameSize / 1048576).toFixed(1)} MB`);
  ok(s.disk && s.disk.free > 0, 'free disk space is reported');
  ok((await post('play')).j.error.code === 'ARVEX-L002', 'Play is refused before install (ARVEX-L002)');
  await post('settings', { speedLimitKB: 1500, concurrent: 3 }); await post('install');
  s = await until(x => x.progress.phase === 'downloading' && x.progress.downloaded > 200000, 30000);
  ok(s.progress.total === s.updateSize && s.progress.speed > 0 && s.progress.eta > 0 && s.progress.file && s.progress.filesTotal === s.updateFiles, `real progress: ${(s.progress.speed / 1024).toFixed(0)} KB/s, ETA ${s.progress.eta.toFixed(0)} s, file ${s.progress.file}`);
  ok(s.progress.speed < 1500 * 1024 * 1.6, 'speed limit applies to all parallel downloads together');
  await post('pause'); await sleep(700); const a1 = (await st()).progress.downloaded; await sleep(900); s = await st(); ok(s.progress.phase === 'paused' && s.progress.downloaded === a1, 'pause holds the download');
  await post('settings', { speedLimitKB: 0 }); await post('resume'); s = await idle();
  ok(s.progress.result === 'download_complete' && s.installed === VERSION && s.installedBuild === s.latestBuild && !s.block, 'resume → install complete; installed build = latest build');
  ok(installedOK() && fs.existsSync(path.join(game, 'index.html')) && fs.existsSync(path.join(game, 'models/arvex_models.bin')), 'every installed file matches its SHA-256 (compressed transfers were inflated correctly)');
  ok(!fs.existsSync(path.join(game, '.arvex/staging')) && !fs.existsSync(path.join(game, '.arvex/journal.json')) && !fs.existsSync(path.join(game, '.arvex/update.lock')), 'staging, journal and lock are cleaned up');
  ok((await post('play')).s === 200 && (await fetch('http://127.0.0.1:47331/build.json').then(r => r.json())).version === VERSION, 'Play serves the installed game; it reports the same version');

  console.log('Verify + repair');
  await post('verify'); s = await idle(); ok(s.progress.result === 'verify_ok', 'verify: all files OK');
  fs.appendFileSync(path.join(game, 'style.css'), '/* corrupted */'); fs.unlinkSync(path.join(game, 'fonts/ArvexMono-Medium.woff'));
  await post('verify'); s = await idle(); ok(s.progress.result === 'verify_bad' && s.progress.bad.length === 2 && s.progress.bad.some(b => /style\.css \(corrupted\)/.test(b)) && s.progress.bad.some(b => /\(missing\)/.test(b)), 'verify finds 1 corrupted + 1 missing file');
  await post('repair'); s = await idle(); ok(s.progress.result === 'repair_complete' && s.progress.filesTotal === 2, 'repair downloads only the 2 damaged files');
  await post('verify'); s = await idle(); ok(s.progress.result === 'verify_ok', 'verify OK after repair');
  fs.unlinkSync(path.join(game, 'game.js')); let r = await post('play'); ok(r.s === 400 && r.j.error.code === 'ARVEX-F001' && r.j.error.data.autoRepair === true, 'launch validation: missing game.js → ARVEX-F001, auto-repair starts');
  s = await until(x => x.progress.result === 'repair_complete' && !x.busy, 30000); ok(fs.existsSync(path.join(game, 'game.js')) && (await post('play')).s === 200, 'after auto-repair the game launches');

  console.log('Publish → detect → update (file-level delta)');
  const hot1 = Buffer.from('/* hotfix 1 */'), b1 = await publish(bump(1), { 'hotfix.js': hot1 }, { mandatory: true });
  s = await check(); s = await until(x => x.latestBuild === b1, 8000);
  ok(s.updateAvailable && s.latest === bump(1) && s.mandatory && s.updateFiles === 2 && s.updateSize < 500, `update detected: ${s.updateFiles} files, ${s.updateSize} bytes (not the full ${(s.gameSize / 1048576).toFixed(0)} MB)`);
  ok(s.block && s.block.code === 'ARVEX-A002' && (await post('play')).j.error.code === 'ARVEX-A002', 'mandatory update blocks Play (ARVEX-A002)');
  await post('update'); s = await idle(); ok(s.progress.result === 'update_complete' && s.installed === bump(1) && s.installedBuild === b1 && !s.block && fs.readFileSync(path.join(game, 'hotfix.js')).equals(hot1), 'update installs the new release; Play is unblocked');

  console.log('Interrupted download → resume');
  const big = crypto.randomBytes(40 * 1024 * 1024), b2 = await publish(bump(2), { 'data/big.bin': big });
  await post('settings', { speedLimitKB: 900, autoUpdate: false }); await check(); await post('update');
  s = await until(x => x.progress.phase === 'downloading' && x.progress.downloaded > 1200000, 20000); const before = s.progress.downloaded;
  await stopServer(); s = await until(x => /^retry:/.test(x.progress.message || ''), 15000); if (process.env.DEBUG) console.log('before', before, JSON.stringify(s.progress), fs.readFileSync(path.join(data, 'logs/launcher.log'), 'utf8').split('\n').slice(-8).join('\n')); ok(/^retry:\d+:\d+$/.test(s.progress.message) && s.busy, 'network drop: the launcher keeps the partial file and retries with backoff');
  const part = path.join(game, '.arvex/staging/data/big.bin.part'); ok(fs.existsSync(part) && fs.statSync(part).size >= before - 200000, `partial download kept on disk (${(fs.statSync(part).size / 1048576).toFixed(1)} MB)`);
  await startServer(); await post('settings', { speedLimitKB: 0 }); s = await idle();
  ok(s.progress.result === 'update_complete' && s.installedBuild === b2 && sha(path.join(game, 'data/big.bin')) === crypto.createHash('sha256').update(big).digest('hex'), 'connection back → download resumes from the partial file and the result is byte-exact');

  console.log('Crash during install → recovery');
  await adminLogin(); const b3 = await publish(bump(3), { 'a.js': Buffer.from('A3'), 'b.js': Buffer.from('B3'), 'style.css': Buffer.from('/* new style */ body{}') });
  const styleBefore = sha(path.join(game, 'style.css'));
  await stopLauncher(); await startLauncher({ ARVEX_TEST_CRASH: 'commit:2' }); await until(x => x.latestBuild === b3, 10000); await post('update'); const code = await lch.exited; lch = null;
  ok(code === 137 && fs.existsSync(path.join(game, '.arvex/journal.json')), 'launcher process died in the middle of moving files (journal left behind)');
  await startLauncher(); s = await until(x => x.latest, 10000);
  ok(s.recovered && s.installedBuild === b2 && sha(path.join(game, 'style.css')) === styleBefore && !fs.existsSync(path.join(game, 'a.js')) && installedOK(), 'next start restores the previous release completely (no half-updated install)');
  await post('dismiss'); r = await post('update'); s = await idle(); if (process.env.DEBUG) console.log(JSON.stringify(s.progress), s.installedBuild, b3, s.latestBuild, fs.readFileSync(path.join(data, 'logs/launcher.log'), 'utf8').split('\n').slice(-6).join('\n'));
  ok(s.progress.result === 'update_complete' && s.installedBuild === b3 && installedOK(), 'the update then installs cleanly');

  console.log('Failure handling');
  const b4 = await publish(bump(4), { 'c.js': crypto.randomBytes(4096) });
  await stopLauncher(); await startLauncher({ ARVEX_FAKE_FREE_BYTES: '1000' }); await until(x => x.latestBuild === b4, 10000); await post('update'); s = await idle();
  ok(s.progress.phase === 'error' && s.progress.error.code === 'ARVEX-F002' && s.progress.error.data.required > s.progress.error.data.available && s.installedBuild === b3 && installedOK(), 'low disk: stops before downloading with required/available bytes (ARVEX-F002); install untouched');
  await stopLauncher(); await startLauncher(); await until(x => x.latestBuild === b4, 10000);
  fs.mkdirSync(path.join(game, '.arvex'), { recursive: true }); fs.writeFileSync(path.join(game, '.arvex/update.lock'), JSON.stringify({ pid: process.pid, heartbeat: Math.floor(Date.now() / 1000) }));
  await post('update'); s = await idle(); ok(s.progress.error && s.progress.error.code === 'ARVEX-U004', 'a second updater on the same folder is refused (ARVEX-U004)'); fs.unlinkSync(path.join(game, '.arvex/update.lock'));
  await post('dismiss'); await stopServer(); s = await check(); s = await until(x => !x.online, 8000);
  ok(!s.online && s.error && s.error.code === 'ARVEX-N001' && s.installed && !s.block, 'server down: clear network error (ARVEX-N001), game stays playable offline');
  ok((await post('play')).s === 200, 'offline: Play still launches the installed game');
  await post('update'); s = await idle(); ok(s.progress.phase === 'offline' && s.installedBuild === b3, 'offline: update stops safely');

  console.log('Manifest security');
  await post('dismiss'); await startServer({ ARVEX_SIGN_KEY: '' }); s = await check(); s = await until(x => x.error, 8000);
  ok(s.error && s.error.code === 'ARVEX-U006' && !s.latest === false || s.error.code === 'ARVEX-U006', 'unsigned manifest from a server that used to sign → refused (ARVEX-U006)');
  await post('update'); s = await idle(); ok(s.progress.phase === 'error' && s.progress.error.code === 'ARVEX-U006' && s.installedBuild === b3, 'nothing is installed from an unsigned manifest');
  await post('dismiss'); await stopServer(); await startServer({ ARVEX_SIGN_KEY: K2.priv }); await post('update'); s = await idle();
  ok(s.progress.error && s.progress.error.code === 'ARVEX-U005' && s.installedBuild === b3, 'manifest signed with another key → refused (ARVEX-U005)');
  await post('dismiss'); await stopServer(); await startServer(); await adminLogin();

  console.log('Rollback');
  await post('update'); s = await idle(); ok(s.installedBuild === b4, 'back on the trusted server the update to the newest release works');
  const rb = await A('POST', '/releases/rollback', { channel: 'stable', confirm: true, reason: 'test rollback' }); s = await check(); s = await until(x => x.latestBuild === rb.to, 8000);
  ok(rb.to === b3 && s.updateAvailable && s.latest === bump(3), 'admin rollback: the launcher now sees the previous release as current');
  await post('update'); s = await idle(); ok(s.installedBuild === b3 && !fs.existsSync(path.join(game, 'c.js')) && installedOK(), 'launcher moves back to the rolled-back release and removes files it no longer ships');

  console.log('Maintenance, tickets, settings, uninstall');
  await A('PATCH', '/config', { maintenance: { on: true, message: ['صيانة', 'Database upgrade'], until: Date.now() + 3600e3, blockLaunch: true } }); s = await check(); s = await until(x => x.remote && x.remote.maintenance.on, 8000);
  ok(s.remote.maintenance.message[1] === 'Database upgrade' && s.block && s.block.code === 'ARVEX-A001' && (await post('play')).j.error.code === 'ARVEX-A001', 'maintenance with "block launch": message shown, Play blocked (ARVEX-A001)');
  await A('PATCH', '/config', { maintenance: { on: false } }); await check();
  r = await post('ticket', { subject: 'Launcher test ticket', category: 'launcher', message: 'This is an automated test of the support form.' }); ok(r.s === 200 && /^T-\d{6}$/.test(r.j.id), 'support ticket sent from the launcher');
  const tl = await (await fetch(L + '/api/tickets', { headers: H })).json(); ok(tl.length === 1 && tl[0].messages.length === 1 && tl[0].status === 'open', 'the ticket and its thread are shown back to the player');
  r = await fetch(L + '/api/state', { headers: { origin: 'http://evil.example' } }); ok(r.status === 403, 'another website cannot drive the launcher API');
  const log = fs.readFileSync(path.join(data, 'logs/launcher.log'), 'utf8'); ok(/INFO .*install started/.test(log) && /ERROR .*ARVEX-F002/.test(log) && /WARN .*interrupted/.test(log) && !log.includes(K.priv), 'launcher.log has INFO/WARN/ERROR entries with error codes');
  await stopLauncher(); fs.writeFileSync(path.join(data, 'settings.json'), '{ this is not json'); await startLauncher(); s = await st();
  ok(s.settings.concurrent === 3 && s.settings.autoRepair === true && fs.existsSync(path.join(data, 'settings.corrupt.json')) && s.installedBuild === b3, 'corrupt settings.json → defaults, a copy is kept, the install is still recognised');
  await stopLauncher(); fs.writeFileSync(path.join(data, 'settings.json'), JSON.stringify({ installDir: game, speedLimitKB: 256, autoUpdate: false, language: 'en', server: BASE })); await startLauncher(); s = await st();
  ok(s.settings.speedLimitKB === 256 && s.settings.language === 'en' && s.settings.concurrent === 3 && s.settings.autoRepair === true && s.settings.channel === 'stable' && s.settings.configVersion === 2, 'v1 settings file is migrated: old values kept, new keys get defaults');
  r = await post('uninstall', {}); ok(r.s === 400, 'uninstall needs confirmation');
  r = await post('uninstall', { confirm: true }); s = await st(); ok(r.s === 200 && !s.installed && !fs.existsSync(path.join(game, 'index.html')) && !fs.existsSync(path.join(game, '.arvex')) && fs.existsSync(path.join(data, 'settings.json')), 'uninstall removes the game files and keeps the launcher settings');
} catch (e) { fail++; console.log('  ✗ test aborted:', e.stack || e.message); }
finally { await stopLauncher(); await stopServer(); fs.rmSync(serverData, { recursive: true, force: true }); fs.rmSync(data, { recursive: true, force: true }); }
console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
