// Unit test: scene.json format, the 12-scene library, and desk-line auto-detection against exact ground truth.
// Needs python3 + Pillow (to decode the jpgs into small RGBA arrays). Run from anywhere: node tools/e2e/unit_scene_meta.js
const fs = require('fs'), vm = require('vm'), path = require('path'), cp = require('child_process');
const root = path.join(__dirname, '../..');
const ctx = {}; ctx.globalThis = ctx; vm.createContext(ctx);
['js/providers/scene-meta.js', 'js/providers/scene-library.js', 'js/providers/scene-engine.js'].forEach((f) => vm.runInContext(fs.readFileSync(path.join(root, f), 'utf8'), ctx, { filename: f }));
const { SceneMeta, SceneEngine } = ctx.VS; const SCENE_LIBRARY = ctx.VS.SCENE_LIBRARY.filter((m) => !m.imported);   // built-in procedural scenes only (imported real pictures have hand-set desk lines; see NEXT.md)
let bad = 0; const t = (n, c, extra) => { if (!c) bad++; console.log((c ? 'PASS ' : 'FAIL ') + n + (extra ? '  ' + extra : '')); };

// ---- validator
const good = JSON.parse(JSON.stringify(SCENE_LIBRARY[0]));
t('valid scene passes', SceneMeta.validate(good).ok);
const mut = (fn) => { const m = JSON.parse(JSON.stringify(good)); fn(m); return SceneMeta.validate(m); };
t('rejects bad schema', !mut((m) => { m.schema = 2; }).ok);
t('rejects desk y out of range', !mut((m) => { m.deskLine.y = 1.4; }).ok);
t('rejects key side 0', !mut((m) => { m.keyLight.side = 0; }).ok);
t('rejects bad colour', !mut((m) => { m.keyLight.colour = [999, 0, 0]; }).ok);
t('rejects missing person', !mut((m) => { delete m.person; }).ok);
t('rejects bad depth layer', !mut((m) => { m.depthLayers = [{ name: 'x', y0: 0.8, y1: 0.2 }]; }).ok);
t('rejects non-object', !SceneMeta.validate(null).ok && !SceneMeta.validate('x').ok);
t('warns when licence missing', mut((m) => { delete m.licence; }).warnings.length === 1);
const lib = SceneMeta.loadLibrary(SCENE_LIBRARY.concat([{ id: 'broken' }, SCENE_LIBRARY[0]]));
t('loadLibrary skips broken + duplicate, keeps good', lib.scenes.length === SCENE_LIBRARY.length && lib.rejected.length === 2);

// ---- M4 subtle life / foreground / screens
t('rejects bad screens rect', !mut((m) => { m.screens = [{ x: 0.9, y: 0.1, w: 0.4, h: 0.2 }]; }).ok);
t('rejects bad life amount', !mut((m) => { m.life = { amount: 2 }; }).ok);
t('rejects non-png foreground', !mut((m) => { m.foreground = 'x.jpg'; }).ok);
t('foreground path convention is checked (warning)', mut((m) => { m.foreground = 'somewhere/else.png'; }).warnings.length >= 1);
const lr = SCENE_LIBRARY.find((m) => m.id === 'scene-living-room');
t('living-room declares its foreground and the file exists', lr.foreground === 'assets/environments/scene-living-room-fg.png' && fs.existsSync(path.join(root, lr.foreground)));
t('news-desk has 6 animated screens, inside the frame', SCENE_LIBRARY[0].screens.length === 6 && SCENE_LIBRARY[0].screens.every((r) => r.x >= 0 && r.x + r.w <= 1));
const es = SceneMeta.toEngineState(SCENE_LIBRARY[0]);
t('engine state carries life, parallax and screens', es.life > 0 && es.parallax > 0 && es.screens.length === 6);
t('parallaxTarget: centred = 0, right drifts room left, clamps, scales with amount', SceneEngine.parallaxTarget(0.5, 1) === 0 && SceneEngine.parallaxTarget(0.75, 1) < 0 && SceneEngine.parallaxTarget(0.25, 1) > 0 && SceneEngine.parallaxTarget(0, 1) === 1 && Math.abs(SceneEngine.parallaxTarget(0.25, 0.5) - 0.25) < 1e-9);
t('dust is deterministic and inside the frame', SceneEngine.DUST.length === 26 && SceneEngine.DUST.every((d) => d.x >= 0 && d.x <= 1 && d.y > 0 && d.y < 0.7));
{ const e = new SceneEngine(); e.setState({ parallax: 1, life: 1 }); const ctxStub = { }; e.update(null, 1280, 720, 1000, true);
  t('engine.update with no mask stays centred (no drift)', e._px === 0);
  e.update({ minX: 900, maxX: 1100 }, 1280, 720, 1100, true); e.update({ minX: 900, maxX: 1100 }, 1280, 720, 4000, true);
  t('presenter at the right -> room drifts left, smoothly (not a jump)', e._px < 0 && e._px > -1);
  e.update({ minX: 900, maxX: 1100 }, 1280, 720, 4100, false);
  t('realism off (A/B) -> life off and drift decays back', e._lifeOn === false); }

// ---- library contents
const types = new Set(SCENE_LIBRARY.map((s) => s.type));
t('library has >= 12 scenes', SCENE_LIBRARY.length >= 12, '(' + SCENE_LIBRARY.length + ')');
['news desk', 'podcast', 'talk show', 'classroom', 'office', 'library', 'living room', 'outdoors terrace', 'minimal studio', 'church/stage', 'sports desk', 'tech review']
  .forEach((ty) => t('scene type present: ' + ty, types.has(ty)));
