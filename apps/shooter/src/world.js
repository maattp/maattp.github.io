import * as THREE from 'three';
import { COLORS } from './config.js';
import { clamp } from './utils.js';

const FORT_COLORS = [COLORS.cyan, COLORS.magenta, COLORS.amber, COLORS.lime];
const UP = new THREE.Vector3(0, 1, 0);
const ZAX = new THREE.Vector3(0, 0, 1);

// Cyberpunk "Block Fort" (Mario Kart 64) arena. Four tiered forts with aligned
// ramps, a TOP bridge ring connecting all four fort roofs, and a central
// platform. Surfaces are textured/lit so floors and ramps are clearly visible.
export class World {
  constructor(scene, quality = 'high') {
    this.scene = scene;
    this.group = new THREE.Group();
    scene.add(this.group);
    this.HALF = 50;
    this.walkables = [];
    this.colliders = [];
    this.spawnPoints = [];
    this.navNodes = [];
    this._ray = new THREE.Raycaster();
    this._ro = new THREE.Vector3();
    this._rd = new THREE.Vector3(0, -1, 0);
    this._mats();
    this._build();
  }

  _gridTex(base, line, cells, glow = 0) {
    const c = document.createElement('canvas'); c.width = c.height = 128;
    const x = c.getContext('2d');
    x.fillStyle = base; x.fillRect(0, 0, 128, 128);
    const step = 128 / cells;
    x.strokeStyle = line; x.lineWidth = 2;
    for (let i = 0; i <= cells; i++) {
      x.beginPath(); x.moveTo(i * step, 0); x.lineTo(i * step, 128); x.stroke();
      x.beginPath(); x.moveTo(0, i * step); x.lineTo(128, i * step); x.stroke();
    }
    if (glow) { x.fillStyle = glow; x.fillRect(0, 0, 128, 2); x.fillRect(0, 0, 2, 128); }
    const t = new THREE.CanvasTexture(c);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    return t;
  }

  _mats() {
    const floorTex = this._gridTex('#161d33', '#2a4d6e', 8);
    floorTex.repeat.set(40, 40);
    this.matFloor = new THREE.MeshStandardMaterial({ map: floorTex, color: 0x9fb3d0, roughness: 0.85, metalness: 0.25 });
    const panel = this._gridTex('#39435c', '#566480', 4);
    panel.repeat.set(3, 3);
    this.matStruct = new THREE.MeshStandardMaterial({ map: panel, color: 0xaab6cc, roughness: 0.7, metalness: 0.4 });
    const rampTex = this._gridTex('#4a566f', '#6f7ea0', 3);
    rampTex.repeat.set(2, 3);
    this.matRamp = new THREE.MeshStandardMaterial({ map: rampTex, color: 0xb9c4dc, roughness: 0.75, metalness: 0.3 });
  }
  _neon(color) { return new THREE.MeshBasicMaterial({ color, toneMapped: false }); }

