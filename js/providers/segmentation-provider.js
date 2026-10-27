/**
 * Genesis segmentation stack.
 *
 * Contract:
 *   initialize(qualityMode), segment(videoElement), dispose(), label, costPerFrame
 *
 * The default browser path is MediaPipe Tasks Vision ImageSegmenter because it
 * exposes an explicit GPU delegate and a modern VIDEO API. QUALITY additionally
 * requests the confidence mask for softer, more information-rich edges.
 * The legacy MediaPipe SelfieSegmentation solution remains as a compatibility
 * fallback when the Tasks bundle cannot be loaded or initialized.
 *
 * This keeps the free path genuinely local: no frame is uploaded for the
 * segmentation pipeline, and the provider can run on CPU when GPU is not available.
 */
const LUMA_DARK = 60;
const LUMA_OK = 115;
const MAX_BRIGHTNESS = 1.55;
const MAX_CONTRAST = 1.2;
const LUMA_SAMPLE_EVERY_MS = 500;

// Self-hosted first (same origin, cached by the service worker, no third-party round trip), CDN only as a fallback.
const VENDOR_SELFIE = 'vendor/mediapipe/selfie/';
const SELFIE_CDN = 'https://cdn.jsdelivr.net/npm/@mediapipe/selfie_segmentation@0.1.1675465747/';
// PINNED. The old code used an unversioned URL ("latest"), so a new MediaPipe release could change behaviour overnight.
const VENDOR_TASKS = 'vendor/mediapipe/tasks/';
const TASKS_VERSION = '0.10.21';
const TASKS_BUNDLE = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${TASKS_VERSION}/vision_bundle.js`;
const TASKS_WASM_URL = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${TASKS_VERSION}/wasm`;
const TASKS_MODEL_LANDSCAPE = 'https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_segmenter_landscape/float16/latest/selfie_segmenter_landscape.tflite';
const TASKS_MODEL_SQUARE = 'https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_segmenter/float16/latest/selfie_segmenter.tflite';

function withTimeoutMs(promise, ms, message) {
  let t;
  return Promise.race([
    promise,
    new Promise((_, rej) => { t = setTimeout(() => rej(new Error(message)), ms); }),
  ]).finally(() => clearTimeout(t));
}

function TasksVisionGlobals() {
  const scopes = [window.vision, window.Vision, window.TasksVision, window.MediapipeVision, window];
  for (const scope of scopes) {
    if (scope && scope.FilesetResolver && scope.ImageSegmenter) {
      return { FilesetResolver: scope.FilesetResolver, ImageSegmenter: scope.ImageSegmenter };
    }
  }
  return null;
}

class LowLightInputMixin {
  _initLowLight() {
    this.lowLightBoost = true;
    this._lumaCanvas = document.createElement('canvas');
    this._lumaCanvas.width = 20;
    this._lumaCanvas.height = 12;
    this._lumaCtx = this._lumaCanvas.getContext('2d', { willReadFrequently: true });
    this._boostCanvas = document.createElement('canvas');
    this._boostCtx = this._boostCanvas.getContext('2d');
    this._lastSampleAt = 0;
    this._currentBoost = 0;
    this.lastBoostApplied = false;
  }

  _measureLuma(videoElement) {
    this._lumaCtx.drawImage(videoElement, 0, 0, 20, 12);
    const { data } = this._lumaCtx.getImageData(0, 0, 20, 12);
    let sum = 0;
    for (let i = 0; i < data.length; i += 4) {
      sum += 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
    }
    return sum / (data.length / 4);
  }

  _prepareInput(videoElement) {
    if (!this.lowLightBoost) { this.lastBoostApplied = false; return videoElement; }
    const now = performance.now();
    if (now - this._lastSampleAt >= LUMA_SAMPLE_EVERY_MS) {
      this._lastSampleAt = now;
      const luma = this._measureLuma(videoElement);
      this._currentBoost = Math.min(1, Math.max(0, (LUMA_OK - luma) / (LUMA_OK - LUMA_DARK)));
    }
    if (this._currentBoost <= 0.01) { this.lastBoostApplied = false; return videoElement; }
    const w = videoElement.videoWidth, h = videoElement.videoHeight;
    if (!w || !h) { this.lastBoostApplied = false; return videoElement; }
    if (this._boostCanvas.width !== w || this._boostCanvas.height !== h) {
      this._boostCanvas.width = w;
      this._boostCanvas.height = h;
    }
    const brightness = 1 + (MAX_BRIGHTNESS - 1) * this._currentBoost;
    const contrast = 1 + (MAX_CONTRAST - 1) * this._currentBoost;
    this._boostCtx.filter = `brightness(${brightness.toFixed(2)}) contrast(${contrast.toFixed(2)})`;
    this._boostCtx.drawImage(videoElement, 0, 0, w, h);
    this._boostCtx.filter = 'none';
    this.lastBoostApplied = true;
    return this._boostCanvas;
  }
}

