// THE REAL CALENDAR IN WATERLOO REGION: decorations and small moments keyed to
// the phone's date. Today's date -> a theme table; a season that is off builds
// NOTHING (no mesh, no draw, no per-frame work beyond one `active` test).
//
//   Halloween      Oct 20 - Nov 2   every pumpkin carved (fall.js `carveAll`),
//                                   inflatable ghosts / pumpkins on the lawns,
//                                   and on Oct 31 trick-or-treaters (peds in a
//                                   sheet, a witch hat or a pumpkin head)
//   Remembrance    Nov 1 - 11       wreaths and poppies at the cenotaphs; on
//                                   Nov 11 at 11:00 two minutes' silence
//   Christmas      Nov 15 - Jan 6   coloured bulbs along the eaves (after
//                                   dark), the trees at City Hall and the
//                                   Public Square, wreaths on the downtown
//                                   lantern posts; the Christkindl market
//                                   stalls at City Hall Nov 27 - Dec 23
//   Canada Day / Victoria Day       fireworks at night, kwevents.js's own
//
// `?date=YYYY-MM-DD` (or `__dbg.calendar.setDate('2026-12-24')`) overrides the
// date. The houses come from world.js's `userData.homes` records (x z rot w d
// eaveY groundY seed), handed over per chunk like fall.js's pumpkins; each
// season is ONE InstancedMesh chosen by distance (or one merged static mesh).
import * as THREE from './three.js';
import * as G from './geo.js';
import { hash2, clamp } from './util.js';
import { BONES as PB } from './peds.js';
import { rinkData } from './kwplaces.js';
import { STATIC_LAMPS } from './tod.js';

const ON_PHONE = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
const HR = 8;   // a home record: x z rot w d eaveY groundY seed
const lin = (c) => [Math.pow(c[0], 2.2), Math.pow(c[1], 2.2), Math.pow(c[2], 2.2)];

// --- the date -> theme table ---------------------------------------------------------

export function calendarDate() {
  try {
    const w = typeof window !== 'undefined' && window.__calDate && /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(window.__calDate);   // (the harness sets it before boot)
    if (w) return new Date(+w[1], +w[2] - 1, +w[3], 12, 0, 0);
    const m = /[?&]date=(\d{4})-(\d{1,2})-(\d{1,2})/.exec(location.search);
    if (m) return new Date(+m[1], +m[2] - 1, +m[3], 12, 0, 0);
  } catch (e) { /* no location */ }
  return new Date();
}

/** Victoria Day: the Monday before May 25. */
function victoriaDay(y) { const d = new Date(y, 4, 24); d.setDate(24 - ((d.getDay() + 6) % 7)); return d.getDate(); }

export function themesFor(d) {
  const m = d.getMonth(), dd = d.getDate(), y = d.getFullYear();
  const th = {
    halloween: (m === 9 && dd >= 20) || (m === 10 && dd <= 2),
    oct31: m === 9 && dd === 31,
    remembrance: m === 10 && dd <= 11,
    rday: m === 10 && dd === 11,
    christmas: (m === 10 && dd >= 15) || m === 11 || (m === 0 && dd <= 6),
    market: (m === 10 && dd >= 27) || (m === 11 && dd <= 23),
    canada: m === 6 && dd === 1,
    victoria: m === 4 && dd === victoriaDay(y),
  };
  th.any = th.halloween || th.remembrance || th.christmas || th.canada || th.victoria;
  // the day's greeting (first launch of the day)
  const nth = (n, wd, mo) => { const f = new Date(y, mo, 1).getDay(); return 1 + ((wd - f + 7) % 7) + 7 * (n - 1); };
  th.greeting =
    m === 0 && dd === 1 ? 'Happy New Year, Waterloo Region!'
    : m === 1 && dd === 14 ? 'Happy Valentine\'s Day. Mind the roses.'
    : m === 1 && dd === nth(3, 1, 1) ? 'Happy Family Day, Ontario!'
    : m === 2 && dd === 17 ? 'Happy St. Patrick\'s Day. Kitchener goes a little green.'
    : th.victoria ? 'Happy Victoria Day! The May two-four is here.'
    : th.canada ? 'Happy Canada Day, Waterloo Region! Fireworks tonight.'
    : m === 9 && dd === nth(2, 1, 9) ? 'Happy Thanksgiving! Oktoberfest\'s over, the turkey\'s not.'
    : th.oct31 ? 'Happy Halloween, Waterloo! Watch for kids on the streets.'
    : th.halloween ? 'Halloween\'s coming. The porches are lit.'
    : th.rday ? 'Remembrance Day. Lest we forget.'
    : th.remembrance ? 'Remembrance Week. Poppies at the cenotaphs.'
    : m === 11 && dd === 24 ? 'Merry Christmas Eve, Waterloo Region!'
    : m === 11 && dd === 25 ? 'Merry Christmas, Waterloo Region!'
    : m === 11 && dd === 26 ? 'Happy Boxing Day. The Boxing Day sales are on.'
    : m === 11 && dd === 31 ? 'Happy New Year\'s Eve!'
    : th.market ? 'The Christkindl Market is open at City Hall.'
    : th.christmas ? 'The lights are up across the Region.'
    : '';
  return th;
}

// --- a tiny triangle-soup builder (flat shaded, vertex colours) ----------------------

