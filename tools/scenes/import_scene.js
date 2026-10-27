#!/usr/bin/env node
// Scene importer. Takes a photo / generated picture, checks it, finds the desk line, writes the scene folder + licence record,
// and rebuilds the library.
// Extra flags: --desk-y 0.65 [--desk-tilt 0 --desk-bow 0] sets the desk BACK edge by hand (use this for real photos); --chair says an empty chair is part of the picture on purpose (skips the 'busy' complaint).
// Usage: node tools/scenes/import_scene.js <picture> --name "Studio Loft" --type "loft" --licence "Own photo, taken 2026-10-20" [--id scene-studio-loft] [--source "..."] [--force] [--dry]
// Needs python3 + Pillow (decode, 16:9 centre-crop, 1280x720 JPEG). Honest limit: checkPicture measures edges/brightness only; it cannot tell a person from a poster.
const fs = require('fs'), path = require('path'), vm = require('vm'), cp = require('child_process'), os = require('os');
const root = path.join(__dirname, '../..');
const argv = process.argv.slice(2); const pos = []; const o = {};
for (let i = 0; i < argv.length; i++) { const a = argv[i]; if (a.startsWith('--')) { const k = a.slice(2); if (k === 'force' || k === 'dry' || k === 'chair') o[k] = true; else o[k] = argv[++i]; } else pos.push(a); }
const die = (m) => { console.error('ERROR: ' + m); process.exit(1); };
const src = pos[0]; if (!src || !fs.existsSync(src)) die('give the picture path. See the usage line at the top of this file.');
if (!o.name) die('--name is required (what people see in the list).');
if (!o.licence || o.licence.length < 8) die('--licence is required: say who made the picture and what lets you use it (e.g. "Own photo", or the generator name + the terms page/date). It is stored with the scene.');
const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 48);
const id = o.id || ('scene-' + slug(o.name));
if (!/^scene-[a-z0-9][a-z0-9-]{1,57}$/.test(id)) die('id must start with "scene-" (the app loads built-in pictures by that name).');
const type = o.type || 'room';

const ctx = {}; ctx.globalThis = ctx; vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(root, 'js/providers/scene-meta.js'), 'utf8'), ctx);
const SM = ctx.VS.SceneMeta;

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'imp-'));
const outJpg = path.join(tmp, 'out.jpg'), small = path.join(tmp, 'small.rgba');
const info = cp.execFileSync('python3', ['-I', '-c', `
import sys
from PIL import Image, ImageOps
im = ImageOps.exif_transpose(Image.open(sys.argv[1])).convert('RGB')
w, h = im.size
t = 16 / 9
if w / h > t: nw = int(h * t); im = im.crop(((w - nw) // 2, 0, (w - nw) // 2 + nw, h))
else: nh = int(w / t); im = im.crop((0, (h - nh) // 2, w, (h - nh) // 2 + nh))
big = im.resize((1280, 720), Image.LANCZOS); big.save(sys.argv[2], quality=86, optimize=True, progressive=True)
open(sys.argv[3], 'wb').write(im.resize((160, 90), Image.BILINEAR).convert('RGBA').tobytes())
print(w, h)
`, src, outJpg, small]).toString().trim().split(' ').map(Number);
const [sw, sh] = info;
if (sw < 960 || sh < 540) console.log('WARNING: the picture is small (' + sw + 'x' + sh + '). 1280x720 or larger looks best.');
const rgba = new Uint8ClampedArray(fs.readFileSync(small));
const ck = SM.checkPicture(rgba, 160, 90), d = SM.detectDeskLine(rgba, 160, 90);
const lumAt = (x, y) => { const i = (y * 160 + x) * 4; return 0.2126 * rgba[i] + 0.7152 * rgba[i + 1] + 0.0722 * rgba[i + 2]; };
let L = 0, R = 0; for (let y = 5; y < 50; y++) for (let x = 0; x < 160; x++) { if (x < 60) L += lumAt(x, y); else if (x >= 100) R += lumAt(x, y); }
const side = L > R * 1.02 ? -1 : 1;
let r = 0, g = 0, b = 0, n = 0; for (let y = 5; y < 50; y++) for (let x = side < 0 ? 0 : 100; x < (side < 0 ? 60 : 160); x++) { const i = (y * 160 + x) * 4; if (lumAt(x, y) > 150) { r += rgba[i]; g += rgba[i + 1]; b += rgba[i + 2]; n++; } }
const colour = n > 30 ? [r, g, b].map((v) => Math.min(255, Math.round(Math.max(v / n, 0) * 0.35 + 255 * 0.65))) : [255, 244, 225];

