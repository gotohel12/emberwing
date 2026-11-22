# ARVEX SURVIVAL 30.0 — Blender work for this release (run inside Blender: exec(open(path).read()), or through bridge.py)
#   · item:rock    the hand rock, carved to the open hand so no finger passes through it: every point of the rock lies
#                  inside the space the hand leaves free (rays from the centre of the grip stop 2.5 mm before the skin)
#   · item:ak, item:smg, item:bolt   three new firearms in hand space (right fist at (0,-0.03,0.06), fore grip at z=-0.2)
# Output: out/v30/arvex_v30_parts.bin, merged into the game's pack with tools/blender/merge_pack.py.
import bpy, os, math, random
_D = globals().get('ARVEX_DIR', r"C:\Users\mohse\Desktop\Mohsen ~ Danial Games\EMBERWING\arvex_blender")
_src = open(os.path.join(_D, 'arvex_v25.py'), encoding='utf-8').read()
exec(_src[:_src.index('# ------------------------------------------------------------------ run')], globals())
from mathutils.bvhtree import BVHTree
OUT = os.path.join(D, 'out', 'v30'); os.makedirs(OUT, exist_ok=True)
SLOTS.update({'metalGlass': hx('#1c2c3a'), 'metalB': hx('#23262a'), 'stockP': hx('#2b2420'), 'woodR': hx('#7a3f24'), 'woodRD': hx('#5a2c18')})
report = {}

# ------------------------------------------------------------------ the rock in the hand
def rock_in_hand():
  H, parts = load_pack(os.path.join(D, "out", "hand_open.bin")); hand = parts['fp_arm_open']['P']; n = len(hand) // 3
  tree = BVHTree.FromPolygons([Vector(p) for p in hand.tolist()], [(i * 3, i * 3 + 1, i * 3 + 2) for i in range(n)])
  bm = bmesh.new(); bmesh.ops.create_icosphere(bm, subdivisions=2, radius=1.0); dirs = [v.co.normalized().copy() for v in bm.verts]; bm.free()
  # 1) the centre of the grip: the point the open hand encloses best
  best = None
  for ix in range(-6, 7):
    for iy in range(-8, 13):
      for iz in range(-15, 8):
        c = Vector((ix * 0.008, iy * 0.008, iz * 0.008)); near = tree.find_nearest(c)
        if near[0] is None or near[3] < 0.016 or near[3] > 0.05: continue
        if (c - near[0]).dot(near[1]) < 0: continue                                  # inside the hand or the forearm
        hit = 0; mn = 9
        for d in dirs:
          h = tree.ray_cast(c, d, 0.085)
          if h[0] is not None: hit += 1; mn = min(mn, h[3])
        if mn < 0.014 or hit > 34: continue                                           # fully enclosed = inside the mesh after all
        score = hit + near[3] * 80 - (c - Vector((0, 0.03, -0.07))).length * 25
        if best is None or score > best[0]: best = (score, c, hit, near[3])
  score, c0, hits, clear = best
  report['rock'] = {'centre': [round(v, 4) for v in c0], 'rays_blocked': '%d of %d' % (hits, len(dirs)), 'clearance': round(clear, 4)}
  # 2) the rock: a star-shaped stone around that centre that never reaches the skin
  bm = bmesh.new(); bmesh.ops.create_icosphere(bm, subdivisions=5, radius=1.0); bm.verts.ensure_lookup_table()
  U = [v.co.normalized().copy() for v in bm.verts]; R = []; off = Vector((3.1, 7.7, 1.3))
  for u in U:
    want = 0.058 * (1 + noise.noise(u * 1.6 + off) * 0.16 + noise.noise(u * 4.2 + off) * 0.07)
    for pl in range(3):                                                             # flat fracture faces, as on the world's rocks
      nn = Vector((math.cos(pl * 2.1 + 0.4), 0.3 * math.sin(pl * 1.7), math.sin(pl * 2.1 + 0.4))).normalized(); dd = u.dot(nn)
      if dd > 0.8: want *= 0.8 / dd
    h = tree.ray_cast(c0, u, 0.2)
    R.append(min(want, h[3] - 0.0025) if h[0] is not None else want)
  nb = [[e.other_vert(v).index for e in v.link_edges] for v in bm.verts]
  M = 0.003                                                                         # the rock keeps 3 mm from the skin everywhere
  def lip(n):                                                                       # the surface may not rise faster than it spreads: nothing bulges out between two fingers
    for _ in range(n):
      for i in range(len(R)):
        m = min(R[j] for j in nb[i]) + 0.0016
        if R[i] > m: R[i] = m
  def clear_skin():
    for i, u in enumerate(U):
      for _ in range(60):
        p = c0 + u * R[i]; near = tree.find_nearest(p)
        if near[0] is None or (near[3] >= M and (p - near[0]).dot(near[1]) >= 0) or R[i] <= 0.01: break
        R[i] -= 0.0008
  lip(40); clear_skin(); lip(12); clear_skin(); lip(4)
  R = [max(0.01, r) for r in R]
  for v, u, r in zip(bm.verts, U, R): v.co = B(c0 + u * (r - abs(noise.noise(u * 17 + off)) * 0.0006))
  me = bpy.data.meshes.new('rock_hand'); bm.to_mesh(me); bm.free()
  for sname in ('stone', 'stoneD', 'stoneL', 'flint'): me.materials.append(mat(sname))
  for p in me.polygons:
    c = Vector(G(p.center)); nrm = Vector(G(p.normal)); k = noise.noise(c * 55 + off)
    p.material_index = 1 if (nrm.y < -0.35 or k < -0.3) else 2 if (nrm.y > 0.45 and k > 0.0) else 3 if k > 0.33 else 0; p.use_smooth = True
  o = bpy.data.objects.new('rock_hand', me); col_for('item:rock').objects.link(o); o['part'] = 'item:rock'; o['slot'] = 'stone'
  # proof: how far the rock stays from the skin, and that no rock triangle crosses a hand triangle
  rt = BVHTree.FromObject(o, bpy.context.evaluated_depsgraph_get()); mn = 9
  for v in me.vertices: mn = min(mn, tree.find_nearest(Vector(G(v.co)))[3])
  ht = BVHTree.FromPolygons([B(p) for p in hand.tolist()], [(i * 3, i * 3 + 1, i * 3 + 2) for i in range(n)])
  report['rock'].update({'radius': [round(min(R), 4), round(max(R), 4)], 'closest_to_skin_mm': round(mn * 1000, 2), 'triangles_crossing_hand': len(rt.overlap(ht)), 'tris': len(me.polygons)})
  hobj, _ = part_object('hand_ref', hand, parts['fp_arm_open']['tslot'], 'ref:hand'); return [o, hobj]

