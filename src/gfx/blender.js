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
    Object.assign(BL, { parts, f, sl, ao, fpArm: H.fpArm || 1, rig: H.rig || null, slots: H.slots, order: H.slotOrder, emissive: H.emissive || {}, ready: true, ver: BL.ver + 1 });
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

/** grip point inside the curled fingers, in forearm (elbow) space */
export function gripPt(RG, sd = 1) { const w = RG.wr, L = Math.hypot(w[0], w[1], w[2]), k = 1 + 0.085 / L; return [sd * (w[0] * k - 0.03), w[1] * k, w[2] * k - 0.01]; }

/** first-person arm from the realistic forearm+hand: wrist placed at the view-model wrist, forearm stretched toward the elbow */
export const FP = { roll: 1.57 };
export function fpArm(mb, side, grip) {
  const RG = BL.rig, m = blMesh('armL', {}); if (!RG || !m) return false;
  const w = RG.wr, L = Math.hypot(w[0], w[1], w[2]), a = [w[0] / L, w[1] / L, w[2] / L], g0 = gripPt(RG, 1);
  const eF = [0.07, -0.36, 0.46], wF = [0.012, -0.07, 0.075]; let b = [wF[0] - eF[0], wF[1] - eF[1], wF[2] - eF[2]]; const bl = Math.hypot(...b); b = b.map(x => x / bl);
  // rotation a -> b (Rodrigues), then roll about b
  const cr = [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]], sn = Math.hypot(...cr), cs = a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const k = sn > 1e-6 ? cr.map(x => x / sn) : [1, 0, 0], ang = Math.atan2(sn, cs);
  const rot = (v, ax, t) => { const c = Math.cos(t), s = Math.sin(t), d = ax[0] * v[0] + ax[1] * v[1] + ax[2] * v[2], x = [ax[1] * v[2] - ax[2] * v[1], ax[2] * v[0] - ax[0] * v[2], ax[0] * v[1] - ax[1] * v[0]]; return [v[0] * c + x[0] * s + ax[0] * d * (1 - c), v[1] * c + x[1] * s + ax[1] * d * (1 - c), v[2] * c + x[2] * s + ax[2] * d * (1 - c)]; };
  const T = v => rot(rot(v, k, ang), b, FP.roll), v = m.v, out = [];
  for (let i = 0; i < v.length; i += 10) {
    let p = [v[i] - w[0], v[i + 1] - w[1], v[i + 2] - w[2]]; const t = p[0] * a[0] + p[1] * a[1] + p[2] * a[2];
    if (t < 0) { p = [p[0] + a[0] * t * 0.6, p[1] + a[1] * t * 0.6, p[2] + a[2] * t * 0.6]; }      // stretch the forearm toward the elbow
    p = [p[0] + w[0] - g0[0], p[1] + w[1] - g0[1], p[2] + w[2] - g0[2]];
    let q = T(p), n = T([v[i + 3], v[i + 4], v[i + 5]]);
    out.push([side * q[0] + grip[0], q[1] + grip[1], q[2] + grip[2], side * n[0], n[1], n[2], v[i + 6], v[i + 7], v[i + 8], v[i + 9]]);
  }
  for (let i = 0; i < out.length; i += 3) { const o = side < 0 ? [out[i], out[i + 2], out[i + 1]] : [out[i], out[i + 1], out[i + 2]]; for (const x of o) mb.v.push(...x); }
  return true;
}
