// Second-phone camera page (cam.html). Sends this phone's camera to the studio over WebRTC; the studio owner must tap Accept.
(function () {
  const $ = (id) => document.getElementById(id), st = $('st'), vid = $('v'), bS = $('bStart'), bF = $('bFlip'), bX = $('bStop');
  const set = (t, c) => { st.textContent = t; st.className = c || ''; };
  const room = new URLSearchParams(location.search).get('room'), PC = window.VS.PrompterCore, MS = window.VS.MultiSourceCore;
  if (!PC.validRoom(room)) { set('This link is not valid. Create a new one in the studio (Content tab).', 'bad'); bS.disabled = true; return; }
  const url = window.VS.config && window.VS.config.signalingUrl; if (!url) { set('No signalling server is set up, so this camera cannot connect.', 'bad'); bS.disabled = true; return; }
  let ws = null, host = null, pc = null, stream = null, facing = 'user', tries = 0, wanted = false, accepted = false;
  const send = (o) => { if (ws && ws.readyState === 1 && host) ws.send(JSON.stringify(Object.assign({ to: host }, o))); };
  async function getCam() {
    if (stream) stream.getTracks().forEach((t) => t.stop());
    try { stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: facing, width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false }); }
    catch (e) { set(e && e.name === 'NotAllowedError' ? 'Camera permission was refused. Allow the camera for this page and try again.' : 'Could not open the camera. Is another app using it?', 'bad'); stream = null; return false; }
    vid.srcObject = stream; return true;
  }
  function closePc() { try { pc && pc.close(); } catch (e) {} pc = null; accepted = false; }
  async function offer() {
    if (!stream || !host || !wanted) return; closePc();
    pc = new RTCPeerConnection({ iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] });
    stream.getVideoTracks().forEach((t) => pc.addTrack(t, stream));
    pc.onicecandidate = (e) => { if (e.candidate) send({ type: 'rcam-ice', candidate: e.candidate.toJSON ? e.candidate.toJSON() : e.candidate }); };
    pc.onconnectionstatechange = () => { if (pc && accepted) set(MS.connNote(pc.connectionState), pc.connectionState === 'connected' ? 'ok' : pc.connectionState === 'failed' ? 'bad' : ''); };
    const o = await pc.createOffer(); await pc.setLocalDescription(o);
    send({ type: 'rcam-offer', sdp: o.sdp, label: /iPhone|iPad/.test(navigator.userAgent) ? 'iPhone camera' : 'Phone camera' });
    set('Waiting for the studio to accept…');
  }
  function connect() {
    let sock; try { sock = new WebSocket(url); } catch (e) { set('Could not open the signalling address.', 'bad'); return; }
    ws = sock; sock.onopen = () => sock.send(JSON.stringify({ type: 'join', room, name: 'cam' }));
    sock.onmessage = async (e) => {
      let m; try { m = JSON.parse(e.data); } catch (x) { return; } if (!m || typeof m !== 'object') return;
      if (m.type === 'joined') { tries = 0; const p = (m.existingPeers || []).find((x) => x.name === 'studio'); if (p) { host = p.id; offer(); } else set('Waiting for the studio… open Genesis on the other phone and tap Add a phone camera.'); return; }
      if (m.type === 'peer-joined' && m.name === 'studio') { host = m.peerId; offer(); return; }
      if (m.type === 'peer-left' && m.peerId === host) { host = null; closePc(); set('The studio went away. Waiting…', 'bad'); return; }
      if (m.type === 'room-full') { set('This room is full.', 'bad'); return; }
      if (m.from !== host) return; const c = MS.parseStudioMsg(m); if (!c) return;
      try {
        if (c.type === 'rcam-accept') { accepted = true; set('Sending to the studio.', 'ok'); }
        else if (c.type === 'rcam-decline') { set('The studio declined this camera.', 'bad'); closePc(); }
        else if (c.type === 'rcam-answer' && pc) await pc.setRemoteDescription({ type: 'answer', sdp: c.sdp });
        else if (c.type === 'rcam-ice' && pc) await pc.addIceCandidate(c.candidate);
      } catch (x) { set('Connection problem. Tap Stop, then Start again.', 'bad'); }
    };
    sock.onclose = () => { if (ws !== sock) return; host = null; if (wanted && ++tries <= 8) { set('Reconnecting…'); setTimeout(connect, MS.backoff(tries)); } else if (wanted) set('Could not reach the server. Reload this page.', 'bad'); };
  }
  bS.onclick = async () => { if (!(await getCam())) return; wanted = true; bS.disabled = true; bF.disabled = false; bX.disabled = false; set('Connecting…'); connect(); };
  bF.onclick = async () => { facing = facing === 'user' ? 'environment' : 'user'; if (!(await getCam())) return; if (pc) { const s = pc.getSenders().find((x) => x.track && x.track.kind === 'video'); if (s) await s.replaceTrack(stream.getVideoTracks()[0]); } };
  bX.onclick = () => { wanted = false; send({ type: 'rcam-bye' }); closePc(); try { ws && ws.close(); } catch (e) {} ws = null; if (stream) stream.getTracks().forEach((t) => t.stop()); stream = null; vid.srcObject = null; bS.disabled = false; bF.disabled = bX.disabled = true; set('Stopped.'); };
  set('Tap the button to start. Your camera stays on this phone until you do.');
  window.__cam = { get state() { return pc ? pc.connectionState : 'none'; } };
})();
