// Pedestrians: civilians wandering the sidewalks and cops on foot.

import * as THREE from './three.js';

const ON_PHONE = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
import { Builder } from './build.js';
import { clamp, lerp, angleWrap, hash2, rng, dist2 } from './util.js';
import * as G from './geo.js';

const SKINS = [[0.95, 0.79, 0.65], [0.82, 0.62, 0.46], [0.55, 0.38, 0.27], [0.36, 0.24, 0.17], [0.99, 0.86, 0.74]];
// Street clothes, not toy brights: every tone pulled toward grey and down in
// value. A crowd wearing saturated primaries under one matte material is a bin
// of plastic figures -- muting the palette is half of what stops that reading.
const SHIRTS = [
  [0.55, 0.22, 0.20], [0.22, 0.30, 0.47], [0.20, 0.38, 0.30], [0.72, 0.68, 0.62],
  [0.24, 0.24, 0.27], [0.62, 0.47, 0.20], [0.42, 0.27, 0.42], [0.24, 0.42, 0.45],
  [0.78, 0.77, 0.74], [0.38, 0.40, 0.42], [0.12, 0.13, 0.15], [0.50, 0.12, 0.14],
];
const PANTS = [[0.18, 0.22, 0.34], [0.2, 0.2, 0.22], [0.35, 0.3, 0.25], [0.45, 0.45, 0.48], [0.12, 0.14, 0.18]];
const HAIR = [[0.12, 0.09, 0.07], [0.30, 0.20, 0.10], [0.48, 0.39, 0.25], [0.62, 0.61, 0.60], [0.34, 0.14, 0.09], [0.05, 0.045, 0.04]];
// A whole city in identical black shoes is a uniform -- but the first white
// pair was the brightest thing on the pavement, a pair of lamps at the bottom
// of every figure. Colourways skew dark and mid-tone; off-white is one in six.
const SHOES = [[0.10, 0.10, 0.11], [0.24, 0.15, 0.09], [0.14, 0.16, 0.22], [0.26, 0.26, 0.25], [0.42, 0.32, 0.20], [0.52, 0.51, 0.48]];
const SOLES = [[0.16, 0.155, 0.15], [0.10, 0.08, 0.06], [0.50, 0.49, 0.46], [0.14, 0.14, 0.14], [0.20, 0.15, 0.10], [0.62, 0.61, 0.58]];

// Skeleton layout. Characters are skinned meshes: one draw call each, but with
// real elbows, knees and a spine, which is the difference between a walk cycle
// and a pair of swinging planks.
const B = {
  root: 0, hips: 1, spine: 2, chest: 3, neck: 4, head: 5,
  shoulderL: 6, elbowL: 7, handL: 8,
  shoulderR: 9, elbowR: 10, handR: 11,
  thighL: 12, kneeL: 13, footL: 14,
  thighR: 15, kneeR: 16, footR: 17,
  // Fingers: one bone at the knuckles (MCP) and one at the middle joints (PIP)
  // per hand, appended so every index above keeps its meaning. The relaxed
  // curl is modelled into the bind pose; these only add to it -- a loose fist
  // at a run, and the grip a rider holds the bars with (gripHands).
  fingL: 18, tipL: 19, fingR: 20, tipR: 21,
};
const BONE_COUNT = 22;
// Exported so vehicles.js can pose a rider on a motorcycle. A bike's rider is
// this same humanoid held in a static pose rather than a model of its own --
// one SkinnedMesh, one draw call, and it inherits every future fix to the body.
export { B as BONES };

// Joint heights in character space, taken from adult anthropometry as
// fractions of a 1.75 m stature (eye 0.936H, chin 0.870H, acromion 0.812H,
// elbow 0.630H, wrist 0.485H, hip 0.530H, knee 0.285H, ankle 0.039H).
const J = {
  hip: 0.927, spine: 1.06, chest: 1.26, neck: 1.47, head: 1.56,
  shoulder: 1.421, elbow: 1.103, wrist: 0.849,
  knee: 0.499, ankle: 0.068,
  chin: 1.522, eye: 1.638, crown: 1.750,
};
const SHOULDER_X = 0.150;   // glenohumeral centre; the deltoid takes it to 0.21
const HIP_X = 0.085;
// The hand's knuckle line (MCP joints), and where the middle joints sit in the
// relaxed bind pose, relative to it: in toward the palm and down.
const KNUCKLE = J.wrist - 0.082;
const PIP_IN = 0.008, PIP_DOWN = 0.040;
// Around-the-body segment counts. At 14 (torso, head) and 10 (limbs) every
// silhouette edge showed its facets from across the street and the skull read
// as a cut gem; 18 and 12 cost ~1.7k triangles a character, which a crowd of
// 24 one-draw-call figures does not notice.
const ST = 18, SL = 12;

function makeSkeletonBones() {
  const bones = [];
  for (let i = 0; i < BONE_COUNT; i++) bones.push(new THREE.Bone());
  const set = (b, x, y, z) => bones[b].position.set(x, y, z);
  const link = (parent, child) => bones[parent].add(bones[child]);

  set(B.root, 0, 0, 0);
  set(B.hips, 0, J.hip, 0);
  set(B.spine, 0, J.spine - J.hip, 0);
  set(B.chest, 0, J.chest - J.spine, 0);
  set(B.neck, 0, J.neck - J.chest, 0);
  set(B.head, 0, J.head - J.neck, 0);
  set(B.shoulderL, -SHOULDER_X, J.shoulder - J.chest, 0);
  set(B.elbowL, 0, J.elbow - J.shoulder, 0);
  set(B.handL, 0, J.wrist - J.elbow, 0);
  set(B.shoulderR, SHOULDER_X, J.shoulder - J.chest, 0);
  set(B.elbowR, 0, J.elbow - J.shoulder, 0);
  set(B.handR, 0, J.wrist - J.elbow, 0);
  set(B.thighL, -HIP_X, 0, 0);
  set(B.kneeL, 0, J.knee - J.hip, 0);
  set(B.footL, 0, J.ankle - J.knee, 0);
  set(B.thighR, HIP_X, 0, 0);
  set(B.kneeR, 0, J.knee - J.hip, 0);
  set(B.footR, 0, J.ankle - J.knee, 0);
  set(B.fingL, 0, KNUCKLE - J.wrist, 0);
  set(B.fingR, 0, KNUCKLE - J.wrist, 0);
  // the PIP line, where the relaxed MCP curl (FINGERS) puts it: toward the palm
  set(B.tipL, PIP_IN, -PIP_DOWN, 0);
  set(B.tipR, -PIP_IN, -PIP_DOWN, 0);

  link(B.root, B.hips);
  link(B.hips, B.spine); link(B.spine, B.chest);
  link(B.chest, B.neck); link(B.neck, B.head);
  link(B.chest, B.shoulderL); link(B.shoulderL, B.elbowL); link(B.elbowL, B.handL);
  link(B.chest, B.shoulderR); link(B.shoulderR, B.elbowR); link(B.elbowR, B.handR);
  link(B.hips, B.thighL); link(B.thighL, B.kneeL); link(B.kneeL, B.footL);
  link(B.hips, B.thighR); link(B.thighR, B.kneeR); link(B.kneeR, B.footR);
  link(B.handL, B.fingL); link(B.fingL, B.tipL);
  link(B.handR, B.fingR); link(B.fingR, B.tipR);
  return bones;
}

/** Elliptical cross-section in the XZ plane. */
function oval(rx, rz, n = 10, ox = 0, oz = 0) {
  const pts = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    pts.push([ox + Math.cos(a) * rx, oz + Math.sin(a) * rz]);
  }
  return pts;
}

const smoothT = (v) => v * v * (3 - 2 * v);

// ---------------------------------------------------------------------------
// THE CHARACTER ATLAS.
//
// Characters used to be vertex colour only, and a paintless mesh cannot do a
// face: eyes, brows and lips were 3-6 mm boxes standing proud of the skull,
// which read as stuck-on plates up close and, being thinner than a depth
// texel at street distance, shimmered as you walked past. The agreed way past
// that was a painted atlas in the manner of textures.js's facadeAtlas.
//
// One 1024 x 1024 canvas, drawn once at boot and shared by every character
// through the one material, so a character is still ONE draw call:
//  - cells 0-4: a painted face per skin tone -- head vertices are white, so
//    what shows is the painted skin, with real eye whites, iris and lash line;
//  - the rest: greyscale detail that MULTIPLIES the vertex colour, so one
//    denim cell serves every trouser colour and one knit cell every shirt.
//
// ROUND TWO, and the lesson of round one: at street distance a figure is ~150
// px tall and a face is twenty, so fine fabric grain simply is not there. What
// carries is CONTRAST AT GARMENT BOUNDARIES -- collars, cuffs, hems, belts,
// pockets -- and silhouette. Those are geometry where they have to read
// (collars, cuffs, belts, hood, hi-vis bands) and high-contrast paint where
// they can be flat (pocket outlines, ribbed hems, seams at 45-60% value, not
// the 66-78% the first pass used).
const ATLAS = 1024, CELL = 256, PAD = 6, CW = CELL - 2 * PAD;
const CELLS = {
  shirt: 5, jacket: 6, pants: 7, shoe: 8, hair: 9, hand: 10, skin: 11,
  hoodie: 12, skirt: 13, curly: 14, uniform: 15,
};
// The face cell wraps +-112 deg of the head, not the whole circumference:
// what is behind the ears is hair or plain skin, and spending the cell on the
// front puts ~140 px across the face instead of ~80.
const HEAD_SPAN = 0.62 * Math.PI;
const HEAD_Z = -0.004;
const HY0 = J.chin - 0.020, HY1 = J.crown + 0.010;
const HAIRLINE = J.eye + 0.040;

function atlasUV(cell, t, s) {
  const cx = (cell % 4) * CELL, cy = Math.floor(cell / 4) * CELL;
  return [(cx + PAD + t * CW) / ATLAS, 1 - (cy + PAD + (1 - s) * CW) / ATLAS];
}
/** Cylindrical projection of a part around a vertical axis through (cx, cz). */
const cylUV = (cell, cx, cz, y0, y1, span = Math.PI) => (x, y, z) => [
  clamp(0.5 + Math.atan2(x - cx, z - cz) / (2 * span), 0, 1),
  clamp((y - y0) / (y1 - y0), 0, 1),
  cell,
];

