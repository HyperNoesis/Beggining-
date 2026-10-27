// Level 3 seating: validator, engine-state mapping, library entry. Node only (no browser). Run: node tools/e2e/unit_seat.js
const fs = require('fs'), path = require('path'), vm = require('vm');
const root = path.join(__dirname, '../..'); const c = {}; c.globalThis = c; vm.createContext(c);
vm.runInContext(fs.readFileSync(path.join(root, 'js/providers/scene-meta.js'), 'utf8'), c);
vm.runInContext(fs.readFileSync(path.join(root, 'js/providers/scene-library.js'), 'utf8'), c);
const SM = c.VS.SceneMeta; let pass = 0, fail = 0;
const ok = (n, v) => { if (v) pass++; else { fail++; console.log('FAIL', n); } };
const meta = JSON.parse(fs.readFileSync(path.join(root, 'assets/scenes/scene-lounge-seat/scene.json'), 'utf8'));
ok('lounge scene validates', SM.validate(meta).ok);
ok('lounge is in the shipped library', c.VS.SCENE_LIBRARY.some((m) => m.id === 'scene-lounge-seat'));
ok('picture + depth files exist', fs.existsSync(path.join(root, meta.image)) && fs.existsSync(path.join(root, meta.depth)));
const st = SM.toEngineState(meta);
ok('engine state carries seat', st.seat && st.seat.type === 'sofa' && st.seat.arms.length === 2);
ok('engine state seat is a copy', (st.seat.arms[0].x0 = 0.5, meta.seat.arms[0].x0 === 0));
const bad = (fn) => { const m = JSON.parse(JSON.stringify(meta)); fn(m); return SM.validate(m); };
ok('missing supports rejected', !bad((m) => { m.seat.supports = ''; }).ok);
ok('missing guide rejected', !bad((m) => { delete m.seat.guide; }).ok);
ok('guide out of range rejected', !bad((m) => { m.seat.guide.headX = 1.5; }).ok);
ok('arm with x0>=x1 rejected', !bad((m) => { m.seat.arms[0].x0 = 0.9; }).ok);
ok('scene without seat still valid (desk scenes untouched)', bad((m) => { delete m.seat; }).ok);
ok('no other scene gained a seat', c.VS.SCENE_LIBRARY.filter((m) => m.seat).length === 1);
ok('all library scenes validate', c.VS.SCENE_LIBRARY.every((m) => SM.validate(m).ok));

// live alignment (engine only, no canvas needed)
vm.runInContext(fs.readFileSync(path.join(root, 'js/providers/scene-engine.js'), 'utf8'), c);
const eng = new c.VS.SceneEngine(); eng.setState(Object.assign({}, SM.toEngineState(meta), { seat: meta.seat }));
const cw = 1280, ch = 720, r = eng.personRect(cw, ch), g = meta.seat.guide;
const mk = (hx, topY) => ({ minX: ((hx * cw - r.dx) / r.dw) * cw - 60, maxX: ((hx * cw - r.dx) / r.dw) * cw + 60, minY: ((topY * ch - r.dy) / r.dh) * ch, maxY: ch });
const want = g.headY - g.headRy;
ok('alignment ok at guide', eng.seatAlignment(mk(g.headX, want), cw, ch) === 'ok');
ok('too far left on screen -> move right', eng.seatAlignment(mk(g.headX - 0.15, want), cw, ch) === 'right');
ok('too far right on screen -> move left', eng.seatAlignment(mk(g.headX + 0.15, want), cw, ch) === 'left');
ok('head too high on screen -> sit lower', eng.seatAlignment(mk(g.headX, want - 0.15), cw, ch) === 'low');
ok('head too low on screen -> sit taller', eng.seatAlignment(mk(g.headX, want + 0.15), cw, ch) === 'high');
ok('no mask -> none', eng.seatAlignment(null, cw, ch) === 'none');

// auto-fit: whatever size/position the head has in the camera frame, it must land on the guide
const fit = (hwFrac, hcx, topFrac) => { const e = new c.VS.SceneEngine(); e.setState(Object.assign({}, SM.toEngineState(meta), { seat: meta.seat }));
  const b = { minX: hcx * cw - hwFrac * cw, maxX: hcx * cw + hwFrac * cw, minY: topFrac * ch, maxY: ch, headW: hwFrac * cw, headCx: hcx * cw };
  for (let i = 0; i < 80; i++) e.updateSeatFit(b, cw, ch);
  const rr = e.personRect(cw, ch); return { e, b, rr, headW: (b.headW / cw) * (rr.dw / cw), headX: (rr.dx + (b.headCx / cw) * rr.dw) / cw, top: (rr.dy + (b.minY / ch) * rr.dh) / ch }; };
