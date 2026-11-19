# EMBERWING — Blender asset build (Mohsen ~ Danial)
# Builds every model in high detail, writes the game-ready file ew_models.bin and preview renders.
# Run inside Blender:  exec(open(r'...\ew_build.py', encoding='utf-8').read())
import bpy, bmesh, math, os, json, struct, time, traceback, random
from mathutils import Vector, Matrix, noise

BASE = r"C:\Users\mohse\Desktop\Mohsen ~ Danial Games\EMBERWING\Blender"
OUT = os.path.join(BASE, "out")
os.makedirs(OUT, exist_ok=True)
STAGE = globals().get("EW_STAGE", "all")
LOGF = open(os.path.join(OUT, "log_%s.txt" % STAGE), "w", encoding="utf-8")
def log(*a):
    s = " ".join(str(x) for x in a); LOGF.write(s + "\n"); LOGF.flush(); print(s)

TAU = math.pi * 2
V = Vector
def clamp(x, a=0.0, b=1.0): return a if x < a else b if x > b else x
def sstep(a, b, x):
    t = clamp((x - a) / (b - a)) if b != a else 0.0
    return t * t * (3 - 2 * t)
def lerp(a, b, t): return a + (b - a) * t

# ------------------------------------------------------------------ roles (= materials)
# Each face carries a role; each corner carries ew=(shade, blend, emit). The game resolves
# role colours from the current world palette / phoenix skin / enemy palette at load time.
ROLES = ['P_BODY', 'P_WING', 'P_TIP', 'P_BEAK', 'P_EYE', 'P_DARK',
         'GRASS', 'ROCK', 'LEAF', 'TRUNK', 'ACCENT', 'FLOWER', 'STONE', 'GOLD',
         'E_DARK', 'E_GLOW', 'E_EYE', 'GATE', 'FEATHER']
PREV = {  # preview colours (A, B) for the renders
    'P_BODY': ((1.0, 0.27, 0.05), (1.0, 0.70, 0.20)), 'P_WING': ((1.0, 0.36, 0.06), (1.0, 0.85, 0.35)),
    'P_TIP': ((1.0, 0.85, 0.35), (1.0, 1.0, 0.85)), 'P_BEAK': ((1.0, 0.75, 0.25), (0.5, 0.25, 0.05)),
    'P_EYE': ((1.0, 1.0, 0.9), (0.02, 0.02, 0.02)), 'P_DARK': ((0.05, 0.03, 0.02), (0.2, 0.1, 0.05)),
    'GRASS': ((0.32, 0.55, 0.14), (0.55, 0.68, 0.20)), 'ROCK': ((0.55, 0.40, 0.30), (0.25, 0.18, 0.14)),
    'LEAF': ((0.22, 0.50, 0.14), (0.85, 0.50, 0.12)), 'TRUNK': ((0.30, 0.19, 0.12), (0.15, 0.10, 0.07)),
    'ACCENT': ((1.0, 0.75, 0.3), (1.0, 1.0, 1.0)), 'FLOWER': ((1.0, 0.45, 0.35), (1.0, 0.85, 0.4)),
    'STONE': ((0.86, 0.82, 0.74), (0.55, 0.52, 0.47)), 'GOLD': ((0.95, 0.70, 0.30), (0.55, 0.35, 0.12)),
    'E_DARK': ((0.06, 0.035, 0.10), (0.20, 0.10, 0.30)), 'E_GLOW': ((0.70, 0.36, 1.0), (1.0, 0.85, 1.0)),
    'E_EYE': ((1.0, 0.95, 1.0), (0.0, 0.0, 0.0)), 'GATE': ((1.0, 0.80, 0.40), (1.0, 1.0, 1.0)),
    'FEATHER': ((1.0, 0.55, 0.15), (1.0, 0.93, 0.62)),
}
RI = {r: i for i, r in enumerate(ROLES)}

def make_mat(role):
    m = bpy.data.materials.get("EW_" + role) or bpy.data.materials.new("EW_" + role)
    try: m.use_nodes = True
    except Exception: pass
    nt = m.node_tree
    for n in list(nt.nodes): nt.nodes.remove(n)
    out = nt.nodes.new('ShaderNodeOutputMaterial')
    bs = nt.nodes.new('ShaderNodeBsdfPrincipled')
    at = nt.nodes.new('ShaderNodeAttribute'); at.attribute_name = 'ew'
    sp = nt.nodes.new('ShaderNodeSeparateColor')
    nt.links.new(at.outputs['Color'], sp.inputs[0])
    A, B = PREV[role]
    ca = nt.nodes.new('ShaderNodeCombineXYZ'); ca.inputs[0].default_value, ca.inputs[1].default_value, ca.inputs[2].default_value = A
    cb = nt.nodes.new('ShaderNodeCombineXYZ'); cb.inputs[0].default_value, cb.inputs[1].default_value, cb.inputs[2].default_value = B
    d = nt.nodes.new('ShaderNodeVectorMath'); d.operation = 'SUBTRACT'
    nt.links.new(cb.outputs[0], d.inputs[0]); nt.links.new(ca.outputs[0], d.inputs[1])
    s = nt.nodes.new('ShaderNodeVectorMath'); s.operation = 'SCALE'
    nt.links.new(d.outputs[0], s.inputs[0]); nt.links.new(sp.outputs[1], s.inputs['Scale'])
    a = nt.nodes.new('ShaderNodeVectorMath'); a.operation = 'ADD'
    nt.links.new(ca.outputs[0], a.inputs[0]); nt.links.new(s.outputs[0], a.inputs[1])
    mm = nt.nodes.new('ShaderNodeMath'); mm.operation = 'MULTIPLY'; mm.inputs[1].default_value = 1.6
    nt.links.new(sp.outputs[0], mm.inputs[0])
    s2 = nt.nodes.new('ShaderNodeVectorMath'); s2.operation = 'SCALE'
    nt.links.new(a.outputs[0], s2.inputs[0]); nt.links.new(mm.outputs[0], s2.inputs['Scale'])
    nt.links.new(s2.outputs[0], bs.inputs['Base Color'])
    em = nt.nodes.new('ShaderNodeMath'); em.operation = 'MULTIPLY'; em.inputs[1].default_value = 1.5
    nt.links.new(sp.outputs[2], em.inputs[0])
    for nm in ('Emission Color', 'Emission'):
        if nm in bs.inputs:
            nt.links.new(a.outputs[0], bs.inputs[nm]); break
    if 'Emission Strength' in bs.inputs: nt.links.new(em.outputs[0], bs.inputs['Emission Strength'])
    bs.inputs['Roughness'].default_value = 0.25 if role in ('GOLD', 'P_EYE', 'E_EYE', 'GATE') else 0.6
    if role == 'GOLD': bs.inputs['Metallic'].default_value = 0.8
    nt.links.new(bs.outputs[0], out.inputs[0])
    return m

MATS = []

# ------------------------------------------------------------------ bmesh part helpers
class Part:
    """one bmesh with an 'ew' float colour layer; faces get a role, corners get (shade, blend, emit)."""
    def __init__(self):
        self.bm = bmesh.new()
        self.cl = self.bm.loops.layers.float_color.new('ew')
    def paint(self, faces, role, fn):
        cl = self.cl
        for f in faces:
            f.material_index = RI[role]
            for lp in f.loops:
                s, b, e = fn(lp.vert.co, f)
                lp[cl] = (clamp(s), clamp(b), clamp(e), 1.0)
    def grid(self, rings, closed=True, cap0=None, cap1=None):
        """rings: list of lists of Vector (same length). returns faces"""
        bm = self.bm
        vr = [[bm.verts.new(p) for p in r] for r in rings]
        faces = []
        n = len(rings[0]); m = n if closed else n - 1
        for i in range(len(vr) - 1):
            a, b = vr[i], vr[i + 1]
            for j in range(m):
                j2 = (j + 1) % n
                faces.append(bm.faces.new((a[j], a[j2], b[j2], b[j])))
        if cap0 is not None:
            c = bm.verts.new(cap0)
            for j in range(n):
                faces.append(bm.faces.new((vr[0][(j + 1) % n], vr[0][j], c)))
        if cap1 is not None:
            c = bm.verts.new(cap1)
            for j in range(n):
                faces.append(bm.faces.new((vr[-1][j], vr[-1][(j + 1) % n], c)))
        return faces
    def obj(self, name, col, subsurf=0, solid=0.0, smooth=True):
        bm = self.bm
        bm.normal_update()
        me = bpy.data.meshes.new(name)
        bm.to_mesh(me); bm.free()
        for m in MATS: me.materials.append(m)
        for p in me.polygons: p.use_smooth = smooth
        ob = bpy.data.objects.new(name, me); col.objects.link(ob)
        if solid > 0:
            md = ob.modifiers.new("solid", 'SOLIDIFY'); md.thickness = solid; md.offset = 0.0
            try: md.use_even_offset = True
            except Exception: pass
        if subsurf > 0:
            md = ob.modifiers.new("sub", 'SUBSURF'); md.levels = subsurf; md.render_levels = subsurf
        return ob

def frame(o, xa, za=V((0, 0, 1))):
    """matrix with origin o, local X along xa, local Z ~ za"""
    x = V(xa).normalized(); z0 = V(za)
    if abs(x.dot(z0.normalized())) > 0.97: z0 = V((0, 1, 0)) if abs(x.z) > 0.9 else V((0, 0, 1))
    y = z0.cross(x).normalized(); z = x.cross(y).normalized()
    M = Matrix.Identity(4)
    for r in range(3): M[r][0], M[r][1], M[r][2], M[r][3] = x[r], y[r], z[r], o[r]
    return M

def ellipse_ring(c, ax, ay, rx, ry, n, jit=None):
    """ring around centre c in plane spanned by unit vectors ax, ay"""
    out = []
    for j in range(n):
        a = j / n * TAU
        k = 1.0 + (jit(a) if jit else 0.0)
        out.append(c + ax * (math.cos(a) * rx * k) + ay * (math.sin(a) * ry * k))
    return out

def tube(P, path, radii, n=10, role='TRUNK', fn=None, cap0=True, cap1=True, jit=None):
    """loft a circular tube along path (list of Vector) with radii list."""
    rings = []
    for i, p in enumerate(path):
        t = (path[min(i + 1, len(path) - 1)] - path[max(i - 1, 0)]).normalized()
        up = V((0, 0, 1)) if abs(t.z) < 0.95 else V((1, 0, 0))
        ax = t.cross(up).normalized(); ay = t.cross(ax).normalized()
        rr = radii[i]
        rings.append(ellipse_ring(p, ax, ay, rr, rr, n, (lambda a, i=i: jit(a, i)) if jit else None))
    faces = P.grid(rings, True, path[0] - (path[1] - path[0]).normalized() * radii[0] * 0.3 if cap0 else None,
                   path[-1] + (path[-1] - path[-2]).normalized() * radii[-1] * 0.3 if cap1 else None)
    if fn: P.paint(faces, role, fn)
    return faces

def curve(p0, p1, bend, n):
    """quadratic curve from p0 to p1 bulging by vector bend"""
    out = []
    mid = (p0 + p1) * 0.5 + bend
    for i in range(n + 1):
        t = i / n
        out.append(p0 * (1 - t) ** 2 + mid * 2 * (1 - t) * t + p1 * t * t)
    return out

