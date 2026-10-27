# Roadmap

## Done (v0.1 — this build)
- [x] Milestone 0: repo + docs
- [x] Milestone 1: camera capture
- [x] Milestone 2: realtime segmentation (free, local)
- [x] Milestone 3: environment compositing (static environments + upload)
- [x] Partial Milestone 6: recording (session-only, downloadable webm)

## Done (v0.2 — this build)
- [x] Virtual camera: aspect ratio presets (16:9/9:16/1:1/4:5/4:3), zoom,
      pan, safe-area + rule-of-thirds guides (overlay only, never recorded)
- [x] Manual mask correction brush (include/exclude) + edge feathering
- [x] Realism engine: tone/white-balance match, contact shadow, light
      wrap/rim light, grain match, one-click toggle, live A/B split preview
      — all free, local, real-time canvas math, no ML model, no cloud call
- [x] Unified asset library (Projects page): recordings + custom
      environments in one place, search, sort, rename, duplicate/branch
      recordings — honest "no cloud sync yet" note instead of a fake toggle
- [x] Accessibility pass: skip links, landmark roles, keyboard-operable
      custom controls (tabs/radio groups/avatar menu), aria-selected/
      aria-checked state sync, prefers-reduced-motion + focus-visible
      already existed and are unchanged/kept
- [x] Live captions: free in-browser transcription (Web Speech API) while
      recording, live overlay, cues saved with the recording, SRT export
      from Projects. Honest limit: Chrome/Edge only, live-mic only — not
      a file transcriber (that needs a paid speech API)
- [x] Timeline editor (v1): trim in/out, markers, non-destructive split,
      sequence builder with reorder + real playback preview, and a REAL
      trim export (captureStream()+MediaRecorder re-capture, not a fake
      progress bar). Honest limit: stitched multi-clip export to one file
      isn't built — needs ffmpeg.wasm or a server re-encode
- [x] Audio Studio (v1): real waveform (decodeAudioData + canvas), gain
      in dB via a live Web Audio GainNode, a real biquad high-pass filter
      for rumble, live peak meters, background-music mixing with a fixed
      duck level, and a real export (Web Audio graph + captureStream() +
      MediaRecorder, audio and video both genuinely re-captured). Honest
      limits: no true LUFS metering (needs K-weighting, not built), no
      dynamic voice-triggered ducking, no AI spectral denoise/TTS/voice
      change — those need a real audio-ML model or paid API
- [x] Templates / Brand Kit: save a full Studio setup (environment,
      quality, framing, realism settings, brand color, logo watermark) as
      a named local preset; apply it in one click from Studio or via
      studio.html?template=id. Watermark is a real per-frame canvas draw,
      baked into recordings when enabled — not a UI-only toggle
- [x] Export upgrades: real bitrate (4/8/16 Mbps) and frame-rate (24/30/60)
      controls wired straight into MediaRecorder for new recordings; SRT
      *and* VTT caption export from Projects; batch social-variant export
      from Editor (9:16/1:1/4:5/16:9) via real center-crop canvas
      re-capture per aspect — genuinely re-encoded, not relabeled
- [x] Performance/reliability (v1): global error boundary (uncaught
      errors/rejections surface as a dismissible toast instead of a
      silent white screen, on every page); crash-safe recording autosave
      (in-progress clips flush to IndexedDB every ~6s, with a recovery
      banner in Studio if a tab closes before Stop); a real IndexedDB
      schema-migration path (DB_VERSION bump adds the drafts store without
      touching existing recordings); an in-browser assertion test suite
      (tests.html — no test-runner install, matches the zero-build
      philosophy) covering the composition/realism/mask/captions/
      templates/storage modules against real IndexedDB
      Honest limits: no WebGPU/WebCodecs/worker offloading, no telemetry,
      no CI pipeline, no bundler/code-splitting — these need either a
      build step this project deliberately doesn't have, or a backend
      to send telemetry to

