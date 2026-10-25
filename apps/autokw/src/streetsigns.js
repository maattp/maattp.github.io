// Auto KW: street-name signs at the corners -- each municipality's own
// blades, the Region's flowerpot on a Regional Road's post, and the big
// street-name signs on the signals' mast arms. data/streetsigns.json comes
// from tools/kw/build_streetsigns.py (municipal boundaries, Regional Road
// numbers, Wilmot's civic numbers, downtown Kitchener's districts). See
// "Street-name signs" in apps/autokw/CLAUDE.md.
//
// What the real ones look like (checked against photos and the standards):
//   Waterloo     green blade between two 25 mm white stripes, white Clearview
//                in upper and lower case, the suffix smaller (City of Waterloo
//                standard drawing CW-611: "Daleside Pl", "Bricker Ave").
//   Kitchener    green, white border, mixed case ("Courtland Ave", "Queen St.").
//   Cambridge    green, white border, mixed case ("Ainslie St.", "Main St.").
//   downtown     white blade with an arched top, black capitals, a maroon band
//   Kitchener    with the district ("KING ST.E / MARKET DISTRICT").
//   townships    green, white border, CAPITALS ("SANDHILLS RD.", Elmira's
//                "ARTHUR ST"); Wilmot's add the civic numbers each way
//                ("<- 2982   2981 ->").
//   mast arms    Kitchener, Waterloo and Cambridge hang a big green street-name
//                sign on the signal's mast arm naming the cross street; not in
//                downtown Kitchener.
//
// Drawing, phone first:
//   - Posts, blade extrusions, the mast-arm sign's backing: the chunk's flat
//     (vertex-coloured) mesh, from meshChunk() like junctions.js's furniture.
//     No new draws; seen from far off a blade is a green bar.
//   - The lettering: ONE mesh of textured quads within LETTER_R of the camera,
//     rebuilt as the camera moves, over ONE 2048 x 1024 atlas of 64 slots
//     (512 x 64 px each) paged LRU by name: a city of ~4,000 street names
//     never needs more than the few dozen in view. A new name is drawn into a
//     512 x 64 scratch canvas and copied into its slot on the GPU
//     (copyTextureToTexture: one slot's upload, not the atlas's). One draw.

import * as THREE from './three.js';
import * as G from './geo.js';
import { CHUNK } from './citygen.js';
import { hash2 } from './util.js';
import { K_SIG } from './junctions.js';

const ON_PHONE = typeof navigator !== 'undefined' && /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
// lettering is drawn within this of the camera (a 0.2 m blade is ~2 px at 150 m
// on a phone); mast-arm signs further
const LETTER_R = ON_PHONE ? 150 : 240;
const OVER_R = ON_PHONE ? 230 : 330;
// the atlas: COLS x ROWS slots of SW x SH px
// (a phone's 150 m holds ~20 names: 32 slots, 5.6 MB with mips; desktop 64, 11 MB)
const AW = 2048, AH = ON_PHONE ? 512 : 1024, SW = 512, SH = 64, COLS = AW / SW, ROWS = AH / SH;
const ART_H = SH - 4;            // the art inside a slot (2 px gutter top and bottom)
const UPLOADS = ON_PHONE ? 2 : 8;   // new names drawn per rebuild (the rest wait a frame)
const CAP = 1600;                // lettered faces in the mesh at most
const CLUSTER = 32;              // nodes this close by a short edge are one intersection

export const STATS = { drawMs: 0, upMs: 0, siteMs: 0, gatherMs: 0, gatherMax: 0, gathers: 0, sites: 0, blades: 0, overhead: 0, shields: 0, faces: 0, keys: 0, uploads: 0, evicted: 0, skipped: 0, posts: 0, noSpot: 0, styles: {} };

// ---------------------------------------------------------------------------
// Names as the blades print them

const SUFFIX = {
  Street: 'St', Avenue: 'Ave', Drive: 'Dr', Boulevard: 'Blvd', Road: 'Rd', Crescent: 'Cres', Court: 'Crt',
  Place: 'Pl', Line: 'Line', Lane: 'Lane', Way: 'Way', Trail: 'Trail', Circle: 'Cir', Terrace: 'Terr',
  Parkway: 'Pkwy', Square: 'Sq', Gate: 'Gate', Grove: 'Grove', Heights: 'Hts', Highway: 'Hwy', Close: 'Close',
  Path: 'Path', Row: 'Row', Walk: 'Walk', Ridge: 'Ridge', Common: 'Common', Crossing: 'Xing', Hill: 'Hill',
  Point: 'Pt', Park: 'Park', Glen: 'Glen', Green: 'Green', Mews: 'Mews', Landing: 'Landing', Run: 'Run',
  Bend: 'Bend', Wood: 'Wood', Woods: 'Woods', Valley: 'Valley', View: 'View', Chase: 'Chase', Gardens: 'Gdns',
};
const DIRS = { North: 'N', South: 'S', East: 'E', West: 'W' };

/** "King Street North" -> { base: 'King', suf: 'St', dir: 'N' }. */
export function splitName(name) {
  const t = name.trim().split(/\s+/);
  let dir = '', suf = '';
  if (t.length > 1 && DIRS[t[t.length - 1]]) dir = DIRS[t.pop()];
  if (t.length > 1 && SUFFIX[t[t.length - 1]]) suf = SUFFIX[t.pop()];
  let base = t.join(' ');
  base = base.replace(/^Saint\s/, 'St. ');
  return { base, suf, dir };
}

// ---------------------------------------------------------------------------
// The designs. H: the blade's height (m); ppm follows from the slot.

const FONT = '"Helvetica Neue", Helvetica, Arial, sans-serif';
const DESIGN = {
  // Waterloo: CW-611 -- 203 mm, green 152 mm between 25 mm white stripes,
  // name 102 mm, abbreviation 76 mm, no full stops
  W: { H: 0.203, caps: false, dot: false, name: 0.102, suf: 0.076, stripes: true },
  // Kitchener and Cambridge: green with a white border, mixed case, "St."
  K: { H: 0.203, caps: false, dot: true, name: 0.102, suf: 0.072, border: true },
  // the townships (and the neighbours): green, white border, capitals
  T: { H: 0.203, caps: true, dot: true, name: 0.1, suf: 0.066, border: true },
  // Wilmot's two-row blade: the name over the civic numbers each way
  N: { H: 0.30, caps: true, dot: true, name: 0.1, suf: 0.066, border: true, nums: 0.07 },
  // downtown Kitchener: white, arched top, black capitals, the district band
  D: { H: 0.30, caps: true, dot: true, name: 0.095, suf: 0.06, district: true },
  // the mast arm's: green, white border, mixed case, ~225 mm capitals
  O: { H: 0.5, caps: false, dot: true, name: 0.225, suf: 0.165, border: true },
  OW: { H: 0.5, caps: false, dot: false, name: 0.225, suf: 0.165, border: true },
};
const GREEN = '#06663a', WHITE = '#f4f6f2';
const MIN_W = { W: 0.61, K: 0.61, T: 0.61, N: 0.76, D: 0.76, O: 1.4, OW: 1.4 };
const MAX_W = { W: 1.2, K: 1.2, T: 1.2, N: 1.4, D: 1.45, O: 2.6, OW: 2.6 };

