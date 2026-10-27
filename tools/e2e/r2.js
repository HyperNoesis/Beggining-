const { launch } = require('/tmp/pwreal.js'); const fs=require('fs');
(async()=>{
  const { browser, ctx, log } = await launch(); const page = await ctx.newPage();
  const logs=[]; page.on('pageerror',e=>logs.push('PAGEERROR: '+e.message)); page.on('console',m=>{ if(['error'].includes(m.type())) logs.push(m.type()+': '+m.text().slice(0,160)); });
  const t0=Date.now();
  await page.goto('http://127.0.0.1:8123/app/studio.html');
  let info=null;
  for(let i=0;i<60;i++){ await page.waitForTimeout(500); info=await page.evaluate(()=>({t:window.__vsT, stats:document.getElementById('stats')?.textContent, banner:document.getElementById('degradeBanner')?.textContent, running:!!document.getElementById('stopBtn') && !document.getElementById('stopBtn').disabled})); if(info.t && info.t.firstFrame) break; }
  console.log('wall ms until first frame (incl. page load):',Date.now()-t0);
  console.log('autostart fired:',!!(info.t&&info.t.autoStart),'| first frame at',info.t&&info.t.firstFrame?Math.round(info.t.firstFrame):null,'ms after page start (perf.now) | stats:',info.stats);
  await page.waitForTimeout(6000);
  const after=await page.evaluate(()=>({stats:document.getElementById('stats').textContent, backend:localStorage.getItem('vs_seg_backend'), banner:document.getElementById('degradeBanner').textContent}));
  console.log(JSON.stringify(after));
  const png = await page.evaluate(async()=>{ const c=document.getElementById('canvas'); const v=document.createElement('video'); v.muted=true; v.srcObject=c.captureStream(10); await v.play(); await new Promise(r=>setTimeout(r,1200)); const o=document.createElement('canvas'); o.width=v.videoWidth; o.height=v.videoHeight; o.getContext('2d').drawImage(v,0,0); return o.toDataURL('image/png'); });
  fs.writeFileSync('/tmp/real2.png',Buffer.from(png.split(',')[1],'base64'));
  console.log('blocked external requests:',[...new Set(log.blocked.map(u=>u.replace(/\?.*/,'')))].slice(0,8).join(' | '));
  console.log('errors:',logs.filter(l=>!/Failed to load resource|net::|ERR_/.test(l)).join('\n')||'none');
  await browser.close();
})().catch(e=>{console.error('R2 FAIL',e.message);process.exit(1)});
