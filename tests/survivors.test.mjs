// ARVEX SURVIVAL — survivors and base rules over the real protocol: run against a live server.
//   node tests/survivors.test.mjs http://127.0.0.1:8096      (run-all starts it with two servers: s-pvp max 60, s-pve max 100)
import WebSocket from 'ws';
const BASE = process.argv[2] || 'http://127.0.0.1:8096', WS = BASE.replace(/^http/, 'ws') + '/ws';
const VERSION = JSON.parse(await (await import('fs')).promises.readFile(new URL('../package.json', import.meta.url))).version;
let pass = 0, fail = 0; const ok = (c, m) => { if (c) { pass++; console.log('  ✓', m); } else { fail++; console.log('  ✗', m); } };
const sleep = ms => new Promise(r => setTimeout(r, ms));
function client(server, hello) {
  return new Promise(res => {
    const ws = new WebSocket(WS + '?server=' + server), c = { ws, msgs: [], on: [] };
    c.send = m => ws.send(JSON.stringify(m)); c.op = op => c.send({ t: 'op', op });
    /** next message matching the test that arrives from now on (or is already there after index `from`) */
    c.next = (test, ms = 5000, from = c.msgs.length) => new Promise(r => { const f = c.msgs.slice(from).find(test); if (f) return r(f); const e = { test, r }; c.on.push(e); setTimeout(() => { c.on = c.on.filter(x => x !== e); r(null); }, ms); });
    ws.on('message', d => { let m = JSON.parse(d); if (m.t === 'ops') { for (const op of m.ops || m.list || []) { const o = { t: 'op', op }; c.msgs.push(o); for (const e of c.on.slice()) if (e.test(o)) { c.on = c.on.filter(x => x !== e); e.r(o); } } return; } c.msgs.push(m); for (const e of c.on.slice()) if (e.test(m)) { c.on = c.on.filter(x => x !== e); e.r(m); } });
    ws.on('open', () => { c.send(Object.assign({ t: 'hello', version: VERSION, name: 'Tester' }, hello)); res(c); });
  });
}
const servers = async () => (await (await fetch(BASE + '/api/servers')).json());
for (let i = 0; i < 120; i++) { const d = await servers(); if (d.servers.every(s => s.status === 'online')) break; await sleep(500); }
await sleep(1500);

console.log('Counts: real players and survivors are separate numbers');
const d0 = await servers(), pvp = d0.servers.find(s => s.mode === 'pvp'), pve = d0.servers.find(s => s.mode === 'pve');
ok(pvp.survivorSeats === 40 && pve.survivorSeats === 80, `seats follow capacity: a server of 60 holds ${pvp.survivorSeats} survivors, a server of 100 holds ${pve.survivorSeats}`);
ok(pvp.players === 0 && pve.players === 0 && d0.total === 0, 'with nobody connected the player counts are 0 (survivors are not counted as players)');
ok(pvp.survivors > 0 && pvp.survivors <= pvp.survivorSeats && pve.survivors > 0 && pve.survivors <= pve.survivorSeats, `survivors in the world right now: ${pvp.survivors} and ${pve.survivors}`);
ok(d0.tick && typeof d0.tick.ms === 'number' && typeof d0.tick.scale === 'number' && d0.survivors === pvp.survivors + pve.survivors, `the tick governor reports itself (tick ${d0.tick.ms} ms, lag ${d0.tick.lag} ms, scale ${d0.tick.scale})`);
const h = await (await fetch(BASE + '/health')).json(); ok(h.players === 0 && h.survivors > 0, '/health separates them too');

