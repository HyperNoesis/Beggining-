"""Procedural PROTOTYPE art for the Level 3 seated scene 'scene-lounge-seat' (sofa behind, low table in front).
Writes assets/environments/scene-lounge-seat{.jpg,-depth.png}. Stylised, not photoreal: replace with a generated photo using the prompt in docs/LEVEL3_SEATING.md."""
import os, numpy as np
from PIL import Image, ImageDraw, ImageFilter
R = os.path.join(os.path.dirname(__file__), '..', '..', 'assets', 'environments')
W, H = 1280, 720
rng = np.random.default_rng(7)
def A(img): return np.asarray(img.convert('RGB'), dtype=np.float32)
def vgrad(top, bot):
    t = np.linspace(0, 1, H, dtype=np.float32)[:, None, None]
    return (np.array(top, np.float32) * (1 - t) + np.array(bot, np.float32) * t) * np.ones((H, W, 3), np.float32)
def layer(fn, blur=0):
    L = Image.new('RGBA', (W, H), (0, 0, 0, 0)); fn(ImageDraw.Draw(L))
    return L.filter(ImageFilter.GaussianBlur(blur)) if blur else L
def paste(base, L): base.alpha_composite(L); return base
def shade(box, col_top, col_bot, r, blur=0):
    """rounded rect filled with a vertical gradient"""
    x0, y0, x1, y1 = [int(v) for v in box]
    g = Image.fromarray(np.clip(np.linspace(col_top, col_bot, max(2, y1 - y0))[:, None, :] * np.ones((1, x1 - x0, 1)), 0, 255).astype(np.uint8), 'RGB')
    m = Image.new('L', (x1 - x0, y1 - y0), 0); ImageDraw.Draw(m).rounded_rectangle((0, 0, x1 - x0 - 1, y1 - y0 - 1), r, fill=255)
    L = Image.new('RGBA', (W, H), (0, 0, 0, 0)); L.paste(g, (x0, y0), m)
    return L.filter(ImageFilter.GaussianBlur(blur)) if blur else L
f = lambda a: (a[0] * W, a[1] * H, a[2] * W, a[3] * H)

# ---- wall + floor
base = Image.fromarray(np.clip(vgrad((46, 38, 34), (84, 68, 58)), 0, 255).astype(np.uint8), 'RGB').convert('RGBA')
FLOOR = 0.80
fl = Image.fromarray(np.clip(vgrad((70, 46, 32), (34, 22, 16)), 0, 255).astype(np.uint8), 'RGB').convert('RGBA')
m = Image.new('L', (W, H), 0); ImageDraw.Draw(m).rectangle((0, int(FLOOR * H), W, H), fill=255); base.paste(fl, (0, 0), m)
# wall panel lines
paste(base, layer(lambda d: [d.rectangle((int(W * x), int(H * .06), int(W * x) + 2, int(H * FLOOR)), fill=(0, 0, 0, 40)) for x in (.05, .93)] ))
# arched window (left, cropped by the frame edge like a real tight shot)
def win(d):
    x0, y0, x1, y1 = f((-.06, .04, .22, .62))
    d.rounded_rectangle((x0, y0, x1, y1), 90, fill=(206, 224, 238, 255)); d.rectangle((x0 + (x1 - x0) * .55 - 3, y0 + 40, x0 + (x1 - x0) * .55 + 3, y1), fill=(52, 44, 40, 255)); d.rectangle((x0, y0 + (y1 - y0) * .42, x1, y0 + (y1 - y0) * .42 + 5), fill=(52, 44, 40, 255))
paste(base, layer(win)); paste(base, layer(lambda d: d.rounded_rectangle(f((-.08, .02, .235, .64)), 96, outline=(40, 32, 28, 255), width=9)))
paste(base, layer(lambda d: d.ellipse(f((-.12, -.05, .40, .8)), fill=(255, 238, 205, 55)), 60))
# framed picture above the sofa (right of centre)
paste(base, layer(lambda d: d.rectangle(f((.600, .07, .752, .27)), fill=(30, 24, 20, 255))))
paste(base, layer(lambda d: d.rectangle(f((.608, .085, .744, .255)), fill=(170, 120, 80, 255))))
# floor lamp, shade visible above the sofa on the right, warm glow
paste(base, layer(lambda d: d.ellipse(f((.74, -.10, 1.18, .60)), fill=(255, 205, 130, 75)), 55))
paste(base, layer(lambda d: (d.rectangle(f((.9195, .22, .9265, .70)), fill=(28, 24, 22, 255)), d.polygon([(W * .885, H * .21), (W * .962, H * .21), (W * .945, H * .07), (W * .902, H * .07)], fill=(250, 226, 170, 255)))))
paste(base, layer(lambda d: d.ellipse(f((-.10, .84, 1.10, 1.12)), fill=(118, 92, 70, 150)), 3))   # rug

