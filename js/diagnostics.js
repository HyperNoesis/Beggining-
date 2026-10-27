/**
 * Genesis Diagnostics (v0.13, brief section 5 A1).
 * Hidden panel: tap the logo 5 times (or add #diag to the URL). Everything here stays on the device;
 * "Copy report" puts plain text on the clipboard for the user to send. Nothing is uploaded.
 *
 * app.js registers a live-state getter: window.VS.diagState = () => ({...}).
 */
(function () {
  const MAX_ERRORS = 20;
  const errors = [];
  function pushError(msg) {
    errors.push(new Date().toISOString().slice(11, 19) + ' ' + String(msg).slice(0, 300));
    if (errors.length > MAX_ERRORS) errors.shift();
  }
  window.addEventListener('error', (e) => { if (e && e.message && e.message !== 'Script error.') pushError(e.message); });
  window.addEventListener('unhandledrejection', (e) => pushError('promise: ' + ((e && e.reason && (e.reason.message || e.reason)) || 'rejected')));

  window.VS = window.VS || {};
  const origReport = window.VS.reportError;
  window.VS.reportError = function (m) { pushError(m); if (origReport) origReport(m); };
  window.VS.logError = pushError;

  function gpuInfo() {
    try {
      const c = document.createElement('canvas');
      const gl = c.getContext('webgl2');
      if (!gl) return { webgl2: false, renderer: 'n/a' };
      const ext = gl.getExtension('WEBGL_debug_renderer_info');
      const renderer = ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
      const lose = gl.getExtension('WEBGL_lose_context');
      if (lose) lose.loseContext();
      return { webgl2: true, renderer: String(renderer) };
    } catch (e) { return { webgl2: false, renderer: 'error: ' + e.message }; }
  }

  async function collect() {
    const g = gpuInfo();
    const st = (typeof window.VS.diagState === 'function') ? (window.VS.diagState() || {}) : {};
    const out = {
      time: new Date().toISOString(),
      build: 'genesis v0.49',
      userAgent: navigator.userAgent,
      device: (navigator.userAgentData && navigator.userAgentData.mobile != null ? 'mobile=' + navigator.userAgentData.mobile : '') +
        (navigator.userAgentData && navigator.userAgentData.platform ? ' platform=' + navigator.userAgentData.platform : ''),
      screen: screen.width + 'x' + screen.height + ' @' + (window.devicePixelRatio || 1),
      cores: navigator.hardwareConcurrency || 'n/a',
      memoryGB: navigator.deviceMemory || 'n/a (not exposed)',
      webgl2: g.webgl2,
      gpuRenderer: g.renderer,
      webgpu: !!navigator.gpu,
      online: navigator.onLine,
      connection: navigator.connection ? (navigator.connection.effectiveType + ' / ' + (navigator.connection.downlink || '?') + ' Mbps' + (navigator.connection.saveData ? ' / saveData' : '')) : 'n/a',
      rememberedEngine: (function () { try { return localStorage.getItem('vs_seg_backend') || 'none yet'; } catch (e) { return 'storage blocked'; } })(),
      selfCheck: (function () { try { return localStorage.getItem('vs_selfcheck') || 'not run yet'; } catch (e) { return 'storage blocked'; } })(),
      thermal: 'no browser thermal API; see fps trend and pressure below',
      pressure: window.__vsPressure || ('PressureObserver' in window ? 'no reading yet' : 'not supported'),
      state: st,
      errors: errors.slice(),
    };
    try {
      if (navigator.getBattery) {
        const b = await navigator.getBattery();
        out.battery = Math.round(b.level * 100) + '%' + (b.charging ? ' charging' : ' discharging');
      } else out.battery = 'n/a (not exposed by this browser)';
    } catch (e) { out.battery = 'error'; }
    return out;
  }

  function format(r) {
    const s = r.state || {};
    const lines = [
      'Genesis diagnostics (' + r.build + ') ' + r.time,
      'Device: ' + r.userAgent, r.device && ('  ' + r.device),
      'Screen: ' + r.screen + ' | cores ' + r.cores + ' | memory GB ' + r.memoryGB,
      'GPU renderer: ' + r.gpuRenderer + ' | WebGL2 ' + r.webgl2 + ' | WebGPU ' + r.webgpu,
      'Network: ' + (r.online ? 'online' : 'OFFLINE') + ' | ' + r.connection,
      'Battery: ' + r.battery + ' | Compute pressure: ' + r.pressure,
      'Engine now: ' + (s.engine || 'not running') + ' | delegate/backend: ' + (s.delegate || 'n/a') + ' | remembered: ' + r.rememberedEngine,
      'Mask coverage: ' + (s.coveragePct == null ? 'n/a' : s.coveragePct + '%') + ' | mask size: ' + (s.maskSize || 'n/a'),
      'Segmentation ms (avg): ' + (s.segMs == null ? 'n/a' : s.segMs) + ' | render ms (frame): ' + (s.renderMs == null ? 'n/a' : s.renderMs),
      'FPS: ' + (s.fps == null ? 'n/a' : s.fps) + ' | dropped/stalled frames: ' + (s.dropped == null ? 'n/a' : s.dropped) + ' | loop: ' + (s.loopMode || 'n/a') + ' | battery saver: ' + (s.batterySaver ? 'ON' : 'off'),
      'Camera track reports: ' + (s.camera || 'n/a') + '  (if loop period is far above frame total, the camera is the limit: add light, or this phone caps it)',
      'Stages ms: ' + (s.stages || 'n/a'),
      'Time to camera visible: ' + (s.msToCamera == null ? 'n/a' : s.msToCamera + ' ms') + ' | to first cutout: ' + (s.msToCutout == null ? 'n/a' : s.msToCutout + ' ms'),
      s.seat && ('Seated scene: ' + s.seat),
      'Self-check: ' + r.selfCheck,
      'Last errors (' + r.errors.length + '):',
    ].filter(Boolean);
    r.errors.forEach((e) => lines.push('  ' + e));
    try { const fx = window.VS.fxSpeed && window.VS.fxSpeed.last(); if (fx) lines.push(window.VS.fxSpeed.fmt(fx)); else lines.push('Effects speed test: not run yet'); } catch (e) {}
    try { if (window.__studioCheck && window.VS.studioCheck) lines.push(window.VS.studioCheck.format(window.__studioCheck)); else lines.push('Studio Check: not run yet'); } catch (e) { lines.push('Studio Check: format error'); }
    try {   // v0.49 Phase 1: camera control result (MEASURED on this phone)
      const cc = window.VS.CameraControl && window.VS.CameraControl.state();
      if (cc) {
        lines.push('CAMERA CONTROL (v0.49): ' + window.VS.CameraControl.summary());
        lines.push('  phase ' + cc.phase + ' | exposure ' + cc.mode + ' | brighten gain x' + (cc.gain || 1).toFixed(2) + ' | face luma ' + (cc.luma == null ? 'n/a' : cc.luma) + ' | fps before ' + (cc.fpsBefore == null ? 'n/a' : cc.fpsBefore) + ' -> after ' + (cc.fpsAfter == null ? 'n/a' : cc.fpsAfter));
        (cc.rows || []).forEach((x) => lines.push('  tried "' + x.name + '": ' + (x.error ? 'error ' + x.error : 'fps ' + x.fps + ', luma ' + x.luma + (x.why ? ' (' + x.why + ')' : '') + (x.ok ? ' [good]' : ' [rejected]') + (x.got ? ' got ' + JSON.stringify(x.got) : ''))));
      }
    } catch (e) { lines.push('Camera control: format error'); }
    const T = window.__tuneSummary;
    if (T) {
      lines.push('FULL TEST (' + T.seconds + ' s, battery change ' + T.batteryDropPct + ' pct points):');
      lines.push('  Camera: ' + JSON.stringify(T.cam));
      lines.push('  Raw camera callbacks/s with NO processing (display none / 1px / under canvas): ' + JSON.stringify(T.probes));
      (T.camResults || []).forEach((x) => lines.push('  CAMERA MODE ' + x.name + ' | ' + (x.error ? 'error ' + x.error : 'delivers ' + x.fps + ' fps | got ' + x.got)));
      T.results.forEach((x) => lines.push('  ' + x.label + ' | loop ' + x.loop + ' | video ' + x.vid + ' | stride ' + x.stride + ' | engine ' + x.engine + ' | fps ' + x.fps + ' | person ' + x.cov + '% | camera ' + x.camFps + ' fps | seg ' + x.seg + ' ms | frame ' + x.frame + ' ms | period ' + x.period + ' ms'));
      if (T.engineNotes.length) lines.push('  Engine notes: ' + T.engineNotes.join(' ; '));
      lines.push('  APPLIED: ' + JSON.stringify(T.final));
    }
    return lines.join('\n');
  }

  let panel, pre, timer;
  function build() {
    panel = document.createElement('div');
    panel.className = 'vs-diag';
    panel.hidden = true;
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-label', 'Diagnostics');
    panel.innerHTML = '<h2>Diagnostics</h2><div class="row"><button type="button" data-a="copy">Copy report</button><button type="button" data-a="check">Studio Check (about 2 min)</button><button type="button" data-a="tune">Run full test (about 60 s)</button><button type="button" data-a="fx">Test effects speed (about 30 s)</button><button type="button" data-a="close">Close</button></div><pre aria-live="off"></pre><p style="font-family:system-ui,sans-serif;opacity:.7">For the full test: start the camera, stand in good light with your face in frame, tap Run full test and hold still for about a minute. This report stays on your device until you choose to send it. It contains no video or audio.</p>';
    pre = panel.querySelector('pre');
    panel.addEventListener('click', async (e) => {
      const a = e.target && e.target.getAttribute && e.target.getAttribute('data-a');
      if (a === 'close') hide();
      if (a === 'check') {
        const b = e.target; b.disabled = true;
        try { await window.VS.studioCheckRun((t) => { b.textContent = t.slice(0, 60); }); b.textContent = 'Studio Check done: press Copy report'; }
        catch (err) { b.textContent = String(err.message || err).slice(0, 80); }
        b.disabled = false; refresh();
      }
      if (a === 'tune') {
        const b = e.target; b.disabled = true;
        try { await window.VS.tune.run((t) => { b.textContent = t.slice(0, 60); window.__tuneProgress = t; }); b.textContent = 'Full test done: press Copy report'; }
        catch (err) { b.textContent = String(err.message || err).slice(0, 80); }
        b.disabled = false;
      }
      if (a === 'fx') {
        const b = e.target; b.disabled = true;
        try { const r = await window.VS.fxSpeed.run((t) => { b.textContent = t.slice(0, 60); }); b.textContent = 'Done (' + r.tier + '): press Copy report'; }
        catch (err) { b.textContent = String(err.message || err).slice(0, 80); }
        b.disabled = false; refresh();
      }
      if (a === 'copy') {
        const text = format(await collect());
        try { await navigator.clipboard.writeText(text); e.target.textContent = 'Copied'; }
        catch (err) {
          const r = document.createRange(); r.selectNodeContents(pre); const sel = getSelection(); sel.removeAllRanges(); sel.addRange(r);
          e.target.textContent = 'Select and copy';
        }
        setTimeout(() => { e.target.textContent = 'Copy report'; }, 1800);
      }
    });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !panel.hidden) hide(); });
    document.body.appendChild(panel);
  }
  async function refresh() { if (panel && !panel.hidden) pre.textContent = format(await collect()); }
  function show() { if (!panel) build(); panel.hidden = false; refresh(); timer = setInterval(refresh, 1000); panel.querySelector('button').focus(); }
  function hide() { if (panel) panel.hidden = true; clearInterval(timer); }

  // Tap the logo 5 times within 3 seconds.
  let taps = [];
  document.addEventListener('click', (e) => {
    const t = e.target && e.target.closest && e.target.closest('.brand-mini');
    if (!t) return;
    const now = Date.now();
    taps = taps.filter((x) => now - x < 3000); taps.push(now);
    if (taps.length >= 5) { taps = []; show(); }
  });
  if (location.hash === '#diag') window.addEventListener('load', show);

  // Compute Pressure API (Chrome): the closest thing a browser has to a thermal hint.
  try {
    if ('PressureObserver' in window) {
      const po = new PressureObserver((recs) => { const r = recs[recs.length - 1]; window.__vsPressure = r.state; });
      po.observe('cpu', { sampleInterval: 2000 }).catch(() => {});
    }
  } catch (e) { /* optional */ }

  window.VS.diag = { show, hide, collect, format, errors };
})();
