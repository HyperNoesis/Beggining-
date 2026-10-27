'use strict';
/**
 * Genesis render relay (OPTIONAL, Path C). Zero dependencies (Node 18+).
 *
 * Why it exists: API keys must never be in the browser. The browser sends a recorded clip here; this relay
 * forwards it to ONE configured video-editing provider and lets the browser poll for the result.
 * The live camera path never talks to this server.
 *
 * Providers (RENDER_PROVIDER):
 *   mock     - no network, returns a fake job that completes after RELAY_MOCK_MS. For tests/demos.
 *   aimlapi  - AI/ML API model `alibaba/happyhorse-1-0` (video-to-video). Contract taken from
 *              https://docs.aimlapi.com/api-references/video-models/alibaba-cloud/happy-horse-1.0 (read 2026-10-24).
 *              The contract is from the docs page ONLY: NOT yet exercised against the live service (needs a key).
 *   gemini   - Google Gemini Omni Flash (GEMINI_API_KEY, paid): see createGeminiProvider.
 *   worker   - your own GPU box running server/render-worker.js (RENDER_WORKER_URL, WORKER_TOKEN): e.g. Wan2.1 VACE, no per-clip fee.
 *   (unset)  - every job request answers 503 "not set up". Nothing is forwarded anywhere.
 *
 * Env: RENDER_PROVIDER, AIMLAPI_KEY, AIMLAPI_BASE (default https://api.aimlapi.com/v2), RELAY_TOKEN (optional bearer),
 *      ALLOW_ORIGIN (CORS, default none = same-origin only), RELAY_MAX_MB (default 20), RELAY_DAILY_CAP (default 10 jobs),
 *      RELAY_MAX_ACTIVE (default 2), PORT (default 8788).
 *
 * Privacy: clips are held in memory only while being forwarded; never written to disk, never logged. Job records
 * (id, status, result URL) expire after RELAY_TTL_MIN (default 60).
 */
const http = require('http');
const crypto = require('crypto');

function clamp(n, lo, hi, d) { n = Math.round(Number(n)); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : d; }

function createMockProvider(opts) {
  const ms = (opts && opts.ms) != null ? opts.ms : 3000;
  const jobs = new Map();
  return {
    id: 'mock',
    async submit() { const id = 'mock_' + crypto.randomBytes(6).toString('hex'); jobs.set(id, Date.now()); return { upstreamId: id }; },
    async poll(id) {
      const t = jobs.get(id); if (!t) return { status: 'error', error: 'unknown mock job' };
      return Date.now() - t >= ms ? { status: 'done', resultUrl: 'https://example.invalid/mock-result.mp4' } : { status: 'running' };
    },
  };
}

function createAimlapiProvider(cfg) {
  const fetchImpl = cfg.fetchImpl || fetch;
  const base = String(cfg.base || 'https://api.aimlapi.com/v2').replace(/\/+$/, '');
  const key = cfg.key;
  const auth = { Authorization: 'Bearer ' + key };
  async function j(res) { let b = null; try { b = await res.json(); } catch (_) { /* ignore */ } return b || {}; }
  return {
    id: 'aimlapi',
    async submit({ buffer, mime, prompt, resolution, duration }) {
      const body = {
        model: 'alibaba/happyhorse-1-0',
        prompt: String(prompt || '').slice(0, 2000),
        video_url: 'data:' + (mime || 'video/mp4') + ';base64,' + buffer.toString('base64'),
        resolution: resolution === '1080p' ? '1080p' : '720p',   // 720p default = cheaper (resolution affects cost)
        duration: clamp(duration, 3, 15, 5),                       // docs: 3-15 s; output is capped at 15 s
        audio_setting: 'origin',                                   // keep the speaker's own audio (docs: only with a video reference)
        watermark: false,
      };
      const res = await fetchImpl(base + '/video/generations', { method: 'POST', headers: Object.assign({ 'Content-Type': 'application/json' }, auth), body: JSON.stringify(body) });
      const b = await j(res);
      if (!res.ok) { const e = new Error((b.error && b.error.message) || b.message || ('upstream HTTP ' + res.status)); e.status = res.status; throw e; }
      if (!b.id) throw new Error('upstream returned no generation id');
      return { upstreamId: b.id };
    },
    async poll(id) {
      const res = await fetchImpl(base + '/video/generations?generation_id=' + encodeURIComponent(id), { headers: auth });
      const b = await j(res);
      if (!res.ok) { const e = new Error((b.error && b.error.message) || ('upstream HTTP ' + res.status)); e.status = res.status; throw e; }
      if (b.status === 'completed') return b.video && b.video.url ? { status: 'done', resultUrl: b.video.url } : { status: 'error', error: 'finished but no video URL' };
      if (b.status === 'error') return { status: 'error', error: (b.error && b.error.message) || 'upstream error' };
      return { status: b.status === 'queued' ? 'queued' : 'running' };
    },
  };
}