class MediaPipeTasksSegmentationProvider extends LowLightInputMixin {
  /** @param {'GPU'|'CPU'|null} delegate  null = try GPU, then CPU (old behaviour) */
  constructor(delegate) {
    super();
    this._initLowLight();
    this.delegateRequest = delegate || null;
    this.model = null;
    this.backend = 'tasks';
    this.maskMode = 'category';
    this.label = 'MediaPipe Tasks Selfie Segmenter · local';
    this.costPerFrame = 0;
    this.modelSelection = null;
    this.gpu = false;
    this._maskCanvas = document.createElement('canvas');
    this._maskCtx = this._maskCanvas.getContext('2d', { willReadFrequently: true });
  }

  async initialize(qualityMode) {
    let globals = TasksVisionGlobals();
    // v0.45: use the copy bundled in the app (vendor/mediapipe/tasks/, filled by scripts/vendor-tasks.js at build time) when it exists.
    const probe = async (u) => { try { const r = await fetch(u, { method: 'HEAD' }); return r.ok && !/text\/html/.test(r.headers.get('content-type') || ''); } catch (e) { return false; } };
    const localTasks = await probe(VENDOR_TASKS + 'vision_bundle.js') && await probe(VENDOR_TASKS + 'wasm/vision_wasm_internal.wasm');
    if (!globals) {
      // Loaded only now (not at page start), and pinned to a known version.
      if (localTasks) await window.VS.loadScript(VENDOR_TASKS + 'vision_bundle.js', { fallbacks: [TASKS_BUNDLE] });
      else await window.VS.loadScript(TASKS_BUNDLE);
      globals = TasksVisionGlobals();
    }
    if (!globals) throw new Error('MediaPipe Tasks Vision could not be loaded.');

    const vision = await globals.FilesetResolver.forVisionTasks(localTasks ? VENDOR_TASKS + 'wasm' : TASKS_WASM_URL);
    const useConfidence = qualityMode === 'quality';
    let modelAssetPath = useConfidence ? TASKS_MODEL_SQUARE : TASKS_MODEL_LANDSCAPE;
    const localModel = VENDOR_TASKS + (useConfidence ? 'selfie_segmenter.tflite' : 'selfie_segmenter_landscape.tflite');
    if (localTasks && await probe(localModel)) modelAssetPath = localModel;
    this.local = localTasks;

    const create = async (delegate) => globals.ImageSegmenter.createFromOptions(vision, {
      baseOptions: { modelAssetPath, delegate },
      runningMode: 'VIDEO',
      outputCategoryMask: !useConfidence,
      outputConfidenceMasks: useConfidence
    });

    if (this.delegateRequest) {
      this.model = await create(this.delegateRequest);
      this.gpu = this.delegateRequest === 'GPU';
    } else {
      try {
        this.model = await create('GPU');
        this.gpu = true;
      } catch (gpuErr) {
        this.model = await create('CPU');
        this.gpu = false;
      }
    }

    this.maskMode = useConfidence ? 'confidence' : 'category';
    this.modelSelection = useConfidence ? 'selfie-square-confidence' : 'selfie-landscape-category';
    this.label = `MediaPipe Tasks Selfie Segmenter · ${this.gpu ? 'GPU' : 'CPU'} · local`;
  }

  _copyMaskData(mask) {
    if (!mask) throw new Error('Segmentation completed without a usable mask.');
    const width = mask.width;
    const height = mask.height;
    if (!width || !height) throw new Error('Segmentation returned an empty mask.');

    const data = this.maskMode === 'confidence' ? mask.getAsFloat32Array() : mask.getAsUint8Array();
    if (this._maskCanvas.width !== width || this._maskCanvas.height !== height) {
      this._maskCanvas.width = width;
      this._maskCanvas.height = height;
    }
    const image = this._maskCtx.createImageData(width, height);
    const out = image.data;
    for (let i = 0, p = 0; i < data.length; i++, p += 4) {
      const alpha = this.maskMode === 'confidence'
        ? Math.max(0, Math.min(255, Math.round(data[i] * 255)))
        : (data[i] > 0 ? 255 : 0);
      out[p] = 255; out[p + 1] = 255; out[p + 2] = 255; out[p + 3] = alpha;
    }
    this._maskCtx.putImageData(image, 0, 0);
  }

