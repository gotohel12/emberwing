# ARVEX — realistic human from Blender's Human Base Meshes (CC0): rig with automatic weights, pose arms down,
# dress it (inflated shirt/pants, boots, belt, collar, buttons, hair, eyes, lips) and split into the in-game rig parts.
# Run after arvex_build.py (adds/replaces the human parts in the scene, then re-exports everything).
import bpy, bmesh, math, os, json
import numpy as np
from mathutils import Vector, Matrix, Quaternion

D = r"C:\Users\mohse\Desktop\Mohsen ~ Danial Games\EMBERWING\arvex_blender"
F = os.path.join(D, "hbm", "human-base-meshes-bundle-v1.4.1", "human_base_meshes_bundle.blend")
LOG = []
def log(*a): LOG.append(' '.join(str(x) for x in a))

# drop the old procedural human parts
HUMAN = ['pelvis', 'torso', 'head', 'armU', 'armL', 'armL_l', 'legU', 'legL', 'armU_l', 'legU_l', 'legL_l']
for o in list(bpy.data.objects):
  if o.get('part') in HUMAN or o.name.startswith('HB_'): bpy.data.objects.remove(o, do_unlink=True)

with bpy.data.libraries.load(F) as (src, dst): dst.objects = ['GEO-body_male_realistic']
body = dst.objects[0]; body.name = 'HB_body'; bpy.context.scene.collection.objects.link(body)
body.location = (0, 0, 0)
for m in body.modifiers:
  if m.type == 'MULTIRES': m.levels = 1; m.sculpt_levels = 1
dg = bpy.context.evaluated_depsgraph_get()
me = bpy.data.meshes.new_from_object(body.evaluated_get(dg)); body.modifiers.clear(); body.data = me
V = np.array([v.co[:] for v in me.vertices]); H = V[:, 2].max()
log('verts', len(V), 'height', H)

# ------------------------------------------------------------------ joints (Blender space: z up, front -y, character right = -x)
def arm_axis(sign):
  m = (V[:, 0] * sign > 0.24) & (V[:, 2] > 0.7)
  P = V[m]; c = P.mean(0); u, s, vt = np.linalg.svd(P - c); d = vt[0]
  if d[2] > 0: d = -d                                   # pointing down/outward
  t = (P - c) @ d; tip = c + d * t.max()
  sh = c + d * ((0.165 * sign - c[0]) / d[0])          # where the axis crosses the shoulder plane
  return Vector(sh), Vector(d), Vector(tip)
J = {}
for side, sign in (('R', -1), ('L', 1)):
  sh, d, tip = arm_axis(sign); sh.z -= 0.02
  wr = tip - d * 0.19 * (H / 1.684); el = sh + (wr - sh) * 0.54
  J['sh' + side], J['el' + side], J['wr' + side], J['tip' + side] = sh, el, wr, tip
  J['hip' + side] = Vector((0.092 * sign, 0.0, 0.528 * H)); J['knee' + side] = Vector((0.1 * sign, -0.01, 0.286 * H))
  J['ank' + side] = Vector((0.105 * sign, 0.02, 0.045 * H)); J['toe' + side] = Vector((0.11 * sign, -0.14, 0.01))
J['root'] = Vector((0, 0, 0.528 * H)); J['spine'] = Vector((0, 0, 0.58 * H)); J['neck'] = Vector((0, 0.0, 0.845 * H)); J['top'] = Vector((0, 0, H))
for k, v in J.items(): log(k, [round(x, 3) for x in v])

# ------------------------------------------------------------------ armature with automatic weights
ad = bpy.data.armatures.new('HB_rig'); arm = bpy.data.objects.new('HB_rig', ad); bpy.context.scene.collection.objects.link(arm)
bpy.context.view_layer.objects.active = arm; bpy.ops.object.mode_set(mode='EDIT')
def bone(n, h, t, parent=None):
  b = ad.edit_bones.new(n); b.head = h; b.tail = t
  if parent: b.parent = ad.edit_bones[parent]; b.use_connect = False
  return b
