// Hand-built Seattle landmarks. These are always in the scene (no streaming) so
// the Needle is visible from Beacon Hill, the way it should be.

import * as THREE from './three.js';
import * as G from './geo.js';
import { mergeByMaterial } from './build.js';

const M = (c, o = {}) => new THREE.MeshLambertMaterial({ color: c, ...o });

const mat = {
  white: M(0xe9e6df),
  cream: M(0xd9cfbe),
  gold: M(0xc79a4a),
  steel: M(0x9aa2a8),
  darkSteel: M(0x59626a),
  glass: new THREE.MeshPhongMaterial({ color: 0x8fb9cf, shininess: 80, specular: 0xffffff, transparent: true, opacity: 0.72 }),
  glassSolid: M(0x9dc4d6),
  concrete: M(0xb4b2ab),
  red: M(0xb5342c),
  neon: new THREE.MeshBasicMaterial({ color: 0xff3b30 }),
  neonBlue: new THREE.MeshBasicMaterial({ color: 0x4fc3f7 }),
  green: M(0x3f7f4a),
  grass: M(0x76a355),
  rust: M(0x8a5230),
  brick: M(0x9b5b45),
  dark: M(0x3a3f45),
  wood: M(0x8a6b4a),
  wsfGreen: M(0x1c6b52),
  turf: M(0x3f8a3a),
  dirt: M(0x8a6c4a),
};

function sign(text, w, h, bg, fg, opts = {}) {
  const c = document.createElement('canvas');
  const scale = 24;
  c.width = Math.max(64, Math.round(w * scale));
  c.height = Math.max(32, Math.round(h * scale));
  const g = c.getContext('2d');
  if (bg) { g.fillStyle = bg; g.fillRect(0, 0, c.width, c.height); }
  else g.clearRect(0, 0, c.width, c.height);
  g.fillStyle = fg;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  const lines = text.split('\n');
  const fs = (c.height / lines.length) * 0.62;
  g.font = `${opts.weight || 700} ${fs}px ${opts.font || 'Helvetica, Arial, sans-serif'}`;
  if (opts.glow) { g.shadowColor = fg; g.shadowBlur = fs * 0.6; }
  lines.forEach((l, i) => g.fillText(l, c.width / 2, (c.height / lines.length) * (i + 0.5)));
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  const m = new THREE.Mesh(
    new THREE.PlaneGeometry(w, h),
    new THREE.MeshBasicMaterial({ map: t, transparent: !bg, side: THREE.DoubleSide })
  );
  return m;
}

function box(w, h, d, m, x = 0, y = 0, z = 0, ry = 0) {
  const o = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
  o.position.set(x, y + h / 2, z);
  o.rotation.y = ry;
  return o;
}
function cyl(rt, rb, h, m, x = 0, y = 0, z = 0, seg = 16) {
  const o = new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, seg), m);
  o.position.set(x, y + h / 2, z);
  return o;
}

// ---------------------------------------------------------------------------

