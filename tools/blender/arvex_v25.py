# ARVEX SURVIVAL 25.0 — Blender asset build (run inside Blender 5.x through bridge.py, or: exec(open(path).read()))
#   · character LODs: lighter copies of every body part (Decimate), plus one very light whole-body model for far away
#   · new models: explosives, locks, doors, storage boxes, base core, high walls, gate, watchtower, rocks (with LODs)
# Nothing in the existing pack is touched: this writes its own pack (out/v25/arvex_v25_parts.bin) and
# tools/blender/merge_pack.py adds the parts to public/models/arvex_models.bin.
# Coordinates are authored in GAME space (x right, y up, front = -z) and converted to Blender space.
import bpy, bmesh, math, json, struct, os, time, random
import numpy as np
from mathutils import Vector, Euler, noise

D = globals().get('ARVEX_DIR', r"C:\Users\mohse\Desktop\Mohsen ~ Danial Games\EMBERWING\arvex_blender")
SRC = os.path.join(D, 'out', 'arvex_models.bin')
OUT = os.path.join(D, 'out', 'v25'); os.makedirs(OUT, exist_ok=True)
ONLY = globals().get('ARVEX_ONLY', None)          # optional set of stages: {'human', 'props', 'rocks', 'render'}
TAU = math.pi * 2
random.seed(25)
T0 = time.time()
def stage(n): return ONLY is None or n in ONLY
def log(*a): print('[%.1fs]' % (time.time() - T0), *a)

def hx(h): h = h.lstrip('#'); return [int(h[i:i + 2], 16) / 255 for i in (0, 2, 4)]
SLOTS = {
  'skin': hx('#c69a7b'), 'skinD': hx('#a87a5c'), 'lip': hx('#a8665a'), 'nail': hx('#e2c2b0'),
  'eyeW': hx('#d8d0c6'), 'iris': hx('#3a2818'), 'pupil': hx('#0d0a08'), 'brow': hx('#2a1f17'), 'hair': hx('#2a1f17'),
  'shirt': hx('#4a5244'), 'shirtD': hx('#363c32'), 'button': hx('#2a2622'),
  'pants': hx('#3b372f'), 'pantsD': hx('#2b2822'), 'belt': hx('#2c2119'), 'buckle': hx('#9c8b62'),
  'boot': hx('#3a2c22'), 'sole': hx('#1c1916'), 'lace': hx('#6b5c48'),
  'sleeve': hx('#3d433a'), 'sleeveD': hx('#2d322b'),
  'wood': hx('#8a6440'), 'woodD': hx('#5c4128'), 'woodL': hx('#a8805a'), 'stock': hx('#5a3c28'),
  'stone': hx('#77736b'), 'stoneD': hx('#4e4b46'), 'flint': hx('#5a5650'),
  'metal': hx('#7a8086'), 'metalD': hx('#3e4247'), 'metalL': hx('#b5bcc2'), 'edge': hx('#d9dee2'), 'brass': hx('#b08d4a'),
  'cloth': hx('#8a8064'), 'leather': hx('#4a3426'), 'string': hx('#ddd6c8'), 'paper': hx('#2d5b8a'), 'ink': hx('#cfe2f3'),
  'flame': hx('#ff8a2a'), 'ember': hx('#ffcf6a'),
  # new in 25.0 (names keep the prefixes the game maps to surface textures: stone* rock, metal* metal, wood* wood, cloth*/string* fabric)
  'stoneL': hx('#9a958b'), 'stoneMoss': hx('#4f6332'), 'stoneOre': hx('#b0652e'), 'stoneOreL': hx('#d98a45'),
  'metalR': hx('#7a4a2a'), 'metalRed': hx('#8a2a22'), 'clothR': hx('#8e2f25'), 'stringRope': hx('#9a8660'), 'woodP': hx('#7d5a39'),
  'led': hx('#ff3a2a')
}
EMISSIVE = {'flame': 0.55, 'ember': 0.7, 'led': 0.9}

# ------------------------------------------------------------------ scene helpers (same conventions as arvex_build.py)
def clear():
  for o in list(bpy.data.objects): bpy.data.objects.remove(o, do_unlink=True)
  for d in (bpy.data.meshes, bpy.data.curves, bpy.data.materials):
    for x in list(d):
      try: d.remove(x)
      except Exception: pass
  for c in list(bpy.data.collections): bpy.data.collections.remove(c)

COLS = {}
def col_for(part):
  if part not in COLS:
    c = bpy.data.collections.new(part); bpy.context.scene.collection.children.link(c); COLS[part] = c
  return COLS[part]

MATS = {}
def mat(slot):
  if slot not in MATS:
    m = bpy.data.materials.new('ARVEX_' + slot); c = SLOTS[slot]
    lin = [((v + 0.055) / 1.055) ** 2.4 if v > 0.04045 else v / 12.92 for v in c]
    m.diffuse_color = (lin[0], lin[1], lin[2], 1)
    met = slot.startswith('metal') or slot in ('edge', 'brass')
    m.metallic = 0.85 if met else 0.0; m.roughness = 0.35 if met else 0.8
    MATS[slot] = m
  return MATS[slot]

def B(p): return Vector((-p[0], p[2], p[1]))          # game -> blender
def G(v): return (-v.x, v.z, v.y)                       # blender -> game
def rotg(p, r):
  if not r or r == (0, 0, 0): return Vector(p)
  return Euler(r, 'XYZ').to_matrix() @ Vector(p)

def link(name, data, part, slot, smooth=True):
  o = bpy.data.objects.new(name, data); col_for(part).objects.link(o)
  o['part'] = part; o['slot'] = slot
  if hasattr(data, 'materials') and not len(data.materials): data.materials.append(mat(slot))
  if isinstance(data, bpy.types.Mesh):
    for f in data.polygons: f.use_smooth = bool(smooth)
  return o

def mesh_from(name, verts_g, faces, part, slot, smooth=True, flat_faces=()):
  me = bpy.data.meshes.new(name); me.from_pydata([B(v) for v in verts_g], [], faces); me.validate(); me.update()
  o = link(name, me, part, slot, smooth)
  for i in flat_faces:
    if i < len(me.polygons): me.polygons[i].use_smooth = False
  return o

def bmfix(o):
  bm = bmesh.new(); bm.from_mesh(o.data); bmesh.ops.recalc_face_normals(bm, faces=bm.faces); bm.to_mesh(o.data); bm.free()

def bevel(o, w=0.003, seg=2, angle=40):
  m = o.modifiers.new('bev', 'BEVEL'); m.width = w; m.segments = seg; m.limit_method = 'ANGLE'; m.angle_limit = math.radians(angle)
  try: m.harden_normals = True
  except Exception: pass
  return o

def subsurf(o, lv=1):
  m = o.modifiers.new('sub', 'SUBSURF'); m.levels = lv; m.render_levels = lv; return o

def decimate(o, ratio):
  m = o.modifiers.new('dec', 'DECIMATE'); m.decimate_type = 'COLLAPSE'; m.ratio = max(0.0005, min(1.0, ratio))
  try: m.use_collapse_triangulate = True
  except Exception: pass
  return o

