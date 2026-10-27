const { launch } = require('./pwlib.js');
const R=[];const ok=(n,c,d)=>{R.push(!!c);console.log((c?'PASS ':'FAIL ')+n+(d!==undefined?' '+JSON.stringify(d):''))};
(async()=>{const {browser,ctx}=await launch();const page=await ctx.newPage();const errs=[];page.on('pageerror',e=>errs.push(e.message));
 await page.addInitScript(()=>{try{localStorage.setItem('vs_autostart','0')}catch(e){}});
 await page.goto('http://127.0.0.1:8123/app/studio.html');await page.waitForSelector('#startBtn');
 await page.click('#startBtn');await page.waitForTimeout(5000);
 const s=await page.evaluate(()=>{const c=window.VS.audioChain;return c?{ok:c.ok,state:c.ctx&&c.ctx.state,preset:c.preset,out:c.outputTrack()===c.processedTrack,live:c.processedTrack&&c.processedTrack.readyState,err:c.error||null}:null});
 ok('audio chain built and running',s&&s.ok&&s.state==='running'&&s.live==='live',s);
 ok('recording would use processed track',s&&s.out);
 await page.click('.tool-tab[data-target="panel-audio"]');await page.waitForTimeout(1500);
 const m=await page.evaluate(async()=>{let mx=-Infinity;for(let i=0;i<40;i++){await new Promise(r=>setTimeout(r,100));mx=Math.max(mx,window.VS.audioChain.peakDb)}return {peak:mx,lufs:window.VS.audioChain.lufs,txt:document.getElementById('audioReadout').textContent,bar:document.getElementById('audioBar').style.width}});
 ok('meter reads a signal from the fake mic',isFinite(m.peak)&&m.peak>-70,m);
 // processed vs raw: limiter keeps peaks under about -3 dBFS even with a hot signal
 const lim=await page.evaluate(async()=>{const c=window.VS.audioChain;const a=c.nodes.analyser;let mx=-Infinity;for(let i=0;i<30;i++){await new Promise(r=>setTimeout(r,100));mx=Math.max(mx,c.peakDb)}return mx});
 ok('output peak stays at or below about -1 dBFS (limiter)',lim<=-1,{maxPeakDb:lim});
 // hot signal test: a full-scale 440 Hz sine through a fresh chain; limiter must hold the peak down
 const hot=await page.evaluate(async()=>{const ac=new AudioContext();const o=ac.createOscillator();o.frequency.value=440;const g=ac.createGain();g.gain.value=1;const d=ac.createMediaStreamDestination();o.connect(g);g.connect(d);o.start();await ac.resume();const ch=new window.VS.AudioChain(d.stream);ch.setPreset('voice');await ch.resume();let mx=-Infinity;await new Promise(r=>setTimeout(r,800));for(let i=0;i<20;i++){await new Promise(r=>setTimeout(r,100));mx=Math.max(mx,ch.peakDb)}const raw=ch.raw&&true;ch.dispose();o.stop();ac.close();return mx});
 ok('full-scale input is held below clipping (peak <= -1.5 dBFS)',hot<=-1.5,{hotPeakDb:hot});
 // preset switch
 await page.selectOption('#audioPreset','podcast');const p2=await page.evaluate(()=>({preset:window.VS.audioChain.preset,hpf:window.VS.audioChain.nodes.hpf.frequency.value,comp:window.VS.audioChain.nodes.comp.ratio.value,saved:JSON.parse(localStorage.getItem('vs_audio')).preset}));
 ok('preset switch changes nodes and persists',p2.preset==='podcast'&&p2.hpf===80&&p2.comp===3.5&&p2.saved==='podcast',p2);
 await page.selectOption('#audioPreset','off');const p3=await page.evaluate(()=>({comp:window.VS.audioChain.nodes.comp.ratio.value,hpf:window.VS.audioChain.nodes.hpf.frequency.value,eqg:window.VS.audioChain.nodes.eq.map(f=>f.gain.value)}));
 ok('Off = flat (no compression, no EQ)',p3.comp===1&&p3.eqg.every(g=>g===0),p3);
 await page.selectOption('#audioPreset','voice');
 // recording has an audio track from the chain
 await page.click('#recordBtn');await page.waitForTimeout(4000);await page.click('#recordBtn');await page.waitForTimeout(2500);
 const rec=await page.evaluate(async()=>{const l=await window.VS.storage.listRecordings();const r=await window.VS.storage.getRecording(l[0].id);const b=r.blob||r;
   const v=document.createElement('video');v.muted=true;v.src=URL.createObjectURL(b);await new Promise(r=>{v.onloadedmetadata=r;setTimeout(r,4000)});return {size:b.size,hasAudio:('webkitAudioDecodedByteCount' in v)||('mozHasAudio' in v)?null:null}});
 const bytes=await page.evaluate(async()=>{const l=await window.VS.storage.listRecordings();const r=await window.VS.storage.getRecording(l[0].id);const b=r.blob||r;const buf=new Uint8Array(await b.arrayBuffer());const s=new TextDecoder('latin1').decode(buf.slice(0,Math.min(buf.length,200000)));return /A_OPUS|OpusHead|A_VORBIS/.test(s)});
 ok('recording contains an audio track (Opus)',bytes&&rec.size>10000,{size:rec.size,opus:bytes});
 // blocked context falls back to raw
 const fb=await page.evaluate(async()=>{const c=window.VS.audioChain;await c.ctx.suspend();const t=c.outputTrack();const r=t===c.raw;await c.ctx.resume();return r});
 ok('suspended AudioContext falls back to raw mic track',fb);
 // mic test
 await page.click('#audioTest');await page.waitForTimeout(5500);
 ok('mic test produces a playable clip',await page.evaluate(()=>{const p=document.getElementById('audioTestPlayer');return p.style.display==='block'&&!!p.src}));
 // stop disposes
 await page.click('#stopBtn');await page.waitForTimeout(800);ok('stop disposes the chain',(await page.evaluate(()=>window.VS.audioChain))===null);
 ok('no page errors',errs.length===0,errs);await browser.close();process.exit(R.every(Boolean)?0:1)})().catch(e=>{console.error(e);process.exit(2)});
