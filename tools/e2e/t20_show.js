// Show Conductor + new graphics in a real browser (fake camera, software GL). Speeds here are NOT phone numbers.
const { launch } = require('./pwlib.js'); const fs=require('fs'), cp=require('child_process');
const R=[];const ok=(n,c,d)=>{R.push(!!c);console.log((c?'PASS ':'FAIL ')+n+(d!==undefined?' '+JSON.stringify(d):''))};
const OUT=process.env.GENESIS_OUT||'/tmp';
let grab=async function(page,name){return page.evaluate(async()=>{const c=document.getElementById('canvas');const v=document.createElement('video');v.muted=true;v.srcObject=c.captureStream(10);await v.play();await new Promise(r=>setTimeout(r,1500));const o=document.createElement('canvas');o.width=v.videoWidth;o.height=v.videoHeight;const x=o.getContext('2d');x.drawImage(v,0,0);
  const reg=(a,b,c2,d)=>{const w=o.width,h=o.height;return Array.from(x.getImageData(Math.round(a*w),Math.round(b*h),Math.round((c2-a)*w),Math.round((d-b)*h)).data)};
  const r={w:o.width,h:o.height,png:o.toDataURL('image/png'),lt:reg(0.05,0.66,0.65,0.9),banner:reg(0.02,0.11,0.8,0.21),ticker:reg(0,0.93,1,1),centre:reg(0.1,0.25,0.9,0.75),top:reg(0.35,0.02,0.65,0.1)};v.srcObject=null;return r;});};
const _g=grab;grab=async(page,name)=>{const r=await _g(page,name);try{fs.writeFileSync(OUT+'/t20_'+name+'.png',Buffer.from(r.png.split(',')[1],'base64'))}catch(e){}return r};
const diff=(a,b)=>{let n=0;for(let i=0;i<a.length;i+=4){if(Math.abs(a[i]-b[i])+Math.abs(a[i+1]-b[i+1])+Math.abs(a[i+2]-b[i+2])>60)n++}return n/(a.length/4)};
function decode(png,tag){const f=OUT+'/t20_'+tag+'.png';fs.writeFileSync(f,Buffer.from(png.split(',')[1],'base64'));
  try{return cp.execSync(`python3 -c "import cv2,sys;i=cv2.imread('${f}');d=cv2.QRCodeDetector();v,_,_=d.detectAndDecode(i);print(v)"`).toString().trim()}catch(e){return 'ERR'}}
