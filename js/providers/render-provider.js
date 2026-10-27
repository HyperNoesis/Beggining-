/**
 * Optional AI re-render path (Path C of the Level 3 architecture) - CLIENT side.
 *
 * WHAT THIS IS: after a clip is recorded, optionally send it to a source-video-editing model through a
 * relay (server/render-relay.js) and get an enhanced clip back. It is OPT-IN, ASYNCHRONOUS and EXPERIMENTAL.
 *
 * WHAT IT IS NOT: part of the live path. Nothing in the camera -> segmentation -> compositing -> preview ->
 * recording chain imports or waits for this file. If this file is missing, the relay is down, the key is
 * gone or the free tier is used up, live preview and recording behave exactly the same.
 *
 * PRIVACY: running a job UPLOADS the clip to the relay and from there to the model vendor. The UI that calls
 * this must say so before the first job (see PRIVACY_NOTICE) and must never call it automatically.
 *
 * Works in the browser (window.VS.RenderProvider) and in Node (module.exports) so it is unit-tested.
 */
(function (root) {
  'use strict';

  const PRIVACY_NOTICE =
    'This sends your recorded clip over the internet to an AI video service (through the Genesis relay) to be re-rendered. ' +
    'Nothing is uploaded unless you press the button, and live preview and recording never depend on it.';

  // Wording for the one experiment we are running. Kept here so the experiment tool and the app use the same text.
  const LEVEL3_PROMPT =
    'Keep the same person exactly: same face, hair, skin tone, clothes, body shape and every movement and gesture, frame by frame. ' +
    'Change only the place: the person is sitting on a deep green velvet sofa in a warm living room with a low marble coffee table in front. ' +
    'Remove the original chair completely. Keep the camera framing and lighting natural. Do not add people or text.';

  const TERMINAL = { done: 1, error: 1, cancelled: 1 };

  const defaultSleep = (ms, signal) => new Promise((resolve) => {
    const t = setTimeout(resolve, ms);
    if (signal) signal.addEventListener('abort', () => { clearTimeout(t); resolve(); }, { once: true });
  });

  /** Transient = worth retrying (network failure, 429, 5xx). Everything else is final. */
  function isTransient(err) {
    if (!err) return false;
    if (err.transient === true) return true;
    if (err.transient === false) return false;
    const s = err.status;
    return s === 429 || (typeof s === 'number' && s >= 500) || err.name === 'TypeError' /* fetch network failure */;
  }

  function friendly(err) {
    const s = err && err.status;
    if (s === 401 || s === 403) return 'The AI render service refused the request (key or access problem). Your recording is untouched.';
    if (s === 402 || s === 429) return 'The AI render quota or free allowance is used up. Your recording is untouched.';
    if (s === 413) return 'That clip is too large for the AI render service. Try a shorter clip.';
    if (s === 503) return 'AI re-render is not set up on this server. Your recording is untouched.';
    if (err && err.message) return String(err.message).slice(0, 200);
    return 'AI render failed. Your recording is untouched.';
  }

  /**
   * Run one job. Never throws and never rejects: the promise always resolves to
   *   { ok, state, result?: { url?, blob? }, error?, attempts, ms }
   * opts: { adapter, clip, prompt, options, timeoutMs=900000, pollMs=5000, retries=2, onState, sleep, now, downloadResult=true }
   */
  function runRenderJob(opts) {
    const o = Object.assign({ timeoutMs: 15 * 60 * 1000, pollMs: 5000, retries: 2, downloadResult: true, options: {} }, opts || {});
    const sleep = o.sleep || defaultSleep;
    const now = o.now || (() => Date.now());
    const ac = (typeof AbortController !== 'undefined') ? new AbortController() : { signal: undefined, abort() {} };
    const t0 = now();
    let state = 'idle', cancelled = false, jobId = null, attempts = 0;

    const setState = (s, extra) => { state = s; try { o.onState && o.onState(s, extra || {}); } catch (_) { /* UI callback must not break the job */ } };

    async function withRetry(fn) {
      let lastErr;
      for (let i = 0; i <= o.retries; i++) {
        if (cancelled) throw Object.assign(new Error('cancelled'), { cancelled: true });
        attempts++;
        try { return await fn(); } catch (e) {
          lastErr = e;
          if (e && e.cancelled) throw e;
          if (!isTransient(e) || i === o.retries) throw e;
          await sleep(Math.min(1000 * Math.pow(3, i), 15000), ac.signal); // 1 s, 3 s, 9 s ...
        }
      }
      throw lastErr;
    }

    const promise = (async () => {
      try {
        const a = o.adapter;
        if (!a) throw Object.assign(new Error('No AI render adapter configured.'), { transient: false });
        const av = a.available ? a.available() : { ok: true };
        if (!av.ok) throw Object.assign(new Error(av.reason || 'AI render is not available.'), { transient: false });
        if (!o.clip) throw Object.assign(new Error('No clip to render.'), { transient: false });

        setState('uploading');
        const sub = await withRetry(() => a.submit({ clip: o.clip, prompt: o.prompt, options: o.options, signal: ac.signal }));
        jobId = sub.jobId;
        setState('queued', { jobId });

        // poll until terminal, overall timeout
        for (;;) {
          if (cancelled) throw Object.assign(new Error('cancelled'), { cancelled: true });
          if (now() - t0 > o.timeoutMs) throw Object.assign(new Error('The AI render took too long and was stopped. Your recording is untouched.'), { transient: false, timeout: true });
          const p = await withRetry(() => a.poll({ jobId, signal: ac.signal }));
          if (p.status === 'queued') setState('queued', { jobId });
          else if (p.status === 'running') setState('running', { jobId });
          else if (p.status === 'error') throw Object.assign(new Error(p.error || 'The AI render service reported an error.'), { transient: false });
          else if (p.status === 'done') {
            let result = { url: p.resultUrl };
            if (o.downloadResult && a.fetchResult && p.resultUrl) {
              setState('downloading', { jobId });
              // Vendor CDNs often block cross-origin downloads: that must not lose a finished (paid) render, so keep the URL.
              try { result = Object.assign(result, await withRetry(() => a.fetchResult({ url: p.resultUrl, signal: ac.signal }))); }
              catch (e) { if (e && e.cancelled) throw e; result.downloadFailed = true; }
            }
            setState('done', { jobId });
            return { ok: true, state: 'done', result, attempts, ms: now() - t0 };
          } else throw new Error('Unknown job status: ' + p.status);
          await sleep(o.pollMs, ac.signal);
        }
      } catch (e) {
        if (e && e.cancelled || cancelled) { setState('cancelled'); return { ok: false, state: 'cancelled', attempts, ms: now() - t0 }; }
        setState('error', { message: friendly(e) });
        return { ok: false, state: 'error', error: friendly(e), timeout: !!(e && e.timeout), attempts, ms: now() - t0 };
      }
    })();

    return {
      promise,
      state: () => state,
      jobId: () => jobId,
      cancel() {
        if (TERMINAL[state]) return;
        cancelled = true; try { ac.abort(); } catch (_) { /* ignore */ }
        const a = o.adapter;
        if (a && a.cancel && jobId) Promise.resolve().then(() => a.cancel({ jobId })).catch(() => {});
      },
    };
  }

  /** Adapter that talks to server/render-relay.js. All vendor details and keys live on the relay. */
  function createRelayAdapter(cfg) {
    const c = Object.assign({ baseUrl: '', token: '', fetchImpl: (typeof fetch !== 'undefined' ? fetch.bind(root) : null) }, cfg || {});
    const base = String(c.baseUrl || '').replace(/\/+$/, '');
    const headers = (extra) => Object.assign({}, c.token ? { Authorization: 'Bearer ' + c.token } : {}, extra || {});
    async function call(url, init) {
      const res = await c.fetchImpl(url, init);
      let body = null; try { body = await res.json(); } catch (_) { /* non-JSON */ }
      if (!res.ok) throw Object.assign(new Error((body && body.error) || ('HTTP ' + res.status)), { status: res.status });
      return body || {};
    }
    return {
      id: 'relay',
      label: 'Genesis relay',
      available() {
        if (!base) return { ok: false, reason: 'AI re-render is not set up (no relay URL in js/config.js).' };
        if (!c.fetchImpl) return { ok: false, reason: 'This browser cannot make network requests.' };
        return { ok: true };
      },
      async submit({ clip, prompt, options, signal }) {
        const q = new URLSearchParams();
        q.set('prompt', String(prompt || '').slice(0, 2000));
        if (options && options.resolution) q.set('resolution', options.resolution);
        if (options && options.duration) q.set('duration', String(options.duration));
        const type = (clip && clip.type) || 'video/mp4';
        const j = await call(base + '/render/jobs?' + q.toString(), { method: 'POST', headers: headers({ 'Content-Type': type }), body: clip, signal });
        if (!j.jobId) throw new Error('The relay did not return a job id.');
        return { jobId: j.jobId };
      },
      async poll({ jobId, signal }) {
        const j = await call(base + '/render/jobs/' + encodeURIComponent(jobId), { headers: headers(), signal });
        return { status: j.status, resultUrl: j.resultUrl, error: j.error };
      },
      async fetchResult({ url, signal }) {
        const res = await c.fetchImpl(url, { signal, headers: String(url).indexOf(base + '/') === 0 ? headers() : {} });   // token only to OUR relay, never to a vendor CDN
        if (!res.ok) throw Object.assign(new Error('Could not download the finished clip (HTTP ' + res.status + ').'), { status: res.status });
        return { blob: await res.blob() };
      },
      async cancel({ jobId }) {
        await c.fetchImpl(base + '/render/jobs/' + encodeURIComponent(jobId), { method: 'DELETE', headers: headers() });
      },
    };
  }

  const api = { runRenderJob, createRelayAdapter, isTransient, friendly, PRIVACY_NOTICE, LEVEL3_PROMPT };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else { root.VS = root.VS || {}; root.VS.RenderProvider = api; }
})(typeof self !== 'undefined' ? self : this);
