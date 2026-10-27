/**
 * MODNetSegmentationProvider — MODNet (ZHKKKe/MODNet, AAAI 2022), portrait
 * MATTING (soft alpha, so hair/edges have real partial transparency), run
 * entirely in the browser through onnxruntime-web. No server, no per-use cost.
 *
 * WHY THIS IS THE DEFAULT QUALITY MODEL (and RVM is not):
 *  - LICENSE. MODNet's code, models and demos are Apache-2.0, which allows
 *    commercial use with attribution. RobustVideoMatting (rvm-provider.js)
 *    is GPL-3.0, and MatAnyone is non-commercial. See LICENSES.md. (This is
 *    an engineering summary, not legal advice — have a lawyer confirm before
 *    you charge money.)
 *  - It is a real matting network (~6.5M parameters), not a binary
 *    segmenter like MediaPipe's selfie model, so hair and soft edges carry
 *    actual alpha values for gl-matte.js to sharpen.
 *
 * It is a SINGLE-FRAME model (no recurrent memory like RVM), so flicker
 * control comes from gl-matte.js (motion-adaptive temporal smoothing).
 *
 * MODEL FILE. Tried in order:
 *   1. models/modnet.onnx   (same-origin; drop the file in /models for the
 *                            fastest, most reliable load — see models/README.txt)
 *   2. Hugging Face mirror of the Xenova ONNX export (fp32)
 *   3. Hugging Face fp16 export (WebGPU only)
 * If every source fails, app.js falls back to MediaPipe automatically.
 *
 * Output convention matches the other providers: the matte is painted into the
 * ALPHA channel of a canvas (white RGB) and returned as { segmentationMask }.
 */

const MODNET_SOURCES = [
  'models/modnet.onnx',
  'https://huggingface.co/Xenova/modnet/resolve/main/onnx/model.onnx',
  'https://huggingface.co/skillsafe-ai/modnet/resolve/main/onnx/model_fp16.onnx',
];

// Long edge (px) fed to the model per quality mode. MODNet wants sides that are
// multiples of 32; its reference size is 512.
const MODNET_QUALITY = {
  fast: 320,
  balanced: 448,
  quality: 512,
};

class MODNetSegmentationProvider {
  /** Model input size for a camera size and long edge (multiples of 32). Same rule as _configure. */
  static sizeFor(vw, vh, longEdge) {
    const scale = Math.min(1, longEdge / Math.max(vw, vh));
    return [Math.max(32, Math.round((vw * scale) / 32) * 32), Math.max(32, Math.round((vh * scale) / 32) * 32)];
  }
  constructor() {
    this.session = null;
    this.label = 'MODNet matting (local, free)';
    this.costPerFrame = 0;
    this.lowLightBoost = true;
    this.lastBoostApplied = false;
    this.usingWebGPU = false;
    this.onProgress = null;

    this._inputName = 'input';
    this._outputName = 'output';
    this._fixed512 = false;   // set if the exported graph only accepts 512x512
    this._mw = 0;
    this._mh = 0;
    this._inputCanvas = document.createElement('canvas');
    this._inputCtx = this._inputCanvas.getContext('2d', { willReadFrequently: true });
    this._outCanvas = document.createElement('canvas');
    this._outCtx = this._outCanvas.getContext('2d');
    this._outImageData = null;

    this._lumaCanvas = document.createElement('canvas');
    this._lumaCanvas.width = 20;
    this._lumaCanvas.height = 12;
    this._lumaCtx = this._lumaCanvas.getContext('2d', { willReadFrequently: true });
    this._lastSampleAt = 0;
    this._currentBoost = 0;
  }

