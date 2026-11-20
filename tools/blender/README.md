# ARVEX — Blender pipeline

Blender 5.2 + the MPFB extension (MakeHuman for Blender, from extensions.blender.org).

| File | What it does |
|---|---|
| `bridge.py` | Run once in Blender's Python console. It executes the `.py` jobs dropped into `arvex_blender/bridge/inbox/` and writes their output to `bridge/done/`. |
| `job_textures.py` | Downloads the CC0 PBR textures from Poly Haven (list and licence in `public/textures/LICENSE.txt`). They are then packed to `<name>_d.jpg` / `<name>_n.jpg` (normal XY + roughness) at 1K and 2K. |
| `job_human_mpfb.py` | Builds the realistic human with MPFB (male, athletic), bakes its shape and adds the standard rig. `detailed_helpers=True` is required or the rig does not fit the body. |
| `hand_lib.py`, `fp_arm_export.py`, `job_fp_arm.py` | Pose the right hand into a grip, cut the arm, put it in the game's view-model frame (grip centre at the origin, handle along +Y), compute ambient occlusion and write `out/fp_arm.bin`. |
| `merge_part.py` | `merge_part.py models.bin fp_arm.bin out.bin` replaces one part inside `public/models/arvex_models.bin` and sets `fpArm: 2`, which tells the game to use the Blender arm. |
| `arvex_build.py`, `arvex_human_real.py`, `arvex_preview.py` | The earlier scripted models (tools, weapons, third-person character) and their preview renders. |
