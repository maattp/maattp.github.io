// Auto KW: THE BODY SHOPS -- GTA's Pay 'n' Spray, in Waterloo Region.
//
// Four real auto-body and car-care shops (OSM shop=car_repair / amenity=car_wash:
// Kitchener Autobody, Fix Auto, Northdale Auto Body in Waterloo, A1 Car Cleaning
// in Preston) each get a drive-in spray bay on their frontage: three walls, a
// roof, a sign with the shop's own name, and a roller door. Drive in, and the
// door rolls down behind you; the screen goes dark on the sound of a can
// shaking and three long pulls of the nozzle; you come out facing the street in
// a new colour with every dent knocked out.
//
//   - THE PRICE comes off the wallet (game.money): $80 and what the damage is
//     worth ($100 for a wreck, $8 a dent), $40 more if you have the law on you.
//     THE FIRST ONE IS FREE (`autokw-respray`). Not enough cash: the door stays
//     up and the shop tells you the price.
//   - THE LAW, GTA's rule: if no unit saw you turn in (police.seen when the
//     door closes), your wanted level is gone when it opens. If one did, the
//     stars stay and the units know where you went.
//   - ANY ROAD CAR: only THIS car's paint material changes (Vehicle.respray;
//     every Vehicle owns its bodyMat), so parked and traffic cars are never
//     touched. A livery finish (police two-tone, taxi, the Hellcat's wrap) keeps
//     its look -- it is still repaired and still clears the stars. Anything too
//     big for the bay (a bus, a semi, a rig) finds the roller door shut.
//   - THE WORLD IS HELD for the sequence (game.hold('respray'), reapHolds):
//     the cops cannot arrest you and the traffic cannot ram the shop's door
//     while it plays.
//
// Phone cost: nothing drawn until you are within 650 m of a shop; then one
// merged vertex-coloured mesh, the door and the sign per shop (3 draws, shown
// within 450 m), plus a beam (a 4th) only while you are wanted. All shared
// geometry and materials but the body. No lights.
//
// Harness: __dbg.respray (`sites`, `price(v)`, `trigger(i)`, `seq`, `stats`),
// the probe is tools/kw/medprobe.mjs.

import * as THREE from './three.js';
import * as G from './geo.js';
import { Builder } from './build.js';
import { randomCarColor } from './vehicles.js';
import { clamp, formatMoney } from './util.js';

const KEY = 'autokw-respray';
const ON_PHONE = typeof navigator !== 'undefined' && /iPhone|iPad|iPod|Android/i.test(navigator.userAgent || '');

// the bay, metres: inner width, inner depth, wall, door height
const IW = 5.0, ID = 9.4, WT = 0.4, DH = 3.7, WALL_H = 4.5;
const MOUTH_OFF = 2.6;     // from the street's centreline to the mouth, beyond its half width
const ENTER_LO = 4.9, ENTER_HI = 8.5;   // the car's centre this deep in the bay: it is in
const SHOW_R = 450, BUILD_R = 650;

// Real shops (OSM names and points, tools/data/kw/raw_pois.json), each with its colours.
export const SHOPS = [
  { name: 'Kitchener Autobody', sub: 'COLLISION  ·  RESPRAY', x: 1042.2, z: 1466.5, wall: 0x35507c, trim: 0xe8c21a, ink: '#13233f', bg: '#f1c40f' },
  { name: 'Fix Auto', sub: 'COLLISION REPAIR  ·  RESPRAY', x: 384.5, z: 3181.2, wall: 0x8c1d1d, trim: 0xf2f2f0, ink: '#ffffff', bg: '#b3121b' },
  { name: 'Northdale Auto Body', sub: 'WATERLOO  ·  PAINT & BODY', x: -5077.1, z: -3453.3, wall: 0x2f6b4f, trim: 0xd9d9d2, ink: '#ffffff', bg: '#1f5a3f' },
  { name: 'A1 Car Cleaning', sub: 'DETAIL  ·  RESPRAY', x: 12035.8, z: 5138.6, wall: 0x6a4aa8, trim: 0xf0e9ff, ink: '#ffffff', bg: '#5b3d99' },
];

