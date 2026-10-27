# Genesis — Master Roadmap to "Best Virtual Studio App in the World"

**Read this first, always.** If you are a future Claude session, a different
AI, or a new developer picking this up cold: this file is the single source
of truth for where Genesis is going and why. Don't guess the vision from the
code alone — read this file end to end before touching anything.

## The vision, in one paragraph

Genesis exists for "studio-anxious streamers" — people who won't go live on
YouTube/TikTok/Twitch/Zoom because their room, lighting, or camera setup
embarrasses them. The promise: open a browser tab, and you look
professional, live, with zero physical setup. No lighting rig, no green
screen, no expensive camera, no room reveal. The direct competitor to beat
is **mmhmm** (presenter + content compositing) plus **XSplit VCam / NVIDIA
Broadcast** (background replacement) plus **OBS** (live production) — Genesis's
bet is that no single existing tool does all three, free, in a browser, with
live streaming as a first-class citizen rather than an afterthought.

## Working rules (apply to every phase below)

1. Inspect the actual code before proposing anything — never assume.
2. Free-tier-first: name the free-tier target for every paid-capable
   feature. No honest free tier → leave disabled, don't fake it.
3. Provider-abstracted, no-build-step vanilla JS. No frameworks/bundlers
   unless a phase explicitly says otherwise (e.g. a native companion app).
4. Honesty over hype in every code comment and every UI string.
5. One feature at a time. Build, verify (syntax-check + trace every
   touchpoint + diff against the previous zip), ship, wait for "next."
6. Flag before any irreversible cost/architecture/scalability decision.
7. If a library/browser API has a hard platform constraint, say so plainly.

## How you'll know you've actually beaten mmhmm and the rest

Not "when the list below is empty" — checklists can be completed
superficially. You've actually won when all of these are true at once:
- A stranger with a messy bedroom and a $20 webcam can go live on YouTube
  looking like they're in a real studio, in under 2 minutes, for $0.
- The realism benchmark (`benchmark.html`) has real filled-in results
  showing the matting holds up in low light, with glasses, with patterned
  clothing, and while moving — not just in ideal conditions.
- You can do everything mmhmm's marketing demos show (content insert,
  layout switching, slides-while-presenting) live, not just recorded.
- Someone can go live on YouTube/Twitch/TikTok simultaneously without
  touching a terminal or reading a setup guide.
- Zoom/Meet/Teams see Genesis as an actual camera choice, no OBS detour.
- A returning user's account, recordings, and templates follow them to a
  new device.
- You have real (even if small) paying users, meaning the business layer
  isn't hypothetical anymore.

---

## PHASE 1 — Core quality (the actual product; do this before anything else)

Nothing below matters if the core promise doesn't hold up. This phase is
the highest leverage in the entire roadmap.

- [ ] Fill in the realism benchmark for real (`benchmark.html`) across all
      9 scenarios × 3 quality modes, on real hardware — write down where it
      breaks instead of guessing
- [x] Temporal mask smoothing (reduce frame-to-frame flicker — the #1
      visible flaw in browser-based matting)
- [x] Low-light handling — segmentation degrades hardest here, and this is
      exactly where the target user's actual room lighting sits
- [x] Edge quality pass for hair, glasses, and patterned clothing
      (currently unverified, named as a weak spot in the benchmark itself)
- [x] Evaluate replacing MediaPipe "Solutions" SelfieSegmentation (an older,
      superseded model) with MediaPipe Tasks Vision's Image Segmenter —
      EVALUATED, NOT ADOPTED. See docs/ROADMAP.md v0.12 for the full
      reasoning: no ImageBitmap output on the new API's MPMask (confirmed
      open/unresolved upstream), forcing either a WebGL compositor rewrite
      or a per-frame CPU pixel round-trip, plus a live iOS Safari GPU-
      delegate bug scrambling the category mask. Same underlying model
      either way, so no matting-quality win to justify the cost right now.
- [ ] Only after the above: revisit Milestone 4 (a paid GPU matting tier)
      gated on what the benchmark actually shows, not on guessing

## PHASE 2 — mmhmm-parity presentation features

This is the "surpass mmhmm" phase specifically — build these one at a time,
same as the Content Overlay milestone already shipped.

- [x] Content overlay v1 — single image inset, 4 corner positions, baked
      into recording/live (shipped)
