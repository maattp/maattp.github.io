// Seats for tools/kw/nightviews.json, after artseat.js (kwshots takes one
// VIEW_PRE_FILE, so put the two in one file first):
//   cat tools/kw/artseat.js tools/kw/nightseat.js > pre.js
//   VIEW_PRE_FILE=pre.js VIEWS=tools/kw/nightviews.json AUTO_GPU=1 node tools/kw/kwshots.mjs <dir>
// __carSeat(street, x, z, ahead, back, up): your own sedan put in traffic's
// lane on that street (artseat's __seat), you in it (so tod.js throws its
// headlamp beam), the camera `back` m behind and `up` m over it looking
// `ahead` m along the street. back 0 is the driver's eye.
window.__carSeat = (street, x, z, ahead = 60, back = 7, up = 2.4, u = 0.75) => {
  const d = window.__dbg;
  const P = window.__seat(street, x, z, u, ahead);
  if (!P) return null;
  const [cx, cz] = P.c;
  const fx = P.t[0] - cx, fz = P.t[1] - cz, fl = Math.hypot(fx, fz);
  const ux = fx / fl, uz = fz / fl, h = Math.atan2(ux, uz);
  let v = window.__nsCar;
  if (!v) {
    v = d.traffic.spawnAt(cx, cz, h, 'sedan', 0x2a3344, 'parked');
    d.player.enterVehicle(v);
    window.__nsCar = v;
  }
  const gy = d.city.groundAt(cx, cz) + 0.02;
  v.x = cx; v.z = cz; v.y = gy; v.heading = h; v.vLong = 0;
  if (v.sync) v.sync();
  const by = back > 0 ? up : 1.15;
  return { c: [cx - ux * back, cz - uz * back, by], t: [cx + ux * ahead, cz + uz * ahead, back > 0 ? 0.6 : 1.0] };
};
