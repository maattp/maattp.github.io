// LINK LIGHT RAIL: the 1 Line across the whole map -- from the Lynnwood
// extension at the north edge, over the Northgate guideway, 13 km of bored
// tunnel under Roosevelt, the U District, the Montlake Cut, Capitol Hill and
// downtown's transit tunnel, out at International District, down the SODO
// busway, up through Beacon Hill, over Mount Baker, down the middle of Martin
// Luther King Jr Way and up onto the guideway toward Tukwila at the south
// edge. Both tracks, all sixteen stations, and a service of four-car trains
// you can board at any station and drive.
//
// WHERE THE NUMBERS COME FROM. The route, its tunnels and bridges and the
// stations are OpenStreetMap's (data/link.json, tools/build_link.py). The rest
// is published, and each figure names its source:
//   [ST]  Sound Transit, Link light rail facts and system description
//   [S70] Siemens Mobility, S700/S70 low-floor LRV data sheets (Link Series 2)
//   [WP]  Wikipedia, "1 Line (Sound Transit)", "Link light rail"
//   est.  no source publishes it; what it was set from is said
//
//   car           95 ft (28.9 m) long, 8 ft 8 in (2.65 m) wide, three sections
//                 on three bogies, a cab at each end [S70][ST]
//   floor         14 in (0.36 m) over the rail, level with the platforms [ST]
//   trains        up to four cars; platforms 380 ft (116 m) [ST]
//   speed         55 mph (24.6 m/s) top; 35 mph in MLK Jr Way's median [ST][WP]
//   acceleration  ~3 mph/s (1.34 m/s2) [S70]; brake about the same in service,
//                 emergency ~5 mph/s (2.2 m/s2) [S70]
//   gauge         4 ft 8.5 in, overhead catenary at 1500 V DC [ST]
//   tunnels       twin bored tubes; the downtown transit tunnel is one box
//                 [WP] -- here every track has its own box section (est.)
//
// Track parameter s runs along each track from its NORTH end (s = 0, at the
// map edge) to its south end. Trains keep right: `sb` is the western track and
// runs toward +s, `nb` the eastern toward -s. A train's local frame has +z
// toward +s and y = 0 on the rail head.

import * as THREE from './three.js';
import * as G from './geo.js';
import { Builder } from './build.js';
import { GLASS, tagGlass, vehicleAssets } from './vehicles.js';
import { clamp, angleWrap } from './util.js';

export const LINK = {
  gauge: 1.435,
  lift: 0.62,            // rail head over the smoothed ground at grade: the bed stands clear of the
                         // road surface (+0.30) beside it, as MLK Jr Way's raised trackway does (est.)
  liftX: 0.36,           // ...and at a level crossing, flush with the road
  deck: 8.5,             // rail head over the ground on the elevated guideway (est.)
  cover: 7.8,            // a bored track's rail head at least this far under the ground (est.)
  grade: 0.055,          // steepest grade the profile may take (Link's steepest are ~5.5 %, est.)
  boreW: 3.1,            // box half-width inside (est.)
  boreH: 5.4,            // box height inside over the rail head (est.)
  roofOut: 6.0,          // top of the box's roof slab over the rail head
  wire: 5.0,             // contact wire over the rail head (est.)
  platH: 0.36,           // platform over the rail head [ST]
  platLen: 124,          // platform length: 380 ft and the ramps (est.)
  carLen: 28.9, cars: 4, couple: 0.8, secA: 11.8, secC: 4.4,
  wid: 2.65, roof: 3.66,
  vMax: 24.6, vStreet: 15.6,
  acc: 1.3, brake: 1.3, brakeEmerg: 2.2,
  aLat: 1.0,             // unbalanced lateral acceleration in service (est.)
  dwell: 20,             // seconds at a platform (est.; ST schedules ~20-30)
  perTrack: 14,          // trains on each track (~2.3 km apart: 3-4 min headways)
};
LINK.len = LINK.cars * LINK.carLen + (LINK.cars - 1) * LINK.couple;

// The twelve sections of a train, [z0, z1] in its local frame: per car the
// long A section, the short centre C and the long B section.
const SECTIONS = (() => {
  const out = [];
  for (let c = 0; c < LINK.cars; c++) {
    const zc = -LINK.len / 2 + LINK.carLen / 2 + c * (LINK.carLen + LINK.couple), h = LINK.carLen / 2;
    out.push([zc - h, zc - h + LINK.secA], [zc - LINK.secC / 2, zc + LINK.secC / 2], [zc + h - LINK.secA, zc + h]);
  }
  return out;
})();

const STEP = 1;
const ON_PHONE = typeof navigator !== 'undefined' && /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
// how far each part is drawn: the structure, the ballast bed, the near
// detail (rails, wires, poles), the boards, a train (a phone draws less)
const RANGE = ON_PHONE ? { flat: 1900, bed: 900, near: 380, sign: 500, train: 1000 }
  : { flat: 2800, bed: 1500, near: 600, sign: 700, train: 1600 };
const TUN = 1, BOX = 2, DECK = 3, FILL = 4, CROSS = 5;

function boxAvg(a, r) {
  const n = a.length, out = new Float64Array(n), c = new Float64Array(n + 1);
  for (let i = 0; i < n; i++) c[i + 1] = c[i] + a[i];
  for (let i = 0; i < n; i++) {
    const i0 = Math.max(0, i - r), i1 = Math.min(n - 1, i + r);
    out[i] = (c[i1 + 1] - c[i0]) / (i1 - i0 + 1);
  }
  return out;
}
function dilate(a, r) {
  const n = a.length, out = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    let m = -Infinity;
    for (let j = Math.max(0, i - r); j <= Math.min(n - 1, i + r); j++) if (a[j] > m) m = a[j];
    out[i] = m;
  }
  return out;
}
function erode(a, r) {
  const n = a.length, out = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    let m = Infinity;
    for (let j = Math.max(0, i - r); j <= Math.min(n - 1, i + r); j += 2) if (a[j] < m) m = a[j];
    out[i] = m;
  }
  return out;
}

// ---------------------------------------------------------------------------
// A track: the OSM line smoothed, resampled every metre, with its structure
// flag (tunnel / bridge / ground), height profile and speed limits.

export class LinkTrack {
  constructor(key, raw) {
    this.key = key;
    this.dir = key === 'sb' ? 1 : -1;       // direction of travel along s
    // Chaikin corner-cutting, twice, endpoints kept. A point's flag is the
    // flag of the way it came from, which build_link.py writes on the END
    // point of each segment.
    let p = raw.map((q) => [q[0], q[1], q[2] || 0]);
    for (let it = 0; it < 2; it++) {
      const o = [p[0]];
      for (let i = 0; i < p.length - 1; i++) {
        const a = p[i], b = p[i + 1];
        if (i > 0) o.push([a[0] * 0.75 + b[0] * 0.25, a[1] * 0.75 + b[1] * 0.25, b[2]]);
        if (i < p.length - 2) o.push([a[0] * 0.25 + b[0] * 0.75, a[1] * 0.25 + b[1] * 0.75, b[2]]);
      }
      o.push(p[p.length - 1]);
      p = o;
    }
    const cum = [0];
    for (let i = 1; i < p.length; i++) cum.push(cum[i - 1] + Math.hypot(p[i][0] - p[i - 1][0], p[i][1] - p[i - 1][1]));
    this.len = cum[cum.length - 1];
    const n = Math.floor(this.len / STEP) + 1;
    this.n = n;
    this.X = new Float64Array(n); this.Z = new Float64Array(n); this.F = new Uint8Array(n);
    let j = 0;
    for (let i = 0; i < n; i++) {
      const s = Math.min(this.len, i * STEP);
      while (j < p.length - 2 && cum[j + 1] < s) j++;
      const t = (s - cum[j]) / Math.max(1e-9, cum[j + 1] - cum[j]);
      this.X[i] = p[j][0] + (p[j + 1][0] - p[j][0]) * t;
      this.Z[i] = p[j][1] + (p[j + 1][1] - p[j][1]) * t;
      this.F[i] = p[j + 1][2];
    }
    // A short "tunnel" is the track passing under something at its own level
    // -- a freeway's ramps, a plaza (the 45 and 224 m pieces south of
    // International District): not a bore to dive into.
    for (let i = 0; i < n;) {
      let k = i;
      while (k < n && this.F[k] === this.F[i]) k++;
      if (this.F[i] === 1 && k - i < 400) this.F.fill(0, i, k);
      i = k;
    }
    this.H = new Float64Array(n); this.K = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      const a = Math.max(0, i - 2), b = Math.min(n - 1, i + 2);
      this.H[i] = Math.atan2(this.X[b] - this.X[a], this.Z[b] - this.Z[a]);
    }
    for (let i = 0; i < n; i++) {
      const a = Math.max(0, i - 12), b = Math.min(n - 1, i + 12);
      this.K[i] = b > a ? angleWrap(this.H[b] - this.H[a]) / ((b - a) * STEP) : 0;
    }
    // nearest-point grid: 64 m cells listing every 4th sample within reach
    this.cells = new Map();
    for (let i = 0; i < n; i += 4) {
      const cx = Math.floor(this.X[i] / 64), cz = Math.floor(this.Z[i] / 64);
      for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) {
        const k = (cx + dx) * 100003 + (cz + dz);
        let l = this.cells.get(k);
        if (!l) this.cells.set(k, (l = []));
        l.push(i);
      }
    }
    this.Y = null;
  }

  _i(s) {
    const f = clamp(s, 0, this.len) / STEP;
    const i = Math.min(this.n - 2, Math.floor(f));
    return [i, f - i];
  }
  x(s) { const [i, t] = this._i(s); return this.X[i] + (this.X[i + 1] - this.X[i]) * t; }
  z(s) { const [i, t] = this._i(s); return this.Z[i] + (this.Z[i + 1] - this.Z[i]) * t; }
  y(s) { const [i, t] = this._i(s); return this.Y[i] + (this.Y[i + 1] - this.Y[i]) * t; }
  heading(s) { const [i, t] = this._i(s); return this.H[i] + angleWrap(this.H[i + 1] - this.H[i]) * t; }
  curv(s) { const [i, t] = this._i(s); return this.K[i] + (this.K[i + 1] - this.K[i]) * t; }
  idx(s) { return Math.round(clamp(s, 0, this.len) / STEP); }
  flag(s) { return this.F[this.idx(s)]; }
  kind(s) { return this.KD ? this.KD[this.idx(s)] : FILL; }
  ground(s) { return this.GR[this.idx(s)]; }

  /** Nearest sample to (x, z) within `maxD` (null past it): { s, d, side } --
   *  side +1 when the point is to the track's left (facing +s). */
  nearest(x, z, maxD = 60) {
    const l = this.cells.get(Math.floor(x / 64) * 100003 + Math.floor(z / 64));
    if (!l) return null;
    let best = -1, bd = maxD * maxD + 64;
    for (let q = 0; q < l.length; q++) {
      const i = l[q], d = (this.X[i] - x) ** 2 + (this.Z[i] - z) ** 2;
      if (d < bd) { bd = d; best = i; }
    }
    if (best < 0) return null;
    for (let i = Math.max(0, best - 4); i <= Math.min(this.n - 1, best + 4); i++) {
      const d = (this.X[i] - x) ** 2 + (this.Z[i] - z) ** 2;
      if (d < bd) { bd = d; best = i; }
    }
    const d = Math.sqrt(bd);
    if (d > maxD) return null;
    const h = this.H[best];
    const side = (x - this.X[best]) * Math.cos(h) - (z - this.Z[best]) * Math.sin(h) >= 0 ? 1 : -1;
    return { s: best * STEP, d, side };
  }

  /**
   * The rail-head profile. At grade it follows the ground (smoothed so it is
   * never under it); on a bridge it climbs to the guideway at the ruling
   * grade; in a bore it dives to its cover at the same grade -- where the
   * grade cannot get it under the ground in time, the box it runs in stands
   * above the ground as a covered approach, which is what a portal is.
   * Stations are level. `zones`: [[s0, s1, kindHint]].
   */
  setHeights(zones, crossing) {
    const n = this.n, g = LINK.grade;
    const gr = new Float64Array(n);
    for (let i = 0; i < n; i++) gr[i] = G.terrainHeight(this.X[i], this.Z[i]);
    this.GR = gr;
    const ga = boxAvg(dilate(gr, 4), 6);
    const cov = erode(gr, 30);
    const lo = new Float64Array(n), hi = new Float64Array(n), tg = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      const f = this.F[i];
      if (f === 1) { hi[i] = cov[i] - LINK.cover; lo[i] = hi[i] - 90; tg[i] = cov[i] - LINK.cover - 6; }
      else if (f === 2) { lo[i] = ga[i] + LINK.lift; hi[i] = ga[i] + LINK.deck; tg[i] = hi[i]; }
      else { lo[i] = hi[i] = tg[i] = ga[i] + (crossing && crossing[i] ? LINK.liftX : LINK.lift); }
    }
    for (const z of zones) {
      const [s0, s1] = z;
      const i0 = Math.max(0, Math.floor(s0)), i1 = Math.min(n - 1, Math.ceil(s1));
      const f = this.F[Math.round((i0 + i1) / 2)];
      if (f === 0) continue;
      let y;
      if (z[2] !== undefined) y = z[2];
      else if (f === 1) { y = Infinity; for (let i = i0; i <= i1; i++) y = Math.min(y, hi[i]); y -= 2; }
      else { y = 0; for (let i = i0; i <= i1; i++) y += tg[i]; y /= (i1 - i0 + 1); }
      z.level = y;
      for (let i = i0; i <= i1; i++) lo[i] = hi[i] = tg[i] = y;
    }
    // Lipschitz envelopes: U the highest profile under every `hi`, L the
    // lowest over every `lo`, both at the ruling grade. Where they cross the
    // grade wins (L): a bore that cannot get deep enough in time runs higher.
    const U = Float64Array.from(hi), L = Float64Array.from(lo);
    for (let i = 1; i < n; i++) U[i] = Math.min(U[i], U[i - 1] + g);
    for (let i = n - 2; i >= 0; i--) U[i] = Math.min(U[i], U[i + 1] + g);
    for (let i = 1; i < n; i++) L[i] = Math.max(L[i], L[i - 1] - g);
    for (let i = n - 2; i >= 0; i--) L[i] = Math.max(L[i], L[i + 1] - g);
    const fit = (a) => { for (let i = 0; i < n; i++) a[i] = L[i] > U[i] ? L[i] : clamp(a[i], L[i], U[i]); return a; };
    // The first fit follows `tg`, which is as rough as the ground; lowering
    // its peaks to the ruling grade (never under L) makes it a profile a
    // train can ride, and the smoothing after that keeps it one.
    let y = fit(Float64Array.from(tg));
    for (let i = 1; i < n; i++) y[i] = Math.min(y[i], y[i - 1] + g);
    for (let i = n - 2; i >= 0; i--) y[i] = Math.min(y[i], y[i + 1] + g);
    for (let i = 0; i < n; i++) y[i] = Math.max(y[i], L[i]);
    for (let it = 0; it < 4; it++) y = fit(boxAvg(y, 24));
    this.Y = y;
  }
}

