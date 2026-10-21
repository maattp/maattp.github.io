// DOWNTOWN KITCHENER AND CAMBRIDGE, BUILDING BY BUILDING: the second pass on
// what kwsights.js drew (v25), done the way kwuptown.js did Uptown Waterloo.
//
//   - KING ST, Victoria to Cedar: each block's real look (LOOKS, read by
//     kwplaces.js meshKing through `r.look`), the Walper Hotel among them
//     (build_sights.py KING_FORCE puts its five storeys on the main street).
//   - the towers' real cladding (TOWERS -> bd.kw.tower, read by world.js
//     modernTower / towerLook / buildingFamily).
//   - the Kitchener Public Library's glass front on Queen St N.
//   - GALT: the Galt Collegiate Institute (the Scottish Baronial stone school
//     on the river bank: crow-stepped gables, two towers with copper caps),
//     Central Presbyterian's 56 m spire on Queen's Square, the 1858 Town Hall's
//     clock tower and belfry, the 1887 Farmers' Market and its red brick tower,
//     Main / Water / Ainslie St's stone and brick.
//   - PRESTON's King St E and HESPELER's Queen St (build_sights.py MAIN_STREETS).
//   - CAMBRIDGE CENTRE: the 2026 aerial's plan, the old Bay painted cherry red,
//     the south anchor's Sport Chek / Marshalls / Mark's, the clerestory, the
//     doors and the pylon on Hespeler Rd.
//
// Sources (Oct 2026): historicplaces.ca (Galt Collegiate id 10092, the market
// 9766, Galt Town Hall 7606, the Main St bridge 10817, 62 Dickson 10095),
// heritageguide.ca, Doors Open Waterloo Region (Central Presbyterian, Knox's
// Galt), the Ontario Heritage Trust (18-24 Queen St W, Hespeler), Wikipedia
// (Cambridge Centre; GCI), news on the Bay's closing (June 2025), the Esri
// World Imagery aerial (tools/kw/aerial.py) for every plan, OSM's tags
// (tools/kw/probe_blocks.py). Colours are estimates read off photographs and
// the registers' material words, not specifications. The Preston Springs
// Hotel was demolished in January 2021: its lot at King & Fountain is empty.
//
// Everything is built inside kwsights.js's buildSights (addSights): the same
// Kit, the same two vertex-coloured materials and the same lettering atlas, so
// a cluster that already holds sights is not one draw more.

import { hash2 } from './util.js';
import { boxAt } from './kw.js';
import {
  inPoly, polyArea, centroid, obb, simplify, edges, street, walkY, hang, roof, gabled, lin, shade, hex, SANS, SERIF, U0, T,
} from './kwplaces.js';
import {
  block, frontEdge, text, onWall, clockFace, pyramid, hipRoof, B4, nearestEdge, entrance, atriumEntrance, storeFront, pylon,
  brandPanel, addSights, sightsData,
} from './kwsights.js';

const STATS = { looks: 0, defaults: 0, towers: 0, skipped: 0, custom: 0 };
const C = (h) => lin(hex(h));
const ccw = (p) => (polyArea(p) < 0 ? p.slice().reverse() : p);

