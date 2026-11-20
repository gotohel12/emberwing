# ARVEX SURVIVAL — Blender asset build (run inside Blender: exec(open(path).read()))
# Builds the human (body parts for the in-game rig), first-person arm and all held items as
# high-poly meshes (Skin + Subdivision + Bevel modifiers, sculpted deformations), shows them in
# the scene, and exports one packed file the game loads: arvex_models.bin
# Coordinates are authored in GAME space (x right, y up, front = -z) and converted to Blender space.
import bpy, bmesh, math, json, struct, os, random
from mathutils import Vector, Matrix, Euler, noise

OUT = os.path.join(os.path.dirname(globals().get('__arvex_file__', r"C:\Users\mohse\Desktop\Mohsen ~ Danial Games\EMBERWING\arvex_blender\arvex_build.py")), "out")
os.makedirs(OUT, exist_ok=True)
TAU = math.pi * 2
random.seed(7)

# ------------------------------------------------------------------ palette (sRGB 0..1); in-game tints override shirt/skin/hair
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
  'flame': hx('#ff8a2a'), 'ember': hx('#ffcf6a')
}
EMISSIVE = {'flame': 0.55, 'ember': 0.7}

# ------------------------------------------------------------------ scene helpers
def clear():
  for o in list(bpy.data.objects): bpy.data.objects.remove(o, do_unlink=True)
  for d in (bpy.data.meshes, bpy.data.curves, bpy.data.materials):
    for x in list(d): d.remove(x)
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
    try:
      m.use_nodes = True; b = m.node_tree.nodes.get('Principled BSDF')
      if b:
        b.inputs['Base Color'].default_value = (lin[0], lin[1], lin[2], 1)
        b.inputs['Roughness'].default_value = 0.3 if slot in ('metal', 'metalL', 'edge', 'metalD', 'brass') else 0.75
        if slot in ('metal', 'metalL', 'edge', 'metalD', 'brass'): b.inputs['Metallic'].default_value = 0.9
    except Exception: pass
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
  if hasattr(data, 'materials'): data.materials.append(mat(slot))
  if smooth and isinstance(data, bpy.types.Mesh):
    for f in data.polygons: f.use_smooth = True
  return o

def mesh_from(name, verts_g, faces, part, slot, smooth=True, flat_faces=()):
  me = bpy.data.meshes.new(name); me.from_pydata([B(v) for v in verts_g], [], faces); me.validate(); me.update()
  o = link(name, me, part, slot, smooth)
  for i in flat_faces:
    if i < len(me.polygons): me.polygons[i].use_smooth = False
  return o

def subsurf(o, lv=2):
  m = o.modifiers.new('sub', 'SUBSURF'); m.levels = lv; m.render_levels = lv; return o

def bevel(o, w=0.003, seg=3, angle=40):
  m = o.modifiers.new('bev', 'BEVEL'); m.width = w; m.segments = seg; m.limit_method = 'ANGLE'; m.angle_limit = math.radians(angle)
  try: m.harden_normals = True
  except Exception: pass
  return o

def skin(name, part, slot, pts, edges=None, sub=2, mirror_x=False):
  """pts: [(game_pos, radius or (rx, ry))] chain (or edges) -> organic tube via Skin + Subdivision"""
  me = bpy.data.meshes.new(name)
  if edges is None: edges = [(i, i + 1) for i in range(len(pts) - 1)]
  me.from_pydata([B(p) for p, r in pts], edges, [])
  o = link(name, me, part, slot, False)
  sk = o.modifiers.new('skin', 'SKIN'); sk.use_smooth_shade = True
  try: sk.branch_smoothing = 0.6
  except Exception: pass
  lay = me.skin_vertices[0].data
  for i, (p, r) in enumerate(pts):
    lay[i].radius = (r, r) if isinstance(r, (int, float)) else tuple(r)
  lay[0].use_root = True
  if sub: subsurf(o, sub)
  return o

def ell(name, part, slot, c, s, seg=32, ring=18, rot=None, fn=None, smooth=True):
  bm = bmesh.new(); bmesh.ops.create_uvsphere(bm, u_segments=seg, v_segments=ring, radius=1.0)
  for v in bm.verts:
    u = Vector((-v.co.x, v.co.z, v.co.y)); g = Vector((u.x * s[0], u.y * s[1], u.z * s[2]))
    if fn: g = Vector(fn(g, u))
    g = rotg(g, rot) + Vector(c); v.co = B(g)
  me = bpy.data.meshes.new(name); bm.to_mesh(me); bm.free()
  return link(name, me, part, slot, smooth)

def frame(a, b):
  a, b = Vector(a), Vector(b); d = (b - a); L = d.length; d.normalize()
  t = Vector((1, 0, 0)) if abs(d.x) < 0.9 else Vector((0, 0, 1)); x = d.cross(t).normalized(); z = x.cross(d).normalized()
  return a, d, L, x, z

def tube(name, part, slot, a, b, r0, r1, seg=20, rings=1, cap=True, smooth=True, prof=None):
  """cylinder/cone between game points a,b; prof(t)->radius multiplier for bulges"""
  a_, d, L, x, z = frame(a, b); V = []; F = []
  for i in range(rings + 1):
    t = i / rings; r = (r0 + (r1 - r0) * t) * (prof(t) if prof else 1); c = a_ + d * (L * t)
    for k in range(seg):
      an = k / seg * TAU; V.append(tuple(c + (x * math.cos(an) + z * math.sin(an)) * r))
  for i in range(rings):
    for k in range(seg):
      A = i * seg + k; Bk = i * seg + (k + 1) % seg; F.append((A, Bk, Bk + seg, A + seg))
  flat = []
  if cap:
    flat.append(len(F)); F.append(tuple(reversed(range(seg))))
    flat.append(len(F)); F.append(tuple(range(rings * seg, rings * seg + seg)))
  return mesh_from(name, V, F, part, slot, smooth, flat)

def box(name, part, slot, c, s, rot=None, bev=0.004, seg=3, taper=None):
  hs = [s[0] / 2, s[1] / 2, s[2] / 2]; V = []
  for X in (-1, 1):
    for Y in (-1, 1):
      for Z in (-1, 1):
        p = Vector((X * hs[0], Y * hs[1], Z * hs[2]))
        if taper: p = Vector(taper(p))
        V.append(tuple(rotg(p, rot) + Vector(c)))
  F = [(0, 1, 3, 2), (4, 6, 7, 5), (0, 4, 5, 1), (2, 3, 7, 6), (0, 2, 6, 4), (1, 5, 7, 3)]
  o = mesh_from(name, V, F, part, slot, False)
  me = o.data; me.flip_normals() if False else None
  bmfix(o)
  if bev: bevel(o, bev, seg)
  return o

