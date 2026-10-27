/**
 * Composition engine — virtual camera controls.
 * Everything here is pure client-side math over the existing camera
 * MediaStream; no new permissions, no server, no paid API.
 *
 * Responsibilities:
 *  - Aspect ratio presets (16:9, 9:16, 1:1, 4:5, 4:3) that decide the
 *    OUTPUT canvas dimensions (what gets recorded/exported).
 *  - Zoom + pan: a crop rectangle in SOURCE VIDEO space that every frame
 *    is sampled from before compositing, i.e. a real "virtual camera",
 *    not a CSS transform on the preview.
 *  - Safe-area / framing guides: drawn on a separate overlay canvas that
 *    sits on top of the recorded canvas in the DOM, so guides are never
 *    baked into the output.
 */
(function () {
  const ASPECTS = [
    { id: '16:9', label: 'Widescreen', sub: '16:9', ratio: 16 / 9 },
    { id: '9:16', label: 'Vertical', sub: '9:16', ratio: 9 / 16 },
    { id: '1:1', label: 'Square', sub: '1:1', ratio: 1 },
    { id: '4:5', label: 'Portrait', sub: '4:5', ratio: 4 / 5 },
    { id: '4:3', label: 'Classic', sub: '4:3', ratio: 4 / 3 },
  ];

  class CompositionEngine {
    constructor() {
      this.aspectId = '16:9';
      this.zoom = 1;       // 1 = no zoom, up to 3x
      this.panX = 0.5;     // 0..1, center of the crop window in source space
      this.panY = 0.5;
      this.showGuides = false;
    }

    get aspect() {
      return ASPECTS.find(a => a.id === this.aspectId) || ASPECTS[0];
    }

    static listAspects() { return ASPECTS; }

    setAspect(id) { if (ASPECTS.some(a => a.id === id)) this.aspectId = id; }
    setZoom(z) { this.zoom = Math.min(3, Math.max(1, z)); this._clampPan(); }
    setPan(x, y) { this.panX = x; this.panY = y; this._clampPan(); }
    resetPan() { this.panX = 0.5; this.panY = 0.5; }

    /**
     * Given the natural size of the source video, computes the output
     * canvas size (respecting the aspect preset while fitting inside a
     * max working resolution) and the source-space crop rect to sample
     * from for the current zoom/pan.
     */
    computeFrame(sourceW, sourceH, maxDim) {
      const ratio = this.aspect.ratio; // width / height
      let outW, outH;
      if (ratio >= 1) { outW = maxDim; outH = Math.round(maxDim / ratio); }
      else { outH = maxDim; outW = Math.round(maxDim * ratio); }

      // Largest crop window matching `ratio` that fits inside the source frame.
      let cropW, cropH;
      if (sourceW / sourceH > ratio) { cropH = sourceH; cropW = sourceH * ratio; }
      else { cropW = sourceW; cropH = sourceW / ratio; }

      // Zoom shrinks the crop window (sampling a smaller region = more zoomed in).
      cropW = cropW / this.zoom;
      cropH = cropH / this.zoom;

      const cx = this.panX * sourceW;
      const cy = this.panY * sourceH;
      let sx = cx - cropW / 2;
      let sy = cy - cropH / 2;
      sx = Math.min(Math.max(sx, 0), sourceW - cropW);
      sy = Math.min(Math.max(sy, 0), sourceH - cropH);

      return { outW, outH, sx, sy, sw: cropW, sh: cropH };
    }

    _clampPan() {
      this.panX = Math.min(1, Math.max(0, this.panX));
      this.panY = Math.min(1, Math.max(0, this.panY));
    }

    /** Draws rule-of-thirds + safe-area guides on a transparent overlay canvas. */
    drawGuides(ctx, w, h) {
      ctx.clearRect(0, 0, w, h);
      if (!this.showGuides) return;
      ctx.save();
      ctx.strokeStyle = 'rgba(255,255,255,0.35)';
      ctx.lineWidth = 1;
      // rule of thirds
      for (let i = 1; i < 3; i++) {
        ctx.beginPath(); ctx.moveTo((w / 3) * i, 0); ctx.lineTo((w / 3) * i, h); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(0, (h / 3) * i); ctx.lineTo(w, (h / 3) * i); ctx.stroke();
      }
      // action-safe (90%) and title-safe (80%) margins
      ctx.strokeStyle = 'rgba(94,106,210,0.55)';
      ctx.setLineDash([5, 5]);
      const m1 = 0.05 * Math.min(w, h) / (h / w > 1 ? 1 : 1);
      const marginAction = { x: w * 0.05, y: h * 0.05, w: w * 0.9, h: h * 0.9 };
      ctx.strokeRect(marginAction.x, marginAction.y, marginAction.w, marginAction.h);
      ctx.strokeStyle = 'rgba(240,191,0,0.55)';
      const marginTitle = { x: w * 0.1, y: h * 0.1, w: w * 0.8, h: h * 0.8 };
      ctx.strokeRect(marginTitle.x, marginTitle.y, marginTitle.w, marginTitle.h);
      ctx.setLineDash([]);
      ctx.restore();
    }
  }

  window.VS = window.VS || {};
  window.VS.CompositionEngine = CompositionEngine;
})();