function spaceNeedle() {
  const g = new THREE.Group();
  g.add(cyl(14, 22, 2.5, mat.concrete, 0, 0, 0, 24));
  // three tapering legs sweeping inward
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2 + 0.5;
    for (let s = 0; s < 5; s++) {
      const t0 = s / 5, t1 = (s + 1) / 5;
      const r0 = 19 - 15 * Math.pow(t0, 0.75), r1 = 19 - 15 * Math.pow(t1, 0.75);
      const y0 = 2 + 96 * t0, y1 = 2 + 96 * t1;
      const x0 = Math.cos(a) * r0, z0 = Math.sin(a) * r0;
      const x1 = Math.cos(a) * r1, z1 = Math.sin(a) * r1;
      const len = Math.hypot(x1 - x0, y1 - y0, z1 - z0);
      const leg = new THREE.Mesh(new THREE.BoxGeometry(3.2 - t0 * 1.2, len, 2.2), mat.white);
      leg.position.set((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
      leg.lookAt(new THREE.Vector3(x1, y1, z1));
      leg.rotateX(Math.PI / 2);
      g.add(leg);
    }
  }
  g.add(cyl(2.6, 3.4, 152, mat.white, 0, 2, 0, 12));
  // halo
  g.add(cyl(23, 15, 4.2, mat.white, 0, 118, 0, 28));
  g.add(cyl(23.5, 23.5, 3.2, mat.gold, 0, 122, 0, 28));
  const glassRing = cyl(19, 19, 4.5, mat.glass, 0, 125, 0, 28);
  g.add(glassRing);
  g.add(cyl(13, 21, 3.4, mat.white, 0, 129.5, 0, 28));
  g.add(cyl(9, 13, 5, mat.white, 0, 133, 0, 24));
  g.add(cyl(0.8, 1.6, 46, mat.white, 0, 138, 0, 8));
  const beacon = new THREE.Mesh(new THREE.SphereGeometry(1.4, 10, 8), new THREE.MeshBasicMaterial({ color: 0xff6b3d }));
  beacon.position.y = 185;
  g.add(beacon);
  return g;
}

function mopop() {
  const g = new THREE.Group();
  const cols = [0xc0224b, 0xd8a021, 0x8b8f96, 0x3f6fa8, 0x7d3b8e];
  for (let i = 0; i < 5; i++) {
    const s = new THREE.Mesh(new THREE.SphereGeometry(15, 16, 12), M(cols[i], { flatShading: false }));
    s.scale.set(1.5, 0.55, 1.0);
    s.position.set(Math.cos(i * 1.4) * 16, 7 + (i % 2) * 3, Math.sin(i * 1.4) * 12);
    s.rotation.y = i * 0.8;
    g.add(s);
  }
  return g;
}

function arena() {
  const g = new THREE.Group();
  g.add(box(120, 9, 120, mat.concrete, 0, 0, 0, 0.2));
  const roof = new THREE.Mesh(new THREE.ConeGeometry(94, 22, 4), mat.steel);
  roof.position.y = 9 + 11;
  roof.rotation.y = Math.PI / 4 + 0.2;
  g.add(roof);
  const s = sign('CLIMATE PLEDGE ARENA', 44, 5, null, '#eaf6ff', { glow: true });
  s.position.set(0, 12, 62);
  g.add(s);
  return g;
}

function spheres() {
  const g = new THREE.Group();
  const spec = [[0, 0, 20], [26, -6, 15], [-24, 8, 16]];
  for (const [x, z, r] of spec) {
    const s = new THREE.Mesh(new THREE.IcosahedronGeometry(r, 2), new THREE.MeshPhongMaterial({
      color: 0x9fd5b8, shininess: 60, transparent: true, opacity: 0.55, wireframe: false,
    }));
    s.position.set(x, r * 0.92, z);
    g.add(s);
    const frame = new THREE.Mesh(new THREE.IcosahedronGeometry(r * 1.005, 2), new THREE.MeshBasicMaterial({ color: 0x2f4f3f, wireframe: true }));
    frame.position.copy(s.position);
    g.add(frame);
    g.add(cyl(r * 0.5, r * 0.55, 2, mat.concrete, x, 0, z, 16));
  }
  return g;
}

function market() {
  const g = new THREE.Group();
  g.add(box(120, 11, 34, M(0xe8e2d6), 0, 0, 0));
  g.add(box(124, 1.2, 38, mat.dark, 0, 11, 0));
  g.add(box(60, 7, 30, M(0xd8cfc0), -18, 11.2, 4));
  // awnings
  for (let i = -5; i <= 5; i++) g.add(box(9, 0.5, 4, i % 2 ? mat.red : M(0x2f6f4f), i * 10, 4.4, 18.4));
  const s = sign('PUBLIC MARKET CENTER', 42, 6.5, '#101010', '#ff3b30', { glow: true });
  s.position.set(6, 17, 18.6);
  g.add(s);
  const s2 = sign('FARMERS MARKET', 26, 3.4, '#101010', '#ffd24a', { glow: true });
  s2.position.set(6, 12.6, 18.6);
  g.add(s2);
  const clock = new THREE.Mesh(new THREE.CircleGeometry(3, 20), new THREE.MeshBasicMaterial({ color: 0xf5f0e0 }));
  clock.position.set(-16, 15, 18.7);
  g.add(clock);
  g.add(box(0.4, 2.2, 0.3, mat.dark, -16, 15, 18.9));
  return g;
}

function wheel() {
  const g = new THREE.Group();
  g.add(box(60, 2, 34, mat.wood, 0, -1, 0));
  const R = 26;
  const ring = new THREE.Mesh(new THREE.TorusGeometry(R, 0.7, 8, 40), mat.white);
  ring.position.y = R + 5;
  g.add(ring);
  const ring2 = new THREE.Mesh(new THREE.TorusGeometry(R * 0.55, 0.4, 6, 30), mat.white);
  ring2.position.y = R + 5;
  g.add(ring2);
  const hub = cyl(1.6, 1.6, 5, mat.steel, 0, R + 2.5, 0, 10);
  hub.rotation.x = Math.PI / 2;
  g.add(hub);
  for (let i = 0; i < 20; i++) {
    const a = (i / 20) * Math.PI * 2;
    const spoke = new THREE.Mesh(new THREE.BoxGeometry(0.25, R, 0.25), mat.white);
    spoke.position.set(Math.cos(a) * R * 0.5, R + 5 + Math.sin(a) * R * 0.5, 0);
    spoke.rotation.z = -a + Math.PI / 2;
    g.add(spoke);
    const car = box(3, 3, 3.4, i % 2 ? mat.glassSolid : M(0x2b6ea8), Math.cos(a) * R, R + 3.4 + Math.sin(a) * R, 0);
    g.add(car);
  }
  for (const s of [-1, 1]) {
    const leg = new THREE.Mesh(new THREE.BoxGeometry(1.6, 34, 1.6), mat.steel);
    leg.position.set(0, 17, s * 9);
    leg.rotation.x = s * 0.28;
    g.add(leg);
  }
  return g;
}

function library() {
  const g = new THREE.Group();
  const glass = new THREE.MeshPhongMaterial({ color: 0x9fd2c9, shininess: 70, transparent: true, opacity: 0.8 });
  const parts = [
    [56, 14, 46, 0, 0, 0], [44, 12, 38, 8, 14, 4], [62, 18, 50, -6, 26, -3],
    [40, 14, 34, 10, 44, 6], [50, 10, 42, -2, 58, 0],
  ];
  for (const [w, h, d, x, y, z] of parts) {
    g.add(box(w, h, d, glass, x, y, z, 0.06 * y));
    const frame = new THREE.Mesh(new THREE.BoxGeometry(w * 1.005, h * 1.005, d * 1.005), new THREE.MeshBasicMaterial({ color: 0x2b4a52, wireframe: true }));
    frame.position.set(x, y + h / 2, z);
    frame.rotation.y = 0.06 * y;
    g.add(frame);
  }
  return g;
}

function stadium(opts) {
  const g = new THREE.Group();
  const { rx, rz, h, roof, name, colA, colB, turf } = opts;
  const seg = 28;
  for (let i = 0; i < seg; i++) {
    const a0 = (i / seg) * Math.PI * 2, a1 = ((i + 1) / seg) * Math.PI * 2;
    const am = (a0 + a1) / 2;
    const x = Math.cos(am) * rx, z = Math.sin(am) * rz;
    const w = Math.hypot(Math.cos(a1) * rx - Math.cos(a0) * rx, Math.sin(a1) * rz - Math.sin(a0) * rz) * 1.06;
    const b = box(w, h, 26, i % 3 === 0 ? colB : colA, x, 0, z, -Math.atan2(Math.sin(am) * rz, Math.cos(am) * rx) + Math.PI / 2);
    g.add(b);
    const upper = box(w, 6, 18, mat.darkSteel, x * 1.04, h, z * 1.04, -Math.atan2(Math.sin(am) * rz, Math.cos(am) * rx) + Math.PI / 2);
    g.add(upper);
  }
  const field = new THREE.Mesh(new THREE.CircleGeometry(1, 32), turf ? mat.turf : mat.dirt);
  field.rotation.x = -Math.PI / 2;
  field.scale.set(rx - 24, rz - 24, 1);
  field.position.y = 1.2;
  g.add(field);
  if (roof) {
    for (const s of [-1, 1]) {
      const arc = new THREE.Mesh(new THREE.TorusGeometry(rx * 0.98, 1.6, 6, 24, Math.PI * 0.7), mat.steel);
      arc.position.set(0, h + 6, s * rz * 0.55);
      arc.rotation.set(-Math.PI / 2, 0, 0);
      arc.rotateX(-0.9);
      g.add(arc);
      const canopy = new THREE.Mesh(new THREE.BoxGeometry(rx * 1.5, 0.8, rz * 0.6), mat.steel);
      canopy.position.set(0, h + 11, s * rz * 0.75);
      canopy.rotation.x = s * 0.12;
      g.add(canopy);
    }
  }
  const s = sign(name, rx * 0.9, 6, null, '#ffffff', { glow: true });
  s.position.set(0, h + 4, rz + 1);
  g.add(s);
  return g;
}

function gasworks() {
  const g = new THREE.Group();
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    g.add(cyl(4.5, 5.5, 16 + (i % 3) * 6, mat.rust, Math.cos(a) * 12, 0, Math.sin(a) * 12, 12));
  }
  g.add(cyl(7, 8, 26, mat.rust, 0, 0, 0, 14));
  for (let i = 0; i < 5; i++) {
    g.add(box(24, 0.6, 0.6, mat.rust, 0, 10 + i * 3, 0, i * 0.6));
  }
  return g;
}

