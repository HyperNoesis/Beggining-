# Genesis Studio

**Current state: read `docs/HANDOFF_v0.44_FOR_NEXT_AI.md` and the top of `NEXT.md` first** (this README's older sections describe early versions).

Workflow: this repo is the single source of truth. Edit here; pushing to `main` builds the APK (GitHub Actions, Releases). No zips.

---

# Virtual Studio — v0.2 (real app, still zero-cost)

A working slice of the AI virtual production platform, structured like a
real product: accounts, a home dashboard, a studio, an environment library,
a project library, and settings — running entirely in your browser with no
server, no API key, and no monthly bill.

## Run it

1. Unzip this folder anywhere on your laptop.
2. Open `index.html` in Chrome or Edge (needs internet the first time, to
   fetch the MediaPipe model files from a CDN — cached after that).
3. Create an account (stored on this device only — see docs/SECURITY.md).
4. Allow camera + microphone access from the Studio.
5. Pick an environment and quality mode, hit **Start Camera**, hit **● Record**.
   Recordings persist across reloads via IndexedDB — check **Projects**.

No `npm install`, no build step, no cloud account required.

## Pages
- `auth.html` — sign up / sign in (local device account)
- `home.html` — dashboard, recent recordings, environment gallery
- `studio.html` — the actual camera → segmentation → compositing → recording pipeline
- `environments.html` — manage built-in and custom backgrounds
- `projects.html` — full recordings library, play/download/delete
- `settings.html` — profile, default quality, clear local data

## What to test first
Read `docs/ROADMAP.md` — the realism benchmark is the actual next step,
not more features.

## What's real vs. what's an honest placeholder
Read `docs/ARCHITECTURE.md`, `docs/MODEL_PROVIDER.md`, and `docs/SECURITY.md`.
Nothing in this app fakes a result it can't deliver — features that need
real money or real infrastructure (better matting, environment generation,
livestreaming, real multi-device accounts) are visibly disabled or clearly
labeled as local-only, never simulated.

## Live calling, streaming relay, and virtual camera — added, with real limits
- **Live calling** (`call.html`): real WebRTC mesh (up to 6 people), real
  signaling server included at `server/signaling-server.js`. Requires you
  to deploy that server yourself (`server/README.md` has 10-minute free
  options) — `signalingUrl` stays empty and the page stays visibly
  disabled otherwise, same pattern as `supabaseUrl`.
- **Live streaming relay**: `docs/LIVE_RELAY_SETUP.md`'s manual setup now
  also has a one-command Docker version (`docker-compose.yml`,
  `docs/LIVE_RELAY_DOCKER.md`). Still needs a real machine to run on and a
  real TLS cert once it's public — Docker removes packaging friction, not
  the underlying hosting requirement.
- **Virtual camera**: native Zoom/Meet camera integration on macOS/Windows
  needs a vendor-signed system driver tied to a real developer account —
  not something buildable in a coding session regardless of effort (see
  `docs/NATIVE_CAMERA_REALITY.md` for exactly why). Linux has no such
  gatekeeping, so a real `v4l2loopback` bridge is included
  (`server/camera-bridge.js`, wired into Studio's Live panel) — its
  WebSocket-to-ffmpeg pipeline is tested and proven, but the full path
  hasn't been run end-to-end on a real Linux desktop with the kernel
  module loaded; verify before relying on it.
## Genesis v0.3 rebuild notes

This build includes a creator-first Studio shell, stronger Home/Projects/Environments hierarchy, Tasks Vision local segmentation with GPU/CPU fallback, preserved worker rendering, compatibility canvas fallback, and client-secret removal. See `docs/GENESIS_REBUILD_AUDIT.md` and `docs/ARCHITECTURE.md` for the implementation map.