def box(part, slot, c, s, rot=None, bev=0.008, seg=1, taper=None, name='box'):
  hs = [s[0] / 2, s[1] / 2, s[2] / 2]; V = []
  for X in (-1, 1):
    for Y in (-1, 1):
      for Z in (-1, 1):
        p = Vector((X * hs[0], Y * hs[1], Z * hs[2]))
        if taper: p = Vector(taper(p))
        V.append(tuple(rotg(p, rot) + Vector(c)))
  F = [(0, 1, 3, 2), (4, 6, 7, 5), (0, 4, 5, 1), (2, 3, 7, 6), (0, 2, 6, 4), (1, 5, 7, 3)]
  o = mesh_from(name, V, F, part, slot, False); bmfix(o)
  if bev: bevel(o, min(bev, min(s) * 0.3), seg)
  return o

def frame(a, b):
  a, b = Vector(a), Vector(b); d = (b - a); L = d.length; d.normalize()
  t = Vector((1, 0, 0)) if abs(d.x) < 0.9 else Vector((0, 0, 1)); x = d.cross(t).normalized(); z = x.cross(d).normalized()
  return a, d, L, x, z

def tube(part, slot, a, b, r0, r1, seg=12, rings=1, cap=True, smooth=True, prof=None, wob=0.0, seed=0, name='tube'):
  """cylinder / cone between game points a,b. prof(t) -> radius multiplier, wob = noisy surface (logs, sticks)"""
  a_, d, L, x, z = frame(a, b); V = []; F = []
  for i in range(rings + 1):
    t = i / rings; r = (r0 + (r1 - r0) * t) * (prof(t) if prof else 1); c = a_ + d * (L * t)
    for k in range(seg):
      an = k / seg * TAU; rr = r
      if wob: rr *= 1 + wob * noise.noise(Vector((math.cos(an) * 1.7 + seed, t * L * 1.3 + seed * 0.37, math.sin(an) * 1.7)))
      V.append(tuple(c + (x * math.cos(an) + z * math.sin(an)) * rr))
  for i in range(rings):
    for k in range(seg):
      A = i * seg + k; Bk = i * seg + (k + 1) % seg; F.append((A, Bk, Bk + seg, A + seg))
  flat = []
  if cap:
    flat.append(len(F)); F.append(tuple(reversed(range(seg))))
    flat.append(len(F)); F.append(tuple(range(rings * seg, rings * seg + seg)))
  o = mesh_from(name, V, F, part, slot, smooth, flat); bmfix(o); return o

def torus(part, slot, c, R, r, seg=20, tseg=8, rot=None, scale=(1, 1, 1), arc=1.0, name='torus'):
  V = []; F = []; n = seg if arc >= 1 else seg + 1
  for i in range(n):
    a = i / seg * TAU * arc
    for j in range(tseg):
      b = j / tseg * TAU; p = Vector(((R + r * math.cos(b)) * math.cos(a), r * math.sin(b), (R + r * math.cos(b)) * math.sin(a)))
      p = Vector((p.x * scale[0], p.y * scale[1], p.z * scale[2])); V.append(tuple(rotg(p, rot) + Vector(c)))
  for i in range(seg if arc >= 1 else seg):
    i2 = (i + 1) % n if arc >= 1 else i + 1
    for j in range(tseg):
      A = i * tseg + j; Bq = i2 * tseg + j; C_ = i2 * tseg + (j + 1) % tseg; Dq = i * tseg + (j + 1) % tseg
      F.append((A, Dq, C_, Bq))
  o = mesh_from(name, V, F, part, slot, True); bmfix(o); return o

def ell(part, slot, c, s, seg=16, ring=10, rot=None, fn=None, name='ell'):
  bm = bmesh.new(); bmesh.ops.create_uvsphere(bm, u_segments=seg, v_segments=ring, radius=1.0)
  for v in bm.verts:
    u = Vector((-v.co.x, v.co.z, v.co.y)); g = Vector((u.x * s[0], u.y * s[1], u.z * s[2]))
    if fn: g = Vector(fn(g, u))
    g = rotg(g, rot) + Vector(c); v.co = B(g)
  me = bpy.data.meshes.new(name); bm.to_mesh(me); bm.free()
  return link(name, me, part, slot, True)

def prism(part, slot, prof, x0, x1, bev=0.006, name='prism'):
  """extrude a side-view profile [(z, y)] along x between x0 and x1"""
  n = len(prof); V = [(x0, y, z) for (z, y) in prof] + [(x1, y, z) for (z, y) in prof]
  F = [tuple(range(n)), tuple(reversed(range(n, 2 * n)))]
  for i in range(n):
    j = (i + 1) % n; F.append((i, j, n + j, n + i))
  o = mesh_from(name, V, F, part, slot, False); bmfix(o)
  if bev: bevel(o, bev, 2, 30)
  return o

def move_part(part, new, off=(0, 0, 0), rot=None, scale=1.0):
  """copy every object of `part` into part `new`, transformed in game space (used for the held versions of placed models)"""
  dg = bpy.context.evaluated_depsgraph_get()
  for o in [o for o in bpy.data.objects if o.get('part') == part]:
    me = bpy.data.meshes.new_from_object(o.evaluated_get(dg))
    for v in me.vertices:
      g = Vector(G(v.co)) * scale; g = rotg(g, rot) + Vector(off); v.co = B(g)
    me.update(); n = bpy.data.objects.new(o.name + '_h', me); col_for(new).objects.link(n); n['part'] = new; n['slot'] = o['slot']

