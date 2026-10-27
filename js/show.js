/**
 * Show Conductor (UI): a list of steps you run with one big NEXT. Each step can change graphics, look, scene and audio style at once.
 * The pure parts (validation, import/export, stepping) are in js/show-core.js. Graphics are applied through VS.Graphics.applySpec,
 * so everything a step shows is part of the recording and stream. The private note ("say") is DOM only and never recorded.
 * NEXT applies the next step on top of what is showing. BACK and tapping a step in the list REBUILD the on-screen graphics from steps 1..N
 * (ShowCore.replayGfx), so going back removes a card you no longer want. Look, scene and audio are set only from the step you land on.
 * Not verified on a real phone. Keys: Space/Right/PageDown = next, Left/PageUp = back, only when the "keys control the show" box is on.
 */
(function () {
  const KEY = 'vs_show', KEYS_ON = 'vs_show_keys';
  const Core = () => window.VS.ShowCore;
  let cues = [], cur = -1, editing = null;                         // editing: index, or -2 for a new step

  function load() { try { const r = Core().parse(localStorage.getItem(KEY) || ''); cues = r.ok ? r.cues : []; } catch (e) { cues = []; } }
  function save() { try { localStorage.setItem(KEY, Core().serialise(cues)); } catch (e) {} }
  const lookName = (id) => { const l = window.VS.Looks && window.VS.Looks.list().find((x) => x.id === id); return l ? l.name : id; };
  const audioName = (id) => { const P = window.VS.AudioPresets; return P && P.PRESETS[id] ? P.PRESETS[id].label : id; };

  /** Runs one step. Each part is tried on its own so one failure never blocks the rest. Returns a list of plain-language problems. */
  function runCue(c, gfxOverride) {
    const problems = [], V = window.VS;
    const attempt = (what, fn) => { try { const r = fn(); if (r === false) problems.push(what); } catch (e) { problems.push(what); } };
    if (c.look) attempt('the look', () => V.Looks && V.Looks.apply(c.look));
    if (c.scene) attempt('the scene', () => { if (!V.sceneApi) return false; V.sceneApi.pickEnv(c.scene); });
    if (c.audio) attempt('the audio style', () => {
      const sel = document.getElementById('audioPreset'); if (!sel || ![].some.call(sel.options, (o) => o.value === c.audio)) return false;
      sel.value = c.audio; sel.dispatchEvent(new Event('change'));
    });
    if (gfxOverride) attempt('the graphics', () => { V.Graphics.clearAll(); gfxOverride.forEach((g) => V.Graphics.applySpec(g)); });
    else if (c.gfx && Object.keys(c.gfx).length) attempt('the graphics', () => V.Graphics && V.Graphics.applySpec(c.gfx));
    return problems;
  }

  function go(index, rebuild) {
    if (index == null || index < 0 || index >= cues.length) return false;
    const problems = runCue(cues[index], rebuild ? Core().replayGfx(cues, index) : null); cur = index; render();
    const st = document.getElementById('showStatus');
    if (st) st.textContent = problems.length ? 'Step ' + (index + 1) + ' ran, but could not change ' + problems.join(' and ') + '. The rest worked.' : 'Step ' + (index + 1) + ' of ' + cues.length + ' ran.';
    return true;
  }
  const next = () => (cues.length ? go(Core().step(cur, cues.length, 'next')) : false);
  const back = () => go(Core().step(cur, cues.length, 'back'), true);

  // ---- capture what is on screen now as a step
  function capture() {
    const V = window.VS, g = V.Graphics, s = g.state, gfx = {};
    gfx.lt = g.isOn('lt') ? { mode: 'show', name: s.lt.name, title: s.lt.title, accent: s.lt.accent, template: s.lt.template, secs: 0 } : { mode: 'hide' };
    gfx.banner = g.isOn('banner') ? { mode: 'show', label: s.banner.label, text: s.banner.text } : { mode: 'hide' };
    gfx.card = g.isOn('card') ? { mode: 'show', title: s.card.title, sub: s.card.sub, accent: s.card.accent, qr: s.card.qr } : { mode: 'hide' };
    gfx.ticker = { mode: s.ticker.on ? 'show' : 'hide', text: s.ticker.on ? s.ticker.text : '' };
    gfx.social = s.social.on ? { mode: 'show', text: s.social.text } : { mode: 'hide' };
    gfx.qr = s.qr.on ? { mode: 'show', text: s.qr.text, caption: s.qr.caption } : { mode: 'hide' };
    gfx.score = s.score.on ? { mode: 'show', home: s.score.home, away: s.score.away, h: s.score.h, a: s.score.a, period: s.score.period } : { mode: 'hide' };
    gfx.bug = s.bug.on ? { mode: 'show', text: s.bug.text, logo: s.bug.logo } : { mode: 'hide' };
    const cue = { label: 'Saved screen ' + (cues.length + 1), gfx };
    try { const a = JSON.parse(localStorage.getItem('vs_audio') || 'null'); if (a && a.preset) cue.audio = a.preset; } catch (e) {}
    try { const l = localStorage.getItem('vs_look'); if (l) cue.look = l; } catch (e) {}
    try { if (V.sceneApi && V.sceneApi.envId()) cue.scene = V.sceneApi.envId(); } catch (e) {}
    return cue;
  }

  // ---- editor <-> cue
  const $ = (id) => document.getElementById(id);
  function fillSelect(sel, items, keep) { const v = sel.value; sel.innerHTML = '<option value="">Leave as it is</option>' + items.map((i) => '<option value="' + i[0] + '">' + i[1] + '</option>').join(''); sel.value = keep != null ? keep : v; }
  function openEditor(index) {
    editing = index; const c = index >= 0 ? cues[index] : { label: 'Step ' + (cues.length + 1), say: '', gfx: {} }; const g = c.gfx || {};
    fillSelect($('seLook'), (window.VS.Looks ? window.VS.Looks.list() : []).map((l) => [l.id, l.name]), c.look || '');
    const P = window.VS.AudioPresets; fillSelect($('seAudio'), P ? Object.keys(P.PRESETS).map((k) => [k, P.PRESETS[k].label]) : [], c.audio || '');
    $('seLabel').value = c.label; $('seSay').value = c.say || '';
    $('seLt').value = g.lt ? g.lt.mode : ''; $('seLtName').value = g.lt && g.lt.name != null ? g.lt.name : window.VS.Graphics.state.lt.name; $('seLtTitle').value = g.lt && g.lt.title != null ? g.lt.title : window.VS.Graphics.state.lt.title; $('seLtSecs').value = g.lt && g.lt.secs != null ? g.lt.secs : 6;
    $('seBanner').value = g.banner ? g.banner.mode : ''; $('seBannerText').value = g.banner && g.banner.text != null ? g.banner.text : '';
    $('seCard').value = g.card ? g.card.mode : ''; $('seCardTitle').value = g.card && g.card.title != null ? g.card.title : ''; $('seCardSub').value = g.card && g.card.sub != null ? g.card.sub : '';
    $('seTicker').value = g.ticker ? g.ticker.mode : ''; $('seTickerText').value = g.ticker && g.ticker.text ? g.ticker.text : '';
    $('seCount').value = g.countdown && g.countdown.mode === 'show' ? Math.round((g.countdown.seconds / 60) * 10) / 10 : '';
    $('seScene').checked = !!c.scene; $('seScene').dataset.scene = c.scene || '';
    $('showEditorTitle').textContent = index >= 0 ? 'Edit step ' + (index + 1) : 'New step';
    $('showEditor').hidden = false; $('seLabel').focus();
  }
  function editorToCue() {
    const old = editing >= 0 ? cues[editing] : null, gfx = Object.assign({}, old ? old.gfx : {});   // keep parts the editor does not show (social, QR, channel name, hide countdown)
    const set = (k, v) => { if (v) gfx[k] = v; else delete gfx[k]; };
    const lt = $('seLt').value; set('lt', lt === 'show' ? { mode: 'show', name: $('seLtName').value, title: $('seLtTitle').value, secs: +$('seLtSecs').value || 0, accent: gfx.lt && gfx.lt.accent, template: gfx.lt && gfx.lt.template || window.VS.Graphics.state.lt.template } : lt === 'hide' ? { mode: 'hide' } : null);
    const bn = $('seBanner').value; set('banner', bn === 'show' ? { mode: 'show', text: $('seBannerText').value } : bn === 'hide' ? { mode: 'hide' } : null);
    const cd = $('seCard').value; set('card', cd === 'show' ? { mode: 'show', title: $('seCardTitle').value, sub: $('seCardSub').value, accent: gfx.card && gfx.card.accent, qr: gfx.card && gfx.card.qr } : cd === 'hide' ? { mode: 'hide' } : null);
    const tk = $('seTicker').value; set('ticker', tk ? { mode: tk, text: $('seTickerText').value } : null);
    const mins = parseFloat($('seCount').value); set('countdown', mins > 0 ? { mode: 'show', seconds: mins * 60, label: 'Starting in' } : (gfx.countdown && gfx.countdown.mode === 'hide' ? gfx.countdown : null));
    const raw = { id: old ? old.id : undefined, label: $('seLabel').value, say: $('seSay').value, gfx, look: $('seLook').value, audio: $('seAudio').value };
    if ($('seScene').checked) raw.scene = $('seScene').dataset.scene || (window.VS.sceneApi && window.VS.sceneApi.envId()) || '';
    return Core().normaliseCue(raw);
  }

  // ---- render
  function render() {
    const d = Core().describe(cues, cur), now = $('showNow'), nb = $('showNext'), bb = $('showBack'), list = $('showList'); if (!now) return;
    now.innerHTML = ''; const mk = (cls, txt) => { const p = document.createElement('div'); p.className = cls; p.textContent = txt; now.appendChild(p); };
    mk('show-pos', d.position);
    if (d.now) mk('show-cur', 'Now: ' + d.now); if (d.next) mk('show-next', 'Next: ' + d.next); else if (d.started && d.atEnd) mk('show-next', 'That was the last step.');
    if (d.say) mk('show-say', 'Note: ' + d.say);
    nb.textContent = !cues.length ? 'Add a step first' : !d.started ? 'Start show' : d.atEnd ? 'End of show' : 'NEXT: ' + d.next;
    nb.disabled = !cues.length || d.atEnd; bb.disabled = cur < 1;
    list.innerHTML = '';
    cues.forEach((c, i) => {
      const li = document.createElement('li'); li.style.cssText = 'margin:8px 0;border:1px solid var(--border, #333);border-radius:10px;padding:8px;' + (i === cur ? 'outline:2px solid var(--accent, #5e6ad2);' : '');
      const run = document.createElement('button'); run.type = 'button'; run.className = 'btn ghost'; run.style.cssText = 'min-height:48px;width:100%;text-align:left;display:block;';
      run.innerHTML = '<strong></strong><br><small></small>'; run.querySelector('strong').textContent = (i + 1) + '. ' + c.label;
      run.querySelector('small').textContent = Core().summarise(c).replace('Look: ' + c.look, 'Look: ' + lookName(c.look)).replace('Audio: ' + c.audio, 'Audio: ' + audioName(c.audio));
      run.addEventListener('click', () => go(i, i !== cur + 1));
      const row = document.createElement('div'); row.style.cssText = 'display:flex;gap:6px;margin-top:6px;';
      const btn = (txt, label, fn, dis) => { const b = document.createElement('button'); b.type = 'button'; b.className = 'btn ghost sm'; b.style.cssText = 'min-height:44px;min-width:44px;flex:1;'; b.textContent = txt; b.setAttribute('aria-label', label + ' step ' + (i + 1)); b.disabled = !!dis; b.addEventListener('click', fn); row.appendChild(b); };
      btn('Edit', 'Edit', () => openEditor(i));
      btn('Up', 'Move up', () => { cues = Core().move(cues, i, -1); if (cur === i) cur = i - 1; else if (cur === i - 1) cur = i; save(); render(); }, i === 0);
      btn('Down', 'Move down', () => { cues = Core().move(cues, i, 1); if (cur === i) cur = i + 1; else if (cur === i + 1) cur = i; save(); render(); }, i === cues.length - 1);
      btn('Remove', 'Remove', () => { cues.splice(i, 1); if (cur >= cues.length) cur = cues.length - 1; else if (i < cur) cur--; save(); render(); });
      li.appendChild(run); li.appendChild(row); list.appendChild(li);
    });
    if (!cues.length) { const li = document.createElement('li'); li.className = 'honesty-note'; li.textContent = 'No steps yet. Tap "Add a step", or set up your screen the way you want and tap "Save what is on screen as a step".'; list.appendChild(li); }
  }

  function init() {
    if (!$('panel-show') || !window.VS.ShowCore || !window.VS.Graphics) return;
    load(); render();
    $('showNext').addEventListener('click', () => next()); $('showBack').addEventListener('click', () => back());
    $('showAdd').addEventListener('click', () => openEditor(-2));
    $('showCapture').addEventListener('click', () => {
      if (cues.length >= Core().MAX_CUES) { $('showStatus').textContent = 'A show can have up to ' + Core().MAX_CUES + ' steps.'; return; }
      cues.push(Core().normaliseCue(capture())); save(); render(); $('showStatus').textContent = 'Saved. Rename it with Edit.';
    });
    $('seCancel').addEventListener('click', () => { $('showEditor').hidden = true; editing = null; });
    $('seSave').addEventListener('click', () => {
      const c = editorToCue(); if (!c) return;
      if (editing >= 0) cues[editing] = c; else if (cues.length < Core().MAX_CUES) cues.push(c); else { $('showStatus').textContent = 'A show can have up to ' + Core().MAX_CUES + ' steps.'; return; }
      save(); $('showEditor').hidden = true; editing = null; render(); $('showStatus').textContent = 'Step saved.';
    });
    $('showExport').addEventListener('click', async () => {
      const text = Core().serialise(cues), box = $('showJson'); box.hidden = false; box.value = text;
      try { await navigator.clipboard.writeText(text); $('showStatus').textContent = 'Copied. Paste it into a message or note to keep a backup.'; } catch (e) { box.select(); $('showStatus').textContent = 'Could not copy by itself. Select the text below and copy it.'; }
    });
    $('showImport').addEventListener('click', () => {
      const box = $('showJson'); if (box.hidden) { box.hidden = false; box.value = ''; box.focus(); $('showStatus').textContent = 'Paste your show text, then tap Load from text again.'; return; }
      const r = Core().parse(box.value); if (!r.ok) { $('showStatus').textContent = r.error; return; }
      cues = r.cues; cur = -1; save(); render(); $('showStatus').textContent = 'Loaded ' + cues.length + ' step' + (cues.length === 1 ? '' : 's') + '.' + (r.error ? ' ' + r.error : '');
    });
    $('showClear').addEventListener('click', () => { if (!cues.length) return; if (!window.confirm('Remove all steps from this show?')) return; cues = []; cur = -1; save(); render(); });
    const keys = $('showKeys'); try { keys.checked = localStorage.getItem(KEYS_ON) === '1'; } catch (e) {}
    keys.addEventListener('change', () => { try { localStorage.setItem(KEYS_ON, keys.checked ? '1' : '0'); } catch (e) {} });
    document.addEventListener('keydown', (e) => {
      if (!keys.checked || e.ctrlKey || e.metaKey || e.altKey) return;
      const tag = (e.target && e.target.tagName) || ''; if (/INPUT|TEXTAREA|SELECT/.test(tag)) return;
      const prompterOn = !!(window.VS.prompter && window.VS.prompter.state && window.VS.prompter.state.show);   // the teleprompter owns Space while it is showing
      let act = null;
      if (e.key === 'ArrowRight' || e.key === 'PageDown') act = 'next'; else if (e.key === 'ArrowLeft' || e.key === 'PageUp') act = 'back';
      else if (e.code === 'Space' && !prompterOn && tag !== 'BUTTON') act = 'next';
      if (!act) return; e.preventDefault(); if (act === 'next') next(); else back();
    });
    window.VS.Show = { get cues() { return cues.slice(); }, get cur() { return cur; }, next, back, go, runCue, capture };
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
