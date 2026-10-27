/**
 * onnxruntime-web loader: LOCAL FIRST (vendor/ort, shipped inside the app/APK), CDN only as a fallback.
 * Why: the old code fetched the runtime from a CDN on first use. On a phone with no/slow data that failed and the app
 * silently dropped to the light, blocky MediaPipe mask. Now the high-quality matting engine works offline from first launch.
 *
 *   VS.loadOrt() -> Promise<ort>   (idempotent; throws only if BOTH local and CDN fail)
 *
 * The runtime's .mjs helper files are shipped as .js and given by explicit URL, because some Android WebView asset servers
 * do not know the .mjs MIME type and a dynamic import() of a wrongly typed file fails. onnxruntime-web 1.25.1, MIT.
 */
(function () {
  window.VS = window.VS || {};
  const VER = '1.25.1';
  const LOCAL = 'vendor/ort/';
  const CDN = 'https://cdn.jsdelivr.net/npm/onnxruntime-web@' + VER + '/dist/';
  let pending = null;

  function absolute(p) { try { return new URL(p, document.baseURI).href; } catch (e) { return p; } }

  function configure(ort, local, gpuBuild) {
    if (!ort || !ort.env || !ort.env.wasm) return;
    const base = local ? absolute(LOCAL) : CDN;
    const stem = gpuBuild ? 'ort-wasm-simd-threaded.jsep' : 'ort-wasm-simd-threaded';
    ort.env.wasm.wasmPaths = local
      ? { mjs: base + stem + '.js', wasm: base + stem + '.wasm' }
      : base;
    // Threads need cross-origin isolation (SharedArrayBuffer). Without it ORT falls back to 1 thread by itself; asking for more is harmless.
    try { if (self.crossOriginIsolated) ort.env.wasm.numThreads = Math.max(1, Math.min(4, (navigator.hardwareConcurrency || 2) - 1)); } catch (e) { /* ignore */ }
    ort.env.wasm.proxy = false;
  }

  window.VS.loadOrt = function () {
    if (typeof ort !== 'undefined' && ort.InferenceSession) return Promise.resolve(ort);
    if (pending) return pending;
    pending = (async () => {
      const gpu = typeof navigator !== 'undefined' && !!navigator.gpu;
      const file = gpu ? 'ort.webgpu.min.js' : 'ort.min.js';
      const tries = [{ url: LOCAL + file, local: true }, { url: CDN + (gpu ? 'ort.webgpu.min.js' : 'ort.min.js'), local: false }];
      let lastErr = null;
      for (const t of tries) {
        try {
          await window.VS.loadScript(t.url);
          if (typeof ort === 'undefined') throw new Error('runtime script loaded but ort is undefined');
          configure(ort, t.local, gpu);
          window.VS.ortSource = t.local ? 'local' : 'cdn';
          return ort;
        } catch (e) { lastErr = e; }
      }
      pending = null;
      throw lastErr || new Error('onnxruntime-web could not be loaded (local and CDN both failed).');
    })();
    return pending;
  };
})();
