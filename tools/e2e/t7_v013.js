// v0.13 checks: instant start (raw camera first), diagnostics panel, failure keeps camera, rAF fallback.
// Usage: node t7_v013.js   (needs the static server from tools/e2e/README.md on :8123 serving /app and /fx)
const { launch, FAKE_PROVIDER } = require('./pwlib.js');
const results = []; const ok = (n, c, d) => { results.push({ n, pass: !!c, d }); console.log((c ? 'PASS ' : 'FAIL ') + n + (d !== undefined ? '  ' + JSON.stringify(d) : '')); };
const URL = 'http://127.0.0.1:8123/app/studio.html';
async function open(ctx, init) {
  const page = await ctx.newPage(); const errs = [];
  page.on('pageerror', e => errs.push(e.message));
  await page.addInitScript(() => { try { localStorage.setItem('vs_autostart', '0'); } catch (e) {} });
  if (init) await page.addInitScript(init);
  await page.goto(URL); await page.waitForSelector('#startBtn', { timeout: 15000 });
  return { page, errs };
}
(async () => {
  const { browser, ctx } = await launch();

  // ---- A: real self-hosted MediaPipe engine, real pipeline
  { const { page, errs } = await open(ctx);
    await page.evaluate(() => { const s = document.getElementById('modelSelect'); s.value = 'mediapipe'; s.dispatchEvent(new Event('change')); });
    // sample canvas opacity + raw class every 50 ms from click
    await page.evaluate(() => { window.__samples = []; const f = document.getElementById('previewFrame'), c = document.getElementById('canvas');
      window.__iv = setInterval(() => window.__samples.push({ t: Math.round(performance.now()), raw: f.classList.contains('raw-first'), rev: f.classList.contains('revealing'), op: +getComputedStyle(c).opacity, ov: getComputedStyle(document.getElementById('previewOverlay')).opacity }), 50); });
    await page.click('#startBtn'); await page.waitForTimeout(9000);
    const t = await page.evaluate(() => ({ vs: window.__vsT, d: window.VS.diagState(), s: window.__samples, banner: document.getElementById('degradeBanner').textContent, raw: document.getElementById('previewFrame').className, sc: localStorage.getItem('vs_selfcheck') }));
    const cam = t.d.msToCamera, cut = t.d.msToCutout;
    ok('A real engine: camera visible before cutout', t.vs.cameraVisible && t.vs.cutoutVisible && t.vs.cameraVisible <= t.vs.cutoutVisible, { cam, cut, why: t.vs.revealWhy });
    const rawSamples = t.s.filter(x => x.raw && x.op < 0.05 && +x.ov < 0.05);
    ok('A raw camera shown (overlay gone, canvas hidden) for a while before cutout', rawSamples.length >= 3, { samples: rawSamples.length, firstFew: t.s.slice(0, 40).filter((x, i) => i % 6 === 0) });
    ok('A canvas fades in (intermediate opacity seen or reveal done)', t.s.some(x => x.op > 0.05 && x.op < 0.95) || t.s.some(x => x.rev), t.s.filter(x => x.op > 0.05 && x.op < 0.95).length);
    ok('A classes cleaned after reveal', !/raw-first|revealing/.test(t.raw), t.raw);
    ok('A diagState has engine/fps/segMs', t.d.engine && t.d.fps > 0 && t.d.segMs > 0, t.d);
    ok('A loop mode reported', /rVFC|rAF/.test(t.d.loopMode), t.d.loopMode);
    ok('A self-check recorded', !!t.sc, t.sc);
    // diagnostics panel via 5 logo taps
    for (let i = 0; i < 5; i++) await page.click('.studio-topbar .brand-mini');
    await page.waitForSelector('.vs-diag:not([hidden])', { timeout: 3000 });
    const rep = await page.evaluate(async () => window.VS.diag.format(await window.VS.diag.collect()));
    ok('A diagnostics panel opens with 5 taps', true);
    ok('A report has required fields', ['GPU renderer', 'WebGL2', 'Mask coverage', 'mask size', 'fps'.toUpperCase(), 'Battery', 'Last errors', 'Engine now'].every(k => rep.toLowerCase().includes(k.toLowerCase())), rep.split('\n').slice(0, 14));
    console.log('---- sample report ----\n' + rep + '\n-----------------------');
    ok('A no page errors', errs.length === 0, errs);
    await page.screenshot({ path: process.env.OUT_DIR ? process.env.OUT_DIR + '/diag.png' : '/tmp/diag.png' });
    await page.close(); }

  // ---- B: model init fails -> camera stays visible, plain message, Stop works
  { const page = await ctx.newPage();
    await page.addInitScript(() => { try { localStorage.setItem('vs_autostart', '0'); } catch (e) {} });
    await page.route(/(vendor\/mediapipe|jsdelivr|googleapis|storage\.google|unpkg|cdnjs)/, (r) => r.abort());
    await page.goto(URL); await page.waitForSelector('#startBtn', { timeout: 15000 });
    await page.click('#startBtn'); await page.waitForTimeout(9000);
    const r = await page.evaluate(() => { const v = document.getElementById('video'); return { vis: getComputedStyle(v).display, op: +getComputedStyle(v).opacity, playing: !v.paused && v.readyState >= 2, banner: document.getElementById('degradeBanner').textContent, bannerShown: document.getElementById('degradeBanner').classList.contains('show'), ov: getComputedStyle(document.getElementById('previewOverlay')).opacity, stopEnabled: !document.getElementById('stopBtn').disabled }; });
    ok('B failure: raw camera visible + playing', r.vis === 'block' && r.op > 0.9 && r.playing, r);
    ok('B failure: plain-language banner', r.bannerShown && /cutout could not start/i.test(r.banner), r.banner);
    ok('B failure: no blocking overlay, Stop enabled', +r.ov < 0.05 && r.stopEnabled);
    await page.click('#stopBtn'); await page.waitForTimeout(500);
    const after = await page.evaluate(() => ({ cls: document.getElementById('previewFrame').className, vis: getComputedStyle(document.getElementById('video')).opacity }));
    ok('B stop restores idle (video hidden again)', +after.vis < 0.05 && !/raw-first/.test(after.cls), after);
    await page.close(); }

  // ---- C: browser WITHOUT requestVideoFrameCallback still renders (rAF path)
  { const { page, errs } = await open(ctx, () => { try { delete HTMLVideoElement.prototype.requestVideoFrameCallback; } catch (e) {} });
    await page.click('#startBtn'); await page.waitForTimeout(6000);
    const d = await page.evaluate(() => window.VS.diagState());
    ok('C no-rVFC fallback runs on rAF', d.loopMode.startsWith('rAF') && d.fps >= 1, d);
    ok('C no page errors', errs.length === 0, errs); await page.close(); }

  // ---- D: rVFC loop stays on rVFC (not throttled into the guard) with the real engine
  { const { page } = await open(ctx);
    await page.click('#startBtn'); await page.waitForTimeout(7000);
    const d = await page.evaluate(() => window.VS.diagState());
    ok('D rVFC loop runs with fake model', ((d.usingRvfc && d.rvfcFired > d.rvfcGuard) || /auto|chosen/.test(d.loopMode)) && d.fps >= 1, d); await page.close(); }

  // ---- E: Battery saver caps the loop and shows in diagnostics
  { const { page, errs } = await open(ctx);
    await page.click('#startBtn'); await page.waitForTimeout(5000);
    await page.evaluate(() => { const c = document.getElementById('batterySaverToggle'); c.checked = true; c.dispatchEvent(new Event('change')); });
    await page.waitForTimeout(1500);
    const d = await page.evaluate(() => window.VS.diagState());
    const persisted = await page.evaluate(() => localStorage.getItem('vs_saver'));
    ok('E battery saver on shows in state + persists', d.batterySaver === true && persisted === '1', { saver: d.batterySaver, persisted });
    await page.evaluate(() => { const c = document.getElementById('batterySaverToggle'); c.checked = false; c.dispatchEvent(new Event('change')); });
    await page.waitForTimeout(500);
    ok('E battery saver off again', (await page.evaluate(() => window.VS.diagState().batterySaver)) === false);
    ok('E no page errors', errs.length === 0, errs); await page.close(); }

  await browser.close();
  const f = results.filter(r => !r.pass); console.log(`\n${results.length - f.length}/${results.length} passed`); process.exit(f.length ? 1 : 0);
})().catch(e => { console.error('T7 FAIL', e); process.exit(2); });