const _v = new THREE.Vector3();
class Soup {
  constructor() { this.P = []; this.C = []; this.m = null; }
  v(p, c) { _v.set(p[0], p[1], p[2]); if (this.m) _v.applyMatrix4(this.m); this.P.push(_v.x, _v.y, _v.z); this.C.push(c[0], c[1], c[2]); }
  tri(a, b, c, col) { this.v(a, col); this.v(b, col); this.v(c, col); }
  quad(a, b, c, d, col) { this.tri(a, b, c, col); this.tri(a, c, d, col); }
  /** Bottom-centred box, yawed. */
  box(cx, by, cz, sx, sy, sz, yaw, col) {
    const c = Math.cos(yaw), s = Math.sin(yaw);
    const P = (x, y, z) => [cx + x * c - z * s, by + y, cz + x * s + z * c];
    const hx = sx / 2, hz = sz / 2;
    const a = P(-hx, 0, -hz), b = P(hx, 0, -hz), c2 = P(hx, 0, hz), d = P(-hx, 0, hz);
    const e = P(-hx, sy, -hz), f = P(hx, sy, -hz), g = P(hx, sy, hz), h = P(-hx, sy, hz);
    this.quad(e, f, g, h, col); this.quad(a, b, f, e, col); this.quad(b, c2, g, f, col);
    this.quad(c2, d, h, g, col); this.quad(d, a, e, h, col);
  }
  /** A frustum (cone when r1 = 0), open at the bottom. */
  frustum(cx, by, cz, r0, r1, h, seg, col, yaw = 0) {
    for (let i = 0; i < seg; i++) {
      const a0 = yaw + (i / seg) * 6.2832, a1 = yaw + ((i + 1) / seg) * 6.2832;
      const p0 = [cx + Math.cos(a0) * r0, by, cz + Math.sin(a0) * r0], p1 = [cx + Math.cos(a1) * r0, by, cz + Math.sin(a1) * r0];
      const q0 = [cx + Math.cos(a0) * r1, by + h, cz + Math.sin(a0) * r1], q1 = [cx + Math.cos(a1) * r1, by + h, cz + Math.sin(a1) * r1];
      if (r1 < 1e-4) this.tri(p0, p1, q0, col); else this.quad(p0, p1, q1, q0, col);
    }
  }
  torus(cx, cy, cz, R, r, seg, tseg, col) {
    const P = (i, j) => {
      const a = (i / seg) * 6.2832, b = (j / tseg) * 6.2832, rr = R + Math.cos(b) * r;
      return [cx + Math.cos(a) * rr, cy + Math.sin(b) * r, cz + Math.sin(a) * rr];
    };
    for (let i = 0; i < seg; i++) for (let j = 0; j < tseg; j++) this.quad(P(i, j), P(i + 1, j), P(i + 1, j + 1), P(i, j + 1), col);
  }
  /** A gable roof: ridge along the local x axis, eaves at by, ridge at by + h. */
  gable(cx, by, cz, w, d, h, yaw, col) {
    const c = Math.cos(yaw), s = Math.sin(yaw);
    const P = (x, y, z) => [cx + x * c - z * s, by + y, cz + x * s + z * c];
    const hx = w / 2, hz = d / 2;
    const a = P(-hx, 0, -hz), b = P(hx, 0, -hz), c2 = P(hx, 0, hz), d2 = P(-hx, 0, hz), r0 = P(-hx, h, 0), r1 = P(hx, h, 0);
    this.quad(a, b, r1, r0, col); this.quad(c2, d2, r0, r1, col);
    this.tri(a, r0, d2, col); this.tri(b, c2, r1, col);
  }
  /** A small tetrahedron: the bulb. */
  bulb(x, y, z, s, col) {
    const a = [x, y + s, z], b = [x + s * 0.94, y - s * 0.33, z], c = [x - s * 0.47, y - s * 0.33, z + s * 0.82], d = [x - s * 0.47, y - s * 0.33, z - s * 0.82];
    this.tri(a, b, c, col); this.tri(a, c, d, col); this.tri(a, d, b, col); this.tri(b, d, c, col);
  }
  geo() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.P, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.C, 3));
    g.computeVertexNormals();
    g.computeBoundingSphere();
    return g;
  }
}

/** The inflatable / costume blob: a ghost-shaped lathe 2 high, radius 1, a face on +z (dark vertex colours). */
function blobGeometry() {
  const S = new Soup();
  const W = [1, 1, 1], K = [0.03, 0.03, 0.03];
  const rows = [[0, 0.82], [0.25, 0.97], [0.7, 1.0], [1.2, 0.93], [1.65, 0.62], [1.92, 0.28], [2.0, 0]];
  const seg = 10;
  const P = (i, r) => [Math.sin((i / seg) * 6.2832) * rows[r][1], rows[r][0], Math.cos((i / seg) * 6.2832) * rows[r][1]];
  for (let r = 0; r < rows.length - 1; r++) for (let i = 0; i < seg; i++) {
    if (r === rows.length - 2) S.tri(P(i, r), P(i + 1, r), P(0, r + 1), W);
    else S.quad(P(i, r), P(i + 1, r), P(i + 1, r + 1), P(i, r + 1), W);
  }
  // the face: eyes and a mouth proud of the front by a hair
  const f = (x, y) => { const rr = y < 1.65 ? 0.99 : 0.65; return [x, y, Math.sqrt(Math.max(0.02, rr * rr - x * x)) + 0.03]; };
  S.tri(f(-0.45, 1.35), f(-0.15, 1.35), f(-0.3, 1.62), K);
  S.tri(f(0.15, 1.35), f(0.45, 1.35), f(0.3, 1.62), K);
  S.quad(f(-0.4, 0.95), f(0.4, 0.95), f(0.3, 1.12), f(-0.3, 1.12), K);
  return S.geo();
}

