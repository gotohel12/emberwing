# ARVEX SURVIVAL — firearms from the "Ultimate Gun Pack" by Quaternius (CC0, public domain:
# https://opengameart.org/content/low-poly-guns-pack), fitted to the game's hands inside Blender.
# For every gun: the pistol grip is found on the mesh, the gun is scaled so the grip is no thicker than the closed fist can hold,
# and placed so the grip sits in the right fist. The left hand goes under the fore-end (no finger passes through it).
# Output: out/v30/arvex_guns_cc0.bin (pack), out/v30/guns_meta.json (muzzle and left-hand points), out/v30/icons/<item>.png.
import bpy, os, math, json
_D = globals().get('ARVEX_DIR', r"C:\Users\mohse\Desktop\Mohsen ~ Danial Games\EMBERWING\arvex_blender")
_src = open(os.path.join(_D, 'arvex_v25.py'), encoding='utf-8').read()
exec(_src[:_src.index('# ------------------------------------------------------------------ run')], globals())
OUT = os.path.join(D, 'out', 'v30'); os.makedirs(os.path.join(OUT, 'icons'), exist_ok=True)
BASE = os.path.join(D, 'cc0', 'quaternius_guns', 'Ultimate Gun Pack - July 2019', 'Blends')
# colour slots: names start with wood / metal so the game gives them its wood and metal surfaces
SLOTS.update({'woodGun': hx('#7a5233'), 'woodGunD': hx('#5e3d24'), 'metalGunK': hx('#26272a'), 'metalGunK2': hx('#1b1b1e'), 'metalGunD': hx('#34363a'), 'metalGun': hx('#4b4e53'), 'metalGunL': hx('#7d8288'), 'metalGunL2': hx('#9aa0a6'),
              'metalGunG': hx('#3f4246'), 'metalGlass': hx('#16222e'), 'metalGunO': hx('#4c5a41'), 'metalGunM': hx('#3a3d42'), 'metalGunMD': hx('#2b2d31'), 'metalGunML': hx('#585c62')})
MAT = {'Wood': 'woodGun', 'DarkWood': 'woodGunD', 'Black': 'metalGunK', 'Black2': 'metalGunK2', 'DarkMetal': 'metalGunD', 'Metal': 'metalGun', 'LightMetal': 'metalGunL', 'LightMetal2': 'metalGunL2', 'Grey': 'metalGunG', 'Glass': 'metalGlass', 'Green': 'metalGunO', 'Main': 'metalGunM', 'MainDark': 'metalGunMD', 'MainLight': 'metalGunML'}
# model key in the game -> (file in the pack, nominal scale, kind)
SEL = {'ak': ('AssaultRifle_2', 0.165, 'long'), 'm4': ('AssaultRifle2_1', 0.16, 'long'), 'rifle': ('AssaultRifle_5', 0.165, 'long'), 'smg': ('SubmachineGun_2', 0.13, 'long'), 'smg2': ('SubmachineGun_3', 0.13, 'long'),
       'bolt': ('SniperRifle_6', 0.15, 'long'), 'l96': ('SniperRifle_3', 0.15, 'long'), 'shotgun': ('Shotgun_2', 0.145, 'long'), 'dbarrel': ('Shotgun_SawedOff', 0.13, 'hand'),
       'revolver': ('Revolver_1', 0.115, 'hand'), 'pistol': ('Pistol_1', 0.105, 'hand'), 'python': ('Revolver_3', 0.12, 'hand')}
ATT = {'silencer': ('Accessories/Silencer_1', 0.105), 'scope': ('Accessories/Scope_2', 0.115), 'flashlight': ('Accessories/Flashlight', 0.14)}
ICON = {'ak': 'assault_rifle', 'm4': 'lr_rifle', 'rifle': 'semi_rifle', 'smg': 'smg', 'smg2': 'custom_smg', 'bolt': 'bolt_rifle', 'l96': 'l96_rifle', 'shotgun': 'pump_shotgun', 'dbarrel': 'double_barrel', 'revolver': 'revolver', 'pistol': 'pistol', 'python': 'python',
        'silencer': 'silencer', 'scope': 'scope_8x', 'flashlight': 'weapon_light', 'cknife': 'combat_knife'}

