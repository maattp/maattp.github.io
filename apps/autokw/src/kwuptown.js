// UPTOWN WATERLOO, BUILDING BY BUILDING. kwplaces.js draws King St's blocks
// from their OSM footprints (meshKing); this file gives each of them its real
// look -- brick colour, height, window rhythm and heads, cornice, storefronts
// and signs as they read -- and draws Uptown's other buildings and the King St
// N bike lanes.
//
// Sources (Oct 2026): the City of Waterloo's Heritage Register and its June
// 2026 Notices of Intention to Designate (15, 16-24, 23-25 King N, 36-40 King
// S: the heritage-attribute text and the staff photos), historicwaterloo.ca and
// historicplaces.ca building pages, Wikimedia Commons photos 2010-2026 (the
// Huether 2020, the Waterloo Hotel 2010/2012, 4-6 King S 2013, the Duke 2024,
// the Molsons Bank 2020, Princess Twin and the Original Princess 2025/26, the
// Seagram Lofts 2019/25, City Centre 2025, the library 2026, the Marsland
// Centre 2013, the Uptown Parkade), OSM's tags. Colours are read off those
// photos (hex estimates, not specifications). Where a building's look could
// not be found it gets a plausible Uptown palette (buff "Waterloo white"
// brick, red brick, painted brick, stucco) -- see UNKNOWN below, never the old
// green/teal/purple tones.
//
// Everything is drawn inside kwplaces.js's uptown run (addUptown): the same
// Kit, the same two vertex-coloured materials, the same lettering atlas, so a
// cluster holding it is not one draw more.

import { hash2 } from './util.js';
import { boxAt } from './kw.js';
import {
  inPoly, polyArea, centroid, edges, hang, roof, lin, shade, hex, SANS, SERIF, U0, T, walkY, street,
  addUptown, placesData,
} from './kwplaces.js';
import { block, frontEdge, text } from './kwsights.js';

const STATS = { looks: 0, skipped: 0, defaults: 0, bollards: 0 };
const ccw = (p) => (polyArea(p) < 0 ? p.slice().reverse() : p);
const C = (h) => lin(hex(h));

// awnings as Uptown has them: plain dark canvas, on a third of the shopfronts
const AWN_REAL = ['#1f2a44', '#1a1a1a', '#1f4d36', '#5a1e24', '#2e3550'];

