/**
 * Show Conductor core (pure logic, no DOM). A "show" is a list of cues (steps). Running a cue applies the parts it contains and
 * leaves everything else alone. Cue shape (every part optional):
 *   { id, label, say, gfx: { lt:{mode,name,title,accent,template,secs}, ticker:{mode,text}, banner:{mode,label,text},
 *     card:{mode,title,sub,accent,qr}, countdown:{mode,seconds,label}, social:{mode,text}, qr:{mode,text,caption}, bug:{mode,text,logo}, score:{mode,home,away,h,a,period} },
 *     look, audio, scene }
 * mode is 'show' or 'hide'. Anything from outside (imported text, old saves) goes through normaliseCue so a bad file can never
 * put junk into the renderer. Unit-tested in tools/e2e/unit_show.js.
 */
(function () {
  const VERSION = 1, MAX_CUES = 60, MAX_JSON = 200000;
  const ACCENTS = ['Blue', 'Red', 'Green', 'Gold', 'Purple', 'Black', 'Brand'], TEMPLATES = ['classic', 'minimal', 'glass', 'bold'];
  const str = (v, n) => (typeof v === 'string' || typeof v === 'number' ? String(v) : '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').slice(0, n);
  const mode = (v) => (v === 'show' || v === 'hide' ? v : null);
  const num = (v, lo, hi, d) => { const n = +v; return isFinite(n) ? Math.max(lo, Math.min(hi, n)) : d; };
  let counter = 0;
  const newId = () => 'c' + Date.now().toString(36) + (counter++).toString(36);

  function normaliseGfx(g) {
    const out = {}; if (!g || typeof g !== 'object') return out;
    if (g.lt && mode(g.lt.mode)) { const o = { mode: g.lt.mode }; if (g.lt.mode === 'show') { o.name = str(g.lt.name, 60); o.title = str(g.lt.title, 90); if (ACCENTS.indexOf(g.lt.accent) >= 0) o.accent = g.lt.accent; if (TEMPLATES.indexOf(g.lt.template) >= 0) o.template = g.lt.template; o.secs = num(g.lt.secs, 0, 600, 0); } out.lt = o; }
    if (g.ticker && mode(g.ticker.mode)) { const o = { mode: g.ticker.mode }; if (g.ticker.text) o.text = str(g.ticker.text, 300); out.ticker = o; }
    if (g.banner && mode(g.banner.mode)) { const o = { mode: g.banner.mode }; if (g.banner.mode === 'show') { if (g.banner.label) o.label = str(g.banner.label, 20); o.text = str(g.banner.text, 140); } out.banner = o; }
    if (g.card && mode(g.card.mode)) { const o = { mode: g.card.mode }; if (g.card.mode === 'show') { o.title = str(g.card.title, 80); o.sub = str(g.card.sub, 140); if (ACCENTS.indexOf(g.card.accent) >= 0) o.accent = g.card.accent; if (g.card.qr) o.qr = str(g.card.qr, 200); } out.card = o; }
    if (g.countdown && mode(g.countdown.mode)) { const o = { mode: g.countdown.mode }; if (g.countdown.mode === 'show') { o.seconds = num(g.countdown.seconds, 1, 86400, 60); if (g.countdown.label != null) o.label = str(g.countdown.label, 24); } out.countdown = o; }
    if (g.social && mode(g.social.mode)) { const o = { mode: g.social.mode }; if (g.social.text) o.text = str(g.social.text, 40); out.social = o; }
    if (g.qr && mode(g.qr.mode)) { const o = { mode: g.qr.mode }; if (g.qr.text) o.text = str(g.qr.text, 200); if (g.qr.caption != null) o.caption = str(g.qr.caption, 30); out.qr = o; }
    if (g.score && mode(g.score.mode)) { const o = { mode: g.score.mode }; if (g.score.mode === 'show') { if (g.score.home != null) o.home = str(g.score.home, 14); if (g.score.away != null) o.away = str(g.score.away, 14); if (g.score.h != null) o.h = Math.round(num(g.score.h, 0, 999, 0)); if (g.score.a != null) o.a = Math.round(num(g.score.a, 0, 999, 0)); if (g.score.period != null) o.period = str(g.score.period, 10); } out.score = o; }
    if (g.bug && mode(g.bug.mode)) { const o = { mode: g.bug.mode }; if (g.bug.text) o.text = str(g.bug.text, 24); if (g.bug.logo != null) o.logo = !!g.bug.logo; out.bug = o; }
    return out;
  }
  function normaliseCue(raw) {
    if (!raw || typeof raw !== 'object') return null;
    const c = { id: str(raw.id, 24).replace(/[^\w-]/g, '') || newId(), label: str(raw.label, 60).trim(), say: str(raw.say, 160), gfx: normaliseGfx(raw.gfx) };
    ['look', 'audio', 'scene'].forEach((k) => { const v = str(raw[k], 80).trim(); if (v) c[k] = v; });
    if (!c.label) c.label = 'Step';
    return c;
  }
  const isEmptyCue = (c) => !Object.keys(c.gfx).length && !c.look && !c.audio && !c.scene;

  /** Parse saved/imported text. Returns { ok, cues, dropped, error }. Never throws. */
  function parse(text) {
    if (typeof text !== 'string' || !text.trim()) return { ok: false, cues: [], dropped: 0, error: 'There is nothing to load. Paste a show first.' };
    if (text.length > MAX_JSON) return { ok: false, cues: [], dropped: 0, error: 'That text is too big to be a show.' };
    let data; try { data = JSON.parse(text); } catch (e) { return { ok: false, cues: [], dropped: 0, error: 'That does not look like a show. Copy the whole text again and retry.' }; }
    let list = Array.isArray(data) ? data : data && Array.isArray(data.cues) ? data.cues : null;
    if (!list) return { ok: false, cues: [], dropped: 0, error: 'That does not look like a show (no steps found).' };
    if (data && !Array.isArray(data) && data.v > VERSION) return { ok: false, cues: [], dropped: 0, error: 'This show was made with a newer version of Genesis. Update the app and try again.' };
    let dropped = 0; const cues = [], seen = {};
    list.slice(0, MAX_CUES).forEach((r) => { const c = normaliseCue(r); if (!c) { dropped++; return; } while (seen[c.id]) c.id = newId(); seen[c.id] = 1; cues.push(c); });
    dropped += Math.max(0, list.length - MAX_CUES);
    return { ok: true, cues, dropped, error: dropped ? dropped + ' step' + (dropped > 1 ? 's were' : ' was') + ' skipped (invalid or over the ' + MAX_CUES + ' step limit).' : '' };
  }
  const serialise = (cues) => JSON.stringify({ v: VERSION, app: 'genesis-studio', cues: cues.map((c) => normaliseCue(c)).filter(Boolean) }, null, 1);

  /** cur = index of the last step that ran (-1 = show not started). Returns the index to run, or null when there is nowhere to go. */
  function step(cur, len, dir) {
    if (dir === 'back') return cur >= 1 && len ? Math.min(cur - 1, len - 1) : null;
    return cur + 1 < len ? cur + 1 : null;
  }
  /** Plain-language one-liner of what a cue does, for the list. */
  function summarise(c) {
    const p = [], g = c.gfx || {};
    const w = (m) => (m === 'hide' ? 'hide' : 'show');
    if (g.lt) p.push(g.lt.mode === 'show' ? 'Lower third: ' + (g.lt.name || '') : 'Hide lower third');
    if (g.banner) p.push(g.banner.mode === 'show' ? 'Banner' : 'Hide banner');
    if (g.card) p.push(g.card.mode === 'show' ? 'Card' : 'Hide card');
    if (g.ticker) p.push(g.ticker.mode === 'show' ? 'Ticker on' : 'Ticker off');
    if (g.countdown) p.push(g.countdown.mode === 'show' ? 'Countdown' : 'Stop countdown');
    if (g.score) p.push(g.score.mode === 'show' ? 'Scoreboard' + (g.score.h != null && g.score.a != null ? ' ' + g.score.h + '-' + g.score.a : '') : 'Hide scoreboard');
    if (g.social) p.push('Handle ' + w(g.social.mode)); if (g.qr) p.push('QR ' + w(g.qr.mode)); if (g.bug) p.push('Channel name ' + w(g.bug.mode));
    if (c.scene) p.push('Scene'); if (c.look) p.push('Look: ' + c.look); if (c.audio) p.push('Audio: ' + c.audio);
    return p.length ? p.join(' • ') : 'No changes yet';
  }
  /** What the presenter sees: where we are, what is next, the private note. */
  function describe(cues, cur) {
    const n = cues.length, now = cur >= 0 && cur < n ? cues[cur] : null, nx = cues[cur + 1] || null;
    return { position: n ? (cur < 0 ? 'Not started (' + n + ' step' + (n > 1 ? 's' : '') + ')' : 'Step ' + (cur + 1) + ' of ' + n) : 'No steps yet', now: now ? now.label : '', next: nx ? nx.label : '', say: now ? now.say : (cues[0] ? cues[0].say : ''), atEnd: n > 0 && cur >= n - 1, started: cur >= 0 };
  }
  /** Graphics specs to apply (in order, after clearing the screen) so the picture equals "steps 1..target have run".
   *  Time-based parts of EARLIER steps are dropped: a countdown cannot be replayed and a lower third with a hide-timer would already be gone. */
  function replayGfx(cues, target) {
    const out = [];
    for (let i = 0; i <= target && i < cues.length; i++) {
      const g = JSON.parse(JSON.stringify(cues[i].gfx || {}));
      if (i < target) { delete g.countdown; if (g.lt && g.lt.mode === 'show' && g.lt.secs > 0) delete g.lt; }
      out.push(g);
    }
    return out;
  }
  const move = (cues, i, d) => { const j = i + d; if (i < 0 || j < 0 || i >= cues.length || j >= cues.length) return cues; const a = cues.slice(); const t = a[i]; a[i] = a[j]; a[j] = t; return a; };

  window.VS = window.VS || {};
  window.VS.ShowCore = { VERSION, MAX_CUES, normaliseCue, parse, serialise, step, summarise, describe, move, replayGfx, isEmptyCue, newId };
})();
