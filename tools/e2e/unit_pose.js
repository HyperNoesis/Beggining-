// v0.40 pose gate (silhouette based). Node only. Run: node tools/e2e/unit_pose.js
// Synthetic silhouettes are drawn on the same 64x36 grid the worker uses (20 px cells on a 1280x720 frame), as RGBA like the canvas read-back.
const fs = require('fs'), path = require('path'), vm = require('vm');
const root = path.join(__dirname, '../..'); const c = {}; c.globalThis = c; vm.createContext(c);
vm.runInContext(fs.readFileSync(path.join(root, 'js/providers/scene-engine.js'), 'utf8'), c);
vm.runInContext(fs.readFileSync(path.join(root, 'js/providers/pose-gate.js'), 'utf8'), c);
const PG = c.VS.PoseGate, SE = c.VS.SceneEngine; let pass = 0, fail = 0;
const ok = (n, v) => { if (v) pass++; else { fail++; console.log('FAIL', n); } };
const why = (r) => PG.describe(r.f, r.c);
const SW = 64, SH = 36;

// A person: round head (width hw cells, centre hx, crown at top), neck, shoulders (width sw cells, centred sx, from top+1.4*hh), torso below.
function person(o) {
  const hw = o.hw || 9, hh = Math.round(hw * 1.3), hx = o.hx === undefined ? 32 : o.hx, top = o.top === undefined ? 3 : o.top;
  const sw = o.sw === undefined ? hw * 2.7 : o.sw, sx = o.sx === undefined ? hx : o.sx, bottom = o.bottom === undefined ? SH - 1 : o.bottom;
  const rows = []; for (let y = 0; y < SH; y++) rows.push(null);
  for (let y = top; y < top + hh; y++) { const t = (y - top) / hh, w = Math.round(hw * Math.sqrt(Math.max(0, 1 - Math.pow(2 * t - 1, 2))) * 0.35 + hw * 0.65 * Math.min(1, t * 4 + 0.35)); rows[y] = [hx - w / 2, hx + w / 2]; }
  // the body line moves smoothly from the head centre to the shoulder centre (a leaning body stays ONE connected shape, like a real mask)
  const mid = (y) => hx + (sx - hx) * Math.min(1, Math.max(0, (y - top - hh) / (hh * 0.9)));
  for (let y = top + hh; y < top + Math.round(hh * 1.3); y++) rows[y] = [mid(y) - hw * 0.28, mid(y) + hw * 0.28];                 // neck
  for (let y = top + Math.round(hh * 1.3); y <= bottom; y++) { const k = Math.min(1, (y - top - hh * 1.3) / (hh * 0.35)); const w = hw * 0.6 + (sw - hw * 0.6) * k; rows[y] = [mid(y) - w / 2, mid(y) + w / 2]; }
  if (o.armsOut) for (let y = top + Math.round(hh * 2.0); y <= bottom; y++) if (rows[y]) rows[y] = [rows[y][0] - o.armsOut, rows[y][1] + o.armsOut];
  return rows;
}
function toRowMM(rows) { const mn = [], mx = []; rows.forEach((r) => { if (!r) { mn.push(SW); mx.push(-1); } else { mn.push(Math.max(0, Math.round(r[0]))); mx.push(Math.min(SW - 1, Math.round(r[1]))); } }); return { mn, mx }; }
function toRGBA(rows, extra) { const d = new Uint8Array(SW * SH * 4); rows.forEach((r, y) => { if (r) for (let x = Math.max(0, Math.round(r[0])); x <= Math.min(SW - 1, Math.round(r[1])); x++) d[(y * SW + x) * 4 + 3] = 255; }); (extra || []).forEach(([x0, y0, x1, y1]) => { for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) d[(y * SW + x) * 4 + 3] = 255; }); return d; }
function run(o, extraBlobs) {
  const rows = person(o), { mn, mx } = toRowMM(rows); let minY = mn.findIndex((v, i) => mx[i] >= v), maxY = SH - 1; while (mx[maxY] < mn[maxY]) maxY--;
  const hm = SE.headMetrics(mn, mx, minY, maxY), areas = PG.blobAreas(toRGBA(rows, extraBlobs), SW, SH, 20), f = PG.features(mn, mx, minY, maxY, hm, areas);
  return { f, c: PG.classify(f), hm };
}

