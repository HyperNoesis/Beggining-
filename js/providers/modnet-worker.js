/* MODNet inference worker. Loads onnxruntime-web (from vendor/ort, bundled) and the model INSIDE the worker, so loading, shader/wasm
 * compilation and inference never block the page's main thread (buttons stay responsive).
 * Protocol (all messages carry an id):
 *   {type:'init', base, modelUrl, gpu, ep?:'wasm'|'webgpu', profile?, fixed?:{w,h}, graphCapture?}           -> {type:'ready', gpu:boolean} | {type:'error', message}
 *   {type:'run', w, h, rgba:ArrayBuffer}         -> {type:'result', w, h, alpha:ArrayBuffer(uint8 w*h)} | {type:'error', message}
 *   {type:'dispose'}
 * Pre/post-processing is identical to modnet-provider.js (CHW float, (x-127.5)/127.5; alpha = round(clamp(v)*255)). */
'use strict';
let session = null, inName = 'input', outName = 'output', busy = false;
let profRecords = [], initNote = '';
let gc = null;   // graph-capture IO: {device, inBuf, outBuf, inT, outT, readBuf, h, w}

async function init(m) {
  const base = m.base;
  const gpu = !!m.gpu && m.ep !== 'wasm' && typeof navigator !== 'undefined' && !!navigator.gpu;
  importScripts(base + 'vendor/ort/' + (gpu ? 'ort.webgpu.min.js' : 'ort.min.js'));
  const stem = gpu ? 'ort-wasm-simd-threaded.jsep' : 'ort-wasm-simd-threaded';
  ort.env.wasm.wasmPaths = { mjs: base + 'vendor/ort/' + stem + '.js', wasm: base + 'vendor/ort/' + stem + '.wasm' };
  ort.env.wasm.numThreads = 1; ort.env.wasm.proxy = false;
  if (m.profile && gpu) { try { ort.env.webgpu.profiling = { mode: 'default', ondata: (d) => { if (profRecords.length < 20000) profRecords.push(d); } }; } catch (e) { /* profiling is optional */ } }
  if (gpu && m.graphCapture) await ownDevice();
  const res = await fetch(m.modelUrl);
  if (!res.ok) throw new Error('model HTTP ' + res.status);
  const bytes = new Uint8Array(await res.arrayBuffer());
  if (bytes.byteLength < 1000000) throw new Error('model file too small');
  let usedGpu = false, lastErr = null; initNote = '';
  for (const eps of (gpu ? [['webgpu'], ['wasm']] : [['wasm']]))   /* webgpu ALONE first: with ['webgpu','wasm'] ORT can silently pick wasm and we would mislabel it WebGPU */ {
    try {
      const so = { executionProviders: eps, graphOptimizationLevel: 'all' };
      if (m.fixed && m.fixed.w && m.fixed.h) so.freeDimensionOverrides = { batch_size: 1, height: m.fixed.h, width: m.fixed.w };   // static shape (needed for graph capture)
      if (m.graphCapture && eps[0] === 'webgpu' && so.freeDimensionOverrides) so.enableGraphCapture = true;
      session = await ort.InferenceSession.create(bytes, so); usedGpu = eps[0] === 'webgpu';
      if (so.enableGraphCapture && usedGpu) gc = await makeGcIo(m.fixed.h, m.fixed.w);   // graph capture requires GPU buffers for input AND output
      break;
    }
    catch (e) { lastErr = e; if (!initNote) initNote = String((e && e.message) || e).slice(0, 200); }
  }
  if (!session) throw lastErr || new Error('no execution provider worked');
  inName = (session.inputNames && session.inputNames[0]) || 'input';
  outName = (session.outputNames && session.outputNames[0]) || 'output';
  if (usedGpu) initNote = '';
  return usedGpu;
}

