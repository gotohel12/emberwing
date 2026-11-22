#!/usr/bin/env python3
"""Turn the Blender output (arvex_blender/out/tx: atlas_d.png, atlas_n.png, arvex_tx.bin) into the files the game ships:
public/models/arvex_tx.bin and public/textures/models_{d,n}.webp (4096) + models_{d,n}_2k.webp for phones and the low texture setting."""
import sys, shutil, os
from PIL import Image
src, root = sys.argv[1], os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
shutil.copy(os.path.join(src, 'arvex_tx.bin'), os.path.join(root, 'public/models/arvex_tx.bin'))
for nm, q in (('d', 82), ('n', 86)):
    im = Image.open(os.path.join(src, 'atlas_%s.png' % nm)).convert('RGBA')
    im.save(os.path.join(root, 'public/textures/models_%s.webp' % nm), quality=q, method=4, exact=True)
    im.resize((im.size[0] // 2, im.size[1] // 2), Image.LANCZOS).save(os.path.join(root, 'public/textures/models_%s_2k.webp' % nm), quality=q, method=4, exact=True)
for f in ('public/models/arvex_tx.bin', 'public/textures/models_d.webp', 'public/textures/models_n.webp', 'public/textures/models_d_2k.webp', 'public/textures/models_n_2k.webp'):
    print(f, os.path.getsize(os.path.join(root, f)) // 1024, 'KB')