// ---------------------------------------------------------------------------------------
// King St's looks, keyed by the footprint's centroid (kw.json places.king; the
// OSM address beside each). Fields (all optional), read by kwplaces.js meshKing:
//   wall, trim, stone, sill, band, frame, bulk, pier, quoin, signBand: sRGB hex
//   lv (storeys), H (parapet height over the pavement, m), gf (ground floor), fp (floor pitch)
//   win: { n (windows across the main face), ns (the side face), m (margin), w, h,
//          head 'seg' | 'round' | 'flat' | 'hood', hc (head colour), pair, shape 'hex' }
//   cornice: 'bracket' | 'corbel' | 'plain' | 'none'; noBands
//   name / nameBg / nameFg / nameW / nameH: a raised name panel on the parapet
//   ground: 'bank' (ashlar, tall windows, `sign`) | 'none' (an extra draws it)
//   shops / side: [{ n, bg, fg, serif, wt, k, text, frame, awn: hex | [hex, hex] | null,
//          blade, bladeText, f (share of the face), w (sign width), band, bulk }]
//   awn: false (no awnings) | awnPal / awnP; flip (the shops run the other way); reach (kerb
//   distance a face may stand back and still be a shopfront, default 7.5 m); extra(info): anything else
// ---------------------------------------------------------------------------------------
const LOOKS = [
  // ===== King St N, east side (even), from Erb north =====
  { at: [-3805, -1489], addr: '2-4 King N, the Waterloo Hotel (1890)',
    // buff Waterloo brick on a stone foundation, 3 storeys, the gabled centre
    // pavilion with its 1890 datestone, segmental heads with brick hoods, dark
    // brown bracketed cornice over a corbelled frieze, navy awnings
    lv: 3, H: 13.2, wall: '#c8bc98', trim: '#3b2e25', sill: '#bfae84', band: '#c8bc98', frame: '#2a2420',
    win: { n: 8, ns: 4, head: 'seg', hc: '#b5a37a', w: 0.95, h: 2.0 }, cornice: 'bracket',
    name: '1890', nameBg: '#c8bc98', nameFg: '#5a4a36', nameW: 4.2, nameH: 1.6,
    bulk: '#3a2e26', pier: '#b9aa82', signBand: '#1f2a44',
    shops: [
      { n: 'PÜR & SIMPLE', bg: '#111111', fg: '#ffffff', serif: false, wt: '800', awn: null, f: 0.3, w: 4.6 },
      { n: 'The Waterloo Hotel', bg: '#1f2a44', fg: '#f1e6c8', serif: true, awn: '#1f2a44', w: 4.4 },
      { n: 'Potzone Hotpot', bg: '#1f2a44', fg: '#f1e6c8', serif: false, awn: '#1f2a44' },
    ],
    side: [{ n: 'Charmed Flowers', bg: '#1f2a44', fg: '#f1e6c8', serif: true, awn: '#1f2a44' }],
    extra: fireEscape(1) },
  { at: [-3818, -1498], addr: '10-12 King N (1850, brick under siding)', wall: '#d9d4c6', trim: '#2a2a2a', cornice: 'plain', win: { head: 'flat' } },
  { at: [-3826, -1505], addr: '14 King N (the first post office, 1846; siding)', wall: '#e3dccb', trim: '#4a3a2e', cornice: 'plain', lv: 2, H: 7.6 },
  { at: [-3815, -1526], addr: '16-24 King N, the Waterloo Theatre (1936, H. G. Duerr)',
    // Art Deco: a cast-stone ground floor, red-brick side bays each with a pair
    // of hexagonal lights, the centre bay of square concrete panels between
    // fluted pilasters, festoons at the parapet, the flat marquee
    lv: 2, H: 9.6, wall: '#8b3e2f', trim: '#bdb6a8', stone: '#bdb6a8', band: '#bdb6a8', cornice: 'plain', noBands: true,
    win: { sp: 99 }, ground: 'none', extra: theatre },
  { at: [-3820, -1541], addr: '28 King N (the Chainsaw, 2009-2020; Revive Karaoke now)',
    lv: 1, H: 5.6, wall: '#2b2b2e', trim: '#151515', cornice: 'plain', reach: 14,
    shops: [{ n: 'REVIVE', text: 'REVIVE  KARAOKE', bg: '#141414', fg: '#ff4fb8', serif: false, wt: '800', awn: null, blade: true, bladeText: 'REVIVE' }] },
  { at: [-3836, -1578], addr: '32 King N, Kingsway Apartments (the Raisig Hotel, 1906; stucco)',
    lv: 3, wall: '#d8cfbd', trim: '#6b5a48', cornice: 'plain', win: { head: 'flat', hc: '#c4b8a2' } },
  { at: [-3825, -1586], addr: '34 King N', wall: '#8e4a36', trim: '#e2d8c4', cornice: 'corbel', win: { head: 'seg' } },
  { at: [-3834, -1595], addr: '36 King N, Silver Square (1980)', wall: '#9a7f66', trim: '#3a3330', cornice: 'plain', win: { head: 'flat' } },
  { at: [-3830, -1617], addr: '46 King N, Princess Twin Cinemas (2005)',
    // stacked-fieldstone piers and black tile, a perforated metal screen
    // parapet carrying PRINCESS TWIN and a black CINEMAS pill, the white
    // marquee, Princess Cafe's green awning
    lv: 1, H: 5.4, wall: '#262628', trim: '#1a1a1a', pier: '#8d7f6c', bulk: '#8d7f6c', signBand: '#1d1d1f', cornice: 'none',
    shops: [
      { n: 'TRUTH BEAUTY', bg: '#151515', fg: '#f1f1f1', serif: true, wt: '600', awn: null, f: 0.3 },
      { n: 'NOW PLAYING', text: 'HOKUM · BLUE HERON · FRIDA', bg: '#f4f4f0', fg: '#111111', serif: false, wt: '800', frame: false, awn: null, f: 0.3, w: 4.2 },
      { n: 'PRINCESS CAFE', bg: '#151515', fg: '#e8e2d0', serif: true, wt: '600', awn: '#1f5a3a', w: 4.4 },
    ],
    extra: princessTwin },
  { at: [-3847, -1637], addr: '52 King N (1849, frame under siding)', lv: 2, wall: '#e6e1d4', trim: '#2f3a33', cornice: 'plain', win: { head: 'flat' } },
  { at: [-3846, -1671], addr: '56 King N, the Waterloo Garage (1920)',
    // a concrete first storey, the second of red pressed brick, painted
    lv: 2, wall: '#8e3a2e', trim: '#b8b2a6', pier: '#b8b2a6', bulk: '#b8b2a6', signBand: '#b8b2a6', cornice: 'plain', win: { head: 'flat', hc: '#b8b2a6' } },
  { at: [-3856, -1761], addr: '78 King N, Dr. Fischer House (1907)', wall: '#8a3f2c', trim: '#e8e0cc', cornice: 'bracket', win: { head: 'seg' } },
  { at: [-3867, -1784], addr: '84 King N, the Berlin & Waterloo Street Railway office (c. 1889)', wall: '#c9b48a', trim: '#3b2e25', cornice: 'corbel', win: { head: 'seg' } },
  { at: [-3877, -1808], addr: '90 King N (Harmony Lunch until 2020; frame, siding)', lv: 1, wall: '#e9e4d6', trim: '#7a2a24', cornice: 'plain', shops: [{ n: '', awn: null }] },

  // ===== King St N, west side (odd), from Erb north =====
  { at: [-3855, -1472], addr: '1 King N (the Bank of Toronto, 1924; painted)',
    lv: 3, H: 12.6, wall: '#dcd6ca', trim: '#3a3a3a', cornice: 'plain', ground: 'bank', win: { head: 'flat', hc: '#c8c2b6', w: 1.2 },
    sign: { n: 'Barranca Beauty Salon', bg: '#1a1a1a', fg: '#e8dcc0', serif: true, w: 4.4 } },
  { at: [-3866, -1494], addr: '13 King N (c. 1854, siding)',
    lv: 2, H: 8.2, wall: '#4a4e52', trim: '#222222', cornice: 'plain', win: { head: 'flat', hc: '#222222' },
    shops: [{ n: 'loop', bg: '#111111', fg: '#ffffff', serif: false, wt: '800', awn: null, frame: false }] },
  { at: [-3867, -1499], addr: '15 King N, the Conrad Block (1888)',
    // buff brick painted grey, four bays a floor (single, centre pair, single)
    // under round heads with black drip moulds and keystones, brick pilasters,
    // a corbelled frieze and a heavy black bracketed cornice
    lv: 3, H: 13.4, wall: '#7f858a', trim: '#1c1c1c', sill: '#6c7176', band: '#7f858a', frame: '#1c1c1c',
    win: { n: 4, head: 'round', hc: '#1c1c1c', w: 0.85, h: 1.9 }, cornice: 'bracket',
    bulk: '#4a2a20', pier: '#4a2a20', signBand: '#4a2a20',
    shops: [{ n: 'S&V] Uptown', text: 'S&V]  EST. 2018  Uptown', bg: '#4a2a20', fg: '#ffffff', serif: false, wt: '600', frame: false, awn: null }] },
  { at: [-3869, -1508], addr: '17-19 King N (stucco, painted white)',
    lv: 2, wall: '#ecebe6', trim: '#d4d0c6', cornice: 'bracket', win: { head: 'seg', hc: '#d4d0c6' },
    shops: [{ n: 'East Fashion', bg: '#1f4d36', fg: '#ffffff', serif: true, awn: null }] },
  { at: [-3873, -1516], addr: '21 King N (stucco, cream; red hoods and cornice)',
    lv: 2, wall: '#e8ddb5', trim: '#9a3a2e', cornice: 'bracket', win: { head: 'hood', hc: '#9a3a2e' },
    shops: [{ n: 'Champa Kitchen', bg: '#9a3a2e', fg: '#f6e7c8', serif: true, awn: null }] },
  { at: [-3871, -1522], addr: '23-25 King N, the Roos Building (1895)',
    // painted white brick, three upper windows under black round drip moulds,
    // a black bracketed cornice with white arches between the brackets
    lv: 2, H: 9.2, wall: '#efede8', trim: '#1a1a1a', sill: '#d8d6d0', band: '#1a1a1a', frame: '#1a1a1a',
    win: { n: 3, head: 'round', hc: '#1a1a1a', w: 1.0, h: 1.9 }, cornice: 'bracket', signBand: '#141414',
    shops: [{ n: 'BABYLON SISTERS', text: 'BABYLON SISTERS  ·  WINE BAR', bg: '#141414', fg: '#ffffff', serif: false, wt: '700', frame: false, awn: null }] },
  { at: [-3876, -1529], addr: '27 King N, CIBC (1912)',
    lv: 2, H: 9.4, wall: '#8a4a36', trim: '#c8b994', stone: '#c8b994', sill: '#c8b994', cornice: 'plain', ground: 'bank',
    win: { head: 'flat', hc: '#c8b994', w: 1.1 }, sign: { n: 'CIBC', bg: '#c41f3e', fg: '#ffffff', serif: false, wt: '800', w: 2.4 } },
  { at: [-3876, -1540], addr: '31-33 King N (1895/1911, Romanesque)',
    lv: 2, wall: '#8b4532', trim: '#8b4532', cornice: 'corbel', win: { head: 'round', hc: '#7a3a2a', w: 1.1, h: 2.0 } },
  { at: [-3880, -1566], addr: '35 King N, the Old Post Office (1911-13, David Ewart)',
    // rusticated sandstone ground floor, red brick above with sandstone
    // dressings, round arches; the corner clock tower (OSM part 682351484, 23 m)
    lv: 3, H: 14, wall: '#8e3b2a', stone: '#b9a27a', trim: '#b9a27a', sill: '#b9a27a', tower: [-3869.7, -1563.2, 4.9] },
  { at: [-3881, -1583], addr: '35 King N, the Post Office addition (Martin Simmons Sweers)',
    lv: 3, H: 14, wall: '#8e3b2a', trim: '#b9a27a', sill: '#b9a27a', cornice: 'plain', win: { head: 'flat', hc: '#b9a27a', w: 1.4 } },
  { at: [-3884, -1596], addr: '43-45 King N, the Kraft Block (1899; stucco over buff brick)',
    lv: 3, wall: '#d9ccb0', trim: '#5a4636', cornice: 'plain', win: { head: 'flat', hc: '#c9bba0' } },
  { at: [-3894, -1617], addr: '47-49 King N (brick under stucco)', lv: 2, wall: '#d6d0c2', trim: '#333333', cornice: 'plain', win: { head: 'flat' } },
  { at: [-3884, -1635], addr: '55-57 King N (1848, frame, green clapboard)', lv: 2, wall: '#4f6b4a', trim: '#e8e2d0', cornice: 'plain', win: { head: 'flat', hc: '#e8e2d0' } },
  { at: [-3908, -1694], addr: '71 King N', wall: '#b9a27e', trim: '#3a3330', cornice: 'corbel', win: { head: 'seg' } },
  { at: [-3915, -1752], addr: '77 King N, The Pub on King (1856)', wall: '#c4a57a', trim: '#2b241f', cornice: 'corbel', win: { head: 'seg' },
    shops: [{ n: 'Don Pablo', text: 'DON PABLO TACO & TEQUILA', bg: '#1a1a1a', fg: '#e8c46a', serif: false, awn: null },
      { n: 'The Pub On King', bg: '#1f3a2c', fg: '#e8c46a', serif: true, awn: null, blade: true }] },
  { at: [-3917, -1777], addr: "85 King N, Becky's Apartment (1871, stucco)", wall: '#e0d6c0', trim: '#3a2a2a', cornice: 'plain', win: { head: 'flat' } },

  // ===== King St S, east side (even), from Erb south =====
  // 2-10 King S: the Commercial Block (1857), Uptown's oldest -- buff to
  // orange-buff brick, segmental heads under brick hoods, a corbelled cornice,
  // wood storefronts
  { at: [-3802, -1459], addr: '2 King S, the Commercial Block (1857)', lv: 3, H: 12.4, wall: '#d1ab7c', trim: '#c8a070', band: '#d1ab7c',
    cornice: 'corbel', win: { head: 'seg', hc: '#c39a6a', w: 0.9, h: 1.9 }, bulk: '#4e3220', pier: '#4e3220', frame: '#3a2a1e', awn: false },
  { at: [-3801, -1451], addr: '4-6 King S, the Commercial Block', lv: 3, H: 12.4, wall: '#d4ae80', trim: '#c8a070', band: '#d4ae80',
    cornice: 'corbel', win: { n: 3, head: 'seg', hc: '#c39a6a', w: 0.9, h: 1.9 }, bulk: '#58391f', pier: '#58391f', frame: '#4a3020', awn: false },
  { at: [-3800, -1445], addr: '8 King S, the Commercial Block', lv: 3, H: 12.4, wall: '#cba676', trim: '#c09868', band: '#cba676',
    cornice: 'corbel', win: { n: 3, head: 'seg', hc: '#bd9464', w: 0.9, h: 1.9 }, bulk: '#4e3220', pier: '#4e3220', frame: '#3a2a1e', awn: false },
  { at: [-3798, -1437], addr: '10 King S, the Commercial Block', lv: 3, H: 12.4, wall: '#d6b386', trim: '#c8a070', band: '#d6b386',
    cornice: 'corbel', win: { n: 3, head: 'seg', hc: '#c39a6a', w: 0.9, h: 1.9 }, bulk: '#58391f', pier: '#58391f', frame: '#4a3020', awn: false },
  { at: [-3796, -1424], addr: '12-18 King S, the Central Block (1881)',
    // "Central Block" and "1881" in the roof peak, cast keystones and labels
    lv: 3, H: 12.8, wall: '#cdb183', trim: '#3b2e25', sill: '#e0d6bc', cornice: 'bracket', win: { head: 'hood', hc: '#e0d6bc', w: 0.95 },
    name: 'CENTRAL BLOCK  1881', nameBg: '#e0d6bc', nameFg: '#3b2e25', nameW: 7.5, nameH: 1.5,
    shops: [
      { n: 'Home Hardware', bg: '#d2232a', fg: '#ffffff', serif: false, wt: '800', awn: null },
      { n: 'ONTARIO SEED CO.', bg: '#1f3a2c', fg: '#f2ead2', serif: true, awn: '#1f4d36' },
    ] },
  { at: [-3793, -1410], addr: '22 King S (4 storeys)', lv: 4, wall: '#c2a77a', trim: '#2b241f', cornice: 'bracket', win: { head: 'seg' } },
  { at: [-3790, -1399], addr: '32 King S (rebuilt after the 1973 fire)', lv: 1, H: 5.4, wall: '#6b6f72', trim: '#2a2a2a', cornice: 'plain' },
  { at: [-3789, -1391], addr: '34 King S, Empress of India',
    lv: 1, H: 5.6, wall: '#2e2f31', trim: '#2e2f31', cornice: 'plain', signBand: '#2e2f31',
    shops: [{ n: 'empress of india', text: 'empress of india · modern cuisine & bar', bg: '#2e2f31', fg: '#ffffff', serif: false, wt: '600', frame: false, awn: null, w: 6 }] },
  { at: [-3787, -1384], addr: '36-40 King S, the Letter Block (c. 1880, refaced 1907)',
    // brown brick front, buff sides; three bays; flat heads on the second
    // floor, round on the third; a corbelled and dentilled cornice; TRIO
    lv: 3, H: 13, wall: '#6e4632', trim: '#6e4632', sill: '#8a6a52', band: '#6e4632',
    win: { n: 3, head: 'round', hc: '#5a3828', w: 1.0, h: 2.0 }, cornice: 'corbel', signBand: '#2a2a2a', frame: '#2a2a2a',
    shops: [{ n: 'TRIO', text: 'TRIO', bg: '#2a2a2a', fg: '#ffffff', serif: false, wt: '500', frame: false, awn: null, w: 3.4 }] },
  { at: [-3786, -1368], addr: '42 King S (buff brick, painted orange)', lv: 2, wall: '#c47a45', trim: '#f2ead8', cornice: 'bracket', win: { head: 'seg', hc: '#f2ead8' } },
  { at: [-3782, -1360], addr: "44-48 King S, the Koehler/Zick Block (1849), McCabe's",
    lv: 2, wall: '#c4a072', trim: '#9a7a52', cornice: 'corbel', win: { head: 'seg', hc: '#b08c60' },
    shops: [{ n: "McCabe's Irish Pub", bg: '#1f3a2c', fg: '#e8c46a', serif: true, awn: null, blade: true, bladeText: "McCabe's" }] },
  { at: [-3775, -1311], addr: '70-74 King S, RBC', wall: '#a35a3e', trim: '#d8cfb8', cornice: 'plain', win: { head: 'flat', hc: '#d8cfb8' } },
  { at: [-3761, -1214], addr: '100 King S, the Duke of Wellington (1930)',
    // mottled brown brick, cast-stone quoins and surrounds, three paired
    // windows a floor, the 1930 datestone; the green oval-ended sign on a
    // weathered grey-wood fascia, "100 king"
    lv: 3, H: 12.4, wall: '#5e3426', quoin: '#b9b2a3', trim: '#b9b2a3', sill: '#b9b2a3', band: '#b9b2a3', frame: '#e8e6e0',
    win: { n: 3, pair: true, head: 'hood', hc: '#b9b2a3', w: 0.8, h: 1.8 }, cornice: 'plain', noBands: true,
    name: '1930', nameBg: '#b9b2a3', nameFg: '#4a3a2e', nameW: 2.4, nameH: 0.9,
    signBand: '#a29f96', bulk: '#1a1a1a', pier: '#b9b2a3', flip: true,
    shops: [
      { n: 'The Duke of Wellington', bg: '#1f4a3a', fg: '#e2c46a', serif: true, awn: null, f: 0.62, w: 6.2 },
      { n: '100 king', bg: '#a29f96', fg: '#111111', serif: false, wt: '500', frame: false, awn: null },
    ] },
  { at: [-3756, -1204], addr: '104 King S', wall: '#a35a3e', trim: '#2b241f', cornice: 'bracket', win: { head: 'seg' } },
  { at: [-3751, -1188], addr: '108-112 King S, the Wettlaufer Bros. store (1913)', wall: '#8e4a36', trim: '#d8cfb8', cornice: 'plain', win: { head: 'flat', hc: '#d8cfb8', w: 1.3 } },
  { at: [-3752, -1175], addr: '114-116 King S (buff brick behind metal siding)', wall: '#b8bcbf', trim: '#5a5f63', cornice: 'plain', win: { head: 'flat' } },

  // ===== King St S, west side =====
  { at: [-3847, -1443], addr: '3 King S, BMO (the Molsons Bank, 1914)',
    // Beaux-Arts: sandstone ashlar, Ionic columns, THE MOLSONS BANK carved in
    // the frieze; the blue BMO fascia sign on the Erb St side
    lv: 2, H: 10.6, wall: '#cdb48c', trim: '#dccaa4', stone: '#cdb48c', sill: '#dccaa4', band: '#cdb48c', frame: '#3a3a36',
    win: { head: 'flat', hc: '#d6c9a6', w: 1.2, h: 2.2 }, cornice: 'plain', noBands: true, ground: 'bank', extra: molsonsBank },
];