def bmfix(o):
  bm = bmesh.new(); bm.from_mesh(o.data); bmesh.ops.recalc_face_normals(bm, faces=bm.faces); bm.to_mesh(o.data); bm.free()

def slab(name, part, slot, prof, thick, axis_x=True, edge_thin=None, rot=None, off=(0, 0, 0), bev=0.0015):
  """extrude a 2D profile [(z, y)] (side view, game) along x; thick(z,y)->half thickness (0 = sharp edge)"""
  n = len(prof); V = []
  for side in (-1, 1):
    for (zz, yy) in prof:
      t = thick(zz, yy) if callable(thick) else thick
      V.append(tuple(rotg((side * max(t, 0.0004), yy, zz), rot) + Vector(off)))
  F = [tuple(range(n)), tuple(reversed(range(n, 2 * n)))]
  for i in range(n):
    j = (i + 1) % n; F.append((i, j, n + j, n + i))
  o = mesh_from(name, V, F, part, slot, False); bmfix(o)
  bm = bmesh.new(); bm.from_mesh(o.data); bmesh.ops.triangulate(bm, faces=[f for f in bm.faces if len(f.verts) > 4]); bm.to_mesh(o.data); bm.free()
  if bev: bevel(o, bev, 2, 30)
  return o

def torus(name, part, slot, c, R, r, seg=32, tseg=10, rot=None, scale=(1, 1, 1)):
  V = []; F = []
  for i in range(seg):
    a = i / seg * TAU
    for j in range(tseg):
      b = j / tseg * TAU; p = Vector(((R + r * math.cos(b)) * math.cos(a), r * math.sin(b), (R + r * math.cos(b)) * math.sin(a)))
      p = Vector((p.x * scale[0], p.y * scale[1], p.z * scale[2])); V.append(tuple(rotg(p, rot) + Vector(c)))
  for i in range(seg):
    for j in range(tseg):
      A = i * tseg + j; Bq = ((i + 1) % seg) * tseg + j; C_ = ((i + 1) % seg) * tseg + (j + 1) % tseg; D = i * tseg + (j + 1) % tseg
      F.append((A, D, C_, Bq))
  o = mesh_from(name, V, F, part, slot, True); bmfix(o); return o

def strands(name, part, slot, curves, r, res=2):
  """hair/lace/string: list of point lists (game coords) -> one curve object with tapered round bevel"""
  cu = bpy.data.curves.new(name, 'CURVE'); cu.dimensions = '3D'; cu.bevel_depth = r; cu.bevel_resolution = res; cu.fill_mode = 'FULL'
  cu.resolution_u = 4
  for pts in curves:
    sp = cu.splines.new('NURBS'); sp.points.add(len(pts) - 1); sp.order_u = min(4, len(pts)); sp.use_endpoint_u = True
    for i, p in enumerate(pts):
      q = B(p[:3]); sp.points[i].co = (q.x, q.y, q.z, 1); sp.points[i].radius = p[3] if len(p) > 3 else 1.0
  return link(name, cu, part, slot, False)

def rock(name, part, slot, c, s, sub=4, seed=1, rough=0.18):
  bm = bmesh.new(); bmesh.ops.create_icosphere(bm, subdivisions=sub, radius=1.0)
  off = Vector((seed * 3.1, seed * 1.7, seed * 2.3))
  for v in bm.verts:
    u = Vector((-v.co.x, v.co.z, v.co.y)).normalized()
    k = 1 + noise.noise(u * 1.6 + off) * rough + noise.noise(u * 4.5 + off) * rough * 0.35 + noise.noise(u * 11 + off) * rough * 0.12
    # knapped facets: quantise along a few planes
    k = min(k, 1.0 + rough * 0.6)
    g = Vector((u.x * s[0] * k, u.y * s[1] * k, u.z * s[2] * k)) + Vector(c); v.co = B(g)
  me = bpy.data.meshes.new(name); bm.to_mesh(me); bm.free()
  o = link(name, me, part, slot, True); return o

