// Real-browser test of the AI re-render button against the MOCK relay. Needs: http.server on 8123 serving /tmp/srv (app -> project).
const { launch } = require('./pwlib'); const { createRelay, createMockProvider } = require('../../server/render-relay.js');
(async () => {
  const relay = createRelay({ provider: createMockProvider({ ms: 100 }), allowOrigin: 'http://127.0.0.1:8123' });
  await new Promise((r) => relay.listen(8798, '127.0.0.1', r));
  const { browser, ctx } = await launch(); const out = []; const ok = (n, c) => { out.push((c ? 'PASS ' : 'FAIL ') + n); };
  for (const url of ['', 'http://127.0.0.1:8798']) {
    const page = await ctx.newPage(); const errs = []; page.on('pageerror', (e) => errs.push(e.message));
    await page.addInitScript(() => localStorage.setItem('vs_autostart', '0'));
    await page.goto('http://127.0.0.1:8123/app/studio.html'); await page.waitForTimeout(1500);
    const r = await page.evaluate(async (u) => {
      window.VS.config.renderRelayUrl = u; let confirmed = 0; window.confirm = () => { confirmed++; return true; };
      const item = document.createElement('div'); document.body.appendChild(item); let got = null;
      window.VS.RenderUI.attach(item, new Blob([new Uint8Array(2048)], { type: 'video/mp4' }), (b) => { got = b.size; });
      const btn = item.querySelector('button'); if (!btn) return { btn: false };
      btn.click(); for (let i = 0; i < 80 && got === null; i++) await new Promise((r) => setTimeout(r, 250));
      return { btn: true, confirmed, got, msg: item.querySelector('[role=status]').textContent };
    }, url);
    if (!url) ok('no relay URL -> no button, nothing uploaded', r.btn === false);
    else { ok('relay URL -> button shown', r.btn); ok('privacy confirm asked once', r.confirmed === 1); ok('result delivered as a blob (' + r.got + ' bytes)', r.got > 0); ok('message says original untouched', /untouched/.test(r.msg)); }
    ok('no page errors (' + (url ? 'relay' : 'none') + ')', errs.filter((e) => !/MediaPipeSegmentationProvider/.test(e)).length === 0);
    await page.close();
  }
  console.log(out.join('\n')); await browser.close(); relay.close(); process.exit(out.some((l) => l.startsWith('FAIL')) ? 1 : 0);
})();
