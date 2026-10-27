/**
 * SceneEngine — "Studio Scene" mode.
 *
 * Goal: make the person look like they are IN the picture, not pasted on it.
 * Everything here is plain canvas work (no model, no network, no cost) and works in
 * the render worker or on the main thread.
 *
 * What it adds on top of a normal "cut-out over a background":
 *  1. FOREGROUND OCCLUDER. The part of the scene image below a user-set "desk line"
 *     is drawn IN FRONT of the person, so a desk/table/bench/sofa-back in the picture
 *     really hides the lower body. This is the single biggest "I'm sitting there" cue.
 *     The line can be tilted and bowed to follow real desk edges, with a soft feather.
 *  2. PERSON PLACEMENT. Scale + left/right + up/down, anchored at the bottom, so the
 *     person is the right size for the room (not a giant head in front of a small desk).
 *  3. KEY-LIGHT MATCH. The scene's brighter side is detected automatically; the person
 *     gets a highlight on that side and a shade on the other, tinted with the scene's
 *     light colour.
 *  4. CAST SHADOW. A soft silhouette shadow on the wall behind, offset away from the key.
 *  5. DEPTH SOFTNESS. A slight blur on the background layer only (the occluder stays
 *     sharp), which separates subject from background the way a real lens does.
 *
 * Honest limit: this is a fixed-camera, 2D-layered effect. It sells "sitting behind a desk
 * in this room" well. It does not make a 3D world you can walk through.
 */
