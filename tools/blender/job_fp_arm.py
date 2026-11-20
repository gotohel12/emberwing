import os
exec(open(os.path.join(os.path.dirname(ROOT), 'fp_arm_export.py'), encoding='utf-8').read())
export_arm(curl(c2=(52, 62, 48), thumb=((22, 30, -26), (40, 0, 0), (48, 0, 0))))
bpy.ops.wm.save_as_mainfile(filepath=os.path.join(os.path.dirname(ROOT), 'arvex_human_mpfb.blend'))
