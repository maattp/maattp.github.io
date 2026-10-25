// THE BIG EMPLOYERS' SIGNS (the landmarks pass, round six; kwlandmarks2.js runs
// it with its LmKit, so nothing here costs a draw): the corporate signage a
// driver reads in Waterloo Region, as big as the real ones and where they
// really are, logo and wordmark in the real colours.
//
//   - BLACKBERRY (2200-2300 University Ave E): the seven-key logo and the
//     italic wordmark in BlackBerry blue on the white top band of A, B and C,
//     toward the end of each long face (Commons "BlackBerry Limited Waterloo
//     Campus" / "... Headquarters", 2018).
//   - SUN LIFE (227 King St S): the tower is 18 storeys, 78 m (CTBUH; it was a
//     33 m box), and the gold sun and "Sun Life" ride its crown on the faces
//     toward Uptown, King St and the south (Commons, 2008 and 2012: the
//     crown then read "Sun Life Financial"; the brand has been "Sun Life"
//     since 2015 -- that wording is an estimate).
//   - MANULIFE (500 King St N): the green three-bar mark and the serif
//     wordmark on the top band, toward King St, the car park and the
//     expressway (aerial photographs of the building in the press).
//   - OPENTEXT (275 Frank Tompa Dr): Buildings 1 and 2 redrawn -- white
//     spandrel bands and blue-grey glass -- "opentext" in dark lowercase
//     letters on the top of both, and the grey monument by the drive.
//   - EQUITABLE (1 Westmount Rd N): the beige three-storey block on the
//     corner of Erb St, the teal knot and "Equitable" at the north end of
//     the Westmount Rd face, the two teal "e" banners (Commons, 2025).
//   - CHRISTIE (809 Wellington St N): the grey plant with CHRISTIE high on
//     its Wellington St face, and the fieldstone wall with the brushed-steel
//     CHRISTIE letters by the entrance (press photographs).
//   - DARE (2481 Kingsway Dr): the red oval with the gold rim and the white
//     "Dare" on a raised white panel over the north end (toward Kingsway Dr,
//     the expressway's sign gantries beyond) and near the north end of the
//     west face (Eighth Ave), and the precast monument "Dare Foods Limited /
//     2481 Kingsway Drive" on Kingsway (press photographs).
//   - WATERLOO BREWING (400 Bingemans Centre Dr): the red pointed banner
//     WATERLOO BREWING with its wheat ears over the buff front and the red
//     COLD BEER STORE fascia under it (Commons "Waterloo Brewing - cold beer
//     store", 2017).
//   - GORE MUTUAL (252 Dundas St N, Cambridge): the dark stone head office
//     with GORE MUTUAL and the red mark on it, the granite ground sign by
//     Dundas St, and the 1935 limestone building beside it under its copper
//     roof. Its cell has no sign cluster, so these letters are geometry
//     (`pixSign`: a canvas read back into vertex-coloured quads) in the
//     footprint material of the cluster next door (11,8, 58 m away).
//
// WHERE THE LETTERS GO. On the shared sign atlas, in the `kw` sign cluster
// of the building's own cell, only where that cluster's bounding sphere
// already reaches the sign (Sun Life, OpenText, Dare) or the cluster is the
// building's own (BlackBerry's campus, Manulife's -- every Manulife sign is
// keyed to the building's cell, though its King St face is across the cell
// line). Equitable's, Christie's and Waterloo Brewing's nearest sign
// clusters are 280-370 m off: a letter there swelled them (kw-4,-1 248 ->
// 587 m, kw2,-2 15 -> 491 m), and they came into views they were not in.
// Those are `PIX` geometry in the footprint material of their own cell,
// whose sphere already holds them -- as Gore Mutual's.
//
// Lit at night: the atlas wall signs are drawn between the shared atlas's
// litBegin() / litEnd() (landmarks.js SignAtlas): those rows keep their
// colour after dark while the rest of the atlas dims (weather.js TOD_BASIC,
// `todLitV`) -- in the same material. The monuments, and the geometry
// letters (Equitable, Christie, Waterloo Brewing, Gore Mutual), are not lit.
//
// ESTIMATED: every colour (read off photographs); each sign's size (scaled
// off the photographs against the storeys); which end of a face each sits
// at where no photograph shows it (Equitable's north end, Dare's north
// block, Christie's and Gore's wall signs); Sun Life's crown wording;
// OpenText's monument place and the lettering of every monument.

import { hang, lin, shade, hex, SANS, SERIF, U0, T, street, obb } from './kwplaces.js';
import { block, frontEdge, onWall, B4, hipRoof } from './kwsights.js';

const C = (h) => lin(hex(h));
const P = {};          // the panels, drawn once (bizPanels), cloned onto each wall
export const BIZ = { signs: [], err: [] };

// ---------------------------------------------------------------------------------------
// the logos (2D canvas painters)
// ---------------------------------------------------------------------------------------

