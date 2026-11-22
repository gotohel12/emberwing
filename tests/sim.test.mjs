// ARVEX SURVIVAL — base rules and survivors, tested directly against the server's own classes (no network, runs faster than real time).
//   node tests/sim.test.mjs
// Covers: building privilege, key and code locks, material resistance, explosives, support collapse, upkeep and decay,
// the survivors' population, their bases, long unattended runs, giving up a seat for a real player and the state stream.
import { Terrain, layoutWorld, NODE_TYPES } from '../src/world/terrain.js';
import { SimWorld } from '../server/lib/simworld.mjs';
import { Rules } from '../server/lib/rules.mjs';
import { BotSim } from '../server/lib/bots.mjs';
import { Env } from '../src/game/env.js';
import { AnimalSim } from '../src/game/animals.js';
import { ITEMS, BASE, pieceHP, deployHP, blastDamage, upkeepCost } from '../src/game/items.js';
let pass = 0, fail = 0; const ok = (c, m) => { if (c) { pass++; console.log('  ✓', m); } else { fail++; console.log('  ✗', m); } };
const realErr = console.error; let errors = 0; console.error = (...a) => { errors++; realErr(...a); };

function shard(seed, mode, seats) {
  const T = new Terrain(seed).generate(), L = layoutWorld(T);
  const nodes = L.nodes.map(n => ({ id: n.id, type: n.type, x: n.x, y: n.y, z: n.z, tier: n.tier, s: n.s, rot: n.rot, hp: NODE_TYPES[n.type].hp, alive: true, respawn: 0, inv: null }));
  const sh = { id: 't-1', mode, seed, max: 300, seats, T, nodes, pois: L.pois, spawns: L.spawns, players: new Map(), clock: 0, opsOut: [], ops: [], env: new Env(seed), fx: [] };
  sh.env.time = 0.4;
  sh.W = new SimWorld(seed, T, nodes, L.pois, L.spawns); sh.buildings = sh.W.buildings; sh.structures = sh.W.structures; sh.deploys = sh.W.deploys; sh.drops = sh.W.drops;
  sh.setNode = (n, alive, respawn = 0) => { sh.W.setNodeAlive(n, alive, respawn); if (!alive) n.inv = null; }; sh.rosterOut = () => {};
  sh.animals = new AnimalSim(T, null, seed + 7); sh.animals.populate([], true);
  sh.rules = new Rules(sh, { onRaid: (o, by) => sh.bots.onRaid(o, by), botUpkeep: (c, cost) => sh.bots.payUpkeep(c, cost), blast: (p, r, h, bm) => sh.bots.blast(p, r, h, bm) });
  sh.bots = new BotSim(sh, sh.rules, { hurt: (c, m) => { c.hurts = (c.hurts || 0) + m.dmg; }, fx: (p, m) => sh.fx.push(m), killed: () => {} });
  sh.tick = dt => { sh.clock += dt; sh.env.update(dt, true); const real = [...sh.players.values()]; sh.bots.target = Math.max(0, seats - real.length); sh.bots.tick(dt, real);
    const pl = real.map(c => ({ id: c.id, pos: c.pos, crouch: c.crouch, dead: c.dead })); for (const b of sh.bots.bots) if (b.lod === 0 && !b.dead) pl.push({ id: b.id, pos: b.pos, crouch: b.crouch, dead: 0, bot: b });
    sh.animals.update(dt, pl, (a, tp, dmg) => { if (tp.bot) sh.bots.bitten(tp.bot, a, dmg); }, sh.env.isNight);
    sh.rules.tickBooms(dt); sh.rules.tickDecay(dt); for (const n of nodes) if (!n.alive && n.respawn && sh.clock >= n.respawn) sh.setNode(n, true); for (const o of sh.opsOut) sh.ops.push(o); if (sh.ops.length > 4000) sh.ops.splice(0, 2000); sh.opsOut = []; };
  return sh;
}
const player = (sh, id, pos) => { const c = { id, th: 'th-' + id, ws: { readyState: 1 }, pos: pos.slice(), yaw: 0, pitch: 0, spd: 0, crouch: 0, dead: 0, light: 0, item: 'rock' }; sh.players.set(id, c); return c; };
/** a flat spot far from every base core */
function freeSpot(sh, away = 80) {
  const R = sh.rules, T = sh.T;
  for (let k = 0; k < 4000; k++) { const x = -500 + (k * 137.5) % 1000, z = -500 + (k * 71.3) % 1000, y = T.height(x, z); if (y < 3 || y > 40) continue; if (Math.abs(T.height(x + 3, z) - y) > 0.5 || Math.abs(T.height(x, z + 3) - y) > 0.5) continue;
    if (R.coreList().some(c => Math.hypot(c.x - x, c.z - z) < away)) continue; let near = false; for (const b of sh.buildings.values()) if (Math.hypot(b.x - x, b.z - z) < away) near = true; if (!near) return [x, y + 0.3, z]; }
  throw new Error('no free spot');
}

