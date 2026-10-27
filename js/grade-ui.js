/**
 * Colour grade, match-from-photo, skin smoothing and auto-framing: panel + glue (pure maths in js/grade-core.js).
 * Sends the resolved grade to the render pipeline (setGrade). Auto-framing reads the person box the pipeline reports (personBox)
 * and eases the crop (CompositionEngine zoom/pan) toward the target.
 */
(function () {
  const KEY = 'vs_grade';
  window.VS = window.VS || {};
  const GC = () => window.VS.GradeCore;
  let st = { id: 'none', strength: 1, photo: null, skin: 0, auto: false, assist: false, lutAmt: 1 };
  let lut = null, assistRes = { bright: 1, tint: null }, assistTimer = 0;
  try { Object.assign(st, JSON.parse(localStorage.getItem(KEY) || '{}')); } catch (e) {}
  let target = null, lastBox = 0;
  function save() { try { localStorage.setItem(KEY, JSON.stringify(st)); } catch (e) {} }
  const current = () => (st.id === 'photo' ? st.photo : GC().GRADES.find((g) => g.id === st.id)) || GC().GRADES[0];
  function resolved() { return GC().resolve(current(), st.strength); }
  function push() { const r = resolved(); if (window.VS.rendererSend) window.VS.rendererSend({ type: 'setGrade', state: { assistB: st.assist ? assistRes.bright : 1, assistTint: st.assist ? assistRes.tint : null, lut: lut, lutAmount: st.lutAmt, filter: r.filter, tint: r.tint, skin: st.skin, auto: st.auto } }); }

  function onBox(box) { // box in crop space; convert to source space with the crop that is in use now
    const fa = window.VS.frameApi; if (!fa || !st.auto) return;
    const ce = fa.engine(), nat = fa.native(), nw = nat[0], nh = nat[1]; if (!nw || !nh) return;
    const f = ce.computeFrame(nw, nh, 1280), base = { fw: (f.sw * ce.zoom) / nw, fh: (f.sh * ce.zoom) / nh };
    const sb = { x0: (f.sx + box.x0 * f.sw) / nw, x1: (f.sx + box.x1 * f.sw) / nw, y0: (f.sy + box.y0 * f.sh) / nh, y1: (f.sy + box.y1 * f.sh) / nh };
    const t = GC().frameTarget(sb, base, { zoom: ce.zoom, panX: ce.panX, panY: ce.panY }); if (t) { target = t; lastBox = performance.now(); }
  }
  let raf = 0, lastT = 0, n = 0;
  function loop(t) {
    raf = 0; if (!st.auto) return;
    const fa = window.VS.frameApi;
    if (fa && target && t - lastBox < 4000) {                       // person lost for 4 s: hold the framing
      const ce = fa.engine(), nx = GC().approach({ zoom: ce.zoom, panX: ce.panX, panY: ce.panY }, target, lastT ? (t - lastT) / 1000 : 0);
      ce.setZoom(nx.zoom); ce.setPan(nx.panX, nx.panY); if (++n % 8 === 0) fa.syncUi();
    }
    lastT = t; raf = requestAnimationFrame(loop);
  }
  function setAuto(on) { st.auto = !!on; target = null; lastT = 0; save(); push(); if (on && !raf) raf = requestAnimationFrame(loop); }

  function init() {
    const $ = (id) => document.getElementById(id), list = $('gradeList'); if (!list) return;
    const strength = $('gradeStrength'), skin = $('skinAmount'), auto = $('autoFrame'), note = $('gradeNote'), photo = $('gradePhoto');
    function mark() { list.querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.id === st.id))); strength.value = Math.round(st.strength * 100); skin.value = Math.round(st.skin * 100); auto.checked = st.auto; }
    GC().GRADES.forEach((g) => {
      const b = document.createElement('button'); b.type = 'button'; b.className = 'btn ghost'; b.dataset.id = g.id; b.style.cssText = 'min-height:52px;text-align:left;';
      b.innerHTML = '<strong></strong><br><small></small>'; b.querySelector('strong').textContent = g.name; b.querySelector('small').textContent = g.about;
      b.addEventListener('click', () => { st.id = g.id; if (g.id !== 'none' && st.strength === 0) st.strength = 1; save(); push(); mark(); note.textContent = g.name + ' applied.'; });
      list.appendChild(b);
    });
    strength.addEventListener('input', () => { st.strength = +strength.value / 100; save(); push(); });
    skin.addEventListener('input', () => { st.skin = +skin.value / 100; save(); push(); });
    auto.addEventListener('change', () => setAuto(auto.checked));
    photo.addEventListener('change', async () => {
      const f = photo.files && photo.files[0]; if (!f) return;
      try {
        const bmp = await createImageBitmap(f, { resizeWidth: 64 }), cv = document.createElement('canvas'); cv.width = bmp.width; cv.height = bmp.height;
        const cx = cv.getContext('2d', { willReadFrequently: true }); cx.drawImage(bmp, 0, 0); const d = cx.getImageData(0, 0, cv.width, cv.height);
        const g = GC().gradeFromStats(GC().statsFromRGBA(d.data, cv.width, cv.height));
        if (!g) { note.textContent = 'I could not read colours from that picture. Try a normal photo.'; return; }
        st.photo = g; st.id = 'photo'; if (st.strength === 0) st.strength = 1; save(); push(); mark();
        note.textContent = 'Matched to your photo: ' + (g.tint ? (g.tint.rgb[0] > g.tint.rgb[2] ? 'warmer' : 'cooler') : 'neutral') + ' colour, ' + (g.f.brightness > 1.02 ? 'brighter' : g.f.brightness < 0.98 ? 'darker' : 'same brightness') + '. Use Grade strength to dial it. It only changes you, not the room.';
      } catch (e) { note.textContent = 'I could not open that picture.'; }
    });
    $('gradeReset').addEventListener('click', () => { st = { id: 'none', strength: 1, photo: null, skin: 0, auto: false, assist: false, lutAmt: 1 }; lut = null; try { localStorage.removeItem('vs_lut'); } catch (e) {} if (assist) assist.checked = false; setAssist(false); setAuto(false); save(); push(); mark(); const fa = window.VS.frameApi; if (fa) { fa.engine().setZoom(1); fa.engine().resetPan(); fa.syncUi(); } note.textContent = 'Colour, skin smoothing and auto-framing reset.'; });
    // --- v0.35: auto brightness/white balance (samples the camera ~1/s, slow smoothing), .cube LUT import
    const assist = $('autoAssist'), lutFile = $('lutFile'), lutAmt = $('lutAmount'), lutClear = $('lutClear'), lutNote = $('lutNote');
    function sampleAssist() {
      const v = document.getElementById('video'); if (!st.assist || !v || !v.videoWidth) return;
      try { const cv = sampleAssist.cv || (sampleAssist.cv = document.createElement('canvas')); cv.width = 64; cv.height = 36; const cx = cv.getContext('2d', { willReadFrequently: true }); cx.drawImage(v, 0, 0, 64, 36); const d = cx.getImageData(0, 0, 64, 36);
        assistRes = GC().autoAssist(GC().statsFromRGBA(d.data, 64, 36), assistRes); push(); } catch (e) {}
    }
    function setAssist(on) { st.assist = !!on; clearInterval(assistTimer); assistRes = { bright: 1, tint: null }; if (on) { assistTimer = setInterval(sampleAssist, 1000); sampleAssist(); } save(); push(); }
    if (assist) assist.addEventListener('change', () => setAssist(assist.checked));
    function lutSay(t) { if (lutNote) lutNote.textContent = t; }
    if (lutFile) lutFile.addEventListener('change', async () => {
      const f = lutFile.files && lutFile.files[0]; if (!f) return;
      if (f.size > 6e6) { lutSay('That file is too big (over 6 MB).'); return; }
      const r = GC().parseCube(await f.text()); if (r.error) { lutSay(r.error); return; }
      lut = r; try { localStorage.setItem('vs_lut', JSON.stringify(GC().lutToB64(r))); } catch (e) { lutSay('Loaded, but it is too big to remember for next time.'); }
      push(); lutSay('Loaded "' + (r.title || f.name).slice(0, 40) + '" (size ' + r.size + '). Applied to you at reduced detail for speed; lower the amount if it looks wrong. Not speed-tested on a phone.');
    });
    if (lutAmt) lutAmt.addEventListener('input', () => { st.lutAmt = +lutAmt.value / 100; save(); push(); });
    if (lutClear) lutClear.addEventListener('click', () => { lut = null; try { localStorage.removeItem('vs_lut'); } catch (e) {} push(); lutSay('LUT removed.'); });
    try { const o = JSON.parse(localStorage.getItem('vs_lut') || 'null'); if (o) { lut = GC().lutFromB64(o); if (lut) lutSay('Your saved LUT "' + (lut.title || 'LUT') + '" is on.'); } } catch (e) {}
    if (assist) assist.checked = st.assist; if (lutAmt) lutAmt.value = Math.round(st.lutAmt * 100); if (st.assist) setAssist(true);
    mark(); push(); if (st.auto) setAuto(true);
    setInterval(() => { if (st.id !== 'none' || st.skin > 0 || st.auto || st.assist || lut) push(); }, 1500);   // the pipeline may start after this page loads
  }
  /** Used by one-tap Looks: set a preset grade by id (or null = Natural) and return the previous setting so it can be undone. */
  function setPreset(id, strength) { const prev = { id: st.id, strength: st.strength }; st.id = id || 'none'; if (strength != null) st.strength = strength; save(); push(); try { const l = document.getElementById('gradeList'); if (l) l.querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.id === st.id))); const sr = document.getElementById('gradeStrength'); if (sr) sr.value = Math.round(st.strength * 100); } catch (e) {} return prev; }
  window.VS.Grade = { setPreset, onBox, push, get state() { return st; }, resolved, onStatus(e) { const n = document.getElementById('gradeNote'); if (n && e) n.textContent = 'Skin smoothing turned itself off on this device (' + e + ').'; } };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
