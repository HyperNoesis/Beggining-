import sys, numpy as np, onnxruntime as ort
from PIL import Image, ImageFilter
import os
MODEL = os.environ.get('DEPTH_MODEL', 'da.onnx')   # depth_anything_v2_vits.onnx from github.com/fabio-sim/Depth-Anything-ONNX release v2.0.0 (sha256 d2b11a11...562be). Apache-2.0 (Small only).
s = ort.InferenceSession(MODEL, providers=['CPUExecutionProvider'])
mean = np.array([0.485,0.456,0.406],np.float32); std = np.array([0.229,0.224,0.225],np.float32)
def depth(path, out):
    im = Image.open(path).convert('RGB'); W,H = im.size
    x = (np.asarray(im.resize((518,518), Image.BICUBIC),np.float32)/255 - mean)/std
    d = s.run(None, {s.get_inputs()[0].name: x.transpose(2,0,1)[None].astype(np.float32)})[0][0]
    lo, hi = np.percentile(d,1), np.percentile(d,99); d = np.clip((d-lo)/(hi-lo+1e-6),0,1)  # 1 = near
    g = Image.fromarray((d*255).astype(np.uint8)).resize((320,180), Image.BICUBIC).filter(ImageFilter.GaussianBlur(1.2))
    g.save(out, optimize=True); return d
if __name__=='__main__':
    # usage: DEPTH_MODEL=path/to/model.onnx python3 make_depth.py picture.jpg out-depth.png   (or no args: all assets/environments/scene-*.jpg)
    import glob
    if len(sys.argv) == 3: depth(sys.argv[1], sys.argv[2]); sys.exit(0)
    root = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..')
    for f in sorted(glob.glob(os.path.join(root, 'assets/environments/scene-*.jpg'))):
        depth(f, f[:-4] + '-depth.png'); print('depth', os.path.basename(f))
