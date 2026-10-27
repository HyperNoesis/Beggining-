/**
 * Scene Wizard (M4 / brief E3) — five guided steps, works one-handed on a phone.
 *   1 Pick a scene   2 Size and position   3 Desk edge   4 Match the light   5 Before / after
 * It is a bottom sheet so the live preview stays visible above it. Every number also has - / + buttons
 * (no tiny sliders). Settings are remembered per scene by app.js (saveSceneFor) through VS.sceneApi.
 * All strings live in STRINGS so they can be translated later (brief G8).
 */
(function () {
  const STRINGS = {
    open: 'Scene Wizard', title: 'Scene Wizard', step: (n, t) => 'Step ' + n + ' of ' + t,
    back: 'Back', next: 'Next', done: 'Done', close: 'Close',
    s1: 'Pick a scene', s1h: 'These scenes are drawn for sitting behind a desk. Tap one, or use your own picture.',
    own: 'Use my own picture', all: 'All',
    s2: 'Your size and position', s2h: 'Make yourself the right size for the room, then seat yourself behind the desk.',
    size: 'My size', lr: 'Left / right', ud: 'Up / down', seat: 'Seat me behind the desk',
    s3: 'Desk edge', s3h: 'Drag the yellow line on the preview to the back edge of the desk. Everything below it hides your lower body.',
    find: 'Find the desk for me', finding: 'Looking…', foundGood: (p) => 'Found it (' + p + '% sure). Check the yellow line and nudge it if needed.',
    foundBad: 'I am not sure where the desk is in this picture. Drag the yellow line to the desk edge.',
    noImage: 'The picture is not ready yet. Try again in a moment.',
    edge: 'Desk edge height', tilt: 'Tilt', curve: 'Curve',
    s4: 'Match the light', s4h: 'Make the light on you come from the same side as the light in the picture.',
    lightFrom: 'Light comes from', auto: 'Match the picture', left: 'Left', right: 'Right',
    lightAmt: 'Light on me', finish: 'Finishing touches', fOff: 'Off', fSub: 'Subtle', fStr: 'Strong',
    fHint: 'Room colour on you, a faint desk reflection, a soft glow on bright lights, gentle corner shading, and a little movement in the room (drifting light, dust, screens).',
    s5: 'Before and after', s5h: 'Hold the button to see yourself pasted on the picture. Let go to see the scene.',
    hold: 'Hold to see BEFORE', saved: 'Saved for this scene on this device.',
    honest: 'A fixed-camera scene. You look like you are in the room, but you cannot walk through it.',
  };
  const TOTAL = 5;
  const FINISH = { off: { colourMatch: 0, spill: 0, reflection: 0, bloom: 0, vignette: 0, life: 0, parallax: 0, dof: 0 }, subtle: { colourMatch: 0.5, spill: 0.25, reflection: 0.15, bloom: 0.2, vignette: 0.2, life: 0.3, parallax: 0.25, dof: 0.4 }, strong: { colourMatch: 1, spill: 0.5, reflection: 0.3, bloom: 0.45, vignette: 0.4, life: 0.6, parallax: 0.5, dof: 0.75 } };
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const WALLS = [['Warm white', [244, 238, 226]], ['Sage', [150, 172, 148]], ['Navy', [34, 52, 96]], ['Charcoal', [58, 60, 66]], ['Terracotta', [186, 104, 78]], ['Teal', [40, 128, 134]], ['Cream', [236, 220, 186]], ['Plum', [102, 60, 96]]];
  let pickingWall = false;
  let root, step = 1, filter = 'All', dragging = false, lastDetect = null, lastCheck = null;

  const $ = (id) => document.getElementById(id);
  const api = () => window.VS && window.VS.sceneApi;
  const h = (tag, attrs, kids) => {
    const e = document.createElement(tag);
    Object.keys(attrs || {}).forEach((k) => { if (k === 'text') e.textContent = attrs[k]; else if (k.startsWith('on')) e.addEventListener(k.slice(2), attrs[k]); else e.setAttribute(k, attrs[k]); });
    (kids || []).forEach((c) => e.appendChild(typeof c === 'string' ? document.createTextNode(c) : c));
    return e;
  };

  /** A numeric control with large - / + buttons and a readout. */
  function nudger(label, key, min, max, stepSize, dp) {
    const out = h('span', { class: 'sw-val', 'aria-live': 'polite' });
    const set = (v) => { const a = api(); if (!a) return; const p = {}; p[key] = clamp(Math.round(v / stepSize) * stepSize, min, max); a.patch(p); refreshVals(); };
    const read = () => { const a = api(); return a ? a.state()[key] : 0; };
    const row = h('div', { class: 'sw-row' }, [
      h('span', { class: 'sw-label', text: label }),
      h('button', { type: 'button', class: 'sw-nudge', 'aria-label': label + ' less', text: '−', onclick: () => set(read() - stepSize * 4) }),
      out,
      h('button', { type: 'button', class: 'sw-nudge', 'aria-label': label + ' more', text: '+', onclick: () => set(read() + stepSize * 4) }),
    ]);
    row._refresh = () => { out.textContent = Number(read()).toFixed(dp); };
    return row;
  }
  const nudgers = [];
  function refreshVals() { nudgers.forEach((n) => n._refresh()); }
  function addN(parent, label, key, min, max, st, dp) { const n = nudger(label, key, min, max, st, dp); nudgers.push(n); n._refresh(); parent.appendChild(n); return n; }

  function build() {
    root = h('div', { id: 'sceneWizard', class: 'sw-sheet', role: 'dialog', 'aria-modal': 'false', 'aria-label': STRINGS.title, hidden: '' });
    document.body.appendChild(root);
    document.addEventListener('keydown', (e) => { if (!root.hidden && e.key === 'Escape') close(); });
  }

  function render() {
    nudgers.length = 0;
    root.innerHTML = '';
    const a = api();
    const head = h('div', { class: 'sw-head' }, [
      h('div', {}, [h('div', { class: 'sw-step', text: STRINGS.step(step, TOTAL) }), h('div', { class: 'sw-title', text: [null, STRINGS.s1, STRINGS.s2, STRINGS.s3, STRINGS.s4, STRINGS.s5][step] })]),
      h('button', { type: 'button', class: 'sw-close', 'aria-label': STRINGS.close, text: '×', onclick: close }),
    ]);
    const dots = h('div', { class: 'sw-dots', 'aria-hidden': 'true' });
    for (let i = 1; i <= TOTAL; i++) dots.appendChild(h('span', { class: 'sw-dot' + (i === step ? ' on' : i < step ? ' past' : '') }));
    const body = h('div', { class: 'sw-body' });
    const hint = h('p', { class: 'sw-hint', text: [null, STRINGS.s1h, STRINGS.s2h, STRINGS.s3h, STRINGS.s4h, STRINGS.s5h][step] });
    body.appendChild(hint);

    if (step === 1) {
      const full = (window.VS.SCENE_LIBRARY || []);
      // v0.23: the 12 premium (photoreal) scenes are the main list; the 12 older procedural scenes are kept under a 'Classic' tab
      const lib = filter === 'Classic' ? full.filter((s) => !s.imported) : full.filter((s) => s.imported);
      const types = ['All'].concat(Array.from(new Set(full.filter((s) => s.imported).map((s) => s.type)))).concat(['Classic']);
      const chips = h('div', { class: 'sw-chips', role: 'group', 'aria-label': 'Scene type' });
      types.forEach((t) => chips.appendChild(h('button', { type: 'button', class: 'sw-chip' + (t === filter ? ' on' : ''), text: t === 'All' ? STRINGS.all : t, 'aria-pressed': t === filter ? 'true' : 'false', onclick: () => { filter = t; render(); } })));
      body.appendChild(chips);
      const grid = h('div', { class: 'sw-grid' });
      const cur = a ? a.envId() : null;
      lib.filter((s) => filter === 'All' || filter === 'Classic' || s.type === filter).forEach((s) => {
        grid.appendChild(h('button', { type: 'button', class: 'sw-card' + (s.id === cur ? ' on' : ''), 'aria-label': s.name, onclick: () => { if (a) { a.pickEnv(s.id); a.enable(true); } render(); } }, [
          h('span', { class: 'sw-thumb', style: "background-image:url('" + s.image + "')" }), h('span', { class: 'sw-name', text: s.name })]));
      });
      body.appendChild(grid);
      body.appendChild(h('button', { type: 'button', class: 'btn ghost sm full', text: STRINGS.own, onclick: () => a && a.uploadClick() }));
    }
    if (step === 2) {
      addN(body, STRINGS.size, 'personScale', 0.35, 1.2, 0.01, 2);
      addN(body, STRINGS.lr, 'personX', -0.4, 0.4, 0.005, 3);
      addN(body, STRINGS.ud, 'personY', -0.3, 0.3, 0.005, 3);
      body.appendChild(h('button', { type: 'button', class: 'btn ghost sm full', text: STRINGS.seat, onclick: () => { a && a.autoSeat(); refreshVals(); } }));
    }
    if (step === 3) {
      const status = h('p', { class: 'sw-status', id: 'swDeskStatus', role: 'status', 'aria-live': 'polite' });
      body.appendChild(h('button', { type: 'button', class: 'btn sm full', text: STRINGS.find, onclick: async () => { status.textContent = STRINGS.finding; status.textContent = await detect(); showFixes(); refreshVals(); } }));
      body.appendChild(status);
      body.appendChild(h('div', { id: 'swFixes', class: 'sw-chips' }));
      addN(body, STRINGS.edge, 'deskY', 0.35, 0.95, 0.005, 3);
      addN(body, STRINGS.tilt, 'deskTilt', -0.25, 0.25, 0.005, 3);
      addN(body, STRINGS.curve, 'deskBow', -0.12, 0.12, 0.005, 3);
      if (a) a.holdGuide(true);
    } else if (a) a.holdGuide(false);
    if (step === 4) {
      const sel = h('div', { class: 'sw-seg', role: 'group', 'aria-label': STRINGS.lightFrom });
      const cur = a ? a.state() : {};
      const mode = cur.lightAuto ? 'auto' : (cur.lightSide < 0 ? 'left' : 'right');
      [['auto', STRINGS.auto], ['left', STRINGS.left], ['right', STRINGS.right]].forEach(([v, t]) => sel.appendChild(h('button', { type: 'button', class: 'sw-chip' + (v === mode ? ' on' : ''), text: t, 'aria-pressed': v === mode ? 'true' : 'false', onclick: () => { a && a.patch(v === 'auto' ? { lightAuto: true, lightTint: null } : { lightAuto: false, lightSide: v === 'left' ? -1 : 1 }); render(); } })));
      body.appendChild(h('div', { class: 'sw-label', text: STRINGS.lightFrom })); body.appendChild(sel);
      addN(body, STRINGS.lightAmt, 'lightStrength', 0, 1, 0.05, 2);
      const f = h('div', { class: 'sw-seg', role: 'group', 'aria-label': STRINGS.finish });
      const curF = (() => { const s = cur; if (!s.spill && !s.reflection && !s.bloom && !s.vignette && !s.life && !s.parallax && !s.dof) return 'off'; return (s.spill || 0) > 0.35 ? 'strong' : 'subtle'; })();
      [['off', STRINGS.fOff], ['subtle', STRINGS.fSub], ['strong', STRINGS.fStr]].forEach(([v, t]) => f.appendChild(h('button', { type: 'button', class: 'sw-chip' + (v === curF ? ' on' : ''), text: t, 'aria-pressed': v === curF ? 'true' : 'false', onclick: () => { a && a.patch(FINISH[v]); render(); } })));
      body.appendChild(h('div', { class: 'sw-label', text: STRINGS.finish })); body.appendChild(f);
      body.appendChild(h('p', { class: 'sw-hint', text: STRINGS.fHint }));
      // v0.23: wall colour (no model): pick a colour, then tap the wall in the preview
      const cm = h('div', { class: 'sw-chips', role: 'group', 'aria-label': 'Colour match' });
      [['Off', 0], ['Subtle', 0.5], ['Strong', 1]].forEach(([t, v]) => { const on = Math.abs(((cur && cur.colourMatch) || 0) - v) < 0.01; cm.appendChild(h('button', { type: 'button', class: 'sw-chip' + (on ? ' on' : ''), text: t, 'aria-pressed': on ? 'true' : 'false', onclick: () => { a && a.patch({ colourMatch: v }); render(); } })); });
      body.appendChild(h('div', { class: 'sw-label', text: 'Match my colours to the room' })); body.appendChild(cm);
      const wl = h('div', { class: 'sw-chips', role: 'group', 'aria-label': 'Wall colour' });
      const wstat = h('p', { class: 'sw-status', id: 'swWallStatus', role: 'status', 'aria-live': 'polite', text: (cur && cur.wallOn) ? 'Wall colour is on. Tap the wall again to pick a different area.' : '' });
      WALLS.forEach(([t, rgb]) => wl.appendChild(h('button', { type: 'button', class: 'sw-chip', text: t, style: 'border-left:14px solid rgb(' + rgb.join(',') + ')', onclick: () => {
        if (!a) return; const st = a.state(); a.patch({ wallColour: rgb.slice() });
        if (st.wallX >= 0) { a.patch({ wallOn: true }); wstat.textContent = 'Done. Use "Fill more / less" if the colour spilled or missed a part.'; pickingWall = false; }
        else { pickingWall = true; wstat.textContent = 'Now tap the wall in the preview.'; }
      } })));
      wl.appendChild(h('button', { type: 'button', class: 'sw-chip', text: 'Reset wall', onclick: () => { pickingWall = false; a && a.patch({ wallOn: false, wallX: -1, wallY: -1, wallColour: null }); render(); } }));
      body.appendChild(h('div', { class: 'sw-label', text: 'Wall colour' })); body.appendChild(wl); body.appendChild(wstat);
      addN(body, 'Fill more / less', 'wallTol', 0.1, 1, 0.05, 2);
      addN(body, 'Wall colour strength', 'wallAmt', 0.2, 1, 0.05, 2);
    }
    if (step === 5) {
      const b = h('button', { type: 'button', class: 'btn primary full sw-hold', text: STRINGS.hold });
      const on = () => a && a.before(true), off = () => a && a.before(false);
      b.addEventListener('pointerdown', (e) => { e.preventDefault(); on(); });
      ['pointerup', 'pointerleave', 'pointercancel', 'blur'].forEach((ev) => b.addEventListener(ev, off));
      b.addEventListener('keydown', (e) => { if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); on(); } });
      b.addEventListener('keyup', off);
      body.appendChild(b);
      body.appendChild(h('p', { class: 'sw-status', text: STRINGS.saved }));
      body.appendChild(h('p', { class: 'sw-hint', text: STRINGS.honest }));
    }
    const nav = h('div', { class: 'sw-nav' }, [
      h('button', { type: 'button', class: 'btn ghost', text: STRINGS.back, onclick: () => { step = Math.max(1, step - 1); render(); }, ...(step === 1 ? { disabled: '' } : {}) }),
      h('button', { type: 'button', class: 'btn primary', text: step === TOTAL ? STRINGS.done : STRINGS.next, onclick: () => { if (step === TOTAL) close(); else { step++; render(); } } }),
    ]);
    root.appendChild(head); root.appendChild(dots); root.appendChild(body); root.appendChild(nav);
    refreshVals();
  }

  /** One-tap fixes from the picture check (E7): each button applies a safe settings patch and says what it did. */
  function showFixes() {
    const box = $('swFixes'), a = api(); if (!box || !a) return;
    box.innerHTML = '';
    ((lastCheck && lastCheck.actions) || []).forEach((act) => box.appendChild(h('button', { type: 'button', class: 'sw-chip', text: act.label, onclick: () => { a.patch(act.patch); const st = $('swDeskStatus'); if (st) st.textContent = act.label + ': done. You can undo it with the - / + buttons.'; refreshVals(); } })));
  }

  /** Runs desk detection on the current picture. Returns a plain sentence for the UI. */
  async function detect() {
    const a = api(), SM = window.VS.SceneMeta;
    if (!a || !SM) return STRINGS.foundBad;
    const img = await a.envImage();
    if (!img) return STRINGS.noImage;
    const c = document.createElement('canvas'); c.width = 160; c.height = 90;
    const x = c.getContext('2d', { willReadFrequently: true });
    x.drawImage(img, 0, 0, 160, 90);
    let d = SM.detectDeskLine(x.getImageData(0, 0, 160, 90).data, 160, 90);
    // v0.23: library scenes ship a depth map; the depth-based detector is far more reliable on real photos than colour edges
    try {
      const id = a.envId();
      if (SM.detectDeskFromDepth && id && id.indexOf('scene-') === 0) {
        const r = await fetch('assets/environments/' + id + '-depth.png'); if (r.ok) {
          const bmp = await createImageBitmap(await r.blob()); x.drawImage(bmp, 0, 0, 160, 90);
          const g = x.getImageData(0, 0, 160, 90).data, gray = new Uint8Array(160 * 90); for (let i = 0; i < gray.length; i++) gray[i] = g[i * 4];
          const dd = SM.detectDeskFromDepth(gray, 160, 90); if (dd.confidence >= 0.45) d = dd;
          x.drawImage(img, 0, 0, 160, 90);
        }
      }
    } catch (e) { /* fall back to the colour-edge result */ }
    lastDetect = d;
    let extra = '';
    try { const ck = SM.checkPicture(x.getImageData(0, 0, 160, 90).data, 160, 90); lastCheck = ck; if (ck.issues.length) extra = ' ' + ck.issues.map((t, i) => t + ' ' + (ck.fixes[i] || '')).join(' '); } catch (e) {}
    if (d.confidence >= 0.45) { a.patch({ deskOn: true, deskY: +d.y.toFixed(3), deskTilt: +d.tilt.toFixed(3), deskBow: +d.bow.toFixed(3) }); return STRINGS.foundGood(Math.round(d.confidence * 100)) + extra; }
    return STRINGS.foundBad + extra;
  }

  // Dragging the yellow line directly on the preview (step 3)
  function onPointer(e) {
    if (pickingWall && step === 4 && root && !root.hidden && e.type === 'pointerdown') {
      const cv = $('canvas'); if (cv && !root.contains(e.target)) {
        const r = cv.getBoundingClientRect();
        if (e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom) {
          const a = api(); pickingWall = false;
          if (a) { a.patch({ wallOn: true, wallX: +((e.clientX - r.left) / r.width).toFixed(4), wallY: +((e.clientY - r.top) / r.height).toFixed(4) }); const w = $('swWallStatus'); if (w) w.textContent = 'Done. Use "Fill more / less" if the colour spilled or missed a part.'; }
          return;
        }
      }
    }
    if (!root || root.hidden || step !== 3) return;
    const cv = $('canvas'); if (!cv) return;
    const r = cv.getBoundingClientRect();
    if (e.type === 'pointerdown') { if (root.contains(e.target)) return;   // taps on the sheet itself are never a drag
      if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) return; dragging = true; try { cv.setPointerCapture(e.pointerId); } catch (_) {} }
    if (!dragging) return;
    if (e.type === 'pointerup' || e.type === 'pointercancel') { dragging = false; return; }
    const y = clamp((e.clientY - r.top) / r.height, 0.35, 0.95);
    const a = api(); if (a) { a.patch({ deskY: +(y - (a.state().deskTilt / 2) - a.state().deskBow).toFixed(3) }); refreshVals(); }
  }

  function open() {
    const a = api(); if (!a) return;
    if (!root) build();
    root.hidden = false; step = 1; render();
    document.body.classList.add('sw-open');
    const first = root.querySelector('button.sw-card, button'); if (first) first.focus();
  }
  function close() {
    if (!root) return;
    root.hidden = true; document.body.classList.remove('sw-open');
    const a = api(); if (a) { a.holdGuide(false); a.before(false); }
    try { localStorage.setItem('vs_wizard_seen', '1'); } catch (e) {}
  }

  document.addEventListener('DOMContentLoaded', () => {
    const btn = $('sceneWizardBtn');
    if (btn) btn.addEventListener('click', open);
    ['pointerdown', 'pointermove', 'pointerup', 'pointercancel'].forEach((ev) => document.addEventListener(ev, onPointer));
  });
  window.VS = window.VS || {};
  window.VS.sceneWizard = { open, close, detect, STRINGS, FINISH };
})();