/**
 * Google Gemini Omni Flash (`gemini-omni-1.1-flash`) video EDIT of an uploaded clip. Contract from
 * https://ai.google.dev/gemini-api/docs/omni (read 2026-10-25): POST {base}/interactions, header x-goog-api-key,
 * input = [{type:'user_input', content:[{type:'video', mime_type, data:<base64>}, {type:'text', text}]}], response_format {type:'video'}.
 * The call is SYNCHRONOUS (can take minutes), so it runs in the background here and the browser polls. The result arrives as
 * base64 inside steps[].content[] (type 'video') and is served from memory through the relay.
 * Facts from the docs: input clip must be <= 10 s; NOT available for uploaded-video editing in the EEA, Switzerland or UK;
 * no free tier; about $0.10 per output second at 720p (pricing page). NOT yet run live: needs a paid key.
 */
function createGeminiProvider(cfg) {
  const fetchImpl = cfg.fetchImpl || fetch, base = String(cfg.base || 'https://generativelanguage.googleapis.com/v1beta').replace(/\/+$/, '');
  const jobs = new Map(); // id -> { status, error, buffer }
  return {
    id: 'gemini',
    async submit({ buffer, mime, prompt }) {
      const id = 'gm_' + crypto.randomBytes(6).toString('hex'); const j = { status: 'running' }; jobs.set(id, j);
      const body = { model: 'gemini-omni-1.1-flash', input: [{ type: 'user_input', content: [{ type: 'video', mime_type: mime || 'video/mp4', data: buffer.toString('base64') }, { type: 'text', text: String(prompt || '').slice(0, 2000) }] }], response_format: { type: 'video' } };
      fetchImpl(base + '/interactions', { method: 'POST', headers: { 'x-goog-api-key': cfg.key, 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
        .then(async (res) => {
          const b = await res.json().catch(() => ({}));
          if (!res.ok) { j.status = 'error'; j.error = (res.status === 429 || res.status === 403 ? 'The AI service refused it (quota, billing or region: uploaded-video editing is unavailable in the EEA, Switzerland and UK).' : 'The AI service returned an error (' + res.status + ').'); return; }
          let data = null; for (const st of (b.steps || [])) if (st.type === 'model_output') for (const c of (st.content || [])) if (c.type === 'video' && c.data) data = c.data;
          if (!data) { j.status = 'error'; j.error = 'The AI service finished but returned no video.'; return; }
          j.buffer = Buffer.from(data, 'base64'); j.status = 'done';
        })
        .catch(() => { j.status = 'error'; j.error = 'Could not reach the AI service.'; });
      return { upstreamId: id };
    },
    async poll(id) { const j = jobs.get(id); if (!j) return { status: 'error', error: 'unknown job' }; return j.status === 'done' ? { status: 'done', resultUrl: 'relay:result' } : j.status === 'error' ? { status: 'error', error: j.error } : { status: 'running' }; },
    async result(id) { const j = jobs.get(id); if (!j || !j.buffer) throw new Error('no result'); return j.buffer; },
  };
}

/** Provider for a self-hosted GPU box running server/render-worker.js (e.g. Wan2.1 VACE). Result is proxied through the worker URL. */
function createWorkerProvider(cfg) {
  const fetchImpl = cfg.fetchImpl || fetch, base = String(cfg.base).replace(/\/+$/, ''), h = cfg.token ? { Authorization: 'Bearer ' + cfg.token } : {};
  return {
    id: 'worker',
    async submit({ buffer, mime, prompt }) {
      const res = await fetchImpl(base + '/jobs?prompt=' + encodeURIComponent(String(prompt || '').slice(0, 2000)), { method: 'POST', headers: Object.assign({ 'Content-Type': mime || 'video/mp4' }, h), body: buffer });
      const b = await res.json().catch(() => ({})); if (!res.ok || !b.id) { const e = new Error(b.error || ('worker HTTP ' + res.status)); e.status = res.status; throw e; }
      return { upstreamId: b.id };
    },
    async result(id) { const res = await fetchImpl(base + '/jobs/' + encodeURIComponent(id) + '/result', { headers: h }); if (!res.ok) throw new Error('worker HTTP ' + res.status); return Buffer.from(await res.arrayBuffer()); },
    async poll(id) {
      const res = await fetchImpl(base + '/jobs/' + encodeURIComponent(id), { headers: h }); const b = await res.json().catch(() => ({}));
      if (!res.ok) { const e = new Error('worker HTTP ' + res.status); e.status = res.status; throw e; }
      return b.status === 'done' ? { status: 'done', resultUrl: 'relay:result' } : b.status === 'error' ? { status: 'error', error: b.error } : { status: b.status === 'queued' ? 'queued' : 'running' };
    },
  };
}

function createRelay(cfg) {
  cfg = cfg || {};
  const provider = cfg.provider || null;
  const maxBytes = (cfg.maxMB || 20) * 1024 * 1024;
  const dailyCap = cfg.dailyCap != null ? cfg.dailyCap : 10;
  const maxActive = cfg.maxActive != null ? cfg.maxActive : 2;
  const ttl = (cfg.ttlMin || 60) * 60 * 1000;
  const token = cfg.token || '';
  const allowOrigin = cfg.allowOrigin || '';
  const jobs = new Map(); // id -> { up, status, resultUrl, error, t, done }
  const day = { key: '', n: 0 };

  const sweep = () => { const t = Date.now(); for (const [k, v] of jobs) if (t - v.t > ttl) jobs.delete(k); };
  const active = () => { let n = 0; for (const v of jobs.values()) if (v.status === 'queued' || v.status === 'running' || v.status === 'starting') n++; return n; };

  function send(res, code, obj, req) {
    const h = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' };
    if (allowOrigin && req && req.headers.origin === allowOrigin) {
      h['Access-Control-Allow-Origin'] = allowOrigin; h['Vary'] = 'Origin';
      h['Access-Control-Allow-Headers'] = 'Authorization, Content-Type'; h['Access-Control-Allow-Methods'] = 'GET, POST, DELETE, OPTIONS';
    }
    res.writeHead(code, h); res.end(JSON.stringify(obj));
  }
  const authorised = (req) => !token || req.headers.authorization === 'Bearer ' + token;

  function readBody(req) {
    return new Promise((resolve, reject) => {
      const chunks = []; let n = 0;
      req.on('data', (c) => { n += c.length; if (n > maxBytes) { reject(Object.assign(new Error('clip too large (max ' + (maxBytes / 1048576) + ' MB)'), { status: 413 })); req.destroy(); } else chunks.push(c); });
      req.on('end', () => resolve(Buffer.concat(chunks)));
      req.on('error', reject);
    });
  }

  const server = http.createServer(async (req, res) => {
    try {
      sweep();
      const u = new URL(req.url, 'http://x');
      if (req.method === 'OPTIONS') return send(res, 204, {}, req);
      if (u.pathname === '/render/health') return send(res, 200, { ok: true, provider: provider ? provider.id : null }, req);
      if (!authorised(req)) return send(res, 401, { error: 'unauthorised' }, req);
      if (provider && provider.id === 'mock' && u.pathname === '/render/mock-result.mp4') { res.writeHead(200, { 'Content-Type': 'video/mp4', 'Access-Control-Allow-Origin': '*' }); return res.end(Buffer.from('MOCKMP4')); }
      if (!provider) return send(res, 503, { error: 'AI re-render is not set up on this server.' }, req);

      if (req.method === 'POST' && u.pathname === '/render/jobs') {
        const type = String(req.headers['content-type'] || '').split(';')[0];
        if (!/^video\/(mp4|quicktime|webm)$/.test(type)) return send(res, 415, { error: 'send the clip as video/mp4, video/quicktime or video/webm' }, req);
        const today = new Date().toISOString().slice(0, 10);
        if (day.key !== today) { day.key = today; day.n = 0; }
        if (day.n >= dailyCap) return send(res, 429, { error: 'daily render limit reached' }, req);
        if (active() >= maxActive) return send(res, 429, { error: 'too many renders running, try again shortly' }, req);
        const buffer = await readBody(req);
        if (!buffer.length) return send(res, 400, { error: 'empty clip' }, req);
        day.n++;
        const id = 'j_' + crypto.randomBytes(8).toString('hex');
        const rec = { status: 'starting', t: Date.now() }; jobs.set(id, rec);
        try {
          const r = await provider.submit({ buffer, mime: type, prompt: u.searchParams.get('prompt') || '', resolution: u.searchParams.get('resolution') || '720p', duration: u.searchParams.get('duration') });
          rec.up = r.upstreamId; rec.status = 'queued';
        } catch (e) {
          jobs.delete(id); day.n = Math.max(0, day.n - 1);
          const s = e.status === 401 || e.status === 403 ? 502 : (e.status === 402 || e.status === 429 ? 429 : 502);
          return send(res, s, { error: 'The AI service refused or failed the request.' + (e.status ? ' (' + e.status + ')' : '') }, req);
        }
        return send(res, 202, { jobId: id }, req);
      }

      const rm = u.pathname.match(/^\/render\/jobs\/([\w-]+)\/result$/);
      if (rm && req.method === 'GET' && provider.result) {
        const rec = jobs.get(rm[1]); if (!rec || rec.status !== 'done') return send(res, 404, { error: 'no result' }, req);
        try { const buf = await provider.result(rec.up); const h = { 'Content-Type': 'video/mp4', 'Cache-Control': 'no-store' }; if (allowOrigin && req.headers.origin === allowOrigin) h['Access-Control-Allow-Origin'] = allowOrigin; res.writeHead(200, h); return res.end(buf); }
        catch (e) { return send(res, 502, { error: 'could not fetch the result' }, req); }
      }
      const m = u.pathname.match(/^\/render\/jobs\/([\w-]+)$/);
      if (m) {
        const rec = jobs.get(m[1]);
        if (!rec) return send(res, 404, { error: 'unknown job' }, req);
        if (req.method === 'DELETE') { jobs.delete(m[1]); return send(res, 200, { ok: true }, req); }
        if (req.method === 'GET') {
          if (rec.status === 'queued' || rec.status === 'running') {
            try { const p = await provider.poll(rec.up); rec.status = p.status; rec.resultUrl = p.resultUrl; rec.error = p.error; }
            catch (e) { return send(res, 502, { error: 'could not check the AI service' }, req); }
          }
          const resultUrl = rec.resultUrl === 'relay:result' ? 'http://' + req.headers.host + '/render/jobs/' + m[1] + '/result' : provider.id === 'mock' && rec.resultUrl ? 'http://' + req.headers.host + '/render/mock-result.mp4' : rec.resultUrl;
          return send(res, 200, { status: rec.status === 'starting' ? 'queued' : rec.status, resultUrl, error: rec.error }, req);
        }
      }
      return send(res, 404, { error: 'not found' }, req);
    } catch (e) {
      return send(res, e.status || 500, { error: e.status === 413 ? e.message : 'relay error' }, req);
    }
  });
  server._jobs = jobs;
  return server;
}

function providerFromEnv(env) {
  if (env.RENDER_PROVIDER === 'mock') return createMockProvider({ ms: Number(env.RELAY_MOCK_MS) || 3000 });
  if (env.RENDER_PROVIDER === 'gemini') {
    if (!env.GEMINI_API_KEY) { console.error('RENDER_PROVIDER=gemini but GEMINI_API_KEY is not set: AI render OFF.'); return null; }
    return createGeminiProvider({ key: env.GEMINI_API_KEY, base: env.GEMINI_BASE });
  }
  if (env.RENDER_PROVIDER === 'worker') {
    if (!env.RENDER_WORKER_URL) { console.error('RENDER_PROVIDER=worker but RENDER_WORKER_URL is not set: AI render OFF.'); return null; }
    return createWorkerProvider({ base: env.RENDER_WORKER_URL, token: env.WORKER_TOKEN });
  }
  if (env.RENDER_PROVIDER === 'aimlapi') {
    if (!env.AIMLAPI_KEY) { console.error('RENDER_PROVIDER=aimlapi but AIMLAPI_KEY is not set: running with AI render OFF.'); return null; }
    return createAimlapiProvider({ key: env.AIMLAPI_KEY, base: env.AIMLAPI_BASE });
  }
  return null;
}

module.exports = { createRelay, createMockProvider, createAimlapiProvider, createWorkerProvider, createGeminiProvider, providerFromEnv };

if (require.main === module) {
  const env = process.env;
  const s = createRelay({ provider: providerFromEnv(env), token: env.RELAY_TOKEN, allowOrigin: env.ALLOW_ORIGIN, maxMB: Number(env.RELAY_MAX_MB) || 20, dailyCap: env.RELAY_DAILY_CAP != null ? Number(env.RELAY_DAILY_CAP) : 10, maxActive: Number(env.RELAY_MAX_ACTIVE) || 2, ttlMin: Number(env.RELAY_TTL_MIN) || 60 });
  const port = env.PORT || 8788;
  s.listen(port, () => console.log('render relay on :' + port + ' provider=' + (env.RENDER_PROVIDER || 'none')));
}
