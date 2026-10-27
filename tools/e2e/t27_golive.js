// M3 shot 8: Go Live check in a real browser, with a REAL WebRTC "WHIP server" (a second page answers the offer).
const { launch } = require('./pwlib.js');
const R=[];const ok=(n,c,d)=>{R.push(!!c);console.log((c?'PASS ':'FAIL ')+n+(d!==undefined?' '+JSON.stringify(d):''))};
(async()=>{
 const {browser,ctx}=await launch();
 const page=await ctx.newPage();const errs=[];page.on('pageerror',e=>errs.push(e.message));
 const srv=await ctx.newPage();await srv.goto('about:blank');
 await srv.evaluate(()=>{window.pc=new RTCPeerConnection();window.got=0;});
 let posts=0;
 await ctx.route('http://127.0.0.1:8123/whip/**',async r=>{
  if(r.request().method()==='POST'){posts++;const offer=r.request().postData();
   const ans=await srv.evaluate(async(o)=>{const pc=window.pc;pc.ontrack=()=>{window.got++};await pc.setRemoteDescription({type:'offer',sdp:o});const a=await pc.createAnswer();await pc.setLocalDescription(a);await new Promise(res=>{if(pc.iceGatheringState==='complete')res();else{pc.onicegatheringstatechange=()=>pc.iceGatheringState==='complete'&&res();setTimeout(res,1500)}});return pc.localDescription.sdp},offer);
   return r.fulfill({status:201,contentType:'application/sdp',headers:{Location:'/whip/res/1'},body:ans});}
  return r.fulfill({status:200,body:''});});
 await page.addInitScript(()=>{try{localStorage.setItem('vs_autostart','0')}catch(e){}});
 await page.goto('http://127.0.0.1:8123/app/studio.html');await page.waitForSelector('#startBtn');
 await page.click('.tool-tab[data-target="panel-live"]');
 // wizard: jump to step 3 via the WHIP choice
 await page.click('.wizard-choice[data-dest="whip"]');await page.click('[data-step="2-whip"] .wizard-to-step3');
 const lvl=(id)=>page.evaluate(i=>{const e=document.querySelector('#goLiveChecklist li[data-id="'+i+'"]');return e&&e.dataset.level},id);
 // 1. camera not running + no URL -> blocked
 await page.click('#goLiveCheckBtn');await page.waitForTimeout(400);
 ok('camera off = fail',await lvl('camera')==='fail');ok('no url = fail',await lvl('url')==='fail');
 ok('checklist items are visible text',(await page.$$eval('#goLiveChecklist li',l=>l.map(x=>x.textContent.trim().length)).then(a=>a.length>=3&&a.every(n=>n>10))));
 // 2. start camera, bad url
 await page.click('.tool-tab[data-target="panel-live"]');await page.click('#startBtn');await page.waitForTimeout(2500);
 await page.fill('#whipEndpointInput','rtmp://x/y');await page.click('#saveWhipBtn');
 await page.click('#goLiveCheckBtn');await page.waitForTimeout(2200);
 ok('camera running = ok',await lvl('camera')==='ok');ok('rtmp url = fail',await lvl('url')==='fail');
 ok('mic measured (fake mic beeps) = not silent-fail',await lvl('audio')!=null);
 ok('not recording = warn',await lvl('rec')==='warn');
 // 3. good url: Go Live click -> warnings -> arms "Go live anyway", nothing streams yet
 await page.fill('#whipEndpointInput','http://127.0.0.1:8123/whip/genesis');await page.click('#saveWhipBtn');await page.waitForTimeout(200);
 const btnDis=await page.$eval('#goLiveBtn',b=>b.disabled);ok('Go Live enabled with camera+url',!btnDis);
 await page.click('#goLiveBtn');await page.waitForTimeout(2500);
 ok('warning stops first click (no POST yet)',posts===0);
 ok('button now says Go live anyway',(await page.textContent('#goLiveBtn')).trim()==='Go live anyway');
 // 4. second click goes live over REAL WebRTC
 await page.click('#goLiveBtn');
 await page.waitForFunction(()=>/Live/.test(document.getElementById('liveStatusText').textContent)&&document.getElementById('liveStatus').classList.contains('live'),null,{timeout:20000}).catch(()=>{});
 ok('went live (POSTed offer, status Live)',posts===1&&await page.$eval('#liveStatus',e=>e.classList.contains('live')));
 ok('server really received video track',await srv.evaluate(()=>window.got)>=1);
 // 5. health line shows real stats within ~7s
 await page.waitForFunction(()=>{const h=document.getElementById('liveHealth');return h&&h.style.display==='block'&&/kbps/.test(h.textContent)},null,{timeout:15000}).catch(()=>{});
 const h=await page.$eval('#liveHealth',e=>({t:e.textContent,l:e.dataset.level,d:e.style.display}));
 ok('health line shows kbps from real getStats',h.d==='block'&&/\d+ kbps/.test(h.t),h);
 // 6. End Live hides health
 await page.click('#goLiveBtn');await page.waitForTimeout(1500);
 ok('End Live -> health hidden, button back',(await page.$eval('#liveHealth',e=>e.style.display))==='none'&&(await page.textContent('#goLiveBtn')).trim()==='Go Live');
 // 7. offline -> blocked
 await ctx.setOffline(true);await page.click('#goLiveBtn');await page.waitForTimeout(1500);await ctx.setOffline(false);
 ok('offline blocks Go Live (still no 2nd POST)',posts===1&&await lvl('online')==='fail');
 // 8. OBS help present and honest
 const obs=await page.$eval('#obsHelp',e=>e.textContent);ok('OBS help says no system virtual camera',/cannot act as a camera/.test(obs)&&/Not tested/.test(obs));
 // 9. 360px layout
 await page.setViewportSize({width:360,height:740});await page.click('.tool-tab[data-target="panel-live"]');
 const lay=await page.evaluate(()=>({sx:document.documentElement.scrollWidth<=360,btn:document.getElementById('goLiveCheckBtn').getBoundingClientRect().height}));
 ok('360 px: no sideways scroll, check button >=44px',lay.sx&&lay.btn>=44,lay);
 ok('no page errors',errs.length===0,errs);
 await browser.close();const f=R.filter(x=>!x).length;console.log(f?'FAILED '+f:'ALL PASS');process.exit(f?1:0);
})();
