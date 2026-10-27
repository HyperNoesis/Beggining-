/**
 * PerfProfile — the brains behind FAST mode for low-end devices.
 *
 * Two jobs, both deliberately kept as PURE functions (no DOM, no timers) so the
 * exact rules can be unit-tested in tests.html instead of trusted by eye:
 *
 *  1. classifyDevice(signals) — a STATIC guess, made before the camera starts,
 *     about whether this device is low-powered. Used only to PRE-SELECT FAST
 *     when the user never picked a default, and to show a note. It never
 *     forces anything.
 *
 *  2. decideDegradeAction(ctx) — the RUNTIME decision, made after the frame
 *     rate has actually been measured low for several seconds in a row. This is
 *     the one that matters: it reacts to what this device really does, not to
 *     what its spec sheet suggests.
 *
 * HONEST LIMITS (do not oversell these in UI copy):
 *  - navigator.deviceMemory exists only in Chromium browsers, is rounded to a
 *    power of two (a 6 GB phone reports 4), and is capped at 8. Safari and
 *    Firefox don't expose it at all. navigator.hardwareConcurrency counts
 *    logical threads, not speed, and Firefox's fingerprinting protection
 *    reports a fake 2. So this is a heuristic that can be wrong in both
 *    directions — which is exactly why it only recommends, and why the runtime
 *    rule below exists to catch what it misses.
 *  - Nothing here can make MediaPipe's model itself faster. FAST's real levers
 *    are: the lighter of MediaPipe's two bundled models, a smaller output
 *    canvas, skipping two of the heaviest per-frame canvas passes, and (only if
 *    the frame rate still can't hold) refreshing the mask on every other frame.
 */
(function (root) {
  const VS = root.VS = root.VS || {};

  // At or below these, a browser is running ML + canvas compositing + a video
  // encoder on hardware that will struggle. Deliberately inclusive of 4 GB:
  // a wrongly-recommended FAST is one tap to undo; a wrongly-withheld one is
  // a stuttering first impression.
  const LOW_MEMORY_GB = 4;
  const LOW_THREADS = 4;

  // How much of each frame's wall-clock time must be spent inside the
  // segmentation model before skipping mask updates is worth it. Below this,
  // the bottleneck is rendering or the camera and skipping inference would
  // only make the cutout laggier for no speed gain.
  const INFERENCE_BOUND_SHARE = 0.4;

  // Mask refreshes on 1 of every N frames at most. 2 is the ceiling on
  // purpose: at 3+ a moving head visibly outruns its own cutout.
  const MAX_STRIDE = 2;

  /**
   * @param {{deviceMemory?: number, hardwareConcurrency?: number}} sig
   * @returns {{tier: 'low'|'standard', reasons: string[]}}
   */
  function classifyDevice(sig) {
    sig = sig || {};
    const reasons = [];
    if (typeof sig.deviceMemory === 'number' && sig.deviceMemory > 0 && sig.deviceMemory <= LOW_MEMORY_GB) {
      reasons.push(`${sig.deviceMemory} GB memory reported`);
    }
    if (typeof sig.hardwareConcurrency === 'number' && sig.hardwareConcurrency > 0 && sig.hardwareConcurrency <= LOW_THREADS) {
      reasons.push(`${sig.hardwareConcurrency} CPU threads`);
    }
    return { tier: reasons.length ? 'low' : 'standard', reasons };
  }

  /** Reads the two signals a browser will give us. Every field may be absent. */
  function readSignals(nav) {
    nav = nav || (typeof navigator !== 'undefined' ? navigator : {});
    return { deviceMemory: nav.deviceMemory, hardwareConcurrency: nav.hardwareConcurrency };
  }

  function detect(nav) {
    const signals = readSignals(nav);
    const result = classifyDevice(signals);
    result.signals = signals;
    return result;
  }

  /**
   * Called when the measured frame rate has stayed under the floor for several
   * consecutive seconds. Returns WHAT TO DO, not how to show it.
   *
   * @param {{quality: string, stride: number, fps: number, segMs: number}} ctx
   *   quality — the mode currently running
   *   stride  — current mask-refresh stride (1 = every frame)
   *   fps     — measured composited frames per second
   *   segMs   — smoothed time one segmentation call takes (0 if unknown)
   * @returns {'suggest-fast'|'engage-stride'|'no-stride-help'|'ceiling'}
   */
  function decideDegradeAction(ctx) {
    if (ctx.quality !== 'fast') return 'suggest-fast';
    if (ctx.stride >= MAX_STRIDE) return 'ceiling';
    const frameMs = ctx.fps > 0 ? 1000 / ctx.fps : Infinity;
    const share = ctx.segMs > 0 && Number.isFinite(frameMs) ? ctx.segMs / frameMs : 0;
    return share >= INFERENCE_BOUND_SHARE ? 'engage-stride' : 'no-stride-help';
  }

  // Battery saver (brief D4). Pure so it can be unit-tested. Browsers expose no temperature, so the signals are
  // battery level/charging (Battery API, Chromium only) and the Compute Pressure state (Chromium only).
  const SAVER_BATTERY_LEVEL = 0.2;
  /**
   * @param {{saverOn:boolean, level?:number, charging?:boolean, pressure?:string}} c
   * @returns {'none'|'suggest-saver'|'auto-throttle'}
   *   auto-throttle: the CPU reports serious/critical pressure, so cut work now (and say so).
   */
  function decideSaver(c) {
    c = c || {};
    if (c.saverOn) return 'none';
    if (c.pressure === 'critical' || c.pressure === 'serious') return 'auto-throttle';
    if (typeof c.level === 'number' && c.level <= SAVER_BATTERY_LEVEL && c.charging === false) return 'suggest-saver';
    return 'none';
  }
  const SAVER_FRAME_MS = 50; // cap at about 20 fps while saving battery

  VS.PerfProfile = {
    classifyDevice, readSignals, detect, decideDegradeAction, decideSaver, SAVER_BATTERY_LEVEL, SAVER_FRAME_MS,
    LOW_MEMORY_GB, LOW_THREADS, INFERENCE_BOUND_SHARE, MAX_STRIDE,
  };
})(typeof self !== 'undefined' ? self : this);