let ownDev = null;
/** ORT does not expose its internal device in this build, so for graph capture we create the device ourselves and hand it to ORT. */
async function ownDevice() {
  const adapter = (await navigator.gpu.requestAdapter()) || (await navigator.gpu.requestAdapter({ forceFallbackAdapter: true })); if (!adapter) throw new Error('no WebGPU adapter');
  const L = adapter.limits, want = {};
  for (const k of ['maxBufferSize', 'maxStorageBufferBindingSize', 'maxComputeWorkgroupStorageSize', 'maxComputeInvocationsPerWorkgroup', 'maxComputeWorkgroupSizeX', 'maxComputeWorkgroupSizeY', 'maxComputeWorkgroupSizeZ']) if (L[k] != null) want[k] = L[k];
  ownDev = await adapter.requestDevice({ requiredLimits: want });
  ort.env.webgpu.adapter = adapter; ort.env.webgpu.device = ownDev;
}
/** Graph capture needs external GPU buffers (ORT error: "External buffer must be provided for input/output index 0 when enableGraphCapture is true"). */
async function makeGcIo(h, w) {
  const device = ownDev; if (!device || !device.createBuffer) throw new Error('no WebGPU device for graph capture');
  const U = GPUBufferUsage, inBytes = 3 * h * w * 4, outBytes = h * w * 4;
  const inBuf = device.createBuffer({ size: inBytes, usage: U.STORAGE | U.COPY_DST | U.COPY_SRC });
  const outBuf = device.createBuffer({ size: outBytes, usage: U.STORAGE | U.COPY_DST | U.COPY_SRC });
  const readBuf = device.createBuffer({ size: outBytes, usage: U.MAP_READ | U.COPY_DST });
  return { device, inBuf, outBuf, readBuf, h, w, outBytes,
    inT: ort.Tensor.fromGpuBuffer(inBuf, { dataType: 'float32', dims: [1, 3, h, w] }),
    outT: ort.Tensor.fromGpuBuffer(outBuf, { dataType: 'float32', dims: [1, 1, h, w] }) };
}
async function runGc(m, chw) {
  const g = gc; if (m.w !== g.w || m.h !== g.h) throw new Error('graph capture size mismatch ' + m.w + 'x' + m.h + ' vs ' + g.w + 'x' + g.h);
  g.device.queue.writeBuffer(g.inBuf, 0, chw);
  await session.run({ [inName]: g.inT }, { [outName]: g.outT });
  const enc = g.device.createCommandEncoder(); enc.copyBufferToBuffer(g.outBuf, 0, g.readBuf, 0, g.outBytes); g.device.queue.submit([enc.finish()]);
  await g.readBuf.mapAsync(GPUMapMode.READ);
  const pha = new Float32Array(g.readBuf.getMappedRange().slice(0)); g.readBuf.unmap();
  return { dims: [1, 1, g.h, g.w], data: pha };
}

async function run(m) {
  const w = m.w, h = m.h, size = w * h, data = new Uint8ClampedArray(m.rgba);
  const chw = new Float32Array(3 * size);
  for (let i = 0; i < size; i++) { chw[i] = data[i * 4] / 127.5 - 1; chw[size + i] = data[i * 4 + 1] / 127.5 - 1; chw[2 * size + i] = data[i * 4 + 2] / 127.5 - 1; }
  let t;
  if (gc) t = await runGc(m, chw);
  else { const out = await session.run({ [inName]: new ort.Tensor('float32', chw, [1, 3, h, w]) }); t = out[outName] || out[Object.keys(out)[0]]; }
  const dims = t.dims || [1, 1, h, w], oh = dims[dims.length - 2], ow = dims[dims.length - 1];
  const pha = t.data, alpha = new Uint8Array(ow * oh);
  for (let i = 0; i < alpha.length; i++) { const v = pha[i]; alpha[i] = v <= 0 ? 0 : v >= 1 ? 255 : (v * 255 + 0.5) | 0; }
  return { w: ow, h: oh, alpha };
}

self.onmessage = async (ev) => {
  const m = ev.data, id = m.id;
  try {
    if (m.type === 'init') { const gpu = await init(m); self.postMessage({ id, type: 'ready', gpu, note: initNote }); }
    else if (m.type === 'run') { const r = await run(m); self.postMessage({ id, type: 'result', w: r.w, h: r.h, alpha: r.alpha.buffer }, [r.alpha.buffer]); }
    else if (m.type === 'profile-get') { const r = profRecords; profRecords = []; self.postMessage({ id, type: 'profile', records: r.map((d) => ({ kernelType: d.kernelType, kernelName: d.kernelName, startTime: d.startTime, endTime: d.endTime })) }); }
    else if (m.type === 'dispose') { try { if (gc) { gc.inBuf.destroy(); gc.outBuf.destroy(); gc.readBuf.destroy(); } session && session.release && session.release(); } catch (e) { /* ignore */ } session = null; gc = null; }  // ownDev stays alive for the worker's life (terminated on dispose)
  } catch (e) { self.postMessage({ id, type: 'error', message: String((e && e.message) || e).slice(0, 300) }); }
};
