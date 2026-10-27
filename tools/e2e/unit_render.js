// Unit tests for the optional AI re-render path (client runner + relay). No network beyond loopback. Run: node tools/e2e/unit_render.js
const http = require('http');
const assert = require('assert');
const RP = require('../../js/providers/render-provider.js');
const { createRelay, createAimlapiProvider, createMockProvider } = require('../../server/render-relay.js');

let pass = 0, fail = 0;
async function t(name, fn) { try { await fn(); pass++; console.log('PASS ' + name); } catch (e) { fail++; console.log('FAIL ' + name + '\n   ' + (e && e.message)); } }
const noSleep = () => Promise.resolve();
const listen = (srv) => new Promise((r) => srv.listen(0, '127.0.0.1', () => r(srv.address().port)));
const seq = (...a) => { let i = 0; return () => a[Math.min(i++, a.length - 1)]; };

function fakeAdapter(over) {
  return Object.assign({
    id: 'fake', available: () => ({ ok: true }),
    submit: async () => ({ jobId: 'J1' }),
    poll: async () => ({ status: 'done', resultUrl: 'https://x/y.mp4' }),
  }, over);
}

(async () => {
  // ---- runner ----
  await t('happy path: uploading -> queued -> running -> done, resolves ok', async () => {
    const states = []; const polls = seq({ status: 'queued' }, { status: 'running' }, { status: 'done', resultUrl: 'u' });
    const r = await RP.runRenderJob({ adapter: fakeAdapter({ poll: async () => polls() }), clip: { type: 'video/mp4' }, sleep: noSleep, onState: (s) => states.push(s) }).promise;
    assert.strictEqual(r.ok, true); assert.deepStrictEqual(states, ['uploading', 'queued', 'queued', 'running', 'done']);
    assert.strictEqual(r.result.url, 'u');
  });
  await t('transient submit failure (503) is retried, then succeeds', async () => {
    let n = 0; const a = fakeAdapter({ submit: async () => { if (++n < 3) throw Object.assign(new Error('x'), { status: 503 }); return { jobId: 'J' }; } });
    const r = await RP.runRenderJob({ adapter: a, clip: {}, sleep: noSleep, retries: 2 }).promise;
    assert.strictEqual(r.ok, true); assert.strictEqual(n, 3);
  });
  await t('non-transient failure (401) is NOT retried and gives a friendly message', async () => {
    let n = 0; const a = fakeAdapter({ submit: async () => { n++; throw Object.assign(new Error('bad key sk-SECRET'), { status: 401 }); } });
    const r = await RP.runRenderJob({ adapter: a, clip: {}, sleep: noSleep }).promise;
    assert.strictEqual(r.ok, false); assert.strictEqual(n, 1); assert.ok(/untouched/.test(r.error)); assert.ok(!/SECRET/.test(r.error), 'raw upstream text must not leak into the UI message');
  });
  await t('retries exhausted -> error, not a throw', async () => {
    const a = fakeAdapter({ submit: async () => { throw Object.assign(new Error('down'), { status: 500 }); } });
    const r = await RP.runRenderJob({ adapter: a, clip: {}, sleep: noSleep, retries: 1 }).promise;
    assert.strictEqual(r.state, 'error'); assert.strictEqual(r.attempts, 2);
  });
  await t('provider-reported error ends the job (no retry loop)', async () => {
    const r = await RP.runRenderJob({ adapter: fakeAdapter({ poll: async () => ({ status: 'error', error: 'content rejected' }) }), clip: {}, sleep: noSleep }).promise;
    assert.strictEqual(r.state, 'error'); assert.ok(/content rejected/.test(r.error));
  });
  await t('overall timeout stops the job and says the recording is untouched', async () => {
    let clock = 0; const r = await RP.runRenderJob({ adapter: fakeAdapter({ poll: async () => ({ status: 'running' }) }), clip: {}, timeoutMs: 1000, now: () => (clock += 400), sleep: noSleep }).promise;
    assert.strictEqual(r.state, 'error'); assert.strictEqual(r.timeout, true); assert.ok(/untouched/.test(r.error));
  });
  await t('cancel() during polling resolves as cancelled and tells the adapter', async () => {
    let cancelled = null; let job;
    const a = fakeAdapter({ poll: async () => { job.cancel(); return { status: 'running' }; }, cancel: async ({ jobId }) => { cancelled = jobId; } });
    job = RP.runRenderJob({ adapter: a, clip: {}, sleep: noSleep });
    const r = await job.promise; await new Promise((x) => setTimeout(x, 5));
    assert.strictEqual(r.state, 'cancelled'); assert.strictEqual(cancelled, 'J1');
  });
  await t('unavailable adapter / no adapter / no clip: clear error, no network call', async () => {
    let called = 0; const spy = fakeAdapter({ available: () => ({ ok: false, reason: 'not set up' }), submit: async () => { called++; return { jobId: 'x' }; } });
    assert.strictEqual((await RP.runRenderJob({ adapter: spy, clip: {} }).promise).error, 'not set up'); assert.strictEqual(called, 0);
    assert.strictEqual((await RP.runRenderJob({ clip: {} }).promise).state, 'error');
    assert.strictEqual((await RP.runRenderJob({ adapter: fakeAdapter(), clip: null }).promise).state, 'error');
  });
  await t('download blocked (CORS) keeps the finished result URL instead of failing the job', async () => {
    const a = fakeAdapter({ fetchResult: async () => { throw new TypeError('Failed to fetch'); } });
    const r = await RP.runRenderJob({ adapter: a, clip: {}, sleep: noSleep, retries: 0 }).promise;
    assert.strictEqual(r.ok, true); assert.strictEqual(r.result.downloadFailed, true); assert.strictEqual(r.result.url, 'https://x/y.mp4');
  });
  await t('a throwing onState callback cannot break the job', async () => {
    const r = await RP.runRenderJob({ adapter: fakeAdapter(), clip: {}, sleep: noSleep, onState: () => { throw new Error('ui bug'); } }).promise;
    assert.strictEqual(r.ok, true);
  });
  await t('relay adapter reports "not set up" with an empty URL (live path unaffected)', () => {
    assert.strictEqual(RP.createRelayAdapter({ baseUrl: '' }).available().ok, false);
  });
  await t('privacy notice + Level 3 prompt exist and the prompt forbids extra people/text', () => {
    assert.ok(/uploaded/i.test(RP.PRIVACY_NOTICE) && /press the button/i.test(RP.PRIVACY_NOTICE));
    assert.ok(/chair/i.test(RP.LEVEL3_PROMPT) && /Do not add people or text/.test(RP.LEVEL3_PROMPT));
  });

  // ---- relay + fake upstream (AI/ML API contract as documented) ----
  const seen = { posts: [], gets: [] }; let genPolls = 0;
  const upstream = http.createServer((req, res) => {
    let b = ''; req.on('data', (c) => (b += c)); req.on('end', () => {
      res.setHeader('Content-Type', 'application/json');
      if (req.method === 'POST' && req.url === '/v2/video/generations') { seen.posts.push({ auth: req.headers.authorization, body: JSON.parse(b) }); return res.end(JSON.stringify({ id: 'G123', status: 'queued' })); }
      if (req.method === 'GET' && req.url.startsWith('/v2/video/generations?generation_id=G123')) { seen.gets.push(req.headers.authorization); genPolls++;
        return res.end(JSON.stringify(genPolls < 2 ? { id: 'G123', status: 'generating' } : { id: 'G123', status: 'completed', video: { url: 'http://127.0.0.1:' + upPort + '/out.mp4' } })); }
      if (req.url === '/out.mp4') { res.setHeader('Content-Type', 'video/mp4'); return res.end(Buffer.from('FAKEMP4RESULT')); }
      res.statusCode = 404; res.end('{}');
    });
  });
  const upPort = await listen(upstream);
  const provider = createAimlapiProvider({ key: 'sk-UPSTREAM-SECRET', base: 'http://127.0.0.1:' + upPort + '/v2' });
  const relay = createRelay({ provider, token: 'tok', maxMB: 1, dailyCap: 2, maxActive: 5 });
  const rPort = await listen(relay); const base = 'http://127.0.0.1:' + rPort;
  const clip = new Blob([Buffer.alloc(2048, 7)], { type: 'video/mp4' });

  await t('end to end: client -> relay -> upstream; request matches the documented contract', async () => {
    const adapter = RP.createRelayAdapter({ baseUrl: base, token: 'tok' });
    const r = await RP.runRenderJob({ adapter, clip, prompt: RP.LEVEL3_PROMPT, options: { resolution: '720p', duration: 6 }, pollMs: 10, sleep: (ms) => new Promise((x) => setTimeout(x, 5)) }).promise;
    assert.strictEqual(r.ok, true, JSON.stringify(r)); assert.strictEqual(Buffer.from(await r.result.blob.arrayBuffer()).toString(), 'FAKEMP4RESULT');
    const p = seen.posts[0];
    assert.strictEqual(p.auth, 'Bearer sk-UPSTREAM-SECRET'); assert.strictEqual(p.body.model, 'alibaba/happyhorse-1-0');
    assert.ok(/^data:video\/mp4;base64,/.test(p.body.video_url)); assert.strictEqual(p.body.resolution, '720p'); assert.strictEqual(p.body.duration, 6);
    assert.strictEqual(p.body.audio_setting, 'origin'); assert.strictEqual(p.body.watermark, false); assert.ok(p.body.prompt.includes('Remove the original chair'));
  });
  await t('the upstream key never appears in any relay response', async () => {
    const res = await fetch(base + '/render/jobs', { method: 'POST', headers: { Authorization: 'Bearer tok', 'Content-Type': 'video/mp4' }, body: clip });
    const txt = await res.text(); assert.ok(!/UPSTREAM-SECRET/.test(txt));
  });
  await t('daily cap -> 429 (cost guard)', async () => {
    const res = await fetch(base + '/render/jobs', { method: 'POST', headers: { Authorization: 'Bearer tok', 'Content-Type': 'video/mp4' }, body: clip });
    assert.strictEqual(res.status, 429);
  });
  await t('wrong/missing token -> 401', async () => {
    assert.strictEqual((await fetch(base + '/render/jobs', { method: 'POST', headers: { 'Content-Type': 'video/mp4' }, body: clip })).status, 401);
  });
  await t('wrong content type -> 415; oversize -> 413', async () => {
    const r2 = createRelay({ provider: createMockProvider({ ms: 0 }), maxMB: 1 }); const p2 = await listen(r2); const b2 = 'http://127.0.0.1:' + p2;
    assert.strictEqual((await fetch(b2 + '/render/jobs', { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: 'x' })).status, 415);
    const big = await fetch(b2 + '/render/jobs', { method: 'POST', headers: { 'Content-Type': 'video/mp4' }, body: Buffer.alloc(1.5 * 1048576) }).then((r) => r.status).catch(() => 413);
    assert.strictEqual(big, 413); r2.close();
  });
  await t('no provider configured -> 503 and nothing forwarded', async () => {
    const r3 = createRelay({}); const p3 = await listen(r3); const res = await fetch('http://127.0.0.1:' + p3 + '/render/jobs', { method: 'POST', headers: { 'Content-Type': 'video/mp4' }, body: clip });
    assert.strictEqual(res.status, 503); const h = await (await fetch('http://127.0.0.1:' + p3 + '/render/health')).json(); assert.strictEqual(h.provider, null); r3.close();
  });
  await t('mock provider completes through the same client path', async () => {
    const r4 = createRelay({ provider: createMockProvider({ ms: 20 }) }); const p4 = await listen(r4);
    const r = await RP.runRenderJob({ adapter: RP.createRelayAdapter({ baseUrl: 'http://127.0.0.1:' + p4 }), clip, pollMs: 15, downloadResult: false, sleep: (ms) => new Promise((x) => setTimeout(x, ms)) }).promise;
    assert.strictEqual(r.ok, true); assert.ok(/mock-result/.test(r.result.url)); r4.close();
  });
  await t('upstream refusal (401) surfaces as a safe 502, not the raw upstream text', async () => {
    const bad = createAimlapiProvider({ key: 'x', base: 'http://127.0.0.1:' + upPort + '/nope' });
    const r5 = createRelay({ provider: bad }); const p5 = await listen(r5);
    const res = await fetch('http://127.0.0.1:' + p5 + '/render/jobs', { method: 'POST', headers: { 'Content-Type': 'video/mp4' }, body: clip });
    assert.ok(res.status >= 429); r5.close();
  });

  await t('self-hosted worker: relay -> worker runs the command -> result downloads (end to end)', async () => {
    const { createWorker } = require('../../server/render-worker.js'); const { createWorkerProvider } = require('../../server/render-relay.js');
    const w = createWorker({ cmd: 'cat {in} > {out}; test -s {prompt}', token: 'wt' }); const wp = await listen(w);
    const rl = createRelay({ provider: createWorkerProvider({ base: 'http://127.0.0.1:' + wp, token: 'wt' }), token: 'rt' }); const rp = await listen(rl);
    const r = await RP.runRenderJob({ adapter: RP.createRelayAdapter({ baseUrl: 'http://127.0.0.1:' + rp, token: 'rt' }), clip, prompt: 'hello', pollMs: 20, fetchImpl: undefined, sleep: (ms) => new Promise((x) => setTimeout(x, ms)) }).promise;
    assert.strictEqual(r.ok, true, JSON.stringify(r)); assert.ok(r.result.blob && r.result.blob.size === 2048, 'relay proxies the worker result so the worker token never reaches the browser');
    const bad = createWorker({ cmd: 'exit 3' }); const bp = await listen(bad); const rj = await fetch('http://127.0.0.1:' + bp + '/jobs', { method: 'POST', body: 'x' }); const id = (await rj.json()).id;
    await new Promise((x) => setTimeout(x, 400)); const st = await (await fetch('http://127.0.0.1:' + bp + '/jobs/' + id)).json(); assert.strictEqual(st.status, 'error');
    w.close(); rl.close(); bad.close();
  });

  await t('gemini provider: request matches the Omni docs; base64 result is served by the relay; key stays server-side', async () => {
    const { createGeminiProvider } = require('../../server/render-relay.js'); let seenReq = null;
    const g = http.createServer((req, res) => { let b = ''; req.on('data', (c) => (b += c)); req.on('end', () => { seenReq = { url: req.url, key: req.headers['x-goog-api-key'], body: JSON.parse(b) };
      setTimeout(() => { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ id: 'v1_x', status: 'completed', steps: [{ type: 'user_input' }, { type: 'thought' }, { type: 'model_output', content: [{ type: 'video', mime_type: 'video/mp4', data: Buffer.from('GEMINIRESULT').toString('base64') }] }] })); }, 60); }); });
    const gp = await listen(g); const rl = createRelay({ provider: createGeminiProvider({ key: 'AIza-SECRET', base: 'http://127.0.0.1:' + gp + '/v1beta' }) }); const rp = await listen(rl);
    const r = await RP.runRenderJob({ adapter: RP.createRelayAdapter({ baseUrl: 'http://127.0.0.1:' + rp }), clip, prompt: RP.LEVEL3_PROMPT, pollMs: 20, sleep: (ms) => new Promise((x) => setTimeout(x, ms)) }).promise;
    assert.strictEqual(r.ok, true, JSON.stringify(r)); assert.strictEqual(Buffer.from(await r.result.blob.arrayBuffer()).toString(), 'GEMINIRESULT');
    assert.strictEqual(seenReq.url, '/v1beta/interactions'); assert.strictEqual(seenReq.key, 'AIza-SECRET'); assert.strictEqual(seenReq.body.model, 'gemini-omni-1.1-flash'); assert.strictEqual(seenReq.body.response_format.type, 'video');
    const c = seenReq.body.input[0].content; assert.strictEqual(c[0].type, 'video'); assert.ok(c[0].data.length > 100); assert.strictEqual(c[1].type, 'text');
    g.close(); rl.close();
  });
  await t('gemini provider: refusal (403) becomes a safe message that mentions the region limit, not raw upstream text', async () => {
    const { createGeminiProvider } = require('../../server/render-relay.js');
    const g = http.createServer((req, res) => { req.resume(); req.on('end', () => { res.statusCode = 403; res.end(JSON.stringify({ error: { message: 'secret detail AIza-LEAK' } })); }); });
    const gp = await listen(g); const rl = createRelay({ provider: createGeminiProvider({ key: 'k', base: 'http://127.0.0.1:' + gp }) }); const rp = await listen(rl);
    const r = await RP.runRenderJob({ adapter: RP.createRelayAdapter({ baseUrl: 'http://127.0.0.1:' + rp }), clip, pollMs: 20, sleep: (ms) => new Promise((x) => setTimeout(x, ms)) }).promise;
    assert.strictEqual(r.ok, false); assert.ok(/EEA/.test(r.error) && !/LEAK/.test(r.error)); g.close(); rl.close();
  });

  relay.close(); upstream.close();
  console.log('\n' + pass + ' PASS, ' + fail + ' FAIL'); process.exit(fail ? 1 : 0);
})();
