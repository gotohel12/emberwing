# ARVEX SURVIVAL 25.0 — building pieces, made in Blender (run inside Blender: exec(open(path).read())).
# Seven pieces (foundation, floor, wall, doorway, window, roof, stairs, pillar) in the four tiers the game has:
# 0 lashed poles · 1 timber · 2 cut stone · 3 sheet metal. Same sizes and origins as the game's cells (3 m x 3 m, walls 3 m high),
# so collision, doors and placement stay exactly as they are. Output: out/v25/arvex_v25_build.bin (merged with tools/blender/merge_pack.py).
import bpy, os, math, random
_D = globals().get('ARVEX_DIR', r"C:\Users\mohse\Desktop\Mohsen ~ Danial Games\EMBERWING\arvex_blender")
_src = open(os.path.join(_D, 'arvex_v25.py'), encoding='utf-8').read()
exec(_src[:_src.index('# ------------------------------------------------------------------ run')], globals())   # the shared helpers (boxes, tubes, bevels, export, renders)

SLOTS.update({'woodT': hx('#9a7a52'), 'woodTD': hx('#6e5536'), 'woodTL': hx('#b3935f'), 'woodB': hx('#6b4a2e'), 'stoneB': hx('#8a857c'), 'stoneC': hx('#6a665f'), 'metalS': hx('#8d9499'), 'metalP': hx('#5d6368')})
S = 3.0; H = 3.0; h = S / 2
TIER = [dict(a='woodT', b='woodTD', c='woodTL'), dict(a='wood', b='woodD', c='woodL'), dict(a='stone', b='stoneD', c='stoneL'), dict(a='metal', b='metalD', c='metalL')]

# the light copies for the distance are the same pieces built plainly: no bevels, fewer sides, no rivets
LOW = False
_box, _tube = box, tube
def box(part, slot, c, s, rot=None, bev=0.008, seg=1, taper=None, name='box'):
  return _box(part, slot, c, s, rot, 0 if LOW else bev, seg, taper, name)
def tube(part, slot, a, b, r0, r1, seg=12, rings=1, cap=True, smooth=True, prof=None, wob=0.0, seed=0, name='tube'):
  if LOW:
    if math.dist(a, b) < 0.06: return None
    return _tube(part, slot, a, b, r0, r1, 4 if r0 >= 0.04 else 3, 1, cap and r0 >= 0.04, False, prof, 0.0, seed, name)
  return _tube(part, slot, a, b, r0, r1, seg, rings, cap, smooth, prof, wob, seed, name)

def pole(P, slot, a, b, r, seed=0, seg=7):
  return tube(P, slot, a, b, r, r * 0.88, seg, 2, wob=0.14, seed=seed)