// ---------------------------------------------------------------------------
// Geometry helpers along a track.

const uv0 = [0, 0, 1, 0, 1, 1, 0, 1];
/** A frame at s: rail-head point, forward and left (horizontal). */
function frame(tr, s) {
  const h = tr.heading(s);
  return { x: tr.x(s), y: tr.y(s), z: tr.z(s), fx: Math.sin(h), fz: Math.cos(h), lx: Math.cos(h), lz: -Math.sin(h), h };
}
const at = (F, o, dy) => [F.x + F.lx * o, F.y + dy, F.z + F.lz * o];
const atY = (F, o, y) => [F.x + F.lx * o, y, F.z + F.lz * o];
/** The quad between two frames, at lateral offsets o0 -> o1 and heights
 *  dy0 -> dy1 over the rail head (the same at both ends). */
function band(b, A, B, o0, dy0, o1, dy1, n, col, uvs = uv0) {
  b.quad(at(A, o0, dy0), at(A, o1, dy1), at(B, o1, dy1), at(B, o0, dy0), n, uvs, col);
}
const UP = [0, 1, 0], DOWN = [0, -1, 0];
const side = (F, sg) => [F.lx * sg, 0, F.lz * sg];

// Colours (linear, vertex)
const C = {
  concrete: [0.50, 0.49, 0.46], concreteD: [0.36, 0.355, 0.34], concreteL: [0.62, 0.61, 0.58],
  railTop: [0.66, 0.66, 0.68], railSide: [0.30, 0.22, 0.17], steel: [0.36, 0.37, 0.38],
  paving: [0.20, 0.20, 0.21], plat: [0.58, 0.57, 0.54], tactile: [0.78, 0.66, 0.12],
  canopy: [0.82, 0.84, 0.86], teal: [0.05, 0.50, 0.48], navy: [0.06, 0.13, 0.33],
  wire: [0.12, 0.12, 0.12], black: [0.02, 0.02, 0.025],
};

