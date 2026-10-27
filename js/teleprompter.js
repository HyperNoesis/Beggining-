/**
 * Teleprompter (brief F2). Script paste/import, adjustable speed and size, mirror mode, hotkeys.
 * It is an on-screen overlay only: it is NOT drawn into the recording or stream (the viewer must never see it).
 * v0.30: pace learning, "follow my voice" (scrolls while you speak, local, no model), optional "follow my words" (browser speech service),
 * and a command API used by the phone remote (js/prompter-remote.js). Pure logic lives in js/prompter-core.js.
 */
(function () {
  const KEY = 'vs_prompter';
  // Pure helper, unit-tested in tools/e2e/unit_prompter.js
  function scrollStep(pos, pxPerSec, dtMs, maxPos) {
    const next = pos + (pxPerSec * dtMs) / 1000;
    return Math.max(0, Math.min(maxPos, next));
  }
  function estimateMinutes(text, wpm) {
    const words = (text.trim().match(/\S+/g) || []).length;
    return words / Math.max(60, wpm || 150);
  }
  window.VS = window.VS || {};
  window.VS.Teleprompter = { scrollStep, estimateMinutes };

  function init() {
    const $ = (id) => document.getElementById(id);
    const box = $('prompter'), body = $('prompterBody'), ta = $('prompterScript');
    if (!box || !body || !ta) return;
    const speed = $('prompterSpeed'), size = $('prompterSize'), mirror = $('prompterMirror'), toggle = $('prompterToggle'), show = $('prompterShow'), info = $('prompterInfo'), file = $('prompterFile');
    let state = { text: '', speed: 40, size: 34, mirror: false, show: false, mode: 'manual', wpm: null };
    try { Object.assign(state, JSON.parse(localStorage.getItem(KEY) || '{}')); } catch (e) {}
    let pos = 0, playing = false, last = 0, raf = 0;
    const PC = () => window.VS.PrompterCore;
    const vad = { on: false, lastLoud: -1e9 }; let speakingNow = false, wordIdx = 0, sw = [], rec = null, recOk = false, learn = null, learnTimer = 0;
    const modeSel = $('prompterMode'), learnBtn = $('prompterLearn'), learnNote = $('prompterLearnNote'), modeNote = $('prompterModeNote');
    const peak = () => { const c = window.VS.audioChain; return c && typeof c.peakDb === 'number' ? c.peakDb : null; };

    function save() { try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) {} }
    function render() {
      ta.value = state.text; speed.value = state.speed; size.value = state.size; mirror.checked = state.mirror; show.checked = state.show;
      body.textContent = state.text || 'Paste your script in the Prompter tab.';
      body.style.fontSize = state.size + 'px';
      box.style.display = state.show ? 'block' : 'none';
      body.style.transform = state.mirror ? 'scaleX(-1)' : 'none';
      const m = estimateMinutes(state.text, 150);
      info.textContent = state.text.trim() ? 'About ' + (m < 1 ? Math.max(1, Math.round(m * 60)) + ' seconds' : m.toFixed(1) + ' minutes') + ' at a relaxed reading pace.' : '';
      if (modeSel) modeSel.value = state.mode;
      if (learnNote && !learn) learnNote.textContent = state.wpm ? 'Your reading pace: about ' + state.wpm + ' words per minute.' : 'Your pace is not learned yet (using ' + PC().WPM_DEFAULT + ' words per minute).';
      if (modeNote) modeNote.textContent = state.mode === 'voice' ? 'Scrolls only while you are speaking, at your reading pace. Needs the camera running so the mic is on. Everything stays on this device.' : state.mode === 'words' ? (recOk ? 'Listening for your words. Uses your browser\u2019s speech service: in Chrome the audio is sent to Google to be recognised, so this is NOT private or offline. On some phones it can interrupt your recording audio: test before going live.' : 'Your browser has no speech recognition here, so this falls back to "follow my voice".') : '';
      toggle.textContent = playing ? 'Pause' : 'Start scrolling';
      toggle.setAttribute('aria-pressed', String(playing));
    }
    const effMode = () => (state.mode === 'words' && !recOk ? 'voice' : state.mode);
    function voicePx() { return PC().pxPerSecForWpm(state.wpm || PC().WPM_DEFAULT, sw.length, Math.max(1, body.scrollHeight - box.clientHeight)); }
    function yOfWord(i) { // scrollTop that puts word i about a third down the box
      const node = body.firstChild; if (!node || !sw.length) return null; i = Math.max(0, Math.min(sw.length - 1, i));
      try { const r = document.createRange(); r.setStart(node, sw[i].start); r.setEnd(node, sw[i].end); const rr = r.getBoundingClientRect(), br = box.getBoundingClientRect(); return Math.max(0, rr.top - br.top + box.scrollTop - box.clientHeight * 0.3); } catch (e) { return null; }
    }
    function startRec() {
      stopRec(); const SR = window.SpeechRecognition || window.webkitSpeechRecognition; recOk = !!SR; if (!SR) return;
      try {
        rec = new SR(); rec.continuous = true; rec.interimResults = true; rec.lang = navigator.language || 'en-US';
        rec.onresult = (e) => { let txt = ''; for (let i = e.resultIndex; i < e.results.length; i++) txt += ' ' + e.results[i][0].transcript; const n = PC().matchSpoken(sw, txt, wordIdx); if (n != null) wordIdx = n; };
        rec.onend = () => { if (playing && state.mode === 'words' && rec) { try { rec.start(); } catch (e) {} } };
        rec.onerror = (e) => { if (e && (e.error === 'not-allowed' || e.error === 'service-not-allowed')) { recOk = false; stopRec(); render(); } };
        rec.start();
      } catch (e) { recOk = false; }
    }
    function stopRec() { const r = rec; rec = null; if (r) { try { r.onend = null; r.stop(); } catch (e) {} } }
    function maxPos() { return Math.max(0, box.scrollHeight - box.clientHeight); }
    function tick(t) {
      if (!playing) return;
      if (last) {
        const dt = t - last, mode = effMode();
        if (mode === 'voice') { speakingNow = PC().vadStep(vad, peak(), t); if (speakingNow) pos = scrollStep(pos, voicePx(), dt, body.scrollHeight); }
        else if (mode === 'words') { const target = yOfWord(wordIdx); if (target != null) pos = pos + (target - pos) * Math.min(1, dt / 250); }
        else pos = scrollStep(pos, state.speed, dt, body.scrollHeight);
        box.scrollTop = pos; if (pos >= body.scrollHeight - box.clientHeight) { playing = false; stopRec(); render(); return; }
      }
      last = t; raf = requestAnimationFrame(tick);
    }
    function play(on) {
      playing = on; last = 0; cancelAnimationFrame(raf); stopRec();
      if (on) { if (!state.show) { state.show = true; save(); } pos = box.scrollTop; if (state.mode === 'words') { wordIdx = Math.max(0, Math.min(sw.length - 1, wordIdx)); startRec(); } raf = requestAnimationFrame(tick); }
      render();
    }
    ta.addEventListener('input', () => { state.text = ta.value; sw = PC().words(state.text); wordIdx = 0; pos = 0; box.scrollTop = 0; save(); render(); });
    speed.addEventListener('input', () => { state.speed = +speed.value; save(); });
    size.addEventListener('input', () => { state.size = +size.value; save(); render(); });
    mirror.addEventListener('change', () => { state.mirror = mirror.checked; save(); render(); });
    show.addEventListener('change', () => { state.show = show.checked; if (!state.show) playing = false; save(); render(); });
    toggle.addEventListener('click', () => play(!playing));
    $('prompterReset').addEventListener('click', () => { wordIdx = 0; pos = 0; box.scrollTop = 0; play(false); });
    // Numeric nudge buttons (no tiny sliders on phones)
    $('prompterSlower').addEventListener('click', () => { state.speed = Math.max(5, state.speed - 5); save(); render(); });
    $('prompterFaster').addEventListener('click', () => { state.speed = Math.min(200, state.speed + 5); save(); render(); });
    if (file) file.addEventListener('change', async () => {
      const f = file.files && file.files[0]; if (!f) return;
      if (f.size > 500000) { info.textContent = 'That file is too large for a script (max 500 KB of text).'; return; }
      try { state.text = await f.text(); sw = PC().words(state.text); wordIdx = 0; pos = 0; box.scrollTop = 0; save(); render(); } catch (e) { info.textContent = 'Could not read that file. Try a plain .txt file.'; }
    });
    // Hotkeys: Space play/pause, Arrow up/down speed. Ignored while typing in a field.
    document.addEventListener('keydown', (e) => {
      const tag = (e.target && e.target.tagName) || '';
      if (/INPUT|TEXTAREA|SELECT|BUTTON/.test(tag) || !state.show) return;
      if (e.code === 'Space') { e.preventDefault(); play(!playing); }
      else if (e.key === 'ArrowUp') { state.speed = Math.min(200, state.speed + 5); save(); render(); }
      else if (e.key === 'ArrowDown') { state.speed = Math.max(5, state.speed - 5); save(); render(); }
    });
    if (modeSel) modeSel.addEventListener('change', () => { state.mode = ['manual', 'voice', 'words'].includes(modeSel.value) ? modeSel.value : 'manual'; if (playing) play(true); save(); render(); });
    // Pace learning: read the first lines aloud, tap Done. Pace = words / time between first and last speech.
    function learnTick() { const p = peak(), t = performance.now(); if (p != null && p > -42) { if (learn.first == null) learn.first = t; learn.last = t; } }
    function learnStart() {
      if (peak() === null) { learnNote.textContent = 'Start the camera first so the microphone is on, then try again.'; return; }
      const smp = PC().sampleWords(state.text, 45); if (smp.count < 12) { learnNote.textContent = 'Add a script of at least 12 words first.'; return; }
      play(false); pos = 0; box.scrollTop = 0; state.show = true; save(); render(); learn = { n: smp.count, first: null, last: null };
      learnTimer = setInterval(learnTick, 50); learnBtn.textContent = 'Done reading'; learnNote.textContent = 'Read the first ' + smp.count + ' words aloud at your normal pace, then tap Done reading.';
    }
    function learnDone() {
      clearInterval(learnTimer); const L = learn; learn = null; learnBtn.textContent = 'Learn my reading pace';
      const wpm = L && L.first != null ? PC().paceFromSample(L.n, (L.last - L.first) / 1000) : null;
      if (!wpm) { learnNote.textContent = 'I could not measure that: it was too short or too quiet. Check the mic level and read the full ' + (L ? L.n : '') + ' words.'; return; }
      state.wpm = wpm; state.speed = Math.max(5, Math.min(200, Math.round(PC().pxPerSecForWpm(wpm, sw.length, Math.max(1, body.scrollHeight - box.clientHeight))))) || state.speed; save(); render();
    }
    if (learnBtn) learnBtn.addEventListener('click', () => (learn ? learnDone() : learnStart()));
    // One command entry point (hotkeys, phone remote). Returns true when handled.
    function command(cmd) {
      const nudge = (d) => { state.speed = Math.max(5, Math.min(200, state.speed + d)); save(); render(); };
      const lines = (n) => { pos = Math.max(0, Math.min(maxPos(), box.scrollTop + n * state.size * 1.35)); box.scrollTop = pos; if (sw.length && state.mode === 'words') { const y = box.scrollTop; let k = 0; while (k < sw.length - 1 && (yOfWord(k) || 0) < y) k++; wordIdx = k; } };
      switch (cmd) {
        case 'toggle': play(!playing); return true; case 'play': play(true); return true; case 'pause': play(false); return true;
        case 'slower': nudge(-5); return true; case 'faster': nudge(5); return true;
        case 'top': wordIdx = 0; pos = 0; box.scrollTop = 0; return true;
        case 'lines-back': lines(-3); return true; case 'lines-fwd': lines(3); return true;
        case 'bigger': state.size = Math.min(72, state.size + 4); save(); render(); return true; case 'smaller': state.size = Math.max(18, state.size - 4); save(); render(); return true;
        default: return false;
      }
    }
    sw = PC().words(state.text);
    render();
    window.VS.prompter = { command, get mode() { return effMode(); }, get speaking() { return speakingNow; }, get wordIdx() { return wordIdx; }, set wordIdx(v) { wordIdx = v | 0; }, get wpm() { return state.wpm; }, play, get playing() { return playing; }, get state() { return state; }, get scrollTop() { return box.scrollTop; } };
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
