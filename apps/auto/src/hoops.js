// BASKETBALL: a painted half court in a few parks, and free throws.
//
// Four parks get a court (Cal Anderson, Judkins, Green Lake, Jefferson): a
// half court to regulation size -- 50 x 47 ft, the key 16 ft wide, the free
// throw line 15 ft from the backboard, the rim at 10 ft -- painted on a slab
// set level on the flattest open ground found near the park's courts, with a
// pole, a glass-white backboard, an orange rim and a net. Stand on the free
// throw line and press ENTER: ten free throws. Tap to stop the aim marker,
// tap to stop the power marker, and the ball flies on real physics against
// the rim and the board -- swishes, rattle-ins, bank shots, rim-outs and
// airballs all fall out of the collisions, nothing is decided in advance.
// A make pays $10, a swish $15, and three in a row doubles it.

import * as THREE from './three.js';
import * as G from './geo.js';
import { clamp } from './util.js';

// `at` is where the search found each court ([x, z, heading]); checked at
// boot, and searched for again only if it no longer passes
export const HOOP_SITES = [
  { name: 'Cal Anderson Park', x: 1404, z: -633, at: [1452, -687, 0] },
  { name: 'Judkins Park', x: 2537, z: 1899, at: [2537, 1791, 0] },
  { name: 'Green Lake', x: 835, z: -7634, at: [901, -7604, 0] },
  { name: 'Jefferson Park', x: 2215, z: 4532, at: [2143, 4532, -Math.PI / 4] },
];

const FT = 0.3048;
const CW = 50 * FT, CL = 47 * FT;            // half court: width, baseline to half-way
const RIM_R = 0.2286, BALL_R = 0.12, RIM_Y = 10 * FT;
const BOARD_IN = 4 * FT;                      // backboard face inside the baseline
const RIM_OFF = 0.15 + RIM_R;                 // rim centre out from the board
const FT_DIST = 15 * FT;                      // free throw line from the board
const SHOTS = 10;
const HEADINGS = [0, Math.PI / 2, Math.PI, -Math.PI / 2, Math.PI / 4, -Math.PI / 4, 3 * Math.PI / 4, -3 * Math.PI / 4];

/** The court's painted surface, drawn once. */
function courtTexture() {
  const PX = 34, M = 0.5;
  const w = Math.round((CW + 2 * M) * PX), h = Math.round((CL + 2 * M) * PX);
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const g = c.getContext('2d');
  // canvas y = 0 is the hoop's end (v = 1)
  const X = (lx) => (lx + CW / 2 + M) * PX, Y = (lz) => (CL / 2 + M - lz) * PX;
  g.fillStyle = '#3a4a46'; g.fillRect(0, 0, w, h);
  g.fillStyle = '#2f7a55'; g.fillRect(X(-CW / 2), Y(CL / 2), CW * PX, CL * PX);
  const base = CL / 2, board = base - BOARD_IN, rim = board - RIM_OFF, ftl = board - FT_DIST;
  // the key, painted
  g.fillStyle = '#1f5a9a'; g.fillRect(X(-8 * FT), Y(base), 16 * FT * PX, (base - ftl) * PX);
  // a little grain so it is not flat plastic
  for (let i = 0; i < 2600; i++) {
    g.fillStyle = `rgba(${Math.random() < 0.5 ? '255,255,255' : '0,0,0'},0.05)`;
    g.fillRect(Math.random() * w, Math.random() * h, 2, 2);
  }
  g.strokeStyle = '#f2f2ea'; g.lineWidth = 2.2;
  g.strokeRect(X(-CW / 2), Y(CL / 2), CW * PX, CL * PX);                 // sidelines, baseline, half way
  g.strokeRect(X(-8 * FT), Y(base), 16 * FT * PX, (base - ftl) * PX);    // the key
  g.beginPath(); g.arc(X(0), Y(ftl), 6 * FT * PX, 0, Math.PI * 2); g.stroke();   // free throw circle
  g.beginPath(); g.arc(X(0), Y(-CL / 2), 6 * FT * PX, Math.PI, Math.PI * 2); g.stroke(); // centre circle
  g.beginPath(); g.arc(X(0), Y(rim), 4 * FT * PX, 0, Math.PI); g.stroke();       // restricted area
  // the three: corners 3 ft in from the sidelines, an arc of 23.75 ft
  const R3 = 23.75 * FT, cx = CW / 2 - 3 * FT;
  const zc = rim - Math.sqrt(R3 * R3 - cx * cx);
  // canvas angles (y down): the corners' ends sit either side of straight down
  const dy = (rim - zc) * PX, aL = Math.atan2(dy, -cx * PX), aR = Math.atan2(dy, cx * PX);
  g.beginPath();
  g.moveTo(X(-cx), Y(base)); g.lineTo(X(-cx), Y(zc));
  g.arc(X(0), Y(rim), R3 * PX, aL, aR, true);
  g.lineTo(X(cx), Y(base));
  g.stroke();
  // hash marks on the key
  for (const d of [7, 8, 11, 14]) for (const s of [-1, 1]) {
    g.beginPath(); g.moveTo(X(s * 8 * FT), Y(board - d * FT)); g.lineTo(X(s * 8.6 * FT), Y(board - d * FT)); g.stroke();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

function ballTexture() {
  const c = document.createElement('canvas'); c.width = 128; c.height = 64;
  const g = c.getContext('2d');
  g.fillStyle = '#d8621e'; g.fillRect(0, 0, 128, 64);
  for (let i = 0; i < 500; i++) { g.fillStyle = 'rgba(0,0,0,0.08)'; g.fillRect(Math.random() * 128, Math.random() * 64, 1, 1); }
  g.strokeStyle = '#1a0e08'; g.lineWidth = 2;
  g.beginPath(); g.moveTo(0, 32); g.lineTo(128, 32); g.stroke();
  for (const x of [32, 96]) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, 64); g.stroke(); }
  g.beginPath(); g.ellipse(64, 32, 20, 32, 0, 0, Math.PI * 2); g.stroke();
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}

