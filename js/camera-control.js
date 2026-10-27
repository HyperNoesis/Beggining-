/**
 * v0.49 Phase 1: camera control. Phone cameras in dim rooms lengthen exposure and fall to ~10 fps; "bright" and "steady fps" are one problem.
 * After the camera starts (and only when it is NOT recording or live) this module:
 *   1. measures the real frame rate (decoded frames/s) with the camera as it is (baseline);
 *   2. if that is already steady (>= GOOD_FPS) it stops: nothing is changed;
 *   3. otherwise it tries, one at a time, with a timeout each: a min-24-fps request, then a manual exposure cap (33 ms, then 25 ms) with a limited ISO;
 *   4. it KEEPS a setting only if the measured fps really rose and the picture is not too dark to brighten; otherwise it restores automatic exposure.
 * A software brightening gain (1.0 .. MAX_GAIN, never darker) compensates for the shorter exposure; the grade pipeline applies it (assistB).
 * Every step is optional and fails safe: any error restores automatic exposure and the app keeps running. No denoise here (see docs).
 * Labels: results are MEASURED on the device that runs it; whether a given phone accepts these controls is UNVERIFIED until its report is seen.
 */
(function (root) {
  const GOOD_FPS = 24, MIN_GAIN_FPS = 3, MIN_GAIN_RATIO = 1.3, MAX_GAIN = 1.8, TARGET_LUMA = 110, SETTLE_MS = 1200, MEASURE_MS = 2500, APPLY_TIMEOUT = 4000;
  const round1 = (x) => Math.round(x * 10) / 10, clamp = (x, a, b) => Math.max(a, Math.min(b, x));
  const withTimeout = (p, ms, what) => Promise.race([Promise.resolve(p), new Promise((_, rej) => setTimeout(() => rej(new Error(what + ' timed out')), ms))]);

  let st = fresh();
  function fresh() { return { phase: 'idle', mode: 'auto', decision: null, gain: 1, luma: null, rows: [], fpsBefore: null, fpsAfter: null, note: '', token: 0 }; }

  function decoded(video) { const q = video && video.getVideoPlaybackQuality && video.getVideoPlaybackQuality(); return q ? q.totalVideoFrames : null; }
  function defaultLuma(video) {
    try {
      const cv = defaultLuma.cv || (defaultLuma.cv = document.createElement('canvas')); cv.width = 32; cv.height = 24;
      const cx = cv.getContext('2d', { willReadFrequently: true }), vw = video.videoWidth, vh = video.videoHeight; if (!vw || !vh) return null;
      cx.drawImage(video, vw * 0.2, vh * 0.15, vw * 0.6, vh * 0.7, 0, 0, 32, 24);
      const d = cx.getImageData(0, 0, 32, 24).data; let s = 0; for (let i = 0; i < d.length; i += 4) s += 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];
      return s / (d.length / 4);
    } catch (e) { return null; }
  }
  /** Gain needed to bring a measured luma to TARGET_LUMA. Only brightens. null luma -> 1. */
  function gainFor(luma) { if (!(luma > 1)) return 1; const g = TARGET_LUMA / luma; return g < 1.06 ? 1 : clamp(g, 1, MAX_GAIN); }
  /** True when this much darkness cannot be rescued by software gain (the picture would be mostly noise). */
  function tooDark(luma) { return luma != null && luma > 1 && TARGET_LUMA / luma > MAX_GAIN * 1.35; }

  function buildCandidates(caps) {
    const out = [], modes = (caps && caps.exposureMode) || [], fr = caps && caps.frameRate;
    if (!fr || fr.max == null || fr.max >= GOOD_FPS) out.push({ name: 'min 24 fps request', constraints: { frameRate: { min: GOOD_FPS, ideal: 30 } }, manual: false });
    const et = caps && caps.exposureTime;
    if (modes.indexOf('manual') >= 0 && et && et.max != null) {           // W3C exposureTime unit: 100 microseconds, so 330 = 33 ms
      const lo = et.min != null ? et.min : 1, hi = et.max;
      const iso = caps.iso && caps.iso.max != null ? clamp(1600, caps.iso.min || 0, caps.iso.max) : null;
      [330, 250].forEach((t) => {
        const v = clamp(t, lo, hi); if (out.some((c) => c.exposureTime === v)) return;
        const a = { exposureMode: 'manual', exposureTime: v }; if (iso != null) a.iso = iso;
        out.push({ name: 'manual exposure ' + (v / 10) + ' ms' + (iso != null ? ', ISO ' + iso : ''), constraints: { advanced: [a] }, manual: true, exposureTime: v });
      });
    }
    return out;
  }

  async function restoreAuto(track, caps, want) {
    const errs = [];
    try { await withTimeout(track.applyConstraints({ frameRate: { ideal: 30 } }), APPLY_TIMEOUT, 'restore frame rate'); } catch (e) { errs.push(String((e && e.message) || e)); }
    try {
      const modes = (caps && caps.exposureMode) || [];
      if (modes.indexOf('continuous') >= 0) await withTimeout(track.applyConstraints({ advanced: [{ exposureMode: 'continuous' }] }), APPLY_TIMEOUT, 'restore exposure');
    } catch (e) { errs.push(String((e && e.message) || e)); }
    return errs.length ? errs.join('; ').slice(0, 120) : null;
  }

  /**
   * env = { track, video, sleep(ms), now(), luma?(video), canRun?() }. Resolves with the decision object; never throws; always leaves the camera
   * either on the kept setting or back on automatic exposure.
   */
  async function tune(env) {
    const my = ++st.token; st = Object.assign(fresh(), { token: my, phase: 'testing' });
    const track = env && env.track, video = env && env.video;
    const sleep = (env && env.sleep) || ((ms) => new Promise((r) => setTimeout(r, ms))), now = (env && env.now) || (() => (typeof performance !== 'undefined' ? performance.now() : Date.now()));
    const lumaOf = (env && env.luma) || defaultLuma, canRun = (env && env.canRun) || (() => true);
    const alive = () => st.token === my;
    const finish = (d) => { if (!alive()) return d; st.phase = 'done'; st.decision = d; st.note = d.reason; return d; };
    if (!track || !track.applyConstraints || !video) return finish({ kept: null, reason: 'no camera controls available; automatic camera left alone' });
    let caps = {}; try { caps = track.getCapabilities ? track.getCapabilities() : {}; } catch (e) { /* none */ }
    const measure = async (dur) => {
      const n0 = decoded(video), t0 = now(); await sleep(dur); const n1 = decoded(video), dt = now() - t0;
      if (n0 == null || n1 == null || dt <= 0) return null; return round1((n1 - n0) * 1000 / dt);
    };
    try {
      if (!canRun()) return finish({ kept: null, reason: 'recording or live: camera left alone' });
      const f0 = await measure(MEASURE_MS), l0 = lumaOf(video); st.fpsBefore = f0; st.luma = l0 != null ? Math.round(l0) : null;
      if (f0 == null) return finish({ kept: null, reason: 'frame rate cannot be measured on this device; automatic camera left alone' });
      if (f0 >= GOOD_FPS) { st.gain = gainFor(l0); st.fpsAfter = f0; return finish({ kept: null, fpsBefore: f0, reason: 'camera already steady (' + f0 + ' fps); nothing changed' }); }
      const cands = buildCandidates(caps); let best = null;
      if (!cands.length) return finish({ kept: null, fpsBefore: f0, reason: 'this camera offers no frame-rate or exposure control (' + f0 + ' fps stays)' });
      for (const c of cands) {
        if (!alive() || !canRun()) break;
        const row = { name: c.name };
        try {
          await withTimeout(track.applyConstraints(c.constraints), APPLY_TIMEOUT, 'applyConstraints'); await sleep(SETTLE_MS);
          row.fps = await measure(MEASURE_MS); row.luma = (() => { const l = lumaOf(video); return l != null ? Math.round(l) : null; })();
          const s = track.getSettings ? track.getSettings() : {}; row.got = { frameRate: s.frameRate, exposureMode: s.exposureMode, exposureTime: s.exposureTime, iso: s.iso };
          row.ok = row.fps != null && row.fps >= f0 + MIN_GAIN_FPS && row.fps >= f0 * MIN_GAIN_RATIO && !tooDark(row.luma);
          if (row.fps != null && row.fps >= f0 + MIN_GAIN_FPS && tooDark(row.luma)) row.why = 'faster but too dark to rescue';
          if (row.ok && (!best || row.fps > best.row.fps)) best = { row, c };
        } catch (e) { row.error = String((e && e.message) || e).slice(0, 90); }
        st.rows.push(row);
        if (row.ok && row.fps >= GOOD_FPS + 3) break;                       // steady enough: stop testing
      }
      if (!alive()) return { kept: null, reason: 'superseded' };
      if (best) {
        const last = st.rows[st.rows.length - 1];
        if (last !== best.row) {                                            // the best was not the last one tried: re-apply it
          await withTimeout(track.applyConstraints(best.c.constraints), APPLY_TIMEOUT, 'reapply'); await sleep(SETTLE_MS);
        }
        st.mode = best.c.manual ? 'manual' : 'auto'; st.fpsAfter = best.row.fps; st.gain = gainFor(best.row.luma); if (best.row.luma != null) st.luma = best.row.luma;
        return finish({ kept: best.row.name, fpsBefore: f0, fpsAfter: best.row.fps, lumaBefore: l0 != null ? Math.round(l0) : null, lumaAfter: best.row.luma, gain: +st.gain.toFixed(2), reason: 'kept "' + best.row.name + '": ' + f0 + ' -> ' + best.row.fps + ' fps' });
      }
      const err = await restoreAuto(track, caps);
      st.mode = 'auto'; st.fpsAfter = f0; st.gain = gainFor(l0);
      return finish({ kept: null, fpsBefore: f0, reason: 'no setting raised the real fps enough (' + f0 + ' fps); automatic camera restored' + (err ? ' (restore warning: ' + err + ')' : ''), restoreWarning: err || undefined });
    } catch (e) {
      try { await restoreAuto(track, caps); } catch (e2) { /* nothing more to do */ }
      st.mode = 'auto'; st.gain = 1;
      return finish({ kept: null, reason: 'camera test failed (' + String((e && e.message) || e).slice(0, 80) + '); automatic camera restored' });
    }
  }

  const api = {
    GOOD_FPS, MAX_GAIN, TARGET_LUMA, buildCandidates, gainFor, tooDark, tune,
    /** Browser glue: run once after the camera starts. canRun() must return false while recording or live. */
    start(env) { env = env || {}; return tune(env).catch(() => null); },
    /** Called by the light meter every ~1.5 s with the measured face-area luma; keeps the software gain slowly tracking the light (brighten only). */
    feedLuma(l) { if (l == null || st.phase === 'testing') return; st.luma = Math.round(l); const g = gainFor(l); st.gain = +(st.gain + (g - st.gain) * 0.25).toFixed(3); if (Math.abs(st.gain - 1) < 0.02) st.gain = 1; },
    gain() { return st.gain; },
    holdsManual() { return st.mode === 'manual'; },
    testing() { return st.phase === 'testing'; },
    state() { return JSON.parse(JSON.stringify({ phase: st.phase, mode: st.mode, gain: st.gain, luma: st.luma, fpsBefore: st.fpsBefore, fpsAfter: st.fpsAfter, decision: st.decision, rows: st.rows })); },
    /** Put the camera back on automatic exposure and forget the result (used before Studio Check so its baseline is the true automatic camera). */
    async release(track) {
      for (let i = 0; i < 40 && st.phase === 'testing'; i++) await new Promise((r) => setTimeout(r, 500));   // let a running test finish (max 20 s)
      let caps = {}; try { caps = track && track.getCapabilities ? track.getCapabilities() : {}; } catch (e) { /* none */ }
      let err = null; if (track && track.applyConstraints && st.mode === 'manual') err = await restoreAuto(track, caps);
      st = Object.assign(fresh(), { token: st.token + 1 }); return err;
    },
    /** Forget everything (camera stopped or switched). The track is not touched: a stopped track needs no restore. */
    stop() { st = Object.assign(fresh(), { token: st.token + 1 }); },
    summary() { const s = st; if (s.phase === 'idle') return 'camera control: not run'; if (s.phase === 'testing') return 'camera control: testing...'; return 'camera control: ' + (s.note || 'done') + (s.gain > 1 ? ' | brighten x' + s.gain.toFixed(2) : ''); },
  };
  if (root) { root.VS = root.VS || {}; root.VS.CameraControl = api; }
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : null);
