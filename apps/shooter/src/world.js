import * as THREE from 'three';
import { COLORS } from './config.js';
import { clamp } from './utils.js';

const FORT_COLORS = [COLORS.cyan, COLORS.magenta, COLORS.amber, COLORS.lime];

// Cyberpunk "Block Fort" arena — four tiered forts with ramps, a high bridge
// ring connecting them, and a central platform. Provides a raycast floor
// sampler + wall-collision test so movement supports ramps and levels.
export class World {
  constructor(scene, quality = 'high') {
    this.scene = scene;
    this.group = new THREE.Group();
    scene.add(this.group);
    this.HALF = 50;
    this.walkables = [];     // meshes for downward floor raycast
    this.colliders = [];     // {minX,maxX,minZ,maxZ,top} horizontal blockers
    this.spawnPoints = [];   // {x,y,z} — GROUND level only (enemies climb from here)
    this.navNodes = [];      // {x,y,z,edges:[{to,cost}]} nav graph for enemy pathing
    this._ray = new THREE.Raycaster();
    this._ro = new THREE.Vector3();
    this._rd = new THREE.Vector3(0, -1, 0);
    this._mats(quality);
    this._build(quality);
  }

  _mats(quality) {
    this.matFloor = new THREE.MeshStandardMaterial({ color: 0x0c0b18, roughness: 0.9, metalness: 0.3 });
    this.matStruct = new THREE.MeshStandardMaterial({ color: 0x16151f, roughness: 0.72, metalness: 0.45 });
    this.matRamp = new THREE.MeshStandardMaterial({ color: 0x1b1a26, roughness: 0.8, metalness: 0.35 });
  }
  _neon(color) { return new THREE.MeshBasicMaterial({ color, toneMapped: false }); }

  _addWalkable(mesh) { mesh.receiveShadow = true; this.walkables.push(mesh); this.group.add(mesh); }