# ---- loveseat, true scale: the back runs past both frame edges at ear level, arms at the frame edges
paste(base, layer(lambda d: d.rounded_rectangle(f((-.10, .38, 1.10, .90)), 60, fill=(0, 0, 0, 120)), 26))
paste(base, shade(f((-.10, .345, 1.10, .86)), (46, 86, 76), (22, 50, 44), 56))                                         # back frame, rolled top at y .345
paste(base, layer(lambda d: d.rectangle(f((-.10, .352, 1.10, .362)), fill=(120, 175, 155, 95)), 2))                    # top-roll highlight
for x0, x1 in ((-.04, .492), (.508, 1.04)):                                                                           # two back cushions, seam at the centre (behind the head)
    paste(base, shade(f((x0, .385, x1, .76)), (62, 110, 96), (30, 66, 58), 40, 0.6))
    paste(base, layer(lambda d, x0=x0, x1=x1: [d.ellipse((W * (x0 + .055 + k * (x1 - x0 - .11) / 4) - 3, H * (.46 + j * .075) - 3, W * (x0 + .055 + k * (x1 - x0 - .11) / 4) + 3, H * (.46 + j * .075) + 3), fill=(18, 40, 36, 150)) for k in range(5) for j in range(4)]))
paste(base, shade(f((-.04, .60, .115, .88)), (60, 104, 92), (24, 54, 48), 40))                                         # left arm (cut by the frame edge)
paste(base, shade(f((.885, .60, 1.04, .88)), (60, 104, 92), (24, 54, 48), 40))                                         # right arm
paste(base, layer(lambda d: [d.rectangle(f((x0, .606, x1, .614)), fill=(140, 195, 175, 90)) for x0, x1 in ((-.04, .115), (.885, 1.04))], 2))
paste(base, shade(f((.10, .735, .90, .865)), (92, 148, 128), (34, 74, 64), 30))                                        # seat cushion, lit top, visible beside the torso
paste(base, layer(lambda d: d.rectangle(f((.10, .742, .90, .75)), fill=(170, 215, 195, 90)), 2))
paste(base, layer(lambda d: d.ellipse(f((.62, .45, .86, .70)), fill=(255, 215, 150, 38)), 30))                         # lamp light on the cushions

# ---- low table in front (this is the occluder: everything below deskLine y)
TY = 0.86
paste(base, layer(lambda d: d.rounded_rectangle(f((.14, TY, .86, 1.04)), 16, fill=(0, 0, 0, 130)), 22))
paste(base, shade(f((.14, TY, .86, TY + .075)), (214, 196, 170), (160, 140, 116), 10))                                  # top surface (marble/wood)
paste(base, layer(lambda d: d.rectangle(f((.14, TY + .0, .86, TY + .004)), fill=(255, 245, 225, 140)), 1))
paste(base, shade(f((.14, TY + .075, .86, 1.03)), (70, 46, 30), (34, 22, 14), 6))                                      # front face
paste(base, shade(f((.24, TY - .045, .32, TY + .012)), (40, 40, 44), (20, 20, 24), 3))                                 # book stack on the table
paste(base, shade(f((.70, TY - .05, .735, TY + .012)), (238, 238, 238), (190, 190, 190), 6))                           # mug
paste(base, layer(lambda d: d.ellipse(f((.745, TY - .035, .767, TY - .004)), outline=(238, 238, 238, 255), width=3)))
img = base.convert('RGB')
a = A(img)
# velvet nap + weave: fine vertical-streaked noise on the upholstery only (rows of the sofa body), plus global film grain
nap = Image.fromarray(np.clip(128 + rng.normal(0, 38, (H, W)), 0, 255).astype(np.uint8), 'L').filter(ImageFilter.GaussianBlur(0.7))
nap = np.asarray(nap, dtype=np.float32) - 128
streak = np.asarray(Image.fromarray(np.clip(128 + rng.normal(0, 38, (H, W // 6)), 0, 255).astype(np.uint8), 'L').resize((W, H), Image.BICUBIC), dtype=np.float32) - 128
sofa = np.zeros((H, W, 1), np.float32); sofa[int(.345 * H):int(.87 * H), :, 0] = 1.0
a = a + sofa * ((0.10 * nap + 0.06 * streak)[:, :, None])
a = a + rng.normal(0, 2.4, (H, W, 1)).astype(np.float32)
Image.fromarray(np.clip(a, 0, 255).astype(np.uint8), 'RGB').save(os.path.join(R, 'scene-lounge-seat.jpg'), quality=90)

# ---- depth (255 = near), 320x180
D = np.zeros((180, 320), np.float32)
yy = np.linspace(0, 1, 180)[:, None]
D[:] = 25                                              # wall
fl_ = yy > FLOOR; D = np.where(fl_, 60 + 120 * (yy - FLOOR) / (1 - FLOOR), D)
def rect(x0, y0, x1, y1, v):
    global D; D[int(y0 * 180):int(y1 * 180), int(x0 * 320):int(x1 * 320)] = v
rect(0, .345, 1, .86, 105); rect(0, .60, .115, .88, 125); rect(.885, .60, 1, .88, 125); rect(.10, .735, .90, .865, 135)
rect(.14, TY, .86, 1.0, 235)
Image.fromarray(np.clip(D, 0, 255).astype(np.uint8), 'L').filter(ImageFilter.GaussianBlur(0.8)).save(os.path.join(R, 'scene-lounge-seat-depth.png'), optimize=True)
print('ok')
