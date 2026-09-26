// THE FLYING FISH at Pike Place Market.
//
// A fish stall under the Main Arcade's green canopy, at the corner under the
// PUBLIC MARKET sign where the real one is: an ice bed of salmon, halibut and
// Dungeness crab sloping toward the street, a wrapping counter against the
// arcade, and three fishmongers in orange rubber bibs working the front. Walk
// up and press ENTER to take the counter: a monger picks a fish off the ice,
// calls the order -- "ONE KING SALMON, FLYING TO MINNESOTA!" -- the crew
// shouts the destination back, and the fish comes over the ice at you.
//
// Slide along the counter (the stick, A/D, arrows) to get under it and press
// CATCH (Space, J) as it arrives. Close too early and it slaps off your hands;
// not at all and it is on the floor. Three on the floor and the boss sends you
// home; otherwise a minute of it, faster as it goes, two fish in the air from
// the second half. A catch within a tenth of a second of arrival is PERFECT
// (half again); every five in a row adds to the multiplier, to 4x. The flight
// is real ballistics from the monger's hand to a spot on the counter line, so
// what you see is what you have to catch.
//
// Also drawn here, because nothing else drew it: the arcade's frontage floor.
// citygen reports a pavement along the arcade (roadLift, 52 cm) that the chunk
// mesher never lays, so a walker stood half a metre over bare terrain; the
// floor is laid at exactly the height groundAt answers.

import * as THREE from './three.js';
import { Builder } from './build.js';
import { clamp } from './util.js';
import { makeHumanoid, animateWalk, BONES } from './peds.js';
import { MARKET_FRAME } from './landmarks.js';

const [AX, AZ] = MARKET_FRAME.at, [UX, UZ] = MARKET_FRAME.u, [WX, WZ] = MARKET_FRAME.w;
const IN = MARKET_FRAME.inset;
/** Market frame (s up Pike Place, o off its centreline toward the arcade) -> world. */
const SO = (s, o) => [AX + UX * s + WX * o, AZ + UZ * s + WZ * o];
const H_WALL = Math.atan2(WX, WZ);            // facing the arcade
const H_STREET = Math.atan2(-WX, -WZ);        // facing the street

// The stall, in the market frame: the ice from o 4.55 to 5.3, the catcher's
// lane at 5.78, the counter from 6.08 to the wall; s 5..10.5, between two of
// the canopy's columns (every 6.5 m from s -2), which otherwise stand in the
// view down the counter.
const S0 = 5.0, S1 = 10.5, O_ICE0 = 4.55, O_ICE1 = 5.3, O_LANE = 5.78, O_CTR = 6.08;
const MONGERS = [{ s: 5.9, name: 'RAY' }, { s: 7.75, name: 'LOU' }, { s: 9.6, name: 'MOE' }];
const O_MONGER = 3.95;
const ROUND_S = 60, DROPS = 3, CATCH_SPEED = 4.0;
const UV0 = [0, 0, 0, 0, 0, 0, 0, 0];

// what comes over the ice
const KINDS = {
  king: { name: 'KING SALMON', pts: 100, len: 0.95, w: 1 },
  coho: { name: 'COHO', pts: 80, len: 0.72, w: 1 },
  sockeye: { name: 'SOCKEYE', pts: 80, len: 0.66, w: 1 },
  halibut: { name: 'HALIBUT', pts: 150, len: 0.85, w: 0.4, heavy: true },
  crab: { name: 'DUNGENESS CRAB', pts: 120, len: 0.26, w: 0.6, spin: true },
  monk: { name: 'MONKFISH', pts: 250, len: 0.7, w: 0.12, heavy: true },
};
const DEST = ['MINNESOTA', 'OHIO', 'TEXAS', 'TOKYO', 'SPOKANE', 'ALASKA', 'MONTANA', 'KANSAS CITY', 'PORTLAND', 'NEW JERSEY',
  'IDAHO', 'CHICAGO', 'BOISE', 'MAINE', 'NEBRASKA', 'VANCOUVER', 'FLORIDA', 'BROOKLYN', 'DENVER', 'GEORGIA'];
const WHO = ['ONE', 'TWO', 'ONE', 'ONE', 'THREE'];

// --- fish meshes ----------------------------------------------------------------

