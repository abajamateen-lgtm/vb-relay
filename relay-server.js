// Voxel Blades server v2: realtime relay + friends, profiles, rankings, shared arena library.
// Optional persistence: set UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN (free Upstash Redis).
// Without them data is kept in memory and a local file (lost when a free host restarts).
const http = require('http'), fs = require('fs'), { WebSocketServer } = require('ws');
const FILE = process.env.DB_FILE || './vb-data.json', UP = process.env.UPSTASH_REDIS_REST_URL, UT = process.env.UPSTASH_REDIS_REST_TOKEN;
let db = { users: {}, arenas: {} }, dirty = false; const online = {};
const rid = n => [...Array(n)].map(() => 'abcdefghjkmnpqrstuvwxyz23456789'[Math.random() * 31 | 0]).join('');
const clean = (s, n = 12) => String(s == null ? '' : s).replace(/[^\w \-.]/g, '').slice(0, n);
const day = () => Math.floor(Date.now() / 864e5), week = () => Math.floor((Date.now() / 864e5 + 3) / 7);
const code = u => u.uid.slice(0, 6).toUpperCase(), TIERS = [25, 100, 500, 2000], tier = u => TIERS.filter(t => (u.cp || 0) >= t).length;
const pub = u => ({ name: u.name, xp: u.xp, wins: u.wins, kills: u.kills, plays: u.plays, streak: u.streak, best: u.best, code: code(u), cp: u.cp || 0, tier: tier(u) });
const flist = u => u.friends.map(i => db.users[i]).filter(Boolean).map(f => ({ code: code(f), name: f.name, online: !!online[f.uid], xp: f.xp, tier: tier(f) }));
const rlist = u => u.reqs.map(i => db.users[i]).filter(Boolean).map(f => ({ code: code(f), name: f.name }));
const send = (w, o) => { if (w && w.readyState === 1) w.send(JSON.stringify(o)); };
const byCode = c => Object.values(db.users).find(x => code(x) === String(c || '').trim().toUpperCase());
const social = u => ({ ok: 1, friends: flist(u), reqs: rlist(u) });
const H = {
  hello(u, d, ws) { u.name = clean(d.name) || 'Player'; u.seen = Date.now(); online[u.uid] = ws; ws.uid = u.uid; const c = u.pending || 0; u.pending = 0; dirty = true; return Object.assign(social(u), { me: pub(u), coins: c }); },
  me(u) { return Object.assign(social(u), { me: pub(u) }); },
  'friend.add'(u, d) {
    const t = byCode(d.code); if (!t || t === u) return { err: 'No player with that code' };
    if (u.friends.includes(t.uid)) return { err: 'Already friends' };
    if (u.reqs.includes(t.uid)) { u.reqs = u.reqs.filter(x => x !== t.uid); u.friends.push(t.uid); t.friends.push(u.uid); }
    else { if (t.reqs.includes(u.uid)) return { err: 'Request already sent' }; if (t.reqs.length >= 30) return { err: 'Their inbox is full' }; t.reqs.push(u.uid); send(online[t.uid], { ev: 'freq', name: u.name }); }
    dirty = true; return social(u);
  },
  'friend.accept'(u, d) {
    const t = byCode(d.code); if (!t || !u.reqs.includes(t.uid)) return { err: 'No request' };
    u.reqs = u.reqs.filter(x => x !== t.uid); if (!u.friends.includes(t.uid)) u.friends.push(t.uid); if (!t.friends.includes(u.uid)) t.friends.push(u.uid);
    dirty = true; return social(u);
  },
  'friend.remove'(u, d) { const t = byCode(d.code); if (t) { u.friends = u.friends.filter(x => x !== t.uid); t.friends = t.friends.filter(x => x !== u.uid); u.reqs = u.reqs.filter(x => x !== t.uid); dirty = true } return social(u); },
  'friend.invite'(u, d) {
    const t = byCode(d.code); if (!t || !u.friends.includes(t.uid)) return { err: 'Not your friend' };
    if (!online[t.uid]) return { err: 'They are offline' }; send(online[t.uid], { ev: 'invite', from: u.name, room: clean(d.room, 24) }); return { ok: 1 };
  },
  'arena.publish'(u, d) {
    const type = d.type === 'mode' ? 'mode' : 'arena', data = d.data;
    if (!data || typeof data !== 'object' || JSON.stringify(data).length > 3000) return { err: 'Bad data' };
    if (Object.keys(db.arenas).length > 5000) return { err: 'Library full' };
    const mine = Object.values(db.arenas).filter(a => a.owner === u.uid); if (mine.length >= 10) return { err: 'Limit: 10 published items' };
    const name = clean(d.name, 24) || 'Untitled'; if (mine.some(a => a.name === name)) return { err: 'You already published that name' };
    const id = rid(8); db.arenas[id] = { id, owner: u.uid, on: u.name, name, type, data, plays: 0, likes: [], el: {}, last: {}, wk: { k: week(), n: 0 }, dc: { d: 0, n: 0 }, created: Date.now() };
    dirty = true; return { ok: 1, id };
  },
  'arena.list'(u, d) {
    let a = Object.values(db.arenas); if (d.type === 'arena' || d.type === 'mode') a = a.filter(x => x.type === d.type);
    const w = week(), wk = x => x.wk.k === w ? x.wk.n : 0; if (d.sort === 'mine') a = a.filter(x => x.owner === u.uid);
    const SORT = { popular: (x, y) => y.plays - x.plays, new: (x, y) => y.created - x.created, liked: (x, y) => y.likes.length - x.likes.length, week: (x, y) => wk(y) - wk(x) };
    a.sort(SORT[d.sort] || SORT.popular);
    return { ok: 1, list: a.slice(0, 30).map(x => ({ id: x.id, name: x.name, type: x.type, owner: x.on, plays: x.plays, wk: wk(x), likes: x.likes.length, liked: x.likes.includes(u.uid), mine: x.owner === u.uid })) };
  },
  'arena.get'(u, d) { const a = db.arenas[d.id]; return a ? { ok: 1, id: a.id, name: a.name, type: a.type, data: a.data } : { err: 'Gone' }; },
  'arena.like'(u, d) {
    const a = db.arenas[d.id]; if (!a) return { err: 'Gone' }; const i = a.likes.indexOf(u.uid);
    if (i >= 0) a.likes.splice(i, 1); else { a.likes.push(u.uid); const o = db.users[a.owner]; if (o && o !== u && !a.el[u.uid]) { a.el[u.uid] = 1; o.pending = (o.pending || 0) + 1; } }
    dirty = true; return { ok: 1, likes: a.likes.length, liked: i < 0 };
  },
  'arena.play'(u, d) {
    const a = db.arenas[d.id]; if (!a) return { err: 'Gone' }; const t = day(); if (a.last[u.uid] === t) return { ok: 1, dup: 1 };
    if (Object.keys(a.last).length > 3000) a.last = {}; a.last[u.uid] = t; a.plays++;
    const w = week(); if (a.wk.k !== w) a.wk = { k: w, n: 0 }; a.wk.n++;
    const o = db.users[a.owner];
    if (o && o !== u) { o.cp = (o.cp || 0) + 1; if (a.dc.d !== t) a.dc = { d: t, n: 0 };
      if (a.dc.n < 50) { a.dc.n += 2; if (online[o.uid]) send(online[o.uid], { ev: 'coins', n: 2 }); else o.pending = (o.pending || 0) + 2; } }
    dirty = true; return { ok: 1 };
  },
  'arena.delete'(u, d) { const a = db.arenas[d.id]; if (a && a.owner === u.uid) { delete db.arenas[d.id]; dirty = true; return { ok: 1 }; } return { err: 'Not yours' }; },
  'match.report'(u, d) {
    const n = Date.now(); if (n - (u.lastRep || 0) < 45000) return { err: 'Slow down', me: pub(u) }; u.lastRep = n;
    const win = !!d.win, k = Math.min(30, Math.max(0, d.kills | 0)); u.xp += Math.min(150, (win ? 60 : 20) + 2 * k); u.kills += k; u.plays++;
    if (win) { u.wins++; u.streak++; u.best = Math.max(u.best, u.streak); } else u.streak = 0; dirty = true; return { ok: 1, me: pub(u) };
  },
  'lb.get'(u, d) {
    const k = { wins: 'wins', kills: 'kills', xp: 'xp', streak: 'best', creators: 'cp' }[d.board] || 'wins';
    const a = Object.values(db.users).filter(x => (x[k] || 0) > 0).sort((x, y) => (y[k] || 0) - (x[k] || 0)).slice(0, 25);
    return { ok: 1, list: a.map(x => ({ n: x.name, v: x[k] || 0, tier: tier(x), me: x.uid === u.uid })) };
  }
};
function handleApi(ws, j) {
  const d = j.d || {}, reply = o => send(ws, Object.assign({ r: j.id }, o)); let u = db.users[j.uid];
  if (!/^[a-z0-9]{8,24}$/.test(String(j.uid)) || typeof j.tok !== 'string' || j.tok.length < 16 || j.tok.length > 40) return reply({ err: 'Bad id' });
  if (!u) {
    if (j.api !== 'hello') return reply({ err: 'Say hello first' }); if (Object.keys(db.users).length > 20000) return reply({ err: 'Server full' });
    u = db.users[j.uid] = { uid: j.uid, tok: j.tok, name: 'Player', xp: 0, wins: 0, kills: 0, plays: 0, streak: 0, best: 0, friends: [], reqs: [], pending: 0, cp: 0, lastRep: 0, created: Date.now() }; dirty = true;
  } else if (u.tok !== j.tok) return reply({ err: 'Auth failed' });
  const f = H[j.api]; if (!f) return reply({ err: 'Unknown command' });
  try { reply(f(u, d, ws) || { ok: 1 }); } catch (e) { console.log(e); reply({ err: 'Server error' }); }
}
async function load() { try { if (UP) { const r = await fetch(UP + '/get/vbdb', { headers: { Authorization: 'Bearer ' + UT } }); const j = await r.json(); if (j.result) db = JSON.parse(j.result); } else if (fs.existsSync(FILE)) db = JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch (e) { console.log('load failed', e.message); } }
async function save() { if (!dirty) return; dirty = false; const s = JSON.stringify(db); try { if (UP) await fetch(UP + '/set/vbdb', { method: 'POST', headers: { Authorization: 'Bearer ' + UT }, body: s }); else fs.writeFileSync(FILE, s); } catch (e) { console.log('save failed', e.message); dirty = true; } }
if (require.main === module) {
  const server = http.createServer((req, res) => { res.writeHead(200, { 'Content-Type': 'text/plain' }); res.end('Voxel Blades server OK'); });
  const wss = new WebSocketServer({ server, maxPayload: 64 * 1024 });
  wss.on('connection', ws => {
    ws.isAlive = true; ws.q = 0; ws.on('pong', () => ws.isAlive = true);
    ws.on('close', () => { if (ws.uid && online[ws.uid] === ws) delete online[ws.uid]; });
    ws.on('message', raw => {
      const s = raw.toString();
      if (s.charCodeAt(0) === 123 && s.includes('"api"')) { let j; try { j = JSON.parse(s); } catch (e) { return; } if (j && j.api) { if (++ws.q > 30) return; return handleApi(ws, j); } }
      for (const c of wss.clients) if (c !== ws && c.readyState === 1) c.send(s);
    });
  });
  setInterval(() => { for (const c of wss.clients) { c.q = 0; } }, 1000);
  setInterval(() => { for (const c of wss.clients) { if (!c.isAlive) { c.terminate(); continue; } c.isAlive = false; c.ping(); } }, 30000);
  setInterval(save, 20000);
  process.on('SIGTERM', async () => { dirty = true; await save(); process.exit(0); });
  load().then(() => server.listen(process.env.PORT || 8080, () => console.log('Voxel Blades relay running')));
} else module.exports = { handleApi };
