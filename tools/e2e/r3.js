const { launch } = require('/tmp/pwreal.js'); const fs=require('fs');
// A provider that returns an EMPTY mask (what the user's phone did) and cannot be repaired -> expect camera passthrough + banner.
// A second run: repairable -> expect the switch message and a real cutout afterwards.
const BROKEN = (repairable)=>`(() => {
  class Broken {
    constructor(){ this.label='Broken test engine'; this.backend='legacy'; this.lowLightBoost=true; this.lastBoostApplied=false; this.costPerFrame=0; this.lastCoverage=null; this.c=document.createElement('canvas'); this.c.width=64; this.c.height=36; this.good=false; this.n=0; }
    async initialize(){}
    async segment(v){ const x=this.c.getContext('2d'); x.clearRect(0,0,64,36); if(this.good){ x.fillStyle='#fff'; x.fillRect(16,4,32,32); } this.n++; this.lastCoverage = this.good? 0.5 : 0; return {segmentationMask:this.c}; }
    async repair(){ ${repairable?'this.good=true; this.lastCoverage=0.5; return "tasks-cpu";':'return null;'} }
    confirmBackend(){}
    dispose(){}
  }
  window.VS.MediaPipeSegmentationProvider = Broken;
})();`;
async function run(repairable){
  const { browser, ctx } = await launch({video:'/tmp/srv/fx/real.y4m'}); const page=await ctx.newPage();
  const logs=[]; page.on('pageerror',e=>logs.push('PAGEERROR: '+e.message));
  await ctx.addInitScript(BROKEN(repairable).replace('(() => {','window.addEventListener("DOMContentLoaded",()=>{').replace(/\}\)\(\);$/,'});'));
  await page.goto('http://127.0.0.1:8123/app/studio.html');
  await page.waitForFunction(()=>window.__vsT&&window.__vsT.firstFrame,{timeout:30000});
  await page.waitForTimeout(25000);   // 45 empty frames at ~2 fps in this software-rendered sandbox
  const info=await page.evaluate(()=>({t:{wd:window.__vsT.watchdogFired?1:0,noPerson:!!window.__vsT.noPerson,repairedTo:window.__vsT.repairedTo||null},banner:document.getElementById('degradeBanner').textContent, show:document.getElementById('degradeBanner').classList.contains('show')}));
  const png = await page.evaluate(async()=>{ const c=document.getElementById('canvas'); const v=document.createElement('video'); v.muted=true; v.srcObject=c.captureStream(10); await v.play(); await new Promise(r=>setTimeout(r,1200)); const o=document.createElement('canvas'); o.width=v.videoWidth; o.height=v.videoHeight; o.getContext('2d').drawImage(v,0,0); return o.toDataURL('image/png'); });
  fs.writeFileSync('/tmp/wd_'+(repairable?'fix':'pass')+'.png',Buffer.from(png.split(',')[1],'base64'));
  console.log(repairable?'REPAIRABLE':'UNREPAIRABLE',JSON.stringify(info),'errors:',logs.join(';')||'none'); await browser.close();
}
(async()=>{ await run(false); await run(true); })().catch(e=>{console.error('R3 FAIL',e.message);process.exit(1)});