  async segment(videoElement) {
    if (!this.model) throw new Error('Segmentation model is not initialized.');
    const input = this._prepareInput(videoElement);
    const started = performance.now();
    const bitmapPromise = new Promise((resolve, reject) => {
      try {
        this.model.segmentForVideo(input, Math.round(started), (result) => {
          try {
            // MediaPipe Tasks mask data is callback-scoped. Copy the typed-array
            // immediately while the result is valid, then build the transferable
            // ImageBitmap from our own reusable canvas.
            const mask = result.categoryMask || (result.confidenceMasks && result.confidenceMasks[0]);
            this._copyMaskData(mask);
            if (typeof result.close === 'function') result.close();
            createImageBitmap(this._maskCanvas).then(resolve, reject);
          } catch (err) {
            try { if (typeof result.close === 'function') result.close(); } catch (_) {}
            reject(err);
          }
        });
      } catch (err) {
        reject(err);
      }
    });
    return { image: input, segmentationMask: await bitmapPromise };
  }

  dispose() {
    if (this.model && typeof this.model.close === 'function') this.model.close();
    this.model = null;
  }
}

class LegacyMediaPipeSegmentationProvider extends LowLightInputMixin {
  constructor() {
    super();
    this._initLowLight();
    this.model = null;
    this._pendingResolve = null;
    this.label = 'MediaPipe Selfie Segmentation · legacy local';
    this.costPerFrame = 0;
    this.modelSelection = 1;
  }

  async initialize(qualityMode) {
    let base = VENDOR_SELFIE;
    if (typeof SelfieSegmentation === 'undefined') {
      const loaded = await window.VS.loadScript(VENDOR_SELFIE + 'selfie_segmentation.js', { fallbacks: [SELFIE_CDN + 'selfie_segmentation.js'] });
      base = loaded.indexOf('http') === 0 ? SELFIE_CDN : VENDOR_SELFIE;
    }
    if (typeof SelfieSegmentation === 'undefined') {
      throw new Error('No local segmentation engine could be loaded. Check your connection and reload Studio.');
    }
    this.model = new SelfieSegmentation({ locateFile: (file) => base + file });
    const MODEL_FOR_MODE = { fast: 1, balanced: 1, quality: 1 };
    const modelSelection = MODEL_FOR_MODE[qualityMode] === undefined ? 1 : MODEL_FOR_MODE[qualityMode];
    this.modelSelection = modelSelection;
    this.model.setOptions({ modelSelection, selfieMode: false });
    this.model.onResults((results) => {
      if (this._pendingResolve) {
        this._pendingResolve(results);
        this._pendingResolve = null;
      }
    });
    // Download the engine + model NOW and run one dummy frame, so the first real frame is instant.
    await this.model.initialize();
    const warm = document.createElement('canvas');
    warm.width = 256; warm.height = 144;
    const wctx = warm.getContext('2d');
    wctx.fillStyle = '#777'; wctx.fillRect(0, 0, 256, 144);
    await withTimeoutMs(this.segment(warm), 15000, 'Segmentation engine did not answer its warm-up frame.');
  }

  async segment(videoElement) {
    const input = this._prepareInput(videoElement);
    return new Promise((resolve, reject) => {
      this._pendingResolve = resolve;
      this.model.send({ image: input }).catch((err) => {
        this._pendingResolve = null;
        reject(err);
      });
    });
  }

  dispose() {
    if (this.model && this.model.close) this.model.close();
    this.model = null;
    this._pendingResolve = null;
  }
}

class MediaPipeSegmentationProvider {
  constructor() {
    this.backend = 'legacy';
    this.current = null;            // 'legacy' | 'tasks-cpu' | 'tasks-gpu'
    this.impl = null;
    this.model = null;
    this.modelSelection = null;
    this.lowLightBoost = true;
    this.lastBoostApplied = false;
    this.label = 'Local segmentation';
    this.costPerFrame = 0;
    this.lastCoverage = null;       // 0..1: how much of the frame the model thinks is a person (smoothed)
    this._calls = 0;
    this._tried = new Set();
    this._cov = document.createElement('canvas');
    this._cov.width = 24; this._cov.height = 14;
    this._covCtx = this._cov.getContext('2d', { willReadFrequently: true });
  }

