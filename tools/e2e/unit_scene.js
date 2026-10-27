const vm=require('vm'),fs=require('fs'); const sb={globalThis:{},Math,Uint8ClampedArray,console}; sb.globalThis=sb; vm.createContext(sb);
vm.runInContext(fs.readFileSync(''+require('path').join(__dirname,'../..')+'/js/providers/scene-engine.js','utf8'),sb);
const SE=sb.VS.SceneEngine; let fail=0; const ok=(c,m)=>{ if(!c){fail++;console.log('FAIL',m);} else console.log('ok  ',m); };
const s=Object.assign({},SE.DEFAULTS,{deskY:0.6,deskTilt:0.1,deskBow:0.08,deskFeather:0});
ok(Math.abs(SE.deskLineY(0,s)-0.6)<1e-9,'desk line at left = deskY');
ok(Math.abs(SE.deskLineY(1,s)-0.7)<1e-9,'desk line at right = deskY+tilt');
ok(Math.abs(SE.deskLineY(0.5,s)-(0.6+0.05+0.08))<1e-9,'desk line at centre includes tilt + full bow');
// occluder alpha: hard edge, below = 255, above = 0, per column
const W=100,H=100,a=SE.buildOccluderAlpha(W,H,s); let bad=0;
for(let x=0;x<W;x++){ const ly=SE.deskLineY(x/(W-1),s)*H; for(let y=0;y<H;y++){ const want=y>=ly?255:0; if(a[y*W+x]!==want) bad++; } }
ok(bad===0,'hard-edge occluder matches the analytic desk line on every pixel (bad='+bad+')');
// feathered: monotonic down the column, 0 well above, 255 well below, ~128 at the line
const sf=Object.assign({},s,{deskFeather:20,deskTilt:0,deskBow:0,deskY:0.5}); const af=SE.buildOccluderAlpha(10,720,sf);
let mono=true; for(let y=1;y<720;y++) if(af[y*10+5]<af[(y-1)*10+5]) mono=false;
ok(mono && af[300*10+5]===0 && af[700*10+5]===255 && Math.abs(af[360*10+5]-128)<=3,'feathered edge is monotonic, 0 above, 255 below, ~half at the line ('+af[360*10+5]+')');
// light analysis
const mk=(fn)=>{const w=24,h=24,d=new Uint8ClampedArray(w*h*4);for(let y=0;y<h;y++)for(let x=0;x<w;x++){const v=fn(x,y);d.set([v[0],v[1],v[2],255],(y*w+x)*4);}return d;};
const L=SE.analyzeLight(mk((x)=>x<12?[220,200,180]:[40,40,50]),24,24), R=SE.analyzeLight(mk((x)=>x<12?[40,40,50]:[220,200,180]),24,24), F=SE.analyzeLight(mk(()=>[120,120,120]),24,24);
ok(L.side<-0.5,'bright left half -> key from left (side='+L.side.toFixed(2)+')'); ok(R.side>0.5,'bright right half -> key from right (side='+R.side.toFixed(2)+')'); ok(Math.abs(F.side)<0.01,'flat scene -> no side');
ok(L.tint[0]>L.tint[2],'warm light tint is detected (r>b): '+L.tint.join(','));
const eng=new SE(); eng.setState({lightAuto:true}); eng._light={side:0.05,top:0,lum:100,tint:[255,255,255]}; ok(eng.keySide()===-1,'balanced scene defaults to a key from the left');
eng.setState({lightAuto:false,lightSide:1}); ok(eng.keySide()===1,'manual right key respected');
// person rect anchored at bottom centre
eng.setState({personScale:0.5,personX:0,personY:0}); const r=eng.personRect(1000,600); ok(r.dx===250&&r.dw===500&&r.dy===300&&r.dh===300&&r.dy+r.dh===600,'person rect is half size, centred, bottom-anchored');
ok(SE.presetFor('podcast-studio').enabled===true && SE.presetFor('podcast-studio').deskY===0.58,'preset applies and enables');
ok(/no people/.test(SE.scenePrompt('a cozy library'))&&/^a cozy library/.test(SE.scenePrompt('a cozy library.')),'scene prompt keeps the user description first and forbids people');
console.log(fail? '\n'+fail+' FAILED':'\nALL UNIT TESTS PASSED'); process.exit(fail?1:0);