# ------------------------------------------------------------------ HUMAN (parts match the in-game rig joints)
def human():
  P = 'pelvis'
  skin('pelvis_body', P, 'pants', [((0, 0.09, 0), (0.15, 0.1)), ((0, 0.02, 0), (0.165, 0.108)), ((0, -0.05, 0.005), (0.15, 0.1))])
  for sd in (-1, 1): ell('hip%d' % sd, P, 'pants', (sd * 0.095, -0.03, 0.0), (0.095, 0.1, 0.1), 24, 14)
  torus('belt', P, 'belt', (0, 0.095, 0), 0.155, 0.018, 48, 8, scale=(1, 1.15, 0.7))
  box('buckle', P, 'buckle', (0, 0.095, -0.118), (0.052, 0.036, 0.008), bev=0.002)
  box('buckleIn', P, 'belt', (0, 0.095, -0.123), (0.032, 0.018, 0.004), bev=0.001)
  for k, a in enumerate((-1.25, -0.6, 0.6, 1.25, math.pi)):
    box('loop%d' % k, P, 'pantsD', (math.sin(a) * 0.158, 0.095, -math.cos(a) * 0.106), (0.012, 0.042, 0.008), rot=(0, -a, 0), bev=0.002)
  for sd in (-1, 1):
    box('bpocket%d' % sd, P, 'pantsD', (sd * 0.07, 0.0, 0.103), (0.075, 0.08, 0.008), rot=(-0.12, 0, 0), bev=0.003)
    strands('fly%d' % sd, P, 'pantsD', [[(sd * 0.012, 0.075, -0.112), (sd * 0.014, 0.0, -0.11), (0, -0.05, -0.1)]], 0.0025)

  T = 'torso'
  skin('torso_body', T, 'shirt', [((0, 0.0, 0), (0.15, 0.1)), ((0, 0.13, 0.0), (0.155, 0.103)), ((0, 0.27, -0.005), (0.185, 0.118)),
       ((0, 0.4, 0.0), (0.17, 0.105)), ((0, 0.47, 0.0), (0.08, 0.06)), ((-0.17, 0.4, 0), 0.07), ((0.17, 0.4, 0), 0.07)],
       edges=[(0, 1), (1, 2), (2, 3), (3, 4), (3, 5), (3, 6)])
  for sd in (-1, 1):
    ell('pec%d' % sd, T, 'shirt', (sd * 0.065, 0.3, -0.06), (0.07, 0.055, 0.04), 24, 14)
    ell('shoulder%d' % sd, T, 'shirt', (sd * 0.175, 0.385, 0.0), (0.066, 0.06, 0.066), 24, 14)
  tube('neck', T, 'skin', (0, 0.43, 0.006), (0, 0.53, 0.0), 0.049, 0.046, 24, 3, False)
  ell('adam', T, 'skin', (0, 0.49, -0.04), (0.011, 0.014, 0.009), 12, 8)
  torus('collar', T, 'shirt', (0, 0.452, 0.004), 0.056, 0.009, 40, 8, rot=(0.3, 0, 0), scale=(1.1, 0.7, 1))
  for sd in (-1, 1):
    box('collarTip%d' % sd, T, 'shirt', (sd * 0.032, 0.44, -0.064), (0.04, 0.005, 0.042), rot=(1.15, 0, sd * 0.45), bev=0.002)
    box('pocket%d' % sd, T, 'shirtD', (sd * 0.075, 0.3, -0.112), (0.06, 0.07, 0.006), rot=(-0.18, 0, 0), bev=0.002)
    box('flap%d' % sd, T, 'shirtD', (sd * 0.075, 0.338, -0.118), (0.064, 0.02, 0.008), rot=(-0.18, 0, 0), bev=0.002)
  for k in range(5): tube('btn%d' % k, T, 'button', (0, 0.42 - k * 0.085, -0.108 + k * 0.004), (0, 0.42 - k * 0.085, -0.116 + k * 0.004), 0.006, 0.006, 12)
  strands('placket', T, 'shirtD', [[(0.008, 0.45, -0.098), (0.01, 0.3, -0.122), (0.008, 0.15, -0.11), (0.006, 0.0, -0.104)]], 0.003)
  for k in range(3):   # fabric folds at the waist
    strands('fold%d' % k, T, 'shirtD', [[(-0.13 + k * 0.1, 0.03, -0.1), (-0.11 + k * 0.1, 0.08, -0.106), (-0.09 + k * 0.1, 0.11, -0.104)]], 0.004)

  # ---- head (origin at the top of the neck)
  H = 'head'; EYE = [(sd * 0.032, 0.112, -0.074) for sd in (-1, 1)]
  def gauss(u, c, w): return math.exp(-((u - Vector(c)).length_squared) / (w * w))
  def headfn(g, u):
    g = Vector(g)
    if u.y < 0: g.x *= 1 - 0.3 * (-u.y) ** 1.4; g.z *= 1 - 0.08 * (-u.y)        # jaw taper
    if u.z > 0: g.z *= 1.06; g.y += 0.006 * u.z                                 # back of skull
    if u.y > 0.5: g.y *= 0.97
    for sd in (-1, 1):
      g -= Vector(u) * 0.011 * gauss(u, (sd * 0.36, 0.08, -0.93), 0.24)        # eye sockets
      g += Vector(u) * 0.006 * gauss(u, (sd * 0.62, -0.1, -0.75), 0.25)        # cheekbones
      g += Vector(u) * 0.004 * gauss(u, (sd * 0.6, -0.62, -0.5), 0.3)          # jaw corner
    g += Vector(u) * 0.006 * gauss(u, (0, 0.32, -0.95), 0.32)                  # brow ridge
    g += Vector(u) * 0.009 * gauss(u, (0, -0.82, -0.58), 0.25)                 # chin
    g -= Vector(u) * 0.004 * gauss(u, (0, -0.42, -0.9), 0.2)                   # under-lip groove
    return g
  hd = ell('skull', H, 'skin', (0, 0.115, 0.0), (0.079, 0.108, 0.097), 60, 40, fn=headfn)
  tube('neckTop', H, 'skin', (0, -0.04, 0.005), (0, 0.05, 0.0), 0.047, 0.05, 24, 2, False)
  for sd, e in zip((-1, 1), EYE):
    ell('eye%d' % sd, H, 'eyeW', e, (0.0128, 0.0128, 0.0128), 24, 16)
    ell('iris%d' % sd, H, 'iris', (e[0], e[1], e[2] - 0.0112), (0.0062, 0.0062, 0.0025), 24, 10)
    ell('pupil%d' % sd, H, 'pupil', (e[0], e[1], e[2] - 0.0127), (0.0029, 0.0029, 0.0011), 16, 8)
    ell('lidU%d' % sd, H, 'skin', (e[0], e[1] + 0.0035, e[2] - 0.0012), (0.0142, 0.0085, 0.0135), 24, 12, fn=lambda g, u: g if u.y > -0.15 else Vector((g.x, g.y * 0.2, g.z)))
    ell('lidL%d' % sd, H, 'skinD', (e[0], e[1] - 0.007, e[2] - 0.002), (0.0135, 0.004, 0.012), 20, 8)
    strands('brow%d' % sd, H, 'brow', [[(sd * 0.012, 0.135, -0.093, 1.0), (sd * 0.03, 0.14, -0.093, 1.1), (sd * 0.05, 0.137, -0.086, 0.6)]], 0.0042)
    ell('ear%d' % sd, H, 'skin', (sd * 0.079, 0.108, 0.006), (0.009, 0.027, 0.017), 20, 14, rot=(0, sd * 0.25, 0),
        fn=lambda g, u: g - Vector((u.x * 0.004, 0, 0)) * (1 if abs(u.y) < 0.6 and abs(u.z) < 0.6 else 0))
    torus('earRim%d' % sd, H, 'skinD', (sd * 0.081, 0.11, 0.008), 0.016, 0.0028, 24, 6, rot=(0, 0, math.pi / 2), scale=(1.6, 1, 1))
    ell('nostril%d' % sd, H, 'skin', (sd * 0.0095, 0.075, -0.1035), (0.0075, 0.0062, 0.0075), 16, 10)
  skin('nose', H, 'skin', [((0, 0.118, -0.093), (0.0065, 0.006)), ((0, 0.097, -0.104), (0.0075, 0.007)), ((0, 0.079, -0.112), (0.0105, 0.0095))], sub=2)
  ell('lipU', H, 'lip', (0, 0.058, -0.0955), (0.0185, 0.0048, 0.0065), 24, 10)
  ell('lipL', H, 'lip', (0, 0.05, -0.0945), (0.016, 0.0058, 0.0072), 24, 10)
  ell('chinpad', H, 'skin', (0, 0.026, -0.088), (0.022, 0.016, 0.012), 16, 10)
  # hair: scalp cap + combed clumps
  def capfn(g, u):
    g = Vector(g); hl = -0.05 + 0.25 * max(0.0, u.z) + 0.2 * abs(u.x)            # hairline (lower at the back and sides)
    if u.y < hl: g = g * 0.94                                                     # tuck below hairline inside the head
    g += Vector(u) * 0.0025 * noise.noise(Vector((u.x * 18, u.y * 6, u.z * 18)))
    return g
  ell('hairCap', H, 'hair', (0, 0.12, 0.004), (0.084, 0.113, 0.102), 52, 32, fn=capfn)
  clumps = []
  for i in range(170):
    a = random.uniform(0, TAU); el = random.uniform(0.1, 1.25)
    u = Vector((math.sin(el) * math.cos(a), math.cos(el), math.sin(el) * math.sin(a)))
    if u.y < -0.05 + 0.25 * max(0, u.z) + 0.2 * abs(u.x) + 0.04: continue
    base = Vector((u.x * 0.086, 0.12 + u.y * 0.115, 0.004 + u.z * 0.104))
    comb = Vector((u.x * 0.6, -0.4, 0.8 if u.z > -0.4 else -0.2)).normalized()      # swept back, slightly down
    pts = []
    for k in range(4):
      t = k / 3; p = base + comb * (0.03 * t) + u * (0.006 * math.sin(t * math.pi))
      d = p - Vector((0, 0.12, 0.004)); n = Vector((d.x / 0.086, d.y / 0.115, d.z / 0.104)).length
      p = Vector((0, 0.12, 0.004)) + d * (1.0 / max(n, 0.9) * 1.02)
      pts.append((p.x, p.y, p.z, 1.0 - t * 0.85))
    clumps.append(pts)
  strands('hairClumps', H, 'hair', clumps, 0.0055, 1)
  strands('stubble', H, 'brow', [[(sd * 0.05 * math.cos(a), 0.035 + 0.02 * math.sin(a * 3), -0.07 - 0.015 * math.sin(a), 0.6),
                                  (sd * 0.05 * math.cos(a) * 1.01, 0.034 + 0.02 * math.sin(a * 3), -0.073 - 0.015 * math.sin(a), 0.2)]
                                 for sd in (-1, 1) for a in [i * 0.12 for i in range(12)]], 0.0012, 0)

  # ---- arms (upper arm from the shoulder joint; forearm from the elbow, hand included)
  A = 'armU'
  skin('upper', A, 'shirt', [((0, 0.0, 0), 0.06), ((0, -0.11, 0.004), (0.064, 0.06)), ((0, -0.2, 0.008), (0.057, 0.054)), ((0, -0.31, 0.01), 0.05)])
  ell('bicep', A, 'shirt', (0, -0.14, -0.02), (0.044, 0.065, 0.036), 20, 12)
  for k in range(3): torus('crease%d' % k, A, 'shirtD', (0, -0.22 - k * 0.025, 0.012), 0.052, 0.0045, 28, 6, rot=(0.2 * (k - 1), 0, 0.15 * (k - 1)))
  for side in (1, -1):
    F = 'armL' if side > 0 else 'armL_l'
    skin('fore%d' % side, F, 'skin', [((0, -0.06, 0), (0.046, 0.044)), ((0, -0.15, 0.002), (0.041, 0.037)), ((0, -0.245, 0), (0.03, 0.024))])
    tube('cuff%d' % side, F, 'shirtD', (0, 0.02, 0), (0, -0.085, 0.0), 0.05, 0.05, 28, 4, True, prof=lambda t: 1 + 0.08 * math.sin(t * math.pi * 3))
    tube('elbow%d' % side, F, 'shirt', (0, 0.03, 0.0), (0, -0.02, 0), 0.049, 0.051, 24, 1, False)
    # hand (palm faces the body: -x for the right hand, +x for the left)
    px = -side
    ell('palm%d' % side, F, 'skin', (0, -0.3, 0.002), (0.017, 0.043, 0.037), 24, 16)
    ell('heel%d' % side, F, 'skin', (px * 0.006, -0.272, 0.012), (0.017, 0.016, 0.026), 16, 10)
    fing = [(-0.025, 0.028, 0.0078), (-0.009, 0.032, 0.0082), (0.008, 0.03, 0.008), (0.024, 0.023, 0.0072)]
    for fi, (fz, L, r) in enumerate(fing):
      p = Vector((0, -0.336, fz)); a = 0.15; pts = [((p.x, p.y, p.z), r * 1.05)]
      for seg, (ln, da) in enumerate(((L, 0.32), (L * 0.68, 0.45), (L * 0.55, 0.4))):
        a += da; p = p + Vector((px * math.sin(a) * ln, -math.cos(a) * ln, 0)); pts.append(((p.x, p.y, p.z), r * (0.95 - seg * 0.1)))
      skin('finger%d_%d' % (fi, side), F, 'skin', pts, sub=1)
      tip = pts[-1][0]; ell('nail%d_%d' % (fi, side), F, 'nail', (tip[0] - px * 0.003, tip[1] + 0.004, tip[2]), (0.0035, 0.006, 0.0055), 12, 8, rot=(0, 0, px * 0.9))
      ell('knuckle%d_%d' % (fi, side), F, 'skinD', (-px * 0.008, -0.334, fz), (0.006, 0.006, 0.0065), 12, 8)
    skin('thumb%d' % side, F, 'skin', [((px * 0.008, -0.282, -0.03), 0.0115), ((px * 0.016, -0.31, -0.046), 0.0095), ((px * 0.024, -0.335, -0.05), 0.0085), ((px * 0.028, -0.353, -0.046), 0.0078)], sub=1)
    ell('thumbnail%d' % side, F, 'nail', (px * 0.025, -0.355, -0.05), (0.004, 0.006, 0.005), 12, 8)

  # ---- legs (thigh from the hip joint; shin from the knee, boot included; foot sole at y = -0.49)
  L = 'legU'
  skin('thigh', L, 'pants', [((0, 0.0, 0), 0.098), ((0, -0.15, -0.006), (0.09, 0.092)), ((0, -0.3, 0.004), (0.075, 0.078)), ((0, -0.44, 0.012), 0.066)])
  ell('quad', L, 'pants', (0, -0.18, -0.04), (0.07, 0.12, 0.05), 20, 12)
  ell('kneecap', L, 'pantsD', (0, -0.43, -0.05), (0.04, 0.045, 0.028), 16, 10)
  strands('seamOut', L, 'pantsD', [[(0.096, 0.0, 0), (0.088, -0.2, 0), (0.07, -0.44, 0.01)]], 0.0025)
  K = 'legL'
  skin('shin', K, 'pants', [((0, 0.0, 0), 0.066), ((0, -0.12, 0.018), (0.064, 0.066)), ((0, -0.29, 0.006), (0.052, 0.054))])
  for k in range(3): torus('bunch%d' % k, K, 'pantsD', (0, -0.29 - k * 0.018, 0.006), 0.056, 0.006, 28, 6, rot=(0.15 * (k - 1), 0, 0))
  tube('bootShaft', K, 'boot', (0, -0.3, 0.008), (0, -0.43, 0.004), 0.054, 0.05, 28, 4, True, prof=lambda t: 1 - 0.06 * t)
  skin('bootFoot', K, 'boot', [((0, -0.44, 0.03), (0.048, 0.046)), ((0, -0.462, -0.04), (0.046, 0.032)), ((0, -0.468, -0.11), (0.038, 0.024))], sub=2)
  box('sole', K, 'sole', (0, -0.482, -0.035), (0.086, 0.016, 0.21), bev=0.006, seg=3, taper=lambda p: (p[0] * (0.82 if p[2] < -0.05 else 1), p[1], p[2]))
  box('heelBlock', K, 'sole', (0, -0.476, 0.045), (0.08, 0.026, 0.06), bev=0.005)
  torus('bootTop', K, 'boot', (0, -0.3, 0.008), 0.055, 0.0055, 28, 6)
  laces = []
  for k in range(6):
    y = -0.31 - k * 0.022; z = -0.048 - k * 0.012
    laces.append([(-0.02, y, z + 0.004), (0.0, y - 0.004, z - 0.006), (0.02, y - 0.011, z + 0.004)])
    laces.append([(0.02, y, z + 0.004), (0.0, y - 0.004, z - 0.006), (-0.02, y - 0.011, z + 0.004)])
  strands('laces', K, 'lace', laces, 0.0022, 1)
  for k in range(6):
    for sd in (-1, 1): torus('eyelet%d_%d' % (k, sd), K, 'brass', (sd * 0.022, -0.31 - k * 0.022, -0.046 - k * 0.012), 0.0035, 0.0012, 10, 4, rot=(math.pi / 2, 0, 0))