// --- the module ----------------------------------------------------------------------

export class KwCalendar {
  /** o: { scene, world, city, peds, tod, hud, audio, events, player, camera, game } */
  constructor(o) {
    this.o = o;
    this.date = calendarDate();
    this.th = themesFor(this.date);
    this.homes = new Map();     // chunk key -> Float32Array of home records
    this.infl = new Map();      // chunk key -> Float32Array of inflatable records
    this.group = new THREE.Group(); this.group.name = 'calendar';
    o.scene.add(this.group);
    this.last = { x: 1e9, z: 1e9 };
    this.dirty = true;
    this.R = ON_PHONE ? 70 : 110;
    this.T = 0; this.fwT = 0; this.silenceT = 0; this.greeted = false; this.t0 = 0;
    this.stats = { lights: 0, infl: 0, wreaths: 0, costumes: 0 };
    this.built = {};
    this._m = new THREE.Matrix4();
    this._setup();
  }

  get active() { return this.th.any; }

  /** Switch the date (harness): tears the seasons down and builds the new date's. */
  setDate(s) {
    const m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(String(s));
    if (!m) return false;
    this._teardown();
    this.date = new Date(+m[1], +m[2] - 1, +m[3], 12, 0, 0);
    this.th = themesFor(this.date);
    this._setup();
    const w = this.o.weather || (typeof window !== 'undefined' && window.__dbg && window.__dbg.weather);
    if (w && 'month' in w) w.month = this.date.getMonth();
    return true;
  }

  _teardown() {
    for (const c of [...this.group.children]) {
      this.group.remove(c);
      c.traverse((n) => { if (n.geometry && !n.userData.shared) n.geometry.dispose(); if (n.material && n.material.dispose) n.material.dispose(); });
    }
    this.built = {}; this.infl.clear(); this.lights = this.inflM = this.wreaths = this.statics = this.memo = this.lampW = null;
    const dec = this.o.world && this.o.world.decor; if (dec) { dec.carveAll = false; dec.dirty = true; }
    if (this.o.peds) this.o.peds.costume = null;
    this._unsilence();
    this.dirty = true;
  }

  _setup() {
    const th = this.th, o = this.o;
    const dec = o.world && o.world.decor;
    if (th.halloween) {
      if (dec) { dec.carveAll = true; dec.dirty = true; }
      try { this._buildInflatables(); } catch (e) { console.warn('calendar inflatables', e); }
    }
    if (th.oct31 && o.peds) { try { this._buildCostumes(); } catch (e) { console.warn('calendar costumes', e); } }
    if (th.remembrance) { try { this._buildMemorials(); } catch (e) { console.warn('calendar memorials', e); } }
    if (th.christmas) {
      try { this._buildLights(); this._buildStatics(); this._buildLampWreaths(); } catch (e) { console.warn('calendar christmas', e); }
    }
    // houses already streamed in (the date was switched after boot): their inflatables
    if (th.halloween) for (const [k, h] of this.homes) this._inflFor(k, h);
  }

  // --- chunk hand-over (world.js) ---

  setChunk(key, homes) {
    if (!homes) { this.dropChunk(key); return; }
    this.homes.set(key, homes);
    if (this.th.halloween && this.inflM) this._inflFor(key, homes);
    this.dirty = true;
  }
  dropChunk(key) { if (this.homes.delete(key)) { this.infl.delete(key); this.dirty = true; } }

  // --- time of day helpers ---

  /** 0 by day .. 1 at dusk and after: bulbs come on, inflatables glow. */
  dark() { const ti = typeof window !== 'undefined' && window.__todInfo; return ti && ti.on ? clamp(Math.max(ti.dusk, ti.night), 0, 1) : 0; }
  hourNow() { const ti = window.__todInfo; if (ti && ti.on) return ti.hour; const d = new Date(); return d.getHours() + d.getMinutes() / 60; }

  // --- Halloween: lawn inflatables ---

