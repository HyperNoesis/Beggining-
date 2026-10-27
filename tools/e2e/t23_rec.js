const { launch } = require('./pwlib.js');const R=[];const ok=(n,c,d)=>{R.push(!!c);console.log((c?'PASS ':'FAIL ')+n+(d!==undefined?' '+JSON.stringify(d):''))};
(async()=>{const {browser,ctx}=await launch();const page=await ctx.newPage();const errs=[];page.on('pageerror',e=>errs.push(e.message));
await page.addInitScript(()=>{localStorage.setItem('vs_autostart','0')});await page.goto('http://127.0.0.1:8123/app/studio.html');await page.waitForSelector('#startBtn');await page.click('#startBtn');await page.waitForTimeout(4000);
await page.click('.tool-tab[data-target="panel-recordings"]');
ok('format note says what this device records',await page.evaluate(()=>/records (WebM|MP4)|did not say/.test(document.getElementById('recFormatNote').textContent)),await page.evaluate(()=>document.getElementById('recFormatNote').textContent.slice(0,60)));
await page.click('#recMarkerBtn');ok('marker before recording: plain message',await page.evaluate(()=>/Start recording first/.test(document.getElementById('recMarkerStatus').textContent)));
await page.click('#recordBtn');await page.waitForTimeout(2500);
const m1=await page.evaluate(()=>{const a=VS.recLive.marker(),b=VS.recLive.marker();return {first:a,secondIgnored:!b}});   // instant double tap: second must be ignored
await page.waitForTimeout(1500);await page.keyboard.press('m');await page.waitForTimeout(300);
ok('markers: 2 kept, double tap ignored, key M works',await page.evaluate(()=>VS.recLive.markers().length===2),m1);
await page.waitForTimeout(1200);await page.click('#recordBtn');await page.waitForTimeout(3500);
const r=await page.evaluate(async()=>{const it=document.querySelector('#recordingsList .recording-item');if(!it)return null;const img=it.querySelector('img'),a=[...it.querySelectorAll('a')].find(x=>/audio/i.test(x.textContent)),btn=it.querySelector('button');
 let ab=0;if(a){ab=(await (await fetch(a.href)).blob()).size}
 const recs=await VS.storage.listRecordings();const last=recs[recs.length-1];
 return {thumb:!!img&&img.src.length>1500,audioBytes:ab,audioName:a&&a.download,chap:btn&&btn.textContent,videoLink:!!it.querySelector('a[href^="blob"]'),savedMarkers:last&&last.meta&&last.meta.markers&&last.meta.markers.length,savedThumb:!!(last&&last.meta&&last.meta.thumb)}});
ok('finished recording has a real thumbnail',r&&r.thumb,r);
ok('separate audio file exists and is not empty',r&&r.audioBytes>1000,r&&{b:r.audioBytes,n:r.audioName});
ok('chapter button offers the 2 markers',r&&/Copy 2 chapter markers/.test(r.chap||''),r&&r.chap);
ok('video download still there; markers + thumbnail saved with the recording',r&&r.videoLink&&r.savedMarkers===2&&r.savedThumb,r);
await page.setViewportSize({width:360,height:740});await page.waitForTimeout(300);
const lay=await page.evaluate(()=>({side:document.documentElement.scrollWidth<=innerWidth+1,small:[...document.querySelectorAll('#panel-recordings button')].filter(b=>b.offsetParent&&b.getBoundingClientRect().height<44).map(b=>b.id||b.textContent)}));
ok('360 px layout ok',lay.side&&!lay.small.length,lay);ok('no page errors',!errs.length,errs);await browser.close();process.exit(R.every(Boolean)?0:1)})().catch(e=>{console.error(e);process.exit(2)});
