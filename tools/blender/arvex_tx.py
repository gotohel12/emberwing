# ARVEX — textured models from real scans (Poly Haven, CC0), prepared in Blender for the game.
# Run inside Blender through the bridge (globals: bpy, ROOT). Reads cc0/polyhaven/<id>/, writes out/tx/:
#   atlas_d.png (albedo + alpha) · atlas_n.png (normal.xy, roughness, metalness) · arvex_tx.bin · tx_meta.json · previews.
# Trees: the trunk is decimated and re-baked onto its own tile; the crown becomes a cloud of cards, each one a render of a slab of the
# real foliage. Small plants and grass become crossed cards the same way. Rocks keep their scanned surface on a decimated mesh.
import bpy, os, json, math, struct, time, random
import numpy as np
from mathutils import Vector

BASE = os.path.dirname(ROOT); PH = os.path.join(BASE, 'cc0', 'polyhaven'); OUT = os.path.join(BASE, 'out', 'tx'); os.makedirs(OUT, exist_ok=True)
CFG = globals().get('TX_CFG') or {}
TILE = CFG.get('tile', 512); GRID = CFG.get('grid', 8); ATLAS = TILE * GRID; PAD = 3
TREES = CFG.get('trees', [])        # [id, game type, target height m]
PLANTS = CFG.get('plants', [])      # [id, part name, target height m, cards]
ROCKS = CFG.get('rocks', [])        # [id, part name]
D = np.zeros((ATLAS, ATLAS, 4), np.float32); N = np.zeros((ATLAS, ATLAS, 4), np.float32); N[..., 0] = 0.5; N[..., 1] = 0.5; N[..., 2] = 0.8
tiles = 0; parts = {}; meta = {}; verts = []          # verts: (x,y,z, nx,ny,nz, wind, u,v) in GAME space (x right, y up, z = -blender y)
log = print

def win():
    return bpy.context.window_manager.windows[0]
def ctx(active=None, sel=None):
    """override for operators run from the bridge timer: a window, a 3D viewport, and the wanted selection"""
    w = win(); kw = dict(window=w)
    for a in w.screen.areas:
        if a.type == 'VIEW_3D':
            kw['area'] = a; kw['region'] = [r for r in a.regions if r.type == 'WINDOW'][0]; break
    if active is not None:
        sel = sel or [active]
        for o in bpy.context.view_layer.objects: o.select_set(o in sel)
        bpy.context.view_layer.objects.active = active; kw.update(active_object=active, object=active, selected_objects=sel, selected_editable_objects=sel)
    return bpy.context.temp_override(**kw)
def clear():
    for o in list(bpy.data.objects): bpy.data.objects.remove(o, do_unlink=True)
    for coll in (bpy.data.meshes, bpy.data.materials, bpy.data.images, bpy.data.cameras, bpy.data.lights):
        for b in list(coll):
            if b.users == 0: coll.remove(b)
def load(aid):
    d = os.path.join(PH, aid); f = [x for x in os.listdir(d) if x.endswith('.gltf')][0]; before = set(bpy.data.objects)
    with ctx(): bpy.ops.import_scene.gltf(filepath=os.path.join(d, f))
    obs = [o for o in bpy.data.objects if o not in before and o.type == 'MESH']
    bpy.context.view_layer.update()
    for o in obs:
        if o.parent: mw = o.matrix_world.copy(); o.parent = None; o.matrix_world = mw
    for o in [o for o in bpy.data.objects if o not in before and o.type != 'MESH']: bpy.data.objects.remove(o, do_unlink=True)
    bpy.context.view_layer.update()
    return obs
def split_by_material(obs):
    out = []
    for o in obs:
        if len([s for s in o.material_slots if s.material]) > 1:
            before = set(bpy.data.objects)
            with ctx(o):
                bpy.ops.object.mode_set(mode='EDIT'); bpy.ops.mesh.select_all(action='SELECT'); bpy.ops.mesh.separate(type='MATERIAL'); bpy.ops.object.mode_set(mode='OBJECT')
            out += [o] + [x for x in bpy.data.objects if x not in before and x.type == 'MESH']
        else: out.append(o)
    return out
