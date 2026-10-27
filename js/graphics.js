/**
 * Broadcast graphics (brief F1): lower thirds, news ticker, clock, LIVE tag, and a rundown of lower thirds you trigger with
 * one tap or the keys 1-9. Drawn on a transparent canvas here (main thread), sent to the renderer as a bitmap, and composited
 * over the finished frame, so graphics appear in the preview, recordings AND streams.
 * v0.26 adds: 4 lower-third styles, breaking banner, full-screen card (optional QR), countdown, social handle chip, QR corner,
 * channel bug, and applySpec() so the Show Conductor (js/show.js) can drive everything from one cue.
 * v0.27 adds: brand kit (accent "Brand" = colours taken from the logo, text colour picked for contrast), safe-area margin option, scoreboard with game clock.
 * NOT built yet: animated logo bug, per-step transitions.
 */
(function () {
  const KEY = 'vs_gfx';
  const W = 960, H = 540;                    // drawing resolution; the renderer stretches it to the output size
  const ACCENTS = { Blue: '#2f6bff', Red: '#e0343a', Green: '#1f9d62', Gold: '#d9a521', Purple: '#7a4fd6', Black: '#15161a', Brand: '#5e6ad2' };   // Brand is kept in step with state.brand.primary

  // ---- pure helpers (unit-tested in tools/e2e/unit_graphics.js)
  const easeOut = (t) => 1 - Math.pow(1 - Math.max(0, Math.min(1, t)), 3);
  // Lower-third slide progress 0..1 given when it was shown/hidden. Returns {p, visible}.
  function ltProgress(now, shownAt, hiddenAt, inMs, outMs) {
    if (shownAt == null) return { p: 0, visible: false };
    if (hiddenAt != null && hiddenAt >= shownAt) {
      const q = 1 - (now - hiddenAt) / outMs;
      return q <= 0 ? { p: 0, visible: false } : { p: easeOut(q), visible: true };
    }
    return { p: easeOut((now - shownAt) / inMs), visible: true };
  }
  // Ticker x offset: text scrolls right to left and wraps; unit = pixels in drawing space.
  function tickerOffset(elapsedMs, pxPerSec, loopWidth) {
    if (loopWidth <= 0) return 0;
    return -((elapsedMs / 1000) * pxPerSec) % loopWidth;
  }
  // Game clock text from elapsed ms: 07:05, or 90:00 (minutes keep counting, football style)
  function gameClockText(ms) { const s = Math.max(0, Math.floor(ms / 1000)); return pad2(Math.floor(s / 60)) + ':' + pad2(s % 60); }
  function pad2(n) { return n < 10 ? '0' + n : '' + n; }
  // Countdown text from milliseconds left: 02:05, or 1:02:05 past an hour. Rounds UP so it shows 00:01 until it really ends.
  function countdownText(ms) {
    const s = Math.max(0, Math.ceil(ms / 1000)), h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = s % 60;
    return h ? h + ':' + pad2(m) + ':' + pad2(r) : pad2(m) + ':' + pad2(r);
  }
  // Split text into at most maxLines lines that fit maxW (measure = fn(text) -> width). Long single words are cut; the last line gets an ellipsis if text is left over.
  function wrapLines(measure, text, maxW, maxLines) {
    const words = String(text || '').split(/\s+/).filter(Boolean), lines = []; let cur = '', i = 0;
    for (; i < words.length; i++) {
      let w = words[i];
      while (measure(w) > maxW && w.length > 1) { if (cur) { lines.push(cur); cur = ''; if (lines.length >= maxLines) break; } let k = w.length; while (k > 1 && measure(w.slice(0, k)) > maxW) k--; lines.push(w.slice(0, k)); w = w.slice(k); if (lines.length >= maxLines) break; }
      if (lines.length >= maxLines) break;
      const t = cur ? cur + ' ' + w : w;
      if (measure(t) <= maxW) cur = t; else { if (cur) lines.push(cur); cur = w; if (lines.length >= maxLines) break; }
    }
    if (cur && lines.length < maxLines) lines.push(cur);
    const used = lines.join(' ').split(/\s+/).filter(Boolean).length;
    if (used < words.length && lines.length) { let l = lines[lines.length - 1]; while (l.length > 1 && measure(l + '…') > maxW) l = l.slice(0, -1); lines[lines.length - 1] = l + '…'; }
    return lines;
  }
  const TEMPLATES = ['classic', 'minimal', 'glass', 'bold'];
  function clockText(d) { return pad2(d.getHours()) + ':' + pad2(d.getMinutes()); }

  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
  }

  const BC = () => (window.VS && window.VS.BrandCore) || { isHex: (v) => /^#[0-9a-f]{6}$/i.test(v), norm: (v, d) => (/^#[0-9a-f]{6}$/i.test(v) ? v : d), readableOn: () => '#ffffff', ensureContrast: (h) => h, ensureVisibleOnDark: (h) => h, extractPalette: () => ({ ok: false, reason: 'missing' }), contrast: () => 21 };
  const state = {
    lt: { name: 'Your Name', title: 'Your title or topic', accent: 'Blue', template: 'classic', shownAt: null, hiddenAt: null },
    banner: { label: 'BREAKING', text: 'Type your headline here', shownAt: null, hiddenAt: null },
    card: { title: 'Starting soon', sub: 'Thanks for waiting', accent: 'Blue', qr: '', shownAt: null, hiddenAt: null },
    countdown: { label: 'Starting in', endAt: null, doneAt: null },
    social: { on: false, text: '@yourhandle' },
    qr: { on: false, text: 'https://example.com', caption: 'Scan me' },
    bug: { on: false, text: 'YOUR CHANNEL', logo: false },
    ticker: { on: false, text: 'Breaking: type your headline here  •  Welcome to the broadcast', speed: 90, since: 0 },
    brand: { primary: ACCENTS.Brand, secondary: '#2a2f66', fromLogo: false },
    safe: false,                               // true = keep tags, QR, banner and scoreboard 5% in from the edges (title-safe)
    score: { on: false, home: 'HOME', away: 'AWAY', h: 0, a: 0, period: '', showClock: false, base: 0, startedAt: null },
    clock: false, live: false,
    rundown: [],                               // [{name,title,accent}]
  };
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) || 'null');
    if (saved) {
      Object.assign(state.lt, saved.lt || {}, { shownAt: null, hiddenAt: null }); Object.assign(state.ticker, saved.ticker || {}, { on: false }); state.rundown = saved.rundown || [];
      const x = saved.ext || {};
      if (x.banner) { state.banner.label = String(x.banner.label || state.banner.label).slice(0, 20); state.banner.text = String(x.banner.text || state.banner.text).slice(0, 140); }
      if (x.card) Object.assign(state.card, { title: String(x.card.title || '').slice(0, 80), sub: String(x.card.sub || '').slice(0, 140), accent: x.card.accent || 'Blue', qr: String(x.card.qr || '').slice(0, 200) });
      if (x.social) state.social.text = String(x.social.text || state.social.text).slice(0, 40);
      if (x.qr) { state.qr.text = String(x.qr.text || state.qr.text).slice(0, 200); state.qr.caption = String(x.qr.caption || '').slice(0, 30); }
      if (x.brand && BC().isHex(x.brand.primary)) { state.brand.primary = x.brand.primary; state.brand.secondary = BC().norm(x.brand.secondary, state.brand.secondary); state.brand.fromLogo = !!x.brand.fromLogo; ACCENTS.Brand = state.brand.primary; }
      state.safe = !!x.safe;
      if (x.score) { const sc = x.score; state.score.home = String(sc.home || state.score.home).slice(0, 14); state.score.away = String(sc.away || state.score.away).slice(0, 14); state.score.period = String(sc.period || '').slice(0, 10); }
      if (x.bug) { state.bug.text = String(x.bug.text || state.bug.text).slice(0, 24); state.bug.logo = !!x.bug.logo; }
    }
  } catch (e) {}
  function save() { try { localStorage.setItem(KEY, JSON.stringify({ lt: { name: state.lt.name, title: state.lt.title, accent: state.lt.accent, template: state.lt.template }, ticker: { text: state.ticker.text, speed: state.ticker.speed }, rundown: state.rundown, ext: { banner: { label: state.banner.label, text: state.banner.text }, card: { title: state.card.title, sub: state.card.sub, accent: state.card.accent, qr: state.card.qr }, social: { text: state.social.text }, qr: { text: state.qr.text, caption: state.qr.caption }, bug: { text: state.bug.text, logo: state.bug.logo }, brand: { primary: state.brand.primary, secondary: state.brand.secondary, fromLogo: state.brand.fromLogo }, safe: state.safe, score: { home: state.score.home, away: state.score.away, period: state.score.period } } })); } catch (e) {} }

  const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
  const ctx = cv.getContext('2d');
  const FONT = 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';

  // ---- lower-third styles. All take the same box (x0,y,bw,bh) and are drawn inside an already-translated, already-faded context.
  function drawLT(ctx, tpl, x0, y, bw, bh, accent, name, title) {
    ctx.textBaseline = 'alphabetic';
    const raw = accent; accent = BC().ensureVisibleOnDark(raw, 3);              // a dark brand colour must still show as a stripe on the dark panels
    const nameFont = '700 ' + Math.round(bh * 0.40) + 'px ' + FONT, subFont = '400 ' + Math.round(bh * 0.27) + 'px ' + FONT;
    if (tpl === 'minimal') {
      ctx.fillStyle = accent; ctx.fillRect(x0, y + bh * 0.04, Math.min(bw * 0.35, 220), 5);
      ctx.save(); ctx.shadowColor = 'rgba(0,0,0,0.75)'; ctx.shadowBlur = 8; ctx.fillStyle = '#fff';
      ctx.font = nameFont; ctx.fillText(fit(name, bw, ctx), x0, y + bh * 0.52);
      ctx.fillStyle = 'rgba(255,255,255,0.9)'; ctx.font = subFont; ctx.fillText(fit(title, bw, ctx), x0, y + bh * 0.86); ctx.restore();
    } else if (tpl === 'glass') {
      ctx.fillStyle = 'rgba(255,255,255,0.18)'; roundRect(ctx, x0, y, bw, bh, 16); ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,0.35)'; ctx.lineWidth = 1.5; roundRect(ctx, x0, y, bw, bh, 16); ctx.stroke();
      ctx.fillStyle = accent; roundRect(ctx, x0 + 12, y + bh * 0.18, 6, bh * 0.64, 3); ctx.fill();
      ctx.save(); ctx.shadowColor = 'rgba(0,0,0,0.6)'; ctx.shadowBlur = 6; ctx.fillStyle = '#fff';
      ctx.font = nameFont; ctx.fillText(fit(name, bw - 50, ctx), x0 + 32, y + bh * 0.50);
      ctx.fillStyle = 'rgba(255,255,255,0.92)'; ctx.font = subFont; ctx.fillText(fit(title, bw - 50, ctx), x0 + 32, y + bh * 0.83); ctx.restore();
    } else if (tpl === 'bold') {
      const top = bh * 0.58;
      ctx.fillStyle = raw; ctx.fillRect(x0, y, bw, top);
      ctx.fillStyle = 'rgba(12,13,18,0.92)'; ctx.fillRect(x0, y + top, bw, bh - top);
      ctx.fillStyle = BC().readableOn(raw); ctx.font = '800 ' + Math.round(top * 0.62) + 'px ' + FONT; ctx.fillText(fit(String(name).toUpperCase(), bw - 36, ctx), x0 + 18, y + top * 0.72);
      ctx.fillStyle = 'rgba(255,255,255,0.9)'; ctx.font = '500 ' + Math.round((bh - top) * 0.55) + 'px ' + FONT; ctx.fillText(fit(title, bw - 36, ctx), x0 + 18, y + top + (bh - top) * 0.7);
    } else {                                                                                    // classic
      ctx.fillStyle = accent; roundRect(ctx, x0, y, 10, bh, 4); ctx.fill();
      ctx.fillStyle = 'rgba(12,13,18,0.86)'; roundRect(ctx, x0 + 14, y, bw, bh, 8); ctx.fill();
      ctx.fillStyle = '#fff'; ctx.font = nameFont; ctx.fillText(fit(name, bw - 36, ctx), x0 + 32, y + bh * 0.48);
      ctx.fillStyle = 'rgba(255,255,255,0.82)'; ctx.font = subFont; ctx.fillText(fit(title, bw - 36, ctx), x0 + 32, y + bh * 0.82);
    }
  }
  const qrMemo = {};                                                                              // encoding is cheap but this runs ~15x/s: remember the last few
  function getQr(text) { if (!window.VS.QR || !text) return null; if (!(text in qrMemo)) { if (Object.keys(qrMemo).length > 6) for (const k in qrMemo) delete qrMemo[k]; qrMemo[text] = window.VS.QR.encode(text, 'M'); } return qrMemo[text]; }
  // Corner QR side in drawing space: denser codes (longer text) get a bigger plate so each dot stays scannable.
  const cornerQrSize = (q) => H * (q.version <= 2 ? 0.26 : q.version <= 5 ? 0.32 : 0.40);
  function drawQr(ctx, text, x, y, size) {                                                      // white plate + dark modules, with the 4-module quiet zone scanners need
    const q = getQr(text); if (!q) return false;
    const n = q.size + 8, cell = size / n;
    ctx.fillStyle = '#fff'; roundRect(ctx, x, y, size, size, 6); ctx.fill(); ctx.fillStyle = '#000';
    for (let r = 0; r < q.size; r++) for (let c = 0; c < q.size; c++) if (q.get(c, r)) ctx.fillRect(Math.round(x + (c + 4) * cell), Math.round(y + (r + 4) * cell), Math.ceil(cell), Math.ceil(cell));
    return true;
  }
  let logoImg = null, logoSrc = '';
  function brandLogo() {
    try {
      const snap = window.VS.currentConfigSnapshot && window.VS.currentConfigSnapshot(); const src = snap && snap.logoDataUrl;
      if (!src) return null;
      if (src !== logoSrc) { logoSrc = src; logoImg = new Image(); logoImg.src = src; }
      return logoImg && logoImg.complete && logoImg.naturalWidth ? logoImg : null;
    } catch (e) { return null; }
  }

  function draw(now) {
    ctx.clearRect(0, 0, W, H);
    let any = false;
    const mx = state.safe ? W * 0.05 : 20, my = state.safe ? H * 0.05 : 20;                   // edge margins (title-safe when the option is on)
    const accentOf = (k) => (k === 'Brand' ? state.brand.primary : ACCENTS[k] || ACCENTS.Blue);
    const stripeOf = (k) => BC().ensureVisibleOnDark(accentOf(k), 3);
    // Full-screen card goes first so every tag, banner and lower third stays readable on top of it
    const cd = ltProgress(now, state.card.shownAt, state.card.hiddenAt, 350, 350);
    if (cd.visible) {
      any = true; ctx.save(); ctx.globalAlpha = cd.p;
      const ac = BC().ensureContrast(accentOf(state.card.accent), '#ffffff', 4.5), g = ctx.createLinearGradient(0, 0, W, H); g.addColorStop(0, ac); g.addColorStop(1, '#0b0c10');
      ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
      const hasQr = !!getQr(state.card.qr), tw = hasQr ? W * 0.5 : W * 0.8, tx = hasQr ? W * 0.08 : W * 0.1;
      ctx.fillStyle = '#fff'; ctx.textBaseline = 'alphabetic'; ctx.textAlign = 'left';
      const tsz = Math.round(H * 0.11); ctx.font = '800 ' + tsz + 'px ' + FONT;
      const tl = wrapLines((t) => ctx.measureText(t).width, state.card.title, tw, 3);
      const blockH = tl.length * tsz * 1.12 + (state.card.sub ? H * 0.12 : 0); let ty = (H - blockH) / 2 + tsz * 0.9;
      tl.forEach((ln) => { ctx.fillText(ln, tx, ty); ty += tsz * 1.12; });
      if (state.card.sub) { const ssz = Math.round(H * 0.052); ctx.font = '400 ' + ssz + 'px ' + FONT; ctx.fillStyle = 'rgba(255,255,255,0.88)'; wrapLines((t) => ctx.measureText(t).width, state.card.sub, tw, 2).forEach((ln) => { ctx.fillText(ln, tx, ty + ssz * 0.3); ty += ssz * 1.25; }); }
      if (hasQr) drawQr(ctx, state.card.qr, W * 0.65, H * 0.27, H * 0.54);
      ctx.restore();
    }
    // Lower third (style = state.lt.template)
    const lt = ltProgress(now, state.lt.shownAt, state.lt.hiddenAt, 450, 320);
    if (lt.visible) {
      any = true;
      const x0 = W * 0.05, y = H * (state.ticker.on ? 0.68 : 0.74), bw = Math.min(W * 0.62, 620), bh = H * 0.15;
      const slide = (1 - lt.p) * (bw + x0 + 20);
      ctx.save(); ctx.translate(-slide, 0); ctx.globalAlpha = Math.min(1, lt.p * 1.4);
      drawLT(ctx, state.lt.template, x0, y, bw, bh, accentOf(state.lt.accent), state.lt.name, state.lt.title);
      ctx.restore();
    }
    // Ticker
    if (state.ticker.on) {
      any = true;
      const bh = H * 0.075, y = H - bh;
      ctx.fillStyle = 'rgba(10,10,14,0.9)'; ctx.fillRect(0, y, W, bh);
      ctx.fillStyle = state.lt.accent === 'Brand' ? BC().ensureVisibleOnDark(state.brand.secondary, 3) : stripeOf(state.lt.accent); ctx.fillRect(0, y, 8, bh);
      ctx.save(); ctx.beginPath(); ctx.rect(14, y, W - 14, bh); ctx.clip();
      ctx.fillStyle = '#fff'; ctx.font = '600 ' + Math.round(bh * 0.5) + 'px ' + FONT; ctx.textBaseline = 'middle';
      const unit = state.ticker.text.trim() + '      •      ';
      const uw = Math.max(40, ctx.measureText(unit).width);
      const off = tickerOffset(now - state.ticker.since, state.ticker.speed, uw);
      for (let x = off; x < W; x += uw) ctx.fillText(unit, x + 20, y + bh / 2);
      ctx.restore();
    }
    // Right-hand stack above the ticker: QR corner, then social handle
    const floor = H - (state.ticker.on ? H * 0.075 : 0) - (state.safe && !state.ticker.on ? H * 0.05 : 16); let stackY = floor;
    if (state.social.on) { any = true; stackY -= 36; pill(ctx, W - mx, stackY, state.social.text, 'rgba(10,10,14,0.82)', '#fff', true); stackY -= 10; }
    if (state.qr.on) {
      const q0 = getQr(state.qr.text), qs = q0 ? cornerQrSize(q0) : 0; stackY -= qs;
      if (q0 && drawQr(ctx, state.qr.text, W - mx - qs, stackY, qs)) { any = true; if (state.qr.caption) { ctx.save(); ctx.font = '600 16px ' + FONT; ctx.textAlign = 'center'; ctx.fillStyle = '#fff'; ctx.shadowColor = 'rgba(0,0,0,0.8)'; ctx.shadowBlur = 5; ctx.fillText(state.qr.caption, W - 20 - qs / 2, stackY - 6); ctx.restore(); } }
    }
    // Clock + LIVE tag + channel bug (top corners)
    let topRight = my;
    if (state.clock) { any = true; pill(ctx, W - mx, topRight, clockText(new Date()), 'rgba(10,10,14,0.8)', '#fff', true); topRight += 44; }
    let bugW = 0;
    if (state.bug.on) {
      any = true; const logo = state.bug.logo ? brandLogo() : null; const lh = 36;
      ctx.save(); ctx.font = '800 20px ' + FONT; const tw = state.bug.text ? ctx.measureText(state.bug.text).width : 0, lw = logo ? Math.min(90, logo.naturalWidth * (lh - 8) / logo.naturalHeight) : 0;
      bugW = tw + lw + (tw && lw ? 8 : 0) + 24; const bx = W - mx - bugW;
      ctx.fillStyle = 'rgba(10,10,14,0.82)'; roundRect(ctx, bx, topRight, bugW, lh, 8); ctx.fill();
      ctx.fillStyle = state.lt.accent === 'Brand' ? BC().ensureVisibleOnDark(state.brand.secondary, 3) : stripeOf(state.lt.accent); ctx.fillRect(bx, topRight + 6, 4, lh - 12);
      let cx = bx + 14; if (logo) { ctx.drawImage(logo, cx, topRight + 4, lw, lh - 8); cx += lw + 8; }
      ctx.fillStyle = '#fff'; ctx.textBaseline = 'middle'; if (tw) ctx.fillText(state.bug.text, cx, topRight + lh / 2 + 1); ctx.restore();
    }
    let leftY = my;
    if (state.live) { any = true; pill(ctx, mx, my, '● LIVE', '#d4202a', '#fff', false); leftY = my + 44; }
    // Countdown (top centre)
    if (state.countdown.endAt != null) {
      const left = state.countdown.endAt - now;
      if (left <= -1500) { state.countdown.endAt = null; }
      else {
        any = true; const txt = (state.countdown.label ? state.countdown.label + '  ' : '') + countdownText(Math.max(0, left));
        pill(ctx, W / 2, my, txt, left <= 10000 && left > 0 ? '#d4202a' : 'rgba(10,10,14,0.86)', '#fff', 'center');
      }
    }
    // Scoreboard (top left, under the LIVE tag)
    let bannerY = my + 44;
    if (state.score.on) { any = true; drawScore(ctx, mx, leftY, now); bannerY = leftY + 52; }
    // Breaking banner (slides down under the top tags)
    const bn = ltProgress(now, state.banner.shownAt, state.banner.hiddenAt, 380, 300);
    if (bn.visible) {
      any = true; const bh = H * 0.09, by = bannerY, bx = mx, bw2 = W - 2 * mx - (bugW ? bugW + 12 : 0);
      ctx.save(); ctx.translate(0, -(1 - bn.p) * (by + bh + 10)); ctx.globalAlpha = Math.min(1, bn.p * 1.5);
      ctx.fillStyle = 'rgba(10,10,14,0.92)'; roundRect(ctx, bx, by, bw2, bh, 8); ctx.fill();
      ctx.font = '800 ' + Math.round(bh * 0.46) + 'px ' + FONT; const lw = ctx.measureText(state.banner.label).width + 36;
      ctx.fillStyle = '#d4202a'; roundRect(ctx, bx, by, lw, bh, 8); ctx.fill();
      ctx.fillStyle = '#fff'; ctx.textBaseline = 'middle'; ctx.fillText(state.banner.label, bx + 18, by + bh / 2 + 1);
      ctx.font = '600 ' + Math.round(bh * 0.44) + 'px ' + FONT; ctx.fillText(fit(state.banner.text, bw2 - lw - 28, ctx), bx + lw + 14, by + bh / 2 + 1);
      ctx.restore();
    }
    return any;
  }
  // Scoreboard plate: HOME [ 2 - 1 ] AWAY, then period and (optional) game clock. Scores sit on the brand/accent colour with readable text.
  function gameMs(now) { return state.score.base + (state.score.startedAt != null ? now - state.score.startedAt : 0); }
  function drawScore(c, x, y, now) {
    const sc = state.score, h = 44, ac = ACCENTS[state.lt.accent] ? (state.lt.accent === 'Brand' ? state.brand.primary : ACCENTS[state.lt.accent]) : ACCENTS.Blue;
    c.save(); c.textBaseline = 'middle'; c.font = '800 22px ' + FONT;
    const home = fit(String(sc.home).toUpperCase(), 150, c), away = fit(String(sc.away).toUpperCase(), 150, c), score = sc.h + '  -  ' + sc.a;
    const extra = [sc.period, sc.showClock ? gameClockText(gameMs(now)) : ''].filter(Boolean).join('   ');
    const wh = c.measureText(home).width, wa = c.measureText(away).width, ws = c.measureText(score).width, we = extra ? c.measureText(extra).width : 0;
    const total = 14 + wh + 14 + ws + 28 + 14 + wa + 14 + (extra ? we + 28 : 0);
    c.fillStyle = 'rgba(10,10,14,0.9)'; roundRect(c, x, y, total, h, 8); c.fill();
    let cx = x + 14; c.fillStyle = '#fff'; c.fillText(home, cx, y + h / 2 + 1); cx += wh + 14;
    c.fillStyle = ac; c.fillRect(cx, y + 4, ws + 28, h - 8); c.fillStyle = BC().readableOn(ac); c.fillText(score, cx + 14, y + h / 2 + 1); cx += ws + 28 + 14;
    c.fillStyle = '#fff'; c.fillText(away, cx, y + h / 2 + 1); cx += wa + 14;
    if (extra) { c.fillStyle = 'rgba(255,255,255,0.18)'; c.fillRect(cx, y + 8, 2, h - 16); c.fillStyle = 'rgba(255,255,255,0.92)'; c.font = '700 20px ' + FONT; c.fillText(extra, cx + 14, y + h / 2 + 1); }
    c.restore();
  }
  function fit(text, maxW, c) {
    text = String(text || ''); if (c.measureText(text).width <= maxW) return text;
    while (text.length > 1 && c.measureText(text + '…').width > maxW) text = text.slice(0, -1);
    return text + '…';
  }
  function pill(c, x, y, text, bg, fg, rightAlign) {
    c.save(); c.font = '700 22px ' + FONT; const w = c.measureText(text).width + 28, h = 36, px = rightAlign === 'center' ? x - w / 2 : rightAlign ? x - w : x;
    c.fillStyle = bg; roundRect(c, px, y, w, h, 18); c.fill(); c.fillStyle = fg; c.textBaseline = 'middle'; c.fillText(text, px + 14, y + h / 2 + 1); c.restore();
  }

  // ---- scheduler: only runs while something is visible; sends null once when everything is hidden
  let timer = 0, lastSentEmpty = true;
  function frame() {
    const any = draw(performance.now());
    if (any) {
      lastSentEmpty = false;
      createImageBitmap(cv).then((bmp) => { if (window.VS.rendererSend) window.VS.rendererSend({ type: 'graphicsBitmap', bitmap: bmp }, [bmp]); else bmp.close(); }).catch(() => {});
      timer = setTimeout(frame, 66);              // about 15 updates per second is plenty for slides, a ticker and a clock
    } else {
      timer = 0;
      if (!lastSentEmpty) { lastSentEmpty = true; if (window.VS.rendererSend) window.VS.rendererSend({ type: 'graphicsBitmap', bitmap: null }); }
    }
  }
  function kick() { if (!timer) frame(); }

  const listeners = []; const notify = () => listeners.forEach((fn) => { try { fn(); } catch (e) {} });
  let ltTimer = 0;
  const isOn = (o) => o.shownAt != null && (o.hiddenAt == null || o.hiddenAt < o.shownAt);
  const clampStr = (v, n) => String(v == null ? '' : v).slice(0, n);
  const api = {
    state, listeners,
    isOn: (k) => (k === 'lt' ? isOn(state.lt) : k === 'banner' ? isOn(state.banner) : k === 'card' ? isOn(state.card) : k === 'countdown' ? state.countdown.endAt != null : k === 'ticker' ? !!state.ticker.on : k === 'score' ? !!state.score.on : !!(state[k] && state[k].on)),
    showLT(item, secs) {
      if (item) Object.assign(state.lt, { name: item.name, title: item.title, accent: item.accent || state.lt.accent }, TEMPLATES.indexOf(item.template) >= 0 ? { template: item.template } : {});
      state.lt.shownAt = performance.now(); state.lt.hiddenAt = null; clearTimeout(ltTimer);
      if (secs > 0) ltTimer = setTimeout(() => api.hideLT(), Math.min(600, secs) * 1000);
      save(); kick(); notify();
    },
    hideLT() { clearTimeout(ltTimer); if (isOn(state.lt)) { state.lt.hiddenAt = performance.now(); kick(); notify(); } },
    toggleLT() { const on = isOn(state.lt); if (on) api.hideLT(); else api.showLT(); return !on; },
    setTemplate(t) { if (TEMPLATES.indexOf(t) >= 0) { state.lt.template = t; save(); kick(); notify(); } },
    setTicker(on) { state.ticker.on = !!on; if (on) state.ticker.since = performance.now(); kick(); notify(); },
    setClock(on) { state.clock = !!on; kick(); notify(); }, setLive(on) { state.live = !!on; kick(); notify(); },
    showBanner(o) { if (o) { if (o.label != null) state.banner.label = clampStr(o.label, 20) || 'BREAKING'; if (o.text != null) state.banner.text = clampStr(o.text, 140); } state.banner.shownAt = performance.now(); state.banner.hiddenAt = null; save(); kick(); notify(); },
    hideBanner() { if (isOn(state.banner)) { state.banner.hiddenAt = performance.now(); kick(); notify(); } },
    showCard(o) { if (o) { if (o.title != null) state.card.title = clampStr(o.title, 80); if (o.sub != null) state.card.sub = clampStr(o.sub, 140); if (o.accent && ACCENTS[o.accent]) state.card.accent = o.accent; if (o.qr != null) state.card.qr = clampStr(o.qr, 200); } state.card.shownAt = performance.now(); state.card.hiddenAt = null; save(); kick(); notify(); },
    hideCard() { if (isOn(state.card)) { state.card.hiddenAt = performance.now(); kick(); notify(); } },
    startCountdown(seconds, label) { const s = Math.max(1, Math.min(86400, +seconds || 0)); state.countdown.endAt = performance.now() + s * 1000; if (label != null) state.countdown.label = clampStr(label, 24); kick(); notify(); },
    stopCountdown() { state.countdown.endAt = null; kick(); notify(); },
    setSocial(on, text) { if (text != null) state.social.text = clampStr(text, 40); state.social.on = !!on; save(); kick(); notify(); },
    setQr(on, text, caption) { if (text != null) state.qr.text = clampStr(text, 200); if (caption != null) state.qr.caption = clampStr(caption, 30); state.qr.on = !!on; save(); kick(); notify(); },
    setBug(on, text, logo) { if (text != null) state.bug.text = clampStr(text, 24); if (logo != null) state.bug.logo = !!logo; state.bug.on = !!on; save(); kick(); notify(); },
    /** One cue's on-screen part. Missing keys are left alone. mode is 'show' or 'hide'. Used by the Show Conductor and unit-tested. */
    applySpec(sp) {
      sp = sp || {};
      const m = (o) => (o && o.mode === 'show' ? 1 : o && o.mode === 'hide' ? 0 : -1);
      if (sp.lt) { const k = m(sp.lt); if (k === 1) api.showLT({ name: clampStr(sp.lt.name != null ? sp.lt.name : state.lt.name, 60), title: clampStr(sp.lt.title != null ? sp.lt.title : state.lt.title, 90), accent: sp.lt.accent, template: sp.lt.template }, sp.lt.secs); else if (k === 0) api.hideLT(); }
      if (sp.ticker) { const k = m(sp.ticker); if (sp.ticker.text) { state.ticker.text = clampStr(sp.ticker.text, 300) || ' '; save(); } if (k === 1) api.setTicker(true); else if (k === 0) api.setTicker(false); }
      if (sp.banner) { const k = m(sp.banner); if (k === 1) api.showBanner(sp.banner); else if (k === 0) api.hideBanner(); }
      if (sp.card) { const k = m(sp.card); if (k === 1) api.showCard(sp.card); else if (k === 0) api.hideCard(); }
      if (sp.countdown) { const k = m(sp.countdown); if (k === 1) api.startCountdown(sp.countdown.seconds, sp.countdown.label); else if (k === 0) api.stopCountdown(); }
      if (sp.social) { const k = m(sp.social); if (k >= 0) api.setSocial(k === 1, sp.social.text); }
      if (sp.qr) { const k = m(sp.qr); if (k >= 0) api.setQr(k === 1, sp.qr.text, sp.qr.caption); }
      if (sp.score) { const k = m(sp.score); if (k >= 0) api.setScore(k === 1, sp.score); }
      if (sp.bug) { const k = m(sp.bug); if (k >= 0) api.setBug(k === 1, sp.bug.text, sp.bug.logo); }
      notify();
    },
    /** Brand kit: primary (accent) + secondary (ticker and channel stripes). Bad colours are ignored. */
    setBrand(primary, secondary, fromLogo) {
      if (BC().isHex(primary)) { state.brand.primary = primary.toLowerCase(); ACCENTS.Brand = state.brand.primary; }
      if (BC().isHex(secondary)) state.brand.secondary = secondary.toLowerCase();
      if (fromLogo != null) state.brand.fromLogo = !!fromLogo;
      save(); kick(); notify();
    },
    /** Use the brand colour for every template (lower third, card, scoreboard). Pass false to go back to Blue. */
    useBrandEverywhere(on) { const k = on ? 'Brand' : 'Blue'; state.lt.accent = k; state.card.accent = k; save(); kick(); notify(); },
    /** Read colours from an image element (the logo). Returns {ok, primary, secondary, reason}. Does not change anything by itself. */
    paletteFromImage(img) {
      try {
        const nw = img.naturalWidth || img.width, nh = img.naturalHeight || img.height; if (!nw || !nh) return { ok: false, reason: 'empty' };
        const sc = Math.min(1, 200 / Math.max(nw, nh)), w = Math.max(1, Math.round(nw * sc)), h = Math.max(1, Math.round(nh * sc));
        const cc = document.createElement('canvas'); cc.width = w; cc.height = h; const x = cc.getContext('2d', { willReadFrequently: true }); x.drawImage(img, 0, 0, w, h);
        return BC().extractPalette(x.getImageData(0, 0, w, h).data, w, h);
      } catch (e) { return { ok: false, reason: 'unreadable' }; }
    },
    setSafe(on) { state.safe = !!on; save(); kick(); notify(); },
    setScore(on, o) {
      const sc = state.score; o = o || {};
      if (o.home != null) sc.home = clampStr(o.home, 14) || 'HOME'; if (o.away != null) sc.away = clampStr(o.away, 14) || 'AWAY'; if (o.period != null) sc.period = clampStr(o.period, 10);
      if (o.h != null) sc.h = Math.max(0, Math.min(999, Math.round(+o.h) || 0)); if (o.a != null) sc.a = Math.max(0, Math.min(999, Math.round(+o.a) || 0));
      if (o.showClock != null) sc.showClock = !!o.showClock;
      if (on != null) sc.on = !!on; save(); kick(); notify();
    },
    scoreAdd(side, d) { const sc = state.score, k = side === 'a' ? 'a' : 'h'; sc[k] = Math.max(0, Math.min(999, sc[k] + (d | 0))); kick(); notify(); },
    scoreClock(cmd) {
      const sc = state.score, now = performance.now();
      if (cmd === 'start' && sc.startedAt == null) sc.startedAt = now; else if (cmd === 'stop' && sc.startedAt != null) { sc.base += now - sc.startedAt; sc.startedAt = null; } else if (cmd === 'reset') { sc.base = 0; sc.startedAt = null; }
      kick(); notify();
    },
    clearAll() { clearTimeout(ltTimer); state.score.on = false; const n = performance.now(); [state.lt, state.banner, state.card].forEach((o) => { if (isOn(o)) o.hiddenAt = n; }); state.ticker.on = false; state.countdown.endAt = null; state.social.on = false; state.qr.on = false; state.bug.on = false; kick(); notify(); },
    save, draw, canvas: cv, qrCornerPx: (text) => { const q = getQr(text); return q ? { modules: q.size + 8, side: cornerQrSize(q) } : null; }, pure: { ltProgress, tickerOffset, clockText, countdownText, wrapLines, gameClockText }, TEMPLATES, ACCENT_NAMES: Object.keys(ACCENTS),
  };
  window.VS = window.VS || {}; window.VS.Graphics = api;

  // ---- safe-area guides: a dashed 5% inset rectangle drawn over the preview canvas. It is a DOM element, so it is NEVER in the recording or stream.
  function setGuides(on) {
    try { localStorage.setItem('vs_guides', on ? '1' : '0'); } catch (e) {}
    let g = document.getElementById('safeGuide');
    if (!on) { if (g) g.hidden = true; return; }
    const frame = document.getElementById('previewFrame'), cvs = document.getElementById('canvas'); if (!frame || !cvs) return;
    if (!g) {
      g = document.createElement('div'); g.id = 'safeGuide'; g.setAttribute('aria-hidden', 'true');
      g.style.cssText = 'position:absolute;pointer-events:none;z-index:6;box-sizing:border-box;';
      g.innerHTML = '<div style="position:absolute;inset:5%;border:2px dashed rgba(255,255,255,0.75);box-shadow:0 0 0 1px rgba(0,0,0,0.5);border-radius:4px;"></div><div style="position:absolute;left:5%;top:5%;transform:translateY(-100%);font:600 11px system-ui,sans-serif;color:#fff;text-shadow:0 1px 3px #000;">Safe area</div>';
      frame.appendChild(g);
      const place = () => { const f = frame.getBoundingClientRect(), c = cvs.getBoundingClientRect(); g.style.left = (c.left - f.left) + 'px'; g.style.top = (c.top - f.top) + 'px'; g.style.width = c.width + 'px'; g.style.height = c.height + 'px'; };
      g._place = place; window.addEventListener('resize', place); if (window.ResizeObserver) { const ro = new ResizeObserver(place); ro.observe(cvs); ro.observe(frame); }
    }
    g.hidden = false; g._place();
  }

  // ---- panel wiring
  function init() {
    const $ = (id) => document.getElementById(id); if (!$('gfxName')) return;
    const name = $('gfxName'), title = $('gfxTitle'), accent = $('gfxAccent'), ltBtn = $('gfxLtToggle'), tOn = $('gfxTickerOn'), tText = $('gfxTickerText'), tSpeed = $('gfxTickerSpeed'), clk = $('gfxClock'), live = $('gfxLive'), list = $('gfxRundown');
    name.value = state.lt.name; title.value = state.lt.title; accent.innerHTML = Object.keys(ACCENTS).map((k) => '<option>' + k + '</option>').join(''); accent.value = state.lt.accent; tText.value = state.ticker.text; tSpeed.value = state.ticker.speed;
    const ltOn = () => state.lt.shownAt != null && (state.lt.hiddenAt == null || state.lt.hiddenAt < state.lt.shownAt);
    function sync() { ltBtn.textContent = ltOn() ? 'Hide lower third' : 'Show lower third'; }
    function renderList() {
      list.innerHTML = '';
      if (!state.rundown.length) { list.innerHTML = '<li class="honesty-note">Rundown is empty. Fill Name and Title above, then tap Add to rundown.</li>'; return; }
      state.rundown.forEach((it, i) => {
        const li = document.createElement('li'); li.style.cssText = 'display:flex;gap:8px;margin:6px 0;align-items:center;';
        const go = document.createElement('button'); go.type = 'button'; go.className = 'btn ghost sm'; go.style.cssText = 'flex:1;min-height:44px;text-align:left;'; go.textContent = (i < 9 ? (i + 1) + '. ' : '') + it.name + ' – ' + it.title; go.addEventListener('click', () => { api.showLT(it); name.value = it.name; title.value = it.title; accent.value = it.accent; sync(); });
        const rm = document.createElement('button'); rm.type = 'button'; rm.className = 'btn ghost sm'; rm.style.cssText = 'min-height:44px;min-width:44px;'; rm.setAttribute('aria-label', 'Remove ' + it.name); rm.textContent = '×'; rm.addEventListener('click', () => { state.rundown.splice(i, 1); save(); renderList(); });
        li.appendChild(go); li.appendChild(rm); list.appendChild(li);
      });
    }
    name.addEventListener('input', () => { state.lt.name = name.value; save(); kick(); });
    title.addEventListener('input', () => { state.lt.title = title.value; save(); kick(); });
    accent.addEventListener('change', () => { state.lt.accent = accent.value; save(); kick(); });
    ltBtn.addEventListener('click', () => { api.toggleLT(); sync(); });
    $('gfxAddRundown').addEventListener('click', () => { state.rundown.push({ name: name.value || 'Name', title: title.value || '', accent: accent.value }); save(); renderList(); });
    tOn.addEventListener('change', () => api.setTicker(tOn.checked));
    tText.addEventListener('input', () => { state.ticker.text = tText.value || ' '; save(); });
    tSpeed.addEventListener('input', () => { state.ticker.speed = +tSpeed.value; save(); });
    clk.addEventListener('change', () => api.setClock(clk.checked)); live.addEventListener('change', () => api.setLive(live.checked));
    document.addEventListener('keydown', (e) => {
      if (/INPUT|TEXTAREA|SELECT/.test((e.target && e.target.tagName) || '') || e.ctrlKey || e.metaKey || e.altKey) return;
      if (/^[1-9]$/.test(e.key) && state.rundown[+e.key - 1]) { const it = state.rundown[+e.key - 1]; api.showLT(it); name.value = it.name; title.value = it.title; accent.value = it.accent; sync(); }
      else if (e.key === 'h' || e.key === 'H') { api.hideLT(); sync(); }
    });
    // ---- v0.26 controls
    const tpl = $('gfxTemplate'); if (tpl) {
      const LABEL = { classic: 'Classic bar', minimal: 'Minimal line', glass: 'Glass card', bold: 'Bold block' };
      tpl.innerHTML = TEMPLATES.map((k) => '<option value="' + k + '">' + LABEL[k] + '</option>').join(''); tpl.value = state.lt.template;
      tpl.addEventListener('change', () => api.setTemplate(tpl.value));
      const bT = $('gfxBannerText'), bB = $('gfxBannerToggle'), cT = $('gfxCardTitle'), cS = $('gfxCardSub'), cQ = $('gfxCardQr'), cB = $('gfxCardToggle');
      bT.value = state.banner.text; cT.value = state.card.title; cS.value = state.card.sub; cQ.value = state.card.qr;
      bT.addEventListener('input', () => { state.banner.text = bT.value.slice(0, 140); save(); kick(); });
      bB.addEventListener('click', () => { if (isOn(state.banner)) api.hideBanner(); else api.showBanner({ text: bT.value }); });
      cT.addEventListener('input', () => { state.card.title = cT.value.slice(0, 80); save(); kick(); });
      cS.addEventListener('input', () => { state.card.sub = cS.value.slice(0, 140); save(); kick(); });
      cQ.addEventListener('input', () => { state.card.qr = cQ.value.slice(0, 200); save(); kick(); });
      cB.addEventListener('click', () => { if (isOn(state.card)) api.hideCard(); else api.showCard({ title: cT.value, sub: cS.value, qr: cQ.value, accent: accent.value }); });
      $('gfxCdStart').addEventListener('click', () => api.startCountdown((+$('gfxCdMin').value || 1) * 60, $('gfxCdLabel').value));
      $('gfxCdStop').addEventListener('click', () => api.stopCountdown());
      const soOn = $('gfxSocialOn'), soT = $('gfxSocialText'), qOn = $('gfxQrOn'), qT = $('gfxQrText'), qC = $('gfxQrCaption'), qN = $('gfxQrNote'), bgOn = $('gfxBugOn'), bgT = $('gfxBugText'), bgL = $('gfxBugLogo');
      soT.value = state.social.text; qT.value = state.qr.text; qC.value = state.qr.caption; bgT.value = state.bug.text; bgL.checked = !!state.bug.logo;
      const qrCheck = () => { const ok = !!(window.VS.QR && window.VS.QR.encode(qT.value, 'M')); qN.textContent = ok ? 'QR ready. A corner QR needs 720p or better to scan reliably (at low quality it is too small). The full-screen card QR is much bigger. Test it with another phone before you go live.' : 'That text is too long for a QR code here (about 200 characters at most) or empty.'; };
      soOn.addEventListener('change', () => api.setSocial(soOn.checked, soT.value)); soT.addEventListener('input', () => api.setSocial(soOn.checked, soT.value));
      qOn.addEventListener('change', () => api.setQr(qOn.checked, qT.value, qC.value)); qT.addEventListener('input', () => { qrCheck(); api.setQr(qOn.checked, qT.value, qC.value); }); qC.addEventListener('input', () => api.setQr(qOn.checked, qT.value, qC.value));
      bgOn.addEventListener('change', () => api.setBug(bgOn.checked, bgT.value, bgL.checked)); bgT.addEventListener('input', () => api.setBug(bgOn.checked, bgT.value, bgL.checked)); bgL.addEventListener('change', () => api.setBug(bgOn.checked, bgT.value, bgL.checked));
      $('gfxClearAll').addEventListener('click', () => api.clearAll());
      qrCheck();
      // keep the panel in step when a Show cue (or a Look) changes things
      listeners.push(() => {
        bB.textContent = isOn(state.banner) ? 'Hide banner' : 'Show banner'; cB.textContent = isOn(state.card) ? 'Hide card' : 'Show card';
        tpl.value = state.lt.template; name.value = state.lt.name; title.value = state.lt.title; accent.value = state.lt.accent; tText.value = state.ticker.text;
        tOn.checked = !!state.ticker.on; clk.checked = !!state.clock; live.checked = !!state.live; soOn.checked = !!state.social.on; qOn.checked = !!state.qr.on; bgOn.checked = !!state.bug.on;
        sync();
      });
    }
    // ---- v0.27 controls: brand kit, safe area, scoreboard
    const bP = $('brandPrimary'); if (bP) {
      const bS = $('brandSecondary'), bN = $('brandNote'), gOn = $('gfxGuides'), sOn = $('gfxSafe');
      const syncBrand = () => { bP.value = state.brand.primary; bS.value = state.brand.secondary; };
      const note = (t) => { bN.textContent = t; };
      bP.addEventListener('input', () => { api.setBrand(bP.value, null, false); note(BC().contrast(bP.value, '#ffffff') < 3 ? 'That colour is light. Text on it will switch to dark so it stays readable.' : ''); });
      bS.addEventListener('input', () => api.setBrand(null, bS.value));
      $('brandUse').addEventListener('click', () => { api.useBrandEverywhere(true); note('Lower thirds, cards and the scoreboard now use your brand colours.'); });
      $('brandOff').addEventListener('click', () => { api.useBrandEverywhere(false); note('Back to the standard blue.'); });
      $('brandFromLogo').addEventListener('click', () => {
        const img = brandLogo();
        if (!img) { note('No logo yet. Upload one in the Templates tab first, or pick the colours by hand above.'); return; }
        const r = api.paletteFromImage(img);
        if (!r.ok) { note(r.reason === 'no-colour' ? 'That logo is black, white or grey, so there is no brand colour to read. Pick your colours by hand above.' : 'Could not read colours from that logo. Pick them by hand above.'); return; }
        api.setBrand(r.primary, r.secondary, true); api.useBrandEverywhere(true);
        note('Done. Main colour ' + r.primary + (r.secondaryFromLogo ? ', second colour ' + r.secondary + '.' : ' (the second colour is a darker shade because the logo has only one).') + ' Change them above if they are not right.');
      });
      gOn.addEventListener('change', () => setGuides(gOn.checked)); sOn.checked = !!state.safe; sOn.addEventListener('change', () => api.setSafe(sOn.checked));
      try { gOn.checked = localStorage.getItem('vs_guides') === '1'; } catch (e) {} setGuides(gOn.checked);
      const sc = state.score, scOn = $('scOn'), scH = $('scHome'), scA = $('scAway'), scP = $('scPeriod'), scR = $('scRead'), scC = $('scClockOn');
      scH.value = sc.home; scA.value = sc.away; scP.value = sc.period;
      const read = () => { scR.textContent = sc.home.toUpperCase() + '  ' + sc.h + ' - ' + sc.a + '  ' + sc.away.toUpperCase(); scOn.checked = !!sc.on; scC.checked = !!sc.showClock; };
      scOn.addEventListener('change', () => api.setScore(scOn.checked)); scC.addEventListener('change', () => api.setScore(null, { showClock: scC.checked }));
      scH.addEventListener('input', () => api.setScore(null, { home: scH.value })); scA.addEventListener('input', () => api.setScore(null, { away: scA.value })); scP.addEventListener('input', () => api.setScore(null, { period: scP.value }));
      $('scHPlus').addEventListener('click', () => api.scoreAdd('h', 1)); $('scHMinus').addEventListener('click', () => api.scoreAdd('h', -1));
      $('scAPlus').addEventListener('click', () => api.scoreAdd('a', 1)); $('scAMinus').addEventListener('click', () => api.scoreAdd('a', -1));
      $('scClockStart').addEventListener('click', () => api.scoreClock('start')); $('scClockStop').addEventListener('click', () => api.scoreClock('stop')); $('scClockReset').addEventListener('click', () => api.scoreClock('reset'));
      $('scReset').addEventListener('click', () => { api.setScore(null, { h: 0, a: 0 }); api.scoreClock('reset'); });
      listeners.push(() => { syncBrand(); read(); sOn.checked = !!state.safe; });
      syncBrand(); read();
    }
    renderList(); sync();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