# ------------------------------------------------------------------ firearms (hand space: x right, y up, muzzle towards -z)
def grip(P, slot='stockP', z=0.06, lean=0.022, top=0.012, low=-0.118):
  tube(P, slot, (0, top, z - 0.004), (0, low, z + lean), 0.0178, 0.0166, 14, 3); ell(P, slot, (0, low, z + lean), (0.0166, 0.006, 0.0166), 12, 6)
def foregrip(P, slot='stockP', z=-0.2, top=0.012, low=-0.095):
  tube(P, slot, (0, top, z), (0, low, z), 0.0172, 0.0164, 14, 2); ell(P, slot, (0, low, z), (0.0164, 0.005, 0.0164), 12, 6); box(P, 'metalB', (0, top + 0.002, z), (0.03, 0.01, 0.044), bev=0.003)
def trigger(P, z=0.022):
  box(P, 'metalB', (0, -0.034, z), (0.006, 0.004, 0.058), bev=0.0015); box(P, 'metalB', (0, -0.017, z - 0.028), (0.006, 0.034, 0.004), bev=0.0015)
  box(P, 'metal', (0, -0.016, z + 0.006), (0.004, 0.022, 0.005), rot=(0.35, 0, 0), bev=0.001)
def mag_curved(P, z, y, n=5, seg=0.034, w=0.021, d=0.056, turn=0.085, slot='metalB'):
  py, pz, a = y, z, 0.0
  for k in range(n):
    a = k * turn; py2 = py - seg * math.cos(a); pz2 = pz - seg * math.sin(a)
    box(P, slot if k % 2 == 0 else 'metalD', (0, (py + py2) / 2, (pz + pz2) / 2), (w, seg + 0.004, d), rot=(a, 0, 0), bev=0.004)
    for sx in (-1, 1): box(P, 'metal', (sx * (w / 2 + 0.0005), (py + py2) / 2, (pz + pz2) / 2), (0.0015, seg * 0.7, d * 0.5), rot=(a, 0, 0), bev=0)
    py, pz = py2, pz2
  box(P, 'metalD', (0, py - 0.002, pz), (w + 0.004, 0.006, d + 0.004), rot=(a, 0, 0), bev=0.002)

