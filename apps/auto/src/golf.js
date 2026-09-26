// GOLF AT INTERBAY. Three par-3s on the green west of 15th Ave W, where the
// Interbay Golf Center's executive course is: 126, 140 and 155 yards, laid
// on the real ground (it falls 2-6 m across a hole, so the ball rolls
// downhill), with tee boxes, mown fairways, greens, bunkers, the flag and the
// cup drawn as one draped mesh.
//
// ENTER on the first tee starts a round. Each shot: aim with the stick (or a
// drag), pick a club (the right one is picked for you by the distance; CLUB
// changes it), and SWING: the first tap stops the POWER meter, the second the
// ACCURACY needle as it sweeps back through the sweet spot -- early hooks it,
// late slices it, and either costs a little distance. The ball flies on
// ballistics with drag and a breeze (shown by the arrow), comes down, bounces
// and rolls by what it lands on -- green, fringe, fairway, rough, sand -- and
// down the slope. Trunks knock it back. On the green the putter comes out:
// one tap for pace, and the cup takes a ball rolling slowly enough over it
// (a fast one lips out). Walking between shots is done for you.
//
// Pays for the round against par (9): $300 for 3 under, $150 for par, less
// above; a hole-in-one pays $500 on its own. Best round in localStorage.

import * as THREE from './three.js';
import * as G from './geo.js';
import { Builder } from './build.js';
import { clamp, damp } from './util.js';
import { BONES, animateWalk } from './peds.js';
import { solveArm } from './vehicles.js';

// The course, relative to the Interbay Golf Center (47.6415 N, 122.3764 W).
const ORIGIN = G.toWorld(47.6415, -122.3764);
const HOLES = [
  { tee: [-60, -215], green: [-66, -100], bunkers: [[-7, -4, 3.2, 2.2], [8, 6, 2.6, 2.0]] },
  { tee: [-105, -85], green: [-225, -40], bunkers: [[-9, 2, 3.4, 2.4], [2, 11, 4.0, 1.8]] },
  { tee: [-250, -115], green: [-205, -250], bunkers: [[8, -3, 3.0, 2.4], [-6, 10, 2.8, 2.0], [-2, -40, 5, 3]] },
].map((h, i) => {
  const tx = ORIGIN[0] + h.tee[0], tz = ORIGIN[1] + h.tee[1];
  const gx = ORIGIN[0] + h.green[0], gz = ORIGIN[1] + h.green[1];
  const L = Math.hypot(gx - tx, gz - tz);
  const ux = (gx - tx) / L, uz = (gz - tz) / L;
  // bunkers are [along the hole from the green, across, radius along, across]
  const bunkers = h.bunkers.map(([a, c, ra, rc]) => ({ x: gx + ux * a + uz * c, z: gz + uz * a - ux * c, ra, rc, ux, uz }));
  // the pin somewhere on the green, a little off-centre
  const pin = { x: gx + ux * [2, -2.5, 1][i] + uz * [1.5, -1, -2][i], z: gz + uz * [2, -2.5, 1][i] - ux * [1.5, -1, -2][i] };
  return { n: i + 1, par: 3, tee: { x: tx, z: tz }, green: { x: gx, z: gz, ra: 9, rc: 7 }, L, ux, uz, bunkers, pin };
});
const PAR = 9;
const UV0 = [0, 0, 0, 0, 0, 0, 0, 0];
const CUP_R = 0.054, BALL_R = 0.0214, BALL_DRAW = 0.045;
const YD = 1.0936;
// clubs: full carry in still air (m), launch angle, how much it runs out
const CLUBS = [
  // spin: how hard the ball checks when it lands (m/s2 for its first half second)
  { name: '7 IRON', carry: 140, angle: 20, roll: 0.9, spin: 2.2 },
  { name: '9 IRON', carry: 118, angle: 27, roll: 0.7, spin: 3.4 },
  { name: 'WEDGE', carry: 100, angle: 33, roll: 0.5, spin: 4.4 },
  { name: 'SAND WEDGE', carry: 75, angle: 42, roll: 0.3, spin: 5.4 },
  { name: 'PUTTER', carry: 0, angle: 0, roll: 1, spin: 0 },
];
// what the ball meets: bounce, how fast it stops rolling (m/s2), colour
const SURF = {
  green: { e: 0.22, roll: 0.62, col: [0.36, 0.62, 0.3] },
  fringe: { e: 0.25, roll: 1.1, col: [0.33, 0.55, 0.26] },
  fairway: { e: 0.3, roll: 1.5, col: [0.34, 0.56, 0.24] },
  tee: { e: 0.3, roll: 1.5, col: [0.35, 0.6, 0.27] },
  bunker: { e: 0.02, roll: 9, col: [0.86, 0.79, 0.6] },
  rough: { e: 0.16, roll: 3.4, col: null },
};
const DRAG = 0.0042;      // quadratic drag, per m (tuned against the carries)
const ease = (u) => { u = clamp(u, 0, 1); return u * u * (3 - 2 * u); };

/** Which surface is (x, z) on, for hole h? */
function surfaceAt(h, x, z) {
  const g = h.green;
  const gu = (x - g.x) * h.ux + (z - g.z) * h.uz, gv = (x - g.x) * h.uz - (z - g.z) * h.ux;
  const ge = (gu / g.ra) ** 2 + (gv / g.rc) ** 2;
  for (const b of h.bunkers) {
    const bu = (x - b.x) * b.ux + (z - b.z) * b.uz, bv = (x - b.x) * b.uz - (z - b.z) * b.ux;
    if ((bu / b.ra) ** 2 + (bv / b.rc) ** 2 < 1) return 'bunker';
  }
  if (ge < 1) return 'green';
  if (ge < 1.35) return 'fringe';
  const s = (x - h.tee.x) * h.ux + (z - h.tee.z) * h.uz, w = Math.abs((x - h.tee.x) * h.uz - (z - h.tee.z) * h.ux);
  if (s > -4 && s < 4 && w < 3.2) return 'tee';
  // the fairway: from 20 m out to the green, widest in the middle
  const half = 11 + 3 * Math.sin(clamp((s - 20) / (h.L - 30), 0, 1) * Math.PI);
  if (s > 20 && s < h.L - 4 && w < half) return 'fairway';
  return 'rough';
}

