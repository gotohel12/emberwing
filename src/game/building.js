// ARVEX SURVIVAL — building placement: snapping grid per building, support rules, validation, deployables
import { PIECES, pieceCost, pieceHP, ITEMS, TIERS } from './items.js';
import { CELL_S, WALL_H } from '../gfx/models.js';
import { MOVE } from './player.js';

const S = CELL_S, H = WALL_H;
export const REASONS = {
  noSupport: ['لازم يكون فوق أساس أو جدار', 'Needs support (foundation or wall)'], occupied: ['المكان مشغول', 'Something is already here'],
  terrain: ['الأرض مو مستوية', 'Terrain is too uneven'], blocked: ['فيه شي يعيق', 'Blocked by an object'], water: ['ما تقدر تبني بالموية', 'Can\'t build in water'],
  far: ['بعيد', 'Too far'], cost: ['ما عندك موارد كافية', 'Not enough resources'], self: ['أنت واقف بالمكان', 'You are standing in the way'], noDoorway: ['صوّب على فتحة باب', 'Aim at a doorway'],
  priv: ['قريب من قاعدة لاعب ثاني', 'Too close to another player\'s base'], slope: ['المكان مايل', 'Surface too steep']
};

export class Builder {
  constructor(sess) { this.s = sess; this.rot = 0; }
  get world() { return this.s.world; }
  nearestBuilding(P, maxD = 4.6) {
    let best = null, bd = maxD;
    for (const B of this.world.buildings.values()) { if (Math.hypot(B.x - P[0], B.z - P[2]) > 130) continue;   // only the buildings around: a server holds thousands of pieces
     for (const st of this.world.structuresOf(B.id)) {
      const { p } = this.world.structureTransform(st), d = Math.hypot(p[0] - P[0], p[2] - P[2]) - (PIECES[st.piece].kind === 'cell' ? 2.1 : 1.2);
      if (d < bd && Math.abs(p[1] - P[1]) < 8) { bd = d; best = B; }
     } }
    return best;
  }
  hasCell(b, i, j, l) { return !!this.world.structAt(b.id, i, j, l, 'cell'); }
  cellBase(b, i, j, l) { const st = this.world.structAt(b.id, i, j, l, 'cell'); return st && (l === 0 ? st.piece === 'foundation' : st.piece === 'floor'); }
  edge(b, i, j, l, side) { return this.world.structAt(b.id, i, j, l, 'edge', side); }
  /** placement candidate for a building piece */
  candidate(pieceId, eye, dir) {
    const W = this.world, hit = W.raycast(eye, dir, 7), P = hit.kind ? hit.p : [eye[0] + dir[0] * 5, eye[1] + dir[1] * 5, eye[2] + dir[2] * 5];
    const kind = PIECES[pieceId].kind, cost = pieceCost(pieceId, 0);
    const out = { piece: pieceId, tier: 0, cost, ok: false };
    const b = this.nearestBuilding(P);
    if (pieceId === 'foundation') {
      if (b) {
        const lp = W.toLocal(b, P), i = Math.round(lp[0] / S), j = Math.round(lp[2] / S);
        Object.assign(out, { b: b.id, i, j, l: 0, rot: 0 });
        const t = W.structureTransform({ b: b.id, piece: 'foundation', i, j, l: 0 }); out.p = t.p; out.ry = t.ry;
        if (this.hasCell(b, i, j, 0)) return fail(out, 'occupied');
        if (![[1, 0], [-1, 0], [0, 1], [0, -1]].some(([a, c]) => this.cellBase(b, i + a, j + c, 0))) return this.newFoundation(out, P, hit);
        return this.validateFoundation(out, b.y);
      }
      return this.newFoundation(out, P, hit);
    }
    if (!b) { out.p = P; out.ry = this.s.player.yaw; return fail(out, 'noSupport'); }
    out.b = b.id;
    // socket snapping: score every socket of this building near the aim ray, prefer free + supported ones
    const lp = W.toLocal(b, P), ci = Math.round(lp[0] / S), cj = Math.round(lp[2] / S);
    const pl = this.s.player, myL = Math.max(0, Math.round((pl.pos[1] - b.y) / H));
    const socks = [];
    for (let i = ci - 2; i <= ci + 2; i++) for (let j = cj - 2; j <= cj + 2; j++) for (let l = Math.max(0, myL - 1); l <= myL + 2; l++) {
      if (kind === 'edge') for (const side of [0, 1]) socks.push({ i, j, l, side, c: W.toWorld(b, i * S + (side === 0 ? S / 2 : 0), l * H + H / 2, j * S + (side === 1 ? S / 2 : 0)) });
      else if (kind === 'cell') { if (pieceId === 'stairs' || l > 0) socks.push({ i, j, l, c: W.toWorld(b, i * S, l * H + (pieceId === 'stairs' ? H / 2 : 0), j * S) }); }
      else socks.push({ i, j, l, c: W.toWorld(b, i * S + S / 2, l * H + H / 2, j * S + S / 2) });
    }
    let best = null;
    for (const k of socks) {
      const v = [k.c[0] - eye[0], k.c[1] - eye[1], k.c[2] - eye[2]], t = v[0] * dir[0] + v[1] * dir[1] + v[2] * dir[2];
      if (t < 0.5 || t > 8) continue;
      const perp = Math.hypot(v[0] - dir[0] * t, v[1] - dir[1] * t, v[2] - dir[2] * t);
      if (perp > 2.2) continue;
      const r = this.evalSocket(pieceId, kind, b, k), score = perp + t * 0.04 + (r.ok ? 0 : r.reason === 'occupied' ? 3 : 1.5);
      if (!best || score < best.score) best = { score, k, r };
    }
    if (!best) { out.p = P; out.ry = b.ry; return fail(out, 'noSupport'); }
    const k = best.k; Object.assign(out, { i: k.i, j: k.j, l: k.l, side: k.side, rot: pieceId === 'stairs' ? this.rot & 3 : 0, supported: best.r.supported });
    const t = W.structureTransform({ b: b.id, piece: pieceId, i: k.i, j: k.j, l: k.l, side: k.side, rot: out.rot }); out.p = t.p; out.ry = t.ry;
    if (!best.r.ok) return fail(out, best.r.reason);
    return this.finish(out);
  }
  /** support / occupancy rules for one socket */
  evalSocket(pieceId, kind, b, { i, j, l, side }) {
    const W = this.world;
    if (kind === 'edge') {
      if (this.edge(b, i, j, l, side)) return { ok: false, reason: 'occupied' };
      const ni = side === 0 ? i + 1 : i, nj = side === 1 ? j + 1 : j, below = l > 0 && this.edge(b, i, j, l - 1, side);
      const sup = this.cellBase(b, i, j, l) || this.cellBase(b, ni, nj, l) || (below && ['wall', 'window'].includes(below.piece));
      return sup ? { ok: true } : { ok: false, reason: 'noSupport' };
    }
    if (kind === 'cell') {
      if (pieceId === 'stairs') { if (W.structAt(b.id, i, j, l, 'stairs')) return { ok: false, reason: 'occupied' }; return this.cellBase(b, i, j, l) ? { ok: true } : { ok: false, reason: 'noSupport' }; }
      if (this.hasCell(b, i, j, l)) return { ok: false, reason: 'occupied' };
      const walls = [this.edge(b, i, j, l - 1, 0), this.edge(b, i - 1, j, l - 1, 0), this.edge(b, i, j, l - 1, 1), this.edge(b, i, j - 1, l - 1, 1)].some(Boolean);
      const pillars = [[0, 0], [-1, 0], [0, -1], [-1, -1]].some(([a, c]) => W.structAt(b.id, i + a, j + c, l - 1, 'corner'));
      const adj = pieceId === 'floor' && [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([a, c]) => { const n = W.structAt(b.id, i + a, j + c, l, 'cell'); return n && n.piece === 'floor' && n.supported; });
      return walls || pillars || adj ? { ok: true, supported: walls || pillars } : { ok: false, reason: 'noSupport' };
    }
    if (W.structAt(b.id, i, j, l, 'corner')) return { ok: false, reason: 'occupied' };
    return [[0, 0], [1, 0], [0, 1], [1, 1]].some(([a, c]) => this.cellBase(b, i + a, j + c, l)) ? { ok: true } : { ok: false, reason: 'noSupport' };
  }
  newFoundation(out, P, hit) {
    const W = this.world, ry = this.s.player.yaw + this.rot * Math.PI / 12;
    out.b = null; out.i = 0; out.j = 0; out.l = 0; out.ry = ry;
    const c = Math.cos(ry), s = Math.sin(ry), hs = [];
    for (const [u, v] of [[-1.5, -1.5], [1.5, -1.5], [1.5, 1.5], [-1.5, 1.5], [0, 0]]) hs.push(W.height(P[0] + u * c + v * s, P[2] - u * s + v * c));
    const top = Math.max(...hs) + 0.15; out.p = [P[0], top, P[2]]; out.newB = { x: P[0], y: top, z: P[2], ry };
    if (hit.kind !== 'terrain' && hit.kind !== 'structure') return fail(out, 'noSupport');
    if (Math.min(...hs) < 0.2) return fail(out, 'water');
    if (Math.min(...hs) < top - 1.45) return fail(out, 'terrain');
    if (this.nearestBuilding(P, 1.2)) return fail(out, 'occupied');
    return this.validateFoundation(out, top);
  }
  validateFoundation(out, top) {
    const W = this.world, c = Math.cos(out.ry), s = Math.sin(out.ry), p = out.p;
    for (const [u, v] of [[-1.5, -1.5], [1.5, -1.5], [1.5, 1.5], [-1.5, 1.5], [0, 0]]) { const h = W.height(p[0] + u * c + v * s, p[2] - u * s + v * c); if (h > top + 0.4) return fail(out, 'terrain'); if (h < top - 1.45) return fail(out, 'terrain'); if (h < 0.15) return fail(out, 'water'); }
    // blocked by trees/rocks/POIs/deployables inside the footprint
    let blocked = false;
    W.near(p[0], p[2], 3, col => {
      if (blocked || col.off) return;
      if (col.t === 'c') { const dx = col.x - p[0], dz = col.z - p[2], lx = dx * c - dz * s, lz = dx * s + dz * c; if (Math.abs(lx) < 1.5 + col.r * 0.6 && Math.abs(lz) < 1.5 + col.r * 0.6 && col.y1 > top - 1) blocked = true; }
      else if (col.ref.poi != null || col.ref.dep != null) { if (Math.hypot(col.c[0] - p[0], col.c[2] - p[2]) < 1.5 + Math.min(col.h[0], col.h[2])) blocked = true; }
    });
    if (blocked) return fail(out, 'blocked');
    return this.finish(out);
  }
  finish(out) {
    const pl = this.s.player, p = out.p;
    if (Math.hypot(pl.pos[0] - p[0], pl.pos[2] - p[2]) > 9) return fail(out, 'far');
    // the player can't be inside a solid piece
    if (['foundation', 'wall', 'window', 'pillar'].includes(out.piece)) {
      const c = Math.cos(out.ry), s = Math.sin(out.ry), dx = pl.pos[0] - p[0], dz = pl.pos[2] - p[2], lx = dx * c - dz * s, lz = dx * s + dz * c;
      const hx = out.piece === 'foundation' ? 1.5 : out.piece === 'pillar' ? 0.2 : 1.5, hz = out.piece === 'foundation' ? 1.5 : 0.15;
      const y0 = out.piece === 'foundation' ? p[1] - 1.4 : p[1], y1 = out.piece === 'foundation' ? p[1] - 0.05 : p[1] + H;
      if (Math.abs(lx) < hx + MOVE.radius && Math.abs(lz) < hz + MOVE.radius && pl.pos[1] < y1 && pl.pos[1] + MOVE.height > y0) return fail(out, 'self');
    }
    if (this.s.privBlocked && this.s.privBlocked(p)) return fail(out, 'priv');
    if (!this.s.inv.has(out.cost) && !this.s.creative) return fail(out, 'cost');
    out.ok = true; return out;
  }
  /** deployable candidate */
  deployCandidate(itemId, eye, dir) {
    const W = this.world, it = ITEMS[itemId], k = it.deploy.kind, hit = W.raycast(eye, dir, 5.5), out = { item: itemId, ok: false };
    if (k === 'door') {
      out.p = hit.p || [eye[0] + dir[0] * 3, eye[1] + dir[1] * 3, eye[2] + dir[2] * 3]; out.ry = this.s.player.yaw;
      // nearest free doorway to the aim ray
      let best = null;
      for (const B of W.buildings.values()) { if (Math.hypot(B.x - eye[0], B.z - eye[2]) > 130) continue; for (const st of W.structuresOf(B.id)) {
        if (st.piece !== 'doorway') continue;
        const t0 = W.structureTransform(st), c = [t0.p[0], t0.p[1] + 1.1, t0.p[2]], v = [c[0] - eye[0], c[1] - eye[1], c[2] - eye[2]], t = v[0] * dir[0] + v[1] * dir[1] + v[2] * dir[2];
        if (t < 0.3 || t > 6) continue; const perp = Math.hypot(v[0] - dir[0] * t, v[1] - dir[1] * t, v[2] - dir[2] * t); if (perp > 1.4) continue;
        if (!best || perp < best.perp) best = { st, perp, t0 };
      } }
      if (!best) return fail(out, 'noDoorway');
      out.p = best.t0.p; out.ry = best.t0.ry + (this.rot % 2 ? Math.PI : 0); out.on = best.st.id;
      if ([...W.deploys.values()].some(d => d.on === best.st.id)) return fail(out, 'occupied');
      out.ok = true; return out;
    }
    if (!hit.kind) { out.p = [eye[0] + dir[0] * 4, eye[1] + dir[1] * 4, eye[2] + dir[2] * 4]; out.ry = 0; return fail(out, 'far'); }
    const p = hit.p; out.p = [p[0], p[1], p[2]]; out.ry = this.s.player.yaw + Math.PI + this.rot * Math.PI / 4;
    if (hit.kind === 'terrain') { if (W.T.slope(p[0], p[2]) > 0.3) return fail(out, 'slope'); if (p[1] < 0.1) return fail(out, 'water'); out.p[1] = W.height(p[0], p[2]); }
    else if (hit.kind === 'structure') { const st = W.structures.get(hit.ref.st); if (!st || !['foundation', 'floor'].includes(st.piece)) return fail(out, 'slope'); out.p[1] = W.structureTransform(st).p[1]; out.onSt = st.id; }
    else return fail(out, 'blocked');
    if (this.s.privBlocked && this.s.privBlocked(out.p)) return fail(out, 'priv');
    if (k === 'core' && this.s.coreNear && this.s.coreNear(out.p[0], out.p[2])) return fail(out, 'priv');
    const r = (it.deploy.r || 0.6) * 0.9; let blocked = false;
    W.near(out.p[0], out.p[2], r + 1.5, col => { if (blocked || col.off) return; if (col.t === 'c') { if (Math.hypot(col.x - out.p[0], col.z - out.p[2]) < col.r + r && col.y1 > out.p[1]) blocked = true; } else if (!col.walk || col.ref.dep != null) { if (rayFree(col, out.p, r)) blocked = true; } });
    if (blocked) return fail(out, 'blocked');
    out.ok = true; return out;
  }
  /** hammer options for a structure */
  upgradeOptions(st) { const out = []; for (let t = st.tier + 1; t < TIERS.length; t++) out.push({ tier: t, cost: pieceCost(st.piece, t) }); return out; }
  repairCost(st) { const max = pieceHP(st.piece, st.tier), miss = 1 - st.hp / max; if (miss <= 0.001) return null; const c = pieceCost(st.piece, st.tier), out = {}; for (const k in c) out[k] = Math.max(1, Math.ceil(c[k] * miss * 0.5)); return out; }
}
function fail(out, r) { out.ok = false; out.reason = r; return out; }
function rayFree(col, p, r) { const dx = p[0] - col.c[0], dz = p[2] - col.c[2], lx = dx * col.cs - dz * col.sn, lz = dx * col.sn + dz * col.cs; return Math.abs(lx) < col.h[0] + r && Math.abs(lz) < col.h[2] + r && p[1] < col.c[1] + col.h[1] && p[1] + 1 > col.c[1] - col.h[1]; }
export { pieceHP };
