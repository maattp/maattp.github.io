// FREIGHT ROLLING STOCK: the locomotives and cars freight.js strings into
// trains. Each is built once, in car-local metres -- +z toward the car's A
// end (the end that leads), y = 0 on the rail head, x to the left -- into three
// builders: `body` (vertex-coloured, the body material), `trim` (the vehicle
// trim material: glass, lamps, chrome) and `decal` (UV-mapped into the
// lettering atlas below: logos, reporting marks, placards).
//
// WHERE THE NUMBERS COME FROM
//   [GE]   GE Transportation, ES44AC / ES44C4 Evolution Series data sheets:
//          73 ft 2 in over couplers, 15 ft 5 in high, 10 ft 3 in wide,
//          truck centres 54 ft 8 in, 42 in wheels, 4,400 hp
//   [TR]   Trinity Industries 4750 cu ft covered hopper: 59 ft 9 in over
//          strikers, 15 ft 5 in high, truck centres 45 ft 11 in
//   [FG]   FreightCar America BethGon II aluminum coal gondola: 53 ft 1 in,
//          12 ft 9 in high, truck centres 40 ft 6 in
//   [DOT]  49 CFR 179.202 DOT-117 tank car: 9/16 in steel, a full-height
//          head shield, a jacket; ~59 ft, 30,000 gal class
//   [BX]   Greenbrier 50 ft plate F boxcar: 57 ft 5 in over strikers,
//          17 ft high, truck centres 43 ft 6 in
//   [AAR]  couplers 34.5 in over the rail; 36 in freight wheels
//   est.   no source publishes it; what it was set from is said
//
// Liveries: BNSF's current "swoosh" (Heritage III): orange carbody, black
// roof and cab top, a yellow stripe between, "BNSF" on the long hood. CN's:
// black over red with a white stripe, the CN logo on the hood and the nose.

import * as THREE from './three.js';
import { Builder } from './build.js';
import { GLASS } from './vehicles.js';

const uv0 = [0, 0, 1, 0, 1, 1, 0, 1];
const UP = [0, 1, 0], DOWN = [0, -1, 0];