bone('pelvis', J['root'] - Vector((0, 0, 0.06)), J['spine'])
bone('spine', J['spine'], J['neck'] - Vector((0, 0, 0.05)), 'pelvis')
bone('head', J['neck'] - Vector((0, 0, 0.05)), J['top'], 'spine')
for s in 'RL':
  bone('upper' + s, J['sh' + s], J['el' + s], 'spine'); bone('fore' + s, J['el' + s], J['wr' + s], 'upper' + s); bone('hand' + s, J['wr' + s], J['tip' + s], 'fore' + s)
  bone('thigh' + s, J['hip' + s], J['knee' + s], 'pelvis'); bone('shin' + s, J['knee' + s], J['ank' + s], 'thigh' + s); bone('foot' + s, J['ank' + s], J['toe' + s], 'shin' + s)
bpy.ops.object.mode_set(mode='OBJECT')
for o in bpy.context.selected_objects: o.select_set(False)
body.select_set(True); arm.select_set(True); bpy.context.view_layer.objects.active = arm
try:
  bpy.ops.object.parent_set(type='ARMATURE_AUTO'); log('weights: auto')
except Exception as e:
  log('auto failed', e); bpy.ops.object.parent_set(type='ARMATURE_ENVELOPE')

# ------------------------------------------------------------------ pose: arms hang down beside the body, legs straight
bpy.context.view_layer.objects.active = arm; bpy.ops.object.mode_set(mode='POSE')
def aim(pb, target_dir):
  bpy.context.view_layer.update()
  head = arm.matrix_world.inverted() @ (arm.matrix_world @ pb.head)
  cur = (pb.tail - pb.head).normalized(); q = cur.rotation_difference(Vector(target_dir).normalized())
  M = pb.matrix.copy(); R = q.to_matrix().to_4x4()
  pb.matrix = Matrix.Translation(pb.head) @ R @ Matrix.Translation(-pb.head) @ M
  bpy.context.view_layer.update()
for s, sign in (('R', -1), ('L', 1)):
  P = arm.pose.bones
  aim(P['upper' + s], (0.16 * sign, 0.03, -1)); aim(P['fore' + s], (0.08 * sign, -0.12, -1)); aim(P['hand' + s], (0.05 * sign, -0.08, -1))
  aim(P['thigh' + s], (0.02 * sign, 0.0, -1)); aim(P['shin' + s], (0.0, 0.02, -1))
bpy.ops.object.mode_set(mode='OBJECT'); bpy.context.view_layer.update()
PJ = {}
for s in 'RL':
  P = arm.pose.bones
  PJ['sh' + s] = P['upper' + s].head.copy(); PJ['el' + s] = P['fore' + s].head.copy(); PJ['wr' + s] = P['hand' + s].head.copy(); PJ['tip' + s] = P['hand' + s].tail.copy()
  PJ['hip' + s] = P['thigh' + s].head.copy(); PJ['knee' + s] = P['shin' + s].head.copy(); PJ['ank' + s] = P['foot' + s].head.copy()
PJ['root'] = J['root']; PJ['spine'] = J['spine']; PJ['neck'] = J['neck']
dg = bpy.context.evaluated_depsgraph_get(); pm = bpy.data.meshes.new_from_object(body.evaluated_get(dg))
groups = {g.index: g.name for g in body.vertex_groups}
W = {}  # vertex -> (best bone, weight dict)
for v in me.vertices:
  ws = {groups[g.group]: g.weight for g in v.groups if g.group in groups}
  W[v.index] = ws

# ------------------------------------------------------------------ regions: skin / shirt / pants / boots / hair
P = np.array([v.co[:] for v in pm.vertices]); N = np.array([v.normal[:] for v in pm.vertices]); nV = len(P)
def best(i):
  ws = W[i]; return max(ws, key=ws.get) if ws else 'spine'
