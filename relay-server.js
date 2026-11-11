// Voxel Blades relay. Works on Render, Railway, Fly, any Node host.
const http = require('http');
const { WebSocketServer } = require('ws');
const server = http.createServer((req, res) => { res.writeHead(200, { 'Content-Type': 'text/plain' }); res.end('Voxel Blades relay OK'); });
const wss = new WebSocketServer({ server, maxPayload: 64 * 1024 });
wss.on('connection', ws => {
  ws.isAlive = true;
  ws.on('pong', () => ws.isAlive = true);
  ws.on('message', d => {
    const s = d.toString();
    for (const c of wss.clients) if (c !== ws && c.readyState === 1) c.send(s);
  });
});
setInterval(() => { for (const c of wss.clients) { if (!c.isAlive) { c.terminate(); continue; } c.isAlive = false; c.ping(); } }, 30000);
server.listen(process.env.PORT || 8080, () => console.log('Voxel Blades relay running'));
