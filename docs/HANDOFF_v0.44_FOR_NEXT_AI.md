# HANDOFF for the next AI (written at v0.44, 2026-10-26). READ THIS FIRST, then NEXT.md, then HANDOFF_FOR_NEXT_AI.md (older, still valid), docs/SMART_BUILD_DECISION.md.

## 0. Who and what
Owner: John (Usen Daniel), Nigeria, builds and tests ONLY from an Android phone (Redmi 14C, model 2409BRN2CA), on a FREE Claude plan with scarce tokens. He wants: fast, efficient, one solid pass, honest reports. Never claim something works unless you ran it. Optimise for the best FREE tier of everything.
Product: **Genesis Studio**, a virtual studio (vs mmhmm / XSplit VCam / NVIDIA Broadcast / OBS) for "studio-anxious streamers". Vanilla JS PWA, no build step, now also shipped as an Android APK (Capacitor WebView wrapper). The goal he repeats: **bright, lively, mmhmm-quality picture; controlled steady FPS; no cracks, no blur, nothing funny; he can join a real call with it.**
Two ambitions (master prompt, docs/SMART_BUILD_DECISION.md): (A) real-time camera transformation, on device, never depends on cloud; (B) Level 3 immersive seating (person on a real chair appears on a virtual sofa). Keep A independent and protected.

## 1. Where everything lives
- GitHub (private): https://github.com/HyperNoesis/Genesis- , branch `main` = the shipped state (branch `android-wrapper` is an older copy). Push to main -> Actions "Build Genesis APK" (~2.5 min) -> APK published as a Release (tag android-build-N, asset Genesis.apk). John installs from there.
- APK signing: ONE fixed debug key is committed (android/app/genesis-debug.keystore, password `android`) so each build can update the previous. John had to uninstall the old random-key app ONCE. Never change the key. Play Store release needs a private key (not done).
- Local copy of the project: this zip set (see section 9). Tests live in tools/e2e/.
- The Android wrapper files (android/, package.json, capacitor.config.json, scripts/make-www.js, .github/workflows/android.yml, ANDROID.md) exist ONLY in the GitHub repo, not in the zips. If you edit web files, copy them into the repo clone and push.