BB = [best(i) for i in range(nV)]
# ---- curl the fingers into a grip (progressive bend around the knuckle line; thumb stays out)
for s_, sign in ():   # finger curl disabled: it bent the fingers backwards
  wr = np.array(PJ['wr' + s_][:]); tp = np.array(PJ['tip' + s_][:]); d = tp - wr; Lh = np.linalg.norm(d); d /= Lh
  n = np.array([-sign, 0.0, 0.0]); n = n - d * np.dot(n, d); n /= np.linalg.norm(n); ax = np.cross(d, n); ax /= np.linalg.norm(ax)
  fw = np.cross(n, d)                                    # thumb side
  kn = wr + d * Lh * 0.47
  for i in range(nV):
    if BB[i] != 'hand' + s_: continue
    r = P[i] - wr; t = np.dot(r, d) / Lh
    if t <= 0.47 or np.dot(r, fw) * (1 if np.dot(fw, np.array([0, -1, 0])) > 0 else -1) > 0.02: continue
    th = min(1.0, (t - 0.47) / 0.53) ** 1.3 * 1.35; v = P[i] - kn
    c, sn = math.cos(th), math.sin(th)
    P[i] = kn + v * c + np.cross(ax, v) * sn + ax * np.dot(ax, v) * (1 - c)
def along(i, a, b):
  a, b = np.array(a[:]), np.array(b[:]); d = b - a; return float(np.dot(P[i] - a, d) / np.dot(d, d))
REG = []
neckZ = PJ['neck'].z
for i in range(nV):
  b = BB[i]; z = P[i][2]; r = 'skin'
  if b in ('spine', 'pelvis', 'upperR', 'upperL'): r = 'shirt' if b != 'pelvis' or z > PJ['root'].z + 0.07 else 'pants'
  if b in ('foreR', 'foreL'): r = 'shirt' if along(i, PJ['el' + b[-1]], PJ['wr' + b[-1]]) < 0.62 else 'skin'
  if b in ('thighR', 'thighL'): r = 'pants'
  if b in ('shinR', 'shinL'): r = 'pants' if z > PJ['ank' + b[-1]].z + 0.13 else 'boot'
  if b in ('footR', 'footL'): r = 'boot'
  if b == 'head' and z < neckZ - 0.005 and abs(P[i][1]) < 0.2: r = 'shirt' if z < neckZ - 0.03 else 'skin'
  if b == 'head':
    rel = P[i] - np.array(J['top'][:]); fz = z - (H - 0.24)
    hl = 0.135 + 0.06 * max(0.0, P[i][1] / 0.1) - 0.03 * min(1.0, abs(P[i][0]) / 0.07)   # hairline height above chin-ish
    if fz > hl + (0.0 if P[i][1] > -0.04 else 0.035): r = 'hair'
  if r == 'hair' and abs(P[i][0]) > 0.066 and z < H - 0.075: r = 'skin'      # ears stay skin
  REG.append(r)
# neighbours
nb = [[] for _ in range(nV)]
for e in pm.edges: a, b2 = e.vertices; nb[a].append(b2); nb[b2].append(a)
for it in range(3):                                   # majority filter: removes the stair-step spikes on region borders
  R2 = list(REG)
  for i in range(nV):
    if not nb[i]: continue
    cnt = {}
    for j in nb[i]: cnt[REG[j]] = cnt.get(REG[j], 0) + 1
    best_r = max(cnt, key=cnt.get)
    if best_r != REG[i] and cnt[best_r] * 2 > len(nb[i]): R2[i] = best_r
  REG = R2
# inflate clothing / hair and smooth away anatomy under the cloth
OFF = {'shirt': 0.02, 'pants': 0.023, 'boot': 0.024, 'hair': 0.011, 'skin': 0.0}
Q = P + N * np.array([[OFF[r]] for r in REG])
cloth = np.array([r in ('shirt', 'pants', 'boot', 'hair') for r in REG])
boot = np.array([r == 'boot' for r in REG])
for it in range(18):                                  # more passes = looser cloth, less anatomy showing through
  A = np.array([Q[n].mean(0) if n else Q[i] for i, n in enumerate(nb)])
  Q[cloth] = Q[cloth] * 0.45 + A[cloth] * 0.55
  Q[boot] = Q[boot] * 0.2 + A[boot] * 0.8          # boots: melt the toes into one shoe shape