// The Huether is three buildings in one OSM footprint, all along Princess St W
// from King (Commons, 2020: the hotel's King face with its awnings and the
// marquee, the fire escape on Princess beside the corner, then a narrow cream
// stucco part, then the long low buff brewery): the 1880 corner hotel (4
// storeys, buff brick, slate mansard) to 17 m, the stucco part to 23 m, and
// the old brewery that holds the Original Princess Cinema beyond.
const HUETHER_CORNER = [-3884.1, -1651.7];
const HU_U = [-0.984, 0.183];     // along Princess St W, away from King
const HU_V = [-0.170, -0.986];    // along King St N, north
const HUETHER = {
  addr: '59 King N, the Huether Hotel / Lion Brewery (1880 front)',
  lv: 3, H: 12.4, gf: 4.2, fp: 3.6, wall: '#c9ae78', trim: '#9c8256', sill: '#d8c9a3', band: '#c9ae78', frame: '#3a2a20',
  win: { n: 5, ns: 3, pair: true, head: 'round', hc: '#a88c5c', w: 0.72, h: 1.9 }, cornice: 'corbel', signBand: '#c9ae78',
  bulk: '#5a3a28', pier: '#c9ae78',
  shops: [{ n: '', awn: '#b4532f' }, { n: '', awn: '#b4532f' }, { n: '', awn: '#b4532f' }, { n: '', awn: '#b4532f' },
    { n: 'THE JAZZ ROOM', bg: '#141414', fg: '#ffffff', serif: false, wt: '700', awn: null, w: 3.0 }],
  side: [{ n: '', awn: null }, { n: '', awn: null }],
  extra: huether,
};
const HUETHER_N = {
  addr: '59 King N, the Huether (the stucco part on Princess)',
  lv: 3, H: 11.2, wall: '#e6dcc4', trim: '#5a4a3a', cornice: 'plain', win: { head: 'flat', hc: '#cfc4aa', w: 0.9 }, ground: 'none', extra: huetherNorth,
};
const PRINCESS = {
  addr: '6 Princess St W, the Original Princess Cinema (in the old brewery)',
  lv: 2, H: 9.0, wall: '#b9aa86', trim: '#9a8a68', band: '#b9aa86', cornice: 'corbel',
  win: { head: 'round', hc: '#a89a76', w: 1.0, h: 1.9 }, ground: 'none', extra: princessCinema,
};

// what a block we could not find a photograph of gets: Uptown's own materials
const UNKNOWN = [
  { wall: '#c9b48a', trim: '#3b2e25', cornice: 'corbel', win: { head: 'seg' } },          // buff
  { wall: '#d1b17f', trim: '#2b241f', cornice: 'bracket', win: { head: 'seg' } },
  { wall: '#c2a77a', trim: '#e6dcc4', cornice: 'bracket', win: { head: 'hood', hc: '#e6dcc4' } },
  { wall: '#8e4a36', trim: '#d8cfb8', cornice: 'corbel', win: { head: 'seg' } },          // red
  { wall: '#7a3e2e', trim: '#1e1e1e', cornice: 'bracket', win: { head: 'flat', hc: '#d8cfb8' } },
  { wall: '#e6e1d4', trim: '#2a2a2a', cornice: 'bracket', win: { head: 'hood', hc: '#2a2a2a' } }, // painted
  { wall: '#d9ccb0', trim: '#5a4636', cornice: 'plain', win: { head: 'flat' } },          // stucco
  { wall: '#6f7478', trim: '#1c1c1c', cornice: 'bracket', win: { head: 'flat', hc: '#1c1c1c' } },
];

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

/** Before meshing: each King St footprint gets its look; the boxes of what we draw go flat. */
export function prepUptown(city) {
  const P = placesData();
  if (!P) return STATS;
  // the Huether, split in three
  const hi = P.king.findIndex((r) => /Huether/.test(r.n));
  if (hi >= 0) {
    const r = P.king[hi], c = HUETHER_CORNER;
    const at = (u, v) => [c[0] + HU_U[0] * u + HU_V[0] * v, c[1] + HU_U[1] * u + HU_V[1] * v];
    const A = clip(r.p, at(17, 0), [-HU_U[0], -HU_U[1]]), rest = clip(r.p, at(17, 0), HU_U);
    const Bn = clip(rest, at(23, 0), [-HU_U[0], -HU_U[1]]), west = clip(rest, at(23, 0), HU_U);
    if (A.length > 2 && Bn.length > 2 && west.length > 2) {
      r.p = A; r.look = HUETHER;
      P.king.push({ p: Bn, lv: 3, n: 'Huether Hotel (north)', bt: 'hotel', s: [], look: HUETHER_N });
      P.king.push({ p: west, lv: 2, n: 'Original Princess Cinema', bt: 'retail', s: [], look: PRINCESS });
      STATS.looks += 3;
    }
  }
  for (const r of P.king) {
    if (r.look) continue;
    const [cx, cz] = centroid(r.p);
    let best = null, bd = 4;
    for (const L of LOOKS) {
      const d = Math.hypot(L.at[0] - cx, L.at[1] - cz);
      if (d < bd) { bd = d; best = L; }
    }
    if (best) { r.look = best; STATS.looks++; continue; }
    // no photograph: an Uptown material, chosen by the footprint
    const u = UNKNOWN[Math.floor(hash2(Math.round(cx), Math.round(cz)) * UNKNOWN.length)];
    r.look = { ...u, addr: 'unresearched' };
    STATS.defaults++;
  }
  for (const r of P.king) if (r.look && r.look.awnPal === undefined) r.look = { awnPal: AWN_REAL, awnP: 0.3, ...r.look };
  for (const b of BUILDINGS) STATS.skipped += skipBox(city, b.p);
  addUptown(buildUptown);
  if (typeof window !== 'undefined') window.__kwUptown = STATS;
  return STATS;
}

