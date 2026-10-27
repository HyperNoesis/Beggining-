# Genesis signaling server

## What this is, in one paragraph

A WebSocket relay that lets browsers in the same call find each other and
exchange the handshake info WebRTC needs (offer/answer/ICE candidates).
Once two browsers are connected, video and audio flow directly between
them — this server never touches, stores, or sees a single video frame.
It costs almost nothing to run because it does almost nothing.

## What it does NOT do (read this before you rely on it)

- **No media relay (no SFU).** Every participant uploads their video once
  per other participant in the room (pure mesh). Fine for the 6-person
  cap this server enforces; not fine for a real "meeting room" product
  with dozens of people. That needs a real SFU (LiveKit, mediasoup) —
  a different, bigger project, not a setting to flip here.
- **No TURN server.** Only STUN (Google's public one, free). Most home
  and office networks connect fine on STUN alone; some corporate
  networks and strict NATs won't. Adding TURN is a real, ongoing cost
  (bandwidth-metered) — worth doing once you have real users hitting
  this wall, not before.
- **No recording, no chat, no screen share yet.** Camera + mic only, v1.

## Deploy it (pick one — all free at this scale)

### Option A: Render.com (easiest, free tier)
1. Push this `server/` folder to its own GitHub repo (or a subfolder of
   an existing one — Render lets you set a root directory).
2. On Render: New → Web Service → connect the repo.
3. Build command: `npm install`. Start command: `npm start`.
4. Render gives you a URL like `genesis-signaling.onrender.com`. Your
   `signalingUrl` in `js/config.js` is `wss://genesis-signaling.onrender.com`
   (note `wss://`, not `https://`).
5. Free-tier services on Render sleep after inactivity and take ~30s to
   wake on the next call — real limitation, not a bug. Paid tier removes it.

### Option B: Fly.io (free allowance, no sleep)
1. `fly launch` inside `server/` (accept the Node.js detection).
2. `fly deploy`.
3. Your URL is `wss://<your-app-name>.fly.dev`.

### Option C: Your own server/VM
1. Copy `server/` to the machine, `npm install`, then run it behind a
   process manager (`pm2 start signaling-server.js` or a systemd unit)
   so it survives reboots.
2. Put it behind a reverse proxy (nginx/Caddy) with a real TLS cert if
   you want `wss://` on a domain you own — browsers block plain `ws://`
   from an `https://` page.

## After deploying

Open `js/config.js` and set:
```js
signalingUrl: 'wss://your-deployed-url-here'
```
Leave it empty and `call.html` shows a plain, honest "not set up yet"
screen instead of pretending to connect — same pattern as leaving
`supabaseUrl` empty for local-only accounts.

## Local testing (before you deploy anywhere)

```
cd server
npm install
npm start
```
Then set `signalingUrl: 'ws://localhost:8787'` in `js/config.js` (note:
`ws://`, not `wss://`, for localhost) and open `call.html` from two
different browser profiles/devices on the same network.

## Optional: render relay (server/render-relay.js)
Separate from the signalling server. Forwards a RECORDED clip to one AI video-editing provider so the API key stays off the phone. Off unless `RENDER_PROVIDER` is set. `RENDER_PROVIDER=mock node render-relay.js` to rehearse; `aimlapi` needs `AIMLAPI_KEY` (price/free tier UNVERIFIED). Caps: `RELAY_DAILY_CAP` (10), `RELAY_MAX_MB` (20), `RELAY_MAX_ACTIVE` (2). Set `RELAY_TOKEN` and `ALLOW_ORIGIN` on any public host. Clips are never written to disk or logged. See docs/LEVEL3_EXPERIMENT.md.

