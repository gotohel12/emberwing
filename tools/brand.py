#!/usr/bin/env python3
"""ARVEX SURVIVAL — brand generator.
One source of truth for the identity: every asset (logo, line, banners, PFP, icons)
is generated from the same glyph geometry and palette, then rendered to PNG.
Run: python3 tools/brand.py   (needs rsvg-convert + the ARVEX fonts installed)
"""
import math, os, random, subprocess

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'brand')
PUB = os.path.join(ROOT, 'public', 'brand')
ICONS = os.path.join(ROOT, 'public', 'icons')
for d in (OUT, PUB, ICONS):
    os.makedirs(d, exist_ok=True)

# ---------------------------------------------------------------- palette (mirrors public/arvex.css)
C = dict(
    coal='#0D0F12', basalt='#15181C', slate='#1E2227', ridge='#2C3238', steel='#4A525B',
    bone='#ECE6DA', fog='#98A1AA', signal='#FF5A1F', signal_hi='#FF7A3D', signal_lo='#C23E10',
    amber='#F2B33D', lichen='#9DBE5C', frost='#7FB7D9',
)

# ---------------------------------------------------------------- glyphs (cap height 100, stroke 20)
# The A and V mirror each other; both carry the "camp" notch — the core of the mark.
G = {
    'A': (96, [[(0, 100), (38, 0), (58, 0), (96, 100), (74, 100), (48, 31), (22, 100)],
               [(37, 100), (48, 71), (59, 100)]]),
    'R': (80, [[(0, 12), (12, 0), (60, 0), (80, 20), (80, 46), (64, 61), (82, 100), (59, 100), (43, 64), (20, 64), (20, 100), (0, 100)],
               [(20, 18), (54, 18), (60, 24), (60, 41), (54, 46), (20, 46)]]),
    'V': (96, [[(0, 0), (22, 0), (48, 69), (74, 0), (96, 0), (58, 100), (38, 100)],
               [(37, 0), (48, 29), (59, 0)]]),
    'E': (68, [[(0, 12), (12, 0), (68, 0), (68, 18), (20, 18), (20, 41), (58, 41), (58, 59), (20, 59), (20, 82), (68, 82), (68, 100), (0, 100)]]),
    'X': (94, [[(0, 0), (24, 0), (47, 34), (70, 0), (94, 0), (59, 50), (94, 100), (70, 100), (47, 66), (24, 100), (0, 100), (35, 50)]]),
}
TRACK = 13


def poly(pts, dx=0, dy=0, s=1.0):
    return 'M' + ' L'.join(f'{dx + x * s:.2f},{dy + y * s:.2f}' for x, y in pts) + ' Z'


def wordmark_path(x, y, h, text='ARVEX'):
    """returns (svg path d, width) for the wordmark at cap height h"""
    s = h / 100.0
    d, cx = [], x
    for i, ch in enumerate(text):
        w, polys = G[ch]
        # the counter-shapes (2nd polygon of A/V/R) are cut out using evenodd
        d.append(' '.join(poly(p, cx, y, s) for p in polys))
        cx += (w + (TRACK if i < len(text) - 1 else 0)) * s
    return ' '.join(d), cx - x


def mark_path(cx, cy, size):
    """the ARVEX mark: peak-A with camp notch over a horizon bar. size = overall height"""
    s = size / 132.0
    ox, oy = cx - 60 * s, cy - 66 * s
    peak = [(0, 100), (47, 0), (73, 0), (120, 100), (93, 100), (60, 30), (27, 100)]
    camp = [(46, 100), (60, 70), (74, 100)]
    horizon_l = [(0, 112), (52, 112), (48, 120), (0, 120)]
    horizon_r = [(68, 112), (120, 112), (120, 120), (72, 120)]
    ember = [(57, 126), (60, 122), (63, 126), (60, 132)]
    return ' '.join(poly(p, ox, oy, s) for p in (peak, camp)), ' '.join(poly(p, ox, oy, s) for p in (horizon_l, horizon_r)), poly(ember, ox, oy, s)


