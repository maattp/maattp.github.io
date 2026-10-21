// Auto KW: the unpaved roads (data/gravel.json, tools/kw/build_gravel.py).
//
// ~135 km of the townships' concession roads and sideroads are gravel in OSM.
// tagGravel() marks every road-graph edge that lies along one (`e.gravel`:
// world.js draws it in gravel's colour, without paint, near and far) and
// gives the city `gravelAt(x, z)`, which your car's tyres ask (vehicles.js
// SURFACES: ~60 % of asphalt's grip, half as far again to stop, a rougher ride,
// and the gravel crunch under the wheels in audio.js).
//
// A 64 m grid of the polylines' segments; a query looks at one cell (each
// segment is filed in every cell its widened box touches).

const CELL = 64;

export function tagGravel(city, data) {
  city.gravelAt = () => false;
  if (!data || !data.w || !data.w.length) return { edges: 0, km: 0 };
  const segs = [];   // x0, z0, x1, z1, hw
  for (const w of data.w) {
    const hw = w[0];
    for (let i = 1; i + 3 < w.length; i += 2) segs.push(w[i], w[i + 1], w[i + 2], w[i + 3], hw);
  }
  const grid = new Map();
  const key = (cx, cz) => cx * 4096 + cz;
  for (let s = 0; s < segs.length; s += 5) {
    const r = segs[s + 4] + 2;
    const cx0 = Math.floor((Math.min(segs[s], segs[s + 2]) - r) / CELL), cx1 = Math.floor((Math.max(segs[s], segs[s + 2]) + r) / CELL);
    const cz0 = Math.floor((Math.min(segs[s + 1], segs[s + 3]) - r) / CELL), cz1 = Math.floor((Math.max(segs[s + 1], segs[s + 3]) + r) / CELL);
    for (let cx = cx0; cx <= cx1; cx++) for (let cz = cz0; cz <= cz1; cz++) {
      const k = key(cx, cz);
      let l = grid.get(k);
      if (!l) grid.set(k, (l = []));
      l.push(s);
    }
  }
  // distance from (x, z) to the nearest gravel centreline, less its half-width
  // (negative inside the carriageway), or Infinity with none in the cell
  const edgeDist = (x, z) => {
    const l = grid.get(key(Math.floor(x / CELL), Math.floor(z / CELL)));
    if (!l) return Infinity;
    let best = Infinity;
    for (const s of l) {
      const ax = segs[s], az = segs[s + 1], dx = segs[s + 2] - ax, dz = segs[s + 3] - az;
      const L2 = dx * dx + dz * dz;
      const t = L2 > 0 ? Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / L2)) : 0;
      const d = Math.hypot(x - ax - dx * t, z - az - dz * t) - segs[s + 4];
      if (d < best) best = d;
    }
    return best;
  };
  // An edge is gravel when its middle and both quarter points lie on one (the
  // graph's edges are the same OSM ways, simplified and split at junctions,
  // so a paved road that merely crosses a gravel one is never tagged).
  let n = 0;
  const N = city.nodes;
  for (const e of city.edges) {
    if (e.elev || e.tunnel || e.prof || e.cls === 'hwy' || e.cls === 'ramp') continue;
    const a = N[e.a], b = N[e.b];
    let on = true;
    for (const t of [0.25, 0.5, 0.75]) {
      if (edgeDist(a.x + (b.x - a.x) * t, a.z + (b.z - a.z) * t) > -e.hw * 0.5) { on = false; break; }
    }
    if (on) { e.gravel = true; n++; }
  }
  // on a gravel carriageway (with a metre's grace for the shoulder)
  city.gravelAt = (x, z) => edgeDist(x, z) < 1;
  return { edges: n, km: data.km };
}
