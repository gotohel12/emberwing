// ARVEX — textured models prepared in Blender from real scans and artist-made assets (tools/blender/arvex_tx.py → public/models/arvex_tx.bin).
// Format: 'ARTX' u32 headerLen, JSON header { total, parts: { name: [[kind, count], …] }, meta }, then three blocks for `total` vertices:
//   float32 pos3 · int8 normal3 + uint8 wind · uint16 uv2 (into the model atlas, textures/models_d.webp + models_n.webp).
// kind 0: solid surface · kind 1: leaf card (two-sided, light shines through). Triangles are not indexed.
// Meshes come out MeshBuilder-compatible { v: Float32Array } with the renderer's textured-model encoding: colour = (u, v, wind), a = -20 solid / -21 leaf.
import { GUN_META } from './guns_meta.js';
export const TX = { ready: false, ver: 0, parts: null, meta: {} };

export async function loadTexturedModels(url = 'models/arvex_tx.bin') {
  try {
    const r = await fetch(url); if (!r.ok) return false; const buf = await r.arrayBuffer(), dv = new DataView(buf);
    if (dv.getUint32(0, true) !== 0x58545241) return false;                 // 'ARTX'
    const hl = dv.getUint32(4, true), H = JSON.parse(new TextDecoder().decode(new Uint8Array(buf, 8, hl))), T = H.total, o = (8 + hl + 3) & ~3;
    const pos = new Float32Array(buf, o, T * 3), nw = new Int8Array(buf, o + T * 12, T * 4), uv = new Uint16Array(buf, o + T * 16, T * 2);
    const parts = {}; let at = 0; for (const name in H.parts) { const segs = []; for (const [kind, n] of H.parts[name]) { segs.push([kind, at, n]); at += n; } parts[name] = segs; }
    Object.assign(TX, { parts, pos, nw, uv, meta: H.meta || {}, ready: true, ver: TX.ver + 1 });
    for (const k in TX.meta) if (k.startsWith('item:') && TX.meta[k].muzzle) GUN_META[k.slice(5)] = TX.meta[k];   // where the muzzle, sights and fore-end of a scanned weapon are
    return true;
  } catch (e) { console.warn('ARVEX textured models', e); return false; }
}

export const hasTX = name => TX.ready && !!TX.parts[name];

/** build a textured part; s: uniform scale */
export function txMesh(name, s = 1) {
  const segs = TX.parts && TX.parts[name]; if (!segs) return null; let n = 0; for (const g of segs) n += g[2];
  const v = new Float32Array(n * 10), P = TX.pos, N = TX.nw, U = TX.uv; let o = 0;
  for (const [kind, at, cnt] of segs) for (let i = at; i < at + cnt; i++) {
    v[o] = P[i * 3] * s; v[o + 1] = P[i * 3 + 1] * s; v[o + 2] = P[i * 3 + 2] * s; v[o + 3] = N[i * 4] / 127; v[o + 4] = N[i * 4 + 1] / 127; v[o + 5] = N[i * 4 + 2] / 127;
    v[o + 6] = U[i * 2] / 65535; v[o + 7] = 1 - U[i * 2 + 1] / 65535; /* the atlas image is stored top row first */ v[o + 8] = (N[i * 4 + 3] & 255) / 255 * 0.5; v[o + 9] = kind ? -21 : -20; o += 10;
  }
  return { v, count: n };
}