function skipBox(city, pts) {
  const [cx, cz] = centroid(pts);
  const A = Math.abs(polyArea(pts));
  const hit = new Set();
  const b = boxAt(city, cx, cz, 2);
  if (b && b.w * b.d < A * 4 + 300) hit.add(b);
  for (const o of city.buildingsNear(cx, cz, 90)) if (inPoly(pts, o.x, o.z) && o.w * o.d < A * 2 + 200) hit.add(o);
  for (const o of hit) {
    o.h = 0;
    if (!o.kw) o.kw = {};
    o.kw.skip = true;
    delete o.kw.poly;
  }
  return hit.size;
}

// ---------------------------------------------------------------------------------------
// helpers on a meshKing face (`e` from kwplaces.js edges(): at(t, y, off), nx, nz, ux, uz, L)
// ---------------------------------------------------------------------------------------
function rect(B, e, t0, t1, y0, y1, off, col) {
  B.quad(e.at(t0, y0, off), e.at(t1, y0, off), e.at(t1, y1, off), e.at(t0, y1, off), [e.nx, 0, e.nz], U0, col);
}
/** A box standing out from a face: `t0..t1` along it, `y0..y1`, from `o0` to `o1` out. */
function slab(B, e, t0, t1, y0, y1, o0, o1, col) {
  const tm = (t0 + t1) / 2, om = (o0 + o1) / 2;
  const p = e.at(tm, y0, om);
  B.box(p[0], y0, p[2], t1 - t0, y1 - y0, o1 - o0, Math.atan2(e.uz, e.ux), col);
}
function onFace(g, e, t, y, mesh, off = 0.06) {
  const p = e.at(t, y, 0);
  hang(g, mesh, p[0], y, p[2], e.nx, e.nz, off);
}
/** The face of a meshKing building on a street matching `re`. */
function faceOn(info, re) {
  let best = null, bk = 14;
  for (const e of info.fronts) {
    const s = street(info.ctx.city, e.mx + e.nx * 1.5, e.mz + e.nz * 1.5, 30, re);
    if (!s) continue;
    const tx = s.qx - e.mx, tz = s.qz - e.mz, tl = Math.hypot(tx, tz) || 1;
    if ((tx * e.nx + tz * e.nz) / tl < 0.6) continue;   // the street must be in front of the face
    if (s.kerb < bk) { bk = s.kerb; best = e; }
  }
  return best;
}
/** Where world point (x, z) falls along face e. */
const along = (e, x, z) => (x - e.a[0]) * e.ux + (z - e.a[1]) * e.uz;

/** A black steel fire escape on the side face (`which` 1) or the main one (0). */
function fireEscape(which, t0 = 1.5, w = 5.0) {
  return (info) => {
    const e = info.fronts[which] || info.fronts[0];
    if (!e) return;
    const B = info.B, K = C('#161616');
    const gy = walkY(info.ctx.city, e.mx + e.nx * 1.4, e.mz + e.nz * 1.4);
    const ta = Math.min(t0, Math.max(0.3, e.L - w - 0.3)), tb = ta + w;
    for (let y = gy + 4.3; y < info.yTop - 1.5; y += 3.6) {
      slab(B, e, ta, tb, y, y + 0.08, 0.05, 1.2, K);              // the landing
      slab(B, e, ta, tb, y + 0.9, y + 0.96, 1.12, 1.2, K);        // its rail
      for (const t of [ta, tb]) slab(B, e, t - 0.03, t + 0.03, y, y + 0.96, 1.12, 1.2, K);
      // the stair to the next landing, as a sloped stringer pair
      const p0 = e.at(ta + 0.5, y + 0.08, 0.65), p1 = e.at(tb - 0.5, y + 3.6, 0.65);
      for (const d of [-0.35, 0.35]) {
        const q0 = [p0[0] + e.nx * d, p0[1], p0[2] + e.nz * d], q1 = [p1[0] + e.nx * d, p1[1], p1[2] + e.nz * d];
        B.quad(q0, q1, [q1[0], q1[1] + 0.12, q1[2]], [q0[0], q0[1] + 0.12, q0[2]], [e.nx, 0, e.nz], U0, K);
      }
    }
  };
}

// ---------------------------------------------------------------------------------------
// the special ones
// ---------------------------------------------------------------------------------------

/** Inset a polygon by d (each vertex moved along its two edges' inward normals). */
function inset(pts, d) {
  const n = pts.length, N = [];
  for (let i = 0; i < n; i++) {
    const a = pts[i], b = pts[(i + 1) % n];
    let dx = b[0] - a[0], dz = b[1] - a[1];
    const L = Math.hypot(dx, dz) || 1;
    dx /= L; dz /= L;
    let nx = -dz, nz = dx;
    if (!inPoly(pts, (a[0] + b[0]) / 2 + nx * 0.3, (a[1] + b[1]) / 2 + nz * 0.3)) { nx = -nx; nz = -nz; }
    N.push([nx, nz]);
  }
  return pts.map((p, i) => {
    const n1 = N[(i + n - 1) % n], n2 = N[i];
    const k = Math.max(0.35, 1 + n1[0] * n2[0] + n1[1] * n2[1]);
    return [p[0] + (n1[0] + n2[0]) * d / k, p[1] + (n1[1] + n2[1]) * d / k];
  });
}
/** A mansard: slopes from the footprint at y0 to `d` in at y0 + rise, a flat top. */
function mansard(B, pts, y0, rise, d, col, top) {
  const Q = inset(pts, d);
  for (const e of edges(pts)) {
    const i = pts.indexOf(e.a), j = (i + 1) % pts.length;
    if (i < 0) continue;
    const a2 = Q[i], c2 = Q[j];
    const n = [e.nx * 0.85, 0.53, e.nz * 0.85];
    B.quad([e.a[0], y0, e.a[1]], [e.c[0], y0, e.c[1]], [c2[0], y0 + rise, c2[1]], [a2[0], y0 + rise, a2[1]], n, U0, col);
  }
  roof(B, Q, y0 + rise, top);
}

/** THE HUETHER: the slate mansard and its gabled dormers, the Lion Brewery's disc and Café 1842 at the corner, the marquee. */
function huether(info) {
  const { B, g, L, ctx, pts, yTop } = info;
  const SLATE = C('#3a3a40');
  mansard(B, pts, yTop + 0.9, 3.4, 1.5, SLATE, C('#4a4a50'));
  // dormers on the two street faces
  for (const e of info.fronts) {
    const n = Math.max(1, Math.floor((e.L - 2) / 4.2));
    for (let i = 0; i < n; i++) {
      const t = (e.L / n) * (i + 0.5);
      const y = yTop + 1.4;
      slab(B, e, t - 0.75, t + 0.75, y, y + 1.9, -0.9, 0.15, C('#c9ae78'));
      rect(B, e, t - 0.45, t + 0.45, y + 0.3, y + 1.6, 0.17, C('#1e2226'));
      const r = Math.atan2(e.uz, e.ux);
      void r;
      B.tri(e.at(t - 0.9, y + 1.9, 0.2), e.at(t + 0.9, y + 1.9, 0.2), e.at(t, y + 2.7, 0.2), [e.nx, 0, e.nz], SLATE);
      B.quad(e.at(t - 0.9, y + 1.9, 0.2), e.at(t, y + 2.7, 0.2), e.at(t, y + 2.7, -1.0), e.at(t - 0.9, y + 1.9, -1.0), [-e.ux * 0.7, 0.7, -e.uz * 0.7], U0, SLATE);
      B.quad(e.at(t, y + 2.7, 0.2), e.at(t + 0.9, y + 1.9, 0.2), e.at(t + 0.9, y + 1.9, -1.0), e.at(t, y + 2.7, -1.0), [e.ux * 0.7, 0.7, e.uz * 0.7], U0, SLATE);
    }
  }
  // chimneys (the photographs show three in buff brick)
  const [cx, cz] = info.cx !== undefined ? [info.cx, info.cz] : centroid(pts);
  for (const [dx, dz] of [[2, -3], [-4, 2], [5, 4]]) B.box(cx + dx, yTop + 3, cz + dz, 0.9, 3.0, 0.9, 0.18, C('#bfa470'));
  // the King/Princess corner: the Lion Brewery's disc and Café 1842's board on a bracket
  const king = faceOn(info, /^King Street/), prin = faceOn(info, /^Princess/);
  const c = HUETHER_CORNER;
  const kn = king ? [king.nx, king.nz] : [1, 0], pn = prin ? [prin.nx, prin.nz] : [0, 1];
  let bx = kn[0] + pn[0], bz = kn[1] + pn[1];
  const bl = Math.hypot(bx, bz) || 1; bx /= bl; bz /= bl;
  const base = walkY(ctx.city, c[0] + bx * 2, c[1] + bz * 2);
  const disc = L.panel(1.5, 1.5, 70, (q, W, H) => {
    q.clearRect(0, 0, W, H);
    const r = W / 2 - 2;
    q.fillStyle = '#121212'; q.beginPath(); q.arc(W / 2, H / 2, r, 0, Math.PI * 2); q.fill();
    q.strokeStyle = '#c9a44c'; q.lineWidth = r * 0.05; q.beginPath(); q.arc(W / 2, H / 2, r * 0.93, 0, Math.PI * 2); q.stroke();
    q.beginPath(); q.arc(W / 2, H / 2, r * 0.6, 0, Math.PI * 2); q.stroke();
    q.fillStyle = '#d9b860'; q.font = `700 ${r * 0.2}px ${SERIF}`; q.textAlign = 'center'; q.textBaseline = 'middle';
    const ring = (str, a0, a1, rad, flip) => {
      for (let i = 0; i < str.length; i++) {
        const a = a0 + (a1 - a0) * (i + 0.5) / str.length;
        q.save(); q.translate(W / 2 + Math.cos(a) * rad, H / 2 + Math.sin(a) * rad);
        q.rotate(a + (flip ? -Math.PI / 2 : Math.PI / 2)); q.fillText(str[i], 0, 0); q.restore();
      }
    };
    ring('THE LION BREWERY', -Math.PI * 0.92, -Math.PI * 0.08, r * 0.77, false);
    ring('RESTAURANT', Math.PI * 0.8, Math.PI * 0.2, r * 0.77, true);
    // the lion, as the sign's gilt badge
    q.font = `700 ${r * 0.34}px ${SERIF}`; q.fillText('1842', W / 2, H / 2 + r * 0.06);
  });
  const cafe = L.panel(0.95, 1.25, 60, (q, W, H) => {
    q.fillStyle = '#5a1e24'; q.fillRect(0, 0, W, H);
    q.strokeStyle = '#d9c08a'; q.lineWidth = W * 0.04; q.strokeRect(W * 0.06, H * 0.05, W * 0.88, H * 0.9);
    q.fillStyle = '#f1e6c8'; q.textAlign = 'center'; q.textBaseline = 'middle';
    q.font = `italic 700 ${W * 0.24}px ${SERIF}`; q.fillText('Café', W / 2, H * 0.62);
    q.fillText('1842', W / 2, H * 0.8);
    q.fillStyle = '#e8d8b0'; q.beginPath(); q.arc(W / 2, H * 0.3, W * 0.2, 0, Math.PI * 2); q.fill();
  });
  // faces perpendicular to the bisector (the bracket points along it)
  const fx = -bz, fz = bx;
  for (const [m, y, out] of [[disc, base + 5.9, 1.25], [cafe, base + 4.3, 0.95]]) {
    const px = c[0] + bx * out, pz = c[1] + bz * out;
    hang(g, m, px, y, pz, fx, fz, 0.02);
    hang(g, m.clone(), px, y, pz, -fx, -fz, 0.02);
  }
  B.box(c[0] + bx * 1.0, base + 6.75, c[1] + bz * 1.0, 2.0, 0.06, 0.06, Math.atan2(bz, bx), C('#121212'));
  B.box(c[0] + bx * 0.6, base + 5.0, c[1] + bz * 0.6, 1.2, 0.05, 0.05, Math.atan2(bz, bx), C('#121212'));
  // the post-mounted marquee on King St, a few metres up from the corner
  if (king) {
    const prin2 = king;
    const t = Math.min(prin2.L - 1, Math.max(1, along(prin2, c[0], c[1]) + (along(prin2, c[0] + HU_V[0], c[1] + HU_V[1]) > along(prin2, c[0], c[1]) ? 6 : -6)));
    const prin = prin2;
    const p = prin.at(t, 0, 2.3), y = walkY(ctx.city, p[0], p[2]);
    B.box(p[0], y, p[2], 0.12, 3.5, 0.12, 0, C('#1a1a1a'));
    const mq = L.panel(2.1, 0.95, 50, (q, W, H) => {
      q.fillStyle = '#f6f4ee'; q.fillRect(0, 0, W, H);
      q.strokeStyle = '#1a1a1a'; q.lineWidth = H * 0.06; q.strokeRect(0, 0, W, H);
      q.fillStyle = '#111'; q.textAlign = 'center'; q.textBaseline = 'middle';
      q.font = `800 ${H * 0.2}px ${SANS}`;
      q.fillText('HUETHER HOTEL', W / 2, H * 0.2, W * 0.92);
      q.fillText('NOW SERVING', W / 2, H * 0.45, W * 0.92);
      q.fillText('BREAKFAST', W / 2, H * 0.66, W * 0.92);
      q.font = `700 ${H * 0.15}px ${SANS}`;
      q.fillText('OPEN DAILY 8AM · 519 886 3350', W / 2, H * 0.87, W * 0.94);
    });
    hang(g, mq, p[0], y + 2.75, p[2], prin.ux, prin.uz, 0.07);
    hang(g, mq.clone(), p[0], y + 2.75, p[2], -prin.ux, -prin.uz, 0.07);
  }
  // the fire escape on Princess, beside the corner
  if (prin) fireEscape(0, along(prin, c[0], c[1]) < prin.L / 2 ? 1.2 : prin.L - 6.2)({ ...info, fronts: [prin] });
}

