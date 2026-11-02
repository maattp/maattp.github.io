// YOUR GARAGES (GTA's save garages): three small garages -- one on a street by University
// Ave & Bridge St in Waterloo (home), one in downtown Kitchener, one in Galt -- that keep the
// cars you find.
//
//   - DRIVE A ROAD VEHICLE IN AND STOP. The door comes down behind you, the car is SAVED and
//     you are put out on the street. Three stalls per garage; a full garage says so.
//     What is kept (localStorage `autokw-garages`, { g: { home: [rec|null x3], kitchener, galt } }):
//     the type, the paint as it is NOW (so Respray's colour persists: bodyMat's hex), which
//     of a taxi's liveries, the plate and the health. Dents are not kept.
//   - THE SAVED CARS STAND INSIDE as 'apron' vehicles (traffic never culls an apron car, the
//     Golden Goose Garage's way), nose out, enterable like any parked car. They are spawned
//     when you come within SPAWN_R and removed past RELEASE_R, so a far garage costs
//     nothing; the saved record, not the vehicle, is the truth (a wreck or a vanished car is
//     simply spawned again). Drive one out past the door and its stall is free (the record
//     goes); drive another in and stop and it takes its place.
//   - THE DOOR opens as you come within OPEN_R on foot or in a car, and shuts when you leave.
//     A vehicle that does not fit (a bus, a plane, a boat, a tractor, a trailer rig, a tank,
//     anything over `MAX_LEN`) finds it shut, with a toast saying why.
//   - Where each stands is found at boot like the spray bays (`placeGarages`, beside
//     respray's `placeBays`): the clear frontage nearest a real place, off the carriageway,
//     out of every building, dry, level, and its clear circle pushed before any chunk scatters.
//
// Phone cost: nothing drawn until you are within BUILD_R of a garage; then one merged
// vertex-coloured mesh, the door and the sign (3 draws, ~700 tris, shown within SHOW_R), and the
// three cars only inside SPAWN_R. Shared geometry and materials but the body. No lights.
//
// Harness: __dbg.garages (`sites`, `data`, `store(i, rec)`, `slots`), probe tools/kw/garageprobe.mjs.

import * as THREE from './three.js';
import * as G from './geo.js';
import { Builder } from './build.js';
import { clamp } from './util.js';
import { PLATE_STEP } from './vehicles.js';

const KEY = 'autokw-garages';
const NSLOT = 3;
const IW = 9.9, ID = 7.9, WT = 0.4, DH = 3.0, WALL_H = 3.6;   // inner width (3 stalls), inner depth, wall, door height, wall height
const STALL = 3.3, MAX_LEN = 6.45;
const MOUTH_OFF = 2.6;
const OPEN_R = 17, BUILD_R = 650, SHOW_R = 450, SPAWN_R = 320, RELEASE_R = 480;
const DWELL = 0.7;       // seconds stopped inside before the save
const ON_PHONE = typeof navigator !== 'undefined' && /iPhone|iPad|iPod|Android/i.test(navigator.userAgent || '');

// The three garages: a point to be nearest to (world metres via tools/kw/proj.py) and their words.
//   home: University Ave E & Bridge St E, Waterloo (the plaza at 425 University Ave E is at -1380,-4160)
//   kitchener: King St W & Ontario St, downtown;  galt: Main St & Water St, Galt
export const GARAGES = [
  { id: 'home', res: true, name: 'Home garage', sub: 'WATERLOO  ·  UNIVERSITY & BRIDGE', x: -1380, z: -4160, wall: 0x8a5a3c, trim: 0xe9e2d2, bg: '#2d4a3a', ink: '#f3ecd8' },
  { id: 'kitchener', name: 'Downtown garage', sub: 'KITCHENER  ·  KING & ONTARIO', x: -1457, z: 111, wall: 0x56606c, trim: 0xd9d4c4, bg: '#27384f', ink: '#f2f2ee' },
  { id: 'galt', name: 'Galt garage', sub: 'CAMBRIDGE  ·  MAIN & WATER', x: 13112, z: 10332, wall: 0x7a4a46, trim: 0xe6ddc8, bg: '#4a2f2d', ink: '#f6efe0' },
];

