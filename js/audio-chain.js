/**
 * Studio audio chain (brief F3, partial). Mic -> high-pass -> EQ preset -> compressor -> limiter -> output track.
 * Recording and Go Live use the processed track. Everything runs in the browser (Web Audio): zero cost, nothing leaves the device.
 * Noise suppression and echo cancel are the BROWSER's built-in ones (getUserMedia constraints), not RNNoise. RNNoise is not shipped.
 * Safety: if the AudioContext is not running (browsers block it until a tap) or building the graph fails, the raw mic track is used.
 */
(function () {
  // Pure preset table (unit-tested in tools/e2e/unit_audio_chain.js). EQ bands: [type, Hz, gainDb, Q]
  const PRESETS = {
    off:     { label: 'Off (raw mic)', processed: false },
    voice:   { label: 'Voice (clear speech)', processed: true, hpf: 90,
               eq: [['peaking', 250, -2, 1.0], ['peaking', 3200, 3, 1.0], ['peaking', 7000, -1.5, 2.0]],
               comp: { threshold: -24, knee: 24, ratio: 3, attack: 0.006, release: 0.2 }, makeup: 4 },
    podcast: { label: 'Podcast (warm)', processed: true, hpf: 80,
               eq: [['lowshelf', 140, 2.5, 0.7], ['peaking', 4000, 2, 1.0], ['peaking', 7500, -2.5, 2.0]],
               comp: { threshold: -26, knee: 20, ratio: 3.5, attack: 0.008, release: 0.25 }, makeup: 5 },
  };
  const LIMITER = { threshold: -6, knee: 0, ratio: 20, attack: 0.002, release: 0.08 };
  const TARGET_LUFS = { voice: -16, podcast: -16, off: null };
  // Describe the loudness reading in plain language relative to a target.
  function loudnessNote(lufs, target) {
    if (lufs == null || !isFinite(lufs)) return 'Speak to see your level.';
    if (target == null) return 'Raw mic: no target.';
    const d = lufs - target;
    if (d < -6) return 'Too quiet. Move closer to the mic.';
    if (d > 4) return 'Too loud. Move back a little.';
    return 'Good level.';
  }
  function dbFromLinear(x) { return x > 0 ? 20 * Math.log10(x) : -Infinity; }

  /** Auto-duck (pure). Music drops by `amountDb` while your voice is above `thresholdDb` and for `holdMs` after it, then comes back.
   *  state = { lastVoiceAt } (mutated). Returns { active, gain } where gain is the linear music multiplier to aim for (1 = no duck). */
  function duckStep(state, peakDb, nowMs, cfg) {
    cfg = Object.assign({ thresholdDb: -42, holdMs: 500, amountDb: 12 }, cfg || {});
    if (isFinite(peakDb) && peakDb > cfg.thresholdDb) state.lastVoiceAt = nowMs;
    const active = state.lastVoiceAt != null && nowMs - state.lastVoiceAt <= cfg.holdMs;
    return { active, gain: active ? Math.pow(10, -Math.max(0, Math.min(40, cfg.amountDb)) / 20) : 1 };
  }
  window.VS = window.VS || {};
  window.VS.AudioPresets = { PRESETS, TARGET_LUFS, loudnessNote, dbFromLinear, duckStep };

  class AudioChain {
    constructor(stream) {
      this.raw = stream.getAudioTracks()[0] || null;
      this.ctx = null; this.preset = 'voice'; this.ok = false; this.out = this.raw;
      this.nodes = {}; this.lufs = null; this.peakDb = -Infinity;
      if (!this.raw) return;
      try {
        const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return;
        this.ctx = new AC({ latencyHint: 'interactive' });
        const src = this.ctx.createMediaStreamSource(new MediaStream([this.raw]));
        const n = this.nodes;
        n.src = src;
        n.hpf = this.ctx.createBiquadFilter(); n.hpf.type = 'highpass';
        n.eq = [0, 1, 2].map(() => this.ctx.createBiquadFilter());
        n.comp = this.ctx.createDynamicsCompressor();
        n.makeup = this.ctx.createGain();
        n.limit = this.ctx.createDynamicsCompressor();
        n.dest = this.ctx.createMediaStreamDestination();
        n.analyser = this.ctx.createAnalyser(); n.analyser.fftSize = 1024;
        src.connect(n.hpf); n.hpf.connect(n.eq[0]); n.eq[0].connect(n.eq[1]); n.eq[1].connect(n.eq[2]); n.eq[2].connect(n.comp);
        n.comp.connect(n.makeup); n.makeup.connect(n.limit); n.master = this.ctx.createGain(); n.musicGain = this.ctx.createGain(); n.musicDuck = this.ctx.createGain(); n.sbGain = this.ctx.createGain(); n.monitor = this.ctx.createGain(); n.monitor.gain.value = 0;
        n.limit.connect(n.master); n.musicGain.connect(n.musicDuck); n.musicDuck.connect(n.master); n.sbGain.connect(n.master); n.master.connect(n.dest); n.master.connect(n.monitor); n.monitor.connect(this.ctx.destination);
        n.musicGain.gain.value = 0.35; this.music = { src: null, buf: null, playing: false, duck: true, duckDb: 12, name: '' }; this._duck = { lastVoiceAt: null }; this.duckActive = false;
        n.limit.connect(n.analyser);
        this._configure(this.preset);
        this.processedTrack = n.dest.stream.getAudioTracks()[0] || null;
        this.ok = !!this.processedTrack;
        this._timer = setInterval(() => this._tick(), 100);
        if (window.VS.LufsMeter) {
          try { this.meter = new window.VS.LufsMeter(this.ctx, n.limit); this.meter.init().catch(() => {}); } catch (e) { this.meter = null; }
        }
      } catch (e) { this.ok = false; this.error = String(e && e.message || e); }
    }
    _configure(name) {
      const p = PRESETS[name] || PRESETS.voice; const n = this.nodes; if (!n.hpf) return;
      this.preset = PRESETS[name] ? name : 'voice';
      n.hpf.frequency.value = p.processed ? p.hpf : 10;
      n.eq.forEach((f, i) => { const b = p.processed && p.eq[i]; f.type = b ? b[0] : 'peaking'; f.frequency.value = b ? b[1] : 1000; f.gain.value = b ? b[2] : 0; f.Q.value = b ? b[3] : 1; });
      const c = p.processed ? p.comp : { threshold: 0, knee: 0, ratio: 1, attack: 0.003, release: 0.25 };
      n.comp.threshold.value = c.threshold; n.comp.knee.value = c.knee; n.comp.ratio.value = c.ratio; n.comp.attack.value = c.attack; n.comp.release.value = c.release;
      n.makeup.gain.value = p.processed ? Math.pow(10, p.makeup / 20) : 1;
      const l = p.processed ? LIMITER : { threshold: 0, knee: 0, ratio: 1, attack: 0.003, release: 0.25 };
      n.limit.threshold.value = l.threshold; n.limit.knee.value = l.knee; n.limit.ratio.value = l.ratio; n.limit.attack.value = l.attack; n.limit.release.value = l.release;
    }
    setPreset(name) { this._configure(name); }
    _tick() {
      const a = this.nodes.analyser; if (!a) return;
      const buf = new Float32Array(a.fftSize); a.getFloatTimeDomainData(buf);
      let peak = 0; for (let i = 0; i < buf.length; i++) { const v = Math.abs(buf[i]); if (v > peak) peak = v; }
      this.peakDb = dbFromLinear(peak);
      this.lufs = this.meter ? this.meter.shortTerm() : null;
      if (this.music && this.nodes.musicDuck) {                         // auto-duck: voice peak decides; smooth so it never pumps
        const d = duckStep(this._duck, this.peakDb, performance.now(), { amountDb: this.music.duckDb }); this.duckActive = this.music.duck && d.active;
        const g = this.music.duck ? d.gain : 1; this.nodes.musicDuck.gain.setTargetAtTime(g, this.ctx.currentTime, d.active ? 0.08 : 0.35);
      }
    }
    /** Music bed: the user's own audio file (decoded in memory, loops). Never bundled: licences are the user's to check. */
    async loadMusic(arrayBuffer, name) {
      if (!this.ok) return false; const b = await this.ctx.decodeAudioData(arrayBuffer); this.stopMusic(); this.music.buf = b; this.music.name = name || ''; return true;
    }
    playMusic() {
      if (!this.ok || !this.music.buf) return false; this.stopMusic(); const s = this.ctx.createBufferSource(); s.buffer = this.music.buf; s.loop = true; s.connect(this.nodes.musicGain); s.start();
      this.music.src = s; this.music.playing = true; return true;
    }
    stopMusic() { try { if (this.music && this.music.src) { this.music.src.stop(); this.music.src.disconnect(); } } catch (e) {} if (this.music) { this.music.src = null; this.music.playing = false; } }
    setMusicVolume(v) { if (this.nodes.musicGain) this.nodes.musicGain.gain.setTargetAtTime(Math.max(0, Math.min(1, +v || 0)), this.ctx.currentTime, 0.05); }
    /** RNNoise (ML noise suppression, runs locally in an AudioWorklet). Returns a promise of true/false; on any failure the mic stays untouched. */
    async setDenoise(on) {
      if (!this.ok) return false; const n = this.nodes;
      try {
        if (!on) { if (n.rn) { try { n.src.disconnect(n.rn); } catch (e) {} try { n.rn.disconnect(); } catch (e) {} n.rn = null; try { n.src.connect(n.hpf); } catch (e) {} } return false; }
        if (n.rn) return true;
        if (!this.ctx.audioWorklet || typeof AudioWorkletNode === 'undefined') return false;
        if (!this._rnLoaded) { await this.ctx.audioWorklet.addModule('js/worklets/rnnoise-worklet.js'); this._rnLoaded = true; }
        const node = new AudioWorkletNode(this.ctx, 'rnnoise-processor', { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1] });
        const ready = await new Promise((res) => { const t = setTimeout(() => res(false), 4000); node.port.onmessage = (e) => { if (e.data && 'ready' in e.data) { clearTimeout(t); res(!!e.data.ready); } }; });
        if (!ready) { try { node.disconnect(); } catch (e) {} return false; }
        try { n.src.disconnect(n.hpf); } catch (e) {} n.src.connect(node); node.connect(n.hpf); n.rn = node; return true;
      } catch (e) { return false; }
    }
    setDuck(on, db) { if (!this.music) return; this.music.duck = !!on; if (db != null) this.music.duckDb = Math.max(0, Math.min(40, +db || 0)); }
    /** Hear music + sounds yourself. Off by default: speakers next to the mic cause echo, so use headphones. */
    setMonitor(on) { if (this.nodes.monitor) this.nodes.monitor.gain.value = on ? 1 : 0; }
    playBuffer(buf, gain) { if (!this.ok || !buf) return false; const s = this.ctx.createBufferSource(), g = this.ctx.createGain(); g.gain.value = gain == null ? 0.8 : gain; s.buffer = buf; s.connect(g); g.connect(this.nodes.sbGain); s.start(); s.onended = () => { try { g.disconnect(); } catch (e) {} }; return true; }
    /** Built-in sounds made from oscillators and noise at run time: no files, no licence. */
    synthSound(kind) {
      if (!this.ok) return null; const sr = this.ctx.sampleRate, dur = { ding: 1.2, whoosh: 0.9, sting: 1.0, buzzer: 0.7 }[kind]; if (!dur) return null;
      const b = this.ctx.createBuffer(1, Math.floor(sr * dur), sr), d = b.getChannelData(0);
      for (let i = 0; i < d.length; i++) {
        const t = i / sr, e = Math.exp(-t * 4);
        if (kind === 'ding') d[i] = (Math.sin(2 * Math.PI * 880 * t) + 0.4 * Math.sin(2 * Math.PI * 1760 * t)) * e * 0.5;
        else if (kind === 'whoosh') { const k = Math.sin(Math.PI * t / dur); d[i] = (Math.random() * 2 - 1) * k * k * 0.5; }
        else if (kind === 'sting') { const f = t < 0.25 ? 523 : t < 0.5 ? 659 : 784; d[i] = Math.sin(2 * Math.PI * f * t) * Math.exp(-(t % 0.25) * 6) * 0.5 + (t > 0.5 ? Math.sin(2 * Math.PI * 784 * t) * Math.exp(-(t - 0.5) * 3) * 0.3 : 0); }
        else d[i] = (Math.sin(2 * Math.PI * 150 * t) > 0 ? 1 : -1) * 0.35 * (t < dur - 0.05 ? 1 : 0);
      }
      return b;
    }
    /** The track recording and streaming should use. Falls back to the raw mic if the context is blocked or the graph failed. */
    outputTrack() {
      if (this.ok && this.ctx && this.ctx.state === 'running' && this.processedTrack && this.processedTrack.readyState === 'live') return this.processedTrack;
      return this.raw;
    }
    async resume() { try { if (this.ctx && this.ctx.state !== 'running') await this.ctx.resume(); } catch (e) {} return this.ctx ? this.ctx.state : 'none'; }
    dispose() { clearInterval(this._timer); try { if (this.ctx) this.ctx.close(); } catch (e) {} this.ctx = null; this.ok = false; }
  }
  window.VS.AudioChain = AudioChain;
})();
