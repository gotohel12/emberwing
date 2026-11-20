#!/usr/bin/env python3
"""Generates public/textures/foliage.png: the alpha-cut foliage atlas (2048², four 1024² tiles).
  top-left: broadleaf cluster (oak) · top-right: small-leaf cluster (birch) · bottom-left: conifer branch · bottom-right: grass tuft
Colour is a neutral multiplier (the game tints it with each tree's own green). Needs Pillow + numpy."""
import math, random
import numpy as np
from PIL import Image, ImageDraw, ImageFilter
S = 2048           # supersampled tile (final tile is 1024)
def leaf(d, x, y, ang, L, W, shade, lobes=0, rnd=random):
    ca, sa = math.cos(ang), math.sin(ang); pts_l, pts_r = [], []
    for i in range(13):
        t = i / 12; w = W * (math.sin(math.pi * t) ** 0.75) * (1 - 0.35 * t)
        if lobes: w *= 1 + 0.22 * math.sin(t * math.pi * lobes) * (1 if i % 2 else -0.4)
        px, py = x + ca * L * t, y + sa * L * t; pts_l.append((px - sa * w, py + ca * w)); pts_r.append((px + sa * w, py - ca * w))
    hue = rnd.uniform(-1, 1); base = np.array([shade + hue * 0.035, shade + 0.03, shade - 0.05 - hue * 0.03])
    col = lambda k: tuple(int(max(0, min(1, c * k)) * 255) for c in base) + (255,)
    d.polygon(pts_l + pts_r[::-1], fill=col(1.0)); d.polygon(pts_r + [(x, y), (x + ca * L, y + sa * L)][::-1], fill=col(0.86))
    d.line([(x, y), (x + ca * L * 0.96, y + sa * L * 0.96)], fill=col(1.22), width=max(2, int(W * 0.09)))
    for k in range(2, 11, 2):
        t = k / 12; px, py = x + ca * L * t, y + sa * L * t; w = W * 0.8 * math.sin(math.pi * t)
        for sgn in (1, -1): d.line([(px, py), (px + ca * L * 0.1 - sa * w * sgn, py + sa * L * 0.1 + ca * w * sgn)], fill=col(1.1), width=2)
def twig(d, p0, p1, w, col=(86, 74, 60, 255)): d.line([p0, p1], fill=col, width=max(2, int(w)))
def cluster(seed, n_twigs, leaf_len, leaf_w, per_twig, lobes, shade=(0.5, 0.72)):
    rnd = random.Random(seed); im = Image.new('RGBA', (S, S), (0, 0, 0, 0)); d = ImageDraw.Draw(im); c = S / 2; items = []
    for k in range(n_twigs):
        a = k / n_twigs * math.tau + rnd.uniform(-0.25, 0.25); Lt = S * rnd.uniform(0.3, 0.4); prev = (c, c)
        for j in range(1, per_twig + 1):
            t = j / per_twig; a2 = a + math.sin(t * 2.2 + k) * 0.25; p = (c + math.cos(a2) * Lt * t, c + math.sin(a2) * Lt * t); twig(d, prev, p, S * 0.008 * (1.15 - t)); prev = p
            for sgn in (1, -1):
                la = a2 + sgn * rnd.uniform(0.55, 1.15); items.append((rnd.random(), p[0], p[1], la, S * leaf_len * rnd.uniform(0.8, 1.2), S * leaf_w * rnd.uniform(0.8, 1.15), rnd.uniform(*shade)))
        items.append((rnd.random(), prev[0], prev[1], a, S * leaf_len * 1.1, S * leaf_w, rnd.uniform(*shade)))
    for _, x, y, la, L, W, sh in sorted(items): leaf(d, x, y, la, L, W, sh, lobes, rnd)
    return im
