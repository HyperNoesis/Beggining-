/* MODNet inference worker. Loads onnxruntime-web (from vendor/ort, bundled) and the model INSIDE the worker, so loading, shader/wasm
 * compilation and inference never block the page's main thread (buttons stay responsive).
 * Protocol (all messages carry an id):
 *   {type:'init', base, modelUrl, gpu}           -> {type:'ready', gpu:boolean} | {type:'error', message}
 *   {type:'run', w, h, rgba:ArrayBuffer}         -> {type:'result', w, h, alpha:ArrayBuffer(uint8 w*h)} | {type:'error', message}
 *   {type:'dispose'}
 * Pre/post-processing is identical to modnet-provider.js (CHW float, (x-127.5)/127.5; alpha = round(clamp(v)*255)). */
'use strict';
let session = null, inName = 'input', outName = 'output', busy = false;

async function init(m) {
  const base = m.base;
  const gpu = !!m.gpu && typeof navigator !== 'undefined' && !!navigator.gpu;
  importScripts(base + 'vendor/ort/' + (gpu ? 'ort.webgpu.min.js' : 'ort.min.js'));
  const stem = gpu ? 'ort-wasm-simd-threaded.jsep' : 'ort-wasm-simd-threaded';
  ort.env.wasm.wasmPaths = { mjs: base + 'vendor/ort/' + stem + '.js', wasm: base + 'vendor/ort/' + stem + '.wasm' };
  ort.env.wasm.numThreads = 1; ort.env.wasm.proxy = false;
  const res = await fetch(m.modelUrl);
  if (!res.ok) throw new Error('model HTTP ' + res.status);
  const bytes = new Uint8Array(await res.arrayBuffer());
  if (bytes.byteLength < 1000000) throw new Error('model file too small');
  let usedGpu = false, lastErr = null;
  for (const eps of (gpu ? [['webgpu', 'wasm'], ['wasm']] : [['wasm']])) {
    try { session = await ort.InferenceSession.create(bytes, { executionProviders: eps, graphOptimizationLevel: 'all' }); usedGpu = eps[0] === 'webgpu'; break; }
    catch (e) { lastErr = e; }
  }
  if (!session) throw lastErr || new Error('no execution provider worked');
  inName = (session.inputNames && session.inputNames[0]) || 'input';
  outName = (session.outputNames && session.outputNames[0]) || 'output';
  return usedGpu;
}

async function run(m) {
  const w = m.w, h = m.h, size = w * h, data = new Uint8ClampedArray(m.rgba);
  const chw = new Float32Array(3 * size);
  for (let i = 0; i < size; i++) { chw[i] = data[i * 4] / 127.5 - 1; chw[size + i] = data[i * 4 + 1] / 127.5 - 1; chw[2 * size + i] = data[i * 4 + 2] / 127.5 - 1; }
  const out = await session.run({ [inName]: new ort.Tensor('float32', chw, [1, 3, h, w]) });
  const t = out[outName] || out[Object.keys(out)[0]];
  const dims = t.dims || [1, 1, h, w], oh = dims[dims.length - 2], ow = dims[dims.length - 1];
  const pha = t.data, alpha = new Uint8Array(ow * oh);
  for (let i = 0; i < alpha.length; i++) { const v = pha[i]; alpha[i] = v <= 0 ? 0 : v >= 1 ? 255 : (v * 255 + 0.5) | 0; }
  return { w: ow, h: oh, alpha };
}

self.onmessage = async (ev) => {
  const m = ev.data, id = m.id;
  try {
    if (m.type === 'init') { const gpu = await init(m); self.postMessage({ id, type: 'ready', gpu }); }
    else if (m.type === 'run') { const r = await run(m); self.postMessage({ id, type: 'result', w: r.w, h: r.h, alpha: r.alpha.buffer }, [r.alpha.buffer]); }
    else if (m.type === 'dispose') { try { session && session.release && session.release(); } catch (e) { /* ignore */ } session = null; }
  } catch (e) { self.postMessage({ id, type: 'error', message: String((e && e.message) || e).slice(0, 300) }); }
};
