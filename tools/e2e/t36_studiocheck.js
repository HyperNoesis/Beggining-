// Browser test, offline: start the (fake) camera, run Studio Check with the REAL MODNet worker, confirm report, restore, and that the live loop resumes.
const { launch } = require('./pwlib');
(async () => {
  const { browser, ctx } = await launch(); const page = await ctx.newPage(); const errs = []; const out = [];
  const ok = (n, c, x) => out.push((c ? 'PASS ' : 'FAIL ') + n + (c ? '' : ' ' + JSON.stringify(x)));
  page.on('pageerror', (e) => errs.push(e.message)); page.on('console', (m) => { if (m.type() === 'error') errs.push('console: ' + m.text().slice(0, 160)); });
  await page.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => r.abort());
  await page.addInitScript(() => localStorage.setItem('vs_autostart', '0'));
  await page.goto('http://127.0.0.1:8123/app/studio.html'); await page.waitForSelector('#startBtn'); await page.click('#startBtn'); await page.waitForTimeout(6000);
  const r = await page.evaluate(async () => { const prog = []; try { const s = await window.VS.studioCheckRun((t) => prog.push(t)); return { s, prog, report: window.VS.diag.format(await window.VS.diag.collect()) }; } catch (e) { return { err: String(e.message || e) }; } });
  ok('Studio Check completed', !r.err && r.s, r.err);
  if (r.s) {
    ok('camera section present with baseline fps', r.s.camera && r.s.camera.baseline && r.s.camera.baseline.fps != null, r.s.camera);
    ok('camera restored', r.s.camera && r.s.camera.restored === true, r.s.camera && r.s.camera.restoreError);
    const wasm = (r.s.model || []).find((m) => /WASM 320/.test(m.name));
    ok('real MODNet WASM 320 timing recorded', wasm && wasm.medianMs > 0 && !wasm.error, wasm);
    ok('report text contains STUDIO CHECK and MODEL lines', /STUDIO CHECK/.test(r.report) && /MODEL WASM 320/.test(r.report), r.report.slice(0, 300));
    console.log('info models:', JSON.stringify((r.s.model || []).map((m) => [m.name, m.engine, m.medianMs, m.error, m.note])), 'seconds', r.s.seconds);
  }
  await page.waitForTimeout(4000);
  const fps = await page.evaluate(() => { const s = window.VS.diagState(); return s && s.fps; });
  ok('live loop resumed after the check (fps reported > 0)', fps > 0, fps);
  ok('no page errors', errs.filter((e) => !/ERR_FAILED|MediaPipeSegmentationProvider/.test(e)).length === 0, errs);
  console.log(out.join('\n')); await browser.close(); process.exit(out.some((l) => l.startsWith('FAIL')) ? 1 : 0);
})();