  _block(cx, cz, baseY, w, d, h, color, addCollider = true) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), this.matStruct);
    m.position.set(cx, baseY + h / 2, cz);
    m.castShadow = true; m.receiveShadow = true;
    this.group.add(m); this.walkables.push(m);
    const edges = new THREE.LineSegments(new THREE.EdgesGeometry(m.geometry),
      new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.95 }));
    edges.position.copy(m.position); this.group.add(edges);
    // bright top trim so the deck edge reads clearly
    const trim = new THREE.Mesh(new THREE.BoxGeometry(w + 0.2, 0.16, d + 0.2), this._neon(color));
    trim.position.set(cx, baseY + h + 0.04, cz); this.group.add(trim);
    if (addCollider) this.colliders.push({ minX: cx - w / 2, maxX: cx + w / 2, minZ: cz - d / 2, maxZ: cz + d / 2, top: baseY + h });
    return m;
  }

  // Ramp whose TOP surface passes exactly through (hx,hy,hz)→(lx,ly,lz).
  _ramp(hx, hy, hz, lx, ly, lz, width, color) {
    const fwd = new THREE.Vector3(hx - lx, hy - ly, hz - lz);
    const len = fwd.length(); fwd.normalize();
    const side = new THREE.Vector3().crossVectors(UP, fwd).normalize();
    const up = new THREE.Vector3().crossVectors(fwd, side).normalize();
    const thick = 0.4;
    const m = new THREE.Mesh(new THREE.BoxGeometry(width, thick, len), this.matRamp);
    m.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(side, up, fwd));
    m.position.set((hx + lx) / 2, (hy + ly) / 2, (hz + lz) / 2).addScaledVector(up, -thick / 2);
    m.castShadow = true; m.receiveShadow = true;
    this.group.add(m); this.walkables.push(m);
    // glowing side rails
    for (const s of [-1, 1]) {
      const rail = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.14, len), this._neon(color));
      rail.quaternion.copy(m.quaternion);
      rail.position.copy(m.position).addScaledVector(side, s * width / 2).addScaledVector(up, 0.2);
      this.group.add(rail);
    }
    // glowing rungs across the ramp so it reads as a climbable surface
    const rungs = Math.max(2, Math.round(len / 1.4));
    for (let i = 1; i < rungs; i++) {
      const t = i / rungs;
      const rung = new THREE.Mesh(new THREE.BoxGeometry(width * 0.82, 0.05, 0.16), this._neon(color));
      rung.quaternion.copy(m.quaternion);
      rung.position.set(lx + (hx - lx) * t, ly + (hy - ly) * t, lz + (hz - lz) * t).addScaledVector(up, 0.03);
      this.group.add(rung);
    }
    return m;
  }

  // Horizontal plank bridge between two points at height y.
  _bridge(x1, z1, x2, z2, y, width, color) {
    const fwd = new THREE.Vector3(x2 - x1, 0, z2 - z1);
    const len = fwd.length(); fwd.normalize();
    const m = new THREE.Mesh(new THREE.BoxGeometry(width, 0.35, len), this.matStruct);
    m.quaternion.setFromUnitVectors(ZAX, fwd);
    m.position.set((x1 + x2) / 2, y - 0.175, (z1 + z2) / 2);
    m.castShadow = true; m.receiveShadow = true;
    this.group.add(m); this.walkables.push(m);
    const side = new THREE.Vector3().crossVectors(UP, fwd).normalize();
    for (const s of [-1, 1]) {
      const rail = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.55, len), this._neon(color));
      rail.quaternion.copy(m.quaternion);
      rail.position.copy(m.position).addScaledVector(side, s * width / 2).addScaledVector(UP, 0.2);
      this.group.add(rail);
    }
    // edge outline along the deck
    const edge = new THREE.Mesh(new THREE.BoxGeometry(width + 0.1, 0.06, len), this._neon(color));
    edge.quaternion.copy(m.quaternion); edge.position.set((x1 + x2) / 2, y + 0.03, (z1 + z2) / 2);
    this.group.add(edge);
  }

  _fort(cx, cz, color) {
    const sx = Math.sign(cx);
    this._block(cx, cz, 0, 15, 15, 3, color);     // tier 1 (roof y3)
    this._block(cx, cz, 3, 8, 8, 3, color);       // tier 2 (roof y6 = top)
    // ground -> tier1, top surface flush with the tier-1 deck edge
    this._ramp(cx - sx * 7.0, 3, cz, cx - sx * 14.5, 0, cz, 5, color);
    // tier1 -> tier2 (top), switchback
    this._ramp(cx - sx * 3.6, 6, cz, cx - sx * 9.2, 3, cz, 4, color);
    // glowing beacon
    const beacon = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.16, 2.2, 8), this._neon(color));
    beacon.position.set(cx, 7.1, cz); this.group.add(beacon);
    const lamp = new THREE.PointLight(color, 0.6, 34); lamp.position.set(cx, 8, cz); this.group.add(lamp);
  }

  _build() {
    const H = this.HALF;
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(H * 2 + 12, H * 2 + 12), this.matFloor);
    floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true;
    this.group.add(floor); this.walkables.push(floor);
    const g1 = new THREE.GridHelper(H * 2, 50, 0x2f8fc4, 0x1b3a52);
    g1.position.y = 0.03; g1.material.transparent = true; g1.material.opacity = 0.6; this.group.add(g1);

    // perimeter walls
    const wallMat = new THREE.MeshStandardMaterial({ color: 0x232a40, roughness: 0.6, metalness: 0.5 });
    const wh = 9;
    for (const [x, z, w, d] of [[0, -H, H * 2, 1], [0, H, H * 2, 1], [-H, 0, 1, H * 2], [H, 0, 1, H * 2]]) {
      const wall = new THREE.Mesh(new THREE.BoxGeometry(w, wh, d), wallMat);
      wall.position.set(x, wh / 2, z); wall.castShadow = true; wall.receiveShadow = true;
      this.group.add(wall); this.walkables.push(wall);
      const trim = new THREE.Mesh(new THREE.BoxGeometry(w, 0.3, d), this._neon(COLORS.cyan));
      trim.position.set(x, wh - 0.3, z); this.group.add(trim);
      const trim2 = new THREE.Mesh(new THREE.BoxGeometry(w, 0.3, d), this._neon(COLORS.magenta));
      trim2.position.set(x, 0.4, z); this.group.add(trim2);
      this.colliders.push({ minX: x - w / 2, maxX: x + w / 2, minZ: z - d / 2, maxZ: z + d / 2, top: 99 });
    }

    const fp = [[-26, -26], [26, -26], [-26, 26], [26, 26]];
    fp.forEach((p, i) => this._fort(p[0], p[1], FORT_COLORS[i]));

    // TOP bridge ring (y6) connecting all four fort roofs — Block Fort style
    this._bridge(-22, -26, 22, -26, 6, 4.5, COLORS.cyan);    // north edge (fort0-fort1)
    this._bridge(-22, 26, 22, 26, 6, 4.5, COLORS.amber);     // south edge (fort2-fort3)
    this._bridge(-26, -22, -26, 22, 6, 4.5, COLORS.magenta); // west edge (fort0-fort2)
    this._bridge(26, -22, 26, 22, 6, 4.5, COLORS.lime);      // east edge (fort1-fort3)

    // central platform (top y1.4) with aligned ramps on all four sides
    this._block(0, 0, 0, 13, 13, 1.4, COLORS.cyan);
    this._ramp(0, 1.4, 6.0, 0, 0, 12, 4.5, COLORS.cyan);
    this._ramp(0, 1.4, -6.0, 0, 0, -12, 4.5, COLORS.cyan);
    this._ramp(6.0, 1.4, 0, 12, 0, 0, 4.5, COLORS.cyan);
    this._ramp(-6.0, 1.4, 0, -12, 0, 0, 4.5, COLORS.cyan);
    this._block(0, 0, 1.4, 2.4, 2.4, 4.5, COLORS.magenta); // central obelisk cover

    // cover crates (kept off the central lanes)
    const crates = [[-13, 9], [13, -9], [-9, -15], [11, 15], [17, 0], [-17, 2], [19, 17], [-19, -17]];
    for (let i = 0; i < crates.length; i++) {
      const [x, z] = crates[i]; const h = 1.6 + (i % 3) * 0.5;
      this._block(x, z, 0, 2.6, 2.6, h, FORT_COLORS[i % 4]);
    }

    // spawn points: inner + outer ground rings in open lanes
    for (const r of [20, 34]) for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2 + (r === 20 ? 0.26 : 0);
      const x = Math.cos(a) * r, z = Math.sin(a) * r;
      // keep clear of fort footprints
      if (this._segClear(x, z, x, z)) this.spawnPoints.push({ x, y: 0, z });
    }

    // distant neon skyline
    const skMat = new THREE.MeshStandardMaterial({ color: 0x0b0a1c, roughness: 1 });
    for (let i = 0; i < 44; i++) {
      const a = (i / 44) * Math.PI * 2, r = 92 + (i % 5) * 15, h = 30 + (i * 7 % 80), w = 7 + (i * 3 % 11);
      const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, w), skMat);
      b.position.set(Math.cos(a) * r, h / 2 - 2, Math.sin(a) * r); this.group.add(b);
      const strip = new THREE.Mesh(new THREE.BoxGeometry(w * 0.18, h * 0.7, 0.2), this._neon(FORT_COLORS[i % 4]));
      strip.position.set(b.position.x, h * 0.5, b.position.z + w / 2); this.group.add(strip);
    }

    this._buildNav();
  }

  _buildNav() {
    const N = this.navNodes;
    const node = (x, y, z) => { N.push({ x, y, z, edges: [] }); return N.length - 1; };
    const edge = (a, b) => {
      if (a == null || b == null || a === b) return;
      const A = N[a], B = N[b], c = Math.hypot(A.x - B.x, A.y - B.y, A.z - B.z);
      A.edges.push({ to: b, cost: c }); B.edges.push({ to: a, cost: c });
    };
    const gpts = [[0, -40], [0, -22], [0, -10], [0, 10], [0, 22], [0, 40],
                  [-40, 0], [-22, 0], [-10, 0], [10, 0], [22, 0], [40, 0]];
    const fp = [[-26, -26], [26, -26], [-26, 26], [26, 26]];
    const FB = fp.map(([cx, cz]) => { const sx = Math.sign(cx); return node(cx - sx * 14.5, 0, cz); });
    const ground = [...FB];
    for (const [x, z] of gpts) ground.push(node(x, 0, z));
    const CB = [[0, 12], [0, -12], [12, 0], [-12, 0]].map(([x, z]) => node(x, 0, z));
    ground.push(...CB);
    const CT = node(0, 1.4, 0);
    for (const cb of CB) edge(cb, CT);
    for (let i = 0; i < ground.length; i++)
      for (let j = i + 1; j < ground.length; j++) {
        const a = N[ground[i]], b = N[ground[j]];
        if (Math.hypot(a.x - b.x, a.z - b.z) > 30) continue;
        if (this._segClear(a.x, a.z, b.x, b.z)) edge(ground[i], ground[j]);
      }
    // per-fort: FB -> R1(tier1) -> R2b -> TOP(roof y6)
    const TOP = [];
    fp.forEach(([cx, cz], i) => {
      const sx = Math.sign(cx);
      const r1 = node(cx - sx * 6, 3, cz);
      const r2b = node(cx - sx * 8.5, 3, cz);
      const top = node(cx, 6, cz); TOP.push(top);
      edge(FB[i], r1); edge(r1, r2b); edge(r2b, top);
    });
    // TOP bridge ring connects all fort roofs
    edge(TOP[0], TOP[1]); edge(TOP[2], TOP[3]); edge(TOP[0], TOP[2]); edge(TOP[1], TOP[3]);
  }

  _segClear(x1, z1, x2, z2) {
    for (let t = 0.08; t <= 0.92; t += 0.08) {
      const x = x1 + (x2 - x1) * t, z = z1 + (z2 - z1) * t;
      for (const c of this.colliders) {
        if (c.top < 1.0 || c.top > 50) continue;
        if (x > c.minX - 0.6 && x < c.maxX + 0.6 && z > c.minZ - 0.6 && z < c.maxZ + 0.6) return false;
      }
    }
    return true;
  }

  nearestNode(x, y, z) {
    let best = 0, bd = Infinity;
    for (let i = 0; i < this.navNodes.length; i++) {
      const n = this.navNodes[i];
      const d = (n.x - x) ** 2 + (n.z - z) ** 2 + ((n.y - y) * 3) ** 2;
      if (d < bd) { bd = d; best = i; }
    }
    return best;
  }

  sampleFloor(x, z, originY) {
    this._ro.set(x, originY, z);
    this._ray.set(this._ro, this._rd);
    // reach ~2 units below y=0 from any starting height
    this._ray.far = originY + 2;
    const hits = this._ray.intersectObjects(this.walkables, false);
    return hits.length ? hits[0].point.y : null;
  }

  blocked(x, z, feetY, r, step) {
    const H = this.HALF;
    if (x < -H + r || x > H - r || z < -H + r || z > H - r) return true;
    for (const c of this.colliders) {
      if (feetY >= c.top - step) continue;
      const cx = clamp(x, c.minX, c.maxX), cz = clamp(z, c.minZ, c.maxZ);
      const dx = x - cx, dz = z - cz;
      if (dx * dx + dz * dz < r * r) return true;
    }
    return false;
  }
}