- [x] Multiple simultaneous overlays (not just one image at a time)
- [x] Additional layouts beyond corner-inset: side-by-side (presenter one
      half, content the other), full-content-with-small-presenter-bubble,
      presenter-in-front-of-content ("cutout" style — presenter silhouette
      directly over the content, no border box)
- [x] Slide/deck import: accept a PDF or image sequence, click-to-advance
      while live, current slide is what gets composited (this is the single
      biggest mmhmm-parity feature — presenting *with* material, not just
      a background)
- [x] Real screen-share compositing (`getDisplayMedia`) as an alternative
      content source to a static image, composited the same way
- [x] Picture-in-picture layout presets, savable/switchable live via
      hotkey, not just in a settings panel
- [x] A simple "director mode": pre-plan a sequence of layouts/slides for a
      whole talk, then step through them live with next/back controls
- [x] Live pointer/annotation — draw or point at the content overlay while
      presenting, visible in the composite

## PHASE 3 — Reliability & live streaming maturity

- [x] Milestone 7.2: live reliability phase 2 refinements beyond what's
      shipped (this may already be partially done — verify against
      stream-provider.js before starting)
- [ ] Multistream: composite → YouTube + Twitch + TikTok simultaneously —
      **real infra cost (fan-out relay server), flagged, needs your
      explicit go-ahead before starting**
- [ ] A first-party managed WHIP relay (paid tier) so users don't have to
      self-host MediaMTX — removes the single biggest onboarding friction
- [x] Simulcast/ABR bitrate ladder for viewers on bad connections —
      corrected in the build: real multi-layer simulcast needs an SFU
      forwarding different layers per *viewer*, which doesn't fit a single
      WHIP publisher → one ingest server → YouTube/Twitch's own ABR
      transcoding. Built the version that's actually correct for this
      architecture instead: sender-side adaptive bitrate/resolution that
      steps down when the PRESENTER's own upload is struggling (detected
      by the Milestone 7.2 quality monitor) and back up once it recovers.
      See v0.8 notes in js/providers/stream-provider.js.
- [x] RTMP fallback path for platforms slow to adopt WHIP — corrected
      scope: browsers have no RTMP API at all, so real "fallback" means
      (1) fast, clear rejection of an rtmp:// URL pasted into the WHIP
      field and (2) an in-app generator for the MediaMTX runOnReady
      config from docs/LIVE_RELAY_SETUP.md (YouTube/Twitch/both/custom).
      Still requires a running relay — that was never avoidable from a
      browser. See v0.9 notes in docs/ROADMAP.md.

## PHASE 4 — Native camera/OS integration

- [ ] Native virtual camera driver (macOS CoreMediaIO / Windows DirectShow
      / Linux v4l2loopback) — **big lift, platform-specific native code,
      same cost/scope bucket as multistream, needs explicit go-ahead.**
      Cheapest proof-of-concept order: Linux (v4l2loopback) → Windows → Mac
- [ ] Until the above exists: keep `docs/VIRTUAL_CAMERA_SETUP.md` (OBS
      workaround) current and discoverable in-app, not just in docs/
- [ ] Optional lightweight companion app (Electron/Tauri) that bundles the
      web app + the native virtual camera driver as one install

## PHASE 5 — Mobile

- [ ] Harden mobile-web path: real testing on iOS Safari and Android
      Chrome for getUserMedia/WebRTC quirks (different from desktop Chrome)