export class Hoops {
  constructor(opts) {
    this.o = opts;               // { scene, city, world, audio, onReward, onEnd }
    this.courts = [];
    this._hl = new THREE.Vector3(); this._hr = new THREE.Vector3();
    this.state = 'off';          // off | aim | power | flight | done
    this.best = 0;
    try { this.best = +localStorage.getItem('auto-hoops-best') || 0; } catch (e) { /* private */ }
    this.mats = {
      court: new THREE.MeshStandardMaterial({ map: courtTexture(), roughness: 0.92 }),
      edge: new THREE.MeshStandardMaterial({ color: 0x8a8a84, roughness: 0.95 }),
      pole: new THREE.MeshStandardMaterial({ color: 0x2a3a4a, roughness: 0.5, metalness: 0.6 }),
      board: new THREE.MeshStandardMaterial({ color: 0xf4f4f0, roughness: 0.3 }),
      orange: new THREE.MeshStandardMaterial({ color: 0xe0501a, roughness: 0.45, metalness: 0.3 }),
      net: new THREE.LineBasicMaterial({ color: 0xf0f0f0, transparent: true, opacity: 0.85 }),
    };
    this._place();
    this._buildDom();
  }

  get active() { return this.state !== 'off'; }

  // --- the courts ---------------------------------------------------------------

  _place() {
    const { city, world, scene } = this.o;
    const plats = [];
    for (const site of HOOP_SITES) {
      const sp = this._findSpot(site);
      if (!sp) { console.warn(`hoops: no flat ground at ${site.name}`); continue; }
      const court = this._buildCourt(sp);
      court.name = site.name;
      this.courts.push(court);
      plats.push({ x: sp.x, z: sp.z, hw: CW / 2 + 0.5, hd: CL / 2 + 0.5, rot: -sp.heading, y0: sp.y, y1: sp.y });
      if (city.clearCircles) city.clearCircles.push([sp.x, sp.z, 14]);
    }
    if (plats.length) city.setPlatforms([...(city.platforms || []), ...plats]);
    world.hoopCourts = this.courts;
    void scene;
  }