# hair texture: small noise along the normal
from mathutils import noise
for i in range(nV):
  if REG[i] == 'hair': Q[i] += N[i] * 0.004 * noise.noise(Vector((P[i][0] * 90, P[i][1] * 40, P[i][2] * 90)))
for i, v in enumerate(pm.vertices): v.co = Q[i]

# ------------------------------------------------------------------ face painting: eyes, iris, lips, brows (per polygon)
eyeZ = H - 0.112; front = lambda x, z: P[(np.abs(P[:, 0] - x) < 0.006) & (np.abs(P[:, 2] - z) < 0.006) & (np.array(BB) == 'head')][:, 1].min() if True else 0
EYES = []
for sx in (-0.032, 0.032):
  try: fy = front(sx, eyeZ)
  except Exception: fy = -0.09
  EYES.append(Vector((sx, fy, eyeZ)))
log('eyes', [tuple(round(c, 3) for c in e) for e in EYES])
try: lipY = front(0.0, H - 0.178)
except Exception: lipY = -0.1
for e in EYES:                                         # open the lids: push an almond-shaped area back
  for i, v in enumerate(pm.vertices):
    if BB[i] != 'head': continue
    q = v.co; dx = (q.x - e.x) * (1 if e.x > 0 else -1); dz = q.z - e.z
    hh = 0.0052 + 0.0008 * (1 if dz > 0 else -0.4)      # upper lid higher than the lower one
    d2 = (dx / 0.0118) ** 2 + (dz / hh) ** 2
    if d2 < 1 and q.y < e.y + 0.01: v.co.y += 0.0062 * (1 - d2) ** 0.6
pm.update()
SL = ['skin', 'shirt', 'pants', 'boot', 'hair', 'eyeW', 'iris', 'pupil', 'lip', 'brow', 'skinD', 'shirtD']
from importlib import reload
def hmat(slot):
  if 'mat' in globals() and slot in SLOTS: return mat(slot)
  n = 'ARVEX_' + slot; m = bpy.data.materials.get(n) or bpy.data.materials.new(n); return m
pm.materials.clear()
for s in SL: pm.materials.append(hmat(s))
for f in pm.polygons:
  rs = [REG[v] for v in f.vertices]; r = max(set(rs), key=rs.count); c = Vector(P[list(f.vertices)].mean(0))
  if BB[f.vertices[0]] == 'head' and r == 'skin':
    lz = H - 0.178; hw = 0.024
    if abs(c.x) < hw and c.y < lipY + 0.012:
      k = 1 - (c.x / hw) ** 2
      if -0.0062 * k < (c.z - lz) < 0.0048 * k: r = 'lip'
  f.material_index = SL.index(r)
pm.update()

# ------------------------------------------------------------------ split into rig parts by bone weight, move to joint-local frames
S = 0.95 / PJ['root'].z      # scale so the hip sits at the in-game hip height
def GG(v): return Vector((-v[0] * S, v[2] * S, v[1] * S))
PART = {'pelvis': 'pelvis', 'spine': 'torso', 'head': 'head', 'upperR': 'armU', 'upperL': 'armU_l', 'foreR': 'armL', 'handR': 'armL', 'foreL': 'armL_l', 'handL': 'armL_l',
        'thighR': 'legU', 'thighL': 'legU_l', 'shinR': 'legL', 'footR': 'legL', 'shinL': 'legL_l', 'footL': 'legL_l'}
ORIG = {'pelvis': PJ['root'], 'torso': PJ['root'] + Vector((0, 0, 0.08 / S)), 'head': PJ['neck'], 'armU': PJ['shR'], 'armU_l': PJ['shL'], 'armL': PJ['elR'], 'armL_l': PJ['elL'],
        'legU': PJ['hipR'], 'legU_l': PJ['hipL'], 'legL': PJ['kneeR'], 'legL_l': PJ['kneeL']}
