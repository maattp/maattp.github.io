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

function ride(sx, sz, hx, hz, speed, frames, label, extra, from = 8, dy = 0.02) {
  const L = Math.hypot(hx, hz), ux = hx / L, uz = hz / L;
  for (const v of [...T.cars]) if (v.mode !== 'apron') T.remove(v);
  p.respawn(sx, sz);
  d.world.update(sx, sz, 2);
  const v = T.spawnAt(sx, sz, 0, TYPE, 0x2244aa, 'free');
  if (!v) return { label, err: 'no ' + TYPE };
  p.enterVehicle(v);
  v.x = sx; v.z = sz; v.heading = Math.atan2(ux, uz); v.vLong = speed; v.vLat = 0;
  v.y = c.groundAt(sx, sz, null) + dy;
  const rec = [];
  let airFlips = 0, lastOn = true, airFrames = 0, maxAcc = 0, prevY = v.y, prevVy = 0, acc30 = 0, acc60 = 0, maxUp = 0;
  for (let f = 0; f < frames; f++) {
    // light throttle (gasAmt 0.4): speed builds from 14 to ~24 m/s down a steep street
    p.update(1 / 60, { x: 0, y: 0, gas: false, gasAmt: 0.4, brakeAmt: 0 }, { x: 0, y: 0 }, d.controls, T, d.peds);
    const vy = (v.y - prevY) * 60, acc = (vy - prevVy) * 60;
    prevY = v.y; prevVy = vy;
    if (f >= from) { const a = Math.abs(acc); maxAcc = Math.max(maxAcc, a); if (a > 30) acc30++; if (a > 60) acc60++; }
    if (o.trace && (!v.onGround || Math.abs(acc) > 30) && rec.length < 80) rec.push([f, +v.vLong.toFixed(1), +(v.y - c.groundAt(v.x, v.z, v.y + 0.45)).toFixed(2), +vy.toFixed(1), Math.round(acc), v.onGround ? '' : 'AIR', +(v.airGap || 0).toFixed(2), +(v.floorVy || 0).toFixed(1), +(v.vy || 0).toFixed(1)]);
    if (v.onGround !== lastOn) { if (!v.onGround && f >= from) airFlips++; lastOn = v.onGround; }
    if (!v.onGround && f >= from) airFrames++;
    maxUp = Math.max(maxUp, v.y - c.groundAt(v.x, v.z, v.y + 0.45));
  }
  const r = { label, frames, airFlips, airFrames, acc30, acc60, maxAcc: Math.round(maxAcc), maxAbove: +maxUp.toFixed(2), endSpeed: +v.vLong.toFixed(1), ...extra, ...(o.trace ? { rec } : {}) };
  p.exitVehicle && p.exitVehicle(true);
  return r;
}

