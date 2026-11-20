// ARVEX SURVIVAL — inventory containers. Item instance: { id, n, cond?, ammo?, jug? }
import { ITEMS } from './items.js';

export const WEAR_SLOTS = ['head', 'chest', 'legs', 'feet'];
export function makeItem(id, n = 1) {
  const it = ITEMS[id]; if (!it) return null;
  const o = { id, n: Math.max(1, Math.min(n, it.stack)) };
  if (it.cond) o.cond = it.cond; if (it.ranged) o.ammo = 0; if (it.jug != null) o.jug = 0;
  return o;
}
export const maxStack = id => (ITEMS[id] ? ITEMS[id].stack : 1);
const canStack = (a, b) => a && b && a.id === b.id && maxStack(a.id) > 1 && a.cond == null && b.cond == null;

export class Container {
  constructor(n, kind = 'main') { this.slots = new Array(n).fill(null); this.kind = kind; }
  get size() { return this.slots.length; }
  count(id) { let c = 0; for (const s of this.slots) if (s && s.id === id) c += s.n; return c; }
  /** add as much as fits; returns leftover count */
  add(id, n, extra) {
    if (n <= 0) return 0; const ms = maxStack(id);
    if (ms > 1 && !extra) for (const s of this.slots) { if (s && s.id === id && s.n < ms) { const k = Math.min(ms - s.n, n); s.n += k; n -= k; if (!n) return 0; } }
    for (let i = 0; i < this.slots.length && n > 0; i++) if (!this.slots[i]) { const it = makeItem(id, Math.min(n, ms)); if (extra) Object.assign(it, extra); this.slots[i] = it; n -= it.n; }
    return n;
  }
  addItem(item) { if (!item) return 0; if (item.cond != null || item.ammo != null || item.jug != null) { const i = this.slots.indexOf(null); if (i < 0) return item.n; this.slots[i] = item; return 0; } return this.add(item.id, item.n); }
  remove(id, n) { for (let i = this.slots.length - 1; i >= 0 && n > 0; i--) { const s = this.slots[i]; if (s && s.id === id) { const k = Math.min(s.n, n); s.n -= k; n -= k; if (!s.n) this.slots[i] = null; } } return n; }
  firstFree() { return this.slots.indexOf(null); }
  isEmpty() { return this.slots.every(s => !s); }
  serialize() { return this.slots.map(s => s ? Object.assign({}, s) : null); }
  restore(a) { if (!a) return; for (let i = 0; i < this.slots.length; i++) this.slots[i] = a[i] ? Object.assign({}, a[i]) : null; }
}

