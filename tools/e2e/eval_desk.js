// Desk-detection evaluation on real photos. Usage: node tools/e2e/eval_desk.js labels.json <photo folder>
// Set DEPTH_MODEL=path/depth_anything_v2_vits.onnx to score the depth detector (v0.25); without it only the old colour detector runs.
// labels.json comes from desklabel.html ("Download labels.json"). Re-runs the CURRENT detector on each photo (so you can re-test after changing it).
const fs = require('fs'), path = require('path'), vm = require('vm'), cp = require('child_process'), os = require('os');
const [lf, dir] = process.argv.slice(2); if (!lf || !dir) { console.error('usage: node eval_desk.js labels.json <photo folder>'); process.exit(2); }
const ctx = {}; ctx.globalThis = ctx; vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(__dirname, '../../js/providers/scene-meta.js'), 'utf8'), ctx);
const SM = ctx.VS.SceneMeta, labels = JSON.parse(fs.readFileSync(lf, 'utf8')).labels;
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dl-'));
const names = labels.map((l) => l.file);
cp.execFileSync('python3', ['-I', '-c', `
import sys, os
from PIL import Image, ImageOps
src, out = sys.argv[1], sys.argv[2]
for n in sys.argv[3:]:
    p = os.path.join(src, n)
    if not os.path.exists(p): continue
    im = ImageOps.exif_transpose(Image.open(p)).convert('RGBA').resize((160, 90), Image.BILINEAR)
    open(os.path.join(out, n + '.rgba'), 'wb').write(im.tobytes())
`, dir, tmp, ...names]);
const used = [];
labels.forEach((l) => { const f = path.join(tmp, l.file + '.rgba'); if (!fs.existsSync(f)) { console.log('missing photo: ' + l.file); return; }
  let d = SM.detectDeskLine(new Uint8ClampedArray(fs.readFileSync(f)), 160, 90);
  // v0.25: same rule as the importer/wizard: prefer the depth detector when DEPTH_MODEL is set and it is confident, else keep the colour detector.
  if (process.env.DEPTH_MODEL && fs.existsSync(process.env.DEPTH_MODEL)) {
    try {
      const dpng = path.join(tmp, l.file + '.depth.png'), dgray = path.join(tmp, l.file + '.depth.gray');
      cp.execFileSync('python3', ['-I', path.join(__dirname, '../scenes/make_depth.py'), path.join(dir, l.file), dpng], { env: process.env });
      cp.execFileSync('python3', ['-I', '-c', "import sys\nfrom PIL import Image\nopen(sys.argv[2],'wb').write(Image.open(sys.argv[1]).convert('L').resize((160,90)).tobytes())", dpng, dgray]);
      const dd = SM.detectDeskFromDepth(new Uint8Array(fs.readFileSync(dgray)), 160, 90);
      console.log('  ' + l.file + ': colour y=' + d.y.toFixed(3) + ' conf ' + d.confidence.toFixed(2) + ' | depth y=' + dd.y.toFixed(3) + ' conf ' + dd.confidence.toFixed(2));
      if (dd.confidence >= 0.45) d = dd;
    } catch (e) { console.log('  depth skipped for ' + l.file + ': ' + String(e.message).split('\n')[0]); }
  }
  used.push(Object.assign({}, l, { auto: { y: d.y, tilt: d.tilt, bow: d.bow, confidence: d.confidence } })); });
console.log(SM.formatDeskReport(SM.summariseDeskLabels(used)));