def fbm(p, oct=4):
    try: return noise.fractal(p, 1.0, 2.0, oct)
    except TypeError: return noise.fractal(p, 1.0, 2.0, oct, noise_basis='PERLIN_ORIGINAL')

def feather(P, M, L, W, role='P_WING', nu=11, nv=5, camber=0.12, curl=0.0, twist=0.0,
            shade=0.62, tipglow=0.7, baseglow=0.08, lead=0.55, tipblend=1.0, notch=0.0):
    """a feather: shaft along local +X (0..L), vane across local Y (lead side +Y narrower), up = local Z."""
    rows = []
    for i in range(nu + 1):
        u = i / nu
        prof = math.sin(math.pi * min(1.0, u ** 0.7)) ** 0.75 if u < 1 else 0.0
        w = W * prof * (1 - 0.18 * u)
        row = []
        for j in range(nv + 1):
            v = j / nv * 2 - 1                         # -1 trailing .. +1 leading
            hw = w * (lead if v > 0 else 1.0)
            y = v * hw
            if notch and v < 0: y *= 1 - notch * (0.5 + 0.5 * math.sin(u * 22))
            z = camber * W * (1 - v * v) + curl * L * u * u
            yy = y * math.cos(twist * u) ; zz = z + y * math.sin(twist * u)
            row.append(M @ V((u * L, yy, zz)))
        rows.append(row)
    bm = P.bm
    vr = [[bm.verts.new(p) for p in r] for r in rows]
    faces = []
    meta = {}
    for i in range(nu):
        for j in range(nv):
            f = bm.faces.new((vr[i][j], vr[i][j + 1], vr[i + 1][j + 1], vr[i + 1][j]))
            faces.append(f); meta[f] = (i + 0.5) / nu
    cl = P.cl
    for f in faces:
        f.material_index = RI[role]
        for lp in f.loops:
            # find u of this vertex from its row
            pass
    # per-vertex u from construction
    uv = {}
    for i, r in enumerate(vr):
        for j, vv in enumerate(r): uv[vv] = (i / nu, abs(j / nv * 2 - 1))
    for f in faces:
        for lp in f.loops:
            u, ac = uv[lp.vert]
            s = shade * (0.82 + 0.18 * (1 - ac)) * (0.9 + 0.1 * u)
            if ac < 0.12: s *= 0.8                          # rachis line
            b = clamp(tipblend * sstep(0.25, 1.0, u))
            e = baseglow + tipglow * sstep(0.5, 1.0, u)
            lp[cl] = (clamp(s), b, clamp(e), 1.0)
    return faces

# ------------------------------------------------------------------ export (custom, game-ready)
EXPORT = {}   # name -> list of (obj, extra matrix)
def reg(name, objs, M=None):
    EXPORT.setdefault(name, [])
    for o in (objs if isinstance(objs, (list, tuple)) else [objs]):
        EXPORT[name].append((o, M))

TOGAME = Matrix(((1, 0, 0, 0), (0, 0, 1, 0), (0, -1, 0, 0), (0, 0, 0, 1)))   # blender (x,y,z) -> game (x, z, -y)

def collect(items, dg):
    P, N, A, I = [], [], [], []
    idx = {}
    for ob, extra in items:
        ev = ob.evaluated_get(dg)
        me = ev.to_mesh()
        me.calc_loop_triangles()
        Mw = TOGAME @ (extra if extra is not None else Matrix.Identity(4)) @ ob.matrix_world
        Nm = Mw.to_3x3().inverted().transposed()
        col = me.color_attributes.get('ew')
        dom = col.domain if col else None
        try:
            cn = me.corner_normals; cnf = lambda li: cn[li].vector
        except Exception:
            cnf = None
        mats = [ (ob.material_slots[i].material.name[3:] if ob.material_slots[i].material else 'ROCK') for i in range(len(ob.material_slots))]
        verts = me.vertices; loops = me.loops
        for tri in me.loop_triangles:
            role = RI.get(mats[tri.material_index] if tri.material_index < len(mats) else 'ROCK', 0)
            sn = None
            if cnf is None:
                try: sn = tri.split_normals
                except Exception: sn = [tri.normal] * 3
            for k, li in enumerate(tri.loops):
                vi = loops[li].vertex_index
                co = Mw @ verts[vi].co
                n = (Nm @ (cnf(li) if cnf else V(sn[k]))).normalized()
                if col is not None:
                    c = col.data[li if dom == 'CORNER' else vi].color
                    a = (int(round(clamp(c[0]) * 255)), int(round(clamp(c[1]) * 255)), int(round(clamp(c[2]) * 255)))
                else:
                    a = (160, 0, 0)
                key = (round(co.x, 3), round(co.y, 3), round(co.z, 3), round(n.x, 2), round(n.y, 2), round(n.z, 2), role) + a
                j = idx.get(key)
                if j is None:
                    j = len(P); idx[key] = j
                    P.append((co.x, co.y, co.z)); N.append((n.x, n.y, n.z)); A.append((role,) + a)
                I.append(j)
        ev.to_mesh_clear()
    return P, N, A, I