  /**
   * A court's spot: the one stored with its site if it still passes (a boot
   * costs four checks), else the flattest open ground within 150 m (~30 ms a
   * site on the Mac, 8x that on a phone).
   */
  _findSpot(site) {
    if (site.at) {
      const [x, z, heading] = site.at;
      const sp = this._test(x, z, heading);
      if (sp) return sp;
    }
    let best = null;
    for (let dz = -150; dz <= 150; dz += 6) for (let dx = -150; dx <= 150; dx += 6) {
      const x = site.x + dx, z = site.z + dz;
      if (!G.inPark(x, z) && G.lotAt(x, z) < 0) continue;
      if (this.o.city.onRoad(x, z, 4) || G.isWater(x, z)) continue;
      for (const heading of HEADINGS) {
        const sp = this._test(x, z, heading, best ? best.score : Infinity, Math.hypot(dx, dz));
        if (sp) best = sp;
      }
    }
    if (best) console.info(`hoops: ${site.name} at [${best.x}, ${best.z}, ${+best.heading.toFixed(4)}]`);
    return best;
  }

  /** Level (< 0.6 m of fall), open ground for a court at (x, z) facing heading? */
  _test(x, z, heading, beat = Infinity, dist = 0) {
    const { city, world } = this.o;
    const W2 = CW / 2 + 1.5, L2 = CL / 2 + 1.5;
    const fx = Math.sin(heading), fz = Math.cos(heading), rx = fz, rz = -fx;
    const pts = [];
    let lo = Infinity, hi = -Infinity;
    for (let a = -1; a <= 1; a += 0.5) for (let b = -1; b <= 1; b += 0.5) {
      const px = x + rx * a * W2 + fx * b * L2, pz = z + rz * a * W2 + fz * b * L2;
      const h = G.terrainHeight(px, pz);
      lo = Math.min(lo, h); hi = Math.max(hi, h);
      pts.push(px, pz);
    }
    if (hi - lo > 0.6) return null;
    const score = (hi - lo) * 10 + dist * 0.02;
    if (score >= beat) return null;
    for (let i = 0; i < pts.length; i += 2) {
      if (city.onRoad(pts[i], pts[i + 1], 1.5) || world.inBuilding(pts[i], pts[i + 1], 1.5) || G.isWater(pts[i], pts[i + 1])) return null;
    }
    return { x, z, heading, y: hi + 0.06, lo, score };
  }