/** BlackBerry's seven keys, `u` high a key, from (x, y) its top left. */
function bbKeys(q, x, y, u, col) {
  q.save(); q.fillStyle = col;
  q.translate(x, y); q.transform(1, 0, -0.22, 1, 0, 0);
  const K = [[0, 0], [1, 0], [-0.1, 1], [0.9, 1], [2.05, 0.55], [0.8, 2], [1.95, 1.55]];
  for (const [a, b] of K) {
    const px = a * u * 1.12 + u * 0.4, py = b * u * 0.78, w = u * 0.62, h = u * 0.6, r = h / 2;
    q.beginPath(); q.moveTo(px, py); q.lineTo(px + w - r, py);
    q.arc(px + w - r, py + r, r, -Math.PI / 2, Math.PI / 2); q.lineTo(px, py + h); q.closePath(); q.fill();
  }
  q.restore();
}
/** Sun Life's sun: a disc and its rays. */
function sunMark(q, cx, cy, r, col) {
  q.fillStyle = col;
  q.beginPath(); q.arc(cx, cy, r * 0.56, 0, Math.PI * 2); q.fill();
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * Math.PI * 2, b = a + 0.09;
    q.beginPath();
    q.moveTo(cx + Math.cos(a - 0.11) * r * 0.64, cy + Math.sin(a - 0.11) * r * 0.64);
    q.lineTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
    q.lineTo(cx + Math.cos(a + 0.11) * r * 0.64, cy + Math.sin(a + 0.11) * r * 0.64);
    q.fill();
  }
}
/** Manulife's mark: the green square and its three white bars rising to the right. */
function manuMark(q, x, y, s) {
  q.fillStyle = '#0a7d3e'; q.fillRect(x, y, s, s);
  q.fillStyle = '#ffffff';
  for (let i = 0; i < 3; i++) {
    const bx = x + s * (0.18 + i * 0.25), top = y + s * (0.42 - i * 0.12);
    q.beginPath(); q.moveTo(bx, y + s * 0.86); q.lineTo(bx + s * 0.13, y + s * 0.86); q.lineTo(bx + s * 0.19, top); q.lineTo(bx + s * 0.06, top + s * 0.04); q.closePath(); q.fill();
  }
}
/** Equitable's teal knot: an open ring over a loop. */
function eqKnot(q, cx, cy, r) {
  q.strokeStyle = '#13a3a8'; q.lineWidth = r * 0.24; q.lineCap = 'round';
  q.beginPath(); q.arc(cx, cy, r, Math.PI * 0.72, Math.PI * 2.28); q.stroke();
  q.beginPath(); q.arc(cx, cy - r * 0.08, r * 0.42, Math.PI * 0.8, Math.PI * 2.2); q.stroke();
  q.beginPath(); q.moveTo(cx - r * 0.32, cy + r * 0.2); q.lineTo(cx + r * 0.62, cy + r * 0.95); q.stroke();
  q.beginPath(); q.moveTo(cx + r * 0.32, cy + r * 0.2); q.lineTo(cx - r * 0.62, cy + r * 0.95); q.stroke();
}
/** Dare's oval: red, a gold rim, the white serif name. */
function dareOval(q, cx, cy, rx, ry) {
  q.fillStyle = '#e7b416'; q.beginPath(); q.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2); q.fill();
  q.fillStyle = '#c8101e'; q.beginPath(); q.ellipse(cx, cy, rx * 0.93, ry * 0.88, 0, 0, Math.PI * 2); q.fill();
  q.fillStyle = '#ffffff'; q.textAlign = 'center'; q.textBaseline = 'middle';
  q.font = `700 ${ry * 1.15}px ${SERIF}`;
  q.fillText('Dare', cx, cy + ry * 0.06, rx * 1.6);
}
/** A wheat ear, pointing along (dx, dy). */
function wheat(q, x, y, len, dir, col) {
  q.save(); q.translate(x, y); q.rotate(dir); q.fillStyle = col; q.strokeStyle = col; q.lineWidth = len * 0.05;
  q.beginPath(); q.moveTo(0, 0); q.lineTo(len, 0); q.stroke();
  for (let i = 0; i < 5; i++) for (const s of [-1, 1]) {
    q.beginPath(); q.ellipse(len * (0.3 + i * 0.15), s * len * 0.07, len * 0.1, len * 0.04, s * 0.5, 0, Math.PI * 2); q.fill();
  }
  q.restore();
}
function word(q, s, x, y, size, col, { font = SANS, wt = 800, align = 'center', italic = false, max = 1e4 } = {}) {
  q.fillStyle = col; q.textAlign = align; q.textBaseline = 'middle';
  q.font = `${italic ? 'italic ' : ''}${wt} ${size}px ${font}`;
  q.fillText(s, x, y, max);
}

/**
 * Every panel, drawn once. The wall signs between litBegin / litEnd (lit at
 * night), the monuments and banners after.
 */
