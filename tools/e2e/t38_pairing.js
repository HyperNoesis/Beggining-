// Phase 2 acceptance: with a MOVING subject and a segmenter that takes time (like a real phone), the mask must be paired with the camera
// frame it was computed from. Fake camera = yellow square sweeping side to side (mkmove.py). Fake model reads the frame when called, then waits
// DELAY ms (inference time) and returns the exact mask of THAT frame. Measures (a) frame skew between mask frame and person frame from the app's
// own audit, (b) completeness = how much of the square survives in the final picture (a lagging mask cuts the moving edge off).
// Usage: node t38_pairing.js [delayMs=150] ; env PAIR_EXPECT=old|new (old: print only, never fail; new: enforce).
process.env.GENESIS_FX = process.env.MOVE_FX || '/tmp/srv/fxmove';
const { launch } = require('./pwlib');
const DELAY = +(process.argv[2] || 150);
const FAKE = `
(() => {
  class MoveSeg {
    constructor(){ this.label='MoveSeg (test)'; this.costPerFrame=0; this.lowLightBoost=false; this.backend='tasks'; this.lastBoostApplied=false;
      this.g=document.createElement('canvas'); this.gx=this.g.getContext('2d',{willReadFrequently:true}); this.c=document.createElement('canvas'); this.x=this.c.getContext('2d'); }
    async initialize(){}
    async segment(video){
      const vw=video.videoWidth, vh=video.videoHeight, sw=160, sh=Math.round(sw*vh/vw);
      this.g.width=sw; this.g.height=sh; this.c.width=sw; this.c.height=sh;
      this.gx.drawImage(video,0,0,sw,sh);                                   // read the frame NOW (like the real providers do)
      const d=this.gx.getImageData(0,0,sw,sh).data, o=this.x.createImageData(sw,sh);
      for(let i=0;i<sw*sh;i++){ const R=d[i*4],G=d[i*4+1],B=d[i*4+2]; const a=(R>180&&G>150&&B<110)?255:0; o.data[i*4]=255;o.data[i*4+1]=255;o.data[i*4+2]=255;o.data[i*4+3]=a; }
      this.x.putImageData(o,0,0);
      await new Promise(r=>setTimeout(r, window.__segDelay||0));             // inference time
      return { segmentationMask: this.c };
    }
    dispose(){}
  }
  MoveSeg.sizeFor = () => 256; MoveSeg.isSupported = () => false;
  window.VS.MODNetWorkerProvider = undefined; window.VS.MODNetSegmentationProvider = MoveSeg;   // the app preloads the real MediaPipe model at page load, so use the MODNet slot
})();`;
(async () => {
  const { browser, ctx } = await launch(); const page = await ctx.newPage(); const errs = []; const out = [];
  const ok = (n, c, x) => out.push((c ? 'PASS ' : 'FAIL ') + n + (c ? '' : ' ' + JSON.stringify(x)));
  page.on('pageerror', (e) => errs.push(e.message)); page.on('console', (m) => { if (m.type() === 'error') errs.push('console: ' + m.text().slice(0, 160)); });
  await page.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => r.abort());
  await page.addInitScript(() => localStorage.setItem('vs_autostart', '0'));
  await page.goto('http://127.0.0.1:8123/app/studio.html'); await page.waitForSelector('#startBtn');
  await page.evaluate(FAKE);
  await page.evaluate((d) => {
    window.__segDelay = d; const s = document.getElementById('modelSelect'); s.value = 'modnet'; s.dispatchEvent(new Event('change'));
    const q = document.getElementById('qualitySelect'); if (q) { q.value = 'balanced'; q.dispatchEvent(new Event('change')); }
    const bs = document.getElementById('batterySaverToggle'); if (bs && bs.checked) { bs.checked = false; bs.dispatchEvent(new Event('change')); }
  }, DELAY);
  await page.setInputFiles('#uploadBg', '/tmp/srv/fx/flat_green.png'); await page.waitForTimeout(800);   // flat background: the only yellow in the picture is the person
  await page.click('#startBtn'); await page.waitForTimeout(5000);
  console.log('info stats:', await page.evaluate(() => (document.getElementById('stats') || {}).textContent));
  await page.evaluate(() => window.VS.pairReset && window.VS.pairReset());
  // sample the final picture for ~8 s: count yellow pixels that survive in the output canvas
  const res = await page.evaluate(async () => {
    const c = document.getElementById('canvas'), o = document.createElement('canvas'); o.width = 160; o.height = 120; const x = o.getContext('2d', { willReadFrequently: true });
    const vis = []; const t0 = performance.now();
    while (performance.now() - t0 < 8000) { x.drawImage(c, 0, 0, 160, 120); const d = x.getImageData(0, 0, 160, 120).data; let n = 0; for (let i = 0; i < d.length; i += 4) if (d[i] > 180 && d[i + 1] > 150 && d[i + 2] < 120) n++; vis.push(n); await new Promise((r) => setTimeout(r, 60)); }
    return { vis, pair: window.VS.pairStats ? window.VS.pairStats() : null, fps: window.VS.diagState().fps, canvas: [c.width, c.height] };
  });
  const v = res.vis.slice().sort((a, b) => a - b), ref = v[Math.floor(v.length * 0.9)] || 1, comp = res.vis.map((n) => Math.min(1, n / ref)).sort((a, b) => a - b);
  const median = comp[Math.floor(comp.length / 2)], p10 = comp[Math.floor(comp.length * 0.1)];
  console.log('info delay', DELAY, 'ms | pair', JSON.stringify(res.pair), '| completeness median', median.toFixed(3), 'p10', p10.toFixed(3), '| fps', res.fps, '| canvas', res.canvas, '| samples', res.vis.length, 'ref', ref);
  if (process.env.PAIR_EXPECT !== 'old') {
    ok('audit has data', res.pair && res.pair.n >= 8, res.pair);
    ok('mask is paired with its own frame (skew <= 1 frame for every tick)', res.pair && res.pair.max <= 1, res.pair);
    ok('exact pairing for most ticks (skew 0 in >= 90 percent)', res.pair && res.pair.zeroPct >= 90, res.pair);
    ok('moving subject stays whole in the picture (completeness median >= 0.9)', median >= 0.9, { median, p10 });
    ok('no page errors', errs.filter((e) => !/ERR_FAILED|MediaPipeSegmentationProvider/.test(e)).length === 0, errs);
  }
  console.log(out.join('\n')); await browser.close(); process.exit(out.some((l) => l.startsWith('FAIL')) ? 1 : 0);
})();
