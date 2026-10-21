// Auto KW: the heavy rail end to end (src/kwrail.js). Runs on the booted game:
//   VIEW_PROBE_FILE=tools/kw/railprobe.js node tools/kw/kwshots.mjs <dir>
//
// 1. THE SERVICE: two hours of it by the rail's own code (kwrail.update at
//    0.5 s, the camera far from every line): trains on and off the map, GO's
//    turns at Kitchener, VIA's calls, the WCR's four stations, the meets at
//    passing places -- NO TWO TRAINS EVER IN EACH OTHER on one track, no
//    train rescued from a stand (the dispatcher never locks), none waiting
//    more than 12 minutes for the road (a meet across the 14.8 km block
//    west of Kitchener takes ~11).
// 2. THE CROSSINGS: at the busiest-road crossings of each running line (you
//    stand by the road, traffic runs round you), a train is sent through:
//    the lights come on, the gates come down, cars stop at the arms -- and
//    no AI car is ever on the tracks while a train is on the crossing, and
//    none drives in past a lowered gate.
// Ends with PASS / FAIL lines; the harness prints the page's exceptions.
(() => {
  const d = window.__dbg, R = d.rail, out = [], fail = [];
  const say = (s) => out.push(s);
  if (!R) return 'FAIL: no rail (window.__dbg.rail)';
  say(`lines: ${R.lines.map((l) => `${l.key} ${(l.tr.len / 1000).toFixed(1)} km, ${l.pps.length} passing places, stops ${l.stops.map((s) => s.name).join('/') || '-'}`).join('; ')}`);
  say(`crossings: ${R.active.length} with lights (${R.active.filter((c) => c.gate).length} gated), ${R.crossings.length - R.active.length} crossbuck-only on spurs; ${R.statics.length} pieces of other track`);
  if (R.atlasUsedH > 2176) fail.push(`decal atlas overflows (${R.atlasUsedH})`);

  // --- 1. the service ---------------------------------------------------------------
  const cam = { position: { x: 0, y: 500, z: 15500 } };
  const DT = 0.5, H = 2 * 3600;
  const seen = new Set(), calls = {}, collide = [];
  let maxOn = 0;
  const longest = { t: 0, who: '-' };
  const wasState = new Map();
  for (let t = 0; t < H; t += DT) {
    R.update(DT, cam);
    let on = 0;
    for (const line of R.lines) {
      const ts = line.trains;
      on += ts.length;
      for (const tr of ts) {
        seen.add(tr.cfg.id);
        const w = wasState.get(tr);
        if (tr.state === 'dwell' && w !== 'dwell' && tr.dwellStop) {
          const k = `${tr.cfg.kind}@${tr.dwellStop.name}`;
          calls[k] = (calls[k] || 0) + 1;
        }
        wasState.set(tr, tr.state);
      }
      // two trains in each other on the same track
      for (let i = 0; i < ts.length; i++) for (let j = i + 1; j < ts.length; j++) {
        const a = ts[i], b = ts[j];
        const a0 = Math.min(a.lead, a.tail), a1 = Math.max(a.lead, a.tail), b0 = Math.min(b.lead, b.tail), b1 = Math.max(b.lead, b.tail);
        if (a1 < b0 + 1 || b1 < a0 + 1) continue;
        const lo = Math.max(a0, b0), hi = Math.min(a1, b1), mid = (lo + hi) / 2;
        if (Math.abs(a.offAt(mid) - b.offAt(mid)) > 2.5) continue;      // side by side on a passing place
        const desc = (q) => `${q.cfg.id}[d ${q.d} u ${q.u.toFixed(1)} ${q.state} pp ${q.pp ? Math.round(q.pp.s0) + '/' + q.ppTrack : '-'} c ${q.commit}]`;
        if (collide.length < 5) collide.push(`${desc(a)}/${desc(b)} on ${line.key} at ${Math.round(mid)} (t ${Math.round(t)} s)`);
      }
    }
    maxOn = Math.max(maxOn, on);
    for (const line of R.lines) for (const tr of line.trains) if (tr.holdT > longest.t) { longest.t = tr.holdT; longest.who = `${tr.cfg.id} on ${line.key} at ${Math.round(tr.lead)}`; }
  }
  const st = R.stats;
  say(`service, 2 h: ${st.spawns} trains on, ${seen.size} of ${R.fleet.length} ran, up to ${maxOn} out at once; ${st.meets} meets on a passing track, ${st.holds} holds, ${st.rescued} rescued from a stand`);
  say(`longest stand waiting for the road: ${Math.round(longest.t)} s (${longest.who})`);
  if (longest.t > 720) fail.push(`a train stood ${Math.round(longest.t)} s waiting for the road (${longest.who})`);
  say(`calls: ${Object.entries(calls).map(([k, v]) => `${k} ${v}`).join(', ')}`);
  if (collide.length) fail.push(`trains ran into each other: ${collide.join('; ')}`);
  if (seen.size < R.fleet.length) fail.push(`trains that never ran: ${R.fleet.filter((t) => !seen.has(t.cfg.id)).map((t) => t.cfg.id).join(', ')}`);
  if (!calls['go@Kitchener']) fail.push('no GO train called at Kitchener');
  if (!calls['via@Kitchener']) fail.push('no VIA train called at Kitchener');
  for (const nm of ['Waterloo', "Farmer's Market", 'St. Jacobs Village', 'Elmira']) if (!calls[`heritage@${nm}`]) fail.push(`the WCR never called at ${nm}`);
  if (st.rescueLog) say('rescued:\n  ' + st.rescueLog.slice(0, 6).join('\n  '));
  if (st.rescued > 0) fail.push(`${st.rescued} trains had to be rescued from a stand (dispatcher deadlocks)`);

  // --- 2. the crossings ------------------------------------------------------------
  const p = d.player, traffic = d.traffic;
  const picks = [];
  for (const k of ['guelph', 'galt', 'spur']) {
    const cs = R.active.filter((c) => c.line.key === k && c.road && c.road.hw >= 3.5 && !c.spread);
    cs.sort((a, b) => b.road.hw - a.road.hw);
    picks.push(...cs.slice(0, k === 'spur' ? 1 : 2));
  }
  let stopsTotal = 0;
  for (const c of picks) {
    const e = c.road, tr = c.line.tr;
    // you stand 40 m up the road from the crossing, beside it; traffic fills in
    const px = c.x + e.dx * 40 + -e.dz * (e.hw + 4), pz = c.z + e.dz * 40 + e.dx * (e.hw + 4);
    if (p.vehicle && p.exitVehicle) p.exitVehicle();
    p.x = px; p.z = pz; p.y = d.city.groundAt(px, pz, null);
    if (p.position && p.position.set) p.position.set(px, p.y, pz);
    cam.position.x = px; cam.position.z = pz;
    const camDir = { x: -e.dx, z: -e.dz };
    for (let i = 0; i < 300; i++) { traffic.update(0.1, px, pz, camDir, p); R.update(0.1, cam); }
    const t = R.sendTo(c, 900);
    if (!t) { fail.push(`could not send a train to ${e.name}`); continue; }
    const gateD = c.spread / 2 + 4.4;
    const prev = new Map();
    let armMax = 0, stopped = 0, onTrack = 0, ranGate = 0, lightsAt = null, armAt = null, trainAt = null, clearAt = null;
    const stoppedSet = new Set();
    for (let i = 0; i < 2400 && clearAt === null; i++) {
      traffic.update(0.1, px, pz, camDir, p); R.update(0.1, cam);
      const time = i * 0.1;
      if (c.active && lightsAt === null) lightsAt = time;
      if (c.arm > 0.98 && armAt === null) armAt = time;
      armMax = Math.max(armMax, c.arm);
      const ahead = (c.s - t.lead) * t.d, behind = (c.s - t.tail) * t.d;
      const over = ahead <= 0 && behind >= 0;
      if (over && trainAt === null) trainAt = time;
      if (trainAt !== null && !over && behind < 0 && c.arm < 0.02) clearAt = time;
      for (const v of traffic.cars) {
        const dx = v.x - c.x, dz = v.z - c.z;
        if (dx * dx + dz * dz > 60 * 60) continue;
        const perp = Math.abs(dx * Math.cos(c.h) - dz * Math.sin(c.h));      // along the road from the track
        const al = Math.abs(dx * Math.sin(c.h) + dz * Math.cos(c.h));       // along the track
        if (al > e.hw + 3) continue;
        if (over && perp < c.spread / 2 + 2.0) onTrack++;
        const was = prev.get(v);
        if (was !== undefined && c.arm > 0.6 && was > gateD && perp < gateD - 0.3) ranGate++;
        prev.set(v, perp);
        if (c.arm > 0.5 && Math.abs(v.vLong || 0) < 0.5 && perp < 45) stoppedSet.add(v);
      }
    }
    stopped = stoppedSet.size; stopsTotal += stopped;
    say(`${c.line.key} at ${e.name || '?'} (${(e.hw * 2).toFixed(0)} m road, ${c.gate ? 'gates' : 'lights'}): ${t.cfg.name} ${t.cfg.kind}; lights at ${lightsAt === null ? '-' : lightsAt.toFixed(0) + ' s'}, gates down ${armAt === null ? '-' : armAt.toFixed(0) + ' s'}, train on it ${trainAt === null ? '-' : trainAt.toFixed(0) + ' s'}, up again ${clearAt === null ? '-' : clearAt.toFixed(0) + ' s'}; ${stopped} cars held, ${onTrack} car-frames on the track under the train, ${ranGate} ran a lowered gate`);
    if (lightsAt === null || trainAt === null) fail.push(`${e.name}: the train never reached the crossing`);
    if (c.gate && armMax < 0.98) fail.push(`${e.name}: the gates never came down`);
    if (lightsAt !== null && trainAt !== null && trainAt - lightsAt < 15) fail.push(`${e.name}: only ${(trainAt - lightsAt).toFixed(0)} s of warning`);
    if (onTrack) fail.push(`${e.name}: an AI car was on the tracks with the train on the crossing`);
    if (ranGate) fail.push(`${e.name}: ${ranGate} AI cars drove in past a lowered gate`);
  }
  if (!stopsTotal) fail.push('no AI car ever stopped at a crossing');
  out.push(fail.length ? fail.map((f) => 'FAIL: ' + f).join('\n') : 'PASS');
  return out.join('\n');
})()