// ---- supported pose at several distances: relative measures must not depend on distance
for (const [name, hw, top] of [['1.5 m', 7, 5], ['1.3 m', 8, 4], ['1.0 m', 10, 2]]) {
  const r = run({ hw, top });
  ok(name + ': front-facing upright is ok (' + PG.describe(r.f, r.c) + ')', r.c.status === 'ok');
  ok(name + ': shoulder/head ratio looks like a person facing the camera (2.0-3.4)', r.f && r.f.ratio > 2.0 && r.f.ratio < 3.4);
}
// ---- unsupported poses
ok('turned sideways (shoulders ~1.5 head widths) -> turned', run({ hw: 8, sw: 8 * 1.5 }).c.status === 'turned');
ok('three-quarter turn (1.7) -> turned', run({ hw: 8, sw: 8 * 1.7 }).c.status === 'turned');
ok('slight turn (2.1) is still accepted', run({ hw: 8, sw: 8 * 2.1 }).c.status === 'ok');
{ const r = run({ hw: 8, sx: 32 + 8 * 1.5 }); ok('torso shifted far left of the head -> leaning [' + why(r) + ']', r.c.status === 'leaning'); }
ok('torso shifted far right of the head -> leaning', run({ hw: 8, sx: 32 - 8 * 1.5 }).c.status === 'leaning');
ok('a small head tilt (0.4 head widths) is accepted', run({ hw: 8, sx: 32 + 8 * 0.4 }).c.status === 'ok');
{ const r = run({ hw: 8, top: 1, armsOut: 14 }); ok('arms spread (silhouette 1.7x wider below the shoulders) -> wide [' + why(r) + ']', r.c.status === 'wide'); }
ok('elbows slightly out (1.2x) are accepted', run({ hw: 8, top: 2, armsOut: 3 }).c.status === 'ok');
ok('second person beside the first -> multi', run({ hw: 8, top: 4 }, [[2, 12, 10, 35]]).c.status === 'multi');
ok('a few speckle cells are not a second person', run({ hw: 8, top: 4 }, [[1, 1, 2, 2]]).c.status === 'ok');
ok('a small bright object (a mug raised) is not a second person (< 12% of the body)', run({ hw: 8, top: 4 }, [[58, 20, 61, 24]]).c.status === 'ok');

// ---- cannot judge -> unknown (never "unsupported")
{ const r = run({ hw: 10, top: 2, bottom: 16 }); ok('head + little body in view -> unknown', r.c.status === 'unknown'); }
{ const sil = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures/real_silhouette_face_only.json'), 'utf8'));
  let y0 = sil.rowMin.findIndex((v, i) => sil.rowMax[i] >= v), y1 = sil.rowMin.length - 1; while (sil.rowMax[y1] < sil.rowMin[y1]) y1--;
  const hm = SE.headMetrics(sil.rowMin, sil.rowMax, y0, y1), f = PG.features(sil.rowMin, sil.rowMax, y0, y1, hm, [500]), cl = PG.classify(f);
  ok('REAL face-only silhouette -> unknown (no shoulders to judge), not a false alarm (' + cl.status + ')', cl.status === 'unknown'); }
ok('no head -> absent', PG.classify(PG.features([], [], 0, 0, { hw: 0, hCx: 0, top: 0 }, [])).status === 'absent');

// ---- blob counting
{ const d = new Uint8Array(SW * SH * 4); const put = (x, y) => { d[(y * SW + x) * 4 + 3] = 255; }; for (let y = 0; y < 5; y++) for (let x = 0; x < 5; x++) put(x, y); for (let y = 10; y < 12; y++) for (let x = 10; x < 13; x++) put(x, y); put(30, 30);
  const a = PG.blobAreas(d, SW, SH, 20); ok('blobAreas finds 3 blobs, largest first (25, 6, 1)', a.length === 3 && a[0] === 25 && a[1] === 6 && a[2] === 1); }
ok('blobAreas on an empty mask is empty', PG.blobAreas(new Uint8Array(SW * SH * 4), SW, SH, 20).length === 0);

// ---- debounce: one odd sample must not flash a warning; a lasting bad pose must; good pose must clear it
{ const d = new PG.Debounce(900, 600); let t = 0;
  ok('starts ok', d.shown === 'ok');
  d.push('turned', t += 300); ok('one bad sample is not reported', d.shown === 'ok');
  d.push('ok', t += 300); d.push('ok', t += 300); ok('and a good one afterwards keeps it ok', d.shown === 'ok');
  d.push('turned', t += 300); d.push('turned', t += 500); ok('bad for 0.5 s: not yet', d.shown === 'ok'); d.push('turned', t += 500); ok('bad for 1.0 s: reported', d.shown === 'turned');
  d.push('unknown', t += 300); ok('unknown neither clears nor confirms', d.shown === 'turned');
  d.push('ok', t += 300); ok('first good sample does not clear', d.shown === 'turned'); d.push('ok', t += 700); ok('0.7 s of good pose clears it', d.shown === 'ok');
  d.push('leaning', t += 100); d.push('wide', t += 500); d.push('wide', t += 500); ok('switching reason restarts the timer (needs 0.9 s of the SAME reason)', d.shown === 'ok'); d.push('wide', t += 500); ok('wide after 1.0 s of wide', d.shown === 'wide');
  d.reset(); ok('reset clears', d.shown === 'ok'); }
ok('isBad covers exactly the four unsupported states', ['turned', 'leaning', 'wide', 'multi'].every(PG.isBad) && !['ok', 'unknown', 'absent'].some(PG.isBad));
ok('every unsupported state has a plain-language reason', ['turned', 'leaning', 'wide', 'multi'].every((s) => typeof PG.REASON[s] === 'string' && PG.REASON[s].length > 8));
console.log(pass + ' PASS, ' + fail + ' FAIL'); process.exit(fail ? 1 : 0);
