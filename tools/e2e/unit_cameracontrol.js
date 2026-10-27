// Unit tests for js/camera-control.js with a fake camera track, fake video and fake clock (no browser, no real camera).
const CC = require('../../js/camera-control.js');
let pass = 0, fail = 0; const ok = (n, c, x) => { if (c) { pass++; console.log('PASS ' + n); } else { fail++; console.log('FAIL ' + n + ' ' + JSON.stringify(x)); } };

/** Fake camera. model(settingsApplied) -> { fps, luma }. Records every applyConstraints call. */
function rig(o) {
  o = o || {};
  const caps = o.caps || { frameRate: { min: 1, max: 30 }, exposureMode: ['continuous', 'manual'], exposureTime: { min: 10, max: 1000 }, iso: { min: 50, max: 3200 } };
  let cur = { exposureMode: 'continuous', exposureTime: 800, iso: 100, frameRate: 10 }, minFpsReq = false, t = 0, frames = 0, fps = o.baseFps == null ? 10 : o.baseFps, luma = o.baseLuma == null ? 80 : o.baseLuma;
  const applied = [];
  const recompute = () => { const m = o.model ? o.model({ cur, minFpsReq }) : { fps: o.baseFps == null ? 10 : o.baseFps, luma }; fps = m.fps; luma = m.luma; };
  const track = {
    getCapabilities: () => caps,
    getSettings: () => Object.assign({ width: 360, height: 480 }, cur, { frameRate: fps }),
    applyConstraints: async (c) => {
      applied.push(JSON.stringify(c));
      if (o.hang && JSON.stringify(c).includes(o.hang)) return new Promise(() => {});
      if (o.failOn && JSON.stringify(c).includes(o.failOn)) throw new Error('OverconstrainedError');
      const a = (c.advanced && c.advanced[0]) || {};
      if (a.exposureMode) cur.exposureMode = a.exposureMode; if (a.exposureTime != null) cur.exposureTime = a.exposureTime; if (a.iso != null) cur.iso = a.iso;
      if (c.frameRate && c.frameRate.min) minFpsReq = true; else if (c.frameRate) minFpsReq = false;
      recompute();
    },
  };
  recompute();
  const video = { videoWidth: 360, videoHeight: 480, getVideoPlaybackQuality: () => ({ totalVideoFrames: Math.round(frames) }) };
  const env = { track, video, sleep: async (ms) => { t += ms; frames += fps * ms / 1000; }, now: () => t, luma: () => luma };
  return { track, video, env, applied, cur: () => cur };
}
const last = (r) => JSON.parse(r.applied[r.applied.length - 1]);

