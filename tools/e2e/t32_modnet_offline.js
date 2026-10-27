// Real MODNet, real onnxruntime-web, loaded from the app's own files with EVERY external host blocked (= offline phone).
// Checks: runtime comes from vendor/ort (not CDN), MODNet loads from models/modnet.onnx, mask matches ground truth (IoU), no page errors.
// Needs: python3 tools/e2e/mkfx.py ; http.server 8123 serving /tmp/srv (app -> project, fx/).  Speeds here are NOT phone numbers.
const { launch } = require('./pwlib');
(async () => {
  const { browser, ctx } = await launch(); const out = []; const ok = (n, c, x) => out.push((c ? 'PASS ' : 'FAIL ') + n + (c ? '' : ' ' + JSON.stringify(x)));
  const page = await ctx.newPage(); const errs = [], blocked = [];
  page.on('pageerror', (e) => errs.push(e.message));
  await page.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => { blocked.push(r.request().url()); r.abort(); });
  await page.addInitScript(() => localStorage.setItem('vs_autostart', '0'));
  await page.goto('http://127.0.0.1:8123/app/studio.html'); await page.waitForTimeout(1500);
  const r = await page.evaluate(async () => {
    const t0 = performance.now(); const p = new window.VS.MODNetSegmentationProvider(); await p.initialize('balanced'); const loadMs = Math.round(performance.now() - t0);
    const load = (u) => new Promise((res) => { const i = new Image(); i.onload = () => res(i); i.src = u; });
    const frame = await load('/fx/frame0.png'), gt = await load('/fx/gt_alpha.png');
    const c = document.createElement('canvas'); c.width = 960; c.height = 720; c.getContext('2d').drawImage(frame, 0, 0, 960, 720);
    c.videoWidth = 960; c.videoHeight = 720; const t1 = performance.now(); const res = await p.segment(c); const segMs = Math.round(performance.now() - t1);
    const m = res.segmentationMask, w = 192, h = 144, a = document.createElement('canvas'); a.width = w; a.height = h; const ax = a.getContext('2d', { willReadFrequently: true }); ax.drawImage(m, 0, 0, w, h);
    const b = document.createElement('canvas'); b.width = w; b.height = h; const bx = b.getContext('2d', { willReadFrequently: true }); bx.drawImage(gt, 0, 0, w, h);
    const A = ax.getImageData(0, 0, w, h).data, B = bx.getImageData(0, 0, w, h).data; let inter = 0, uni = 0;
    for (let i = 0; i < w * h; i++) { const x = A[i * 4 + 3] > 127, y = B[i * 4] > 127; if (x && y) inter++; if (x || y) uni++; }
    return { label: p.label, src: window.VS.ortSource, iou: inter / Math.max(1, uni), loadMs, segMs, gpu: p.usingWebGPU };
  });
  ok('runtime came from the bundled copy, not the CDN', r.src === 'local', r);
  ok('MODNet loaded offline and is the active engine', /MODNet/.test(r.label), r);
  ok('mask matches ground truth (IoU >= 0.9)', r.iou >= 0.9, r);
  ok('nothing needed from a model/runtime host (blocked requests were only optional extras)', !blocked.some((u) => /onnxruntime|modnet|huggingface/i.test(u)), blocked);
  ok('no page errors', errs.filter((e) => !/MediaPipeSegmentationProvider/.test(e)).length === 0, errs);
  console.log(out.join('\n')); console.log('info:', JSON.stringify(r), 'blocked external requests:', blocked.length);
  await browser.close(); process.exit(out.some((l) => l.startsWith('FAIL')) ? 1 : 0);
})();
