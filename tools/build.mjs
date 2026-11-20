// ARVEX build: bundles the game, stamps one version + build id everywhere, writes public/build.json.
//   node tools/build.mjs          release build (minified, no developer features)
//   node tools/build.mjs --dev    development build (source maps, developer overlay enabled)
// package.json "version" is the single source of truth. The build id is derived from the content of the
// sources and assets, so the same tree always produces the same build id (reproducible builds).
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
let esbuild; try { esbuild = require('esbuild'); } catch (e) { esbuild = require('/opt/npm-tools/node_modules/esbuild'); }

const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8')), dev = process.argv.includes('--dev');
const versions = JSON.parse(fs.readFileSync('server/versions.json', 'utf8'));
const entry = (versions.versions || []).find(v => v.version === pkg.version);
const GENERATED = new Set(['public/game.js', 'public/build.json', 'public/sw.js']);
function walk(dir, out = []) { for (const e of fs.readdirSync(dir, { withFileTypes: true })) { const p = path.posix.join(dir, e.name); if (e.isDirectory()) { if (p !== 'public/download') walk(p, out); } else if (!GENERATED.has(p)) out.push(p); } return out; }
const h = crypto.createHash('sha256');
for (const f of [...walk('src'), ...walk('public')].sort()) { h.update(f + '\0'); h.update(fs.readFileSync(f)); h.update('\0'); }
h.update(dev ? 'dev' : 'release');
const build = { product: 'ARVEX SURVIVAL', version: pkg.version, id: `${pkg.version}-${h.digest('hex').slice(0, 10)}${dev ? '-dev' : ''}`, date: (entry && entry.date) || new Date().toISOString().slice(0, 10), channel: dev ? 'development' : 'stable', mode: dev ? 'development' : 'release', minVersion: versions.minVersion || pkg.version };

await esbuild.build({ entryPoints: ['src/main.js'], bundle: true, format: 'iife', target: ['es2019'], minify: !dev, sourcemap: dev ? 'inline' : false, outfile: 'public/game.js', legalComments: 'none',
  define: { __ARVEX_VERSION__: JSON.stringify(build.version), __ARVEX_BUILD__: JSON.stringify(build.id), __ARVEX_DATE__: JSON.stringify(build.date), __ARVEX_DEV__: String(dev) },
  banner: { js: `/* ARVEX SURVIVAL ${build.version} (${build.id}) © 2026 ARVEX — Mohsen ~ Danial */` } });
fs.writeFileSync('public/build.json', JSON.stringify(build, null, 1) + '\n');
fs.writeFileSync('public/sw.js', fs.readFileSync('public/sw.js', 'utf8').replace(/const VERSION = '[^']*'/, `const VERSION = 'arvex-${build.id}'`));
const size = f => (fs.statSync(f).size / 1024).toFixed(0) + ' KB';
console.log(`built ARVEX ${build.version} · build ${build.id} · ${build.mode} · game.js ${size('public/game.js')}`);
