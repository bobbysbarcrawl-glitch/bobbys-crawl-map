const C = Crawl, $ = id => document.getElementById(id);
let pin = new URLSearchParams(location.search).get('pin') || localStorage.getItem('bbc_pin') || '';
let authed = false, watchId = null, wakeLock = null, addMode = false, lastSent = 0;

C.init({
  draggable: true,
  onOpen: () => { if (pin) C.send({ type: 'auth', pin }); },
  onStopDrag: (i, ll) => { C.state.stops[i].lat = ll.lat; C.state.stops[i].lng = ll.lng; pushStops(); },
  onMessage: m => {
    if (m.type === 'auth') { authed = m.ok; if (m.ok) { localStorage.setItem('bbc_pin', pin); $('gate').style.display = 'none'; } else { $('pinErr').textContent = 'That PIN is not right.'; $('gate').style.display = ''; } }
    if (['state', 'stops', 'status'].includes(m.type)) renderStops();
    if (m.type === 'state' || m.type === 'pos') $('demoBtn').textContent = C.state.demo ? 'Stop demo walk' : 'Start demo walk';
  }
});
$('viewUrl').value = location.origin + '/';
$('pinBtn').onclick = () => { pin = $('pin').value.trim(); C.send({ type: 'auth', pin }); };
$('pin').onkeydown = e => { if (e.key === 'Enter') $('pinBtn').click(); };
$('panelBtn').onclick = () => $('panel').classList.toggle('hidden');
if (innerWidth < 700) $('panel').classList.add('hidden');
$('demoBtn').onclick = () => C.send({ type: 'demo', on: !C.state.demo });
$('clearBtn').onclick = () => confirm('Clear the footprint trail for everyone?') && C.send({ type: 'clearTrail' });
$('resetBtn').onclick = () => confirm('Replace stops with the default Edinburgh route?') && C.send({ type: 'resetStops' });
$('fitBtn').onclick = () => { C.setFollow(false); C.fitStops(); };
$('copyBtn').onclick = async () => { try { await navigator.clipboard.writeText($('viewUrl').value); $('copyBtn').textContent = 'Copied!'; } catch { $('viewUrl').select(); } setTimeout(() => $('copyBtn').textContent = 'Copy viewer link', 1500); };

// ---- live GPS ----
async function keepAwake() { try { wakeLock = await navigator.wakeLock?.request('screen'); } catch {} }
document.addEventListener('visibilitychange', () => { if (watchId != null && document.visibilityState === 'visible') keepAwake(); });
$('shareBtn').onclick = () => {
  if (watchId != null) { navigator.geolocation.clearWatch(watchId); watchId = null; wakeLock?.release?.(); $('shareBtn').textContent = '▶ Start sharing my location'; $('gpsInfo').textContent = 'Stopped sharing.'; return; }
  if (!navigator.geolocation) return alert('This browser has no GPS access.');
  watchId = navigator.geolocation.watchPosition(p => {
    const { latitude: lat, longitude: lng, accuracy: acc } = p.coords;
    $('gpsInfo').textContent = `Sharing · accuracy ±${Math.round(acc)} m · ${new Date().toLocaleTimeString('en-GB')}` + (acc > 80 ? ' (too fuzzy, waiting for a better fix)' : '');
    if (Date.now() - lastSent > 2500) { C.send({ type: 'pos', lat, lng, acc }); lastSent = Date.now(); }
  }, e => { $('gpsInfo').textContent = 'GPS error: ' + e.message + (e.code === 1 ? ' – allow location for this site in your browser settings.' : ''); },
  { enableHighAccuracy: true, maximumAge: 2000, timeout: 20000 });
  keepAwake(); C.setFollow(true);
  $('shareBtn').textContent = '■ Stop sharing'; $('gpsInfo').textContent = 'Waiting for GPS fix…';
};