def write_bin(path):
    dg = bpy.context.evaluated_depsgraph_get()
    head = {'roles': ROLES, 'meshes': {}}
    data = bytearray()
    def pad4():
        while len(data) % 4: data.append(0)
    total = 0
    for name, items in EXPORT.items():
        try:
            P, N, A, I = collect(items, dg)
        except Exception:
            log("EXPORT FAIL", name, traceback.format_exc()); continue
        if not P: continue
        if len(P) > 65535:
            log("TOO MANY VERTS", name, len(P)); continue
        lo = [min(p[k] for p in P) for k in range(3)]; hi = [max(p[k] for p in P) for k in range(3)]
        c = [(lo[k] + hi[k]) / 2 for k in range(3)]; h = max(max(hi[k] - lo[k] for k in range(3)) / 2, 1e-4)
        q = h / 32767.0
        pad4(); po = len(data)
        data += b''.join(struct.pack('<3h', *[int(round((p[k] - c[k]) / q)) for k in range(3)]) for p in P)
        pad4(); no = len(data)
        data += b''.join(struct.pack('<4b', int(round(n[0] * 127)), int(round(n[1] * 127)), int(round(n[2] * 127)), 0) for n in N)
        ao = len(data)
        data += b''.join(struct.pack('<4B', *a) for a in A)
        pad4(); io_ = len(data)
        data += struct.pack('<%dH' % len(I), *I)
        head['meshes'][name] = {'v': len(P), 'i': len(I), 'c': [round(x, 4) for x in c], 'q': q, 'po': po, 'no': no, 'ao': ao, 'io': io_,
                                'lo': [round(x, 3) for x in lo], 'hi': [round(x, 3) for x in hi]}
        total += len(I) // 3
        log("mesh", name, "verts", len(P), "tris", len(I) // 3)
    js = json.dumps(head, separators=(',', ':')).encode()
    while len(js) % 4: js += b' '
    with open(path, 'wb') as fh:
        fh.write(b'EWM1' + struct.pack('<I', len(js)) + js + data)
    log("wrote", path, os.path.getsize(path), "total tris", total)

# ------------------------------------------------------------------ scene utils
def get_col(name):
    c = bpy.data.collections.get(name)
    if c is None:
        c = bpy.data.collections.new(name); bpy.context.scene.collection.children.link(c)
    return c
def clear_col(name):
    c = bpy.data.collections.get(name)
    if c:
        for ob in list(c.objects): bpy.data.objects.remove(ob, do_unlink=True)
def hide_others(keep):
    for c in bpy.context.scene.collection.children:
        try:
            lc = bpy.context.view_layer.layer_collection.children[c.name]; lc.exclude = c.name not in keep
        except Exception: pass

# ================================================================== PHOENIX
# Blender frame: +X right, +Y forward, +Z up.  (game: +X right, +Y up, -Z forward)
BODY_SEC = [  # y, half width, half height, z centre
    (-9.2, 0.35, 0.35, 0.4), (-8.0, 1.7, 1.5, 0.45), (-6.0, 2.9, 2.6, 0.3), (-3.0, 3.6, 3.25, 0.05),
    (0.0, 3.75, 3.45, 0.0), (2.6, 3.45, 3.3, 0.35), (4.6, 2.55, 2.55, 1.25), (6.0, 1.95, 2.05, 2.05),
    (7.4, 2.35, 2.45, 2.65), (8.9, 2.75, 2.6, 2.85), (10.2, 2.25, 2.25, 2.7), (11.0, 1.35, 1.5, 2.45), (11.5, 0.45, 0.6, 2.35)]

def body_at(y):
    S = BODY_SEC
    if y <= S[0][0]: return S[0][1:]
    for a, b in zip(S, S[1:]):
        if a[0] <= y <= b[0]:
            t = (y - a[0]) / (b[0] - a[0]); t = t * t * (3 - 2 * t)
            return tuple(lerp(a[k], b[k], t) for k in (1, 2, 3))
    return S[-1][1:]

def body_pt(y, ang, out=0.0):
    hw, hh, zc = body_at(y)
    return V((math.cos(ang) * (hw + out), y, zc + math.sin(ang) * (hh + out)))

def build_phoenix(col):
    parts = []
    # --- body (torso + neck + head) : one smooth loft
    P = Part()
    ys = [S[0] for S in BODY_SEC]
    fine = []
    for a, b in zip(ys, ys[1:]):
        for k in range(3): fine.append(lerp(a, b, k / 3))
    fine.append(ys[-1])
    rings = []
    for y in fine:
        hw, hh, zc = body_at(y)
        rings.append([V((math.cos(j / 32 * TAU) * hw, y, zc + math.sin(j / 32 * TAU) * hh * (1 - 0.08 * max(0, -math.sin(j / 32 * TAU))))) for j in range(32)])
    f = P.grid(rings, True, V((0, -9.5, 0.4)), V((0, 11.7, 2.35)))
    def bodyc(co, fc):
        hw, hh, zc = body_at(co.y)
        nz = (co.z - zc) / max(hh, 0.3)
        belly = sstep(0.1, -0.7, nz)
        g = 0.12 + 0.1 * sstep(6, 10, co.y)
        return (0.6 + 0.08 * nz, belly, g)
    P.paint(f, 'P_BODY', bodyc)
    # beak: hooked, lofted along a curve
    bp = curve(V((0, 10.7, 2.3)), V((0, 14.2, 1.0)), V((0, 0.2, 0.9)), 10)
    rings = []
    for i, p in enumerate(bp):
        t = i / (len(bp) - 1); r = lerp(1.15, 0.05, t ** 0.9)
        rings.append(ellipse_ring(p, V((1, 0, 0)), V((0, 0, 1)), r * 0.85, r * (1.0 + 0.25 * (1 - t)), 12))
    f = P.grid(rings, True, None, bp[-1] + V((0, 0.05, -0.12)))
    P.paint(f, 'P_BEAK', lambda co, fc: (0.62, sstep(13.0, 14.3, co.y) * 0.6, 0.05))
    # eyes
    for sx in (-1, 1):
        r = bmesh.ops.create_uvsphere(P.bm, u_segments=16, v_segments=10, radius=0.8)
        bmesh.ops.translate(P.bm, verts=r['verts'], vec=V((sx * 1.55, 9.95, 3.15)))
        fe = list({fc for v in r['verts'] for fc in v.link_faces})
        P.paint(fe, 'P_EYE', lambda co, fc, sx=sx: (lambda d: (0.62, 1.0 if d > 0.82 else 0.0, 0.0 if d > 0.82 else 0.9))((co - V((sx * 1.55, 9.95, 3.15))).normalized().dot(V((sx * 0.75, 0.5, 0.2)).normalized())))
    parts.append(P.obj("ph_body_core", col, subsurf=1))
    # --- plumage on the body: neck ruff, back scales, crest
    F = Part()
    for i in range(16):
        a = i / 16 * TAU
        o = body_pt(5.6, a, -0.2)
        d = (V((math.cos(a) * 0.55, -1.0, math.sin(a) * 0.55))).normalized()
        nrm = V((math.cos(a), 0, math.sin(a)))
        feather(F, frame(o, d, nrm), 4.2 + (1.0 if math.sin(a) > 0 else 0.0), 1.15, 'P_WING', nu=7, nv=3, camber=0.25, curl=0.06, shade=0.66, tipglow=0.55, baseglow=0.12)
    for row in range(4):
        y0 = 3.2 - row * 3.0
        n = 7 - (row == 3)
        for i in range(n):
            a = math.pi * (0.18 + 0.64 * (i + 0.5 * (row % 2)) / (n))
            o = body_pt(y0, a, -0.15)
            nrm = V((math.cos(a), 0.0, math.sin(a)))
            d = (V((math.cos(a) * 0.25, -1.0, math.sin(a) * 0.15))).normalized()
            feather(F, frame(o, d, nrm), 3.6, 1.25, 'P_WING', nu=6, nv=3, camber=0.3, curl=0.04, shade=0.6, tipglow=0.35, baseglow=0.1, tipblend=0.6)
    for i in range(5):
        sx = (i - 2) * 0.32
        o = V((sx, 8.4 - abs(i - 2) * 0.3, 4.7 - abs(i - 2) * 0.25))
        d = V((sx * 0.6, -0.9, 0.42)).normalized()
        feather(F, frame(o, d, V((0, 0.6, 0.8))), 6.0 - abs(i - 2) * 1.0, 0.75, 'P_TIP', nu=10, nv=3, camber=0.2, curl=0.12, shade=0.65, tipglow=0.95, baseglow=0.25, lead=1.0)
    for i in range(6):   # cheek / belly tufts
        a = math.pi * (1.15 + 0.7 * i / 5)
        o = body_pt(1.0 - i * 1.4, a, -0.1)
        feather(F, frame(o, V((math.cos(a) * 0.3, -1, math.sin(a) * 0.2)), V((math.cos(a), 0, math.sin(a)))), 3.4, 1.3, 'P_BODY', nu=6, nv=3, camber=0.3, shade=0.66, tipglow=0.2, baseglow=0.1, tipblend=0.9)
    parts.append(F.obj("ph_body_plume", col, subsurf=1))
    reg('phoenix_body', parts)
    # --- tail: origin = attachment point (game [0,0.6,6.5])
    T = Part()
    for i in range(-3, 4):
        a = i * 0.2
        L = 15.5 - abs(i) * 1.4
        d = V((math.sin(a), -math.cos(a), -0.03)).normalized()
        feather(T, frame(V((i * 0.25, 0, 0.05 * abs(i))), d, V((0, 0, 1))), L, 2.0, 'P_WING', nu=14, nv=5, camber=0.15, curl=0.025, twist=i * 0.05, shade=0.62, tipglow=0.95, baseglow=0.15)
    for sx in (-1, 1):
        d = V((sx * 0.12, -1, 0.02)).normalized()
        feather(T, frame(V((sx * 0.3, 0, 0.25)), d, V((0, 0, 1))), 22.0, 1.0, 'P_TIP', nu=18, nv=3, camber=0.15, curl=0.06, twist=sx * 0.6, shade=0.66, tipglow=1.0, baseglow=0.3, lead=1.0)
    for i in range(-2, 3):   # tail coverts
        a = i * 0.25
        feather(T, frame(V((i * 0.3, 0.8, 0.5)), V((math.sin(a), -math.cos(a), 0.08)), V((0, 0, 1))), 6.5, 1.8, 'P_BODY', nu=7, nv=3, camber=0.3, shade=0.62, tipglow=0.4, baseglow=0.15, tipblend=0.7)
    reg('phoenix_tail', T.obj("ph_tail", col, subsurf=1))
    # --- inner wing (right): hinge at origin, span +X to 12
    Wi = Part()
    arm = [V((x, 1.2 - x * 0.05, 0.15 - x * 0.01)) for x in [0, 2, 4, 6, 8, 10, 12.4]]
    rings = []
    for i, p in enumerate(arm):
        t = i / (len(arm) - 1)
        rings.append(ellipse_ring(p, V((0, 1, 0)), V((0, 0, 1)), lerp(2.3, 1.3, t), lerp(0.95, 0.5, t), 12))
    f = Wi.grid(rings, True, arm[0] - V((0.3, 0, 0)), arm[-1] + V((0.5, 0, 0)))
    Wi.paint(f, 'P_WING', lambda co, fc: (0.62, 0.05, 0.12))
    for i in range(10):        # secondaries
        x = 0.4 + i * 1.28
        d = V((0.06 + x * 0.008, -1, -0.04)).normalized()
        feather(Wi, frame(V((x, 0.6, -0.05 - i * 0.012)), d, V((0, 0, 1))), 9.6 - i * 0.18, 1.55, 'P_WING', nu=12, nv=4, camber=0.1, curl=0.02, shade=0.62, tipglow=0.75, baseglow=0.12)
    for i in range(11):        # greater coverts
        x = 0.2 + i * 1.18
        feather(Wi, frame(V((x, 1.6, 0.42)), V((0.1, -1, -0.03)), V((0, 0, 1))), 4.6, 1.3, 'P_WING', nu=6, nv=3, camber=0.22, shade=0.6, tipglow=0.35, baseglow=0.1, tipblend=0.55)
    for i in range(12):        # lesser coverts (leading edge)
        x = 0.1 + i * 1.05
        feather(Wi, frame(V((x, 2.3, 0.75)), V((0.15, -1, -0.1)), V((0, 0, 1))), 2.6, 1.0, 'P_BODY', nu=5, nv=3, camber=0.3, shade=0.58, tipglow=0.2, baseglow=0.1, tipblend=0.4)
    reg('phoenix_wing_in', Wi.obj("ph_wing_in", col, subsurf=1))
    # --- outer wing (right): elbow at origin, span to ~15.5, tips around (15, -6)
    Wo = Part()
    hand = [V((x, 0.7 - x * 0.06, 0.05)) for x in [0, 1.5, 3, 4.5, 6.2]]
    rings = []
    for i, p in enumerate(hand):
        t = i / (len(hand) - 1)
        rings.append(ellipse_ring(p, V((0, 1, 0)), V((0, 0, 1)), lerp(1.3, 0.6, t), lerp(0.5, 0.3, t), 10))
    f = Wo.grid(rings, True, hand[0] - V((0.3, 0, 0)), hand[-1] + V((0.4, 0, 0)))
    Wo.paint(f, 'P_WING', lambda co, fc: (0.62, 0.15, 0.15))
    for i in range(10):        # primaries fan
        t = i / 9
        x = 0.3 + t * 5.6
        ang = lerp(-1.45, -0.32, t ** 0.9)         # direction angle (from +X), sweeping back
        d = V((math.cos(ang), math.sin(ang), -0.03))
        L = lerp(8.8, 14.5, t ** 0.7) - (1.6 if i == 9 else 0)
        feather(Wo, frame(V((x, 0.2, -0.04 - i * 0.015)), d, V((0, 0, 1))), L, lerp(1.6, 1.25, t), 'P_WING', nu=14, nv=4, camber=0.1, curl=0.03, twist=-0.15 * t,
                shade=0.62, tipglow=0.9, baseglow=0.14, lead=0.45, notch=0.0)
    for i in range(7):         # hand coverts
        t = i / 6; x = 0.2 + t * 5.4
        ang = lerp(-1.4, -0.6, t)
        feather(Wo, frame(V((x, 0.9, 0.38)), V((math.cos(ang), math.sin(ang), -0.04)), V((0, 0, 1))), 4.4, 1.15, 'P_WING', nu=6, nv=3, camber=0.25, shade=0.6, tipglow=0.4, baseglow=0.1, tipblend=0.6)
    reg('phoenix_wing_out', Wo.obj("ph_wing_out", col, subsurf=1))
    return parts

# ================================================================== ENEMIES (role E_DARK / E_GLOW / E_EYE)
def lumpy_sphere(P, c, r, sub, amp, freq, role='E_DARK', glowfn=None, seed=0.0, squash=(1, 1, 1)):
    res = bmesh.ops.create_icosphere(P.bm, subdivisions=sub, radius=1.0)
    vs = res['verts']
    for v in vs:
        d = v.co.normalized()
        n = fbm(d * freq + V((seed, seed * 1.7, seed * 0.3)), 4)
        v.co = c + V((d.x * squash[0], d.y * squash[1], d.z * squash[2])) * r * (1 + amp * n)
    fs = list({f for v in vs for f in v.link_faces})
    def fn(co, f):
        d = (co - c).normalized()
        g = glowfn(d) if glowfn else 0.0
        return (0.55 + 0.15 * fbm(d * 3.0 + V((seed, 0, 0)), 2), clamp(g * 0.5), g)
    P.paint(fs, role, fn)
    return fs

def cracks(d, scale=2.6, width=0.06):
    try:
        dist, pts = noise.voronoi(d * scale)
        e = dist[1] - dist[0]
    except Exception:
        e = 1.0
    return clamp(1.0 - e / width) * 0.95

def horn(P, base, dirv, L, r0, bend, n=8, segs=8, role='E_DARK', tipg=0.9):
    path = curve(base, base + dirv * L, bend, segs)
    radii = [r0 * (1 - i / segs) ** 1.1 + 0.05 for i in range(segs + 1)]
    tube(P, path, radii, n, role, lambda co, f: (0.5, 0.2, tipg * sstep(0.55, 1.0, (co - base).length / L)), cap1=True)

def build_drifter(col):
    P = Part()
    lumpy_sphere(P, V((0, 0, 0)), 11.0, 3, 0.12, 1.6, glowfn=lambda d: cracks(d, 2.4, 0.07), seed=1.3)
    rnd = random.Random(7)
    for i in range(16):
        a = i / 16 * TAU + rnd.uniform(-0.2, 0.2); b = rnd.uniform(-0.75, 0.75)
        d = V((math.cos(a) * math.cos(b), math.sin(a) * math.cos(b) * 0.9 - 0.25, math.sin(b)))
        if d.y > 0.55: continue
        d.normalize()
        horn(P, d * 9.8, d, rnd.uniform(9, 15), 2.6, V((0, -3.5, 0)) + d.cross(V((0, 0, 1))) * 1.5)
    # eye: socket, iris, slit pupil  (front = +Y)
    tube(P, [V((0, 9.0, 0.8)), V((0, 10.4, 0.9)), V((0, 10.9, 0.9))], [4.6, 4.3, 3.7], 20, 'E_DARK', lambda co, f: (0.45, 0.0, 0.25), cap0=False, cap1=False)
    r = bmesh.ops.create_uvsphere(P.bm, u_segments=20, v_segments=12, radius=1.0)
    for v in r['verts']: v.co = V((v.co.x * 3.6, v.co.y * 1.6 + 10.0, v.co.z * 3.6 + 0.9))
    P.paint(list({f for v in r['verts'] for f in v.link_faces}), 'E_GLOW', lambda co, f: (0.62, sstep(1.5, 0.0, math.hypot(co.x, co.z - 0.9)) * 0.9, 1.0))
    r = bmesh.ops.create_uvsphere(P.bm, u_segments=12, v_segments=8, radius=1.0)
    for v in r['verts']: v.co = V((v.co.x * 0.55, v.co.y * 0.4 + 11.5, v.co.z * 2.6 + 0.9))
    P.paint(list({f for v in r['verts'] for f in v.link_faces}), 'E_EYE', lambda co, f: (0.6, 1.0, 0.0))
    for i in range(5):  # trailing wisps
        a = i / 5 * TAU
        base = V((math.cos(a) * 5, -7, math.sin(a) * 5 - 3))
        path = curve(base, base + V((math.cos(a) * 4, -18, math.sin(a) * 3 - 6)), V((math.sin(a) * 4, 0, 2)), 10)
        tube(P, path, [lerp(1.6, 0.15, k / 10) for k in range(11)], 7, 'E_DARK', lambda co, f, base=base: (0.5, 0.3, 0.9 * sstep(10, 22, (co - base).length)))
    reg('drifter', P.obj("drifter", col, subsurf=1))

def build_lancer(col):
    P = Part()
    path = [V((0, y, 0.0)) for y in [-17, -12, -6, 0, 6, 12, 18, 24, 30, 36]]
    rw = [0.6, 2.6, 4.2, 5.0, 4.6, 3.6, 2.5, 1.6, 0.9, 0.15]
    rh = [0.6, 2.0, 3.2, 4.0, 3.6, 2.8, 1.9, 1.2, 0.7, 0.15]
    rings = []
    for i, p in enumerate(path):
        ring = []
        for j in range(16):
            a = j / 16 * TAU
            k = 1.0 + 0.18 * math.cos(a * 2) ** 2     # diamond-ish
            ring.append(p + V((math.cos(a) * rw[i] * k, 0, math.sin(a) * rh[i] * (1.15 if math.sin(a) > 0 else 0.8))))
        rings.append(ring)
    f = P.grid(rings, True, V((0, -18.5, 0)), V((0, 38.5, 0)))
    P.paint(f, 'E_DARK', lambda co, fc: (0.52, 0.2 if co.z > 0 else 0.0, 0.95 * sstep(0.7, 0.2, abs(co.x)) * (1 if co.z > 0 else 0) + 0.9 * sstep(26, 36, co.y)))
    for sx in (-1, 1):    # swept blade wings
        rings = []
        for k in range(9):
            t = k / 8
            ox = sx * (3.5 + t * 15); oy = 4 - t * 16 - t * t * 4; oz = -0.4 + t * 1.5
            ch = lerp(12, 2.0, t ** 0.8); th = lerp(1.2, 0.15, t)
            ring = []
            for j in range(10):
                a = j / 10 * TAU
                ring.append(V((ox, oy + math.cos(a) * ch * 0.5 - ch * 0.15, oz + math.sin(a) * th)))
            rings.append(ring)
        f = P.grid(rings, True, None, V((sx * 18.8, -16.5, 1.1)))
        P.paint(f, 'E_DARK', lambda co, fc, sx=sx: (0.5, 0.3, 0.9 * sstep(14, 18.5, abs(co.x)) + 0.6 * sstep(-0.4, -1.0, (co.y - (4 - (abs(co.x) - 3.5) / 15 * 16)) / 6.0) * 0))
    for sgn in (1, -1):   # dorsal / ventral fins
        rings = []
        for k in range(6):
            t = k / 5
            rings.append(ellipse_ring(V((0, lerp(-4, -14, t), sgn * (3.2 + t * 7))), V((0, 1, 0)), V((1, 0, 0)), lerp(6, 1.2, t), lerp(0.7, 0.1, t), 8))
        f = P.grid(rings, True, None, V((0, -15, sgn * 11)))
        P.paint(f, 'E_DARK', lambda co, fc: (0.5, 0.3, 0.85 * sstep(7, 10, abs(co.z))))
    # glowing eyes along the spear
    for sx in (-1, 1):
        for k in range(3):
            r = bmesh.ops.create_uvsphere(P.bm, u_segments=10, v_segments=6, radius=0.55 - k * 0.1)
            bmesh.ops.translate(P.bm, verts=r['verts'], vec=V((sx * (3.2 - k * 0.7), 9 + k * 3.2, 1.6 - k * 0.3)))
            P.paint(list({f for v in r['verts'] for f in v.link_faces}), 'E_GLOW', lambda co, f: (0.62, 0.8, 1.0))
    reg('lancer', P.obj("lancer", col, subsurf=1))

def build_leech(col):
    P = Part()
    path = [V((0, y, 0)) for y in [-8, -6, -4, -2, 0, 2, 4, 6, 8]]
    rings = []
    for i, p in enumerate(path):
        t = i / (len(path) - 1)
        bulge = 1 + 0.12 * math.cos(t * TAU * 3)
        rx = (4.0 + 3.2 * math.sin(math.pi * min(1, t * 1.1))) * bulge; rz = rx * 0.85
        rings.append([p + V((math.cos(j / 18 * TAU) * rx, 0, math.sin(j / 18 * TAU) * rz)) for j in range(18)])
    # mouth: open ring at the front
    rings.append([V((math.cos(j / 18 * TAU) * 3.4, 8.6, math.sin(j / 18 * TAU) * 3.0)) for j in range(18)])
    rings.append([V((math.cos(j / 18 * TAU) * 2.2, 7.4, math.sin(j / 18 * TAU) * 1.9)) for j in range(18)])
    f = P.grid(rings, True, V((0, -8.6, 0)), V((0, 5.5, 0)))
    P.paint(f, 'E_DARK', lambda co, fc: (0.5 + 0.12 * math.cos(co.y * 1.6), 0.3 * sstep(0, -6, co.z), 0.85 if co.y > 7.2 and math.hypot(co.x, co.z) < 2.6 else 0.25 * sstep(0.5, 1, math.cos(co.y * 1.6)) * sstep(-1, -5, co.z)))
    for i in range(10):   # teeth ring
        a = i / 10 * TAU
        b = V((math.cos(a) * 3.1, 8.3, math.sin(a) * 2.7))
        horn(P, b, (V((0, 0.35, 0)) - b.normalized() * 0.6).normalized() * -1 * -1, 1.8, 0.45, V((0, 0.3, 0)), 6, 4, 'E_EYE', 0.0)
    for sx in (-1, 1):
        r = bmesh.ops.create_uvsphere(P.bm, u_segments=12, v_segments=8, radius=1.2)
        bmesh.ops.translate(P.bm, verts=r['verts'], vec=V((sx * 2.8, 5.4, 4.6)))
        P.paint(list({f for v in r['verts'] for f in v.link_faces}), 'E_GLOW', lambda co, f: (0.62, 0.6, 1.0))
    for i in range(6):    # tentacles trailing back
        a = i / 6 * TAU + 0.3
        base = V((math.cos(a) * 3.2, -6.0, math.sin(a) * 3.0 - 0.5))
        path = curve(base, base + V((math.cos(a) * 5, -15, math.sin(a) * 4 - 3)), V((math.sin(a * 2) * 3, 0, 2)), 10)
        tube(P, path, [lerp(1.3, 0.12, k / 10) for k in range(11)], 7, 'E_DARK', lambda co, f, base=base: (0.5, 0.4, 0.95 * sstep(9, 16, (co - base).length)))
    reg('leech', P.obj("leech", col, subsurf=1))

def build_maw(col):
    """boss: ring in game XY plane (blender XZ), facing game -Z (blender +Y). ~600 units across."""
    P = Part()
    rnd = random.Random(11)
    for i in range(18):    # armour plates
        a = i / 18 * TAU
        c = V((math.cos(a) * 232, 0, math.sin(a) * 232))
        rad = V((math.cos(a), 0, math.sin(a))); tan = V((-math.sin(a), 0, math.cos(a)))
        rings = []
        for k in range(7):
            t = k / 6
            w = lerp(44, 34, abs(t - 0.5) * 2) * 0.5
            p = c + rad * lerp(-80, 85, t) + V((0, -18 * math.sin(t * math.pi) - (10 if i % 2 else 0), 0))
            rings.append([p + tan * (math.cos(j / 8 * TAU) * w) + V((0, 1, 0)) * (math.sin(j / 8 * TAU) * lerp(26, 14, t)) for j in range(8)])
        f = P.grid(rings, True, c - rad * 88, c + rad * 92 + V((0, -6, 0)))
        P.paint(f, 'E_DARK', lambda co, fc, i=i: (0.5 + (0.08 if i % 2 else 0), 0.45 if i % 2 else 0.1, 0.0))
        # glowing seam between plates
        g = V((math.cos(a + TAU / 36) * 232, 22, math.sin(a + TAU / 36) * 232))
        tube(P, [g - V((math.cos(a + TAU / 36), 0, math.sin(a + TAU / 36))) * 70, g + V((math.cos(a + TAU / 36), 0, math.sin(a + TAU / 36))) * 70], [3.5, 3.5], 6, 'E_GLOW', lambda co, f: (0.6, 0.3, 0.9))
    for i in range(24):    # inner fangs pointing to centre
        a = i / 24 * TAU
        b = V((math.cos(a) * 168, 14, math.sin(a) * 168))
        horn(P, b, -V((math.cos(a), 0, math.sin(a))), rnd.uniform(70, 105), 13, V((0, 22, 0)), 10, 8, 'E_DARK', 0.55)
    for i in range(12):    # outer spines
        a = i / 12 * TAU + 0.13
        b = V((math.cos(a) * 300, -10, math.sin(a) * 300))
        horn(P, b, V((math.cos(a), -0.25, math.sin(a))).normalized(), rnd.uniform(90, 140), 18, V((0, -30, 0)), 10, 8, 'E_DARK', 0.7)
    # back shell (dark dome behind the mouth)
    rings = []
    for k in range(9):
        t = k / 8
        r = 200 * math.cos(t * math.pi / 2) + 2
        rings.append([V((math.cos(j / 40 * TAU) * r, -10 - 120 * math.sin(t * math.pi / 2), math.sin(j / 40 * TAU) * r)) for j in range(40)])
    f = P.grid(rings, True, None, V((0, -132, 0)))
    P.paint(f, 'E_DARK', lambda co, fc: (0.4, 0.0, 0.0))
    # vortex rings & glowing throat
    for k, (r, y) in enumerate([(140, -20), (105, -38), (70, -55), (38, -70)]):
        rings = []
        for j in range(3):
            rings.append(ellipse_ring(V((0, y + (j - 1) * 3, 0)), V((1, 0, 0)), V((0, 0, 1)), r + (j - 1) * 4 + 0.0, r + (j - 1) * 4, 48))
        f = P.grid(rings, True)
        P.paint(f, 'E_GLOW', lambda co, fc, k=k: (0.6, 0.15 * k, 0.6 + 0.12 * k))
    r = bmesh.ops.create_uvsphere(P.bm, u_segments=28, v_segments=16, radius=1.0)
    for v in r['verts']: v.co = V((v.co.x * 58, v.co.y * 18 - 80, v.co.z * 58))
    P.paint(list({f for v in r['verts'] for f in v.link_faces}), 'E_GLOW', lambda co, f: (0.62, 0.7, 1.0))
    reg('maw', P.obj("maw", col, subsurf=1))

def build_core(col):
    P = Part()
    res = bmesh.ops.create_icosphere(P.bm, subdivisions=2, radius=30)
    vs = res['verts']
    for v in vs: v.co *= 1 + 0.12 * fbm(v.co * 0.08, 2)
    P.paint(list({f for v in vs for f in v.link_faces}), 'E_GLOW', lambda co, f: (0.62, 0.35, 1.0))
    for i in range(8):     # claws in game XY plane (blender XZ)
        a = i / 8 * TAU
        d = V((math.cos(a), 0, math.sin(a)))
        b = d * 24
        horn(P, b, d, 34, 8, V((0, 10, 0)) + V((-math.sin(a), 0, math.cos(a))) * 6, 8, 8, 'E_DARK', 0.5)
    for sgn in (-1, 1):
        tube(P, [V((0, sgn * 26, 0)), V((0, sgn * 40, 0))], [12, 0.5], 10, 'E_DARK', lambda co, f: (0.5, 0.2, 0.0), cap0=True, cap1=True)
    reg('core', P.obj("core", col, subsurf=0, smooth=False))

def build_orb(col):
    P = Part()
    lumpy_sphere(P, V((0, 0, 0)), 9.5, 3, 0.08, 2.0, 'E_GLOW', glowfn=lambda d: 0.85 + 0.15 * cracks(d, 3.0, 0.1), seed=4.0)
    for i in range(6):
        a = i / 6 * TAU
        d = V((math.cos(a) * 0.6, -0.8, math.sin(a) * 0.6)).normalized()
        horn(P, d * 8, d, 9, 2.2, V((0, -2, 0)), 6, 5, 'E_DARK', 0.7)
    reg('orb', P.obj("orb", col, subsurf=1))

# ================================================================== PICKUPS / GATES
def build_gate(col):
    """ring gate r=70 in game XY plane (blender XZ), facing blender Y."""
    P = Part()
    R = 70.0
    rings = []
    for j in range(64):
        a = j / 64 * TAU
        c = V((math.cos(a) * R, 0, math.sin(a) * R)); rad = V((math.cos(a), 0, math.sin(a)))
        rings.append([c + rad * (math.cos(k / 8 * TAU) * 4.8) + V((0, 1, 0)) * (math.sin(k / 8 * TAU) * 3.4) for k in range(8)])
    rings.append(rings[0])
    f = P.grid(rings, True)
    P.paint(f, 'GATE', lambda co, fc: (0.62, 0.15, 0.85))
    for sgn in (-1, 1):   # thin inner/outer filigree rings
        rr = R + sgn * 9
        ring2 = []
        for j in range(65):
            a = j / 64 * TAU
            c = V((math.cos(a) * rr, sgn * 1.5, math.sin(a) * rr)); rad = V((math.cos(a), 0, math.sin(a)))
            ring2.append([c + rad * (math.cos(k / 6 * TAU) * 1.3) + V((0, 1, 0)) * (math.sin(k / 6 * TAU) * 1.3) for k in range(6)])
        f = P.grid(ring2, True)
        P.paint(f, 'GATE', lambda co, fc: (0.62, 0.6, 1.0))
    for i in range(8):    # crystal fins
        a = i / 8 * TAU
        d = V((math.cos(a), 0, math.sin(a)))
        b = d * (R + 5)
        horn(P, b, d, 18 if i % 2 == 0 else 11, 3.2, V((0, 0, 0)), 6, 4, 'GATE', 1.0)
        horn(P, b, -d, 8, 2.2, V((0, 0, 0)), 6, 3, 'GATE', 1.0)
    reg('gate', P.obj("gate", col, subsurf=0))

def build_feather_pickup(col):
    P = Part()
    M = frame(V((0, 0, -4)), V((0, 0, 1)), V((0, -1, 0)))
    feather(P, M, 40, 8.5, 'FEATHER', nu=16, nv=5, camber=0.08, curl=0.05, twist=0.4, shade=0.66, tipglow=0.9, baseglow=0.55, lead=0.6, notch=0.25)
    tube(P, [V((0, 0, -10)), V((0, 0, -4)), V((0, 0.3, 30)), V((0, 1.2, 37))], [0.35, 0.9, 0.6, 0.1], 8, 'FEATHER', lambda co, f: (0.7, 1.0, 0.95))
    reg('feather', P.obj("feather_pk", col, subsurf=1))

# ================================================================== ARCHITECTURE (STONE / GOLD / ACCENT)
def column(P, base, h, r, flutes=16, cap=True, broken=0.0, seed=0.0):
    """fluted column standing on base (blender z up)"""
    rings = []
    nz = 12
    top = h * (1 - broken)
    for k in range(nz + 1):
        z = top * k / nz
        ring = []
        for j in range(flutes * 2):
            a = j / (flutes * 2) * TAU
            rr = r * (1 - 0.06 * (j % 2)) * (1 - 0.1 * z / h)
            if broken and k == nz: rr *= 1 + 0.15 * noise.noise(V((a * 2, seed, 0)))
            ring.append(base + V((math.cos(a) * rr, math.sin(a) * rr, z + (broken * h * 0.25 * noise.noise(V((a * 1.3, seed, 3))) if (broken and k == nz) else 0))))
        rings.append(ring)
    f = P.grid(rings, True, None, base + V((0, 0, top)))
    P.paint(f, 'STONE', lambda co, fc: (0.62, 0.15 + 0.4 * sstep(0.3, 1, noise.noise(co * 0.08) * 0.5 + 0.5), 0.0))
    # base plinth
    tube(P, [base + V((0, 0, -2)), base + V((0, 0, h * 0.06))], [r * 1.45, r * 1.3], 20, 'STONE', lambda co, f: (0.58, 0.3, 0.0))
    if cap and not broken:
        tube(P, [base + V((0, 0, h * 0.94)), base + V((0, 0, h * 1.02))], [r * 1.05, r * 1.5], 20, 'STONE', lambda co, f: (0.6, 0.2, 0.0))
        tube(P, [base + V((0, 0, h * 1.0)), base + V((0, 0, h * 1.04))], [r * 1.5, r * 1.5], 20, 'GOLD', lambda co, f: (0.62, 0.0, 0.1))

def build_beacon(col):
    """beacon tower, origin at island top (game units)."""
    P = Part()
    # two-tier platform with bevelled rim and carved band
    tube(P, [V((0, 0, -22)), V((0, 0, -10)), V((0, 0, -4))], [262, 282, 280], 96, 'STONE', lambda co, f: (0.55, 0.45, 0.0), cap0=True, cap1=False)
    rings = [ellipse_ring(V((0, 0, z)), V((1, 0, 0)), V((0, 1, 0)), r, r, 96) for z, r in [(-4, 280), (2, 276), (4, 270), (4, 242), (10, 240), (14, 232)]]
    f = P.grid(rings, True, None, V((0, 0, 14)))
    P.paint(f, 'STONE', lambda co, fc: (0.62, 0.12 + 0.3 * sstep(0.2, 1.0, noise.noise(co * 0.03) * 0.5 + 0.5), 0.0))
    tube(P, [V((0, 0, 1.0)), V((0, 0, 2.5))], [277.5, 277.5], 96, 'GOLD', lambda co, f: (0.62, 0.0, 0.15), cap0=False, cap1=False)
    # inlaid glowing sun-glyph on the floor
    for i in range(12):
        a = i / 12 * TAU
        p0 = V((math.cos(a) * 80, math.sin(a) * 80, 14.5)); p1 = V((math.cos(a) * 190, math.sin(a) * 190, 14.5))
        tube(P, [p0, p1], [3.0, 1.0], 6, 'ACCENT', lambda co, f: (0.62, 0.3, 0.7))
    tube(P, [V((0, 0, 14)), V((0, 0, 15.2))], [130, 130], 64, 'ACCENT', lambda co, f: (0.62, 0.2, 0.55), cap0=False, cap1=False)
    # colonnade
    for i in range(12):
        a = i / 12 * TAU
        b = V((math.cos(a) * 205, math.sin(a) * 205, 14))
        column(P, b, 118, 12.5)
        tube(P, [b + V((0, 0, 122)), b + V((0, 0, 132))], [20, 18], 4, 'STONE', lambda co, f: (0.58, 0.35, 0.0))
        r = bmesh.ops.create_icosphere(P.bm, subdivisions=2, radius=6.5)
        bmesh.ops.translate(P.bm, verts=r['verts'], vec=b + V((0, 0, 140)))
        P.paint(list({f for v in r['verts'] for f in v.link_faces}), 'ACCENT', lambda co, f: (0.62, 0.5, 0.95))
    # architrave ring linking the columns
    rings = [ellipse_ring(V((0, 0, z)), V((1, 0, 0)), V((0, 1, 0)), r, r, 96) for z, r in [(132, 196), (132, 216), (138, 216), (138, 194)]]
    f = P.grid(rings + [rings[0]], True)
    P.paint(f, 'STONE', lambda co, fc: (0.6, 0.25, 0.0))
    # spiral stair
    for i in range(26):
        a = i / 26 * TAU * 1.0
        c = V((math.cos(a) * 112, math.sin(a) * 112, 16 + i * 9.6))
        r = bmesh.ops.create_cube(P.bm, size=1.0)
        M = Matrix.Translation(c) @ Matrix.Rotation(a, 4, 'Z') @ Matrix.Diagonal((22, 42, 6, 1))
        bmesh.ops.transform(P.bm, matrix=M, verts=r['verts'])
        P.paint(list({f for v in r['verts'] for f in v.link_faces}), 'STONE', lambda co, f: (0.55, 0.4, 0.0))
    # central spire: tapered, with gold bands and glowing rune grooves
    rings = []
    for k in range(25):
        z = 14 + k * 10.8
        rr = lerp(70, 50, k / 24)
        ring = []
        for j in range(48):
            a = j / 48 * TAU
            groove = 0.97 if (j % 6 == 0) else 1.0
            ring.append(V((math.cos(a) * rr * groove, math.sin(a) * rr * groove, z)))
        rings.append(ring)
    f = P.grid(rings, True)
    def spc(co, fc):
        a = math.atan2(co.y, co.x) / TAU * 48
        g = 1.0 - min(1.0, abs(a - round(a / 6) * 6) / 0.6)
        return (0.62, 0.1, 0.45 * g * sstep(30, 250, co.z))
    P.paint(f, 'STONE', spc)
    for z in (60, 120, 180, 240):
        rr = lerp(70, 50, (z - 14) / 260)
        tube(P, [V((0, 0, z - 3)), V((0, 0, z + 3))], [rr + 3, rr + 3], 48, 'GOLD', lambda co, f: (0.62, 0.1, 0.1), cap0=False, cap1=False)
    # crown / brazier
    tube(P, [V((0, 0, 272)), V((0, 0, 292)), V((0, 0, 312)), V((0, 0, 318))], [52, 70, 92, 88], 48, 'STONE', lambda co, f: (0.6, 0.3, 0.0), cap0=True, cap1=False)
    tube(P, [V((0, 0, 318)), V((0, 0, 310)), V((0, 0, 302))], [88, 74, 40], 48, 'ACCENT', lambda co, f: (0.62, 0.4, 0.9), cap0=False, cap1=True)
    tube(P, [V((0, 0, 312)), V((0, 0, 320))], [93, 93], 48, 'GOLD', lambda co, f: (0.62, 0.0, 0.2), cap0=False, cap1=False)
    for i in range(6):
        a = i / 6 * TAU
        horn(P, V((math.cos(a) * 84, math.sin(a) * 84, 316)), V((math.cos(a) * 0.25, math.sin(a) * 0.25, 1)).normalized(), 72, 7, V((-math.cos(a) * 8, -math.sin(a) * 8, 0)), 8, 8, 'GOLD', 0.6)
    reg('beacon', P.obj("beacon", col, subsurf=0))

def build_shrine(col):
    P = Part()
    tube(P, [V((0, 0, -8)), V((0, 0, 0)), V((0, 0, 4))], [50, 54, 50], 40, 'STONE', lambda co, f: (0.55, 0.4, 0.0), cap0=True, cap1=True)
    tube(P, [V((0, 0, 4)), V((0, 0, 9))], [40, 38], 40, 'STONE', lambda co, f: (0.6, 0.25, 0.0), cap0=False, cap1=True)
    column(P, V((0, 0, 9)), 40, 11, 12, cap=False)
    tube(P, [V((0, 0, 46)), V((0, 0, 52)), V((0, 0, 60))], [14, 26, 28], 32, 'STONE', lambda co, f: (0.6, 0.2, 0.0), cap0=True, cap1=False)
    tube(P, [V((0, 0, 60)), V((0, 0, 55))], [28, 15], 32, 'ACCENT', lambda co, f: (0.62, 0.3, 0.8), cap0=False, cap1=True)
    tube(P, [V((0, 0, 57)), V((0, 0, 61))], [29, 29], 32, 'GOLD', lambda co, f: (0.62, 0.0, 0.15), cap0=False, cap1=False)
    for i in range(4):
        a = i / 4 * TAU + 0.4
        b = V((math.cos(a) * 36, math.sin(a) * 36, 4))
        tube(P, [b, b + V((0, 0, 26)), b + V((math.cos(a) * -3, math.sin(a) * -3, 34))], [3.6, 2.6, 0.4], 8, 'GOLD', lambda co, f, b=b: (0.62, 0.0, 0.7 * sstep(22, 34, co.z - b.z + 4)))
    reg('shrine', P.obj("shrine", col, subsurf=1))

def build_ruin(col):
    P = Part()
    rnd = random.Random(5)
    tube(P, [V((0, 0, -6)), V((0, 0, 0)), V((0, 0, 2))], [70, 74, 72], 48, 'STONE', lambda co, f: (0.5, 0.55 + 0.3 * noise.noise(co * 0.05), 0.0), cap0=True, cap1=True)
    for i in range(5):
        a = i / 5 * TAU + 0.3
        b = V((math.cos(a) * 58, math.sin(a) * 58, 2))
        h = rnd.uniform(55, 110)
        column(P, b, h, 9.5, 12, cap=(i % 2 == 0), broken=(0 if i % 2 == 0 else rnd.uniform(0.2, 0.55)), seed=i)
    # fallen drum lying on the ground
    tube(P, [V((10, -30, 10)), V((40, -10, 10))], [9, 9], 24, 'STONE', lambda co, f: (0.55, 0.4, 0.0))
    # lintel across two standing columns
    r = bmesh.ops.create_cube(P.bm, size=1.0)
    a0 = 0.3; a1 = 0.3 + 2 * TAU / 5
    p0 = V((math.cos(a0) * 58, math.sin(a0) * 58, 0)); p1 = V((math.cos(a1) * 58, math.sin(a1) * 58, 0))
    c = (p0 + p1) / 2; d = p1 - p0
    M = Matrix.Translation(V((c.x, c.y, 2 + 110 + 6))) @ Matrix.Rotation(math.atan2(d.y, d.x), 4, 'Z') @ Matrix.Diagonal((d.length * 0.62, 18, 10, 1))
    bmesh.ops.transform(P.bm, matrix=M, verts=r['verts'])
    P.paint(list({f for v in r['verts'] for f in v.link_faces}), 'STONE', lambda co, f: (0.58, 0.3, 0.0))
    tube(P, [V((0, 0, 2)), V((0, 0, 3.5))], [16, 16], 24, 'ACCENT', lambda co, f: (0.62, 0.3, 0.7), cap0=False, cap1=True)
    reg('ruin', P.obj("ruin", col, subsurf=0))

# ================================================================== FLORA (static part "_s", swaying part "_f")
def blob(P, c, r, role, seed, amp=0.22, sub=3, sq=(1, 1, 0.85), fn=None):
    res = bmesh.ops.create_icosphere(P.bm, subdivisions=sub, radius=1.0)
    vs = res['verts']
    for v in vs:
        d = v.co.normalized()
        k = 1 + amp * fbm(d * 2.2 + V((seed, seed, seed)), 3) + 0.06 * noise.noise(d * 9 + V((seed, 0, 0)))
        v.co = c + V((d.x * sq[0], d.y * sq[1], d.z * sq[2])) * r * k
    fs = list({f for v in vs for f in v.link_faces})
    P.paint(fs, role, fn or (lambda co, f: (0.5 + 0.18 * clamp((co.z - c.z) / r + 0.5), clamp(0.5 + 1.4 * noise.noise(co * 0.06 + V((seed, 0, 0)))) * 0.35, 0.0)))
    return fs

def trunk(P, base, h, r, seed, lean=V((0, 0, 0)), n=12, roots=True):
    path = [base + V((0, 0, h * k / 8)) + lean * (k / 8) ** 2 + V((math.sin(k * 1.3 + seed) * r * 0.25, math.cos(k * 1.1 + seed) * r * 0.25, 0)) for k in range(9)]
    radii = [r * (1.5 if k == 0 else 1.0) * (1 - 0.55 * k / 8) for k in range(9)]
    tube(P, path, radii, n, 'TRUNK', lambda co, f: (0.55 + 0.1 * noise.noise(co * 0.4), clamp(0.3 + noise.noise(V((co.x * 0.2, co.y * 0.2, co.z * 1.5)))), 0.0),
         jit=lambda a, i: 0.12 * math.sin(a * 7 + i))
    if roots:
        for k in range(4):
            a = k / 4 * TAU + seed
            d = V((math.cos(a), math.sin(a), 0))
            path2 = curve(base + V((0, 0, h * 0.12)), base + d * r * 3.2 + V((0, 0, -r * 0.6)), d * r * 0.3 + V((0, 0, r * 0.5)), 6)
            tube(P, path2, [r * 0.55 * (1 - i / 7) + 0.3 for i in range(7)], 7, 'TRUNK', lambda co, f: (0.5, 0.4, 0.0))
    return path

def build_trees(col):
    rnd = random.Random(3)
    # --- round tree (lush)
    S = Part(); F = Part()
    p = trunk(S, V((0, 0, 0)), 62, 6.5, 0.3)
    for k in range(3):
        a = k / 3 * TAU + 0.5
        b0 = p[4 + k]; d = V((math.cos(a), math.sin(a), 0.9)).normalized()
        tube(S, curve(b0, b0 + d * 26, V((0, 0, 4)), 6), [lerp(3.2, 0.8, i / 6) for i in range(7)], 8, 'TRUNK', lambda co, f: (0.52, 0.3, 0.0))
    for k, (x, y, z, r) in enumerate([(0, 0, 84, 31), (-18, 8, 70, 23), (17, -7, 72, 24), (4, 18, 74, 22), (-5, -17, 76, 22), (2, 2, 102, 21)]):
        blob(F, V((x, y, z)), r, 'LEAF', k * 3.1, amp=0.25, sub=3)
    reg('tree_round_s', S.obj("tree_round_s", col, subsurf=0)); reg('tree_round_f', F.obj("tree_round_f", col, subsurf=0))
    # --- crystal cluster
    S = Part()
    for k in range(7):
        a = rnd.uniform(0, TAU); tilt = rnd.uniform(0.05, 0.45) if k else 0.0
        h = rnd.uniform(50, 120) if k else 140; r = rnd.uniform(8, 15) if k else 16
        d = V((math.cos(a) * math.sin(tilt), math.sin(a) * math.sin(tilt), math.cos(tilt)))
        base = V((math.cos(a) * 7 * (k > 0), math.sin(a) * 7 * (k > 0), -6))
        ax = d.cross(V((0, 0, 1)) if abs(d.z) < 0.99 else V((1, 0, 0))).normalized(); ay = d.cross(ax)
        rings = [ellipse_ring(base + d * z, ax, ay, r * s, r * s, 6) for z, s in [(0, 1.0), (h * 0.75, 0.92), (h * 0.8, 0.9)]]
        f = S.grid(rings, True, base - d * 2, base + d * h)
        role = 'LEAF' if k % 2 == 0 else 'ACCENT'
        S.paint(f, role, lambda co, fc, base=base, h=h: (0.62, 0.2 + 0.5 * sstep(0, h, (co - base).length), 0.12 + 0.35 * sstep(0.3 * h, h, (co - base).length)))
    blob(S, V((0, 0, -4)), 22, 'ROCK', 9.0, amp=0.35, sub=2, sq=(1.2, 1.1, 0.45), fn=lambda co, f: (0.55, 0.6, 0.0))
    reg('tree_crystal_s', S.obj("tree_crystal_s", col, subsurf=0, smooth=False))
    # --- dead tree (gnarled)
    S = Part()
    p = trunk(S, V((0, 0, 0)), 80, 5.5, 1.7, lean=V((6, 3, 0)), n=10)
    def branch(b0, d, L, r, depth):
        end = b0 + d * L
        path = curve(b0, end, V((rnd.uniform(-1, 1), rnd.uniform(-1, 1), rnd.uniform(-0.3, 0.6))) * L * 0.25, 6)
        tube(S, path, [lerp(r, r * 0.25, i / 6) + 0.15 for i in range(7)], 7, 'TRUNK', lambda co, f: (0.5, 0.5, 0.0))
        if depth > 0:
            for k in range(2):
                a = rnd.uniform(0, TAU)
                nd = (d + V((math.cos(a), math.sin(a), rnd.uniform(0, 0.6))) * 0.8).normalized()
                branch(path[4], nd, L * 0.6, r * 0.55, depth - 1)
    for k in range(4):
        a = k / 4 * TAU + 0.6
        branch(p[3 + k], V((math.cos(a), math.sin(a), 0.7)).normalized(), 34 - k * 4, 3.0, 1)
    for k in range(3):
        a = rnd.uniform(0, TAU)
        blob(S, p[5] + V((math.cos(a) * 18, math.sin(a) * 18, 8 + k * 6)), 2.6, 'LEAF', k, amp=0.1, sub=2, sq=(1, 1, 1.3), fn=lambda co, f: (0.62, 1.0, 1.0))
    reg('tree_dead_s', S.obj("tree_dead_s", col, subsurf=0))
    # --- burning tree (ash world): charred trunk, ember canopy
    S = Part(); F = Part()
    p = trunk(S, V((0, 0, 0)), 70, 7, 2.2)
    for k in range(4):
        z = 38 + k * 18; r = 34 - k * 8
        rings = []
        for m_ in range(5):
            t = m_ / 4
            rr = lerp(r, 3, t ** 0.8); zz = z + t * 34
            rings.append(ellipse_ring(V((0, 0, zz)), V((1, 0, 0)), V((0, 1, 0)), rr, rr, 28, lambda a, t=t, k=k: 0.22 * math.sin(a * 9 + k) * (1 - t)))
        f = F.grid(rings, True, V((0, 0, z - 4)), V((0, 0, z + 38)))
        F.paint(f, 'LEAF', lambda co, fc, z=z: (0.6, clamp((co.z - z) / 34), 0.5 + 0.4 * clamp((co.z - z) / 34)))
    reg('tree_burning_s', S.obj("tree_burning_s", col, subsurf=0)); reg('tree_burning_f', F.obj("tree_burning_f", col, subsurf=1))
    # --- void shards
    S = Part()
    for k in range(5):
        a = k / 5 * TAU + rnd.uniform(-0.3, 0.3); tilt = rnd.uniform(0.0, 0.35)
        h = rnd.uniform(60, 140); r = rnd.uniform(7, 12)
        d = V((math.cos(a) * math.sin(tilt), math.sin(a) * math.sin(tilt), math.cos(tilt)))
        base = V((math.cos(a) * 10, math.sin(a) * 10, -8))
        ax = d.cross(V((0, 0, 1)) if abs(d.z) < 0.99 else V((1, 0, 0))).normalized(); ay = d.cross(ax)
        rings = [ellipse_ring(base + d * (h * t), ax, ay, r * (1 - t) ** 0.7 + 0.2, r * 0.6 * (1 - t) ** 0.7 + 0.2, 5, lambda a_, t=t: 0.25 * math.sin(a_ * 3 + t * 5)) for t in [0, 0.3, 0.6, 0.85, 1.0]]
        f = S.grid(rings, True, base - d * 2, None)
        S.paint(f, 'ROCK', lambda co, fc, base=base: (0.4, 1.0, 0.0))
        tube(S, [base + d * h * 0.1 + ax * r * 0.5, base + d * h * 0.7 + ax * r * 0.25], [1.2, 0.5], 5, 'LEAF', lambda co, f: (0.62, 0.4, 0.95))
    reg('tree_void_s', S.obj("tree_void_s", col, subsurf=0, smooth=False))
    # --- boulders
    for k in range(2):
        S = Part()
        blob(S, V((0, 0, 0)), 10, 'ROCK', 20 + k * 7, amp=0.35, sub=3, sq=(1.25, 1.0, 0.8), fn=lambda co, f: (0.55 + 0.1 * co.z / 10, clamp(0.4 + noise.noise(co * 0.3)), 0.0))
        reg('rock%d' % k, S.obj("rock%d" % k, col, subsurf=0))
    # --- grass tuft + flower (swaying)
    F = Part()
    for k in range(9):
        a = k / 9 * TAU + rnd.uniform(-0.3, 0.3)
        b = V((math.cos(a) * 2.5, math.sin(a) * 2.5, 0))
        tip = b + V((math.cos(a) * 3, math.sin(a) * 3, rnd.uniform(9, 14)))
        path = curve(b, tip, V((math.cos(a) * 1.5, math.sin(a) * 1.5, 0)), 4)
        rings = []
        for i, pp in enumerate(path):
            w = lerp(0.9, 0.05, i / 4)
            rings.append([pp + V((-math.sin(a) * w, math.cos(a) * w, 0)), pp + V((math.sin(a) * w, -math.cos(a) * w, 0))])
        f = F.grid(rings, False)
        F.paint(f, 'GRASS', lambda co, fc: (0.5 + 0.03 * co.z, 0.8, 0.0))
    stem = curve(V((0, 0, 0)), V((1, 0, 13)), V((0.6, 0, 0)), 4)
    tube(F, stem, [0.35] * 5, 5, 'GRASS', lambda co, f: (0.5, 0.9, 0.0))
    for k in range(6):
        a = k / 6 * TAU
        M = frame(V((1, 0, 13)), V((math.cos(a), math.sin(a), 0.35)), V((0, 0, 1)))
        feather(F, M, 3.2, 1.6, 'FLOWER', nu=4, nv=2, camber=0.3, curl=0.1, shade=0.62, tipglow=0.3, baseglow=0.25, lead=1.0)
    blob(F, V((1, 0, 13.4)), 1.0, 'ACCENT', 3, amp=0.05, sub=2, fn=lambda co, f: (0.62, 0.3, 0.8))
    reg('tuft', F.obj("tuft", col, subsurf=0))

# ================================================================== ISLANDS (normalised: top radius 100 at z=0, depth 100)
def build_island(col, k, seed, crystals=True):
    P = Part()
    rnd = random.Random(seed)
    SEG, RT = 84, 16
    sd = V((seed * 1.7, seed * 0.3, seed * 2.1))
    edge = [100 * (1 + 0.075 * fbm(V((math.cos(a) * 1.6, math.sin(a) * 1.6, 0)) + sd, 3) + 0.03 * math.sin(a * 5 + seed)) for a in [j / SEG * TAU for j in range(SEG)]]
    # top cap
    rings = []
    for i in range(1, RT + 1):
        t = i / RT
        ring = []
        for j in range(SEG):
            a = j / SEG * TAU
            rr = edge[j] * t
            x, y = math.cos(a) * rr, math.sin(a) * rr
            z = 1.1 * fbm(V((x * 0.035, y * 0.035, 0)) + sd, 3) - 4.5 * sstep(0.86, 1.0, t) ** 1.6
            ring.append(V((x, y, z)))
        rings.append(ring)
    f = P.grid(rings, True, V((0, 0, 1.1 * fbm(sd, 3))), None)
    P.paint(f, 'GRASS', lambda co, fc: (0.58 + 0.06 * fbm(co * 0.08 + sd, 2) - 0.08 * sstep(85, 100, co.xy.length), clamp(0.5 + 1.6 * fbm(co * 0.025 + sd, 3)), 0.0))
    # grass skirt draping over the edge
    sk = [rings[-1]]
    for d, kk in ((2.5, 1.0), (6.0, 0.985)):
        sk.append([V((p.x * kk, p.y * kk, p.z - d - 3.5 * max(0, noise.noise(V((j * 0.45, seed, d))) ))) for j, p in enumerate(rings[-1])])
    f = P.grid(sk, True)
    P.paint(f, 'GRASS', lambda co, fc: (0.47, 0.25, 0.0))
    # cliffs / underside: strata, jag, tapering to a tip
    NZ = 30
    rings = [[V((p.x * 0.975, p.y * 0.975, p.z - 3.0)) for p in rings[-1]]]
    for i in range(1, NZ + 1):
        t = i / NZ
        ring = []
        for j in range(SEG):
            a = j / SEG * TAU
            d = V((math.cos(a), math.sin(a), 0))
            jag = 1 + 0.22 * fbm(V((math.cos(a) * 2.2, math.sin(a) * 2.2, t * 3.0)) + sd, 4) + 0.06 * math.sin(t * 40 + a * 3) * (t > 0.1)
            strata = 0.035 * math.sin(t * 55 + 2 * fbm(d * 2 + sd, 2))
            rr = edge[j] * 0.975 * ((1 - t) ** 1.25) * (jag + strata) + 0.8
            z = -3 - 97 * t ** 0.95 + 5 * fbm(V((math.cos(a) * 3, math.sin(a) * 3, t)) + sd, 2) * (t > 0.05)
            ring.append(V((d.x * rr, d.y * rr, z)))
        rings.append(ring)
    f = P.grid(rings, True, None, V((0, 0, -104)))
    P.paint(f, 'ROCK', lambda co, fc: (0.56 * (0.86 + 0.14 * math.sin(co.z * 0.9 + 2 * fbm(co * 0.05 + sd, 2))) * (0.75 + 0.25 * sstep(-100, -5, co.z)),
                                       clamp(sstep(-5, -80, co.z) * 0.8 + 0.25 * fbm(co * 0.06 + sd, 2)), 0.0))
    # hanging stalactites
    for m_ in range(9):
        a = rnd.uniform(0, TAU); rr = rnd.uniform(25, 75)
        t0 = 1 - (rr / 100) ** (1 / 1.25)
        z0 = -3 - 97 * t0 ** 0.95 + 4
        b = V((math.cos(a) * rr * 0.92, math.sin(a) * rr * 0.92, z0))
        L = rnd.uniform(14, 38)
        rings = [ellipse_ring(b + V((0, 0, -L * s)), V((1, 0, 0)), V((0, 1, 0)), rnd.uniform(6, 11) * (1 - s) ** 1.2 + 0.3, rnd.uniform(5, 10) * (1 - s) ** 1.2 + 0.3, 9,
                              lambda a_, s=s, m_=m_: 0.25 * noise.noise(V((a_ * 2, s * 3, m_)))) for s in [0, 0.25, 0.5, 0.75, 0.95]]
        f2 = P.grid(rings, True, b + V((0, 0, 3)), b + V((0, 0, -L)))
        P.paint(f2, 'ROCK', lambda co, fc: (0.42, 0.85, 0.0))
    # hanging roots from the rim
    for m_ in range(7):
        a = rnd.uniform(0, TAU)
        b = V((math.cos(a) * 96, math.sin(a) * 96, -4))
        path = curve(b, b + V((math.cos(a) * 4, math.sin(a) * 4, -rnd.uniform(22, 48))), V((math.cos(a) * 6, math.sin(a) * 6, 4)), 7)
        tube(P, path, [lerp(1.4, 0.2, i / 7) for i in range(8)], 6, 'TRUNK', lambda co, f: (0.5, 0.4, 0.0))
    # glowing crystal veins in the underside
    if crystals:
        for m_ in range(5):
            a = rnd.uniform(0, TAU); rr = rnd.uniform(30, 55)
            t0 = 1 - (rr / 100) ** (1 / 1.25)
            base = V((math.cos(a) * rr * 0.9, math.sin(a) * rr * 0.9, -3 - 97 * t0 ** 0.95))
            for q in range(3):
                d = V((math.cos(a) * 0.5 + rnd.uniform(-0.3, 0.3), math.sin(a) * 0.5 + rnd.uniform(-0.3, 0.3), -1)).normalized()
                ax = d.cross(V((0, 0, 1))).normalized(); ay = d.cross(ax)
                h = rnd.uniform(8, 18); r = rnd.uniform(1.8, 3.2)
                rr2 = [ellipse_ring(base + d * (h * s), ax, ay, r * (1 - s * 0.15), r * (1 - s * 0.15), 6) for s in (0, 0.8)]
                f3 = P.grid(rr2, True, None, base + d * h * 1.25)
                P.paint(f3, 'ACCENT', lambda co, fc: (0.62, 0.3, 0.85))
    reg('island%d' % k, P.obj("island%d" % k, col, subsurf=0))

# ================================================================== preview rendering
def setup_render(w, h, samples=32):
    sc = bpy.context.scene
    for eng in ('BLENDER_EEVEE', 'BLENDER_EEVEE_NEXT'):
        try: sc.render.engine = eng; break
        except Exception: continue
    sc.render.resolution_x = w; sc.render.resolution_y = h; sc.render.resolution_percentage = 100
    sc.render.film_transparent = False
    sc.render.image_settings.file_format = 'PNG'
    try: sc.eevee.taa_render_samples = samples
    except Exception: pass
    for attr, val in (('use_shadows', True), ('use_gtao', True)):
        try: setattr(sc.eevee, attr, val)
        except Exception: pass
    try:
        sc.view_settings.view_transform = 'AgX'
    except Exception:
        try: sc.view_settings.view_transform = 'Filmic'
        except Exception: pass
    if sc.world is None: sc.world = bpy.data.worlds.new("World")
    w_ = sc.world
    try: w_.use_nodes = True
    except Exception: pass
    bg = next((n for n in w_.node_tree.nodes if n.type == 'BACKGROUND'), None)
    if bg is None:
        bg = w_.node_tree.nodes.new('ShaderNodeBackground')
        out = next((n for n in w_.node_tree.nodes if n.type == 'OUTPUT_WORLD'), None) or w_.node_tree.nodes.new('ShaderNodeOutputWorld')
        w_.node_tree.links.new(bg.outputs[0], out.inputs[0])
    bg.inputs[0].default_value = (0.32, 0.38, 0.5, 1); bg.inputs[1].default_value = 0.8

def add_sun(col, rot, energy=3.5, color=(1, 0.93, 0.82)):
    ld = bpy.data.lights.new("sun", 'SUN'); ld.energy = energy; ld.color = color
    try: ld.angle = 0.05
    except Exception: pass
    ob = bpy.data.objects.new("sun", ld); col.objects.link(ob); ob.rotation_euler = rot
    return ob

def add_cam(col, loc, target, lens=50, ortho=None):
    cd = bpy.data.cameras.new("cam"); cd.lens = lens
    cd.clip_start = 0.5; cd.clip_end = 20000
    if ortho: cd.type = 'ORTHO'; cd.ortho_scale = ortho
    ob = bpy.data.objects.new("cam", cd); col.objects.link(ob); ob.location = loc
    ob.rotation_euler = (V(target) - V(loc)).to_track_quat('-Z', 'Y').to_euler()
    bpy.context.scene.camera = ob
    return ob

def place(col, name, M):
    """instance an exported model (all its parts) with matrix M (blender space)"""
    out = []
    for ob, extra in EXPORT.get(name, []):
        o2 = bpy.data.objects.new(ob.name + "_v", ob.data)
        for md in ob.modifiers:
            m2 = o2.modifiers.new(md.name, md.type)
            for at in ('levels', 'render_levels', 'thickness', 'offset'):
                if hasattr(md, at):
                    try: setattr(m2, at, getattr(md, at))
                    except Exception: pass
        col.objects.link(o2)
        o2.matrix_world = M @ (extra if extra is not None else Matrix.Identity(4)) @ ob.matrix_world
        out.append(o2)
    return out

def render_to(path):
    bpy.context.scene.render.filepath = path
    bpy.ops.render.render(write_still=True)
    log("rendered", path)

def mirrorX(): return Matrix.Diagonal((-1, 1, 1, 1))

def place_phoenix(col, M, spread=0.15):
    place(col, 'phoenix_body', M)
    place(col, 'phoenix_tail', M @ Matrix.Translation(V((0, -6.5, 0.6))) @ Matrix.Rotation(0.12, 4, 'X'))
    for s in (1, -1):
        Mi = M @ Matrix.Translation(V((s * 2.8, 1.2, 0.9))) @ Matrix.Rotation(-s * 0.25, 4, 'Y') @ Matrix.Rotation(s * -0.05, 4, 'Z') @ (mirrorX() if s < 0 else Matrix.Identity(4))
        Mo = M @ Matrix.Translation(V((s * 2.8, 1.2, 0.9))) @ Matrix.Rotation(-s * 0.25, 4, 'Y') @ Matrix.Translation(V((s * 12 * math.cos(0.0), 0, 0))) @ Matrix.Rotation(s * 0.18, 4, 'Y') @ (mirrorX() if s < 0 else Matrix.Identity(4))
        place(col, 'phoenix_wing_in', Mi); place(col, 'phoenix_wing_out', Mo)

def stage_renders():
    rc = get_col("EW_VIEW"); clear_col("EW_VIEW"); hide_others({"EW_VIEW"})
    # 1) phoenix hero
    place_phoenix(rc, Matrix.Identity(4))
    add_sun(rc, (math.radians(50), 0, math.radians(30)))
    setup_render(1400, 900)
    add_cam(rc, (34, 30, 22), (0, -1, 1), lens=55)
    render_to(os.path.join(OUT, "phoenix.png"))
    clear_col("EW_VIEW")
    place_phoenix(rc, Matrix.Identity(4))
    add_sun(rc, (math.radians(50), 0, math.radians(200)))
    add_cam(rc, (0, -40, 34), (0, 0, 0), lens=50)
    render_to(os.path.join(OUT, "phoenix_top.png"))
    # 2) model sheet
    clear_col("EW_VIEW")
    names = ['drifter', 'lancer', 'leech', 'orb', 'core', 'maw', 'gate', 'feather', 'shrine', 'ruin', 'beacon',
             'tree_round', 'tree_crystal', 'tree_dead', 'tree_burning', 'tree_void', 'rock0', 'tuft']
    size = {'drifter': 50, 'lancer': 60, 'leech': 36, 'orb': 30, 'core': 110, 'maw': 700, 'gate': 170, 'feather': 55, 'shrine': 120, 'ruin': 160, 'beacon': 600,
            'tree_round': 130, 'tree_crystal': 160, 'tree_dead': 130, 'tree_burning': 130, 'tree_void': 150, 'rock0': 30, 'tuft': 20}
    for i, n in enumerate(names):
        cx = (i % 6) * 1.25; cy = -(i // 6) * 1.35
        s = 1.0 / size[n]
        M = Matrix.Translation(V((cx, cy, 0))) @ Matrix.Diagonal((s, s, s, 1))
        if n in ('maw', 'core', 'gate'): M = M @ Matrix.Rotation(-0.5, 4, 'Z')
        if n.startswith('tree'):
            place(rc, n + '_s', M); place(rc, n + '_f', M)
        else:
            place(rc, n, M)
    add_sun(rc, (math.radians(45), 0, math.radians(35)))
    setup_render(1800, 1150)
    add_cam(rc, (3.1 + 3.5, -1.35 - 6.5, 6.2), (3.1, -1.35, 0.15), ortho=8.2)
    render_to(os.path.join(OUT, "sheet.png"))
    # 3) diorama: two islands, beacon, trees, phoenix
    clear_col("EW_VIEW")
    S1 = 4.0
    place(rc, 'island0', Matrix.Diagonal((S1, S1, S1 * 1.3, 1)))
    place(rc, 'beacon', Matrix.Diagonal((0.62, 0.62, 0.62, 1)))
    rnd = random.Random(2)
    for k in range(9):
        a = rnd.uniform(0, TAU); r = rnd.uniform(220, 360)
        sc_ = rnd.uniform(0.8, 1.4)
        M = Matrix.Translation(V((math.cos(a) * r, math.sin(a) * r, -1))) @ Matrix.Rotation(rnd.uniform(0, 6), 4, 'Z') @ Matrix.Diagonal((sc_, sc_, sc_, 1))
        place(rc, 'tree_round_s', M); place(rc, 'tree_round_f', M)
    for k in range(25):
        a = rnd.uniform(0, TAU); r = rnd.uniform(180, 380)
        place(rc, 'tuft', Matrix.Translation(V((math.cos(a) * r, math.sin(a) * r, 0))) @ Matrix.Diagonal((1.6, 1.6, 1.6, 1)))
    place(rc, 'island1', Matrix.Translation(V((-700, 500, 120))) @ Matrix.Diagonal((2.2, 2.2, 3.0, 1)))
    place(rc, 'island2', Matrix.Translation(V((650, 650, -150))) @ Matrix.Diagonal((1.8, 1.8, 2.6, 1)))
    place(rc, 'gate', Matrix.Translation(V((-250, -350, 260))) @ Matrix.Rotation(0.4, 4, 'Z'))
    place_phoenix(rc, Matrix.Translation(V((80, -420, 210))) @ Matrix.Rotation(-0.3, 4, 'Z') @ Matrix.Diagonal((2.5, 2.5, 2.5, 1)))
    add_sun(rc, (math.radians(55), 0, math.radians(-30)), 4.0)
    setup_render(1600, 900)
    add_cam(rc, (150, -1250, 420), (0, 0, 90), lens=40)
    render_to(os.path.join(OUT, "diorama.png"))
    hide_others({"EW_MODELS", "EW_VIEW"})

# ================================================================== main
def stage_build():
    t0 = time.time()
    global MATS
    MATS = [make_mat(r) for r in ROLES]
    col = get_col("EW_MODELS"); clear_col("EW_MODELS"); hide_others({"EW_MODELS"})
    for o in ("Cube",):
        if bpy.data.objects.get(o): bpy.data.objects.remove(bpy.data.objects[o], do_unlink=True)
    EXPORT.clear()
    steps = [('phoenix', build_phoenix), ('drifter', build_drifter), ('lancer', build_lancer), ('leech', build_leech), ('maw', build_maw),
             ('core', build_core), ('orb', build_orb), ('gate', build_gate), ('feather', build_feather_pickup), ('beacon', build_beacon),
             ('shrine', build_shrine), ('ruin', build_ruin), ('trees', build_trees),
             ('island0', lambda c: build_island(c, 0, 11, True)), ('island1', lambda c: build_island(c, 1, 23, False)), ('island2', lambda c: build_island(c, 2, 37, True))]
    for nm, fn in steps:
        try:
            t = time.time(); fn(col); log("built", nm, round(time.time() - t, 2))
        except Exception:
            log("BUILD FAIL", nm, traceback.format_exc())
    write_bin(os.path.join(OUT, "ew_models.bin"))
    log("build time", round(time.time() - t0, 1))

try:
    if STAGE in ("all", "build"): stage_build()
    if STAGE in ("all", "render"): stage_renders()
    log("DONE")
except Exception:
    log("FATAL", traceback.format_exc())
finally:
    LOGF.close()