console.log('Joining a server with survivors');
const a = await client(pvp.id, { name: 'Alpha' }), wa = await a.next(m => m.t === 'welcome', 8000, 0);
ok(wa && Array.isArray(wa.bots) && wa.bots.length >= pvp.survivors - 2 && wa.bots.every(b => b.length === 4 && typeof b[1] === 'string'), `the roster of survivors comes with the welcome (${wa && wa.bots.length} names)`);
ok(wa.counts.server === 1 && wa.counts.survivors >= 1 && Array.isArray(wa.itemIdx) && wa.base && wa.base.coreRadius === 30, 'counts: 1 player, survivors beside it; item table and base constants included');
ok(new Set(wa.bots.map(b => b[1])).size === wa.bots.length, 'survivor names are unique');
ok(!wa.snapshot.structures.some(s => 'code' in s) && !JSON.stringify(wa.snapshot.deploys).includes('"codes"'), 'no lock codes in the snapshot');
await sleep(1200); const s1 = (await servers()).servers.find(s => s.id === pvp.id);
const dS = await servers(); ok(s1.players === 1 && s1.survivors === s1.survivorTarget && s1.survivorTarget === Math.round(pvp.survivorSeats * dS.tick.scale) - 1, `a survivor gave up his seat when a real player joined (${s1.survivors} of ${pvp.survivorSeats} seats, governor at ${Math.round(dS.tick.scale * 100)}%)`);
ok(a.msgs.some(m => m.t === 'bl'), 'the client was told which survivor left');
// walk to a survivors' base (the server accepts steps of up to 40 m)
const cores = wa.snapshot.deploys.filter(d => d.item === 'base_core'); ok(cores.length >= 3, `survivor bases in the snapshot (${cores.length} cores)`);
const sp = wa.spawn, core = cores.slice().sort((p, q) => Math.hypot(p.x - sp[0], p.z - sp[2]) - Math.hypot(q.x - sp[0], q.z - sp[2]))[0];
let pos = sp.slice(); const walk = async (c, to, item = 'rock') => { for (let i = 0; i < 80; i++) { const dx = to[0] - pos[0], dz = to[2] - pos[2], L = Math.hypot(dx, dz); if (L < 1) break; const s = Math.min(30, L); pos = [pos[0] + dx / L * s, to[1], pos[2] + dz / L * s]; c.send({ t: 'st', p: pos, yaw: 0, pitch: 0, spd: 5, item }); await sleep(25); } };
await walk(a, [core.x + 40, core.y, core.z]); const from = a.msgs.length; await sleep(1500);
const bs = a.msgs.slice(from).filter(m => m.t === 'bs'), ids = new Set(); for (const m of bs) for (const e of m.l) ids.add(e[0]);
ok(bs.length >= 5 && ids.size >= 1, `survivor states stream in near a base (${bs.length} messages in 1.5 s, ${ids.size} survivors)`);
ok(bs.every(m => m.l.every(e => e.length === 9 && e.slice(1, 5).every(Number.isFinite))), 'each state is [n, x, y, z, yaw, flags, speed, item, pitch]');
ok([...ids].every(n => wa.bots.some(b => b[0] === n) || a.msgs.some(m => m.t === 'bj' && m.b[0] === n)), 'every survivor seen was announced by name first');

console.log('Fighting and raiding survivors');
// stand at the base with a rifle and shoot the nearest survivor
await walk(a, [core.x + 9, core.y, core.z], 'semi_rifle'); const f2 = a.msgs.length; let tgt = null; const hold = () => a.send({ t: 'st', p: pos, yaw: 0, pitch: 0, spd: 0, item: 'semi_rifle' });
for (let i = 0; i < 100 && !tgt; i++) { hold(); await sleep(100); for (const m of a.msgs.slice(f2)) if (m.t === 'bs') for (const e of m.l) if (!(e[5] & 8) && Math.hypot(e[1] - pos[0], e[3] - pos[2]) < 60) tgt = e; }
ok(!!tgt, 'a living survivor is within rifle range of the base');
// provoke him with light hits: he (and whoever is with him) turns on the player
let react = null; for (let i = 0; i < 160 && !react; i++) { hold(); if (i % 4 === 0) { a.send({ t: 'fx', k: 'gun', g: 'rifle', p: pos }); a.send({ t: 'hitPlayer', id: 'b' + tgt[0], dmg: 4, kind: 'bullet' }); } await sleep(250); react = a.msgs.slice(f2).find(m => m.t === 'hurt' || m.t === 'bfx'); }
ok(!!react, `a survivor who is shot at fights back (${react ? (react.t === 'hurt' ? 'the player was hit for ' + react.dmg : 'he returned fire') : 'nothing in 40 s'})`);
let dead = false; for (let i = 0; i < 60 && !dead && tgt; i++) { hold(); a.send({ t: 'hitPlayer', id: 'b' + tgt[0], dmg: 42, kind: 'bullet' }); await sleep(260); for (const m of a.msgs.slice(-14)) if (m.t === 'bs') for (const e of m.l) if (e[0] === tgt[0] && (e[5] & 8)) dead = true; if (a.msgs.some(m => m.t === 'killed')) dead = true; }
ok(dead, 'a survivor can be shot dead by a player');
const kd = a.msgs.find(m => m.t === 'killed'); ok(!!kd, `the kill is credited to the player (${kd ? JSON.stringify(kd.name) : '-'})`);
// their wooden door: a tool barely scratches it, a powder bomb does real damage
const door = wa.snapshot.deploys.filter(d => d.item === 'wooden_door' || d.item === 'metal_door').sort((p, q) => Math.hypot(p.x - core.x, p.z - core.z) - Math.hypot(q.x - core.x, q.z - core.z))[0];
await walk(a, [door.x + 2.5, door.y, door.z], 'semi_rifle'); a.op({ t: 'depU', id: door.id, patch: { open: true } });
const dn = await a.next(m => m.t === 'deny' && m.id === door.id, 3000); ok(dn && dn.why === 'locked', 'their door is locked for strangers');
const f3 = a.msgs.length; a.op({ t: 'boom+', item: 'powder_bomb', p: [door.x, door.y + 1, door.z] });
const planted = await a.next(m => m.t === 'op' && m.op.t === 'boom+', 3000, f3); ok(!!planted, 'a powder bomb planted on the door is announced');
const boom = await a.next(m => m.t === 'op' && m.op.t === 'boom', 9000, f3); ok(!!boom && Math.abs(boom.op.p[0] - door.x) < 0.1, 'it explodes after its fuse');
await sleep(300); const dmg = a.msgs.slice(f3).find(m => m.t === 'op' && ((m.op.t === 'depU' && m.op.id === door.id && m.op.patch.hp != null) || (m.op.t === 'dep-' && m.op.id === door.id)));
ok(!!dmg, `the door took the blast (${dmg ? (dmg.op.t === 'dep-' ? 'destroyed' : 'health ' + Math.round(dmg.op.patch.hp)) : 'no change'})`);
a.ws.close(); await sleep(600);