def panel(P, x0, x1, y0, y1, tier, th, seed=0, z=0.0):
  """a wall panel in the XY plane, centred on z"""
  w = x1 - x0; hh = y1 - y0
  if w < 0.02 or hh < 0.02: return
  r = random.Random(seed * 977 + int(x0 * 31) + int(y0 * 17) + tier * 5)
  if tier == 0:                                                                     # lashed poles with thin sticks between them
    for x in (x0 + 0.06, x1 - 0.06): pole(P, 'woodTD', (x, y0, z), (x, y1, z), 0.055, r.random() * 9)
    for y in (y0 + 0.07, y1 - 0.07): pole(P, 'woodT', (x0, y, z + 0.03), (x1, y, z + 0.03), 0.042, r.random() * 9, 6)
    if hh > 1.4: pole(P, 'woodT', (x0, (y0 + y1) / 2, z + 0.03), (x1, (y0 + y1) / 2, z + 0.03), 0.04, r.random() * 9, 6)
    n = max(1, int(w / 0.2))
    for i in range(n):
      x = x0 + (i + 0.5) * w / n
      tube(P, ('woodT', 'woodTL', 'woodTD')[i % 3], (x + r.uniform(-0.03, 0.03), y0 + 0.02, z - 0.025), (x + r.uniform(-0.03, 0.03), y1 - 0.02 - r.uniform(0, 0.05), z - 0.025), 0.024, 0.019, 5, 1, cap=False)
    return
  if tier == 1:                                                                     # upright planks, battens on both faces
    n = max(1, round(w / 0.3)); pw = w / n
    for i in range(n):
      box(P, ('wood', 'woodL', 'woodP', 'wood', 'woodB')[(i + seed) % 5], (x0 + (i + 0.5) * pw, (y0 + y1) / 2 + r.uniform(-0.006, 0.006), z + r.uniform(-0.006, 0.006)), (pw - 0.014, hh - r.uniform(0, 0.02), th), bev=0.007)
    if hh > 0.9:
      for y in (y0 + hh * 0.18, y1 - hh * 0.18):
        for sgn in (-1, 1): box(P, 'woodD', ((x0 + x1) / 2, y, z + sgn * (th / 2 + 0.018)), (w, 0.13, 0.036), bev=0.006)
    return
  if tier == 2:                                                                     # cut stone in running bond over a dark core
    rows = max(1, round(hh / 0.5)); rh = hh / rows
    box(P, 'stoneD', ((x0 + x1) / 2, (y0 + y1) / 2, z), (w - 0.02, hh - 0.02, th * 0.78), bev=0)
    for k in range(rows):
      x = x0 - (0.55 if k % 2 else 0.0); yy = y0 + (k + 0.5) * rh
      while x < x1 - 0.01:
        L = 1.1 + r.uniform(-0.12, 0.12); xa = max(x0, x); xb = min(x1, x + L)
        if xb - xa > 0.08: box(P, ('stone', 'stoneL', 'stoneB', 'stone', 'stoneC')[r.randrange(5)], ((xa + xb) / 2, yy, z), (xb - xa - 0.022, rh - 0.022, th + r.uniform(-0.012, 0.02)), bev=0.016)
        x += L
    return
  n = max(1, round(w / 1.0)); pw = w / n                                            # sheet metal on a frame, ribs and rivets
  for i in range(n):
    box(P, ('metal', 'metalS', 'metalP')[(i + seed) % 3], (x0 + (i + 0.5) * pw, (y0 + y1) / 2, z), (pw - 0.012, hh - 0.012, th * 0.55), bev=0.004)
    if hh > 1.2 and r.random() < 0.6: box(P, 'metalR', (x0 + (i + 0.5) * pw + r.uniform(-0.2, 0.2) * pw, y0 + r.uniform(0.25, 0.75) * hh, z), (pw * r.uniform(0.25, 0.5), hh * r.uniform(0.12, 0.25), th * 0.55 + 0.008), bev=0)
  ys = (y0 + 0.08, y1 - 0.08) if hh < 1.2 else (y0 + 0.08, (y0 + y1) / 2, y1 - 0.08)
  for y in ys:
    box(P, 'metalD', ((x0 + x1) / 2, y, z), (w, 0.1, th + 0.05), bev=0.006)
  for i in range(n + 1):
    x = min(x1 - 0.03, max(x0 + 0.03, x0 + i * pw))
    box(P, 'metalD', (x, (y0 + y1) / 2, z), (0.06, hh, th + 0.03), bev=0)
    for y in ys:
      for sgn in (-1, 1): tube(P, 'metalL', (x, y, z + sgn * (th / 2 + 0.025)), (x, y, z + sgn * (th / 2 + 0.04)), 0.016, 0.012, 6, 1)

def wall_frame(P, tier, th):
  T = TIER[tier]
  if tier == 0: return
  if tier == 1:
    for x in (-h + 0.07, h - 0.07): box(P, 'woodD', (x, H / 2, 0), (0.14, H, th + 0.07), bev=0.008)
    box(P, 'woodD', (0, H - 0.06, 0), (S, 0.12, th + 0.06), bev=0.008); box(P, 'woodB', (0, 0.06, 0), (S, 0.12, th + 0.06), bev=0.008)
  elif tier == 2:
    for x in (-h + 0.09, h - 0.09):
      for k in range(5): box(P, ('stoneL', 'stoneB')[k % 2], (x, 0.3 + k * 0.6, 0), (0.2, 0.57, th + 0.07), bev=0.018)
    box(P, 'stoneC', (0, H - 0.07, 0), (S - 0.36, 0.14, th + 0.06), bev=0.014)
  else:
    for x in (-h + 0.05, h - 0.05): box(P, 'metalD', (x, H / 2, 0), (0.1, H, th + 0.1), bev=0.006)

def wall(P, tier):
  th = 0.1 if tier == 0 else 0.2
  panel(P, -h, h, 0, H, tier, th, 1); wall_frame(P, tier, th)