// sRGB hex -> the linear triples the vertex colours want
const lin = (h) => {
  const f = (c) => { c /= 255; return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
  return [f((h >> 16) & 255), f((h >> 8) & 255), f(h & 255)];
};
const C = {
  bnsfOrange: lin(0xe35a1c), bnsfBlack: lin(0x1c1c1c), bnsfYellow: lin(0xf2b705),
  cnRed: lin(0xc8231e), cnBlack: lin(0x161616), white: lin(0xe8e8e4),
  frame: lin(0x1d1d1f), truck: lin(0x232220), truckRust: lin(0x4a3527), wheel: lin(0x3a3632), tread: lin(0x8b8a86),
  steel: lin(0x55575a), dark: lin(0x121212), grille: lin(0x2a2a2a), yellow: lin(0xe8b400),
  hopperGrey: lin(0xaaaaa5), hopperGreyD: lin(0x8c8c88), cnHopper: lin(0x9a9a96),
  alu: lin(0xa5a7a8), aluD: lin(0x7d7f80), coal: lin(0x16161a), coalHi: lin(0x2c2c30),
  tank: lin(0x1b1b1c), tankD: lin(0x0f0f10),
  boxBnsf: lin(0x6b3a26), boxCn: lin(0x7a2a1c), boxRoof: lin(0x5a5a58), rust: lin(0x5a3a28),
  glassDark: lin(0x10181e), lamp: [1.0, 0.97, 0.88], red: [0.9, 0.05, 0.03], amber: [1.0, 0.6, 0.08],
};
export const RAIL_COLOURS = C;

// ---------------------------------------------------------------------------
// The lettering atlas: every logo, mark and placard on one canvas.

const ATLAS_W = 2048, ATLAS_H = 1536;   // every cell must fit: the last row ends at ~1455
let _atlas = null;
export function railDecals() {
  if (_atlas) return _atlas;
  const c = document.createElement('canvas'); c.width = ATLAS_W; c.height = ATLAS_H;
  const g = c.getContext('2d');
  const cells = {};
  let x = 0, y = 0, rowH = 0;
  const cell = (name, w, h, draw) => {
    if (x + w > ATLAS_W) { x = 0; y += rowH + 4; rowH = 0; }
    g.save(); g.translate(x, y); g.beginPath(); g.rect(0, 0, w, h); g.clip(); draw(g, w, h); g.restore();
    cells[name] = [x / ATLAS_W, 1 - (y + h) / ATLAS_H, (x + w) / ATLAS_W, 1 - y / ATLAS_H];
    x += w + 4; rowH = Math.max(rowH, h);
  };
  const text = (q, s, px, py, size, col, weight = 900, font = 'Helvetica, Arial, sans-serif', align = 'left', scaleX = 1) => {
    q.save(); q.translate(px, py); q.scale(scaleX, 1);
    q.font = `${weight} ${size}px ${font}`; q.fillStyle = col; q.textAlign = align; q.textBaseline = 'middle';
    q.fillText(s, 0, 0); q.restore();
  };
  // BNSF on a long hood: tall black letters, the swoosh-era wordmark
  cell('bnsfHood', 900, 200, (q, w, h) => {
    text(q, 'BNSF', w / 2, h / 2 + 6, 190, '#141414', 900, 'Helvetica, Arial, sans-serif', 'center', 1.18);
  });
  // BNSF on a freight car: black on the car's colour, with the circle-and-cross
  cell('bnsfCar', 700, 160, (q, w, h) => {
    q.fillStyle = '#f0f0ea';
    text(q, 'BNSF', 300, h / 2 + 4, 150, '#f4f4ee', 900, 'Helvetica, Arial, sans-serif', 'center', 1.1);
  });
  cell('bnsfCarDark', 700, 160, (q, w, h) => {
    text(q, 'BNSF', 300, h / 2 + 4, 150, '#161616', 900, 'Helvetica, Arial, sans-serif', 'center', 1.1);
  });
  // the BNSF circle-and-cross emblem
  const emblem = (q, cx, cy, r, ring, fill) => {
    q.fillStyle = fill; q.beginPath(); q.arc(cx, cy, r, 0, Math.PI * 2); q.fill();
    q.strokeStyle = ring; q.lineWidth = r * 0.16; q.beginPath(); q.arc(cx, cy, r * 0.84, 0, Math.PI * 2); q.stroke();
    q.fillStyle = ring; q.fillRect(cx - r * 0.84, cy - r * 0.1, r * 1.68, r * 0.2); q.fillRect(cx - r * 0.1, cy - r * 0.84, r * 0.2, r * 1.68);
  };
  cell('bnsfEmblem', 180, 180, (q, w, h) => emblem(q, w / 2, h / 2, 86, '#f2b705', '#e35a1c'));
  // CN's logo: one continuous stroke making the C and the N
  const cnLogo = (q, w, h, col) => {
    q.save();
    const s = h / 200;
    q.translate(w / 2 - 190 * s, h / 2 - 100 * s); q.scale(s, s);
    q.strokeStyle = col; q.lineWidth = 34; q.lineCap = 'round'; q.lineJoin = 'round';
    q.beginPath();
    // the C: from its top right round the left to the bottom, then straight
    // into the N's first upright, up, the diagonal down, and up again
    q.moveTo(170, 44);
    q.bezierCurveTo(120, 14, 30, 30, 30, 100);
    q.bezierCurveTo(30, 170, 120, 186, 180, 160);
    q.lineTo(220, 160);
    q.lineTo(220, 40);
    q.lineTo(330, 160);
    q.lineTo(330, 40);
    q.stroke();
    q.restore();
  };
  cell('cnRed', 420, 220, (q, w, h) => cnLogo(q, w, h, '#d52b1e'));
  cell('cnWhite', 420, 220, (q, w, h) => cnLogo(q, w, h, '#f2f2ee'));
  // reporting marks and the capacity stencils under them
  const marks = (name, road, num, col = '#f0f0ea', extra = true) => cell(name, 520, 150, (q, w, h) => {
    text(q, road, 10, 42, 64, col, 800);
    text(q, num, 10, 104, 58, col, 800);
    if (extra) {
      text(q, 'CAPY 220000   LD LMT 227600', 300, 46, 18, col, 600);
      text(q, 'LT WT 66400   NEW 08-19', 300, 72, 18, col, 600);
      text(q, 'EXW 10-8   EW 9-7', 300, 98, 18, col, 600);
      text(q, 'PLATE C   RTG 286K', 300, 124, 18, col, 600);
    }
  });
  marks('mkBnsf1', 'BNSF', '471832'); marks('mkBnsf2', 'BNSF', '626401'); marks('mkBnsf3', 'BNSF', '732115');
  marks('mkBnsfD', 'BNSF', '403377', '#141414');
  marks('mkCn1', 'CN', '112345'); marks('mkCn2', 'CN', '407551'); marks('mkCn3', 'CN', '380942');
  marks('mkCnD', 'CN', '113028', '#141414');
  marks('mkUtlx', 'UTLX', '290114'); marks('mkTilx', 'TILX', '310578'); marks('mkGatx', 'GATX', '215870');
  // a locomotive's number: cab side and number boards
  const locoNum = (name, n, col) => cell(name, 260, 110, (q, w, h) => text(q, n, w / 2, h / 2 + 4, 96, col, 800, 'Helvetica, Arial, sans-serif', 'center'));
  locoNum('n6603', '6603', '#141414'); locoNum('n6712', '6712', '#141414');
  locoNum('n2871', '2871', '#f2f2ee'); locoNum('n2925', '2925', '#f2f2ee');
  const board = (name, n) => cell(name, 240, 70, (q, w, h) => {
    q.fillStyle = '#0c0c0c'; q.fillRect(0, 0, w, h);
    text(q, n, w / 2, h / 2 + 3, 58, '#f4f4f0', 800, 'Helvetica, Arial, sans-serif', 'center');
  });
  board('b6603', '6603'); board('b6712', '6712'); board('b2871', '2871'); board('b2925', '2925');
  // hazmat placards: flammable liquid, red, the UN number in a white panel
  const placard = (name, un) => cell(name, 150, 150, (q, w, h) => {
    q.save(); q.translate(w / 2, h / 2); q.rotate(Math.PI / 4);
    q.fillStyle = '#d42a1e'; q.fillRect(-50, -50, 100, 100);
    q.strokeStyle = '#f2f2ee'; q.lineWidth = 4; q.strokeRect(-44, -44, 88, 88);
    q.restore();
    q.fillStyle = '#f4f4f0'; q.fillRect(22, 58, 106, 36);
    text(q, un, w / 2, 77, 30, '#111', 800, 'Helvetica, Arial, sans-serif', 'center');
  });
  placard('un1267', '1267'); placard('un1987', '1987');
  // the crossbuck, a white X with RAILROAD CROSSING
  cell('xbuck', 480, 80, (q, w, h) => {
    q.fillStyle = '#f2f2ee'; q.fillRect(0, 0, w, h);
    q.strokeStyle = '#111'; q.lineWidth = 4; q.strokeRect(3, 3, w - 6, h - 6);
    text(q, 'RAILROAD', w / 2, h / 2 + 3, 50, '#111', 800, 'Helvetica, Arial, sans-serif', 'center');
  });
  cell('xbuck2', 480, 80, (q, w, h) => {
    q.fillStyle = '#f2f2ee'; q.fillRect(0, 0, w, h);
    q.strokeStyle = '#111'; q.lineWidth = 4; q.strokeRect(3, 3, w - 6, h - 6);
    text(q, 'CROSSING', w / 2, h / 2 + 3, 50, '#111', 800, 'Helvetica, Arial, sans-serif', 'center');
  });
  // ES44 builder's plate and the cab-side "GE" / nose stripes
  cell('wings', 400, 200, (q, w, h) => {
    // the BNSF nose: yellow chevron wings on black
    q.fillStyle = '#f2b705';
    q.beginPath(); q.moveTo(0, h * 0.35); q.lineTo(w / 2, h * 0.85); q.lineTo(w, h * 0.35); q.lineTo(w, h * 0.5); q.lineTo(w / 2, h); q.lineTo(0, h * 0.5); q.closePath(); q.fill();
    text(q, 'BNSF', w / 2, h * 0.28, 60, '#f2b705', 900, 'Helvetica, Arial, sans-serif', 'center', 1.1);
  });
  // weathering: grime streaks for a car side, grey on transparent
  cell('grime', 256, 256, (q, w, h) => {
    let seed = 5;
    const R = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (let i = 0; i < 90; i++) {
      const gx = R() * w, gw = 2 + R() * 10, gh = h * (0.2 + R() * 0.8);
      const a = 0.05 + R() * 0.14;
      const gr = q.createLinearGradient(0, 0, 0, gh);
      gr.addColorStop(0, `rgba(40,32,26,${a})`); gr.addColorStop(1, 'rgba(40,32,26,0)');
      q.fillStyle = gr; q.fillRect(gx, 0, gw, gh);
    }
    const gr = q.createLinearGradient(0, h, 0, h * 0.6);
    gr.addColorStop(0, 'rgba(50,38,28,0.35)'); gr.addColorStop(1, 'rgba(50,38,28,0)');
    q.fillStyle = gr; q.fillRect(0, h * 0.6, w, h * 0.4);
  });
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  tex.generateMipmaps = true;
  const mat = new THREE.MeshStandardMaterial({ map: tex, transparent: true, alphaTest: 0.35, depthWrite: false,
    roughness: 0.7, metalness: 0, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
  _atlas = { tex, mat, cells };
  return _atlas;
}

// ---------------------------------------------------------------------------
// Building blocks

/**
 * A lettering panel on a car side. `side` +1 is the car's +x side: seen from
 * there the car's +z runs to the viewer's LEFT, so the cell's u runs toward -z
 * (and toward +z on the other side). A box mirrored this way reads correctly
 * from both.
 */
function sideDecal(D, cells, name, side, x, zc, yc, w, h, off = 0.012) {
  const cl = cells[name];
  if (!cl) return;
  const [u0, v0, u1, v1] = cl;
  const X = x * side + off * side;
  const za = zc + (w / 2) * side, zb = zc - (w / 2) * side;
  D.quad([X, yc - h / 2, za], [X, yc - h / 2, zb], [X, yc + h / 2, zb], [X, yc + h / 2, za], [side, 0, 0],
    [u0, v0, u1, v0, u1, v1, u0, v1], [1, 1, 1]);
}
/** A panel on an end face (normal +z * e), reading from outside. */
function endDecal(D, cells, name, e, z, xc, yc, w, h, off = 0.012) {
  const cl = cells[name];
  if (!cl) return;
  const [u0, v0, u1, v1] = cl;
  const Z = z + off * e;
  const xa = xc - (w / 2) * e, xb = xc + (w / 2) * e;
  D.quad([xa, yc - h / 2, Z], [xb, yc - h / 2, Z], [xb, yc + h / 2, Z], [xa, yc + h / 2, Z], [0, 0, e],
    [u0, v0, u1, v0, u1, v1, u0, v1], [1, 1, 1]);
}

/** A wheelset: two wheels on an axle, 36 in (freight) or 42 in (locomotive). */
function wheelset(B, z, r, gauge = 1.435) {
  const g = gauge / 2;
  for (const s of [1, -1]) {
    // the wheel: rim face, tread, and the flange inside it
    B.tube([s * (g - 0.02), r, z], [s * (g + 0.12), r, z], r, 10, C.wheel, true);
    B.tube([s * (g - 0.05), r, z], [s * (g - 0.02), r, z], r + 0.03, 10, C.wheel, true);
    B.tube([s * (g + 0.12), r, z], [s * (g + 0.16), r, z], r * 0.3, 6, C.steel, true);
  }
  B.tube([-(g + 0.1), r, z], [g + 0.1, r, z], 0.08, 6, C.wheel);
}

/** A three-piece freight truck (two axles 1.78 m apart), centred at z. */
function freightTruck(B, z) {
  const r = 0.457, wb = 1.78;
  wheelset(B, z - wb / 2, r); wheelset(B, z + wb / 2, r);
  for (const s of [1, -1]) {
    const x = s * 0.99;
    // the cast side frame: a bottom chord sagging to the spring nest, a top
    // chord over the journals, and the pedestal jaws round the bearings
    B.box(x, 0.28, z, 0.18, 0.22, 1.5, 0, C.truck);
    B.box(x, 0.7, z - 0.6, 0.18, 0.2, 0.9, 0, C.truck);
    B.box(x, 0.7, z + 0.6, 0.18, 0.2, 0.9, 0, C.truck);
    for (const e of [-1, 1]) {
      // roller bearing adapter and end cap
      B.box(x, r - 0.12, z + e * wb / 2, 0.2, 0.34, 0.3, 0, C.truck);
      B.tube([x + s * 0.1, r, z + e * wb / 2], [x + s * 0.19, r, z + e * wb / 2], 0.1, 8, C.truckRust, true);
    }
    // the spring nest: five coils in the window
    for (const dz of [-0.24, -0.12, 0, 0.12, 0.24]) B.tube([x, 0.44, z + dz], [x, 0.66, z + dz], 0.05, 5, C.steel);
  }
  // the bolster across, under the car's body bolster
  B.box(0, 0.62, z, 1.95, 0.24, 0.42, 0, C.truck);
}

/** A GE three-axle locomotive truck, centred at z (42 in wheels). */
function locoTruck(B, z) {
  const r = 0.533, sp = 2.02;
  for (const dz of [-sp, 0, sp]) wheelset(B, z + dz, r);
  for (const s of [1, -1]) {
    const x = s * 1.05;
    B.box(x, 0.3, z, 0.26, 0.6, 5.2, 0, C.truck);
    B.box(x, 0.9, z, 0.2, 0.26, 4.6, 0, C.truck);
    for (const dz of [-sp, 0, sp]) {
      B.tube([x + s * 0.13, r, z + dz], [x + s * 0.22, r, z + dz], 0.12, 8, C.steel, true);
      // coil springs over each journal
      for (const e of [-0.22, 0.22]) B.tube([x, 0.95, z + dz + e], [x, 1.2, z + dz + e], 0.07, 6, C.steel);
    }
    // sandbox at each end
    B.box(x, 0.7, z + 2.75, 0.3, 0.4, 0.35, 0, C.truck);
    B.box(x, 0.7, z - 2.75, 0.3, 0.4, 0.35, 0, C.truck);
  }
  // traction motors between the wheels
  for (const dz of [-sp, 0, sp]) B.box(0, 0.36, z + dz + 0.55, 1.1, 0.5, 0.5, 0, C.dark);
}

/** A knuckle coupler, draft gear, air hose and cut lever at the end z (facing e). */
function coupler(B, z, e, h = 0.876) {
  B.box(0, h - 0.18, z - e * 0.55, 0.36, 0.34, 1.1, 0, C.dark);        // shank in the pocket
  B.box(0, h - 0.2, z - e * 0.02, 0.42, 0.4, 0.3, 0, C.dark);          // the knuckle head
  B.box(0.1, h - 0.15, z + e * 0.1, 0.22, 0.3, 0.12, 0, C.frame);
  // air hose hanging to its glad hand
  B.tube([0.35, h - 0.1, z - e * 0.3], [0.32, h - 0.35, z - e * 0.05], 0.035, 5, C.dark);
  B.tube([0.32, h - 0.35, z - e * 0.05], [0.26, h - 0.3, z + e * 0.1], 0.035, 5, C.dark);
  // the uncoupling lever across the end
  B.tube([-0.9, h + 0.2, z - e * 0.2], [0.1, h + 0.2, z - e * 0.2], 0.02, 4, C.steel);
}

/** A side ladder: two stiles and rungs, standing off the body at x. */
function ladder(B, x, s, z, y0, y1, w = 0.42, col = C.steel) {
  const X = x * s + 0.07 * s;
  for (const dz of [-w / 2, w / 2]) B.tube([X, y0, z + dz], [X, y1, z + dz], 0.018, 4, col);
  for (let y = y0 + 0.08; y < y1; y += 0.4) B.tube([X, y, z - w / 2], [X, y, z + w / 2], 0.016, 4, col);
}

/** An end platform's grab irons and the hand brake wheel on the B end. */
function brakeWheel(B, z, e, y) {
  B.tube([0.3, y, z + e * 0.05], [0.3, y, z + e * 0.1], 0.33, 12, C.steel);
  B.tube([0.3, y, z + e * 0.05], [0.3, y - 1.2, z + e * 0.05], 0.03, 4, C.steel);
}

// ---------------------------------------------------------------------------
// The cars

const makeB = () => ({ body: new Builder(false), trim: new Builder(false), decal: new Builder(true) });

/** Body sides with posts: vertical ribs every `pitch` metres standing `dep` proud. */
function ribs(B, hw, z0, z1, y0, y1, pitch, dep, col) {
  const n = Math.max(1, Math.round((z1 - z0) / pitch));
  for (let i = 0; i <= n; i++) {
    const z = z0 + ((z1 - z0) * i) / n;
    for (const s of [1, -1]) B.box(s * (hw + dep / 2), y0, z, dep, y1 - y0, 0.12, 0, col);
  }
}

/**
 * An EVOLUTION SERIES locomotive [GE]: `road` 'bnsf' (ES44C4, H3 livery) or
 * 'cn' (ES44AC). Nose at +z. The long hood runs back from the safety cab to
 * the radiator cab at the rear, whose wings flare to the full width.
 */
function buildLoco(road, num) {
  const { body: B, trim: T, decal: D } = makeB();
  const cells = railDecals().cells;
  const L = 22.3, half = L / 2;
  const deck = 1.78, hoodW = 2.36, fullW = 3.12;
  const bn = road === 'bnsf';
  const main = bn ? C.bnsfOrange : C.cnRed, roof = bn ? C.bnsfBlack : C.cnBlack;
  const stripe = bn ? C.bnsfYellow : C.white;
  // --- the frame and the deck ------------------------------------------------
  B.box(0, deck - 0.34, 0, fullW, 0.34, L - 1.2, 0, C.frame);
  B.box(0, deck - 0.02, 0, fullW, 0.04, L - 1.4, 0, C.dark);
  // the walkway's edge: a safety stripe down each side
  for (const s of [1, -1]) B.box(s * (fullW / 2 - 0.03), deck - 0.34, 0, 0.06, 0.34, L - 1.3, 0, bn ? C.bnsfYellow : C.white);
  // --- the fuel tank between the trucks -------------------------------------
  B.box(0, 0.62, 0, 2.7, 0.95, 6.6, 0, C.frame);
  for (const s of [1, -1]) B.box(s * 1.36, 0.66, 0, 0.02, 0.8, 6.2, 0, C.dark);
  B.box(0, 0.5, 3.4, 2.4, 0.9, 0.3, 0, C.dark);         // air reservoirs' end
  // --- the cab (safety cab: full width, with a nose) --------------------------
  const cabZ0 = half - 5.35, cabZ1 = half - 1.75;      // cab back wall .. windscreen
  const cabTop = 4.7;
  // cab walls: the livery in bands -- main colour low, stripe, black top
  const band = (z0, z1, w, y0, y1, col) => B.box(0, y0, (z0 + z1) / 2, w, y1 - y0, z1 - z0, 0, col);
  band(cabZ0, cabZ1, fullW - 0.08, deck, 3.3, main);
  band(cabZ0, cabZ1, fullW - 0.08, 3.3, 3.42, stripe);
  band(cabZ0, cabZ1, fullW - 0.08, 3.42, cabTop, roof);
  // the cab roof, slightly crowned
  B.box(0, cabTop, (cabZ0 + cabZ1) / 2, fullW - 0.2, 0.08, cabZ1 - cabZ0 - 0.1, 0, C.dark);
  // cab side windows (two a side) and the door window on the fireman's side
  for (const s of [1, -1]) {
    for (const [zc, w] of [[cabZ1 - 0.75, 1.0], [cabZ1 - 1.95, 0.9]]) {
      T.quad([s * (fullW / 2 - 0.035), 3.55, zc - w / 2], [s * (fullW / 2 - 0.035), 3.55, zc + w / 2],
        [s * (fullW / 2 - 0.035), 4.35, zc + w / 2], [s * (fullW / 2 - 0.035), 4.35, zc - w / 2], [s, 0, 0], uv0, GLASS);
    }
    // the cab-side number
    sideDecal(D, cells, 'n' + num, s, fullW / 2 - 0.04, cabZ0 + 1.2, 3.0, 1.3, 0.55);
  }
  // the windscreen: two panes raking back over the nose
  const ws = [cabZ1, cabZ1 - 0.3];
  for (const s of [1, -1]) {
    T.quad([s * 0.08, 3.6, ws[0]], [s * 1.35, 3.6, ws[0]], [s * 1.3, 4.45, ws[1]], [s * 0.08, 4.45, ws[1]], [0, 0.3, 1], uv0, GLASS);
  }
  B.quad([-1.5, 3.42, ws[0] + 0.01], [1.5, 3.42, ws[0] + 0.01], [1.5, 4.7, ws[1] + 0.01], [-1.5, 4.7, ws[1] + 0.01], [0, 0.3, 1], uv0, roof);
  // number boards over the windscreen
  for (const s of [1, -1]) endDecal(D, cells, 'b' + num, 1, ws[1] + 0.03, s * 0.7, 4.58, 0.62, 0.18);
  // --- the nose: a short hood ahead of the cab, stepped down -----------------
  const noseZ0 = cabZ1, noseZ1 = half - 0.55;
  band(noseZ0, noseZ1, 2.6, deck, 3.05, bn ? C.bnsfBlack : C.cnRed);
  B.box(0, 3.05, (noseZ0 + noseZ1) / 2, 2.5, 0.12, noseZ1 - noseZ0 - 0.05, 0, bn ? C.bnsfBlack : C.cnRed);
  if (bn) endDecal(D, cells, 'wings', 1, noseZ1 + 0.005, 0, 2.35, 2.2, 1.1);
  else endDecal(D, cells, 'cnWhite', 1, noseZ1 + 0.005, 0, 2.45, 1.7, 0.9);
  // headlights high on the nose, ditch lights on the pilot
  for (const s of [1, -1]) {
    T.spheroid(s * 0.32, 2.95, noseZ1 + 0.02, 0.1, 8, 5, C.lamp, 0.8);
    T.spheroid(s * 1.25, 1.35, half - 0.25, 0.09, 8, 5, C.lamp, 0.9);
  }
  // --- the long hood -----------------------------------------------------------
  const hoodZ0 = -half + 4.2, hoodZ1 = cabZ0;
  band(hoodZ0, hoodZ1, hoodW, deck, 3.55, main);
  band(hoodZ0, hoodZ1, hoodW, 3.55, 3.66, stripe);
  band(hoodZ0, hoodZ1, hoodW, 3.66, 4.28, roof);
  B.box(0, 4.28, (hoodZ0 + hoodZ1) / 2, hoodW - 0.3, 0.1, hoodZ1 - hoodZ0 - 0.2, 0, C.dark);
  // hood doors: a run of panel seams, and louvres over the engine room
  for (const s of [1, -1]) {
    for (let z = hoodZ0 + 0.9; z < hoodZ1 - 0.6; z += 1.05) B.box(s * (hoodW / 2 + 0.005), deck + 0.2, z, 0.012, 3.45 - deck - 0.2, 0.025, 0, C.dark);
    B.box(s * (hoodW / 2 + 0.006), 3.7, (hoodZ0 + hoodZ1) / 2 - 1.5, 0.012, 0.45, 5.5, 0, C.grille);
    // the road name, big on the hood
    if (bn) sideDecal(D, cells, 'bnsfHood', s, hoodW / 2, (hoodZ0 + hoodZ1) / 2 + 0.6, 2.75, 5.4, 1.2);
    else sideDecal(D, cells, 'cnWhite', s, hoodW / 2, (hoodZ0 + hoodZ1) / 2 + 0.4, 2.8, 3.2, 1.65);
    sideDecal(D, cells, 'grime', s, hoodW / 2, (hoodZ0 + hoodZ1) / 2, 2.6, hoodZ1 - hoodZ0, 1.9, 0.02);
  }
  // exhaust stack, the dynamic-brake blister, and the air intake
  B.box(0, 4.38, hoodZ1 - 3.6, 0.5, 0.28, 0.9, 0, C.dark);
  B.box(0, 4.3, hoodZ1 - 1.2, 2.0, 0.28, 1.6, 0, roof);
  for (const s of [1, -1]) B.box(s * 0.8, 4.34, hoodZ1 - 1.2, 0.4, 0.22, 1.4, 0, C.grille);
  // --- the radiator cab at the rear: flared wings, the grille -----------------
  const radZ0 = -half + 0.7, radZ1 = hoodZ0;
  band(radZ0, radZ1, hoodW + 0.1, deck, 3.55, main);
  band(radZ0, radZ1, hoodW + 0.1, 3.55, 3.66, stripe);
  // the wings: full width up top, the radiators behind their grilles
  B.box(0, 3.66, (radZ0 + radZ1) / 2, fullW, 0.95, radZ1 - radZ0, 0, roof);
  for (const s of [1, -1]) B.box(s * (fullW / 2 + 0.005), 3.75, (radZ0 + radZ1) / 2, 0.012, 0.75, radZ1 - radZ0 - 0.4, 0, C.grille);
  // radiator fans on the roof
  for (const dz of [-1, 1]) B.tube([0, 4.6, (radZ0 + radZ1) / 2 + dz], [0, 4.66, (radZ0 + radZ1) / 2 + dz], 0.62, 12, C.grille, true);
  // rear end: headlights, the number boards
  endDecal(D, cells, 'b' + num, -1, radZ0 - 0.01, 0, 4.2, 0.62, 0.18);
  for (const s of [1, -1]) T.spheroid(s * 0.3, 3.9, radZ0 - 0.02, 0.09, 8, 5, C.lamp, 0.8);
  // --- handrails and stanchions along the walkways -----------------------------
  for (const s of [1, -1]) {
    const x = s * (fullW / 2 - 0.1);
    for (let z = -half + 1.2; z <= cabZ0 + 0.1; z += 1.5) B.tube([x, deck, z], [x, deck + 1.05, z], 0.022, 4, bn ? C.bnsfYellow : C.white);
    B.tube([x, deck + 1.05, -half + 1.2], [x, deck + 1.05, cabZ0], 0.024, 4, bn ? C.bnsfYellow : C.white);
    B.tube([x, deck + 0.55, -half + 1.2], [x, deck + 0.55, cabZ0], 0.02, 4, bn ? C.bnsfYellow : C.white);
    // the nose's rail round the front platform
    B.tube([x, deck + 1.05, noseZ1 - 0.1], [x, deck + 1.05, half - 0.3], 0.024, 4, bn ? C.bnsfYellow : C.white);
    B.tube([x, deck, half - 0.3], [x, deck + 1.05, half - 0.3], 0.024, 4, bn ? C.bnsfYellow : C.white);
    // steps at the four corners, yellow-edged
    for (const e of [1, -1]) {
      const zs = e * (half - 0.9);
      for (let k = 0; k < 3; k++) B.box(s * (fullW / 2 - 0.25), 0.55 + k * 0.4, zs, 0.5, 0.06, 0.7, 0, k === 0 ? C.yellow : C.steel);
      B.box(s * (fullW / 2 - 0.02), 0.5, zs, 0.04, 1.3, 0.72, 0, C.frame);
    }
  }
  // --- pilots, plows and couplers ---------------------------------------------
  for (const e of [1, -1]) {
    const z = e * (half - 0.5);
    B.box(0, 0.3, z, fullW - 0.2, deck - 0.3, 0.3, 0, C.frame);
    if (e > 0) {
      // the snowplow: a wedge low across the front
      B.quad([-1.5, 0.12, z + 0.2], [1.5, 0.12, z + 0.2], [1.5, 0.75, z + 0.05], [-1.5, 0.75, z + 0.05], [0, 0.3, 1], uv0, bn ? C.bnsfYellow : C.cnRed);
    }
    coupler(B, e * half, e);
    // the MU cables and hoses beside the coupler
    for (const s of [1, -1]) B.tube([s * 0.6, 1.2, z + e * 0.1], [s * 0.55, 0.95, z + e * 0.25], 0.03, 4, C.dark);
  }
  // --- the trucks ----------------------------------------------------------------
  locoTruck(B, 8.33); locoTruck(B, -8.33);
  // the horn on the cab roof: five bells on a manifold (a K5LA)
  for (let k = 0; k < 5; k++) {
    const x = -0.45 + k * 0.22, len = 0.35 + (k % 3) * 0.12;
    T.tube([x, cabTop + 0.14, cabZ0 + 0.9], [x, cabTop + 0.14, cabZ0 + 0.9 + len * (k % 2 ? 1 : -1)], 0.05, 6, C.steel);
  }
  B.box(0, cabTop + 0.05, cabZ0 + 0.9, 1.2, 0.08, 0.2, 0, C.dark);
  // the bell (a pneumatic bell under the walkway at the front)
  T.spheroid(0.9, 1.4, half - 1.6, 0.12, 8, 5, [0.55, 0.45, 0.2], 1.1);
  return { B, T, D, L, truckC: 8.33, mass: 195, w: fullW, h: 4.75, kind: 'loco' };
}

/** A three-bay covered hopper for grain [TR], `road` 'bnsf' | 'cn'. */
function buildHopper(road, mark) {
  const { body: B, trim: T, decal: D } = makeB();
  const cells = railDecals().cells;
  const L = 18.2, half = L / 2, hw = 1.6, top = 4.6;
  const col = road === 'cn' ? C.cnHopper : C.hopperGrey;
  const colD = C.hopperGreyD;
  const slope0 = half - 1.6;   // where the end slope sheets start
  // the side sheets, from the bays' top to the roof's eave
  for (const s of [1, -1]) {
    B.quad([s * hw, 1.5, -slope0], [s * hw, 1.5, slope0], [s * hw, top - 0.3, slope0], [s * hw, top - 0.3, -slope0], [s, 0, 0], uv0, col);
    // the sloped ends' side panels
    for (const e of [1, -1]) {
      B.quad([s * hw, 1.5, e * slope0], [s * hw, top - 0.3, e * slope0], [s * hw, top - 0.3, e * (half - 0.6)], [s * hw, 2.6, e * (half - 0.6)], [s, 0, 0], uv0, col);
    }
    // the top chord and the side sill
    B.box(s * (hw + 0.03), top - 0.38, 0, 0.1, 0.12, L - 1.3, 0, colD);
    B.box(s * (hw + 0.03), 1.42, 0, 0.1, 0.16, 2 * slope0, 0, colD);
    sideDecal(D, cells, road === 'cn' ? 'cnRed' : 'bnsfCarDark', s, hw + 0.06, road === 'cn' ? 1.2 : 1.5, 3.3, road === 'cn' ? 2.6 : 3.2, road === 'cn' ? 1.35 : 0.72);
    sideDecal(D, cells, mark, s, hw + 0.06, road === 'cn' ? -5.0 : -4.6, 2.35, 3.2, 0.92);
    sideDecal(D, cells, 'grime', s, hw + 0.05, 0, 3.0, 2 * slope0, 3.0, 0.02);
  }
  ribs(B, hw, -slope0, slope0, 1.5, top - 0.3, 1.25, 0.08, colD);
  // the roof: a flat crown with the long trough hatch running down it
  B.quad([-hw, top - 0.3, -half + 0.6], [hw, top - 0.3, -half + 0.6], [hw, top - 0.3, half - 0.6], [-hw, top - 0.3, half - 0.6], UP, uv0, col);
  B.box(0, top - 0.3, 0, 0.76, 0.3, L - 2.4, 0, colD);
  for (let z = -half + 2.2; z < half - 1.8; z += 1.1) B.box(0, top - 0.02, z, 0.8, 0.04, 0.08, 0, C.steel);
  // the end slope sheets, raked down to the bolsters, and the bays below
  for (const e of [1, -1]) {
    B.quad([-hw, top - 0.3, e * (half - 0.6)], [hw, top - 0.3, e * (half - 0.6)], [hw, 2.6, e * (half - 0.6)], [-hw, 2.6, e * (half - 0.6)], [0, 0, e], uv0, col);
    B.quad([-hw, 2.6, e * (half - 0.6)], [hw, 2.6, e * (half - 0.6)], [hw, 1.5, e * slope0], [-hw, 1.5, e * slope0], [0, -0.7, e], uv0, colD);
    // end platform, cross-over and the ladder up the end
    B.box(0, 1.05, e * (half - 0.35), 2.9, 0.06, 0.55, 0, C.steel);
    for (const s of [1, -1]) B.tube([s * 1.25, 1.1, e * (half - 0.6)], [s * 1.25, top - 0.3, e * (half - 0.65)], 0.02, 4, C.steel);
    coupler(B, e * half, e);
    B.box(0, 0.62, e * (half - 1.2), 0.5, 0.5, 2.4, 0, C.frame);   // stub sill
  }
  brakeWheel(B, -(half - 0.62), -1, 3.2);
  // three bays: inverted pyramids to the outlet gates
  for (const bz of [-5.0, 0, 5.0]) {
    const w0 = 2.3, z0 = 2.1, w1 = 0.7, z1 = 0.7, y0 = 1.5, y1 = 0.75;
    const P = (x, y, z) => [x, y, bz + z];
    for (const s of [1, -1]) {
      B.quad(P(s * w0 / 2, y0, -z0), P(s * w0 / 2, y0, z0), P(s * w1 / 2, y1, z1), P(s * w1 / 2, y1, -z1), [s, -0.6, 0], uv0, col);
      B.quad(P(-w0 / 2, y0, s * z0), P(w0 / 2, y0, s * z0), P(w1 / 2, y1, s * z1), P(-w1 / 2, y1, s * z1), [0, -0.6, s], uv0, colD);
    }
    B.box(0, y1 - 0.18, bz, 0.8, 0.18, 0.8, 0, C.dark);             // the outlet gate
    B.tube([-1.2, y1 - 0.1, bz], [1.2, y1 - 0.1, bz], 0.04, 5, C.steel);  // its operating shaft
  }
  freightTruck(B, 7.0); freightTruck(B, -7.0);
  return { B, T, D, L, truckC: 7.0, mass: 130, w: 3.2, h: top, kind: 'hopper' };
}

/** An aluminum rotary coal gondola, loaded [FG]. */
function buildCoal(mark) {
  const { body: B, trim: T, decal: D } = makeB();
  const cells = railDecals().cells;
  const L = 16.2, half = L / 2, hw = 1.58, top = 3.9;
  // the tub: sides, a bathtub dipping between the trucks, ends
  for (const s of [1, -1]) {
    B.quad([s * hw, 1.25, -half + 0.4], [s * hw, 1.25, half - 0.4], [s * hw, top, half - 0.4], [s * hw, top, -half + 0.4], [s, 0, 0], uv0, C.alu);
    B.box(s * (hw + 0.04), top - 0.16, 0, 0.1, 0.18, L - 0.7, 0, C.aluD);
    B.box(s * (hw + 0.04), 1.2, 0, 0.1, 0.16, L - 0.7, 0, C.aluD);
    sideDecal(D, cells, mark, s, hw + 0.05, -3.8, 2.3, 3.0, 0.86);
    sideDecal(D, cells, 'grime', s, hw + 0.04, 0, 2.6, L - 1.2, 2.6, 0.02);
  }
  ribs(B, hw, -half + 0.6, half - 0.6, 1.25, top - 0.15, 1.0, 0.07, C.aluD);
  // the tubs under the floor, between the trucks
  for (const bz of [-2.4, 2.4]) {
    for (const s of [1, -1]) B.quad([s * 1.3, 1.25, bz - 2.1], [s * 1.3, 1.25, bz + 2.1], [s * 0.9, 0.62, bz + 1.8], [s * 0.9, 0.62, bz - 1.8], [s, -0.5, 0], uv0, C.aluD);
    B.quad([-0.9, 0.62, bz - 1.8], [0.9, 0.62, bz - 1.8], [0.9, 0.62, bz + 1.8], [-0.9, 0.62, bz + 1.8], DOWN, uv0, C.aluD);
  }
  for (const e of [1, -1]) {
    B.quad([-hw, 1.25, e * (half - 0.4)], [hw, 1.25, e * (half - 0.4)], [hw, top, e * (half - 0.4)], [-hw, top, e * (half - 0.4)], [0, 0, e], uv0, C.alu);
    // the rotary end: a cushioned coupler at one end, a platform
    B.box(0, 1.0, e * (half - 0.25), 2.8, 0.06, 0.4, 0, C.steel);
    coupler(B, e * half, e);
    B.box(0, 0.62, e * (half - 1.1), 0.5, 0.5, 2.2, 0, C.frame);
    for (const s of [1, -1]) ladder(B, hw, s, e * (half - 0.9), 1.0, top - 0.1, 0.4);
  }
  brakeWheel(B, -(half - 0.42), -1, 3.0);
  // the load: a heap of coal, crested down the middle and bumpy
  const R = mulberry(mark.length * 131 + 7);
  const nz = 16, nx = 7;
  const rows = [];
  for (let i = 0; i <= nz; i++) {
    const z = -half + 0.5 + (L - 1.0) * (i / nz), row = [];
    for (let j = 0; j <= nx; j++) {
      const x = -hw + 0.05 + (2 * hw - 0.1) * (j / nx);
      const edge = i === 0 || i === nz || j === 0 || j === nx;
      const crown = (1 - Math.pow(Math.abs(x) / hw, 2)) * 0.62;
      const ends = Math.min(1, Math.min(i, nz - i) / 3);
      row.push([x, edge ? top - 0.08 : top - 0.05 + crown * ends + (R() - 0.5) * 0.14, z]);
    }
    rows.push(row);
  }
  B.patch(rows, C.coal, UP);
  // a few lumps catching the light
  for (let k = 0; k < 18; k++) {
    const z = -half + 1 + R() * (L - 2), x = (R() - 0.5) * 2 * hw * 0.7;
    const cr = (1 - Math.pow(Math.abs(x) / hw, 2)) * 0.62;
    B.spheroid(x, top + cr * 0.9 - 0.02, z, 0.12 + R() * 0.1, 5, 3, C.coalHi, 0.7);
  }
  freightTruck(B, 6.17); freightTruck(B, -6.17);
  return { B, T, D, L, truckC: 6.17, mass: 130, w: 3.2, h: top + 0.5, kind: 'coal' };
}

/** A DOT-117 tank car for crude or ethanol [DOT]: jacketed, head-shielded. */
function buildTank(mark, un) {
  const { body: B, trim: T, decal: D } = makeB();
  const cells = railDecals().cells;
  const L = 18.0, half = L / 2, r = 1.5, cy = 2.52;
  // the barrel, and heads that dome out (a lofted shell with capped ends)
  const ring = (rr) => { const p = []; for (let k = 0; k < 20; k++) { const a = (k / 20) * Math.PI * 2; p.push([Math.cos(a) * rr, cy + Math.sin(a) * rr]); } return p; };
  const barrel = half - 0.95;
  const rings = [];
  for (const [z, rr] of [[-half + 0.3, 0.2], [-half + 0.45, r * 0.72], [-half + 0.7, r * 0.95], [-barrel, r],
    [barrel, r], [half - 0.7, r * 0.95], [half - 0.45, r * 0.72], [half - 0.3, 0.2]]) rings.push({ z, pts: ring(rr) });
  B.loft(rings, C.tank, { capStart: true, capEnd: true });
  // the jacket's girth seams and the head shields' edge
  for (let z = -barrel + 2.2; z < barrel; z += 2.3) B.tube([0, cy, z], [0, cy, z + 0.03], r + 0.012, 20, C.tankD);
  // the top fittings under their protective housing, and the manway
  B.tube([0, cy + r - 0.05, -0.4], [0, cy + r + 0.42, -0.4], 0.46, 10, C.tank, true);
  B.box(0, cy + r + 0.38, -0.4, 1.0, 0.1, 1.0, 0, C.tankD);
  B.tube([0, cy + r - 0.02, 1.2], [0, cy + r + 0.12, 1.2], 0.3, 10, C.tankD, true);
  // the running board and handrail round the fittings
  B.box(0, cy + r - 0.12, -0.4, 1.8, 0.04, 2.2, 0, C.steel);
  // stub sills under each head, the underframe's only steel
  for (const e of [1, -1]) {
    B.box(0, 0.62, e * (half - 1.3), 0.5, 0.52, 2.6, 0, C.frame);
    B.box(0, 1.05, e * (half - 0.25), 2.9, 0.06, 0.45, 0, C.steel);
    coupler(B, e * half, e);
    // the tank's saddle over the bolster
    B.box(0, 1.14, e * (half - 2.0), 1.9, 0.3, 0.5, 0, C.tankD);
  }
  // the ladder up to the platform on one side
  ladder(B, r, 1, 0.4, 0.9, cy + r - 0.1, 0.44);
  ladder(B, r, -1, -0.4, 0.9, cy + r - 0.1, 0.44);
  brakeWheel(B, -(half - 0.5), -1, 2.2);
  // bottom outlet valve
  B.tube([0, cy - r + 0.05, 0.3], [0, cy - r - 0.35, 0.3], 0.14, 8, C.tankD, true);
  for (const s of [1, -1]) {
    sideDecal(D, cells, mark, s, r + 0.01, -4.8, 1.62, 2.8, 0.8, 0.0);
    // the placard holder on each side and each end
    sideDecal(D, cells, un, s, r + 0.01, 3.2, cy - 0.35, 0.7, 0.7, 0.0);
  }
  for (const e of [1, -1]) endDecal(D, cells, un, e, e * (half - 0.2), 0, cy, 0.6, 0.6);
  freightTruck(B, 6.8); freightTruck(B, -6.8);
  return { B, T, D, L, truckC: 6.8, mass: 128, w: 3.2, h: cy + r + 0.5, kind: 'tank' };
}

/** A 50 ft plate F boxcar [BX], `road` 'bnsf' | 'cn'. */
function buildBox(road, mark) {
  const { body: B, trim: T, decal: D } = makeB();
  const cells = railDecals().cells;
  const L = 17.4, half = L / 2, hw = 1.6, y0 = 1.25, top = 5.18;
  const col = road === 'cn' ? C.boxCn : C.boxBnsf;
  const dark = [col[0] * 0.7, col[1] * 0.7, col[2] * 0.7];
  for (const s of [1, -1]) {
    B.quad([s * hw, y0, -half + 0.35], [s * hw, y0, half - 0.35], [s * hw, top - 0.1, half - 0.35], [s * hw, top - 0.1, -half + 0.35], [s, 0, 0], uv0, col);
    // the side sill and the top chord
    B.box(s * (hw + 0.03), y0 - 0.05, 0, 0.08, 0.22, L - 0.7, 0, dark);
    B.box(s * (hw + 0.02), top - 0.18, 0, 0.06, 0.1, L - 0.7, 0, dark);
    // the plug door, 10 ft, in the middle: its frame, its tracks, its bars
    const dw = 3.05, dx = s * (hw + 0.06);
    B.box(dx, y0 + 0.05, 0.3, 0.1, top - y0 - 0.4, dw, 0, dark);
    B.box(s * (hw + 0.1), top - 0.4, 0.3, 0.08, 0.1, dw + 0.8, 0, C.steel);
    B.box(s * (hw + 0.1), y0 + 0.05, 0.3, 0.08, 0.1, dw + 0.8, 0, C.steel);
    for (const dz of [-1.0, 0, 1.0]) B.tube([s * (hw + 0.13), y0 + 0.4, 0.3 + dz], [s * (hw + 0.13), top - 0.6, 0.3 + dz], 0.025, 4, C.steel);
    // the lettering: road name, the logo, marks and grime
    if (road === 'cn') sideDecal(D, cells, 'cnWhite', s, hw + 0.02, 4.7, 3.4, 3.4, 1.8);
    else sideDecal(D, cells, 'bnsfCar', s, hw + 0.02, 4.9, 3.9, 4.2, 0.96);
    sideDecal(D, cells, mark, s, hw + 0.02, -4.8, 2.3, 3.4, 0.98);
    sideDecal(D, cells, 'grime', s, hw + 0.03, 0, 3.2, L - 1, 3.9, 0.02);
    // ladders at the corners
    for (const e of [1, -1]) ladder(B, hw, s, e * (half - 0.7), y0, top - 0.3, 0.4);
  }
  // exterior posts, ten each side of the door
  const posts = (z0, z1) => ribs(B, hw, z0, z1, y0, top - 0.18, 0.72, 0.06, dark);
  posts(-half + 0.5, -1.4); posts(2.0, half - 0.5);
  // the roof: panels over carlines
  B.quad([-hw - 0.05, top - 0.1, -half + 0.3], [hw + 0.05, top - 0.1, -half + 0.3], [hw + 0.05, top - 0.1, half - 0.3], [-hw - 0.05, top - 0.1, half - 0.3], UP, uv0, C.boxRoof);
  B.box(0, top - 0.12, 0, 2.2, 0.14, L - 0.6, 0, C.boxRoof);
  for (let z = -half + 0.9; z < half - 0.5; z += 1.25) B.box(0, top + 0.02, z, 2.2, 0.03, 0.1, 0, dark);
  // ends: corrugated (horizontal ribs), a platform, the brake wheel on B
  for (const e of [1, -1]) {
    B.quad([-hw, y0, e * (half - 0.35)], [hw, y0, e * (half - 0.35)], [hw, top - 0.1, e * (half - 0.35)], [-hw, top - 0.1, e * (half - 0.35)], [0, 0, e], uv0, col);
    for (let y = y0 + 0.5; y < top - 0.3; y += 0.62) B.box(0, y, e * (half - 0.3), 2.9, 0.18, 0.06, 0, dark);
    B.box(0, 1.05, e * (half - 0.15), 2.9, 0.06, 0.35, 0, C.steel);
    coupler(B, e * half, e);
  }
  brakeWheel(B, -(half - 0.3), -1, 3.9);
  // the underframe: centre sill, cross-bearers, air reservoir
  B.box(0, 0.7, 0, 0.5, 0.5, L - 1.4, 0, C.frame);
  B.box(0, y0 - 0.12, 0, 2.9, 0.12, L - 1.0, 0, C.frame);
  B.tube([0.6, 0.9, -2.5], [0.6, 0.9, -1.0], 0.22, 8, C.dark, true);
  freightTruck(B, 6.3); freightTruck(B, -6.3);
  return { B, T, D, L, truckC: 6.3, mass: 70, w: 3.2, h: top + 0.05, kind: 'box' };
}

function mulberry(a) {
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------------------------------------------------------------------------
// The catalogue, built lazily and cached: freight.js copies these into train
// geometries (one bone per car) and into the yard's parked cuts.

const BUILDERS = {
  bnsf6603: () => buildLoco('bnsf', '6603'),
  bnsf6712: () => buildLoco('bnsf', '6712'),
  cn2871: () => buildLoco('cn', '2871'),
  cn2925: () => buildLoco('cn', '2925'),
  hopperBnsf: () => buildHopper('bnsf', 'mkBnsfD'),
  hopperCn1: () => buildHopper('cn', 'mkCnD'),
  hopperCn2: () => buildHopper('cn', 'mkCnD'),
  coal1: () => buildCoal('mkBnsf2'),
  coal2: () => buildCoal('mkBnsf3'),
  tankCrude: () => buildTank('mkUtlx', 'un1267'),
  tankCrude2: () => buildTank('mkTilx', 'un1267'),
  tankEthanol: () => buildTank('mkGatx', 'un1987'),
  boxBnsf: () => buildBox('bnsf', 'mkBnsf1'),
  boxCn: () => buildBox('cn', 'mkCn1'),
  boxCn2: () => buildBox('cn', 'mkCn2'),
};
const _cars = {};
/** The geometry of a car type: { body, trim, decal } BufferGeometries plus its numbers. */
export function railCar(type) {
  if (_cars[type]) return _cars[type];
  const b = BUILDERS[type]();
  const out = { body: b.B.build(), trim: b.T.build(), decal: b.D.build(), L: b.L, truckC: b.truckC, mass: b.mass, w: b.w, h: b.h, kind: b.kind };
  _cars[type] = out;
  return out;
}
export const CAR_TYPES = Object.keys(BUILDERS);
