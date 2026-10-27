// E2E: depth of field + layered parallax. Measures sharpness (edge energy) in a far band vs a near band, with dof 0 vs 0.9, and drift per layer.
const { launch, FAKE_PROVIDER } = require('./pwlib');
(async () => {
  const { browser, ctx } = await launch(); const page = await ctx.newPage(); let bad = 0; const errs = [];
  const t = (n, c, x) => { if (!c) bad++; console.log((c ? 'PASS ' : 'FAIL ') + n + (x ? '  ' + x : '')); };
  page.on('pageerror', (e) => { if (!/MediaPipeSegmentationProvider/.test(e.message)) errs.push(e.message); });
  await page.addInitScript(() => { localStorage.setItem('vs_autostart', '0'); });
  await page.addInitScript(FAKE_PROVIDER);
  await page.goto('http://127.0.0.1:8123/app/studio.html'); await page.waitForTimeout(1200);
  await page.click('#startBtn'); await page.waitForTimeout(5000);
  const depthOk = await page.evaluate(() => fetch('assets/environments/scene-news-desk-depth.png').then((r) => r.ok));
  t('depth map file is served', depthOk);
  await page.evaluate(() => { const a = window.VS.sceneApi; a.pickEnv('scene-news-desk'); a.patch({ enabled: true, bloom: 0, vignette: 0, life: 0, parallax: 0, reflection: 0, spill: 0, dof: 0 }); });
  const fs = require('fs');
  async function frame() { return page.evaluate(async () => { const c = document.getElementById('canvas'); const v = document.createElement('video'); v.muted = true; v.srcObject = c.captureStream(10); await v.play(); await new Promise((r) => setTimeout(r, 1300));
    const o = document.createElement('canvas'); o.width = v.videoWidth; o.height = v.videoHeight; const x = o.getContext('2d'); x.drawImage(v, 0, 0); const png = o.toDataURL('image/png'); v.srcObject.getTracks().forEach((t) => t.stop()); return { w: o.width, h: o.height, png, px: Array.from(x.getImageData(0, 0, o.width, o.height).data) }; }); }
  let F = null;
  const edgeOf = (f, b) => { const x0 = Math.floor(f.w * 0.02), x1 = Math.floor(f.w * 0.22), y0 = Math.floor(f.h * b[0]), y1 = Math.floor(f.h * b[1]); let e = 0, n = 0;
    for (let j = y0; j < y1 - 1; j++) for (let i = x0; i < x1 - 1; i++) { const k = (j * f.w + i) * 4, l = k + 4, m = ((j + 1) * f.w + i) * 4; e += Math.abs(f.px[k] - f.px[l]) + Math.abs(f.px[k] - f.px[m]); n++; } return e / n; };
  const edge = async (band) => edgeOf(F, band);
  await page.waitForTimeout(1200);
  F = await frame(); fs.writeFileSync('/tmp/dof0.png', Buffer.from(F.png.split(',')[1], 'base64'));
  const far0 = await edge([0.08, 0.30]), near0 = await edge([0.62, 0.74]);
  await page.evaluate(() => window.VS.sceneApi.patch({ dof: 0.95 })); await page.waitForTimeout(1500); F = await frame(); fs.writeFileSync('/tmp/dof1.png', Buffer.from(F.png.split(',')[1], 'base64'));
  const far1 = await edge([0.08, 0.30]), near1 = await edge([0.62, 0.74]);
  t('far band gets softer with depth of field', far1 < far0 * 0.85, far0.toFixed(2) + ' -> ' + far1.toFixed(2));
  t('desk edge band stays sharp while the far band softens', near1 > near0 * 0.75 && far1 / far0 < near1 / near0, 'near/far ' + (near0 / far0).toFixed(2) + ' -> ' + (near1 / far1).toFixed(2));
  await page.evaluate(() => window.VS.sceneApi.patch({ dof: 0 })); await page.waitForTimeout(800); F = await frame();
  const back = await edge([0.08, 0.30]); t('dof 0 restores the picture', Math.abs(back - far0) / far0 < 0.1, back.toFixed(2));
  t('no page errors', errs.length === 0, errs.join('|'));
  await browser.close(); process.exit(bad ? 1 : 0);
})();
