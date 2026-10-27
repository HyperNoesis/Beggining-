# "Make me part of the scene" plan (written v0.18, for the next AI)
Goal (owner, John): the presenter should look like they are really in the room, live. Honest framing: fixed-camera scene, never "indistinguishable". Constraint: Redmi 14C class phone (Helio G81, ~10 fps camera), free local models only, permissive licences, small verified steps, every feature has a fallback.
Principle: do the expensive work ONCE per scene (depth, light analysis, offline) and keep per-frame work small and cached.

## Five ingredients (status)
1. Light matching. DONE basic: tint, light side, shadow, spill, tone match. NEXT: a tiny harmonisation model that predicts a few global colour/contrast settings (candidate: Harmonizer, same author as MODNet; CHECK the licence and weights source, find a GitHub release asset, run it offline first to measure). Never ship before the licence is confirmed.
2. True relighting (lamp lights one side of the face). NOT live on this phone (heavy). Only as an optional one-time pass for recorded clips. Research only.
3. Depth-based placement/occlusion. START HERE. We already have <id>-depth.png per scene (255 = near). Use it so scene objects can pass IN FRONT of the presenter (desk, mic arm, plant, laptop) beyond the single desk line: build a per-scene "front mask" from depth + the hand-set desk line (anything nearer than the presenter plane and not part of the wall), cache it as a canvas, draw it over the person like the foreground layer. Needs a per-scene presenter depth (the desk-line depth) and a feather. Test on the 3 premium scenes: mic arm, headphones, laptop, plant. Fallback: current desk occluder + -fg.png.
4. Camera matching. DONE basic (grain, tone). NEXT: per-scene noise/softness match, light bloom on the person edge from bright windows.
5. Moving camera (Gaussian splat scenes, SparkJS). LATER research; needs the owner's own captured rooms; check licences.

## STATUS v0.23
- Item 3 (depth occlusion): DONE in the engine (scene-engine.js _buildFront/drawFront, state `occlusion`). Verified visually + t18 on podcast (mic arm, headphones in front of the presenter) and exec office (laptop lid in front of the shoulder), synthetic presenter only. Not yet enabled/verified on the other 10 scenes: render each with the presenter moved over a prop, then set grade.occlusion. Known limit: depth map is 320x180, so prop edges are soft (small halo risk), and thin items may show a faint artefact.
- Desk detector (b): DONE via depth (detectDeskFromDepth): 0.3-2% error on built-ins and most real scenes, 22/23 confident; terrace correctly low-confidence. Used by importer (needs DEPTH_MODEL) and Scene Wizard for library scenes. In-app UPLOADS still use the weak colour-edge detector (no depth without the 99 MB model).
- Item 1 harmonisation: Harmonizer (ZHKKKe) REJECTED: licence is CC BY-NC-SA 4.0 (non-commercial) and weights are on Google Drive (blocked). Find a permissively licensed alternative or do a cheap statistical colour transfer (Reinhard-style) between the presenter and a scene sample.

- v0.23 later: colour match BUILT without a model (scene-engine _updateColourMatch: per-channel chromaticity gain toward the room colour, +/-16% cap, brightness restored; premium scenes 0.5). Measured on the synthetic presenter: blue/red ratio 1.32 -> 1.54 in the blue newsroom, brightness 136 -> 134. Real-person look UNVERIFIED. Wall colour BUILT (tap + flood fill + 'color' blend; Wizard step 4). Classic scenes tucked under a 'Classic' tab, not deleted.
- Owner said licence does not matter ('commercial or not'). Still: non-commercial weights (Harmonizer CC BY-NC-SA) were NOT adopted because the weights are on Google Drive/HF (blocked) anyway, and the statistical method works. If non-commercial weights are ever added, mark them in LICENSES.md and keep them optional/strippable for a paid build.

## Order of work (original)
(a) Depth-based front mask (item 3) + test t18 (an object in front of the presenter stays in front; no halo). (b) Fix the desk detector using the depth map (see HANDOFF: it returns the front edge on real photos). (c) Harmonisation model feasibility (item 1) offline in the sandbox via pip onnxruntime, then browser integration behind the realism toggle with the effects speed test covering its cost. (d) Per-scene camera match tuning. Measure on the owner's Redmi with Diagnostics > Test effects speed each time.
## Honesty
Nothing here is verified on a real phone or a real person yet. Real-person look needs the owner's clips and the blind test (blindtest.html).
