// MODNet in a background worker, offline (external hosts blocked): result must match the in-page provider, and the page's main thread must stay free.
const { launch } = require('./pwlib');
(async () => {
  const { browser, ctx } = await launch(); const out = []; const ok = (n, c, x) => out.push((c ? 'PASS ' : 'FAIL ') + n + (c ? '' : ' ' + JSON.stringify(x)));
  const page = await ctx.newPage(); const errs = [];
  page.on('pageerror', (e) => errs.push(e.message)); page.on('console', (m) => { if (m.type() === 'error') errs.push('console: ' + m.text().slice(0, 200)); });
  await page.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => r.abort());
  await page.addInitScript(() => localStorage.setItem('vs_autostart', '0'));
  await page.goto('http://127.0.0.1:8123/app/studio.html'); await page.waitForTimeout(2500);
  const r = await page.evaluate(async () => {
    const load = (u) => new Promise((res) => { const i = new Image(); i.onload = () => res(i); i.src = u; });
    const frame = await load('/fx/frame0.png'), gt = await load('/fx/gt_alpha.png');
    const c = document.createElement('canvas'); c.width = 960; c.height = 720; c.getContext('2d').drawImage(frame, 0, 0, 960, 720); c.videoWidth = 960; c.videoHeight = 720;
    // main-thread responsiveness probe: a 10 ms ticker; its worst gap shows how long the page was blocked
    let worst = 0, last = performance.now(); const tick = setInterval(() => { const n = performance.now(); worst = Math.max(worst, n - last); last = n; }, 10);
    const w = new window.VS.MODNetWorkerProvider(); const t0 = performance.now(); await w.initialize('balanced'); const loadMs = Math.round(performance.now() - t0);
    const t1 = performance.now(); const res = await w.segment(c); const segMs = Math.round(performance.now() - t1); await w.segment(c);
    clearInterval(tick);
    const sh = 144, sw2 = 192, mk = (src, isAlpha) => { const k = document.createElement('canvas'); k.width = sw2; k.height = sh; const x = k.getContext('2d', { willReadFrequently: true }); x.drawImage(src, 0, 0, sw2, sh); return x.getImageData(0, 0, sw2, sh).data; };
    const A = mk(res.segmentationMask), B = mk(gt); let inter = 0, uni = 0; for (let i = 0; i < sw2 * sh; i++) { const a = A[i * 4 + 3] > 127, b = B[i * 4] > 127; if (a && b) inter++; if (a || b) uni++; }
    const inpage = new window.VS.MODNetSegmentationProvider(); await inpage.initialize('balanced'); const r2 = await inpage.segment(c); const C = mk(r2.segmentationMask); let diff = 0; for (let i = 0; i < sw2 * sh; i++) diff += Math.abs(A[i * 4 + 3] - C[i * 4 + 3]); 
    return { label: w.label, iou: inter / Math.max(1, uni), loadMs, segMs, worstMainGapMs: Math.round(worst), meanAbsDiffVsInPage: +(diff / (sw2 * sh)).toFixed(3) };
  });
  ok('worker provider works offline and reports its engine', /worker/.test(r.label), r);
  ok('mask matches ground truth (IoU >= 0.9)', r.iou >= 0.9, r);
  ok('worker result equals the in-page provider (mean abs alpha diff < 1.5 of 255)', r.meanAbsDiffVsInPage < 1.5, r);
  ok('no page errors', errs.filter((e) => !/MediaPipeSegmentationProvider|ERR_FAILED/.test(e)).length === 0, errs);
  console.log(out.join('\n')); console.log('info:', JSON.stringify(r)); await browser.close(); process.exit(out.some((l) => l.startsWith('FAIL')) ? 1 : 0);
})();
