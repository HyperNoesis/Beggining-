# Level 3 seating (v0.37) — honest status

**Status: PARTIAL / PROTOTYPE.** The pipeline pieces exist and render correctly with a SYNTHETIC presenter in headless Chromium. Nothing here has been seen with a real person or on a phone.

## What exists
- `scene.json` block `seat` (validated): `type`, `supports` (the supported pose + camera view, shown to the user when the scene is switched on), `guide` (head oval + shoulder curve, fractions of the frame), `arms[]` (side furniture drawn IN FRONT of the presenter).
- Engine: `drawSeat()` cuts each arm from the crisp scene picture (feathered, cached) and draws it over the presenter, before the table/desk occluder. A shoulder or elbow that drifts past the sofa's inner edge tucks behind the arm (checked on a render: presenter shifted right, shoulder cut at the arm).
- Positioning guide (`drawSeatGuide` in app.js): dashed head oval + shoulder curve + one line of text, on the guide canvas only (NOT recorded). Shown 7 s after the scene is switched on and whenever "Safe-area & rule-of-thirds guides" is ticked.
- Scene `scene-lounge-seat` (Lounge Sofa, prototype): sofa back + arms behind/beside the presenter, low table in front as the lap occluder (existing desk occluder), depth map, warm light from the right. Art is PROCEDURAL (tools/scenes/make_lounge.py), stylised, not photoreal. No third-party assets.
- Tests: `node tools/e2e/unit_seat.js` (12 PASS). Existing unit tests still pass; t14_m4 count updated 24 -> 25.

## How the "real chair is replaced" works (and its limit)
The person mask contains only the person, so the real chair and room are already gone. The sofa is added behind and beside the presenter; the table hides the lap. Real chair parts that the segmentation wrongly keeps (chair back touching the shoulders) are NOT detected or removed: UNVERIFIED on real footage.

## Supported / not supported
Supported: one person, front-facing, upright on a real chair, centred, camera level at eye height ~1 m, head+shoulders in the guide. NOT supported: standing, sideways, leaning far, arms spread wide, moving camera. These are not detected at runtime yet.

## Known flaws
Stylised art (not photoreal); presenter lighting/colour match only the generic spill/colour-match passes; no contact shadow on the cushions; guide is static (no live "you are aligned" check); arm occlusion is a fixed rectangle, not pose-aware.

## Phone test protocol (what to send back)
Open Studio, pick "Lounge Sofa", turn scene mode on, sit on a normal chair ~1 m from the phone at eye height, fit head/shoulders to the guide. Check: (1) edges of hair and shoulders, (2) shoulders vs sofa arms when you lean 15 cm each way, (3) chair back leaking through, (4) fps in Diagnostics > Test effects speed. Send: phone model, browser, one 10 s screen recording, screenshots, the Diagnostics report.

## Photoreal upgrade (prompt for your image tool)
"Photorealistic luxury lounge, camera at seated eye height, level, straight-on. A deep green velvet sofa fills the centre, back cushions at shoulder height, rolled arms left and right, a low marble coffee table across the bottom of the frame with a book and a mug, warm floor lamp on the right, arched window on the left, shallow depth of field, no people, no text, no logos, 16:9." Then: `node tools/scenes/import_scene.js pic.jpg ... --desk-y <table back edge>` and copy the `seat` block from scene-lounge-seat (set arms/guide by eye).
- v0.37b: live seat alignment (engine seatAlignment, worker frameDone.seatAlign, guide turns green + says which way to move). unit_seat 18 PASS; browser smoke (scene on: seat hint shown, guide drawn, 0 page errors). t14_m4 did NOT finish in the sandbox (stopped after ~20 min, no result): UNVERIFIED. Contact shadow + pose detection still not built. SHELL_CACHE v066.

