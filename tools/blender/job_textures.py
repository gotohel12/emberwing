# Downloads CC0 PBR textures from Poly Haven (2K JPG: diffuse, GL normal, roughness, AO) into arvex_blender/textures/<layer>/
import urllib.request, json, os
UA = {'User-Agent': 'ARVEX-game-dev/1.0 (texture fetch)'}
OUT = os.path.join(os.path.dirname(ROOT), 'textures'); os.makedirs(OUT, exist_ok=True)
def get(u): return urllib.request.urlopen(urllib.request.Request(u, headers=UA), timeout=60).read()
ALL = json.loads(get('https://api.polyhaven.com/assets?t=textures'))
print('catalog', len(ALL))
WANT = {
 'grass':  (['aerial_grass_rock', 'grass_path_2', 'forrest_ground_01', 'leafy_grass', 'sparse_grass'], ['grass']),
 'dirt':   (['brown_mud_leaves_01', 'forest_ground_04', 'forrest_ground_03', 'dirt_floor', 'brown_mud_03', 'dirt'], ['dirt', 'soil', 'mud']),
 'sand':   (['aerial_beach_01', 'coast_sand_01', 'sand_01', 'aerial_sand', 'sandy_gravel_02'], ['sand']),
 'rock':   (['rock_face', 'rock_boulder_dry', 'rock_06', 'rock_wall_08', 'cliff_side', 'mossy_rock'], ['rock', 'cliff']),
 'bark':   (['bark_brown_02', 'bark_brown_01', 'pine_bark', 'bark_willow', 'tree_bark_03'], ['bark']),
 'wood':   (['weathered_brown_planks', 'wood_planks', 'brown_planks_03', 'old_wood_floor', 'planks_brown_10', 'wood_table_001'], ['planks', 'wood']),
 'metal':  (['rusty_metal_02', 'metal_plate', 'rust_coarse_01', 'blue_metal_plate', 'corrugated_iron'], ['metal']),
 'fabric': (['denim_fabric', 'fabric_pattern_07', 'rough_linen', 'cotton_jersey', 'hessian_230'], ['fabric', 'cloth']),
 'leather':(['leather_white', 'brown_leather', 'leather_red_02', 'fabric_leather_02'], ['leather']),
 'stonewall':(['castle_brick_02_red', 'stone_wall', 'medieval_blocks_02', 'rock_wall_10', 'castle_wall_slates'], ['stone', 'wall']),
}
chosen = {}
for layer, (ids, tags) in WANT.items():
    pick = next((i for i in ids if i in ALL), None)
    if not pick:
        c = [k for k, v in ALL.items() if any(t in (v.get('tags') or []) + (v.get('categories') or []) for t in tags)]
        c.sort(key=lambda k: -ALL[k].get('download_count', 0)); pick = c[0] if c else None
    if not pick: print(layer, 'NO MATCH'); continue
    F = json.loads(get('https://api.polyhaven.com/files/' + pick))
    d = os.path.join(OUT, layer); os.makedirs(d, exist_ok=True); got = {}
    for want, keys in (('diff', ['Diffuse', 'diff', 'Color']), ('nor', ['nor_gl']), ('rough', ['Rough', 'rough']), ('ao', ['AO', 'ao']), ('arm', ['arm'])):
        k = next((x for x in keys if x in F), None)
        if not k: continue
        e = F[k].get('2k', {}).get('jpg') or F[k].get('1k', {}).get('jpg')
        if not e: continue
        p = os.path.join(d, want + '.jpg')
        if not os.path.exists(p) or os.path.getsize(p) != e.get('size', -1): open(p, 'wb').write(get(e['url']))
        got[want] = os.path.getsize(p)
    chosen[layer] = {'id': pick, 'name': ALL[pick].get('name'), 'authors': list((ALL[pick].get('authors') or {}).keys()), 'files': got, 'keys': list(F.keys())[:12]}
    print(layer, pick, got)
json.dump({'source': 'https://polyhaven.com', 'license': 'CC0 1.0', 'layers': chosen}, open(os.path.join(OUT, 'sources.json'), 'w'), indent=1)
print('total MB', round(sum(sum(v['files'].values()) for v in chosen.values()) / 1e6, 1))
