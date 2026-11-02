// Auto KW: CRUISE NIGHT -- a classic-car meet in Conestoga Mall's north lot,
// on the phone's real Friday and Saturday evenings, 18:00-23:00.
//
//   - THE MEET: 12-20 old cars (vehicles.js `classic` types -- the bug, the
//     stepside, the woodie, the finned convertible -- and the fleet's own
//     70s muscle car and the DeLorean-alike as guests) parked in two rows
//     facing each other across an aisle, some with the hood (the bug: its
//     engine lid) up and a chrome air cleaner showing, people standing round
//     them in twos and threes, one car's radio playing eight bars of shuffle
//     rock'n'roll on a loop (audio.js `cruise_tune`). They are 'apron'
//     traffic (the garages' way: never culled, real, enterable -- take one).
//   - THE SHOW ROW across the far end: painted stalls, a judges' table with
//     a trophy, a BEST IN SHOW banner on two posts, a string of bulbs. Drive
//     your OWN classic in, stop in a stall and wait JUDGE_T s: the judges
//     come round, a ribbon toast and $ by rarity (spec.classic) and condition
//     (health, dents). Once a night (`autokw-cruise` {night, wins, total, best}).
//   - A toast as you arrive (ARRIVE_R), the map icon `cruise` only while it is
//     on, and nothing at all built until you are within BUILD_R; everything is
//     taken down past RELEASE_R or when the evening ends (a car you drove off
//     in is left to traffic as an ordinary car).
//   - OVERRIDE: `?cruise=1` (on) / `?cruise=0` (off), `__dbg.cruise.force(true |
//     false | null)`; `__dbg.cruise.clock` is the Date source.
//
// Phone cost: idle, one clock check a second and one distance test a frame.
// At the meet: the cars (3 draws each near, the far LOD's instances past 40 m;
// MAX_CARS 12 on a phone), the show row (3 draws: one vertex-coloured mesh,
// the banner's canvas, the bulbs), a hood and an engine per open car (+2 each,
// MAX_HOODS 3 on a phone) and the pooled walkers (1 each, MAX_PEOPLE 5).
//
// Harness: __dbg.cruise (`force`, `active()`, `built`, `cars`, `people`,
// `judge`, `stats`, `slots`, `update(dt, player)`), probe tools/kw/cruiseprobe.mjs.

import * as THREE from './three.js';
import * as G from './geo.js';
import { Builder } from './build.js';
import { TYPES, classicColor, randomCarColor } from './vehicles.js';
import { makeHumanoid, animateWalk } from './peds.js';
import { nameOf } from './kwgarage.js';
import { CHEAT } from './cheats.js';
import { clamp, hash2, formatMoney } from './util.js';

const KEY = 'autokw-cruise';
const ON_PHONE = typeof navigator !== 'undefined' && /iPhone|iPad|iPod|Android/i.test(navigator.userAgent || '');
// Conestoga Mall's north lot (OSM amenity=parking, 340 x 130 m between the mall and
// Northfield Dr, tools/data/kw/raw_lots.json): the meet's centre and its rows' axis.
export const SITE = { name: 'Conestoga Mall', x: -4160, z: -4826, rot: 0 };
const BUILD_R = 500, RELEASE_R = 650, ARRIVE_R = 120, MUSIC_R = 170, SHOW_R = 900;
const DAYS = [5, 6], FROM_H = 18, TO_H = 23;
const JUDGE_T = 30;
const MAX_CARS = ON_PHONE ? 12 : 20, MAX_HOODS = ON_PHONE ? 3 : 6, MAX_PEOPLE = ON_PHONE ? 5 : 10;
const GAP = 3.7;                          // stall to stall, m (wide: people stand between)
const ROW_Z = 6.5, SHOW_Z = 21;           // the two rows either side of the aisle, the show row
const PER = Math.ceil((MAX_CARS - 2) / 2);   // stalls in each of the two rows
// What turns up, by weight; the guests are the fleet's own old cars.
const MEET = [['bug', 4], ['pickup50', 4], ['woodie', 3], ['finned', 3], ['muscle', 2], ['delorean', 0.6]];
// A judge's rarity for a car that is not `spec.classic`.
const RARITY = { muscle: 1.2, delorean: 2.0, convertible: 0.8, hellcat: 0.6 };
// The hood (or the bug's engine lid), car-local: hinge z, far edge z, width, the height it lies at.
const HOODS = {
  woodie: { z0: 1.05, z1: 2.78, w: 1.62, y: 0.965, up: 1.0 },
  finned: { z0: 0.85, z1: 2.74, w: 1.70, y: 0.925, up: 1.0 },
  pickup50: { z0: 0.48, z1: 2.30, w: 0.92, y: 1.205, up: 0.95 },
  bug: { z0: -1.30, z1: -1.98, w: 0.78, y: 0.95, up: 1.15 },
  muscle: { z0: 0.75, z1: 2.42, w: 1.50, y: 1.04, up: 1.0 },
};