  _buildInflatables() {
    const CAP = ON_PHONE ? 90 : 180;
    const geo = blobGeometry();
    const mat = new THREE.MeshBasicMaterial({ vertexColors: true });
    const m = new THREE.InstancedMesh(geo, mat, CAP);
    m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    m.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(CAP * 3), 3);
    m.instanceColor.setUsage(THREE.DynamicDrawUsage);
    m.frustumCulled = false; m.count = 0; m.visible = false; m.name = 'cal:inflatables';
    this.group.add(m);
    this.inflM = m;
    this.inflCap = CAP;
  }

  _inflFor(key, homes) {
    const w = this.o.world, out = [];
    for (let o = 0; o < homes.length; o += HR) {
      const seed = homes[o + 7];
      if (hash2(seed, 811) > 0.4) continue;
      const rot = homes[o + 2], c = Math.cos(rot), s = Math.sin(rot), W = homes[o + 3], D = homes[o + 4];
      const lx = (hash2(seed, 812) - 0.5) * W * 0.7, lz = D / 2 + 3.4;
      const x = homes[o] + lx * c - lz * s, z = homes[o + 1] + lx * s + lz * c;
      if (this.o.city.onRoad(x, z, 1.8, false) || G.isWater(x, z) || (w.inBuilding && w.inBuilding(x, z, 1.4))) continue;
      const y = G.terrainHeight(x, z);
      if (Math.abs(y - homes[o + 6]) > 3) continue;
      out.push(x, y, z, hash2(seed, 813), hash2(seed, 814), rot);
    }
    if (out.length) this.infl.set(key, new Float32Array(out)); else this.infl.delete(key);
  }

  // palette: ghost, pumpkin, green monster, purple
  static INFL = [[1, 1, 1, 0.5, 1.15], [1.5, 0.45, 0.05, 0.85, 0.7], [0.45, 1.1, 0.4, 0.55, 0.95], [0.8, 0.4, 1.2, 0.5, 1.0]];

  _chooseInflatables(cx, cz, dk) {
    const M = this.inflM; if (!M) return;
    const m = M.instanceMatrix.array, ca = M.instanceColor.array, Rq = (this.R * 0.9) ** 2, cap = this.inflCap, T = KwCalendar.INFL;
    let n = 0;
    for (const L of this.infl.values()) {
      for (let o = 0; o < L.length && n < cap; o += 6) {
        const dx = L[o] - cx, dz = L[o + 2] - cz;
        if (dx * dx + dz * dz > Rq) continue;
        const kind = Math.min(3, Math.floor(L[o + 3] * 4)), t = T[kind], sc = 0.85 + L[o + 4] * 0.4;
        const yaw = -L[o + 5] + (L[o + 4] - 0.5) * 0.6;   // the face to the street
        const cs = Math.cos(yaw), sn = Math.sin(yaw), q = n * 16, sx = t[3] * sc, sy = t[4] * sc;
        m[q] = cs * sx; m[q + 1] = 0; m[q + 2] = -sn * sx; m[q + 3] = 0;
        m[q + 4] = 0; m[q + 5] = sy; m[q + 6] = 0; m[q + 7] = 0;
        m[q + 8] = sn * sx; m[q + 9] = 0; m[q + 10] = cs * sx; m[q + 11] = 0;
        m[q + 12] = L[o]; m[q + 13] = L[o + 1] - 0.05; m[q + 14] = L[o + 2]; m[q + 15] = 1;
        ca[n * 3] = t[0]; ca[n * 3 + 1] = t[1]; ca[n * 3 + 2] = t[2];
        n++;
      }
    }
    M.count = n; M.visible = n > 0; this.stats.infl = n;
    M.instanceMatrix.needsUpdate = true; M.instanceColor.needsUpdate = true;
  }

  // --- Halloween night: trick-or-treaters ---

  _buildCostumes() {
    const blob = blobGeometry(); blob.userData = { shared: true };
    const bm = new THREE.MeshBasicMaterial({ vertexColors: true });
    const sheetMat = new THREE.MeshLambertMaterial({ vertexColors: true, color: 0xf2f2ee });
    const hat = new Soup();
    hat.frustum(0, 0, 0, 0.27, 0.27, 0.014, 12, [0.02, 0.02, 0.025]);
    hat.frustum(0, 0.014, 0, 0.14, 0.05, 0.3, 10, [0.03, 0.025, 0.04]);
    hat.frustum(0, 0.28, 0, 0.05, 0.0, 0.14, 8, [0.03, 0.025, 0.04]);
    hat.frustum(0, 0.03, 0, 0.145, 0.138, 0.05, 10, [0.45, 0.1, 0.55]);   // the hatband
    const hatG = hat.geo();
    const hatM = new THREE.MeshLambertMaterial({ vertexColors: true });
    const bucketM = new THREE.MeshBasicMaterial({ color: new THREE.Color(1.6, 0.5, 0.06) });
    this.costumeParts = [blob, bm, sheetMat, hatG, hatM, bucketM];
    let made = 0;
    const o = this.o;
    o.peds.costume = (h, seed) => {
      if (!this.th.oct31) return;
      const hr = this.hourNow(), eve = hr >= 16 && hr < 21.5;
      if (hash2(seed, 931) > (eve ? 0.5 : 0.12)) return;
      if (made > 400) return;
      made++; this.stats.costumes++;
      const kind = Math.floor(hash2(seed, 932) * 3);
      const bones = h.bones;
      const add = (mesh, bone, x, y, z, sx, sy, sz) => {
        mesh.position.set(x, y, z); mesh.scale.set(sx, sy, sz);
        mesh.frustumCulled = false; mesh.userData.costume = true;
        bones[bone].add(mesh);
      };
      if (kind === 0) add(new THREE.Mesh(hatG, hatM), PB.head, 0, 0.03, 0, 1, 1, 1);
      else if (kind === 1) add(new THREE.Mesh(blob, bm), PB.head, 0, 0.0, 0, 0.16, 0.12, 0.16);   // a pumpkin head: orange? tinted below
      else add(new THREE.Mesh(blob, sheetMat), PB.root, 0, -0.02, 0, 0.3, 0.92, 0.3);
      // the pumpkin head's orange: a per-mesh basic material
      if (kind === 1) {
        const mm = bones[PB.head].children[bones[PB.head].children.length - 1];
        mm.material = this._orangeBasic || (this._orangeBasic = new THREE.MeshBasicMaterial({ vertexColors: true, color: new THREE.Color(1.6, 0.5, 0.06) }));
      }
      // the candy bucket in the right hand
      add(new THREE.Mesh(blob, bucketM), PB.handR, 0, -0.07, 0.02, 0.06, 0.045, 0.09);
    };
  }

  // --- Remembrance: poppy wreaths at the cenotaphs ---

  static MEMORIALS = [[-997.6, 198.6], [-4268.2, -2603.4], [12679.4, 10334.5], [13390.8, 2290.4]];

  _buildMemorials() {
    const S = new Soup(), city = this.o.city;
    const RED = lin([0.78, 0.04, 0.05]), DARK = lin([0.04, 0.04, 0.05]), GREEN = lin([0.1, 0.3, 0.1]), STONE = lin([0.55, 0.55, 0.53]), WOOD = lin([0.2, 0.14, 0.09]);
    for (const [mx, mz] of KwCalendar.MEMORIALS) {
      const gy = city.groundAt ? city.groundAt(mx, mz, null) : G.terrainHeight(mx, mz);
      // a pop-up stone beside the point (the OSM node), then wreaths on little easels round it
      S.box(mx, gy, mz, 2.2, 0.25, 1.4, 0, STONE);
      S.box(mx, gy + 0.25, mz, 1.0, 3.2, 0.7, 0, STONE);
      for (let k = 0; k < 4; k++) {
        const a = (k / 4) * 6.28 + 0.4, d = 2.2 + (k % 2) * 0.5;
        const x = mx + Math.cos(a) * d, z = mz + Math.sin(a) * d;
        const yaw = a + Math.PI / 2;
        // easel legs
        const c = Math.cos(yaw), s = Math.sin(yaw);
        S.box(x - 0.35 * c, gy, z - 0.35 * s, 0.05, 1.1, 0.05, yaw, WOOD);
        S.box(x + 0.35 * c, gy, z + 0.35 * s, 0.05, 1.1, 0.05, yaw, WOOD);
        // the wreath: a standing ring facing out (the torus' axis along the radial direction)
        S.m = new THREE.Matrix4().makeTranslation(x, gy + 1.2, z).multiply(new THREE.Matrix4().makeRotationY(-a)).multiply(new THREE.Matrix4().makeRotationZ(Math.PI / 2));
        S.torus(0, 0, 0, 0.42, 0.11, 14, 5, GREEN);
        S.torus(0, 0.06, 0, 0.42, 0.075, 14, 5, RED);
        S.m = null;
        const ox = Math.cos(a) * 0.1, oz = Math.sin(a) * 0.1;
        S.box(x + ox, gy + 1.17, z + oz, 0.2, 0.06, 0.2, a, DARK);
      }
      // loose poppies at the foot
      for (let k = 0; k < 14; k++) {
        const a = hash2(mx + k, mz) * 6.28, d = 0.9 + hash2(k, mx) * 2.4;
        const x = mx + Math.cos(a) * d, z = mz + Math.sin(a) * d;
        S.bulb(x, city.groundAt ? city.groundAt(x, z, null) + 0.12 : gy + 0.12, z, 0.1, RED);
      }
    }
    const mesh = new THREE.Mesh(S.geo(), new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide }));
    mesh.name = 'cal:memorials'; mesh.matrixAutoUpdate = false; mesh.visible = false;
    this.group.add(mesh);
    this.memo = mesh;
    this.stats.wreaths = KwCalendar.MEMORIALS.length * 4;
  }

  // --- Christmas: bulbs along the eaves ---

  static BULB = [[1, 0.1, 0.08], [0.1, 0.9, 0.2], [0.15, 0.3, 1], [1, 0.75, 0.1], [1, 0.3, 0.7]];

  _buildLights() {
    const CAP = ON_PHONE ? 1300 : 2800;
    const g = new Soup(); g.bulb(0, 0, 0, 1, [1, 1, 1]);
    const geo = g.geo();
    const mat = new THREE.MeshBasicMaterial({ vertexColors: true, fog: true, side: THREE.DoubleSide });
    const m = new THREE.InstancedMesh(geo, mat, CAP);
    m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    m.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(CAP * 3), 3);
    m.instanceColor.setUsage(THREE.DynamicDrawUsage);
    m.frustumCulled = false; m.count = 0; m.visible = false; m.name = 'cal:lights';
    this.group.add(m);
    this.lights = m; this.lightCap = CAP;
  }

  _chooseLights(cx, cz) {
    const M = this.lights; if (!M) return;
    const m = M.instanceMatrix.array, ca = M.instanceColor.array, Rq = this.R * this.R, cap = this.lightCap, BP = KwCalendar.BULB;
    let n = 0;
    const put = (x, y, z, c, s) => {
      if (n >= cap) return;
      const q = n * 16;
      m[q] = s; m[q + 1] = 0; m[q + 2] = 0; m[q + 3] = 0; m[q + 4] = 0; m[q + 5] = s; m[q + 6] = 0; m[q + 7] = 0;
      m[q + 8] = 0; m[q + 9] = 0; m[q + 10] = s; m[q + 11] = 0; m[q + 12] = x; m[q + 13] = y; m[q + 14] = z; m[q + 15] = 1;
      ca[n * 3] = c[0]; ca[n * 3 + 1] = c[1]; ca[n * 3 + 2] = c[2];
      n++;
    };
    const WARM = [2.2, 1.3, 0.5], COOL = [1.2, 1.6, 2.4];
    for (const H of this.homes.values()) {
      for (let o = 0; o < H.length && n < cap; o += HR) {
        const dx = H[o] - cx, dz = H[o + 1] - cz;
        if (dx * dx + dz * dz > Rq) continue;
        const seed = H[o + 7];
        if (hash2(seed, 821) > 0.68) continue;            // a third of the houses are dark
        const scheme = Math.floor(hash2(seed, 822) * 5);  // multi, multi, warm, cool, red/green
        const rot = H[o + 2], c = Math.cos(rot), s = Math.sin(rot), W = H[o + 3], D = H[o + 4], y = H[o + 5];
        const colour = (i) => {
          if (scheme <= 1) { const b = BP[(i + scheme) % 5]; return [b[0] * 2.2, b[1] * 2.2, b[2] * 2.2]; }
          if (scheme === 2) return WARM;
          if (scheme === 3) return COOL;
          return i % 2 ? [2.2, 0.2, 0.15] : [0.2, 1.8, 0.35];
        };
        const at = (lx, lz, yy, i, sz) => put(H[o] + lx * c - lz * s, yy, H[o + 1] + lx * s + lz * c, colour(i), sz);
        // the front eave, and the two sides' eaves back a few metres
        const nf = Math.max(3, Math.round((W + 1) / 0.7)), hw = W / 2 + 0.4, fz = D / 2 + 0.45;
        for (let i = 0; i < nf; i++) at(-hw + (2 * hw) * (i / (nf - 1)), fz, y - 0.1 - 0.05 * Math.sin(i * 1.7) , i, 0.15);
        const back = Math.min(D / 2 + 0.4, 6), ns = Math.max(2, Math.round(back / 0.8));
        for (let i = 1; i <= ns; i++) {
          at(-hw, fz - (back * i) / ns, y - 0.1, i, 0.15);
          at(hw, fz - (back * i) / ns, y - 0.1, i + 1, 0.15);
        }
        // a lit wreath at the door and a string up the near corner posts
        if (hash2(seed, 823) < 0.5) for (let i = 0; i < 6; i++) { const a = (i / 6) * 6.28; at(Math.cos(a) * 0.3 + (hash2(seed, 824) - 0.5) * W * 0.4, fz - 0.3, H[o + 6] + 1.9 + Math.sin(a) * 0.3, i, 0.09); }
      }
    }
    M.count = n; M.visible = n > 0; this.stats.lights = n;
    M.instanceMatrix.needsUpdate = true; M.instanceColor.needsUpdate = true;
  }

  // --- Christmas: the big trees and the Christkindl market ---

  _buildStatics() {
    const city = this.o.city, th = this.th;
    const std = new Soup(), blb = new Soup();
    const BP = KwCalendar.BULB;
    const sites = [];
    sites.push({ x: -1431, z: 44, name: 'Carl Zehr Square' });
    try {
      const r = rinkData();
      // beside Waterloo Public Square's rink, off its short end
      sites.push({ x: r.c[0] + r.u[0] * (r.hl + 9), z: r.c[1] + r.u[1] * (r.hl + 9), name: 'Waterloo Public Square' });
    } catch (e) { /* no rink data */ }
    const gnd = (x, z) => (city.groundAt ? city.groundAt(x, z, null) : G.terrainHeight(x, z));
    this.treeSites = sites;
    const GR = [lin([0.05, 0.24, 0.1]), lin([0.06, 0.28, 0.12]), lin([0.04, 0.2, 0.09])];
    for (const t of sites) {
      const gy = gnd(t.x, t.z);
      std.frustum(t.x, gy, t.z, 0.5, 0.4, 1.6, 8, lin([0.25, 0.17, 0.1]));
      for (let i = 0; i < 6; i++) std.frustum(t.x, gy + 1.2 + i * 2.35, t.z, 4.6 - i * 0.7, 0.25, 3.7, 14, GR[i % 3], i * 0.3);
      // the bulbs spiral up the cone
      const H = 16.2;
      for (let k = 0; k < 120; k++) {
        const u = k / 120, y = 2.0 + u * 13.2, r = (4.6 - ((y - 1.2) / 2.35) * 0.7) + 0.02;
        const rr = Math.max(0.2, Math.min(4.2, 4.6 - (u * 13.2 + 0.8) / 2.35 * 0.7 * 0.9) * (1 - u * 0.0) + 0.1);
        const rad = Math.max(0.15, (1 - (y - 1.2) / 14.2) * 4.1 + 0.15);
        const a = u * 6.2832 * 9;
        const b = BP[k % 5];
        blb.bulb(t.x + Math.cos(a) * rad, gy + y, t.z + Math.sin(a) * rad, 0.17, [b[0] * 2.2, b[1] * 2.2, b[2] * 2.2]);
        void r; void rr;
      }
      blb.bulb(t.x, gy + H + 0.7, t.z, 0.75, [3, 2.4, 0.6]);   // the star
    }
    // the market: stalls round Carl Zehr Square's east side
    this.market = th.market;
    if (th.market) {
      const t = sites[0], gy = gnd(t.x, t.z);
      const ZEHR_POOL = [[-1459, 70], [-1420, 91], [-1410, 69], [-1445, 50]];   // kwsights.js's pool, 4 m out
      const poly = [[-1465.1, 63.6], [-1445.6, 24.7], [-1400.4, 47.3], [-1407.2, 91.9], [-1416, 96], [-1458, 77]];
      const inside = (x, z) => { let c = false; for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) { const [xi, zi] = poly[i], [xj, zj] = poly[j]; if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) c = !c; } return c; };
      const STALL = [lin([0.7, 0.08, 0.08]), lin([0.1, 0.4, 0.2]), lin([0.8, 0.8, 0.75]), lin([0.75, 0.45, 0.1])];
      const WOOD = lin([0.28, 0.18, 0.1]), GOODS = [lin([0.8, 0.5, 0.15]), lin([0.55, 0.1, 0.1]), lin([0.9, 0.85, 0.7]), lin([0.2, 0.4, 0.15])];
      const inPool = (x, z) => { let c = false; const q = ZEHR_POOL; for (let i = 0, j = q.length - 1; i < q.length; j = i++) { const [xi, zi] = q[i], [xj, zj] = q[j]; if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) c = !c; } return c; };
      let k = 0;
      for (let gx = -26; gx <= 26; gx += 8) for (let gz = -24; gz <= 24; gz += 7.5) {
        const x = -1432 + gx, z = 62 + gz;
        let ok = true;
        for (const [ax, az] of [[0, 0], [2.2, 2.2], [-2.2, -2.2], [2.2, -2.2], [-2.2, 2.2]]) if (!inside(x + ax, z + az)) ok = false;
        for (let a = 0; a < 6.3 && ok; a += 0.8) if (inPool(x + Math.cos(a) * 3.4, z + Math.sin(a) * 3.4) || inPool(x, z)) ok = false;
        if (!ok || Math.hypot(x - t.x, z - t.z) < 8) continue;
        const yaw = -0.46, c = Math.cos(yaw), s = Math.sin(yaw), y = gnd(x, z);
        const P = (lx, lz) => [x + lx * c - lz * s, z + lx * s + lz * c];
        std.box(x, y, z, 3.0, 0.95, 1.3, yaw, WOOD);                       // the counter
        for (const sx of [-1.45, 1.45]) for (const sz of [-0.8, 0.8]) { const [px, pz] = P(sx, sz); std.box(px, y, pz, 0.1, 2.5, 0.1, yaw, WOOD); }
        { const [px, pz] = P(0, -0.85); std.box(px, y, pz, 3.0, 2.5, 0.1, yaw, WOOD); }   // the back wall
        std.gable(x, y + 2.5, z, 3.7, 2.5, 0.8, yaw, STALL[k % 4]);
        for (let g = 0; g < 5; g++) { const [px, pz] = P(-1.2 + g * 0.6, 0.1); std.box(px, y + 0.95, pz, 0.3, 0.22, 0.3, yaw, GOODS[(g + k) % 4]); }
        { const [px, pz] = P(0, 1.3); blb.box(px, y + 2.5, pz, 3.6, 0.1, 0.12, yaw, [2.4, 1.5, 0.55]); }   // the lit eave
        for (let g = 0; g < 7; g++) { const [px, pz] = P(-1.75 + g * 0.58, 1.32); const b = BP[(g + k) % 5]; blb.bulb(px, y + 2.42, pz, 0.12, [b[0] * 2.2, b[1] * 2.2, b[2] * 2.2]); }
        k++;
      }
      this.stats.stalls = k;
    }
    const sm = new THREE.Mesh(std.geo(), new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide }));
    const bm = new THREE.Mesh(blb.geo(), new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide }));
    sm.name = 'cal:xmas'; bm.name = 'cal:xmasbulbs';
    for (const mm of [sm, bm]) { mm.matrixAutoUpdate = false; mm.visible = false; this.group.add(mm); }
    this.statics = { sm, bm, bmat: bm.material };
  }

  // --- Christmas: wreaths on the downtown lantern posts ---

  static DOWNTOWNS = [[-1150, 230], [-3838, -1310], [12679, 10334], [-1432, 62]];

  _buildLampWreaths() {
    const CAP = ON_PHONE ? 90 : 200;
    const S = new Soup();
    S.torus(0, 0, 0, 0.2, 0.075, 12, 5, lin([0.05, 0.3, 0.1]));
    S.box(0.2, -0.07, 0, 0.1, 0.14, 0.2, 0, lin([0.8, 0.05, 0.06]));   // the bow
    const m = new THREE.InstancedMesh(S.geo(), new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide }), CAP);
    m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    m.frustumCulled = false; m.count = 0; m.visible = false; m.name = 'cal:lampwreaths';
    this.group.add(m);
    this.lampW = m; this.lampCap = CAP;
  }

  _chooseLampWreaths(cx, cz) {
    const M = this.lampW; if (!M) return;
    let near = false;
    for (const [dx, dz] of KwCalendar.DOWNTOWNS) if ((cx - dx) ** 2 + (cz - dz) ** 2 < 700 * 700) { near = true; break; }
    let n = 0;
    if (near) {
      const m = M.instanceMatrix.array, chunks = this.o.world.chunks, Rq = 55 * 55, cap = this.lampCap;
      const put = (x, y, z) => {
        const q = n * 16;
        m[q] = 1; m[q + 1] = 0; m[q + 2] = 0; m[q + 3] = 0; m[q + 4] = 0; m[q + 5] = 1; m[q + 6] = 0; m[q + 7] = 0;
        m[q + 8] = 0; m[q + 9] = 0; m[q + 10] = 1; m[q + 11] = 0; m[q + 12] = x; m[q + 13] = y; m[q + 14] = z; m[q + 15] = 1;
        n++;
      };
      // Uptown's double-globe posts (kwplaces.js: the head 6.0 over the foot, the banner arms at 3.45)
      for (const Ls of STATIC_LAMPS) for (let i = 0; i < Ls.length && n < cap; i += 3) {
        const dx = Ls[i] - cx, dz = Ls[i + 2] - cz;
        if (dx * dx + dz * dz <= Rq) put(Ls[i], Ls[i + 1] - 3.9, Ls[i + 2]);
      }
      // ...and the 4.3 m lantern post (world.js era 2): its pole stands right under the head
      for (const c of chunks.values()) {
        const L = c.group && c.group.userData.lamps;
        if (!L) continue;
        for (let i = 0; i < L.length && n < cap; i += 3) {
          const dx = L[i] - cx, dz = L[i + 2] - cz;
          if (dx * dx + dz * dz > Rq) continue;
          if (Math.abs(L[i + 1] - G.terrainHeight(L[i], L[i + 2]) - 4.3) > 0.9) continue;
          put(L[i], L[i + 1] - 1.7, L[i + 2]);
        }
      }
    }
    M.count = n; M.visible = n > 0; this.stats.lampWreaths = n;
    M.instanceMatrix.needsUpdate = true;
  }

  // --- the frame ---

  update(dt, player, camera) {
    if (!this.th.greeting && !this.active) return;
    const cx = camera.position.x, cz = camera.position.z;
    this.T += dt;
    if (!this.greeted && this.T > 6) this._greet();
    if (!this.active) return;
    const dk = this.dark();
    // moved far enough (or the world changed): choose again
    const L = this.last;
    const moved = (cx - L.x) ** 2 + (cz - L.z) ** 2 > 64;
    if (moved || this.dirty || (this._dk !== undefined && (this._dk > 0.6) !== (dk > 0.6))) {
      L.x = cx; L.z = cz; this.dirty = false; this._dk = dk;
      if (this.th.halloween) this._chooseInflatables(cx, cz, dk);
      if (this.lights) { if (dk > 0.6) this._chooseLights(cx, cz); else { this.lights.count = 0; this.lights.visible = false; this.stats.lights = 0; } }
      if (this.lampW) this._chooseLampWreaths(cx, cz);
    }
    if (this.inflM) this.inflM.material.color.setScalar(0.6 + 0.4 * dk);
    if (this.statics) {
      let near = false;
      for (const t of this.treeSites) if ((cx - t.x) ** 2 + (cz - t.z) ** 2 < 900 * 900) { near = true; break; }
      this.statics.sm.visible = near; this.statics.bm.visible = near;
      this.statics.bmat.color.setScalar(0.5 + 0.7 * dk);
    }
    if (this.memo) {
      let near = false;
      for (const [mx, mz] of KwCalendar.MEMORIALS) if ((cx - mx) ** 2 + (cz - mz) ** 2 < 700 * 700) { near = true; break; }
      this.memo.visible = near;
    }
    // Remembrance Day, 11:00: two minutes' silence
    if (this.th.rday && !this.silenceT && !this._silenced) {
      const d = new Date();
      if (!/[?&]date=/.test(location.search) && d.getHours() === 11 && d.getMinutes() < 2) this.silence();
    }
    if (this.silenceT > 0) { this.silenceT -= dt; if (this.silenceT <= 0) this._unsilence(true); }
    // fireworks: Canada Day and Victoria Day nights
    if (this.th.canada || this.th.victoria) {
      this.fwT -= dt;
      const hr = this.hourNow();
      if (this.fwT <= 0 && (hr >= 22 || hr < 1)) { this.fwT = 150; this.fireworks(false); }
    }
  }

  _greet() {
    this.greeted = true;
    const g = this.th.greeting;
    if (!g) return;
    const k = 'autokw-caltoast', today = this.date.toDateString();
    try { if (localStorage.getItem(k) === today && !this.forceToast) return; localStorage.setItem(k, today); } catch (e) { /* private mode */ }
    const h = this.o.hud && this.o.hud.hud || this.o.hud;
    if (h && h.showToast) h.showToast(g, 4200);
  }

  /** Fireworks over Victoria Park or Columbia Lake (kwevents.js), if the player is within reach of one. */
  fireworks(force) {
    const ev = this.o.events, p = this.o.player;
    if (!ev || !p || ev.cur) return false;
    if (!force && !ev.canStart(p)) return false;
    const sites = [{ site: G.toWorld(43.4470, -80.4990), name: 'Victoria Park' }, { site: [-6700, -2200], name: 'Columbia Lake' }];
    this._fwK = (this._fwK || 0) + 1;
    for (let i = 0; i < 2; i++) {
      const s = sites[(this._fwK + i) % 2];
      if (Math.hypot(p.position.x - s.site[0], p.position.z - s.site[1]) < 2600 || force) return ev.start('fireworks', { site: s.site, name: s.name, shots: 70 });
    }
    return false;
  }

  /** Two minutes' silence: the traffic hum drops away. */
  silence(secs = 120) {
    this.silenceT = secs; this._silenced = true;
    const a = this.o.audio;
    if (a) a.hush = 0.12;
    if (a && a.trafficBus) { this._tb = a.trafficBus.gain.value; a.trafficBus.gain.value = this._tb * 0.12; }
    const h = this.o.hud && this.o.hud.hud || this.o.hud;
    if (h && h.showToast) h.showToast('11:00 — two minutes\' silence. Lest we forget.', 6000);
  }
  _unsilence(toast) {
    const a = this.o.audio;
    if (a) a.hush = null;
    if (a && a.trafficBus && this._tb != null) { a.trafficBus.gain.value = this._tb; this._tb = null; }
    this.silenceT = 0;
    const h = this.o.hud && this.o.hud.hud || this.o.hud;
    if (toast && h && h.showToast) h.showToast('Lest we forget.', 3200);
  }
}
