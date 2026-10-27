# Moving-subject fake camera for the pairing test: a bright yellow square sweeping side to side on a dark textured background. 480x640 @15 fps, 150 frames.
import numpy as np, cv2, subprocess, os, sys
out = sys.argv[1] if len(sys.argv) > 1 else '/tmp/srv/fxmove'; os.makedirs(out, exist_ok=True)
W, H, N = 480, 640, 150
rng = np.random.default_rng(3); bg = np.clip(rng.normal(48, 6, (H, W, 3)), 0, 255).astype(np.uint8); bg = cv2.GaussianBlur(bg, (0, 0), 3)
p = subprocess.Popen(['ffmpeg', '-y', '-loglevel', 'error', '-f', 'rawvideo', '-pix_fmt', 'bgr24', '-s', f'{W}x{H}', '-r', '15', '-i', '-', '-pix_fmt', 'yuv420p', out + '/person.y4m'], stdin=subprocess.PIPE)
for i in range(N):
    f = bg.copy(); cx = int(W / 2 + 130 * np.sin(i * 2 * np.pi / 30)); x0 = cx - 60       # speed up to ~27 px/frame at the sweep centre
    cv2.rectangle(f, (x0, 250), (x0 + 120, 450), (0, 230, 255), -1)                        # BGR yellow
    p.stdin.write(f.tobytes())
p.stdin.close(); p.wait(); print('wrote', out + '/person.y4m')
