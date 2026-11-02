// Auto KW: TWO WINTER JOBS -- the Region's snowplow route and the Aud's Zamboni.
//
// SNOWPLOW. A Region of Waterloo plow (orange, vehicles.js `snowplow`) stands in the Region's
// roads yard (OSM "Regional Municipality of Waterloo"); the plows that roam the streets in a
// storm count too. In one, with snow ON THE GROUND (weather.cover), press MISSION (M, the pad's
// D-pad down, or the touch button beside the pad): a route of 8-20 connected street segments
// within a km or two lights up on the minimap (a magenta line and a pin) with an amber beam at the
// next segment's end and a panel with an arrow and a distance. Drive along each segment to clear
// it: the blade is DOWN while you are on a route street (and then governed to 40 km/h, as a plow
// is), throws a spray of snow off both corners, lays a bare dark strip with a white windrow down
// each side (ONE pooled mesh of at most MAXS samples, grown as you drive, one draw), and the
// beacon flashes. A segment is cleared when 85 % of it has been ploughed; each pays $25 + $0.35 a
// metre; clear them all inside the clock for a $150 + time bonus. No snow, no job: "come back in
// a storm" (WINTERISCOMING cheats snow for 90 s). Traffic queues behind you like behind any slow
// vehicle (it follows the vehicle ahead, the player's included).
//
// ZAMBONI. The Zamboni on the Aud's forecourt (main.js spawns it): in it, MISSION puts a pop-up
// 42 x 20 m rink on the nearest open ground (kwfun.openGround, ONLY while you play; boards are one
// InstancedMesh, the ice one canvas-textured plane) and you resurface it: 90 s, the conditioner
// under the tail lays glossy fresh ice 3 m wide (a 256 x 128 canvas, redrawn only when you move),
// the boards keep you in. 95 % coverage ends it early; the score is coverage x neatness (cells
// re-covered after 3 s are overlap) plus a time bonus; the crowd cheers by how it went. Best in
// localStorage `autokw-zamboni`. Nothing is held; the machine goes back to the apron after.
//
// Phone cost: NOTHING while idle (two parked rigs; this module only reads the controls). Plow
// job: +1 draw (the strip, <= 18k verts) +1 beam +2 beacon lamps. Zamboni job: +1 draw (ice) +1
// (boards, 62 instances) + 1 canvas upload per moving frame, all freed on the way out.
//
// Harness: __dbg.winter (`plow`, `zam`), the probe is tools/kw/winterprobe.mjs.

import * as THREE from './three.js';
import * as G from './geo.js';
import { openGround } from './kwfun.js';
import { clamp, formatMoney } from './util.js';

const KEY_P = 'autokw-snowplow', KEY_Z = 'autokw-zamboni';
const read = (k) => { try { return JSON.parse(localStorage.getItem(k) || '{}') || {}; } catch (e) { return {}; } };
const write = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* private mode */ } };
const fmt = (d) => (d > 1000 ? (d / 1000).toFixed(1) + ' km' : Math.round(d / 10) * 10 + ' m');
const clock = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
const ARROWS = ['↑', '↗', '→', '↘', '↓', '↙', '←', '↖'];

/** The Region's roads yard (OSM building "Regional Municipality of Waterloo"): two plows. */
export const PLOW_YARDS = [
  { name: 'Region of Waterloo · Roads Operations', x: 6871.1, z: 4090.8, rigs: ['snowplow', 'snowplow'] },
];
/** The Aud's Zamboni (main.js spawns it here). */
export const AUD = { x: 532, z: 575, heading: -Math.PI / 2 };

/** The arrow glyph for a target (dx, dz) seen from a vehicle heading h. */
export function arrowFor(dx, dz, h) {
  const fwd = dx * Math.sin(h) + dz * Math.cos(h), right = dx * Math.cos(h) - dz * Math.sin(h);
  return ARROWS[((Math.round(Math.atan2(right, fwd) / (Math.PI / 4)) % 8) + 8) % 8];
}

// ---------------------------------------------------------------------------------------------
// Shared: the MISSION button, the touch button's visibility, the panel.
// ---------------------------------------------------------------------------------------------

class Job {
  constructor(o) {
    this.o = o; this.scene = o.scene; this.city = o.city; this.game = o.game; this.hud = o.hud; this.audio = o.audio;
    this._obj = '';
  }
  setObj(t) { if (t === this._obj) return; this._obj = t; this.hud.setObjective(t); }
  pay(n) { this.game.money += n; }
  say(t, ms = 3200) { this.hud.showToast(t, ms); }
  ui(n) { if (this.audio && this.audio.ready) this.audio.ui(n); }
  cash() { if (this.audio && this.audio.ready) this.audio.cash(); }
}

// ---------------------------------------------------------------------------------------------
// The snowplow route
// ---------------------------------------------------------------------------------------------

const MAXS = 900;                 // strip samples (one every ~2.5 m of plowing)
const SAMPLE = 2.5;
const BIN = 6, NEED = 0.85;
const PLOW_V = 11.1;              // m/s, the blade-down governor (40 km/h)
const SEG_BASE = 25, SEG_PER_M = 0.35;
const PLOW_CLS = { art: 1, st: 1, res: 1 };