/** The ballast-and-sleepers texture: u across the 3 m bed, v along 2.4 m. */
function bedTexture() {
  const W = 128, H = 256;
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  const g = c.getContext('2d');
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  g.fillStyle = '#6b655c'; g.fillRect(0, 0, W, H);
  for (let k = 0; k < 2600; k++) {
    const v = 70 + rnd() * 70;
    g.fillStyle = `rgb(${v + 6},${v},${v - 8})`;
    g.fillRect(rnd() * W, rnd() * H, 1 + rnd() * 2.5, 1 + rnd() * 2);
  }
  // four concrete sleepers a repeat (0.6 m), 2.6 m of the 3 m
  for (let t = 0; t < 4; t++) {
    const y = t * H / 4 + 10;
    g.fillStyle = '#9d9a92'; g.fillRect(W * 0.065, y, W * 0.87, H * 0.1);
    g.fillStyle = '#b3b0a8'; g.fillRect(W * 0.065, y, W * 0.87, H * 0.02);
    g.fillStyle = '#56534e'; g.fillRect(W * 0.065, y + H * 0.085, W * 0.87, H * 0.015);
    // rail seats (fastenings) under each rail
    for (const u of [0.26, 0.74]) { g.fillStyle = '#2c2a28'; g.fillRect(W * u - 6, y + 2, 12, H * 0.1 - 4); }
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.ClampToEdgeWrapping; tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = 8;
  return tex;
}

/** Station name boards (and the LINK roundel), one canvas. */
function signAtlas(names) {
  const W = 1024, CH = 64, cols = 2;
  const rows = Math.ceil((names.length + 1) / cols);
  const c = document.createElement('canvas'); c.width = W; c.height = 64 * Math.max(8, rows);
  const g = c.getContext('2d');
  const cells = {};
  const cell = (k, draw) => {
    const x = (k % cols) * (W / cols), y = Math.floor(k / cols) * CH;
    g.save(); g.translate(x, y); draw(g, W / cols, CH); g.restore();
    return [x / W, 1 - (y + CH) / c.height, (x + W / cols) / W, 1 - y / c.height];
  };
  names.forEach((nm, k) => {
    cells[nm] = cell(k, (q, w, h) => {
      q.fillStyle = '#0d2a55'; q.fillRect(0, 0, w, h);
      q.fillStyle = '#1b9e8f'; q.fillRect(0, h - 7, w, 7);
      q.fillStyle = '#ffffff'; q.beginPath(); q.arc(34, h / 2 - 3, 20, 0, Math.PI * 2); q.fill();
      q.fillStyle = '#0d2a55'; q.font = '900 26px -apple-system, Helvetica, sans-serif'; q.textAlign = 'center'; q.textBaseline = 'middle';
      q.fillText('1', 34, h / 2 - 2);
      q.fillStyle = '#ffffff'; q.textAlign = 'left';
      let fs = 34;
      q.font = `700 ${fs}px -apple-system, Helvetica, sans-serif`;
      while (q.measureText(nm).width > w - 84 && fs > 16) { fs -= 2; q.font = `700 ${fs}px -apple-system, Helvetica, sans-serif`; }
      q.fillText(nm, 66, h / 2 - 2);
    });
  });
  cells.__link = cell(names.length, (q, w, h) => {
    q.fillStyle = '#1b9e8f'; q.fillRect(0, 0, w, h);
    q.fillStyle = '#ffffff'; q.font = '900 40px -apple-system, Helvetica, sans-serif'; q.textAlign = 'center'; q.textBaseline = 'middle';
    q.fillText('LINK  LIGHT RAIL', w / 2, h / 2 + 1);
  });
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  const mat = new THREE.MeshBasicMaterial({ map: tex, toneMapped: false, side: THREE.DoubleSide, forceSinglePass: true });
  mat.userData.noShadow = true;
  return { mat, cells };
}

// ---------------------------------------------------------------------------
// The line.

const CHUNK = 500;

export class Link {
  /** From the map data alone, right after the map loads: citygen needs
   *  clearZones() (buildings off the line) before the city exists. */
  constructor(data) {
    this.data = data;
    this.tracks = { sb: new LinkTrack('sb', data.sb), nb: new LinkTrack('nb', data.nb) };
    this.tracks.sb.other = this.tracks.nb; this.tracks.nb.other = this.tracks.sb;
    this.stations = data.stations.map((q, i) => ({ i, name: q.name.replace('International District Chinatown', 'Intl District/Chinatown').replace('University of Washington', 'Univ of Washington'),
      full: q.name, x: q.x, z: q.z, s: { sb: 0, nb: 0 } }));
    // each station's centre on each track: the nearest sample to the station's
    // own point (the build's s is along the unsmoothed line)
    for (const st of this.stations) {
      for (const k of ['sb', 'nb']) {
        const q = this.tracks[k].nearest(st.x, st.z, 120);
        st.s[k] = q ? q.s : data.stations[st.i]['s_' + k];
      }
    }
    for (const k of ['sb', 'nb']) {
      const tr = this.tracks[k];
      tr.zones = this.stations.map((st) => [st.s[k] - LINK.platLen / 2 - 12, st.s[k] + LINK.platLen / 2 + 12]);
      // A platform partly in the open is an open station: OSM ends the
      // downtown tunnel halfway along International District's nb platform
      // (the real station is an open cut); the bore starts past its end.
      for (const [z0, z1] of tr.zones) {
        const i0 = tr.idx(z0 + 12), i1 = tr.idx(z1 - 12);
        let open = false;
        for (let i = i0; i <= i1; i++) if (tr.F[i] !== 1) { open = true; break; }
        if (open) for (let i = tr.idx(z0); i <= tr.idx(z1); i++) if (tr.F[i] === 1) tr.F[i] = 0;
      }
    }
    // the open corridor, coarse: 40 m cells within reach of a track that is
    // not in a bore (keepClear's fast reject)
    this.corrCells = new Set();
    for (const tr of Object.values(this.tracks)) {
      for (let i = 0; i < tr.n; i += 8) {
        if (tr.F[i] === 1) continue;
        const cx = Math.floor(tr.X[i] / 40), cz = Math.floor(tr.Z[i] / 40);
        for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) this.corrCells.add((cx + dx) * 100003 + cz + dz);
      }
    }
    // the profile from the map alone (see _profile)
    this._profile(null);
    this.trains = [];
    this.city = null;
    this.camUnder = false;
    this.tunnelMode = false;
    this.chunks = [];
    this.solids = [];
    this.entrances = [];
  }

  /** Oriented rects over the line that no building may stand in (citygen
   *  2d, the monorail's format): the at-grade and elevated corridor and the
   *  portals. Bores are underground and clear nothing. */
  clearZones() {
    const out = [];
    for (const tr of Object.values(this.tracks)) {
      for (let s = 0; s < tr.len; s += 16) {
        const f = tr.flag(s);
        // a bore clears nothing -- unless its box stands above the ground
        if (f === 1 && tr.kind(s + 8) === TUN) continue;
        const h = tr.heading(s + 8);
        const st = this.stations.find((q) => Math.abs(q.s[tr.key] - s) < LINK.platLen / 2 + 10);
        out.push({ x: tr.x(s + 8), z: tr.z(s + 8), hw: st ? 9 : 4.2, hd: 9.5, rot: -h, y: f === 2 ? -1e9 : -1e9 });
      }
    }
    return out;
  }

  /** Is (x, z) on the line's open corridor (no trees, props or parked cars)? */
  keepClear(x, z) {
    if (!this.corrCells.has(Math.floor(x / 40) * 100003 + Math.floor(z / 40))) return false;
    for (const k of ['sb', 'nb']) {
      const tr = this.tracks[k];
      const q = tr.nearest(x, z, 12);
      if (!q) continue;
      const f = tr.flag(q.s);
      if (f === 1 && tr.KD && tr.KD[tr.idx(q.s)] === TUN) continue;
      const st = this.stations.some((c) => Math.abs(c.s[k] - q.s) < LINK.platLen / 2 + 6);
      if (q.d < (st ? 9 : 3.6)) return true;
    }
    return false;
  }

  /**
   * Each track's profile and what each metre of it is (bore, box, guideway,
   * fill, level crossing). Once from the map alone, before the city is
   * built (clearZones needs to know where a box stands above the ground),
   * and again once it is, over the carved terrain and with its crossings.
   */
  _profile(city) {
    for (const tr of Object.values(this.tracks)) {
      const n = tr.n, KD = new Uint8Array(n);
      for (const z of tr.zones) { z.length = 2; delete z.level; }
      // Level crossings: a track at grade whose centreline is on a carriageway
      // that CROSSES it -- one that also covers the track 11 m either way
      // along is a street the track runs in or beside (MLK Jr Way's median),
      // not a crossing. Found first: the rail comes down to the road there.
      const X = new Uint8Array(n);
      for (let i = 0; i < n && city; i += 2) {
        if (tr.F[i] !== 0) continue;
        const x = tr.X[i], z = tr.Z[i];
        if (!city.onRoad(x, z, 0.6, false, false)) continue;
        const fx = Math.sin(tr.H[i]) * 11, fz = Math.cos(tr.H[i]) * 11;
        if (city.onRoad(x + fx, z + fz, 0, false, false) && city.onRoad(x - fx, z - fz, 0, false, false)) continue;
        X[i] = 1; if (i + 1 < n) X[i + 1] = 1;
      }
      // the rail stays down for a few metres either side of the paving
      const XW = new Uint8Array(n);
      for (let i = 0; i < n; i++) if (X[i]) for (let j = Math.max(0, i - 6); j <= Math.min(n - 1, i + 6); j++) XW[j] = 1;
      tr._X = X; tr._XW = XW;
      tr.setHeights(tr.zones, XW);
      tr.KD = KD;
      this._kinds(tr);
    }
    // A station's two tracks at ONE level (an island platform, a hall or a
    // deck shared between them): the lower of the two for a bore, the higher
    // on the guideway; then both profiles again.
    const sb = this.tracks.sb, nb = this.tracks.nb;
    let redo = false;
    this.stations.forEach((st, i) => {
      const a = sb.zones[i], b = nb.zones[i];
      if (a.level === undefined || b.level === undefined) return;
      const bore = sb.F[sb.idx(st.s.sb)] === 1;
      const y = bore ? Math.min(a.level, b.level) : Math.max(a.level, b.level);
      a[2] = y; b[2] = y; redo = true;
    });
    if (redo) for (const tr of [sb, nb]) { tr.setHeights(tr.zones, tr._XW); this._kinds(tr); }
  }

  _kinds(tr) {
    for (let i = 0; i < tr.n; i++) {
      const f = tr.F[i], y = tr.Y[i], g = tr.GR[i];
      // a bore that starts in the air (the 40 m ground cannot see the
      // hillside its portal is in) is guideway until it meets the ground
      if (f === 1) tr.KD[i] = y + LINK.roofOut < g - 0.4 ? TUN : y - g > 3.4 ? DECK : BOX;
      else if (y - g > 3.4) tr.KD[i] = DECK;
      else tr.KD[i] = tr._X[i] ? CROSS : FILL;
    }
  }

  /** The city is built: the profile again over the carved terrain, speed
   *  limits, the at-grade corridor, the station entrances. */
  attach(city) {
    this.city = city;
    this._profile(city);
    for (const tr of Object.values(this.tracks)) {
      const n = tr.n, KD = tr.KD, LIM = new Float32Array(n);
      // Speed limits: 35 mph where the track runs in a street (a road within
      // 9 m either side), 55 elsewhere; curves at aLat.
      for (let i = 0; i < n; i += 10) {
        let v = LINK.vMax;
        if (KD[i] === FILL || KD[i] === CROSS) {
          const h = tr.H[i], lx = Math.cos(h), lz = -Math.sin(h);
          for (const o of [-9, 9]) if (city.onRoad(tr.X[i] + lx * o, tr.Z[i] + lz * o, 2, false, false)) v = LINK.vStreet;
        }
        let k = 0;
        for (let j = Math.max(0, i - 20); j <= Math.min(n - 1, i + 20); j++) k = Math.max(k, Math.abs(tr.K[j]));
        if (k > 1e-4) v = Math.min(v, Math.max(6, Math.sqrt(LINK.aLat / k)));
        for (let j = i; j < Math.min(n, i + 10); j++) LIM[j] = v;
      }
      tr.LIM = LIM;
    }
    // the at-grade corridor, coarse: which 50 m cells hold a track at grade
    this.gradeCells = new Set();
    for (const tr of Object.values(this.tracks)) {
      for (let i = 0; i < tr.n; i += 8) {
        if (tr.KD[i] !== FILL && tr.KD[i] !== CROSS) continue;
        const cx = Math.floor(tr.X[i] / 50), cz = Math.floor(tr.Z[i] / 50);
        for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) this.gradeCells.add((cx + dx) * 100003 + cz + dz);
      }
    }
    this._entrances();
  }

  /** Where each station is entered from the street: the nearest open, dry
   *  ground off the road and out of any building near the station's point. */
  _entrances() {
    const city = this.city;
    const inBld = (x, z) => city.buildingsNear(x, z, 20).some((b) => {
      const c = Math.cos(-b.rot), s = Math.sin(-b.rot), dx = x - b.x, dz = z - b.z;
      const lx = dx * c - dz * s, lz = dx * s + dz * c;
      return Math.abs(lx) < b.w / 2 + 2 && Math.abs(lz) < b.d / 2 + 2;
    });
    for (const st of this.stations) {
      const sb = this.tracks.sb, sS = st.s.sb;
      const under = sb.kind(sS) === TUN;
      const cx = sb.x(sS), cz = sb.z(sS);
      let best = null;
      for (let r = under ? 10 : 12; r < 160 && !best; r += 5) {
        for (let k = 0; k < 24; k++) {
          const a = (k / 24) * Math.PI * 2, x = cx + Math.cos(a) * r, z = cz + Math.sin(a) * r;
          if (G.isWater(x, z) || city.onRoad(x, z, 2.2) || inBld(x, z)) continue;
          if (!under && (this.tracks.sb.nearest(x, z, 8) || this.tracks.nb.nearest(x, z, 8))) continue;
          const y = city.groundAt(x, z, null);
          if (Math.abs(y - G.terrainHeight(x, z)) > 1.2) continue;
          // face the station
          best = { x, z, y, h: Math.atan2(cx - x, cz - z) };
          break;
        }
      }
      if (!best) best = { x: cx + 12, z: cz, y: G.terrainHeight(cx + 12, cz), h: 0 };
      st.ent = best;
      st.under = under;
      st.elevated = sb.kind(sS) === DECK;
    }
  }

  // --- the structure ------------------------------------------------------------

  /** Everything static: bed, rails and wires, guideway, boxes, bores, the
   *  stations. Chunked by 500 m so each piece culls, with the near detail
   *  (rails, wires) and the bores switched separately. */
  build(scene, world) {
    this.world = world;
    this.bedMat = new THREE.MeshStandardMaterial({ map: bedTexture(), vertexColors: true, roughness: 0.95, metalness: 0, envMapIntensity: 0.5 });
    this.cardMat = new THREE.MeshBasicMaterial({ color: 0x000000 });
    const sign = signAtlas(this.stations.map((s) => s.name));
    this.signMat = sign.mat; this.signCells = sign.cells;
    const chunks = new Map();
    const chunk = (x, z) => {
      const k = `${Math.floor(x / CHUNK)},${Math.floor(z / CHUNK)}`;
      let c = chunks.get(k);
      if (!c) chunks.set(k, (c = { bed: new Builder(true), flat: new Builder(false), near: new Builder(false), tun: new Builder(false), card: new Builder(false), sign: new Builder(true), x: (Math.floor(x / CHUNK) + 0.5) * CHUNK, z: (Math.floor(z / CHUNK) + 0.5) * CHUNK }));
      return c;
    };
    this._chunk = chunk;
    for (const tr of Object.values(this.tracks)) this._buildTrack(tr, chunk);
    for (const st of this.stations) for (const k of ['sb', 'nb']) this._buildStation(st, this.tracks[k], chunk);
    for (const st of this.stations) this._buildEntrance(st, chunk);
    // meshes
    this.group = new THREE.Group(); this.group.name = 'link';
    this.tunGroup = new THREE.Group(); this.tunGroup.name = 'link:bores'; this.tunGroup.visible = false;
    const mk = (b, mat, name, shadow) => {
      if (b.empty) return null;
      const m = new THREE.Mesh(b.build(), mat);
      m.name = name; m.castShadow = shadow; m.receiveShadow = shadow;
      m.geometry.computeBoundingSphere();
      return m;
    };
    for (const [key, c] of chunks) {
      const e = { x: c.x, z: c.z,
        bed: mk(c.bed, this.bedMat, `link:bed:${key}`, false),
        flat: mk(c.flat, world.mats.flat, `link:${key}`, true),
        near: mk(c.near, world.mats.flat, `link:near:${key}`, false),
        tun: mk(c.tun, world.mats.glow, `link:bore:${key}`, false),
        card: mk(c.card, this.cardMat, `link:mouth:${key}`, false),
        sign: mk(c.sign, this.signMat, `link:sign:${key}`, false) };
      if (e.bed) e.bed.receiveShadow = true;
      for (const m of [e.bed, e.flat, e.near, e.card, e.sign]) if (m) this.group.add(m);
      if (e.tun) this.tunGroup.add(e.tun);
      this.chunks.push(e);
    }
    scene.add(this.group);
    scene.add(this.tunGroup);
    if (this.city && this.city.setLandmarkSolids && this.solids.length) {
      this.city.setLandmarkSolids([...(this.city.landmarkSolids || []), ...this.solids]);
    }
    if (this.city && this.city.setPlatforms && this.platforms && this.platforms.length) {
      this.city.setPlatforms([...(this.city.platforms || []), ...this.platforms]);
    }
  }

  _buildTrack(tr, chunk) {
    const other = tr.other, DS = 4;
    const gauge = LINK.gauge / 2 + 0.035;
    const outer = []; // per station: which side is away from the other track
    const segs = Math.ceil(tr.len / DS);
    let F0 = frame(tr, 0);
    let pole = 25;
    let colNext = 18;
    for (let k = 0; k < segs; k++) {
      const s0 = k * DS, s1 = Math.min(tr.len, s0 + DS), sm = (s0 + s1) / 2;
      const F1 = frame(tr, s1);
      const A = F0, B = F1;
      F0 = F1;
      const kind = tr.kind(sm);
      const c = chunk(tr.x(sm), tr.z(sm));
      const q = other.nearest(tr.x(sm), tr.z(sm), 40);
      const otherD = q ? q.d : 99, towardOther = q ? (() => {
        const dx = other.x(q.s) - tr.x(sm), dz = other.z(q.s) - tr.z(sm);
        return dx * A.lx + dz * A.lz >= 0 ? 1 : -1;
      })() : 1;
      outer.push(-towardOther);
      const inStation = this.stations.some((st) => Math.abs(st.s[tr.key] - sm) < LINK.platLen / 2 + 2);
      // an underground station's hall replaces the bore round it (_buildStation)
      const inHall = kind === TUN && this.stations.some((st) => Math.abs(st.s[tr.key] - sm) < LINK.platLen / 2 + 6);
      const bedB = kind === TUN ? c.tun : c.bed;
      const railB = kind === TUN ? c.tun : c.near;
      // --- the bed -------------------------------------------------------------
      const v0 = s0 / 2.4, v1 = s1 / 2.4;
      if (kind === CROSS) {
        // a level crossing: paved flush with the rail heads
        band(c.flat, A, B, -2.2, -0.03, 2.2, -0.03, UP, C.paving);
      } else if (kind === TUN) {
        band(bedB, A, B, -1.5, -0.17, 1.5, -0.17, UP, [0.1, 0.1, 0.1]);
        // sleepers as darker bars, one a metre (unlit, no texture here)
        for (let s = Math.ceil(s0); s < s1; s += 1) {
          const T = frame(tr, s), T2 = frame(tr, s + 0.26);
          band(bedB, T, T2, -1.3, -0.15, 1.3, -0.15, UP, [0.19, 0.185, 0.18]);
        }
      } else {
        bedB.quad(at(A, -1.5, -0.17), at(A, 1.5, -0.17), at(B, 1.5, -0.17), at(B, -1.5, -0.17), UP, [0, v0, 1, v0, 1, v1, 0, v1], [1, 1, 1]);
        if (kind === FILL || kind === BOX) {
          // ballast shoulders down to the ground (plain ballast: the texture's edge)
          for (const sg of [1, -1]) {
            const gA = G.terrainHeight(A.x + A.lx * 2.4 * sg, A.z + A.lz * 2.4 * sg), gB = G.terrainHeight(B.x + B.lx * 2.4 * sg, B.z + B.lz * 2.4 * sg);
            const yA = Math.min(A.y - 0.45, Math.max(gA, A.y - 1.2)), yB = Math.min(B.y - 0.45, Math.max(gB, B.y - 1.2));
            bedB.quad(at(A, 1.5 * sg, -0.17), atY(A, 2.4 * sg, yA), atY(B, 2.4 * sg, yB), at(B, 1.5 * sg, -0.17), [A.lx * sg * 0.4, 1, A.lz * sg * 0.4], [0.02, v0, 0.05, v0, 0.05, v1, 0.02, v1], [0.92, 0.9, 0.86]);
            // on a fill higher than its shoulder: a retaining wall to the ground
            const dA = yA - gA, dB = yB - gB;
            if (kind === FILL && (dA > 0.25 || dB > 0.25) && !inStation) {
              c.flat.quad(atY(A, 2.4 * sg, yA + 0.2), atY(B, 2.4 * sg, yB + 0.2), atY(B, 2.4 * sg, gB - 0.4), atY(A, 2.4 * sg, gA - 0.4), side(A, sg), uv0, C.concrete);
              c.flat.quad(atY(A, 2.4 * sg, yA + 0.2), atY(B, 2.4 * sg, yB + 0.2), atY(B, 2.1 * sg, yB + 0.2), atY(A, 2.1 * sg, yA + 0.2), UP, uv0, C.concreteL);
            }
          }
        }
      }
      // --- rails ---------------------------------------------------------------
      for (const o of [-gauge, gauge]) {
        if (kind === CROSS) {
          band(railB, A, B, o - 0.035, 0.0, o + 0.035, 0.0, UP, C.railTop);
          band(railB, A, B, o - 0.1, -0.012, o - 0.035, -0.012, UP, C.black);
          continue;
        }
        band(railB, A, B, o - 0.035, 0, o + 0.035, 0, UP, kind === TUN ? [0.5, 0.5, 0.52] : C.railTop);
        for (const sg of [-1, 1]) band(railB, A, B, o + 0.035 * sg, 0, o + 0.07 * sg, -0.17, side(A, sg), kind === TUN ? [0.16, 0.13, 0.11] : C.railSide);
      }
      // --- the guideway ----------------------------------------------------------
      if (kind === DECK) {
        // the deck reaches the other track's where they share the structure,
        // and at a station it carries the platform: to the middle for an
        // island, out past the edge for a side platform
        const isl = inStation && otherD >= 8.4 && otherD < 22;
        const wIn = otherD < 8.5 || isl ? otherD / 2 + 0.05 : 2.5, wOut = inStation && !isl ? 6.25 : 2.55;
        const oIn = wIn * towardOther, oOut = -wOut * towardOther;
        band(c.flat, A, B, oOut, -0.18, oIn, -0.18, UP, C.concrete);
        // fascia and soffit, then the box girder's webs
        band(c.flat, A, B, oOut, -0.18, oOut, -0.75, side(A, -towardOther), C.concreteL);
        band(c.flat, A, B, oOut, -0.75, oIn, -0.75, DOWN, C.concreteD);
        if (otherD >= 8.5 && !isl) band(c.flat, A, B, oIn, -0.18, oIn, -0.75, side(A, towardOther), C.concreteL);
        for (const sg of [-1, 1]) {
          c.flat.quad(at(A, 1.55 * sg, -0.75), at(B, 1.55 * sg, -0.75), at(B, 1.1 * sg, -2.25), at(A, 1.1 * sg, -2.25), [A.lx * sg, -0.3, A.lz * sg], uv0, C.concrete);
        }
        band(c.flat, A, B, -1.1, -2.25, 1.1, -2.25, DOWN, C.concreteD);
        // the outer parapet
        band(c.flat, A, B, oOut, -0.18, oOut, 0.95, side(A, -towardOther), C.concreteL);
        band(c.flat, A, B, oOut + 0.2 * towardOther, -0.18, oOut + 0.2 * towardOther, 0.95, side(A, towardOther), C.concrete);
        band(c.flat, A, B, oOut, 0.95, oOut + 0.2 * towardOther, 0.95, UP, C.concreteL);
        if (otherD >= 8.5 && !isl && !inStation) {
          band(c.flat, A, B, oIn, -0.18, oIn, 0.95, side(A, towardOther), C.concreteL);
          band(c.flat, A, B, oIn - 0.2 * towardOther, -0.18, oIn - 0.2 * towardOther, 0.95, side(A, -towardOther), C.concrete);
          band(c.flat, A, B, oIn, 0.95, oIn - 0.2 * towardOther, 0.95, UP, C.concreteL);
        }
        // columns every ~32 m, off the carriageways; one between the two
        // tracks where they share the deck (the western track places it)
        if (sm >= colNext) {
          const shared = otherD < 8.5;
          if (!shared || tr.key === 'sb') {
            let placed = false;
            for (const ds of [0, 5, -5, 10, -10, 15]) {
              const sc = sm + ds;
              if (tr.kind(sc) !== DECK) continue;
              const P = frame(tr, sc);
              const off = shared ? otherD / 2 * towardOther : 0;
              const x = P.x + P.lx * off, z = P.z + P.lz * off;
              if (this.city.onRoad(x, z, 1.3, false, false)) continue;
              const gy = G.terrainHeight(x, z);
              const top = P.y - 2.25;
              if (top - gy < 2) continue;
              const cw = shared ? 2.0 : 1.6;
              c.flat.box(x, gy - 0.5, z, cw, top - gy + 0.5 - 0.6, cw, -P.h, C.concrete);
              // the crosshead under the girder(s)
              const hw = shared ? otherD / 2 + 1.6 : 1.5;
              c.flat.box(x, top - 0.6, z, hw * 2, 0.6, 2.4, -P.h, C.concreteL);
              this.solids.push({ x, z, r: cw * 0.62, y0: gy, y1: top });
              placed = true;
              break;
            }
            colNext = sm + (placed ? 32 : 12);
          } else colNext = sm + 32;
        }
      }
      // --- the covered approach and the bore -------------------------------------
      if ((kind === BOX || kind === TUN) && inHall) {
        band(c.tun, A, B, -0.015, LINK.wire, 0.015, LINK.wire, DOWN, [0.06, 0.06, 0.06]);
      } else if (kind === BOX || kind === TUN) {
        const b = kind === TUN ? c.tun : c.flat;
        const W = LINK.boreW, H = LINK.boreH;
        // interior: walls, walkways, ceiling -- unlit in the bore, light
        // pools every 18 m baked into the colours
        const lit = (s) => { const d = Math.abs(((s % 18) + 18) % 18 - 9) / 9; return 0.55 + 0.45 * d * d; };
        const kA = kind === TUN ? lit(s0) : 1, kB = kind === TUN ? lit(s1) : 1;
        const wallC = kind === TUN ? [[0.19 * kA, 0.19 * kA, 0.185 * kA], [0.19 * kB, 0.19 * kB, 0.185 * kB]] : null;
        for (const sg of [-1, 1]) {
          const cw = kind === TUN ? [wallC[0], wallC[1], wallC[1], wallC[0]] : C.concreteD;
          b.quad(at(A, W * sg, -0.3), at(B, W * sg, -0.3), at(B, W * sg, H), at(A, W * sg, H), side(A, -sg),
            uv0, kind === TUN ? [cw[0], cw[1], [0.13 * kB, 0.13 * kB, 0.125 * kB], [0.13 * kA, 0.13 * kA, 0.125 * kA]] : cw);
          // the walkway along each wall
          band(b, A, B, 1.9 * sg, 0.55, W * sg, 0.55, UP, kind === TUN ? [0.17, 0.17, 0.165] : C.concrete);
          band(b, A, B, 1.9 * sg, -0.25, 1.9 * sg, 0.55, side(A, -sg), kind === TUN ? [0.11, 0.11, 0.11] : C.concreteD);
          band(b, A, B, 1.5 * sg, -0.25, 1.9 * sg, -0.25, UP, kind === TUN ? [0.08, 0.08, 0.08] : C.concreteD);
        }
        band(b, A, B, -W, H, W, H, DOWN, kind === TUN ? [0.1, 0.1, 0.1] : C.concreteD);
        // the contact wire, held from the roof
        band(b, A, B, -0.015, LINK.wire, 0.015, LINK.wire, DOWN, kind === TUN ? [0.06, 0.06, 0.06] : C.wire);
        if (kind === TUN) {
          // a lamp on each wall every 18 m, a cable tray
          const sl = Math.ceil(s0 / 18) * 18;
          if (sl < s1) {
            const T = frame(tr, sl), T2 = frame(tr, sl + 1.4);
            for (const sg of [-1, 1]) band(b, T, T2, (W - 0.02) * sg, 3.6, (W - 0.02) * sg, 3.85, side(T, -sg), [1.0, 0.92, 0.74]);
          }
          for (const sg of [-1, 1]) band(b, A, B, (W - 0.02) * sg, 2.2, (W - 0.02) * sg, 2.3, side(A, -sg), [0.12, 0.12, 0.12]);
        } else {
          // outside: walls down to the ground and the roof slab, where they stand above it
          for (const sg of [-1, 1]) {
            const gA = G.terrainHeight(A.x + A.lx * (W + 0.3) * sg, A.z + A.lz * (W + 0.3) * sg);
            const gB = G.terrainHeight(B.x + B.lx * (W + 0.3) * sg, B.z + B.lz * (W + 0.3) * sg);
            const tA = A.y + LINK.roofOut, tB = B.y + LINK.roofOut;
            if (tA > gA || tB > gB) c.flat.quad(atY(A, (W + 0.3) * sg, gA - 0.6), atY(B, (W + 0.3) * sg, gB - 0.6), atY(B, (W + 0.3) * sg, tB), atY(A, (W + 0.3) * sg, tA), side(A, sg), uv0, C.concrete);
          }
          band(c.flat, A, B, -W - 0.3, LINK.roofOut, W + 0.3, LINK.roofOut, UP, C.concreteL);
          band(c.flat, A, B, -W, H, -W - 0.3, LINK.roofOut, UP, C.concrete);
        }
      }
      // mouths: a headwall where the box starts from open track, a dark card
      // where the box goes under the ground (the bore beyond is drawn only
      // for a camera inside it)
      const kPrev = tr.kind(s0 - 1), kNext = tr.kind(s1 + 1);
      if (kind === BOX && (kPrev === FILL || kPrev === DECK || kPrev === CROSS) || kind === BOX && s0 === 0) this._headwall(tr, s0, c, 1);
      if (kind === BOX && (kNext === FILL || kNext === DECK || kNext === CROSS)) this._headwall(tr, s1, c, -1);
      if (kind === BOX && kNext === TUN) this._card(tr, s1, c, 1);
      if (kind === BOX && kPrev === TUN) this._card(tr, s0, c, -1);
      // --- catenary, open track ---------------------------------------------------
      if (kind !== TUN && kind !== BOX && sm >= pole) {
        pole = sm + (Math.abs(tr.curv(sm)) > 1 / 500 ? 36 : 52);
        const P = frame(tr, sm), sg = -towardOther;
        const po = otherD < 9 ? 2.9 : 2.9;
        const px = P.x + P.lx * po * sg, pz = P.z + P.lz * po * sg;
        if (!(kind === FILL || kind === CROSS) || !this.city.onRoad(px, pz, 0.3, false, false)) {
          const base = kind === DECK ? P.y - 0.18 : G.terrainHeight(px, pz) - 0.2;
          c.near.box(px, base, pz, 0.26, P.y + 6.1 - base, 0.26, -P.h, C.steel);
          // the cantilever over the track and its registration arm
          c.near.tube([px, P.y + 5.9, pz], [P.x - P.lx * 0.4 * sg, P.y + 5.75, P.z - P.lz * 0.4 * sg], 0.045, 5, C.steel);
          c.near.tube([px, P.y + 5.25, pz], [P.x, P.y + LINK.wire + 0.02, P.z], 0.03, 4, C.steel);
          c.near.tube([P.x + P.lx * 0.3 * sg, P.y + 5.75, P.z + P.lz * 0.3 * sg], [P.x + P.lx * 0.3 * sg, P.y + LINK.wire, P.z + P.lz * 0.3 * sg], 0.012, 3, C.wire);
        }
      }
      if (kind !== TUN && kind !== BOX) {
        // contact wire and messenger
        band(c.near, A, B, -0.02, LINK.wire, 0.02, LINK.wire, DOWN, C.wire);
        band(c.near, A, B, -0.02, LINK.wire, 0.02, LINK.wire, UP, C.wire);
        band(c.near, A, B, 0.28, 5.72, 0.31, 5.72, DOWN, C.wire);
      }
    }
  }

  _headwall(tr, s, c, dirIn) {
    // a portal face across both the box and a margin, facing out of it
    const P = frame(tr, s), W = LINK.boreW + 0.3;
    const n = [-P.fx * dirIn, 0, -P.fz * dirIn];
    const gy = Math.min(G.terrainHeight(P.x, P.z), P.y - 0.4);
    const top = P.y + LINK.roofOut + 0.5;
    const w = W + 1.6;
    const q = (o0, y0, o1, y1) => c.flat.quad(atY(P, o0, y0), atY(P, o1, y0), atY(P, o1, y1), atY(P, o0, y1), n, uv0, C.concreteL);
    q(-w, gy - 0.5, -W, top); q(W, gy - 0.5, w, top); q(-W, P.y + LINK.boreH, W, top);
    // the coping on top, a little proud
    const o = [P.fx * 0.35 * -dirIn, P.fz * 0.35 * -dirIn];
    c.flat.quad([P.x - P.lx * w + o[0], top, P.z - P.lz * w + o[1]], [P.x + P.lx * w + o[0], top, P.z + P.lz * w + o[1]],
      [P.x + P.lx * w - o[0], top, P.z + P.lz * w - o[1]], [P.x - P.lx * w - o[0], top, P.z - P.lz * w - o[1]], UP, uv0, C.concreteL);
  }

  _card(tr, s, c, dirIn) {
    const P = frame(tr, s), W = LINK.boreW;
    const n = [-P.fx * dirIn, 0, -P.fz * dirIn];
    c.card.quad(at(P, -W, -0.4), at(P, W, -0.4), at(P, W, LINK.boreH), at(P, -W, LINK.boreH), n, uv0, [0, 0, 0]);
  }

  /** One track's half of a station: the platform beside it, the canopy, the
   *  boards; underground, the hall round it. */
  _buildStation(st, tr, chunk) {
    const sC = st.s[tr.key], other = tr.other;
    const L = LINK.platLen, s0 = sC - L / 2, s1 = sC + L / 2;
    const c = chunk(tr.x(sC), tr.z(sC));
    const kind = tr.kind(sC);
    const under = kind === TUN || kind === BOX;
    const b = under ? c.tun : c.flat;
    const q = other.nearest(tr.x(sC), tr.z(sC), 60);
    const d = q ? q.d : 99;
    const P0 = frame(tr, sC);
    const toward = q ? ((other.x(q.s) - P0.x) * P0.lx + (other.z(q.s) - P0.z) * P0.lz >= 0 ? 1 : -1) : 1;
    const island = d >= 8.4 && d < 22;
    const sg = island ? toward : -toward;          // the platform's side of this track
    // platform edge and back, off this track (an island's halves overlap a
    // little underground, where they share a level: no seam down the middle)
    const e0 = 1.45, e1 = island ? d / 2 + (under ? 0.3 : 0) : 5.9;
    const H = LINK.platH;
    const plat = under ? [0.36, 0.35, 0.33] : C.plat;
    const DS = 4;
    for (let s = s0; s < s1 - 0.01; s += DS) {
      const A = frame(tr, s), B = frame(tr, Math.min(s1, s + DS));
      band(b, A, B, e0 * sg, H, e1 * sg, H, UP, plat);
      band(b, A, B, e0 * sg, H, (e0 + 0.6) * sg, H + 0.004, UP, under ? [0.5, 0.42, 0.1] : C.tactile);
      band(b, A, B, e0 * sg, -0.2, e0 * sg, H, side(A, -sg), under ? [0.2, 0.2, 0.2] : C.concreteD);
      if (!island) {
        // the back edge: underground a wall, in the open a railing
        if (under) band(b, A, B, e1 * sg, H, e1 * sg, H + 1.1, side(A, -sg), [0.34, 0.34, 0.33]);
        else {
          band(b, A, B, (e1 - 0.05) * sg, H + 1.02, (e1 + 0.02) * sg, H + 1.02, UP, C.steel);
          band(b, A, B, (e1 + 0.02) * sg, H + 0.97, (e1 + 0.02) * sg, H + 1.02, side(A, sg), C.steel);
          band(b, A, B, (e1 - 0.05) * sg, H + 0.97, (e1 - 0.05) * sg, H + 1.02, side(A, -sg), C.steel);
          b.box(A.x + A.lx * (e1 - 0.02) * sg, A.y + H, A.z + A.lz * (e1 - 0.02) * sg, 0.06, 1.0, 0.06, -A.h, C.steel);
        }
      }
      // walkable: a platform per 4 m slice
      if (!this.platforms) this.platforms = [];
      const mx = (A.x + B.x) / 2 + A.lx * ((e0 + e1) / 2) * sg, mz = (A.z + B.z) / 2 + A.lz * ((e0 + e1) / 2) * sg;
      if (!under) this.platforms.push({ x: mx, z: mz, hw: (e1 - e0) / 2, hd: DS / 2 + 0.05, rot: -A.h, y0: (A.y + B.y) / 2 + H, y1: (A.y + B.y) / 2 + H });
      if (!under && tr.kind(s) === FILL) {
        // the platform's front face down to the ground on a slope
        const gA = G.terrainHeight(A.x + A.lx * e1 * sg, A.z + A.lz * e1 * sg);
        if (A.y + H - gA > 0.3 && !island) band(b, A, B, e1 * sg, -1.5, e1 * sg, H, side(A, sg), C.concrete);
      }
    }
    // the canopy: posts down the middle of the platform and a roof over it
    // (an island's canopy is built once, by the western track)
    const doCanopy = !under && (!island || tr.key === 'sb');
    if (doCanopy) {
      const cm = island ? d / 2 * sg : (e0 + e1) / 2 * sg;
      const cw = island ? d / 2 - 0.4 : (e1 - e0) / 2 + 0.3;
      for (let s = s0 + 8; s < s1 - 6; s += 12) {
        const P = frame(tr, s);
        b.box(P.x + P.lx * cm, P.y + H, P.z + P.lz * cm, 0.24, 3.6, 0.24, -P.h, C.steel);
        // a bench and a wind screen between posts
        if (((s - s0) / 12 | 0) % 2 === 0) {
          const bo = cm + 0.9 * (island ? 0 : sg);
          b.box(P.x + P.lx * bo + P.fx * 4, P.y + H, P.z + P.lz * bo + P.fz * 4, 0.5, 0.45, 1.8, -P.h, C.steel);
          b.box(P.x + P.lx * bo + P.fx * 4, P.y + H + 0.42, P.z + P.lz * bo + P.fz * 4, 0.55, 0.06, 1.9, -P.h, [0.34, 0.22, 0.14]);
        }
      }
      for (let s = s0 + 2; s < s1 - 2; s += DS) {
        const A = frame(tr, s), B = frame(tr, Math.min(s1 - 2, s + DS));
        band(b, A, B, cm - cw, H + 3.9, cm + cw, H + 3.6, UP, C.canopy);
        band(b, A, B, cm - cw, H + 3.78, cm + cw, H + 3.48, DOWN, [0.5, 0.52, 0.55]);
        // a lit strip under the canopy
        band(c.sign, A, B, cm - 0.12, H + 3.46, cm + 0.12, H + 3.46, DOWN, [1, 1, 1], this._cellUV('__link', 0.9));
      }
    }
    // Underground: the hall -- wider, lighter, with a lit ceiling -- round the
    // track and its platform.
    if (under) {
      // an island's hall is two halves meeting over its middle: no wall there
      const W = island ? d / 2 + 0.05 : Math.max(LINK.boreW, e1 + 0.3), top = 7.2;
      for (let s = s0 - 6; s < s1 + 6 - 0.01; s += DS) {
        const A = frame(tr, s), B = frame(tr, s + DS);
        const k = (t) => { const d = Math.abs(((t % 8) + 8) % 8 - 4) / 4; return 0.8 + 0.2 * d; };
        const kA = k(s), kB = k(s + DS);
        if (!island) band(c.tun, A, B, (W) * sg, -0.3, (W) * sg, top, side(A, -sg), [0.36 * kA, 0.35 * kA, 0.33 * kA]);
        band(c.tun, A, B, -LINK.boreW * sg, LINK.boreH, W * sg, top, DOWN, [0.3, 0.3, 0.29]);
        band(c.tun, A, B, -LINK.boreW * sg, -0.3, -LINK.boreW * sg, LINK.boreH, side(A, sg), [0.3 * kA, 0.29 * kA, 0.28 * kA]);
        // the hall's floor, under and past the platform
        band(c.tun, A, B, 1.5 * sg, -0.25, W * sg, -0.25, UP, [0.08, 0.08, 0.08]);
        // the floor on the far side of the track, and a walkway there
        band(c.tun, A, B, -1.5 * sg, -0.25, -1.9 * sg, -0.25, UP, [0.08, 0.08, 0.08]);
        band(c.tun, A, B, -1.9 * sg, -0.25, -1.9 * sg, 0.55, side(A, sg), [0.13, 0.13, 0.13]);
        band(c.tun, A, B, -1.9 * sg, 0.55, -LINK.boreW * sg, 0.55, UP, [0.22, 0.22, 0.21]);
        // light strips over the platform
        band(c.tun, A, B, (e0 + 0.8) * sg, top - 0.05, (e0 + 1.1) * sg, top - 0.05, DOWN, [1.0, 0.97, 0.9]);
        band(c.tun, A, B, (e1 - 1.1) * sg, top - 0.05, (e1 - 0.8) * sg, top - 0.05, DOWN, [1.0, 0.97, 0.9]);
      }
      // hall ends
      for (const [s, dn] of [[s0 - 6, 1], [s1 + 6, -1]]) {
        const P = frame(tr, s);
        const n = [P.fx * dn, 0, P.fz * dn];
        // over the bore, and beside it out to the hall's side
        c.tun.quad(at(P, -LINK.boreW * sg, LINK.boreH), at(P, LINK.boreW * sg, LINK.boreH), at(P, LINK.boreW * sg, top), at(P, -LINK.boreW * sg, top), n, uv0, [0.24, 0.24, 0.23]);
        if (W > LINK.boreW) c.tun.quad(at(P, LINK.boreW * sg, -0.3), at(P, W * sg, -0.3), at(P, W * sg, top), at(P, LINK.boreW * sg, top), n, uv0, [0.24, 0.24, 0.23]);
      }
    }
    // boards: at both ends and the middle, hanging over the platform
    for (const s of [s0 + 14, sC, s1 - 14]) {
      const P = frame(tr, s);
      const o = (e0 + (island ? (e1 - e0) * 0.5 : 1.6)) * sg;
      const y = P.y + H + (under ? 3.1 : 2.8);
      const w = 3.6, h = 0.45;
      const cx = P.x + P.lx * o, cz = P.z + P.lz * o;
      for (const fs of [1, -1]) {
        const n = [P.lx * -sg * fs, 0, P.lz * -sg * fs];
        // the board faces across the track (and, back to back, the platform)
        const off = 0.03 * fs;
        const a = [cx - P.fx * w / 2 + n[0] * off, y, cz - P.fz * w / 2 + n[2] * off], bb = [cx + P.fx * w / 2 + n[0] * off, y, cz + P.fz * w / 2 + n[2] * off];
        const uvs = this._cellUV(st.name);
        // mirror the uv on the side where +f runs right to left
        const flip = sg * fs > 0;
        const U = flip ? [uvs[2], uvs[1], uvs[0], uvs[1], uvs[0], uvs[3], uvs[2], uvs[3]] : uvs;
        c.sign.quad(a, bb, [bb[0], y + h, bb[2]], [a[0], y + h, a[2]], n, U, [1, 1, 1]);
      }
      b.box(cx, y + h, cz, 0.08, (under ? 7.2 : 3.9) + P.y + H - y - h - (under ? 0 : 0.2), 0.08, -P.h, C.steel);
    }
  }

  _cellUV(name, inset = 0) {
    const cl = this.signCells[name];
    if (!cl) return uv0;
    const [u0, v0, u1, v1] = cl;
    const iu = (u1 - u0) * inset * 0.5, iv = (v1 - v0) * inset * 0.5;
    return [u0 + iu, v0 + iv, u1 - iu, v0 + iv, u1 - iu, v1 - iv, u0 + iu, v1 - iv];
  }

  /** The street entrance: a canopy over the way down (or up), and a pylon
   *  with the station's name. ENTER here boards the train at the platform. */
  _buildEntrance(st, chunk) {
    const e = st.ent, c = chunk(e.x, e.z);
    const h = e.h, fx = Math.sin(h), fz = Math.cos(h), lx = Math.cos(h), lz = -Math.sin(h);
    const y = e.y;
    // pylon
    const px = e.x + lx * 2.2, pz = e.z + lz * 2.2;
    c.flat.box(px, y, pz, 0.7, 4.6, 0.7, -h, C.navy);
    for (const sn of [1, -1]) {
      const n = [fx * -sn, 0, fz * -sn];
      const cx = px - fx * 0.36 * sn, cz = pz - fz * 0.36 * sn;
      // the name board, turned to read down the pylon's face
      const uvs = this._cellUV(st.name);
      const w = 0.66, top = y + 4.4, bot = y + 1.2;
      // vertical text: run the cell's u along the height
      const a = [cx - lx * w / 2 * sn, bot, cz - lz * w / 2 * sn], b = [cx + lx * w / 2 * sn, bot, cz + lz * w / 2 * sn];
      c.sign.quad(a, b, [b[0], top, b[2]], [a[0], top, a[2]], n, [uvs[0], uvs[3], uvs[0], uvs[1], uvs[2], uvs[1], uvs[2], uvs[3]], [1, 1, 1]);
      const lu = this._cellUV('__link');
      c.sign.quad([cx - lx * w / 2 * sn, top + 0.02, cz - lz * w / 2 * sn], [cx + lx * w / 2 * sn, top + 0.02, cz + lz * w / 2 * sn],
        [cx + lx * w / 2 * sn, top + 0.18, cz + lz * w / 2 * sn], [cx - lx * w / 2 * sn, top + 0.18, cz - lz * w / 2 * sn], n, lu, [1, 1, 1]);
    }
    this.solids.push({ x: px, z: pz, r: 0.5, y0: y, y1: y + 4.6 });
    // the entrance itself: a glass canopy over stairs going down (a hall
    // underground) or a gate (at grade and up top)
    const ex = e.x - lx * 1.2, ez = e.z - lz * 1.2;
    for (const o of [-1.5, 1.5]) for (const f of [-2.2, 2.2]) c.flat.box(ex + lx * o + fx * f, y, ez + lz * o + fz * f, 0.14, 3.1, 0.14, -h, C.steel);
    c.flat.box(ex, y + 3.1, ez, 3.6, 0.16, 5.0, -h, C.canopy);
    c.flat.box(ex, y + 3.26, ez, 3.4, 0.05, 4.8, -h, C.teal);
    if (st.under) {
      // the stairwell: a dark opening in the ground with its side walls
      c.flat.box(ex, y + 0.02, ez, 2.4, 0.04, 3.6, -h, [0.03, 0.03, 0.035]);
      for (const o of [-1.3, 1.3]) c.flat.box(ex + lx * o, y, ez + lz * o, 0.2, 1.0, 3.8, -h, C.concreteL);
    } else {
      // fare readers either side of the way in
      for (const o of [-0.9, 0.9]) c.flat.box(ex + lx * o + fx * 1.8, y, ez + lz * o + fz * 1.8, 0.28, 1.2, 0.3, -h, C.teal);
    }
  }

  // --- trains -----------------------------------------------------------------

  makeTrains(scene) {
    const geo = buildLRVGeometry();
    this.geo = geo;
    const A = vehicleAssets();
    this.bodyMat = new THREE.MeshStandardMaterial({ vertexColors: true, metalness: 0.2, roughness: 0.42, envMapIntensity: 1.1 });
    this.trimMat = A.trimMat;
    let id = 0;
    for (const k of ['sb', 'nb']) {
      const tr = this.tracks[k];
      for (let i = 0; i < LINK.perTrack; i++) {
        const t = new LinkTrain(this, id++, tr);
        const s = ((i + 0.5) / LINK.perTrack) * tr.len;
        t.place(clamp(s, LINK.len / 2 + 5, tr.len - LINK.len / 2 - 5), tr.dir);
        this.trains.push(t);
        scene.add(t.group);
      }
    }
    // settle the service: four minutes of it, at a coarse step
    for (let k = 0; k < 960; k++) this._service(0.25, true);
    for (const t of this.trains) t.group.visible = false;
    return this.trains;
  }

  /** Hooks into the game. */
  bind(o) { Object.assign(this, { game: o.game, hud: o.hud, audio: o.audio, player: o.player }); }
  say(t, ms) { if (this.hud) this.hud.showToast(t, ms); }

  /** The train on `tr` whose tail is next ahead of `t` (moving the way it moves). */
  ahead(t) {
    let best = null, bd = Infinity;
    for (const o of this.trains) {
      if (o === t || o.track !== t.track || o.state === 'off') continue;
      const d = (o.s - t.s) * t.dir;
      if (d > 0 && d < bd) { bd = d; best = o; }
    }
    return best;
  }

  /** Where a station stops a train on track `tr`: its centre s. */
  stopS(st, tr) { return st.s[tr.key]; }

  _service(dt, boot = false) {
    const p = this.player, pos = p ? p.position : null;
    const waiting = !boot && p && p.onFoot && this.waitingAt(pos.x, pos.z);
    for (const t of this.trains) {
      if (t.driver === 'player') continue;
      // far from you, while you wait at a station, the service runs fast
      let k = 1;
      if (waiting && pos && Math.hypot(t.x - pos.x, t.z - pos.z) > 1400) k = 6;
      let left = dt * k;
      while (left > 1e-6) { const h = Math.min(0.25, left); t.service(h); left -= h; }
    }
  }

  /** The station whose entrance you are standing at (within 14 m), or null. */
  waitingAt(x, z) {
    for (const st of this.stations) if (Math.hypot(x - st.ent.x, z - st.ent.z) < 14) return st;
    return null;
  }

  update(dt, camera) {
    if (!this.trains.length) return;
    this._service(dt);
    const p = this.player, pv = p && p.vehicle;
    const driving = pv && pv.spec && pv.spec.link;
    this.tunnelMode = !!(driving && this.camUnder);
    if (!driving) this.camUnder = false;
    this.tunGroup.visible = this.tunnelMode;
    const cx = camera.position.x, cz = camera.position.z;
    // (a chunk's centre is up to 0.71 of its side from anything in it)
    const R = RANGE, pad = CHUNK * 0.71, tm = this.tunnelMode;
    for (const e of this.chunks) {
      const d = Math.hypot(e.x - cx, e.z - cz) - pad;
      if (e.bed) e.bed.visible = !tm && d < R.bed;
      if (e.flat) e.flat.visible = d < (tm ? 300 : R.flat);
      if (e.near) e.near.visible = !tm && d < R.near;
      if (e.sign) e.sign.visible = d < R.sign;
      if (e.card) e.card.visible = !tm && d < R.flat;
      if (e.tun) e.tun.visible = d < 900;
    }
    for (const t of this.trains) {
      const d = Math.hypot(t.cx - cx, t.cz - cz);
      const buried = t.buried();
      const vis = t.state !== 'off' && (t.driver === 'player' || (d < RANGE.train && (this.tunnelMode ? d < 900 : !buried)));
      t.group.visible = vis;
      if (vis) t.pose();
    }
    // people and cars on the track
    if (p) this._guard(dt, p);
    // the operator's readout
    if (driving && this.hud) {
      this._hudT = (this._hudT || 0) - dt;
      if (this._hudT <= 0) { this._hudT = 0.25; this.hud.setObjective(pv.readout()); }
    }
  }

  /**
   * THE TRACK AT GRADE IS NOT A FORCE FIELD. You, on foot or in a car, on
   * the track: an oncoming train sounds its horn and brakes for you; a train
   * that reaches you shoves you off the track and hurts. Only at grade -- the
   * guideway and the bores are nowhere you can be.
   */
  _guard(dt, p) {
    const pv = p.vehicle;
    if (pv && pv.spec.rail) return;
    const x = p.position.x, z = p.position.z;
    if (!this.onGradeCorridor(x, z)) return;
    const rad = pv ? pv.halfWid * 0.9 + 0.3 : 0.35;
    for (const k of ['sb', 'nb']) {
      const tr = this.tracks[k];
      const q = tr.nearest(x, z, 8);
      if (!q) continue;
      const ki = tr.KD[tr.idx(q.s)];
      if (ki !== FILL && ki !== CROSS) continue;
      if (Math.abs((pv ? pv.y : p.y) - tr.y(q.s)) > 2.5) continue;
      const foul = q.d < LINK.wid / 2 + rad + 0.3;
      for (const t of this.trains) {
        if (t.track !== tr || t.state === 'off' || t.driver === 'player') continue;
        const ahead = (q.s - t.lead) * t.dir;              // metres in front of its nose
        const within = (q.s - t.tail) * t.dir > -1 && ahead < 1;
        if (foul && ahead > 0 && ahead < 40 + t.u * t.u / (2 * LINK.brake) * 1.2) t.obstruct(ahead);
        if (foul && within && Math.abs(t.u) > 0.3) {
          // shove off the track, sideways
          const h = tr.H[tr.idx(q.s)], lx = Math.cos(h), lz = -Math.sin(h);
          const push = LINK.wid / 2 + rad + 0.35 - q.d;
          const sp = Math.abs(t.u);
          if (pv) {
            pv.x += lx * q.side * push; pv.z += lz * q.side * push;
            pv.vLong *= 0.3;
            if (this._hitCd <= 0 || this._hitCd === undefined) {
              this._hitCd = 1;
              if (this.game) { this.game.onCrash(sp * 3.2, false); this.game.damagePlayer(sp * 4.5, 'crash'); }
              if (pv.damage) pv.damage(sp * 6, true);
              this.say('Hit by a Link train!');
            }
          } else {
            p.x += lx * q.side * push; p.z += lz * q.side * push;
            if (this._hitCd <= 0 || this._hitCd === undefined) {
              this._hitCd = 1;
              if (this.game) { this.game.onCrash(sp * 2, false); if (sp > 1) this.game.damagePlayer(sp * 7, 'crash'); }
            }
          }
        }
      }
    }
    this._hitCd = (this._hitCd || 0) - dt;
  }

  onGradeCorridor(x, z) {
    return !!this.gradeCells && this.gradeCells.has(Math.floor(x / 50) * 100003 + Math.floor(z / 50));
  }

  /**
   * For traffic.js: is a train on (or about to be on) the track at (x, z)?
   * An AI car stops short of a train crossing its road, and of one that
   * will be there within a few seconds.
   */
  blocks(x, z, y) {
    if (!this.onGradeCorridor(x, z)) return false;
    for (const k of ['sb', 'nb']) {
      const tr = this.tracks[k];
      const q = tr.nearest(x, z, 6);
      if (!q || q.d > LINK.wid / 2 + 1.6) continue;
      const ki = tr.KD[tr.idx(q.s)];
      if (ki !== FILL && ki !== CROSS) continue;
      if (y !== undefined && Math.abs(y - tr.y(q.s)) > 3) continue;
      for (const t of this.trains) {
        if (t.track !== tr || t.state === 'off') continue;
        const reach = Math.max(8, Math.abs(t.u) * 5);
        const a = t.tail - t.dir * 3, b = t.lead + t.dir * reach;
        if ((q.s - a) * (q.s - b) <= 0) return true;
      }
    }
    return false;
  }

  /** A train you can step into from here: stopped at the station whose
   *  street entrance you are at, doors open. */
  boardable(x, y, z) {
    const st = this.waitingAt(x, z);
    if (!st) return null;
    let best = null;
    for (const t of this.trains) {
      if (t.driver || t.state !== 'dwell' || t.station !== st) continue;
      if (!best || t.timer > best.timer) best = t;
    }
    return best;
  }

  /** When the next train in each direction is due at `st`, in seconds (null: none coming). */
  nextAt(st) {
    const out = {};
    for (const k of ['sb', 'nb']) {
      const tr = this.tracks[k], sS = st.s[k];
      let best = null;
      for (const t of this.trains) {
        if (t.track !== tr || t.state === 'off') continue;
        const d = (sS - t.s) * t.dir;
        if (d < -5) continue;
        if (t.state === 'dwell' && t.station === st) { best = 0; break; }
        // ~13 m/s running average plus the stops between
        const stops = this.stations.filter((q) => { const e = (q.s[k] - t.s) * t.dir; return e > 5 && e < d - 5; }).length;
        const eta = d / 13 + stops * (LINK.dwell + 12) + (t.state === 'dwell' ? t.timer : 0);
        if (best === null || eta < best) best = eta;
      }
      out[k] = best;
    }
    return out;
  }

  /** ENTER at an entrance with no train in: when the next ones are due. */
  onWait(x, z) {
    const st = this.waitingAt(x, z);
    if (!st) return false;
    const n = this.nextAt(st);
    const fmt = (s) => s === null ? 'none coming' : s < 8 ? 'arriving now' : s < 60 ? `${Math.ceil(s / 10) * 10} s` : `${Math.floor(s / 60)} min ${Math.round(s % 60 / 10) * 10} s`;
    this.say(`${st.full} Station — to Lynnwood: ${fmt(n.nb)} · to Federal Way: ${fmt(n.sb)}. Wait here and tap ENTER when a train is in`, 4800);
    return true;
  }

  /** Where you step off, or null if the doors stay shut: at a station, its street entrance. */
  exitSpot(t) {
    const st = t.stationHere();
    if (!st) return null;
    return { x: st.ent.x, z: st.ent.z, y: st.ent.y };
  }
  get noExitMsg() { return 'The doors only open at a station — stop at a platform'; }

  onBoard(t) {
    t.driver = 'player';
    t.mode = 'free';
    const st = t.stationHere();
    t.arrival = { from: st, t: 0, rated: false };
    if (st) t.lastStop = st;
    t.doors = true;
    this._objBefore = this.hud ? this.hud.objective.textContent : '';
    const to = t.dir > 0 ? 'Federal Way Downtown' : 'Lynnwood City Center';
    this.say(`1 Line to ${to} — you're driving. POWER to go, BRAKE to stop: every platform has a stop mark`, 4600);
  }
  onLeave(t) {
    t.resume();
    if (this.hud) this.hud.setObjective(this._objBefore || '');
    this.camUnder = false;
  }
  onDoors(t, open) {
    if (this.audio && this.audio.chime && this.player && Math.hypot(this.player.position.x - t.x, this.player.position.z - t.z) < 90) this.audio.chime(open);
  }
  onArrive(t, st, err, secs) {
    const e = Math.abs(err);
    let pay = 0, verdict;
    if (e < 1) { verdict = 'right on the mark'; pay = 60; }
    else if (e < 3) { verdict = `${e.toFixed(1)} m ${err > 0 ? 'short' : 'past'} — a good stop`; pay = 30; }
    else { verdict = `${e.toFixed(1)} m ${err > 0 ? 'short of' : 'past'} the mark`; pay = 10; }
    if (this.game && pay) this.game.money += pay;
    const mm = Math.floor(secs / 60), ss = Math.round(secs % 60).toString().padStart(2, '0');
    this.say(`${st.full} Station${secs > 0 ? ` in ${mm}:${ss}` : ''} — ${verdict}${pay ? ` +$${pay}` : ''}. Doors open`, 4200);
    this.onDoors(t, true);
  }
  onCollide(t, speed) {
    this.say(`Collision with the train ahead at ${Math.round(speed * 3.6)} km/h!`);
    if (this.game) { this.game.onCrash(speed * 2, false); this.game.damagePlayer(speed * 6, 'crash'); }
  }
  onEnd(t) {
    this.say('End of the map — the line runs on beyond it. POWER to change ends and take the other track back', 4200);
  }
}

