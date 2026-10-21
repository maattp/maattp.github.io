// Auto KW: ION end to end. Runs on the booted game (no rendering needed):
//   VIEW_PROBE_FILE=tools/kw/ionprobe.js node tools/kw/kwshots.mjs <dir>
//
// 1. THE SERVICE: four hours of it by the service's own code (link._service
//    at 0.5 s), every train's arrivals logged: the headway at stations along
//    the line, each direction (should be the timetable's 10 min), and the
//    complete trips -- terminus to terminus, the stops made and the minutes.
// 2. A RIDE: you, on foot on Conestoga's departure platform; the train there
//    is boardable (link.boardable); you board it (player.enterVehicle) and
//    drive it, POWER and BRAKE (never held at a stand: that reverses), stopping at every platform's mark (the
//    readout's "Next: X  N m") all the way to Fairway; each stop is judged
//    (onArrive) and its doors open; at Fairway you step off onto the
//    platform (exitSpot).
// 3. THE LINE: stations with their platform kind (centre / side, from OSM or
//    guessed), the gated crossings, the catenary poles.
// Ends with PASS / FAIL lines; the harness prints the page's exceptions.
(() => {
  const d = window.__dbg, L = d.link, out = [], fail = [];
  const say = (s) => out.push(s);
  // --- 3. the line --------------------------------------------------------------
  say('stations: ' + L.stations.map((st) => {
    const ks = Object.keys(st.plan || {});
    const p = st.plan && st.plan[ks[0]];
    return `${st.name} [${ks.join('/')}] ${p ? (p.island ? 'centre' : 'side') + (p.osm ? '' : '?') : '-'}`;
  }).join('; '));
  say(`crossings with signals: ${L.crossings.length} (gated ${L.crossings.filter((c) => c.gate).length}): ` + L.crossings.map((c) => (c.road && c.road.name) || '?').join(', '));
  say(`catenary poles: ${L.poles.length}`);
  // --- 1. the service -------------------------------------------------------------
  const tt = L.timetable;
  say(`timetable: ${tt.N} trains, every ${tt.H / 60} min; trips ${(tt.Tsb / 60).toFixed(1)} min south, ${(tt.Tnb / 60).toFixed(1)} min north; ${(tt.layover / 60).toFixed(1)} min at each end`);
  const arr = {}, prev = new Map(), trips = new Map(), done = [];
  let t = 0;
  const DT = 0.5;
  for (let i = 0; i < 4 * 3600 / DT; i++) {
    L._service(DT, true);
    t += DT;
    for (const tr of L.trains) {
      const key = tr.track.key, was = prev.get(tr) || {};
      if (tr.state === 'dwell' && (was.state !== 'dwell' || was.station !== tr.station || was.key !== key)) {
        const id = tr.station.name + '|' + key;
        (arr[id] = arr[id] || []).push(t);
        let tp = trips.get(tr);
        if (!tp || tp.key !== key) { tp = { key, stops: [], t0: t }; trips.set(tr, tp); }
        tp.stops.push(tr.station.name);
        if (tr.station === tr.track.to) { done.push({ id: tr.id, key, stops: tp.stops, mins: (t - tp.t0) / 60 }); trips.delete(tr); }
      }
      prev.set(tr, { state: tr.state, station: tr.station, key });
    }
  }
  for (const id of ['Conestoga|sb', 'University of Waterloo|sb', 'Waterloo Public Square|nb', 'Willis Way|sb', 'Central Station|nb', 'Kitchener City Hall|nb', 'Queen|sb', 'Mill|sb', 'Fairway|nb']) {
    const a = (arr[id] || []).filter((x) => x > 3600);
    const h = a.slice(1).map((x, i) => x - a[i]);
    if (!h.length) { fail.push(`no trains at ${id}`); continue; }
    const mean = h.reduce((p, q) => p + q, 0) / h.length, mn = Math.min(...h), mx = Math.max(...h);
    say(`  headway ${id}: ${(mean / 60).toFixed(1)} min (min ${(mn / 60).toFixed(1)}, max ${(mx / 60).toFixed(1)}), ${a.length} trains in 3 h`);
    if (Math.abs(mean - tt.H) > 30 || mx - mn > 90) fail.push(`headway at ${id}`);
  }
  const full = done.filter((q) => q.stops[0] === (q.key === 'sb' ? 'Conestoga' : 'Fairway'));
  for (const q of full.slice(0, 2).concat(full.filter((q) => q.key === 'nb').slice(0, 1))) say(`  trip #${q.id} ${q.key}: ${q.stops.length} stops in ${q.mins.toFixed(1)} min: ${q.stops.join(' > ')}`);
  for (const q of full) { const want = L.stations.filter((st) => st.s[q.key] !== undefined).length; if (q.stops.length !== want) fail.push(`trip #${q.id} ${q.key} made ${q.stops.length} stops of ${want}`); }
  if (!full.length) fail.push('no complete trips');
  const onLine = L.trains.filter((q) => q.state !== 'off').length;
  say(`  trains on the line at once: ${onLine}`);
  if (onLine < 4) fail.push('fewer than 4 trains on the line');
  // --- 2. a ride ---------------------------------------------------------------------
  const p = d.player, sb = L.tracks.sb, st0 = sb.from;
  let train = L.trains.find((q) => q.track === sb && q.state === 'dwell' && q.station === st0);
  if (!train) {
    // none standing there now: bring the next one in (as ENTER at the platform does)
    train = L.trains.find((q) => q.track === sb) || L.trains[0];
    train.track = sb; train.dir = sb.dir; train.place(st0.stop.sb, sb.dir); train.state = 'dwell'; train.timer = 60; train.station = st0; train.lastStop = st0; train.doors = true;
  }
  const spot = L.platformSpot(st0, train);
  if (p.vehicle) p.exitVehicle && p.exitVehicle();
  p.x = spot.x; p.z = spot.z; p.y = spot.y;
  const bt = L.boardable(spot.x, spot.y, spot.z);
  if (bt !== train) fail.push('the train at Conestoga is not boardable from its platform');
  p.enterVehicle(train);
  if (p.vehicle !== train) fail.push('boarding failed');
  const stops = [];
  const arrive = L.onArrive.bind(L);
  L.onArrive = (tr, st, err, secs) => { stops.push(`${st.name} (${err.toFixed(1)} m)`); arrive(tr, st, err, secs); };
  let rideT = 0;
  for (let i = 0; i < 16000 && train.track === sb; i++) {
    const nx = train.nextStation();
    if (!nx) break;
    const left = (nx.stop.sb + sb.dir * 15.1 - train.lead) * sb.dir;
    const v = Math.abs(train.u);
    let lim = train.allowed(nx.stop.sb + sb.dir * 15.1, 1.0) - 0.4;
    // a driver keeps back from the train ahead (the readout's TRAIN AHEAD)
    const ah = L.aheadOf(train);
    if (ah) lim = Math.min(lim, Math.sqrt(Math.max(0, 2 * 1.0 * ((ah.tail - train.lead) * sb.dir - 35))));
    const inp = left < 0.6 && v < 0.05 ? { throttle: 0, brake: 0.4 } : v < lim ? { throttle: 0.8, brake: 0 } : { throttle: 0, brake: v > lim + 1.2 ? 1 : Math.min(0.9, (v - lim) * 0.6 + 0.3) };
    // the rest of the service runs on round you (it would be behind and ahead of you)
    L._service(0.25, true);
    train.update(0.25, inp);
    rideT += 0.25;
    // stand at each platform for its doors
    if (train.doors && train.stationHere() === nx) { for (let k = 0; k < 8; k++) { L._service(0.25, true); train.update(0.25, { throttle: 0, brake: 0.4 }); } rideT += 2; }
    if (nx === sb.to && train.stationHere() === sb.to && train.doors) break;
  }
  say(`ride Conestoga > Fairway as the driver: ${stops.length} stops in ${(rideT / 60).toFixed(1)} min: ${stops.join(', ')}`);
  const want = L.stations.filter((st) => st.s.sb !== undefined).length - 1;
  if (stops.length !== want) fail.push(`the ride stopped at ${stops.length} platforms, not ${want}`);
  const ex = L.exitSpot(train);
  if (!ex) fail.push('no exit at Fairway');
  else say(`  step off at Fairway: (${ex.x.toFixed(1)}, ${ex.y.toFixed(2)}, ${ex.z.toFixed(1)}) -- on the platform: ${Math.abs(ex.y - (train.track.y(train.s) + 0.36)) < 0.05}`);
  say(`  announcement: "${L.lastAnnounce || ''}"`);
  L.onArrive = arrive;
  say(fail.length ? 'FAIL: ' + fail.join('; ') : 'PASS');
  return out.join('\n');
})()
