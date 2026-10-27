import cv2, numpy as np, subprocess
im=cv2.imread('/tmp/dl/sk/skimage/data/astronaut.png')            # real human portrait (512x512)
crop=im[40:40+384, :]                                               # 512x384 -> 4:3
W,H=960,720; rng=np.random.default_rng(3)
cv2.imwrite('/tmp/srv/fx/astro_frame0.png',cv2.resize(crop,(W,H),interpolation=cv2.INTER_CUBIC))
p=subprocess.Popen(['ffmpeg','-y','-loglevel','error','-f','rawvideo','-pix_fmt','bgr24','-s',f'{W}x{H}','-r','15','-i','-','-pix_fmt','yuv420p','/tmp/srv/fx/real.y4m'],stdin=subprocess.PIPE)
for i in range(45):
    z=1.0+0.04*np.sin(i/45*2*np.pi)                                 # slow breathing zoom = natural motion
    M=cv2.getRotationMatrix2D((256,192),0,z); f=cv2.warpAffine(crop,M,(512,384),borderMode=cv2.BORDER_REFLECT)
    f=cv2.resize(f,(W,H),interpolation=cv2.INTER_CUBIC).astype(np.float32)+rng.normal(0,2.0,(H,W,3))
    p.stdin.write(np.clip(f,0,255).astype(np.uint8).tobytes())
p.stdin.close(); p.wait(); print('real.y4m ok')
