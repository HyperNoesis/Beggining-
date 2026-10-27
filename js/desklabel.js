/** Desk labelling tool (v0.15, M4 item 4). Records the true desk edge on real photos and measures desk auto-detect against it. All local. */
(function () {
  const SM = window.VS.SceneMeta, $ = (id) => document.getElementById(id);
  const cv = $('cv'), cx = cv.getContext('2d');
  let files = [], idx = 0, img = null, pts = [], labels = {}, det = null;
  const key = (f) => f.name + '|' + f.size;
  try { labels = JSON.parse(localStorage.getItem('vs_desk_labels') || '{}') || {}; } catch (e) { labels = {}; }
  const save = () => { try { localStorage.setItem('vs_desk_labels', JSON.stringify(labels)); } catch (e) {} };

  function lineFromPoints(p) {
    if (p.length === 1) return { y: +p[0].y.toFixed(4), tilt: 0, bow: 0 };
    const a = p[0], b = p[1]; if (Math.abs(b.x - a.x) < 0.05) return null;
    const tilt = (b.y - a.y) / (b.x - a.x); return { y: +(a.y - tilt * a.x).toFixed(4), tilt: +tilt.toFixed(4), bow: 0 };
  }
  function draw() {
    cx.clearRect(0, 0, cv.width, cv.height);
    if (!img) { cx.fillStyle = '#888'; cx.font = '20px system-ui'; cx.fillText('Choose photos to start', 30, 50); return; }
    cx.drawImage(img, 0, 0, cv.width, cv.height);
    const curve = (d, col, w) => { cx.strokeStyle = col; cx.lineWidth = w; cx.beginPath(); for (let i = 0; i <= 40; i++) { const x = i / 40, y = SM.deskCurve(d, x); cx[i ? 'lineTo' : 'moveTo'](x * cv.width, y * cv.height); } cx.stroke(); };
    if (det && det.confidence > 0) curve(det, 'cyan', 2);
    const L = lineFromPoints(pts); if (L) curve(L, 'yellow', 3);
    pts.forEach((p) => { cx.fillStyle = 'yellow'; cx.beginPath(); cx.arc(p.x * cv.width, p.y * cv.height, 7, 0, 7); cx.fill(); });
  }
  function load(i) {
    if (!files.length) return;
    idx = Math.max(0, Math.min(files.length - 1, i));
    const f = files[idx], u = URL.createObjectURL(f), im = new Image();
    im.onload = () => {
      img = im; const c = document.createElement('canvas'); c.width = 160; c.height = 90; const x = c.getContext('2d', { willReadFrequently: true });
      x.drawImage(im, 0, 0, 160, 90); det = SM.detectDeskLine(x.getImageData(0, 0, 160, 90).data, 160, 90);
      const L = labels[key(f)]; pts = [];
      URL.revokeObjectURL(u); info(); draw();
    };
    im.src = u;
  }
  function info() {
    const f = files[idx], L = labels[key(f)], done = files.filter((q) => labels[key(q)]).length;
    $('count').textContent = (idx + 1) + ' / ' + files.length + ' | labelled ' + done;
    let s = f.name + ' | auto-detect: y=' + det.y.toFixed(3) + ' tilt=' + det.tilt.toFixed(3) + ' confidence ' + Math.round(det.confidence * 100) + '%';
    if (L) s += ' | saved label: ' + (L.none ? 'no desk' : 'y=' + L.y + ' tilt=' + L.tilt + ' (auto error ' + (det.confidence >= 0.45 && !L.none ? (SM.deskError(det, L).mean * 100).toFixed(1) + '% of height' : 'n/a') + ')');
    $('info').textContent = s;
  }
  function commit() {
    if (!files.length) return false; const f = files[idx], L = lineFromPoints(pts); if (!L) return false;
    labels[key(f)] = { file: f.name, y: L.y, tilt: L.tilt, bow: 0, auto: { y: +det.y.toFixed(4), tilt: +det.tilt.toFixed(4), bow: +det.bow.toFixed(4), confidence: +det.confidence.toFixed(3) } }; save(); return true;
  }
  cv.addEventListener('pointerdown', (e) => {
    if (!img) return; const r = cv.getBoundingClientRect(); const p = { x: (e.clientX - r.left) / r.width, y: (e.clientY - r.top) / r.height };
    if (pts.length >= 2) pts = []; pts.push(p); if (pts.length === 2 && pts[0].x > pts[1].x) pts.reverse(); draw();
  });
  $('pick').onchange = (e) => { files = Array.from(e.target.files).filter((f) => /^image\//.test(f.type)); load(0); };
  $('next').onclick = () => { if (!pts.length) { $('info').textContent = 'Tap the desk edge first (left, then right).'; return; } if (!commit()) { $('info').textContent = 'Taps are too close together: tap far left and far right.'; return; } load(idx + 1); };
  $('prev').onclick = () => load(idx - 1);
  $('clear').onclick = () => { pts = []; draw(); };
  $('flat').onclick = () => { if (pts.length) { pts = [pts[0]]; draw(); } };
  $('nodesk').onclick = () => { if (!files.length) return; const f = files[idx]; labels[key(f)] = { file: f.name, none: true, auto: { y: +det.y.toFixed(4), tilt: +det.tilt.toFixed(4), bow: +det.bow.toFixed(4), confidence: +det.confidence.toFixed(3) } }; save(); load(idx + 1); };
  $('report').onclick = () => { const r = SM.summariseDeskLabels(Object.values(labels)); $('out').textContent = SM.formatDeskReport(r); };
  $('dl').onclick = () => { const b = new Blob([JSON.stringify({ schema: 1, labels: Object.values(labels) }, null, 1)], { type: 'application/json' }); const a = document.createElement('a'); a.href = URL.createObjectURL(b); a.download = 'labels.json'; a.click(); };
  $('ld').onchange = async (e) => { try { const j = JSON.parse(await e.target.files[0].text()); (j.labels || []).forEach((l) => { labels[l.file + '|?'] = l; }); $('out').textContent = 'Loaded ' + (j.labels || []).length + ' labels.'; } catch (err) { $('out').textContent = 'Could not read that file.'; } };
  draw();
})();
