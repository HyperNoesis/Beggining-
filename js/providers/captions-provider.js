/**
 * Captions provider — live transcription using the browser's built-in
 * SpeechRecognition (Web Speech API). Free, no API key, no server.
 * Honest limits, stated up front instead of discovered the hard way:
 *  - Chrome/Edge only (desktop + Android); no Firefox/Safari support as of
 *    this build. Feature-detected; UI disables itself honestly if absent.
 *  - Runs during LIVE recording only (it listens to the mic in real time).
 *    Transcribing an already-saved file isn't what this API does — that
 *    needs a real speech-to-text model/API, which is a paid-provider item.
 *  - Cues are relative timestamps (seconds from recording start), stored
 *    as data alongside the recording — nothing is burned into the video.
 */
(function () {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;

  class CaptionsProvider {
    static get supported() { return !!SR; }

    constructor() {
      this.cues = [];       // [{ start, end, text }]
      this._rec = null;
      this._startTime = 0;
      this._interimText = '';
      this.onUpdate = null; // (interimText, cues) => void, for live overlay
    }

    start(getElapsedSeconds) {
      if (!SR) throw new Error('SpeechRecognition is not supported in this browser (Chrome/Edge only).');
      this._rec = new SR();
      this._rec.continuous = true;
      this._rec.interimResults = true;
      this._rec.lang = (navigator.language || 'en-US');

      this._rec.onresult = (e) => {
        let interim = '';
        for (let i = e.resultIndex; i < e.results.length; i++) {
          const res = e.results[i];
          const text = res[0].transcript.trim();
          if (res.isFinal) {
            const end = getElapsedSeconds();
            const start = Math.max(0, end - Math.max(1, text.split(' ').length * 0.35));
            if (text) this.cues.push({ start, end, text });
          } else {
            interim += text;
          }
        }
        this._interimText = interim;
        if (this.onUpdate) this.onUpdate(this._interimText, this.cues);
      };

      this._rec.onerror = (e) => {
        // no-speech / audio-capture are routine (silence, device hiccup) — auto-restart, don't surface as fatal.
        if (['no-speech', 'audio-capture', 'network'].includes(e.error) && this._running) {
          try { this._rec.start(); } catch (_) { /* already starting */ }
        }
      };
      this._rec.onend = () => { if (this._running) { try { this._rec.start(); } catch (_) {} } };

      this._running = true;
      this._rec.start();
    }

    stop() {
      this._running = false;
      if (this._rec) { try { this._rec.stop(); } catch (_) {} }
      return this.cues.slice();
    }

    reset() { this.cues = []; this._interimText = ''; }

    /** WebVTT export. */
    static toVTT(cues) {
      const fmt = (s) => {
        const h = String(Math.floor(s / 3600)).padStart(2, '0');
        const m = String(Math.floor((s % 3600) / 60)).padStart(2, '0');
        const sec = (s % 60).toFixed(3).padStart(6, '0');
        return `${h}:${m}:${sec}`;
      };
      let out = 'WEBVTT\n\n';
      cues.forEach((c, i) => { out += `${i + 1}\n${fmt(c.start)} --> ${fmt(c.end)}\n${c.text}\n\n`; });
      return out;
    }

    /** SRT export. */
    static toSRT(cues) {
      const fmt = (s) => {
        const h = String(Math.floor(s / 3600)).padStart(2, '0');
        const m = String(Math.floor((s % 3600) / 60)).padStart(2, '0');
        const sec = Math.floor(s % 60);
        const ms = Math.round((s % 1) * 1000);
        return `${h}:${m}:${String(sec).padStart(2, '0')},${String(ms).padStart(3, '0')}`;
      };
      let out = '';
      cues.forEach((c, i) => { out += `${i + 1}\n${fmt(c.start)} --> ${fmt(c.end)}\n${c.text}\n\n`; });
      return out;
    }
  }

  window.VS = window.VS || {};
  window.VS.CaptionsProvider = CaptionsProvider;
})();
