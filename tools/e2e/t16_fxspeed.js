// E2E: Diagnostics "Test effects speed" runs on a live (fake) camera in a scene and applies/stores a tier. Speeds are sandbox speeds, not phone numbers.
const { launch, FAKE_PROVIDER } = require('./pwlib');
(async () => {
  const { browser, ctx } = await launch(); const page = await ctx.newPage(); let bad = 0; const errs = [];
  const t = (n, c, x) => { if (!c) bad++; console.log((c ? 'PASS ' : 'FAIL ') + n + (x ? '  ' + x : '')); };
  page.on('pageerror', (e) => { if (!/MediaPipeSegmentationProvider/.test(e.message)) errs.push(e.message); });
  await page.addInitScript(() => { localStorage.setItem('vs_autostart', '0'); });
  await page.addInitScript(FAKE_PROVIDER);
  await page.goto('http://127.0.0.1:8123/app/studio.html'); await page.waitForTimeout(1500);
  const early = await page.evaluate(() => window.VS.fxSpeed.run().then(() => 'ran', (e) => e.message));
  t('refuses politely without camera', /camera/i.test(early), early);
  await page.click('#startBtn'); await page.waitForTimeout(6000);
  await page.evaluate(() => window.VS.sceneApi.pickEnv('scene-news-desk'));
  const res = await page.evaluate(() => window.VS.fxSpeed.run(null, { settleMs: 500, measureMs: 1500 }).then((r) => r, (e) => ({ error: e.message })));
  t('run returns 7 steps', res.steps && res.steps.length === 7, JSON.stringify(res.steps && res.steps.map((s) => s.label + ':' + (s.fps && s.fps.toFixed(1)))));
  t('tier chosen', ['full', 'light', 'off'].includes(res.tier), res.tier + ' | ' + res.why);
  const st = await page.evaluate(() => window.VS.sceneApi.state());
  t('tier applied to scene', res.patch ? Math.abs(st.life - res.patch.life) < 1e-6 && Math.abs(st.bloom - res.patch.bloom) < 1e-6 : false);
  t('stored for the report', await page.evaluate(() => !!localStorage.getItem('vs_fx_speed')));
  await page.evaluate(() => { const e = document.querySelector('.brand-mini'); for (let i = 0; i < 5; i++) e.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
  await page.waitForTimeout(600);
  const txt = await page.evaluate(() => (document.querySelector('.vs-diag') || {}).innerText || '');
  t('diagnostics has the button and the report line', /Test effects speed/.test(txt) && /Effects speed test 20/.test(txt));
  t('no page errors', errs.length === 0, errs.join('|'));
  await browser.close(); process.exit(bad ? 1 : 0);
})();
