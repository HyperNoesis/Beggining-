// Brand kit + scoreboard + safe area in a real browser (software GL; speeds are NOT phone numbers).
const { launch } = require('./pwlib.js');
const R=[];const ok=(n,c,d)=>{R.push(!!c);console.log((c?'PASS ':'FAIL ')+n+(d!==undefined?' '+JSON.stringify(d):''))};
// read the graphics layer (960x540) directly: exact, no video-encoder noise
const layer=(page,crop)=>page.evaluate((crop)=>{const g=VS.Graphics;g.draw(performance.now());const c=g.canvas,x=c.getContext('2d'),w=crop?500:c.width,h=crop?70:c.height;return {w,h,d:Array.from(x.getImageData(0,0,w,h).data)}},crop);
const px=(L,x,y)=>{const i=(y*L.w+x)*4;return [L.d[i],L.d[i+1],L.d[i+2],L.d[i+3]]};
const minX=(L,y0,y1,pred)=>{let m=1e9;for(let y=y0;y<y1;y++)for(let x=0;x<L.w;x++){if(pred(px(L,x,y))){m=Math.min(m,x);break}}return m};
const near=(a,b,t)=>Math.abs(a[0]-b[0])<t&&Math.abs(a[1]-b[1])<t&&Math.abs(a[2]-b[2])<t;
const frame=async(page)=>page.evaluate(async()=>{const c=document.getElementById('canvas');const v=document.createElement('video');v.muted=true;v.srcObject=c.captureStream(10);await v.play();await new Promise(r=>setTimeout(r,1500));const o=document.createElement('canvas');o.width=v.videoWidth;o.height=v.videoHeight;const x=o.getContext('2d');x.drawImage(v,0,0);const w=o.width,h=o.height;const d=Array.from(x.getImageData(0,0,Math.round(w*.5),Math.round(h*.14)).data);v.srcObject=null;return d});
const dif=(a,b)=>{let n=0;for(let i=0;i<a.length;i+=4)if(Math.abs(a[i]-b[i])+Math.abs(a[i+1]-b[i+1])+Math.abs(a[i+2]-b[i+2])>60)n++;return n};
const rgb=(h)=>[1,3,5].map(i=>parseInt(h.slice(i,i+2),16));
(async()=>{const {browser,ctx}=await launch();const page=await ctx.newPage();const errs=[];page.on('pageerror',e=>errs.push(e.message));
 await page.addInitScript(()=>{try{localStorage.setItem('vs_autostart','0');localStorage.setItem('vs_gfx',JSON.stringify({lt:{name:'N',title:'T',accent:'Brand',template:'classic'},ticker:{text:'x',speed:90},rundown:[],ext:{brand:{primary:'#f0c81e',secondary:'#14a096',fromLogo:true},safe:true,score:{home:'Lagos FC',away:'Abuja',period:''}}}))}catch(e){}});
 await page.goto('http://127.0.0.1:8123/app/studio.html');await page.waitForSelector('#startBtn');
 const before='#f0c81e';
 await page.click('#startBtn');await page.waitForTimeout(4000);await page.click('.tool-tab[data-target="panel-graphics"]');
 // 7 safe area: LIVE pill moves in from the edge; guides are DOM only
 await page.evaluate(()=>{VS.Graphics.clearAll();VS.Graphics.setLive(true);VS.Graphics.setSafe(false)});await page.waitForTimeout(400);
 const red=(p)=>p[3]>200&&p[0]>180&&p[1]<70;let off=minX(await layer(page),0,80,red);
 await page.check('#gfxSafe');await page.waitForTimeout(400);let on=minX(await layer(page),0,80,red);
 ok('safe option moves tags in from 2% to 5% of the width',off<=24&&on>=46&&on<=52,{off,on});
 await page.check('#gfxGuides');await page.waitForTimeout(400);
 const g=await page.evaluate(()=>{const e=document.getElementById('safeGuide'),c=document.getElementById('canvas').getBoundingClientRect(),r=e&&e.getBoundingClientRect();return e&&{hidden:e.hidden,dw:Math.abs(r.width-c.width),dh:Math.abs(r.height-c.height),inFrame:document.getElementById('previewFrame').contains(e)}});
 ok('guide overlay sits exactly over the picture',g&&!g.hidden&&g.dw<2&&g.dh<2&&g.inFrame,g);
 const withG=await frame(page);await page.uncheck('#gfxGuides');await page.waitForTimeout(700);const noG=await frame(page);
 ok('guides are NOT in the output frame (never recorded)',dif(withG,noG)<0.01*withG.length/4,{changed:dif(withG,noG)});
 // 8 Show cue with Brand + score
 const show={v:1,cues:[{label:'Goal',gfx:{score:{mode:'show',home:'A',away:'B',h:3,a:2},lt:{mode:'show',name:'Ref',title:'x',accent:'Brand'}}}]};
 await page.evaluate(()=>VS.Graphics.clearAll());await page.click('.tool-tab[data-target="panel-show"]');await page.click('#showImport');await page.fill('#showJson',JSON.stringify(show));await page.click('#showImport');await page.click('#showNext');await page.waitForTimeout(500);
 ok('Show step applies score + Brand accent',await page.evaluate(()=>{const s=VS.Graphics.state;return s.score.on&&s.score.h===3&&s.score.a===2&&s.lt.accent==='Brand'}));
 // 9 persistence
 await page.reload();await page.waitForSelector('#startBtn');
 const per=await page.evaluate(()=>({p:VS.Graphics.state.brand.primary,safe:VS.Graphics.state.safe,home:VS.Graphics.state.score.home,g:document.getElementById('gfxGuides').checked,opt:[...document.querySelectorAll('#gfxAccent option')].some(o=>o.value==='Brand')}));
 ok('brand colour, safe option, team names persist',per.p===before&&per.safe&&per.home==='Lagos FC'&&per.opt,per);
 // 10 phone layout
 await page.setViewportSize({width:360,height:740});await page.waitForTimeout(400);await page.click('.tool-tab[data-target="panel-graphics"]').catch(()=>{});
 const lay=await page.evaluate(()=>{const bs=[...document.querySelectorAll('#panel-graphics button')].filter(b=>b.offsetParent);return {side:document.documentElement.scrollWidth<=window.innerWidth+1,small:bs.filter(b=>b.getBoundingClientRect().height<44).map(b=>b.id||b.textContent)}});
 ok('360 px: no sideways scroll, all Graphics buttons >= 44 px',lay.side&&lay.small.length===0,lay);
 ok('no page errors',errs.length===0,errs);await browser.close();process.exit(R.every(Boolean)?0:1)})().catch(e=>{console.error(e);process.exit(2)});
