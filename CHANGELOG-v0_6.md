# v0.6 changes
- NEW gl-matte.js: GPU guided upsampling of the model mask against the full-res frame (sharp hair/shoulder edges),
  motion-adaptive temporal smoothing, edge colour cleanup, optional clean-plate assist (fixed camera).
- NEW modnet-provider.js: MODNet (Apache-2.0) real matting model via onnxruntime-web.
- Model selector: Auto / MediaPipe / MODNet / RVM (personal use). Auto runs a one-time speed test per device
  and falls back to MediaPipe if MODNet is too slow (Refine mask panel shows the result).
- RVM is no longer auto-selected anywhere (GPL-3.0). See LICENSES.md.
- Fallbacks everywhere: no WebGL2 -> legacy edge path; model download fails -> MediaPipe.
- Model file: drop models/modnet.onnx next to studio.html for the fastest load (see models/README.txt).

UNTESTED IN A REAL BROWSER: syntax-checked, provider logic tested with mocks, matte math simulated in numpy.

# v0.7.1 fix
- FIXED black preview: the camera crop rectangle was applied to the model mask in camera pixels, but MODNet/RVM masks are
  smaller, so the crop landed outside the mask and every frame came out blank. The rectangle is now converted to mask pixels.
- Frame errors are now shown in the stats line instead of failing silently.

# v0.7.2 (instant start)
- Camera now starts immediately on the light MediaPipe model; MODNet loads in the background (with % progress),
  is speed-tested on the live camera, and is swapped in only if fast enough. Nothing blocks the preview any more.
- MODNet is downloaded ONCE (not once per backend attempt), rejects HTML/404 fallback pages instantly.
- Service worker now caches model files (Hugging Face / Google model hosts), so later launches don't re-download.

# v0.8 (Studio Scenes)
- NEW scene-engine.js: desk occluder, person placement + auto-seat, key-light match, cast shadow, background softness.
- NEW Studio Scene panel (Environment tab) with live yellow desk-line guide; per-scene settings saved on the device.
- Create World can wrap your description so generated rooms work with the desk occluder.
- Verified in a real headless Chromium (see docs/STUDIO_SCENES.md and tools/e2e).

# v0.9 (startup + safety)
- Self-hosted MediaPipe engine (vendor/), pinned fallback, lazy ORT and Supabase, preload + warm-up, auto-start,
  mask watchdog with engine switching and camera passthrough. See docs/V09_STARTUP_AND_SAFETY.md.

