// EMBERWING build: bundle ES modules into public/game.js
import { build } from '/opt/npm-tools/node_modules/esbuild/lib/main.js';
const dev = process.argv.includes('--dev');
await build({ entryPoints: ['src/main.js'], bundle: true, format: 'iife', target: ['es2019'], minify: !dev, sourcemap: dev ? 'inline' : false, outfile: 'public/game.js', legalComments: 'none', banner: { js: '/* EMBERWING © 2026 Mohsen ~ Danial */' } });
console.log('built public/game.js');