def matname(o):
    for s in o.material_slots:
        if s.material: return s.material.name.lower()
    return ''
def wbox(obs):
    lo = Vector((1e9, 1e9, 1e9)); hi = Vector((-1e9, -1e9, -1e9))
    for o in obs:
        for c in o.bound_box:
            p = o.matrix_world @ Vector(c)
            for i in range(3): lo[i] = min(lo[i], p[i]); hi[i] = max(hi[i], p[i])
    return lo, hi
def tile_rect(i):
    c, r = i % GRID, i // GRID; return c * TILE, r * TILE
def new_tile():
    global tiles
    if tiles >= GRID * GRID: raise RuntimeError('atlas full')
    tiles += 1; return tiles - 1
def img_np(img, size):
    if img.size[0] != size or img.size[1] != size: img = img.copy(); img.scale(size, size)
    a = np.empty(size * size * 4, np.float32); img.pixels.foreach_get(a); return a.reshape(size, size, 4)
def put(tile, arr, target):
    x, y = tile_rect(tile); target[y:y + TILE, x:x + TILE, :] = arr
def bleed(a):                       # colour under the transparent pixels: no dark fringe when the texture is filtered
    m = a[..., 3] > 0.5
    if m.any(): a[~m, :3] = a[m, :3].mean(axis=0)
    return a
def uv_to_atlas(tile, u, v):
    x, y = tile_rect(tile); k = (TILE - 2 * PAD) / ATLAS; return (x + PAD) / ATLAS + u * k, (y + PAD) / ATLAS + v * k
def G(p):                           # Blender (x, y, z up) → game (x, y up, z)
    return (p[0], p[2], -p[1])
def add_part(name, kind, tris):     # tris: flat list of 9-tuples per vertex, count multiple of 3
    parts.setdefault(name, []).append([kind, len(tris)]); verts.extend(tris)

# ------------------------------------------------------------------ rendering slabs of the real model into tiles
def setup_render():
    sc = bpy.context.scene
    for e in ('BLENDER_EEVEE', 'BLENDER_EEVEE_NEXT'):
        try: sc.render.engine = e; break
        except Exception: pass
    sc.render.film_transparent = True; sc.render.resolution_x = TILE; sc.render.resolution_y = TILE; sc.render.resolution_percentage = 100
    sc.render.image_settings.file_format = 'PNG'; sc.render.image_settings.color_mode = 'RGBA'; sc.view_settings.view_transform = 'Standard'
    try: sc.view_settings.look = 'None'
    except Exception: pass
    w = bpy.data.worlds.new('flat') if not bpy.data.worlds.get('flat') else bpy.data.worlds['flat']; w.use_nodes = True; bg = w.node_tree.nodes.get('Background')
    if bg: bg.inputs[0].default_value = (1, 1, 1, 1); bg.inputs[1].default_value = 1.0
    sc.world = w
    cam = bpy.data.objects.get('txcam')
    if not cam: cam = bpy.data.objects.new('txcam', bpy.data.cameras.new('txcam')); sc.collection.objects.link(cam)
    cam.data.type = 'ORTHO'; sc.camera = cam; return sc, cam
def render_slab(centre, ang, off, thick, w, h, show, hide, name):
    """orthographic look along -d (d = horizontal direction at angle ang) at the slab [off - thick/2, off + thick/2]; returns (rgba TILE², centre, right, up)"""
    sc, cam = setup_render(); d = Vector((math.cos(ang), math.sin(ang), 0)); c = Vector(centre) + d * off
    cam.location = c + d * (thick / 2); cam.rotation_euler = (math.pi / 2, 0, ang + math.pi / 2)
    cam.data.clip_start = 0.001; cam.data.clip_end = thick; cam.data.ortho_scale = max(w, h)
    sc.render.pixel_aspect_x = w / h if w > h else 1.0; sc.render.pixel_aspect_y = h / w if h > w else 1.0
    # with non-square pixels the square image covers exactly w x h
    for o in show: o.hide_render = False
    for o in hide: o.hide_render = True
    f = os.path.join(OUT, 'r_' + name + '.png'); sc.render.filepath = f
    with ctx(): bpy.ops.render.render(write_still=True)
    img = bpy.data.images.load(f, check_existing=False); a = img_np(img, TILE).copy(); bpy.data.images.remove(img)
    bpy.context.view_layer.update(); R = cam.matrix_world.to_3x3(); right = R @ Vector((1, 0, 0)); up = R @ Vector((0, 1, 0))
    return a, c, right, up