/** A fish's geometry along local +z (nose at +len/2), vertex-coloured. */
function fishGeometry(kind) {
  const b = new Builder(false);
  const k = KINDS[kind], L = k.len;
  if (kind === 'crab') {
    const shell = [0.55, 0.22, 0.12], under = [0.85, 0.72, 0.52], leg = [0.62, 0.3, 0.16];
    b.spheroid(0, 0, 0, 0.11, 12, 6, shell, 0.42);
    b.spheroid(0, -0.012, 0, 0.1, 10, 4, under, 0.3);
    for (const s of [-1, 1]) {
      for (let i = 0; i < 4; i++) {
        const z = -0.06 + i * 0.04, x0 = s * 0.09, x1 = s * (0.2 + (i === 1 ? 0.03 : 0));
        b.tube([x0, 0, z], [x1, -0.03, z + 0.02 * (i - 1.5)], 0.012, 5, leg);
      }
      b.tube([s * 0.07, 0, 0.08], [s * 0.13, 0.01, 0.17], 0.02, 6, shell);          // claws
      b.spheroid(s * 0.14, 0.01, 0.19, 0.035, 8, 4, shell, 0.7);
    }
    return b.build();
  }
  // a body of rings along z: elliptical sections, a darker back over a pale belly
  const cols = {
    king: [[0.22, 0.28, 0.3], [0.82, 0.84, 0.84]],
    coho: [[0.3, 0.38, 0.44], [0.86, 0.88, 0.88]],
    sockeye: [[0.66, 0.12, 0.1], [0.78, 0.2, 0.16]],
    halibut: [[0.34, 0.3, 0.24], [0.92, 0.92, 0.9]],
    monk: [[0.4, 0.31, 0.22], [0.62, 0.55, 0.45]],
  }[kind];
  const flat = kind === 'halibut', monk = kind === 'monk';
  const N = 12, R = 9;
  const prof = (u) => {        // u 0 at the tail to 1 at the nose: half-height
    if (monk) return 0.03 + 0.09 * Math.pow(u, 1.3);
    return Math.max(0.012, Math.sin(Math.PI * Math.pow(u, 0.72)) * (flat ? 0.05 : 0.12)) * (L / 0.9);
  };
  const widthK = flat ? 5.2 : monk ? 2.6 : 0.55;
  const rings = [];
  for (let i = 0; i <= R; i++) {
    const u = i / R, z = -L / 2 + u * L * 0.86, hh = prof(0.06 + u * 0.94);
    const pts = [];
    for (let j = 0; j < N; j++) {
      const a = (j / N) * Math.PI * 2;
      pts.push([Math.cos(a) * hh * widthK, Math.sin(a) * hh]);
    }
    rings.push({ z, pts });
  }
  // loft takes one colour; lay the belly by a second, slightly smaller lower loft
  b.loft(rings, cols[0], { capStart: true, capEnd: true });
  const belly = rings.map((r) => ({ z: r.z, pts: r.pts.map(([x, y]) => [x * 1.02, Math.min(y, -Math.abs(y) * 0.2) * 1.02]) }));
  b.loft(belly, cols[1], { capStart: true, capEnd: true });
  // nose, tail fin, dorsal
  const zt = -L / 2, tw = flat ? 0.2 : 0.16 * (L / 0.9);
  b.tri([0, 0, zt + 0.02], [0, tw, zt - tw * 0.9], [0, -tw, zt - tw * 0.9], [1, 0, 0], cols[0]);
  b.tri([0, 0, zt + 0.02], [0, -tw, zt - tw * 0.9], [0, tw, zt - tw * 0.9], [-1, 0, 0], cols[0]);
  if (!flat) {
    const h = prof(0.6);
    b.tri([0, h * 0.9, 0.05], [0, h * 1.6, -0.02 * L], [0, h * 0.9, -0.14 * L], [1, 0, 0], cols[0]);
    b.tri([0, h * 0.9, 0.05], [0, h * 0.9, -0.14 * L], [0, h * 1.6, -0.02 * L], [-1, 0, 0], cols[0]);
  }
  if (monk) {
    // the mouth: a dark gape across the front, and teeth
    b.box(0, -0.035, L * 0.34, 0.36, 0.035, 0.03, 0, [0.12, 0.08, 0.07]);
  }
  // an eye each side
  const ey = prof(0.9) * 0.35, ez = L * 0.3, ex = prof(0.9) * widthK * 0.72;
  for (const s of [-1, 1]) b.spheroid(s * ex, ey, ez, flat ? 0.012 : 0.016, 6, 4, [0.04, 0.04, 0.05]);
  return b.build();
}

// --- the stall ------------------------------------------------------------------

export class FishToss {
  /** opts: { scene, city, world, audio, camera, player, controls, onReward, onEnd } */
  constructor(opts) {
    this.o = opts;
    this.state = 'off';          // off | play | over
    this.best = 0;
    try { this.best = +localStorage.getItem('auto-fishtoss-best') || 0; } catch (e) { /* private */ }
    this.geos = {};
    for (const k of Object.keys(KINDS)) this.geos[k] = fishGeometry(k);
    this.floorY = (s, o) => {
      const [x, z] = SO(s, o);
      return opts.city.groundAt(x, z, null);
    };
    this._buildFloor();
    this._buildStall();
    { const [x, z] = SO((S0 + S1) / 2, 3.2); this.spot = { x, z }; }   // in front of the ice
    this._buildMongers();
    this._buildDom();
    this.fish = [];
    this.pile = [];
    this._v = new THREE.Vector3();
    // where a fish is going: a ring on the floor under the counter line
    this.ringGeo = new THREE.RingGeometry(0.26, 0.33, 32);
    this.ringMat = new THREE.MeshBasicMaterial({ color: 0xffb030, transparent: true, opacity: 0.85, depthWrite: false, depthTest: false, side: THREE.DoubleSide });
    this.visible = true;
  }

  get active() { return this.state !== 'off'; }

  _buildFloor() {
    // The arcade's frontage pavement, s -4..100: from the kerb (where onRoad
    // ends) to the arcade's face, at the height the ground query reports.
    const { city, world, scene } = this.o;
    const b = new Builder(false);
    const pave = [0.56, 0.55, 0.52], kerb = [0.62, 0.61, 0.58];
    const kerbAt = (s) => {
      for (let o = 3.4; o < IN - 0.6; o += 0.1) { const [x, z] = SO(s, o); if (!city.onRoad(x, z, 0, false)) return o; }
      return IN - 0.6;
    };
    // level across, at the pavement's height just in from the kerb: past the
    // pavement's outer edge the query slopes down its 1 m verge, and a floor
    // following that humped against the hall front
    const lvl = new Map();
    const Y = (s, k) => {
      if (!lvl.has(s)) { const [x, z] = SO(s, k + 0.5); lvl.set(s, city.groundAt(x, z, null) - 0.012); }
      return lvl.get(s);
    };
    let kCur = 0;
    const F = (s, o) => { const [x, z] = SO(s, o); return [x, Y(s, kCur), z]; };
    const oW = IN - 0.07;
    const plats = [], rot = Math.atan2(WZ, WX);      // u across (o), v up the street (s)
    for (let s = -2.5; s < 100; s += 1.5) {
      const s1 = s + 1.5, k0 = kerbAt(s), k1 = kerbAt(s1);
      Y(s, k0); Y(s1, k1);
      // and what the floor stands on is what it draws: a platform per slice
      const kk = Math.max(k0, k1), [px, pz] = SO(s + 0.75, (kk + oW) / 2);
      plats.push({ x: px, z: pz, hw: (oW - kk) / 2, hd: 0.78, rot, y0: Y(s, k0) + 0.012, y1: Y(s1, k1) + 0.012 });
      for (let c = 0; c < 3; c++) {
        const a0 = k0 + (oW - k0) * c / 3, a1 = k0 + (oW - k0) * (c + 1) / 3;
        const b0 = k1 + (oW - k1) * c / 3, b1 = k1 + (oW - k1) * (c + 1) / 3;
        b.quad(F(s, a0), F(s1, b0), F(s1, b1), F(s, a1), [0, 1, 0], UV0, pave);
      }
      // the kerb face down to the carriageway
      const p0 = F(s, k0), p1 = F(s1, k1);
      const [rx0, rz0] = SO(s, k0 - 0.3), [rx1, rz1] = SO(s1, k1 - 0.3);
      const r0 = city.groundAt(rx0, rz0, p0[1]), r1 = city.groundAt(rx1, rz1, p1[1]);
      if (p0[1] - r0 > 0.03 || p1[1] - r1 > 0.03) {
        b.quad(p0, p1, [p1[0], Math.min(p1[1], r1), p1[2]], [p0[0], Math.min(p0[1], r0), p0[2]], [-WX, 0, -WZ], UV0, kerb);
      }
    }
    city.setPlatforms([...(city.platforms || []), ...plats]);
    const m = new THREE.Mesh(b.build(), world.mats.flat);
    m.receiveShadow = true;
    m.name = 'marketFloor';
    scene.add(m);
    this.floor = m;
  }