def load(rel):
  with bpy.data.libraries.load(os.path.join(BASE, rel + '.blend'), link=False) as (s_, d_): d_.objects = list(s_.objects)
  objs = [o for o in d_.objects if o is not None and o.type == 'MESH']
  for o in objs: bpy.context.scene.collection.objects.link(o)
  bpy.context.view_layer.update(); V = []; F = []; FS = []; SM = []
  for o in objs:
    me = o.data; base = len(V); names = [(m.name.split('.')[0] if m else 'Metal') for m in me.materials] or ['Metal']
    for v in me.vertices: V.append(o.matrix_world @ v.co)
    for p in me.polygons: F.append(tuple(base + i for i in p.vertices)); FS.append(MAT.get(names[min(p.material_index, len(names) - 1)], 'metalGun')); SM.append(p.use_smooth)
  return objs, V, F, FS, SM

def build(part, Vg, F, FS, SM):
  me = bpy.data.meshes.new(part); me.from_pydata([B(v) for v in Vg], [], F); me.update(); names = []
  for s in FS:
    if s not in names: names.append(s)
  for s in names: me.materials.append(mat(s))
  for p, s, sm in zip(me.polygons, FS, SM): p.material_index = names.index(s); p.use_smooth = bool(sm)
  o = bpy.data.objects.new(part, me); col_for(part).objects.link(o); o['part'] = part; o['slot'] = names[0]; bmfix(o); return o

def icon(objs, name):
  sc = bpy.context.scene; sc.render.engine = 'BLENDER_WORKBENCH'; sh = sc.display.shading; sh.light = 'STUDIO'; sh.color_type = 'MATERIAL'; sh.show_cavity = True; sh.show_shadows = False
  for o in objs:
    for m in o.data.materials:
      if m:
        c = SLOTS[MAT.get(m.name.split('.')[0], 'metalGun')]; k = 1.9 if not m.name.startswith('Wood') and not m.name.startswith('DarkWood') else 1.35; m.diffuse_color = (min(1, c[0] * k), min(1, c[1] * k), min(1, c[2] * k), 1)
  sc.render.film_transparent = True; sc.render.image_settings.file_format = 'PNG'; sc.render.image_settings.color_mode = 'RGBA'; sc.render.resolution_x = 256; sc.render.resolution_y = 128
  cam = bpy.data.objects.get('ARVEX_icon')
  if not cam: cam = bpy.data.objects.new('ARVEX_icon', bpy.data.cameras.new('ARVEX_icon')); sc.collection.objects.link(cam)
  cam.data.type = 'ORTHO'; sc.camera = cam; vis = set(objs)
  for o in sc.objects:
    if o.type == 'MESH': o.hide_render = o not in vis
  pts = [o.matrix_world @ Vector(c) for o in objs for c in o.bound_box]; lo = Vector((min(p.x for p in pts), min(p.y for p in pts), min(p.z for p in pts))); hi = Vector((max(p.x for p in pts), max(p.y for p in pts), max(p.z for p in pts)))
  c = (lo + hi) / 2; cam.data.ortho_scale = max(hi.x - lo.x, (hi.z - lo.z) * 2) * 1.08; cam.location = (c.x, lo.y - 20, c.z); cam.rotation_euler = (math.pi / 2, 0, 0); cam.data.clip_end = 100
  sc.render.filepath = os.path.join(OUT, 'icons', name + '.png'); bpy.ops.render.render(write_still=True)
  for o in sc.objects:
    if o.type == 'MESH': o.hide_render = False

