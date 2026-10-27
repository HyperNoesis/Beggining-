# Third-party models and licences (engineering summary, NOT legal advice)

Have a lawyer confirm before you charge money. Status below comes from the
projects' own repos/model cards as found in research on 30 Sep 2026.

| Component | Licence | OK for a paid product? |
|---|---|---|
| MODNet (portrait matting model, default quality tier) | Apache-2.0 | Yes, with attribution and the licence text if you redistribute the file |
| MediaPipe Selfie Segmentation (self-hosted in vendor/mediapipe/selfie, light tier) | Apache-2.0 (package @mediapipe/selfie_segmentation) | Yes, with attribution and the licence text. Keep the Apache-2.0 text with the app |
| RNNoise noise suppression (js/worklets/rnnoise-worklet.js, built from jitsi/rnnoise-wasm commit cb529a59, core xiph/rnnoise) | jitsi/rnnoise-wasm Apache-2.0 (vendor/rnnoise/LICENSE-...); rnnoise core BSD-3-Clause (xiph, verify text before redistribution) | Yes, with attribution |
| Robust Video Matting (RVM) | GPL-3.0 | Risky. Only runs if a user explicitly picks "RVM (personal use)". Remove it from any paid build unless counsel says otherwise |
| MatAnyone / MatAnyone 2 | S-Lab licence, non-commercial | No, unless you get written permission from the authors. NOT included in this app |
| onnxruntime-web | Not checked in this research | Verify before launch |
| AI-generated scene images (Pollinations.ai "Create World") | Not checked | Read their terms for commercial use of generated images before you sell scenes |

## Why this matters
The app defaults to MODNet and MediaPipe only (Auto). RVM is kept as a manual
option for personal testing and should be deleted (js/providers/rvm-provider.js
and its script tag in studio.html) before you sell the app.

## Attribution to ship with the app
- MODNet: Zhanghan Ke et al., "MODNet: Real-Time Trimap-Free Portrait Matting via
  Objective Decomposition", AAAI 2022. Apache-2.0.
- MediaPipe: Google. Apache-2.0.

## MODNet weights (models/modnet.onnx)
modnet_webcam.onnx from https://github.com/yakhyo/modnet/releases/tag/weights (sha256 de03cc16f3c91f25b7c2f0b42ea1a8d34f40a752234f3887572655e744e55306, 25,969,398 bytes). Ported from ZHKKKe/MODNet; code and weights Apache-2.0 per the yakhyo README. Optional engine, fetched only when MODNet is chosen.

## Depth maps (assets/environments/*-depth.png)
Generated with Depth Anything V2 Small (Apache-2.0), ONNX from fabio-sim/Depth-Anything-ONNX v2.0.0 (sha256 d2b11a11c1d4a12b47608fa65a17ee9a4c605b55ee1730c8e3b526304f2562be). Re-check the weights licence before changing to Base/Large (non-commercial).
- Depth Anything V2 Small (offline tool only, Apache-2.0): used to bake scene depth maps; not shipped to phones.

## onnxruntime-web 1.25.1 (vendor/ort/)
Microsoft onnxruntime-web, MIT licence (npm package onnxruntime-web@1.25.1). Shipped inside the app so the matting engine works offline. Files: ort.min.js, ort.webgpu.min.js, ort-wasm-simd-threaded(.jsep).wasm, and the two helper modules renamed from .mjs to .js (same content; Android WebViews may not know the .mjs MIME type). Loaded by js/ort-loader.js, CDN only as fallback.
## MODNet weights now ship in models/modnet.onnx
Same file and sha256 as above (modnet_webcam.onnx, Apache-2.0), committed so the APK always has it.

