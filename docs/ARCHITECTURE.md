# Architecture — Current State (v0.1, zero-cost build)

## Pipeline (what's real right now)

```
Camera (getUserMedia)
  -> MediaPipeSegmentationProvider (local, free, runs on your CPU/GPU)
  -> alpha-cutout compositing (Canvas 2D, destination-in trick)
  -> StaticEnvironmentProvider (gradients or your uploaded image)
  -> live <canvas> preview
  -> optional: MediaRecorder -> downloadable .webm
```

Nothing here requires an API key, a server, or a monthly bill. It runs by
opening index.html in a browser.

## What's NOT built yet, on purpose (per the "no fake demo" rule)

These are visible in the UI as disabled/labeled-honest, not faked:
- ULTRA quality mode (needs a real paid GPU matting provider)
- Native virtual camera output (a REAL system camera device) — no Web API
  lets a page register one; the free workaround (OBS Browser Source ->
  OBS Virtual Camera -> Zoom/Meet) is documented in
  docs/VIRTUAL_CAMERA_SETUP.md instead
- Accounts, billing, server-side storage

Text-to-environment generation and live streaming are no longer on this
list — both are real:
- Text-to-environment: Pollinations.ai (free, no key). See docs/MODEL_PROVIDER.md.
- Live streaming: WHIP publisher in js/providers/stream-provider.js. Real
  WebRTC out, but it is not RTMP — it needs a WHIP-compatible ingest URL
  (self-hosted MediaMTX/OvenMediaEngine are the free path; Cloudflare
  Stream/Mux are the paid path). Full honest limits at the top of that file.

Each of these has a real cost or a real chunk of engineering behind it —
see docs/MODEL_PROVIDER.md for exact swap-in points and rough pricing.

## Provider abstraction

`js/providers/segmentation-provider.js` and `js/providers/environment-provider.js`
define the interface every backend must implement. `app.js` only talks to
the interface, never to MediaPipe directly. This is what lets you replace
the free local model with a paid cloud model later by writing one new class
and changing one line in `app.js` (`new window.VS.MediaPipeSegmentationProvider()`
becomes `new window.VS.GPUCloudSegmentationProvider(endpoint, apiKey)`) —
not a rewrite of the app.

## Quality modes

FAST / BALANCED / QUALITY change the output canvas resolution, and FAST
additionally switches on a lighter pipeline. ULTRA is disabled until a GPU
provider actually exists, rather than silently falling back to the free model
and pretending it's something else.

What each lever really is (v0.29):
- **Canvas size** — 480x360 / 640x480 / 960x720. Real, and the same in every build.
- **MediaPipe model** — all three modes currently use `modelSelection: 1`
  (the landscape model, 144x256 input, fewer FLOPs). Earlier docs claimed the
  modes differed here; they did not in BALANCED/QUALITY, and FAST was
  accidentally on the heavier model 0 until v0.29. See MODEL_FOR_MODE in
  segmentation-provider.js.
- **FAST only:** skips the despeckle pass and light-wrap glow
  (`setPerf` -> `lite` in render-core.js), and if measured FPS still can't
  hold, refreshes the mask on every other frame (`decideDegradeAction` in
  perf-profile.js). The person pixels are always fresh; only the cutout edge
  refreshes less often.

## Genesis v0.3 segmentation path

The browser-local default now prefers MediaPipe Tasks Vision `ImageSegmenter` in VIDEO mode with a GPU delegate when initialization succeeds. FAST/BALANCED use the landscape SelfieSegmenter model with a category mask; QUALITY uses the square SelfieSegmenter model and requests the confidence mask to preserve softer boundaries before the existing mask-refinement pipeline. When the Tasks bundle or its GPU initialization fails, Genesis falls back to the legacy MediaPipe Selfie Segmentation provider; when GPU is unavailable, Tasks can initialize with CPU instead.

This choice is intentionally pragmatic rather than a claim that one model is universally best: the browser stack exposes GPU execution, explicit video segmentation APIs, and CPU fallbacks, while heavier ONNX background-removal models such as RMBG-1.4 have materially larger browser payloads (for example, public ONNX variants are tens to hundreds of MB). The next benchmark phase should measure edge quality, latency, memory, and sustained FPS on the actual Genesis camera workflow before enabling any heavier local model by default.

The renderer remains split from inference: camera capture and segmentation stay on the main browser pipeline, while refinement, realism, compositing, overlays, and final canvas drawing can run through the existing Worker + OffscreenCanvas path. Frames are scheduled newest-first and the app's adaptive quality logic remains responsible for stride/fallback changes.
