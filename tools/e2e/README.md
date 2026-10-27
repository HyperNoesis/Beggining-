# Self-test tools (used to verify v0.8 in a real headless Chromium)

These are the scripts used to test the studio without a phone:
- `mkfx.py` makes a synthetic person video + exact ground-truth alpha (needs python3, numpy, opencv, ffmpeg).
- `pwlib.js` launches Chromium (Playwright) with a fake camera and injects a *fake soft 256px segmentation model*
  built from the ground truth, so the render pipeline can be tested without downloading any model.
- `t2.js` + `measure.py`: alpha accuracy of the old edge path vs the GPU sharp-edge stage.
- `t5.js`, `t6.js`: Studio Scene checks (desk occluder, desk slider, light direction, shadow, softness, persistence).
- `unit_scene.js`, `modnet_test.js`, `dl_test.js`: Node unit/mocked tests.

Paths inside the scripts point at /tmp (where they were run). Adjust them to your machine before using.
Measured results are listed in docs/STUDIO_SCENES.md.


## v0.13
`t7_v013.js` checks instant start, Diagnostics, failure-keeps-camera and the no-rVFC fallback. Paths are env-driven: set GENESIS_FX to the folder holding person.y4m (mkfx.py writes there), and serve a folder containing `app` (this project) and `fx` on 127.0.0.1:8123 (`python3 -m http.server 8123`). Auto-start is disabled in the test via localStorage vs_autostart=0.