export class SnowPlowJob extends Job {
  /** o: { scene, city, game, hud, audio, fx, panel, weather: () => Weather, wantsPress: () => bool } */
  constructor(o) {
    super(o);
    this.fx = o.fx;
    this.run = null;
    this.stats = Object.assign({ best: 0, segments: 0, earned: 0, runs: 0 }, read(KEY_P));
    this.beamGeo = new THREE.CylinderGeometry(2.4, 2.4, 40, 14, 1, true).translate(0, 20, 0);
    this.beamMat = new THREE.MeshBasicMaterial({ color: 0xffb21e, transparent: true, opacity: 0.32, side: THREE.DoubleSide, forceSinglePass: true, depthWrite: false });
    this.beam = null;
  }

  snowOn() {
    const w = this.o.weather();
    return !!w && w.cover >= 0.5;
  }

  inPlow(player) {
    const v = player.vehicle;
    return !!(v && !player.onFoot && v.spec.plow && !v.dead);
  }

  places(stations) {
    return stations.filter((s) => s.spots.length).map((s) => {
      const sp = s.spots[0];
      return { x: sp.x, z: sp.z, kind: 'winter', label: true, name: s.name.replace(' · ', ' — '), near: false,
        hello: `${s.name.split(' · ')[0]} — snowplows in the yard. Climb in and press MISSION in a snowfall for a plowing route` };
    });
  }

  /** A chain of connected, plowable street segments from near (x, z). */
  buildRoute(x, z, rng = Math.random) {
    const c = this.city;
    const ok = (e) => !e.elev && !e.tunnel && PLOW_CLS[e.cls] && e.len >= 18 && e.len <= 420 && !e.noTraffic;
    const near = c.edgesNear(x, z, 420).filter((ei) => ok(c.edges[ei]));
    if (!near.length) return null;
    const dist = (ei) => { const e = c.edges[ei], a = c.nodes[e.a]; return Math.hypot(a.x + e.dx * e.len / 2 - x, a.z + e.dz * e.len / 2 - z); };
    near.sort((p, q) => dist(p) - dist(q));
    let best = null;
    for (let attempt = 0; attempt < 14 && attempt < near.length; attempt++) {
      const start = near[Math.min(near.length - 1, attempt * 3 + Math.floor(rng() * 3))];
      const goal = 10 + Math.floor(rng() * 7);   // 10-16, <= 20
      const used = new Set([start]);
      const e0 = c.edges[start];
      // enter the start edge from the end nearer the player
      const da = Math.hypot(c.nodes[e0.a].x - x, c.nodes[e0.a].z - z), db = Math.hypot(c.nodes[e0.b].x - x, c.nodes[e0.b].z - z);
      let from = da <= db ? e0.a : e0.b, to = da <= db ? e0.b : e0.a;
      const chain = [{ ei: start, from, to }];
      let dir = { x: c.nodes[to].x - c.nodes[from].x, z: c.nodes[to].z - c.nodes[from].z };
      let dl = Math.hypot(dir.x, dir.z) || 1; dir = { x: dir.x / dl, z: dir.z / dl };
      while (chain.length < goal) {
        const last = chain[chain.length - 1];
        const opts = [];
        for (const ei of c.nodes[last.to].e) {
          if (used.has(ei)) continue;
          const e = c.edges[ei];
          if (!ok(e)) continue;
          const nxt = e.a === last.to ? e.b : e.a;
          const nx = c.nodes[nxt].x - c.nodes[last.to].x, nz = c.nodes[nxt].z - c.nodes[last.to].z, nl = Math.hypot(nx, nz) || 1;
          const dot = (nx * dir.x + nz * dir.z) / nl;
          if (dot < -0.25) continue;
          // do not curl back to within sight of the route's own tail
          opts.push({ ei, nxt, dot, score: dot + rng() * 0.9 });
        }
        if (!opts.length) break;
        opts.sort((p, q) => q.score - p.score);
        const o = opts[0];
        used.add(o.ei);
        chain.push({ ei: o.ei, from: last.to, to: o.nxt });
        const nl = Math.hypot(c.nodes[o.nxt].x - c.nodes[last.to].x, c.nodes[o.nxt].z - c.nodes[last.to].z) || 1;
        dir = { x: (c.nodes[o.nxt].x - c.nodes[last.to].x) / nl, z: (c.nodes[o.nxt].z - c.nodes[last.to].z) / nl };
      }
      if (!best || chain.length > best.length) best = chain;
      if (chain.length >= goal) break;
    }
    if (!best || best.length < 5) return null;
    return best.map((s) => {
      const e = c.edges[s.ei], a = c.nodes[s.from], b = c.nodes[s.to];
      const len = e.len;
      return { ei: s.ei, name: e.name || 'an unnamed street', ax: a.x, az: a.z, bx: b.x, bz: b.z,
        dx: (b.x - a.x) / len, dz: (b.z - a.z) / len, len, hw: e.hw, bins: new Uint8Array(Math.max(1, Math.ceil(len / BIN))), n: 0, done: false };
    });
  }

