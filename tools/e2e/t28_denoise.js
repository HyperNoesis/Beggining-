// RNNoise worklet in a real browser: speech-like tone + broadband noise through the worklet; noise-only should be attenuated.
const { launch } = require('./pwlib.js');const R=[];const ok=(n,c,d)=>{R.push(!!c);console.log((c?'PASS ':'FAIL ')+n+(d!==undefined?' '+JSON.stringify(d):''))};
(async()=>{const {browser,ctx}=await launch();const page=await ctx.newPage();const errs=[];page.on('pageerror',e=>errs.push(e.message));
 await page.addInitScript(()=>{try{localStorage.setItem('vs_autostart','0')}catch(e){}});
 await page.goto('http://127.0.0.1:8123/app/studio.html');await page.waitForSelector('#startBtn');await page.click('#startBtn');await page.waitForTimeout(2500);
 await page.click('.tool-tab[data-target="panel-audio"]').catch(()=>{});
 const r=await page.evaluate(async()=>{
  const ac=new AudioContext();await ac.audioWorklet.addModule('js/worklets/rnnoise-worklet.js');
  const run=async(on)=>{const sr=ac.sampleRate,N=sr*2,buf=ac.createBuffer(1,N,sr),d=buf.getChannelData(0);let seed=1;for(let i=0;i<N;i++){seed=(seed*1664525+1013904223)>>>0;d[i]=((seed/4294967296)-.5)*0.2;}
   const off=new OfflineAudioContext(1,N,sr);await off.audioWorklet.addModule('js/worklets/rnnoise-worklet.js');const s=off.createBufferSource();s.buffer=buf;const n=new AudioWorkletNode(off,'rnnoise-processor',{processorOptions:{on}});let ready=null;const rp=new Promise(r=>n.port.onmessage=e=>r(e.data.ready));s.connect(n);n.connect(off.destination);s.start();const out=await off.startRendering();const o=out.getChannelData(0);let a=0,b=0,cnt=0;for(let i=sr;i<N;i++){a+=o[i]*o[i];b+=d[i]*d[i];cnt++}return {ready:await Promise.race([rp,new Promise(r=>setTimeout(()=>r('timeout'),500))]),inRms:Math.sqrt(b/cnt),outRms:Math.sqrt(a/cnt)}};
  return {off:await run(false),on:await run(true)}});
 ok('worklet loads, rnnoise ready',r.on.ready===true,r.on.ready);
 ok('off = passthrough',Math.abs(r.off.outRms/r.off.inRms-1)<0.1,r.off);
 ok('on: pure noise attenuated by >=6 dB',r.on.outRms<r.on.inRms*0.5,r.on);
 // chain integration
 const c=await page.evaluate(async()=>{const ch=window.VS.audioChain;if(!ch||!ch.ok)return {noChain:true};const a=await ch.setDenoise(true);const b=!!ch.nodes.rn;const c2=await ch.setDenoise(false);return {a,b,off:!ch.nodes.rn&&c2===false}});
 ok('chain: setDenoise(true) wires node, false removes it',c.a===true&&c.b===true&&c.off===true,c);
 ok('no page errors',errs.length===0,errs);await browser.close();const f=R.filter(x=>!x).length;console.log(f?'FAILED '+f:'ALL PASS');process.exit(f?1:0)})();