def ak():
  P = 'item:ak'
  prism(P, 'metalD', [(-0.16, 0.004), (0.105, 0.004), (0.105, 0.05), (0.07, 0.056), (-0.16, 0.056)], -0.0175, 0.0175, bev=0.003)           # receiver
  prism(P, 'metal', [(-0.155, 0.056), (0.075, 0.056), (0.07, 0.068), (0.03, 0.074), (-0.15, 0.074)], -0.0155, 0.0155, bev=0.004)           # dust cover
  for z in (-0.12, -0.06, 0.0): box(P, 'metalD', (0, 0.0745, z), (0.026, 0.002, 0.004), bev=0)
  box(P, 'metalB', (0.019, 0.05, -0.06), (0.004, 0.012, 0.11), bev=0.001); tube(P, 'metal', (0.018, 0.05, -0.085), (0.04, 0.05, -0.085), 0.0045, 0.004, 8)   # ejection port and charging handle
  box(P, 'metalB', (0.0185, 0.03, 0.03), (0.002, 0.008, 0.07), rot=(0.12, 0, 0), bev=0)                                                # selector lever
  prism(P, 'woodR', [(0.1, 0.05), (0.36, 0.036), (0.365, -0.058), (0.34, -0.064), (0.2, -0.012), (0.1, 0.004)], -0.0155, 0.0155, bev=0.006)  # stock
  box(P, 'metalD', (0, -0.012, 0.364), (0.033, 0.098, 0.006), bev=0.002)
  prism(P, 'woodR', [(-0.32, 0.006), (-0.165, 0.004), (-0.165, 0.046), (-0.32, 0.044)], -0.019, 0.019, bev=0.006)                          # lower handguard
  prism(P, 'woodRD', [(-0.31, 0.05), (-0.17, 0.052), (-0.17, 0.076), (-0.31, 0.072)], -0.0155, 0.0155, bev=0.006)                          # upper handguard
  for z in (-0.29, -0.25, -0.21): box(P, 'metalB', (0.0195, 0.026, z), (0.002, 0.012, 0.022), bev=0)                                      # vents
  tube(P, 'metalD', (0, 0.034, -0.16), (0, 0.034, -0.63), 0.0088, 0.008, 14, 1)                                                          # barrel
  tube(P, 'metal', (0, 0.063, -0.31), (0, 0.063, -0.45), 0.008, 0.0075, 12, 1); box(P, 'metalD', (0, 0.05, -0.452), (0.024, 0.04, 0.02), bev=0.003)   # gas tube and block
  box(P, 'metalD', (0, 0.05, -0.33), (0.026, 0.05, 0.014), bev=0.002)
  tube(P, 'metalB', (0, 0.034, -0.63), (0, 0.034, -0.675), 0.0125, 0.011, 12, 1); box(P, 'metalB', (0, 0.046, -0.652), (0.004, 0.006, 0.03), bev=0)    # muzzle brake
  box(P, 'metalD', (0, 0.058, -0.585), (0.014, 0.05, 0.016), bev=0.002); box(P, 'metalB', (0, 0.089, -0.585), (0.003, 0.014, 0.003), bev=0)          # front sight
  for sx in (-1, 1): box(P, 'metalD', (sx * 0.008, 0.086, -0.585), (0.002, 0.018, 0.012), bev=0)
  box(P, 'metalD', (0, 0.08, -0.155), (0.022, 0.012, 0.03), bev=0.002); box(P, 'metalB', (0, 0.086, -0.12), (0.012, 0.004, 0.07), rot=(0.05, 0, 0), bev=0.001)   # rear sight
  tube(P, 'metal', (0, 0.012, -0.5), (0, 0.012, -0.3), 0.0035, 0.0035, 6, 1)                                                             # cleaning rod
  mag_curved(P, -0.075, 0.006, 5, 0.036, 0.021, 0.06, 0.1, 'metalR'); box(P, 'metalB', (0, -0.004, -0.035), (0.01, 0.02, 0.006), bev=0.001)
  grip(P, 'woodRD'); trigger(P); foregrip(P, 'woodRD')

