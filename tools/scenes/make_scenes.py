#!/usr/bin/env python3
"""
Genesis Studio — procedural scene library generator (M4).

Writes, for every scene:
  assets/environments/scene-<id>.jpg      (1280x720, the picture; same naming convention the render worker already loads)
  assets/scenes/<id>/scene.json           (metadata, see docs/SCENE_FORMAT.md)
and the combined, synchronous-loading library:
  js/providers/scene-library.js           (window.VS.SCENE_LIBRARY, identical content to the scene.json files)

HONEST NOTE: these are stylised, procedurally drawn rooms made for the desk occluder (desk in the foreground,
empty chair, clear space behind, known light). They are NOT photographs. They are original work (no third-party
assets, no AI generator terms to worry about). Photoreal packs can replace them later by shipping the same
scene.json + a jpg.

Run:  python3 tools/scenes/make_scenes.py   (from the project root)
Deterministic: the same seed gives the same files.
"""
import json, math, os, sys
import numpy as np
from PIL import Image, ImageDraw, ImageFilter

W, H = 1280, 720
ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
rng = np.random.default_rng(1307)

def hexc(h):
    h = h.lstrip('#'); return tuple(int(h[i:i+2], 16) for i in (0, 2, 4))

def arr(img): return np.asarray(img, dtype=np.float32)
def img_from(a): return Image.fromarray(np.clip(a, 0, 255).astype(np.uint8), 'RGB')

def vgrad(top, bot, w=W, h=H):
    t = np.linspace(0, 1, h, dtype=np.float32)[:, None, None]
    a = np.array(top, np.float32)[None, None, :] * (1 - t) + np.array(bot, np.float32)[None, None, :] * t
    return np.repeat(a, w, axis=1)

def glow(a, cx, cy, rx, ry, color, amt):
    ys, xs = np.mgrid[0:a.shape[0], 0:a.shape[1]].astype(np.float32)
    d = ((xs - cx) / rx) ** 2 + ((ys - cy) / ry) ** 2
    m = np.exp(-d * 2.2)[:, :, None]
    a += m * amt * np.array(color, np.float32)[None, None, :]
    return a

def side_light(a, side, strength=0.22, tint=(255, 235, 210)):
    """Brighten the key side of the picture so the measured light direction is real, not just claimed."""
    x = np.linspace(-1, 1, a.shape[1], dtype=np.float32)[None, :, None]
    k = (1 + side * x * strength)
    a *= k
    a += np.clip(side * x, 0, 1) * 10 * np.array(tint, np.float32)[None, None, :] / 255.0
    return a

def blur(img, r): return img.filter(ImageFilter.GaussianBlur(r)) if r > 0 else img

def shape_layer(draw_fn, r=0):
    L = Image.new('RGBA', (W, H), (0, 0, 0, 0)); d = ImageDraw.Draw(L); draw_fn(d)
    return blur(L, r) if r else L

def paste(base, layer): base.paste(layer, (0, 0), layer); return base

def desk_y(x01, s): return s['y'] + s['tilt'] * x01 + s['bow'] * 4 * x01 * (1 - x01)

def draw_desk(img, desk, top_col, front_col, edge_col, gloss=0.18, ambient=(0, 0, 0)):
    """Desk in the foreground. Its BACK edge follows exactly the curve written to scene.json."""
    d = ImageDraw.Draw(img, 'RGBA')
    xs = list(range(0, W + 1, 8))
    back = [(x, desk_y(x / W, desk) * H) for x in xs]
    depth = 0.075 * H
    front = [(x, y + depth) for x, y in back]
    # surface (top)
    top_poly = back + front[::-1]
    # gradient on the surface: lighter at the back edge
    surf = Image.new('RGB', (W, H), top_col)
    sa = arr(surf)
    yy = np.arange(H, dtype=np.float32)[:, None]
    yb = np.array([desk_y(x / W, desk) * H for x in range(W)], np.float32)[None, :]
    t = np.clip((yy - yb) / depth, 0, 1)[:, :, None]
    sa = sa * (1 + gloss * (1 - t) - 0.10 * t)
    sa += np.array(ambient, np.float32)[None, None, :] * 0.2
    mask = Image.new('L', (W, H), 0); ImageDraw.Draw(mask).polygon(top_poly, fill=255)
    img.paste(img_from(sa), (0, 0), mask)
    # front panel
    fpoly = front + [(W, H), (0, H)]
    fa = arr(Image.new('RGB', (W, H), front_col))
    tt = np.clip((yy - (yb + depth)) / (H - yb.min() - depth + 1), 0, 1)[:, :, None]
    fa = fa * (1 - 0.35 * tt)
    mask2 = Image.new('L', (W, H), 0); ImageDraw.Draw(mask2).polygon(fpoly, fill=255)
    img.paste(img_from(fa), (0, 0), mask2)
    # crisp back-edge highlight + front lip
    d.line(back, fill=edge_col + (255,), width=3)
    d.line(front, fill=tuple(min(255, c + 40) for c in edge_col) + (200,), width=2)
    return img