def card(tile, a, c, right, up, w, h, crown_c, y0, y1, trim=True):
    """two triangles for a rendered slab, trimmed to where the picture has anything in it"""
    al = a[..., 3] > 0.08
    if not al.any(): return []
    ys = np.where(al.any(axis=1))[0]; xs = np.where(al.any(axis=0))[0]
    u0, u1, v0, v1 = (xs[0] / TILE, (xs[-1] + 1) / TILE, ys[0] / TILE, (ys[-1] + 1) / TILE) if trim else (0, 1, 0, 1)
    out = []
    def vtx(u, v):
        p = c + right * ((u - 0.5) * w) + up * ((v - 0.5) * h); n = (p - Vector(crown_c)); n.z = n.z * 0.8 + 0.3 * max(w, h)
        n = n.normalized() if n.length > 1e-6 else Vector((0, 0, 1)); wind = max(0.0, min(1.0, (p.z - y0) / max(y1 - y0, 1e-3)))
        au, av = uv_to_atlas(tile, u, v); return G(p) + G(n) + (wind, au, av)
    q = [vtx(u0, v0), vtx(u1, v0), vtx(u1, v1), vtx(u0, v1)]
    return [q[0], q[1], q[2], q[0], q[2], q[3]]

# ------------------------------------------------------------------ solid meshes: decimate, (re)bake, export with atlas uvs
def decimated(o, tris):
    me = o.data; n = sum(len(p.vertices) - 2 for p in me.polygons)
    for m in list(o.modifiers): o.modifiers.remove(m)
    if n > tris:
        m = o.modifiers.new('dec', 'DECIMATE'); m.ratio = max(0.0005, tris / n); m.use_collapse_triangulate = True
    m2 = o.modifiers.new('tri', 'TRIANGULATE')
    dg = bpy.context.evaluated_depsgraph_get(); dg.update(); ev = o.evaluated_get(dg); me2 = bpy.data.meshes.new_from_object(ev, depsgraph=dg)
    for m in list(o.modifiers): o.modifiers.remove(m)
    return me2
def mat_images(mat):
    """base colour, normal and ARM (ao/rough/metal) images of a glTF material"""
    r = {}
    if not mat or not mat.use_nodes: return r
    for nd in mat.node_tree.nodes:
        if nd.type == 'TEX_IMAGE' and nd.image:
            n = nd.image.name.lower()
            if '_nor' in n: r['n'] = nd.image
            elif '_arm' in n or '_rough' in n: r['arm'] = nd.image
            elif '_diff' in n or '_col' in n or 'd' not in r: r['d'] = nd.image
    return r
def uv_range(me):
    uv = np.empty(len(me.loops) * 2, np.float32); me.uv_layers.active.data.foreach_get('uv', uv); uv = uv.reshape(-1, 2); return float(uv.min()), float(uv.max())
def export_solid(me, mw, tile, name, kind=0, scale=1.0, origin=(0, 0, 0), uvmap=None):
    me.calc_loop_triangles() if hasattr(me, 'calc_loop_triangles') else None
    uvl = (me.uv_layers[uvmap] if uvmap else me.uv_layers.active).data; out = []; nm = mw.to_3x3().inverted().transposed(); O = Vector(origin)
    cn = getattr(me, 'corner_normals', None)
    for t in me.loop_triangles:
        for k in range(3):
            li = t.loops[k]; p = (mw @ me.vertices[t.vertices[k]].co - O) * scale
            n = (nm @ (Vector(cn[li].vector) if cn else Vector(t.split_normals[k]))).normalized(); u, v = uvl[li].uv
            au, av = uv_to_atlas(tile, min(1.0, max(0.0, u)), min(1.0, max(0.0, v))); out.append(G(p) + G(n) + (0.0, au, av))
    add_part(name, kind, out); return len(out) // 3