# ------------------------------------------------------------------ FIRST-PERSON ARM (grip at the origin, handle along +y, forward -z)
def fp_arm():
  F = 'fp_arm'
  el = (0.07, -0.36, 0.46); mid = (0.03, -0.16, 0.2); cu = (0.022, -0.115, 0.13); wr = (0.012, -0.07, 0.075)
  skin('sleeve', F, 'sleeve', [(el, 0.07), ((0.05, -0.26, 0.33), (0.066, 0.064)), (mid, 0.06)])
  for k in range(4):
    t = 0.15 + k * 0.22; c = tuple(el[i] + (mid[i] - el[i]) * t for i in range(3))
    torus('wrinkle%d' % k, F, 'sleeveD', c, 0.064 - k * 0.002, 0.005, 32, 6, rot=(0.9 + 0.25 * (k % 2), 0.2, 0.1 * (k - 2)))
  tube('cuff', F, 'sleeveD', mid, cu, 0.061, 0.064, 32, 4, True, prof=lambda t: 1 + 0.05 * math.sin(t * math.pi * 2))
  skin('wrist', F, 'skin', [((0.026, -0.14, 0.17), (0.043, 0.04)), (cu, (0.04, 0.036)), (wr, (0.034, 0.028))])
  for k in range(4): strands('tendon%d' % k, F, 'skinD', [[(0.004 + k * 0.007 - 0.01, -0.1, 0.115, 1), (0.003 + k * 0.007 - 0.01, -0.06, 0.06, 0.6), (k * 0.008 - 0.012, -0.03, 0.035, 0.2)]], 0.0026)
  ell('palm', F, 'skin', (0.004, -0.022, 0.024), (0.042, 0.052, 0.03), 32, 20)
  ell('thenar', F, 'skin', (0.03, -0.028, 0.03), (0.022, 0.034, 0.024), 20, 12)
  R = 0.027
  for f in range(4):
    y = 0.03 - f * 0.0225; L = [0.95, 1.0, 0.97, 0.85][f]; r = [0.0102, 0.0108, 0.0104, 0.0094][f]
    pts = []
    for k in range(5):
      ph = k / 4 * 2.5 * L
      pts.append(((-R * math.cos(ph) * 1.05, y - k * 0.0015, -R * math.sin(ph) * 1.05 + (0.006 if k == 0 else 0)), r * (1.05 - k * 0.07)))
    skin('finger%d' % f, F, 'skin', pts, sub=1)
    tip = pts[-1][0]; ell('nail%d' % f, F, 'nail', (tip[0] + 0.004, tip[1], tip[2] - 0.002), (0.005, 0.0045, 0.006), 12, 8)
    ell('knuckle%d' % f, F, 'skinD', (-R * 1.12, y + 0.002, 0.012), (0.009, 0.009, 0.008), 12, 8)
  skin('thumb', F, 'skin', [((0.03, -0.012, 0.016), 0.0135), ((0.036, 0.016, -0.008), 0.0118), ((0.03, 0.036, -0.026), 0.0104), ((0.016, 0.046, -0.036), 0.0094)], sub=1)
  ell('thumbnail', F, 'nail', (0.016, 0.05, -0.038), (0.006, 0.005, 0.006), 12, 8)