def doorway(P, tier):
  th = 0.1 if tier == 0 else 0.2; T = TIER[tier]
  panel(P, -h, -0.6, 0, H, tier, th, 2); panel(P, 0.6, h, 0, H, tier, th, 3); panel(P, -0.6, 0.6, 2.24, H, tier, th, 4); wall_frame(P, tier, th)
  if tier == 0:
    for x in (-0.6, 0.6): pole(P, 'woodTD', (x, 0, 0), (x, 2.26, 0), 0.06, x + 3)
    pole(P, 'woodTD', (-0.68, 2.24, 0), (0.68, 2.24, 0), 0.06, 7)
  else:
    sl = T['b']
    for x in (-0.6, 0.6): box(P, sl, (x, 1.12, 0), (0.1, 2.24, th + 0.09), bev=0.008)
    box(P, sl if tier != 2 else 'stoneL', (0, 2.27, 0), (1.34, 0.14, th + 0.11), bev=0.01)

def window(P, tier):
  th = 0.1 if tier == 0 else 0.2; T = TIER[tier]
  panel(P, -h, -0.62, 0, H, tier, th, 5); panel(P, 0.62, h, 0, H, tier, th, 6); panel(P, -0.62, 0.62, 0, 1.08, tier, th, 7); panel(P, -0.62, 0.62, 2.12, H, tier, th, 8); wall_frame(P, tier, th)
  if tier == 0:
    for y in (1.08, 2.12): pole(P, 'woodTD', (-0.68, y, 0), (0.68, y, 0), 0.05, y)
    pole(P, 'woodT', (0, 1.08, 0), (0, 2.12, 0), 0.03, 4)
  else:
    sl = T['b']
    box(P, sl if tier != 2 else 'stoneL', (0, 1.06, 0), (1.36, 0.1, th + 0.14), bev=0.01); box(P, sl, (0, 2.15, 0), (1.3, 0.1, th + 0.08), bev=0.008)
    for x in (-0.62, 0.62): box(P, sl, (x, 1.6, 0), (0.08, 1.0, th + 0.07), bev=0.006)
    if tier == 1: box(P, 'woodD', (0, 1.6, 0), (0.05, 1.0, 0.05), bev=0.004); box(P, 'woodD', (0, 1.6, 0), (1.2, 0.05, 0.05), bev=0.004)
    else:
      for x in (-0.3, 0.0, 0.3): tube(P, 'metalD', (x, 1.1, 0), (x, 2.11, 0), 0.02, 0.02, 6, 1, cap=False)

def deck(P, tier, y, seed=0):
  """the walking surface of a floor or foundation, top at height y"""
  r = random.Random(seed * 53 + tier)
  if tier == 0:
    for k in range(4):
      a = [(-h, -h), (h, -h), (h, h), (-h, h)][k]; b = [(h, -h), (h, h), (-h, h), (-h, -h)][k]
      pole(P, 'woodTD', (a[0] * 0.97, y - 0.07, a[1] * 0.97), (b[0] * 0.97, y - 0.07, b[1] * 0.97), 0.07, k)
    n = 15
    for i in range(n):
      x = -h + 0.1 + (i + 0.5) * (S - 0.2) / n
      tube(P, ('woodT', 'woodTL', 'woodT', 'woodTD')[i % 4], (x, y - 0.035 + r.uniform(-0.008, 0.008), -h + 0.03), (x + r.uniform(-0.02, 0.02), y - 0.035, h - 0.03), 0.04, 0.034, 6, 1)
  elif tier == 1:
    n = 10; pw = S / n
    for i in range(n): box(P, ('wood', 'woodL', 'woodP', 'woodB', 'wood')[(i * 3 + seed) % 5], (-h + (i + 0.5) * pw, y - 0.03 + r.uniform(-0.004, 0.004), 0), (pw - 0.016, 0.06, S - r.uniform(0, 0.02)), bev=0.007)
  elif tier == 2:
    xs = [-h, -h + 1.1, -h + 2.0, h]; zs = [-h, -h + 0.9, -h + 2.05, h]
    for i in range(3):
      for j in range(3):
        box(P, ('stone', 'stoneL', 'stoneB', 'stoneC')[(i * 2 + j + seed) % 4], ((xs[i] + xs[i + 1]) / 2, y - 0.035 + r.uniform(-0.006, 0.006), (zs[j] + zs[j + 1]) / 2), (xs[i + 1] - xs[i] - 0.024, 0.07, zs[j + 1] - zs[j] - 0.024), bev=0.016)
  else:
    for i in range(2):
      for j in range(2):
        box(P, ('metal', 'metalS', 'metalP', 'metal')[(i * 2 + j + seed) % 4], (-h / 2 + i * h, y - 0.02, -h / 2 + j * h), (h - 0.014, 0.04, h - 0.014), bev=0.005)
    for i in range(5): box(P, 'metalD', (-h + 0.3 + i * 0.6, y + 0.004, 0), (0.045, 0.014, S - 0.24), bev=0)
    for (x, z) in [(sx * (h - 0.1), sz * (h - 0.1)) for sx in (-1, 1) for sz in (-1, 1)] + [(0.07 * sx, sz * (h - 0.1)) for sx in (-1, 1) for sz in (-1, 1)]:
      tube(P, 'metalL', (x, y, z), (x, y + 0.012, z), 0.02, 0.015, 6, 1)

