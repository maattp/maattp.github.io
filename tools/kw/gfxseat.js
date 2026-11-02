// Seats for tools/kw/gfxviews.json (the graphics pass; docs/gfx-*.jpg), after
// artseat.js and nightseat.js (kwshots takes one VIEW_PRE_FILE):
//   cat tools/kw/artseat.js tools/kw/nightseat.js tools/kw/gfxseat.js > pre.js
//   VIEW_PRE_FILE=pre.js VIEWS=tools/kw/gfxviews.json AUTO_GPU=1 node tools/kw/kwshots.mjs <dir>
// __carClose(street, x, z): your sedan in the lane (nightseat's __carSeat), the
// camera a few metres off its front quarter, low, looking at the paint.
window.__carClose = (street, x, z, side = 4.5, fwd = 3.5, up = 1.6) => {
  const P = window.__carSeat(street, x, z, 70, 7, 2.4);
  if (!P) return null;
  const v = window.__nsCar;
  const ux = Math.sin(v.heading), uz = Math.cos(v.heading);
  return { c: [v.x + uz * side + ux * fwd, v.z - ux * side + uz * fwd, up], t: [v.x, v.z, 0.7], fov: 50 };
};