/** The Huether's north part: HUETHER HOTEL painted down its stucco. */
function huetherNorth(info) {
  const { B, g, L } = info;
  const e = faceOn(info, /^Princess/) || info.fronts[0];
  if (!e) return;
  const gy = walkY(info.ctx.city, e.mx + e.nx * 1.4, e.mz + e.nz * 1.4);
  // the ground floor: stucco with a door and two windows
  for (const [t, w, d] of [[e.L * 0.25, 1.2, true], [e.L * 0.55, 1.6, false], [e.L * 0.8, 1.6, false]]) {
    rect(B, e, t - w / 2, t + w / 2, d ? gy : gy + 0.9, gy + 2.5, 0.04, d ? C('#2a2420') : C('#1e2226'));
  }
  const m = L.panel(1.0, 6.6, 16, (q, W, H) => {
    q.clearRect(0, 0, W, H);
    q.fillStyle = '#2a2a2a'; q.textAlign = 'center'; q.textBaseline = 'middle';
    const s = 'HUETHER HOTEL';
    q.font = `700 ${H / s.length * 0.82}px ${SERIF}`;
    for (let i = 0; i < s.length; i++) q.fillText(s[i], W / 2, (i + 0.5) * H / s.length);
  });
  onFace(g, e, e.L * 0.1 + 0.6, info.yTop - 4.2, m, 0.04);
  void B;
}

/** 6 Princess St W: the white portal with PRINCESS over it, the lightbox, the poster cases, the BREWERY band. */
function princessCinema(info) {
  const { B, g, L } = info;
  const e = faceOn(info, /^Princess/) || info.fronts[0];
  if (!e) return;
  const gy = walkY(info.ctx.city, e.mx + e.nx * 1.4, e.mz + e.nz * 1.4);
  const c = HUETHER_CORNER;
  // where 35 m along Princess from King falls on this face (the portal), and 40 m (the brewery band)
  const tAt = (u) => Math.max(1.5, Math.min(e.L - 1.5, along(e, c[0] + HU_U[0] * u, c[1] + HU_U[1] * u)));
  const tp = tAt(33), tb = tAt(40);
  // the ground floor: buff brick, round-arched windows
  const WHITE = C('#e9e6dc'), DARK = C('#141414');
  for (let t = 1.6; t < e.L - 1.2; t += 3.2) {
    if (Math.abs(t - tp) < 2.4 || Math.abs(t - tb) < 2.6) continue;
    rect(B, e, t - 0.55, t + 0.55, gy + 1.0, gy + 2.6, 0.04, C('#22262a'));
    rect(B, e, t - 0.7, t + 0.7, gy + 0.85, gy + 1.0, 0.07, C('#a89a76'));
  }
  // the portal
  slab(B, e, tp - 1.45, tp + 1.45, gy - 0.2, gy + 3.7, 0, 0.35, WHITE);
  slab(B, e, tp - 1.65, tp + 1.65, gy + 3.7, gy + 4.05, 0, 0.5, WHITE);
  rect(B, e, tp - 0.95, tp + 0.95, gy, gy + 2.5, 0.36, DARK);
  rect(B, e, tp - 0.95, tp + 0.95, gy + 2.55, gy + 2.95, 0.36, C('#6a7a8a'));
  const word = text(L, 2.4, 0.5, 'PRINCESS', { fg: '#b87333', font: SERIF, wt: '700', k: 0.78, px: 50 });
  onFace(g, e, tp, gy + 3.25, word, 0.37);
  // the projecting lightbox
  const lb = text(L, 1.6, 0.55, 'THE PRINCESS CINEMA', { bg: '#141414', fg: '#ffffff', font: SERIF, wt: '700', k: 0.42, px: 50 });
  const lp = e.at(tp + 2.0, gy + 4.6, 0.85);
  hang(g, lb, lp[0], lp[1], lp[2], e.ux, e.uz, 0.03);
  hang(g, lb.clone(), lp[0], lp[1], lp[2], -e.ux, -e.uz, 0.03);
  B.box(lp[0] - e.nx * 0.45, gy + 4.95, lp[2] - e.nz * 0.45, 0.05, 0.05, 1.0, Math.atan2(e.nz, e.nx) + Math.PI / 2, DARK);
  // poster cases either side
  for (const d of [-2.6, 2.6, 3.6]) rect(B, e, tp + d - 0.4, tp + d + 0.4, gy + 0.9, gy + 2.2, 0.06, C('#1b1b1b'));
  // the old brewery's carved band
  const br = text(L, 3.6, 0.45, 'BREWERY', { bg: '#cfc6ae', fg: '#6a5e48', font: SERIF, wt: '700', k: 0.7, px: 40 });
  rect(B, e, tb - 2.2, tb + 2.2, gy + 3.25, gy + 3.9, 0.06, C('#cfc6ae'));
  onFace(g, e, tb, gy + 3.57, br, 0.08);
  rect(B, e, tb - 1.6, tb + 1.6, gy, gy + 3.0, 0.04, C('#2a2724'));
}