function read() { try { return JSON.parse(localStorage.getItem(KEY) || '{}') || {}; } catch (e) { return {}; } }

/**
 * Where each bay stands: on the frontage nearest its shop, mouth to a street,
 * off the carriageway, out of every building, dry, clear of ramps / tracks /
 * landmarks and level to within a third of a metre; with the approach from the
 * kerb to the mouth clear of buildings and fences. Pushes its clear circles so
 * no tree or kerbside car is scattered into it. Called at boot, before any
 * chunk is scattered (main.js, beside the fire stations).
 */
export function placeBays(city, world, waterAt, shops = SHOPS) {
  const out = [];
  const wet = (x, z) => {
    if (G.isWater(x, z)) return true;
    if (!waterAt) return false;
    const w = waterAt(x, z);
    return w !== null && w > G.terrainHeight(x, z) + 0.05;
  };
  for (const sh of shops) {
    const bl = city.buildingsNear(sh.x, sh.z, 170);
    const inB = (x, z, pad) => {
      for (const b of bl) {
        const c = Math.cos(-b.rot), s = Math.sin(-b.rot), dx = x - b.x, dz = z - b.z;
        if (Math.abs(dx * c - dz * s) < b.w / 2 + pad && Math.abs(dx * s + dz * c) < b.d / 2 + pad) return true;
      }
      return false;
    };
    const eds = city.edgesNear(sh.x, sh.z, 120).map((ei) => {
      const e = city.edges[ei];
      if (e.elev || e.tunnel || e.noTraffic || e.cls === 'hwy' || e.cls === 'ramp') return null;
      const a = city.nodes[e.a], b = city.nodes[e.b];
      const t = clamp((sh.x - a.x) * e.dx + (sh.z - a.z) * e.dz, 0, e.len);
      const px = a.x + e.dx * t, pz = a.z + e.dz * t;
      return { e, a, t, d: Math.hypot(sh.x - px, sh.z - pz) };
    }).filter(Boolean).sort((p, q) => p.d - q.d).slice(0, 5);
    let best = null;
    for (const tol of [0.35, 0.8]) {
      for (const c of eds) {
        const e = c.e;
        for (let along = -60; along <= 60; along += 4) {
          const t = c.t + along;
          if (t < 6 || t > e.len - 6) continue;
          const qx = c.a.x + e.dx * t, qz = c.a.z + e.dz * t;
          for (const side of [1, -1]) {
            const nx = -e.dz * side, nz = e.dx * side;   // from the street toward the bay
            const ox = qx + nx * (e.hw + MOUTH_OFF), oz = qz + nz * (e.hw + MOUTH_OFF);
            const rot = Math.atan2(-nx, nz);
            const cr = Math.cos(rot), sr = Math.sin(rot);
            const P = (lx, lz) => [ox + lx * cr - lz * sr, oz + lx * sr + lz * cr];
            const score0 = Math.hypot(ox - sh.x, oz - sh.z);
            if (best && score0 + 6 >= best.score) continue;
            let ok = true, lo = Infinity, hi = -Infinity;
            // the bay itself, walls and all
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
            if (!ok || hi - lo > tol) continue;
            // the approach: from the mouth out to the kerb, a car wide, no buildings, fences or water
            for (let lz = -MOUTH_OFF; lz < -0.4 && ok; lz += 1.0) {
              for (const lx of [-2.6, -1.3, 0, 1.3, 2.6]) {
                const [px, pz] = P(lx, lz);
                if (inB(px, pz, 0.6) || wet(px, pz)) { ok = false; break; }
                if (city.barrierHit && city.barrierHit(px, pz, 0.7, G.terrainHeight(px, pz) + 1)) { ok = false; break; }
                if (city.landmarkHit && city.landmarkHit(px, pz, 0.7, G.terrainHeight(px, pz) + 1, true)) { ok = false; break; }
              }
            }
            if (!ok) continue;
            const score = score0 + (hi - lo) * 20 + (side < 0 ? 0.5 : 0);
            if (!best || score < best.score) best = { score, ox, oz, nx, nz, rot, y: lo + 0.02, e, qx, qz, slope: hi - lo };
          }
        }
      }
      if (best) break;
    }
    if (!best) { out.push({ shop: sh, site: null }); continue; }
    const cx = best.ox + best.nx * (ID / 2), cz = best.oz + best.nz * (ID / 2);
    if (!city.clearCircles) city.clearCircles = [];
    city.clearCircles.push([cx, cz, ID / 2 + 3.2], [best.ox - best.nx * 3, best.oz - best.nz * 3, 5]);
    out.push({ shop: sh, site: best });
  }
  return out;
}

