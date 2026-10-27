# Genesis Studio: architecture and build plan (v0.47 baseline)

Audience: any AI coding assistant continuing this project. Owner: John (Usen Daniel), who tests ONLY on a Redmi 14C (Android 14, Helio G81 Ultra, Mali-G52 MC2, 4 GB, WebView Chrome 155, WebGPU true). Read `docs/HANDOFF_v0.47_FOR_NEXT_AI.md` first, then this file.

Labels used everywhere: **VERIFIED** (read on a primary page or run in a test), **INFERRED** (reasoned from verified facts), **UNVERIFIED** (needs a phone/laptop test). Never present INFERRED/UNVERIFIED as fact.

## 1. Vision and acceptance
Match or beat mmhmm for a live virtual studio, free, on a cheap phone and on a laptop. John's acceptance: steady controlled FPS, no cut-out cracks or blur, bright and lively look, never hangs, nothing odd while presenting. The sandbox has no phone: it can prove mask accuracy, correct frame/mask pairing, no crashes/hangs; it CANNOT prove phone speed or brightness. Those come from the phone's Diagnostics report.

## 2. Where the quality actually comes from (evidence)
1. Light and camera frame rate. Phone evidence: camera delivered 10.2 fps at 360x480; constraints only ask `frameRate:{ideal:30}` (app.js ~736). INFERRED: Android auto-exposure lengthens exposure in dim light and caps fps.
2. Mask/frame pairing and refresh every frame (stride 1 since v0.45). Stale mask = cracks when moving.
3. Edge quality: guided upsampling (gl-matte.js) plus an empty-room reference.
4. Look: exposure, relight, grade.
5. Model choice matters least: MODNet stays (Apache-2.0).

## 3. Verified facts that drive the design
- ORT-web WebGPU: `enableGraphCapture` needs static shapes and all kernels on WebGPU, otherwise init fails (disable per model); IO binding keeps tensors on GPU (`preferredOutputLocation:'gpu-buffer'`, `Tensor.fromGpuBuffer`); per-op profiling via `ort.env.webgpu.profiling`. CPU/WASM: prefer uint8 quantised, avoid fp16, threads need `crossOriginIsolated` (the Capacitor WebView lacks it). WebGL EP fails on MODNet (int64).
- Chrome Android (W3C status table, last updated 2023): exposureMode, exposureTime, iso, whiteBalanceMode, focusMode implemented; exposureCompensation NOT confirmed (so v0.46 exposure assist may do nothing on the phone: check).
- Licences: MODNet Apache-2.0; ORT MIT; Depth Anything V2 Small Apache-2.0; SAM 2 Apache-2.0; EdgeTAM Apache-2.0 (card claims 16 fps iPhone 15 Pro Max, no web/ONNX/alpha info: UNVERIFIED for web); Background Matting V2 MIT (needs a captured empty-background image; no mobile numbers); RVM GPL-3 (do NOT ship as default); MatAnyone non-commercial; PP-MattingV2 licence not stated on the page read.
- Google Pixel 6 task latencies: SelfieSegmenter ~33 ms CPU/GPU: a native rewrite shows no clear win. Not recommended.

## 4. Target architecture
```
CAMERA CONTROL  (camera-control.js, new)
  read caps -> try manual exposureTime cap (~25-33 ms) + iso -> measure real fps -> keep only if fps up -> else fall back to auto.
        |
FRAME SOURCE  video element (rAF loop; rVFC throttled in the WebView)  -> frame id + timestamp
        |
SEGMENTER (worker)  tier-selected, one interface: segment(frame) -> {alpha, frameId}
   tier P (phone):  MODNet fixed-size 256/320 (static shape; graph capture only if self-test passes), WASM/WebGPU EP, fallback MediaPipe
   tier L (laptop): larger MODNet / Background Matting V2 (plate-aware) behind the same interface (see section 7)
        |
MASK PAIRING  mask is always composited with the frame it was computed from (or warped by measured motion); never a newer frame with an older mask
        |
MATTE (gl-matte.js)  temporal smoothing (motion adaptive) -> joint-bilateral upsample -> despill -> EMPTY-ROOM PLATE assist
        |
LOOK (look-engine, new)  auto exposure gain + GPU denoise + relight (depth from offline Depth Anything maps) + grade
        |
SCENE ENGINE  depth layers, seat arms, occluder, colour match   (unchanged)
        |
OUTPUT  preview canvas + MediaRecorder at a fixed 30 fps cadence (frame repeat; v0.46 even-cadence)
WATCHDOG  if frame time > budget for N s: step down (smaller mask size -> light model -> fewer effects). Never block the UI.
OPTIONAL  AI re-render relay (after recording, opt-in). Never in the live loop.
```
Interfaces: every provider has `initialize(quality)`, `segment(video)`, `dispose()`, `label`, `longEdge`. New providers must pass `tools/e2e/t35_modnet_worker.js`-style tests (IoU vs ground truth, equals reference, offline).

