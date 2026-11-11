// Bobby's Bar Crawl – live parchment map server
const http = require('http'), fs = require('fs'), path = require('path'), crypto = require('crypto');
const { WebSocketServer } = require('ws');

const PORT = process.env.PORT || 8080;
const DATA = path.join(__dirname, 'data.json');
const PUB = path.join(__dirname, 'public');
const DEMO_ROUTE = JSON.parse(fs.readFileSync(path.join(__dirname, 'demo-route.json')));
const DEFAULT_STOPS = JSON.parse(fs.readFileSync(path.join(__dirname, 'stops.json')));

let db = { pin: null, stops: DEFAULT_STOPS.map((s, i) => ({ id: 's' + i, ...s })), trail: [], lastVisited: -1 };
try { Object.assign(db, JSON.parse(fs.readFileSync(DATA))); } catch {}
if (process.env.GUIDE_PIN) db.pin = process.env.GUIDE_PIN;
if (!db.pin) db.pin = String(crypto.randomInt(100000, 999999));
let saveT; const save = () => { clearTimeout(saveT); saveT = setTimeout(() => fs.writeFileSync(DATA, JSON.stringify(db)), 1000); };
save();

const AT_RADIUS = 35; // metres
let demo = null;      // {i, frac, pauseUntil}
let current = -1;     // index of stop group is at, -1 if walking
const LIVE_FADE = 45 * 60e3, DEMO_FADE = 4 * 60e3;

