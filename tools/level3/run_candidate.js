#!/usr/bin/env node
// Runs ONE source clip through the render relay and saves the result + a metadata record for scoring.
// Usage: RELAY_URL=http://127.0.0.1:8788 [RELAY_TOKEN=..] node run_candidate.js <clip.mp4> <candidate-name> [--res 720p] [--sec 6] [--out results]
// Same clip + same prompt (js/providers/render-provider.js LEVEL3_PROMPT) for every candidate = a fair comparison.
// Your original clip is only READ, never modified. The clip LEAVES YOUR COMPUTER (relay -> vendor). Use a consented clip.
const fs = require('fs'), path = require('path'), crypto = require('crypto');
const RP = require('../../js/providers/render-provider.js');
const a = process.argv.slice(2); const clipPath = a[0], name = a[1];
if (!clipPath || !name) { console.error('usage: node run_candidate.js <clip.mp4> <candidate-name> [--res 720p] [--sec 6] [--out dir]'); process.exit(2); }
const opt = (k, d) => { const i = a.indexOf(k); return i > -1 ? a[i + 1] : d; };
const outDir = opt('--out', 'results'); fs.mkdirSync(outDir, { recursive: true });
const buf = fs.readFileSync(clipPath); const sha = crypto.createHash('sha256').update(buf).digest('hex').slice(0, 16);
const mime = /\.mov$/i.test(clipPath) ? 'video/quicktime' : /\.webm$/i.test(clipPath) ? 'video/webm' : 'video/mp4';
(async () => {
  const adapter = RP.createRelayAdapter({ baseUrl: process.env.RELAY_URL || '', token: process.env.RELAY_TOKEN || '' });
  const t0 = Date.now(); let last = '';
  const job = RP.runRenderJob({ adapter, clip: new Blob([buf], { type: mime }), prompt: RP.LEVEL3_PROMPT, options: { resolution: opt('--res', '720p'), duration: Number(opt('--sec', 6)) }, pollMs: 5000, onState: (s) => { if (s !== last) { last = s; console.log(((Date.now() - t0) / 1000).toFixed(0) + 's ' + s); } } });
  process.on('SIGINT', () => job.cancel());
  const r = await job.promise;
  const meta = { candidate: name, sourceSha256_16: sha, sourceBytes: buf.length, prompt: RP.LEVEL3_PROMPT, resolution: opt('--res', '720p'), seconds: Number(opt('--sec', 6)), ok: r.ok, state: r.state, error: r.error || null, latencySec: Math.round(r.ms / 1000), attempts: r.attempts, finishedAt: new Date().toISOString(),
    costUsd: null, note: 'costUsd: fill in from the vendor dashboard; this tool does not guess prices' };
  if (r.ok && r.result && r.result.blob) { const f = path.join(outDir, name + '.mp4'); fs.writeFileSync(f, Buffer.from(await r.result.blob.arrayBuffer())); meta.output = f; }
  fs.writeFileSync(path.join(outDir, name + '.json'), JSON.stringify(meta, null, 2)); console.log(JSON.stringify(meta, null, 2)); process.exit(r.ok ? 0 : 1);
})();
