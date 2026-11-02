// Writes tools/kw/calviews.json: kwshots views for kwcalendar.js (the real calendar).
//   node tools/kw/calviews.mjs
//   AUTO_HTTP_PORT=.. AUTO_CDP_PORT=.. AUTO_GPU=1 VIEWS=tools/kw/calviews.json \
//     VIEW_BOOT_JS="window.__calDate='2026-12-10';" node tools/kw/kwshots.mjs <dir> xmas
// (delete /tmp/autokw-shots-profile-<port> between dates is not needed: the date is read at boot, not cached)
// Each view's eval sets the time of day, loads the chunks round the camera and runs the calendar once
// (a paused harness never calls update()).
import { writeFileSync } from 'fs';

const pre = (tod, c, t, h = 3, eye = 1.7) => `(() => { d.tod.choose('${tod}');const c=${JSON.stringify(c)},t=${JSON.stringify(t)};d.camera.position.set(c[0],6,c[1]);d.world.update(c[0],c[1],60);for(let i=0;i<3000;i++){d.world.update(c[0],c[1],60);if(![...d.world.chunks.values()].some((k)=>k.lod!==k.wantLod))break;}d.calendar.dirty=true;d.calendar.update(0.02,d.player,d.camera);return {c:[c[0],c[1],${eye}],t:[t[0],t[1],${h}]} })()`;
const home = [-3614.8, -1581.7], rot = 2.9084;       // a house on a street near Uptown Waterloo (front toward -sin, cos)
const fx = -Math.sin(rot), fz = Math.cos(rot);
const street = (d) => [Math.round(home[0] + fx * d), Math.round(home[1] + fz * d)];
const V = [
  ['xmas-night-street', 'night', street(32), home],
  ['xmas-day-street', 'day', street(32), home],
  ['xmas-cityhall-tree', 'night', [-1440, 108], [-1431, 44], 8, 22],
  ['xmas-cityhall-tree-day', 'day', [-1440, 108], [-1431, 44], 8, 22],
  ['xmas-market', 'night', [-1470, 70], [-1425, 60], 2, 14],
  ['xmas-lamps', 'night', [-3828, -1438], [-3858, -1585], 5, 3],
  ['halloween-night-street', 'night', street(32), home],
  ['halloween-night-close', 'night', street(14), home],
  ['halloween-day-street', 'day', street(32), home],
  ['remembrance-wreath', 'day', [-998, 190], [-998, 199]],
  ['remembrance-wreath-close', 'day', [-1001, 194], [-998, 199]],
].map(([name, tod, c, t, h, eye]) => ({ name, eval: pre(tod, c, t, h, eye) }));
// the first lawn inflatable in the streamed chunks, and a costumed pedestrian (Oct 31)
V.push({ name: 'halloween-inflatable', eval: `(() => { d.tod.choose('night'); const w = d.world; for (let i = 0; i < 3000; i++) { w.update(${home[0]}, ${home[1]}, 60); if (![...w.chunks.values()].some((k) => k.lod !== k.wantLod)) break; }
  const cal = d.calendar; const L = [...cal.infl.values()][0]; d.camera.position.set(L[0], 6, L[2]); cal.dirty = true; cal.update(0.02, d.player, d.camera);
  let best = [L[0] + 7, L[2] + 7]; for (let a = 0; a < 8; a++) { const x = L[0] + Math.cos(a * 0.785) * 7, z = L[2] + Math.sin(a * 0.785) * 7; if (!w.inBuilding(x, z, 1.5)) { best = [x, z]; break; } } return { c: [best[0], best[1], 1.7], t: [L[0], L[2], 1.3] }; })()` });
V.push({ name: 'halloween-costume', eval: `(() => { d.tod.choose('night'); const ps = d.peds.peds.filter((p) => { let f = false; p.h.bones.forEach((b) => b.children.forEach((c) => { if (c.userData && c.userData.costume) f = true; })); return f; });
  const p = ps[0]; if (!p) return null; return { c: [p.x + 1.6, p.z + 1.6, 1.7], t: [p.x, p.z, 1.55] }; })()` });
writeFileSync('tools/kw/calviews.json', JSON.stringify(V, null, 1));
