/**
 * Prompter core (pure, no DOM): script words, pace learning, voice-activity scroll, word-follow matching,
 * remote-command whitelist. Unit-tested in tools/e2e/unit_prompter_core.js.
 * Nothing here needs a network or a model.
 */
(function () {
  const WPM_MIN = 60, WPM_MAX = 260, WPM_DEFAULT = 150;

  function norm(s) {
    return String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9À-￿']/g, '').replace(/'/g, '');
  }
  /** Script words with char offsets: [{w:'hello', start, end}]. Words that normalise to nothing (e.g. "--") are skipped. */
  function words(text) {
    const out = []; const re = /\S+/g; let m; text = String(text || '');
    while ((m = re.exec(text))) { const w = norm(m[0]); if (w) out.push({ w, start: m.index, end: m.index + m[0].length }); }
    return out;
  }
  function lev1(a, b) { // true when edit distance <= 1
    if (a === b) return true; const la = a.length, lb = b.length; if (Math.abs(la - lb) > 1) return false;
    let i = 0, j = 0, d = 0;
    while (i < la && j < lb) {
      if (a[i] === b[j]) { i++; j++; continue; }
      if (++d > 1) return false;
      if (la > lb) i++; else if (lb > la) j++; else { i++; j++; }
    }
    return d + (la - i) + (lb - j) <= 1;
  }
  function same(a, b) { return a === b || (a.length >= 5 && b.length >= 5 && lev1(a, b)); }

  /**
   * Where in the script is the speaker? `spoken` = recognised text (interim or final).
   * Looks at the last few spoken words and finds the best in-order match inside a window around `from` (the last known word index).
   * Returns the index of the NEXT word to read (i.e. one past the last matched word), or null when unsure.
   * Needs >= 2 consecutive matching words (or 1 long word that is unique in the window) so chatter off-script does nothing.
   */
  function matchSpoken(scriptWords, spoken, from, opts) {
    const back = (opts && opts.back) || 6, fwd = (opts && opts.fwd) || 80;
    const sp = words(spoken).map((x) => x.w).slice(-5); if (!sp.length || !scriptWords.length) return null;
    from = Math.max(0, Math.min(scriptWords.length, from | 0));
    const lo = Math.max(0, from - back), hi = Math.min(scriptWords.length, from + fwd);
    let best = null;
    for (let end = lo; end < hi; end++) { // candidate: spoken ends at script word `end`
      let run = 0, q = 0; // q: exact words count more than fuzzy ones, so a near-miss never beats the real spot
      for (let k = 0; k < sp.length && end - k >= lo; k++) { const a = scriptWords[end - k].w, b = sp[sp.length - 1 - k]; if (a === b) { run++; q += 100; } else if (same(a, b)) { run++; q += 55; } else break; }
      if (!run) continue;
      const need = sp.length >= 2 ? 2 : 1;
      if (run < need) continue;
      if (run === 1 && sp[sp.length - 1].length < 5) continue;
      const dist = end + 1 - from; // prefer nearest forward, small penalty for backwards
      const score = q - (dist >= 0 ? dist : -dist * 3);
      if (!best || score > best.score) best = { score, idx: end + 1, run };
    }
    if (best && best.run === 1) { // a single word must be unique in the window
      const w = sp[sp.length - 1]; let n = 0; for (let i = lo; i < hi; i++) if (same(scriptWords[i].w, w)) n++;
      if (n !== 1) return null;
    }
    return best ? best.idx : null;
  }

  /** Voice activity with hysteresis + hold. st = {on:false, lastLoud:-1e9}; peakDb from the mic chain. */
  function vadStep(st, peakDb, nowMs, cfg) {
    const onDb = (cfg && cfg.onDb) != null ? cfg.onDb : -42, offDb = (cfg && cfg.offDb) != null ? cfg.offDb : -48, hold = (cfg && cfg.holdMs) != null ? cfg.holdMs : 700;
    const loud = typeof peakDb === 'number' && peakDb > (st.on ? offDb : onDb);
    if (loud) st.lastLoud = nowMs;
    st.on = loud || (nowMs - st.lastLoud) < hold;
    return st.on;
  }

  /** Reading pace from a timed sample: n words read between first and last speech. Rejects samples too short to mean anything. */
  function paceFromSample(nWords, spanSec) {
    if (!(nWords >= 8) || !(spanSec >= 3)) return null;
    const wpm = nWords / (spanSec / 60);
    return Math.max(WPM_MIN, Math.min(WPM_MAX, Math.round(wpm)));
  }
  function medianPace(list) {
    const a = list.filter((x) => typeof x === 'number').sort((x, y) => x - y); if (!a.length) return null;
    const m = a.length >> 1; return a.length % 2 ? a[m] : Math.round((a[m - 1] + a[m]) / 2);
  }
  /** Scroll speed (px/s) that matches `wpm` for a script with nWords words laid out over scrollPx pixels. */
  function pxPerSecForWpm(wpm, nWords, scrollPx) {
    if (!(nWords > 0) || !(scrollPx > 0)) return 0;
    return (Math.max(WPM_MIN, Math.min(WPM_MAX, wpm || WPM_DEFAULT)) / 60) * (scrollPx / nWords);
  }
  /** The first sample paragraph: up to ~maxWords words, cut at the end of a sentence/line when possible. */
  function sampleWords(text, maxWords) {
    const w = words(text); if (!w.length) return { count: 0, end: 0 };
    const cap = Math.min(w.length, maxWords || 45); let cut = cap;
    for (let i = cap - 1; i >= Math.min(cap - 1, 18); i--) { const t = text.slice(w[i].start, w[i].end); if (/[.!?]$/.test(t) || /\n/.test(text.slice(w[i].end, (w[i + 1] || { start: w[i].end }).start))) { cut = i + 1; break; } }
    return { count: cut, end: w[cut - 1].end };
  }

  const CMDS = { toggle: 1, play: 1, pause: 1, slower: 1, faster: 1, top: 1, 'lines-back': 1, 'lines-fwd': 1, bigger: 1, smaller: 1, 'step-next': 1, 'step-back': 1 };
  /** Only these commands are ever acted on. Anything else (or malformed) -> null. */
  function parseRemoteCmd(msg) {
    if (!msg || typeof msg !== 'object' || msg.type !== 'remote' || typeof msg.cmd !== 'string') return null;
    return Object.prototype.hasOwnProperty.call(CMDS, msg.cmd) ? msg.cmd : null;
  }
  const ALPHA = 'abcdefghjkmnpqrstuvwxyz23456789'; // no look-alikes (0/o, 1/l/i)
  function makeRoomCode(randomBytes) { // randomBytes: array/Uint8Array of >= 8 values
    let s = 'rm-'; for (let i = 0; i < 8; i++) s += ALPHA[randomBytes[i] % ALPHA.length]; return s;
  }
  const validRoom = (r) => typeof r === 'string' && /^rm-[a-z0-9]{8}$/.test(r);
  function remoteUrl(base, room) { return String(base).replace(/[#?].*$/, '').replace(/[^/]*$/, '') + 'remote.html?room=' + encodeURIComponent(room); }

  window.VS = window.VS || {};
  window.VS.PrompterCore = { norm, words, matchSpoken, vadStep, paceFromSample, medianPace, pxPerSecForWpm, sampleWords, parseRemoteCmd, makeRoomCode, validRoom, remoteUrl, WPM_DEFAULT, WPM_MIN, WPM_MAX };
})();