// ---------------------------------------------------------------------------------------
// Main-street looks, keyed by the footprint's centroid (sights.json king; the
// OSM address beside each). The fields are kwuptown.js's (see its LOOKS).
// ---------------------------------------------------------------------------------------
const LOOKS = [
  // ===== King St W, north side (odd), from Queen west =====
  { at: [-1177, 256], addr: '1-11 King W / 20 Queen S, the Walper Hotel (1893, designated 1983)',
    // red-orange pressed brick, light stone string courses, the deep cream
    // bracketed metal cornice, arched windows paired on the third floor,
    // dark storefronts, THE WALPER banners down both faces, the W on the corner
    lv: 5, H: 19.6, gf: 4.6, fp: 3.6, wall: '#a9472f', trim: '#e6dfcc', band: '#d8cbb0', sill: '#d8cbb0', frame: '#2a2420',
    win: { n: 13, ns: 7, head: 'seg', hc: '#8f3a26', w: 0.9, h: 1.9 }, cornice: 'bracket',
    bulk: '#1e1e1e', pier: '#1e1e1e', signBand: '#1e1e1e', awn: false,
    shops: [
      { n: 'Coffee Culture', bg: '#1e1e1e', fg: '#d6b25e', serif: true, wt: '700', awn: null, f: 0.26, w: 4.2 },
      { n: 'THE WALPER', bg: '#1e1e1e', fg: '#e6dfcc', serif: true, wt: '700', awn: null, w: 4.0 },
      { n: 'Lokal', bg: '#1e1e1e', fg: '#ffffff', serif: false, wt: '600', awn: null },
    ],
    side: [{ n: 'THE WALPER', bg: '#1e1e1e', fg: '#e6dfcc', serif: true, wt: '700', awn: null }, { n: '', awn: null }],
    extra: walper },
  { at: [-1211, 243], addr: '37-39 King W, the Weber Block (c. 1910)',
    // painted white, a recessed two-storey loggia of three Ionic columns, a dentilled entablature
    lv: 3, H: 12.2, wall: '#f2f2ee', trim: '#d9d9d3', sill: '#e6e6e0', cornice: 'plain', noBands: true,
    win: { n: 3, head: 'flat', hc: '#d9d9d3', w: 1.5, h: 2.6 }, extra: loggia },
  { at: [-1219, 238], addr: '41-45 King W, the Knell Hardware building (1893)',
    // dark red-brown brick, round-arched top floor, terracotta frieze bands, white coping
    lv: 4, H: 15.4, wall: '#6e3328', trim: '#efede6', band: '#a0583e', sill: '#c9a58a', cornice: 'plain',
    win: { n: 5, head: 'round', hc: '#5a2a20', w: 1.0, h: 2.0 } },
  { at: [-1273, 199], addr: '73 King W (a modern four-storey office)',
    lv: 4, H: 15.0, wall: '#a5533d', trim: '#d8d2c4', cornice: 'plain', noBands: true, win: { head: 'flat', hc: '#a5533d', w: 1.8, h: 1.9 },
    name: '73', nameBg: '#a5533d', nameFg: '#ffffff', nameW: 2.6, nameH: 1.8 },
  // 83-99 King W: the 2024 designations, "Vernacular Classic Revival" -- orange-red
  // brick, a corbelled frieze, round-arched top floor under brick hoods,
  // segmental below, grey stone sills run as string courses
  { at: [-1278, 190], addr: '83-85 King W (designated 2024)', lv: 3, H: 12.0, wall: '#a3523a', trim: '#a3523a', sill: '#a9a49a', band: '#a9a49a',
    cornice: 'corbel', win: { head: 'round', hc: '#9e4a2e', w: 0.9 },
    shops: [{ n: "Big D's Hot Chicken", bg: '#111111', fg: '#e8312a', serif: false, wt: '800', awn: null }] },
  { at: [-1290, 196], addr: '87-91 King W (designated 2024)', lv: 3, H: 12.0, wall: '#a3523a', trim: '#a3523a', sill: '#a9a49a', band: '#a9a49a',
    cornice: 'corbel', win: { head: 'round', hc: '#9e4a2e', w: 0.9 }, pier: '#4a4a4a', bulk: '#4a4a4a',
    shops: [{ n: 'Grand Trunk', bg: '#2a2a2a', fg: '#e8e2d0', serif: true, wt: '600', awn: null },
      { n: 'Chatime', bg: '#6a2c8e', fg: '#ffffff', serif: false, wt: '700', awn: null }] },
  { at: [-1294, 189], addr: '93-95 King W (the modern infill)', lv: 3, H: 12.0, wall: '#3a3d40', trim: '#2a2c2e', cornice: 'none', noBands: true,
    win: { n: 1, head: 'flat', hc: '#3a3d40', w: 3.6, h: 2.6 } },
  { at: [-1303, 194], addr: '97-99 King W (designated 2024)', lv: 3, H: 12.0, wall: '#a3523a', trim: '#a3523a', sill: '#a9a49a', band: '#a9a49a',
    cornice: 'corbel', win: { n: 6, head: 'round', hc: '#9e4a2e', w: 0.8 },
    shops: [{ n: 'Four All Ice Cream', bg: '#1a1a1a', fg: '#ff4b3a', serif: false, wt: '700', awn: null }] },
  { at: [-1314, 187], addr: '103-109 King W (designated 2024)', lv: 3, H: 12.0, wall: '#9c4c34', trim: '#9c4c34', sill: '#a9a49a', band: '#a9a49a',
    cornice: 'corbel', win: { head: 'seg', hc: '#9a4830', w: 0.9 } },
  { at: [-1330, 185], addr: '117 King W, the Simpson (Schreiter) Block (1895)',
    // red brick, three brick floors over a tall granite-framed shopfront, eight
    // round-arched windows on top, corbelled brick and terracotta at the parapet, the 1895 capstone
    lv: 4, H: 15.6, gf: 5.2, wall: '#94402e', trim: '#94402e', sill: '#c9b8a0', band: '#a84a34',
    win: { n: 8, head: 'round', hc: '#8f3c28', w: 0.85, h: 1.9 }, cornice: 'corbel',
    name: '1895', nameBg: '#c9b8a0', nameFg: '#5a3a2a', nameW: 2.4, nameH: 1.2,
    pier: '#a9a49a', bulk: '#a9a49a', signBand: '#a9a49a', frame: '#3a3a3a',
    shops: [{ n: 'Matter of Taste', text: 'MATTER OF TASTE  COFFEE BAR', bg: '#a9a49a', fg: '#1a1a1a', serif: false, wt: '700', frame: false, awn: null }] },
  { at: [-1447, 120], addr: '191-195 King W, the Public Utilities Commission building (1931-32)',
    // smooth buff sandstone over a grey granite base, tall two-storey windows with Art Deco spandrels, a bracketed stone cornice
    lv: 3, H: 13.2, wall: '#cfc6b2', trim: '#bdb4a0', stone: '#8f8b84', sill: '#bdb4a0', band: '#cfc6b2', cornice: 'bracket', noBands: true,
    ground: 'bank', win: { head: 'flat', hc: '#bdb4a0', w: 1.6, h: 4.6 },
    sign: { n: 'PUBLIC UTILITIES', bg: '#cfc6b2', fg: '#4a4234', serif: true, w: 5 } },
  { at: [-1609, -16], addr: '312 King W (a theatre front; Dallas, 2013)',
    lv: 2, H: 9.4, wall: '#b89b5e', trim: '#8a2a22', cornice: 'plain', noBands: true, win: { n: 0, sp: 99 }, pier: '#3a3a3a', bulk: '#3a3a3a' },
  // ===== King St W, south side (even) =====
  { at: [-1210, 169], addr: '64 King W, the Bank of Nova Scotia (designated, 54-68 King W)',
    // beige limestone framed by dark green polished granite piers, THE BANK OF NOVA SCOTIA carved over
    lv: 2, H: 10.8, wall: '#d8cbb5', trim: '#2f4a3e', stone: '#2f4a3e', sill: '#e2d8c4', band: '#d8cbb5', cornice: 'plain', noBands: true,
    ground: 'bank', win: { head: 'flat', hc: '#d8cbb5', w: 1.8, h: 2.4 }, name: 'THE BANK OF NOVA SCOTIA', nameBg: '#d8cbb5', nameFg: '#4a4234', nameW: 9, nameH: 0.9,
    sign: { n: 'Scotiabank', bg: '#ec111a', fg: '#ffffff', serif: false, wt: '800', w: 3.6 } },
  { at: [-1164, 197.5], addr: '10 King W, THEMUSEUM (Goudies department store until 1988)',
    // a blue-green glass curtain wall, a huge black panel with the red M, a grey canopy, buff brick at the base
    lv: 3, H: 14.0, wall: '#3f6066', trim: '#9aa3a8', frame: '#9aa3a8', sill: '#9aa3a8', band: '#9aa3a8', cornice: 'none', noBands: true,
    win: { n: 9, head: 'flat', hc: '#9aa3a8', w: 3.0, h: 3.3 }, bulk: '#c8b07a', pier: '#c8b07a', signBand: '#5c6166', awn: false,
    shops: [{ n: 'THEMUSEUM', bg: '#111111', fg: '#ffffff', serif: false, wt: '800', awn: null, w: 4.4 }], extra: theMuseum },
  { at: [-1251, 159], addr: 'The Canadian Block (King W at Ontario St; OSM name)',
    lv: 3, H: 12.4, wall: '#9a4a36', trim: '#e2d8c4', sill: '#e2d8c4', cornice: 'bracket', win: { head: 'seg', hc: '#e2d8c4' },
    name: 'CANADIAN BLOCK', nameBg: '#9a4a36', nameFg: '#f2ead2', nameW: 6, nameH: 1.1 },
  { at: [-1283, 139], addr: '102 King W (1960s, pinkish-beige panels, a ribbon window)',
    lv: 2, H: 8.2, wall: '#c9b8a8', trim: '#9a9590', cornice: 'none', noBands: true, win: { n: 1, head: 'flat', hc: '#9a9590', w: 9, h: 1.6 } },
  { at: [-1345, 106], addr: '144-150 King W, Weber Chambers (c. 1911, C. E. Cowan; designated 2024)',
    // cream dressed stone with pilasters, wide triple windows, a dentilled cornice and
    // WEBER CHAMBERS on the parapet; rough granite fieldstone piers at the street
    lv: 4, H: 15.2, wall: '#d9d3c4', trim: '#e4dfd2', sill: '#e4dfd2', band: '#c9c2b2', cornice: 'bracket',
    win: { n: 4, head: 'flat', hc: '#c9c2b2', w: 2.6, h: 2.0 }, name: 'WEBER CHAMBERS', nameBg: '#d9d3c4', nameFg: '#4a4234', nameW: 7.5, nameH: 1.2,
    pier: '#8d7f6c', bulk: '#8d7f6c' },
  { at: [-1359, 91], addr: 'One Young (158 King W, 2021, on the Mayfair Hotel site): glass, the old hotel fritted on it',
    lv: 5, H: 19.0, wall: '#5f7884', trim: '#c8ccd0', frame: '#c8ccd0', sill: '#c8ccd0', band: '#c8ccd0', cornice: 'none',
    win: { n: 9, head: 'flat', hc: '#c8ccd0', w: 2.6, h: 2.8 }, bulk: '#3a3d40', pier: '#c8ccd0', awn: false },
  { at: [-1402, 149], addr: '165 King W (ribbed metal over the shopfronts; Libro, AOK)',
    lv: 2, H: 9.0, wall: '#8c949c', trim: '#6c737a', cornice: 'none', noBands: true, win: { n: 0, sp: 99 }, pier: '#8a4a36', bulk: '#8a4a36', extra: ribs('#7d858d') },
  // ===== King St E =====
  { at: [-1139, 280], addr: '1 King E, the Germania Block (1885; CIBC)',
    // red brick over a grey stone ground storey, a dark green-black bracketed Italianate cornice, hooded heads, maroon CIBC awnings
    lv: 3, H: 12.8, wall: '#b04a3a', trim: '#1f2a24', stone: '#bdb8ae', sill: '#bdb8ae', band: '#bdb8ae', cornice: 'bracket',
    win: { head: 'hood', hc: '#bdb8ae', w: 0.9, pair: true }, pier: '#bdb8ae', bulk: '#bdb8ae', signBand: '#bdb8ae',
    shops: [{ n: 'CIBC', bg: '#c41f3e', fg: '#ffffff', serif: false, wt: '800', awn: '#6a1a24', w: 2.4 }, { n: '', awn: '#6a1a24' }] },
  { at: [-1091, 313], addr: '53-61 King E (F. W. Woolworth; Dollarama)',
    lv: 2, H: 9.6, wall: '#cfc8bc', trim: '#9a958c', cornice: 'plain', noBands: true, win: { head: 'flat', hc: '#cfc8bc', w: 1.0, h: 1.4 },
    pier: '#3a3a3c', bulk: '#3a3a3c', awn: false },
  { at: [-1035, 274], addr: '70 King E, the old TD Bank (1959, Bruce Etherington; Crabby Joe\'s)',
    // one tall storey of cream limestone on dark green marble, tapering olive-bronze fins
    lv: 1, H: 7.4, wall: '#d6c8a6', trim: '#5c5a3c', cornice: 'plain', bulk: '#2f4034', pier: '#2f4034', awn: false, extra: fins },
  { at: [-817, 395], addr: '236 King E, New City Supermarket',
    lv: 2, wall: '#d9d0c0', trim: '#6a4a32', pier: '#8d7f6c', cornice: 'none', win: { head: 'flat' }, extra: gableFront('#6a4a32', null) },
  { at: [-805, 479], addr: '265 King E, Hong Kong Plaza',
    lv: 2, wall: '#9e4a35', trim: '#c23a2a', cornice: 'none', win: { head: 'flat' }, extra: gableFront('#9e4a35', 'HONG KONG PLAZA') },

  // ===== Hespeler, Queen St =====
  // 18-24 Queen St W (Ontario Heritage Trust): the east half the 1863
  // limestone Germania House hotel, the west half yellow brick of 1893, one
  // mansard roof over both with ten round-arched dormers
  { at: [13227, 2364], addr: '18-20 Queen St W, the Germania House (1863, limestone)', lv: 2, H: 8.4,
    wall: '#a9a293', trim: '#3a3632', sill: '#c6bfae', cornice: 'bracket', win: { head: 'seg', hc: '#c6bfae' }, extra: mansardExtra(5) },
  { at: [13208, 2372], addr: '22-24 Queen St W (1893, yellow brick)', lv: 2, H: 8.4,
    wall: '#d6c08a', trim: '#3a3632', sill: '#e6dcc0', cornice: 'bracket', win: { head: 'seg', hc: '#bca870' }, extra: mansardExtra(5) },
  // 74 Queen St E: the 1928 Art Deco post office, the Fashion History Museum now
  { at: [13510, 2175], addr: '74 Queen St E, the old Hespeler post office (1928), Fashion History Museum', lv: 2, H: 9.2,
    wall: '#c9b98f', trim: '#e3d9bd', stone: '#e3d9bd', sill: '#e3d9bd', cornice: 'plain', noBands: true, ground: 'bank',
    win: { head: 'flat', hc: '#e3d9bd', w: 1.3, h: 2.2 }, sign: { n: 'FASHION HISTORY MUSEUM', bg: '#1a1a1a', fg: '#f2ead2', serif: true, w: 5.4 } },
];
/** The Walper: THE WALPER banners hung down both street faces, the black W disc over the corner. */
function walper(info) {
  const { kit, L, fronts, base, yTop } = info;
  const ban = L.panel(0.9, 5.4, 22, (q, W, H) => {
    q.fillStyle = '#141414'; q.fillRect(0, 0, W, H);
    q.fillStyle = '#e6dfcc'; q.textAlign = 'center'; q.textBaseline = 'middle';
    q.font = `700 ${W * 0.62}px ${SERIF}`;
    const s = 'THE WALPER'.replace(' ', '');
    for (let i = 0; i < s.length; i++) q.fillText(s[i], W / 2, H * (i + 0.6) / (s.length + 0.2));
  });
  for (const e of fronts.slice(0, 2)) {
    for (const t of [e.L * 0.33, e.L * 0.67]) {
      const p = e.at(t, base + 9.5, 0.7);
      hang(kit.grp(p[0], p[2]), ban.clone(), p[0], p[1], p[2], e.ux, e.uz, 0.02);
      hang(kit.grp(p[0], p[2]), ban.clone(), p[0], p[1], p[2], -e.ux, -e.uz, 0.02);
      const B = kit.B(p[0], p[2]), a = e.at(t, base + 12.3, 0), b = e.at(t, base + 12.3, 0.75);
      B.tube(a, b, 0.04, 4, lin([0.08, 0.08, 0.08]));
    }
  }
  // the W over the corner the two fronts share
  const [a, b] = fronts;
  if (!a || !b) return;
  let best = null, bd = Infinity;
  for (const p of [a.a, a.c]) for (const q of [b.a, b.c]) { const d = Math.hypot(p[0] - q[0], p[1] - q[1]); if (d < bd) { bd = d; best = p; } }
  if (!best || bd > 3) return;
  const nx = a.nx + b.nx, nz = a.nz + b.nz, nl = Math.hypot(nx, nz) || 1;
  const disc = L.panel(3.2, 3.2, 30, (q, W, H) => {
    q.clearRect(0, 0, W, H);
    q.fillStyle = '#141414'; q.beginPath(); q.arc(W / 2, H / 2, W * 0.48, 0, Math.PI * 2); q.fill();
    q.strokeStyle = '#e6dfcc'; q.lineWidth = W * 0.03; q.beginPath(); q.arc(W / 2, H / 2, W * 0.42, 0, Math.PI * 2); q.stroke();
    q.fillStyle = '#e6dfcc'; q.textAlign = 'center'; q.textBaseline = 'middle';
    q.font = `700 ${H * 0.55}px ${SERIF}`; q.fillText('W', W / 2, H * 0.54);
  });
  const x = best[0] - nx / nl * 2.2, z = best[1] - nz / nl * 2.2;
  hang(kit.grp(x, z), disc, x, yTop + 3.0, z, nx / nl, nz / nl, 0.05);
  const B = kit.B(x, z);
  B.box(x - nx / nl * 0.3, yTop + 0.9, z - nz / nl * 0.3, 0.12, 0.6, 0.12, 0, lin([0.08, 0.08, 0.08]));
}
/** THEMUSEUM's black panel with the red M, high on the King St glass. */
function theMuseum(info) {
  const { kit, L, fronts, base, yTop } = info;
  const e = fronts[0];
  if (!e) return;
  const w = Math.min(e.L * 0.45, 9), h = Math.min(yTop - base - 5.5, 7);
  const m = L.panel(w, h, 16, (q, W, H) => {
    q.fillStyle = '#111111'; q.fillRect(0, 0, W, H);
    q.fillStyle = '#e1251b'; q.textAlign = 'center'; q.textBaseline = 'middle';
    q.font = `900 ${H * 0.62}px ${SANS}`; q.fillText('M', W / 2, H * 0.42);
    q.fillStyle = '#ffffff'; q.font = `800 ${H * 0.13}px ${SANS}`; q.fillText('THEMUSEUM', W / 2, H * 0.86, W * 0.9);
  });
  const t = e.L - w / 2 - 0.6, p = e.at(t, base + 5.0 + h / 2, 0);
  hang(kit.grp(p[0], p[2]), m, p[0], p[1], p[2], e.nx, e.nz, 0.3);
}
/** The Weber Block's loggia: the two upper floors recessed behind three Ionic columns and a balustrade. */
function loggia(info) {
  const { B, fronts, base, yTop } = info;
  const e = fronts[0];
  if (!e) return;
  const N = [e.nx, 0, e.nz], W = lin([0.95, 0.95, 0.93]), SH = lin([0.10, 0.11, 0.12]);
  const y0 = base + 4.6, y1 = yTop - 1.2, t0 = 0.8, t1 = e.L - 0.8;
  // the dark recess, then the columns, the balustrade and the entablature in front of it
  B.quad(e.at(t0, y0, 0.06), e.at(t1, y0, 0.06), e.at(t1, y1, 0.06), e.at(t0, y1, 0.06), N, U0, SH);
  for (let k = 0; k < 3; k++) {
    const p = e.at(t0 + (t1 - t0) * (k + 0.5) / 3, y0, 0.45);
    B.prism(p[0], y0, p[2], 0.28, y1 - y0, 8, W);
  }
  B.quad(e.at(t0, y0 + 0.9, 0.5), e.at(t1, y0 + 0.9, 0.5), e.at(t1, y0 + 1.05, 0.5), e.at(t0, y0 + 1.05, 0.5), N, U0, W);
  for (let t = t0 + 0.2; t < t1; t += 0.35) B.quad(e.at(t, y0, 0.48), e.at(t + 0.12, y0, 0.48), e.at(t + 0.12, y0 + 0.9, 0.48), e.at(t, y0 + 0.9, 0.48), N, U0, W);
  B.quad(e.at(0, y1, 0.55), e.at(e.L, y1, 0.55), e.at(e.L, y1 + 0.9, 0.55), e.at(0, y1 + 0.9, 0.55), N, U0, W);
  B.quad(e.at(0, y1, 0), e.at(e.L, y1, 0), e.at(e.L, y1, 0.55), e.at(0, y1, 0.55), [0, -1, 0], U0, shade(W, 0.6));
  B.quad(e.at(0, y0 - 0.25, 0.5), e.at(e.L, y0 - 0.25, 0.5), e.at(e.L, y0, 0.5), e.at(0, y0, 0.5), N, U0, W);
}
/** Vertical ribs down a clad upper wall. */
function ribs(hexc) {
  return (info) => {
    const { B, fronts, base, yTop } = info, c = C(hexc);
    for (const e of fronts.slice(0, 1)) for (let t = 0.4; t < e.L - 0.2; t += 0.7) {
      B.quad(e.at(t, base + 4.4, 0.08), e.at(t + 0.18, base + 4.4, 0.08), e.at(t + 0.18, yTop + 0.8, 0.08), e.at(t, yTop + 0.8, 0.08), [e.nx, 0, e.nz], U0, c);
    }
  };
}
/** The 1959 TD's tapering bronze fins across its front. */
function fins(info) {
  const { B, fronts, base, yTop } = info, c = lin([0.36, 0.34, 0.20]);
  const e = fronts[0];
  if (!e) return;
  for (let t = 1.2; t < e.L - 0.8; t += 1.5) {
    B.quad(e.at(t - 0.12, base + 0.8, 0.5), e.at(t + 0.12, base + 0.8, 0.5), e.at(t + 0.22, yTop - 0.3, 0.5), e.at(t - 0.22, yTop - 0.3, 0.5), [e.nx, 0, e.nz], U0, c);
    B.quad(e.at(t, base + 0.8, 0), e.at(t, base + 0.8, 0.5), e.at(t, yTop - 0.3, 0.5), e.at(t, yTop - 0.3, 0), [e.ux, 0, e.uz], U0, shade(c, 0.8));
  }
}
/** A big triangular gable stood on the front, a round window in it, maybe a name. */
function gableFront(hexc, name) {
  return (info) => {
    const { B, L, kit, fronts, yTop } = info, c = C(hexc);
    const e = fronts[0];
    if (!e) return;
    const w = Math.min(e.L - 1, 14), tm = e.L / 2, y0 = yTop + 0.9, rise = w * 0.32, N = [e.nx, 0, e.nz];
    B.tri(e.at(tm - w / 2, y0, 0.1), e.at(tm + w / 2, y0, 0.1), e.at(tm, y0 + rise, 0.1), N, c);
    B.tri(e.at(tm + w / 2, y0, -0.6), e.at(tm - w / 2, y0, -0.6), e.at(tm, y0 + rise, -0.6), [-e.nx, 0, -e.nz], shade(c, 0.8));
    for (const s of [-1, 1]) {
      const a = e.at(tm + s * w / 2, y0, 0.25), b = e.at(tm, y0 + rise, 0.25), a2 = e.at(tm + s * w / 2, y0, -0.7), b2 = e.at(tm, y0 + rise, -0.7);
      B.quad(a, b, b2, a2, [s * e.ux * 0.6, 0.8, s * e.uz * 0.6], U0, lin([0.85, 0.84, 0.80]));
    }
    // the oculus
    const oy = y0 + rise * 0.42;
    for (let k = 0; k < 10; k++) {
      const a0 = k / 10 * Math.PI * 2, a1 = (k + 1) / 10 * Math.PI * 2;
      B.tri(e.at(tm, oy, 0.14), e.at(tm + Math.cos(a0) * 0.8, oy + Math.sin(a0) * 0.8, 0.14), e.at(tm + Math.cos(a1) * 0.8, oy + Math.sin(a1) * 0.8, 0.14), N, GLASS);
    }
    if (name) onWall(kit, e, tm, yTop - 0.6, text(L, Math.min(9, e.L - 1), 0.7, name, { bg: null, fg: '#ffffff', wt: '800', k: 0.66 }), 0.12);
  };
}
/** A slate mansard over a main-street block, round-headed dormers along its street face. */
function mansardExtra(nd) {
  return (info) => {
    const { B, pts, fronts, yTop } = info;
    const SL = lin([0.24, 0.25, 0.28]), TR = lin([0.86, 0.84, 0.78]), y0 = yTop + 0.9, rise = 3.0, d = 1.2;
    const P = ccw(pts), E = edges(P);
    for (const e of E) {
      B.quad(e.at(0, y0, 0.3), e.at(e.L, y0, 0.3), e.at(e.L, y0 + rise, -d), e.at(0, y0 + rise, -d), [e.nx * 0.9, 0.42, e.nz * 0.9], U0, SL);
    }
    const [cx, cz] = centroid(P);
    roof(B, P.map((q) => { const dx = cx - q[0], dz = cz - q[1], l = Math.hypot(dx, dz) || 1; return [q[0] + dx / l * d * 1.3, q[1] + dz / l * d * 1.3]; }), y0 + rise, SL);
    const f = fronts[0];
    if (!f) return;
    const n = Math.max(1, Math.min(nd, Math.floor(f.L / 2.4)));
    for (let i = 0; i < n; i++) {
      const t = f.L * (i + 0.5) / n, N = [f.nx, 0, f.nz];
      B.quad(f.at(t - 0.6, y0 + 0.3, 0.45), f.at(t + 0.6, y0 + 0.3, 0.45), f.at(t + 0.6, y0 + 2.0, 0.45), f.at(t - 0.6, y0 + 2.0, 0.45), N, U0, TR);
      B.quad(f.at(t - 0.42, y0 + 0.45, 0.5), f.at(t + 0.42, y0 + 0.45, 0.5), f.at(t + 0.42, y0 + 1.75, 0.5), f.at(t - 0.42, y0 + 1.75, 0.5), N, U0, GLASS);
      for (let k = 0; k < 4; k++) {
        const a0 = Math.PI * k / 4, a1 = Math.PI * (k + 1) / 4;
        B.tri(f.at(t, y0 + 2.0, 0.45), f.at(t + Math.cos(a0) * 0.6, y0 + 2.0 + Math.sin(a0) * 0.6, 0.45), f.at(t + Math.cos(a1) * 0.6, y0 + 2.0 + Math.sin(a1) * 0.6, 0.45), N, TR);
      }
      B.quad(f.at(t - 0.6, y0 + 0.3, 0), f.at(t - 0.6, y0 + 0.3, 0.45), f.at(t - 0.6, y0 + 2.0, 0.45), f.at(t - 0.6, y0 + 2.0, 0), [-f.ux, 0, -f.uz], U0, SL);
      B.quad(f.at(t + 0.6, y0 + 0.3, 0.45), f.at(t + 0.6, y0 + 0.3, 0), f.at(t + 0.6, y0 + 2.0, 0), f.at(t + 0.6, y0 + 2.0, 0.45), [f.ux, 0, f.uz], U0, SL);
    }
  };
}

