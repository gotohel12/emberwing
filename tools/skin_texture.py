#!/usr/bin/env python3
"""Generates public/textures/{1k,2k}/skin_d.jpg and skin_n.jpg: tileable skin detail (pores and fine creases).
skin_n stores the normal's X/Y in red/green and roughness in blue, like the photographed layers. Needs numpy + Pillow."""
import numpy as np
from PIL import Image
def tile_noise(n, f, seed):
    g = np.random.RandomState(seed).rand(f, f); x = np.linspace(0, f, n, endpoint=False); xi = x.astype(int); xf = x - xi; s = xf * xf * (3 - 2 * xf)
    a = g[np.ix_(xi % f, xi % f)]; b = g[np.ix_(xi % f, (xi + 1) % f)]; c = g[np.ix_((xi + 1) % f, xi % f)]; d = g[np.ix_((xi + 1) % f, (xi + 1) % f)]
    sx = s[None, :]; sy = s[:, None]; return (a * (1 - sx) + b * sx) * (1 - sy) + (c * (1 - sx) + d * sx) * sy
def cells(n, k, seed):
    pts = np.random.RandomState(seed).rand(k * k, 2); pts = (pts + np.stack(np.meshgrid(np.arange(k), np.arange(k)), -1).reshape(-1, 2)) / k
    y, x = np.mgrid[0:n, 0:n] / n; d1 = np.full((n, n), 9.0); d2 = np.full((n, n), 9.0)
    for p in pts:
        dx = np.abs(x - p[0]); dx = np.minimum(dx, 1 - dx); dy = np.abs(y - p[1]); dy = np.minimum(dy, 1 - dy); d = np.hypot(dx, dy)
        m = d < d1; d2 = np.where(m, d1, np.minimum(d2, d)); d1 = np.where(m, d, d1)
    return d1 * k, (d2 - d1) * k
N = 512
d1, edge = cells(N, 34, 3); crease = 1 - np.clip(edge * 3.2, 0, 1); pores = np.clip(1 - d1 * 2.6, 0, 1) ** 3
h = -0.55 * crease ** 2 - 0.35 * pores + 0.25 * tile_noise(N, 16, 1) + 0.12 * tile_noise(N, 64, 2)
gy = np.gradient(np.concatenate([h[-2:], h, h[:2]], 0), axis=0)[2:-2]; gx = np.gradient(np.concatenate([h[:, -2:], h, h[:, :2]], 1), axis=1)[:, 2:-2]
rough = np.clip(0.52 + 0.16 * crease - 0.12 * pores + 0.1 * (tile_noise(N, 8, 5) - 0.5), 0, 1)
nrm = np.stack([np.clip(-gx * 2.2, -1, 1) * 0.5 + 0.5, np.clip(-gy * 2.2, -1, 1) * 0.5 + 0.5, rough], -1)
mot = 0.5 * tile_noise(N, 6, 7) + 0.3 * tile_noise(N, 20, 8) + 0.2 * tile_noise(N, 70, 9)
base, red, pale = np.array([0.80, 0.60, 0.50]), np.array([0.82, 0.50, 0.42]), np.array([0.86, 0.69, 0.58])
alb = base + (red - base) * np.clip((mot - 0.5) * 2.2, 0, 1)[..., None] + (pale - base) * np.clip((0.5 - mot) * 2.2, 0, 1)[..., None]
alb = alb * (1 - 0.10 * crease[..., None]) * (1 - 0.06 * pores[..., None])
for n, out in ((1024, '1k'), (2048, '2k')):
    Image.fromarray((np.clip(alb, 0, 1) * 255).astype('uint8')).resize((n, n), Image.LANCZOS).save(f'public/textures/{out}/skin_d.jpg', quality=88)
    Image.fromarray((np.clip(nrm, 0, 1) * 255).astype('uint8')).resize((n, n), Image.LANCZOS).save(f'public/textures/{out}/skin_n.jpg', quality=92, subsampling=0)