def draw_chair(img, cx, base_y, h, col, headrest=True, w=None):
    w = w or h * 0.85
    def f(d):
        d.rounded_rectangle([cx - w / 2, base_y - h, cx + w / 2, base_y + 8], radius=int(w * 0.28), fill=col + (255,))
        if headrest: d.rounded_rectangle([cx - w * 0.34, base_y - h - h * 0.12, cx + w * 0.34, base_y - h + 10], radius=int(w * 0.2), fill=col + (255,))
    paste(img, shape_layer(f, 2.6))

def make_foreground(sid, desk):
    """Optional foreground layer (RGBA PNG, same size as the picture): a potted plant and a mug standing on the desk, drawn in FRONT of the presenter."""
    L = Image.new('RGBA', (W, H), (0, 0, 0, 0)); d = ImageDraw.Draw(L)
    base = desk_y(0.1, desk) * H + 0.045 * H
    d.polygon([(70, base - 62), (150, base - 62), (140, base), (80, base)], fill=(168, 92, 62, 255))   # pot
    d.rectangle([66, base - 70, 154, base - 58], fill=(190, 108, 74, 255))
    for ang, ln in ((-60, 110), (-35, 140), (-10, 150), (15, 135), (40, 105), (-82, 80)):
        a = math.radians(ang - 90 + 90); cx, cy = 110, base - 70
        ex, ey = cx + ln * math.sin(math.radians(ang)), cy - ln * math.cos(math.radians(ang)) * 0.9
        d.line([(cx, cy), (ex, ey)], fill=(48, 110, 64, 255), width=5)
        d.ellipse([ex - 30, ey - 17, ex + 30, ey + 17], fill=(60 + int(abs(ang)) // 3, 140, 76, 255))
    d.rounded_rectangle([1130, base - 44, 1186, base + 4], radius=8, fill=(236, 236, 240, 255))            # mug
    d.arc([1176, base - 34, 1206, base - 6], -80, 80, fill=(236, 236, 240, 255), width=6)
    L = L.filter(ImageFilter.GaussianBlur(0.8))
    L.save(os.path.join(ROOT, 'assets', 'environments', f'scene-{sid}-fg.png'), optimize=True)

def finish(img, grain=3.2, seed=0):
    a = arr(img)
    r = np.random.default_rng(seed)
    n = r.normal(0, grain, (H, W, 1)).astype(np.float32)
    return img_from(a + n)

# ---------------------------------------------------------------- scene painters
def bokeh(a, pts, color, rad, amt):
    for (x, y, k) in pts: glow(a, x, y, rad * k, rad * k, color, amt * k)
    return a

def s_news(side):
    a = vgrad(hexc('#0b1424'), hexc('#142540'))
    a = glow(a, 640, 250, 520, 190, hexc('#2c5fb0'), 0.55)
    img = img_from(a); d = ImageDraw.Draw(img, 'RGBA')
    # video wall of panels
    for i in range(6):
        x0 = 150 + i * 168
        d.rectangle([x0, 120, x0 + 150, 330], fill=(18 + i * 4, 44 + i * 6, 96 + i * 8, 255), outline=(90, 150, 230, 255), width=2)
        d.rectangle([x0 + 10, 130, x0 + 140, 175], fill=(60, 120, 210, 220))
    img = blur(img, 3.2)
    return img, dict(chair=(640, 0.58, 190, hexc('#0a0d14')), desk=('#16202f', '#0e1522', '#7fb4ff'), amb=(20, 50, 110))

def s_podcast(side):
    a = vgrad(hexc('#2a1a14'), hexc('#3b261b'))
    img = img_from(a); d = ImageDraw.Draw(img, 'RGBA')
    for i in range(30):   # wood slats
        x = i * 44; d.rectangle([x, 0, x + 32, 470], fill=(120 + (i % 3) * 8, 78 + (i % 3) * 5, 46, 255))
    for i in range(5):    # acoustic panels
        d.rectangle([120 + i * 220, 90, 220 + i * 220, 250], fill=(52, 36, 48, 255))
    d.rounded_rectangle([470, 70, 810, 130], radius=20, outline=(255, 90, 160, 255), width=6)   # neon ring (no text)
    img = blur(img, 2.6)
    a = arr(img); a = glow(a, 640, 100, 260, 60, (255, 90, 160), 0.35); img = img_from(a)
    return img, dict(chair=(640, 0.60, 185, hexc('#1b1210')), desk=('#6a4a33', '#3a281c', '#d9a77a'), amb=(80, 40, 30))

def s_talkshow(side):
    a = vgrad(hexc('#1a1038'), hexc('#2a1a54'))
    img = img_from(a); d = ImageDraw.Draw(img, 'RGBA')
    d.rectangle([140, 90, 1140, 420], fill=(24, 22, 70, 255))                        # window panel
    pts = []
    x = 140
    while x < 1140:                                                                   # skyline
        w = int(rng.integers(30, 70)); h = int(rng.integers(60, 230))
        d.rectangle([x, 420 - h, x + w, 420], fill=(14 + int(rng.integers(0, 14)), 14, 46, 255))
        for _ in range(int(h / 22)):
            wx = x + int(rng.integers(4, max(5, w - 6))); wy = 420 - int(rng.integers(8, h))
            d.rectangle([wx, wy, wx + 3, wy + 4], fill=(255, 210, 120, 220))
        x += w + 4
    d.rectangle([140, 90, 1140, 420], outline=(150, 120, 230, 255), width=4)
    img = blur(img, 3.0)
    return img, dict(chair=(640, 0.60, 190, hexc('#150e2c')), desk=('#3d2f66', '#241a42', '#b69cff'), amb=(60, 40, 120))

def s_class(side):
    a = vgrad(hexc('#d8dccf'), hexc('#c4c8b8'))
    img = img_from(a); d = ImageDraw.Draw(img, 'RGBA')
    d.rectangle([260, 110, 1020, 380], fill=(36, 74, 62, 255), outline=(120, 90, 60, 255), width=10)   # chalkboard (blank)
    d.rectangle([260, 372, 1020, 386], fill=(110, 82, 56, 255))
    for i in range(2):
        x = 40 + i * 1130
        d.rectangle([x, 90, x + 100, 360], fill=(200, 224, 245, 255), outline=(240, 240, 240, 255), width=5)
    img = blur(img, 2.8)
    return img, dict(chair=(640, 0.62, 180, hexc('#6c5a44')), desk=('#b99568', '#8d6d46', '#f0d4a8'), amb=(40, 36, 20))

def s_office(side):
    a = vgrad(hexc('#e6eaee'), hexc('#cfd6dc'))
    img = img_from(a); d = ImageDraw.Draw(img, 'RGBA')
    d.rectangle([80, 80, 760, 400], fill=(170, 205, 235, 255), outline=(250, 250, 250, 255), width=8)
    for x in range(80, 760, 170): d.line([x, 80, x, 400], fill=(250, 250, 250, 255), width=6)
    for i in range(3): d.rectangle([840, 110 + i * 100, 1180, 118 + i * 100], fill=(120, 96, 70, 255))
    for i in range(10): d.rectangle([850 + i * 32, 60 + (i % 3) * 8 + i % 2 * 14, 872 + i * 32, 110], fill=(70 + i * 12, 100, 140, 255)) if i < 0 else None
    d.ellipse([1090, 320, 1190, 420], fill=(60, 120, 80, 255))
    img = blur(img, 3.0)
    return img, dict(chair=(640, 0.62, 180, hexc('#444b55')), desk=('#cfc2ae', '#a69a86', '#fff3de'), amb=(30, 34, 40))

def s_library(side):
    a = vgrad(hexc('#2b1c12'), hexc('#3a281a'))
    img = img_from(a); d = ImageDraw.Draw(img, 'RGBA')
    for sh in range(3):
        y0 = 70 + sh * 120; d.rectangle([60, y0 + 100, 1220, y0 + 112], fill=(76, 50, 28, 255))
        x = 70
        while x < 1210:
            bw = int(rng.integers(14, 34)); bh = int(rng.integers(60, 98))
            col = tuple(int(c) for c in (rng.integers(60, 160), rng.integers(30, 90), rng.integers(24, 80)))
            d.rectangle([x, y0 + 100 - bh, x + bw, y0 + 100], fill=col + (255,)); x += bw + 2
    img = blur(img, 2.4)
    a = arr(img); a = glow(a, 1020 if side > 0 else 260, 220, 160, 180, (255, 190, 110), 0.55); img = img_from(a)
    return img, dict(chair=(640, 0.62, 185, hexc('#1e130c')), desk=('#5b3b24', '#34210f', '#c68d58'), amb=(70, 40, 20))

def s_living(side):
    a = vgrad(hexc('#d9cdbd'), hexc('#bfae98'))
    img = img_from(a); d = ImageDraw.Draw(img, 'RGBA')
    d.rectangle([120, 130, 460, 360], fill=(190, 160, 120, 255), outline=(120, 90, 60, 255), width=8)   # art (abstract)
    d.ellipse([200, 190, 380, 330], fill=(150, 90, 70, 255))
    d.rectangle([1010, 140, 1130, 330], fill=(80, 60, 44, 255))                                          # lamp shade stand
    d.polygon([(1030, 140), (1110, 140), (1130, 90), (1010, 90)], fill=(250, 226, 170, 255))
    d.ellipse([560, 250, 760, 440], fill=(90, 130, 90, 255))
    img = blur(img, 3.2)
    a = arr(img); a = glow(a, 1070, 120, 190, 160, (255, 210, 140), 0.5); img = img_from(a)
    return img, dict(chair=(640, 0.62, 175, hexc('#6f5a46')), desk=('#9a7a58', '#6e5338', '#e0be90'), amb=(60, 44, 28))

def s_terrace(side):
    a = vgrad(hexc('#8fc6ee'), hexc('#d6ecf6'))
    a[int(H * .45):] = vgrad(hexc('#7fa86a'), hexc('#5d8a52'), h=H - int(H * .45))
    img = img_from(a); d = ImageDraw.Draw(img, 'RGBA')
    for i in range(14):
        x = 20 + i * 95; r = int(rng.integers(55, 95))
        d.ellipse([x - r, 250 - r, x + r, 250 + r], fill=(60 + int(rng.integers(0, 40)), 120 + int(rng.integers(0, 40)), 70, 255))
    d.rectangle([0, 380, W, 392], fill=(222, 218, 210, 255))
    for x in range(10, W, 62): d.rectangle([x, 392, x + 10, 470], fill=(214, 210, 202, 255))
    img = blur(img, 5.0)
    return img, dict(chair=(640, 0.63, 175, hexc('#3b3f46')), desk=('#d9d2c5', '#aaa296', '#ffffff'), amb=(30, 50, 30))

def s_minimal(side):
    a = vgrad(hexc('#c7ccd6'), hexc('#aeb4c0'))
    a = glow(a, 640, 260, 600, 260, (255, 255, 255), 0.35)
    img = img_from(a)
    img = blur(img, 2.0)
    return img, dict(chair=(640, 0.62, 170, hexc('#2b2e35')), desk=('#e8e8ea', '#c1c4cc', '#ffffff'), amb=(20, 22, 30))

def s_stage(side):
    a = vgrad(hexc('#1c1030'), hexc('#2b1646'))
    img = img_from(a); d = ImageDraw.Draw(img, 'RGBA')
    for i in range(9):
        x = i * 160 - 40; d.polygon([(x, 0), (x + 120, 0), (x + 150, 470), (x + 20, 470)], fill=(110 + (i % 2) * 22, 28, 52, 255))
    d.rectangle([420, 90, 860, 330], fill=(40, 30, 90, 255))
    for k in range(3): d.arc([440 + k * 140, 100, 560 + k * 140, 330], 180, 360, fill=(220, 190, 255, 255), width=5)
    img = blur(img, 3.4)
    a = arr(img)
    for x in (260, 640, 1020): a = glow(a, x, 40, 140, 170, (255, 214, 150), 0.35)
    img = img_from(a)
    return img, dict(chair=(640, 0.62, 190, hexc('#140b22')), desk=('#4a2f1e', '#2c1a10', '#d6a06a'), amb=(80, 30, 60))

def s_sports(side):
    a = vgrad(hexc('#071a14'), hexc('#0d2b22'))
    img = img_from(a); d = ImageDraw.Draw(img, 'RGBA')
    d.rectangle([140, 90, 1140, 340], fill=(10, 52, 40, 255), outline=(60, 255, 170, 255), width=3)
    d.line([640, 90, 640, 340], fill=(60, 255, 170, 255), width=2)
    d.ellipse([560, 160, 720, 270], outline=(60, 255, 170, 255), width=2)
    for i in range(4): d.rectangle([90 + i * 300, 20, 150 + i * 300, 40], fill=(255, 255, 255, 255))
    img = blur(img, 3.0)
    return img, dict(chair=(640, 0.60, 185, hexc('#061611')), desk=('#16352c', '#0c2019', '#4dffb0'), amb=(10, 80, 50))

def s_tech(side):
    """Dark tech-review desk: shelves of gadgets, neon TECH REVIEW sign, purple/cyan accents.
    Matches the collage template direction (empty chair, desk foreground, fixed-camera height)."""
    a = vgrad(hexc('#0a0c14'), hexc('#12162a'))
    a[:, :130] = np.array(hexc('#0c0e1a'), np.float32)
    a[:, 1150:] = np.array(hexc('#0c0e1a'), np.float32)
    img = img_from(a); d = ImageDraw.Draw(img, 'RGBA')

    # back wall shelves (3 rows of tech boxes / gadgets)
    shelf_cols = [(28, 32, 52), (50, 35, 80), (25, 55, 75), (40, 45, 70), (35, 30, 60), (45, 50, 85)]
    for row in range(3):
        y_base = 65 + row * 100
        d.rectangle([140, y_base + 72, 1140, y_base + 84], fill=(30, 34, 52, 255))
        d.rectangle([140, y_base + 72, 1140, y_base + 76], fill=(55, 60, 90, 255))
        x = 155
        while x < 1125:
            bw = int(rng.integers(44, 88))
            bh = int(rng.integers(38, 68))
            col = shelf_cols[int(rng.integers(0, len(shelf_cols)))]
            d.rectangle([x, y_base + 72 - bh, x + bw, y_base + 72], fill=col + (255,), outline=(65, 70, 105, 255))
            if rng.random() > 0.4:
                gx = x + 6; gy = y_base + 72 - bh + 6
                gw = max(10, bw - 14); gh = max(8, bh // 3)
                glow_c = [(70, 170, 255), (170, 90, 255), (90, 210, 190)][int(rng.integers(0, 3))]
                d.rectangle([gx, gy, gx + gw, gy + gh], fill=glow_c + (190,))
            x += bw + 11

    # vertical light strips
    for x in (110, 1170):
        d.rectangle([x, 30, x + 6, 410], fill=(50, 110, 210, 100))
        d.rectangle([x + 1, 30, x + 5, 410], fill=(110, 170, 255, 180))

    # neon TECH REVIEW sign board + clean block letters
    neon = (0, 230, 255, 255)
    neon_soft = (0, 160, 220, 220)
    sx, sy = 780, 48
    d.rounded_rectangle([sx - 16, sy - 10, sx + 310, sy + 62], radius=10, fill=(10, 12, 24, 250))
    # helper for a simple capital letter (returns list of rects)
    def letter_rects(ch, ox, oy, s=1.0):
        w, h = int(26 * s), int(38 * s)
        m = int(5 * s)
        rects = []
        if ch == 'T':
            rects += [(ox, oy, ox + w, oy + m), (ox + (w - m) // 2, oy, ox + (w + m) // 2, oy + h)]
        elif ch == 'E':
            rects += [(ox, oy, ox + m, oy + h), (ox, oy, ox + w, oy + m),
                      (ox, oy + (h - m) // 2, ox + w - 4, oy + (h + m) // 2),
                      (ox, oy + h - m, ox + w, oy + h)]
        elif ch == 'C':
            rects += [(ox, oy, ox + m, oy + h), (ox, oy, ox + w, oy + m), (ox, oy + h - m, ox + w, oy + h)]
        elif ch == 'H':
            rects += [(ox, oy, ox + m, oy + h), (ox + w - m, oy, ox + w, oy + h),
                      (ox, oy + (h - m) // 2, ox + w, oy + (h + m) // 2)]
        elif ch == 'R':
            rects += [(ox, oy, ox + m, oy + h), (ox, oy, ox + w, oy + m),
                      (ox + w - m, oy, ox + w, oy + h // 2),
                      (ox, oy + (h - m) // 2, ox + w - 2, oy + (h + m) // 2),
                      (ox + w // 2, oy + h // 2, ox + w, oy + h)]
        elif ch == 'V':
            rects += [(ox, oy, ox + m, oy + h - 8), (ox + w - m, oy, ox + w, oy + h - 8),
                      (ox + w // 2 - m, oy + h - 12, ox + w // 2 + m, oy + h)]
        elif ch == 'I':
            rects += [(ox + (w - m) // 2, oy, ox + (w + m) // 2, oy + h)]
        elif ch == 'W':
            rects += [(ox, oy, ox + m, oy + h), (ox + w - m, oy, ox + w, oy + h),
                      (ox + w // 3, oy + h // 2, ox + w // 3 + m, oy + h),
                      (ox + 2 * w // 3 - m, oy + h // 2, ox + 2 * w // 3, oy + h)]
        return rects
    # TECH
    for i, ch in enumerate('TECH'):
        for r in letter_rects(ch, sx + 8 + i * 36, sy + 2, 1.0):
            d.rectangle(r, fill=neon)
    # REVIEW (slightly smaller, second row)
    for i, ch in enumerate('REVIEW'):
        for r in letter_rects(ch, sx + 6 + i * 48, sy + 32, 0.72):
            d.rectangle(r, fill=neon_soft)

    # floating monitor panel (purple)
    d.rounded_rectangle([500, 75, 740, 250], radius=12, fill=(16, 18, 36, 255), outline=(90, 70, 170, 220))
    d.rectangle([515, 90, 725, 235], fill=(38, 28, 85, 255))
    for syy in range(95, 230, 7):
        d.line([515, syy, 725, syy], fill=(100, 80, 190, 35))

    # plants
    def plant(cx, cy, scale=1.0):
        for _ in range(8):
            ox = int(rng.integers(-38, 38) * scale)
            oy = int(rng.integers(-55, 8) * scale)
            r = int(rng.integers(16, 30) * scale)
            green = (25 + int(rng.integers(0, 20)), 85 + int(rng.integers(0, 45)), 45 + int(rng.integers(0, 20)), 230)
            d.ellipse([cx + ox - r, cy + oy - r, cx + ox + r, cy + oy + r], fill=green)
        d.rectangle([cx - 20 * scale, cy + 4, cx + 20 * scale, cy + 26 * scale], fill=(38, 34, 48, 255))
    plant(210, 365, 1.05)
    plant(1070, 355, 0.9)

    # cyan shelf accent line
    d.rectangle([140, 375, 1140, 384], fill=(0, 190, 250, 210))
    d.rectangle([140, 378, 1140, 381], fill=(100, 230, 255, 255))

    img = blur(img, 1.8)
    a = arr(img)
    a = glow(a, 930, 75, 200, 80, (0, 210, 255), 0.6)
    a = glow(a, 930, 85, 130, 45, (160, 90, 255), 0.28)
    a = glow(a, 620, 160, 150, 95, (110, 70, 210), 0.38)
    a = glow(a, 640, 380, 460, 26, (0, 200, 255), 0.5)
    a = glow(a, 113, 220, 35, 190, (70, 140, 255), 0.28)
    a = glow(a, 1173, 220, 35, 190, (70, 140, 255), 0.28)
    img = img_from(a)
    return img, dict(
        chair=(640, 0.62, 185, hexc('#0a0c16')),
        desk=('#1a1e2c', '#0c0e18', '#5ad7ff'),
        amb=(25, 40, 90)
    )

# id, name, type, painter, desk back-edge, key side, key colour, softness, person scale
SCENES = [
 ('news-desk',      'News Desk',        'news desk',     s_news,     dict(y=0.64, tilt=0.00, bow=0.02, feather=5), -1, (205, 225, 255), 0.35, 0.58),
 ('podcast-wood',   'Wood Podcast',     'podcast',       s_podcast,  dict(y=0.64, tilt=0.00, bow=0.00, feather=5), -1, (255, 214, 170), 0.50, 0.58),
 ('talk-show',      'Talk Show',        'talk show',     s_talkshow, dict(y=0.65, tilt=0.00, bow=0.03, feather=5), 1,  (225, 205, 255), 0.45, 0.58),
 ('classroom-desk', 'Classroom',        'classroom',     s_class,    dict(y=0.66, tilt=0.00, bow=0.00, feather=6), 1,  (255, 250, 235), 0.65, 0.58),
 ('office-bright',  'Bright Office',    'office',        s_office,   dict(y=0.67, tilt=-0.01, bow=0.00, feather=6), -1, (255, 255, 250), 0.70, 0.60),
 ('library-warm',   'Warm Library',     'library',       s_library,  dict(y=0.65, tilt=0.00, bow=0.00, feather=5), 1,  (255, 205, 140), 0.55, 0.58),
 ('living-room',    'Living Room',      'living room',   s_living,   dict(y=0.66, tilt=0.01, bow=0.00, feather=6), 1,  (255, 220, 170), 0.65, 0.58),
 ('terrace',        'Terrace',          'outdoors terrace', s_terrace, dict(y=0.67, tilt=0.00, bow=0.00, feather=6), -1, (255, 252, 240), 0.80, 0.58),
 ('minimal-studio', 'Minimal Studio',   'minimal studio', s_minimal, dict(y=0.66, tilt=0.00, bow=0.00, feather=6), -1, (255, 255, 255), 0.75, 0.58),
 ('stage-hall',     'Stage / Hall',     'church/stage',  s_stage,    dict(y=0.65, tilt=0.00, bow=0.00, feather=5), -1, (255, 220, 170), 0.40, 0.58),
 ('sports-desk',    'Sports Desk',      'sports desk',   s_sports,   dict(y=0.64, tilt=0.00, bow=0.02, feather=5), 1,  (200, 255, 230), 0.35, 0.58),
 ('tech-review',    'Tech Review',      'tech review',   s_tech,     dict(y=0.65, tilt=0.00, bow=0.00, feather=5), 1,  (190, 230, 255), 0.40, 0.58),
]

SHOULDER_LINE = 0.62
# animated screens (fractions x,y,w,h of the 1280x720 frame) matching what s_news / s_sports draw
SCREENS = {
  'news-desk': [dict(x=(150 + i * 168) / W, y=120 / H, w=150 / W, h=210 / H) for i in range(6)],
  'sports-desk': [dict(x=140 / W, y=90 / H, w=1000 / W, h=250 / H)],
}
FOREGROUND = {'living-room'}
CHEST_LINE = 0.86   # library scenes seat the person so the desk hides from the upper chest down
def clamp(v, a, b): return max(a, min(b, v))

def build(i, sc):
    sid, name, typ, painter, desk, side, kc, soft, pscale = sc
    img, p = painter(side)
    a = arr(img); a = side_light(a, side, 0.20 + 0.08 * (1 - soft), kc); img = img_from(a)
    cx, cb, ch, ccol = p['chair']
    draw_chair(img, cx, desk['y'] * H + 6, 105, ccol, w=150)
    tc, fc, ec = p['desk']
    img = draw_desk(img, desk, hexc(tc), hexc(fc), hexc(ec), gloss=0.16, ambient=p['amb'])
    img = finish(img, grain=2.6, seed=i)
    if sid in FOREGROUND: make_foreground(sid, desk)
    path = os.path.join(ROOT, 'assets', 'environments', f'scene-{sid}.jpg')
    img.save(path, quality=88, optimize=True, progressive=True)
    # engine settings seating the person behind the desk (same formula as SceneEngine.autoPlace)
    desk_mid = desk['y'] + desk['tilt'] * 0.5 + desk['bow']
    person_y = clamp(desk_mid + 0.02 - 1 + pscale * (1 - CHEST_LINE), -0.3, 0.3)
    meta = {
      'schema': 1,
      'id': 'scene-' + sid, 'name': name, 'type': typ,
      'image': f'assets/environments/scene-{sid}.jpg',
      'size': [W, H],
      'foreground': (f'assets/environments/scene-{sid}-fg.png' if sid in FOREGROUND else None),   # optional PNG with alpha drawn IN FRONT of the presenter (the worker loads it by this name)
      'screens': SCREENS.get(sid, []),   # rectangles (fractions of the frame) that get slow animated content
      'life': {'amount': 0.4, 'parallax': 0.3},
      'deskLine': {'y': round(desk['y'], 3), 'tilt': desk['tilt'], 'bow': desk['bow'], 'feather': desk['feather']},
      'camera': {'eyeLevel': 0.42, 'heightCm': 120, 'note': 'fixed camera, eye height, slight downward tilt'},
      'keyLight': {'side': side, 'colour': list(kc), 'softness': soft},
      'floorLine': 0.95,
      'person': {'scale': pscale, 'x': 0.0, 'y': round(person_y, 3)},
      'reflections': {'desk': 0.22},
      'depthLayers': [
        {'name': 'background', 'y0': 0.0, 'y1': desk['y'], 'blur': round(0.15 + 0.2 * (1 - soft), 2)},
        {'name': 'desk', 'y0': desk['y'], 'y1': 1.0, 'blur': 0.0}],
      'grade': {'grain': 0.5, 'bloom': 0.3, 'vignette': 0.25},
      'chair': {'x': cx / W, 'empty': True},
      'licence': 'Original procedural artwork generated for Genesis Studio (tools/scenes/make_scenes.py). No third-party assets.',
      'tags': [typ, 'desk', 'fixed-camera']
    }
    d = os.path.join(ROOT, 'assets', 'scenes', 'scene-' + sid); os.makedirs(d, exist_ok=True)
    with open(os.path.join(d, 'scene.json'), 'w') as f: json.dump(meta, f, indent=2)
    return meta

def main():
    os.makedirs(os.path.join(ROOT, 'assets', 'environments'), exist_ok=True)
    metas = [build(i, sc) for i, sc in enumerate(SCENES)]
    with open(os.path.join(ROOT, 'js', 'providers', 'scene-library.js'), 'w') as f:
        f.write('/* GENERATED by tools/scenes/make_scenes.py — do not edit. Same content as assets/scenes/<id>/scene.json. */\n')
        f.write('(function(){ globalThis.VS = globalThis.VS || {}; globalThis.VS.SCENE_LIBRARY = ' + json.dumps(metas, separators=(',', ':')) + '; })();\n')
    total = sum(os.path.getsize(os.path.join(ROOT, m['image'])) for m in metas)
    print(f'{len(metas)} scenes, {total/1024:.0f} KB of images')

if __name__ == '__main__': main()
