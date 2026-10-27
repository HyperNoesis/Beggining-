# v0.9: startup speed, self-hosting and the empty-scene fix

## What was wrong
- Studio loaded FOUR third-party scripts at page start (MediaPipe Tasks, MediaPipe legacy, onnxruntime, Supabase),
  each blocking the page. On a slow connection, nothing worked until all of them arrived.
- The MediaPipe Tasks URL was unversioned ("latest"), so a new release could silently change behaviour.
- A real phone screenshot showed the camera ON but nobody in the scene. Cause (most likely, see below): the model
  returned an empty mask and the app had no way to notice, so it showed an empty room.

## What changed
1. Self-hosted engine: vendor/mediapipe/selfie/ (Apache-2.0) is the DEFAULT engine, same origin, pinned, cached by the
   service worker (cache-first). The Tasks engine is now a pinned (0.10.21), lazily loaded fallback (CPU before GPU).
2. Nothing heavy blocks the page any more. onnxruntime loads only when MODNet is actually used; Supabase loads only
   if real accounts are configured in js/config.js.
3. Preload + warm-up: the engine downloads and runs a dummy frame while the page is idle, so Start is fast.
4. Auto-start: if the camera is already allowed on the device, Studio starts by itself (toggle in the model panel).
5. Mask watchdog: if the mask stays empty for a few seconds the app switches engine (legacy -> tasks CPU -> tasks GPU);
   if nothing helps it shows the real camera with a plain-language banner, never an empty scene. The engine that
   worked is remembered per device.

## Verified (real headless Chromium, real MediaPipe selfie model, real human portrait video)
- Auto-start fired, engine = self-hosted legacy MediaPipe, person cut out cleanly, backend remembered.
- Unrepairable empty mask -> camera shown + banner. Repairable -> switched to tasks-cpu automatically.
- No page errors. External requests no longer block the page.

## NOT verified
- Whether your Redmi 14C's problem was exactly the GPU-delegate issue. The safeguard handles that case and any
  other empty-mask case, but only your phone can confirm. If it still shows no person, the banner will say so.
- Real phone speed/time-to-first-frame (sandbox is software rendered). Real people with real lighting.
- The MediaPipe Tasks (Google-hosted model) path, because the sandbox cannot reach Google's model storage.