// what a block nobody photographed for us gets, per town
const UNKNOWN = {
  kitchener: [
    { wall: '#8e4a36', trim: '#d8cfb8', cornice: 'corbel', win: { head: 'seg' } },           // red brick
    { wall: '#7a3e2e', trim: '#1e1e1e', cornice: 'bracket', win: { head: 'flat', hc: '#d8cfb8' } },
    { wall: '#a35a3e', trim: '#2b241f', cornice: 'bracket', win: { head: 'seg' } },
    { wall: '#c9b48a', trim: '#3b2e25', cornice: 'corbel', win: { head: 'seg' } },           // buff
    { wall: '#d1b17f', trim: '#2b241f', cornice: 'plain', win: { head: 'flat' } },
    { wall: '#e6e1d4', trim: '#2a2a2a', cornice: 'bracket', win: { head: 'hood', hc: '#2a2a2a' } }, // painted
    { wall: '#d9ccb0', trim: '#5a4636', cornice: 'plain', win: { head: 'flat' } },           // stucco / precast
    { wall: '#6f7478', trim: '#1c1c1c', cornice: 'plain', win: { head: 'flat', hc: '#1c1c1c' } },
  ],
  // the Stone Town: grey-buff limestone, some buff and red brick among it
  galt: [
    { wall: '#aaa395', trim: '#8a8476', sill: '#c4bdae', cornice: 'plain', win: { head: 'seg', hc: '#c4bdae' } },
    { wall: '#9e978a', trim: '#2a2a2a', sill: '#bdb6a6', cornice: 'bracket', win: { head: 'round', hc: '#bdb6a6' } },
    { wall: '#b3ab9a', trim: '#4a3e34', sill: '#cbc3b2', cornice: 'bracket', win: { head: 'flat', hc: '#cbc3b2' } },
    { wall: '#a59d8c', trim: '#7c7568', cornice: 'corbel', win: { head: 'seg' } },
    { wall: '#c9b48a', trim: '#3b2e25', cornice: 'bracket', win: { head: 'seg' } },          // buff brick
    { wall: '#8e4a36', trim: '#d8cfb8', cornice: 'corbel', win: { head: 'seg' } },           // red brick
  ],
  // Preston and Hespeler: red and yellow brick, some stone and stucco
  preston: [
    { wall: '#8e4a36', trim: '#e2d8c4', cornice: 'corbel', win: { head: 'seg' } },
    { wall: '#9a5038', trim: '#2b241f', cornice: 'bracket', win: { head: 'seg' } },
    { wall: '#d4bd8a', trim: '#3b2e25', cornice: 'bracket', win: { head: 'seg', hc: '#bfa878' } },
    { wall: '#e2d9c6', trim: '#4a3a2e', cornice: 'plain', win: { head: 'flat' } },
    { wall: '#a59d8c', trim: '#5a5248', cornice: 'plain', win: { head: 'flat', hc: '#c4bdae' } },
    { wall: '#7a3e2e', trim: '#e2d8c4', cornice: 'bracket', win: { head: 'hood', hc: '#e2d8c4' } },
  ],
};
const townOf = (x, z) => (x < 0 ? 'kitchener' : z > 8800 ? 'galt' : 'preston');
const AWN_REAL = ['#1f2a44', '#1a1a1a', '#1f4d36', '#5a1e24', '#2e3550'];

