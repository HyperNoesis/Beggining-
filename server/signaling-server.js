// Genesis signaling server: WebSocket relay for WebRTC handshake messages
// (join / offer / answer / ICE). Media never touches this server — once
// peers connect, video/audio flow directly between browsers.
//
// Pure mesh, no SFU: capped at 6 peers/room since upload cost is O(n^2).
// Deploy: `npm install && npm start` on any Node 18+ host.

const { WebSocketServer } = require('ws');

const PORT = process.env.PORT || 8787;
const MAX_PEERS_PER_ROOM = 6;

const wss = new WebSocketServer({ port: PORT });

const rooms = new Map(); // roomCode -> Map<peerId, { ws, name }>

function roomOf(code) {
  if (!rooms.has(code)) rooms.set(code, new Map());
  return rooms.get(code);
}

function send(ws, msg) {
  if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg));
}

function broadcast(room, fromId, msg) {
  for (const [peerId, peer] of room) {
    if (peerId !== fromId) send(peer.ws, msg);
  }
}

let nextPeerId = 1;

wss.on('connection', (ws) => {
  let joinedRoom = null;
  let peerId = null;

  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }

    if (msg.type === 'join') {
      const room = roomOf(msg.room);
      if (room.size >= MAX_PEERS_PER_ROOM) {
        send(ws, { type: 'room-full', max: MAX_PEERS_PER_ROOM });
        return;
      }
      peerId = 'p' + (nextPeerId++);
      joinedRoom = msg.room;

      // New peer initiates offers to everyone already present.
      const existingPeers = [...room.entries()].map(([id, p]) => ({ id, name: p.name }));
      send(ws, { type: 'joined', peerId, existingPeers });
      broadcast(room, peerId, { type: 'peer-joined', peerId, name: msg.name });

      room.set(peerId, { ws, name: msg.name });
      return;
    }

    // Direct relay to one peer: offer/answer/ICE, forwarded as-is.
    if (!joinedRoom) return;
    const room = rooms.get(joinedRoom);
    if (!room) return;
    const target = room.get(msg.to);
    if (target) send(target.ws, { ...msg, from: peerId });
  });

  ws.on('close', () => {
    if (!joinedRoom) return;
    const room = rooms.get(joinedRoom);
    if (!room) return;
    room.delete(peerId);
    broadcast(room, peerId, { type: 'peer-left', peerId });
    if (room.size === 0) rooms.delete(joinedRoom);
  });
});

console.log(`Genesis signaling server listening on ws://localhost:${PORT}`);
console.log(`Rooms cap at ${MAX_PEERS_PER_ROOM} peers each (pure mesh — see file header for why).`);
