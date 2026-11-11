const C = Crawl, $ = id => document.getElementById(id);
C.init({ onUpdate: render });
$('followBtn').onclick = () => C.setFollow(!C.follow);
$('itinBtn').onclick = () => { const o = $('itin'); o.style.display = o.style.display === 'none' ? '' : 'none'; };
function ago(t) { const s = Math.round((Date.now() - t) / 1000); return s < 60 ? s + 's ago' : s < 3600 ? Math.round(s / 60) + ' min ago' : Math.round(s / 3600) + ' h ago'; }
function render() {
  const st = C.state, s = st.status, stops = st.stops, last = st.trail[st.trail.length - 1];
  const nm = i => stops[i] ? C.esc(stops[i].name) : '–';
  $('where').innerHTML = !last ? 'Waiting for the guide…' : s.current >= 0 ? `At <b>${nm(s.current)}</b>` : s.lastVisited >= 0 ? `Walking from ${nm(s.lastVisited)}` : 'On the move';
  $('next').innerHTML = stops[s.next] ? `${nm(s.next)}${stops[s.next].start ? ' · ' + stops[s.next].start : ''}` : (stops.length ? 'Last stop – enjoy!' : '–');
  $('seen').textContent = last ? (st.demo ? 'Demo mode · ' : '') + 'seen ' + ago(last.t) : (st.demo ? 'Demo mode' : '');
  const si = C.scheduledIndex();
  $('sched').textContent = (st.demo ? 'Crawl clock ' + C.fmtMin(C.nowMin()) + ' · ' : '') + (si >= 0 ? 'Schedule: ' + stops[si].name : si === -1 ? (stops[0] && stops[0].start ? 'Starts ' + stops[0].start : '') : 'Schedule: heading to ' + (stops[-si - 1] ? stops[-si - 1].name : ''));
  $('followBtn').textContent = C.follow ? 'Following crew' : 'Follow crew';
  $('itin').innerHTML = stops.map((x, i) => `<li class="${i === s.current ? 'cur' : ''}"><span class="num">${i <= s.lastVisited && i !== s.current ? '✓' : i === s.current ? '➤' : i + 1}</span><span style="flex:1">${C.esc(x.name)}</span><span class="small">${C.esc(C.timeStr(x))}</span></li>`).join('');
}
setInterval(render, 5000);