(function () {
  function scratchCanvas(w, h) {
    if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(Math.max(1, w | 0), Math.max(1, h | 0));
    const c = document.createElement('canvas');
    c.width = Math.max(1, w | 0); c.height = Math.max(1, h | 0);
    return c;
  }
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const SHOULDER_LINE = 0.62;   // typical webcam framing: shoulders ~62% of the way down the frame
  const smooth = (t) => t * t * (3 - 2 * t);

  const DEFAULTS = {
    enabled: false,
    // foreground occluder (desk line). Heights are fractions of frame height (0 = top, 1 = bottom).
    deskOn: true,
    deskY: 0.70,        // desk top edge at the LEFT of the frame
    deskTilt: 0.0,      // right-edge height minus left-edge height
    deskBow: 0.0,       // extra drop at the centre (positive = centre lower, like a curved anchor desk)
    deskFeather: 6,     // soft edge, in px at 720p
    // person placement (anchored bottom-centre)
    personScale: 0.72,
    personX: 0.0,       // fraction of frame width
    personY: 0.0,       // fraction of frame height (positive = lower)
    // lighting
    lightAuto: true,
    lightSide: 1,       // used when lightAuto is false: -1 = key from left, +1 = from right
    lightStrength: 0.5,
    // shadow + depth
    shadowStrength: 0.5,
    bgSoft: 0.25,
    lightTint: null,    // [r,g,b] from scene.json; null = measured from the picture
    // M4 realism passes (all cheap canvas work, cached where the picture is static)
    spill: 0.0,         // ambient colour of the room bleeding onto the person
    reflection: 0.0,    // faint blurred reflection of the person on the desk surface
    bloom: 0.0,         // soft glow around the bright lights in the picture
    vignette: 0.0,      // gentle lens falloff at the corners
    // M4 "subtle life" (E6): slow, small movement so the room is not a still photo
    life: 0.0,          // 0..1: drifting light, floating dust, animated screens
    parallax: 0.0,      // 0..1: the room drifts a few pixels as the presenter moves sideways
    colourMatch: 0.0,   // 0..1: statistical colour match of the presenter to the room (per-channel gain toward the room's colour)
    wallOn: false, wallX: -1, wallY: -1, wallTol: 0.5, wallAmt: 0.85, wallColour: null,   // wall colour: tap a point on the wall, flood-fill by similar colour, recolour keeping the light
    occlusion: 0.0,     // 0..1: props nearer than the presenter (mic arm, laptop, plant) are drawn IN FRONT of them, from the scene's depth map
    dof: 0.0,           // 0..1: depth of field. Far things soften more than near ones, and near/far layers drift by different amounts
    screens: null,      // [{x,y,w,h,kind}] fractions of the frame (from scene.json)
    subjectLift: 0.6,   // 0..1: rescues an UNDER-exposed presenter (dim room); does nothing in normal light
    seatClip: 1,        // 1 = clip the presenter to the body corridor (removes chair parts the segmenter kept), 0 = off
    seatFit: 1,         // 1 = auto-fit the presenter (scale + position) to the seat guide, 0 = use the manual sliders
    seat: null,         // Level 3 seating (scene.json 'seat'): {type, supports, guide{headX,headY,headRx,headRy,shoulderY,shoulderHalfW}, arms[{x0,x1,y0,y1,feather}]}
  };

  // Hand-tuned starting points for the built-in scenes that actually contain a desk/table.
  // Everything else starts from DEFAULTS. Values are fractions of the (stretched) frame.
  const PRESETS = {
    // deskY = the desk's BACK edge (where it meets the wall side of the picture): everything below it is in front of the person.
    'podcast-studio':     { deskY: 0.58, deskTilt: 0.00, deskBow: 0.00, personScale: 0.50, personX: 0.0 },
    'newsroom':           { deskY: 0.66, deskTilt: 0.00, deskBow: 0.00, personScale: 0.42, personX: 0.0 },
    'brick-podcast-room': { deskY: 0.62, deskTilt: 0.00, deskBow: 0.00, personScale: 0.50, personX: 0.0 },
    'corporate-office':   { deskY: 0.70, deskTilt: -0.02, deskBow: 0.00, personScale: 0.55, personX: 0.12 },
  };

  /** Desk edge height (fraction of frame height) at horizontal position x01 (0..1). Pure. */
  function deskLineY(x01, s) {
    return s.deskY + s.deskTilt * x01 + s.deskBow * 4 * x01 * (1 - x01);
  }

  /**
   * Alpha mask (w*h bytes) that is 255 below the desk line and 0 above it, with a soft edge.
   * Pure and deterministic, so it can be unit-tested without a canvas.
   */
  function buildOccluderAlpha(w, h, s) {
    const out = new Uint8ClampedArray(w * h);
    const f = Math.max(0, s.deskFeather * (h / 720));
    for (let x = 0; x < w; x++) {
      const lineY = deskLineY(w > 1 ? x / (w - 1) : 0, s) * h;
      for (let y = 0; y < h; y++) {
        let a;
        if (f < 0.5) a = y >= lineY ? 1 : 0;
        else a = smooth(clamp((y - lineY) / f + 0.5, 0, 1));
        out[y * w + x] = Math.round(a * 255);
      }
    }
    return out;
  }

  /**
   * Reads where the scene's light comes from. `rgba` is a small RGBA image (e.g. 24x24).
   * side: -1..1 (positive = the right half is brighter, i.e. key light from the right).
   * Pure, unit-testable.
   */
  function analyzeLight(rgba, w, h) {
    let L = 0, R = 0, nL = 0, nR = 0, T = 0, B = 0, nT = 0, nB = 0;
    const lums = [];
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 4;
        const lum = 0.2126 * rgba[i] + 0.7152 * rgba[i + 1] + 0.0722 * rgba[i + 2];
        lums.push(lum);
        if (x < w / 2) { L += lum; nL++; } else { R += lum; nR++; }
        if (y < h / 2) { T += lum; nT++; } else { B += lum; nB++; }
      }
    }
    const mL = L / Math.max(1, nL), mR = R / Math.max(1, nR);
    const mT = T / Math.max(1, nT), mB = B / Math.max(1, nB);
    const side = clamp(((mR - mL) / Math.max(1, mR + mL)) * 5, -1, 1);
    const top = clamp(((mT - mB) / Math.max(1, mT + mB)) * 5, -1, 1);
    // tint = average colour of the brightest quarter of the picture (the light sources / lit surfaces)
    const sorted = lums.slice().sort((a, b) => b - a);
    const cut = sorted[Math.max(0, Math.floor(sorted.length * 0.25) - 1)];
    let r = 0, g = 0, b = 0, n = 0;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 4;
        const lum = 0.2126 * rgba[i] + 0.7152 * rgba[i + 1] + 0.0722 * rgba[i + 2];
        if (lum >= cut) { r += rgba[i]; g += rgba[i + 1]; b += rgba[i + 2]; n++; }
      }
    }
    n = Math.max(1, n);
    const lumAll = (mL + mR) / 2;
    let ar = 0, ag = 0, ab = 0;
    for (let i = 0, m = w * h; i < m; i++) { ar += rgba[i * 4]; ag += rgba[i * 4 + 1]; ab += rgba[i * 4 + 2]; }
    const nn = Math.max(1, w * h);
    return { side, top, lum: lumAll, tint: [Math.round(r / n), Math.round(g / n), Math.round(b / n)], ambient: [Math.round(ar / nn), Math.round(ag / nn), Math.round(ab / nn)] };
  }

  /** A prompt wrapper that makes an AI-generated room work with the desk occluder. */
  function scenePrompt(description) {
    const d = (description || 'a modern news studio').trim().replace(/[.,\s]+$/, '');
    return d + ', photorealistic interior, centered symmetrical composition, camera at eye level on a tripod, ' +
      'a wide desk or table across the bottom third of the frame, an empty chair behind the desk, ' +
      'the area above and behind the desk is empty and uncluttered, soft key light from the left, ' +
      'shallow depth of field, no people, no text, no logos';
  }

  /** Pure: where the presenter is (0..1 across the frame) -> target background drift -1..1. Moving right drifts the room left. */
  function parallaxTarget(centre01, amount) { return clamp((0.5 - centre01) * 2, -1, 1) * clamp(amount, 0, 1); }
  /** Pure: fixed pseudo-random dust motes (same every run, so tests and recordings are repeatable). */
  function makeDust(n) {
    let a = 123456789; const r = () => { a = (Math.imul(a, 1664525) + 1013904223) >>> 0; return a / 4294967296; };
    const out = []; for (let i = 0; i < n; i++) out.push({ x: r(), y: 0.08 + r() * 0.52, s: 0.6 + r() * 1.6, ph: r() * 6.283, sp: 0.5 + r() * 1.2, k: 0.4 + r() * 0.6 });
    return out;
  }
  const DUST = makeDust(26);

  class SceneEngine {
    constructor() {
      this.state = Object.assign({}, DEFAULTS);
      this.lite = false;
      this._sigBg = ''; this._sigOcc = '';
      this._bgCanvas = null; this._occCanvas = null;
      this._wallSig = ''; this._wallCanvas = null; this._wallKey = ''; this._cmGain = [1, 1, 1]; this._cmAt = 0; this._cmRef = null;
      this._depth = null; this._front = null; this._sigFront = ''; this._layers = null; this._sigLayers = ''; this._fxOn = false;
      this._litCanvas = null; this._shadowCanvas = null; this._tmpMask = null;
      this._light = { side: 0, top: 0, lum: 128, tint: [255, 255, 255], ambient: [128, 128, 128] };
      this._px = 0; this._pxAt = 0; this._lifeOn = false;
      this._bloomCanvas = null; this._vigCanvas = null; this._reflCanvas = null; this._sigBloom = ''; this._sigVig = '';
      this.stats = { occluderBuilds: 0, bgBuilds: 0 };
    }

    get enabled() { return !!this.state.enabled; }

    setState(patch) {
      if (!patch) return;
      for (const k of Object.keys(DEFAULTS)) {
        if (patch[k] === undefined) continue;
        this.state[k] = typeof DEFAULTS[k] === 'boolean' ? !!patch[k] : (typeof DEFAULTS[k] === 'number' ? Number(patch[k]) : patch[k]);
      }
    }

    static presetFor(envId) {
      const st = Object.assign({}, DEFAULTS, { enabled: true }, PRESETS[envId] || {});
      if (!PRESETS[envId] || PRESETS[envId].personY === undefined) SceneEngine.autoPlace(st);
      return st;
    }

    /**
     * Seats the person at the desk: a webcam frame has the shoulders about 62% of the way down,
     * so move the person until the shoulder line sits just behind the desk's back edge.
     * (The body below that is hidden by the desk, which is exactly the "sitting behind it" look.)
     */
    static autoPlace(st, line) {
      const deskMid = deskLineY(0.5, st);
      st.personY = clamp(deskMid + 0.02 - 1 + st.personScale * (1 - (line || SHOULDER_LINE)), -0.3, 0.3);
      return st;
    }

    /** Key-light side actually used: -1 (from left) .. +1 (from right). */
    keySide() {
      if (!this.state.lightAuto) return this.state.lightSide >= 0 ? 1 : -1;
      // A perfectly balanced scene has no obvious key: default to a flattering key from the left.
      return Math.abs(this._light.side) < 0.12 ? -1 : this._light.side;
    }

    personRect(cw, ch) {
      const f = this._fit && this.state.seat && this.state.seatFit ? this._fit : null;
      const s = clamp(f ? f.s : this.state.personScale, 0.2, 1.5);
      const px = f ? f.x : this.state.personX, py = f ? f.y : this.state.personY;
      const dw = cw * s, dh = ch * s;
      return { dx: (cw - dw) / 2 + px * cw, dy: ch - dh + py * ch, dw, dh };
    }

    /**
     * Builds the cached layers when the scene image, size or settings changed.
     * Returns false while the scene image is not available yet (caller draws a placeholder).
     */
    prepare(env, cw, ch, envKey) {
      if (!env) return false;
      this._envKey = envKey; this._envForMatch = env;
      const s = this.state;
      const sigBg = envKey + this._wallSig + '|' + cw + 'x' + ch + '|' + s.bgSoft.toFixed(2);
      if (sigBg !== this._sigBg) {
        this._sigBg = sigBg;
        this.stats.bgBuilds++;
        // light analysis
        try {
          const tiny = scratchCanvas(24, 24);
          const tctx = tiny.getContext('2d', { willReadFrequently: true });
          tctx.drawImage(env, 0, 0, 24, 24);
          const d = tctx.getImageData(0, 0, 24, 24).data;
          this._light = analyzeLight(d, 24, 24);
        } catch (e) { /* keep last known light */ }
        // softened background layer
        const blurPx = s.bgSoft * 6 * (ch / 720);
        if (!this._bgCanvas) this._bgCanvas = scratchCanvas(cw, ch);
        if (this._bgCanvas.width !== cw || this._bgCanvas.height !== ch) { this._bgCanvas.width = cw; this._bgCanvas.height = ch; }
        const bctx = this._bgCanvas.getContext('2d');
        bctx.clearRect(0, 0, cw, ch);
        if (blurPx > 0.3) {
          const pad = Math.ceil(blurPx * 2);
          bctx.filter = 'blur(' + blurPx.toFixed(1) + 'px)';
          bctx.drawImage(env, -pad, -pad, cw + pad * 2, ch + pad * 2);   // oversize so the blur has no dark edge
          bctx.filter = 'none';
        } else {
          bctx.drawImage(env, 0, 0, cw, ch);
        }
      }

      const sigOcc = envKey + this._wallSig + '|' + cw + 'x' + ch + '|' + s.deskOn + '|' + s.deskY.toFixed(3) + '|' + s.deskTilt.toFixed(3) + '|' + s.deskBow.toFixed(3) + '|' + s.deskFeather;
      if (sigOcc !== this._sigOcc) {
        this._sigOcc = sigOcc;
        this.stats.occluderBuilds++;
        if (!this._occCanvas) this._occCanvas = scratchCanvas(cw, ch);
        if (this._occCanvas.width !== cw || this._occCanvas.height !== ch) { this._occCanvas.width = cw; this._occCanvas.height = ch; }
        const octx = this._occCanvas.getContext('2d');
        octx.clearRect(0, 0, cw, ch);
        if (s.deskOn) {
          octx.globalCompositeOperation = 'source-over';
          octx.drawImage(env, 0, 0, cw, ch);                      // the crisp scene image...
          const alpha = buildOccluderAlpha(cw, ch, s);            // ...kept only below the desk line
          if (!this._tmpMask) this._tmpMask = scratchCanvas(cw, ch);
          if (this._tmpMask.width !== cw || this._tmpMask.height !== ch) { this._tmpMask.width = cw; this._tmpMask.height = ch; }
          const mctx = this._tmpMask.getContext('2d');
          const img = mctx.createImageData(cw, ch);
          for (let i = 0, n = cw * ch; i < n; i++) { const o = i * 4; img.data[o] = 255; img.data[o + 1] = 255; img.data[o + 2] = 255; img.data[o + 3] = alpha[i]; }
          mctx.putImageData(img, 0, 0);
          octx.globalCompositeOperation = 'destination-in';
          octx.drawImage(this._tmpMask, 0, 0);
          octx.globalCompositeOperation = 'source-over';
        }
      }
      return true;
    }

    /**
     * Once per frame, before drawing. Smooths the presenter's sideways position into a small background drift.
     * `bounds` = mask bounds in frame pixels (or null); `enabled` is false when the realism toggle is off (A/B preview).
     */
    update(bounds, cw, ch, now, enabled) {
      const s = this.state;
      this._fxOn = !!enabled;
      this._lifeOn = !!enabled && s.life > 0.01;
      const amount = enabled ? s.parallax : 0;
      let target = 0;
      if (amount > 0.01) {
        const r = this.personRect(cw, ch);
        const c = bounds ? ((bounds.minX + bounds.maxX) / 2 / cw) : 0.5;
        const placed = (r.dx + c * r.dw) / cw;           // where the head really is after size/position
        target = parallaxTarget(placed, amount);
      }
      const dt = this._pxAt ? clamp(now - this._pxAt, 0, 250) : 16;
      this._pxAt = now;
      this._px += (target - this._px) * (1 - Math.exp(-dt / 700));   // ~0.7 s smoothing: no jitter from mask noise
      if (Math.abs(this._px) < 0.0005) this._px = 0;
    }

    /** Real depth map (8-bit greyscale, 255 = near) for the current scene, from assets/environments/<id>-depth.png. null clears it. */
    setDepth(id, bmp) { this._depth = bmp ? { id, bmp } : null; this._sigLayers = ''; this._sigFront = ''; this._front = null; }

    /** Depth source for layers: the real map if we have one for this picture, else a cheap ramp (far at the top, near at the desk). */
    _depthMask(envKey, w, h) {
      const c = scratchCanvas(w, h), x = c.getContext('2d', { willReadFrequently: true });
      if (this._depth && this._depth.id === envKey) { x.drawImage(this._depth.bmp, 0, 0, w, h); return { canvas: c, real: true }; }
      const img = x.createImageData(w, h), dy = clamp(this.state.deskY, 0.3, 0.95);
      for (let j = 0; j < h; j++) {
        const t = clamp((j / (h - 1)) / dy, 0, 1), v = Math.round(255 * (0.05 + 0.8 * t * t));
        for (let i = 0; i < w; i++) { const k = (j * w + i) * 4; img.data[k] = img.data[k + 1] = img.data[k + 2] = v; img.data[k + 3] = 255; }
      }
      x.putImageData(img, 0, 0); return { canvas: c, real: false };
    }

    /** Builds (once per picture/size/dof) three cached layers: far (full, softest), mid and near (masked by depth, sharper). */
    _buildLayers(env, cw, ch, envKey) {
      const s = this.state, u = ch / 720;
      const sig = envKey + this._wallSig + '|' + cw + 'x' + ch + '|' + s.dof.toFixed(2) + '|' + s.bgSoft.toFixed(2) + '|' + (this._depth && this._depth.id === envKey ? 'm' : 'r' + s.deskY.toFixed(2));
      if (sig === this._sigLayers && this._layers) return true;
      this._sigLayers = sig;
      this.stats.layerBuilds = (this.stats.layerBuilds || 0) + 1;
      const base = s.bgSoft * 6 * u, k = clamp(s.dof, 0, 1);
      const radii = [base + k * 9 * u, base + k * 3.5 * u, base * 0.35];
      const dm = this._depthMask(envKey, 160, 90), dx = dm.canvas.getContext('2d', { willReadFrequently: true });
      const dd = dx.getImageData(0, 0, 160, 90).data;
      const sm = (a, b, v) => { const t = clamp((v - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
      const mkMask = (a0, a1) => {
        const m = scratchCanvas(160, 90), mx = m.getContext('2d'), img = mx.createImageData(160, 90);
        for (let i = 0; i < 160 * 90; i++) { const d = dd[i * 4] / 255; img.data[i * 4 + 3] = Math.round(255 * sm(a0, a1, d)); }
        mx.putImageData(img, 0, 0); return m;
      };
      const layer = (r, mask) => {
        const c = scratchCanvas(cw, ch), x = c.getContext('2d');
        if (r > 0.3) { const pad = Math.ceil(r * 2); x.filter = 'blur(' + r.toFixed(1) + 'px)'; x.drawImage(env, -pad, -pad, cw + pad * 2, ch + pad * 2); x.filter = 'none'; }
        else x.drawImage(env, 0, 0, cw, ch);
        if (mask) { x.globalCompositeOperation = 'destination-in'; x.imageSmoothingQuality = 'high'; x.drawImage(mask, 0, 0, cw, ch); }
        return c;
      };
      this._layers = [layer(radii[0], null), layer(radii[1], mkMask(0.12, 0.34)), layer(radii[2], mkMask(0.5, 0.72))];
      this._layersReal = dm.real;
      return true;
    }

    /**
     * Props nearer than the presenter, from the real depth map (v0.23). The presenter's depth = the chair/desk-back depth just above the
     * desk line at the centre; anything above the desk line that is clearly nearer is cut out of the sharp picture and drawn over the person.
     * Only with a real depth map (never the estimated ramp). Cached per picture/size/desk line.
     */
    _buildFront(env, cw, ch, envKey) {
      const s = this.state;
      if (!this._depth || this._depth.id !== envKey || !env) { this._front = null; return false; }
      const sig = envKey + this._wallSig + '|' + cw + 'x' + ch + '|' + s.deskY.toFixed(3) + '|' + s.deskTilt.toFixed(3);
      if (sig === this._sigFront) return !!this._front;
      this._sigFront = sig; this._front = null;
      const W = 320, H = 180, dc = scratchCanvas(W, H), dx = dc.getContext('2d', { willReadFrequently: true });
      dx.drawImage(this._depth.bmp, 0, 0, W, H);
      const d = dx.getImageData(0, 0, W, H).data;
      const dy = clamp(s.deskY + s.deskBow * 0 , 0.3, 0.95);
      let acc = 0, n = 0;
      for (let y = Math.floor((dy - 0.06) * H); y < Math.floor((dy - 0.015) * H); y++) for (let x = Math.floor(W * 0.42); x < Math.floor(W * 0.58); x++) { acc += d[(y * W + x) * 4]; n++; }
      if (!n) return false;
      const pd = acc / n / 255, lo = pd + 0.10, hi = pd + 0.22;
      const mc = scratchCanvas(W, H), mx = mc.getContext('2d'), img = mx.createImageData(W, H);
      let any = 0;
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
        const yy = y / H, edge = deskLineY(x / W, s);
        let a = 0;
        if (yy < edge - 0.012 && yy > 0.05) { const v = d[(y * W + x) * 4] / 255, t = clamp((v - lo) / (hi - lo), 0, 1); a = t * t * (3 - 2 * t); }
        if (a > 0.02) any++;
        img.data[(y * W + x) * 4 + 3] = Math.round(255 * a);
      }
      mx.putImageData(img, 0, 0);
      if (any < 20) return false;
      const fc = scratchCanvas(cw, ch), fx = fc.getContext('2d');
      fx.drawImage(env, 0, 0, cw, ch); fx.globalCompositeOperation = 'destination-in'; fx.imageSmoothingQuality = 'high'; fx.drawImage(mc, 0, 0, cw, ch);
      this._front = fc; return true;
    }

    drawFront(ctx, env, cw, ch) {
      const s = this.state;
      if (!this._fxOn || s.occlusion < 0.02 || !this._envKey) return;
      if (!this._buildFront(env, cw, ch, this._envKey) || !this._front) return;
      ctx.save(); ctx.globalAlpha = clamp(s.occlusion, 0, 1);
      if (Math.abs(this._px) > 0.001) { const S = 1.04, ay = clamp(s.deskY, 0.3, 0.95) * ch; ctx.translate(cw / 2 + this._px * 0.012 * cw * 0.12, ay); ctx.scale(S, S); ctx.translate(-cw / 2, -ay); }
      ctx.drawImage(this._front, 0, 0, cw, ch); ctx.restore();
    }

    drawBackground(ctx, env, cw, ch) {
      const useLayers = this._fxOn && this.state.dof > 0.02 && this._envKey && this._buildLayers(env, cw, ch, this._envKey);
      if (useLayers) {
        const S = 1.04, ay = clamp(this.state.deskY, 0.3, 0.95) * ch, shifts = [1, 0.5, 0.12];
        const moving = Math.abs(this._px) > 0.001;
        for (let i = 0; i < 3; i++) {
          if (!moving) { ctx.drawImage(this._layers[i], 0, 0, cw, ch); continue; }
          ctx.save();
          ctx.translate(cw / 2 + this._px * 0.012 * cw * shifts[i], ay); ctx.scale(S, S); ctx.translate(-cw / 2, -ay);
          ctx.drawImage(this._layers[i], 0, 0, cw, ch);
          ctx.restore();
        }
        return;
      }
      this._drawFlatBackground(ctx, env, cw, ch);
    }

    _drawFlatBackground(ctx, env, cw, ch) {
      const src = (this._bgCanvas && this._sigBg) ? this._bgCanvas : env;
      if (!src) return;
      if (Math.abs(this._px) > 0.001) {
        // 4% overscan anchored on the desk edge (so the desk meets the wall at the same height), then a drift of up to 1.2% of the width
        const S = 1.04, ay = clamp(this.state.deskY, 0.3, 0.95) * ch;
        ctx.save();
        ctx.translate(cw / 2 + this._px * 0.012 * cw, ay); ctx.scale(S, S); ctx.translate(-cw / 2, -ay);
        ctx.drawImage(src, 0, 0, cw, ch);
        ctx.restore();
      } else ctx.drawImage(src, 0, 0, cw, ch);
    }

    /** Slow drifting light, floating dust and animated screens. Behind the person. Cheap: ~30 tiny draws and 2 gradients. */
    drawLife(ctx, cw, ch, now) {
      if (!this._lifeOn) return;
      const k = clamp(this.state.life, 0, 1), t = now / 1000, u = ch / 720;
      const tint = (Array.isArray(this.state.lightTint) && this.state.lightTint.length === 3) ? this.state.lightTint : this._light.tint;
      ctx.save();
      ctx.globalCompositeOperation = 'screen';
      // 1) a wide soft patch of light that slowly sweeps across the wall
      const gx = (0.5 + 0.42 * Math.sin(t / 9)) * cw, gy = ch * 0.32;
      const g = ctx.createRadialGradient(gx, gy, 0, gx, gy, cw * 0.32);
      g.addColorStop(0, 'rgba(' + tint[0] + ',' + tint[1] + ',' + tint[2] + ',' + (0.16 * k).toFixed(3) + ')');
      g.addColorStop(1, 'rgba(' + tint[0] + ',' + tint[1] + ',' + tint[2] + ',0)');
      ctx.fillStyle = g; ctx.fillRect(0, 0, cw, ch * 0.7);
      // 2) screens (news wall, scoreboard): slow moving bars so a monitor in the picture looks switched on
      const scr = this.state.screens;
      if (Array.isArray(scr)) scr.forEach((r, i) => {
        if (!r || !(r.w > 0 && r.h > 0)) return;
        const x = r.x * cw, y = r.y * ch, w = r.w * cw, h = r.h * ch;
        ctx.save(); ctx.beginPath(); ctx.rect(x, y, w, h); ctx.clip();
        for (let b = 0; b < 3; b++) {
          const yy = y + (((t * (0.10 + 0.04 * b) + i * 0.31 + b * 0.37) % 1) * (h + 8)) - 4;
          ctx.fillStyle = 'rgba(255,255,255,' + (0.20 * k).toFixed(3) + ')';
          ctx.fillRect(x, yy, w, Math.max(2, h * 0.07));
        }
        const sx = x + (((t * 0.07 + i * 0.2) % 1) * (w + 20)) - 10;
        const sg = ctx.createLinearGradient(sx - 14, 0, sx + 14, 0);
        sg.addColorStop(0, 'rgba(255,255,255,0)'); sg.addColorStop(0.5, 'rgba(255,255,255,' + (0.22 * k).toFixed(3) + ')'); sg.addColorStop(1, 'rgba(255,255,255,0)');
        ctx.fillStyle = sg; ctx.fillRect(sx - 14, y, 28, h);
        ctx.restore();
      });
      // 3) dust motes drifting in the light
      ctx.fillStyle = 'rgb(' + Math.round((tint[0] + 255) / 2) + ',' + Math.round((tint[1] + 255) / 2) + ',' + Math.round((tint[2] + 255) / 2) + ')';
      for (let i = 0; i < DUST.length; i++) {
        const d = DUST[i];
        const x = ((d.x + 0.012 * t * d.sp + 0.01 * Math.sin(t * 0.4 * d.sp + d.ph)) % 1 + 1) % 1 * cw;
        const y = (d.y + 0.015 * Math.sin(t * 0.3 * d.sp + d.ph * 2)) * ch;
        ctx.globalAlpha = clamp(0.35 * k * d.k * (0.55 + 0.45 * Math.sin(t * 0.9 * d.sp + d.ph)), 0, 1);
        ctx.beginPath(); ctx.arc(x, y, d.s * u, 0, 6.2832); ctx.fill();
      }
      ctx.restore();
    }

    drawCastShadow(ctx, personCanvas, cw, ch) {
      const k = this.state.shadowStrength;
      if (k < 0.02) return;   // cheap (quarter-res), so it stays on even in FAST mode on phones
      const sw = Math.max(8, cw >> 2), sh = Math.max(8, ch >> 2);
      if (!this._shadowCanvas) this._shadowCanvas = scratchCanvas(sw, sh);
      if (this._shadowCanvas.width !== sw || this._shadowCanvas.height !== sh) { this._shadowCanvas.width = sw; this._shadowCanvas.height = sh; }
      const sc = this._shadowCanvas.getContext('2d');
      sc.globalCompositeOperation = 'source-over';
      sc.clearRect(0, 0, sw, sh);
      sc.filter = 'blur(2px)';
      sc.drawImage(personCanvas, 0, 0, sw, sh);
      sc.filter = 'none';
      sc.globalCompositeOperation = 'source-in';
      sc.fillStyle = '#000';
      sc.fillRect(0, 0, sw, sh);
      sc.globalCompositeOperation = 'source-over';
      const r = this.personRect(cw, ch), side = this.keySide();
      ctx.save();
      ctx.globalAlpha = 0.42 * k;
      ctx.drawImage(this._shadowCanvas, r.dx - side * 0.03 * cw, r.dy + 0.012 * ch, r.dw * 1.02, r.dh);
      if (this.state.seat) {   // seated: a wide soft ambient-occlusion halo, because a body pressed into a sofa darkens the cushions around it
        ctx.globalAlpha = 0.30 * k; ctx.filter = 'blur(' + Math.max(6, Math.round(ch / 36)) + 'px)';
        ctx.drawImage(this._shadowCanvas, r.dx - 0.012 * cw, r.dy + 0.03 * ch, r.dw * 1.05, r.dh * 1.01);
        ctx.filter = 'none';
      }
      ctx.restore();
    }

    /** Draws the person (placed, key-lit, optionally tone-filtered). */
    /**
     * Wall colour (v0.23, no model). The user taps a wall point; we flood-fill outward over pixels of similar colour (compared after
     * matching brightness, so a lit gradient on the wall stays inside the fill) above the desk line, then recolour that area with the
     * 'color' blend (hue + saturation of the new colour, brightness of the picture), so light, shadow and texture survive.
     * Returns the recoloured picture (cached) or the original. Honest limit: colour similarity only, so a wall of the same colour as a
     * door or shelf will leak; "fills more/less" (wallTol) and the picture check cover that.
     */
    wallEnv(env, envKey) {
      const s = this.state;
      if (!env || !s.wallOn || !(s.wallX >= 0) || !Array.isArray(s.wallColour) || s.wallColour.length !== 3) { this._wallSig = ''; return env; }
      const sig = '|w' + [s.wallX.toFixed(3), s.wallY.toFixed(3), s.wallTol.toFixed(2), s.wallAmt.toFixed(2), s.wallColour.join(','), s.deskY.toFixed(3)].join(',');
      const key = envKey + sig;
      if (key === this._wallKey && this._wallCanvas) { this._wallSig = sig; return this._wallCanvas; }
      this._wallKey = key;
      const ew = env.width || 1280, eh = env.height || 720, W = 320, H = 180;
      const sc = scratchCanvas(W, H), sx = sc.getContext('2d', { willReadFrequently: true }); sx.drawImage(env, 0, 0, W, H);
      const d = sx.getImageData(0, 0, W, H).data;
      const lum = (i) => 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2] + 1;
      const px = clamp(Math.round(s.wallX * (W - 1)), 2, W - 3), py = clamp(Math.round(s.wallY * (H - 1)), 2, H - 3);
      let sr = 0, sg = 0, sb = 0; for (let j = -2; j <= 2; j++) for (let i = -2; i <= 2; i++) { const k = ((py + j) * W + px + i) * 4; sr += d[k]; sg += d[k + 1]; sb += d[k + 2]; }
      sr /= 25; sg /= 25; sb /= 25; const sl = 0.2126 * sr + 0.7152 * sg + 0.0722 * sb + 1;
      const chromT = 0.05 + 0.20 * s.wallTol, stepT = 0.05 + 0.10 * s.wallTol;
      const mask = new Uint8Array(W * H), q = new Int32Array(W * H); let qh = 0, qt = 0;
      const limit = (x) => clamp(s.deskY, 0.3, 0.95) * H - 2;
      const ok = (idx, from) => {
        const k = idx * 4, y = (idx / W) | 0; if (y < 3 || y > limit()) return false;
        const L = lum(k), r = d[k] * sl / L, g = d[k + 1] * sl / L, b = d[k + 2] * sl / L;
        const dist = Math.sqrt((r - sr) * (r - sr) + (g - sg) * (g - sg) + (b - sb) * (b - sb)) / 441;
        if (dist > chromT) return false;
        const ratio = L / sl; if (ratio < 0.3 || ratio > 3.2) return false;
        return Math.abs(L - lum(from * 4)) / 255 < stepT;
      };
      mask[py * W + px] = 1; q[qt++] = py * W + px;
      while (qh < qt) {
        const c = q[qh++], cx = c % W, cy = (c / W) | 0;
        if (cx > 0 && !mask[c - 1] && ok(c - 1, c)) { mask[c - 1] = 1; q[qt++] = c - 1; }
        if (cx < W - 1 && !mask[c + 1] && ok(c + 1, c)) { mask[c + 1] = 1; q[qt++] = c + 1; }
        if (cy > 0 && !mask[c - W] && ok(c - W, c)) { mask[c - W] = 1; q[qt++] = c - W; }
        if (cy < H - 1 && !mask[c + W] && ok(c + W, c)) { mask[c + W] = 1; q[qt++] = c + W; }
      }
      // close 1px holes (grain), then build the alpha mask
      const mc = scratchCanvas(W, H), mx = mc.getContext('2d'), mi = mx.createImageData(W, H);
      for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) { const i = y * W + x; const n = mask[i - 1] + mask[i + 1] + mask[i - W] + mask[i + W]; if (mask[i] || n >= 3) mi.data[i * 4 + 3] = 255; }
      mx.putImageData(mi, 0, 0);
      const out = scratchCanvas(ew, eh), ox = out.getContext('2d'); ox.drawImage(env, 0, 0, ew, eh);
      const lay = scratchCanvas(ew, eh), lx = lay.getContext('2d');
      lx.filter = 'blur(' + Math.max(1, ew / 640).toFixed(1) + 'px)'; lx.imageSmoothingQuality = 'high'; lx.drawImage(mc, 0, 0, ew, eh); lx.filter = 'none';
      lx.globalCompositeOperation = 'source-in'; lx.fillStyle = 'rgb(' + s.wallColour.map((v) => clamp(Math.round(v), 0, 255)).join(',') + ')'; lx.fillRect(0, 0, ew, eh);
      ox.globalCompositeOperation = 'color'; ox.globalAlpha = clamp(s.wallAmt, 0, 1); ox.drawImage(lay, 0, 0);
      ox.globalCompositeOperation = 'source-over'; ox.globalAlpha = 1;
      this._wallCanvas = out; this._wallSig = sig; this._wallCount = qt; return out;
    }

    /**
     * Statistical colour match (v0.23, no model, licence-free). Every ~0.5 s compare the presenter's mean colour with the room's mean
     * colour behind them, derive per-channel gains (partial strength, hue only: the brightest channel stays 1 so exposure is untouched),
     * smooth them, and apply with a multiply pass on the lit person layer. Replaces the need for a harmonisation network.
     */
    _updateColourMatch(personCanvas, env, cw, ch, now) {
      if (now - this._cmAt < 500 && this._cmRef) return;
      this._cmAt = now;
      try {
        if (!this._cmScratch) this._cmScratch = scratchCanvas(24, 24);
        const c = this._cmScratch.getContext('2d', { willReadFrequently: true });
        if (env) { c.clearRect(0, 0, 24, 24); c.drawImage(env, env.width * 0.3, env.height * 0.18, env.width * 0.4, env.height * 0.5, 0, 0, 24, 24); const e = c.getImageData(0, 0, 24, 24).data; let r = 0, g = 0, b = 0; for (let i = 0; i < e.length; i += 4) { r += e[i]; g += e[i + 1]; b += e[i + 2]; } const n = e.length / 4; this._cmRef = [r / n, g / n, b / n]; }
        c.clearRect(0, 0, 24, 24); c.drawImage(personCanvas, 0, 0, cw, ch, 0, 0, 24, 24);
        const p = c.getImageData(0, 0, 24, 24).data; let r = 0, g = 0, b = 0, n = 0;
        for (let i = 0; i < p.length; i += 4) if (p[i + 3] > 200) { r += p[i]; g += p[i + 1]; b += p[i + 2]; n++; }
        if (n < 12 || !this._cmRef) return;
        r /= n; g /= n; b /= n;
        const k = clamp(this.state.colourMatch, 0, 1) * 0.35, ref = this._cmRef;
        // chromaticity ratio (room vs person), brightness removed
        const pm = (r + g + b) / 3 + 1, rm = (ref[0] + ref[1] + ref[2]) / 3 + 1;
        let gr = Math.pow(((ref[0] / rm) / (r / pm + 1e-3)), k), gg = Math.pow(((ref[1] / rm) / (g / pm + 1e-3)), k), gb = Math.pow(((ref[2] / rm) / (b / pm + 1e-3)), k);
        gr = clamp(gr, 0.86, 1.16); gg = clamp(gg, 0.86, 1.16); gb = clamp(gb, 0.86, 1.16);
        const mx = Math.max(gr, gg, gb); const t = [gr / mx, gg / mx, gb / mx];
        for (let i = 0; i < 3; i++) this._cmGain[i] += (t[i] - this._cmGain[i]) * 0.3;
      } catch (e) { /* keep last gains */ }
    }

    drawPerson(ctx, personCanvas, cw, ch, filterString, bounds, opts) {
      opts = opts || {};
      const s = this.state;
      let src = personCanvas;
      const k = s.lightStrength;
      if (k > 0.01) {
        if (!this._litCanvas) this._litCanvas = scratchCanvas(cw, ch);
        if (this._litCanvas.width !== cw || this._litCanvas.height !== ch) { this._litCanvas.width = cw; this._litCanvas.height = ch; }
        const lc = this._litCanvas.getContext('2d');
        lc.globalCompositeOperation = 'source-over';
        lc.clearRect(0, 0, cw, ch);
        lc.drawImage(personCanvas, 0, 0, cw, ch);
        if (s.colourMatch > 0.02 && this._fxOn && !opts.noSpill) {
          this._updateColourMatch(personCanvas, this._envForMatch, cw, ch, (typeof performance !== 'undefined' ? performance.now() : Date.now()));
          const g = this._cmGain;
          if (g[0] < 0.995 || g[1] < 0.995 || g[2] < 0.995) {
            lc.globalCompositeOperation = 'multiply'; lc.fillStyle = 'rgb(' + Math.round(g[0] * 255) + ',' + Math.round(g[1] * 255) + ',' + Math.round(g[2] * 255) + ')'; lc.fillRect(0, 0, cw, ch);
            // give back the brightness the multiply took (hue changes, exposure does not)
            const loss = 1 - (0.2126 * g[0] + 0.7152 * g[1] + 0.0722 * g[2]);
            if (loss > 0.01) { lc.globalCompositeOperation = 'screen'; const v = Math.round(255 * loss * 0.9); lc.fillStyle = 'rgb(' + v + ',' + v + ',' + v + ')'; lc.fillRect(0, 0, cw, ch); }
            lc.globalCompositeOperation = 'destination-in'; lc.drawImage(personCanvas, 0, 0, cw, ch);
          }
        }
        lc.globalCompositeOperation = 'source-atop';
        const x0 = bounds ? Math.max(0, bounds.minX - 0.04 * cw) : 0;
        const x1 = bounds ? Math.min(cw, bounds.maxX + 0.04 * cw) : cw;
        const side = this.keySide();
        // Push the light colour toward white so the highlight actually brightens (a pure tint barely moves skin tones).
        const tintSrc = (Array.isArray(s.lightTint) && s.lightTint.length === 3) ? s.lightTint : this._light.tint;
        const tr = Math.round((tintSrc[0] + 255) / 2), tg = Math.round((tintSrc[1] + 255) / 2), tb = Math.round((tintSrc[2] + 255) / 2);
        const keyX = side >= 0 ? x1 : x0, farX = side >= 0 ? x0 : x1;
        // highlight on the key side
        const gHi = lc.createLinearGradient(keyX, 0, farX, 0);
        const mag = 0.6 + 0.4 * Math.abs(side);   // lopsided scenes get a stronger highlight
        gHi.addColorStop(0, 'rgba(' + tr + ',' + tg + ',' + tb + ',' + (0.42 * k * mag).toFixed(3) + ')');
        gHi.addColorStop(0.6, 'rgba(' + tr + ',' + tg + ',' + tb + ',0)');
        lc.fillStyle = gHi; lc.fillRect(0, 0, cw, ch);
        // shade on the far side
        const gLo = lc.createLinearGradient(farX, 0, keyX, 0);
        gLo.addColorStop(0, 'rgba(0,0,0,' + (0.34 * k).toFixed(3) + ')');
        gLo.addColorStop(0.55, 'rgba(0,0,0,0)');
        lc.fillStyle = gLo; lc.fillRect(0, 0, cw, ch);
        // colour spill: the room's average colour bleeds onto the person, strongest on the shaded side (bounce light)
        if (s.spill > 0.01 && !opts.noSpill) {
          const am = this._light.ambient || [128, 128, 128];
          const gSp = lc.createLinearGradient(farX, 0, keyX, 0);
          gSp.addColorStop(0, 'rgba(' + am[0] + ',' + am[1] + ',' + am[2] + ',' + (0.30 * s.spill).toFixed(3) + ')');
          gSp.addColorStop(1, 'rgba(' + am[0] + ',' + am[1] + ',' + am[2] + ',' + (0.10 * s.spill).toFixed(3) + ')');
          lc.fillStyle = gSp; lc.fillRect(0, 0, cw, ch);
        }
        lc.globalCompositeOperation = 'source-over';
        src = this._litCanvas;
      }
      const r = this.personRect(cw, ch);
      ctx.save();
      let fstr = filterString || 'none';
      if (this.state.subjectLift > 0.01 && this._fxOn) {
        this._updateSubjectLift(personCanvas, cw, ch, (typeof performance !== 'undefined' ? performance.now() : Date.now()));
        if (this._slGain > 1.02) fstr = (fstr === 'none' ? '' : fstr + ' ') + 'brightness(' + this._slGain.toFixed(2) + ')';
      }
      ctx.filter = fstr;
      const cor = this.seatCorridor(cw, ch);
      if (cor) { ctx.save(); ctx.beginPath(); ctx.moveTo(cor[0][0], cor[0][1]); for (let i = 1; i < cor.length; i++) ctx.lineTo(cor[i][0], cor[i][1]); ctx.closePath(); ctx.clip(); }
      ctx.drawImage(this._tight && this.state.seat ? this._fadedBottom(src, cw, ch) : src, r.dx, r.dy, r.dw, r.dh);
      if (cor) ctx.restore();
      ctx.restore();
    }

    /**
     * Faint, blurred reflection of the person on the desk surface (mirror about the desk's back edge,
     * fading out over the desk-top depth). Drawn AFTER the occluder so it sits on the desk. Quarter resolution.
     */
    drawDeskReflection(ctx, personCanvas, cw, ch) {
      const k = this.state.reflection;
      if (k < 0.02 || !this.state.deskOn) return;
      const sw = Math.max(8, cw >> 2), sh = Math.max(8, ch >> 2);
      if (!this._reflCanvas) this._reflCanvas = scratchCanvas(sw, sh);
      if (this._reflCanvas.width !== sw || this._reflCanvas.height !== sh) { this._reflCanvas.width = sw; this._reflCanvas.height = sh; }
      const rc = this._reflCanvas.getContext('2d');
      const r = this.personRect(sw, sh);
      const L = deskLineY(0.5, this.state) * sh;              // mirror line (desk back edge, middle)
      const fade = 0.10 * sh;                                  // visible depth of the desk top
      rc.globalCompositeOperation = 'source-over';
      rc.clearRect(0, 0, sw, sh);
      rc.save();
      rc.filter = 'blur(1.6px)';
      rc.translate(0, 2 * L); rc.scale(1, -1);                 // mirror about y = L
      rc.drawImage(personCanvas, r.dx, r.dy, r.dw, r.dh);
      rc.restore();
      rc.filter = 'none';
      rc.globalCompositeOperation = 'destination-in';
      const g = rc.createLinearGradient(0, L, 0, L + fade);
      g.addColorStop(0, 'rgba(0,0,0,1)'); g.addColorStop(1, 'rgba(0,0,0,0)');
      rc.fillStyle = g; rc.fillRect(0, L, sw, fade);           // keep only L..L+fade, fading out
      rc.globalCompositeOperation = 'source-over';
      ctx.save();
      ctx.globalAlpha = 0.45 * k;
      ctx.drawImage(this._reflCanvas, 0, 0, cw, ch);
      ctx.restore();
    }

    /** Bloom (soft glow on bright lights) + vignette (lens falloff). Both cached; the picture is static. */
    drawGrade(ctx, env, cw, ch, envKey) {
      const s = this.state;
      if (s.bloom > 0.02 && env) {
        const bw = Math.max(16, cw >> 3), bh = Math.max(9, ch >> 3);
        const sig = envKey + '|' + bw;
        if (sig !== this._sigBloom || !this._bloomCanvas) {
          this._sigBloom = sig;
          if (!this._bloomCanvas) this._bloomCanvas = scratchCanvas(bw, bh);
          this._bloomCanvas.width = bw; this._bloomCanvas.height = bh;
          const bc = this._bloomCanvas.getContext('2d');
          bc.clearRect(0, 0, bw, bh);
          bc.filter = 'brightness(0.55) contrast(3.2) blur(2px)';   // keeps only the bright parts, then blurs them
          bc.drawImage(env, 0, 0, bw, bh);
          bc.filter = 'none';
        }
        ctx.save();
        ctx.globalCompositeOperation = 'screen';
        ctx.globalAlpha = Math.min(1, 0.7 * s.bloom);
        ctx.drawImage(this._bloomCanvas, 0, 0, cw, ch);
        ctx.restore();
      }
      if (s.vignette > 0.02) {
        const sig = cw + 'x' + ch;
        if (sig !== this._sigVig || !this._vigCanvas) {
          this._sigVig = sig;
          if (!this._vigCanvas) this._vigCanvas = scratchCanvas(cw, ch);
          this._vigCanvas.width = cw; this._vigCanvas.height = ch;
          const vc = this._vigCanvas.getContext('2d');
          const g = vc.createRadialGradient(cw / 2, ch / 2, Math.min(cw, ch) * 0.35, cw / 2, ch / 2, Math.hypot(cw, ch) * 0.58);
          g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, 'rgba(0,0,0,0.55)');
          vc.clearRect(0, 0, cw, ch); vc.fillStyle = g; vc.fillRect(0, 0, cw, ch);
        }
        ctx.save(); ctx.globalAlpha = Math.min(1, s.vignette * 1.1); ctx.drawImage(this._vigCanvas, 0, 0, cw, ch); ctx.restore();
      }
    }

    /**
     * Level 3 seating: sofa arms (and any other side furniture listed in seat.arms) are drawn IN FRONT of the presenter, cut from the crisp
     * scene picture with a feathered rectangle, so a shoulder or elbow that drifts past the sofa's inner edge tucks behind the arm instead of floating over it.
     * Cached per picture + arms; one drawImage per frame.
     */
    /**
     * Level 3 auto-fit: scale + move the presenter so THEIR head lands on the seat guide's head oval, whatever distance they sit at.
     * Pure geometry on the mask silhouette (bounds.headW/headCx/minY) - no extra model. Smoothed, with a dead-band and an outlier gate
     * (a raised hand or a cough must not yank the picture). Returns the raw wanted scale so callers can tell "too close"/"too far".
     */
    updateSeatFit(bounds, cw, ch) {
      const g = this.state.seat && this.state.seat.guide;
      if (!g || !bounds || !(bounds.headW > 0)) return;
      if (this._fitFreeze) { this._updateTight(cw, ch); return; }   // unsupported pose (turned, leaning, ...): hold the last good fit so the picture does not swim
      const hwCam = bounds.headW / cw;
      const raw = (2 * g.headRx) / Math.max(0.02, hwCam);
      this._fitRaw = raw;
      const s = clamp(raw, 0.45, 1.25);
      const dw = s * cw, dh = s * ch;
      const px = (g.headX * cw - (cw - dw) / 2 - (bounds.headCx / cw) * dw) / cw;
      // vertical range is wide on purpose: a sofa-scale guide (head ~26% of the picture) needs a 1 m selfie scaled to ~0.6x AND lifted by ~0.3 of the frame; the old -0.12 clamp left the head ~17% too low
      const py = clamp(((g.headY - g.headRy) * ch - (ch - dh) - ((bounds.headTop !== undefined ? bounds.headTop : bounds.minY) / ch) * dh) / ch, -0.5, 0.3);
      const t = { s, x: clamp(px, -0.35, 0.35), y: py };
      if (!this._fit) { this._fit = t; this._fitOut = 0; this._updateTight(cw, ch); return; }
      const f = this._fit;
      const far = Math.abs(t.s - f.s) > 0.25 || Math.abs(t.x - f.x) > 0.2;
      if (far && this._fitOut < 4) { this._fitOut++; return; }   // outlier: ignore a few samples, then accept (a real move)
      this._fitOut = 0;
      const k = far ? 0.5 : 0.12;
      if (Math.abs(t.s - f.s) > 0.008) f.s += (t.s - f.s) * k;
      if (Math.abs(t.x - f.x) > 0.004) f.x += (t.x - f.x) * k;
      if (Math.abs(t.y - f.y) > 0.004) f.y += (t.y - f.y) * k;
      this._updateTight(cw, ch);
    }

    /** Pose gate hook (render-core): true while the presenter's pose is unsupported, so the fit stops following them. */
    setFitFreeze(v) { this._fitFreeze = !!v; }

    /**
     * 'Tight' = after fitting the head to the guide, the bottom edge of the camera frame ends ABOVE the table line, so the presenter's cut-off
     * edge would float in front of the sofa (the phone is too close: it sees only head and shoulders). Hysteresis stops flicker at the limit.
     * While tight, drawPerson fades the bottom of the presenter instead of showing a hard cut, and the guide asks the person to move back.
     */
    _updateTight(cw, ch) {
      if (!this._fit || !this.state.deskOn) { this._tight = false; return; }
      this._tight = !!this._tight;
      const r = this.personRect(cw, ch), line = deskLineY(0.5, this.state) * ch, bottom = r.dy + r.dh;
      this._tightGap = (line - bottom) / ch;
      if (this._tight) { if (bottom >= line + 0.01 * ch) this._tight = false; } else if (bottom < line - 0.004 * ch) this._tight = true;
    }

    /** Presenter picture with its bottom 26% faded to transparent (used only while 'tight'). Same size as the source. */
    _fadedBottom(src, cw, ch) {
      if (!this._fadeCanvas) this._fadeCanvas = scratchCanvas(cw, ch);
      if (this._fadeCanvas.width !== cw || this._fadeCanvas.height !== ch) { this._fadeCanvas.width = cw; this._fadeCanvas.height = ch; }
      const c = this._fadeCanvas.getContext('2d');
      c.globalCompositeOperation = 'source-over'; c.clearRect(0, 0, cw, ch); c.drawImage(src, 0, 0, cw, ch);
      c.globalCompositeOperation = 'destination-in';
      const g = c.createLinearGradient(0, 0, 0, ch); g.addColorStop(0, 'rgba(0,0,0,1)'); g.addColorStop(0.74, 'rgba(0,0,0,1)'); g.addColorStop(1, 'rgba(0,0,0,0)');
      c.fillStyle = g; c.fillRect(0, 0, cw, ch);
      c.globalCompositeOperation = 'source-over';
      return this._fadeCanvas;
    }

    /** 'dim' while the under-exposure rescue is working hard (the room is too dark in front of the presenter), else 'ok'. */
    seatLight() { return this._slGain > 1.25 ? 'dim' : 'ok'; }

    /**
     * Head width/centre from per-row silhouette extents (pure function, shared with the unit tests and render-core).
     * Walk down from the crown; the head ends where the width narrows below 78% of its widest row (chin/neck) or steps out by >35% (the shoulders). Face-only framing does neither: widest row = face.
     */
    static headMetrics(rowMin, rowMax, minY, maxY, minW) {
      let hw = 0, hCx = 0, rows = 0, top = -1;
      const floorW = minW === undefined ? 3 : minW;   // rows narrower than this are mask speckle (found on real data), not the head
      for (let y = minY; y <= maxY; y++) {
        const w = rowMax[y] >= rowMin[y] ? rowMax[y] - rowMin[y] + 1 : 0;
        if (w < floorW) continue;
        if (top < 0) top = y;
        if (rows >= 3 && hw >= 5 && w < hw * 0.78) break;   // v0.40: the chin/neck - the mask narrows after the widest row of the head, so the head is over (a slow shoulder slope never makes a 35% step at 64x36)
        if (rows >= 3 && hw > 0 && w > hw * 1.35) break;
        if (w > hw) { hw = w; hCx = (rowMin[y] + rowMax[y] + 1) / 2; }
        rows++;
      }
      return { hw, hCx, top: top < 0 ? minY : top };
    }

    /** Gain (>=1) that rescues an underexposed subject. luma 0..1 mean of the presenter's pixels. No-op above 0.2 so normal light and complexion are untouched. */
    static subjectLiftGain(luma, strength) {
      const floor = 0.30, trigger = 0.27;
      if (!(luma > 0.01) || luma >= trigger || !(strength > 0)) return 1;
      return 1 + (Math.min(1.7, floor / luma) - 1) * Math.min(1, strength);
    }

    _updateSubjectLift(personCanvas, cw, ch, now) {
      if (this._slAt !== undefined && now - this._slAt < 400) return;
      this._slAt = now;
      try {
        if (!this._slScratch) this._slScratch = scratchCanvas(24, 24);
        const c = this._slScratch.getContext('2d', { willReadFrequently: true });
        c.clearRect(0, 0, 24, 24); c.drawImage(personCanvas, 0, 0, cw, ch, 0, 0, 24, 24);
        const p = c.getImageData(0, 0, 24, 24).data; let y = 0, n = 0;
        for (let i = 0; i < p.length; i += 4) if (p[i + 3] > 200) { y += 0.2126 * p[i] + 0.7152 * p[i + 1] + 0.0722 * p[i + 2]; n++; }
        if (n < 12) return;
        const gain = SceneEngine.subjectLiftGain(y / n / 255, this.state.subjectLift);
        this._slGain = (this._slGain || 1) + (gain - (this._slGain || 1)) * 0.3;
      } catch (e) { /* keep last gain */ }
    }

    /**
     * Level 3 chair removal: anything the segmenter kept OUTSIDE the body corridor around the guide (a chair back, a chair arm, a wall corner) is
     * not part of a person sitting upright, so the presenter is clipped to a generous trapezoid (1.7x the shoulders at the top, 2.1x at the bottom).
     * Returns the Path2D-less description so drawPerson can clip with plain canvas calls.
     */
    seatCorridor(cw, ch) {
      const g = this.state.seat && this.state.seat.guide;
      if (!g || this.state.seatClip === 0) return null;
      const top = Math.max(0, (g.headY - g.headRy * 1.4)) * ch, mid = g.shoulderY * ch;
      const hwTop = Math.max(g.headRx * 2.4, g.shoulderHalfW * 1.0) * cw, hwShoulder = g.shoulderHalfW * 1.7 * cw, hwBottom = g.shoulderHalfW * 2.1 * cw, cx = g.headX * cw;
      return [[cx - hwTop, 0], [cx + hwTop, 0], [cx + hwTop, top], [cx + hwShoulder, mid], [cx + hwBottom, ch], [cx - hwBottom, ch], [cx - hwShoulder, mid], [cx - hwTop, top]];
    }

    /**
     * Level 3 live alignment: where the presenter's head is, compared with the seat guide. Returns 'ok' | 'left' | 'right' | 'high' | 'low' | 'none'
     * ('left'/'right' = the direction the PERSON should move on screen). Needs mask bounds in camera-frame pixels.
     */
    seatAlignment(bounds, cw, ch) {
      const g = this.state.seat && this.state.seat.guide;
      if (!g || !bounds || !(bounds.maxX > bounds.minX)) return 'none';
      const r = this.personRect(cw, ch);
      const hx = (r.dx + ((bounds.minX + bounds.maxX) / 2 / cw) * r.dw) / cw;
      const top = (r.dy + ((bounds.headTop !== undefined ? bounds.headTop : bounds.minY) / ch) * r.dh) / ch;
      const want = g.headY - g.headRy;
      if (this._fitRaw > 1.25) return 'closer';
      if (this._fitRaw < 0.45) return 'back';
      if (this._tight) return 'tight';
      if (hx < g.headX - 0.07) return 'right';
      if (hx > g.headX + 0.07) return 'left';
      if (top < want - 0.07) return 'low';
      if (top > want + 0.07) return 'high';
      return 'ok';
    }

    drawSeat(ctx, env, cw, ch, envKey) {
      const seat = this.state.seat;
      if (!seat || !Array.isArray(seat.arms) || !seat.arms.length || !env) return;
      const sig = envKey + this._wallSig + '|' + cw + 'x' + ch + '|' + JSON.stringify(seat.arms);
      if (sig !== this._sigSeat || !this._seatCanvas) {
        this._sigSeat = sig;
        if (!this._seatCanvas) this._seatCanvas = scratchCanvas(cw, ch);
        this._seatCanvas.width = cw; this._seatCanvas.height = ch;
        if (!this._seatMask) this._seatMask = scratchCanvas(cw, ch);
        this._seatMask.width = cw; this._seatMask.height = ch;
        const mc = this._seatMask.getContext('2d');
        mc.clearRect(0, 0, cw, ch);
        mc.fillStyle = '#fff';
        for (const a of seat.arms) {
          const f = Math.max(0, Number(a.feather) || 0) * (ch / 720);
          mc.filter = f > 0.3 ? 'blur(' + f.toFixed(1) + 'px)' : 'none';
          mc.fillRect(a.x0 * cw, a.y0 * ch, (a.x1 - a.x0) * cw, ((a.y1 === undefined ? 1 : a.y1) - a.y0) * ch);
        }
        mc.filter = 'none';
        const sc = this._seatCanvas.getContext('2d');
        sc.globalCompositeOperation = 'source-over';
        sc.clearRect(0, 0, cw, ch);
        sc.drawImage(env, 0, 0, cw, ch);
        sc.globalCompositeOperation = 'destination-in';
        sc.drawImage(this._seatMask, 0, 0);
        sc.globalCompositeOperation = 'source-over';
      }
      ctx.drawImage(this._seatCanvas, 0, 0, cw, ch);
    }

    drawOccluder(ctx, cw, ch) {
      if (this.state.deskOn && this._occCanvas && this._sigOcc) ctx.drawImage(this._occCanvas, 0, 0, cw, ch);
    }
  }

  /** Applies a patch to a plain settings object using the same typing rules as setState. */
  SceneEngine.applyPatch = function (st, patch) {
    for (const k of Object.keys(DEFAULTS)) {
      if (patch[k] === undefined) continue;
      st[k] = typeof DEFAULTS[k] === 'boolean' ? !!patch[k] : (typeof DEFAULTS[k] === 'number' ? Number(patch[k]) : patch[k]);
    }
    return st;
  };
  SceneEngine.DEFAULTS = DEFAULTS;
  SceneEngine.PRESETS = PRESETS;
  SceneEngine.deskLineY = deskLineY;
  SceneEngine.SHOULDER_LINE = SHOULDER_LINE;
  SceneEngine.CHEST_LINE = 0.86;
  SceneEngine.parallaxTarget = parallaxTarget;
  SceneEngine.DUST = DUST;
  SceneEngine.CHEST_LINE = 0.86;
  SceneEngine.parallaxTarget = parallaxTarget;
  SceneEngine.DUST = DUST;   // seats the person so head, shoulders and upper chest show above the desk (library scenes, wizard)
  SceneEngine.buildOccluderAlpha = buildOccluderAlpha;
  SceneEngine.seatSummary = function (seat) { return seat && seat.type ? { type: seat.type, supports: String(seat.supports || ''), guide: seat.guide || null, arms: (seat.arms || []).length } : null; };
  SceneEngine.analyzeLight = analyzeLight;
  SceneEngine.scenePrompt = scenePrompt;

  globalThis.VS = globalThis.VS || {};
  globalThis.VS.SceneEngine = SceneEngine;

  // Library scenes (scene.json) become tuned presets. Main thread only: the worker receives settings by message.
  try {
    const V = globalThis.VS;
    if (V.SceneMeta && V.SCENE_LIBRARY) {
      V.SceneMeta.loadLibrary(V.SCENE_LIBRARY).scenes.forEach((m) => { const st = V.SceneMeta.toEngineState(m); delete st.enabled; PRESETS[m.id] = st; });
    }
  } catch (e) { /* library problems must never break the engine */ }
})();
