/**
 * Looks (brief F8, partial): one tap sets environment + aspect + framing + realism + broadcast graphics.
 * Never changes quality or restarts the camera. Every look can be undone. Each look also sets a colour grade.
 */
(function () {
  const LOOKS = [
    { id: 'news', grade: { id: 'cool', strength: 0.6 },      name: 'News anchor', about: 'Newsroom, red accent, ticker, clock and LIVE tag',
      env: 'newsroom', aspect: '16:9', zoom: 1.0, realism: 0.75, gfx: { accent: 'Red', ticker: true, clock: true, live: true } },
    { id: 'podcast', grade: { id: 'cinema', strength: 0.5 },   name: 'Podcast', about: 'Podcast studio, purple accent, clean frame',
      env: 'podcast-studio', aspect: '16:9', zoom: 1.0, realism: 0.7, gfx: { accent: 'Purple', ticker: false, clock: false, live: false } },
    { id: 'teacher', grade: { id: 'soft', strength: 0.6 },   name: 'Teacher', about: 'Classroom, green accent, clock for lesson timing',
      env: 'classroom', aspect: '16:9', zoom: 1.0, realism: 0.6, gfx: { accent: 'Green', ticker: false, clock: true, live: false } },
    { id: 'creator', grade: { id: 'vivid', strength: 0.7 },   name: 'Creator (vertical)', about: 'Colour backdrop, 9:16 for phones and short video',
      env: 'color-backdrop-studio', aspect: '9:16', zoom: 1.0, realism: 0.7, gfx: { accent: 'Gold', ticker: false, clock: false, live: false } },
    { id: 'interview', grade: { id: 'warm', strength: 0.5 }, name: 'Interview', about: 'Interview studio, blue accent, lower third ready',
      env: 'interview-studio', aspect: '16:9', zoom: 1.0, realism: 0.7, gfx: { accent: 'Blue', ticker: false, clock: false, live: false } },
  ];
  const KEY = 'vs_look';
  window.VS = window.VS || {};
  window.VS.LOOKS = LOOKS;
  let undo = null;

  function gfxSnapshot() {
    const g = window.VS.Graphics; if (!g) return null;
    return { accent: g.state.lt.accent, ticker: !!g.state.ticker.on, clock: !!g.state.clock, live: !!g.state.live };
  }
  function applyGfx(x) {
    const g = window.VS.Graphics; if (!g || !x) return;
    g.state.lt.accent = x.accent; g.save();
    g.setTicker(x.ticker); g.setClock(x.clock); g.setLive(x.live);
    const set = (id, v) => { const e = document.getElementById(id); if (e) e.checked = !!v; };
    set('gfxTickerOn', x.ticker); set('gfxClock', x.clock); set('gfxLive', x.live);
    const a = document.getElementById('gfxAccent'); if (a) a.value = x.accent;
  }
  function apply(id) {
    const look = LOOKS.find((l) => l.id === id); if (!look || !window.VS.applyConfigSnapshot) return false;
    undo = { cfg: window.VS.currentConfigSnapshot(), gfx: gfxSnapshot(), grade: null };
    const prev = undo.cfg;
    window.VS.applyConfigSnapshot({
      env: look.env, aspect: look.aspect, zoom: look.zoom,
      realism: Object.assign({}, prev.realism, { enabled: true, intensity: look.realism }),
      brandColor: prev.brandColor, logoDataUrl: prev.logoDataUrl, watermark: prev.watermark,   // keep the user's own brand kit
    });
    applyGfx(look.gfx);
    if (look.grade && window.VS.Grade && window.VS.Grade.setPreset) undo.grade = window.VS.Grade.setPreset(look.grade.id, look.grade.strength);
    try { localStorage.setItem(KEY, id); } catch (e) {}
    return true;
  }
  function undoLook() {
    if (!undo) return false;
    const u = undo; undo = null;
    const cfg = Object.assign({}, u.cfg); delete cfg.quality;     // never restart the camera
    window.VS.applyConfigSnapshot(cfg); applyGfx(u.gfx);
    if (u.grade && window.VS.Grade && window.VS.Grade.setPreset) window.VS.Grade.setPreset(u.grade.id, u.grade.strength);
    try { localStorage.removeItem(KEY); } catch (e) {}
    return true;
  }
  window.VS.Looks = { apply, undo: undoLook, list: () => LOOKS.slice() };

  function init() {
    const list = document.getElementById('looksList'), btn = document.getElementById('looksUndo'), status = document.getElementById('looksStatus');
    if (!list) return;
    let current = null; try { current = localStorage.getItem(KEY); } catch (e) {}
    function mark() { list.querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.id === current))); }
    LOOKS.forEach((l) => {
      const b = document.createElement('button'); b.type = 'button'; b.className = 'btn ghost'; b.dataset.id = l.id; b.style.cssText = 'min-height:56px;text-align:left;display:block;width:100%;';
      b.innerHTML = '<strong></strong><br><small></small>'; b.querySelector('strong').textContent = l.name; b.querySelector('small').textContent = l.about;
      b.addEventListener('click', () => { if (apply(l.id)) { current = l.id; mark(); btn.disabled = false; status.textContent = l.name + ' look applied. Undo is available.'; } });
      list.appendChild(b);
    });
    btn.addEventListener('click', () => { if (undoLook()) { current = null; mark(); btn.disabled = true; status.textContent = 'Look undone.'; } });
    mark();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
