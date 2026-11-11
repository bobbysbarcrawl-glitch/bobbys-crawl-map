// Shared parchment-map logic for viewer + guide pages
window.Crawl = (() => {
  const EDINBURGH = [55.9490, -3.1895];
  const state = { stops: [], trail: [], status: { current: -1, lastVisited: -1, next: 0 }, demo: false, fadeMs: 45 * 60e3, simTime: null };
  const handlers = {};
  let map, stopLayer, routeLine, crewMarker, footLayer, ws, follow = true;
  let feet = [], acc = 0, side = 1, lastIdx = 0;

  const R = Math.PI / 180;
  const dist = (a, b) => { const dLa = (b.lat - a.lat) * R, dLo = (b.lng - a.lng) * R; const h = Math.sin(dLa / 2) ** 2 + Math.cos(a.lat * R) * Math.cos(b.lat * R) * Math.sin(dLo / 2) ** 2; return 2 * 6371e3 * Math.asin(Math.sqrt(h)); };
  const bearing = (a, b) => { const y = Math.sin((b.lng - a.lng) * R) * Math.cos(b.lat * R), x = Math.cos(a.lat * R) * Math.sin(b.lat * R) - Math.sin(a.lat * R) * Math.cos(b.lat * R) * Math.cos((b.lng - a.lng) * R); return (Math.atan2(y, x) / R + 360) % 360; };
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  // ---- time helpers: crawl night runs past midnight, so minutes are counted from noon ----
  const toMin = t => { if (!t) return null; let [h, m] = t.split(':').map(Number); if (h < 12) h += 24; return h * 60 + m; };
  const fmtMin = m => { if (m == null) return ''; m = ((m % 1440) + 1440) % 1440; return String(Math.floor(m / 60)).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0'); };
  function nowMin() {
    if (state.demo && state.simTime != null) return state.simTime;
    const p = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date());
    let h = +p.find(x => x.type === 'hour').value, m = +p.find(x => x.type === 'minute').value; if (h < 12) h += 24; return h * 60 + m;
  }
  function scheduledIndex(m = nowMin()) {
    const st = state.stops;
    for (let i = st.length - 1; i >= 0; i--) { const a = toMin(st[i].start); if (a != null && m >= a) { const b = toMin(st[i].end) ?? (i === st.length - 1 ? 28 * 60 : a + 60); return m < b ? i : -2 - i; } }
    return -1; // before start; -2-i = between stop i and i+1
  }
  const timeStr = s => s.start ? (s.start + (s.end ? '–' + s.end : ' onward')) : '';

  // ---- footprint art (original, hand-inked shoe print) ----
  const FOOT = (op) => `<svg width="12" height="22" viewBox="0 0 12 22" style="opacity:${op}"><path d="M6 0.8c3 0 4.6 2.6 4.4 6.1-.2 3-1.6 5.2-1.9 6.6-.3 1.3-1.2 1.9-2.6 1.9S3.3 14.6 2.8 13.2C2 11 1.3 9.4 1.4 6.6 1.6 3.2 3.2.8 6 .8z" fill="#3b2414"/><ellipse cx="6" cy="18.6" rx="2.9" ry="2.9" fill="#3b2414"/></svg>`;
  const footOpacity = t => Math.max(0, 0.85 * (1 - (Date.now() - t) / state.fadeMs));

  function strideMetres() { const z = map.getZoom(), mpp = 156543.03 * Math.cos(map.getCenter().lat * R) / 2 ** z; return Math.max(1.2, 26 * mpp); }

  function placeFoot(a, b, frac, t, animate) {
    const p = { lat: a.lat + (b.lat - a.lat) * frac, lng: a.lng + (b.lng - a.lng) * frac };
    const brg = bearing(a, b); side = -side;
    const icon = L.divIcon({ className: 'foot' + (animate ? ' new' : ''), iconSize: [12, 22], iconAnchor: [6, 11],
      html: `<div style="transform:rotate(${brg}deg) translateX(${side * 4}px) rotate(${side * 6}deg)">${FOOT(footOpacity(t))}</div>` });
    const mk = L.marker(p, { icon, interactive: false, keyboard: false }).addTo(footLayer); feet.push({ mk, t });
  }
  function extendFeet(animate) {
    const tr = state.trail, stride = strideMetres();
    for (; lastIdx < tr.length - 1; lastIdx++) {
      const a = tr[lastIdx], b = tr[lastIdx + 1], d = dist(a, b);
      if (d > 400) { acc = 0; continue; } // GPS jump: don't draw prints across it
      let pos = stride - acc;
      while (pos <= d) { placeFoot(a, b, pos / d, a.t + (b.t - a.t) * pos / d, animate); pos += stride; }
      acc = d - (pos - stride); // distance walked since the last print
    }
  }
  function rebuildFeet() { footLayer.clearLayers(); feet = []; acc = 0; lastIdx = 0; extendFeet(false); }
  function fadeFeet() {
    feet = feet.filter(f => { const o = footOpacity(f.t); if (o <= 0.02) { footLayer.removeLayer(f.mk); return false; }
      const svg = f.mk.getElement()?.querySelector('svg'); if (svg) svg.style.opacity = o.toFixed(2); return true; });
  }

  // ---- stops ----
  function stopClass(i) {
    const s = state.status; if (i === s.current) return 'current'; if (i === s.next) return 'next'; if (i <= s.lastVisited) return 'visited'; return '';
  }
  function drawStops() {
    stopLayer.clearLayers();
    state.stops.forEach((s, i) => {
      const icon = L.divIcon({ className: 'stopicon ' + stopClass(i), iconSize: [30, 30], iconAnchor: [13, 30], html: `<div class="pin"><span>${i + 1}</span></div>` });
      const mk = L.marker([s.lat, s.lng], { icon, draggable: !!handlers.draggable, zIndexOffset: 500 }).addTo(stopLayer);
      mk.bindTooltip(`${esc(s.name)}${s.start ? ` <small style="font-family:'IM Fell English';font-size:12px">${esc(timeStr(s))}</small>` : ''}`, { permanent: true, direction: 'right', offset: [8, -16], className: 'stoplabel' });
      if (handlers.onStopDrag) mk.on('dragend', e => handlers.onStopDrag(i, e.target.getLatLng()));
    });
    if (routeLine) routeLine.setLatLngs(state.stops.map(s => [s.lat, s.lng]));
  }

  function drawCrew() {
    const last = state.trail[state.trail.length - 1];
    if (!last) { if (crewMarker) { map.removeLayer(crewMarker); crewMarker = null; } return; }
    if (!crewMarker) crewMarker = L.marker(last, { zIndexOffset: 1000, icon: L.divIcon({ className: 'crew', iconSize: [24, 24], iconAnchor: [12, 12], html: '<div class="ring"></div><div class="dot"></div><div class="name">Bobby\'s Crew</div>' }) }).addTo(map);
    else crewMarker.setLatLng(last);
    if (follow) map.panTo(last, { animate: true, duration: 0.8 });
  }

  function emit(ev) { handlers.onUpdate && handlers.onUpdate(ev); }

  function connect() {
    ws = new WebSocket((location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + '/ws');
    ws.onopen = () => { handlers.onOpen && handlers.onOpen(ws); emit('open'); };
    ws.onclose = () => { emit('closed'); setTimeout(connect, 2000); };
    ws.onmessage = e => {
      const m = JSON.parse(e.data);
      if (m.type === 'state') { Object.assign(state, { stops: m.stops, trail: m.trail, status: m.status, demo: m.demo, fadeMs: m.fadeMs, simTime: m.simTime }); drawStops(); rebuildFeet(); drawCrew(); }
      else if (m.type === 'pos') { state.trail.push(m.p); extendFeet(true); drawCrew(); }
      else if (m.type === 'status') { state.status = m.status; drawStops(); }
      else if (m.type === 'stops') { state.stops = m.stops; state.status = m.status; drawStops(); }
      else if (m.type === 'sim') { state.simTime = m.simTime; }
      handlers.onMessage && handlers.onMessage(m);
      emit(m.type);
    };
  }
  const send = o => ws && ws.readyState === 1 && ws.send(JSON.stringify(o));

  function init(opts = {}) {
    Object.assign(handlers, opts);
    map = L.map('map', { zoomControl: false, attributionControl: true }).setView(EDINBURGH, 17);
    L.control.zoom({ position: 'bottomleft' }).addTo(map);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, subdomains: 'abc', attribution: '&copy; OpenStreetMap contributors' }).addTo(map);
    const v = document.createElement('div'); v.className = 'vignette'; document.getElementById('map').appendChild(v);
    routeLine = L.polyline([], { color: '#7a1f12', weight: 3, opacity: .55, className: 'route-line' }).addTo(map);
    stopLayer = L.layerGroup().addTo(map); footLayer = L.layerGroup().addTo(map);
    map.on('zoomend', rebuildFeet);
    map.on('dragstart', () => { follow = false; emit('follow'); });
    setInterval(fadeFeet, 3000);
    connect();
    return map;
  }
  return { init, state, send, esc, timeStr, toMin, fmtMin, nowMin, scheduledIndex, drawStops, dist,
    get map() { return map; }, get follow() { return follow; },
    setFollow(f) { follow = f; if (f) { const l = state.trail[state.trail.length - 1]; if (l) map.panTo(l); } emit('follow'); },
    fitStops() { if (state.stops.length) map.fitBounds(state.stops.map(s => [s.lat, s.lng]), { padding: [60, 60] }); } };
})();