// what a type is called in the passport row (anything else: its key, title-cased)
const NAMES = { sedan: 'Sedan', hellcat: 'Hellcat', delorean: 'DeLorean-alike', zamboni: 'Zamboni', taxi: 'Taxi', police: 'Police car', opp: 'OPP cruiser',
  ambulance: 'Ambulance', wedge: 'Wedge', hearse: 'Hearse', limo: 'Limo', wiener: 'Weenie Wagon', swat: 'SWAT truck', pickup: 'Pickup', lifted: 'Lifted truck',
  postvan: 'Post van', purovan: 'Puro van', amzvan: 'Amazon van', uhaul: 'U-Haul', icecream: 'Ice cream truck', suv: 'SUV', van: 'Van', coupe: 'Coupe' };
const nameOf = (t) => NAMES[t] || (t ? t.charAt(0).toUpperCase() + t.slice(1) : 'Car');

function readAll() {
  try {
    const o = JSON.parse(localStorage.getItem(KEY) || '{}') || {};
    const g = o.g || {};
    const out = {};
    for (const G0 of GARAGES) {
      const a = Array.isArray(g[G0.id]) ? g[G0.id] : [];
      out[G0.id] = Array.from({ length: NSLOT }, (_, i) => (a[i] && typeof a[i].t === 'string' ? a[i] : null));
    }
    return out;
  } catch (e) { return Object.fromEntries(GARAGES.map((x) => [x.id, new Array(NSLOT).fill(null)])); }
}

/**
 * Where each garage stands (like respray.js placeBays): the clear frontage nearest its point, mouth to a
 * street. Returns [{ g, site: { ox, oz, nx, nz, rot, y, slope } | null }]; pushes the clear circle.
 */