# ------------------------------------------------------------------ ITEMS
def handle(P, a=-0.07, b=0.44, r=0.017, slot='wood', curve=0.012):
  skin(P + '_handle', P, slot, [((0, a, 0), r * 1.08), ((0, a + (b - a) * 0.35, curve * 0.5), r), ((0, a + (b - a) * 0.7, curve), r * 0.95), ((0, b, curve * 0.6), r * 0.92)], sub=2)
  ell(P + '_knob', P, slot, (0, a - 0.006, 0), (r * 1.25, r * 0.8, r * 1.25), 20, 12)
def wrap(P, y0, y1, r, slot='cloth', turns=10, x=0.0, z=0.0):
  pts = []
  for i in range(turns * 8 + 1):
    t = i / (turns * 8); a = t * turns * TAU; pts.append((x + math.cos(a) * r, y0 + (y1 - y0) * t, z + math.sin(a) * r))
  strands(P + '_wrap', P, slot, [pts], 0.0032, 1)

def items():
  P = 'item:rock'; rock('rk', P, 'stone', (0, 0.03, -0.075), (0.066, 0.056, 0.072), 4, 3, 0.2)
  P = 'item:torch'; handle(P, -0.06, 0.26, 0.016)
  ell('t_head', P, 'cloth', (0, 0.3, 0), (0.03, 0.05, 0.03), 24, 14, fn=lambda g, u: g * (1 + 0.08 * noise.noise(u * 6)))
  wrap(P, 0.26, 0.33, 0.031, 'woodD', 4)
  for k in range(5):
    a = k / 5 * TAU; ell('flame%d' % k, P, 'flame', (math.cos(a) * 0.01, 0.355 + k * 0.004, math.sin(a) * 0.01), (0.018, 0.05 - k * 0.004, 0.018), 16, 10, fn=lambda g, u: Vector((g.x * (1 - max(0, u.y) * 0.7), g.y, g.z * (1 - max(0, u.y) * 0.7))))
  ell('ember', P, 'ember', (0, 0.335, 0), (0.024, 0.03, 0.024), 16, 10)

  for P, met in (('item:hatchet_s', False), ('item:hatchet_m', True)):
    handle(P, -0.07, 0.44, 0.017)
    if met:
      prof = [(0.03, 0.39), (-0.02, 0.385), (-0.06, 0.40), (-0.105, 0.43), (-0.12, 0.395), (-0.122, 0.355), (-0.113, 0.315), (-0.07, 0.33), (-0.025, 0.34), (0.03, 0.335)]
      slab('axe', P, 'metalD', prof, lambda z, y: max(0.0, 0.017 * (1 - max(0, (-z - 0.03)) / 0.095)))
      slab('axeEdge', P, 'edge', [(-0.108, 0.43), (-0.124, 0.395), (-0.126, 0.355), (-0.116, 0.312), (-0.1, 0.318), (-0.11, 0.36), (-0.104, 0.42)], lambda z, y: 0.0025, bev=0.0008)
      box('poll', P, 'metal', (0, 0.362, 0.03), (0.036, 0.058, 0.026), bev=0.004)
      tube('wedge', P, 'metalD', (0, 0.418, 0.0), (0, 0.425, 0.0), 0.012, 0.012, 12)
    else:
      rock('stoneHead', P, 'flint', (0, 0.37, -0.05), (0.03, 0.05, 0.075), 4, 11, 0.16)
      for k in range(3): wrap(P, 0.31 + k * 0.03, 0.335 + k * 0.03, 0.022, 'cloth', 3)
      strands('lash', P, 'cloth', [[(0.0, 0.33, 0.02), (0.02, 0.36, -0.03), (0.0, 0.39, -0.06)], [(0.0, 0.33, 0.02), (-0.02, 0.36, -0.03), (0.0, 0.39, -0.06)]], 0.003)

  for P, met in (('item:pick_s', False), ('item:pick_m', True)):
    handle(P, -0.07, 0.44, 0.017); sl = 'metalD' if met else 'flint'
    skin('pickA', P, sl, [((0, 0.385, 0.0), 0.024), ((0, 0.405, -0.08), (0.017, 0.015)), ((0, 0.41, -0.15), 0.008), ((0, 0.395, -0.185), 0.002)], sub=2)
    skin('pickB', P, sl, [((0, 0.385, 0.0), 0.024), ((0, 0.4, 0.06), 0.016), ((0, 0.39, 0.11), (0.012, 0.006)), ((0, 0.37, 0.135), 0.003)], sub=2)
    if met: box('collar', P, 'metal', (0, 0.385, 0.0), (0.042, 0.06, 0.05), bev=0.006)
    else: wrap(P, 0.36, 0.41, 0.026, 'cloth', 5)

  P = 'item:knife'
  tube('kgrip', P, 'leather', (0, -0.055, 0), (0, 0.075, 0), 0.017, 0.016, 20, 6, True, prof=lambda t: 1 + 0.08 * math.sin(t * math.pi))
  wrap(P, -0.05, 0.07, 0.018, 'cloth', 9)
  box('kguard', P, 'metalD', (0, 0.082, 0), (0.016, 0.012, 0.05), bev=0.003)
  slab('kblade', P, 'metal', [(0.012, 0.088), (-0.014, 0.088), (-0.017, 0.16), (-0.008, 0.235), (0.012, 0.25), (0.012, 0.16)], lambda z, y: max(0.0, 0.0035 * min(1, (z + 0.017) / 0.02)))
  slab('kedge', P, 'edge', [(-0.014, 0.09), (-0.017, 0.16), (-0.008, 0.235), (0.0, 0.243), (-0.012, 0.16), (-0.01, 0.09)], lambda z, y: 0.0008, bev=0)

  P = 'item:machete'
  tube('mgrip', P, 'leather', (0, -0.06, 0), (0, 0.08, 0), 0.02, 0.018, 20, 6, True, prof=lambda t: 1 + 0.1 * math.sin(t * math.pi))
  for k in range(3): torus('mrivet%d' % k, P, 'brass', (0.019, -0.03 + k * 0.045, 0), 0.004, 0.0018, 10, 5, rot=(0, 0, math.pi / 2))
  slab('mblade', P, 'metal', [(0.014, 0.085), (-0.02, 0.085), (-0.032, 0.25), (-0.036, 0.42), (-0.01, 0.47), (0.014, 0.44), (0.014, 0.25)], lambda z, y: max(0.0, 0.004 * min(1, (z + 0.03) / 0.03)))
  slab('medge', P, 'edge', [(-0.02, 0.09), (-0.032, 0.25), (-0.036, 0.42), (-0.024, 0.45), (-0.027, 0.25), (-0.016, 0.09)], lambda z, y: 0.0009, bev=0)

  P = 'item:sword'
  tube('sgrip', P, 'leather', (0, -0.06, 0), (0, 0.1, 0), 0.019, 0.018, 20, 6, True, prof=lambda t: 1 + 0.06 * math.sin(t * math.pi))
  wrap(P, -0.055, 0.095, 0.02, 'leather', 12)
  ell('pommel', P, 'metalD', (0, -0.078, 0), (0.026, 0.022, 0.026), 24, 14)
  skin('guard', P, 'metalD', [((-0.085, 0.112, 0), (0.012, 0.01)), ((0, 0.108, 0), (0.018, 0.016)), ((0.085, 0.112, 0), (0.012, 0.01))], sub=2)
  bl = [(0.032, 0.12), (-0.032, 0.12), (-0.03, 0.6), (-0.024, 0.84), (0.0, 0.95), (0.024, 0.84), (0.03, 0.6)]
  slab('sblade', P, 'metalL', bl, lambda z, y: max(0.0005, 0.006 * (1 - abs(z) / 0.032)) , rot=(0, math.pi / 2, 0))
  slab('fuller', P, 'metalD', [(0.006, 0.14), (-0.006, 0.14), (-0.006, 0.62), (0.0, 0.66), (0.006, 0.62)], lambda z, y: 0.0062, rot=(0, math.pi / 2, 0), bev=0)

  P = 'item:hammer'
  handle(P, -0.07, 0.34, 0.016)
  box('hhead', P, 'metalD', (0, 0.33, -0.005), (0.045, 0.045, 0.1), bev=0.005)
  tube('hface', P, 'metal', (0, 0.33, -0.055), (0, 0.33, -0.09), 0.026, 0.028, 24, 2)
  skin('claw', P, 'metalD', [((0, 0.335, 0.04), (0.02, 0.014)), ((0, 0.315, 0.08), (0.016, 0.01)), ((0, 0.285, 0.105), (0.01, 0.004))], sub=2)

  P = 'item:plan'
  X = (0.3, 0, 0)
  box('sheet', P, 'paper', (0.01, 0.05, -0.07), (0.15, 0.006, 0.11), rot=(0.35, 0, 0), bev=0.0015)
  tube('roll', P, 'paper', (-0.065, 0.05, -0.07), (0.085, 0.05, -0.07), 0.009, 0.009, 16, 1)
  for k, (a, b) in enumerate((((-0.05, 0.03), (0.03, 0.03)), ((-0.05, -0.03), (0.03, -0.03)), ((-0.05, -0.03), (-0.05, 0.03)), ((0.03, -0.03), (0.03, 0.03)), ((-0.01, -0.03), (-0.01, 0.0)))):
    pa = rotg((a[0], 0.004, a[1]), (0.35, 0, 0)) + Vector((0.01, 0.05, -0.07)); pb = rotg((b[0], 0.004, b[1]), (0.35, 0, 0)) + Vector((0.01, 0.05, -0.07))
    strands('line%d' % k, P, 'ink', [[tuple(pa), tuple(pb)]], 0.0012, 0)

  for P, stone in (('item:spear_w', False), ('item:spear_s', True)):
    tube('shaft', P, 'woodL', (0, -0.5, 0), (0, 0.9, 0), 0.016, 0.014, 20, 6)
    wrap(P, 0.0, 0.12, 0.017, 'leather', 8)
    if stone:
      rock('tip', P, 'flint', (0, 0.97, 0), (0.026, 0.09, 0.012), 4, 5, 0.12)
      wrap(P, 0.86, 0.92, 0.019, 'cloth', 5)
    else: skin('tip', P, 'wood', [((0, 0.88, 0), 0.016), ((0, 0.95, 0), 0.009), ((0, 1.0, 0), 0.0015)], sub=2)

  P = 'item:bow'
  pts = [];
  for i in range(11):
    t = i / 10 * 2 - 1; pts.append(((0, t * 0.5, -0.05 + (1 - t * t) * 0.09 - 0.02 * t ** 4), 0.012 * (1 - 0.45 * abs(t)) + 0.004))
  skin('limbs', P, 'woodL', pts, sub=2)
  wrap(P, -0.07, 0.07, 0.016, 'leather', 7, z=0.04)
  strands('bstring', P, 'string', [[(0, -0.49, -0.05), (0, 0.0, -0.05), (0, 0.49, -0.05)]], 0.0016, 0)

  P = 'item:crossbow'
  box('cstock', P, 'wood', (0, 0, -0.12), (0.05, 0.05, 0.55), bev=0.008)
  box('cbutt', P, 'woodD', (0, -0.06, 0.06), (0.035, 0.12, 0.05), rot=(0.25, 0, 0), bev=0.008)
  skin('prod', P, 'metalD', [((-0.27, 0.02, -0.33), 0.008), ((0, 0.02, -0.38), (0.016, 0.012)), ((0.27, 0.02, -0.33), 0.008)], sub=2)
  strands('cstring', P, 'string', [[(-0.27, 0.02, -0.33), (0, 0.028, -0.1)], [(0.27, 0.02, -0.33), (0, 0.028, -0.1)]], 0.0015, 0)
  box('rail', P, 'metal', (0, 0.03, -0.2), (0.012, 0.008, 0.32), bev=0.002)

  P = 'item:revolver'
  skin('rgrip', P, 'leather', [((0, 0.02, 0.012), (0.017, 0.024)), ((0, -0.03, 0.03), (0.019, 0.026)), ((0, -0.075, 0.048), (0.018, 0.024))], sub=2)
  box('frame', P, 'metalD', (0, 0.045, -0.03), (0.026, 0.04, 0.11), bev=0.004)
  tube('cyl', P, 'metal', (0, 0.045, 0.002), (0, 0.045, -0.06), 0.031, 0.031, 36, 2)
  for k in range(6):
    a = k / 6 * TAU + TAU / 12; tube('flute%d' % k, P, 'metalD', (math.cos(a) * 0.031, 0.045 + math.sin(a) * 0.031, -0.002), (math.cos(a) * 0.031, 0.045 + math.sin(a) * 0.031, -0.058), 0.0065, 0.0065, 10)
    a2 = k / 6 * TAU; tube('ch%d' % k, P, 'brass', (math.cos(a2) * 0.019, 0.045 + math.sin(a2) * 0.019, 0.004), (math.cos(a2) * 0.019, 0.045 + math.sin(a2) * 0.019, 0.0), 0.0052, 0.0052, 10)
  tube('barrel', P, 'metalD', (0, 0.06, -0.06), (0, 0.06, -0.215), 0.012, 0.011, 24, 1)
  tube('muzzle', P, 'pupil' if False else 'sole', (0, 0.06, -0.2155), (0, 0.06, -0.212), 0.0062, 0.0062, 16, 1)
  tube('rod', P, 'metal', (0, 0.041, -0.07), (0, 0.041, -0.175), 0.006, 0.006, 12)
  box('sight', P, 'metalD', (0, 0.074, -0.205), (0.004, 0.008, 0.012), bev=0.0015)
  skin('hammer', P, 'metalD', [((0, 0.055, 0.04), (0.006, 0.005)), ((0, 0.072, 0.05), (0.006, 0.004)), ((0, 0.078, 0.062), (0.007, 0.003))], sub=2)
  torus('tguard', P, 'metalD', (0, 0.008, -0.012), 0.017, 0.0032, 28, 6, rot=(0, 0, math.pi / 2), scale=(1, 1, 1.3))
  skin('trigger', P, 'metal', [((0, 0.022, -0.012), 0.0035), ((0, 0.008, -0.006), 0.003), ((0, 0.0, 0.0), 0.0025)], sub=1)

  def gun_stock(P, z0, z1, col):
    skin(P + '_stock', P, col, [((0, -0.01, z0), (0.02, 0.026)), ((0, -0.03, (z0 + z1) / 2), (0.022, 0.04)), ((0, -0.045, z1), (0.022, 0.055))], sub=2)
    box(P + '_pad', P, 'sole', (0, -0.045, z1 + 0.012), (0.044, 0.11, 0.016), bev=0.005)
    skin(P + '_pgrip', P, col, [((0, 0.005, 0.06), (0.016, 0.02)), ((0, -0.04, 0.075), (0.017, 0.022)), ((0, -0.075, 0.085), (0.016, 0.02))], sub=2)
  P = 'item:rifle'
  gun_stock(P, 0.09, 0.33, 'stock')
  box('recv', P, 'metalD', (0, 0.025, -0.05), (0.036, 0.055, 0.22), bev=0.004)
  box('fore', P, 'stock', (0, -0.002, -0.2), (0.044, 0.045, 0.16), bev=0.01)
  tube('rbarrel', P, 'metalD', (0, 0.035, -0.16), (0, 0.035, -0.56), 0.0115, 0.0098, 24, 1)
  tube('brake', P, 'metal', (0, 0.035, -0.54), (0, 0.035, -0.58), 0.014, 0.014, 20, 1)
  box('mag', P, 'metal', (0, -0.05, -0.035), (0.022, 0.085, 0.042), rot=(-0.15, 0, 0), bev=0.003)
  tube('scopeT', P, 'metalD', (0, 0.078, 0.02), (0, 0.078, -0.12), 0.014, 0.014, 28, 1)
  tube('scopeF', P, 'metalD', (0, 0.078, -0.12), (0, 0.078, -0.16), 0.014, 0.019, 28, 1)
  tube('scopeB', P, 'metalD', (0, 0.078, 0.05), (0, 0.078, 0.02), 0.017, 0.014, 28, 1)
  tube('lens', P, 'iris', (0, 0.078, -0.161), (0, 0.078, -0.163), 0.0165, 0.0165, 28, 1)
  for z in (-0.02, -0.09): box('ring%.2f' % z, P, 'metal', (0, 0.06, z), (0.03, 0.02, 0.012), bev=0.002)
  box('bolt', P, 'metal', (0.024, 0.035, 0.0), (0.016, 0.01, 0.01), bev=0.002)
  ell('boltK', P, 'metal', (0.034, 0.035, 0.0), (0.007, 0.007, 0.007), 12, 8)
  torus('rguard', P, 'metalD', (0, -0.012, 0.03), 0.02, 0.003, 28, 6, rot=(0, 0, math.pi / 2), scale=(1, 1, 1.4))

  P = 'item:shotgun'
  gun_stock(P, 0.1, 0.34, 'stock')
  box('srecv', P, 'metalD', (0, 0.02, -0.04), (0.04, 0.05, 0.16), bev=0.004)
  tube('sbarrel', P, 'metalD', (0, 0.035, -0.1), (0, 0.035, -0.62), 0.014, 0.014, 28, 1)
  tube('smag', P, 'metal', (0, 0.006, -0.1), (0, 0.006, -0.52), 0.011, 0.011, 24, 1)
  tube('pump', P, 'stock', (0, 0.006, -0.18), (0, 0.006, -0.3), 0.02, 0.02, 28, 8, True, prof=lambda t: 1 - 0.04 * math.cos(t * TAU * 4))
  ell('bead', P, 'brass', (0, 0.051, -0.61), (0.003, 0.003, 0.003), 10, 8)
  torus('sguard', P, 'metalD', (0, -0.012, 0.03), 0.02, 0.003, 28, 6, rot=(0, 0, math.pi / 2), scale=(1, 1, 1.4))
  for k in range(3): tube('shell%d' % k, P, 'flame' if False else 'lip', (0.022, 0.02, -0.02 - k * 0.022), (0.03, 0.02, -0.02 - k * 0.022), 0.008, 0.008, 12, 1)