function drawAtlas() {
  const c = document.createElement('canvas');
  c.width = c.height = ATLAS;
  const g = c.getContext('2d');
  const R = rng(9173);
  // Vertex colours are linear and the map is sRGB-decoded, so a painted skin
  // has to be ENCODED to land on the same value as the neck it joins.
  const enc = (v) => {
    v = clamp(v, 0, 1);
    return Math.round((v <= 0.0031308 ? 12.92 * v : 1.055 * Math.pow(v, 1 / 2.4) - 0.055) * 255);
  };
  const rgba = (rgb, a = 1) => `rgba(${enc(rgb[0])},${enc(rgb[1])},${enc(rgb[2])},${a})`;
  const grey = (v, a = 1) => rgba([v, v, v], a);
  const mul = (rgb, k) => (Array.isArray(k) ? [rgb[0] * k[0], rgb[1] * k[1], rgb[2] * k[2]] : [rgb[0] * k, rgb[1] * k, rgb[2] * k]);
  const P = (t) => PAD + t * CW;
  const Q = (s) => PAD + (1 - s) * CW;
  const inCell = (i, fn) => {
    g.save();
    g.translate((i % 4) * CELL, Math.floor(i / 4) * CELL);
    g.beginPath(); g.rect(0, 0, CELL, CELL); g.clip();
    fn();
    g.restore();
  };
  const disc = (x, y, r) => { g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill(); };
  const blob = (x, y, r, rgb, a) => {
    const gr = g.createRadialGradient(x, y, 0, x, y, r);
    gr.addColorStop(0, rgba(rgb, a)); gr.addColorStop(1, rgba(rgb, 0));
    g.fillStyle = gr; g.fillRect(x - r, y - r, 2 * r, 2 * r);
  };
  const speckle = (n, lo, hi, a = 0.35, size = 1.5) => {
    for (let k = 0; k < n; k++) {
      g.fillStyle = grey(lo + (hi - lo) * R.n(), a);
      g.fillRect(R.n() * CELL, R.n() * CELL, size, size);
    }
  };
  // Fine and low-contrast. Broad strokes at 50-85% grey read as wood grain.
  const strands = (n, top, bottom) => {
    for (let k = 0; k < n; k++) {
      const x = R.n() * CELL, y = top + R.n() * (bottom - top), len = 10 + R.n() * 30;
      g.strokeStyle = grey(0.68 + R.n() * 0.24, 0.22);
      g.lineWidth = 0.6 + R.n() * 0.5;
      g.beginPath(); g.moveTo(x, y); g.lineTo(x + (R.n() - 0.5) * 6, y + len); g.stroke();
    }
  };
  // A ribbed band across the cell -- hems, cuffs, necklines. Dark enough to
  // survive the trip to twenty pixels.
  const rib = (s0, s1, v = 0.55) => {
    g.fillStyle = grey(v, 0.9); g.fillRect(0, Q(s1), CELL, Q(s0) - Q(s1));
    g.fillStyle = grey(v * 0.8, 0.5);
    for (let x = 0; x < CELL; x += 4) g.fillRect(x, Q(s1), 1.5, Q(s0) - Q(s1));
  };
  const seams = (v = 0.50) => {
    g.fillStyle = grey(v, 0.85);
    for (const t of [0.25, 0.75]) g.fillRect(P(t) - 1.5, 0, 3, CELL);
  };

  // --- detail cells: multiplied into the vertex colour --------------------
  // Torso cells are mapped J.hip - 0.06 .. J.shoulder + 0.07, so s 0.04 is the
  // hem and s 0.97 the neckline; arms sharing the cell are mapped wrist ..
  // shoulder, so the same s 0.00-0.06 band lands on the cuff.
  inCell(CELLS.shirt, () => {
    g.fillStyle = grey(0.96); g.fillRect(0, 0, CELL, CELL);
    speckle(2200, 0.78, 1.0);
    g.fillStyle = grey(0.80, 0.08);
    for (let y = 0; y < CELL; y += 3) g.fillRect(0, y, CELL, 1);
    seams();
    rib(0.0, 0.06, 0.58);
    // drape: the cloth gathers above the waist at the sides and under the chest
    for (const t of [0.20, 0.80]) blob(P(t), Q(0.20), 46, [0.62, 0.62, 0.62], 0.5);
    blob(P(0.5), Q(0.52), 60, [0.80, 0.80, 0.80], 0.35);
  });
  inCell(CELLS.jacket, () => {
    g.fillStyle = grey(0.95); g.fillRect(0, 0, CELL, CELL);
    speckle(2000, 0.76, 1.0);
    g.strokeStyle = grey(0.74, 0.12); g.lineWidth = 1;
    for (let k = -CELL; k < 2 * CELL; k += 4) { g.beginPath(); g.moveTo(k, 0); g.lineTo(k + CELL, CELL); g.stroke(); }
    seams(0.48);
    rib(0.0, 0.07, 0.50);
    for (const t of [0.20, 0.80]) blob(P(t), Q(0.22), 46, [0.62, 0.62, 0.62], 0.5);
    // zip placket up the centre line
    g.fillStyle = grey(0.52, 0.95); g.fillRect(P(0.478), Q(0.97), P(0.522) - P(0.478), Q(0.05) - Q(0.97));
    g.fillStyle = grey(0.32, 0.95); g.fillRect(P(0.5) - 1, Q(0.97), 2, Q(0.05) - Q(0.97));
    // two lower pockets with flaps
    g.strokeStyle = grey(0.38, 0.9); g.lineWidth = 2.5;
    for (const t of [0.36, 0.64]) {
      g.strokeRect(P(t) - 12, Q(0.34), 24, Q(0.16) - Q(0.34));
      g.fillStyle = grey(0.55, 0.9); g.fillRect(P(t) - 13, Q(0.34), 26, 6);
    }
  });
  inCell(CELLS.hoodie, () => {
    g.fillStyle = grey(0.95); g.fillRect(0, 0, CELL, CELL);
    speckle(2400, 0.80, 1.0);
    seams(0.55);
    rib(0.0, 0.08, 0.55);
    for (const t of [0.20, 0.80]) blob(P(t), Q(0.24), 50, [0.62, 0.62, 0.62], 0.5);
    // kangaroo pocket: the thing that says "hoodie" from across the street
    g.fillStyle = grey(0.70, 0.9);
    g.beginPath();
    g.moveTo(P(0.36), Q(0.10)); g.lineTo(P(0.64), Q(0.10));
    g.lineTo(P(0.60), Q(0.36)); g.lineTo(P(0.40), Q(0.36)); g.closePath(); g.fill();
    g.strokeStyle = grey(0.35, 0.95); g.lineWidth = 2.5; g.stroke();
    // drawstrings, pale against the neckline
    g.fillStyle = grey(1.0, 0.95);
    for (const t of [0.475, 0.525]) g.fillRect(P(t) - 1.5, Q(0.99), 3, Q(0.80) - Q(0.99));
    rib(0.93, 1.0, 0.52);
  });
  inCell(CELLS.uniform, () => {
    g.fillStyle = grey(0.95); g.fillRect(0, 0, CELL, CELL);
    speckle(1600, 0.80, 1.0);
    seams(0.50);
    g.fillStyle = grey(0.42, 0.9); g.fillRect(P(0.5) - 1.5, Q(0.96), 3, Q(0.05) - Q(0.96));   // button line
    g.strokeStyle = grey(0.40, 0.9); g.lineWidth = 2.5;
    for (const t of [0.40, 0.60]) g.strokeRect(P(t) - 11, Q(0.78), 22, Q(0.64) - Q(0.78));  // breast pockets
    g.fillStyle = grey(1.0); g.fillRect(P(0.40) - 5, Q(0.83), 10, 9);                           // badge
    rib(0.0, 0.05, 0.55);
  });
  inCell(CELLS.skirt, () => {
    g.fillStyle = grey(0.94); g.fillRect(0, 0, CELL, CELL);
    speckle(1400, 0.80, 1.0, 0.3);
    // soft folds falling from the waist
    for (let t = 0.02; t < 1; t += 0.083) {
      const gr = g.createLinearGradient(P(t - 0.04), 0, P(t + 0.04), 0);
      gr.addColorStop(0, grey(1.0, 0)); gr.addColorStop(0.5, grey(0.60, 0.45)); gr.addColorStop(1, grey(1.0, 0));
      g.fillStyle = gr; g.fillRect(P(t - 0.04), Q(0.85), P(t + 0.04) - P(t - 0.04), Q(0) - Q(0.85) + PAD);
    }
    rib(0.0, 0.05, 0.55);
    rib(0.94, 1.0, 0.50);
  });
  inCell(CELLS.pants, () => {
    g.fillStyle = grey(0.90); g.fillRect(0, 0, CELL, CELL);
    g.strokeStyle = grey(0.60, 0.12); g.lineWidth = 1;
    for (let k = -CELL; k < 2 * CELL; k += 3) { g.beginPath(); g.moveTo(k, CELL); g.lineTo(k + CELL, 0); g.stroke(); }
    speckle(2400, 0.75, 1.0);
    // worn at the knee and the top of the thigh, the way denim fades
    blob(P(0.5), Q(0.43), 34, [1, 1, 1], 0.45);
    blob(P(0.5), Q(0.80), 46, [1, 1, 1], 0.30);
    // behind the knee, where trousers crease
    blob(P(0.02), Q(0.40), 30, [0.55, 0.55, 0.55], 0.6);
    blob(P(0.98), Q(0.40), 30, [0.55, 0.55, 0.55], 0.6);
    seams(0.52);
    g.fillStyle = grey(1.0, 0.8);
    for (const t of [0.25, 0.75]) for (let y = 0; y < CELL; y += 6) { g.fillRect(P(t) - 5, y, 1, 3); g.fillRect(P(t) + 4, y, 1, 3); }
    // front pockets, waistband and turn-up at the hem
    g.strokeStyle = grey(0.38, 0.9); g.lineWidth = 2.5;
    for (const t of [0.36, 0.64]) {
      g.beginPath(); g.moveTo(P(t), Q(1.0)); g.quadraticCurveTo(P(t), Q(0.89), P(t + (t < 0.5 ? 0.11 : -0.11)), Q(0.87)); g.stroke();
    }
    rib(0.95, 1.0, 0.50);
    rib(0.0, 0.035, 0.62);
  });
  inCell(CELLS.shoe, () => {
    g.fillStyle = grey(0.92); g.fillRect(0, 0, CELL, CELL);
    speckle(1800, 0.70, 1.0);
    g.fillStyle = grey(0.72, 0.7);
    g.fillRect(0, Q(0.62), P(0.08), Q(0.12) - Q(0.62));
    g.fillRect(P(0.92), Q(0.62), CELL - P(0.92), Q(0.12) - Q(0.62));
    g.beginPath(); g.ellipse(P(0.5), Q(0.16), P(0.14) - PAD, 18, 0, Math.PI, 0); g.fill();
    g.fillStyle = grey(0.50, 0.8);
    for (let x = 0; x < CELL; x += 5) g.fillRect(x, Q(0.20), 3, 1);
    g.fillStyle = grey(0.55, 0.9);
    g.fillRect(P(0.44), Q(0.80), P(0.56) - P(0.44), Q(0.38) - Q(0.80));
    g.fillStyle = grey(1.0, 0.95);
    for (let k = 0; k < 5; k++) g.fillRect(P(0.43), Q(0.42 + k * 0.08), P(0.57) - P(0.43), 2.5);
  });
  inCell(CELLS.hair, () => {
    g.fillStyle = grey(1.0); g.fillRect(0, 0, CELL, CELL);
    strands(1100, -40, CELL);
    // parting and crown shading, so the top of the head is not one flat value
    blob(P(0.5), Q(0.95), 60, [0.75, 0.75, 0.75], 0.4);
  });
  inCell(CELLS.curly, () => {
    g.fillStyle = grey(0.95); g.fillRect(0, 0, CELL, CELL);
    for (let k = 0; k < 900; k++) {
      g.strokeStyle = grey(0.45 + R.n() * 0.4, 0.40);
      g.lineWidth = 1 + R.n();
      g.beginPath(); g.arc(R.n() * CELL, R.n() * CELL, 2 + R.n() * 4, R.n() * 6, R.n() * 6 + 3.5); g.stroke();
    }
  });
  // The palm and back of the hand (fingers are geometry now, on the plain
  // skin cell): mapped wrist + 15 mm .. wrist - 100 mm, so the knuckle line
  // is s ~ 0.16. Only soft value: the finger lines and nails painted for the
  // mitten landed on the back of the new palm as stray strokes.
  inCell(CELLS.hand, () => {
    g.fillStyle = grey(0.97); g.fillRect(0, 0, CELL, CELL);
    speckle(600, 0.88, 1.0, 0.25);
    const gr = g.createLinearGradient(0, Q(0.26), 0, Q(0.10));
    gr.addColorStop(0, grey(0.97, 0)); gr.addColorStop(0.6, grey(0.84, 0.5)); gr.addColorStop(1, grey(0.97, 0));
    g.fillStyle = gr; g.fillRect(0, Q(0.26), CELL, Q(0.10) - Q(0.26));
  });
  inCell(CELLS.skin, () => {
    g.fillStyle = grey(1.0); g.fillRect(0, 0, CELL, CELL);
    speckle(500, 0.92, 1.0, 0.25);
  });

  // --- faces, one per skin tone -------------------------------------------
  const IRIS = [[0.14, 0.09, 0.05], [0.10, 0.07, 0.04], [0.07, 0.045, 0.03], [0.05, 0.035, 0.025], [0.12, 0.13, 0.12]];
  // same projection as the head's cylUV, in cell pixels
  const hp = (x, y, z) => [
    P(clamp(0.5 + Math.atan2(x, z - HEAD_Z) / (2 * HEAD_SPAN), 0, 1)),
    Q(clamp((y - HY0) / (HY1 - HY0), 0, 1)),
  ];
  const sxm = CW / (2 * HEAD_SPAN * 0.090);     // px per metre across the face
  const sym = CW / (HY1 - HY0);                  // px per metre up it
  SKINS.forEach((skin, fi) => {
    inCell(fi, () => {
      g.fillStyle = rgba(skin); g.fillRect(0, 0, CELL, CELL);
      // Above the hairline: SKIN, with strands. It used to be white, which is
      // neutral under the hair-coloured skull rings -- but the hair shell grows
      // out a few millimetres above the line, and the band of skull between
      // the two came out as a thin white stripe across every forehead. Under a
      // shell nothing here shows; on a buzz cut, skin under short hair is right.
      const hy = Q((HAIRLINE - HY0) / (HY1 - HY0));
      g.fillStyle = rgba(skin); g.fillRect(0, 0, CELL, hy);
      // Clipped: a strand stroke starting above the line runs up to 60 px, and
      // unclipped they painted pale streaks down the forehead.
      g.save(); g.beginPath(); g.rect(0, 0, CELL, hy); g.clip();
      strands(500, -40, hy - 4);
      g.restore();
      // a soft shadow under the hairline, and under the jaw
      let gr = g.createLinearGradient(0, hy, 0, hy + 7);
      gr.addColorStop(0, rgba(mul(skin, 0.78), 0.55)); gr.addColorStop(1, rgba(mul(skin, 0.78), 0));
      g.fillStyle = gr; g.fillRect(0, hy, CELL, 8);
      gr = g.createLinearGradient(0, Q(0), 0, Q(0.12));
      gr.addColorStop(0, rgba(mul(skin, 0.74), 0.6)); gr.addColorStop(1, rgba(mul(skin, 0.74), 0));
      g.fillStyle = gr; g.fillRect(0, Q(0.12), CELL, Q(0) - Q(0.12) + PAD);

      const brow = [0.10, 0.075, 0.06];
      for (const sx of [-1, 1]) {
        // cheeks: a little warmth, which is most of what makes skin not clay
        const [cx, cy] = hp(sx * 0.047, J.eye - 0.034, 0.080);
        blob(cx, cy, 0.022 * sxm, mul(skin, [1.0, 0.80, 0.78]), 0.30);
        // eye socket shading
        const [ex, ey] = hp(sx * 0.034, J.eye + 0.001, 0.085);
        blob(ex, ey - 3, 0.022 * sxm, mul(skin, 0.74), 0.50);
        const w = 0.027 * sxm, hh = 0.0105 * sym;
        const inner = ex - sx * w / 2, outer = ex + sx * w / 2;
        const almond = () => {
          g.beginPath();
          g.moveTo(inner, ey);
          g.quadraticCurveTo(ex, ey - hh * 1.10, outer, ey - hh * 0.18);
          g.quadraticCurveTo(ex, ey + hh * 0.80, inner, ey);
          g.closePath();
        };
        g.fillStyle = rgba([0.78, 0.76, 0.72]); almond(); g.fill();
        g.save(); almond(); g.clip();
        g.fillStyle = rgba(IRIS[fi]); disc(ex, ey - hh * 0.12, hh * 0.62);
        g.fillStyle = rgba([0.01, 0.01, 0.01]); disc(ex, ey - hh * 0.12, hh * 0.27);
        g.fillStyle = rgba(mul(skin, 0.35), 0.40); g.fillRect(ex - w, ey - hh * 1.3, 2 * w, hh * 0.6);  // lid shadow
        g.restore();
        g.fillStyle = 'rgba(255,255,255,0.85)'; disc(ex - hh * 0.20, ey - hh * 0.40, 1.1);
        // lash line, heavier toward the outer corner
        g.strokeStyle = rgba([0.035, 0.03, 0.025], 0.95); g.lineWidth = 2.2;
        g.beginPath(); g.moveTo(inner, ey); g.quadraticCurveTo(ex, ey - hh * 1.12, outer + sx * 1.5, ey - hh * 0.30); g.stroke();
        g.strokeStyle = rgba(mul(skin, 0.55), 0.45); g.lineWidth = 1;
        g.beginPath(); g.moveTo(inner + sx, ey - hh * 0.6); g.quadraticCurveTo(ex, ey - hh * 1.9, outer, ey - hh * 0.95); g.stroke();
        g.strokeStyle = rgba(mul(skin, 0.60), 0.45); g.lineWidth = 0.8;
        g.beginPath(); g.moveTo(inner, ey + 0.5); g.quadraticCurveTo(ex, ey + hh * 0.9, outer, ey - hh * 0.1); g.stroke();
        // brow: thick at the inner end, tapering to a tail, slightly arched
        const [bx, by] = hp(sx * 0.035, J.eye + 0.021, 0.089);
        const bw = 0.042 * sxm;
        g.fillStyle = rgba(brow, 0.85);
        g.beginPath();
        g.moveTo(bx - sx * bw * 0.50, by + 2.5);
        g.quadraticCurveTo(bx + sx * bw * 0.02, by - 4.0, bx + sx * bw * 0.55, by + 1.5);
        g.quadraticCurveTo(bx + sx * bw * 0.02, by - 0.2, bx - sx * bw * 0.50, by + 6.0);
        g.closePath(); g.fill();
        // nose sides and nostrils
        // (the nose is modelled now: its sides shade themselves, and the
        // nostrils sit on its underside, so both are only a touch of paint)
        const [nx, ny] = hp(sx * 0.013, J.eye - 0.024, 0.094);
        blob(nx, ny, 7, mul(skin, 0.70), 0.12);
        const [qx, qy] = hp(sx * 0.0075, J.eye - 0.047, 0.101);
        g.fillStyle = rgba(mul(skin, 0.40), 0.45);
        g.beginPath(); g.ellipse(qx, qy, 2.0, 1.1, 0, 0, Math.PI * 2); g.fill();
        // ear: rim and bowl
        const [ax, ay] = hp(sx * 0.078, J.eye - 0.010, -0.006);
        g.strokeStyle = rgba(mul(skin, 0.62), 0.6); g.lineWidth = 2;
        g.beginPath(); g.ellipse(ax, ay, 4.5, 13, 0, 0, Math.PI * 2); g.stroke();
        blob(ax, ay + 2, 6, mul(skin, 0.55), 0.45);
      }
      // A lit top to the nose: a soft sheen down the bridge and on the tip.
      // The modelled nose turns its side from the light, but seen straight
      // on its front plane is the same value as the cheeks either side and the
      // tip dissolved into them.
      {
        const [tx, ty] = hp(0, J.eye - 0.041, 0.115);
        blob(tx, ty, 0.010 * sxm, mul(skin, 1.12), 0.55);
        const [bx0, by0] = hp(0, J.eye - 0.004, 0.100), [, by1] = hp(0, J.eye - 0.034, 0.110);
        const gr2 = g.createLinearGradient(bx0 - 4, 0, bx0 + 4, 0);
        gr2.addColorStop(0, rgba(mul(skin, 1.06), 0)); gr2.addColorStop(0.5, rgba(mul(skin, 1.06), 0.5)); gr2.addColorStop(1, rgba(mul(skin, 1.06), 0));
        g.fillStyle = gr2; g.fillRect(bx0 - 4, by0, 8, by1 - by0);
      }
      // mouth: two lips in the skin family and a seam, no lipstick red
      const [mx, my] = hp(0, J.chin + 0.045, 0.094);
      const mw = 0.036 * sxm;
      g.fillStyle = rgba(mul(skin, [0.80, 0.60, 0.58]));
      g.beginPath(); g.moveTo(mx - mw / 2, my);
      g.quadraticCurveTo(mx - mw * 0.25, my - 5.5, mx, my - 3.5);
      g.quadraticCurveTo(mx + mw * 0.25, my - 5.5, mx + mw / 2, my);
      g.closePath(); g.fill();
      g.fillStyle = rgba(mul(skin, [0.86, 0.66, 0.63]));
      g.beginPath(); g.moveTo(mx - mw / 2, my); g.quadraticCurveTo(mx, my + 8, mx + mw / 2, my); g.closePath(); g.fill();
      g.strokeStyle = rgba(mul(skin, 0.40), 0.9); g.lineWidth = 1.4;
      g.beginPath(); g.moveTo(mx - mw / 2 - 1, my); g.quadraticCurveTo(mx, my + 1.3, mx + mw / 2 + 1, my); g.stroke();
      blob(mx, my + 11, 9, mul(skin, 0.78), 0.35);
      blob(mx, my - 9, 5, mul(skin, 0.82), 0.25);     // philtrum
    });
  });
  return c;
}

let ATLAS_TEX = null;
function atlasTexture() {
  if (!ATLAS_TEX) {
    ATLAS_TEX = new THREE.CanvasTexture(drawAtlas());
    ATLAS_TEX.colorSpace = THREE.SRGBColorSpace;
    ATLAS_TEX.anisotropy = 4;
  }
  return ATLAS_TEX;
}

const pedMat = new THREE.MeshStandardMaterial({
  vertexColors: true, roughness: 0.78, metalness: 0.0, envMapIntensity: 0.7,
  map: atlasTexture(),
});
// A CHARACTER CANNOT SHADOW ITSELF AT THIS MAP'S RESOLUTION. The sun's shadow
// texel is 0.25 m (main.js: a 520 m box on 2048) and its normal bias 0.12 m,
// sized for buildings; a head is 0.23 m tall. So a face's shadow lookup lands
// in one or two texels shared with the nose, the hair and the shoulders, and
// the result is not form but dirt: measured by switching shadows off in the
// portrait harness, the whole lower face and the band under the nose went from
// mud to lit skin. The shadow is still sampled -- a pedestrian in a building's
// shadow must go dark -- but from a point lifted 0.30 m TOWARD the sun, so
// anything within a body's own depth (its own head, nose, hair, arms) cannot
// occlude it while a wall metres away still does. The lift is taken off the
// shadow matrix's depth row, so it stays 0.30 m whatever the box and range are.
pedMat.onBeforeCompile = (sh) => {
  sh.vertexShader = sh.vertexShader.replace('#include <shadowmap_vertex>',
    THREE.ShaderChunk.shadowmap_vertex.replace(
      'vDirectionalShadowCoord[ i ] = directionalShadowMatrix[ i ] * shadowWorldPosition;',
      'vDirectionalShadowCoord[ i ] = directionalShadowMatrix[ i ] * shadowWorldPosition;\n'
      + '\t\t\tvDirectionalShadowCoord[ i ].z -= 0.60 * length( vec3( directionalShadowMatrix[ i ][ 0 ].z, directionalShadowMatrix[ i ][ 1 ].z, directionalShadowMatrix[ i ][ 2 ].z ) );'));
};

/**
 * Accumulates parts into one skinned geometry. Each part supplies a weight
 * function so vertices near a joint blend between two bones instead of
 * creasing, and a UV function that places it in the atlas.
 */
class SkinAcc {
  constructor() {
    this.pos = []; this.nor = []; this.col = []; this.idx = []; this.uv = [];
    this.si = []; this.sw = []; this.parts = [];
  }
  add(builder, weightFn, uvFn, name = '') {
    const base = this.pos.length / 3;
    // Which triangles came from which part, for raycasting a pixel back to
    // the geometry that drew it (tools/charshots.mjs --probe).
    this.parts.push({ name, tri0: this.idx.length / 3, tris: builder.idx.length / 3 });
    const ts = [];
    let cell = CELLS.skin;
    for (let i = 0; i < builder.pos.length; i += 3) {
      const x = builder.pos[i], y = builder.pos[i + 1], z = builder.pos[i + 2];
      this.pos.push(x, y, z);
      this.nor.push(builder.nor[i], builder.nor[i + 1], builder.nor[i + 2]);
      this.col.push(builder.col[i], builder.col[i + 1], builder.col[i + 2]);
      const w = weightFn(x, y, z);
      this.si.push(w[0], w[2] != null ? w[2] : 0, 0, 0);
      this.sw.push(w[1], w[3] != null ? w[3] : 0, 0, 0);
      const m = uvFn(x, y, z);
      ts.push(m[0], m[1]);
      cell = m[2];
    }
    // The back seam. A cylindrical projection wraps from t = 1 back to 0
    // behind the part, and a triangle spanning it interpolates across the
    // WHOLE cell -- a smeared strip of every feature down the back. Builder
    // quads carry their own vertices, so each spanning triangle can simply
    // pin its low side to the cell edge.
    const idx = builder.idx;
    for (let k = 0; k < idx.length; k += 3) {
      const a = idx[k] * 2, b = idx[k + 1] * 2, c = idx[k + 2] * 2;
      if (Math.max(ts[a], ts[b], ts[c]) - Math.min(ts[a], ts[b], ts[c]) > 0.5) {
        for (const q of [a, b, c]) if (ts[q] < 0.5) ts[q] = 1;
      }
    }
    for (let q = 0; q < ts.length; q += 2) {
      const uv = atlasUV(cell, ts[q], ts[q + 1]);
      this.uv.push(uv[0], uv[1]);
    }
    for (const ix of idx) this.idx.push(base + ix);
  }
  build() {
    // Baked vertex ambient occlusion, computed ONCE from the BIND POSE --
    // it does not respond to the current pose (an armpit stays dark with the
    // arm raised). That is the standard trade for a vertex-baked single-
    // material character, and at street distances it is invisible.
    //  - sky term: down-facing surfaces see less sky (underside of chin, arms,
    //    hem) -- from the normal's y.
    //  - crevice term: the armpit/inner-arm and inner-thigh bands, from
    //    distance to the body midline at those heights.
    //  - grounding: a mild darkening toward the feet, which seats the figure
    //    instead of leaving it floating in uniform value.
    for (let i = 0; i < this.pos.length; i += 3) {
      const x = this.pos[i], y = this.pos[i + 1];
      const ny = this.nor[i + 1];
      let ao = 0.84 + 0.16 * clamp(ny * 0.5 + 0.5, 0, 1);         // sky
      const ax = Math.abs(x);
      if (y > 1.10 && y < 1.45 && ax > 0.10 && ax < 0.19) ao *= 0.88;  // armpit band
      if (y > 0.45 && y < 0.95 && ax < 0.075) ao *= 0.90;             // inner thigh
      ao *= 0.90 + 0.10 * clamp(y, 0, 1);                             // grounding
      this.col[i] *= ao; this.col[i + 1] *= ao; this.col[i + 2] *= ao;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(this.si, 4));
    g.setAttribute('skinWeight', new THREE.Float32BufferAttribute(this.sw, 4));
    g.setIndex(this.idx);
    g.computeBoundingSphere();
    g.computeBoundingBox();
    g.userData.parts = this.parts;
    return g;
  }
}

/** Blend between two bones across a joint at height `jy`. */
const across = (jy, span, above, below) => (x, y) => {
  const t = smoothT(clamp((y - (jy - span)) / (span * 2), 0, 1));
  return [above, t, below, 1 - t];
};
const solid = (b) => () => [b, 1, 0, 0];

/** Which painted face cell a skin tone uses: the nearest of SKINS. */
function faceCell(skin) {
  let best = 0, bd = 1e9;
  SKINS.forEach((s, i) => {
    const d = (s[0] - skin[0]) ** 2 + (s[1] - skin[1]) ** 2 + (s[2] - skin[2]) ** 2;
    if (d < bd) { bd = d; best = i; }
  });
  return best;
}

