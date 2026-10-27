const vm=require('vm'),fs=require('fs'),path=require('path');
const ctx={};ctx.self=ctx;vm.createContext(ctx);vm.runInContext(fs.readFileSync(path.join(__dirname,'../../js/grade-core.js'),'utf8'),ctx);
const G=ctx.VS.GradeCore;let bad=0;const ok=(n,c,d)=>{if(!c)bad++;console.log((c?'PASS ':'FAIL ')+n+(d!==undefined?' '+JSON.stringify(d):''))};
const gr=(id)=>G.GRADES.find(g=>g.id===id);
ok('natural = no filter, no tint',G.resolve(gr('none'),1).filter==='none'&&G.resolve(gr('none'),1).tint===null);
ok('strength 0 = nothing',G.resolve(gr('cinema'),0).filter==='none');
const full=G.resolve(gr('cinema'),1),half=G.resolve(gr('cinema'),0.5);
ok('full cinema has contrast 1.140',/contrast\(1\.140\)/.test(full.filter),full.filter);ok('half is half-way (1.070)',/contrast\(1\.070\)/.test(half.filter),half.filter);
ok('tint alpha scales with strength',Math.abs(half.tint.alpha-full.tint.alpha/2)<1e-3,[full.tint,half.tint]);
ok('mono is grayscale(1.000)',/grayscale\(1\.000\)/.test(G.resolve(gr('mono'),1).filter));
ok('strength clamps >1',G.resolve(gr('vivid'),5).filter===G.resolve(gr('vivid'),1).filter);
ok('every preset resolves to valid css (no NaN)',G.GRADES.every(g=>!/NaN|undefined/.test(G.resolve(g,0.7).filter)));
// photo stats
const px=(r,g,b,n=400)=>{const d=new Uint8ClampedArray(n*4);for(let i=0;i<n;i++){d[i*4]=r;d[i*4+1]=g;d[i*4+2]=b;d[i*4+3]=255}return d};
const warm=G.gradeFromStats(G.statsFromRGBA(px(220,150,90),20,20)),cool=G.gradeFromStats(G.statsFromRGBA(px(80,130,220),20,20)),gray=G.gradeFromStats(G.statsFromRGBA(px(128,128,128),20,20));
ok('warm photo -> warm (red) tint',warm.tint&&warm.tint.rgb[0]>warm.tint.rgb[2],warm.tint);ok('cool photo -> cool (blue) tint',cool.tint&&cool.tint.rgb[2]>cool.tint.rgb[0],cool.tint);
ok('grey photo -> no tint',gray.tint===null);
const dark=G.gradeFromStats(G.statsFromRGBA(px(30,30,30),20,20)),bright=G.gradeFromStats(G.statsFromRGBA(px(230,230,230),20,20));
ok('dark photo darker than bright photo',dark.f.brightness<bright.f.brightness&&dark.f.brightness>=0.85&&bright.f.brightness<=1.15);
const extreme=G.gradeFromStats(G.statsFromRGBA(px(255,0,0),20,20));ok('extreme photo stays clamped (tint alpha <= 0.16, saturate <= 1.3)',extreme.tint.a<=0.16&&extreme.f.saturate<=1.3,extreme);
ok('transparent/empty image -> null',G.statsFromRGBA(new Uint8ClampedArray(1600),20,20)===null&&G.gradeFromStats(null)===null);
// skin
ok('typical skin tones are skin',[[224,172,105],[198,134,66],[141,85,36],[255,205,148],[120,80,60]].every(c=>G.isSkin(...c)),[[224,172,105],[198,134,66],[141,85,36],[255,205,148],[120,80,60]].map(c=>G.isSkin(...c)));
ok('blue/green/white/black are not skin',![[40,90,200],[40,160,60],[255,255,255],[0,0,0],[20,20,20]].some(c=>G.isSkin(...c)));
const src=new Uint8ClampedArray(4*4*4),out=new Uint8ClampedArray(4*4*4);for(let i=0;i<16;i++){const s=i<8?[224,172,105,255]:i<12?[40,90,200,255]:[224,172,105,0];src.set(s,i*4)}
const fr=G.skinMask(src,out,4,4);ok('mask: 8 skin of 12 opaque; transparent excluded',Math.abs(fr-8/12)<1e-9&&out[3]===255&&out[8*4+3]===0&&out[12*4+3]===0,fr);
// framing
const base={fw:0.5625,fh:1};const cur={zoom:1,panX:0.5,panY:0.5};
let t=G.frameTarget({x0:0.40,x1:0.60,y0:0.30,y1:0.90},base,cur);ok('person 60% tall at zoom 1 -> small zoom-in, centred',t.zoom>=1&&t.zoom<1.2&&Math.abs(t.panX-0.5)<1e-9,t);
t=G.frameTarget({x0:0.45,x1:0.55,y0:0.40,y1:0.60},base,cur);ok('small far person -> zoom in a lot, <= 2.4',t.zoom>2&&t.zoom<=2.4,t);
t=G.frameTarget({x0:0.1,x1:0.3,y0:0.2,y1:0.8},base,cur);ok('person on the left -> pan left, inside frame',t.panX<0.5&&t.panX-base.fw/t.zoom/2>=-1e-9,t);
const good=G.frameTarget({x0:0.4,x1:0.6,y0:0.25,y1:0.9},base,{zoom:1,panX:0.5,panY:0.5});const again=G.frameTarget({x0:0.401,x1:0.601,y0:0.251,y1:0.9},base,good);
ok('dead-band: tiny movement -> no change',again.zoom===good.zoom&&again.panX===good.panX&&again.panY===good.panY,[good,again]);
ok('no person / bad box -> null',G.frameTarget(null,base,cur)===null&&G.frameTarget({x0:.5,x1:.5,y0:0,y1:1},base,cur)===null);
let s=cur;const tg={zoom:2,panX:0.7,panY:0.4};const path1=[];for(let i=0;i<120;i++){s=G.approach(s,tg,1/30);path1.push(s.zoom)}
ok('approach: never overshoots, monotonic, converging',path1.every((z,i)=>z<=2+1e-9&&(i===0||z>=path1[i-1]-1e-12))&&Math.abs(s.zoom-2)<0.15&&Math.abs(s.panX-0.7)<0.1,s);
const step1=G.approach(cur,tg,1/30);ok('speed capped (no snap): first frame moves < 2.5% of frame',Math.abs(step1.panX-0.5)<0.025&&Math.abs(step1.zoom-1)<0.05,step1);
ok('approach with null target holds',G.approach(cur,null,1)===cur);
process.exit(bad?1:0);
