# Security & Privacy — Current State (v0.2)

## Accounts
Local-device only. Stored in this browser's `localStorage`:
- Password hashed with SHA-256, no salt, no server-side verification.
- No account recovery, no email verification, no cross-device sync.
- Anyone with access to this browser profile can read the raw localStorage
  data (it's not encrypted at rest).

**This is fine for solo validation. It is not real auth.** Before a second
real person other than you signs up, this needs to become a real backend
(e.g. Supabase Auth or similar) with server-side password verification,
proper hashing (bcrypt/argon2 + salt), and HTTPS. Don't skip that step
because the local version "worked."

## Video/camera data
Never leaves the device. Segmentation runs locally; recordings are stored
locally in IndexedDB. No frames are uploaded anywhere in this version.

## What changes when a real backend is added
- API keys for any paid provider (matting, image generation) must live on
  a server, never in this frontend code — the moment `GPUCloudSegmentationProvider`
  gets implemented, its API key cannot be hardcoded into `segmentation-provider.js`
  the way local-only code can get away with today.
- Recordings moving to cloud storage need access control per user, not just
  "whatever's in this browser."
