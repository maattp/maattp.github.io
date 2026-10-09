// Page body for tools/hillride.mjs (evaluated in the game, paused). Rides the
// player's own car through Vehicle.update at a FIXED dt:
//   - the steepest streets of the city, coasting from 14 m/s (a car going DOWN
//     a grade must stay planted on it: no hopping), and
//   - the sharpest crests, taken at 30+ m/s (a car taking a real crest fast
//     must still leave the ground).
// Returns JSON. Options come from window.__HILL = { type, names, nCrest, crestSpeed }.
const o = window.__HILL || {};
const d = window.__dbg, c = d.city, p = d.player, T = d.traffic;
const TYPE = o.type || 'sedan';
const edgeOk = (e) => !(e.tunnel || e.elev || e.cls === 'hwy' || e.cls === 'ramp' || e.len < 40);
const gradeOf = (e) => (c.nodes[e.b].y - c.nodes[e.a].y) / e.len;
const inBox = (n) => Math.abs(n.x) < 9000 && Math.abs(n.z) < 9000;

function ride(sx, sz, hx, hz, speed, frames, label, extra, from = 8) {
  const L = Math.hypot(hx, hz), ux = hx / L, uz = hz / L;
  for (const v of [...T.cars]) if (v.mode !== 'apron') T.remove(v);
  p.respawn(sx, sz);
  d.world.update(sx, sz, 2);
  const v = T.spawnAt(sx, sz, 0, TYPE, 0x2244aa, 'free');
  if (!v) return { label, err: 'no ' + TYPE };
  p.enterVehicle(v);
  v.x = sx; v.z = sz; v.heading = Math.atan2(ux, uz); v.vLong = speed; v.vLat = 0;
  v.y = c.groundAt(sx, sz, null) + 0.02;
  const rec = [];
  let airFlips = 0, lastOn = true, airFrames = 0, maxAcc = 0, prevY = v.y, prevVy = 0, acc30 = 0, acc60 = 0, maxUp = 0;
  for (let f = 0; f < frames; f++) {
    // light throttle (gasAmt 0.4): speed builds from 14 to ~24 m/s down a steep street
    p.update(1 / 60, { x: 0, y: 0, gas: false, gasAmt: 0.4, brakeAmt: 0 }, { x: 0, y: 0 }, d.controls, T, d.peds);
    const vy = (v.y - prevY) * 60, acc = (vy - prevVy) * 60;
    prevY = v.y; prevVy = vy;
    if (f >= from) { const a = Math.abs(acc); maxAcc = Math.max(maxAcc, a); if (a > 30) acc30++; if (a > 60) acc60++; }
    if (o.trace && (!v.onGround || Math.abs(acc) > 30) && rec.length < 80) rec.push([f, +v.vLong.toFixed(1), +(v.y - c.groundAt(v.x, v.z, v.y + 0.45)).toFixed(2), +vy.toFixed(1), Math.round(acc), v.onGround ? '' : 'AIR']);
    if (v.onGround !== lastOn) { if (!v.onGround && f >= from) airFlips++; lastOn = v.onGround; }
    if (!v.onGround && f >= from) airFrames++;
    maxUp = Math.max(maxUp, v.y - c.groundAt(v.x, v.z, v.y + 0.45));
  }
  const r = { label, frames, airFlips, airFrames, acc30, acc60, maxAcc: Math.round(maxAcc), maxAbove: +maxUp.toFixed(2), endSpeed: +v.vLong.toFixed(1), ...extra, ...(o.trace ? { rec } : {}) };
  p.exitVehicle && p.exitVehicle(true);
  return r;
}

const out = { type: TYPE, hills: [], crests: [] };
// --- steep descents -------------------------------------------------------
const cand = [];
c.edges.forEach((e, i) => {
  if (!edgeOk(e) || !inBox(c.nodes[e.a])) return;
  const g = gradeOf(e);
  if (Math.abs(g) > 0.07) cand.push({ i, g });
});
const sel = [];
const names = (o.names || ['Genesee', 'Kenyon']).map((s) => new RegExp(s, 'i'));
for (const re of names) {
  const k = cand.filter((q) => re.test(c.edges[q.i].name || '')).sort((u, v) => Math.abs(v.g) - Math.abs(u.g))[0];
  if (k) sel.push(k);
}
cand.sort((u, v) => Math.abs(v.g) - Math.abs(u.g));
for (const bk of [0.16, 0.13, 0.10, 0.08]) {
  const k = cand.find((q) => Math.abs(q.g) <= bk && !sel.includes(q) && Math.abs(c.nodes[c.edges[q.i].a].x) < 6000);
  if (k) sel.push(k);
}
for (const k of sel) {
  const e = c.edges[k.i], a = c.nodes[e.a], b = c.nodes[e.b];
  const [hi, lo] = b.y < a.y ? [a, b] : [b, a];
  const dx = lo.x - hi.x, dz = lo.z - hi.z, L = Math.hypot(dx, dz);
  const frames = Math.floor((L - 12) / 14 * 60);
  out.hills.push(ride(hi.x + dx / L * 10, hi.z + dz / L * 10, dx, dz, 14, frames, e.name || e.cls,
    { grade: +k.g.toFixed(3), at: [Math.round(hi.x), Math.round(hi.z)], len: Math.round(L) }));
}
// --- crests taken fast ----------------------------------------------------
// the straight-through nodes whose ground, sampled 30 m either side, rises into
// the node and falls away after it by the most; ridden from 100 m before, at
// 32 m/s, counting from 1 s in (a car dropped on a slope has no history)
{
  const cr = [];
  const gnd = (x, z) => c.groundAt(x, z, null);
  for (let ni = 0; ni < c.nodes.length; ni++) {
    const n = c.nodes[ni];
    if (!inBox(n) || n.elev || n.e.length !== 2) continue;
    const es = n.e.map((k) => c.edges[k]);
    if (!es.every(edgeOk)) continue;
    const ax = c.nodes[es[0].b === ni ? es[0].a : es[0].b], bx = c.nodes[es[1].b === ni ? es[1].a : es[1].b];
    const h1 = Math.atan2(n.x - ax.x, n.z - ax.z), h2 = Math.atan2(bx.x - n.x, bx.z - n.z);
    if (Math.abs(Math.atan2(Math.sin(h1 - h2), Math.cos(h1 - h2))) > 0.2) continue;
    const ux = Math.sin(h1), uz = Math.cos(h1);
    const g0 = gnd(n.x, n.z), gb = gnd(n.x - ux * 30, n.z - uz * 30), gf = gnd(n.x + ux * 30, n.z + uz * 30);
    const gin = (g0 - gb) / 30, gout = (gf - g0) / 30;
    if (gin > 0.03 && gout < -0.03) cr.push({ n, ux, uz, gin, gout, s: gin - gout });
  }
  cr.sort((u, v) => v.s - u.s);
  const used = new Set();
  const spd = o.crestSpeed || 32;
  for (const k of cr) {
    const key = Math.round(k.n.x / 400) + ',' + Math.round(k.n.z / 400);
    if (used.has(key)) continue; used.add(key);
    out.crests.push(ride(k.n.x - k.ux * 100, k.n.z - k.uz * 100, k.ux, k.uz, spd, Math.floor(170 / spd * 60), 'crest',
      { gin: +k.gin.toFixed(3), gout: +k.gout.toFixed(3), at: [Math.round(k.n.x), Math.round(k.n.z)] }, 60));
    if (out.crests.length >= (o.nCrest || 8)) break;
  }
}
return JSON.stringify(out);
