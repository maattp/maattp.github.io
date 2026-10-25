// Auto KW: the Tim Hortons wordmark, drawn as paths into a canvas.
//
// The real one is a brush script (red channel letters on the fascia, white
// on the pylon's red cabinet). No font draws it the same on the iPhone and
// in headless Chrome ('Brush Script MT' is a Mac font, iOS has 'Snell
// Roundhand'), so the letters are centrelines here, swept with a broad nib
// (`nib`): each stroke is drawn as the nib's edge moved along the path, so
// the thick and thin fall where a pen puts them. Units: cap height 1,
// x-height ~0.52, y up from the baseline; `ADV` is each glyph's advance.

const GLYPHS = {
  T: {
    adv: 0.5,
    s: [
      // the crossbar: a wave, lifting at the left and running up to the right
      [['M', -0.02, 0.8], ['C', 0.06, 0.92, 0.24, 0.86, 0.42, 0.9], ['C', 0.56, 0.93, 0.66, 0.98, 0.74, 1.02]],
      // the stem, out of the bar a little right of its middle, leaning
      [['M', 0.36, 0.9], ['C', 0.34, 0.62, 0.31, 0.3, 0.27, 0.0]],
    ],
  },
  i: {
    adv: 0.22,
    s: [[['M', -0.02, 0.44], ['C', 0.04, 0.52, 0.09, 0.52, 0.09, 0.46], ['L', 0.06, 0.07], ['C', 0.06, 0.0, 0.13, 0.0, 0.18, 0.06]]],
    dot: [0.12, 0.69, 0.07],
  },
  m: {
    adv: 0.66,
    s: [
      [['M', 0.0, 0.44], ['C', 0.05, 0.52, 0.1, 0.52, 0.1, 0.45], ['L', 0.07, 0.0]],
      [['M', 0.09, 0.34], ['C', 0.14, 0.5, 0.29, 0.56, 0.31, 0.42], ['L', 0.28, 0.0]],
      [['M', 0.3, 0.34], ['C', 0.35, 0.5, 0.5, 0.56, 0.52, 0.42], ['L', 0.5, 0.08], ['C', 0.5, 0.0, 0.57, 0.0, 0.63, 0.07]],
    ],
  },
  ' ': { adv: 0.22, s: [] },
  H: {
    adv: 0.72,
    s: [
      // the left stem, with a lead-in from the left
      [['M', 0.0, 0.86], ['C', 0.06, 0.96, 0.15, 1.0, 0.16, 0.92], ['C', 0.15, 0.6, 0.13, 0.3, 0.1, 0.0]],
      // the right stem, taller
      [['M', 0.6, 1.02], ['C', 0.59, 0.66, 0.57, 0.32, 0.54, 0.0]],
      // the crossbar, a swash rising left to right
      [['M', 0.02, 0.42], ['C', 0.2, 0.5, 0.42, 0.48, 0.64, 0.56]],
    ],
  },
  o: {
    adv: 0.44,
    s: [[['M', 0.24, 0.5], ['C', 0.08, 0.52, 0.02, 0.3, 0.05, 0.14], ['C', 0.08, -0.04, 0.32, -0.04, 0.36, 0.18], ['C', 0.4, 0.38, 0.33, 0.52, 0.22, 0.5], ['C', 0.3, 0.5, 0.36, 0.46, 0.44, 0.47]]],
  },
  r: {
    adv: 0.34,
    s: [[['M', 0.02, 0.46], ['C', 0.06, 0.52, 0.11, 0.51, 0.11, 0.44], ['L', 0.08, 0.0]], [['M', 0.1, 0.3], ['C', 0.14, 0.46, 0.22, 0.53, 0.32, 0.46]]],
  },
  t: {
    adv: 0.3,
    s: [[['M', 0.14, 0.76], ['L', 0.1, 0.08], ['C', 0.1, 0.0, 0.18, -0.01, 0.26, 0.06]], [['M', 0.0, 0.47], ['C', 0.1, 0.5, 0.18, 0.5, 0.28, 0.51]]],
  },
  n: {
    adv: 0.46,
    s: [
      [['M', 0.0, 0.44], ['C', 0.05, 0.52, 0.1, 0.52, 0.1, 0.45], ['L', 0.07, 0.0]],
      [['M', 0.09, 0.34], ['C', 0.14, 0.5, 0.3, 0.56, 0.32, 0.42], ['L', 0.3, 0.08], ['C', 0.3, 0.0, 0.37, 0.0, 0.43, 0.07]],
    ],
  },
  s: {
    adv: 0.32,
    s: [[['M', 0.27, 0.45], ['C', 0.2, 0.53, 0.04, 0.5, 0.06, 0.38], ['C', 0.08, 0.27, 0.27, 0.27, 0.27, 0.13], ['C', 0.27, 0.0, 0.08, -0.03, -0.01, 0.07]]],
  },
};
const WORD = 'Tim Hortons';
const SLANT = 0.09;            // the script's lean (x per unit of y)
const NIB = { w: 0.15, a: 0.62, min: 0.065 };   // nib width, its angle (rad from horizontal), the hairline
const PAD = 0.12;              // round the word, in cap heights
let _box = null;
/** The word's box in cap-height units: [x0, x1, y0, y1]. */
function box() {
  if (_box) return _box;
  let x = 0;
  for (const ch of WORD) x += GLYPHS[ch].adv;
  _box = [-0.08 - PAD, x + 0.1 + PAD, -0.08 - PAD, 1.06 + PAD];
  return _box;
}
/** Width over height of the wordmark's cell (for sizing panels). */
export const TIMS_ASPECT = (() => { const b = box(); return (b[1] - b[0]) / (b[3] - b[2]); })();

