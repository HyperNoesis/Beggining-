/** Multi-source (pure): second-phone camera pairing messages, limits, layouts. Studio = receives; cam.html = sends. Only tiny JSON goes through the signalling relay; video flows phone to phone (WebRTC). */
(function () {
  window.VS = window.VS || {};
  const MAX_SDP = 24000, MAX_CAND = 800;
  const LAYOUTS = [
    { id: 'default', label: 'Picture in picture', note: 'Second camera as a small box in a corner.' },
    { id: 'sidebyside', label: 'Side by side', note: 'You and the second camera next to each other.' },
    { id: 'bubble', label: 'Camera big, me in a bubble', note: 'The second camera fills the screen, you are a small bubble.' },
    { id: 'cutout', label: 'Me over the camera', note: 'The second camera is the background behind you.' },
  ];
  const isStr = (s, max) => typeof s === 'string' && s.length > 0 && s.length <= max;
  const cand = (c) => c && typeof c === 'object' && isStr(c.candidate, MAX_CAND) ? { candidate: c.candidate, sdpMid: typeof c.sdpMid === 'string' ? c.sdpMid.slice(0, 40) : null, sdpMLineIndex: Number.isInteger(c.sdpMLineIndex) ? c.sdpMLineIndex : 0 } : null;
  /** Message the STUDIO accepts from a camera phone. Returns a clean object or null. */
  function parseCamMsg(m) {
    if (!m || typeof m !== 'object') return null;
    if (m.type === 'rcam-offer') return isStr(m.sdp, MAX_SDP) && m.sdp.indexOf('v=0') === 0 ? { type: 'rcam-offer', sdp: m.sdp, label: isStr(m.label, 40) ? m.label.replace(/[<>&"]/g, '') : 'Phone camera' } : null;
    if (m.type === 'rcam-ice') { const c = cand(m.candidate); return c ? { type: 'rcam-ice', candidate: c } : null; }
    if (m.type === 'rcam-bye') return { type: 'rcam-bye' };
    return null;
  }
  /** Message the CAMERA PHONE accepts from the studio. */
  function parseStudioMsg(m) {
    if (!m || typeof m !== 'object') return null;
    if (m.type === 'rcam-answer') return isStr(m.sdp, MAX_SDP) && m.sdp.indexOf('v=0') === 0 ? { type: 'rcam-answer', sdp: m.sdp } : null;
    if (m.type === 'rcam-ice') { const c = cand(m.candidate); return c ? { type: 'rcam-ice', candidate: c } : null; }
    if (m.type === 'rcam-accept' || m.type === 'rcam-decline') return { type: m.type };
    return null;
  }
  const camUrl = (base, room) => String(base).replace(/[#?].*$/, '').replace(/[^/]*$/, '') + 'cam.html?room=' + encodeURIComponent(room);
  const backoff = (n) => Math.min(8000, 1000 * Math.max(1, n));
  /** Plain-language reason for a WebRTC state. */
  function connNote(state) { return ({ new: 'Connecting…', checking: 'Connecting…', connected: 'Connected.', completed: 'Connected.', disconnected: 'Connection dropped. Trying to get it back…', failed: 'Could not connect the two phones. Put both on the same Wi-Fi and try again.', closed: 'Closed.' })[state] || 'Connecting…'; }
  window.VS.MultiSourceCore = { LAYOUTS, parseCamMsg, parseStudioMsg, camUrl, backoff, connNote, MAX_SDP };
})();
