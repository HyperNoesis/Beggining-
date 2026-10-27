// Full-test (auto-tune) smoke test, short durations. Needs the :8123 server like t7.
const { launch } = require('./pwlib.js');
(async () => {
  const { browser, ctx } = await launch(); const page = await ctx.newPage(); const errs = [];
  page.on('pageerror', e => errs.push(e.message));
  await page.addInitScript(() => { try { localStorage.setItem('vs_autostart', '0'); } catch (e) {} });
  await page.goto('http://127.0.0.1:8123/app/studio.html'); await page.waitForSelector('#startBtn');
  await page.click('#startBtn'); await page.waitForTimeout(5000);
  const prog = []; await page.exposeFunction('__p', t => prog.push(t));
  const sum = await page.evaluate(async () => { const s = await window.VS.tune.run(t => window.__p(t), { ms: 1500 }); return s; });
  const rep = await page.evaluate(async () => window.VS.diag.format(await window.VS.diag.collect()));
  console.log(rep.split('\n').filter(l => /FULL TEST|Camera:|callbacks|  loop|  stride|  engine|Engine notes|APPLIED/.test(l)).join('\n'));
  const stored = await page.evaluate(() => localStorage.getItem('vs_tuned'));
  const alive = await page.evaluate(() => new Promise(r => { const a = window.VS.diagState().fps; setTimeout(() => r(window.VS.diagState().fps), 3000); }));
  const ok = sum && sum.final && stored && alive > 0 && !errs.length && sum.results.length >= 5;
  console.log('stored', stored, '| fps after tuning', alive, '| progress msgs', prog.length, '| errors', errs);
  console.log(ok ? 'T8 PASS' : 'T8 FAIL'); await browser.close(); process.exit(ok ? 0 : 1);
})().catch(e => { console.error('T8 FAIL', e); process.exit(2); });