function read() { try { return JSON.parse(localStorage.getItem(KEY) || '{}') || {}; } catch (e) { return {}; } }
const lin = (h) => [16, 8, 0].map((s) => Math.pow(((h >> s) & 255) / 255, 2.2));
const nightKey = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/** Is a cruise night on at this Date? */
export function cruiseOn(d) {
  const h = d.getHours() + d.getMinutes() / 60;
  return DAYS.includes(d.getDay()) && h >= FROM_H && h < TO_H;
}

export class CruiseNight {
  constructor(o) {
    this.o = o;            // { scene, city, game, hud, audio, traffic, fx }
    this.clock = () => new Date();
    this.forced = null;
    try {
      const q = new URLSearchParams(location.search).get('cruise');
      if (q === '1') this.forced = true; else if (q === '0') this.forced = false;
    } catch (e) { /* no location */ }
    this.on = false; this._tick = 0; this.rot = SITE.rot;
    this.built = false; this.cars = []; this.people = []; this.objs = []; this.hoods = [];
    this.slots = []; this.show = []; this.musicCar = null; this.nextTune = 0;
    this.arrived = false; this.judge = null; this.stats = read();
    this.place = { x: SITE.x, z: SITE.z, kind: 'cruise', label: 'Cruise night', name: 'Cruise night (Conestoga Mall)', near: false, off: true,
      hello: () => `Cruise night in Conestoga Mall's north lot, Fridays and Saturdays 6-11 pm. Park your own classic in the show row for Best in Show${this.judgedTonight() ? ' (judged tonight already)' : ''}.` };
  }

  places() { return [this.place]; }
  force(v) { this.forced = v; this._tick = 0; }
  active() { return this.forced !== null ? this.forced : cruiseOn(this.clock()); }
  judgedTonight() { return this.stats.night === nightKey(this.clock()); }

  /** site-local (lx along the rows, lz across) -> world */
  w(lx, lz) {
    const c = Math.cos(this.rot), s = Math.sin(this.rot);
    return { x: SITE.x + lx * c - lz * s, z: SITE.z + lx * s + lz * c };
  }
  local(x, z) {
    const c = Math.cos(this.rot), s = Math.sin(this.rot), dx = x - SITE.x, dz = z - SITE.z;
    return { lx: dx * c + dz * s, lz: -dx * s + dz * c };
  }
  /** Heading for a car whose nose points along site-local (dx, dz). */
  hd(dx, dz) { const c = Math.cos(this.rot), s = Math.sin(this.rot); return Math.atan2(dx * c - dz * s, dx * s + dz * c); }

  /** A stall is usable: on the ground, off the roads, out of buildings and water. */
  clear(x, z) {
    const city = this.o.city;
    try {
      if (city.onRoad(x, z, 2.5)) return false;
      if (city.insideBuilding && city.insideBuilding(x, z, G.terrainRaw(x, z) + 1, 3)) return false;
      if (G.isWater && G.isWater(x, z)) return false;
    } catch (e) { return false; }
    return true;
  }

