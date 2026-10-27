# Model & Provider Tracking

## Segmentation

| Provider | Status | Cost | Quality notes |
|---|---|---|---|
| MediaPipe Selfie Segmentation | ACTIVE | $0 (runs locally) | Clean on plain backgrounds; breaks down on hair strands, fast motion, low light. This is the honest current ceiling. |
| Cloud GPU matting (e.g. RVM/BackgroundMattingV2-class model on rented GPU) | NOT CONNECTED | ~$0.30–$3.50/GPU-hour depending on provider/tier (RunPod, Vast.ai, similar — rates move, re-check before committing) | Expected to meaningfully improve edge quality on hair/motion. Unverified until benchmarked — don't assume, test. |

**To activate the cloud option:** implement `GPUCloudSegmentationProvider.initialize()`
and `.segment()` in `js/providers/segmentation-provider.js` against a real
endpoint, benchmark latency/quality/cost per the founder spec's Section 6
checklist, then flip `qualitySelect`'s ULTRA option from disabled to enabled
in `app.js`.

## Environment generation

| Provider | Status | Cost |
|---|---|---|
| Static gradients / user-uploaded image | ACTIVE | $0 |
| Text-to-image API | NOT CONNECTED | Typically cents per generated image, varies by provider — get current pricing before wiring in |

## Livestreaming

| Provider | Status | Cost |
|---|---|---|
| None | NOT CONNECTED | Usage-based, roughly $0.002–$0.02/minute delivered plus per-destination simulcast fees for providers like Mux — re-verify current rates before committing, pricing on these services changes |

## Rule for this file

Every time a provider is added, swapped, or benchmarked, add a row here with
real measured numbers — not vendor marketing claims. If it hasn't been
tested on this app's actual traffic pattern, mark it UNVERIFIED.