// ---------------------------------------------------------------------------
// The car: a low-floor three-section LRV, a cab at each end, as Link's
// Series 2 cars look [S70][ST]: white over a navy skirt with a teal line, a
// dark window band, four double doors a side, the pantograph over the short
// centre section. Built once in car-local metres (+z toward the B end, y = 0
// on the rail head, x to the left), then copied four times into one train
// geometry skinned to twelve bones.

const LIV = {
  white: [0.90, 0.91, 0.90], navy: [0.05, 0.12, 0.32], teal: [0.04, 0.52, 0.49], pillar: [0.05, 0.055, 0.06],
  door: [0.78, 0.79, 0.80], roof: [0.66, 0.67, 0.68], under: [0.07, 0.07, 0.075], bogie: [0.12, 0.12, 0.13],
  seat: [0.10, 0.26, 0.48], floor: [0.30, 0.30, 0.31], liner: [0.80, 0.80, 0.78], ceil: [0.88, 0.88, 0.86],
  pole: [0.78, 0.78, 0.8], amber: [1.0, 0.62, 0.12], lamp: [1.0, 0.98, 0.9], red: [0.85, 0.08, 0.06], wheel: [0.22, 0.2, 0.19],
  bellows: [0.09, 0.09, 0.1], green: [0.2, 0.9, 0.35],
};
const HW = LINK.wid / 2;
// the half-section, bottom to top: [y, half-width, band colour above]
const LPROF = [
  [0.16, HW - 0.07, 'navy'], [0.32, HW - 0.02, 'navy'], [0.84, HW, 'teal'], [0.92, HW, 'white'], [1.06, HW, 'win'],
  [2.26, HW - 0.04, 'white'], [2.62, HW - 0.075, 'white'], [3.02, HW - 0.14, 'roof'], [3.34, HW - 0.33, 'roof'], [3.56, 0.66, 'roof'], [LINK.roof, 0, 'end'],
];
const bandCol = (t) => t === 'navy' ? LIV.navy : t === 'teal' ? LIV.teal : t === 'roof' ? LIV.roof : LIV.white;
const DOORS = [-10.3, -5.4, 5.4, 10.3];        // door centres, car-local z (on the A and B sections)
const NOSE = 1.25;                              // how far the cab's nose runs past its body sides

