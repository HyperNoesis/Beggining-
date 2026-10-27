'use strict';
/**
 * Self-hosted render worker for a GPU box you control (e.g. running Wan2.1 VACE). Zero dependencies.
 * It runs YOUR command on each clip, so no model code is guessed here:
 *   RENDER_CMD='python generate.py --src {in} --out {out} --prompt-file {prompt}'
 * {in} input clip path, {out} output .mp4 path, {prompt} a text file holding the prompt. Paths are temp files that are
 * deleted after the job. One job at a time. Set WORKER_TOKEN; expose it only over a tunnel/https you trust.
 * The VACE command line itself is UNVERIFIED (not run here): take it from https://github.com/ali-vilab/VACE.
 */
const http = require('http'), fs = require('fs'), os = require('os'), path = require('path'), crypto = require('crypto');
const { spawn } = require('child_process');

function createWorker(cfg) {
  const cmdT = cfg.cmd, token = cfg.token || '', maxBytes = (cfg.maxMB || 50) * 1048576, timeoutMs = (cfg.timeoutMin || 30) * 60000;
  const jobs = new Map(); let running = false;
  const send = (res, c, o) => { res.writeHead(c, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(o)); };
  function run(id) {
    const j = jobs.get(id); running = true; j.status = 'running';
    const q = (p) => "'" + p.replace(/'/g, "'\\''") + "'";
    const cmd = cmdT.replace(/\{in\}/g, q(j.inPath)).replace(/\{out\}/g, q(j.outPath)).replace(/\{prompt\}/g, q(j.promptPath));
    const ch = spawn('sh', ['-c', cmd], { stdio: 'ignore' }); const to = setTimeout(() => ch.kill('SIGKILL'), timeoutMs);
    const end = (ok, why) => { clearTimeout(to); running = false; try { fs.unlinkSync(j.inPath); fs.unlinkSync(j.promptPath); } catch (_) {}
      if (ok && fs.existsSync(j.outPath)) j.status = 'done'; else { j.status = 'error'; j.error = why || 'the render command produced no output'; } };
    ch.on('exit', (code) => end(code === 0, 'the render command failed (exit ' + code + ')')); ch.on('error', () => end(false, 'could not start the render command'));
  }
  const server = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://x');
    if (token && req.headers.authorization !== 'Bearer ' + token) return send(res, 401, { error: 'unauthorised' });
    if (req.method === 'POST' && u.pathname === '/jobs') {
      if (running) return send(res, 429, { error: 'busy' });
      const ch = []; let n = 0, dead = false;
      req.on('data', (c) => { n += c.length; if (n > maxBytes) { dead = true; send(res, 413, { error: 'too large' }); req.destroy(); } else ch.push(c); });
      req.on('end', () => { if (dead) return;
        const id = crypto.randomBytes(6).toString('hex'), dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gw-'));
        const j = { status: 'queued', inPath: path.join(dir, 'in.mp4'), outPath: path.join(dir, 'out.mp4'), promptPath: path.join(dir, 'prompt.txt') };
        fs.writeFileSync(j.inPath, Buffer.concat(ch)); fs.writeFileSync(j.promptPath, String(u.searchParams.get('prompt') || '').slice(0, 2000));
        jobs.set(id, j); run(id); send(res, 202, { id }); });
      return;
    }
    const m = u.pathname.match(/^\/jobs\/(\w+)(\/result)?$/); const j = m && jobs.get(m[1]);
    if (!j) return send(res, 404, { error: 'unknown job' });
    if (m[2]) { if (j.status !== 'done') return send(res, 409, { error: 'not ready' }); res.writeHead(200, { 'Content-Type': 'video/mp4' }); return fs.createReadStream(j.outPath).pipe(res); }
    return send(res, 200, { status: j.status, error: j.error });
  });
  server._jobs = jobs; return server;
}
module.exports = { createWorker };
if (require.main === module) {
  const e = process.env; if (!e.RENDER_CMD) { console.error('Set RENDER_CMD (see header of this file).'); process.exit(2); }
  createWorker({ cmd: e.RENDER_CMD, token: e.WORKER_TOKEN, maxMB: Number(e.WORKER_MAX_MB) || 50, timeoutMin: Number(e.WORKER_TIMEOUT_MIN) || 30 }).listen(e.PORT || 8790, () => console.log('render worker ready'));
}