## 5. Build phases (each ships alone, each ends with tests + a phone report request)
**Phase 0 Studio Check (do first).** One-tap in-app test; output is ONE copyable report: camera capabilities (exposureMode/Time/iso/compensation/frameRate ranges), result of an exposure-cap experiment (fps before/after, brightness), MODNet per-operation profile (`ort.env.webgpu.profiling`), EP comparison (WebGPU vs WASM, static shape, graph capture on/off, sizes 256/320/448), time budget per stage, long-task count. Acceptance: report prints on the phone, never hangs, every experiment has a timeout and auto-restores settings.
**Phase 1 Camera + light.** `camera-control.js`: exposure cap and `frameRate:{min:24,ideal:30}` tried via `applyConstraints`, kept only if measured fps improves; GPU brightening and denoise to compensate. Acceptance: unit tests with a fake track; phone: camFps >= 24 or the report says why not.
**Phase 2 Mask pairing + steady cadence.** Verify and enforce frame-id pairing through the worker; recording cadence fixed. Acceptance: test with a moving synthetic subject shows no mask lag > 1 frame.
**Phase 3 Empty-room plate.** Automatic capture ("step out for 2 s") plus slow background-model refresh; plate assist only on uncertain edge pixels. Acceptance: synthetic test, crack metric (edge band error) improves vs no plate; confident person pixels untouched.
**Phase 4 Fixed-size MODNet.** Export/convert static 256/320, test accuracy vs the 448 model (IoU drop < 1 point), optional int8 for WASM, graph capture behind the self-test. Acceptance: offline test + phone profile shows ms reduction; auto fallback.
**Phase 5 Look.** Auto exposure, relight (depth maps), grade, mmhmm-style presets; shrink/dismiss the "Sustained low FPS" banner so it never overlaps the preview.
**Phase 6 Watchdog + tiers.** Device tier picker (phone/laptop), degradation ladder, session report.
**Phase 7 Laptop tier** (section 7).
**Phase 8 Level 3 seating + AI re-render real runs** (needs John's raw clip and a key: see `docs/LEVEL3_EXPERIMENT.md`).

## 6. Rules for every AI
1. `git pull` before editing; patch on top of latest main; never copy whole files over (a blind copy already overwrote v0.46 once).
2. Run the suite before pushing: `unit_render 23, unit_seat 62, unit_pose 35, unit_scene, unit_looks, unit_m5, t31, t35`. `t33_ladder_smoke` fails on plain v0.46 in the sandbox (known).
3. Bump `SHELL_CACHE` in sw.js and add new files to `SHELL_ASSETS`. Bump the build string in `js/diagnostics.js`.
4. Everything optional must fail safe: a failed experiment restores settings and the app keeps running on the previous engine.
5. No keys in the repo. Keep licences clean (`LICENSES.md`). Do not ship GPL/non-commercial models by default.
6. Report only measured results, with the label. Say plainly what was not run.
7. John tests on the phone only; ask for exactly one thing per round (a Diagnostics report or a clip).

## 7. Laptop tier (to be designed next; outline only)
Same interfaces, bigger models: larger MODNet size or Background Matting V2 (MIT, plate-aware) in a worker on WebGPU; EdgeTAM/SAM 2 for tracking and Depth Anything for relight are candidates; all UNVERIFIED for browser speed. A laptop owner must run Studio Check and send the report; the tier picker chooses from that report. Desktop virtual-camera output (OBS) is a separate track (`docs/VIRTUAL_CAMERA_SETUP.md`).

## 8. Risks
Camera controls unsupported on the front camera (then rely on light guidance + GPU brighten); graph capture failing on Mali (fallback built in); fp16 on Mali unknown; phone has 4 GB RAM (watch memory); the WebView lacks cross-origin isolation (no WASM threads); sandbox speed is not phone speed.

## 9. Paste-prompt for the next AI
"Clone https://github.com/HyperNoesis/Beggining- (the project home) or https://github.com/HyperNoesis/Genesis- (APK build repo), read docs/HANDOFF_v0.47_FOR_NEXT_AI.md and docs/ARCHITECTURE_BUILD_PLAN.md, run the test suite, then implement Phase 0 (Studio Check). Pull before every edit, ship each phase separately with tests, label VERIFIED/INFERRED/UNVERIFIED, and ask John for one phone report per round."