export class Golf {
  /** opts: { scene, city, world, audio, controls, onReward, onEnd } */
  constructor(opts) {
    this.o = opts;
    this.state = 'off';          // off | aim | power | accuracy | swing | fly | roll | holed | card
    this.best = 0;
    try { this.best = +localStorage.getItem('auto-golf-best') || 0; } catch (e) { /* private */ }
    this.holes = HOLES;
    this.tee = { ...HOLES[0].tee };
    this._keepClear();
    this._buildCourse();
    this._buildDom();
    this._v = new THREE.Vector3();
  }

  get active() { return this.state !== 'off'; }

  _keepClear() {
    // no park trees or benches on the tees, fairways and greens
    const { city } = this.o;
    const rects = HOLES.map((h) => {
      const px = h.uz, pz = -h.ux;
      return { x: h.tee.x, z: h.tee.z, dx: h.ux, dz: h.uz, px, pz, u0: -8, u1: h.L + 14, hw: 17, reach: h.L + 30 };
    });
    city.jumpClearRects = [...(city.jumpClearRects || []), ...rects];
  }

  _buildCourse() {
    const { scene } = this.o;
    const b = new Builder(false);
    const Y = (x, z) => G.terrainHeight(x, z);
    for (const h of HOLES) {
      // The course's ground is cut out of a 1 m grid by marching squares over
      // signed distance fields -- the union of tee, fairway and fringe for the
      // grass, each bunker for the sand drawn a little over it -- so edges
      // follow the true shapes instead of stepping cell by cell. Each vertex
      // is coloured by its surface (stripes on the fairway, tee and green),
      // colour between surfaces blends across a cell, which reads as mowing.
      const S0 = -8, S1 = h.L + 14, W = 17, STEP = 1;
      const at = (s, w) => [h.tee.x + h.ux * s + h.uz * w, h.tee.z + h.uz * s - h.ux * w];
      const colAt = (x, z, s, w) => {
        let kind = surfaceAt(h, x, z);
        if (kind === 'rough' || kind === 'bunker') kind = 'fringe';
        let col = SURF[kind].col;
        if (kind === 'fairway' || kind === 'green' || kind === 'tee') {
          const band = kind === 'green' ? Math.floor(w / 2.2) : Math.floor(s / 7);
          const k = band % 2 ? 1.06 : 0.94;
          col = [col[0] * k, col[1] * k, col[2] * k];
        }
        return col;
      };
      // a triangle facing up, each corner its own colour
      const tri = (A, B, C) => {
        const ux = B.p[0] - A.p[0], uz = B.p[2] - A.p[2], vx = C.p[0] - A.p[0], vz = C.p[2] - A.p[2];
        if (uz * vx - ux * vz < 0) { const t = B; B = C; C = t; }
        const i = [A, B, C].map((q) => b.vert(q.p[0], q.p[1], q.p[2], 0, 1, 0, 0, 0, q.col[0], q.col[1], q.col[2]));
        b.face3(i[0], i[1], i[2]);
      };
      const layer = (field, lift, colFn) => {
        const nx = Math.round((S1 - S0) / STEP), nw = Math.round((2 * W) / STEP);
        const F = [];
        for (let i = 0; i <= nx; i++) { const r = []; for (let j = 0; j <= nw; j++) { const [x, z] = at(S0 + i * STEP, -W + j * STEP); r.push(field(x, z)); } F.push(r); }
        for (let i = 0; i < nx; i++) for (let j = 0; j < nw; j++) {
          const c = [[i, j], [i + 1, j], [i + 1, j + 1], [i, j + 1]];
          const f = c.map(([a, bb]) => F[a][bb]);
          if (f.every((v) => v <= 0)) continue;
          // clip the cell to f > 0 (Sutherland-Hodgman against one implicit edge)
          const poly = [];
          for (let k = 0; k < 4; k++) {
            const [ia, ja] = c[k], [ib, jb] = c[(k + 1) % 4], fa = f[k], fb = f[(k + 1) % 4];
            if (fa > 0) poly.push([ia, ja]);
            if ((fa > 0) !== (fb > 0)) { const t = fa / (fa - fb); poly.push([ia + (ib - ia) * t, ja + (jb - ja) * t]); }
          }
          if (poly.length < 3) continue;
          const pts = poly.map(([pi, pj]) => {
            const sv = S0 + pi * STEP, wv = -W + pj * STEP, [x, z] = at(sv, wv);
            return { p: [x, G.terrainHeight(x, z) + lift, z], col: colFn(x, z, sv, wv) };
          });
          for (let k = 1; k < pts.length - 1; k++) tri(pts[0], pts[k], pts[k + 1]);
        }
      };
      // grass: tee, fairway and the fringe round the green (the green is inside it)
      const ell = (x, z, cx, cz, ra, rc, ux, uz) => {
        const u = (x - cx) * ux + (z - cz) * uz, v = (x - cx) * uz - (z - cz) * ux;
        return (1 - Math.hypot(u / ra, v / rc)) * Math.min(ra, rc);
      };
      const grass = (x, z) => {
        const s = (x - h.tee.x) * h.ux + (z - h.tee.z) * h.uz, w = Math.abs((x - h.tee.x) * h.uz - (z - h.tee.z) * h.ux);
        const tee = Math.min(4 - Math.abs(s), 3.2 - w);
        const half = 11 + 3 * Math.sin(clamp((s - 20) / (h.L - 30), 0, 1) * Math.PI);
        const fw = Math.min(half - w, s - 20, h.L - 4 - s);
        const fr = ell(x, z, h.green.x, h.green.z, h.green.ra * 1.162, h.green.rc * 1.162, h.ux, h.uz);
        return Math.max(tee, fw, fr);
      };
      layer(grass, 0.045, colAt);
      for (const bk of h.bunkers) layer((x, z) => ell(x, z, bk.x, bk.z, bk.ra, bk.rc, bk.ux, bk.uz), 0.06, () => SURF.bunker.col);
      // the cup, the flagstick and its flag; tee markers
      const py = Y(h.pin.x, h.pin.z) + 0.047;
      const cup = [];
      for (let k = 0; k <= 16; k++) { const t = (k / 16) * Math.PI * 2; cup.push([h.pin.x + Math.cos(t) * CUP_R * 1.4, py, h.pin.z + Math.sin(t) * CUP_R * 1.4]); }
      for (let k = 0; k < 16; k++) b.tri([h.pin.x, py + 0.001, h.pin.z], cup[k], cup[k + 1], [0, 1, 0], [0.04, 0.04, 0.05]);
      b.tube([h.pin.x, py - 0.1, h.pin.z], [h.pin.x, py + 2.2, h.pin.z], 0.012, 6, [0.95, 0.95, 0.92]);
      for (const sd of [-1, 1]) {
        const mx = h.tee.x + h.uz * sd * 2.6 + h.ux * 1.5, mz = h.tee.z - h.ux * sd * 2.6 + h.uz * 1.5;
        b.spheroid(mx, Y(mx, mz) + 0.12, mz, 0.1, 8, 5, [0.9, 0.2, 0.15]);
      }
      // the hole's board by the tee
      const sx = h.tee.x - h.uz * 5 - h.ux * 1, sz = h.tee.z + h.ux * 5 - h.uz * 1;
      b.box(sx, Y(sx, sz), sz, 0.08, 1.2, 0.08, 0, [0.35, 0.26, 0.16]);
      h.board = { x: sx, z: sz, y: Y(sx, sz) + 1.0 };
    }
    this.courseMesh = new THREE.Mesh(b.build(), this.o.world.mats.flat);
    this.courseMesh.receiveShadow = true;
    this.courseMesh.name = 'golfCourse';
    scene.add(this.courseMesh);
    // flags (cloth that can wave) and the hole boards (text)
    this.flags = HOLES.map((h) => {
      const f = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 0.34, 4, 1), new THREE.MeshStandardMaterial({ color: [0xd23a2a, 0xf0c020, 0x2a6fd2][h.n - 1], side: THREE.DoubleSide, roughness: 0.8 }));
      f.geometry.translate(0.25, 0, 0);
      f.position.set(h.pin.x, Y(h.pin.x, h.pin.z) + 2.05, h.pin.z);
      f.userData.base = f.geometry.attributes.position.array.slice();
      scene.add(f);
      return f;
    });
    this.boards = HOLES.map((h) => {
      const c = document.createElement('canvas'); c.width = 256; c.height = 128;
      const g = c.getContext('2d');
      g.fillStyle = '#1f4a2c'; g.fillRect(0, 0, 256, 128);
      g.strokeStyle = '#e8e0c0'; g.lineWidth = 5; g.strokeRect(4, 4, 248, 120);
      g.fillStyle = '#fff'; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.font = '900 40px Helvetica, Arial, sans-serif'; g.fillText(`HOLE ${h.n}`, 128, 44);
      g.font = '700 24px Helvetica, Arial, sans-serif'; g.fillText(`PAR 3 · ${Math.round(h.L * YD)} YDS`, 128, 92);
      const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
      const m = new THREE.Mesh(new THREE.PlaneGeometry(1.0, 0.5), new THREE.MeshStandardMaterial({ map: t, roughness: 0.8, side: THREE.DoubleSide }));
      m.position.set(h.board.x, h.board.y + 0.25, h.board.z);
      m.rotation.y = Math.atan2(-h.ux, -h.uz) + Math.PI / 2;
      scene.add(m);
      return m;
    });
    // the ball, its trail, the aim marker, and the club
    this.ball = new THREE.Mesh(new THREE.SphereGeometry(BALL_DRAW, 12, 8), new THREE.MeshStandardMaterial({ color: 0xf8f8f4, roughness: 0.35 }));
    this.ball.castShadow = true;
    this.ball.visible = false;
    scene.add(this.ball);
    const TR = 48;
    this.trailPos = new Float32Array(TR * 3);
    const tg = new THREE.BufferGeometry();
    tg.setAttribute('position', new THREE.BufferAttribute(this.trailPos, 3));
    this.trail = new THREE.Line(tg, new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.7 }));
    this.trail.frustumCulled = false; this.trail.visible = false; this.trailN = 0;
    scene.add(this.trail);
    this.marker = new THREE.Mesh(new THREE.RingGeometry(0.9, 1.25, 32).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0xffe066, transparent: true, opacity: 0.85, depthWrite: false }));
    this.marker.visible = false;
    scene.add(this.marker);
    const cb = new Builder(false);
    cb.tube([0, 0, 0], [0, -0.92, 0], 0.007, 6, [0.6, 0.62, 0.66], true);
    cb.tube([0, 0.02, 0], [0, -0.22, 0], 0.013, 6, [0.08, 0.08, 0.09], true);          // grip
    cb.box(0.03, -1.0, 0, 0.1, 0.06, 0.03, 0, [0.7, 0.72, 0.75]);                         // head
    this.club = new THREE.Mesh(cb.build(), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.4, metalness: 0.6 }));
    this.club.visible = false;
    scene.add(this.club);
  }

  // --- the overlay ------------------------------------------------------------------

  _buildDom() {
    const d = document.createElement('div');
    d.id = 'golfUi';
    d.innerHTML = `<div class="gTop"><span class="gHole"></span><span class="gShot"></span><span class="gDist"></span></div>
      <div class="gWind"><div class="gArrow">➤</div><div class="gWs"></div></div>
      <div class="gClub"><div class="gCn"></div><div class="gCc"></div><div class="gLie"></div></div>
      <div class="gMeter"><div class="gFill"></div><div class="gSweet"></div><div class="gNeedle"></div></div>
      <div class="gMsg"></div>
      <button class="gSwing">SWING</button><button class="gClubBtn">CLUB</button><button class="gQuit">✕</button>
      <div class="gHint">Aim with the stick · SWING: tap for power, tap again in the white</div>
      <div class="gCard"><div class="gCardT"></div><table class="gTab"></table><div class="gCardS"></div><button class="gAgain">Play again</button><button class="gDone">Done</button></div>`;
    const st = document.createElement('style');
    st.textContent = `
      #golfUi { position: absolute; inset: 0; z-index: 35; display: none; pointer-events: none; font: 800 14px -apple-system, Helvetica, sans-serif; color: #fff; }
      #golfUi.show { display: block; }
      body.golfOn #hud, body.golfOn #pad, body.golfOn #topBtns { display: none !important; }
      #golfUi .gTop { position: absolute; top: calc(12px + var(--safe-t, 0px)); left: 50%; transform: translateX(-50%); display: flex; gap: 16px; white-space: nowrap;
        background: rgba(16,40,24,.66); padding: 8px 16px; border-radius: 999px; letter-spacing: .05em; }
      #golfUi .gWind { position: absolute; top: calc(12px + var(--safe-t, 0px)); left: calc(16px + var(--safe-l, 0px)); width: 64px; text-align: center;
        background: rgba(16,40,24,.66); border-radius: 12px; padding: 6px 0; }
      #golfUi .gArrow { font-size: 24px; display: inline-block; transition: transform .2s; }
      #golfUi .gWs { font-size: 11px; opacity: .85; }
      #golfUi .gClub { position: absolute; left: calc(16px + var(--safe-l, 0px)); bottom: calc(20px + var(--safe-b, 0px)); background: rgba(16,40,24,.66); border-radius: 12px; padding: 8px 12px; }
      #golfUi .gCn { font-size: 16px; } #golfUi .gCc, #golfUi .gLie { font-size: 11px; opacity: .85; margin-top: 2px; }
      #golfUi .gMeter { position: absolute; left: 50%; bottom: calc(26px + var(--safe-b, 0px)); width: 52vw; height: 20px; transform: translateX(-50%);
        background: rgba(10,20,14,.6); border: 2px solid #fff5; border-radius: 10px; overflow: hidden; }
      #golfUi .gFill { position: absolute; left: 0; top: 0; bottom: 0; width: 0; background: linear-gradient(90deg, #4fd07a, #f7d046 70%, #f06a3a); }
      #golfUi .gSweet { position: absolute; top: 0; bottom: 0; left: 8%; width: 4%; background: #ffffffcc; display: none; }
      #golfUi .gNeedle { position: absolute; top: -3px; bottom: -3px; width: 4px; left: 0; background: #fff; box-shadow: 0 0 6px #fff; display: none; }
      #golfUi .gMsg { position: absolute; top: 24%; width: 100%; text-align: center; font-size: 40px; font-weight: 900; text-shadow: 0 4px 16px #000b; opacity: 0; transition: opacity .15s; }
      #golfUi .gMsg.on { opacity: 1; }
      #golfUi button { pointer-events: auto; -webkit-tap-highlight-color: transparent; touch-action: manipulation; border: none; color: #fff; font: 900 15px -apple-system, Helvetica, sans-serif; }
      #golfUi .gSwing { position: absolute; right: calc(22px + var(--safe-r, 0px)); bottom: calc(34px + var(--safe-b, 0px)); width: 108px; height: 108px; border-radius: 50%;
        background: radial-gradient(circle at 40% 35%, #52b36a, #2c7a42); box-shadow: 0 6px 0 #1a4a28; letter-spacing: .06em; }
      #golfUi .gSwing:active { transform: translateY(4px); box-shadow: 0 2px 0 #1a4a28; }
      #golfUi .gClubBtn { position: absolute; right: calc(142px + var(--safe-r, 0px)); bottom: calc(46px + var(--safe-b, 0px)); width: 64px; height: 64px; border-radius: 50%; background: rgba(16,40,24,.75); }
      #golfUi .gQuit { position: absolute; top: calc(12px + var(--safe-t, 0px)); right: calc(16px + var(--safe-r, 0px)); width: 40px; height: 40px; border-radius: 50%; background: rgba(16,40,24,.66); }
      #golfUi .gHint { position: absolute; left: 0; right: 0; bottom: calc(52px + var(--safe-b, 0px)); text-align: center; font-size: 12px; opacity: .8; text-shadow: 0 1px 6px #000; }
      #golfUi .gCard { position: absolute; inset: 0; display: none; flex-direction: column; align-items: center; justify-content: center; gap: 10px; background: rgba(8,20,12,.6); pointer-events: auto; }
      #golfUi .gCard.on { display: flex; }
      #golfUi .gCardT { font-size: 32px; font-weight: 900; }
      #golfUi .gTab { border-collapse: collapse; font-size: 15px; } #golfUi .gTab td { padding: 5px 12px; border: 1px solid #fff4; text-align: center; }
      #golfUi .gCardS { font-size: 14px; opacity: .88; margin-bottom: 6px; }
      #golfUi .gAgain, #golfUi .gDone { padding: 11px 30px; border-radius: 999px; background: #2c7a42; }
      #golfUi .gDone { background: rgba(255,255,255,.18); }`;
    document.head.appendChild(st);
    document.getElementById('app').appendChild(d);
    this.el = d;
    const q = (s) => d.querySelector(s);
    this.ui = { hole: q('.gHole'), shot: q('.gShot'), dist: q('.gDist'), arrow: q('.gArrow'), ws: q('.gWs'), cn: q('.gCn'), cc: q('.gCc'), lie: q('.gLie'),
      meter: q('.gMeter'), fill: q('.gFill'), sweet: q('.gSweet'), needle: q('.gNeedle'), msg: q('.gMsg'), hint: q('.gHint'),
      card: q('.gCard'), cardT: q('.gCardT'), tab: q('.gTab'), cardS: q('.gCardS'), clubBtn: q('.gClubBtn') };
    q('.gSwing').addEventListener('pointerdown', (e) => { e.preventDefault(); e.stopPropagation(); this.tap(); });
    q('.gClubBtn').addEventListener('pointerdown', (e) => { e.preventDefault(); e.stopPropagation(); this.nextClub(); });
    q('.gQuit').addEventListener('pointerdown', (e) => { e.preventDefault(); e.stopPropagation(); this.close(); });
    q('.gAgain').addEventListener('click', () => this._round());
    q('.gDone').addEventListener('click', () => this.close());
    window.addEventListener('keydown', (e) => {
      if (!this.active || e.repeat) return;
      if (e.code === 'Space' || e.code === 'Enter') this.tap();
      else if (e.code === 'KeyC') this.nextClub();
      else if (e.code === 'Escape') this.close();
      else return;
      e.preventDefault(); e.stopPropagation();
    }, true);
  }

  _msg(s, col, t = 1.6) {
    this.ui.msg.textContent = s;
    this.ui.msg.style.color = col || '#fff';
    this.ui.msg.classList.toggle('on', !!s);
    this._msgT = t;
  }

  // --- the round ----------------------------------------------------------------------

  /** ENTER on foot on (or by) the first tee? */
  near(pl) {
    const t = HOLES[0].tee;
    return Math.hypot(pl.x - t.x, pl.z - t.z) < 8 && Math.abs(pl.y - G.terrainHeight(t.x, t.z)) < 3;
  }

  start(env) {
    this.env = env;              // { camera, player, bones }
    this.fov0 = env.camera.fov;
    document.body.classList.add('golfOn');
    this.el.classList.add('show');
    this.club.visible = true;
    this._round();
  }

  _round() {
    this.scores = [];
    this.holeIndex = 0;
    this.aces = 0;
    this.ui.card.classList.remove('on');
    this._hole(0);
  }

  _hole(i) {
    const h = HOLES[i];
    this.h = h;
    this.holeIndex = i;
    this.strokes = 0;
    // a breeze for the hole: 0-6 m/s from anywhere
    const wa = Math.random() * Math.PI * 2, ws = Math.random() * 6;
    this.wind = { x: Math.cos(wa) * ws, z: Math.sin(wa) * ws, s: ws };
    this._placeBall(h.tee.x + h.ux * 0.6, h.tee.z + h.uz * 0.6);
    this.aim = Math.atan2(h.pin.x - this.bx, h.pin.z - this.bz);
    this._msg(`HOLE ${h.n} · PAR 3 · ${Math.round(h.L * YD)} YDS`, '#fff', 2.2);
    this._ready();
  }

  _placeBall(x, z) {
    this.bx = x; this.bz = z;
    this.by = this._ground(x, z) + BALL_R;
    this.ball.position.set(x, this.by + (BALL_DRAW - BALL_R), z);
    this.ball.visible = true;
  }

  _ground(x, z) {
    const s = surfaceAt(this.h, x, z);
    // what is drawn there: the grass layer at 4.5 cm, the sand over it at 6
    return G.terrainHeight(x, z) + (s === 'rough' ? 0 : s === 'bunker' ? 0.06 : 0.045);
  }

  /** Set up for the next stroke: pick the club, face the pin. */
  _ready() {
    const h = this.h;
    const dist = Math.hypot(h.pin.x - this.bx, h.pin.z - this.bz);
    this.lie = surfaceAt(h, this.bx, this.bz);
    if (this.lie === 'green' || (this.lie === 'fringe' && dist < 12)) this.clubI = 4;
    else {
      // the shortest club that carries the distance, leaving room for the run
      this.clubI = 3;
      for (let k = 0; k < 4; k++) if (CLUBS[k].carry * 0.93 <= dist + 4) { this.clubI = k; break; }
      if (CLUBS[0].carry < dist) this.clubI = 0;
    }
    if (this.lie !== 'green') this.aim = Math.atan2(h.pin.x - this.bx, h.pin.z - this.bz);
    this.state = 'aim';
    this.power = 0; this.acc = 0; this.t = 0;
    this._hud();
  }

  nextClub() {
    if (this.state !== 'aim') return;
    this.clubI = (this.clubI + 1) % CLUBS.length;
    this._hud();
  }

  _hud() {
    const h = this.h, dist = Math.hypot(h.pin.x - this.bx, h.pin.z - this.bz);
    const c = CLUBS[this.clubI];
    this.ui.hole.textContent = `HOLE ${h.n} · PAR ${h.par}`;
    this.ui.shot.textContent = `STROKE ${this.strokes + 1}`;
    this.ui.dist.textContent = dist > 30 ? `${Math.round(dist * YD)} YDS` : `${dist.toFixed(1)} M`;
    this.ui.cn.textContent = c.name;
    this.ui.cc.textContent = c.carry ? `${Math.round(c.carry * YD)} yds full` : 'tap for pace';
    this.ui.lie.textContent = `lie: ${this.lie}`;
    // wind: an arrow turned to where it blows, as seen from behind the ball
    const rel = Math.atan2(this.wind.x, this.wind.z) - this.aim;
    this.ui.arrow.style.transform = `rotate(${(-rel * 180 / Math.PI) - 90}deg)`;
    this.ui.ws.textContent = `${Math.round(this.wind.s * 2.237)} MPH`;
  }

  tap() {
    if (this.state === 'aim') { this.state = 'power'; this.t = 0; }
    else if (this.state === 'power') {
      this.power = this._meter();
      if (this.clubI === 4) { this.acc = 0; this._swing(); }
      else { this.state = 'accuracy'; this.t = 0; }
    } else if (this.state === 'accuracy') {
      this.acc = this._needle();
      this._swing();
    } else if (this.state === 'card') this._round();
  }

  /** The power meter: up to full and back down, ~1.5 s round. */
  _meter() { const u = (this.t / 0.75) % 2; return u < 1 ? u : 2 - u; }
  /** The accuracy needle sweeps back from the power mark to the start; the sweet spot is at 10 %. */
  _needle() { return this.power - this.t / 0.7; }

  _swing() {
    this.state = 'swing'; this.t = 0;
    this.strokes++;
    this._hud();
  }

  _launch() {
    const c = CLUBS[this.clubI], h = this.h;
    this.prev = { x: this.bx, z: this.bz };
    // accuracy: 0.1 is dead on; early (above) hooks left, late (below) slices right
    const err = clamp((this.acc - 0.1) / 0.1, -1.6, 1.6);
    if (this.clubI === 4) {
      // a putt: pace from the meter, straight along the aim
      const sp = 0.5 + this.power * 6.2;
      this.vel = new THREE.Vector3(Math.sin(this.aim) * sp, 0, Math.cos(this.aim) * sp);
      this.spin = 0;
      this.check = 0;
      this.state = 'roll';
      this._sfx('bump', 0.2, 2.2);
      return;
    }
    const lieK = this.lie === 'rough' ? 0.85 : this.lie === 'bunker' ? 0.7 : 1;
    const v0 = this._speedFor(c) * Math.sqrt(clamp(this.power, 0.05, 1)) * lieK * (1 - 0.06 * Math.abs(err));
    const a = c.angle * Math.PI / 180;
    const yaw = this.aim + err * 0.035;
    this.vel = new THREE.Vector3(Math.sin(yaw) * Math.cos(a) * v0, Math.sin(a) * v0, Math.cos(yaw) * Math.cos(a) * v0);
    this.spin = -err * 2.2;           // sidespin: m/s2 of curve, across the flight
    this.state = 'fly'; this.t = 0;
    this.trailN = 0; this.trail.visible = true;
    this._sfx('punch', 0.55, 1.6);
    void h;
  }

  /** Launch speed that carries a club its full distance in still air (bisected once and kept). */
  _speedFor(c) {
    if (c._v) return c._v;
    let lo = 10, hi = 90;
    for (let it = 0; it < 30; it++) {
      const mid = (lo + hi) / 2;
      if (this._carry(mid, c.angle) < c.carry) lo = mid; else hi = mid;
    }
    return (c._v = (lo + hi) / 2);
  }
  _carry(v0, deg) {
    const a = deg * Math.PI / 180, dt = 1 / 120;
    let x = 0, y = 0, vx = Math.cos(a) * v0, vy = Math.sin(a) * v0;
    for (let i = 0; i < 2000; i++) {
      const v = Math.hypot(vx, vy);
      vx -= DRAG * v * vx * dt; vy -= (9.81 + DRAG * v * vy) * dt;
      x += vx * dt; y += vy * dt;
      if (y < 0 && vy < 0) return x;
    }
    return x;
  }

  _flyStep(dt) {
    const h = this.h, P = this.vel, n = 4, sdt = dt / n;
    for (let k = 0; k < n; k++) {
      // air-relative drag, a breeze that grows with height, the curve
      const lift = clamp((this.by - this._ground(this.bx, this.bz)) / 20, 0.3, 1);
      const rx = P.x - this.wind.x * lift, rz = P.z - this.wind.z * lift, ry = P.y;
      const v = Math.hypot(rx, ry, rz);
      P.x -= DRAG * v * rx * sdt; P.y -= (9.81 + DRAG * v * ry) * sdt; P.z -= DRAG * v * rz * sdt;
      const hv = Math.hypot(P.x, P.z) || 1;
      P.x += (P.z / hv) * this.spin * sdt; P.z -= (P.x / hv) * this.spin * sdt;
      this.bx += P.x * sdt; this.by += P.y * sdt; this.bz += P.z * sdt;
      // a trunk in the way knocks it back
      const gy = this._ground(this.bx, this.bz);
      if (this.by - gy < 5) {
        const hit = this.o.city.obstacleHit && this.o.city.obstacleHit(this.bx, this.bz, 0.05, this.by);
        if (hit && hit.pen > 0) { P.x = hit.nx * Math.abs(P.x) * 0.3; P.z = hit.nz * Math.abs(P.z) * 0.3; P.y *= 0.4; this._sfx('thunk', 0.4, 1.4); }
      }
      if (this.by <= gy + BALL_R && P.y < 0) {
        // down: bounce by the surface, then roll
        const s = SURF[surfaceAt(h, this.bx, this.bz)];
        this.by = gy + BALL_R;
        const c = CLUBS[this.clubI];
        P.y = -P.y * s.e;
        // the first bounce takes most of an iron shot's pace, and its
        // backspin checks it for half a second after (_rollStep)
        const keep = (1 - s.e * 0.5) * (0.22 + 0.3 * c.roll);
        P.x *= keep; P.z *= keep;
        this.check = 0.5;
        this._sfx('bump', 0.15, 2);
        if (Math.abs(P.y) < 1.2) { P.y = 0; this.state = 'roll'; }
      }
    }
    this.ball.position.set(this.bx, this.by + (BALL_DRAW - BALL_R), this.bz);
    // the trail
    if (this.trailN < this.trailPos.length / 3) {
      this.trailPos.set([this.bx, this.by, this.bz], this.trailN * 3);
      this.trailN++;
      this.trail.geometry.setDrawRange(0, this.trailN);
      this.trail.geometry.attributes.position.needsUpdate = true;
    } else {
      this.trailPos.copyWithin(0, 3); this.trailPos.set([this.bx, this.by, this.bz], this.trailPos.length - 3);
      this.trail.geometry.attributes.position.needsUpdate = true;
    }
  }

  _rollStep(dt) {
    const h = this.h, P = this.vel, n = 4, sdt = dt / n;
    for (let k = 0; k < n; k++) {
      const kind = surfaceAt(h, this.bx, this.bz), s = SURF[kind];
      // downhill: the terrain's gradient
      const e = 0.5, g0 = G.terrainHeight(this.bx, this.bz);
      const gx = (G.terrainHeight(this.bx + e, this.bz) - g0) / e, gz = (G.terrainHeight(this.bx, this.bz + e) - g0) / e;
      // (0.4: the course is shaped flatter than the 40 m terrain under it)
      P.x -= 9.81 * gx * 0.4 * sdt; P.z -= 9.81 * gz * 0.4 * sdt;
      const sp = Math.hypot(P.x, P.z);
      const checkDec = this.check > 0 ? CLUBS[this.clubI].spin * (kind === 'rough' ? 0.5 : 1) : 0;
      this.check -= sdt;
      const dec = (s.roll + checkDec) * sdt;
      if (sp <= dec) { P.x = 0; P.z = 0; } else { P.x -= (P.x / sp) * dec; P.z -= (P.z / sp) * dec; }
      const nx = this.bx + P.x * sdt, nz = this.bz + P.z * sdt;
      // the cup: slow enough over it and it drops; faster lips out
      const cx = nx - h.pin.x, cz = nz - h.pin.z, cd = Math.hypot(cx, cz);
      if (cd < CUP_R) {
        const spd = Math.hypot(P.x, P.z);
        if (spd < 1.6) { this.bx = h.pin.x; this.bz = h.pin.z; this._holed(); return; }
        // lip out: turned by the rim
        const t = Math.atan2(cz, cx) + Math.PI / 2;
        P.x = Math.cos(t) * spd * 0.7; P.z = Math.sin(t) * spd * 0.7;
      }
      this.bx = nx; this.bz = nz;
      // out of the course's ground (a road, a building): back where it was hit from, a stroke added
      if (this.o.city.onRoad(this.bx, this.bz, 0) || (this.o.world.inBuilding && this.o.world.inBuilding(this.bx, this.bz, 0))) {
        this.strokes++;
        this._msg('OUT OF BOUNDS · +1', '#ff8a6a');
        this._placeBall(this.prev.x, this.prev.z);
        P.set(0, 0, 0);
        this.state = 'rest'; this.t = 0;
        return;
      }
    }
    this.by = this._ground(this.bx, this.bz) + BALL_R;
    this.ball.position.set(this.bx, this.by + (BALL_DRAW - BALL_R), this.bz);
    if (Math.hypot(P.x, P.z) < 0.03) { this.state = 'rest'; this.t = 0; }
  }

  _holed() {
    const s = this.strokes;
    this.ball.visible = false;
    this.state = 'holed'; this.t = 0;
    this.scores.push(s);
    const word = s === 1 ? 'HOLE IN ONE!!' : s === 2 ? 'BIRDIE!' : s === 3 ? 'PAR' : s === 4 ? 'BOGEY' : s === 5 ? 'DOUBLE BOGEY' : `${s} STROKES`;
    const col = s <= 2 ? '#7dffa0' : s === 3 ? '#ffe066' : '#ff9a6a';
    if (s === 1) this.aces++;
    this._msg(word, col, 2.4);
    this._sfx(s <= 2 ? 'pickup' : 'land', 0.5, s <= 2 ? 1 : 1.8);
    if (s === 1) this._sfx('cash', 0.6, 1);
  }

  _card() {
    this.state = 'card';
    const total = this.scores.reduce((a, b) => a + b, 0), rel = total - PAR;
    const pay = Math.max(0, 150 + (PAR - total) * 50) + this.aces * 500;
    if (!this.best || total < this.best) { this.best = total; try { localStorage.setItem('auto-golf-best', String(total)); } catch (e) { /* private */ } }
    this.ui.cardT.textContent = rel < 0 ? `${-rel} under par!` : rel === 0 ? 'Level par' : `${rel} over par`;
    this.ui.tab.innerHTML = `<tr><td>HOLE</td>${HOLES.map((h) => `<td>${h.n}</td>`).join('')}<td>TOTAL</td></tr>`
      + `<tr><td>PAR</td>${HOLES.map(() => '<td>3</td>').join('')}<td>${PAR}</td></tr>`
      + `<tr><td>YOU</td>${this.scores.map((s) => `<td style="color:${s < 3 ? '#7dffa0' : s > 3 ? '#ff9a6a' : '#fff'}">${s}</td>`).join('')}<td>${total}</td></tr>`;
    this.ui.cardS.textContent = `Paid $${pay} · best round ${this.best}`;
    this.ui.card.classList.add('on');
    if (pay > 0 && this.o.onReward) this.o.onReward(pay);
  }

  close() {
    this.state = 'off';
    this.el.classList.remove('show');
    this.ui.card.classList.remove('on');
    document.body.classList.remove('golfOn');
    this.ball.visible = false; this.marker.visible = false; this.trail.visible = false; this.club.visible = false;
    const env = this.env;
    if (env) {
      const P = env.player;
      if (this.fov0) { env.camera.fov = this.fov0; env.camera.updateProjectionMatrix(); }
      P.camYaw = P.heading + Math.PI; P.camFootY = null;
      P.camPos.set(P.x - Math.sin(P.heading) * 4.6, P.y + 1.6, P.z - Math.cos(P.heading) * 4.6);
    }
    if (this.o.onEnd) this.o.onEnd();
  }

  _sfx(name, gain, rate) {
    const a = this.o.audio;
    if (a && a.play) a.play(name, { gain, rate: rate || 1 });
  }

  // --- the golfer ---------------------------------------------------------------------

  /** Stand the golfer at the ball and pose the swing (u: 0 address .. 1 finish). */
  _pose(u, dt) {
    const P = this.env.player;
    const putt = this.clubI === 4;
    // address: side-on to the aim, the ball in front of the feet
    const fx = Math.sin(this.aim), fz = Math.cos(this.aim), rx = fz, rz = -fx;
    const stand = putt ? 0.55 : 0.78;
    P.x = this.bx + rx * stand; P.z = this.bz + rz * stand;
    P.y = G.terrainHeight(P.x, P.z);
    const face = Math.atan2(-rx, -rz);         // facing the ball, side-on to the line
    P.heading = face;
    P.h.group.position.set(P.x, P.y, P.z);
    P.h.group.rotation.y = face;
    animateWalk(P.h, 0, dt, 0);
    // the swing arc: the hands go back and up over the right shoulder, through
    // the ball, and up over the left
    const back = putt ? 0.35 : 1.9, thru = putt ? 0.35 : 2.2;
    let ang;                                    // 0 at address; + back, - through
    if (u <= 0) ang = 0;
    else if (u < 0.45) ang = back * ease(u / 0.45);
    else if (u < 0.6) ang = back - (back + thru * 0.35) * ease((u - 0.45) / 0.15);
    else ang = -thru * 0.35 - thru * 0.65 * ease((u - 0.6) / 0.4);
    const twist = clamp(ang, -2.2, 2) * 0.32;
    // a golfer's bend over the ball, and the turn
    const bones = P.h.bones;
    bones[BONES.spine].rotation.set(putt ? 0.5 : 0.38, twist * 0.5, 0);
    bones[BONES.chest].rotation.set(putt ? 0.15 : 0.1, twist * 0.5, 0);
    bones[BONES.thighL].rotation.x += -0.15; bones[BONES.thighR].rotation.x += -0.15;
    bones[BONES.kneeL].rotation.x += 0.2; bones[BONES.kneeR].rotation.x += 0.2;
    // the grip: a point on a circle round the shoulders in the swing plane
    const r = putt ? 0.72 : 0.78;
    const cy = P.y + (putt ? 1.1 : 1.28);
    const gx = P.x + (this.bx - P.x) * 0.45, gz = P.z + (this.bz - P.z) * 0.45;
    // in the golfer's frame: forward (toward the ball) is -local x of the aim line...
    const toBall = new THREE.Vector3(this.bx - P.x, 0, this.bz - P.z).normalize();
    const along = new THREE.Vector3(fx, 0, fz);      // toward the target
    const grip = new THREE.Vector3(gx, cy, gz)
      .addScaledVector(toBall, -0.08 * (1 - Math.cos(ang)))
      .addScaledVector(along, -Math.sin(ang) * r)
      .add(new THREE.Vector3(0, -Math.cos(ang) * r * 0.6 + r * 0.2, 0));
    P.h.group.updateMatrixWorld(true);
    solveArm(bones[BONES.shoulderL], bones[BONES.elbowL], bones[BONES.handL], grip.clone().addScaledVector(along, 0.03), P.h.group, -1);
    solveArm(bones[BONES.shoulderR], bones[BONES.elbowR], bones[BONES.handR], grip.clone().addScaledVector(along, -0.03).addScaledVector(new THREE.Vector3(0, -1, 0), 0.06), P.h.group, 1);
    // the club: from the grip out along the arc's radius, the head to the ball at address
    const head = new THREE.Vector3(this.bx, this.by - 0.01, this.bz)
      .addScaledVector(along, -Math.sin(ang) * 1.6).add(new THREE.Vector3(0, (1 - Math.cos(ang)) * 1.2, 0));
    const dir = head.clone().sub(grip).normalize();
    this.club.position.copy(grip);
    this.club.quaternion.setFromUnitVectors(new THREE.Vector3(0, -1, 0), dir);
  }

  // --- the frame -----------------------------------------------------------------------

  update(dt) {
    if (!this.active || this.frozen) return;     // (frozen: tools holding a pose for a shot)
    const e = this.env, cam = e.camera, h = this.h;
    this.t += dt;
    if ((this._msgT -= dt) <= 0) this.ui.msg.classList.remove('on');
    // wave the flags
    for (const f of this.flags) {
      const p = f.geometry.attributes.position, base = f.userData.base;
      for (let i = 0; i < p.count; i++) { const x = base[i * 3]; p.setZ(i, Math.sin(this.t * 6 + x * 9) * 0.05 * x / 0.5); }
      p.needsUpdate = true;
      f.rotation.y = Math.atan2(this.wind.x, this.wind.z) - Math.PI / 2;
    }
    const input = this.o.controls ? this.o.controls.read() : { x: 0 };
    const look = this.o.controls ? this.o.controls.takeLook() : { x: 0 };
    if (this.state === 'aim') {
      this.aim -= ((input.x || 0) * 0.5 * dt) + (look.x || 0) * 0.5;
      this._hud();
    }
    // meters
    const m = this.ui;
    if (this.state === 'power') { m.fill.style.width = `${this._meter() * 100}%`; }
    if (this.state === 'accuracy') {
      const n = this._needle();
      m.needle.style.display = 'block'; m.sweet.style.display = 'block';
      m.needle.style.left = `calc(${clamp(n, -0.05, 1) * 100}% - 2px)`;
      if (n < -0.05) { this.acc = n; this._swing(); }
    }
    if (this.state === 'aim') { m.fill.style.width = '0'; m.needle.style.display = 'none'; m.sweet.style.display = this.clubI === 4 ? 'none' : 'block'; }
    // the golfer
    let u = 0;
    if (this.state === 'swing') {
      u = clamp(this.t / (this.clubI === 4 ? 0.8 : 1.1), 0, 1);
      if (u >= 0.52 && !this._hit) { this._hit = true; this._launch(); }
    } else if (this.state === 'fly' || this.state === 'roll') u = 1;
    if (this.state !== 'swing') this._hit = false;
    if (this.state === 'aim' || this.state === 'power' || this.state === 'accuracy' || this.state === 'swing') this._pose(u, dt);
    if (this.state === 'fly') this._flyStep(dt);
    else if (this.state === 'roll') this._rollStep(dt);
    else if (this.state === 'rest' && this.t > 0.9) { this.trail.visible = false; this._ready(); }
    else if (this.state === 'holed' && this.t > 2.4) {
      this.trail.visible = false;
      if (this.holeIndex < HOLES.length - 1) this._hole(this.holeIndex + 1);
      else this._card();
    }
    // the aim marker: where this club carries in still air, on the ground
    const c = CLUBS[this.clubI];
    if (this.state === 'aim' || this.state === 'power' || this.state === 'accuracy') {
      // carry goes as the launch speed squared, and the speed as sqrt(power)
      const pw = this.state === 'aim' ? 1 : this.state === 'power' ? this._meter() : this.power;
      const dist = c.carry ? c.carry * Math.max(0.05, pw) : Math.min(Math.hypot(h.pin.x - this.bx, h.pin.z - this.bz), 30);
      const mx = this.bx + Math.sin(this.aim) * dist, mz = this.bz + Math.cos(this.aim) * dist;
      this.marker.position.set(mx, G.terrainHeight(mx, mz) + 0.12, mz);
      this.marker.scale.setScalar(c.carry ? 1 + dist / 60 : 0.35);
      this.marker.visible = true;
    } else this.marker.visible = false;
    this._camera(dt, cam);
  }

  _camera(dt, cam) {
    const fx = Math.sin(this.aim), fz = Math.cos(this.aim);
    let px, py, pz, lx, ly, lz;
    if (this.state === 'fly' || this.state === 'roll' || this.state === 'rest' || this.state === 'holed') {
      // follow the ball from behind and above, looking down the flight
      const vx = this.vel ? this.vel.x : fx, vz = this.vel ? this.vel.z : fz, hv = Math.hypot(vx, vz) || 1;
      const bx = this.state === 'fly' ? vx / hv : fx, bz = this.state === 'fly' ? vz / hv : fz;
      const back = this.state === 'fly' ? 6 : 8;
      px = this.bx - bx * back; pz = this.bz - bz * back; py = Math.max(this.by, G.terrainHeight(this.bx, this.bz)) + (this.state === 'fly' ? 2 : 4);
      lx = this.bx + bx * 6; lz = this.bz + bz * 6; ly = this.by;
    } else {
      // behind the golfer, down the line
      const putt = this.clubI === 4;
      px = this.bx - fx * (putt ? 3.2 : 4.4); pz = this.bz - fz * (putt ? 3.2 : 4.4);
      py = this.by + (putt ? 1.35 : 1.9);
      lx = this.bx + fx * (putt ? 5 : 25); lz = this.bz + fz * (putt ? 5 : 25);
      ly = G.terrainHeight(lx, lz) + (putt ? 0 : 1.5);
    }
    if (!this._cam) this._cam = { x: px, y: py, z: pz, lx, ly, lz };
    const k = this.state === 'fly' ? 4 : 6, C = this._cam;
    C.x = damp(C.x, px, k, dt); C.y = damp(C.y, py, k, dt); C.z = damp(C.z, pz, k, dt);
    C.lx = damp(C.lx, lx, k * 1.5, dt); C.ly = damp(C.ly, ly, k * 1.5, dt); C.lz = damp(C.lz, lz, k * 1.5, dt);
    cam.position.set(C.x, C.y, C.z);
    // a 4 cm ball is a pixel from 30 m: keep it visible, not true to scale
    this.ball.scale.setScalar(Math.max(1, cam.position.distanceTo(this.ball.position) / 14));
    cam.up.set(0, 1, 0);
    cam.lookAt(C.lx, C.ly, C.lz);
    cam.updateMatrixWorld(true);
  }
}
