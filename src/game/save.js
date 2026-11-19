// EMBERWING — save system (localStorage, versioned, validated)
const KEY = 'emberwing.save.v1';
export function freshSave() {
  return { v: 1, wallet: 0, up: { wing: 0, heart: 0, dash: 0, flare: 0, magnet: 0 }, skins: ['ember'], skin: 'ember', worlds: [], diff: 'normal', seenIntro: false, totalEmbers: 0, playTime: 0 };
}
export function loadSave() {
  try {
    const s = JSON.parse(localStorage.getItem(KEY) || 'null');
    if (!s || s.v !== 1) return freshSave();
    const f = freshSave();
    const out = Object.assign(f, s);
    out.up = Object.assign(freshSave().up, s.up || {});
    for (const k in out.up) out.up[k] = Math.max(0, Math.min(4, out.up[k] | 0));
    out.wallet = Math.max(0, out.wallet | 0);
    if (!Array.isArray(out.worlds)) out.worlds = [];
    if (!Array.isArray(out.skins) || !out.skins.length) out.skins = ['ember'];
    return out;
  } catch (e) { return freshSave(); }
}
export function writeSave(s) { try { localStorage.setItem(KEY, JSON.stringify(s)); return true; } catch (e) { return false; } }
export function hasProgress(s) { return s.worlds.some(w => w && w.done) || s.wallet > 0; }
export function wipeSave() { try { localStorage.removeItem(KEY); } catch (e) {} }
