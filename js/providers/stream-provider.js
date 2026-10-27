/**
 * Live streaming provider — real WebRTC-WHIP publisher.
 *
 * What this actually does: takes the SAME composited canvas feed used for
 * recording (els.canvas.captureStream()) plus the mic audio track, opens an
 * RTCPeerConnection, and publishes it via WHIP (WebRTC-HTTP Ingestion
 * Protocol — IETF RFC 9725): POST an SDP offer to a URL, get an SDP answer
 * back, media flows. No RTMP, no ffmpeg, no server of ours involved.
 *
 * Provider-abstracted like every other module here: app.js only calls
 * start()/stop()/on status changes. Swapping WHIP for a different ingest
 * protocol later means changing this one file, not app.js.
 *
 * v0.6 additions (real, scoped):
 *  - Trickle ICE: the offer is sent after a short (300ms) head start rather
 *    than waiting for full ICE gathering, and any candidates discovered
 *    after that are PATCHed to the WHIP resource URL as they arrive
 *    (Content-Type: application/trickle-ice-sdpfrag, body = the raw
 *    candidate string — the same wire format real WHIP client libraries
 *    use in practice). Faster connect, and NAT-traversal candidates that
 *    show up late still reach the server instead of being silently dropped.
 *  - Auto-reconnect: if the connection drops on its own (network blip,
 *    server hiccup) — not because you pressed End Live — this retries with
 *    backoff (1s, 3s, 8s) before giving up and reporting a real failure.
 *    Status 'reconnecting' is distinct from 'live' and 'error' so the UI
 *    never claims to be live while it's actually mid-retry.
 *
 * HONEST LIMITS — read before relying on this for a real show:
 *  1. WHIP is NOT a YouTube/Twitch/Facebook connection. Those platforms take
 *     RTMP(S), not WHIP. To go live on them from here you still need a WHIP
 *     ingest endpoint that itself re-sends to RTMP — either:
 *       - A WHIP-native platform (works with zero extra hops): Cloudflare
 *         Stream, Mux, Millicast, Dolby.io, LiveKit Cloud, Twitch's own WHIP
 *         beta, OvenMediaEngine, or a self-hosted MediaMTX/go2rtc instance.
 *       - A WHIP-to-RTMP relay in front of YouTube/Twitch (MediaMTX and
 *         OvenMediaEngine both do this, self-hosted, genuinely free — you
 *         just run the server yourself, e.g. on a free-tier VM or your own
 *         machine on the same network).
 *     This file does not pick or pay for any of those — you paste in
 *     whichever WHIP endpoint URL you've set up, in the Live panel.
 *  2. Trickle PATCH sends the bare candidate string, not a full RFC 8840
 *     sdpfrag (with ice-ufrag/pwd/m= lines). This matches what production
 *     WHIP client libraries actually send and what MediaMTX/most WHIP
 *     servers accept — but a strict-RFC8840-only server could reject it.
 *     If your endpoint 400s on PATCH, that's why; the initial offer/answer
 *     still carries the head-start candidates, so the stream can still
 *     connect on the first exchange even if every trickle PATCH fails.
 *  3. Auto-reconnect re-negotiates a fresh WHIP session (new offer/answer)
 *     — it is NOT a seamless resume. Viewers on the platform side will see
 *     a few seconds of a stalled/black frame during each reconnect. Gives
 *     up after 3 attempts (~12s total) and reports a real error rather than
 *     retrying forever.
 *  4. v0.8 added SENDER-SIDE adaptive bitrate (see below) — this is NOT
 *     multi-layer simulcast. Simulcast exists so an SFU can forward
 *     different quality layers to different *viewers*; Genesis is a single
 *     WHIP publisher sending one stream to one ingest server, which then
 *     hands off to YouTube/Twitch — those platforms already run their own
 *     server-side ABR transcoding for viewers once a stream reaches them.
 *     Sending multiple simulcast layers from here would just multiply the
 *     presenter's own upload load, which is the opposite of helpful on a
 *     bad connection. Codec choice is still whatever the browser
 *     negotiates — unchanged from v0.4.
 *
 * v0.7 additions — Phase 3.1, reliability refinements beyond v0.6:
 *  - Quality monitoring: polls getStats() every 3s while live and reports a
 *    separate 'degraded' signal (via onQualityChange, NOT onStatusChange —
 *    the dot stays "live" because the connection genuinely is; this is a
 *    second, quieter signal that something's wrong with it) for two cases
 *    getStats() can actually see: real outbound packet loss reported by the
 *    remote (remote-inbound-rtp), and a send pipeline that's stopped moving
 *    bytes despite the connection reporting as open (bytesSent flatlined).
 *    HONEST LIMIT: this reads what the browser exposes about the RTP
 *    connection. It cannot see viewer-side buffering/rebuffering on
 *    YouTube/Twitch's end — that is past the WHIP relay, out of reach here.
 *  - Fast offline detection: browsers can take 10-30s to flip
 *    RTCPeerConnection.connectionState to 'disconnected' after Wi-Fi
 *    actually drops. The OS-level 'offline' event fires immediately, so on
 *    it this now triggers the same reconnect path right away instead of
 *    waiting on WebRTC to notice. Its counterpart 'online' cancels any
 *    pending backoff timer and retries immediately, rather than waiting out
 *    a delay chosen for a network that may already be back.
 *  - Flap-loop cap: the existing 3-attempt backoff resets to 0 on every
 *    successful reconnect, so a connection that connects-then-drops
 *    repeatedly (a real, not rare, failure mode — e.g. a flaky router)
 *    could retry forever without ever surfacing a persistent problem. This
 *    now tracks drop timestamps in a rolling 60s window; more than 5 drops
 *    in that window gives up with an honest "your network looks unstable"
 *    message instead of silently looping.
 *
 * v0.8 additions — Phase 3.4, sender-side adaptive bitrate:
 *  - The quality monitor above already detects a struggling upload
 *    (packet loss / stalled send pipeline). It now acts on that: steps the
 *    encoder DOWN a rung (lower bitrate cap + reduced resolution via
 *    scaleResolutionDownBy) after ~6s of sustained degradation, and steps
 *    back UP after ~15s of sustained good stats — never on a single poll,
 *    so one noisy sample doesn't flap the picture quality up and down.
 *  - Ladder: 100% / 60% / 35% / 20% of the chosen bitrate, with resolution
 *    cut in half at the bottom two rungs (a bitrate cap alone gets very
 *    blocky at 1080p; cutting resolution too keeps the picture legible at
 *    the cost of sharpness instead of the cost of legibility).
 *  - Resets to full quality (rung 0) at the start of every fresh WHIP
 *    session — a new connection gets a clean start rather than inheriting
 *    a previous session's degraded state.
 *  - Reported through the same onQualityChange the monitor already uses,
 *    so the UI note explains WHY quality dropped instead of the picture
 *    just quietly changing with no explanation.
 */
