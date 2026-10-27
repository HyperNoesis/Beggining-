# scene.json (schema 1)
One folder per scene: `assets/scenes/<id>/scene.json` + the picture at `assets/environments/<id>.jpg` (the render worker loads built-ins by that name).
`js/providers/scene-library.js` is GENERATED from the same data by `python3 tools/scenes/make_scenes.py` (do not hand-edit).
Required: schema(=1), id, name, type, image, size[w,h], deskLine{y,tilt,bow,feather}, keyLight{side -1|1, colour[r,g,b], softness 0..1}, person{scale,x,y}.
Optional: foreground (PNG with alpha; NOT used yet), camera, floorLine, reflections{desk}, depthLayers[{name,y0,y1,blur}], grade{grain,bloom,vignette}, chair, licence, tags.
Validated on load by `VS.SceneMeta.validate`; a bad scene is skipped, never fatal. `VS.SceneMeta.toEngineState` maps it to engine settings.
Desk edge curve: y(x) = y + tilt*x + bow*4x(1-x), x in 0..1 (same as the occluder).

## Added in v0.14 (all optional)
screens: [{x,y,w,h}] fractions of the frame; get slow animated bars when life>0.
life: {amount 0..1, parallax 0..1}: defaults 0.4 / 0.3 for library scenes (users set it via Finishing touches).
foreground: "assets/environments/<id>-fg.png" (PNG with alpha, same size as the picture, drawn in front of the presenter). The render worker loads it by that exact name and only for ids starting "scene-".

## v0.22
noDesk: true = the scene has no desk to sit behind (keynote stage): the desk occluder is off and the presenter is large at the bottom of the frame like a normal virtual background. deskLine is still required (used for the depth ramp only). depth: path to <id>-depth.png (255 = near). chair.inPicture: an empty chair is part of the picture on purpose.

grade.occlusion (0..1, v0.23): props nearer than the presenter are drawn in front of them using <id>-depth.png (needs the real map, not the estimated ramp). ON (0.9) for premium-podcast and exec-office only (verified by t18 + visual); others default 0 until checked.

grade.colourMatch (0..1, v0.23): statistical colour match of the presenter to the room (premium scenes: 0.5). Wall colour is a per-user setting (state wallOn/wallX/wallY/wallColour/wallTol/wallAmt), not part of scene.json.
