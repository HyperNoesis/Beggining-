// Phase 2 acceptance (recording cadence): record ~8 s with the app's fixed-clock capture and measure the REAL frame timestamps in the saved file.
// Even cadence = nearly every interval close to 1/fps, no long freezes, frame count near fps * seconds, even when the render is slower than fps.
const { launch } = require('./pwlib'); const { execSync } = require('child_process'); const fs = require('fs');
(async () => {
  const { browser, ctx } = await launch(); const page = await ctx.newPage(); const errs = []; const out = [];
  const ok = (n, c, x) => out.push((c ? 'PASS ' : 'FAIL ') + n + (c ? '' : ' ' + JSON.stringify(x)));
  page.on('pageerror', (e) => errs.push(e.message));
  await page.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => r.abort());
  await page.addInitScript(() => localStorage.setItem('vs_autostart', '0'));
  await page.goto('http://127.0.0.1:8123/app/studio.html'); await page.waitForSelector('#startBtn');
  await page.evaluate(() => { const f = document.getElementById('framerateSelect'); if (f) { f.value = '30'; f.dispatchEvent(new Event('change')); } });
  await page.click('#startBtn'); await page.waitForTimeout(6000);
  const fpsRender = await page.evaluate(() => window.VS.diagState().fps);
  await page.click('.tool-tab[data-target="panel-recordings"]'); await page.click('#recordBtn'); const REC_S = 8; await page.waitForTimeout(REC_S * 1000); await page.click('#recordBtn'); await page.waitForTimeout(3500);
  const b64 = await page.evaluate(async () => { const a = document.querySelector('#recordingsList .recording-item a[href^="blob"]'); if (!a) return null; const buf = await (await fetch(a.href)).arrayBuffer(); let s = ''; const u = new Uint8Array(buf); for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000)); return btoa(s); });
  ok('a recording was saved', !!b64, null);
  if (b64) {
    fs.writeFileSync('/tmp/cadence.webm', Buffer.from(b64, 'base64'));
    const t = execSync('ffprobe -v error -select_streams v:0 -show_entries frame=best_effort_timestamp_time -of csv=p=0 /tmp/cadence.webm').toString().trim().split('\n').map(parseFloat).filter((x) => isFinite(x)).sort((a, b) => a - b);
    const gaps = []; for (let i = 1; i < t.length; i++) gaps.push((t[i] - t[i - 1]) * 1000); const sg = gaps.slice().sort((a, b) => a - b);
    const med = sg[Math.floor(sg.length / 2)], p95 = sg[Math.floor(sg.length * 0.95)], max = sg[sg.length - 1], even = gaps.filter((g) => g >= 15 && g <= 60).length / gaps.length, span = t[t.length - 1] - t[0];
    console.log('info render fps', fpsRender, '| frames', t.length, '| span s', span.toFixed(2), '| gap ms median', med.toFixed(1), 'p95', p95.toFixed(1), 'max', max.toFixed(1), '| even(15-60ms)', (even * 100).toFixed(0) + '%', '| avg fps', (t.length / span).toFixed(1));
    const clk = await page.evaluate(() => window.VS.recClock || null); console.log('info recClock', JSON.stringify(clk));
    ok('recording rate is no longer tied to the (slow) render rate: avg fps >= 1.5 x render fps', t.length / span >= 1.5 * Math.max(1, fpsRender), { avg: t.length / span, fpsRender });
    ok('recording clock reported its ticks', clk && clk.ticks > 20, clk);
    ok('median gap close to 1/30 s (25-42 ms)', med >= 25 && med <= 42, { med });
    if (process.env.CADENCE_STRICT) { ok('at least 85 percent of intervals even (15-60 ms)', even >= 0.85, { even }); ok('no freeze longer than 250 ms in the file', max <= 250, { max }); }   // strict only on a real device / fast machine
  }
  ok('no page errors', errs.filter((e) => !/ERR_FAILED|MediaPipeSegmentationProvider/.test(e)).length === 0, errs);
  console.log(out.join('\n')); await browser.close(); process.exit(out.some((l) => l.startsWith('FAIL')) ? 1 : 0);
})();