// The skull, as rings. Shared by the head loft and by the hair, which is
// grown FROM this surface rather than modelled beside it.
const SKULL = [
  // Two rings under the jaw: from the chin straight to the jawline was one
  // cone, and the lower face read as a trapezoid with a pointed chin.
  { y: J.chin - 0.012, rx: 0.036, rz: 0.046, oz: 0.022 },   // under the chin
  // The lower face narrower than round two's egg, which read as jowls once
  // the rest of the face had form (faceRelief puts the jaw angle back).
  { y: J.chin - 0.002, rx: 0.041, rz: 0.062, oz: 0.016 },   // chin
  { y: J.chin + 0.010, rx: 0.051, rz: 0.076, oz: 0.011 },   // jaw angle
  { y: J.chin + 0.024, rx: 0.057, rz: 0.085, oz: 0.008 },   // jawline
  { y: J.chin + 0.060, rx: 0.067, rz: 0.093, oz: 0.004 },   // cheeks
  { y: J.eye - 0.020, rx: 0.075, rz: 0.095, oz: 0.001 },    // cheekbone
  { y: J.eye, rx: 0.075, rz: 0.096, oz: 0 },                // brow line
  { y: J.eye + 0.036, rx: 0.072, rz: 0.092, oz: -0.002 },   // forehead, skin
  { y: HAIRLINE + 0.002, rx: 0.073, rz: 0.093, oz: -0.003 }, // hairline
  { y: J.crown - 0.028, rx: 0.058, rz: 0.074, oz: -0.009 },
  { y: J.crown, rx: 0.024, rz: 0.030, oz: -0.013 },
];
function skullAt(y) {
  if (y <= SKULL[0].y) return SKULL[0];
  for (let i = 1; i < SKULL.length; i++) {
    if (y <= SKULL[i].y) {
      const a = SKULL[i - 1], b = SKULL[i], t = (y - a.y) / (b.y - a.y);
      return { y, rx: lerp(a.rx, b.rx, t), rz: lerp(a.rz, b.rz, t), oz: lerp(a.oz, b.oz, t) };
    }
  }
  return SKULL[SKULL.length - 1];
}

// ---------------------------------------------------------------------------
// THE HEAD IS SCULPTED, NOT AN EGG.
//
// Round two painted every feature on a smooth ellipsoid, and up close that
// is what it was: a mannequin with a face drawn on, a nose stuck on as a peg
// and ears as two lozenges. The skull rings above are now only the BASE; the
// head is a grid of columns by rows where each vertex sits on that base plus a
// relief (faceRelief) -- a brow ridge, eye sockets, cheekbones, a nose with a
// bridge, a tip, wings and an underside, a philtrum, two lips, the dip under
// the lower lip, a chin boss and the angle of the jaw.
//
// Every vertex is moved ALONG THE RAY FROM THE UV AXIS, (0, HEAD_Z), at its
// column's angle. The face cell is a cylindrical projection round that same
// axis, so a vertex's texture coordinate is a function of its column and row
// only: the relief cannot slide the painted eyes off the sockets it carved.
// Columns are dense across the face (3-13 deg at the nose and mouth) and
// sparse behind the ears, where the hair is.
const HEAD_COLS = (() => {
  const d = [0, 3, 7, 13, 21, 30, 41, 54, 68, 84, 100, 132, 180].map((v) => (v * Math.PI) / 180);
  return [...d, ...d.slice(1, -1).reverse().map((v) => -v)];
})();
const HEAD_BACK = 12;          // index of the 180 deg column: seams go here
const HEAD_ROWS = [
  J.chin - 0.010, J.chin - 0.001, J.chin + 0.010, J.chin + 0.024,   // under the chin, chin, boss, sulcus
  J.chin + 0.036, J.chin + 0.044, J.chin + 0.052, J.chin + 0.058,   // lower lip, mouth, upper lip, philtrum
  J.eye - 0.052, J.eye - 0.042, J.eye - 0.026, J.eye - 0.012,       // under the nose, tip, mid-nose, under the eye
  J.eye, J.eye + 0.009, J.eye + 0.018,                              // eye, upper lid, brow
  HAIRLINE + 0.002, J.crown - 0.028, J.crown,
];
// rows from here up are hair-coloured under the paint (see drawAtlas)
const HEAD_HAIR_ROW = HEAD_ROWS.length - 3;

/** Distance from the UV axis to the base skull ellipse at height y, along th. */
function skullRay(th, y) {
  const k = skullAt(y);
  const sn = Math.sin(th), cs = Math.cos(th), dz = HEAD_Z - k.oz;
  const A = (sn * sn) / (k.rx * k.rx) + (cs * cs) / (k.rz * k.rz);
  const Bq = (2 * cs * dz) / (k.rz * k.rz);
  const C = (dz * dz) / (k.rz * k.rz) - 1;
  return (-Bq + Math.sqrt(Bq * Bq - 4 * A * C)) / (2 * A);
}

const gss = (v, w) => Math.exp(-(v / w) * (v / w));
/** Piecewise-linear lookup of [y, value] pairs sorted by descending y. */
function byY(y, tbl) {
  if (y >= tbl[0][0]) return tbl[0][1];
  for (let i = 1; i < tbl.length; i++) {
    if (y >= tbl[i][0]) {
      const [y0, v0] = tbl[i - 1], [y1, v1] = tbl[i];
      return lerp(v1, v0, (y - y1) / (y0 - y1));
    }
  }
  return tbl[tbl.length - 1][1];
}

/**
 * Per-look proportions, so twelve pooled heads are not one head in twelve
 * skin tones. Kept in bands where the painted features still land on the
 * forms they belong to.
 */
function faceParams(seed, soft) {
  const u = (k) => hash2(seed, 40 + k);
  return {
    nose: 0.85 + 0.35 * u(0),
    bridge: 0.8 + 0.4 * u(1),
    brow: (0.75 + 0.5 * u(2)) * (soft ? 0.65 : 1),
    cheek: 0.75 + 0.5 * u(3),
    jaw: (0.7 + 0.6 * u(4)) * (soft ? 0.55 : 1),
    chin: 0.7 + 0.6 * u(5),
    lips: (0.85 + 0.3 * u(6)) * (soft ? 1.2 : 1),
  };
}

/**
 * The relief, in metres along the ray, at column angle th and height y.
 * `a` is arc length across the face from the midline. Every term is a feature
 * the face cell already paints at that angle and height (see drawAtlas's hp):
 * eyes at +-21 deg, brows at eye + 21 mm, nostrils at eye - 46 mm, the mouth
 * at chin + 45 mm.
 */
function faceRelief(th, y, F) {
  const a = Math.abs(th) * 0.095;
  const E = J.eye, C = J.chin;
  let d = 0;
  // Nose. The bridge rises out of the brow, the tip is the most forward point
  // of the face, and the underside runs back to the lip in one row -- a nose
  // from below is a triangle, not a cylinder end.
  const np = byY(y, [[E + 0.012, 0], [E + 0.002, 0.0045 * F.bridge], [E - 0.012, 0.0095 * F.bridge],
    [E - 0.026, 0.0150], [E - 0.042, 0.0205 * F.nose], [E - 0.052, 0.0060], [C + 0.052, 0]]);
  // The columella (the strip between the nostrils) keeps the base of the
  // nose forward in the middle: with the whole underside running back to the
  // lip in one row it was a broad down-facing band, and its shadow, smoothed
  // onto the upper lip, read as a moustache.
  const nw = byY(y, [[E + 0.012, 0.0070], [E - 0.012, 0.0070], [E - 0.030, 0.0090], [E - 0.042, 0.0115], [E - 0.052, 0.0072]]);
  // A plateau, not a bell: the dorsum is a flat strip with steep sides, which
  // is what gives a nose a side plane that turns from the light.
  const nq = (a / nw) * (a / nw);
  d += np / (1 + nq * nq);
  // the wings of the nose, either side of the tip
  d += 0.0062 * gss(a - 0.0205, 0.0066) * gss(y - (E - 0.044), 0.0065);
  // Eye sockets, deepest at the painted eye, and the brow ridge over them.
  d -= 0.0068 * gss(a - 0.0345, 0.0175) * gss(y - (E + 0.002), 0.0115);
  d += 0.0046 * F.brow * gss(y - (E + 0.019), 0.0078) * gss(Math.max(0, a - 0.028), 0.030);
  // glabella: the brows meet over the bridge
  d += 0.0015 * F.brow * gss(a, 0.012) * gss(y - (E + 0.012), 0.008);
  // Cheekbones, and the soft hollow under them.
  d += 0.0042 * F.cheek * gss(a - 0.064, 0.019) * gss(y - (E - 0.024), 0.013);
  d -= 0.0016 * gss(a - 0.078, 0.018) * gss(y - (C + 0.054), 0.011);
  // temples, under the hair edge
  d -= 0.0014 * gss(a - 0.090, 0.018) * gss(y - (E + 0.022), 0.012);
  // Mouth: upper lip, the seam, lower lip, the corners tucked in, the dip
  // under the lower lip, and a chin boss.
  d += 0.0030 * F.lips * gss(a, 0.017) * gss(y - (C + 0.052), 0.0045);
  d += 0.0036 * F.lips * gss(a, 0.0145) * gss(y - (C + 0.036), 0.0050);
  d -= 0.0010 * gss(a, 0.017) * gss(y - (C + 0.044), 0.0030);
  d -= 0.0012 * gss(a - 0.021, 0.0065) * gss(y - (C + 0.044), 0.0050);
  d -= 0.0026 * gss(a, 0.022) * gss(y - (C + 0.024), 0.0050);
  d += 0.0042 * F.chin * gss(a, 0.021) * gss(y - (C + 0.009), 0.0090);
  // philtrum: a groove between two ridges from the nose to the lip
  const ph = gss(y - (C + 0.058), 0.0040);
  d += ph * (0.0007 * gss(a - 0.0050, 0.0030) - 0.0009 * gss(a, 0.0030));
  // The angle of the jaw, under and in front of the ear. A chin ring that is
  // an ellipse all the way round has no jaw, only a jowl.
  d += 0.0048 * F.jaw * gss(Math.abs(th) - 1.22, 0.30) * gss(y - (C + 0.020), 0.012);
  // and the lower face narrower between chin and jaw angle than an egg is
  d -= 0.0016 * gss(Math.abs(th) - 0.80, 0.22) * gss(y - (C + 0.010), 0.012);
  // The muzzle: teeth and jaw carry the whole mouth forward of the cheeks.
  // Without it the lips sat in a dish between cheek and chin, which went
  // dark in any top light and read as a moustache on every face.
  d += 0.0042 * gss(a, 0.030) * gss(y - (C + 0.046), 0.018);
  return d;
}

/**
 * The head's rings (for loftY) and a lookup of its surface, so the hair can
 * grow from the head that is actually drawn rather than from the ellipse under
 * it. `at(j, y)` is the point on column j's vertical edge at height y -- the
 * edge the loft draws, straight between rows.
 */
function headGrid(F) {
  const rings = HEAD_ROWS.map((y) => ({
    y,
    pts: HEAD_COLS.map((th) => {
      const r = skullRay(th, y) + faceRelief(th, y, F);
      return [Math.sin(th) * r, HEAD_Z + Math.cos(th) * r];
    }),
  }));
  // Surface normals at the grid points, the way loftY computes them, so the
  // hair can stand off the head ALONG the normal: offset along the ray
  // instead, a shell a millimetre out came out a fraction of that where the
  // surface slopes, and sank through the head's triangulation in places.
  const R = rings.length, K = HEAD_COLS.length;
  const P3 = (i, j) => [rings[i].pts[j][0], rings[i].y, rings[i].pts[j][1]];
  const N = rings.map((r, i) => r.pts.map((p, j) => {
    const a = P3(i, (j + 1) % K), b = P3(i, (j - 1 + K) % K);
    const c = P3(Math.min(R - 1, i + 1), j), e = P3(Math.max(0, i - 1), j);
    const u = [a[0] - b[0], a[1] - b[1], a[2] - b[2]], v = [c[0] - e[0], c[1] - e[1], c[2] - e[2]];
    let n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
    if (n[0] * p[0] + n[2] * (p[1] - HEAD_Z) < 0) n = [-n[0], -n[1], -n[2]];
    const l = Math.hypot(n[0], n[1], n[2]) || 1;
    return [n[0] / l, n[1] / l, n[2] / l];
  }));
  /** [x, z, nx, ny, nz] on column j's edge at height y. */
  const at = (j, y) => {
    const n = HEAD_ROWS.length;
    let i = 1, t = 0;
    if (y <= HEAD_ROWS[0]) { i = 1; t = 0; }
    else if (y >= HEAD_ROWS[n - 1]) { i = n - 1; t = 1; }
    else {
      while (HEAD_ROWS[i] < y) i++;
      t = (y - HEAD_ROWS[i - 1]) / (HEAD_ROWS[i] - HEAD_ROWS[i - 1]);
    }
    const p = rings[i - 1].pts[j], q = rings[i].pts[j];
    const m = N[i - 1][j], o = N[i][j];
    const nx = lerp(m[0], o[0], t), ny = lerp(m[1], o[1], t), nz = lerp(m[2], o[2], t);
    const l = Math.hypot(nx, ny, nz) || 1;
    return [lerp(p[0], q[0], t), lerp(p[1], q[1], t), nx / l, ny / l, nz / l];
  };
  return { rings, at };
}

/**
 * SPLIT the normals where the nose meets the upper lip. loftY smooths every
 * ring from its neighbours above and below, and at the subnasale ring those are
 * the lip and the nose TIP two centimetres further forward: the ring's normal
 * came out pointing down at the pavement, and the upper lip below it shaded as
 * a dark band -- the "moustache", which a white, unshadowed, unpainted head
 * still showed. Builder quads own their four vertices, so the crease is local:
 * across the nose, each corner ON the subnasale ring takes the normal of the
 * corner in its own column across the band -- the lip band's from the lip row
 * below, the underside band's from the tip row above -- so the lip is lit as a
 * lip and the underside shades as an underside, with no smoothing between.
 * The weight is per VERTEX (from its own angle), fading out by ~16 deg; a
 * per-quad weight, or a per-quad face normal, broke the shading into blocks.
 */
function creaseNoseBase(b, rows, K) {
  const yC = HEAD_ROWS[8];                                  // J.eye - 0.052, under the nose
  const quads = (rows - 1) * K;
  const P = b.pos, N = b.nor;
  for (let q = 0; q < quads; q++) {
    const v0 = q * 4;
    const ys = [0, 1, 2, 3].map((k) => P[(v0 + k) * 3 + 1]);
    const at = [0, 1, 2, 3].filter((k) => Math.abs(ys[k] - yC) < 1e-6);
    if (at.length !== 2) continue;
    const other = [0, 1, 2, 3].filter((k) => !at.includes(k));
    for (const k of at) {
      const kx = P[(v0 + k) * 3], kz = P[(v0 + k) * 3 + 2];
      const w = 1 - smoothT(clamp((Math.abs(Math.atan2(kx, kz - HEAD_Z)) - 0.10) / 0.18, 0, 1));
      if (w <= 0) continue;
      // its own column's corner across the band
      let best = other[0], bd = 1e9;
      for (const o of other) {
        const d = Math.abs(Math.atan2(P[(v0 + o) * 3], P[(v0 + o) * 3 + 2] - HEAD_Z) - Math.atan2(kx, kz - HEAD_Z));
        if (d < bd) { bd = d; best = o; }
      }
      const m = [0, 1, 2].map((c) => lerp(N[(v0 + k) * 3 + c], N[(v0 + best) * 3 + c], w));
      const l = Math.hypot(m[0], m[1], m[2]) || 1;
      for (let c = 0; c < 3; c++) N[(v0 + k) * 3 + c] = m[c] / l;
    }
  }
}

/**
 * An ear: a rim (helix) standing off the head round a sunken bowl, flaring
 * backward the way ears do. Lofted outward along x from inside the head.
 * `side` is -1 / +1; `xs` is the head surface at the ear.
 */
function buildEar(b, side, xs, col) {
  const yc = J.eye - 0.017, zc = -0.013;
  // Outline in (dy, dz): 62 mm tall, 30 wide, a C open to the front -- round
  // the top and back, the lobe, the tragus, up the front.
  const O = [[0.031, -0.002], [0.027, -0.011], [0.017, -0.017], [0.002, -0.018], [-0.014, -0.013],
    [-0.029, -0.004], [-0.024, 0.004], [-0.008, 0.008], [0.010, 0.007], [0.024, 0.005]];
  // lateral stand-off per outline point: the back of the ear stands out more
  const out = O.map(([, dz]) => 0.0025 + 0.0060 * clamp((0.006 - dz) / 0.024, 0, 1));
  const ring = (k, dx, sc, dzs = 0) => O.map(([dy, dz], i) => [
    side * (xs + dx(i)), yc + dy * sc, zc + dzs + dz * sc]);
  const R = [
    ring(0, () => -0.005, 0.70, 0.004),             // root, inside the head
    ring(1, (i) => out[i] * 0.55, 0.96, 0.001),     // the rim's outer wall
    ring(2, (i) => out[i], 1.0),                    // helix crest
    ring(3, (i) => out[i] - 0.0035, 0.84),          // over the lip, into the bowl
  ];
  // Side walls: normals from the grid, pointing away from the ear's own axis.
  const n = O.length;
  for (let r = 0; r < R.length - 1; r++) {
    for (let i = 0; i < n; i++) {
      const i2 = (i + 1) % n;
      const nr = (p) => {
        const vy = p[1] - yc, vz = p[2] - zc, l = Math.hypot(vy, vz) || 1;
        // the lip's inner face looks out and in, toward the bowl
        const lat = r === 2 ? 0.8 : 0.35;
        const v = [side * lat, (vy / l) * (r === 2 ? -0.6 : 1), (vz / l) * (r === 2 ? -0.6 : 1)];
        const m = Math.hypot(v[0], v[1], v[2]);
        return [v[0] / m, v[1] / m, v[2] / m];
      };
      b.quad(R[r][i], R[r][i2], R[r + 1][i2], R[r + 1][i],
        [nr(R[r][i]), nr(R[r][i2]), nr(R[r + 1][i2]), nr(R[r + 1][i])], [0, 0, 1, 0, 1, 1, 0, 1], col);
    }
  }
  // the bowl (concha), sunk toward the ear canal
  const c = [side * (xs + 0.0035), yc - 0.004, zc + 0.002];
  const bowl = [col[0] * 0.78, col[1] * 0.78, col[2] * 0.78];
  for (let i = 0; i < n; i++) b.tri(c, R[3][i], R[3][(i + 1) % n], [side, 0, 0], bowl);
}

// Hair styles, drawn across the pool by weight.
const STYLES = ['crop', 'side', 'long', 'bun', 'curly', 'buzz'];
const STYLE_W = [0.22, 0.20, 0.18, 0.14, 0.14, 0.12];
function pickStyle(u) {
  let acc = 0;
  for (let i = 0; i < STYLES.length; i++) { acc += STYLE_W[i]; if (u < acc) return STYLES[i]; }
  return STYLES[0];
}

/**
 * The hair. A shell GROWN FROM THE SKULL SURFACE, not a cap placed over it.
 *
 * Round one lofted two shells with open bottom rings, and whatever was done to
 * those rings the result was a bowl: a straight rim above the ears, a gap
 * between rim and skull, and from the side and back a cap. Here every column
 * of the shell starts ON the skull at its own edge height -- a hairline with a
 * slight corner at the temples, sideburns down in front of the ear, over the
 * top of the ear, and down to a nape that follows the back of the head -- and
 * grows outward over its first 2 cm. There is no rim because there is nothing
 * standing off the head at the edge.
 */