// ---- stops editor ----
let pushT; function pushStops() { clearTimeout(pushT); pushT = setTimeout(() => C.send({ type: 'stops', stops: C.state.stops }), 400); C.drawStops(); }
function renderStops() {
  const s = C.state.status, el = $('stops'), focused = document.activeElement && el.contains(document.activeElement);
  if (focused) return; // don't clobber typing
  el.innerHTML = C.state.stops.map((x, i) => `<li class="${i === s.current ? 'cur' : ''}" style="flex-wrap:wrap">
    <span class="num">${i === s.current ? '➤' : i + 1}</span><input type="text" data-i="${i}" data-k="name" value="${C.esc(x.name)}">
    <button data-a="here" data-i="${i}" title="Crew is here">Here</button><button data-a="up" data-i="${i}">↑</button><button data-a="del" data-i="${i}">✕</button>
    <span style="width:100%;padding-left:28px" class="small">${i === s.current ? 'Crew is here · ' : i === s.next ? 'Next · ' : i <= s.lastVisited ? 'Done · ' : ''}
     <input type="time" data-i="${i}" data-k="start" value="${x.start || ''}" style="width:auto;padding:2px!important"> – <input type="time" data-i="${i}" data-k="end" value="${x.end || ''}" style="width:auto;padding:2px!important"></span></li>`).join('');
}
$('stops').addEventListener('change', e => { const i = +e.target.dataset.i, k = e.target.dataset.k; if (k) { C.state.stops[i][k] = e.target.value; pushStops(); } });
$('stops').addEventListener('click', e => {
  const a = e.target.dataset.a, i = +e.target.dataset.i, st = C.state.stops; if (!a) return;
  if (a === 'del') { if (!confirm('Remove ' + st[i].name + '?')) return; st.splice(i, 1); pushStops(); renderStops(); }
  if (a === 'up' && i > 0) { [st[i - 1], st[i]] = [st[i], st[i - 1]]; pushStops(); renderStops(); }
  if (a === 'here') C.send({ type: 'setVisited', index: i });
});
$('addBtn').onclick = () => { addMode = !addMode; $('addHint').style.display = addMode ? '' : 'none'; if (addMode && innerWidth < 700) $('panel').classList.add('hidden'); };
C.map.on('click', e => {
  if (!addMode) return; addMode = false; $('addHint').style.display = 'none';
  const name = prompt('Name of this stop?', 'New stop'); if (!name) return;
  C.state.stops.push({ name, lat: e.latlng.lat, lng: e.latlng.lng, start: '', end: '' }); pushStops(); renderStops(); $('panel').classList.remove('hidden');
});
let qT; $('q').oninput = () => { clearTimeout(qT); qT = setTimeout(search, 600); };
async function search() {
  const q = $('q').value.trim(); if (q.length < 3) { $('results').innerHTML = ''; return; }
  const b = C.map.getBounds().pad(2);
  const u = `https://nominatim.openstreetmap.org/search?format=json&limit=6&q=${encodeURIComponent(q)}&viewbox=${b.getWest()},${b.getNorth()},${b.getEast()},${b.getSouth()}&bounded=0`;
  try {
    const r = await (await fetch(u, { headers: { 'Accept-Language': 'en' } })).json();
    $('results').innerHTML = r.map((x, i) => `<div data-i="${i}">${C.esc(x.display_name.split(',').slice(0, 3).join(','))}</div>`).join('') || '<div>No matches</div>';
    $('results').onclick = e => { const x = r[e.target.dataset.i]; if (!x) return;
      C.state.stops.push({ name: x.name || x.display_name.split(',')[0], lat: +x.lat, lng: +x.lon, start: '', end: '' }); pushStops(); renderStops();
      $('results').innerHTML = ''; $('q').value = ''; C.setFollow(false); C.map.setView([+x.lat, +x.lon], 18); };
  } catch { $('results').innerHTML = '<div>Search failed – try tapping the map instead.</div>'; }
}
