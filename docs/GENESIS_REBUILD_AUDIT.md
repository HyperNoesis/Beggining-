# Genesis rebuild audit — v0.3

## Scope

This pass follows the supplied Genesis Extreme UI/UX + Performance Master Build Prompt. The repository was inspected before editing, with special attention to the camera, segmentation, render, recording, navigation, projects, environments, editor, calls, streaming, PWA, storage, security, and responsive paths.

## Architecture map

`UI → app state → provider → worker/render core → output`

- **UI:** `home.html`, `studio.html`, `projects.html`, `environments.html`, `editor.html`, `call.html`, `settings.html` plus `css/style.css` and `js/nav.js`.
- **Application state:** primarily `js/app.js`, with localStorage/IndexedDB-backed project/session state.
- **Providers:** environment, segmentation, transcription/AI, streaming, and call providers under `js/providers/`.
- **Graphics:** `js/render-core.js` is the shared compositing source; `js/render-worker.js` is the default worker path; `app.js` contains the compatibility path.
- **Output:** canvas preview, MediaRecorder recording, downloads, editor/project persistence, calls and WHIP streaming.

## Before-state findings

### Must preserve

- The existing Worker/OffscreenCanvas composition path.
- Existing local project/recording persistence.
- Existing editor, environment, camera, audio, captions, calls, and streaming capabilities.
- Existing compatibility renderer and legacy segmentation fallback.

### UX problems addressed

- Studio did not establish the creator's mental model strongly enough; the preview was not sufficiently framed as the primary stage.
- Recording and Go Live were less visually decisive than the master prompt requires.
- The Studio control rail was tool-dense without enough visual grouping.
- Home needed a clearer “start creating” command surface.
- Projects/environments needed stronger editorial framing and continuation cues.

### Technical risks addressed

- The default segmentation implementation depended directly on the legacy MediaPipe SelfieSegmentation solution.
- There was no modern Tasks Vision provider boundary with explicit GPU-first/CPU-fallback initialization.
- Shared rendering scratch canvases assumed `OffscreenCanvas` existed even in the compatibility environment.
- A committed frontend config contained provider API-key material; this has been removed from the shipped client source.

## v0.3 implementation

### Segmentation

`js/providers/segmentation-provider.js` now uses a Tasks Vision Selfie Segmenter provider first, requesting a GPU delegate and falling back to CPU. FAST/BALANCED use the landscape category-mask model; QUALITY uses the square confidence-mask path. The legacy provider remains available as a compatibility fallback.

The Tasks path remains local/on-device. No camera frames are sent to a cloud segmentation endpoint.

### Rendering / performance

- Kept Worker/OffscreenCanvas as the preferred composition path.
- Kept the compatibility path and added a DOM-canvas scratch fallback for environments without `OffscreenCanvas`.
- Preserved existing adaptive frame scheduling rather than replacing it with a nominal FPS target.
- Preserved newest-frame/backpressure behavior in the existing render path.

### Product shell / visual system

- Added a creator-focused Studio header with session state, camera/mic state, Record and Go Live actions.
- Added a live preview HUD that reports current quality/backend without turning Studio into a benchmark dashboard.
- Added a more deliberate transport bar and clear Go Live entry point.
- Added Studio tool glyphs using the existing internal SVG icon system.
- Added Home command actions and strengthened editorial hierarchy for Projects and Environments.
- Added a warm, restrained polish layer through shared design tokens and responsive rules in `css/style.css`.

### Security / privacy

- Removed provider API-key values from `js/config.js`.
- Existing optional-provider architecture remains; server-side/proxy protection is now required for secret-backed providers rather than embedding keys in the browser bundle.

## Validation

- JavaScript syntax was checked with Node for the edited runtime files and then for the repository JS tree where present.
- Secret-pattern scanning was run across the repository after removing the exposed provider keys.
- The original browser test runner cannot execute in this container because the repository does not include an installed Playwright dependency.
- Chromium is installed in the environment, but the app's full browser boot depends on permissions, external model/CDN loading, and runtime camera APIs; those paths are therefore treated as runtime acceptance checks rather than claimed as fully automated here.

## Final-pass checklist

- [x] Existing core rendering path preserved.
- [x] Modern local segmentation provider added with GPU → CPU fallback.
- [x] Legacy segmentation retained as compatibility fallback.
- [x] Studio preview hierarchy strengthened.
- [x] Record / Go Live prominence strengthened.
- [x] Home / Projects / Environments hierarchy polished.
- [x] Responsive/mobile CSS pass included.
- [x] Reduced-motion rule retained and reinforced.
- [x] Shared renderer has a non-OffscreenCanvas scratch fallback.
- [x] Client-side provider secrets removed.
- [x] Final syntax and secret scans completed.

## Known runtime dependency

The Tasks Vision path loads its WASM/model assets from public CDNs when the browser initializes it. The legacy MediaPipe bundle remains in Studio as a fallback. A production deployment can later self-host and pin those assets for stronger offline/reproducibility guarantees without changing the provider interface.