/** 46 King N: the perforated screen over the roof with PRINCESS TWIN and CINEMAS. */
function princessTwin(info) {
  const { B, g, L, yTop } = info;
  const e = info.fronts[0];
  if (!e) return;
  const SCREEN = C('#7c8389'), FR = C('#3a3f44');
  const t0 = 0.4, t1 = e.L * 0.86, y0 = yTop + 0.4, y1 = yTop + 3.6;
  rect(B, e, t0, t1, y0, y1, 0.2, SCREEN);
  rect(B, e, t0, t1, y0, y1, 0.18, shade(SCREEN, 0.8));
  for (let t = t0; t <= t1 + 0.01; t += (t1 - t0) / 6) slab(B, e, t - 0.06, t + 0.06, yTop, y1 + 0.05, 0.12, 0.3, FR);
  slab(B, e, t0, t1, y1 - 0.05, y1 + 0.05, 0.1, 0.3, FR);
  const pt = text(L, 6.2, 1.15, 'PRINCESS TWIN', { fg: '#b08d57', font: SERIF, wt: '700', k: 0.8, px: 40 });
  onFace(g, e, e.L * 0.3, y0 + 1.85, pt, 0.24);
  const ci = L.panel(2.6, 0.62, 50, (q, W, H) => {
    q.clearRect(0, 0, W, H);
    q.fillStyle = '#111'; const r = H / 2;
    q.beginPath(); q.arc(r, r, r, Math.PI / 2, Math.PI * 1.5); q.arc(W - r, r, r, -Math.PI / 2, Math.PI / 2); q.closePath(); q.fill();
    q.fillStyle = '#f2f2f2'; q.font = `700 ${H * 0.62}px ${SERIF}`; q.textAlign = 'center'; q.textBaseline = 'middle';
    q.fillText('CINEMAS', W / 2, H * 0.54);
  });
  onFace(g, e, e.L * 0.38, y0 + 0.65, ci, 0.25);
}

/** 16-24 King N: the cast-stone ground floor, the concrete centre bay with its festoons, the marquee. */
function theatre(info) {
  const { B, yTop } = info;
  const e = info.fronts[0];
  if (!e) return;
  const gy = walkY(info.ctx.city, e.mx + e.nx * 1.4, e.mz + e.nz * 1.4);
  const ST = C('#bdb6a8'), CON = C('#c9c3b6'), DARK = C('#1b1d1f');
  rect(B, e, 0, e.L, gy - 0.3, gy + 4.0, 0.05, ST);
  // the centre bay: square panels and fluted pilasters to the parapet
  const c0 = e.L * 0.36, c1 = e.L * 0.64;
  rect(B, e, c0, c1, gy + 4.0, yTop + 0.9, 0.08, CON);
  for (let y = gy + 4.6; y < yTop; y += 1.2) rect(B, e, c0, c1, y, y + 0.05, 0.09, shade(CON, 0.8));
  for (const t of [c0, c1]) {
    slab(B, e, t - 0.35, t + 0.35, gy + 4.0, yTop + 0.9, 0, 0.25, ST);
    for (const d of [-0.18, 0, 0.18]) rect(B, e, t + d - 0.03, t + d + 0.03, gy + 4.0, yTop + 0.9, 0.26, shade(ST, 0.75));
  }
  // festoons: a pair of scalloped panels at the parapet
  for (const t of [c0 + 0.9, c1 - 0.9]) {
    rect(B, e, t - 0.6, t + 0.6, yTop - 0.4, yTop + 0.6, 0.12, shade(ST, 0.92));
    B.tri(e.at(t - 0.5, yTop + 0.4, 0.13), e.at(t + 0.5, yTop + 0.4, 0.13), e.at(t, yTop - 0.2, 0.13), [e.nx, 0, e.nz], shade(ST, 0.7));
  }
  // each brick side bay: a pair of hexagonal lights in a cast frame
  const yh = gy + 6.6, FR = C('#d8d2c4'), GLs = C('#2a3036');
  for (const t of [e.L * 0.1, e.L * 0.24, e.L * 0.76, e.L * 0.9]) {
    for (let k = 0; k < 6; k++) {
      const a0 = Math.PI / 3 * k + Math.PI / 6, a1 = a0 + Math.PI / 3;
      B.tri(e.at(t, yh, 0.04), e.at(t + Math.cos(a0) * 0.55, yh + Math.sin(a0) * 0.55, 0.04), e.at(t + Math.cos(a1) * 0.55, yh + Math.sin(a1) * 0.55, 0.04), [e.nx, 0, e.nz], GLs);
      B.quad(e.at(t + Math.cos(a0) * 0.55, yh + Math.sin(a0) * 0.55, 0.035), e.at(t + Math.cos(a1) * 0.55, yh + Math.sin(a1) * 0.55, 0.035), e.at(t + Math.cos(a1) * 0.78, yh + Math.sin(a1) * 0.78, 0.035), e.at(t + Math.cos(a0) * 0.78, yh + Math.sin(a0) * 0.78, 0.035), [e.nx, 0, e.nz], U0, FR);
    }
  }
  // two windows in the centre bay
  for (const t of [c0 + (c1 - c0) * 0.3, c0 + (c1 - c0) * 0.7]) rect(B, e, t - 0.5, t + 0.5, gy + 5.0, gy + 6.6, 0.1, C('#2a3036'));
  // the ground floor's openings and the flat marquee over the doors
  for (const [a, b] of [[0.6, c0 - 0.6], [c1 + 0.6, e.L - 0.6]]) {
    const n = Math.max(1, Math.round((b - a) / 2.6));
    for (let i = 0; i < n; i++) rect(B, e, a + (b - a) * i / n + 0.2, a + (b - a) * (i + 1) / n - 0.2, gy, gy + 2.6, 0.07, DARK);
  }
  rect(B, e, c0 + 0.2, c1 - 0.2, gy, gy + 2.7, 0.07, C('#3a4248'));
  slab(B, e, c0 - 0.6, c1 + 0.6, gy + 3.2, gy + 3.55, 0.05, 1.6, C('#1d1f22'));
}

/** 3 King S, the Molsons Bank: Ionic columns, the carved frieze, BMO's sign on the Erb side. */
function molsonsBank(info) {
  const { B, g, L, yTop } = info;
  const king = faceOn(info, /^King Street/), erb = faceOn(info, /^Erb/);
  const ST = C('#cdb48c'), ST2 = C('#dccaa4');
  for (const e of [king, erb]) {
    if (!e) continue;
    const gy = walkY(info.ctx.city, e.mx + e.nx * 1.4, e.mz + e.nz * 1.4);
    // the order: columns (on King) or pilasters, two storeys, on a plinth
    const n = e === king ? 4 : Math.max(2, Math.round(e.L / 5));
    for (let i = 0; i < n; i++) {
      const t = e.L * (i + 0.5) / n;
      const p = e.at(t, gy + 0.9, e === king ? 0.55 : 0.12);
      if (e === king) {
        B.prism(p[0], gy + 0.9, p[2], 0.34, yTop - gy - 2.3, 10, ST2);
        B.box(p[0], yTop - 1.45, p[2], 1.0, 0.3, 1.0, Math.atan2(e.uz, e.ux), ST2);   // the capital
      } else {
        slab(B, e, t - 0.35, t + 0.35, gy + 0.9, yTop - 1.4, 0, 0.18, ST2);
      }
    }
    // the entablature, the frieze lettering
    slab(B, e, -0.2, e.L + 0.2, yTop - 1.4, yTop + 0.2, 0, e === king ? 0.95 : 0.3, ST);
    if (e === king) {
      const fr = text(L, Math.min(e.L - 1.5, 9), 0.7, 'THE MOLSONS BANK', { fg: '#6a5a3e', font: SERIF, wt: '700', k: 0.85, px: 40 });
      onFace(g, e, e.L / 2, yTop - 0.6, fr, 0.97);
    }
  }
  if (erb) {
    const gy = walkY(info.ctx.city, erb.mx + erb.nx * 1.4, erb.mz + erb.nz * 1.4);
    const m = L.panel(3.8, 0.8, 50, (q, W, H) => {
      q.fillStyle = '#0079c1'; q.fillRect(0, 0, W, H);
      q.fillStyle = '#ffffff'; q.font = `800 ${H * 0.6}px ${SANS}`; q.textAlign = 'center'; q.textBaseline = 'middle';
      q.fillText('BMO', W * 0.42, H * 0.55);
      q.fillStyle = '#e31837'; q.beginPath(); q.arc(W * 0.66, H / 2, H * 0.34, 0, Math.PI * 2); q.fill();
      q.fillStyle = '#fff'; q.font = `800 ${H * 0.36}px ${SANS}`; q.fillText('M', W * 0.66, H * 0.53);
    });
    onFace(g, erb, erb.L * 0.72, gy + 3.4, m, 0.35);
  }
}

// ---------------------------------------------------------------------------------------
// Uptown's other buildings, from their OSM footprints
// ---------------------------------------------------------------------------------------

