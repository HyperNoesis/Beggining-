/**
 * Effects speed test (v0.15, M4 item 3). Measures live fps with the scene effects (life, parallax, bloom, reflection)
 * off and on, then picks the heaviest set that keeps the frame rate close to the no-effects baseline.
 * Pure decide() runs in Node tests. The runner needs the camera running in a scene (it asks for that in plain words).
 * Honest limit: fps is measured through the whole pipeline, so a camera that only delivers ~10 fps caps every step; we compare
 * RATIOS to the baseline, not absolute numbers.
 */
(function () {
  const STEPS = [
    { id: 'base',  label: 'no effects',   patch: { life: 0, parallax: 0, bloom: 0, reflection: 0, dof: 0 } },
    { id: 'life',  label: 'life',         patch: { life: 0.4, parallax: 0, bloom: 0, reflection: 0 } },
    { id: 'par',   label: 'parallax',     patch: { life: 0, parallax: 0.3, bloom: 0, reflection: 0 } },
    { id: 'bloom', label: 'bloom',        patch: { life: 0, parallax: 0, bloom: 0.4, reflection: 0 } },
    { id: 'dof',   label: 'depth of field', patch: { life: 0, parallax: 0.3, bloom: 0, reflection: 0, dof: 0.5 } },
    { id: 'refl',  label: 'reflection',   patch: { life: 0, parallax: 0, bloom: 0, reflection: 0.3 } },
    { id: 'all',   label: 'all effects',  patch: { life: 0.4, parallax: 0.3, bloom: 0.4, reflection: 0.3, dof: 0.5 } },
  ];
  const TIERS = {
    full:  { life: 0.4, parallax: 0.3, bloom: 0.4, reflection: 0.3, dof: 0.5 },
    light: { life: 0.2, parallax: 0.3, bloom: 0, reflection: 0, dof: 0 },
    off:   { life: 0, parallax: 0, bloom: 0, reflection: 0, dof: 0 },
  };
  const OK_RATIO = 0.85;   // an effect set is fine if it keeps at least 85% of baseline fps
  const MIN_FPS = 8;       // below this the baseline itself is too weak to judge

  const avg = (a) => a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0;
  const ratio = (r, base) => (base > 0 ? r / base : 0);

  /** results: {base,life,par,bloom,refl,all} each = mean fps (number) or null. Returns {tier, patch, why, ratios}. */
  function decide(results) {
    const base = results && results.base;
    if (!(base > 0)) return { tier: 'unknown', patch: null, why: 'No fps readings. Start the camera and try again.', ratios: {} };
    const ratios = {};
    STEPS.forEach((s) => { if (s.id !== 'base') ratios[s.id] = results[s.id] == null ? null : +ratio(results[s.id], base).toFixed(2); });
    if (base < MIN_FPS) return { tier: 'off', patch: TIERS.off, why: 'The no-effects frame rate is only ' + base.toFixed(1) + ' fps, so effects are switched off to protect it.', ratios };
    const ok = (id) => ratios[id] != null && ratios[id] >= OK_RATIO;
    if (ok('all')) return { tier: 'full', patch: TIERS.full, why: 'All effects together keep ' + Math.round(ratios.all * 100) + '% of the base speed.', ratios };
    // cheapest-first fallback: keep the individual effects that are fine; drop those that are not
    const keep = { life: 0, parallax: 0, bloom: 0, reflection: 0, dof: 0 };
    if (ok('dof') && ratios.dof >= 0.9) keep.dof = TIERS.full.dof;
    if (ok('par')) keep.parallax = TIERS.full.parallax;
    if (ok('life')) keep.life = TIERS.full.life;
    if (ok('bloom') && ratios.bloom >= 0.92) keep.bloom = TIERS.full.bloom;
    if (ok('refl') && ratios.refl >= 0.92) keep.reflection = TIERS.full.reflection;
    const any = keep.life || keep.parallax || keep.bloom || keep.reflection || keep.dof;
    return { tier: any ? 'light' : 'off', patch: keep, why: 'All effects together keep only ' + Math.round((ratios.all || 0) * 100) + '% of the base speed, so only the cheap ones stay on.', ratios };
  }

  function fmt(res) {
    if (!res) return null;
    return 'Effects speed test ' + res.when + ': ' + res.steps.map((s) => s.label + ' ' + (s.fps == null ? 'n/a' : s.fps.toFixed(1) + ' fps')).join(' | ') +
      ' | tier ' + res.tier + ' | ' + res.why;
  }

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  let busy = false;

  async function run(progress, opts) {
    opts = opts || {};
    const settle = opts.settleMs == null ? 1500 : opts.settleMs, measure = opts.measureMs == null ? 4000 : opts.measureMs;
    const say = (t) => { try { progress && progress(t); } catch (e) {} };
    if (busy) throw new Error('The speed test is already running.');
    const api = window.VS && window.VS.sceneApi, diag = window.VS && window.VS.diagState;
    if (!api || !diag) throw new Error('Open Studio and start the camera first.');
    const d0 = diag();
    if (d0.fps == null) throw new Error('Start the camera first, then run this test.');
    busy = true;
    const before = api.state();
    const wasOn = !!before.enabled;
    const restore = { life: before.life, parallax: before.parallax, bloom: before.bloom, reflection: before.reflection, dof: before.dof };
    try {
      if (!wasOn) api.enable(true);
      const steps = [];
      const out = {};
      for (let i = 0; i < STEPS.length; i++) {
        const s = STEPS[i];
        say('Testing ' + s.label + ' (' + (i + 1) + '/' + STEPS.length + '). Stay in frame.');
        api.patch(s.patch);
        await sleep(settle);
        const vals = [], t0 = performance.now();
        while (performance.now() - t0 < measure) { const f = diag().fps; if (f != null && f > 0) vals.push(f); await sleep(500); }
        const fps = vals.length ? avg(vals) : null;
        out[s.id] = fps; steps.push({ id: s.id, label: s.label, fps });
      }
      const dec = decide(out);
      if (dec.patch) api.patch(dec.patch); else api.patch(restore);
      if (!wasOn && dec.tier === 'off') api.enable(false);
      const res = { when: new Date().toISOString().slice(0, 19), steps, tier: dec.tier, why: dec.why, ratios: dec.ratios, patch: dec.patch };
      try { localStorage.setItem('vs_fx_speed', JSON.stringify(res)); } catch (e) {}
      window.__fxSpeed = res;
      say('Done: ' + dec.tier + '. ' + dec.why);
      return res;
    } catch (e) {
      try { api.patch(restore); if (!wasOn) api.enable(false); } catch (_) {}
      throw e;
    } finally { busy = false; }
  }

  function last() { if (window.__fxSpeed) return window.__fxSpeed; try { return JSON.parse(localStorage.getItem('vs_fx_speed') || 'null'); } catch (e) { return null; } }

  const api = { STEPS, TIERS, decide, run, last, fmt };
  if (typeof globalThis !== 'undefined') { globalThis.VS = globalThis.VS || {}; globalThis.VS.fxSpeed = api; }
})();
