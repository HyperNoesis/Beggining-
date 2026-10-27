// Unit tests for js/studio-check.js with a fake camera track, fake video and fake model provider (no browser, no real camera).
const SC = require('../../js/studio-check.js');
let pass = 0, fail = 0; const ok = (n, c, x) => { if (c) { pass++; console.log('PASS ' + n); } else { fail++; console.log('FAIL ' + n + ' ' + JSON.stringify(x)); } };
function fakeCam(opts) {
  opts = opts || {}; let applied = []; let cur = { frameRate: 10, exposureMode: 'continuous', exposureTime: 800, iso: 100 }; let manual = false;
  const track = {
    getCapabilities: () => opts.noManual ? { frameRate: { min: 1, max: 30 }, exposureMode: ['continuous'] } : { frameRate: { min: 1, max: 30 }, exposureMode: ['continuous', 'manual'], exposureTime: { min: 10, max: 2000, step: 1 }, iso: { min: 50, max: 1600 }, exposureCompensation: { min: -2, max: 2 } },
    getSettings: () => Object.assign({ width: 360, height: 480 }, cur),
    applyConstraints: async (c) => {
      applied.push(JSON.stringify(c)); if (opts.failOn && JSON.stringify(c).includes(opts.failOn)) throw new Error('OverconstrainedError');
      const a = (c.advanced && c.advanced[0]) || {};
      if (a.exposureMode === 'manual') { manual = true; cur.exposureMode = 'manual'; cur.exposureTime = a.exposureTime; cur.iso = a.iso || cur.iso; cur.frameRate = a.exposureTime <= 300 ? 30 : 10; }
      else if (a.exposureMode === 'continuous') { manual = false; cur.exposureMode = 'continuous'; cur.frameRate = 10; }
      if (c.frameRate && c.frameRate.min) cur.frameRate = opts.minFpsHelps ? 24 : cur.frameRate;
    },
  };
  return { track, applied: () => applied, cur: () => cur };
}
function fakeEnv(cam) {
  let t = 0, frames = 0;
  const video = { videoWidth: 360, videoHeight: 480, getVideoPlaybackQuality: () => ({ totalVideoFrames: Math.floor(frames) }) };
  return { video, track: cam.track, now: () => t, sleep: async (ms) => { t += ms; frames += cam.cur().frameRate * ms / 1000; }, mkCanvas: () => ({ getContext: () => ({ drawImage() {}, getImageData: () => ({ data: new Uint8ClampedArray(32 * 32 * 4).fill(cam.cur().exposureMode === 'manual' ? 70 : 120) }) }) }), hasGpu: false };
}
(async () => {
  // 1 profile aggregation
  const agg = SC.aggregateProfile([{ kernelType: 'Conv', startTime: 0, endTime: 60 }, { kernelType: 'Conv', startTime: 60, endTime: 100 }, { kernelType: 'Add', startTime: 0, endTime: 40 }, { kernelType: 'Bad', startTime: 5, endTime: 1 }], 2);
  ok('profile share sums by op, ignores negative durations', agg.rows[0].op === 'Conv' && agg.rows[0].sharePct === 71.4 && agg.rows[1].op === 'Add' && agg.totalKernels === 4, agg);
  // 2 camera experiments: manual exposure raises fps, settings restored
  const cam = fakeCam({}); const env = fakeEnv(cam); const msgs = [];
  const r = await SC.cameraExperiments(env, (m) => msgs.push(m));
  ok('baseline measured (10 fps)', r.baseline && r.baseline.fps === 10, r.baseline);
  const man = r.experiments.find((e) => /manual exposure 30/.test(e.name));
  ok('manual 30 ms exposure test ran and reports 30 fps + lower brightness', man && man.fps === 30 && man.luma < r.baseline.luma, man);
  ok('exposureTime unit sent as 300 (=30 ms in 100us units)', cam.applied().some((a) => a.includes('"exposureTime":300')), cam.applied());
  ok('camera restored to automatic exposure', r.restored === true && cam.cur().exposureMode === 'continuous', { r: r.restored, cur: cam.cur() });
  // 3 camera without manual exposure: reports not offered, still restores
  const cam2 = fakeCam({ noManual: true }); const r2 = await SC.cameraExperiments(fakeEnv(cam2), () => {});
  ok('no manual exposure -> clearly reported, no crash', r2.experiments.some((e) => /not offered/.test(e.error || '')) && r2.restored === true, r2.experiments);
  // 4 a rejected constraint is recorded as an error and later tests continue
  const cam3 = fakeCam({ failOn: 'min' }); const r3 = await SC.cameraExperiments(fakeEnv(cam3), () => {});
  ok('rejected constraint recorded, other tests still run', r3.experiments[0].error && r3.experiments.length >= 3 && r3.restored === true, r3.experiments.map((e) => e.name + ':' + (e.error || e.fps)));
  // 5 full run: refuses while recording; refuses with no video
  let threw = ''; try { await SC.run(Object.assign(fakeEnv(fakeCam({})), { isRecording: () => true })); } catch (e) { threw = e.message; }
  ok('refuses to run while recording', /Stop recording/.test(threw), threw);
  threw = ''; try { await SC.run({ video: { videoWidth: 0 } }); } catch (e) { threw = e.message; }
  ok('refuses with no camera picture', /Start the camera/.test(threw), threw);
  // 6 model matrix with a fake provider: errors in one config do not stop the others; providers disposed
  let disposed = 0, made = 0; const mk = () => { made++; return { longEdge: 0, usingWebGPU: false, initialize: async (q, o) => { if (o.ep === 'wasm' && made === 99) throw new Error('x'); this.o = o; }, segment: async () => { }, profileGet: async () => [], dispose: () => { disposed++; } }; };
  const e6 = Object.assign(fakeEnv(fakeCam({})), { makeProvider: mk, sizeFor: (w, h, e) => [Math.round(w * e / 480 / 32) * 32 || 32, e], hasGpu: true });
  const s = await SC.run(e6);
  ok('model matrix ran 5 configs with GPU and disposed each provider', s.model.length === 5 && disposed === 5 && made === 5, { n: s.model.length, disposed, made });
  ok('summary has camera, model, recommendations, seconds', !!s.camera && Array.isArray(s.recommendations) && typeof s.seconds === 'number', Object.keys(s));
  ok('recommendation mentions the faster camera setting', s.recommendations.some((x) => /Camera: "manual exposure/.test(x)), s.recommendations);
  ok('format prints MEASURED/INFERRED sections', /STUDIO CHECK/.test(SC.format(s)) && /INFERRED:/.test(SC.format(s)) && /CAMERA TEST/.test(SC.format(s)), SC.format(s).slice(0, 200));
  // 7 provider that throws on init is contained
  const e7 = Object.assign(fakeEnv(fakeCam({})), { makeProvider: () => ({ initialize: async () => { throw new Error('boom'); }, dispose() {} }), sizeFor: () => [320, 320], hasGpu: false });
  const s7 = await SC.run(e7);
  ok('model init failure is recorded, check still completes', s7.model[0].error === 'boom' && s7.camera.restored === true, s7.model[0]);
  console.log(pass + ' PASS, ' + fail + ' FAIL'); process.exit(fail ? 1 : 0);
})();
