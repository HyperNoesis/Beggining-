// Phone remote, controller side (remote.html). Joins the studio's room and sends whitelisted button commands.
(function () {
  const $ = (id) => document.getElementById(id), st = $('st'), info = $('info');
  const room = new URLSearchParams(location.search).get('room'), PC = window.VS.PrompterCore;
  const btns = Array.from(document.querySelectorAll('button[data-cmd]'));
  const set = (t, c) => { st.textContent = t; st.className = c || ''; };
  const enable = (on) => btns.forEach((b) => { b.disabled = !on; });
  let ws = null, host = null, tries = 0;
  if (!PC.validRoom(room)) { set('This link is not valid. Create a new remote link in the studio (Prompter tab).', 'bad'); return; }
  const url = window.VS.config && window.VS.config.signalingUrl; if (!url) { set('No signalling server is set up, so the remote cannot connect.', 'bad'); return; }
  function connect() {
    set(tries ? 'Reconnecting…' : 'Connecting…'); enable(false); ws = new WebSocket(url);
    ws.onopen = () => ws.send(JSON.stringify({ type: 'join', room, name: 'remote' }));
    ws.onmessage = (e) => {
      let m; try { m = JSON.parse(e.data); } catch (x) { return; } if (!m || typeof m !== 'object') return;
      if (m.type === 'joined') { tries = 0; const p = (m.existingPeers || []).find((x) => x.name === 'studio'); if (p) { host = p.id; ready(); } else set('Waiting for the studio… open Genesis on the other device and tap Create remote link.'); }
      else if (m.type === 'peer-joined' && m.name === 'studio') { host = m.peerId; ready(); }
      else if (m.type === 'peer-left' && m.peerId === host) { host = null; enable(false); set('The studio went away. Waiting…', 'bad'); }
      else if (m.type === 'room-full') set('This room is full.', 'bad');
      else if (m.type === 'remote-state') { $('bToggle').textContent = m.playing ? 'Pause' : 'Start'; info.textContent = 'Speed ' + m.speed + (m.steps ? ' · Step ' + (m.step + 1) + ' of ' + m.steps : ''); }
    };
    ws.onclose = () => { enable(false); host = null; if (++tries <= 8) setTimeout(connect, Math.min(6000, 800 * tries)); else set('Could not connect. Reload this page.', 'bad'); };
  }
  function ready() { enable(true); set('Connected to the studio.', 'ok'); }
  btns.forEach((b) => b.addEventListener('click', () => { if (ws && ws.readyState === 1 && host) { ws.send(JSON.stringify({ type: 'remote', cmd: b.dataset.cmd, to: host })); if (navigator.vibrate) navigator.vibrate(15); } }));
  connect();
})();