  // Solid block: bottom at baseY, given footprint + height. Registers walkable top + side collider.
  _block(cx, cz, baseY, w, d, h, color, addCollider = true) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), this.matStruct);
    m.position.set(cx, baseY + h / 2, cz);
    m.castShadow = true; m.receiveShadow = true;
    this.group.add(m); this.walkables.push(m);
    // glowing edge outline
    const edges = new THREE.LineSegments(new THREE.EdgesGeometry(m.geometry),
      new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.9 }));
    edges.position.copy(m.position); this.group.add(edges);
    // top trim strip
    const trim = new THREE.Mesh(new THREE.BoxGeometry(w + 0.25, 0.18, d + 0.25), this._neon(color));
    trim.position.set(cx, baseY + h, cz); this.group.add(trim);
    if (addCollider) this.colliders.push({ minX: cx - w / 2, maxX: cx + w / 2, minZ: cz - d / 2, maxZ: cz + d / 2, top: baseY + h });
    return m;
  }

  // Ramp from a high edge point down to a low point (walkable slope, no side collider).
  _ramp(hx, hy, hz, lx, ly, lz, width, color) {
    const dir = new THREE.Vector3(hx - lx, hy - ly, hz - lz);
    const len = dir.length(); dir.normalize();
    const geo = new THREE.BoxGeometry(width, 0.5, len);
    const m = new THREE.Mesh(geo, this.matRamp);
    m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), dir);
    m.position.set((hx + lx) / 2, (hy + ly) / 2 + 0.22, (hz + lz) / 2);
    m.castShadow = true; m.receiveShadow = true;
    this.group.add(m); this.walkables.push(m);
    // glowing side rails
    for (const s of [-1, 1]) {
      const rail = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.12, len), this._neon(color));
      rail.quaternion.copy(m.quaternion);
      const off = new THREE.Vector3(s * width / 2, 0.3, 0).applyQuaternion(m.quaternion);
      rail.position.copy(m.position).add(off);
      this.group.add(rail);
    }
    return m;
  }

  // Horizontal plank bridge between two points at height y (walkable, fall off sides).
  _bridge(x1, z1, x2, z2, y, width, color) {
    const dir = new THREE.Vector3(x2 - x1, 0, z2 - z1);
    const len = dir.length(); dir.normalize();
    const m = new THREE.Mesh(new THREE.BoxGeometry(width, 0.4, len), this.matStruct);
    m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), dir);
    m.position.set((x1 + x2) / 2, y - 0.2, (z1 + z2) / 2);
    m.castShadow = true; m.receiveShadow = true;
    this.group.add(m); this.walkables.push(m);
    for (const s of [-1, 1]) {
      const rail = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.5, len), this._neon(color));
      rail.quaternion.copy(m.quaternion);
      const off = new THREE.Vector3(s * width / 2, 0.25, 0).applyQuaternion(m.quaternion);
      rail.position.copy(m.position).add(off);
      this.group.add(rail);
    }
  }

  _fort(cx, cz, color) {
    const sx = Math.sign(cx), sz = Math.sign(cz);
    // tier 1 (top y3) and tier 2 (top y6)
    this._block(cx, cz, 0, 15, 15, 3, color);
    this._block(cx, cz, 3, 8, 8, 3, color);
    // ground -> tier1 ramp on the inner X face (toward arena center)
    this._ramp(cx - sx * 7.5, 3, cz, cx - sx * 13.5, 0, cz, 4, color);
    // tier1 -> tier2 ramp (switchback toward tower)
    this._ramp(cx - sx * 4, 6, cz, cx - sx * 10, 3, cz, 3, color);
    // a glowing beacon on top
    const beacon = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.18, 2.4, 8), this._neon(color));
    beacon.position.set(cx, 7.2, cz); this.group.add(beacon);
    const lamp = new THREE.PointLight(color, 0.5, 30); lamp.position.set(cx, 8, cz); this.group.add(lamp);
  }

  _build(quality) {
    const H = this.HALF;
    // ground
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(H * 2 + 10, H * 2 + 10), this.matFloor);
    floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true;
    this.group.add(floor); this.walkables.push(floor);
    // neon grids
    const g1 = new THREE.GridHelper(H * 2, 50, 0x1c6f9e, 0x10283c);
    g1.position.y = 0.02; g1.material.transparent = true; g1.material.opacity = 0.45; this.group.add(g1);
    const g2 = new THREE.GridHelper(H * 2, 12, COLORS.magenta, 0x241433);
    g2.position.y = 0.03; g2.material.transparent = true; g2.material.opacity = 0.18; this.group.add(g2);

    // perimeter walls (always-blocking: very tall top)
    const wallMat = new THREE.MeshStandardMaterial({ color: 0x0d0c1c, roughness: 0.6, metalness: 0.6 });
    const wh = 9;
    for (const [x, z, w, d] of [[0, -H, H * 2, 1], [0, H, H * 2, 1], [-H, 0, 1, H * 2], [H, 0, 1, H * 2]]) {
      const wall = new THREE.Mesh(new THREE.BoxGeometry(w, wh, d), wallMat);
      wall.position.set(x, wh / 2, z); wall.castShadow = true; wall.receiveShadow = true;
      this.group.add(wall); this.walkables.push(wall); // also a bullet-stop surface
      const trim = new THREE.Mesh(new THREE.BoxGeometry(w, 0.3, d), this._neon(COLORS.cyan));
      trim.position.set(x, wh - 0.3, z); this.group.add(trim);
      const trim2 = new THREE.Mesh(new THREE.BoxGeometry(w, 0.3, d), this._neon(COLORS.magenta));
      trim2.position.set(x, 0.4, z); this.group.add(trim2);
      this.colliders.push({ minX: x - w / 2, maxX: x + w / 2, minZ: z - d / 2, maxZ: z + d / 2, top: 99 });
    }

    // four forts
    const fp = [[-26, -26], [26, -26], [-26, 26], [26, 26]];
    fp.forEach((p, i) => this._fort(p[0], p[1], FORT_COLORS[i]));

    // high bridge ring at y3 connecting tier-1 tops of adjacent forts
    this._bridge(-18.5, -26, 18.5, -26, 3, 4, COLORS.cyan);
    this._bridge(-18.5, 26, 18.5, 26, 3, 4, COLORS.amber);
    this._bridge(-26, -18.5, -26, 18.5, 3, 4, COLORS.magenta);
    this._bridge(26, -18.5, 26, 18.5, 3, 4, COLORS.lime);

    // central platform (top y1.4) with ramps on all four sides
    this._block(0, 0, 0, 13, 13, 1.4, COLORS.cyan);
    this._ramp(0, 1.4, 6.5, 0, 0, 12, 4, COLORS.cyan);
    this._ramp(0, 1.4, -6.5, 0, 0, -12, 4, COLORS.cyan);
    this._ramp(6.5, 1.4, 0, 12, 0, 0, 4, COLORS.cyan);
    this._ramp(-6.5, 1.4, 0, -12, 0, 0, 4, COLORS.cyan);
    // central obelisk (cover) on the platform
    this._block(0, 0, 1.4, 2.4, 2.4, 5, COLORS.magenta);

    // scattered cover crates at ground level
    const crates = [[-12, 8], [12, -8], [-8, -14], [10, 14], [16, 0], [-16, 2], [18, 16], [-18, -16]];
    for (let i = 0; i < crates.length; i++) {
      const [x, z] = crates[i]; const h = 1.6 + (i % 3) * 0.5;
      this._block(x, z, 0, 2.6, 2.6, h, FORT_COLORS[i % 4]);
    }

    // ground-ring spawn points
    for (let i = 0; i < 14; i++) {
      const a = (i / 14) * Math.PI * 2, r = 42;
      this.spawnPoints.push({ x: Math.cos(a) * r, y: 0, z: Math.sin(a) * r });
    }

    // distant neon skyline
    const skMat = new THREE.MeshStandardMaterial({ color: 0x070617, roughness: 1 });
    for (let i = 0; i < 44; i++) {
      const a = (i / 44) * Math.PI * 2, r = 92 + (i % 5) * 15, h = 30 + (i * 7 % 80), w = 7 + (i * 3 % 11);
      const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, w), skMat);
      b.position.set(Math.cos(a) * r, h / 2 - 2, Math.sin(a) * r); this.group.add(b);
      const strip = new THREE.Mesh(new THREE.BoxGeometry(w * 0.18, h * 0.7, 0.2), this._neon(FORT_COLORS[i % 4]));
      strip.position.set(b.position.x, h * 0.5, b.position.z + w / 2); this.group.add(strip);
    }

    this._buildNav();
  }

  // ---- Navigation graph (enemies spawn on ground and route up ramps/bridges) ----
  _buildNav() {
    const N = this.navNodes;
    const node = (x, y, z) => { N.push({ x, y, z, edges: [] }); return N.length - 1; };
    const edge = (a, b) => {
      if (a == null || b == null || a === b) return;
      const A = N[a], B = N[b], c = Math.hypot(A.x - B.x, A.y - B.y, A.z - B.z);
      A.edges.push({ to: b, cost: c }); B.edges.push({ to: a, cost: c });
    };
    // ground lane nodes (open cross-lanes + fort ramp bottoms)
    const gpts = [[0, -40], [0, -22], [0, -10], [0, 10], [0, 22], [0, 40],
                  [-40, 0], [-22, 0], [-10, 0], [10, 0], [22, 0], [40, 0]];
    const fp = [[-26, -26], [26, -26], [-26, 26], [26, 26]];
    const FB = fp.map(([cx, cz]) => { const sx = Math.sign(cx); return node(cx - sx * 13.5, 0, cz); });
    const ground = [...FB];
    for (const [x, z] of gpts) ground.push(node(x, 0, z));
    // central ramp-bottom nodes + central top
    const CB = [[0, 12], [0, -12], [12, 0], [-12, 0]].map(([x, z]) => node(x, 0, z));
    ground.push(...CB);
    const CT = node(0, 1.4, 0);
    for (const cb of CB) edge(cb, CT);
    // auto-connect ground nodes whose straight line stays clear of solid footprints
    for (let i = 0; i < ground.length; i++)
      for (let j = i + 1; j < ground.length; j++) {
        const a = N[ground[i]], b = N[ground[j]];
        const d = Math.hypot(a.x - b.x, a.z - b.z);
        if (d > 30) continue;
        if (this._segClear(a.x, a.z, b.x, b.z)) edge(ground[i], ground[j]);
      }
    // per-fort climb chain: FB -> R1(tier1) -> R2b -> TOP(tier2), plus tier1 center for bridges
    const TC = [];
    fp.forEach(([cx, cz], i) => {
      const sx = Math.sign(cx), sz = Math.sign(cz);
      const r1 = node(cx - sx * 5, 3, cz);
      const tc = node(cx, 3, cz); TC.push(tc);
      const r2b = node(cx - sx * 8, 3, cz);
      const top = node(cx, 6, cz);
      edge(FB[i], r1); edge(r1, tc); edge(r1, r2b); edge(tc, r2b); edge(r2b, top);
    });
    // bridges connect adjacent fort tier-1 centers
    edge(TC[0], TC[1]); edge(TC[2], TC[3]); edge(TC[0], TC[2]); edge(TC[1], TC[3]);
  }

  // True if the ground segment doesn't pass through a tall solid footprint.
  _segClear(x1, z1, x2, z2) {
    for (let t = 0.12; t < 0.9; t += 0.12) {
      const x = x1 + (x2 - x1) * t, z = z1 + (z2 - z1) * t;
      for (const c of this.colliders) {
        if (c.top < 1.0 || c.top > 50) continue; // ignore low trims and perimeter
        if (x > c.minX - 0.6 && x < c.maxX + 0.6 && z > c.minZ - 0.6 && z < c.maxZ + 0.6) return false;
      }
    }
    return true;
  }

  // Nearest nav node to a point, weighting vertical distance so the right level wins.
  nearestNode(x, y, z) {
    let best = 0, bd = Infinity;
    for (let i = 0; i < this.navNodes.length; i++) {
      const n = this.navNodes[i];
      const d = (n.x - x) ** 2 + (n.z - z) ** 2 + ((n.y - y) * 3) ** 2;
      if (d < bd) { bd = d; best = i; }
    }
    return best;
  }

  // Highest walkable surface strictly below originY (ignores overhead bridges).
  sampleFloor(x, z, originY) {
    this._ro.set(x, originY, z);
    this._ray.set(this._ro, this._rd);
    this._ray.far = originY + 2;
    const hits = this._ray.intersectObjects(this.walkables, false);
    return hits.length ? hits[0].point.y : null;
  }

  // Horizontal blocking: a collider only blocks while your feet are below its top.
  blocked(x, z, feetY, r, step) {
    const H = this.HALF;
    if (x < -H + r || x > H - r || z < -H + r || z > H - r) return true;
    for (const c of this.colliders) {
      if (feetY >= c.top - step) continue;          // standing on/above it → not a wall
      const cx = clamp(x, c.minX, c.maxX), cz = clamp(z, c.minZ, c.maxZ);
      const dx = x - cx, dz = z - cz;
      if (dx * dx + dz * dz < r * r) return true;
    }
    return false;
  }
}
