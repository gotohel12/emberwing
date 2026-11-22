#!/usr/bin/env python3
"""Add every part of a pack written by arvex_v25.py to arvex_models.bin. Parts with the same name are replaced, everything
else in the base file is kept as it is; new colour slots and emissive values are added to the header.
usage: merge_pack.py <models.bin> <pack.bin> <out.bin>"""
import sys, json, struct
src, pack, dst = sys.argv[1:4]
def read(path):
    b = open(path, 'rb').read(); assert b[:4] == b'ARVX', path
    hl = struct.unpack('<I', b[4:8])[0]; H = json.loads(b[8:8 + hl]); T = H['total']; fo = 8 + hl
    F, AO = b[fo:fo + T * 24], b[fo + T * 25:fo + T * 26]; parts = {}; at = 0
    for name, segs in H['parts'].items():
        n = sum(c for _, c in segs); parts[name] = (segs, F[at * 24:(at + n) * 24], AO[at:at + n]); at += n
    assert at == T, (path, at, T)
    return H, parts
H, parts = read(src); PH, pparts = read(pack)
added, replaced = [], []
for name, v in pparts.items():
    (replaced if name in parts else added).append(name); parts[name] = v
for s, c in PH['slots'].items():
    if s not in H['slots']: H['slots'][s] = c
order = H.get('slotOrder') or list(H['slots'].keys())
for s in PH.get('slotOrder', []):
    if s not in order: order.append(s)
H['slotOrder'] = order; H.setdefault('emissive', {}).update(PH.get('emissive', {}))
H['parts'] = {k: v[0] for k, v in parts.items()}; H['total'] = sum(len(v[2]) for v in parts.values()); H['v25'] = 1
head = json.dumps(H, separators=(',', ':')).encode(); head += b' ' * ((4 - len(head) % 4) % 4)
with open(dst, 'wb') as f:
    f.write(b'ARVX'); f.write(struct.pack('<I', len(head))); f.write(head)
    f.write(b''.join(v[1] for v in parts.values())); f.write(bytes(H['total'])); f.write(b''.join(v[2] for v in parts.values()))
print('merged: %d parts added, %d replaced · %d parts, %d vertices in %s' % (len(added), len(replaced), len(parts), H['total'], dst))