let _mg = null;
function measure(font, s) {
  if (!_mg) _mg = document.createElement('canvas').getContext('2d');
  _mg.font = font;
  return _mg.measureText(s).width;
}

/** The lettering of one blade face: what it says and how big it is (m). */
function bladeSpec(style, name, extra) {
  const D = DESIGN[style];
  const { base, suf, dir } = splitName(name);
  const ppm = ART_H / D.H;
  const big = D.caps ? base.toUpperCase() : base;
  let small = suf ? (D.caps ? suf.toUpperCase() : suf) + (D.dot ? '.' : '') : '';
  if (dir) small += (style === 'D' ? '' : small ? ' ' : '') + dir;
  const fN = `${D.caps ? 600 : 500} ${(D.name * ppm / 0.72).toFixed(1)}px ${FONT}`;
  const fS = `${D.caps ? 600 : 500} ${(D.suf * ppm / 0.72).toFixed(1)}px ${FONT}`;
  const gap = small ? D.name * 0.35 * ppm : 0;
  let tw = measure(fN, big) + (small ? gap + measure(fS, small) : 0);
  const pad = D.H * (style === 'O' || style === 'OW' ? 0.35 : 0.45) * ppm;
  let wpx = tw + 2 * pad;
  if (extra && extra.district) wpx = Math.max(wpx, measure(`600 ${(0.034 * ppm / 0.72).toFixed(1)}px ${FONT}`, extra.district) + 2 * pad);
  let w = Math.min(MAX_W[style], Math.max(MIN_W[style], wpx / ppm));
  // the art may not outgrow the slot: past it the lettering is condensed
  w = Math.min(w, (SW - 4) / ppm);
  const key = `${style}|${big}|${small}|${extra ? (extra.district || '') + '|' + (extra.nums || '') : ''}`;
  return { style, big, small, fN, fS, gap, ppm, w, h: D.H, key, extra: extra || null };
}

function shieldSpec(num) {
  const H = 0.45, ppm = ART_H / H;
  return { style: 'S', num, ppm, w: 0.37, h: H, key: `S|${num}` };
}

// GRT's stop flags (world.js _grtStops): two shared slots for every stop in town -- the GRT
// wordmark, white on the flag's blue, and the digits 0-9, black on white, one DIG_W px cell
// each, from which a stop's number is laid a digit at a time (a face's `cu0` / `cu1`)
const DIG_W = 46;
export function grtSpec(kind) {
  if (kind === 'digits') { const h = 0.16, ppm = ART_H / h; return { style: 'GD', ppm, w: (DIG_W * 10) / ppm, h, key: 'G|digits' }; }
  const h = 0.2, ppm = ART_H / h;
  return { style: 'G', ppm, w: 150 / ppm, h, key: 'G|grt' };
}
/** The face of one digit of a stop number: [cu0, cu1] px of the digits slot. */
export function digitCell(ch) { const i = ch.charCodeAt(0) - 48; return [i * DIG_W + 3, (i + 1) * DIG_W - 3]; }
function drawGrt(g, s, W, H) {
  if (s.style === 'GD') {
    g.fillStyle = '#ffffff'; g.fillRect(0, 0, W, H);
    g.fillStyle = '#111316'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.font = `700 ${(H * 0.92).toFixed(0)}px ${FONT}`;
    for (let i = 0; i < 10; i++) g.fillText(String(i), i * DIG_W + DIG_W / 2, H * 0.54, DIG_W - 6);
    return;
  }
  g.fillStyle = '#16337f'; g.fillRect(0, 0, W, H);
  g.fillStyle = '#ffffff'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.save(); g.translate(W / 2, H * 0.53); g.transform(1, 0, -0.18, 1, 0, 0);
  g.font = `italic 800 ${(H * 0.8).toFixed(0)}px ${FONT}`;
  g.fillText('GRT', 0, 0, W - 10);
  g.restore();
}

