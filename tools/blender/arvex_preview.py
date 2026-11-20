# ARVEX — viewport-style preview renders of the exported parts (Workbench), saved to out/preview_*.png
import bpy, os, math
from mathutils import Vector
D = r"C:\Users\mohse\Desktop\Mohsen ~ Danial Games\EMBERWING\arvex_blender"
sc = bpy.context.scene
sc.render.engine = 'BLENDER_WORKBENCH'
sh = sc.display.shading
sh.light = 'STUDIO'; sh.color_type = 'MATERIAL'; sh.show_cavity = True; sh.cavity_type = 'BOTH'
sh.show_shadows = True; sh.show_specular_highlight = False
sc.render.resolution_x = 1400; sc.render.resolution_y = 1000; sc.render.film_transparent = False
sc.world.color = (0.12, 0.12, 0.13) if sc.world else None
cam = bpy.data.objects.get('ARVEX_cam')
if not cam:
  cam = bpy.data.objects.new('ARVEX_cam', bpy.data.cameras.new('ARVEX_cam')); sc.collection.objects.link(cam)
sc.camera = cam; cam.data.lens = 60

def shoot(objs, name, az=25, el=8, pad=1.15):
  vis = set(objs)
  for o in sc.objects:
    if o.type in ('MESH', 'CURVE'): o.hide_render = o not in vis
  pts = [o.matrix_world @ Vector(c) for o in objs for c in o.bound_box]
  lo = Vector((min(p.x for p in pts), min(p.y for p in pts), min(p.z for p in pts)))
  hi = Vector((max(p.x for p in pts), max(p.y for p in pts), max(p.z for p in pts)))
  c = (lo + hi) / 2; r = (hi - lo).length / 2 * pad
  a, e = math.radians(az), math.radians(el)
  d = Vector((math.sin(a) * math.cos(e), -math.cos(a) * math.cos(e), math.sin(e)))
  dist = r / math.tan(cam.data.angle / 2)
  cam.location = c + d * dist
  cam.rotation_euler = (-d).to_track_quat('-Z', 'Y').to_euler()
  sc.render.filepath = os.path.join(D, 'out', 'preview_%s.png' % name)
  bpy.ops.render.render(write_still=True)

# assemble the human parts at their rig positions for the preview (game rig offsets -> blender)
import json
HUMAN_PARTS = ('pelvis','torso','head','armU','armL','legU','legL','armU_l','armL_l','legU_l','legL_l')
hb = [o for o in sc.objects if o.type in ('MESH', 'CURVE') and o.get('part') in HUMAN_PARTS and not o.hide_get()]
rig = json.load(open(os.path.join(D, 'out', 'rig.json')))
def B(p): return Vector((-p[0], p[2], p[1]))
R = {k: Vector(v) for k, v in rig.items()}
root = R['root']; torso = root + R['torso']; neck = torso + R['neck']
shR = torso + R['sh']; elR = shR + R['el']
hipR = root + R['hip']; kneeR = hipR + R['knee']
def mir(v): return Vector((-v.x, v.y, v.z))
POS = {'pelvis': root, 'torso': torso, 'head': neck, 'armU': shR, 'armL': elR, 'legU': hipR, 'legL': kneeR}
POS.update({'armU_l': torso + mir(R['sh']), 'armL_l': torso + mir(R['sh']) + mir(R['el']), 'legU_l': root + mir(R['hip']), 'legL_l': root + mir(R['hip']) + mir(R['knee'])})
saved = {o.name: o.location.copy() for o in hb}
for o in hb:
  if o['part'] in POS: o.location = B(POS[o['part']]) + Vector((5, 0, 0))
bpy.context.view_layer.update()
body = [o for o in hb if o['part'] in POS]
shoot(body, 'human_front', 20, 6)
shoot(body, 'human_back', 200, 6)
shoot([o for o in body if o['part'] == 'head'], 'human_face', 15, 4, 1.0)
for o in hb: o.location = saved[o.name]
items = {}
for o in sc.objects:
  p = o.get('part', '')
  if isinstance(p, str) and p.startswith('item:'): items.setdefault(p, []).append(o)
for p, objs in items.items(): shoot(objs, p.replace('item:', 'item_'), 60, 20)
for o in sc.objects:
  if o.type in ('MESH', 'CURVE'): o.hide_render = False
print('ARVEX_PREVIEW_DONE', len(items))