def side(k, x, y, zo):                                                              # a point on side k of the cell (0 = +z), zo outwards
  p = (x, y, h + zo)
  for _ in range(k): p = (p[2], p[1], -p[0])
  return p
def side_box(P, slot, k, x, y, zo, sx, sy, sz, bev=0.008):
  return box(P, slot, side(k, x, y, zo), (sx, sy, sz) if k % 2 == 0 else (sz, sy, sx), bev=bev)

def floor(P, tier):
  T = TIER[tier]
  if tier != 0: box(P, T['b'], (0, -0.12, 0), (S - 0.02, 0.12, S - 0.02), bev=0)
  deck(P, tier, 0.0, 1)
  if tier == 1:
    for x in (-h + 0.5, 0, h - 0.5): box(P, 'woodD', (x, -0.2, 0), (0.12, 0.1, S - 0.04), bev=0.006)
  elif tier == 3:
    for x in (-h + 0.3, h - 0.3): box(P, 'metalD', (x, -0.2, 0), (0.1, 0.1, S - 0.04), bev=0.004)

def foundation(P, tier):
  T = TIER[tier]; th = 1.4; r = random.Random(11 + tier)
  deck(P, tier, 0.0, 2)
  if tier == 0:
    for sx in (-1, 1):
      for sz in (-1, 1): pole(P, 'woodTD', (sx * (h - 0.09), -2.0, sz * (h - 0.09)), (sx * (h - 0.09), -0.02, sz * (h - 0.09)), 0.085, sx * 2 + sz)
    for k in range(4):
      a = side(k, -h + 0.09, -0.75, -0.09); b = side(k, h - 0.09, -0.75, -0.09); pole(P, 'woodT', a, b, 0.05, k + 5, 6)
      a = side(k, -h + 0.12, -0.72, -0.1); b = side(k, h - 0.12, -0.1, -0.1); tube(P, 'woodTL', a, b, 0.03, 0.026, 5, 1, cap=False)
      a = side(k, -h + 0.12, -0.1, -0.1); b = side(k, h - 0.12, -0.72, -0.1); tube(P, 'woodT', a, b, 0.03, 0.026, 5, 1, cap=False)
    box(P, 'woodTD', (0, -0.16, 0), (S - 0.2, 0.08, S - 0.2), bev=0)
    return
  box(P, T['b'], (0, -th / 2 - 0.05, 0), (S - 0.1, th - 0.1, S - 0.1), bev=0)       # the solid body
  for k in range(4):
    if tier == 1:
      for j in range(4): side_box(P, ('wood', 'woodP', 'woodB', 'woodL')[(j + k) % 4], k, 0, -0.24 - j * 0.34, -0.03, S - 0.02 - (0.06 if k % 2 else 0), 0.32, 0.06, bev=0.007)
      for x in (-h + 0.08, h - 0.08): side_box(P, 'woodD', k, x, -th / 2, 0.0, 0.14, th + 0.02, 0.07, bev=0.007)
    elif tier == 2:
      for j in range(3):
        x = -h - (0.5 if j % 2 else 0.0)
        while x < h - 0.01:
          L = 1.0 + r.uniform(-0.08, 0.1); xa = max(-h, x); xb = min(h, x + L)
          if xb - xa > 0.1: side_box(P, ('stone', 'stoneL', 'stoneB', 'stoneC')[r.randrange(4)], k, (xa + xb) / 2, -0.07 - 0.22 - j * 0.44, -0.04 + r.uniform(-0.01, 0.014), xb - xa - 0.022, 0.42, 0.1, bev=0.016)
          x += L
    else:
      side_box(P, ('metal', 'metalS')[k % 2], k, 0, -th / 2 - 0.02, -0.035, S - 0.02 - (0.07 if k % 2 else 0), th - 0.06, 0.05, bev=0.005)
      for y in (-0.12, -th + 0.1): side_box(P, 'metalD', k, 0, y, -0.01, S - (0.07 if k % 2 else 0), 0.1, 0.06, bev=0.005)
      for x in (-h + 0.05, 0, h - 0.05): side_box(P, 'metalD', k, x, -th / 2, -0.01, 0.07, th, 0.06, bev=0)
      side_box(P, 'metalR', k, r.uniform(-0.8, 0.8), -th + 0.35, -0.03, 0.9, 0.5, 0.045, bev=0)
  for sx in (-1, 1):
    for sz in (-1, 1): box(P, T['b'], (sx * (h - 0.2), -th - 0.6, sz * (h - 0.2)), (0.34, 1.3, 0.34), bev=0.01)