// ================================================================== rules (PvP server, no survivors in the way)
console.log('Rules: building, privilege, locks, raiding');
{
  const sh = shard(40977, 'pvp', 0), R = sh.rules, A = 'th-a', B = 'th-b', sp = freeSpot(sh), bid = 'bt1';
  const f = R.placeStructure(A, { id: 'f0', b: bid, piece: 'foundation', i: 0, j: 0, l: 0 }, { id: bid, x: sp[0], y: sp[1], z: sp[2], ry: 0 });
  ok(f && f.id === 'f0' && f.hp === pieceHP('foundation', 0) && f.owner === A, 'a foundation starts a building; the server sets its health and owner');
  ok(R.placeStructure(A, { id: 'w-air', b: bid, piece: 'wall', i: 3, j: 3, l: 0, side: 0 }) === 'noSupport', 'a wall with nothing under it is refused');
  const w = R.placeStructure(A, { id: 'w0', b: bid, piece: 'wall', i: 0, j: 0, l: 0, side: 0 }), dw = R.placeStructure(A, { id: 'dw0', b: bid, piece: 'doorway', i: 0, j: 0, l: 0, side: 1 });
  ok(w && w.id === 'w0' && dw && dw.id === 'dw0', 'wall and doorway stand on the foundation');
  ok(R.placeStructure(A, { id: 'w0b', b: bid, piece: 'wall', i: 0, j: 0, l: 0, side: 0 }) === 'occupied', 'the same edge cannot be built twice');
  const door = R.placeDeploy(A, { id: 'door1', item: 'wooden_door', x: sp[0], y: sp[1], z: sp[2] + 1.5, ry: 0, on: 'dw0' });
  ok(door && door.kind === 'door' && door.hp === deployHP('wooden_door'), 'a door fits the doorway');
  ok(R.placeDeploy(A, { id: 'door2', item: 'wooden_door', x: sp[0], y: sp[1], z: sp[2] + 1.5, ry: 0, on: 'dw0' }) === 'occupied', 'one door per doorway');
  ok(R.placeDeploy(A, { id: 'door3', item: 'wooden_door', x: sp[0], y: sp[1], z: sp[2], ry: 0, on: 'w0' }) === 'noDoorway', 'a door needs a doorway');
  const box = R.placeDeploy(A, { id: 'box1', item: 'storage_box', x: sp[0] + 0.5, y: sp[1], z: sp[2], ry: 0, onSt: 'f0' });
  ok(box && Array.isArray(box.inv) && box.inv.length === ITEMS.storage_box.deploy.slots, 'a storage box has its slots');
  // privilege
  ok(R.placeStructure(B, { id: 'bf', b: 'bt2', piece: 'foundation', i: 0, j: 0, l: 0 }, { id: 'bt2', x: sp[0] + 16, y: sp[1], z: sp[2], ry: 0 }) !== 'priv', 'before a base core is placed anyone may build nearby');
  R.removeStructure('bf');
  const core = R.placeDeploy(A, { id: 'core1', item: 'base_core', x: sp[0] - 0.6, y: sp[1], z: sp[2], ry: 0, onSt: 'f0' });
  ok(core && core.kind === 'core' && core.auth.includes(A), 'the base core authorises whoever placed it');
  ok(R.placeStructure(B, { id: 'bf2', b: 'bt3', piece: 'foundation', i: 0, j: 0, l: 0 }, { id: 'bt3', x: sp[0] + 16, y: sp[1], z: sp[2], ry: 0 }) === 'priv', `a stranger cannot build within ${BASE.coreRadius} m of the core`);
  ok(R.placeDeploy(B, { id: 'bx', item: 'storage_box', x: sp[0] + 10, y: sp[1], z: sp[2], ry: 0 }) === 'priv', 'nor place things there');
  ok(typeof R.placeStructure(B, { id: 'bf3', b: 'bt4', piece: 'foundation', i: 0, j: 0, l: 0 }, { id: 'bt4', x: sp[0] + 60, y: sp[1], z: sp[2], ry: 0 }) === 'object', 'outside the radius he can');
  ok(R.placeDeploy(B, { id: 'core2', item: 'base_core', x: sp[0] + 20, y: sp[1], z: sp[2], ry: 0 }) === 'priv', 'a second core inside the first one\'s radius is refused');
  ok(R.upgradeStructure(B, 'w0', 1) === false && R.upgradeStructure(A, 'w0', 1) === true && sh.structures.get('w0').hp === pieceHP('wall', 1), 'only the owner upgrades; the upgrade restores full health of the new tier');
  // locks
  ok(R.canUse(B, door) === true, 'PvP: an unlocked door opens for anyone');
  ok(R.addLock(B, 'door1', 'key', '') === 'priv', 'a stranger cannot fit a lock on somebody else\'s door');
  ok(R.addLock(A, 'door1', 'code', '12ab') === 'code', 'a code must be four digits');
  ok(typeof R.addLock(A, 'door1', 'code', '4821') === 'object' && door.lock.k === 'code', 'code lock fitted');
  ok(!JSON.stringify(door).includes('4821') && !JSON.stringify(sh.opsOut).includes('4821'), 'the code never leaves the server (not in the door, not in what is broadcast)');
  ok(R.canUse(B, door) === false && R.canUse(A, door) === true, 'locked: the owner passes, a stranger does not');
  ok(R.tryCode(B, 'door1', '0000') === 'wrong', 'a wrong code is refused');
  ok(R.tryCode(B, 'door1', '4821') === 'ok' && R.canUse(B, door) === true, 'the right code lets him in from then on');
  for (let i = 0; i < 5; i++) R.tryCode('th-c', 'door1', '1111');
  ok(R.tryCode('th-c', 'door1', '4821') === 'wait', 'five wrong tries lock the keypad for a minute');
  ok(typeof R.addLock(A, 'box1', 'key', '') === 'object' && R.canUse(B, box) === false && R.canUse(A, box) === true, 'key lock on a box: only the base\'s people open it');
  ok(R.setCoreAuth(B, 'core1', true) === true && R.canUse(B, box) === true, 'authorising on the (unlocked) core gives access to key locks');
  R.setCoreAuth(B, 'core1', false);
  // raiding: materials
  R.upgradeStructure(A, 'f0', 2); R.upgradeStructure(A, 'w0', 2); const stoneHp = sh.structures.get('w0').hp;
  R.damageStructure('w0', 50, B, 'melee'); const meleeLoss = stoneHp - sh.structures.get('w0').hp;
  R.damageStructure('w0', 50, B, 'bullet'); const bulletLoss = stoneHp - meleeLoss - sh.structures.get('w0').hp;
  ok(meleeLoss > 0 && meleeLoss <= 1.01 && bulletLoss > 0 && bulletLoss <= 0.51, `stone shrugs off tools and bullets (50 damage → ${meleeLoss.toFixed(2)} and ${bulletLoss.toFixed(2)})`);
  const before = sh.structures.get('w0').hp, wp = sh.W.structureTransform(sh.structures.get('w0')).p;
  const bm = R.plant(B, 'b', 'breach_charge', [wp[0], wp[1] + 1.2, wp[2]]); ok(bm && R.booms.size === 1 && sh.opsOut.some(o => o.t === 'boom+'), 'a breaching charge is planted and announced');
  for (let i = 0; i < 65; i++) R.tickBooms(0.1); ok(R.booms.size === 1, 'the fuse is still burning after 6.5 s'); for (let i = 0; i < 10; i++) R.tickBooms(0.1);
  const after = sh.structures.get('w0') ? sh.structures.get('w0').hp : 0, want = blastDamage(ITEMS.breach_charge.explosive, 2, 0);
  ok(R.booms.size === 0 && sh.opsOut.some(o => o.t === 'boom') && before - after > want * 0.5 && after > 0, `it goes off after ${ITEMS.breach_charge.explosive.fuse} s and takes ${Math.round(before - after)} of ${Math.round(before)} off the stone wall: one charge is not enough`);
  R.plant(B, 'b', 'breach_charge', [wp[0], wp[1] + 1.2, wp[2]]); for (let i = 0; i < 75; i++) R.tickBooms(0.1); ok(!sh.structures.has('w0') && sh.structures.has('f0'), 'the second charge breaks through; the stone foundation holds');
  R.placeStructure(A, { id: 'w1', b: bid, piece: 'wall', i: 0, j: 0, l: 0, side: 0 });
  ok(!sh.deploys.has('door1') || sh.deploys.get('door1').hp < deployHP('wooden_door'), 'the wooden door beside it is damaged or gone');
  // support
  R.placeStructure(A, { id: 'fl1', b: bid, piece: 'floor', i: 0, j: 0, l: 1 });
  const n0 = sh.structures.size; R.damageStructure('f0', 1e6, B, 'blast');
  ok(n0 >= 3 && !sh.structures.has('f0') && !sh.structures.has('w1') && !sh.structures.has('dw0') && !sh.structures.has('fl1') && !sh.deploys.has('box1') && !sh.deploys.has('core1'), `destroying the foundation brings down everything that stood on it (${n0} pieces → ${sh.structures.size})`);
  ok(sh.drops.size >= 0 && R.coreList().every(c => c.id !== 'core1'), 'the core is gone and its protection with it');
}
console.log('Rules: PvE servers');
{
  const sh = shard(40977, 'pve', 0), R = sh.rules, A = 'th-a', B = 'th-b', sp = freeSpot(sh);
  R.placeStructure(A, { id: 'f0', b: 'p1', piece: 'foundation', i: 0, j: 0, l: 0 }, { id: 'p1', x: sp[0], y: sp[1], z: sp[2], ry: 0 }); const hp = sh.structures.get('f0').hp;
  ok(R.damageStructure('f0', 500, B, 'melee') === 0 && sh.structures.get('f0').hp === hp, 'PvE: one player cannot damage another player\'s base');
  const box = R.placeDeploy(A, { id: 'bx', item: 'storage_box', x: sp[0], y: sp[1], z: sp[2], ry: 0 }); ok(R.canUse(B, box) === false, 'PvE: nor open his boxes');
  R.placeStructure('B:t-1:9', { id: 'bf0', b: 'p2', piece: 'foundation', i: 0, j: 0, l: 0 }, { id: 'p2', x: sp[0] + 50, y: sp[1], z: sp[2], ry: 0 });
  ok(R.damageStructure('bf0', 5, B, 'melee') > 0, 'PvE: a survivors\' base can be raided');
  ok(R.damageStructure('f0', 5, 'B:t-1:9', 'melee') === 0, 'PvE: survivors cannot damage a player\'s base');
}
console.log('Rules: upkeep and decay');
{
  const sh = shard(40977, 'pvp', 0), R = sh.rules, A = 'th-a', sp = freeSpot(sh);
  R.placeStructure(A, { id: 'f0', b: 'd1', piece: 'foundation', i: 0, j: 0, l: 0 }, { id: 'd1', x: sp[0], y: sp[1], z: sp[2], ry: 0 }, { tier: 1 });
  R.placeStructure(A, { id: 'f1', b: 'd2', piece: 'foundation', i: 0, j: 0, l: 0 }, { id: 'd2', x: sp[0] + 70, y: sp[1], z: sp[2], ry: 0 }, { tier: 1 });
  const core = R.placeDeploy(A, { id: 'c1', item: 'base_core', x: sp[0], y: sp[1], z: sp[2], ry: 0, onSt: 'f0' }), cost = upkeepCost([sh.structures.get('f0')]), k = Object.keys(cost)[0];
  ok(k && cost[k] >= 1, `upkeep of a timber foundation: ${JSON.stringify(cost)} every ${BASE.upkeepEvery / 60} min`);
  core.inv[0] = { id: k, n: cost[k] * 3 }; const info = R.upkeepInfo(core); ok(info.pieces === 1 && info.seconds > BASE.upkeepEvery * 2, `the core reports how long its stock lasts (${Math.round(info.seconds / 60)} min)`);
  const hp1 = sh.structures.get('f1').hp; let t = 0; const run = sec => { for (let i = 0; i < sec / 30; i++) { sh.clock += 30; R.tickDecay(30); } };
  run(BASE.decayGrace - 60); ok(sh.structures.get('f1').hp === hp1, 'an unprotected base does not decay during the grace time');
  run(BASE.upkeepEvery * 2); const left = core.inv[0] ? core.inv[0].n : 0;
  ok(left < cost[k] * 3 && sh.structures.get('f0').hp === pieceHP('foundation', 1), `the protected base paid its upkeep from the core (${cost[k] * 3} → ${left}) and stayed at full health`);
  ok(sh.structures.get('f1') && sh.structures.get('f1').hp < hp1, 'the unprotected one is decaying');
  run(BASE.decayTime[1] + 600); ok(!sh.structures.has('f1'), 'and is gone when its decay time has passed');
  run(BASE.upkeepEvery * 4 + BASE.decayGrace + 600); ok(!core.inv[0] && (!sh.structures.has('f0') || sh.structures.get('f0').hp < pieceHP('foundation', 1)), 'a base whose core ran dry starts to decay too');
}

