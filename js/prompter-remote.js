/**
 * Phone remote, studio side. Opens a private room on the signalling server (js/config.js signalingUrl) and obeys a
 * short WHITELIST of commands from a second phone (remote.html): prompter controls and Show NEXT/Back.
 * Only tiny JSON commands travel through the server; never video, audio or the script. The random room code is the secret.
 * If the server is not reachable the panel says so and nothing else is affected.
 */
(function () {
  window.VS = window.VS || {};
  function init() {
    const $ = (id) => document.getElementById(id), btn = $('remoteStart'); if (!btn) return;
    const status = $('remoteStatus'), qrC = $('remoteQr'), linkEl = $('remoteLink');
    let ws = null, room = null, myId = null, tries = 0, closing = false, retryT = 0; const peers = new Set(); let stamps = [];
    const say = (t) => { status.textContent = t; };
    const PC = () => window.VS.PrompterCore;
    function snapshot() {
      const p = window.VS.prompter, S = window.VS.Show;
      return { type: 'remote-state', playing: !!(p && p.playing), speed: p ? p.state.speed : 0, size: p ? p.state.size : 0, mode: p ? p.mode : '', step: S ? S.cur : -1, steps: S ? S.cues.length : 0 };
    }
    function broadcast() { if (!ws || ws.readyState !== 1) return; const s = snapshot(); peers.forEach((id) => ws.send(JSON.stringify(Object.assign({ to: id }, s)))); }
    function apply(cmd) {
      const p = window.VS.prompter, S = window.VS.Show;
      if (cmd === 'step-next') return !!(S && S.next()); if (cmd === 'step-back') return !!(S && S.back());
      return !!(p && p.command(cmd));
    }
    function onMsg(m) {
      if (m.type === 'joined') { myId = m.peerId; tries = 0; say('Waiting for your phone. Open the link or scan the code on it.'); return; }
      if (m.type === 'peer-joined') { peers.add(m.peerId); say('Remote phone connected.'); const s = snapshot(); ws.send(JSON.stringify(Object.assign({ to: m.peerId }, s))); return; }
      if (m.type === 'peer-left') { peers.delete(m.peerId); say(peers.size ? 'Remote phone connected.' : 'Remote phone disconnected. Waiting for it to reconnect.'); return; }
      if (m.type === 'room-full') { say('That room is full.'); return; }
      const cmd = PC().parseRemoteCmd(m); if (!cmd || !m.from) return;
      const now = Date.now(); stamps = stamps.filter((t) => now - t < 1000); if (stamps.length >= 12) return; stamps.push(now); // at most 12 commands per second
      peers.add(m.from); apply(cmd); broadcast();
    }
    function connect() {
      const url = window.VS.config && window.VS.config.signalingUrl;
      if (!url) { say('No signalling server is set in js/config.js, so the phone remote is off. Everything else works.'); return; }
      let sock; try { sock = new WebSocket(url); } catch (e) { say('Could not open the signalling server address.'); return; }
      ws = sock; say('Connecting…');
      sock.addEventListener('open', () => sock.send(JSON.stringify({ type: 'join', room, name: 'studio' })));
      sock.addEventListener('message', (e) => { let m; try { m = JSON.parse(e.data); } catch (x) { return; } if (m && typeof m === 'object') onMsg(m); });
      sock.addEventListener('close', () => { if (closing || ws !== sock) return; peers.clear(); if (++tries > 6) { say('Lost the connection to the signalling server. Tap Create remote link to try again.'); btn.textContent = 'Create remote link'; room = null; return; } say('Reconnecting… (' + tries + ')'); retryT = setTimeout(connect, Math.min(8000, 1000 * tries)); });
      sock.addEventListener('error', () => { if (!peers.size && tries === 0) say('Could not reach the signalling server. Check js/config.js and your internet.'); });
    }
    function stop() { closing = true; clearTimeout(retryT); try { ws && ws.close(); } catch (e) {} ws = null; room = null; peers.clear(); qrC.style.display = 'none'; linkEl.style.display = 'none'; btn.textContent = 'Create remote link'; say('Remote is off.'); }
    function drawQr(text) {
      const q = window.VS.QR && window.VS.QR.encode(text, 'M'); if (!q) { qrC.style.display = 'none'; return; }
      const ctx = qrC.getContext('2d'), cell = Math.floor(qrC.width / (q.size + 8)); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, qrC.width, qrC.height); ctx.fillStyle = '#000';
      const off = Math.floor((qrC.width - q.size * cell) / 2); for (let r = 0; r < q.size; r++) for (let c = 0; c < q.size; c++) if (q.get(c, r)) ctx.fillRect(off + c * cell, off + r * cell, cell, cell);
      qrC.style.display = 'block';
    }
    btn.addEventListener('click', () => {
      if (room) { stop(); return; }
      closing = false; tries = 0; const rnd = new Uint8Array(8); (window.crypto || {}).getRandomValues ? crypto.getRandomValues(rnd) : rnd.forEach((_, i) => { rnd[i] = Math.floor(Math.random() * 256); });
      room = PC().makeRoomCode(rnd); const link = PC().remoteUrl(location.href, room);
      linkEl.value = link; linkEl.style.display = 'block'; drawQr(link); btn.textContent = 'Turn remote off'; connect();
    });
    setInterval(() => { if (peers.size) broadcast(); }, 1500);
    window.VS.PrompterRemote = { get room() { return room; }, get peers() { return peers.size; }, stop };
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
