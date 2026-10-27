/** Audio tab wiring (see js/audio-chain.js). Settings persist in localStorage vs_audio; noise/echo apply to the live mic immediately. */
(function () {
  function init() {
    const $ = (id) => document.getElementById(id); if (!$('audioPreset')) return;
    const P = window.VS.AudioPresets; if (!P) return;
    const sel = $('audioPreset'), ns = $('audioNs'), ec = $('audioEc'), bar = $('audioBar'), read = $('audioReadout'), note = $('audioNote'), test = $('audioTest'), player = $('audioTestPlayer');
    let st = { ns: true, ec: true, preset: 'voice' }; try { Object.assign(st, JSON.parse(localStorage.getItem('vs_audio') || '{}')); } catch (e) {}
    sel.innerHTML = Object.keys(P.PRESETS).map((k) => '<option value="' + k + '">' + P.PRESETS[k].label + '</option>').join('');
    sel.value = st.preset; ns.checked = !!st.ns; ec.checked = !!st.ec;
    const save = () => { try { localStorage.setItem('vs_audio', JSON.stringify(st)); } catch (e) {} };
    sel.addEventListener('change', () => { st.preset = sel.value; save(); const c = window.VS.audioChain; if (c) c.setPreset(st.preset); });
    function applyBrowserFx() {
      const c = window.VS.audioChain; const t = c && c.raw; if (!t || !t.applyConstraints) return;
      t.applyConstraints({ noiseSuppression: st.ns, echoCancellation: st.ec, autoGainControl: false }).catch(() => { note.textContent = 'This browser could not change the filter live. It will apply the next time you start the camera.'; });
    }
    ns.addEventListener('change', () => { st.ns = ns.checked; save(); applyBrowserFx(); });
    ec.addEventListener('change', () => { st.ec = ec.checked; save(); applyBrowserFx(); });
    setInterval(() => {
      const c = window.VS.audioChain;
      if (!c || !c.ok) { read.textContent = c ? 'Audio processing is not available here, so your raw mic is used.' : 'Start the camera to see your level.'; bar.style.width = '0'; return; }
      const peak = c.peakDb, pct = isFinite(peak) ? Math.max(0, Math.min(100, ((peak + 60) / 60) * 100)) : 0;
      bar.style.width = pct + '%'; bar.style.background = peak > -3 ? '#e0343a' : peak > -9 ? '#e0b030' : '#3ecf8e';
      const l = c.lufs, tgt = P.TARGET_LUFS[st.preset];
      read.textContent = 'Peak ' + (isFinite(peak) && peak > -90 ? peak.toFixed(0) : '--') + ' dB | Loudness ' + (l != null && isFinite(l) ? l.toFixed(1) + ' LUFS' : '--') + (tgt != null ? ' (aim for about ' + tgt + ')' : '') + (c.ctx && c.ctx.state !== 'running' ? ' | tap anywhere to start audio' : '');
      note.textContent = P.loudnessNote(l, tgt);
    }, 200);
    test.addEventListener('click', async () => {
      const c = window.VS.audioChain; if (!c || !c.ok) { note.textContent = 'Start the camera first. The mic test uses the same processed sound as your recording.'; return; }
      await c.resume(); const tr = c.outputTrack(); if (!tr) return;
      try {
        const rec = new MediaRecorder(new MediaStream([tr])); const parts = []; rec.ondataavailable = (e) => e.data.size && parts.push(e.data);
        test.disabled = true; test.textContent = 'Recording... speak now (4 s)';
        rec.onstop = () => { const b = new Blob(parts, { type: rec.mimeType || 'audio/webm' }); player.src = URL.createObjectURL(b); player.style.display = 'block'; test.disabled = false; test.textContent = 'Mic test: record 4 s and play back'; note.textContent = 'Play it back with headphones on. If it sounds good here it will sound good in your recording.'; };
        rec.start(); setTimeout(() => rec.state !== 'inactive' && rec.stop(), 4000);
      } catch (e) { test.disabled = false; test.textContent = 'Mic test: record 4 s and play back'; note.textContent = 'This browser cannot record the mic test.'; }
    });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