function troll() {
  const g = new THREE.Group();
  const head = new THREE.Mesh(new THREE.SphereGeometry(6, 12, 10), M(0x8d8f8a));
  head.position.set(0, 5, 0);
  head.scale.set(1, 1.1, 0.9);
  g.add(head);
  const eye = new THREE.Mesh(new THREE.SphereGeometry(1.1, 8, 8), new THREE.MeshBasicMaterial({ color: 0xdad2c0 }));
  eye.position.set(-2.2, 7, 5);
  g.add(eye);
  const hand = new THREE.Mesh(new THREE.SphereGeometry(4, 10, 8), M(0x8d8f8a));
  hand.position.set(9, 2.5, 3);
  hand.scale.set(1.3, 0.7, 1);
  g.add(hand);
  const vw = box(4.4, 3.4, 9, M(0x3f6fa8), 9, 4.5, 3, 0.3);
  g.add(vw);
  return g;
}

function locks() {
  const g = new THREE.Group();
  g.add(box(140, 5, 26, mat.concrete, 0, -2, 0));
  g.add(box(140, 3, 8, mat.concrete, 0, 3, -14));
  g.add(box(140, 3, 8, mat.concrete, 0, 3, 14));
  for (let i = -2; i <= 2; i++) g.add(box(3, 8, 26, mat.darkSteel, i * 30, 3, 0));
  return g;
}

