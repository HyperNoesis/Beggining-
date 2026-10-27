(function () {
  const ICE_SERVERS = [{ urls: 'stun:stun.l.google.com:19302' }];
  // STUN only, no TURN — fails for peers behind strict/symmetric NAT.

  const els = {
    notConfigured: document.getElementById('callNotConfigured'),
    joinScreen: document.getElementById('callJoinScreen'),
    room: document.getElementById('callRoom'),
    nameInput: document.getElementById('callNameInput'),
    roomInput: document.getElementById('callRoomInput'),
    joinBtn: document.getElementById('callJoinBtn'),
    joinError: document.getElementById('callJoinError'),
    roomLabel: document.getElementById('callRoomLabel'),
    copyLinkBtn: document.getElementById('callCopyLinkBtn'),
    status: document.getElementById('callStatus'),
    gallery: document.getElementById('callGallery'),
    micBtn: document.getElementById('callMicBtn'),
    camBtn: document.getElementById('callCamBtn'),
    endBtn: document.getElementById('callEndBtn'),
  };

  const ic = window.VS.icon;

  let ws = null;
  let myId = null;
  let myName = '';
  let localStream = null;
  const peers = new Map(); // peerId -> { pc, name, tile }
  let audioCtx = null;
  const analysers = new Map(); // tileEl -> { analyser, data }
  let micOn = true, camOn = true;

  async function init() {
    try {
      const user = await window.VS.auth.requireAuth();
      if (!user) return; // requireAuth already redirects to auth.html in this case

      if (!window.VS.config.signalingUrl) return; // callNotConfigured is already the visible default in the HTML
      els.notConfigured.classList.add('hidden');
      els.joinScreen.classList.remove('hidden');
      els.nameInput.value = user.name || '';

      const roomFromLink = new URLSearchParams(location.search).get('room');
      if (roomFromLink) els.roomInput.value = roomFromLink;
    } catch (err) {
      // Real failure — replace the default message with the actual error.
      console.error('Genesis call.html failed to initialize:', err);
      els.notConfigured.innerHTML = `
        <div class="info-card" style="max-width:560px;">
          <h3>Something went wrong loading this page</h3>
          <p class="honesty-note text-danger" style="margin-top:0;">${(err && err.message) || String(err)}</p>
          <p class="honesty-note">Try reloading in a private/incognito tab first — if that fixes it, an old cached version of this app was the cause. If it still fails there, open the browser console for the full error.</p>
        </div>`;
    }
  }

  els.joinBtn?.addEventListener('click', async () => {
    const name = els.nameInput.value.trim();
    const room = els.roomInput.value.trim();
    els.joinError.textContent = '';
    if (!name || !room) {
      els.joinError.textContent = 'Enter your name and a room code.';
      return;
    }
    els.joinBtn.disabled = true;
    try {
      localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
    } catch (err) {
      els.joinError.textContent = 'Could not access camera/microphone: ' + err.message;
      els.joinBtn.disabled = false;
      return;
    }
    myName = name;
    connectSignaling(room, name);
  });

  function connectSignaling(room, name) {
    ws = new WebSocket(window.VS.config.signalingUrl);
    ws.addEventListener('open', () => {
      ws.send(JSON.stringify({ type: 'join', room, name }));
    });
    ws.addEventListener('message', (e) => handleSignal(JSON.parse(e.data)));
    ws.addEventListener('close', () => {
      if (!els.room.classList.contains('hidden')) els.status.textContent = 'Disconnected';
    });
    ws.addEventListener('error', () => {
      els.joinError.textContent = 'Could not reach the signaling server. Check signalingUrl in js/config.js and that the server is running.';
      els.joinBtn.disabled = false;
    });
  }

  async function handleSignal(msg) {
    switch (msg.type) {
      case 'room-full':
        els.joinError.textContent = `This room already has the max of ${msg.max} people.`;
        els.joinBtn.disabled = false;
        localStream.getTracks().forEach((t) => t.stop());
        ws.close();
        return;

      case 'joined': {
        myId = msg.peerId;
        enterRoom();
        // New arrival — offer to everyone already here.
        for (const p of msg.existingPeers) await connectToPeer(p.id, p.name, true);
        return;
      }

      case 'peer-joined':
        // They'll send the offer; just track the name for now.
        peers.set(msg.peerId, { pc: null, name: msg.name, tile: null });
        return;

      case 'offer': {
        const pc = await connectToPeer(msg.from, peers.get(msg.from)?.name || 'Guest', false);
        await pc.setRemoteDescription({ type: 'offer', sdp: msg.sdp });
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        ws.send(JSON.stringify({ type: 'answer', to: msg.from, sdp: answer.sdp }));
        return;
      }

      case 'answer': {
        const peer = peers.get(msg.from);
        if (peer?.pc) await peer.pc.setRemoteDescription({ type: 'answer', sdp: msg.sdp });
        return;
      }

      case 'ice': {
        const peer = peers.get(msg.from);
        if (peer?.pc && msg.candidate) {
          try { await peer.pc.addIceCandidate(msg.candidate); } catch { /* benign if connection already closed */ }
        }
        return;
      }

      case 'peer-left':
        removePeer(msg.peerId);
        return;
    }
  }

  function enterRoom() {
    els.joinScreen.classList.add('hidden');
    els.room.classList.remove('hidden');
    els.roomLabel.textContent = els.roomInput.value.trim();
    els.status.textContent = 'Connected';
    addTile('local', myName + ' (you)', localStream, true);
  }

  async function connectToPeer(peerId, name, initiator) {
    let peer = peers.get(peerId);
    if (peer?.pc) return peer.pc;

    const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
    peer = { pc, name, tile: null };
    peers.set(peerId, peer);

    localStream.getTracks().forEach((track) => pc.addTrack(track, localStream));

    pc.onicecandidate = (e) => {
      if (e.candidate) ws.send(JSON.stringify({ type: 'ice', to: peerId, candidate: e.candidate }));
    };
    pc.ontrack = (e) => {
      if (!peer.tile) peer.tile = addTile(peerId, peer.name, e.streams[0], false);
    };
    pc.onconnectionstatechange = () => {
      if (peer.tile) {
        const badge = peer.tile.querySelector('.call-tile-state');
        if (badge) badge.textContent = pc.connectionState === 'connected' ? '' : pc.connectionState;
      }
    };

    if (initiator) {
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      ws.send(JSON.stringify({ type: 'offer', to: peerId, sdp: offer.sdp }));
    }
    return pc;
  }

  function removePeer(peerId) {
    const peer = peers.get(peerId);
    if (!peer) return;
    peer.pc?.close();
    if (peer.tile) {
      analysers.delete(peer.tile);
      peer.tile.remove();
    }
    peers.delete(peerId);
  }

  function addTile(id, name, stream, isLocal) {
    const tile = document.createElement('div');
    tile.className = 'call-tile';
    tile.dataset.peerId = id;
    tile.innerHTML = `
      <video autoplay playsinline ${isLocal ? 'muted' : ''}></video>
      <div class="call-tile-label"><span>${name}</span><span class="call-tile-state"></span></div>
      <div class="call-tile-talking">${ic('mic', 12)} Talking</div>
    `;
    els.gallery.appendChild(tile);
    tile.querySelector('video').srcObject = stream;
    setupTalkingDetector(tile, stream);
    return tile;
  }

  // Real RMS voice-activity detection per tile — same approach as the
  // ducking detector in js/audio-studio.js.
  function setupTalkingDetector(tile, stream) {
    if (!stream.getAudioTracks().length) return;
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    const source = audioCtx.createMediaStreamSource(stream);
    const analyser = audioCtx.createAnalyser();
    analyser.fftSize = 512;
    source.connect(analyser);
    analysers.set(tile, { analyser, data: new Uint8Array(analyser.fftSize), active: false });
  }

  function talkingLoop() {
    requestAnimationFrame(talkingLoop);
    const onThresh = 0.025, offThresh = 0.012; // same hysteresis band as audio-studio.js
    for (const [tile, state] of analysers) {
      state.analyser.getByteTimeDomainData(state.data);
      let sum = 0;
      for (let i = 0; i < state.data.length; i++) { const v = (state.data[i] - 128) / 128; sum += v * v; }
      const rms = Math.sqrt(sum / state.data.length);
      if (!state.active && rms > onThresh) state.active = true;
      else if (state.active && rms < offThresh) state.active = false;
      tile.classList.toggle('talking', state.active);
    }
  }
  requestAnimationFrame(talkingLoop);

  els.micBtn?.addEventListener('click', () => {
    micOn = !micOn;
    localStream?.getAudioTracks().forEach((t) => (t.enabled = micOn));
    els.micBtn.classList.toggle('off', !micOn);
    els.micBtn.setAttribute('aria-pressed', String(!micOn));
    els.micBtn.innerHTML = ic(micOn ? 'mic' : 'x', 18);
  });

  els.camBtn?.addEventListener('click', () => {
    camOn = !camOn;
    localStream?.getVideoTracks().forEach((t) => (t.enabled = camOn));
    els.camBtn.classList.toggle('off', !camOn);
    els.camBtn.setAttribute('aria-pressed', String(!camOn));
    els.camBtn.innerHTML = ic(camOn ? 'video' : 'x', 18);
  });

  els.endBtn?.addEventListener('click', () => {
    for (const id of [...peers.keys()]) removePeer(id);
    localStream?.getTracks().forEach((t) => t.stop());
    ws?.close();
    window.location.href = 'home.html';
  });

  els.copyLinkBtn?.addEventListener('click', async () => {
    const room = els.roomInput.value.trim();
    const link = `${location.origin}${location.pathname}?room=${encodeURIComponent(room)}`;
    try {
      await navigator.clipboard.writeText(link);
      const original = els.copyLinkBtn.textContent;
      els.copyLinkBtn.textContent = 'Copied';
      setTimeout(() => { els.copyLinkBtn.textContent = original; }, 1500);
    } catch {
      window.prompt('Copy this invite link:', link);
    }
  });

  // Initial icons, set once icons.js is loaded.
  if (els.micBtn) els.micBtn.innerHTML = ic('mic', 18);
  if (els.camBtn) els.camBtn.innerHTML = ic('video', 18);
  if (els.endBtn) els.endBtn.innerHTML = ic('phone-off', 20);

  init();
})();