function buildLRVGeometry() {
  // Build one car into per-section builders, then copy it.
  const body = [0, 1, 2].map(() => new Builder(false)), trim = [0, 1, 2].map(() => new Builder(false));
  const half = LINK.carLen / 2;
  const secZ = [[-half, -half + LINK.secA], [-LINK.secC / 2, LINK.secC / 2], [half - LINK.secA, half]];

  // the sides of a stretch z0..z1 of section k, with its doors
  const sides = (k, z0, z1, doors) => {
    const B = body[k], T = trim[k];
    for (const sd of [1, -1]) {
      for (let i = 0; i < LPROF.length - 1; i++) {
        const [ya, wa, tag] = LPROF[i], [yb, wb] = LPROF[i + 1];
        const nn = (() => { const nx = sd * (yb - ya), ny = -(wb - wa), l = Math.hypot(nx, ny) || 1; return [nx / l, ny / l, 0]; })();
        const A = (z, y, w) => [sd * w, y, z];
        // pieces along z: door leaves take the door colour below the roofline
        let zc = z0;
        const cuts = [];
        for (const d of doors) cuts.push([d - 0.68, d + 0.68]);
        cuts.sort((p, q) => p[0] - q[0]);
        const pieces = [];
        for (const [c0, c1] of cuts) { if (c0 > zc) pieces.push([zc, c0, false]); pieces.push([c0, c1, true]); zc = c1; }
        if (zc < z1) pieces.push([zc, z1, false]);
        for (const [p0, p1, isDoor] of pieces) {
          if (isDoor && ya >= 0.3 && yb <= 2.3) {
            // a door: two leaves, glazed from 1.12 to 2.18, a dark seam down the middle
            if (tag === 'win') {
              const m = (p0 + p1) / 2;
              for (const [g0, g1] of [[p0 + 0.08, m - 0.05], [m + 0.05, p1 - 0.08]]) T.quad(A(g0, ya + 0.06, wa - 0.02), A(g1, ya + 0.06, wa - 0.02), A(g1, yb - 0.08, wb - 0.02), A(g0, yb - 0.08, wb - 0.02), nn, uv0, GLASS);
              B.quad(A(p0, ya, wa), A(p0 + 0.08, ya, wa), A(p0 + 0.08, yb, wb), A(p0, yb, wb), nn, uv0, LIV.pillar);
              B.quad(A(p1 - 0.08, ya, wa), A(p1, ya, wa), A(p1, yb, wb), A(p1 - 0.08, yb, wb), nn, uv0, LIV.pillar);
              B.quad(A(m - 0.05, ya, wa), A(m + 0.05, ya, wa), A(m + 0.05, yb, wb), A(m - 0.05, yb, wb), nn, uv0, LIV.pillar);
              B.quad(A(p0, ya, wa), A(p1, ya, wa), A(p1, ya + 0.06, wa), A(p0, ya + 0.06, wa), nn, uv0, LIV.door);
              B.quad(A(p0, yb - 0.08, wb), A(p1, yb - 0.08, wb), A(p1, yb, wb), A(p0, yb, wb), nn, uv0, LIV.door);
            } else {
              B.quad(A(p0, ya, wa), A(p1, ya, wa), A(p1, yb, wb), A(p0, yb, wb), nn, uv0, LIV.door);
            }
            continue;
          }
          if (tag === 'win') {
            // panes between black pillars, ~1.5 m a pane
            const len = p1 - p0, nP = Math.max(1, Math.round(len / 1.5)), w = len / nP;
            for (let j = 0; j < nP; j++) {
              const g0 = p0 + j * w + 0.07, g1 = p0 + (j + 1) * w - 0.07;
              T.quad(A(g0, ya, wa - 0.015), A(g1, ya, wa - 0.015), A(g1, yb, wb - 0.015), A(g0, yb, wb - 0.015), nn, uv0, GLASS);
              B.quad(A(p0 + j * w, ya, wa), A(g0, ya, wa), A(g0, yb, wb), A(p0 + j * w, yb, wb), nn, uv0, LIV.pillar);
              B.quad(A(g1, ya, wa), A(p0 + (j + 1) * w, ya, wa), A(p0 + (j + 1) * w, yb, wb), A(g1, yb, wb), nn, uv0, LIV.pillar);
            }
            continue;
          }
          B.quad(A(p0, ya, wa), A(p1, ya, wa), A(p1, yb, wb), A(p0, yb, wb), nn, uv0, bandCol(tag));
        }
      }
      // door details: the open-door buttons, lit green, and the step plate
      for (const d of doors) {
        T.quad([sd * (HW + 0.004), 1.18, d - 0.78], [sd * (HW + 0.004), 1.18, d - 0.7], [sd * (HW + 0.004), 1.26, d - 0.7], [sd * (HW + 0.004), 1.26, d - 0.78], [sd, 0, 0], uv0, LIV.green);
        B.quad([sd * (HW - 0.02), 0.3, d - 0.7], [sd * (HW + 0.03), 0.3, d - 0.7], [sd * (HW + 0.03), 0.3, d + 0.7], [sd * (HW - 0.02), 0.3, d + 0.7], UP, uv0, [0.4, 0.4, 0.4]);
      }
      // the underframe inside the skirt
      B.quad([sd * (HW - 0.12), 0.16, z0], [sd * (HW - 0.12), 0.16, z1], [sd * (HW - 0.12), 0.34, z1], [sd * (HW - 0.12), 0.34, z0], [-sd, 0, 0], uv0, LIV.under);
    }
    B.quad([-(HW - 0.12), 0.34, z0], [HW - 0.12, 0.34, z0], [HW - 0.12, 0.34, z1], [-(HW - 0.12), 0.34, z1], DOWN, uv0, LIV.under);
    // inside: floor, liners, ceiling, seats and poles
    const lin = HW - 0.1, fl = LINK.platH;
    B.quad([-lin, fl, z0], [lin, fl, z0], [lin, fl, z1], [-lin, fl, z1], UP, uv0, LIV.floor);
    B.quad([-(lin - 0.2), 2.42, z0], [lin - 0.2, 2.42, z0], [lin - 0.2, 2.42, z1], [-(lin - 0.2), 2.42, z1], DOWN, uv0, LIV.ceil);
    for (const sd of [1, -1]) {
      B.quad([sd * lin, fl, z0], [sd * lin, fl, z1], [sd * lin, 1.06, z1], [sd * lin, 1.06, z0], [-sd, 0, 0], uv0, LIV.liner);
      B.quad([sd * lin, 2.26, z0], [sd * lin, 2.26, z1], [sd * (lin - 0.2), 2.42, z1], [sd * (lin - 0.2), 2.42, z0], [-sd, -0.6, 0], uv0, LIV.liner);
      // a lit strip down each side of the ceiling
      T.quad([sd * (lin - 0.35), 2.41, z0 + 0.2], [sd * (lin - 0.2), 2.41, z0 + 0.2], [sd * (lin - 0.2), 2.41, z1 - 0.2], [sd * (lin - 0.35), 2.41, z1 - 0.2], DOWN, uv0, LIV.lamp);
    }
    // seats: facing pairs in the bays between doors, a pole at each
    const bays = [];
    let zc = z0 + 0.4;
    const cuts = doors.map((d) => [d - 0.95, d + 0.95]).sort((p, q) => p[0] - q[0]);
    for (const [c0, c1] of cuts) { if (c0 - zc > 1.4) bays.push([zc, c0]); zc = Math.max(zc, c1); }
    if (z1 - 0.4 - zc > 1.4) bays.push([zc, z1 - 0.4]);
    for (const [b0, b1] of bays) {
      for (let z = b0 + 0.45; z < b1 - 0.4; z += 0.85) {
        for (const sd of [1, -1]) {
          const x = sd * (lin - 0.48);
          B.box(x, fl, z, 0.9, 0.44, 0.45, 0, LIV.seat);
          B.box(x, fl + 0.44, z + 0.19, 0.9, 0.55, 0.08, 0, LIV.seat);
        }
      }
      T.tube([0.35, fl, (b0 + b1) / 2], [0.35, 2.42, (b0 + b1) / 2], 0.02, 5, LIV.pole);
      T.tube([-0.35, fl, (b0 + b1) / 2], [-0.35, 2.42, (b0 + b1) / 2], 0.02, 5, LIV.pole);
    }
    for (const d of doors) for (const sd of [1, -1]) T.tube([sd * (lin - 0.1), fl, d - 0.8], [sd * (lin - 0.1), 2.3, d - 0.8], 0.02, 5, LIV.pole);
  };

  // the roof between z0 and z1 is the profile's top bands (done in sides);
  // equipment on it
  const roofBox = (k, z, len, w, h, col) => body[k].box(0, LINK.roof - 0.1, z, w, h + 0.1, len, 0, col);

  // A cab nose: the profile swept round a superellipse in plan, longest at
  // the bumper and raking back up the windscreen; the windscreen wraps the
  // front, the destination sign is over it, lamps low. `dir` +1: the +z end.
  const cab = (k, z0, dir) => {
    const B = body[k], T = trim[k];
    const LEN = (y) => y < 0.9 ? NOSE * (0.86 + 0.14 * (y / 0.9)) : y < 1.06 ? NOSE : NOSE - Math.pow((y - 1.06) / (LINK.roof - 1.06), 1.25) * (NOSE - 0.12);
    const N = 10, EXP = 3.2;
    const rows = LPROF.map(([y, w]) => {
      const row = [];
      for (let j = 0; j <= N; j++) {
        const th = (j / N) * Math.PI / 2;
        const c = Math.pow(Math.cos(th), 2 / EXP), s = Math.pow(Math.sin(th), 2 / EXP);
        row.push([w * c, y, z0 + dir * LEN(y) * s]);
      }
      return row;
    });
    for (const sd of [1, -1]) {
      const up = rows.map((r) => r.map(([x, y, z]) => [sd * x, y, z]));
      const out = [sd, 0, dir];
      for (let i = 0; i < up.length - 1; i++) {
        const tag = LPROF[i][2], y = LPROF[i][0];
        const r0 = up[i], r1 = up[i + 1];
        const cut = 3;
        if (tag === 'win') {
          B.patch([r0.slice(0, cut + 1), r1.slice(0, cut + 1)], LIV.pillar, out);
          T.patch([r0.slice(cut).map(([x, yy, z]) => [x * 0.995, yy, z - dir * 0.01]), r1.slice(cut).map(([x, yy, z]) => [x * 0.995, yy, z - dir * 0.01])], GLASS, out);
        } else if (tag === 'white' && y > 2.2 && y < 2.3) {
          // the destination sign over the windscreen, lit amber
          B.patch([r0.slice(0, 5), r1.slice(0, 5)], LIV.pillar, out);
          T.patch([r0.slice(4).map(([x, yy, z]) => [x, yy, z + dir * 0.004]), r1.slice(4).map(([x, yy, z]) => [x, yy, z + dir * 0.004])], LIV.amber, out);
        } else if (tag === 'teal' || tag === 'navy') {
          B.patch([r0, r1], bandCol(tag), out);
        } else B.patch([r0, r1], bandCol(tag), out);
      }
      // lamps: headlamp pair and a red marker, low on the nose
      const lz = (y) => z0 + dir * (LEN(y) - 0.02);
      T.spheroid(sd * 0.78, 0.66, lz(0.66) - dir * 0.06, 0.1, 8, 5, LIV.lamp, 1);
      T.spheroid(sd * 1.02, 0.66, lz(0.66) - dir * 0.16, 0.06, 6, 4, LIV.red, 1);
      T.spheroid(sd * 0.55, 0.66, lz(0.66) - dir * 0.02, 0.07, 6, 4, LIV.lamp, 1);
      // the camera-mirror arm at the cab corner
      T.tube([sd * (HW - 0.05), 2.3, z0 + dir * 0.35], [sd * (HW + 0.22), 2.34, z0 + dir * 0.45], 0.025, 4, LIV.pillar);
      B.box(sd * (HW + 0.24), 2.2, z0 + dir * 0.46, 0.1, 0.2, 0.14, 0, LIV.pillar);
    }
    // the anticlimber and coupler cover, and the cab's console behind the glass
    B.box(0, 0.2, z0 + dir * (NOSE * 0.86 - 0.05), 1.9, 0.3, 0.14, 0, LIV.under);
    B.box(0, 0.42, z0 + dir * (NOSE * 0.86 + 0.02), 0.5, 0.26, 0.2, 0, LIV.pillar);
    B.box(0, LINK.platH, z0 + dir * 0.45, 2.2, 0.9, 0.6, 0, [0.2, 0.21, 0.22]);
    B.box(-0.55, LINK.platH, z0 - dir * 0.4, 0.55, 0.6, 0.55, 0, LIV.seat);
    // the cab's back wall, so the saloon reads as a separate room
    B.quad([-(HW - 0.1), LINK.platH, z0 - dir * 1.1], [HW - 0.1, LINK.platH, z0 - dir * 1.1], [HW - 0.1, 2.42, z0 - dir * 1.1], [-(HW - 0.1), 2.42, z0 - dir * 1.1], [0, 0, dir], uv0, LIV.liner);
  };

  // an articulation: the bulkheads and the bellows between two sections
  const joint = (k, z, dir, bellows) => {
    const B = body[k];
    for (let i = 0; i < LPROF.length - 1; i++) {
      const [ya, wa] = LPROF[i], [yb, wb] = LPROF[i + 1];
      B.quad([-wa, ya, z], [wa, ya, z], [wb, yb, z], [-wb, yb, z], [0, 0, dir], uv0, LIV.liner);
    }
    if (bellows) {
      const b0 = z, b1 = z + dir * (LINK.carLen - LINK.secA * 2 - LINK.secC) / 2;
      for (let r = 0; r < 5; r++) {
        const zz = b0 + (b1 - b0) * (r + 0.5) / 5;
        B.box(0, 0.3, zz, 2.46 - (r % 2) * 0.05, 3.08, Math.abs(b1 - b0) / 5 + 0.01, 0, r % 2 ? LIV.bellows : [0.14, 0.14, 0.15]);
      }
    }
  };

  // a bogie: frame, springs, four wheels on the rail heads
  const bogie = (k, z, motor) => {
    const B = body[k];
    B.box(0, 0.28, z, 2.0, 0.22, 2.3, 0, LIV.bogie);
    for (const sd of [1, -1]) {
      B.box(sd * 0.92, 0.2, z, 0.16, 0.34, 2.6, 0, LIV.bogie);
      for (const az of [-0.9, 0.9]) {
        B.tube([sd * 0.66, 0.33, z + az], [sd * 0.8, 0.33, z + az], 0.33, 12, LIV.wheel, true);
        B.tube([sd * 0.8, 0.33, z + az], [sd * 0.86, 0.33, z + az], 0.12, 8, [0.5, 0.5, 0.52], true);
      }
      if (motor) B.box(sd * 0.3, 0.22, z, 0.5, 0.3, 1.1, 0, [0.16, 0.16, 0.17]);
    }
  };

  // A section: sides with its doors, roof bands included; cabs, joints and
  // bogies at its ends.
  // A: -half .. -half + secA, cab at -z, doors DOORS[0..1]; C centre; B mirror.
  sides(0, secZ[0][0] + NOSE, secZ[0][1], DOORS.slice(0, 2));
  cab(0, secZ[0][0] + NOSE, -1);
  joint(0, secZ[0][1], 1, true);
  sides(1, secZ[1][0], secZ[1][1], []);
  joint(1, secZ[1][0], -1, false);
  joint(1, secZ[1][1], 1, false);
  sides(2, secZ[2][0], secZ[2][1] - NOSE, DOORS.slice(2));
  cab(2, secZ[2][1] - NOSE, 1);
  joint(2, secZ[2][0], -1, true);
  bogie(0, secZ[0][0] + 2.6, true);
  bogie(1, 0, false);
  bogie(2, secZ[2][1] - 2.6, true);
  // roof equipment: an air-conditioning unit on each long section, the
  // traction gear, and the pantograph over the centre section
  for (const k of [0, 2]) {
    const zc = (secZ[k][0] + secZ[k][1]) / 2;
    roofBox(k, zc + (k ? 1.2 : -1.2), 3.2, 1.7, 0.36, [0.74, 0.75, 0.76]);
    roofBox(k, zc + (k ? -2.8 : 2.8), 2.0, 1.3, 0.3, [0.6, 0.61, 0.62]);
  }
  {
    const B = body[1], T = trim[1], y0 = LINK.roof;
    B.box(0, y0 - 0.05, 0, 1.4, 0.18, 1.6, 0, [0.5, 0.5, 0.52]);
    for (const x of [-0.5, 0.5]) for (const z of [-0.6, 0.6]) T.tube([x, y0 + 0.12, z], [x, y0 + 0.3, z], 0.05, 6, [0.72, 0.4, 0.2]);
    // the arms: lower arm up and back, upper arm forward to the head
    const hy = LINK.wire - 0.02;
    T.tube([0, y0 + 0.3, -0.5], [0, y0 + (hy - y0) * 0.5, 0.55], 0.04, 5, LIV.pole);
    T.tube([0, y0 + (hy - y0) * 0.5, 0.55], [0, hy - 0.1, -0.05], 0.03, 5, LIV.pole);
    T.tube([-0.3, y0 + 0.3, -0.5], [0.3, y0 + 0.3, -0.5], 0.04, 5, LIV.pole);
    B.box(0, hy - 0.1, -0.05, 1.7, 0.08, 0.28, 0, [0.15, 0.15, 0.16]);
  }

  // copy the car four times into train geometries skinned to 12 bones
  const assemble = (list) => {
    const parts = list.map((b) => b.build());
    let nv = 0, ni = 0;
    for (const g of parts) { nv += g.attributes.position.count; ni += g.index.count; }
    nv *= LINK.cars; ni *= LINK.cars;
    const pos = new Float32Array(nv * 3), nor = new Float32Array(nv * 3), col = new Float32Array(nv * 3);
    const idx = nv > 65535 ? new Uint32Array(ni) : new Uint16Array(ni);
    const si = new Uint16Array(nv * 4), sw = new Float32Array(nv * 4);
    let v = 0, q = 0;
    for (let c = 0; c < LINK.cars; c++) {
      const dz = -LINK.len / 2 + LINK.carLen / 2 + c * (LINK.carLen + LINK.couple);
      parts.forEach((g, k) => {
        const P = g.attributes.position.array, Nn = g.attributes.normal.array, Cc = g.attributes.color.array, I = g.index.array;
        const n = g.attributes.position.count;
        for (let i = 0; i < n; i++) {
          pos[(v + i) * 3] = P[i * 3]; pos[(v + i) * 3 + 1] = P[i * 3 + 1]; pos[(v + i) * 3 + 2] = P[i * 3 + 2] + dz;
          nor[(v + i) * 3] = Nn[i * 3]; nor[(v + i) * 3 + 1] = Nn[i * 3 + 1]; nor[(v + i) * 3 + 2] = Nn[i * 3 + 2];
          col[(v + i) * 3] = Cc[i * 3]; col[(v + i) * 3 + 1] = Cc[i * 3 + 1]; col[(v + i) * 3 + 2] = Cc[i * 3 + 2];
          si[(v + i) * 4] = c * 3 + k; sw[(v + i) * 4] = 1;
        }
        for (let i = 0; i < I.length; i++) idx[q + i] = I[i] + v;
        v += n; q += I.length;
      });
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    geo.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(si, 4));
    geo.setAttribute('skinWeight', new THREE.Float32BufferAttribute(sw, 4));
    geo.setIndex(new THREE.BufferAttribute(idx, 1));
    return geo;
  };
  const geo = { body: assemble(body), trim: assemble(trim) };
  tagGlass(geo.trim);
  return geo;
}