def bake_to_tile(o_src_mat, me, tile):
    """bake the material of a (decimated) mesh onto a fresh unwrap: colour → albedo atlas, normal + roughness → normal atlas"""
    sc = bpy.context.scene; o = bpy.data.objects.new('bake', me); sc.collection.objects.link(o); me.materials.clear(); me.materials.append(o_src_mat)
    src = me.uv_layers.active.name; nu = me.uv_layers.new(name='bk')
    for l in me.uv_layers: l.active_render = (l.name == src)
    me.uv_layers.active = nu
    with ctx(o):
        bpy.ops.object.mode_set(mode='EDIT'); bpy.ops.mesh.select_all(action='SELECT'); bpy.ops.uv.smart_project(angle_limit=1.15, island_margin=0.02); bpy.ops.object.mode_set(mode='OBJECT')
    nt = o_src_mat.node_tree; nd = nt.nodes.new('ShaderNodeTexImage'); res = {}
    prev = sc.render.engine; sc.render.engine = 'CYCLES'; sc.cycles.samples = 4
    try: sc.cycles.device = 'CPU'
    except Exception: pass
    for key, typ, kw in (('d', 'DIFFUSE', dict(pass_filter={'COLOR'})), ('n', 'NORMAL', {}), ('r', 'ROUGHNESS', {})):
        img = bpy.data.images.new('bk_' + key, TILE, TILE, alpha=True); img.colorspace_settings.name = 'sRGB' if key == 'd' else 'Non-Color'
        nd.image = img; nt.nodes.active = nd
        for n2 in nt.nodes: n2.select = (n2 == nd)
        with ctx(o):
            bpy.ops.object.bake(type=typ, margin=6, use_clear=True, **kw)
        res[key] = img_np(img, TILE).copy(); bpy.data.images.remove(img)
    nt.nodes.remove(nd); sc.render.engine = prev
    d = res['d']; d[..., 3] = 1.0; put(tile, d, D)
    n = np.zeros((TILE, TILE, 4), np.float32); n[..., 0] = res['n'][..., 0]; n[..., 1] = res['n'][..., 1]; n[..., 2] = res['r'][..., 0]; n[..., 3] = 0.0; put(tile, n, N)
    return o
def copy_to_tile(mat, tile):
    im = mat_images(mat); d = img_np(im['d'], TILE).copy(); d[..., 3] = 1.0; put(tile, d, D)
    n = np.zeros((TILE, TILE, 4), np.float32); n[..., 0] = 0.5; n[..., 1] = 0.5; n[..., 2] = 0.85
    if 'n' in im: nn = img_np(im['n'], TILE); n[..., 0] = nn[..., 0]; n[..., 1] = nn[..., 1]
    if 'arm' in im: n[..., 2] = img_np(im['arm'], TILE)[..., 1]
    put(tile, n, N)

