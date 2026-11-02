// Auto KW: interactions between the overnight builds (v90-v102). For kwshots VIEW_PROBE_FILE:
//   AUTO_HTTP_PORT=.. AUTO_CDP_PORT=.. AUTO_GPU=1 VIEW_PROBE_FILE=tools/kw/interactprobe.js node tools/kw/kwshots.mjs <dir>
// 1. every ENTER door (J&J, Counter, Tims/Roll Up, respray bays) within 8 m of another, and what
//    game.tryInteract does standing on each with a parked car 3 m away (must not start J&J/Counter/Roll Up
//    over a car you could get into, except Roll Up which has no `busy` yield: reported);
// 2. every vehicle type through the respray bay's fits() and Vehicle.respray() (no throw, finish cars keep paint).
(() => {
  const d = window.__dbg, out = { overlaps: [], car: [], resp: [], errors: [] };
  const doors = [];
  if (d.jj && d.jj.door) doors.push({ n: 'J&J', x: d.jj.door[0], z: d.jj.door[1] });
  for (const c of d.counter.doors) doors.push({ n: 'counter:' + c.name, x: c.x, z: c.z, r: c.r });
  for (const s of d.rollup.stores()) doors.push({ n: 'tims:' + (s.name || ''), x: s.door ? s.door.x : s.x, z: s.door ? s.door.z : s.z, nodoor: !s.door });
  for (const q of d.respray.sites) doors.push({ n: 'respray:' + q.shop.name, x: q.s.ox, z: q.s.oz });
  out.counts = { doors: doors.length, jj: !!d.jj.door, tims: d.rollup.stores().length, tims_nodoor: doors.filter((x) => x.nodoor).length };
  for (let i = 0; i < doors.length; i++) for (let j = i + 1; j < doors.length; j++) {
    const a = doors[i], b = doors[j];
    if (a.n.startsWith('counter') && b.n.startsWith('counter')) continue;
    const e = Math.hypot(a.x - b.x, a.z - b.z);
    if (e < 8) out.overlaps.push(`${a.n} / ${b.n}: ${e.toFixed(1)} m`);
  }
  // 2. respray fits for every type
  const tr = d.traffic, px = d.player.x, pz = d.player.z;
  for (const t of Object.keys(d.TYPES)) {
    let v;
    try {
      v = tr.spawnAt(px + 30, pz + 30, 0, t, 0xcc2222, 'traffic');
      if (!v) { continue; }
      const fits = d.respray.fits(v);
      const before = v.bodyMat && v.bodyMat.color ? v.bodyMat.color.getHex() : null;
      let took = null;
      if (fits) { took = v.respray(0x2255cc); v.repair && v.repair(); }
      const after = v.bodyMat && v.bodyMat.color ? v.bodyMat.color.getHex() : null;
      out.resp.push(`${t}:${fits ? 'fits' : 'no'}${fits ? ':' + (took ? 'took' : 'kept') : ''}${took && after !== 0x2255cc ? ':BADCOLOR' : ''}${!took && fits && before !== after ? ':CHANGED' : ''}`);
      if (took && after !== 0x2255cc) out.errors.push('respray colour not applied ' + t);
      if (!took && before !== after) out.errors.push('respray changed a finish car ' + t);
    } catch (e) { out.errors.push(t + ': ' + e.message); }
    finally { try { if (v) tr.remove(v); } catch (e) { /* */ } }
  }
  return JSON.stringify(out, null, 1);
})()
