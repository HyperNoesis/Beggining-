// E2E: wall colour (tap + flood fill + 'color' blend) and statistical colour match. Visual copies in /tmp/wall_*.png, /tmp/cm_*.png.
const { launch, FAKE_PROVIDER } = require('./pwlib'); const fs = require('fs');
(async () => {
  const { browser, ctx } = await launch(); const page = await ctx.newPage(); let bad = 0; const errs = [];
  const t = (n, c, x) => { if (!c) bad++; console.log((c ? 'PASS ' : 'FAIL ') + n + (x ? '  ' + x : '')); };
  page.on('pageerror', (e) => { if (!/MediaPipeSegmentationProvider/.test(e.message)) errs.push(e.message); });
  await page.addInitScript(() => { localStorage.setItem('vs_autostart', '0'); }); await page.addInitScript(FAKE_PROVIDER);
  await page.goto('http://127.0.0.1:8123/app/studio.html'); await page.waitForTimeout(1200); await page.click('#startBtn'); await page.waitForTimeout(5000);
  const frame = async () => page.evaluate(async () => { const c = document.getElementById('canvas'); const v = document.createElement('video'); v.muted = true; v.srcObject = c.captureStream(10); await v.play(); await new Promise((r) => setTimeout(r, 1300)); const o = document.createElement('canvas'); o.width = v.videoWidth; o.height = v.videoHeight; const x = o.getContext('2d'); x.drawImage(v, 0, 0); const png = o.toDataURL('image/png'); v.srcObject.getTracks().forEach((q) => q.stop()); return { w: o.width, h: o.height, png, px: Array.from(x.getImageData(0, 0, o.width, o.height).data) }; });
  const mean = (f, x0, y0, x1, y1) => { let r = 0, g = 0, b = 0, n = 0; for (let y = Math.round(y0 * f.h); y < Math.round(y1 * f.h); y++) for (let x = Math.round(x0 * f.w); x < Math.round(x1 * f.w); x++) { const i = (y * f.w + x) * 4; r += f.px[i]; g += f.px[i + 1]; b += f.px[i + 2]; n++; } return [r / n, g / n, b / n]; };
  const lum = (c) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  const save = (f, n) => fs.writeFileSync(n, Buffer.from(f.png.split(',')[1], 'base64'));
  const base = { life: 0, parallax: 0, bloom: 0, vignette: 0, reflection: 0, spill: 0, dof: 0, occlusion: 0, colourMatch: 0, wallOn: false };
  // ---- wall colour on the minimal studio (grey wall)
  await page.evaluate((b) => { const a = window.VS.sceneApi; a.pickEnv('scene-premium-minimal'); a.enable(true); a.patch(b); }, base); await page.waitForTimeout(1500);
  const off = await frame(); save(off, '/tmp/wall_off.png');
  await page.evaluate(() => window.VS.sceneApi.patch({ wallOn: true, wallX: 0.3, wallY: 0.3, wallColour: [40, 128, 134], wallAmt: 0.9, wallTol: 0.5 })); await page.waitForTimeout(2000);
  const on = await frame(); save(on, '/tmp/wall_on.png');
  const w0 = mean(off, 0.12, 0.2, 0.3, 0.5), w1 = mean(on, 0.12, 0.2, 0.3, 0.5), d0 = mean(off, 0.3, 0.88, 0.7, 0.96), d1 = mean(on, 0.3, 0.88, 0.7, 0.96);
  t('wall turned teal (blue+green rose above red)', w1[2] - w1[0] > (w0[2] - w0[0]) + 25 && w1[1] - w1[0] > (w0[1] - w0[0]) + 25, 'before ' + w0.map(Math.round) + ' after ' + w1.map(Math.round));
  t('wall brightness is kept (light survives)', Math.abs(lum(w1) - lum(w0)) / lum(w0) < 0.45, lum(w0).toFixed(0) + ' -> ' + lum(w1).toFixed(0));
  t('desk is untouched', Math.abs(lum(d1) - lum(d0)) < 4 && Math.abs(d1[2] - d0[2]) < 6, 'desk ' + d0.map(Math.round) + ' -> ' + d1.map(Math.round));
  await page.evaluate(() => window.VS.sceneApi.patch({ wallOn: false })); await page.waitForTimeout(1500);
  const back = await frame(); const wb = mean(back, 0.12, 0.2, 0.3, 0.5); t('reset restores the original wall', Math.abs(wb[2] - w0[2]) < 6, wb.map(Math.round) + '');
  // ---- colour match on the blue newsroom: presenter should move toward blue
  await page.evaluate((b) => { const a = window.VS.sceneApi; a.pickEnv('scene-blue-news'); a.enable(true); a.patch(Object.assign({}, b, { colourMatch: 0 })); }, base); await page.waitForTimeout(2000);
  const c0 = await frame(); save(c0, '/tmp/cm_off.png');
  await page.evaluate(() => window.VS.sceneApi.patch({ colourMatch: 1 })); await page.waitForTimeout(4500);
  const c1 = await frame(); save(c1, '/tmp/cm_on.png');
  const p0 = mean(c0, 0.45, 0.28, 0.55, 0.42), p1 = mean(c1, 0.45, 0.28, 0.55, 0.42);
  t('presenter moves toward the room colour (blue/red ratio up)', (p1[2] / p1[0]) > (p0[2] / p0[0]) * 1.03 && (p1[2] / p1[0]) < (p0[2] / p0[0]) * 1.5, (p0[2] / p0[0]).toFixed(2) + ' -> ' + (p1[2] / p1[0]).toFixed(2));
  t('presenter brightness stays within 15%', Math.abs(lum(p1) - lum(p0)) / lum(p0) < 0.15, lum(p0).toFixed(0) + ' -> ' + lum(p1).toFixed(0));
  t('no page errors', errs.length === 0, errs.join('|'));
  await browser.close(); process.exit(bad ? 1 : 0);
})();