console.log('Weapons: ballistics tables');
{
  const { RECOIL, hitZone, RECIPES } = await import('../src/game/items.js');
  ok(hitZone(0.95)[0] === 'head' && hitZone(0.95)[1] === 2 && hitZone(0.7)[1] === 1 && hitZone(0.2)[0] === 'legs' && hitZone(0.2)[1] < 1, 'hit zones: head doubles, chest is full damage, legs take less');
  const guns = Object.entries(ITEMS).filter(([, I]) => I.ranged && I.ranged.gun);
  ok(guns.length >= 6 && guns.every(([, I]) => I.ranged.vel >= 200 && RECOIL[I.ranged.pat] && RECOIL[I.ranged.pat].length >= 1), `every firearm has a muzzle velocity and a recoil pattern (${guns.map(([k, I]) => k + ' ' + I.ranged.vel).join(', ')})`);
  ok(ITEMS.assault_rifle.ranged.auto && ITEMS.smg.ranged.auto && !ITEMS.semi_rifle.ranged.auto && ITEMS.bolt_rifle.ranged.zoom === 8, 'the AK and the SMG are automatic, the bolt rifle carries an 8x scope');
  ok(['smg', 'assault_rifle', 'bolt_rifle'].every(id => RECIPES.some(r => r.out === id && r.bench === 2)), 'the new guns are crafted at the level 2 workbench');
  const drop = d => 0.5 * 9.8 * (d / ITEMS.assault_rifle.ranged.vel) ** 2; ok(drop(100) > 0.25 && drop(100) < 0.5 && drop(300) > 2.5, `bullet drop of the AK: ${drop(100).toFixed(2)} m at 100 m, ${drop(300).toFixed(1)} m at 300 m`);
}