clear(); meta = {}; made = {}
for key, (fn, nominal, kind) in SEL.items():
  objs, V, F, FS, SM = load(fn); icon(objs, ICON[key])
  # the pistol grip: the rearmost part hanging below the receiver (the stock, further back, and the magazine, further forward, are left out)
  sl = {}
  for v in V:
    if -0.42 <= v.x <= 0.5: k = round(v.x / 0.05); sl[k] = min(sl.get(k, 9), v.z)
  gbot = min(sl.values()); gs = [k * 0.05 for k, z in sl.items() if z < gbot + 0.1]; gx = sum(gs) / len(gs)
  gtop = gbot
  for i in range(1, 60):                                                            # walk up the grip until the gun widens into the receiver
    z = gbot + i * 0.03; xs = [v.x for v in V if abs(v.z - z) < 0.03 and abs(v.x - gx) < 0.7]
    if xs and max(xs) - min(xs) > 0.8: gtop = z; break
  half = max([abs(v.y) for v in V if abs(v.x - gx) < 0.14 and gbot + 0.06 < v.z < gtop - 0.03] or [0.1])
  s = min(nominal, 0.0168 / half)
  Vg = [(-v.y * s, (v.z - gtop) * s + 0.004, -(v.x - gx) * s + 0.062) for v in V]
  for o in objs: bpy.data.objects.remove(o, do_unlink=True)
  made[key] = build('item:' + key, Vg, F, FS, SM)
  zmin = min(p[2] for p in Vg); tip = [p for p in Vg if p[2] < zmin + 0.004]; muzzle = [0.0, round(sum(p[1] for p in tip) / len(tip), 4), round(zmin, 4)]
  m = {'src': fn, 'scale': round(s, 4), 'grip_half_mm': round(half * s * 1000, 1), 'len': round(max(p[2] for p in Vg) - zmin, 3), 'muzzle': muzzle, 'top': round(max(p[1] for p in Vg if -0.12 < p[2] < 0.02), 4)}
  if kind == 'long':                                                                # the left fist sits under the fore-end, touching it from below
    zl = max(-0.34, zmin * 0.6); band = [min(Vg[i][1] for i in f) for f in F if min(Vg[i][2] for i in f) <= zl <= max(Vg[i][2] for i in f)]; m['lh'] = [0.0, round(min(band) - 0.034, 4), round(zl, 4)] if band else None
  meta[key] = m
for key, (fn, s) in ATT.items():                                                    # attachments: mount point at the origin, pointing towards -z
  objs, V, F, FS, SM = load(fn); icon(objs, ICON[key]); x0 = min(v.x for v in V); zc = sum(v.z for v in V) / len(V)
  if key == 'silencer': Vg = [(-v.y * s, (v.z - zc) * s, -(v.x - x0) * s) for v in V]
  else: xc = (min(v.x for v in V) + max(v.x for v in V)) / 2; zb = min(v.z for v in V); Vg = [(-v.y * s, (v.z - zb) * s, -(v.x - xc) * s) for v in V]
  for o in objs: bpy.data.objects.remove(o, do_unlink=True)
  made[key] = build('att:' + key, Vg, F, FS, SM); meta[key] = {'src': fn, 'scale': s, 'len': round(max(p[2] for p in Vg) - min(p[2] for p in Vg), 3)}
# combat knife: blade up, handle in the fist
objs, V, F, FS, SM = load('Accessories/Bayonet'); icon(objs, ICON['cknife']); s = 0.2; hx0 = min(v.x for v in V)
Vg = [(-v.y * s, (v.x - hx0) * s - 0.062, v.z * s) for v in V]
for o in objs: bpy.data.objects.remove(o, do_unlink=True)
made['cknife'] = build('item:cknife', Vg, F, FS, SM); meta['cknife'] = {'src': 'Bayonet', 'scale': s}
bpy.context.view_layer.update()
total, tris = export(os.path.join(OUT, 'arvex_guns_cc0.bin')); meta['_tris'] = tris
json.dump(meta, open(os.path.join(OUT, 'guns_meta.json'), 'w'), indent=1)
log('EXPORT', total, 'vertices'); print(json.dumps(meta))
sc = bpy.context.scene; sc.render.film_transparent = False; sc.render.image_settings.file_format = 'JPEG'; sc.render.image_settings.color_mode = 'RGB'
log('renders', renders([(k, [o], 250, 14) for k, o in made.items()]))
try: bpy.ops.wm.save_as_mainfile(filepath=os.path.join(D, 'arvex_guns_cc0.blend'))
except Exception as ex: log('save failed', ex)
log('ARVEX_CC0_GUNS_DONE')