def svg(w, h, body, defs=''):
    return (f'<svg xmlns="http://www.w3.org/2000/svg" width="{w}" height="{h}" viewBox="0 0 {w} {h}">'
            f'<defs>{defs}</defs>{body}</svg>')


def write(name, content, png=None, pub=False):
    p = os.path.join(OUT, name + '.svg')
    with open(p, 'w') as f:
        f.write(content)
    if png:
        for (pw, suffix) in png:
            o = os.path.join(OUT, f'{name}{suffix}.png')
            subprocess.run(['rsvg-convert', '-w', str(pw), '-o', o, p], check=True)
    if pub:
        with open(os.path.join(PUB, name + '.svg'), 'w') as f:
            f.write(content)


# ---------------------------------------------------------------- shared textures / gradients
def grain_defs(id_='grain', op=0.07):
    return (f'<filter id="{id_}" x="0" y="0" width="100%" height="100%">'
            f'<feTurbulence type="fractalNoise" baseFrequency=".9" numOctaves="2" seed="7" result="n"/>'
            f'<feColorMatrix type="saturate" values="0"/>'
            f'<feComponentTransfer><feFuncA type="table" tableValues="0 {op}"/></feComponentTransfer>'
            f'<feComposite in2="SourceGraphic" operator="in"/></filter>')


def signal_grad(id_='sig'):
    return (f'<linearGradient id="{id_}" x1="0" y1="0" x2="0" y2="1">'
            f'<stop offset="0" stop-color="{C["signal_hi"]}"/><stop offset="1" stop-color="{C["signal_lo"]}"/></linearGradient>')


# ---------------------------------------------------------------- terrain silhouettes (procedural)
def ridge(w, base, amp, seed, rough=0.55, step=6):
    rnd = random.Random(seed)
    oct_ = [(rnd.random() * 1000, rnd.random() * 1000) for _ in range(6)]

    def n(x):
        v, a, f = 0, 1, 1 / 380
        for k in range(6):
            ph, _ = oct_[k]
            v += a * (math.sin(x * f * 6.283 + ph) * 0.6 + math.sin(x * f * 13.1 + ph * 1.7) * 0.4)
            a *= rough
            f *= 2.1
        return v

    pts = [(x, base - amp * (0.5 + 0.5 * n(x))) for x in range(0, w + step, step)]
    return pts


def ridge_path(pts, w, h):
    return 'M0,' + str(h) + ' ' + ' '.join(f'L{x:.1f},{y:.1f}' for x, y in pts) + f' L{w},{h} Z'


def pines(w, h, base_fn, count, hmin, hmax, seed, color):
    rnd = random.Random(seed)
    out = []
    for _ in range(count):
        x = rnd.random() * w
        y = base_fn(x) + rnd.random() * 6
        th = rnd.uniform(hmin, hmax)
        tw = th * rnd.uniform(0.26, 0.34)
        tiers = rnd.randint(4, 6)
        d = []
        for t in range(tiers):
            k0 = t / tiers
            ty = y - th * (0.12 + 0.88 * k0)
            bw = tw * (1 - k0 * 0.78)
            top = y - th * (0.12 + 0.88 * (k0 + 1.35 / tiers))
            d.append(f'M{x - bw:.1f},{ty:.1f} L{x:.1f},{max(top, y - th):.1f} L{x + bw:.1f},{ty:.1f} Z')
        d.append(f'M{x - th * 0.03:.1f},{y:.1f} L{x - th * 0.03:.1f},{y - th * 0.15:.1f} L{x + th * 0.03:.1f},{y - th * 0.15:.1f} L{x + th * 0.03:.1f},{y:.1f} Z')
        out.append(' '.join(d))
    return f'<path d="{" ".join(out)}" fill="{color}"/>'