  begin(player) {
    if (this.run) return false;
    if (!this.snowOn()) { this.say('No snow to clear — come back in a storm', 3200); this.ui('fail'); return false; }
    if (this.game.wanted > 0) { this.say('Lose your wanted level first', 2400); return false; }
    const p = player.position, v = player.vehicle;
    const segs = this.buildRoute(p.x, p.z);
    if (!segs) { this.say('No plowable streets round here — try from a town', 3200); return false; }
    const total = segs.reduce((a, s) => a + s.len, 0);
    this.run = {
      segs, total, t: 0, left: Math.round(total / 6 + 75), T: 0, cleared: 0, paid: 0, v,
      strip: this.makeStrip(), snow: this.makeSnow(segs), last: null, nSamples: 0, blade: false, spray: 0, bacon: this.makeBeacon(v), flash: 0,
    };
    this.run.T = this.run.left;
    this.beam = new THREE.Mesh(this.beamGeo, this.beamMat);
    this.beam.frustumCulled = false; this.beam.userData.winter = 1;
    this.scene.add(this.beam);
    this._wasObj = this.hud.objective ? this.hud.objective.textContent : '';
    this.say(`Snowplow route: ${segs.length} streets, ${fmt(total)} — follow the magenta line`, 3800);
    this.ui('start');
    this.setBtn(true);
    return true;
  }

  makeBeacon(v) {
    const geo = new THREE.BoxGeometry(0.46, 0.2, 0.22);
    const mats = [new THREE.MeshBasicMaterial({ color: 0xffb000, toneMapped: false }), new THREE.MeshBasicMaterial({ color: 0xffb000, toneMapped: false })];
    const meshes = mats.map((m, i) => {
      const me = new THREE.Mesh(geo, m);
      me.position.set(i ? 0.42 : -0.42, v.spec.roof + 0.14, v.spec.len / 2 - 0.9);
      v.tilt.add(me);
      return me;
    });
    return { geo, mats, meshes, v };
  }