console.log('Locks, base core and privilege between two players (PvE server)');
const p1 = await client(pve.id, { name: 'Owner' }), w1 = await p1.next(m => m.t === 'welcome', 8000, 0), p2 = await client(pve.id, { name: 'Guest' }), w2 = await p2.next(m => m.t === 'welcome', 8000, 0);
ok(w2.counts.server === 2 && w2.owner && w1.owner && w1.owner !== w2.owner, 'two players, each with his own owner id');
// a spot near the spawn that no core covers
const S = w1.spawn, taken = w1.snapshot.deploys.filter(d => d.item === 'base_core'); let spot = null;
for (let r = 4; r < 400 && !spot; r += 12) for (let k = 0; k < 8 && !spot; k++) { const x = S[0] + Math.cos(k * 0.785) * r, z = S[2] + Math.sin(k * 0.785) * r; if (taken.every(c => Math.hypot(c.x - x, c.z - z) > 50) && w1.snapshot.buildings.every(b => Math.hypot(b.x - x, b.z - z) > 30)) spot = [x, S[1], z]; }
pos = S.slice(); await walk(p1, [spot[0] + 2, spot[1], spot[2]]); const me1 = pos.slice(); pos = w2.spawn.slice(); await walk(p2, [spot[0] + 3, spot[1], spot[2] + 1]); const me2 = pos.slice();
const bid = 'tb' + Date.now().toString(36), f4 = p2.msgs.length;
p1.op({ t: 'st+', b: { id: bid, x: spot[0], y: spot[1], z: spot[2], ry: 0 }, st: { id: 'f' + bid, b: bid, piece: 'foundation', i: 0, j: 0, l: 0, hp: 99999 } });
const stp = await p2.next(m => m.t === 'op' && m.op.t === 'st+' && m.op.st.id === 'f' + bid, 4000, f4); ok(stp && stp.op.st.hp < 5000 && stp.op.st.owner === w1.owner, 'the server sets a new piece\'s health and owner (a forged health is ignored)');
p1.op({ t: 'st+', st: { id: 'dw' + bid, b: bid, piece: 'doorway', i: 0, j: 0, l: 0, side: 0 } }); p1.op({ t: 'dep+', d: { id: 'dr' + bid, item: 'wooden_door', x: spot[0], y: spot[1], z: spot[2] + 1.5, ry: 0, on: 'dw' + bid } });
p1.op({ t: 'dep+', d: { id: 'bx' + bid, item: 'storage_box', x: spot[0] + 0.6, y: spot[1], z: spot[2], ry: 0, onSt: 'f' + bid } });
ok(!!(await p2.next(m => m.t === 'op' && m.op.t === 'dep+' && m.op.d.id === 'bx' + bid, 4000, f4)), 'door and box placed');
p2.op({ t: 'depU', id: 'bx' + bid, patch: { inv: [{ id: 'wood', n: 5 }] } }); const dnb = await p2.next(m => m.t === 'deny' && m.id === 'bx' + bid, 3000); ok(!!dnb, 'PvE: a guest cannot change the owner\'s box');
p2.op({ t: 'stD', id: 'f' + bid, dmg: 50, kind: 'melee' }); await sleep(300); ok(!p2.msgs.slice(f4).some(m => m.t === 'op' && m.op.t === 'stU' && m.op.id === 'f' + bid), 'PvE: nor damage his base');
p1.op({ t: 'lock+', id: 'dr' + bid, item: 'code_lock', code: '7391' }); const lk = await p2.next(m => m.t === 'op' && m.op.t === 'depU' && m.op.id === 'dr' + bid && m.op.patch.lock, 4000, f4);
ok(lk && lk.op.patch.lock.k === 'code' && !JSON.stringify(lk).includes('7391'), 'a code lock is announced without its code');
p2.op({ t: 'depU', id: 'dr' + bid, patch: { open: true } }); const dn2 = await p2.next(m => m.t === 'deny' && m.id === 'dr' + bid, 3000); ok(dn2 && dn2.why === 'locked' && dn2.k === 'code', 'the guest is refused at the locked door');
p2.op({ t: 'lockTry', id: 'dr' + bid, code: '0000' }); const r1 = await p2.next(m => m.t === 'lockRes', 3000); ok(r1 && r1.r === 'wrong', 'wrong code');
const f5 = p2.msgs.length; p2.op({ t: 'lockTry', id: 'dr' + bid, code: '7391' }); const r2 = await p2.next(m => m.t === 'lockRes', 3000, f5); ok(r2 && r2.r === 'ok', 'right code');
p2.op({ t: 'depU', id: 'dr' + bid, patch: { open: true } }); const opn = await p1.next(m => m.t === 'op' && m.op.t === 'depU' && m.op.id === 'dr' + bid && m.op.patch.open === true, 3000); ok(!!opn, 'and the door opens for him; the owner sees it open');
// base core
p1.op({ t: 'dep+', d: { id: 'co' + bid, item: 'base_core', x: spot[0] - 0.6, y: spot[1], z: spot[2], ry: 0, onSt: 'f' + bid } }); await p2.next(m => m.t === 'op' && m.op.t === 'dep+' && m.op.d.id === 'co' + bid, 4000, f4);
const f6 = p2.msgs.length; p2.op({ t: 'st+', b: { id: 'g' + bid, x: me2[0] + 8, y: spot[1], z: me2[2] + 6, ry: 0 }, st: { id: 'gf' + bid, b: 'g' + bid, piece: 'foundation', i: 0, j: 0, l: 0 } });
const dn3 = await p2.next(m => m.t === 'deny' && m.id === 'gf' + bid, 3000, f6); ok(dn3 && dn3.why === 'priv', 'the guest cannot build inside the core\'s radius');
p1.op({ t: 'coreAuth', id: 'co' + bid }); const ci = await p1.next(m => m.t === 'coreInfo', 3000); ok(ci && ci.me === true && ci.owner === true && ci.up && ci.up.pieces >= 2 && ci.radius === 30, `the core's screen data: authorised, ${ci && ci.up.pieces} pieces protected, upkeep ${ci && JSON.stringify(ci.up.cost)}`);
p2.op({ t: 'coreAuth', id: 'co' + bid, on: true }); const ci2 = await p2.next(m => m.t === 'coreInfo', 3000); ok(ci2 && ci2.me === true && ci2.owner === false, 'an unlocked core lets the guest authorise himself');
const f7 = p1.msgs.length; p2.op({ t: 'st+', st: { id: 'gw' + bid, b: bid, piece: 'wall', i: 0, j: 0, l: 0, side: 1 } }); ok(!!(await p1.next(m => m.t === 'op' && m.op.t === 'st+' && m.op.st.id === 'gw' + bid, 3000, f7)), 'once authorised he can build on the base');
// a survivors' base on PvE can be raided by players
const bcore = w1.snapshot.deploys.filter(d => d.item === 'base_core' && String(d.owner).startsWith('B:'))[0], bst = bcore && w1.snapshot.structures.find(s => { const b = w1.snapshot.buildings.find(x => x.id === s.b); return b && Math.hypot(b.x - bcore.x, b.z - bcore.z) < 4 && s.piece === 'foundation'; });
if (bst) { pos = me1.slice(); await walk(p1, [bcore.x + 3, bcore.y, bcore.z], 'stone_hatchet'); const f8 = p1.msgs.length; for (let i = 0; i < 3; i++) { p1.op({ t: 'stD', id: bst.id, dmg: 20, kind: 'melee' }); await sleep(700); }
  ok(p1.msgs.slice(f8).some(m => m.t === 'op' && (m.op.t === 'stU' || m.op.t === 'st-') && m.op.id === bst.id), 'PvE: a survivors\' base takes damage from a player'); } else ok(false, 'no survivors\' base found on the PvE server');
p1.ws.close(); p2.ws.close(); await sleep(800);
const d9 = await servers(); ok(d9.total === 0 && d9.servers.every(s => s.players === 0), 'everyone left: player counts back to 0');
console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