## 2. What was done in this long session (v0.41 -> v0.44)
- v0.41-0.43: optional AI re-render path (Path C): js/providers/render-provider.js (job runner), server/render-relay.js (providers: mock, aimlapi/HappyHorse, gemini Omni Flash, worker), server/render-worker.js (self-hosted GPU, e.g. Wan2.1 VACE), js/render-ui.js (button under each recording, hidden unless js/config.js renderRelayUrl), tools/level3/{run_candidate,score}.js, docs/LEVEL3_EXPERIMENT.md. Tests: unit_render (23), t31_render_ui (7). NO real model was ever run (needs John's clip + a paid key or a GPU).
- v0.44 "clarity": bundled models/modnet.onnx (Apache-2.0, sha256 de03cc16...5306) and vendor/ort (onnxruntime-web 1.25.1, MIT) inside the app; js/ort-loader.js loads local first; speed ladder (MODNet 448 -> 320 -> 256 px) in app.js backgroundUpgrade. Tests: t32_modnet_offline (real MODNet offline, IoU 0.997), t33_ladder_smoke.
- Research facts (verified): ORT WebGL EP cannot run MODNet ("int64 is not supported"); WebGPU output identical to WASM; RVM is GPL-3 and MatAnyone non-commercial (not usable as default); Gemini Omni Flash (gemini-omni-1.1-flash) can edit uploaded video <=10 s but has NO free tier (~$0.10/s) and is not available in EEA/CH/UK; Veo 3.1 only extends its own videos; HappyHorse price/free tier unknown.

## 3. THE REAL-PHONE EVIDENCE (v0.44 APK, John's report + 8 screenshots, 2026-10-26)
Diagnostics (Redmi 14C, Android 14, WebView Chrome 155, Mali-G52 MC2, 4 GB, WebGL2 true, **WebGPU true**):
- **Engine now: legacy (MediaPipe light model), remembered: legacy.** So MODNet was NOT the active engine in the report that John says "looks good". Segmentation 62 ms, render 52 ms, frame total 97 ms, loop period 105 ms, FPS 9, **stride 2** (inference on 46% of frames), quality fast, output 480x270, mask 360x480, coverage 46.6%.
- **Camera: reports 360x480 @30 but measured delivery 10.2 fps.** The front camera is the ceiling; loop uses rAF (rVFC throttled).
- UI banner shown: "Sustained low FPS (11 / 8) even in FAST with reduced mask updates. This is likely this device's ceiling..." and it covers the preview.
- Screenshots: the cutout is a blocky rectangular-ish crop around the face with white/grey fringe (cracks), chest/shoulders missing in the podcast scene; scenes (Podcast, Newsroom) and broadcast graphics (lower third, QR, ticker, LIVE) render fine. John: "better but not the best; still not shippable; cracks; unstable; I want controlled FPS, no crack or blurry stuff; like mmhmm: bright and lively."
- John reported the app HUNG ("no button works after I tap Studio") on the first TWO runs of the new APK, then worked "almost perfectly" on later runs. Not reproduced here.

## 4. Diagnosis (what I believe, with confidence labels)
1. HANG (INFERRED, likely my regression): v0.44 made MODNet available, so on the first run `backgroundUpgrade()` (js/app.js) loads a 25 MB model + ORT and then times MODNet with `timeProvider()` on the MAIN thread. On this phone MODNet was slow, the UI froze for seconds. After the first run the speed verdict is stored (localStorage vs_model_bench, v2) and the app stays on `legacy`, which is why later runs worked. I just made timeProvider yield between frames (setTimeout 30 ms) and abort early above 500 ms: UNVERIFIED on the phone. Real fix = run inference off the main thread (ORT `env.wasm.proxy=true` for the WASM path; WebGPU cannot be proxied) or benchmark inside the render worker.
2. CRACKS (INFERRED): legacy MediaPipe "fast" at stride 2 means the mask on half the frames comes from the PREVIOUS frame while the person moves at ~10 fps, so the cut-out edge lags the picture; plus a low-res binary mask. Candidate fixes in order of cost: stride 1 (seg 62 ms < 100 ms camera period, but seg+render are sequential = 114 ms > 100 ms, so pipeline them: segment frame N while rendering N-1 in the worker); motion-compensated mask (shift last mask by estimated motion); MODNet at 256-320 px with the existing joint-bilateral upsampler (js/providers/gl-matte.js) once it can run off-thread; temporal alpha smoothing tuned for 10 fps.
3. "CONTROLLED FPS" (INFERRED): the camera delivers ~10 fps. Do not chase 30. Target a perfectly steady output: pace the render to camera frames (one render per new camera frame, never duplicate/drop unevenly), lock recording/stream timing to a fixed 10 or 15 fps with duplicated frames evenly spaced, and remove the stride flip-flop. A steady 10 fps with a clean cut-out will look better than a wobbling 9-13 fps. Also try the back camera and other camera modes (the mode probe in diagnostics) before accepting 10 fps; in the WebView the front camera may be capped differently than in Chrome.
4. "mmhmm brightness" (PLAN): the picture is dim (night, weak front camera). Levers that already exist: subjectLift (under-exposure rescue), grade-core.js (auto brightness / white balance, LUTs, colour grade), colour match, bloom/vignette. Missing: a real auto-exposure + relight pass (soft key light on the subject from the scene's light direction), skin-tone-safe brightening, gentle skin smoothing default, background grade that matches. Measure with a luma target (e.g. face mean luma 0.40-0.50) in the diagnostics report.
5. Diagnostics said "genesis v0.40" (stale string): fixed to v0.44 in js/diagnostics.js.

## 5. PRIORITIES for the next AI (do them in order; each one small, tested, shipped)
P0 STABILITY: no hang on first run, no UI freeze ever. Acceptance: on a cold install, tap Start, within 2 s every button still responds for the next 60 s (test with a long-task observer: no main-thread task > 200 ms during the model upgrade). Move MODNet loading/benchmark off the main thread or make it opt-in (a button "Try high-quality cutout") until it is off-thread.
P1 CONTROLLED FPS + NO CRACKS: pipelined segmentation, stride 1, camera-paced render, even frame timing for recording, stop the "Sustained low FPS" banner from covering the preview (make it small, dismissable, shown once, and not when the cause is the camera ceiling). Acceptance: Diagnostics shows stride 1, loop period stable (std dev < 10% over 30 s), measured fps = camera fps, and a 10 s screen recording shows no edge lag when waving a hand.
P2 CLARITY: decide MODNet vs better light model on THIS phone with real numbers (Diagnostics > "Test effects speed" and the bench note). Candidates: MODNet 256-320 px off-thread + gl-matte; MediaPipe Tasks selfie model GPU delegate (WebGPU is true on this phone: the Tasks path may be fast); fix hair/shoulder cracks; full-body torso kept (screenshots show chest cut off).
P3 BEAUTY (mmhmm look): auto exposure + relight + grade presets + softer background + tasteful default skin smoothing; one tap "Studio look". Compare side by side with mmhmm screenshots John sent (bright, saturated, clean edges, subject lit from the front).
P4 Level 3 seating + AI re-render: only after P0-P2. Experiment needs John's raw 8 s chair clip (<=10 s) and a key (or free-GPU VACE notebook; not written yet).
P5 Phase roadmap items in docs/MASTER_ROADMAP.md.

## 6. How to build, test, ship
- Unit tests (no browser): `for t in unit_render unit_seat unit_pose unit_scene_meta unit_scene unit_depthdesk unit_looks unit_m5; do node tools/e2e/$t.js | tail -1; done` (all PASS at v0.44).
- Browser tests: `python3 tools/e2e/mkfx.py`; `ln -sfn <project> /tmp/srv/app`; start `python3 -m http.server 8123 --bind 127.0.0.1` from /tmp/srv IN THE SAME shell command or via nohup; then `node tools/e2e/t32_modnet_offline.js`, `t33_ladder_smoke.js`, `t31_render_ui.js`, `shot_scenes.js scene-a ...` (renders PNGs to /tmp/shot_*.png with a fake presenter). Chromium: set CHROME_PATH or rely on Playwright's own (pwlib.js falls back). Sandbox is SLOW (software GL): speeds are meaningless; the fake presenter is a flat pastel silhouette (harness artefact, also on control scenes).
- New JS/HTML file: add `<script>` in studio.html AND to sw.js SHELL_ASSETS and bump SHELL_CACHE (now genesis-shell-v072). IndexedDB schema v3: never lower. #video must stay rendered. Tests must set localStorage vs_autostart=0.
- GitHub from the sandbox: `git clone` works through the session proxy (one clone at a time, long timeout); `gh run list`/`gh api repos/HyperNoesis/Genesis-/actions/runs/ID/jobs` work, but run LOGS return 403 and GraphQL is blocked (`gh release view/download` fail: use `gh api repos/HyperNoesis/Genesis-/releases` and `gh api .../releases/assets/ID -H "Accept: application/octet-stream" > file`). To see why a build failed you only get the failing step name: reproduce the config locally and reason.
- Sandbox network: only GitHub, npm, pypi (plus WebSearch/WebFetch tools). No Hugging Face. Models via GitHub release assets with curl -sL.
- John cannot upload files > ~30 MB to an AI chat: ship zips under 30 MB (see section 9) and send them with SendUserFile (limit 30 MiB).
- Version bump checklist: js/diagnostics.js build string, sw.js SHELL_CACHE, NEXT.md top line, CHANGELOG-v0_6.md bottom entry, docs.

## 7. Known issues / unverified (do not claim otherwise)
- Nothing in v0.41-0.44 has been verified beyond John's screenshots: AI re-render never run; MODNet never confirmed active on the phone; WebView .wasm MIME handling and WebGPU-in-WebView untested; multi-thread WASM impossible (no cross-origin isolation in the Capacitor local server).
- Level 3 sofa scene: only rendered with a fake presenter; pose thresholds uncalibrated; Grok image licence unconfirmed (docs/SCENE_LICENCES.md).
- The in-app "Sustained low FPS" banner text overlaps the preview and is hard to dismiss.
- t14_m4, t7_v013, t26_multisource are slow/flaky in the sandbox (pre-existing).

## 8. Style rules for John
Short answers, plain words, say what you ran and what you did not. When he sends screenshots/diagnostics, read them first (they are the only real-device evidence). Always hand back: a zip set under 30 MB + a short note + the GitHub push (so the APK rebuilds). Update NEXT.md + CHANGELOG each pass.

## 9. Zip set
genesis-v0_44-part1-code.zip (all code, docs, tests, tools, small assets) < 30 MB; part2-scenes.zip (assets/environments pictures); part3-models-vendor files are NOT needed to read/edit code (they are in GitHub: models/modnet.onnx 26 MB, vendor/ort ~38 MB wasm, vendor/mediapipe, vendor/rnnoise). Unzip part1 and part2 into the same folder.

## 10. Paste this to the next AI
"You are continuing Genesis Studio. Read docs/HANDOFF_v0.44_FOR_NEXT_AI.md fully, then NEXT.md. Do P0 first (no UI hang on first run), then P1 (controlled steady FPS, no cut-out cracks), then P2/P3. Inspect the real code before changing anything, run the tests in section 6, report only what you ran, and hand back zips under 30 MB plus a push to the GitHub repo."