export function placeGarages(city, waterAt, list = GARAGES) {
  const out = [];
  const wet = (x, z) => {
    if (G.isWater(x, z)) return true;
    if (!waterAt) return false;
    const w = waterAt(x, z);
    return w !== null && w > G.terrainHeight(x, z) + 0.05;
  };
  for (const sh of list) {
    const bl = city.buildingsNear(sh.x, sh.z, 330);
    const inB = (x, z, pad) => {
      for (const b of bl) {
        const c = Math.cos(-b.rot), s = Math.sin(-b.rot), dx = x - b.x, dz = z - b.z;
        if (Math.abs(dx * c - dz * s) < b.w / 2 + pad && Math.abs(dx * s + dz * c) < b.d / 2 + pad) return true;
      }
      return false;
    };
    const eds = city.edgesNear(sh.x, sh.z, 260).map((ei) => {
      const e = city.edges[ei];
      if (e.elev || e.tunnel || e.noTraffic || e.cls === 'hwy' || e.cls === 'ramp') return null;
      const a = city.nodes[e.a];
      const t = clamp((sh.x - a.x) * e.dx + (sh.z - a.z) * e.dz, 0, e.len);
      const px = a.x + e.dx * t, pz = a.z + e.dz * t;
      return { e, a, t, d: Math.hypot(sh.x - px, sh.z - pz) };
    }).filter(Boolean).sort((p, q) => p.d - q.d).slice(0, sh.res ? 60 : 14);
    let best = null;
    for (const tol of [0.15, 0.4]) {
      for (const c of eds) {
        const e = c.e;
        for (let t = 6; t <= e.len - 6; t += 4) {
          const qx = c.a.x + e.dx * t, qz = c.a.z + e.dz * t;
          if (Math.hypot(qx - sh.x, qz - sh.z) > (sh.res ? 450 : 300)) continue;
          for (const side of [1, -1]) {
            const nx = -e.dz * side, nz = e.dx * side;   // from the street toward the garage
            const ox = qx + nx * (e.hw + MOUTH_OFF), oz = qz + nz * (e.hw + MOUTH_OFF);
            const score0 = Math.hypot(ox + nx * ID / 2 - sh.x, oz + nz * ID / 2 - sh.z);
            if (best && score0 + 4 >= best.score) continue;   // (the residential penalty only adds)
            const rot = Math.atan2(-nx, nz);
            const cr = Math.cos(rot), sr = Math.sin(rot);
            const P = (lx, lz) => [ox + lx * cr - lz * sr, oz + lx * sr + lz * cr];
            let ok = true, lo = Infinity, hi = -Infinity;
            for (let lz = -0.4; lz <= ID + WT + 0.6 && ok; lz += 1.6) {
              for (let lx = -IW / 2 - WT - 0.5; lx <= IW / 2 + WT + 0.5; lx += 1.6) {
                const [px, pz] = P(lx, lz);
                if (city.onRoad(px, pz, 0.3, true, false) || inB(px, pz, 0.5) || city.jumpClear(px, pz) || wet(px, pz)) { ok = false; break; }
                if (city.landmarkHit && city.landmarkHit(px, pz, 0.6, G.terrainHeight(px, pz) + 1, true)) { ok = false; break; }
                if (city.barrierHit && city.barrierHit(px, pz, 0.6, G.terrainHeight(px, pz) + 1)) { ok = false; break; }
                const y = G.terrainHeight(px, pz);
                lo = Math.min(lo, y); hi = Math.max(hi, y);
              }
            }
            if (!ok || hi - lo > tol * 2) continue;
            // the approach: from the mouth out to the kerb, two cars wide
            for (let lz = -MOUTH_OFF; lz < -0.4 && ok; lz += 1.0) {
              for (const lx of [-3.2, -1.6, 0, 1.6, 3.2]) {
                const [px, pz] = P(lx, lz);
                if (inB(px, pz, 0.6) || wet(px, pz)) { ok = false; break; }
                if (city.barrierHit && city.barrierHit(px, pz, 0.7, G.terrainHeight(px, pz) + 1)) { ok = false; break; }
                if (city.landmarkHit && city.landmarkHit(px, pz, 0.7, G.terrainHeight(px, pz) + 1, true)) { ok = false; break; }
              }
            }
            if (!ok) continue;
            const score = score0 + (hi - lo) * 20 + (sh.res && e.cls !== 'res' ? 150 : 0);
            if (!best || score < best.score) best = { score, ox, oz, nx, nz, rot, y: hi + 0.04, e, slope: hi - lo, dist: score0 };
          }
        }
      }
      if (best) break;
    }
    if (!best) { out.push({ g: sh, site: null }); continue; }
    const cx = best.ox + best.nx * (ID / 2), cz = best.oz + best.nz * (ID / 2);
    if (!city.clearCircles) city.clearCircles = [];
    city.clearCircles.push([cx, cz, 8.8], [best.ox - best.nx * 3, best.oz - best.nz * 3, 5]);
    out.push({ g: sh, site: best });
  }
  return out;
}

const lin = (hex) => { const c = new THREE.Color(hex); return [c.r, c.g, c.b]; };

function signTexture(sh) {
  const c = document.createElement('canvas');
  c.width = 1024; c.height = 224;
  const g = c.getContext('2d');
  g.fillStyle = sh.bg; g.fillRect(0, 0, 1024, 224);
  g.fillStyle = sh.ink; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.font = '800 96px system-ui, sans-serif';
  g.fillText('YOUR GARAGE', 512, 86);
  g.font = '700 46px system-ui, sans-serif'; g.globalAlpha = 0.85;
  g.fillText(sh.sub, 512, 168);
  g.globalAlpha = 1; g.strokeStyle = sh.ink; g.lineWidth = 8; g.strokeRect(8, 8, 1008, 208);
  const t = new THREE.CanvasTexture(c);
  t.anisotropy = 4;
  return t;
}