// ---------------------------------------------------------------------------------------
// The towers: [x, z, radius, look]; every box of 12 m+ whose centre is within
// the radius takes it. c: the wall family's colour (world.js FAMS space),
// glass: window wall (a slab edge every floor), panel / accent: the stacks.
// ---------------------------------------------------------------------------------------
const TOWERS = [
  // DTK Condos ("Duke Tower Kitchener", 60 Frederick St, 39 storeys, 2022, SRM): a
  // white frame round light blue glass, one full-height wing in charcoal
  [-986, 140, 22, { c: [1.02, 1.04, 1.07], panel: [0.16, 0.17, 0.20], accent: null }],
  // Charlie West (60 Charles St W, ABA): a beige spine of stacked balconies between black glass wings
  [-1485, 172, 20, { c: [0.86, 0.81, 0.72], panel: [0.13, 0.14, 0.16], accent: null }],
  // One Victoria (1 Victoria St S, 2016): dark aubergine brick-coloured panels, a darker crown
  [-1857, -43, 20, { c: [0.40, 0.33, 0.37], panel: [0.24, 0.20, 0.23], accent: null }],
  // Young Condos (55 Duke St W, 25 storeys): white and navy panels
  [-1303, 98, 22, { c: [1.04, 1.04, 1.03], panel: [0.15, 0.19, 0.31], accent: null }],
  // the Garment Street towers (100-108 Garment St, Momentum / ABA): dark blue-grey reflective glass
  [-2198, 214, 18, { glass: true, c: [0.36, 0.44, 0.53], panel: [0.62, 0.62, 0.62] }],
  [-2145, 173, 18, { glass: true, c: [0.36, 0.44, 0.53], panel: [0.62, 0.62, 0.62] }],
  [-2109, 191, 18, { glass: true, c: [0.36, 0.44, 0.53], panel: [0.62, 0.62, 0.62] }],
  // Station Park's Union Towers (VanMar, 28 and 18 storeys): smoky glass, black frames
  [-2259, -198, 22, { glass: true, c: [0.42, 0.45, 0.48], panel: [0.12, 0.12, 0.13] }],
];

// ---------------------------------------------------------------------------------------
// before meshing
// ---------------------------------------------------------------------------------------

/** After prepSights: looks onto the main-street blocks, the towers' cladding, the specials out of the king run. */
export function prepDowntown(city) {
  const S = sightsData();
  if (!S) return STATS;
  if (typeof window !== 'undefined' && window.__noDowntown) return STATS;
  // one OSM outline round a whole row of storefronts, cut back into its fronts
  const split = [];
  for (const r of S.king) {
    const [cx, cz] = centroid(r.p);
    const sp = SPLITS.find((q) => Math.hypot(q.at[0] - cx, q.at[1] - cz) < 5);
    if (!sp) { split.push(r); continue; }
    const L = Math.hypot(sp.dir[0], sp.dir[1]), d = [sp.dir[0] / L, sp.dir[1] / L];
    let t0 = Infinity, t1 = -Infinity;
    for (const q of r.p) { const t = q[0] * d[0] + q[1] * d[1]; t0 = Math.min(t0, t); t1 = Math.max(t1, t); }
    const n = Math.max(1, Math.round((t1 - t0) / sp.w));
    const pieces = [];
    for (let k = 0; k < n; k++) {
      const a0 = t0 + (t1 - t0) * k / n, a1 = t0 + (t1 - t0) * (k + 1) / n;
      // a little width per front, so the row is not a ruler's
      const j0 = k ? (hash2(k, cx | 0) - 0.5) * sp.w * 0.3 : 0, j1 = k < n - 1 ? (hash2(k + 1, cx | 0) - 0.5) * sp.w * 0.3 : 0;
      let pc = clip(r.p, [d[0] * (a0 + j0), d[1] * (a0 + j0)], d);
      pc = clip(pc, [d[0] * (a1 + j1), d[1] * (a1 + j1)], [-d[0], -d[1]]);
      if (pc.length > 2 && Math.abs(polyArea(pc)) > 25) pieces.push({ p: pc, lv: r.lv || (hash2(k, cx | 0) < 0.55 ? 2 : 3), ht: null, n: '', bt: r.bt, s: [], pal: r.pal });
    }
    r.s.forEach((s, i) => { if (pieces.length) pieces[Math.floor((i + 0.5) * pieces.length / r.s.length)].s.push(s); });
    split.push(...pieces);
    STATS.split = (STATS.split || 0) + pieces.length;
  }
  S.king.length = 0;
  S.king.push(...split);
  // the blocks drawn specially here leave meshKing's run (their boxes are already flat)
  const keep = [];
  for (const r of S.king) {
    const [cx, cz] = centroid(r.p);
    const sp = SPECIAL_KING.find((q) => Math.hypot(q.at[0] - cx, q.at[1] - cz) < 4);
    if (sp) { sp.p = r.p; STATS.custom++; continue; }
    keep.push(r);
  }
  S.king.length = 0;
  S.king.push(...keep);
  for (const r of S.king) {
    const [cx, cz] = centroid(r.p);
    let best = null, bd = 4;
    for (const L of LOOKS) {
      const d = Math.hypot(L.at[0] - cx, L.at[1] - cz);
      if (d < bd) { bd = d; best = L; }
    }
    if (best) { r.look = best; best._hit = true; STATS.looks++; }
    else {
      const town = townOf(cx, cz), U = UNKNOWN[town];
      r.look = { ...U[Math.floor(hash2(Math.round(cx), Math.round(cz)) * U.length)], addr: 'unresearched' };
      STATS.defaults++;
    }
    if (r.look.awnPal === undefined) r.look = { awnPal: AWN_REAL, awnP: 0.3, ...r.look };
  }
  for (const [x, z, rad, look] of TOWERS) {
    for (const o of city.buildingsNear(x, z, rad + 30)) {
      if (Math.hypot(o.x - x, o.z - z) > rad || o.h < 12 || (o.kw && o.kw.skip)) continue;
      if (!o.kw) o.kw = {};
      o.kw.tower = look;
      delete o._tl;
      STATS.towers++;
    }
  }
  STATS.miss = LOOKS.filter((L) => !L._hit).map((L) => L.at.join(","));
  addSights("downtown2", buildDowntown, downtownMap);
  if (typeof window !== 'undefined') window.__kwDowntown = STATS;
  return STATS;
}

