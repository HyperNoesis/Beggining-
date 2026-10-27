# Getting Genesis into Zoom/Meet as a "camera" (OBS Browser Source method)

There is no Web API that lets a browser tab register itself as a system
camera device — Zoom/Meet/Teams pick cameras from the OS (DirectShow on
Windows, CoreMediaIO on macOS, V4L2 on Linux), and a page has no door into
that layer. Genesis cannot fix this from inside the app; it's a real
platform wall, not a missing feature.

The free workaround: let OBS Studio (free, open-source) do the one thing
it's already good at — grab Genesis's on-screen output and re-expose it as
a virtual camera. Zero new Genesis code, ~10 minutes to set up, works on
Windows/macOS/Linux.

## 1. Install OBS Studio

Free, from https://obsproject.com — this also installs OBS's own Virtual
Camera driver (the real native component Zoom/Meet actually see; Genesis
doesn't need to duplicate this).

## 2. Add Genesis as a Browser Source

- In OBS: **Sources → + → Browser**
- URL: your running `studio.html` (e.g. `http://localhost:PORT/studio.html`
  if served locally, or wherever you've deployed it)
- Width/Height: match your chosen aspect preset (e.g. 1920x1080 for 16:9)
- Check **"Control audio via OBS"** if you also want mic audio going
  through this path instead of your normal input

Genesis keeps running exactly as it does today — segmentation, environment
compositing, realism engine, captions, all in the browser tab OBS is
capturing. Nothing in the app changes.

## 3. Start OBS's Virtual Camera

**Controls → Start Virtual Camera** (bottom-right of the main OBS window).
This is what actually creates the system camera device — OBS's own driver,
not anything Genesis ships.

## 4. Pick it in Zoom/Meet

In your video call's camera dropdown, select **"OBS Virtual Camera"**
instead of your webcam. That's it — Genesis's composited output is now
your call camera.

## Honest limits

- **One extra hop.** You're capturing a browser tab, not a direct pipe —
  expect the small extra latency and CPU cost of OBS itself running
  alongside the browser. On a low-end machine this stacks on top of
  Genesis's own segmentation/compositing cost.
- **Manual, per-session setup.** OBS has to be running and its Virtual
  Camera started before the call; Genesis doesn't (and can't) launch or
  control OBS for you.
- **Not a Genesis feature.** If OBS changes its UI or virtual-camera
  driver behavior, this guide can go stale independent of anything in this
  repo.
- **A real native virtual-camera driver built into Genesis itself** (no
  OBS dependency) is a different, much bigger undertaking — platform-
  specific native code (CoreMediaIO extension / DirectShow filter /
  v4l2loopback integration), same cost/scope bucket as multistream. See
  Milestone 8 in ROADMAP.md. Not started; needs an explicit go-ahead.
