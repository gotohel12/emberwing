// ARVEX SURVIVAL build: bundle ES modules into public/game.js and stamp the version everywhere
import { build } from '/opt/npm-tools/node_modules/esbuild/lib/main.js';
import fs from 'fs';
const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
const dev = process.argv.includes('--dev');
await build({ entryPoints: ['src/main.js'], bundle: true, format: 'iife', target: ['es2019'], minify: !dev, sourcemap: dev ? 'inline' : false, outfile: 'public/game.js', legalComments: 'none', banner: { js: `/* ARVEX SURVIVAL ${pkg.version} © 2026 ARVEX — Mohsen ~ Danial */` } });
for (const f of ['public/sw.js']) fs.writeFileSync(f, fs.readFileSync(f, 'utf8').replace(/const VERSION = '[^']*'/, `const VERSION = 'arvex-${pkg.version}'`));
const m = fs.readFileSync('src/main.js', 'utf8'); if (!m.includes(`const VERSION = '${pkg.version}'`)) fs.writeFileSync('src/main.js', m.replace(/const VERSION = '[^']*'/, `const VERSION = '${pkg.version}'`));
console.log('built public/game.js', (fs.statSync('public/game.js').size / 1024).toFixed(0) + ' KB', 'v' + pkg.version);