function bizPanels(L) {
  if (L.litBegin) L.litBegin();
  // BlackBerry: logo + wordmark, blue, on the wall (no ground)
  P.bb = L.panel(26, 3.6, 18, (q, W, H) => {
    q.clearRect(0, 0, W, H);
    bbKeys(q, 0, H * 0.14, H * 0.27, '#1d6bb8');
    word(q, 'BlackBerry', H * 1.15, H * 0.54, H * 0.66, '#1d6bb8', { italic: true, align: 'left', max: W - H * 1.2 });
  });
  // Sun Life: the gold sun and the name
  P.sun = L.panel(23, 6.0, 16, (q, W, H) => {
    q.clearRect(0, 0, W, H);
    sunMark(q, H * 0.5, H * 0.5, H * 0.49, '#f2b01e');
    word(q, 'Sun Life', H * 1.05, H * 0.56, H * 0.8, '#f2b01e', { font: SERIF, wt: 700, align: 'left', max: W - H * 1.15 });
  });
  // Manulife: the mark and the green serif name
  P.manu = L.panel(26, 4.2, 18, (q, W, H) => {
    q.clearRect(0, 0, W, H);
    manuMark(q, H * 0.08, H * 0.1, H * 0.8);
    word(q, 'Manulife', H * 1.1, H * 0.55, H * 0.74, '#0a7d3e', { font: SERIF, wt: 700, align: 'left', max: W - H * 1.15 });
  });
  // OpenText: dark lowercase letters
  P.ot = L.panel(20, 3.4, 18, (q, W, H) => {
    q.clearRect(0, 0, W, H);
    word(q, 'opentext', W / 2, H * 0.47, H * 0.86, '#25324f', { wt: 600, max: W * 0.98 });
  });
  // Dare: the oval
  P.dare = L.panel(9, 4.5, 22, (q, W, H) => { q.clearRect(0, 0, W, H); dareOval(q, W / 2, H / 2, W * 0.48, H * 0.46); });
  if (L.litEnd) L.litEnd();
  // the monuments and banners (not lit)
  P.otMon = L.panel(5.2, 1.3, 26, (q, W, H) => {
    q.fillStyle = '#9da3a8'; q.fillRect(0, 0, W, H);
    word(q, 'opentext', W / 2, H * 0.47, H * 0.62, '#1f2a44', { wt: 600, max: W * 0.9 });
  });
  P.dareMon = L.panel(6, 1.9, 26, (q, W, H) => {
    q.fillStyle = '#c9c3b6'; q.fillRect(0, 0, W, H);
    dareOval(q, H * 0.55, H * 0.5, H * 0.46, H * 0.34);
    word(q, 'Dare Foods Limited', H * 1.15, H * 0.36, H * 0.2, '#4a443c', { font: SERIF, wt: 700, align: 'left', max: W - H * 1.2 });
    word(q, '2481 Kingsway Drive', H * 1.15, H * 0.6, H * 0.15, '#4a443c', { font: SERIF, wt: 600, align: 'left', max: W - H * 1.2 });
    word(q, 'www.darefoods.com', H * 1.15, H * 0.8, H * 0.12, '#4a443c', { wt: 600, align: 'left', max: W - H * 1.2 });
  });
}

/**
 * The signs drawn as geometry (pixSign) rather than on the atlas: their cells'
 * sign clusters are 300 m+ away (a letter there would swell that cluster's
 * bounds into views it was not in), so they go in the footprint material of
 * the building's own cell. Not lit at night.
 */
const PIX = {
  // Equitable: the teal knot and the black serif name
  eq: { w: 14, h: 3.0, px: 13, cols: ['#13a3a8', '#151515'], paint: (q, W, H) => {
    eqKnot(q, H * 0.5, H * 0.44, H * 0.34);
    word(q, 'Equitable', H * 1.0, H * 0.52, H * 0.6, '#151515', { font: SERIF, wt: 600, align: 'left', max: W - H * 1.05 });
  } },
  eqBan: { w: 1.3, h: 6.0, px: 10, cols: ['#0f8f93', '#ffffff'], paint: (q, W, H) => {
    q.fillStyle = '#0f8f93'; q.fillRect(0, 0, W, H);
    q.fillStyle = '#ffffff'; q.font = `italic 600 ${W * 1.1}px ${SERIF}`; q.textAlign = 'center'; q.textBaseline = 'middle';
    q.fillText('e', W / 2, H * 0.62);
  } },
  // Christie: white italic capitals on the dark band; the monument's brushed steel and its shadow
  chr: { w: 24, h: 3.8, px: 10, cols: ['#f4f5f6'], paint: (q, W, H) => {
    word(q, 'CHRISTIE', W / 2, H * 0.52, H * 0.8, '#f4f5f6', { italic: true, wt: 900, max: W * 0.98 });
  } },
  chrMon: { w: 11, h: 1.9, px: 20, cols: ['#3b3a38', '#d7dadd'], paint: (q, W, H) => {
    word(q, 'CHRISTIE', W / 2 + H * 0.04, H * 0.57, H * 0.82, '#3b3a38', { italic: true, wt: 900, max: W * 0.96 });
    word(q, 'CHRISTIE', W / 2, H * 0.52, H * 0.82, '#d7dadd', { italic: true, wt: 900, max: W * 0.96 });
  } },
  // Waterloo Brewing: the red pointed banner and the store's fascia
  wb: { w: 14, h: 5.8, px: 11, cols: ['#7d0d1c', '#b8172d', '#fbf6ec', '#e6d6b2'], paint: (q, W, H) => {
    const path = (k) => { q.beginPath(); q.moveTo(k, k); q.lineTo(W - k, k); q.lineTo(W - k, H * 0.66 - k * 0.3); q.lineTo(W / 2, H - k); q.lineTo(k, H * 0.66 - k * 0.3); q.closePath(); };
    q.fillStyle = '#7d0d1c'; path(0); q.fill();
    q.fillStyle = '#b8172d'; path(H * 0.05); q.fill();
    word(q, 'WATERLOO', W / 2, H * 0.27, H * 0.28, '#fbf6ec', { font: SERIF, wt: 800, max: W * 0.88 });
    word(q, 'BREWING', W / 2, H * 0.56, H * 0.2, '#fbf6ec', { font: SERIF, wt: 800, max: W * 0.5 });
    wheat(q, W * 0.07, H * 0.56, W * 0.16, 0, '#e6d6b2');
    wheat(q, W * 0.93, H * 0.56, W * 0.16, Math.PI, '#e6d6b2');
  } },
  wbc: { w: 13, h: 1.0, px: 18, cols: ['#c8172c', '#ffffff'], paint: (q, W, H) => {
    q.fillStyle = '#c8172c'; q.fillRect(0, 0, W, H);
    word(q, 'COLD BEER STORE', W / 2, H * 0.55, H * 0.66, '#ffffff', { wt: 800, max: W * 0.92 });
  } },
};
/** A PIX sign on edge e, centred t along it at height y, `off` out, into builder B. */
function pixOn(B, e, t, y, key, off = 0.1) {
  const S = PIX[key], p = e.at(t, y, 0);
  const n = pixSign(B, p[0], p[1], p[2], e.nx, e.nz, S.w, S.h, S.px, S.cols, S.paint, off);
  BIZ.pixQuads = (BIZ.pixQuads || 0) + n;
  BIZ.signs.push([key, Math.round(p[0]), Math.round(p[2]), +e.nx.toFixed(2), +e.nz.toFixed(2), Math.round(y - T(p[0], p[2]))]);
}