  makeStrip() {
    const nv = MAXS * 20, ni = MAXS * 30;
    const pos = new Float32Array(nv * 3), nrm = new Float32Array(nv * 3), col = new Float32Array(nv * 3);
    const idx = new Uint16Array(ni);
    for (let i = 0; i < nv; i++) nrm[i * 3 + 1] = 1;
    for (let q = 0; q < MAXS * 5; q++) {
      const v0 = q * 4, i0 = q * 6;
      idx[i0] = v0; idx[i0 + 1] = v0 + 1; idx[i0 + 2] = v0 + 2; idx[i0 + 3] = v0; idx[i0 + 4] = v0 + 2; idx[i0 + 5] = v0 + 3;
      const white = q % 5 !== 0;
      for (let k = 0; k < 4; k++) {
        const o = (v0 + k) * 3;
        if (white) { col[o] = 0.93; col[o + 1] = 0.96; col[o + 2] = 1.0; } else { col[o] = 0.10; col[o + 1] = 0.115; col[o + 2] = 0.15; }
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    geo.setIndex(new THREE.BufferAttribute(idx, 1));
    geo.setDrawRange(0, 0);
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.2, metalness: 0, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
    mat.userData.wx = 'nosnow';
    mat.customProgramCacheKey = () => 'plowstrip';
    const mesh = new THREE.Mesh(geo, mat);
    mesh.frustumCulled = false; mesh.renderOrder = 2; mesh.userData.winter = 1;
    this.scene.add(mesh);
    return { geo, mat, mesh, pos, prof: new Float32Array(18), have: false, prev: new Float32Array(18) };
  }

  /** The unplowed route: a white quad strip down every route street (one mesh), zeroed as each is cleared. */
  makeSnow(segs) {
    const rows = segs.map((s) => Math.ceil(s.len / 10) + 1);
    const nv = rows.reduce((a, n) => a + n * 2, 0);
    const pos = new Float32Array(nv * 3), nrm = new Float32Array(nv * 3), idx = [];
    let o = 0, base = 0;
    const ranges = segs.map((s, si) => {
      const n = rows[si], rx = s.dz, rz = -s.dx, hw = s.hw + 0.3, v0 = base;
      for (let i = 0; i < n; i++) {
        const t = (i / (n - 1)) * s.len, x = s.ax + s.dx * t, z = s.az + s.dz * t, y = this.city.groundAt(x, z, null) + 0.1;
        for (const sg of [-1, 1]) { pos[o++] = x + rx * hw * sg; pos[o++] = y; pos[o++] = z + rz * hw * sg; }
        if (i) { const a = base + (i - 1) * 2; idx.push(a, a + 1, a + 3, a, a + 3, a + 2); }
      }
      for (let i = 0; i < nv * 3; i += 3) nrm[i + 1] = 1;
      base += n * 2;
      return [v0 * 3, base * 3];
    });
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
    geo.setIndex(idx);
    const mat = new THREE.MeshStandardMaterial({ color: 0xe6edf5, roughness: 0.95, metalness: 0, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 });
    mat.userData.wx = 'nosnow';
    mat.customProgramCacheKey = () => 'plowsnow';
    const mesh = new THREE.Mesh(geo, mat);
    mesh.frustumCulled = false; mesh.renderOrder = 1; mesh.userData.winter = 1;
    this.scene.add(mesh);
    return { geo, mat, mesh, pos, ranges };
  }

  dropSnow(R, si) {
    const [a, b] = R.snow.ranges[si];
    R.snow.pos.fill(0, a, b);
    R.snow.geo.attributes.position.needsUpdate = true;
  }

  /** Lay one sample of strip: the profile at (x, z) across heading (fx, fz), joined to the last. */
  lay(S, x, z, fx, fz, hw) {
    const hs = clamp(hw * 0.85, 1.6, 3.4);
    const rx = fz, rz = -fx;
    const y = this.city.groundAt(x, z, null);
    // L2 L1 L0 R0 R1 R2: [lateral, lift]
    const P = [[-hs - 1.5, 0.1], [-hs - 0.7, 0.55], [-hs, 0.13], [hs, 0.13], [hs + 0.7, 0.55], [hs + 1.5, 0.1]];
    const cur = S.prof;
    for (let k = 0; k < 6; k++) { cur[k * 3] = x + rx * P[k][0]; cur[k * 3 + 1] = y + P[k][1]; cur[k * 3 + 2] = z + rz * P[k][0]; }
    if (S.have && this.run.nSamples < MAXS) {
      const pr = S.prev, pos = S.pos;
      // quads: strip (L0-R0), left ridge (L0-L1, L1-L2), right ridge (R0-R1, R1-R2)
      const pairs = [[2, 3], [2, 1], [1, 0], [3, 4], [4, 5]];
      let o = this.run.nSamples * 20 * 3;
      for (const [i, j] of pairs) {
        const q = [[pr, i], [pr, j], [cur, j], [cur, i]];
        for (const [A, k] of q) { pos[o++] = A[k * 3]; pos[o++] = A[k * 3 + 1]; pos[o++] = A[k * 3 + 2]; }
      }
      this.run.nSamples++;
      S.geo.attributes.position.needsUpdate = true;
      S.geo.setDrawRange(0, this.run.nSamples * 30);
    }
    S.prev.set(cur); S.have = true;
  }

  setBtn(on) {
    if (typeof document === 'undefined') return;
    const b = document.querySelector('[data-btn="winmission"]');
    if (b) b.classList.toggle('on', on);
  }

  /** The route, as the minimap's flat [x, z, ...] polyline from the first uncleared street. */
  routeLine(R) {
    const out = [];
    const i0 = R.segs.findIndex((s) => !s.done);
    if (i0 < 0) return out;
    for (let i = i0; i < R.segs.length; i++) { const s = R.segs[i]; if (i === i0) out.push(s.ax, s.az); out.push(s.bx, s.bz); }
    return out;
  }

  /** Mark bins and report whether the plow is ploughing a route street. */
  mark(R, x, z, speed) {
    let on = false;
    for (const s of R.segs) {
      const rx = x - s.ax, rz = z - s.az;
      const t = rx * s.dx + rz * s.dz, lat = Math.abs(rx * -s.dz + rz * s.dx);
      if (t < -4 || t > s.len + 4 || lat > s.hw + 1.8) continue;
      on = true;
      if (s.done || speed < 1.5) continue;
      const b0 = clamp(Math.floor((t - 3) / BIN), 0, s.bins.length - 1), b1 = clamp(Math.floor((t + 3) / BIN), 0, s.bins.length - 1);
      for (let b = b0; b <= b1; b++) if (!s.bins[b]) { s.bins[b] = 1; s.n++; }
      if (s.n >= Math.ceil(s.bins.length * NEED)) this.clearSeg(R, s);
    }
    return on;
  }

  clearSeg(R, s) {
    s.done = true; R.cleared++;
    this.dropSnow(R, R.segs.indexOf(s));
    const pay = Math.round(SEG_BASE + SEG_PER_M * s.len);
    R.paid += pay; this.pay(pay);
    this.stats.segments++; this.stats.earned += pay;
    this.say(`${s.name} cleared — ${formatMoney(pay)}  (${R.cleared}/${R.segs.length})`, 2000);
    this.cash();
    this.save();
  }

  save() {
    const s = this.stats;
    write(KEY_P, s);
  }

  update(dt, player) {
    const R = this.run;
    if (!R) return;
    if (this.game.dead) { this.end('Shift over', true); return; }
    if (!this.inPlow(player) || player.vehicle !== R.v) { this.end('You left the plow — route abandoned', true); return; }
    if (!this.snowOn() && R.t > 3) { this.end('The snow is gone — the route is cancelled', false); return; }
    const v = R.v;
    R.t += dt; R.left -= dt; R.flash += dt;
    // the beacon: two amber lamps wig-wagging
    const ph = Math.floor(R.flash * 5) & 1;
    R.bacon.meshes[0].visible = !!ph; R.bacon.meshes[1].visible = !ph;
    const speed = Math.hypot(v.vLong, v.vLat);
    const f = v.forward;
    const bx = v.x + f.x * 3.4, bz = v.z + f.z * 3.4;
    const on = this.mark(R, bx, bz, speed);
    R.blade = on && speed > 1.2;
    if (on) { if (v.vLong > PLOW_V) v.vLong = PLOW_V; }
    if (R.blade) {
      // the spray off both blade corners; the strip laid every SAMPLE metres
      const rx = f.z, rz = -f.x, tipx = v.x + f.x * 4.6, tipz = v.z + f.z * 4.6, y = v.y;
      R.spray += dt * (14 + speed * 3);
      const n = Math.floor(R.spray); R.spray -= n;
      for (const sg of [-1, 1]) {
        if (n > 0 && this.fx) this.fx.emit(tipx + rx * sg * 1.6, y + 0.5, tipz + rz * sg * 1.6, n,
          { r: 0.96, g: 0.98, b: 1, size: 0.55, life: 0.8, spread: 1.4, vx: rx * sg * 3.2, vz: rz * sg * 3.2, vy: 2.4, grav: -6, jitter: 0.4, drag: 0.94 });
      }
      const dd = R.last ? Math.hypot(bx - R.last.x, bz - R.last.z) : 99;
      if (dd >= SAMPLE) {
        if (dd > 12) R.strip.have = false;   // a gap (a teleport, a cross street): start a fresh ribbon
        let hw = 4; const seg = R.segs.find((s) => { const t = (bx - s.ax) * s.dx + (bz - s.az) * s.dz; return t > -4 && t < s.len + 4 && Math.abs((bx - s.ax) * -s.dz + (bz - s.az) * s.dx) < s.hw + 1.8; });
        if (seg) hw = seg.hw;
        this.lay(R.strip, bx, bz, f.x, f.z, hw);
        R.last = { x: bx, z: bz };
      }
    }
    if (R.cleared === R.segs.length) {
      const bonus = 150 + Math.round(Math.max(0, R.left) * 2);
      this.pay(bonus); this.stats.earned += bonus; R.paid += bonus;
      this.stats.best = Math.max(this.stats.best, R.segs.length); this.stats.runs++;
      this.last = { cleared: R.cleared, paid: R.paid, bonus, left: Math.round(R.left) };
      this.end(`Route complete — ${formatMoney(R.paid)} (finish bonus ${formatMoney(bonus)})`, false, true);
      return;
    }
    if (R.left <= 0) {
      this.stats.best = Math.max(this.stats.best, R.cleared); this.stats.runs++;
      this.last = { cleared: R.cleared, paid: R.paid, bonus: 0, left: 0 };
      this.end(`Out of time — ${R.cleared}/${R.segs.length} streets cleared, ${formatMoney(R.paid)}`, true);
      return;
    }
    // the guidance: the pin, the beam, the panel
    const nx = R.segs.find((s) => !s.done);
    const aim = nx;
    const dA = Math.hypot(aim.ax - v.x, aim.az - v.z), dB = Math.hypot(aim.bx - v.x, aim.bz - v.z);
    const tx = dA <= dB ? aim.ax : aim.bx, tz = dA <= dB ? aim.az : aim.bz;
    this.beam.position.set(tx, this.city.groundAt(tx, tz, null), tz);
    this.beam.rotation.y += dt * 0.7;
    this.hud.fare = { hail: { x: tx, z: tz }, dest: null, route: this.routeLine(R) };
    const d = Math.min(dA, dB);
    const line = `${arrowFor(tx - v.x, tz - v.z, v.heading)}  ${aim.name} · ${fmt(d)}`;
    this.setObj(`Snowplow ${R.cleared}/${R.segs.length}: ${line} · ${clock(R.left)}`);
    if (this.o.panel) this.o.panel.show(`SNOWPLOW · ${R.cleared}/${R.segs.length} CLEARED`, line, `${clock(R.left)} · ${formatMoney(R.paid)}${R.blade ? ' · blade down' : ''}`, '#e8660c');
  }

  end(msg, fail, win) {
    const R = this.run;
    this.run = null;
    if (R) {
      this.scene.remove(R.strip.mesh); R.strip.geo.dispose(); R.strip.mat.dispose();
      this.scene.remove(R.snow.mesh); R.snow.geo.dispose(); R.snow.mat.dispose();
      for (const m of R.bacon.meshes) R.bacon.v.tilt.remove(m);
      R.bacon.geo.dispose(); for (const m of R.bacon.mats) m.dispose();
    }
    if (this.beam) { this.scene.remove(this.beam); this.beam = null; }
    this.hud.fare = null;
    if (this.o.panel) this.o.panel.hide();
    this.setBtn(false);
    if (this.hud.objective && this.hud.objective.textContent === this._obj) this.hud.setObjective(this._wasObj || '');
    this._obj = '';
    this.save();
    if (msg) this.say(msg, 3800);
    if (win) { this.cash(); } else if (fail) this.ui('fail');
  }

  toggle(player) {
    if (this.run) { this.end('Route abandoned', false); return; }
    this.begin(player);
  }

  jobRows() {
    const s = this.stats;
    return [{ name: 'Snowplow route', sub: 'a Region plow in a snowfall; the roads yard on the east side', best: s.segments ? `${s.segments} streets cleared · ${formatMoney(s.earned)}` : null,
      medal: s.best >= 12 ? 'gold' : s.best >= 8 ? 'silver' : s.best ? 'bronze' : null }];
  }

  warmMeshes() {
    const m = new THREE.Mesh(this.beamGeo, this.beamMat); m.frustumCulled = false;
    return [m];
  }
}

// ---------------------------------------------------------------------------------------------
// Resurface the Aud's ice
// ---------------------------------------------------------------------------------------------

const RW = 42, RH = 20;                 // the pop-up rink, m
const CELL = 0.5, GW = RW / CELL, GH = RH / CELL;
const TW = 256, TH = 128;
const SWATH = 3.0, TAIL = 2.0;          // the conditioner's width and how far behind the centre it lays
const ZT = 90, WIN = 0.95;
const REHIT = 3;                        // s: a cell covered again after this long is overlap

export class ZamboniJob extends Job {
  /** o: { scene, city, game, hud, audio, world, panel, rig: () => Vehicle } */
  constructor(o) {
    super(o);
    this.run = null;
    this.site = undefined;
    this.stats = Object.assign({ best: 0, bestCov: 0, plays: 0, earned: 0 }, read(KEY_Z));
  }

  inZam(player) {
    const v = player.vehicle;
    return !!(v && !player.onFoot && v.spec.zamboni && !v.dead);
  }

  places() {
    return [{ x: AUD.x, z: AUD.z, kind: 'winter', label: true, name: 'The Aud — Zamboni', near: false,
      hello: 'The Aud\'s Zamboni on the forecourt. Climb in and press MISSION to resurface the ice' }];
  }

  findSite() {
    if (this.site !== undefined) return this.site;
    const t0 = performance.now();
    const wl = (x, z) => this.o.world.waterLevelAt(x, z);
    this.site = openGround(this.city, wl, AUD.x, AUD.z, 1100, 40) || openGround(this.city, wl, AUD.x, AUD.z, 2600, 30) || null;
    this.siteMs = performance.now() - t0;
    return this.site;
  }

  begin(player) {
    if (this.run) return false;
    if (this.game.wanted > 0) { this.say('Lose your wanted level first', 2400); return false; }
    const site = this.findSite();
    if (!site) { this.say('No room to flood a rink round here', 3000); return false; }
    const v = player.vehicle;
    const R = {
      v, cx: site.x, cz: site.z, back: { x: v.x, z: v.z, h: v.heading },
      t: 0, left: ZT, started: false, cov: new Uint8Array(GW * GH), at: new Float32Array(GW * GH), covered: 0, over: 0, last: null,
      dirty: false, ended: false,
    };
    this.buildRink(R);
    v.place(R.cx - RW / 2 + 5, R.cz, Math.PI / 2);
    v.vLong = 0; v.vLat = 0;
    this.o.world.update(R.cx, R.cz, 60);
    this.run = R;
    this._wasObj = this.hud.objective ? this.hud.objective.textContent : '';
    this.say('Resurface the ice — 90 s, cover 95 %. Drive slow, straight passes', 3600);
    this.ui('start');
    this.setBtn(true);
    return true;
  }

  buildRink(R) {
    const { cx, cz } = R;
    const geo = new THREE.PlaneGeometry(RW, RH, 14, 6);
    geo.rotateX(-Math.PI / 2);
    const p = geo.attributes.position;
    for (let i = 0; i < p.count; i++) p.setY(i, this.city.groundAt(cx + p.getX(i), cz + p.getZ(i), null) + 0.08);
    p.needsUpdate = true;
    // the canvas: scuffed, scratched, lined; fresh ice is stamped over it
    const cv = document.createElement('canvas'); cv.width = TW; cv.height = TH;
    const g = cv.getContext('2d');
    const base = g.createLinearGradient(0, 0, TW, TH); base.addColorStop(0, '#7a8793'); base.addColorStop(1, '#8794a0');
    g.fillStyle = base; g.fillRect(0, 0, TW, TH);
    let s = 7;
    const rnd = () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
    for (let i = 0; i < 260; i++) {
      g.strokeStyle = rnd() < 0.5 ? 'rgba(205,214,222,0.5)' : 'rgba(110,122,134,0.35)'; g.lineWidth = 0.5 + rnd();
      const x = rnd() * TW, y = rnd() * TH, a = rnd() * Math.PI, l = 8 + rnd() * 34;
      g.beginPath(); g.moveTo(x, y); g.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l * 0.5); g.stroke();
    }
    g.lineWidth = 2;
    g.strokeStyle = 'rgba(200,40,50,0.55)'; g.beginPath(); g.moveTo(TW / 2, 0); g.lineTo(TW / 2, TH); g.stroke();
    g.strokeStyle = 'rgba(40,90,200,0.55)';
    for (const f of [0.3, 0.7]) { g.beginPath(); g.moveTo(TW * f, 0); g.lineTo(TW * f, TH); g.stroke(); }
    g.beginPath(); g.arc(TW / 2, TH / 2, 22, 0, Math.PI * 2); g.stroke();
    const tex = new THREE.CanvasTexture(cv);
    tex.encoding = THREE.sRGBEncoding;
    tex.anisotropy = 4;
    const mat = new THREE.MeshStandardMaterial({ map: tex, emissiveMap: tex, emissive: 0xffffff, emissiveIntensity: 0.22, roughness: 0.28, metalness: 0 });
    mat.userData.wx = 'nosnow';
    mat.customProgramCacheKey = () => 'zamice';
    const ice = new THREE.Mesh(geo, mat);
    ice.position.set(cx, 0, cz); ice.frustumCulled = false; ice.renderOrder = 1;
    // the boards: one instanced box per 2 m
    const bm = new THREE.MeshStandardMaterial({ color: 0xeceff2, roughness: 0.6 });
    bm.userData.wx = 'nosnow'; bm.customProgramCacheKey = () => 'zamboards';
    const bg = new THREE.BoxGeometry(1, 1, 1);
    const segs = [];
    for (let x = -RW / 2 + 1; x < RW / 2; x += 2) for (const sz of [-1, 1]) segs.push([x, sz * (RH / 2 + 0.1), 2.05, 0.18]);
    for (let z = -RH / 2 + 1; z < RH / 2; z += 2) for (const sx of [-1, 1]) segs.push([sx * (RW / 2 + 0.1), z, 0.18, 2.05]);
    const boards = new THREE.InstancedMesh(bg, bm, segs.length);
    const m4 = new THREE.Matrix4(), sc = new THREE.Vector3(), q = new THREE.Quaternion(), ps = new THREE.Vector3();
    segs.forEach((b, i) => {
      const y = this.city.groundAt(cx + b[0], cz + b[1], null);
      ps.set(cx + b[0], y + 0.6, cz + b[1]); sc.set(b[2], 1.1, b[3]);
      m4.compose(ps, q, sc); boards.setMatrixAt(i, m4);
    });
    boards.instanceMatrix.needsUpdate = true; boards.frustumCulled = false;
    ice.userData.winter = boards.userData.winter = 1;
    this.scene.add(ice, boards);
    R.ice = ice; R.boards = boards; R.cv = cv; R.g = g; R.tex = tex; R.geoms = [geo, bg]; R.mats = [mat, bm];
  }

  /** Lay fresh ice from (x0, z0) to (x1, z1) (world), a SWATH wide. */
  stamp(R, x0, z0, x1, z1) {
    const px = (x) => ((x - R.cx) / RW + 0.5) * TW, pz = (z) => ((z - R.cz) / RH + 0.5) * TH;
    const g = R.g;
    g.strokeStyle = 'rgba(236,248,255,0.96)'; g.lineCap = 'round'; g.lineWidth = SWATH * (TW / RW);
    g.beginPath(); g.moveTo(px(x0), pz(z0)); g.lineTo(px(x1), pz(z1)); g.stroke();
    // the coverage grid, every 0.4 m along the stroke
    const n = Math.max(1, Math.ceil(Math.hypot(x1 - x0, z1 - z0) / 0.4)), r = SWATH / 2;
    for (let i = 0; i <= n; i++) {
      const x = x0 + (x1 - x0) * (i / n), z = z0 + (z1 - z0) * (i / n);
      const i0 = Math.max(0, Math.floor((x - r - R.cx + RW / 2) / CELL)), i1 = Math.min(GW - 1, Math.floor((x + r - R.cx + RW / 2) / CELL));
      const j0 = Math.max(0, Math.floor((z - r - R.cz + RH / 2) / CELL)), j1 = Math.min(GH - 1, Math.floor((z + r - R.cz + RH / 2) / CELL));
      for (let j = j0; j <= j1; j++) for (let k = i0; k <= i1; k++) {
        const cxw = R.cx - RW / 2 + (k + 0.5) * CELL, czw = R.cz - RH / 2 + (j + 0.5) * CELL;
        if (Math.hypot(cxw - x, czw - z) > r) continue;
        const c = j * GW + k;
        if (!R.cov[c]) { R.cov[c] = 1; R.covered++; } else if (R.t - R.at[c] > REHIT) R.over++;
        R.at[c] = R.t;
      }
    }
    R.dirty = true;
  }

  coverage(R) { return R.covered / (GW * GH); }
  neatness(R) { return clamp(1 - (R.over / Math.max(1, R.covered)) * 1.6, 0, 1); }
  scoreOf(R) { return Math.round(1000 * this.coverage(R) * (0.5 + 0.5 * this.neatness(R))); }

  update(dt, player) {
    const R = this.run;
    if (!R) return;
    if (this.game.dead) { this.end('Shift over', true); return; }
    if (!this.inZam(player) || player.vehicle !== R.v) { this.end('You left the Zamboni — session over', true); return; }
    const v = R.v, f = v.forward;
    // the boards
    const hx = RW / 2 - 1.3, hz = RH / 2 - 1.3;
    const lx = clamp(v.x - R.cx, -hx, hx), lz = clamp(v.z - R.cz, -hz, hz);
    if (lx !== v.x - R.cx || lz !== v.z - R.cz) {
      v.x = R.cx + lx; v.z = R.cz + lz; v.vLong *= 0.5;
      if (!R.bump || R.t - R.bump > 0.6) { R.bump = R.t; if (this.audio && this.audio.ready) this.audio.blip(160, 0.08, 'square', 0.12); }
    }
    const speed = Math.hypot(v.vLong, v.vLat);
    if (!R.started && speed > 0.5) R.started = true;
    if (R.started) { R.t += dt; R.left -= dt; }
    // the conditioner lays ice under the tail whenever the machine rolls
    const tx = v.x - f.x * TAIL, tz = v.z - f.z * TAIL;
    if (!R.last) { R.last = { x: tx, z: tz }; this.stamp(R, tx, tz, tx, tz); }
    else if (Math.hypot(tx - R.last.x, tz - R.last.z) > 0.25 && R.started) {
      this.stamp(R, R.last.x, R.last.z, tx, tz); R.last.x = tx; R.last.z = tz;
    }
    if (R.dirty) { R.tex.needsUpdate = true; R.dirty = false; }
    const cov = this.coverage(R);
    const line = `${(cov * 100).toFixed(0)} % laid  ·  neatness ${(this.neatness(R) * 100).toFixed(0)} %`;
    this.setObj(`Zamboni: ${line} · ${clock(Math.max(0, R.left))}`);
    if (this.o.panel) this.o.panel.show('RESURFACE THE ICE', line, `${R.started ? clock(Math.max(0, R.left)) : 'drive to start the clock'} · goal ${WIN * 100} %`, '#2c6ad8');
    if (cov >= WIN || R.left <= 0) this.finish(R, cov);
  }

  finish(R, cov) {
    if (R.ended) return;
    R.ended = true;
    const win = cov >= WIN;
    const score = this.scoreOf(R) + (win ? Math.round(Math.max(0, R.left) * 8) : 0);
    const pay = 40 + Math.round(cov * 160) + (win ? 100 : 0);
    this.pay(pay);
    const S = this.stats;
    S.plays++; S.earned += pay;
    const best = score > S.best;
    if (best) S.best = score;
    S.bestCov = Math.max(S.bestCov, Math.round(cov * 100));
    write(KEY_Z, S);
    this.last = { score, cov, neat: this.neatness(R), pay, win, best, over: R.over, left: Math.max(0, R.left) };
    this.cheer(win ? 1 : cov > 0.7 ? 0.6 : 0.3);
    this.end(`${win ? 'Smooth sheet!' : 'Time!'} ${(cov * 100).toFixed(0)} % laid, score ${score}${best ? ' — a new best' : ''} · ${formatMoney(pay)}`, !win && cov < 0.5);
    this.cash();
  }

  /** The crowd: a few swells of band-passed noise. */
  cheer(k) {
    const a = this.audio;
    if (!a || !a.ready || !a.burst) return;
    const n = k > 0.8 ? 7 : 3;
    for (let i = 0; i < n; i++) setTimeout(() => { try { a.burst(0.5 + 0.2 * k, 700 + i * 130, 0.7, 0.1 * k + 0.05); } catch (e) { /* audio */ } }, i * 230);
  }

  end(msg, fail) {
    const R = this.run;
    this.run = null;
    if (R) {
      this.scene.remove(R.ice, R.boards);
      for (const g of R.geoms) g.dispose();
      for (const m of R.mats) m.dispose();
      R.tex.dispose(); R.boards.dispose();
      // back to the apron
      const v = R.v;
      try {
        v.place(R.back.x, R.back.z, R.back.h); v.vLong = 0; v.vLat = 0;
        this.o.world.update(R.back.x, R.back.z, 60);
      } catch (e) { console.warn('zamboni return', e); }
    }
    if (this.o.panel) this.o.panel.hide();
    this.setBtn(false);
    if (this.hud.objective && this.hud.objective.textContent === this._obj) this.hud.setObjective(this._wasObj || '');
    this._obj = '';
    if (msg) this.say(msg, 4200);
    if (fail) this.ui('fail');
  }

  setBtn(on) {
    if (typeof document === 'undefined') return;
    const b = document.querySelector('[data-btn="winmission"]');
    if (b) b.classList.toggle('on', on);
  }

  toggle(player) {
    if (this.run) { this.end('Session ended', false); return; }
    this.begin(player);
  }

  jobRows() {
    const s = this.stats;
    return [{ name: 'Resurface the ice', sub: 'the Zamboni on the Aud\'s forecourt', best: s.plays ? `best ${s.best} · ${s.bestCov} % · ${formatMoney(s.earned)}` : null,
      medal: s.best >= 900 ? 'gold' : s.best >= 700 ? 'silver' : s.best ? 'bronze' : null }];
  }
}

// ---------------------------------------------------------------------------------------------
// The pair, as main.js drives them: one MISSION button for both.
// ---------------------------------------------------------------------------------------------

export class WinterJobs {
  constructor(o) {
    this.o = o;
    this.plow = new SnowPlowJob(o);
    this.zam = new ZamboniJob(o);
    this._was = false;
    this._app = null;
  }

  busy() { return !!(this.plow.run || this.zam.run); }

  update(dt, player) {
    const c = this.o.controls;
    const inP = this.plow.inPlow(player), inZ = this.zam.inZam(player);
    const app = this._app || (this._app = document.getElementById('app'));
    const want = inP || inZ;
    if (app && (app.dataset.winter === '1') !== want) app.dataset.winter = want ? '1' : '';
    const down = !!(c && want && (c.btn.winmission || c.key('KeyM') || (c._padHeld && c._padHeld.job)));
    if (down && !this._was) {
      // another job or a story chapter running: it starts nothing (stopping one of ours is always allowed)
      const why = !this.busy() && this.o.blocked ? this.o.blocked() : null;
      if (why) this.o.hud.showToast(`Finish the ${why} first`, 2600);
      else if (inP && !this.zam.run) this.plow.toggle(player);
      else if (inZ && !this.plow.run) this.zam.toggle(player);
    }
    this._was = down;
    this.plow.update(dt, player);
    this.zam.update(dt, player);
  }

  jobRows() { return [...this.plow.jobRows(), ...this.zam.jobRows()]; }
}
