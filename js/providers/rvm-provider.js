/**
 * RVMSegmentationProvider — Robust Video Matting (PeterL1n/RobustVideoMatting),
 * mobilenetv3 ONNX export, run entirely in-browser via onnxruntime-web.
 *
 * WHY THIS OVER MediaPipeSegmentationProvider (see that file):
 * RVM is a recurrent network built specifically for VIDEO, not single
 * frames — it carries a memory of the last frame forward (the r1i..r4i
 * ConvGRU state tensors below) into the next inference call. That's what
 * gives it visibly less frame-to-frame edge flicker than MediaPipe's mask,
 * plus a genuine high-resolution refinement pass for hair/edge detail (see
 * QUALITY_CONFIG below — the model analyzes a downsampled frame cheaply,
 * then refines the alpha matte back up at the full resolution we feed it).
 *
 * LICENSE — READ THIS BEFORE SHIPPING BEYOND A PERSONAL PROJECT:
 * RobustVideoMatting is released by its authors (PeterL1n / ByteDance)
 * under GPL-3.0, not MIT or Apache. This file doesn't bundle any of their
 * code — it only fetches their published .onnx WEIGHTS file at runtime
 * (from a CORS-enabled re-host of that same release asset — see
 * RVM_MODEL_SOURCES below for why) — but GPL-3.0's copyleft terms are a real
 * consideration for a commercial product, not just a formality. If Genesis
 * (or anything built on it) becomes more than a personal/hobby deployment,
 * get an actual read on whether that matters for your case before relying
 * on this long-term. MediaPipe's segmentation model (Apache-2.0) has no
 * such question mark, at the cost of the quality this file exists to fix.
 *
 * PERFORMANCE — HONEST LIMIT:
 * This runs a real neural net on every frame, client-side. WebGPU (used
 * automatically when the browser supports it) makes this genuinely fast;
 * without it, this falls back to WASM, which is noticeably heavier than
 * MediaPipe's model on old/low-end phones. QUALITY mode in particular can
 * struggle on hardware from before ~2021. If FPS tanks, drop to BALANCED
 * or FAST — see QUALITY_CONFIG.
 */

// Model source(s), tried in order. WHY NOT THE OFFICIAL GITHUB RELEASE URL
// FIRST: verified against real traffic (Sep 2026) — github.com/.../releases/
// download/... 302-redirects to a host that sends no Access-Control-Allow-
// Origin header at all, so a browser fetch() (which is what
// ort.InferenceSession.create(url) does under the hood) is blocked by CORS
// before a single byte arrives. This isn't a flaky/occasional failure, it's
// a hard block on every browser, every time — so this used to silently and
// permanently fall back to MediaPipe on every load, never actually running
// RVM despite the code otherwise being correct. The Hugging Face mirror
// below serves the identical weights (same file, re-hosted, hash-checked
// against the official release when this was written) from a CDN that does
// send Access-Control-Allow-Origin: *, which is why it's listed first. The
// GitHub URL is kept as a second attempt, not a currently-working path,
// purely so this self-heals for free if GitHub ever adds CORS support.
const RVM_MODEL_SOURCES = [
  'https://huggingface.co/LPDoctor/video_matting/resolve/main/rvm_mobilenetv3_fp32.onnx',
  'https://github.com/PeterL1n/RobustVideoMatting/releases/download/v1.0.0/rvm_mobilenetv3_fp32.onnx',
];

// Per quality mode: how large a frame (long edge, px) we hand the model, and
// the downsample_ratio RVM uses internally for its own cheap stage-1 pass.
// Per RVM's own docs: keep (long edge * downsample_ratio) roughly in the
// 256-512 range for stage 1; stage 2 then refines the alpha at the FULL
// size we gave it, which is where the crisp edges actually come from — so
// raising longEdge (not just lowering downsampleRatio) is what buys sharper
// hair/edges, at a real, honest compute cost.
const QUALITY_CONFIG = {
  fast:     { longEdge: 512,  downsampleRatio: 1.0 },
  balanced: { longEdge: 768,  downsampleRatio: 0.5 },
  quality:  { longEdge: 1024, downsampleRatio: 0.375 },
};