// ================================================================== survivors
console.log('Survivors: population and bases');
const SEATS = 60, sh = shard(40977, 'pvp', SEATS), Bt = sh.bots;
for (let i = 0; i < 50; i++) sh.tick(0.1);
ok(Bt.bots.length === SEATS, `the server fills its ${SEATS} survivor seats (${Bt.bots.length})`);
const teams = [...Bt.teams.values()], est = teams.filter(t => t.established), fresh = teams.filter(t => !t.established);
const inEst = est.reduce((a, t) => a + t.members.length, 0);
ok(teams.every(t => t.members.length >= 1 && t.members.length <= 4), `teams of 1 to 4 (${teams.length} teams)`);
ok(inEst >= SEATS * 0.3 && inEst <= SEATS * 0.7, `about half arrive with a base and gear, half start from nothing (${inEst} / ${SEATS - inEst})`);
const withBase = est.filter(t => t.base && t.base.made), names = new Set(Bt.bots.map(b => b.name));
ok(withBase.length >= est.length * 0.8, `established teams own a finished base (${withBase.length} of ${est.length})`);
ok(names.size === Bt.bots.length && Bt.bots.every(b => typeof b.name === 'string' && b.name.length >= 2), 'every survivor has his own name');
const cores = sh.rules.coreList(), doors = [...sh.deploys.values()].filter(d => d.kind === 'door'), locked = doors.filter(d => d.lock);
ok(cores.length >= withBase.length * 0.9 && doors.length >= withBase.length && locked.length >= doors.length * 0.7, `their bases have a core (${cores.length}), doors (${doors.length}) and locks (${locked.length})`);
ok([...sh.structures.values()].some(s => s.tier >= 2), 'some of their walls are already stone or better');
ok(fresh.every(t => t.members.every(m => m.tier === 0)), 'the ones starting from nothing carry no weapons yet');
ok([...sh.structures.values()].every(s => String(s.owner).startsWith('B:')) && [...sh.deploys.values()].every(d => String(d.owner).startsWith('B:')), 'everything they built is owned by their teams');