// main-street rows OSM traces as one outline: { at (centroid), dir (along the street), w (a front's width) }
const SPLITS = [
  { at: [12985, 10370], dir: [1, 0.026], w: 8.5 },    // Main St south side, Water to Ainslie (the 1985 heritage district)
  { at: [13142, 10374], dir: [1, 0.026], w: 9 },      // Main St south side, Ainslie to Wellington
  { at: [13129, 10316], dir: [1, 0.026], w: 9 },      // Main St north side, Ainslie to Wellington
];
// main-street footprints drawn here instead of by meshKing: { at, fn } (fn(kit, ctx, pts))
const SPECIAL_KING = [
  { at: [13080, 10200], fn: farmersMarket },
];

// ---------------------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------------------

/** Keep the points of `pts` on the side of the line through `o` that `n` points to. */
function clip(pts, o, n) {
  const out = [];
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i], b = pts[(i + 1) % pts.length];
    const da = (a[0] - o[0]) * n[0] + (a[1] - o[1]) * n[1], db = (b[0] - o[0]) * n[0] + (b[1] - o[1]) * n[1];
    if (da >= 0) out.push(a);
    if ((da >= 0) !== (db >= 0)) {
      const t = da / (da - db);
      out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
    }
  }
  return out;
}
/** An oriented box from two ends of its long axis and a half width. */
function ob(a, b, hv) {
  const dx = b[0] - a[0], dz = b[1] - a[1], L = Math.hypot(dx, dz);
  return { x: (a[0] + b[0]) / 2, z: (a[1] + b[1]) / 2, hu: L / 2, hv, ux: dx / L, uz: dz / L };
}
/** A point of oriented box o at (u, v). */
const at = (o, u, v) => [o.x + o.ux * u - o.uz * v, o.z + o.uz * u + o.ux * v];
/**
 * A crow-stepped gable on the end of a gabled range: the stone of the gable
 * end rising in steps above the roof's slope, each step capped.
 */
function crowSteps(B, o, end, eave, ridge, wall, cap, n = 5) {
  const ux = o.ux, uz = o.uz, vx = -uz, vz = ux;
  const P = (u, v, y) => [o.x + ux * u + vx * v, y, o.z + uz * u + vz * v];
  const u = end * o.hu, N = [ux * end, 0, uz * end];
  for (let k = 0; k < n; k++) {
    const v0 = o.hv * (1 - k / n), v1 = o.hv * (1 - (k + 1) / n);
    const y1 = eave + (ridge - eave) * (k + 1) / n + 0.5;
    for (const s of [-1, 1]) {
      // the step's face, its top, and the inner face over the roof
      B.quad(P(u + 0.05 * end, s * v0, eave), P(u + 0.05 * end, s * v1, eave), P(u + 0.05 * end, s * v1, y1), P(u + 0.05 * end, s * v0, y1), N, U0, wall);
      B.quad(P(u + 0.1 * end, s * v0, y1), P(u + 0.1 * end, s * v1, y1), P(u - 0.5 * end, s * v1, y1), P(u - 0.5 * end, s * v0, y1), [0, 1, 0], U0, cap);
      B.quad(P(u - 0.5 * end, s * v0, eave), P(u - 0.5 * end, s * v1, eave), P(u - 0.5 * end, s * v1, y1), P(u - 0.5 * end, s * v0, y1), [-ux * end, 0, -uz * end], U0, shade(wall, 0.85));
    }
  }
}
/** A square tower: shaft, a band, battlements (`merlons`) or not, and a cap. */
function tower(kit, ctx, x, z, y0, h, s, rot, wall, opts = {}) {
  const B = kit.B(x, z);
  B.box(x, y0 - 1, z, s, h + 1, s, rot, wall);
  const top = y0 + h;
  if (opts.band) B.box(x, top - 0.6, z, s + 0.4, 0.6, s + 0.4, rot, opts.band);
  if (opts.merlons) {
    const c = Math.cos(rot), sn = Math.sin(rot), hs = s / 2 + 0.2, n = 4;
    for (let side = 0; side < 4; side++) {
      for (let k = 0; k < n; k++) {
        if (k % 2) continue;
        const a = -hs + (2 * hs) * (k + 0.5) / n;
        const [lu, lv] = side === 0 ? [a, -hs] : side === 1 ? [hs, a] : side === 2 ? [-a, hs] : [-hs, -a];
        B.box(x + lu * c - lv * sn, top, z + lu * sn + lv * c, 0.7, 0.9, 0.7, rot, opts.merlons);
      }
    }
  }
  if (opts.cap) pyramid(B, x, top, z, s / 2 + 0.25, opts.capH || s * 0.9, rot, opts.cap);
  ctx.solids.push({ x, z, hw: s / 2, hd: s / 2, rot, y0: y0 - 1, y1: top });
  return top;
}
/** Windows on a face of an oriented box: `n` across, floors at ys, w x h, arched heads in `arch`. */
function boxWindows(B, o, side, ys, n, w, h, glass, frame, arch = null) {
  const ux = o.ux, uz = o.uz, vx = -uz, vz = ux;
  const long = side === 0 || side === 2;
  const sg = side < 2 ? 1 : -1;
  const L = long ? o.hu : o.hv, D = long ? o.hv : o.hu;
  const N = long ? [vx * sg, 0, vz * sg] : [ux * sg, 0, uz * sg];
  const P = (t, y, off) => (long
    ? [o.x + ux * t + vx * (D + off) * sg, y, o.z + uz * t + vz * (D + off) * sg]
    : [o.x + ux * (D + off) * sg + vx * t, y, o.z + uz * (D + off) * sg + vz * t]);
  for (const y of ys) {
    for (let i = 0; i < n; i++) {
      const t = -L + (2 * L) * (i + 0.5) / n;
      B.quad(P(t - w / 2 - 0.12, y - 0.15, 0.03), P(t + w / 2 + 0.12, y - 0.15, 0.03), P(t + w / 2 + 0.12, y + h + 0.12, 0.03), P(t - w / 2 - 0.12, y + h + 0.12, 0.03), N, U0, frame);
      B.quad(P(t - w / 2, y, 0.05), P(t + w / 2, y, 0.05), P(t + w / 2, y + h, 0.05), P(t - w / 2, y + h, 0.05), N, U0, glass);
      if (arch) for (let k = 0; k < 5; k++) {
        const a0 = Math.PI * k / 5, a1 = Math.PI * (k + 1) / 5, r = w / 2;
        B.tri(P(t, y + h, 0.05), P(t + Math.cos(a0) * r, y + h + Math.sin(a0) * r, 0.05), P(t + Math.cos(a1) * r, y + h + Math.sin(a1) * r, 0.05), N, glass);
        B.quad(P(t + Math.cos(a0) * r, y + h + Math.sin(a0) * r, 0.04), P(t + Math.cos(a1) * r, y + h + Math.sin(a1) * r, 0.04),
          P(t + Math.cos(a1) * (r + 0.3), y + h + Math.sin(a1) * (r + 0.3), 0.04), P(t + Math.cos(a0) * (r + 0.3), y + h + Math.sin(a0) * (r + 0.3), 0.04), N, U0, arch);
      }
    }
  }
}
const GLASS = lin([0.13, 0.17, 0.21]);

// ---------------------------------------------------------------------------------------
// GALT
// ---------------------------------------------------------------------------------------

// GALT COLLEGIATE INSTITUTE (1852-54, added to 1859-1925; historicplaces.ca
// 10092): Scottish Baronial in the fossil limestone quarried from its own
// river bank -- crow-stepped gables, two stone towers, slate roofs; the
// 1963 north wing in brick. The aerial: the old school is the slate-roofed
// range along the bank's top, x 12646-12690, z 9185-9290 (16 deg off north),
// a cross wing at its south end, the towers' green copper caps at
// (12664, 9194) and (12676, 9236); the flat-roofed later wings north and west.
const GCI_U = [0.24, 0.97];
const GCI_RANGE = ob([12657, 9196], [12672, 9262], 10);
const GCI_SOUTH = ob([12658, 9281], [12694, 9272], 8);
const GCI_TOWERS = [[12664, 9194, 6.2, 25], [12679, 9236, 5.4, 22]];
function gci(kit, ctx) {
  const S = sightsData();
  const pts = ccw(S.b.gci.p);
  const STONE = C('#8e887a'), STONE2 = C('#a8a294'), SLATE = C('#46474a'), COPPER = lin([0.37, 0.61, 0.54]);
  // the 1963 wing (brick, north of the line) and the stone school
  const o = [12650, 9203], n = GCI_U;
  const modern = clip(pts, o, [-n[0], -n[1]]), old = clip(pts, o, n);
  if (modern.length > 2) block(kit, ctx, modern, {
    h: 9.5, wall: C('#a08c74'), trim: C('#7c6e5e'), parapet: 0.6,
    win: { style: 'punch', sp: 2.6, w: 1.6, h: 1.7, fl: 3.6, g0: 1.0 },
  });
  if (old.length < 3) return;
  const r = block(kit, ctx, old, {
    h: 11.5, wall: STONE, trim: STONE2, parapet: 0.4, cornice: 0.5,
    win: { style: 'punch', sp: 3.2, w: 1.2, h: 2.2, fl: 3.7, g0: 1.3, arch: STONE2, sill: STONE2 }, frame: lin([0.85, 0.85, 0.82]),
  });
  const base = r.base, eave = base + 11.9;
  const B = kit.B(r.cx, r.cz);
  // the slate ranges, their gable ends crow-stepped
  for (const [g, ridge] of [[GCI_RANGE, 8.5], [GCI_SOUTH, 7]]) {
    gabled(B, g, eave - 0.2, eave, eave + ridge, STONE, SLATE, { overhang: 0.15 });
    crowSteps(B, g, 1, eave, eave + ridge, STONE, STONE2);
    crowSteps(B, g, -1, eave, eave + ridge, STONE, STONE2);
    // dormers down the slope toward the playing field
    for (let k = -2; k <= 2; k++) {
      const [dx, dz] = at(g, k * g.hu * 0.32, g.hv * 0.55);
      B.box(dx, eave, dz, 2.2, 2.6, 2.4, Math.atan2(g.uz, g.ux), STONE);
      pyramid(B, dx, eave + 2.6, dz, 1.3, 1.3, Math.atan2(g.uz, g.ux), SLATE);
    }
  }
  // the two towers: stone shafts, corbelled battlements, the copper caps the aerial sees
  const rot = Math.atan2(GCI_U[1], GCI_U[0]);
  for (const [x, z, s, h] of GCI_TOWERS) {
    const top = tower(kit, ctx, x, z, base, h - 4, s, rot, STONE, { band: STONE2, merlons: STONE });
    const tb = kit.B(x, z);
    tb.box(x, top, z, s * 0.62, 1.4, s * 0.62, rot, STONE);
    pyramid(tb, x, top + 1.4, z, s * 0.36, 3.2, rot, COPPER);
    // tall arched windows on the shaft
    const ox = { x, z, hu: s / 2, hv: s / 2, ux: Math.cos(rot), uz: Math.sin(rot) };
    for (let side = 0; side < 4; side++) boxWindows(tb, ox, side, [base + 13.5, base + h - 8.5], 1, 1.1, 2.6, GLASS, STONE2, STONE2);
  }
  // the name on the stone over the east door
  const f = frontEdge(ctx.city, r.E, /^Water Street/, 8, 160) || r.E[0];
  if (f) onWall(kit, f, f.L / 2, base + 4.4, text(ctx.atlas, Math.min(9, f.L - 2), 0.9, 'GALT COLLEGIATE INSTITUTE', { bg: null, fg: '#3e3a32', font: SERIF, wt: '700', k: 0.58 }), 0.06);
  STATS.gci = { old: old.length, modern: modern.length };
}