class RVMSegmentationProvider {
  constructor() {
    this.session = null;
    this.label = 'Robust Video Matting (local, free)';
    this.costPerFrame = 0;
    this.lowLightBoost = true;
    this.lastBoostApplied = false;

    this._rec = null;           // [r1i, r2i, r3i, r4i] ort.Tensor — the model's memory
    this._modelW = 0;
    this._modelH = 0;
    this._inputCanvas = document.createElement('canvas');
    this._inputCtx = this._inputCanvas.getContext('2d', { willReadFrequently: true });
    this._outCanvas = document.createElement('canvas');
    this._outCtx = this._outCanvas.getContext('2d');
    this._outImageData = null;

    // Independent copy of the same low-light measurement used by
    // MediaPipeSegmentationProvider (see that file for the full rationale).
    // Duplicated rather than shared so this provider has zero dependency on
    // the other one and can be dropped/swapped cleanly.
    this._lumaCanvas = document.createElement('canvas');
    this._lumaCanvas.width = 20;
    this._lumaCanvas.height = 12;
    this._lumaCtx = this._lumaCanvas.getContext('2d', { willReadFrequently: true });
    this._lastSampleAt = 0;
    this._currentBoost = 0;
  }

  _measureLuma(videoElement) {
    this._lumaCtx.drawImage(videoElement, 0, 0, 20, 12);
    const { data } = this._lumaCtx.getImageData(0, 0, 20, 12);
    let sum = 0;
    const pixels = data.length / 4;
    for (let i = 0; i < data.length; i += 4) {
      sum += 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
    }
    return sum / pixels;
  }

  async initialize(qualityMode) {
    try { await window.VS.loadOrt(); } catch (e) { /* reported just below */ }
    if (typeof ort === 'undefined') throw new Error('onnxruntime-web failed to load (the bundled copy and the CDN both failed).');
    this.config = QUALITY_CONFIG[qualityMode] || QUALITY_CONFIG.balanced;


    // WebGPU when the browser genuinely has it; WASM otherwise. If WebGPU
    // is reported as present but this bundle/browser combination can't
    // actually stand up that execution provider, retry WASM-only before
    // giving up — a WebGPU hiccup shouldn't cost the whole RVM upgrade and
    // fall all the way back to MediaPipe.
    const hasWebGPU = typeof navigator !== 'undefined' && !!navigator.gpu;
    let lastErr = null;
    sourceLoop:
    for (const modelUrl of RVM_MODEL_SOURCES) {
      try {
        this.session = await ort.InferenceSession.create(modelUrl, {
          executionProviders: hasWebGPU ? ['webgpu', 'wasm'] : ['wasm'],
          graphOptimizationLevel: 'all',
        });
        this.usingWebGPU = hasWebGPU;
        break sourceLoop;
      } catch (err) {
        if (hasWebGPU) {
          console.warn(`RVM: WebGPU execution provider unavailable for ${modelUrl}, retrying on WASM:`, err.message);
          try {
            this.session = await ort.InferenceSession.create(modelUrl, {
              executionProviders: ['wasm'],
              graphOptimizationLevel: 'all',
            });
            this.usingWebGPU = false;
            break sourceLoop;
          } catch (wasmErr) {
            lastErr = wasmErr;
            continue;
          }
        }
        lastErr = err;
        // This source failed outright (network/CORS/404) — try the next one,
        // if any, rather than giving up on RVM entirely over one bad host.
      }
    }
    if (!this.session) throw lastErr || new Error('RVM: all model sources failed to load.');
    this.label = `Robust Video Matting (local, free${this.usingWebGPU ? ', WebGPU' : ', WASM'})`;

    this._modelW = 0;
    this._modelH = 0; // forces the size + recurrent-state setup on the first real frame
    this._resetRecurrentState();
  }