(function () {
  const RECONNECT_DELAYS_MS = [1000, 3000, 8000];
  const STATS_POLL_MS = 3000;
  const FLAP_WINDOW_MS = 60000;
  const FLAP_MAX_DROPS = 5;
  // Each rung: fraction of the chosen bitrate, and scaleResolutionDownBy
  // (1 = full res, 2 = half width/height = quarter the pixels).
  const BITRATE_LADDER = [
    { frac: 1.00, scale: 1 },
    { frac: 0.60, scale: 1 },
    { frac: 0.35, scale: 2 },
    { frac: 0.20, scale: 2 },
  ];
  const STEP_DOWN_AFTER_POLLS = 2; // ~6s of sustained degradation
  const STEP_UP_AFTER_POLLS = 5;   // ~15s of sustained good stats — recover slower than we degrade

  class WHIPStreamProvider {
    constructor() {
      this.pc = null;
      this.resourceUrl = null; // WHIP session URL from the Location header — needed to DELETE/PATCH
      this.onStatusChange = null; // (status, detail) => void
      // status values: 'connecting' | 'live' | 'reconnecting' | 'error' | 'stopped'
      this.onStats = null; // (stats) => void — optional live numbers for a health readout
      this.onQualityChange = null; // (level, detail) => void — 'good' | 'degraded', independent of status above
      this._videoTrack = null;
      this._audioTrack = null;
      this._pendingCandidates = []; // gathered before resourceUrl is known yet
      this._generation = 0; // bumped on every start()/stop() so stale reconnect timers no-op
      this._reconnectAttempt = 0;
      this._reconnectTimer = null;
      this._dropHistory = []; // Date.now() of each drop this session — flap-loop detection
      this._lastParams = null; // { mediaStream, endpointUrl, bearerToken, videoBitrateBps } for auto-reconnect
      this._stopping = false;
      this._statsInterval = null;
      this._lastBytesSent = null; this._lastStatTs = null;
      this._staleBytesPolls = 0;
      this._videoSender = null;
      this._baseBitrateBps = null;
      this._ladderStep = 0;
      this._goodStreak = 0;
      this._badStreak = 0;
      this._onOffline = () => { if (this.pc && !this._stopping) this._handleDrop(this._generation, 'Network offline'); };
      this._onOnline = () => {
        if (this._stopping || !this._reconnectTimer) return;
        clearTimeout(this._reconnectTimer);
        this._reconnectTimer = null;
        const myGen = this._generation;
        this._connect(myGen).catch((err) => { if (this._generation === myGen) this._handleDrop(myGen, err.message); });
      };
    }

    /**
     * @param {MediaStream} mediaStream - composited canvas video track + mic audio track
     * @param {string} endpointUrl - the WHIP ingest URL (from whatever server you set up)
     * @param {string} bearerToken - optional; sent as "Authorization: Bearer <token>"
     * @param {number} videoBitrateBps - encoder target, applied via RTCRtpSender parameters
     */
    async start(mediaStream, endpointUrl, bearerToken, videoBitrateBps) {
      if (!endpointUrl) throw new Error('No WHIP endpoint URL set. Add one in the Live panel.');
      if (!window.RTCPeerConnection) throw new Error('WebRTC is not available in this browser.');

      this._stopping = false;
      this._reconnectAttempt = 0;
      this._dropHistory = [];
      this._lastParams = { mediaStream, endpointUrl, bearerToken, videoBitrateBps };
      window.addEventListener('offline', this._onOffline);
      window.addEventListener('online', this._onOnline);
      const myGen = ++this._generation;
      await this._connect(myGen);
    }

    async _connect(myGen) {
      const { mediaStream, endpointUrl, bearerToken, videoBitrateBps } = this._lastParams;
      this._pendingCandidates = [];
      this.resourceUrl = null;
      this._notify('connecting', this._reconnectAttempt ? `Reconnecting (attempt ${this._reconnectAttempt})...` : 'Opening connection...');

      const pc = new RTCPeerConnection({ iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] });
      this.pc = pc;

      this._videoTrack = mediaStream.getVideoTracks()[0] || null;
      this._audioTrack = mediaStream.getAudioTracks()[0] || null;
      if (!this._videoTrack) throw new Error('No video track to publish — is the camera/composite running?');

      const videoSender = pc.addTransceiver(this._videoTrack, { direction: 'sendonly' }).sender;
      if (this._audioTrack) pc.addTransceiver(this._audioTrack, { direction: 'sendonly' });
      this._videoSender = videoSender;
      this._baseBitrateBps = videoBitrateBps || null;
      // A fresh session always starts at full quality — see v0.8 note above.
      this._ladderStep = 0;
      this._goodStreak = 0;
      this._badStreak = 0;

      if (videoBitrateBps) {
        try {
          const params = videoSender.getParameters();
          if (!params.encodings) params.encodings = [{}];
          params.encodings[0].maxBitrate = videoBitrateBps;
          await videoSender.setParameters(params);
        } catch (e) {
          console.warn('Could not set video bitrate on WHIP sender:', e);
        }
      }

      pc.onicecandidate = (e) => {
        if (this._generation !== myGen) return; // stale connection, ignore
        if (!e.candidate) return; // end-of-candidates marker — no PATCH needed for the common case
        if (this.resourceUrl) this._patchCandidate(e.candidate.candidate);
        else this._pendingCandidates.push(e.candidate.candidate);
      };

      pc.onconnectionstatechange = () => {
        if (this._generation !== myGen) return; // a stale pc firing after we've already moved on
        const state = pc.connectionState;
        if (state === 'connected') {
          this._reconnectAttempt = 0;
          this._notify('live', 'Live');
          this._startStatsMonitor(myGen);
        } else if (state === 'disconnected' || state === 'failed' || state === 'closed') {
          if (this._stopping) return; // expected — stop() already notified 'stopped'
          this._handleDrop(myGen, `Connection ${state}`);
        }
      };

      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      await this._headStart(pc); // brief pause so the offer carries at least the fast host candidates

      let res;
      try {
        res = await fetch(endpointUrl, {
          method: 'POST',
          headers: Object.assign(
            { 'Content-Type': 'application/sdp' },
            bearerToken ? { Authorization: `Bearer ${bearerToken}` } : {}
          ),
          body: pc.localDescription.sdp,
        });
      } catch (netErr) {
        this._teardownPeer();
        throw new Error(`Could not reach the WHIP endpoint (network error). Check the URL. (${netErr.message})`);
      }

      if (!(res.status === 200 || res.status === 201)) {
        const body = await res.text().catch(() => '');
        this._teardownPeer();
        throw new Error(`WHIP endpoint rejected the offer (HTTP ${res.status}). ${body.slice(0, 200)}`);
      }

      const location = res.headers.get('Location');
      this.resourceUrl = location ? new URL(location, endpointUrl).toString() : null;
      // Flush anything gathered while the POST was in flight.
      if (this.resourceUrl && this._pendingCandidates.length) {
        this._pendingCandidates.forEach((c) => this._patchCandidate(c));
        this._pendingCandidates = [];
      }

      const answerSdp = await res.text();
      await pc.setRemoteDescription({ type: 'answer', sdp: answerSdp });
      // onconnectionstatechange above flips status to 'live' once ICE actually connects.
    }

    async _patchCandidate(candidateStr) {
      if (!this.resourceUrl || !candidateStr) return;
      try {
        await fetch(this.resourceUrl, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/trickle-ice-sdpfrag' },
          body: candidateStr,
        });
      } catch (e) {
        // Non-fatal by design (see honest limit #2 above) — the initial offer/answer
        // already carries the head-start candidates, so one failed trickle PATCH
        // doesn't need to kill the connection.
        console.warn('WHIP trickle-ICE PATCH failed (non-fatal):', e);
      }
    }

    _headStart(pc) {
      // Real host candidates are gathered near-instantly (sub-100ms on almost every
      // machine); a short, fixed pause lets the FIRST offer carry them instead of
      // going out empty, without paying the old full-gathering wait (which could run
      // into seconds on networks where STUN reflexive candidates are slow/blocked).
      if (pc.iceGatheringState === 'complete') return Promise.resolve();
      return new Promise((resolve) => setTimeout(resolve, 300));
    }

    _startStatsMonitor(myGen) {
      this._stopStatsMonitor();
      this._lastBytesSent = null;
      this._staleBytesPolls = 0;
      this._statsInterval = setInterval(() => this._pollStats(myGen), STATS_POLL_MS);
    }

    _stopStatsMonitor() {
      if (this._statsInterval) { clearInterval(this._statsInterval); this._statsInterval = null; }
    }

    async _pollStats(myGen) {
      if (this._generation !== myGen || !this.pc) return;
      let reports;
      try { reports = await this.pc.getStats(); } catch (e) { return; } // getStats itself failing isn't a stream problem worth reporting
      let bytesSent = null, fractionLost = null, outFps = null, rtt = null, tsNow = null;
      reports.forEach((r) => {
        if (r.type === 'outbound-rtp' && r.kind === 'video') { bytesSent = r.bytesSent; tsNow = r.timestamp; if (typeof r.framesPerSecond === 'number') outFps = r.framesPerSecond; }
        if (r.type === 'remote-inbound-rtp' && r.kind === 'video' && typeof r.roundTripTime === 'number') rtt = r.roundTripTime * 1000;
        // fractionLost (0..1) comes from the far end via RTCP receiver reports —
        // it's what the viewer's actual packet loss looks like, not a local guess.
        if (r.type === 'remote-inbound-rtp' && r.kind === 'video' && typeof r.fractionLost === 'number') fractionLost = r.fractionLost;
      });
      if (this._generation !== myGen) return; // reconnect/stop happened mid-await

      if (this.onStats && bytesSent !== null) {
        // Rate from two polls; reported for the health readout only (never affects status or the ladder).
        let kbps = null;
        if (this._lastBytesSent !== null && this._lastStatTs && tsNow > this._lastStatTs && bytesSent >= this._lastBytesSent) kbps = ((bytesSent - this._lastBytesSent) * 8) / (tsNow - this._lastStatTs);
        if (kbps !== null) { try { this.onStats({ kbps, fps: outFps, lossPct: fractionLost !== null ? fractionLost * 100 : null, rttMs: rtt, targetKbps: this._baseBitrateBps ? this._baseBitrateBps / 1000 : null }); } catch (e) {} }
      }
      if (tsNow) this._lastStatTs = tsNow;

      if (bytesSent !== null) {
        if (this._lastBytesSent !== null && bytesSent <= this._lastBytesSent) this._staleBytesPolls++;
        else this._staleBytesPolls = 0;
        this._lastBytesSent = bytesSent;
      }
      if (this._staleBytesPolls >= 2) {
        this._noteDegraded(myGen, `No video data has left your device in ~${Math.round((STATS_POLL_MS * this._staleBytesPolls) / 1000)}s — the send pipeline may be stalled.`);
      } else if (fractionLost !== null && fractionLost > 0.05) {
        this._noteDegraded(myGen, `Packet loss to the ingest server (~${Math.round(fractionLost * 100)}%).`);
      } else {
        this._noteGood(myGen);
      }
    }

    _noteDegraded(myGen, reasonDetail) {
      this._badStreak++;
      this._goodStreak = 0;
      if (this._badStreak >= STEP_DOWN_AFTER_POLLS && this._ladderStep < BITRATE_LADDER.length - 1) {
        this._ladderStep++;
        this._badStreak = 0;
        this._applyLadderStep(myGen, `Stepped down video quality (${reasonDetail}) — will restore automatically once the connection improves.`);
      } else {
        this._notifyQuality('degraded', reasonDetail);
      }
    }

    _noteGood(myGen) {
      this._badStreak = 0;
      if (this._ladderStep === 0) {
        this._goodStreak = 0;
        this._notifyQuality('good', null);
        return;
      }
      this._goodStreak++;
      if (this._goodStreak >= STEP_UP_AFTER_POLLS) {
        this._ladderStep--;
        this._goodStreak = 0;
        this._applyLadderStep(myGen, this._ladderStep === 0 ? 'Connection recovered — restoring full video quality.' : 'Connection improved — raising video quality a step.');
      } else {
        this._notifyQuality('degraded', 'Connection recovering — holding reduced video quality a little longer before raising it.');
      }
    }

    async _applyLadderStep(myGen, detail) {
      if (!this._videoSender || !this._baseBitrateBps) { this._notifyQuality('degraded', detail); return; }
      const rung = BITRATE_LADDER[this._ladderStep];
      try {
        const params = this._videoSender.getParameters();
        if (!params.encodings) params.encodings = [{}];
        params.encodings[0].maxBitrate = Math.round(this._baseBitrateBps * rung.frac);
        params.encodings[0].scaleResolutionDownBy = rung.scale;
        await this._videoSender.setParameters(params);
      } catch (e) {
        console.warn('Could not apply adaptive bitrate step:', e);
      }
      if (this._generation !== myGen) return; // superseded mid-await
      this._notifyQuality('degraded', detail);
    }

    _handleDrop(myGen, detail) {
      this._stopStatsMonitor();
      const now = Date.now();
      this._dropHistory.push(now);
      this._dropHistory = this._dropHistory.filter((t) => now - t < FLAP_WINDOW_MS);
      if (this._dropHistory.length > FLAP_MAX_DROPS) {
        this._notify('error', `Connection dropped ${this._dropHistory.length} times in the last minute (${detail}) — your network looks unstable rather than this being a one-off blip. Check your connection, then press Go Live to retry manually.`);
        this._teardownPeer();
        return;
      }
      if (this._reconnectAttempt >= RECONNECT_DELAYS_MS.length) {
        this._notify('error', `Live connection lost and gave up reconnecting (${detail}). Press Go Live to retry manually.`);
        this._teardownPeer();
        return;
      }
      const delay = RECONNECT_DELAYS_MS[this._reconnectAttempt];
      this._reconnectAttempt++;
      this._notify('reconnecting', `Connection dropped (${detail}) — retrying in ${Math.round(delay / 1000)}s...`);
      this._teardownPeer();
      this._reconnectTimer = setTimeout(() => {
        this._reconnectTimer = null;
        if (this._generation !== myGen || this._stopping) return; // superseded by a manual stop/start meanwhile
        this._connect(myGen).catch((err) => {
          if (this._generation !== myGen) return;
          this._handleDrop(myGen, err.message);
        });
      }, delay);
    }

    async stop() {
      this._stopping = true;
      this._generation++; // invalidates any in-flight reconnect timers immediately
      this._stopStatsMonitor();
      if (this._reconnectTimer) { clearTimeout(this._reconnectTimer); this._reconnectTimer = null; }
      window.removeEventListener('offline', this._onOffline);
      window.removeEventListener('online', this._onOnline);
      if (this.resourceUrl) {
        try {
          await fetch(this.resourceUrl, { method: 'DELETE' });
        } catch (e) {
          console.warn('WHIP session DELETE failed (server will time out the session anyway):', e);
        }
      }
      this._teardownPeer();
      this._notify('stopped', 'Stopped');
    }

    _teardownPeer() {
      if (this.pc) {
        this.pc.onconnectionstatechange = null;
        this.pc.onicecandidate = null;
        this.pc.close();
      }
      this.pc = null;
      this.resourceUrl = null;
      this._videoSender = null;
    }

    _notify(status, detail) {
      if (this.onStatusChange) this.onStatusChange(status, detail);
    }

    _notifyQuality(level, detail) {
      if (this.onQualityChange) this.onQualityChange(level, detail);
    }
  }

  window.VS = window.VS || {};
  window.VS.WHIPStreamProvider = WHIPStreamProvider;
})();
