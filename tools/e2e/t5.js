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
  const logs=[]; page.on('pageerror',e=>logs.push('PAGEERROR: '+e.message)); page.on('console',m=>{ if(m.type()==='error'&&!/CORS|Failed to load|net::ERR/.test(m.text())) logs.push('console.error: '+m.text()); });
  await page.goto('http://127.0.0.1:8123/app/studio.html'); await page.waitForSelector('#startBtn',{timeout:15000});
  await page.evaluate(FAKE_PROVIDER);
  await page.evaluate(()=>{ const s=document.getElementById('modelSelect'); s.value='mediapipe'; s.dispatchEvent(new Event('change')); });
  await page.click('#startBtn'); await page.waitForTimeout(4000);
  await setChk(page,'sceneToggle',true); await setSel(page,'sceneLightSide','left'); await setRange(page,'sceneLight',1); await setRange(page,'sceneShadow',0); await page.waitForTimeout(3500);
  await grab(page,'s_left');
  await setSel(page,'sceneLightSide','right'); await page.waitForTimeout(3500); await grab(page,'s_right');
  await setRange(page,'sceneLight',0); await page.waitForTimeout(3000); await grab(page,'s_nolight');
  await setRange(page,'sceneShadow',1); await page.waitForTimeout(3000); await grab(page,'s_shadow');
  await setRange(page,'sceneShadow',0);
  await setChk(page,'sceneDeskOn',false); await page.waitForTimeout(3000); await grab(page,'s_deskoff');
  await setChk(page,'sceneDeskOn',true); await setRange(page,'sceneDeskY',0.46); await page.waitForTimeout(3000); await grab(page,'s_deskhigh');
  // reload: persistence
  await page.reload(); await page.waitForSelector('#startBtn',{timeout:15000});
  const persisted = await page.evaluate(()=>({on:document.getElementById('sceneToggle').checked, deskY:document.getElementById('sceneDeskY').value, side:document.getElementById('sceneLightSide').value, ctrl:getComputedStyle(document.getElementById('sceneControls')).display}));
  console.log('after reload:',JSON.stringify(persisted)); console.log('errors:',logs.length?logs.join('\n'):'none');
  await browser.close();
})().catch(e=>{console.error('T5 FAIL',e.message);process.exit(1)});
