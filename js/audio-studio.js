(async function () {
  const user = await window.VS.renderNav('audio');
  if (!user) return;

  const els = {
    emptyState: document.getElementById('emptyState'),
    audioBody: document.getElementById('audioBody'),
    clipSelect: document.getElementById('clipSelect'),
    video: document.getElementById('audioVideo'),
    canvas: document.getElementById('waveformCanvas'),
    meterL: document.getElementById('meterL'),
    meterR: document.getElementById('meterR'),
    playBtn: document.getElementById('playBtn'),
    pauseBtn: document.getElementById('pauseBtn'),
    timeReadout: document.getElementById('timeReadout'),
    gainRange: document.getElementById('gainRange'),
    gainVal: document.getElementById('gainVal'),
    hpToggle: document.getElementById('hpToggle'),
    hpFreq: document.getElementById('hpFreq'),
    hpFreqVal: document.getElementById('hpFreqVal'),
    musicUploadTrigger: document.getElementById('musicUploadTrigger'),
    musicUpload: document.getElementById('musicUpload'),
    musicFileLabel: document.getElementById('musicFileLabel'),
    musicGainRange: document.getElementById('musicGainRange'),
    musicUnduckRange: document.getElementById('musicUnduckRange'),
    dynamicDuckToggle: document.getElementById('dynamicDuckToggle'),
    lufsMomentary: document.getElementById('lufsMomentary'),
    lufsShortTerm: document.getElementById('lufsShortTerm'),
    lufsIntegrated: document.getElementById('lufsIntegrated'),
    lufsResetBtn: document.getElementById('lufsResetBtn'),
    lufsNote: document.getElementById('lufsNote'),
    lufsRow: document.getElementById('lufsRow'),    musicGainVal: document.getElementById('musicGainVal'),
    musicEl: document.getElementById('musicEl'),
    exportBtn: document.getElementById('exportBtn'),
    audioSupportNote: document.getElementById('audioSupportNote'),
  };
  els.musicUploadTrigger.querySelector('span').innerHTML = window.VS.icon('upload', 22);

  const HEADING_ICONS = { 'Gain': 'sliders', 'Noise reduction': 'audio', 'Background music': 'sparkles' };
  document.querySelectorAll('.panel-card h3').forEach(h => {
    const name = HEADING_ICONS[h.textContent.trim()];
    if (name) h.insertAdjacentHTML('afterbegin', window.VS.icon(name, 14));
  });

  let recordings = [];
  let currentClip = null;
  let musicFile = null;

  function fmt(sec) {
    if (!isFinite(sec)) return '0:00';
    const m = Math.floor(sec / 60), s = Math.floor(sec % 60);
    return `${m}:${String(s).padStart(2, '0')}`;
  }
  function clipTitle(rec) { return rec.meta.title || rec.meta.environment || 'Recording'; }

  recordings = await window.VS.storage.listRecordings();
  if (recordings.length === 0) {
    els.emptyState.style.display = 'flex';
    els.emptyState.innerHTML = `
      ${window.VS.icon('projects', 32)}
      <div class="empty-title">Nothing to mix yet</div>
      <div class="empty-sub">Record something in Studio first, then come back here for gain, noise filtering, and music.</div>
      <a href="studio.html"><button class="btn primary">Open Studio</button></a>`;
    return;
  }
  els.audioBody.style.display = 'block';
  els.clipSelect.innerHTML = recordings.map(r => `<option value="${r.id}">${clipTitle(r)} — ${r.meta.createdAt || ''}</option>`).join('');

  if (!els.video.captureStream && !els.video.mozCaptureStream) {
    els.exportBtn.disabled = true;
    els.audioSupportNote.style.display = 'block';
    els.audioSupportNote.textContent = 'This browser doesn\u2019t support captureStream(), so export is unavailable here (Chrome/Edge recommended). Preview, waveform, and metering still work.';
  }

  // ============================================================
  // Web Audio graph — built once, lazily on first user gesture, and
  // reused across clip switches (a MediaElementSourceNode can only be
  // created once per <video>/<audio> element for its whole lifetime).
  // ============================================================
  let audioCtx = null, videoSource = null, hpFilter = null, gainNode = null, masterGain = null;
  let musicSource = null, musicGainNode = null;
  let analyserL = null, analyserR = null, splitter = null;
  let voiceAnalyser = null, voiceActive = false, duckLoopStarted = false;
  let lufsMeter = null;

  function ensureGraph() {
    if (audioCtx) return;
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    videoSource = audioCtx.createMediaElementSource(els.video);
    hpFilter = audioCtx.createBiquadFilter();
    hpFilter.type = 'highpass';
    hpFilter.frequency.value = parseFloat(els.hpFreq.value);
    gainNode = audioCtx.createGain();
    gainNode.gain.value = dbToLinear(parseFloat(els.gainRange.value));
    masterGain = audioCtx.createGain();
    musicGainNode = audioCtx.createGain();
    musicGainNode.gain.value = dbToLinear(parseFloat(els.musicGainRange.value));

    // video: source -> (optional HPF, toggled by reconnect) -> gain -> master
    videoSource.connect(gainNode); // HPF inserted/removed dynamically in updateFilterRouting()
    gainNode.connect(masterGain);
    musicGainNode.connect(masterGain);
    masterGain.connect(audioCtx.destination);

    // voice-activity tap for dynamic ducking — reads the same post-filter/gain
    // voice signal that actually gets mixed, so it reacts to what you'll hear.
    voiceAnalyser = audioCtx.createAnalyser();
    voiceAnalyser.fftSize = 512;
    gainNode.connect(voiceAnalyser);

    splitter = audioCtx.createChannelSplitter(2);
    analyserL = audioCtx.createAnalyser(); analyserL.fftSize = 256;
    analyserR = audioCtx.createAnalyser(); analyserR.fftSize = 256;
    masterGain.connect(splitter);
    splitter.connect(analyserL, 0);
    splitter.connect(analyserR, 1);
    tickMeters();
    if (!duckLoopStarted) { duckLoopStarted = true; duckLoop(); }

    if (window.AudioContext && audioCtx.createIIRFilter) {
      lufsMeter = new window.VS.LufsMeter(audioCtx, masterGain);
      lufsMeter.init().then(() => { lufsLoop(); }).catch((err) => {
        els.lufsNote.textContent = 'LUFS metering failed to start: ' + err.message;
      });
    } else {
      els.lufsNote.textContent = 'This browser doesn\u2019t support IIRFilterNode, so real K-weighted LUFS metering isn\u2019t available here (Chrome/Edge/Firefox recommended). Peak/RMS meters above still work.';
      els.lufsRow.style.display = 'none';
    }
  }

  function fmtLufs(v) {
    if (v === null || v === undefined || v === -Infinity || Number.isNaN(v)) return '\u2013';
    return v.toFixed(1) + ' LUFS';
  }

  function lufsLoop() {
    requestAnimationFrame(lufsLoop);
    if (!lufsMeter) return;
    els.lufsMomentary.textContent = fmtLufs(lufsMeter.momentary());
    els.lufsShortTerm.textContent = fmtLufs(lufsMeter.shortTerm());
    els.lufsIntegrated.textContent = fmtLufs(lufsMeter.integrated());
  }

  // ============================================================
  // Dynamic voice-triggered ducking — real RMS-based voice-activity
  // detection driving a smooth gain ramp on the music bed. Runs
  // continuously (both live preview and export use the same graph), with
  // hysteresis so it doesn't flicker on breaths/plosives, and separate
  // fast-attack / slow-release time constants so it feels natural rather
  // than pumpy.
  // ============================================================
  function duckLoop() {
    requestAnimationFrame(duckLoop);
    if (!voiceAnalyser || !musicGainNode) return;
    const data = new Uint8Array(voiceAnalyser.fftSize);
    voiceAnalyser.getByteTimeDomainData(data);
    let sum = 0;
    for (let i = 0; i < data.length; i++) { const v = (data[i] - 128) / 128; sum += v * v; }
    const rms = Math.sqrt(sum / data.length);

    const onThresh = 0.025, offThresh = 0.012; // hysteresis band avoids rapid on/off flicker
    if (!voiceActive && rms > onThresh) voiceActive = true;
    else if (voiceActive && rms < offThresh) voiceActive = false;

    if (!els.dynamicDuckToggle.checked) return; // fixed-level mode: sliders drive gain directly instead

    const duckedLinear = dbToLinear(parseFloat(els.musicGainRange.value));
    const unduckedLinear = dbToLinear(parseFloat(els.musicUnduckRange.value));
    const target = voiceActive ? duckedLinear : unduckedLinear;
    const timeConstant = voiceActive ? 0.12 : 0.45; // duck fast, un-duck slowly — the natural-feeling asymmetry
    musicGainNode.gain.setTargetAtTime(target, audioCtx.currentTime, timeConstant);
  }

  function dbToLinear(db) { return Math.pow(10, db / 20); }

  function updateFilterRouting() {
    if (!audioCtx) return;
    videoSource.disconnect();
    if (els.hpToggle.checked) {
      videoSource.connect(hpFilter);
      hpFilter.connect(gainNode);
    } else {
      hpFilter.disconnect();
      videoSource.connect(gainNode);
    }
  }

  function tickMeters() {
    requestAnimationFrame(tickMeters);
    if (!analyserL) return;
    const dataL = new Uint8Array(analyserL.fftSize);
    const dataR = new Uint8Array(analyserR.fftSize);
    analyserL.getByteTimeDomainData(dataL);
    analyserR.getByteTimeDomainData(dataR);
    const rms = (arr) => {
      let sum = 0;
      for (let i = 0; i < arr.length; i++) { const v = (arr[i] - 128) / 128; sum += v * v; }
      return Math.sqrt(sum / arr.length);
    };
    els.meterL.style.height = Math.min(100, rms(dataL) * 220) + '%';
    els.meterR.style.height = Math.min(100, rms(dataR) * 220) + '%';
  }

  // ============================================================
  // Clip loading + waveform
  // ============================================================
  function loadClip(id) {
    currentClip = recordings.find(r => r.id === id);
    if (!currentClip) return;
    els.video.src = URL.createObjectURL(currentClip.blob);
    els.video.onloadedmetadata = () => { els.timeReadout.textContent = `0:00 / ${fmt(els.video.duration)}`; };
    drawWaveformFor(currentClip.blob);
  }

  async function drawWaveformFor(blob) {
    const ctx = els.canvas.getContext('2d');
    ctx.clearRect(0, 0, els.canvas.width, els.canvas.height);
    ctx.fillStyle = 'rgba(255,255,255,0.4)';
    ctx.font = '12px sans-serif';
    ctx.fillText('Decoding waveform...', 12, 20);
    try {
      const arrayBuf = await blob.arrayBuffer();
      const tmpCtx = new (window.AudioContext || window.webkitAudioContext)();
      const audioBuf = await tmpCtx.decodeAudioData(arrayBuf.slice(0));
      renderWaveform(audioBuf);
      tmpCtx.close();
    } catch (err) {
      ctx.clearRect(0, 0, els.canvas.width, els.canvas.height);
      ctx.fillStyle = 'var(--text-faint)';
      ctx.fillText('Waveform unavailable for this clip (' + err.message + ')', 12, 20);
    }
  }

  function renderWaveform(audioBuf) {
    const ctx = els.canvas.getContext('2d');
    const w = els.canvas.width, h = els.canvas.height;
    ctx.clearRect(0, 0, w, h);
    const data = audioBuf.getChannelData(0);
    const step = Math.ceil(data.length / w);
    const mid = h / 2;
    const grad = ctx.createLinearGradient(0, 0, 0, h);
    grad.addColorStop(0, '#74e3ff');
    grad.addColorStop(0.5, '#5e6ad2');
    grad.addColorStop(1, '#9061f9');
    ctx.strokeStyle = grad;
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    for (let x = 0; x < w; x++) {
      let min = 1, max = -1;
      for (let i = 0; i < step; i++) {
        const idx = x * step + i;
        if (idx >= data.length) break;
        const v = data[idx];
        if (v < min) min = v;
        if (v > max) max = v;
      }
      ctx.moveTo(x, mid + min * mid * 0.9);
      ctx.lineTo(x, mid + max * mid * 0.9);
    }
    ctx.stroke();
  }

  els.canvas.addEventListener('click', (e) => {
    if (!els.video.duration) return;
    const rect = els.canvas.getBoundingClientRect();
    const frac = (e.clientX - rect.left) / rect.width;
    els.video.currentTime = frac * els.video.duration;
  });

  els.clipSelect.addEventListener('change', () => loadClip(els.clipSelect.value));
  loadClip(els.clipSelect.value);

  els.video.addEventListener('timeupdate', () => {
    els.timeReadout.textContent = `${fmt(els.video.currentTime)} / ${fmt(els.video.duration)}`;
  });
  els.video.addEventListener('play', () => { els.playBtn.disabled = true; els.pauseBtn.disabled = false; });
  els.video.addEventListener('pause', () => { els.playBtn.disabled = false; els.pauseBtn.disabled = true; });

  els.playBtn.addEventListener('click', async () => {
    ensureGraph();
    updateFilterRouting();
    if (audioCtx.state === 'suspended') await audioCtx.resume();
    els.video.play();
    if (musicFile && els.musicEl.src) { els.musicEl.currentTime = 0; els.musicEl.play(); }
  });
  els.pauseBtn.addEventListener('click', () => { els.video.pause(); els.musicEl.pause(); });

  // ============================================================
  // Controls
  // ============================================================
  els.gainRange.addEventListener('input', () => {
    els.gainVal.textContent = `${els.gainRange.value} dB`;
    if (gainNode) gainNode.gain.value = dbToLinear(parseFloat(els.gainRange.value));
  });
  els.hpFreq.addEventListener('input', () => {
    els.hpFreqVal.textContent = `${els.hpFreq.value} Hz`;
    if (hpFilter) hpFilter.frequency.value = parseFloat(els.hpFreq.value);
  });
  els.hpToggle.addEventListener('change', () => { ensureGraph(); updateFilterRouting(); });
  els.musicGainRange.addEventListener('input', () => {
    els.musicGainVal.textContent = `${els.musicGainRange.value} dB`;
    if (musicGainNode && !els.dynamicDuckToggle.checked) musicGainNode.gain.value = dbToLinear(parseFloat(els.musicGainRange.value));
  });
  els.musicUnduckRange.addEventListener('input', () => {
    els.musicUnduckVal.textContent = `${els.musicUnduckRange.value} dB`;
  });
  els.lufsResetBtn.addEventListener('click', () => { if (lufsMeter) lufsMeter.reset(); });

  els.musicUploadTrigger.addEventListener('click', () => els.musicUpload.click());
  els.musicUpload.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;
    musicFile = file;
    els.musicFileLabel.textContent = file.name;
    els.musicEl.src = URL.createObjectURL(file);
    els.musicEl.loop = true;
    ensureGraph();
    if (!musicSource) {
      musicSource = audioCtx.createMediaElementSource(els.musicEl);
      musicSource.connect(musicGainNode);
    }
  });

  // ============================================================
  // Export — real-time re-capture: video's own video track (unchanged)
  // + the processed Web Audio graph's output, mixed live and recorded.
  // ============================================================
  els.exportBtn.addEventListener('click', async () => {
    ensureGraph();
    updateFilterRouting();
    if (audioCtx.state === 'suspended') await audioCtx.resume();

    els.exportBtn.disabled = true;
    const original = els.exportBtn.textContent;
    try {
      els.video.pause();
      els.video.currentTime = 0;
      await new Promise(resolve => { els.video.onseeked = resolve; });

      const dest = audioCtx.createMediaStreamDestination();
      masterGain.connect(dest);

      const videoStream = els.video.captureStream ? els.video.captureStream() : els.video.mozCaptureStream();
      const videoTrack = videoStream.getVideoTracks()[0];
      const mixedStream = new MediaStream([videoTrack, ...dest.stream.getAudioTracks()]);

      const recorder = new MediaRecorder(mixedStream, { mimeType: 'video/webm;codecs=vp9,opus' });
      const chunks = [];
      recorder.ondataavailable = (e) => { if (e.data.size > 0) chunks.push(e.data); };
      const stopped = new Promise(resolve => { recorder.onstop = resolve; });

      recorder.start();
      els.video.play();
      if (musicFile) { els.musicEl.currentTime = 0; els.musicEl.play(); }

      await new Promise(resolve => {
        function tick() {
          els.exportBtn.textContent = `Exporting... ${fmt(els.video.currentTime)} / ${fmt(els.video.duration)}`;
          if (els.video.ended || els.video.currentTime >= els.video.duration - 0.05) { resolve(); return; }
          requestAnimationFrame(tick);
        }
        tick();
      });

      els.video.pause();
      els.musicEl.pause();
      recorder.stop();
      await stopped;
      masterGain.disconnect(dest);

      const blob = new Blob(chunks, { type: 'video/webm' });
      await window.VS.storage.saveRecording(blob, {
        title: clipTitle(currentClip) + ' (audio mix)',
        createdAt: new Date().toLocaleString(),
        quality: currentClip.meta.quality,
        environment: currentClip.meta.environment,
      });
      alert('Mixed audio exported and saved to Projects.');
    } catch (err) {
      alert('Export failed: ' + err.message);
    } finally {
      els.exportBtn.disabled = false;
      els.exportBtn.textContent = original;
    }
  });
})();
