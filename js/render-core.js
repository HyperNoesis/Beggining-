/**
 * Render core — the shared compositing pipeline (mask refinement, realism
 * engine, background/layout compositing, overlays, watermark, annotations)
 * used from TWO different callers:
 *
 *  1. render-worker.js (the default path): runs this off the main thread,
 *     drawing into an OffscreenCanvas transferred from the visible <canvas>.
 *
 *  2. app.js's main-thread compatibility fallback (Settings → Preview
 *     rendering → Compatibility mode, or auto-selected when Worker/
 *     OffscreenCanvas aren't available at all).
 *
 * This file is the single source of truth for the drawing logic so those
 * two paths can never quietly drift apart. `notify(msg)` is how it reports
 * back ('frameDone' / 'error') — the worker wires that to self.postMessage;
 * the main-thread fallback wires it to a plain callback and gets the call
 * synchronously, in the same tick, no round trip.
 */

function createRenderCore(notify) {
const maskRefiner = new self.VS.MaskRefiner();
const realismEngine = new self.VS.RealismEngine();
// GPU sharp-edge matte stage (optional: null/!ok -> legacy canvas path below keeps working).
let glMatte = null;
try { glMatte = self.VS.GLMatte ? new self.VS.GLMatte() : null; } catch (e) { glMatte = null; }
let matteMode = 'gl'; // 'gl' | 'legacy'
// Studio Scene mode (desk occluder, placement, key light, shadow). Off unless the user enables it.
let sceneEngine = null;
try { sceneEngine = self.VS.SceneEngine ? new self.VS.SceneEngine() : null; } catch (e) { sceneEngine = null; }

function createScratchCanvas(width, height) {
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(width, height);
  if (typeof document !== 'undefined') {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    return canvas;
  }
  throw new Error('This browser cannot create a rendering canvas.');
}

let outCanvas = null, outCtx = null;
let assetsBase = null;
let w = 0, h = 0;

// Working buffers — mirrors the set that used to live on the main thread in
// app.js, just as OffscreenCanvas instead of <canvas>.
const personCanvas = createScratchCanvas(1, 1);
const personCtx = personCanvas.getContext('2d');
const maskRawCanvas = createScratchCanvas(1, 1);
const maskRawCtx = maskRawCanvas.getContext('2d');
const maskFinalCanvas = createScratchCanvas(1, 1);
const maskFinalCtx = maskFinalCanvas.getContext('2d');
const sceneOffCanvas = createScratchCanvas(1, 1);
const sceneOffCtx = sceneOffCanvas.getContext('2d');
const sceneOnCanvas = createScratchCanvas(1, 1);
const sceneOnCtx = sceneOnCanvas.getContext('2d');
const boundsScratch = createScratchCanvas(1, 1);
const boundsCtx = boundsScratch.getContext('2d', { willReadFrequently: true });
let cachedBounds = null, boundsCounter = 0, lastSeatAlign = 'none';
// v0.40 pose gate (js/providers/pose-gate.js): silhouette-based "is the presenter in a pose this seated scene supports". Costs nothing extra: it reuses the 64x36 mask pass below.
let seatPoseWanted = false, lastSeatPose = { status: 'ok', raw: 'ok', dbg: '' }, lastPoseStamp = -1, seatLight = 'ok';
let poseDeb = null;

// Environment bitmaps. Built-ins are fetched by this worker itself (by
// filename convention — see ensureBuiltinLoading); custom/generated ones
// arrive as a transferred bitmap from the main thread, since only the main
// thread has access to the uploaded <img>/localStorage-persisted data.
const builtinBitmaps = new Map();
const customBitmaps = new Map();
const builtinLoadAttempted = new Set();
let currentEnvId = null;

let watermarkBitmap = null;
let watermarkOn = false;

// Content overlays — static image insets (slide/photo/screenshot) baked
// into the composite, same pattern as the watermark below. Not a live
// screen-share: each is one bitmap, redrawn every frame at a fixed
// corner/size until replaced. Free — canvas drawImage, no new dependency.
// A Map (not a single value) so multiple overlays can be shown at once —
// insertion order = stacking/z-order, and overlays sharing a corner stack
// instead of overlapping (see drawContentOverlays).
const overlays = new Map(); // id -> { bitmap, corner, scale, on }
function getOrCreateOverlay(id) {
  if (!overlays.has(id)) overlays.set(id, { slides: [], index: 0, corner: 'top-right', scale: 0.34, on: false });
  return overlays.get(id);
}
/** Current slide's bitmap for an overlay, or null if it has none yet. */
function currentSlide(ov) {
  if (!ov || !ov.slides.length) return null;
  return ov.slides[Math.min(ov.index, ov.slides.length - 1)];
}

// Layout mode — changes how the FIRST enabled overlay (the "primary") is
// composited, beyond a plain corner inset. Other overlays keep stacking as
// corner insets regardless of mode. 'default' = existing corner-inset
// behavior, untouched.
let layoutMode = 'default'; // 'default' | 'sidebyside' | 'bubble' | 'cutout'

// Live pointer/annotation — drawn straight into the composite (baked into
// recording/live, same as content overlays), not a separate DOM layer.
// 'draw' mode accumulates persistent strokes until cleared; 'pointer' mode
// (a laser dot) holds exactly one transient point that vanishes on
// pointerup — nothing to store once the presenter lets go. Coordinates
// arrive in output-canvas pixel space, so a resize (aspect/zoom change)
// invalidates them; resize() below clears both rather than draw stretched.
const annotateStrokes = []; // [{ color, points:[{x,y}] }]
let annotateCurrentStroke = null;
let annotatePointer = null; // { x, y, color } | null
function drawAnnotations(ctx, cw, ch) {
  if (!annotateStrokes.length && !annotatePointer) return;
  ctx.save();
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.lineWidth = Math.max(2, cw * 0.006);
  annotateStrokes.forEach((s) => {
    if (s.points.length < 2) return;
    ctx.strokeStyle = s.color;
    ctx.beginPath();
    ctx.moveTo(s.points[0].x, s.points[0].y);
    for (let i = 1; i < s.points.length; i++) ctx.lineTo(s.points[i].x, s.points[i].y);
    ctx.stroke();
  });
  if (annotatePointer) {
    ctx.fillStyle = annotatePointer.color;
    ctx.shadowColor = annotatePointer.color;
    ctx.shadowBlur = cw * 0.02;
    ctx.beginPath();
    ctx.arc(annotatePointer.x, annotatePointer.y, Math.max(4, cw * 0.012), 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}
function getPrimaryOverlay() {
  for (const ov of overlays.values()) {
    if (ov.on && currentSlide(ov)) return ov;
  }
  return null;
}

function resize(nw, nh) {
  w = nw; h = nh;
  [outCanvas, personCanvas, maskRawCanvas, maskFinalCanvas, sceneOffCanvas, sceneOnCanvas].forEach(c => {
    if (c) { c.width = w; c.height = h; }
  });
  maskRefiner.resize(w, h);
  if (glMatte && glMatte.ok) glMatte.resize(w, h);
  cachedBounds = null;
  // Stored annotation coordinates are in the old pixel space — clear
  // rather than let them draw stretched/misplaced at the new size.
  annotateStrokes.length = 0;
  annotateCurrentStroke = null;
  annotatePointer = null;
}

function ensureBuiltinLoading(id) {
  if (!id || builtinLoadAttempted.has(id) || builtinBitmaps.has(id) || !assetsBase) return;
  builtinLoadAttempted.add(id);
  // Built-ins are named by convention: assets/environments/<id>.jpg — every
  // current built-in follows this, see BUILT_IN_ENVIRONMENTS in
  // environment-provider.js. If a fetch 404s, this id is assumed to be a
  // custom/generated environment instead, whose bitmap arrives by message.
  fetch(new URL(`assets/environments/${id}.jpg`, assetsBase).href)
    .then((res) => { if (!res.ok) throw new Error('not a built-in'); return res.blob(); })
    .then((blob) => createImageBitmap(blob))
    .then((bitmap) => { builtinBitmaps.set(id, bitmap); })
    .catch(() => { /* not a built-in — expected for custom/generated ids */ });
}

// Optional foreground layer of a scene (PNG with alpha, drawn in front of the presenter), by convention assets/environments/<id>-fg.png.
const sceneFgBitmaps = new Map();   // id -> ImageBitmap | null (null = none / failed)
function ensureSceneFg(id) {
  if (!id || sceneFgBitmaps.has(id) || !assetsBase) return;
  sceneFgBitmaps.set(id, null);
  if (id.indexOf('scene-') !== 0) return;       // only library scenes can have one: no 404 noise for custom pictures
  fetch(new URL(`assets/environments/${id}-fg.png`, assetsBase).href)
    .then((res) => { if (!res.ok) throw new Error('no fg'); return res.blob(); })
    .then((blob) => createImageBitmap(blob))
    .then((bmp) => { sceneFgBitmaps.set(id, bmp); })
    .catch(() => { /* no foreground layer for this scene: fine */ });
}

// Depth map of a library scene (8-bit PNG, 255 = near), assets/environments/<id>-depth.png. Without it the engine uses an estimated ramp.
const sceneDepthState = new Map();   // id -> 'loading' | 'done'
function ensureSceneDepth(id) {
  if (!id || sceneDepthState.has(id) || !assetsBase) return;
  sceneDepthState.set(id, 'loading');
  if (id.indexOf('scene-') !== 0) return;
  fetch(new URL(`assets/environments/${id}-depth.png`, assetsBase).href)
    .then((res) => { if (!res.ok) throw new Error('no depth'); return res.blob(); })
    .then((blob) => createImageBitmap(blob))
    .then((bmp) => { sceneDepthState.set(id, 'done'); sceneEngine.setDepth(id, bmp); })
    .catch(() => { /* no depth map: estimated ramp is used */ });
}

// ---- v0.31 colour grade + skin smoothing + auto-framing box (js/grade-core.js, UI in js/grade-ui.js)
const gradeState = { filter: 'none', tint: null, skin: 0, auto: false, assistB: 1, assistTint: null, lut: null, lutAmount: 1 };
function personFilter(applyRealism) {
  const r = applyRealism ? realismEngine.personFilterString() : 'none';
  let g = gradeState.filter;
  if (Math.abs(gradeState.assistB - 1) > 0.004) g = (g === 'none' ? '' : g + ' ') + 'brightness(' + gradeState.assistB.toFixed(3) + ')';
  if (!g) g = 'none';
  return g === 'none' ? r : r === 'none' ? g : g + ' ' + r;
}
const skinSmall = createScratchCanvas(160, 90), skinSmallCtx = skinSmall.getContext('2d', { willReadFrequently: true });
const skinMaskCv = createScratchCanvas(160, 90), skinMaskCtx = skinMaskCv.getContext('2d');
const skinHalf = createScratchCanvas(2, 2), skinHalfCtx = skinHalf.getContext('2d');
let gradeFrame = 0, skinImg = null;
const lutCv = createScratchCanvas(2, 2), lutCtx = lutCv.getContext('2d', { willReadFrequently: true });
function applyPersonGrade() {
  gradeFrame++;
  if (gradeState.tint) {                                   // tint only the person's own pixels
    personCtx.save(); personCtx.globalCompositeOperation = 'source-atop'; personCtx.globalAlpha = gradeState.tint.alpha; personCtx.fillStyle = gradeState.tint.color; personCtx.fillRect(0, 0, w, h); personCtx.restore();
  }
  if (gradeState.assistTint) {                             // auto white balance: second, gentle tint on the person only
    personCtx.save(); personCtx.globalCompositeOperation = 'source-atop'; personCtx.globalAlpha = gradeState.assistTint.alpha; personCtx.fillStyle = gradeState.assistTint.color; personCtx.fillRect(0, 0, w, h); personCtx.restore();
  }
  const GC = self.VS.GradeCore;
  if (gradeState.lut && gradeState.lutAmount > 0 && GC && GC.applyLut) {   // .cube LUT on the person, at reduced size for speed (person-only)
    try {
      const lw = Math.min(w, 640), lh = Math.max(1, Math.round(h * lw / w));
      if (lutCv.width !== lw || lutCv.height !== lh) { lutCv.width = lw; lutCv.height = lh; }
      lutCtx.clearRect(0, 0, lw, lh); lutCtx.drawImage(personCanvas, 0, 0, lw, lh);
      const id = lutCtx.getImageData(0, 0, lw, lh); GC.applyLut(id.data, gradeState.lut, 1); lutCtx.putImageData(id, 0, 0);
      personCtx.save(); personCtx.globalCompositeOperation = 'source-atop'; personCtx.globalAlpha = Math.min(1, gradeState.lutAmount); personCtx.drawImage(lutCv, 0, 0, w, h); personCtx.restore();
    } catch (e) { gradeState.lut = null; notify({ type: 'gradeStatus', error: 'LUT: ' + String(e && e.message || e) }); }
  }
  if (gradeState.skin > 0 && GC) {
    try {
      if (gradeFrame % 3 === 1 || !skinImg) {                // skin mask at 160x90, refreshed every 3rd frame
        skinSmallCtx.clearRect(0, 0, 160, 90); skinSmallCtx.drawImage(personCanvas, 0, 0, 160, 90);
        const src = skinSmallCtx.getImageData(0, 0, 160, 90); skinImg = skinImg || skinMaskCtx.createImageData(160, 90);
        GC.skinMask(src.data, skinImg.data, 160, 90); skinMaskCtx.putImageData(skinImg, 0, 0);
      }
      const hw = Math.max(2, w >> 1), hh = Math.max(2, h >> 1);
      if (skinHalf.width !== hw || skinHalf.height !== hh) { skinHalf.width = hw; skinHalf.height = hh; }
      skinHalfCtx.save(); skinHalfCtx.globalCompositeOperation = 'copy'; skinHalfCtx.filter = 'blur(' + Math.max(1.5, w / 400).toFixed(1) + 'px)'; skinHalfCtx.drawImage(personCanvas, 0, 0, hw, hh); skinHalfCtx.restore();
      skinHalfCtx.save(); skinHalfCtx.filter = 'blur(1.5px)'; skinHalfCtx.globalCompositeOperation = 'destination-in'; skinHalfCtx.drawImage(skinMaskCv, 0, 0, hw, hh); skinHalfCtx.restore();   // keep only skin
      skinHalfCtx.save(); skinHalfCtx.globalCompositeOperation = 'destination-in'; skinHalfCtx.drawImage(personCanvas, 0, 0, hw, hh); skinHalfCtx.restore();                                // and never outside the silhouette
      personCtx.save(); personCtx.globalAlpha = Math.min(0.75, gradeState.skin * 0.75); personCtx.drawImage(skinHalf, 0, 0, w, h); personCtx.restore();
    } catch (e) { gradeState.skin = 0; notify({ type: 'gradeStatus', error: String(e && e.message || e) }); }
  }
}

function computeMaskBounds(maskCanvas, mw, mh) {
  boundsCounter++;
  if (boundsCounter % 5 !== 0 && boundsCounter > 1) return cachedBounds;
  const sw = 64, sh = Math.max(1, Math.round(64 * mh / mw));
  boundsScratch.width = sw; boundsScratch.height = sh;
  boundsCtx.clearRect(0, 0, sw, sh);
  boundsCtx.drawImage(maskCanvas, 0, 0, sw, sh);
  let data;
  try { data = boundsCtx.getImageData(0, 0, sw, sh).data; } catch (e) { return cachedBounds; }
  let minX = sw, minY = sh, maxX = 0, maxY = 0, found = false;
  const rowMin = new Array(sh).fill(sw), rowMax = new Array(sh).fill(-1);
  for (let y = 0; y < sh; y++) {
    for (let x = 0; x < sw; x++) {
      const a = data[(y * sw + x) * 4 + 3];
      if (a > 20) { found = true; if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y; if (x < rowMin[y]) rowMin[y] = x; if (x > rowMax[y]) rowMax[y] = x; }
    }
  }
  if (!found) { cachedBounds = null; return cachedBounds; }
  // Head metrics from the silhouette: walk down from the crown; the head ends where the width steps out by >35% (the shoulders).
  // If no step is found (face-only framing) the widest row is the face. Used by the seat auto-fit; costs nothing extra (same pass).
  const hm = (self.VS && self.VS.SceneEngine && self.VS.SceneEngine.headMetrics) ? self.VS.SceneEngine.headMetrics(rowMin, rowMax, minY, maxY) : { hw: 0, hCx: (minX + maxX) / 2, top: minY };
  const hw = hm.hw, hCx = hm.hCx || (minX + maxX) / 2;
  const kx = mw / sw, ky = mh / sh;
  cachedBounds = { minX: minX * kx, maxX: maxX * kx, minY: minY * ky, maxY: maxY * ky, headW: hw * kx, headCx: hCx * kx, headTop: (hm.top !== undefined ? hm.top : minY) * ky, stamp: boundsCounter };
  const PG = self.VS && self.VS.PoseGate;
  if (seatPoseWanted && PG) {
    try { const f = PG.features(rowMin, rowMax, minY, maxY, hm, PG.blobAreas(data, sw, sh, 20)), c = PG.classify(f); cachedBounds.pose = c.status; cachedBounds.poseDbg = PG.describe(f, c); } catch (e) { /* the gate must never break a frame */ }
  }
  return cachedBounds;
}

function drawEnvironment(ctx, cw, ch) {
  const bmp = builtinBitmaps.get(currentEnvId) || customBitmaps.get(currentEnvId);
  if (bmp) { ctx.drawImage(bmp, 0, 0, cw, ch); return; }
  ensureBuiltinLoading(currentEnvId);
  // Not resolved yet (first frame or a custom bitmap still in flight from the
  // main thread) — a neutral placeholder for this one frame; self-heals the
  // instant the real bitmap lands, same as the old main-thread gradient fallback.
  const grad = ctx.createLinearGradient(0, 0, 0, ch);
  grad.addColorStop(0, '#22232b');
  grad.addColorStop(1, '#0c0c0f');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, cw, ch);
}

// v0.13 broadcast graphics (lower thirds, ticker, clock, LIVE tag): the main thread draws them into a transparent
// bitmap (js/graphics.js) and sends it here; this just stretches it over the finished frame. Part of the output,
// so it IS recorded and streamed (unlike the teleprompter).
let graphicsBitmap = null;
function drawGraphics(targetCtx, cw, ch) {
  if (!graphicsBitmap) return;
  try { targetCtx.drawImage(graphicsBitmap, 0, 0, cw, ch); } catch (e) { /* closed bitmap: skip this frame */ }
}

function drawWatermark(targetCtx, cw, ch) {
  if (!watermarkOn || !watermarkBitmap) return;
  const targetW = cw * 0.14;
  const scale = targetW / watermarkBitmap.width;
  const targetH = watermarkBitmap.height * scale;
  const pad = cw * 0.025;
  targetCtx.save();
  targetCtx.globalAlpha = 0.88;
  targetCtx.drawImage(watermarkBitmap, cw - targetW - pad, ch - targetH - pad, targetW, targetH);
  targetCtx.restore();
}

function drawContentOverlays(targetCtx, cw, ch, skip) {
  if (!overlays.size) return;
  const pad = cw * 0.03;
  const gap = cw * 0.02;
  // Per-corner running offset so overlays sharing a corner stack instead of
  // drawing on top of each other. Insertion order (Map preserves it) = the
  // stacking order — first-added sits closest to the corner.
  const stackOffset = { 'top-left': 0, 'top-right': 0, 'bottom-left': 0, 'bottom-right': 0 };
  overlays.forEach((ov) => {
    if (ov === skip || !ov.on) return;
    const bmp = currentSlide(ov);
    if (!bmp) return;
    const targetW = cw * ov.scale;
    const scale = targetW / bmp.width;
    const targetH = bmp.height * scale;
    const offset = stackOffset[ov.corner] || 0;
    let x, y;
    switch (ov.corner) {
      case 'top-left': x = pad; y = pad + offset; break;
      case 'bottom-right': x = cw - targetW - pad; y = ch - targetH - pad - offset; break;
      case 'bottom-left': x = pad; y = ch - targetH - pad - offset; break;
      default: x = cw - targetW - pad; y = pad + offset; // top-right
    }
    stackOffset[ov.corner] = offset + targetH + gap;

    targetCtx.save();
    // A soft drop shadow + white border, matching the "inset panel" look
    // (not just a bare image floating over the composite).
    targetCtx.shadowColor = 'rgba(0,0,0,0.45)';
    targetCtx.shadowBlur = cw * 0.015;
    targetCtx.shadowOffsetY = cw * 0.004;
    targetCtx.fillStyle = '#fff';
    const borderPad = cw * 0.006;
    targetCtx.fillRect(x - borderPad, y - borderPad, targetW + borderPad * 2, targetH + borderPad * 2);
    targetCtx.shadowColor = 'transparent';
    targetCtx.drawImage(bmp, x, y, targetW, targetH);
    targetCtx.restore();
  });
}

/**
 * mmhmm-parity layout: presenter on the left half, content filling the
 * right half. HONEST LIMIT: the realism engine's shadow/tone-match/light-
 * wrap are calibrated against the full frame (person drawn edge-to-edge at
 * cw×ch) — scaled into a half-width panel here, their bounds math would
 * misalign. So this mode keeps the color-only person filter (unaffected by
 * scale) but skips shadow/tone-match/light-wrap rather than draw them
 * wrong; grain is still applied full-frame since it's a uniform overlay,
 * not bounds-dependent.
 */
function paintSideBySide(targetCtx, cw, ch, applyRealism, primary) {
  const halfW = cw / 2;

  targetCtx.save();
  targetCtx.beginPath();
  targetCtx.rect(0, 0, halfW, ch);
  targetCtx.clip();
  drawEnvironment(targetCtx, halfW, ch);
  targetCtx.filter = personFilter(applyRealism);
  targetCtx.drawImage(personCanvas, 0, 0, halfW, ch);
  targetCtx.filter = 'none';
  targetCtx.restore();

  targetCtx.save();
  targetCtx.beginPath();
  targetCtx.rect(halfW, 0, halfW, ch);
  targetCtx.clip();
  targetCtx.drawImage(currentSlide(primary), halfW, 0, halfW, ch);
  targetCtx.restore();

  // A thin divider so the split reads as intentional, not a rendering glitch.
  targetCtx.save();
  targetCtx.fillStyle = 'rgba(255,255,255,0.14)';
  targetCtx.fillRect(halfW - 1, 0, 2, ch);
  targetCtx.restore();

  if (applyRealism) realismEngine.drawGrain(targetCtx, cw, ch);
}

/**
 * mmhmm-parity layout: content fills the whole frame, presenter shrinks to
 * a small circular bubble in the bottom-right — cropped tight around the
 * mask's actual bounding box (via computeMaskBounds) so the bubble isn't
 * mostly empty transparent space. Same honest limit as side-by-side: no
 * shadow/tone-match/light-wrap here, since those assume a full-frame
 * person, not a small cropped bubble.
 */
function drawPresenterBubble(targetCtx, cw, ch, applyRealism) {
  const bounds = computeMaskBounds(maskFinalCanvas, cw, ch);
  const size = cw * 0.3;
  const pad = cw * 0.03;
  const cx = cw - pad - size / 2;
  const cy = ch - pad - size / 2;

  // Ring behind the bubble for a clean "inset panel" look.
  targetCtx.save();
  targetCtx.beginPath();
  targetCtx.arc(cx, cy, size / 2 + pad * 0.15, 0, Math.PI * 2);
  targetCtx.fillStyle = '#fff';
  targetCtx.shadowColor = 'rgba(0,0,0,0.45)';
  targetCtx.shadowBlur = cw * 0.015;
  targetCtx.fill();
  targetCtx.restore();

  // Source crop: centered on the mask's bounding box (falls back to full
  // frame if no mask found yet, e.g. the very first frame).
  let sx = 0, sy = 0, sSize = Math.min(cw, ch);
  if (bounds) {
    const bw = bounds.maxX - bounds.minX, bh = bounds.maxY - bounds.minY;
    sSize = Math.max(bw, bh) * 1.25; // a little headroom around the person
    sx = Math.max(0, Math.min(cw - sSize, bounds.minX - (sSize - bw) / 2));
    sy = Math.max(0, Math.min(ch - sSize, bounds.minY - (sSize - bh) / 2));
  }

  targetCtx.save();
  targetCtx.beginPath();
  targetCtx.arc(cx, cy, size / 2, 0, Math.PI * 2);
  targetCtx.clip();
  targetCtx.filter = personFilter(applyRealism);
  targetCtx.drawImage(personCanvas, sx, sy, sSize, sSize, cx - size / 2, cy - size / 2, size, size);
  targetCtx.restore();
}

function paintStudioScene(targetCtx, cw, ch, applyRealism) {
  const envRaw = builtinBitmaps.get(currentEnvId) || customBitmaps.get(currentEnvId) || null;
  if (!envRaw) ensureBuiltinLoading(currentEnvId);
  const env = sceneEngine.wallEnv(envRaw, currentEnvId);   // wall colour (tap + flood fill) or the original picture
  const ready = sceneEngine.prepare(env, cw, ch, currentEnvId);
  seatPoseWanted = !!sceneEngine.state.seat;
  const bounds = computeMaskBounds(maskFinalCanvas, cw, ch);
  const nowMs = (typeof performance !== 'undefined' ? performance.now() : Date.now());
  if (seatPoseWanted) {   // pose gate: debounce the ~1-3 Hz silhouette verdicts, freeze the auto-fit while the pose is unsupported
    const PG = self.VS && self.VS.PoseGate;
    if (PG) {
      if (!poseDeb) poseDeb = new PG.Debounce(900, 600);
      if (!bounds) { poseDeb.push('ok', nowMs); lastSeatPose = { status: 'ok', raw: 'absent', dbg: 'no person found' }; }
      else if (bounds.pose && bounds.stamp !== lastPoseStamp) { lastPoseStamp = bounds.stamp; poseDeb.push(bounds.pose, nowMs); lastSeatPose = { status: poseDeb.shown, raw: bounds.pose, dbg: bounds.poseDbg || '' }; }
      sceneEngine.setFitFreeze(PG.isBad(poseDeb.shown));
    }
    seatLight = sceneEngine.seatLight();
  } else { if (poseDeb) poseDeb.reset(); sceneEngine.setFitFreeze(false); }
  ensureSceneDepth(currentEnvId);
  if (sceneEngine.state.seat) sceneEngine.updateSeatFit(bounds, cw, ch);   // Level 3: auto-fit the presenter to the seat guide BEFORE anything is drawn
  sceneEngine.update(bounds, cw, ch, nowMs, applyRealism);      // parallax smoothing; life/parallax follow the realism toggle (A/B)
  if (ready) sceneEngine.drawBackground(targetCtx, env, cw, ch);
  else drawEnvironment(targetCtx, cw, ch);
  if (ready) sceneEngine.drawLife(targetCtx, cw, ch, nowMs);
  if (applyRealism) realismEngine.sampleEnvironmentTone(targetCtx.canvas, cw, ch);
  sceneEngine.drawCastShadow(targetCtx, personCanvas, cw, ch);
  sceneEngine.drawPerson(targetCtx, personCanvas, cw, ch, applyRealism ? realismEngine.personFilterString() : 'none', bounds, { noSpill: !applyRealism });
  if (ready) sceneEngine.drawFront(targetCtx, env, cw, ch);       // props nearer than the presenter (depth map)
  if (sceneEngine.state.seat) { lastSeatAlign = sceneEngine.seatAlignment(bounds, cw, ch); }
  if (ready) sceneEngine.drawSeat(targetCtx, env, cw, ch, currentEnvId);   // Level 3: sofa arms in front of the presenter
  if (ready) sceneEngine.drawOccluder(targetCtx, cw, ch);   // desk/table in front of the person
  ensureSceneFg(currentEnvId);
  { const fg = sceneFgBitmaps.get(currentEnvId); if (fg) targetCtx.drawImage(fg, 0, 0, cw, ch); }   // scene's own foreground layer (plant, mug...)
  // M4 realism passes follow the one-click realism toggle (so the A/B preview shows the true before/after)
  if (ready && applyRealism) sceneEngine.drawDeskReflection(targetCtx, personCanvas, cw, ch);
  if (ready && applyRealism) sceneEngine.drawGrade(targetCtx, env, cw, ch, currentEnvId);
  if (applyRealism) realismEngine.drawGrain(targetCtx, cw, ch);
  drawContentOverlays(targetCtx, cw, ch, null);
  drawAnnotations(targetCtx, cw, ch);
  drawWatermark(targetCtx, cw, ch);
  drawGraphics(targetCtx, cw, ch);
}

function paintScene(targetCtx, cw, ch, applyRealism) {
  targetCtx.clearRect(0, 0, cw, ch);
  const primary = layoutMode !== 'default' ? getPrimaryOverlay() : null;

  if (layoutMode === 'sidebyside' && primary) {
    paintSideBySide(targetCtx, cw, ch, applyRealism, primary);
    drawContentOverlays(targetCtx, cw, ch, primary);
    drawAnnotations(targetCtx, cw, ch);
    drawWatermark(targetCtx, cw, ch);
  drawGraphics(targetCtx, cw, ch);
    return;
  }

  if (sceneEngine && sceneEngine.enabled && layoutMode === 'default') {
    paintStudioScene(targetCtx, cw, ch, applyRealism);
    return;
  }

  // 'cutout' and 'bubble' both substitute the primary overlay's image for
  // the environment as the background; 'bubble' additionally shrinks the
  // presenter instead of drawing them full-frame.
  const useContentBg = (layoutMode === 'cutout' || layoutMode === 'bubble') && primary;
  if (useContentBg) {
    targetCtx.drawImage(currentSlide(primary), 0, 0, cw, ch);
  } else {
    drawEnvironment(targetCtx, cw, ch);
  }
  const canUseFullFrameRealism = !useContentBg || layoutMode === 'cutout';
  if (applyRealism && canUseFullFrameRealism) {
    realismEngine.sampleEnvironmentTone(targetCtx.canvas, cw, ch);
    realismEngine.drawShadow(targetCtx, computeMaskBounds(maskFinalCanvas, cw, ch), cw, ch);
  }

  if (layoutMode === 'bubble' && primary) {
    drawPresenterBubble(targetCtx, cw, ch, applyRealism);
  } else {
    targetCtx.save();
    targetCtx.filter = personFilter(applyRealism);
    targetCtx.drawImage(personCanvas, 0, 0, cw, ch);
    targetCtx.restore();
    if (applyRealism && canUseFullFrameRealism) {
      realismEngine.drawLightWrap(targetCtx, personCanvas, cw, ch);
    }
  }
  if (applyRealism) realismEngine.drawGrain(targetCtx, cw, ch);

  drawContentOverlays(targetCtx, cw, ch, primary);
  drawAnnotations(targetCtx, cw, ch);
  drawWatermark(targetCtx, cw, ch);
  drawGraphics(targetCtx, cw, ch);
}

function renderFrame(personBitmap, maskBitmap, token) {
  // Sharp path: guided GPU upsample of the (small) model mask against the
  // full-res camera frame. Manual brush correction still needs the legacy
  // canvas path, so it takes over while correction is enabled.
  let usedGL = false;
  if (matteMode === 'gl' && glMatte && glMatte.ok && !maskRefiner.correctionEnabled) {
    try {
      const fg = glMatte.process(personBitmap, maskBitmap, w, h);
      if (fg) {
        personCtx.clearRect(0, 0, w, h);
        personCtx.drawImage(fg, 0, 0, w, h);   // premultiplied foreground, alpha already applied
        maskFinalCtx.clearRect(0, 0, w, h);    // keeps bounds/shadow logic working
        maskFinalCtx.drawImage(fg, 0, 0, w, h);
        usedGL = true;
      }
    } catch (e) {
      glMatte.ok = false;                      // stop retrying a broken GL path; legacy takes over
      glMatte.error = e && e.message ? e.message : String(e);
      notify({ type: 'matteStatus', ok: false, error: glMatte.error });
    }
  }

  if (!usedGL) {
    personCtx.clearRect(0, 0, w, h);
    personCtx.drawImage(personBitmap, 0, 0, w, h);

    maskRawCtx.clearRect(0, 0, w, h);
    maskRawCtx.drawImage(maskBitmap, 0, 0, w, h);

    maskRefiner.buildFinalMask(maskFinalCtx, maskRawCanvas, w, h);

    personCtx.save();
    personCtx.globalCompositeOperation = 'destination-in';
    personCtx.drawImage(maskFinalCanvas, 0, 0, w, h);
    personCtx.restore();
  }

  applyPersonGrade();
  if (gradeState.auto && gradeFrame % 6 === 0) {
    const b = computeMaskBounds(maskFinalCanvas, w, h);
    if (b) notify({ type: 'personBox', box: { x0: b.minX / w, x1: b.maxX / w, y0: b.minY / h, y1: b.maxY / h } });
  }
  if (realismEngine.abPreview) {
    paintScene(sceneOffCtx, w, h, false);
    paintScene(sceneOnCtx, w, h, realismEngine.enabled);
    outCtx.clearRect(0, 0, w, h);
    outCtx.drawImage(sceneOffCanvas, 0, 0, Math.round(w / 2), h, 0, 0, Math.round(w / 2), h);
    outCtx.drawImage(sceneOnCanvas, Math.round(w / 2), 0, w - Math.round(w / 2), h, Math.round(w / 2), 0, w - Math.round(w / 2), h);
    outCtx.save();
    outCtx.strokeStyle = 'rgba(255,255,255,0.6)';
    outCtx.lineWidth = 2;
    outCtx.beginPath(); outCtx.moveTo(w / 2, 0); outCtx.lineTo(w / 2, h); outCtx.stroke();
    outCtx.fillStyle = 'rgba(255,255,255,0.75)';
    outCtx.font = '11px sans-serif';
    outCtx.fillText('OFF', 10, 16);
    outCtx.fillText('ON', w - 26, 16);
    outCtx.restore();
  } else {
    paintScene(outCtx, w, h, realismEngine.enabled);
  }

  personBitmap.close();
  maskBitmap.close();
  notify({ type: 'frameDone', token, seatAlign: lastSeatAlign, seatPose: seatPoseWanted ? lastSeatPose : null, seatLight: seatPoseWanted ? seatLight : null });
}


  function dispatch(msg) {
  
  try {
    switch (msg.type) {
      case 'init':
        outCanvas = msg.canvas;
        outCtx = outCanvas.getContext('2d');
        if (!outCtx) throw new Error('getContext(2d) returned null — this device/browser cannot give Studio a working canvas context at all.');
        assetsBase = msg.assetsBase;
        break;
      case 'resize':
        resize(msg.w, msg.h);
        break;
      case 'frame':
        renderFrame(msg.personBitmap, msg.maskBitmap, msg.token);
        break;
      case 'clear':
        if (outCtx) outCtx.clearRect(0, 0, outCanvas.width, outCanvas.height);
        break;
      case 'selectEnvironment':
        currentEnvId = msg.id;
        ensureBuiltinLoading(currentEnvId);
        break;
      case 'customEnvironmentBitmap':
        customBitmaps.set(msg.id, msg.bitmap);
        break;
      case 'setRealism':
        Object.assign(realismEngine, msg.state);
        break;
      case 'setGrade':
        Object.assign(gradeState, msg.state);
        break;
      case 'setMask':
        Object.assign(maskRefiner, msg.state);
        break;
      case 'setScene':
        if (sceneEngine) sceneEngine.setState(msg.state);
        break;
      case 'sceneQuery':
        notify({ type: 'sceneStatus', ok: !!sceneEngine, light: sceneEngine ? sceneEngine._light : null, key: sceneEngine ? sceneEngine.keySide() : 0 });
        break;
      case 'setMatte': {
        const st = msg.state || {};
        if (st.mode === 'gl' || st.mode === 'legacy') matteMode = st.mode;
        if (glMatte) {
          ['radius', 'sigmaR', 'edgeLo', 'edgeHi', 'despill', 'smoothBase', 'smoothAdapt', 'plateStrength'].forEach((k) => {
            if (typeof st[k] === 'number') glMatte[k] = st[k];
          });
        }
        break;
      }
      case 'setPlate':
        if (glMatte && glMatte.ok && msg.bitmap) { glMatte.setPlate(msg.bitmap); msg.bitmap.close(); }
        break;
      case 'clearPlate':
        if (glMatte) glMatte.clearPlate();
        break;
      case 'matteQuery':
        notify({ type: 'matteStatus', ok: !!(glMatte && glMatte.ok), error: glMatte ? glMatte.error : 'GLMatte not loaded' });
        break;
      case 'setPerf':
        // FAST mode's lighter pipeline. Kept as its own message (not folded
        // into setMask/setRealism state) so the panels' own state mirrors
        // can never overwrite it by accident.
        maskRefiner.lite = !!msg.lite;
        realismEngine.lite = !!msg.lite;
        if (sceneEngine) sceneEngine.lite = !!msg.lite;
        break;
      case 'paintAt':
        maskRefiner.paintAt(msg.x, msg.y);
        break;
      case 'clearCorrections':
        maskRefiner.clearCorrections();
        break;
      case 'graphicsBitmap':
        if (graphicsBitmap && graphicsBitmap.close) { try { graphicsBitmap.close(); } catch (e) {} }
        graphicsBitmap = msg.bitmap || null;
        break;
      case 'setWatermarkOn':
        watermarkOn = !!msg.on;
        break;
      case 'watermarkBitmap':
        if (watermarkBitmap) watermarkBitmap.close();
        watermarkBitmap = msg.bitmap || null;
        break;
      case 'setLayoutMode':
        layoutMode = msg.mode || 'default';
        break;
      case 'setOverlayOn':
        getOrCreateOverlay(msg.id).on = !!msg.on;
        break;
      case 'setOverlayLayout': {
        const ov = getOrCreateOverlay(msg.id);
        if (msg.corner) ov.corner = msg.corner;
        if (typeof msg.scale === 'number') ov.scale = msg.scale;
        break;
      }
      case 'overlaySlides': {
        const ov = getOrCreateOverlay(msg.id);
        ov.slides.forEach((b) => b.close());
        ov.slides = msg.slides || [];
        ov.index = 0;
        break;
      }
      case 'setOverlaySlide': {
        const ov = overlays.get(msg.id);
        if (ov && ov.slides.length) ov.index = Math.max(0, Math.min(msg.index, ov.slides.length - 1));
        break;
      }
      case 'removeOverlay': {
        const ov = overlays.get(msg.id);
        if (ov) ov.slides.forEach((b) => b.close());
        overlays.delete(msg.id);
        break;
      }
      case 'annotateStart':
        if (msg.mode === 'pointer') {
          annotatePointer = { x: msg.x, y: msg.y, color: msg.color };
        } else {
          annotateCurrentStroke = { color: msg.color, points: [{ x: msg.x, y: msg.y }] };
          annotateStrokes.push(annotateCurrentStroke);
        }
        break;
      case 'annotateMove':
        if (annotatePointer) { annotatePointer.x = msg.x; annotatePointer.y = msg.y; }
        else if (annotateCurrentStroke) annotateCurrentStroke.points.push({ x: msg.x, y: msg.y });
        break;
      case 'annotateEnd':
        annotateCurrentStroke = null;
        annotatePointer = null;
        break;
      case 'annotateClear':
        annotateStrokes.length = 0;
        annotateCurrentStroke = null;
        annotatePointer = null;
        break;
    }
  } catch (err) {
    // HARDENING: always report a token back, even on failure — the main
    // thread's frame watchdog is waiting on this token specifically, and
    // without it a single thrown error here would hang the render loop
    // forever (see the "frame watchdog" note in app.js). This is a
    // per-frame self-heal, not a fix for whatever actually threw.
    notify({ type: 'error', message: err && err.message ? err.message : String(err), token: msg && msg.token });
  }
};
  return { dispatch };
}

(function (root) {
  root.VS = root.VS || {};
  root.VS.createRenderCore = createRenderCore;
})(typeof self !== 'undefined' ? self : this);
