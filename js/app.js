(async function () {
  const ic = window.VS.icon;

  // A model load (RVM's ONNX weights + onnxruntime-web, or MediaPipe's Tasks
  // Vision WASM/model) is a network fetch with no built-in timeout. On a
  // slow/unstable connection that fetch can stall indefinitely — the caller
  // just never hears back, so "Loading local segmentation model..." sits
  // there forever with no error and no way out. This races the real promise
  // against a timer so a stalled load fails fast (and honestly) instead of
  // hanging, letting the caller fall back to a lighter model or show a real
  // error rather than a frozen screen.
  function withTimeout(promise, ms, message) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(message)), ms);
      promise.then(
        (v) => { clearTimeout(timer); resolve(v); },
        (e) => { clearTimeout(timer); reject(e); }
      );
    });
  }
  const MODEL_LOAD_TIMEOUT_MS = 15000;
  // ---- Model choice + one-time device speed test ----
  const MODNET_LOAD_TIMEOUT_MS = 45000;   // the model is bundled now; this only matters for the web version's first load
  const MODNET_MAX_MS = 70;               // slower than this per mask -> use the lighter model
  const MODEL_PREF_KEY = 'vs_model_pref';
  const BENCH_KEY = 'vs_model_bench';
  function deviceKey() { return (navigator.userAgent || '') + '|' + (navigator.gpu ? 'gpu' : 'nogpu'); }
  function readBench() {
    try {
      const b = JSON.parse(localStorage.getItem(BENCH_KEY) || 'null');
      return b && b.v === 2 && b.key === deviceKey() ? b : null;   // v2 = speed ladder; older single-size results are ignored
    } catch (e) { return null; }
  }
  function writeBench(b) { try { localStorage.setItem(BENCH_KEY, JSON.stringify(Object.assign({ v: 2, key: deviceKey(), at: Date.now() }, b))); } catch (e) {} }
  function showBenchNote(text) { if (els.modelBenchNote) els.modelBenchNote.textContent = text; }
  // ---- Preload: load + warm the segmentation engine while the page is idle, so Start feels instant ----
  let warm = null;
  function preloadProvider() {
    const V = window.VS;
    const pref = (els.modelSelect && els.modelSelect.value) || 'auto';
    if (!V.MediaPipeSegmentationProvider || pref === 'rvm' || pref === 'modnet' || warm) return;
    const p = new V.MediaPipeSegmentationProvider();
    p.lowLightBoost = true;
    warm = { provider: p, promise: p.initialize('balanced').then(() => true).catch((e) => { console.warn('Genesis: preload failed, will retry on Start.', e); return false; }) };
  }
  /** High-quality matting in a background worker when allowed (page never freezes); in-page provider otherwise. */
  function makeModnet() {
    const V = window.VS;
    return (V.MODNetWorkerProvider && V.MODNetWorkerProvider.isSupported()) ? new V.MODNetWorkerProvider() : new V.MODNetSegmentationProvider();
  }
  let upgrading = false;
  /** Load MODNet while the camera is already live; swap it in only if this device runs it fast enough. */
  async function backgroundUpgrade(quality, sessionToken) {
    if (upgrading) return;
    upgrading = true;
    let cand = null;
    try {
      showBenchNote('Live now on the light model. Loading the high-quality model in the background...');
      cand = makeModnet();
      cand.lowLightBoost = lowLightBoostEnabled;
      cand.onProgress = (p) => showBenchNote('Loading high-quality model: ' + Math.round(p * 100) + '%');
      await cand.initialize(quality);
      if (!running || sessionToken !== loopToken) { cand.dispose?.(); return; }
      showBenchNote('Testing speed on this device...');
      let ms = await timeProvider(cand, 5, 1, 500);
      // Speed ladder: too slow at this size? Run the SAME high-quality model on a smaller picture (320, then 256 px long edge) before
      // giving up. The full-resolution camera frame still guides the edge in gl-matte.js, so a smaller MODNet mask is far clearer than
      // the light model's blocky one.
      let usedEdge = cand.longEdge;
      for (const e of [320, 256]) {
        if (ms <= MODNET_MAX_MS || e >= usedEdge) continue;
        if (!running || sessionToken !== loopToken) { cand.dispose?.(); return; }
        showBenchNote('Too slow at full size (' + Math.round(ms) + ' ms). Trying a lighter MODNet size (' + e + ' px)...');
        cand.longEdge = e; usedEdge = e;
        ms = await timeProvider(cand, 4, 1, 500);
      }
      writeBench({ modnetMs: Math.round(ms), edge: usedEdge });
      if (!running || sessionToken !== loopToken) { cand.dispose?.(); return; }
      if (ms <= MODNET_MAX_MS) {
        const old = segProvider;
        segProvider = cand; cand = null;
        resetSegCache();
        rendererSend({ type: 'setMatte', state: {} });
        updateStudioChrome();
        updateCostInfo();
        setTimeout(() => { try { old.dispose?.(); } catch (e) {} }, 1000);
        showBenchNote('High-quality matting is active (MODNet, ' + usedEdge + ' px, ' + Math.round(ms) + ' ms per mask).');
      } else {
        showBenchNote('Staying on the light model: even the smallest MODNet size needs ' + Math.round(ms) + ' ms per mask here.');
        cand.dispose?.();
      }
    } catch (e) {
      showBenchNote('High-quality model unavailable (' + (e && e.message ? e.message : e) + '). Staying on the light model.');
      try { cand && cand.dispose && cand.dispose(); } catch (e2) {}
    } finally {
      upgrading = false;
    }
  }
  /** Median per-frame time (ms) of a provider on the live camera, after a short warm-up. */
  async function timeProvider(provider, frames = 10, warmup = 3, abortAboveMs = 0) {
    const times = [];
    for (let i = 0; i < warmup + frames; i++) {
      const t0 = performance.now();
      await provider.segment(els.video);
      const dt = performance.now() - t0;
      if (i >= warmup) times.push(dt);
      // Never freeze the UI: let taps/paint run between frames, and stop early when the device is clearly far too slow.
      await new Promise((r) => setTimeout(r, 30));
      if (abortAboveMs && dt > abortAboveMs && i >= 1) { times.push(dt); break; }
    }
    times.sort((x, y) => x - y);
    return times[Math.floor(times.length / 2)];
  }


  const els = {
    video: document.getElementById('video'),
    canvas: document.getElementById('canvas'),
    envSelect: document.getElementById('envSelect'),
    envMiniGrid: document.getElementById('envMiniGrid'),
    uploadBg: document.getElementById('uploadBg'),
    uploadCardTrigger: document.getElementById('uploadCardTrigger'),
    genPrompt: document.getElementById('genPrompt'),
    genBtn: document.getElementById('genBtn'),
    qualitySelect: document.getElementById('qualitySelect'),
    qualitySegControl: document.getElementById('qualitySegControl'),
    deviceTierNote: document.getElementById('deviceTierNote'),
    startBtn: document.getElementById('startBtn'),
    previewEnvLink: document.getElementById('previewEnvLink'),
    stopBtn: document.getElementById('stopBtn'),
    cameraSelect: document.getElementById('cameraSelect'),
    micSelect: document.getElementById('micSelect'),
    focusModeBtn: document.getElementById('focusModeBtn'),
    recordBtn: document.getElementById('recordBtn'),
    recText: document.getElementById('recText'),
    recTime: document.getElementById('recTime'),
    recordingsList: document.getElementById('recordingsList'),
    statsEl: document.getElementById('stats'),
    degradeBanner: document.getElementById('degradeBanner'),
    previewFrame: document.getElementById('previewFrame'),
    batterySaverToggle: document.getElementById('batterySaverToggle'),
    costEl: document.getElementById('costInfo'),
    previewOverlay: document.getElementById('previewOverlay'),
    overlayTitle: document.getElementById('overlayTitle'),
    overlaySub: document.getElementById('overlaySub'),
    recIndicator: document.getElementById('recIndicator'),
    recIndicatorTime: document.getElementById('recIndicatorTime'),
    camPill: document.getElementById('camPill'),
    micPill: document.getElementById('micPill'),
    flipCamBtn: document.getElementById('flipCamBtn'),
    toolRail: document.getElementById('toolRail'),
    studioShell: document.getElementById('studioShell'),
    studioBody: document.getElementById('studioBody'),
    guideCanvas: document.getElementById('guideCanvas'),
    brushCanvas: document.getElementById('brushCanvas'),
    aspectSegControl: document.getElementById('aspectSegControl'),
    zoomRange: document.getElementById('zoomRange'),
    zoomVal: document.getElementById('zoomVal'),
    panXRange: document.getElementById('panXRange'),
    panYRange: document.getElementById('panYRange'),
    resetPanBtn: document.getElementById('resetPanBtn'),
    guidesToggle: document.getElementById('guidesToggle'),
    realismToggle: document.getElementById('realismToggle'),
    realismIntensity: document.getElementById('realismIntensity'),
    realismIntensityVal: document.getElementById('realismIntensityVal'),
    toneMatchToggle: document.getElementById('toneMatchToggle'),
    shadowToggle: document.getElementById('shadowToggle'),
    lightWrapToggle: document.getElementById('lightWrapToggle'),
    grainToggle: document.getElementById('grainToggle'),
    abPreviewToggle: document.getElementById('abPreviewToggle'),
    featherRange: document.getElementById('featherRange'),
    featherVal: document.getElementById('featherVal'),
    sharpMatteToggle: document.getElementById('sharpMatteToggle'),
    autoStartToggle: document.getElementById('autoStartToggle'),
    sceneToggle: document.getElementById('sceneToggle'),
    sceneControls: document.getElementById('sceneControls'),
    sceneDeskOn: document.getElementById('sceneDeskOn'),
    sceneDeskY: document.getElementById('sceneDeskY'),
    sceneDeskYVal: document.getElementById('sceneDeskYVal'),
    sceneTilt: document.getElementById('sceneTilt'),
    sceneTiltVal: document.getElementById('sceneTiltVal'),
    sceneBow: document.getElementById('sceneBow'),
    sceneBowVal: document.getElementById('sceneBowVal'),
    sceneFeather: document.getElementById('sceneFeather'),
    sceneFeatherVal: document.getElementById('sceneFeatherVal'),
    sceneScale: document.getElementById('sceneScale'),
    sceneScaleVal: document.getElementById('sceneScaleVal'),
    sceneX: document.getElementById('sceneX'),
    sceneXVal: document.getElementById('sceneXVal'),
    sceneY: document.getElementById('sceneY'),
    sceneYVal: document.getElementById('sceneYVal'),
    sceneLight: document.getElementById('sceneLight'),
    sceneLightVal: document.getElementById('sceneLightVal'),
    sceneLightSide: document.getElementById('sceneLightSide'),
    sceneShadow: document.getElementById('sceneShadow'),
    sceneShadowVal: document.getElementById('sceneShadowVal'),
    sceneSoft: document.getElementById('sceneSoft'),
    sceneSoftVal: document.getElementById('sceneSoftVal'),
    sceneAutoBtn: document.getElementById('sceneAutoBtn'),
    sceneCopyPromptBtn: document.getElementById('sceneCopyPromptBtn'),
    sceneStatus: document.getElementById('sceneStatus'),
    genSceneMode: document.getElementById('genSceneMode'),
    modelSelect: document.getElementById('modelSelect'),
    modelBenchNote: document.getElementById('modelBenchNote'),
    rebenchBtn: document.getElementById('rebenchBtn'),
    sharpQuality: document.getElementById('sharpQuality'),
    crispRange: document.getElementById('crispRange'),
    crispVal: document.getElementById('crispVal'),
    despillRange: document.getElementById('despillRange'),
    despillVal: document.getElementById('despillVal'),
    capturePlateBtn: document.getElementById('capturePlateBtn'),
    clearPlateBtn: document.getElementById('clearPlateBtn'),
    matteStatus: document.getElementById('matteStatus'),
    despeckleRange: document.getElementById('despeckleRange'),
    despeckleVal: document.getElementById('despeckleVal'),
    smoothingRange: document.getElementById('smoothingRange'),
    smoothingVal: document.getElementById('smoothingVal'),
    lowLightBoostToggle: document.getElementById('lowLightBoostToggle'),
    correctionToggle: document.getElementById('correctionToggle'),
    brushModeControl: document.getElementById('brushModeControl'),
    brushSizeRange: document.getElementById('brushSizeRange'),
    brushSizeVal: document.getElementById('brushSizeVal'),
    clearCorrectionsBtn: document.getElementById('clearCorrectionsBtn'),
    captionsToggle: document.getElementById('captionsToggle'),
    captionsUnsupported: document.getElementById('captionsUnsupported'),
    captionsList: document.getElementById('captionsList'),
    captionBar: document.getElementById('captionBar'),
    brandColorInput: document.getElementById('brandColorInput'),
    logoUploadTrigger: document.getElementById('logoUploadTrigger'),
    logoUpload: document.getElementById('logoUpload'),
    logoFileLabel: document.getElementById('logoFileLabel'),
    watermarkToggle: document.getElementById('watermarkToggle'),
    contentUploadTrigger: document.getElementById('contentUploadTrigger'),
    contentUpload: document.getElementById('contentUpload'),
    contentUploadLabel: document.getElementById('contentUploadLabel'),
    contentUploadPdfTrigger: document.getElementById('contentUploadPdfTrigger'),
    contentUploadPdf: document.getElementById('contentUploadPdf'),
    contentUploadScreenTrigger: document.getElementById('contentUploadScreenTrigger'),
    overlayList: document.getElementById('overlayList'),
    layoutModeSelect: document.getElementById('layoutModeSelect'),
    pipPresetList: document.getElementById('pipPresetList'),
    directorAddCue: document.getElementById('directorAddCue'),
    directorPosition: document.getElementById('directorPosition'),
    directorCueList: document.getElementById('directorCueList'),
    directorBack: document.getElementById('directorBack'),
    directorNext: document.getElementById('directorNext'),
    annotateCanvas: document.getElementById('annotateCanvas'),
    annotateToggle: document.getElementById('annotateToggle'),
    annotateModeControl: document.getElementById('annotateModeControl'),
    annotateColorControl: document.getElementById('annotateColorControl'),
    annotateClearBtn: document.getElementById('annotateClearBtn'),
    templateNameInput: document.getElementById('templateNameInput'),
    saveTemplateBtn: document.getElementById('saveTemplateBtn'),
    templateList: document.getElementById('templateList'),
    bitrateSelect: document.getElementById('bitrateSelect'),
    framerateSelect: document.getElementById('framerateSelect'),
    draftRecoveryBanner: document.getElementById('draftRecoveryBanner'),
    whipEndpointInput: document.getElementById('whipEndpointInput'),
    whipTokenInput: document.getElementById('whipTokenInput'),
    saveWhipBtn: document.getElementById('saveWhipBtn'),
    whipSaveMsg: document.getElementById('whipSaveMsg'),
    whipSchemeError: document.getElementById('whipSchemeError'),
    goLiveBtn: document.getElementById('goLiveBtn'),
    liveStatus: document.getElementById('liveStatus'),
    liveStatusText: document.getElementById('liveStatusText'),
    liveQualityNote: document.getElementById('liveQualityNote'),
    liveTime: document.getElementById('liveTime'),
    rtmpPlatformSelect: document.getElementById('rtmpPlatformSelect'),
    rtmpYoutubeKeyField: document.getElementById('rtmpYoutubeKeyField'),
    rtmpYoutubeKeyInput: document.getElementById('rtmpYoutubeKeyInput'),
    rtmpTwitchKeyField: document.getElementById('rtmpTwitchKeyField'),
    rtmpTwitchKeyInput: document.getElementById('rtmpTwitchKeyInput'),
    rtmpCustomUrlField: document.getElementById('rtmpCustomUrlField'),
    rtmpCustomUrlInput: document.getElementById('rtmpCustomUrlInput'),
    generateRtmpConfigBtn: document.getElementById('generateRtmpConfigBtn'),
    rtmpConfigOutputWrap: document.getElementById('rtmpConfigOutputWrap'),
    rtmpConfigOutput: document.getElementById('rtmpConfigOutput'),
    copyRtmpConfigBtn: document.getElementById('copyRtmpConfigBtn'),
    rtmpConfigCopyMsg: document.getElementById('rtmpConfigCopyMsg'),
    wizardKeyLabel: document.getElementById('wizardKeyLabel'),
    wizardStreamKey: document.getElementById('wizardStreamKey'),
    wizardGenerateBtn: document.getElementById('wizardGenerateBtn'),
    wizardConfigWrap: document.getElementById('wizardConfigWrap'),
    wizardConfigOutput: document.getElementById('wizardConfigOutput'),
    wizardCopyBtn: document.getElementById('wizardCopyBtn'),
    wizardCopyMsg: document.getElementById('wizardCopyMsg'),
    wizardToStep3FromRelay: document.getElementById('wizardToStep3FromRelay'),
    sessionLabel: document.getElementById('sessionLabel'),
    saveState: document.getElementById('saveState'),
    quickRecordBtn: document.getElementById('quickRecordBtn'),
    quickLiveBtn: document.getElementById('quickLiveBtn'),
    transportLiveBtn: document.getElementById('transportLiveBtn'),
    transportStatus: document.getElementById('transportStatus'),
    previewModeLabel: document.getElementById('previewModeLabel'),
    qualityHud: document.getElementById('qualityHud'),
    renderHud: document.getElementById('renderHud'),
    previewHint: document.getElementById('previewHint'),
  };

  // ============================================================
  // Render worker — everything downstream of segmentation (mask
  // refinement, realism engine, compositing, A/B preview) runs off the
  // main thread on an OffscreenCanvas transferred from els.canvas. The
  // element itself keeps working normally for layout AND for
  // captureStream() during recording — transferControlToOffscreen() is
  // designed for exactly this "worker renders, main thread still records
  // the same element" pattern. Segmentation itself cannot move here — see
  // the honesty note at the top of render-worker.js for why.
  // ============================================================
  let renderWorker = null;
  let workerReady = false;
  // Main-thread compatibility fallback (Settings → Preview rendering →
  // Compatibility mode, or auto-selected when Worker/OffscreenCanvas aren't
  // available). render-core.js is the exact same pipeline either way; this
  // mode just calls it directly on the main thread instead of via a Worker.
  let localCore = null;
  const rendererMode = localStorage.getItem('vs_renderer_mode') || 'auto';
  let pendingFrameResolve = null;
  let pendingFrameToken = -1;
  let frameToken = 0;
  // Live screen-share overlays — id -> { videoEl, stream }. Populated by the
  // Content panel's "Share your screen" button below; captured into the
  // same overlay pipeline as static slides every frame in processLoop.
  const liveOverlays = new Map();
  let renderHealthy = true; // flips false on a worker crash — see 'fatal' handler below

  // Shared by both the Worker's onmessage AND the main-thread localCore's
  // notify callback, so 'frameDone'/'error'/'fatal' behave identically
  // regardless of which path is actually rendering.
  function handleRendererMessage(data) {
    if (data.type === 'frameDone' && data.seatAlign) seatAlign = data.seatAlign;
    if (data.type === 'frameDone') { seatPose = data.seatPose || null; seatLight = data.seatLight || 'ok'; }
    if (data.type === 'frameDone' && window.__vsT && !window.__vsT.firstFrame) window.__vsT.firstFrame = performance.now();
    if (data.type === 'frameDone' || data.type === 'error') {
      if (data.type === 'error') console.warn('Render pipeline error:', data.message);
      // Only resolve if this reply matches the frame we're actually still
      // waiting on — a reply for a frame the watchdog already timed out
      // on must be ignored, or it would incorrectly resolve the NEXT
      // frame's promise early and desync the token bookkeeping.
      if (pendingFrameResolve && data.token === pendingFrameToken) {
        pendingFrameResolve();
        pendingFrameResolve = null;
      }
    } else if (data.type === 'personBox') {
      if (window.VS.Grade && window.VS.Grade.onBox) window.VS.Grade.onBox(data.box);
    } else if (data.type === 'gradeStatus') {
      if (window.VS.Grade && window.VS.Grade.onStatus) window.VS.Grade.onStatus(data.error);
    } else if (data.type === 'matteStatus') {
      if (els.matteStatus) {
        els.matteStatus.textContent = data.ok
          ? 'GPU sharp edges: active'
          : 'GPU sharp edges unavailable on this device' + (data.error ? ' (' + data.error + ')' : '') + ' — using the standard edge path.';
      }
    } else if (data.type === 'fatal') {
      // The render pipeline's global scope crashed outside any try/catch —
      // e.g. an OffscreenCanvas API throwing synchronously. Honest limit:
      // this can't be recreated once the <canvas> has handed its control to
      // a Worker via transferControlToOffscreen(), a one-time, non-reversible
      // handoff (in local-core mode this can't happen at all — dispatch()
      // has its own try/catch — but the handler stays generic on purpose).
      renderHealthy = false;
      console.error('Render pipeline crashed fatally:', data.message);
      window.VS.reportError('The render pipeline crashed and can\u2019t self-recover (reload the page to restart it)');
      if (liveActive) setLiveStatus('error', 'Render pipeline crashed — output is frozen. Reload and go live again.');
      perfBannerShown = false; perfBannerKey = '';
      els.degradeBanner.classList.add('show');
      els.degradeBanner.textContent = 'The render pipeline crashed. Reload the page — this can\u2019t recover on its own.';
      if (pendingFrameResolve) { pendingFrameResolve(); pendingFrameResolve = null; }
    }
  }

  if (rendererMode !== 'compat' && els.canvas.transferControlToOffscreen && typeof Worker !== 'undefined' && typeof createImageBitmap !== 'undefined') {
    const offscreen = els.canvas.transferControlToOffscreen();
    renderWorker = new Worker('js/render-worker.js');
    renderWorker.postMessage({ type: 'init', canvas: offscreen, assetsBase: window.location.href }, [offscreen]);
    workerReady = true;
    renderWorker.onmessage = (e) => handleRendererMessage(e.data);
    renderWorker.onerror = (e) => {
      // Belt-and-suspenders: some crash modes (e.g. a syntax error surfacing
      // late, or a browser that doesn't deliver self.onerror cleanly to
      // postMessage) show up here instead of as a 'fatal' message.
      handleRendererMessage({ type: 'fatal', message: e.message || String(e) });
      e.preventDefault();
    };
  } else {
    // No postMessage round trip here — dispatch() runs and calls back into
    // handleRendererMessage synchronously, in the same tick.
    localCore = window.VS.createRenderCore(handleRendererMessage);
    localCore.dispatch({ type: 'init', canvas: els.canvas, assetsBase: window.location.href });
  }
  // Every place that used to talk to renderWorker.postMessage(...) directly
  // now goes through here, so the exact same call sites work for both the
  // Worker path and the main-thread localCore fallback.
  function rendererSend(msg, transferList) {
    if (renderWorker) renderWorker.postMessage(msg, transferList);
    else if (localCore) localCore.dispatch(msg);
  }
  window.VS = window.VS || {};
  window.VS.rendererSend = rendererSend; // used by js/graphics.js
  window.VS.frameApi = { engine: () => compositionEngine, native: () => [videoNativeW, videoNativeH], syncUi: () => { try { els.zoomRange.value = compositionEngine.zoom; els.zoomVal.textContent = compositionEngine.zoom.toFixed(1) + 'x'; els.panXRange.value = compositionEngine.panX; els.panYRange.value = compositionEngine.panY; } catch (e) {} } };
  // HARDENING: a frame that never comes back (worker wedged on something
  // MediaPipe/canvas-internal, without throwing) used to hang this promise,
  // and therefore the entire requestAnimationFrame loop, forever — a silent
  // freeze with no on-screen sign anything was wrong. This still can't fix
  // whatever caused the stall, but it guarantees the loop always gets
  // control back so the app stays visibly alive instead of frozen.
  const FRAME_TIMEOUT_MS = 2000;
  let consecutiveStalls = 0;
  function frameDonePromise(token) {
    pendingFrameToken = token;
    return new Promise((resolve) => {
      pendingFrameResolve = resolve;
      setTimeout(() => {
        // If this exact token is still pending when the timer fires, the
        // worker never answered in time — give the loop its turn back.
        if (pendingFrameToken === token && pendingFrameResolve) {
          pendingFrameResolve = null;
          resolve('timeout');
        }
      }, FRAME_TIMEOUT_MS);
    });
  }

  // Plain state mirrors for the realism/mask panels — the real engine
  // instances that used to live here now live in the worker; the UI reads
  // and writes these, and pushRealism()/pushMask() forward changes over.
  const realismState = { enabled: true, toneMatch: true, shadow: true, lightWrap: true, grain: true, intensity: 0.7, abPreview: false };
  const maskState = { featherPx: 2, correctionEnabled: false, brushMode: 'add', brushSize: 24, temporalSmoothing: 0.55, despeckle: 1 };
  let lowLightBoostEnabled = true; // persists across stop/start, same idea as maskState above
  function pushRealism() { if (renderWorker || localCore) rendererSend({ type: 'setRealism', state: { ...realismState } }); }
  function pushMask() { if (renderWorker || localCore) rendererSend({ type: 'setMask', state: { ...maskState } }); }
  els.realismToggle.checked = realismState.enabled; // keep the checkbox in sync with the new on-by-default state above
  pushRealism();
  pushMask();

  // Sharp GPU matte (see js/providers/gl-matte.js). Falls back to the legacy
  // canvas edge path automatically if WebGL2 is unavailable.
  const matteState = { mode: 'gl', radius: 1, crisp: 0.5, despill: 0.6 };
  function pushMatte() {
    if (!(renderWorker || localCore)) return;
    const c = matteState.crisp;
    rendererSend({ type: 'setMatte', state: {
      mode: matteState.mode,
      radius: matteState.radius,
      edgeLo: 0.15 + 0.30 * c,
      edgeHi: 0.85 - 0.30 * c,
      despill: matteState.despill,
    } });
  }
  pushMatte();
  rendererSend({ type: 'matteQuery' });

  const envProvider = new window.VS.StaticEnvironmentProvider();
  let segProvider = null;

  const compositionEngine = new window.VS.CompositionEngine();
  const captionsProvider = new window.VS.CaptionsProvider();
  if (!window.VS.CaptionsProvider.supported) {
    els.captionsToggle.disabled = true;
    els.captionsUnsupported.style.display = 'block';
  }

  const guideCtx = els.guideCanvas.getContext('2d');
  let videoNativeW = 0, videoNativeH = 0;
  let outW = 0, outH = 0;

  // Pushes the currently-selected environment to the worker. Built-ins are
  // fetched by the worker itself; custom/generated ones are decoded here
  // (main thread is the only place with access to the uploaded <img> /
  // localStorage-persisted data) and sent over once per id.
  const sentCustomEnvIds = new Set();
  async function pushEnvironment(id) {
    if (!(renderWorker || localCore) || !id) return;
    if (envProvider.customImages.has(id) && !sentCustomEnvIds.has(id)) {
      try {
        const bitmap = await createImageBitmap(envProvider.customImages.get(id));
        rendererSend({ type: 'customEnvironmentBitmap', id, bitmap }, [bitmap]);
        sentCustomEnvIds.add(id);
      } catch (e) { /* worker shows a neutral fallback until this succeeds */ }
    }
    rendererSend({ type: 'selectEnvironment', id });
    if (typeof onSceneEnvironmentChanged === 'function') onSceneEnvironmentChanged(id);
  }

  let stream = null;
  let running = false;
  let recorder = null;
  let recordedChunks = [];
  let liveActive = false;
  let liveStream = null; // captureStream() used for WHIP publish — separate from the recording one
  let liveStartTime = 0;
  let liveTimerInterval = null;
  const streamProvider = new window.VS.WHIPStreamProvider();
  let frameCount = 0;
  let lastFpsTime = performance.now();
  let recentFps = 60;
  let consecutiveLowFps = 0;

  // ---- FAST mode runtime state (rules live in js/providers/perf-profile.js) ----
  let runningQuality = 'balanced'; // the mode the camera is ACTUALLY running in (the <select> is locked while running)
  let segStride = 1;               // mask refresh rate: 1 = every frame; 2 = every other frame (FAST-only fallback)
  let strideTick = 0;
  let prevRender = null; // v0.46: promise of the render currently in flight
  let cachedMaskBitmap = null;     // last full-size mask, reused on skipped frames (only populated when segStride > 1)
  let segMsEma = 0;                // smoothed wall-clock cost of one segmentation call, ms
  let loopToken = 0;               // bumped on every start/stop: a superseded processLoop iteration exits instead of racing the new loop
  let perfBannerShown = false;     // true only while the degrade banner is showing a PERFORMANCE message (not camera-lost / crash)
  let perfBannerKey = '';
  let perfBannerHoldUntil = 0;
  let perfBannerDismissedUntil = 0;
  let switchingMode = false;
  let autoPickedFast = false;      // true when FAST was preselected because the device looked low-powered (see below)
  let recordStartTime = null;
  let recordTimerInterval = null;
  let currentFacingMode = 'user'; // mobile default: front camera. Ignored once a specific device is picked from the dropdown.

  const QUALITY_PRESETS = {
    fast: { width: 480, height: 360 },
    balanced: { width: 640, height: 480 },
    quality: { width: 960, height: 720 },
    ultra: { width: 1280, height: 720 } // disabled — requires GPUCloudSegmentationProvider
  };

  const QUALITY_META = [
    { id: 'fast', label: 'FAST', sub: 'Low processing load' },
    { id: 'balanced', label: 'BALANCED', sub: 'Recommended' },
    { id: 'quality', label: 'QUALITY', sub: 'Maximum local quality' },
    { id: 'ultra', label: 'ULTRA', sub: 'Cloud GPU — coming soon', disabled: true },
  ];

  // ---- gate the page on auth, same contract as every other screen ----
  const currentUser = await window.VS.renderNav('studio');
  if (!currentUser) return;

  // "Never set" and Settings' explicit "Automatic" both mean the user hasn't
  // chosen — only then does the device get a say. An explicit pick always wins.
  const defaultQuality = localStorage.getItem('vs_default_quality');
  const hasExplicitDefault = !!defaultQuality && defaultQuality !== 'auto';
  if (hasExplicitDefault) els.qualitySelect.value = defaultQuality;

  // FAST for low-powered devices: a static guess (see perf-profile.js for how
  // rough it is) used ONLY to preselect FAST when nothing was chosen. Nothing
  // is written to localStorage, so it never masquerades as the user's own
  // preference and re-evaluates every visit.
  const deviceProfile = window.VS.PerfProfile.detect();
  if (deviceProfile.tier === 'low') {
    if (!hasExplicitDefault) { els.qualitySelect.value = 'fast'; autoPickedFast = true; }
    if (els.deviceTierNote) {
      els.deviceTierNote.textContent =
        `This device looks low-powered (${deviceProfile.reasons.join(', ')}), so FAST is the recommended mode here. ` +
        `That's a guess from what your browser reports \u2014 if it's wrong, pick BALANCED. ` +
        `If the frame rate drops while you're on camera, Genesis will offer to switch for you.`;
      els.deviceTierNote.style.display = 'block';
    }
  }

  const urlParams = new URLSearchParams(window.location.search);
  const requestedEnv = urlParams.get('env');
  const requestedAction = urlParams.get('action');
  const requestedTemplate = urlParams.get('template');


  function updateStudioChrome() {
    const quality = (els.qualitySelect && els.qualitySelect.value || 'balanced').toUpperCase();
    if (els.qualityHud) els.qualityHud.textContent = quality;
    if (els.renderHud) {
      let renderLabel = 'Local';
      if (window.VS.MODNetSegmentationProvider && segProvider instanceof window.VS.MODNetSegmentationProvider) {
        renderLabel = segProvider.usingWebGPU ? 'MODNet \u00b7 WebGPU' : 'MODNet \u00b7 WASM';
      } else if (segProvider instanceof window.VS.RVMSegmentationProvider) {
        renderLabel = segProvider.usingWebGPU ? 'RVM · WebGPU' : 'RVM · WASM';
      } else if (segProvider) {
        renderLabel = segProvider.backend === 'tasks' ? (segProvider.label.includes('GPU') ? 'Local GPU' : 'Local CPU') : 'Compatibility';
      }
      els.renderHud.textContent = renderLabel;
    }
    if (els.transportStatus) els.transportStatus.textContent = running ? (recorder && recorder.state !== 'inactive' ? 'Recording' : 'Previewing') : 'Camera off';
    if (els.previewHint) els.previewHint.textContent = running ? 'Live preview · private until you choose an output' : 'Camera off · Start when you\'re ready';
    if (els.saveState) els.saveState.textContent = recorder && recorder.state !== 'inactive' ? 'Recording' : (running ? 'Ready' : 'Ready');
    if (els.transportLiveBtn) els.transportLiveBtn.disabled = !running || !(localStorage.getItem('vs_whip_endpoint') || '').trim();
  }

  // ============================================================
  // Quality segmented control (visual layer over the real <select>)
  // ============================================================
  function renderQualitySegControl() {
    els.qualitySegControl.innerHTML = QUALITY_META.map(q => `
      <button type="button" class="seg-btn ${q.id === els.qualitySelect.value ? 'active' : ''}" data-quality="${q.id}" role="radio" aria-checked="${q.id === els.qualitySelect.value}" ${q.disabled ? 'disabled' : ''}>
        <span class="seg-name">${q.label}</span>
        <span class="seg-sub">${q.sub}</span>
      </button>
    `).join('');
    els.qualitySegControl.setAttribute('role', 'radiogroup');
    els.qualitySegControl.setAttribute('aria-label', 'Quality mode');
    els.qualitySegControl.querySelectorAll('.seg-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        if (btn.disabled) return;
        els.qualitySelect.value = btn.dataset.quality;
        renderQualitySegControl();
        updateStudioChrome();
      });
    });
  }
  renderQualitySegControl();

  function setQualityControlsDisabled(disabled) {
    els.qualitySelect.disabled = disabled;
    els.qualitySegControl.querySelectorAll('.seg-btn').forEach(btn => {
      const meta = QUALITY_META.find(q => q.id === btn.dataset.quality);
      btn.disabled = disabled || !!(meta && meta.disabled);
    });
  }

  // ============================================================
  // Environment picker (visual cards mirroring the hidden <select>)
  // ============================================================
  function populateEnvironments() {
    els.envSelect.innerHTML = '';
    envProvider.list().forEach(env => {
      const opt = document.createElement('option');
      opt.value = env.id;
      opt.textContent = env.name;
      els.envSelect.appendChild(opt);
    });
    renderEnvMiniGrid();
  }

  function renderEnvMiniGrid() {
    const list = envProvider.list();
    els.envMiniGrid.innerHTML = '';
    list.forEach(env => {
      const card = document.createElement('div');
      card.className = 'env-card' + (env.id === els.envSelect.value ? ' selected' : '');
      card.dataset.id = env.id;
      card.innerHTML = `
        <div class="env-thumb" style="${envProvider.getPreviewStyle(env.id)}"></div>
        <div class="env-body">
          <div class="env-name">${env.name}</div>
        </div>`;
      card.addEventListener('click', () => {
        els.envSelect.value = env.id;
        els.envMiniGrid.querySelectorAll('.env-card').forEach(c => c.classList.remove('selected'));
        card.classList.add('selected');
        pushEnvironment(env.id);
      });
      els.envMiniGrid.appendChild(card);
    });
  }

  function setCanvasSize(mode) {
    const preset = QUALITY_PRESETS[mode];
    const maxDim = Math.max(preset.width, preset.height);
    const frame = compositionEngine.computeFrame(videoNativeW || preset.width, videoNativeH || preset.height, maxDim);
    outW = frame.outW; outH = frame.outH;
    // els.canvas itself is NEVER resized from here once transferControlToOffscreen()
    // has run — the DOM spec throws if you try ("Cannot resize canvas after call to
    // transferControlToOffscreen()"). Its CSS already fills the preview box at 100%
    // regardless of the attribute, and the worker's own OffscreenCanvas (resized via
    // the postMessage below) is what actually controls captured/recorded resolution.
    [els.guideCanvas, els.brushCanvas, els.annotateCanvas].forEach(c => { c.width = outW; c.height = outH; });
    if (renderWorker || localCore) rendererSend({ type: 'resize', w: outW, h: outH });
  }

  // ============================================================
  // Preview overlay states — the "polished preparation state" the
  // product brief asks for instead of a blank rectangle.
  // ============================================================
  function showOverlay(state, opts) {
    opts = opts || {};
    els.previewOverlay.classList.remove('hidden');
    els.previewOverlay.dataset.state = state;
    const iris = els.previewOverlay.querySelector('.iris');
    if (iris) iris.classList.toggle('spin-loop', state === 'preparing');

    if (state === 'idle') {
      // First-run explainer: an anxious-about-being-seen audience deserves to
      // know WHY the browser is about to ask for camera/mic, and what happens
      // to that feed, before the permission prompt fires — not just after.
      // Shown once per browser (localStorage flag), then the shorter copy
      // takes over for every return visit.
      const seenExplainer = localStorage.getItem('vs_seen_camera_explainer');
      if (!seenExplainer) {
        els.overlayTitle.textContent = 'Before your camera turns on';
        els.overlaySub.textContent = 'This is your space, not a broadcast. Nothing leaves your browser unless you choose to hit Record or Go Live.';
      } else {
        els.overlayTitle.textContent = 'Ready when you are';
        els.overlaySub.textContent = 'Start your camera to preview the studio composite live. Nothing is recorded until you hit Record.' +
          (autoPickedFast && els.qualitySelect.value === 'fast' ? ' FAST mode was pre-selected for this device.' : '');
      }
      els.startBtn.style.display = 'inline-flex';
      els.startBtn.disabled = false;
      els.startBtn.textContent = 'Start Camera';
      if (els.previewEnvLink) els.previewEnvLink.style.display = 'inline-block';
    } else if (state === 'preparing') {
      els.overlayTitle.textContent = opts.message || 'Preparing your studio...';
      els.overlaySub.textContent = 'Getting your camera and local segmentation model ready. This only takes a moment.';
      els.startBtn.style.display = 'none';
      if (els.previewEnvLink) els.previewEnvLink.style.display = 'none';
    } else if (state === 'error') {
      els.overlayTitle.textContent = opts.title || 'Something needs your attention';
      els.overlaySub.textContent = opts.message || 'Camera access failed.';
      els.startBtn.style.display = 'inline-flex';
      els.startBtn.disabled = false;
      els.startBtn.textContent = 'Try again';
      if (els.previewEnvLink) els.previewEnvLink.style.display = 'none';
    }
  }
  function hideOverlay() { els.previewOverlay.classList.add('hidden'); }

  function setPill(el, on) {
    el.classList.toggle('on', on);
    el.classList.toggle('off', !on);
  }

  async function startCamera() {
    if (!workerReady && !localCore) {
      showOverlay('error', {
        title: 'Browser not supported',
        message: 'This browser doesn\u2019t support the canvas rendering Studio needs (neither the Worker path nor the main-thread fallback). Try the latest Chrome, Edge, Firefox, or Safari.'
      });
      return;
    }
    const quality = els.qualitySelect.value;
    if (quality === 'ultra') {
      showOverlay('error', { title: 'ULTRA needs a step first', message: 'ULTRA mode requires a paid cloud GPU provider that is not connected yet. Pick FAST, BALANCED, or QUALITY.' });
      return;
    }

    localStorage.setItem('vs_seen_camera_explainer', '1');
    if (window.__vsT) { window.__vsT.camStart = performance.now(); window.__vsT.cameraVisible = 0; window.__vsT.cutoutVisible = 0; }
    showOverlay('preparing', { message: 'Preparing your studio...' });
    setCanvasSize(quality);

    // v0.13: ask for 30 fps explicitly. A phone report showed 9 fps with only 39 ms of work per frame: the camera itself was
    // delivering ~9 fps because no frame rate was requested (many Android cameras default low or drop in dim light).
    const dims = { width: QUALITY_PRESETS[quality].width, height: QUALITY_PRESETS[quality].height, frameRate: { ideal: 30 } };
    if (tuned && tuned.cam) Object.assign(dims, tuned.cam); // camera mode found by the full test (resolution/resizeMode that really delivers more fps)
    // Explicit device pick (desktop dropdown) wins. Otherwise prefer facingMode —
    // Android/iOS enumerate cameras inconsistently, but facingMode is reliable and
    // gets a front-facing camera by default instead of whatever the OS lists first.
    const videoConstraint = els.cameraSelect.value
      ? { ...dims, deviceId: { exact: els.cameraSelect.value } }
      : { ...dims, facingMode: { ideal: currentFacingMode } };
    // v0.13: the browser's own noise suppression + echo cancel (free, on-device); auto gain stays off because the chain does levelling.
    let aset = { ns: true, ec: true, preset: 'voice' };
    try { Object.assign(aset, JSON.parse(localStorage.getItem('vs_audio') || '{}')); } catch (e) {}
    const audioConstraint = Object.assign({ noiseSuppression: aset.ns, echoCancellation: aset.ec, autoGainControl: false },
      els.micSelect.value ? { deviceId: { exact: els.micSelect.value } } : {});

    if (!window.isSecureContext) {
      showOverlay('error', {
        title: 'Insecure connection',
        message: 'Camera access only works over HTTPS (or localhost). Reload this page using an https:// URL.'
      });
      return;
    }
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      showOverlay('error', {
        title: 'Camera not supported',
        message: 'This browser does not expose camera APIs. Try the latest Chrome, Safari, or Firefox.'
      });
      return;
    }

    const guidance = {
      NotFoundError: 'No camera or microphone was found on this device.',
      NotReadableError: 'Your camera is already in use by another app or tab. Close it and try again.',
      OverconstrainedError: 'The selected camera/mic doesn\u2019t support the requested settings. Try a different device or quality mode.',
      SecurityError: 'Camera access was blocked for security reasons in this context.',
      AbortError: 'Camera startup was interrupted. Try again.'
    };

    // A combined {video, audio} request can't tell you WHICH of the two is
    // actually blocked when it's denied — Chrome/Firefox reject the whole
    // thing either way. Re-probing each separately turns a generic "camera
    // or mic failed" into a precise answer, so this doesn't stay a mystery.
    async function diagnosePermissionBlock() {
      const check = async (constraints) => {
        try {
          const s = await navigator.mediaDevices.getUserMedia(constraints);
          s.getTracks().forEach(t => t.stop());
          return 'ok';
        } catch (e) {
          return (e.name === 'NotAllowedError' || e.name === 'PermissionDeniedError') ? 'blocked' : 'ok'; // any other error here isn't a permission problem
        }
      };
      const [camera, mic] = await Promise.all([check({ video: true }), check({ audio: true })]);
      return { camera, mic };
    }

    try {
      stream = await navigator.mediaDevices.getUserMedia({ video: videoConstraint, audio: audioConstraint });
    } catch (err) {
      // Exact-constraint failures (a stale/missing deviceId, or a resolution the
      // device won't do) are recoverable — retry once with loose constraints
      // before surfacing an error, instead of failing on something fixable.
      if (err.name === 'OverconstrainedError' || err.name === 'NotFoundError') {
        try {
          stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: audioConstraint });
          els.cameraSelect.value = '';
        } catch (err2) {
          showOverlay('error', { title: 'Camera or microphone access failed', message: guidance[err2.name] || err2.message });
          return;
        }
      } else if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
        const diag = await diagnosePermissionBlock();
        const base = 'On mobile: check the site permission icon next to the URL bar, AND check your browser app\u2019s own OS-level camera/mic permission in your phone\u2019s Settings \u2192 Apps.';
        let message;
        if (diag.camera === 'blocked' && diag.mic === 'blocked') {
          message = `Both your CAMERA and MICROPHONE are blocked for this site. ${base}`;
        } else if (diag.camera === 'blocked') {
          message = `Your CAMERA is blocked for this site (microphone is fine). ${base}`;
        } else if (diag.mic === 'blocked') {
          message = `Your MICROPHONE is blocked for this site (camera is fine). ${base}`;
        } else {
          message = 'Permission was denied, but checking again just now succeeded for both camera and mic separately — tap Try again.';
        }
        showOverlay('error', { title: 'Camera or microphone access failed', message });
        return;
      } else {
        showOverlay('error', {
          title: 'Camera or microphone access failed',
          message: (guidance[err.name] || err.message) + (guidance[err.name] ? '' : ' — check your browser\u2019s site permissions and try again.')
        });
        return;
      }
    }

    // v0.13 audio chain (js/audio-chain.js). Falls back to the raw mic if the graph cannot run.
    try {
      if (window.VS.audioChain) window.VS.audioChain.dispose();
      window.VS.audioChain = window.VS.AudioChain ? new window.VS.AudioChain(stream) : null;
      if (window.VS.audioChain) { window.VS.audioChain.setPreset(aset.preset); window.VS.audioChain.resume(); }
    } catch (e) { window.VS.audioChain = null; }

    await populateDevices(); // labels are only readable after permission is granted

    // HARDENING: a camera can vanish mid-session (unplugged USB webcam, OS
    // reclaims it for another app, a laptop lid-close power event) without
    // throwing anywhere in this code — the video element just quietly stops
    // updating and every frame after that composites a frozen last-known
    // image. For a recording that's bad; for a live stream with no re-cut
    // safety net, it's dead air the streamer has no way to notice. `ended`
    // fires when the track is gone for good; `mute`/`unmute` fire on
    // temporary signal loss (e.g. some OS-level camera privacy toggles).
    const liveVideoTrack = stream.getVideoTracks()[0];
    if (liveVideoTrack) {
      liveVideoTrack.onended = () => {
        window.VS.reportError('Your camera feed was lost (unplugged, reclaimed by another app, or a permission change)');
        perfBannerShown = false; perfBannerKey = ''; // this message is not a perf message — the FPS check must never hide or overwrite it
        els.degradeBanner.classList.add('show');
        els.degradeBanner.textContent = 'Camera feed lost. Reconnect your camera, then Stop Camera and start again.';
        if (liveActive) setLiveStatus('error', 'Camera feed lost — you are live with no video. Reconnect and restart.');
      };
      liveVideoTrack.onmute = () => {
        if (liveActive) setLiveStatus('error', 'Camera signal paused (muted) — check the live feed.');
      };
      liveVideoTrack.onunmute = () => {
        if (liveActive && streamProvider.pc && streamProvider.pc.connectionState === 'connected') setLiveStatus('live', 'Live');
      };
    }

    els.video.srcObject = stream;
    await els.video.play();
    try {
      const vt = stream.getVideoTracks()[0];
      let st = vt.getSettings ? vt.getSettings() : {};
      if (st.frameRate && st.frameRate < 24 && vt.applyConstraints) {
        await vt.applyConstraints({ frameRate: { ideal: 30 } }).catch(() => {});
        st = vt.getSettings();
      }
      try { window.VS.LightMeter && window.VS.LightMeter.start(els.video, vt); } catch (e) {}
      try {   // v0.49 Phase 1: after the light meter's first pass, test frame-rate/exposure controls in the background; keeps one only if real fps rises
        const cc = window.VS.CameraControl, myStream = stream;
        if (cc) setTimeout(() => { if (stream === myStream && running) cc.start({ track: vt, video: els.video, canRun: () => stream === myStream && running && !((recorder && recorder.state !== 'inactive') || liveActive) }); }, 2500);
      } catch (e) {}
      window.__camFps = st.frameRate ? Math.round(st.frameRate * 10) / 10 : null;
      window.__camSettings = (st.width || '?') + 'x' + (st.height || '?') + ' @' + (st.frameRate || '?') + ' fps';
    } catch (e) {}

    videoNativeW = els.video.videoWidth || dims.width;
    videoNativeH = els.video.videoHeight || dims.height;
    setCanvasSize(quality); // re-derive real output size now that native video dims are known
    showRawCamera(); // v0.13: the person sees themselves NOW; the cutout fades in when it is ready

    // Per-run FAST state. Every camera start begins at full mask refresh and
    // re-adapts from measured FPS, so a device that recovered (other apps
    // closed) isn't left on the reduced setting for the rest of the session.
    runningQuality = quality;
    segStride = saverOn ? window.VS.PerfProfile.MAX_STRIDE : 1; // v0.45: always refresh the cut-out every frame (stride 2 made edges lag = cracks)
    els.previewFrame.classList.toggle('vid-under', !!(tuned && tuned.vid === 'under'));
    resetSegCache();
    rendererSend({ type: 'setPerf', lite: quality === 'fast' });

    // RVM (Robust Video Matting) gives the best edges, but it's a heavier
    // recurrent network — real-time only with WebGPU compute behind it. On a
    // WASM-only device (most phones, many laptops) it falls badly behind and
    // the person can appear to vanish entirely while it struggles to keep up.
    // Gate it on an actual WebGPU signal and default everyone else to the
    // lighter, real-time-tuned MediaPipe Tasks Vision path instead of always
    // gambling on RVM first.
    // Phones (like a Redmi 14C) report WebGPU but are too slow for RVM in real time;
    // there the fast MediaPipe mask + the GPU sharp-edge stage gives better results.
    const isMobileDevice = /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent || '') || (navigator.maxTouchPoints > 1 && Math.min(screen.width, screen.height) < 900);
    // Model choice. AUTO = MODNet (Apache-2.0, real matting) if this device is fast
    // enough (one-time speed test, remembered), otherwise MediaPipe (Apache-2.0, lightest).
    // RVM is GPL-3.0, so it only runs if someone explicitly picks it (personal use).
    const VSNS = window.VS;
    const pref = (els.modelSelect && els.modelSelect.value) || 'auto';
    const knownBench = readBench();
    let warmPromise = null;
    // INSTANT START: Auto always starts on the light MediaPipe model (small, cached after first load)
    // and upgrades to MODNet in the background. Only an explicit "MODNet" choice waits for it.
    if (pref === 'rvm' && VSNS.RVMSegmentationProvider) {
      segProvider = new VSNS.RVMSegmentationProvider();
    } else if (pref === 'modnet' && VSNS.MODNetSegmentationProvider) {
      segProvider = makeModnet();
    } else if (warm && VSNS.MediaPipeSegmentationProvider) {
      segProvider = warm.provider;      // already downloaded and warmed up while the page was idle
      warmPromise = warm.promise;
      warm = null;
    } else {
      segProvider = new (VSNS.MediaPipeSegmentationProvider || VSNS.MODNetSegmentationProvider || VSNS.RVMSegmentationProvider)();
    }
    const loadTimeout = (VSNS.MODNetSegmentationProvider && segProvider instanceof VSNS.MODNetSegmentationProvider) ? MODNET_LOAD_TIMEOUT_MS : MODEL_LOAD_TIMEOUT_MS;
    segProvider.lowLightBoost = lowLightBoostEnabled;
    if (els.previewHint) els.previewHint.textContent = 'Camera on · loading cutout model';
    try {
      await withTimeout(
        warmPromise ? warmPromise.then((ok) => (ok ? undefined : segProvider.initialize(quality))) : segProvider.initialize(quality),
        loadTimeout,
        `Timed out after ${loadTimeout / 1000}s loading the high-quality model — your connection may be slow.`
      );
      updateStudioChrome();
    } catch (err) {
      // RVM needs onnxruntime-web + (ideally) WebGPU/WASM support. If that
      // genuinely fails to load (offline first run, ancient browser, CDN
      // blocked, or just too slow — see withTimeout above), fall back to the
      // MediaPipe model rather than leaving the person with no camera at
      // all — but say so honestly, never silently, and if MediaPipe ALSO
      // fails or times out, surface that real error.
      if (!(window.VS.MediaPipeSegmentationProvider && segProvider instanceof window.VS.MediaPipeSegmentationProvider) && window.VS.MediaPipeSegmentationProvider) {
        console.warn('Segmentation model failed to initialize, falling back to MediaPipe:', err.message);
        if (els.previewHint) els.previewHint.textContent = 'Camera on · switching to a lighter model';
        segProvider.dispose?.();
        segProvider = new window.VS.MediaPipeSegmentationProvider();
        segProvider.lowLightBoost = lowLightBoostEnabled;
        try {
          await withTimeout(
            segProvider.initialize(quality),
            MODEL_LOAD_TIMEOUT_MS,
            `Timed out after ${MODEL_LOAD_TIMEOUT_MS / 1000}s loading the fallback model — check your connection and try again.`
          );
          updateStudioChrome();
        } catch (fallbackErr) {
          modelFailedKeepCamera(fallbackErr.message);
          return;
        }
      } else {
        modelFailedKeepCamera(err.message);
        return;
      }
    }

    running = true;
    updateStudioChrome();
    els.stopBtn.disabled = false;
    els.recordBtn.disabled = false;
    els.recordBtn.classList.remove('disabled');
    els.goLiveBtn.disabled = !(localStorage.getItem('vs_whip_endpoint') || '').trim();
    setQualityControlsDisabled(true);
    setPill(els.camPill, true);
    setPill(els.micPill, !!stream.getAudioTracks()[0]);
    consecutiveLowFps = 0;
    emptyRun = 0; noPersonMode = false; repairingMask = false; backendConfirmed = false;
    els.degradeBanner.classList.remove('show');
    updateCostInfo();
    hideOverlay();
    scheduleSelfCheck();
    els.flipCamBtn.style.display = 'inline-flex';
    loopToken++; // any iteration still finishing from a previous run is now stale and will exit on its own
    processLoop();
    let tryModnet = false; try { tryModnet = localStorage.getItem('vs_try_modnet') === '1'; } catch (e) {}
    if (tryModnet && pref === 'auto' && VSNS.MODNetSegmentationProvider && VSNS.MediaPipeSegmentationProvider &&
        segProvider instanceof VSNS.MediaPipeSegmentationProvider &&
        !(knownBench && knownBench.modnetMs > MODNET_MAX_MS)) {
      backgroundUpgrade(quality, loopToken);
    } else if (tryModnet && pref === 'auto' && knownBench && knownBench.modnetMs > MODNET_MAX_MS) {
      showBenchNote('This device runs best on the light model (earlier test: MODNet ' + knownBench.modnetMs + ' ms).');
    }
  }

  function stopCamera() {
    running = false;
    updateStudioChrome();
    loopToken++;
    resetSegCache();
    if (recorder && recorder.state !== 'inactive') stopRecording();
    if (liveActive) stopLiveStream();
    try { window.VS.CameraControl && window.VS.CameraControl.stop(); } catch (e) {}
    if (stream) stream.getTracks().forEach(t => t.stop());
    // Screen shares are their own independent capture, not part of `stream`
    // above — stopping the camera without stopping these would leave the
    // browser's "you're sharing your screen" indicator on indefinitely.
    liveOverlays.forEach((live, id) => {
      live.stream.getTracks().forEach((t) => t.stop());
      rendererSend({ type: 'removeOverlay', id });
    });
    if (liveOverlays.size) {
      overlayList = overlayList.filter((o) => !liveOverlays.has(o.id));
      liveOverlays.clear();
      renderOverlayList();
      updateOverlayUploadState();
    }
    if (segProvider) segProvider.dispose();
    if (window.VS.audioChain) { window.VS.audioChain.dispose(); window.VS.audioChain = null; }
    clearRawCamera(); clearTimeout(selfCheckTimer); droppedFrames = 0; runSince = 0;
    els.stopBtn.disabled = true;
    els.recordBtn.disabled = true;
    els.recordBtn.classList.add('disabled');
    els.goLiveBtn.disabled = true;
    setQualityControlsDisabled(false);
    setPill(els.camPill, false);
    setPill(els.micPill, false);
    if (renderWorker || localCore) rendererSend({ type: 'clear' });
    guideCtx.clearRect(0, 0, els.guideCanvas.width, els.guideCanvas.height);
    els.statsEl.textContent = 'FPS: -- | Frame latency: -- ms';
    els.flipCamBtn.style.display = 'none';
    showOverlay('idle');
  }

  els.flipCamBtn.addEventListener('click', async () => {
    if (!running) return;
    currentFacingMode = currentFacingMode === 'user' ? 'environment' : 'user';
    els.cameraSelect.value = ''; // explicit facingMode should win over a stale device pick
    els.flipCamBtn.disabled = true;
    if (stream) stream.getTracks().forEach(t => t.stop());
    running = false;
    try {
      await startCamera();
    } finally {
      els.flipCamBtn.disabled = false;
    }
  });

  function resetSegCache() {
    if (cachedMaskBitmap) { cachedMaskBitmap.close(); cachedMaskBitmap = null; }
    strideTick = 0;
    segMsEma = 0;
  }

  let pipeFailCount = 0;

  // ---- v0.13: frame scheduling. requestVideoFrameCallback fires once per NEW camera frame (no wasted
  // work, no duplicate frames); a 250 ms guard falls back to requestAnimationFrame so a stalled callback
  // can never freeze the loop. Browsers without rVFC (older Safari/Firefox) use requestAnimationFrame.
  const HAS_RVFC = typeof HTMLVideoElement !== 'undefined' && 'requestVideoFrameCallback' in HTMLVideoElement.prototype;
  let useRvfc = HAS_RVFC, rvfcMisses = 0, rvfcFired = 0, rvfcGuard = 0;
  try { if (localStorage.getItem('vs_loop') === 'raf') useRvfc = false; } catch (e) {}
  let tuned = null;
  try { tuned = JSON.parse(localStorage.getItem('vs_tuned') || 'null'); } catch (e) {}
  if (tuned && tuned.loop === 'raf') useRvfc = false;
  let loopMode = !useRvfc ? 'rAF (chosen: rVFC was throttled on this device)' : 'rVFC';
  function scheduleNext() {
    if (!useRvfc || !els.video || els.video.paused) { requestAnimationFrame(processLoop); return; }
    let fired = false;
    const go = () => { if (fired) return; fired = true; processLoop(); };
    els.video.requestVideoFrameCallback(() => { if (!fired) { rvfcMisses = 0; rvfcFired++; } go(); });
    setTimeout(() => {
      if (fired) return;
      // The callback did not arrive in 120 ms (hidden tab, throttled video, or a slow camera). Never stall:
      // continue on rAF, and after 3 misses in a row stop using rVFC on this device.
      rvfcGuard++;
      if (++rvfcMisses >= 3) { useRvfc = false; loopMode = 'rAF (rVFC unreliable here)'; }
      requestAnimationFrame(go);
    }, 120);
  }

  // ---- v0.13: raw camera first, then fade into the cutout. Never an empty scene, never a blank screen.
  let rawStartAt = 0, revealed = true, rawHoldTimer = null;
  function showRawCamera() {
    rawStartAt = performance.now();
    revealed = false;
    els.previewFrame.classList.remove('revealing');
    els.previewFrame.classList.add('raw-first');
    if (window.__vsT) window.__vsT.cameraVisible = rawStartAt;
    hideOverlay();
    if (els.previewHint) els.previewHint.textContent = 'Camera on · getting your cutout ready';
    clearTimeout(rawHoldTimer);
    // If the cutout has not produced a sane person mask within 6 s, reveal anyway (watchdog banner explains why).
    rawHoldTimer = setTimeout(() => revealCutout('timeout'), 6000);
  }
  function revealCutout(why) {
    if (revealed) return;
    revealed = true;
    clearTimeout(rawHoldTimer);
    if (window.__vsT) { window.__vsT.cutoutVisible = performance.now(); window.__vsT.revealWhy = why; }
    els.previewFrame.classList.add('revealing');           // 300 ms opacity fade on the canvas (see css)
    setTimeout(() => { if (revealed && running) els.previewFrame.classList.remove('raw-first', 'revealing'); }, 340);
    if (els.previewHint) els.previewHint.textContent = '';
  }
  function maybeReveal() {
    if (revealed) return;
    const cov = segProvider && segProvider.lastCoverage;
    if (cov === null || cov === undefined) { revealCutout('no-coverage-signal'); return; } // MODNet/RVM: no coverage metric
    if (cov > 0.02) revealCutout('person-found');
    else if (noPersonMode) revealCutout('no-person-passthrough');
  }
  function clearRawCamera() {
    clearTimeout(rawHoldTimer);
    revealed = true;
    els.previewFrame.classList.remove('raw-first', 'revealing');
  }
  // A model failure must still leave the person seeing themselves, with one plain sentence.
  function modelFailedKeepCamera(message) {
    running = false; updateStudioChrome();
    els.stopBtn.disabled = false;
    perfBannerShown = false; perfBannerKey = '';
    els.degradeBanner.classList.add('show');
    els.degradeBanner.textContent = 'The cutout could not start (' + message + '). Showing your camera. Press Stop, check your connection, then Start again.';
    if (els.previewHint) els.previewHint.textContent = 'Camera on · cutout unavailable';
    if (window.VS.logError) window.VS.logError('model failed: ' + message);
  }

  // ---- v0.13: live state for the hidden Diagnostics panel + first-run self-check.
  let droppedFrames = 0, lastRenderMs = null;
  // Measure how fast the camera really delivers frames, independent of our loop (decoded-frame counter, not presentation).
  let tuningNow = false;
  let checkPaused = false;
  let camRate = 0, camPrevN = 0, camPrevT = 0, runSince = 0;
  setInterval(() => {
    if (!running || !els.video.getVideoPlaybackQuality) { camPrevN = 0; return; }
    const n = els.video.getVideoPlaybackQuality().totalVideoFrames, t = performance.now();
    if (camPrevN && t > camPrevT) camRate = Math.round(((n - camPrevN) * 1000 / (t - camPrevT)) * 10) / 10;
    camPrevN = n; camPrevT = t;
    // Auto-fallback: loop is much slower than the camera and rVFC is in use -> rVFC is being throttled; use rAF from now on.
    if (!runSince) runSince = t;
    if (!tuningNow && useRvfc && t - runSince > 6000 && recentFps > 0 && recentFps < 15 && camRate > recentFps * 1.5) {
      useRvfc = false; loopMode = 'rAF (auto: rVFC throttled, camera ' + camRate + ' fps vs loop ' + recentFps + ')';
      try { localStorage.setItem('vs_loop', 'raf'); } catch (e) {}
    }
  }, 1000);
  let totalFrames = 0;
  const stg = { bmp: 0, rend: 0, frame: 0, period: 0, prevStart: 0, infRatio: 0 };
  const ema = (o, v) => (o ? o * 0.85 + v * 0.15 : v);
  // ---- v0.13 Battery saver + pressure governor
  let saverOn = false, lastLoopAt = 0, saverPrevStride = 1;
  function setSaver(on, why) {
    if (on === saverOn) return;
    saverOn = on;
    if (els.batterySaverToggle) els.batterySaverToggle.checked = on;
    if (why !== 'pressure') { try { localStorage.setItem('vs_saver', on ? '1' : '0'); } catch (e) {} } // automatic pressure throttling is per session, never saved
    if (on) { saverPrevStride = segStride; segStride = Math.max(segStride, window.VS.PerfProfile.MAX_STRIDE); }
    else { segStride = runningQuality === 'fast' ? segStride : saverPrevStride; resetSegCache(); }
    if (on && why) setPerfBanner('saver-' + why, why === 'pressure'
      ? 'Your phone is working hard, so Genesis lowered its frame rate and cutout refresh to cool it down. Turn off Battery saver in the Refine mask tab if you prefer full speed.'
      : 'Battery saver is on: about 20 frames per second and a lighter cutout.');
  }
  try { if (localStorage.getItem('vs_saver') === '1') { saverOn = true; if (els.batterySaverToggle) els.batterySaverToggle.checked = true; } } catch (e) {}
  if (els.batterySaverToggle) els.batterySaverToggle.addEventListener('change', () => { saverOn = !els.batterySaverToggle.checked; setSaver(els.batterySaverToggle.checked, 'manual'); });

  // ================= v0.13 FULL TEST / AUTO-TUNE =================
  // One tap on the phone: measures every combination that could explain low fps, applies the fastest, remembers it
  // (localStorage vs_tuned) and writes a full report that Copy report includes. No redeploys needed to find out.
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  window.__tuneLog = window.__tuneLog || [];
  async function rvfcProbe(style, ms) {
    // Free-running rVFC rate on a clone of the camera stream, with NO processing, per video style.
    const v = document.createElement('video'); v.muted = true; v.playsInline = true; v.srcObject = stream;
    v.style.cssText = {
      none: 'display:none',
      tiny: 'position:fixed;left:0;top:0;width:1px;height:1px;opacity:0.01;pointer-events:none;z-index:0',
      under: 'position:fixed;left:0;top:0;width:100%;height:100%;opacity:1;pointer-events:none;z-index:-1',
    }[style];
    document.body.appendChild(v);
    try { await v.play(); } catch (e) {}
    let n = 0; const t0 = performance.now();
    const cb = () => { n++; if ('requestVideoFrameCallback' in v) v.requestVideoFrameCallback(cb); };
    if ('requestVideoFrameCallback' in v) v.requestVideoFrameCallback(cb);
    await sleep(ms);
    const out = 'requestVideoFrameCallback' in v ? Math.round(n * 1000 / (performance.now() - t0) * 10) / 10 : 'n/a';
    v.srcObject = null; v.remove(); return out;
  }
  function applyCfg(c) {
    useRvfc = c.loop === 'rvfc' && HAS_RVFC; rvfcMisses = 0;
    loopMode = useRvfc ? 'rVFC' : 'rAF';
    els.previewFrame.classList.toggle('vid-under', c.vid === 'under');
    segStride = c.stride || 1; resetSegCache();
  }
  async function sampleCfg(label, c, ms) {
    applyCfg(c); await sleep(700);                       // let the loop settle
    const f0 = totalFrames, t0 = performance.now(), cam0 = camRate;
    await sleep(ms);
    const dt = (performance.now() - t0) / 1000;
    const fps = Math.round((totalFrames - f0) / dt * 10) / 10;
    const cov = segProvider && segProvider.lastCoverage != null ? Math.round(segProvider.lastCoverage * 1000) / 10 : null;
    const r = { label, loop: c.loop, vid: c.vid, stride: c.stride || 1, engine: segProvider.current || segProvider.label, fps, cov, camFps: camRate, seg: Math.round(segMsEma), frame: Math.round(stg.frame), period: Math.round(stg.period) };
    window.__tuneLog.push(r); return r;
  }
  async function runFullTest(progress, opts) {
    opts = opts || {}; const ms = opts.ms || 4000;
    if (!running || !segProvider) throw new Error('Start the camera first, then run the full test.');
    const say = (t) => { try { progress && progress(t); } catch (e) {} };
    window.__tuneLog = []; window.__tuneSummary = null; tuningNow = true;
    try {
    const dims0 = { width: (stream.getVideoTracks()[0].getSettings().width) || 360, height: (stream.getVideoTracks()[0].getSettings().height) || 480 };
    const saved = { useRvfc, stride: segStride, vid: els.previewFrame.classList.contains('vid-under') ? 'under' : 'tiny' };
    const batt0 = batteryRef ? batteryRef.level : null; const tStart = performance.now();
    const cam = (() => { try {
      const vt = stream.getVideoTracks()[0]; const caps = vt.getCapabilities ? vt.getCapabilities() : {}; const st = vt.getSettings();
      return { label: vt.label, settings: st, maxFps: caps.frameRate && caps.frameRate.max, maxW: caps.width && caps.width.max, maxH: caps.height && caps.height.max,
        exposureMode: st.exposureMode, exposureTime: st.exposureTime, whiteBalance: st.whiteBalanceMode, iso: st.iso };
    } catch (e) { return { error: String(e) }; } })();
    const probes = {};
    for (const style of ['none', 'tiny', 'under']) { say('Probing camera callbacks (' + style + ')...'); probes[style] = await rvfcProbe(style, 2000); }
    const results = [];
    const combos = [];
    for (const loop of ['rvfc', 'raf']) for (const vid of ['tiny', 'under']) combos.push({ loop, vid, stride: 1 });
    let i = 0;
    for (const c of combos) { i++; say('Testing ' + i + '/' + (combos.length + 3) + ': loop ' + c.loop + ', video ' + c.vid + ' (keep your face in frame)'); results.push(await sampleCfg('loop+video', c, ms)); }
    let best = results.filter((r) => r.cov == null || r.cov > 2).sort((a, b) => b.fps - a.fps)[0] || results[0];
    say('Testing mask refresh every other frame...');
    results.push(await sampleCfg('stride2', { loop: best.loop, vid: best.vid, stride: 2 }, ms));
    // Camera modes: many phones advertise 30 fps but deliver ~10 at odd sizes or with crop-and-scale. Try real modes on the live
    // track, measure DECODED frames per second (not our loop), keep the best one that is clearly faster.
    const vt0 = stream.getVideoTracks()[0];
    const camNow = () => { const q = els.video.getVideoPlaybackQuality && els.video.getVideoPlaybackQuality(); return q ? q.totalVideoFrames : 0; };
    const measureCam = async (dur) => { const n0 = camNow(), t0 = performance.now(); await sleep(dur); return Math.round((camNow() - n0) * 1000 / (performance.now() - t0) * 10) / 10; };
    const camModes = [
      { name: 'current', c: null },
      { name: '480x640 none', c: { width: 480, height: 640, frameRate: { ideal: 30 }, resizeMode: 'none' } },
      { name: '640x480 none', c: { width: 640, height: 480, frameRate: { ideal: 30 }, resizeMode: 'none' } },
      { name: '720x1280 none', c: { width: 720, height: 1280, frameRate: { ideal: 30 }, resizeMode: 'none' } },
      { name: '1280x720 none', c: { width: 1280, height: 720, frameRate: { ideal: 30 }, resizeMode: 'none' } },
      { name: '640x360 none', c: { width: 640, height: 360, frameRate: { ideal: 30 }, resizeMode: 'none' } },
    ];
    const camResults = []; let camBest = null;
    applyCfg({ loop: best.loop, vid: best.vid, stride: 1 });
    for (const m of camModes) {
      say('Testing camera mode ' + m.name + '...');
      try {
        if (m.c) { await vt0.applyConstraints(m.c); await sleep(1200); }
        else await sleep(300);
        videoNativeW = els.video.videoWidth || videoNativeW; videoNativeH = els.video.videoHeight || videoNativeH;
        const fps = await measureCam(2500);
        const st = vt0.getSettings();
        const row = { name: m.name, fps, got: (st.width || '?') + 'x' + (st.height || '?') + ' @' + (st.frameRate || '?') };
        camResults.push(row);
        if (!camBest || fps > camBest.fps) camBest = Object.assign({ c: m.c }, row);
      } catch (e) { camResults.push({ name: m.name, error: String((e && e.message) || e).slice(0, 80) }); }
    }
    const camBase = camResults.find((r) => r.name === 'current');
    let chosenCam = null;
    if (camBest && camBest.c && camBase && camBest.fps > camBase.fps * 1.3) chosenCam = camBest.c;
    try {   // leave the track in the chosen mode (or back to the original constraints)
      await vt0.applyConstraints(chosenCam || { width: dims0.width, height: dims0.height, frameRate: { ideal: 30 } });
      await sleep(800); videoNativeW = els.video.videoWidth || videoNativeW; videoNativeH = els.video.videoHeight || videoNativeH;
    } catch (e) { camResults.push({ name: 'restore', error: String(e && e.message || e).slice(0, 80) }); }
    // Engines: only try the others if there is time; each may need a download, so failures are recorded, not fatal.
    const engineNotes = [];
    const origEngine = segProvider.current;
    for (const name of ['tasks-cpu', 'tasks-gpu']) {
      if (!segProvider._start) break;
      say('Testing engine ' + name + ' (may download a model)...');
      try {
        segProvider._quality = runningQuality;
        await withTimeout(segProvider._start(name), 25000, 'timed out');
        resetSegCache();
        const r = await sampleCfg('engine ' + name, { loop: best.loop, vid: best.vid, stride: 1 }, ms);
        results.push(r);
        // a GPU engine that returns an empty mask is useless even if fast
      } catch (e) { engineNotes.push(name + ': ' + (e && e.message || e)); }
    }
    // Restore the original engine unless an alternative is clearly better and sane (>=25% faster with person found).
    const engineRows = results.filter((r) => /^engine /.test(r.label) && r.cov != null && r.cov > 2);
    const baseRow = results.find((r) => r.loop === best.loop && r.vid === best.vid && r.stride === 1 && r.label === 'loop+video');
    const bestEngine = engineRows.sort((a, b) => b.fps - a.fps)[0];
    let chosenEngine = origEngine;
    if (bestEngine && baseRow && bestEngine.fps > baseRow.fps * 1.25) chosenEngine = bestEngine.engine;
    try { if (segProvider.current !== chosenEngine) { await withTimeout(segProvider._start(chosenEngine), 25000, 'timed out'); resetSegCache(); } } catch (e) { engineNotes.push('restore ' + chosenEngine + ': ' + e.message); try { await segProvider._start(origEngine); } catch (e2) {} chosenEngine = origEngine; }
    const s2 = results.find((r) => r.label === 'stride2');
    const useStride = s2 && s2.fps > best.fps * 1.25 && (s2.cov == null || s2.cov > 2) ? 2 : 1;
    const final = { loop: best.loop, vid: best.vid, stride: useStride, engine: chosenEngine, cam: chosenCam, at: new Date().toISOString().slice(0, 16), fps: Math.max(best.fps, s2 ? (useStride === 2 ? s2.fps : 0) : 0) };
    applyCfg({ loop: final.loop, vid: final.vid, stride: final.stride });
    tuned = final;
    try { localStorage.setItem('vs_tuned', JSON.stringify(final)); localStorage.setItem('vs_loop', final.loop === 'raf' ? 'raf' : 'rvfc'); if (chosenEngine) localStorage.setItem('vs_seg_backend', chosenEngine); } catch (e) {}
    useRvfc = final.loop === 'rvfc' && HAS_RVFC; loopMode = useRvfc ? 'rVFC' : 'rAF';
    const batt1 = batteryRef ? batteryRef.level : null;
    window.__tuneSummary = { cam, camResults, probes, results, final, engineNotes, seconds: Math.round((performance.now() - tStart) / 1000), batteryDropPct: batt0 != null && batt1 != null ? Math.round((batt0 - batt1) * 1000) / 10 : null, saved };
    say('Done. Applied: loop ' + final.loop + ', video ' + final.vid + ', stride ' + final.stride + ', engine ' + chosenEngine + '. Press Copy report.');
    return window.__tuneSummary;
    } finally { tuningNow = false; }
  }
  window.VS.tune = { run: runFullTest };
  /** Studio Check (Phase 0): pauses the live picture, measures camera controls + model speed, restores everything. */
  window.VS.studioCheckRun = async function (progress) {
    if (!running) throw new Error('Start the camera first, then run Studio Check.');
    const V = window.VS; const camTrack = stream && stream.getVideoTracks()[0];
    try { if (V.CameraControl) await V.CameraControl.release(camTrack); } catch (e) { /* camera control is optional */ }   // v0.49: the check must measure the true automatic camera
    checkPaused = true; tuningNow = true;
    try {
      const sum = await V.studioCheck.run({
        video: els.video, track: stream && stream.getVideoTracks()[0], progress,
        isRecording: () => (recorder && recorder.state !== 'inactive') || liveActive,
        makeProvider: () => new V.MODNetWorkerProvider(), sizeFor: V.MODNetSegmentationProvider.sizeFor,
      });
      window.__studioCheck = sum; try { localStorage.setItem('vs_studio_check', JSON.stringify(sum).slice(0, 20000)); } catch (e) { /* storage optional */ }
      return sum;
    } finally {
      checkPaused = false; tuningNow = false; try { videoNativeW = els.video.videoWidth || videoNativeW; videoNativeH = els.video.videoHeight || videoNativeH; } catch (e) { /* ignore */ }
      try {   // v0.49: Studio Check puts the camera back on automatic; run the camera-control test again so a kept setting returns
        const cc = V.CameraControl, myStream = stream;
        if (cc && camTrack && running) setTimeout(() => { if (stream === myStream && running) cc.start({ track: camTrack, video: els.video, canRun: () => stream === myStream && running && !((recorder && recorder.state !== 'inactive') || liveActive) }); }, 1500);
      } catch (e) { /* optional */ }
    }
  };
  let batteryRef = null;
  try { if (navigator.getBattery) navigator.getBattery().then((b) => { batteryRef = b; }).catch(() => {}); } catch (e) {}
  setInterval(() => {
    if (!running) return;
    const action = window.VS.PerfProfile.decideSaver({ saverOn, level: batteryRef ? batteryRef.level : undefined, charging: batteryRef ? batteryRef.charging : undefined, pressure: window.__vsPressure });
    if (action === 'auto-throttle') setSaver(true, 'pressure');
    else if (action === 'suggest-saver') setPerfBanner('saver-suggest', 'Battery is under 20%. Battery saver keeps you at about 20 frames per second and runs cooler.', 'Turn on Battery saver', () => { setSaver(true, 'manual'); hidePerfBanner(); });
  }, 5000);
  window.VS = window.VS || {};
  window.VS.diagState = function () {
    const t = window.__vsT || {};
    const cov = segProvider && segProvider.lastCoverage;
    const impl = segProvider && segProvider.impl;
    return {
      engine: segProvider ? (segProvider.current || segProvider.label) : null,
      delegate: impl && impl.gpu !== undefined ? (impl.gpu ? 'GPU' : 'CPU') : (segProvider && segProvider.backend) || null,
      coveragePct: cov == null ? null : Math.round(cov * 1000) / 10,
      maskSize: lastMaskSize,
      segMs: segMsEma ? Math.round(segMsEma * 10) / 10 : null,
      renderMs: lastRenderMs,
      fps: running ? recentFps : null,
      dropped: droppedFrames,
      batterySaver: saverOn,
      camera: (window.__camSettings || 'n/a') + ' | measured camera delivery ' + camRate + ' fps',
      stages: 'seg ' + Math.round(segMsEma) + ' | bitmaps ' + Math.round(stg.bmp) + ' | render wait ' + Math.round(stg.rend) + ' | frame total ' + Math.round(stg.frame) + ' | loop period ' + Math.round(stg.period) + ' | inference on ' + Math.round(stg.infRatio * 100) + '% of frames | stride ' + segStride + ' | quality ' + runningQuality + ' | out ' + outW + 'x' + outH + ' | video ' + videoNativeW + 'x' + videoNativeH,
      loopMode: loopMode + (HAS_RVFC ? ' [rVFC ' + rvfcFired + ' / guard ' + rvfcGuard + ']' : ''),
      rvfcFired, rvfcGuard, usingRvfc: useRvfc,
      seat: sceneState && sceneState.enabled && sceneState.seat ? ('guide ' + seatAlign + ' | light ' + seatLight + ' | pose reported: ' + (seatPose ? seatPose.status : 'n/a') + ' | live: ' + (seatPose && seatPose.dbg ? seatPose.dbg : 'n/a')) : null,
      msToCamera: t.cameraVisible && t.camStart ? Math.round(t.cameraVisible - t.camStart) : null,
      msToCutout: t.cutoutVisible && t.camStart ? Math.round(t.cutoutVisible - t.camStart) : null,
    };
  };
  let lastMaskSize = null;

  // First-run self check: after the cutout has run ~4 s, record whether a sane person mask was seen,
  // so the Diagnostics report (and a calm toast) tell the user what is going on. Live frames only; the
  // synthetic warm-up frame inside the engine already proves the engine answers.
  let selfCheckTimer = null;
  function scheduleSelfCheck() {
    clearTimeout(selfCheckTimer);
    let done = null; try { done = localStorage.getItem('vs_selfcheck'); } catch (e) {}
    if (done && done.indexOf('OK') === 0) return; // only re-check until it has passed once on this device
    selfCheckTimer = setTimeout(() => {
      const d = window.VS.diagState();
      const ok = d.coveragePct != null ? d.coveragePct > 2 : running;
      const msg = (ok ? 'OK' : 'NO PERSON SEEN') + ' · engine ' + d.engine + ' · coverage ' + d.coveragePct + '% · ' + (d.segMs || '?') + ' ms · ' + new Date().toISOString().slice(0, 16);
      try { localStorage.setItem('vs_selfcheck', msg); } catch (e) {}
      if (!ok && !noPersonMode && !repairingMask) {
        showMaskBanner('No person detected yet. Step into the frame or add light. If this stays, open Diagnostics (tap the logo 5 times) and copy the report.');
      }
    }, 4000);
  }
  // ---- Mask watchdog: never show an empty scene ----
  // Some phone GPUs make the segmentation model return an empty/wrong mask. If the mask stays empty for a few
  // seconds we (1) switch to the next engine, and (2) if none helps, show the real camera with an explanation,
  // instead of a scene with nobody in it.
  let emptyRun = 0, repairingMask = false, noPersonMode = false, backendConfirmed = false;
  const passCanvas = document.createElement('canvas');
  passCanvas.width = 4; passCanvas.height = 4;
  { const pc = passCanvas.getContext('2d'); pc.fillStyle = '#fff'; pc.fillRect(0, 0, 4, 4); }
  function showMaskBanner(text) {
    perfBannerShown = false; perfBannerKey = '';
    els.degradeBanner.classList.add('show');
    els.degradeBanner.textContent = text;
  }
  function clearMaskBanner() { if (noPersonMode || repairingMask) return; if (/^(No person|Switched|Fixing)/.test(els.degradeBanner.textContent || '')) els.degradeBanner.classList.remove('show'); }
  function maskWatchdog() {
    const cov = segProvider && segProvider.lastCoverage;
    if (cov === null || cov === undefined) return;
    if (cov < 0.004) {
      emptyRun++;
    } else if (cov > 0.02) {
      emptyRun = 0;
      if (noPersonMode) { noPersonMode = false; els.degradeBanner.classList.remove('show'); }
      if (!backendConfirmed && segProvider.confirmBackend) { backendConfirmed = true; segProvider.confirmBackend(); }
    }
    if (emptyRun >= 45 && !repairingMask && !noPersonMode) {
      repairingMask = true;
      if (window.__vsT) window.__vsT.watchdogFired = performance.now();
      showMaskBanner('Fixing the camera cutout...');
      (async () => {
        let next = null;
        try { next = segProvider.repair ? await segProvider.repair() : null; } catch (e) { next = null; }
        if (next) {
          emptyRun = 0; resetSegCache(); updateStudioChrome();
          if (window.__vsT) window.__vsT.repairedTo = next;
          showMaskBanner('Switched to compatibility mode (' + next + ').');
          setTimeout(clearMaskBanner, 4000);
        } else {
          noPersonMode = true;
          if (window.__vsT) window.__vsT.noPerson = true;
          showMaskBanner('No person detected. Showing your camera. Step into the frame or add light, and the cutout returns on its own.');
        }
        repairingMask = false;
      })();
    }
  }
  // v0.49 Phase 2 pairing audit: which camera frame the mask was computed from vs which frame the person image was copied from.
  // skew = personFrame - maskFrame (0 = same frame). Cheap (two counters per tick); shown in Diagnostics.
  const pairLog = [];
  function camFrames() { try { const q = els.video.getVideoPlaybackQuality && els.video.getVideoPlaybackQuality(); return q ? q.totalVideoFrames : null; } catch (e) { return null; } }
  function notePair(maskFrame, personFrame) {
    if (maskFrame == null || personFrame == null) return;
    pairLog.push(personFrame - maskFrame); if (pairLog.length > 150) pairLog.shift();
  }
  window.VS.pairStats = function () {
    const a = pairLog.slice().sort((x, y) => x - y), n = a.length; if (!n) return null;
    return { n, mean: +(a.reduce((s, v) => s + v, 0) / n).toFixed(2), max: a[n - 1], p95: a[Math.min(n - 1, Math.floor(n * 0.95))], zeroPct: Math.round(100 * a.filter((v) => v === 0).length / n) };
  };
  window.VS.pairReset = function () { pairLog.length = 0; };

  async function processLoop() {
    if (!running) return;
    if (checkPaused) { scheduleNext(); return; }   // Studio Check owns the CPU/GPU while it measures
    if (!renderHealthy) return; // worker crashed fatally — stop hammering a dead worker; see 'fatal' handler above for why this can't self-recover
    const myLoop = loopToken;
    const frameStart = performance.now();
    // v0.13 Battery saver: cap the loop rate. Skipped ticks cost almost nothing.
    if (saverOn && lastLoopAt && frameStart - lastLoopAt < window.VS.PerfProfile.SAVER_FRAME_MS - 4) { requestAnimationFrame(processLoop); return; }
    lastLoopAt = frameStart;
    if (stg.prevStart) stg.period = ema(stg.period, frameStart - stg.prevStart);
    stg.prevStart = frameStart;

    // v0.49 Phase 2: MASK/FRAME PAIRING. The model reads the camera frame the instant segment() is called, but it answers some tens of
    // milliseconds later. The person image used to be copied from the video AFTER that answer, so it came from a NEWER frame than the mask
    // (1-2 frames on a phone, more under load): the cut-out lagged behind a moving person = cracks. Now the person copy is started here, in the
    // same JS turn as the model's read, so both come from the same camera frame. (createImageBitmap(video) snapshots the frame at call time.)
    const w = outW, h = outH;
    const crop = compositionEngine.computeFrame(videoNativeW || w, videoNativeH || h, Math.max(w, h));
    const sampleFrame = camFrames();
    const personP = createImageBitmap(els.video, crop.sx, crop.sy, crop.sw, crop.sh, { resizeWidth: w, resizeHeight: h, resizeQuality: 'medium' });
    personP.catch(() => {});                                   // a failure is handled where it is awaited below; never an unhandled rejection
    const dropPerson = () => { personP.then((b) => b.close()).catch(() => {}); };   // every early exit must release the copy

    // Extra-light (FAST only, auto-engaged by checkGracefulDegrade): once a
    // mask is cached, the model runs on 1 of every `segStride` frames; the
    // frames between reuse that mask against a FRESH camera image, so the
    // picture stays live and only the cutout edge refreshes less often.
    let runInference = true;
    if (segStride > 1 && cachedMaskBitmap) runInference = (strideTick++ % segStride) === 0;

    let results = null, maskFrame = null;
    if (runInference) {
      const segStart = performance.now(); maskFrame = camFrames();
      try {
        results = await segProvider.segment(els.video);
      } catch (err) {
        dropPerson();
        if (myLoop !== loopToken) return; // stopped/restarted while waiting — whoever restarted owns the loop now
        els.statsEl.textContent = 'Segmentation error: ' + err.message;
        scheduleNext();
        return;
      }
      if (myLoop !== loopToken) { dropPerson(); return; }
      const segMs = performance.now() - segStart;
      if (results && results.segmentationMask) lastMaskSize = (results.segmentationMask.width || '?') + 'x' + (results.segmentationMask.height || '?');
      segMsEma = segMsEma ? segMsEma * 0.8 + segMs * 0.2 : segMs;
      maskWatchdog();
    }

    // Which mask image to crop from. Normally the model's own output; in
    // extra-light mode, an ImageBitmap copy that THIS code owns — a skipped
    // frame can't lean on the model's output canvas, which MediaPipe is free
    // to redraw or clear between calls. The copy is full-size (no crop) so the
    // crop rectangle below means the same thing for both sources.
    let maskSource;
    if (segStride > 1) {
      if (results) {
        try {
          const fresh = await createImageBitmap(results.segmentationMask);
          if (myLoop !== loopToken) { fresh.close(); dropPerson(); return; }
          if (cachedMaskBitmap) cachedMaskBitmap.close();
          cachedMaskBitmap = fresh;
        } catch (err) { /* keep whatever cached mask we already have */ }
      }
      maskSource = cachedMaskBitmap;
      if (!maskSource) { dropPerson(); scheduleNext(); return; }
    } else {
      maskSource = results.segmentationMask;
    }

    // The crop (zoom/pan) AND the resize to final output dimensions both
    // happen right here, inside createImageBitmap — genuinely off the main
    // thread's synchronous draw path (the browser decodes/scales these
    // independently), instead of via a personCtx.drawImage() the way this
    // used to work. What comes out is already exactly what the worker needs.
    // The crop rectangle is in CAMERA pixels, but the model's mask can be a different
    // size (MODNet / RVM output a small mask). Convert the rectangle into mask pixels,
    // otherwise the crop lands outside the mask and the whole frame comes out blank.
    const mSrcW = maskSource.width || videoNativeW || w;
    const mSrcH = maskSource.height || videoNativeH || h;
    const kx = mSrcW / (videoNativeW || mSrcW);
    const ky = mSrcH / (videoNativeH || mSrcH);
    const mcx = Math.min(Math.max(0, Math.round(crop.sx * kx)), Math.max(0, mSrcW - 1));
    const mcy = Math.min(Math.max(0, Math.round(crop.sy * ky)), Math.max(0, mSrcH - 1));
    const mcrop = {
      sx: mcx,
      sy: mcy,
      sw: Math.max(1, Math.min(Math.round(crop.sw * kx), mSrcW - mcx)),
      sh: Math.max(1, Math.min(Math.round(crop.sh * ky), mSrcH - mcy)),
    };
    let personBitmap, maskBitmap;
    const tB0 = performance.now(); if (runInference && !noPersonMode) notePair(maskFrame, sampleFrame);
    try {
      [personBitmap, maskBitmap] = await Promise.all([
        // Sourced from the live video element itself, NOT results.image: when
        // the low-light boost (segmentation-provider.js) is active, results.image
        // is the brightened copy that was fed to the model for a better mask —
        // the person's actual on-screen/recorded appearance should never
        // silently change because the room was dark.
        personP,   // v0.49: copied at tick start from the same camera frame the model read (see above)
        noPersonMode
          ? createImageBitmap(passCanvas, { resizeWidth: 64, resizeHeight: 36 })   // fully opaque mask = show the camera as is
          : createImageBitmap(maskSource, mcrop.sx, mcrop.sy, mcrop.sw, mcrop.sh, { resizeWidth: Math.min(w, 640), resizeHeight: Math.max(1, Math.round(h * Math.min(w, 640) / w)), resizeQuality: 'medium' }),
      ]);
      pipeFailCount = 0;
      stg.bmp = ema(stg.bmp, performance.now() - tB0);
    } catch (err) {
      // Never fail silently: a blank preview with no message is the worst outcome.
      pipeFailCount++; dropPerson();   // release the person copy if only the mask copy failed
      if (pipeFailCount >= 5) els.statsEl.textContent = 'Frame error: ' + (err && err.message ? err.message : err);
      scheduleNext();
      return;
    }
    if (myLoop !== loopToken) { personBitmap.close(); maskBitmap.close(); return; }

    // Arm the frame-done listener BEFORE dispatching: in localCore mode,
    // dispatch() resolves this synchronously, in the same call — if the
    // promise weren't armed yet, that resolution would be silently missed
    // and frameDonePromise() below would then wait the full timeout for an
    // event that already happened.
    // v0.46 pipeline: at most ONE render in flight. We only wait for the PREVIOUS frame's render here, so the
    // camera frame N+1 is segmented while frame N is still drawing in the worker (they use different resources).
    if (prevRender) { await prevRender; if (myLoop !== loopToken) { personBitmap.close(); maskBitmap.close(); return; } }
    const thisFrameToken = ++frameToken;
    const framePromise = frameDonePromise(thisFrameToken);
    rendererSend({ type: 'frame', token: thisFrameToken, personBitmap, maskBitmap, w, h }, [personBitmap, maskBitmap]);

    // Live screen-share overlays: grab one frame per tick from each shared
    // stream's hidden <video> and hand it to the worker through the exact
    // same overlaySlides message a static deck uses (a 1-page "deck" that
    // gets replaced every frame). No separate live-video code path in the
    // worker at all. Best-effort — a share that hasn't produced a frame yet
    // just gets skipped this tick rather than erroring the whole loop.
    liveOverlays.forEach((live, id) => {
      if (live.videoEl.readyState < 2) return; // HAVE_CURRENT_DATA
      createImageBitmap(live.videoEl).then((bitmap) => {
        rendererSend({ type: 'overlaySlides', id, slides: [bitmap] }, [bitmap]);
      }).catch(() => {}); // a share ending mid-capture races this; next tick just skips it
    });

    const tR0 = performance.now();
    prevRender = framePromise.then((outcome) => {
      stg.rend = ema(stg.rend, performance.now() - tR0); // pace the loop to the render's actual draw completion, same as the old synchronous version did
      if (myLoop !== loopToken) return;

      if (outcome === 'timeout') {
        consecutiveStalls++; droppedFrames++;
        if (consecutiveStalls === 3) {
          // Report once per episode, not every stalled frame — a real network/
          // GC hiccup can cause one or two late frames without being a crash;
          // 3 in a row is the honest line between "hiccup" and "actually stuck".
          window.VS.reportError('The render pipeline is stalling (frames aren\u2019t completing in time)');
          if (liveActive) setLiveStatus('error', 'Render is stalling — live output may be choppy or frozen.');
        }
        return; // skip this frame's guide-draw/FPS bookkeeping; it never actually rendered
      }
      consecutiveStalls = 0;
      lastRenderMs = Math.round((performance.now() - frameStart) * 10) / 10;
      stg.frame = ema(stg.frame, performance.now() - frameStart);
      totalFrames++;
      stg.infRatio = ema(stg.infRatio, runInference ? 1 : 0);
      maybeReveal();

      compositionEngine.drawGuides(guideCtx, w, h);
      drawSceneGuide(guideCtx, w, h);

      frameCount++;
      const now = performance.now();
      const latency = (now - frameStart).toFixed(1);
      if (now - lastFpsTime >= 1000) {
        recentFps = Math.round((frameCount * 1000) / (now - lastFpsTime));
        const boostNote = segProvider.lastBoostApplied ? ' | Low-light boost: active' : '';
        const liteNote = runningQuality === 'fast' ? ' | FAST: lite pipeline' : '';
        const strideNote = segStride > 1 ? ` | Mask refresh: 1 in ${segStride} frames` : '';
        const lightNote = window.VS.LightMeter && window.VS.LightMeter.note() ? ' | ' + window.VS.LightMeter.note() : '';
        els.statsEl.textContent = `FPS: ${recentFps} | Frame latency: ${latency} ms | Provider: ${segProvider.label}${boostNote}${liteNote}${strideNote}${lightNote}`;
        updateStudioChrome();
        frameCount = 0;
        lastFpsTime = now;
        checkGracefulDegrade();
      }
    });
    scheduleNext(); // next camera frame starts now, while this one finishes rendering
  }

  // ------------------------------------------------------------
  // Graceful degrade. The RULES (which action, when) live in
  // PerfProfile.decideDegradeAction so they're unit-tested; this is only the
  // wiring that applies the answer and words it honestly.
  // ------------------------------------------------------------
  const LOW_FPS_FLOOR = 15;

  function hidePerfBanner() {
    els.degradeBanner.classList.remove('show');
    perfBannerShown = false;
    perfBannerKey = '';
  }

  // Rebuilt only when `key` changes: this runs once a second, and tearing
  // down the button under someone's finger mid-tap would eat the click.
  // Always dismissible — a diagnostic message that can't be closed and
  // sits over the live preview is worse than not showing it: it blocks the
  // one thing (the actual composited face) the person opened this for.
  // Dismissing just hides it; it can reappear later under a new key (a
  // different perf state), or the same key after `perfBannerDismissedUntil`.
  function setPerfBanner(key, message, actionLabel, onAction) {
    if (noPersonMode || repairingMask) return;   // the "no person / fixing the cutout" message is more important
    perfBannerShown = true;
    if (perfBannerKey === key && performance.now() < (perfBannerDismissedUntil || 0)) return;
    if (perfBannerKey === key && els.degradeBanner.classList.contains('show')) return;
    perfBannerKey = key;
    els.degradeBanner.textContent = '';
    const closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.className = 'toast-close';
    closeBtn.setAttribute('aria-label', 'Dismiss');
    closeBtn.textContent = '\u00d7';
    closeBtn.addEventListener('click', () => {
      perfBannerDismissedUntil = performance.now() + 15000; // stay quiet 15s even if the same condition persists
      hidePerfBanner();
    });
    els.degradeBanner.appendChild(closeBtn);
    els.degradeBanner.appendChild(document.createTextNode(message));
    if (actionLabel) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'btn primary sm';
      btn.style.cssText = 'display:block; margin-top:8px;';
      btn.textContent = actionLabel;
      btn.addEventListener('click', onAction);
      els.degradeBanner.appendChild(btn);
    }
    els.degradeBanner.classList.add('show');
  }

  // Stops the camera and restarts it in FAST. That ends any recording or live
  // stream (stopCamera always does), so it's refused while either is active —
  // the banner doesn't offer the button in that state, this is the backstop.
  async function switchToFastMode() {
    if (switchingMode || !running) return;
    if ((recorder && recorder.state !== 'inactive') || liveActive) return;
    switchingMode = true;
    try {
      hidePerfBanner();
      stopCamera();
      els.qualitySelect.value = 'fast';
      renderQualitySegControl();
      await startCamera();
    } finally {
      switchingMode = false;
    }
  }

  function checkGracefulDegrade() {
    if (recentFps < LOW_FPS_FLOOR) {
      consecutiveLowFps++;
    } else {
      consecutiveLowFps = 0;
      // Only hide a banner THIS function put up. The old unconditional hide
      // also erased "camera feed lost" / "render crashed" a second after
      // they appeared, because the loop keeps hitting 60 FPS on a frozen frame.
      if (perfBannerShown && performance.now() >= perfBannerHoldUntil) hidePerfBanner();
    }
    if (consecutiveLowFps < 3) return;

    const busy = (recorder && recorder.state !== 'inactive') || liveActive;
    const action = window.VS.PerfProfile.decideDegradeAction({
      quality: runningQuality, stride: segStride, fps: recentFps, segMs: segMsEma,
    });

    if (action === 'suggest-fast') {
      setPerfBanner(
        busy ? 'suggest-busy' : 'suggest-idle',
        `Sustained low FPS (${recentFps}). FAST mode uses a lighter pipeline built for this.` +
          (busy ? ' Stop your recording or live stream first \u2014 switching restarts the camera.' : ''),
        busy ? null : 'Switch to FAST',
        switchToFastMode
      );
    } else if (action === 'engage-stride') {
      return; // v0.45: disabled, skipping mask updates caused edge lag; the camera is the real ceiling
      segStride = window.VS.PerfProfile.MAX_STRIDE;
      consecutiveLowFps = 0;
      perfBannerHoldUntil = performance.now() + 6000; // keep this explanation up even if FPS recovers instantly
      setPerfBanner(
        'stride',
        'Still slow in FAST, so the cutout now refreshes on every other frame. Your picture stays live at full frame rate; ' +
          'only the edge updates half as often, so fast movement may show a slightly trailing edge.'
      );
    } else if (action === 'no-stride-help' || action === 'ceiling') {
      if (!window.__ceilingNoted) { window.__ceilingNoted = true; showBenchNote('Camera/phone is the speed limit here (' + recentFps + ' fps). Face a window or lamp: a brighter room often lets the camera run faster.'); }
    } else if (false) {
      setPerfBanner(
        'no-stride-help',
        `Still under ${LOW_FPS_FLOOR} FPS in FAST, but the segmentation model isn't what's slowing things down ` +
          `(that points at rendering or the camera itself), so skipping mask updates wouldn't help. Try closing other tabs and apps.`
      );
    } else {
      setPerfBanner(
        'ceiling',
        `Sustained low FPS (${recentFps}) even in FAST with reduced mask updates. This is likely this device's ceiling for the free local model.`
      );
    }
  }

  function updateCostInfo() {
    els.costEl.textContent = segProvider
      ? `Active provider: ${segProvider.label} — cost per frame: $${segProvider.costPerFrame.toFixed(4)} (local processing, no cloud bill)`
      : '';
  }

  // ============================================================
  // Recording — single toggle control with live states
  // ============================================================
  function formatTime(ms) {
    const totalSec = Math.floor(ms / 1000);
    const m = Math.floor(totalSec / 60);
    const s = totalSec % 60;
    return `${m}:${String(s).padStart(2, '0')}`;
  }

  // The audio track recording/streaming should use: processed by the chain when it is running, else the raw mic.
  function outAudioTrack() {
    const ch = window.VS.audioChain;
    try { if (ch) { const t = ch.outputTrack(); if (t) return t; } } catch (e) {}
    return stream && stream.getAudioTracks()[0];
  }
  // Browsers keep an AudioContext suspended until a tap; resume on the first interaction so the chain works after auto-start too.
  ['pointerdown', 'keydown'].forEach((ev) => document.addEventListener(ev, () => { if (window.VS.audioChain) window.VS.audioChain.resume(); }, { passive: true }));

  function startRecording() {
    if (window.VS.audioChain) window.VS.audioChain.resume();
    try {
      if (navigator.storage && navigator.storage.estimate) navigator.storage.estimate().then((e) => {
        const free = (e.quota || 0) - (e.usage || 0);
        if (e.quota && free < 300 * 1024 * 1024) {
          els.degradeBanner.classList.add('show');
          els.degradeBanner.textContent = 'Low storage on this device (about ' + Math.max(0, Math.round(free / 1048576)) + ' MB free for Genesis). Long recordings may fail to save. Free some space first.';
        }
      }).catch(() => {});
    } catch (e) {}
    const fps = parseInt(els.framerateSelect.value, 10) || 30;
    // v0.46 even cadence: capture on a fixed clock (repeating the last frame if a render is late) instead of whenever the
    // canvas happens to change, so a 10-15 fps render still records as a steady 'fps' video without judder.
    // v0.49 Phase 2 (measured: v0.46's requestFrame() on the live canvas only emitted when the canvas CHANGED, so a 2-15 fps render recorded as a
    // 2-15 fps file with long gaps). Fix: record from a separate canvas that a drift-corrected clock re-draws from the live canvas on every tick
    // and then requestFrame()s. A re-draw counts as a change, so a frame is emitted every tick (the last picture repeats while the render is late).
    // A late tick is skipped, never queued, so there are no bursts. Falls back to the old capture if the live canvas cannot be copied.
    if (window.__recClockStop) { try { window.__recClockStop(); } catch (e) {} }
    let canvasStream = null, recVT = null;
    try {
      const recCanvas = document.createElement('canvas'); recCanvas.width = els.canvas.width; recCanvas.height = els.canvas.height;
      const recCtx = recCanvas.getContext('2d', { alpha: false }); recCtx.drawImage(els.canvas, 0, 0);       // throws if this canvas cannot be copied
      canvasStream = recCanvas.captureStream(0); recVT = canvasStream.getVideoTracks()[0];
      if (!recVT || !recVT.requestFrame) throw new Error('requestFrame unavailable');
      const period = 1000 / fps; let nextAt = performance.now() + period, stopped = false, timer = 0;
      const clk = window.VS.recClock = { fps, ticks: 0, late: 0, maxLateMs: 0, resyncs: 0, copyMs: 0, copyMaxMs: 0, startedAt: performance.now() };   // how late the clock really fires (shown in Diagnostics)
      const tick = () => {
        if (stopped) return;
        const lateBy = performance.now() - nextAt; clk.ticks++; if (lateBy > period) clk.late++; if (lateBy > clk.maxLateMs) clk.maxLateMs = Math.round(lateBy);
        try {
          if (recCanvas.width !== els.canvas.width || recCanvas.height !== els.canvas.height) { recCanvas.width = els.canvas.width; recCanvas.height = els.canvas.height; }
          const c0 = performance.now(); recCtx.drawImage(els.canvas, 0, 0); recVT.requestFrame(); const cm = performance.now() - c0; clk.copyMs = clk.copyMs ? Math.round((clk.copyMs * 0.9 + cm * 0.1) * 10) / 10 : Math.round(cm * 10) / 10; if (cm > clk.copyMaxMs) clk.copyMaxMs = Math.round(cm);
        } catch (e) { /* skip this tick */ }
        const now = performance.now(); nextAt += period; if (nextAt < now - period) { nextAt = now; clk.resyncs++; }                // far behind: resync, do not burst
        timer = setTimeout(tick, Math.max(0, nextAt - now));
      };
      timer = setTimeout(tick, period);
      window.__recClockStop = () => { stopped = true; clearTimeout(timer); window.__recClockStop = null; };
    } catch (e) {
      try { if (canvasStream) canvasStream.getTracks().forEach((t) => t.stop()); } catch (e2) {}
      canvasStream = els.canvas.captureStream(0); recVT = canvasStream.getVideoTracks()[0];                    // v0.46 behaviour
      if (recVT && recVT.requestFrame) { window.__recClockStop = (function (id) { return () => { clearInterval(id); window.__recClockStop = null; }; })(setInterval(() => { try { recVT.requestFrame(); } catch (e3) {} }, Math.round(1000 / fps))); }
      else { canvasStream.getTracks().forEach((t) => t.stop()); canvasStream = els.canvas.captureStream(fps); }
    }
    const audioTrack = outAudioTrack();
    if (audioTrack) canvasStream.addTrack(audioTrack);

    recordedChunks = [];
    // v0.13: pick a format this browser can really record (VP9 webm throws on iPhone Safari and some Androids).
    const recMime = window.VS.pickRecorderMime();
    const recOpts = { videoBitsPerSecond: parseInt(els.bitrateSelect.value, 10) || 8000000 };
    if (recMime) recOpts.mimeType = recMime;
    try { recorder = new MediaRecorder(canvasStream, recOpts); }
    catch (e1) {
      try { recorder = new MediaRecorder(canvasStream); }
      catch (e2) {
        recorder = null;
        perfBannerShown = false; perfBannerKey = '';
        els.degradeBanner.classList.add('show');
        els.degradeBanner.textContent = 'This browser cannot record video. Try the latest Chrome or Edge. Your camera and preview are unaffected.';
        if (window.VS.logError) window.VS.logError('MediaRecorder unavailable: ' + (e2 && e2.message));
        return;
      }
    }
    const recType = recorder.mimeType || recMime || 'video/webm';
    const extras = window.VS.RecExtras ? window.VS.RecExtras.begin(els.canvas, audioTrack, () => performance.now() - recordStartTime) : null;   // markers, thumbnail, audio-only file
    // Crash-safe autosave, append-only: every chunk (2 s) is written on its own, so a crash loses at most the last couple of seconds
    // and the cost per write stays constant however long the recording gets.
    let draftSession = null, chunkIndex = 0, draftWarned = false;
    window.VS.storage.startDraft({ environment: els.envSelect.value, quality: els.qualitySelect.value, savedAt: new Date().toLocaleString() }, recType)
      .then((id) => { draftSession = id; }).catch(() => { warnDraft(); });
    function warnDraft() {
      if (draftWarned) return; draftWarned = true;
      els.degradeBanner.classList.add('show');
      els.degradeBanner.textContent = 'Recording is running, but crash protection is off because this device is low on storage. Free some space if you can. Stop and save soon.';
    }
    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) {
        recordedChunks.push(e.data);
        const idx = chunkIndex++;
        const tryWrite = () => window.VS.storage.appendDraftChunk(draftSession, idx, e.data).catch(() => warnDraft());
        if (draftSession) tryWrite(); else setTimeout(() => { if (draftSession) tryWrite(); }, 400);
      }
    };
    recorder.onstop = async () => {
      if (window.__recClockStop) { try { window.__recClockStop(); } catch (e) {} }
      const blob = new Blob(recordedChunks, { type: recType });
      const ts = new Date().toLocaleString();
      const cues = stopCaptionsIfNeeded(); // safe no-op if captions were never started for this session
      let ex = {}; try { ex = extras ? await extras.finish() : {}; } catch (e) {} window.VS.recLive = null;
      await window.VS.storage.saveRecording(blob, {
        createdAt: ts,
        environment: els.envSelect.value,
        quality: els.qualitySelect.value,
        aspect: compositionEngine.aspectId,
        fps,
        bitrate: parseInt(els.bitrateSelect.value, 10),
        captions: cues && cues.length ? cues : undefined,
        thumb: ex.thumb || undefined, markers: ex.markers && ex.markers.length ? ex.markers : undefined,
      });
      window.VS.storage.clearDraft().catch(() => {});

      const url = URL.createObjectURL(blob);
      const item = document.createElement('div');
      item.className = 'recording-item';
      item.innerHTML = `<span>Saved &mdash; ${ts}</span>`;
      const link = document.createElement('a');
      link.href = url;
      link.download = `genesis-${Date.now()}.${window.VS.extForMime(recType)}`;
      link.textContent = 'Download';
      item.appendChild(link);
      if (window.VS.RecExtras) window.VS.RecExtras.decorate(item, ex);
      if (window.VS.Trim) window.VS.Trim.attach(item, blob, async (nb, nt, meta) => {   // trimmed copy: saved as its own recording, original untouched
        try { await window.VS.storage.saveRecording(nb, { createdAt: new Date().toLocaleString(), environment: els.envSelect.value, quality: els.qualitySelect.value, aspect: compositionEngine.aspectId, fps, bitrate: parseInt(els.bitrateSelect.value, 10), trimmedFrom: meta.trimmedFrom }); } catch (e) {}
        const it2 = document.createElement('div'); it2.className = 'recording-item'; it2.innerHTML = '<span>Trimmed copy</span>'; const l2 = document.createElement('a'); l2.href = URL.createObjectURL(nb); l2.download = 'genesis-trim-' + Date.now() + '.' + window.VS.extForMime(nt); l2.textContent = 'Download'; it2.appendChild(l2); item.after(it2);
      });
      if (window.VS.RenderUI) window.VS.RenderUI.attach(item, blob, async (nb) => {   // experimental AI copy: its own recording, original untouched
        try { await window.VS.storage.saveRecording(nb, { createdAt: new Date().toLocaleString(), environment: els.envSelect.value, title: 'AI re-render (experimental)', aspect: compositionEngine.aspectId }); } catch (e) {}
        const it3 = document.createElement('div'); it3.className = 'recording-item'; it3.innerHTML = '<span>AI re-render (experimental)</span>'; const l3 = document.createElement('a'); l3.href = URL.createObjectURL(nb); l3.download = 'genesis-ai-' + Date.now() + '.mp4'; l3.textContent = 'Download'; it3.appendChild(l3); els.recordingsList.prepend(it3);
      });
      els.recordingsList.prepend(item);

      els.recordBtn.classList.remove('recording');
    updateStudioChrome();
      els.recordBtn.classList.add('saved');
      els.recText.textContent = 'Saved';
      setTimeout(() => {
        els.recordBtn.classList.remove('saved');
        els.recText.textContent = 'Record';
      }, 1600);
    };
    recorder.start(2000); // 2s timeslice — enables periodic draft autosave, see ondataavailable above

    recordStartTime = performance.now();
    startCaptionsIfNeeded(() => (performance.now() - recordStartTime) / 1000);
    els.recTime.style.display = 'inline';
    els.recIndicator.classList.add('live');
    recordTimerInterval = setInterval(() => {
      const elapsed = performance.now() - recordStartTime;
      els.recTime.textContent = formatTime(elapsed);
      els.recIndicatorTime.textContent = 'REC ' + formatTime(elapsed);
    }, 250);

    els.recordBtn.classList.add('recording');
    updateStudioChrome();
    els.recText.textContent = 'Recording';
  }

  function stopRecording() {
    if (recorder && recorder.state !== 'inactive') recorder.stop();
    clearInterval(recordTimerInterval);
    els.recTime.style.display = 'none';
    els.recIndicator.classList.remove('live');
  }

  // ============================================================
  // Live captions — shared between recording AND live streaming (was
  // recording-only before this build: the "Live captions" toggle did
  // nothing if you went live without also hitting Record, which is a real
  // gap for a live-first product). Reference-counted so recording and a
  // live stream running at the same time share one SpeechRecognition
  // session instead of fighting over it.
  // ============================================================
  let captionsRefCount = 0;
  function captionsWanted() { return els.captionsToggle.checked && window.VS.CaptionsProvider.supported; }
  function startCaptionsIfNeeded(getElapsedSeconds) {
    if (!captionsWanted()) return;
    if (captionsRefCount === 0) {
      captionsProvider.reset();
      captionsProvider.onUpdate = (interim, cues) => {
        const last = cues[cues.length - 1];
        const text = interim || (last ? last.text : '');
        els.captionBar.textContent = text;
        els.captionBar.style.display = text ? 'block' : 'none';
      };
      captionsProvider.start(getElapsedSeconds);
    }
    captionsRefCount++;
  }
  function stopCaptionsIfNeeded() {
    if (captionsRefCount === 0) return [];
    captionsRefCount--;
    if (captionsRefCount <= 0) {
      captionsRefCount = 0;
      const cues = captionsProvider.stop();
      els.captionBar.style.display = 'none';
      els.captionBar.textContent = '';
      return cues;
    }
    return captionsProvider.cues.slice(); // another consumer (live/recording) still has it running
  }

  els.recordBtn.addEventListener('click', () => {
    if (els.recordBtn.disabled) return;
    if (recorder && recorder.state === 'recording') {
      stopRecording();
    } else {
      startRecording();
    }
  });

  // ============================================================
  // Live streaming (WHIP) — publishes the same composited canvas feed as
  // recording, live, over WebRTC. See js/providers/stream-provider.js for
  // exactly what "live" does and doesn't do yet.
  // ============================================================
  els.whipEndpointInput.value = localStorage.getItem('vs_whip_endpoint') || '';
  els.whipTokenInput.value = localStorage.getItem('vs_whip_token') || '';

  // v0.9 — Phase 3.5, RTMP fallback: browsers have no RTMP API at all (not
  // a missing feature, a hard platform wall — see MASTER_ROADMAP.md), so
  // Genesis can never publish RTMP directly. What it CAN do without any
  // new infra: (1) catch an rtmp:// URL pasted into the WHIP field
  // immediately, with a clear explanation, instead of letting it fail
  // later with a confusing network error; (2) generate the exact MediaMTX
  // runOnReady snippet from docs/LIVE_RELAY_SETUP.md so setting up the
  // free self-hosted WHIP→RTMP bridge doesn't require hand-writing YAML.
  function checkWhipSchemeError(rawUrl) {
    const url = (rawUrl || '').trim();
    if (!url) { els.whipSchemeError.style.display = 'none'; return false; }
    if (/^rtmps?:\/\//i.test(url)) {
      els.whipSchemeError.textContent = 'This is an RTMP URL, not WHIP. Browsers cannot speak RTMP directly — no client-side JS ever can. Use the "Generate the config" box below to bridge it through a free self-hosted relay instead.';
      els.whipSchemeError.style.display = 'block';
      return true;
    }
    if (!/^https?:\/\//i.test(url)) {
      els.whipSchemeError.textContent = 'WHIP endpoints are http(s):// URLs. Double-check what you pasted.';
      els.whipSchemeError.style.display = 'block';
      return true;
    }
    els.whipSchemeError.style.display = 'none';
    return false;
  }

  els.whipEndpointInput.addEventListener('input', () => checkWhipSchemeError(els.whipEndpointInput.value));

  els.saveWhipBtn.addEventListener('click', () => {
    localStorage.setItem('vs_whip_endpoint', els.whipEndpointInput.value.trim());
    localStorage.setItem('vs_whip_token', els.whipTokenInput.value.trim());
    els.goLiveBtn.disabled = !running || !els.whipEndpointInput.value.trim() || checkWhipSchemeError(els.whipEndpointInput.value);
    els.whipSaveMsg.textContent = 'Saved';
    setTimeout(() => { els.whipSaveMsg.textContent = ''; }, 1600);
  });

  // --- RTMP relay config generator (pure client-side templating; no
  // network call, no server component — see honesty note in studio.html) ---
  function updateRtmpFieldVisibility() {
    const mode = els.rtmpPlatformSelect.value;
    els.rtmpYoutubeKeyField.style.display = (mode === 'youtube' || mode === 'both') ? '' : 'none';
    els.rtmpTwitchKeyField.style.display = (mode === 'twitch' || mode === 'both') ? '' : 'none';
    els.rtmpCustomUrlField.style.display = (mode === 'custom') ? '' : 'none';
  }
  els.rtmpPlatformSelect.addEventListener('change', updateRtmpFieldVisibility);
  updateRtmpFieldVisibility();

  function buildRunOnReadyLines() {
    const mode = els.rtmpPlatformSelect.value;
    const lines = [];
    if (mode === 'youtube' || mode === 'both') {
      const key = els.rtmpYoutubeKeyInput.value.trim() || 'YOUR-YOUTUBE-STREAM-KEY';
      lines.push(`ffmpeg -i rtsp://localhost:$RTSP_PORT/$MTX_PATH -c copy -f flv rtmp://a.rtmp.youtube.com/live2/${key}`);
    }
    if (mode === 'twitch' || mode === 'both') {
      const key = els.rtmpTwitchKeyInput.value.trim() || 'YOUR-TWITCH-STREAM-KEY';
      lines.push(`ffmpeg -i rtsp://localhost:$RTSP_PORT/$MTX_PATH -c copy -f flv rtmp://live.twitch.tv/app/${key}`);
    }
    if (mode === 'custom') {
      const url = els.rtmpCustomUrlInput.value.trim() || 'rtmp://your-platform/app/your-stream-key';
      lines.push(`ffmpeg -i rtsp://localhost:$RTSP_PORT/$MTX_PATH -c copy -f flv ${url}`);
    }
    return lines;
  }

  els.generateRtmpConfigBtn.addEventListener('click', () => {
    const lines = buildRunOnReadyLines();
    // Multiple runOnReady lines is exactly how MediaMTX fans one WHIP feed
    // out to several RTMP targets — real, free multistreaming today, no
    // relay-tier or Phase 3 #2 infra needed for it.
    const runOnReadyBlock = lines.length > 1
      ? `runOnReady: >\n      ${lines[0]} &&\n      ${lines.slice(1).join(' &&\n      ')}`
      : `runOnReady: >\n      ${lines[0]}`;
    const snippet = [
      'paths:',
      '  genesis:',
      '    webrtcICEServers2:',
      '      - url: stun:stun.l.google.com:19302',
      '    ' + runOnReadyBlock.replace(/\n/g, '\n    '),
      '    runOnReadyRestart: yes',
      '',
      '# Paste this into mediamtx.yml next to the mediamtx binary, then run',
      '# ./mediamtx — full walkthrough: docs/LIVE_RELAY_SETUP.md',
    ].join('\n');
    els.rtmpConfigOutput.value = snippet;
    els.rtmpConfigOutputWrap.style.display = 'block';
    els.rtmpConfigCopyMsg.textContent = '';
  });

  els.copyRtmpConfigBtn.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(els.rtmpConfigOutput.value);
      els.rtmpConfigCopyMsg.textContent = 'Copied';
    } catch (e) {
      els.rtmpConfigOutput.select();
      els.rtmpConfigCopyMsg.textContent = 'Select all + Cmd/Ctrl-C (clipboard API unavailable)';
    }
    setTimeout(() => { els.rtmpConfigCopyMsg.textContent = ''; }, 2000);
  });

  // ============================================================
  // Go-live wizard — a walked-through UI over the same WHIP/RTMP fields
  // above (Phase 10: replaces the markdown relay guide as the primary
  // path; the raw fields still exist under "Advanced" for power users).
  // ============================================================
  (function setupLiveWizard() {
    const wizard = document.getElementById('liveWizard');
    if (!wizard) return;
    const steps = wizard.querySelectorAll('.wizard-step');
    let chosenDest = null;

    function showStep(name) {
      steps.forEach((s) => { s.style.display = (s.dataset.step === name) ? '' : 'none'; });
    }

    wizard.querySelectorAll('.wizard-choice').forEach((btn) => {
      btn.addEventListener('click', () => {
        chosenDest = btn.dataset.dest;
        if (chosenDest === 'whip') {
          showStep('2-whip');
        } else {
          els.rtmpPlatformSelect.value = chosenDest;
          els.wizardKeyLabel.textContent = chosenDest === 'youtube' ? 'YouTube stream key' : 'Twitch stream key';
          showStep('2-relay');
        }
      });
    });

    wizard.querySelectorAll('.wizard-back').forEach((btn) => {
      btn.addEventListener('click', () => showStep('1'));
    });
    wizard.querySelectorAll('.wizard-to-step3').forEach((btn) => {
      btn.addEventListener('click', () => showStep('3'));
    });
    if (els.wizardToStep3FromRelay) {
      els.wizardToStep3FromRelay.addEventListener('click', () => showStep('3'));
    }

    if (els.wizardGenerateBtn) {
      els.wizardGenerateBtn.addEventListener('click', () => {
        // Mirrors the key the wizard collected into the field the shared
        // buildRunOnReadyLines() reads from, so this doesn't duplicate the
        // config-generation logic — same output as the Advanced generator.
        if (chosenDest === 'youtube') els.rtmpYoutubeKeyInput.value = els.wizardStreamKey.value;
        if (chosenDest === 'twitch') els.rtmpTwitchKeyInput.value = els.wizardStreamKey.value;
        els.generateRtmpConfigBtn.click();
        els.wizardConfigOutput.value = els.rtmpConfigOutput.value;
        els.wizardConfigWrap.style.display = 'block';
      });
    }
    if (els.wizardCopyBtn) {
      els.wizardCopyBtn.addEventListener('click', async () => {
        try {
          await navigator.clipboard.writeText(els.wizardConfigOutput.value);
          els.wizardCopyMsg.textContent = 'Copied';
        } catch (e) {
          els.wizardConfigOutput.select();
          els.wizardCopyMsg.textContent = 'Select all + Cmd/Ctrl-C';
        }
        setTimeout(() => { els.wizardCopyMsg.textContent = ''; }, 2000);
      });
    }

    showStep('1');
  })();

  function setLiveStatus(status, detail) {
    els.liveStatus.style.display = 'flex';
    els.liveStatus.classList.remove('connecting', 'live', 'error', 'reconnecting');
    if (status === 'connecting') els.liveStatus.classList.add('connecting');
    else if (status === 'live') els.liveStatus.classList.add('live');
    else if (status === 'reconnecting') els.liveStatus.classList.add('reconnecting');
    else if (status === 'error') els.liveStatus.classList.add('error');
    els.liveStatusText.textContent = detail || status;

    if (status === 'live') {
      liveStartTime = performance.now();
      els.liveTime.style.display = 'inline';
      clearInterval(liveTimerInterval);
      liveTimerInterval = setInterval(() => {
        els.liveTime.textContent = formatTime(performance.now() - liveStartTime);
      }, 250);
    } else {
      clearInterval(liveTimerInterval);
      els.liveTime.style.display = 'none';
    }
    // A status change always supersedes whatever quality note was showing —
    // 'reconnecting'/'error' already say enough, and a fresh 'live' has no
    // stats yet (the monitor's first poll is ~3s out).
    els.liveQualityNote.style.display = 'none';
  }

  // Independent of connection status: the connection can be fully "live"
  // and still have a real problem (packet loss, a stalled send pipeline) —
  // see onQualityChange in stream-provider.js. This never touches the dot
  // or the Go Live/End Live button; it's a quieter, separate note.
  streamProvider.onQualityChange = (level, detail) => {
    if (level === 'degraded' && detail) {
      els.liveQualityNote.textContent = detail;
      els.liveQualityNote.style.display = 'block';
    } else {
      els.liveQualityNote.style.display = 'none';
    }
  };

  async function startLiveStream() {
    const endpoint = (localStorage.getItem('vs_whip_endpoint') || '').trim();
    const token = (localStorage.getItem('vs_whip_token') || '').trim();
    if (!endpoint) { setLiveStatus('error', 'No WHIP endpoint set — see the field above.'); return; }
    if (checkWhipSchemeError(endpoint)) { setLiveStatus('error', 'Ingest URL is not a valid WHIP endpoint — see the note above the Save button.'); return; }

    els.goLiveBtn.disabled = true;
    setLiveStatus('connecting', 'Connecting...');
    streamProvider.onStatusChange = (status, detail) => {
      setLiveStatus(status, detail);
      if (status === 'error' || status === 'stopped') {
        liveActive = false;
        els.goLiveBtn.textContent = 'Go Live';
        els.goLiveBtn.disabled = !running;
      }
      // 'connecting' and 'reconnecting' are both still "in progress" — keep
      // the button as "End Live" so a reconnect attempt in flight is never
      // mistaken for a dead session the person needs to restart by hand.
    };

    try {
      const fps = parseInt(els.framerateSelect.value, 10) || 30;
      liveStream = els.canvas.captureStream(fps); // independent from the recording captureStream() — both can run at once
      const audioTrack = outAudioTrack();
      if (audioTrack) liveStream.addTrack(audioTrack);
      const bitrate = parseInt(els.bitrateSelect.value, 10) || 8000000;

      const liveCapStart = performance.now();
      startCaptionsIfNeeded(() => (performance.now() - liveCapStart) / 1000);

      await streamProvider.start(liveStream, endpoint, token, bitrate);
      liveActive = true;
      els.goLiveBtn.textContent = 'End Live';
      els.goLiveBtn.disabled = false;
    } catch (err) {
      setLiveStatus('error', err.message);
      stopCaptionsIfNeeded(); // release the ref we took above — start() failed, nothing is actually live
      liveActive = false;
      els.goLiveBtn.textContent = 'Go Live';
      els.goLiveBtn.disabled = !running;
    }
  }

  async function stopLiveStream() {
    els.goLiveBtn.disabled = true;
    await streamProvider.stop();
    stopCaptionsIfNeeded();
    if (liveStream) { liveStream.getTracks().forEach(t => { if (t !== stream.getAudioTracks()[0] && t !== outAudioTrack()) t.stop(); }); liveStream = null; }
    liveActive = false;
    els.goLiveBtn.textContent = 'Go Live';
    els.goLiveBtn.disabled = !running;
  }

  els.goLiveBtn.addEventListener('click', () => {
    if (els.goLiveBtn.disabled) return;
    if (liveActive) { stopLiveStream(); return; }
    // M3 shot 8: the pre-live check decides first (blocks on real problems, asks once on warnings).
    const gate = window.VS.GoLive && window.VS.GoLive.gate;
    if (!gate) { startLiveStream(); return; }
    Promise.resolve().then(() => gate()).then((ok) => { if (ok) startLiveStream(); }, () => startLiveStream());
  });
  window.VS.liveApi = {
    facts: () => ({ running, endpoint: (localStorage.getItem('vs_whip_endpoint') || '').trim(), endpointOk: !checkWhipSchemeError(localStorage.getItem('vs_whip_endpoint') || ''), bitrate: parseInt(els.bitrateSelect.value, 10) || 8000000, fps: recentFps, outW, outH, recording: !!(recorder && recorder.state === 'recording'), audioTrack: outAudioTrack() }),
    onStats: (fn) => { streamProvider.onStats = fn; },
  };

  // ============================================================
  // Keyboard shortcut: Space toggles record/stop, same guard the button
  // uses. Ignored while a form field has focus so Settings-style inputs
  // elsewhere in the DOM never lose keystrokes to this.
  // ============================================================
  document.addEventListener('keydown', (e) => {
    const t = document.activeElement;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.key === ' ') {
      e.preventDefault();
      els.recordBtn.click();
    }
  });

  // ============================================================
  // Environment upload / generate
  // ============================================================
  els.uploadCardTrigger.addEventListener('click', () => els.uploadBg.click());

  els.uploadBg.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const img = new Image();
    img.onload = async () => {
      try {
        const id = await window.VS.StaticEnvironmentProvider.persistCustomImage(file.name, img);
        envProvider.addCustomImage(id, img, file.name);
        populateEnvironments();
        els.envSelect.value = id;
        renderEnvMiniGrid();
        pushEnvironment(id);
      } catch (err) {
        alert(err.message);
      }
    };
    img.src = URL.createObjectURL(file);
  });

  els.genBtn.addEventListener('click', async () => {
    const prompt = els.genPrompt.value.trim();
    if (!prompt) { alert('Describe the environment first.'); return; }
    els.genBtn.disabled = true;
    const original = els.genBtn.textContent;
    els.genBtn.textContent = 'Generating...';
    try {
      // Pollinations.ai: free, no API key, no account — a real generation call, not a mock.
      // Fetched as a blob (not a bare <img src>) so a CORS failure surfaces as a clear
      // error here instead of a confusing "tainted canvas" error later on save.
      // Swapping in a paid provider (Fal.ai/Replicate) later is a one-function change here.
      async function fetchGeneration(attempt) {
        const key = (window.VS && window.VS.config && window.VS.config.pollinationsApiKey || '').trim();
        // Seed must fit Pollinations' documented range (0…2147483647 / int32) — Date.now()
        // alone is ~1.7 trillion and gets rejected as "Query parameter validation failed".
        const seed = (Date.now() + attempt) % 2147483647;
        const params = `width=1280&height=720&seed=${seed}${key ? `&key=${encodeURIComponent(key)}` : ''}`;
        const apiPrompt = (els.genSceneMode && els.genSceneMode.checked && SceneEng) ? SceneEng.scenePrompt(prompt) : prompt;
        const url = `https://gen.pollinations.ai/image/${encodeURIComponent(apiPrompt)}?${params}`;
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 45000);
        try {
          return await fetch(url, { signal: controller.signal });
        } catch (e) {
          if (e.name === 'AbortError') throw new Error('Generation timed out after 45s. Pollinations.ai can be slow on first request — try again.');
          throw new Error('Could not reach Pollinations.ai. Check your connection and try again.');
        } finally {
          clearTimeout(timeout);
        }
      }
      let res = await fetchGeneration(0);
      if (!res.ok && res.status >= 500) {
        // Free, unauthenticated API — a server-side error here is on
        // Pollinations' end, not ours, and is often transient. One retry
        // after a short pause, not a fake success.
        await new Promise(r => setTimeout(r, 2500));
        res = await fetchGeneration(1);
      }
      if (!res.ok) {
        let serverMessage = '';
        try {
          const bodyText = await res.text();
          try {
            const parsed = JSON.parse(bodyText);
            serverMessage = (parsed && parsed.error && parsed.error.message) || (parsed && parsed.message) || '';
          } catch (_) {
            serverMessage = bodyText.slice(0, 200);
          }
        } catch (_) { /* body already consumed or unreadable — fall back to status only */ }
        const reason = res.status === 401
          ? `Pollinations.ai rejected the API key (HTTP 401)${serverMessage ? ': ' + serverMessage : ''}. Get a fresh key at enter.pollinations.ai/keys and paste it into js/config.js.`
          : res.status === 402
            ? `Pollinations.ai says this key is out of Pollen (HTTP 402)${serverMessage ? ': ' + serverMessage : ''}.`
            : res.status === 429
              ? 'Pollinations.ai is rate-limiting (the free key allows about 1 generation per hour) — wait a bit and try again.'
              : res.status >= 500
                ? `Pollinations.ai's server had an error (HTTP ${res.status}) after a retry — this is on their end, try again shortly.`
                : `Generation failed (HTTP ${res.status})${serverMessage ? ': ' + serverMessage : ''}. Try a different description.`;
        throw new Error(reason);
      }
      const blob = await res.blob();
      const objectUrl = URL.createObjectURL(blob);
      const img = new Image();
      await new Promise((resolve, reject) => {
        img.onload = resolve;
        img.onerror = () => reject(new Error('Received a response but it wasn\u2019t a valid image.'));
        img.src = objectUrl;
      });
      const id = await window.VS.StaticEnvironmentProvider.persistCustomImage(prompt.slice(0, 40), img);
      envProvider.addCustomImage(id, img, prompt.slice(0, 40));
      populateEnvironments();
      els.envSelect.value = id;
      renderEnvMiniGrid();
      pushEnvironment(id);
      if (els.genSceneMode && els.genSceneMode.checked && SceneEng) setSceneEnabled(true, id);
      els.genPrompt.value = '';
      URL.revokeObjectURL(objectUrl);
    } catch (err) {
      alert('Generation failed: ' + err.message);
    } finally {
      els.genBtn.disabled = false;
      els.genBtn.textContent = original;
    }
  });

  // ============================================================
  // Devices
  // ============================================================
  async function populateDevices() {
    const devices = await navigator.mediaDevices.enumerateDevices();
    const cams = devices.filter(d => d.kind === 'videoinput');
    const mics = devices.filter(d => d.kind === 'audioinput');

    const fill = (select, list, kind) => {
      const current = select.value;
      select.innerHTML = '<option value="">Default</option>';
      list.forEach((d, i) => {
        const opt = document.createElement('option');
        opt.value = d.deviceId;
        opt.textContent = d.label || `${kind} ${i + 1}`;
        select.appendChild(opt);
      });
      if (list.some(d => d.deviceId === current)) select.value = current;
    };
    fill(els.cameraSelect, cams, 'Camera');
    fill(els.micSelect, mics, 'Microphone');
  }

  // ============================================================
  // Focus mode
  // ============================================================
  function toggleFocusMode() {
    els.studioShell.classList.toggle('focus-active');
    els.studioBody.classList.toggle('focus-mode');
  }
  els.focusModeBtn.addEventListener('click', toggleFocusMode);

  // ============================================================
  // Tool rail tab switching
  // ============================================================
  els.toolRail.querySelectorAll('.tool-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      els.toolRail.querySelectorAll('.tool-tab').forEach(t => { t.classList.remove('active'); t.setAttribute('aria-selected', 'false'); });
      tab.classList.add('active');
      tab.setAttribute('aria-selected', 'true');
      document.querySelectorAll('.control-section').forEach(sec => sec.classList.remove('active'));
      document.getElementById(tab.dataset.target).classList.add('active');
    });
  });

  // fill tool-rail icons now that icons.js is loaded
  const TAB_ICONS = {
    'panel-env': 'environments',
    'panel-camera': 'video',
    'panel-composition': 'crop',
    'panel-realism': 'sparkles',
    'panel-refine': 'brush',
    'panel-captions': 'captions',
    'panel-templates': 'palette',
    'panel-quality': 'gauge',
    'panel-recordings': 'projects',
    'panel-advanced': 'sliders',
  };
  els.toolRail.querySelectorAll('.tool-tab').forEach(tab => {
    const label = tab.querySelector('.tab-label');
    const iconName = TAB_ICONS[tab.dataset.target] || 'sliders';
    tab.insertAdjacentHTML('afterbegin', ic(iconName, 19));
    if (label) tab.appendChild(label);
  });

  // fill panel section headings with icons too, for the same reason
  const HEADING_ICONS = {
    'Choose environment': 'environments', 'Custom background': 'upload', 'Create a world': 'sparkles',
    'Camera': 'video', 'Microphone': 'mic', 'Aspect ratio': 'crop', 'Zoom & pan': 'maximize', 'Guides': 'lens',
    'Make it believable': 'sparkles', 'Techniques': 'sliders', 'Compare': 'layers',
    'Edge refinement': 'sliders', 'Manual correction': 'brush', 'Live captions': 'captions',
    'Brand kit': 'palette', 'Save current setup': 'folder', 'Saved templates': 'layers',
    'Quality mode': 'gauge', 'Export': 'download', 'Saved on this device': 'folder', 'Diagnostics': 'alert',
  };
  document.querySelectorAll('.control-panel h3').forEach(h => {
    const key = h.textContent.replace(/Coming soon/i, '').trim();
    const name = HEADING_ICONS[key];
    if (name) h.insertAdjacentHTML('afterbegin', ic(name, 13));
  });

  // ============================================================
  // Framing panel — aspect ratio, zoom, pan, guides
  // ============================================================
  function renderAspectSegControl() {
    els.aspectSegControl.innerHTML = window.VS.CompositionEngine.listAspects().map(a => `
      <button type="button" class="seg-btn ${a.id === compositionEngine.aspectId ? 'active' : ''}" data-aspect="${a.id}" role="radio" aria-checked="${a.id === compositionEngine.aspectId}">
        <span class="seg-name">${a.label}</span><span class="seg-sub">${a.sub}</span>
      </button>`).join('');
    els.aspectSegControl.querySelectorAll('.seg-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        compositionEngine.setAspect(btn.dataset.aspect);
        renderAspectSegControl();
        setCanvasSize(els.qualitySelect.value);
      });
    });
  }
  renderAspectSegControl();

  els.zoomRange.addEventListener('input', () => {
    compositionEngine.setZoom(parseFloat(els.zoomRange.value));
    els.zoomVal.textContent = compositionEngine.zoom.toFixed(1) + 'x';
  });
  els.panXRange.addEventListener('input', () => compositionEngine.setPan(parseFloat(els.panXRange.value), compositionEngine.panY));
  els.panYRange.addEventListener('input', () => compositionEngine.setPan(compositionEngine.panX, parseFloat(els.panYRange.value)));
  els.resetPanBtn.addEventListener('click', () => {
    compositionEngine.resetPan();
    els.panXRange.value = '0.5'; els.panYRange.value = '0.5';
  });
  els.guidesToggle.addEventListener('change', () => {
    compositionEngine.showGuides = els.guidesToggle.checked;
    if (!compositionEngine.showGuides) guideCtx.clearRect(0, 0, els.guideCanvas.width, els.guideCanvas.height);
  });

  // ============================================================
  // Realism panel
  // ============================================================
  els.realismToggle.addEventListener('change', () => { realismState.enabled = els.realismToggle.checked; pushRealism(); });
  els.realismIntensity.addEventListener('input', () => {
    realismState.intensity = parseInt(els.realismIntensity.value, 10) / 100;
    els.realismIntensityVal.textContent = els.realismIntensity.value + '%';
    pushRealism();
  });
  els.toneMatchToggle.addEventListener('change', () => { realismState.toneMatch = els.toneMatchToggle.checked; pushRealism(); });
  els.shadowToggle.addEventListener('change', () => { realismState.shadow = els.shadowToggle.checked; pushRealism(); });
  els.lightWrapToggle.addEventListener('change', () => { realismState.lightWrap = els.lightWrapToggle.checked; pushRealism(); });
  els.grainToggle.addEventListener('change', () => { realismState.grain = els.grainToggle.checked; pushRealism(); });
  els.abPreviewToggle.addEventListener('change', () => { realismState.abPreview = els.abPreviewToggle.checked; pushRealism(); });

  // ============================================================
  // Refine-mask panel — edge feather + manual brush correction
  // ============================================================
  els.featherRange.addEventListener('input', () => {
    maskState.featherPx = parseInt(els.featherRange.value, 10);
    els.featherVal.textContent = maskState.featherPx + 'px';
    pushMask();
  });
  els.despeckleRange.addEventListener('input', () => {
    maskState.despeckle = parseInt(els.despeckleRange.value, 10);
    els.despeckleVal.textContent = maskState.despeckle + 'px';
    pushMask();
  });
  els.smoothingRange.addEventListener('input', () => {
    maskState.temporalSmoothing = parseFloat(els.smoothingRange.value);
    els.smoothingVal.textContent = maskState.temporalSmoothing.toFixed(2);
    pushMask();
  });
  // ---- Studio Scene (desk in front of me, placement, light, shadow) ----
  const SceneEng = window.VS.SceneEngine;
  const SCENE_KEY = 'vs_scene_v1';
  let sceneState = Object.assign({}, SceneEng ? SceneEng.DEFAULTS : {});
  let sceneEnvId = null;
  let sceneGuideUntil = 0;
  function readSceneStore() { try { return JSON.parse(localStorage.getItem(SCENE_KEY) || '{}') || {}; } catch (e) { return {}; } }
  function saveSceneFor(id) {
    if (!id) return;
    try { const m = readSceneStore(); m[id] = sceneState; localStorage.setItem(SCENE_KEY, JSON.stringify(m)); } catch (e) {}
  }
  function pushScene() {
    if (!(renderWorker || localCore)) return;
    rendererSend({ type: 'setScene', state: sceneState });
  }
  const SCENE_SLIDERS = [
    ['sceneDeskY', 'sceneDeskYVal', 'deskY', 2], ['sceneTilt', 'sceneTiltVal', 'deskTilt', 3], ['sceneBow', 'sceneBowVal', 'deskBow', 3],
    ['sceneFeather', 'sceneFeatherVal', 'deskFeather', 0], ['sceneScale', 'sceneScaleVal', 'personScale', 2],
    ['sceneX', 'sceneXVal', 'personX', 3], ['sceneY', 'sceneYVal', 'personY', 3], ['sceneLight', 'sceneLightVal', 'lightStrength', 2],
    ['sceneShadow', 'sceneShadowVal', 'shadowStrength', 2], ['sceneSoft', 'sceneSoftVal', 'bgSoft', 2],
  ];
  function syncSceneUI() {
    if (!els.sceneToggle) return;
    els.sceneToggle.checked = !!sceneState.enabled;
    els.sceneControls.style.display = sceneState.enabled ? 'block' : 'none';
    els.sceneDeskOn.checked = !!sceneState.deskOn;
    SCENE_SLIDERS.forEach(([sid, vid, key, dp]) => {
      els[sid].value = sceneState[key];
      els[vid].textContent = Number(sceneState[key]).toFixed(dp);
    });
    els.sceneLightSide.value = sceneState.lightAuto ? 'auto' : (sceneState.lightSide < 0 ? 'left' : 'right');
  }
  function showSceneGuide() { seatLocked = false; sceneGuideUntil = performance.now() + (sceneState.seat ? 7000 : 1800); }
  let seatAlign = 'none', seatOkSince = 0, seatBadSince = 0, seatLocked = false, seatPose = null, seatLight = 'ok';
  const SEAT_MSG = { ok: 'Perfect - hold still', left: 'Move a little to your left', right: 'Move a little to your right', high: 'Sit a little taller', low: 'Sit a little lower', closer: 'Move a little closer to the camera', back: 'Move a little back from the camera', tight: 'Move back a little so your chest and arms are in view', none: 'Sit upright, head in the oval, shoulders on the curve' };
  function drawSeatGuide(ctx, w, h) {
    const g = SceneEng && sceneState.enabled && sceneState.seat && sceneState.seat.guide;
    if (!g) return;
    // Stay on until the presenter has held the right position for 1.5 s (then hide); come back if they drift away for 4 s.
    const now = performance.now();
    if (seatAlign === 'ok') { if (!seatOkSince) seatOkSince = now; seatBadSince = 0; if (now - seatOkSince > 1500) seatLocked = true; }
    else { seatOkSince = 0; if (!seatBadSince) seatBadSince = now; if (seatLocked && now - seatBadSince > 4000) seatLocked = false; }
    const poseBad = !!(seatPose && window.VS.PoseGate && window.VS.PoseGate.isBad(seatPose.status));   // unsupported pose: say so on screen (this guide canvas is never recorded)
    if (poseBad) seatLocked = false;
    if (seatLocked && !(now < sceneGuideUntil || (compositionEngine && compositionEngine.showGuides))) return;
    ctx.save();
    ctx.setLineDash([12, 9]); ctx.lineWidth = Math.max(2, h / 240); const okc = seatAlign === 'ok'; ctx.strokeStyle = okc ? 'rgba(120,255,140,0.95)' : 'rgba(255,196,80,0.95)'; ctx.fillStyle = ctx.strokeStyle;
    ctx.beginPath(); ctx.ellipse(g.headX * w, g.headY * h, g.headRx * w, g.headRy * h, 0, 0, Math.PI * 2); ctx.stroke();            // head target
    const sy = g.shoulderY * h, hw = g.shoulderHalfW * w, cx = g.headX * w;
    ctx.beginPath(); ctx.moveTo(cx - hw, sy + h * 0.14); ctx.quadraticCurveTo(cx - hw, sy, cx - hw * 0.55, sy); ctx.lineTo(cx + hw * 0.55, sy); ctx.quadraticCurveTo(cx + hw, sy, cx + hw, sy + h * 0.14); ctx.stroke();   // shoulders
    ctx.setLineDash([]); ctx.font = Math.round(h / 34) + 'px system-ui,sans-serif'; ctx.textAlign = 'center';
    const msgY = Math.max(h * 0.05, g.headY * h - g.headRy * h - h * 0.03);
    let msg = SEAT_MSG[seatAlign] || SEAT_MSG.none;
    if (seatAlign === 'ok' && seatLight === 'dim') msg = 'Good - now put a lamp or window IN FRONT of you';
    ctx.fillText(msg, cx, msgY);
    if (poseBad) {   // banner: the composite is not trusted for this pose, and the picture holds its last good position meanwhile
      const reason = window.VS.PoseGate.REASON[seatPose.status] || 'Sit upright, facing the camera', fs = Math.round(h / 30);
      ctx.font = 'bold ' + fs + 'px system-ui,sans-serif';
      const tw = ctx.measureText('Pose not supported: ' + reason).width + fs, bx = Math.max(4, cx - tw / 2), by = Math.min(h * 0.93 - fs * 1.8, msgY + fs * 1.4);
      ctx.fillStyle = 'rgba(160,30,30,0.88)'; ctx.fillRect(bx, by, Math.min(tw, w - 8), fs * 1.7);
      ctx.fillStyle = '#fff'; ctx.fillText('Pose not supported: ' + reason, cx, by + fs * 1.2);
    }
    ctx.restore();
  }
  function seatHint() { const st = SceneEng && SceneEng.seatSummary(sceneState.seat); return st ? ' Seated scene (' + st.type + '). Supported: ' + st.supports : ''; }
  function drawSceneGuide(ctx, w, h) {
    drawSeatGuide(ctx, w, h);
    if (!SceneEng || !sceneState.enabled || !sceneState.deskOn || performance.now() > sceneGuideUntil) return;
    ctx.save();
    ctx.setLineDash([10, 8]);
    ctx.lineWidth = Math.max(2, h / 240);
    ctx.strokeStyle = 'rgba(255,214,0,0.95)';
    ctx.beginPath();
    for (let i = 0; i <= 40; i++) {
      const x = (i / 40) * w, y = SceneEng.deskLineY(i / 40, sceneState) * h;
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.stroke();
    ctx.restore();
  }
  function onSceneEnvironmentChanged(id) {
    if (!SceneEng) return;
    const wasEnabled = !!sceneState.enabled;
    sceneEnvId = id;
    const saved = readSceneStore()[id];
    if (saved) sceneState = Object.assign({}, SceneEng.DEFAULTS, saved);
    else if (wasEnabled) sceneState = SceneEng.presetFor(id);
    else sceneState = Object.assign({}, SceneEng.DEFAULTS, SceneEng.PRESETS[id] || {}, { enabled: false });
    syncSceneUI(); pushScene();
  }
  function setSceneEnabled(on, id) {
    if (!SceneEng) return;
    const envId = id || els.envSelect.value;
    if (on && !readSceneStore()[envId]) sceneState = SceneEng.presetFor(envId);
    sceneState.enabled = !!on;
    syncSceneUI(); pushScene(); saveSceneFor(envId);
    els.sceneStatus.textContent = on ? 'Scene mode is on. Drag the yellow desk line to match the desk edge in your picture.' + seatHint() : '';
    if (on) showSceneGuide();
  }
  if (SceneEng && els.sceneToggle) {
    els.sceneToggle.addEventListener('change', () => setSceneEnabled(els.sceneToggle.checked));
    els.sceneDeskOn.addEventListener('change', () => { sceneState.deskOn = els.sceneDeskOn.checked; pushScene(); saveSceneFor(els.envSelect.value); showSceneGuide(); });
    SCENE_SLIDERS.forEach(([sid, vid, key, dp]) => {
      els[sid].addEventListener('input', () => {
        sceneState[key] = parseFloat(els[sid].value);
        els[vid].textContent = sceneState[key].toFixed(dp);
        pushScene(); saveSceneFor(els.envSelect.value);
        if (key.startsWith('desk')) showSceneGuide();
      });
    });
    els.sceneLightSide.addEventListener('change', () => {
      const v = els.sceneLightSide.value;
      sceneState.lightAuto = v === 'auto';
      if (v !== 'auto') sceneState.lightSide = v === 'left' ? -1 : 1;
      pushScene(); saveSceneFor(els.envSelect.value);
    });
    els.sceneAutoBtn.addEventListener('click', () => {
      const id = els.envSelect.value;
      sceneState = SceneEng.presetFor(id);
      syncSceneUI(); pushScene(); saveSceneFor(id); showSceneGuide();
      els.sceneStatus.textContent = SceneEng.PRESETS[id]
        ? 'Applied the tuned settings for this scene.'
        : 'No tuned preset for this picture, so I used safe defaults. Drag the desk line to the desk edge in your picture.';
    });
    els.sceneCopyPromptBtn.addEventListener('click', async () => {
      const text = SceneEng.scenePrompt('a modern news studio');
      try { await navigator.clipboard.writeText(text); els.sceneStatus.textContent = 'Prompt copied. Paste it into any image generator, then upload the picture here. Edit the first words to change the room.'; }
      catch (e) { els.sceneStatus.textContent = text; }
    });
    syncSceneUI();
    pushScene();
  }
  // Small, stable surface for the Scene Wizard (js/scene-wizard.js). Everything goes through the same functions as the panel sliders.
  window.VS.sceneApi = {
    state: () => Object.assign({}, sceneState),
    envId: () => els.envSelect.value,
    patch(p) {
      if (!SceneEng) return;
      if (!sceneState.enabled) setSceneEnabled(true);
      SceneEng.applyPatch ? SceneEng.applyPatch(sceneState, p) : Object.assign(sceneState, p);
      syncSceneUI(); pushScene(); saveSceneFor(els.envSelect.value);
      if (Object.keys(p).some((k) => k.indexOf('desk') === 0)) showSceneGuide();
    },
    enable(on) { setSceneEnabled(!!on); },
    pickEnv(id) {
      els.envSelect.value = id; renderEnvMiniGrid(); pushEnvironment(id);
      // a library scene arrives with its own tuned settings (scene.json) the first time; later visits restore what the user saved
      if (SceneEng && !readSceneStore()[id]) { sceneState = SceneEng.presetFor(id); syncSceneUI(); pushScene(); saveSceneFor(id); }
    },
    autoSeat() { if (!SceneEng) return; SceneEng.autoPlace(sceneState, SceneEng.CHEST_LINE); syncSceneUI(); pushScene(); saveSceneFor(els.envSelect.value); },
    holdGuide(on) { sceneGuideUntil = on ? Infinity : performance.now() + 300; },
    before(on) {
      if (on) { rendererSend({ type: 'setScene', state: Object.assign({}, sceneState, { enabled: false }) }); rendererSend({ type: 'setRealism', state: Object.assign({}, realismState, { enabled: false }) }); }
      else { pushScene(); pushRealism(); }
    },
    uploadClick() { els.uploadBg.click(); },
    async envImage() {
      const id = els.envSelect.value;
      if (envProvider.customImages.has(id)) return envProvider.customImages.get(id);
      await envProvider.loadBuiltinImages();
      return envProvider.builtinImageCache.get(id) || null;
    },
  };

  // ---- Sharp GPU edges + clean plate ----
  try { const saved = localStorage.getItem(MODEL_PREF_KEY); if (saved && els.modelSelect) els.modelSelect.value = saved; } catch (e) {}
  els.modelSelect.addEventListener('change', () => {
    try { localStorage.setItem(MODEL_PREF_KEY, els.modelSelect.value); } catch (e) {}
    showBenchNote(running ? 'Model change applies the next time you start the camera.' : '');
  });
  els.rebenchBtn.addEventListener('click', () => {
    try { localStorage.removeItem(BENCH_KEY); } catch (e) {}
    showBenchNote('Speed test cleared. It will run again the next time you start the camera (Auto mode).');
  });
  // ---- Start automatically when Studio opens (only if the camera is already allowed on this device) ----
  window.__vsT = { pageStart: performance.timeOrigin };
  try { if (localStorage.getItem('vs_autostart') === '0' && els.autoStartToggle) els.autoStartToggle.checked = false; } catch (e) {}
  if (els.autoStartToggle) els.autoStartToggle.addEventListener('change', () => {
    try { localStorage.setItem('vs_autostart', els.autoStartToggle.checked ? '1' : '0'); } catch (e) {}
  });
  setTimeout(() => preloadProvider(), 50);
  (async () => {
    try {
      if (localStorage.getItem('vs_autostart') === '0') return;
      if (!navigator.permissions || !navigator.permissions.query) return;
      const st = await navigator.permissions.query({ name: 'camera' });
      if (st.state === 'granted' && !running) { window.__vsT.autoStart = performance.now(); els.startBtn.click(); }
    } catch (e) { /* not supported: user taps Start as before */ }
  })();
  els.sharpMatteToggle.addEventListener('change', () => {
    matteState.mode = els.sharpMatteToggle.checked ? 'gl' : 'legacy';
    pushMatte();
  });
  els.sharpQuality.addEventListener('change', () => {
    matteState.radius = parseInt(els.sharpQuality.value, 10);
    pushMatte();
  });
  els.crispRange.addEventListener('input', () => {
    matteState.crisp = parseFloat(els.crispRange.value);
    els.crispVal.textContent = matteState.crisp.toFixed(2);
    pushMatte();
  });
  els.despillRange.addEventListener('input', () => {
    matteState.despill = parseFloat(els.despillRange.value);
    els.despillVal.textContent = matteState.despill.toFixed(2);
    pushMatte();
  });
  let plateBusy = false;
  els.capturePlateBtn.addEventListener('click', async () => {
    if (plateBusy) return;
    if (!els.video.videoWidth) { els.matteStatus.textContent = 'Start the camera first, then capture the empty room.'; return; }
    plateBusy = true;
    for (let n = 5; n >= 1; n--) {
      els.matteStatus.textContent = 'Step out of the frame — capturing the empty room in ' + n + '…';
      await new Promise((r) => setTimeout(r, 1000));
    }
    try {
      const cw = outW, ch = outH;
      const crop = compositionEngine.computeFrame(videoNativeW || cw, videoNativeH || ch, Math.max(cw, ch));
      const bmp = await createImageBitmap(els.video, crop.sx, crop.sy, crop.sw, crop.sh, { resizeWidth: cw, resizeHeight: ch, resizeQuality: 'medium' });
      rendererSend({ type: 'setPlate', bitmap: bmp }, [bmp]);
      els.matteStatus.textContent = 'Clean plate saved. Keep the camera still. Re-capture if you change zoom, framing or lighting.';
    } catch (err) {
      els.matteStatus.textContent = 'Could not capture the plate: ' + err.message;
    }
    plateBusy = false;
  });
  els.clearPlateBtn.addEventListener('click', () => {
    rendererSend({ type: 'clearPlate' });
    els.matteStatus.textContent = 'Clean plate cleared.';
  });
  els.lowLightBoostToggle.addEventListener('change', () => {
    lowLightBoostEnabled = els.lowLightBoostToggle.checked;
    if (segProvider) segProvider.lowLightBoost = lowLightBoostEnabled;
  });
  els.correctionToggle.addEventListener('change', () => {
    maskState.correctionEnabled = els.correctionToggle.checked;
    els.brushCanvas.style.display = maskState.correctionEnabled ? 'block' : 'none';
    els.brushCanvas.classList.toggle('active', maskState.correctionEnabled);
    pushMask();
  });
  els.brushModeControl.querySelectorAll('.seg-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      maskState.brushMode = btn.dataset.mode;
      els.brushModeControl.querySelectorAll('.seg-btn').forEach(b => { b.classList.remove('active'); b.setAttribute('aria-checked', 'false'); });
      btn.classList.add('active');
      btn.setAttribute('aria-checked', 'true');
      pushMask();
    });
  });
  els.brushSizeRange.addEventListener('input', () => {
    maskState.brushSize = parseInt(els.brushSizeRange.value, 10);
    els.brushSizeVal.textContent = maskState.brushSize + 'px';
    pushMask();
  });
  els.clearCorrectionsBtn.addEventListener('click', () => {
    if (renderWorker || localCore) rendererSend({ type: 'clearCorrections' });
    els.brushCanvas.getContext('2d').clearRect(0, 0, els.brushCanvas.width, els.brushCanvas.height);
  });

  let painting = false;
  function canvasPointFromEvent(e) {
    const rect = els.brushCanvas.getBoundingClientRect();
    return {
      x: (e.clientX - rect.left) * (els.brushCanvas.width / rect.width),
      y: (e.clientY - rect.top) * (els.brushCanvas.height / rect.height),
    };
  }
  function paintBrush(x, y) {
    if (renderWorker || localCore) rendererSend({ type: 'paintAt', x, y });
    const bctx = els.brushCanvas.getContext('2d');
    bctx.save();
    bctx.fillStyle = maskState.brushMode === 'add' ? 'rgba(94,106,210,0.35)' : 'rgba(240,85,95,0.35)';
    bctx.beginPath();
    bctx.arc(x, y, maskState.brushSize / 2, 0, Math.PI * 2);
    bctx.fill();
    bctx.restore();
  }
  els.brushCanvas.addEventListener('pointerdown', (e) => {
    if (!maskState.correctionEnabled) return;
    painting = true;
    els.brushCanvas.setPointerCapture(e.pointerId);
    const p = canvasPointFromEvent(e);
    paintBrush(p.x, p.y);
  });
  els.brushCanvas.addEventListener('pointermove', (e) => {
    if (!painting) return;
    const p = canvasPointFromEvent(e);
    paintBrush(p.x, p.y);
  });
  ['pointerup', 'pointercancel', 'pointerleave'].forEach(evt => els.brushCanvas.addEventListener(evt, () => { painting = false; }));

  // ============================================================
  // Live pointer/annotation — a laser pointer or freehand pen drawn
  // straight into the composite by the render worker (see drawAnnotations
  // in render-worker.js), so it's baked into recording/live the same way
  // content overlays are. This overlay canvas only exists to capture
  // pointer input; the actual mark is drawn by the worker onto the real
  // output canvas, not mirrored locally, so there's nothing to keep in
  // sync here beyond forwarding coordinates.
  // ============================================================
  const annotateState = { enabled: false, mode: 'draw', color: '#ff5b5b' };
  let annotating = false;

  function annotatePointFromEvent(e) {
    const rect = els.annotateCanvas.getBoundingClientRect();
    return {
      x: (e.clientX - rect.left) * (els.annotateCanvas.width / rect.width),
      y: (e.clientY - rect.top) * (els.annotateCanvas.height / rect.height),
    };
  }

  els.annotateToggle.addEventListener('change', () => {
    annotateState.enabled = els.annotateToggle.checked;
    els.annotateCanvas.style.display = annotateState.enabled ? 'block' : 'none';
    els.annotateCanvas.classList.toggle('active', annotateState.enabled);
    // Both this and mask-brush correction capture pointer drags on the
    // same preview stack — running both at once just means one silently
    // eats the other's clicks, so keep it to one active drawing tool.
    if (annotateState.enabled && maskState.correctionEnabled) {
      els.correctionToggle.checked = false;
      els.correctionToggle.dispatchEvent(new Event('change'));
    }
  });
  els.correctionToggle.addEventListener('change', () => {
    if (els.correctionToggle.checked && annotateState.enabled) {
      els.annotateToggle.checked = false;
      els.annotateToggle.dispatchEvent(new Event('change'));
    }
  });

  els.annotateModeControl.querySelectorAll('.seg-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      annotateState.mode = btn.dataset.mode;
      els.annotateModeControl.querySelectorAll('.seg-btn').forEach(b => { b.classList.remove('active'); b.setAttribute('aria-checked', 'false'); });
      btn.classList.add('active');
      btn.setAttribute('aria-checked', 'true');
    });
  });
  els.annotateColorControl.querySelectorAll('.annotate-swatch').forEach(btn => {
    btn.addEventListener('click', () => {
      annotateState.color = btn.dataset.color;
      els.annotateColorControl.querySelectorAll('.annotate-swatch').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
    });
  });
  els.annotateClearBtn.addEventListener('click', () => {
    if (renderWorker || localCore) rendererSend({ type: 'annotateClear' });
  });

  els.annotateCanvas.addEventListener('pointerdown', (e) => {
    if (!annotateState.enabled || !(renderWorker || localCore)) return;
    annotating = true;
    els.annotateCanvas.setPointerCapture(e.pointerId);
    const p = annotatePointFromEvent(e);
    rendererSend({ type: 'annotateStart', x: p.x, y: p.y, mode: annotateState.mode, color: annotateState.color });
  });
  els.annotateCanvas.addEventListener('pointermove', (e) => {
    if (!annotating || !(renderWorker || localCore)) return;
    const p = annotatePointFromEvent(e);
    rendererSend({ type: 'annotateMove', x: p.x, y: p.y });
  });
  ['pointerup', 'pointercancel', 'pointerleave'].forEach(evt => els.annotateCanvas.addEventListener(evt, () => {
    if (!annotating) return;
    annotating = false;
    if (renderWorker || localCore) rendererSend({ type: 'annotateEnd' });
  }));

  els.logoUploadTrigger.querySelector('span').innerHTML = window.VS.icon('upload', 22);

  // ============================================================
  // Brand kit — logo watermark + brand color, persisted with templates
  // ============================================================
  let brandKit = { color: els.brandColorInput.value, logoDataUrl: null, watermark: false };
  let logoImg = null;

  // logoImg is decoded on the main thread (it's a data URL from
  // localStorage/upload) then handed to the worker as an ImageBitmap —
  // the worker itself can't use `Image()`.
  function pushLogoBitmap() {
    if (!(renderWorker || localCore)) return;
    if (!logoImg) { rendererSend({ type: 'watermarkBitmap', bitmap: null }); return; }
    createImageBitmap(logoImg).then(bitmap => {
      rendererSend({ type: 'watermarkBitmap', bitmap }, [bitmap]);
    }).catch(() => {});
  }
  function pushWatermarkOn() { if (renderWorker || localCore) rendererSend({ type: 'setWatermarkOn', on: brandKit.watermark }); }

  function setBrandKit(kit) {
    brandKit = { color: kit.color || '#5e6ad2', logoDataUrl: kit.logoDataUrl || null, watermark: !!kit.watermark };
    els.brandColorInput.value = brandKit.color;
    els.watermarkToggle.checked = brandKit.watermark;
    els.logoFileLabel.textContent = brandKit.logoDataUrl ? 'Logo set (click to replace)' : 'Upload a logo (watermark)';
    if (brandKit.logoDataUrl) {
      logoImg = new Image();
      logoImg.onload = pushLogoBitmap;
      logoImg.src = brandKit.logoDataUrl;
    } else {
      logoImg = null;
      pushLogoBitmap();
    }
    pushWatermarkOn();
  }

  els.brandColorInput.addEventListener('input', () => { brandKit.color = els.brandColorInput.value; });
  els.watermarkToggle.addEventListener('change', () => { brandKit.watermark = els.watermarkToggle.checked; pushWatermarkOn(); });
  els.logoUploadTrigger.addEventListener('click', () => els.logoUpload.click());
  els.logoUpload.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      brandKit.logoDataUrl = reader.result;
      els.logoFileLabel.textContent = 'Logo set (click to replace)';
      logoImg = new Image();
      logoImg.onload = pushLogoBitmap;
      logoImg.src = brandKit.logoDataUrl;
      els.watermarkToggle.checked = true;
      brandKit.watermark = true;
      pushWatermarkOn();
    };
    reader.readAsDataURL(file);
  });

  // ============================================================
  // Content overlays — static image insets (slide/photo/screenshot, or a
  // multi-page deck from an image sequence or PDF), baked into the
  // composite by the render worker (see drawContentOverlays in
  // render-worker.js), same technique as the watermark above. Up to
  // MAX_OVERLAYS at once, each independently toggleable/positioned/sized;
  // overlays sharing a corner stack instead of overlapping (worker-side).
  // Session-only for this cut: not saved with templates yet — an honest
  // scope limit, not an oversight; add persistence if this earns its keep.
  //
  // Slide decks: an overlay can hold multiple pages (images or PDF pages).
  // Click-to-advance via the Prev/Next buttons on its row, or Left/Right
  // arrow keys (while not typing in a field) which advance the primary
  // overlay — the same "first enabled overlay" the Layout modes use —
  // since that's the one most likely being presented from live.
  // ============================================================
  const MAX_OVERLAYS = 4;
  let overlayList = []; // [{ id, name, count, index }] — bitmaps live only in the worker
  let overlaySeq = 0;

  // pdf.js is loaded lazily, only when someone actually imports a PDF, to
  // avoid pulling in a ~1MB library for users who never touch this path.
  // Pinned version on both script + worker URLs together — pdf.js requires
  // the worker build to match the main build exactly, or it breaks.
  const PDFJS_VERSION = '3.11.174';
  let pdfjsLoadPromise = null;
  function ensurePdfJs() {
    if (window.pdfjsLib) return Promise.resolve();
    if (pdfjsLoadPromise) return pdfjsLoadPromise;
    pdfjsLoadPromise = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = `https://cdn.jsdelivr.net/npm/pdfjs-dist@${PDFJS_VERSION}/legacy/build/pdf.min.js`;
      s.onload = () => {
        window.pdfjsLib.GlobalWorkerOptions.workerSrc = `https://cdn.jsdelivr.net/npm/pdfjs-dist@${PDFJS_VERSION}/legacy/build/pdf.worker.min.js`;
        resolve();
      };
      s.onerror = () => reject(new Error('Could not load the PDF renderer — check your network connection.'));
      document.head.appendChild(s);
    });
    return pdfjsLoadPromise;
  }

  async function renderPdfToSlides(file) {
    await ensurePdfJs();
    const buf = await file.arrayBuffer();
    const pdf = await window.pdfjsLib.getDocument({ data: buf }).promise;
    const slides = [];
    const thumbs = [];
    const scratch = document.createElement('canvas');
    const sctx = scratch.getContext('2d');
    for (let p = 1; p <= pdf.numPages; p++) {
      const page = await pdf.getPage(p);
      const viewport = page.getViewport({ scale: 2 }); // 2x for a crisp inset, not full-res overkill
      scratch.width = viewport.width;
      scratch.height = viewport.height;
      await page.render({ canvasContext: sctx, viewport }).promise;
      thumbs.push(bitmapToThumbDataURL(scratch));
      slides.push(await createImageBitmap(scratch));
    }
    return { slides, thumbs };
  }

  function bitmapToThumbDataURL(source, maxW = 88) {
    const c = document.createElement('canvas');
    const scale = maxW / source.width;
    c.width = maxW;
    c.height = Math.max(1, Math.round(source.height * scale));
    c.getContext('2d').drawImage(source, 0, 0, c.width, c.height);
    return c.toDataURL('image/jpeg', 0.72);
  }

  function addOverlayWithSlides(slides, name, thumbs) {
    if (overlayList.length >= MAX_OVERLAYS || !slides.length) return;
    const id = 'ov' + (++overlaySeq);
    rendererSend({ type: 'overlaySlides', id, slides }, slides);
    rendererSend({ type: 'setOverlayLayout', id, corner: 'top-right', scale: 0.34 });
    rendererSend({ type: 'setOverlayOn', id, on: true });
    overlayList.push({ id, name, count: slides.length, index: 0, thumbs: thumbs || [] });
    renderOverlayList();
    updateOverlayUploadState();
  }

  function renderOverlayList() {
    els.overlayList.innerHTML = overlayList.map((ov) => `
      <div class="overlay-row" style="padding:10px; margin-top:10px; border:1px solid var(--border); border-radius:8px;" data-overlay-id="${ov.id}">
        <div style="display:flex; align-items:center; justify-content:space-between; gap:8px;">
          <label class="toggle-row" style="margin:0;">
            <input type="checkbox" class="ov-toggle" checked>
            <span>${ov.name}</span>
          </label>
          <button type="button" class="btn ghost sm ov-remove" title="Remove overlay">Remove</button>
        </div>
        ${ov.count > 1 ? `
        <div style="display:flex; align-items:center; gap:8px; margin-top:8px;">
          <button type="button" class="btn ghost sm ov-prev" title="Previous slide">◀</button>
          <span class="ov-slide-label" style="font-size:12.5px; color:var(--text-dim);">Slide ${ov.index + 1} / ${ov.count}</span>
          <button type="button" class="btn ghost sm ov-next" title="Next slide">▶</button>
        </div>
        ${ov.thumbs && ov.thumbs.length ? `
        <div class="slide-filmstrip" role="listbox" aria-label="${ov.name} slides">
          ${ov.thumbs.map((src, i) => `
            <button type="button" class="slide-thumb${i === ov.index ? ' active' : ''}" data-idx="${i}" role="option" aria-selected="${i === ov.index}">
              <img src="${src}" alt="Slide ${i + 1}">
              <span class="slide-thumb-num">${i + 1}</span>
            </button>
          `).join('')}
        </div>` : ''}` : ''}
        <div class="field">
          <label>Position</label>
          <select class="ov-corner">
            <option value="top-right">Top right</option>
            <option value="top-left">Top left</option>
            <option value="bottom-right">Bottom right</option>
            <option value="bottom-left">Bottom left</option>
          </select>
        </div>
        <div class="field">
          <label>Size</label>
          <input type="range" class="ov-size" min="0.2" max="0.6" step="0.02" value="0.34">
        </div>
      </div>
    `).join('');

    els.overlayList.querySelectorAll('[data-overlay-id]').forEach((row) => {
      const id = row.dataset.overlayId;
      row.querySelector('.ov-toggle').addEventListener('change', (e) => {
        rendererSend({ type: 'setOverlayOn', id, on: e.target.checked });
      });
      row.querySelector('.ov-corner').addEventListener('change', (e) => {
        rendererSend({ type: 'setOverlayLayout', id, corner: e.target.value });
      });
      row.querySelector('.ov-size').addEventListener('input', (e) => {
        rendererSend({ type: 'setOverlayLayout', id, scale: parseFloat(e.target.value) });
      });
      row.querySelector('.ov-remove').addEventListener('click', () => {
        stopLiveOverlayIfAny(id);
        rendererSend({ type: 'removeOverlay', id });
        overlayList = overlayList.filter((o) => o.id !== id);
        renderOverlayList();
        updateOverlayUploadState();
      });
      const prevBtn = row.querySelector('.ov-prev'), nextBtn = row.querySelector('.ov-next');
      if (prevBtn) prevBtn.addEventListener('click', () => advanceSlide(id, -1));
      if (nextBtn) nextBtn.addEventListener('click', () => advanceSlide(id, 1));
      row.querySelectorAll('.slide-thumb').forEach((thumb) => {
        thumb.addEventListener('click', () => goToSlide(id, parseInt(thumb.dataset.idx, 10)));
      });
    });
  }

  // Shared by advanceSlide, goToSlide, and Director-mode scene restore:
  // pushes the new index to the worker and keeps the label + filmstrip
  // active-thumbnail in sync, wherever the change came from.
  function updateSlideUI(id, index) {
    const row = els.overlayList.querySelector(`[data-overlay-id="${id}"]`);
    if (!row) return;
    const label = row.querySelector('.ov-slide-label');
    if (label) label.textContent = `Slide ${index + 1} / ${row.querySelectorAll('.slide-thumb').length || '?'}`;
    row.querySelectorAll('.slide-thumb').forEach((t, i) => {
      t.classList.toggle('active', i === index);
      t.setAttribute('aria-selected', i === index ? 'true' : 'false');
    });
  }

  function advanceSlide(id, dir) {
    const ov = overlayList.find((o) => o.id === id);
    if (!ov || ov.count <= 1) return;
    ov.index = Math.max(0, Math.min(ov.index + dir, ov.count - 1));
    rendererSend({ type: 'setOverlaySlide', id, index: ov.index });
    updateSlideUI(id, ov.index);
  }

  // Jump straight to a slide by clicking its filmstrip thumbnail, instead
  // of stepping through Prev/Next one at a time.
  function goToSlide(id, index) {
    const ov = overlayList.find((o) => o.id === id);
    if (!ov || ov.count <= 1) return;
    ov.index = Math.max(0, Math.min(index, ov.count - 1));
    rendererSend({ type: 'setOverlaySlide', id, index: ov.index });
    updateSlideUI(id, ov.index);
  }

  // Left/Right arrow keys advance the primary (first-added) deck overlay —
  // "click-to-advance while live" without needing to touch the panel.
  // Ignored while typing in an input/textarea/select so it doesn't hijack
  // normal text editing elsewhere in the app.
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    const tag = document.activeElement && document.activeElement.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
    const primary = overlayList.find((o) => o.count > 1);
    if (!primary) return;
    e.preventDefault();
    advanceSlide(primary.id, e.key === 'ArrowRight' ? 1 : -1);
  });

  // ============================================================
  // Scene snapshots — the shared capture/apply logic behind both PiP
  // presets and Director mode cues below: layout mode, each overlay's
  // on/off/corner/size, and (if a slide deck is present) which slide it's
  // on. Keyed by overlay LIST POSITION, not overlay id, since an overlay's
  // id is only assigned at import time and won't exist yet when a scene is
  // captured for a future re-upload — position is the stable handle across
  // re-imports.
  // ============================================================
  function captureSceneSnapshot() {
    const deckSlot = overlayList.findIndex((o) => o.count > 1);
    return {
      layoutMode: els.layoutModeSelect.value,
      slots: overlayList.map((ov) => {
        const row = els.overlayList.querySelector(`[data-overlay-id="${ov.id}"]`);
        if (!row) return null;
        return {
          on: row.querySelector('.ov-toggle').checked,
          corner: row.querySelector('.ov-corner').value,
          scale: parseFloat(row.querySelector('.ov-size').value),
        };
      }),
      deckSlot: deckSlot >= 0 ? deckSlot : null,
      slideIndex: deckSlot >= 0 ? overlayList[deckSlot].index : null,
    };
  }

  function applySceneSnapshot(snap) {
    els.layoutModeSelect.value = snap.layoutMode;
    rendererSend({ type: 'setLayoutMode', mode: snap.layoutMode });
    overlayList.forEach((ov, idx) => {
      const slot = snap.slots[idx];
      if (!slot) return;
      const row = els.overlayList.querySelector(`[data-overlay-id="${ov.id}"]`);
      if (row) {
        row.querySelector('.ov-toggle').checked = slot.on;
        row.querySelector('.ov-corner').value = slot.corner;
        row.querySelector('.ov-size').value = slot.scale;
      }
      rendererSend({ type: 'setOverlayLayout', id: ov.id, corner: slot.corner, scale: slot.scale });
      rendererSend({ type: 'setOverlayOn', id: ov.id, on: slot.on });
    });
    if (snap.deckSlot != null && snap.slideIndex != null) {
      const ov = overlayList[snap.deckSlot];
      if (ov && ov.count > 1) {
        ov.index = Math.max(0, Math.min(snap.slideIndex, ov.count - 1));
        rendererSend({ type: 'setOverlaySlide', id: ov.id, index: ov.index });
        updateSlideUI(ov.id, ov.index);
      }
    }
  }

  // ============================================================
  // PiP presets — 4 numbered slots, switchable live via the 1-4 keys
  // (Shift+1-4 to save) without opening this panel. Session-only, same
  // scope limit as the overlays themselves.
  // ============================================================
  const MAX_PRESETS = 4;
  let pipPresets = [null, null, null, null];

  function savePipPreset(i) {
    pipPresets[i] = captureSceneSnapshot();
    renderPipPresets();
  }

  function applyPipPreset(i) {
    if (!pipPresets[i]) return;
    applySceneSnapshot(pipPresets[i]);
  }

  function renderPipPresets() {
    els.pipPresetList.innerHTML = pipPresets.map((p, i) => `
      <div class="control-section" style="flex:1; padding:8px; text-align:center;" data-preset-index="${i}">
        <div style="font-size:12.5px; font-weight:600;">Preset ${i + 1}</div>
        <div style="font-size:11px; color:var(--text-dim); margin:4px 0;">${p ? 'Saved' : 'Empty'}</div>
        <div style="display:flex; gap:4px;">
          <button type="button" class="btn ghost sm pip-save" style="flex:1;">Save</button>
          <button type="button" class="btn ghost sm pip-apply" style="flex:1;" ${p ? '' : 'disabled'}>Apply</button>
        </div>
      </div>
    `).join('');
    els.pipPresetList.querySelectorAll('[data-preset-index]').forEach((el) => {
      const i = parseInt(el.dataset.presetIndex, 10);
      el.querySelector('.pip-save').addEventListener('click', () => savePipPreset(i));
      const applyBtn = el.querySelector('.pip-apply');
      if (applyBtn) applyBtn.addEventListener('click', () => applyPipPreset(i));
    });
  }
  renderPipPresets();

  document.addEventListener('keydown', (e) => {
    if (!['1', '2', '3', '4'].includes(e.key)) return;
    const tag = document.activeElement && document.activeElement.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const i = parseInt(e.key, 10) - 1;
    if (i >= MAX_PRESETS) return;
    e.preventDefault();
    if (e.shiftKey) savePipPreset(i); else applyPipPreset(i);
  });

  // ============================================================
  // Director mode — an unlimited ordered sequence of scene snapshots (a
  // superset of a PiP preset: same layout/overlay/slide capture, just not
  // slot-limited to 4) planned ahead of a talk, then stepped through live
  // with Next/Back or the PageUp/PageDown keys — PowerPoint's own
  // convention for advancing slides, chosen so it's a shortcut presenters
  // already have muscle memory for, not a new one to learn.
  // ============================================================
  let directorCues = [];
  let directorIndex = -1;

  function renderDirectorCues() {
    els.directorCueList.innerHTML = directorCues.map((c, i) => `
      <div class="control-section" style="padding:6px 10px; margin-top:4px; display:flex; align-items:center; justify-content:space-between;${i === directorIndex ? ' border-color: var(--blue);' : ''}" data-cue-index="${i}">
        <span style="font-size:12.5px;">Cue ${i + 1}${i === directorIndex ? ' (current)' : ''}</span>
        <div style="display:flex; gap:6px;">
          <button type="button" class="btn ghost sm cue-jump">Go</button>
          <button type="button" class="btn ghost sm cue-remove">Remove</button>
        </div>
      </div>
    `).join('');
    els.directorCueList.querySelectorAll('[data-cue-index]').forEach((row) => {
      const i = parseInt(row.dataset.cueIndex, 10);
      row.querySelector('.cue-jump').addEventListener('click', () => applyDirectorCue(i));
      row.querySelector('.cue-remove').addEventListener('click', () => {
        directorCues.splice(i, 1);
        if (directorIndex >= directorCues.length) directorIndex = directorCues.length - 1;
        renderDirectorCues();
      });
    });
    els.directorPosition.textContent = directorCues.length ? `Cue ${directorIndex + 1} / ${directorCues.length}` : 'No cues yet';
    els.directorBack.disabled = directorIndex <= 0;
    els.directorNext.disabled = directorIndex >= directorCues.length - 1;
  }
  renderDirectorCues();

  function applyDirectorCue(i) {
    if (!directorCues[i]) return;
    applySceneSnapshot(directorCues[i]);
    directorIndex = i;
    renderDirectorCues();
  }
  function directorStep(dir) {
    if (!directorCues.length) return;
    applyDirectorCue(Math.max(0, Math.min(directorIndex + dir, directorCues.length - 1)));
  }

  els.directorAddCue.addEventListener('click', () => {
    directorCues.push(captureSceneSnapshot());
    renderDirectorCues();
  });
  els.directorBack.addEventListener('click', () => directorStep(-1));
  els.directorNext.addEventListener('click', () => directorStep(1));

  document.addEventListener('keydown', (e) => {
    if (e.key !== 'PageUp' && e.key !== 'PageDown') return;
    const tag = document.activeElement && document.activeElement.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
    if (!directorCues.length) return;
    e.preventDefault();
    directorStep(e.key === 'PageDown' ? 1 : -1);
  });

  function updateOverlayUploadState() {
    const atMax = overlayList.length >= MAX_OVERLAYS;
    [els.contentUploadTrigger, els.contentUploadPdfTrigger, els.contentUploadScreenTrigger].forEach((el) => el.classList.toggle('disabled', atMax));
    els.contentUploadLabel.textContent = atMax ? `Max ${MAX_OVERLAYS} overlays — remove one first` : 'Add image(s)';
  }

  /** Stops a live screen-share's tracks and drops its bookkeeping, if it is one. Safe to call on a static overlay (no-op). */
  function stopLiveOverlayIfAny(id) {
    const live = liveOverlays.get(id);
    if (!live) return;
    live.stream.getTracks().forEach((t) => t.stop());
    liveOverlays.delete(id);
    if (live.onGone) try { live.onGone(); } catch (_) {}
  }

  updateOverlayUploadState();
  els.layoutModeSelect.addEventListener('change', () => {
    rendererSend({ type: 'setLayoutMode', mode: els.layoutModeSelect.value });
  });

  els.contentUploadTrigger.addEventListener('click', () => {
    if (overlayList.length >= MAX_OVERLAYS) return;
    els.contentUpload.click();
  });
  els.contentUpload.addEventListener('change', async (e) => {
    const files = Array.from(e.target.files || []);
    e.target.value = ''; // allow re-adding the same filename(s) later
    if (!files.length || overlayList.length >= MAX_OVERLAYS) return;
    try {
      const loaded = await Promise.all(files.map((file) => new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => createImageBitmap(img).then((bmp) => resolve({ bmp, thumb: bitmapToThumbDataURL(img) }), reject);
        img.onerror = () => reject(new Error('Could not load ' + file.name));
        img.src = URL.createObjectURL(file);
      })));
      const name = files.length > 1 ? `${files.length}-image deck` : files[0].name;
      addOverlayWithSlides(loaded.map((l) => l.bmp), name, loaded.map((l) => l.thumb));
    } catch (err) {
      window.VS.reportError('Could not load that image: ' + err.message);
    }
  });

  els.contentUploadPdfTrigger.addEventListener('click', () => {
    if (overlayList.length >= MAX_OVERLAYS) return;
    els.contentUploadPdf.click();
  });
  els.contentUploadPdf.addEventListener('change', async (e) => {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file || overlayList.length >= MAX_OVERLAYS) return;
    showOverlay('preparing', { message: 'Rendering PDF pages...' });
    try {
      const { slides, thumbs } = await renderPdfToSlides(file);
      addOverlayWithSlides(slides, file.name, thumbs);
    } catch (err) {
      window.VS.reportError('Could not read that PDF: ' + err.message);
    } finally {
      hideOverlay();
    }
  });

  els.contentUploadScreenTrigger.addEventListener('click', async () => {
    if (overlayList.length >= MAX_OVERLAYS) return;
    if (!navigator.mediaDevices || !navigator.mediaDevices.getDisplayMedia) {
      window.VS.reportError('Screen sharing isn\u2019t supported in this browser.');
      return;
    }
    let stream;
    try {
      stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false });
    } catch (err) {
      // The user cancelling the share picker is not an error — every other
      // path here (bad file, PDF parse failure) genuinely failed; this one
      // is just "changed their mind", so it stays silent.
      if (err.name !== 'NotAllowedError' && err.name !== 'AbortError') {
        window.VS.reportError('Could not start screen sharing: ' + err.message);
      }
      return;
    }
    const trackLabel = stream.getVideoTracks()[0]?.label || 'Screen share';
    addLiveSource(stream, trackLabel);
  });

  // Shared by screen share and the second-phone camera (js/multisource.js). Returns the overlay id or null.
  async function addLiveSource(stream, label, onGone) {
    if (overlayList.length >= MAX_OVERLAYS) return null;
    const videoEl = document.createElement('video');
    videoEl.muted = true;
    videoEl.playsInline = true;
    videoEl.srcObject = stream;
    try { await videoEl.play(); } catch (_) { /* readyState gating in processLoop covers this */ }
    const id = 'ov' + (++overlaySeq);
    liveOverlays.set(id, { videoEl, stream, onGone });
    rendererSend({ type: 'setOverlayLayout', id, corner: 'top-right', scale: 0.34 });
    rendererSend({ type: 'setOverlayOn', id, on: true });
    overlayList.push({ id, name: label.length > 24 ? label.slice(0, 24) + '…' : label, count: 1, index: 0 });
    renderOverlayList();
    updateOverlayUploadState();
    const gone = () => {
      if (!liveOverlays.has(id)) return; // already removed via the panel's own Remove button
      stopLiveOverlayIfAny(id);
      rendererSend({ type: 'removeOverlay', id });
      overlayList = overlayList.filter((o) => o.id !== id);
      renderOverlayList();
      updateOverlayUploadState();
    };
    const t = stream.getVideoTracks()[0];
    if (t) t.addEventListener('ended', gone);
    return { id, remove: gone };
  }
  window.VS.sourceApi = { addLive: addLiveSource, get count() { return overlayList.length; }, get max() { return MAX_OVERLAYS; }, setLayout(mode) { els.layoutModeSelect.value = mode; els.layoutModeSelect.dispatchEvent(new Event('change')); } };

  // ============================================================
  // Templates — save/apply/manage full studio presets
  // ============================================================
  function currentConfigSnapshot() {
    return {
      env: els.envSelect.value,
      quality: els.qualitySelect.value,
      aspect: compositionEngine.aspectId,
      zoom: compositionEngine.zoom,
      panX: compositionEngine.panX,
      panY: compositionEngine.panY,
      realism: { ...realismState },
      brandColor: brandKit.color,
      logoDataUrl: brandKit.logoDataUrl,
      watermark: brandKit.watermark,
    };
  }

  function applyConfigSnapshot(cfg) {
    if (cfg.env) { els.envSelect.value = cfg.env; renderEnvMiniGrid(); pushEnvironment(cfg.env); }
    if (cfg.quality) { els.qualitySelect.value = cfg.quality; renderQualitySegControl(); }
    if (cfg.aspect) { compositionEngine.setAspect(cfg.aspect); renderAspectSegControl(); }
    if (typeof cfg.zoom === 'number') { compositionEngine.setZoom(cfg.zoom); els.zoomRange.value = cfg.zoom; els.zoomVal.textContent = cfg.zoom.toFixed(1) + 'x'; }
    if (typeof cfg.panX === 'number' && typeof cfg.panY === 'number') {
      compositionEngine.setPan(cfg.panX, cfg.panY);
      els.panXRange.value = cfg.panX; els.panYRange.value = cfg.panY;
    }
    if (cfg.realism) {
      realismState.enabled = !!cfg.realism.enabled;
      realismState.intensity = cfg.realism.intensity ?? realismState.intensity;
      realismState.toneMatch = cfg.realism.toneMatch !== false;
      realismState.shadow = cfg.realism.shadow !== false;
      realismState.lightWrap = cfg.realism.lightWrap !== false;
      realismState.grain = cfg.realism.grain !== false;
      els.realismToggle.checked = realismState.enabled;
      els.realismIntensity.value = Math.round(realismState.intensity * 100);
      els.realismIntensityVal.textContent = els.realismIntensity.value + '%';
      els.toneMatchToggle.checked = realismState.toneMatch;
      els.shadowToggle.checked = realismState.shadow;
      els.lightWrapToggle.checked = realismState.lightWrap;
      els.grainToggle.checked = realismState.grain;
      pushRealism();
    }
    setBrandKit({ color: cfg.brandColor, logoDataUrl: cfg.logoDataUrl, watermark: cfg.watermark });
    setCanvasSize(els.qualitySelect.value);
  }

  window.VS.applyConfigSnapshot = applyConfigSnapshot; window.VS.currentConfigSnapshot = currentConfigSnapshot; // used by js/looks.js

  function renderTemplateList() {
    const templates = window.VS.templates.list();
    els.templateList.innerHTML = templates.length ? '' : '<p class="honesty-note" style="border:none;padding:0;margin:0;">No templates saved yet.</p>';
    templates.forEach(t => {
      const row = document.createElement('div');
      row.className = 'mini-row';
      row.innerHTML = `
        <span>${t.name}</span>
        <span class="btn-row">
          <button class="btn ghost xs apply-tpl-btn" data-id="${t.id}">Apply</button>
          <button class="btn danger xs del-tpl-btn" data-id="${t.id}">Delete</button>
        </span>`;
      els.templateList.appendChild(row);
    });
    els.templateList.querySelectorAll('.apply-tpl-btn').forEach(b => b.addEventListener('click', () => {
      const t = window.VS.templates.get(b.dataset.id);
      if (t) applyConfigSnapshot(t);
    }));
    els.templateList.querySelectorAll('.del-tpl-btn').forEach(b => b.addEventListener('click', () => {
      if (!confirm('Delete this template?')) return;
      window.VS.templates.remove(b.dataset.id);
      renderTemplateList();
    }));
  }
  renderTemplateList();

  els.saveTemplateBtn.addEventListener('click', () => {
    const name = els.templateNameInput.value.trim();
    if (!name) { alert('Give the template a name first.'); return; }
    window.VS.templates.save({ name, ...currentConfigSnapshot() });
    els.templateNameInput.value = '';
    renderTemplateList();
  });

  // ============================================================
  // Crash-safe draft recovery — check for a partial recording left behind
  // by a tab crash/close during a previous session.
  // ============================================================
  (async function checkDraftRecovery() {
    try {
      const draft = await window.VS.storage.getDraft();
      if (!draft) return;
      // v0.13: the old banner lives inside the hidden Recordings tab, so after a crash nobody saw it. Show a top-of-screen notice too.
      const mins = draft.blob && draft.blob.size ? Math.max(1, Math.round(draft.blob.size / 1048576)) : 0;
      const html = `
        <strong>Unsaved recording found</strong> from ${(draft.meta && draft.meta.savedAt) || 'a previous session'} (about ${mins} MB). It looks like the tab closed before you pressed Stop.
        <div class="btn-row">
          <button class="btn primary xs recover-draft-btn" type="button" style="min-height:44px;">Recover to Projects</button>
          <button class="btn ghost xs discard-draft-btn" type="button" style="min-height:44px;">Discard</button>
        </div>`;
      const toast = document.createElement('div');
      toast.id = 'draftToast'; toast.setAttribute('role', 'alert'); toast.className = 'recovery-banner';
      toast.style.cssText = 'position:fixed;top:12px;left:50%;transform:translateX(-50%);z-index:9998;max-width:min(94vw,440px);background:#2a2412;color:#fff;box-shadow:0 8px 24px rgba(0,0,0,.5);';
      toast.innerHTML = html;
      document.body.appendChild(toast);
      els.draftRecoveryBanner.style.display = 'block';
      els.draftRecoveryBanner.className = 'recovery-banner';
      els.draftRecoveryBanner.innerHTML = html.replace('class="btn primary xs recover-draft-btn"', 'class="btn primary xs recover-draft-btn" id="recoverDraftBtn"').replace('class="btn ghost xs discard-draft-btn"', 'class="btn ghost xs discard-draft-btn" id="discardDraftBtn"');
      const hideBoth = () => { toast.remove(); els.draftRecoveryBanner.style.display = 'none'; };
      const recover = async () => {
        await window.VS.storage.saveRecording(draft.blob, { ...draft.meta, title: 'Recovered recording', createdAt: new Date().toLocaleString() });
        await window.VS.storage.clearDraft();
        hideBoth();
        alert('Recovered. Find it in Projects.');
      };
      const discard = async () => { await window.VS.storage.clearDraft(); hideBoth(); };
      document.querySelectorAll('.recover-draft-btn').forEach((b) => b.addEventListener('click', recover));
      document.querySelectorAll('.discard-draft-btn').forEach((b) => b.addEventListener('click', discard));
    } catch (e) { /* IndexedDB unavailable or draft store empty — nothing to recover */ }
  })();

  function focusLivePanel() {
    const liveTab = document.querySelector('.tool-tab[data-target="panel-live"]');
    if (liveTab) liveTab.click();
    document.getElementById('panel-live')?.scrollIntoView({ behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'nearest' });
  }
  els.quickRecordBtn?.addEventListener('click', () => {
    if (!running) startCamera(); else if (!recorder || recorder.state === 'inactive') startRecording();
  });
  els.quickLiveBtn?.addEventListener('click', focusLivePanel);
  els.transportLiveBtn?.addEventListener('click', focusLivePanel);
  els.startBtn.addEventListener('click', startCamera);
  els.stopBtn.addEventListener('click', stopCamera);

  showOverlay('idle');
  populateDevices();

  envProvider.hydrateFromStorage().then(() => {
    populateEnvironments();
    if (requestedTemplate) {
      const t = window.VS.templates.get(requestedTemplate);
      if (t) applyConfigSnapshot(t);
    } else if (requestedEnv) {
      els.envSelect.value = requestedEnv;
      renderEnvMiniGrid();
    }
    pushEnvironment(els.envSelect.value); // covers the plain-default case; redundant (harmless) if a branch above already pushed one
    if (requestedAction === 'start') setTimeout(() => startCamera(), 250);
    if (requestedAction === 'focus') toggleFocusMode();
  });
})();