  _buildCourt(sp) {
    const { scene } = this.o;
    const g = new THREE.Group();
    g.position.set(sp.x, 0, sp.z);
    g.rotation.y = sp.heading;
    const W2 = CW / 2 + 0.5, L2 = CL / 2 + 0.5;
    // the slab: painted top, concrete sides down to the lowest ground
    const top = new THREE.Mesh(new THREE.PlaneGeometry(2 * W2, 2 * L2), this.mats.court);
    top.rotation.x = -Math.PI / 2;
    top.rotation.z = Math.PI;        // v = 1 (the canvas top) at local +z, the hoop's end
    top.position.y = sp.y;
    top.receiveShadow = true;
    g.add(top);
    const depth = sp.y - sp.lo + 0.3;
    for (const [w, d, x, z] of [[2 * W2, 0.2, 0, L2], [2 * W2, 0.2, 0, -L2], [0.2, 2 * L2, W2, 0], [0.2, 2 * L2, -W2, 0]]) {
      const e = new THREE.Mesh(new THREE.BoxGeometry(w, depth, d), this.mats.edge);
      e.position.set(x, sp.y - depth / 2 - 0.005, z);
      g.add(e);
    }
    // the hoop: a pole behind the baseline, an arm, the board, the rim, a net
    const base = CL / 2, board = base - BOARD_IN, rim = board - RIM_OFF;
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.11, 3.9, 10), this.mats.pole);
    pole.position.set(0, sp.y + 1.95, base + 0.9); pole.castShadow = true; g.add(pole);
    const arm = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.12, base + 0.9 - board), this.mats.pole);
    arm.position.set(0, sp.y + 3.35, (base + 0.9 + board) / 2 + 0.03); g.add(arm);
    const bd = new THREE.Mesh(new THREE.BoxGeometry(6 * FT, 3.5 * FT, 0.04), this.mats.board);
    bd.position.set(0, sp.y + 2.9 + 1.75 * FT, board + 0.02); bd.castShadow = true; g.add(bd);
    // the orange square over the rim and the board's border, as thin bars
    const bar = (w, h, x, y) => { const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, 0.012), this.mats.orange); m.position.set(x, sp.y + y, board - 0.002); g.add(m); };
    const sqW = 2 * FT, sqH = 1.5 * FT, sqY = RIM_Y + 0.03;
    bar(sqW, 0.04, 0, sqY); bar(sqW, 0.04, 0, sqY + sqH); bar(0.04, sqH, -sqW / 2, sqY + sqH / 2); bar(0.04, sqH, sqW / 2, sqY + sqH / 2);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(RIM_R, 0.012, 6, 28), this.mats.orange);
    ring.rotation.x = Math.PI / 2; ring.position.set(0, sp.y + RIM_Y, rim); g.add(ring);
    const brace = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.02, 0.15), this.mats.orange);
    brace.position.set(0, sp.y + RIM_Y, board - 0.075); g.add(brace);
    const net = this._net(); net.position.set(0, sp.y + RIM_Y, rim); g.add(net);
    scene.add(g);
    g.updateMatrixWorld(true);
    const fx = Math.sin(sp.heading), fz = Math.cos(sp.heading);
    const W = (lz) => ({ x: sp.x + fx * lz, z: sp.z + fz * lz });
    const ftl = board - FT_DIST;
    return {
      g, net, x: sp.x, z: sp.z, y: sp.y, heading: sp.heading,
      rim: { ...W(rim), y: sp.y + RIM_Y }, board: { lz: board }, rimLz: rim,
      ft: W(ftl - 0.35),
    };
  }

  /** A net: twelve cords from the rim to a narrower ring, criss-crossed. */
  _net() {
    const P = [], N = 12, r0 = RIM_R * 0.98, r1 = RIM_R * 0.55, dy = -0.42;
    for (let i = 0; i < N; i++) {
      const a = (i / N) * Math.PI * 2, b = ((i + 1) / N) * Math.PI * 2, m = ((i + 0.5) / N) * Math.PI * 2;
      const top = [Math.cos(a) * r0, 0, Math.sin(a) * r0], topB = [Math.cos(b) * r0, 0, Math.sin(b) * r0];
      const mid = [Math.cos(m) * (r0 + r1) / 2, dy / 2, Math.sin(m) * (r0 + r1) / 2];
      const bot = [Math.cos(a) * r1, dy, Math.sin(a) * r1];
      P.push(...top, ...mid, ...topB, ...mid, ...mid, ...bot, ...bot, ...[Math.cos(b) * r1, dy, Math.sin(b) * r1]);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
    return new THREE.LineSegments(geo, this.mats.net);
  }

  /** Show only courts within a few hundred metres (they are small). */
  updateVisibility(px, pz) {
    for (const c of this.courts) c.g.visible = Math.hypot(c.x - px, c.z - pz) < 450;
  }

  // --- the game -----------------------------------------------------------------

  _buildDom() {
    const d = document.createElement('div');
    d.id = 'hoopsUi';
    d.innerHTML = `<div class="hTop"><span class="hShots"></span><span class="hStreak"></span><span class="hCash"></span></div>
      <div class="hMsg"></div>
      <div class="hAim"><div class="hZone"></div><div class="hMark"></div><span>AIM</span></div>
      <div class="hPow"><div class="hZone"></div><div class="hMark"></div><span>POWER</span></div>
      <button class="hShoot">SHOOT</button><button class="hQuit">✕</button>
      <div class="hEnd"><div class="hEndT"></div><div class="hEndS"></div><button class="hAgain">Again</button><button class="hDone">Done</button></div>`;
    const st = document.createElement('style');
    st.textContent = `
      #hoopsUi { position: absolute; inset: 0; z-index: 35; display: none; pointer-events: none; font: 800 14px -apple-system, Helvetica, sans-serif; color: #fff; }
      #hoopsUi.show { display: block; }
      body.hoopsOn #hud, body.hoopsOn #pad, body.hoopsOn #stickZone, body.hoopsOn #lookZone, body.hoopsOn #topBtns { display: none !important; }
      #hoopsUi .hTop { position: absolute; top: calc(12px + var(--safe-t, 0px)); left: 50%; transform: translateX(-50%); display: flex; gap: 18px;
        background: rgba(10,14,20,.6); padding: 8px 16px; border-radius: 999px; letter-spacing: .06em; }
      #hoopsUi .hMsg { position: absolute; top: 26%; width: 100%; text-align: center; font-size: 44px; font-weight: 900; letter-spacing: .04em;
        text-shadow: 0 4px 18px #000a; opacity: 0; transition: opacity .15s, transform .15s; transform: scale(.8); }
      #hoopsUi .hMsg.on { opacity: 1; transform: scale(1); }
      #hoopsUi .hAim { position: absolute; left: 50%; bottom: calc(26px + var(--safe-b, 0px)); width: 46vw; height: 18px; transform: translateX(-50%);
        background: rgba(10,14,20,.6); border-radius: 9px; border: 2px solid #fff4; }
      #hoopsUi .hPow { position: absolute; right: calc(150px + var(--safe-r, 0px)); bottom: calc(70px + var(--safe-b, 0px)); width: 18px; height: 42vh;
        background: rgba(10,14,20,.6); border-radius: 9px; border: 2px solid #fff4; }
      #hoopsUi .hZone { position: absolute; background: #4fd07a88; border-radius: 6px; }
      #hoopsUi .hAim .hZone { left: 42%; width: 16%; top: 0; bottom: 0; }
      #hoopsUi .hPow .hZone { bottom: 42%; height: 16%; left: 0; right: 0; }
      #hoopsUi .hMark { position: absolute; background: #ffd23a; box-shadow: 0 0 8px #ffd23a; border-radius: 3px; }
      #hoopsUi .hAim .hMark { top: -4px; bottom: -4px; width: 6px; }
      #hoopsUi .hPow .hMark { left: -4px; right: -4px; height: 6px; }
      #hoopsUi .hAim span, #hoopsUi .hPow span { position: absolute; font-size: 10px; letter-spacing: .12em; opacity: .75; }
      #hoopsUi .hAim span { top: -16px; left: 0; } #hoopsUi .hPow span { top: -16px; left: -12px; }
      #hoopsUi .hDim { opacity: .3; }
      #hoopsUi button { pointer-events: auto; -webkit-tap-highlight-color: transparent; touch-action: manipulation; border: none; color: #fff; font: 900 16px -apple-system, Helvetica, sans-serif; }
      #hoopsUi .hShoot { position: absolute; right: calc(24px + var(--safe-r, 0px)); bottom: calc(40px + var(--safe-b, 0px)); width: 104px; height: 104px;
        border-radius: 50%; background: radial-gradient(circle at 40% 35%, #f07a3a, #c0461a); box-shadow: 0 6px 0 #7a2a0a; letter-spacing: .06em; }
      #hoopsUi .hShoot:active { transform: translateY(4px); box-shadow: 0 2px 0 #7a2a0a; }
      #hoopsUi .hQuit { position: absolute; top: calc(12px + var(--safe-t, 0px)); right: calc(16px + var(--safe-r, 0px)); width: 40px; height: 40px; border-radius: 50%; background: rgba(10,14,20,.6); }
      #hoopsUi .hEnd { position: absolute; inset: 0; display: none; flex-direction: column; align-items: center; justify-content: center; gap: 10px; background: rgba(8,12,16,.55); pointer-events: auto; }
      #hoopsUi .hEnd.on { display: flex; }
      #hoopsUi .hEndT { font-size: 40px; font-weight: 900; } #hoopsUi .hEndS { font-size: 16px; opacity: .85; margin-bottom: 8px; }
      #hoopsUi .hAgain, #hoopsUi .hDone { padding: 12px 34px; border-radius: 999px; background: #e0602a; }
      #hoopsUi .hDone { background: rgba(255,255,255,.18); }`;
    document.head.appendChild(st);
    document.getElementById('app').appendChild(d);
    this.el = d;
    const q = (s) => d.querySelector(s);
    this.ui = { shots: q('.hShots'), streak: q('.hStreak'), cash: q('.hCash'), msg: q('.hMsg'), aim: q('.hAim'), pow: q('.hPow'),
      aimM: q('.hAim .hMark'), powM: q('.hPow .hMark'), end: q('.hEnd'), endT: q('.hEndT'), endS: q('.hEndS') };
    const tap = (e) => { e.preventDefault(); e.stopPropagation(); this._tap(); };
    q('.hShoot').addEventListener('pointerdown', tap);
    q('.hQuit').addEventListener('pointerdown', (e) => { e.preventDefault(); e.stopPropagation(); this.close(); });
    q('.hAgain').addEventListener('click', () => this._round());
    q('.hDone').addEventListener('click', () => this.close());
    window.addEventListener('keydown', (e) => {
      if (!this.active) return;
      if (e.code === 'Space' || e.code === 'Enter') { this._tap(); }
      else if (e.code === 'Escape') this.close();
      else return;
      e.preventDefault(); e.stopPropagation();
    }, true);
  }

  /** ENTER on the free throw line of a court? */
  near(pl) {
    for (const c of this.courts) if (Math.hypot(pl.x - c.ft.x, pl.z - c.ft.z) < 2.4 && Math.abs(pl.y - c.y) < 2) return c;
    return null;
  }

  /** env = { camera, player, bones: { shoulderL/R, elbowL/R, handL/R } } */
  start(court, env) {
    this.court = court;
    this.env = env;
    const P = env.player;
    P.x = court.ft.x; P.z = court.ft.z; P.y = court.y; P.heading = court.heading;
    P.h.group.position.set(P.x, P.y, P.z);
    P.h.group.rotation.y = court.heading;
    if (!this.ball) {
      this.ball = new THREE.Mesh(new THREE.SphereGeometry(BALL_R, 20, 14), new THREE.MeshStandardMaterial({ map: ballTexture(), roughness: 0.75 }));
      this.ball.castShadow = true;
    }
    this.o.scene.add(this.ball);
    this.el.classList.add('show');
    document.body.classList.add('hoopsOn');
    // a tighter lens: at the chase camera's the rim is a few pixels on a phone
    this.fov = env.camera.fov;
    env.camera.fov = 44;
    env.camera.updateProjectionMatrix();
    this._round();
  }

  _round() {
    this.shot = 0; this.made = 0; this.streak = 0; this.cash = 0; this.swishes = 0;
    this.ui.end.classList.remove('on');
    this._next();
  }

  _next() {
    this.state = 'aim';
    this.t = 0;
    this.aim = 0; this.pow = 0;
    this.touched = { rim: false, board: false };
    this.result = null;
    this._hud();
    this._msg('');
  }

  _hud() {
    this.ui.shots.textContent = `SHOT ${Math.min(this.shot + 1, SHOTS)}/${SHOTS} · ${this.made} MADE`;
    this.ui.streak.textContent = this.streak >= 2 ? `🔥 ${this.streak} IN A ROW` : '';
    this.ui.cash.textContent = `$${this.cash}`;
  }

  _msg(s, col) {
    this.ui.msg.textContent = s;
    this.ui.msg.style.color = col || '#fff';
    this.ui.msg.classList.toggle('on', !!s);
  }

  _tap() {
    if (this.state === 'aim') { this.aimLock = this.aim; this.state = 'power'; this.t = 0; }
    else if (this.state === 'power') { this.powLock = this.pow; this._shoot(); }
  }

  close() {
    this.state = 'off';
    this.el.classList.remove('show');
    document.body.classList.remove('hoopsOn');
    this.ui.end.classList.remove('on');
    if (this.fov) { this.env.camera.fov = this.fov; this.env.camera.updateProjectionMatrix(); this.fov = 0; }
    if (this.ball) this.o.scene.remove(this.ball);
    if (this.o.onEnd) this.o.onEnd();
  }

  _shoot() {
    const c = this.court;
    const from = this.ball.position.clone();
    // aim a few cm past the centre, as a shooter does: short is the front rim
    const fx = Math.sin(c.heading), fz = Math.cos(c.heading);
    const to = new THREE.Vector3(c.rim.x + fx * 0.025, c.rim.y, c.rim.z + fz * 0.025);
    const dx = to.x - from.x, dz = to.z - from.z, D = Math.hypot(dx, dz), dh = to.y - from.y;
    const th = 56 * Math.PI / 180, g = 9.81;
    const v0 = Math.sqrt(g * D * D / (2 * Math.cos(th) ** 2 * (D * Math.tan(th) - dh)));
    // The markers' error. Inside the green zone (|e| < 0.16) the ball stays
    // in the few cm a 24 cm ball has through a 46 cm rim: a swish or a roll
    // in. The cubic term sends a marker stopped near its end way off.
    const ea = this.aimLock, ep = this.powLock;
    const yaw = Math.atan2(dx, dz) + ea * 0.045 + ea ** 3 * 0.06;
    const sp = v0 * (1 + ep * 0.032 + ep ** 3 * (ep > 0 ? 0.14 : 0.05));
    this.bv = new THREE.Vector3(Math.sin(yaw) * Math.cos(th) * sp, Math.sin(th) * sp, Math.cos(yaw) * Math.cos(th) * sp);
    this.bp = from.clone();
    this.state = 'flight';
    this.t = 0;
    this.madeThis = false;
    this.spin = 0;
  }

  _flight(dt) {
    const c = this.court, g = 9.81;
    const fx = Math.sin(c.heading), fz = Math.cos(c.heading);
    const rimC = new THREE.Vector3(c.rim.x, c.rim.y, c.rim.z);
    const boardZ = c.board.lz;        // along the court's axis from its centre
    const steps = 6, h = dt / steps;
    for (let i = 0; i < steps; i++) {
      const prevY = this.bp.y;
      this.bv.y -= g * h;
      this.bp.addScaledVector(this.bv, h);
      // the rim: the nearest point of the ring to the ball
      const ox = this.bp.x - rimC.x, oz = this.bp.z - rimC.z, oh = Math.hypot(ox, oz) || 1e-6;
      const qx = rimC.x + ox / oh * RIM_R, qz = rimC.z + oz / oh * RIM_R;
      const nx = this.bp.x - qx, ny = this.bp.y - rimC.y, nz = this.bp.z - qz, nd = Math.hypot(nx, ny, nz);
      if (nd < BALL_R + 0.012) {
        const ux = nx / nd, uy = ny / nd, uz = nz / nd;
        const vn = this.bv.x * ux + this.bv.y * uy + this.bv.z * uz;
        if (vn < 0) { this.bv.x -= 1.45 * vn * ux; this.bv.y -= 1.45 * vn * uy; this.bv.z -= 1.45 * vn * uz; this.bv.multiplyScalar(0.88); }
        const push = BALL_R + 0.012 - nd;
        this.bp.x += ux * push; this.bp.y += uy * push; this.bp.z += uz * push;
        if (!this.touched.rim) this._clank(0.5);
        this.touched.rim = true;
      }
      // the board: its plane along the court's axis
      const lz = (this.bp.x - c.x) * fx + (this.bp.z - c.z) * fz;
      const lx = (this.bp.x - c.x) * fz - (this.bp.z - c.z) * fx;
      const vz = this.bv.x * fx + this.bv.z * fz;
      if (lz > boardZ - BALL_R && vz > 0 && Math.abs(lx) < 3 * FT && this.bp.y > c.y + 2.9 && this.bp.y < c.y + 2.9 + 3.5 * FT) {
        this.bv.x -= 1.6 * vz * fx; this.bv.z -= 1.6 * vz * fz;
        this.bv.multiplyScalar(0.85);
        if (!this.touched.board) this._clank(0.3);
        this.touched.board = true;
      }
      // through the hoop: crossing the rim's plane going down, inside it
      if (!this.madeThis && prevY >= rimC.y && this.bp.y < rimC.y && Math.hypot(ox, oz) < RIM_R - BALL_R * 0.4) {
        this.madeThis = true;
        this.netT = 0;
      }
      // the court
      if (this.bp.y < c.y + BALL_R) { this.bp.y = c.y + BALL_R; if (this.bv.y < 0) this.bv.y *= -0.62; this.bv.x *= 0.9; this.bv.z *= 0.9; }
    }
    this.spin += dt * 9;
    this.ball.position.copy(this.bp);
    this.ball.rotation.set(-this.spin, c.heading, 0);
    if (this.netT != null && this.netT < 0.6) {
      this.netT += dt;
      const k = 1 + Math.sin(this.netT * 22) * 0.18 * (1 - this.netT / 0.6);
      c.net.scale.set(1 / k, k, 1 / k);
    }
    const settled = this.t > 1 && (this.bp.y < c.y + 0.6 || this.madeThis);
    if (!this.result && (settled || this.t > 3.2)) this._score();
    if (this.result && this.t - this.result.t > 1.3) {
      c.net.scale.set(1, 1, 1);
      this.netT = null;
      this.shot++;
      if (this.shot >= SHOTS) this._end(); else this._next();
    }
  }

  _clank(v) {
    const a = this.o.audio;
    if (a && a.play) a.play('thunk', { gain: v, rate: 1.6 });
  }

  _score() {
    const made = this.madeThis;
    let word, col = '#fff';
    if (made) {
      this.made++; this.streak++;
      const swish = !this.touched.rim && !this.touched.board;
      if (swish) this.swishes++;
      let pay = swish ? 15 : 10;
      if (this.streak >= 3) pay *= 2;
      this.cash += pay;
      word = swish ? 'SWISH!' : this.touched.board && !this.touched.rim ? 'BANK!' : 'IN!';
      col = swish ? '#7dff9a' : '#ffd23a';
      if (this.streak >= 3) word += ` ×2`;
      const a = this.o.audio;
      if (a && a.play) a.play('pickup', { gain: 0.45 });
    } else {
      this.streak = 0;
      word = this.touched.rim ? 'RIM OUT' : this.touched.board ? 'OFF THE GLASS' : this.bp.distanceTo(new THREE.Vector3(this.court.rim.x, this.court.rim.y, this.court.rim.z)) > 1.2 ? 'AIRBALL!' : 'MISS';
      col = '#ff8a6a';
    }
    this.result = { made, t: this.t };
    this._msg(word, col);
    this._hud();
  }

  _end() {
    this.state = 'done';
    this._msg('');
    if (this.made > this.best) { this.best = this.made; try { localStorage.setItem('auto-hoops-best', String(this.best)); } catch (e) { /* private */ } }
    this.ui.endT.textContent = `${this.made} of ${SHOTS}`;
    this.ui.endS.textContent = `${this.swishes} swish${this.swishes === 1 ? '' : 'es'} · earned $${this.cash} · best ${this.best} of ${SHOTS}`;
    this.ui.end.classList.add('on');
    if (this.cash > 0 && this.o.onReward) this.o.onReward(this.cash);
  }

  update(dt) {
    if (!this.active) return;
    const c = this.court, e = this.env, b = e.bones, P = e.player;
    this.t += dt;
    // the markers sweep, faster on a streak
    const sw = 2.3 + Math.min(this.streak, 6) * 0.35;
    if (this.state === 'aim') this.aim = Math.sin(this.t * sw);
    if (this.state === 'power') this.pow = Math.sin(this.t * sw * 1.1 - Math.PI / 2);
    this.ui.aimM.style.left = `calc(${50 + (this.state === 'aim' ? this.aim : this.aimLock) * 48}% - 3px)`;
    this.ui.powM.style.bottom = `calc(${50 + (this.state === 'power' || this.state === 'aim' ? this.pow : this.powLock) * 48}% - 3px)`;
    this.ui.aim.classList.toggle('hDim', this.state !== 'aim');
    this.ui.pow.classList.toggle('hDim', this.state !== 'power');
    // the shooter: ball up over the head while aiming, arms through on release
    const shooting = this.state === 'flight' && this.t < 0.35;
    const up = this.state === 'aim' || this.state === 'power';
    const sh = up ? -2.45 : shooting ? -2.9 : -0.2, el = up ? -1.5 : shooting ? -0.15 : -0.3;
    for (const [s, e2] of [[b.shoulderL, b.elbowL], [b.shoulderR, b.elbowR]]) { s.rotation.set(sh, 0, 0); e2.rotation.set(el, 0, 0); }
    P.h.group.updateMatrixWorld(true);
    if (up) {
      // held between the palms, a ball's radius over them
      b.handL.getWorldPosition(this._hl); b.handR.getWorldPosition(this._hr);
      this.ball.position.addVectors(this._hl, this._hr).multiplyScalar(0.5);
      this.ball.position.y += BALL_R * 0.9;
    }
    if (this.state === 'flight') this._flight(dt);
    // the camera: behind and a little to one side of the shooter, on the rim
    const fx = Math.sin(c.heading), fz = Math.cos(c.heading), rx = fz, rz = -fx;
    const cam = e.camera;
    cam.position.set(c.ft.x - fx * 2.6 + rx * 0.8, c.y + 2.45, c.ft.z - fz * 2.6 + rz * 0.8);
    cam.lookAt(c.rim.x, c.rim.y - 0.75, c.rim.z);
    cam.updateMatrixWorld(true);
  }
}