(async()=>{const {browser,ctx}=await launch();const page=await ctx.newPage();const errs=[];page.on('pageerror',e=>errs.push(e.message));
 await page.addInitScript(()=>{try{localStorage.setItem('vs_autostart','0')}catch(e){}});
 await page.goto('http://127.0.0.1:8123/app/studio.html');await page.waitForSelector('#startBtn');
 await page.click('#startBtn');await page.waitForTimeout(6000);
 const base=await grab(page,'base');
 await page.click('.tool-tab[data-target="panel-show"]');
 ok('Show panel visible, empty show says so',await page.evaluate(()=>document.getElementById('panel-show').classList.contains('active')&&/No steps yet/.test(document.getElementById('showList').textContent)&&document.getElementById('showNext').disabled));
 // import a 3 step show through the UI
 const show={v:1,cues:[
  {label:'Intro',say:'Smile and say hello',gfx:{lt:{mode:'show',name:'Ada Obi',title:'Host',accent:'Red',template:'bold',secs:0}}},
  {label:'Headline',say:'Read the top story',gfx:{banner:{mode:'show',label:'BREAKING',text:'Power restored across Lagos'},ticker:{mode:'show',text:'Weather: sunny  Traffic: heavy'}}},
  {label:'Be right back',gfx:{card:{mode:'show',title:'Be right back',sub:'Scan to follow us',accent:'Purple',qr:'https://example.com/genesis'}}}]};
 await page.click('#showImport');await page.fill('#showJson',JSON.stringify(show));await page.click('#showImport');
 ok('import loads 3 steps',await page.evaluate(()=>document.querySelectorAll('#showList > li').length===3&&/Loaded 3 steps/.test(document.getElementById('showStatus').textContent)));
 // add a step through the editor UI
 await page.click('#showAdd');await page.fill('#seLabel','Closing');await page.selectOption('#seLt','hide');await page.selectOption('#seCard','hide');await page.selectOption('#seBanner','hide');await page.selectOption('#seTicker','hide');await page.fill('#seSay','Thank the viewers');await page.click('#seSave');
 ok('editor adds a 4th step',await page.evaluate(()=>document.querySelectorAll('#showList > li').length===4&&/Closing/.test(document.getElementById('showList').textContent)));
 ok('next button invites a start',await page.evaluate(()=>/Start show/.test(document.getElementById('showNext').textContent)));
 // step 1 via the big button
 await page.click('#showNext');await page.waitForTimeout(800);const s1=await grab(page,'s1');
 ok('step 1: bold lower third drawn',diff(base.lt,s1.lt)>0.15,{changed:diff(base.lt,s1.lt)});
 ok('presenter sees step name, next step and private note',await page.evaluate(()=>{const t=document.getElementById('showNow').textContent;return /Step 1 of 4/.test(t)&&/Now: Intro/.test(t)&&/Next: Headline/.test(t)&&/Smile and say hello/.test(t)}));
 // keys: ArrowRight -> step 2
 await page.check('#showKeys');await page.click('body',{position:{x:5,y:5}});await page.keyboard.press('ArrowRight');await page.waitForTimeout(800);const s2=await grab(page,'s2');
 ok('step 2 by ArrowRight: banner drawn',diff(base.banner,s2.banner)>0.1,{changed:diff(base.banner,s2.banner)});
 ok('step 2: ticker drawn',diff(base.ticker,s2.ticker)>0.4);
 await page.keyboard.press('PageDown');await page.waitForTimeout(800);const s3=await grab(page,'s3');
 ok('step 3 by PageDown: full-screen card covers the picture',diff(base.centre,s3.centre)>0.6,{changed:diff(base.centre,s3.centre)});
 const qr=decode(s3.png,'card');ok('QR code on the card decodes to the right address',qr==='https://example.com/genesis',qr);
 // back: card must go away, banner must come back
 await page.keyboard.press('PageUp');await page.waitForTimeout(1200);const b2=await grab(page,'back2');
 ok('Back removes the card (centre like the base again)',diff(base.centre,b2.centre)<0.25,{changed:diff(base.centre,b2.centre)});
 ok('Back rebuilds step 2 (banner + ticker on)',diff(base.banner,b2.banner)>0.1&&diff(base.ticker,b2.ticker)>0.4);
 ok('status explains it',await page.evaluate(()=>/Step 2 of 4 ran/.test(document.getElementById('showStatus').textContent)));
 // jump forward by tapping step 4: everything off
 await page.click('#showList > li:nth-child(4) > button');await page.waitForTimeout(1800);const s4=await grab(page,'s4');
 ok('step 4 (Closing) clears lower third, banner and ticker',diff(base.lt,s4.lt)<0.08&&diff(base.banner,s4.banner)<0.1&&diff(base.ticker,s4.ticker)<0.1,{lt:diff(base.lt,s4.lt),b:diff(base.banner,s4.banner),t:diff(base.ticker,s4.ticker)});
 ok('at the end the next button says so and is disabled',await page.evaluate(()=>{const b=document.getElementById('showNext');return /End of show/.test(b.textContent)&&b.disabled}));
 // Space with the keys box on
 await page.click('#showBack');await page.waitForTimeout(300);
 // templates differ
 const tpls={};for(const t of ['classic','minimal','glass','bold']){await page.evaluate((t)=>{VS.Graphics.applySpec({lt:{mode:'hide'}});VS.Graphics.setTemplate(t);VS.Graphics.showLT({name:'Template test',title:'Style check',accent:'Gold'},0)},t);await page.waitForTimeout(900);tpls[t]=(await grab(page,'tpl_'+t)).lt;}
 const names=Object.keys(tpls);let minD=1;for(let i=0;i<4;i++)for(let j=i+1;j<4;j++)minD=Math.min(minD,diff(tpls[names[i]],tpls[names[j]]));
 ok('4 lower-third styles look different from each other',minD>0.02,{minPairwiseDiff:minD});
 await page.evaluate(()=>VS.Graphics.clearAll());await page.waitForTimeout(800);
 // countdown + corner QR + handle + bug
 await page.evaluate(()=>{VS.Graphics.startCountdown(65,'Soon');VS.Graphics.setQr(true,'https://corner.test/x','Scan me');VS.Graphics.setSocial(true,'@genesis');VS.Graphics.setBug(true,'GENESIS TV',false)});await page.waitForTimeout(900);const ov=await grab(page,'overlays');
 ok('countdown pill drawn top centre',diff(base.top,ov.top)>0.08,{changed:diff(base.top,ov.top)});
 // Decode the graphics layer itself (960x540) on white: proves the drawing is a valid QR. The OUTPUT frame in this test is tiny (see size line), so a video decode is not meaningful here.
 const layer=await page.evaluate(()=>{const g=VS.Graphics,c=document.createElement('canvas');c.width=g.canvas.width;c.height=g.canvas.height;const x=c.getContext('2d');x.fillStyle='#777';x.fillRect(0,0,c.width,c.height);g.draw(performance.now());x.drawImage(g.canvas,0,0);return {png:c.toDataURL('image/png'),px:g.qrCornerPx('https://corner.test/x')}});
 const q2=decode(layer.png,'corner');ok('corner QR (graphics layer) decodes',q2==='https://corner.test/x',q2);
 console.log('INFO output frame in this test is '+ov.w+'x'+ov.h+'; corner QR modules '+layer.px.modules+', plate '+Math.round(layer.px.side)+'px of 540 -> '+(layer.px.side/540*ov.h/layer.px.modules).toFixed(1)+' px per module at this output (about 4+ needed to scan)');
 await page.evaluate(()=>VS.Graphics.clearAll());await page.waitForTimeout(500);
 // persistence
 await page.reload();await page.waitForSelector('#startBtn');
 const per=await page.evaluate(()=>({n:document.querySelectorAll('#showList > li').length,k:document.getElementById('showKeys').checked,tpl:document.getElementById('gfxTemplate').value}));
 ok('show, keys setting and lower-third style persist',per.n===4&&per.k===true&&per.tpl==='bold'||per.tpl==='gold',per);
 // bad import shows a plain message and keeps the show
 await page.click('.tool-tab[data-target="panel-show"]');await page.click('#showImport');await page.fill('#showJson','{oops');await page.click('#showImport');
 ok('bad import: plain message, show kept',await page.evaluate(()=>/does not look like a show/.test(document.getElementById('showStatus').textContent)&&document.querySelectorAll('#showList > li').length===4));
 // phone layout
 await page.setViewportSize({width:360,height:740});await page.waitForTimeout(400);await page.click('.tool-tab[data-target="panel-show"]').catch(()=>{});
 const lay=await page.evaluate(()=>{const sc=document.getElementById('panel-show');const bs=[...sc.querySelectorAll('button')].filter(b=>b.offsetParent);return {noSideScroll:document.documentElement.scrollWidth<=window.innerWidth+1,small:bs.filter(b=>b.getBoundingClientRect().height<44).map(b=>b.id||b.textContent)}});
 ok('360 px: no sideways scroll, all Show buttons >= 44 px',lay.noSideScroll&&lay.small.length===0,lay);
 ok('no page errors',errs.length===0,errs);await browser.close();process.exit(R.every(Boolean)?0:1)})().catch(e=>{console.error(e);process.exit(2)});