function trace(g, s, ox, k, X, Y) {
  g.beginPath();
  for (const c of s) {
    if (c[0] === 'M') g.moveTo(X(c[1] + ox, c[2]) + k[0], Y(c[2]) + k[1]);
    else if (c[0] === 'L') g.lineTo(X(c[1] + ox, c[2]) + k[0], Y(c[2]) + k[1]);
    else g.bezierCurveTo(X(c[1] + ox, c[2]) + k[0], Y(c[2]) + k[1], X(c[3] + ox, c[4]) + k[0], Y(c[4]) + k[1], X(c[5] + ox, c[6]) + k[0], Y(c[6]) + k[1]);
  }
  g.stroke();
}
/**
 * Draw the wordmark filling (x, y, w, h) of canvas g (y down), centred and
 * keeping its proportions. `col` the letters; `ret` (optional) the channel
 * letters' darker returns, offset down and right.
 */
export function drawTimsWord(g, x, y, w, h, col, ret) {
  const b = box(), bw = b[1] - b[0], bh = b[3] - b[2];
  const u = Math.min(w / bw, h / bh);                      // px per cap height
  const x0 = x + (w - bw * u) / 2 - b[0] * u, y0 = y + (h + bh * u) / 2 + b[2] * u;   // the baseline's origin
  const X = (px, py) => x0 + (px + py * SLANT) * u, Y = (py) => y0 - py * u;
  g.save();
  g.lineCap = 'round'; g.lineJoin = 'round';
  const nx = Math.cos(NIB.a) * NIB.w * u / 2, ny = -Math.sin(NIB.a) * NIB.w * u / 2;
  const STEPS = 9;
  const pass = (style, dx, dy) => {
    g.strokeStyle = style; g.fillStyle = style;
    g.lineWidth = NIB.min * u;
    let ox = 0;
    for (const ch of WORD) {
      const G = GLYPHS[ch];
      for (const s of G.s) for (let i = 0; i < STEPS; i++) {
        const f = (i / (STEPS - 1)) * 2 - 1;
        trace(g, s, ox, [nx * f + dx, ny * f + dy], X, Y);
      }
      if (G.dot) {
        const [dxp, dyp, r] = G.dot;
        g.beginPath(); g.ellipse(X(dxp + ox, dyp) + dx, Y(dyp) + dy, r * u, r * u * 0.8, -0.5, 0, Math.PI * 2); g.fill();
      }
      ox += G.adv;
    }
  };
  if (ret) pass(ret, u * 0.035, u * 0.045);
  pass(col, 0, 0);
  g.restore();
  return u;
}
