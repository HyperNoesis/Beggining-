# Free self-hosted WHIP → RTMP relay (MediaMTX)

Genesis's Live panel speaks WHIP. YouTube/Twitch speak RTMP. This is the
free path that bridges them — you run MediaMTX (open-source, Apache-2.0)
yourself; it takes Genesis's WHIP feed in one side and re-sends it to
YouTube/Twitch's RTMP ingest on the other. Zero dollars, real setup time
(~15 minutes).

## 1. Get a place to run it

Any of these work. Pick one:
- **Your own machine**, if you're testing solo and it can stay on and
  reachable while you stream — zero cost, zero setup beyond this file.
- **A free-tier VM** — Oracle Cloud's "Always Free" ARM tier is the most
  realistic zero-cost option as of 2026 (it was cut from 4 OCPU/24GB to
  2 OCPU/12GB earlier this year, but the always-free ARM instance itself
  still exists — verify current terms at oracle.com/cloud/free before
  relying on it, cloud free tiers change without much warning).
- **A cheap always-on VPS** if neither of the above fits — real (small)
  monthly cost, out of scope for "free," flagging so it's not a surprise.

## 2. Install and run MediaMTX

```bash
# Linux/ARM64 example — swap the asset name for your OS/arch from
# https://github.com/bluenviron/mediamtx/releases
curl -L -o mediamtx.tar.gz \
  https://github.com/bluenviron/mediamtx/releases/latest/download/mediamtx_linux_arm64.tar.gz
tar -xzf mediamtx.tar.gz
```

## 3. Configure it: WHIP in, RTMP out

Create `mediamtx.yml` next to the binary:

```yaml
paths:
  genesis:
    # Genesis publishes here over WHIP.
    webrtcICEServers2:
      - url: stun:stun.l.google.com:19302
    # Re-push the same path to YouTube/Twitch over RTMP the moment
    # Genesis starts publishing to it.
    runOnReady: >
      ffmpeg -i rtsp://localhost:$RTSP_PORT/$MTX_PATH
      -c copy -f flv rtmp://a.rtmp.youtube.com/live2/YOUR-YOUTUBE-STREAM-KEY
    runOnReadyRestart: yes

webrtcEncryption: no   # fine for localhost/private-network testing; use a
                        # real TLS cert (webrtcServerCert/Key) once this is
                        # reachable from the public internet — WHIP over
                        # plain HTTP will not work from a browser on HTTPS.
```

Swap the `runOnReady` line's URL for Twitch's RTMP ingest
(`rtmp://live.twitch.tv/app/YOUR-TWITCH-STREAM-KEY`) if that's the target,
or add a second `runOnReady` line to send to both at once (real
multistreaming, today, with what you already have — no extra service).

Requires `ffmpeg` installed on the same machine (`apt install ffmpeg` /
`brew install ffmpeg`) — MediaMTX calls it as a subprocess for the
RTMP re-push; the WHIP ingest side itself doesn't need it.

## 4. Run it

```bash
./mediamtx
```

## 5. Point Genesis at it

In Studio → Live panel → Ingest URL:
```
https://YOUR-SERVER-ADDRESS:8889/genesis/whip
```
(MediaMTX's default WHIP port is 8889; adjust if you changed it.) Leave
the bearer token field blank — this basic config doesn't require one.
Hit **Go Live**.

## Honest limits of this specific setup
- **No auth on the WHIP path** as configured above — anyone who has the
  URL can publish to it. Fine for solo testing; add MediaMTX's
  `publishUser`/`publishPass` (sent as the Authorization header Genesis's
  Live panel already supports) before this is reachable publicly.
- **HTTPS/TLS is on you.** Browsers require secure contexts for camera
  access and, separately, most will refuse a WHIP POST to plain `http://`
  once the page itself is served over `https://` (Genesis is designed to
  be deployed over HTTPS — see docs/DEPLOY.md). Put MediaMTX behind a
  reverse proxy with a real cert (Caddy or nginx + Let's Encrypt are the
  usual free path) rather than exposing raw MediaMTX to the internet.
- **This machine is now a single point of failure for your stream.** If
  it goes down, so does the RTMP re-push — Genesis's own auto-reconnect
  (see stream-provider.js) only covers the Genesis→relay leg, not
  relay→YouTube/Twitch.