  _resetRecurrentState() {
    // Per RVM's own ONNX spec: these tiny all-zero placeholder tensors mean
    // "no memory yet" to the model — real, resolution-matched state tensors
    // come back as r1o..r4o from frame 1 onward and get recycled from there.
    const zero = () => new ort.Tensor('float32', new Float32Array([0]), [1, 1, 1, 1]);
    this._rec = [zero(), zero(), zero(), zero()];
  }

  /** Draws (and, if needed, low-light-boosts) the current frame into the
   *  model-input canvas at the resolution this quality mode uses, and
   *  returns its ImageData. Returns null if the video has no size yet. */
  _prepareInput(videoElement) {
    const vw = videoElement.videoWidth, vh = videoElement.videoHeight;
    if (!vw || !vh) return null;

    const scale = Math.min(1, this.config.longEdge / Math.max(vw, vh));
    // Even dimensions — the exported conv graph assumes this, same as most
    // ONNX vision models.
    const mw = Math.max(2, Math.round((vw * scale) / 2) * 2);
    const mh = Math.max(2, Math.round((vh * scale) / 2) * 2);

    if (mw !== this._modelW || mh !== this._modelH) {
      this._modelW = mw;
      this._modelH = mh;
      this._inputCanvas.width = mw;
      this._inputCanvas.height = mh;
      this._outCanvas.width = mw;
      this._outCanvas.height = mh;
      this._outImageData = this._outCtx.createImageData(mw, mh);
      // A resolution change invalidates the recurrent state's spatial
      // shape — reset to the zero placeholders rather than error on the
      // next ConvGRU concat.
      this._resetRecurrentState();
    }

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
    this._inputCtx.drawImage(videoElement, 0, 0, mw, mh);
    this._inputCtx.filter = 'none';
    return this._inputCtx.getImageData(0, 0, mw, mh);
  }

  async segment(videoElement) {
    const imageData = this._prepareInput(videoElement);
    if (!imageData) throw new Error('Video has no dimensions yet');
    const { data, width: mw, height: mh } = imageData;

    // HWC uint8 RGBA -> CHW float32 RGB 0..1 — RVM's documented input layout.
    const size = mw * mh;
    const chw = new Float32Array(3 * size);
    for (let i = 0; i < size; i++) {
      chw[i] = data[i * 4] / 255;
      chw[size + i] = data[i * 4 + 1] / 255;
      chw[2 * size + i] = data[i * 4 + 2] / 255;
    }

    const feeds = {
      src: new ort.Tensor('float32', chw, [1, 3, mh, mw]),
      r1i: this._rec[0], r2i: this._rec[1], r3i: this._rec[2], r4i: this._rec[3],
      downsample_ratio: new ort.Tensor('float32', new Float32Array([this.config.downsampleRatio]), [1]),
    };

    const out = await this.session.run(feeds);
    this._rec = [out.r1o, out.r2o, out.r3o, out.r4o]; // carry memory into next frame

    // pha is [1,1,H,W] float32 0..1. The rest of this app's pipeline
    // (mask-refine.js, render-core.js) reads mask meaning from the ALPHA
    // channel of a canvas — same convention MediaPipe's own segmentationMask
    // output uses — so paint pha into alpha over solid white RGB.
    const pha = out.pha.data;
    const rgba = this._outImageData.data;
    for (let i = 0; i < size; i++) {
      const o = i * 4;
      rgba[o] = 255; rgba[o + 1] = 255; rgba[o + 2] = 255;
      rgba[o + 3] = Math.max(0, Math.min(255, Math.round(pha[i] * 255)));
    }
    this._outCtx.putImageData(this._outImageData, 0, 0);

    return { segmentationMask: this._outCanvas };
  }

  dispose() {
    if (this.session && this.session.release) this.session.release();
    this.session = null;
    this._rec = null;
  }
}

window.VS = window.VS || {};
window.VS.RVMSegmentationProvider = RVMSegmentationProvider;