function doorTexture() {
  const c = document.createElement('canvas');
  c.width = 64; c.height = 256;
  const g = c.getContext('2d');
  g.fillStyle = '#e4e1d6'; g.fillRect(0, 0, 64, 256);
  for (let y = 0; y < 256; y += 64) {
    g.fillStyle = '#9d9a8e'; g.fillRect(0, y, 64, 3);
    g.fillStyle = '#c9c6b8'; g.fillRect(6, y + 10, 52, 44);
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

export class Garages {
  /** o: { scene, city, game, hud, audio, traffic, bays: placeGarages(...) } */
  constructor(o) {
    this.scene = o.scene; this.city = o.city; this.game = o.game; this.hud = o.hud; this.audio = o.audio; this.traffic = o.traffic;
    this.data = readAll();
    this.sites = [];
    const solids = [];
    for (const b of o.bays) {
      if (!b.site) continue;
      const s = b.site;
      const cr = Math.cos(s.rot), sr = Math.sin(s.rot);
      const W = (lx, lz) => [s.ox + lx * cr - lz * sr, s.oz + lx * sr + lz * cr];
      const y0 = s.y, y1 = s.y + WALL_H;
      const wall = (lx, lz, hw, hd) => { const [x, z] = W(lx, lz); const w = { x, z, hw, hd, rot: s.rot, y0, y1 }; solids.push(w); return w; };
      wall(-(IW / 2 + WT / 2), ID / 2, WT / 2, ID / 2 + WT);
      wall(IW / 2 + WT / 2, ID / 2, WT / 2, ID / 2 + WT);
      wall(0, ID + WT / 2, IW / 2 + WT, WT / 2);
      const door = wall(0, 0.2, IW / 2 + WT, 0.25);
      door.y1 = y0 - 50;   // (y1 under y0 turns a solid off)
      const [mx, mz] = W(0, ID / 2);
      this.sites.push({ g: b.g, s, door, k: 0, built: false, grp: null, doorMesh: null, mx, mz, cars: new Array(NSLOT).fill(null),
        shut: 0, dwell: 0, seq: null, toastAt: 0, W });
    }
    if (solids.length && this.city.addLandmarkSolids) this.city.addLandmarkSolids(solids);
    this.bodyMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, metalness: 0.02 });
    this.doorMat = new THREE.MeshStandardMaterial({ map: doorTexture(), roughness: 0.6, metalness: 0.3, side: THREE.DoubleSide });
    this.doorGeo = new THREE.PlaneGeometry(IW + 0.2, DH).translate(0, -DH / 2, 0);
    this.signGeo = new THREE.PlaneGeometry(IW + 2 * WT, (IW + 2 * WT) * 0.21875);
    this.px = 0; this.pz = 0;
  }

  save() {
    try { localStorage.setItem(KEY, JSON.stringify({ v: 1, g: this.data })); } catch (e) { /* private mode */ }
  }

  count(q) { return this.data[q.g.id].filter(Boolean).length; }

  places() {
    return this.sites.map((q) => ({
      x: q.mx, z: q.mz, kind: 'garage', label: true, name: `Your garage (${q.g.name.replace(' garage', '')})`, near: false,
      hello: () => this.hello(q),
    }));
  }

  hello(q) {
    const list = this.data[q.g.id].filter(Boolean).map((r) => nameOf(r.t));
    return `${q.g.name} — drive a car in and stop to save it. ${list.length ? 'Inside: ' + list.join(', ') : 'Empty'} (${list.length}/${NSLOT})`;
  }

  /** The pause-menu passport rows. */
  passportRows() {
    return this.sites.map((q) => {
      const list = this.data[q.g.id].filter(Boolean).map((r) => nameOf(r.t));
      return { label: `${q.g.name}${list.length ? ': ' + list.join(', ') : ''}`, done: list.length, total: NSLOT };
    });
  }

  /** Is this a vehicle the garage takes? A road car or a bike that fits. */
  fits(v) {
    if (!v || v.dead) return false;
    const s = v.spec;
    return !!((s.roadCar || s.moto) && !s.rail && !s.bus && !s.towed && !s.trailer && !v.trailer && !v.leader && !s.plane && !s.boat && !s.tank
      && !s.offroad && !s.fire && !v.story && !v.isFloat && s.len <= MAX_LEN && s.wid <= 2.5);
  }

  why(v) {
    const s = v.spec;
    if (s.plane || s.heli || s.balloon) return 'it flies';
    if (s.boat || s.jetski || s.kayak || s.hydro) return 'it floats';
    if (s.rail) return 'it runs on rails';
    if (s.bus || s.towed || s.trailer || v.trailer || s.len > MAX_LEN || s.fire) return 'it will not fit';
    return 'it is not a road vehicle';
  }

  // --- the building, made when you come near ----------------------------------

  build(q) {
    q.built = true;
    const s = q.s, sh = q.g;
    const cr = Math.cos(s.rot), sr = Math.sin(s.rot);
    const B = new Builder(false);
    const wallC = lin(sh.wall), trimC = lin(sh.trim), conc = [0.34, 0.34, 0.35], inner = [0.66, 0.65, 0.61], roofC = [0.12, 0.12, 0.13], lineC = [0.85, 0.75, 0.2];
    const bx = (lx, lz, w, d, y0, h, col) => {
      const x = s.ox + lx * cr - lz * sr, z = s.oz + lx * sr + lz * cr;
      B.box(x, s.y + y0, z, w, h, d, s.rot, col);
    };
    // the slab (deep enough to hide the ground's slope under it) and the apron before the door
    bx(0, ID / 2, IW + 1.2, ID + 1.2, -1.2, 1.2, conc);
    bx(0, -1.3, IW + 1.6, 2.6, -1.2, 1.2, conc);
    // stall lines
    for (let i = 0; i <= NSLOT; i++) bx((i - NSLOT / 2) * STALL, ID / 2, 0.12, ID - 1.2, 0.03, 0.02, lineC);
    bx(-(IW / 2 + WT / 2), ID / 2, WT, ID + 2 * WT, 0, WALL_H, wallC);
    bx(IW / 2 + WT / 2, ID / 2, WT, ID + 2 * WT, 0, WALL_H, wallC);
    bx(0, ID + WT / 2, IW + 2 * WT, WT, 0, WALL_H, wallC);
    bx(-(IW / 2 - 0.03), ID / 2, 0.06, ID, 0.05, WALL_H - 0.5, inner);
    bx(IW / 2 - 0.03, ID / 2, 0.06, ID, 0.05, WALL_H - 0.5, inner);
    bx(0, ID - 0.03, IW, 0.06, 0.05, WALL_H - 0.5, inner);
    // the header over the mouth, the trim band and the roof with a lip
    bx(0, 0.2, IW + 2 * WT, 0.5, DH, WALL_H - DH, wallC);
    bx(0, -0.05, IW + 2 * WT + 0.3, 0.3, WALL_H, 0.9, trimC);
    bx(0, (ID + WT) / 2 - 0.1, IW + 2 * WT + 0.4, ID + WT + 0.8, WALL_H + 0.9, 0.26, roofC);
    for (const sx of [-1, 1]) bx(sx * (IW / 2 + WT + 0.25), -0.7, 0.3, 0.3, 0, 0.9, trimC);
    const geo = B.build();
    const body = new THREE.Mesh(geo, this.bodyMat);
    body.castShadow = !ON_PHONE; body.receiveShadow = false;
    const grp = new THREE.Group();
    grp.add(body);
    const tex = signTexture(sh);
    const sign = new THREE.Mesh(this.signGeo, new THREE.MeshBasicMaterial({ map: tex, toneMapped: false }));
    const sw = IW + 2 * WT, sy = s.y + WALL_H + 0.9 + sw * 0.21875 / 2 + 0.05;
    sign.position.set(s.ox + 0.26 * sr, sy, s.oz - 0.26 * cr);
    sign.rotation.y = Math.PI - s.rot;   // facing the street (as respray.js's)
    grp.add(sign);
    const door = new THREE.Mesh(this.doorGeo, this.doorMat);
    door.position.set(s.ox + 0.2 * -sr, s.y + DH, s.oz + 0.2 * cr);
    door.rotation.y = -s.rot;
    door.scale.y = 0.001; door.visible = false;
    grp.add(door);
    q.doorMesh = door;
    grp.visible = false;
    q.grp = grp;
    this.scene.add(grp);
  }

  local(q, x, z) {
    const s = q.s, dx = x - s.ox, dz = z - s.oz;
    const cr = Math.cos(s.rot), sr = Math.sin(s.rot);
    return { lx: dx * cr + dz * sr, lz: -dx * sr + dz * cr };
  }

  /** Stall j's centre in the world and the heading a car stands at (nose to the street). */
  stall(q, j) {
    const [x, z] = q.W((j - (NSLOT - 1) / 2) * STALL, ID / 2);
    return { x, z, heading: Math.atan2(-q.s.nx, -q.s.nz) };
  }

  setDoor(q, k) {
    q.k = k;
    q.doorMesh.visible = k > 0.01;
    q.doorMesh.scale.y = Math.max(0.001, k);
    q.door.y1 = k > 0.5 ? q.s.y + DH : q.s.y - 50;
  }

  // --- the cars --------------------------------------------------------------------

  snapshot(v) {
    const li = v.spec.liveries ? v.spec.liveries.indexOf(v.color) : -1;
    return { t: v.typeName, c: v.bodyMat.color.getHex(), li, h: Math.round(v.health), pk: v.plateK };
  }

  spawnStored(q, j) {
    const rec = this.data[q.g.id][j];
    if (!rec) return null;
    const st = this.stall(q, j);
    let v = null;
    try {
      v = this.traffic.spawnAt(st.x, st.z, st.heading, rec.t, rec.li >= 0 ? rec.li : rec.c, 'apron');
    } catch (e) { v = null; }
    if (!v) { console.warn('garage: cannot spawn ' + rec.t); this.data[q.g.id][j] = null; this.save(); return null; }
    if (v.bodyMat.color.getHex() !== rec.c) { v.bodyMat.color.setHex(rec.c); v.color = rec.c; v._farCol = null; }
    if (rec.pk != null && v.trimMesh && rec.pk !== v.plateK) { v.plateK = rec.pk; v.trimMesh.scale.x = 1 + rec.pk / PLATE_STEP; }
    v.health = Math.max(15, rec.h || v.health);
    v.vLong = 0; v.garage = [q.g.id, j];
    q.cars[j] = v;
    return v;
  }

  dropCar(q, j) {
    const v = q.cars[j];
    q.cars[j] = null;
    if (v && !v.garageOut) { try { this.traffic.remove(v); } catch (e) { /* gone */ } }
  }

  /** Stand the stored cars up when you are near, and take them in when you are not. */
  tendCars(q, d, player) {
    const rows = this.data[q.g.id];
    for (let j = 0; j < NSLOT; j++) {
      const cur = q.cars[j];
      if (d > RELEASE_R) { if (cur && cur !== player.vehicle) this.dropCar(q, j); continue; }
      if (!rows[j]) { if (cur && cur !== player.vehicle) this.dropCar(q, j); continue; }
      if (d > SPAWN_R) continue;
      if (cur && !cur.dead) continue;
      if (cur) this.dropCar(q, j);
      this.spawnStored(q, j);
    }
  }

  /** Per-car upkeep: out of the mouth is out of the garage; one the player left inside stays put. */
  watchCars(q, player) {
    const pv = player.onFoot ? null : player.vehicle;
    for (let j = 0; j < NSLOT; j++) {
      const v = q.cars[j];
      if (!v) continue;
      if (v === pv) {
        const lc = this.local(q, v.x, v.z);
        if (lc.lz < -1.0 || Math.abs(lc.lx) > IW / 2 + 3) {
          // driven out: the slot is free
          this.data[q.g.id][j] = null; q.cars[j] = null; v.garage = null; v.garageOut = true; this.save();
          if (this.hud) this.hud.showToast(`${nameOf(v.typeName)} out of ${q.g.name.toLowerCase()} (${this.count(q)}/${NSLOT})`, 2600);
        }
        continue;
      }
      if (v.mode !== 'apron') { v.mode = 'apron'; v.vLong = 0; }
      const st = this.stall(q, j);
      if (Math.hypot(v.x - st.x, v.z - st.z) > 3.5) { v.place(st.x, st.z, st.heading); v.vLong = 0; }
    }
  }

  // --- the frame ---------------------------------------------------------------------

  tick(dt, player) {
    const foot = player.onFoot !== false && !player.vehicle;
    const veh = foot ? null : player.vehicle;
    const px = veh ? veh.x : player.x, pz = veh ? veh.z : player.z;
    this.px = px; this.pz = pz;
    for (const q of this.sites) {
      const d = Math.hypot(q.mx - px, q.mz - pz);
      if (!q.built && d < BUILD_R) { try { this.build(q); } catch (e) { q.built = true; console.warn('garage build: ' + e.message); } }
      this.tendCars(q, d, player);
      if (!q.grp) continue;
      q.grp.visible = d < SHOW_R;
      if (d > SHOW_R) continue;
      this.watchCars(q, player);
      q.shut = Math.max(0, q.shut - dt);
      const lc = veh ? this.local(q, veh.x, veh.z) : this.local(q, px, pz);
      const fit = !veh || this.fits(veh) || veh.garage;
      let want = 1;
      if (d < OPEN_R + ID / 2 && fit && q.shut <= 0) want = 0;
      if (q.seq) want = 1;
      if (veh && !fit && d < OPEN_R + 6 && lc.lz < -2.2) {
        const now = performance.now();
        if (now - q.toastAt > 6000) { q.toastAt = now; if (this.hud) this.hud.showToast(`${q.g.name}: this will not go in -- ${this.why(veh)}`, 3000); }
      }
      // the door follows
      if (q.doorMesh) {
        const k = q.k + clamp(want - q.k, -dt / 0.9, dt / 0.9);
        if (k !== q.k) this.setDoor(q, k);
      }
      // saving
      if (q.seq) {
        const sq = q.seq; sq.t += dt;
        sq.v.vLong = 0; sq.v.vLat = 0;
        if (sq.t > 1.0 && q.k > 0.9) this.finish(q, player);
        continue;
      }
      if (!veh || !this.fits(veh) || veh.garage) { q.dwell = 0; continue; }
      const inside = Math.abs(lc.lx) < IW / 2 - 0.3 && lc.lz > 1.2 && lc.lz < ID - 0.8;
      if (inside && Math.abs(veh.vLong) < 1.0) {
        if ((q.dwell += dt) > DWELL) {
          if (this.count(q) >= NSLOT) {
            if (performance.now() - q.toastAt > 6000) { q.toastAt = performance.now(); if (this.hud) this.hud.showToast(`${q.g.name} is full (${NSLOT}/${NSLOT}) -- take a car out first`, 3200); }
          } else { q.seq = { v: veh, t: 0 }; }
        }
      } else q.dwell = 0;
    }
  }

  /** The door is down: keep the car, put the player out on the street. */
  finish(q, player) {
    const v = q.seq.v;
    q.seq = null;
    q.dwell = 0;
    const lc = this.local(q, v.x, v.z);
    // the free stall nearest where it stopped
    let best = -1, bd = 1e9;
    for (let j = 0; j < NSLOT; j++) {
      if (this.data[q.g.id][j]) continue;
      const dd = Math.abs((j - (NSLOT - 1) / 2) * STALL - lc.lx);
      if (dd < bd) { bd = dd; best = j; }
    }
    if (best < 0 || player.vehicle !== v) return;
    const rec = this.snapshot(v);
    player.exitVehicle(true);
    // onto the street, a few metres out from the door
    const s = q.s;
    const ox = s.ox - s.nx * 3.0, oz = s.oz - s.nz * 3.0;
    player.x = ox; player.z = oz; player.y = this.city.groundAt(ox, oz, null) + 0.05;
    player.heading = Math.atan2(s.nx, s.nz);
    this.traffic.remove(v);
    this.data[q.g.id][best] = rec;
    this.dropCar(q, best);
    this.spawnStored(q, best);
    this.save();
    q.shut = 2.4;
    if (this.audio && this.audio.ready) this.audio.play('cash', { gain: 0.7, jitter: false });
    if (this.hud) this.hud.showToast(`${nameOf(rec.t)} saved in ${q.g.name.toLowerCase()} (${this.count(q)}/${NSLOT})`, 3400);
  }

  // --- harness ------------------------------------------------------------------------

  /** Put a record straight into a garage (tests, and the next boot reads it back). */
  store(i, rec, j = null) {
    const q = this.sites[i];
    const k = j != null ? j : this.data[q.g.id].findIndex((r) => !r);
    if (k < 0) return -1;
    this.data[q.g.id][k] = rec; this.save();
    return k;
  }
}