// ---------------------------------------------------------------------------
// AUTO KW: ONTARIO'S REGULATORY SIGNS on the residential streets (world.js
// meshProps): the 40 km/h neighbourhood gateways -- Kitchener (all its
// neighbourhoods by the end of 2023) and Waterloo (2023-25) post the limit
// only where a residential street leaves a collector or arterial, as
// O. Reg. 615 s. 5.1.1 has it: the Rb-1 MAXIMUM 40 km/h, an AREA tab under
// it, and BEGINS (going in) or ENDS (coming out) under that -- and the
// no-parking signs (the red ring and slash over a black P, the arrow) down
// the block. Three shared slots, each sign laid from cells of them as GRT's
// stop numbers are (a face's `cu`), so every sign in the region costs no slot
// of its own, no material and no draw. Cells: [px0, px1, metres high] (the
// sign is 0.6 m wide, a no-parking 0.3 m: width px = 60 x w / h).
const REG = {
  max: { key: 'R|max', c: { MAX: [0, 180, 0.2], N40: [180, 280, 0.36], KMH: [280, 469, 0.19] } },
  tab: { key: 'R|tab', c: { AREA: [0, 138, 0.26], BEGINS: [138, 318, 0.2], ENDS: [318, 498, 0.2] } },
  np: { key: 'R|np', c: { NP: [0, 60, 0.3], ARL: [60, 198, 0.13], ARR: [198, 336, 0.13], ARB: [336, 474, 0.13] } },
};
const REG_SPEC = {};
for (const [k, r] of Object.entries(REG)) {
  const w = Math.max(...Object.values(r.c).map((c) => c[1]));
  REG_SPEC[k] = { style: 'R', reg: k, ppm: 1, w, h: 1, key: r.key };
}
function drawReg(g, s, W, H) {
  const R = REG[s.reg].c, B = '#111214', RED = '#c8102e';
  g.textAlign = 'center'; g.textBaseline = 'middle';
  for (const [name, [x0, x1, hm]] of Object.entries(R)) {
    const w = x1 - x0, ppm = H / hm, b = Math.max(1, 0.012 * ppm), cx = x0 + w / 2;
    g.fillStyle = '#f4f4f0'; g.fillRect(x0, 0, w, H);
    g.fillStyle = B;
    // the black border, round the whole stack: each cell draws its share
    const top = name === 'MAX' || name === 'AREA' || name === 'NP', bot = name === 'KMH' || name === 'BEGINS' || name === 'ENDS' || name[0] === 'A' && name !== 'AREA';
    g.fillRect(x0 + 1, 0, b, H); g.fillRect(x1 - 1 - b, 0, b, H);
    if (top) g.fillRect(x0 + 1, 1, w - 2, b);
    if (bot) g.fillRect(x0 + 1, H - 1 - b, w - 2, b);
    if (name === 'MAX') { g.font = `700 ${(0.085 * ppm).toFixed(0)}px ${FONT}`; g.fillText('MAXIMUM', cx, H * 0.58, w - 4 * b); }
    else if (name === 'N40') { g.font = `700 ${(0.3 * ppm).toFixed(0)}px ${FONT}`; g.fillText('40', cx, H * 0.53, w - 4 * b); }
    else if (name === 'KMH') { g.font = `700 ${(0.085 * ppm).toFixed(0)}px ${FONT}`; g.fillText('km/h', cx, H * 0.42, w - 4 * b); }
    else if (name === 'AREA') {
      g.fillRect(x0 + 1, H - 1 - b * 0.6, w - 2, b * 0.6);   // the tab's own edge
      g.font = `700 ${(0.13 * ppm).toFixed(0)}px ${FONT}`; g.fillText('AREA', cx, H * 0.54, w - 4 * b);
    } else if (name === 'BEGINS' || name === 'ENDS') { g.font = `700 ${(0.1 * ppm).toFixed(0)}px ${FONT}`; g.fillText(name, cx, H * 0.53, w - 4 * b); }
    else if (name === 'NP') {
      // the black P inside the red ring, the red slash across it
      g.font = `700 ${(0.19 * ppm).toFixed(0)}px ${FONT}`; g.fillText('P', cx, H * 0.55);
      g.strokeStyle = RED; g.lineWidth = 0.03 * ppm;
      g.beginPath(); g.arc(cx, H * 0.52, 0.115 * ppm, 0, Math.PI * 2); g.stroke();
      g.beginPath(); g.moveTo(cx - 0.081 * ppm, H * 0.52 - 0.081 * ppm); g.lineTo(cx + 0.081 * ppm, H * 0.52 + 0.081 * ppm); g.stroke();
    } else {
      // an arrow along the kerb: <-, ->, <->
      const y = H * 0.48, L = 0.1 * ppm, hd = 0.035 * ppm, sw = 0.016 * ppm;
      const l = name !== 'ARR', r = name !== 'ARL';
      g.fillRect(cx - L, y - sw / 2, 2 * L, sw);
      const head = (x, d) => { g.beginPath(); g.moveTo(x + d * hd * 1.4, y); g.lineTo(x, y - hd); g.lineTo(x, y + hd); g.closePath(); g.fill(); };
      if (l) head(cx - L, -1);
      if (r) head(cx + L, 1);
    }
  }
}

/**
 * One regulatory sign into the chunk's flat builder (post, the plates' backs)
 * and its lettered faces into `faces` (StreetSigns.setExtra): `kind` 'begins'
 * / 'ends' (the 40 km/h AREA stack) or 'np' (no parking, `arrow` -1 / 1 / 0
 * as seen by its reader: left, right, both), at ground (x, gy, z), facing
 * (fx, fz). Returns the face list's new entries' count.
 */
export function regSign(flat, faces, kind, x, gy, z, fx, fz, R, arrow = 0) {
  const rx = fz, rz = -fx, rot = Math.atan2(rz, rx);
  const plates = [];   // [cell key, slot, centre y, w, h]
  if (kind === 'np') {
    plates.push(['np', 'NP', gy + 2.17, 0.3, 0.3], ['np', arrow < 0 ? 'ARL' : arrow > 0 ? 'ARR' : 'ARB', gy + 1.955, 0.3, 0.13]);
  } else {
    let y = gy + 1.55;
    for (const [sl, c] of [['tab', kind === 'ends' ? 'ENDS' : 'BEGINS'], ['tab', 'AREA'], ['max', 'KMH'], ['max', 'N40'], ['max', 'MAX']]) {
      const h = REG[sl].c[c][2];
      plates.push([sl, c, y + h / 2, 0.6, h]);
      y += h + (c === 'AREA' || c === 'BEGINS' || c === 'ENDS' ? 0.02 : 0);
    }
  }
  const topY = Math.max(...plates.map((p) => p[2] + p[4] / 2));
  // the post: a galvanised channel, behind the plates
  flat.box(x - fx * 0.03, gy - 0.2, z - fz * 0.03, 0.06, topY - gy + 0.15, 0.05, rot, [0.58, 0.6, 0.6]);
  for (const [sl, c, cy, w, h] of plates) {
    flat.box(x, cy - h / 2, z, w, h, 0.012, rot, [0.6, 0.61, 0.62]);
    const cu = REG[sl].c[c];
    faces.push({ spec: REG_SPEC[sl], x: x + fx * 0.008, y: cy, z: z + fz * 0.008, fx, fz, R, w, h, cu: [cu[0] + 1, cu[1] - 1] });
  }
}

function rrect(g, x, y, w, h, r) {
  g.beginPath();
  g.moveTo(x + r, y); g.lineTo(x + w - r, y); g.quadraticCurveTo(x + w, y, x + w, y + r);
  g.lineTo(x + w, y + h - r); g.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  g.lineTo(x + r, y + h); g.quadraticCurveTo(x, y + h, x, y + h - r);
  g.lineTo(x, y + r); g.quadraticCurveTo(x, y, x + r, y);
  g.closePath();
}