// CENTRAL PRESBYTERIAN (1880-82, 7 Queen's Square): Gothic Revival in granite
// and limestone, a patterned slate roof, the tower with its 56 m spire (ten
// bells). The aerial: the slate church is x 12812-12833, z 10272-10315 with
// the tower in the middle of its Main St (south) front and a transept two
// thirds of the way back; the flat-roofed hall behind it (north).
function centralPres(kit, ctx) {
  const S = sightsData();
  const pts = ccw(S.b.cpres.p);
  const STONE = C('#85827a'), STONE2 = C('#a6a297'), SLATE = C('#3e4044');
  const hall = clip(pts, [12823, 10272], [0, -1]);
  if (hall.length > 2) block(kit, ctx, hall, { h: 6.5, wall: STONE, trim: STONE2, parapet: 0.5, win: { style: 'punch', sp: 3.4, w: 1.2, h: 2.0, fl: 3.4, g0: 1.2, arch: STONE2 } });
  const nave = ob([12822.5, 10316], [12822.5, 10273], 10.3);
  const base = T(12822, 10300);
  const B = kit.B(12822, 10294);
  const eave = base + 10.5;
  gabled(B, nave, base - 1.5, eave, eave + 9, STONE, SLATE, { overhang: 0.35 });
  const tr = ob([12809.5, 10287], [12835.5, 10287], 5.8);
  gabled(B, tr, base - 1.5, eave, eave + 7, STONE, SLATE, { overhang: 0.35 });
  // the lancets down the nave and the transept's big traceried windows
  boxWindows(B, nave, 0, [base + 2.8], 5, 1.3, 4.6, lin([0.18, 0.20, 0.30]), STONE2, STONE2);
  boxWindows(B, nave, 2, [base + 2.8], 5, 1.3, 4.6, lin([0.18, 0.20, 0.30]), STONE2, STONE2);
  boxWindows(B, tr, 1, [base + 3.2], 1, 3.6, 5.6, lin([0.22, 0.20, 0.32]), STONE2, STONE2);
  boxWindows(B, tr, 3, [base + 3.2], 1, 3.6, 5.6, lin([0.22, 0.20, 0.32]), STONE2, STONE2);
  // buttresses
  for (const s of [-1, 1]) for (let k = -2; k <= 2; k++) {
    const [x, z] = at(nave, k * nave.hu * 0.38, s * (nave.hv + 0.4));
    B.box(x, base - 1, z, 0.8, eave - base - 1.5, 0.9, Math.atan2(nave.uz, nave.ux), STONE2);
  }
  // the tower and its spire: stone to the belfry, a broach spire in slate, corner pinnacles
  const tx = 12822.5, tz = 10311.5, ts = 6.8, rot = 0;
  const top = tower(kit, ctx, tx, tz, base, 27, ts, rot, STONE, { band: STONE2 });
  const tb = kit.B(tx, tz);
  const ox = { x: tx, z: tz, hu: ts / 2, hv: ts / 2, ux: 1, uz: 0 };
  for (let side = 0; side < 4; side++) boxWindows(tb, ox, side, [top - 6.5], 2, 0.9, 3.6, lin([0.10, 0.10, 0.11]), STONE2, STONE2);
  boxWindows(tb, ox, 3, [base + 0.2], 1, 2.0, 3.4, lin([0.30, 0.20, 0.14]), STONE2, STONE2);
  // an octagonal spire to 56 m
  const sh = base + 56 - top;
  {
    const r0 = ts / 2 - 0.2, n = 8, apex = [tx, top + sh, tz];
    for (let k = 0; k < n; k++) {
      const a0 = (k + 0.5) / n * Math.PI * 2, a1 = (k + 1.5) / n * Math.PI * 2;
      const p0 = [tx + Math.cos(a0) * r0, top, tz + Math.sin(a0) * r0], p1 = [tx + Math.cos(a1) * r0, top, tz + Math.sin(a1) * r0];
      const am = (a0 + a1) / 2;
      tb.tri(p1, p0, apex, [Math.cos(am) * 0.98, 0.15, Math.sin(am) * 0.98], SLATE);
    }
    for (const [a, b] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
      const px = tx + a * (ts / 2 - 0.3), pz = tz + b * (ts / 2 - 0.3);
      tb.box(px, top, pz, 0.8, 1.2, 0.8, 0, STONE2);
      pyramid(tb, px, top + 1.2, pz, 0.45, 3.4, 0, STONE2);
    }
    tb.prism(tx, top + sh, tz, 0.06, 2.2, 4, lin([0.15, 0.15, 0.15]));
  }
  STATS.cpres = { top: Math.round(top - base), spire: Math.round(base + 56) };
}

// THE GALT TOWN HALL (1857-58; historicplaces.ca 7606): split fieldstone,
// two and a half storeys under a low slate gable, round-arched windows with
// keystones, the square front tower with four clock faces and the 1897
// open arched belfry under a mansard cap.
function galtHall(kit, ctx) {
  const S = sightsData();
  const pts = ccw(S.b.galthall.p);
  const STONE = C('#8f8a80'), DRESS = C('#c2bbac'), SLATE = C('#4a4d52');
  const r = block(kit, ctx, pts, {
    h: 9.2, wall: STONE, trim: DRESS, parapet: 0, cornice: 0.45,
    win: { style: 'punch', sp: 3.0, w: 1.15, h: 2.3, fl: 4.0, g0: 1.4, arch: DRESS, sill: DRESS }, frame: lin([0.88, 0.88, 0.85]),
  });
  const o = obb(r.pts);
  // the low gable over the whole
  roof(r.B, r.pts, r.yTop - 0.02, SLATE);
  gabled(r.B, { ...o, hu: o.hu - 0.1, hv: o.hv - 0.1 }, r.yTop - 0.05, r.yTop, r.yTop + o.hv * 0.45, STONE, SLATE, { overhang: 0.3, ridgeAlongV: false });
  // the tower on the front toward Dickson St
  const f = frontEdge(ctx.city, r.E, /^Dickson/, 6, 60) || r.E[0];
  const ts = 4.6, p = f.at(f.L / 2, 0, ts / 2 - 0.6), rot = Math.atan2(f.uz, f.ux);
  const top = tower(kit, ctx, p[0], p[2], r.base, 17, ts, rot, STONE, { band: DRESS });
  const tb = kit.B(p[0], p[2]);
  // the clocks, the open belfry (piers at the corners), the mansard cap
  const clock = clockFace(ctx.atlas, 2.2);
  const c = Math.cos(rot), sn = Math.sin(rot);
  for (const [a, b] of [[0, 1], [0, -1], [1, 0], [-1, 0]]) {
    const nx = a * c - b * sn, nz = a * sn + b * c;
    hang(kit.grp(p[0], p[2]), clock.clone(), p[0] + nx * ts / 2, top - 2.2, p[2] + nz * ts / 2, nx, nz, 0.06);
  }
  for (const [a, b] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
    const lu = a * (ts / 2 - 0.5), lv = b * (ts / 2 - 0.5);
    tb.box(p[0] + lu * c - lv * sn, top, p[2] + lu * sn + lv * c, 0.9, 3.4, 0.9, rot, DRESS);
  }
  tb.box(p[0], top + 3.4, p[2], ts + 0.3, 0.5, ts + 0.3, rot, DRESS);
  // the mansard: steep sides, a low pyramid over
  const y = top + 3.9, hs = ts / 2 + 0.1, hi = ts / 2 - 0.7;
  const corner = (h2, a, b) => [p[0] + a * h2 * c - b * h2 * sn, 0, p[2] + a * h2 * sn + b * h2 * c];
  const CN = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
  for (let i = 0; i < 4; i++) {
    const [a0, b0] = CN[i], [a1, b1] = CN[(i + 1) % 4];
    const q0 = corner(hs, a0, b0), q1 = corner(hs, a1, b1), w0 = corner(hi, a0, b0), w1 = corner(hi, a1, b1);
    const mx = (q0[0] + q1[0]) / 2 - p[0], mz = (q0[2] + q1[2]) / 2 - p[2], ml = Math.hypot(mx, mz) || 1;
    tb.quad([q0[0], y, q0[2]], [q1[0], y, q1[2]], [w1[0], y + 2.6, w1[2]], [w0[0], y + 2.6, w0[2]], [mx / ml * 0.9, 0.4, mz / ml * 0.9], U0, SLATE);
  }
  pyramid(tb, p[0], y + 2.6, p[2], hi, 1.0, rot, SLATE);
  tb.prism(p[0], y + 3.6, p[2], 0.05, 1.8, 4, lin([0.12, 0.12, 0.12]));
}

