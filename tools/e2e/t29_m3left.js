// M3 leftovers in a real browser: .cube LUT on the output, auto white balance, grade inside Looks (+undo), Trim on a real recording.
const { launch } = require('./pwlib.js');const fs=require('fs');
const R=[];const ok=(n,c,d)=>{R.push(!!c);console.log((c?'PASS ':'FAIL ')+n+(d!==undefined?' '+JSON.stringify(d):''))};
const meas=(page)=>page.evaluate(async()=>{const c=document.getElementById('canvas');const v=document.createElement('video');v.muted=true;v.srcObject=c.captureStream(10);await v.play();await new Promise(r=>setTimeout(r,500));
  const t=document.createElement('canvas');t.width=160;t.height=90;const x=t.getContext('2d',{willReadFrequently:true});let R=0,G=0,B=0,N=0;
  for(let f=0;f<4;f++){await new Promise(r=>setTimeout(r,250));x.drawImage(v,0,0,160,90);const d=x.getImageData(40,15,80,60).data;for(let i=0;i<d.length;i+=4){R+=d[i];G+=d[i+1];B+=d[i+2];N++}}
  v.srcObject=null;return{r:R/N,g:G/N,b:B/N}});
const cube=(n,fn)=>{let s='TITLE "kill red"\nLUT_3D_SIZE '+n+'\n';for(let b=0;b<n;b++)for(let g=0;g<n;g++)for(let r=0;r<n;r++){s+=fn(r/(n-1),g/(n-1),b/(n-1)).join(' ')+'\n'}return s};
(async()=>{const {browser,ctx}=await launch();const page=await ctx.newPage();const errs=[];page.on('pageerror',e=>errs.push(e.message));
 await page.addInitScript(()=>{try{localStorage.setItem('vs_autostart','0')}catch(e){}});
 await page.goto('http://127.0.0.1:8123/app/studio.html');await page.waitForSelector('#startBtn');
 await page.click('#startBtn');await page.waitForTimeout(4500);await page.click('.tool-tab[data-target="panel-looks"]');
 const base=await meas(page);
 // 1. LUT: remove red channel
 fs.writeFileSync('/tmp/killred.cube',cube(9,(r,g,b)=>[0,g,b]));fs.writeFileSync('/tmp/bad.cube','LUT_3D_SIZE 2\n0 0 0\n');
 await page.setInputFiles('#lutFile','/tmp/bad.cube');await page.waitForTimeout(300);
 ok('bad LUT gives plain message',/rows/.test(await page.textContent('#lutNote')));
 await page.setInputFiles('#lutFile','/tmp/killred.cube');await page.waitForTimeout(2500);
 const lut=await meas(page);ok('LUT applied: person red drops a lot',lut.r<base.r*0.7||lut.r<base.r-15,{base:base.r,lut:lut.r});
 ok('LUT note says loaded',/kill red/.test(await page.textContent('#lutNote')));
 await page.evaluate(()=>{const s=document.getElementById('lutAmount');s.value=0;s.dispatchEvent(new Event('input'))});await page.waitForTimeout(1800);
 const l0=await meas(page);ok('LUT amount 0 = original',Math.abs(l0.r-base.r)<6,{l0:l0.r,base:base.r});
 await page.evaluate(()=>{const s=document.getElementById('lutAmount');s.value=100;s.dispatchEvent(new Event('input'))});
 ok('LUT remembered in storage',await page.evaluate(()=>!!localStorage.getItem('vs_lut')));
 await page.click('#lutClear');await page.waitForTimeout(1800);const lc=await meas(page);ok('Remove LUT restores',Math.abs(lc.r-base.r)<6,{lc:lc.r});
 // 2. auto assist runs without errors and keeps picture sane
 await page.check('#autoAssist');await page.waitForTimeout(4000);const as=await meas(page);
 ok('auto assist on: picture still sane (not black/white)',as.r>20&&as.r<240&&as.g>20,as);
 const st=await page.evaluate(()=>window.VS.Grade.state.assist);ok('assist state saved on',st===true);
 await page.uncheck('#autoAssist');await page.waitForTimeout(2000);const as0=await meas(page);ok('assist off returns to original',Math.abs(as0.r-base.r)<8&&Math.abs(as0.b-base.b)<8,{as0:[as0.r,as0.b],base:[base.r,base.b]});
 // 3. Looks set a grade and undo restores it
 await page.click('#looksList button[data-id=podcast]');await page.waitForTimeout(800);
 let g=await page.evaluate(()=>({id:window.VS.Grade.state.id,s:window.VS.Grade.state.strength}));ok('Podcast look sets Cinema grade',g.id==='cinema'&&Math.abs(g.s-0.5)<.01,g);
 ok('grade chip shows pressed',await page.$eval('#gradeList button[data-id=cinema]',b=>b.getAttribute('aria-pressed')==='true'));
 await page.click('#looksUndo');await page.waitForTimeout(500);
 g=await page.evaluate(()=>window.VS.Grade.state.id);ok('Undo look restores Natural',g==='none',g);
 // 4. Trim a real recording
 await page.click('#recordBtn');await page.waitForTimeout(6000);await page.click('#recordBtn');await page.waitForTimeout(3000);
 await page.click('.tool-tab[data-target="panel-recordings"]').catch(()=>{});
 const trimBtn=await page.$('.recording-item .trim-btn');ok('Trim button on the saved recording',!!trimBtn);
 if(trimBtn){await trimBtn.click();await page.waitForFunction(()=>/Length/.test(document.querySelector('.trim-msg').textContent),null,{timeout:10000}).catch(()=>{});
  const len=await page.textContent('.trim-msg');ok('shows recording length',/Length \d+:\d/.test(len),len);
  await page.fill('.trim-a','0:01');await page.fill('.trim-b','0:03.5');await page.click('.trim-go');
  await page.waitForFunction(()=>/Done|did not|cannot|failed/i.test(document.querySelector('.trim-msg').textContent),null,{timeout:30000}).catch(()=>{});
  const m=await page.textContent('.trim-msg');ok('trim finished',/Done/.test(m),m);
  const r=await page.evaluate(async()=>{const a=[...document.querySelectorAll('.recording-item')].find(x=>/Trimmed copy/.test(x.textContent));if(!a)return null;const u=a.querySelector('a').href;const b=await (await fetch(u)).blob();const v=document.createElement('video');v.src=URL.createObjectURL(b);v.muted=true;await new Promise(res=>{v.onloadedmetadata=res;v.onerror=res});if(!isFinite(v.duration)){v.currentTime=1e9;await new Promise(r=>v.ontimeupdate=r)}return {size:b.size,dur:v.duration}});
  ok('trimmed copy exists, ~2.5 s long (±1.2), original kept',r&&r.size>1000&&Math.abs(r.dur-2.5)<1.2&&(await page.$$('.recording-item')).length>=2,r);
  await page.fill('.trim-a','0:05');await page.fill('.trim-b','0:02');await page.click('.trim-go');await page.waitForTimeout(300);
  ok('reversed range gives plain message',/after|half a second/.test(await page.textContent('.trim-msg')));}
 // 5. 360 px
 await page.setViewportSize({width:360,height:740});await page.click('.tool-tab[data-target="panel-looks"]');
 const lay=await page.evaluate(()=>({sx:document.documentElement.scrollWidth<=360}));ok('360 px: no sideways scroll',lay.sx,lay);
 ok('no page errors',errs.length===0,errs);
 await browser.close();const f=R.filter(x=>!x).length;console.log(f?'FAILED '+f:'ALL PASS');process.exit(f?1:0);
})();