function ferryTerminal() {
  const g = new THREE.Group();
  g.add(box(70, 8, 40, M(0xcfd6d9), 0, 0, 0));
  g.add(box(74, 1.4, 44, mat.dark, 0, 8, 0));
  g.add(box(30, 5, 24, M(0xdde3e6), 12, 9.4, 0));
  const s = sign('WASHINGTON STATE FERRIES', 30, 3.2, '#0d3b2e', '#ffffff');
  s.position.set(0, 11, 20.3);
  g.add(s);
  // moored ferry
  const boat = new THREE.Group();
  boat.add(box(24, 6, 78, mat.white, 0, -1.5, 0));
  boat.add(box(22, 5, 60, mat.wsfGreen, 0, 4.5, 0));
  boat.add(box(16, 4, 26, mat.white, 0, 9.5, 0));
  boat.add(box(8, 3.5, 10, mat.white, 0, 13.5, 0));
  boat.add(cyl(1.6, 1.6, 8, M(0x1c6b52), 0, 17, -6, 10));
  boat.position.set(-52, 0, 10);
  boat.rotation.y = 0.1;
  g.add(boat);
  return g;
}

function pier() {
  const g = new THREE.Group();
  g.add(box(46, 2, 90, mat.wood, 0, -1, 0));
  g.add(box(30, 10, 60, M(0xd8d3c6), 0, 1, 0));
  g.add(box(34, 1.2, 64, mat.red, 0, 11, 0));
  for (let i = -2; i <= 2; i++)
    for (let j = -3; j <= 3; j++) g.add(cyl(0.7, 0.7, 12, mat.wood, i * 10, -12, j * 13, 6));
  return g;
}

