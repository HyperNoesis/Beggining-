// Copies only the files the app needs into www/ (no tests, docs, server, tools).
const fs = require('fs'), path = require('path');
const root = path.join(__dirname, '..'), out = path.join(root, 'www');
fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out);
const skipDirs = new Set(['android','www','node_modules','server','supabase','tools','docs','scripts','.github']);
function walk(dir, rel) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const r = path.join(rel, e.name);
    if (e.isDirectory()) { if (rel === '' && skipDirs.has(e.name)) continue; fs.mkdirSync(path.join(out, r), { recursive: true }); walk(path.join(dir, e.name), r); }
    else if (/\.(html|js|css|json|png|jpg|jpeg|webp|svg|wasm|onnx|tflite|binarypb|data|woff2?|mp3|wav|ogg|txt|cube|ico)$/i.test(e.name)
      && !/^(package(-lock)?|capacitor\.config|docker-compose)\.json$|^_headers$/.test(e.name) && !(rel === '' && /^(tests|benchmark)\.html$/.test(e.name))) {
      fs.copyFileSync(path.join(dir, e.name), path.join(out, r));
    }
  }
}
walk(root, '');
if (!fs.existsSync(path.join(out, 'index.html'))) throw new Error('index.html missing');
console.log('www ready');