  // --- the frame ----------------------------------------------------------------------
  update(dt, player) {
    this._tick -= dt;
    if (this._tick <= 0) { this._tick = 1; this.on = this.active(); this.place.off = !this.on; }
    const veh = player.vehicle && !player.onFoot ? player.vehicle : null;
    const px = veh ? veh.x : player.x, pz = veh ? veh.z : player.z;
    const d = Math.hypot(px - SITE.x, pz - SITE.z);
    if (!this.on || d > RELEASE_R) { if (this.built) this.teardown(player); this.arrived = false; this.judge = null; return; }
    if (!this.built) { if (d < BUILD_R) this.build(); else return; }
    if (!this.arrived && d < ARRIVE_R) {
      this.arrived = true;
      const own = veh && this.rarity(veh) > 0;
      this.say(own ? `Cruise night at ${SITE.name}! Park your ${nameOf(veh.typeName).toLowerCase()} in the show row for Best in Show.`
        : `Cruise night at ${SITE.name} -- the old cars are out. Bring a classic and park it in the show row.`, 5200);
    }
    this.release(player);
    this.tendPeople(dt, player);
    this.music(d);
    this.judging(dt, veh);
  }

  say(t, ms = 4200) { if (this.o.hud) this.o.hud.showToast(t, ms); }

  rarity(v) {
    if (!v || !v.spec || !v.spec.roadCar) return 0;
    return v.spec.classic || RARITY[v.typeName] || 0;
  }

  // --- building it -----------------------------------------------------------------------
  build() {
    const T = this.o.traffic;
    this.built = true;
    // the rows run with the lot's own painted bays (geo.lotCodeAt: the angle the terrain shader paints)
    try {
      const code = G.lotCodeAt(SITE.x, SITE.z);
      this.rot = code ? (((code - 1) % G.LOT_ANG) / G.LOT_ANG) * Math.PI : SITE.rot;
    } catch (e) { this.rot = SITE.rot; }
    // keep the lot's own parked cars out of the meet while it is on
    this.keep = [SITE.x, SITE.z, 48];
    if (T.keepClear) T.keepClear.push(this.keep);
    if (T._lotBays) T._lotBays.clear();
    for (const v of T.cars.slice()) {
      if ((v.mode === 'parked' || v.mode === 'abandoned') && Math.hypot(v.x - SITE.x, v.z - SITE.z) < 48) { try { T.remove(v); } catch (e) { /* gone */ } }
    }
    // the stalls: two rows facing each other across the aisle, then the show row
    const per = PER, slots = [];
    for (const [row, lz, dir] of [[0, -ROW_Z, 1], [1, ROW_Z, -1]]) {
      for (let i = 0; i < per; i++) {
        const lx = (i - (per - 1) / 2) * GAP, p = this.w(lx, lz);
        if (this.clear(p.x, p.z)) slots.push({ row, lx, lz, dir, x: p.x, z: p.z, h: this.hd(0, dir) });
      }
    }
    this.show = [];
    for (let i = 0; i < 6; i++) {
      const lx = (i - 2.5) * (GAP + 0.3), p = this.w(lx, SHOW_Z);
      this.show.push({ lx, lz: SHOW_Z, x: p.x, z: p.z, h: this.hd(0, -1), ok: this.clear(p.x, p.z) });
    }
    this.slots = slots;
    // who came: a deterministic draw per night, so a rebuild shows the same meet
    const seed = (hash2(this.clock().getDate(), this.clock().getMonth()) * 1e6) | 0;
    const sum = MEET.reduce((a, m) => a + m[1], 0);
    const pick = (k) => { let u = hash2(seed, k) * sum; for (const [t, w] of MEET) { if (u < w) return t; u -= w; } return 'bug'; };
    const want = Math.min(MAX_CARS - 2, slots.length);
    // the show row holds two entrants already (stalls 0 and 5); the middle four are yours to take
    const showCars = [this.show[0], this.show[5]].filter((s) => s.ok).map((s, i) => ({ ...s, t: ['finned', 'woodie'][i] }));
    const list = slots.slice(0, want).map((s, i) => ({ ...s, t: pick(i + 1) })).concat(showCars);
    let hoods = 0;
    list.forEach((s, i) => {
      const col = TYPES[s.t].classic ? classicColor(s.t, seed + i * 31) : s.t === 'delorean' ? 0xb9bdc1 : randomCarColor(seed + i * 17);
      let v = null;
      try { v = T.spawnAt(s.x, s.z, s.h, s.t, col, 'apron'); } catch (e) { v = null; }
      if (!v) return;
      v.vLong = 0; v.cruise = true;
      s.v = v;
      this.cars.push(v);
      if (HOODS[s.t] && hoods < MAX_HOODS && hash2(seed, i + 101) < 0.45) { this.hoodUp(v, HOODS[s.t]); hoods++; s.hood = true; }
    });
    this.list = list;
    // the radio: the third car of the first row, else any
    this.musicCar = (list.find((s, i) => i === 2 && s.v) || list.find((s) => s.v) || {}).v || null;
    this.nextTune = 0;
    this.buildShowRow();
    this.addPeople(list, seed);
  }

