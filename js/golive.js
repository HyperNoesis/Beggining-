/** Go Live check UI: checklist button, gate before Go Live, live health line. Uses VS.GoLiveCore (pure). */
(function () {
  const $ = (id) => document.getElementById(id);
  let armedWarn = false, armTimer = null;
  const ICON = { ok: '✓', warn: '!', fail: '✕' };
  function micDb(track) {
    return new Promise((res) => {
      try {
        if (!track || track.readyState !== 'live') return res(null);
        const AC = window.AudioContext || window.webkitAudioContext; const ac = new AC(); const src = ac.createMediaStreamSource(new MediaStream([track]));
        const an = ac.createAnalyser(); an.fftSize = 1024; src.connect(an); const buf = new Float32Array(an.fftSize); let peak = 0, n = 0;
        const iv = setInterval(() => { an.getFloatTimeDomainData(buf); let s = 0; for (let i = 0; i < buf.length; i++) s += buf[i] * buf[i]; peak = Math.max(peak, Math.sqrt(s / buf.length)); n++; }, 100);
        setTimeout(() => { clearInterval(iv); try { ac.close(); } catch (e) {} res(peak > 0 ? 20 * Math.log10(peak) : -120); }, 1200);
      } catch (e) { res(null); }
    });
  }
  async function collect() {
    const api = window.VS.liveApi; const f = api ? api.facts() : {}; const c = navigator.connection || {}; let battery = null;
    try { if (navigator.getBattery) { const b = await navigator.getBattery(); battery = { level: b.level, charging: b.charging }; } } catch (e) {}
    let fx = null; try { const r = JSON.parse(localStorage.getItem('vs_fx_speed') || 'null'); fx = r && r.tier; } catch (e) {}
    return { running: f.running, endpoint: f.endpoint, endpointOk: f.endpointOk, secure: window.isSecureContext !== false, online: navigator.onLine !== false, hasAudio: !!f.audioTrack, micDb: f.audioTrack ? await micDb(f.audioTrack) : null, fps: f.fps, outW: f.outW, outH: f.outH, bitrate: f.bitrate, downlinkMbps: typeof c.downlink === 'number' ? c.downlink : null, effectiveType: c.effectiveType, saveData: !!c.saveData, battery, recording: f.recording, fxTier: fx };
  }
  function render(r) {
    const ul = $('goLiveChecklist'); if (!ul) return; ul.textContent = '';
    r.items.forEach((it) => { const li = document.createElement('li'); li.className = 'gl-' + it.level; li.dataset.id = it.id; li.dataset.level = it.level; const b = document.createElement('span'); b.className = 'gl-ic'; b.textContent = ICON[it.level]; b.setAttribute('aria-label', it.level === 'ok' ? 'OK' : it.level === 'warn' ? 'Warning' : 'Problem'); li.appendChild(b); li.appendChild(document.createTextNode(' ' + it.text)); ul.appendChild(li); });
  }
  async function run() { const r = window.VS.GoLiveCore.evaluate(await collect()); render(r); return r; }
  function disarm() { armedWarn = false; clearTimeout(armTimer); const b = $('goLiveBtn'); if (b && b.textContent === 'Go live anyway') b.textContent = 'Go Live'; }
  /** Called by the Go Live button. true = start streaming now. */
  async function gate() {
    if (armedWarn) { disarm(); return true; }
    const r = await run();
    if (!r.canGo) return false;                      // real problems: list shown, nothing starts
    if (r.warns === 0) return true;
    armedWarn = true; $('goLiveBtn').textContent = 'Go live anyway';   // warnings: tap again within 30 s
    armTimer = setTimeout(disarm, 30000); return false;
  }
  window.VS.GoLive = { gate, run, collect };
  document.addEventListener('DOMContentLoaded', () => {
    const b = $('goLiveCheckBtn'); if (b) b.addEventListener('click', async () => { b.disabled = true; try { disarm(); await run(); } finally { b.disabled = false; } });
    const h = $('liveHealth');
    if (window.VS.liveApi && h) window.VS.liveApi.onStats((s) => { const r = window.VS.GoLiveCore.health(s); h.style.display = 'block'; h.dataset.level = r.level; h.textContent = r.text; });
    const st = $('liveStatus'); if (st && h) new MutationObserver(() => { if (st.classList.contains('error') || !st.classList.contains('live')) { if (!st.classList.contains('live')) h.style.display = 'none'; } }).observe(st, { attributes: true, attributeFilter: ['class'] });
  });
})();