// ---------------------------------------------------------------------------
// A train: the posed model, its place on its track, and the two ways it is
// driven -- by you from a cab, or in service.

const G_ACC = 9.81;

export class LinkTrain {
  constructor(sys, id, track) {
    this.sys = sys;
    this.id = id;
    this.track = track;
    this.typeName = 'link';
    this.spec = { rail: true, link: true, hand: 'link', engine: 'traction', len: 16, wid: LINK.wid, roof: LINK.roof,
      topKph: LINK.vMax * 3.6, mass: 160 };
    this.x = 0; this.y = 0; this.z = 0; this.heading = 0; this.cx = 0; this.cz = 0;
    this.vLong = 0; this.vLat = 0; this.vy = 0; this.speed = 0;
    this.halfLen = 2.5; this.halfWid = LINK.wid / 2; this.radius = 3;
    this.health = 100; this.dead = false; this.exploded = false;
    this.mode = 'service'; this.wasParked = false;
    this.skid = 0; this.airborne = false; this.stunt = false; this.stuntLaunch = null;
    this.rampAlong = 0; this.latAcc = 0; this.accLong = 0; this.hitCd = 0;
    this._fwd = { x: 0, z: 1 };
    this.s = 0; this.u = 0; this.dir = track.dir;
    this.driver = null;
    this.state = 'run'; this.timer = 0; this.station = null;
    this.obstructAt = Infinity; this.hornT = 0; this.lastStop = null; this.held = 0;
    this.arrival = null; this.doors = false; this.warned = 0;
    this.offT = 0;
    const g = sys.geo || (sys.geo = buildLRVGeometry());
    this.bones = [];
    for (let k = 0; k < SECTIONS.length; k++) {
      const b = new THREE.Bone();
      b.position.set(0, 0, (SECTIONS[k][0] + SECTIONS[k][1]) / 2);
      this.bones.push(b);
    }
    this.group = new THREE.Group();
    this.group.name = `link:train${id}`;
    for (const b of this.bones) this.group.add(b);
    this.group.updateMatrixWorld(true);
    const skel = new THREE.Skeleton(this.bones);
    this.meshes = [[g.body, sys.bodyMat], [g.trim, sys.trimMat]].map(([geo, m]) => {
      const mesh = new THREE.SkinnedMesh(geo, m);
      mesh.bind(skel, new THREE.Matrix4());
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.boundingSphere = new THREE.Sphere(new THREE.Vector3(), LINK.len / 2 + 4);
      this.group.add(mesh);
      return mesh;
    });
    this._m = new THREE.Matrix4();
    this._x = new THREE.Vector3(); this._y = new THREE.Vector3(); this._z = new THREE.Vector3();
  }