function buildHair(style, seed, hair, grid, body) {
  const hb = new Builder(false);
  // Columns ARE the head's columns, so every column of the shell stands a
  // fixed distance off one vertical edge of the drawn head and the two
  // surfaces run parallel between them. Sampled from the ellipse instead, the
  // head's flat faces between sparse columns sat millimetres inside the shell
  // at one place and poked through it at another.
  const K = HEAD_COLS.length;
  // A buzz cut is a shell too, a couple of millimetres thick: painted on the
  // skull its edge was one straight line round the head at the ring height,
  // with a pale band under it.
  // Rows: two from the edge up to the hairline ring, then ON the head's own
  // top rows. Straight chords between rows placed anywhere else cut inside
  // the dome of the skull, and a thin shell (the buzz cut) vanished into it.
  const NR = 5;
  const vol = { crop: 0.006, side: 0.011, long: 0.010, bun: 0.005, curly: 0.024, buzz: 0.0035 }[style];
  const covers = style === 'long' || style === 'curly' || style === 'side';
  const napeY = style === 'crop' || style === 'bun' || style === 'buzz' ? J.chin + 0.050 : J.chin + 0.020;
  // Edge height against the angle round the head: phi = +pi/2 at the front,
  // 0 at the ear, -pi/2 at the back.
  const edgeTable = [
    // The front edge sits just below the painted hairline, so no band of skull
    // shows between the paint and the shell.
    [Math.PI / 2, HAIRLINE - 0.005],
    [0.95, HAIRLINE - 0.003],
    [0.62, HAIRLINE - 0.010],                        // temple corner
    [0.24, J.eye - 0.030],                           // sideburn, in front of the ear
    // Over the ear, and behind it: short hair clears the top of the ear
    // (which reaches brow height now it is modelled), long hair covers it.
    [0.07, covers ? J.eye - 0.030 : J.eye + 0.020],
    [-0.18, covers ? J.eye - 0.034 : J.eye + 0.014],
    [-0.60, J.eye - 0.052],
    [-Math.PI / 2, napeY],
  ];
  const edge = (phi) => {
    for (let i = 1; i < edgeTable.length; i++) {
      if (phi >= edgeTable[i][0]) {
        const [p0, y0] = edgeTable[i - 1], [p1, y1] = edgeTable[i];
        return lerp(y1, y0, smoothT((phi - p1) / (p0 - p1)));
      }
    }
    return napeY;
  };
  const top = J.crown + 0.001;
  const rows = [];
  for (let i = 0; i < NR; i++) {
    const row = [];
    for (let j = 0; j <= K; j++) {
      // start behind the head, so the patch's seam is under the hair
      const jj = (HEAD_BACK + j) % K;
      const th = HEAD_COLS[jj];
      const ca = Math.sin(th), sa = Math.cos(th);   // x and forward components
      const phi = Math.atan2(sa, Math.abs(ca));
      // Irregular at the sides and nape only: a jittered FRONT edge surfaced
      // through the forehead in square notches, a fringe cut with pinking shears.
      const yE = edge(phi) + (phi < 0.3 ? (hash2(jj * 17 + 3, seed) - 0.5) * 0.0024 : 0);
      const yH = Math.max(HEAD_ROWS[HEAD_HAIR_ROW], yE + 0.003);
      const y = [yE, lerp(yE, yH, 0.40), yH, HEAD_ROWS[HEAD_HAIR_ROW + 1], top][i];
      const v = (y - yE) / (top - yE);
      // The front keeps little volume (it is a hairline, not a brim); the back
      // and crown carry the most.
      const face = sa > 0 ? 1 - 0.65 * sa : 1 + 0.25 * (-sa);
      // Starts 1 mm OUTSIDE the drawn head, and grows over its first rows.
      // 1.6 mm, along the head's own normal: at 1 mm the shell's edge rows,
      // which cut diagonally across the head's quads, dipped under their
      // triangulation and the two fought (raycast: 0.2 mm apart, then -0.6).
      let th2 = lerp(0.0016, Math.max(0.0016, vol * face), smoothT(clamp(v / 0.24, 0, 1)));
      if (style === 'side') th2 += 0.006 * smoothT(clamp(v / 0.4, 0, 1)) * Math.max(0, ca) * (1 - Math.abs(sa) * 0.5);
      if (style === 'curly' && i >= 2) th2 *= 0.82 + 0.36 * hash2(jj * 31 + i * 7, seed + 11);
      // out along the head's normal
      const p = grid.at(jj, y);
      row.push([p[0] + p[2] * th2, y + p[3] * th2, p[1] + p[4] * th2]);
    }
    rows.push(row);
  }
  hb.patch(rows, hair, [0, 1, 0]);
  // Close the crown. The last row is a ring the width of the skull's top, and
  // left open it showed the skull's cap through the hole -- hair-coloured
  // skin paint, a pink smudge on top of every head.
  {
    const last = rows[rows.length - 1];
    let cx = 0, cy = 0, cz = 0;
    for (let j = 0; j < K; j++) { cx += last[j][0]; cy += last[j][1]; cz += last[j][2]; }
    const c = [cx / K, cy / K + vol * 0.4, cz / K];
    for (let j = 0; j < K; j++) hb.tri(c, last[j], last[j + 1], [0, 1, 0], hair);
  }

  if (style === 'long') {
    // Long hair continues the SHELL down the back of the head and past the
    // nape, following the skull and flaring as it falls, longest at the centre
    // with an uneven end. The first attempt was a separate half-tube with a
    // straight bottom: from the side a board stood off the back of the head,
    // from behind a plate with a ruler edge, and its two side edges showed
    // from the front as ribbons. It is TWO-SIDED, because from the front its
    // inside is what frames the neck and a single-sided sheet is culled there.
    //
    // ROUND THREE: it ends ON the shoulders, and its sides are a lock, not a
    // sheet. Hung to below the shoulder line it went in through the
    // trapezius and came out again as a separate patch on the upper back
    // (worse on a runner, whose chest pitches forward); every row now stays
    // 10 mm clear of the body under it (`body`). And the side edge -- a
    // two-sided sheet seen edge-on beside the jaw, a strip -- stops flaring at
    // the last columns, hugs the head, and is closed between its two faces.
    const CK = 14, CM = 5;
    const cr = [], inner = [];
    const cx = 0, cz = -0.010;
    for (let i = 0; i < CM; i++) {
      const t = i / (CM - 1);
      const row = [], irow = [];
      for (let j = 0; j <= CK; j++) {
        // From over the ears round the back. (Round two pulled it back to
        // 1.10-1.90 to hide the ribbon its open edge made beside the jaw;
        // with the edge closed and tucked it can come forward to frame the
        // face, which is where long hair actually hangs.)
        // The front edge slants back as it falls, behind the shoulder: a
        // straight vertical edge read as a board from the side.
        const aa = Math.PI * (1.04 + 0.08 * t + (0.92 - 0.16 * t) * (j / CK));
        const ca = Math.cos(aa), sa = Math.sin(aa);
        const back = -sa;                                   // 1 at the centre of the back
        const e = smoothT(clamp(Math.min(j, CK - j) / 3, 0, 1));   // 0 at the side edges
        // It starts UNDER the shell and comes out from beneath its edge: begun
        // on top of the shell, its top edge stood out as a shelf at the side.
        const yTop = J.eye + 0.015;
        // ends higher at the sides: out over the shoulder the deltoid swings
        // with the arm and came up through it on a runner
        const yBot = J.shoulder + 0.034 - 0.046 * back + 0.028 * (1 - back) + (hash2(j * 13 + 5, seed + 3) - 0.5) * 0.012;
        const y = lerp(yTop, yBot, smoothT(t) * 0.6 + t * 0.4);
        const k = skullAt(Math.max(y, SKULL[3].y));
        const flare = lerp(vol * 0.4, vol + 0.004, smoothT(clamp(t / 0.25, 0, 1))) + 0.028 * t * t * (0.15 + 0.85 * e);
        let p = [ca * (k.rx + flare), y, k.oz - 0.012 * t + sa * (k.rz + flare)];
        // clear of the neck and shoulders under it
        const bd2 = body(y);
        if (bd2) {
          const q = [ca * (bd2.rx + 0.010), y, bd2.oz + sa * (bd2.rz + 0.010)];
          if (Math.hypot(q[0] - cx, q[2] - cz) > Math.hypot(p[0] - cx, p[2] - cz)) p = q;
        }
        row.push(p);
        // the inner face: a few millimetres in, meeting the outer at the edges
        const th = 0.0012 + 0.0055 * e;
        const l = Math.hypot(p[0] - cx, p[2] - cz) || 1;
        irow.push([p[0] - ((p[0] - cx) / l) * th, y + 0.001, p[2] - ((p[2] - cz) / l) * th]);
      }
      cr.push(row); inner.push(irow);
    }
    hb.patch(cr, hair, [0, 0, -1]);
    hb.patch(inner, [hair[0] * 0.82, hair[1] * 0.82, hair[2] * 0.82], [0, 0, 1]);
    // close the two side edges between the faces
    for (const j of [0, CK]) {
      hb.patch(cr.map((r, i) => [r[j], inner[i][j]]), [hair[0] * 0.8, hair[1] * 0.8, hair[2] * 0.8], [j === 0 ? -1 : 1, 0, 0.6]);
    }
  }
  if (style === 'bun') {
    hb.spheroid(0, J.eye + 0.036, -0.108, 0.036, 12, 7, hair, 0.85);
    hb.loftY([
      { y: J.eye + 0.030, pts: oval(0.020, 0.010, 10, 0, -0.098) },
      { y: J.eye + 0.040, pts: oval(0.022, 0.012, 10, 0, -0.100) },
    ], [hair[0] * 0.5, hair[1] * 0.5, hair[2] * 0.5], {});   // the band
  }
  return hb;
}

/** Rounded-rectangle ring, 8 points, for a flat section (the palm). */
function rrect(rx, rz, ox, oz) {
  return [[rx, -0.45 * rz], [rx, 0.45 * rz], [0.55 * rx, rz], [-0.55 * rx, rz],
    [-rx, 0.45 * rz], [-rx, -0.45 * rz], [-0.55 * rx, -rz], [0.55 * rx, -rz]].map(([x, z]) => [ox + x, oz + z]);
}

/**
 * A finger or thumb: a four-cornered tube through a polyline, smooth-shaded
 * so four corners read as a rounded digit, with a blunt capped tip. `ws` is
 * the half-width across the hand (along z), `ts` the half-thickness. Each
 * ring's corner positions are recorded in `W` against that ring's skin weight.
 */
function digit(b, pts, ws, ts, wts, W, col) {
  const n = pts.length;
  const nrm = (v) => { const l = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / l, v[1] / l, v[2] / l]; };
  const rings = [], norms = [];
  let dLast = null;
  for (let i = 0; i < n; i++) {
    const a = pts[Math.max(0, i - 1)], c = pts[Math.min(n - 1, i + 1)];
    const d = nrm([c[0] - a[0], c[1] - a[1], c[2] - a[2]]);
    dLast = d;
    // across the hand: z made square to the digit
    const k = d[2];
    const sd = nrm([-k * d[0], -k * d[1], 1 - k * d[2]]);
    const th = nrm([d[1] * sd[2] - d[2] * sd[1], d[2] * sd[0] - d[0] * sd[2], d[0] * sd[1] - d[1] * sd[0]]);
    const ring = [], nr = [];
    for (const [cs, ct] of [[1, 1], [-1, 1], [-1, -1], [1, -1]]) {
      const q = [0, 1, 2].map((m) => pts[i][m] + sd[m] * cs * ws[i] + th[m] * ct * ts[i]);
      ring.push(q);
      nr.push(nrm([sd[0] * cs + th[0] * ct, sd[1] * cs + th[1] * ct, sd[2] * cs + th[2] * ct]));
      W.set(q.join(','), wts[i]);
    }
    rings.push(ring); norms.push(nr);
  }
  for (let i = 0; i < n - 1; i++) {
    for (let k = 0; k < 4; k++) {
      const k2 = (k + 1) % 4;
      b.quad(rings[i][k], rings[i][k2], rings[i + 1][k2], rings[i + 1][k],
        [norms[i][k], norms[i][k2], norms[i + 1][k2], norms[i + 1][k]], [0, 0, 1, 0, 1, 1, 0, 1], col);
    }
  }
  const e = pts[n - 1], r = Math.min(ws[n - 1], ts[n - 1]) * 0.5;
  const tip = [e[0] + dLast[0] * r, e[1] + dLast[1] * r, e[2] + dLast[2] * r];
  W.set(tip.join(','), wts[n - 1]);
  for (let k = 0; k < 4; k++) {
    const k2 = (k + 1) % 4;
    const a = rings[n - 1][k], c = rings[n - 1][k2];
    const nn = nrm([(norms[n - 1][k][0] + norms[n - 1][k2][0]) * 0.5 + dLast[0], (norms[n - 1][k][1] + norms[n - 1][k2][1]) * 0.5 + dLast[1],
      (norms[n - 1][k][2] + norms[n - 1][k2][2]) * 0.5 + dLast[2]]);
    b.tri(tip, a, c, nn, col);
  }
}

// The four fingers, index to little: z across the knuckles, half-width,
// segment lengths (proximal, middle, distal) and the RELAXED curl at each
// joint, in degrees. A resting hand is never flat: the curl cascades, each
// finger bent a little more than the one before it toward the little finger.
const FINGERS = [
  { z: 0.0268, w: 0.0092, L: [0.040, 0.024, 0.020], curl: [8, 24, 12] },
  { z: 0.0090, w: 0.0094, L: [0.044, 0.027, 0.021], curl: [12, 30, 14] },
  { z: -0.0088, w: 0.0090, L: [0.041, 0.026, 0.020], curl: [16, 34, 16] },
  { z: -0.0248, w: 0.0078, L: [0.032, 0.020, 0.017], curl: [21, 38, 18] },
];

/**
 * A hand: a flat palm, four fingers and a thumb, not a mitten. The palm faces
 * the thigh; fingers hang in a relaxed cascade from the knuckle line and are
 * skinned to two bones, fing (MCP) and tip (PIP), which add curl to that rest
 * shape -- a loose fist at a run, a grip on a motorbike's bars (gripHands).
 * Low segment counts throughout: at the closest the camera gets a hand is
 * ~60 px, and four-cornered smooth-shaded digits read as fingers there.
 */
function buildHand(acc, side, X, skin) {
  const hB = side < 0 ? B.handL : B.handR, fB = side < 0 ? B.fingL : B.fingR, tB = side < 0 ? B.tipL : B.tipR;
  const palm = new Builder(false);
  const cx = X + side * 0.001;
  palm.loftY([
    { y: J.wrist + 0.014, pts: rrect(0.018, 0.026, cx, 0) },
    { y: J.wrist - 0.014, pts: rrect(0.0165, 0.032, cx, 0.001) },    // heel of the hand
    { y: J.wrist - 0.050, pts: rrect(0.0160, 0.039, cx, 0.002) },    // mid palm
    { y: KNUCKLE - 0.002, pts: rrect(0.0135, 0.036, cx, 0.001) },    // knuckles
  ], skin, { capEnd: true });
  // The thumb: a fleshy base at the front of the palm, pointing down and
  // forward, lying along the index finger on the palm side.
  const tin = -side;   // toward the palm
  const T = [
    [cx + tin * 0.009, J.wrist - 0.012, 0.012],
    [cx + tin * 0.014, J.wrist - 0.042, 0.030],    // MCP, the ball of the thumb
    [cx + tin * 0.013, J.wrist - 0.064, 0.042],    // IP
    [cx + tin * 0.010, J.wrist - 0.080, 0.046],    // tip
  ];
  const Wp = new Map();
  digit(palm, T, [0.0115, 0.0098, 0.0088, 0.0074], [0.0115, 0.0095, 0.0084, 0.0068], T.map(() => null), Wp, skin);
  acc.add(palm, solid(hB), cylUV(CELLS.hand, X, 0.0, J.wrist - 0.10, J.wrist + 0.015), 'hand');

  const fing = new Builder(false);
  const W = new Map();
  const toR = Math.PI / 180;
  for (const f of FINGERS) {
    // base ring 6 mm up inside the palm, then PIP, DIP and the tip
    let x = cx, y = KNUCKLE, ang = f.curl[0] * toR;
    const pts = [[cx, KNUCKLE + 0.006, f.z]];
    const w = f.w, t = 0.0084 * (f.w / 0.009);
    for (let s = 0; s < 3; s++) {
      x += tin * Math.sin(ang) * f.L[s];
      y -= Math.cos(ang) * f.L[s];
      pts.push([x, y, f.z]);
      if (s < 2) ang += f.curl[s + 1] * toR;
    }
    // weights: the base half on the hand, the PIP ring shared, the rest on tip
    const wts = [[fB, 0.55, hB, 0.45], [tB, 0.5, fB, 0.5], [tB, 1, 0, 0], [tB, 1, 0, 0]];
    digit(fing, pts, [w, w * 0.96, w * 0.88, w * 0.80], [t, t * 0.95, t * 0.84, t * 0.72], wts, W, skin);
  }
  acc.add(fing, (x, y, z) => W.get([x, y, z].join(',')) || [fB, 1, 0, 0],
    cylUV(CELLS.skin, X, 0.0, J.wrist - 0.19, KNUCKLE + 0.01), 'fingers');
}

/**
 * Close a humanoid's hands round a grip -- a motorbike's bars. Palms turn
 * down (pronation about the forearm) and the fingers curl round.
 */
export function gripHands(h, k = 1) {
  const b = h.bones;
  b[B.handL].rotation.y = 1.35 * k; b[B.handR].rotation.y = -1.35 * k;
  b[B.fingL].rotation.z = 1.05 * k; b[B.fingR].rotation.z = -1.05 * k;
  b[B.tipL].rotation.z = 1.00 * k; b[B.tipR].rotation.z = -1.00 * k;
}

/**
 * Builds one character variant: a skinned geometry in the rest pose. Callers
 * pair it with a fresh skeleton per instance.
 */
// The pedestrian POOL is designed, not rolled. With only twelve looks, hashing
// garments and hair left whole categories out -- measured on the first pass,
// no buzz cut and no dress anywhere in the crowd, but five skirts and four
// side-parts. So pooled look i takes its outfit and style from this table
// (every style twice; two dresses, two skirts, two shorts), and colours, skin,
// build and shoes still come from the seed. Unique builds keep the hash path.
const LOOKS = [
  ['hoodie', 'jeans', 'crop'], ['tee', 'skirt', 'long'], ['jacket', 'trousers', 'buzz'],
  ['tee', 'dress', 'bun'], ['tee', 'shorts', 'curly'], ['jacket', 'jeans', 'side'],
  ['hoodie', 'skirt', 'long'], ['longsleeve', 'trousers', 'crop'], ['tee', 'dress', 'curly'],
  ['jacket', 'jeans', 'bun'], ['longsleeve', 'jeans', 'side'], ['longsleeve', 'shorts', 'buzz'],
];