// ---------------------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------------------

/** A sign (a clone of a panel) on edge e, centred t along it at height y. */
function sign(kit, e, t, y, key, off = 0.12) {
  const m = P[key].clone();
  onWall(kit, e, t, y, m, off);
  const q = e.at(t, y, off);
  BIZ.signs.push([key, Math.round(q[0]), Math.round(q[2]), +e.nx.toFixed(2), +e.nz.toFixed(2), Math.round(y - T(q[0], q[2]))]);
  return m;
}
/** The edges of E facing most along (dx, dz), longest first among those within 30 deg. */
function facingAlong(E, dx, dz, minL = 8) {
  const l = Math.hypot(dx, dz) || 1;
  let best = null, bs = -2;
  for (const e of E) {
    if (e.L < minL) continue;
    const d = (e.nx * dx + e.nz * dz) / l, sc = d + Math.min(e.L, 80) / 2000;
    if (sc > bs) { bs = sc; best = e; }
  }
  return best;
}
/**
 * A monument by a street: a base box and `body` (w x h, colour `col`), facing
 * (nx, nz) at (x, z); `panel` on its face (both faces with `two`). It is a
 * landmark solid.
 */
function monument(kit, ctx, x, z, nx, nz, w, h, col, panel, { two = true, base = null, py = null, d = 0.6 } = {}) {
  const y = T(x, z), B = kit.B(x, z), rot = Math.atan2(-nx, nz);
  B.box(x, y - 0.5, z, w + 0.3, 0.75, d + 0.3, rot, base || shade(col, 0.75));
  B.box(x, y - 0.4, z, w, h + 0.4, d, rot, col);
  const yc = py ?? (y + h * 0.55);
  for (const s of two ? [1, -1] : [1]) hang(kit.grp(x, z), P[panel].clone(), x, yc, z, nx * s, nz * s, d / 2 + 0.03);
  ctx.solids.push({ x, z, hw: w / 2 + 0.1, hd: d / 2 + 0.1, rot, y0: y - 1, y1: y + h });
  BIZ.signs.push([panel, Math.round(x), Math.round(z), +nx.toFixed(2), +nz.toFixed(2), 1]);
}
/** Where a monument stands: `back` m in from the kerb of the street nearest (x, z), toward (x, z). */
function bySt(city, x, z, re, back = 6, along = 0) {
  const s = street(city, x, z, 160, re);
  if (!s) return null;
  let nx = x - s.qx, nz = z - s.qz;
  const l = Math.hypot(nx, nz) || 1; nx /= l; nz /= l;
  const px = s.qx + nx * (s.hw + back) + s.ex * along, pz = s.qz + nz * (s.hw + back) + s.ez * along;
  return { x: px, z: pz, nx: -nx, nz: -nz };
}

/**
 * Lettering as geometry, for a cell with no sign cluster: `draw` paints a
 * w x h m canvas at `px` a metre; each opaque pixel goes to the nearest of
 * `cols`, runs of a colour are merged along rows and then down columns into
 * rectangles, and each rectangle is a vertex-coloured quad on the plane at
 * (cx, cy, cz) facing (nx, nz), `off` out. Blocky up close by design (a pixel
 * is 1 / px m); the footprint material, so no draw.
 */