def conifer(seed):
    rnd = random.Random(seed); im = Image.new('RGBA', (S, S), (0, 0, 0, 0)); d = ImageDraw.Draw(im)
    def needles(p0, p1, n, ln):
        ax, ay = p1[0] - p0[0], p1[1] - p0[1]; L = math.hypot(ax, ay); a = math.atan2(ay, ax)
        for i in range(n):
            t = rnd.random(); x, y = p0[0] + ax * t, p0[1] + ay * t; sgn = rnd.choice((1, -1)); na = a + sgn * rnd.uniform(0.5, 1.05); l = ln * rnd.uniform(0.7, 1.15) * (1 - 0.35 * t)
            v = rnd.uniform(0.42, 0.78); col = (int(255 * (v - 0.04)), int(255 * v), int(255 * (v - 0.1)), 255)
            d.line([(x, y), (x + math.cos(na) * l, y + math.sin(na) * l)], fill=col, width=rnd.choice((3, 4, 4, 5)))
    def branch(p0, a, L, depth):
        p1 = (p0[0] + math.cos(a) * L, p0[1] + math.sin(a) * L); twig(d, p0, p1, S * 0.007 * (depth + 1), (70, 58, 46, 255))
        if depth:
            k = 7 if depth == 2 else 4
            for j in range(1, k + 1):
                t = j / (k + 0.6); q = (p0[0] + (p1[0] - p0[0]) * t, p0[1] + (p1[1] - p0[1]) * t)
                for sgn in (1, -1): branch(q, a + sgn * rnd.uniform(0.6, 0.85), L * (0.52 if depth == 2 else 0.4) * (1.05 - t * 0.55), depth - 1)
        needles(p0, p1, int(L / S * (900 if depth == 0 else 520)), S * 0.03)
    branch((S * 0.5, S * 0.985), -math.pi / 2, S * 0.93, 2); return im
def grass(seed):
    rnd = random.Random(seed); im = Image.new('RGBA', (S, S), (0, 0, 0, 0)); d = ImageDraw.Draw(im); blades = []
    for i in range(64):
        x0 = S * (0.5 + rnd.gauss(0, 0.13)); h = S * rnd.uniform(0.45, 0.95) * (1 - min(0.5, abs(x0 / S - 0.5) * 1.1)); lean = rnd.gauss(0, 0.2) + (x0 / S - 0.5) * 1.3; w = S * rnd.uniform(0.012, 0.024); blades.append((h, x0, lean, w))
    for h, x0, lean, w in sorted(blades):
        L, Rr = [], []; v = rnd.uniform(0.5, 0.74)
        for j in range(11):
            t = j / 10; x = x0 + lean * h * t * t; y = S * 0.99 - h * t; ww = w * (1 - t) ** 0.7; L.append((x - ww, y)); Rr.append((x + ww, y))
        g = lambda k: (int(255 * min(1, v * k - 0.03)), int(255 * min(1, v * k + 0.02)), int(255 * min(1, v * k - 0.09)), 255)
        d.polygon(L + Rr[::-1], fill=g(1.0)); d.polygon([L[0]] + [((a[0] + b[0]) / 2, a[1]) for a, b in zip(L, Rr)][1:] + L[::-1][:-1], fill=g(0.84))
    return im
def finish(im):
    im = im.resize((S // 2, S // 2), Image.LANCZOS); a = np.asarray(im).astype(np.float32) / 255; al = a[..., 3:4]
    mean = (a[..., :3] * al).sum((0, 1)) / max(al.sum(), 1e-6)                       # colour under transparent texels = average, so mip-maps do not darken the edges
    blur = np.asarray(im.filter(ImageFilter.GaussianBlur(6))).astype(np.float32) / 255; bl = blur[..., :3] / np.maximum(blur[..., 3:4], 1e-3)
    rgb = np.where(al > 0.02, a[..., :3], np.where(blur[..., 3:4] > 0.01, bl, mean))
    return Image.fromarray((np.clip(np.concatenate([rgb, al], -1), 0, 1) * 255).astype('uint8'), 'RGBA')
atlas = Image.new('RGBA', (2048, 2048), (0, 0, 0, 0))
for tile, pos in ((cluster(11, 7, 0.155, 0.048, 5, 5), (0, 0)), (cluster(23, 9, 0.085, 0.034, 7, 0, (0.55, 0.78)), (1024, 0)), (conifer(5), (0, 1024)), (grass(9), (1024, 1024))): atlas.paste(finish(tile), pos)
atlas.save('public/textures/foliage.png', optimize=True); atlas.resize((1024, 1024), Image.LANCZOS).save('/tmp/foliage_preview.png')
print('foliage.png written')
