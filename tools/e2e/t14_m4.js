// M4 end-to-end (real headless Chromium, fake camera, fake soft mask). Software GL: speeds are NOT phone numbers.
// Checks: Scene Wizard flow, library scene applies its scene.json, desk auto-detect in-page, realism passes measured on rendered frames,
// 360px-wide layout (no horizontal scroll, 44px targets), no page errors.
const { launch, FAKE_PROVIDER } = require(process.env.GENESIS_PWLIB||'./pwlib.js'); const fs = require('fs'), path = require('path');
const OUT = process.env.GENESIS_OUT || '/tmp';
const R = []; const ok = (n, c, d) => { R.push(!!c); console.log((c ? 'PASS ' : 'FAIL ') + n + (d !== undefined ? ' ' + JSON.stringify(d) : '')); };
async function frame(page) {
  return page.evaluate(async () => {
    const c = document.getElementById('canvas'); const v = document.createElement('video'); v.muted = true; v.srcObject = c.captureStream(10); await v.play();
    await new Promise((r) => setTimeout(r, 1300));
    const o = document.createElement('canvas'); o.width = v.videoWidth; o.height = v.videoHeight; const x = o.getContext('2d'); x.drawImage(v, 0, 0);
    const png = o.toDataURL('image/png'); v.srcObject.getTracks().forEach((t) => t.stop());
    return { w: o.width, h: o.height, png, px: Array.from(x.getImageData(0, 0, o.width, o.height).data) };
  });
}
const lumAt = (f, x0, y0, x1, y1) => { let s = 0, n = 0; for (let y = Math.round(y0 * f.h); y < Math.round(y1 * f.h); y++) for (let x = Math.round(x0 * f.w); x < Math.round(x1 * f.w); x++) { const i = (y * f.w + x) * 4; s += 0.2126 * f.px[i] + 0.7152 * f.px[i + 1] + 0.0722 * f.px[i + 2]; n++; } return s / Math.max(1, n); };
const save = (f, name) => fs.writeFileSync(path.join(OUT, name + '.png'), Buffer.from(f.png.split(',')[1], 'base64'));
const st = (page) => page.evaluate(() => window.VS.sceneApi.state());
(async () => {
  const { browser, ctx } = await launch(); const page = await ctx.newPage(); const errs = [];
  page.on('pageerror', (e) => errs.push(e.message));
  await page.addInitScript(() => { try { localStorage.setItem('vs_autostart', '0'); } catch (e) {} });
  await page.goto('http://127.0.0.1:8123/app/studio.html'); await page.waitForSelector('#startBtn');
  await page.evaluate(FAKE_PROVIDER);
  await page.evaluate(() => { const s = document.getElementById('modelSelect'); s.value = 'mediapipe'; s.dispatchEvent(new Event('change')); });
  await page.click('#startBtn'); await page.waitForTimeout(4000);

  // library is in the environment list
  const envs = await page.evaluate(() => Array.from(document.querySelectorAll('#envSelect option')).map((o) => o.value));
  ok('25 library scenes appear as environments', envs.filter((e) => e.startsWith('scene-')).length === 25, envs.length);

  // ---- wizard flow
  await page.click('.tool-tab[data-target="panel-environment"]').catch(() => {});
  await page.click('#sceneWizardBtn');
  ok('wizard opens at step 1 with 12 scene cards', (await page.locator('#sceneWizard:not([hidden]) .sw-card').count()) === 12);
  await page.click('#sceneWizard .sw-chip:has-text("podcast")');
  ok('type filter narrows the grid', (await page.locator('#sceneWizard .sw-card').count()) === 1);
  await page.click('#sceneWizard .sw-chip:has-text("All")');
  await page.click('#sceneWizard .sw-chip:has-text("Classic")'); await page.click('#sceneWizard .sw-card[aria-label="News Desk"]'); await page.waitForTimeout(1500);
  let s = await st(page);
  const meta = await page.evaluate(() => window.VS.SCENE_LIBRARY.find((m) => m.id === 'scene-news-desk'));
  ok('picking a scene turns Scene mode on with its scene.json settings', s.enabled && Math.abs(s.deskY - meta.deskLine.y) < 1e-6 && s.lightAuto === false && s.lightSide === meta.keyLight.side && Math.abs(s.deskBow - meta.deskLine.bow) < 1e-6, { deskY: s.deskY, side: s.lightSide });
  ok('envSelect follows', (await page.evaluate(() => document.getElementById('envSelect').value)) === 'scene-news-desk');
  await page.click('#sceneWizard .sw-nav .btn.primary');                       // -> step 2
  const before = (await st(page)).personScale;
  await page.click('#sceneWizard button[aria-label="My size more"]');
  ok('step 2: + button enlarges me', (await st(page)).personScale > before, { before, after: (await st(page)).personScale });
  await page.click('#sceneWizard .sw-nav .btn.primary');                       // -> step 3
  await page.click('#sceneWizard .sw-nav .btn.primary', { trial: true }).catch(() => {});
  await page.evaluate(() => window.VS.sceneApi.patch({ deskY: 0.8 }));
  await page.click('#sceneWizard button:has-text("Find the desk for me")'); await page.waitForFunction(() => { const t = (document.getElementById('swDeskStatus') || {}).textContent || ''; return t && !/Looking/.test(t); }, null, { timeout: 15000 }).catch(() => {});
  const status = await page.textContent('#swDeskStatus'); s = await st(page);
  ok('step 3: Find the desk runs and reports honestly', /Found it|not sure/.test(status), status);
  ok('step 3: a confident find moves the line close to the truth (0.64)', !/Found it/.test(status) || Math.abs(s.deskY + s.deskTilt / 2 + s.deskBow - (meta.deskLine.y + meta.deskLine.bow)) < 0.03, { deskY: s.deskY, bow: s.deskBow });
  // drag on the preview
  const box = await page.locator('#canvas').boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height * 0.5); await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height * 0.72, { steps: 4 }); await page.mouse.up(); await page.waitForTimeout(300);
  s = await st(page);
  ok('step 3: dragging the preview moves the desk line', Math.abs((s.deskY + s.deskTilt / 2 + s.deskBow) - 0.72) < 0.02, { mid: s.deskY + s.deskTilt / 2 + s.deskBow });
  await page.evaluate(() => window.VS.sceneApi.patch({ deskY: 0.64, deskTilt: 0, deskBow: 0.02 }));
  await page.click('#sceneWizard .sw-nav .btn.primary');                       // -> step 4
  await page.click('#sceneWizard .sw-chip:has-text("Right")'); s = await st(page);
  ok('step 4: light side can be forced', s.lightAuto === false && s.lightSide === 1);
  await page.click('#sceneWizard .sw-chip:has-text("Subtle")'); s = await st(page);
  ok('step 4: Subtle finishing touches set', s.spill > 0 && s.reflection > 0 && s.bloom > 0 && s.vignette > 0, s);
  await page.click('#sceneWizard .sw-nav .btn.primary');                       // -> step 5
  ok('step 5 reached, Done closes', (await page.locator('#sceneWizard .sw-hold').count()) === 1);
  await page.click('#sceneWizard .sw-nav .btn.primary');
  ok('wizard closed', await page.evaluate(() => document.getElementById('sceneWizard').hidden));
  await page.reload(); await page.waitForSelector('#startBtn');
  const persisted = await page.evaluate(() => { try { return JSON.parse(localStorage.getItem('vs_scene_v1'))['scene-news-desk']; } catch (e) { return null; } });
  ok('settings remembered per scene after reload', persisted && persisted.lightSide === 1 && persisted.spill > 0, persisted && { side: persisted.lightSide, spill: persisted.spill });

  // ---- measured realism passes on rendered frames
  await page.addInitScript(() => { try { localStorage.setItem('vs_autostart', '0'); } catch (e) {} });
  await page.evaluate(FAKE_PROVIDER);
  await page.evaluate(() => { const s = document.getElementById('modelSelect'); s.value = 'mediapipe'; s.dispatchEvent(new Event('change')); });
  await page.click('#startBtn'); await page.waitForTimeout(4000);
  await page.evaluate(() => { window.VS.sceneApi.pickEnv('scene-tech-review'); window.VS.sceneApi.enable(true); });
  await page.evaluate(() => { const c = document.getElementById('realismToggle'); c.checked = true; c.dispatchEvent(new Event('change')); });
  await page.evaluate(() => window.VS.sceneApi.patch({ spill: 0, reflection: 0, bloom: 0, vignette: 0, life: 0, parallax: 0 })); await page.waitForTimeout(2500);
  const off = await frame(page); save(off, 'm4_off');
  await page.evaluate(() => window.VS.sceneApi.patch({ vignette: 0.5 })); await page.waitForTimeout(2500);
  const vig = await frame(page);
  const cornerOff = (lumAt(off, 0, 0, 0.1, 0.1) + lumAt(off, 0.9, 0, 1, 0.1)) / 2, cornerVig = (lumAt(vig, 0, 0, 0.1, 0.1) + lumAt(vig, 0.9, 0, 1, 0.1)) / 2;
  const centreOff = lumAt(off, 0.4, 0.2, 0.6, 0.3), centreVig = lumAt(vig, 0.4, 0.2, 0.6, 0.3);
  ok('vignette darkens the corners more than the centre', (cornerOff - cornerVig) > 1.5 * Math.max(0.3, centreOff - centreVig), { cornerDrop: +(cornerOff - cornerVig).toFixed(2), centreDrop: +(centreOff - centreVig).toFixed(2) });
  await page.evaluate(() => window.VS.sceneApi.patch({ vignette: 0, bloom: 1 })); await page.waitForTimeout(2500);
  const blm = await frame(page);
  const cyanOff = lumAt(off, 0.3, 0.52, 0.7, 0.6), cyanBloom = lumAt(blm, 0.3, 0.52, 0.7, 0.6);
  ok('bloom brightens the area around bright lights', cyanBloom - cyanOff > 1.0, { off: +cyanOff.toFixed(1), bloom: +cyanBloom.toFixed(1) });
  await page.evaluate(() => window.VS.sceneApi.patch({ bloom: 0, reflection: 1 })); await page.waitForTimeout(2500);
  const rfl = await frame(page); save(rfl, 'm4_reflect');
  const deskY = (await page.evaluate(() => window.VS.sceneApi.state())).deskY;
  const dTop = deskY + 0.005, dBot = deskY + 0.06;
  let diffPx = 0, tot = 0; for (let y = Math.round(dTop * off.h); y < Math.round(dBot * off.h); y++) for (let x = Math.round(0.3 * off.w); x < Math.round(0.7 * off.w); x++) { const i = (y * off.w + x) * 4; tot++; if (Math.abs(off.px[i] - rfl.px[i]) + Math.abs(off.px[i + 1] - rfl.px[i + 1]) + Math.abs(off.px[i + 2] - rfl.px[i + 2]) > 12) diffPx++; }
  const outside = lumAt(off, 0.02, deskY + 0.01, 0.15, deskY + 0.06) - lumAt(rfl, 0.02, deskY + 0.01, 0.15, deskY + 0.06);
  ok('desk reflection appears on the desk top under the person', diffPx / tot > 0.05, { changedShare: +(diffPx / tot).toFixed(3) });
  ok('reflection stays off the desk away from the person', Math.abs(outside) < 1.5, { delta: +outside.toFixed(2) });
  await page.evaluate(() => window.VS.sceneApi.patch({ reflection: 0, spill: 1 })); await page.waitForTimeout(2500);
  const spl = await frame(page);
  // person area (centre) changes colour; the far background does not
  const pc = (f) => { const i = (Math.round(0.6 * f.h) * f.w + Math.round(0.5 * f.w)) * 4; return [f.px[i], f.px[i + 1], f.px[i + 2]]; };
  const a0 = pc(off), a1 = pc(spl);
  ok('colour spill changes the person colour towards the room', Math.abs(a0[2] - a1[2]) + Math.abs(a0[0] - a1[0]) > 3, { off: a0, spill: a1 });
  ok('background corner unchanged by spill', Math.abs(lumAt(off, 0, 0, 0.1, 0.1) - lumAt(spl, 0, 0, 0.1, 0.1)) < 1.5);
  // before/after hold
  await page.evaluate(() => window.VS.sceneApi.patch({ spill: 0.5, reflection: 0.3, bloom: 0.4, vignette: 0.4 })); await page.waitForTimeout(2000);
  const after = await frame(page);
  await page.evaluate(() => window.VS.sceneApi.before(true)); await page.waitForTimeout(2500);
  const bef = await frame(page); save(bef, 'm4_before');
  await page.evaluate(() => window.VS.sceneApi.before(false)); await page.waitForTimeout(2500);
  const back = await frame(page); save(back, 'm4_after');
  let dBA = 0; for (let i = 0; i < after.px.length; i += 4) if (Math.abs(after.px[i] - bef.px[i]) + Math.abs(after.px[i + 1] - bef.px[i + 1]) + Math.abs(after.px[i + 2] - bef.px[i + 2]) > 40) dBA++;
  let dBack = 0; for (let i = 0; i < after.px.length; i += 4) if (Math.abs(after.px[i] - back.px[i]) + Math.abs(after.px[i + 1] - back.px[i + 1]) + Math.abs(after.px[i + 2] - back.px[i + 2]) > 40) dBack++;
  ok('hold-to-see-before changes the picture a lot', dBA / (after.px.length / 4) > 0.03, { changed: +(dBA / (after.px.length / 4)).toFixed(3) });
  ok('releasing restores the scene', dBack / (after.px.length / 4) < 0.01, { changed: +(dBack / (after.px.length / 4)).toFixed(4) });

  // ---- M4 subtle life: measured on rendered frames
  const share = (A, B, x0, y0, x1, y1, thr) => { let n = 0, tot = 0; for (let y = Math.round(y0 * A.h); y < Math.round(y1 * A.h); y++) for (let x = Math.round(x0 * A.w); x < Math.round(x1 * A.w); x++) { const i = (y * A.w + x) * 4; tot++; if (Math.abs(A.px[i] - B.px[i]) + Math.abs(A.px[i + 1] - B.px[i + 1]) + Math.abs(A.px[i + 2] - B.px[i + 2]) > thr) n++; } return n / Math.max(1, tot); };
  const meanAbs = (A, B, x0, y0, x1, y1) => { let sum = 0, tot = 0; for (let y = Math.round(y0 * A.h); y < Math.round(y1 * A.h); y++) for (let x = Math.round(x0 * A.w); x < Math.round(x1 * A.w); x++) { const i = (y * A.w + x) * 4; tot++; sum += Math.abs(A.px[i] - B.px[i]) + Math.abs(A.px[i + 1] - B.px[i + 1]) + Math.abs(A.px[i + 2] - B.px[i + 2]); } return sum / Math.max(1, tot); };
  await page.evaluate(() => { window.VS.sceneApi.pickEnv('scene-news-desk'); window.VS.sceneApi.enable(true); window.VS.sceneApi.patch({ spill: 0, reflection: 0, bloom: 0, vignette: 0, life: 0, parallax: 0, personX: 0 }); });
  await page.waitForTimeout(2500);
  const l0a = await frame(page); await page.waitForTimeout(3500); const l0b = await frame(page);
  const still = share(l0a, l0b, 0.11, 0.17, 0.9, 0.46, 12);
  await page.evaluate(() => window.VS.sceneApi.patch({ life: 1 })); await page.waitForTimeout(2500);
  const l1a = await frame(page); await page.waitForTimeout(3500); const l1b = await frame(page); save(l1b, 'm4_life');
  const moving = share(l1a, l1b, 0.11, 0.17, 0.9, 0.46, 12);
  ok('life off: the screens stay still over 3.5 s', still < 0.02, { changed: +still.toFixed(4) });
  ok('life on: the screens and light visibly move over 3.5 s', moving > still + 0.02, { still: +still.toFixed(4), moving: +moving.toFixed(4) });
  // parallax: the room drifts only when the presenter moves sideways, and only if parallax is on
  const strip = [0.02, 0.05, 0.30, 0.46];   // left part of the video wall: lots of edges, nowhere near the presenter
  await page.evaluate(() => window.VS.sceneApi.patch({ life: 0, parallax: 0, personX: 0 })); await page.waitForTimeout(2500);
  const p0a = await frame(page);
  await page.evaluate(() => window.VS.sceneApi.patch({ personX: 0.3 })); await page.waitForTimeout(5000);
  const p0b = await frame(page);
  const dOff = meanAbs(p0a, p0b, ...strip);
  await page.evaluate(() => window.VS.sceneApi.patch({ personX: 0, parallax: 1 })); await page.waitForTimeout(5000);
  const p1a = await frame(page);
  await page.evaluate(() => window.VS.sceneApi.patch({ personX: 0.3 })); await page.waitForTimeout(6000);
  const p1b = await frame(page); save(p1b, 'm4_parallax');
  const dOn = meanAbs(p1a, p1b, ...strip);
  ok('parallax off: moving sideways leaves the background alone', dOff < 2.0, { meanAbs: +dOff.toFixed(2) });
  ok('parallax on: the background drifts when the presenter moves sideways (>= 3x the encoder noise, >= 4 levels)', dOn > Math.max(4, dOff * 3), { off: +dOff.toFixed(2), on: +dOn.toFixed(2) });
  // foreground layer (living-room plant is drawn IN FRONT of everything)
  await page.evaluate(() => { window.VS.sceneApi.pickEnv('scene-living-room'); window.VS.sceneApi.enable(true); window.VS.sceneApi.patch({ life: 0, parallax: 0, personX: 0, spill: 0, reflection: 0, bloom: 0, vignette: 0 }); });
  await page.waitForTimeout(4000);
  const fgF = await frame(page); save(fgF, 'm4_foreground');
  const avg = (F, x0, y0, x1, y1) => { let r = 0, g = 0, b = 0, n = 0; for (let y = Math.round(y0 * F.h); y < Math.round(y1 * F.h); y++) for (let x = Math.round(x0 * F.w); x < Math.round(x1 * F.w); x++) { const i = (y * F.w + x) * 4; r += F.px[i]; g += F.px[i + 1]; b += F.px[i + 2]; n++; } return [r / n, g / n, b / n]; };
  const pot = avg(fgF, 0.055, 0.63, 0.115, 0.68), leaf = avg(fgF, 0.025, 0.40, 0.065, 0.44), desk = avg(fgF, 0.40, 0.72, 0.60, 0.76);
  ok('foreground plant is drawn in front: terracotta pot and green leaves where the picture has wall/desk', pot[0] > pot[2] + 50 && leaf[1] > leaf[0] + 20 && !(desk[1] > desk[0] + 20), { pot: pot.map(Math.round), leaf: leaf.map(Math.round), desk: desk.map(Math.round) });
  // one-tap fixes in the wizard (picture check -> button -> setting changes)
  await page.evaluate(() => { window.VS.sceneApi.pickEnv('scene-podcast-wood'); window.VS.sceneApi.enable(true); window.VS.sceneApi.patch({ bgSoft: 0.2 }); window.VS.sceneWizard.open(); });
  await page.click('#sceneWizard .sw-nav .btn.primary'); await page.click('#sceneWizard .sw-nav .btn.primary');
  await page.click('#sceneWizard button:has-text("Find the desk for me")');
  await page.waitForFunction(() => { const t = (document.getElementById('swDeskStatus') || {}).textContent || ''; return t && !/Looking/.test(t); }, null, { timeout: 20000 }).catch(() => {});
  const fixBtn = page.locator('#swFixes button');
  ok('picture check offers a one-tap fix for a busy picture', (await fixBtn.count()) >= 1, await page.textContent('#swDeskStatus'));
  if (await fixBtn.count()) { await fixBtn.first().click(); const st2 = await st(page); ok('tapping the fix changes the setting and says so', st2.bgSoft === 0.8 && /done/.test(await page.textContent('#swDeskStatus')), { bgSoft: st2.bgSoft }); }
  await page.evaluate(() => window.VS.sceneWizard.close());
  ok('no page errors (desktop)', errs.length === 0, errs);

  // ---- 360px phone layout
  const mctx = await browser.newContext({ viewport: { width: 360, height: 740 }, serviceWorkers: 'block', permissions: ['camera', 'microphone'], hasTouch: true, isMobile: true });
  await mctx.addInitScript(() => { localStorage.setItem('vs_users', JSON.stringify({ 't@t.com': { name: 'T', password: 'x' } })); localStorage.setItem('vs_session', JSON.stringify({ email: 't@t.com' })); localStorage.setItem('vs_autostart', '0'); });
  const mp = await mctx.newPage(); const merrs = []; mp.on('pageerror', (e) => merrs.push(e.message));
  await mp.goto('http://127.0.0.1:8123/app/studio.html'); await mp.waitForSelector('#startBtn');
  await mp.evaluate(() => window.VS.sceneWizard.open());
  const lay = [];
  for (let stp = 1; stp <= 5; stp++) {
    const m = await mp.evaluate(() => { const r = document.getElementById('sceneWizard'); const bs = Array.from(r.querySelectorAll('button')).map((b) => { const q = b.getBoundingClientRect(); return { t: (b.textContent || b.getAttribute('aria-label') || '').slice(0, 24), w: q.width, h: q.height }; });
      return { overflowX: r.scrollWidth > r.clientWidth + 1, pageOverflowX: document.documentElement.scrollWidth > window.innerWidth + 1, small: bs.filter((b) => b.h < 44 || b.w < 44).map((b) => b.t + ' ' + Math.round(b.w) + 'x' + Math.round(b.h)), sheetH: r.getBoundingClientRect().height, vh: window.innerHeight }; });
    lay.push(m);
    if (stp === 3 || stp === 1) await mp.screenshot({ path: path.join(OUT, 'm4_phone_step' + stp + '.png') });
    if (stp < 5) await mp.click('#sceneWizard .sw-nav .btn.primary');
  }
  ok('360px: sheet never scrolls sideways, page never overflows', lay.every((m) => !m.overflowX && !m.pageOverflowX), lay.map((m) => [m.overflowX, m.pageOverflowX]));
  ok('360px: every wizard button is at least 44x44 px', lay.every((m) => m.small.length === 0), lay.map((m) => m.small).flat());
  ok('360px: sheet leaves room for the preview (<= 60% of height)', lay.every((m) => m.sheetH <= m.vh * 0.6), lay.map((m) => Math.round(m.sheetH)));
  ok('no page errors (phone)', merrs.length === 0, merrs);
  await browser.close(); process.exit(R.every(Boolean) ? 0 : 1);
})().catch((e) => { console.error('T14 FAIL', e); process.exit(2); });