def roof(P, tier):
  T = TIER[tier]; top = (0, 1.25, 0); c = [(-h, 0, -h), (h, 0, -h), (h, 0, h), (-h, 0, h)]; th = 0.12
  for i in range(4):
    p = c[i]; q = c[(i + 1) % 4]; sl = (T['a'], T['c'])[i % 2] if tier != 2 else ('stoneC', 'stoneD')[i % 2]
    bmfix(mesh_from('roof', [p, q, top, (p[0], -th, p[2]), (q[0], -th, q[2]), (0, 1.25 - th, 0)], [(0, 1, 2), (3, 5, 4), (0, 3, 4, 1)], P, sl, False))
    lerp = lambda a, b, f: (a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f + 0.012, a[2] + (b[2] - a[2]) * f)
    if tier == 0:
      for f in (0.25, 0.55, 0.8): tube(P, 'woodTD', lerp(p, top, f), lerp(q, top, f), 0.032, 0.028, 5, 1)
      pole(P, 'woodTD', (p[0], 0.02, p[2]), (0, 1.29, 0), 0.05, i)
    elif tier == 1:
      for f in (0.0, 0.3, 0.58, 0.82): tube(P, 'woodD', lerp(p, top, f), lerp(q, top, f), 0.04, 0.04, 4, 1)
      tube(P, 'woodD', (p[0], 0.03, p[2]), (0, 1.3, 0), 0.055, 0.045, 6, 1)
    elif tier == 2:
      for f in (0.0, 0.26, 0.5, 0.72, 0.9): tube(P, 'stoneL', lerp(p, top, f), lerp(q, top, f), 0.03, 0.03, 4, 1)
      tube(P, 'stoneB', (p[0], 0.03, p[2]), (0, 1.3, 0), 0.06, 0.05, 6, 1)
    else:
      for f in (0.0, 0.45, 0.85): tube(P, 'metalD', lerp(p, top, f), lerp(q, top, f), 0.028, 0.028, 4, 1)
      tube(P, 'metalD', (p[0], 0.03, p[2]), (0, 1.3, 0), 0.045, 0.04, 6, 1)
      m = lerp(p, q, 0.5); tube(P, 'metalD', (m[0], 0.02, m[2]), (0, 1.28, 0), 0.025, 0.025, 4, 1)
  if tier > 0: box(P, T['b'], (0, 1.3, 0), (0.2, 0.12, 0.2), bev=0.02)

def stairs(P, tier):
  T = TIER[tier]; n = 10; d = S / n; r = random.Random(41 + tier); a = math.atan2(H, S); L = math.hypot(S, H)
  for i in range(n):
    y = (i + 1) * H / n; z = h - (i + 0.5) * d
    if tier == 0:
      for k in (-1, 1): tube(P, ('woodT', 'woodTL')[(i + (k > 0)) % 2], (-0.72, y - 0.04, z + k * 0.07), (0.72, y - 0.04, z + k * 0.07), 0.04, 0.036, 6, 1)
    elif tier == 1: box(P, ('wood', 'woodL', 'woodP')[i % 3], (0, y - 0.035, z), (1.42, 0.07, d + 0.03), bev=0.008)
    elif tier == 2:
      box(P, ('stone', 'stoneL', 'stoneB')[i % 3], (0, y - 0.06, z), (1.44, 0.12, d + 0.02), bev=0.016); box(P, 'stoneD', (0, (y - 0.12) / 2, z), (1.32, y - 0.12, d * 0.94), bev=0)
    else:
      box(P, ('metal', 'metalS')[i % 2], (0, y - 0.02, z), (1.4, 0.04, d + 0.01), bev=0.004); box(P, 'metalD', (0, y - 0.07, z + d / 2 - 0.02), (1.36, 0.1, 0.03), bev=0)
  if tier == 0:
    for x in (-0.74, 0.74): pole(P, 'woodTD', (x, 0.1, h), (x, H + 0.06, -h), 0.06, x)
    for x in (-0.74, 0.74): pole(P, 'woodTD', (x, 0, -h + 0.06), (x, H, -h + 0.06), 0.055, x + 2)
  elif tier != 2:
    sl = T['b']
    for x in (-0.74, 0.74): box(P, sl, (x, H / 2 - 0.12, 0), (0.07, 0.24, L), rot=(a, 0, 0), bev=0.008)
    for x in (-0.74, 0.74): box(P, sl, (x, H / 2, -h + 0.07), (0.12, H, 0.12), bev=0.008)

