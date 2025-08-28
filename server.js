// server.js
// Run this on a VPS / public URL
const WebSocket = require('ws');

const wss = new WebSocket.Server({ port: 8080 });
const peers = new Map(); // peerId -> ws

wss.on('connection', ws => {
  let id = null;

  ws.on('message', msg => {
    const data = JSON.parse(msg.toString());

    if (data.type === 'register') {
      id = data.id;
      peers.set(id, ws);
      console.log(`Registered peer: ${id}`);
    }

    if (data.type === 'signal') {
      const target = peers.get(data.target);
      if (target && target.readyState === WebSocket.OPEN) {
        target.send(JSON.stringify({ from: id, signal: data.signal }));
      }
    }
  });

  ws.on('close', () => {
    if (id) peers.delete(id);
  });
});

console.log('Bootstrap signaling server running on port 8080');