console.log('Picture check: ' + (ck.ok ? 'OK' : 'NEEDS ATTENTION'));
ck.issues.forEach((t, i) => console.log('  - ' + t + ' ' + (ck.fixes[i] || '')));
console.log('Desk line: y=' + d.y.toFixed(3) + ' tilt=' + d.tilt.toFixed(3) + ' bow=' + d.bow.toFixed(3) + ' confidence ' + Math.round(d.confidence * 100) + '%; light from the ' + (side < 0 ? 'left' : 'right'));
let deskOk = d.confidence >= 0.45;
// v0.23: depth-based desk detector (needs DEPTH_MODEL). The colour-edge detector above finds the FRONT edge on real photos, so prefer depth.
if (process.env.DEPTH_MODEL && fs.existsSync(process.env.DEPTH_MODEL) && !o['desk-y']) {
  try {
    const dpng = path.join(tmp, 'd.png'), dgray = path.join(tmp, 'd.gray');
    cp.execFileSync('python3', ['-I', path.join(__dirname, 'make_depth.py'), outJpg, dpng], { env: process.env });
    cp.execFileSync('python3', ['-I', '-c', "import sys\nfrom PIL import Image\nopen(sys.argv[2],'wb').write(Image.open(sys.argv[1]).convert('L').resize((160,90)).tobytes())", dpng, dgray]);
    const dd = SM.detectDeskFromDepth(new Uint8Array(fs.readFileSync(dgray)), 160, 90);
    console.log('Depth-based desk line: y=' + dd.y.toFixed(3) + ' tilt=' + dd.tilt.toFixed(3) + ' confidence ' + Math.round(dd.confidence * 100) + '%');
    if (dd.confidence >= 0.45) { d.y = dd.y; d.tilt = dd.tilt; d.bow = 0; d.confidence = dd.confidence; deskOk = true; }
    else { console.log('Depth detector is not confident: use --desk-y by hand (check the picture and drag the line in the Scene Wizard).'); deskOk = false; d.confidence = 0; }
  } catch (e) { console.log('Depth desk detection skipped: ' + String(e.message).split('\n')[0]); }
}
if (o['desk-y']) { d.y = +o['desk-y']; d.tilt = +(o['desk-tilt'] || 0); d.bow = +(o['desk-bow'] || 0); d.confidence = 1; deskOk = true; console.log('Desk line set by hand: y=' + d.y + '. (Auto-detect is unreliable on real photos: see NEXT.md.)'); }
if (!ck.ok && !o.force && !(o.chair && (ck.desk || o['desk-y'] || deskOk) && ck.exposure)) die('the picture has problems (above). Fix the picture, or re-run with --force to import anyway (then drag the desk line in the Scene Wizard).');

const meta = {
  schema: 1, id, name: o.name, type, image: 'assets/environments/' + id + '.jpg', size: [1280, 720], foreground: null, screens: [],
  life: { amount: 0.3, parallax: 0.3 },
  deskLine: { y: +(deskOk ? d.y : 0.66).toFixed(3), tilt: +(deskOk ? d.tilt : 0).toFixed(3), bow: +(deskOk ? d.bow : 0).toFixed(3), feather: 6 },
  camera: { eyeLevel: 0.42, heightCm: 120, note: 'fixed camera, eye height, slight downward tilt' },
  keyLight: { side, colour, softness: 0.6 }, floorLine: 0.95,
  person: { scale: 0.58, x: 0.0, y: -0.234 }, reflections: { desk: 0.18 },
  depthLayers: [{ name: 'background', y0: 0.0, y1: +(deskOk ? d.y : 0.66).toFixed(3), blur: 0.2 }, { name: 'desk', y0: +(deskOk ? d.y : 0.66).toFixed(3), y1: 1.0, blur: 0.0 }],
  grade: { grain: 0.4, bloom: 0.2, vignette: 0.2 }, chair: { x: 0.5, empty: true, inPicture: !!o.chair },
  licence: o.licence, source: o.source || null, imported: true, tags: [type, 'desk', 'fixed-camera', 'imported'],
  checked: { deskConfidence: +d.confidence.toFixed(2), pictureOk: ck.ok, importedAt: new Date().toISOString().slice(0, 10) },
};
if (!deskOk) meta.tags.push('desk-needs-manual');
const v = SM.validate(meta); if (!v.ok) die('generated scene.json is invalid: ' + v.errors.join('; '));
if (o.dry) { console.log('(dry run) nothing written.'); process.exit(0); }
fs.mkdirSync(path.join(root, 'assets/scenes', id), { recursive: true });
fs.copyFileSync(outJpg, path.join(root, 'assets/environments', id + '.jpg'));
fs.writeFileSync(path.join(root, 'assets/scenes', id, 'scene.json'), JSON.stringify(meta, null, 2));
fs.writeFileSync(path.join(root, 'assets/scenes', id, 'LICENCE.txt'), 'Scene: ' + id + '\nName: ' + o.name + '\nLicence / right to use: ' + o.licence + '\nSource: ' + (o.source || 'n/a') + '\nOriginal file: ' + path.basename(src) + ' (' + sw + 'x' + sh + ')\nImported: ' + meta.checked.importedAt + '\nKeep this with the scene. Do not ship the scene if you cannot show this.\n');
const reg = path.join(root, 'docs/SCENE_LICENCES.md');
if (!fs.existsSync(reg)) fs.writeFileSync(reg, '# Scene licence register (imported scenes)\nOne line per imported scene. Built-in scenes are original procedural art (see LICENSES.md).\n\n');
fs.appendFileSync(reg, '- `' + id + '` | ' + o.name + ' | ' + o.licence + ' | source: ' + (o.source || 'n/a') + ' | ' + meta.checked.importedAt + '\n');
meta.depth = null;
if (process.env.DEPTH_MODEL && fs.existsSync(process.env.DEPTH_MODEL)) {
  try { cp.execFileSync('python3', ['-I', path.join(__dirname, 'make_depth.py'), path.join(root, 'assets/environments', id + '.jpg'), path.join(root, 'assets/environments', id + '-depth.png')], { env: process.env }); meta.depth = 'assets/environments/' + id + '-depth.png'; console.log('Depth map written (Depth Anything V2 Small).'); }
  catch (e) { console.log('Depth map failed (' + String(e.message).split('\n')[0] + '); the app will use an estimated depth ramp instead.'); }
} else console.log('No DEPTH_MODEL set: the app will use an estimated depth ramp for this scene (still gives depth of field + layered parallax).');
meta.grade.dof = 0.5; fs.writeFileSync(path.join(root, 'assets/scenes', id, 'scene.json'), JSON.stringify(meta, null, 2));
console.log(cp.execFileSync('node', [path.join(__dirname, 'rebuild_library.js')]).toString().trim());
console.log('Imported ' + id + '. Open Studio > Scene Wizard to check the desk line and place yourself.');
