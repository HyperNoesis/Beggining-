/**
 * Brand kit core (pure, no DOM): turns a logo's pixels into 1-2 brand colours and makes sure text drawn on them stays readable.
 * Used by graphics.js (accent "Brand") and unit-tested in tools/e2e/unit_brand.js. Works in the browser (window.VS.BrandCore) and Node.
 *   extractPalette(rgba, w, h) -> { ok, primary, secondary, reason }   rgba = RGBA bytes (ImageData.data)
 *   readableOn(bg) -> '#ffffff' | '#111111' (whichever has the higher contrast on bg)
 *   contrast(a, b) -> WCAG ratio 1..21; ensureContrast(hex, fg, min) darkens; ensureVisibleOnDark(hex, min) lightens
 */
(function (root) {
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const HEX = /^#([0-9a-f]{6})$/i;
  const isHex = (s) => typeof s === 'string' && HEX.test(s.trim());
  const norm = (s, d) => (isHex(s) ? s.trim().toLowerCase() : d);
  function hexToRgb(h) { const m = HEX.exec(String(h).trim()); if (!m) return [0, 0, 0]; const n = parseInt(m[1], 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; }
  function rgbToHex(r, g, b) { return '#' + [r, g, b].map((v) => clamp(Math.round(v), 0, 255).toString(16).padStart(2, '0')).join(''); }
  function lum(hex) {
    const c = hexToRgb(hex).map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); });
    return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  }
  function contrast(a, b) { const la = lum(a), lb = lum(b), hi = Math.max(la, lb), lo = Math.min(la, lb); return (hi + 0.05) / (lo + 0.05); }
  function readableOn(bg) { return contrast(bg, '#ffffff') >= contrast(bg, '#111111') ? '#ffffff' : '#111111'; }
  function mix(hex, toward, t) { const a = hexToRgb(hex), b = hexToRgb(toward); return rgbToHex(a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t); }
  /** Darken hex (towards black) until fg text on it reaches min contrast. Returns hex unchanged when it already passes. */
  function ensureContrast(hex, fg, min) {
    fg = fg || '#ffffff'; min = min || 4.5; let out = hex;
    for (let i = 0; i < 40 && contrast(out, fg) < min; i++) out = mix(out, '#000000', 0.06);
    return out;
  }
  /** Lighten hex until it stands out (>= min contrast) against the dark graphics panels (#0c0d12). */
  function ensureVisibleOnDark(hex, min) {
    min = min || 3; let out = hex;
    for (let i = 0; i < 40 && contrast(out, '#0c0d12') < min; i++) out = mix(out, '#ffffff', 0.08);
    return out;
  }
  function rgbToHsv(r, g, b) {
    r /= 255; g /= 255; b /= 255; const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn; let h = 0;
    if (d) { if (mx === r) h = ((g - b) / d) % 6; else if (mx === g) h = (b - r) / d + 2; else h = (r - g) / d + 4; h *= 60; if (h < 0) h += 360; }
    return [h, mx ? d / mx : 0, mx];
  }
  const hueDist = (a, b) => { const d = Math.abs(a - b) % 360; return d > 180 ? 360 - d : d; };

  /**
   * Find the logo's main colour(s). Transparent pixels, near-white, near-black and grey are ignored (they are background or ink, not "brand").
   * Pixels are grouped into 24 hue bins, each pixel counting by how saturated it is. The heaviest bin is the primary colour (its average);
   * the secondary is the heaviest bin at least 40 degrees away that has at least 15% of the primary's weight, else a darker shade of the primary.
   * A logo with no real colour (black and white) returns ok:false so the caller can keep the current colours and say so.
   */
  function extractPalette(rgba, w, h) {
    if (!rgba || !w || !h || rgba.length < w * h * 4) return { ok: false, reason: 'empty' };
    const BINS = 24, bins = []; for (let i = 0; i < BINS; i++) bins.push({ wt: 0, r: 0, g: 0, b: 0 });
    const step = Math.max(1, Math.floor(Math.sqrt((w * h) / 40000))); let used = 0, seen = 0;
    for (let y = 0; y < h; y += step) for (let x = 0; x < w; x += step) {
      const i = (y * w + x) * 4, a = rgba[i + 3]; if (a < 128) continue; seen++;
      const r = rgba[i], g = rgba[i + 1], b = rgba[i + 2], hsv = rgbToHsv(r, g, b);
      if (hsv[1] < 0.28 || hsv[2] < 0.22 || (hsv[2] > 0.97 && hsv[1] < 0.4)) continue;
      const k = Math.floor(hsv[0] / (360 / BINS)) % BINS, wt = hsv[1] * hsv[1]; const bn = bins[k];
      bn.wt += wt; bn.r += r * wt; bn.g += g * wt; bn.b += b * wt; used++;
    }
    if (!seen) return { ok: false, reason: 'transparent' };
    if (used < Math.max(8, seen * 0.04)) return { ok: false, reason: 'no-colour' };
    // merge each bin with its two neighbours so a colour that straddles a bin edge still wins as one colour
    const score = bins.map((_, k) => bins[k].wt + bins[(k + 1) % BINS].wt + bins[(k + BINS - 1) % BINS].wt);
    let best = 0; for (let k = 1; k < BINS; k++) if (score[k] > score[best]) best = k;
    const avg = (k) => { let wt = 0, r = 0, g = 0, b = 0; [k - 1, k, k + 1].forEach((j) => { const bn = bins[(j + BINS) % BINS]; wt += bn.wt; r += bn.r; g += bn.g; b += bn.b; }); return wt ? rgbToHex(r / wt, g / wt, b / wt) : null; };
    const primary = avg(best), ph = rgbToHsv.apply(null, hexToRgb(primary))[0];
    let sec = null, secScore = 0;
    for (let k = 0; k < BINS; k++) {
      const hue = (k + 0.5) * (360 / BINS); if (hueDist(hue, ph) < 40) continue;
      if (score[k] > secScore && score[k] >= score[best] * 0.15) { secScore = score[k]; sec = avg(k); }
    }
    return { ok: true, primary, secondary: sec || mix(primary, '#000000', 0.55), secondaryFromLogo: !!sec };
  }

  const api = { isHex, norm, hexToRgb, rgbToHex, contrast, readableOn, mix, ensureContrast, ensureVisibleOnDark, extractPalette };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else { root.VS = root.VS || {}; root.VS.BrandCore = api; }
})(typeof window !== 'undefined' ? window : globalThis);
