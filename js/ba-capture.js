/** One tap in Studio: saves a before (raw camera) and after (finished output) picture for your own website. Pictures stay on your device. */
(function () {
  window.VS = window.VS || {};
  function shot(el, w) {
    const h = Math.round(w * 9 / 16), c = document.createElement('canvas'); c.width = w; c.height = h; c.getContext('2d').drawImage(el, 0, 0, w, h);
    return new Promise((res) => c.toBlob(res, 'image/jpeg', 0.86));
  }
  function save(blob, name) { const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 4000); }
  async function capture() {
    const v = document.getElementById('video'), c = document.getElementById('canvas');
    if (!v || !c || !v.videoWidth) return { ok: false, msg: 'Start the camera first.' };
    // The output canvas is 16:9 only in 16:9 mode; keep the real shape instead of squashing it.
    const b = await shot(v, 960), a = await shot(c, 960);
    if (!b || !a) return { ok: false, msg: 'Could not make the pictures on this device.' };
    save(b, 'before.jpg'); setTimeout(() => save(a, 'after.jpg'), 400);
    return { ok: true, msg: 'Saved before.jpg and after.jpg. Put both in the assets/landing folder of the app and publish again. Only use pictures of yourself, or of people who agreed.' };
  }
  window.VS.BACapture = { capture, shot };
  document.addEventListener('DOMContentLoaded', () => { const b = document.getElementById('baBtn'), m = document.getElementById('baMsg'); if (b) b.addEventListener('click', async () => { const r = await capture(); if (m) m.textContent = r.msg; }); });
})();