# ------------------------------------------------------------------ the three kinds of asset
def do_tree(aid, typ, height, idx):
    t0 = time.time(); clear(); obs = split_by_material(load(aid)); lo, hi = wbox(obs); H = hi.z - lo.z; s = height / H
    leaf = [o for o in obs if any(k in matname(o) for k in ('leaf', 'leaves', 'branch', 'twig', 'needle', 'flower'))]; trunk = [o for o in obs if o not in leaf]
    if not leaf or not trunk: leaf = sorted(obs, key=lambda o: -len(o.data.polygons))[:max(1, len(obs) - 1)]; trunk = [o for o in obs if o not in leaf]
    log(aid, 'objects', [(o.name, matname(o), len(o.data.polygons)) for o in obs], 'H', round(H, 2))
    llo, lhi = wbox(leaf); cc = ((llo.x + lhi.x) / 2, (llo.y + lhi.y) / 2, (llo.z + lhi.z) / 2); R = max(lhi.x - llo.x, lhi.y - llo.y) / 2; ch = lhi.z - llo.z
    base = Vector(((lo.x + hi.x) / 2, (lo.y + hi.y) / 2, lo.z))
    if trunk: tl, th = wbox(trunk); base = Vector(((tl.x + th.x) / 2, (tl.y + th.y) / 2, lo.z))
    name = 'tree:%s:%d' % (typ, idx); cards = []
    def cv(tris): return [(((v[0] - base.x) * s, (v[1] - base.z) * s, (v[2] + base.y) * s) + v[3:]) for v in tris]   # card vertices are already in game axes: re-origin at the foot of the trunk and scale
    # crown: three directions, a centre slab and two outer ones each
    for ai, ang in enumerate((0.0, math.pi / 3, 2 * math.pi / 3)):
        for oi, off in enumerate((0.0, R * 0.45, -R * 0.45)):
            tile = new_tile(); a, c, right, up = render_slab(cc, ang, off, R * (0.7 if oi == 0 else 0.6), 2 * R, ch, leaf, trunk, '%s_%d_%d' % (aid, ai, oi)); put(tile, bleed(a), D)
            cards.append((oi, cv(card(tile, a, c, right, up, 2 * R, ch, cc, llo.z, lhi.z))))
    # far impostors: the whole tree from two sides
    far = []; allc = ((lo.x + hi.x) / 2, (lo.y + hi.y) / 2, (lo.z + hi.z) / 2); W = max(hi.x - lo.x, hi.y - lo.y)
    for ai, ang in enumerate((0.3, 0.3 + math.pi / 2)):
        tile = new_tile(); a, c, right, up = render_slab(allc, ang, 0.0, W * 1.2, W, H, leaf + trunk, [], '%s_far%d' % (aid, ai)); put(tile, bleed(a), D)
        far += cv(card(tile, a, c, right, up, W, H, cc, lo.z, hi.z))
    # trunk: decimated, re-baked on its own tile
    tt = []
    if trunk:
        with ctx(trunk[0], trunk):
            if len(trunk) > 1: bpy.ops.object.join()
        tr = trunk[0]; mat = tr.material_slots[0].material; tile = new_tile(); me = decimated(tr, 1400); bo = bake_to_tile(mat, me, tile)
        for lod, n in ((0, 1400), (2, 420)):
            m2 = me if lod == 0 else decimated(bo, n); k0 = len(verts); export_solid(m2, tr.matrix_world, tile, '_tmp', 0, s, tuple(base), 'bk'); tt.append((lod, verts[k0:])); del verts[k0:]; parts.pop('_tmp', None)
    for lod, pick in ((0, (0, 1, 2)), (2, (0, 1))):
        tk = [t for l, t in tt if l == lod]
        if tk: add_part('%s~%d' % (name, lod), 0, tk[0])
        cs = [v for oi, c in cards if oi in pick for v in c]; add_part('%s~%d' % (name, lod), 1, cs)
    add_part(name + '~1', 1, far)
    meta[name] = dict(src=aid, height=round(height, 2), crownR=round(R * s, 2), trunkR=round((max(th.x - tl.x, th.y - tl.y) / 2 * s) if trunk else 0.2, 2))
    log(aid, 'done', round(time.time() - t0, 1), 's', 'tiles', tiles)
def do_plant(aid, name, height, ncards=2):
    t0 = time.time(); clear(); obs = load(aid); lo, hi = wbox(obs); H = hi.z - lo.z; W = max(hi.x - lo.x, hi.y - lo.y); s = height / H
    c0 = ((lo.x + hi.x) / 2, (lo.y + hi.y) / 2, (lo.z + hi.z) / 2); base = Vector((c0[0], c0[1], lo.z)); out = []
    for i in range(ncards):
        ang = math.pi * i / ncards + 0.2; tile = new_tile(); a, c, right, up = render_slab(c0, ang, 0.0, W * 1.3, W, H, obs, [], '%s_%d' % (aid, i)); put(tile, bleed(a), D)
        out += [(((v[0] - base.x) * s, (v[1] - base.z) * s, (v[2] + base.y) * s) + v[3:]) for v in card(tile, a, c, right, up, W, H, c0, lo.z, hi.z)]
    add_part(name, 1, out); meta[name] = dict(src=aid, height=round(height, 2), width=round(W * s, 2)); log(aid, 'plant done', round(time.time() - t0, 1), 's', 'tiles', tiles)
