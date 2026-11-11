// Node relay. Setup: npm i ws   then: node relay-server.js
const { WebSocketServer } = require('ws');
const wss = new WebSocketServer({ port: process.env.PORT || 8080 });
wss.on('connection', ws => {
  ws.isAlive = true;
  ws.on('pong', () => ws.isAlive = true);
  ws.on('message', d => {
    const s = d.toString();
    for (const c of wss.clients) if (c !== ws && c.readyState === 1) c.send(s);
  });
});
setInterval(() => { for (const c of wss.clients) { if (!c.isAlive) c.terminate(); c.isAlive = false; c.ping(); } }, 30000);
console.log('Voxel Blades relay running');
