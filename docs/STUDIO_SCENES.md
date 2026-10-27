# Studio Scenes (v0.8)

Makes you look like you are IN the picture (sitting behind a desk), not pasted on it.
Everything runs on the user's own device. No server, no per-use cost.

## What it does
1. **Desk in front of you.** The part of the scene picture below the "desk line" is drawn over you,
   so a desk/table/console hides your lower body. Tilt, curve and softness follow real desk edges.
2. **Placement.** Size, left/right, up/down. "Auto-fit" seats your shoulders at the desk's back edge.
3. **Light match.** The scene's brighter side is detected; you get a highlight on that side and shade on the other.
4. **Soft shadow** on the wall behind you, cast away from the key light.
5. **Background softness** (depth): blurs only the background, the desk stays sharp.

## How to use
1. Studio > Environment > turn on "Sit inside the scene". Drag the yellow dashed line to the desk's back edge.
2. For your own room: tick "Design it for sitting behind a desk" and use Create World, or tap
   "Copy an AI prompt for a matching scene", generate the picture anywhere, then upload it.
   Good scenes have a wide desk across the bottom third, an empty chair, and clear space behind it.
3. Settings are remembered per scene on that device.

## Verified in a real headless Chromium (synthetic person, fake soft mask)
- GPU sharp-edge stage vs the old edge path (480x270 output): alpha error 0.0101 -> 0.0024,
  edge-band error 0.148 -> 0.041, semi-transparent edge pixels 4893 -> 703 (truth: 1130).
- Desk occluder: under the desk line the output matches the scene picture (mean diff 0.34); with the desk off it
  does not (22.5). Raising the desk line hid most of the head (visible pixels 1634 -> 325).
- Key light: left key brightens the left (+14) and shades the right (-8.5); right key does the reverse (+16.7 right).
- Shadow lands on the correct side of the head (-30 / -24 luminance); background softness cuts sharpness 277 -> 10.
- Settings persist after reload. No page errors with scene + realism + GPU edges together.
- Offline: the MODNet upgrade fails gracefully and the camera stays live on the light model.

## NOT verified (be honest with customers until you have tested these)
- The real MediaPipe / MODNet models (no internet in the test sandbox) and real human footage.
- Speed and heat on real phones (the sandbox uses software rendering, ~3-5 fps).
- Photoreal quality with real faces, hair and clothing. The test person is a flat cartoon.

## Limits (by design)
Fixed camera, 2D layers. It sells "sitting behind a desk in this room" well. It is not a 3D world you can walk through.
Built-in scenes were not made for this: they contain their own people/chairs. Generated desk scenes work best.
