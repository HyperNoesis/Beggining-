// Renders chosen scenes with the fake presenter and saves PNGs (visual check). Usage: node shot_scenes.js scene-a scene-b ...
const { launch, FAKE_PROVIDER } = require('./pwlib'); const fs = require('fs');
(async () => {
  const ids = process.argv.slice(2); const { browser, ctx } = await launch(); const page = await ctx.newPage();
  await page.addInitScript(() => { localStorage.setItem('vs_autostart', '0'); }); await page.addInitScript(FAKE_PROVIDER);
  await page.goto('http://127.0.0.1:8123/app/studio.html'); await page.waitForTimeout(1200); await page.click('#startBtn'); await page.waitForTimeout(5000);
  for (const id of ids) {
    await page.evaluate((i) => { const a = window.VS.sceneApi; a.pickEnv(i); a.enable(true); if (a.state().deskOn) a.autoSeat(); }, id); await page.waitForTimeout(2500);
    const f = await page.evaluate(async () => { const c = document.getElementById('canvas'); const v = document.createElement('video'); v.muted = true; v.srcObject = c.captureStream(10); await v.play(); await new Promise((r) => setTimeout(r, 1300)); const o = document.createElement('canvas'); o.width = v.videoWidth; o.height = v.videoHeight; o.getContext('2d').drawImage(v, 0, 0); const p = o.toDataURL('image/png'); v.srcObject.getTracks().forEach((t) => t.stop()); return p; });
    fs.writeFileSync('/tmp/shot_' + id + '.png', Buffer.from(f.split(',')[1], 'base64')); console.log('saved', id, JSON.stringify(await page.evaluate(() => { const s = window.VS.sceneApi.state(); return { deskY: s.deskY, scale: s.personScale, y: s.personY, dof: s.dof }; })));
  }
  await browser.close();
})();