// Waterloo City Centre, 100 Regina St S (OSM 43250653): tan brick, 3 storeys,
// green-tinted punched windows, the tall drum at its north corner with
// WATERLOO CITY CENTRE in spaced metal capitals
const CITY_CENTRE = [[-3685.2, -1299.2], [-3672.8, -1237.6], [-3669.7, -1237.9], [-3669.3, -1234.7], [-3670.3, -1233.0], [-3671.0, -1229.7], [-3670.3, -1225.5], [-3668.5, -1222.8], [-3664.9, -1220.7], [-3661.7, -1220.1], [-3656.5, -1220.9], [-3652.8, -1225.3], [-3651.5, -1230.1], [-3648.4, -1230.8], [-3643.0, -1237.3], [-3641.9, -1238.6], [-3619.4, -1265.5], [-3624.5, -1269.8], [-3626.7, -1271.7], [-3629.3, -1273.9], [-3631.1, -1275.4], [-3638.1, -1281.4], [-3649.7, -1266.7], [-3651.4, -1267.8], [-3652.3, -1268.1], [-3653.1, -1268.3], [-3655.2, -1268.4], [-3661.8, -1303.3]];
const CC_DRUM = [-3661.2, -1230.0, 10.4];
// Waterloo Public Library, main branch, 35 Albert St (OSM 43251385)
const LIBRARY = [[-4056.6, -1543.4], [-4037.3, -1514.6], [-4018.7, -1527.0], [-4013.0, -1530.8], [-4000.2, -1539.4], [-3997.4, -1535.3], [-3992.8, -1538.4], [-3986.2, -1542.7], [-3988.8, -1546.5], [-3981.8, -1551.1], [-3993.2, -1568.1], [-3997.8, -1575.0], [-4004.4, -1570.6], [-4005.9, -1569.6], [-4009.0, -1574.2], [-4038.3, -1554.7], [-4038.7, -1554.4], [-4040.1, -1556.5], [-4046.1, -1552.5], [-4045.1, -1551.0]];
// 57 Erb St W: Seagram's 1878 barrel warehouse, the Seagram Museum 1984-97 (OSM 67691611, "RideCo")
const ERB57 = [[-4100.7, -1341.8], [-4068.4, -1287.7], [-4065.8, -1289.3], [-4056.6, -1273.7], [-4046.2, -1279.8], [-4053.6, -1292.5], [-4044.7, -1297.6], [-4046.7, -1301.0], [-4034.2, -1308.2], [-4054.1, -1340.5], [-4062.7, -1336.4], [-4064.3, -1339.2], [-4062.0, -1340.3], [-4069.7, -1353.3], [-4077.2, -1355.7]];
// 95 King S (OSM 62299770, "RBC Building"): red brick, beige precast, the
// aluminium-and-glass rotunda on the Willis Way corner with Starbucks in it
const KING95 = [[-3849.3, -1242.6], [-3841.8, -1229.6], [-3828.6, -1232.2], [-3820.0, -1187.7], [-3801.7, -1191.0], [-3801.9, -1192.0], [-3798.9, -1193.0], [-3796.8, -1195.0], [-3795.6, -1197.3], [-3795.4, -1199.6], [-3795.8, -1201.6], [-3794.8, -1201.9], [-3799.1, -1222.7], [-3800.8, -1222.4], [-3801.4, -1224.9], [-3802.0, -1227.7], [-3800.1, -1228.2], [-3804.7, -1251.7], [-3806.3, -1251.3], [-3807.0, -1254.6], [-3805.1, -1255.0], [-3806.0, -1260.2], [-3807.1, -1262.1], [-3808.5, -1263.6], [-3810.4, -1264.8], [-3812.7, -1265.2], [-3815.2, -1265.4], [-3819.8, -1262.9], [-3818.8, -1261.1]];
const K95_ROTUNDA = [-3811.6, -1258.4, 6.6];
// Fourteen Princess, 14 Princess St W (OSM 239753824): 8 storeys, blue glass and tan panels
const FOURTEEN = [[-3969.0, -1681.7], [-3960.5, -1638.2], [-3932.1, -1643.8], [-3935.0, -1658.5], [-3932.3, -1659.1], [-3938.8, -1692.2], [-3946.3, -1690.7], [-3945.3, -1686.0], [-3947.5, -1685.6], [-3947.8, -1687.2], [-3957.6, -1685.3], [-3957.3, -1684.0]];

const BUILDINGS = [
  { name: 'Waterloo City Centre', p: CITY_CENTRE, build: cityCentre },
  { name: 'Waterloo Public Library', p: LIBRARY, build: library },
  { name: '57 Erb St W', p: ERB57, build: erb57 },
  { name: '95 King St S', p: KING95, build: king95 },
  { name: 'Fourteen Princess', p: FOURTEEN, build: fourteen },
];

function cityCentre(kit, ctx, pts) {
  const L = ctx.atlas, city = ctx.city;
  const TAN = C('#c9a77a'), GL = C('#4e7c78');
  const b = block(kit, ctx, pts, {
    h: 12.6, wall: TAN, trim: C('#b8956a'), parapet: 0.5, glass: GL, frame: C('#3d5a56'),
    win: { style: 'punch', sp: 2.9, w: 1.8, fl: 3.9, g0: 1.0, h: 2.2 },
  });
  // the drum, a storey taller, with its cap
  const [dx, dz, r] = CC_DRUM, B = b.B, y0 = b.lo - 1.2, yD = b.base + 15.6, n = 28;
  B.prism(dx, y0, dz, r, yD - y0, n, TAN);
  for (let i = 0; i < n; i++) {
    const a0 = (i / n) * Math.PI * 2, a1 = ((i + 1) / n) * Math.PI * 2;
    B.tri([dx, yD + 0.4, dz], [dx + Math.cos(a0) * (r + 0.2), yD + 0.4, dz + Math.sin(a0) * (r + 0.2)], [dx + Math.cos(a1) * (r + 0.2), yD + 0.4, dz + Math.sin(a1) * (r + 0.2)], [0, 1, 0], C('#7d9a8c'));
  }
  B.prism(dx, yD, dz, r + 0.2, 0.4, n, C('#7d9a8c'));
  // which way the drum faces Regina St
  const s = street(city, dx - 16, dz, 40, /^Regina/);
  const fa = s ? Math.atan2(s.qz - dz, s.qx - dx) : Math.PI;
  const g = kit.grp(dx, dz);
  // windows round the street half, two floors, and the lettering in three panels
  for (let k = -3; k <= 3; k++) {
    const a = fa + k * 0.32;
    const nx = Math.cos(a), nz = Math.sin(a), tx = -nz, tz = nx;
    for (const [ya, yb] of [[1.0, 3.2], [4.9, 7.1]]) {
      const px = dx + nx * (r + 0.03), pz = dz + nz * (r + 0.03), y = b.base;
      B.quad([px - tx * 1.1, y + ya, pz - tz * 1.1], [px + tx * 1.1, y + ya, pz + tz * 1.1], [px + tx * 1.1, y + yb, pz + tz * 1.1], [px - tx * 1.1, y + yb, pz - tz * 1.1], [nx, 0, nz], U0, GL);
    }
  }
  const words = ['WATERLOO', 'CITY', 'CENTRE'];
  words.forEach((wd, i) => {
    // the words run left to right as you face them: clockwise seen from above is +angle here (z is south)
    const a = fa - (i - 1) * 0.36;
    const nx = Math.cos(a), nz = Math.sin(a);
    const m = text(L, wd.length * 0.55, 0.7, wd.split('').join(' '), { fg: '#4a3a28', font: SERIF, wt: '700', k: 0.82, px: 40 });
    hang(g, m, dx + nx * r, b.base + 10.4, dz + nz * r, nx, nz, 0.06);
  });
  ctx.solids.push({ x: dx, z: dz, hw: r * 0.8, hd: r * 0.8, rot: 0, y0, y1: yD });
}

function library(kit, ctx, pts) {
  const L = ctx.atlas, city = ctx.city;
  const STONE = C('#8a7d6e'), BAND = C('#d8d0bc');
  const b = block(kit, ctx, pts, {
    h: 7.6, wall: STONE, trim: BAND, parapet: 0, cornice: 1.4,
    win: { style: 'ribbon', fl: 3.8, g0: 4.3, h: 1.3, top: 1.5 }, glass: C('#26323a'),
  });
  // the beige fascia band all round, the brown standing-seam roof rising behind it
  mansard(b.B, b.pts, b.yTop, 2.2, 4.0, C('#6b4a3a'), C('#5a3e31'));
  const e = frontEdge(city, b.E, /^Albert/, 8) || frontEdge(city, b.E, null, 8);
  if (e) {
    const gy = T(e.mx + e.nx * 2, e.mz + e.nz * 2);
    const B = b.B;
    rect(B, e, e.L * 0.3, e.L * 0.7, gy + 3.6, gy + 6.2, 0.4, C('#f4f2ec'));
    slab(B, e, e.L * 0.28, e.L * 0.72, gy + 3.4, gy + 3.6, 0, 2.2, BAND);
    for (const t of [e.L * 0.3, e.L * 0.7]) slab(B, e, t - 0.2, t + 0.2, gy, gy + 3.4, 1.8, 2.2, BAND);
    rect(B, e, e.L * 0.36, e.L * 0.64, gy, gy + 3.1, 0.06, C('#2a3640'));
    const m = text(L, Math.min(9, e.L * 0.38), 0.8, 'WATERLOO PUBLIC LIBRARY', { fg: '#141414', wt: '800', k: 0.6, px: 40 });
    onFace(b.g, e, e.L / 2, gy + 4.9, m, 0.44);
  }
}

function erb57(kit, ctx, pts) {
  const L = ctx.atlas, city = ctx.city;
  const BUFF = C('#cdbf9c'), SH = C('#8d9a8f'), GL = C('#2a2e30');
  const b = block(kit, ctx, pts, { h: 16.5, wall: BUFF, trim: C('#c4a878'), parapet: 0.6, cornice: 0.5 });
  const B = b.B;
  for (const e of b.E) {
    if (e.L < 5) continue;
    const gy = T(e.mx + e.nx * 2, e.mz + e.nz * 2);
    const n = Math.floor((e.L - 1) / 2.7), pad = (e.L - n * 2.7) / 2;
    for (let f = 0; f < 5; f++) {
      const y0 = gy + 1.0 + f * 3.2;
      if (y0 + 1.8 > b.yTop - 0.5) break;
      for (let i = 0; i < n; i++) {
        const t = pad + 2.7 * (i + 0.5);
        rect(B, e, t - 0.45, t + 0.45, y0, y0 + 1.6, 0.03, GL);
        // the segmental head in brick, the stone sill, grey-green shutters open either side
        B.tri(e.at(t - 0.6, y0 + 1.6, 0.035), e.at(t + 0.6, y0 + 1.6, 0.035), e.at(t, y0 + 1.95, 0.035), [e.nx, 0, e.nz], shade(BUFF, 0.85));
        rect(B, e, t - 0.55, t + 0.55, y0 - 0.12, y0, 0.06, C('#c9bfa6'));
        for (const s of [-1, 1]) rect(B, e, t + s * 0.5, t + s * 0.95, y0, y0 + 1.6, 0.08, SH);
      }
    }
  }
  const e = frontEdge(city, b.E, /^Erb/, 8);
  if (e) {
    const gy = T(e.mx + e.nx * 2, e.mz + e.nz * 2);
    slab(B, e, e.L / 2 - 2.2, e.L / 2 + 2.2, gy + 3.0, gy + 3.12, 0, 1.8, C('#2a2a2a'));
    const p = e.at(e.L / 2 + 4, 0, 5);
    const y = T(p[0], p[2]);
    B.box(p[0], y, p[2], 1.2, 2.4, 0.4, Math.atan2(e.uz, e.ux), C('#1c1c1c'));
    const m = text(L, 1.0, 0.8, '57', { fg: '#ffffff', font: SERIF, wt: '600', k: 0.8, px: 50, sub: 'Erb St. W.' });
    hang(b.g, m, p[0] + e.nx * 0.21, y + 1.6, p[2] + e.nz * 0.21, e.nx, e.nz, 0.01);
  }
}

