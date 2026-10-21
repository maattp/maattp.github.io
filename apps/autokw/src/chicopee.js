// CHICOPEE: the ski hill on Kitchener's east side, in October a bike park.
//
// data/chicopee.json (tools/kw/build_chicopee.py) holds OSM's ski runs, lifts
// and the paths through the woods. Here:
//   - every run is a downhill line, a singletrack of packed dirt winding down
//     the cleared run, and the woods' paths are the cross-country loop; one
//     merged ribbon draped on the terrain, a single draw;
//   - the trees keep off the runs (city.extraClear), so the hill reads as a
//     ski hill: cleared lanes down a wooded slope;
//   - the three chairlifts stand on their towers with their cables, and the
//     chairs go round (one instanced mesh, moved only while you are near);
//   - dirt bikes and mountain bikes wait at the base and at the summit;
//   - each run is a timed downhill (activities.js, need 'trail'), and ENTER
//     on foot at a lift's base rides you to the top.

import * as THREE from './three.js';
import * as G from './geo.js';
import { mergeByMaterial } from './build.js';

const DIRT = [0.30, 0.20, 0.12], DIRT2 = [0.38, 0.26, 0.16];
const CHAIR_GAP = 16;       // m between chairs on a line
const LIFT_V = 2.4;         // m/s, a fixed-grip quad

function segDist(px, pz, ax, az, bx, bz) {
  const dx = bx - ax, dz = bz - az, L2 = dx * dx + dz * dz || 1;
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (pz - az) * dz) / L2));
  return Math.hypot(px - (ax + dx * t), pz - (az + dz * t));
}

/** Resample a polyline every `step` metres. */
function resample(p, step) {
  const out = [p[0].slice()];
  let carry = 0;
  for (let i = 1; i < p.length; i++) {
    const [ax, az] = p[i - 1], [bx, bz] = p[i];
    const L = Math.hypot(bx - ax, bz - az);
    let t = step - carry;
    while (t <= L) { out.push([ax + (bx - ax) * t / L, az + (bz - az) * t / L]); t += step; }
    carry = L - (t - step);
  }
  const last = p[p.length - 1];
  if (Math.hypot(last[0] - out[out.length - 1][0], last[1] - out[out.length - 1][1]) > step * 0.3) out.push(last.slice());
  return out;
}

export class Chicopee {
  constructor(data, { scene, city }) {
    this.d = data;
    this.scene = scene;
    this.city = city;
    this.group = new THREE.Group();
    this.group.name = 'chicopee';
    this.lines = [];      // the downhill lines: [{ name, pts: [[x, z]] top first }]
    this.liftLines = [];  // chairlifts: { name, a: bottom, b: top, len }
    this.chairs = null;
    this.t = 0;
    if (!data) return;
    const T = G.terrainHeight;
    // runs, top first; a singletrack weaving down each one
    for (const r of data.runs) {
      if (/Mount St\. Louis/.test(r.n)) continue;
      let p = r.p;
      if (T(p[0][0], p[0][1]) < T(p[p.length - 1][0], p[p.length - 1][1])) p = p.slice().reverse();
      const base = resample(p, 4);
      const pts = base.map((q, i) => {
        if (i === 0 || i === base.length - 1) return q;
        const a = base[i - 1], b = base[i + 1];
        let nx = -(b[1] - a[1]), nz = b[0] - a[0];
        const nl = Math.hypot(nx, nz) || 1;
        const w = Math.sin(i * 0.19 + r.n.length) * 5.5 + Math.sin(i * 0.071) * 3;
        return [q[0] + nx / nl * w, q[1] + nz / nl * w];
      });
      this.lines.push({ name: r.n || 'Chicopee', pts, run: p });
    }
    for (const l of data.lifts) {
      if (l.k !== 'chair_lift') continue;
      let [a, b] = l.p;
      if (T(a[0], a[1]) > T(b[0], b[1])) [a, b] = [b, a];
      this.liftLines.push({ name: l.n, a, b, len: Math.hypot(b[0] - a[0], b[1] - a[1]) });
    }
  }

