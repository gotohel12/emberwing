# ARVEX: first-person arm from the MPFB human. Poses the right hand into a grip, cuts the arm, places it in the game's
# view-model frame (grip centre at the origin, handle along +Y, elbow toward the camera and down) and writes out/fp_arm.bin
import bpy, os, math, json, struct, mathutils
from mathutils import Vector, Quaternion
from mathutils.bvhtree import BVHTree
exec(open(os.path.join(os.path.dirname(ROOT), 'hand_lib.py'), encoding='utf-8').read())
def export_arm(pose, tag='fp_arm', levels=1, elbow_game=(0.068, -0.36, 0.46), max_wrist=42, preview=True):
    arm, body = objs(); set_pose(pose)
    sd = body.modifiers.get('ARVEX_Subdiv') or body.modifiers.new('ARVEX_Subdiv', 'SUBSURF'); sd.levels = levels; sd.render_levels = levels; sd.show_viewport = True
    bpy.context.view_layer.update(); dg = bpy.context.evaluated_depsgraph_get(); ev = body.evaluated_get(dg); me = ev.to_mesh()
    HANDG = ['wrist.R'] + ['metacarpal%d.R' % i for i in (1, 2, 3, 4)] + ['finger%d-%d.R' % (f, j) for f in range(1, 6) for j in (1, 2, 3)]
    ARMG = ['lowerarm01.R', 'lowerarm02.R', 'upperarm01.R', 'upperarm02.R']
    gi = {g.name: g.index for g in body.vertex_groups}; hs = {gi[n] for n in HANDG if n in gi}; as_ = {gi[n] for n in ARMG if n in gi}; nail = gi.get('fingernails', -1)
    n = len(me.vertices); wh = [0.0] * n; wa = [0.0] * n; wn = [0.0] * n
    for v in me.vertices:
        for g in v.groups:
            if g.group in hs: wh[v.index] += g.weight
            elif g.group in as_: wa[v.index] += g.weight
            elif g.group == nail: wn[v.index] = g.weight
    # grip frame from the posed finger bones
    cs = []
    for f in (2, 3, 4, 5):
        pts = [bone_pt('finger%d-%d.R' % (f, j)) for j in (1, 2, 3)] + [bone_pt('finger%d-3.R' % f, True)]; cs.append(sum(pts, Vector()) / 4)
    g = sum(cs, Vector()) / 4; a = (cs[0] - cs[3]).normalized(); E = bone_pt('lowerarm01.R'); W = bone_pt('wrist.R')
    Q1 = a.rotation_difference(Vector((0, 0, 1))); e1 = Q1 @ (E - g); tb = Vector((elbow_game[0], -elbow_game[2], elbow_game[1]))
    Q2 = Quaternion((0, 0, 1), math.atan2(tb.y, tb.x) - math.atan2(e1.y, e1.x)); M = Q2 @ Q1
    W2 = M @ (W - g); E2 = M @ (E - g); u = (E2 - W2).normalized(); v = (tb - W2).normalized(); Qa = u.rotation_difference(v)
    ang = math.degrees(Qa.angle); 
    if ang > max_wrist: Qa = Quaternion(Qa.axis, math.radians(max_wrist))
    print('grip', [round(x, 3) for x in g], 'axis/forearm angle', round(math.degrees(a.angle(E - W)), 1), 'wrist correction', round(ang, 1), 'wrist in frame', [round(x, 3) for x in W2])
    P = [None] * n; N = [None] * n
    for vtx in me.vertices:
        i = vtx.index
        if wh[i] + wa[i] < 0.5: continue
        p = M @ (vtx.co - g); nn = M @ vtx.normal; h = min(1.0, wh[i] / max(wh[i] + wa[i], 1e-6)); h = h * h * (3 - 2 * h)
        if h < 1: p = p * h + (W2 + Qa @ (p - W2)) * (1 - h); nn = (nn * h + (Qa @ nn) * (1 - h)).normalized()
        P[i] = p; N[i] = nn
    tris = []; slots = []
    for poly in me.polygons:
        vs = list(poly.vertices)
        if any(P[i] is None for i in vs): continue
        s = 'nail' if sum(wn[i] for i in vs) / len(vs) > 0.5 else 'skin'
        for k in range(1, len(vs) - 1): tris.append((vs[0], vs[k], vs[k + 1])); slots.append(s)
    used = sorted({i for t in tris for i in t}); remap = {i: k for k, i in enumerate(used)}
    bvh = BVHTree.FromPolygons([P[i] for i in used], [tuple(remap[i] for i in t) for t in tris])
    # ambient occlusion: short rays over the hemisphere
    dirs = []
    for k in range(18):
        z = 0.15 + 0.85 * (k + 0.5) / 18; r = math.sqrt(1 - z * z); ph = k * 2.39996; dirs.append(Vector((r * math.cos(ph), r * math.sin(ph), z)))
    AO = {}
    for i in used:
        nn = N[i]; q = Vector((0, 0, 1)).rotation_difference(nn); o = P[i] + nn * 0.0012; hit = 0.0
        for d in dirs:
            r = bvh.ray_cast(o, q @ d, 0.035)
            if r[0] is not None: hit += 1 - r[3] / 0.035 * 0.6
        AO[i] = max(0.25, 1 - hit / len(dirs) * 1.15)
    toG = lambda v: (v.x, v.z, -v.y)     # Blender (Z up, -Y toward the viewer) → game (Y up, +Z toward the viewer)
    order = ['skin', 'nail']; segs = []; fl = []; aob = []
    for s in order:
        c = 0
        for t, sl in zip(tris, slots):
            if sl != s: continue
            for i in t: fl.extend(toG(P[i])); fl.extend(toG(N[i])); aob.append(int(max(0, min(255, AO[i] * 255)))); c += 1
        if c: segs.append([s, c])
    head = json.dumps({'part': tag, 'segs': segs, 'total': len(aob), 'tris': len(tris), 'fpArm': 2}).encode()
    with open(os.path.join(OUT, tag + '.bin'), 'wb') as f: f.write(struct.pack('<I', len(head))); f.write(head); f.write(struct.pack('<%df' % len(fl), *fl)); f.write(bytes(aob))
    print('exported', tag, 'tris', len(tris), 'verts', len(used), 'segs', segs)
    ev.to_mesh_clear()
    if preview:
        m = bpy.data.meshes.new('fp_prev'); m.from_pydata([P[i] for i in used], [], [tuple(remap[i] for i in t) for t in tris]); m.update()
        for p_ in m.polygons: p_.use_smooth = True
        ob = bpy.data.objects.new('fp_prev', m); bpy.context.scene.collection.objects.link(ob)
        cm = bpy.data.meshes.new('fp_cyl'); cv = []; cf = []
        for k in range(16): an = k / 16 * 6.2832; cv += [(0.017 * math.cos(an), 0.017 * math.sin(an), -0.09), (0.017 * math.cos(an), 0.017 * math.sin(an), 0.11)]
        for k in range(16): cf.append((2 * k, 2 * ((k + 1) % 16), 2 * ((k + 1) % 16) + 1, 2 * k + 1))
        cm.from_pydata(cv, [], cf); cm.update(); co = bpy.data.objects.new('fp_cyl', cm); bpy.context.scene.collection.objects.link(co)
        body.hide_render = True
        render(tag, [(-0.22, -0.5, 0.22), (1, -0.15, 0.15), (0.1, 1, 0.25), (-1, 0.2, 0.1)], dist=0.42, focus=Vector((0.02, -0.08, -0.05)), res=(440, 360))
        body.hide_render = False; bpy.data.objects.remove(ob, do_unlink=True); bpy.data.objects.remove(co, do_unlink=True)