// THE CAMBRIDGE FARMERS' MARKET (40 Dickson St; historicplaces.ca 9766):
// the 1887 market hall in buff brick with soft red quoins and base courses
// (the red paint came off in 2002), a hip roof broken by a pediment, a dentil
// cornice, 6-over-6 sash under radiating voussoirs, the verandah down the east
// side; the 1896-97 two-storey addition in red pressed brick with its arcaded
// entrance tower under a bell-cast pyramid toward Dickson and Ainslie.
function farmersMarket(kit, ctx, pts) {
  pts = ccw(pts);
  const BUFF = C('#d9c48e'), RED = C('#9a4a36'), ROOF = C('#5a5552'), TRIM = C('#e9e2cc');
  const r = block(kit, ctx, pts, {
    h: 6.2, wall: BUFF, trim: TRIM, parapet: 0, cornice: 0.35, plinth: [0.9, RED],
    win: { style: 'punch', sp: 2.6, w: 1.1, h: 2.3, fl: 4, g0: 1.2, arch: RED, sill: TRIM }, frame: lin([0.92, 0.92, 0.88]),
  });
  const o = obb(r.pts);
  hipRoof(r.B, o, r.yTop, Math.min(4.5, o.hv * 0.75), ROOF, 0.45);
  // red quoins at every corner
  for (const e of r.E) {
    if (e.L < 3) continue;
    const gy = T(e.mx + e.nx * 2, e.mz + e.nz * 2);
    for (let y = gy + 0.9; y < r.yTop - 0.4; y += 0.6) {
      const w2 = (Math.round(y / 0.6) % 2) ? 0.45 : 0.75;
      B4(r.B, e, 0, w2, y, y + 0.5, 0.05, [e.nx, 0, e.nz], RED);
    }
  }
  // the entrance tower toward Dickson St: red brick, paired arches, the bell-cast pyramid
  const f = frontEdge(ctx.city, r.E, /^Dickson/, 4, 50) || r.E[0];
  const ts = 4.2, p = f.at(Math.min(f.L - ts / 2, f.L * 0.8), 0, -ts / 2 + 0.8), rot = Math.atan2(f.uz, f.ux);
  const top = tower(kit, ctx, p[0], p[2], r.base, 11.5, ts, rot, RED, { band: TRIM });
  const tb = kit.B(p[0], p[2]);
  const ox = { x: p[0], z: p[2], hu: ts / 2, hv: ts / 2, ux: Math.cos(rot), uz: Math.sin(rot) };
  for (let side = 0; side < 4; side++) boxWindows(tb, ox, side, [top - 3.4], 2, 0.6, 1.6, GLASS, TRIM, TRIM);
  for (let side = 0; side < 4; side++) boxWindows(tb, ox, side, [r.base + 0.1], 1, 1.8, 2.6, lin([0.25, 0.17, 0.12]), TRIM, RED);
  // bell-cast: a flared skirt, then the pyramid
  tb.box(p[0], top, p[2], ts + 1.0, 0.25, ts + 1.0, rot, TRIM);
  pyramid(tb, p[0], top + 0.25, p[2], ts / 2 + 0.5, 1.0, rot, ROOF);
  pyramid(tb, p[0], top + 0.9, p[2], ts / 2 - 0.1, 3.4, rot, ROOF);
  // the verandah down one long side (posts and a lean-to roof)
  const long = r.E.filter((e) => e.L > 8).sort((a, b) => b.L - a.L)[0];
  if (long && long !== f) {
    const gy = T(long.mx + long.nx * 2, long.mz + long.nz * 2);
    const N = [long.nx * 0.3, 0.95, long.nz * 0.3];
    r.B.quad(long.at(0.5, gy + 3.4, 0), long.at(long.L - 0.5, gy + 3.4, 0), long.at(long.L - 0.5, gy + 2.9, 2.6), long.at(0.5, gy + 2.9, 2.6), N, U0, ROOF);
    r.B.quad(long.at(0.5, gy + 3.38, 0), long.at(long.L - 0.5, gy + 3.38, 0), long.at(long.L - 0.5, gy + 2.88, 2.6), long.at(0.5, gy + 2.88, 2.6), [-N[0], -N[1], -N[2]], U0, shade(TRIM, 0.6));
    for (let t = 0.8; t < long.L - 0.4; t += 3) { const q = long.at(t, gy, 2.4); r.B.box(q[0], gy - 0.2, q[2], 0.2, 3.1, 0.2, 0, TRIM); }
  }
  // the name over the door
  onWall(kit, f, f.L * 0.4, r.base + 4.6, text(ctx.atlas, Math.min(8, f.L * 0.6), 0.75, "CAMBRIDGE FARMERS' MARKET", { bg: '#1f3a2c', fg: '#f2ead2', font: SERIF, wt: '700', k: 0.56 }), 0.1);
}