function dist(a, b) { const R = 6371e3, r = Math.PI / 180, dLa = (b.lat - a.lat) * r, dLo = (b.lng - a.lng) * r;
  const h = Math.sin(dLa / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(dLo / 2) ** 2; return 2 * R * Math.asin(Math.sqrt(h)); }

function status() {
  const n = db.stops.length; let next = current >= 0 ? current + 1 : db.lastVisited + 1;
  if (next >= n) next = -1;
  return { current, lastVisited: db.lastVisited, next };
}
function snapshot() { return { type: 'state', simTime: demo ? demo.sim : null, stops: db.stops, trail: db.trail, status: status(), demo: !!demo, fadeMs: demo ? DEMO_FADE : LIVE_FADE }; }

const hhmm = v => /^([01]?\d|2[0-3]):[0-5]\d$/.test(String(v || '').trim()) ? String(v).trim().padStart(5, '0') : '';
const clients = new Set();
function broadcast(msg) { const s = JSON.stringify(msg); for (const c of clients) if (c.readyState === 1) c.send(s); }

function addPoint(p) {
  const last = db.trail[db.trail.length - 1];
  if (last && dist(last, p) < 2 && p.t - last.t < 30e3) return; // ignore jitter
  db.trail.push(p); if (db.trail.length > 8000) db.trail.splice(0, db.trail.length - 8000);
  // stop detection
  let at = -1, best = AT_RADIUS;
  // only the stop they were last at, or the next one in order, counts (stops are close together in the Old Town)
  [db.lastVisited, db.lastVisited + 1].forEach(i => { const s = db.stops[i]; if (!s) return; const d = dist(s, p); if (d < best) { best = d; at = i; } });
  const changed = at !== current; current = at;
  if (at >= 0) db.lastVisited = at;
  broadcast({ type: 'pos', p });
  if (changed) broadcast({ type: 'status', status: status() });
  save();
}

// ---- demo simulation: walks the real foot route between sample Edinburgh pubs ----
const DEMO_STEP = 7; // metres per tick (~5x walking speed)
function demoTick() {
  if (!demo) return;
  const now = Date.now();
  if (now < demo.pauseUntil) { demo.sim = simClock(db.trail[db.trail.length - 1]); broadcast({ type: 'sim', simTime: demo.sim }); return; }
  let a = DEMO_ROUTE[demo.i], b = DEMO_ROUTE[demo.i + 1];
  if (!b) { demo.i = 0; demo.frac = 0; db.trail = []; db.lastVisited = -1; broadcast(snapshot()); return; }
  let need = DEMO_STEP;
  while (b) {
    const A = { lat: a[0], lng: a[1] }, B = { lat: b[0], lng: b[1] }, seg = dist(A, B) || 0.01;
    const left = seg * (1 - demo.frac);
    if (need < left) { demo.frac += need / seg; break; }
    need -= left; demo.i++; demo.frac = 0; a = DEMO_ROUTE[demo.i]; b = DEMO_ROUTE[demo.i + 1];
  }
  if (!b) { a = DEMO_ROUTE[DEMO_ROUTE.length - 1]; b = a; }
  const p = { lat: a[0] + (b[0] - a[0]) * demo.frac, lng: a[1] + (b[1] - a[1]) * demo.frac, t: now, demo: true };
  demo.sim = simClock(p); p.sim = demo.sim;
  const before = current; addPoint(p); broadcast({ type: 'sim', simTime: demo.sim });
  if (current >= 0 && current !== before) { demo.pauseUntil = now + 8000; } // "have a pint"
}
setInterval(demoTick, 1000);
// demo clock: maps progress along the route to the crawl schedule (minutes since 12:00 of crawl day)
const toMin = t => { if (!t) return null; let [h, m] = t.split(':').map(Number); if (h < 12) h += 24; return h * 60 + m; };
function simClock(p) {
  const st = db.stops; if (!st.length) return null;
  // nearest stop within radius => scheduled start..end progresses during the pause
  const i = current; const now = Date.now();
  if (i >= 0) { const a = toMin(st[i].start), b = toMin(st[i].end) ?? (a + 45); const f = demo.pauseUntil > now ? 1 - (demo.pauseUntil - now) / 8000 : 1; return a == null ? null : Math.round(a + (b - a) * Math.min(1, Math.max(0, f))); }
  const prev = st[db.lastVisited], next = st[db.lastVisited + 1];
  if (!next) return prev ? toMin(prev.end) : toMin(st[0].start) - 10;
  const t0 = prev ? (toMin(prev.end) ?? toMin(prev.start) + 45) : toMin(next.start) - 10, t1 = toMin(next.start);
  const from = prev || { lat: DEMO_ROUTE[0][0], lng: DEMO_ROUTE[0][1] };
  const total = dist(from, next) + 1, done = Math.min(total, dist(from, p));
  return Math.round(t0 + (t1 - t0) * done / total);
}
function setDemo(on) {
  if (on && !demo) { demo = { i: 0, frac: 0, pauseUntil: 0 }; db.trail = []; db.lastVisited = -1; current = -1; }
  if (!on && demo) { demo = null; db.trail = []; db.lastVisited = -1; current = -1; }
  broadcast(snapshot()); save();
}
if (process.env.DEMO === '1') setDemo(true);

// ---- HTTP ----
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.json': 'application/json' };
const server = http.createServer((req, res) => {
  let u = req.url.split('?')[0];
  if (u === '/' || u === '/map') u = '/index.html';
  if (u === '/guide') u = '/guide.html';
  if (u === '/healthz') { res.end('ok'); return; }
  const f = path.join(PUB, path.normalize(u).replace(/^(\.\.[\/\\])+/, ''));
  if (!f.startsWith(PUB)) { res.writeHead(403); return res.end(); }
  fs.readFile(f, (e, buf) => {
    if (e) { res.writeHead(404); return res.end('Not found'); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream', 'Cache-Control': 'no-cache' }); res.end(buf);
  });
});

const wss = new WebSocketServer({ server, path: '/ws' });
wss.on('connection', ws => {
  clients.add(ws); ws.guide = false;
  ws.send(JSON.stringify(snapshot()));
  ws.on('close', () => clients.delete(ws));
  ws.on('message', raw => {
    let m; try { m = JSON.parse(raw); } catch { return; }
    if (m.type === 'auth') { ws.guide = String(m.pin) === db.pin; ws.send(JSON.stringify({ type: 'auth', ok: ws.guide })); return; }
    if (!ws.guide) return ws.send(JSON.stringify({ type: 'error', error: 'Guide PIN required' }));
    if (m.type === 'pos' && isFinite(m.lat) && isFinite(m.lng)) { if (demo) setDemo(false); if ((m.acc || 0) <= 80) addPoint({ lat: +m.lat, lng: +m.lng, t: Date.now(), acc: m.acc }); }
    else if (m.type === 'stops' && Array.isArray(m.stops)) {
      db.stops = m.stops.filter(s => isFinite(s.lat) && isFinite(s.lng)).slice(0, 50).map((s, i) => ({ id: String(s.id || 's' + Date.now() + i), name: String(s.name || 'Stop ' + (i + 1)).slice(0, 60), lat: +s.lat, lng: +s.lng, start: hhmm(s.start), end: hhmm(s.end) }));
      db.lastVisited = Math.min(db.lastVisited, db.stops.length - 1); save(); broadcast({ type: 'stops', stops: db.stops, status: status() });
    }
    else if (m.type === 'demo') setDemo(!!m.on);
    else if (m.type === 'clearTrail') { db.trail = []; db.lastVisited = -1; current = -1; save(); broadcast(snapshot()); }
    else if (m.type === 'setVisited') { db.lastVisited = Math.max(-1, Math.min(+m.index, db.stops.length - 1)); current = db.lastVisited; save(); broadcast({ type: 'status', status: status() }); }
    else if (m.type === 'resetStops') { db.stops = DEFAULT_STOPS.map((s, i) => ({ id: 's' + i, ...s })); db.lastVisited = -1; save(); broadcast(snapshot()); }
  });
});
setInterval(() => { for (const c of clients) if (c.readyState === 1) c.ping(); }, 25000);
server.listen(PORT, () => console.log(`Bobby's crawl map on :${PORT}  guide PIN ${db.pin}`));
