/**
 * SceneMeta — the scene.json format (schema 1), its validator, the mapping to engine settings,
 * and automatic desk-line detection for pictures the user uploads.
 *
 * Everything here is pure (no DOM, no network) so it runs in the browser, in a worker and in Node tests.
 * See docs/SCENE_FORMAT.md.
 *
 * Rules (from the brief, E2/E4):
 *  - Validate on load. A bad scene is skipped with a plain message; it never breaks the app.
 *  - Desk detection is a helper with a confidence value. Below the threshold the UI falls back to manual.
 */
(function () {
  const SCHEMA = 1;
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const isNum = (v) => typeof v === 'number' && isFinite(v);

  function inRange(errors, path, v, a, b) {
    if (!isNum(v)) { errors.push(path + ' must be a number'); return false; }
    if (v < a || v > b) { errors.push(path + ' must be between ' + a + ' and ' + b + ' (got ' + v + ')'); return false; }
    return true;
  }

  /** Returns { ok, errors[], warnings[] }. Never throws. */
  function validate(meta) {
    const errors = [], warnings = [];
    try {
      if (!meta || typeof meta !== 'object') return { ok: false, errors: ['scene is not an object'], warnings };
      if (meta.schema !== SCHEMA) errors.push('schema must be ' + SCHEMA);
      if (typeof meta.id !== 'string' || !/^[a-z0-9][a-z0-9-]{1,63}$/.test(meta.id)) errors.push('id must be 2-64 chars of a-z, 0-9, dash');
      if (typeof meta.name !== 'string' || !meta.name.trim()) errors.push('name is required');
      if (typeof meta.type !== 'string' || !meta.type.trim()) errors.push('type is required');
      if (typeof meta.image !== 'string' || !/\.(jpe?g|png|webp)$/i.test(meta.image)) errors.push('image must be a .jpg/.png/.webp path');
      if (!Array.isArray(meta.size) || meta.size.length !== 2 || !(meta.size[0] > 0 && meta.size[1] > 0)) errors.push('size must be [width, height]');
      const dl = meta.deskLine;
      if (!dl || typeof dl !== 'object') errors.push('deskLine is required');
      else {
        inRange(errors, 'deskLine.y', dl.y, 0.3, 0.97);
        inRange(errors, 'deskLine.tilt', dl.tilt === undefined ? 0 : dl.tilt, -0.25, 0.25);
        inRange(errors, 'deskLine.bow', dl.bow === undefined ? 0 : dl.bow, -0.12, 0.12);
        inRange(errors, 'deskLine.feather', dl.feather === undefined ? 6 : dl.feather, 0, 30);
      }
      const kl = meta.keyLight;
      if (!kl || typeof kl !== 'object') errors.push('keyLight is required');
      else {
        if (kl.side !== -1 && kl.side !== 1) errors.push('keyLight.side must be -1 (from left) or 1 (from right)');
        if (!Array.isArray(kl.colour) || kl.colour.length !== 3 || kl.colour.some((c) => !isNum(c) || c < 0 || c > 255)) errors.push('keyLight.colour must be [r,g,b] 0-255');
        inRange(errors, 'keyLight.softness', kl.softness === undefined ? 0.5 : kl.softness, 0, 1);
      }
      const p = meta.person;
      if (!p || typeof p !== 'object') errors.push('person is required');
      else {
        inRange(errors, 'person.scale', p.scale, 0.2, 1.5);
        inRange(errors, 'person.x', p.x === undefined ? 0 : p.x, -0.4, 0.4);
        inRange(errors, 'person.y', p.y === undefined ? 0 : p.y, -0.3, 0.3);
      }
      if (meta.seat !== undefined && meta.seat !== null) {
        const st = meta.seat;
        if (typeof st !== 'object') errors.push('seat must be an object');
        else {
          if (typeof st.type !== 'string' || !st.type) errors.push('seat.type is required (e.g. sofa)');
          if (typeof st.supports !== 'string' || st.supports.length < 10) errors.push('seat.supports must describe the supported pose/camera view');
          const g = st.guide;
          if (!g || typeof g !== 'object') errors.push('seat.guide is required');
          else ['headX', 'headY', 'headRx', 'headRy', 'shoulderY', 'shoulderHalfW'].forEach((k) => inRange(errors, 'seat.guide.' + k, g[k], 0, 1));
          if (st.arms !== undefined) {
            if (!Array.isArray(st.arms)) errors.push('seat.arms must be an array');
            else st.arms.forEach((a, i) => { if (!a || !(isNum(a.x0) && isNum(a.x1) && isNum(a.y0)) || a.x0 < 0 || a.x1 > 1 || a.x0 >= a.x1 || a.y0 < 0 || a.y0 > 1) errors.push('seat.arms[' + i + '] needs x0<x1 in 0..1 and y0 in 0..1'); });
          }
        }
      }
      if (meta.floorLine !== undefined) inRange(errors, 'floorLine', meta.floorLine, 0.5, 1);
      if (meta.reflections && meta.reflections.desk !== undefined) inRange(errors, 'reflections.desk', meta.reflections.desk, 0, 1);
      if (meta.grade) {
        ['grain', 'bloom', 'vignette', 'dof', 'occlusion', 'colourMatch'].forEach((k) => { if (meta.grade[k] !== undefined) inRange(errors, 'grade.' + k, meta.grade[k], 0, 1); });
      }
      if (meta.depthLayers !== undefined) {
        if (!Array.isArray(meta.depthLayers)) errors.push('depthLayers must be a list');
        else meta.depthLayers.forEach((l, i) => {
          if (!l || typeof l.name !== 'string') errors.push('depthLayers[' + i + '].name is required');
          else if (!(isNum(l.y0) && isNum(l.y1) && l.y0 >= 0 && l.y1 <= 1 && l.y0 < l.y1)) errors.push('depthLayers[' + i + '] needs 0 <= y0 < y1 <= 1');
        });
      }
      if (meta.foreground !== undefined && meta.foreground !== null) {
        if (typeof meta.foreground !== 'string' || !/\.(png|webp)$/i.test(meta.foreground)) errors.push('foreground must be a .png/.webp path (with alpha) or null');
        else if (meta.foreground !== meta.image.replace(/\.[a-z]+$/i, '') + '-fg.png' && meta.foreground !== meta.image.replace(/\.[a-z]+$/i, '-fg.png')) warnings.push('the worker loads the foreground by name: expected ' + meta.image.replace(/\.[a-z]+$/i, '-fg.png'));
      }
      if (meta.screens !== undefined) {
        if (!Array.isArray(meta.screens)) errors.push('screens must be a list');
        else meta.screens.forEach((r, i) => { if (!r || !isNum(r.x) || !isNum(r.y) || !(r.w > 0) || !(r.h > 0) || r.x < 0 || r.y < 0 || r.x + r.w > 1.0001 || r.y + r.h > 1.0001) errors.push('screens[' + i + '] needs x,y,w,h as fractions inside the frame'); });
      }
      if (meta.life) { ['amount', 'parallax'].forEach((k) => { if (meta.life[k] !== undefined) inRange(errors, 'life.' + k, meta.life[k], 0, 1); }); }
      if (!meta.licence) warnings.push('licence text is missing (needed before this scene can be sold or shared)');
    } catch (e) { errors.push('unexpected: ' + (e && e.message)); }
    return { ok: errors.length === 0, errors, warnings };
  }

  /** scene.json -> SceneEngine settings (see scene-engine.js DEFAULTS). */
  function toEngineState(meta) {
    const dl = meta.deskLine || {}, kl = meta.keyLight || {}, p = meta.person || {}, g = meta.grade || {};
    const soft = kl.softness === undefined ? 0.5 : kl.softness;
    const bgLayer = (meta.depthLayers || []).find((l) => l.name === 'background');
    return {
      enabled: true, deskOn: !meta.noDesk,
      deskY: dl.y, deskTilt: dl.tilt || 0, deskBow: dl.bow || 0, deskFeather: dl.feather === undefined ? 6 : dl.feather,
      personScale: p.scale, personX: p.x || 0, personY: p.y || 0,
      lightAuto: false, lightSide: kl.side >= 0 ? 1 : -1, lightTint: Array.isArray(kl.colour) ? kl.colour.slice() : null,
      lightStrength: clamp(0.62 - 0.3 * soft, 0.25, 0.7),
      shadowStrength: clamp(0.65 - 0.35 * soft, 0.2, 0.7),
      bgSoft: bgLayer && isNum(bgLayer.blur) ? clamp(bgLayer.blur, 0, 1) : 0.25,
      spill: 0.35,
      reflection: meta.reflections && isNum(meta.reflections.desk) ? meta.reflections.desk : 0.2,
      bloom: g.bloom === undefined ? 0.3 : g.bloom,
      vignette: g.vignette === undefined ? 0.25 : g.vignette,
      life: meta.life && isNum(meta.life.amount) ? meta.life.amount : 0.4,
      parallax: meta.life && isNum(meta.life.parallax) ? meta.life.parallax : 0.3,
      dof: g.dof === undefined ? 0.5 : g.dof,
      occlusion: g.occlusion === undefined ? 0 : g.occlusion,
      colourMatch: g.colourMatch === undefined ? 0 : g.colourMatch,
      seat: meta.seat && typeof meta.seat === 'object' ? JSON.parse(JSON.stringify(meta.seat)) : null,
      screens: Array.isArray(meta.screens) ? meta.screens.map((r) => ({ x: r.x, y: r.y, w: r.w, h: r.h })) : null,
    };
  }

  /** Validates every scene in a list. Returns { scenes: [valid metas], rejected: [{id, errors}] }. */
  function loadLibrary(list) {
    const scenes = [], rejected = [], seen = new Set();
    (Array.isArray(list) ? list : []).forEach((m) => {
      const r = validate(m);
      if (!r.ok) { rejected.push({ id: m && m.id, errors: r.errors }); return; }
      if (seen.has(m.id)) { rejected.push({ id: m.id, errors: ['duplicate id'] }); return; }
      seen.add(m.id); scenes.push(m);
    });
    return { scenes, rejected };
  }

  // ------------------------------------------------------------------ desk detection
  /**
   * Finds the desk's back edge in a picture. `rgba` is a small RGBA image (about 160x90).
   * Method: per column, the highest strong horizontal edge in the lower half; a robust 3-parameter fit
   * y = a + t*x + b*4x(1-x) (the same curve the occluder draws), outliers rejected twice.
   * Returns { y, tilt, bow, confidence 0..1 }. confidence < 0.45 means "ask the user to place it by hand".
   * Honest limit: it finds the strongest horizontal edge. A busy picture, a shelf line in the lower half or a desk
   * with the same tone as the wall can fool it; the confidence value is built to say so.
   */
  function detectDeskLine(rgba, w, h) {
    const lum = new Float32Array(w * h);
    for (let i = 0, n = w * h; i < n; i++) lum[i] = 0.2126 * rgba[i * 4] + 0.7152 * rgba[i * 4 + 1] + 0.0722 * rgba[i * 4 + 2];
    // light vertical smoothing to ignore grain
    const sm = new Float32Array(w * h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const a = lum[Math.max(0, y - 1) * w + x], b = lum[y * w + x], c = lum[Math.min(h - 1, y + 1) * w + x];
      sm[y * w + x] = (a + 2 * b + c) / 4;
    }
    const y0 = Math.floor(h * 0.45), y1 = Math.floor(h * 0.92), step = 2;
    const pts = [];
    // Coherent edge strength per column BAND: the signed gradient is summed along the band, so shelf contents / books / lights
    // (which flip sign from column to column) cancel out while a desk edge (same step all along) adds up.
    const BANDS = 16, bw = Math.max(4, Math.round(w / BANDS)), gap = Math.max(3, Math.round(h * 0.12)), depth = Math.round(h * 0.14);
    let strongest = 0; const bands = [];
    for (let b = 0; b < BANDS; b++) {
      const xa = Math.round((b / BANDS) * w), xb = Math.min(w, xa + bw);
      const C = [];
      for (let y = y0; y < y1; y++) {
        let sum = 0;
        for (let x = xa; x < xb; x++) sum += sm[Math.min(h - 1, y + step) * w + x] - sm[Math.max(0, y - step) * w + x];
        C.push(Math.abs(sum) / (xb - xa));
      }
      let mx = 0; C.forEach((v) => { if (v > mx) mx = v; });
      bands.push({ C, mx, xc: (xa + xb) / 2 / w });
      if (mx > strongest) strongest = mx;
    }
    if (strongest < 5) return { y: 0.7, tilt: 0, bow: 0, confidence: 0 };
    bands.forEach(({ C, mx, xc }) => {
      if (mx < Math.max(4, strongest * 0.25)) return;
      // The lowest strong edge in the band is the desk's front lip (or its edge); shelves, boards and neon lines sit above the desk.
      let best = -1;
      for (let i = C.length - 2; i >= 1; i--) if (C[i] >= Math.max(4, mx * 0.2) && C[i] >= C[i - 1] && C[i] >= C[i + 1]) { best = i; break; }
      if (best < 0) return;
      // ...then step up to the back edge if a comparable edge sits within one desk-depth above it
      for (let i = Math.max(1, best - depth); i < best - 2; i++) if (C[i] >= C[best] * 0.6 && C[i] >= C[i - 1] && C[i] >= C[i + 1]) { best = i; break; }
      pts.push({ x: xc, y: (y0 + best + 0.5) / h });
    });
    if (pts.length < BANDS * 0.3) return { y: 0.7, tilt: 0, bow: 0, confidence: 0 };
    function fit(P) {
      // normal equations for [1, x, 4x(1-x)]
      const A = [[0, 0, 0], [0, 0, 0], [0, 0, 0]], B = [0, 0, 0];
      P.forEach((p) => { const f = [1, p.x, 4 * p.x * (1 - p.x)]; for (let i = 0; i < 3; i++) { B[i] += f[i] * p.y; for (let j = 0; j < 3; j++) A[i][j] += f[i] * f[j]; } });
      // solve 3x3 by Cramer
      const det = (m) => m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1]) - m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0]) + m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0]);
      const D = det(A);
      if (Math.abs(D) < 1e-9) return null;
      const out = [];
      for (let k = 0; k < 3; k++) { const M = A.map((r, i) => r.map((v, j) => (j === k ? B[i] : v))); out.push(det(M) / D); }
      return { a: out[0], t: out[1], b: out[2] };
    }
    let P = pts, m = fit(P);
    for (let it = 0; it < 3 && m; it++) {
      const res = P.map((p) => Math.abs(p.y - (m.a + m.t * p.x + m.b * 4 * p.x * (1 - p.x))));
      const sorted = res.slice().sort((a, b) => a - b);
      const cut = Math.max(0.012, sorted[Math.floor(sorted.length * 0.6)] * 1.5);
      const keep = P.filter((p, i) => res[i] <= cut);
      if (keep.length < 5) break;
      P = keep; m = fit(P);
    }
    if (!m) return { y: 0.7, tilt: 0, bow: 0, confidence: 0 };
    const inl = pts.filter((p) => Math.abs(p.y - (m.a + m.t * p.x + m.b * 4 * p.x * (1 - p.x))) < 0.02).length / BANDS;
    const out = { y: clamp(m.a, 0.35, 0.95), tilt: clamp(m.t, -0.25, 0.25), bow: clamp(m.b, -0.12, 0.12) };
    out.confidence = clamp(inl * 1.15, 0, 1);
    return out;
  }

  /**
   * Checks an uploaded or generated picture for the desk-scene recipe. Returns { ok, desk, issues[], fixes[] } with plain-language text.
   * - desk: a desk edge was found with confidence (uses detectDeskLine)
   * - clear: the middle of the picture above the desk (where you will sit) has little detail and no huge brightness jump
   * - exposure: not nearly black or blown out
   * Honest limit: it measures edges and brightness only. It cannot tell a person from a poster; a picture that already contains a
   * person is only caught when their edges make the area busy.
   */
  function checkPicture(rgba, w, h) {
    const issues = [], fixes = [];
    const d = detectDeskLine(rgba, w, h);
    const desk = d.confidence >= 0.45;
    if (!desk) { issues.push('I cannot see a clear desk or table edge in this picture.'); fixes.push('Drag the yellow line to where the desk starts, or generate a picture with a desk across the bottom third.'); }
    const lum = (i) => 0.2126 * rgba[i] + 0.7152 * rgba[i + 1] + 0.0722 * rgba[i + 2];
    const x0 = Math.floor(w * 0.35), x1 = Math.ceil(w * 0.65), ya = Math.floor(h * 0.15), yb = Math.max(ya + 3, Math.floor((desk ? d.y : 0.62) * h) - 2);
    let busy = 0, n = 0, mean = 0, mn = 255, mxv = 0;
    for (let y = ya; y < yb; y++) for (let x = x0; x < x1; x++) {
      const i = (y * w + x) * 4, l = lum(i);
      const gx = Math.abs(l - lum((y * w + Math.min(w - 1, x + 1)) * 4)), gy = Math.abs(l - lum((Math.min(h - 1, y + 1) * w + x) * 4));
      busy += gx + gy; n++; mean += l; if (l < mn) mn = l; if (l > mxv) mxv = l;
    }
    n = Math.max(1, n); busy /= n; mean /= n;
    const clear = busy < 9;
    if (!clear) { issues.push('The area behind where you will sit looks busy (a person, chair or clutter may be there).'); fixes.push('Use a picture with an empty, uncluttered wall or chair behind the desk. Turn background softness up to calm it.'); }
    let all = 0; for (let i = 0; i < w * h; i++) all += lum(i * 4); all /= w * h;
    const exposure = all > 28 && all < 235;
    if (!exposure) { issues.push(all <= 28 ? 'The picture is almost black.' : 'The picture is almost white.'); fixes.push('Pick a picture with more even lighting so you stay visible.'); }
    // one-tap fixes (same order as issues). Each patch is applied to the scene settings by the wizard.
    const actions = [];
    if (!desk) actions.push({ label: 'Use a standard desk position', patch: { deskOn: true, deskY: 0.66, deskTilt: 0, deskBow: 0 } });
    if (!clear) actions.push({ label: 'Soften the background', patch: { bgSoft: 0.8, bloom: 0 } });
    if (!exposure) actions.push(all <= 28 ? { label: 'Light me more', patch: { lightStrength: 0.7 } } : { label: 'Light me less', patch: { lightStrength: 0.25 } });
    return { ok: desk && clear && exposure, desk, clear, exposure, actions, busy: +busy.toFixed(2), desklineConfidence: d.confidence, issues, fixes };
  }

  /**
   * Desk BACK edge from a depth map (8-bit, 255 = near; w x h, any size). v0.23. The desk is the near surface at the bottom, so
   * the edge is the row where depth jumps from "far" (wall/chair) to "near" (desk) when scanning down. Measured per vertical band,
   * then fitted with outlier rejection. Returns {y, tilt, bow:0, confidence, bands} like detectDeskLine. Much better than the
   * colour-edge detector on real photos (which finds the front edge): see tools/e2e/unit_depthdesk.js.
   */
  function detectDeskFromDepth(gray, w, h) {
    const B = 7, pts = [];
    const r0 = Math.floor(h * 0.45), r1 = Math.floor(h * 0.9), win = Math.max(2, Math.round(h * 0.045));
    for (let b = 0; b < B; b++) {
      const x0 = Math.floor(w * (0.12 + 0.76 * b / B)), x1 = Math.max(x0 + 1, Math.floor(w * (0.12 + 0.76 * (b + 1) / B)));
      const prof = new Float32Array(h);
      for (let y = 0; y < h; y++) { let a = 0; for (let x = x0; x < x1; x++) a += gray[y * w + x]; prof[y] = a / ((x1 - x0) * 255); }
      let best = -1, bg = 0;
      for (let y = r0; y < r1; y++) { const g = prof[Math.min(h - 1, y + 1)] - prof[Math.max(0, y - win)]; if (g > bg) { bg = g; best = y; } }
      if (best >= 0) pts.push({ x: ((x0 + x1) / 2) / w, y: (best - win / 2 + 1) / h, g: bg });
    }
    if (pts.length < 4) return { y: 0.7, tilt: 0, bow: 0, confidence: 0 };
    const med = (a) => { const t = a.slice().sort((p, q) => p - q); return t[Math.floor(t.length / 2)]; };
    const my = med(pts.map((p) => p.y));
    const ok = pts.filter((p) => Math.abs(p.y - my) < 0.05);
    const mad = med(ok.map((p) => Math.abs(p.y - my)));
    let tilt = 0, y0 = my;
    if (ok.length >= 4) {   // least squares y = a + t x over agreeing bands; tilt is shrunk toward 0 (it is noisy)
      let sx = 0, sy = 0, sxx = 0, sxy = 0; const n = ok.length;
      ok.forEach((p) => { sx += p.x; sy += p.y; sxx += p.x * p.x; sxy += p.x * p.y; });
      const den = n * sxx - sx * sx; if (den > 1e-9) { tilt = clamp(0.5 * (n * sxy - sx * sy) / den, -0.12, 0.12); y0 = sy / n - tilt * (sx / n); }
    }
    const strength = clamp(med(ok.map((p) => p.g)) / 0.1, 0, 1), agree = ok.length / pts.length, tight = clamp(1 - mad / 0.03, 0, 1);
    const conf = +(strength * agree * (0.4 + 0.6 * tight)).toFixed(3);
    return { y: clamp(y0, 0.3, 0.97), tilt: +tilt.toFixed(4), bow: 0, confidence: conf, bands: pts.length };
  }

  /** Desk edge curve y(x) = y + tilt*x + bow*4x(1-x) (x 0..1). */
  function deskCurve(d, x) { return d.y + (d.tilt || 0) * x + (d.bow || 0) * 4 * x * (1 - x); }
  /** Mean and max |difference| (as a fraction of frame height) between two desk lines over x = 0.1..0.9. */
  function deskError(a, b) {
    let sum = 0, mx = 0, n = 0;
    for (let x = 0.1; x <= 0.9001; x += 0.1) { const e = Math.abs(deskCurve(a, x) - deskCurve(b, x)); sum += e; if (e > mx) mx = e; n++; }
    return { mean: sum / n, max: mx };
  }

  /**
   * labels: [{file, y,tilt,bow | none:true, auto:{y,tilt,bow,confidence}}]. Reports how well auto-detect (confidence >= 0.45) matches the truth.
   * "good" = mean error <= 0.03 of frame height. "confidently wrong" = confident detection that is NOT good (the harmful case: the UI would trust it).
   */
  const CONF = 0.45, GOOD = 0.03;
  function summariseDeskLabels(labels) {
    const withDesk = labels.filter((l) => !l.none && l.auto), none = labels.filter((l) => l.none && l.auto);
    const errs = [], rows = [];
    let good = 0, confident = 0, confidentWrong = 0, fellBack = 0;
    withDesk.forEach((l) => {
      const e = deskError(l.auto, l), conf = l.auto.confidence >= CONF; errs.push(e.mean);
      if (conf) { confident++; if (e.mean <= GOOD) good++; else confidentWrong++; } else fellBack++;
      rows.push({ file: l.file, err: +e.mean.toFixed(4), conf: l.auto.confidence, confident: conf });
    });
    const falseDesk = none.filter((l) => l.auto.confidence >= CONF).length;
    errs.sort((a, b) => a - b);
    const q = (p) => (errs.length ? errs[Math.min(errs.length - 1, Math.floor(p * errs.length))] : null);
    return { n: labels.length, withDesk: withDesk.length, noDesk: none.length, good, confident, confidentWrong, fellBack, falseDesk,
      meanErr: errs.length ? errs.reduce((a, b) => a + b, 0) / errs.length : null, median: q(0.5), p90: q(0.9), worst: rows.slice().sort((a, b) => b.err - a.err).slice(0, 5), thresholds: { CONF, GOOD }, rows };
  }
  function formatDeskReport(r) {
    if (!r || !r.n) return 'No labels yet.';
    const pc = (x) => (x == null ? 'n/a' : (x * 100).toFixed(1) + '%');
    const L = ['Desk detection on real photos: ' + r.n + ' labelled (' + r.withDesk + ' with a desk, ' + r.noDesk + ' without).',
      'Within ' + pc(r.thresholds.GOOD) + ' of frame height and confident: ' + r.good + ' / ' + r.withDesk,
      'Confident but WRONG (harmful): ' + r.confidentWrong + ' | not confident (falls back to manual): ' + r.fellBack + ' | confident on a photo with no desk: ' + r.falseDesk,
      'Error (fraction of frame height): mean ' + pc(r.meanErr) + ', median ' + pc(r.median) + ', 90th percentile ' + pc(r.p90),
      'Worst: ' + r.worst.map((w) => w.file + ' ' + pc(w.err) + (w.confident ? ' (confident)' : '')).join('; '),
      r.n < 30 ? 'NOTE: fewer than 30 photos; treat these numbers as a rough sign only.' : ''];
    return L.filter(Boolean).join('\n');
  }

  globalThis.VS = globalThis.VS || {};
  globalThis.VS.SceneMeta = { SCHEMA, validate, toEngineState, loadLibrary, detectDeskLine, detectDeskFromDepth, checkPicture, deskCurve, deskError, summariseDeskLabels, formatDeskReport };
})();