  get lead() { return this.s + this.dir * LINK.len / 2; }
  get tail() { return this.s - this.dir * LINK.len / 2; }
  get forward() { return this._fwd; }
  setDetailed() {}
  sync() {}
  damage() {}

  place(s, dir) {
    this.s = s; this.dir = dir; this.u = 0;
    this._point();
  }

  /** Every part of it in a bore (nothing of it above ground to draw)? */
  buried() {
    const tr = this.track;
    return tr.kind(this.s - LINK.len / 2) === TUN && tr.kind(this.s) === TUN && tr.kind(this.s + LINK.len / 2) === TUN;
  }

  /** The station it is standing at (centre within 12 m, stopped), or null. */
  stationHere() {
    if (Math.abs(this.u) > 0.1) return null;
    for (const st of this.sys.stations) if (Math.abs(st.s[this.track.key] - this.s) < 12) return st;
    return null;
  }

  _point() {
    const tr = this.track;
    const sl = this.lead - this.dir * 2.0;
    this.x = tr.x(sl); this.z = tr.z(sl); this.y = tr.y(sl);
    this.cx = tr.x(this.s); this.cz = tr.z(this.s);
    this.heading = tr.heading(sl) + (this.dir > 0 ? 0 : Math.PI);
    this._fwd.x = Math.sin(this.heading); this._fwd.z = Math.cos(this.heading);
    this.vLong = this.u * this.dir;
    this.speed = Math.abs(this.u);
  }