export function buildCharacter(opts = {}) {
  const seed = opts.seed != null ? opts.seed : 0;
  const skin = opts.skin || SKINS[Math.floor(hash2(seed, 1) * SKINS.length)];
  const hair = opts.hair || HAIR[Math.floor(hash2(seed, 4) * HAIR.length)];
  const build = 0.92 + hash2(seed, 6) * 0.16;
  const WHITE = [1, 1, 1];
  const face = faceCell(skin);
  const dk = (c, k) => [c[0] * k, c[1] * k, c[2] * k];

  // --- what they are wearing ----------------------------------------------
  // A pool of twelve identical outfits in twelve colours reads as a uniform
  // at any distance. Tops: t-shirt, long sleeve, jacket, hoodie; bottoms:
  // jeans, trousers, shorts, skirt, or a dress. Uniformed characters (opts.vest:
  // cops, riders) and anyone with explicit trousers (the player) keep trousers.
  const uniformed = !!opts.vest;
  let bottom;
  {
    const u = hash2(seed, 8);
    bottom = u < 0.42 ? 'jeans' : u < 0.62 ? 'trousers' : u < 0.76 ? 'shorts' : u < 0.89 ? 'skirt' : 'dress';
    if (uniformed || opts.pants) bottom = uniformed ? 'trousers' : 'jeans';
  }
  let top;
  {
    const u = hash2(seed, 7);
    top = u < 0.30 ? 'tee' : u < 0.50 ? 'longsleeve' : u < 0.72 ? 'jacket' : 'hoodie';
    if (uniformed) top = 'uniform';
    if (bottom === 'dress') top = 'tee';
  }
  const look = opts.variant != null && !uniformed ? LOOKS[opts.variant % LOOKS.length] : null;
  if (look) { top = look[0]; bottom = look[1]; }
  const shirt = opts.shirt || SHIRTS[Math.floor(hash2(seed, 2) * SHIRTS.length)];
  const pantsBase = opts.pants || PANTS[Math.floor(hash2(seed, 3) * PANTS.length)];
  // trousers are chinos and slacks, not a second pair of jeans
  const pants = bottom === 'trousers' && !opts.pants && !uniformed
    ? [[0.36, 0.31, 0.24], [0.16, 0.16, 0.17], [0.28, 0.30, 0.26], [0.30, 0.24, 0.20]][Math.floor(hash2(seed, 13) * 4)]
    : pantsBase;
  const skirtCol = bottom === 'dress' ? shirt : bottom === 'skirt' ? SHIRTS[Math.floor(hash2(seed, 14) * SHIRTS.length)] : null;
  const coat = top === 'jacket' ? dk(shirt, 0.62) : shirt;
  const topCell = top === 'jacket' ? CELLS.jacket : top === 'hoodie' ? CELLS.hoodie : top === 'uniform' ? CELLS.uniform : CELLS.shirt;
  const legsBare = bottom === 'skirt' || bottom === 'dress';
  const tucked = (top === 'tee' || top === 'longsleeve') && !legsBare && hash2(seed, 18) > 0.45;
  const shortSleeve = top === 'tee' || bottom === 'dress';
  const shoeI = uniformed ? 0 : Math.floor(hash2(seed, 17) * SHOES.length);
  const shoeCol = SHOES[shoeI], soleCol = SOLES[shoeI];
  const style = opts.hat ? 'crop' : look ? look[2] : pickStyle(hash2(seed, 16));

  const acc = new SkinAcc();
  // half-breadths. Shoulders 0.152 (was 0.140) and a narrower waist: at the
  // old values the torso was one straight tube from hem to armpit and the
  // shoulders sloped off it, which is most of what read as a toy.
  const bw = 0.160 * build, bd = 0.112 * build;
  const ww = 0.124 * build, wd = 0.098 * build;
  const cw = 0.156 * build, cd = 0.120 * build;
  const sw = 0.152 * build, sd = 0.104 * build;
  const outer = top === 'jacket' || top === 'hoodie' ? 1.05 : 1.0;
  const legUV = (X) => cylUV(CELLS.pants, X, 0, J.ankle + 0.08, J.hip + 0.04);
  const torsoW = (x, y) => {
    if (y < J.spine) return across(J.spine - 0.05, 0.1, B.spine, B.hips)(x, y);
    return across(J.chest - 0.06, 0.12, B.chest, B.spine)(x, y);
  };

  // --- pelvis seat ---------------------------------------------------------
  if (!legsBare) {
    const pelvis = new Builder(false);
    // Seat ONLY: every attempt to draw the front of the pelvis read as a pale
    // panel or an apron. The thighs meet at the midline and the shirt hem
    // covers the join; this is the SEAT, narrower than the shirt everywhere
    // so it cannot ride up beside the hem as two horns.
    const seat = dk(pants, 0.94);
    pelvis.loftY([
      { y: J.hip - 0.115, pts: oval(bw * 0.80, bd * 0.50, ST, 0, -0.042) },
      { y: J.hip - 0.06, pts: oval(bw * 0.87, bd * 0.56, ST, 0, -0.040) },
      { y: J.hip + 0.02, pts: oval(bw * 0.84, bd * 0.58, ST, 0, -0.036) },
    ], seat, { capStart: true });
    for (const px of [-0.052, 0.052]) {
      pelvis.box(px, J.hip - 0.062, -(0.036 + bd * 0.58 - 0.010), 0.056, 0.060, 0.004, 0, dk(pants, 0.62));
    }
    acc.add(pelvis, across(J.spine - 0.06, 0.09, B.spine, B.hips), legUV(0), 'pelvis');
  }

  // --- torso ---------------------------------------------------------------
  const torso = new Builder(false);
  // Chest mass forward of the spine, a waist, and shoulders that are a mass
  // rather than a slope; the trapezius ring sits higher and steeper so less
  // neck shows above the collar.
  const tRings = [
    { y: J.hip - 0.035, pts: oval(bw * 1.04 * outer, bd * 1.02 * outer, ST) },       // hem
    { y: J.hip + 0.06, pts: oval(bw * 0.95 * outer, bd * 0.98 * outer, ST) },
    { y: 1.075, pts: oval(ww * 1.0 * outer, wd * 1.02 * outer, ST, 0, 0.002) },        // waist
    { y: J.chest - 0.06, pts: oval((ww + cw) * 0.52 * outer, (wd + cd) * 0.52 * outer, ST, 0, 0.006) },
    { y: J.chest, pts: oval(cw * 1.02 * outer, cd * 1.04 * outer, ST, 0, 0.012) },     // chest
    { y: 1.34, pts: oval(cw * 1.05 * outer, cd * 1.00 * outer, ST, 0, 0.006) },
    { y: J.shoulder - 0.03, pts: oval(sw * 1.18 * outer, sd * 1.02 * outer, ST) },
    { y: J.shoulder + 0.012, pts: oval(sw * 1.06 * outer, sd * 0.96 * outer, ST, 0, -0.004) },
    { y: J.shoulder + 0.038, pts: oval(sw * 0.62 * outer, sd * 0.70 * outer, ST, 0, -0.012) },  // trapezius
    { y: J.shoulder + 0.054, pts: oval(sw * 0.43 * outer, sd * 0.54 * outer, ST, 0, -0.012) },  // neck base
  ];
  // Tucked in: below the belt the "torso" is the trousers' waistband.
  const tCols = tRings.map((r, i) => (tucked && i < 2 ? pants : coat));
  torso.loftY(tRings, tCols, {});
  // hem lip: an inward slope, darker, which blocks the see-through rim
  torso.loftY([
    { y: J.hip - 0.035, pts: oval(bw * 1.04 * outer, bd * 1.02 * outer, ST) },
    { y: J.hip - 0.054, pts: oval(bw * 1.0 * outer, bd * 0.99 * outer, ST) },
  ], dk(tucked ? pants : coat, 0.55), {});
  if (tucked || top === 'uniform') {
    // A belt: the one horizontal accent that splits a figure into top and
    // bottom from across the street.
    const beltCol = [0.07, 0.055, 0.045];
    // Over the join, not below it: the torso shades from trousers to top
    // between J.hip + 0.06 and the waist ring, and a belt at +0.04 left a band
    // of trouser colour above it -- high waistband, belt round the hips.
    torso.loftY([
      { y: J.hip + 0.072, pts: oval(bw * 0.935 * outer, bd * 0.975 * outer, ST) },
      { y: J.hip + 0.104, pts: oval(bw * 0.900 * outer, bd * 0.955 * outer, ST, 0, 0.001) },
    ], beltCol, {});
    torso.box(0, J.hip + 0.074, bd * 0.975 + 0.002, 0.034, 0.028, 0.006, 0, [0.55, 0.52, 0.45]);   // buckle
  }
  // Neckline, per garment: a crew rib on shirts, a standing collar on jackets
  // and uniforms, the hood bunched behind the neck on a hoodie.
  if (top === 'jacket' || top === 'uniform') {
    torso.loftY([
      { y: J.shoulder + 0.040, pts: oval(sw * 0.60 * outer, sd * 0.70 * outer, ST, 0, -0.010) },
      { y: J.shoulder + 0.085, pts: oval(0.074, 0.074, ST, 0, -0.012) },
    ], dk(coat, 0.72), {});
  } else {
    torso.loftY([
      { y: J.shoulder + 0.046, pts: oval(sw * 0.52 * outer, sd * 0.63 * outer, ST, 0, -0.012) },
      { y: J.shoulder + 0.064, pts: oval(sw * 0.45 * outer, sd * 0.56 * outer, ST, 0, -0.011) },
    ], dk(coat, 0.60), { capEnd: true });
  }
  // No hood under long hair: the two fought for the same space behind the
  // neck and the hood poked out through the curtain from the side.
  // (the hood is built after the torso: see "hood" below)
  if (opts.hivis) {
    // Hi-vis over the uniform: fluorescent body with two reflective bands --
    // geometry, because multiplied paint can only darken and a reflective band
    // is the brightest thing on the vest.
    const vest = [0.78, 0.88, 0.10];
    const band = [0.66, 0.66, 0.64];
    torso.loftY([
      { y: J.hip + 0.10, pts: oval(bw * 1.00 * outer * 1.04, bd * 1.03 * outer * 1.05, ST) },
      { y: 1.075, pts: oval(ww * 1.06 * outer, wd * 1.10 * outer, ST, 0, 0.002) },
      { y: J.chest, pts: oval(cw * 1.07 * outer, cd * 1.10 * outer, ST, 0, 0.012) },
      { y: J.shoulder - 0.03, pts: oval(sw * 1.20 * outer, sd * 1.08 * outer, ST) },
      { y: J.shoulder + 0.02, pts: oval(sw * 0.90 * outer, sd * 0.95 * outer, ST, 0, -0.006) },
    ], vest, {});
    for (const by of [1.13, 1.23]) {
      const k = (by - 1.075) / (J.chest - 1.075);
      const rx = lerp(ww * 1.06, cw * 1.07, k) * outer * 1.012, rz = lerp(wd * 1.10, cd * 1.10, k) * outer * 1.012;
      torso.loftY([
        { y: by, pts: oval(rx, rz, ST, 0, 0.002 + 0.010 * k) },
        { y: by + 0.035, pts: oval(rx, rz, ST, 0, 0.002 + 0.010 * k) },
      ], band, {});
    }
  } else if (opts.vest && top !== 'uniform') {
    torso.loftY([
      { y: J.hip + 0.12, pts: oval(bw * 1.03 * outer, bd * 1.05 * outer, ST) },
      { y: J.chest + 0.06, pts: oval(cw * 1.03 * outer, cd * 1.05 * outer, ST) },
      { y: J.shoulder - 0.04, pts: oval(sw * 0.98 * outer, sd * 1.02 * outer, ST) },
    ], opts.vest, {});
  }
  acc.add(torso, torsoW, cylUV(topCell, 0, 0, J.hip - 0.06, J.shoulder + 0.07), 'torso');

  // --- hood ----------------------------------------------------------------
  // A hood that is down LIES ON THE BACK: a soft fold round the back of the
  // neck, and a flattened tongue of cloth hanging between the shoulder
  // blades. Round two's was three ovals stacked behind the neck -- a neck
  // pillow, and on a runner, whose chest pitches forward under a level head,
  // a lump standing off the nape. This one is grown from the torso's own
  // rings: each column stands off the torso along its normal, full thickness
  // down the middle, and dives INTO the torso at its edges and bottom, so
  // there is no ledge and nothing to see past.
  // Torso ring parameters, read back off the rings themselves, and the neck
  // above them: what the hood and long hair lie on.
  const par = (r) => {
    const oz = r.pts[0][1], rx = r.pts[0][0];
    const rz = (r.pts[4][1] - oz) / Math.sin((4 / ST) * Math.PI * 2);
    return { y: r.y, rx, rz, oz };
  };
  const TP = tRings.map(par);
  // the neckline rib's top, above the torso's last ring
  TP.push({ y: J.shoulder + 0.064, rx: sw * 0.45 * outer, rz: sd * 0.56 * outer, oz: -0.011 });
  const NP = [{ y: J.shoulder + 0.01, rx: 0.059, rz: 0.057, oz: -0.004 }, { y: J.chin + 0.012, rx: 0.044, rz: 0.046, oz: -0.006 }];
  const lerpPar = (T, y) => {
    if (y <= T[0].y) return T[0];
    for (let i = 1; i < T.length; i++) {
      if (y <= T[i].y) {
        const a = T[i - 1], b2 = T[i], t = (y - a.y) / (b2.y - a.y);
        return { rx: lerp(a.rx, b2.rx, t), rz: lerp(a.rz, b2.rz, t), oz: lerp(a.oz, b2.oz, t) };
      }
    }
    return T[T.length - 1];
  };
  // the body under a point at height y: the torso up to its neckline, else the neck
  const bodyAt = (y) => (y <= TP[TP.length - 1].y ? lerpPar(TP, y) : y < NP[1].y ? lerpPar(NP, y) : null);
  if (top === 'hoodie' && style !== 'long') {
    // rows: y, the surface under it, thickness down the middle, half-width
    // (radians either side of the spine) at which it has dived back in
    const S = J.shoulder;
    const HR = [
      [S - 0.170, TP, -0.004, 1.0],
      [S - 0.135, TP, 0.016, 0.34],    // the rounded point of the tongue
      [S - 0.090, TP, 0.028, 0.56],
      [S - 0.045, TP, 0.034, 0.70],
      [S, TP, 0.036, 0.84],
      [S + 0.032, TP, 0.034, 1.05],
      [S + 0.058, TP, 0.032, 1.40],
      [S + 0.084, NP, 0.028, 1.75],    // the rim of the opening, round the neck
    ];
    // Denser down the spine, where the tongue is; the sides only carry the
    // rim round the neck.
    const cols = [-90, -62, -44, -29, -14, 0, 14, 29, 44, 62, 90].map((d) => 1.5 * Math.PI + (d * Math.PI) / 180);
    const pt = (row, a, extra = 0) => {
      const [y, T, th, W] = row;
      const q = lerpPar(T, y);
      const ph = Math.abs(a - 1.5 * Math.PI);          // from the spine
      const env = 1 - smoothT(clamp((ph - 0.55 * W) / (0.45 * W), 0, 1));
      const t = (th > 0 ? th * env - 0.004 * (1 - env) : th) + extra;
      let nx = Math.cos(a) / q.rx, nz = Math.sin(a) / q.rz;
      const l = Math.hypot(nx, nz) || 1; nx /= l; nz /= l;
      return [Math.cos(a) * q.rx + nx * t, y, q.oz + Math.sin(a) * q.rz + nz * t];
    };
    const hood = new Builder(false);
    const hoodCol = dk(coat, 0.88);   // the same cloth, a shade down: darker still, the ragged line where it dives in showed
    hood.patch(HR.map((row) => cols.map((a) => pt(row, a))), hoodCol, [0, 0, -1]);
    // the opening's lining, turning in and down from the rim toward the neck
    const lining = [HR[HR.length - 1], [S + 0.074, NP, 0.006, 1.75]];
    hood.patch(lining.map((row) => cols.map((a) => pt(row, a))), dk(coat, 0.42), [0, 1, 0]);
    // The rim and lining follow the NECK: on the chest they stood still while
    // the neck bent back through them.
    const neckW = across(J.neck - 0.06, 0.09, B.neck, B.chest);
    acc.add(hood, (x, y) => (y > S + 0.066 ? neckW(x, y) : torsoW(x, y)),
      cylUV(CELLS.skin, 0, 0, S - 0.17, S + 0.09), 'hood');
  }

  // --- skirt / dress -------------------------------------------------------
  if (legsBare) {
    const sk = new Builder(false);
    // The waistband is under the top, not level with it: at J.hip + 0.07 and
    // full width it pushed through a hoodie's front beside the pocket.
    sk.loftY([
      { y: J.hip + 0.020, pts: oval(bw * 0.92, bd * 0.94, ST) },
      { y: J.hip - 0.050, pts: oval(bw * 1.06, bd * 1.10, ST, 0, 0.002) },
      { y: J.knee + 0.10, pts: oval(bw * 1.26, bd * 1.34, ST, 0, 0.006) },
      { y: J.knee + 0.07, pts: oval(bw * 1.30, bd * 1.38, ST, 0, 0.006) },
    ], skirtCol, {});
    sk.loftY([
      { y: J.knee + 0.07, pts: oval(bw * 1.30, bd * 1.38, ST, 0, 0.006) },
      { y: J.knee + 0.085, pts: oval(bw * 1.22, bd * 1.30, ST, 0, 0.006) },
    ], dk(skirtCol, 0.55), {});
    // A skirt follows the thigh on its own side and the hips in the middle,
    // more so toward the hem -- enough to swing with a step without tearing.
    acc.add(sk, (x, y) => {
      const w = smoothT(clamp((J.hip - y) / 0.36, 0, 1)) * smoothT(clamp(Math.abs(x) / 0.12, 0, 1)) * 0.85;
      return [x < 0 ? B.thighL : B.thighR, w, B.hips, 1 - w];
    }, cylUV(CELLS.skirt, 0, 0, J.knee + 0.07, J.hip + 0.07), 'skirt');
  }

  // --- neck + head ---------------------------------------------------------
  // Head width is 0.086H (half 0.075) and depth 0.115H (half 0.101), eyes on
  // the half-height line; 0.228 m chin to crown against a 1.75 m stature is
  // 1:7.7, inside the 1:7.5-8 adult band. The features are PAINTED (see the
  // atlas): skull, nose and ears are white vertex colour.
  const neck = new Builder(false);
  neck.loftY([
    { y: J.chest + 0.09, pts: oval(0.066, 0.064, SL) },
    { y: J.shoulder + 0.01, pts: oval(0.059, 0.057, SL, 0, -0.004) },
    // Tucked UP INSIDE the jaw, or the neck's top rim shows under the chin.
    { y: J.chin + 0.012, pts: oval(0.044, 0.046, SL, 0, -0.006) },
  ], skin, {});
  acc.add(neck, (x, y) => across(J.neck - 0.06, 0.09, B.neck, B.chest)(x, y),
    cylUV(CELLS.skin, 0, 0, J.chest + 0.09, J.chin), 'neck');

  const head = new Builder(false);
  // The sculpted head (see faceRelief): nose, lips, brow, jaw and all are the
  // one loft now, so there is no seam where a peg nose met a smooth face.
  // Rows from HEAD_HAIR_ROW up are hair-coloured under the painted skin.
  const soft = bottom === 'skirt' || bottom === 'dress' || style === 'long' || style === 'bun';
  const grid = headGrid(faceParams(seed, soft));
  // Drawn only up to the hairline ring: above it every style's shell (the
  // buzz cut's too) and every hat covers the skull, so its two top bands were
  // ~100 triangles nobody could see. The grid still carries them, for the
  // hair to grow over.
  const shown = grid.rings.slice(0, HEAD_HAIR_ROW + 1);
  head.loftY(shown, shown.map((r, i) => (i < HEAD_HAIR_ROW ? WHITE : hair)),
    { capStart: true, capEnd: true });
  creaseNoseBase(head, shown.length, HEAD_COLS.length);
  // Ears, unless the hair falls over them: a long or curly shell over the
  // side of the head would have them standing out through it.
  const covers = style === 'long' || style === 'curly' || style === 'side';
  if (!covers) {
    const xs = skullRay(Math.PI / 2 + 0.12, J.eye - 0.017) * Math.sin(Math.PI / 2 + 0.12);
    for (const sx of [-1, 1]) buildEar(head, sx, xs, WHITE);
  }
  const headW = (x, y) => {
    if (y < J.neck) return across(J.neck - 0.06, 0.09, B.neck, B.chest)(x, y);
    return across(J.head - 0.03, 0.04, B.head, B.neck)(x, y);
  };
  acc.add(head, headW, cylUV(face, 0, HEAD_Z, HY0, HY1, HEAD_SPAN), 'head');

  const hairB = buildHair(style, seed, hair, grid, bodyAt);
  if (hairB) {
    // Long hair below the jaw rides the chest, not the head, or it swings
    // through the back when the head turns.
    const hw = style === 'long'
      // Below the jaw long hair lies on the shoulders, so it rides the CHEST
      // there: 40% on the head at shoulder height, it swung back into the
      // upper back whenever a runner's chest pitched forward under a level head.
      ? (x, y) => (y < J.chin ? across(J.chin - 0.035, 0.035, B.head, B.chest)(x, y) : headW(x, y))
      : headW;
    acc.add(hairB, hw, cylUV(style === 'curly' ? CELLS.curly : CELLS.hair, 0, -0.01, J.eye - 0.08, J.crown + 0.03), 'hair');
  }

  if (opts.hat) {
    const hat = new Builder(false);
    hat.loftY([
      { y: J.eye + 0.016, pts: oval(0.086, 0.111, ST, 0, -0.006) },
      { y: J.eye + 0.070, pts: oval(0.082, 0.105, ST, 0, -0.008) },
      { y: J.crown - 0.004, pts: oval(0.057, 0.073, ST, 0, -0.010) },
    ], opts.hat, { capEnd: true });
    hat.box(0, J.eye + 0.014, 0.086, 0.166, 0.018, 0.11, 0, opts.hat);
    acc.add(hat, headW, cylUV(CELLS.jacket, 0, 0, J.eye, J.crown), 'hat');
  }

  // --- arms ----------------------------------------------------------------
  for (const side of [-1, 1]) {
    const X = side * SHOULDER_X;
    const arm = new Builder(false);
    // Deltoid, biceps and a forearm that is thicker below the elbow than at
    // the wrist: round one's arm was one taper, a stick.
    const aRings = [
      { y: J.shoulder + 0.006, pts: oval(0.038, 0.036, SL, X * 0.80, 0) },
      { y: J.shoulder - 0.040, pts: oval(0.064, 0.058, SL, X * 1.03, 0) },     // deltoid
      { y: J.shoulder - 0.090, pts: oval(0.061, 0.058, SL, X * 1.02, 0) },
      { y: J.shoulder - 0.150, pts: oval(0.053, 0.056, SL, X, 0.004) },        // biceps
      { y: J.elbow + 0.030, pts: oval(0.046, 0.045, SL, X, 0) },
      { y: J.elbow - 0.020, pts: oval(0.045, 0.044, SL, X, 0) },
      { y: J.elbow - 0.070, pts: oval(0.047, 0.043, SL, X, 0.002) },           // forearm
      // The wrist is wider front to back than across: the palm faces the
      // thigh, so its width runs along z.
      { y: J.wrist + 0.050, pts: oval(0.031, 0.034, SL, X, 0) },
      { y: J.wrist + 0.012, pts: oval(0.021, 0.028, SL, X, 0) },
    ];
    arm.loftY(aRings, shortSleeve
      ? aRings.map((r, i) => (i < 3 ? coat : skin))
      : coat, { capEnd: true });   // no cap at the shoulder: it is inside the torso
    // cuff: a proud, contrasting band where the fabric ends
    if (shortSleeve) {
      arm.loftY([
        { y: J.shoulder - 0.122, pts: oval(0.060, 0.059, SL, X * 1.01, 0.002) },
        { y: J.shoulder - 0.150, pts: oval(0.058, 0.060, SL, X, 0.004) },
      ], dk(coat, 0.62), {});
      arm.loftY([
        { y: J.shoulder - 0.090, pts: oval(0.062, 0.059, SL, X * 1.02, 0) },
        { y: J.shoulder - 0.122, pts: oval(0.060, 0.059, SL, X * 1.01, 0.002) },
      ], coat, {});
    } else {
      arm.loftY([
        { y: J.wrist + 0.058, pts: oval(0.037, 0.034, SL, X, 0) },
        { y: J.wrist + 0.026, pts: oval(0.034, 0.031, SL, X, 0) },
      ], dk(coat, top === 'hoodie' ? 0.62 : 0.72), {});
    }
    acc.add(arm, (x, y) => {
      if (y > J.elbow) return across(J.elbow + 0.05, 0.09, side < 0 ? B.shoulderL : B.shoulderR, side < 0 ? B.elbowL : B.elbowR)(x, y);
      return [side < 0 ? B.elbowL : B.elbowR, 1, 0, 0];
    // Sleeves take the plain cell, not the garment's: a torso cell carries
    // pockets, zips and a kangaroo pocket, and mapped round an arm they landed
    // on the sleeves as stray rectangles.
    }, cylUV(CELLS.skin, X, 0, J.wrist, J.shoulder + 0.01), 'arm');
    buildHand(acc, side, X, skin);
  }

  // --- legs ----------------------------------------------------------------
  for (const side of [-1, 1]) {
    const X = side * HIP_X;
    const leg = new Builder(false);
    // Thigh taper, a knee, a calf that sits BEHIND the shin and swells below
    // the knee, and a slim ankle. Trousers keep a straighter fall over the
    // calf; bare legs get the whole shape.
    const bare = legsBare;
    const loose = bottom === 'trousers' || bottom === 'jeans';
    const lRings = [
      { y: J.hip + 0.035, pts: oval(0.084, 0.088, SL, X * 0.88, 0) },
      { y: J.hip - 0.090, pts: oval(0.090, 0.088, SL, X * 0.97, 0) },
      { y: J.hip - 0.200, pts: oval(0.078, 0.080, SL, X, 0) },
      { y: J.knee + 0.120, pts: oval(0.064, 0.066, SL, X, 0) },
      { y: J.knee + 0.080, pts: oval(0.060, 0.063, SL, X, 0) },
      { y: J.knee + 0.010, pts: oval(0.055, 0.056, SL, X, 0.006) },                 // knee
      { y: J.knee - 0.050, pts: oval(0.054, loose ? 0.060 : 0.058, SL, X, loose ? -0.002 : -0.004) },
      { y: J.knee - 0.120, pts: oval(loose ? 0.056 : 0.055, loose ? 0.062 : 0.066, SL, X, loose ? -0.004 : -0.012) },  // calf
      { y: J.knee - 0.250, pts: oval(loose ? 0.048 : 0.042, loose ? 0.052 : 0.048, SL, X, -0.004) },
      { y: J.ankle + 0.100, pts: oval(loose ? 0.042 : 0.036, loose ? 0.045 : 0.039, SL, X, 0) },
    ];
    const lCols = lRings.map((r, i) => {
      if (bare) return skin;
      if (bottom === 'shorts') return i <= 3 ? pants : skin;
      return pants;
    });
    leg.loftY(lRings, lCols, { capStart: true, capEnd: true });
    if (bottom === 'shorts') {
      leg.loftY([
        { y: J.knee + 0.140, pts: oval(0.068, 0.070, SL, X, 0) },
        { y: J.knee + 0.105, pts: oval(0.066, 0.068, SL, X, 0) },
      ], dk(pants, 0.60), {});
    }
    if (loose) {
      // turn-up at the hem
      leg.loftY([
        { y: J.ankle + 0.100, pts: oval(0.044, 0.047, SL, X, 0) },
        { y: J.ankle + 0.075, pts: oval(0.044, 0.047, SL, X, 0) },
      ], dk(pants, 0.62), {});
    }
    acc.add(leg, (x, y) => across(J.knee + 0.04, 0.1,
      side < 0 ? B.thighL : B.thighR, side < 0 ? B.kneeL : B.kneeR)(x, y),
    bare ? cylUV(CELLS.skin, X, 0, J.ankle + 0.08, J.hip + 0.04) : legUV(X), 'leg');

    // THE SHOE IS ONE LOFT, and its sole is where animateWalk thinks it is.
    // The bottom ring spans exactly the sole the gait's roll model pivots on:
    // 6.75 cm under the ankle, from 5.6 cm behind it to 15.6 cm ahead
    // (SOLE / HEEL_Z / TOE_Z in animateWalk; tools/gait.mjs reads the same
    // numbers). Change one, change all three.
    const foot = new Builder(false);
    foot.loftY([
      { y: J.ankle - 0.0675, pts: oval(0.046, 0.106, SL, X, 0.050) },   // sole underside
      { y: J.ankle - 0.052, pts: oval(0.050, 0.108, SL, X, 0.050) },    // sole top
      { y: J.ankle - 0.032, pts: oval(0.048, 0.104, SL, X, 0.048) },    // toe box
      { y: J.ankle + 0.004, pts: oval(0.046, 0.088, SL, X, 0.036) },    // instep
      { y: J.ankle + 0.045, pts: oval(0.041, 0.051, SL, X, 0.010) },    // collar
      { y: J.ankle + 0.10, pts: oval(0.036, 0.039, SL, X, 0) },         // inside the trouser
    ], [soleCol, shoeCol, shoeCol, shoeCol, shoeCol, shoeCol], { capStart: true, capEnd: true });
    acc.add(foot, solid(side < 0 ? B.footL : B.footR),
      cylUV(CELLS.shoe, X, 0.050, J.ankle - 0.0675, J.ankle + 0.10), 'foot');
  }

  return acc.build();
}

