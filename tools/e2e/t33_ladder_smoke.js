// App-level smoke, offline: start the camera, let the background upgrade run, read the bench note. On a slow box MODNet exceeds 70 ms, so this
// exercises the speed ladder (320 -> 256 px) and the final note. It does NOT prove phone speed.
const { launch } = require('./pwlib');
(async () => {
  const { browser, ctx } = await launch(); const page = await ctx.newPage(); const errs = [], notes = [];
  page.on('pageerror', (e) => errs.push(e.message));
  await page.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => r.abort());
  await page.addInitScript(() => localStorage.setItem('vs_autostart', '0'));
  await page.goto('http://127.0.0.1:8123/app/studio.html'); await page.waitForSelector('#startBtn'); await page.click('#startBtn');
  let last = ''; const t0 = Date.now();
  while (Date.now() - t0 < 200000) { const n = await page.evaluate(() => (document.getElementById('modelBenchNote') || {}).textContent || ''); if (n && n !== last) { last = n; notes.push(n); console.log('note:', n); } if (/High-quality matting is active|Staying on the light model|unavailable/.test(n)) break; await page.waitForTimeout(1500); }
  const b = await page.evaluate(() => localStorage.getItem('vs_model_bench'));
  console.log('bench:', b); console.log('errors:', JSON.stringify(errs.filter((e) => !/MediaPipeSegmentationProvider/.test(e))));
  const sawLadder = notes.some((n) => /lighter MODNet size|MODNet, \d+ px/.test(n)) || /"edge":/.test(b || '');
  console.log(sawLadder ? 'PASS ladder ran and result recorded with v2 + edge' : 'FAIL no ladder evidence'); await browser.close(); process.exit(sawLadder ? 0 : 1);
})();
