/**
 * Grade core (pure; runs in the page AND in the render worker): colour-grade presets, "match colours from a photo",
 * skin-tone mask, and auto-framing maths. Unit-tested in tools/e2e/unit_grade.js.
 * HONEST NAMING: grades are parametric (brightness/contrast/saturation/hue + a tint), not 3D .cube LUT files.
 */
(function () {
  const root = typeof self !== 'undefined' ? self : window;
  root.VS = root.VS || {};
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const lerp = (a, b, t) => a + (b - a) * t;

  // f = css filter params (1 = unchanged, hue in degrees, gray/sepia 0..1). tint = overlay on the person only.
  const GRADES = [
    { id: 'none',      name: 'Natural',   about: 'No grade',                            f: {}, tint: null },
    { id: 'warm',      name: 'Warm',      about: 'Friendly, golden',                    f: { brightness: 1.03, saturate: 1.06 }, tint: { rgb: [255, 170, 90], a: 0.10 } },
    { id: 'cool',      name: 'Cool',      about: 'Clean, modern, slightly blue',        f: { contrast: 1.03, saturate: 0.96 }, tint: { rgb: [90, 150, 255], a: 0.09 } },
    { id: 'cinema',    name: 'Cinema',    about: 'More contrast, muted colour, warm skin', f: { contrast: 1.14, saturate: 0.88, brightness: 0.98 }, tint: { rgb: [255, 150, 70], a: 0.08 } },
    { id: 'vivid',     name: 'Vivid',     about: 'Punchy colour for short video',       f: { contrast: 1.06, saturate: 1.30 }, tint: null },
    { id: 'soft',      name: 'Soft',      about: 'Gentle, lifted, flattering',          f: { contrast: 0.94, brightness: 1.04, saturate: 0.96 }, tint: { rgb: [255, 200, 190], a: 0.06 } },
    { id: 'film',      name: 'Film',      about: 'Slight fade and warmth',              f: { contrast: 1.08, sepia: 0.14, saturate: 0.92 }, tint: null },
    { id: 'mono',      name: 'Black & white', about: 'Monochrome',                      f: { grayscale: 1, contrast: 1.08 }, tint: null },
  ];
  const NEUTRAL = { brightness: 1, contrast: 1, saturate: 1, hue: 0, sepia: 0, grayscale: 0 };

  /** Scale a grade toward neutral. strength 0..1 (1 = full preset). Returns { filter, tint } where tint = {color, alpha} or null. */
  function resolve(grade, strength) {
    const s = clamp(strength == null ? 1 : strength, 0, 1);
    if (!grade || s === 0) return { filter: 'none', tint: null };
    const f = Object.assign({}, NEUTRAL, grade.f || {}), out = [];
    const v = {}; for (const k in NEUTRAL) v[k] = lerp(NEUTRAL[k], f[k], s);
    if (Math.abs(v.brightness - 1) > 0.002) out.push('brightness(' + v.brightness.toFixed(3) + ')');
    if (Math.abs(v.contrast - 1) > 0.002) out.push('contrast(' + v.contrast.toFixed(3) + ')');
    if (Math.abs(v.saturate - 1) > 0.002) out.push('saturate(' + v.saturate.toFixed(3) + ')');
    if (Math.abs(v.hue) > 0.05) out.push('hue-rotate(' + v.hue.toFixed(1) + 'deg)');
    if (v.sepia > 0.002) out.push('sepia(' + v.sepia.toFixed(3) + ')');
    if (v.grayscale > 0.002) out.push('grayscale(' + v.grayscale.toFixed(3) + ')');
    const t = grade.tint && grade.tint.a * s > 0.003 ? { color: 'rgb(' + grade.tint.rgb.map((x) => Math.round(clamp(x, 0, 255))).join(',') + ')', alpha: +(grade.tint.a * s).toFixed(4) } : null;
    return { filter: out.length ? out.join(' ') : 'none', tint: t };
  }

  /** Average colour statistics of an RGBA buffer (samples ~4000 pixels). */
  function statsFromRGBA(data, w, h) {
    const n = w * h; if (!n) return null; const step = Math.max(1, Math.floor(n / 4000));
    let r = 0, g = 0, b = 0, c = 0, sat = 0, l2 = 0; const lums = [];
    for (let i = 0; i < n; i += step) {
      const a = data[i * 4 + 3]; if (a < 128) continue;
      const R = data[i * 4], G = data[i * 4 + 1], B = data[i * 4 + 2], mx = Math.max(R, G, B), mn = Math.min(R, G, B);
      r += R; g += G; b += B; c++; sat += mx ? (mx - mn) / mx : 0; const L = 0.2126 * R + 0.7152 * G + 0.0722 * B; lums.push(L); l2 += L;
    }
    if (c < 20) return null;
    const lum = l2 / c; let v = 0; for (const L of lums) v += (L - lum) * (L - lum);
    return { r: r / c, g: g / c, b: b / c, lum, lumStd: Math.sqrt(v / c), sat: sat / c };
  }
  /** A gentle grade that nudges the person toward the look of a reference photo. Never extreme: every value is clamped. */
  function gradeFromStats(st) {
    if (!st) return null;
    const m = (st.r + st.g + st.b) / 3, cast = [st.r - m, st.g - m, st.b - m], castMag = Math.hypot(cast[0], cast[1], cast[2]);
    return {
      id: 'photo', name: 'From photo', about: 'Matched to your photo',
      f: { brightness: clamp(1 + (st.lum - 118) / 255 * 0.5, 0.85, 1.15), contrast: clamp(1 + (st.lumStd - 55) / 255 * 0.8, 0.9, 1.2), saturate: clamp(st.sat / 0.35, 0.8, 1.3) },
      tint: castMag > 4 ? { rgb: cast.map((x) => clamp(128 + x * 2.4, 0, 255)), a: clamp(castMag / 255 * 0.9, 0, 0.16) } : null,
    };
  }

  // ---- skin
  function isSkin(r, g, b) { // classic YCbCr range; deliberately conservative
    const y = 0.299 * r + 0.587 * g + 0.114 * b, cb = 128 - 0.168736 * r - 0.331264 * g + 0.5 * b, cr = 128 + 0.5 * r - 0.418688 * g - 0.081312 * b;
    return y > 45 && cb >= 77 && cb <= 127 && cr >= 133 && cr <= 173;
  }
  /** Writes 255/0 into the alpha of `out` (RGBA, same size) for skin pixels of `src` (RGBA). Returns the skin fraction among opaque pixels. */
  function skinMask(src, out, w, h) {
    let skin = 0, opaque = 0;
    for (let i = 0, n = w * h; i < n; i++) {
      const p = i * 4, a = src[p + 3]; out[p] = out[p + 1] = out[p + 2] = 0;
      if (a < 128) { out[p + 3] = 0; continue; }
      opaque++;
      if (isSkin(src[p], src[p + 1], src[p + 2])) { out[p + 3] = 255; skin++; } else out[p + 3] = 0;
    }
    return opaque ? skin / opaque : 0;
  }

  // ---- auto-framing
  const AF = { targetH: 0.62, targetW: 0.5, headroom: 0.14, deadband: 0.06, zoomMin: 1, zoomMax: 2.4, tau: 1.1, maxSpeed: 0.25 };
  /**
   * Where should the crop be? box = person box, normalised to the SOURCE frame {x0,y0,x1,y1}. base = crop size at zoom 1 as fractions of the source {fw,fh}.
   * cur = {zoom,panX,panY}. Returns the target {zoom,panX,panY}; equal to cur when the error is inside the dead-band.
   */
  function frameTarget(box, base, cur, cfg) {
    const c = Object.assign({}, AF, cfg || {});
    if (!box || !(box.x1 > box.x0) || !(box.y1 > box.y0) || !base) return null;
    const ph = box.y1 - box.y0, pw = box.x1 - box.x0;   // crop must fit the person by height AND by width (whichever needs the larger crop), so nobody is cut off
    const needH = ph / c.targetH, needW = (pw / c.targetW) * (base.fh / base.fw); let zoom = clamp(base.fh / Math.max(needH, needW), c.zoomMin, c.zoomMax);
    const cw = base.fw / zoom, ch = base.fh / zoom;
    const cx = (box.x0 + box.x1) / 2, top = box.y0 - c.headroom * ch;
    const panX = clamp(cx, cw / 2, 1 - cw / 2), panY = clamp(top + ch / 2, ch / 2, 1 - ch / 2);
    const curCw = base.fw / cur.zoom, curCh = base.fh / cur.zoom;
    const inside = Math.abs(zoom - cur.zoom) / cur.zoom < c.deadband && Math.abs(panX - cur.panX) < c.deadband * curCw && Math.abs(panY - cur.panY) < c.deadband * curCh;
    return inside ? { zoom: cur.zoom, panX: cur.panX, panY: cur.panY } : { zoom, panX, panY };
  }
  /** Smooth approach (exponential, with a speed cap) so framing never snaps. dt in seconds. */
  function approach(cur, tgt, dt, cfg) {
    const c = Object.assign({}, AF, cfg || {}); if (!tgt) return cur; const k = 1 - Math.exp(-Math.max(0, dt) / c.tau), cap = c.maxSpeed * Math.max(0, dt);
    const mv = (a, b, scale) => { let d = (b - a) * k; const m = cap * scale; if (d > m) d = m; else if (d < -m) d = -m; return a + d; };
    return { zoom: mv(cur.zoom, tgt.zoom, 2), panX: mv(cur.panX, tgt.panX, 1), panY: mv(cur.panY, tgt.panY, 1) };
  }


  // ---- v0.35 auto brightness / white balance (gray-world, gentle, dead-banded)
  /** st = statsFromRGBA of the camera frame; prev = previous result (smoothing). Returns { bright, tint:{color,alpha}|null, cast, lum }. Never extreme. */
  function autoAssist(st, prev) {
    if (!st) return prev || { bright: 1, tint: null, cast: 0, lum: 0 };
    const m = (st.r + st.g + st.b) / 3 || 1, gains = [m / Math.max(1, st.r), m / Math.max(1, st.g), m / Math.max(1, st.b)];
    const gmax = Math.max.apply(null, gains), gmin = Math.min.apply(null, gains), cast = gmax - gmin;
    let a = cast < 0.06 ? 0 : clamp((cast - 0.06) * 0.9, 0, 0.12);
    let tgtB = 1; if (st.lum > 1) { const want = 118; tgtB = clamp(1 + (want - st.lum) / 255 * 0.7, 0.8, 1.25); if (Math.abs(tgtB - 1) < 0.04) tgtB = 1; }
    const colour = 'rgb(' + gains.map((g) => Math.round(255 * g / gmax)).join(',') + ')';
    const pv = prev || { bright: 1, tint: null }, pa = pv.tint ? pv.tint.alpha : 0, k = 0.2;           // slow smoothing: no pumping
    const na = pa + (a - pa) * k, nb = pv.bright + (tgtB - pv.bright) * k;
    return { bright: +nb.toFixed(4), tint: na > 0.004 ? { color: colour, alpha: +na.toFixed(4) } : null, cast: +cast.toFixed(3), lum: Math.round(st.lum) };
  }

  // ---- v0.35 .cube 3D LUT import + apply
  const LUT_MAX = 65;
  /** Parse an Adobe/Resolve .cube 3D LUT. Returns { size, data:Float32Array(size^3*3, 0..1, r fastest), title } or { error }. */
  function parseCube(text) {
    if (typeof text !== 'string' || !text.length) return { error: 'That file is empty.' };
    if (text.length > 6e6) return { error: 'That LUT file is too big (over 6 MB).' };
    let size = 0, dmin = [0, 0, 0], dmax = [1, 1, 1], title = '', vals = [], is3d = false;
    const lines = text.split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
      const L = lines[i].trim(); if (!L || L[0] === '#') continue;
      const w = L.split(/\s+/), k = w[0].toUpperCase();
      if (k === 'TITLE') { title = L.replace(/^TITLE\s*/i, '').replace(/"/g, '').slice(0, 60); continue; }
      if (k === 'LUT_3D_SIZE') { size = parseInt(w[1], 10); is3d = true; continue; }
      if (k === 'LUT_1D_SIZE') return { error: 'This is a 1D LUT. Genesis reads 3D .cube LUTs (LUT_3D_SIZE).' };
      if (k === 'DOMAIN_MIN') { dmin = w.slice(1, 4).map(Number); continue; }
      if (k === 'DOMAIN_MAX') { dmax = w.slice(1, 4).map(Number); continue; }
      if (k === 'LUT_3D_INPUT_RANGE' || k === 'LUT_1D_INPUT_RANGE') continue;
      if (w.length === 3) { const a = +w[0], b = +w[1], c = +w[2]; if (!isFinite(a) || !isFinite(b) || !isFinite(c)) return { error: 'Line ' + (i + 1) + ' is not a valid colour row.' }; vals.push(a, b, c); if (vals.length > LUT_MAX * LUT_MAX * LUT_MAX * 3) return { error: 'More data than a LUT of size ' + LUT_MAX + ' allows.' }; }
      else return { error: 'Line ' + (i + 1) + ' is not understood: "' + L.slice(0, 30) + '".' };
    }
    if (!is3d || !(size >= 2)) return { error: 'No LUT_3D_SIZE found. Is this a .cube file?' };
    if (size > LUT_MAX) return { error: 'LUT size ' + size + ' is too large (max ' + LUT_MAX + ').' };
    if (vals.length !== size * size * size * 3) return { error: 'The LUT says size ' + size + ' but has ' + (vals.length / 3) + ' rows instead of ' + size * size * size + '.' };
    const data = new Float32Array(vals.length);
    for (let i = 0; i < vals.length; i++) data[i] = clamp(vals[i], 0, 1);
    return { size, data, title, dmin, dmax };
  }
  /** Apply a LUT to RGBA bytes in place (trilinear). Alpha untouched. amount 0..1 blends with the original. */
  function applyLut(px, lut, amount) {
    const n = lut.size, d = lut.data, m = n - 1, amt = clamp(amount == null ? 1 : amount, 0, 1); if (!amt) return;
    const dm = lut.dmin || [0, 0, 0], dx = lut.dmax || [1, 1, 1], sx = [1 / ((dx[0] - dm[0]) || 1), 1 / ((dx[1] - dm[1]) || 1), 1 / ((dx[2] - dm[2]) || 1)];
    const n2 = n * n;
    for (let i = 0; i < px.length; i += 4) {
      const r = clamp((px[i] / 255 - dm[0]) * sx[0], 0, 1) * m, g = clamp((px[i + 1] / 255 - dm[1]) * sx[1], 0, 1) * m, b = clamp((px[i + 2] / 255 - dm[2]) * sx[2], 0, 1) * m;
      const r0 = Math.min(m - 1, r | 0), g0 = Math.min(m - 1, g | 0), b0 = Math.min(m - 1, b | 0), fr = r - r0, fg = g - g0, fb = b - b0;
      const base = (b0 * n2 + g0 * n + r0) * 3, o = [0, 0, 0];
      for (let c = 0; c < 3; c++) {
        const c000 = d[base + c], c100 = d[base + 3 + c], c010 = d[base + n * 3 + c], c110 = d[base + n * 3 + 3 + c];
        const c001 = d[base + n2 * 3 + c], c101 = d[base + n2 * 3 + 3 + c], c011 = d[base + n2 * 3 + n * 3 + c], c111 = d[base + n2 * 3 + n * 3 + 3 + c];
        const x00 = c000 + (c100 - c000) * fr, x10 = c010 + (c110 - c010) * fr, x01 = c001 + (c101 - c001) * fr, x11 = c011 + (c111 - c011) * fr;
        const y0 = x00 + (x10 - x00) * fg, y1 = x01 + (x11 - x01) * fg; o[c] = (y0 + (y1 - y0) * fb) * 255;
      }
      px[i] = px[i] + (o[0] - px[i]) * amt; px[i + 1] = px[i + 1] + (o[1] - px[i + 1]) * amt; px[i + 2] = px[i + 2] + (o[2] - px[i + 2]) * amt;
    }
  }
  function lutToB64(lut) { const u = new Uint8Array(lut.data.length); for (let i = 0; i < u.length; i++) u[i] = Math.round(lut.data[i] * 255); let s = ''; for (let i = 0; i < u.length; i += 8192) s += String.fromCharCode.apply(null, u.subarray(i, i + 8192)); return { size: lut.size, title: lut.title || '', b64: btoa(s) }; }
  function lutFromB64(o) { try { const s = atob(o.b64), size = o.size | 0; if (!(size >= 2 && size <= LUT_MAX) || s.length !== size * size * size * 3) return null; const data = new Float32Array(s.length); for (let i = 0; i < s.length; i++) data[i] = s.charCodeAt(i) / 255; return { size, data, title: o.title || '' }; } catch (e) { return null; } }

  root.VS.GradeCore = { autoAssist, parseCube, applyLut, lutToB64, lutFromB64, LUT_MAX, GRADES, NEUTRAL, resolve, statsFromRGBA, gradeFromStats, isSkin, skinMask, frameTarget, approach, AF };
})();