for (const [name, hw, hx, top] of [['far (small head)', 0.14, 0.5, 0.30], ['normal', 0.17, 0.46, 0.18], ['close (big head)', 0.22, 0.55, 0.05]]) {
  const f = fit(hw, hx, top);
  ok(name + ': head width matches guide', Math.abs(f.headW - 2 * g.headRx) < 0.012);
  ok(name + ': head centred on guide x', Math.abs(f.headX - g.headX) < 0.012);
  ok(name + ': head top at guide', Math.abs(f.top - (g.headY - g.headRy)) < 0.03 || f.rr.dy + f.rr.dh >= 0.87 * ch);
  ok(name + ': person bottom covers the table line, or the engine says it is tight', f.rr.dy + f.rr.dh >= meta.deskLine.y * ch - 1 || f.e._tight === true);
}
ok('far away beyond range -> closer hint', fit(0.05, 0.5, 0.4).e.seatAlignment(fit(0.05, 0.5, 0.4).b, cw, ch) === 'closer');
ok('too close beyond range -> back hint', fit(0.7, 0.5, 0.0).e.seatAlignment(fit(0.7, 0.5, 0.0).b, cw, ch) === 'back');
ok('a one-frame outlier does not move the fit', (() => { const f0 = fit(0.17, 0.5, 0.18); const before = f0.e._fit.s; f0.e.updateSeatFit({ minX: 0, maxX: 1, minY: 0, maxY: ch, headW: 0.04 * cw, headCx: 0.5 * cw }, cw, ch); return Math.abs(f0.e._fit.s - before) < 1e-9; })());
// underexposure rescue: no-op in normal light, bounded lift when dark
const G = c.VS.SceneEngine.subjectLiftGain;
ok('lift is a no-op at normal exposure', G(0.3, 0.6) === 1 && G(0.27, 0.6) === 1);
ok('lift rises as the subject gets darker', G(0.19, 0.6) > 1.0 && G(0.15, 0.6) > G(0.19, 0.6) && G(0.15, 0.6) > 1.3);
ok('lift is capped', G(0.01 + 1e-6, 1) <= 1.71 && G(0.02, 1) <= 1.71);
ok('lift off at strength 0', G(0.1, 0) === 1);

// REAL silhouette (face-only selfie framing, extracted from a phone screenshot): head metrics + auto-fit on non-synthetic data
const sil = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures/real_silhouette_face_only.json'), 'utf8'));
let y0 = sil.rowMin.findIndex((v, i) => sil.rowMax[i] >= v), y1 = sil.rowMin.length - 1; while (sil.rowMax[y1] < sil.rowMin[y1]) y1--;
const hmR = c.VS.SceneEngine.headMetrics(sil.rowMin, sil.rowMax, y0, y1);
const widths = []; for (let y = y0; y <= y1; y++) { const w = sil.rowMax[y] - sil.rowMin[y] + 1; if (w >= 3) widths.push(w); }
ok('real silhouette: head width = widest row (no false shoulder step)', hmR.hw === Math.max(...widths));
ok('real silhouette: head is 15-40% of frame width (face-only selfie)', hmR.hw / sil.w > 0.15 && hmR.hw / sil.w < 0.40);
{ const e = new c.VS.SceneEngine(); e.setState(Object.assign({}, SM.toEngineState(meta), { seat: meta.seat }));
  const b = { minX: 0, maxX: cw, minY: (y0 / sil.h) * ch, maxY: ch, headW: (hmR.hw / sil.w) * cw, headCx: (hmR.hCx / sil.w) * cw };
  for (let i = 0; i < 80; i++) e.updateSeatFit(b, cw, ch); const rr = e.personRect(cw, ch);
  const hx = (rr.dx + (b.headCx / cw) * rr.dw) / cw, hwC = (b.headW / cw) * (rr.dw / cw);
  // v0.40: the guide is a realistic sofa-scale head (about 26% of the picture height), so a FACE-ONLY selfie (head ~30% of the frame width) is beyond the 0.45x limit: it must be centred, scaled down as far as allowed, and told to move back.
  ok('real silhouette: head centred on guide', Math.abs(hx - g.headX) < 0.015);
  ok('real silhouette: person scaled DOWN to the limit (face was too close)', Math.abs(e._fit.s - 0.45) < 0.02);
  ok('real silhouette: hint is "back", never "closer"', e.seatAlignment(b, cw, ch) === 'back');
  ok('real silhouette: head is still wider than the guide (so the hint is right)', hwC > 2 * g.headRx); }