const out = { type: TYPE, hills: [], crests: [], steps: [], synth: [], teleports: [] };
const want = (k) => !o.sections || o.sections.includes(k);
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
for (const k of want('hills') ? sel : []) {
  const e = c.edges[k.i], a = c.nodes[e.a], b = c.nodes[e.b];
  const [hi, lo] = b.y < a.y ? [a, b] : [b, a];
  const dx = lo.x - hi.x, dz = lo.z - hi.z, L = Math.hypot(dx, dz);
  const frames = Math.floor((L - 12) / 14 * 60);
  out.hills.push(ride(hi.x + dx / L * 10, hi.z + dz / L * 10, dx, dz, 14, frames, e.name || e.cls,
    { grade: +k.g.toFixed(3), at: [Math.round(hi.x), Math.round(hi.z)], len: Math.round(L) }));
}
// --- crests taken fast ----------------------------------------------------
if (want('crests'))// the straight-through nodes whose ground, sampled 30 m either side, rises into
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
// --- floor steps on freeways: the data bumps must not launch a car --------
// 24 m/s through each site along the nearest edge, both ways, from 100 m
// before, counting from 1 s in
if (want('steps')) {
  for (const [x, z] of o.stepSites || []) {
    const es = c.edgesNear(x, z, 40).map((i) => c.edges[i]).filter((e) => !e.tunnel);
    if (!es.length) { out.steps.push({ label: 'step', err: 'no edge', at: [x, z] }); continue; }
    es.sort((a, b2) => Math.hypot(x - c.nodes[a.a].x, z - c.nodes[a.a].z) - Math.hypot(x - c.nodes[b2.a].x, z - c.nodes[b2.a].z));
    const e = es[0];
    for (const sg of [1, -1]) {
      const ux = e.dx * sg, uz = e.dz * sg;
      out.steps.push(ride(x - ux * 100, z - uz * 100, ux, uz, 24, Math.floor(170 / 24 * 60), (e.name || e.cls) + (sg > 0 ? ' fwd' : ' rev'),
        { at: [x, z], grade: 0 }, 60));
    }
  }
}
// --- a made-up step in the floor on a flat street --------------------------
// `groundAt` is patched to add `h` m past 80 m along the street, over `w` m. UP
// steps (the I-5 / Aurora / SR-99 data bumps are this) must not launch the car:
// the follow's catch-up is not a climb. A step DOWN is a cliff and must fall.
if (want('synth')) {
  // a straight, flat run of street at least 220 m long: edges chained end to
  // end while the heading holds within 2 degrees (the car steers nowhere)
  let flat = null;
  for (const e0 of c.edges) {
    if (flat) break;
    if (!edgeOk(e0) || !inBox(c.nodes[e0.a]) || Math.abs(gradeOf(e0)) > 0.015) continue;
    let len = e0.len, e = e0, ni = e0.b;
    for (let g = 0; g < 12 && len < 220; g++) {
      const ix = ni === e.b ? e.dx : -e.dx, iz = ni === e.b ? e.dz : -e.dz;
      const nx = c.nodes[ni].e.map((k) => c.edges[k]).find((o) => o !== e && edgeOk(o) && Math.abs(gradeOf(o)) < 0.015
        && (o.a === ni ? o.dx * ix + o.dz * iz : -(o.dx * ix + o.dz * iz)) > 0.9994);
      if (!nx) break;
      len += nx.len; ni = nx.a === ni ? nx.b : nx.a; e = nx;
    }
    if (len >= 220) flat = e0;
  }
  if (flat) {
    const a = c.nodes[flat.a], orig = c.groundAt;
    const ux = flat.dx, uz = flat.dz;
    for (const [h, w] of [[0.7, 0.05], [0.7, 4], [-0.7, 0.05]]) {
      c.groundAt = function (x, z, yr, lift) {
        const g = orig.call(c, x, z, yr, lift);
        const t = Math.min(1, Math.max(0, ((x - a.x) * ux + (z - a.z) * uz - 80) / w));
        return g + h * t * t * (3 - 2 * t);
      };
      try {
        out.synth.push(ride(a.x + ux * 15, a.z + uz * 15, ux, uz, 24, Math.floor(150 / 24 * 60), `flat street, ${h > 0 ? 'up' : 'down'} ${Math.abs(h)} m over ${w} m`,
          { grade: 0, at: [Math.round(a.x), Math.round(a.z)], h }, 30));
      } finally { c.groundAt = orig; }
    }
  }
}
// --- a teleport onto a slope: 2 m under the floor of the steepest street ---
if (want('teleports')) {
  const k = cand.filter((q) => /Genesee/i.test(c.edges[q.i].name || '')).sort((u, v) => Math.abs(v.g) - Math.abs(u.g))[0];
  if (k) {
    const e = c.edges[k.i], a = c.nodes[e.a], b = c.nodes[e.b];
    const [hi, lo] = b.y < a.y ? [a, b] : [b, a];
    const dx = lo.x - hi.x, dz = lo.z - hi.z, L = Math.hypot(dx, dz);
    for (const dy of [-2, 2]) out.teleports.push(ride(hi.x + dx / L * 10, hi.z + dz / L * 10, dx, dz, 14, 90, 'Genesee teleport ' + dy + ' m', { grade: k.g, at: [Math.round(hi.x), Math.round(hi.z)] }, 0, dy));
  }
}
return JSON.stringify(out);
