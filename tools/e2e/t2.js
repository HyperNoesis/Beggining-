const { launch, FAKE_PROVIDER } = require('/tmp/pwlib.js'); const fs=require('fs');
async function run(mode, tag, opts={}){
  const { browser, ctx } = await launch(); const page = await ctx.newPage();
  const logs=[]; page.on('pageerror',e=>logs.push('PAGEERROR: '+e.message));
  await page.goto('http://127.0.0.1:8123/app/studio.html'); await page.waitForSelector('#startBtn',{timeout:15000});
  await page.evaluate(FAKE_PROVIDER);
  await page.evaluate((o)=>{ window.__maskW=o.maskW||256; window.__maskBlur=o.blur||1.2; const s=document.getElementById('modelSelect'); s.value='mediapipe'; s.dispatchEvent(new Event('change')); }, opts);
  await page.setInputFiles('#uploadBg','/tmp/srv/fx/flat_green.png'); await page.waitForTimeout(800);
  await page.evaluate((m)=>{ const t=document.getElementById('sharpMatteToggle'); t.checked=(m==='gl'); t.dispatchEvent(new Event('change')); }, mode);
  await page.click('#startBtn'); await page.waitForTimeout(7000);
  const png = await page.evaluate(async()=>{
    const c=document.getElementById('canvas'); const v=document.createElement('video'); v.muted=true; v.srcObject=c.captureStream(10); await v.play();
    await new Promise(r=>setTimeout(r,1200)); const o=document.createElement('canvas'); o.width=v.videoWidth; o.height=v.videoHeight; o.getContext('2d').drawImage(v,0,0); return o.toDataURL('image/png'); });
  fs.writeFileSync(`/tmp/out_${tag}.png`, Buffer.from(png.split(',')[1],'base64'));
  const st = await page.evaluate(()=>({stats:document.getElementById('stats')?.textContent, matte:document.getElementById('matteStatus')?.textContent}));
  await browser.close(); return {st,logs};
}
(async()=>{ for(const [m,t] of [['legacy','legacy'],['gl','gl']]){ const r=await run(m,t); console.log(t,JSON.stringify(r)); } })().catch(e=>{console.error('T2 FAIL',e.message);process.exit(1)});