/** Draw a spec's art into g at (0, 0), W x H px. */
function drawArt(g, s, W, H) {
  g.clearRect(0, 0, W, H);
  if (s.style === 'S') return drawShield(g, s, W, H);
  if (s.style === 'G' || s.style === 'GD') return drawGrt(g, s, W, H);
  if (s.style === 'R') return drawReg(g, s, W, H);
  const D = DESIGN[s.style];
  const ppm = s.ppm;
  let midY = H / 2;
  if (s.style === 'D') {
    // white, an arched top, a thin maroon edge, the district band
    const arch = H * 0.2;
    g.fillStyle = '#7a1420';
    g.beginPath();
    g.moveTo(0, arch); g.quadraticCurveTo(W / 2, -arch * 0.9, W, arch);
    g.lineTo(W, H); g.lineTo(0, H); g.closePath(); g.fill();
    g.fillStyle = '#f2f1ec';
    const e = 2;
    g.beginPath();
    g.moveTo(e, arch + e * 0.6); g.quadraticCurveTo(W / 2, -arch * 0.9 + e * 2, W - e, arch + e * 0.6);
    g.lineTo(W - e, H * 0.74); g.lineTo(e, H * 0.74); g.closePath(); g.fill();
    // the district, white on the band
    g.fillStyle = '#ffffff';
    g.font = `600 ${(0.034 * ppm / 0.72).toFixed(1)}px ${FONT}`;
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(s.extra.district, W / 2, H * 0.87, W - 10);
    midY = H * 0.47;
    g.fillStyle = '#16161a';
  } else {
    g.fillStyle = D.stripes ? WHITE : GREEN;
    rrect(g, 0, 0, W, H, Math.min(6, H * 0.08)); g.fill();
    if (D.stripes) {
      const st = 0.025 * ppm;
      g.fillStyle = GREEN;
      g.fillRect(0, st, W, H - 2 * st);
    } else if (D.border) {
      const b = Math.max(1.5, 0.012 * ppm);
      g.strokeStyle = WHITE; g.lineWidth = b;
      rrect(g, b * 1.2, b * 1.2, W - b * 2.4, H - b * 2.4, Math.min(5, H * 0.07)); g.stroke();
    }
    g.fillStyle = WHITE;
    if (s.style === 'N') midY = H * 0.36;
  }
  // the name and its abbreviation, sharing a baseline, centred
  const pad = s.h * 0.3 * ppm;
  const avail = W - 2 * pad;
  g.textBaseline = 'alphabetic'; g.textAlign = 'left';
  g.font = s.fN;
  const wb = g.measureText(s.big).width;
  g.font = s.fS;
  const ws = s.small ? g.measureText(s.small).width : 0;
  const tot = wb + (s.small ? s.gap + ws : 0);
  const k = tot > avail ? avail / tot : 1;     // condensed when it must be
  const capH = D.name * ppm;
  const base = midY + capH / 2;
  g.save();
  g.translate((W - tot * k) / 2, base);
  g.scale(k, 1);
  g.font = s.fN; g.fillText(s.big, 0, 0);
  if (s.small) { g.font = s.fS; g.fillText(s.small, wb + s.gap, 0); }
  g.restore();
  if (s.style === 'N' && s.extra && s.extra.nums) {
    // Wilmot: "<- 2982" left, "2981 ->" right
    const [l, r] = s.extra.nums.split('/');
    const nh = D.nums * ppm, y = H * 0.78;
    g.font = `600 ${(nh / 0.72).toFixed(1)}px ${FONT}`;
    g.textBaseline = 'middle';
    const arrow = (x, dir) => {
      const a = nh * 0.9;
      g.beginPath();
      g.moveTo(x, y); g.lineTo(x + dir * a * 0.55, y - a * 0.42); g.lineTo(x + dir * a * 0.55, y - a * 0.14);
      g.lineTo(x + dir * a * 1.25, y - a * 0.14); g.lineTo(x + dir * a * 1.25, y + a * 0.14);
      g.lineTo(x + dir * a * 0.55, y + a * 0.14); g.lineTo(x + dir * a * 0.55, y + a * 0.42); g.closePath();
      g.fill();
    };
    const m = pad * 0.8;
    if (l) { arrow(m, 1); g.textAlign = 'left'; g.fillText(l, m + nh * 1.35, y); }
    if (r) { arrow(W - m, -1); g.textAlign = 'right'; g.fillText(r, W - m - nh * 1.35, y); }
  }
}

/** The Region's flowerpot: white, black edge, WATERLOO / the number / REGION. */
function drawShield(g, s, W, H) {
  const cx = W / 2, top = 1, h = H - 2, w = W - 2, x0 = 1;
  g.beginPath();
  g.moveTo(x0, top + h * 0.08);
  g.quadraticCurveTo(x0, top, x0 + w * 0.12, top);
  g.lineTo(x0 + w * 0.88, top);
  g.quadraticCurveTo(x0 + w, top, x0 + w, top + h * 0.08);
  g.quadraticCurveTo(x0 + w * 0.92, top + h * 0.24, x0 + w * 0.8, top + h * 0.32);
  g.lineTo(x0 + w * 0.8, top + h * 0.76);
  g.quadraticCurveTo(x0 + w * 0.8, top + h, cx, top + h);
  g.quadraticCurveTo(x0 + w * 0.2, top + h, x0 + w * 0.2, top + h * 0.76);
  g.lineTo(x0 + w * 0.2, top + h * 0.32);
  g.quadraticCurveTo(x0 + w * 0.08, top + h * 0.24, x0, top + h * 0.08);
  g.closePath();
  g.fillStyle = '#ffffff'; g.fill();
  g.lineWidth = 1.6; g.strokeStyle = '#111'; g.stroke();
  g.fillStyle = '#111'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.font = `700 ${(h * 0.12).toFixed(1)}px ${FONT}`;
  g.fillText('WATERLOO', cx, top + h * 0.14, w * 0.86);
  g.font = `700 ${(s.num.length >= 3 ? h * 0.3 : h * 0.4).toFixed(1)}px ${FONT}`;
  g.fillText(s.num, cx, top + h * 0.55, w * 0.56);
  g.font = `700 ${(h * 0.1).toFixed(1)}px ${FONT}`;
  g.fillText('REGION', cx, top + h * 0.87, w * 0.5);
}

// ---------------------------------------------------------------------------

// (the chunk's flat mesh takes colours as junctions.js gives them)
const POST_STEEL = [0.55, 0.57, 0.58], POST_WOOD = [0.58, 0.47, 0.33];
const BLADE_BODY = { W: [0.04, 0.3, 0.16], K: [0.04, 0.3, 0.16], T: [0.04, 0.3, 0.16], N: [0.04, 0.3, 0.16], D: [0.8, 0.8, 0.77], O: [0.04, 0.3, 0.16], OW: [0.04, 0.3, 0.16] };
const BACKING = [0.55, 0.57, 0.58];
const T = 0.02;   // a blade's thickness

function pip(ring, x, z) {
  let c = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, zi] = ring[i], [xj, zj] = ring[j];
    if ((zi > z) !== (zj > z) && x < (xj - xi) * (z - zi) / (zj - zi) + xi) c = !c;
  }
  return c;
}

