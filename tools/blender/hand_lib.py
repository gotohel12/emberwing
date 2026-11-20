# ARVEX: pose + preview + export helpers for the MPFB human (run through bridge scripts)
import bpy, math, os, mathutils
HB = r"C:\Users\mohse\Desktop\Mohsen ~ Danial Games\EMBERWING\arvex_blender"
OUT = os.path.join(HB, 'out')
def objs(): return bpy.data.objects['ARVEX_Human.rig'], bpy.data.objects['ARVEX_Human']
def set_pose(pose):
    arm, body = objs()
    for pb in arm.pose.bones: pb.rotation_mode = 'XYZ'; pb.rotation_euler = (0, 0, 0); pb.location = (0, 0, 0)
    for name, r in pose.items(): arm.pose.bones[name].rotation_euler = tuple(math.radians(a) for a in r)
    bpy.context.view_layer.update()
def bone_pt(name, tail=False):
    arm, _ = objs(); pb = arm.pose.bones[name]; return arm.matrix_world @ (pb.tail if tail else pb.head)
def render(tag, dirs, dist=0.5, focus=None, res=(520, 400)):
    sc = bpy.context.scene; sc.render.engine = 'BLENDER_WORKBENCH'; sh = sc.display.shading
    sh.light = 'STUDIO'; sh.show_cavity = True; sh.cavity_type = 'BOTH'; sh.color_type = 'SINGLE'; sh.single_color = (0.78, 0.6, 0.5); sh.show_shadows = True
    sc.render.resolution_x, sc.render.resolution_y = res; sc.render.resolution_percentage = 100; sc.render.image_settings.file_format = 'JPEG'; sc.render.image_settings.quality = 80
    cam = bpy.data.objects.get('ARVEX_Cam')
    if not cam: cam = bpy.data.objects.new('ARVEX_Cam', bpy.data.cameras.new('ARVEX_Cam')); sc.collection.objects.link(cam)
    sc.camera = cam; cam.data.lens = 60; cam.data.clip_start = 0.01
    c = focus or (bone_pt('wrist.R') + bone_pt('finger3-2.R')) / 2
    for i, d in enumerate(dirs):
        v = mathutils.Vector(d).normalized(); cam.location = c + v * dist; cam.rotation_euler = (c - cam.location).to_track_quat('-Z', 'Y').to_euler()
        sc.render.filepath = os.path.join(OUT, 'handtest_%s_%d.jpg' % (tag, i)); bpy.ops.render.render(write_still=True)
def curl(c2=(60, 80, 50), spread=0, thumb=((0, 0, 0), (0, 0, 0), (0, 0, 0)), axis=0, sign=1, extra=None):
    p = {}
    for f in (2, 3, 4, 5):
        for j in (1, 2, 3):
            r = [0, 0, 0]; r[axis] = sign * c2[j - 1] * (1 + (f - 2) * 0.04); p['finger%d-%d.R' % (f, j)] = tuple(r)
    for j in (1, 2, 3): p['finger1-%d.R' % j] = thumb[j - 1]
    if extra: p.update(extra)
    return p