bm = bmesh.new(); bm.from_mesh(pm); dl = bm.verts.layers.deform.verify() if False else None
polys_by_part = {}
for f in pm.polygons:
  sc = {}
  for v in f.vertices:
    for g, w in W[v].items(): sc[g] = sc.get(g, 0) + w
  tot = sum(sc.values()) or 1; g = max(sc, key=sc.get) if sc else 'spine'; main = PART.get(g, 'torso'); polys_by_part.setdefault(main, []).append(f.index)
  for g2, w2 in sc.items():                 # duplicate border faces into the neighbour part so joints never open
    p2 = PART.get(g2, 'torso')
    if p2 != main and w2 / tot > 0.22 and not (p2 in ('armU', 'armU_l') and main == 'torso') and f.index not in polys_by_part.setdefault(p2, [])[-3:]: polys_by_part[p2].append(f.index)
COL = bpy.data.collections.get('HB_parts') or bpy.data.collections.new('HB_parts')
if COL.name not in bpy.context.scene.collection.children: bpy.context.scene.collection.children.link(COL)
for part, idx in polys_by_part.items():
  o0 = ORIG[part]; verts = []; faces = []; mats = []; remap = {}
  for fi in idx:
    f = pm.polygons[fi]; ff = []
    for v in f.vertices:
      if v not in remap: remap[v] = len(verts); q = pm.vertices[v].co; verts.append(((q.x - o0.x), (q.y - o0.y), (q.z - o0.z)))
      ff.append(remap[v])
    faces.append(ff); mats.append(f.material_index)
  m2 = bpy.data.meshes.new('HB_' + part); m2.from_pydata([Vector(v) * S for v in verts], [], faces)
  for s in SL: m2.materials.append(hmat(s))
  for f, mi in zip(m2.polygons, mats): f.material_index = mi; f.use_smooth = True
  o = bpy.data.objects.new('HB_' + part, m2); COL.objects.link(o); o['part'] = part; o['slot'] = 'skin'
  log(part, len(verts))


# ------------------------------------------------------------------ clothing details (posed space -> part-local game coords)
def loc(part, p): return tuple(GG(Vector(p) - ORIG[part]))
Qp = np.array([v.co[:] for v in pm.vertices])
def ring(zc, band=0.008, grow=0.004, bins=40, sel=None, rmax=1.0):
  m = (np.abs(Qp[:, 2] - zc) < band) & (sel if sel is not None else True)
  pts = Qp[m]; c = pts[:, :2].mean(0); out = []
  for k in range(bins):
    a = k / bins * math.tau; dv = np.array([math.cos(a), math.sin(a)])
    proj = (pts[:, :2] - c) @ dv; perp = np.abs((pts[:, :2] - c) @ np.array([-dv[1], dv[0]]))
    cand = proj[(perp < 0.02) & (proj > 0)]; r = min(cand.max() if len(cand) else 0.1, rmax)
    out.append((c[0] + dv[0] * (r + grow), c[1] + dv[1] * (r + grow), zc))
  return out
torsoSel = np.array([BB[i] in ('pelvis', 'spine') for i in range(nV)])
zb = PJ['root'].z + 0.07
belt = ring(zb, sel=torsoSel); bl = [loc('pelvis', p) for p in belt] + [loc('pelvis', belt[0])]
strands('belt', 'pelvis', 'belt', [bl], 0.016 * S, 1)
fr = min(belt, key=lambda p: p[1]); box('buckle', 'pelvis', 'buckle', loc('pelvis', (fr[0], fr[1] - 0.012, fr[2])), (0.05, 0.036, 0.008), bev=0.002)
for k in range(5):
  z = PJ['neck'].z - 0.08 - k * 0.075; m = (np.abs(Qp[:, 0]) < 0.01) & (np.abs(Qp[:, 2] - z) < 0.01) & torsoSel
  if m.any():
    y = Qp[m][:, 1].min(); a = loc('torso', (0, y + 0.002, z)); b2 = loc('torso', (0, y - 0.004, z)); tube('btn%d' % k, 'torso', 'button', a, b2, 0.0065, 0.0065, 14)