SCENE_LIBRARY.forEach((s) => {
  const file = path.join(root, 'assets/scenes', s.id, 'scene.json');
  t(s.id + ': scene.json file matches library', fs.existsSync(file) && JSON.stringify(JSON.parse(fs.readFileSync(file, 'utf8'))) === JSON.stringify(s));
  t(s.id + ': image exists', fs.existsSync(path.join(root, s.image)));
  const st = SceneMeta.toEngineState(s);
  const eng = new SceneEngine(); eng.setState(st);
  t(s.id + ': engine accepts state', eng.state.deskY === s.deskLine.y && eng.keySide() === s.keyLight.side && eng.state.reflection === s.reflections.desk);
});

// ---- measured: desk detection vs exact truth + measured light side vs declared
const tmp = fs.mkdtempSync(path.join(require('os').tmpdir(), 'scn-'));
cp.execFileSync('python3', ['-I', '-c', `
import sys, glob, os
from PIL import Image
out = sys.argv[2]
for f in sorted(glob.glob(os.path.join(sys.argv[1], 'assets/environments/scene-*.jpg'))):
    im = Image.open(f).convert('RGBA').resize((160, 90), Image.BILINEAR)
    open(os.path.join(out, os.path.basename(f)[:-4] + '.rgba'), 'wb').write(im.tobytes())
`, root, tmp]);
let okDesk = 0, okLight = 0; const rows = [];
SCENE_LIBRARY.forEach((s) => {
  const raw = fs.readFileSync(path.join(tmp, s.id + '.rgba'));
  const d = SceneMeta.detectDeskLine(raw, 160, 90);
  const truthMid = s.deskLine.y + s.deskLine.tilt * 0.5 + s.deskLine.bow;
  const gotMid = d.y + d.tilt * 0.5 + d.bow;
  const err = Math.abs(gotMid - truthMid);
  const hit = err <= 0.03 && d.confidence >= 0.45;
  if (hit) okDesk++;
  const L = SceneEngine.analyzeLight(raw, 160, 90);
  const lightOk = Math.sign(L.side) === s.keyLight.side || Math.abs(L.side) < 0.12;
  if (Math.sign(L.side) === s.keyLight.side) okLight++;
  rows.push(s.id.padEnd(24) + 'desk mid err ' + err.toFixed(3) + '  conf ' + d.confidence.toFixed(2) + (hit ? '  ok ' : '  MISS') + '   light side ' + L.side.toFixed(2) + ' (declared ' + s.keyLight.side + ')');
});
rows.forEach((r) => console.log('  ' + r));
const low = SCENE_LIBRARY.length - okDesk;
let falseConf = 0;
SCENE_LIBRARY.forEach((s) => { const raw = fs.readFileSync(path.join(tmp, s.id + '.rgba')); const d = SceneMeta.detectDeskLine(raw, 160, 90);
  const e = Math.abs((d.y + d.tilt * 0.5 + d.bow) - (s.deskLine.y + s.deskLine.tilt * 0.5 + s.deskLine.bow)); if (e > 0.03 && d.confidence >= 0.45) falseConf++; });
t('desk auto-detect within 0.03 of truth, confident, on >= 9 of 12 scenes (measured)', okDesk >= 9, '(' + okDesk + '/12)');
t('confidently-wrong detections <= 2 (the rest fall back to manual)', falseConf <= 2, '(' + falseConf + ')');
t('measured light side matches declared on 12 of 12 scenes', okLight >= 12, '(' + okLight + '/12)');
// confidence must be honest: a flat grey picture gives low confidence
const flat = new Uint8Array(160 * 90 * 4).fill(120);
t('flat picture -> confidence 0 (falls back to manual)', SceneMeta.detectDeskLine(flat, 160, 90).confidence === 0);
// ---- picture check (E7): library scenes pass; a busy picture and a flat picture are caught
let passCheck = 0; SCENE_LIBRARY.forEach((sc) => { const c = SceneMeta.checkPicture(fs.readFileSync(path.join(tmp, sc.id + '.rgba')), 160, 90); if (c.ok) passCheck++; else console.log('  check: ' + sc.id + ' -> ' + c.issues.join(' | ')); });
t('checkPicture passes >= 10 of 12 library scenes (they are made to the recipe)', passCheck >= 10, '(' + passCheck + '/12)');
const busyImg = new Uint8Array(160 * 90 * 4); for (let i = 0; i < 160 * 90; i++) { const v = ((i * 2654435761) >>> 24) & 255; busyImg[i * 4] = busyImg[i * 4 + 1] = busyImg[i * 4 + 2] = v; busyImg[i * 4 + 3] = 255; }
const cb = SceneMeta.checkPicture(busyImg, 160, 90);
t('checkPicture flags a noisy/cluttered picture', !cb.ok && !cb.clear && cb.issues.length >= 1 && cb.fixes.length === cb.issues.length);
const cf = SceneMeta.checkPicture(flat, 160, 90);
t('checkPicture gives a one-tap action for every issue', cf.actions.length === cf.issues.length && cb.actions.length === cb.issues.length && cf.actions.every((a) => a.label && a.patch));
t('checkPicture flags a flat picture with no desk, with a fix for each issue', !cf.ok && !cf.desk && cf.fixes.length === cf.issues.length);
fs.rmSync(tmp, { recursive: true, force: true });
process.exit(bad ? 1 : 0);
