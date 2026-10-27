// Brand kit + scoreboard + safe area in a real browser (software GL; speeds are NOT phone numbers).
const { launch } = require('./pwlib.js');
const R=[];const ok=(n,c,d)=>{R.push(!!c);console.log((c?'PASS ':'FAIL ')+n+(d!==undefined?' '+JSON.stringify(d):''))};
// read the graphics layer (960x540) directly: exact, no video-encoder noise
const layer=(page,crop)=>page.evaluate((crop)=>{const g=VS.Graphics;g.draw(performance.now());const c=g.canvas,x=c.getContext('2d'),w=crop?500:c.width,h=crop?70:c.height;return {w,h,d:Array.from(x.getImageData(0,0,w,h).data)}},crop);
const px=(L,x,y)=>{const i=(y*L.w+x)*4;return [L.d[i],L.d[i+1],L.d[i+2],L.d[i+3]]};
const minX=(L,y0,y1,pred)=>{let m=1e9;for(let y=y0;y<y1;y++)for(let x=0;x<L.w;x++){if(pred(px(L,x,y))){m=Math.min(m,x);break}}return m};
const near=(a,b,t)=>Math.abs(a[0]-b[0])<t&&Math.abs(a[1]-b[1])<t&&Math.abs(a[2]-b[2])<t;
(async()=>{const {browser,ctx}=await launch();const page=await ctx.newPage();const errs=[];page.on('pageerror',e=>errs.push(e.message));
 await page.addInitScript(()=>{try{localStorage.setItem('vs_autostart','0')}catch(e){}});
 await page.goto('http://127.0.0.1:8123/app/studio.html');await page.waitForSelector('#startBtn');await page.click('#startBtn');await page.waitForTimeout(4000);
 // 1 colourful logo -> brand
 await page.setInputFiles('#logoUpload','/tmp/logo_orange.png');await page.waitForTimeout(800);
 await page.click('.tool-tab[data-target="panel-graphics"]');await page.click('#brandFromLogo');await page.waitForTimeout(300);
 const b=await page.evaluate(()=>({p:VS.Graphics.state.brand.primary,s:VS.Graphics.state.brand.secondary,lt:VS.Graphics.state.lt.accent,card:VS.Graphics.state.card.accent,note:document.getElementById('brandNote').textContent,sel:document.getElementById('gfxAccent').value,pi:document.getElementById('brandPrimary').value}));
 const rgb=(h)=>[1,3,5].map(i=>parseInt(h.slice(i,i+2),16));const pr=rgb(b.p);
 ok('logo -> main colour is orange (R high, B low)',pr[0]>200&&pr[2]<90,b);
 ok('second colour is the teal bar, not a copy',b.s!==b.p&&rgb(b.s)[2]<rgb(b.s)[1]+40&&/Done/.test(b.note),b.s);
 ok('applied to lower third + card, colour menu and picker follow',b.lt==='Brand'&&b.card==='Brand'&&b.sel==='Brand'&&b.pi===b.p);
 // 2 template really drawn in brand colour (graphics layer), all 4 styles
 const hit={};for(const t of ['classic','minimal','glass','bold']){await page.evaluate((t)=>{VS.Graphics.clearAll();VS.Graphics.setTemplate(t);VS.Graphics.showLT({name:'Brand test',title:'Style'},0)},t);await page.waitForTimeout(700);
  const L=await layer(page);let n=0;for(let y=0;y<L.h;y++)for(let x=0;x<L.w;x++){const p=px(L,x,y);if(p[3]>200&&near(p,pr,40))n++}hit[t]=n}
 ok('every template draws the brand colour',Object.values(hit).every(n=>n>150),hit);
 // card contrast with white text
 await page.evaluate(()=>{VS.Graphics.clearAll();VS.Graphics.showCard({title:'Hello',sub:'x'})});await page.waitForTimeout(800);
 let L=await layer(page);const c0=px(L,6,6);const lum=(c)=>{const f=c.map(v=>{v/=255;return v<=.03928?v/12.92:Math.pow((v+.055)/1.055,2.4)});return .2126*f[0]+.7152*f[1]+.0722*f[2]};
 ok('card corner holds white text (contrast >= 4.5)',1.05/(lum(c0)+.05)>=4.45,{c0});
 // 3 yellow logo: bold text turns dark
 await page.setInputFiles('#logoUpload','/tmp/logo_yellow.png');await page.waitForTimeout(800);await page.click('#brandFromLogo');await page.waitForTimeout(300);
 await page.evaluate(()=>{VS.Graphics.clearAll();VS.Graphics.setTemplate('bold');VS.Graphics.showLT({name:'WWWWWWWW',title:'t'},0)});await page.waitForTimeout(800);L=await layer(page);
 let dark=0,white=0;for(let y=0.74*540|0;y<(0.74+0.09)*540;y++)for(let x=48;x<400;x++){const p=px(L,x,y);if(p[3]>200){if(p[0]<60&&p[1]<60)dark++;if(p[0]>240&&p[1]>240&&p[2]>240)white++}}
 ok('light brand colour -> dark name text, no white text on it',dark>200&&white<20,{dark,white});
 // 4 black/white logo: honest message, colours unchanged
 const before=await page.evaluate(()=>VS.Graphics.state.brand.primary);await page.setInputFiles('#logoUpload','/tmp/logo_bw.png');await page.waitForTimeout(800);await page.click('#brandFromLogo');await page.waitForTimeout(300);
 const bw=await page.evaluate(()=>({n:document.getElementById('brandNote').textContent,p:VS.Graphics.state.brand.primary}));
 ok('black-and-white logo: says so, keeps colours',/no brand colour/.test(bw.n)&&bw.p===before,bw);
 // 5 scoreboard via UI
 await page.evaluate(()=>VS.Graphics.clearAll());await page.waitForTimeout(500);
 await page.check('#scOn');await page.fill('#scHome','Lagos FC');await page.fill('#scAway','Abuja');await page.click('#scHPlus');await page.click('#scHPlus');await page.click('#scAPlus');await page.click('#scAPlus');await page.click('#scAMinus');
 ok('score readout 2 - 1',await page.evaluate(()=>/LAGOS FC\s+2 - 1\s+ABUJA/.test(document.getElementById('scRead').textContent)),await page.evaluate(()=>document.getElementById('scRead').textContent));
 await page.waitForTimeout(500);L=await layer(page);let sc=0;for(let y=20;y<64;y++)for(let x=20;x<500;x++)if(px(L,x,y)[3]>200)sc++;
 ok('scoreboard is drawn top left',sc>3000,{sc});
 await page.check('#scClockOn');await page.click('#scClockStart');await page.waitForTimeout(300);const a1=(await layer(page,1)).d.slice();await page.waitForTimeout(1300);const a2=(await layer(page,1)).d.slice();
 const dif=(a,b)=>{let n=0;for(let i=0;i<a.length;i+=4)if(Math.abs(a[i]-b[i])+Math.abs(a[i+1]-b[i+1])+Math.abs(a[i+2]-b[i+2])>60)n++;return n};
 ok('game clock ticks while running',dif(a1,a2)>40,{changed:dif(a1,a2)});
 await page.click('#scClockStop');await page.waitForTimeout(200);const p1=(await layer(page,1)).d.slice();await page.waitForTimeout(1200);const p2=(await layer(page,1)).d.slice();
 ok('game clock holds when paused',dif(p1,p2)<5,{changed:dif(p1,p2)});
 // 6 scoreboard shows in the real output frame
 const frame=async()=>page.evaluate(async()=>{const c=document.getElementById('canvas');const v=document.createElement('video');v.muted=true;v.srcObject=c.captureStream(10);await v.play();await new Promise(r=>setTimeout(r,1500));const o=document.createElement('canvas');o.width=v.videoWidth;o.height=v.videoHeight;const x=o.getContext('2d');x.drawImage(v,0,0);const w=o.width,h=o.height;const d=Array.from(x.getImageData(0,0,Math.round(w*.5),Math.round(h*.14)).data);v.srcObject=null;return d});
 const withS=await frame();await page.uncheck('#scOn');await page.waitForTimeout(900);const noS=await frame();
 ok('scoreboard reaches the output frame',dif(withS,noS)>0.04*withS.length/4,{changed:dif(withS,noS)});
 ok('no page errors',errs.length===0,errs);await browser.close();process.exit(R.every(Boolean)?0:1)})().catch(e=>{console.error(e);process.exit(2)});
