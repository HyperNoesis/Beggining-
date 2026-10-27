/**
 * Realism engine — makes the composite look shot-together instead of
 * cut-and-pasted, using cheap canvas math only. No ML model, no paid API,
 * runs every frame at interactive framerate.
 *
 * Techniques, in the order they're applied to the final composite:
 *  1. Tone match   — sample the environment's average color/luminance and
 *     nudge the person layer's brightness/contrast/saturation/warmth
 *     toward it via a canvas `filter` string (cheap: no per-pixel JS loop).
 *  2. Contact shadow — soft elliptical gradient under the subject's feet,
 *     derived from the mask's bounding box, tinted from the environment.
 *  3. Light wrap / rim light — a blurred, color-matched glow bled in along
 *     the silhouette edge from the environment side, the single biggest
 *     giveaway of a flat cutout when missing.
 *  4. Grain match — a tileable noise texture blended over the whole frame
 *     so the clean webcam layer doesn't look suspiciously cleaner than a
 *     compressed/generated background.
 *
 * Environment tone sampling is throttled (not every frame) since the
 * background is static between environment switches.
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

  class RealismEngine {
    constructor() {
      this.enabled = false;      // master "make it believable" toggle
      this.toneMatch = true;
      this.shadow = true;
      this.lightWrap = true;
      this.grain = true;
      this.intensity = 0.7;      // 0..1 global strength dial
      this.abPreview = false;    // when true, right half renders WITHOUT effects
      // FAST mode (see setPerf in render-core.js): skips light wrap only — it
      // costs two extra full-frame draws per frame, one through a 10px blur.
      // Tone match, contact shadow and grain are cheap and stay as chosen.
      this.lite = false;

      this._envTone = { r: 128, g: 128, b: 128, lum: 128 };
      this._envToneSampleCounter = 0;
      this._noiseCanvas = this._buildNoiseTile(128);
    }

    setAll(on) { this.enabled = on; }

    /** Cheap periodic sample of the background's average color, used to drive tone match + tints. */
    sampleEnvironmentTone(envCanvasLike, w, h) {
      this._envToneSampleCounter++;
      if (this._envToneSampleCounter % 30 !== 0 && this._envToneSampleCounter !== 1) return; // ~1x/sec at 30fps
      try {
        const sw = 32, sh = 32;
        const tmp = this._tmpCanvas || (this._tmpCanvas = scratchCanvas(sw, sh));
        const tctx = tmp.getContext('2d', { willReadFrequently: true });
        tctx.drawImage(envCanvasLike, 0, 0, sw, sh);
        const data = tctx.getImageData(0, 0, sw, sh).data;
        let r = 0, g = 0, b = 0, n = 0;
        for (let i = 0; i < data.length; i += 4) { r += data[i]; g += data[i + 1]; b += data[i + 2]; n++; }
        r /= n; g /= n; b /= n;
        this._envTone = { r, g, b, lum: 0.2126 * r + 0.7152 * g + 0.0722 * b };
      } catch (e) { /* environment source not readable this frame — keep last known tone */ }
    }

    /** Filter string applied to the person layer to tone-match it to the environment. */
    personFilterString() {
      if (!this.enabled || !this.toneMatch) return 'none';
      const k = this.intensity;
      const { r, g, b, lum } = this._envTone;
      // Target ~ neutral 128 midtone environments shouldn't shift the person at all;
      // warm/cool or bright/dark environments should pull the person that direction.
      const brightness = 1 + ((lum - 128) / 255) * 0.35 * k;
      const warmth = ((r - b) / 255) * 18 * k; // degrees, fed into hue-rotate as a mild push
      const saturate = 1 + ((Math.max(r, g, b) - Math.min(r, g, b)) / 255) * 0.25 * k;
      const contrast = 1 + 0.06 * k;
      return `brightness(${brightness.toFixed(3)}) contrast(${contrast.toFixed(3)}) saturate(${saturate.toFixed(3)}) hue-rotate(${warmth.toFixed(1)}deg)`;
    }

    /** Draws a soft contact shadow under the subject, BEFORE the person layer is drawn. */
    drawShadow(ctx, maskBounds, w, h) {
      if (!this.enabled || !this.shadow || !maskBounds) return;
      const k = this.intensity;
      const cx = (maskBounds.minX + maskBounds.maxX) / 2;
      const footY = maskBounds.maxY;
      const spread = (maskBounds.maxX - maskBounds.minX) * 0.55;
      ctx.save();
      const grad = ctx.createRadialGradient(cx, footY, 1, cx, footY, spread);
      grad.addColorStop(0, `rgba(0,0,0,${0.38 * k})`);
      grad.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.ellipse(cx, footY, spread, spread * 0.28, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    /** Draws a blurred, environment-tinted glow along the silhouette edge, AFTER the person layer. */
    drawLightWrap(ctx, personCanvas, w, h) {
      if (!this.enabled || !this.lightWrap || this.lite) return;
      const k = this.intensity;
      const { r, g, b } = this._envTone;
      ctx.save();
      ctx.globalAlpha = 0.5 * k;
      ctx.globalCompositeOperation = 'lighter';
      ctx.filter = 'blur(10px)';
      // Redraw a tinted, blurred silhouette slightly offset inward from the edges —
      // reads as ambient bounce light from the environment wrapping the subject.
      ctx.drawImage(personCanvas, 0, 0, w, h);
      ctx.globalCompositeOperation = 'source-atop';
      ctx.fillStyle = `rgba(${r | 0},${g | 0},${b | 0},0.9)`;
      ctx.fillRect(0, 0, w, h);
      ctx.restore();
    }

    /** Final full-frame grain pass so the composite doesn't look artificially clean. */
    drawGrain(ctx, w, h) {
      if (!this.enabled || !this.grain) return;
      const k = this.intensity;
      ctx.save();
      ctx.globalAlpha = 0.05 * k;
      ctx.globalCompositeOperation = 'overlay';
      const pattern = ctx.createPattern(this._noiseCanvas, 'repeat');
      ctx.fillStyle = pattern;
      ctx.fillRect(0, 0, w, h);
      ctx.restore();
    }

    _buildNoiseTile(size) {
      const c = scratchCanvas(size, size);
      const cx = c.getContext('2d');
      const img = cx.createImageData(size, size);
      for (let i = 0; i < img.data.length; i += 4) {
        const v = 128 + (Math.random() - 0.5) * 90;
        img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
        img.data[i + 3] = 255;
      }
      cx.putImageData(img, 0, 0);
      return c;
    }
  }

  globalThis.VS = globalThis.VS || {};
  globalThis.VS.RealismEngine = RealismEngine;
})();
