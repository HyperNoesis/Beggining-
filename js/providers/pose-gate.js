/* Genesis pose gate (v0.40).
 *
 * Decides from the person SILHOUETTE whether the presenter is in a pose the seated scene supports, and says why when not.
 * No model, no extra pass: it reads the 64x36 mask the render worker already reads (about every 5th frame), so the cost is a few
 * hundred integer operations. Everything is measured RELATIVE to the head width, so it does not depend on how far away the phone is.
 *
 * What it can see: shoulders much narrower than expected (turned sideways), the torso leaning off the head, elbows/arms/objects far wider
 * than the shoulders, a second person. What it cannot see (no silhouette can): standing vs sitting from a head-and-chest view, a
 * crooked camera, crossed legs. A landmark model (BlazePose/MoveNet) cannot tell sitting from standing either when the legs are out of
 * frame, which is why none was added (see docs/LEVEL3_SEATING.md, decision table).
 *
 * Thresholds come from typical body proportions and from synthetic silhouettes; they are NOT calibrated on real people yet.
 * The live numbers are exposed (PoseGate.describe) so a phone run can be used to tune them.
 */
(function () {
  'use strict';
  const MIN_W = 3;                       // rows narrower than this are mask speckle (see SceneEngine.headMetrics)
  const T = { turned: 1.8, lean: 0.85, wide: 1.4, multiArea: 0.12, multiMin: 12 };
  const BAD = { turned: 1, leaning: 1, wide: 1, multi: 1 };
  const REASON = {
    turned: 'Turn to face the camera',
    leaning: 'Sit upright - you are leaning',
    wide: 'Bring your arms in',
    multi: 'Only one person in view, please',
  };

  const width = (rowMin, rowMax, y) => (rowMax[y] >= rowMin[y] ? rowMax[y] - rowMin[y] + 1 : 0);

  /** Areas (in mask cells) of the connected blobs of an RGBA mask, largest first. 4-connected, alpha > thr. */
  function blobAreas(rgba, sw, sh, thr) {
    const t = thr === undefined ? 20 : thr, seen = new Uint8Array(sw * sh), stack = new Int32Array(sw * sh), out = [];
    for (let s = 0; s < sw * sh; s++) {
      if (seen[s] || rgba[s * 4 + 3] <= t) continue;
      let sp = 0, area = 0; stack[sp++] = s; seen[s] = 1;
      while (sp) {
        const i = stack[--sp]; area++;
        const x = i % sw, y = (i / sw) | 0;
        if (x > 0 && !seen[i - 1] && rgba[(i - 1) * 4 + 3] > t) { seen[i - 1] = 1; stack[sp++] = i - 1; }
        if (x < sw - 1 && !seen[i + 1] && rgba[(i + 1) * 4 + 3] > t) { seen[i + 1] = 1; stack[sp++] = i + 1; }
        if (y > 0 && !seen[i - sw] && rgba[(i - sw) * 4 + 3] > t) { seen[i - sw] = 1; stack[sp++] = i - sw; }
        if (y < sh - 1 && !seen[i + sw] && rgba[(i + sw) * 4 + 3] > t) { seen[i + sw] = 1; stack[sp++] = i + sw; }
      }
      out.push(area);
    }
    return out.sort((a, b) => b - a);
  }

  /**
   * Silhouette measurements. hm = SceneEngine.headMetrics(...) result {hw, hCx, top}. areas = blobAreas(...) (optional).
   * Returns null when there is no head, else { judge, hw, hCx, top, shW, shCx, ratio, lean, lowRatio, bodyHeads, blobs }.
   * judge=false means too little body is in view below the head to say anything (face-only framing).
   */
  function features(rowMin, rowMax, minY, maxY, hm, areas) {
    if (!hm || !(hm.hw >= MIN_W)) return null;
    const hw = hm.hw, hCx = hm.hCx, top = hm.top, hh = hw * 1.3;      // head height (crown to chin) is about 1.3 x its width
    const f = { judge: false, hw, hCx, top, shW: 0, shCx: hCx, ratio: 0, lean: 0, lowRatio: 1, bodyHeads: (maxY - top + 1) / hh, blobs: areas || [] };
    const a = Math.round(top + 1.45 * hh);                            // shoulders are fully out about 1.45-1.95 head heights below the crown
    if (a > maxY) return f;                                           // not enough body in view
    const b = Math.min(maxY, Math.round(top + 1.95 * hh));
    for (let y = a; y <= b; y++) { const w = width(rowMin, rowMax, y); if (w >= MIN_W && w > f.shW) { f.shW = w; f.shCx = (rowMin[y] + rowMax[y] + 1) / 2; } }
    if (!(f.shW > 0)) return f;
    let low = 0; for (let y = b + 1; y <= maxY; y++) { const w = width(rowMin, rowMax, y); if (w > low) low = w; }
    f.judge = true; f.ratio = f.shW / hw; f.lean = (f.shCx - hCx) / hw; f.lowRatio = Math.max(low, f.shW) / f.shW;
    return f;
  }

  /** -> { status: 'ok' | 'turned' | 'leaning' | 'wide' | 'multi' | 'unknown' | 'absent', reason } */
  function classify(f) {
    if (!f) return { status: 'absent', reason: '' };
    const bl = f.blobs || [];
    if (bl.length > 1 && bl[1] >= T.multiMin && bl[1] >= T.multiArea * bl[0]) return { status: 'multi', reason: REASON.multi };
    if (!f.judge) return { status: 'unknown', reason: '' };
    if (f.ratio < T.turned) return { status: 'turned', reason: REASON.turned };
    if (Math.abs(f.lean) > T.lean) return { status: 'leaning', reason: REASON.leaning };
    if (f.lowRatio > T.wide || f.ratio > 4.2) return { status: 'wide', reason: REASON.wide };
    return { status: 'ok', reason: '' };
  }

  /** One-line live numbers for Diagnostics / tuning. */
  function describe(f, c) {
    if (!f) return 'no head found';
    return (c ? c.status : '?') + ' | shoulders/head ' + (f.judge ? f.ratio.toFixed(2) : 'n/a') + ' (turned < ' + T.turned + ') | lean ' + (f.judge ? f.lean.toFixed(2) : 'n/a') + ' (limit ' + T.lean + ') | width below shoulders x' + (f.judge ? f.lowRatio.toFixed(2) : 'n/a') + ' (wide > ' + T.wide + ') | blobs ' + (f.blobs || []).length;
  }

  /**
   * Time-based debounce: a bad pose is only reported after it has lasted `needBadMs` (one odd frame, a cough, a gesture must not flash a
   * warning), and it is only cleared after `needGoodMs` of a good pose. Samples arrive about 1-3 times per second.
   */
  class Debounce {
    constructor(needBadMs, needGoodMs) { this.needBadMs = needBadMs === undefined ? 900 : needBadMs; this.needGoodMs = needGoodMs === undefined ? 600 : needGoodMs; this.reset(); }
    reset() { this.shown = 'ok'; this.cand = null; this.candSince = 0; this.goodSince = 0; }
    push(status, now) {
      if (BAD[status]) {
        this.goodSince = 0;
        if (status !== this.cand) { this.cand = status; this.candSince = now; }
        if (now - this.candSince >= this.needBadMs) this.shown = status;
      } else {
        this.cand = null;
        if (status === 'unknown') return this.shown;                  // can't judge: neither confirms nor clears
        if (!this.goodSince) this.goodSince = now;
        if (now - this.goodSince >= this.needGoodMs) this.shown = 'ok';
      }
      return this.shown;
    }
  }

  const PoseGate = { features, classify, describe, blobAreas, Debounce, BAD, REASON, THRESHOLDS: T, isBad: (s) => !!BAD[s] };
  const root = typeof globalThis !== 'undefined' ? globalThis : self;
  root.VS = root.VS || {};
  root.VS.PoseGate = PoseGate;
})();
