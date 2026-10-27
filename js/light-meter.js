// v0.46 light meter + exposure assist. Phone cameras in dim rooms lengthen exposure and drop to ~10 fps, so
// "bright" and "steady FPS" are the same problem. Every 1.5 s: measure mean luma of the face-area, then
// (a) report dim/ok/bright, (b) where the camera allows it (Android Chrome: exposureCompensation, exposureMode)
// nudge exposure up/down. Never throws; every step is optional.
(function () {
  const VS = (window.VS = window.VS || {});
  let timer = null, cv = null, ctx = null, comp = 0, state = { level: 'unknown', luma: null, comp: 0, applied: false };
  function measure(video) {
    const w = 32, h = 24;
    if (!cv) { cv = document.createElement('canvas'); cv.width = w; cv.height = h; ctx = cv.getContext('2d', { willReadFrequently: true }); }
    // centre 60% of the frame = where the person normally is
    const vw = video.videoWidth, vh = video.videoHeight; if (!vw || !vh) return null;
    ctx.drawImage(video, vw * 0.2, vh * 0.15, vw * 0.6, vh * 0.7, 0, 0, w, h);
    const d = ctx.getImageData(0, 0, w, h).data; let s = 0;
    for (let i = 0; i < d.length; i += 4) s += 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];
    return s / (d.length / 4);
  }
  async function nudge(track, luma) {
    const CC = VS.CameraControl; if (CC && (CC.testing() || CC.holdsManual())) return false;   // v0.49: do not fight the camera-control test or its manual exposure
    const caps = track.getCapabilities ? track.getCapabilities() : {};
    const ec = caps.exposureCompensation; if (!ec) return false;
    const target = luma < 85 ? Math.min(ec.max, comp + (ec.step || 0.5) * 2) : luma > 175 ? Math.max(ec.min, comp - (ec.step || 0.5)) : comp;
    if (target === comp) return false;
    try { await track.applyConstraints({ advanced: [{ exposureCompensation: target }] }); comp = target; return true; } catch (e) { return false; }
  }
  VS.LightMeter = {
    state: () => state,
    note: () => (state.level === 'dim' ? 'Light: dim (face a window or lamp)' : state.level === 'bright' ? 'Light: very bright' : state.level === 'ok' ? 'Light: ok' : ''),
    start(video, track) {
      this.stop(); comp = 0;
      try { // keep auto exposure/white balance on and do not let the camera trade frame rate for brightness silently
        const caps = track && track.getCapabilities ? track.getCapabilities() : {};
        const adv = {}; if (caps.exposureMode && caps.exposureMode.includes('continuous')) adv.exposureMode = 'continuous';
        if (caps.whiteBalanceMode && caps.whiteBalanceMode.includes('continuous')) adv.whiteBalanceMode = 'continuous';
        if (Object.keys(adv).length) track.applyConstraints({ advanced: [adv] }).catch(() => {});
      } catch (e) {}
      timer = setInterval(async () => {
        try {
          if (!video || video.paused || video.readyState < 2) return;
          const l = measure(video); if (l == null) return;
          try { VS.CameraControl && VS.CameraControl.feedLuma(l); } catch (e) {}
          const level = l < 85 ? 'dim' : l > 175 ? 'bright' : 'ok';
          const applied = track ? await nudge(track, l) : false;
          state = { level, luma: Math.round(l), comp, applied: state.applied || applied };
        } catch (e) {}
      }, 1500);
    },
    stop() { if (timer) clearInterval(timer); timer = null; state = { level: 'unknown', luma: null, comp: 0, applied: false }; },
  };
})();