  /** The hood (or the bug's lid) up on a car: a panel in its own paint, an engine under it. */
  hoodUp(v, H) {
    const S = CruiseNight;
    const len = Math.abs(H.z1 - H.z0), dir = Math.sign(H.z1 - H.z0);
    const key = `${v.typeName}`;
    S.hoodGeo = S.hoodGeo || new Map();
    let g = S.hoodGeo.get(key);
    if (!g) {
      g = new THREE.BoxGeometry(H.w, 0.03, len);
      g.translate(0, 0, (dir * len) / 2);
      g.userData.shared = true;
      S.hoodGeo.set(key, g);
    }
    // the open bay (dark, just over the closed panel) with the engine standing in it,
    // its chrome air cleaner and red valve covers showing over the wings: one geometry a type
    S.bayGeo = S.bayGeo || new Map();
    let bg = S.bayGeo.get(key);
    if (!bg) {
      const B = new Builder(false), zc = H.z0 + (dir * len) / 2, y = H.y + 0.012;
      B.box(0, y, zc, H.w * 0.86, 0.012, len * 0.86, 0, [0.03, 0.03, 0.035]);
      const ew = Math.min(0.62, H.w * 0.6);
      B.box(0, y - 0.05, zc, ew, 0.16, Math.min(0.6, len * 0.5), 0, [0.10, 0.10, 0.11]);       // the block
      B.box(0, y + 0.10, zc, ew * 0.8, 0.05, Math.min(0.5, len * 0.42), 0, [0.42, 0.06, 0.05]); // valve covers
      B.prism(0, y + 0.15, zc, Math.min(0.21, ew * 0.35), 0.07, 14, [0.82, 0.84, 0.88]);      // the air cleaner
      B.box(H.w * 0.30, y, zc - dir * len * 0.25, 0.14, 0.12, 0.22, 0, [0.07, 0.07, 0.08]);   // the battery
      bg = B.build();
      bg.userData.shared = true;
      S.bayGeo.set(key, bg);
    }
    if (!S.engMat) S.engMat = new THREE.MeshStandardMaterial({ vertexColors: true, metalness: 0.55, roughness: 0.4 });
    const pivot = new THREE.Group();
    pivot.position.set(0, H.y + 0.02, H.z0);
    pivot.rotation.x = -dir * H.up;                       // the far edge swings up
    const panel = new THREE.Mesh(g, v.bodyMat);
    panel.castShadow = false;
    pivot.add(panel);
    const eng = new THREE.Mesh(bg, S.engMat);
    (v.tilt || v.group).add(pivot, eng);
    this.hoods.push({ v, pivot, eng });
  }

