import numpy as np, cv2, subprocess, os
W,H=1280,720; S=4
rng=np.random.default_rng(7)
# ---- background: textured cool gray-blue wall + couch block ----
yy,xx=np.mgrid[0:H,0:W].astype(np.float32)
base=np.stack([150+20*np.sin(xx/200)+0*yy, 140+15*np.cos(yy/150), 120+10*np.sin((xx+yy)/300)],-1)  # BGR
low=cv2.resize(rng.normal(0,10,(18,32,3)).astype(np.float32),(W,H),interpolation=cv2.INTER_CUBIC)
bg=np.clip(base+low,0,255)
cv2.rectangle(bg,(330,430),(950,720),(95,100,110),-1)          # couch behind person (similar to shirt tone: hard case)
cv2.rectangle(bg,(330,430),(950,470),(120,125,135),-1)
bg=cv2.GaussianBlur(bg,(0,0),1.2)
# ---- person layer at 4x supersample ----
def P(v): return int(v*S)
layer=np.zeros((H*S,W*S,3),np.uint8); a=np.zeros((H*S,W*S),np.uint8)
def shape(draw,color):
    draw(layer,color); m=np.zeros_like(a); draw(m,255); np.maximum(a,m,out=a)
skin=(130,165,210); shirt=(95,55,35); hair=(22,32,52)
# torso
def torso(img,c):
    pts=np.array([[P(380),P(720)],[P(420),P(520)],[P(520),P(455)],[P(640),P(440)],[P(760),P(455)],[P(860),P(520)],[P(900),P(720)]],np.int32)
    cv2.fillPoly(img,[pts],c,lineType=cv2.LINE_AA)
shape(torso,shirt)
# neck
shape(lambda img,c: cv2.rectangle(img,(P(595),P(380)),(P(685),P(460)),c,-1),skin)
# head
shape(lambda img,c: cv2.ellipse(img,(P(640),P(300)),(P(92),P(118)),0,0,360,c,-1,cv2.LINE_AA),skin)
# hair cap + fine flyaway strands (thin, low-contrast edges: the hard part for a matte)
def haircap(img,c): cv2.ellipse(img,(P(640),P(262)),(P(100),P(96)),0,180,360,c,-1,cv2.LINE_AA)
shape(haircap,hair)
for i in range(60):
    ang=np.deg2rad(rng.uniform(190,350)); r0=96; r1=r0+rng.uniform(8,34)
    cx,cy=640,262
    p0=(P(cx+100*np.cos(ang)*0.98),P(cy+96*np.sin(ang)*0.98)); p1=(P(cx+(100+rng.uniform(8,34))*np.cos(ang)),P(cy+(96+rng.uniform(8,34))*np.sin(ang)))
    shape(lambda img,c,p0=p0,p1=p1: cv2.line(img,p0,p1,c,max(1,S//2),cv2.LINE_AA),hair)
# eyes/mouth just for visual identity
cv2.circle(layer,(P(608),P(300)),P(7),(30,30,30),-1,cv2.LINE_AA); cv2.circle(layer,(P(672),P(300)),P(7),(30,30,30),-1,cv2.LINE_AA)
cv2.ellipse(layer,(P(640),P(345)),(P(24),P(10)),0,0,180,(60,60,150),P(3),cv2.LINE_AA)
# downsample (area) -> antialiased colour + alpha
col=cv2.resize(layer,(W,H),interpolation=cv2.INTER_AREA).astype(np.float32)
al=cv2.resize(a,(W,H),interpolation=cv2.INTER_AREA).astype(np.float32)/255.0
# color is premultiplied-by-nothing here (layer black where empty): un-premultiply for ground truth
colu=np.where(al[...,None]>1e-3, col/np.maximum(al[...,None],1e-3), 0)
colu=np.clip(colu,0,255)
frame=bg*(1-al[...,None])+colu*al[...,None]
os.makedirs('/tmp/srv/fx',exist_ok=True)
X0,X1=160,1120
bg=bg[:,X0:X1]; colu=colu[:,X0:X1]; al=al[:,X0:X1]; frame=frame[:,X0:X1]; W=X1-X0
cv2.imwrite('/tmp/srv/fx/gt_alpha.png',(al*255).round().astype(np.uint8))
cv2.imwrite('/tmp/srv/fx/gt_person.png',colu.astype(np.uint8))
cv2.imwrite('/tmp/srv/fx/bg.png',bg.astype(np.uint8))
cv2.imwrite('/tmp/srv/fx/frame0.png',np.clip(frame,0,255).astype(np.uint8))
# 30 frames with sensor noise (static subject so ground truth is exact)
p=subprocess.Popen(['ffmpeg','-y','-loglevel','error','-f','rawvideo','-pix_fmt','bgr24','-s',f'{W}x{H}','-r','15','-i','-','-pix_fmt','yuv420p','/tmp/srv/fx/person.y4m'],stdin=subprocess.PIPE)
for i in range(30):
    f=np.clip(frame+rng.normal(0,2.5,frame.shape),0,255).astype(np.uint8)
    p.stdin.write(f.tobytes())
p.stdin.close(); p.wait()
print('edge pixels (0.02<a<0.98):',int(((al>0.02)&(al<0.98)).sum()),'person area',int((al>0.5).sum()))