function pixSign(B, cx, cy, cz, nx, nz, w, h, px, cols, draw, off = 0.1) {
  const W = Math.round(w * px), H = Math.round(h * px);
  const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
  const q = cv.getContext('2d');
  draw(q, W, H);
  const d = q.getImageData(0, 0, W, H).data;
  const pal = cols.map((c) => { const n = parseInt(c.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; });
  const LC = cols.map(C);
  const idx = new Int8Array(W * H).fill(-1);
  for (let i = 0; i < W * H; i++) {
    if (d[i * 4 + 3] < 128) continue;
    let bi = 0, bd = Infinity;
    for (let k = 0; k < pal.length; k++) {
      const dr = d[i * 4] - pal[k][0], dg = d[i * 4 + 1] - pal[k][1], db = d[i * 4 + 2] - pal[k][2];
      const dd = dr * dr + dg * dg + db * db;
      if (dd < bd) { bd = dd; bi = k; }
    }
    idx[i] = bi;
  }
  const rx = nz, rz = -nx;     // the reading direction seen from the front
  const N = [nx, 0, nz];
  const pt = (i, j) => [cx + rx * (i / px - w / 2) + nx * off, cy + h / 2 - j / px, cz + rz * (i / px - w / 2) + nz * off];
  let open = new Map(), quads = 0;
  const emit = (r, j1) => { B.quad(pt(r.x0, j1), pt(r.x1, j1), pt(r.x1, r.j0), pt(r.x0, r.j0), N, U0, LC[r.c]); quads++; };
  for (let j = 0; j <= H; j++) {
    const runs = new Map();
    if (j < H) {
      let i = 0;
      while (i < W) {
        const c = idx[j * W + i];
        if (c < 0) { i++; continue; }
        let k = i + 1;
        while (k < W && idx[j * W + k] === c) k++;
        runs.set(`${i},${k},${c}`, { x0: i, x1: k, c });
        i = k;
      }
    }
    const next = new Map();
    for (const [key, r] of runs) next.set(key, open.get(key) || { ...r, j0: j });
    for (const [key, r] of open) if (!runs.has(key)) emit(r, j);
    open = next;
  }
  return quads;
}

// ---------------------------------------------------------------------------------------
// the ones kwlandmarks2.js already draws: their signs
// ---------------------------------------------------------------------------------------

/** BlackBerry A, B, C (r: block()'s result): toward University Ave and the back, near one end. */
export function bbSign(kit, ctx, r, k) {
  const E = r.E.filter((e) => e.L >= 25 && clearAhead(ctx.city, e, r.yTop)).sort((a, b) => b.L - a.L).slice(0, 2);
  for (const e of E) sign(kit, e, Math.min(e.L * 0.3, 18), r.yTop - 1.7, 'bb', 0.3);
  void k;
}
/** Nothing taller than the sign's foot standing within 50 m in front of edge e's middle (a parking structure). */
function clearAhead(city, e, yTop) {
  for (let d = 10; d <= 50; d += 10) {
    const px = e.mx + e.nx * d, pz = e.mz + e.nz * d;
    for (const o of city.buildingsNear(px, pz, 40)) {
      if (!(o.h > 0) || (o.y || T(o.x, o.z)) + o.h < yTop - 5) continue;
      const dx = px - o.x, dz = pz - o.z, c = Math.cos(o.rot), sn = Math.sin(o.rot);
      if (Math.abs(dx * c + dz * sn) < o.w / 2 && Math.abs(-dx * sn + dz * c) < o.d / 2) return false;
    }
  }
  return true;
}
/** Sun Life's crown: the tower's north (Uptown), east (King St) and south faces. */
export function sunSign(kit, ctx, t) {
  for (const [dx, dz] of [[0.41, -0.91], [-0.41, 0.91], [0.91, 0.41]]) {
    const e = facingAlong(t.E, dx, dz, 12);
    if (e) sign(kit, e, e.L / 2, t.yTop - 3.3, 'sun', 0.15);
  }
}
/** Manulife: toward King St, the car park (north) and the south. */
export function manuSign(kit0, ctx, r) {
  // (all in the building's own cell's sign cluster: the King St face is across the cell line)
  const kit = { atlas: kit0.atlas, B: (x, z) => kit0.B(x, z), grp: () => kit0.grp(r.cx, r.cz) };
  const used = new Set();
  const kf = frontEdge(ctx.city, r.E, /^King Street/, 12, 250);
  for (const e of [kf, facingAlong(r.E, 0, -1, 30), facingAlong(r.E, 0, 1, 30)]) {
    if (!e || used.has(e)) continue;
    used.add(e);
    sign(kit, e, e.L * (e === kf ? 0.5 : 0.62), r.yTop - 1.9, 'manu', 0.12);
  }
}

// ---------------------------------------------------------------------------------------
// the new ones: each footprint redrawn (its box flattened by prepLandmarks2), then its signs
// ---------------------------------------------------------------------------------------

function openText(kit, ctx, D) {
  const city = ctx.city;
  const look = (lv) => ({
    h: lv * 4.1 + 1.2, wall: C('#dfe2e4'), trim: C('#f4f5f6'), parapet: 1.2, roof: C('#8f9194'), glass: C('#3f5a72'),
    win: { style: 'ribbon', fl: 4.1, g0: 1.2, h: 2.5, top: 1.6 },
  });
  const r1 = block(kit, ctx, D.b.ot1.p, look(4));
  const r2 = block(kit, ctx, D.b.ot2.p, look(5));
  // Building 2: toward Frank Tompa Dr and toward the car park east; Building 1 toward the west lawn
  const f2 = frontEdge(city, r2.E, /^Frank Tompa/, 12, 160) || facingAlong(r2.E, 0, 1, 12);
  if (f2) sign(kit, f2, f2.L / 2, r2.yTop - 1.6, 'ot', 0.1);
  const e2 = facingAlong(r2.E, 1, 0, 12);
  if (e2 && e2 !== f2) sign(kit, e2, e2.L / 2, r2.yTop - 1.6, 'ot', 0.1);
  const w1 = facingAlong(r1.E, -1, -0.2, 12);
  if (w1) sign(kit, w1, w1.L / 2, r1.yTop - 1.6, 'ot', 0.1);
  // the monument at the drive, on Frank Tompa Dr
  const [cx, cz] = [(r2.cx + r1.cx) / 2, (r2.cz + r1.cz) / 2];
  const m = bySt(city, cx, cz + 30, /^Frank Tompa/, 7, 0);
  if (m && !city.onRoad(m.x, m.z, 1.5)) monument(kit, ctx, m.x, m.z, m.nx, m.nz, 5.6, 1.6, C('#7f868c'), 'otMon', { d: 0.8 });
}

function equitable(kit, ctx, D) {
  const PRE = C('#c4b598');
  const r = block(kit, ctx, D.b.equit.p, {
    h: 13.4, wall: PRE, trim: C('#d6cbb3'), parapet: 1.4, roof: C('#8c8a86'), glass: C('#2c3035'),
    win: { style: 'ribbon', fl: 4.0, g0: 1.6, h: 1.9, top: 1.9 }, plinth: [0.8, shade(PRE, 0.85)],
  });
  const f = frontEdge(ctx.city, r.E, /^Westmount Road/, 15, 120) || facingAlong(r.E, 0.8, -0.6, 15);
  if (!f) return;
  // the north end of the face (the end with the smaller z)
  const north = f.at(0, 0)[2] < f.at(f.L, 0)[2];
  const t0 = north ? 7.5 : f.L - 7.5;
  pixOn(r.B, f, t0, r.yTop - 1.0, 'eq', 0.1);
  // the two banners on the face's piers, nearer the middle
  const gy = T(f.mx + f.nx * 3, f.mz + f.nz * 3);
  for (const k of [0, 1]) {
    const t = north ? 15 + k * 5 : f.L - 15 - k * 5;
    if (t < 2 || t > f.L - 2) continue;
    pixOn(r.B, f, t, gy + 6.2, 'eqBan', 0.35);
    B4(r.B, f, t - 0.05, t + 0.05, gy + 3, gy + 9.4, 0.32, [f.nx, 0, f.nz], C('#5b5f63'));
  }
}

function christie(kit, ctx, D) {
  const city = ctx.city, WALL = C('#74797e');
  const r = block(kit, ctx, D.b.christie.p, {
    h: 11, wall: WALL, trim: C('#a7abaf'), parapet: 1.0, roof: C('#8c8d8e'), glass: C('#2f4250'),
    win: { style: 'ribbon', fl: 5.0, g0: 1.4, h: 2.0, top: 5.0, minL: 20 }, plinth: [1.0, C('#5a5d60')],
  });
  const f = frontEdge(city, r.E, /^Wellington Street/, 25, 160) || facingAlong(r.E, -0.4, -0.9, 25);
  if (!f) return;
  // the dark panel band it sits on, and CHRISTIE
  const N = [f.nx, 0, f.nz], tm = f.L * 0.62;
  B4(r.B, f, tm - 14, tm + 14, r.yTop - 4.6, r.yTop + 1.0, 0.06, N, C('#3c3f43'));
  pixOn(r.B, f, tm, r.yTop - 1.8, 'chr', 0.1);
  // the fieldstone wall at the entrance, by Wellington St
  const p = f.at(f.L * 0.2, 0, 0);
  const m = bySt(city, p[0], p[2], /^Wellington Street/, 6, 0);
  if (m && !city.onRoad(m.x, m.z, 2)) {
    const y = T(m.x, m.z), B = kit.B(m.x, m.z), rot = Math.atan2(-m.nx, m.nz);
    // rough stone: the wall, and lighter and darker stones laid over it
    B.box(m.x, y - 0.6, m.z, 12, 3.1, 1.0, rot, C('#8f8b84'));
    const rx = m.nz, rz = -m.nx;
    for (let i = 0; i < 26; i++) {
      const u = ((i * 37) % 23) / 23 * 11 - 5.5, v = ((i * 17) % 11) / 11 * 2.2 + 0.1;
      const c = i % 3 === 0 ? C('#a7a29a') : i % 3 === 1 ? C('#76726b') : C('#9b958b');
      for (const s of [1, -1]) {
        const x = m.x + rx * u + m.nx * s * 0.51, z = m.z + rz * u + m.nz * s * 0.51;
        B.box(x, y + v - 0.25, z, 0.7 + (i % 4) * 0.15, 0.32 + (i % 3) * 0.08, 0.05, rot, c);
      }
    }
    B.box(m.x, y + 2.5, m.z, 12.3, 0.18, 1.2, rot, C('#b6b1a8'));     // the cope
    for (const s of [1, -1]) BIZ.pixQuads = (BIZ.pixQuads || 0) + pixSign(B, m.x, y + 1.3, m.z, m.nx * s, m.nz * s, PIX.chrMon.w, PIX.chrMon.h, PIX.chrMon.px, PIX.chrMon.cols, PIX.chrMon.paint, 0.56);
    ctx.solids.push({ x: m.x, z: m.z, hw: 6.1, hd: 0.6, rot, y0: y - 1, y1: y + 2.7 });
    BIZ.signs.push(['chrMon', Math.round(m.x), Math.round(m.z), +m.nx.toFixed(2), +m.nz.toFixed(2), 1]);
  }
}

function dare(kit, ctx, D) {
  const city = ctx.city, PRE = C('#cdcac2');
  const r = block(kit, ctx, D.b.dare.p, {
    h: 10.5, wall: PRE, trim: C('#e3e1dc'), parapet: 1.0, roof: C('#7e7d7a'), glass: C('#2e3a44'),
    win: { style: 'punch', sp: 4.5, w: 2.2, h: 1.8, fl: 4.5, g0: 1.6, minL: 30 }, plinth: [1.0, shade(PRE, 0.8)],
  });
  // the north end (Kingsway Dr) and the west face's north end (Eighth Ave)
  const ne = facingAlong(r.E, 0.4, -0.92, 15);
  const kf = frontEdge(city, r.E, /^Kingsway/, 20, 200) || facingAlong(r.E, -0.92, 0.4, 20);
  if (ne) {
    // a raised entrance block with the oval on it
    const N = [ne.nx, 0, ne.nz], tm = ne.L / 2;
    B4(r.B, ne, tm - 5.6, tm + 5.6, r.yTop - 1, r.yTop + 4.0, 0.25, N, C('#f0eeea'));
    for (const s of [-1, 1]) r.B.quad(ne.at(tm + s * 5.6, r.yTop - 1, 0), ne.at(tm + s * 5.6, r.yTop - 1, 0.25), ne.at(tm + s * 5.6, r.yTop + 4.0, 0.25), ne.at(tm + s * 5.6, r.yTop + 4.0, 0), [ne.ux * s, 0, ne.uz * s], U0, C('#d9d6cf'));
    r.B.quad(ne.at(tm - 5.6, r.yTop + 4.0, 0), ne.at(tm + 5.6, r.yTop + 4.0, 0), ne.at(tm + 5.6, r.yTop + 4.0, 0.25), ne.at(tm - 5.6, r.yTop + 4.0, 0.25), [0, 1, 0], U0, C('#bdbab3'));
    sign(kit, ne, tm, r.yTop + 1.4, 'dare', 0.35);
  }
  // the long west face (Eighth Ave), near its north end
  const wf = facingAlong(r.E, -0.92, -0.4, 20);
  if (wf && wf !== ne) {
    const north = wf.at(0, 0)[2] < wf.at(wf.L, 0)[2];
    sign(kit, wf, north ? 10 : wf.L - 10, r.yTop - 2.4, 'dare', 0.12);
  }
  // the monument on Kingsway Dr, in front of the north end
  if (kf) {
    const p = kf.at(kf.L * 0.3, 0, 0);
    const m = bySt(city, p[0], p[2], /^Kingsway/, 6, 0);
    if (m && !city.onRoad(m.x, m.z, 2)) monument(kit, ctx, m.x, m.z, m.nx, m.nz, 6.2, 2.0, C('#bfb8a9'), 'dareMon', { d: 0.7 });
  }
}

function waterlooBrewing(kit, ctx, D) {
  const BUFF = C('#c3a77c');
  const r = block(kit, ctx, D.b.wbrew.p, {
    h: 10, wall: C('#c4c7c7'), trim: C('#dcdede'), parapet: 0.8, roof: C('#a6a6a3'), glass: C('#2c3640'),
    win: null, plinth: [1.0, C('#9c9e9d')],
  });
  // the front: the long face toward the car park west
  const f = facingAlong(r.E.filter((e) => e.L < 40), -0.9, 0.42, 14);
  if (!f) return;
  const N = [f.nx, 0, f.nz], gy = T(f.mx + f.nx * 3, f.mz + f.nz * 3), tm = f.L / 2;
  // the buff exposed-aggregate front, its pilasters, two storeys of windows
  B4(r.B, f, 0, f.L, gy - 0.4, r.yTop + 0.8, 0.05, N, BUFF);
  for (const t of [0.4, tm - 7, tm + 7, f.L - 0.4]) B4(r.B, f, t - 0.4, t + 0.4, gy - 0.4, r.yTop + 1.0, 0.18, N, shade(BUFF, 1.08));
  for (const s of [-1, 1]) {
    const tw = tm + s * 4.2;
    B4(r.B, f, tw - 2.2, tw + 2.2, gy + 4.6, gy + 6.9, 0.08, N, C('#30383f'));
    B4(r.B, f, tw - 2.6, tw + 2.6, gy + 0.1, gy + 3.0, 0.08, N, C('#3a4650'));
  }
  // the store's canopy and its red fascia, the banner over the parapet
  const B = r.B;
  B.quad(f.at(tm - 6.4, gy + 3.2, 0), f.at(tm + 6.4, gy + 3.2, 0), f.at(tm + 6.4, gy + 3.2, 1.6), f.at(tm - 6.4, gy + 3.2, 1.6), [0, -1, 0], U0, C('#d8d2c6'));
  B.quad(f.at(tm - 6.4, gy + 4.2, 0), f.at(tm + 6.4, gy + 4.2, 0), f.at(tm + 6.4, gy + 4.2, 1.6), f.at(tm - 6.4, gy + 4.2, 1.6), [0, 1, 0], U0, C('#8e1424'));
  for (const s of [-1, 1]) B.quad(f.at(tm + s * 6.4, gy + 3.2, 0), f.at(tm + s * 6.4, gy + 3.2, 1.6), f.at(tm + s * 6.4, gy + 4.2, 1.6), f.at(tm + s * 6.4, gy + 4.2, 0), [f.ux * s, 0, f.uz * s], U0, C('#a3192b'));
  for (const s of [-1, 1]) { const p = f.at(tm + s * 5.8, gy - 0.2, 1.4); B.prism(p[0], p[1], p[2], 0.16, 3.4, 8, C('#b9a37f')); }
  pixOn(B, f, tm, gy + 3.7, 'wbc', 1.62);
  pixOn(B, f, tm, r.yTop + 0.2, 'wb', 0.3);
}

// Gore Mutual: in the footprint material of cluster 11,8 (its own cell, 12,8, has no sign
// cluster and its footprint cluster is a small one 380 m off); a kit that keys everything there
const GORE_KEY = [13200, 9600];
function goreMutual(kit, ctx, D) {
  const city = ctx.city;
  const gk = { atlas: kit.atlas, B: () => kit.B(GORE_KEY[0], GORE_KEY[1]), grp: () => kit.grp(GORE_KEY[0], GORE_KEY[1]) };
  const ST = C('#5f5e5c');
  const r = block(gk, ctx, D.b.gore.p, {
    h: 13.5, wall: ST, trim: C('#8b8986'), parapet: 1.0, roof: C('#8d8d8a'), glass: C('#2a3a46'),
    win: { style: 'ribbon', fl: 4.1, g0: 1.4, h: 2.3, top: 1.8 },
  });
  // the 1935 building: limestone, three storeys, the copper hip roof (over its long wing)
  const LS = C('#bcb19c');
  const h2 = block(gk, ctx, D.b.gore2.p, {
    h: 12, wall: LS, trim: C('#d6ccb8'), parapet: 0, cornice: 0.7, roof: C('#6b6b66'), glass: C('#2d3136'),
    win: { style: 'punch', sp: 3.0, w: 1.4, h: 2.2, fl: 3.8, g0: 1.4, sill: C('#d6ccb8') }, plinth: [1.2, shade(LS, 0.85)],
  });
  const o2 = obb(h2.pts);
  if (o2) hipRoof(h2.B, { ...o2, hu: o2.hu * 0.92, hv: Math.min(o2.hv, 9) }, h2.yTop, 4.2, C('#5e9a89'), 0.4);
  const RED = '#c8102e', GREY = '#d9d8d5';
  const mark = (q, x, y, s) => {
    q.strokeStyle = RED; q.lineWidth = s * 0.16; q.lineCap = 'round';
    q.beginPath(); q.arc(x, y, s * 0.42, Math.PI * 0.15, Math.PI * 1.85); q.stroke();
    q.beginPath(); q.moveTo(x + s * 0.05, y); q.lineTo(x + s * 0.42, y); q.stroke();
  };
  // the head office's face toward the drive: GORE MUTUAL
  // (the long face toward the car park and the drive, south-east; the others look into the 1935 building or a notch)
  const f = r.E.filter((e) => e.L >= 12 && e.nx * 0.78 + e.nz * 0.63 > 0.8).sort((a, b) => b.L - a.L)[0];
  if (f) {
    const p = f.at(f.L / 2, r.yTop - 2.2, 0);
    BIZ.goreQuads = pixSign(r.B, p[0], p[1], p[2], f.nx, f.nz, Math.min(15, f.L - 1), 2.6, 14, [RED, GREY], (q, W, H) => {
      mark(q, H * 0.5, H * 0.5, H * 0.9);
      word(q, 'GORE MUTUAL', H * 1.1, H * 0.54, H * 0.62, GREY, { font: SERIF, wt: 700, align: 'left', max: W - H * 1.15 });
    }, 0.1);
    BIZ.signs.push(['gore', Math.round(p[0]), Math.round(p[2]), +f.nx.toFixed(2), +f.nz.toFixed(2), Math.round(p[1] - T(p[0], p[2]))]);
  }
  // the granite ground sign by Dundas St
  const m = bySt(city, (r.cx + h2.cx) / 2, (r.cz + h2.cz) / 2, /^Dundas Street/, 7, -14);
  if (m && !city.onRoad(m.x, m.z, 2)) {
    const y = T(m.x, m.z), B = gk.B(), rot = Math.atan2(-m.nx, m.nz);
    B.box(m.x, y - 0.6, m.z, 5.4, 2.6, 1.1, rot, C('#a19d96'));
    B.box(m.x, y + 1.95, m.z, 4.8, 0.35, 0.9, rot, C('#aaa69f'));
    for (const s of [1, -1]) {
      BIZ.goreQuads += pixSign(B, m.x, y + 0.85, m.z, m.nx * s, m.nz * s, 4.8, 1.7, 22, [RED, '#3f3d3a'], (q, W, H) => {
        mark(q, H * 0.42, H * 0.5, H * 0.72);
        word(q, 'GORE', H * 0.95, H * 0.3, H * 0.4, '#3f3d3a', { font: SERIF, wt: 700, align: 'left', max: W - H });
        word(q, 'MUTUAL', H * 0.95, H * 0.74, H * 0.4, '#3f3d3a', { font: SERIF, wt: 700, align: 'left', max: W - H });
      }, 0.57);
    }
    ctx.solids.push({ x: m.x, z: m.z, hw: 2.7, hd: 0.65, rot, y0: y - 1, y1: y + 2.2 });
    BIZ.signs.push(['goreMon', Math.round(m.x), Math.round(m.z), +m.nx.toFixed(2), +m.nz.toFixed(2), 1]);
  }
}

/** Round six's footprints (prepLandmarks2 flattens their boxes). */
export const BIZ_KEYS = ['ot1', 'ot2', 'equit', 'christie', 'dare', 'wbrew', 'gore', 'gore2'];

/**
 * Called by kwlandmarks2.js buildLandmarks2 before anything else draws (the
 * panels first, so the lit ones share rows of their own), then `bizRun` for
 * the new buildings.
 */
export function bizBegin(kit) { bizPanels(kit.atlas); }
export function bizRun(kit, ctx, D, run) {
  if (!D.b.ot1) return;
  run('opentext', () => openText(kit, ctx, D));
  run('equitable', () => equitable(kit, ctx, D));
  run('christie', () => christie(kit, ctx, D));
  run('dare', () => dare(kit, ctx, D));
  run('wbrew', () => waterlooBrewing(kit, ctx, D));
  run('gore', () => goreMutual(kit, ctx, D));
  if (typeof window !== 'undefined') window.__kwBiz = BIZ;
}
export function bizMap(D, centroid) {
  if (!D.b.ot1) return [];
  const m = (k, name, hello) => { const p = centroid(D.b[k].p); return { x: p[0], z: p[1], kind: 'lm', label: false, name, near: false, hello }; };
  return [
    m('ot2', 'OpenText', 'OpenText, 275 Frank Tompa Dr — the headquarters of Canada\'s biggest software company'),
    m('equit', 'Equitable', 'Equitable, 1 Westmount Rd N — a Waterloo life insurer since 1920'),
    m('christie', 'Christie', 'Christie, 809 Wellington St N — the projectors in the world\'s cinemas are made here'),
    m('dare', 'Dare Foods', 'Dare Foods, 2481 Kingsway Dr — cookies and crackers, a Kitchener family firm since 1892'),
    m('wbrew', 'Waterloo Brewing', 'Waterloo Brewing, 400 Bingemans Centre Dr — the cold beer store is at the front'),
    m('gore', 'Gore Mutual', 'Gore Mutual Insurance, 252 Dundas St N — in Galt since 1839'),
  ];
}
