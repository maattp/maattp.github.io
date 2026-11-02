// Auto KW: six secrets at real places, most of them only after dark.
//
//   * THE GAOL GHOST -- the Waterloo County Gaol (1853), 73-77 Queen St N
//     (kwlandmarks2.js draws it). After dark, ON FOOT within 85 m, a pale
//     figure drifts over the walled yard, head and shoulders above the wall;
//     it turns to watch you, and when you come within 14 m it rises and is
//     gone with a breath of cold air.
//   * THE UFO -- a stubble field in Woolwich, east of Conestogo. On a CLEAR
//     night a saucer of coloured lights hangs 55 m over the field, its beam on
//     the stubble. Stop (or stand) and look straight at it for two seconds:
//     it tips and darts away up into the dark.
//   * THE CROP CIRCLE -- in the same field, any time of day, drawn only when
//     the camera is 60 m+ over it (balloon, helicopter, plane): rings,
//     satellites, and a goose's footprint in the middle.
//   * THE PAYPHONE -- OSM's one Bell payphone in the region, outside Mr. Sub on
//     Hespeler Road, Cambridge. From 21:30 to 3:00 it rings when you are near;
//     ENTER on foot answers it: a voice gives a riddle for a secret you have
//     not found, then the way to a golden egg (kweggs.js). By day, a dial tone.
//   * THE LANTERN -- Doon Heritage Village (1914), at the Waterloo Region
//     Museum. After dark a lit lantern hangs by the village lane with nobody
//     holding it; walk up and it sets off between the houses, waiting when you
//     fall behind. Follow it to the end and it is set down and goes out.
//   * BIGFOOT -- the Hidden Valley woods along the Grand. In fog or drizzle,
//     or at dawn and dusk, a big dark shape walks the strip of trees by the
//     river; come within 40 m and it stops, looks at you, and lopes off into
//     the trees.
//
// Each pays $250 once (all six: $2,500 more) and counts in the pause menu's
// passport ("Secrets found n/6"); a repeat sighting is only a toast. Saved in
// localStorage `autokw-secrets` ({ f: [ids] }). The GTA rule of cheats.js
// applies as it does to the golden eggs: in a cheated session the secrets
// still appear but are not counted or paid.
//
// PHONE COST: idle, six squared-distance tests a frame and nothing built.
// Each secret builds its meshes the first time you come in range and keeps
// them (a few KB), visible only inside its range and its hours: the ghost 2
// draws (572 tris), the UFO 2 (~950), the crop circle 1 (2048), the payphone
// 2 (~120), the lantern 2 (118), Bigfoot 1 (914). Nothing is allocated per
// frame; sounds are a few WebAudio nodes per event.
//
// Probe: tools/kw/secretprobe.mjs (forces night / fog / clear through
// window.__tod and weather.set, teleports to each, checks the rules, the
// payoff, once-only, the save; shots in apps/autokw/docs/secrets/).
import * as THREE from './three.js';
import * as G from './geo.js';
import { Builder } from './build.js';
import { CHEAT } from './cheats.js';

const KEY = 'autokw-secrets';
const CASH = 250, ALL_CASH = 2500;
const lin = (c) => c.map((v) => Math.pow(v, 2.2));

// The yard of the gaol (kwlandmarks2.js gaol(): lm2.json's outline minus the
// stone house): the ghost's loop, inside the 5.2 m walls.
// (2.5 m+ from every wall: tools/kw/secretprobe.mjs checks the loop against the solids)
const GHOST_LOOP = [[-906, -15], [-902, -21], [-902, -26], [-909, -30], [-914, -31], [-908, -26], [-905, -20]];
const GHOST_C = [-906, -24];
// The field (OSM farmland 818134262's neighbour, crop 3 stubble), east of
// Conestogo: probe-checked 85 m clear of roads, buildings and woods.
const FIELD = { x: 420, z: -10080, r: 46, road: 'Katherine Street South' };   // the nearest road, 210 m west
// OSM node amenity=telephone, operator Bell Canada (the only one in the box),
// in front of the plaza at 580 Hespeler Rd; the phone faces the lot (north).
const PHONE = { x: 11992, z: 5520.7, h: Math.PI };
// Doon Heritage Village: the lantern's walk between the houses (probe-checked
// clear of every house's solids), west to east, ending by the barn.
const LANTERN = [[2862, 5600], [2856, 5566], [2878, 5540], [2918, 5531], [2957, 5532], [2978, 5530], [2998, 5528], [3021, 5521]];
// Hidden Valley: the strip of woods between the houses and the Grand.
const BIGFOOT = { a: [4652, 4145], b: [4664, 4285] };

export const LIST = [
  { id: 'ghost', name: 'The gaol ghost', where: 'the Waterloo County Gaol', x: GHOST_C[0], z: GHOST_C[1],
    riddle: 'The old gaol on Queen Street never quite emptied. Go on foot, after dark, round the back' },
  { id: 'ufo', name: 'Lights over Woolwich', where: 'a field east of Conestogo', x: FIELD.x, z: FIELD.z,
    riddle: 'Clear nights, east of Conestogo. Stop the car and watch the sky over the stubble' },
  { id: 'crop', name: 'The crop circle', where: 'a field east of Conestogo', x: FIELD.x, z: FIELD.z,
    riddle: 'A field in Woolwich has something to say, but only to the birds. Get up high' },
  { id: 'phone', name: 'The midnight payphone', where: 'Hespeler Road, Cambridge', x: PHONE.x, z: PHONE.z,
    riddle: '' },
  { id: 'lantern', name: 'The Doon lantern', where: 'Doon Heritage Village', x: LANTERN[0][0], z: LANTERN[0][1],
    riddle: 'In Doon village it is still 1914, and someone still walks the lane with a lantern after dark. Follow it' },
  { id: 'bigfoot', name: 'Bigfoot', where: 'the Hidden Valley woods', x: (BIGFOOT.a[0] + BIGFOOT.b[0]) / 2, z: (BIGFOOT.a[1] + BIGFOOT.b[1]) / 2,
    riddle: 'In the fog, or at first light, something big walks the trees in Hidden Valley, down by the Grand' },
];

