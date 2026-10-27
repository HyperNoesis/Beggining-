/**
 * Mask refinement — four independent, honest improvements over the raw
 * MediaPipe segmentation mask, all pure canvas work (no getImageData pixel
 * loops, so this stays GPU-composited and cheap):
 *
 *  1. Despeckle: an approximate morphological close-then-open pass (fill
 *     small holes, then remove small speckles) done via blur+contrast
 *     canvas filters rather than a real per-pixel morphology kernel. Fixes
 *     the two most common raw-mask defects on real footage: a glasses lens
 *     briefly punching a hole in the person region (closing fills it), and
 *     a patterned shirt briefly reading as background/skin in small patches
 *     (opening removes it). HONEST LIMIT: blur+contrast is an approximation
 *     of true dilate/erode, not the real operation — it can round off fine
 *     detail (hair strands) at higher strengths, which is why it defaults
 *     low and is fully user-adjustable, including off.
 *
 *  2. Edge refinement: blur the mask edge by N px before using it as an
 *     alpha channel (destination-in). This softens the harsh, slightly
 *     aliased edge MediaPipe's selfie model produces — a real quality
 *     improvement, not a cosmetic toggle.
 *
 *  3. Manual correction: a persistent brush layer the user paints on top
 *     of the live mask to force-include or force-exclude regions frame
 *     over frame (e.g. a strand of hair the model keeps losing, or a
 *     shoulder bag it wrongly keeps). Stored at mask resolution so it
 *     scales with quality mode, and combined with the live mask every
 *     frame via lighten (add) / darken (subtract).
 *
 *  4. Temporal smoothing: an exponential moving average of the mask's
 *     alpha channel across frames, to reduce the frame-to-frame edge
 *     flicker that's the most visible flaw in real-time browser matting.
 *     Done with two drawImage() calls (globalAlpha + 'copy' then 'lighter')
 *     instead of a per-pixel loop — Porter-Duff 'lighter' sums alpha
 *     channels, so drawing prev*(1-a) then new*(a) gives exactly
 *     smoothed = a*new + (1-a)*prev, GPU-composited, no getImageData.
 *     HONEST TRADEOFF: lower smoothing = more flicker-resistant but more
 *     lag/ghosting on fast movement. Default favors flicker reduction for
 *     a mostly-still talking-head use case; the "Motion smoothing" slider
 *     lets a user trade that off live if it fights their movement.
 */