def smg():
  P = 'item:smg'
  tube(P, 'metalB', (0, 0.04, -0.2), (0, 0.04, 0.105), 0.0205, 0.0205, 18, 1)                                                            # upper receiver tube
  prism(P, 'metalD', [(-0.13, -0.004), (0.1, -0.004), (0.1, 0.03), (-0.13, 0.03)], -0.0165, 0.0165, bev=0.004)                             # lower receiver
  box(P, 'metalB', (0, 0.04, 0.108), (0.036, 0.04, 0.012), bev=0.004)
  prism(P, 'stockP', [(-0.3, 0.012), (-0.165, 0.012), (-0.165, 0.066), (-0.3, 0.06)], -0.021, 0.021, bev=0.008)                            # handguard
  for z in (-0.275, -0.245, -0.215, -0.185): box(P, 'metalB', (0.0215, 0.04, z), (0.002, 0.014, 0.016), bev=0)
  tube(P, 'metalD', (0, 0.04, -0.3), (0, 0.04, -0.37), 0.0078, 0.0075, 12, 1); tube(P, 'metalB', (0, 0.04, -0.37), (0, 0.04, -0.395), 0.0105, 0.0105, 12, 1)   # barrel and flash hider
  tube(P, 'metal', (0.019, 0.052, -0.17), (0.04, 0.062, -0.17), 0.004, 0.0035, 8)                                                        # cocking handle
  torus(P, 'metalB', (0, 0.078, -0.275), 0.012, 0.0028, 16, 6, rot=(math.pi / 2, 0, 0)); box(P, 'metalB', (0, 0.068, -0.275), (0.01, 0.014, 0.01), bev=0.002); box(P, 'metalD', (0, 0.076, -0.275), (0.002, 0.012, 0.002), bev=0)   # hooded front sight
  tube(P, 'metalB', (-0.012, 0.072, 0.05), (0.012, 0.072, 0.05), 0.011, 0.011, 12); box(P, 'metalD', (0, 0.064, 0.05), (0.02, 0.01, 0.022), bev=0.002)        # drum rear sight
  mag_curved(P, -0.07, -0.002, 5, 0.034, 0.018, 0.034, 0.05, 'metalD'); box(P, 'metalB', (0, -0.012, -0.045), (0.008, 0.02, 0.005), bev=0.001)
  for sx in (-1, 1): tube(P, 'metal', (sx * 0.013, 0.03, 0.1), (sx * 0.013, 0.03, 0.3), 0.004, 0.004, 8)                                  # sliding stock
  prism(P, 'stockP', [(0.3, 0.06), (0.325, 0.058), (0.325, -0.05), (0.3, -0.046)], -0.017, 0.017, bev=0.005)
  box(P, 'metalD', (0.0175, 0.014, 0.03), (0.002, 0.008, 0.05), rot=(0.2, 0, 0), bev=0)
  grip(P, 'stockP'); trigger(P); foregrip(P, 'stockP')