/** the player's full inventory: main 24 + belt 6 + wear 4 */
export class PlayerInventory {
  constructor() { this.main = new Container(24, 'main'); this.belt = new Container(6, 'belt'); this.wear = new Container(4, 'wear'); this.active = 0; this.listeners = []; }
  on(f) { this.listeners.push(f); } changed(why) { for (const f of this.listeners) f(why); }
  count(id) { return this.main.count(id) + this.belt.count(id); }
  has(req) { for (const k in req) if (this.count(k) < req[k]) return false; return true; }
  take(req) { if (!this.has(req)) return false; for (const k in req) { const left = this.main.remove(k, req[k]); if (left) this.belt.remove(k, left); } this.changed('take'); return true; }
  /** gives items: belt first if a stack exists there, otherwise main then belt. returns leftover */
  give(id, n, extra) {
    let left = n;
    // new tools / weapons go straight to a free belt slot (quicker to use), stackables fill existing stacks
    if (maxStack(id) === 1 && (ITEMS[id].melee || ITEMS[id].ranged || ITEMS[id].plan || ITEMS[id].hammer || ITEMS[id].deploy)) { while (left > 0) { const i = this.belt.firstFree(); if (i < 0) break; this.belt.slots[i] = Object.assign(makeItem(id, 1), extra || {}); left--; } }
    if (!extra && maxStack(id) > 1) for (const s of this.belt.slots) if (s && s.id === id && s.n < maxStack(id)) { const k = Math.min(maxStack(id) - s.n, left); s.n += k; left -= k; }
    left = this.main.add(id, left, extra); if (left) left = this.belt.add(id, left, extra);
    this.changed('give'); return left;
  }
  giveItem(item) { let left = this.main.addItem(item); if (left) left = this.belt.addItem(item); this.changed('give'); return left; }
  activeItem() { return this.belt.slots[this.active]; }
  armor() { let a = 0, ins = 0; for (const s of this.wear.slots) if (s && ITEMS[s.id].wear) { a += ITEMS[s.id].wear.armor; ins += ITEMS[s.id].wear.ins; } return { armor: a, ins }; }
  cont(kind) { return this[kind]; }
  /** move/merge/swap between any two containers (player or external). n = amount (default all) */
  static move(src, si, dst, di, n) {
    const a = src.slots[si]; if (!a || (src === dst && si === di)) return false;
    const amt = Math.min(a.n, n || a.n);
    if (dst.kind === 'wear') { const w = ITEMS[a.id].wear; if (!w || WEAR_SLOTS[di] !== w.slot) return false; }
    if (src.kind === 'wear' && dst.slots[di] && !(ITEMS[dst.slots[di].id].wear && ITEMS[dst.slots[di].id].wear.slot === WEAR_SLOTS[si])) return false;
    const b = dst.slots[di];
    if (!b) { if (amt === a.n) { dst.slots[di] = a; src.slots[si] = null; } else { dst.slots[di] = Object.assign({}, a, { n: amt }); a.n -= amt; } return true; }
    if (canStack(a, b)) { const k = Math.min(maxStack(b.id) - b.n, amt); if (k <= 0) { return PlayerInventory.swap(src, si, dst, di); } b.n += k; a.n -= k; if (!a.n) src.slots[si] = null; return true; }
    if (amt !== a.n) return false;
    return PlayerInventory.swap(src, si, dst, di);
  }
  static swap(src, si, dst, di) { const a = src.slots[si], b = dst.slots[di]; dst.slots[di] = a; src.slots[si] = b; return true; }
  static split(c, i) { const s = c.slots[i]; if (!s || s.n < 2) return false; const j = c.firstFree(); if (j < 0) return false; const half = Math.floor(s.n / 2); c.slots[j] = Object.assign({}, s, { n: half }); s.n -= half; return true; }
  /** quick-move (shift-click): main↔belt, or to/from an open external container */
  quickMove(src, si, ext) {
    const a = src.slots[si]; if (!a) return false;
    const targets = ext && src !== ext ? [ext] : src === ext ? [this.belt, this.main] : src.kind === 'main' ? (ITEMS[a.id].wear ? [this.wear, this.belt] : [this.belt]) : src.kind === 'belt' ? [this.main] : [this.main, this.belt];
    for (const t of targets) {
      if (t.kind === 'wear') { const di = WEAR_SLOTS.indexOf(ITEMS[a.id].wear.slot); if (!t.slots[di]) { t.slots[di] = a; src.slots[si] = null; return true; } continue; }
      if (a.cond == null && a.ammo == null && a.jug == null) { const left = t.add(a.id, a.n); if (left < a.n) { a.n = left; if (!a.n) src.slots[si] = null; return true; } }
      else { const j = t.firstFree(); if (j >= 0) { t.slots[j] = a; src.slots[si] = null; return true; } }
    }
    return false;
  }
  serialize() { return { main: this.main.serialize(), belt: this.belt.serialize(), wear: this.wear.serialize(), active: this.active }; }
  restore(s) { if (!s) return; this.main.restore(s.main); this.belt.restore(s.belt); this.wear.restore(s.wear); this.active = s.active || 0; }
  clearAll() { for (const c of [this.main, this.belt, this.wear]) c.slots.fill(null); }
  allItems() { const out = []; for (const c of [this.main, this.belt, this.wear]) for (const s of c.slots) if (s) out.push(s); return out; }
}
