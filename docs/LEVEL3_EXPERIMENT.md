# Level 3 experiment protocol (optional AI re-render)

Goal: find out, with evidence, whether any source-video editing model can turn "person on an ordinary chair" into "person naturally seated on the green velvet sofa" well enough to ship as an **optional post-process**. The live preview never depends on the answer.

## Inputs (keep them identical for every candidate)
1. ONE consented raw clip, 6-10 s (Gemini Omni rejects input over 10 s, so use <= 10 s), MP4, the person seated on a normal chair, phone at chest-to-eye height ~1.3-1.6 m, good front light. Do not use the composited Genesis output as the source.
2. The same prompt: `LEVEL3_PROMPT` in `js/providers/render-provider.js`.
3. The same resolution (720p) and seconds.
Keep the untouched original; the tool only reads it. The clip LEAVES your computer when you run a hosted candidate.

## Run
- Relay (once), pick one provider per run: `RENDER_PROVIDER=gemini GEMINI_API_KEY=...` (Gemini Omni Flash, about $0.10 per output second, not for EEA/CH/UK users), `RENDER_PROVIDER=aimlapi AIMLAPI_KEY=...` (HappyHorse), `RENDER_PROVIDER=worker RENDER_WORKER_URL=... WORKER_TOKEN=...` (your GPU box, see server/render-worker.js), or `RENDER_PROVIDER=mock` to rehearse. Add `RELAY_DAILY_CAP=5`, then `node server/render-relay.js`.
- Per candidate: `RELAY_URL=http://127.0.0.1:8788 node tools/level3/run_candidate.js clip.mp4 happyhorse --res 720p --sec 6 --out results`
- It saves `results/<name>.mp4` + `<name>.json` (latency, attempts, hash of the source). Fill `costUsd` from the vendor dashboard yourself; the tool does not guess prices.
- Self-hosted candidate (Wan2.1 VACE): run it on a GPU machine per its README, save the output as `results/vace.mp4`, and score it the same way.

## Score (watch the WHOLE video, twice, not a still)
Copy `tools/level3/scores.example.json`, delete the example entry, and score each candidate 1-5 on: identity, body, movement, chairRemoved, contact, occlusion, perspective, lighting, stability, resolution, latency; add `costPerClipUsd` (cost / number of usable clips). Then `node tools/level3/score.js scores.json > report.md`.
Rules baked into the tool: any of identity, body, chairRemoved, stability scoring <=2 is a **FAIL** regardless of the average; average >=3.5 with no gate failure = "usable as optional post-process".

## If every candidate fails
Say so in the UI and docs. Honest fallbacks, in order: keep the constrained live sofa scene (already built); add pose-aware arm occlusion and a cushion contact shadow, tested on real footage; offer the AI render only as a clearly labelled experimental button. Do not describe background replacement as seating.

## The in-app button (done in v0.42)
Set `renderRelayUrl` in js/config.js to show it. Original notes on wiring:
Add `<script src="js/providers/render-provider.js">` to `studio.html` and `sw.js` SHELL_ASSETS (bump SHELL_CACHE), put `renderRelayUrl` in `js/config.js`, then on a saved recording call `VS.RenderProvider.runRenderJob({adapter: VS.RenderProvider.createRelayAdapter({baseUrl}), clip: blob, prompt: VS.RenderProvider.LEVEL3_PROMPT, onState})`, show `PRIVACY_NOTICE` and require a click first, save the result as a NEW recording. Never call it from the live loop.

## Status
Tooling built and tested against a mock and fake upstreams shaped like the Gemini Omni and HappyHorse docs. **No real model has been run.** The Gemini request follows the official Omni page (read 2026-10-25). The HappyHorse request body follows the AI/ML API docs page read on 2026-10-24; that docs page has a typo-level inconsistency (`reference_image_url` vs `reference_image_urls`) and no price or free-tier statement, so treat the contract as UNVERIFIED until one real call succeeds.
