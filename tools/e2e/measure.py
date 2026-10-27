import sys, numpy as np, cv2
out=cv2.imread(sys.argv[1]).astype(np.float32)           # BGR
H,W=out.shape[:2]
ga=cv2.imread('/tmp/srv/fx/gt_alpha.png',0); gp=cv2.imread('/tmp/srv/fx/gt_person.png')
gh,gw=ga.shape; ch=int(round(gw*H/W)); y0=(gh-ch)//2           # app crops the 4:3 camera to the output aspect, centred
ga=ga[y0:y0+ch]; gp=gp[y0:y0+ch]
gt_a=cv2.resize(ga,(W,H),interpolation=cv2.INTER_AREA).astype(np.float32)/255
gt_p=cv2.resize(gp,(W,H),interpolation=cv2.INTER_AREA).astype(np.float32)
G=np.array([0,255,0],np.float32)
d=gt_p-G; den=(d*d).sum(-1)+1e-6
a_est=np.clip(((out-G)*d).sum(-1)/den,0,1)
err=np.abs(a_est-gt_a)
edge=cv2.dilate(((gt_a>0.02)&(gt_a<0.98)).astype(np.uint8),np.ones((7,7),np.uint8))>0
core_bg=(gt_a<0.001)&(~edge); core_fg=(gt_a>0.999)&(~edge)
print(f'size {W}x{H} | alpha MAE all: {err.mean():.4f} | edge-band MAE: {err[edge].mean():.4f} | bg leak (should be 0): {a_est[core_bg].mean():.4f} | fg hole (should be 1): {a_est[core_fg].mean():.4f} | semi-transparent px (0.1<a<0.9): {int(((a_est>0.1)&(a_est<0.9)).sum())} vs GT {int(((gt_a>0.1)&(gt_a<0.9)).sum())}')