// A small pool of pre-built looks, shared by every pedestrian. Per-instance
// variety comes from the skeleton, scale and gait rather than new geometry.
let VARIANTS = null;
function variants() {
  if (!VARIANTS) {
    VARIANTS = [];
    for (let i = 0; i < 12; i++) VARIANTS.push(buildCharacter({ seed: i * 7919 + 13, variant: i }));
  }
  return VARIANTS;
}

// Cops need their OWN pool. They used to be spawned with a uniform in `opts`
// -- shirt, trousers, hat, vest -- but a pooled character ignores opts and
// takes a civilian variant, so every cop on foot was a civilian in a
// random shirt, and only the shooting gave them away.
let COP_VARIANTS = null;
function copVariants() {
  if (!COP_VARIANTS) {
    COP_VARIANTS = [];
    for (let i = 0; i < 4; i++) {
      COP_VARIANTS.push(buildCharacter({
        seed: i * 6007 + 71,
        shirt: [0.12, 0.16, 0.3], pants: [0.1, 0.12, 0.2], hat: [0.08, 0.1, 0.18], vest: [0.16, 0.2, 0.36],
        hivis: true,
      }));
    }
  }
  return COP_VARIANTS;
}

export function makeHumanoid(opts = {}) {
  const seed = opts.seed != null ? opts.seed : 0;
  const pooled = !opts.geometry && !opts.unique;
  const geo = opts.geometry
    || (opts.unique ? buildCharacter(opts)
      : opts.cop ? copVariants()[Math.floor(hash2(seed, 9) * 4) % 4]
        : variants()[Math.floor(hash2(seed, 9) * 12) % 12]);
  const bones = makeSkeletonBones();
  const mesh = new THREE.SkinnedMesh(geo, pedMat);
  mesh.add(bones[B.root]);
  mesh.bind(new THREE.Skeleton(bones));
  // A background pedestrian's shadow is a few dozen pixels at street level and
  // costs a whole extra draw call plus a second pass over an 18-bone skinned
  // mesh -- measured, 21 pedestrians were 21 draws and 27k triangles of shadow.
  // The player is the exception: their own shadow is how you read where you are
  // standing.
  mesh.castShadow = !ON_PHONE || !!opts.unique;
  mesh.frustumCulled = false;

  const g = new THREE.Group();
  g.add(mesh);
  const scale = opts.scale || (0.94 + hash2(seed, 5) * 0.14);
  g.scale.setScalar(scale);
  return {
    group: g, mesh, bones, height: 1.75 * scale, bob: 0, scale,
    // Pooled variants are shared by every pedestrian using that look, so only a
    // uniquely-built character may dispose its own geometry.
    //
    // The SKELETON is always per-instance, and three backs each one with a bone
    // texture on the GPU. Not disposing it leaked one texture per pedestrian
    // that walked out of range -- measured, `renderer.info.memory.textures` rose
    // from 62 to 80 over two minutes of driving and never came down. Every
    // spawn also uploads a fresh one, and a texture upload is a synchronous
    // stall on the main thread, which is what the intermittent stutter while
    // driving actually was: pedestrians churning in and out of the 150 m spawn
    // radius, each one costing an upload.
    dispose() {
      if (!pooled) geo.dispose();
      if (mesh.skeleton) mesh.skeleton.dispose();
    },
    gait: 0.92 + hash2(seed, 11) * 0.16,
    lean: hash2(seed, 12) * 0.06,
    swing: 0.8 + hash2(seed, 13) * 0.45,
    t: hash2(seed, 14) * 10,
    // so a crowd isn't marching in lockstep
    phase: hash2(seed, 15) * Math.PI * 2,
  };
}

const TAU = Math.PI * 2;
// Scratch for the leg solve, reused so a crowd doesn't allocate per frame.
const _v = new THREE.Vector3();
const _w = new THREE.Vector3();
const _inv = new THREE.Quaternion();
const LEG = J.hip - J.ankle;
const L_THIGH = J.hip - J.knee;
const L_SHIN = J.knee - J.ankle;
// Never ask the IK for a fully locked leg -- at full extension the knee angle
// is stationary against distance and the solve jitters.
const REACH = LEG * 0.99;
// What the hips are allowed to assume the planted leg can span. It has to be
// shorter than REACH, because the pelvis rolls and carries its sockets up with
// it -- HIP_X * sin(roll) is nearly a centimetre at a sprint. Set the hips by
// the full reach and that rise pushes the leg past its limit, so it comes up
// short and the planted foot lifts clear of the ground.
const REACH_PLANT = REACH - 0.014;

/**
 * How far the hips travel per step, with the per-person gait variation folded
 * in. This is the ONE number the gait is built on -- see animateWalk.
 */
function stepLength(h, speed) {
  // Fitted so cadence AND step length land inside published adult bands at
  // every speed from a stroll to a sprint -- tools/gait.mjs checks all ten
  // numbers. The old `0.62 + 0.14 v` over-strided a walk (0.93 m at 1.4 m/s,
  // against a real 0.68-0.82) and under-strided a run, which is why the walk
  // reached and the run took little quick steps.
  return clamp(0.45 + 0.245 * speed, 0.42, 2.6) * h.gait;
}

/**
 * Fraction of the cycle one foot is on the ground.
 *
 * Above 0.5 the two stances overlap and the character is in DOUBLE SUPPORT --
 * both feet down, which a real walk is in for about a fifth of the cycle and
 * which this model previously could not represent at all: stance was capped at
 * exactly 0.5, so there was always precisely one foot on the ground. A walk
 * without double support reads as a march.
 */
function dutyFactor(speed, runBlend = 0) {
  // Minus 0.03 once running. With a real rolling foot, contact travel is
  // 2 * step * duty of flat-foot origin, and at the mid-band duty that was
  // 1.22 m at 5.5 m/s against a person's ~1.05: the leg could only span it by
  // squatting (hips at 83%) and lunging the trailing leg out behind. The
  // lower edge of each band is still inside it: jog 0.40, run 0.30, sprint 0.24.
  return clamp(0.684 - 0.2055 * Math.log(Math.max(0.35, speed)) - 0.03 * runBlend, 0.22, 0.68);
}

/**
 * Procedural walk/idle cycle. Hips bob and sway, knees and elbows actually
 * bend, the chest counter-rotates against the pelvis and the head stays level.
 *
 * Feet are PLACED, not swung. Each leg alternates a stance half-cycle, where the
 * foot holds a fixed spot on the ground and simply travels back under the
 * character, and a swing half-cycle, where it arcs forward to the next plant;
 * the knee is then solved to reach that target. Rotating the hip on a sine
 * instead — which is what this did — cannot plant a foot: sized to cover the
 * step length on average, the foot still sweeps ~57% faster than the body
 * through mid-stance and slower at the ends, so it grinds forwards and
 * backwards against the ground the entire time. Measured, the planted foot was
 * moving 24 mm per frame while the body moved 25, i.e. barely holding at all,
 * and legs paddling under a gliding body is what reads as flailing.
 *
 * `h.phase` lives on the character so the cycle can't be advanced by anything
 * that doesn't also know the step length.
 */