  buildShowRow() {
    const scene = this.o.scene, city = this.o.city;
    const y0 = (x, z) => city.groundAt(x, z, null) + 0.03;
    const B = new Builder(false);
    const W = (lx, lz) => this.w(lx, lz);
    const box = (lx, lz, w, h, d, col, dy = 0) => { const p = W(lx, lz); B.box(p.x, y0(p.x, p.z) + dy, p.z, w, h, d, this.rot, col); };
    const white = [0.85, 0.85, 0.82], red = lin(0x9c1d1d), gold = lin(0xd4a02a), pole = [0.20, 0.20, 0.22], cloth = lin(0x1d3f7a);
    // stall lines and a red carpet down the show row's front
    for (let i = 0; i <= 6; i++) box((i - 3) * (GAP + 0.3), SHOW_Z, 0.12, 0.01, 5.6, white);
    box(0, SHOW_Z - 3.4, 6 * (GAP + 0.3), 0.012, 1.0, red);
    // the judges' table, its cloth, the trophy, two chairs
    const tx = -3 * (GAP + 0.3) - 3.2, tz = SHOW_Z - 1.0;        // at the row's end, out of the stalls' way
    this.table = { lx: tx, lz: tz };
    box(tx, tz, 0.8, 0.74, 2.2, cloth);
    box(tx, tz, 0.9, 0.04, 2.3, white, 0.74);
    box(tx, tz - 0.4, 0.16, 0.05, 0.16, gold, 0.78);
    box(tx, tz - 0.4, 0.05, 0.22, 0.05, gold, 0.83);
    box(tx, tz - 0.4, 0.20, 0.10, 0.20, gold, 1.05);
    for (const cz of [-0.6, 0.6]) box(tx - 0.8, tz + cz, 0.45, 0.45, 0.45, pole);
    // the banner's posts behind the show row, the bulbs' poles at the aisle's ends
    const ends = [-4.2, 4.2], BZ = SHOW_Z + 3.8;
    for (const lx of ends) box(lx, BZ, 0.12, 3.6, 0.12, pole);
    for (const lx of [-0.5 * (PER + 1) * GAP, 0.5 * (PER + 1) * GAP]) box(lx, 0, 0.14, 5.0, 0.14, pole);
    const base = new THREE.Mesh(B.build(), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.75, metalness: 0.1 }));
    base.name = 'cruise:base';
    this.obj(base);
    // the banner: BEST IN SHOW on a canvas, between the posts
    const cv = document.createElement('canvas');
    cv.width = 512; cv.height = 96;
    const c = cv.getContext('2d');
    c.fillStyle = '#16305e'; c.fillRect(0, 0, 512, 96);
    c.strokeStyle = '#e8c35a'; c.lineWidth = 6; c.strokeRect(6, 6, 500, 84);
    c.fillStyle = '#f4ead2'; c.font = 'bold 50px Georgia, serif'; c.textAlign = 'center'; c.textBaseline = 'middle';
    c.fillText('BEST IN SHOW', 256, 50);
    const tex = new THREE.CanvasTexture(cv);
    const bw = ends[1] - ends[0] - 0.4;
    const bm = new THREE.Mesh(new THREE.PlaneGeometry(bw, bw * 96 / 512), new THREE.MeshBasicMaterial({ map: tex, side: THREE.DoubleSide, toneMapped: false }));
    const bp = W(0, BZ);
    bm.position.set(bp.x, y0(bp.x, bp.z) + 2.9, bp.z);
    bm.rotation.y = Math.PI - this.rot;
    bm.name = 'cruise:banner';
    bm.userData.tex = tex;
    this.obj(bm);
    // a string of bulbs over the aisle, sagging between the poles
    const L = new Builder(false), n = 26, half = 0.5 * (PER + 1) * GAP;
    const cols = [lin(0xffd27a), lin(0xff7a5a), lin(0x9fd6ff), lin(0xfff3c4)];
    for (let i = 0; i <= n; i++) {
      const t = i / n, lx = -half + 2 * half * t, sag = 1.3 * Math.sin(Math.PI * t), p = W(lx, 0);
      L.box(p.x, y0(p.x, p.z) + 4.85 - sag, p.z, 0.16, 0.16, 0.16, 0, cols[i % 4].map((v) => v * 1.6));
    }
    const bulbs = new THREE.Mesh(L.build(), new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false }));
    bulbs.name = 'cruise:bulbs';
    this.obj(bulbs);
  }

  obj(m) { m.userData.cruise = true; this.o.scene.add(m); this.objs.push(m); return m; }

  addPeople(list, seed) {
    const city = this.o.city;
    const spots = [];
    // the judge at the table, looking down the show row
    if (this.table) { const p = this.w(this.table.lx + 0.75, this.table.lz); spots.push({ x: p.x, z: p.z, face: this.hd(1, 0) }); }
    // round the open hoods first, then pairs in the aisle and by the show row
    for (const s of list) {
      if (!s.v || !s.hood) continue;
      const H = HOODS[s.t], fz = (H.z0 + H.z1) / 2 + Math.sign(H.z1 - H.z0) * 1.2;
      const f = { x: Math.sin(s.h), z: Math.cos(s.h) }, r = { x: Math.cos(s.h), z: -Math.sin(s.h) };
      spots.push({ x: s.x + f.x * fz + r.x * 0.6, z: s.z + f.z * fz + r.z * 0.6, face: s.h + Math.PI });
      spots.push({ x: s.x + f.x * fz - r.x * 0.7, z: s.z + f.z * fz - r.z * 0.7, face: s.h + Math.PI + 0.3 });
    }
    for (let k = 0; k < 6; k++) {
      const lx = (hash2(seed, k + 300) - 0.5) * this.slots.length * GAP * 0.5, lz = (hash2(seed, k + 400) - 0.5) * 3;
      const a = this.w(lx - 0.55, lz), b = this.w(lx + 0.55, lz);
      const ha = this.hd(1, 0), hb = this.hd(-1, 0);
      spots.push({ x: a.x, z: a.z, face: ha }, { x: b.x, z: b.z, face: hb });
    }
    const n = Math.min(MAX_PEOPLE, spots.length);
    for (let i = 0; i < n; i++) {
      const sp = spots[i];
      const h = makeHumanoid({ seed: seed + i * 7 });
      const y = city.groundAt(sp.x, sp.z, null);
      h.group.position.set(sp.x, y, sp.z);
      h.group.rotation.y = sp.face;
      this.o.scene.add(h.group);
      this.people.push({ h, x: sp.x, z: sp.z, face: sp.face, t: hash2(seed, i) * 10 });
    }
  }

  tendPeople(dt, player) {
    const px = player.x, pz = player.z;
    for (const p of this.people) {
      p.t += dt;
      animateWalk(p.h, 0, dt, 0);
      // a slow turn to look at you as you walk up, then back to the car
      const dx = px - p.x, dz = pz - p.z, near = dx * dx + dz * dz < 36 && player.onFoot !== false;
      const want = near ? Math.atan2(dx, dz) : p.face + 0.25 * Math.sin(p.t * 0.4);
      const cur = p.h.group.rotation.y;
      let d = want - cur; d = Math.atan2(Math.sin(d), Math.cos(d));
      p.h.group.rotation.y = cur + d * Math.min(1, dt * 2);
    }
  }

  music(d) {
    const A = this.o.audio, v = this.musicCar;
    if (!A || !A.play || !A.ctx || !v || v.dead || d > MUSIC_R) { this.nextTune = 0; return; }
    const now = A.now();
    if (!this.nextTune || this.nextTune < now - 1) this.nextTune = now + 0.1;
    if (this.nextTune - now < 0.6) {
      A.play('cruise_tune', { gain: 0.75, x: v.x, y: v.y + 1.0, z: v.z, ref: 9, maxD: MUSIC_R + 30, jitter: false, at: this.nextTune - now });
      this.nextTune += 12.9;
    }
  }

  // --- Best in Show -----------------------------------------------------------------------
  stallOf(v) {
    const l = this.local(v.x, v.z);
    for (let i = 1; i < 5; i++) {
      const s = this.show[i];
      if (s && Math.abs(l.lx - s.lx) < 1.7 && Math.abs(l.lz - s.lz) < 3.2) return i;
    }
    return -1;
  }

  judging(dt, veh) {
    const r = this.rarity(veh);
    if (!veh || !r || veh.cruise) { this.judge = null; return; }
    const st = this.stallOf(veh);
    if (st < 0) { if (this.judge && this.judge.t > 0) this.say('Back in the show row to be judged.', 2200); this.judge = null; return; }
    if (this.judgedTonight()) {
      if (!this.judge) { this.judge = { t: -1 }; this.say('The judges have been round tonight -- come back next cruise night.', 3600); }
      return;
    }
    if (!this.judge || this.judge.v !== veh) this.judge = { v: veh, t: 0, said: 0 };
    if (Math.abs(veh.vLong) > 0.5) return;   // parked, please
    const J = this.judge;
    J.t += dt;
    if (J.said === 0) { J.said = 1; this.say(`Parked in the show row. The judges are coming round (${JUDGE_T} s).`, 3600); }
    if (J.said === 1 && J.t > JUDGE_T * 0.5) { J.said = 2; this.say('A judge walks round your car, nodding, making notes...', 3200); }
    if (J.t >= JUDGE_T) this.award(veh, r);
  }

  /** The judges' verdict: a ribbon and $ by rarity and condition. Once a night. */
  award(v, r) {
    const cond = clamp((v.health == null ? 100 : v.health) / 100 - 0.06 * (v.dents || 0), 0.25, 1);
    const score = r * cond;
    const [ribbon, rank] = score >= 2 ? ['blue', 'BEST IN SHOW'] : score >= 1.25 ? ['red', 'second in show'] : ['white', 'third in show'];
    const pay = Math.round((150 * r * cond) / 5) * 5 + (ribbon === 'blue' ? 250 : 0);
    const name = nameOf(v.typeName).toLowerCase(), cheat = CHEAT.on;
    const g = this.o.game;
    if (!cheat) {
      if (g) g.money += pay;
      const s = this.stats;
      s.night = nightKey(this.clock()); s.wins = (s.wins || 0) + 1; s.total = (s.total || 0) + pay;
      if (!s.best || score > s.best.score) s.best = { t: v.typeName, score: +score.toFixed(2), ribbon };
      try { localStorage.setItem(KEY, JSON.stringify(s)); } catch (e) { /* private mode */ }
    }
    this.judge = { v, t: -1, done: true, pay: cheat ? 0 : pay, ribbon };
    this.lastAward = { pay: cheat ? 0 : pay, ribbon, score, cond, r };
    this.say(`${rank.toUpperCase()}! The ${ribbon} ribbon for your ${name} -- ${cheat ? '(cheats are on: not counted)' : formatMoney(pay)} (rarity x${r}, condition ${Math.round(cond * 100)} %)`, 6500);
    if (this.o.audio && this.o.audio.play) { this.o.audio.play('pickup'); this.o.audio.play('cash'); }
    if (this.o.fx) this.o.fx.emit(v.x, v.y + 1.6, v.z, 30, { r: ribbon === 'blue' ? 0.3 : ribbon === 'red' ? 1 : 1, g: ribbon === 'blue' ? 0.5 : ribbon === 'red' ? 0.3 : 1, b: ribbon === 'blue' ? 1 : ribbon === 'red' ? 0.3 : 1, size: 0.4, life: 1.4, spread: 3, vy: 3, grav: 2, jitter: 0.6 });
  }

  // --- taking it down --------------------------------------------------------------------
  teardown(player) {
    const T = this.o.traffic, pv = player && player.vehicle;
    for (const h of this.hoods) { h.pivot.parent && h.pivot.parent.remove(h.pivot); h.eng.parent && h.eng.parent.remove(h.eng); }
    this.hoods.length = 0;
    for (const v of this.cars) {
      // one you drove off in is yours now: traffic's to keep or cull as any car
      if (v === pv || v.cruiseTaken) { v.cruise = false; continue; }
      try { if (T.cars.includes(v)) T.remove(v); } catch (e) { /* gone */ }
    }
    this.cars.length = 0;
    for (const p of this.people) { this.o.scene.remove(p.h.group); p.h.dispose(); }
    this.people.length = 0;
    for (const m of this.objs) {
      this.o.scene.remove(m);
      if (m.geometry && !m.geometry.userData.shared) m.geometry.dispose();
      if (m.userData.tex) m.userData.tex.dispose();
      if (m.material) m.material.dispose();
    }
    this.objs.length = 0;
    if (this.keep && T.keepClear) { const i = T.keepClear.indexOf(this.keep); if (i >= 0) T.keepClear.splice(i, 1); }
    if (T._lotBays) T._lotBays.clear();
    this.keep = null; this.list = null; this.slots = []; this.show = []; this.musicCar = null;
    this.built = false; this.judge = null;
  }

  /** A meet car the player has driven off in (out of its stall): it is not the meet's any more. */
  release(player) {
    const pv = player && player.vehicle;
    if (!pv || !pv.cruise || !this.list) return;
    const s = this.list.find((q) => q.v === pv);
    if (s && Math.hypot(pv.x - s.x, pv.z - s.z) > 6) {
      pv.cruise = false; pv.cruiseTaken = true;
      for (const h of this.hoods.filter((q) => q.v === pv)) { h.pivot.parent && h.pivot.parent.remove(h.pivot); h.eng.parent && h.eng.parent.remove(h.eng); }
      this.hoods = this.hoods.filter((q) => q.v !== pv);
      this.cars = this.cars.filter((v) => v !== pv);
      if (this.musicCar === pv) this.musicCar = null;
    }
  }
}

