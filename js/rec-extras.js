/** Recording extras (v0.29): chapter markers, thumbnail, separate audio file, and a plain-language format check.
 *  Pure helpers are unit-tested in tools/e2e/unit_rec.js. app.js calls begin() when recording starts and finish() when it stops. */
(function () {
  const pad2 = (n) => (n < 10 ? '0' : '') + n;
  /** ms -> 1:05 or 1:02:05 */
  function stamp(ms) { const s = Math.max(0, Math.floor(ms / 1000)), h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = s % 60; return h ? h + ':' + pad2(m) + ':' + pad2(r) : m + ':' + pad2(r); }
  /** Add a marker at ms. Keeps them sorted, drops ones closer than 1 s to the previous (double taps), caps at 200. Returns the list. */
  function addMarker(list, ms) {
    ms = Math.max(0, Math.round(+ms || 0)); const last = list[list.length - 1];
    if (list.length >= 200 || (last && ms - last.ms < 1000)) return list;
    list.push({ ms, label: 'Marker ' + (list.length + 1) }); return list;
  }
  /** YouTube-style chapter text. YouTube needs the first chapter at 0:00, so one is added; labels are Marker n. */
  function chaptersText(list) { const rows = [{ ms: 0, label: 'Start' }].concat(list.filter((m) => m.ms > 0)); return rows.map((m) => stamp(m.ms) + ' ' + m.label).join('\n'); }
  /** What the person should know about the file this device records. */
  function formatReport(mime, mp4Supported) {
    const m = String(mime || '').toLowerCase();
    if (!m) return 'This browser did not say which video format it records. Make a short test recording and play it on the device you will share to.';
    if (m.indexOf('mp4') >= 0) return 'This device records MP4. It plays almost everywhere, including iPhone, WhatsApp and most social apps.';
    return 'This device records WebM' + (mp4Supported ? '' : ' (it cannot record MP4)') + '. WebM plays in Chrome, Android, VLC and YouTube uploads, but iPhone, WhatsApp and some editors may refuse it. If you need MP4, convert it with a free tool such as HandBrake, or record on a device that supports MP4.';
  }
  const pickAudioMime = (MR) => { MR = MR || (typeof MediaRecorder !== 'undefined' ? MediaRecorder : null); if (!MR || !MR.isTypeSupported) return ''; return ['audio/mp4', 'audio/webm;codecs=opus', 'audio/webm'].find((t) => MR.isTypeSupported(t)) || ''; };

  function begin(canvas, audioTrack, elapsed) {
    const x = { markers: [], thumb: '', audio: null, audioMime: '' }; let chunks = [], rec = null, thumbTimer = 0;
    const shot = () => { try { const c = document.createElement('canvas'); c.width = 320; c.height = Math.max(1, Math.round(320 * canvas.height / canvas.width)); c.getContext('2d').drawImage(canvas, 0, 0, c.width, c.height); x.thumb = c.toDataURL('image/jpeg', 0.7); } catch (e) {} };
    thumbTimer = setTimeout(shot, 1500);
    try {
      const mt = pickAudioMime();
      if (audioTrack && audioTrack.readyState === 'live' && typeof MediaRecorder !== 'undefined') {
        rec = new MediaRecorder(new MediaStream([audioTrack]), mt ? { mimeType: mt } : undefined); x.audioMime = rec.mimeType || mt || 'audio/webm';
        rec.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); }; rec.start(2000);
      }
    } catch (e) { rec = null; }
    const api = {
      marker() { const n = x.markers.length; addMarker(x.markers, elapsed()); return x.markers.length > n; },
      markers: () => x.markers,
      finish() {
        clearTimeout(thumbTimer); if (!x.thumb) shot();
        return new Promise((resolve) => {
          const done = () => { x.audio = chunks.length ? new Blob(chunks, { type: x.audioMime }) : null; resolve({ thumb: x.thumb, markers: x.markers, audio: x.audio, audioMime: x.audioMime }); };
          if (rec && rec.state !== 'inactive') { rec.onstop = done; try { rec.stop(); } catch (e) { done(); } } else done();
        });
      },
    };
    window.VS.recLive = api; return api;
  }
  const extFor = (mime) => (/mp4/.test(mime) ? 'm4a' : /webm/.test(mime) ? 'webm' : 'audio');
  /** Fill a finished-recording list item with thumbnail, chapters and the audio download. */
  function decorate(item, r) {
    if (r.thumb) { const im = document.createElement('img'); im.src = r.thumb; im.alt = 'Recording thumbnail'; im.style.cssText = 'width:100%;max-width:240px;border-radius:8px;display:block;margin:6px 0;'; item.appendChild(im); }
    if (r.audio) { const a = document.createElement('a'); a.href = URL.createObjectURL(r.audio); a.download = 'genesis-audio-' + Date.now() + '.' + extFor(r.audioMime); a.textContent = 'Download audio only'; a.style.marginLeft = '12px'; item.appendChild(a); }
    if (r.markers && r.markers.length) {
      const b = document.createElement('button'); b.type = 'button'; b.className = 'btn ghost sm'; b.style.cssText = 'min-height:44px;margin-top:6px;display:block;'; b.textContent = 'Copy ' + r.markers.length + ' chapter marker' + (r.markers.length > 1 ? 's' : '');
      b.addEventListener('click', () => { const t = chaptersText(r.markers); (navigator.clipboard ? navigator.clipboard.writeText(t) : Promise.reject()).then(() => { b.textContent = 'Copied'; }).catch(() => { prompt('Copy your chapters:', t); }); }); item.appendChild(b);
    }
  }
  window.VS = window.VS || {}; window.VS.RecExtras = { begin, decorate, pure: { stamp, addMarker, chaptersText, formatReport, pickAudioMime } };
  function init() {
    const n = document.getElementById('recFormatNote'), mb = document.getElementById('recMarkerBtn'); if (!n) return;
    const mp4 = typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported('video/mp4');
    n.textContent = formatReport(window.VS.pickRecorderMime ? window.VS.pickRecorderMime() : '', mp4);
    const st = document.getElementById('recMarkerStatus');
    const mark = () => { const l = window.VS.recLive; if (!l) { st.textContent = 'Start recording first, then add markers.'; return; } st.textContent = l.marker() ? l.markers().length + ' marker' + (l.markers().length > 1 ? 's' : '') + ' so far. Last at ' + stamp(l.markers()[l.markers().length - 1].ms) + '.' : 'Marker too close to the last one (wait 1 second).'; };
    mb.addEventListener('click', mark);
    document.addEventListener('keydown', (e) => { if ((e.key === 'm' || e.key === 'M') && !e.ctrlKey && !e.metaKey && !e.altKey && !/INPUT|TEXTAREA|SELECT/.test((e.target && e.target.tagName) || '') && window.VS.recLive) mark(); });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