// body corridor
{ const e = new c.VS.SceneEngine(); e.setState(Object.assign({}, SM.toEngineState(meta), { seat: meta.seat })); const cor = e.seatCorridor(cw, ch);
  const inside = (x, y) => { let ins = false; for (let i = 0, j = cor.length - 1; i < cor.length; j = i++) { const [xi, yi] = cor[i], [xj, yj] = cor[j]; if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) ins = !ins; } return ins; };
  ok('speckle rows (1px wide) are ignored by headMetrics', c.VS.SceneEngine.headMetrics([40, 30, 29, 28, 28], [40, 50, 51, 50, 50], 0, 4).hw >= 20);
  ok('corridor keeps the head', inside(g.headX * cw, g.headY * ch));
  ok('corridor keeps both shoulders', inside((g.headX - g.shoulderHalfW) * cw, g.shoulderY * ch + 20) && inside((g.headX + g.shoulderHalfW) * cw, g.shoulderY * ch + 20));
  ok('corridor drops a chair back far to the side', !inside(0.06 * cw, 0.55 * ch) && !inside(0.94 * cw, 0.55 * ch));
  ok('corridor drops stuff above the head', !inside(0.05 * cw, 0.1 * ch));
  e.setState({ seatClip: 0 }); ok('seatClip 0 disables it', e.seatCorridor(cw, ch) === null); }

// v0.40: 'tight' (phone too close: the fitted frame ends above the table line), freeze, fade
{ const mkE = () => { const e = new c.VS.SceneEngine(); e.setState(Object.assign({}, SM.toEngineState(meta), { seat: meta.seat })); return e; };
  const run = (e, hwFrac, top) => { const b = { minX: 0.4 * cw, maxX: 0.6 * cw, minY: top * ch, maxY: ch, headW: hwFrac * cw, headCx: 0.5 * cw }; for (let i = 0; i < 80; i++) e.updateSeatFit(b, cw, ch); return b; };
  const e1 = mkE(), b1 = run(e1, 0.17, 0.18);   // about 1 m from the phone: head and shoulders only
  ok('1 m selfie framing is tight (bottom edge above the table)', e1._tight === true && e1._tightGap > 0);
  ok('tight -> guide hint "tight"', e1.seatAlignment(b1, cw, ch) === 'tight');
  const e2 = mkE(), b2 = run(e2, 0.11, 0.30);   // about 1.5 m: chest in view
  ok('1.5 m framing is NOT tight', e2._tight === false);
  ok('1.5 m framing -> hint ok', e2.seatAlignment(b2, cw, ch) === 'ok');
  ok('tight state clears with hysteresis, not on the first frame past the limit', (() => { const e = mkE(); run(e, 0.17, 0.18); const was = e._tight; run(e, 0.11, 0.30); return was === true && e._tight === false; })());
  // freeze: an unsupported pose must not move the fit
  const e3 = mkE(); run(e3, 0.12, 0.28); const before = JSON.stringify(e3._fit); e3.setFitFreeze(true); run(e3, 0.2, 0.1);
  ok('freeze holds the last good fit', JSON.stringify(e3._fit) === before);
  e3.setFitFreeze(false); run(e3, 0.2, 0.1); ok('un-freeze follows the presenter again', JSON.stringify(e3._fit) !== before);
  ok('seatLight: dim only when the rescue gain is high', (() => { const e = mkE(); e._slGain = 1.0; const a = e.seatLight(); e._slGain = 1.5; return a === 'ok' && e.seatLight() === 'dim'; })());
}
// scene file facts the engine relies on
ok('seat guide head is a sofa-scale head (22-30% of picture height)', g.headRy * 2 > 0.22 && g.headRy * 2 < 0.30);
ok('table back edge is high enough for a 1.3 m framing to reach it (<= 0.84)', meta.deskLine.y <= 0.84 && meta.deskLine.y >= 0.7);
ok('foreground layer file exists for the seated scene (book + mug)', fs.existsSync(path.join(root, 'assets/environments/scene-lounge-seat-fg.png')));
ok('original generated picture is kept next to the scene', fs.existsSync(path.join(root, 'assets/scenes/scene-lounge-seat/source/grok-sofa-original.jpg')));
ok('scene licence file exists and is honest about the generator terms', /NOT confirmed/.test(fs.readFileSync(path.join(root, 'assets/scenes/scene-lounge-seat/LICENCE.txt'), 'utf8')));
console.log(pass + ' PASS, ' + fail + ' FAIL'); process.exit(fail ? 1 : 0);
