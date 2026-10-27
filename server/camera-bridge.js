// Genesis camera bridge (Linux only): pipes browser WebM chunks into ffmpeg,
// which writes decoded frames to a v4l2loopback device so Zoom/Meet/Teams
// can select it as a webcam. Setup: docs/NATIVE_CAMERA_REALITY.md.

const { WebSocketServer } = require('ws');
const { spawn } = require('child_process');

const PORT = process.env.BRIDGE_PORT || 8790;
const DEVICE = process.env.V4L2_DEVICE || '/dev/video10';

const wss = new WebSocketServer({ port: PORT });
console.log(`Genesis camera bridge listening on ws://localhost:${PORT}`);
console.log(`Writing decoded frames to ${DEVICE} (override with V4L2_DEVICE=...)`);

wss.on('connection', (ws) => {
  console.log('Browser tab connected — starting ffmpeg pipe to', DEVICE);

  // -re deliberately absent — consume chunks as fast as they arrive.
  const ff = spawn('ffmpeg', [
    '-loglevel', 'warning',
    '-f', 'webm', '-i', 'pipe:0',
    '-pix_fmt', 'yuyv422',
    '-f', 'v4l2', DEVICE,
  ]);

  ff.stderr.on('data', (d) => process.stderr.write('[ffmpeg] ' + d));
  ff.on('exit', (code) => console.log('ffmpeg exited with code', code));
  ff.on('error', (err) => console.error('Could not start ffmpeg:', err.message));

  ws.on('message', (chunk) => {
    if (ff.stdin.writable) ff.stdin.write(chunk);
  });

  ws.on('close', () => {
    console.log('Browser tab disconnected — stopping ffmpeg');
    ff.stdin.end();
    ff.kill();
  });
});