def pillar(P, tier):
  T = TIER[tier]
  if tier == 0: pole(P, 'woodTD', (0, 0, 0), (0, H, 0), 0.11, 3, 9)
  elif tier == 1:
    box(P, 'wood', (0, H / 2, 0), (0.3, H, 0.3), bev=0.014); box(P, 'woodD', (0, 0.09, 0), (0.42, 0.18, 0.42), bev=0.012); box(P, 'woodD', (0, H - 0.09, 0), (0.42, 0.18, 0.42), bev=0.012)
    for sgn in (-1, 1): box(P, 'woodD', (sgn * 0.3, H - 0.38, 0), (0.5, 0.09, 0.1), rot=(0, 0, sgn * 0.8), bev=0.006)
  elif tier == 2:
    for k in range(6): box(P, ('stone', 'stoneL', 'stoneB')[k % 3], (0, 0.25 + k * 0.5, 0), (0.37 - (k % 2) * 0.02, 0.48, 0.37 - (k % 2) * 0.02), bev=0.02)
    box(P, 'stoneC', (0, 0.07, 0), (0.5, 0.14, 0.5), bev=0.016); box(P, 'stoneC', (0, H - 0.07, 0), (0.5, 0.14, 0.5), bev=0.016)
  else:
    box(P, 'metalP', (0, H / 2, 0), (0.08, H, 0.28), bev=0.004)
    for sgn in (-1, 1): box(P, 'metal', (0, H / 2, sgn * 0.14), (0.28, H, 0.05), bev=0.004)
    box(P, 'metalD', (0, 0.04, 0), (0.44, 0.08, 0.44), bev=0.008); box(P, 'metalD', (0, H - 0.04, 0), (0.44, 0.08, 0.44), bev=0.008)

# ------------------------------------------------------------------ run
clear()
PIECES = [('foundation', foundation), ('floor', floor), ('wall', wall), ('doorway', doorway), ('window', window), ('roof', roof), ('stairs', stairs), ('pillar', pillar)]
for name, fn in PIECES:
  for t in range(4):
    LOW = False; fn('bp:%s:%d' % (name, t), t)
    LOW = True; fn('bp:%s:%d~1' % (name, t), t); LOW = False
  log('built', name)
bpy.context.view_layer.update()
total, tris = export(os.path.join(OUT, 'arvex_v25_build.bin'))
json.dump({'total': total, 'tris': tris}, open(os.path.join(OUT, 'report_build.json'), 'w'), indent=1)
log('EXPORT', total, 'vertices', len(tris), 'parts')
for k in sorted(tris): print('   %-26s %7d tris' % (k, tris[k]))
# previews: every tier side by side for the four pieces that show most
by = {}
for o in bpy.data.objects:
  if 'part' in o: by.setdefault(o['part'], []).append(o)
shown = [('build_low', [o for k in ('bp:wall:2~1', 'bp:foundation:1~1') for o in by.get(k, [])], 20, 15)]; ORDER = ('foundation', 'wall', 'doorway', 'window', 'roof', 'stairs', 'pillar', 'floor')
for t in range(4):
  for j, nm in enumerate(ORDER):
    for o in by.get('bp:%s:%d' % (nm, t), []): o.location.x += -((j % 4) - 1.5) * 3.9
  for g in (0, 1):
    objs = [o for nm in ORDER[g * 4:g * 4 + 4] for o in by.get('bp:%s:%d' % (nm, t), [])]
    shown.append(('build_t%d_%s' % (t, 'ab'[g]), objs, 20, 15))
bpy.context.view_layer.update()
sc = bpy.context.scene
log('renders', renders(shown))
try: bpy.ops.wm.save_as_mainfile(filepath=os.path.join(D, 'arvex_v25_build.blend'))
except Exception as ex: log('save failed', ex)
log('ARVEX_V25_BUILD_DONE')
