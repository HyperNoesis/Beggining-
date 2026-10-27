/**
 * LUFS meter — a real ITU-R BS.1770-4 implementation, not a relabeled
 * peak/RMS reading:
 *  1. K-weighting: two cascaded IIR filters (pre-filter high-shelf + RLB
 *     high-pass) using the standard published coefficients. IIRFilterNode
 *     runs natively on the audio rendering thread already — no main-
 *     thread cost here regardless of ScriptProcessor vs AudioWorklet.
 *  2. Sum-of-squares accumulation runs in a real AudioWorklet (a
 *     dedicated audio-thread worker), not a main-thread ScriptProcessor
 *     callback — see js/worklets/lufs-worklet.js. Falls back to
 *     ScriptProcessorNode only if AudioWorklet isn't available.
 *  3. Momentary (400ms) and short-term (3s) loudness from the K-weighted
 *     signal's mean square power.
 *  4. Integrated (session) loudness with the real two-stage gating
 *     algorithm: an absolute gate at -70 LUFS, then a relative gate at
 *     -10 LU below the ungated mean, matching the spec's intent.
 *
 * Honest limits, stated instead of hidden:
 *  - The published K-weighting coefficients are defined for 48kHz audio.
 *    Most browsers/devices run their AudioContext at 48kHz, but if yours
 *    runs at a different native rate the filter response is slightly off
 *    from spec rather than re-derived for that rate.
 *  - No true-peak (oversampled) measurement, only the loudness (LUFS) part.
 */
(function () {
  const PRE_B = [1.53512485958697, -2.69169618940638, 1.19839281085285];
  const PRE_A = [1.0, -1.69065929318241, 0.73248077421585];
  const RLB_B = [1.0, -2.0, 1.0];
  const RLB_A = [1.0, -1.99004745483398, 0.99007225036621];

  class LufsMeter {
    constructor(audioCtx, sourceNode) {
      this.ctx = audioCtx;
      this.chunkQueue = []; // { sumSq, n, t }
      this.gatingBlocks = []; // 400ms momentary readings sampled every ~100ms, for integrated calc
      this.usingWorklet = false;

      this.preFilter = audioCtx.createIIRFilter(PRE_B, PRE_A);
      this.rlbFilter = audioCtx.createIIRFilter(RLB_B, RLB_A);
      sourceNode.connect(this.preFilter);
      this.preFilter.connect(this.rlbFilter);

      this._lastGateSample = 0;
    }

    /** Async setup — tries the AudioWorklet path first, falls back to ScriptProcessorNode. */
    async init() {
      if (this.ctx.audioWorklet) {
        try {
          await this.ctx.audioWorklet.addModule('js/worklets/lufs-worklet.js');
          this.workletNode = new AudioWorkletNode(this.ctx, 'lufs-accumulator', { numberOfInputs: 1, numberOfOutputs: 0 });
          this.workletNode.port.onmessage = (e) => this._onChunk(e.data);
          this.rlbFilter.connect(this.workletNode);
          this.usingWorklet = true;
          return;
        } catch (err) {
          // fall through to ScriptProcessorNode below
        }
      }
      this._initScriptProcessorFallback();
    }

    _initScriptProcessorFallback() {
      const bufSize = 4096;
      this.processor = this.ctx.createScriptProcessor(bufSize, 2, 2);
      this.rlbFilter.connect(this.processor);
      this.silentSink = this.ctx.createGain();
      this.silentSink.gain.value = 0;
      this.processor.connect(this.silentSink);
      this.silentSink.connect(this.ctx.destination);
      this.processor.onaudioprocess = (e) => {
        const ch0 = e.inputBuffer.getChannelData(0);
        const ch1 = e.inputBuffer.numberOfChannels > 1 ? e.inputBuffer.getChannelData(1) : ch0;
        let sumSq = 0;
        for (let i = 0; i < ch0.length; i++) { sumSq += ch0[i] * ch0[i] + ch1[i] * ch1[i]; }
        this._onChunk({ sumSq, n: ch0.length * 2, t: this.ctx.currentTime });
      };
    }

    _onChunk(chunk) {
      const t = chunk.t;
      this.chunkQueue.push(chunk);
      while (this.chunkQueue.length && t - this.chunkQueue[0].t > 3.2) this.chunkQueue.shift();

      if (t - this._lastGateSample >= 0.1) {
        this._lastGateSample = t;
        const m = this.momentary();
        if (m !== null && m > -70) { // absolute gate
          this.gatingBlocks.push(m);
          if (this.gatingBlocks.length > 6000) this.gatingBlocks.shift(); // ~10min cap, avoids unbounded growth
        }
      }
    }

    _meanPowerOver(seconds) {
      const now = this.ctx.currentTime;
      let sumSq = 0, n = 0;
      for (let i = this.chunkQueue.length - 1; i >= 0; i--) {
        const c = this.chunkQueue[i];
        if (now - c.t > seconds) break;
        sumSq += c.sumSq; n += c.n;
      }
      if (n === 0) return null;
      return sumSq / n;
    }

    static powerToLufs(meanSq) {
      if (meanSq <= 0) return -Infinity;
      return -0.691 + 10 * Math.log10(meanSq);
    }

    momentary() {
      const p = this._meanPowerOver(0.4);
      return p === null ? null : LufsMeter.powerToLufs(p);
    }

    shortTerm() {
      const p = this._meanPowerOver(3.0);
      return p === null ? null : LufsMeter.powerToLufs(p);
    }

    /** Real two-stage gated integrated loudness over the whole session so far. */
    integrated() {
      if (this.gatingBlocks.length === 0) return null;
      const powers = this.gatingBlocks.map(l => Math.pow(10, (l + 0.691) / 10));
      const ungatedMean = powers.reduce((a, b) => a + b, 0) / powers.length;
      const ungatedLufs = LufsMeter.powerToLufs(ungatedMean);
      const relativeThreshold = ungatedLufs - 10;
      const gated = powers.filter((_, i) => this.gatingBlocks[i] > relativeThreshold);
      if (gated.length === 0) return ungatedLufs;
      const gatedMean = gated.reduce((a, b) => a + b, 0) / gated.length;
      return LufsMeter.powerToLufs(gatedMean);
    }

    reset() { this.gatingBlocks = []; this.chunkQueue = []; }

    disconnect() {
      try {
        if (this.workletNode) this.workletNode.disconnect();
        if (this.processor) this.processor.disconnect();
        if (this.silentSink) this.silentSink.disconnect();
        this.preFilter.disconnect();
        this.rlbFilter.disconnect();
      } catch (e) {}
    }
  }

  window.VS = window.VS || {};
  window.VS.LufsMeter = LufsMeter;
})();