  /** Fetch a model file once, reporting progress. Rejects fast on 404/HTML/tiny files. */
  async _download(url) {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 120000);
    try {
      const res = await fetch(url, { signal: ctl.signal });
      if (!res.ok) throw new Error('HTTP ' + res.status + ' for ' + url);
      if (/text\/html/i.test(res.headers.get('content-type') || '')) throw new Error('Not a model file: ' + url);
      const total = parseInt(res.headers.get('content-length') || '0', 10) || 26 * 1024 * 1024;
      let buf;
      if (res.body && res.body.getReader) {
        const reader = res.body.getReader();
        const chunks = [];
        let got = 0;
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          chunks.push(value);
          got += value.length;
          if (this.onProgress) this.onProgress(Math.min(0.99, got / total));
        }
        buf = new Uint8Array(got);
        let off = 0;
        for (const c of chunks) { buf.set(c, off); off += c.length; }
      } else {
        buf = new Uint8Array(await res.arrayBuffer());
      }
      if (buf.byteLength < 1000000) throw new Error('Model file too small: ' + url);
      return buf;
    } finally {
      clearTimeout(timer);
    }
  }

  _measureLuma(videoElement) {
    this._lumaCtx.drawImage(videoElement, 0, 0, 20, 12);
    const { data } = this._lumaCtx.getImageData(0, 0, 20, 12);
    let sum = 0;
    for (let i = 0; i < data.length; i += 4) sum += 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
    return sum / (data.length / 4);
  }

  async initialize(qualityMode) {
    try { await window.VS.loadOrt(); } catch (e) { /* reported just below */ }
    if (typeof ort === 'undefined') {
      throw new Error('onnxruntime-web failed to load (the bundled copy and the CDN both failed).');
    }
    this.longEdge = MODNET_QUALITY[qualityMode] || MODNET_QUALITY.balanced;

    const hasWebGPU = typeof navigator !== 'undefined' && !!navigator.gpu;
    let lastErr = null;
    for (const url of MODNET_SOURCES) {
      let bytes;
      try {
        bytes = await this._download(url);         // ONE download per source (never re-fetched per backend)
      } catch (err) {
        lastErr = err;
        continue;                                  // 404 / HTML fallback page / too slow -> next source
      }
      const isFp16 = /fp16/i.test(url);
      const attempts = hasWebGPU ? [['webgpu'], ['wasm']] : [['wasm']];   // webgpu ALONE first so a silent wasm fallback is never mislabelled WebGPU
      for (const eps of attempts) {
        if (isFp16 && eps.length === 1 && eps[0] === 'wasm') continue; // fp16 needs the GPU backend
        try {
          this.session = await ort.InferenceSession.create(bytes, {
            executionProviders: eps,
            graphOptimizationLevel: 'all',
          });
          this.usingWebGPU = eps[0] === 'webgpu';
          break;
        } catch (err) {
          lastErr = err;
        }
      }
      if (this.session) break;
    }
    if (!this.session) throw lastErr || new Error('MODNet: all model sources failed to load.');

    this._inputName = (this.session.inputNames && this.session.inputNames[0]) || 'input';
    this._outputName = (this.session.outputNames && this.session.outputNames[0]) || 'output';
    this.label = `MODNet matting (local, free${this.usingWebGPU ? ', WebGPU' : ', WASM'})`;
    this._mw = 0; this._mh = 0;
  }

  _configure(vw, vh) {
    let mw, mh;
    if (this._fixed512) {
      mw = 512; mh = 512;
    } else {
      const scale = Math.min(1, this.longEdge / Math.max(vw, vh));
      mw = Math.max(32, Math.round((vw * scale) / 32) * 32);
      mh = Math.max(32, Math.round((vh * scale) / 32) * 32);
    }
    if (mw !== this._mw || mh !== this._mh) {
      this._mw = mw; this._mh = mh;
      this._inputCanvas.width = mw;
      this._inputCanvas.height = mh;
    }
  }

  _draw(videoElement) {
    if (this.lowLightBoost) {
      const now = performance.now();
      if (now - this._lastSampleAt >= 500) {
        this._lastSampleAt = now;
        const luma = this._measureLuma(videoElement);
        this._currentBoost = Math.min(1, Math.max(0, (115 - luma) / (115 - 60)));
      }
      if (this._currentBoost > 0.01) {
        this._inputCtx.filter = `brightness(${(1 + 0.55 * this._currentBoost).toFixed(2)}) contrast(${(1 + 0.2 * this._currentBoost).toFixed(2)})`;
        this.lastBoostApplied = true;
      } else {
        this._inputCtx.filter = 'none';
        this.lastBoostApplied = false;
      }
    } else {
      this._inputCtx.filter = 'none';
      this.lastBoostApplied = false;
    }
    this._inputCtx.drawImage(videoElement, 0, 0, this._mw, this._mh);
    this._inputCtx.filter = 'none';
    return this._inputCtx.getImageData(0, 0, this._mw, this._mh).data;
  }

  async _run(videoElement) {
    const data = this._draw(videoElement);
    const mw = this._mw, mh = this._mh, size = mw * mh;
    // HWC uint8 RGBA -> CHW float32 RGB, normalised to [-1, 1] (MODNet's preprocessing: mean 0.5, std 0.5)
    const chw = new Float32Array(3 * size);
    for (let i = 0; i < size; i++) {
      chw[i] = data[i * 4] / 127.5 - 1;
      chw[size + i] = data[i * 4 + 1] / 127.5 - 1;
      chw[2 * size + i] = data[i * 4 + 2] / 127.5 - 1;
    }
    const out = await this.session.run({ [this._inputName]: new ort.Tensor('float32', chw, [1, 3, mh, mw]) });
    return out[this._outputName] || out[Object.keys(out)[0]];
  }

  async segment(videoElement) {
    const vw = videoElement.videoWidth, vh = videoElement.videoHeight;
    if (!vw || !vh) throw new Error('Video has no dimensions yet');
    this._configure(vw, vh);

    let t;
    try {
      t = await this._run(videoElement);
    } catch (err) {
      // Some exports are fixed at 512x512. Retry once in that mode before giving up.
      if (!this._fixed512) {
        this._fixed512 = true;
        this._configure(vw, vh);
        t = await this._run(videoElement);
      } else {
        throw err;
      }
    }

    const dims = t.dims || [1, 1, this._mh, this._mw];
    const oh = dims[dims.length - 2], ow = dims[dims.length - 1];
    if (this._outCanvas.width !== ow || this._outCanvas.height !== oh || !this._outImageData) {
      this._outCanvas.width = ow; this._outCanvas.height = oh;
      this._outImageData = this._outCtx.createImageData(ow, oh);
    }
    const pha = t.data;
    const rgba = this._outImageData.data;
    const n = ow * oh;
    for (let i = 0; i < n; i++) {
      const o = i * 4;
      rgba[o] = 255; rgba[o + 1] = 255; rgba[o + 2] = 255;
      const v = pha[i];
      rgba[o + 3] = v <= 0 ? 0 : v >= 1 ? 255 : (v * 255 + 0.5) | 0;
    }
    this._outCtx.putImageData(this._outImageData, 0, 0);
    return { segmentationMask: this._outCanvas };
  }

  dispose() {
    if (this.session && this.session.release) this.session.release();
    this.session = null;
  }
}