  /** Nothing grows on a run or under a lift (city.extraClear). */
  keepClear(x, z) {
    const d = this.d;
    if (!d) return false;
    const [cx, cz] = d.centre;
    if (Math.abs(x - cx) > 1000 || Math.abs(z - cz) > 1000) return false;
    for (const ln of this.lines) {
      const p = ln.run;
      for (let i = 1; i < p.length; i++) if (segDist(x, z, p[i - 1][0], p[i - 1][1], p[i][0], p[i][1]) < 17) return true;
    }
    for (const l of this.liftLines) if (segDist(x, z, l.a[0], l.a[1], l.b[0], l.b[1]) < 7) return true;
    for (const q of d.paths) {
      const p = q.p;
      for (let i = 1; i < p.length; i++) if (segDist(x, z, p[i - 1][0], p[i - 1][1], p[i][0], p[i][1]) < 1.6) return true;
    }
    return false;
  }

  /**
   * The CHICOPEE sign at the base: a landmarks.js extra, so it shares the
   * sign atlas and merges into the landmark clusters.
   */
  buildSign(ctx) {
    const base = this.base();
    if (!base) return;
    const g = new THREE.Group();
    const s = ctx.atlas.panel(14, 3.2, 26, (gx, W, Hh) => {
      gx.fillStyle = '#1d3b6b'; gx.fillRect(0, 0, W, Hh);
      gx.fillStyle = '#ffffff'; gx.textAlign = 'center'; gx.textBaseline = 'middle';
      gx.font = `800 ${Hh * 0.46}px Helvetica, Arial, sans-serif`;
      gx.fillText('CHICOPEE', W / 2, Hh * 0.38, W * 0.92);
      gx.fillStyle = '#f2a33a';
      gx.font = `700 ${Hh * 0.22}px Helvetica, Arial, sans-serif`;
      gx.fillText('BIKE PARK · SKI & SUMMER RESORT', W / 2, Hh * 0.78, W * 0.92);
    });
    const y = G.terrainHeight(base.sx, base.sz);
    s.position.set(base.sx, y + 4.2, base.sz);
    s.rotation.y = base.signYaw;
    g.add(s);
    const back = new THREE.Mesh(new THREE.BoxGeometry(14.4, 3.6, 0.3), new THREE.MeshStandardMaterial({ color: 0x1d3b6b, roughness: 0.7 }));
    back.position.set(base.sx - Math.sin(base.signYaw) * 0.2, y + 4.2, base.sz - Math.cos(base.signYaw) * 0.2);
    back.rotation.y = base.signYaw;
    g.add(back);
    for (const sx of [-6, 6]) {
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.3, 4.2, 0.3), new THREE.MeshStandardMaterial({ color: 0x6a6f74, roughness: 0.5, metalness: 0.6 }));
      post.position.set(base.sx + Math.cos(base.signYaw) * sx - Math.sin(base.signYaw) * 0.3, y + 1.2, base.sz - Math.sin(base.signYaw) * sx - Math.cos(base.signYaw) * 0.3);
      g.add(post);
    }
    ctx.addTo('chicopee', g);
    ctx.solids.push({ x: base.sx, z: base.sz, hw: 7.2, hd: 0.4, rot: -base.signYaw, y0: y - 2, y1: y + 6 });
  }

  build() {
    if (!this.d) return;
    const T = G.terrainHeight;
    // --- the trails: one draped ribbon ---------------------------------------
    const pos = [], col = [], nrm = [], idx = [];
    const ribbon = (pts, hw) => {
      const base = pos.length / 3;
      for (let i = 0; i < pts.length; i++) {
        const a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)];
        let nx = -(b[1] - a[1]), nz = b[0] - a[0];
        const nl = Math.hypot(nx, nz) || 1; nx /= nl; nz /= nl;
        for (const s of [-1, 1]) {
          const x = pts[i][0] + nx * hw * s, z = pts[i][1] + nz * hw * s;
          pos.push(x, T(x, z) + 0.07, z);
          nrm.push(0, 1, 0);
          const c = (i + (s > 0 ? 1 : 0)) % 3 === 0 ? DIRT2 : DIRT;
          col.push(c[0], c[1], c[2]);
        }
        if (i > 0) { const k = base + i * 2; idx.push(k - 2, k, k - 1, k - 1, k, k + 1); }
      }
    };
    for (const ln of this.lines) ribbon(ln.pts, 1.5);
    for (const q of this.d.paths) ribbon(resample(q.p, 4), 0.75);
    if (this.d.tube) ribbon(resample(this.d.tube.p, 4), 3.5);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    g.setIndex(idx);
    g.computeVertexNormals();
    const trail = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95,
      polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }));
    trail.receiveShadow = true;
    trail.name = 'chicopee:trails';
    this.group.add(trail);

    // --- the lifts: towers, cables, stations ---------------------------------
    const steel = new THREE.MeshStandardMaterial({ color: 0x6a6f74, roughness: 0.5, metalness: 0.6 });
    const cableM = new THREE.MeshStandardMaterial({ color: 0x222426, roughness: 0.6, metalness: 0.4 });
    const shed = new THREE.MeshStandardMaterial({ color: 0x2a4a7a, roughness: 0.7 });
    const deckM = new THREE.MeshStandardMaterial({ color: 0x8a8a84, roughness: 0.9 });
    const parts = [];
    const H = 9;    // tower height over the ground
    for (const l of this.liftLines) {
      const dx = (l.b[0] - l.a[0]) / l.len, dz = (l.b[1] - l.a[1]) / l.len;
      const px = -dz, pz = dx;
      const yaw = Math.atan2(dx, dz);
      const n = Math.max(2, Math.round(l.len / 42));
      l.tops = [];
      for (let i = 0; i <= n; i++) {
        const t = (i / n) * l.len, x = l.a[0] + dx * t, z = l.a[1] + dz * t, y = T(x, z);
        const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.36, H, 8), steel);
        pole.position.set(x, y + H / 2, z); parts.push(pole);
        const arm = new THREE.Mesh(new THREE.BoxGeometry(5.8, 0.35, 0.35), steel);
        arm.position.set(x, y + H, z); arm.rotation.y = yaw; parts.push(arm);
        l.tops.push([x, y + H - 0.3, z]);
      }
      // the haul rope, up one side and down the other, a straight span per tower pair
      l.side = [px * 2.6, pz * 2.6];
      for (const s of [-1, 1]) {
        for (let i = 1; i < l.tops.length; i++) {
          const [ax, ay, az] = l.tops[i - 1], [bx, by, bz] = l.tops[i];
          const a = new THREE.Vector3(ax + px * 2.6 * s, ay, az + pz * 2.6 * s), b = new THREE.Vector3(bx + px * 2.6 * s, by, bz + pz * 2.6 * s);
          const c = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, a.distanceTo(b), 4), cableM);
          c.position.copy(a).lerp(b, 0.5);
          c.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize());
          parts.push(c);
        }
      }
      // bullwheel huts at both ends
      // a station at each end: the bullwheel under a roof on four posts
      for (const [x, z, o] of [[l.a[0], l.a[1], -3], [l.b[0], l.b[1], 3]]) {
        const cx = x + dx * o, cz = z + dz * o, y = T(cx, cz);
        const wheel = new THREE.Mesh(new THREE.CylinderGeometry(2.7, 2.7, 0.35, 20), steel);
        wheel.position.set(cx, y + H - 0.3, cz); parts.push(wheel);
        const roof = new THREE.Mesh(new THREE.BoxGeometry(7.4, 0.35, 7.4), shed);
        roof.position.set(cx, y + H + 1.2, cz); roof.rotation.y = yaw; parts.push(roof);
        for (const [u, v] of [[-3.2, -3.2], [3.2, -3.2], [-3.2, 3.2], [3.2, 3.2]]) {
          const post = new THREE.Mesh(new THREE.BoxGeometry(0.3, H + 1.2, 0.3), steel);
          post.position.set(cx + u * Math.cos(yaw) + v * Math.sin(yaw), y + (H + 1.2) / 2, cz - u * Math.sin(yaw) + v * Math.cos(yaw)); parts.push(post);
        }
        // the loading ramp, a deck you walk onto
        const deck = new THREE.Mesh(new THREE.BoxGeometry(7, 0.4, 9), deckM);
        deck.position.set(cx - dx * o * 1.2, y + 0.2, cz - dz * o * 1.2); deck.rotation.y = yaw; parts.push(deck);
      }
    }
    // ONE MESH PER MATERIAL (steel, rope, roofs, decks): the towers, ropes and
    // stations were 136 meshes -- 136 draws (and shadow casts) wherever the
    // hill is in view, from the Parkway and Hwy 8, and 136 frustum tests and
    // matrix updates a frame everywhere else. Same geometry, baked in place.
    const lifts = new THREE.Group();
    for (const m of parts) lifts.add(m);
    const merged = mergeByMaterial(lifts);
    for (const m of [...merged.children]) {
      m.castShadow = true; m.receiveShadow = true; m.name = 'chicopee:lifts';
      m.matrixAutoUpdate = false; m.updateMatrix();
      this.group.add(m);
    }
    for (const m of parts) m.geometry.dispose();

    // --- the chairs: one instanced mesh, moved round each line ----------------
    const chairGeo = (() => {
      const seat = new THREE.BoxGeometry(2.0, 0.12, 0.6); seat.translate(0, -2.4, 0);
      const back = new THREE.BoxGeometry(2.0, 0.7, 0.1); back.translate(0, -2.0, -0.3);
      const bar = new THREE.BoxGeometry(0.08, 2.4, 0.08); bar.translate(0, -1.2, -0.3);
      const bars = new THREE.BoxGeometry(2.0, 0.06, 0.06); bars.translate(0, -1.6, 0.25);
      const merged = new THREE.BufferGeometry();
      const geos = [seat, back, bar, bars];
      let n = 0; for (const q of geos) n += q.attributes.position.count;
      const P = new Float32Array(n * 3), N = new Float32Array(n * 3), I = [];
      let o = 0;
      for (const q of geos) {
        P.set(q.attributes.position.array, o * 3); N.set(q.attributes.normal.array, o * 3);
        for (const v of q.index.array) I.push(v + o);
        o += q.attributes.position.count;
      }
      merged.setAttribute('position', new THREE.BufferAttribute(P, 3));
      merged.setAttribute('normal', new THREE.BufferAttribute(N, 3));
      merged.setIndex(I);
      return merged;
    })();
    let count = 0;
    for (const l of this.liftLines) { l.nChairs = Math.floor((l.len * 2) / CHAIR_GAP); count += l.nChairs; }
    this.chairs = new THREE.InstancedMesh(chairGeo, new THREE.MeshStandardMaterial({ color: 0x2d4f8a, roughness: 0.6, metalness: 0.3 }), Math.max(1, count));
    this.chairs.name = 'chicopee:chairs';
    this.chairs.frustumCulled = false;
    this.chairs.castShadow = true;
    this.scene.add(this.chairs);
    this.placeChairs(0);

    this.scene.add(this.group);
  }

  /** The base area: the bottom of the biggest lift, the sign facing the lot. */
  base() {
    const l = this.liftLines.find((q) => /Red Quad/.test(q.name)) || this.liftLines[0];
    if (!l) return null;
    const dx = (l.b[0] - l.a[0]) / l.len, dz = (l.b[1] - l.a[1]) / l.len;
    // the sign 30 m out from the bottom, facing back down the line's axis
    const sx = l.a[0] - dx * 48 + dz * 16, sz = l.a[1] - dz * 48 - dx * 16;
    return { x: l.a[0] - dx * 14, z: l.a[1] - dz * 14, sx, sz, signYaw: Math.atan2(-dx, -dz), lift: l };
  }

  placeChairs(t) {
    if (!this.chairs) return;
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(1, 1, 1), p = new THREE.Vector3();
    const up = new THREE.Vector3(0, 1, 0);
    let k = 0;
    for (const l of this.liftLines) {
      const tops = l.tops, nT = tops.length;
      const loop = l.len * 2;
      for (let c = 0; c < l.nChairs; c++) {
        let d = (c * CHAIR_GAP + t * LIFT_V) % loop;
        const upLine = d < l.len;
        const along = upLine ? d : loop - d;          // distance from the bottom
        const side = upLine ? 1 : -1;
        const f = (along / l.len) * (nT - 1), i = Math.min(nT - 2, Math.floor(f)), u = f - i;
        const a = tops[i], b = tops[i + 1];
        p.set(a[0] + (b[0] - a[0]) * u + l.side[0] * side, a[1] + (b[1] - a[1]) * u, a[2] + (b[2] - a[2]) * u + l.side[1] * side);
        const dx = l.b[0] - l.a[0], dz = l.b[1] - l.a[1];
        q.setFromAxisAngle(up, Math.atan2(dx, dz) + (upLine ? Math.PI : 0));
        m.compose(p, q, s);
        this.chairs.setMatrixAt(k++, m);
      }
    }
    this.chairs.instanceMatrix.needsUpdate = true;
  }

  update(dt, cx, cz) {
    if (!this.chairs || !this.d) return;
    this.t += dt;
    const near = Math.hypot(cx - this.d.centre[0], cz - this.d.centre[1]) < 1500;
    this.chairs.visible = near;
    if (near) this.placeChairs(this.t);
  }

  /** Where the bikes wait: [type, x, z, heading] at the base and the summit. */
  bikeSpots() {
    const out = [];
    const b = this.base();
    if (!b) return out;
    const l = b.lift, dx = (l.b[0] - l.a[0]) / l.len, dz = (l.b[1] - l.a[1]) / l.len, px = -dz, pz = dx;
    const hd = Math.atan2(dx, dz);
    const row = (x0, z0, types, h) => types.forEach((ty, i) => out.push([ty, x0 + px * (i * 2.2 - types.length * 1.1), z0 + pz * (i * 2.2 - types.length * 1.1), h]));
    row(l.a[0] - dx * 22 + px * 10, l.a[1] - dz * 22 + pz * 10, ['dirtbike', 'dirtbike', 'mtb', 'mtb', 'mtb'], hd);
    // at the top, facing back down the hill
    row(l.b[0] + dx * 10 + px * 8, l.b[1] + dz * 10 + pz * 8, ['mtb', 'mtb', 'dirtbike'], hd + Math.PI);
    return out;
  }

  /** On foot at the bottom of a chairlift? ride it: the top of the line. */
  liftAt(x, z) {
    for (const l of this.liftLines) {
      if (Math.hypot(x - l.a[0], z - l.a[1]) < 12) return l;
    }
    return null;
  }

  /** The downhill races, as activities.js entries (need 'trail'). */
  races() {
    const out = [];
    for (const ln of this.lines) {
      const p = ln.pts;
      let L = 0;
      for (let i = 1; i < p.length; i++) L += Math.hypot(p[i][0] - p[i - 1][0], p[i][1] - p[i - 1][1]);
      if (L < 160) continue;
      const step = Math.max(1, Math.round(36 / 4));
      const pts = [];
      for (let i = step; i < p.length; i += step) pts.push({ x: p[i][0], z: p[i][1], y: G.terrainHeight(p[i][0], p[i][1]) });
      const e = p[p.length - 1];
      if (pts.length && Math.hypot(pts[pts.length - 1].x - e[0], pts[pts.length - 1].z - e[1]) > 10) pts.push({ x: e[0], z: e[1], y: G.terrainHeight(e[0], e[1]) });
      const base = L / 9;   // 9 m/s down a technical line is a fast run
      out.push({
        id: `chicopee-${ln.name.replace(/\W+/g, '-').toLowerCase()}`, kind: 'race',
        name: `Chicopee: ${ln.name}`, sub: 'Downhill', x: p[0][0], z: p[0][1], y: G.terrainHeight(p[0][0], p[0][1]),
        need: 'trail', pts, metres: L, medals: { gold: base, silver: base * 1.16, bronze: base * 1.4 },
      });
    }
    return out;
  }
}