console.log('Survivors: 40 minutes with nobody online (coarse simulation)');
const s0 = sh.structures.size, t0 = performance.now(); let ticks = 0;
for (let i = 0; i < 40 * 600; i++) { sh.tick(0.1); ticks++; }
const msFar = (performance.now() - t0) / ticks;
ok(errors === 0, `no errors in ${ticks} ticks`);
ok(msFar < 2, `${msFar.toFixed(3)} ms per tick for ${Bt.bots.length} survivors when no player is near`);
ok(Bt.bots.every(b => b.pos.every(Number.isFinite) && Math.abs(b.pos[0]) < 800 && Math.abs(b.pos[2]) < 800), 'every survivor is at a valid position');
const progressed = fresh.filter(t => Bt.teams.has(t.id) && t.base && t.base.made).length, armed = Bt.bots.filter(b => b.tier > 0).length;
ok(progressed >= 1, `teams that started from nothing have built bases of their own (${progressed} of ${fresh.length})`);
ok(sh.structures.size > s0 * 0.7 && armed >= SEATS * 0.4, `bases still stand (${s0} → ${sh.structures.size} pieces) and ${armed} of ${Bt.bots.length} survivors are armed`);
ok(Bt.stat.kills < 40 * 4, `they do not wipe each other out (${Bt.stat.kills} kills, ${Bt.stat.raids} raids in 40 min)`);
ok(Bt.bots.length === SEATS, 'the dead come back: the population holds');

