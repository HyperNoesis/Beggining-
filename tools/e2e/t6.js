const { launch, FAKE_PROVIDER } = require('/tmp/pwlib.js'); const fs=require('fs');
async function grab(page, tag){
  const png = await page.evaluate(async()=>{
    const c=document.getElementById('canvas'); const v=document.createElement('video'); v.muted=true; v.srcObject=c.captureStream(10); await v.play();
    await new Promise(r=>setTimeout(r,1300)); const o=document.createElement('canvas'); o.width=v.videoWidth; o.height=v.videoHeight; o.getContext('2d').drawImage(v,0,0); return o.toDataURL('image/png'); });
  fs.writeFileSync(`/tmp/${tag}.png`, Buffer.from(png.split(',')[1],'base64'));
}
const setRange=(page,id,v)=>page.evaluate(([id,v])=>{const e=document.getElementById(id); e.value=v; e.dispatchEvent(new Event('input'));},[id,v]);
const setSel=(page,id,v)=>page.evaluate(([id,v])=>{const e=document.getElementById(id); e.value=v; e.dispatchEvent(new Event('change'));},[id,v]);
const setChk=(page,id,v)=>page.evaluate(([id,v])=>{const e=document.getElementById(id); e.checked=v; e.dispatchEvent(new Event('change'));},[id,v]);
(async()=>{
  const { browser, ctx } = await launch(); const page = await ctx.newPage();
  const logs=[]; page.on('pageerror',e=>logs.push('PAGEERROR: '+e.message));
  await page.goto('http://127.0.0.1:8123/app/studio.html'); await page.waitForSelector('#startBtn',{timeout:15000});
  await page.evaluate(FAKE_PROVIDER);
  await page.evaluate(()=>{ const s=document.getElementById('modelSelect'); s.value='mediapipe'; s.dispatchEvent(new Event('change')); });
  await page.click('#startBtn'); await page.waitForTimeout(4000);
  await setChk(page,'sceneToggle',true); await setSel(page,'sceneLightSide','left'); await setRange(page,'sceneDeskY',0.66);
  await setRange(page,'sceneLight',0); await setRange(page,'sceneShadow',0); await setRange(page,'sceneSoft',0); await page.waitForTimeout(3500); await grab(page,'b_base');
  await setRange(page,'sceneLight',1); await page.waitForTimeout(3000); await grab(page,'b_lightL');
  await setSel(page,'sceneLightSide','right'); await page.waitForTimeout(3000); await grab(page,'b_lightR');
  await setRange(page,'sceneLight',0); await setRange(page,'sceneShadow',1); await page.waitForTimeout(3000); await grab(page,'b_shadowR');
  await setSel(page,'sceneLightSide','left'); await page.waitForTimeout(3000); await grab(page,'b_shadowL');
  await setRange(page,'sceneShadow',0); await setRange(page,'sceneSoft',1); await page.waitForTimeout(3000); await grab(page,'b_soft');
  console.log('errors:',logs.length?logs.join('\n'):'none'); await browser.close();
})().catch(e=>{console.error('T6 FAIL',e.message);process.exit(1)});
