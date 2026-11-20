import bpy, os, traceback, mathutils
from bl_ext.user_default.mpfb.services.humanservice import HumanService
from bl_ext.user_default.mpfb.services.targetservice import TargetService
win = bpy.context.window_manager.windows[0]; area = next(a for a in win.screen.areas if a.type == 'VIEW_3D'); region = next(r for r in area.regions if r.type == 'WINDOW')
for o in list(bpy.data.objects): bpy.data.objects.remove(o, do_unlink=True)
md = TargetService.get_default_macro_info_dict(); md.update({'gender': 1.0, 'age': 0.5, 'muscle': 0.72, 'weight': 0.48, 'proportions': 0.6, 'height': 0.55})
obj = HumanService.create_human(mask_helpers=True, detailed_helpers=True, extra_vertex_groups=True, feet_on_ground=False, scale=0.1, macro_detail_dict=md); obj.name = 'ARVEX_Human'
obj.shape_key_add(name='arvex_mix', from_mix=True)
for kb in [k for k in obj.data.shape_keys.key_blocks if k.name != 'arvex_mix']: obj.shape_key_remove(kb)
obj.shape_key_remove(obj.data.shape_keys.key_blocks['arvex_mix']); print('keys baked', obj.data.shape_keys)
for o in bpy.context.view_layer.objects: o.select_set(False)
bpy.context.view_layer.objects.active = obj; obj.select_set(True)
with bpy.context.temp_override(window=win, screen=win.screen, area=area, region=region): print('rig', bpy.ops.mpfb.add_standard_rig())
exec(open(os.path.join(os.path.dirname(ROOT), 'hand_lib.py'), encoding='utf-8').read())
arm, body = objs(); set_pose({})
dg = bpy.context.evaluated_depsgraph_get(); ev = body.evaluated_get(dg); me = ev.to_mesh()
gi = body.vertex_groups['wrist.R'].index; pts = [v.co.copy() for v in me.vertices if any(g.group == gi and g.weight > 0.5 for g in v.groups)]
c = sum(pts, mathutils.Vector()) / len(pts); print('wrist verts centre', [round(x, 3) for x in c], 'bone', [round(x, 3) for x in bone_pt('wrist.R')], 'eval verts', len(me.vertices)); ev.to_mesh_clear()
w = bone_pt('wrist.R'); sx = -1 if w.x < 0 else 1
set_pose(curl(axis=0, sign=1)); render('xp', [(sx, -1, 0.4), (sx * 0.2, 1, 0.5)])
set_pose({}); render('rest', [(sx, -1, 0.4)])
bpy.ops.wm.save_as_mainfile(filepath=os.path.join(os.path.dirname(ROOT), 'arvex_human_mpfb.blend'))
me = body.data
for bn in ('finger2-1.R', 'wrist.R'):
    gi = body.vertex_groups[bn].index; pts = [v.co for v in me.vertices if any(g.group == gi and g.weight > 0.5 for g in v.groups)]
    c = sum(pts, mathutils.Vector()) / max(len(pts), 1); pb = arm.pose.bones[bn]; print(bn, 'centroid', [round(x, 3) for x in c], 'head', [round(x, 3) for x in pb.head], 'tail', [round(x, 3) for x in pb.tail])
