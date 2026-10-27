/* Studio Check (Phase 0): ONE tap measures what this phone can really do, never changes the user's settings for good, and prints one report.
 * Measures: (1) camera controls and real frames/s with an exposure cap / min-fps request, (2) MODNet speed per engine and size (WebGPU vs WASM,
 * fixed size, graph capture) in a worker, (3) per-operation share of time on WebGPU, (4) main-thread long tasks during the check.
 * Safety: every step has a timeout and try/catch; camera settings are restored in `finally`; refuses to run while recording.
 * All thresholds below are EXPERIMENT inputs, not claims. Results are labelled MEASURED; recommendations are INFERRED until a phone confirms. */
(function () {
  'use strict';
  const sleepReal = (ms) => new Promise((r) => setTimeout(r, ms));
  const withTimeout = (p, ms, what) => new Promise((res, rej) => { const t = setTimeout(() => rej(new Error((what || 'step') + ' timed out')), ms); Promise.resolve(p).then((v) => { clearTimeout(t); res(v); }, (e) => { clearTimeout(t); rej(e); }); });
  const median = (a) => { if (!a.length) return null; const s = a.slice().sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };
  const pct = (a, p) => { if (!a.length) return null; const s = a.slice().sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(s.length * p))]; };
  const round1 = (v) => (v == null ? null : Math.round(v * 10) / 10);

  /** Share of total time per kernel type from ORT WebGPU profiling records. Unit-independent (percent), so it is valid whatever the time unit. */
  function aggregateProfile(records, top) {
    const by = new Map(); let total = 0;
    for (const r of records || []) {
      const d = Number(r.endTime) - Number(r.startTime); if (!isFinite(d) || d < 0) continue;
      const k = String(r.kernelType || r.kernelName || 'unknown'); const e = by.get(k) || { op: k, n: 0, t: 0 }; e.n++; e.t += d; by.set(k, e); total += d;
    }
    const rows = Array.from(by.values()).sort((a, b) => b.t - a.t).slice(0, top || 8).map((e) => ({ op: e.op, calls: e.n, sharePct: total ? round1(e.t / total * 100) : 0 }));
    return { totalKernels: (records || []).length, rows };
  }

  function lumaOf(video, mk) {
    try { const c = mk(32, 32); const x = c.getContext('2d', { willReadFrequently: true }); x.drawImage(video, 0, 0, 32, 32); const d = x.getImageData(0, 0, 32, 32).data; let s = 0; for (let i = 0; i < d.length; i += 4) s += 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]; return round1(s / (d.length / 4)); }
    catch (e) { return null; }
  }
  function decoded(video) { const q = video.getVideoPlaybackQuality && video.getVideoPlaybackQuality(); return q ? q.totalVideoFrames : 0; }

  /** Camera experiments. Returns { caps, baseline, experiments[], restored }. Never leaves the track changed. */
  async function cameraExperiments(env, say) {
    const { track, video, sleep, mkCanvas } = env; const out = { supported: !!(track && track.applyConstraints), experiments: [], restored: false };
    if (!out.supported) { out.note = 'no video track controls available'; return out; }
    let caps = {}, st0 = {}; try { caps = track.getCapabilities ? track.getCapabilities() : {}; st0 = track.getSettings ? track.getSettings() : {}; } catch (e) { /* keep empty */ }
    const pickRange = (r) => (r && typeof r === 'object' ? { min: r.min, max: r.max, step: r.step } : r);
    out.caps = { frameRate: pickRange(caps.frameRate), width: pickRange(caps.width), height: pickRange(caps.height), exposureMode: caps.exposureMode, exposureTime: pickRange(caps.exposureTime), exposureCompensation: pickRange(caps.exposureCompensation), iso: pickRange(caps.iso), whiteBalanceMode: caps.whiteBalanceMode, torch: caps.torch, facingMode: caps.facingMode };
    out.settings0 = { width: st0.width, height: st0.height, frameRate: st0.frameRate, exposureMode: st0.exposureMode, exposureTime: st0.exposureTime, iso: st0.iso, exposureCompensation: st0.exposureCompensation };
    const measure = async (dur) => { const n0 = decoded(video), t0 = env.now(); await sleep(dur); return round1((decoded(video) - n0) * 1000 / (env.now() - t0)); };
    const tryCfg = async (name, constraints) => {
      say('Camera test: ' + name + '...');
      const row = { name };
      try {
        await withTimeout(track.applyConstraints(constraints), 4000, 'applyConstraints'); await sleep(1500);
        const st = track.getSettings ? track.getSettings() : {};
        row.fps = await measure(2500); row.luma = lumaOf(video, mkCanvas);
        row.got = { frameRate: st.frameRate, exposureMode: st.exposureMode, exposureTime: st.exposureTime, iso: st.iso, exposureCompensation: st.exposureCompensation };
      } catch (e) { row.error = String((e && e.message) || e).slice(0, 90); }
      out.experiments.push(row); return row;
    };
    try {
      say('Camera test: baseline...'); await sleep(300);
      out.baseline = { fps: await measure(2500), luma: lumaOf(video, mkCanvas) };
      const adv = (o) => ({ advanced: [o] });
      const modes = caps.exposureMode || [];
      await tryCfg('min 24 fps requested', { frameRate: { min: 24, ideal: 30 } });
      if (modes.indexOf('manual') >= 0 && caps.exposureTime) {
        const lo = caps.exposureTime.min || 1, hi = caps.exposureTime.max || 1000;
        const isoCap = caps.iso ? Math.min(caps.iso.max || 800, 800) : null;
        for (const t of [300, 200]) {                    // exposureTime unit per W3C is 100 microseconds: 300 = 30 ms, 200 = 20 ms
          if (t < lo || t > hi) continue;
          const o = { exposureMode: 'manual', exposureTime: t }; if (isoCap) o.iso = isoCap;
          await tryCfg('manual exposure ' + (t / 10) + ' ms' + (isoCap ? ', ISO ' + isoCap : ''), adv(o));
        }
      } else out.experiments.push({ name: 'manual exposure', error: 'not offered by this camera (exposureMode: ' + JSON.stringify(modes) + ')' });
      if (caps.exposureCompensation && caps.exposureCompensation.max != null) await tryCfg('exposure compensation +max', adv({ exposureMode: 'continuous', exposureCompensation: caps.exposureCompensation.max }));
      else out.experiments.push({ name: 'exposure compensation', error: 'not offered by this camera' });
    } finally {
      try {   // restore: automatic exposure, original frame-rate request
        const back = { frameRate: { ideal: 30 } };
        await withTimeout(track.applyConstraints(back), 4000, 'restore'); 
        if ((caps.exposureMode || []).indexOf(st0.exposureMode || 'continuous') >= 0 || (caps.exposureMode || []).indexOf('continuous') >= 0) await withTimeout(track.applyConstraints({ advanced: [{ exposureMode: st0.exposureMode || 'continuous' }] }), 4000, 'restore exposure');
        out.restored = true;
      } catch (e) { out.restoreError = String((e && e.message) || e).slice(0, 90); }
    }
    return out;
  }

  /** MODNet matrix in workers. makeProvider(opts) -> provider with initialize(quality, opts)/segment(video)/profileGet()/dispose(). */
  async function modelExperiments(env, say) {
    const { video, sleep, makeProvider, sizeFor } = env; const rows = [];
    const vw = video.videoWidth || 360, vh = video.videoHeight || 480; const hasGpu = env.hasGpu;
    const cfgs = [
      { name: 'WASM 320', ep: 'wasm', edge: 320 },
      hasGpu && { name: 'WebGPU 320', ep: 'webgpu', edge: 320 },
      hasGpu && { name: 'WebGPU 320 fixed + graph capture', ep: 'webgpu', edge: 320, fixed: true, graphCapture: true },
      hasGpu && { name: 'WebGPU 256 fixed + graph capture', ep: 'webgpu', edge: 256, fixed: true, graphCapture: true },
      hasGpu && { name: 'WebGPU 448 (current default size)', ep: 'webgpu', edge: 448 },
    ].filter(Boolean);
    let profiled = false;
    for (const c of cfgs) {
      say('Model test: ' + c.name + '...'); const row = { name: c.name }; let p = null;
      try {
        const [mw, mh] = sizeFor(vw, vh, c.edge);
        const opts = { ep: c.ep, profile: c.ep === 'webgpu' && !profiled, fixed: c.fixed ? { w: mw, h: mh } : null, graphCapture: !!c.graphCapture };
        p = makeProvider(); p.longEdge = c.edge;
        const t0 = env.now(); await withTimeout(p.initialize('balanced', opts), 60000, 'init'); row.initMs = Math.round(env.now() - t0); row.engine = p.usingWebGPU ? 'WebGPU' : 'WASM'; if (p.initNote) row.note = p.initNote; if (c.ep === 'webgpu' && !p.usingWebGPU) row.note = 'WebGPU setup failed, ran on WASM instead: ' + (p.initNote || 'unknown'); row.size = mw + 'x' + mh;
        const times = [];
        for (let i = 0; i < 12; i++) { const a = env.now(); await withTimeout(p.segment(video), 8000, 'segment'); const d = env.now() - a; if (i >= 2) times.push(d); await sleep(20); if (i >= 2 && d > 600) break; }
        row.medianMs = round1(median(times)); row.p95Ms = round1(pct(times, 0.95)); row.runs = times.length;
        if (opts.profile && p.profileGet) { try { row.profile = aggregateProfile(await withTimeout(p.profileGet(), 5000, 'profile'), 8); profiled = true; } catch (e) { row.profileError = String(e.message || e).slice(0, 60); } }
      } catch (e) { row.error = String((e && e.message) || e).slice(0, 110); }
      finally { try { p && p.dispose && p.dispose(); } catch (e) { /* ignore */ } }
      rows.push(row);
    }
    return rows;
  }

  /** Recommendations are INFERRED from the MEASURED rows above. They are suggestions for the next phase, not applied here. */
  function recommend(sum) {
    const r = []; const base = sum.camera && sum.camera.baseline; const exps = (sum.camera && sum.camera.experiments) || [];
    if (base) {
      const best = exps.filter((e) => e.fps != null).sort((a, b) => b.fps - a.fps)[0];
      if (best && best.fps > base.fps * 1.3 && (best.luma == null || base.luma == null || best.luma >= base.luma * 0.4)) r.push('Camera: "' + best.name + '" raised real fps ' + base.fps + ' -> ' + best.fps + (best.luma != null && base.luma != null ? ' (brightness ' + base.luma + ' -> ' + best.luma + ', software brightening needed if lower)' : '') + '. Use it in Phase 1 behind a self-check.');
      else if (base.fps < 20) r.push('Camera stays slow (' + base.fps + ' fps) with every tested control. Cause is probably light/hardware: use light guidance and accept the camera rate.');
    }
    const ok = (sum.model || []).filter((m) => m.medianMs != null).sort((a, b) => a.medianMs - b.medianMs);
    if (ok[0]) r.push('Fastest model setup: "' + ok[0].name + '" at ' + ok[0].medianMs + ' ms median (' + ok[0].engine + ', ' + ok[0].size + ').');
    return r;
  }

  async function run(opts) {
    const env = Object.assign({ now: () => performance.now(), sleep: sleepReal, mkCanvas: (w, h) => { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; }, hasGpu: typeof navigator !== 'undefined' && !!navigator.gpu, progress: null }, opts || {});
    const say = (t) => { try { env.progress && env.progress(t); } catch (e) { /* ignore */ } };
    if (env.isRecording && env.isRecording()) throw new Error('Stop recording first: Studio Check pauses the live picture.');
    if (!env.video || !env.video.videoWidth) throw new Error('Start the camera first, then run Studio Check.');
    const sum = { version: 1, startedAt: new Date().toISOString(), label: 'MEASURED unless marked INFERRED', longTasks: null };
    let long = 0, longMax = 0, po = null;
    try { if (typeof PerformanceObserver !== 'undefined') { po = new PerformanceObserver((l) => { for (const e of l.getEntries()) { long++; longMax = Math.max(longMax, e.duration); } }); po.observe({ entryTypes: ['longtask'] }); } } catch (e) { po = null; }
    const t0 = env.now();
    try {
      try { sum.camera = await cameraExperiments(env, say); } catch (e) { sum.camera = { error: String(e.message || e) }; }
      if (env.makeProvider) { try { sum.model = await modelExperiments(env, say); } catch (e) { sum.model = [{ name: 'model tests', error: String(e.message || e) }]; } }
      sum.recommendations = recommend(sum);
    } finally { try { po && po.disconnect(); } catch (e) { /* ignore */ } }
    sum.longTasks = po ? { count: long, maxMs: Math.round(longMax) } : 'not supported';
    sum.seconds = Math.round((env.now() - t0) / 1000);
    return sum;
  }

  function format(s) {
    if (!s) return 'Studio Check: not run yet';
    const L = ['STUDIO CHECK (' + s.seconds + ' s) ' + s.startedAt + '  [' + s.label + ']'];
    const c = s.camera || {};
    if (c.error) L.push('  Camera: error ' + c.error);
    else {
      L.push('  Camera caps: ' + JSON.stringify(c.caps)); L.push('  Camera settings at start: ' + JSON.stringify(c.settings0));
      if (c.baseline) L.push('  Baseline (decoded fps / brightness 0-255): ' + c.baseline.fps + ' / ' + c.baseline.luma);
      (c.experiments || []).forEach((e) => L.push('  CAMERA TEST ' + e.name + ' | ' + (e.error ? 'n/a: ' + e.error : 'fps ' + e.fps + ' | brightness ' + e.luma + ' | got ' + JSON.stringify(e.got))));
      L.push('  Camera restored: ' + c.restored + (c.restoreError ? ' (' + c.restoreError + ')' : ''));
    }
    (s.model || []).forEach((m) => {
      L.push('  MODEL ' + m.name + ' | ' + (m.error ? 'n/a: ' + m.error : m.engine + ' ' + m.size + ' | median ' + m.medianMs + ' ms | p95 ' + m.p95Ms + ' ms | init ' + m.initMs + ' ms'));
      if (m.profile && m.profile.rows.length) L.push('    WebGPU op share of time (' + m.profile.totalKernels + ' kernels): ' + m.profile.rows.map((r) => r.op + ' ' + r.sharePct + '%').join(', '));
      if (m.note) L.push('    note: ' + m.note);
      if (m.profileError) L.push('    profile n/a: ' + m.profileError);
    });
    L.push('  Main-thread long tasks during check: ' + JSON.stringify(s.longTasks));
    (s.recommendations || []).forEach((r) => L.push('  INFERRED: ' + r));
    return L.join('\n');
  }

  const api = { run, format, aggregateProfile, cameraExperiments, modelExperiments, recommend };
  if (typeof window !== 'undefined') { window.VS = window.VS || {}; window.VS.studioCheck = api; }
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
