/** Music bed + soundboard UI (see js/audio-chain.js). Files are decoded in memory only; nothing is uploaded or saved. */
(function () {
  function init() {
    const $ = (id) => document.getElementById(id); if (!$('mixMusicFile')) return;
    const note = $('mixNote'), say = (t) => { note.textContent = t; }, chain = () => window.VS.audioChain;
    const need = () => { const c = chain(); if (!c || !c.ok) { say('Start the camera first. Music and sounds are mixed into the same audio as your mic.'); return null; } c.resume(); return c; };
    $('mixMusicFile').addEventListener('change', async (e) => {
      const f = e.target.files[0]; if (!f) return; const c = need(); if (!c) return;
      if (f.size > 40e6) { say('That file is big (over 40 MB). Use a shorter one so the phone does not run out of memory.'); return; }
      try { await c.loadMusic(await f.arrayBuffer(), f.name); c.playMusic(); say('Playing "' + f.name.slice(0, 40) + '". It loops.'); } catch (err) { say('Could not read that audio file. Try an MP3, M4A or WAV.'); }
    });
    $('mixPlay').addEventListener('click', () => { const c = need(); if (!c) return; if (!c.music.buf) { say('Choose a music file first.'); return; } c.playMusic(); say('Music playing.'); });
    $('mixStop').addEventListener('click', () => { const c = chain(); if (c && c.ok) c.stopMusic(); say('Music stopped.'); });
    $('mixVol').addEventListener('input', () => { const c = chain(); if (c && c.ok) c.setMusicVolume($('mixVol').value / 100); });
    const duck = () => { const c = chain(); if (c && c.ok) c.setDuck($('mixDuck').checked, +$('mixDuckDb').value); };
    $('mixDenoise').addEventListener('change', async () => { const c = chain(), n = $('mixDenoiseNote'), b = $('mixDenoise'); if (!c || !c.ok) { b.checked = false; n.textContent = 'Start the camera first.'; return; } const want = b.checked; b.disabled = true; const r = await c.setDenoise(want); b.disabled = false; if (want && !r) { b.checked = false; n.textContent = 'Noise removal is not available here, so your microphone is unchanged.'; } else n.textContent = want ? 'Noise removal is on.' : 'Noise removal is off.'; try { localStorage.setItem('vs_denoise', want && r ? '1' : '0'); } catch (e) {} });
    $('mixDuck').addEventListener('change', duck); $('mixDuckDb').addEventListener('input', duck);
    $('mixMonitor').addEventListener('change', () => { const c = chain(); if (c && c.ok) { c.setMonitor($('mixMonitor').checked); if ($('mixMonitor').checked) say('You will hear music and sounds. Wear headphones so the mic does not pick them up.'); } });
    const cache = {};
    document.querySelectorAll('[data-sb]').forEach((b) => b.addEventListener('click', () => { const c = need(); if (!c) return; const k = b.dataset.sb; if (!cache[k]) cache[k] = c.synthSound(k); c.playBuffer(cache[k], 0.8); }));
    const pads = $('mixPads'), slots = [];
    for (let i = 0; i < 4; i++) {
      const w = document.createElement('div'); w.style.cssText = 'display:flex;flex-direction:column;gap:4px;';
      const b = document.createElement('button'); b.type = 'button'; b.className = 'btn ghost'; b.style.minHeight = '44px'; b.textContent = 'Pad ' + (i + 1) + ' (empty)';
      const f = document.createElement('input'); f.type = 'file'; f.accept = 'audio/*'; f.setAttribute('aria-label', 'Sound file for pad ' + (i + 1));
      slots.push({ buf: null }); w.appendChild(b); w.appendChild(f); pads.appendChild(w);
      f.addEventListener('change', async () => { const c = need(); if (!c || !f.files[0]) return; if (f.files[0].size > 8e6) { say('Keep pad sounds short (under 8 MB).'); return; } try { slots[i].buf = await c.ctx.decodeAudioData(await f.files[0].arrayBuffer()); b.textContent = f.files[0].name.slice(0, 18); say('Pad ' + (i + 1) + ' ready.'); } catch (e) { say('Could not read that sound file.'); } });
      b.addEventListener('click', () => { const c = need(); if (!c) return; if (!slots[i].buf) { say('Choose a sound file under this pad first.'); return; } c.playBuffer(slots[i].buf, 0.9); });
    }
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