def bolt():
  P = 'item:bolt'
  prism(P, 'wood', [(-0.34, 0.0), (-0.1, -0.012), (0.09, -0.006), (0.16, -0.03), (0.4, -0.07), (0.41, 0.03), (0.2, 0.05), (0.09, 0.036), (-0.34, 0.026)], -0.0165, 0.0165, bev=0.007)   # stock
  prism(P, 'woodD', [(0.24, 0.05), (0.4, 0.045), (0.4, 0.062), (0.25, 0.066)], -0.012, 0.012, bev=0.005)                                   # cheek rest
  box(P, 'metalB', (0, -0.02, 0.408), (0.035, 0.108, 0.008), bev=0.003)
  tube(P, 'metalD', (0, 0.042, -0.16), (0, 0.042, 0.11), 0.0145, 0.0145, 16, 1); tube(P, 'metalD', (0, 0.042, -0.16), (0, 0.042, -0.74), 0.0105, 0.0085, 14, 1)   # receiver and barrel
  tube(P, 'metalB', (0, 0.042, -0.74), (0, 0.042, -0.78), 0.0125, 0.0125, 12, 1)
  tube(P, 'metal', (0.012, 0.046, 0.06), (0.046, 0.022, 0.072), 0.0042, 0.0042, 8); ell(P, 'metalB', (0.05, 0.019, 0.074), (0.0085, 0.0085, 0.0085), 12, 8)       # bolt handle
  tube(P, 'metal', (0, 0.042, 0.11), (0, 0.042, 0.135), 0.0095, 0.008, 10, 1)
  box(P, 'metalB', (0, -0.022, -0.06), (0.022, 0.03, 0.07), bev=0.004)                                                                 # magazine
  # telescopic sight
  tube(P, 'metalB', (0, 0.094, -0.15), (0, 0.094, 0.08), 0.0135, 0.0135, 16, 1)
  tube(P, 'metalB', (0, 0.094, -0.24), (0, 0.094, -0.15), 0.0215, 0.0135, 18, 2); tube(P, 'metalB', (0, 0.094, 0.08), (0, 0.094, 0.125), 0.0135, 0.0185, 18, 2)
  tube(P, 'metalGlass', (0, 0.094, -0.2395), (0, 0.094, -0.2385), 0.0195, 0.0195, 18); tube(P, 'metalGlass', (0, 0.094, 0.1242), (0, 0.094, 0.1252), 0.0165, 0.0165, 18)
  tube(P, 'metalD', (0, 0.105, -0.035), (0, 0.124, -0.035), 0.0085, 0.0085, 12); tube(P, 'metalD', (0.011, 0.094, -0.035), (0.03, 0.094, -0.035), 0.0085, 0.0085, 12)   # turrets
  for z in (-0.1, 0.035):
    torus(P, 'metalD', (0, 0.094, z), 0.0145, 0.0035, 16, 6, rot=(math.pi / 2, 0, 0)); box(P, 'metalD', (0, 0.067, z), (0.014, 0.026, 0.014), bev=0.002)
  box(P, 'metalD', (0, 0.058, -0.03), (0.016, 0.006, 0.19), bev=0.002)
  grip(P, 'woodD', 0.06, 0.03, 0.0, -0.112); trigger(P); tube(P, 'metalB', (0, -0.018, -0.26), (0, -0.03, -0.26), 0.004, 0.004, 8)

# ------------------------------------------------------------------ run
clear()
shown = []
ro = rock_in_hand(); shown.append(('rock_in_hand', ro, 150, 18)); shown.append(('rock_in_hand_b', ro, 330, 30)); shown.append(('rock_in_hand_c', ro, 60, -20)); shown.append(('rock_only', ro[:1], 30, 20))
ak(); smg(); bolt(); bpy.context.view_layer.update()
for o in [o for o in bpy.data.objects if o.get('part') == 'ref:hand']: o['part_ref'] = 1; del o['part']       # the hand is only there for the pictures
total, tris = export(os.path.join(OUT, 'arvex_v30_parts.bin'))
report['tris'] = tris; json.dump(report, open(os.path.join(OUT, 'report.json'), 'w'), indent=1)
log('EXPORT', total, 'vertices', tris); log('ROCK', json.dumps(report['rock']))
by = {}
for o in bpy.data.objects:
  if 'part' in o: by.setdefault(o['part'], []).append(o)
for p in ('item:ak', 'item:smg', 'item:bolt'):
  shown.append((p.replace(':', '_'), by[p], 70, 12)); shown.append((p.replace(':', '_') + '_b', by[p], 250, 14))
log('renders', renders(shown))
try: bpy.ops.wm.save_as_mainfile(filepath=os.path.join(D, 'arvex_v30.blend'))
except Exception as ex: log('save failed', ex)
log('ARVEX_V30_DONE')