function king95(kit, ctx, pts) {
  const L = ctx.atlas;
  const RED = C('#a0452e'), BEIGE = C('#d8ccb0');
  const b = block(kit, ctx, pts, {
    h: 14.2, wall: RED, trim: BEIGE, parapet: 0.8, cornice: 0.9, plinth: [1.0, BEIGE],
    win: { style: 'punch', sp: 3.2, w: 1.6, fl: 3.6, g0: 4.6, h: 1.9, sill: BEIGE, bands: BEIGE },
  });
  const B = b.B;
  // the ground floor's shop glass on every street face
  for (const e of b.E) {
    if (e.L < 6) continue;
    const gy = T(e.mx + e.nx * 2, e.mz + e.nz * 2);
    rect(B, e, 0.8, e.L - 0.8, gy + 0.4, gy + 3.4, 0.04, C('#1e2a30'));
    rect(B, e, 0, e.L, gy + 3.4, gy + 4.2, 0.06, BEIGE);
  }
  // the rotunda: silver aluminium and glass, a curved canopy, STARBUCKS COFFEE on it
  const [rx, rz, r] = K95_ROTUNDA, y0 = b.lo - 1.2, yR = b.base + 15.4, n = 18;
  B.prism(rx, y0, rz, r, yR - y0, n, C('#5d6f7a'));
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    B.prism(rx + Math.cos(a) * (r + 0.05), y0, rz + Math.sin(a) * (r + 0.05), 0.07, yR - y0, 4, C('#c8ccd0'));
  }
  for (let y = b.base + 4.2; y < yR; y += 3.6) B.prism(rx, y, rz, r + 0.12, 0.3, n, C('#c8ccd0'));
  B.prism(rx, b.base + 3.3, rz, r + 1.6, 0.35, n, C('#d0d4d8'));
  // which way the corner looks: out from the building's middle
  const [cx, cz] = centroid(pts);
  const fa = Math.atan2(rz - cz, rx - cx), g = kit.grp(rx, rz);
  const sb = L.panel(4.2, 0.55, 50, (q, W, H) => {
    q.clearRect(0, 0, W, H);
    q.fillStyle = '#00704a'; q.font = `800 ${H * 0.8}px ${SANS}`; q.textAlign = 'center'; q.textBaseline = 'middle';
    q.fillText('STARBUCKS COFFEE', W / 2, H * 0.55, W * 0.98);
  });
  hang(g, sb, rx + Math.cos(fa) * (r + 1.62), b.base + 3.47, rz + Math.sin(fa) * (r + 1.62), Math.cos(fa), Math.sin(fa), 0.01);
  const siren = L.panel(1.3, 1.3, 60, (q, W, H) => {
    q.clearRect(0, 0, W, H);
    q.fillStyle = '#00704a'; q.beginPath(); q.arc(W / 2, H / 2, W / 2 - 2, 0, Math.PI * 2); q.fill();
    q.fillStyle = '#ffffff'; q.beginPath(); q.arc(W / 2, H / 2, W * 0.3, 0, Math.PI * 2); q.fill();
    q.fillStyle = '#00704a'; q.beginPath(); q.arc(W / 2, H * 0.47, W * 0.16, 0, Math.PI * 2); q.fill();
  });
  hang(g, siren, rx + Math.cos(fa) * (r + 0.02), b.base + 6.2, rz + Math.sin(fa) * (r + 0.02), Math.cos(fa), Math.sin(fa), 0.04);
  // green patio umbrellas out front
  for (const k of [-1, 0, 1]) {
    const a = fa + k * 0.55, ux = rx + Math.cos(a) * (r + 4.2), uz = rz + Math.sin(a) * (r + 4.2), y = T(ux, uz) + 0.2;
    B.prism(ux, y, uz, 0.04, 2.3, 4, C('#d8d8d8'));
    B.cone(ux, y + 2.0, uz, 1.5, 0.55, 8, C('#1e6a48'));
  }
  ctx.solids.push({ x: rx, z: rz, hw: r * 0.8, hd: r * 0.8, rot: 0, y0, y1: yR });
}

function fourteen(kit, ctx, pts) {
  const TAN = C('#c8b28a'), BLUE = C('#3f6fa8');
  const b = block(kit, ctx, pts, {
    h: 25.5, wall: TAN, trim: C('#d8c8a6'), parapet: 0.8, plinth: [4.0, C('#22262a')],
    win: { style: 'curtain', sp: 1.4, fl: 3.05, g0: 4.0, top: 0.8, slab: C('#5a7aa0') }, glass: BLUE, frame: C('#2a3a50'),
  });
  // the tan panels: vertical bands between the glass, balconies on the street faces
  for (const e of b.E) {
    if (e.L < 6) continue;
    const gy = T(e.mx + e.nx * 2, e.mz + e.nz * 2);
    for (let t = 0; t <= e.L; t += Math.max(4, e.L / Math.round(e.L / 6))) rect(b.B, e, Math.max(0, t - 0.8), Math.min(e.L, t + 0.8), gy + 4.0, b.yTop, 0.07, TAN);
  }
}

// ---------------------------------------------------------------------------------------
// The King St N bike lanes (2018-19, Erb to Elgin): raised lanes behind black
// flexible bollards with white reflective bands every ~3.5 m, bright green
// paint where they cross a side street and the two-stage turn boxes at Erb.
// ---------------------------------------------------------------------------------------
const KING_N = [[-3833.9, -1465.2], [-3834.6, -1468.2], [-3837.3, -1481.0], [-3843.4, -1510.1], [-3845.1, -1518.9], [-3854.9, -1556.7], [-3872.4, -1649.1], [-3880.2, -1690.6], [-3887.0, -1725.9], [-3889.0, -1737.9]];
const CROSS = [[-3833.9, -1465.2], [-3854.9, -1556.7], [-3872.4, -1649.1], [-3889.0, -1737.9]];   // Erb, Dupont, Princess, Bridgeport

function bikeLanes(kit, ctx) {
  const city = ctx.city;
  const BLK = C('#121212'), WHT = C('#e8e8e8'), GRN = C('#3d7a40');
  let acc = 0;
  for (let i = 0; i + 1 < KING_N.length; i++) {
    const a = KING_N[i], b = KING_N[i + 1];
    const dx = b[0] - a[0], dz = b[1] - a[1], L = Math.hypot(dx, dz);
    if (L < 0.5) continue;
    const ux = dx / L, uz = dz / L, nx = -uz, nz = ux;
    for (let t = (3.5 - acc) % 3.5; t < L; t += 3.5) {
      const x = a[0] + ux * t, z = a[1] + uz * t;
      if (CROSS.some((c) => Math.hypot(c[0] - x, c[1] - z) < 14)) continue;
      const s = street(city, x, z, 12, /^King Street/);
      const hw = s ? s.hw : 7;
      for (const sd of [-1, 1]) {
        const px = x + nx * sd * (hw - 2.0), pz = z + nz * sd * (hw - 2.0);
        const y = walkY(city, px, pz);
        const B = kit.B(px, pz);
        B.box(px, y, pz, 0.16, 0.92, 0.16, 0, BLK);
        B.box(px, y + 0.62, pz, 0.17, 0.12, 0.17, 0, WHT);
        B.box(px, y + 0.78, pz, 0.17, 0.06, 0.17, 0, WHT);
        STATS.bollards++;
      }
    }
    acc = (acc + L) % 3.5;
  }
  // green where the lanes cross each side street: a strip along each lane through the junction
  for (const c of CROSS) {
    const s = street(city, c[0], c[1], 20, /^King Street/);
    if (!s) continue;
    const ux = s.ex, uz = s.ez, nx = -uz, nz = ux, hw = s.hw;
    for (const sd of [-1, 1]) {
      const B = kit.B(c[0], c[1], true);
      for (let t = -11; t < 11; t += 2) {
        const o = sd * (hw - 1.05), w = 0.85;
        const P = (tt, oo) => { const x = c[0] + ux * tt + nx * oo, z = c[1] + uz * tt + nz * oo; return [x, walkY(city, x, z) + 0.04, z]; };
        B.quad(P(t, o - w), P(t + 2, o - w), P(t + 2, o + w), P(t, o + w), [0, 1, 0], U0, GRN);
      }
    }
  }
  // the two-stage left-turn queue boxes at King & Erb
  const e = KING_N[0];
  const s = street(city, e[0], e[1], 20, /^King Street/);
  if (s) {
    const B = kit.B(e[0], e[1], true);
    for (const [tt, oo] of [[-14, s.hw - 1.0], [14, -(s.hw - 1.0)]]) {
      const cx = e[0] + s.ex * tt + -s.ez * oo, cz = e[1] + s.ez * tt + s.ex * oo, y = walkY(city, cx, cz) + 0.045;
      B.quad([cx - 1.2, y, cz - 1.2], [cx + 1.2, y, cz - 1.2], [cx + 1.2, y, cz + 1.2], [cx - 1.2, y, cz + 1.2], [0, 1, 0], U0, GRN);
    }
  }
}

function buildUptown(kit, ctx) {
  for (const b of BUILDINGS) {
    try { b.build(kit, ctx, ccw(b.p)); } catch (e) { console.warn('kwuptown ' + b.name + ': ' + e.message); }
  }
  try { bikeLanes(kit, ctx); } catch (e) { console.warn('kwuptown bike lanes: ' + e.message); }
}

export function uptownStats() { return STATS; }
export { LOOKS, BUILDINGS };