# ------------------------------------------------------------------ reading the existing pack (for the character LODs)
def load_pack(path):
  b = open(path, 'rb').read(); assert b[:4] == b'ARVX'
  hl = struct.unpack('<I', b[4:8])[0]; H = json.loads(b[8:8 + hl]); T = H['total']; fo = 8 + hl
  F = np.frombuffer(b, dtype='<f4', count=T * 6, offset=fo).reshape(T, 6); AO = np.frombuffer(b, dtype=np.uint8, count=T, offset=fo + T * 25)
  parts = {}; at = 0
  for name, segs in H['parts'].items():
    n = sum(c for _, c in segs); sl = []
    for s, c in segs: sl.extend([s] * (c // 3))
    parts[name] = {'P': F[at:at + n, :3], 'tslot': sl, 'n': n}; at += n
  return H, parts

def islands(faces, nv):
  parent = list(range(nv))
  def find(x):
    while parent[x] != x:
      parent[x] = parent[parent[x]]; x = parent[x]
    return x
  for a, b, c in faces:
    ra = find(a); rb = find(b)
    if rb != ra: parent[rb] = ra
    rc = find(c)
    if rc != ra: parent[rc] = ra
  return [find(f[0]) for f in faces]

def part_object(name, P, tslot, part, keep=None):
  """triangle soup (game space) -> welded Blender mesh object with one material per slot. keep(face_index) filters triangles."""
  key = np.round(P * 100000).astype(np.int64); uq, inv = np.unique(key, axis=0, return_inverse=True); inv = inv.reshape(-1, 3)
  faces = []; fsl = []
  for i, (a, b, c) in enumerate(inv.tolist()):
    if a == b or b == c or a == c: continue
    if keep is not None and not keep[i]: continue
    faces.append((a, b, c)); fsl.append(tslot[i])
  verts = (uq / 100000.0).tolist()
  me = bpy.data.meshes.new(name); me.from_pydata([B(v) for v in verts], [], faces); me.update(calc_edges=True)
  names = []
  for s in fsl:
    if s not in names: names.append(s)
  for s in names: me.materials.append(mat(s if s in SLOTS else 'skin'))
  if len(me.polygons) == len(fsl):
    for p, s in zip(me.polygons, fsl): p.material_index = names.index(s); p.use_smooth = True
  else:
    for p in me.polygons: p.use_smooth = True
  o = bpy.data.objects.new(name, me); col_for(part).objects.link(o); o['part'] = part; o['slot'] = names[0] if names else 'skin'
  return o, len(faces)

HUMAN = ['pelvis', 'torso', 'head', 'armU', 'armL', 'legU', 'legL', 'armU_l', 'armL_l', 'legU_l', 'legL_l']
# triangle budgets per level: 1 near · 2 middle · 3 low
BUDGET = {
  'head': (5200, 1100, 190), 'torso': (2400, 600, 150), 'pelvis': (700, 200, 60),
  'armU': (400, 90, 28), 'armL': (1600, 340, 70), 'legU': (500, 110, 34), 'legL': (1600, 340, 80)
}
def human_lods():
  H, parts = load_pack(SRC); rig = H.get('rig'); made = {}
  for name in HUMAN:
    if name not in parts: log('missing part', name); continue
    pt = parts[name]; P = pt['P']; tsl = pt['tslot']; base = name.replace('_l', '')
    key = np.round(P * 100000).astype(np.int64); uq, inv = np.unique(key, axis=0, return_inverse=True); inv = inv.reshape(-1, 3)
    lab = islands(inv.tolist(), len(uq)); cnt = {}
    for l in lab: cnt[l] = cnt.get(l, 0) + 1
    big = max(cnt.values())
    for lv in (1, 2, 3):
      # near level keeps every island of some size (eyes, collar, buttons); the low level keeps the main surfaces only
      lim = 250 if lv == 1 else 600 if lv == 2 else max(600, big // 3)
      keep = [cnt[l] >= lim for l in lab]
      o, nf = part_object('%s_L%d' % (name, lv), P, tsl, 'h%d:%s' % (lv, name), keep)
      tgt = BUDGET[base][lv - 1]; decimate(o, tgt / max(1, nf)); made['h%d:%s' % (lv, name)] = (nf, tgt)
    log('lod', name, 'tris', pt['n'] // 3, 'islands', len(cnt), 'main', big)
  # very far: one whole-body mesh assembled at the rig's rest pose from the low level, then reduced again
  if rig:
    R = {k: Vector(v) for k, v in rig.items()}; root = R['root']; torso = root + R['torso']; neck = torso + R['neck']
    def mir(v): return Vector((-v.x, v.y, v.z))
    POS = {'pelvis': root, 'torso': torso, 'head': neck, 'armU': torso + R['sh'], 'armL': torso + R['sh'] + R['el'], 'legU': root + R['hip'], 'legL': root + R['hip'] + R['knee'],
           'armU_l': torso + mir(R['sh']), 'armL_l': torso + mir(R['sh']) + mir(R['el']), 'legU_l': root + mir(R['hip']), 'legL_l': root + mir(R['hip']) + mir(R['knee'])}
    dg = bpy.context.evaluated_depsgraph_get(); V = []; Fc = []; fs = []
    for name in HUMAN:
      src = bpy.data.objects.get('%s_L3' % name)
      if not src: continue
      me = src.evaluated_get(dg).to_mesh(); me.calc_loop_triangles(); off = POS[name]; base = len(V)
      names = [m.name[6:] for m in me.materials]
      for v in me.vertices: g = Vector(G(v.co)) + off; V.append(B(g))
      for t in me.loop_triangles: Fc.append(tuple(base + i for i in t.vertices)); fs.append(names[t.material_index] if t.material_index < len(names) else 'skin')
      src.evaluated_get(dg).to_mesh_clear()
    me = bpy.data.meshes.new('humanFar'); me.from_pydata(V, [], Fc); me.update(); names = []
    for s in fs:
      if s not in names: names.append(s)
    for s in names: me.materials.append(mat(s))
    for p, s in zip(me.polygons, fs): p.material_index = names.index(s); p.use_smooth = True
    o = bpy.data.objects.new('humanFar', me); col_for('hfar').objects.link(o); o['part'] = 'hfar'; o['slot'] = 'shirt'
    decimate(o, 300 / max(1, len(Fc))); made['hfar'] = (len(Fc), 300)
  return made

# ------------------------------------------------------------------ new models
def planks(part, x0, x1, y0, y1, z, th, n, slots=('wood', 'woodL', 'woodP'), bev=0.006, gap=0.008, seed=0):
  w = (x1 - x0) / n
  for i in range(n):
    r = random.Random(seed * 131 + i)
    box(part, slots[(i + seed) % len(slots)], (x0 + (i + 0.5) * w, (y0 + y1) / 2 + r.uniform(-0.004, 0.004), z + r.uniform(-0.003, 0.003)), (w - gap, (y1 - y0) - r.uniform(0, 0.012), th), bev=bev)

def nails(part, pts, r=0.008, z=0.0, d=1, slot='metalD'):
  for (x, y) in pts: tube(part, slot, (x, y, z), (x, y, z + 0.008 * d), r, r * 0.8, 6, 1)

def door_wood():
  P = 'dep:door_wood'
  planks(P, -0.53, 0.53, 0.01, 2.15, 0.0, 0.06, 5, seed=1)
  for y in (0.3, 1.08, 1.86): box(P, 'woodD', (0, y, 0.04), (1.02, 0.13, 0.028), bev=0.006)
  for (ya, yb) in ((0.37, 1.01), (1.15, 1.79)):                                  # Z braces
    L = math.hypot(0.92, yb - ya); a = math.atan2(yb - ya, 0.92)
    box(P, 'woodD', (0, (ya + yb) / 2, 0.04), (L, 0.1, 0.026), rot=(0, 0, a), bev=0.005)
  for y in (0.34, 1.82):                                                          # strap hinges on the back
    box(P, 'metalD', (-0.27, y, -0.036), (0.5, 0.06, 0.012), bev=0.003, taper=lambda p: (p.x, p.y * (1.0 if p.x < 0 else 0.45), p.z))
    tube(P, 'metalD', (-0.53, y - 0.06, -0.03), (-0.53, y + 0.06, -0.03), 0.018, 0.018, 10)
    nails(P, [(-0.45 + k * 0.14, y) for k in range(4)], 0.008, -0.042, -1, 'metal')
  nails(P, [(-0.42 + k * 0.212, y + dy) for k in range(5) for y in (0.3, 1.08, 1.86) for dy in (-0.03, 0.03)], 0.007, 0.054, 1)
  box(P, 'metalD', (0.38, 1.05, 0.034), (0.07, 0.17, 0.01), bev=0.003)             # pull ring on a backing plate
  torus(P, 'metal', (0.38, 1.0, 0.052), 0.038, 0.007, 16, 6, rot=(math.pi / 2, 0, 0))
  tube(P, 'metal', (0.38, 1.045, 0.036), (0.38, 1.045, 0.056), 0.012, 0.01, 8)

def door_metal():
  P = 'dep:door_metal'
  box(P, 'metal', (0, 1.08, 0), (1.06, 2.16, 0.05), bev=0.004)
  for (c, s) in (((0, 2.1, 0.032), (1.06, 0.08, 0.02)), ((0, 0.06, 0.032), (1.06, 0.08, 0.02)), ((-0.49, 1.08, 0.032), (0.08, 2.1, 0.02)), ((0.49, 1.08, 0.032), (0.08, 2.1, 0.02)), ((0, 1.08, 0.032), (0.92, 0.09, 0.02)), ((0, 0.58, 0.03), (0.92, 0.05, 0.016)), ((0, 1.6, -0.03), (0.92, 0.07, 0.016)), ((0, 0.5, -0.03), (0.92, 0.07, 0.016))):
    box(P, 'metalD', c, s, bev=0.004)
  for sx in (-0.49, 0.49):
    nails(P, [(sx, 0.16 + k * 0.2) for k in range(10)], 0.011, 0.04, 1, 'metalL')
  nails(P, [(-0.36 + k * 0.18, y) for k in range(5) for y in (0.06, 1.08, 2.1)], 0.011, 0.04, 1, 'metalL')
  box(P, 'sole', (0, 1.62, 0.028), (0.3, 0.05, 0.012), bev=0.002)                  # viewing slot
  box(P, 'metalD', (0, 1.62, 0.036), (0.36, 0.11, 0.008), bev=0.003)
  box(P, 'sole', (0, 1.62, 0.041), (0.26, 0.034, 0.004), bev=0)
  tube(P, 'metalL', (0.4, 0.93, 0.085), (0.4, 1.17, 0.085), 0.013, 0.013, 10)       # bar handle
  for y in (0.95, 1.15): tube(P, 'metalD', (0.4, y, 0.03), (0.4, y, 0.085), 0.011, 0.011, 8)
  for y in (0.3, 1.08, 1.86): tube(P, 'metalD', (-0.53, y - 0.09, -0.02), (-0.53, y + 0.09, -0.02), 0.024, 0.024, 10)
  for k in range(4):                                                               # rust streaks under the rivets
    r = random.Random(40 + k); box(P, 'metalR', (r.uniform(-0.35, 0.35), r.uniform(0.3, 1.9), 0.0262), (r.uniform(0.03, 0.07), r.uniform(0.12, 0.3), 0.002), bev=0)

def storage_box(P, s=1.0, big=False):
  w, h, d = 1.0 * s, 0.6 * s, 0.6 * s
  box(P, 'woodD', (0, h / 2, 0), (w - 0.04, h - 0.02, d - 0.04), bev=0.01)
  for i in range(3):                                                               # plank courses, front and back and sides
    y = (0.1 + i * 0.2) * s
    for sz in (-1, 1): box(P, ('wood', 'woodL', 'woodP')[i], (0, y, sz * d / 2), (w - 0.03, 0.185 * s, 0.03), bev=0.006)
    for sx in (-1, 1): box(P, ('woodP', 'wood', 'woodL')[i], (sx * w / 2, y, 0), (0.03, 0.185 * s, d - 0.03), bev=0.006)
  for sx in (-1, 1):
    for sz in (-1, 1): box(P, 'woodD', (sx * (w / 2 - 0.02), h / 2, sz * (d / 2 - 0.02)), (0.07, h + 0.02, 0.07), bev=0.008)
  n = 4 if big else 3
  for i in range(n): box(P, ('wood', 'woodP', 'woodL', 'wood')[i], (0, h + 0.035 * s, -d / 2 - 0.02 + (i + 0.5) * (d + 0.04) / n), (w + 0.04, 0.05 * s, (d + 0.04) / n - 0.008), bev=0.006)
  for sx in ((-0.32, 0.32) if not big else (-0.42, 0, 0.42)):                      # iron straps over the lid and down the front
    box(P, 'metalD', (sx * s, h + 0.062 * s, 0), (0.06, 0.012, d + 0.06), bev=0.003)
    box(P, 'metalD', (sx * s, h * 0.72, d / 2 + 0.018), (0.06, h * 0.6, 0.012), bev=0.003)
    nails(P, [(sx * s, h * 0.5), (sx * s, h * 0.9)], 0.009, d / 2 + 0.024, 1, 'metal')
  box(P, 'metal' if big else 'metalD', (0, h * 0.82, d / 2 + 0.02), (0.11 * s, 0.13 * s, 0.014), bev=0.004)   # latch plate
  torus(P, 'metalL' if big else 'metal', (0, h * 0.74, d / 2 + 0.034), 0.026 * s, 0.006, 12, 6, rot=(math.pi / 2, 0, 0))
  for sx in (-1, 1): torus(P, 'stringRope', (sx * (w / 2 + 0.03), h * 0.6, 0), 0.07 * s, 0.012, 12, 6, rot=(0, 0, math.pi / 2), scale=(1, 1, 1.3), arc=0.5)
  if big:
    for sx in (-1, 1):
      for sz in (-1, 1): box(P, 'metal', (sx * (w / 2 - 0.02), 0.07, sz * (d / 2 - 0.02)), (0.1, 0.14, 0.1), bev=0.006)

def base_core():
  P = 'dep:core'
  for sx in (-1, 1):
    for sz in (-1, 1): box(P, 'woodD', (sx * 0.37, 0.05, sz * 0.2), (0.12, 0.1, 0.12), bev=0.01)
  box(P, 'woodD', (0, 0.83, 0), (0.86, 1.46, 0.5), bev=0.012)
  for sx in (-1, 1): box(P, ('wood', 'woodL')[sx > 0], (sx * 0.21, 0.83, 0.253), (0.4, 1.32, 0.03), bev=0.008)       # two front doors
  for y in (0.28, 1.38):
    box(P, 'metalD', (0, y, 0), (0.9, 0.07, 0.54), bev=0.004)
    nails(P, [(-0.36 + k * 0.18, y) for k in range(5)], 0.01, 0.27, 1, 'metalL')
  box(P, 'wood', (0, 1.59, 0), (0.94, 0.06, 0.58), bev=0.01)
  # the emblem: a glowing ring with a diamond inside (ARVEX signal colour)
  box(P, 'metalD', (0, 0.9, 0.268), (0.34, 0.34, 0.012), bev=0.004)
  torus(P, 'ember', (0, 0.9, 0.28), 0.115, 0.016, 28, 8, rot=(math.pi / 2, 0, 0))
  box(P, 'flame', (0, 0.9, 0.28), (0.09, 0.09, 0.012), rot=(0, 0, math.pi / 4), bev=0.003)
  for sx in (-1, 1): tube(P, 'metalL', (sx * 0.03, 0.62, 0.275), (sx * 0.03, 0.74, 0.275), 0.009, 0.009, 8)             # door handles
  # lantern on top
  tube(P, 'metalD', (0, 1.62, 0), (0, 1.66, 0), 0.07, 0.06, 12)
  ell(P, 'ember', (0, 1.74, 0), (0.05, 0.075, 0.05), 14, 10)
  for k in range(4):
    a = k / 4 * TAU + 0.4; tube(P, 'metalD', (math.cos(a) * 0.06, 1.66, math.sin(a) * 0.06), (math.cos(a) * 0.045, 1.83, math.sin(a) * 0.045), 0.006, 0.006, 6)
  tube(P, 'metalD', (0, 1.83, 0), (0, 1.87, 0), 0.06, 0.015, 12)
  torus(P, 'metal', (0, 1.9, 0), 0.022, 0.005, 12, 6, rot=(math.pi / 2, 0, 0))

def lock_key(P='dep:lock_key'):
  box(P, 'metalD', (0, 0, -0.012), (0.11, 0.055, 0.008), bev=0.003)                                                       # hasp plate
  box(P, 'brass', (0, -0.035, 0.006), (0.07, 0.06, 0.03), bev=0.007, seg=3)
  torus(P, 'metalL', (0, -0.005, 0.006), 0.021, 0.006, 16, 8, rot=(math.pi / 2, 0, 0), arc=0.5)
  for sx in (-1, 1): tube(P, 'metalL', (sx * 0.021, -0.012, 0.006), (sx * 0.021, -0.005, 0.006), 0.006, 0.006, 8)
  tube(P, 'sole', (0, -0.04, 0.0205), (0, -0.04, 0.0225), 0.007, 0.007, 10)
  box(P, 'sole', (0, -0.05, 0.0215), (0.004, 0.014, 0.002), bev=0)

def lock_code(P='dep:lock_code'):
  box(P, 'metalD', (0, 0, 0), (0.092, 0.135, 0.034), bev=0.006, seg=3)
  box(P, 'metal', (0, 0.046, 0.018), (0.07, 0.024, 0.004), bev=0.002)                                                     # display strip
  ell(P, 'led', (0.024, 0.046, 0.021), (0.006, 0.006, 0.004), 10, 6)
  for r in range(4):
    for c in range(3): box(P, 'metalL', (-0.022 + c * 0.022, 0.018 - r * 0.021, 0.0185), (0.016, 0.015, 0.006), bev=0.002)
  for sy in (-1, 1): nails(P, [(-0.036, sy * 0.058), (0.036, sy * 0.058)], 0.004, 0.017, 1, 'metal')

def log_post(P, x, z, y0, y1, r, seed, tip=0.36, slot='woodD', lean=(0, 0)):
  a = (x, y0, z); b = (x + lean[0], y1 - tip, z + lean[1])
  tube(P, slot, a, b, r * 1.06, r * 0.93, 10, 5, cap=False, wob=0.09, seed=seed)
  tube(P, 'woodL', b, (b[0] + lean[0] * 0.1, y1, b[2] + lean[1] * 0.1), r * 0.93, r * 0.08, 10, 2, cap=True, wob=0.05, seed=seed + 5)   # sharpened, fresh-cut tip

def hwall_wood():
  P = 'dep:hwall_wood'; n = 9; w = 3.0 / n
  for i in range(n):
    r = random.Random(700 + i); x = -1.5 + (i + 0.5) * w
    log_post(P, x + r.uniform(-0.012, 0.012), r.uniform(-0.03, 0.03), -0.7, 4.0 + r.uniform(0, 0.3), w * 0.52, 700 + i, slot=('woodD', 'wood', 'woodD')[i % 3], lean=(r.uniform(-0.02, 0.02), r.uniform(-0.03, 0.03)))
  for y in (1.15, 3.05):                                                           # cross beams on the inside, lashed with rope
    box(P, 'wood', (0, y, -0.21), (3.0, 0.17, 0.11), bev=0.012)
    for x in (-1.2, -0.4, 0.4, 1.2): torus(P, 'stringRope', (x, y, -0.13), 0.115, 0.016, 8, 4, rot=(0, 0, math.pi / 2), scale=(1, 1, 0.75))
  L = math.hypot(2.7, 1.7); a = math.atan2(1.7, 2.7)
  box(P, 'woodP', (0, 2.1, -0.24), (L, 0.13, 0.07), rot=(0, 0, a), bev=0.01)       # diagonal brace

def hwall_stone():
  P = 'dep:hwall_stone'
  box(P, 'stoneD', (0, 1.45, 0), (2.96, 4.3, 0.46), bev=0.02)                       # mortar core (bottom buried 0.7)
  rows = 9; hh = 3.6 / rows
  for sz in (-1, 1):
    for rr in range(rows):
      r = random.Random(900 + rr * 7 + (sz > 0)); x = -1.5 - (0.36 if rr % 2 else 0); y = (rr + 0.5) * hh
      while x < 1.5 - 0.02:
        bw = r.uniform(0.55, 0.85); xa = max(-1.5, x); xb = min(1.5, x + bw)
        if xb - xa > 0.1:
          dep = r.uniform(0.07, 0.13)
          box(P, r.choice(('stone', 'stone', 'stoneL', 'flint', 'stoneD')), ((xa + xb) / 2, y + r.uniform(-0.008, 0.008), sz * (0.23 + dep / 2 - 0.03)), (xb - xa - 0.03, hh - 0.035, dep), bev=0.022, seg=1)
        x += bw
  box(P, 'stoneL', (0, 3.66, 0), (3.0, 0.14, 0.68), bev=0.02)                       # cap course
  for x in (-1.2, 0.0, 1.2): box(P, 'stone', (x, 4.0, 0.08), (0.6, 0.56, 0.5), bev=0.03)       # merlons
  for k in range(5):
    r = random.Random(950 + k); box(P, 'stoneMoss', (r.uniform(-1.3, 1.3), 3.74, r.uniform(-0.2, 0.2)), (r.uniform(0.2, 0.5), 0.02, r.uniform(0.15, 0.3)), bev=0.008)

def hwall_stone_lo():
  P = 'dep:hwall_stone~1'
  box(P, 'stoneD', (0, 1.45, 0), (2.96, 4.3, 0.5), bev=0)
  for sz in (-1, 1):
    for rr in range(4):
      r = random.Random(990 + rr * 3 + (sz > 0)); x = -1.5 - (0.5 if rr % 2 else 0)
      while x < 1.48:
        bw = r.uniform(0.9, 1.3); xa = max(-1.5, x); xb = min(1.5, x + bw)
        if xb - xa > 0.2: box(P, r.choice(('stone', 'stoneL', 'flint')), ((xa + xb) / 2, (rr + 0.5) * 0.9, sz * 0.27), (xb - xa - 0.05, 0.84, 0.08), bev=0)
        x += bw
  box(P, 'stoneL', (0, 3.66, 0), (3.0, 0.14, 0.68), bev=0)
  for x in (-1.2, 0.0, 1.2): box(P, 'stone', (x, 4.0, 0.08), (0.6, 0.56, 0.5), bev=0)

def gate_wood():
  P = 'dep:gate_wood'                                                              # the leaf: hinge at x = -1.3
  planks(P, -1.3, 1.3, 0.06, 3.4, 0.0, 0.09, 9, seed=3, bev=0.01)
  for y in (0.45, 1.75, 3.05): box(P, 'woodD', (0, y, 0.06), (2.56, 0.18, 0.05), bev=0.01)
  for (ya, yb) in ((0.55, 1.65), (1.85, 2.95)):
    L = math.hypot(2.4, yb - ya); a = math.atan2(yb - ya, 2.4); box(P, 'woodD', (0, (ya + yb) / 2, 0.06), (L, 0.15, 0.045), rot=(0, 0, a), bev=0.008)
  for y in (0.45, 1.75, 3.05):
    box(P, 'metalD', (-0.75, y, -0.055), (1.1, 0.09, 0.016), bev=0.004, taper=lambda p: (p.x, p.y * (1.0 if p.x < 0 else 0.5), p.z))
    tube(P, 'metalD', (-1.3, y - 0.1, -0.04), (-1.3, y + 0.1, -0.04), 0.03, 0.03, 10)
    nails(P, [(-1.2 + k * 0.3, y) for k in range(9)], 0.012, 0.086, 1)
  box(P, 'metalD', (1.05, 1.5, 0.05), (0.12, 0.3, 0.014), bev=0.004)
  torus(P, 'metal', (1.05, 1.42, 0.075), 0.07, 0.011, 18, 6, rot=(math.pi / 2, 0, 0))
  box(P, 'woodD', (0.2, 1.3, -0.07), (2.2, 0.12, 0.07), bev=0.01)                   # locking bar
  P = 'dep:gate_frame'
  for sx in (-1, 1): log_post(P, sx * 1.47, 0, -0.7, 4.25, 0.17, 30 + sx, tip=0.3)
  tube(P, 'woodD', (-1.75, 3.72, 0), (1.75, 3.72, 0), 0.13, 0.13, 10, 4, wob=0.08, seed=77)
  for sx in (-1, 1): torus(P, 'stringRope', (sx * 1.47, 3.72, 0), 0.2, 0.02, 14, 6, rot=(0, 0, 0), scale=(1, 1.5, 1))

def tower():
  P = 'dep:tower'
  for sx in (-1, 1):
    for sz in (-1, 1): log_post(P, sx * 1.15, sz * 1.15, -0.7, 6.15, 0.13, 50 + sx * 3 + sz, tip=0.0001, lean=(-sx * 0.1, -sz * 0.1))
  for side in range(4):                                                            # X braces
    a = side * math.pi / 2; ca, sa = math.cos(a), math.sin(a)
    for sgn in (-1, 1):
      p0 = (ca * 1.12 - sa * 1.08 * sgn, 0.4, sa * 1.12 + ca * 1.08 * sgn); p1 = (ca * 1.08 + sa * 1.02 * sgn, 3.7, sa * 1.08 - ca * 1.02 * sgn)
      if side == 3: continue                                                       # the stair side stays open
      tube(P, 'wood', p0, p1, 0.05, 0.05, 6, 2, wob=0.06, seed=side * 5 + sgn)
  for sz in (-1, 1): box(P, 'woodD', (0, 3.86, sz * 1.0), (2.5, 0.16, 0.12), bev=0.012)            # joists
  for i in range(9):
    r = random.Random(60 + i); box(P, ('wood', 'woodL', 'woodP')[i % 3], (-1.3 + (i + 0.5) * 2.6 / 9, 3.97, 0), (2.6 / 9 - 0.01, 0.06, 2.6 + r.uniform(-0.04, 0.04)), bev=0.008)
  for side in range(4):                                                            # railing (open toward the stair on -z)
    a = side * math.pi / 2; ca, sa = math.cos(a), math.sin(a)
    for y in (4.5, 4.95):
      if side == 3:
        for sx in (-1, 1): box(P, 'wood', (sx * 0.9, y, -1.24), (0.75, 0.07, 0.05), bev=0.008)
      else: box(P, 'wood', (ca * 1.24, y, sa * 1.24), (0.05 if abs(ca) > 0.5 else 2.5, 0.07, 2.5 if abs(ca) > 0.5 else 0.05), bev=0.008)
    if side != 3:
      for k in (-1, 0, 1): box(P, 'woodP', (ca * 1.24 - sa * k * 0.62, 4.45, sa * 1.24 + ca * k * 0.62), (0.06, 0.95, 0.06), bev=0.008)
  # roof: four slopes of planks
  for side in range(4):
    a = side * math.pi / 2
    for k in range(5):
      t0 = k / 5; w0 = 1.55 * (1 - t0); w1 = 1.55 * (1 - (k + 1) / 5); y0 = 5.75 + t0 * 1.15; y1 = 5.75 + (k + 1) / 5 * 1.15
      V = [(-w0, y0, -w0), (w0, y0, -w0), (w1 + 0.0001, y1, -w1 - 0.0001), (-w1 - 0.0001, y1, -w1 - 0.0001)]
      V = [(v[0] * math.cos(a) - v[2] * math.sin(a), v[1], v[0] * math.sin(a) + v[2] * math.cos(a)) for v in V]
      o = mesh_from('roof', V, [(0, 1, 2, 3)], P, ('woodD', 'wood')[k % 2], False); bmfix(o); m = o.modifiers.new('sol', 'SOLIDIFY'); m.thickness = 0.05
  tube(P, 'woodD', (0, 6.85, 0), (0, 7.25, 0), 0.05, 0.02, 8)
  # steep stair on the -z side: from the ground at z = -3.6 up to the platform edge at z = -1.3
  for sx in (-1, 1): box(P, 'woodD', (sx * 0.42, 2.0, -2.45), (0.07, 0.2, math.hypot(2.3, 4.0)), rot=(-math.atan2(4.0, 2.3), 0, 0), bev=0.01)
  for k in range(12): t = (k + 0.5) / 12; box(P, ('wood', 'woodL')[k % 2], (0, 0.02 + t * 4.0, -3.6 + t * 2.3), (0.78, 0.05, 0.24), bev=0.008)
  for sx in (-1, 1):                                                               # stair hand rails
    tube(P, 'wood', (sx * 0.42, 0.95, -3.6), (sx * 0.42, 4.95, -1.3), 0.03, 0.03, 6, 2)
    for t in (0.0, 0.5, 1.0): tube(P, 'woodP', (sx * 0.42, t * 4.0, -3.6 + t * 2.3), (sx * 0.42, 0.95 + t * 4.0, -3.6 + t * 2.3), 0.028, 0.028, 6)

def powder_bomb(P='dep:bomb'):
  # a cloth-wrapped powder bundle tied with rope, with a fuse
  ell(P, 'cloth', (0, 0.085, 0), (0.085, 0.09, 0.085), 18, 12, fn=lambda g, u: g * (1 + 0.06 * noise.noise(u * 3.1)))
  tube(P, 'cloth', (0, 0.15, 0), (0, 0.205, 0), 0.03, 0.045, 10, 2, prof=lambda t: 1 + 0.25 * math.sin(t * 9))
  torus(P, 'stringRope', (0, 0.155, 0), 0.034, 0.008, 14, 6)
  for a in (0.0, math.pi / 2): torus(P, 'stringRope', (0, 0.085, 0), 0.088, 0.006, 22, 6, rot=(math.pi / 2, a, 0))
  pts = [(0, 0.2, 0), (0.012, 0.235, 0.004), (0.035, 0.26, 0.012), (0.06, 0.262, 0.02)]
  for i in range(3): tube(P, 'string', pts[i], pts[i + 1], 0.005, 0.005, 6)
  ell(P, 'ember', pts[3], (0.008, 0.008, 0.008), 8, 6)
  box(P, 'paper', (0, 0.085, 0.086), (0.05, 0.035, 0.003), bev=0)                    # label
  box(P, 'ink', (0, 0.085, 0.0878), (0.034, 0.006, 0.002), bev=0)

def breach_charge(P='dep:charge'):
  # six sticks strapped in two rows, a timer box with a lamp and wires
  for r in range(2):
    for c in range(3): tube(P, 'clothR', (-0.06 + c * 0.06, 0.03 + r * 0.055, -0.14), (-0.06 + c * 0.06, 0.03 + r * 0.055, 0.14), 0.028, 0.028, 12, 1)
  for z in (-0.09, 0.09): box(P, 'metalD', (0, 0.058, z), (0.2, 0.125, 0.024), bev=0.005)
  for r in range(2):
    for c in range(3): tube(P, 'stringRope', (-0.06 + c * 0.06, 0.03 + r * 0.055, 0.14), (-0.06 + c * 0.06, 0.03 + r * 0.055, 0.146), 0.02, 0.02, 10)
  box(P, 'metalD', (0, 0.135, 0), (0.12, 0.045, 0.1), bev=0.006)
  box(P, 'metal', (0, 0.16, 0.012), (0.07, 0.006, 0.04), bev=0.002)
  ell(P, 'led', (0.038, 0.162, -0.028), (0.009, 0.007, 0.009), 10, 6)
  tube(P, 'metalL', (-0.04, 0.158, -0.03), (-0.04, 0.2, -0.03), 0.004, 0.003, 6)     # aerial
  for sx in (-1, 1):
    pts = [(sx * 0.05, 0.14, 0.05), (sx * 0.085, 0.12, 0.09), (sx * 0.07, 0.07, 0.143)]
    for i in range(2): tube(P, 'metalRed' if sx > 0 else 'sole', pts[i], pts[i + 1], 0.004, 0.004, 6)
  box(P, 'metalRed', (0, 0.058, 0), (0.195, 0.02, 0.05), bev=0.003)                  # warning band

def rock_set():
  """rocks, ore rocks and boulders: displaced, weathered ico-spheres with moss / ore faces, each in three levels of detail"""
  for kind, nvar, dims, tgt in (('rock', 4, (1.42, 1.08, 1.32), (2200, 620, 150)), ('metal', 4, (1.42, 1.08, 1.32), (2200, 620, 150)), ('boulder', 4, (3.9, 2.7, 3.5), (3000, 800, 180))):
    for v in range(nvar):
      r = random.Random(v * 7 + len(kind) * 31); sd = (v * 17 + (0 if kind == 'rock' else 40 if kind == 'metal' else 80)) * 1.37
      s = (dims[0] * r.uniform(0.85, 1.15), dims[1] * r.uniform(0.85, 1.2), dims[2] * r.uniform(0.85, 1.15)); off = Vector((sd, sd * 0.61, sd * 1.7))
      bm = bmesh.new(); bmesh.ops.create_icosphere(bm, subdivisions=5, radius=1.0)
      for vt in bm.verts:
        u = Vector((-vt.co.x, vt.co.z, vt.co.y)).normalized()
        k = 1 + noise.noise(u * 1.3 + off) * 0.22 + noise.noise(u * 3.4 + off) * 0.1 + noise.noise(u * 9 + off) * 0.035 + noise.noise(u * 24 + off) * 0.012
        for pl in range(3):                                                        # a few flat fracture planes
          n = Vector((math.cos(sd + pl * 2.1), 0.35 * math.sin(sd * 2 + pl), math.sin(sd + pl * 2.1))).normalized(); dd = u.dot(n)
          lim = 0.78 + 0.08 * math.sin(sd + pl)
          if dd > lim: k *= lim / dd
        flat = max(0.0, -u.y - 0.3); k *= 1 - flat * 0.55                            # sits on the ground
        g = Vector((u.x * s[0] * k, u.y * s[1] * k + s[1] * 0.35, u.z * s[2] * k)); vt.co = B(g)
      me = bpy.data.meshes.new('%s%d' % (kind, v)); bm.to_mesh(me); bm.free()
      names = ['stone', 'stoneD', 'stoneL', 'stoneMoss', 'stoneOre', 'stoneOreL']
      for sname in names: me.materials.append(mat(sname))
      for p in me.polygons:
        c = Vector(G(p.center)); n = Vector(G(p.normal)); f = 0.35 if kind == 'boulder' else 0.8
        # colour follows the surface: dark undersides and cracks, weathered pale tops, moss where water sits
        idx = 0
        if n.y < -0.05 or noise.noise(c * f * 1.6 + off) < -0.32: idx = 1
        elif n.y > 0.5 and noise.noise(c * f + off * 1.3) > 0.05: idx = 2
        if kind != 'metal' and n.y > 0.66 and noise.noise(c * f * 0.9 + off * 2) > 0.02: idx = 3
        if kind == 'metal':
          vv = noise.noise(c * 2.2 + off * 3)
          if abs(vv) < 0.06: idx = 5
          elif abs(vv) < 0.13: idx = 4
        p.material_index = idx; p.use_smooth = True
      for li, (lname, t) in enumerate(zip((0, 2, 1), tgt)):                         # game LOD ids: 0 near · 2 middle · 1 far
        o = bpy.data.objects.new('%s%d_%d' % (kind, v, lname), me); part = 'prop:%s:%d:%d' % (kind, v, lname)
        col_for(part).objects.link(o); o['part'] = part; o['slot'] = 'stone'; decimate(o, t / len(me.polygons))

# ------------------------------------------------------------------ export
def tri_data(o, dg):
  eo = o.evaluated_get(dg); me = eo.to_mesh(); me.calc_loop_triangles()
  try: cn = [tuple(c.vector) for c in me.corner_normals]
  except Exception: cn = [tuple(me.vertices[l.vertex_index].normal) for l in me.loops]
  M = o.matrix_world; N3 = M.to_3x3().inverted().transposed()
  nv = len(me.vertices); acc = [Vector((0, 0, 0)) for _ in range(nv)]; cnt = [0] * nv
  for e in me.edges:
    a, b = e.vertices; acc[a] += me.vertices[b].co; acc[b] += me.vertices[a].co; cnt[a] += 1; cnt[b] += 1
  ao = []
  for i, v in enumerate(me.vertices):
    if cnt[i]:
      d = acc[i] / cnt[i] - v.co; c = d.dot(v.normal) / max(1e-5, d.length + 0.002); ao.append(max(0.55, min(1.0, 1.0 - max(0.0, c) * 0.9)))
    else: ao.append(1.0)
  P = []; Nn = []; A = []; TS = []
  names = [(m.name[6:] if m and m.name.startswith('ARVEX_') else o['slot']) for m in me.materials] or [o['slot']]
  for t in me.loop_triangles:
    sl = names[t.material_index] if t.material_index < len(names) else o['slot']; sl = sl.split('.')[0]
    TS.extend([sl if sl in SLOTS else o['slot']] * 3)
    for li, vi in zip(t.loops, t.vertices):
      p = M @ me.vertices[vi].co; n = (N3 @ Vector(cn[li])).normalized()
      P.extend(G(p)); Nn.extend(G(n)); A.append(ao[vi])
  eo.to_mesh_clear()
  return P, Nn, A, TS

def export(path):
  dg = bpy.context.evaluated_depsgraph_get(); parts = {}
  for o in bpy.data.objects:
    if 'part' in o and o.type == 'MESH': parts.setdefault(o['part'], []).append(o)
  meshes = {}; fl = bytearray(); ab = bytearray(); total = 0; tris = {}
  for part in sorted(parts):
    tri = {}                                                                       # slot -> [floats, ao]: one run per slot keeps the header small
    for o in parts[part]:
      Pp, Nn, A, TS = tri_data(o, dg)
      for i in range(len(A)):
        e = tri.setdefault(TS[i], ([], [])); e[0].extend((Pp[i * 3], Pp[i * 3 + 1], Pp[i * 3 + 2], Nn[i * 3], Nn[i * 3 + 1], Nn[i * 3 + 2])); e[1].append(A[i])
    for sl, (buf, aa) in tri.items():
      fl += struct.pack('<%df' % len(buf), *buf); ab += bytes(int(a * 255) for a in aa); meshes.setdefault(part, []).append([sl, len(aa)]); total += len(aa)
    tris[part] = sum(c for _, c in meshes.get(part, [])) // 3
  used = sorted({s for segs in meshes.values() for s, _ in segs})
  hdr = json.dumps({'v': 1, 'slots': {s: SLOTS[s] for s in used}, 'slotOrder': used, 'emissive': {k: v for k, v in EMISSIVE.items() if k in used}, 'parts': meshes, 'total': total}).encode()
  hdr += b' ' * ((4 - (len(hdr) + 8) % 4) % 4)
  with open(path, 'wb') as f:
    f.write(b'ARVX'); f.write(struct.pack('<I', len(hdr))); f.write(hdr); f.write(fl); f.write(bytes(total)); f.write(ab)
  return total, tris

# ------------------------------------------------------------------ preview renders (Workbench) so the result can be checked without the game
def renders(groups):
  sc = bpy.context.scene; sc.render.engine = 'BLENDER_WORKBENCH'; sh = sc.display.shading
  sh.light = 'STUDIO'; sh.color_type = 'MATERIAL'; sh.show_cavity = True; sh.cavity_type = 'BOTH'; sh.show_shadows = True; sh.show_specular_highlight = False
  sc.render.resolution_x = 900; sc.render.resolution_y = 700; sc.render.film_transparent = False; sc.render.image_settings.file_format = 'JPEG'; sc.render.image_settings.quality = 88
  if not sc.world: sc.world = bpy.data.worlds.new('W')
  sc.world.color = (0.16, 0.17, 0.18)
  cam = bpy.data.objects.get('ARVEX_cam')
  if not cam: cam = bpy.data.objects.new('ARVEX_cam', bpy.data.cameras.new('ARVEX_cam')); sc.collection.objects.link(cam)
  sc.camera = cam; cam.data.lens = 55; done = []
  for name, objs, az, el in groups:
    objs = [o for o in objs if o.type == 'MESH']
    if not objs: continue
    vis = set(objs)
    for o in sc.objects:
      if o.type in ('MESH', 'CURVE'): o.hide_render = o not in vis
    pts = [o.matrix_world @ Vector(c) for o in objs for c in o.bound_box]
    lo = Vector((min(p.x for p in pts), min(p.y for p in pts), min(p.z for p in pts))); hi = Vector((max(p.x for p in pts), max(p.y for p in pts), max(p.z for p in pts)))
    c = (lo + hi) / 2; r = (hi - lo).length / 2 * 1.12; a, e = math.radians(az), math.radians(el)
    d = Vector((math.sin(a) * math.cos(e), -math.cos(a) * math.cos(e), math.sin(e))); cam.location = c + d * (r / math.tan(cam.data.angle / 2)); cam.data.clip_end = 500
    cam.rotation_euler = (-d).to_track_quat('-Z', 'Y').to_euler(); sc.render.filepath = os.path.join(OUT, 'preview_%s.jpg' % name)
    try: bpy.ops.render.render(write_still=True); done.append(name)
    except Exception as ex: log('render failed', name, ex); break
  for o in sc.objects:
    if o.type in ('MESH', 'CURVE'): o.hide_render = False
  return done

# ------------------------------------------------------------------ run
clear(); made = {}
if stage('human'): made = human_lods(); log('human LODs built', len(made))
if stage('props'):
  door_wood(); door_metal(); storage_box('dep:box_small', 1.0, False); storage_box('dep:box_large', 1.35, True); base_core()
  lock_key(); lock_code(); hwall_wood(); hwall_stone(); hwall_stone_lo(); gate_wood(); tower(); powder_bomb(); breach_charge()
  bpy.context.view_layer.update()
  # held versions (hand space: grip at the origin, forward = -z)
  move_part('dep:bomb', 'item:bomb', off=(0, -0.045, -0.035), scale=0.9)
  move_part('dep:charge', 'item:charge', off=(0, -0.03, -0.05), rot=(0, math.pi / 2, 0), scale=0.8)
  move_part('dep:lock_key', 'item:lock_key', off=(0, 0.05, -0.05), scale=1.4)
  move_part('dep:lock_code', 'item:lock_code', off=(0, 0.02, -0.06), rot=(-0.5, 0, 0), scale=1.25)
  log('props built')
  # lighter copies of the big placed models for the distance
  dg = bpy.context.evaluated_depsgraph_get()
  for part, ratio in (('dep:hwall_wood', 0.16), ('dep:gate_wood', 0.14), ('dep:gate_frame', 0.2), ('dep:tower', 0.12), ('dep:door_wood', 0.18), ('dep:door_metal', 0.14), ('dep:box_small', 0.2), ('dep:box_large', 0.18), ('dep:core', 0.18)):
    objs = [o for o in bpy.data.objects if o.get('part') == part]; V = []; Fc = []; fs = []
    for o in objs:
      me = o.evaluated_get(dg).to_mesh(); me.calc_loop_triangles(); base = len(V); names = [m.name[6:] for m in me.materials]
      for v in me.vertices: V.append(tuple(v.co))
      for t in me.loop_triangles: Fc.append(tuple(base + i for i in t.vertices)); fs.append(names[t.material_index] if t.material_index < len(names) else o['slot'])
      o.evaluated_get(dg).to_mesh_clear()
    me = bpy.data.meshes.new(part + '_lo'); me.from_pydata(V, [], Fc); me.update(); names = []
    for s in fs:
      if s not in names: names.append(s)
    for s in names: me.materials.append(mat(s))
    for p, s in zip(me.polygons, fs): p.material_index = names.index(s); p.use_smooth = False
    o = bpy.data.objects.new(part + '_lo', me); col_for(part + '~1').objects.link(o); o['part'] = part + '~1'; o['slot'] = names[0]
    bm = bmesh.new(); bm.from_mesh(me); bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=0.0005); bm.to_mesh(me); bm.free(); decimate(o, ratio)
  log('prop LODs built')
if stage('rocks'): rock_set(); log('rocks built')
bpy.context.view_layer.update()
total, tris = export(os.path.join(OUT, 'arvex_v25_parts.bin'))
json.dump({'total': total, 'tris': tris, 'made': made}, open(os.path.join(OUT, 'report.json'), 'w'), indent=1)
log('EXPORT', total, 'vertices', len(tris), 'parts')
for k in sorted(tris): print('   %-26s %7d tris' % (k, tris[k]))
if stage('render'):
  by = {}
  for o in bpy.data.objects:
    if 'part' in o: by.setdefault(o['part'], []).append(o)
  G_ = []
  for p in sorted(by):
    if p.startswith('dep:') or p.startswith('item:') or p == 'hfar':
      G_.append((p.replace(':', '_').replace('~', '-'), by[p], 35, 14))
      if '~' not in p: G_.append((p.replace(':', '_') + '_b', by[p], 215, 14))
  for k in ('prop:rock:0:0', 'prop:rock:0:2', 'prop:rock:0:1', 'prop:metal:1:0', 'prop:boulder:2:0'):
    if k in by: G_.append((k.replace(':', '_'), by[k], 30, 18))
  for lv in (1, 2, 3):
    for nm in ('head', 'torso', 'armL', 'legL'):
      k = 'h%d:%s' % (lv, nm)
      if k in by: G_.append((k.replace(':', '_'), by[k], 20, 6))
  log('renders', renders(G_))
try: bpy.ops.wm.save_as_mainfile(filepath=os.path.join(D, 'arvex_v25.blend'))
except Exception as ex: log('save failed', ex)
log('ARVEX_V25_DONE')
