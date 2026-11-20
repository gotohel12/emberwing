// ARVEX — photographed PBR surface textures (CC0, see public/textures/LICENSE.txt).
// Each layer is two JPGs: <name>_d (albedo with baked AO) and <name>_n (normal XY in RG, roughness in B).
// Meshes have no UVs: the renderer projects these triplanar (terrain: top-down + triplanar rock).
export const TEX_LAYERS = {
  grass: [0.333, 0.284, 0.105], dirt: [0.351, 0.292, 0.18], sand: [0.478, 0.44, 0.403], rock: [0.373, 0.268, 0.19], bark: [0.29, 0.263, 0.192],
  wood: [0.366, 0.286, 0.217], metal: [0.586, 0.488, 0.303], fabric: [0.238, 0.344, 0.43], leather: [0.544, 0.532, 0.465], stonewall: [0.357, 0.265, 0.201], skin: [0.779, 0.577, 0.482]
};
/** layers that also ship at 4K */
export const TEX_4K = ['grass', 'dirt', 'sand', 'rock', 'bark', 'stonewall', 'wood', 'metal'];
/** material id (MAT in models.js) → layer name */
export const MAT_LAYER = [null, 'rock', 'bark', 'wood', 'metal', 'skin', 'fabric', 'stonewall'];
/** texture sets: 5 layers bound at once. [layer, tiles per metre, metalness (-1 = skin), how much of the vertex colour replaces the photo's own colour] */
export const TEX_SETS = {
  terrain: [['grass', 0.34, 0, 0.72], ['dirt', 0.4, 0, 0.45], ['sand', 0.45, 0, 0.6], ['rock', 0.22, 0, 0.6], ['stonewall', 0.5, 0, 0.8]],
  world: [['rock', 0.42, 0, 0.7], ['bark', 0.9, 0, 0.8], ['wood', 1.1, 0, 0.9], ['metal', 1.4, 0.85, 0.94], ['stonewall', 0.5, 0, 0.8]],
  char: [['rock', 3.2, 0, 0.75], ['skin', 9, -1, 0.96], ['wood', 3.4, 0, 0.92], ['metal', 4.5, 0.85, 0.95], ['fabric', 6, 0, 0.97]]
};

export class TextureBank {
  constructor(gl) { this.gl = gl; this.tex = {}; this.res = 0; this.ready = false; this.loading = 0; this.aniso = gl.getExtension('EXT_texture_filter_anisotropic') || gl.getExtension('WEBKIT_EXT_texture_filter_anisotropic'); this.supported = gl.getParameter(gl.MAX_TEXTURE_IMAGE_UNITS) >= 14; }
  /** res: 0 off · 1 → 1K · 2 → 2K · 3 → 4K for the large surfaces (ground, rock, bark, wood, metal, walls) and 2K for the rest.
   *  A size that is not on this server (the web mirror only carries 1K) falls back to the next smaller one. */
  async load(res, base = 'textures/') {
    if (!this.supported || !res) { this.ready = false; return false; }
    if (this.res === res && this.ready) return true;
    const token = ++this.loading, names = [...new Set(Object.values(TEX_SETS).flat().map(l => l[0]))], out = {}, dirs = ['1k/', '2k/', '4k/'];
    const one = src => new Promise((ok, bad) => { const i = new Image(); i.onload = () => ok(i); i.onerror = () => bad(new Error('texture ' + src)); i.src = src; });
    const img = async (n, suffix) => { let top = Math.min(res, TEX_4K.includes(n) ? 3 : 2), err; for (let t = top; t >= 1; t--) { try { return await one(base + dirs[t - 1] + n + suffix); } catch (e) { err = e; } } throw err; };
    try {
      await Promise.all(names.map(async n => { const [d, nm] = await Promise.all([img(n, '_d.jpg'), img(n, '_n.jpg')]); out[n] = { d, n: nm }; }));
    } catch (e) { console.warn('ARVEX textures', e.message); if (token === this.loading) this.ready = false; return false; }
    if (token !== this.loading) return false;
    const gl = this.gl, old = this.tex; this.tex = {};
    for (const n of names) this.tex[n] = { d: this.up(out[n].d), n: this.up(out[n].n), avg: TEX_LAYERS[n] };
    for (const n in old) { gl.deleteTexture(old[n].d); gl.deleteTexture(old[n].n); }
    this.res = res; this.ready = true; return true;
  }
  up(image) {
    const gl = this.gl, t = gl.createTexture(); gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, t);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false); gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, gl.RGB, gl.UNSIGNED_BYTE, image); gl.generateMipmap(gl.TEXTURE_2D);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    if (this.aniso) gl.texParameterf(gl.TEXTURE_2D, this.aniso.TEXTURE_MAX_ANISOTROPY_EXT, Math.min(8, gl.getParameter(this.aniso.MAX_TEXTURE_MAX_ANISOTROPY_EXT)));
    return t;
  }
  free() { const gl = this.gl; this.loading++; for (const n in this.tex) { gl.deleteTexture(this.tex[n].d); gl.deleteTexture(this.tex[n].n); } this.tex = {}; this.ready = false; this.res = 0; }
}
