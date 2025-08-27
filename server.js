// bootstrap.js
// Usage: node bootstrap.js [httpPort] [relayPort]
// Example: node bootstrap.js 3000 4000

const express = require('express');
const bodyParser = require('body-parser');
const net = require('net');

const HTTP_PORT = parseInt(process.argv[2] || '3000', 10);
const RELAY_PORT = parseInt(process.argv[3] || '4000', 10);

const app = express();
app.use(bodyParser.json());

/*
Peers: { id -> { id, name, host, port, pubKey (base64), lastSeen } }
*/
const peers = new Map();

// Register or update: body { id, name, host, port, pubKey }
app.post('/register', (req, res) => {
  const p = req.body;
  if (!p || !p.id || !p.host || !p.port) return res.status(400).send('bad');
  p.lastSeen = Date.now();
  peers.set(p.id, p);
  console.log(`[register] ${p.id} ${p.name||''} ${p.host}:${p.port}`);
  res.json({ ok: true });
});

// Get peers (excluding requester) -> returns array of peers
// Query param ?id=yourId
app.get('/peers', (req, res) => {
  const myId = req.query.id;
  const out = [];
  for (const [id, p] of peers.entries()) {
    if (id === myId) continue;
    // prune stale (5 minutes)
    if (Date.now() - p.lastSeen > 1000*60*5) { peers.delete(id); continue; }
    out.push({ id: p.id, name: p.name, host: p.host, port: p.port, pubKey: p.pubKey });
  }
  res.json({ peers: out });
});

// Notify: request that bootstrap logs a notify so other side sees flag next poll
// body { fromId, toId } -> store ephemeral 'notify' which will be included in /peers response
const notifies = new Set();
app.post('/notify', (req, res) => {
  const { fromId, toId } = req.body;
  if (!fromId || !toId) return res.status(400).send('bad');
  notifies.add(`${fromId}|${toId}`);
  res.json({ ok: true });
});

// When client requests peers, include any notify tokens addressed to them (so they know someone wants to punch)
app.get('/peers_with_notify', (req, res) => {
  const myId = req.query.id;
  const out = [];
  for (const [id, p] of peers.entries()) {
    if (id === myId) continue;
    if (Date.now() - p.lastSeen > 1000*60*5) { peers.delete(id); continue; }
    const notifyKey = `${p.id}|${myId}`;
    const wantsToConnect = notifies.has(notifyKey);
    out.push({ id: p.id, name: p.name, host: p.host, port: p.port, pubKey: p.pubKey, wantsToConnect });
    if (wantsToConnect) notifies.delete(notifyKey);
  }
  res.json({ peers: out });
});

app.listen(HTTP_PORT, () => console.log(`Bootstrap HTTP listening ${HTTP_PORT}`));

/* Simple TCP relay server
   Protocol (very tiny):
   - Client connects, sends a JSON line: {"id":"peerId","token":"<targetId>"}
   - Server pairs two clients that requested each other, or if A asks for B it will store the awaiting socket and when B connects it pairs them and pipes data bidirectionally.
*/
const awaiting = new Map(); // key targetId -> { id, socket }

const relayServer = net.createServer(sock => {
  sock.setNoDelay(true);
  let buffer = '';
  sock.on('data', (d) => {
    buffer += d.toString();
    if (!buffer.includes('\n')) return;
    const line = buffer.trim();
    buffer = '';
    let obj;
    try { obj = JSON.parse(line); } catch(e) { sock.end(); return; }
    const { id, token } = obj;
    if (!id || !token) { sock.end(); return; }
    console.log(`[relay] ${id} requests relay->${token}`);
    // If someone waiting for id, pair them
    const otherKey = `${token}|${id}`;
    if (awaiting.has(otherKey)) {
      const other = awaiting.get(otherKey);
      awaiting.delete(otherKey);
      // pair sock <-> other.sock
      sock.write(JSON.stringify({ paired: true }) + '\n');
      other.sock.write(JSON.stringify({ paired: true }) + '\n');
      sock.pipe(other.sock);
      other.sock.pipe(sock);
      console.log(`[relay] paired ${id} <-> ${other.id}`);
      return;
    }
    // else wait
    const myKey = `${id}|${token}`;
    awaiting.set(myKey, { id, sock });
    // if this socket closes, remove
    sock.on('close', () => { if (awaiting.get(myKey)?.sock === sock) awaiting.delete(myKey); });
  });
  sock.on('error', ()=>{});
});

relayServer.listen(RELAY_PORT, () => console.log(`Relay server listening ${RELAY_PORT}`));
