/**
 * Render worker — the default rendering path. Everything downstream of
 * segmentation (mask refinement, realism engine, background compositing,
 * overlays, annotations, A/B preview) lives in render-core.js, shared with
 * app.js's main-thread compatibility fallback (see the header comment in
 * render-core.js for why that fallback exists). This file is now just the
 * Worker-side wiring: receive an OffscreenCanvas via transferControlToOffscreen(),
 * forward every message into the shared core, and post its replies back.
 *
 * HONEST SCOPE — what did NOT move here and why:
 * MediaPipe's SelfieSegmentation ("Solutions" API, loaded from the CDN in
 * studio.html) creates DOM canvases internally and accepts only
 * HTMLVideoElement/HTMLCanvasElement/HTMLImageElement as input. It does not
 * support running inside a Worker. That inference call — the single most
 * expensive step in the pipeline — has to stay on the main thread; there is
 * no version of this app, with this library, where that changes.
 *
 * RELIABILITY: every 'frame' message carries a token that gets echoed back
 * on 'frameDone' (or 'error') so the main thread's watchdog (see app.js)
 * can tell a normal reply from a stale one and never wait forever on a
 * frame that already timed out. A true worker-global crash (self.onerror)
 * is reported as 'fatal' — this worker cannot resurrect itself afterward
 * (its OffscreenCanvas was transferred once, non-reversibly, from the main
 * thread), so app.js's job on 'fatal' is to say so honestly, not pretend.
 */

importScripts('grade-core.js', 'render-core.js', 'providers/mask-refine.js', 'providers/realism-engine.js', 'providers/gl-matte.js', 'providers/scene-engine.js', 'providers/pose-gate.js');

const core = self.VS.createRenderCore((msg, transfer) => self.postMessage(msg, transfer || []));

self.onmessage = (e) => core.dispatch(e.data);

// HARDENING: a worker-global uncaught error (e.g. thrown outside
// core.dispatch's own try/catch, or a resource load failure) would
// otherwise leave the main thread's frame watchdog waiting with no signal
// at all. Surface it explicitly so app.js can tell "one bad frame" apart
// from "the whole worker just died" and stop pretending the live/recording
// feed is healthy.
self.onerror = (message) => {
  self.postMessage({ type: 'fatal', message: String(message) });
};
