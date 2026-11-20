// ARVEX SURVIVAL — backend protocol test: run against a live server.  node tests/server.test.mjs http://127.0.0.1:8091
import WebSocket from 'ws';
const BASE = process.argv[2] || 'http://127.0.0.1:8091', WS = BASE.replace(/^http/, 'ws') + '/ws';
const VERSION = JSON.parse(await (await import('fs')).promises.readFile(new URL('../package.json', import.meta.url))).version;
let pass = 0, fail = 0; const ok = (c, m) => { if (c) { pass++; console.log('  ✓', m); } else { fail++; console.log('  ✗', m); } };
const sleep = ms => new Promise(r => setTimeout(r, ms));
function client(server, hello) {
  return new Promise((res) => {
    const ws = new WebSocket(WS + '?server=' + server), c = { ws, msgs: [], on: {} };
    c.send = m => ws.send(JSON.stringify(m)); c.wait = (t, ms = 4000) => new Promise((r, j) => { const f = c.msgs.find(m => m.t === t); if (f) return r(f); const to = setTimeout(() => r(null), ms); c.on[t] = m => { clearTimeout(to); r(m); }; });
    ws.on('message', d => { const m = JSON.parse(d); c.msgs.push(m); if (c.on[m.t]) { const f = c.on[m.t]; delete c.on[m.t]; f(m); } });
    ws.on('open', () => { c.send(Object.assign({ t: 'hello', version: VERSION, name: 'Tester' }, hello)); res(c); });
  });
}
console.log('API');
const sv = await (await fetch(BASE + '/api/servers')).json(); ok(sv.servers.length >= 2, `server list (${sv.servers.length} servers)`);
ok(sv.servers.every(s => ['id', 'name', 'status', 'players', 'max', 'map', 'mode', 'region', 'version', 'uptime', 'nextRestart'].every(k => k in s)), 'server cards have every field');
const restarts = sv.servers.map(s => s.nextRestart); ok(new Set(restarts.map(r => Math.round(r / 1000))).size === restarts.length, 'restart times are staggered (never simultaneous)');
await sleep(13000);
const target = (await (await fetch(BASE + '/api/servers')).json()).servers.find(s => s.status === 'online' && s.nextRestart > 40000) || sv.servers[0];
console.log('Join + world sync on', target.id);
const a = await client(target.id, { name: 'Alpha' }); const wa = await a.wait('welcome'); ok(wa && wa.token && wa.seed, 'player A admitted (token + seed + snapshot)');
ok(wa && wa.snapshot && Array.isArray(wa.snapshot.animals) && wa.snapshot.animals.length > 0, `server-simulated animals in snapshot (${wa ? wa.snapshot.animals.length : 0})`);
const b = await client(target.id, { name: 'Bravo' }); const wb = await b.wait('welcome'); ok(wb && wb.counts.server === 2, 'player B admitted, server count = 2');
const j = await a.wait('join'); ok(j && j.name === 'Bravo', 'A notified when B joins');
const sp = wa.spawn; a.send({ t: 'st', p: sp, yaw: 1, pitch: 0, spd: 3 }); await sleep(400);
const ps = b.msgs.filter(m => m.t === 'ps').pop(); ok(ps && ps.list.some(x => x.id === wa.id), 'B receives A\'s live position (10 Hz)');
const bid = 'btest' + Date.now(); a.send({ t: 'op', op: { t: 'st+', b: { id: bid, x: sp[0] + 3, y: sp[1], z: sp[2], ry: 0 }, st: { id: 's' + bid, b: bid, piece: 'foundation', i: 0, j: 0, l: 0, hp: 12 } } });
const opB = await b.wait('op'); ok(opB && opB.op.t === 'st+' && opB.op.st.piece === 'foundation', 'structure placed by A is broadcast to B');
b.send({ t: 'op', op: { t: 'st-', id: 's' + bid } }); await sleep(300); ok(!b.msgs.some(m => m.t === 'op' && m.op.t === 'st-'), 'B cannot demolish A\'s structure (ownership)');
a.send({ t: 'chat', msg: 'hello ARVEX' }); const ch = await b.wait('chat'); ok(ch && (ch.msg === 'hello ARVEX' || ch.sys), 'chat relayed');
a.send({ t: 'ping', k: 1 }); const pong = await a.wait('pong'); ok(pong && pong.counts.total >= 2 && pong.counts.servers >= 2, `live counts in pong (total ${pong && pong.counts.total})`);
console.log('Rejections');
const dup = await client(target.id, { token: wa.token, name: 'Alpha2' }); const rd = await dup.wait('reject'); ok(rd && rd.code === 'duplicate', 'same account cannot join twice (no duplicate players)');
const old = await client(target.id, { version: '0.0.1' }); const rv = await old.wait('reject'); ok(rv && rv.code === 'version', 'old game version rejected');
console.log('Playtime');
await sleep(2200); a.ws.close(); await sleep(600);
const pr = await (await fetch(BASE + '/api/profile?token=' + wa.token)).json(); ok(pr.profile && pr.profile.total >= 2 && pr.profile.sessions === 1, `server-side playtime recorded (${pr.profile && pr.profile.total}s, ${pr.profile && pr.profile.sessions} session)`);
const lv = await b.wait('leave'); ok(!!lv, 'B notified when A leaves');
const a2 = await client(target.id, { token: wa.token, name: 'Alpha' }); const wa2 = await a2.wait('welcome'); ok(wa2 && wa2.profile.total >= 2 && wa2.profile.sessions === 2, 'returning player keeps total playtime, sessions = 2');
a2.ws.close(); b.ws.close();
console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