for s_, part in (('R', 'legL'), ('L', 'legL_l')):
  m = np.array([BB[i] in ('foot' + s_, 'shin' + s_) for i in range(nV)]) & (Qp[:, 2] < 0.05)
  if m.any():
    F_ = Qp[m]; x0, x1 = F_[:, 0].min(), F_[:, 0].max(); y0, y1 = F_[:, 1].min(), F_[:, 1].max()
    box('sole' + s_, part, 'sole', loc(part, ((x0 + x1) / 2, (y0 + y1) / 2, 0.009)), ((x1 - x0 + 0.014) * S, 0.02 * S, (y1 - y0 + 0.016) * S), bev=0.006)
    zt = PJ['ank' + s_].z + 0.12; cuff = ring(zt, 0.008, 0.004, sel=np.array([BB[i] == 'shin' + s_ for i in range(nV)]))
    strands('bootTop' + s_, part, 'boot', [[loc(part, p) for p in cuff] + [loc(part, cuff[0])]], 0.007 * S, 1)
hairIdx = [i for i in range(nV) if REG[i] == 'hair']
import random as _r; _r.seed(5); clumps = []
for i in _r.sample(hairIdx, min(900, len(hairIdx))):
  p = Vector(Qp[i]); n = Vector(N[i]); d = p - Vector((0.0, 0.045, H - 0.012)); d = (d - n * d.dot(n)).normalized(); pts = []   # flow away from the crown
  for k in range(4):
    q = p + d * (0.0085 * k) + n * (0.0012 - 0.0006 * k); pts.append(loc('head', q) + (1.0 - k * 0.28,))
  clumps.append(pts)
strands('hairStrands', 'head', 'hair', clumps, 0.0021 * S, 1)

# ---- eyeballs: the base body has open eye sockets -> fit a sclera + iris + pupil + cornea into each opening
bmE = bmesh.new(); bmE.from_mesh(pm); bmE.edges.ensure_lookup_table()
bverts = {v.index for e in bmE.edges if e.is_boundary for v in e.verts}; bmE.free()
for k_, e in enumerate(EYES):
  ring_ = [Qp[i] for i in bverts if abs(Qp[i][0] - e.x) < 0.026 and abs(Qp[i][2] - e.z) < 0.02 and Qp[i][1] < -0.06]
  if len(ring_) >= 6:
    R_ = np.array(ring_); oc = R_.mean(0); rad = float(np.percentile(np.linalg.norm(R_[:, [0, 2]] - oc[[0, 2]], axis=1), 90))
  else:
    oc = np.array([e.x, e.y + 0.004, e.z]); rad = 0.011
  rEye = 0.0122
  cen = Vector((e.x, e.y + 0.0026 + rEye, e.z))            # front of the ball just behind the old lid line
  look = Vector((0.0, -1.0, 0.0)); front_ = cen + look * rEye
  g = lambda q: loc('head', q)
  ell('eyeBall%d' % k_, 'head', 'eyeW', g(cen), (rEye * S,) * 3, 32, 18)
  ell('iris%d' % k_, 'head', 'iris', g(front_ - look * rEye * 0.16), (rEye * 0.41 * S, rEye * 0.41 * S, rEye * 0.2 * S), 28, 14)
  ell('pupil%d' % k_, 'head', 'pupil', g(front_ - look * rEye * 0.06), (rEye * 0.2 * S, rEye * 0.2 * S, rEye * 0.12 * S), 20, 10)
  log('eye', k_, [round(x, 4) for x in cen], 'r', round(rEye, 4), 'ring', len(ring_))

