# Handoff v0.47 (supersedes the top of HANDOFF_v0.44; read that file for background and licences)

## Where the project lives (pull it from here)
- GitHub: https://github.com/HyperNoesis/Genesis- , branch `main` (private/public: check `gh api repos/HyperNoesis/Genesis- --jq .private`).
- `git clone https://github.com/HyperNoesis/Genesis-.git && cd Genesis-` . Everything is in `main`: web app, `android/` (Capacitor 6), `.github/workflows/android.yml`, tests in `tools/e2e/`, docs in `docs/`.
- Every push to main builds the APK in GitHub Actions and publishes a Release (`android-build-N`, asset `Genesis.apk`). Fetch with `gh api repos/HyperNoesis/Genesis-/releases/assets/ID -H "Accept: application/octet-stream"` (GraphQL/`gh release` are blocked in the sandbox; use REST).
- ALWAYS `git pull` before editing: another AI session pushed v0.46 while v0.45 was being built, and a blind copy overwrote it (reverted). Never copy whole files over the repo; patch on top of the latest main.

## Who and how
John (Usen Daniel, Nigeria) builds and tests ONLY from a Redmi 14C (Android 14, 4 GB, Mali-G52, WebView Chrome 155, WebGPU true). Free Claude plan. Wants fast, honest work. Cannot run desktop tools. Sandbox has no phone: its speeds are not phone numbers.

## State at v0.47
- Live path: camera -> MODNet (ONNX, bundled in `models/`, runs in a Web Worker since v0.47, WebGPU then WASM) or MediaPipe fallback -> `gl-matte.js` (temporal smoothing, joint-bilateral upsample, despill) -> scene engine -> canvas -> MediaRecorder.
- v0.46 (other session): pipelined render, even recording cadence, light meter + exposure assist. v0.45: stride always 1.
- Optional AI re-render (relay + button) is built but never run with a real model.
- Tests: unit_render 23, unit_seat 62, unit_pose 35, unit_looks, unit_m5, t31, t35 pass. `t33_ladder_smoke` fails on plain v0.46 too (bench note overwritten by the camera-speed note in the sandbox): not caused by v0.47, but unresolved. Start the test server first: static server on 127.0.0.1:8123 with `/app` -> repo root and `/fx` -> fixture images.

## Evidence on the phone (v0.40 diagnostics, older build)
Engine legacy (MediaPipe light model), seg 62 ms, render 52 ms, FPS 9, stride 2, camera delivered only 10.2 fps at 360x480. Cracks = stride 2 + light mask. v0.47 on the phone: NOT yet seen. First thing to ask John: install the newest APK, run Diagnostics, paste the report.

## Hypotheses to test next (labels honest)
1. INFERRED, cheap: the camera caps at ~10 fps because constraints only say `frameRate:{ideal:30}` (app.js ~736). Android lowers fps in dim light via long exposure. Try `frameRate:{min:24,ideal:30}` and `exposureMode`/`exposureCompensation` via applyConstraints in the existing camera lab (app.js ~1225) and read `getSettings().frameRate`.
2. INFERRED: mask must be paired with the exact frame it was computed from (or warped), else edges crack when the person moves. Verify in the pipelined render.
3. UNVERIFIED: static-shape MODNet (fixed 256/320 input, fp16 or int8) + ORT WebGPU graph capture could cut ms a lot. Measure in the sandbox for correctness only; ms must come from the phone.
4. INFERRED: a running background model / auto clean plate for the fixed-phone case removes edge cracks (gl-matte pass C exists, needs auto capture).

## Not allowed / do not do
RVM is GPL-3 (verified on its repo): not shippable as default. MatAnyone is non-commercial. Do not rewrite natively: Google's own Pixel 6 numbers show selfie segmenters at ~33 ms, no clear win over the web path.

## Acceptance (John's words): controlled steady FPS, no cracks or blur, mmhmm-bright, never hangs, nothing funny while presenting.