console.log('Survivors: a player arrives');
const home = withBase.find(t => Bt.teams.has(t.id) && t.members.length >= 2 && sh.deploys.size) || withBase[0];
const p = player(sh, 'p1', [home.base.cx + 34, 0, home.base.cz + 6]); p.pos[1] = sh.T.height(p.pos[0], p.pos[2]); p.item = 'semi_rifle';
let maxMs = 0; const t1 = performance.now(); for (let i = 0; i < 900; i++) { const a = performance.now(); sh.tick(0.1); maxMs = Math.max(maxMs, performance.now() - a); }
const msNear = (performance.now() - t1) / 900;
ok(Bt.bots.length === SEATS - 1, `a survivor left to make room for the player (${Bt.bots.length})`);
ok(Bt.stat.active >= 1, `survivors near the player run at full detail (${Bt.stat.active} active, ${Bt.stat.mid} mid, ${Bt.stat.far} far)`);
ok(msNear < 4 && maxMs < 60, `${msNear.toFixed(2)} ms per tick with a player beside a base (worst ${maxMs.toFixed(1)} ms)`);
const near = Bt.statesFor(p.pos[0], p.pos[2], 0), all = Bt.statesFor(p.pos[0], p.pos[2], 30);
ok(near.length >= 1 && near.every(e => e.length === 9 && e.slice(1, 4).every(Number.isFinite)), `the player is sent the survivors around him (${near.length} near every tick, ${all.length} with the far ones)`);
ok(all.length <= SEATS && JSON.stringify({ t: 'bs', l: near }).length < 6000, `the near stream is small (${JSON.stringify({ t: 'bs', l: near }).length} bytes)`);
ok(errors === 0, 'no errors with a player in the world');
const p2 = player(sh, 'p2', p.pos), p3 = player(sh, 'p3', p.pos); for (let i = 0; i < 30; i++) sh.tick(0.1);
ok(Bt.bots.length === SEATS - 3, 'two more players, two more survivors gone');
sh.players.delete('p2'); sh.players.delete('p3'); for (let i = 0; i < 300; i++) sh.tick(0.1);
ok(Bt.bots.length === SEATS - 1, 'when they leave, survivors return');
// hitting a survivor: he remembers who did it
const carries = b => !b.dead && (b.gun || Object.keys(b.inv).some(k => b.inv[k] >= 1)), victim = Bt.bots.find(b => carries(b) && b.lod === 0) || Bt.bots.find(carries);
const hp0 = victim.hp; Bt.hurtBot(victim, 30, 'bullet', p); ok(victim.hp < hp0 && victim.team.hostile.has(p.th), 'a survivor who is shot takes the damage and his team turns on the shooter');
Bt.hurtBot(victim, 9999, 'bullet', p); ok(victim.dead || !Bt.bots.includes(victim), 'he can be killed'); for (let i = 0; i < 20; i++) sh.tick(0.1);
ok([...sh.drops.values()].some(d => d.bag && Math.hypot(d.x - victim.pos[0], d.z - victim.pos[2]) < 6), 'and leaves a bag with what he carried');

console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
