// ARVEX — loader for the models built in Blender (tools/blender/arvex_build.py → public/models/arvex_models.bin)
// Format: 'ARVX' u32 headerLen, JSON header, float32 [pos3 nrm3] per vertex, u8 slot per vertex, u8 AO per vertex.
// Meshes come out as MeshBuilder-compatible { v: Float32Array } (pos3 nrm3 col3 emissive1).
export const BL = { ready: false, ver: 0, parts: null, slots: null, emissive: null };

export async function loadBlenderModels(url = 'models/arvex_models.bin') {
  try {
    const r = await fetch(url); if (!r.ok) return false; const buf = await r.arrayBuffer(), dv = new DataView(buf);
    if (dv.getUint32(0, true) !== 0x58565241) return false;                 // 'ARVX'
    const hl = dv.getUint32(4, true), H = JSON.parse(new TextDecoder().decode(new Uint8Array(buf, 8, hl)));
    const T = H.total, fo = 8 + hl, f = new Float32Array(buf, fo, T * 6), sl = new Uint8Array(buf, fo + T * 24, T), ao = new Uint8Array(buf, fo + T * 25, T);
    const parts = {}; let at = 0;
    for (const name in H.parts) { const segs = []; for (const [slot, n] of H.parts[name]) { segs.push([slot, at, n]); at += n; } parts[name] = segs; }
    Object.assign(BL, { parts, f, sl, ao, rig: H.rig || null, slots: H.slots, order: H.slotOrder, emissive: H.emissive || {}, ready: true, ver: BL.ver + 1 });
    return true;
  } catch (e) { console.warn('ARVEX models', e); return false; }
}

export const hasBL = name => BL.ready && !!BL.parts[name];

/** build a part; colors: { slot: [r,g,b] } overrides; mirror: mirror across x (left/right); xf(p,n) optional transform */
export function blMesh(name, colors = {}, mirror = false) {
  const segs = BL.parts[name]; if (!segs) return null;
  let n = 0; for (const s of segs) n += s[2];
  const v = new Float32Array(n * 10); let o = 0;
  for (const [slot, at, cnt] of segs) {
    const c = colors[slot] || BL.slots[slot] || [1, 0, 1], e = BL.emissive[slot] || 0;
    for (let t = 0; t < cnt; t += 3) {
      for (let k = 0; k < 3; k++) {
        const i = at + t + (mirror && k ? 3 - k : k), b = i * 6, a = BL.ao[i] / 255;
        v[o] = mirror ? -BL.f[b] : BL.f[b]; v[o + 1] = BL.f[b + 1]; v[o + 2] = BL.f[b + 2];
        v[o + 3] = mirror ? -BL.f[b + 3] : BL.f[b + 3]; v[o + 4] = BL.f[b + 4]; v[o + 5] = BL.f[b + 5];
        v[o + 6] = c[0] * a; v[o + 7] = c[1] * a; v[o + 8] = c[2] * a; v[o + 9] = e; o += 10;
      }
    }
  }
  return { v, count: n };
}

/** append a Blender part into a MeshBuilder, mirrored and offset */
export function blAppend(mb, name, off = [0, 0, 0], mirror = false, colors = {}) {
  const m = blMesh(name, colors, mirror); if (!m) return false; const v = m.v;
  for (let i = 0; i < v.length; i += 10) mb.v.push(v[i] + off[0], v[i + 1] + off[1], v[i + 2] + off[2], v[i + 3], v[i + 4], v[i + 5], v[i + 6], v[i + 7], v[i + 8], v[i + 9]);
  return true;
}