function signTexture(sh) {
  const c = document.createElement('canvas');
  c.width = 1024; c.height = 192;
  const g = c.getContext('2d');
  g.fillStyle = sh.bg; g.fillRect(0, 0, 1024, 192);
  g.fillStyle = sh.ink;
  g.textAlign = 'center'; g.textBaseline = 'middle';
  let f = 92;
  g.font = `800 ${f}px system-ui, sans-serif`;
  while (g.measureText(sh.name.toUpperCase()).width > 900 && f > 40) { f -= 4; g.font = `800 ${f}px system-ui, sans-serif`; }
  g.fillText(sh.name.toUpperCase(), 512, 74);
  g.font = '700 44px system-ui, sans-serif';
  g.globalAlpha = 0.85;
  g.fillText(sh.sub, 512, 150);
  g.globalAlpha = 1;
  g.strokeStyle = sh.ink; g.lineWidth = 8; g.strokeRect(8, 8, 1008, 176);
  const t = new THREE.CanvasTexture(c);
  t.anisotropy = 4;
  return t;
}

function doorTexture() {
  const c = document.createElement('canvas');
  c.width = 64; c.height = 256;
  const g = c.getContext('2d');
  g.fillStyle = '#c9ccd0'; g.fillRect(0, 0, 64, 256);
  for (let y = 0; y < 256; y += 16) {
    g.fillStyle = '#8f949a'; g.fillRect(0, y, 64, 3);
    g.fillStyle = '#e3e5e8'; g.fillRect(0, y + 3, 64, 2);
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

const lin = (hex) => { const c = new THREE.Color(hex); return [c.r, c.g, c.b]; };

export class Respray {
  /** o: { scene, city, game, hud, audio, police, bays: placeBays(...), onRepair } */
  constructor(o) {
    this.o = o;
    this.scene = o.scene; this.city = o.city; this.game = o.game; this.hud = o.hud; this.audio = o.audio; this.police = o.police;
    this.stats = Object.assign({ n: 0 }, read());
    this.seq = null;
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
      // the roller door, a wall while it is down (y1 under y0 turns a solid off: landmarkHit)
      const door = wall(0, 0.2, IW / 2 + WT, 0.25);
      door.y1 = y0 - 50;
      this.sites.push({
        shop: b.shop, s, door, k: 0, kT: 0, built: false, grp: null, doorMesh: null, beam: null,
        lock: false, hinted: false, poor: false, cx: 0, cz: 0, closing: false,
        mx: s.ox + s.nx * 5.5, mz: s.oz + s.nz * 5.5,   // the middle of the bay, for distances
      });
    }
    if (solids.length && this.city.addLandmarkSolids) this.city.addLandmarkSolids(solids);
    this.beamGeo = new THREE.CylinderGeometry(2.6, 2.6, 46, 16, 1, true).translate(0, 23, 0);
    this.beamMat = new THREE.MeshBasicMaterial({ color: 0xa855ff, transparent: true, opacity: 0.22, side: THREE.DoubleSide, forceSinglePass: true, depthWrite: false });
    this.bodyMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, metalness: 0.02 });
    this.doorMat = new THREE.MeshStandardMaterial({ map: doorTexture(), roughness: 0.55, metalness: 0.5, side: THREE.DoubleSide });
    this.doorGeo = new THREE.PlaneGeometry(IW, DH).translate(0, -DH / 2, 0);
    this.signGeo = new THREE.PlaneGeometry(IW + 2 * WT, (IW + 2 * WT) * 0.1875);
    this.over = null;   // the dark screen, made on first use
  }

  get active() { return !!this.seq; }

  places() {
    return this.sites.map((q) => ({
      x: q.s.ox + q.s.nx * 5, z: q.s.oz + q.s.nz * 5, kind: 'paint', label: true, name: `${q.shop.name} (respray)`, near: false,
      hello: () => this.hello(q),
    }));
  }

  hello(q) {
    const n = this.stats.n;
    return `${q.shop.name} — drive into the spray bay for a respray: new colour, dents knocked out, and the cops lose you if they have not seen you go in. ${n ? '$80 and up' : 'Your first one is free'}`;
  }

  /** Is this a vehicle the bay takes? A road car or a bike that fits. */
  fits(v) {
    if (!v || v.dead) return false;
    const s = v.spec;
    return !!((s.roadCar || s.moto) && !s.rail && !s.bus && !s.towed && !v.trailer && !v.leader && s.len <= 6.45 && s.wid <= 2.4 && !s.plane && !s.boat);
  }

  price(v) {
    if (!this.stats.n) return 0;
    const hp = v.spec.hp || 100;
    const dmg = 1 - clamp(v.health / hp, 0, 1);
    const p = 80 + Math.round(dmg * 100) + (v.dents || 0) * 8 + (this.game.wanted > 0 ? 40 : 0);
    return Math.round(p / 5) * 5;
  }

  // --- the building, made when you come near ----------------------------------

  build(q) {
    q.built = true;
    const s = q.s, sh = q.shop;
    const cr = Math.cos(s.rot), sr = Math.sin(s.rot);
    const B = new Builder(false);
    const wallC = lin(sh.wall), trimC = lin(sh.trim), conc = [0.30, 0.30, 0.31], inner = [0.62, 0.62, 0.60], roofC = [0.10, 0.10, 0.11];
    const bx = (lx, lz, w, d, y0, h, col) => {
      const x = s.ox + lx * cr - lz * sr, z = s.oz + lx * sr + lz * cr;
      B.box(x, s.y + y0, z, w, h, d, s.rot, col);
    };
    // the floor (the ground can stand a little proud of it), pale; the painted apron before the door
    bx(0, ID / 2, IW + 0.1, ID, -0.02, 0.06, conc);
    bx(0, -1.2, IW + 1.6, 2.4, -0.02, 0.05, conc);
    // the walls: grey inside, the shop's colour outside (one box each; the inside face is the same colour, lightened by the roof's shade)
    bx(-(IW / 2 + WT / 2), ID / 2, WT, ID + 2 * WT, 0, WALL_H, wallC);
    bx(IW / 2 + WT / 2, ID / 2, WT, ID + 2 * WT, 0, WALL_H, wallC);
    bx(0, ID + WT / 2, IW + 2 * WT, WT, 0, WALL_H, wallC);
    // a pale lining on the inside of the three walls
    bx(-(IW / 2 - 0.03), ID / 2, 0.06, ID, 0.05, WALL_H - 0.6, inner);
    bx(IW / 2 - 0.03, ID / 2, 0.06, ID, 0.05, WALL_H - 0.6, inner);
    bx(0, ID - 0.03, IW, 0.06, 0.05, WALL_H - 0.6, inner);
    // the header over the mouth and the sign band over that
    bx(0, 0.2, IW + 2 * WT, 0.5, DH, WALL_H - DH, wallC);
    bx(0, -0.05, IW + 2 * WT + 0.3, 0.3, WALL_H, 1.15, trimC);
    // the roof, with a lip
    bx(0, (ID + WT) / 2 - 0.1, IW + 2 * WT + 0.4, ID + WT + 0.8, WALL_H + 1.15, 0.28, roofC);
    // two bollards at the door's feet, in the shop's trim colour, and a yellow kerb stripe
    for (const sx of [-1, 1]) {
      bx(sx * (IW / 2 + WT + 0.25), -0.7, 0.3, 0.3, 0, 0.9, trimC);
    }
    const geo = B.build();
    const body = new THREE.Mesh(geo, this.bodyMat);
    body.castShadow = !ON_PHONE;
    body.receiveShadow = false;
    body.frustumCulled = true;
    const grp = new THREE.Group();
    grp.add(body);
    // the sign, on the band, facing the street
    const tex = signTexture(sh);
    const sign = new THREE.Mesh(this.signGeo, new THREE.MeshBasicMaterial({ map: tex, toneMapped: false }));
    const sw = IW + 2 * WT, sy = s.y + WALL_H + 0.1 + sw * 0.1875 / 2 + 0.05;
    sign.position.set(s.ox + 0.26 * sr, sy, s.oz - 0.26 * cr);
    sign.rotation.y = Math.PI - s.rot;   // facing -f (the street)
    // (the plane faces +z; turned by pi - rot it faces (-sin(pi-rot), -cos... see rotation note in the probe: checked by eye)
    grp.add(sign);
    // the roller door: hung from its top, scaled down to open
    const door = new THREE.Mesh(this.doorGeo, this.doorMat);
    door.position.set(s.ox + 0.2 * -sr, s.y + DH, s.oz + 0.2 * cr);
    door.rotation.y = -s.rot;
    door.scale.y = 0.001;
    door.visible = false;
    grp.add(door);
    q.doorMesh = door;
    // the beam, while you are wanted
    const beam = new THREE.Mesh(this.beamGeo, this.beamMat);
    beam.position.set(s.ox + s.nx * 5, s.y, s.oz + s.nz * 5);
    beam.visible = false;
    beam.frustumCulled = false;
    grp.add(beam);
    q.beam = beam;
    grp.visible = false;
    q.grp = grp;
    this.scene.add(grp);
  }

  warmMeshes() {
    // the beam's material for the warm-up frame: no building is made before you are near one
    const m = new THREE.Mesh(this.beamGeo, this.beamMat);
    m.frustumCulled = false;
    return [m];
  }

  // --- the frame ----------------------------------------------------------------

  /** The local frame of a bay: depth lz from the mouth (+ into the bay), lateral lx. */
  local(q, x, z) {
    const s = q.s, dx = x - s.ox, dz = z - s.oz;
    const cr = Math.cos(s.rot), sr = Math.sin(s.rot);
    return { lx: dx * cr + dz * sr, lz: -dx * sr + dz * cr };
  }

  /** Every frame the world runs: show what is near, hang the doors, see you in. */
  tick(dt, player) {
    if (this.seq) return;
    const p = player.position, v = player.vehicle && !player.onFoot ? player.vehicle : null;
    const wanted = this.game.wanted > 0;
    for (const q of this.sites) {
      const d = Math.hypot(q.mx - p.x, q.mz - p.z);
      if (!q.built && d < BUILD_R) { try { this.build(q); } catch (e) { q.built = true; console.warn('respray build: ' + e.message); } }
      if (!q.grp) continue;
      q.grp.visible = d < SHOW_R;
      if (q.beam) q.beam.visible = wanted && d < 900 && d > 25;
      if (!q.grp.visible && !q.beam.visible) continue;
      if (q.beam.visible && !q.grp.visible) q.grp.visible = true;
      // the door: down for a vehicle the bay cannot take, outside it and near
      let want = 0;
      const lc = v ? this.local(q, v.x, v.z) : null;
      if (v && !this.fits(v) && d < 26 && lc.lz < -2.2) want = 1;
      this.hangDoor(q, want, dt);
      if (!v || !this.fits(v) || q.lock) {
        if (q.lock && d > 16) q.lock = false;
        continue;
      }
      if (d > 22) { q.hinted = false; q.poor = false; }
      const inside = Math.abs(lc.lx) < 1.5 && lc.lz > ENTER_LO && lc.lz < ENTER_HI;
      if (!inside) { q.poor = false; continue; }
      const price = this.price(v);
      if (price > this.game.money) {
        if (!q.poor) { q.poor = true; this.hud.showToast(`${q.shop.name}: a respray is ${formatMoney(price)} — you have ${formatMoney(this.game.money)}`, 3200); }
        continue;
      }
      this.start(q, v, price);
      return;
    }
  }

  hangDoor(q, want, dt) {
    if (!q.doorMesh) return;
    const k = q.k + clamp(want - q.k, -dt / 0.9, dt / 0.9);
    if (k === q.k) return;
    this.setDoor(q, k);
  }

  setDoor(q, k) {
    q.k = k;
    q.doorMesh.visible = k > 0.01;
    q.doorMesh.scale.y = Math.max(0.001, k);
    // a solid when it is more than half down (y1 above y0 turns the solid on)
    q.door.y1 = k > 0.5 ? q.s.y + DH : q.s.y - 50;
  }

  /** Drive in: the door comes down behind you. */
  start(q, v, price) {
    const game = this.game;
    this.game.hold('respray');
    const old = v.color;
    let hex = old;
    const takes = !(v.spec.finish || v.spec.liveries);
    if (takes) for (let i = 0; i < 8 && hex === old; i++) hex = randomCarColor((Math.random() * 1e6) | 0);
    this.seq = {
      q, v, t: 0, price, hex, old, takes, applied: false, seen: !!(this.police && this.police.seen), wanted0: game.wanted,
      sounds: 0, free: price === 0, result: '', swatch: 0,
    };
    if (!this.over) this.makeOver();
    this.over.style.display = 'flex';
    this.over.style.opacity = '0';
    this.setText('', '');
    if (this.audio && this.audio.ready) this.audio.play('shutter', { gain: 0.6, send: 0.1 });
    if (!q.built) this.build(q);
    q.grp.visible = true;
  }

  makeOver() {
    const d = document.createElement('div');
    d.style.cssText = 'position:absolute;inset:0;z-index:45;display:none;flex-direction:column;align-items:center;justify-content:center;background:#050507;color:#fff;pointer-events:none;opacity:0;font-family:system-ui,sans-serif;text-align:center';
    d.innerHTML = '<div class="rsT" style="font-size:min(9vw,56px);font-weight:900;letter-spacing:.12em"></div>'
      + '<div class="rsS" style="margin-top:14px;font-size:min(3.6vw,20px);opacity:.85;max-width:80vw"></div>'
      + '<div class="rsB" style="margin-top:22px;width:min(60vw,360px);height:18px;border-radius:9px;border:2px solid #fff3;"></div>';
    document.getElementById('app').appendChild(d);
    this.over = d;
    this.elT = d.querySelector('.rsT'); this.elS = d.querySelector('.rsS'); this.elB = d.querySelector('.rsB');
  }

  setText(t, s) { if (this.elT) { this.elT.textContent = t; this.elS.textContent = s; } }

  /** The sequence, run while the world is held (main.js, before the pause check). */
  update(dt) {
    const S = this.seq;
    if (!S) return;
    const q = S.q, v = S.v;
    if (this.game.dead || !v || v.dead) { this.finish(true); return; }
    S.t += dt;
    const t = S.t;
    // the door comes down, then up
    if (t < 0.9) this.setDoor(q, t / 0.9);
    else if (t > 4.0) this.setDoor(q, clamp(1 - (t - 4.0) / 0.9, 0, 1));
    else if (q.k !== 1) this.setDoor(q, 1);
    // the screen
    let o = 0;
    if (t > 0.9 && t < 1.5) o = (t - 0.9) / 0.6;
    else if (t >= 1.5 && t < 3.6) o = 1;
    else if (t >= 3.6 && t < 4.2) o = 1 - (t - 3.6) / 0.6;
    this.over.style.opacity = String(o);
    if (t > 1.0 && S.sounds === 0) {
      S.sounds = 1;
      if (this.audio && this.audio.ready) this.audio.play('spray', { gain: 0.7, send: 0.12 });
      this.setText('RESPRAY', q.shop.name);
    }
    // swatches flicker through colours, then settle on the new one
    if (t > 1.5 && t < 4.2) {
      const colour = t > 3.0 && S.takes ? S.hex : (Math.floor(t * 9) % 2 ? randomCarColor((Math.floor(t * 9) * 977) | 0) : randomCarColor((Math.floor(t * 9) * 31 + 7) | 0));
      const c = '#' + (S.takes || t <= 3.0 ? colour : S.old).toString(16).padStart(6, '0');
      this.elB.style.background = c;
    }
    if (t >= 3.0 && !S.applied) this.apply(S);
    if (t >= 4.9) this.finish(false);
  }

  /** Behind the door: the paint, the dents, the money, the law -- and the car turned round to face the street. */
  apply(S) {
    S.applied = true;
    const { q, v } = S;
    const s = q.s, game = this.game;
    const dents = v.dents || 0, hp0 = v.health;
    const took = S.takes ? v.respray(S.hex) : false;
    v.repair();
    if (this.o.onRepair) this.o.onRepair(v);
    if (S.price > 0) game.money = Math.max(0, game.money - S.price);
    this.stats.n++;
    try { localStorage.setItem(KEY, JSON.stringify(this.stats)); } catch (e) { /* private mode */ }
    // out the way it came in: parked a few metres inside, nose to the street
    const lz = 3.4, cr = Math.cos(s.rot), sr = Math.sin(s.rot);
    const x = s.ox - lz * -sr, z = s.oz + lz * cr;
    v.place(x, z, Math.atan2(-s.nx, -s.nz));
    v.vLong = 0; v.spin = 0; v.slide = 0; v.vy = 0;
    // the law
    let law = '';
    if (game.wanted > 0) {
      if (!S.seen) {
        game.wanted = 0; game.points = 0; game.cool = 0;
        if (this.police) this.police.clear();
        law = 'Nobody saw you come in — the wanted level is gone';
      } else {
        if (this.police) this.police.spotted(s.ox, s.oz);
        law = 'A cop saw you turn in — the stars stay';
      }
    }
    S.result = `${took ? 'New colour. ' : S.takes ? '' : 'Livery kept. '}${dents || hp0 < (v.spec.hp || 100) ? 'Dents out. ' : ''}${S.price ? `${formatMoney(S.price)} charged.` : 'First one is on the house.'}`;
    S.law = law;
    this.setText('DONE', `${S.result}${law ? ' ' + law : ''}`);
    this.last = { colour: S.hex, took, price: S.price, law, wantedAfter: game.wanted, seen: S.seen, hp0, dents };
  }

  finish(abort) {
    const S = this.seq;
    this.seq = null;
    this.game.release('respray');
    if (this.over) { this.over.style.opacity = '0'; this.over.style.display = 'none'; }
    if (!S) return;
    this.setDoor(S.q, 0);
    S.q.lock = true;
    if (!abort && S.applied) {
      this.hud.showToast(`${S.q.shop.name}: ${S.result}${S.law ? ' ' + S.law : ''}`, 4200);
      if (S.price && this.audio && this.audio.ready) this.audio.cash();
    }
  }
}
