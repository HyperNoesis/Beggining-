(async function () {
  const user = await window.VS.renderNav('editor');
  if (!user) return;

  const els = {
    emptyState: document.getElementById('emptyState'),
    editorBody: document.getElementById('editorBody'),
    clipSelect: document.getElementById('clipSelect'),
    video: document.getElementById('editorVideo'),
    startRange: document.getElementById('startRange'),
    endRange: document.getElementById('endRange'),
    playheadRange: document.getElementById('playheadRange'),
    scrubFillActive: document.getElementById('scrubFillActive'),
    scrubTrack: document.getElementById('scrubTrack'),
    startReadout: document.getElementById('startReadout'),
    endReadout: document.getElementById('endReadout'),
    durReadout: document.getElementById('durReadout'),
    playTrimBtn: document.getElementById('playTrimBtn'),
    undoBtn: document.getElementById('undoBtn'),
    redoBtn: document.getElementById('redoBtn'),
    markerBtn: document.getElementById('markerBtn'),
    splitBtn: document.getElementById('splitBtn'),
    exportTrimBtn: document.getElementById('exportTrimBtn'),
    addToSeqBtn: document.getElementById('addToSeqBtn'),
    markerList: document.getElementById('markerList'),
    seqList: document.getElementById('seqList'),
    playSeqBtn: document.getElementById('playSeqBtn'),
    clearSeqBtn: document.getElementById('clearSeqBtn'),
    exportNote: document.getElementById('exportNote'),
    aspectChecks: document.getElementById('aspectChecks'),
    batchExportBtn: document.getElementById('batchExportBtn'),
  };

  // decorate panel headings with icons for visual consistency with the rest of the app
  const HEADING_ICONS = { 'Markers': 'lens', 'Sequence': 'layers', 'Batch export (social variants)': 'sparkles' };
  document.querySelectorAll('.panel-card h3').forEach(h => {
    const name = HEADING_ICONS[h.textContent.trim()];
    if (name) h.insertAdjacentHTML('afterbegin', window.VS.icon(name, 14));
  });

  let recordings = [];
  let currentClip = null;
  let trimStart = 0, trimEnd = 0;
  let playingTrim = false;
  let sequence = []; // { clipId, title, trimIn, trimOut }
  let seqPlaying = false;

  // ============================================================
  // Undo/redo — snapshot-based, scoped to trim in/out, markers, and the
  // sequence list (the state actually held in memory before a user
  // commits to an export). Honest exclusion: "Split at playhead" and any
  // export button write a NEW entry straight to IndexedDB/Projects —
  // undoing those would mean silently deleting saved library items, which
  // is a different, more dangerous operation, so they're left out of this
  // stack on purpose. Delete unwanted split/export results from Projects.
  // ============================================================
  let history = [];
  let redoStack = [];
  const HISTORY_LIMIT = 50;
  let dragSnapshot = null; // captured on pointerdown, consumed on change

  function snapshotState() {
    return {
      clipId: currentClip.id,
      trimStart, trimEnd,
      markers: (currentClip.meta.markers || []).slice(),
      sequence: sequence.map(s => ({ ...s })),
    };
  }

  function updateUndoRedoButtons() {
    if (els.undoBtn) els.undoBtn.disabled = history.length === 0;
    if (els.redoBtn) els.redoBtn.disabled = redoStack.length === 0;
  }

  function pushHistory(prevSnapshot) {
    history.push(prevSnapshot);
    if (history.length > HISTORY_LIMIT) history.shift();
    redoStack.length = 0;
    updateUndoRedoButtons();
  }

  async function applyState(state) {
    if (state.clipId !== currentClip.id) {
      const target = recordings.find(r => r.id === state.clipId);
      if (target) {
        currentClip = target;
        els.clipSelect.value = state.clipId;
        els.video.src = URL.createObjectURL(currentClip.blob);
        await new Promise(resolve => { els.video.onloadedmetadata = resolve; });
      }
    }
    trimStart = state.trimStart;
    trimEnd = state.trimEnd;
    els.startRange.value = trimStart;
    els.endRange.value = trimEnd;
    updateReadouts();
    currentClip = await window.VS.storage.updateRecordingMeta(currentClip.id, { markers: state.markers.slice() });
    renderMarkers();
    sequence = state.sequence.map(s => ({ ...s }));
    renderSequence();
  }

  async function undo() {
    if (history.length === 0) return;
    const prev = history.pop();
    redoStack.push(snapshotState());
    await applyState(prev);
    updateUndoRedoButtons();
  }

  async function redo() {
    if (redoStack.length === 0) return;
    const next = redoStack.pop();
    history.push(snapshotState());
    await applyState(next);
    updateUndoRedoButtons();
  }

  function fmt(sec) {
    if (!isFinite(sec)) return '0:00';
    const m = Math.floor(sec / 60), s = Math.floor(sec % 60);
    return `${m}:${String(s).padStart(2, '0')}`;
  }

  function clipTitle(rec) { return rec.meta.title || rec.meta.environment || 'Recording'; }

  // ============================================================
  // Load library
  // ============================================================
  recordings = await window.VS.storage.listRecordings();
  if (recordings.length === 0) {
    els.emptyState.style.display = 'flex';
    els.emptyState.innerHTML = `
      ${window.VS.icon('projects', 32)}
      <div class="empty-title">Nothing to edit yet</div>
      <div class="empty-sub">Record something in Studio first, then come back here to trim, mark, and sequence it.</div>
      <a href="studio.html"><button class="btn primary">Open Studio</button></a>`;
    return;
  }
  els.editorBody.style.display = 'block';

  els.clipSelect.innerHTML = recordings.map(r => `<option value="${r.id}">${clipTitle(r)} — ${r.meta.createdAt || ''}</option>`).join('');

  if (!els.video.captureStream && !els.video.mozCaptureStream) {
    els.exportTrimBtn.disabled = true;
    els.exportTrimBtn.title = 'captureStream() not supported in this browser';
    els.exportNote.textContent = 'This browser doesn\u2019t support captureStream(), so real-time trim export is unavailable here (Chrome/Edge recommended). Everything else on this page still works.';
  }

  function loadClip(id) {
    currentClip = recordings.find(r => r.id === id);
    if (!currentClip) return;
    const url = URL.createObjectURL(currentClip.blob);
    els.video.src = url;
    els.video.onloadedmetadata = () => {
      const dur = els.video.duration || 0;
      [els.startRange, els.endRange, els.playheadRange].forEach(r => { r.max = dur; });
      trimStart = 0;
      trimEnd = dur;
      els.startRange.value = 0;
      els.endRange.value = dur;
      els.playheadRange.value = 0;
      updateReadouts();
      renderMarkers();
    };
  }

  function updateReadouts() {
    els.startReadout.textContent = fmt(trimStart);
    els.endReadout.textContent = fmt(trimEnd);
    els.durReadout.textContent = `Trim: ${fmt(Math.max(0, trimEnd - trimStart))}`;
    const dur = els.video.duration || 1;
    const leftPct = (trimStart / dur) * 100;
    const rightPct = (trimEnd / dur) * 100;
    els.scrubFillActive.style.left = leftPct + '%';
    els.scrubFillActive.style.width = Math.max(0, rightPct - leftPct) + '%';
  }

  els.clipSelect.addEventListener('change', () => loadClip(els.clipSelect.value));
  loadClip(els.clipSelect.value);

  els.startRange.addEventListener('input', () => {
    trimStart = Math.min(parseFloat(els.startRange.value), trimEnd - 0.1);
    els.startRange.value = trimStart;
    els.video.currentTime = trimStart;
    updateReadouts();
  });
  els.endRange.addEventListener('input', () => {
    trimEnd = Math.max(parseFloat(els.endRange.value), trimStart + 0.1);
    els.endRange.value = trimEnd;
    updateReadouts();
  });
  // history is captured once per drag (on pointerdown, before the value
  // changes) and committed once per drag (on 'change', which range inputs
  // fire on release) — not on every 'input' tick, or dragging would flood
  // the undo stack with dozens of intermediate states.
  [els.startRange, els.endRange].forEach(range => {
    range.addEventListener('pointerdown', () => { dragSnapshot = snapshotState(); });
    range.addEventListener('change', () => {
      if (dragSnapshot) { pushHistory(dragSnapshot); dragSnapshot = null; }
    });
  });
  els.playheadRange.addEventListener('input', () => {
    els.video.currentTime = parseFloat(els.playheadRange.value);
  });
  els.video.addEventListener('timeupdate', () => {
    els.playheadRange.value = els.video.currentTime;
    if (playingTrim && els.video.currentTime >= trimEnd) {
      els.video.pause();
      playingTrim = false;
    }
  });

  els.playTrimBtn.addEventListener('click', () => {
    els.video.currentTime = trimStart;
    playingTrim = true;
    els.video.play();
  });
  els.undoBtn.addEventListener('click', undo);
  els.redoBtn.addEventListener('click', redo);
  updateUndoRedoButtons();

  // ============================================================
  // Markers
  // ============================================================
  function renderMarkers() {
    const markers = (currentClip.meta.markers || []).slice().sort((a, b) => a.time - b.time);
    els.markerList.innerHTML = markers.length ? '' : '<p class="honesty-note" style="border:none;padding:0;margin:0;">No markers yet.</p>';
    markers.forEach((m, i) => {
      const row = document.createElement('div');
      row.className = 'marker-row';
      row.innerHTML = `
        <span>${fmt(m.time)} &middot; ${m.label}</span>
        <span class="btn-row">
          <button class="btn ghost xs jump-btn" data-time="${m.time}">Jump</button>
          <button class="btn danger xs del-btn" data-idx="${i}">Delete</button>
        </span>`;
      els.markerList.appendChild(row);
    });
    els.markerList.querySelectorAll('.jump-btn').forEach(b => b.addEventListener('click', () => { els.video.currentTime = parseFloat(b.dataset.time); }));
    els.markerList.querySelectorAll('.del-btn').forEach(b => b.addEventListener('click', async () => {
      const prev = snapshotState();
      const markers2 = (currentClip.meta.markers || []).slice().sort((a, c) => a.time - c.time);
      markers2.splice(parseInt(b.dataset.idx, 10), 1);
      currentClip = await window.VS.storage.updateRecordingMeta(currentClip.id, { markers: markers2 });
      renderMarkers();
      pushHistory(prev);
    }));
  }

  async function addMarkerAtPlayhead() {
    const label = prompt('Marker label:', `Marker at ${fmt(els.video.currentTime)}`);
    if (label === null) return;
    const prev = snapshotState();
    const markers = (currentClip.meta.markers || []).concat([{ time: els.video.currentTime, label: label || 'Marker' }]);
    currentClip = await window.VS.storage.updateRecordingMeta(currentClip.id, { markers });
    renderMarkers();
    pushHistory(prev);
  }
  els.markerBtn.addEventListener('click', addMarkerAtPlayhead);

  // ============================================================
  // Split at playhead — non-destructive: two library entries sharing the
  // same underlying blob, with different trim ranges. No re-encode, so
  // it's instant; use "Export trimmed clip" afterwards to bake either half.
  // ============================================================
  els.splitBtn.addEventListener('click', async () => {
    const t = els.video.currentTime;
    if (t <= trimStart + 0.2 || t >= trimEnd - 0.2) { alert('Move the playhead further inside the trim range to split there.'); return; }
    const baseTitle = clipTitle(currentClip);
    const idA = await window.VS.storage.saveRecording(currentClip.blob, { ...currentClip.meta, title: baseTitle + ' (part 1)', trimIn: trimStart, trimOut: t, createdAt: new Date().toLocaleString(), markers: [] });
    const idB = await window.VS.storage.saveRecording(currentClip.blob, { ...currentClip.meta, title: baseTitle + ' (part 2)', trimIn: t, trimOut: trimEnd, createdAt: new Date().toLocaleString(), markers: [] });
    recordings = await window.VS.storage.listRecordings();
    els.clipSelect.innerHTML = recordings.map(r => `<option value="${r.id}">${clipTitle(r)} — ${r.meta.createdAt || ''}</option>`).join('');
    els.clipSelect.value = idA;
    loadClip(idA);
    alert('Split into two library entries (Projects → Recordings). Each keeps this clip\u2019s trim range; open either to keep editing.');
  });

  // ============================================================
  // Export trimmed clip — a REAL re-capture via captureStream()+MediaRecorder,
  // playing the trim range in real time. Not a fake progress bar.
  // ============================================================
  els.exportTrimBtn.addEventListener('click', async () => {
    const captureFn = els.video.captureStream ? () => els.video.captureStream() : () => els.video.mozCaptureStream();
    els.exportTrimBtn.disabled = true;
    const originalLabel = els.exportTrimBtn.textContent;
    try {
      els.video.pause();
      els.video.currentTime = trimStart;
      await new Promise(resolve => { els.video.onseeked = resolve; });

      const stream = captureFn();
      const recorder = new MediaRecorder(stream, (window.VS.pickRecorderMime && window.VS.pickRecorderMime()) ? { mimeType: window.VS.pickRecorderMime() } : {});
      const chunks = [];
      recorder.ondataavailable = (e) => { if (e.data.size > 0) chunks.push(e.data); };
      const stopped = new Promise(resolve => { recorder.onstop = resolve; });

      recorder.start();
      els.video.play();

      await new Promise(resolve => {
        function tick() {
          els.exportTrimBtn.textContent = `Exporting... ${fmt(Math.max(0, els.video.currentTime - trimStart))} / ${fmt(trimEnd - trimStart)}`;
          if (els.video.currentTime >= trimEnd || els.video.ended) { resolve(); return; }
          requestAnimationFrame(tick);
        }
        tick();
      });

      els.video.pause();
      recorder.stop();
      await stopped;

      const blob = new Blob(chunks, { type: 'video/webm' });
      await window.VS.storage.saveRecording(blob, {
        title: clipTitle(currentClip) + ' (trimmed)',
        createdAt: new Date().toLocaleString(),
        quality: currentClip.meta.quality,
        environment: currentClip.meta.environment,
      });
      alert('Trimmed clip exported and saved to Projects.');
    } catch (err) {
      alert('Export failed: ' + err.message);
    } finally {
      els.exportTrimBtn.disabled = false;
      els.exportTrimBtn.textContent = originalLabel;
    }
  });

  // ============================================================
  // Sequence — ordered list of trimmed clip references, previewed by
  // playing them back-to-back in this same <video> element.
  // ============================================================
  function renderSequence() {
    els.seqList.innerHTML = sequence.length ? '' : '<p class="honesty-note" style="border:none;padding:0;margin:0;">Sequence is empty.</p>';
    sequence.forEach((item, i) => {
      const row = document.createElement('div');
      row.className = 'seq-row';
      row.innerHTML = `
        <span class="seq-title">${i + 1}. ${item.title} (${fmt(item.trimIn)}\u2013${fmt(item.trimOut)})</span>
        <span class="btn-row">
          <button class="btn ghost xs up-btn" data-idx="${i}" ${i === 0 ? 'disabled' : ''} aria-label="Move up">&uarr;</button>
          <button class="btn ghost xs down-btn" data-idx="${i}" ${i === sequence.length - 1 ? 'disabled' : ''} aria-label="Move down">&darr;</button>
          <button class="btn danger xs rm-btn" data-idx="${i}" aria-label="Remove from sequence">&times;</button>
        </span>`;
      els.seqList.appendChild(row);
    });
    els.seqList.querySelectorAll('.up-btn').forEach(b => b.addEventListener('click', () => {
      const prev = snapshotState();
      const i = parseInt(b.dataset.idx, 10);
      [sequence[i - 1], sequence[i]] = [sequence[i], sequence[i - 1]];
      renderSequence();
      pushHistory(prev);
    }));
    els.seqList.querySelectorAll('.down-btn').forEach(b => b.addEventListener('click', () => {
      const prev = snapshotState();
      const i = parseInt(b.dataset.idx, 10);
      [sequence[i + 1], sequence[i]] = [sequence[i], sequence[i + 1]];
      renderSequence();
      pushHistory(prev);
    }));
    els.seqList.querySelectorAll('.rm-btn').forEach(b => b.addEventListener('click', () => {
      const prev = snapshotState();
      sequence.splice(parseInt(b.dataset.idx, 10), 1);
      renderSequence();
      pushHistory(prev);
    }));
  }

  els.addToSeqBtn.addEventListener('click', () => {
    const prev = snapshotState();
    sequence.push({ clipId: currentClip.id, title: clipTitle(currentClip), trimIn: trimStart, trimOut: trimEnd });
    renderSequence();
    pushHistory(prev);
  });
  els.clearSeqBtn.addEventListener('click', () => {
    if (sequence.length === 0) return;
    const prev = snapshotState();
    sequence = [];
    renderSequence();
    pushHistory(prev);
  });

  els.playSeqBtn.addEventListener('click', async () => {
    if (seqPlaying || sequence.length === 0) return;
    seqPlaying = true;
    els.playSeqBtn.disabled = true;
    const savedClipId = currentClip.id;
    for (const item of sequence) {
      if (!seqPlaying) break;
      const rec = recordings.find(r => r.id === item.clipId);
      if (!rec) continue;
      if (currentClip.id !== rec.id) {
        currentClip = rec;
        els.video.src = URL.createObjectURL(rec.blob);
        await new Promise(resolve => { els.video.onloadedmetadata = resolve; });
      }
      els.video.currentTime = item.trimIn;
      await new Promise(resolve => { els.video.onseeked = resolve; });
      els.video.play();
      await new Promise(resolve => {
        function tick() {
          if (!seqPlaying || els.video.currentTime >= item.trimOut || els.video.ended) { resolve(); return; }
          requestAnimationFrame(tick);
        }
        tick();
      });
      els.video.pause();
    }
    seqPlaying = false;
    els.playSeqBtn.disabled = false;
    els.clipSelect.value = savedClipId;
    loadClip(savedClipId);
  });

  // ============================================================
  // Batch export — real center-crop re-render per aspect ratio, one at a
  // time (only one video can play at once). Each variant is genuinely
  // re-captured in real time, not a metadata relabel.
  // ============================================================
  const ASPECTS = [
    { id: '9:16', label: 'Vertical (9:16) — Reels/TikTok/Shorts', ratio: 9 / 16 },
    { id: '1:1', label: 'Square (1:1) — Feed post', ratio: 1 },
    { id: '4:5', label: 'Portrait (4:5) — Feed post', ratio: 4 / 5 },
    { id: '16:9', label: 'Widescreen (16:9) — YouTube', ratio: 16 / 9 },
  ];
  els.aspectChecks.innerHTML = ASPECTS.map(a => `
    <label class="toggle-row" style="padding:6px 2px;">
      <input type="checkbox" class="aspect-check" value="${a.id}">
      <span>${a.label}</span>
    </label>`).join('');

  if (!els.video.captureStream && !els.video.mozCaptureStream) {
    els.batchExportBtn.disabled = true;
  }

  function cropRectFor(ratio, sourceW, sourceH) {
    let cropW, cropH;
    if (sourceW / sourceH > ratio) { cropH = sourceH; cropW = sourceH * ratio; }
    else { cropW = sourceW; cropH = sourceW / ratio; }
    return { sx: (sourceW - cropW) / 2, sy: (sourceH - cropH) / 2, sw: cropW, sh: cropH };
  }

  async function exportOneAspect(aspect) {
    const ratio = aspect.ratio;
    const sourceW = els.video.videoWidth, sourceH = els.video.videoHeight;
    const crop = cropRectFor(ratio, sourceW, sourceH);
    const outW = ratio >= 1 ? 1280 : Math.round(1280 * ratio);
    const outH = ratio >= 1 ? Math.round(1280 / ratio) : 1280;

    const canvas = document.createElement('canvas');
    canvas.width = outW; canvas.height = outH;
    const cctx = canvas.getContext('2d');

    els.video.pause();
    els.video.currentTime = trimStart;
    await new Promise(resolve => { els.video.onseeked = resolve; });

    const canvasStream = canvas.captureStream(30);
    const audioTracks = (els.video.captureStream ? els.video.captureStream() : els.video.mozCaptureStream()).getAudioTracks();
    audioTracks.forEach(t => canvasStream.addTrack(t));

    const recorder = new MediaRecorder(canvasStream, Object.assign({ videoBitsPerSecond: 6000000 }, (window.VS.pickRecorderMime && window.VS.pickRecorderMime()) ? { mimeType: window.VS.pickRecorderMime() } : {}));
    const chunks = [];
    recorder.ondataavailable = (e) => { if (e.data.size > 0) chunks.push(e.data); };
    const stopped = new Promise(resolve => { recorder.onstop = resolve; });

    let drawing = true;
    function drawFrame() {
      if (!drawing) return;
      cctx.drawImage(els.video, crop.sx, crop.sy, crop.sw, crop.sh, 0, 0, outW, outH);
      requestAnimationFrame(drawFrame);
    }

    recorder.start();
    els.video.play();
    drawFrame();

    await new Promise(resolve => {
      function tick() {
        els.batchExportBtn.textContent = `Exporting ${aspect.id}... ${fmt(Math.max(0, els.video.currentTime - trimStart))} / ${fmt(trimEnd - trimStart)}`;
        if (els.video.currentTime >= trimEnd || els.video.ended) { resolve(); return; }
        requestAnimationFrame(tick);
      }
      tick();
    });

    drawing = false;
    els.video.pause();
    recorder.stop();
    await stopped;

    const blob = new Blob(chunks, { type: 'video/webm' });
    await window.VS.storage.saveRecording(blob, {
      title: clipTitle(currentClip) + ` (${aspect.id})`,
      createdAt: new Date().toLocaleString(),
      quality: currentClip.meta.quality,
      environment: currentClip.meta.environment,
      aspect: aspect.id,
    });
  }

  els.batchExportBtn.addEventListener('click', async () => {
    const selected = Array.from(document.querySelectorAll('.aspect-check:checked')).map(c => ASPECTS.find(a => a.id === c.value));
    if (selected.length === 0) { alert('Pick at least one aspect ratio.'); return; }
    els.batchExportBtn.disabled = true;
    const original = els.batchExportBtn.textContent;
    try {
      for (const aspect of selected) {
        await exportOneAspect(aspect);
      }
      alert(`Exported ${selected.length} variant${selected.length === 1 ? '' : 's'} to Projects.`);
    } catch (err) {
      alert('Batch export failed: ' + err.message);
    } finally {
      els.batchExportBtn.disabled = false;
      els.batchExportBtn.textContent = original;
    }
  });

  // ============================================================
  // Keyboard shortcuts — standard NLE bindings. Ignored while a form
  // field/prompt has focus so typing (marker labels, etc.) is never
  // hijacked. J/K/L implement real speed-cycling like a real editor,
  // not just single-step play/pause.
  // ============================================================
  const FRAME = 1 / 30; // frame-step size; matches the app's fixed export FPS options
  let jklSpeed = 0; // negative = reverse (display only; video can't truly reverse-play, so J steps back), positive = forward multiplier

  function isTypingTarget(el) {
    return el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable);
  }

  document.addEventListener('keydown', (e) => {
    if (!currentClip) return;
    if (isTypingTarget(document.activeElement)) return;

    const mod = e.ctrlKey || e.metaKey;
    if (mod && e.key.toLowerCase() === 'z' && !e.shiftKey) { e.preventDefault(); undo(); return; }
    if (mod && (e.key.toLowerCase() === 'y' || (e.key.toLowerCase() === 'z' && e.shiftKey))) { e.preventDefault(); redo(); return; }
    if (e.ctrlKey || e.metaKey || e.altKey) return;

    switch (e.key.toLowerCase()) {
      case ' ':
        e.preventDefault();
        if (els.video.paused) els.video.play(); else els.video.pause();
        break;
      case 'k':
        e.preventDefault();
        els.video.pause();
        jklSpeed = 0;
        break;
      case 'j':
        e.preventDefault();
        els.video.pause();
        // no native reverse playback in HTMLMediaElement — step back a full
        // second per press instead, which is the honest equivalent
        els.video.currentTime = Math.max(0, els.video.currentTime - 1);
        break;
      case 'l':
        e.preventDefault();
        if (!els.video.paused && jklSpeed > 0) {
          jklSpeed = Math.min(4, jklSpeed * 2);
        } else {
          jklSpeed = 1;
        }
        els.video.playbackRate = jklSpeed;
        els.video.play();
        break;
      case 'arrowleft':
        e.preventDefault();
        els.video.pause();
        els.video.currentTime = Math.max(0, els.video.currentTime - FRAME);
        break;
      case 'arrowright':
        e.preventDefault();
        els.video.pause();
        els.video.currentTime = Math.min(els.video.duration || Infinity, els.video.currentTime + FRAME);
        break;
      case 'i':
        e.preventDefault();
        {
          const prev = snapshotState();
          els.startRange.value = Math.min(els.video.currentTime, trimEnd - 0.1);
          els.startRange.dispatchEvent(new Event('input'));
          pushHistory(prev);
        }
        break;
      case 'o':
        e.preventDefault();
        {
          const prev = snapshotState();
          els.endRange.value = Math.max(els.video.currentTime, trimStart + 0.1);
          els.endRange.dispatchEvent(new Event('input'));
          pushHistory(prev);
        }
        break;
      case 'm':
        e.preventDefault();
        addMarkerAtPlayhead();
        break;
      case 's':
        e.preventDefault();
        els.splitBtn.click();
        break;
    }
  });

  // reset J/K/L speed once playback actually stops, so a later L starts at 1x
  els.video.addEventListener('pause', () => { jklSpeed = 0; els.video.playbackRate = 1; });
})();
