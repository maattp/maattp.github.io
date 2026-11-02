// Auto KW, "more car variety": proves the new types are real. For kwshots
// VIEW_PROBE_FILE:
//   AUTO_HTTP_PORT=.. AUTO_CDP_PORT=.. AUTO_GPU=1 VIEW_PROBE_FILE=tools/kw/varietyprobe.js node tools/kw/kwshots.mjs <dir>
// 1. every new type's geometry: no NaN, wheels stand on y = 0 (wheel centre y == radius),
//    far LOD and far-far LOD exist with triangles;
// 2. the spawn mix: 4000 spawnTraffic draws in clear weather, then 4000 in snow (the plough
//    must appear only in the snow run), counted per type;
// 3. every new type spawned and driven for 120 fixed frames: finite state, still on the ground.
(async () => {
  const d = window.__dbg;
  const NEW = ['smart', 'volvo', 'lifted', 'farmtruck', 'limo', 'hearse', 'delorean', 'icecream', 'snowplow', 'amzvan', 'zamboni'];
  const out = { geo: {}, mix: {}, drive: {}, errors: [] };
  const V = await import(new URL('./src/vehicles.js', document.baseURI).href.replace(/\?.*$/, '') + (window.__vq || ''));
  const A = V.vehicleAssets();
  for (const t of NEW) {
    const T = A.types[t];
    if (!T) { out.errors.push('no type ' + t); continue; }
    let nan = 0, tris = 0;
    for (const g of ['paintGeo', 'trimGeo', 'matteGeoWE']) {
      const geo = T[g]; if (!geo) continue;
      const p = geo.attributes.position.array;
      for (let i = 0; i < p.length; i++) if (!Number.isFinite(p[i])) nan++;
      tris += geo.index.count / 3;
    }
    const off = T.wheels.map((w) => +(w[1] - T.spec.wheelR).toFixed(3));
    const far = V.farLod(t), far2 = V.farLod2(t);
    out.geo[t] = { nan, tris, wheels: T.wheels.length, wheelOff: Math.max(...off.map(Math.abs)), far: far.geo.index.count / 3, far2: far2.geo.index.count / 3 };
    if (nan || Math.max(...off.map(Math.abs)) > 0.01 || !far.geo.index.count) out.errors.push('bad ' + t);
  }
  const tr = d.traffic, px = d.player.x ?? 0, pz = d.player.z ?? 0;
  const run = (n) => {
    const m = {};
    for (let i = 0; i < n; i++) {
      const v = tr.spawnTraffic(px, pz, null);
      if (v) { m[v.typeName] = (m[v.typeName] || 0) + 1; tr.remove(v); }
    }
    return m;
  };
  out.mix.clear = run(4000);
  if (d.weather) { d.weather.set('snow', true); }
  out.mix.snow = run(4000);
  if (d.weather) d.weather.set('clear', true);
  const keep = (m) => Object.fromEntries(NEW.map((t) => [t, m[t] || 0]));
  out.mixNew = { clear: keep(out.mix.clear), snow: keep(out.mix.snow) };
  delete out.mix;
  // drive each type: spawn at the player, stepped as traffic
  for (const t of NEW) {
    const v = tr.spawnAt(px + 20, pz + 20, 0, t, 0xf2f3f1, 'traffic');
    let ok = true;
    for (let i = 0; i < 120; i++) {
      try { v.update(1 / 60, { gas: 0.6, steer: 0.1, brake: 0 }); } catch (e) { out.errors.push(t + ': ' + e.message); ok = false; break; }
    }
    const fin = [v.x, v.y, v.z, v.speed ?? 0].every(Number.isFinite);
    out.drive[t] = { fin, ok };
    if (!fin) out.errors.push('nonfinite ' + t);
    tr.remove(v);
  }
  return out;
})()