## v0.38 — what your phone screenshots showed, and what changed
Findings (from 3 real screenshots): (1) two screenshots had a blocky, low-res mask = the light MediaPipe model, because MODNet is only used when `models/modnet.onnx` is deployed AND the phone runs it in <=70 ms; the third screenshot (edges clean, label MODNet) shows the high-quality path works on your Redmi (~11 fps). (2) At night the presenter was very dark (under-exposed camera). (3) Your face filled ~40% of the frame while the old sofa art made a head look ~3x too big: scale was wrong, so it could never read as "sitting".
Changes: **auto-fit** (head width/centre/top measured from the mask silhouette, scale+position set so your head lands on the guide at any distance, smoothed, outlier-gated; hints "closer/back" when out of range 0.45x-1.25x); **true-scale loveseat art** (back at ear level running past both frame edges, arms at the frame edges, lit seat cushion beside the torso, table in front); **guide re-sized to real framing** (head ~35% of picture height); **under-exposure rescue** (`subjectLift`, only acts when the presenter's mean luma < 0.2, max x1.7 at strength 0.6; no effect in normal light, so complexion is untouched).
Tests: unit_seat 37 PASS (auto-fit lands the head on the guide for far/normal/close heads; outlier ignored; lift is a no-op in normal light). Browser: scene renders, seat hint shown, guide drawn, 0 page errors (fake presenter only).

## Technology decisions (per the Grand Master Prompt, Phase 2)
| Tool | Decision | Why | Limit |
|---|---|---|---|
| MODNet (ONNX, Apache-2.0) | KEEP (already integrated) | Real matting; clean hair/shoulder edges in your 3rd screenshot | 25 MB model; needs deploy of models/modnet.onnx; falls back to MediaPipe if >70 ms |
| MediaPipe selfie seg | KEEP as fallback | Fast, small | Blocky mask (your screenshots 1-2) |
| Pose model (BlazePose) | NOT added | Costs fps on a phone already at 5-11 fps; auto-fit needs only the silhouette | Cannot detect lap/legs; unsupported poses are only documented |
| Depth model | NOT added | Same cost; hand-made depth map is enough for one fixed scene | - |
| Three.js 3D sofa | NOT added | Would not match real light/photo quality; big rewrite | - |
| ARKit/native | NOT used | Product is a web PWA on Android | - |
| Generated photoreal sofa image (your Grok) | NEEDED | Procedural art can never look photographic; only art can fix this | Check Grok licence for commercial use |

## v0.39 — verification matrix (what is MEASURED vs what is NOT)
MEASURED in the build sandbox (headless Chromium, synthetic presenter + a silhouette from your real screenshot):
- unit_seat 49/49: validator; auto-fit lands head width/centre/top on the guide for far/normal/close heads AND on the real face-only silhouette; outlier gate; closer/back hints; body-corridor geometry; subject lift is a no-op in normal light.
- Real-data bug found and fixed: 1-pixel mask speckle at the crown made head width read 1 px (head top wrong). headMetrics now ignores rows < 3 px wide (test: "speckle rows are ignored").
- Chair-leak removal (tools/e2e/leak): simulated chair parts at the frame edges. Mean abs diff vs a clean render: 42.09 without the clip, 0.24 with it.
- Other unit suites (scene_meta, scene, depthdesk, looks, m5) 0 failures. Browser smoke: scene on, seat hint shown, guide drawn, 0 page errors (guide appeared ~11 s after enable in the slow sandbox; phone timing unmeasured).
- Real screenshots: dim-face luma 0.13 / 0.20 (needs lift), good-light face 0.39 (no lift) -> lift thresholds 0.27 trigger, 0.30 floor.
NOT VERIFIED (cannot be, from here): a real person live; MODNet speed on your phone with this scene; recording of the seated composite; hair/shoulder edge quality; fps. t14_m4 did not finish in the sandbox.
Added in v0.39: body-corridor chair clip (seatClip), seated ambient-occlusion halo, velvet texture on the art, guide persists until position held 1.5 s, headTop/speckle-robust fit.
Unavoidable limit: the sofa is procedural art. A photoreal sofa image is the one thing code cannot replace.

## v0.40 — photoreal sofa, offline depth, pose gate (what changed, what is verified)
- **Scene**: your Grok green-velvet sofa replaces the drawn one (same id `scene-lounge-seat`). Bottom-aligned 16:9 crop so the table edge sits at 81% and the presenter's cut-off edge hides behind it. Book + mug are a cut-out foreground layer (`-fg.png`) drawn in front of you. Original kept in `assets/scenes/scene-lounge-seat/source/`. Rebuild: `DEPTH_MODEL=... python3 -I tools/scenes/make_lounge_photo.py`.
- **Depth**: Depth Anything V2 Small (Apache-2.0, sha256 d2b11a11…562be) run OFFLINE; 6 KB PNG ships, no model on the phone. Visually checked: sofa back, seat, table, mug separate correctly.
- **Pose gate** (`js/providers/pose-gate.js`): from the person silhouette, ~1-3 checks/s inside the existing mask pass (no new model, no fps cost). Flags turned / leaning / arms wide / second person; red on-screen banner (not recorded) and the picture freezes its last good fit meanwhile. Face-only framing = "unknown", never a false alarm.
- **Too close ("tight")**: phone under ~1.3 m can't see enough chest to reach the table: bottom of the presenter fades instead of a hard cut, guide says "Move back". Light tip when the room is too dark.
- **Bugs fixed**: fit lift was clamped to 0.12 (head ended ~17% too low); "sit lower/taller" messages were swapped; head detection failed on slow shoulder slopes.
- **Decisions**: no landmark pose model (cannot be downloaded in this session; cannot tell sitting from standing anyway); no Three.js 3D sofa (a CG sofa would not match the photo; the depth map already gives parallax/blur).
- **Tests run**: unit_pose 35, unit_seat 62, unit_scene_meta/scene/depthdesk/looks/m5 all pass. **NOT run**: browser render with a presenter, t14_m4, any real person, any phone. Pose thresholds are uncalibrated on real people (Diagnostics > "Seated scene" shows live numbers).
- **Licence**: Grok terms for commercial use not confirmed (recorded in docs/SCENE_LICENCES.md).

## v0.41 - what changed for Level 3
No change to the live seating code. Added the optional after-recording AI path and the scoring protocol (docs/LEVEL3_EXPERIMENT.md). Level 3 remains: constrained, one scene, one pose, live and on-device. The AI re-render is unproven until a real clip is scored; until then do not describe it as a feature.

