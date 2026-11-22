// ARVEX — runs every backend suite against fresh servers (each suite gets its own data directory and port).
//   node tests/run-all.mjs            rules/survivors simulation + admin + server + survivors (network) + restart suites
//   node tests/run-all.mjs --launcher also builds the launcher for this OS and runs the launcher + update suite
import { spawn, spawnSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
const OWNER = 'test-owner-key-123', root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function withServer(port, env, fn) {
  const data = fs.mkdtempSync(path.join(os.tmpdir(), 'arvex-test-'));
  const srv = spawn(process.execPath, ['server/server.mjs'], { cwd: root, env: Object.assign({}, process.env, { PORT: String(port), DATA_DIR: data, ADMIN_KEY: OWNER, LOG_LEVEL: 'warn' }, env), stdio: ['ignore', 'ignore', 'inherit'] });
  try { for (let i = 0; i < 80; i++) { try { const r = await fetch(`http://127.0.0.1:${port}/api/ping`); if (r.ok) break; } catch (e) {} await sleep(250); } return await fn(`http://127.0.0.1:${port}`, data); }
  finally { srv.kill('SIGTERM'); await sleep(300); fs.rmSync(data, { recursive: true, force: true }); }
}
const run = (file, args) => spawnSync(process.execPath, [path.join('tests', file), ...args], { cwd: root, stdio: 'inherit' }).status === 0;
const results = {};
results.sim = run('sim.test.mjs', []);   // base rules and survivors, straight against the server's classes
results.admin = await withServer(8093, {}, async base => { await sleep(13000); return run('admin.test.mjs', [base, OWNER]); });
results.server = await withServer(8094, {}, async base => run('server.test.mjs', [base]));
results.survivors = await withServer(8096, { SERVERS_JSON: JSON.stringify([{ id: 's-pvp', name: 'T PVP', mode: 'pvp', max: 60, seed: 40977 }, { id: 's-pve', name: 'T PVE', mode: 'pve', max: 100, seed: 5 }]) }, async base => run('survivors.test.mjs', [base]));
results.restart = await withServer(8095, { RESTART_MS: '45000', SERVERS_JSON: JSON.stringify([{ id: 't-1', name: 'TEST #1', mode: 'pve', max: 1, seed: 5 }]) }, async base => run('restart.test.mjs', [base]));
if (process.argv.includes('--launcher')) { // the launcher suite starts its own backend; it needs the Go toolchain to build the launcher for this OS
  const bin = path.join(os.tmpdir(), 'arvex-launcher-test'), ver = JSON.parse(fs.readFileSync(path.join(root, 'package.json'))).version;
  const b = spawnSync('go', ['build', '-ldflags', `-X main.launcherVersion=${ver}`, '-o', bin, '.'], { cwd: path.join(root, 'launcher'), stdio: 'inherit' });
  results.launcher = b.status === 0 && spawnSync(process.execPath, ['tests/launcher.test.mjs'], { cwd: root, stdio: 'inherit', env: Object.assign({}, process.env, { LAUNCHER_BIN: bin }) }).status === 0;
}
console.log('\n' + Object.entries(results).map(([k, v]) => `${k}: ${v ? 'PASS' : 'FAIL'}`).join(' · '));
process.exit(Object.values(results).every(Boolean) ? 0 : 1);