# ------------------------------------------------------------------ export
def tri_data(o, dg):
  eo = o.evaluated_get(dg); me = eo.to_mesh()
  me.calc_loop_triangles()
  try: cn = [tuple(c.vector) for c in me.corner_normals]
  except Exception:
    try: me.calc_normals_split()
    except Exception: pass
    cn = [tuple(l.normal) for l in me.loops]
  M = o.matrix_world; N3 = M.to_3x3().inverted().transposed()
  # curvature AO: concave vertices darker
  nv = len(me.vertices); acc = [Vector((0, 0, 0)) for _ in range(nv)]; cnt = [0] * nv
  for e in me.edges:
    a, b = e.vertices; acc[a] += me.vertices[b].co; acc[b] += me.vertices[a].co; cnt[a] += 1; cnt[b] += 1
  ao = []
  for i, v in enumerate(me.vertices):
    if cnt[i]:
      d = acc[i] / cnt[i] - v.co
      c = d.dot(v.normal) / max(1e-5, d.length + 0.002)
      ao.append(max(0.55, min(1.0, 1.0 - max(0.0, c) * 0.9)))
    else: ao.append(1.0)
  P = []; Nn = []; A = []; TS = []
  names = [ (m.name[6:] if m and m.name.startswith('ARVEX_') else o['slot']) for m in me.materials ] or [o['slot']]
  for t in me.loop_triangles:
    sl = names[t.material_index] if t.material_index < len(names) else o['slot']; sl = sl.split('.')[0]
    TS.extend([sl if sl in SLOTS else o['slot']] * 3)
    for li, vi in zip(t.loops, t.vertices):
      p = M @ me.vertices[vi].co; n = (N3 @ Vector(cn[li])).normalized()
      P.extend(G(p)); Nn.extend(G(n)); A.append(ao[vi])
  eo.to_mesh_clear()
  return P, Nn, A, TS

