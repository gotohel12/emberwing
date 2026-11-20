#!/usr/bin/env python3
"""Replace (or add) one part of arvex_models.bin with a part exported on its own (e.g. out/fp_arm.bin from fp_arm_export.py).
usage: merge_part.py <models.bin> <part.bin> <out.bin>"""
import sys, json, struct
src, part, dst = sys.argv[1:4]
b = open(src, 'rb').read(); assert b[:4] == b'ARVX'; hl = struct.unpack('<I', b[4:8])[0]; H = json.loads(b[8:8 + hl]); T = H['total']; fo = 8 + hl
F, SL, AO = b[fo:fo + T * 24], b[fo + T * 24:fo + T * 25], b[fo + T * 25:fo + T * 26]
p = open(part, 'rb').read(); pl = struct.unpack('<I', p[:4])[0]; PH = json.loads(p[4:4 + pl]); n = PH['total']; pf, pao = p[4 + pl:4 + pl + n * 24], p[4 + pl + n * 24:4 + pl + n * 25]
order = H.get('slotOrder') or list(H['slots'].keys()); psl = b''.join(bytes([order.index(s)]) * c for s, c in PH['segs'])
parts = {}; at = 0
for name, segs in H['parts'].items():
    cnt = sum(c for _, c in segs); parts[name] = (segs, F[at * 24:(at + cnt) * 24], SL[at:at + cnt], AO[at:at + cnt]); at += cnt
parts[PH['part']] = (PH['segs'], pf, psl, pao)
H['parts'] = {k: v[0] for k, v in parts.items()}; H['total'] = sum(len(v[3]) for v in parts.values())
for k, v in PH.items():
    if k not in ('part', 'segs', 'total', 'tris'): H[k] = v
head = json.dumps(H, separators=(',', ':')).encode(); head += b' ' * ((4 - len(head) % 4) % 4)
with open(dst, 'wb') as f:
    f.write(b'ARVX'); f.write(struct.pack('<I', len(head))); f.write(head)
    for i in (1, 2, 3): f.write(b''.join(v[i] for v in parts.values()))
print(PH['part'], 'merged:', n, 'vertices ·', 'file', H['total'], 'vertices ·', {k: H[k] for k in H if k not in ('parts', 'slots', 'slotOrder', 'emissive', 'rig')})