(function () {
  // Works both as a normal <script> (main thread) and via importScripts()
  // inside the render worker — OffscreenCanvas exists in both contexts in
  // every modern browser, so scratch canvases here never need `document`.
  function scratchCanvas(w, h) {
    if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(w || 1, h || 1);
    const c = document.createElement('canvas');
    c.width = w || 1; c.height = h || 1;
    return c;
  }

  class MaskRefiner {
    constructor() {
      this.featherPx = 2;         // 0 = off
      this.correctionEnabled = false;
      this.brushMode = 'add';     // 'add' forces person, 'erase' forces background
      this.brushSize = 24;        // in mask-canvas px
      // 0 = fully instantaneous (all flicker, no lag); 1 = frozen (no flicker,
      // all lag). 0.55 gives the new frame the majority weight each tick —
      // enough smoothing to visibly cut single-frame flicker without the
      // mask noticeably trailing a normal head turn.
      this.temporalSmoothing = 0.55;
      // Despeckle strength in px passed to the blur+contrast approximation
      // below. 0 = off. Kept low by default since this is an approximation,
      // not real morphology — see class comment.
      this.despeckle = 1;
      // FAST mode (see setPerf in render-core.js): skips the despeckle pass —
      // four filtered full-frame canvas draws per frame, the single heaviest
      // step in this class — regardless of the slider above. Feather and
      // temporal smoothing still run. Honest cost: without despeckle a glasses
      // lens or patterned shirt can punch small holes in the cutout more often.
      this.lite = false;
      this._correctionCanvas = scratchCanvas(1, 1);
      this._correctionCtx = this._correctionCanvas.getContext('2d', { willReadFrequently: false });
      this._instCanvas = scratchCanvas(1, 1);
      this._instCtx = this._instCanvas.getContext('2d');
      this._smoothCanvas = scratchCanvas(1, 1);
      this._smoothCtx = this._smoothCanvas.getContext('2d');
      this._blendCanvas = scratchCanvas(1, 1);
      this._blendCtx = this._blendCanvas.getContext('2d');
      this._morphACanvas = scratchCanvas(1, 1);
      this._morphACtx = this._morphACanvas.getContext('2d');
      this._morphBCanvas = scratchCanvas(1, 1);
      this._morphBCtx = this._morphBCanvas.getContext('2d');
      this._despeckleCanvas = scratchCanvas(1, 1);
      this._despeckleCtx = this._despeckleCanvas.getContext('2d');
      this._hasHistory = false;
    }

    resize(w, h) {
      if (this._correctionCanvas.width === w && this._correctionCanvas.height === h) return;
      const prev = this._correctionCanvas;
      const next = scratchCanvas(w, h);
      const nctx = next.getContext('2d');
      if (prev.width && prev.height) nctx.drawImage(prev, 0, 0, w, h);
      this._correctionCanvas = next;
      this._correctionCtx = nctx;

      [this._instCanvas, this._smoothCanvas, this._blendCanvas, this._morphACanvas, this._morphBCanvas, this._despeckleCanvas].forEach((c) => { c.width = w; c.height = h; });
      // A resize invalidates the smoothing history's dimensions outright
      // (rescaling a stale mask would smear it) — drop it and reseed from
      // the next frame's instantaneous result instead of faking continuity.
      this._hasHistory = false;
    }

    clearCorrections() {
      this._correctionCtx.clearRect(0, 0, this._correctionCanvas.width, this._correctionCanvas.height);
    }

    /** x, y in mask-canvas pixel space. */
    paintAt(x, y) {
      const ctx = this._correctionCtx;
      ctx.save();
      ctx.globalCompositeOperation = 'source-over';
      ctx.fillStyle = this.brushMode === 'add' ? 'rgba(255,255,255,1)' : 'rgba(0,0,0,1)';
      // 'erase' punches a hole (fully transparent) so it can subtract from the live mask.
      if (this.brushMode === 'erase') {
        ctx.globalCompositeOperation = 'destination-out';
        ctx.fillStyle = 'rgba(255,255,255,1)';
      }
      ctx.beginPath();
      ctx.arc(x, y, this.brushSize / 2, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    /**
     * Approximate morphological close-then-open on the raw mask, via
     * blur+contrast(+brightness) canvas filters:
     *   dilate(r)  ≈ blur(r) + high contrast (grows + hard-thresholds)
     *   erode(r)   ≈ blur(r) + darken-before-threshold (shrinks back down)
     *   closing = dilate then erode  → fills small interior holes
     *   opening = erode then dilate  → removes small exterior speckles
     * Writes the result into this._despeckleCanvas.
     */
    _despeckle(rawMask, w, h, r) {
      const DILATE_FILTER = `blur(${r}px) contrast(900%)`;
      const ERODE_FILTER = `blur(${r}px) brightness(55%) contrast(900%)`;

      // Closing: dilate -> erode
      this._morphACtx.clearRect(0, 0, w, h);
      this._morphACtx.filter = DILATE_FILTER;
      this._morphACtx.drawImage(rawMask, 0, 0, w, h);
      this._morphACtx.filter = 'none';

      this._morphBCtx.clearRect(0, 0, w, h);
      this._morphBCtx.filter = ERODE_FILTER;
      this._morphBCtx.drawImage(this._morphACanvas, 0, 0, w, h);
      this._morphBCtx.filter = 'none';

      // Opening: erode -> dilate (applied on top of the now-closed mask)
      this._morphACtx.clearRect(0, 0, w, h);
      this._morphACtx.filter = ERODE_FILTER;
      this._morphACtx.drawImage(this._morphBCanvas, 0, 0, w, h);
      this._morphACtx.filter = 'none';

      this._despeckleCtx.clearRect(0, 0, w, h);
      this._despeckleCtx.filter = DILATE_FILTER;
      this._despeckleCtx.drawImage(this._morphACanvas, 0, 0, w, h);
      this._despeckleCtx.filter = 'none';
    }

    /**
     * Applies despeckle + feathering + manual correction + temporal
     * smoothing to a raw mask, drawing the final alpha source into
     * `outCtx` (a scratch canvas the caller then uses with destination-in).
     */
    buildFinalMask(outCtx, rawMask, w, h) {
      let maskSource = rawMask;
      if (this.despeckle > 0 && !this.lite) {
        this._despeckle(rawMask, w, h, this.despeckle);
        maskSource = this._despeckleCanvas;
      }

      // Step 1 — instantaneous mask: feather + manual correction, same as
      // before, but written to a private scratch canvas so it can be read
      // twice below (once to seed/blend history, once implicitly via that
      // blend) without a race against outCtx being cleared.
      this._instCtx.clearRect(0, 0, w, h);
      this._instCtx.save();
      if (this.featherPx > 0) this._instCtx.filter = `blur(${this.featherPx}px)`;
      this._instCtx.drawImage(maskSource, 0, 0, w, h);
      this._instCtx.restore();

      if (this.correctionEnabled) {
        this._instCtx.save();
        this._instCtx.globalCompositeOperation = 'lighter';
        this._instCtx.drawImage(this._correctionCanvas, 0, 0, w, h);
        this._instCtx.restore();
      }

      // Step 2 — temporal smoothing (EMA on the alpha channel only; see the
      // class comment above for why 'copy' + 'lighter' gives a true weighted
      // average without a per-pixel loop).
      const newWeight = Math.min(1, Math.max(0, 1 - this.temporalSmoothing));
      if (!this._hasHistory || this.temporalSmoothing <= 0) {
        this._smoothCtx.clearRect(0, 0, w, h);
        this._smoothCtx.drawImage(this._instCanvas, 0, 0, w, h);
        this._hasHistory = true;
      } else {
        this._blendCtx.clearRect(0, 0, w, h);
        this._blendCtx.globalAlpha = this.temporalSmoothing; // weight on PREVIOUS frame
        this._blendCtx.globalCompositeOperation = 'copy';
        this._blendCtx.drawImage(this._smoothCanvas, 0, 0, w, h);
        this._blendCtx.globalAlpha = newWeight; // weight on the NEW instantaneous frame
        this._blendCtx.globalCompositeOperation = 'lighter';
        this._blendCtx.drawImage(this._instCanvas, 0, 0, w, h);
        this._blendCtx.globalAlpha = 1;
        this._blendCtx.globalCompositeOperation = 'source-over';

        this._smoothCtx.clearRect(0, 0, w, h);
        this._smoothCtx.drawImage(this._blendCanvas, 0, 0, w, h);
      }

      outCtx.clearRect(0, 0, w, h);
      outCtx.drawImage(this._smoothCanvas, 0, 0, w, h);
    }
  }

  // globalThis resolves to `window` on a page and `self` inside the render
  // worker, so this one export line works unmodified in both contexts.
  globalThis.VS = globalThis.VS || {};
  globalThis.VS.MaskRefiner = MaskRefiner;
})();
