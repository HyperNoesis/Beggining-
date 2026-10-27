/** Multi-source, studio side: a second phone becomes a live camera overlay. Owner taps Accept for each phone. Uses the signalling relay for the handshake only. */
(function () {
  window.VS = window.VS || {};
  function init() {
    const $ = (id) => document.getElementById(id), btn = $('camStart'); if (!btn) return;
    const status = $('camStatus'), qrC = $('camQr'), linkEl = $('camLink'), pend = $('camPending'), pendT = $('camPendingText'), lay = $('camLayouts');
    const PC = window.VS.PrompterCore, MS = window.VS.MultiSourceCore;
    let ws = null, room = null, tries = 0, closing = false, retryT = 0; const peers = new Map(); // peerId -> {pc, src, label, accepted, queue, ice}
    const say = (t) => { status.textContent = t; };
    const send = (to, o) => { if (ws && ws.readyState === 1) ws.send(JSON.stringify(Object.assign({ to }, o))); };
    lay.innerHTML = MS.LAYOUTS.map((l) => '<button type="button" class="btn ghost sm" style="min-height:44px;" data-l="' + l.id + '" title="' + l.note + '">' + l.label + '</button>').join('');
    lay.addEventListener('click', (e) => { const b = e.target.closest('[data-l]'); if (b && window.VS.sourceApi) window.VS.sourceApi.setLayout(b.dataset.l); });
    function dropPeer(id) { const p = peers.get(id); if (!p) return; try { p.pc && p.pc.close(); } catch (e) {} if (p.src) p.src.remove(); peers.delete(id); showPending(); refresh(); }
    function refresh() { const n = [...peers.values()].filter((p) => p.accepted).length; if (!room) return; say(n ? n + ' phone camera' + (n > 1 ? 's' : '') + ' connected.' : 'Waiting for a phone. Scan the code or open the link on it.'); }
    function showPending() { const w = [...peers.entries()].find(([, p]) => !p.accepted && p.offer); if (!w) { pend.style.display = 'none'; return; } pendT.textContent = '“' + w[1].label + '” wants to join as a camera.'; pend.style.display = 'flex'; pend.dataset.peer = w[0]; }
    async function accept(id) {
      const p = peers.get(id); if (!p || !p.offer) return; const api = window.VS.sourceApi;
      if (!api || api.count >= api.max) { say('You already have the maximum number of overlays. Remove one in the list below first.'); send(id, { type: 'rcam-decline' }); dropPeer(id); return; }
      const pc = new RTCPeerConnection({ iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] }); p.pc = pc;
      pc.onicecandidate = (e) => { if (e.candidate) send(id, { type: 'rcam-ice', candidate: e.candidate.toJSON ? e.candidate.toJSON() : e.candidate }); };
      pc.onconnectionstatechange = () => { const s = pc.connectionState; if (s === 'failed') say(MS.connNote(s)); if (s === 'failed' || s === 'closed') dropPeer(id); else if (s === 'disconnected') say(MS.connNote(s)); else if (s === 'connected') refresh(); };
      pc.ontrack = async (e) => { if (p.src || !e.streams[0]) return; p.accepted = true; p.src = await api.addLive(e.streams[0], p.label, () => { send(id, { type: 'rcam-bye' }); dropPeer(id); }); if (!p.src) { dropPeer(id); return; } refresh(); };
      try {
        await pc.setRemoteDescription({ type: 'offer', sdp: p.offer }); for (const c of p.ice) { try { await pc.addIceCandidate(c); } catch (e) {} } p.ice = [];
        const a = await pc.createAnswer(); await pc.setLocalDescription(a); p.accepted = true; send(id, { type: 'rcam-accept' }); send(id, { type: 'rcam-answer', sdp: a.sdp }); say('Connecting to “' + p.label + '”…'); showPending();
      } catch (e) { say('Could not set up that camera. Ask the phone to Stop and Start again.'); dropPeer(id); }
    }
    function onMsg(m) {
      if (m.type === 'joined') { tries = 0; say('Waiting for a phone. Scan the code or open the link on it.'); return; }
      if (m.type === 'peer-left') { dropPeer(m.peerId); return; }
      if (m.type === 'room-full') { say('That room is full.'); return; }
      if (!m.from || m.type === 'peer-joined') return;
      const c = MS.parseCamMsg(m); if (!c) return; let p = peers.get(m.from);
      if (c.type === 'rcam-offer') { if (p) dropPeer(m.from); if (peers.size >= 3) return; peers.set(m.from, { pc: null, src: null, label: c.label, accepted: false, offer: c.sdp, ice: [] }); showPending(); return; }
      if (!p) return;
      if (c.type === 'rcam-bye') { dropPeer(m.from); return; }
      if (c.type === 'rcam-ice') { if (p.pc && p.pc.remoteDescription) p.pc.addIceCandidate(c.candidate).catch(() => {}); else if (p.ice.length < 40) p.ice.push(c.candidate); }
    }
    function connect() {
      const url = window.VS.config && window.VS.config.signalingUrl;
      if (!url) { say('No signalling server is set in js/config.js, so phone cameras are off. Everything else works.'); return; }
      let sock; try { sock = new WebSocket(url); } catch (e) { say('Could not open the signalling server address.'); return; }
      ws = sock; say('Connecting…');
      sock.addEventListener('open', () => sock.send(JSON.stringify({ type: 'join', room, name: 'studio' })));
      sock.addEventListener('message', (e) => { let m; try { m = JSON.parse(e.data); } catch (x) { return; } if (m && typeof m === 'object') onMsg(m); });
      sock.addEventListener('close', () => { if (closing || ws !== sock) return; if (++tries > 6) { say('Lost the connection to the signalling server. Tap Add a phone camera to try again.'); btn.textContent = 'Add a phone camera'; room = null; return; } say('Reconnecting… (' + tries + ')'); retryT = setTimeout(connect, MS.backoff(tries)); });
      sock.addEventListener('error', () => { if (tries === 0 && !peers.size) say('Could not reach the signalling server. Check js/config.js and your internet.'); });
    }
    function stop() { closing = true; clearTimeout(retryT); [...peers.keys()].forEach(dropPeer); try { ws && ws.close(); } catch (e) {} ws = null; room = null; qrC.style.display = 'none'; linkEl.style.display = 'none'; pend.style.display = 'none'; btn.textContent = 'Add a phone camera'; say('Phone cameras are off.'); }
    function drawQr(text) {
      const q = window.VS.QR && window.VS.QR.encode(text, 'M'); if (!q) { qrC.style.display = 'none'; return; }
      const ctx = qrC.getContext('2d'), cell = Math.floor(qrC.width / (q.size + 8)); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, qrC.width, qrC.height); ctx.fillStyle = '#000';
      const off = Math.floor((qrC.width - q.size * cell) / 2); for (let r = 0; r < q.size; r++) for (let c = 0; c < q.size; c++) if (q.get(c, r)) ctx.fillRect(off + c * cell, off + r * cell, cell, cell);
      qrC.style.display = 'block';
    }
    btn.addEventListener('click', () => {
      if (room) { stop(); return; }
      closing = false; tries = 0; const rnd = new Uint8Array(8); (window.crypto || {}).getRandomValues ? crypto.getRandomValues(rnd) : rnd.forEach((_, i) => { rnd[i] = Math.floor(Math.random() * 256); });
      room = PC.makeRoomCode(rnd); const link = MS.camUrl(location.href, room);
      linkEl.value = link; linkEl.style.display = 'block'; drawQr(link); btn.textContent = 'Turn phone cameras off'; connect();
    });
    $('camAccept').addEventListener('click', () => { const id = pend.dataset.peer; if (id) accept(id); });
    $('camDecline').addEventListener('click', () => { const id = pend.dataset.peer; if (id) { send(id, { type: 'rcam-decline' }); dropPeer(id); } });
    window.VS.MultiSource = { get room() { return room; }, get peers() { return peers.size; }, stop };
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