  pose() {
    const tr = this.track;
    for (let k = 0; k < SECTIONS.length; k++) {
      const s0 = this.s + SECTIONS[k][0], s1 = this.s + SECTIONS[k][1];
      const ax = tr.x(s0), ay = tr.y(s0), az = tr.z(s0), bx = tr.x(s1), by = tr.y(s1), bz = tr.z(s1);
      this._z.set(bx - ax, by - ay, bz - az).normalize();
      this._x.set(this._z.z, 0, -this._z.x).normalize();
      this._y.crossVectors(this._z, this._x);
      this._m.makeBasis(this._x, this._y, this._z);
      const bone = this.bones[k];
      bone.quaternion.setFromRotationMatrix(this._m);
      bone.position.set((ax + bx) / 2, (ay + by) / 2, (az + bz) / 2);
    }
    this.group.updateMatrixWorld(true);
    for (const m of this.meshes) m.boundingSphere.center.set(this.cx, tr.y(this.s) + 1.8, this.cz);
  }

  /** Speed limit at s for the run (and the whole train must be under it). */
  limitAt(s) {
    const tr = this.track;
    return tr.LIM ? tr.LIM[tr.idx(s)] || LINK.vMax : LINK.vMax;
  }

  /** Something on the track `ahead` metres in front of the nose (_guard). */
  obstruct(ahead) { this.obstructAt = Math.min(this.obstructAt, ahead); }

  /** One step: tractive command in [-1, 1] along the lead direction, brake in [0, 1]. */
  step(dt, power, brake) {
    const tr = this.track;
    const v = this.u * this.dir;
    let a = 0;
    if (power > 0) a += LINK.acc * power * clamp(1.4 - Math.abs(v) / LINK.vMax, 0, 1) * (v < -0.2 ? 0 : 1);
    if (power < 0) a += 0.5 * power * (Math.abs(v) < 2.4 ? 1 : 0);
    const bk = brake > 0.92 ? LINK.brakeEmerg : LINK.brake * brake;
    const drag = 0.03 + 0.0006 * v * v;
    const slope = (tr.y(this.s + 3) - tr.y(this.s - 3)) / 6;
    let vn = v + (a - G_ACC * slope * this.dir * 0.8) * dt;
    const stop = (bk + drag) * dt;
    if (Math.abs(vn) <= stop && power === 0) vn = 0;
    else vn -= Math.sign(vn) * stop;
    this.u = vn * this.dir;
    this.accLong = a;
    this.s += this.u * dt;
    const ev = {};
    // the ends of the line (the map's edge)
    const lo = LINK.len / 2 + 0.5, hi = tr.len - LINK.len / 2 - 0.5;
    if (this.driver === 'player' && (this.s < lo || this.s > hi)) {
      ev.end = Math.abs(this.u);
      this.s = clamp(this.s, lo, hi);
      this.u = 0;
    }
    // the train ahead, and behind (a player's train reversing)
    for (const o of this.sys.trains) {
      if (o === this || o.track !== tr || o.state === 'off') continue;
      const gap = Math.abs(o.s - this.s) - LINK.len;
      if (gap < 0) {
        const rel = Math.abs(this.u - o.u);
        const sg = Math.sign(this.s - o.s) || 1;
        this.s = o.s + sg * (LINK.len + 0.05);
        if (rel > 1.5) ev.collide = rel;
        const m = (this.u + o.u) / 2;
        this.u = m; o.u = m;
      }
    }
    const k = tr.curv(this.s);
    this.latAcc = this.u * this.u * Math.abs(k);
    ev.lat = this.latAcc;
    this._point();
    return ev;
  }

  /** The speed that still brakes, at `b`, to the stop ahead and every limit. */
  allowed(stopLead, b) {
    const dirn = this.dir, lead = this.lead;
    let v = stopLead === null ? LINK.vMax : Math.sqrt(Math.max(0, 2 * b * Math.max(0, (stopLead - lead) * dirn)));
    for (let d = 0; d <= 320; d += 10) v = Math.min(v, Math.sqrt(this.limitAt(lead + dirn * d) ** 2 + 2 * b * d));
    // the whole train under whatever it is still on
    for (let d = 0; d <= LINK.len; d += 10) v = Math.min(v, this.limitAt(lead - dirn * d));
    return v;
  }

  /** The next stop ahead: a station it has not just stopped at, whose
   *  mark it has not passed by more than 6 m -- or null (run off the end). */
  nextStation() {
    let best = null, bd = Infinity;
    for (const st of this.sys.stations) {
      if (st === this.lastStop) continue;
      const d = (st.s[this.track.key] - this.s) * this.dir;
      if (d > -6 && d < bd) { bd = d; best = st; }
    }
    return best;
  }

  service(dt) {
    const sys = this.sys, tr = this.track;
    if (this.state === 'off') {
      // beyond the map's edge: the rest of the line, a terminal, a turn back
      this.offT -= dt;
      if (this.offT > 0) return;
      const nt = tr.other, s0 = this.dir > 0 ? tr.len : 0;   // the end it left by
      const s = clamp(s0 + (s0 > 0 ? -1 : 1) * (LINK.len / 2 + 2), LINK.len / 2, nt.len - LINK.len / 2);
      for (const o of sys.trains) if (o !== this && o.track === nt && o.state !== 'off' && Math.abs(o.s - s) < LINK.len + 200) { this.offT = 5; return; }
      this.track = nt; this.dir = nt.dir; this.s = s; this.u = this.dir * 8; this.lastStop = null;
      this.state = 'run';
      this._point();
      return;
    }
    if (this.state === 'dwell') {
      this.u = 0;
      this.timer -= dt;
      // A TRAIN WAITS FOR YOU: standing at this station's entrance, the
      // train at its platform holds (up to two minutes)
      const p = sys.player;
      if (p && p.onFoot && this.station && Math.hypot(p.position.x - this.station.ent.x, p.position.z - this.station.ent.z) < 14 && this.timer < 2 && this.held < 120) {
        this.timer = 2; this.held += dt;
      }
      if (this.timer <= 0) {
        this.state = 'run'; this.doors = false;
        sys.onDoors(this, false);
      }
      this.step(dt, 0, 1);
      return;
    }
    const st = this.nextStation();
    const stopLead = st ? st.s[tr.key] + this.dir * LINK.len / 2 : null;
    let vAllow = this.allowed(stopLead, 1.0);
    // the train ahead: moving block, 30 m behind its tail
    const o = sys.ahead(this);
    if (o) {
      const gap = (o.tail - this.lead) * this.dir - 30;
      vAllow = Math.min(vAllow, Math.sqrt(Math.max(0, 2 * 1.0 * gap)) + Math.max(0, o.u * o.dir) * 0.5);
      if (gap < 0) vAllow = 0;
    }
    // something on the track ahead: brake for it (planned at the service
    // rate, the emergency brake the moment it is late), and ring the bell
    let emerg = false;
    if (this.obstructAt < Infinity) {
      const vo = Math.sqrt(Math.max(0, 2 * 1.1 * (this.obstructAt - 8)));
      if (this.u * this.dir > vo + 0.2) emerg = true;
      vAllow = Math.min(vAllow, vo);
      if (this.hornT <= 0 && sys.audio && sys.audio.ready && sys.player && Math.hypot(sys.player.position.x - this.x, sys.player.position.z - this.z) < 200) {
        this.hornT = 2.2;
        sys.audio.play('tram_bell', { gain: 1, x: this.x, y: this.y + 2, z: this.z });
      }
      this.obstructAt = Infinity;
    }
    this.hornT -= dt;
    const v = this.u * this.dir;
    let power = 0, brake = 0;
    if (v < vAllow - 0.8) power = 1;
    else if (v > vAllow + 0.3) brake = clamp((v - vAllow) / 1.5, 0.25, 1);
    else if (v > vAllow) brake = 0.25;
    const left = stopLead === null ? Infinity : (stopLead - this.lead) * this.dir;
    if (left < 0.3 || emerg) { power = 0; brake = 1; }
    else if (left < 4 && v < 0.8 && (!o || (o.tail - this.lead) * this.dir > 32)) power = 0.35;
    this.step(dt, power, brake);
    if (st && Math.abs(this.u) < 0.05 && left < 0.8) {
      this.u = 0;
      this.state = 'dwell'; this.timer = LINK.dwell; this.station = st; this.held = 0; this.doors = true; this.lastStop = st;
      sys.onDoors(this, true);
    }
    // off the end of the map
    if (!st && ((this.dir > 0 && this.lead > tr.len - 2) || (this.dir < 0 && this.lead < 2))) {
      this.state = 'off'; this.offT = 40 + (this.id % 5) * 6; this.u = 0;
      this.group.visible = false;
    }
  }

  /** Back into service from wherever it stands (you left it). */
  resume() {
    this.driver = null;
    this.mode = 'service';
    const st = this.stationHere();
    if (st) { this.state = 'dwell'; this.station = st; this.timer = 6; this.held = 0; this.lastStop = st; } else this.state = 'run';
  }

  /** In a bore the camera goes into the cab: the driver's view down the
   *  tunnel through the windscreen (a chase boom would be in the rock). */
  camRig(p, dt) {
    const tr = this.track;
    const k = tr.kind(this.lead - this.dir * 20), kl = tr.kind(this.lead + this.dir * 4);
    const under = k === TUN || k === BOX || kl === TUN;
    this.sys.camUnder = under && (k === TUN || kl === TUN || this.sys.camUnder);
    if (!under) { this.sys.camUnder = false; this._cab = false; return false; }
    const cs = this.lead - this.dir * 1.15;
    const h = tr.heading(cs), lx = Math.cos(h), lz = -Math.sin(h);
    const want = new THREE.Vector3(tr.x(cs) + lx * 0.3 * this.dir, tr.y(cs) + 2.12, tr.z(cs) + lz * 0.3 * this.dir);
    const ls = this.lead + this.dir * 45;
    const look = new THREE.Vector3(tr.x(ls), tr.y(ls) + 1.6, tr.z(ls));
    // into the cab in one cut, then held rigidly: a seat does not lag
    p.camPos.copy(want);
    if (!this._cab) p.camLook.copy(look); else p.camLook.lerp(look, 1 - Math.exp(-10 * dt));
    this._cab = true;
    p.camRel = null; p.camLookRel = null; p.camUp = null;
    p.camYaw = Math.atan2(-this._fwd.x, -this._fwd.z);
    p.camFloor = null;
    return true;
  }

  /** The operator's readout. */
  readout() {
    const sys = this.sys;
    const here = this.stationHere();
    const mph = (v) => Math.round(v * 2.237);
    const lim = mph(Math.min(...[0, 20, 40, 60].map((d) => this.limitAt(this.lead + this.dir * d))));
    const to = this.dir > 0 ? 'Federal Way' : 'Lynnwood';
    if (here && this.doors) return `1 Line to ${to} · ${here.full} Station — doors open · POWER to depart`;
    const st = this.nextStation();
    const o = sys.ahead(this);
    const gap = o ? (o.tail - this.lead) * this.dir : Infinity;
    // the train ahead: a figure within 600 m, a warning inside braking distance
    const v = Math.abs(this.u), stopD = v * v / (2 * LINK.brake) + 40;
    const ahead = gap < stopD ? ` · STOP — TRAIN AHEAD ${Math.max(0, Math.round(gap))} m` : gap < 600 ? ` · train ahead ${Math.round(gap)} m` : '';
    if (!st) return `1 Line to ${to} · end of the map ahead · limit ${lim} mph${ahead}`;
    const left = (st.s[this.track.key] + this.dir * LINK.len / 2 - this.lead) * this.dir;
    return `Next: ${st.full} ${Math.max(0, left).toFixed(left < 30 ? 1 : 0)} m · limit ${lim} mph${ahead}`;
  }

  /** player.js calls this as it calls any vehicle's update. */
  update(dt, input) {
    const sys = this.sys, tr = this.track;
    this.driver = 'player';
    const thr = clamp(input.throttle || 0, 0, 1), brk = clamp(input.brake || 0, 0, 1);
    // THE END OF THE MAP: change ends and take the other track back (the
    // crossover and the terminal are off the map)
    const atEnd = (this.dir > 0 && this.s > tr.len - LINK.len / 2 - 1) || (this.dir < 0 && this.s < LINK.len / 2 + 1);
    if (atEnd && Math.abs(this.u) < 0.05 && thr > 0.3) {
      const nt = tr.other;
      const s = this.dir > 0 ? nt.len - LINK.len / 2 - 2 : LINK.len / 2 + 2;
      const busy = sys.trains.some((o) => o !== this && o.track === nt && o.state !== 'off' && Math.abs(o.s - s) < LINK.len + 60);
      if (busy) { if (this.warned <= 0) { sys.say('Wait — a train is on the other track'); this.warned = 3; } }
      else {
        this.track = nt; this.dir = nt.dir; this.s = s; this.u = 0; this.lastStop = null;
        sys.say(`You change ends — the 1 Line back to ${this.dir > 0 ? 'Federal Way' : 'Lynnwood'} on the other track`);
        this.arrival = { from: null, t: 0, rated: false };
      }
    }
    let power = thr;
    const v = this.u * this.dir;
    if (brk > 0.5 && thr < 0.1 && v <= 0.05) {
      this._revT = (this._revT || 0) + dt;
      if (this._revT > 0.6) power = -1;
    } else this._revT = 0;
    if (power !== 0 && this.doors) { this.doors = false; sys.onDoors(this, false); }
    const ev = this.step(dt, power, power < 0 ? 0 : brk);
    if (this.arrival) this.arrival.t += dt;
    if (ev.end > 1.5) sys.onEnd(this);
    else if (ev.end !== undefined && this.warned <= 0) { sys.onEnd(this); this.warned = 6; }
    if (ev.collide) sys.onCollide(this, ev.collide);
    // too fast for a curve: the wheels squeal; far too fast, it hurts
    if (ev.lat > 1.6) {
      if (this.warned <= 0) { sys.say('Too fast for the curve — ease off'); this.warned = 5; }
      if (ev.lat > 3.2) { sys.game && sys.game.damagePlayer((ev.lat - 3.2) * dt * 8, 'crash'); this.u *= Math.exp(-0.4 * dt); }
      this.skid = clamp((ev.lat - 1.6) / 2, 0, 1);
    } else this.skid = 0;
    this.warned -= dt;
    // at rest at a platform: doors open, the stop is judged
    if (Math.abs(this.u) < 0.02 && this.arrival && !this.arrival.rated) {
      let st = null, err = 0;
      for (const q of sys.stations) {
        const e = (q.s[tr.key] - this.s) * this.dir;     // + short of the mark
        if (Math.abs(e) < 12) { st = q; err = e; }
      }
      if (st && st !== this.arrival.from) {
        this.arrival.rated = true;
        this.doors = true;
        sys.onArrive(this, st, err, this.arrival.t);
        this.lastStop = st;
        this.arrival = { from: st, t: 0, rated: true };
      }
    }
    if (this.arrival && this.arrival.rated && Math.abs(this.u) > 0.5) this.arrival = { from: this.arrival.from, t: 0, rated: false };
  }
}