# rig (game space, relative offsets) for drawHuman
def g(v): return list(GG(v))
RIG = {'root': g(PJ['root']), 'torso': [0, 0.08, 0], 'neck': [a - b for a, b in zip(g(PJ['neck']), g(ORIG['torso']))],
       'sh': [a - b for a, b in zip(g(PJ['shR']), g(ORIG['torso']))], 'el': [a - b for a, b in zip(g(PJ['elR']), g(PJ['shR']))],
       'wr': [a - b for a, b in zip(g(PJ['wrR']), g(PJ['elR']))], 'hip': [a - b for a, b in zip(g(PJ['hipR']), g(PJ['root']))],
       'knee': [a - b for a, b in zip(g(PJ['kneeR']), g(PJ['hipR']))]}
json.dump(RIG, open(os.path.join(D, 'out', 'rig.json'), 'w'))
log('rig', json.dumps(RIG))
body.hide_set(True); arm.hide_set(True)
open(os.path.join(D, 'human_log.txt'), 'w').write('\n'.join(LOG)); print('ARVEX_HUMAN_DONE')

# ---- eyebrows as real hair: short strands along an arched brow line
def surf_y(x, z):
  m = (np.abs(Qp[:, 0] - x) < 0.004) & (np.abs(Qp[:, 2] - z) < 0.004) & (np.array(BB) == 'head')
  return float(Qp[m][:, 1].min()) if m.any() else None
brows = []
for e in EYES:
  sg = 1 if e.x > 0 else -1
  for k in range(26):
    u = k / 25; dx = -0.015 + 0.036 * u
    for row in (-1, 0, 1):
      zc = e.z + 0.0135 + 0.0042 * math.sin(u * math.pi * 0.85) - 0.002 * u + row * 0.0016 * (1 - 0.6 * u)
      x = e.x + sg * dx; y = surf_y(x, zc)
      if y is None: continue
      dirv = Vector((sg * (0.8 + 0.4 * u), 0.15, 0.55 - 0.9 * u)).normalized()   # inner hairs point up, outer ones out/down
      p0 = Vector((x, y - 0.0006, zc)); pts = []
      for j in range(3): pts.append(loc('head', p0 + dirv * (0.0032 * j) + Vector((0, -0.0004 * j, 0)))  + (1.0 - j * 0.3,))
      brows.append(pts)
strands('brows', 'head', 'brow', brows, 0.0011 * S, 1)
# ---- soft hairline + collar band hide the stair-stepped region borders
nbset = nb
fringe = []
for i in range(nV):
  if REG[i] != 'hair' or not any(REG[j] == 'skin' for j in nbset[i]): continue
  p = Vector(Qp[i]); n = Vector(N[i]); d = Vector((0, -0.25, -1)); d = (d - n * d.dot(n)).normalized()
  fringe.append([loc('head', p + n * (0.0012 - 0.0005 * j) + d * (0.004 * j)) + (1.0 - j * 0.35,) for j in range(3)])
strands('hairline', 'head', 'hair', fringe, 0.0018 * S, 1)
col_ = [i for i in range(nV) if REG[i] == 'shirt' and Qp[i][2] > PJ['neck'].z - 0.16 and abs(Qp[i][0]) < 0.12 and any(REG[j] == 'skin' for j in nbset[i])]
log('collar verts', len(col_))
if len(col_) > 12:
  C_ = Qp[col_]; cc = C_[:, :2].mean(0); ang = np.arctan2(C_[:, 1] - cc[1], C_[:, 0] - cc[0])
  loop = []
  for k in range(48):
    a0 = -math.pi + k / 48 * math.tau; m = np.abs(((ang - a0 + math.pi) % math.tau) - math.pi) < math.tau / 48
    if m.any(): loop.append(Vector(C_[m].mean(0)))
  if len(loop) > 10:
    loop.append(loop[0]); strands('collar', 'torso', 'shirt', [[loc('torso', q) for q in loop]], 0.0075 * S, 2)
open(os.path.join(D, 'human_log.txt'), 'w').write('\n'.join(LOG))