(async () => {
  // 1 steady camera: nothing touched
  { CC.stop(); const r = rig({ baseFps: 30 }); const d = await CC.tune(r.env);
    ok('steady camera: nothing applied', r.applied.length === 0 && d.kept === null && /already steady/.test(d.reason), { d, a: r.applied }); }

  // 2 slow camera that speeds up with a manual 25-33 ms exposure but gets darker -> kept, brightening gain > 1
  { CC.stop(); const r = rig({ baseFps: 10, baseLuma: 90, model: (s) => (s.cur.exposureMode === 'manual' && s.cur.exposureTime <= 330 ? { fps: 28, luma: 62 } : { fps: 10, luma: 90 }) });
    const d = await CC.tune(r.env); const st = CC.state();
    ok('manual exposure kept when real fps rises', d.kept && /manual exposure/.test(d.kept) && d.fpsBefore === 10 && d.fpsAfter === 28, d);
    ok('manual exposure uses the 33 ms cap first and a limited ISO', r.applied.some((a) => /"exposureTime":330/.test(a) && /"iso":1600/.test(a)), r.applied);
    ok('camera really left on manual exposure', r.cur().exposureMode === 'manual' && CC.holdsManual() && st.mode === 'manual', st);
    ok('brightening gain compensates the darker picture (1 < gain <= max)', CC.gain() > 1.2 && CC.gain() <= CC.MAX_GAIN, CC.gain());
    ok('rows are recorded for the report', st.rows.length >= 2 && st.rows.every((x) => x.name), st.rows);
    ok('summary names the result', /kept/.test(CC.summary()) && /brighten/.test(CC.summary()), CC.summary()); }

  // 3 camera that ignores every control -> rejected, automatic exposure restored
  { CC.stop(); const r = rig({ baseFps: 10, baseLuma: 80 }); const d = await CC.tune(r.env);
    ok('no gain in fps: nothing kept', d.kept === null && /no setting raised/.test(d.reason), d);
    ok('automatic exposure restored at the end', last(r).advanced && last(r).advanced[0].exposureMode === 'continuous' && r.cur().exposureMode === 'continuous' && !CC.holdsManual(), { a: last(r), cur: r.cur() });
    ok('gain stays gentle after a rejected test', CC.gain() >= 1 && CC.gain() <= CC.MAX_GAIN, CC.gain()); }

  // 4 constraint errors never throw and never leave manual exposure
  { CC.stop(); const r = rig({ baseFps: 10, failOn: 'manual' }); let threw = false, d; try { d = await CC.tune(r.env); } catch (e) { threw = true; }
    ok('applyConstraints errors are caught', !threw && d && d.kept === null, d);
    ok('error rows are reported', CC.state().rows.some((x) => x.error), CC.state().rows);
    ok('camera not left manual after errors', r.cur().exposureMode === 'continuous', r.cur()); }

  // 5 faster but far too dark to rescue -> rejected
  { CC.stop(); const r = rig({ baseFps: 10, baseLuma: 60, model: (s) => (s.cur.exposureMode === 'manual' ? { fps: 28, luma: 12 } : { fps: 10, luma: 60 }) }); const d = await CC.tune(r.env);
    ok('too-dark result is rejected even if fps rose', d.kept === null && CC.state().rows.some((x) => /too dark/.test(x.why || '')), { d, rows: CC.state().rows });
    ok('too-dark: camera back on auto', r.cur().exposureMode === 'continuous', r.cur()); }

  // 6 camera without manual exposure: only the min-fps request is tried
  { CC.stop(); const r = rig({ baseFps: 10, caps: { frameRate: { min: 1, max: 30 }, exposureMode: ['continuous'] }, model: (s) => (s.minFpsReq ? { fps: 24, luma: 80 } : { fps: 10, luma: 80 }) }); const d = await CC.tune(r.env);
    ok('min-24-fps request kept when it helps', d.kept === 'min 24 fps request' && d.fpsAfter === 24, d);
    ok('no manual exposure attempted when not offered', !r.applied.some((a) => /manual/.test(a)), r.applied);
    ok('min-fps result does not claim manual exposure', !CC.holdsManual(), CC.state()); }

  // 7 camera offering nothing
  { CC.stop(); const r = rig({ baseFps: 10, caps: { frameRate: { min: 1, max: 15 }, exposureMode: ['continuous'] } }); const d = await CC.tune(r.env);
    ok('camera with no useful controls: nothing applied', r.applied.length === 0 && d.kept === null && /no frame-rate or exposure control/.test(d.reason), { d, a: r.applied }); }

  // 8 recording / live: untouched
  { CC.stop(); const r = rig({ baseFps: 10 }); const e = Object.assign({}, r.env, { canRun: () => false }); const d = await CC.tune(e);
    ok('while recording the camera is left alone', r.applied.length === 0 && /recording or live/.test(d.reason), { d, a: r.applied }); }

  // 9 a hanging applyConstraints times out and is handled (real 4 s timeout)
  { CC.stop(); const r = rig({ baseFps: 10, hang: 'manual' }); const t0 = Date.now(); const d = await CC.tune(r.env);
    ok('hanging applyConstraints does not hang the test', Date.now() - t0 < 20000 && d.kept === null, { ms: Date.now() - t0, d });
    ok('timeout reported as an error row', CC.state().rows.some((x) => /timed out/.test(x.error || '')), CC.state().rows); }

  // 10 stop() during a test supersedes it quietly
  { CC.stop(); const r = rig({ baseFps: 10, model: (s) => (s.cur.exposureMode === 'manual' ? { fps: 28, luma: 70 } : { fps: 10, luma: 80 }) });
    const p = CC.tune(r.env); CC.stop(); const d = await p; ok('stop() during a test: no throw, state idle', d && CC.state().phase === 'idle', { d, s: CC.state() }); }

  // 11 release() puts a manual camera back on auto
  { CC.stop(); const r = rig({ baseFps: 10, baseLuma: 90, model: (s) => (s.cur.exposureMode === 'manual' ? { fps: 28, luma: 70 } : { fps: 10, luma: 90 }) });
    await CC.tune(r.env); const was = CC.holdsManual(); await CC.release(r.track);
    ok('release(): manual exposure undone and state cleared', was && r.cur().exposureMode === 'continuous' && !CC.holdsManual() && CC.gain() === 1, { was, cur: r.cur() }); }

  // 12 gain maths
  ok('gainFor: bright enough -> 1', CC.gainFor(130) === 1 && CC.gainFor(null) === 1 && CC.gainFor(0) === 1);
  ok('gainFor: dim -> brightens, capped', CC.gainFor(70) > 1.5 && CC.gainFor(40) === CC.MAX_GAIN, [CC.gainFor(70), CC.gainFor(40)]);
  ok('tooDark only for very dark', CC.tooDark(15) === true && CC.tooDark(70) === false && CC.tooDark(null) === false);
  { CC.stop(); for (let i = 0; i < 30; i++) CC.feedLuma(60); const g1 = CC.gain(); for (let i = 0; i < 30; i++) CC.feedLuma(150);
    ok('feedLuma: gain follows the light slowly and returns to 1', g1 > 1.3 && CC.gain() === 1, { g1, g2: CC.gain() }); }
  { CC.stop(); const c = CC.buildCandidates({ frameRate: { max: 30 }, exposureMode: ['manual'], exposureTime: { min: 400, max: 500 }, iso: { min: 100, max: 800 } });
    ok('candidates clamp exposure time and ISO to what the camera offers', c.some((x) => x.exposureTime === 400) && c.every((x) => !x.manual || x.constraints.advanced[0].iso === 800), c); }

  console.log('\n' + pass + ' passed, ' + fail + ' failed'); process.exit(fail ? 1 : 0);
})();
