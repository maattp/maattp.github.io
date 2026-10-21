// A driver's-seat camera on a named street, for kwshots.mjs views (the
// arterials pass; docs/arterial-*.jpg). Load it before the shots:
//
//   VIEW_PRE="$(cat tools/kw/artseat.js)" VIEWS=tools/kw/arterialviews.json \
//     AUTO_GPU=1 node tools/kw/kwshots.mjs <dir>
//
// A view's eval is `__seat(street, x, z, u, ahead, rev)`: the edge of that
// name nearest (x, z), driven its legal way (a two-way one a -> b, or b -> a
// with rev), the camera 1.25 m up in traffic's own lane `u` (traffic.js
// laneLatU: the lane a car with that lane fraction drives), looking `ahead`
// metres along it. Returns { c, t } for kwshots to frame.
window.__seat = (street, px, pz, u = 0.75, ahead = 70, rev = false, up = 1.25, tup = up + 0.1) => {
  const d = window.__dbg, c = d.city, T = d.traffic;
  let best = -1, bd = 1e9;
  for (const ei of c.roadsNear(px, pz, 120, false)) {
    const e = c.edges[ei];
    if (!e.name || !e.name.includes(street)) continue;
    const a = c.nodes[e.a], b = c.nodes[e.b], vx = b.x - a.x, vz = b.z - a.z, L2 = vx * vx + vz * vz;
    const t = Math.max(0, Math.min(1, ((px - a.x) * vx + (pz - a.z) * vz) / L2));
    const dd = Math.hypot(a.x + vx * t - px, a.z + vz * t - pz);
    if (dd < bd) { bd = dd; best = ei; }
  }
  if (best < 0) return null;
  const e = c.edges[best], a = c.nodes[e.a], b = c.nodes[e.b];
  const f = T.flow[best];
  const sign = f !== 0 ? f : rev ? -1 : 1;
  const vx = b.x - a.x, vz = b.z - a.z, L2 = vx * vx + vz * vz, L = Math.sqrt(L2);
  const t = Math.max(0, Math.min(1, ((px - a.x) * vx + (pz - a.z) * vz) / L2));
  const ux = (vx / L) * sign, uz = (vz / L) * sign;
  const off = T.laneLatU(best, sign, u);           // to the right of travel
  const cx = a.x + vx * t - uz * off, cz = a.z + vz * t + ux * off;
  window.__seatEdge = best;
  return { c: [cx, cz, up], t: [cx + ux * ahead, cz + uz * ahead, tup] };
};