function kerryPark() {
  const g = new THREE.Group();
  g.add(box(50, 1, 16, mat.concrete, 0, -0.5, 0));
  for (let i = -5; i <= 5; i++) g.add(cyl(0.16, 0.16, 1.1, mat.darkSteel, i * 4.5, 0.5, 7, 6));
  g.add(box(46, 0.2, 0.2, mat.darkSteel, 0, 1.6, 7));
  const arch = new THREE.Mesh(new THREE.TorusGeometry(3.4, 0.5, 6, 14, Math.PI), M(0x6e747a));
  arch.position.set(-14, 1, 0);
  g.add(arch);
  return g;
}

function statueLiberty() {
  const g = new THREE.Group();
  g.add(box(6, 5, 6, mat.concrete, 0, 0, 0));
  const body = cyl(1.2, 2.2, 7, M(0x66a89a), 0, 5, 0, 10);
  g.add(body);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.9, 8, 8), M(0x66a89a));
  head.position.y = 12.6;
  g.add(head);
  const arm = new THREE.Mesh(new THREE.BoxGeometry(0.6, 4, 0.6), M(0x66a89a));
  arm.position.set(1.4, 12, 0);
  arm.rotation.z = -0.4;
  g.add(arm);
  const torch = new THREE.Mesh(new THREE.ConeGeometry(0.7, 1.4, 8), new THREE.MeshBasicMaterial({ color: 0xffcf6b }));
  torch.position.set(2.6, 14.4, 0);
  g.add(torch);
  return g;
}

function convention() {
  const g = new THREE.Group();
  const glass = new THREE.MeshPhongMaterial({ color: 0xa8cfe0, shininess: 60, transparent: true, opacity: 0.7 });
  g.add(box(120, 26, 70, glass, 0, 0, 0));
  const vault = new THREE.Mesh(new THREE.CylinderGeometry(36, 36, 118, 16, 1, false, 0, Math.PI), glass);
  vault.rotation.z = Math.PI / 2;
  vault.position.set(0, 26, 0);
  g.add(vault);
  return g;
}

function aquarium() {
  const g = new THREE.Group();
  g.add(box(40, 2, 60, mat.wood, 0, -1, 0));
  g.add(box(30, 9, 44, M(0x4b6f86), 0, 1, 0));
  g.add(box(34, 1.2, 48, mat.white, 0, 10, 0));
  const s = sign('SEATTLE AQUARIUM', 22, 3, '#0f3d55', '#ffffff');
  s.position.set(0, 12, 24.2);
  g.add(s);
  return g;
}

// ---------------------------------------------------------------------------

/**
 * Radius, in metres, that each landmark needs to itself.
 *
 * OSM has footprints for these too -- the Space Needle is a 38 x 38 m building
 * tagged 184 m tall -- so without this the importer draws a generic grey tower
 * in exactly the same place as the hand-built mesh and swallows it whole. That
 * is where the Space Needle went. This file owns the meshes, so it is the file
 * that knows how much room each one takes; keep a new entry here whenever a
 * landmark is added or `buildLandmarks` will quietly be building it inside a box.
 */