export class StreetSigns {
  constructor(city, data) {
    this.city = city;
    this.data = data;
    this.munis = (data.munis || []).map((m) => {
      let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
      for (const r of m.r) for (const [x, z] of r) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z); }
      return { n: m.n, r: m.r, b: [x0, x1, z0, z1] };
    });
    this.rr = data.rr || {};
    this.addr = data.addr || {};
    this.dtk = data.dtk || [];
    this.byChunk = new Map();    // chunk key -> sites
    this.extra = new Map();      // chunk key -> other lettered sites (world.js: GRT's stop flags)
    this.mesh = null;
  }

  muniAt(x, z) {
    for (const m of this.munis) {
      const b = m.b;
      if (x < b[0] || x > b[1] || z < b[2] || z > b[3]) continue;
      for (const r of m.r) if (pip(r, x, z)) return m.n;
    }
    return null;
  }

  /** The blade design at (x, z), and downtown Kitchener's district if in one. */
  styleAt(x, z) {
    const m = this.muniAt(x, z);
    if (m === 'Waterloo') return { s: 'W', o: 'OW', m };
    if (m === 'Kitchener') {
      for (const d of this.dtk) if ((x - d.x) ** 2 + (z - d.z) ** 2 < d.r * d.r) return { s: 'D', o: null, m, district: d.d };
      return { s: 'K', o: 'O', m };
    }
    if (m === 'Cambridge') return { s: 'K', o: 'O', m };
    return { s: m === 'Wilmot' ? 'N' : 'T', o: 'O', m: m || '?' };
  }

  /** The Regional Road number a street carries at (x, z), or null. */
  rrAt(name, x, z) {
    const L = this.rr[name];
    if (!L) return null;
    let best = 120 * 120, num = null;
    for (const p of L) {
      const d = (p[0] - x) ** 2 + (p[1] - z) ** 2;
      if (d < best) { best = d; num = p[2]; }
    }
    return num;
  }

  /** Wilmot: the nearest civic number on `name` each way along (ax, az) from (x, z). */
  numsAt(name, x, z, ax, az) {
    const L = this.addr[name];
    if (!L) return null;
    let lt = Infinity, rt = Infinity, ln = '', rn = '';
    for (const p of L) {
      const dx = p[0] - x, dz = p[1] - z;
      const t = dx * ax + dz * az, q = Math.abs(dx * -az + dz * ax);
      if (q > 70 || Math.abs(t) > 2500) continue;
      if (t > 8 && t < rt) { rt = t; rn = String(p[2]); }
      if (t < -8 && -t < lt) { lt = -t; ln = String(p[2]); }
    }
    return ln || rn ? [ln, rn] : null;
  }

  // --- the corners ---------------------------------------------------------

  /** Sites (posts with their blades, mast-arm signs) of chunk (cx, cz), worked out once. */
  /** Lettered sites another drawer put in chunk (cx, cz) ({ x, z, faces }), replacing its last ones. */
  // (`tag`: each drawer keeps its own list a chunk -- GRT's stops, the regulatory signs)
  setExtra(cx, cz, sites, tag = 'grt') {
    const k = this.city.chunkKey(cx, cz);
    let m = this.extra.get(k);
    if (sites && sites.length) { if (!m) this.extra.set(k, (m = new Map())); m.set(tag, sites); }
    else if (m) { m.delete(tag); if (!m.size) this.extra.delete(k); }
  }

  sitesIn(cx, cz) {
    const city = this.city, ck = city.chunkKey(cx, cz);
    let S = this.byChunk.get(ck);
    if (S) return S;
    S = [];
    this.byChunk.set(ck, S);
    const ch = city.chunks.get(ck);
    if (!ch) return S;
    const t0 = performance.now();
    const seen = new Set();
    for (const ei of ch.edges) {
      const e = city.edges[ei];
      for (const ni of [e.a, e.b]) {
        if (seen.has(ni)) continue;
        seen.add(ni);
        const n = city.nodes[ni];
        if (Math.floor(n.x / CHUNK) !== cx || Math.floor(n.z / CHUNK) !== cz) continue;
        try { this.site(ni, S); } catch (err) { STATS.err = String(err && err.stack || err).slice(0, 300); }
      }
    }
    STATS.siteMs += performance.now() - t0;
    return S;
  }

  /** Is node ni a junction a blade could stand at? */
  junctionNode(ni) {
    const city = this.city, n = city.nodes[ni];
    if (n.elev || n.e.length < 3) return false;
    const jc = city.jc;
    for (const ei of n.e) {
      const e = city.edges[ei];
      if (e.tunnel || e.elev || e.cls === 'hwy' || e.cls === 'ramp') return false;
      if (jc && jc.ring[ei]) return false;
    }
    return true;
  }

  site(ni, out) {
    const city = this.city;
    if (!this.junctionNode(ni)) return;
    // the intersection: junction nodes joined by short edges (a divided road
    // crossed is two or four nodes); it is drawn once, by its lowest node
    const cl = [ni], inC = new Set([ni]);
    for (let k = 0; k < cl.length && cl.length < 6; k++) {
      for (const ei of city.nodes[cl[k]].e) {
        const e = city.edges[ei];
        if (e.len > CLUSTER) continue;
        const o = e.a === cl[k] ? e.b : e.a;
        if (inC.has(o) || !this.junctionNode(o)) continue;
        inC.add(o); cl.push(o);
      }
    }
    for (const o of cl) if (o < ni) return;
    let cxm = 0, czm = 0;
    for (const o of cl) { cxm += city.nodes[o].x; czm += city.nodes[o].z; }
    cxm /= cl.length; czm /= cl.length;
    // its arms: edges leaving it, with a name
    const arms = [];
    let big = false, sig = null;
    const jc = city.jc;
    for (const o of cl) {
      const n = city.nodes[o];
      if (jc && jc.ctl[o] >= 0) { const C = jc.list[jc.ctl[o]]; if (C && C.k === K_SIG) sig = C; }
      for (const ei of n.e) {
        const e = city.edges[ei];
        const far = e.a === o ? e.b : e.a;
        if (inC.has(far)) continue;
        if (!e.name) continue;
        const dx = e.a === o ? e.dx : -e.dx, dz = e.a === o ? e.dz : -e.dz;
        arms.push({ ei, e, name: e.name, base: splitName(e.name).base, dx, dz, ang: Math.atan2(dz, dx), hw: e.hw, rural: !!e.rural });
        if (e.cls === 'art' || e.cls === 'st') big = true;
      }
    }
    if (arms.length < 2) return;
    const bases = new Set(arms.map((a) => a.base));
    if (bases.size < 2) return;
    arms.sort((a, b) => a.ang - b.ang);
    const st = this.styleAt(cxm, czm);
    STATS.styles[st.s] = (STATS.styles[st.s] || 0) + 1;
    const site = { x: cxm, z: czm, posts: [], faces: [], style: st, names: [...new Set(arms.map((a) => a.name))], arms };
    // corners between neighbouring arms of different streets
    const corners = [];
    for (let i = 0; i < arms.length; i++) {
      const A = arms[i], B = arms[(i + 1) % arms.length];
      let gap = B.ang - A.ang;
      if (gap <= 0) gap += Math.PI * 2;
      if (A.base === B.base || gap < 0.6 || gap > 3.5) continue;
      const bis = A.ang + gap / 2;
      corners.push({ A, B, gap, bx: Math.cos(bis), bz: Math.sin(bis) });
    }
    if (!corners.length) return;
    if (sig) {
      // a signal: the blades go on its poles, and a big sign on each mast arm
      const rigs = jc.rigs(sig);
      if (rigs.length) {
        const r0 = rigs[0];
        let r1 = null, dm = 0;
        for (const r of rigs) { const d = (r.x - r0.x) ** 2 + (r.z - r0.z) ** 2; if (d > dm) { dm = d; r1 = r; } }
        for (const r of [r0, r1]) {
          if (!r || (r === r1 && dm < 100)) continue;
          this.postAt(site, arms, r.x, r.z, r.y, 'pole');
        }
        if (st.o) for (const r of rigs) this.mastSign(site, arms, r, st);
      }
    } else {
      // one corner, or two diagonally opposite where a street is a through one
      const h = hash2(Math.round(cxm), Math.round(czm));
      const c0 = corners[Math.floor(h * corners.length) % corners.length];
      const pick = [c0];
      if (big && corners.length > 1) {
        let best = null, bd = 2;
        for (const c of corners) { const d = c.bx * c0.bx + c.bz * c0.bz; if (d < bd) { bd = d; best = c; } }
        if (best && bd < -0.3) pick.push(best);
      }
      for (const c of pick) {
        const p = this.cornerSpot(cxm, czm, c);
        if (!p) { STATS.noSpot++; continue; }
        const gy = G.terrainHeight(p[0], p[1]) + Math.max(0, city.roadLift(p[0], p[1]));
        this.postAt(site, arms, p[0], p[1], gy, st.s === 'T' || st.s === 'N' ? 'wood' : 'steel');
      }
    }
    if (!site.posts.length && !site.over) return;
    out.push(site);
    STATS.sites++;
  }

  /** A corner's post: off every carriageway, out of buildings, on the bisector. */
  cornerSpot(x, z, c) {
    const city = this.city;
    const s = Math.max(0.35, Math.sin(c.gap / 2));
    const r0 = Math.min(26, (Math.max(c.A.hw, c.B.hw) + (c.A.rural || c.B.rural ? 2.4 : 1.6)) / s);
    for (let k = 0; k < 24; k++) {
      const r = r0 + k * 0.6;
      for (const j of [0, 0.15, -0.15, 0.3, -0.3]) {
        const bx = c.bx * Math.cos(j) - c.bz * Math.sin(j), bz = c.bx * Math.sin(j) + c.bz * Math.cos(j);
        const px = x + bx * r, pz = z + bz * r;
        if (city.onRoad(px, pz, 0.7, false, false)) continue;
        if (city.insideBuilding(px, pz, G.terrainHeight(px, pz) + 1, 0.6)) continue;
        if (!G.isBuildable(px, pz)) continue;
        return [px, pz];
      }
    }
    return null;
  }

  /** The two arms either side of the direction from the centre to (px, pz). */
  sides(site, arms, px, pz) {
    const a = Math.atan2(pz - site.z, px - site.x);
    for (let i = 0; i < arms.length; i++) {
      const A = arms[i], B = arms[(i + 1) % arms.length];
      let gap = B.ang - A.ang; if (gap <= 0) gap += Math.PI * 2;
      let d = a - A.ang; while (d < 0) d += Math.PI * 2; while (d >= Math.PI * 2) d -= Math.PI * 2;
      if (d <= gap) return [A, B];
    }
    return [arms[0], arms[1]];
  }

  /** A post at (px, pz) with a blade for each of its corner's two streets. */
  postAt(site, arms, px, pz, gy, kind) {
    let [A, B] = this.sides(site, arms, px, pz);
    if (A.base === B.base) {
      const o = arms.find((q) => q.base !== A.base);
      if (!o) return;
      B = o;
    }
    const st = site.style;
    const post = { x: px, z: pz, y: gy, kind, blades: [], shields: [] };
    // upper blade: the arm with the larger class's street; heights by mount
    const order = [A, B];
    const y0 = kind === 'pole' ? 4.35 : kind === 'wood' ? 2.3 : 2.62;
    order.forEach((arm, i) => {
      // parallel to its street, read by traffic on the other
      const ax = arm.dx, az = arm.dz;
      let extra = null;
      if (st.s === 'D') extra = { district: st.district };
      let style = st.s;
      if (style === 'N') {
        const nums = this.numsAt(arm.name, px, pz, ax, az);
        if (nums) extra = { nums: nums.join('/') }; else style = 'T';
      }
      const spec = bladeSpec(style, arm.name, extra);
      const yc = gy + y0 + i * (spec.h + 0.03) + spec.h / 2;
      // centred on a post's cap; cantilevered off a pole's or a wooden post's side
      let cx = px, cz = pz;
      if (kind !== 'steel') {
        const sgn = (site.x - px) * ax + (site.z - pz) * az >= 0 ? 1 : -1;
        const off = spec.w / 2 + (kind === 'pole' ? 0.17 : 0.06);
        cx += ax * sgn * off; cz += az * sgn * off;
        // the other blade on the post's other face
        const nx = -az, nz = ax;
        cx += nx * (i ? 1 : -1) * (kind === 'pole' ? 0 : 0.055);
        cz += nz * (i ? 1 : -1) * (kind === 'pole' ? 0 : 0.055);
      }
      const bl = { x: cx, y: yc, z: cz, ax, az, w: spec.w, h: spec.h, style };
      post.blades.push(bl);
      // both faces; Wilmot's numbers swap sides on the back
      const nx = -az, nz = ax;
      this.face(site, spec, cx + nx * (T / 2 + 0.003), yc, cz + nz * (T / 2 + 0.003), nx, nz, LETTER_R);
      let back = spec;
      if (style === 'N' && extra && extra.nums) {
        const [l, r] = extra.nums.split('/');
        back = bladeSpec(style, arm.name, { nums: `${r}/${l}` });
      }
      this.face(site, back, cx - nx * (T / 2 + 0.003), yc, cz - nz * (T / 2 + 0.003), -nx, -nz, LETTER_R);
      STATS.blades++;
      // a Regional Road: the flowerpot on the post, under the blades
      const num = kind !== 'pole' ? this.rrAt(arm.name, px, pz) : null;
      if (num) {
        const sp = shieldSpec(num);
        const k = post.shields.length;
        const sy = gy + y0 - 0.08 - sp.h / 2 - k * (sp.h + 0.05);
        // bolted to the post's face toward the junction (one-sided, as the
        // Region's markers are), clear of the post
        const sg = (site.x - px) * nx + (site.z - pz) * nz >= 0 ? 1 : -1;
        const fx = nx * sg, fz = nz * sg, off = kind === 'wood' ? 0.06 : 0.045;
        const sx = px + fx * off, sz = pz + fz * off;
        post.shields.push({ x: sx, y: sy, z: sz, ax, az, w: sp.w, h: sp.h });
        this.face(site, sp, sx + fx * 0.009, sy, sz + fz * 0.009, fx, fz, LETTER_R);
        STATS.shields++;
      }
    });
    post.top = gy + y0 + post.blades.length * 0.24 + 0.05;
    site.posts.push(post);
    STATS.posts++;
  }

  /** The street-name sign on a signal's mast arm: the cross street, facing the approach. */
  mastSign(site, arms, rig, st) {
    const { x, y, z, ux, uz, rx, rz, mast } = rig;
    // the cross street: the arm to the right of the approach (the pole's side), else left
    let best = null, bv = 0.45;
    for (const a of arms) { const v = a.dx * rx + a.dz * rz; if (v > bv) { bv = v; best = a; } }
    if (!best) { bv = 0.45; for (const a of arms) { const v = -(a.dx * rx + a.dz * rz); if (v > bv) { bv = v; best = a; } } }
    if (!best) return;
    const spec = bladeSpec(st.o, best.name, null);
    // a free stretch of the arm, from the pole out, clear of the heads
    const hd = [];
    for (const h of rig.heads) if (h.kind !== 6 && h.y > y + 4.5) hd.push((x - h.x) * rx + (z - h.z) * rz);
    let d0 = 0.75;
    for (let k = 0; k < 40; k++) {
      const a = d0, b = d0 + spec.w;
      const hit = hd.find((d) => d > a - 0.35 && d < b + 0.35);
      if (hit === undefined) break;
      d0 = hit + 0.4;
    }
    if (d0 + spec.w > mast - 0.15) return;
    const dc = d0 + spec.w / 2;
    const cx = x - rx * dc, cz = z - rz * dc, cy = y + 6.33 - spec.h / 2;
    (site.over || (site.over = [])).push({ x: cx, y: cy, z: cz, ax: rx, az: rz, w: spec.w, h: spec.h, fx: -ux, fz: -uz });
    this.face(site, spec, cx - ux * 0.026, cy, cz - uz * 0.026, -ux, -uz, OVER_R);
    STATS.overhead++;
  }

  /** A lettered face: centre, normal (fx, fz), size from the spec. */
  face(site, spec, x, y, z, fx, fz, R) {
    site.faces.push({ spec, x, y, z, fx, fz, R });
  }

  // --- the chunk's flat mesh: posts, blade bodies, backings ------------------
  meshChunk(world, flat, cx, cz, lod) {
    if (lod !== 1) return;
    const city = this.city;
    for (const site of this.sitesIn(cx, cz)) {
      for (const p of site.posts) {
        const f0 = flat.ni;
        if (p.kind === 'steel') {
          flat.prism(p.x, p.y - 0.2, p.z, 0.032, p.top - p.y + 0.2, 6, POST_STEEL);
          flat.prism(p.x, p.top, p.z, 0.045, 0.05, 6, [0.3, 0.31, 0.32]);
        } else if (p.kind === 'wood') {
          const rot = p.blades.length ? Math.atan2(p.blades[0].az, p.blades[0].ax) : 0;
          flat.box(p.x, p.y - 0.3, p.z, 0.09, p.top - p.y + 0.3, 0.09, rot, POST_WOOD);
        }
        for (const b of p.blades) {
          flat.box(b.x, b.y - b.h / 2, b.z, b.w, b.h, T, Math.atan2(b.az, b.ax), BLADE_BODY[b.style] || BLADE_BODY.K);
          if (p.kind === 'steel') flat.box(p.x, b.y - b.h / 2 - 0.02, p.z, 0.07, b.h + 0.04, 0.07, Math.atan2(b.az, b.ax), [0.35, 0.36, 0.37]);
        }
        for (const s of p.shields) flat.box(s.x, s.y - s.h / 2, s.z, s.w * 0.62, s.h * 0.98, 0.012, Math.atan2(s.az, s.ax), BACKING);
        if (p.kind !== 'pole') {
          city.addObstacle(world._ck, p.x, p.z, 0.1);
          if (world._fell) world._fell.push(p.x, p.z, f0, flat.ni);
        }
      }
      if (site.over) for (const o of site.over) {
        // the sign's aluminium back and its two clamps to the arm
        flat.box(o.x - o.fx * 0.012, o.y - o.h / 2, o.z - o.fz * 0.012, o.w, o.h, 0.025, Math.atan2(o.az, o.ax), BACKING);
        for (const s of [-0.3, 0.3]) flat.box(o.x + o.ax * s * o.w - o.fx * 0.03, o.y + o.h / 2 - 0.02, o.z + o.az * s * o.w - o.fz * 0.03, 0.05, 0.12, 0.05, 0, BACKING);
      }
    }
  }

  // --- the lettering ----------------------------------------------------------
  attach(scene, renderer, world) {
    this.world = world;
    this.renderer = renderer;
    const c = document.createElement('canvas');
    c.width = AW; c.height = AH;
    this.atlas = new THREE.CanvasTexture(c);
    this.atlas.colorSpace = THREE.SRGBColorSpace;
    this.atlas.anisotropy = 4;
    this.atlas.minFilter = THREE.LinearMipmapLinearFilter;
    this.scratch = document.createElement('canvas');
    this.scratch.width = SW; this.scratch.height = SH;
    this.sg = this.scratch.getContext('2d');
    this.src = new THREE.CanvasTexture(this.scratch);
    this.src.colorSpace = THREE.SRGBColorSpace;
    // the CPU fallback (no copyTextureToTexture): draw into the atlas's canvas
    this.ag = c.getContext('2d');
    if (renderer && renderer.initTexture) renderer.initTexture(this.atlas);
    this.slots = [];
    for (let i = 0; i < COLS * ROWS; i++) this.slots.push({ key: null, used: -1, x: (i % COLS) * SW, y: Math.floor(i / COLS) * SH });
    this.keySlot = new Map();
    this.stamp = 0;
    const g = new THREE.BufferGeometry();
    this.pos = new Float32Array(CAP * 12);
    this.uv = new Float32Array(CAP * 8);
    const idx = new Uint16Array(CAP * 6);
    for (let i = 0; i < CAP; i++) {
      const v = i * 4;
      idx.set([v, v + 1, v + 2, v, v + 2, v + 3], i * 6);
    }
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('uv', new THREE.BufferAttribute(this.uv, 2).setUsage(THREE.DynamicDrawUsage));
    g.setIndex(new THREE.BufferAttribute(idx, 1));
    g.setDrawRange(0, 0);
    const m = new THREE.MeshBasicMaterial({ map: this.atlas, alphaTest: 0.5, color: new THREE.Color(0.86, 0.86, 0.86), toneMapped: false });
    m.userData.noShadow = true;
    this.mesh = new THREE.Mesh(g, m);
    this.mesh.name = 'streetsigns';
    this.mesh.frustumCulled = false;
    this.mesh.castShadow = false; this.mesh.receiveShadow = false;
    this.mesh.matrixAutoUpdate = false;
    scene.add(this.mesh);
    this._t = 1e9;
    this._g = null;
  }

  /** A slot for this art (drawn now if it is new), or null when out of room/time. */
  slotFor(spec, budget) {
    let s = this.keySlot.get(spec.key);
    if (s) { s.used = this.stamp; return s; }
    if (budget.n <= 0) { budget.short = true; return null; }
    // a free slot, else the least recently used one not needed this time round
    let pick = null;
    for (const q of this.slots) {
      if (!q.key) { pick = q; break; }
      if (q.used !== this.stamp && (!pick || q.used < pick.used)) pick = q;
    }
    if (!pick) { STATS.skipped++; return null; }
    if (pick.key) { this.keySlot.delete(pick.key); STATS.evicted++; }
    pick.key = spec.key; pick.used = this.stamp;
    // the art's own width in the slot
    pick.wpx = Math.min(SW - 4, Math.max(8, Math.round(spec.w * spec.ppm)));
    this.keySlot.set(spec.key, pick);
    budget.n--;
    STATS.uploads++;
    const g = this.sg;
    g.clearRect(0, 0, SW, SH);
    const t0 = performance.now();
    g.save(); g.translate(2, 2);
    drawArt(g, spec, pick.wpx, ART_H);
    g.restore();
    STATS.drawMs += performance.now() - t0;
    budget.drawn.push(pick);
    return pick;
  }

  /** The scratch canvas into its slot; `mips`: rebuild the atlas's mip chain after. */
  upload(slot, mips) {
    const r = this.renderer, t0 = performance.now();
    if (r && r.copyTextureToTexture) {
      // GL rows count up from the bottom (flipY): slot row k from the top.
      // The mip chain is regenerated once per rebuild, on its last upload.
      this._v2 = this._v2 || new THREE.Vector2();
      this._v2.set(slot.x, AH - slot.y - SH);
      this.atlas.generateMipmaps = !!mips;
      r.copyTextureToTexture(this._v2, this.src, this.atlas);
      this.atlas.generateMipmaps = true;
    } else {
      this.ag.clearRect(slot.x, slot.y, SW, SH);
      this.ag.drawImage(this.scratch, slot.x, slot.y);
      this.atlas.needsUpdate = true;
    }
    STATS.upMs += performance.now() - t0;
  }

  /** Rebuild the lettered quads round the camera. */
  gather(px, pz) {
    const world = this.world, city = this.city;
    this.stamp++;
    const faces = [];
    const R = Math.max(LETTER_R, OVER_R);
    const c0 = Math.floor((px - R) / CHUNK), c1 = Math.floor((px + R) / CHUNK);
    const d0 = Math.floor((pz - R) / CHUNK), d1 = Math.floor((pz + R) / CHUNK);
    for (let cx = c0; cx <= c1; cx++) for (let cz = d0; cz <= d1; cz++) {
      const wc = world && world.chunks && world.chunks.get(city.chunkKey(cx, cz));
      if (!wc || wc.lod !== 1 || !wc.group) continue;
      const X = this.extra.get(city.chunkKey(cx, cz));
      for (const L of [this.sitesIn(cx, cz), ...(X ? X.values() : [])]) if (L) for (const site of L) {
        const d2 = (site.x - px) ** 2 + (site.z - pz) ** 2;
        if (d2 > R * R) continue;
        for (const f of site.faces) if (d2 < f.R * f.R) faces.push([d2, f]);
      }
    }
    faces.sort((a, b) => a[0] - b[0]);
    const budget = { n: UPLOADS, short: false, drawn: [] };
    let last = null;
    let q = 0;
    const P = this.pos, U = this.uv;
    for (const [, f] of faces) {
      if (q >= CAP) break;
      const s = this.slotFor(f.spec, budget);
      if (budget.drawn.length) { last = budget.drawn.pop(); this.upload(last, budget.n === 0); if (budget.n === 0) last = null; }
      if (!s) continue;
      const sp = f.spec;
      const rx = f.fz, rz = -f.fx;   // the face's right, as its reader sees it
      // (a face may take its own size and a part of its slot's art: a stop number's digit)
      const hw = (f.w || sp.w) / 2, hh = (f.h || sp.h) / 2;
      const o = q * 12;
      // bottom-left, bottom-right, top-right, top-left
      P[o] = f.x - rx * hw; P[o + 1] = f.y - hh; P[o + 2] = f.z - rz * hw;
      P[o + 3] = f.x + rx * hw; P[o + 4] = f.y - hh; P[o + 5] = f.z + rz * hw;
      P[o + 6] = f.x + rx * hw; P[o + 7] = f.y + hh; P[o + 8] = f.z + rz * hw;
      P[o + 9] = f.x - rx * hw; P[o + 10] = f.y + hh; P[o + 11] = f.z - rz * hw;
      const u0 = f.cu ? (s.x + 2 + f.cu[0]) / AW : (s.x + 2.5) / AW, u1 = f.cu ? (s.x + 2 + f.cu[1]) / AW : (s.x + 2 + s.wpx - 0.5) / AW;
      const vb = (AH - s.y - 2 - ART_H + 0.5) / AH, vt = (AH - s.y - 2 - 0.5) / AH;
      const t = q * 8;
      U[t] = u0; U[t + 1] = vb; U[t + 2] = u1; U[t + 3] = vb;
      U[t + 4] = u1; U[t + 5] = vt; U[t + 6] = u0; U[t + 7] = vt;
      q++;
    }
    // the mips once, after the last new name (the scratch still holds it)
    if (last) this.upload(last, true);
    const g = this.mesh.geometry;
    g.setDrawRange(0, q * 6);
    g.attributes.position.needsUpdate = true;
    g.attributes.uv.needsUpdate = true;
    STATS.faces = q;
    STATS.keys = this.keySlot.size;
    return budget.short;
  }

  update(cam, dt) {
    if (!this.mesh || !cam) return;
    this._t += dt;
    const x = cam.position.x, z = cam.position.z;
    if (this._more || this._t > 0.5 || !this._g || Math.hypot(x - this._g[0], z - this._g[1]) > 25) {
      this._t = 0; this._g = [x, z];
      const t0 = performance.now();
      this._more = this.gather(x, z);
      const ms = performance.now() - t0;
      STATS.gatherMs += ms; STATS.gathers++; STATS.gatherMax = Math.max(STATS.gatherMax, ms);
    }
  }
}

/** Boot: the street-name signs over the city (null without the data). */
export function prepStreetSigns(city, data) {
  if (!data || !data.munis) return null;
  const s = new StreetSigns(city, data);
  city.streetSigns = s;
  return s;
}
