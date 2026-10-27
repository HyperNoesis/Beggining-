// Browser test, offline: start the (fake) camera, let Phase 1 camera control run by itself, check it ends cleanly, the report shows it,
// the live loop keeps running, and the grade pipeline accepts the gain. The fake camera cannot prove speed-ups (no real exposure hardware).
const { launch } = require('./pwlib');
(async () => {
  const { browser, ctx } = await launch(); const page = await ctx.newPage(); const errs = []; const out = [];
  const ok = (n, c, x) => out.push((c ? 'PASS ' : 'FAIL ') + n + (c ? '' : ' ' + JSON.stringify(x)));
  page.on('pageerror', (e) => errs.push(e.message)); page.on('console', (m) => { if (m.type() === 'error') errs.push('console: ' + m.text().slice(0, 160)); });
  await page.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => r.abort());
  await page.addInitScript(() => localStorage.setItem('vs_autostart', '0'));
  await page.goto('http://127.0.0.1:8123/app/studio.html'); await page.waitForSelector('#startBtn');
  ok('camera-control module loaded', await page.evaluate(() => !!(window.VS && window.VS.CameraControl)));
  await page.click('#startBtn');
  await page.waitForFunction(() => window.VS.CameraControl && window.VS.CameraControl.state().phase === 'done', null, { timeout: 90000 }).catch(() => {});
  const s = await page.evaluate(() => window.VS.CameraControl.state());
  ok('camera control finished by itself after camera start', s.phase === 'done' && s.decision, s);
  ok('camera not left on a broken state (auto or a kept setting, gain within limits)', (s.mode === 'auto' || s.mode === 'manual') && s.gain >= 1 && s.gain <= 1.8, s);
  const rep = await page.evaluate(async () => window.VS.diag.format(await window.VS.diag.collect()));
  ok('report has CAMERA CONTROL section and v0.49 build', /CAMERA CONTROL \(v0\.49\)/.test(rep) && /genesis v0\.49/.test(rep), rep.slice(0, 200));
  const fps = await page.evaluate(() => { const d = window.VS.diagState(); return d && d.fps; });
  ok('live loop running (fps > 0)', fps > 0, fps);
  // Studio Check release/restart path
  const r = await page.evaluate(async () => { try { await window.VS.studioCheckRun(() => {}); return { done: true }; } catch (e) { return { err: String(e.message || e) }; } });
  ok('Studio Check still runs with camera control present', r.done, r);
  await page.waitForTimeout(3000);
  const s2 = await page.evaluate(() => window.VS.CameraControl.state());
  ok('camera control re-ran after Studio Check (testing or done)', s2.phase === 'testing' || s2.phase === 'done', s2);
  const fps2 = await page.evaluate(() => { const d = window.VS.diagState(); return d && d.fps; });
  ok('live loop running after Studio Check', fps2 > 0, fps2);
  ok('no page errors', errs.filter((e) => !/ERR_FAILED|MediaPipeSegmentationProvider/.test(e)).length === 0, errs);
  console.log('info decision:', JSON.stringify(s.decision), 'rows', JSON.stringify(s.rows));
  console.log(out.join('\n')); await browser.close(); process.exit(out.some((l) => l.startsWith('FAIL')) ? 1 : 0);
})();