def export():
  dg = bpy.context.evaluated_depsgraph_get(); parts = {}
  for o in bpy.data.objects:
    if 'part' in o: parts.setdefault(o['part'], []).append(o)
  slot_names = list(SLOTS.keys()); meshes = {}; fl = bytearray(); sb = bytearray(); ab = bytearray(); total = 0
  for part, objs in parts.items():
    for o in objs:
      Pp, Nn, A, TS = tri_data(o, dg); k = len(A)
      if not k: continue
      i0 = 0
      while i0 < k:                       # runs of equal slot -> segments
        i1 = i0
        while i1 < k and TS[i1] == TS[i0]: i1 += 1
        buf = []
        for i in range(i0, i1): buf.extend((Pp[i * 3], Pp[i * 3 + 1], Pp[i * 3 + 2], Nn[i * 3], Nn[i * 3 + 1], Nn[i * 3 + 2]))
        fl += struct.pack('<%df' % len(buf), *buf); ab += bytes(int(a * 255) for a in A[i0:i1])
        meshes.setdefault(part, []).append([TS[i0], i1 - i0]); total += i1 - i0; i0 = i1
  rp = os.path.join(OUT, 'rig.json'); rig = json.load(open(rp)) if REAL and os.path.exists(rp) else None
  hdr = json.dumps({'v': 1, 'slots': SLOTS, 'slotOrder': slot_names, 'emissive': EMISSIVE, 'parts': meshes, 'total': total, 'rig': rig}).encode()
  hdr += b' ' * ((4 - (len(hdr) + 8) % 4) % 4)
  with open(os.path.join(OUT, 'arvex_models.bin'), 'wb') as f:
    f.write(b'ARVX'); f.write(struct.pack('<I', len(hdr))); f.write(hdr); f.write(fl); f.write(bytes(total)); f.write(ab)
  return total

HB = os.path.join(os.path.dirname(OUT), 'hbm', 'human-base-meshes-bundle-v1.4.1', 'human_base_meshes_bundle.blend')
REAL = os.path.exists(HB)
clear()
if not REAL: human()
fp_arm(); items()
if REAL: exec(open(os.path.join(os.path.dirname(OUT), 'arvex_human_real.py'), encoding='utf-8').read())
# lay parts out side by side so the scene can be inspected in the viewport
xs = {}
for o in bpy.data.objects:
  if 'part' in o:
    p = o['part']; xs.setdefault(p, len(xs))
for o in bpy.data.objects:
  if 'part' in o: pass
n = export()
for o in bpy.data.objects:
  if 'part' in o: o.location.x += (xs[o['part']] % 8) * 0.6; o.location.y += (xs[o['part']] // 8) * 1.2
print('ARVEX_EXPORT_OK', n, 'verts', len(xs), 'parts')