# v0.13 (brief milestones M1 + part of M2) — see docs/V013_RESULTS.md for measured numbers
- NEW js/diagnostics.js: hidden Diagnostics panel (tap the logo 5 times, or open studio.html#diag). Shows engine, delegate,
  mask coverage %, mask size, segmentation ms, render ms, fps, stalled frames, loop mode, device/GPU renderer, WebGL2/WebGPU,
  memory, battery, compute-pressure hint, time to camera / first cutout, last 20 errors. "Copy report" copies plain text. Nothing is uploaded.
- First-run self-check: ~4 s after the cutout starts, records OK / NO PERSON SEEN with engine and coverage (shown in Diagnostics);
  a calm banner appears only if no person was seen. Re-runs until it has passed once on a device.
- INSTANT START: the raw camera is shown as soon as the camera is ready (before the model loads); the cutout fades in over
  300 ms once a sane person mask exists (or the watchdog switches to camera passthrough, or after a 6 s cap). No empty scene.
- Model failure no longer shows a blocking error screen: the user keeps seeing themselves, with one plain sentence and Stop enabled.
- Frame loop uses requestVideoFrameCallback (falls back to requestAnimationFrame; a 120 ms guard can never stall the loop;
  after 3 consecutive misses rVFC is turned off for the session).
- FOUND + FIXED while testing: browsers throttle rVFC on display:none videos (measured 3.5 vs 13 callbacks/s on the same feed).
  The camera <video> is now rendered 1px/near-transparent instead of display:none.
- tests.html now loads js/loader.js (the unit page crashed on window.VS.loadScript before).
- sw.js: precaches diagnostics.js; shell cache v037.
- Battery saver (brief D4, partial): toggle in the Refine mask tab. Caps the loop at about 20 fps and refreshes the mask every other frame.
  Suggested by a banner when battery is 20% or lower and not charging; engaged automatically (this session only) if the browser's
  Compute Pressure API reports serious/critical CPU pressure. Both signals are Chromium-only; other browsers just get the manual toggle.
  Logic is pure and unit-tested (tools/e2e/unit_saver.js, 8 checks). Not yet measured on a phone: battery drain and heat are unknown.
- v0.13: Diagnostics report gains a 'Stages ms' line (seg, bitmaps, render wait, frame total, loop period, inference %, stride, quality, sizes). Added after the first phone report showed 9 fps with seg only 58 ms.
- v0.13: requests frameRate ideal 30 from the camera (phone report: 9 fps with only 39 ms work/frame = camera-bound, loop period 116 ms). Diagnostics shows the camera track's reported settings.
- v0.13: measures real camera delivery fps (decoded frames); if loop fps is far below it, auto-switches from rVFC to rAF and remembers (vs_loop=raf).
- v0.13: 'Run full test' button in Diagnostics (needs camera running). Probes raw camera callbacks per video style, then measures loop(rVFC/rAF) x video(tiny/under-canvas), mask stride 2, and engines tasks-cpu/gpu; applies and remembers the fastest sane config (vs_tuned) and adds everything to Copy report. Smoke-tested in tools/e2e/t8_tune.js (sandbox numbers meaningless).
- v0.13: full test also tries camera modes (480x640, 640x480, 720x1280, 1280x720, 640x360, resizeMode none) on the live track, measures decoded fps, keeps a mode only if >=30% faster; saved in vs_tuned.cam and used at next start. PHONE REPORT 4: camera delivers ~10 fps (raw, no processing) despite reporting 30; rAF loop 13 fps re-processes duplicates; battery was 5%.
- NEW Teleprompter (brief F2, partial): Prompter tab. Paste/load .txt script, speed (slider + Slower/Faster buttons), text size, mirror, Space/Up/Down hotkeys, remembers script. On-screen only, never recorded or streamed. NOT built: voice-follow, remote control from a second phone. Tested: unit_prompter.js (5), t9_prompter.js (9 browser checks, sandbox). Not yet viewed on a phone.
- NEW Broadcast graphics (brief F1, partial): Graphics tab. Lower third (name/title/colour, slide in/out), rundown of lower thirds (tap or keys 1-9, H hides), news ticker (text, speed), clock, LIVE tag (label only). Drawn by js/graphics.js into a transparent bitmap sent to render-core ('graphicsBitmap', drawGraphics after drawWatermark at all 3 sites), so it IS in recordings/streams. Only runs while something is visible. Tested: unit_graphics.js (9), t10_graphics.js (9 browser checks incl. pixel diffs); screenshot reviewed. NOT built: logo bug, full-screen cards, social handles, QR code, brand templates. Not yet seen on a phone.
- NEW Looks (brief F8, partial): Looks tab with 5 one-tap looks (News anchor, Podcast, Teacher, Creator vertical, Interview). Sets environment, aspect, zoom, realism intensity and graphics (accent, ticker, clock, LIVE); keeps the user's brand kit; never changes quality or restarts the camera; Undo last look. NOT included: audio preset (no audio chain yet), Scene Wizard settings per look. Tested: unit_looks.js (21), t11_looks.js (7 browser checks). Not seen on a phone.
- Recording hardening (brief F6, partial): (1) recorder format is now chosen by what the browser supports (vp9 webm, vp8 webm, webm, mp4/h264, then browser default); the old hard-coded VP9 threw on iPhone Safari and similar, so recording failed silently; if even the default recorder fails a plain banner says so. (2) Crash-safe draft is now append-only: each 2 s chunk is stored on its own (IndexedDB v3, store draft_chunks) instead of rewriting the whole growing clip every 6 s (O(n^2), would choke a 4 GB phone). Old single-blob drafts still recover. (3) Recovery notice is now a top-of-screen alert; it used to sit inside the hidden Recordings tab so nobody saw it after a crash. (4) Low-storage warning (<300 MB) before recording; 'crash protection off' notice if chunk writes fail. (5) Download extension follows the real format. Uses IndexedDB chunks, NOT OPFS (works on more browsers; revisit if files get huge). NOT done: separate audio-track export, MP4 compatibility check/convert, thumbnail, selectable 720p/1080p. Tested: unit_recorder_mime.js (8), t12_recording.js (8 browser checks incl. simulated crash + recover).
- NEW Audio chain (brief F3, partial): Audio tab. Browser noise suppression + echo cancel (getUserMedia, free), presets Off/Voice/Podcast (high-pass, 3-band EQ, compressor, makeup gain, soft limiter at -6 dB), peak bar + real BS.1770 LUFS readout with plain-language note, mic test (4 s record + playback). Recording and Go Live use the processed track; falls back to the raw mic if the AudioContext is blocked or the graph fails (tested). Measured in headless Chromium: a full-scale 440 Hz sine comes out at about -1.9 dBFS (soft limiter, not brick-wall, but never clips). NOT built: RNNoise/AI noise removal, per-guest audio, separate audio-track export, headphone-detection warning (browsers cannot reliably tell), audio in Looks. Tested: unit_audio_chain.js (18), t13_audio.js (12 browser checks, fake mic). Not heard on a real phone: ask the user to run Mic test with headphones.

## v0.14 — M4 Realism (pass 2)
Added: scene.json format + validator (scene-meta.js, docs/SCENE_FORMAT.md); 12 procedural desk scenes (tools/scenes/make_scenes.py; stylised, NOT photos);
Scene Wizard (js/scene-wizard.js, VS.sceneApi in app.js); desk-line auto-detection with confidence; checkPicture (desk / clear area / exposure, with plain-language fixes);
realism passes in scene-engine.js: colour spill, desk reflection, bloom, vignette (follow the realism toggle, so A/B shows the true before/after);
library scenes seated at CHEST_LINE so head, shoulders and chest show; blind-test tool (blindtest.html, js/blindtest.js, docs/BLIND_TEST.md).
Bugs found by testing and fixed: taps on the wizard sheet started a desk drag and swallowed the click; pointer handler threw before the wizard was first opened; wizard secondary buttons were 34px (now 44px); library seating hid the shoulders and left a chair halo.
Measured: see NEXT.md (unit_scene_meta 66 PASS, t14_m4 27 PASS, t15 10 PASS). Desk detection 11/12 on the generated library (tuned on it; real photos untested).
NOT done: real blind test, parallax/subtle life, one-tap fix flow for generated pictures, foreground layer, photoreal scenes, real-phone check.

## v0.14 (continued) — M4 subtle life, foreground, one-tap fixes
Added: scene "life" (drifting light, floating dust, animated screens from scene.json screens[]); parallax (background drifts with the presenter, desk edge stays anchored); optional per-scene foreground PNG in front of the presenter (<id>-fg.png, living-room has a plant and mug); checkPicture one-tap fix buttons in the wizard; finishing-touch presets now include life and parallax.
Measured (t14_m4, 34 PASS): screens/light move only when life>0 (changed share 0.0015 -> 0.65), background drifts only when parallax>0 (mean level 0 -> 10.5), foreground drawn, fix button changes the setting. unit_scene_meta 79 PASS.
Unmeasured: phone cost of the new passes; tilt-driven parallax not built.

## v0.15 (M4 pass 3)
Effects speed test + auto tier in Diagnostics; scene importer + prompt pack + licence register; desk labelling tool + eval; rebuild_library.js; SceneMeta desk error helpers. Unmeasured: all phone numbers, real-photo desk accuracy.

## v0.16 (M4 pass 4)
Depth Anything V2 Small depth maps baked for all scenes; depth of field + layered parallax in scene engine (estimated ramp fallback); importer writes depth; effects speed test includes dof.

## v0.18
Imported 3 scenes (podcast, blue news, executive office; logo removed), importer --desk-y/--chair, handoff note rewritten.

## v0.19 — Tech Review scene upgraded
Rewrote s_tech painter in tools/scenes/make_scenes.py to match the collage template direction more closely while staying original procedural art (no third-party assets, Apache-friendly).
- Dark shelves with glowing gadget boxes, purple floating monitor, readable cyan neon "TECH REVIEW" sign, side light strips, simple plants, cyan under-shelf accent.
- Same deskLine / keyLight / person seating as before (y=0.65, side=1, scale=0.58).
- Regenerated scene-tech-review.jpg + scene.json via make_scenes.py.
Verified: image exists 1280x720, scene.json validates (schema 1), library rebuild succeeded.
Unverified: visual look on real phone / with live presenter (stylised, not photoreal); no new e2e run required for painter-only change.

## v0.20 — 7 new premium photoreal scenes
Added AI-generated (Grok Imagine) photoreal scenes following the collage templates + Genesis rules (empty chair, desk foreground, fixed camera):
- scene-premium-classroom (Modern Classroom)
- scene-premium-library (Luxury Library)
- scene-premium-living (Contemporary Living Room)
- scene-premium-terrace (Outdoor Terrace)
- scene-premium-minimal (Minimalist Studio)
- scene-premium-talkshow (Talk Show Set)
- scene-premium-tech (Tech Review Studio)

Images resized to 1280×720, scene.json written with estimated deskLine, library rebuilt (22 scenes total).
Church/Stage and Sports Desk generation hit the rate limit this session — not included.
Licence note: generator commercial terms must be confirmed before any paid ship (same as the earlier 3 premium scenes).
deskLine values are estimates; refine with Scene Wizard / desk auto-detect on device.

## v0.21
Fixed desk lines + added depth maps + licence register for the 7 v0.20 premium scenes; restored PRESENCE_PLAN.md. Hand estimates, see NEXT.md.

## v0.22
Sports + Stage scenes added (logos removed, noDesk mode), premium scenes ordered first, 12 premium complete.

## v0.23
Depth-based desk detector (importer + wizard), depth occlusion (props in front of the presenter), Harmonizer licence check (rejected).

## v0.24
Colour match (statistical), wall colour tool, Classic tab, premium colourMatch 0.5. t19 added; t14 updated.

## v0.25
Occlusion enabled on classroom, living, terrace, tech, sports (7 of 12 premium scenes now; the other 5 have no prop nearer than the presenter). eval_desk.js can score the depth detector (DEPTH_MODEL). SHELL_CACHE v053.

## v0.26 — M3 shot 1: Show Conductor + graphics pack
Added: js/show-core.js (pure: cue validation/clamping, parse/serialise with version + size limits, step, replayGfx, summarise) and js/show.js + a Show tab: a list of steps, big NEXT/Back, private note per step (never recorded), step editor, "save what is on screen as a step", copy/load show as text, optional keys (Space/arrows/Page Up-Down, Space yields to the teleprompter while it is showing). A step can change lower third, banner, card, ticker, countdown, handle, QR, channel name, look, scene and audio style; each part is tried on its own so one failure never blocks the rest, with a plain message.
Back and tapping an earlier step REBUILD the graphics from steps 1..N (a card from a later step goes away); NEXT applies on top. Look, scene and audio are set only from the step you land on. Countdowns and auto-hiding lower thirds of earlier steps are not replayed.
Graphics (js/graphics.js): 4 lower-third styles (classic, minimal, glass, bold), lower-third auto-hide timer, breaking banner, full-screen card with optional QR, countdown (turns red in the last 10 s), social handle chip, corner QR, channel name chip (optional brand logo), Clear all, applySpec() used by cues, listeners keep the panel in step.
js/qr.js: own QR encoder (byte mode, ECC L/M, versions 1-10, UTF-8), no dependency, no licence issue.
Measured: unit_qr (11 PASS: decoded by OpenCV, versions 1-10, UTF-8, too-long -> null), unit_show (39 PASS), t20_show (22 PASS in headless Chromium: import/editor/keys/back/jump, banner/ticker/card drawn into the output frame, card QR decoded from the OUTPUT frame, corner QR decoded from the graphics layer, 360 px layout), t10/t11/t9 and unit tests re-run PASS.
Bugs found by the tests and fixed: an object in a text field became "[object Object]" (show-core str()); Back would have left a full-screen card up (replay added); card QR slid under the banner.
Limits (honest): a corner QR is too small to scan at low output quality (about 2 px per module at the 480x270 test output; needs about 4+, so 720p or better); the card QR is much larger. Not run on a phone. Not built: brand-kit auto colours, scoreboard, animated logo bug, per-step transitions. SHELL_CACHE v054.

## v0.27 — M3 shot 2: Brand kit + safe area + scoreboard
Added: js/brand-core.js (pure): colours from the logo's pixels (ignores transparent, white, black, grey; hue-seam safe; black-and-white logos return "no colour" instead of guessing), WCAG contrast helpers. Graphics: accent "Brand" (main colour) + second colour (ticker and channel stripes); one button "Make my graphics match my logo" reads the logo on the device and applies it to lower third + card; text on a light brand colour turns dark (bold block), card background is darkened until white text reaches 4.5:1 (this also fixes Gold), stripes on dark panels are lightened if too dark. Safe area: option to keep tags/QR/banner/scoreboard 5% in from the edges + dashed preview guide (DOM overlay, never recorded). Scoreboard: home/away names, +1/-1, period label, optional game clock (start/pause/zero), shown top left under LIVE; the banner moves down under it. Show cues can set the scoreboard and use the Brand accent; "save what is on screen as a step" captures the score. SHELL_CACHE v055.
Tests: unit_brand 46 PASS (includes draw() with every graphic on, 4 styles x 3 accents x safe on/off). unit_graphics, unit_show, unit_looks, unit_qr still PASS. t21_brand (browser): see NEXT.md for what ran.
Limits: palette is simple hue-bin counting on synthetic logos only (no real brand logos tried); score cues set names/scores/period but cannot start the game clock; scoreboard has no sport-specific layouts; nothing run on a phone.

## v0.28 — M3 shot 3: music bed with auto-duck + soundboard
audio-chain.js: master bus (voice limiter + music + sounds -> recording/stream track), music from the user's own file (looping, in memory), auto-duck (pure duckStep: threshold -42 dBFS, 500 ms hold, 3-30 dB, smoothed), 4 built-in synthesized sounds (ding, whoosh, sting, buzzer: no files, no licence), 4 pads for the user's own files, optional "hear it myself" monitor (off by default, headphone warning). New js/audio-mix.js + Audio tab sections. SHELL_CACHE v056.
Tests: unit_duck 8 PASS, unit_audio_chain PASS, t22_mix (real browser, fake mic) PASS: music audible in the mix, gain dips to 0.25 (12 dB) when voice is present, returns to 1 with ducking off, Stop silences, Ding audible, pad loads, 360 px layout.
NOT done: RNNoise (this sandbox has no network: licence, file and hash could not be checked, so nothing was added), loudness meter still reads the voice only (not music), pads are not saved between sessions, no fade in/out on music, ducking tuned on a fake beep mic only. Nothing run on a phone.

## v0.29 — M3 shot 4: recording extras
js/rec-extras.js: chapter markers (button or key M during recording; double taps within 1 s ignored; copy as YouTube-style chapters with 0:00 added), thumbnail (taken 1.5 s in, saved with the recording), separate audio-only file (a parallel audio recorder on the same processed track; m4a where supported else webm), and a plain-language format check in the Recordings tab (MP4 vs WebM and where WebM will not play). app.js hooks: begin at start, finish at stop, markers + thumbnail saved in recording meta. SHELL_CACHE v057.
Tests: unit_rec 12 PASS, unit_recorder_mime PASS, t23_rec (real browser) PASS: format note, marker rules, thumbnail, 217 KB audio file, chapters, meta saved, 360 px layout.
NOT done: OPFS (the existing IndexedDB append-only crash safety is kept), trim, MP4 conversion. The audio-only file is available right after you stop, not from the saved list later (the saved video still has its audio). The markers/thumbnail are not yet shown in projects.html. Headless Chromium here records WebM only, so the MP4 branch is unit-tested, not browser-tested. Not run on a phone.

## v0.30 — M3 shot 5: teleprompter pace, voice-follow, phone remote
js/prompter-core.js (pure): script words + offsets, matchSpoken (finds where you are from recognised words; needs 2 consecutive words or 1 long unique word; exact beats fuzzy), vadStep (voice activity, hysteresis + 0.7 s hold), pace maths, remote-command whitelist, room code (8 random chars, no look-alikes).
Prompter panel: Scrolling = Steady speed / Follow my voice / Follow my words. "Learn my reading pace": read the first ~18-45 words aloud, tap Done; pace = words / time between first and last speech (refuses too short or silent samples), then sets the manual speed too. Follow my voice: scrolls only while the mic hears you, at your pace (local, no model). Follow my words: browser SpeechRecognition (mock-tested only), falls back to voice mode when unsupported.
Phone remote: js/prompter-remote.js (studio) + remote.html/js/remote.js (second phone). Uses the existing signalling server in js/config.js as a command relay (server unchanged). Buttons: Start/Pause, Slower/Faster, back/forward 3 lines, text size, top, Show NEXT/Back. Only whitelisted commands act; max 12 per second; reconnects; QR + link in the panel.
Tests: unit_prompter_core 30 PASS; t24_prompter2 (real browser + REAL local signalling server) all PASS: pace learned within 15%, silent = no scroll, speaking = scroll, stops after hold, mock-speech word jump + chatter ignored, remote Start/Pause/Faster/lines/NEXT, bad and flooded commands ignored, 360 px remote layout, bad link message. Regressions: unit_prompter/show/graphics/audio_chain, t9, t20, t23 PASS. SHELL_CACHE v058.
Bug found by the test: fuzzy matching let "word5" win over the exact "word52"; exact words now outscore fuzzy ones.
NOT verified: any of it on a phone; the real Chrome speech service (only a mock); SpeechRecognition running at the same time as the recording mic on Android (it may mute or interrupt one of them: test before going live); the deployed genesis-signaling.onrender.com server (tested against the same code run locally; free hosts sleep, first connect can take ~30 s); pace learning with a real voice (tested with a forced mic level); a laptop-level mic threshold of -42 dB may need tuning for quiet voices. Not built: pace that keeps adapting while you read, remote sees script text, end-to-end encryption of commands (the room code is the only secret).

## v0.31 — M3 shot 6: colour grades, match-from-photo, skin smoothing, auto-framing
js/grade-core.js (pure, also loaded by the render worker): 8 parametric grades (Natural, Warm, Cool, Cinema, Vivid, Soft, Film, B&W) with a strength dial; "match the colours of a photo" (mean colour, brightness, contrast, saturation of the photo -> a clamped gentle grade); skin-tone mask (YCbCr, conservative); auto-framing maths (person box -> target zoom/pan: fits by height AND width, headroom, dead-band, exponential approach with a speed cap).
Pipeline (render-core.js): grade filter joins the person filter; tint is painted only on the person's pixels (source-atop); skin smoothing = half-res blurred copy, kept only on skin pixels (160x90 mask refreshed every 3rd frame) and inside the silhouette; reports a person box every 6th frame when auto-framing is on (message personBox). Looks tab: Colour grade chips, strength, photo match, Skin smoothing slider (default 0), Auto-framing toggle, Reset. Everything is remembered.
Honest naming: these are tone/colour grades, NOT .cube LUT files; the grade changes the person, not the room.
Tests: unit_grade 25 PASS; t25_grade (real browser, 22 PASS): Warm/Cool/B&W measured on the output, Natural/strength 0 restore the original, photo match warmer, bad photo message, skin smoothing cuts texture 74% on skin-coloured pixels and leaves blue pixels unchanged (through the real render core with a textured picture), auto-framing pulls a badly framed crop (zoom 2, left) back to ~1.03 / centred, never snaps (<3% per 60 ms), off stops movement, persistence, reset, 360 px layout. Regressions: unit_looks/scene/graphics/show/prompter_core, t11, t10, t19 PASS. SHELL_CACHE v059.
Test lesson: the fixture presenter is flat-coloured, so a skin test on it proves nothing; the controlled textured picture does.
NOT verified: phone speed of skin smoothing and tint (extra full-res draws: unmeasured, default OFF; not in the effects speed test yet); real faces (skin mask tuned on classic YCbCr; darker and very light skin tones, makeup and warm room light may mis-detect: look before going live); auto-framing with a real moving person and a real camera crop (fixture is still); photo match on real photos (only synthetic colours); .cube LUT import not built.
Not done from the brief: one-tap Looks do not set a grade yet; brightness/white-balance auto-assist; gaze correction (research item).

## v0.32 — M3 shot 7: second phone as a camera (QR pairing)
New: js/multisource-core.js (pure: strict message whitelist + size limits, layouts, plain connection notes), js/multisource.js (studio: Content tab section, QR + link, owner must tap Accept for each phone, up to the overlay limit, 4 one-tap layouts), cam.html + js/cam.js (second phone: front/back switch, Stop, reconnect). Video only, phone to phone over WebRTC; the existing signalling server is used for the handshake only (server unchanged). The phone camera becomes a live overlay through the same pipeline as screen share (app.js: shared addLiveSource, window.VS.sourceApi).
Bugs fixed on the way: overlay list rows used class control-section, so switching tabs removed them (hidden Remove buttons); now overlay-row.
Tests: unit_multisource 14 PASS; t26_multisource 23 PASS (QR decoded by OpenCV, junk offers ignored, Accept/Decline, WebRTC connected, picture-in-picture measured in the OUTPUT frame, 4 layouts, flip camera, Stop/Remove cleanup, screen share still works, 360 px layout).
NOT verified: any real phone or network (STUN only, strict NAT will fail), sound from the second phone (not sent), full-screen switch between cameras (only the 4 existing layouts), t20_show and t24 re-runs (slow box; one t24 prompter-position check failed once, unrelated code). SHELL_CACHE v060.

## v0.33 — M3 shot 8: Go Live check (M3 now complete in code)
Already existed (not rebuilt): WHIP publisher, auto-reconnect, packet-loss bitrate ladder, "degraded" note.
Added: js/golive-core.js (pure): plain-language pre-live checklist (camera, WHIP address, https, online, mic heard/silent/too loud, connection type and speed, bitrate vs connection, data saver, frame rate, speed-test tier, battery, "are you also recording a copy") with fail = blocks / warn = allowed; live health reading (good / fair / poor from kbps, fps, loss, round-trip time). js/golive.js: "Check before going live" button + list; the Go Live button now runs the check first: a real problem stops it, warnings stop it once and the button becomes "Go live anyway" (30 s). Stream provider gained an optional onStats (kbps from bytes sent, fps, loss, rtt) that only feeds a health line under the button. Help block "Using OBS, or a free relay" (honest: no system virtual camera on a phone; OBS window capture route is NOT tested). SHELL_CACHE v062.
Tests: unit_golive 31 PASS; t27_golive (real browser; a second page acts as a REAL WebRTC WHIP server): camera off/no URL/rtmp URL block, mic measured, warning arms "Go live anyway", second click goes live over real WebRTC, server receives the video track, health line shows kbps from real getStats, End Live hides it, offline blocks, 360 px layout, no page errors: 18 PASS. unit_multisource/show/graphics/rec still PASS.
NOT verified: any real phone, a real WHIP server (MediaMTX) or YouTube/Twitch, the connection numbers on a real mobile network (navigator.connection is only a rough hint and absent on iOS/Firefox; upload speed cannot be read by a browser), battery API absent on iOS, mic check while the stream is silent by choice. Health numbers in the sandbox were meaningless (1 fps, 50 kbps: slow software GL box).
t26_multisource FAILS in this sandbox ("status says waiting", then a navigation error) on BOTH the untouched v0.32 zip and this build, so it is not caused by this shot; cause not investigated. t20_show, t24 not re-run (slow box).

## v0.34 — M3 finish: RNNoise noise removal (integrated build)
Added: js/worklets/rnnoise-worklet.js (jitsi/rnnoise-wasm dist, Apache-2.0, built from xiph/rnnoise BSD-3; commit cb529a59; wasm inlined, ~1.9 MB, loaded only when the user ticks the box), AudioChain.setDenoise(on) (inserted between mic and the high-pass filter; any failure leaves the mic untouched), Audio tab checkbox "Remove background noise (AI, on this device)" (off by default), LICENSES.md row, vendor/rnnoise licence file. SHELL_CACHE v063.
Tests: t28_denoise PASS (worklet loads; off = exact passthrough; pure white noise attenuated ~80 dB; chain wires/unwires the node). t22_mix, unit_audio_chain, unit_duck, t27_golive re-run PASS.
NOT verified: speech quality with a real voice (test used noise only: check your voice is not clipped or robotic), phone CPU/battery cost, ~10 ms extra delay measured, behaviour when the mic runs at 44.1 kHz (RNNoise expects 48 kHz; the browser context normally runs at 48 kHz but a phone may differ: if your voice sounds pitched or fast, turn it off).
NOT built (still open in M3): trim, OPFS, .cube LUT import, grade inside one-tap Looks, auto brightness/white balance.

## v0.35 — M3 leftovers: grade in Looks, auto brightness/white balance, .cube LUTs, Trim
Added (grade-core.js): autoAssist (gray-world white balance + brightness, dead-banded, slow smoothing, caps: tint alpha 0.12, brightness 0.8-1.25), parseCube / applyLut (3D .cube, size 2-65, DOMAIN_MIN/MAX, trilinear, plain-language errors, 6 MB cap), lutToB64/lutFromB64 (8-bit, remembered in localStorage vs_lut). render-core.js: assist brightness joins the person filter, assist tint is a second person-only tint, LUT runs on the person layer at max 640 px wide then is drawn back with source-atop (so alpha edges are kept; fine detail is slightly softer). grade-ui.js + Looks tab: "Auto brightness and white balance" checkbox (samples the camera ~1/s), LUT file input + amount + remove. Looks: each of the 5 one-tap looks now also sets a grade (News=Cool .6, Podcast=Cinema .5, Teacher=Soft .6, Creator=Vivid .7, Interview=Warm .5); Undo restores the previous grade. js/trim.js: Trim button on a new recording; plays the chosen part and records it again into a NEW copy (original untouched; takes as long as the clip; a little quality lost; HONEST, browsers cannot cut without re-encoding).
Tests: unit_m3left 33 PASS (cube parse/apply identity, invert, amount, domain, errors, b64, autoAssist behaviour, trim time parsing/range); t29_m3left (real browser) ALL PASS: kill-red LUT lowers person red, amount 0 and Remove restore, bad file message, auto assist keeps picture sane and off restores, Podcast look sets Cinema and Undo restores Natural, real recording trimmed to a ~2.5 s copy with original kept, reversed range message, 360 px. unit_grade, unit_looks still PASS. SHELL_CACHE v064.
Bug found by the test: Chrome gives video.captureStream() no tracks until playback starts, so the first trim made an empty file; now plays first and waits for tracks.
DECISION, NOT BUILT: OPFS recording. The existing IndexedDB append-only crash-safe draft already protects a recording; OPFS would add risk (not on every phone browser) for little gain.
NOT verified: LUT/auto-assist speed on a phone (LUT is a CPU pass: lower the amount or remove it if choppy), real .cube files from Resolve/Premiere (tested on generated cubes), auto white balance on real faces and mixed light, trim on a phone browser (needs video.captureStream) and with MP4 recordings.
M3 is now complete in code except the desktop virtual-camera wrapper (M6).

## v0.36 — M5 business (build side)
Added: landing.html + js/landing.js (public page, pilot form via WhatsApp/email link, before/after slider only when real pictures exist, scene thumbnails otherwise, optional https pay link), privacy.html + terms.html + js/legal.js (render docs/*.md, fill js/config.js business, visible "not ready to publish" banner), js/ba-capture.js + Studio button (saves before.jpg/after.jpg), config `business` and `payLinks`, docs/PRIVACY.md updated to the real data flows (second-phone relay, STUN, local effects, payments, NDPA rights), docs/M5_BUSINESS.md (what is built, owner checklist, payments and NDPA research with sources, pilot plan). index.html sends signed-out visitors to landing.html. SHELL_CACHE v065.
Tests: unit_m5 16 PASS (placeholder fill/missing, markdown render incl. script escaping and javascript: links, pilot message/WhatsApp/mailto, length caps); t30_m5 ALL PASS twice (landing closed/open states, slider, pay link, legal pages and banners, index routing, two real JPEG downloads, 360 px, no page errors).
Honest: no real payment integration, no feature gating, legal wording unreviewed, no real before/after pictures (the sandbox's fake presenter looked bad, so I did not use it), pilot not started. The sources I read did not give Paystack subscription terms, NDPC fees or deadlines.
Test note: t22_mix "duck off -> music gain returns to 1" flaps in this sandbox (min gain 0.25 to 0.93 between runs) on BOTH this build and the untouched v0.32, using a stand-in /tmp/music.wav I generated (the original test file was not in the zip), so it is not a regression from this work; re-run it with a real music file.

## v0.37 — Level 3 seating foundation
Added scene.json `seat` (validated), engine drawSeat() (sofa arms in front of presenter), seat positioning guide, scene-lounge-seat (procedural prototype), tools/scenes/make_lounge.py, tools/e2e/unit_seat.js, docs/LEVEL3_SEATING.md. SHELL_CACHE v065. No existing scene changed.

## v0.41 - Smart Build pass: optional AI re-render path + Level 3 experiment tooling
Added: js/providers/render-provider.js (client job runner: states, timeout, retry on transient errors only, cancel, never throws; relay adapter; privacy notice; Level 3 prompt), server/render-relay.js (zero-dependency relay: providers mock + aimlapi `alibaba/happyhorse-1-0` per the AI/ML API docs; token, CORS allowlist, 20 MB cap, daily cap, active cap, no disk writes, key never returned), tools/level3/run_candidate.js + score.js (+ scores.example.json), docs/SMART_BUILD_DECISION.md, docs/LEVEL3_EXPERIMENT.md.
Fixed: browser test helpers hard-coded one Chromium path (pwlib.js, pwlib_leak.js, pwreal.js); now CHROME_PATH / existing path / Playwright default. t15_blindtest.js and a few one-off scripts still contain the old path.
Tests: unit_render 19 PASS (runner states, retries, cancel, timeout, relay auth/caps/415/413/503, request shape against a fake upstream, key not leaked); unit_seat 62, unit_pose 35, scene_meta, scene, depthdesk, looks, m5, prompter_core, grade, golive, m3left PASS. CLI smoke against the mock relay OK.
Rendered scene-lounge-seat in a real browser with the fake presenter: scene/foreground draw, no crash. The fake presenter is a flat pastel silhouette on every scene (also premium-podcast), so it says nothing about real people.
NOT verified: any real vendor call (HappyHorse price/free tier unknown), the relay on a host, any real person or phone. studio.html/sw.js unchanged (new file is not loaded by the app yet).

## v0.42 - AI re-render wired into Studio + self-hosted GPU worker
Added: js/render-ui.js (button under each saved recording; hidden unless renderRelayUrl set; confirm dialog with the privacy notice; cancel; result saved as a NEW recording; if the browser cannot download the vendor result it shows an 'Open the AI version' link), config keys renderRelayUrl/renderRelayToken, studio.html + sw.js (cache v071), app.js hook after Trim. server/render-worker.js + relay provider `worker` (relay proxies the result, so the worker token never reaches the browser). Runner keeps the result URL when a cross-origin download is blocked instead of failing a finished job.
Tests: unit_render 21 PASS; t31_render_ui 7 PASS (real Chromium, mock relay: no URL = no button; URL = button, confirm once, blob delivered, no page errors); seat/pose/scene/looks/m5 unit suites PASS.
NOT verified: any real vendor, VACE on a GPU (its command line is yours to supply and unverified), phones, t14_m4. render-ui looks unstyled-simple (reuses .btn ghost); not checked at 360 px.

## v0.43 - Gemini Omni Flash provider
Added relay provider `gemini` (POST /v1beta/interactions, inline base64 video in, base64 video out, background job + polling), docs updated with verified facts (10 s input limit, no free tier, EEA/CH/UK unavailable, ~$0.10/s). Tests: unit_render 23 PASS (request shape, result served by relay, key not leaked, 403 -> safe region message). NOT run against Google (no key). Base64 inline size limit of the API is UNVERIFIED (docs recommend the Files API for large clips; a 10 s phone clip is usually a few MB).

## v0.44 - Clarity: ship the good matting engine inside the app
Finding: on the phone the cutout was blocky because the app tried to DOWNLOAD MODNet and onnxruntime from the internet, and the APK did not contain the model, so it quietly used the light MediaPipe model. Fix: models/modnet.onnx and vendor/ort/ (onnxruntime-web 1.25.1: ort.min.js, ort.webgpu.min.js, two wasm files, helper modules renamed .mjs -> .js for Android WebView MIME safety) are now in the project; js/ort-loader.js loads local first (CDN only as fallback) and passes explicit wasm/module URLs; modnet-provider.js and rvm-provider.js use it. Speed ladder in app.js backgroundUpgrade: if MODNet is slower than 70 ms it retries at 320 then 256 px long edge before falling back to the light model; bench record is versioned (v2) so old 'too slow' verdicts from the single-size test are ignored.
Research outcome: ORT WebGL backend cannot run MODNet (error 'int64 is not supported', measured), and ORT's own docs call WebGL maintenance-only; WebGPU output is bit-identical to WASM (mean abs diff 0.00000, software WebGPU here, speed meaningless); RVM is GPL-3 and MatAnyone is non-commercial so neither can be the default; a native Android MediaPipe plugin was rejected for now (frame transfer cost, unverifiable here).
Tests: t32_modnet_offline PASS (runtime local, MODNet active, IoU 0.9968, 0 page errors, external hosts blocked); t33_ladder_smoke PASS (ladder ran offline, bench v2 recorded); unit_render 23, seat 62, pose 35, scene, looks, m5, t31_render_ui 7 PASS.
NOT verified: phone speed and which size the Redmi lands on, WebGPU availability inside the Android WebView, that the WebView serves .wasm correctly (ORT falls back to non-streaming load if the type is wrong), multi-thread WASM (needs cross-origin isolation, not available in the Capacitor local server).

## v0.44b - hang mitigation + handoff
From John's phone report (legacy engine, stride 2, 10.2 fps camera, cracks, first two runs hung): timeProvider() now yields 30 ms between frames and aborts above 500 ms; benchmark uses 5+1 then 4+1 frames. Diagnostics build string v0.44. Added docs/HANDOFF_v0.44_FOR_NEXT_AI.md. NOT verified on the phone.
