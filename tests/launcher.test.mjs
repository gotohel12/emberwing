// ARVEX launcher test (run the launcher with: ARVEX_SERVER=http://127.0.0.1:8091 arvex-launcher -nowindow -data /tmp/lch)
import fs from 'fs';
const L = 'http://127.0.0.1:47330', H = { origin: L, 'content-type': 'application/json' };
let pass = 0, fail = 0; const ok = (c, m) => { if (c) { pass++; console.log('  ✓', m); } else { fail++; console.log('  ✗', m); } };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const st = async () => (await fetch(L + '/api/state', { headers: H })).json();
const post = async (p, b = {}) => (await fetch(L + '/api/' + p, { method: 'POST', headers: H, body: JSON.stringify(b) })).json();
const until = async (fn, ms = 60000) => { const t = Date.now(); let s; while (Date.now() - t < ms) { s = await st(); if (fn(s)) return s; await sleep(150); } return s; };
let s = await until(x => x.latest, 10000);
ok(s.online && s.latest === '1.2.0' && s.gameSize > 0, `connected to server, latest ${s.latest}, game size ${(s.gameSize / 1048576).toFixed(2)} MB`);
ok(!s.installed && s.updateSize === s.gameSize, 'not installed: download size = full game');
// install with a speed limit so pause/resume can be observed
await post('settings', Object.assign({}, s.settings, { speedLimitKB: 512 }));
await post('install');
s = await until(x => x.progress.phase === 'downloading' && x.progress.downloaded > 50000, 15000);
ok(s.progress.total === s.gameSize && s.progress.speed > 0 && s.progress.eta > 0, `real progress: ${(s.progress.downloaded / 1024).toFixed(0)} KB / ${(s.progress.total / 1024).toFixed(0)} KB · ${(s.progress.speed / 1024).toFixed(0)} KB/s · ETA ${s.progress.eta.toFixed(1)}s · file ${s.progress.file}`);
ok(s.progress.speed < 512 * 1024 * 1.35, 'speed limit respected');
await post('pause'); s = await until(x => x.progress.phase === 'paused', 5000); const at = s.progress.downloaded; await sleep(1500); s = await st();
ok(s.progress.phase === 'paused' && Math.abs(s.progress.downloaded - at) < 70000, 'pause holds the download');
await post('settings', Object.assign({}, s.settings, { speedLimitKB: 0 }));
await post('resume'); s = await until(x => x.progress.phase === 'done', 60000);
ok(s.progress.result === 'download_complete' && s.installed === '1.2.0', 'resume → download complete, installed 1.2.0');
const inst = s.settings.installDir; ok(fs.existsSync(inst + '/index.html') && fs.existsSync(inst + '/game.js'), 'game files installed on disk');
await post('dismiss');
// verify OK
await post('verify'); s = await until(x => x.progress.phase === 'done', 30000); ok(s.progress.result === 'verify_ok', 'verify: all files OK');
// corrupt + delete files → verify detects → repair fixes only those
fs.writeFileSync(inst + '/style.css', 'broken'); fs.rmSync(inst + '/fonts/ArvexMono-Medium.woff');
await post('dismiss'); await post('verify'); s = await until(x => x.progress.phase === 'done', 30000);
ok(s.progress.result === 'verify_bad' && s.progress.bad.length === 2, `verify detects ${s.progress.bad.length} bad files: ${s.progress.bad.join(', ')}`);
await post('dismiss'); await post('repair'); s = await until(x => x.progress.phase === 'done', 30000);
ok(s.progress.result === 'repair_complete' && s.progress.filesTotal === 2, `repair re-downloaded only ${s.progress.filesTotal} files (${s.progress.total} bytes)`);
await post('dismiss'); await post('verify'); s = await until(x => x.progress.phase === 'done', 30000); ok(s.progress.result === 'verify_ok', 'after repair: verify OK');
// resume of a partial file: drop a .part and make sure the download continues from it (HTTP Range)
console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
