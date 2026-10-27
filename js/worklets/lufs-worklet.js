/**
 * lufs-worklet.js — runs on the browser's dedicated audio rendering
 * thread (AudioWorkletGlobalScope), a real worker context separate from
 * the main UI thread. This is the actual "worker offloading" piece of
 * LUFS metering: the per-sample sum-of-squares accumulation that used to
 * run in a main-thread ScriptProcessorNode callback now runs here
 * instead, so it can never contend with UI rendering or Studio's
 * per-frame compositing.
 *
 * Batches ~4096 samples' worth of accumulation before posting a message
 * back to the main thread, to keep postMessage overhead low.
 */
class LufsAccumulator extends AudioWorkletProcessor {
  constructor() {
    super();
    this.sumSq = 0;
    this.n = 0;
    this.batchTarget = 4096;
  }

  process(inputs) {
    const input = inputs[0];
    if (!input || input.length === 0) return true;
    const ch0 = input[0];
    const ch1 = input.length > 1 ? input[1] : ch0;
    if (!ch0) return true;

    for (let i = 0; i < ch0.length; i++) {
      this.sumSq += ch0[i] * ch0[i] + (ch1 ? ch1[i] * ch1[i] : ch0[i] * ch0[i]);
    }
    this.n += ch0.length * 2;

    if (this.n >= this.batchTarget) {
      this.port.postMessage({ sumSq: this.sumSq, n: this.n, t: currentTime });
      this.sumSq = 0;
      this.n = 0;
    }
    return true;
  }
}

registerProcessor('lufs-accumulator', LufsAccumulator);
