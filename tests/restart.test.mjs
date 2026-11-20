// ARVEX SURVIVAL — queue + restart-cycle test. Start a server with:
//   SERVERS_JSON='[{"id":"t-1","name":"TEST","mode":"pve","max":1,"seed":5}]' RESTART_MS=45000 node server/server.mjs
import WebSocket from 'ws';
const BASE = process.argv[2] || 'http://127.0.0.1:8092', WS = BASE.replace(/^http/, 'ws') + '/ws';
const VERSION = JSON.parse(await (await import('fs')).promises.readFile(new URL('../package.json', import.meta.url))).version;
let pass = 0, fail = 0; const ok = (c, m) => { if (c) { pass++; console.log('  ✓', m); } else { fail++; console.log('  ✗', m); } };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const client = (name) => new Promise(res => { const ws = new WebSocket(WS + '?server=t-1'), c = { ws, msgs: [] }; ws.on('message', d => c.msgs.push(JSON.parse(d))); ws.on('close', (code) => c.closed = code); ws.on('open', () => { ws.send(JSON.stringify({ t: 'hello', version: VERSION, name })); res(c); }); });
const has = (c, t) => c.msgs.find(m => m.t === t);
const status = async () => (await (await fetch(BASE + '/api/servers')).json()).servers[0];
for (let i = 0; i < 20 && (await status()).status !== 'online'; i++) await sleep(1000);
const a = await client('A'); await sleep(800); ok(has(a, 'welcome'), 'A admitted');
ok((await status()).status === 'full', 'server reports FULL at capacity');
const b = await client('B'); await sleep(800); const q = has(b, 'queue'); ok(q && q.pos === 1, 'B placed in queue at position 1');
a.ws.close(); await sleep(1000); ok(has(b, 'welcome'), 'B admitted automatically when a slot frees');
console.log('waiting for the restart cycle…');
let warned = false, kicked = false, sawRestarting = false;
for (let i = 0; i < 70 && !kicked; i++) { await sleep(1000); if (b.msgs.some(m => m.t === 'restart')) warned = true; if (b.msgs.some(m => m.t === 'reject' && m.code === 'restart')) kicked = true; }
ok(warned, 'pre-restart warnings broadcast'); ok(kicked, 'players saved and disconnected with code "restart"');
const s1 = await status(); sawRestarting = s1.status === 'restarting'; ok(sawRestarting, 'status RESTARTING during the grace period');
let back = false; for (let i = 0; i < 60 && !back; i++) { await sleep(1000); const s = await status(); if (s.status === 'online') back = true; }
const s2 = await status(); ok(back && s2.uptime < 60000, `server back ONLINE with fresh uptime (${Math.round(s2.uptime / 1000)}s)`); ok(s2.nextRestart > 30000, 'next restart scheduled a full cycle later');
console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