def do_rock(aid, name):
    t0 = time.time(); clear(); obs = load(aid)
    with ctx(obs[0], obs):
        if len(obs) > 1: bpy.ops.object.join()
    o = obs[0]; lo, hi = wbox([o]); size = max(hi.x - lo.x, hi.y - lo.y, hi.z - lo.z); s = 1.0 / size; base = ((lo.x + hi.x) / 2, (lo.y + hi.y) / 2, lo.z)
    mat = o.material_slots[0].material; tile = new_tile(); u0, u1 = uv_range(o.data); log(aid, 'tris', len(o.data.polygons), 'uv', round(u0, 2), round(u1, 2), 'size', round(size, 2))
    copy_to_tile(mat, tile)
    for lod, n in ((0, 700), (2, 260), (1, 90)):
        export_solid(decimated(o, n), o.matrix_world, tile, '%s~%d' % (name, lod), 0, s, base)
    meta[name] = dict(src=aid, w=round((hi.x - lo.x) * s, 3), h=round((hi.z - lo.z) * s, 3), d=round((hi.y - lo.y) * s, 3)); log(aid, 'rock done', round(time.time() - t0, 1), 's', 'tiles', tiles)

def save():
    T = len(verts); a = np.array(verts, np.float32).reshape(T, 9) if T else np.zeros((0, 9), np.float32)
    pos = a[:, 0:3].astype('<f4').tobytes(); nw = np.empty((T, 4), np.int8); nw[:, 0:3] = np.clip(np.round(a[:, 3:6] * 127), -127, 127); nw[:, 3] = np.clip(np.round(a[:, 6] * 255), 0, 255).astype(np.uint8).view(np.int8)
    uv = np.clip(np.round(a[:, 7:9] * 65535), 0, 65535).astype('<u2').tobytes()
    head = json.dumps(dict(total=T, parts=parts, meta=meta, tile=TILE, grid=GRID)).encode(); pad = (-(8 + len(head))) % 4; head += b' ' * pad
    open(os.path.join(OUT, 'arvex_tx.bin'), 'wb').write(b'ARTX' + struct.pack('<I', len(head)) + head + pos + nw.tobytes() + uv)
    json.dump(dict(parts={k: sum(n for _, n in v) // 3 for k, v in parts.items()}, meta=meta, tiles=tiles), open(os.path.join(OUT, 'tx_meta.json'), 'w'), indent=1)
    for nm, arr, cs in (('atlas_d', D, 'sRGB'), ('atlas_n', N, 'Non-Color')):
        img = bpy.data.images.new(nm, ATLAS, ATLAS, alpha=True); img.colorspace_settings.name = cs; img.pixels.foreach_set(arr.reshape(-1)); img.filepath_raw = os.path.join(OUT, nm + '.png'); img.file_format = 'PNG'; img.save(); bpy.data.images.remove(img)
    log('saved', T // 3, 'triangles', tiles, 'tiles')

def run():
    idx = {}
    for aid, typ, h in TREES:
        try: do_tree(aid, typ, h, idx.get(typ, 0)); idx[typ] = idx.get(typ, 0) + 1
        except Exception as e:
            import traceback; log('TREE FAIL', aid, traceback.format_exc()[-600:])
    for aid, name, h, nc in PLANTS:
        try: do_plant(aid, name, h, nc)
        except Exception as e:
            import traceback; log('PLANT FAIL', aid, traceback.format_exc()[-600:])
    for aid, name in ROCKS:
        try: do_rock(aid, name)
        except Exception as e:
            import traceback; log('ROCK FAIL', aid, traceback.format_exc()[-600:])
    save()
run()