  /**
   * Order matters. The self-hosted "legacy" engine goes first: it is verified, pinned, same-origin, and has no
   * dependence on Google's model servers. The Tasks engine (CPU before GPU: several phone GPUs return a WRONG
   * mask from the GPU delegate) is the fallback chain, and repair() walks it if the output looks wrong.
   */
  _order() {
    const all = ['legacy', 'tasks-cpu', 'tasks-gpu'];
    let pref = null;
    try { pref = localStorage.getItem('vs_seg_backend'); } catch (e) {}
    return pref && all.includes(pref) ? [pref].concat(all.filter((n) => n !== pref)) : all;
  }

  async _start(name) {
    let impl;
    if (name === 'legacy') impl = new LegacyMediaPipeSegmentationProvider();
    else impl = new MediaPipeTasksSegmentationProvider(name === 'tasks-gpu' ? 'GPU' : 'CPU');
    impl.lowLightBoost = this.lowLightBoost;
    await withTimeoutMs(impl.initialize(this._quality), 45000, 'Timed out loading the segmentation engine (' + name + ').');
    const old = this.impl;
    this.impl = impl;
    this.current = name;
    this.backend = name === 'legacy' ? 'legacy' : 'tasks';
    this._tried.add(name);
    this.lastCoverage = null;
    this._sync();
    if (old && old.dispose) { try { old.dispose(); } catch (e) {} }
  }

  async initialize(qualityMode) {
    this._quality = qualityMode;
    this.order = this._order();
    let lastErr = null;
    for (const name of this.order) {
      try {
        await this._start(name);
        return;
      } catch (err) {
        lastErr = err;
        this._tried.add(name);
        console.warn('Genesis: segmentation engine "' + name + '" failed, trying the next one.', err);
      }
    }
    throw lastErr || new Error('No segmentation engine could be started.');
  }

  /** Called when the mask looks wrong (empty for seconds). Starts the next untried engine; returns its name or null. */
  async repair() {
    const next = (this.order || this._order()).find((n) => !this._tried.has(n));
    if (!next) return null;
    try {
      await this._start(next);
      return next;
    } catch (err) {
      this._tried.add(next);
      console.warn('Genesis: repair engine "' + next + '" failed.', err);
      return this.repair();
    }
  }

  /** The current engine produced a sane mask while a person was in frame: remember it for next time. */
  confirmBackend() {
    try { localStorage.setItem('vs_seg_backend', this.current); } catch (e) {}
  }

  _sync() {
    this.model = this.impl?.model || null;
    this.modelSelection = this.impl?.modelSelection ?? null;
    this.label = this.impl?.label || 'Local segmentation';
    this.costPerFrame = this.impl?.costPerFrame ?? 0;
  }

  _measureCoverage(mask) {
    try {
      this._covCtx.clearRect(0, 0, 24, 14);
      this._covCtx.drawImage(mask, 0, 0, 24, 14);
      const d = this._covCtx.getImageData(0, 0, 24, 14).data;
      let sum = 0;
      for (let i = 3; i < d.length; i += 4) sum += d[i];
      const c = sum / (255 * (d.length / 4));
      this.lastCoverage = this.lastCoverage === null ? c : this.lastCoverage * 0.6 + c * 0.4;
    } catch (e) { /* keep the previous value */ }
  }

  async segment(videoElement) {
    if (!this.impl) throw new Error('Segmentation model is not initialized.');
    const result = await this.impl.segment(videoElement);
    this.lastBoostApplied = !!this.impl.lastBoostApplied;
    if ((this._calls++ & 1) === 0 && result && result.segmentationMask) this._measureCoverage(result.segmentationMask);
    return result;
  }

  dispose() {
    this.impl?.dispose?.();
    this.impl = null;
    this.model = null;
  }
}

class GPUCloudSegmentationProvider {
  constructor(endpointUrl, apiKey) {
    this.endpointUrl = endpointUrl;
    this.apiKey = apiKey;
    this.label = 'Cloud GPU matting (not connected)';
    this.costPerFrame = null;
  }
  async initialize() { throw new Error('GPUCloudSegmentationProvider is not implemented.'); }
  async segment() { throw new Error('GPUCloudSegmentationProvider.segment() not implemented.'); }
  dispose() {}
}

window.VS = window.VS || {};
window.VS.MediaPipeSegmentationProvider = MediaPipeSegmentationProvider;
window.VS.MediaPipeTasksSegmentationProvider = MediaPipeTasksSegmentationProvider;
window.VS.GPUCloudSegmentationProvider = GPUCloudSegmentationProvider;
