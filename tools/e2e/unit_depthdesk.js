// Depth-based desk detector vs the desk lines stored in assets/scenes/*/scene.json. Built-in scenes = exact truth; premium scenes = hand estimates (so treat their numbers as rough).
const fs = require('fs'), vm = require('vm'), path = require('path'), cp = require('child_process'), os = require('os');
const root = path.join(__dirname, '../..'); const ctx = {}; ctx.globalThis = ctx; vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(root, 'js/providers/scene-meta.js'), 'utf8'), ctx); const SM = ctx.VS.SceneMeta;
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dd-'));
cp.execFileSync('python3', ['-I', '-c', `
import sys, glob, os
from PIL import Image
for f in sorted(glob.glob(os.path.join(sys.argv[1], 'assets/environments/scene-*-depth.png'))):
    open(os.path.join(sys.argv[2], os.path.basename(f)[:-4] + '.gray'), 'wb').write(Image.open(f).convert('L').resize((160, 90), Image.BILINEAR).tobytes())
`, root, tmp]);
let bad = 0; const t = (n, c, x) => { if (!c) bad++; console.log((c ? 'PASS ' : 'FAIL ') + n + (x ? '  ' + x : '')); };
const rows = [];
for (const d of fs.readdirSync(path.join(root, 'assets/scenes'))) {
  const f = path.join(root, 'assets/scenes', d, 'scene.json'); if (!fs.existsSync(f)) continue;
  const m = JSON.parse(fs.readFileSync(f, 'utf8')); const g = path.join(tmp, m.id + '-depth.gray'); if (!fs.existsSync(g) || m.noDesk) continue;
  const det = SM.detectDeskFromDepth(new Uint8Array(fs.readFileSync(g)), 160, 90), e = SM.deskError(det, m.deskLine);
  rows.push({ id: m.id, imported: !!m.imported, err: e.mean, conf: det.confidence }); console.log('  ' + m.id.padEnd(26) + ' err ' + (e.mean * 100).toFixed(1) + '%  conf ' + det.confidence.toFixed(2) + (m.imported ? '  (vs hand estimate)' : ''));
}
const conf = rows.filter((r) => r.conf >= 0.45), wrong = conf.filter((r) => r.err > 0.03), builtin = rows.filter((r) => !r.imported);
t('built-in scenes: mean error under 1.5% of height', builtin.reduce((a, r) => a + r.err, 0) / builtin.length < 0.015);
t('confident detections that are wrong (>3%) are at most 2', wrong.length <= 2, wrong.map((r) => r.id).join(','));
t('at least 80% of scenes are confident', conf.length / rows.length >= 0.8, conf.length + '/' + rows.length);
process.exit(bad ? 1 : 0);
