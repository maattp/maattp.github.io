// Auto KW: the vehicle lamps at a traffic site, framed from a driver's seat
// (vehicles.js tagLamps, traffic.js updateLamps). A VIEW_PRE file for
// kwshots: it defines window.__lamp(site), which a view's `eval` calls.
//
//   VIEWS=tools/kw/lampviews.json VIEW_PRE_FILE=tools/kw/lampsite.js \
//     AUTO_GPU=1 node tools/kw/kwshots.mjs <dir>
//
// At the site, as trafficbench.js does it: the population cleared, the
// streamer settled, every random source pinned (Math.random, traffic.R, the
// signals' clock, the spawn counter), a fixed culling camera, and traffic
// stepped `warm` times at 1/60 s with a stand-in player there. Then it steps
// on until a car fits `pick`, judged from the DRIVING state only (so master,
// which has no lamps, picks the same car and frames the same view):
//   red   the last car of a queue of 3+ held at a signal (followed back
//         through v.lead), framed from 7 m behind it at a driver's eye height,
//         a little left so the queue shows
//   left  a car 6-50 m short of a planned left (nextTurn), under 6 m/s,
//         framed from behind and to the right
//   lane  a car changing lanes on a freeway (lcShift), framed from 9 m back
// The lamps' blink is then put in its lit half (visual only: traffic._lampT),
// and the game stays paused while kwshots takes the shot.
// `types`: only those vehicle types (a sedan's rear amber lens shows a left
// signal in a still where a red-only cluster cannot). `r`: how far from the
// site (m; the lamps are lit within 260 m of the stand-in player there).
// Returns { c, t, fov } for kwshots; window.__lampInfo says what it found.
window.__lamp = function (site) {
  const d = window.__dbg, T = d.traffic, c = d.city;
  const mk = (seed) => { let a = seed >>> 0; return function () { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; };
  const k = site.seed || 0;
  for (const v of [...T.cars]) if (v.mode !== 'apron') T.remove(v);
  T.parkedSlots.clear();
  T.link = null; T.freight = null; T.streetcars = null;
  d.game.wanted = 0;
  const pend = () => [...d.world.chunks.values()].filter((q) => q.lod !== q.wantLod).length;
  for (let i = 0; i < 20000 && (i < 6 || pend() > 0); i++) d.world.update(site.x, site.z, 2);
  for (let i = 0; i < 300; i++) d.world.update(site.x, site.z, 2);
  T._kerb = null; T._lotKey = null;
  const f = mk(99 + k);
  T.R = { f, n: () => f(), range: (a, b) => a + (b - a) * f(), int: (a, b) => Math.min(b, a + Math.floor(f() * (b - a + 1))), pick: (arr) => arr[Math.min(arr.length - 1, Math.floor(f() * arr.length))], chance: (p) => f() < p, sign: () => (f() < 0.5 ? -1 : 1) };
  Math.random = mk(12345 + k);
  if (c.jc) c.jc.t = 0;
  T.spawnTimer = 0; T._tick = 0; T.copTimer = 0; T.crossN = 0;
  T._prio = 100000 * (k + 1);
  const cam0 = T.camera;
  const cam = new d.THREE.PerspectiveCamera(62, 874 / 402, 0.5, 4000);
  const gy0 = d.G.terrainHeight(site.x, site.z);
  cam.position.set(site.x - 40, gy0 + 25, site.z - 40);
  cam.lookAt(site.x + 60, gy0, site.z + 60);
  cam.updateMatrixWorld(true);
  T.camera = cam;
  const P = { vehicle: null, onFoot: false, x: site.x, y: 0, z: site.z, speed: 0, heading: 0 };
  const dt = 1 / 60;
  let n = 0;
  const step = () => { const ang = n * dt * 0.2; T.update(dt, site.x, site.z, { x: Math.sin(ang), z: Math.cos(ang) }, P); n++; };
  for (let i = 0; i < (site.warm || 1200); i++) step();
  const near = (v, r) => (v.x - site.x) ** 2 + (v.z - site.z) ** 2 < r * r;
  const traffic = () => T.cars.filter((v) => v.mode === 'traffic' && v.rt && v.rtN && near(v, site.r || 220)
    && (!site.types || site.types.includes(v.typeName)));
  const find = () => {
    if (site.pick === 'red') {
      for (const a of traffic()) {
        if (!a.ctlHold || Math.abs(a.vLong) > 0.3) continue;
        // the queue behind it: cars whose leader chain ends at a
        let last = a, len = 1;
        for (let guard = 0; guard < 8; guard++) {
          const b = T.cars.find((o) => o.lead === last && o.mode === 'traffic' && Math.abs(o.vLong) < 0.5);
          if (!b) break;
          last = b; len++;
        }
        if (len >= (site.queue || 3)) return { car: last, head: a, len };
      }
    } else if (site.pick === 'left') {
      for (const v of traffic()) {
        if (Math.abs(v.vLong) > 6 || T.fwy[v.edge]) continue;
        const rt = v.rt, s0 = (v.x - rt[4]) * rt[6] + (v.z - rt[5]) * rt[7];
        const nt = T.nextTurn(v, s0);
        if (nt && nt.mv === 'L' && nt.d < 50 && nt.d > 6) return { car: v, d: nt.d };
      }
    } else if (site.pick === 'lane') {
      for (const v of traffic()) {
        if (!T.fwy[v.edge] || !v.lcShift || Math.abs(v.lcShift) < 1.2 || v.vLong < 15) continue;
        return { car: v, shift: v.lcShift };
      }
    }
    return null;
  };
  let hit = null;
  for (let i = 0; i < (site.more || 3600) && !(hit = find()); i++) step();
  T.camera = cam0;
  if (!hit) {
    window.__lampInfo = { site: site.name, found: false, steps: n };
    return { c: [site.x - 30, site.z - 30, 20], t: [site.x, site.z, 0], fov: 60 };
  }
  const v = hit.car;
  // the blink in its lit half (only on a build with lamps)
  if (T.updateLamps && v._lamp) {
    T._lampT = (((0.12 - v._lamp.ph) % 0.7) + 0.7) % 0.7 + 7;
    T.updateLamps(0, site.x, site.z, P);
  }
  window.__lampInfo = { site: site.name, found: true, steps: n, type: v.typeName, x: +v.x.toFixed(1), z: +v.z.toFixed(1), v: +v.vLong.toFixed(2),
    lampBits: v.lampBits, len: hit.len, d: hit.d, shift: hit.shift };
  const fx = Math.sin(v.heading), fz = Math.cos(v.heading);
  // right of travel is (-fz, fx)
  const back = v.halfLen + (site.back || (site.pick === 'lane' ? 9 : 7)), side = site.side != null ? site.side : site.pick === 'left' ? 1.6 : site.pick === 'red' ? -1.2 : 0;
  const cx = v.x - fx * back - fz * side, cz = v.z - fz * back + fx * side;
  const tx = v.x + fx * (site.ahead || 12), tz = v.z + fz * (site.ahead || 12);
  // heights over the ground under each point: a deck counts (groundAt with the car's own y)
  const gy = (x, z) => Math.max(0, d.city.groundAt(x, z, null));
  const eye = (v.y + (site.eye || 1.25)) - gy(cx, cz), at = (v.y + 0.9) - gy(tx, tz);
  return { c: [cx, cz, eye], t: [tx, tz, at], fov: site.fov || 55 };
};
