/** Trim a finished recording. HONEST: browsers cannot cut a video without re-encoding, so this plays the chosen part and records it again
 *  (takes as long as the part, a little quality is lost). The original is never changed; the trimmed clip is a new file. */
(function () {
  window.VS = window.VS || {};
  /** "83", "1:23", "1:23.5", "01:02:03" -> seconds, or null */
  function parseTime(t) {
    if (typeof t === 'number') return isFinite(t) && t >= 0 ? t : null;
    if (typeof t !== 'string' || !/^\s*\d+(\.\d+)?\s*$|^\s*(\d+:){1,2}\d+(\.\d+)?\s*$/.test(t)) return null;
    const p = t.trim().split(':').map(Number); let s = 0; for (const x of p) s = s * 60 + x; return s;
  }
  function fmt(s) { s = Math.max(0, s); const m = Math.floor(s / 60), r = s - m * 60; return m + ':' + (r < 10 ? '0' : '') + r.toFixed(1); }
  /** Returns {start,end} (clean, clamped) or {error} in plain words. */
  function checkRange(startRaw, endRaw, dur) {
    const a = parseTime(startRaw), b = parseTime(endRaw);
    if (a === null || b === null) return { error: 'Type times like 0:12 or 1:05.5.' };
    if (!(dur > 0) || !isFinite(dur)) return { error: 'I could not read how long this recording is.' };
    const start = Math.min(a, dur), end = Math.min(b, dur);
    if (end - start < 0.5) return { error: 'The cut must be at least half a second long.' };
    if (end <= start) return { error: 'The end must be after the start.' };
    return { start, end };
  }
  function pickMime() { const c = ['video/mp4;codecs=avc1,mp4a', 'video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm']; return c.find((m) => window.MediaRecorder && MediaRecorder.isTypeSupported(m)) || ''; }
  /** Re-record [start,end] of blob. onProgress(0..1). Returns {blob,type}. abort via ctl.cancel = true. */
  async function cut(blob, start, end, onProgress, ctl) {
    const v = document.createElement('video'); v.muted = false; v.playsInline = true; v.preload = 'auto'; v.src = URL.createObjectURL(blob);
    try {
      await new Promise((res, rej) => { v.onloadedmetadata = res; v.onerror = () => rej(new Error('This browser cannot open the recording to trim it.')); });
      if (!v.captureStream) throw new Error('This browser cannot trim recordings (no captureStream).');
      await new Promise((res) => { v.onseeked = res; v.currentTime = start; });
      await v.play(); const stream = v.captureStream(), type = pickMime(), chunks = [];
      for (let i = 0; i < 20 && !stream.getTracks().length; i++) await new Promise((r) => setTimeout(r, 50));   // Chrome adds the tracks a moment after play starts
      if (!stream.getTracks().length) throw new Error('This browser gave no picture to record. Trimming is not available here.');
      const rec = new MediaRecorder(stream, type ? { mimeType: type } : undefined);
      rec.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };
      const done = new Promise((res) => { rec.onstop = res; });
      rec.start(500);
      await new Promise((res) => {
        const iv = setInterval(() => { const p = (v.currentTime - start) / (end - start); if (onProgress) onProgress(Math.max(0, Math.min(1, p))); if (v.currentTime >= end || v.ended || (ctl && ctl.cancel)) { clearInterval(iv); res(); } }, 100);
      });
      v.pause(); if (rec.state !== 'inactive') rec.stop(); await done; stream.getTracks().forEach((t) => t.stop());
      if (ctl && ctl.cancel) return null;
      return { blob: new Blob(chunks, { type: rec.mimeType || type || 'video/webm' }), type: rec.mimeType || type };
    } finally { try { URL.revokeObjectURL(v.src); } catch (e) {} }
  }
  /** Adds a Trim button + panel to a recording row. onNew(blob,type,meta) is called with the trimmed clip. */
  function attach(item, blob, onNew) {
    if (!item || !blob || item.querySelector('.trim-btn')) return;
    const btn = document.createElement('button'); btn.type = 'button'; btn.className = 'btn ghost sm trim-btn'; btn.textContent = 'Trim'; btn.style.minHeight = '44px';
    const box = document.createElement('div'); box.className = 'trim-box'; box.hidden = true;
    box.innerHTML = '<p class="honesty-note" style="margin:6px 0;border:0;padding:0;">Cuts a new copy; your original stays. It plays the part you choose and records it again, so it takes as long as the clip and loses a little quality.</p><div class="field"><label>Start</label><input class="trim-a" type="text" inputmode="decimal" value="0:00"></div><div class="field"><label>End</label><input class="trim-b" type="text" inputmode="decimal"></div><button type="button" class="btn primary sm trim-go" style="min-height:44px;">Make trimmed copy</button> <button type="button" class="btn ghost sm trim-cancel" style="min-height:44px;" hidden>Stop</button><p class="trim-msg honesty-note" role="status" style="border:0;padding:0;"></p>';
    const q = (c) => box.querySelector(c), msg = (t) => { q('.trim-msg').textContent = t; };
    let dur = 0, ctl = null;
    btn.addEventListener('click', async () => {
      box.hidden = !box.hidden; if (box.hidden || dur) return;
      const v = document.createElement('video'); v.preload = 'metadata'; v.src = URL.createObjectURL(blob);
      v.onloadedmetadata = async () => { if (!isFinite(v.duration)) { try { v.currentTime = 1e9; await new Promise((r) => { v.ontimeupdate = r; }); } catch (e) {} } dur = isFinite(v.duration) ? v.duration : 0; q('.trim-b').value = fmt(dur); msg(dur ? 'Length ' + fmt(dur) + '.' : 'Could not read the length.'); URL.revokeObjectURL(v.src); };
      v.onerror = () => msg('This browser cannot open the recording to trim it.');
    });
    q('.trim-go').addEventListener('click', async () => {
      const r = checkRange(q('.trim-a').value, q('.trim-b').value, dur); if (r.error) { msg(r.error); return; }
      ctl = { cancel: false }; q('.trim-go').disabled = true; q('.trim-cancel').hidden = false; msg('Working: 0%. Keep this page open.');
      try {
        const out = await cut(blob, r.start, r.end, (p) => msg('Working: ' + Math.round(p * 100) + '%. Keep this page open.'), ctl);
        if (!out) msg('Stopped. Nothing was saved.');
        else if (!out.blob.size) msg('That did not produce a video. Try a different range.');
        else { msg('Done. Your trimmed copy is below.'); if (onNew) onNew(out.blob, out.type, { trimmedFrom: [r.start, r.end] }); }
      } catch (e) { msg(e.message || 'Trim failed. Your original is safe.'); }
      q('.trim-go').disabled = false; q('.trim-cancel').hidden = true;
    });
    q('.trim-cancel').addEventListener('click', () => { if (ctl) ctl.cancel = true; });
    item.appendChild(btn); item.appendChild(box);
  }
  window.VS.TrimCore = { parseTime, fmt, checkRange };
  window.VS.Trim = { attach, cut, parseTime, checkRange };
})();