## Done (v0.3 — this build)
- [x] Fixed a real bug: /assets was completely missing from the project
      (logo + both built-in environment preset images were 404 on every
      page). Generated real placeholder logo + environment backdrops so
      nothing is broken — swap these for your real logo/photos whenever
      you have them, same filenames, no code changes needed
- [x] AI text-to-environment generation — REAL now, not disabled: wired to
      Pollinations.ai (free, zero API key, zero account) in both Studio
      and the Environments page. Swapping in a paid provider (Fal.ai/
      Replicate) later is documented as a one-function change in
      docs/MODEL_PROVIDER.md
- [x] Real logo installed: extracted the R mark from your provided logo
      (dropped the circular badge, kept just the blue/white glyph) as a
      transparent assets/logo-mark.png for every in-app placement, plus a
      dark rounded-square assets/logo.png for the favicon so it's visible
      on any browser tab background
- [x] Real environment photos installed: your 12-image grid was cropped
      cell-by-cell (gutter-safe) and upscaled with high-quality resampling
      into assets/environments/*.jpg. All 6 previously-gradient-only
      built-in presets (Podcast Studio, Classroom, Outdoor, Interview
      Studio, plus the 2 that had placeholder art) now render real
      photos, and 6 new presets were added: Moody Blue Backdrop, Concrete
      Studio, Broadcast Wall, Brick Podcast Room, Color Backdrop Studio,
      Gear Room — 12 built-in environments total, all real photos

- [x] Real file transcription via Groq's free-tier Whisper API — unlike
      the live-mic-only browser captions, this works on any already-saved
      recording, in any browser. Key entered once in Settings → AI
      providers (free at console.groq.com/keys, stored locally, sent only
      to api.groq.com), then "Transcribe (AI)" per clip in Projects feeds
      the same SRT/VTT export already built

- [x] Dynamic voice-triggered ducking — real RMS voice-activity detection
      (AnalyserNode, ~60 checks/sec, hysteresis band to avoid flicker on
      breaths) smoothly lowers music while you talk and lifts it when you
      stop, with fast-attack/slow-release for a natural feel. Runs live in
      preview and is baked into export since it drives the same Web Audio
      graph. A fixed-level toggle is still there for when dynamic isn't
      wanted

- [x] True LUFS metering — a real ITU-R BS.1770-4 implementation: K-weighting
      via two cascaded IIR filters (published spec coefficients), momentary
      (400ms) + short-term (3s) + properly two-stage-gated integrated
      loudness (absolute gate at -70 LUFS, relative gate at -10 LU below
      the ungated mean) \u2014 not a relabeled peak/RMS reading. Honest limits
      noted in-app: coefficients are calibrated for 48kHz, no true-peak
      measurement, and it needs IIRFilterNode (Chrome/Edge/Firefox)

- [x] Worker offloading (v1, scoped): LUFS metering's sum-of-squares
      accumulation now runs in a real AudioWorklet (js/worklets/lufs-worklet.js)
      — the browser's dedicated audio rendering thread — instead of a
      main-thread ScriptProcessorNode callback, with automatic fallback
      if AudioWorklet isn't available (e.g. some file:// contexts). Also
      added `desynchronized:true` to the Studio recording canvas for a
      real one-frame latency win. Honest scope: this is a targeted fix,
      not the full picture — Studio's per-frame compositing pipeline
      (segmentation/mask/realism/composite) still runs on the main
      thread, and export still uses MediaRecorder rather than WebCodecs.
      Moving the whole render loop to OffscreenCanvas-in-a-Worker, and
      swapping export to WebCodecs + a manual muxer, is real, substantial
      follow-on work — flagged honestly rather than claimed as done

## Done (v0.7 — this build)
- [x] Milestone 7.3 (free WHIP→RTMP relay guide): docs/LIVE_RELAY_SETUP.md —
      a real, copy-paste MediaMTX config that bridges Genesis's WHIP output
      to YouTube/Twitch's RTMP ingest, self-hosted, genuinely free. Turns
      "free self-hosted relay" from a research project into a 15-minute
      setup. Honestly scoped: no auth/TLS by default (both covered as
      required next steps before going public), and it names Oracle
      Cloud's Always Free ARM tier with the 2026 downgrade caveat rather
      than assuming it's still what it used to be.

## Done (v0.8 — this build)
- [x] Milestone 7.4 (realism benchmark tool): benchmark.html + js/benchmark.js
      — a real, structured checklist (9 scenarios × 3 quality modes,
      local-only save, Markdown export). This is NOT the benchmark itself —
      it can't see your camera, no page here judges anything — it's the
      instrument that turns "go test it" into something fillable instead
      of a TODO with no shape. Milestone 4 (quality/refinement spend) stays
      gated until this grid has real results in it.

## Done (v0.9 — this build)
- [x] Milestone 7.5 (live captions for live streaming): the "Live captions"
      toggle previously only worked while recording — going live without
      hitting Record meant zero captions, a real gap for a live-first
      product. Now shared/ref-counted between recording and live streaming
      so either one (or both at once) drives the same overlay. Free — no
      new dependency, just wiring the existing SpeechRecognition-based
      provider to a second consumer.

## Done (v0.10 — this build)
- [x] Phase 1 (core quality): temporal mask smoothing — an exponential
      moving average on the mask's alpha channel only, done with two
      drawImage() composite calls rather than a getImageData pixel loop, so
      it stays GPU-composited at no extra perf cost. New "Motion smoothing"
      slider in Refine mask (default 0.55). Honest limit: reduces flicker,
      doesn't fix underlying matting accuracy — a bad edge now flickers less
      while still being wrong.
- [x] Phase 1 (core quality): low-light handling — segmentation-provider.js
      now measures the frame's average luma (cheap 20x12 downscale, sampled
      twice/sec, not every frame) and, only when the room is actually dark,
      feeds the model a brightened/contrast-boosted COPY of the frame for a
      better mask. The visible output (recording + live) is untouched — it's
      sourced straight from the real video element, never from the boosted
      copy, so the room being dark never silently changes what viewers see.
      New "Auto-brighten for the segmentation model" toggle in Refine mask
      (on by default; zero cost when the room is already bright enough,
      since the boost canvas is skipped entirely). Honest limit: this lifts
      the model's input, it isn't a real low-light camera fix — a sensor with
      nothing left to recover in near-total darkness will still segment
      poorly.

## Done (v0.11 — this build)
- [x] Phase 1 (core quality): edge quality pass — mask-refine.js gained a
      despeckle step (approximate morphological close-then-open via
      blur+contrast canvas filters, not a real per-pixel kernel), run before
      feathering on every frame. Closing fills small interior holes (e.g. a
      glasses lens the model briefly loses); opening removes small exterior
      speckles (e.g. a patterned shirt briefly misread as background). New
      "Despeckle" slider in Refine mask (0-5px, default 1 — kept subtle by
      default since this is an approximation). Honest limit: blur+contrast
      is not true morphology — pushed too high it can round off fine detail
      like hair strands, which is why it's low by default and fully
      adjustable, including off.

## Done (v0.12 — this build)
- [x] Phase 1 (core quality): evaluated swapping the segmentation backend
      from the legacy `@mediapipe/selfie_segmentation` package (last
      published 3-4 years ago — genuinely unmaintained) to the actively
      maintained `@mediapipe/tasks-vision` `ImageSegmenter`. DECISION: hold
      off, don't migrate yet. Findings:
      - Same underlying selfie-segmentation model family either way — this
        would buy framework health, not matting quality.
      - The new API's mask type (`MPMask`) only exposes Uint8Array/
        Float32Array/WebGLTexture — there's an open, still-unresolved
        upstream GitHub issue asking for a `getAsImageBitmap()` that
        doesn't exist. Without it, wiring this into Genesis's pure-Canvas2D
        compositor means either a real WebGL rewrite of the render path,
        or a getImageData/putImageData CPU round-trip every single frame —
        a real perf regression and against the no-pixel-loop approach the
        whole pipeline is built on.
      - There's a live, open upstream bug where the GPU delegate scrambles
        the category mask on iOS Safari — directly relevant to Phase 5's
        mobile-web plans.
      - The old package still loads fine from the CDN today with no active
        vulnerability, so there's no urgency forcing this.
      Revisit only if the old CDN package actually breaks, or as its own
      deliberate WebGL-compositor project — not a quick swap.

## Done (v0.13 — this build)
- [x] Phase 2: multiple simultaneous content overlays — the single
      contentBitmap/contentOn/contentCorner/contentScale globals in
      render-worker.js became a Map keyed by overlay id, up to 4 at once,
      each independently toggleable/positioned/sized. Overlays sharing a
      corner stack (offset by the running height of earlier ones in that
      corner) instead of drawing on top of each other. Studio's Content
      panel is now a dynamic list: add up to 4 images, each with its own
      toggle/position/size row and a remove button. Honest limit: still
      session-only, not saved with templates yet — unchanged scope from v1.

## Done (v0.14 — this build)
- [x] Phase 2: additional layouts beyond corner-inset. New "Layout"
      selector in the Content panel, applied to the first enabled overlay
      (other overlays keep stacking as corner insets regardless):
      - Side-by-side: presenter on the left half, content filling the right.
      - Full content + bubble: content fills the frame, presenter shrinks
        to a circular bubble bottom-right, cropped tight around the mask's
        actual bounding box so it isn't mostly empty space.
      - Cutout: content replaces the environment as the background, but the
        presenter is still drawn full-frame like normal — closest to a true
        "presenter directly over content" look.
      Honest limit: side-by-side and bubble skip shadow/tone-match/light-
      wrap — those are calibrated for a full-frame presenter and would
      misalign at a smaller/half scale; cutout keeps full realism since the
      presenter placement is unchanged from the default layout.

## Done (v0.15 — this build)
- [x] Phase 2: slide/deck import — the biggest mmhmm-parity feature.
      Overlays became multi-page: an image-upload now accepts multiple
      files (an image sequence becomes a click-to-advance deck), and a new
      "Add a PDF deck" import renders every page via pdf.js (loaded lazily
      from jsdelivr only when a PDF is actually imported, so non-PDF users
      never pay that cost) into the same slide-deck structure. Each deck
      overlay gets Prev/Next controls showing "Slide X / N"; Left/Right
      arrow keys also advance the primary (first-added) deck overlay
      live, without opening the panel. Render-worker.js's overlay model
      changed from one bitmap per overlay to a `slides` array + `index`.
      Honest limits: pdf.js version is pinned on both the script and worker
      URL together (they must match exactly or pdf.js breaks) — bump both
      if it's ever upgraded; a deck's pages are static renders, so updating
      content means remove-and-re-import, not a live edit.

## Done (v0.16 — this build)
- [x] Phase 2: real screen-share compositing via `getDisplayMedia`. New
      "Share your screen" button in the Content panel alongside image/PDF
      import. No new worker-side code at all: each frame, processLoop
      captures a bitmap from the shared stream's hidden `<video>` and posts
      it through the exact same `overlaySlides` message a static deck uses
      (a 1-page "deck" replaced every tick) — the worker doesn't know or
      care that it's live versus static. Auto-cleans up if the browser's
      own "Stop sharing" bar ends the track, or when the camera session
      stops (screen capture is independent of the camera stream and would
      otherwise keep running/indicating in the browser chrome after Genesis
      itself stops). Honest limit: best-effort per frame — a share that
      hasn't produced a frame yet on a given tick is just skipped, not
      retried, since the next tick covers it anyway.

## Done (v0.17 — this build)
- [x] Phase 2: PiP layout presets. 4 numbered slots in the Content panel,
      each capturing the layout mode + every overlay's on/off, corner, and
      size at save time. Switch live with the 1-4 keys, save the current
      state into a slot with Shift+1-4 — no need to open the panel while
      presenting, mirroring the arrow-key slide-advance pattern already
      shipped. Presets are keyed by overlay LIST POSITION, not overlay id,
      since ids are only assigned at import time and wouldn't exist yet for
      a preset meant to apply to a future re-import. Honest limit: session-
      only, not saved with templates yet, same scope limit as overlays
      themselves.

## Done (v0.18 — this build)
- [x] Phase 2: Director mode. An unlimited ordered sequence of scene cues
      (layout + every overlay's on/off/corner/size + current slide) planned
      ahead of a talk, stepped through live with Next/Back buttons, a
      per-cue "Go" jump, or the PageUp/PageDown keys — the same convention
      PowerPoint already uses for slide navigation, so presenters aren't
      learning a new shortcut. Refactored the capture/apply logic PiP
      presets already had into shared `captureSceneSnapshot`/
      `applySceneSnapshot` helpers so both features (and any future one)
      stay in sync — and as a side effect, PiP presets now also remember
      the slide-deck position, not just layout, which they didn't before.

## Done (v0.19 — this build)
- [x] Phase 2: Live pointer/annotation — the last Phase 2 item, so Phase 2
      is now complete. Two modes, drawn straight into the composite by the
      render worker (baked into recording/live, same as content overlays):
      "Pointer" is a laser dot at a single transient position that vanishes
      on pointerup — nothing persists; "Draw" accumulates freehand strokes
      until "Clear drawing" is pressed. Five preset colors, one active
      stroke tool at a time — turning annotation on auto-disables mask
      brush correction and vice versa, since both capture pointer drags on
      the same preview canvas stack. Stored strokes are cleared on resize
      (aspect/zoom change) rather than drawn stretched at the new pixel
      dimensions.

## Done (v0.20 — this build)
- [x] Phase 3.1 (Milestone 7.2): live reliability refinements beyond v0.6's
      auto-reconnect + trickle ICE. Inspected stream-provider.js first, per
      the roadmap's own instruction, to confirm what was already there
      before adding anything.
      - Quality monitoring: polls getStats() every 3s while live and
        reports real remote-side packet loss and a stalled send pipeline
        (bytesSent flatlined) via a new, separate onQualityChange signal —
        deliberately NOT the same channel as connection status, so a
        genuinely-connected-but-struggling stream doesn't get mislabeled
        as reconnecting/dead. Shows as a quiet amber note under the Go
        Live status, not a state change.
      - Fast offline detection: the OS 'offline' event now triggers the
        reconnect path immediately instead of waiting up to 10-30s for
        RTCPeerConnection to notice on its own; 'online' cancels a pending
        backoff timer and retries right away.
      - Flap-loop cap: a rolling 60s window now tracks drop count across
        reconnects (not just consecutive-failure count, which resets on
        every brief reconnect) — more than 5 drops in that window gives up
        with an honest "your network looks unstable" message instead of
        retrying forever against a connection that keeps dying every few
        seconds.
      HONEST LIMIT carried over from v0.6, unchanged: still no
      simulcast/ABR — that's its own separate Phase 3 item, not folded
      into this one.

## Done (v0.21 — this build)
- [x] Phase 3.4 (originally "simulcast/ABR bitrate ladder for viewers"):
      corrected the scope before building. Real multi-layer simulcast
      needs an SFU forwarding different quality layers per *viewer* —
      Genesis is a single WHIP publisher sending one stream to one ingest
      server, which then hands off to YouTube/Twitch's own server-side ABR
      transcoding. Sending simulcast layers from the browser here would
      just multiply the presenter's own upload load — the opposite of
      helpful on a bad connection.
      Built the version that's actually correct for this architecture:
      sender-side adaptive bitrate. The v0.7 quality monitor's packet-loss
      and stalled-pipeline signals now drive a 4-rung ladder (100/60/35/20%
      of the chosen bitrate, with resolution halved at the bottom two
      rungs) — steps down after ~6s of sustained degradation, steps back
      up after ~15s of sustained good stats, resets to full quality on
      every fresh WHIP session. Reported through the same onQualityChange
      note as v0.7, so the UI explains why quality dropped rather than the
      picture just quietly changing.

## Done (v0.9 — this build)
- [x] Phase 3.5 ("RTMP fallback path for platforms slow to adopt WHIP"):
      corrected the scope before building, same as v0.8. There is no
      browser API for RTMP at all — not a missing feature, a hard
      platform wall (working rule #7) — so client-side JS can never
      publish RTMP directly, to any platform. A true "fallback" living
      only in the browser isn't possible.
      Built the version that's actually correct given that constraint:
      (1) the WHIP Ingest URL field now detects an rtmp(s):// (or any
      non-http(s)) value immediately and explains why, instead of letting
      it fail later with a confusing network error; (2) a new "Generate
      the config" box in the Live panel turns docs/LIVE_RELAY_SETUP.md's
      hand-written mediamtx.yml runOnReady block into a form (platform +
      stream key -> exact YAML, copy button) — YouTube, Twitch, both at
      once (real free multistreaming via multiple runOnReady lines, no
      Phase 3 #2 infra needed for it), or a custom RTMP URL.
      Honest limit: this still requires MediaMTX itself running somewhere
      with ffmpeg installed — that part was never avoidable from a
      browser and still isn't. Nothing typed into the generator leaves
      the page; it's pure client-side templating.

## Done (v0.22 — this build)
- [x] Real bug fix, not a roadmap checklist item: on some Android/Chromium
      builds, the render pipeline's OffscreenCanvas (drawn from a Worker via
      transferControlToOffscreen(), per the comment at the top of the old
      render-worker.js) renders correctly into its own buffer — captureStream()
      and recordings see it fine — but the browser never PAINTS that buffer
      to the actual screen. The live preview showed nothing but the
      canvas element's own `background:#000` CSS forever, even though
      everything downstream (recording, WHIP publish) was working.
      Root-caused via code inspection (not guessing): confirmed the compositing
      itself was fine since recordings were correct, which narrows it to the
      worker-to-screen paint step specifically, a known limitation on some
      Android WebView/Chromium versions.
      Fix: split the whole compositing pipeline (mask refine, realism
      engine, layouts, overlays, annotations, watermark, A/B preview) out of
      render-worker.js into a new js/render-core.js, callable from EITHER the
      Worker (default) or directly from app.js's main thread with no
      OffscreenCanvas hop at all (new Settings → Preview rendering →
      Compatibility mode toggle, vs_renderer_mode in localStorage). Same
      pipeline either way — render-worker.js is now a thin message-wiring
      shim over render-core.js, not a second implementation to keep in sync.
      4 files touched (js/app.js, js/render-worker.js, studio.html,
      settings.html), 1 new file (js/render-core.js). Syntax-checked; diff
      confirms exactly this scope.

## Done (v0.29 — this build)
- [x] FAST mode for low-end devices (item 3 of the post-accounts plan). Four
      real changes, one honest limit:
      1. **FAST was running the heavier model.** MediaPipe's own docs: Selfie
         Segmentation `modelSelection: 0` = general (256x256 input, more FLOPs),
         `1` = landscape (144x256 input, fewer FLOPs, faster). Builds up to
         v0.28 had that backwards in code AND comment, so FAST was mapped to 0.
         FAST is now 1. BALANCED and QUALITY were already on 1 and are
         deliberately untouched (changing them changes every current user's
         picture with no benchmark behind it). `0` is the candidate for QUALITY
         once benchmark.html has real results — a one-line change in
         `MODEL_FOR_MODE` (segmentation-provider.js).
      2. **Lite render pipeline in FAST.** Skips the despeckle pass (4 filtered
         full-frame canvas draws — the heaviest step in MaskRefiner) and the
         light-wrap glow (2 extra full-frame draws, one through a 10px blur).
         Feather, motion smoothing, tone match, shadow and grain are unchanged.
         New `setPerf` render message; flags live on MaskRefiner/RealismEngine.
      3. **Device-aware default.** New js/providers/perf-profile.js reads
         `navigator.deviceMemory` (<= 4 GB) and `hardwareConcurrency` (<= 4).
         If the user never chose a default quality, a low-powered-looking
         device gets FAST pre-selected plus a note in the Quality tab and the
         idle overlay. It is a guess (deviceMemory is Chromium-only, rounded,
         capped at 8; Safari/Firefox expose none), so it recommends and never
         forces, and nothing is written to localStorage. Settings gained an
         "Automatic" default (stored as the ABSENCE of the key) — before this,
         saving any profile change wrote `balanced` explicitly and would have
         silently disabled the detection forever.
      4. **Runtime adaptive degrade (the part that reacts to what the device
         really does).** After 3 consecutive seconds under 15 FPS:
         not in FAST -> banner with a one-tap "Switch to FAST" (hidden while
         recording/live, because the switch restarts the camera);
         in FAST and the model is >= 40% of frame time -> mask refreshes on
         every other frame (the person pixels stay fresh every frame; only the
         cutout edge updates half as often); in FAST but the model isn't the
         bottleneck -> says so instead of degrading the mask for no gain;
         already strided -> says plainly that it's the device's ceiling.
         The rules are pure functions (`decideDegradeAction`), unit-tested.
      **Honest limit:** none of this makes MediaPipe's model itself faster
      than the free local one allows. On a device where inference alone
      exceeds the frame budget, FAST + stride helps; it does not conjure
      30 FPS. Real-device numbers still belong in benchmark.html.
- [x] Fixed alongside (found while tracing the low-end path; each verified
      failing on v0.28 and passing now, in headless Chromium with a fake camera):
      - **Compatibility mode never showed the selected environment.**
        `pushEnvironment`, `pushLogoBitmap` and the annotation pointer
        handlers guarded on `renderWorker` only, so in the main-thread path
        (localCore) environments, logo watermark and annotation drawing were
        silently dead — the preview stayed on the flat placeholder gradient.
        That is exactly the mode low-end/affected Android devices get pushed
        into by v0.22. Guards are now `renderWorker || localCore`.
      - **"Camera feed lost" / "render crashed" banners vanished within a
        second.** The FPS check hid the shared banner whenever FPS >= 15, and
        a frozen camera frame still composites at 60 FPS. It now only hides
        banners it put up itself.
      - **Stop-then-immediately-restart could leave two processing loops
        racing** (old iteration finishing after the new loop started). Every
        start/stop now bumps a loop token; a superseded iteration exits.
        Needed for the one-tap FAST switch to be safe; also covers flip-camera.
      Files: js/app.js, js/render-core.js, js/providers/{segmentation-provider,
      mask-refine,realism-engine}.js, NEW js/providers/perf-profile.js,
      studio.html, settings.html, tests.html (+27 assertions, 27 -> 54, all passing), sw.js
      (cache v14 + new file in precache).
      Not verified: real-device FPS numbers (no hardware here). The
      integration checks used a stubbed MediaPipe with configurable latency,
      so they prove the wiring and the decision logic, not absolute speed.

## Gated on real testing, not on more building
- [ ] Milestone 4 (quality/refinement): decide based on what the realism
      benchmark (see below) actually shows — don't guess.
- [ ] Milestone 5 (AI environment generation): gated on picking + paying
      for an image API — not urgent, static environments work today.

## Done (v0.4 — this build)
- [x] Milestone 7 (livestreaming): REAL now, not disabled — a WHIP
      (WebRTC-HTTP Ingestion Protocol, RFC 9725) publisher in
      js/providers/stream-provider.js, wired to a new "Go Live" panel in
      Studio. Publishes the SAME composited canvas feed (background,
      realism engine, watermark) recording uses — live, not a separate
      pipeline. Honest limits: WHIP is not RTMP, so it does not connect
      directly to YouTube/Twitch — it needs a WHIP-compatible ingest URL
      you provide (self-hosted MediaMTX/OvenMediaEngine are genuinely
      free WHIP→RTMP relays you run yourself; Cloudflare Stream/Mux are
      real paid options with no sustained-delivery free tier — this app
      picks neither for you and bills nothing on its own). No trickle
      ICE, no auto-reconnect, no simulcast/ABR yet — see the top of
      stream-provider.js for the full list, and Milestone 7.1 below for
      what's next.

## Done (v0.5 — this build)
- [x] Milestone 7.1 (live reliability hardening): the render pipeline can no
      longer hang or fail silently.
      - Frame watchdog: every frame sent to the render worker carries a
        token; if the worker doesn't answer within 2s the main loop gives
        up on that one frame and keeps going, instead of hanging forever
        (this was a real bug — one wedged frame used to freeze the entire
        requestAnimationFrame loop with zero on-screen sign anything broke).
      - Worker crash detection: a fatal error in the render worker (via
        self.onerror or an uncaught throw) is caught and surfaced as a
        visible, honest message — "reload to recover" — because the
        OffscreenCanvas handoff (transferControlToOffscreen) is one-way and
        this worker genuinely cannot be recreated without it.
      - Camera-loss detection: MediaStreamTrack ended/mute/unmute listeners
        on the live video track catch an unplugged camera, an OS reclaiming
        it, or a privacy-toggle mute — surfaced immediately instead of
        silently compositing a frozen last frame. If you're live when it
        happens, the Live panel's status flips to an explicit error instead
        of quietly showing "Live" over dead air.
      Honest limits: none of this fixes the underlying stall/crash/
      disconnect — it makes it visible fast instead of silent. True hot-
      recovery (swap in a new canvas element, re-wire recording/live
      capture to it) is real, scoped follow-on work, not attempted here.

## Gated on spending real money — do not build until there's a reason to
- [ ] Milestone 8 (native virtual camera driver) — corrected: this is NOT
      a free, unbuild-yet toggle. There is no Web API for a page to
      register itself as a system camera device — that's a real platform
      wall (CoreMediaIO on macOS, DirectShow on Windows, V4L2 on Linux),
      meaning platform-specific native code, same cost/scope bucket as
      multistream. Needs explicit go-ahead before starting.
      The free path that exists today (OBS Browser Source -> OBS's own
      Virtual Camera -> Zoom/Meet, zero new Genesis code) is documented in
      docs/VIRTUAL_CAMERA_SETUP.md.
- [ ] Milestone 9 (accounts + billing) — pointless before there are users
      other than the founder
- [ ] Milestone 10 (production infra)

## Done (v0.30 — this session)
- [x] Phase 8 (trust & legal): `docs/PRIVACY.md`, `docs/TERMS.md`,
      `docs/CONTENT_MODERATION.md` drafted from the actual code's data
      flows. Pollinations data-leaving-device disclosure added to
      `environments.html` (Groq's was already present in settings.html).
      Real placeholders remain for entity name/jurisdiction/contact email —
      not filled in on your behalf.
- [x] Phase 9 (CI): `.github/workflows/ci.yml` +
      `scripts/run-tests-headless.js` — syntax-checks all JS (`node
      --check`) and runs `tests.html` headlessly via Playwright on every
      push/PR, reading the same #summary text a human sees.
- [x] Phase 10 (onboarding): first-run camera-permission explainer (gated
      on a localStorage flag), a pre-camera link to the existing
      `environments.html` gallery as the "demo before commitment," and a
      3-step go-live wizard in the Live panel that reuses
      `buildRunOnReadyLines()` rather than duplicating the config logic.
      Old flat fields kept under an "Advanced" collapse.

Still deferred, correctly, on things needing your own accounts/decisions:
Supabase project creation, Sentry DSN, payment processor account, Discord
server, pricing decisions, content-moderation process decisions.

## The actual next action
Run the app. Fill in a realism benchmark (static / walking / hand movement /
head rotation / low light / bright light / glasses / long hair / patterned
clothing) against the FAST, BALANCED, and QUALITY modes. Write down where it
breaks. That result — not more code — decides what Milestone 4 even means.