export function animateWalk(h, amp, dt, speed) {
  const b = h.bones;
  h.t += dt || 0;
  const A = amp * h.gait;
  const spdIn = speed != null ? speed : amp * 4;
  // The CYCLE runs on a smoothed speed. The player's own speed damps at rate 9
  // -- a standstill to a run in about 0.3 s -- and step length, duty and
  // runBlend all follow it, so the stride used to be re-shaped by half a metre
  // a second every frame and the swing foot popped (14 cm of ankle
  // acceleration in one frame, measured on the rig's speed ramp). A person
  // changes stride over a step, not a frame. The feet stay planted regardless:
  // they are locked to the world below, not to the cycle.
  if (!dt || h.gspd == null) h.gspd = spdIn;
  else h.gspd += (spdIn - h.gspd) * (1 - Math.exp(-6 * dt));
  const spd = h.gspd;
  const run = clamp(spd / 6, 0, 1);
  // How much of a RUN this is, as opposed to how fast a walk. People switch
  // gait around 2.5-3 m/s, and everything that distinguishes the two -- hip
  // oscillation phase, foot clearance, lean -- has to key off this rather than
  // off raw speed, or a brisk walk gets treated as a slow run.
  const rb = clamp((spd - 2.2) / 1.2, 0, 1);
  const runBlend = rb * rb * (3 - 2 * rb);

  const step = stepLength(h, spd);
  // pi of phase per step, so one full 2pi cycle is a left-right pair. Paired
  // with a stance that runs linearly from +step/2 to -step/2, this makes the
  // planted foot travel backwards at exactly `spd` -- no skate by construction.
  h.phase = (h.phase || 0) + (dt || 0) * Math.PI * spd / step;
  const phase = h.phase;
  const s = Math.sin(phase), c = Math.cos(phase);
  // fold the legs back under the hips as the character stops, since a frozen
  // phase would otherwise leave them stranded mid-stride
  const settle = clamp((spd - 0.15) / 0.5, 0, 1);

  // legs: foot targets in character space, +z forward, y up from the ground.
  // The bones are unscaled, so a step measured in world metres has to come back
  // through the character's own scale or a tall pedestrian over-strides.
  const sc = h.scale || 1;
  // Ground contact is capped, so above a jog the step outgrows it and the duty
  // factor falls below a half -- the legs stop overlapping and a flight phase
  // opens up. Speeding up therefore buys cadence and air, not a wider split.
  // A foot in stance must travel backwards by the whole distance the body
  // covers while it is down, or it skates: cycle distance is 2 * step and the
  // foot is down for `duty` of it. That is the no-skate identity, and it is
  // what the old CONTACT_MAX broke -- it clamped the sweep to hold the bob
  // down, which is the wrong lever (see the hip model and the foot roll below).
  const duty = dutyFactor(spd, runBlend);
  const swept = Math.min(2 * step * duty, REACH_PLANT * 1.94) / sc * settle;
  // Swing clearance, and the main thing that sets how much the knee folds. A
  // sprinter's heel comes most of the way to the backside, which is where the
  // 120-155 deg of swing-phase knee flexion comes from.
  // Measured against tools/gait.mjs, this was short at every pace above a
  // walk: knee swing came out 59 deg at brisk (band 65-85), 105 at run
  // (110-140) and 108 at sprint (120-155). Too little fold is a leg that
  // swings through nearly straight, which is the stiff, skating look. The heel
  // has to come much closer to the backside as the pace rises.
  // 0.265, not 0.295: the higher clearance passed the knee-flexion bands but
  // lifted the thigh past horizontal at a run -- a prancing high-knee drill,
  // not someone crossing a street. 0.24 was tried and swung too far the other
  // way (sprint knee 117 deg, under its 120 band). Measured at 0.265:
  // jog/run/sprint 111/118/121, all in band.
  // Peak ankle height ABOVE the straight line from toe-off to heel strike. The
  // toe-off end is already raised by the heel lift, so this sits well under
  // the old 0.105 + 0.265: kept at those values the knee folded 149-162 deg at
  // jog/run/sprint, past every band.
  // It also climbs with pace past the gait switch: keyed on runBlend alone it
  // saturated at 3.4 m/s, so a jog folded its knee as far as a sprint (126 deg
  // against a 90-120 band). And 0.085 at a walk, not 0.07: the toe cleared the
  // pavement by 3 mm, against a real ~1.5 cm.
  // 0.03 per m/s, not 0.02: at 0.02 a sprint folded its knee 117 deg, under the
  // 120-155 band.
  const lift = ((0.085 + runBlend * (0.10 + 0.03 * clamp(spd - 3.5, 0, 4))) / sc) * settle;
  const stanceSpan = TAU * duty;
  const swingSpan = TAU - stanceSpan;
  // THE FOOT HAS LENGTH, AND IT ROLLS -- and the ankle has to follow from the
  // roll, not be dialled in beside it.
  //
  // The hips are limited by a straight line from hip to ANKLE, but the ground
  // contact is not the ankle: a stance foot lands on its heel, rolls flat and
  // pushes off from its toe. Without modelling that, a 0.86 m leg is asked to
  // span the whole 0.98 m stance sweep and the only way to do it is to squat
  // (measured once: hips at 85% of standing walking, 69% sprinting).
  //
  // The previous version modelled the roll as two separate numbers -- an ankle
  // excursion shortened by a fixed 0.22 m, and an ankle rise on a curve -- and
  // pitched the foot on a third, whose sign was backwards: +x on the foot bone
  // lowers the toe, and it was positive at heel strike, so every foot landed
  // toe-first and pushed off rolling on its heel. Nothing tied the three
  // together, so the sole could not stay on the ground: measured with the rig's
  // sole probe, planted soles hovered or sank up to 8.6 cm, and the pitch sat on
  // its clamp for 38-74% of every cycle.
  //
  // Now there is ONE flat-foot origin, which travels backwards at exactly body
  // speed while down (the no-skate identity), ONE sole pitch, and the ankle is
  // wherever a rigid foot pivoting on its heel or toe at that pitch puts it.
  // The sole cannot float or sink by construction.
  const SOLE = J.ankle - 0.0675;            // underside of the sole box in buildCharacter
  const ANK_Y = J.ankle - SOLE;
  const HEEL_Z = -0.056, TOE_Z = 0.156;     // sole ends, relative to the ankle
  // Heel strike lands toes-up about 11 deg at a walk; a runner lands flatter.
  // Toe-off peaks near 50 deg of heel lift -- it is what lets the trailing leg
  // reach without dropping the hips.
  const q0 = (0.20 - 0.12 * runBlend) * settle;
  const pOff = (0.90 + 0.20 * runBlend) * settle;
  const uLand = 0.15 - 0.07 * runBlend;     // rolled flat by here
  const uHeel = 0.55 - 0.15 * runBlend;     // heel comes up from here
  // A runner lands closer under the hips and pushes off further behind; the
  // symmetric window had the leading leg out straight at touchdown, which is
  // the lunging over-stride a player sees on every step.
  // How far the stance window sits BEHIND the hips. It is not a tuning dial:
  // it is chosen below so heel strike and toe-off limit the hips equally,
  // which is the highest the hips can ride over that stride. A symmetric
  // window had the leading leg out straight at touchdown -- the lunging
  // over-stride in every run strip -- and a hand-set shift only balanced one
  // speed. Toe-off carries the ankle up on a 50-60 deg heel lift, so the
  // balanced window lands closer under the hips and pushes off further behind,
  // which is what a runner does.
  let back = 0;
  const rawHip = (t) => t.y + Math.sqrt(Math.max(0.04, REACH_PLANT * REACH_PLANT - t.z * t.z));
  const pivot = (zf, p) => {
    // rotation.x by p: y' = y cos p - z sin p, z' = y sin p + z cos p
    const rz = p >= 0 ? -TOE_Z : -HEEL_Z;
    const oz = zf + (p >= 0 ? TOE_Z : HEEL_Z);
    return [oz + ANK_Y * Math.sin(p) + rz * Math.cos(p), SOLE + ANK_Y * Math.cos(p) - rz * Math.sin(p)];
  };
  const stanceAt = (u) => {
    let p = 0;
    if (u < uLand) { const k = 1 - u / uLand; p = -q0 * k * k; }
    else if (u > uHeel) { const k = (u - uHeel) / (1 - uHeel); p = pOff * k * k; }
    const zf = (0.5 - u) * swept - back;
    const a = pivot(zf, p);
    return { z: a[0], y: a[1], pitch: p, stance: true, zf, u };
  };
  // Bisect `back`: more back lifts the strike limit and lowers the toe-off
  // one. Six steps put it inside a centimetre; it is a dozen trig calls.
  // The bounds scale with the stride: fixed bounds let `back` snap to one of
  // them as a character stopped -- with swept at 0 strike and toe-off are the
  // same pose, the comparison ties, and every foot target jumped by up to
  // 45 cm in one frame (the rig's speed ramp, at the stop).
  {
    let lo = -0.2 * swept, hi = 0.45 * swept;
    for (let i = 0; i < 6; i++) {
      back = (lo + hi) / 2;
      if (rawHip(stanceAt(0)) < rawHip(stanceAt(1))) lo = back; else hi = back;
    }
    back = (lo + hi) / 2;
  }
  const toeOff = stanceAt(1), strike = stanceAt(0);
  // Swing is a Hermite curve whose ends move the way stance does, backwards.
  // A linear swing reversed the foot's velocity in a single frame at touchdown
  // and toe-off -- a visible snap twice per step -- and the small backward
  // slope at the far end is the late-swing retraction every real foot makes
  // before it lands.
  // Less of it at a run: the same slope left a runner's foot drifting on
  // backwards after toe-off, the trailing leg lingering out behind.
  const vz = (-swept / Math.max(0.3, stanceSpan)) * swingSpan * (0.35 - 0.20 * runBlend);
  const swingAt = (u) => {
    const u2 = u * u, u3 = u2 * u;
    const z = (2 * u3 - 3 * u2 + 1) * toeOff.z + (u3 - 2 * u2 + u) * vz
      + (-2 * u3 + 3 * u2) * strike.z + (u3 - u2) * vz;
    // Clearance peaks early in swing (the heel kicks up behind), not halfway,
    // and at a run it holds a flat top: a runner's foot stays up under a raised
    // thigh until late swing and then drops to land. With a plain sine the
    // leading foot hung a few centimetres off the pavement out in front for
    // most of the flight phase, which read as reaching for the ground.
    // Built from two smoothsteps so it leaves and meets the ground with ZERO
    // vertical speed: a sine over u^p has infinite slope at toe-off, and the
    // flat-topped version of it lifted a sprinting ankle 21 cm in one frame.
    const rise = 0.40 - 0.15 * runBlend, fall = 0.50 - 0.15 * runBlend;
    let y = toeOff.y + (strike.y - toeOff.y) * smoothT(u)
      + lift * smoothT(clamp(u / rise, 0, 1)) * smoothT(clamp((1 - u) / fall, 0, 1));
    const pitch = toeOff.pitch + (strike.pitch - toeOff.pitch) * smoothT(clamp(u * 1.6, 0, 1));
    // Toe clearance is a floor, not a by-product. The ankle arc clears the
    // ground, but the foot is still pitched toe-down from push-off through
    // early swing, and the rig measured the lower of heel and toe skimming the
    // pavement by 1-7 mm at every speed. Keep it ~2 cm up mid-swing; the ends
    // are left alone so touchdown and toe-off still meet the ground.
    const cpp = Math.cos(pitch), spp = Math.sin(pitch);
    const low = y - ANK_Y * cpp - Math.max(TOE_Z * spp, HEEL_Z * spp);
    const floor = SOLE + (0.02 / sc) * settle * Math.sin(Math.PI * u);
    if (low < floor) y += floor - low;
    return { z, y, pitch, stance: false, u };
  };
  // EACH FOOT FINISHES WHAT IT STARTED. Stance and swing are slices of one
  // phase circle cut at `stanceSpan`, and that cut moves with speed: slowing
  // raises duty, so a foot a fifth of the way into its swing could find itself
  // re-classified as the END of stance and teleport back to the toe-off pose
  // (the rig's speed ramp measured 24 cm of ankle acceleration in one frame at
  // a steady 1.4 m/s, left over from a slow-down). A foot now keeps its own
  // progress through the half-cycle it is in, only changes state once that is
  // done, and catches up with the shared cycle a little each frame.
  const dph = (dt || 0) * Math.PI * spd / step;
  if (!dt) h.gst = null;
  else if (!h.gst) h.gst = [null, null];
  const footState = (k, ph) => {
    const w = ((ph % TAU) + TAU) % TAU;
    let st = w < stanceSpan;
    let u = st ? w / stanceSpan : (w - stanceSpan) / swingSpan;
    const G = h.gst && h.gst[k];
    if (G) {
      const adv = G.u + dph / (G.st ? stanceSpan : swingSpan);
      if (st !== G.st && G.u < 0.97) { st = G.st; u = Math.min(1, adv); }
      // A legitimate change of state begins the new half-cycle at its START,
      // not wherever the shared cycle has got to. Taking the cycle's u there
      // put a foot that had just finished a held swing at mid-stance: the rig
      // trace caught the ankle jumping 57 cm (z +0.37 to -0.195) in one frame.
      // From here the catch-up below closes the gap a little each frame, and
      // the world lock keeps the planted foot still while it does.
      else if (st !== G.st) u = clamp(adv - 1, 0, 0.04);
      else u = clamp(u, adv - 0.04, adv + 0.04);
      u = clamp(u, 0, 1);
      G.st = st; G.u = u;
    } else if (h.gst) h.gst[k] = { st, u };
    return st ? stanceAt(u) : swingAt(u);
  };
  const tl = footState(0, phase), tr = footState(1, phase + Math.PI);
  tl.x = -HIP_X; tr.x = HIP_X;

  // FEET ARE LOCKED TO THE WORLD WHILE THEY ARE DOWN.
  //
  // The analytic stance target only travels at body speed while the speed is
  // constant and the heading is fixed, and a player is almost never either.
  // Step length, duty and settle all move with speed, so the same phase maps to
  // a different spot next frame: the rig's speed ramp measured a planted sole
  // slipping 15.6 cm in one frame while slowing to a stop. And turning at the
  // player's 10 rad/s swings a foot planted 0.4 m ahead sideways by ~7 cm a
  // frame -- skating on every corner. So a foot that touches down remembers
  // WHERE, in world space, and the leg is solved to that spot until it lifts;
  // whatever it ended up away from the analytic target fades out over the
  // swing. Callers must place the group BEFORE calling this, or the lock is a
  // frame behind the body.
  // The furthest out from the hips this stride ever puts an ankle, plus a
  // margin. A lock may not hold a foot beyond it: the hips ride the more
  // extended planted foot, and a foot planted during a run and still locked
  // after slowing to a walk sat 86 cm behind -- the rig trace had the hips
  // squatting to 0.36 m and springing back 53 cm when it lifted. The 0.30
  // floor keeps a stroll from dragging its feet.
  const zLimit = Math.max(Math.abs(strike.z), Math.abs(toeOff.z), 0.22 / sc) + 0.08 / sc;
  if (!dt) {
    // Posing at an exact phase (the strip and portrait harnesses): no history.
    h.locks = null;
  } else {
    const g = h.group;
    g.updateMatrix();
    const m = g.matrix.elements, s2 = m[0] * m[0] + m[2] * m[2] || 1;
    if (!h.locks) h.locks = [{ on: false, wx: 0, wz: 0, ex: 0, ez: 0 }, { on: false, wx: 0, wz: 0, ex: 0, ez: 0 }];
    for (let k = 0; k < 2; k++) {
      const t = k === 0 ? tl : tr, L = h.locks[k];
      if (t.stance) {
        if (!L.on) {
          L.on = true;
          L.wx = m[0] * t.x + m[8] * t.zf + m[12];
          L.wz = m[2] * t.x + m[10] * t.zf + m[14];
        }
        const dx = L.wx - m[12], dz = L.wz - m[14];
        let ex = (dx * m[0] + dz * m[2]) / s2 - t.x;
        let ez = (dx * m[8] + dz * m[10]) / s2 - t.zf;
        // A warp, a car exit or walking into a wall: re-plant rather than
        // stretch the leg after a body that has gone somewhere else.
        // Past 0.5 -- a warp, a car exit, walking into a wall, stopping dead
        // from a sprint -- the lock is DRAGGED after the body rather than
        // re-planted: re-planting snapped the foot up to 62 cm in one frame on
        // the rig's speed ramp, and a foot sliding the last few centimetres of
        // a hard stop reads as a scuff, not a glitch. It cannot be much
        // tighter: duty falls from 0.52 to 0.43 across 2.2-3.4 m/s, which moves
        // a planted foot's analytic spot ~26 cm from where it really is.
        const el = Math.hypot(ex, ez), EMAX = 0.5;
        if (el > EMAX) {
          ex *= EMAX / el; ez *= EMAX / el;
          L.wx = m[0] * (t.x + ex) + m[8] * (t.zf + ez) + m[12];
          L.wz = m[2] * (t.x + ex) + m[10] * (t.zf + ez) + m[14];
        }
        const zc = t.z + ez;
        if (Math.abs(zc) > zLimit) {
          ez += Math.sign(zc) * zLimit - zc;
          L.wx = m[0] * (t.x + ex) + m[8] * (t.zf + ez) + m[12];
          L.wz = m[2] * (t.x + ex) + m[10] * (t.zf + ez) + m[14];
        }
        L.ex = ex; L.ez = ez;
        t.x += ex; t.z += ez;
      } else {
        L.on = false;
        const fade = 1 - smoothT(t.u);
        t.x += L.ex * fade; t.z += L.ez * fade;
      }
    }
  }

  // The hips can only ride as high as the planted leg can reach, so the classic
  // two-bob-per-cycle rise and fall falls out of the geometry instead of being
  // dialled in: highest at mid-stance, lowest as the legs scissor apart. It has
  // to come from the PLANTED foot -- take it from the airborne one and the
  // stance leg is asked for a reach it hasn't got, and the foot skates instead.
  // With duty above 0.5 both feet can be down at once, and then BOTH legs
  // constrain the hips -- take the lower of the two, or the trailing leg is
  // asked for a reach it hasn't got and its foot lifts.
  const planted = tl.stance && tr.stance
    ? (rawHip(tl) < rawHip(tr) ? tl : tr)
    : (tl.stance ? tl : (tr.stance ? tr : null));
  // Which foot is bearing weight: 0 left, 1 right, -1 airborne. Only the gait
  // regression test reads it -- measuring skate needs the model's own idea of
  // stance, or a flight phase gets counted as a foot sliding. See CLAUDE.md.
  h.contact = tl.stance ? 0 : (tr.stance ? 1 : -1);
  // Per-foot, because with double support the single index cannot say that
  // both are down. The gait rig reads these to measure duty and skate.
  h.contactL = tl.stance; h.contactR = tr.stance;
  const lowHip = Math.min(rawHip(toeOff), rawHip(strike));
  // A WALK AND A RUN BOB IN OPPOSITE PHASE.
  //
  // A straight planted leg puts the hips on a circle: highest at mid-stance,
  // lowest as the legs scissor. Taken literally that is the "compass gait", and
  // it bobs about 16 cm at walking speed against a real 4-5 cm -- people flatten
  // it with stance-phase knee flexion. A walk keeps a little of that circle, so
  // the hips still peak at mid-stance: an inverted pendulum vaulting over a
  // stiff leg. A run's knee absorbs MORE than the circle rises, so the hips are
  // at their LOWEST at mid-stance: a spring compressing under the body. Having
  // one curve for both is why every speed here once bobbed an identical
  // 13-14 cm and a run looked like a hurried walk.
  //
  // The phase inversion still holds; the AMOUNT is now explicit. A fixed
  // `compress` factor on the circle was tolerable while the foot model cheated
  // the stride short, but with a rigid rolling foot the circle between
  // mid-stance and the scissored pose spans 7-25 cm, and the same factor bobbed
  // a walk 9 cm and sank a run to 71% of standing height with the legs unable
  // to reach the ground. A walk takes a fixed 4.5 cm of the circle; a run sinks
  // a fixed 4.5 cm under the scissored height at mid-stance. Neither may ride
  // above what the planted leg can reach.
  const range = Math.max(1e-3, rawHip(stanceAt(0.5)) - lowHip);
  const walkK = Math.min(1, (0.045 / sc) / range);
  const sink = (0.035 / sc) * settle;
  let hipY;
  // With per-foot state a WALKING character can briefly have neither foot
  // classed as down -- one finishing its swing while the cycle already says
  // stance. A walk has no flight gap to arc over, and falling through to the
  // airborne branch snapped the hips to lowHip in one frame (a 56 cm ankle pop
  // on the rig's speed ramp at the stop). Ride the lower foot instead.
  const pin = planted || (stanceSpan >= Math.PI - 1e-6 ? (tl.y < tr.y ? tl : tr) : null);
  if (pin) {
    const raw = rawHip(pin);
    const e = clamp((raw - lowHip) / range, 0, 1);
    hipY = Math.min(raw, lowHip + (raw - lowHip) * walkK * (1 - runBlend) - sink * e * runBlend);
  } else {
    // Airborne: nothing pins the hips, so arc over the gap. Both ends of a
    // flight phase are the fully-scissored pose, so this stays continuous.
    const gap = Math.PI - stanceSpan;
    const w = ((phase % Math.PI) + Math.PI) % Math.PI;
    const f = gap > 1e-6 ? clamp((w - stanceSpan) / gap, 0, 1) : 0;
    hipY = lowHip + ((0.02 + 0.03 * runBlend) / sc) * Math.sin(Math.PI * f);
  }

  // The pelvis has to be posed BEFORE the legs are solved. It sways, rolls and
  // twists, and the leg roots ride with it -- a roll of 0.09 rad lifts a hip
  // socket by most of a centimetre. Solving against a character-space target and
  // then moving the pelvis underneath leaves the foot floating and creeping;
  // measured at a sprint that was 8 mm of float. So set it, then aim at the
  // target through its inverse.
  // Weight shift: the pelvis moves OVER the planted foot. The left leg roots
  // at -X and is in stance while sin(phase) > 0, so the shift is -sin -- this
  // was +sin, which swayed the pelvis AWAY from the foot that was bearing it,
  // the exact opposite of weight, while the pelvic list below leaned the other
  // way. The two fighting is the drunk wobble. It also narrows with pace:
  // a runner's feet land nearer the midline, so there is less to shift over.
  b[B.hips].position.set(-s * A * (0.085 - 0.055 * runBlend), hipY, 0);
  b[B.hips].rotation.set(0, -s * A * 0.30, -s * A * 0.11);
  b[B.hips].updateMatrix();
  _inv.copy(b[B.hips].quaternion).invert();

  // two-bone IK, sagittal plane only: solve thigh and knee to hit the target
  const solveLeg = (thigh, knee, foot, t) => {
    // where this hip socket actually ended up, and the target seen from it
    _v.copy(b[thigh].position).applyMatrix4(b[B.hips].matrix);
    // Lateral too, now that a locked foot can sit off its own line (a turn,
    // the pelvis swaying over it): the sagittal-only solve dragged the foot
    // sideways with the hips, which is the same skate one axis over.
    _w.set(t.x - _v.x, t.y - _v.y, t.z - _v.z).applyQuaternion(_inv);
    const dz = _w.z, dy = -_w.y, dx = _w.x;
    const D = clamp(Math.hypot(dz, dy, dx), Math.abs(L_THIGH - L_SHIN) + 1e-3, L_THIGH + L_SHIN - 1e-3);
    const aim = Math.atan2(dz, dy); // target angle off straight-down, +z forward
    // knee sits FORWARD of the hip-to-ankle line, so the thigh leads it by `off`
    const off = Math.acos(clamp((L_THIGH * L_THIGH + D * D - L_SHIN * L_SHIN) / (2 * L_THIGH * D), -1, 1));
    const inner = Math.acos(clamp((L_THIGH * L_THIGH + L_SHIN * L_SHIN - D * D) / (2 * L_THIGH * L_SHIN), -1, 1));
    b[thigh].rotation.x = -(aim + off); // negative x rotation swings a limb to +z
    b[thigh].rotation.z = Math.atan2(dx, Math.hypot(dz, dy)); // +z swings toward +X
    b[knee].rotation.x = Math.PI - inner;
    b[foot].rotation.z = -b[thigh].rotation.z;              // sole stays level across
    // keep the sole level through stance, toe up a little as it swings through
    // Level the sole, but only as far as an ankle actually goes. Cancelling
    // thigh+knee outright gave a 77-108 deg range against a real 25-30, which
    // is a foot flapping on the end of the leg rather than pushing off one.
    const level = -(b[thigh].rotation.x + b[knee].rotation.x);
    // The sole pitch comes from the roll model above, so the ankle target was
    // computed FOR this pitch -- clamping it tight re-opens the gap between
    // sole and ground. The limits are a real ankle's, about 45 deg of plantar
    // flexion and 35 of dorsiflexion, and the rig reports how often they bind.
    // -0.80 / +1.00, not -0.62 / +0.80: a runner's shin tips well forward over
    // a flexed knee at mid-stance, and at the tighter limits the ankle bound on
    // 46% of running frames, lifting the sole 3 cm off the pavement.
    b[foot].rotation.x = clamp(level + t.pitch, -0.80, 1.00);
  };
  solveLeg(B.thighL, B.kneeL, B.footL, tl);
  solveLeg(B.thighR, B.kneeR, B.footR, tr);

  // Arms. A walk has a loose 30-40 deg swing from a nearly straight arm; a run
  // has an 80-90 deg elbow driving hard. Both the amplitude and the elbow have
  // to move with the gait -- carrying one elbow angle across the whole range is
  // what made a sprint read as a hurried walk with the arms along for the ride.
  const armA = (0.11 * settle + A * 0.66) * h.swing;
  // A runner drives the arm BACK and lets it come forward only to about the
  // ribs; swinging it forward as far as back put the hand out in front of the
  // chest on every stride. +x swings backward, so the forward half is the
  // negative one and is cut back as the pace rises.
  const fwd = 1 - 0.5 * runBlend;
  const shL = armA * 0.95 * s, shR = -armA * 0.95 * s;
  b[B.shoulderL].rotation.x = shL < 0 ? shL * fwd : shL;
  b[B.shoulderR].rotation.x = shR < 0 ? shR * fwd : shR;
  // Abduction keeps the hands clear of the thighs. Positive Z swings a limb
  // toward +X, so the LEFT arm (at -X) needs a negative angle to move outward.
  // Abduction keeps the hands off the thighs at a stroll, but it has to come
  // BACK IN as the pace rises: a runner's arms track forward close to the ribs,
  // and holding a walk's clearance at speed reads as flapping.
  const abduct = 0.15 - 0.09 * runBlend + A * 0.04;
  b[B.shoulderL].rotation.z = -abduct;
  b[B.shoulderR].rotation.z = abduct;
  // A touch of internal rotation so the forearms swing across the body rather
  // than out to the sides, which is what the elbow bend does on its own.
  b[B.shoulderL].rotation.y = 0.10 * runBlend;
  b[B.shoulderR].rotation.y = -0.10 * runBlend;
  // A street runner carries the elbow near 70 deg, not the 90-plus of someone
  // racing, and does not hold the forearms up horizontal.
  // The hand bones were never posed, so at a run the forward hand sat flat on
  // the end of a horizontal forearm like a tray. Palms turn IN and curl a
  // touch as the pace rises.
  // (0.15, not 0.45: the palm is modelled facing the thigh now, and turning
  // it further in rolled it to face backward.)
  b[B.handL].rotation.y = 0.15 * runBlend;
  b[B.handR].rotation.y = -0.15 * runBlend;
  // A runner's hands close into a loose fist; walking, they hang in the
  // relaxed curl the geometry is built in.
  const fist = 0.55 * runBlend;
  b[B.fingL].rotation.z = fist; b[B.fingR].rotation.z = -fist;
  b[B.tipL].rotation.z = fist * 0.9; b[B.tipR].rotation.z = -fist * 0.9;
  // +x, not -x: on a forearm carried forward, -x tipped the fingers UP and
  // out, the flat "karate chop" hand in the run strips. +x lets them hang.
  b[B.handL].rotation.x = 0.22 * runBlend;
  b[B.handR].rotation.x = 0.22 * runBlend;
  const elbowCarry = 0.25 + 0.80 * runBlend;
  // The elbow folds as the arm swings FORWARD and opens as it drives back --
  // watch anyone run. +x on a limb bone swings it backward, so the left arm is
  // forward while s < 0; this flexed on s > 0, pumping the elbow on the
  // backswing, which is what read as T-rex arms carried stiff in front.
  // 0.55, not 1.1: at a run the extra fold took the leading elbow past 100 deg
  // and lifted the forearm above level with the hand out in front, the
  // "karate chop" in every run strip.
  // Paired with the shortened forward shoulder swing above: the hand comes UP
  // to the chest rather than OUT in front of it. 0.8 with the full forward
  // swing lifted the hand toward the face; 0.55 with it left the forearm level
  // and reaching.
  b[B.elbowL].rotation.x = -elbowCarry - Math.max(0, -armA * 0.8 * s);
  b[B.elbowR].rotation.x = -elbowCarry - Math.max(0, armA * 0.8 * s);

  // Trunk lean. Kept on the spine and chest rather than the pelvis: the legs
  // are solved against the pelvis, and pitching it would move the hip sockets
  // out from under a solve that has already been given its ground targets.
  // 0.24 at a run, not 0.19: with the stance window balanced behind the hips
  // the legs work further back, and an upright trunk over them read as leaning
  // away from the direction of travel.
  const lean = h.lean + 0.02 + 0.24 * runBlend;
  // Pelvis was posed above, before the legs were solved against it.
  b[B.spine].rotation.y = s * A * 0.16;
  b[B.spine].rotation.x = lean * 0.45;
  b[B.chest].rotation.y = s * A * 0.30;
  b[B.chest].rotation.x = lean * 0.55 + A * 0.06;
  b[B.chest].rotation.z = -c * A * 0.05;

  // head stays level and pointed where the body is going
  // The head stays up and looking ahead however far the trunk pitches over --
  // a runner does not stare at their own feet. Cancel most of the lean the
  // spine and chest just applied.
  // 0.7, not 0.85: cancelling nearly all of the trunk lean tipped the chin up
  // and he ran staring at the sky. A runner's head is level-ish, not craned.
  b[B.neck].rotation.x = -lean * 0.70 - A * 0.05;
  b[B.head].rotation.y = -s * A * 0.22 + Math.sin(h.t * 0.6) * 0.12 * (1 - run);
  b[B.head].rotation.x = -A * 0.08 + Math.sin(h.t * 0.9) * 0.03;

  // idle: breathing, a slow weight shift, and ASYMMETRY. A person at rest
  // never mirrors themselves: one foot a little ahead, weight favouring one
  // hip, one elbow more bent than the other. Perfect symmetry is the shop
  // dummy, and it was scored as one. h.phase seeds the handedness so each
  // pedestrian settles differently but the same one is consistent.
  //
  // BLENDED in, not switched. This used to be `if (A < 0.05)`, which swapped the
  // whole body into the idle pose in one frame as a character slowed through
  // ~0.3 m/s: the gait rig's speed ramp measured a planted sole jumping 14 cm in
  // a single frame on every stop. The weight eases over the last half metre a
  // second instead, and the handedness is fixed per character -- deriving it
  // from h.phase flipped it whenever the cycle crept past an integer.
  const idleW = 1 - smoothT(clamp((spd - 0.04) / 0.5, 0, 1));
  if (h.handed == null) h.handed = (h.phase % 2) > 1 ? 1 : -1;
  b[B.head].rotation.z = h.handed * 0.02 * idleW;
  if (idleW > 0) {
    const br = Math.sin(h.t * 1.5);
    const handed = h.handed;
    const mix = (bone, axis, v) => { bone.rotation[axis] += (v - bone.rotation[axis]) * idleW; };
    mix(b[B.chest], 'x', h.lean + br * 0.02);
    b[B.hips].position.x += (handed * 0.016 + Math.sin(h.t * 0.5) * 0.010 - b[B.hips].position.x) * idleW;
    mix(b[B.hips], 'z', handed * 0.035 + Math.sin(h.t * 0.5) * 0.02);
    mix(b[B.hips], 'y', handed * 0.08);
    // one foot slightly ahead of the other, knees soft rather than locked
    // The legs come in LATER than the upper body (idleW squared). Any leg pose
    // blended in while a foot is still locked to the ground drags that foot
    // across it; blended on idleW the rig measured a 9.3 cm slip on every stop.
    const legW = idleW * idleW;
    const mixL = (bone, axis, v) => { bone.rotation[axis] += (v - bone.rotation[axis]) * legW; };
    mixL(b[B.thighL], 'x', handed * 0.055 - 0.02);
    mixL(b[B.thighR], 'x', -handed * 0.055 - 0.02);
    mixL(b[B.kneeL], 'x', 0.06 - handed * 0.02);
    mixL(b[B.kneeR], 'x', 0.06 + handed * 0.02);
    mixL(b[B.footL], 'x', -(b[B.thighL].rotation.x + b[B.kneeL].rotation.x));
    mixL(b[B.footR], 'x', -(b[B.thighR].rotation.x + b[B.kneeR].rotation.x));
    mix(b[B.shoulderL], 'x', br * 0.03 + handed * 0.07);
    mix(b[B.shoulderR], 'x', -br * 0.03 - handed * 0.07);
    mix(b[B.shoulderL], 'y', handed * 0.05);
    mix(b[B.shoulderR], 'y', handed * 0.05);
    mix(b[B.shoulderL], 'z', -0.12);
    mix(b[B.shoulderR], 'z', 0.16);
    // A relaxed arm is never straight: the elbows rest at ~20-30 deg. At -0.22
    // on one side the arm hung like a stick in every portrait.
    mix(b[B.elbowL], 'x', -0.50 + br * 0.02);
    mix(b[B.elbowR], 'x', -0.36 - br * 0.02);
  }
  h.bob = 0;
}

