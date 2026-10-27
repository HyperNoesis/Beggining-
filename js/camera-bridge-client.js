// Sends Genesis's composited canvas output to server/camera-bridge.js over
// a local WebSocket, so it can be piped into a v4l2loopback device.
// Linux only — see docs/NATIVE_CAMERA_REALITY.md for why.
(function () {
  const btn = document.getElementById('cameraBridgeToggle');
  const status = document.getElementById('cameraBridgeStatus');
  if (!btn) return;

  let ws = null;
  let recorder = null;
  let active = false;

  function setStatus(text, isError) {
    status.textContent = text;
    status.style.display = text ? '' : 'none';
    status.classList.toggle('text-danger', !!isError);
  }

  btn.addEventListener('click', () => {
    if (active) return stop();
    start();
  });

  function start() {
    const canvas = document.getElementById('canvas'); // the same composited output used for recording/live
    if (!canvas) { setStatus('No active preview to send — start the camera first.', true); return; }

    ws = new WebSocket('ws://localhost:8790');
    ws.binaryType = 'arraybuffer';

    ws.addEventListener('open', () => {
      const stream = canvas.captureStream(30);
      recorder = new MediaRecorder(stream, { mimeType: 'video/webm;codecs=vp8', videoBitsPerSecond: 4_000_000 });
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0 && ws.readyState === WebSocket.OPEN) e.data.arrayBuffer().then((buf) => ws.send(buf));
      };
      recorder.start(100); // 100ms chunks — small enough to keep latency low over the local pipe
      active = true;
      btn.textContent = 'Stop sending to virtual camera';
      setStatus('Sending to /dev/video10 — select "Genesis" as your camera in Zoom/Meet.');
    });

    ws.addEventListener('error', () => {
      setStatus('Could not reach the bridge. Is server/camera-bridge.js running (npm start in server/)?', true);
      stop();
    });
    ws.addEventListener('close', () => { if (active) stop(); });
  }

  function stop() {
    recorder?.stop();
    ws?.close();
    recorder = null;
    ws = null;
    active = false;
    btn.textContent = 'Start sending to virtual camera';
  }
})();