def interp(pts):
    def f(x):
        i = int(x // (pts[1][0] - pts[0][0]))
        i = max(0, min(len(pts) - 2, i))
        (x0, y0), (x1, y1) = pts[i], pts[i + 1]
        t = (x - x0) / (x1 - x0) if x1 != x0 else 0
        return y0 + (y1 - y0) * t
    return f


def landscape(w, h, seed=11, sun=(0.72, 0.52)):
    """layered dusk landscape: sky, low sun, 4 mountain ranges, pine forest, fog, embers"""
    defs = (f'<linearGradient id="sky" x1="0" y1="0" x2="0" y2="1">'
            f'<stop offset="0" stop-color="#0B0E12"/><stop offset=".45" stop-color="#1A1B1F"/>'
            f'<stop offset=".72" stop-color="#3A2418"/><stop offset="1" stop-color="#6B2E14"/></linearGradient>'
            f'<radialGradient id="sun" cx="{sun[0]}" cy="{sun[1]}" r=".5">'
            f'<stop offset="0" stop-color="#FFB27A" stop-opacity=".95"/><stop offset=".08" stop-color="#FF7A3D" stop-opacity=".55"/>'
            f'<stop offset=".35" stop-color="#C23E10" stop-opacity=".16"/><stop offset="1" stop-color="#000" stop-opacity="0"/></radialGradient>'
            f'<linearGradient id="fog" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#C9A58A" stop-opacity="0"/>'
            f'<stop offset="1" stop-color="#C9A58A" stop-opacity=".22"/></linearGradient>'
            f'<linearGradient id="floor" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#0D0F12" stop-opacity="0"/>'
            f'<stop offset="1" stop-color="#0D0F12" stop-opacity=".95"/></linearGradient>'
            + grain_defs('grain', 0.09))
    body = [f'<rect width="{w}" height="{h}" fill="url(#sky)"/>', f'<rect width="{w}" height="{h}" fill="url(#sun)"/>']
    sx, sy = sun[0] * w, sun[1] * h
    body.append(f'<circle cx="{sx:.0f}" cy="{sy:.0f}" r="{h * 0.045:.0f}" fill="#FFD2A8" opacity=".9"/>')
    layers = [(0.60, 0.20, '#3B2A22', 0.9), (0.70, 0.18, '#2A211D', 1.0), (0.80, 0.14, '#1C1816', 1.0), (0.90, 0.10, '#121112', 1.0)]
    for i, (b, a, col, op) in enumerate(layers):
        pts = ridge(w, h * b, h * a, seed + i * 17, 0.5 + i * 0.03)
        body.append(f'<path d="{ridge_path(pts, w, h)}" fill="{col}" opacity="{op}"/>')
        body.append(f'<rect x="0" y="{h * (b - a):.0f}" width="{w}" height="{h * a * 1.6:.0f}" fill="url(#fog)" opacity="{0.9 - i * 0.2:.2f}"/>')
        if i == 2:
            body.append(pines(w, h, interp(pts), int(w / 22), h * 0.06, h * 0.12, seed + 3, '#151314'))
        if i == 3:
            body.append(pines(w, h, interp(pts), int(w / 34), h * 0.14, h * 0.28, seed + 5, '#0B0B0C'))
    rnd = random.Random(seed + 99)
    emb = []
    for _ in range(int(w / 18)):
        x, y, r = rnd.random() * w, h * (0.35 + rnd.random() * 0.6), rnd.uniform(0.8, 2.6)
        emb.append(f'<circle cx="{x:.0f}" cy="{y:.0f}" r="{r:.1f}" fill="{C["signal_hi"]}" opacity="{rnd.uniform(.25, .85):.2f}"/>')
    body.append(''.join(emb))
    body.append(f'<rect width="{w}" height="{h}" fill="url(#floor)" opacity=".6"/>')
    body.append(f'<rect width="{w}" height="{h}" filter="url(#grain)"/>')
    return defs, ''.join(body)


# ================================================================= 1) LOGO
def logo_assets():
    defs = signal_grad()
    # horizontal lockup: mark + wordmark
    H = 100
    wd, ww = wordmark_path(200, 30, H)
    peak, hor, ember = mark_path(75, 80, 132)
    W = int(200 + ww + 30)
    div = f'<rect x="162" y="30" width="4" height="100" fill="{C["steel"]}" opacity=".55"/>'

    def lockup(fg, mark_fill, bg=None):
        b = f'<rect width="{W}" height="160" fill="{bg}"/>' if bg else ''
        return svg(W, 160, b + div + f'<path d="{peak}" fill="{mark_fill}" fill-rule="evenodd"/><path d="{hor}" fill="{fg}"/>'
                   f'<path d="{ember}" fill="{mark_fill}"/><path d="{wd}" fill="{fg}" fill-rule="evenodd"/>', defs)
    write('arvex-logo-dark', lockup(C['bone'], 'url(#sig)'), png=[(1600, ''), (800, '@800')], pub=True)
    write('arvex-logo-light', lockup(C['coal'], 'url(#sig)'), png=[(1600, ''), (800, '@800')], pub=True)
    write('arvex-logo-mono-white', lockup('#FFFFFF', '#FFFFFF'), png=[(1600, '')])
    write('arvex-logo-mono-black', lockup('#000000', '#000000'), png=[(1600, '')])

    # stacked: mark above wordmark + SURVIVAL
    wd2, ww2 = wordmark_path(0, 0, 100)
    SW = 760
    ox = (SW - ww2) / 2
    wd2, _ = wordmark_path(ox, 250, 100)
    peak2, hor2, ember2 = mark_path(SW / 2, 120, 190)
    st = (f'<path d="{peak2}" fill="url(#sig)" fill-rule="evenodd"/><path d="{hor2}" fill="{C["bone"]}"/><path d="{ember2}" fill="url(#sig)"/>'
          f'<path d="{wd2}" fill="{C["bone"]}" fill-rule="evenodd"/>'
          f'<text x="{SW / 2}" y="404" text-anchor="middle" font-family="Barlow Condensed" font-weight="600" font-size="44" letter-spacing="26" fill="{C["fog"]}">SURVIVAL</text>')
    write('arvex-logo-stacked', svg(SW, 430, st, defs), png=[(1520, ''), (760, '@760')], pub=True)

    # mark only
    pk, hr, em = mark_path(256, 256, 360)
    write('arvex-mark', svg(512, 512, f'<path d="{pk}" fill="url(#sig)" fill-rule="evenodd"/><path d="{hr}" fill="{C["bone"]}"/><path d="{em}" fill="url(#sig)"/>', defs),
          png=[(1024, ''), (256, '@256'), (64, '@64')], pub=True)


# ================================================================= 2) LINE
def line_asset():
    W, H = 1600, 48
    cx, cy = W / 2, H / 2
    defs = (f'<linearGradient id="lg" x1="0" x2="1"><stop offset="0" stop-color="{C["signal"]}" stop-opacity="0"/>'
            f'<stop offset=".18" stop-color="{C["steel"]}"/><stop offset=".5" stop-color="{C["bone"]}"/>'
            f'<stop offset=".82" stop-color="{C["steel"]}"/><stop offset="1" stop-color="{C["signal"]}" stop-opacity="0"/></linearGradient>' + signal_grad())
    s = 0.22
    peak = [(0, 100), (47, 0), (73, 0), (120, 100), (93, 100), (60, 30), (27, 100)]
    camp = [(46, 100), (60, 70), (74, 100)]
    gw = 120 * s
    mk = ' '.join(poly(p, cx - gw / 2, cy - 100 * s / 2 - 1, s) for p in (peak, camp))
    ticks = ''.join(f'<rect x="{cx + d - 1:.0f}" y="{cy - 4}" width="2" height="8" fill="{C["fog"]}" opacity=".7"/>' for d in (-80, -66, 66, 80))
    bars = (f'<rect x="0" y="{cy - 1}" width="{cx - 96}" height="2" fill="url(#lg)"/>'
            f'<rect x="{cx + 96}" y="{cy - 1}" width="{cx - 96}" height="2" fill="url(#lg)"/>'
            f'<path d="M{cx - 110},{cy} l8,-4 v8 Z M{cx + 110},{cy} l-8,-4 v8 Z" fill="{C["signal"]}"/>')
    write('arvex-line', svg(W, H, bars + ticks + f'<path d="{mk}" fill="url(#sig)" fill-rule="evenodd"/>', defs), png=[(1600, ''), (800, '@800')], pub=True)


# ================================================================= 3) MAIN BANNER  4) SUPPORT BANNER
def banner(name, W, H, title_sub, tagline, extra_right=None, sun=(0.72, 0.52), seed=11):
    defs, land = landscape(W, H, seed, sun)
    defs += signal_grad()
    defs += (f'<linearGradient id="shade" x1="0" x2="1"><stop offset="0" stop-color="#0D0F12" stop-opacity=".88"/>'
             f'<stop offset=".55" stop-color="#0D0F12" stop-opacity=".25"/><stop offset="1" stop-color="#0D0F12" stop-opacity="0"/></linearGradient>')
    k = H / 640
    mx = 120 * k
    cap = 150 * k
    wd, ww = wordmark_path(mx + 214 * k, H * 0.30, cap)
    pk, hr, em = mark_path(mx + 70 * k, H * 0.30 + cap * 0.62, 200 * k)
    lx = mx
    body = [land, f'<rect width="{W}" height="{H}" fill="url(#shade)"/>',
            f'<path d="{pk}" fill="url(#sig)" fill-rule="evenodd"/><path d="{hr}" fill="{C["bone"]}"/><path d="{em}" fill="url(#sig)"/>',
            f'<rect x="{mx + 174 * k:.0f}" y="{H * 0.30:.0f}" width="{5 * k:.1f}" height="{cap:.0f}" fill="{C["steel"]}" opacity=".6"/>',
            f'<path d="{wd}" fill="{C["bone"]}" fill-rule="evenodd"/>',
            f'<text x="{mx + 218 * k:.0f}" y="{H * 0.30 + cap + 70 * k:.0f}" font-family="Barlow Condensed" font-weight="600" font-size="{52 * k:.0f}" letter-spacing="{30 * k:.0f}" fill="{C["fog"]}">{title_sub}</text>',
            f'<rect x="{lx:.0f}" y="{H * 0.78:.0f}" width="{56 * k:.0f}" height="{4 * k:.1f}" fill="{C["signal"]}"/>',
            f'<text x="{lx:.0f}" y="{H * 0.78 + 46 * k:.0f}" font-family="Barlow Condensed" font-weight="600" font-size="{30 * k:.0f}" letter-spacing="{4 * k:.1f}" fill="{C["bone"]}">{tagline}</text>',
            f'<text x="{W - mx:.0f}" y="{H - 54 * k:.0f}" text-anchor="end" font-family="JetBrains Mono" font-weight="500" font-size="{22 * k:.0f}" letter-spacing="{1 * k:.1f}" fill="{C["fog"]}">discord.gg/arvex</text>']
    if extra_right:
        body.append(extra_right(W, H, k))
    write(name, svg(W, H, ''.join(body), defs), png=[(W, ''), (W // 2, '@half')], pub=True)


def support_badge(W, H, k):
    x, y = W - 120 * k, H * 0.30
    rows = ['TICKETS · BUGS · ACCOUNTS', 'VERIFY &amp; REPAIR HELP', 'STAFF ON DISCORD']
    out = [f'<g text-anchor="end" font-family="Barlow Condensed" font-weight="600">',
           f'<rect x="{x - 420 * k:.0f}" y="{y - 6 * k:.0f}" width="{420 * k:.0f}" height="{4 * k:.1f}" fill="{C["signal"]}"/>',
           f'<text x="{x:.0f}" y="{y + 70 * k:.0f}" font-size="{84 * k:.0f}" letter-spacing="{10 * k:.0f}" fill="{C["bone"]}">SUPPORT</text>']
    for i, r in enumerate(rows):
        out.append(f'<text x="{x:.0f}" y="{y + (130 + i * 40) * k:.0f}" font-size="{28 * k:.0f}" letter-spacing="{4 * k:.0f}" fill="{C["fog"]}">{r}</text>')
    out.append('</g>')
    return ''.join(out)


# ================================================================= 5) SERVER PFP + app icons
def pfp(name='arvex-server-pfp', S=1024, round_=False, pad=1.0):
    defs = signal_grad() + (f'<radialGradient id="glow" cx=".5" cy=".62" r=".6"><stop offset="0" stop-color="{C["signal"]}" stop-opacity=".34"/>'
                            f'<stop offset="1" stop-color="{C["signal"]}" stop-opacity="0"/></radialGradient>'
                            f'<linearGradient id="bg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#1A1E23"/><stop offset="1" stop-color="#0B0D10"/></linearGradient>'
                            + grain_defs('grain', 0.12))
    c = S * 0.09
    if round_:
        frame = f'<rect width="{S}" height="{S}" rx="{S * 0.22}" fill="url(#bg)"/>'
    else:
        frame = f'<path d="M{c},0 H{S - c} L{S},{c} V{S - c} L{S - c},{S} H{c} L0,{S - c} V{c} Z" fill="url(#bg)"/>'
    inset = S * 0.045
    ring = (f'<path d="M{c + inset * 0.6},{inset} H{S - c - inset * 0.6} L{S - inset},{c + inset * 0.6} V{S - c - inset * 0.6} L{S - c - inset * 0.6},{S - inset} '
            f'H{c + inset * 0.6} L{inset},{S - c - inset * 0.6} V{c + inset * 0.6} Z" fill="none" stroke="{C["ridge"]}" stroke-width="{S * 0.008}"/>') if not round_ else ''
    pk, hr, em = mark_path(S / 2, S * 0.49, S * 0.62 * pad)
    body = frame + f'<rect width="{S}" height="{S}" fill="url(#glow)"/>' + ring + \
        f'<path d="{pk}" fill="url(#sig)" fill-rule="evenodd"/><path d="{hr}" fill="{C["bone"]}"/><path d="{em}" fill="url(#sig)"/>' + \
        f'<rect width="{S}" height="{S}" filter="url(#grain)" opacity=".6"/>'
    write(name, svg(S, S, body, defs), png=[(S, ''), (512, '@512'), (128, '@128')], pub=True)
    return os.path.join(OUT, name + '.svg')


def app_icons():
    p = pfp('arvex-app-icon', 1024, round_=False)
    for size, fn in ((192, 'icon-192.png'), (512, 'icon-512.png'), (180, 'apple-touch-icon.png')):
        subprocess.run(['rsvg-convert', '-w', str(size), '-o', os.path.join(ICONS, fn), p], check=True)
    pm = pfp('arvex-maskable', 1024, round_=True, pad=0.78)
    subprocess.run(['rsvg-convert', '-w', '512', '-o', os.path.join(ICONS, 'maskable-512.png'), pm], check=True)
    # Windows .ico for the launcher
    sizes = []
    for s in (16, 24, 32, 48, 64, 128, 256):
        o = f'/tmp/arvex-ico-{s}.png'
        subprocess.run(['rsvg-convert', '-w', str(s), '-o', o, p], check=True)
        sizes.append(o)
    subprocess.run(['convert', *sizes, os.path.join(ROOT, 'launcher', 'arvex.ico')], check=True)


if __name__ == '__main__':
    os.makedirs(os.path.join(ROOT, 'launcher'), exist_ok=True)
    logo_assets()
    line_asset()
    banner('arvex-main-banner', 1920, 640, 'SURVIVAL', 'GATHER · CRAFT · BUILD · SURVIVE')
    banner('arvex-discord-banner', 1920, 1080, 'SURVIVAL', 'GATHER · CRAFT · BUILD · SURVIVE', sun=(0.74, 0.5), seed=23)
    banner('arvex-support-banner', 1920, 640, 'SURVIVAL', 'WE ARE HERE TO HELP', extra_right=support_badge, sun=(0.42, 0.56), seed=31)
    # clean key-art background (no text) for heroes in the launcher and game
    d, body = landscape(1920, 800, 17, (0.7, 0.5))
    write('arvex-hero', svg(1920, 800, body, d), png=[(1920, '')], pub=True)
    pfp()
    app_icons()
    print('brand assets written to', OUT)
