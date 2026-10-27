// M3 shot 6: colour grade, match-from-photo, skin smoothing, auto-framing in a real browser (software GL; speeds are NOT phone numbers).
const { launch } = require('./pwlib.js');
const R=[];const ok=(n,c,d)=>{R.push(!!c);console.log((c?'PASS ':'FAIL ')+n+(d!==undefined?' '+JSON.stringify(d):''))};
// average several output frames (video-encoder noise) over the centre region -> {r,g,b,sat,edge}
const meas=(page)=>page.evaluate(async()=>{const c=document.getElementById('canvas');const v=document.createElement('video');v.muted=true;v.srcObject=c.captureStream(10);await v.play();await new Promise(r=>setTimeout(r,500));
  const t=document.createElement('canvas');t.width=160;t.height=90;const x=t.getContext('2d',{willReadFrequently:true});let R=0,G=0,B=0,S=0,E=0,N=0;
  for(let f=0;f<4;f++){await new Promise(r=>setTimeout(r,250));x.drawImage(v,0,0,160,90);const d=x.getImageData(40,15,80,60).data;
    for(let i=0;i<d.length;i+=4){R+=d[i];G+=d[i+1];B+=d[i+2];S+=Math.max(d[i],d[i+1],d[i+2])-Math.min(d[i],d[i+1],d[i+2]);N++}
    for(let y=0;y<59;y++)for(let xx=0;xx<79;xx++){const p=(y*80+xx)*4,q=p+4,u=p+320;E+=Math.abs(d[p]-d[q])+Math.abs(d[p]-d[u])}}
  v.srcObject=null;return{r:R/N,g:G/N,b:B/N,sat:S/N,edge:E/(N)}});