  _buildStall() {
    const { world, scene } = this.o;
    const b = new Builder(false);
    // Builder.box turns the other way from three's rotation.y: pass -heading,
    // w across the heading, d along it
    const bx = (s, o, y, w, h, d, heading, col) => { const [x, z] = SO(s, o); b.box(x, y, z, w, h, d, -heading, col); };
    const green = [0.14, 0.3, 0.22], ice = [0.86, 0.9, 0.93], steel = [0.66, 0.68, 0.7], white = [0.93, 0.93, 0.9];
    const sm = (S0 + S1) / 2, L = S1 - S0;
    const yF = this.floorY(sm, O_ICE0 + 0.3);
    this.y = yF;
    // the ice bed: a painted plank front, then a sloped bed rising to the back
    bx(sm, O_ICE0 + 0.02, yF, L, 0.74, 0.06, H_WALL, green);
    for (let s = S0; s <= S1 + 0.01; s += L / 4) bx(s, (O_ICE0 + O_ICE1) / 2, yF, 0.08, 0.76, O_ICE1 - O_ICE0, H_WALL, green);
    {
      const y0 = yF + 0.76, y1 = yF + 1.0;
      const P = (s, o, y) => { const [x, z] = SO(s, o); return [x, y, z]; };
      const nrm = [-WX * 0.24, 0.97, -WZ * 0.24];
      b.quad(P(S0, O_ICE0, y0), P(S1, O_ICE0, y0), P(S1, O_ICE1, y1), P(S0, O_ICE1, y1), nrm, UV0, ice);
      // crushed ice: lumps across the bed
      for (let i = 0; i < 90; i++) {
        const s = S0 + ((i * 0.618) % 1) * L, u = ((i * 0.377) % 1);
        const o = O_ICE0 + 0.05 + u * (O_ICE1 - O_ICE0 - 0.1), y = y0 + (y1 - y0) * u;
        const [x, z] = SO(s, o);
        b.spheroid(x, y, z, 0.03 + ((i * 0.29) % 1) * 0.025, 5, 3, [0.9, 0.94, 0.96], 0.6);
      }
      // the back board and the counter behind
      bx(sm, O_ICE1 + 0.02, yF, L, 1.08, 0.05, H_WALL, green);
      bx(sm, (O_CTR + IN - 0.08) / 2, yF, L, 0.92, IN - 0.08 - O_CTR, H_WALL, steel);
      bx(sm, (O_CTR + IN - 0.08) / 2, yF + 0.92, L + 0.04, 0.05, IN - 0.06 - O_CTR, H_WALL, white);
      // a roll of wrapping paper on the counter, and the scale
      for (const s of [S0 + 0.8, S1 - 1.2]) {
        const [x0, z0] = SO(s - 0.3, O_CTR + 0.18), [x1, z1] = SO(s + 0.3, O_CTR + 0.18);
        b.tube([x0, yF + 1.04, z0], [x1, yF + 1.04, z1], 0.07, 10, [0.9, 0.86, 0.78], true);
      }
      {
        const [x, z] = SO(sm, O_CTR + 0.2);
        b.box(x, yF + 0.97, z, 0.32, 0.12, 0.26, -H_WALL, [0.85, 0.2, 0.15]);
        b.box(x, yF + 1.09, z, 0.36, 0.02, 0.3, -H_WALL, steel);
      }
      // the fish laid out on the ice, heads down the slope toward the street
      const rows = [
        { o: O_ICE0 + 0.16, kinds: ['sockeye', 'crab', 'coho', 'crab', 'sockeye', 'crab', 'coho'] },
        { o: O_ICE0 + 0.42, kinds: ['king', 'halibut', 'king', 'coho', 'king', 'king'] },
        { o: O_ICE0 + 0.64, kinds: ['coho', 'king', 'halibut', 'king', 'sockeye', 'king', 'coho'] },
      ];
      const tmp = new THREE.Object3D();
      for (const row of rows) {
        const n = row.kinds.length;
        row.kinds.forEach((kind, i) => {
          const s = S0 + 0.35 + (i + 0.5) * (L - 0.7) / n;
          const u = (row.o - O_ICE0) / (O_ICE1 - O_ICE0);
          const [x, z] = SO(s, row.o);
          tmp.position.set(x, y0 + (y1 - y0) * u + 0.035, z);
          tmp.rotation.set(0, 0, 0);
          tmp.rotation.order = 'YXZ';
          tmp.rotation.y = H_STREET + (kind === 'crab' ? i : 0.25 * Math.sin(i * 2.3));
          tmp.rotation.x = -0.24;
          tmp.rotation.z = kind === 'halibut' || kind === 'crab' ? 0 : Math.PI / 2 * (i % 2 ? 1 : -1) * 0.92;
          tmp.updateMatrix();
          const g = this.geos[kind].clone().applyMatrix4(tmp.matrix);
          const p = g.attributes.position, nn = g.attributes.normal, cc = g.attributes.color, ix = g.index.array;
          const base = b.pos.length / 3;
          for (let q = 0; q < p.count; q++) b.vert(p.getX(q), p.getY(q), p.getZ(q), nn.getX(q), nn.getY(q), nn.getZ(q), 0, 0, cc.getX(q), cc.getY(q), cc.getZ(q));
          for (let q = 0; q < ix.length; q += 3) b.face3(base + ix[q], base + ix[q + 1], base + ix[q + 2]);
          g.dispose();
        });
      }
      // price cards stuck in the ice
      for (let i = 0; i < 9; i++) {
        const s = S0 + 0.5 + i * (L - 1) / 8, [x, z] = SO(s, O_ICE0 + 0.1);
        b.box(x, y0 + 0.02, z, 0.16, 0.12, 0.012, -H_STREET, white);
      }
    }
    // the ice bed and the counter are solid (the lane between them is where
    // the catcher is put; nobody walks into it)
    {
      const { city } = this.o, rot = Math.atan2(UZ, UX), hw = (S1 - S0) / 2 + 0.05;
      const box2 = (o0, o1) => { const [x, z] = SO(sm, (o0 + o1) / 2); return { x, z, hw, hd: (o1 - o0) / 2, rot, y0: yF, y1: yF + 1.1 }; };
      if (city.setLandmarkSolids) city.setLandmarkSolids([...(city.landmarkSolids || []), box2(O_ICE0, O_ICE1 + 0.05), box2(O_CTR, IN - 0.05)]);
    }
    const m = new THREE.Mesh(b.build(), world.mats.flat);
    m.receiveShadow = true;
    m.castShadow = true;
    m.name = 'fishStall';
    scene.add(m);
    this.stall = m;
    // the board over the stall, on the arcade's face under the canopy
    const c = document.createElement('canvas'); c.width = 512; c.height = 96;
    const g = c.getContext('2d');
    g.fillStyle = '#f4efe3'; g.fillRect(0, 0, 512, 96);
    g.strokeStyle = '#1d3a2c'; g.lineWidth = 6; g.strokeRect(3, 3, 506, 90);
    g.fillStyle = '#c4231a'; g.font = '900 52px Helvetica, Arial, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText('FRESH FISH', 256, 44);
    g.fillStyle = '#1d3a2c'; g.font = '700 18px Helvetica, Arial, sans-serif';
    g.fillText('WE SHIP ANYWHERE · CATCH OF THE DAY', 256, 80);
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(4.2, 0.79), new THREE.MeshStandardMaterial({ map: t, roughness: 0.7 }));
    const [sx, sz] = SO(sm, IN - 0.1);
    sign.position.set(sx, yF + 3.1, sz);
    sign.rotation.y = H_STREET;
    scene.add(sign);
    this.sign = sign;
  }

  _buildMongers() {
    const shirts = [[0.2, 0.28, 0.42], [0.52, 0.52, 0.5], [0.16, 0.18, 0.2]];
    const orange = [0.86, 0.36, 0.08];
    this.mongers = MONGERS.map((m, i) => {
      const h = makeHumanoid({ unique: true, seed: 700 + i * 31, variant: [0, 5, 9][i], shirt: shirts[i], pants: orange, bib: orange });
      const [x, z] = SO(m.s, O_MONGER);
      const y = this.floorY(m.s, O_MONGER);
      h.group.position.set(x, y, z);
      h.group.rotation.y = H_WALL;
      this.o.scene.add(h.group);
      return { ...m, h, x, z, y, t: 0, phase: 'idle', kind: null, held: null };
    });
  }

  _buildDom() {
    const d = document.createElement('div');
    d.id = 'fishTossUi';
    d.innerHTML = `<div class="fTop"><span class="fTime"></span><span class="fScore"></span><span class="fMult"></span><span class="fDrops"></span></div>
      <div class="fCall"><div class="fOrder"></div><div class="fEcho"></div></div>
      <div class="fMsg"></div>
      <button class="fCatch">CATCH</button><button class="fQuit">✕</button>
      <div class="fHint">Slide along the counter · CATCH as it arrives</div>
      <div class="fEnd"><div class="fEndT"></div><div class="fEndS"></div><button class="fAgain">Again</button><button class="fDone">Done</button></div>`;
    const st = document.createElement('style');
    st.textContent = `
      #fishTossUi { position: absolute; inset: 0; z-index: 35; display: none; pointer-events: none; font: 800 14px -apple-system, Helvetica, sans-serif; color: #fff; }
      #fishTossUi.show { display: block; }
      body.fishTossOn #hud, body.fishTossOn #pad, body.fishTossOn #topBtns { display: none !important; }
      #fishTossUi .fTop { position: absolute; top: calc(12px + var(--safe-t, 0px)); left: 50%; transform: translateX(-50%); display: flex; gap: 16px;
        background: rgba(10,20,16,.62); padding: 8px 16px; border-radius: 999px; letter-spacing: .05em; white-space: nowrap; }
      #fishTossUi .fDrops { color: #ff9a6a; }
      #fishTossUi .fCall { position: absolute; top: calc(58px + var(--safe-t, 0px)); left: 0; right: 0; text-align: center; opacity: 0; transition: opacity .15s; }
      #fishTossUi .fCall.on { opacity: 1; }
      #fishTossUi .fOrder { font-size: 20px; font-weight: 900; text-shadow: 0 2px 10px #000c; letter-spacing: .02em; }
      #fishTossUi .fEcho { font-size: 15px; color: #ffcf6a; margin-top: 4px; text-shadow: 0 2px 8px #000c; }
      #fishTossUi .fMsg { position: absolute; top: 24%; width: 100%; text-align: center; font-size: 40px; font-weight: 900; text-shadow: 0 4px 18px #000b;
        opacity: 0; transform: scale(.8); transition: opacity .12s, transform .12s; }
      #fishTossUi .fMsg.on { opacity: 1; transform: scale(1); }
      #fishTossUi button { pointer-events: auto; -webkit-tap-highlight-color: transparent; touch-action: manipulation; border: none; color: #fff; font: 900 16px -apple-system, Helvetica, sans-serif; }
      #fishTossUi .fCatch { position: absolute; right: calc(24px + var(--safe-r, 0px)); bottom: calc(36px + var(--safe-b, 0px)); width: 112px; height: 112px;
        border-radius: 50%; background: radial-gradient(circle at 40% 35%, #f38a3c, #cf5412); box-shadow: 0 6px 0 #7e2d06; letter-spacing: .06em; }
      #fishTossUi .fCatch:active { transform: translateY(4px); box-shadow: 0 2px 0 #7e2d06; }
      #fishTossUi .fQuit { position: absolute; top: calc(12px + var(--safe-t, 0px)); right: calc(16px + var(--safe-r, 0px)); width: 40px; height: 40px; border-radius: 50%; background: rgba(10,20,16,.62); }
      #fishTossUi .fHint { position: absolute; left: 0; right: 0; bottom: calc(14px + var(--safe-b, 0px)); text-align: center; font-size: 12px; opacity: .75; text-shadow: 0 1px 6px #000; }
      #fishTossUi .fEnd { position: absolute; inset: 0; display: none; flex-direction: column; align-items: center; justify-content: center; gap: 10px; background: rgba(8,16,12,.55); pointer-events: auto; }
      #fishTossUi .fEnd.on { display: flex; }
      #fishTossUi .fEndT { font-size: 36px; font-weight: 900; } #fishTossUi .fEndS { font-size: 15px; opacity: .88; margin-bottom: 8px; text-align: center; line-height: 1.5; }
      #fishTossUi .fAgain, #fishTossUi .fDone { padding: 12px 34px; border-radius: 999px; background: #d9621c; }
      #fishTossUi .fDone { background: rgba(255,255,255,.18); }`;
    document.head.appendChild(st);
    document.getElementById('app').appendChild(d);
    this.el = d;
    const q = (s) => d.querySelector(s);
    this.ui = { time: q('.fTime'), score: q('.fScore'), mult: q('.fMult'), drops: q('.fDrops'), call: q('.fCall'), order: q('.fOrder'), echo: q('.fEcho'),
      msg: q('.fMsg'), end: q('.fEnd'), endT: q('.fEndT'), endS: q('.fEndS'), hint: q('.fHint') };
    q('.fCatch').addEventListener('pointerdown', (e) => { e.preventDefault(); e.stopPropagation(); this.grab(); });
    q('.fQuit').addEventListener('pointerdown', (e) => { e.preventDefault(); e.stopPropagation(); this.close(); });
    q('.fAgain').addEventListener('click', () => this._round());
    q('.fDone').addEventListener('click', () => this.close());
    window.addEventListener('keydown', (e) => {
      if (this.state !== 'play') { if (this.state === 'over' && e.code === 'Escape') this.close(); return; }
      if (e.code === 'Space' || e.code === 'KeyJ' || e.code === 'Enter') { if (!e.repeat) this.grab(); }
      else if (e.code === 'Escape') this.close();
      else return;
      e.preventDefault(); e.stopPropagation();
    }, true);
  }

  // --- in the world -----------------------------------------------------------------

  /** ENTER on foot in front of the stall? */
  near(pl) {
    const dx = pl.x - AX, dz = pl.z - AZ;
    const s = dx * UX + dz * UZ, o = dx * WX + dz * WZ;
    return s > S0 - 2 && s < S1 + 2 && o > 2.4 && o < IN && Math.abs(pl.y - this.y) < 2;
  }

  /** Idle the crew and show/hide the stall by distance (called every frame). */
  updateWorld(dt, px, pz) {
    const d = Math.hypot(px - AX, pz - AZ);
    const vis = d < 260;
    if (vis !== this.visible) {
      this.visible = vis;
      this.stall.visible = this.sign.visible = this.floor.visible = vis;
      for (const m of this.mongers) m.h.group.visible = vis && d < 160;
    }
    if (this.state !== 'off' || !vis || d > 160) return;
    for (const m of this.mongers) {
      m.t += dt;
      animateWalk(m.h, 0, dt, 0);
      // between customers: arms folded low, a look along the ice
      const b = m.h.bones;
      b[BONES.neck].rotation.y = Math.sin(m.t * 0.4 + m.s) * 0.35;
    }
  }

  // --- the game -----------------------------------------------------------------------

  start(env) {
    this.env = env;                  // { camera, player, bones }
    const P = env.player;
    this.fov0 = env.camera.fov;
    env.camera.fov = 48;
    env.camera.updateProjectionMatrix();
    document.body.classList.add('fishTossOn');
    this.el.classList.add('show');
    this.catchS = (S0 + S1) / 2;
    P.heading = H_STREET;
    this._round();
  }

  _round() {
    this.state = 'play';
    this.t = 0; this.score = 0; this.caught = 0; this.perfects = 0; this.streak = 0; this.bestStreak = 0; this.drops = 0;
    this.nextThrow = 1.2;
    this.later = [];
    this.grabT = -9; this.holdT = 0; this.holding = null;
    for (const f of this.fish) { this.o.scene.remove(f.mesh); if (f.ring) this.o.scene.remove(f.ring); }
    for (const p of this.pile) this.o.scene.remove(p);
    this.fish = []; this.pile = [];
    for (const m of this.mongers) { m.phase = 'idle'; if (m.held) { this.o.scene.remove(m.held); m.held = null; } }
    this.ui.end.classList.remove('on');
    this.ui.hint.style.opacity = '.75';
    this._msg('');
    this._hud();
  }

  get mult() { return Math.min(4, 1 + Math.floor(this.streak / 5)); }

  _hud() {
    const left = Math.max(0, ROUND_S - this.t);
    this.ui.time.textContent = `0:${String(Math.ceil(left)).padStart(2, '0')}`;
    this.ui.score.textContent = `${this.score} PTS`;
    this.ui.mult.textContent = this.mult > 1 ? `×${this.mult}` : '';
    const d = Math.min(DROPS, this.drops);
    this.ui.drops.textContent = '🐟'.repeat(DROPS - d) + '·'.repeat(d);
  }

  _msg(s, col, big) {
    this.ui.msg.textContent = s;
    this.ui.msg.style.color = col || '#fff';
    this.ui.msg.style.fontSize = big ? '44px' : '30px';
    this.ui.msg.classList.toggle('on', !!s);
    this._msgT = 0.9;
  }

  grab() {
    if (this.state !== 'play') return;
    this.grabT = this.t;
    this.ui.hint.style.opacity = '0';
  }

  close() {
    const { camera, player } = this.env || {};
    this.state = 'off';
    for (const f of this.fish) { this.o.scene.remove(f.mesh); if (f.ring) this.o.scene.remove(f.ring); }
    for (const p of this.pile) this.o.scene.remove(p);
    for (const m of this.mongers) if (m.held) { this.o.scene.remove(m.held); m.held = null; }
    if (this.holding) { this.o.scene.remove(this.holding); this.holding = null; }
    this.fish = []; this.pile = [];
    this.el.classList.remove('show');
    this.ui.end.classList.remove('on');
    document.body.classList.remove('fishTossOn');
    if (camera && this.fov0) { camera.fov = this.fov0; camera.updateProjectionMatrix(); this.fov0 = 0; }
    if (player) {
      // step back out onto the pavement, facing the stall
      const [x, z] = SO(this.catchS, 3.2);
      player.x = x; player.z = z; player.y = this.o.city.groundAt(x, z, this.y + 0.5);
      player.heading = H_WALL; player.camYaw = H_WALL + Math.PI;
      player.camPos.set(x - Math.sin(H_WALL) * 4.6, player.y + 1.6, z - Math.cos(H_WALL) * 4.6);
      player.camFootY = null;
    }
    if (this.o.onEnd) this.o.onEnd();
  }

  /** How often a throw comes, and how long it flies, as the round goes on. */
  _pace() {
    const k = clamp(this.t / ROUND_S, 0, 1);
    return { gap: 2.1 - 1.15 * k, flight: 1.02 - 0.3 * k, double: k > 0.5 };
  }

  _pickKind() {
    const r = Math.random();
    return r < 0.3 ? 'king' : r < 0.48 ? 'coho' : r < 0.64 ? 'sockeye' : r < 0.78 ? 'halibut' : r < 0.94 ? 'crab' : 'monk';
  }

  _orderCall(m, kind) {
    const k = KINDS[kind], dest = DEST[Math.floor(Math.random() * DEST.length)];
    const n = kind === 'crab' ? WHO[Math.floor(Math.random() * WHO.length)] : 'ONE';
    const what = n === 'ONE' ? k.name : `${k.name}S`;
    this.ui.order.textContent = `${m.name}: ${n} ${what}, FLYING TO ${dest}!`;
    this.ui.echo.textContent = `“${dest}!”`;
    this.ui.call.classList.add('on');
    this._callT = 1.8;
  }

  _startThrow(m) {
    const kind = this._pickKind();
    m.phase = 'pick'; m.t = 0; m.kind = kind;
    this._orderCall(m, kind);
  }

  _release(m) {
    const kind = m.kind, k = KINDS[kind];
    const mesh = m.held;
    m.held = null;
    const p0 = new THREE.Vector3();
    m.h.bones[BONES.handR].getWorldPosition(p0);
    // Aimed now, at a spot along the counter you can get to in the flight:
    // most throws make you move, none is out of reach.
    const T = this._pace().flight * (k.heavy ? 1.12 : 1) * (0.92 + Math.random() * 0.16);
    const reach = Math.min(2.4, CATCH_SPEED * T * 0.62);
    let aim = this.catchS + (Math.random() < 0.5 ? -1 : 1) * reach * (0.25 + Math.random() * 0.75);
    if (aim < S0 + 0.4 || aim > S1 - 0.4) aim = this.catchS - (aim - this.catchS);
    m.aimS = clamp(aim, S0 + 0.4, S1 - 0.4);
    const [tx, tz] = SO(m.aimS, O_LANE);
    const ty = this.y + 1.3 + Math.random() * 0.3;
    const g = 9.81;
    const v = new THREE.Vector3((tx - p0.x) / T, (ty - p0.y + 0.5 * g * T * T) / T, (tz - p0.z) / T);
    const ring = new THREE.Mesh(this.ringGeo, this.ringMat);
    ring.position.set(tx, ty, tz);
    ring.rotation.y = H_STREET;
    ring.renderOrder = 10;
    this.o.scene.add(ring);
    this.fish.push({ kind, mesh, ring, p: p0.clone(), v, T, age: 0, aimS: m.aimS, state: 'fly', spin: (Math.random() - 0.5) * 3, wob: Math.random() * 6 });
    this._sfx('bump', 0.25, 1.6);
  }

  _sfx(name, gain, rate) {
    const a = this.o.audio;
    if (a && a.play) a.play(name, { gain, rate: rate || 1 });
  }

  _crewStep(dt) {
    const pace = this._pace();
    this.nextThrow -= dt;
    const busy = this.mongers.filter((m) => m.phase !== 'idle').length;
    if (this.nextThrow <= 0 && this.drops < DROPS && this.t < ROUND_S - 0.8 && (busy === 0 || (pace.double && busy < 2))) {
      const free = this.mongers.filter((m) => m.phase === 'idle');
      if (free.length) this._startThrow(free[Math.floor(Math.random() * free.length)]);
      this.nextThrow = pace.gap * (0.8 + Math.random() * 0.4);
    }
    for (const m of this.mongers) {
      m.t += dt;
      animateWalk(m.h, 0, dt, 0);
      const b = m.h.bones;
      const sp = b[BONES.spine], shR = b[BONES.shoulderR], elR = b[BONES.elbowR], shL = b[BONES.shoulderL];
      if (m.phase === 'pick') {
        // bend to the ice and take the fish by the tail
        const u = clamp(m.t / 0.45, 0, 1);
        sp.rotation.x = 0.55 * Math.sin(u * Math.PI);
        shR.rotation.x = -0.9 * Math.sin(u * Math.PI);
        if (m.t > 0.25 && !m.held) {
          m.held = new THREE.Mesh(this.geos[m.kind], this.o.world.mats.flat);
          m.held.castShadow = true;
          this.o.scene.add(m.held);
        }
        if (m.t >= 0.45) { m.phase = 'wind'; m.t = 0; }
      } else if (m.phase === 'wind') {
        // the arm goes back and up, the other points at the counter
        const u = clamp(m.t / 0.35, 0, 1);
        shR.rotation.x = 0.9 * u; elR.rotation.x = -0.9 * u;
        shL.rotation.x = -1.2 * u;
        sp.rotation.x = -0.12 * u;
        if (m.t >= 0.35) { m.phase = 'throw'; m.t = 0; }
      } else if (m.phase === 'throw') {
        // over the top and through
        const u = clamp(m.t / 0.16, 0, 1);
        shR.rotation.x = 0.9 - 3.3 * u; elR.rotation.x = -0.9 + 0.85 * u;
        shL.rotation.x = -1.2 + 0.8 * u;
        sp.rotation.x = -0.12 + 0.3 * u;
        if (m.t >= 0.12 && m.held) this._release(m);
        if (m.t >= 0.5) { m.phase = 'idle'; m.t = 0; }
      }
      if (m.held) {
        // in the right hand, tail first, the nose trailing the swing
        m.h.group.updateMatrixWorld(true);
        b[BONES.handR].getWorldPosition(this._v);
        m.held.position.copy(this._v);
        m.held.rotation.set(0, 0, 0);
        m.held.rotation.order = 'YXZ';
        m.held.rotation.y = H_WALL;
        m.held.rotation.x = m.phase === 'wind' ? 1.2 : 0.4;
        m.held.rotation.z = Math.PI / 2;
      }
    }
  }

  _fishStep(dt) {
    const g = 9.81, P = this.env.player;
    for (let i = this.fish.length - 1; i >= 0; i--) {
      const f = this.fish[i];
      f.age += dt;
      if (f.state === 'fly') {
        // the ring closes to the fish's size as it arrives: the timing cue
        if (f.ring) f.ring.scale.setScalar(1 + 2.2 * (1 - clamp(f.age / f.T, 0, 1)));
        f.v.y -= g * dt;
        f.p.addScaledVector(f.v, dt);
        // past the counter line?
        const dx = f.p.x - AX, dz = f.p.z - AZ;
        const o = dx * WX + dz * WZ, s = dx * UX + dz * UZ;
        if (o >= O_LANE - 0.05) {
          // It arrives. Hands closed up to 0.34 s before it, or within 80 ms
          // after, catch it; a tenth of a second either side is PERFECT.
          if (f.arriveT == null) { f.arriveT = this.t; if (f.ring) { this.o.scene.remove(f.ring); f.ring = null; } }
          const ds = Math.abs(s - this.catchS), dy = f.p.y - this.y;
          const reach = ds < 0.58 && dy > 0.7 && dy < 2.2;
          const dg = f.arriveT - this.grabT;
          if (reach && dg >= -0.08 && dg <= 0.34) {
            this._caught(f, Math.abs(dg));
            this.fish.splice(i, 1);
            continue;
          }
          if (reach && this.t - f.arriveT < 0.08) continue;
          f.state = 'drop';
          f.reason = reach ? (dg > 0.34 && dg < 0.9 ? 'early' : 'bounce') : 'miss';
          if (reach) { f.v.x *= -0.25; f.v.z *= -0.25; f.v.y = Math.abs(f.v.y) * 0.3 + 1; }
          this._dropped(f);
        }
      } else if (f.state === 'drop') {
        f.v.y -= g * dt;
        f.p.addScaledVector(f.v, dt);
        const floor = this.o.city.groundAt(f.p.x, f.p.z, f.p.y);
        if (f.p.y < floor + 0.08) {
          f.p.y = floor + 0.08;
          if (Math.abs(f.v.y) > 1.2) { f.v.y = -f.v.y * 0.35; f.v.x *= 0.5; f.v.z *= 0.5; this._sfx('land', 0.45, 1.3); }
          else { f.v.set(0, 0, 0); f.state = 'floor'; f.floorT = 0; }
        }
      } else if (f.state === 'floor') {
        f.floorT += dt;
        f.flop = Math.sin(f.floorT * 18) * Math.max(0, 1 - f.floorT) * 0.5;
        if (f.floorT > 1.4) { this.o.scene.remove(f.mesh); this.fish.splice(i, 1); continue; }
      }
      // orient: along the flight, flapping, a crab spinning flat
      const m = f.mesh;
      m.position.copy(f.p);
      m.rotation.order = 'YXZ';
      if (f.state === 'floor') {
        m.rotation.set(0, m.rotation.y, KINDS[f.kind].spin ? 0 : Math.PI / 2 + (f.flop || 0));
      } else if (KINDS[f.kind].spin) {
        m.rotation.set(0, m.rotation.y + dt * 9, 0.3 * Math.sin(f.age * 5));
      } else {
        const hv = Math.hypot(f.v.x, f.v.z);
        m.rotation.set(-Math.atan2(f.v.y, hv), Math.atan2(f.v.x, f.v.z), Math.PI / 2 + Math.sin(f.age * 14 + f.wob) * 0.35 + f.spin * f.age * 0.3);
      }
    }
    void P;
  }

  _caught(f, lead) {
    const k = KINDS[f.kind];
    const perfect = lead < 0.1;
    this.streak++;
    this.bestStreak = Math.max(this.bestStreak, this.streak);
    this.caught++;
    if (perfect) this.perfects++;
    const pts = Math.round(k.pts * (perfect ? 1.5 : 1) * this.mult);
    this.score += pts;
    this._msg(perfect ? `PERFECT! +${pts}` : `CAUGHT! +${pts}`, perfect ? '#7dffa0' : '#ffd23a', perfect);
    if (this.streak > 0 && this.streak % 5 === 0) this.later.push({ t: this.t + 0.5, fn: () => this._msg(`${this.streak} IN A ROW — ×${this.mult}`, '#ffb24a', true) });
    this._sfx('punch', 0.7, perfect ? 1.1 : 0.95);
    if (perfect) this._sfx('pickup', 0.3, 1.2);
    this.holding = f.mesh;
    this.holdT = 0;
    this.holdKind = f.kind;
    this._hud();
  }

  _dropped(f) {
    if (this.drops >= DROPS) return;          // already going home
    this.streak = 0;
    this.drops++;
    this._msg(f.reason === 'early' ? 'TOO EARLY!' : f.reason === 'bounce' ? 'BUTTERFINGERS!' : 'ON THE FLOOR!', '#ff8a6a');
    this._sfx('land', 0.6, 1.1);
    this._hud();
    if (this.drops >= DROPS) this.later.push({ t: this.t + 0.9, fn: () => this._end() });
  }

  _catcherStep(dt, input) {
    const P = this.env.player, b = this.env.bones;
    const want = clamp(input.x || 0, -1, 1);
    const sp = want * CATCH_SPEED;
    this.catchS = clamp(this.catchS + sp * dt, S0 + 0.25, S1 - 0.25);
    const [x, z] = SO(this.catchS, O_LANE);
    P.x = x; P.z = z; P.y = this.floorY(this.catchS, O_LANE);
    P.heading = H_STREET;
    P.h.group.position.set(P.x, P.y, P.z);
    P.h.group.rotation.y = H_STREET;
    animateWalk(P.h, Math.abs(sp) > 0.1 ? 0.35 : 0, dt, Math.abs(sp) * 0.6);
    // hands: ready at the chest, up and together when grabbing, holding a catch
    const g = this.t - this.grabT;
    const grabbing = g >= 0 && g < 0.34;
    let sh = -0.55, el = -1.2;
    if (grabbing) { const u = Math.sin(clamp(g / 0.34, 0, 1) * Math.PI); sh = -0.55 - 0.85 * u; el = -1.2 + 0.8 * u; }
    if (this.holding) { sh = -0.9; el = -1.35; }
    for (const [s1, e1] of [[b.shoulderL, b.elbowL], [b.shoulderR, b.elbowR]]) { s1.rotation.x = sh; e1.rotation.x = el; }
    P.h.group.updateMatrixWorld(true);
    if (this.holding) {
      this.holdT += dt;
      const m = this.holding;
      if (this.holdT < 0.45) {
        // cradled across both hands
        b.handL.getWorldPosition(this._v);
        const hl = this._v.clone();
        b.handR.getWorldPosition(this._v);
        m.position.addVectors(hl, this._v).multiplyScalar(0.5);
        m.position.y += 0.06;
        m.rotation.set(0, H_STREET + Math.PI / 2, 0);
        m.rotation.order = 'YXZ';
      } else {
        // over the shoulder onto the counter, a pile growing along it
        const u = clamp((this.holdT - 0.45) / 0.3, 0, 1);
        const n = this.pile.length;
        const ps = S0 + 0.6 + (n % 8) * ((S1 - S0 - 1.2) / 7), [px, pz] = SO(ps, O_CTR + 0.2);
        const py = this.y + 0.99 + Math.floor(n / 8) * 0.07;
        const from = m.userData.from || (m.userData.from = m.position.clone());
        m.position.set(from.x + (px - from.x) * u, from.y + (py - from.y) * u + Math.sin(u * Math.PI) * 0.5, from.z + (pz - from.z) * u);
        m.rotation.set(0, H_WALL + Math.PI / 2, KINDS[this.holdKind].spin ? 0 : Math.PI / 2);
        if (u >= 1) {
          this.pile.push(m);
          if (this.pile.length > 16) this.o.scene.remove(this.pile.shift());
          this.holding = null;
        }
      }
    }
  }

  _end() {
    if (this.state !== 'play') return;
    this.state = 'over';
    this.ui.call.classList.remove('on');
    this._msg('');
    const pay = Math.round(this.score / 40);
    if (this.score > this.best) { this.best = this.score; try { localStorage.setItem('auto-fishtoss-best', String(this.best)); } catch (e) { /* private */ } }
    this.ui.endT.textContent = this.drops >= DROPS ? 'Three on the floor!' : 'Shift over!';
    this.ui.endS.innerHTML = `${this.caught} caught · ${this.perfects} perfect · best run ${this.bestStreak}<br>${this.score} points · paid $${pay} · best ${this.best}`;
    this.ui.end.classList.add('on');
    if (pay > 0 && this.o.onReward) this.o.onReward(pay);
  }

  update(dt) {
    if (this.state === 'off') return;
    const cam = this.env.camera;
    if (this.state === 'play') {
      this.t += dt;
      const input = this.o.controls ? this.o.controls.read() : { x: 0 };
      this._crewStep(dt);
      this._fishStep(dt);
      this._catcherStep(dt, input);
      for (let i = this.later.length - 1; i >= 0; i--) if (this.t >= this.later[i].t) { const l = this.later[i]; this.later.splice(i, 1); l.fn(); }
      if (this.t >= ROUND_S && !this.fish.some((f) => f.state === 'fly')) this._end();
      if ((this._callT -= dt) <= 0) this.ui.call.classList.remove('on');
      if ((this._msgT -= dt) <= 0) this.ui.msg.classList.remove('on');
      this._hud();
    }
    // the camera: out in Pike Place, over the crew's shoulders, on the counter
    const sm = (S0 + S1) / 2, follow = sm + (this.catchS - sm) * 0.35;
    const [cx, cz] = SO(follow, -2.2), [lx, lz] = SO(follow, O_LANE);
    cam.position.set(cx, this.y + 5.0, cz);
    cam.up.set(0, 1, 0);
    cam.lookAt(lx, this.y + 0.95, lz);
    cam.updateMatrixWorld(true);
  }
}
