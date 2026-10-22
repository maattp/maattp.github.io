// Auto KW: kwshots views of every freeway gore (citygen spreadGores' gore
// edges), printed as a VIEWS list: `<route>-<n>-air` from 45 m up behind the
// node and `<route>-<n>-seat` from the right lane 110 m before it.
//   VIEW_PROBE_FILE=tools/kw/goreviews.js node tools/kw/kwshots.mjs /tmp/x | grep '^\[' > views.json
(() => {
  const d = window.__dbg, city = d.city, E = city.edges, N = city.nodes, H = window.__hwy;
  const from = (e) => (e.onewayRev ? e.b : e.a), to = (e) => (e.onewayRev ? e.a : e.b);
  const dir = (e) => (e.onewayRev ? [-e.dx, -e.dz] : [e.dx, e.dz]);
  const out = [], count = {};
  E.forEach((R, ri) => {
    if (!R.gore) return;
    const leaves = R.gore[0] !== 0;
    const ni = leaves ? from(R) : to(R), n = N[ni];
    let U = -1;
    for (const k of n.e) { const e = E[k]; if (e.cls === 'hwy' && e.oneway && to(e) === ni) U = k; }
    if (U < 0) return;
    const info = H.infoOf ? H.infoOf(U) : null;
    const ref = ((info && info.ref) || 'x').replace(/;/g, '_');
    count[ref] = (count[ref] || 0) + 1;
    const nm = `${ref}-${count[ref]}`;
    const [ux, uz] = dir(E[U]), rx = -uz, rz = ux;   // right of travel
    const sd = Math.sign(R.gore[0] || R.gore[1]) || 1;  // the ramp's side, + right
    const ox = rx * sd * 8, oz = rz * sd * 8;
    const at = leaves ? 40 : -40;                    // look where the ramp is beside it
    out.push({ name: nm + '-air', c: [n.x - ux * 30 + ox, n.z - uz * 30 + oz, 45], t: [n.x + ux * at + ox, n.z + uz * at + oz, 0], fov: 60, ei: ri });
    // from 22 m up beside the gore, looking along it, and straight down on it
    const g = leaves ? 1 : -1, sx = rx * sd, sz = rz * sd;
    out.push({ name: nm + '-low', c: [n.x - ux * g * 25 + sx * (E[U].hw + 10), n.z - uz * g * 25 + sz * (E[U].hw + 10), 22], t: [n.x + ux * g * 45 + sx * E[U].hw, n.z + uz * g * 45 + sz * E[U].hw, 0], fov: 60, ei: ri });
    out.push({ name: nm + '-top', c: [n.x + ux * g * 30 + sx * E[U].hw, n.z + uz * g * 30 + sz * E[U].hw, 70], t: [n.x + ux * g * 31 + sx * E[U].hw, n.z + uz * g * 31 + sz * E[U].hw, 0], fov: 55, ei: ri });
    const lane = sd * (E[U].hw - 2.4);
    out.push({ name: nm + '-seat', c: [n.x - ux * 110 + rx * lane, n.z - uz * 110 + rz * lane, 1.4], t: [n.x + ux * 20 + rx * lane * 1.4, n.z + uz * 20 + rz * lane * 1.4, 0.5], fov: 62, ei: ri });
  });
  return JSON.stringify(out);
})()