(async()=>{const {browser,ctx}=await launch();const page=await ctx.newPage();const errs=[];page.on('pageerror',e=>errs.push(e.message));
 await page.addInitScript(()=>{try{localStorage.setItem('vs_autostart','0')}catch(e){}});
 await page.goto('http://127.0.0.1:8123/app/studio.html');await page.waitForSelector('#startBtn');
 await page.click('#startBtn');await page.waitForTimeout(4500);await page.click('.tool-tab[data-target="panel-looks"]');
 ok('grade chips shown (8)',(await page.$$('#gradeList button')).length===8);
 const base=await meas(page);
 const pick=async(id)=>{await page.click('#gradeList button[data-id='+id+']');await page.waitForTimeout(1800)};
 await pick('warm');const warm=await meas(page);ok('Warm: red-blue goes up',(warm.r-warm.b)>(base.r-base.b)+2,{base:[base.r,base.b],warm:[warm.r,warm.b]});
 await pick('cool');const cool=await meas(page);ok('Cool: red-blue goes down',(cool.r-cool.b)<(base.r-base.b)-2,{cool:[cool.r,cool.b]});
 await pick('mono');const mono=await meas(page);ok('Black & white: colourfulness drops a lot',mono.sat<base.sat*0.8,{base:base.sat,mono:mono.sat});
 await pick('none');const none=await meas(page);ok('Natural returns to the original look',Math.abs(none.r-base.r)<4&&Math.abs(none.b-base.b)<4,{none:[none.r,none.b],base:[base.r,base.b]});
 // strength
 await pick('warm');await page.evaluate(()=>{const s=document.getElementById('gradeStrength');s.value=0;s.dispatchEvent(new Event('input'))});await page.waitForTimeout(1800);
 const s0=await meas(page);ok('Strength 0 = no grade',Math.abs(s0.r-base.r)<4&&Math.abs(s0.b-base.b)<4,{s0:[s0.r,s0.b]});
 await page.evaluate(()=>{const s=document.getElementById('gradeStrength');s.value=100;s.dispatchEvent(new Event('input'))});
 // match from a photo: warm orange PNG
 await page.evaluate(()=>{const c=document.createElement('canvas');c.width=c.height=32;const x=c.getContext('2d');x.fillStyle='rgb(235,140,60)';x.fillRect(0,0,32,32);window.__png=c.toDataURL('image/png')});
 const png=await page.evaluate(()=>window.__png);await page.setInputFiles('#gradePhoto',{name:'warm.png',mimeType:'image/png',buffer:Buffer.from(png.split(',')[1],'base64')});await page.waitForTimeout(2500);
 ok('photo match applied + explained',/warmer/.test(await page.textContent('#gradeNote'))&&(await page.evaluate(()=>VS.Grade.state.id))==='photo',await page.textContent('#gradeNote'));
 const ph=await meas(page);ok('photo match: warmer than original',(ph.r-ph.b)>(base.r-base.b)+2,{ph:[ph.r,ph.b]});
 await page.setInputFiles('#gradePhoto',{name:'bad.png',mimeType:'image/png',buffer:Buffer.from('not an image')});await page.waitForTimeout(600);
 ok('bad photo -> friendly message, grade kept',/could not/.test(await page.textContent('#gradeNote'))&&(await page.evaluate(()=>VS.Grade.state.id))==='photo');
 await pick('none');
 // skin smoothing
 const sk0=await meas(page);await page.evaluate(()=>{const s=document.getElementById('skinAmount');s.value=100;s.dispatchEvent(new Event('input'))});await page.waitForTimeout(3000);
 const sk1=await meas(page);const st=await page.evaluate(()=>({skin:VS.Grade.state.skin,note:document.getElementById('gradeNote').textContent}));
 ok('skin smoothing runs without turning itself off',st.skin===1&&!/turned itself off/.test(st.note),st);
 await page.evaluate(()=>{const s=document.getElementById('skinAmount');s.value=0;s.dispatchEvent(new Event('input'))});await page.waitForTimeout(1800);

 // skin smoothing on a controlled textured picture, straight through the real render core (no camera, no fixture luck)
 const sk=await page.evaluate(async()=>{
  const W=320,H=180;const mk=(base)=>{const c=document.createElement('canvas');c.width=W;c.height=H;const x=c.getContext('2d');const im=x.createImageData(W,H);
    for(let i=0;i<W*H;i++){const n=(((i*2654435761)>>>0)%41)-20;im.data[i*4]=base[0]+n;im.data[i*4+1]=base[1]+n;im.data[i*4+2]=base[2]+n;im.data[i*4+3]=255}x.putImageData(im,0,0);return c};
  const white=document.createElement('canvas');white.width=64;white.height=36;white.getContext('2d').fillStyle='#fff';white.getContext('2d').fillRect(0,0,64,36);
  const noise=(cv)=>{const d=cv.getContext('2d').getImageData(60,30,200,120).data;let m=0,v=0,n=0;for(let i=0;i<d.length;i+=4){m+=d[i];n++}m/=n;for(let i=0;i<d.length;i+=4)v+=(d[i]-m)**2;return Math.sqrt(v/n)};
  const run=async(base,skin)=>{const cv=document.createElement('canvas');cv.width=W;cv.height=H;const core=VS.createRenderCore(()=>{});core.dispatch({type:'init',canvas:cv,assetsBase:location.href});core.dispatch({type:'resize',w:W,h:H});
    core.dispatch({type:'setGrade',state:{skin}});
    for(let f=1;f<=4;f++){core.dispatch({type:'frame',token:f,personBitmap:await createImageBitmap(mk(base)),maskBitmap:await createImageBitmap(white),w:W,h:H})}
    return noise(cv)};
  return{skinOff:await run([200,150,120],0),skinOn:await run([200,150,120],1),blueOff:await run([40,90,200],0),blueOn:await run([40,90,200],1)}});
 ok('skin smoothing cuts texture on skin-coloured pixels (>= 25%)',sk.skinOn<sk.skinOff*0.75,sk);
 ok('...and leaves non-skin (blue) pixels alone (< 5% change)',Math.abs(sk.blueOn-sk.blueOff)<sk.blueOff*0.05,sk);
 // auto-framing: start badly framed (zoomed, off to the left), turn on
 await page.evaluate(()=>{window.__boxes=[];const o=VS.Grade.onBox;VS.Grade.onBox=(b)=>{window.__boxes.push(b);o(b)};const e=VS.frameApi.engine();e.setZoom(2);e.setPan(0.3,0.4);VS.frameApi.syncUi()});
 const a0=await page.evaluate(()=>{const e=VS.frameApi.engine();return{z:e.zoom,x:e.panX,y:e.panY}});
 await page.check('#autoFrame');await page.waitForTimeout(12000);
 const a1=await page.evaluate(()=>{const e=VS.frameApi.engine();const bs=window.__boxes;return{z:e.zoom,x:e.panX,y:e.panY,boxes:bs.length,last:bs[bs.length-1]}});
 ok('person boxes reported by the pipeline',a1.boxes>=3,a1.boxes);
 ok('auto-framing moved the crop toward the person',Math.abs(a1.x-a0.x)>0.03||Math.abs(a1.z-a0.z)>0.1,{a0,a1});
 ok('zoom and pan stay legal',a1.z>=1&&a1.z<=2.4&&a1.x>=0&&a1.x<=1&&a1.y>=0&&a1.y<=1);
 ok('person ends up near the horizontal middle',a1.last&&Math.abs((a1.last.x0+a1.last.x1)/2-0.5)<0.2,a1.last);
 // smoothness: sample the pan over time, no frame jumps > 3% of the frame
 const trace=await page.evaluate(async()=>{const e=VS.frameApi.engine();const out=[];for(let i=0;i<30;i++){out.push([e.zoom,e.panX]);await new Promise(r=>setTimeout(r,60))}return out});
 let mx=0;for(let i=1;i<trace.length;i++)mx=Math.max(mx,Math.abs(trace[i][1]-trace[i-1][1]),Math.abs(trace[i][0]-trace[i-1][0])/2);
 ok('framing never snaps (max step per 60 ms < 3%)',mx<0.03,mx);
 await page.uncheck('#autoFrame');const h0=await page.evaluate(()=>{const e=VS.frameApi.engine();return[e.zoom,e.panX]});await page.waitForTimeout(1500);const h1=await page.evaluate(()=>{const e=VS.frameApi.engine();return[e.zoom,e.panX]});
 ok('turning auto-framing off stops all movement',h0[0]===h1[0]&&h0[1]===h1[1]);
 // persistence + reset
 await page.click('#gradeList button[data-id=cinema]');await page.reload();await page.waitForSelector('#startBtn');await page.click('.tool-tab[data-target="panel-looks"]');
 ok('grade remembered after reload',(await page.evaluate(()=>VS.Grade.state.id))==='cinema'&&(await page.getAttribute('#gradeList button[data-id=cinema]','aria-pressed'))==='true');
 await page.click('#gradeReset');ok('reset clears grade, skin, auto',await page.evaluate(()=>{const s=VS.Grade.state;return s.id==='none'&&s.skin===0&&!s.auto}));
 // layout 360 px
 await page.setViewportSize({width:360,height:740});const lay=await page.evaluate(()=>({sx:document.documentElement.scrollWidth>document.documentElement.clientWidth,minH:Math.min(...Array.from(document.querySelectorAll('#panel-looks button')).map(b=>b.getBoundingClientRect().height).filter(h=>h>0))}));
 ok('360 px: no sideways scroll, buttons >= 44 px',!lay.sx&&lay.minH>=44,lay);
 ok('no page errors',errs.length===0,errs);await browser.close();process.exit(R.every(Boolean)?0:1)})().catch(e=>{console.error(e);process.exit(2)});