- [ ] Performance profile for segmentation on phone-class GPUs — likely
      needs its own quality-mode tuning, not the desktop defaults
      (v0.29 shipped the FAST-mode groundwork: lighter model, lite render
      pipeline, low-powered-device preselect, adaptive stride. Still open:
      real phone numbers in benchmark.html, and deciding QUALITY's model.)
- [ ] Native mobile app if mobile-web proves insufficient — decide only
      after real device testing, not by assumption

## PHASE 6 — Accounts, backend, cloud

- [ ] Configure Supabase for real (currently unconfigured — every account
      is local-device-only right now)
- [ ] Cloud recording sync (currently IndexedDB-only — a crashed browser
      profile loses everything)
- [ ] Cross-device template/brand-kit sync once accounts are real
- [ ] Team/agency accounts for managing multiple streamer profiles

## PHASE 7 — Business layer

- [ ] Pricing tiers matching the free-tier-first philosophy: free tier =
      everything local/self-hosted; paid tier = managed relay, cloud sync,
      native virtual cam, any paid matting model
- [ ] Payment integration — consider a merchant-of-record option (Paddle,
      Lemon Squeezy) given a Nigeria-based founder selling to a global
      market, simpler than direct Stripe in many respects
- [ ] Referral/affiliate loop — this niche grows through streamer
      communities/Discord word-of-mouth, not paid ads

## PHASE 8 — Trust & legal (blocking before any real users, not optional)

- [x] Privacy policy + Terms of Service — drafted in `docs/PRIVACY.md` and
      `docs/TERMS.md` from the actual data flows in the code. Real
      placeholders remain: legal entity name, jurisdiction, contact email,
      governing law — fill these in and ideally have a lawyer review before
      publishing to real users.
- [x] Explicit "what leaves your device and when" disclosure — Groq
      transcription was already disclosed in settings.html ("never sent
      anywhere except directly to Groq's API when you transcribe").
      Pollinations was NOT disclosed; added in `environments.html` next to
      the generate button.
- [x] Content moderation stance for AI-generated environments — drafted in
      `docs/CONTENT_MODERATION.md`. Honest about what's NOT covered yet:
      an abuse-report process, a client-side prompt filter, and a review
      step once generated images can be cloud-saved (Phase 6) — flagged as
      your decisions, not built.

## PHASE 9 — Ops, performance, testing

- [ ] Production error telemetry (Sentry or similar) — the local toast is
      dev-only, you're blind in production without this. **Needs your own
      Sentry account + DSN key — deferred.**
- [ ] Uptime monitoring once Supabase/backend is live
- [x] CI: lint + run the existing `tests.html` suite headless on every
      change, so solo edits stop relying on manual verification alone.
      Shipped: `.github/workflows/ci.yml` + `scripts/run-tests-headless.js`
      (Playwright, reads tests.html's real #summary text). Lint is
      `node --check` (syntax-only gate) until a real ESLint config exists —
      don't oversell this as style/bug linting in any UI or doc copy.
- [ ] Load-test the WHIP/relay path under real concurrent viewers before
      calling live streaming "production-ready"

## PHASE 10 — Onboarding & growth (safe to do anytime, no code risk)

- [x] Landing/home copy pass naming the actual pain point (shipped)
- [x] A real first-run flow: explains *why* camera permission is needed
      before the browser prompt fires. Shipped as enhanced copy on the
      existing pre-camera overlay (`studio.html`'s idle state), gated on a
      `vs_seen_camera_explainer` localStorage flag so return visits get the
      shorter copy. Not a separate guided 60-second setup flow — scope
      trimmed to the trust-building part, which was the actual ask.
- [x] In-app "go live on YouTube/Twitch" wizard replacing the markdown
      relay-setup guide with a walked-through UI. Shipped: 3-step flow in
      `studio.html`'s Go Live panel (pick destination → generate/paste a
      WHIP URL → confirm and go live). Reuses the existing
      `buildRunOnReadyLines()` config logic rather than duplicating it; the
      old flat fields still exist under an "Advanced" collapse.
- [x] Demo environments previewable before granting camera access —
      shipped as a link from the pre-camera screen to the existing
      `environments.html` gallery (already camera-independent). Honest
      scope note: this is NOT a video demo of Genesis's actual
      background-removal output — building that would need real recorded
      footage, which wasn't fabricated here per the honesty-over-hype rule.
- [ ] Community/Discord presence for the niche — this product spreads by
      word of mouth among exactly the people it's for. **Your action
      (external service) — deferred.**

---

## Cleanup / standing items (revisit periodically, not one-time)

- [ ] Audit every "AI" claim in marketing copy against what's actually
      running — the whole brand asset is honesty, don't let copy outrun
      the roadmap
- [ ] Make sure `js/config.js` (once filled with real Supabase keys) never
      ships to a public repo
- [ ] Re-verify `docs/ROADMAP.md` and this file stay in sync as milestones
      ship — this file is the plan, `ROADMAP.md` is the changelog

## Session handoff protocol

At the start of any new session working on this repo:
1. Read this file in full.
2. Read `docs/ROADMAP.md` for what's actually shipped so far.
3. Inspect the actual uploaded/current code — never trust a summary alone.
4. Ask which numbered item (or sub-bullet) to build next, one at a time.
5. After shipping, update this file's checkboxes and `ROADMAP.md` before
   ending the session, so the next handoff is accurate.