/**
 * Boeing Field. The ARP sits mid-airfield and the runway is laid out in real
 * metres from it: 14R/32L is 3048 m on a ~150 deg true bearing, which in this
 * frame (+X east, +Z south) is a yaw of about -0.52 rad. The hangars along the
 * east apron are real OSM buildings and arrive on their own; what this builds
 * is the pavement the data has no layer for -- runway, parallel taxiway,
 * apron -- plus the tower, a windsock, and threshold markings, so it reads as
 * an airfield from the air. The apron's parked planes are spawned by main.js.
 */
function airport() {
  const g = new THREE.Group();
  const asphalt = M(0x53565b);
  const paintW = new THREE.MeshBasicMaterial({ color: 0xe8e8e2 });
  // Axes SPELLED OUT, because two rotation conventions meet here and they
  // disagree in the sign of x. landmark box() rotates a THREE mesh: its
  // rotation.y = t maps local +z to (sin t, cos t). build.js's box() maps
  // local +z to (-sin t, cos t). A helper derived from the wrong one laid the
  // whole 3 km runway along bearing 210 instead of 150 -- present, raycastable,
  // and buried under the un-graded hillside 60 degrees away from its markings.
  // ALONG is the runway direction (bearing 150), ACROSS is 90 right of it.
  const RY = 0.52;                       // THREE rotation.y: sin/cos = (0.497, 0.868)
  const ALONG = [Math.sin(RY), Math.cos(RY)];
  const ACROSS = [Math.cos(RY), -Math.sin(RY)];
  const off = (dx, dz) => [dx * ACROSS[0] + dz * ALONG[0], dx * ACROSS[1] + dz * ALONG[1]];
  // The landmark's origin sits at the terrain height of ONE point, and the
  // field undulates a metre and a half over its 3 km. A single flat slab is
  // therefore always part buried and part plinth -- both were built and both
  // looked wrong. Pavement here drapes the way meshRoad's does: SECTIONS, each
  // sampling the heightfield at its own centre. `base` converts a world
  // terrain sample into this group's local frame.
  // The raster grades the field dead flat at 5.2 m (build_raster's
  // grade_airfield), so pavement is SINGLE slabs -- the earlier per-section
  // drape existed for undulating ground and its seams read as jagged teeth
  // once the ground stopped undulating. Local frame: group origin sits at the
  // field elevation, so a slab top at +0.35 is 35 cm proud everywhere.
  const P = (dx, dz) => off(dx, dz);
  const pav = (dx, dz, w, len) => {
    const [lx, lz] = P(dx, dz);
    g.add(box(w, 2.6, len, asphalt, lx, 0.35 - 2.6, lz, RY));
  };
  const mark = (dx, dz, w, len) => {
    const [lx, lz] = P(dx, dz);
    g.add(box(w, 0.04, len, paintW, lx, 0.36, lz, RY));
  };
  pav(0, 0, 46, 3048);                       // runway 14R/32L
  pav(150, 0, 23, 2600);                     // parallel taxiway, east
  for (let k = -2; k <= 2; k++) {            // stubs joining them
    const [sx, sz] = P(75, k * 520);
    g.add(box(150, 2.6, 18, asphalt, sx, 0.33 - 2.6, sz, RY + Math.PI / 2));
  }
  pav(-205, 70, 130, 380);                   // GA apron, west
  for (const kz of [-40, 180]) {             // apron connectors to the runway
    const [sx, sz] = P(-105, kz);
    g.add(box(160, 2.6, 16, asphalt, sx, 0.33 - 2.6, sz, RY + Math.PI / 2));
  }
  for (let k = -22; k <= 22; k++) mark(0, k * 66, 0.9, 30);          // centreline
  for (const e of [-1, 1]) for (let j = -3; j <= 3; j++) mark(j * 5.4, e * 1470, 1.8, 40);
  for (const e of [-1, 1]) for (const sdx of [-21.5, 21.5])          // edge stripes
    mark(sdx, e * 762, 0.7, 1500);

  // tower on the apron edge
  const [twx, twz] = off(-300, -190);
  g.add(box(9, 26, 9, mat.concrete, twx, 13, twz, RY));
  g.add(box(12, 4.4, 12, mat.glassSolid, twx, 28.2, twz, RY + 0.4));
  g.add(box(13, 0.7, 13, mat.darkSteel, twx, 30.7, twz, RY + 0.4));
  // windsock
  const [wx, wz] = off(-120, -900);
  g.add(cyl(0.12, 0.12, 7, mat.darkSteel, wx, 3.5, wz, 6));
  g.add(cyl(0.02, 0.55, 2.2, M(0xd9601f), wx, 6.6, wz, 8).rotateZ(Math.PI / 2));
  return g;
}

