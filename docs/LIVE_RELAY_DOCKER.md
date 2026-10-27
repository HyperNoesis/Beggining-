# One-command version of docs/LIVE_RELAY_SETUP.md

Same relay, same real setup requirement (you still need a machine to run
it on — see that doc's section 1 for free options). This just replaces
steps 2-4 (download binary, hand-write config, run it) with Docker, so
there's one file to edit and one command to run.

## 1. Fill in your stream key

Copy `.env.example` to `.env` and fill in your real values:

```bash
cp .env.example .env
```

```
YOUTUBE_STREAM_KEY=your-real-key-here
# or TWITCH_STREAM_KEY=your-real-key-here — see mediamtx.yml to enable both
```

## 2. Run it

```bash
docker compose up -d
```

That's it — MediaMTX is now listening for Genesis's WHIP feed on port
8889 and will re-push to YouTube's RTMP ingest the moment Genesis starts
publishing.

## 3. Point Genesis at it

Same as the manual setup — Studio → Live panel → Ingest URL:
```
https://YOUR-SERVER-ADDRESS:8889/genesis/whip
```

## Still real, still has real limits

This doesn't remove the underlying facts from `docs/LIVE_RELAY_SETUP.md`:
you still need a machine (own device or a free-tier VM) that stays on and
reachable while you stream, and you still need a real TLS certificate
once this is reachable from the public internet rather than localhost
(WHIP from an HTTPS page won't talk to plain HTTP). Docker just removes
the "download the right binary for your OS/arch and hand-edit YAML"
friction — it doesn't remove the hosting requirement itself, because
that's a real machine/uptime need, not a packaging problem.
