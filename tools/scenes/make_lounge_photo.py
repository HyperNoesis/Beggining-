#!/usr/bin/env python3
"""Builds the photoreal seated lounge scene (scene-lounge-seat) from the generated picture in
assets/scenes/scene-lounge-seat/source/grok-sofa-original.jpg.

Outputs (all written into assets/environments/):
  scene-lounge-seat.jpg        1280x720 16:9 crop (full width, bottom-aligned so the table edge sits high: see docs/LEVEL3_SEATING.md)
  scene-lounge-seat-fg.png     book + mug cut out (RGBA), drawn IN FRONT of the presenter so a torso never covers them
  scene-lounge-seat-depth.png  320x180 depth map (255 = near) from Depth Anything V2 Small, run OFFLINE (only if DEPTH_MODEL is set)

Usage: DEPTH_MODEL=/path/da.onnx python3 -I tools/scenes/make_lounge_photo.py
Why the crop is bottom-aligned: a phone at ~1 m sees head + chest only. The presenter's bottom edge must hide behind the table, so the
table's back edge has to sit high in the frame (about 81%), not at 91% as in the uncropped picture.
"""
import os, sys
import numpy as np
from PIL import Image, ImageFilter
from scipy import ndimage as ndi

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, '..', '..'))
SRC = os.path.join(ROOT, 'assets/scenes/scene-lounge-seat/source/grok-sofa-original.jpg')
ENV = os.path.join(ROOT, 'assets/environments')

im = Image.open(SRC).convert('RGB')
W, H = im.size
ch = int(round(W * 9 / 16))
y0 = H - ch                                   # bottom-aligned crop
pic = im.crop((0, y0, W, H)).resize((1280, 720), Image.LANCZOS)
pic.save(os.path.join(ENV, 'scene-lounge-seat.jpg'), quality=88, optimize=True, progressive=True)
print('picture', pic.size, 'crop y0', y0)

# ---- foreground cut-outs (book, mug): bright objects against the dark green sofa. Only pixels ABOVE the table's back edge matter
# (below it the occluder already draws the same picture), so we threshold inside tight boxes and fade out below the table edge.
a = np.asarray(pic).astype(np.float32)
luma = 0.2126 * a[..., 0] + 0.7152 * a[..., 1] + 0.0722 * a[..., 2]
alpha = np.zeros((720, 1280), np.float32)
RED = a[..., 0]                                  # the velvet sofa is near-black green (red < 15); mug and book are warm (red > 60 even in shade)
BOXES = [  # (x0, y0, x1, y1, red threshold)
    (835, 512, 968, 622, 28),     # mug
    (492, 548, 748, 652, 28),     # book stack
]
for (bx0, by0, bx1, by1, th) in BOXES:
    m = RED[by0:by1, bx0:bx1] > th
    m = ndi.binary_closing(m, iterations=2)        # closes speckle; the mug-handle hole is bigger than this, so it stays open
    lab, n = ndi.label(m)
    if n:
        sizes = ndi.sum(m, lab, range(1, n + 1)); keep = 1 + int(np.argmax(sizes)); m = lab == keep
    alpha[by0:by1, bx0:bx1] = np.maximum(alpha[by0:by1, bx0:bx1], m.astype(np.float32))
alpha = ndi.binary_erosion(alpha > 0.5, iterations=1).astype(np.float32)          # lose the 1-px green fringe
alpha = ndi.gaussian_filter(alpha, 0.9)
fade = np.ones(720, np.float32); fade[598:] = np.linspace(1, 0, 720 - 598)         # everything below the table edge is the picture anyway
alpha *= fade[:, None]
rgb = a.clip(0, 255).astype(np.uint8); rgb[alpha < 0.004] = 0           # empty pixels carry no colour: the PNG shrinks from ~800 KB to a few tens of KB
rgba = np.dstack([rgb, (alpha * 255).clip(0, 255).astype(np.uint8)])
Image.fromarray(rgba, 'RGBA').save(os.path.join(ENV, 'scene-lounge-seat-fg.png'), optimize=True)
print('fg alpha coverage %.2f%%' % (100 * (alpha > 0.5).mean()))

# ---- depth (offline, optional)
model = os.environ.get('DEPTH_MODEL')
if model and os.path.exists(model):
    sys.path.insert(0, HERE)
    import make_depth
    d = make_depth.depth(os.path.join(ENV, 'scene-lounge-seat.jpg'), os.path.join(ENV, 'scene-lounge-seat-depth.png'))
    print('depth written', d.shape)
else:
    print('DEPTH_MODEL not set: depth map left as is')