export const LANDMARK_CLEAR = {
  spaceNeedle: 48, mopop: 62, arena: 95, spheres: 44, market: 75, wheel: 42,
  aquarium: 48, ferry: 72, library: 48, pier: 52, gasworks: 95, troll: 18,
  locks: 75, kerry: 30, ferriswheelPier: 42, convention: 62,
  stadiumF: 135, stadiumB: 128, stadiumH: 122,
  // the tower/apron cluster only -- the runway lies over real open ground and
  // the hangars beside it are real buildings that must stay
  airport: 90, bellevueDT: 40,
};

export function buildLandmarks(scene) {
  const root = new THREE.Group();
  for (const l of G.LANDMARKS) {
    const x = l.p ? l.p[0] : l.x;
    const z = l.p ? l.p[1] : l.z;
    let g = null;
    switch (l.kind) {
      case 'spaceNeedle': g = spaceNeedle(); break;
      case 'mopop': g = mopop(); break;
      case 'arena': g = arena(); break;
      case 'spheres': g = spheres(); break;
      case 'market': g = market(); break;
      case 'wheel': g = wheel(); break;
      case 'library': g = library(); break;
      case 'aquarium': g = aquarium(); break;
      case 'ferry': g = ferryTerminal(); break;
      case 'pier': g = pier(); break;
      case 'gasworks': g = gasworks(); break;
      case 'troll': g = troll(); break;
      case 'locks': g = locks(); break;
      case 'kerry': g = kerryPark(); break;
      case 'ferriswheelPier': g = statueLiberty(); break;
      case 'convention': g = convention(); break;
      case 'airport': g = airport(); break;
      case 'stadiumF':
        g = stadium({ rx: 118, rz: 92, h: 24, roof: true, name: 'LUMEN FIELD', colA: M(0x2c3e50), colB: M(0x69be28), turf: true });
        break;
      case 'stadiumB':
        g = stadium({ rx: 108, rz: 104, h: 22, roof: true, name: 'T-MOBILE PARK', colA: M(0x0c2c56), colB: M(0x005c5c), turf: true });
        break;
      case 'stadiumH':
        g = stadium({ rx: 104, rz: 78, h: 20, roof: false, name: 'HUSKY STADIUM', colA: M(0x4b2e83), colB: M(0xb7a57a), turf: true });
        break;
      default: break;
    }
    if (!g) continue;
    if (g.userData && g.userData.build) g.userData.build(x, z);
    g.position.set(x, G.terrainHeight(x, z), z);
    g.rotation.y = l.rot || 0;
    g.traverse((o) => { if (o.isMesh) { o.castShadow = false; o.receiveShadow = false; } });
    g.userData.landmark = l.name;
    root.add(g);
  }
  const merged = mergeByMaterial(root);
  merged.name = 'landmarks';
  merged.traverse((o) => { if (o.isMesh) o.frustumCulled = false; });
  scene.add(merged);
  return merged;
}
