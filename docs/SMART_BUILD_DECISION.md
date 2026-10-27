# Smart Build decision record (v0.41, 2026-10-24)

Source brief: GENESIS_SMART_BUILD_MASTER_PROMPT.pdf. Labels: **VERIFIED** = read on a primary page or run here this session; **INFERRED** = reasoned from verified facts; **UNVERIFIED** = not confirmed, with a safe test.

## 1. Executive decision
Keep the live path exactly as it is (camera -> MODNet/MediaPipe -> compositing -> preview -> recording, all on the phone, no cloud). Level 3 seating stays a **constrained, scene-specific** feature: one carefully built lounge scene, one supported pose, honest limits. A generative video model is added only as an **optional, after-recording, opt-in** step behind a relay, and only becomes a product feature if it passes the scoring test in `docs/LEVEL3_EXPERIMENT.md` on a real clip. One main coding AI plus open-source/local tools is enough; no multi-agent stack.

## 2. Verified research table
| Candidate | Exact job for Genesis | Source read | Free status / limits | Accepts source video? | Licence | Risks | Verdict |
|---|---|---|---|---|---|---|---|
| MODNet (ONNX) | Live matting, already shipped | repo `LICENSES.md` (earlier session) | Free, runs on device | n/a (per frame) | Apache-2.0 (VERIFIED earlier) | 25 MB model; speed on weak phones | KEEP |
| MediaPipe image segmenter (web) | Live fallback mask, already shipped | [Google guide](https://developers.google.com/edge/mediapipe/solutions/vision/image_segmenter/web_js): page text CC BY 4.0, code samples Apache-2.0; names `deeplabv3.tflite` in its example | Free, on device | n/a | Model licence NOT on that page: UNVERIFIED | Blocky mask on the light model (your screenshots) | KEEP as fallback |
| Depth Anything V2 Small | Offline depth maps for scenes | earlier session, sha in notes | Free, run offline, ships 6 KB PNGs | n/a | Apache-2.0 for Small only (VERIFIED earlier) | none for phone | KEEP (offline only) |
| SAM 2 | Offline/interactive masks when authoring scenes | [facebookresearch/sam2](https://github.com/facebookresearch/sam2) | Free weights; needs a CUDA GPU box | Yes (video segmentation) | Apache-2.0 (VERIFIED) | Too heavy for the live path; SAM 3 not verified | USE LATER for authoring, not live |
| Wan2.1 VACE | Open-weights video editing: source video + mask/reference, V2V / masked V2V | [ali-vilab/VACE](https://github.com/ali-vilab/VACE) | Free weights; VRAM not stated on the page; example uses 8 GPUs for 14B 720p. 1.3B model is 81 frames at 480x832 | Yes (V2V, MV2V, R2V) | Repo Apache-2.0; Wan-based weights Apache-2.0 (VERIFIED); each model inherits its base licence | Needs a rented/own GPU; Wan2.2 not mentioned on the page | CANDIDATE C (self-hosted via render-worker, needs GPU) |
| HappyHorse 1.0 (via AI/ML API) | Hosted video-to-video re-render (adapter built) | [AI/ML API docs](https://docs.aimlapi.com/api-references/video-models/alibaba-cloud/happy-horse-1.0) | Page lists NO price and NO free tier: UNVERIFIED | Yes: `video_url` (HTTPS URL or data URI), 3-15 s, 720p/1080p, `audio_setting: origin` | Not stated; developer not named on the page (path says alibaba-cloud): UNVERIFIED | Paid unless proven otherwise; identity drift untested | CANDIDATE B (never run live) |
| HappyHorse 1.0 Video Edit (via Picsart) | Same job, other reseller | [Picsart page](https://picsart.com/api-platform/models/happyhorse-1.0-video-edit/advanced) | Price on a separate tab not read: UNVERIFIED | Yes: MP4/MOV, 3-60 s, <=100 MB, short side >=360 px, prompt <=2,500 chars, <=5 reference images | Not stated | Resale terms unknown | BACKUP route |
| Gemini Omni Flash `gemini-omni-1.1-flash` | Hosted edit of an UPLOADED clip (adapter built) | [Omni docs](https://ai.google.dev/gemini-api/docs/omni), [pricing](https://ai.google.dev/gemini-api/docs/pricing) (VERIFIED 2026-10-25) | NO free tier ("Not available"). Output video about $0.10/s at 720p (pricing footnote: 5,792 tokens/s at $17.50 per million) | YES: "Upload your videos using the Files API to edit them"; input must be <= 10 s; keeps "the parts of the video you want to keep". Background swap on uploaded video is not explicitly listed (only for model-made video): must be tested | Google API terms (not read) | Uploaded-video editing NOT available in EEA, Switzerland, UK; synchronous call can run minutes; audio references unsupported; identity drift untested | CANDIDATE A (paid, ~$0.6 per 6 s clip: INFERRED from $0.10/s) |
| Veo 3.1 | Not an editor | [Veo docs](https://ai.google.dev/gemini-api/docs/veo) (VERIFIED) | - | Video input only to extend Veo-generated videos; arbitrary uploads not accepted; page says Veo 3.1 Preview shut down 22 Oct 2026 and points to Omni Flash | - | - | REJECTED |
| Gemini CLI (coding agent) | Alternative coding assistant | [Gemini CLI quota page](https://geminicli.com/docs/resources/quota-and-pricing/) | Google account: 1000 requests/day; unpaid API key: 250/day, Flash only; page says Gemini CLI was replaced by Antigravity for unpaid/Google One users on 18 June 2026 | n/a | n/a | Quota/branding changing; a second agent splits context | NOT USED |
| Blender | 3D sofa assets | not researched this session | - | - | - | A CG sofa will not match the photographic scene | REJECTED for now (INFERRED) |

## 3. Stack decision
- **Chosen: A (one main coding AI + local/open tools).** Lowest cost (free plan), best context continuity (one authoritative repo plus NEXT.md), no rate-limit juggling, and the project has already been damaged once by other tools' guessed desk lines (see HANDOFF).
- Rejected B (2-3 tools): no job that a second assistant does better tonight; the only independent check worth paying for is a human watching a real clip.
- Rejected C (5+): adds merge risk, no evidence it helps.
- Tools kept: MODNet, MediaPipe fallback, Depth Anything (offline), existing scene engine. Tools deferred: SAM 2 (scene authoring), VACE (GPU experiment), HappyHorse (paid experiment).

## 4. Current-state audit (evidence)
- Works and was run in headless Chromium with a SYNTHETIC presenter: scene engine, desk occluder, depth layers, seat arms, seat guide, auto-fit, pose gate, chair-corridor clip, seated AO (unit_seat 62, unit_pose 35, leak test 42.09 -> 0.24).
- Real-phone evidence: only three screenshots from the Redmi (MODNet path clean, ~11 fps); no real-person render of the v0.40 sofa yet.
- Partial / unproven: Level 3 with a real person, phone speed of the sofa scene, pose thresholds (uncalibrated), generator licence (Grok terms unconfirmed).
- Security: no real keys in the repo (only `config.example.js` pattern); provider keys live only in the new relay env.
- Test harness bug found and fixed this session: `tools/e2e/pwlib.js`, `pwlib_leak.js`, `pwreal.js` hard-coded `/opt/pw-browsers/chromium-1194`; they now use `CHROME_PATH`, else that path if present, else Playwright's own Chromium. So browser tests run on this and other machines.
- Rendered the v0.40 lounge scene in the browser for the first time (fake presenter). The scene, sofa, table and mug foreground draw correctly with 0 crash. The fake presenter shows as a flat pastel silhouette on **every** scene (control: premium-podcast) so it is a harness artefact of software GL, not a Level 3 finding; it cannot judge real skin, hair edges or contact.

## 5. Target architecture
```
A  REAL-TIME (on device, never waits on network)
   camera -> MODNet / MediaPipe mask -> mask refine -> scene engine (depth layers, seat arms,
   chair-corridor clip, AO, colour match) -> preview canvas -> MediaRecorder -> local file / IndexedDB
B  IMMERSIVE SCENE (authored once per scene, shipped as data)
   scene.json: image + depth + fg + seat{guide, arms, supports}; pose gate decides when the picture is trustworthy
C  OPTIONAL AI RE-RENDER (after recording, opt-in, async)
   saved clip -> render-provider.js (state machine, timeout, retry, cancel) -> relay (server/render-relay.js:
   keys, size cap, daily cap, token) -> ONE vendor adapter -> result URL -> downloaded as a new file
   (original untouched). Missing relay/key/quota => the button explains and nothing else changes.
```
Boundaries: A never imports C. C is not loaded by `studio.html` yet (no UI wired), so today it cannot affect the app at all.

## 6. Tonight's plan and what happened
| Task | Result |
|---|---|
| Inspect repo, checkpoint, baseline tests | Done, all green |
| Verify research candidates | Done where primary pages were readable; Google pages blocked (UNVERIFIED) |
| Browser render of v0.40 lounge scene | Done with fake presenter (limits above) |
| Optional render path + relay + tests | Done, 19 tests |
| Level 3 experiment tooling | Done: `tools/level3/run_candidate.js`, `score.js`, `docs/LEVEL3_EXPERIMENT.md` |
| Run the real experiment | BLOCKED: needs a real consented clip, an API key (paid/unknown price) and/or a GPU |
| UI button in the app | NOT done on purpose: can't be verified on a phone tonight; wiring steps in the experiment doc |

## 7. Implementation (files)
`js/providers/render-provider.js`, `server/render-relay.js`, `tools/e2e/unit_render.js`, `tools/level3/{run_candidate,score}.js` + `scores.example.json`, `docs/LEVEL3_EXPERIMENT.md`, this file, test-harness path fix, NEXT/CHANGELOG/LEVEL3_SEATING notes.

## 8. Verification report
Run and passed: unit_render 19, unit_seat 62, unit_pose 35, unit_scene_meta, unit_scene, unit_depthdesk (23/24 confident), unit_looks, unit_m5, unit_prompter_core, unit_grade, unit_golive, unit_m3left; `node --check` on all new JS; CLI smoke run of `run_candidate.js` against the mock relay (job reached done, output + JSON written).
Not run: t14_m4 and other long browser suites (slow sandbox), anything on a phone, any real vendor call, the relay on a real host.
Weak spot in my own test: the oversize-upload check treats a dropped connection as 413 (it could pass without the relay returning 413).

## 9. Cost and dependency report
Free today: everything in the live path; the relay itself (any free Node host, with the usual sleep/cold-start); mock provider; SAM 2 and VACE weights (Apache-2.0).
May cost money: any hosted video-edit call (HappyHorse price UNVERIFIED), a rented GPU for VACE, relay hosting if you leave the free tier. Cost guards built in: daily cap (default 10 jobs), 20 MB size cap, max 2 running, 720p default.

## 10. Next action
See `NEXT.md` top line: one sitting on the Redmi that produces both the real Lounge Sofa test recording and the raw source clip the experiment needs.