// ---------------------------------------------------------------------------

// A pavement with 26 people spread over a 150 m radius is a pavement with
// nobody on it at any given moment. Characters are one draw call each -- the
// cheapest population in the game -- so this is the least expensive density
// there is to buy.
const MAX_PEDS = 24;
const PED_RADIUS = 150;

export class PedSystem {
  constructor(scene, city, game) {
    this.scene = scene;
    this.city = city;
    this.game = game;
    this.peds = [];
    this.R = rng(4242);
    this.timer = 0;
  }

  spawn(px, pz, cop) {
    const city = this.city;
    for (let attempt = 0; attempt < 12; attempt++) {
      const eids = city.edgesNear(px, pz, PED_RADIUS);
      if (!eids.length) return null;
      const ei = eids[Math.floor(this.R.n() * eids.length)];
      const e = city.edges[ei];
      if (e.elev || e.cls === 'hwy' || e.cls === 'ramp') continue;
      const a = city.nodes[e.a], b = city.nodes[e.b];
      const t = 0.15 + this.R.n() * 0.7;
      const side = this.R.n() < 0.5 ? 1 : -1;
      const off = e.hw + 1.4;
      const x = lerp(a.x, b.x, t) - e.dz * off * side;
      const z = lerp(a.z, b.z, t) + e.dx * off * side;
      const d = Math.hypot(x - px, z - pz);
      // Don't spawn on top of the player, but 26 m was far enough that the
      // pavement directly in front of you was permanently empty -- which is
      // the stretch of pavement you spend the whole game looking at.
      if (d < (cop ? 20 : 15) || d > PED_RADIUS) continue;
      if (!G.isBuildable(x, z)) continue;
      const seed = (this.R.n() * 1e6) | 0;
      const h = makeHumanoid({ seed, cop: !!cop });
      const p = {
        h, x, z, y: city.groundAt(x, z, null), lift: 0, heading: this.R.n() * Math.PI * 2,
        edge: ei, side, t, dirSign: this.R.n() < 0.5 ? 1 : -1,
        speed: 0, state: 'walk', timer: 0,
        cop: !!cop, shootCd: 1 + this.R.n(), down: 0, hp: cop ? 60 : 30,
      };
      this.scene.add(h.group);
      this.peds.push(p);
      return p;
    }
    return null;
  }

  remove(p) {
    const i = this.peds.indexOf(p);
    if (i >= 0) this.peds.splice(i, 1);
    this.scene.remove(p.h.group);
    p.h.dispose();
  }

  scare(x, z, radius) {
    for (const p of this.peds) {
      if (p.cop || p.state === 'down') continue;
      if (dist2(p.x, p.z, x, z) < radius * radius) {
        p.state = 'flee';
        p.timer = 4 + this.R.n() * 3;
        p.fleeX = p.x - x;
        p.fleeZ = p.z - z;
      }
    }
  }

  update(dt, px, pz, player, traffic) {
    const city = this.city;
    const game = this.game;
    this.timer -= dt;
    const wantCops = game.wanted >= 3 ? Math.min(6, (game.wanted - 2) * 2) : 0;
    let copCount = 0;
    for (const p of this.peds) if (p.cop) copCount++;

    if (this.timer <= 0) {
      this.timer = 0.2;
      if (this.peds.length - copCount < MAX_PEDS) this.spawn(px, pz, false);
      if (copCount < wantCops) this.spawn(px, pz, true);
    }

    for (let i = this.peds.length - 1; i >= 0; i--) {
      const p = this.peds[i];
      const d2p = dist2(p.x, p.z, px, pz);
      if (d2p > (PED_RADIUS + 90) * (PED_RADIUS + 90)) { this.remove(p); continue; }
      if (p.cop && game.wanted === 0) { this.remove(p); continue; }

      if (p.state === 'down') {
        p.down += dt;
        p.h.group.rotation.z = lerp(p.h.group.rotation.z, Math.PI / 2 * p.fallDir, 1 - Math.exp(-8 * dt));
        p.h.group.position.set(p.x, p.y, p.z);
        if (p.down > 9) this.remove(p);
        continue;
      }

      let targetSpeed = 1.35;
      let desired = p.heading;

      if (p.cop) {
        const d = Math.sqrt(d2p);
        desired = Math.atan2(px - p.x, pz - p.z);
        targetSpeed = d > 9 ? 4.6 : 0;
        p.shootCd -= dt;
        if (d < 34 && p.shootCd <= 0) {
          p.shootCd = 1.1 + this.R.n() * 0.9;
          game.onCopShot(p);
        }
      } else if (p.state === 'flee') {
        p.timer -= dt;
        const l = Math.hypot(p.fleeX, p.fleeZ) || 1;
        desired = Math.atan2(p.fleeX / l, p.fleeZ / l);
        targetSpeed = 5.2;
        if (p.timer <= 0) p.state = 'walk';
      } else {
        // walk the sidewalk
        const e = city.edges[p.edge];
        if (!e) { this.remove(p); continue; }
        const a = city.nodes[p.dirSign > 0 ? e.a : e.b];
        const b = city.nodes[p.dirSign > 0 ? e.b : e.a];
        const dx = b.x - a.x, dz = b.z - a.z;
        const len = Math.hypot(dx, dz) || 1;
        const fx = dx / len, fz = dz / len;
        const prog = (p.x - a.x) * fx + (p.z - a.z) * fz;
        if (prog > len - 3) {
          const nodeId = p.dirSign > 0 ? e.b : e.a;
          const node = city.nodes[nodeId];
          const opts = node.e.filter((ei) => {
            const ne = city.edges[ei];
            return !ne.elev && ne.cls !== 'hwy' && ne.cls !== 'ramp';
          });
          if (opts.length) {
            const nei = opts[Math.floor(this.R.n() * opts.length)];
            p.edge = nei;
            p.dirSign = city.edges[nei].a === nodeId ? 1 : -1;
            p.side = this.R.n() < 0.5 ? 1 : -1;
          } else p.dirSign = -p.dirSign;
        } else {
          const off = e.hw + 1.4;
          const ap = clamp(prog + 4, 0, len);
          const tx = a.x + fx * ap - fz * off * p.side;
          const tz = a.z + fz * ap + fx * off * p.side;
          desired = Math.atan2(tx - p.x, tz - p.z);
        }
        targetSpeed = 1.25 + hash2(i, 3) * 0.5;
      }

      p.heading += clamp(angleWrap(desired - p.heading), -7 * dt, 7 * dt);
      p.speed = lerp(p.speed, targetSpeed, 1 - Math.exp(-7 * dt));
      p.x += Math.sin(p.heading) * p.speed * dt;
      p.z += Math.cos(p.heading) * p.speed * dt;
      p.x = G.clampToMap(p.x);
      p.z = G.clampToMap(p.z);
      p.lift = city.roadLift(p.x, p.z);
      p.y = city.groundAt(p.x, p.z, p.y + 1, p.lift);

      // Place the body BEFORE animating it: animateWalk locks planted feet to
      // world positions, and solving against last frame's root puts every
      // planted foot a frame (~2 cm at a stroll) behind.
      p.h.group.position.set(p.x, p.y, p.z);
      p.h.group.rotation.y = p.heading;
      p.h.group.rotation.z = 0;
      animateWalk(p.h, clamp(p.speed * 0.20, 0, 0.8), dt, p.speed);

      // knocked over by traffic
      for (const v of traffic.cars) {
        if (v.mode === 'parked') continue;
        const sp = Math.abs(v.vLong);
        if (sp < 2.2) continue;
        const n = v.nearest(p.x, p.z);
        if (dist2(n.x, n.z, p.x, p.z) < 0.65) {
          this.knockDown(p, v.forward, sp);
          game.onPedHit(v === player.vehicle, p);
          break;
        }
      }
    }
  }

  knockDown(p, dir, force) {
    p.state = 'down';
    p.down = 0;
    p.fallDir = Math.random() < 0.5 ? 1 : -1;
    p.x += dir.x * clamp(force * 0.12, 0.4, 3);
    p.z += dir.z * clamp(force * 0.12, 0.4, 3);
    p.y = this.city.groundAt(p.x, p.z, p.y + 1, this.city.roadLift(p.x, p.z));
    p.h.group.position.set(p.x, p.y + 0.3, p.z);
  }

  hitAt(x, z, radius, damage, isPlayer) {
    let hit = null;
    for (const p of this.peds) {
      if (p.state === 'down') continue;
      if (dist2(p.x, p.z, x, z) < radius * radius) {
        p.hp -= damage;
        if (p.hp <= 0) {
          this.knockDown(p, { x: 0, z: 0 }, 0);
          this.game.onPedKilled(p, isPlayer);
        } else {
          p.state = 'flee';
          p.timer = 5;
          p.fleeX = p.x - x;
          p.fleeZ = p.z - z;
        }
        hit = p;
        break;
      }
    }
    return hit;
  }
}