window.VS = window.VS || {};
window.VS.MODNetSegmentationProvider = MODNetSegmentationProvider;

/**
 * MODNetWorkerProvider: same interface as MODNetSegmentationProvider, but model loading and inference run in a Web Worker
 * (js/providers/modnet-worker.js), so the page never freezes while the high-quality model loads or is speed-tested.
 * The main thread only draws the camera frame to a small canvas, reads its pixels, and paints the returned alpha.
 * Falls back (isSupported() false) where Workers are unavailable; app.js then uses the in-page provider.
 */
class MODNetWorkerProvider extends MODNetSegmentationProvider {
  constructor() { super(); this.label = 'MODNet matting (background worker)'; this._worker = null; this._seq = 0; this._pending = new Map(); this._ready = false; }
  static isSupported() { return typeof Worker !== 'undefined'; }
  _send(msg, transfer) {
    return new Promise((resolve, reject) => {
      const id = ++this._seq; this._pending.set(id, { resolve, reject });
      try { this._worker.postMessage(Object.assign({ id }, msg), transfer || []); } catch (e) { this._pending.delete(id); reject(e); }
    });
  }
  async initialize(qualityMode, opts) {
    opts = opts || {};
    if (!(opts.ep && this.longEdge)) this.longEdge = MODNET_QUALITY[qualityMode] || MODNET_QUALITY.balanced;   // experiments pass ep + a preset edge
    const base = new URL('.', document.baseURI).href;
    this._worker = new Worker(new URL('js/providers/modnet-worker.js', base).href);
    this._worker.onmessage = (ev) => { const m = ev.data, p = this._pending.get(m.id); if (!p) return; this._pending.delete(m.id); m.type === 'error' ? p.reject(new Error(m.message)) : p.resolve(m); };
    this._worker.onerror = (ev) => { const err = new Error('MODNet worker crashed: ' + (ev && ev.message || 'unknown')); for (const p of this._pending.values()) p.reject(err); this._pending.clear(); };
    const r = await this._send({ type: 'init', base, modelUrl: new URL(MODNET_SOURCES[0], base).href, gpu: typeof navigator !== 'undefined' && !!navigator.gpu, ep: opts.ep, profile: !!opts.profile, fixed: opts.fixed || null, graphCapture: !!opts.graphCapture });
    this.usingWebGPU = !!r.gpu; this.initNote = r.note || ''; this._ready = true;
    this.label = 'MODNet matting (background worker, ' + (this.usingWebGPU ? 'WebGPU' : 'WASM') + ')';
    this._mw = 0; this._mh = 0;
  }
  async profileGet() { const r = await this._send({ type: 'profile-get' }); return r.records || []; }
  async segment(videoElement) {
    const vw = videoElement.videoWidth, vh = videoElement.videoHeight;
    if (!vw || !vh) throw new Error('Video has no dimensions yet');
    if (!this._ready) throw new Error('MODNet worker not ready');
    this._configure(vw, vh);
    const data = this._draw(videoElement);                       // small canvas readback on the main thread (about 1-2 ms)
    const copy = new Uint8ClampedArray(data).buffer;             // own buffer to transfer (getImageData's can be shared)
    const r = await this._send({ type: 'run', w: this._mw, h: this._mh, rgba: copy }, [copy]);
    const ow = r.w, oh = r.h;
    if (this._outCanvas.width !== ow || this._outCanvas.height !== oh || !this._outImageData) { this._outCanvas.width = ow; this._outCanvas.height = oh; this._outImageData = this._outCtx.createImageData(ow, oh); }
    const a = new Uint8Array(r.alpha), rgba = this._outImageData.data;
    for (let i = 0, n = ow * oh; i < n; i++) { const o = i * 4; rgba[o] = 255; rgba[o + 1] = 255; rgba[o + 2] = 255; rgba[o + 3] = a[i]; }
    this._outCtx.putImageData(this._outImageData, 0, 0);
    return { segmentationMask: this._outCanvas };
  }
  dispose() { try { this._worker && this._worker.postMessage({ type: 'dispose' }); this._worker && this._worker.terminate(); } catch (e) { /* ignore */ } this._worker = null; this._ready = false; this.session = null; }
}
window.VS.MODNetWorkerProvider = MODNetWorkerProvider;
