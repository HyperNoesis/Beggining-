// E2E: depth occlusion. With the presenter moved over a prop (podcast mic arm), turning occlusion on must change pixels there
// (prop drawn in front) while the presenter's own centre stays intact. Visual copies saved to /tmp/occ_*.png.
const { launch, FAKE_PROVIDER } = require('./pwlib'); const fs = require('fs');
(async () => {
  const { browser, ctx } = await launch(); const page = await ctx.newPage(); let bad = 0; const errs = [];
  const t = (n, c, x) => { if (!c) bad++; console.log((c ? 'PASS ' : 'FAIL ') + n + (x ? '  ' + x : '')); };
  page.on('pageerror', (e) => { if (!/MediaPipeSegmentationProvider/.test(e.message)) errs.push(e.message); });
  await page.addInitScript(() => { localStorage.setItem('vs_autostart', '0'); }); await page.addInitScript(FAKE_PROVIDER);
  await page.goto('http://127.0.0.1:8123/app/studio.html'); await page.waitForTimeout(1200); await page.click('#startBtn'); await page.waitForTimeout(5000);
  const frame = async () => page.evaluate(async () => { const c = document.getElementById('canvas'); const v = document.createElement('video'); v.muted = true; v.srcObject = c.captureStream(10); await v.play(); await new Promise((r) => setTimeout(r, 1300)); const o = document.createElement('canvas'); o.width = v.videoWidth; o.height = v.videoHeight; const x = o.getContext('2d'); x.drawImage(v, 0, 0); const png = o.toDataURL('image/png'); v.srcObject.getTracks().forEach((q) => q.stop()); return { w: o.width, h: o.height, png, px: Array.from(x.getImageData(0, 0, o.width, o.height).data) }; });
  const diff = (a, b, x0, y0, x1, y1) => { let s = 0, n = 0; for (let y = Math.round(y0 * a.h); y < Math.round(y1 * a.h); y++) for (let x = Math.round(x0 * a.w); x < Math.round(x1 * a.w); x++) { const i = (y * a.w + x) * 4; s += Math.abs(a.px[i] - b.px[i]) + Math.abs(a.px[i + 1] - b.px[i + 1]) + Math.abs(a.px[i + 2] - b.px[i + 2]); n++; } return s / n / 3; };
  const SC = process.env.SCENE || 'scene-premium-podcast', PX = +(process.env.PX || 0.28);
  await page.evaluate(([SC, PX]) => { const a = window.VS.sceneApi; a.pickEnv(SC); a.enable(true); a.patch({ life: 0, parallax: 0, bloom: 0, vignette: 0, reflection: 0, spill: 0, dof: 0, occlusion: 0, personX: PX }); }, [SC, PX]);
  await page.waitForTimeout(1500); const off = await frame(); fs.writeFileSync('/tmp/occ_off.png', Buffer.from(off.png.split(',')[1], 'base64'));
  await page.evaluate(() => window.VS.sceneApi.patch({ occlusion: 1 })); await page.waitForTimeout(1800); const on = await frame(); fs.writeFileSync('/tmp/occ_on.png', Buffer.from(on.png.split(',')[1], 'base64'));
  const mic = diff(off, on, 0.62, 0.15, 0.97, 0.55), centreFace = diff(off, on, 0.20, 0.0, 0.55, 0.3);
  t('prop region changes (mic/arm drawn in front)', mic > 1.2, 'mean diff ' + mic.toFixed(2));
  t('far-left region is untouched', centreFace < 1.5, 'mean diff ' + centreFace.toFixed(2));
  t('no page errors', errs.length === 0, errs.join('|'));
  await browser.close(); process.exit(bad ? 1 : 0);
})();
