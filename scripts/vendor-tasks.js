// Runs automatically in `npm run build:www` (GitHub Actions has internet): copies MediaPipe Tasks Vision (bundle + wasm, from the
// npm devDependency) and the two selfie models into vendor/mediapipe/tasks/ so the GPU engine works offline inside the APK.
// Never fails the build: if anything is missing the app simply falls back to the CDN at runtime.
const fs = require('fs'), path = require('path');
const out = path.join(__dirname, '..', 'vendor', 'mediapipe', 'tasks');
const pkg = path.join(__dirname, '..', 'node_modules', '@mediapipe', 'tasks-vision');
const base = 'https://storage.googleapis.com/mediapipe-models/image_segmenter/';
const models = { 'selfie_segmenter_landscape.tflite': 'selfie_segmenter_landscape/float16/latest/selfie_segmenter_landscape.tflite', 'selfie_segmenter.tflite': 'selfie_segmenter/float16/latest/selfie_segmenter.tflite' };
(async () => {
  if (!fs.existsSync(path.join(pkg, 'wasm'))) { console.warn('vendor-tasks: @mediapipe/tasks-vision not installed, skipping (CDN fallback).'); return; }
  const tmp = out + '.tmp'; fs.rmSync(tmp, { recursive: true, force: true }); fs.mkdirSync(path.join(tmp, 'wasm'), { recursive: true });
  const bundle = ['vision_bundle.js', 'vision_bundle.cjs'].find((f) => fs.existsSync(path.join(pkg, f)));
  if (!bundle) throw new Error('no vision_bundle in package');
  fs.copyFileSync(path.join(pkg, bundle), path.join(tmp, 'vision_bundle.js'));
  for (const f of fs.readdirSync(path.join(pkg, 'wasm'))) fs.copyFileSync(path.join(pkg, 'wasm', f), path.join(tmp, 'wasm', f));
  for (const [name, p] of Object.entries(models)) {
    const r = await fetch(base + p); if (!r.ok) throw new Error(name + ' HTTP ' + r.status);
    const buf = Buffer.from(await r.arrayBuffer()); if (buf.length < 100000) throw new Error(name + ' too small');
    fs.writeFileSync(path.join(tmp, name), buf);
  }
  fs.rmSync(out, { recursive: true, force: true }); fs.renameSync(tmp, out);
  console.log('vendor-tasks OK:', fs.readdirSync(out).join(', '), '| wasm:', fs.readdirSync(path.join(out, 'wasm')).join(', '));
})().catch((e) => { console.warn('vendor-tasks: skipped (' + e.message + '), app will use the CDN fallback.'); });
