# v0.13 results (written against the Master Brief to Reach 10/10)

Scope done: M1 (Diagnostics panel, self-check, engine memory already present) and the instant-start half of M2.
Not done: single GPU pipeline, thermal governor, real MODNet, device matrix, everything in M3 to M6. See "Not done" below.

## Measured (headless Chromium 141, SOFTWARE GL, fake camera = synthetic person at 15 fps, real self-hosted MediaPipe selfie engine)
These show the sequencing works. They are NOT phone speeds.
| Metric | Result |
|---|---|
| Time from Start to raw camera visible (warm engine) | 93 to 146 ms in 4 of 5 runs (one run 1.3 s; fake-camera open time varies) |
| Time from Start to first cutout (warm) | 770 to 1150 ms in 4 of 5 runs (2.1 s in one) |
| Raw camera shown with canvas hidden before reveal | yes, 11 samples at 50 ms |
| Cutout reveal | 300 ms opacity fade, then raw layer removed |
| Real engine coverage on synthetic person | 23.2 percent, engine "legacy" (self-hosted MediaPipe) |
| Model download blocked (all engines) | camera stays visible, banner, Stop enabled, no blocking overlay |
| Browser without requestVideoFrameCallback | runs on requestAnimationFrame |
| rVFC with 1px-invisible video | fires on most frames; guard fired 3 to 6 times per ~25 frames under software-GL load |
| Studio Scene regression (t5): desk, light side, shadow, persistence | still passes, no page errors |

Tests: tools/e2e/t7_v013.js (17 checks, all pass). Setup notes in tools/e2e/README.md (paths use GENESIS_FX).

## NOT verified (needs a real phone)
- Anything about the Redmi 14C: fps, heat, battery, whether the empty-mask bug is gone, real time to first frame.
- MODNet: model URL, file hash, shapes. The sandbox cannot download it. Still unverified and still lazy/optional.
- Google-hosted Tasks model path. Real faces, hair, glasses, dark skin in poor light, children, hands, two people.
- Whether rVFC helps or hurts fps on that phone: compare "loop:" line in Diagnostics (rVFC [fired / guard]).
- The tests.html unit page still cannot finish offline: one test needs the jsDelivr Tasks bundle. It also crashed in the
  original zip (missing loader.js), which is fixed, so it now gets further.

## Added after the first zip: Battery saver
Toggle plus automatic pressure governor (see changelog). Verified: 8 unit checks, 20/20 browser checks. While testing, the Compute Pressure
API reported high CPU pressure under software rendering and the governor engaged on its own, so that signal does fire in Chromium.
NOT verified: any real battery or heat numbers on a phone, and whether 20 fps cap is the right trade-off on a Redmi 14C.

## Not done from the brief
Device test matrix, real MODNet integration or removal, single GPU pipeline, worker latest-frame queue, thermal/battery governor,
Battery saver, bundle size and Brotli budgets, labelled 40-clip eval set, scene library and wizard, broadcast toolset (M3), accounts
and payments (M5). RVM (GPL-3.0) is still in this build behind an explicit opt-in and must be removed before any paid release.

## First thing to do on the phone
Open Studio, press Start, tap the logo 5 times, tap Copy report, and send it. That gives the numbers section 5 A needs.