// ---------------------------------------------------------------------------------------
// CAMBRIDGE CENTRE (355 Hespeler Rd), from the 2026 aerial: the Bay's
// two-storey box at the north end (closed June 2025, painted cherry red in
// 2026), the concourse south from it under a run of skylights, the
// food court and the cinema in the middle, the old Sears box to the east
// (Urban Planet, Kingpin's lanes), and the south anchor (the old Zellers /
// Target) split into Mark's, Sport Chek and Marshalls facing the lot.
// ---------------------------------------------------------------------------------------
const CC_BAY = [[12405, 6326], [12528, 6326], [12528, 6416], [12405, 6416]];
const CC_SOUTH = [[12470, 6636], [12608, 6626], [12608, 6750], [12470, 6750]];
const CC_EAST = [[12620, 6512], [12740, 6512], [12740, 6634], [12620, 6634]];
const CC_SPINE = [[12478, 6420], [12484, 6630]];
const CC_LOOK = {
  mall: { h: 8.0, wall: '#cfc2aa', band: '#6b5a48' },
  bay: { h: 13.0, wall: '#b0202a', band: '#8a1820' },
  south: { h: 9.5, wall: '#d6d2c8', band: '#5c5f63' },
  east: { h: 11.0, wall: '#c9bda6', band: '#6b5a48' },
};
const CC_ANCHORS = [["Mark's", 12487, 6679, 6], ['Sport Chek', 12513, 6709, 9], ['Marshalls', 12532, 6670, 9]];
const CC_DOORS = [[12445, 6440, 1], [12460, 6580, 1], [12595, 6430, 0], [12700, 6634, 0]];
function ccZone(x, z) {
  if (inPoly(CC_BAY, x, z)) return 'bay';
  if (inPoly(CC_SOUTH, x, z)) return 'south';
  if (inPoly(CC_EAST, x, z)) return 'east';
  return 'mall';
}
function cambridgeCentre(kit, ctx) {
  const S = sightsData(), city = ctx.city, L = ctx.atlas;
  const pts = ccw(simplify(S.b.ccentre.p, 1.2));
  const [cx, cz] = centroid(pts);
  const B = kit.B(cx, cz);
  let lo = Infinity;
  for (const q of pts) lo = Math.min(lo, T(q[0], q[1]));
  const base = T(cx, cz);
  const E = edges(pts);
  const zoneOf = (e) => ccZone(e.mx - e.nx * 6, e.mz - e.nz * 6);
  const BASEC = lin([0.48, 0.44, 0.40]);
  for (const e of E) {
    const zn = zoneOf(e), Z = CC_LOOK[zn], yTop = base + Z.h, wall = C(Z.wall), band = C(Z.band), N = [e.nx, 0, e.nz];
    e.zone = zn; e.yTop = yTop;
    B.quad(e.at(0, lo - 1.2), e.at(e.L, lo - 1.2), e.at(e.L, yTop + 0.9), e.at(0, yTop + 0.9), N, U0, [shade(wall, 0.8), shade(wall, 0.8), wall, wall]);
    B.quad(e.at(0, yTop + 0.9, 0.12), e.at(e.L, yTop + 0.9, 0.12), e.at(e.L, yTop + 1.0, 0), e.at(0, yTop + 1.0, 0), [0, 1, 0], U0, band);
    ctx.solids.push({ x: e.mx, z: e.mz, hw: e.L / 2 + 0.2, hd: 0.35, rot: Math.atan2(e.uz, e.ux), y0: lo - 1.2, y1: yTop + 0.9 });
    if (e.L < 3) continue;
    const gy = T(e.mx + e.nx * 2, e.mz + e.nz * 2);
    B4(B, e, 0, e.L, yTop - 1.4, yTop + 0.9, 0.22, N, band);
    B4(B, e, 0, e.L, yTop - 1.41, yTop - 1.4, 0.22, [0, -1, 0], shade(band, 0.5));
    if (zn !== 'bay') B4(B, e, 0, e.L, gy - 0.4, gy + 0.9, 0.05, N, BASEC);
    // ribbed precast on the mall, painted panels on the Bay
    const ribs = zn === 'bay' ? 6 : 8;
    for (let t = ribs / 2; t < e.L - 1; t += ribs) B4(B, e, t - 0.3, t + 0.3, gy + 0.9, yTop - 1.4, 0.1, N, shade(wall, zn === 'bay' ? 0.86 : 1.06));
  }
  // roofs: the mall, then the taller boxes over their zones
  roof(B, pts, base + 8.0, lin([0.62, 0.62, 0.60]));
  for (const zn of ['bay', 'south', 'east']) {
    const poly = zn === 'bay' ? CC_BAY : zn === 'south' ? CC_SOUTH : CC_EAST;
    const inner = pts.filter((q) => inPoly(poly, q[0], q[1]));
    const o = obb(inner.length > 3 ? inner : poly);
    const Z = CC_LOOK[zn], rot = Math.atan2(o.uz, o.ux);
    B.box(o.x, base + 7.8, o.z, o.hu * 2 - 1, Z.h - 7.8 + 0.9, o.hv * 2 - 1, rot, C(Z.wall), { top: false });
    B.box(o.x, base + Z.h + 0.6, o.z, o.hu * 2 - 1.6, 0.05, o.hv * 2 - 1.6, rot, zn === 'south' ? lin([0.86, 0.86, 0.84]) : lin([0.50, 0.50, 0.49]), { sides: false });
  }
  // the cinema's white roof in the middle, and plant
  B.box(12584, base + 7.8, 6586, 46, 4.2, 44, 0, C('#cfc2aa'), { top: false });
  B.box(12584, base + 12.0, 6586, 45, 0.05, 43, 0, lin([0.88, 0.88, 0.86]), { sides: false });
  for (let i = 0; i < 26; i++) {
    const x = 12420 + hash2(i, 71) * 300, z = 6340 + hash2(i, 72) * 400;
    if (!inPoly(pts, x, z)) continue;
    const zn = ccZone(x, z), y = base + (zn === 'mall' ? 8.0 : CC_LOOK[zn].h + 0.6);
    if (Math.abs(x - 12584) < 24 && Math.abs(z - 6586) < 23) continue;
    B.box(x, y, z, 2.4 + hash2(i, 73) * 2.2, 1.4, 1.9, 0, lin([0.68, 0.69, 0.70]));
  }
  // the skylights down the concourse
  {
    const [a, b] = CC_SPINE, dx = b[0] - a[0], dz = b[1] - a[1], len = Math.hypot(dx, dz), rot = Math.atan2(dz, dx);
    const GLC = lin([0.30, 0.37, 0.41]), CW = C('#cfc2aa');
    for (let k = 0; k < 9; k++) {
      const s = (k + 0.5) / 9, x = a[0] + dx * s, z = a[1] + dz * s;
      B.box(x, base + 8.0, z, len / 9 - 6, 1.0, 7, rot, CW, { top: false });
      pyramid(B, x, base + 9.0, z, 3.4, 1.6, rot, GLC);
    }
  }
  // the anchors' fronts toward the lot
  const used = new Set();
  for (const [name, x, z, w] of CC_ANCHORS) {
    const f = nearestEdge(E, x, z, Math.max(w + 2, 8));
    if (!f || f.d > 30) continue;
    const e = f.e, t = Math.max(w / 2 + 1, Math.min(e.L - w / 2 - 1, f.t));
    used.add(e);
    storeFront(kit, ctx, e, t, e.yTop, name, w, C(CC_LOOK[e.zone].wall), 'parapet');
  }
  // the Bay's empty box: red, its doors papered over
  {
    const f = nearestEdge(E, 12405, 6390, 20);
    if (f) {
      const e = f.e, gy = T(e.mx + e.nx * 2, e.mz + e.nz * 2);
      B4(kit.B(e.mx, e.mz), e, f.t - 5, f.t + 5, gy - 0.2, gy + 3.6, 0.12, [e.nx, 0, e.nz], lin([0.82, 0.80, 0.76]));
      used.add(e);
    }
  }
  // the mall's doors: glazed gables with the name on the two toward Hespeler Rd
  const cc = (w) => L.panel(w, w * 0.16, 40, (q, W, H) => {
    q.clearRect(0, 0, W, H);
    q.fillStyle = '#ffffff'; q.textAlign = 'center'; q.textBaseline = 'middle';
    q.font = `700 ${H * 0.66}px ${SANS}`; q.fillText('Cambridge Centre', W / 2, H * 0.55, W * 0.97);
  });
  for (const [x, z, main] of CC_DOORS) {
    const f = nearestEdge(E, x, z, 10);
    if (!f || f.d > 25) continue;
    const e = f.e, t = Math.max(8, Math.min(e.L - 8, f.t));
    if (main) atriumEntrance(kit, ctx, e, t, 12, e.yTop + 3.5, cc(9));
    else entrance(kit, ctx, e, t, 8, 4.2, null, { can: C('#6b5a48') });
  }
  // the pylon on Hespeler Rd
  const k = street(city, 12330, 6520, 120, /^Hespeler Road/);
  if (k) {
    const nx = (cx - k.qx) / k.d, nz = (cz - k.qz) / k.d;
    let x = k.qx + nx * (k.hw + 8), z = k.qz + nz * (k.hw + 8);
    for (let i = 0; i < 10 && (city.onRoad(x, z, 3) || boxAt(city, x, z, 2)); i++) { x += k.ex * 8; z += k.ez * 8; }
    if (!city.onRoad(x, z, 2)) pylon(kit, ctx, x, z, Math.atan2(k.ex, k.ez), 'CAMBRIDGE CENTRE', '355 HESPELER RD',
      [['SPORT CHEK', '#e31837', '#ffffff'], ['Marshalls', '#0b2d6b', '#ffffff'], ["Mark's", '#c8102e', '#ffffff'], ['GALAXY CINEMAS', '#111111', '#f6c400'], ['H&M', '#ffffff', '#e50010'], ['Dollarama', '#00a651', '#ffe600']], '#3a3f46');
  }
  STATS.cc = { edges: E.length, used: used.size };
}

// ---------------------------------------------------------------------------------------
// KITCHENER PUBLIC LIBRARY, 85 Queen St N (the 1962 building, reopened 2014
// by LGA Architectural Partners): the glass front on Queen St
// ---------------------------------------------------------------------------------------
function library(kit, ctx) {
  const S = sightsData();
  const pts = ccw(S.b.kpl.p);
  const r = block(kit, ctx, pts, {
    // the wings: warm tan split stone
    h: 10.5, wall: C('#a88a70'), trim: C('#c9b49c'), parapet: 0.6,
    win: { style: 'ribbon', fl: 4.4, g0: 1.2, h: 2.4 },
  });
  const f = frontEdge(ctx.city, r.E, /^Queen Street/, 8, 60) || r.E[0];
  const N = [f.nx, 0, f.nz], GL = C('#7f9a95'), GL2 = C('#a9c0bb'), FR = C('#c9cdcf');
  // the full-height glass front: clear, faintly green, silver mullions, a floor line
  B4(r.B, f, 0.6, f.L - 0.6, r.base - 0.2, r.yTop + 0.6, 0.3, N, [GL, GL, GL2, GL2]);
  for (let t = 0.6; t <= f.L - 0.6 + 1e-3; t += 1.6) B4(r.B, f, t - 0.06, t + 0.06, r.base - 0.2, r.yTop + 0.6, 0.34, N, FR);
  B4(r.B, f, 0.6, f.L - 0.6, r.base + 5.0, r.base + 5.3, 0.34, N, FR);
  B4(r.B, f, 0.4, f.L - 0.4, r.yTop + 0.6, r.yTop + 1.0, 0.36, N, FR);
  // the big white name on the glass, and the pinwheel
  const w = Math.min(16, f.L - 4);
  onWall(kit, f, f.L / 2 + 1.2, r.base + 7.6, text(ctx.atlas, w, 1.5, 'Kitchener Public Library', { bg: null, fg: '#ffffff', wt: '700', k: 0.66, px: 20 }), 0.38);
  const pin = ctx.atlas.panel(1.8, 1.8, 30, (q, W, H) => {
    q.clearRect(0, 0, W, H);
    ['#6cbf45', '#2a8fd6', '#e6407c', '#f4c21b'].forEach((c, i) => {
      q.fillStyle = c; q.save(); q.translate(W / 2, H / 2); q.rotate(i * Math.PI / 2);
      q.beginPath(); q.moveTo(0, 0); q.lineTo(W * 0.45, -H * 0.05); q.lineTo(W * 0.1, -H * 0.42); q.closePath(); q.fill(); q.restore();
    });
  });
  onWall(kit, f, f.L / 2 - w / 2 - 0.4, r.base + 7.6, pin, 0.38);
}

// ---------------------------------------------------------------------------------------
// the extra
// ---------------------------------------------------------------------------------------

function buildDowntown(kit, ctx) {
  const S = sightsData();
  const run = (name, fn) => { try { fn(); } catch (e) { console.warn('kwdowntown ' + name + ': ' + (e.stack || e.message)); STATS.err = (STATS.err || []).concat(name + ': ' + e.message); } };
  if (S.b.gci) run('gci', () => gci(kit, ctx));
  if (S.b.cpres) run('cpres', () => centralPres(kit, ctx));
  if (S.b.galthall) run('galthall', () => galtHall(kit, ctx));
  if (S.b.ccentre) run('ccentre', () => cambridgeCentre(kit, ctx));
  if (S.b.kpl) run('kpl', () => library(kit, ctx));
  for (const sp of SPECIAL_KING) if (sp.p) run(sp.fn.name, () => sp.fn(kit, ctx, sp.p));
}

function downtownMap(m) {
  const S = sightsData();
  const out = [];
  const add = (k, ...a) => { if (S.b[k]) out.push(m(k, ...a)); };
  add('gci', false, 'Galt Collegiate Institute', 'Galt Collegiate Institute, 200 Water St N (1852) — Scottish Baronial in the river bank\'s own limestone');
  add('cpres', false, 'Central Presbyterian Church', 'Central Presbyterian, Queen\'s Square (1882) — granite and limestone, a 56 m spire and ten bells');
  add('galthall', false, 'Galt Town Hall', 'The old Galt Town Hall, 46 Dickson St (1858) — fieldstone, and the clock tower\'s 1897 belfry');
  add('ccentre', 'Cambridge Centre', 'Cambridge Centre', 'Cambridge Centre, 355 Hespeler Rd — Sport Chek, Marshalls, Galaxy Cinemas; the Bay\'s box stands empty, painted red');
  add('kpl', false, 'Kitchener Public Library', 'Kitchener Public Library, 85 Queen St N — the 2014 glass front');
  const fm = SPECIAL_KING.find((q) => q.fn === farmersMarket);
  if (fm && fm.p) out.push(m(centroid(fm.p), false, "Cambridge Farmers' Market", "Cambridge Farmers' Market, 40 Dickson St (1887) — Saturdays since the market hall went up"));
  return out;
}

export function downtownStats() { return STATS; }
export { LOOKS, TOWERS };