function glowTex(inner, mid) {
  const cv = document.createElement('canvas');
  cv.width = cv.height = 64;
  const g = cv.getContext('2d');
  const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  gr.addColorStop(0, inner); gr.addColorStop(0.3, mid); gr.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// --- the ghost's look ---------------------------------------------------------------
const GHOST_V = `
uniform float uT;
varying vec3 vN; varying vec3 vV; varying vec3 vP;
void main() {
  vP = position;
  vec3 p = position;
  float hem = 1.0 - smoothstep(0.0, 1.0, p.y);
  float ang = atan(p.z, p.x);
  p.y += hem * 0.16 * sin(ang * 5.0 + uT * 3.1);
  p.xz *= 1.0 + hem * 0.12 * sin(uT * 2.3 + ang * 3.0);
  p.x += sin(uT * 1.4 + p.y * 1.7) * 0.07 * (1.0 - p.y / 2.3);
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  vN = normalize(normalMatrix * normal);
  vV = -mv.xyz;
  gl_Position = projectionMatrix * mv;
}`;
const GHOST_F = `
uniform float uFade;
varying vec3 vN; varying vec3 vV; varying vec3 vP;
void main() {
  float fr = 1.0 - abs(dot(normalize(vN), normalize(vV)));
  float a = 0.24 + 0.76 * pow(fr, 1.4);
  a *= smoothstep(-0.05, 0.75, vP.y);
  vec2 q = vP.xy;
  float e = 1.0 - smoothstep(0.03, 0.048, length((q - vec2(0.075, 1.93)) * vec2(1.0, 0.72)));
  e = max(e, 1.0 - smoothstep(0.03, 0.048, length((q - vec2(-0.075, 1.93)) * vec2(1.0, 0.72))));
  e = max(e, 1.0 - smoothstep(0.024, 0.04, length((q - vec2(0.0, 1.81)) * vec2(1.3, 0.8))));
  e *= step(0.06, vP.z);
  vec3 col = mix(vec3(0.82, 0.94, 1.0) * (1.0 + 0.8 * fr), vec3(0.02, 0.03, 0.06), e);
  a = mix(a, 0.92, e);
  gl_FragColor = vec4(col, a * uFade);
}`;

function ghostGeometry() {
  const B = new Builder(false);
  const W = [1, 1, 1];
  const prof = [[0.0, 0.62], [0.25, 0.55], [0.6, 0.47], [0.95, 0.41], [1.25, 0.37], [1.45, 0.355], [1.56, 0.30], [1.64, 0.215],
    [1.72, 0.19], [1.82, 0.205], [1.95, 0.205], [2.05, 0.18], [2.12, 0.13], [2.17, 0.05]];
  const K = 18;
  B.loftY(prof.map(([y, r]) => ({ y, pts: Array.from({ length: K }, (_, i) => { const a = (i / K) * Math.PI * 2; return [Math.cos(a) * r, Math.sin(a) * r]; }) })), W, { capEnd: true });
  // the arms, held out in front, drooping at the hands
  for (const s of [-1, 1]) {
    B.tube([s * 0.3, 1.47, 0.03], [s * 0.47, 1.3, 0.36], 0.075, 7, W, false);
    B.tube([s * 0.47, 1.3, 0.36], [s * 0.5, 1.12, 0.52], 0.06, 7, W, true);
  }
  return B.build();
}

// --- Bigfoot: one mesh, the limbs swung in the vertex shader about their pivots -------
function bigfootGeometry() {
  const B = new Builder(false);
  const piv = [];
  const FUR = lin([0.20, 0.13, 0.08]), FUR_D = lin([0.13, 0.08, 0.05]), SKIN = lin([0.30, 0.21, 0.15]);
  const part = (fn, p, amp) => { const n0 = B.pos.length / 3; fn(); const n1 = B.pos.length / 3; for (let i = n0; i < n1; i++) piv.push(p[0], p[1], p[2], amp); };
  part(() => {
    B.spheroid(0, 1.6, 0, 0.47, 12, 8, FUR, 1.3, 0.06);
    B.spheroid(0, 1.15, 0.02, 0.41, 10, 6, FUR, 1.1, 0.06);
    B.spheroid(0, 2.16, 0.07, 0.23, 10, 7, FUR_D, 1.15, 0.04);
    B.spheroid(0, 2.31, 0.0, 0.12, 8, 5, FUR_D, 1.2, 0.05);      // the crest
    B.box(0, 2.2, 0.25, 0.27, 0.05, 0.06, 0, FUR_D);             // brow
    B.spheroid(0, 2.12, 0.24, 0.11, 8, 5, SKIN, 0.85);            // face
    for (const s of [-1, 1]) B.spheroid(s * 0.17, 2.0, 0.0, 0.2, 8, 5, FUR, 0.8, 0.05);   // traps
  }, [0, 0, 0], 0);
  for (const s of [-1, 1]) {
    // legs: hip pivot, forward/back swing; arms: shoulder pivot, opposite
    part(() => {
      B.tube([s * 0.21, 1.02, 0], [s * 0.23, 0.52, 0.04], 0.17, 8, FUR, false);
      B.tube([s * 0.23, 0.52, 0.04], [s * 0.24, 0.1, 0.0], 0.14, 8, FUR, false);
      B.box(s * 0.24, 0.0, 0.08, 0.2, 0.12, 0.38, 0, FUR_D);
    }, [s * 0.21, 1.02, 0], 0.5 * s);
    part(() => {
      B.tube([s * 0.5, 1.92, 0.02], [s * 0.58, 1.38, 0.06], 0.12, 8, FUR, false);
      B.tube([s * 0.58, 1.38, 0.06], [s * 0.6, 0.9, 0.16], 0.1, 8, FUR, false);
      B.spheroid(s * 0.6, 0.84, 0.18, 0.11, 7, 5, FUR_D, 1.2);
    }, [s * 0.5, 1.92, 0.02], -0.55 * s);
  }
  const g = B.build();
  g.setAttribute('aPiv', new THREE.Float32BufferAttribute(piv, 4));
  return g;
}

function bigfootMaterial(U) {
  const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, metalness: 0 });
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uPh = U;
    sh.vertexShader = 'attribute vec4 aPiv;\nuniform float uPh;\n' + sh.vertexShader
      .replace('#include <beginnormal_vertex>', `#include <beginnormal_vertex>
	float bfA = sin(uPh) * aPiv.w; float bfC = cos(bfA), bfS = sin(bfA);
	objectNormal = vec3(objectNormal.x, bfC * objectNormal.y - bfS * objectNormal.z, bfS * objectNormal.y + bfC * objectNormal.z);`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
	{ vec3 bq = transformed - aPiv.xyz; transformed = aPiv.xyz + vec3(bq.x, bfC * bq.y - bfS * bq.z, bfS * bq.y + bfC * bq.z); }`);
  };
  m.customProgramCacheKey = () => 'kwsecret-bigfoot';
  return m;
}

// --- the UFO ------------------------------------------------------------------------
function ufoGeometry() {
  const B = new Builder(false);
  const HULL = [0.10, 0.11, 0.13], RIM = [0.42, 0.44, 0.48], DOME = [0.35, 0.75, 0.70], UNDER = [0.55, 1.0, 0.75];
  const K = 24;
  const ring = (r) => Array.from({ length: K }, (_, i) => { const a = (i / K) * Math.PI * 2; return [Math.cos(a) * r, Math.sin(a) * r]; });
  B.loftY([{ y: -0.62, pts: ring(1.1) }, { y: -0.5, pts: ring(2.6) }, { y: -0.12, pts: ring(4.6) }, { y: 0.08, pts: ring(4.7) }, { y: 0.3, pts: ring(3.0) }, { y: 0.5, pts: ring(1.7) }],
    [UNDER, HULL, RIM, RIM, HULL, HULL], { capStart: true, capEnd: true });
  B.spheroid(0, 0.5, 0, 1.45, 14, 7, DOME, 0.62);
  const C = [[1, 0.25, 0.2], [0.3, 1, 0.45], [0.35, 0.6, 1], [1, 0.85, 0.3]];
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    B.spheroid(Math.cos(a) * 4.75, -0.02, Math.sin(a) * 4.75, 0.38, 6, 4, C[i % 4]);
  }
  return B.build();
}

function beamGeometry() {
  // a unit-height open cone from the hull (y 0) to the ground (y -1), additive; vertex colours fade it
  const K = 20, pos = [], col = [], idx = [];
  for (let i = 0; i <= K; i++) {
    const a = (i / K) * Math.PI * 2, c = Math.cos(a), s = Math.sin(a);
    pos.push(c * 1.3, -0.01, s * 1.3, c * 11, -1, s * 11);
    col.push(0.08, 0.24, 0.17, 0.0, 0.02, 0.015);
  }
  for (let i = 0; i < K; i++) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
  // the pool of light on the ground: a disc at y -1
  const c0 = pos.length / 3;
  pos.push(0, -0.995, 0); col.push(0.12, 0.3, 0.21);
  for (let i = 0; i <= K; i++) { const a = (i / K) * Math.PI * 2; pos.push(Math.cos(a) * 11, -0.995, Math.sin(a) * 11); col.push(0, 0, 0); }
  for (let i = 0; i < K; i++) idx.push(c0, c0 + 1 + i, c0 + 2 + i);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  g.computeBoundingSphere();
  return g;
}

// --- the crop circle ------------------------------------------------------------------
function cropTexture() {
  const N = 512, cv = document.createElement('canvas');
  cv.width = cv.height = N;
  const g = cv.getContext('2d');
  const C = N / 2, U = N / 2;   // 1 = the canvas's half width (50 m)
  const lay = 'rgba(236,214,150,0.92)', edge = 'rgba(105,86,52,0.55)';
  const disc = (x, y, r) => { g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill(); };
  const ringP = (x, y, r0, r1) => { g.beginPath(); g.arc(x, y, r1, 0, Math.PI * 2); g.arc(x, y, r0, 0, Math.PI * 2, true); g.fill(); };
  g.clearRect(0, 0, N, N);
  // the flattened crop
  g.fillStyle = lay;
  disc(C, C, 0.2 * U);
  ringP(C, C, 0.31 * U, 0.38 * U);
  ringP(C, C, 0.47 * U, 0.5 * U);
  for (let i = 0; i < 3; i++) {
    const a = -Math.PI / 2 + (i / 3) * Math.PI * 2, x = C + Math.cos(a) * 0.72 * U, y = C + Math.sin(a) * 0.72 * U;
    disc(x, y, 0.1 * U);
    ringP(x, y, 0.14 * U, 0.165 * U);
    // the path from the outer ring to the satellite
    g.save(); g.translate(C, C); g.rotate(a); g.fillRect(0.49 * U, -0.022 * U, 0.14 * U, 0.044 * U); g.restore();
    // small ones between
    const b = a + Math.PI / 3;
    disc(C + Math.cos(b) * 0.6 * U, C + Math.sin(b) * 0.6 * U, 0.045 * U);
  }
  // the lay: fine swirled arcs (lighter / darker) across everything flattened
  g.globalCompositeOperation = 'source-atop';
  for (let r = 2; r < U; r += 3) {
    g.strokeStyle = (r / 3) % 2 < 1 ? 'rgba(255,240,190,0.35)' : 'rgba(170,140,85,0.22)';
    g.lineWidth = 1.6;
    g.beginPath(); g.arc(C, C, r, 0, Math.PI * 2); g.stroke();
  }
  // a goose's foot standing in the middle (the crop left standing: cut out)
  g.globalCompositeOperation = 'destination-out';
  g.fillStyle = '#000';
  g.save(); g.translate(C, C + 0.06 * U);
  for (const a of [-0.55, 0, 0.55]) {
    g.save(); g.rotate(a); g.beginPath(); g.moveTo(-0.018 * U, 0); g.lineTo(0.018 * U, 0); g.lineTo(0.01 * U, -0.15 * U); g.lineTo(-0.01 * U, -0.15 * U); g.closePath(); g.fill(); g.restore();
  }
  g.beginPath(); g.moveTo(0, 0); g.lineTo(Math.sin(-0.55) * 0.13 * U, -Math.cos(-0.55) * 0.13 * U);
  g.quadraticCurveTo(0, -0.06 * U, Math.sin(0.55) * 0.13 * U, -Math.cos(0.55) * 0.13 * U); g.closePath(); g.fill();
  g.fillRect(-0.016 * U, 0, 0.032 * U, 0.07 * U);
  g.restore();
  // a darker edge where standing crop meets the lay (drawn behind, as a halo)
  g.globalCompositeOperation = 'destination-over';
  g.strokeStyle = edge; g.lineWidth = 3;
  for (const [r] of [[0.2], [0.31], [0.38], [0.47], [0.5]]) { g.beginPath(); g.arc(C, C, r * U, 0, Math.PI * 2); g.stroke(); }
  g.globalCompositeOperation = 'source-over';
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

// --- the payphone ---------------------------------------------------------------------
function phoneGeometry() {
  const B = new Builder(false);
  const POST = lin([0.35, 0.36, 0.38]), STEEL = lin([0.62, 0.64, 0.67]), DARK = lin([0.06, 0.06, 0.07]), BLUE = lin([0.05, 0.27, 0.62]);
  B.box(0, 0, -0.05, 0.12, 1.0, 0.12, 0, POST);
  // the hood: back, two sides, roof
  B.box(0, 0.95, -0.2, 0.74, 1.0, 0.03, 0, STEEL);
  for (const s of [-1, 1]) B.box(s * 0.36, 0.95, 0.0, 0.03, 1.0, 0.42, 0, STEEL);
  B.box(0, 1.95, 0.0, 0.76, 0.05, 0.46, 0, STEEL);
  B.box(0, 2.0, 0.19, 0.76, 0.24, 0.05, 0, BLUE);   // the sign's backing (the lettering is its own plane)
  // the phone: housing, keypad, coin slot, the handset in its cradle and its cord
  B.box(0, 1.05, -0.12, 0.34, 0.6, 0.14, 0, STEEL);
  B.box(0.04, 1.28, -0.05, 0.14, 0.16, 0.012, 0, DARK);
  B.box(0.04, 1.5, -0.05, 0.12, 0.05, 0.012, 0, BLUE);
  B.box(-0.12, 1.12, -0.03, 0.07, 0.4, 0.07, 0, DARK);
  B.tube([-0.12, 1.12, -0.03], [-0.06, 1.0, -0.04], 0.012, 4, DARK, false);
  B.box(0, 1.0, -0.06, 0.3, 0.04, 0.1, 0, STEEL);   // the shelf
  return B.build();
}

function phoneSign() {
  const cv = document.createElement('canvas');
  cv.width = 256; cv.height = 80;
  const g = cv.getContext('2d');
  g.fillStyle = '#0b4ea2'; g.fillRect(0, 0, 256, 80);
  g.fillStyle = '#ffffff'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.font = 'bold 30px sans-serif'; g.fillText('TELEPHONE', 128, 30);
  g.font = 'bold 18px sans-serif'; g.fillText('TÉLÉPHONE', 128, 60);
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// --- the lantern ------------------------------------------------------------------------
function lanternGeometry() {
  // origin at the top of the bail (where a hand would hold it); it hangs below
  const B = new Builder(false);
  const IRON = [0.04, 0.035, 0.03], GLASS = [1.0, 0.72, 0.32], FLAME = [1.0, 0.95, 0.7];
  B.box(0, -0.47, 0, 0.22, 0.04, 0.22, 0, IRON);
  B.box(0, -0.43, 0, 0.17, 0.27, 0.17, 0, GLASS);
  B.box(0, -0.36, 0, 0.04, 0.09, 0.04, 0, FLAME);
  for (const [x, z] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) B.box(x * 0.095, -0.45, z * 0.095, 0.022, 0.31, 0.022, 0, IRON);
  B.cone(0, -0.16, 0, 0.14, 0.1, 8, IRON);
  B.box(0, -0.07, 0, 0.05, 0.03, 0.05, 0, IRON);
  for (const s of [-1, 1]) B.tube([s * 0.1, -0.15, 0], [s * 0.05, 0, 0], 0.008, 4, IRON, false);
  B.tube([-0.05, 0, 0], [0.05, 0, 0], 0.008, 4, IRON, false);
  return B.build();
}

function lanternGlowGeometry() {
  // two crossed upright quads round the glass (local y -0.3) and the pool of light on the ground (y -0.95)
  const S = 0.75, Y = -0.3, P = 2.6, Yg = -0.86;
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute([
    -S, Y - S, 0, S, Y - S, 0, S, Y + S, 0, -S, Y + S, 0,
    0, Y - S, -S, 0, Y - S, S, 0, Y + S, S, 0, Y + S, -S,
    -P, Yg, -P, P, Yg, -P, P, Yg, P, -P, Yg, P], 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 1, 0, 1, 1, 0, 1, 0, 0, 1, 0, 1, 1, 0, 1, 0, 0, 1, 0, 1, 1, 0, 1], 2));
  g.setIndex([0, 1, 2, 0, 2, 3, 4, 5, 6, 4, 6, 7, 8, 9, 10, 8, 10, 11]);
  g.computeBoundingSphere();
  return g;
}

export class Secrets {
  /** o: { scene, city, world, audio, hud, game, fx, tod, weather, traffic, eggs: () => Eggs } */
  constructor(o) {
    this.o = o;
    this.scene = o.scene; this.city = o.city;
    this.found = new Set();
    this.t = 0;
    this.load();
    this.total = LIST.length;
    // what is built (null until first in range)
    this.ghost = null; this.ufo = null; this.crop = null; this.phone = null; this.lantern = null; this.bigfoot = null;
    // live state
    this.gs = { fade: 0, gone: 0, s: 0, vanish: -1, y: 0, x: GHOST_C[0], z: GHOST_C[1] };
    this.us = { x: FIELD.x, z: FIELD.z, y: 0, watch: 0, dart: -1, gone: 0, vx: 0, vz: 0, vy: 0, spin: 0 };
    this.cs = { look: 0 };
    this.ps = { ring: 0, next: 0, ringing: false, said: -1e9, quiet: 0, prompt: false };
    this.ls = { st: 'wait', s: 0, k: 0, end: 0, lost: 0, told: false, wait: 0, x: LANTERN[0][0], z: LANTERN[0][1], len: 0 };
    this.bs = { st: 'walk', x: BIGFOOT.a[0], z: BIGFOOT.a[1], h: 0, tgt: 1, ph: 0, fade: 0, t: 0, gone: 0, flee: 0 };
    { let L = 0; this.lcum = [0]; for (let i = 1; i < LANTERN.length; i++) { L += Math.hypot(LANTERN[i][0] - LANTERN[i - 1][0], LANTERN[i][1] - LANTERN[i - 1][1]); this.lcum.push(L); } this.ls.len = L; }
    this.uT = { value: 0 };
    this.uPh = { value: 0 };
    // a parked car must not sit on the payphone; it is a post (one round solid)
    try {
      if (o.traffic && o.traffic.keepClear) o.traffic.keepClear.push([PHONE.x, PHONE.z - 1, 3.5]);
      const gy = this.city.groundAt(PHONE.x, PHONE.z, null);
      if (this.city.addLandmarkSolids) this.city.addLandmarkSolids([{ x: PHONE.x, z: PHONE.z - 0.05, r: 0.4, y0: gy - 1, y1: gy + 2.1 }]);
    } catch (e) { /* the phone just has no solid */ }
  }

  get count() { return this.found.size; }
  load() { try { const d = JSON.parse(localStorage.getItem(KEY) || '{}'); for (const k of d.f || []) if (LIST.some((s) => s.id === k)) this.found.add(k); } catch (e) { /* fresh */ } }
  save() { try { localStorage.setItem(KEY, JSON.stringify({ f: [...this.found] })); } catch (e) { /* private mode */ } }

  /** Pause-menu passport row. */
  passportRow() { return { label: 'Secrets found', done: this.count, total: this.total }; }
  /** The passport's rumour until the payphone has been answered (it gives the rest). */
  rumour() { return this.found.has('phone') ? '' : 'Rumour: a payphone on Hespeler Road rings late at night'; }

  // --- the world's state -------------------------------------------------------------
  dark() { const t = this.o.tod; return !!(t && t.on && t.ni > 0.55); }
  twilight() { const t = this.o.tod; return !!(t && t.on && t.du > 0.35 && t.ni <= 0.55); }
  hour() { const t = this.o.tod; return t && t.on ? t.hour : 14; }
  wx() { const w = this.o.weather; return w ? w.state : 'clear'; }

  toast(m, ms = 5200) { if (this.o.hud) this.o.hud.showToast(m, ms); }

  /** First time: count it, pay, save. Returns the suffix for the toast. */
  credit(id, x, y, z) {
    if (this.found.has(id)) return '';
    if (CHEAT.on) return ' (cheats are on: not counted)';
    this.found.add(id);
    this.save();
    const g = this.o.game;
    if (g) g.money += CASH;
    const a = this.o.audio;
    if (a && a.ready) { a.play('pickup', { gain: 0.8, jitter: false }); a.play('cash', { gain: 0.45, jitter: false }); }
    if (this.o.fx && x !== undefined) this.o.fx.emit(x, y, z, 24, { r: 0.75, g: 0.9, b: 1, size: 0.45, life: 1.2, spread: 4, vy: 2, grav: 1, jitter: 0.5 });
    if (this.count === this.total) {
      if (g) g.money += ALL_CASH;
      setTimeout(() => this.toast(`ALL SIX SECRETS — Waterloo Region has nothing left to hide from you. Or does it? +$${ALL_CASH.toLocaleString()}`, 7000), 6500);
    }
    return ` — secret ${this.count} of ${this.total}, +$${CASH}`;
  }

  // --- the frame -----------------------------------------------------------------------
  update(dt, player, camera) {
    this.t += dt;
    this.uT.value = this.t;
    const foot = player.onFoot !== false && !player.vehicle;
    const v = foot ? null : player.vehicle;
    const px = v ? v.x : player.x, pz = v ? v.z : player.z, py = v ? v.y : player.y;
    const spd = v ? Math.abs(v.vLong || 0) : 0;
    const cx = camera.position.x, cz = camera.position.z;
    const d2 = (x, z, ax, az) => (x - ax) * (x - ax) + (z - az) * (z - az);
    const dark = this.dark();
    // the ghost: built within 300 m of the camera, drawn after dark to a player on foot
    if (d2(cx, cz, GHOST_C[0], GHOST_C[1]) < 300 * 300) this._ghost(dt, dark, foot, px, pz, camera);
    else if (this.ghost) this.ghost.visible = this.ghost.aura.visible = false;
    if (d2(cx, cz, FIELD.x, FIELD.z) < 2600 * 2600) {
      this._ufo(dt, dark, px, pz, spd, camera);
      this._crop(dt, camera);
    } else {
      if (this.ufo) this.ufo.visible = this.ufo.beam.visible = false;
      if (this.crop) this.crop.visible = false;
    }
    if (d2(cx, cz, PHONE.x, PHONE.z) < 260 * 260) this._phone(dt, dark, foot, px, pz);
    else { if (this.phone) this.phone.visible = false; this.ps.ringing = false; this.ps.prompt = false; }
    if (d2(cx, cz, 2940, 5560) < 450 * 450) this._lantern(dt, dark, foot, px, pz);
    else if (this.lantern) this.lantern.visible = this.lantern.glow.visible = false;
    if (d2(cx, cz, 4658, 4215) < 420 * 420) this._bigfoot(dt, foot, px, pz, py, camera);
    else if (this.bigfoot) this.bigfoot.visible = false;
  }

  /** Is the camera looking at (x, y, z) within `cosMax` of straight ahead? */
  _looking(camera, x, y, z, cosMax) {
    const e = camera.matrixWorld.elements;
    const dx = x - camera.position.x, dy = y - camera.position.y, dz = z - camera.position.z;
    const l = Math.hypot(dx, dy, dz) || 1;
    return (-e[8] * dx - e[9] * dy - e[10] * dz) / l > cosMax;
  }

  // --- 1. the gaol ghost ----------------------------------------------------------------
  _buildGhost() {
    const mat = new THREE.ShaderMaterial({ vertexShader: GHOST_V, fragmentShader: GHOST_F, uniforms: { uT: this.uT, uFade: { value: 0 } },
      transparent: true, depthWrite: false });
    const m = new THREE.Mesh(ghostGeometry(), mat);
    m.name = 'kw-ghost'; m.renderOrder = 7; m.visible = false; m.frustumCulled = false; m.scale.setScalar(1.3);
    const aura = new THREE.Mesh(new THREE.PlaneGeometry(5.5, 6.8), new THREE.MeshBasicMaterial({ map: glowTex('rgba(200,230,255,0.55)', 'rgba(140,190,255,0.18)'),
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false, fog: false }));
    aura.name = 'kw-ghostaura'; aura.renderOrder = 6; aura.visible = false; aura.frustumCulled = false;
    m.aura = aura;
    this.scene.add(m, aura);
    this.ghost = m;
    this.gs.y = this.city.groundAt(GHOST_C[0], GHOST_C[1], null);
  }

  _ghost(dt, dark, foot, px, pz, camera) {
    if (!this.ghost) this._buildGhost();
    const S = this.gs, m = this.ghost;
    S.gone = Math.max(0, S.gone - dt);
    const dPl = Math.hypot(px - S.x, pz - S.z);
    // fade in when it may be seen, out when not
    const want = dark && foot && S.gone <= 0 && S.vanish < 0 && Math.hypot(px - GHOST_C[0], pz - GHOST_C[1]) < 85;
    if (S.vanish >= 0) {
      S.vanish += dt;
      S.fade = Math.max(0, 1 - S.vanish / 0.9);
      if (S.vanish > 1.2) { S.vanish = -1; S.gone = 45; S.fade = 0; }
    } else S.fade = want ? Math.min(1, S.fade + dt * 0.5) : Math.max(0, S.fade - dt * 1.5);
    if (S.fade <= 0.001) { m.visible = m.aura.visible = false; return; }
    // drift round the yard's loop at a walking pace, a slow rise and fall
    if (S.vanish < 0) {
      S.s += dt * 0.55;
      const n = GHOST_LOOP.length;
      let L = 0;
      for (let i = 0; i < n; i++) { const a = GHOST_LOOP[i], b = GHOST_LOOP[(i + 1) % n]; L += Math.hypot(b[0] - a[0], b[1] - a[1]); }
      let s = S.s % L;
      for (let i = 0; i < n; i++) {
        const a = GHOST_LOOP[i], b = GHOST_LOOP[(i + 1) % n], l = Math.hypot(b[0] - a[0], b[1] - a[1]);
        if (s <= l) { const k = s / l; S.x = a[0] + (b[0] - a[0]) * k; S.z = a[1] + (b[1] - a[1]) * k; S.hd = Math.atan2(b[0] - a[0], b[1] - a[1]); break; }
        s -= l;
      }
    }
    const lift = S.vanish >= 0 ? S.vanish * 1.6 : 0;
    const y = S.y + 5.0 + Math.sin(this.t * 0.8) * 0.35 + lift;
    // it watches you once you are near
    const face = dPl < 45 ? Math.atan2(px - S.x, pz - S.z) : S.hd || 0;
    let dh = face - m.rotation.y; dh = Math.atan2(Math.sin(dh), Math.cos(dh));
    m.rotation.y += dh * Math.min(1, dt * 2);
    m.position.set(S.x, y, S.z);
    const flick = 0.82 + 0.18 * Math.sin(this.t * 13.0) * Math.sin(this.t * 3.1);
    m.material.uniforms.uFade.value = S.fade * flick;
    m.aura.position.set(S.x, y + 1.6, S.z);
    m.aura.quaternion.copy(camera.quaternion);
    m.aura.material.opacity = S.fade * 0.8 * flick;
    m.visible = m.aura.visible = true;
    // close enough: it rises and is gone
    if (S.vanish < 0 && S.fade > 0.6 && dPl < 14) {
      S.vanish = 0;
      this.sfxGhost();
      const sfx = this.credit('ghost', S.x, y + 1, S.z);
      setTimeout(() => this.toast((sfx || !this.found.has('ghost')) ? `The Waterloo County Gaol, 1853. It held prisoners for more than a century, and some say one never left${sfx}`
        : 'The cold goes through you. The yard is empty again', 6200), 900);
    }
  }

  // --- 2. the UFO over Woolwich, 3. its crop circle -----------------------------------
  _buildUfo() {
    const m = new THREE.Mesh(ufoGeometry(), new THREE.MeshBasicMaterial({ vertexColors: true, fog: false, toneMapped: false }));
    m.name = 'kw-ufo'; m.visible = false; m.scale.setScalar(1.4);
    const beam = new THREE.Mesh(beamGeometry(), new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false,
      blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: false, toneMapped: false }));
    beam.name = 'kw-ufobeam'; beam.visible = false; beam.renderOrder = 6;
    m.beam = beam;
    this.scene.add(m, beam);
    this.ufo = m;
    this.us.gy = this.city.groundAt(FIELD.x, FIELD.z, null);
  }

  _ufo(dt, dark, px, pz, spd, camera) {
    const clear = this.wx() === 'clear';
    const U = this.us;
    U.gone = Math.max(0, U.gone - dt);
    const on = dark && clear && U.gone <= 0;
    if (!on && U.dart < 0) { if (this.ufo) this.ufo.visible = this.ufo.beam.visible = false; U.watch = 0; return; }
    if (!this.ufo) this._buildUfo();
    const m = this.ufo;
    U.spin += dt * 1.4;
    if (U.dart < 0) {
      U.x = FIELD.x + Math.sin(this.t * 0.07) * 26;
      U.z = FIELD.z + Math.sin(this.t * 0.11 + 1) * 18;
      U.y = U.gy + 55 + Math.sin(this.t * 0.9) * 1.4;
      m.rotation.set(Math.sin(this.t * 0.5) * 0.05, U.spin, Math.cos(this.t * 0.43) * 0.05);
      // the beam comes and goes
      const bk = Math.max(0, Math.sin(this.t * 0.6)) ** 0.5;
      m.beam.visible = bk > 0.02;
      m.beam.position.set(U.x, U.y - 0.8, U.z);
      m.beam.scale.set(1, U.y - 0.8 - U.gy, 1);
      m.beam.material.opacity = bk;
      // watched: standing, or stopped in a car, within 900 m, and looking right at it
      const dp = Math.hypot(px - U.x, pz - U.z);
      if (dp < 900 && spd < 1.5 && this._looking(camera, U.x, U.y, U.z, 0.965)) U.watch += dt;
      else U.watch = Math.max(0, U.watch - dt * 0.5);
      if (U.watch > 2) {
        // it knows. Tip, and go: away from you and up
        U.dart = 0; U.watch = 0;
        const ax = U.x - px, az = U.z - pz, al = Math.hypot(ax, az) || 1;
        U.vx = (ax / al) * 0.55; U.vz = (az / al) * 0.55; U.vy = 0.84;
        U.speed = 4;
        m.beam.visible = false;
        this.sfxUfo();
        const sfx = this.credit('ufo', U.x, U.y, U.z);
        setTimeout(() => this.toast(`Lights over a Woolwich field off ${FIELD.road}, and then... gone. Nobody at the Record will believe you${sfx}`, 6500), 1400);
      }
    } else {
      U.dart += dt;
      U.speed = Math.min(420, U.speed + dt * (60 + U.dart * 260));
      U.x += U.vx * U.speed * dt; U.z += U.vz * U.speed * dt; U.y += U.vy * U.speed * dt;
      m.rotation.set(Math.atan2(U.vz, 1) * 0.6, U.spin * 3, -Math.atan2(U.vx, 1) * 0.6);
      if (U.dart > 3.2) { U.dart = -1; U.gone = 240; m.visible = false; return; }
    }
    m.position.set(U.x, U.y, U.z);
    m.visible = true;
  }

  _buildCrop() {
    const R = 50, N = 32, gy = (x, z) => this.city.groundAt(x, z, null);
    const pos = [], uv = [], idx = [];
    for (let j = 0; j <= N; j++) for (let i = 0; i <= N; i++) {
      const x = FIELD.x - R + (2 * R * i) / N, z = FIELD.z - R + (2 * R * j) / N;
      pos.push(x, gy(x, z) + 0.12, z); uv.push(i / N, 1 - j / N);
    }
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) { const a = j * (N + 1) + i, b = a + 1, c = a + N + 1, d = c + 1; idx.push(a, c, b, b, c, d); }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex(idx);
    g.computeVertexNormals();
    g.computeBoundingSphere();
    const m = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ map: cropTexture(), transparent: true, depthWrite: false, roughness: 1, metalness: 0,
      polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }));
    m.name = 'kw-cropcircle'; m.renderOrder = 2; m.visible = false; m.receiveShadow = true;
    this.scene.add(m);
    this.crop = m;
    this.cs.gy = gy(FIELD.x, FIELD.z);
  }

  _crop(dt, camera) {
    const c = camera.position;
    const high = c.y - (this.cs.gy !== undefined ? this.cs.gy : this.city.groundAt(FIELD.x, FIELD.z, null)) > 60;
    if (!high) { if (this.crop) this.crop.visible = false; this.cs.look = 0; return; }
    if (!this.crop) this._buildCrop();
    this.crop.visible = true;
    const near = Math.hypot(c.x - FIELD.x, c.z - FIELD.z) < 900;
    if (near && this._looking(camera, FIELD.x, this.cs.gy, FIELD.z, 0.82)) this.cs.look += dt; else this.cs.look = 0;
    if (this.cs.look > 1.0 && !this.cs.told) {
      this.cs.told = true;
      this.sfxChime();
      const sfx = this.credit('crop', FIELD.x, this.cs.gy + 2, FIELD.z);
      this.toast(`A crop circle in a stubble field off ${FIELD.road}, with a goose's footprint in the middle. The geese deny everything${sfx}`, 6500);
    }
    if (!near) this.cs.told = false;
  }

  // --- 4. the payphone ------------------------------------------------------------------
  _buildPhone() {
    const gy = this.city.groundAt(PHONE.x, PHONE.z, null);
    const m = new THREE.Mesh(phoneGeometry(), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.5, metalness: 0.35 }));
    m.name = 'kw-payphone'; m.castShadow = false;
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(0.74, 0.23), new THREE.MeshBasicMaterial({ map: phoneSign(), toneMapped: false }));
    sign.position.set(0, 2.12, 0.222);
    m.add(sign);
    m.position.set(PHONE.x, gy, PHONE.z);
    m.rotation.y = PHONE.h;
    this.scene.add(m);
    this.phone = m;
    this.ps.gy = gy;
  }

  ringWindow() { const h = this.hour(); return this.dark() && (h >= 21.5 || h < 3); }

  _phone(dt, dark, foot, px, pz) {
    if (!this.phone) this._buildPhone();
    this.phone.visible = true;
    const P = this.ps, d = Math.hypot(px - PHONE.x, pz - PHONE.z);
    P.quiet = Math.max(0, P.quiet - dt);
    P.ringing = this.ringWindow() && P.quiet <= 0 && d < 70;
    if (P.ringing) {
      P.next -= dt;
      if (P.next <= 0) { P.next = 6; this.sfxRing(0.55 * Math.max(0, 1 - d / 70) ** 1.5); }
      if (d < 35 && this.t - P.said > 40) { P.said = this.t; this.toast('A payphone is ringing outside Mr. Sub. At this hour?', 4200); }
    } else P.next = 0;
    // the ENTER hint, once per approach
    const at = foot && d < 2.6;
    if (at && !P.prompt) { P.prompt = true; this.toast(P.ringing ? 'ENTER — answer the payphone' : 'A Bell payphone. ENTER — pick up', 3000); }
    if (!at) P.prompt = false;
  }

  /** ENTER on foot (main.js game.tryInteract): the payphone. */
  tryInteract(pl) {
    if (!pl || !pl.onFoot || !this.phone) return false;
    if (Math.hypot(pl.x - PHONE.x, pl.z - PHONE.z) > 2.6) return false;
    const P = this.ps;
    if (!P.ringing) {
      this.sfxDial();
      this.toast(this.ringWindow() ? 'Dial tone. Whoever was calling has hung up' : 'Dial tone. Nobody to call. (It rings sometimes, they say. Late.)', 4200);
      return true;
    }
    P.ringing = false; P.quiet = 120; P.next = 0;
    const sfx = this.credit('phone', PHONE.x, this.ps.gy + 1.6, PHONE.z);
    const left = LIST.filter((s) => s.riddle && !this.found.has(s.id));
    const pick = left.length ? left[Math.floor(Math.random() * left.length)].riddle
      : ['Do not take the Conestoga at five', 'The geese are watching. They always were', 'Order the double-double. Trust me'][Math.floor(Math.random() * 3)];
    this.toast(`…static, then a voice, very close: "${pick}." Click${sfx}`, 7000);
    const eg = this.eggHint(pl.x, pl.z);
    if (eg) setTimeout(() => this.toast(`It rings once more. The same voice: "${eg}." The line goes dead`, 7000), 7400);
    return true;
  }

  /** The nearest uncollected golden egg, said like a riddle (kweggs.js EGGS). */
  eggHint(px, pz) {
    const E = this.o.eggs && this.o.eggs();
    if (!E || !E.spots) return '';
    let best = null, bd = Infinity;
    for (const s of E.spots) { if (s.got) continue; const d = Math.hypot(s.x - px, s.z - pz); if (d < bd) { bd = d; best = s; } }
    if (!best) return '';
    const ang = Math.atan2(best.x - px, -(best.z - pz));
    const dir = ['north', 'north-east', 'east', 'south-east', 'south', 'south-west', 'west', 'north-west'][(Math.round(ang / (Math.PI / 4)) + 8) % 8];
    return `Something golden waits ${bd < 1000 ? Math.round(bd / 50) * 50 + ' metres' : (bd / 1000).toFixed(1) + ' kilometres'} ${dir} of here: ${best.n}`;
  }

  // --- 5. the Doon lantern ----------------------------------------------------------------
  _buildLantern() {
    const m = new THREE.Mesh(lanternGeometry(), new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false }));
    m.name = 'kw-lantern'; m.visible = false;
    const glow = new THREE.Mesh(lanternGlowGeometry(), new THREE.MeshBasicMaterial({ map: glowTex('rgba(255,214,140,0.95)', 'rgba(255,160,60,0.35)'),
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, toneMapped: false, fog: false }));
    glow.name = 'kw-lanternglow'; glow.visible = false; glow.renderOrder = 6;
    m.glow = glow;
    this.scene.add(m, glow);
    this.lantern = m;
  }

  _lanternAt(s) {
    const L = this.ls;
    let i = 1;
    while (i < LANTERN.length - 1 && this.lcum[i] < s) i++;
    const a = LANTERN[i - 1], b = LANTERN[i], l = this.lcum[i] - this.lcum[i - 1], k = Math.max(0, Math.min(1, (s - this.lcum[i - 1]) / l));
    L.x = a[0] + (b[0] - a[0]) * k; L.z = a[1] + (b[1] - a[1]) * k; L.hd = Math.atan2(b[0] - a[0], b[1] - a[1]);
  }

  _lantern(dt, dark, foot, px, pz) {
    const L = this.ls;
    if (!dark) { if (this.lantern) this.lantern.visible = this.lantern.glow.visible = false; if (L.st !== 'gone') { L.st = 'wait'; L.s = 0; } return; }
    if (!this.lantern) this._buildLantern();
    L.wait = Math.max(0, L.wait - dt);
    if (L.st === 'gone') { if (L.wait <= 0) { L.st = 'wait'; L.s = 0; L.k = 0; } else { this.lantern.visible = this.lantern.glow.visible = false; return; } }
    const d = Math.hypot(px - L.x, pz - L.z);
    let mv = 0;
    if (L.st === 'wait') {
      L.s = 0;
      if (foot && d < 30) {
        L.st = 'walk';
        if (!L.told) { L.told = true; this.toast('A lantern is moving off between the houses of the old village. Nobody is holding it. Follow it', 5200); }
      }
    } else if (L.st === 'walk') {
      if (!foot || d > 110) { L.lost += dt; if (L.lost > 15) { L.st = 'wait'; L.s = 0; L.lost = 0; } }
      else L.lost = 0;
      // it waits for you when you fall behind, and does not run from you
      if (foot && d < 22) { mv = 1.45; L.s += mv * dt; }
      if (L.s >= L.len) { L.s = L.len; L.st = 'end'; L.end = 0; this.sfxBell(); }
    } else if (L.st === 'end') {
      L.end += dt;
      if (L.end > 0.6 && !L.paid) {
        L.paid = true;
        const sfx = this.credit('lantern', L.x, this.city.groundAt(L.x, L.z, null) + 1, L.z);
        this.toast(`The lantern is set down by the barn door, and goes out. Doon Heritage Village is still 1914 after dark${sfx}`, 6500);
      }
      if (L.end > 3) { L.st = 'gone'; L.wait = 120; L.paid = false; L.told = false; this.lantern.visible = this.lantern.glow.visible = false; return; }
    }
    this._lanternAt(L.s);
    const gy = this.city.groundAt(L.x, L.z, null);
    const m = this.lantern;
    // carried: a step bob while it moves, a slow pendulum swing; set down at the end
    L.k += dt * (mv ? 7.5 : 0);
    const down = L.st === 'end' ? Math.min(1, L.end / 1.0) : 0;
    const hy = gy + 1.0 + (mv ? Math.abs(Math.sin(L.k)) * 0.05 : 0) - down * 0.53;
    m.position.set(L.x, hy, L.z);
    m.rotation.set(Math.sin(this.t * 1.9) * (mv ? 0.16 : 0.05) * (1 - down), L.hd || 0, Math.sin(this.t * 1.3) * 0.05 * (1 - down));
    const out = L.st === 'end' ? Math.max(0, 1 - Math.max(0, L.end - 1.0) / 1.6) : 1;
    m.material.color.setScalar(0.25 + 0.75 * out);
    m.glow.position.set(L.x, gy + 1.0, L.z);
    m.glow.material.opacity = out * (0.78 + 0.12 * Math.sin(this.t * 17) * Math.sin(this.t * 5.3));
    m.visible = true; m.glow.visible = out > 0.01;
  }

  // --- 6. Bigfoot in Hidden Valley --------------------------------------------------------
  _buildBigfoot() {
    const m = new THREE.Mesh(bigfootGeometry(), bigfootMaterial(this.uPh));
    m.name = 'kw-bigfoot'; m.visible = false; m.castShadow = false; m.scale.setScalar(1.15);   // ~2.6 m
    // a fade by material opacity (transparent only while fading)
    this.scene.add(m);
    this.bigfoot = m;
  }

  _bigfoot(dt, foot, px, pz, py, camera) {
    const B = this.bs;
    B.gone = Math.max(0, B.gone - dt);
    const w = this.wx();
    const on = (w === 'fog' || w === 'drizzle' || this.twilight()) && B.gone <= 0;
    if (!on && B.st !== 'flee') { if (this.bigfoot) this.bigfoot.visible = false; B.fade = 0; B.st = 'walk'; return; }
    if (!this.bigfoot) this._buildBigfoot();
    const m = this.bigfoot;
    const dp = Math.hypot(px - B.x, pz - B.z);
    let speed = 0, rate = 3.4;
    if (B.st === 'walk') {
      B.fade = Math.min(1, B.fade + dt * 0.6);
      const T = B.tgt ? BIGFOOT.b : BIGFOOT.a;
      const want = Math.atan2(T[0] + Math.sin(this.t * 0.3) * 6 - B.x, T[1] - B.z);
      let dh = want - B.h; dh = Math.atan2(Math.sin(dh), Math.cos(dh));
      B.h += dh * Math.min(1, dt * 1.5);
      speed = 1.25;
      if (Math.hypot(T[0] - B.x, T[1] - B.z) < 4) B.tgt = 1 - B.tgt;
      if (dp < 40 && B.fade > 0.5) { B.st = 'look'; B.t = 0; }
    } else if (B.st === 'look') {
      // it stops and turns its head (all of it) to you
      B.t += dt;
      const want = Math.atan2(px - B.x, pz - B.z);
      let dh = want - B.h; dh = Math.atan2(Math.sin(dh), Math.cos(dh));
      B.h += dh * Math.min(1, dt * 3);
      if (B.t > 1.3) {
        B.st = 'flee'; B.t = 0;
        this.sfxWhoop(Math.max(0.15, 1 - dp / 120));
        const sfx = this.credit('bigfoot', B.x, this.city.groundAt(B.x, B.z, null) + 2, B.z);
        setTimeout(() => this.toast(`Something big and hairy just crossed the Hidden Valley woods by the Grand. You have no photo, of course${sfx}`, 6500), 1600);
      }
    } else if (B.st === 'flee') {
      B.t += dt;
      // away from you, into the trees by the river, at a lope; gone in a few seconds
      const want = Math.atan2(B.x - px, B.z - pz);
      let dh = want - B.h; dh = Math.atan2(Math.sin(dh), Math.cos(dh));
      B.h += dh * Math.min(1, dt * 2.5);
      speed = 6; rate = 7.5;
      if (B.t > 1.6) B.fade = Math.max(0, B.fade - dt * 0.6);
      if (B.fade <= 0) { B.st = 'walk'; B.gone = 180; B.x = BIGFOOT.a[0]; B.z = BIGFOOT.a[1]; m.visible = false; return; }
    }
    const nx = B.x + Math.sin(B.h) * speed * dt, nz = B.z + Math.cos(B.h) * speed * dt;
    if (!G.isWater(nx, nz)) { B.x = nx; B.z = nz; }
    B.ph += dt * rate * (speed > 0 ? 1 : 0);
    this.uPh.value = B.ph;
    const gy = this.city.groundAt(B.x, B.z, null);
    m.position.set(B.x, gy + Math.abs(Math.sin(B.ph)) * (speed > 3 ? 0.12 : 0.05), B.z);
    m.rotation.set(speed > 3 ? 0.3 : 0.1, B.h, 0);
    const tr = B.fade < 0.999;
    if (m.material.transparent !== tr) { m.material.transparent = tr; m.material.needsUpdate = true; }
    m.material.opacity = B.fade;
    m.visible = B.fade > 0.01;
  }

  // --- sound: a few WebAudio nodes per event ------------------------------------------------
  _ac() { const a = this.o.audio; return a && a.ready && a.enabled !== false && a.ctx && a.sfxBus ? a : null; }
  _noise(c) {
    if (!this._nb) {
      const n = Math.floor(c.sampleRate * 1.5), b = c.createBuffer(1, n, c.sampleRate), d = b.getChannelData(0);
      for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
      this._nb = b;
    }
    return this._nb;
  }
  _env(c, t, peak, a, dur) { const g = c.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(peak, t + a); g.gain.exponentialRampToValueAtTime(0.0001, t + dur); return g; }
  _osc(c, type, f0, f1, t, dur) { const o = c.createOscillator(); o.type = type; o.frequency.setValueAtTime(f0, t); if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(f1, t + dur); o.start(t); o.stop(t + dur + 0.05); return o; }

  /** A breath of cold air and a falling moan. */
  sfxGhost() {
    const a = this._ac(); if (!a) return;
    try {
      const c = a.ctx, t = c.currentTime;
      const n = c.createBufferSource(); n.buffer = this._noise(c);
      const f = c.createBiquadFilter(); f.type = 'bandpass'; f.Q.value = 3; f.frequency.setValueAtTime(1400, t); f.frequency.exponentialRampToValueAtTime(320, t + 1.8);
      const g = this._env(c, t, 0.32, 0.25, 1.9);
      n.connect(f).connect(g).connect(a.sfxBus); n.start(t); n.stop(t + 2);
      const o = this._osc(c, 'sine', 330, 150, t, 1.9), lfo = this._osc(c, 'sine', 5.5, 5.5, t, 1.9), lg = c.createGain(); lg.gain.value = 9;
      lfo.connect(lg).connect(o.frequency);
      o.connect(this._env(c, t, 0.09, 0.4, 1.9)).connect(a.sfxBus);
    } catch (e) { /* audio */ }
  }
  /** A payphone's bell: two partials struck 20 times a second for two seconds. */
  sfxRing(gain) {
    const a = this._ac(); if (!a || gain < 0.01) return;
    try {
      const c = a.ctx, t = c.currentTime;
      const g = c.createGain(); g.gain.setValueAtTime(0, t);
      const tr = c.createGain(); tr.gain.value = 0;
      for (const f of [1180, 1735, 2410]) { const o = this._osc(c, 'sine', f, f, t, 2); const og = c.createGain(); og.gain.value = f > 2000 ? 0.25 : 0.5; o.connect(og).connect(tr); }
      // the clapper: a 20 Hz square into the tremolo gain
      const lfo = this._osc(c, 'square', 20, 20, t, 2), lg = c.createGain(); lg.gain.value = 0.5;
      lfo.connect(lg).connect(tr.gain);
      g.gain.linearRampToValueAtTime(gain * 0.35, t + 0.02); g.gain.setValueAtTime(gain * 0.35, t + 1.9); g.gain.linearRampToValueAtTime(0, t + 2);
      tr.connect(g).connect(a.sfxBus);
    } catch (e) { /* audio */ }
  }
  sfxDial() {
    const a = this._ac(); if (!a) return;
    try { const c = a.ctx, t = c.currentTime; for (const f of [350, 440]) this._osc(c, 'sine', f, f, t, 1.6).connect(this._env(c, t, 0.08, 0.02, 1.6)).connect(a.sfxBus); } catch (e) { /* audio */ }
  }
  /** A rising whine, and a whoosh. */
  sfxUfo() {
    const a = this._ac(); if (!a) return;
    try {
      const c = a.ctx, t = c.currentTime;
      const o = this._osc(c, 'sine', 240, 2600, t, 1.5), lfo = this._osc(c, 'sine', 9, 14, t, 1.5), lg = c.createGain(); lg.gain.value = 40;
      lfo.connect(lg).connect(o.frequency);
      o.connect(this._env(c, t, 0.16, 0.08, 1.6)).connect(a.sfxBus);
      this._osc(c, 'triangle', 110, 900, t, 1.3).connect(this._env(c, t, 0.1, 0.05, 1.3)).connect(a.sfxBus);
    } catch (e) { /* audio */ }
  }
  /** Three soft bell pings (the lantern set down), and the crop circle's chime. */
  sfxBell() {
    const a = this._ac(); if (!a) return;
    try { const c = a.ctx, t = c.currentTime; [[660, 0], [990, 0], [1320, 0.0]].forEach(([f, dl]) => this._osc(c, 'sine', f, f, t + dl, 2.2).connect(this._env(c, t + dl, 0.08, 0.005, 2.2)).connect(a.sfxBus)); } catch (e) { /* audio */ }
  }
  sfxChime() {
    const a = this._ac(); if (!a) return;
    try { const c = a.ctx, t = c.currentTime; [523, 659, 784, 1046].forEach((f, i) => this._osc(c, 'sine', f, f, t + i * 0.14, 1.4).connect(this._env(c, t + i * 0.14, 0.09, 0.01, 1.4)).connect(a.sfxBus)); } catch (e) { /* audio */ }
  }
  /** A low whooping call through the trees. */
  sfxWhoop(gain = 1) {
    const a = this._ac(); if (!a) return;
    try {
      const c = a.ctx, t = c.currentTime;
      const o = c.createOscillator(); o.type = 'sawtooth';
      o.frequency.setValueAtTime(170, t); o.frequency.exponentialRampToValueAtTime(320, t + 0.5); o.frequency.exponentialRampToValueAtTime(140, t + 1.7);
      o.start(t); o.stop(t + 1.8);
      const f = c.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 650; f.Q.value = 6;
      o.connect(f).connect(this._env(c, t, 0.22 * gain, 0.15, 1.75)).connect(a.sfxBus);
    } catch (e) { /* audio */ }
  }
}
