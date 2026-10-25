// THE CHAIN STORES WHERE THEY REALLY ARE (data/shops.json, tools/kw/build_shops.py).
//
// Every LCBO, Beer Store, Walmart, Canadian Tire, Costco, Home Depot, RONA,
// grocery, pharmacy, big box, chain restaurant, gas station and bank OSM and
// the official store lists put on the map, each on the building it is in,
// dressed so it reads at driving distance:
//
//   - its LOGO, drawn once per brand into ONE canvas atlas (BrandAtlas) and
//     reused by every store, pylon and canopy of the brand;
//   - big boxes and supermarkets get a raised ENTRANCE PORTAL in the brand's
//     colour (Walmart's blue, Home Depot's orange...), Costco its stripes;
//     a stand-alone LCBO or Beer Store its colour band round the sign;
//   - fast food standing alone a pylon at the road;
//   - gas stations a CANOPY in the brand's bands (OSM's building=roof when it
//     maps one: that box goes flat here and the canopy is drawn on its
//     footprint), pump islands, and a PRICE PYLON at the road;
//   - every plaza (shop=mall / named landuse=retail) a PYLON at its road
//     entrance listing its real tenants, anchors first;
//   - every other building with a store in it (data `fronts`: Hespeler Rd's
//     strip, the fast-food pads, the banks, the dealers, the lube bays, the
//     gas kiosks) one storey with its storefront, drawn by its kind;
//   - every independent's name LETTERED on its fascia, from a one-channel
//     lettering atlas the same material reads (TextAtlas).
//
// Cost: all geometry is vertex-coloured into kw.js's footprint material and
// every logo into the atlas material, per 1200 m cluster (`kwp` keys, the
// same clusters as kw.js buildPolys) -- at most one extra draw per cluster
// in view, the atlas's.

import * as THREE from './three.js';
import * as G from './geo.js';
import { Builder } from './build.js';
import { boxAt, faceFor, faceRoad, polyFace, polyMat, kwData } from './kw.js';

let S = null;
/** fn({ A, Gb, Lb, ctx, solid, txt, bg, brandOf, logoOf }) run inside buildShops, before the atlas is finished. */
export const SHOP_HOOKS = [];
export function setShopData(d) {
  // (window.__noShops before boot: none of this, for a before/after)
  S = typeof window !== 'undefined' && window.__noShops ? null : d;
  const K = kwData();
  if (K && d && d.names) K.chainNames = new Set(d.names);
}

const lin = (hex) => {
  const n = parseInt(hex.slice(1), 16);
  return [Math.pow(((n >> 16) & 255) / 255, 2.2), Math.pow(((n >> 8) & 255) / 255, 2.2), Math.pow((n & 255) / 255, 2.2)];
};
const SANS = 'Helvetica, Arial, sans-serif';
const SERIF = 'Georgia, "Times New Roman", serif';
const SCRIPT = '"Brush Script MT", "Snell Roundhand", "Segoe Script", cursive';

// --- the logos ---------------------------------------------------------------------
// Each draws into a W x H cell (aspect `a`). Approximations of the real marks
// in the real colours, made to read at 50-150 m.

function txt(g, s, x, y, size, col, opts = {}) {
  g.fillStyle = col;
  g.textAlign = opts.align || 'center'; g.textBaseline = 'middle';
  g.font = `${opts.italic ? 'italic ' : ''}${opts.w || 800} ${size}px ${opts.font || SANS}`;
  if (opts.stroke) { g.lineWidth = size * 0.1; g.strokeStyle = opts.stroke; g.strokeText(s, x, y, opts.max || 1e4); }
  g.fillText(s, x, y, opts.max || 1e4);
}
function bg(g, W, H, c) { g.fillStyle = c; g.fillRect(0, 0, W, H); }
function rrect(g, x, y, w, h, r) {
  g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath();
}
function leaf(g, cx, cy, r, col) {
  // a maple leaf, simplified: eleven points
  const P = [[0, -1], [0.2, -0.55], [0.5, -0.7], [0.4, -0.25], [0.95, -0.3], [0.75, 0.05], [0.95, 0.25], [0.3, 0.3], [0.1, 0.55],
    [0.08, 1], [-0.08, 1], [-0.1, 0.55], [-0.3, 0.3], [-0.95, 0.25], [-0.75, 0.05], [-0.95, -0.3], [-0.4, -0.25], [-0.5, -0.7], [-0.2, -0.55]];
  g.fillStyle = col; g.beginPath();
  P.forEach(([x, y], i) => (i ? g.lineTo : g.moveTo).call(g, cx + x * r, cy + y * r));
  g.closePath(); g.fill();
}
function spark(g, cx, cy, r, col) {
  // Walmart's spark: six rounded rays
  g.fillStyle = col;
  for (let i = 0; i < 6; i++) {
    g.save(); g.translate(cx, cy); g.rotate((i * Math.PI) / 3);
    rrect(g, -r * 0.13, -r, r * 0.26, r * 0.56, r * 0.13); g.fill();
    g.restore();
  }
}
function arches(g, cx, cy, w, h, col) {
  g.strokeStyle = col; g.lineWidth = w * 0.13; g.lineCap = 'butt';
  for (const s of [-1, 1]) {
    g.beginPath();
    const x0 = cx + s * w * 0.5 - s * w * 0.06, x1 = cx;
    g.moveTo(x0, cy + h / 2);
    g.bezierCurveTo(x0, cy - h * 0.9, cx + s * w * 0.06, cy - h * 0.9, x1, cy + h * 0.05);
    g.stroke();
  }
}

const B = {};
const brand = (k, o) => { B[k] = o; };
// fmt: big (portal), groc (portal), store (fascia sign), lcbo (sign + band), food (sign + pylon if alone), bank, gas
brand('walmart', { n: 'Walmart', fmt: 'big', a: 4, portal: '#0071ce', trim: '#004c91', band: '#0071ce',
  draw: (g, W, H) => { bg(g, W, H, '#0071ce'); txt(g, 'Walmart', W * 0.42, H * 0.54, H * 0.66, '#ffffff', { w: 700, max: W * 0.7 }); spark(g, W * 0.86, H * 0.5, H * 0.4, '#ffc220'); } });
brand('costco', { n: 'Costco', fmt: 'big', style: 'stripes', a: 2.6, band: '#e31837',
  draw: (g, W, H) => { bg(g, W, H, '#ffffff'); txt(g, 'COSTCO', W / 2, H * 0.38, H * 0.6, '#e31837', { w: 900, italic: true, max: W * 0.92 });
    g.fillStyle = '#005daa'; g.fillRect(W * 0.04, H * 0.7, W * 0.92, H * 0.24); txt(g, 'WHOLESALE', W / 2, H * 0.825, H * 0.2, '#ffffff', { w: 800 }); } });
brand('ct', { n: 'Canadian Tire', fmt: 'big', a: 3.6, portal: '#e8e6e1', trim: '#d0121b', band: '#d0121b',
  draw: (g, W, H) => { bg(g, W, H, '#ffffff');
    g.fillStyle = '#d0121b'; g.beginPath(); g.moveTo(H * 0.08, H * 0.1); g.lineTo(H * 0.92, H * 0.1); g.lineTo(H * 0.5, H * 0.94); g.closePath(); g.fill();
    leaf(g, H * 0.5, H * 0.38, H * 0.2, '#00843d');
    txt(g, 'CANADIAN TIRE', H + (W - H) / 2, H * 0.55, H * 0.4, '#d0121b', { w: 900, max: W - H * 1.15 }); } });
brand('homedepot', { n: 'The Home Depot', fmt: 'big', a: 1, portal: '#f96302', trim: '#c94f00', band: '#f96302',
  draw: (g, W, H) => { bg(g, W, H, '#f96302'); g.strokeStyle = '#ffffff'; g.lineWidth = W * 0.03; g.strokeRect(W * 0.06, H * 0.06, W * 0.88, H * 0.88);
    g.save(); g.translate(W / 2, H / 2); g.rotate(-Math.PI / 4);
    txt(g, 'THE', 0, -H * 0.22, H * 0.13, '#ffffff', { w: 900, font: 'Impact, ' + SANS });
    txt(g, 'HOME', 0, -H * 0.04, H * 0.22, '#ffffff', { w: 900, font: 'Impact, ' + SANS });
    txt(g, 'DEPOT', 0, H * 0.19, H * 0.22, '#ffffff', { w: 900, font: 'Impact, ' + SANS }); g.restore(); } });
brand('rona', { n: 'RONA', fmt: 'big', a: 3, portal: '#003da5', trim: '#ffcd00', band: '#003da5',
  draw: (g, W, H) => { bg(g, W, H, '#003da5'); txt(g, 'RONA', W * 0.46, H * 0.48, H * 0.72, '#ffffff', { w: 900 });
    g.fillStyle = '#ffcd00'; g.fillRect(W * 0.12, H * 0.82, W * 0.68, H * 0.08); txt(g, '+', W * 0.86, H * 0.38, H * 0.6, '#ffcd00', { w: 900 }); } });
brand('bestbuy', { n: 'Best Buy', fmt: 'big', a: 2.2, portal: '#0046be', trim: '#002e7a', band: '#0046be',
  draw: (g, W, H) => { bg(g, W, H, '#0046be'); g.fillStyle = '#fff200';
    g.beginPath(); g.moveTo(W * 0.08, H * 0.18); g.lineTo(W * 0.78, H * 0.18); g.lineTo(W * 0.92, H * 0.5); g.lineTo(W * 0.78, H * 0.82); g.lineTo(W * 0.08, H * 0.82); g.closePath(); g.fill();
    g.fillStyle = '#0046be'; g.beginPath(); g.arc(W * 0.8, H * 0.5, H * 0.06, 0, 7); g.fill();
    txt(g, 'BEST BUY', W * 0.42, H * 0.52, H * 0.4, '#111111', { w: 900, max: W * 0.62 }); } });
brand('staples', { n: 'Staples', fmt: 'store', a: 3.4, band: '#cc0000',
  draw: (g, W, H) => { bg(g, W, H, '#cc0000'); txt(g, 'STAPLES', W / 2, H * 0.54, H * 0.62, '#ffffff', { w: 900, max: W * 0.9 }); } });
brand('winners', { n: 'Winners', fmt: 'store', a: 3.4, band: '#ffffff',
  draw: (g, W, H) => { bg(g, W, H, '#ffffff'); txt(g, 'WINNERS', W / 2, H * 0.54, H * 0.66, '#d6001c', { w: 900, max: W * 0.92 }); } });
brand('homesense', { n: 'HomeSense', fmt: 'store', a: 3.6, band: '#ffffff',
  draw: (g, W, H) => { bg(g, W, H, '#ffffff'); txt(g, 'HomeSense', W / 2, H * 0.54, H * 0.62, '#8a1538', { w: 700, max: W * 0.92 }); } });
brand('marshalls', { n: 'Marshalls', fmt: 'store', a: 3.4, band: '#ffffff',
  draw: (g, W, H) => { bg(g, W, H, '#ffffff'); txt(g, 'Marshalls', W / 2, H * 0.54, H * 0.64, '#00205b', { w: 800, max: W * 0.92 }); } });
brand('valuevillage', { n: 'Value Village', fmt: 'store', a: 3.6, band: '#d50032',
  draw: (g, W, H) => { bg(g, W, H, '#d50032'); txt(g, 'VALUE VILLAGE', W / 2, H * 0.46, H * 0.48, '#ffffff', { w: 900, max: W * 0.92 });
    g.fillStyle = '#ffc72c'; g.fillRect(W * 0.08, H * 0.78, W * 0.84, H * 0.08); } });
brand('dollarama', { n: 'Dollarama', fmt: 'store', a: 3.8, band: '#00843d',
  draw: (g, W, H) => { bg(g, W, H, '#00843d'); txt(g, 'DOLLARAMA', W / 2, H * 0.54, H * 0.6, '#ffd200', { w: 900, max: W * 0.92 }); } });
brand('giant', { n: 'Giant Tiger', fmt: 'store', a: 3.4, band: '#111111',
  draw: (g, W, H) => { bg(g, W, H, '#111111'); txt(g, 'GIANT TIGER', W / 2, H * 0.54, H * 0.5, '#f7941d', { w: 900, max: W * 0.92 }); } });
brand('sportchek', { n: 'Sport Chek', fmt: 'store', a: 3.4, band: '#d71920',
  draw: (g, W, H) => { bg(g, W, H, '#d71920'); txt(g, 'SPORT CHEK', W / 2, H * 0.54, H * 0.52, '#ffffff', { w: 900, italic: true, max: W * 0.92 }); } });
brand('shoppers', { n: 'Shoppers Drug Mart', fmt: 'store', a: 4, band: '#d71920',
  draw: (g, W, H) => { bg(g, W, H, '#d71920');
    g.fillStyle = '#ffffff'; g.beginPath(); g.arc(H * 0.5, H * 0.5, H * 0.34, 0, 7); g.fill(); txt(g, 'P', H * 0.5, H * 0.53, H * 0.46, '#d71920', { w: 900 });
    txt(g, 'SHOPPERS', H + (W - H) / 2, H * 0.36, H * 0.4, '#ffffff', { w: 900, max: W - H * 1.2 });
    txt(g, 'DRUG MART', H + (W - H) / 2, H * 0.76, H * 0.24, '#ffffff', { w: 700, max: W - H * 1.2 }); } });
brand('zehrs', { n: 'Zehrs', fmt: 'groc', a: 3.2, portal: '#f4f1ea', trim: '#ee3124', band: '#ee3124',
  draw: (g, W, H) => { bg(g, W, H, '#ffffff');
    g.fillStyle = '#ee3124'; rrect(g, H * 0.12, H * 0.12, H * 0.76, H * 0.76, H * 0.1); g.fill();
    g.strokeStyle = '#ffffff'; g.lineWidth = H * 0.1; g.beginPath(); g.moveTo(H * 0.3, H * 0.32); g.lineTo(H * 0.7, H * 0.32); g.lineTo(H * 0.3, H * 0.68); g.lineTo(H * 0.7, H * 0.68); g.stroke();
    txt(g, 'zehrs', H + (W - H) / 2, H * 0.48, H * 0.7, '#ee3124', { w: 900, max: W - H * 1.15 }); } });
brand('sobeys', { n: 'Sobeys', fmt: 'groc', a: 3.2, portal: '#0e5a19', trim: '#e8e4d8', band: '#0e5a19',
  draw: (g, W, H) => { bg(g, W, H, '#0e5a19'); txt(g, 'Sobeys', W * 0.54, H * 0.54, H * 0.72, '#ffffff', { w: 700, italic: true, font: SERIF, max: W * 0.76 });
    g.fillStyle = '#f39200'; g.beginPath(); g.ellipse(W * 0.1, H * 0.5, H * 0.16, H * 0.3, 0.4, 0, 7); g.fill(); } });
brand('foodbasics', { n: 'Food Basics', fmt: 'groc', a: 3.6, portal: '#ffcd00', trim: '#00843d', band: '#ffcd00',
  draw: (g, W, H) => { bg(g, W, H, '#ffcd00'); txt(g, 'Food Basics', W / 2, H * 0.54, H * 0.6, '#00843d', { w: 900, max: W * 0.92 }); } });
brand('nofrills', { n: 'No Frills', fmt: 'groc', a: 3.2, portal: '#ffe600', trim: '#111111', band: '#ffe600',
  draw: (g, W, H) => { bg(g, W, H, '#ffe600'); txt(g, 'no frills', W / 2, H * 0.5, H * 0.66, '#111111', { w: 900, max: W * 0.92 }); } });
brand('superstore', { n: 'Real Canadian Superstore', fmt: 'groc', a: 3.6, portal: '#ffffff', trim: '#e31837', band: '#e31837',
  draw: (g, W, H) => { bg(g, W, H, '#ffffff'); txt(g, 'real canadian', W / 2, H * 0.24, H * 0.2, '#e31837', { w: 700 });
    txt(g, 'SUPERSTORE', W / 2, H * 0.62, H * 0.48, '#e31837', { w: 900, max: W * 0.92 }); } });
// the second tier of anchors and plaza tenants (smaller atlas cells: `px`)
brand('independent', { n: 'Your Independent Grocer', fmt: 'groc', a: 3.4, px: 72, portal: '#f4f1ea', trim: '#d7282f', band: '#d7282f',
  draw: (g, W, H) => { bg(g, W, H, '#ffffff'); txt(g, 'your', W * 0.12, H * 0.3, H * 0.26, '#222222', { w: 700, align: 'left' });
    txt(g, 'independent', W / 2, H * 0.58, H * 0.42, '#d7282f', { w: 900, max: W * 0.9 }); txt(g, 'grocer', W * 0.88, H * 0.86, H * 0.2, '#222222', { w: 700, align: 'right' }); } });
brand('farmboy', { n: 'Farm Boy', fmt: 'groc', a: 3, px: 72, portal: '#c8102e', trim: '#2e7d32', band: '#c8102e',
  draw: (g, W, H) => { bg(g, W, H, '#ffffff'); txt(g, 'Farm Boy', W / 2, H * 0.5, H * 0.62, '#c8102e', { w: 900, italic: true, font: SERIF, max: W * 0.9 });
    g.fillStyle = '#2e7d32'; g.fillRect(W * 0.1, H * 0.84, W * 0.8, H * 0.07); } });
brand('longos', { n: "Longo's", fmt: 'groc', a: 3, px: 72, portal: '#1f6b35', trim: '#e8e2cf', band: '#1f6b35',
  draw: (g, W, H) => { bg(g, W, H, '#1f6b35'); txt(g, "Longo's", W / 2, H * 0.54, H * 0.66, '#ffffff', { w: 800, font: SERIF, max: W * 0.9 }); } });
brand('tnt', { n: 'T&T Supermarket', fmt: 'groc', a: 3, px: 72, portal: '#e60012', trim: '#ffffff', band: '#e60012',
  draw: (g, W, H) => { bg(g, W, H, '#e60012'); txt(g, 'T&T', W * 0.3, H * 0.54, H * 0.66, '#ffffff', { w: 900 });
    txt(g, '大統華', W * 0.72, H * 0.54, H * 0.46, '#ffffff', { w: 700, max: W * 0.44 }); } });
brand('rexall', { n: 'Rexall', fmt: 'store', a: 3, px: 72, band: '#ffffff',
  draw: (g, W, H) => { bg(g, W, H, '#ffffff'); txt(g, 'Rexall', W / 2, H * 0.52, H * 0.66, '#d6001c', { w: 900, max: W * 0.9 });
    g.fillStyle = '#0b3e8a'; g.fillRect(W * 0.12, H * 0.84, W * 0.76, H * 0.07); } });
brand('pharmasave', { n: 'Pharmasave', fmt: 'store', a: 3.6, px: 72, band: '#ffffff',
  draw: (g, W, H) => { bg(g, W, H, '#ffffff'); txt(g, 'PHARMASAVE', W / 2, H * 0.54, H * 0.5, '#d6001c', { w: 900, max: W * 0.92 }); } });
brand('dollartree', { n: 'Dollar Tree', fmt: 'store', a: 3.4, px: 72, band: '#ffffff',
  draw: (g, W, H) => { bg(g, W, H, '#ffffff'); txt(g, 'Dollar Tree', W * 0.56, H * 0.54, H * 0.56, '#00843d', { w: 900, max: W * 0.78 });
    g.fillStyle = '#00843d'; g.beginPath(); g.arc(W * 0.09, H * 0.42, H * 0.24, 0, 7); g.fill(); g.fillRect(W * 0.085, H * 0.5, W * 0.014, H * 0.36); } });
brand('bulkbarn', { n: 'Bulk Barn', fmt: 'store', a: 3, px: 72, band: '#b5121b',
  draw: (g, W, H) => { bg(g, W, H, '#b5121b'); txt(g, 'BULK BARN', W / 2, H * 0.56, H * 0.5, '#ffffff', { w: 900, max: W * 0.9 });
    g.fillStyle = '#ffffff'; g.fillRect(W * 0.1, H * 0.12, W * 0.8, H * 0.05); } });
brand('petvalu', { n: 'Pet Valu', fmt: 'store', a: 3, px: 72, band: '#00824a',
  draw: (g, W, H) => { bg(g, W, H, '#00824a'); txt(g, 'Pet Valu', W * 0.46, H * 0.54, H * 0.62, '#ffffff', { w: 900, max: W * 0.74 });
    g.fillStyle = '#f7941d'; g.beginPath(); g.arc(W * 0.9, H * 0.5, H * 0.17, 0, 7); g.fill(); } });
brand('petsmart', { n: 'PetSmart', fmt: 'store', a: 3.4, px: 72, band: '#ffffff',
  draw: (g, W, H) => { bg(g, W, H, '#ffffff'); txt(g, 'PETSMART', W / 2, H * 0.54, H * 0.6, '#e31837', { w: 900, max: W * 0.92 }); } });
brand('michaels', { n: 'Michaels', fmt: 'store', a: 3.2, px: 72, band: '#ffffff',
  draw: (g, W, H) => { bg(g, W, H, '#ffffff'); txt(g, 'Michaels', W / 2, H * 0.54, H * 0.66, '#cc0000', { w: 700, italic: true, font: SERIF, max: W * 0.9 }); } });
brand('marks', { n: "Mark's", fmt: 'store', a: 2.6, px: 72, band: '#c8102e',
  draw: (g, W, H) => { bg(g, W, H, '#c8102e'); txt(g, "Mark's", W / 2, H * 0.54, H * 0.66, '#ffffff', { w: 900, max: W * 0.88 }); } });
brand('indigo', { n: 'Indigo', fmt: 'store', a: 3, px: 72, band: '#2b2b2b',
  draw: (g, W, H) => { bg(g, W, H, '#2b2b2b'); txt(g, 'indigo', W / 2, H * 0.5, H * 0.7, '#ffffff', { w: 400, font: SERIF, max: W * 0.88 }); } });
brand('homehardware', { n: 'Home Hardware', fmt: 'store', a: 3.6, px: 72, band: '#d71920',
  draw: (g, W, H) => { bg(g, W, H, '#d71920'); g.fillStyle = '#ffffff';
    g.beginPath(); g.moveTo(H * 0.14, H * 0.52); g.lineTo(H * 0.5, H * 0.16); g.lineTo(H * 0.86, H * 0.52); g.lineTo(H * 0.76, H * 0.52); g.lineTo(H * 0.76, H * 0.86); g.lineTo(H * 0.24, H * 0.86); g.lineTo(H * 0.24, H * 0.52); g.closePath(); g.fill();
    txt(g, 'HOME HARDWARE', H + (W - H) / 2, H * 0.55, H * 0.36, '#ffffff', { w: 900, max: W - H * 1.15 }); } });
brand('brick', { n: 'The Brick', fmt: 'store', a: 3, px: 72, band: '#d6001c',
  draw: (g, W, H) => { bg(g, W, H, '#d6001c'); txt(g, 'the brick', W / 2, H * 0.52, H * 0.6, '#ffffff', { w: 900, max: W * 0.9 }); } });
brand('leons', { n: "Leon's", fmt: 'store', a: 3, px: 72, band: '#ffffff',
  draw: (g, W, H) => { bg(g, W, H, '#ffffff'); txt(g, "LEON'S", W / 2, H * 0.54, H * 0.64, '#c8102e', { w: 900, max: W * 0.9 }); } });
brand('golftown', { n: 'Golf Town', fmt: 'store', a: 3.4, px: 72, band: '#00573f',
  draw: (g, W, H) => { bg(g, W, H, '#00573f'); txt(g, 'GOLF TOWN', W / 2, H * 0.54, H * 0.54, '#ffffff', { w: 900, max: W * 0.92 }); } });
brand('lcbo', { n: 'LCBO', fmt: 'lcbo', a: 2.4, band: '#2b2b2b', portal: '#2b2b2b', trim: '#007a3d',
  draw: (g, W, H) => { bg(g, W, H, '#007a3d'); txt(g, 'LCBO', W / 2, H * 0.55, H * 0.74, '#ffffff', { w: 900, max: W * 0.86 }); } });
brand('beer', { n: 'The Beer Store', fmt: 'lcbo', a: 3, band: '#00438c', portal: '#00438c', trim: '#ffc72c',
  draw: (g, W, H) => { bg(g, W, H, '#00438c'); txt(g, 'THE', W / 2, H * 0.17, H * 0.18, '#ffffff', { w: 800 });
    txt(g, 'BEER STORE', W / 2, H * 0.5, H * 0.42, '#ffffff', { w: 900, max: W * 0.92 });
    g.fillStyle = '#ffc72c'; g.fillRect(0, H * 0.78, W, H * 0.14); } });
// restaurants
brand('mcd', { n: "McDonald's", fmt: 'food', a: 1.15, band: '#da291c', pole: 10,
  draw: (g, W, H) => { bg(g, W, H, '#da291c'); arches(g, W / 2, H * 0.52, W * 0.8, H * 0.74, '#ffc72c'); } });
brand('harveys', { n: "Harvey's", fmt: 'food', a: 3, band: '#e21836',
  draw: (g, W, H) => { bg(g, W, H, '#e21836'); txt(g, "Harvey's", W / 2, H * 0.54, H * 0.66, '#ffffff', { w: 800, italic: true, font: SERIF, max: W * 0.9 });
    g.fillStyle = '#ffd400'; g.fillRect(0, H * 0.88, W, H * 0.12); } });
brand('aw', { n: 'A&W', fmt: 'food', a: 1.6, band: '#5b2c14',
  draw: (g, W, H) => { bg(g, W, H, '#5b2c14'); g.fillStyle = '#f26522'; g.beginPath(); g.ellipse(W / 2, H / 2, W * 0.44, H * 0.4, 0, 0, 7); g.fill();
    txt(g, 'A&W', W / 2, H * 0.53, H * 0.5, '#ffffff', { w: 900, stroke: '#5b2c14' }); } });
brand('swiss', { n: 'Swiss Chalet', fmt: 'food', a: 3.2, band: '#c8102e',
  draw: (g, W, H) => { bg(g, W, H, '#c8102e'); g.fillStyle = '#ffffff';
    g.beginPath(); g.moveTo(H * 0.12, H * 0.5); g.lineTo(H * 0.5, H * 0.16); g.lineTo(H * 0.88, H * 0.5); g.lineTo(H * 0.78, H * 0.5); g.lineTo(H * 0.78, H * 0.84); g.lineTo(H * 0.22, H * 0.84); g.lineTo(H * 0.22, H * 0.5); g.closePath(); g.fill();
    txt(g, 'Swiss Chalet', H + (W - H) / 2, H * 0.54, H * 0.5, '#ffffff', { w: 700, font: SERIF, max: W - H * 1.1 }); } });
brand('bp', { n: 'Boston Pizza', fmt: 'food', a: 3.2, band: '#1a1a1a',
  draw: (g, W, H) => { bg(g, W, H, '#1a1a1a'); g.fillStyle = '#e4002b'; g.beginPath(); g.arc(H * 0.5, H * 0.5, H * 0.38, 0, 7); g.fill();
    txt(g, 'bp', H * 0.5, H * 0.5, H * 0.4, '#ffffff', { w: 900 });
    txt(g, 'BOSTON PIZZA', H + (W - H) / 2, H * 0.54, H * 0.36, '#ffffff', { w: 900, max: W - H * 1.15 }); } });
brand('montanas', { n: "Montana's", fmt: 'food', a: 3, band: '#3b2314',
  draw: (g, W, H) => { bg(g, W, H, '#3b2314'); txt(g, "MONTANA'S", W / 2, H * 0.4, H * 0.46, '#f2e3c6', { w: 900, font: SERIF, max: W * 0.9 });
    txt(g, 'BBQ & BAR', W / 2, H * 0.8, H * 0.2, '#e0452b', { w: 800 }); } });
brand('esm', { n: "East Side Mario's", fmt: 'food', a: 3.2, band: '#ffffff',
  draw: (g, W, H) => { bg(g, W, H, '#ffffff'); g.fillStyle = '#009246'; g.fillRect(0, 0, W / 3, H * 0.12); g.fillStyle = '#ce2b37'; g.fillRect(W * 2 / 3, 0, W / 3, H * 0.12);
    txt(g, "East Side Mario's", W / 2, H * 0.58, H * 0.48, '#ce2b37', { w: 800, italic: true, font: SERIF, max: W * 0.92 }); } });
brand('starbucks', { n: 'Starbucks', fmt: 'food', a: 1, band: '#00704a',
  draw: (g, W, H) => { bg(g, W, H, '#ffffff'); g.fillStyle = '#00704a'; g.beginPath(); g.arc(W / 2, H / 2, W * 0.46, 0, 7); g.fill();
    g.strokeStyle = '#ffffff'; g.lineWidth = W * 0.035; g.beginPath(); g.arc(W / 2, H / 2, W * 0.33, 0, 7); g.stroke();
    g.fillStyle = '#ffffff'; g.beginPath(); g.arc(W / 2, H * 0.54, W * 0.13, 0, 7); g.fill();
    for (let i = -1; i <= 1; i++) { g.beginPath(); g.arc(W / 2 + i * W * 0.09, H * 0.33, W * 0.035, 0, 7); g.fill(); }
    g.fillStyle = '#00704a'; g.beginPath(); g.arc(W / 2, H * 0.56, W * 0.07, 0, 7); g.fill(); } });
brand('wendys', { n: "Wendy's", fmt: 'food', a: 3, band: '#ffffff',
  draw: (g, W, H) => { bg(g, W, H, '#ffffff'); txt(g, "Wendy's", W / 2, H * 0.54, H * 0.66, '#e2203d', { w: 700, italic: true, font: SCRIPT, max: W * 0.9 }); } });
brand('bk', { n: 'Burger King', fmt: 'food', a: 1.5, band: '#502314',
  draw: (g, W, H) => { bg(g, W, H, '#f5ebdc'); g.fillStyle = '#ff8732';
    g.beginPath(); g.ellipse(W / 2, H * 0.5, W * 0.46, H * 0.44, 0, 0, 7); g.fill();
    g.fillStyle = '#f5ebdc'; g.fillRect(W * 0.04, H * 0.33, W * 0.92, H * 0.34);
    txt(g, 'BURGER', W / 2, H * 0.4, H * 0.15, '#d62300', { w: 900 }); txt(g, 'KING', W / 2, H * 0.58, H * 0.17, '#d62300', { w: 900 }); } });
brand('kfc', { n: 'KFC', fmt: 'food', a: 2, band: '#e4002b',
  draw: (g, W, H) => { bg(g, W, H, '#e4002b'); for (let i = 0; i < 3; i++) { g.fillStyle = '#ffffff'; g.fillRect(W * (0.06 + i * 0.07), 0, W * 0.035, H * 0.22); }
    txt(g, 'KFC', W / 2, H * 0.6, H * 0.6, '#ffffff', { w: 900 }); } });
brand('subway', { n: 'Subway', fmt: 'food', a: 3.4, band: '#008c15',
  draw: (g, W, H) => { bg(g, W, H, '#008c15'); txt(g, 'SUB', W * 0.34, H * 0.54, H * 0.56, '#ffffff', { w: 900, align: 'center' });
    txt(g, 'WAY', W * 0.66, H * 0.54, H * 0.56, '#ffc600', { w: 900, align: 'center' }); } });
brand('dq', { n: 'Dairy Queen', fmt: 'food', a: 1.6, band: '#ee3e42',
  draw: (g, W, H) => { bg(g, W, H, '#ffffff'); g.fillStyle = '#ee3e42'; g.beginPath(); g.ellipse(W / 2, H / 2, W * 0.46, H * 0.38, 0, 0, 7); g.fill();
    txt(g, 'DQ', W / 2, H * 0.53, H * 0.44, '#ffffff', { w: 900 }); } });
brand('pizzapizza', { n: 'Pizza Pizza', fmt: 'food', a: 3.2, band: '#ee3124',
  draw: (g, W, H) => { bg(g, W, H, '#ee3124'); txt(g, 'PIZZA PIZZA', W / 2, H * 0.54, H * 0.5, '#ffffff', { w: 900, max: W * 0.92 }); } });
brand('popeyes', { n: 'Popeyes', fmt: 'food', a: 3, band: '#f15a22',
  draw: (g, W, H) => { bg(g, W, H, '#f15a22'); txt(g, 'POPEYES', W / 2, H * 0.54, H * 0.56, '#ffffff', { w: 900, max: W * 0.9 }); } });
// banks
brand('td', { n: 'TD Canada Trust', fmt: 'bank', a: 3, band: '#008a00',
  draw: (g, W, H) => { bg(g, W, H, '#008a00'); g.fillStyle = '#ffffff'; g.fillRect(H * 0.1, H * 0.1, H * 0.8, H * 0.8);
    txt(g, 'TD', H * 0.5, H * 0.53, H * 0.5, '#008a00', { w: 900 }); txt(g, 'Canada Trust', H + (W - H) / 2, H * 0.54, H * 0.36, '#ffffff', { w: 700, max: W - H * 1.15 }); } });
brand('rbc', { n: 'RBC Royal Bank', fmt: 'bank', a: 3, band: '#005daa',
  draw: (g, W, H) => { bg(g, W, H, '#005daa'); g.fillStyle = '#ffd200';
    g.beginPath(); g.moveTo(H * 0.12, H * 0.12); g.lineTo(H * 0.88, H * 0.12); g.lineTo(H * 0.88, H * 0.55); g.quadraticCurveTo(H * 0.88, H * 0.85, H * 0.5, H * 0.94); g.quadraticCurveTo(H * 0.12, H * 0.85, H * 0.12, H * 0.55); g.closePath(); g.fill();
    txt(g, 'RBC', H * 0.5, H * 0.48, H * 0.3, '#005daa', { w: 900 }); txt(g, 'Royal Bank', H + (W - H) / 2, H * 0.54, H * 0.36, '#ffffff', { w: 700, max: W - H * 1.15 }); } });
brand('cibc', { n: 'CIBC', fmt: 'bank', a: 2.6, band: '#c41f3e',
  draw: (g, W, H) => { bg(g, W, H, '#c41f3e'); g.fillStyle = '#8b1d2c'; g.fillRect(H * 0.15, H * 0.2, H * 0.3, H * 0.6); g.fillStyle = '#ffffff'; g.fillRect(H * 0.5, H * 0.2, H * 0.3, H * 0.6);
    txt(g, 'CIBC', H + (W - H) / 2, H * 0.54, H * 0.56, '#ffffff', { w: 900, max: W - H * 1.15 }); } });
brand('bmo', { n: 'BMO', fmt: 'bank', a: 2.4, band: '#0079c1',
  draw: (g, W, H) => { bg(g, W, H, '#0079c1'); g.fillStyle = '#e1251b'; g.beginPath(); g.arc(H * 0.5, H * 0.5, H * 0.38, 0, 7); g.fill();
    txt(g, 'M', H * 0.5, H * 0.56, H * 0.42, '#ffffff', { w: 900 }); g.fillStyle = '#ffffff'; g.fillRect(H * 0.3, H * 0.26, H * 0.4, H * 0.06);
    txt(g, 'BMO', H + (W - H) / 2, H * 0.54, H * 0.56, '#ffffff', { w: 900, max: W - H * 1.15 }); } });
brand('scotia', { n: 'Scotiabank', fmt: 'bank', a: 3.4, band: '#ec111a',
  draw: (g, W, H) => { bg(g, W, H, '#ec111a'); txt(g, 'Scotiabank', W / 2, H * 0.54, H * 0.56, '#ffffff', { w: 800, max: W * 0.9 }); } });
// gas: `canopy` [body, stripe, second stripe]
brand('esso', { n: 'Esso', fmt: 'gas', a: 1.7, canopy: ['#ffffff', '#d6001c', '#0b3e8a'], price: '#0b3e8a',
  draw: (g, W, H) => { bg(g, W, H, '#ffffff'); g.strokeStyle = '#0b3e8a'; g.lineWidth = H * 0.08; g.beginPath(); g.ellipse(W / 2, H / 2, W * 0.44, H * 0.38, 0, 0, 7); g.stroke();
    txt(g, 'Esso', W / 2, H * 0.53, H * 0.48, '#d6001c', { w: 900, italic: true }); } });
// 7-Eleven's own forecourt (the Esso stores it bought in 2016): white canopy
// with the green / orange / red bands, the 7 in orange with ELEVEn across it
brand('7eleven', { n: '7-Eleven', fmt: 'gas', a: 1, canopy: ['#ffffff', '#008163', '#f47920'], price: '#008163',
  draw: (g, W, H) => { bg(g, W, H, '#ffffff');
    g.fillStyle = '#008163'; g.fillRect(W * 0.06, H * 0.06, W * 0.88, H * 0.88); g.fillStyle = '#ffffff'; g.fillRect(W * 0.1, H * 0.1, W * 0.8, H * 0.8);
    txt(g, '7', W * 0.5, H * 0.5, H * 0.86, '#f47920', { w: 900 });
    g.fillStyle = '#ffffff'; g.fillRect(W * 0.12, H * 0.43, W * 0.76, H * 0.2);
    txt(g, 'ELEVEn', W * 0.5, H * 0.54, H * 0.19, '#ee2526', { w: 900, max: W * 0.74 });
    g.fillStyle = '#ee2526'; g.fillRect(W * 0.14, H * 0.82, W * 0.72, H * 0.05); } });
brand('petro', { n: 'Petro-Canada', fmt: 'gas', a: 3.2, canopy: ['#e01f2d', '#ffffff', '#e01f2d'], price: '#e01f2d',
  draw: (g, W, H) => { bg(g, W, H, '#e01f2d'); leaf(g, H * 0.5, H * 0.5, H * 0.36, '#ffffff');
    txt(g, 'PETRO-CANADA', H + (W - H) / 2, H * 0.54, H * 0.34, '#ffffff', { w: 900, max: W - H * 1.1 }); } });
brand('shell', { n: 'Shell', fmt: 'gas', a: 1.15, canopy: ['#ffd500', '#dd1d21', '#ffd500'], price: '#dd1d21',
  draw: (g, W, H) => { bg(g, W, H, '#ffffff');
    g.fillStyle = '#ffd500'; g.strokeStyle = '#dd1d21'; g.lineWidth = H * 0.06;
    g.beginPath(); g.moveTo(W * 0.14, H * 0.66); g.arc(W / 2, H * 0.6, W * 0.38, Math.PI * 1.08, Math.PI * 1.92); g.lineTo(W * 0.86, H * 0.66); g.lineTo(W * 0.62, H * 0.66); g.lineTo(W * 0.58, H * 0.88); g.lineTo(W * 0.42, H * 0.88); g.lineTo(W * 0.38, H * 0.66); g.closePath(); g.fill(); g.stroke();
    g.lineWidth = H * 0.025; for (let i = -3; i <= 3; i++) { g.beginPath(); g.moveTo(W / 2, H * 0.7); g.lineTo(W / 2 + Math.sin(i * 0.33) * W * 0.34, H * 0.6 - Math.cos(i * 0.33) * W * 0.34); g.stroke(); } } });
brand('pioneer', { n: 'Pioneer', fmt: 'gas', a: 3, canopy: ['#e2231a', '#ffcc00', '#e2231a'], price: '#e2231a',
  draw: (g, W, H) => { bg(g, W, H, '#e2231a'); txt(g, 'Pioneer', W / 2, H * 0.52, H * 0.62, '#ffcc00', { w: 900, italic: true, max: W * 0.9 }); } });
brand('ultramar', { n: 'Ultramar', fmt: 'gas', a: 3.2, canopy: ['#ffffff', '#00843d', '#e2231a'], price: '#00843d',
  draw: (g, W, H) => { bg(g, W, H, '#ffffff'); txt(g, 'ULTRAMAR', W / 2, H * 0.5, H * 0.5, '#00843d', { w: 900, max: W * 0.92 }); g.fillStyle = '#e2231a'; g.fillRect(W * 0.1, H * 0.8, W * 0.8, H * 0.08); } });
brand('ctgas', { n: 'Canadian Tire Gas+', fmt: 'gas', a: 2.4, canopy: ['#ffffff', '#d0121b', '#d0121b'], price: '#d0121b',
  draw: (g, W, H) => { bg(g, W, H, '#ffffff'); g.fillStyle = '#d0121b'; g.beginPath(); g.moveTo(H * 0.08, H * 0.1); g.lineTo(H * 0.92, H * 0.1); g.lineTo(H * 0.5, H * 0.94); g.closePath(); g.fill();
    leaf(g, H * 0.5, H * 0.38, H * 0.2, '#00843d'); txt(g, 'GAS+', H + (W - H) / 2, H * 0.54, H * 0.56, '#d0121b', { w: 900, max: W - H * 1.1 }); } });
brand('costcogas', { n: 'Costco Gasoline', fmt: 'gas', a: 2.6, canopy: ['#ffffff', '#e31837', '#005daa'], price: '#005daa',
  draw: (g, W, H) => { bg(g, W, H, '#ffffff'); txt(g, 'COSTCO', W / 2, H * 0.38, H * 0.6, '#e31837', { w: 900, italic: true, max: W * 0.92 });
    g.fillStyle = '#005daa'; g.fillRect(W * 0.04, H * 0.7, W * 0.92, H * 0.24); txt(g, 'GASOLINE', W / 2, H * 0.825, H * 0.2, '#ffffff', { w: 800 }); } });
brand('mobil', { n: 'Mobil', fmt: 'gas', a: 2.6, canopy: ['#ffffff', '#0b3e8a', '#e2231a'], price: '#0b3e8a',
  draw: (g, W, H) => { bg(g, W, H, '#ffffff'); txt(g, 'Mobil', W / 2, H * 0.54, H * 0.66, '#0b3e8a', { w: 800, max: W * 0.9 });
    g.fillStyle = '#e2231a'; g.beginPath(); g.arc(W * 0.43, H * 0.6, H * 0.12, 0, 7); g.fill(); } });
brand('husky', { n: 'Husky', fmt: 'gas', a: 2.6, canopy: ['#ffffff', '#e2231a', '#0b3e8a'], price: '#e2231a',
  draw: (g, W, H) => { bg(g, W, H, '#e2231a'); txt(g, 'HUSKY', W / 2, H * 0.54, H * 0.6, '#ffffff', { w: 900, max: W * 0.9 }); } });
brand('circlek', { n: 'Circle K', fmt: 'gas', a: 1, canopy: ['#ffffff', '#ee2e24', '#f68a1e'], price: '#ee2e24',
  draw: (g, W, H) => { bg(g, W, H, '#ffffff'); g.fillStyle = '#ee2e24'; g.beginPath(); g.arc(W / 2, H / 2, W * 0.44, 0, 7); g.fill();
    g.fillStyle = '#f68a1e'; g.beginPath(); g.arc(W / 2, H / 2, W * 0.44, -0.3, 1.2); g.lineTo(W / 2, H / 2); g.fill();
    txt(g, 'K', W / 2, H * 0.53, H * 0.6, '#ffffff', { w: 900 }); } });

// --- one atlas for every logo ---------------------------------------------------------

const WHITE = 64;                 // rows of white at the bottom: what untextured surfaces sample
const LOGO_LIT = [1.18, 1.18, 1.18];   // logos are lit like the walls they hang on; a touch over white

class BrandAtlas {
  constructor() {
    this.W = 2048;
    this.c = document.createElement('canvas');
    // 2304 rows: the logos, price signs and kwhome.js's cells use ~1660 (the lettering is
    // TextAtlas's now); finish() crops to what is used
    this.c.width = this.W; this.c.height = 2304;
    this.g = this.c.getContext('2d');
    this.y = 0; this.row = 0; this.full = 0;
    this.shelves = [];
    this.cells = new Map();
    this.builders = [];
  }
  /**
   * A cell of w x h pixels drawn by draw(g, W, H): its pixel rect, cached by
   * key. Shelf packing: a cell goes on a shelf of its own height (logos,
   * price signs and lettering are a few heights), a new shelf opens below.
   */
  cell(key, w, h, draw) {
    let c = this.cells.get(key);
    if (c) return c;
    w = Math.round(w); h = Math.round(h);
    let sh = this.shelves.find((q) => q.h === h && q.x + w <= this.W);
    if (!sh) {
      if (this.y + h > this.c.height - WHITE) { this.full++; return null; }
      sh = { y: this.y, h, x: 0 };
      this.shelves.push(sh);
      this.y += h + 2;
    }
    c = { x: sh.x, y: sh.y, w, h, a: w / h };
    sh.x += w + 2;
    const g = this.g;
    g.save(); g.translate(c.x, c.y); g.beginPath(); g.rect(0, 0, w, h); g.clip();
    draw(g, w, h);
    g.restore();
    this.cells.set(key, c);
    return c;
  }
  logo(k) {
    const br = B[k];
    if (!br) return null;
    const h = br.px || (br.a < 1.8 ? 136 : 96);
    return this.cell('logo:' + k, Math.min(640, h * br.a), h, br.draw);
  }
  /** A gas price sign: the logo over three grades of LED prices. */
  price(k) {
    const br = B[k];
    return this.cell('price:' + k, 136, 240, (g, W, H) => {
      bg(g, W, H, '#f2f2f2');
      const lh = Math.min(H * 0.34, (W * 0.9) / br.a);
      const lw = lh * br.a;
      const sub = document.createElement('canvas');
      sub.width = Math.round(lw); sub.height = Math.round(lh);
      br.draw(sub.getContext('2d'), sub.width, sub.height);
      g.drawImage(sub, (W - lw) / 2, H * 0.04);
      const base = H * 0.04 + lh + H * 0.04;
      const grades = [['REGULAR', 1.39], ['MID', 1.54], ['PREMIUM', 1.69]];
      const seed = k.length * 3;
      grades.forEach(([n, p], i) => {
        const y = base + i * ((H - base - H * 0.03) / 3);
        const hh = (H - base - H * 0.03) / 3 - 4;
        g.fillStyle = '#111111'; g.fillRect(W * 0.05, y, W * 0.9, hh);
        txt(g, n, W * 0.09, y + hh * 0.5, hh * 0.24, '#ffffff', { w: 700, align: 'left' });
        txt(g, (p + (seed % 5) * 0.01).toFixed(1) + '9', W * 0.92, y + hh * 0.52, hh * 0.62, '#ff3b2f', { w: 800, align: 'right', font: 'Menlo, Courier, monospace' });
      });
    });
  }
  /** A line of white lettering on a dark panel (plaza tenants with no logo here). */
  text(s, fg = '#ffffff', bgc = '#2a2c30', w = 150, h = 28) {
    return this.cell(`t:${s}|${fg}|${bgc}|${w}`, w, h, (g, W, H) => {
      bg(g, W, H, bgc);
      txt(g, s, W / 2, H * 0.54, H * 0.56, fg, { w: 700, max: W * 0.92 });
    });
  }
  /** A quad showing cell c, centred at (x, y, z), facing (nx, nz), w x h metres, into B. */
  quad(Bd, c, x, y, z, nx, nz, w, h) {
    if (!c) return;
    const rx = nz, rz = -nx;     // the viewer's right
    const hw = w / 2, hh = h / 2;
    const u0 = (c.x + 0.5) / this.W, u1 = (c.x + c.w - 0.5) / this.W;
    const vT = -(c.y + 0.5), vB = -(c.y + c.h - 0.5);   // pixels, made v at finish()
    Bd.quad([x - rx * hw, y - hh, z - rz * hw], [x + rx * hw, y - hh, z + rz * hw], [x + rx * hw, y + hh, z + rz * hw], [x - rx * hw, y + hh, z - rz * hw],
      [nx, 0, nz], [u0, vB, u1, vB, u1, vT, u0, vT], LOGO_LIT);
    if (!this.builders.includes(Bd)) this.builders.push(Bd);
  }
  /**
   * Crop the canvas to what was used, turn the pixel v's into texture v's, and
   * hand the texture to kw.js's footprint material: every vertex-coloured
   * surface there has uv (0, 0), the WHITE block kept at the canvas's bottom
   * left (a constant uv has no derivative, so it always samples mip 0), so
   * buildings and logos are one material and one draw a cluster. T: the
   * lettering (TextAtlas), finished here and patched into the same material.
   */
  finish(TA) {
    const used = Math.min(this.c.height, Math.ceil((this.y + this.row + 2 + WHITE) / 64) * 64);
    if (used < this.c.height) {
      const c2 = document.createElement('canvas');
      c2.width = this.W; c2.height = used;
      c2.getContext('2d').drawImage(this.c, 0, 0);
      this.c = c2;
    }
    const H = this.c.height;
    const g = this.c.getContext('2d');
    g.fillStyle = '#ffffff'; g.fillRect(0, H - WHITE, this.W, WHITE);
    const Ht = TA ? TA.finish() : 1;
    // a vertex's u says which atlas it reads: under 1 this one (v from the canvas's
    // bottom: flipY), 2 and up the lettering's (v from its top row: a DataTexture)
    for (const Bd of this.builders) for (let i = 1; i < Bd.uv.length; i += 2) Bd.uv[i] = Bd.uv[i - 1] >= 1.5 ? -Bd.uv[i] / Ht : 1 + Bd.uv[i] / H;
    this.tex = new THREE.CanvasTexture(this.c);
    this.tex.colorSpace = THREE.SRGBColorSpace;
    this.tex.anisotropy = 8;
    const m = polyMat();
    m.map = this.tex;
    if (TA && TA.tex) TA.patch(m);
    m.needsUpdate = true;
    return m;
  }
  /** GPU bytes of this atlas (RGBA, mipmapped). */
  get bytes() { return Math.round(this.W * this.c.height * 4 * 4 / 3); }
}

// --- the lettering: one-channel, in its own texture, read by the same material ---------
//
// Every plaza tenant, every storefront outside the plazas, every pylon's
// lettered row and every plaza's name is a NAME in one colour on a panel
// of another: what the atlas needs to hold is only the letters' shape. So
// the lettering is a MASK, white letters on black in one byte a pixel (an
// R8 texture: a quarter of the logo atlas's RGBA a pixel), each name drawn
// once whatever its colours, measured to its own width. A lettered quad
// carries the panel's colour as its vertex colour and the letters' as an
// index into a 16-colour uniform, in its u: u = 2 (index + 1) + the cell's
// u. polyMat's map_fragment is patched to tell the two atlases apart by u
// (under 1: the logos; 2 and up: the lettering) and to mix the panel and
// letter colours by the mask, so the lettering stays in kw.js's footprint
// material and adds no draw. All ~1950 names map-wide fit in 2048 x ~2.3k
// bytes (~6 MB with mips), where 330 of them did not fit in the RGBA atlas.

class TextAtlas {
  constructor() {
    this.W = 2048; this.Hmax = 4096;
    this.y = 0; this.full = 0;
    this.shelves = [];
    this.cells = new Map();
    this.fg = [];             // the letters' colours (hex), the uniform's order
    this.m = document.createElement('canvas').getContext('2d');
  }
  /** The cell of name s lettered h px tall (bold sans, 0.6 h), cached by s and h: a pixel rect, or null when full. */
  cell(s, h = 22, maxW = 420) {
    const key = h + '|' + s;
    let c = this.cells.get(key);
    if (c !== undefined) return c;
    this.m.font = `700 ${Math.round(h * 0.6)}px ${SANS}`;
    const w = Math.min(maxW, Math.max(h * 1.6, Math.ceil(this.m.measureText(s).width + h * 0.7)));
    let sh = this.shelves.find((q) => q.h === h && q.x + w <= this.W);
    if (!sh) {
      if (this.y + h > this.Hmax) { this.full++; this.cells.set(key, null); return null; }
      sh = { y: this.y, h, x: 0 };
      this.shelves.push(sh);
      this.y += h + 2;
    }
    c = { x: sh.x, y: sh.y, w, h, a: w / h, s };
    sh.x += w + 2;
    this.cells.set(key, c);
    return c;
  }
  fgIndex(hex) {
    let i = this.fg.indexOf(hex);
    if (i >= 0) return i;
    if (this.fg.length < 16) { this.fg.push(hex); return this.fg.length - 1; }
    // full: the nearest
    const a = lin(hex);
    let bi = 0, bd = Infinity;
    this.fg.forEach((h2, j) => { const b = lin(h2); const d = (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2; if (d < bd) { bd = d; bi = j; } });
    return bi;
  }
  /** A quad showing cell c, letters fg on panel bgc, centred at (x, y, z) facing (nx, nz), w x h metres, into Bd (registered with atlas A). */
  quad(A, Bd, c, fg, bgc, x, y, z, nx, nz, w, h) {
    if (!c) return;
    const rx = nz, rz = -nx, hw = w / 2, hh = h / 2;
    const k = 2 * (this.fgIndex(fg) + 1);
    const u0 = k + (c.x + 0.5) / this.W, u1 = k + (c.x + c.w - 0.5) / this.W;
    const vT = -(c.y + 0.5), vB = -(c.y + c.h - 0.5);   // pixels from the top, made v at finish()
    const col = lin(bgc);
    Bd.quad([x - rx * hw, y - hh, z - rz * hw], [x + rx * hw, y - hh, z + rz * hw], [x + rx * hw, y + hh, z + rz * hw], [x - rx * hw, y + hh, z - rz * hw],
      [nx, 0, nz], [u0, vB, u1, vB, u1, vT, u0, vT], [col[0] * LOGO_LIT[0], col[1] * LOGO_LIT[1], col[2] * LOGO_LIT[2]]);
    if (!A.builders.includes(Bd)) A.builders.push(Bd);
  }
  /** Letter every cell into a canvas of the height used, keep its red channel: the R8 texture. Returns its height. */
  finish() {
    if (!this.cells.size) return 1;
    const H = Math.max(4, Math.ceil(this.y / 4) * 4);
    const cv = document.createElement('canvas');
    cv.width = this.W; cv.height = H;
    const g = cv.getContext('2d', { willReadFrequently: true });
    g.fillStyle = '#000000'; g.fillRect(0, 0, this.W, H);
    g.fillStyle = '#ffffff'; g.textAlign = 'center'; g.textBaseline = 'middle';
    for (const c of this.cells.values()) {
      if (!c) continue;
      g.font = `700 ${Math.round(c.h * 0.6)}px ${SANS}`;
      g.fillText(c.s, c.x + c.w / 2, c.y + c.h * 0.54, c.w - c.h * 0.4);
    }
    const px = g.getImageData(0, 0, this.W, H).data;
    const r = new Uint8Array(this.W * H);
    for (let i = 0, j = 0; i < r.length; i++, j += 4) r[i] = px[j];
    this.tex = new THREE.DataTexture(r, this.W, H, THREE.RedFormat, THREE.UnsignedByteType);
    this.tex.minFilter = THREE.LinearMipmapLinearFilter;
    this.tex.magFilter = THREE.LinearFilter;
    this.tex.generateMipmaps = true;
    this.tex.anisotropy = 8;
    this.tex.needsUpdate = true;
    this.H = H;
    return H;
  }
  get bytes() { return this.tex ? Math.round(this.W * this.H * 4 / 3) : 0; }
  /** polyMat reads the lettering too: its map chunk picks the atlas by u, its colour chunk moves into it. */
  patch(m) {
    const fg = new Float32Array(48);
    this.fg.forEach((h, i) => { const c = lin(h); for (let j = 0; j < 3; j++) fg[i * 3 + j] = c[j] * LOGO_LIT[j]; });
    const tex = this.tex;
    m.onBeforeCompile = (sh) => {
      sh.uniforms.kwText = { value: tex };
      sh.uniforms.kwFg = { value: fg };
      sh.fragmentShader = 'uniform sampler2D kwText;\nuniform vec3 kwFg[16];\n' + sh.fragmentShader
        .replace('#include <map_fragment>', `#ifdef USE_MAP
  float kwK = floor(vMapUv.x * 0.5);
  vec4 sampledDiffuseColor = texture2D(map, vMapUv);
  float kwM = texture2D(kwText, vec2(vMapUv.x - 2.0 * kwK, vMapUv.y)).r;
  if (kwK > 0.5) diffuseColor.rgb *= mix(vColor, kwFg[int(kwK) - 1], kwM);
  else diffuseColor *= sampledDiffuseColor * vec4(vColor, 1.0);
#else
  diffuseColor.rgb *= vColor;
#endif`)
        .replace('#include <color_fragment>', '');
    };
    m.customProgramCacheKey = () => 'kwtext';
  }
}

// --- the buildings' own architecture ----------------------------------------------------
//
// A big box, a supermarket, a stand-alone LCBO or Beer Store and every strip
// plaza building in a named plaza is drawn HERE, not by world.js: its box gets
// kw.skip (world.js draws nothing, the box keeps its height, so collision and
// roofs stay the city's) and kw.shop says which format. Formats, from aerial
// imagery (Esri World Imagery, tools/kw/aerial.py) and storefront photos:
//
//   big box   split-face block base, the brand's cladding, brick or block
//             piers every ~9 m, an accent band under a stepped parapet, the
//             raised entrance portal, glass vestibules, a fenced garden centre
//             with its half canopy at one end (Walmart, Canadian Tire, Home
//             Depot, RONA, Superstore), service bays on the other (Canadian
//             Tire, Costco), loading docks at the back, a white or light grey
//             roof with rows of rooftop units, cart corrals in the lot
//   plaza     a sidewalk arcade along the storefronts (brick piers under the
//             sign fascia, which stays where kw.js hangs the signs: 1.8 m
//             out, 3.2-4.45 m up), raised parapet towers at the ends and every
//             ~28 m, split-face base, EIFS above, service doors at the back
//   unit      a stand-alone LCBO / Beer Store: the brand's walls and band

const ARCH = {
  walmart: { wall: '#d3cdc1', base: '#857e73', pier: '#bdb5a6', cap: '#8f979f', roof: '#e9e9e5', garden: '#2b2d2f', vest: 2, corral: '#0071ce', tall: 4 },
  ct: { wall: '#e3e1dc', base: '#8d8880', pier: '#cfccc5', band: '#d0121b', cap: '#6e7276', roof: '#c9cbcc', garden: '#2b2d2f', bays: 6, vest: 2, corral: '#d0121b' },
  homedepot: { wall: '#cbc4b6', base: '#958d80', pier: '#b4ac9e', band: '#f96302', cap: '#f96302', roof: '#70747a', garden: '#3a3a3a', vest: 2, corral: '#f96302', canopy: '#f96302' },
  rona: { wall: '#dcd8cf', base: '#8c877e', pier: '#c4beb3', band: '#003da5', cap: '#003da5', roof: '#d4d5d4', garden: '#2b2d2f', vest: 1, corral: '#003da5' },
  costco: { wall: '#b9bbbd', base: '#8a8c8e', cap: '#7d8082', roof: '#dcdcd8', stripes: true, bays: 4, vest: 1, corral: '#e31837' },
  bestbuy: { wall: '#c0c4c8', base: '#7f8388', pier: '#aeb3b8', cap: '#0046be', roof: '#d4d5d4', vest: 1 },
  zehrs: { wall: '#dccfb8', base: '#7a5a48', pier: '#9a4a3a', band: '#ee3124', cap: '#7a3328', roof: '#cfd0cf', vest: 1, glass: true, corral: '#ee3124' },
  sobeys: { wall: '#d6d1c3', base: '#6b5d4c', pier: '#8c6a4f', band: '#0e5a19', cap: '#0e5a19', roof: '#cfd0cf', vest: 1, glass: true, corral: '#0e5a19' },
  foodbasics: { wall: '#ddd5c3', base: '#7d7363', pier: '#a89a83', band: '#ffcd00', cap: '#00843d', roof: '#cfd0cf', vest: 1, glass: true, corral: '#ffcd00' },
  nofrills: { wall: '#e4e0d5', base: '#6f6b64', pier: '#bdb7aa', band: '#ffe600', cap: '#2a2a2a', roof: '#cfd0cf', vest: 1, glass: true, corral: '#ffe600' },
  independent: { wall: '#e0dbd0', base: '#6f6a62', pier: '#a8452f', band: '#d7282f', cap: '#3a3a3a', roof: '#cfd0cf', vest: 1, glass: true, corral: '#d7282f' },
  farmboy: { wall: '#e6dfcd', base: '#6b5d4c', pier: '#8c3a2a', band: '#2e7d32', cap: '#c8102e', roof: '#cfd0cf', vest: 1, glass: true, corral: '#c8102e' },
  longos: { wall: '#ddd6c4', base: '#5f5a50', pier: '#7a6a55', band: '#1f6b35', cap: '#1f6b35', roof: '#cfd0cf', vest: 1, glass: true, corral: '#1f6b35' },
  tnt: { wall: '#e4e1da', base: '#6d6b67', pier: '#b9b4aa', band: '#e60012', cap: '#e60012', roof: '#d0d1d0', vest: 1, glass: true, corral: '#e60012' },
  superstore: { wall: '#dedad2', base: '#7c7871', pier: '#b9b2a5', band: '#e31837', cap: '#e31837', roof: '#d6d6d3', vest: 2, glass: true, corral: '#e31837', garden: '#2b2d2f' },
  lcbo: { wall: '#a77b62', base: '#5a5550', pier: '#7d5a48', band: '#2b2b2b', cap: '#007a3d', roof: '#bdbebe', glass: true },
  beer: { wall: '#e8e4da', base: '#7a7770', pier: '#cfcabe', band: '#00438c', cap: '#ffc72c', roof: '#cfd0cf', glass: true },
};
// strip plazas: [wall (EIFS), base (split-face), pier (brick), fascia, cap, roof]
const PLAZA_PAL = [
  ['#d9cfbd', '#7c7265', '#8e4b3a', '#ece7dc', '#5b3a2e', '#c4c5c4'],
  ['#cfc6b2', '#6f6a62', '#a0705a', '#e6e0d2', '#3a3f45', '#b9bab9'],
  ['#e2dccf', '#86807a', '#7d7468', '#f1ede4', '#4a5560', '#cfd0cf'],
  ['#d6c7ae', '#7a6a58', '#9b5a43', '#efe6d4', '#6b2e24', '#bfc0bf'],
  ['#c9c4bb', '#5f5d59', '#5e6670', '#e9e9e6', '#2e3a46', '#c8c9c8'],
];
const BIGFMT = new Set(['big', 'groc']);

function inPoly(p, x, z) {
  let c = false;
  for (let i = 0, j = p.length - 1; i < p.length; j = i++) {
    if ((p[i][1] > z) !== (p[j][1] > z) && x < ((p[j][0] - p[i][0]) * (z - p[i][1])) / (p[j][1] - p[i][1]) + p[i][0]) c = !c;
  }
  return c;
}

/** Before the city is meshed: canopies go flat; the buildings drawn here get kw.skip and their format. */
export function prepShops(city) {
  if (!S) return { canopies: 0, bigbox: 0, units: 0, strips: 0 };
  const r = { canopies: 0, bigbox: 0, units: 0, strips: 0 };
  const free = (b) => b && !(b.kw && (b.kw.skip || b.kw.poly || b.kw.fam || b.kw.shop));
  for (const s of S.stores) {
    const br = B[s[0]];
    if (!br || s[3] === null) continue;
    if (br.fmt === 'gas') {
      const b = boxAt(city, s[3], s[4], 2);
      if (!free(b) || b.h > 7 || b.w * b.d > 1600) continue;
      b.kw = Object.assign(b.kw || {}, { skip: true, canopy: true });
      b.h = 0;
      r.canopies++;
      continue;
    }
    const A = ARCH[s[0]];
    if (!A) continue;
    const b = boxAt(city, s[3], s[4], 3);
    if (!free(b) || b.h < 3 || b.h > 16 || b.w < 12 || b.d < 12) continue;
    const area = b.w * b.d;
    if (BIGFMT.has(br.fmt) && area > 2200 && area < 26000) {
      b.kw = Object.assign(b.kw || {}, { skip: true, shop: { fmt: 'bigbox', k: s[0], x: s[1], z: s[2] } });
      // OSM gives an untagged store 6 m; a big box stands 9-10 m to its parapet, a supermarket ~8
      b.h = Math.max(b.h, br.fmt === 'big' ? 9.2 : 7.8);
      r.bigbox++;
    } else if (br.fmt === 'lcbo' && area > 250 && area <= 2200 && !(b.kw && b.kw.strip)) {
      b.kw = Object.assign(b.kw || {}, { skip: true, shop: { fmt: 'unit', k: s[0], x: s[1], z: s[2] } });
      r.units++;
    }
  }
  // every strip building in a named plaza -- and every other plain store box
  // in one: world.js would draw a 9 m one as a three-storey brick office or
  // flats (Williamsburg, Westmount Place, Victoria Street Plaza, Eastwood
  // Square), where it is a one-storey plaza whose storefront faces its lot
  r.plain = 0;
  (S.plazas || []).forEach((P, pi) => {
    let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    for (const q of P.o) { x0 = Math.min(x0, q[0]); x1 = Math.max(x1, q[0]); z0 = Math.min(z0, q[1]); z1 = Math.max(z1, q[1]); }
    const rad = Math.hypot(x1 - x0, z1 - z0) / 2 + 20;
    const town = /^Downtown|Village|Station/.test(P.n);    // a main street's old blocks are not a plaza
    for (const b of city.buildingsNear((x0 + x1) / 2, (z0 + z1) / 2, rad)) {
      if (!free(b) || !inPoly(P.o, b.x, b.z)) continue;
      if (!(b.kw && b.kw.strip)) {
        if (town || b.h < 3 || b.h > 12.5 || !PLAIN_STYLES.has(b.style) || b.w < 9 || b.d < 9 || b.w * b.d < 220 || b.w * b.d > 16000) continue;
        if (!b.kw) b.kw = {};
        b.kw.strip = { face: lotFront(city, b, frameOf(b)) };
        // one storey and its parapet, as the plazas round it (OSM's 2-level default is the office)
        if (b.h > 7.5 && b.w * b.d < 6000) b.h = 7.2;
        r.plain++;
      }
      b.kw.skip = true;
      b.kw.shop = { fmt: 'strip', plaza: pi };
      r.strips++;
    }
  });
  // every other building with a store in it (S.fronts, build_shops.py
  // storefronts): Hespeler Rd's strip, the fast-food pads, the banks, the
  // dealers, the lube bays, the gas stations' kiosks. world.js would draw a 9 m
  // one as a three-storey office; it is a one-storey store facing its lot.
  // Only inside what the footprint clusters already draw: a front is merged
  // into its 1200 m cluster (kw.js buildPolys' and this file's `kwp` keys),
  // which three culls by its bounding sphere, so a front where the cluster
  // has nothing yet would add a draw, and one far out on its edge would swell
  // the sphere into views that never saw it. Those stay world.js's boxes.
  const ckey = (x, z) => Math.round(x / 1200) * 1000 + Math.round(z / 1200);
  const ext = new Map();
  const grow = (x, z, r) => {
    const k = ckey(x, z);
    let e = ext.get(k);
    if (!e) ext.set(k, (e = [Infinity, -Infinity, Infinity, -Infinity]));
    e[0] = Math.min(e[0], x - r); e[1] = Math.max(e[1], x + r); e[2] = Math.min(e[2], z - r); e[3] = Math.max(e[3], z + r);
  };
  // (kw.js's outlines, the boxes marked here, the gas canopies, and the chain stores'
  // buildings -- their signs; a store with no building of its own can fail to draw)
  for (const b of city.buildings) if (b.kw && ((b.kw.poly && !b.kw.skip) || b.kw.ext || b.kw.shop || b.kw.canopy)) grow(b.x, b.z, Math.max(b.w, b.d) / 2);
  for (const s of S.stores) if (s[3] !== null) grow(s[3], s[4], 10);
  r.fronts = 0; r.frontsOut = 0; r.frontsNext = 0;
  const outBy = (e, x, z) => (e ? Math.max(e[0] - x, x - e[1], e[2] - z, z - e[3]) : Infinity);
  (S.fronts || []).forEach((F, fi) => {
    const [bx, bz, kind] = F;
    const b = boxAt(city, bx, bz, 1);
    // a store in a farm building (farmstead.js draws it: a market in a bank barn, a meat shop
    // in a farmhouse) keeps its building and gets its sign (b.kw.sign)
    const farm = !!b && FARM_SIGN.has(b.style) && !b.kind;
    if (!free(b) || b.h < 2.5 || b.h > (farm ? 20 : 12.5) || b.w < 5 || b.d < 5) return;
    // (a dealer, a big lot on an auto row, a little further)
    const M = kind === 'c' ? 120 : 60;
    let ck = null, rk = null;
    if (outBy(ext.get(ckey(b.x, b.z)), b.x, b.z) > M) {
      // past its own cell's cluster: merged into the nearest cell's (its own or a NEIGHBOUR's) when that one's
      // drawn extent is within NEXT_M of it (a store just over a 1200 m line, on a row the
      // next cluster already draws: Hespeler Rd's Tirecraft, Ontario Auto Market, Fix Auto)
      // (or its own cell's, a little further out than M)
      const kx = Math.round(b.x / 1200), kz = Math.round(b.z / 1200);
      let bd = NEXT_M, near = false;
      for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) {
        const d = outBy(ext.get((kx + i) * 1000 + (kz + j)), b.x, b.z);
        if (d < bd) { bd = d; near = true; ck = i || j ? [(kx + i) * 1200, (kz + j) * 1200] : null; }
      }
      // no cluster near: its own range-culled one ('kwr:', landmarks.js KWR_RANGE), where the
      // country's stores (Breslau, Conestogo, the farm markets, the auto rows past the
      // plazas) are drawn as the rest; past the range the world's mid / far massing draws its
      // box (`kw.mass`), as it draws every other building there
      if (!near) { r.frontsOut++; rk = 'kwr:' + Math.round(b.x / KWR_CELL) + ',' + Math.round(b.z / KWR_CELL); }
      else r.frontsNear = (r.frontsNear || 0) + 1;
    }
    const A = b.w * b.d;
    if (A < 40 || A > 16000) return;
    // a store in a house (a salon in a bungalow) stays a house; a pad or a kiosk the data says is one does not
    if (!farm && !(PLAIN_STYLES.has(b.style) || (b.style === 'house' && kind !== 's'))) return;
    const fr = frameOf(b);
    // its storefront: the face toward the street it is addressed on (F[5]), with the most car park, not backing on a road
    let face = 0, best = -Infinity;
    for (let f = 0; f < 4; f++) {
      const N = fr.N(f), q = fr.P(f, 0, 0, 6);
      const s = lotShare(city, fr, f) + (F[5] ? 0.6 * Math.max(0, N[0] * F[5][0] + N[2] * F[5][1]) : 0)
        + (city.onRoad(q[0], q[2], 4, false) ? -0.5 : 0) + fr.F[f].len * 0.002;
      if (s > best) { best = s; face = f; }
    }
    // (a garage, a dealer, a restaurant or a gas kiosk the importer called a barn -- a big
    // untagged box out of town -- is drawn as one, below)
    if (farm && (kind === 's' || isMarket(F))) {
      if (!b.kw) b.kw = {};
      b.kw.sign = { face, front: fi, rk };
      r.farmSigns = (r.farmSigns || 0) + 1;
      return;
    }
    // two storeys with no lot in front is a main street's shop with flats over it: left as it is
    if (b.h > 7.5 && kind === 's' && lotShare(city, fr, face) < 0.2) return;
    if (!b.kw) b.kw = {};
    b.kw.strip = { face };
    b.kw.skip = true;
    b.kw.shop = { fmt: 'strip', plaza: -1, front: fi, kind };
    if (ck) { b.kw.shop.ck = ck; r.frontsNext++; }
    if (rk) { b.kw.shop.rk = rk; b.kw.mass = true; r.frontsRural = (r.frontsRural || 0) + 1; }
    // a farm market, a nursery, a meat or cheese shop in the country: a board-and-batten
    // store under a steel gable (farmMarket in buildShops)
    if (rk && (kind === 's' || kind === 'f') && A < 2600 && Math.min(b.w, b.d) < 30 && isMarket(F)) { b.kw.shop.market = true; r.markets = (r.markets || 0) + 1; }
    // one storey and its parapet: a pad 5-6 m, a kiosk under its canopy's height, a showroom's double height
    const H = { s: 7.2, f: 5.8, b: 6.4, a: 6.2, k: 4.9, c: 7.6 }[kind] || 7.2;
    if (b.kw.shop.market) b.h = 4.6;   // the eaves: the gable stands over them
    else if (kind === 's') { if (b.h > 7.5 && A < 6000) b.h = 7.2; b.h = Math.max(b.h, 5.0); } else b.h = H;
    r.fronts++;
  });
  return r;
}
/** The share of the ground in front of face fi (7 x 8 m deep, 7 across) that is car park. */
// how far past a cell's drawn extent (its own, or the next one's) a front past M may be, to be merged into it
const NEXT_M = 150;
// the stores past every cluster: their own clusters, KWR_CELL m cells (landmarks.js range-culls 'kwr:')
const KWR_CELL = 1200;
const FARM_SIGN = new Set(['barn', 'shed', 'farmhouse']);
// a country store sold off the farm: by its OSM name
const MARKET_RE = /farm|market|nursery|garden|greenhouse|bloom|orchard|produce|meats?\b|dairy|cheese|peanut|bake|bakery|maple|pantry|barn|harvest|feed|seed|country|bulk|antique|quilt|smokehouse|sugar|honey|berr/i;
const NOT_MARKET = /hasty|food market|super ?market|mini[- ]?mart|country style|marketplace|variety|convenience|pizza|auto|tire|storage|cannabis|vape/i;
function isMarket(F) {
  if (F[4] && B[F[4]]) return false;   // a chain
  const names = [F[4], ...(F[3] || []).map((q) => q[0])].filter(Boolean);
  if (names.some((n) => NOT_MARKET.test(n))) return false;
  return names.some((n) => MARKET_RE.test(n));
}
function lotShare(city, fr, fi) {
  const L = fr.F[fi].len;
  let park = 0, n = 0;
  for (let k = 1; k <= 7; k++) for (let j = -3; j <= 3; j++) {
    const p = fr.P(fi, (j / 3.5) * L / 2, 0, k * 8);
    n++;
    if (G.lotAt(p[0], p[2]) >= 0 && !city.onRoad(p[0], p[2], 0, false)) park++;
  }
  return park / n;
}
const PLAIN_STYLES = new Set(['brick', 'lowrise', 'industrial']);

// --- the storefronts' colours -------------------------------------------------------------
// The chains with no logo here lettered in their own colours, [panel, letters]
// (the colour they read as from the road); everything else from SIGN_PAL by name.
const CHAIN_COL = [
  [/^Chick-fil-A/i, '#ffffff', '#dd0031'], [/^Taco Bell/i, '#702082', '#ffffff'], [/^Pizza Hut/i, '#ee3124', '#ffffff'],
  [/^Mary Brown/i, '#c8102e', '#ffffff'], [/^Domino/i, '#006491', '#ffffff'], [/^Little Caesars/i, '#ff6600', '#ffffff'],
  [/^Papa John/i, '#ffffff', '#c8102e'], [/^Mr\.? Sub/i, '#ffffff', '#d2232a'], [/^Quiznos/i, '#1d1d1b', '#e31837'],
  [/^BarBurrito/i, '#111111', '#ffd200'], [/^Pita Pit/i, '#00543c', '#ffffff'], [/^Freshii/i, '#7ac143', '#ffffff'],
  [/^Booster Juice/i, '#ffffff', '#e31837'], [/^Osmow/i, '#111111', '#ffffff'], [/^Baskin/i, '#ffffff', '#c8102e'],
  [/^Country Style/i, '#c8102e', '#ffffff'], [/^Circle K/i, '#ee2e24', '#ffffff'], [/UPS Store/i, '#351c15', '#ffb500'],
  [/^M&M/i, '#c8102e', '#ffffff'], [/^Sleep Country/i, '#003da5', '#ffffff'], [/^Goodyear/i, '#004b8d', '#ffdd00'],
  [/^Midas/i, '#ffd200', '#111111'], [/^Mr\.? Lube/i, '#ffffff', '#c8102e'], [/^Jiffy Lube/i, '#c8102e', '#ffffff'],
  [/^Meineke/i, '#ffd200', '#111111'], [/^Speedy/i, '#111111', '#ffd200'], [/^Kal Tire/i, '#00843d', '#ffffff'],
  [/^Tirecraft/i, '#111111', '#ffffff'], [/^PartSource/i, '#e31837', '#ffffff'], [/^NAPA/i, '#0a2240', '#ffc72c'],
  [/^Bell\b/i, '#00549a', '#ffffff'], [/^Rogers/i, '#da291c', '#ffffff'], [/^Telus/i, '#4b286d', '#ffffff'],
  [/^Freedom Mobile/i, '#111111', '#ff6600'], [/^Money Mart/i, '#00843d', '#ffffff'], [/^easy(home|financial)/i, '#00843d', '#ffffff'],
  [/^Party City/i, '#5b2c83', '#ffffff'], [/^Benjamin Moore/i, '#111111', '#ffffff'], [/^Sherwin/i, '#0067a5', '#ffffff'],
  [/^Healthy Planet/i, '#7ac143', '#ffffff'], [/^Goodness Me/i, '#00843d', '#ffffff'], [/^Canada Computers/i, '#002f6c', '#ffffff'],
  [/^Guardian/i, '#ffffff', '#0b3e8a'], [/^Global Pet/i, '#ffffff', '#00843d'], [/^Stag Shop/i, '#111111', '#c8102e'],
  [/^Wild Wing/i, '#111111', '#ffd200'], [/^Sunset Grill/i, '#0b3e8a', '#ffd200'], [/^Chuck's/i, '#3d2b1f', '#f4d58d'],
  [/^Moores/i, '#1d3557', '#ffffff'], [/^Old Navy/i, '#003764', '#ffffff'], [/^Texas Chicken/i, '#d6001c', '#ffffff'],
  [/^Pizzaville|^Pizza Nova|^Gino's|^Pizza Depot|^Pizza Hut/i, '#ffffff', '#c8102e'], [/^Lazeez/i, '#111111', '#ffd200'],
  [/^Hasty Market/i, '#c8102e', '#ffffff'], [/^Short Stop|^Little Short Stop/i, '#0b3e8a', '#ffffff'], [/^Daisy Mart/i, '#ffd200', '#0b3e8a'],
  [/^Mac's|^Couche-Tard/i, '#ee2e24', '#ffffff'], [/^Quickie/i, '#c8102e', '#ffffff'], [/^Fiddleheads/i, '#2e6b30', '#ffffff'],
  [/^Wimpy/i, '#c8102e', '#ffffff'], [/^Twice the Deal/i, '#c8102e', '#ffd200'], [/^Mucho Burrito/i, '#111111', '#ffd200'],
  [/^Fresh Burrito/i, '#00843d', '#ffffff'], [/^Burger Factory/i, '#111111', '#ffd200'], [/^Cobbs/i, '#5b2c14', '#f4d58d'],
  [/Credit Union|^Libro/i, '#00843d', '#ffffff'], [/^Desjardins/i, '#00874e', '#ffffff'], [/^Meridian/i, '#e35205', '#ffffff'],
  [/^HSBC/i, '#db0011', '#ffffff'], [/^National Bank/i, '#c8102e', '#ffffff'], [/^Tangerine/i, '#ff6200', '#ffffff'],
  [/^Fairstone/i, '#00843d', '#ffffff'], [/^Cash ?Money|^Cash 4 You/i, '#ffd200', '#111111'], [/^Lend Direct/i, '#0b3e8a', '#ffffff'],
  [/^First Choice Hair/i, '#ffffff', '#c8102e'], [/^Magicuts/i, '#111111', '#ffffff'], [/^Great Clips/i, '#0b3e8a', '#ffffff'],
  [/^Massage Addict/i, '#00a3ad', '#ffffff'], [/^Access Storage/i, '#ffd200', '#c8102e'], [/^The Beat Goes On/i, '#111111', '#ffffff'],
  [/^Microplay/i, '#0b3e8a', '#ffffff'], [/^EB Games/i, '#c8102e', '#ffffff'], [/^Value Buds|^Tokyo Smoke|cannabis/i, '#111111', '#ffffff'],
  [/^Shoppers|^Dollarama/i, '#d71920', '#ffffff'],
  // DriveTest (g2test.js addDriveTestSign): its navy wordmark on white
  [/^DriveTest/, '#ffffff', '#003a70'],
];
const SIGN_PAL = [['#1f2a36', '#ffffff'], ['#7a1f24', '#ffffff'], ['#f4efe4', '#2a2a2a'], ['#21543d', '#ffffff'],
  ['#2c3e66', '#f0d36a'], ['#111111', '#e8c46a'], ['#c84b1e', '#ffffff'], ['#e9e1cf', '#7a1f24'], ['#ffffff', '#b5121b'], ['#4a2a5a', '#ffffff']];
function nameHash(s) { let h = 7; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0; return h; }
/** [panel, letters] for a name: its chain's colours, else one of SIGN_PAL by name. */
function chainCol(name) {
  const n = name || '';
  for (const [re, p, l] of CHAIN_COL) if (re.test(n)) return [p, l];
  return SIGN_PAL[nameHash(n) % SIGN_PAL.length];
}
// a fast-food pad's walls, colour band and its trim: the chains' own
const FOOD_LOOK = {
  mcd: { wall: '#5d5f61', band: '#2b2b2b', accent: '#ffc72c' },
  tims: { wall: '#7d5236', band: '#3d2a1f', accent: '#c8102e', pier: '#b5a891', base: '#a2967f' },
  harveys: { wall: '#ece5d6', band: '#e21836', accent: '#ffd400' }, aw: { wall: '#d2b48c', band: '#f26522', accent: '#5b2c14' },
  wendys: { wall: '#6f7276', band: '#e2203d', accent: '#ffffff' }, bk: { wall: '#d9c2a2', band: '#502314', accent: '#ff8732' },
  kfc: { wall: '#f1f0ee', band: '#e4002b', accent: '#ffffff' }, dq: { wall: '#f2eee6', band: '#ee3e42', accent: '#1d5baa' },
  starbucks: { wall: '#5b4a3e', band: '#00704a', accent: '#d4c6b2' }, popeyes: { wall: '#efe7da', band: '#f15a22', accent: '#ffffff' },
  subway: { wall: '#e9e4d8', band: '#008c15', accent: '#ffc600' }, pizzapizza: { wall: '#efe9dd', band: '#ee3124', accent: '#ffffff' },
  swiss: { wall: '#d9cbb2', band: '#c8102e', accent: '#ffffff' }, bp: { wall: '#c9b9a3', band: '#1a1a1a', accent: '#e4002b' },
  montanas: { wall: '#8b6a4f', band: '#3b2314', accent: '#e0452b' }, esm: { wall: '#e8dfcf', band: '#ce2b37', accent: '#009246' },
};
const PAD_WALLS = ['#e2dccf', '#d6c7ae', '#cfc6b2', '#c9c4bb', '#b9a48a', '#8e4b3a'];
/** A pad with no look of its own: walls by name, the band and trim its lettering's colours. */
function chainLook(name) {
  const [p, l] = chainCol(name);
  const band = p === '#ffffff' || p === '#f4efe4' || p === '#e9e1cf' ? l : p;
  return { wall: PAD_WALLS[nameHash(name || '') % PAD_WALLS.length], band, accent: band === l ? '#3a3f45' : l };
}
const BANK_LOOK = {
  td: { wall: '#d8d2c4', band: '#008a00', accent: '#ffffff' }, rbc: { wall: '#d6d3cc', band: '#005daa', accent: '#ffd200' },
  cibc: { wall: '#cfc8bb', band: '#c41f3e', accent: '#8b1d2c' }, bmo: { wall: '#d8d4cb', band: '#0079c1', accent: '#e1251b' },
  scotia: { wall: '#d9d3c6', band: '#ec111a', accent: '#ffffff' },
};
// a dealer's make: [match, the make lettered, its portal, the letters]
const MAKES = [
  [/Ford|Lincoln/i, 'FORD', '#003478', '#ffffff'], [/Toyota/i, 'TOYOTA', '#e9e9e9', '#eb0a1e'], [/Lexus/i, 'LEXUS', '#1d1d1b', '#ffffff'],
  [/Honda/i, 'HONDA', '#e9e9e9', '#cc0000'], [/Acura/i, 'ACURA', '#1d1d1b', '#ffffff'], [/Kia/i, 'KIA', '#05141f', '#ffffff'],
  [/Hyundai/i, 'HYUNDAI', '#002c5f', '#ffffff'], [/Genesis/i, 'GENESIS', '#1d1d1b', '#ffffff'], [/Nissan/i, 'NISSAN', '#c3c5c8', '#c3002f'],
  [/Infiniti/i, 'INFINITI', '#1d1d1b', '#ffffff'], [/Mazda/i, 'MAZDA', '#2b2b2b', '#ffffff'], [/Volkswagen|\bVW\b/i, 'VOLKSWAGEN', '#001e50', '#ffffff'],
  [/Audi/i, 'AUDI', '#1d1d1b', '#ffffff'], [/Subaru/i, 'SUBARU', '#013c74', '#ffffff'], [/Mitsubishi/i, 'MITSUBISHI', '#e60012', '#ffffff'],
  [/Chrysler|Dodge|Jeep|\bRam\b/i, 'CHRYSLER', '#1d1d1b', '#ffffff'], [/GMC/i, 'GMC', '#c8102e', '#ffffff'],
  [/Chevrolet|Chevy/i, 'CHEVROLET', '#2b2b2b', '#d6a52d'], [/Buick/i, 'BUICK', '#2b2b2b', '#ffffff'], [/Cadillac/i, 'CADILLAC', '#1d1d1b', '#ffffff'],
  [/BMW/i, 'BMW', '#1c69d4', '#ffffff'], [/Mercedes/i, 'MERCEDES-BENZ', '#1d1d1b', '#ffffff'], [/Volvo/i, 'VOLVO', '#003057', '#ffffff'],
  [/Jaguar|Land Rover/i, 'JAGUAR', '#1d1d1b', '#ffffff'], [/Tesla/i, 'TESLA', '#e9e9e9', '#cc0000'], [/Porsche/i, 'PORSCHE', '#1d1d1b', '#ffffff'],
];
/** The make a dealer sells (OSM's brand, else its name): its lettering and colours; a used-car lot its own name. */
function makeOf(brand, name) {
  for (const [re, t, c, fg] of MAKES) if (re.test(brand) || re.test(name || '')) return { t, c, fg };
  const [p, l] = chainCol(name || brand);
  return { t: (name || brand || 'AUTO SALES').toUpperCase(), c: p === '#ffffff' ? '#3a4048' : p, fg: p === '#ffffff' ? '#ffffff' : l };
}

/**
 * The storefront of a stand-alone store: the face with the most car park in
 * front of it (a big box's front is its lot; the street usually passes a
 * side or the back), a face right on a street counted down.
 */
function lotFront(city, b, fr) {
  let best = 0, bs = -Infinity;
  for (let fi = 0; fi < 4; fi++) {
    const L = fr.F[fi].len;
    let park = 0, n = 0;
    for (let k = 1; k <= 7; k++) for (let j = -3; j <= 3; j++) {
      const p = fr.P(fi, (j / 3.5) * L / 2, 0, k * 8);
      n++;
      if (G.lotAt(p[0], p[2]) >= 0 && !city.onRoad(p[0], p[2], 0, false)) park++;
    }
    const q = fr.P(fi, 0, 0, 6);
    const s = park / n + (city.onRoad(q[0], q[2], 4, false) ? -0.5 : 0) + L * 0.002;
    if (s > bs) { bs = s; best = fi; }
  }
  return best;
}

// --- the stores ------------------------------------------------------------------------

const T = (x, z) => G.terrainHeight(x, z);
const GLASS = lin('#1a2329'), STEEL = lin('#8a8f94'), CEIL = lin('#e9e9e4'), PUMP = lin('#d8d8d4'), CONC = lin('#b8b4aa');
const DOCK = lin('#4a4d50'), BLACK = lin('#151515'), FRAME = lin('#3c3e40'), SOFFIT = lin('#d9d6cf'), RTU = lin('#a9acae'), BAYDOOR = lin('#c9ccce');
const U0 = [0, 0, 0, 0, 0, 0, 0, 0];
const shade = (c, k) => [c[0] * k, c[1] * k, c[2] * k];

/** A building box's faces in its own frame, and helpers to place things on them. */
function frameOf(b) {
  const c = Math.cos(b.rot), s = Math.sin(b.rot), hw = b.w / 2, hd = b.d / 2;
  const F = [
    { n: [1, 0], c: [hw, 0], len: b.d, al: [0, 1] },
    { n: [-1, 0], c: [-hw, 0], len: b.d, al: [0, 1] },
    { n: [0, 1], c: [0, hd], len: b.w, al: [1, 0] },
    { n: [0, -1], c: [0, -hd], len: b.w, al: [1, 0] },
  ];
  const W = (lx, lz) => [b.x + lx * c - lz * s, b.z + lx * s + lz * c];
  const fr = {
    F, W,
    /** world point on face fi: t along it, o out from it, at height y */
    P: (fi, t, y, o = 0) => { const f = F[fi]; const [x, z] = W(f.c[0] + f.al[0] * t + f.n[0] * o, f.c[1] + f.al[1] * t + f.n[1] * o); return [x, y, z]; },
    N: (fi) => { const n = F[fi].n; return [n[0] * c - n[1] * s, 0, n[0] * s + n[1] * c]; },
    rot: (fi) => (F[fi].al[0] ? b.rot : b.rot + Math.PI / 2),
    opp: (fi) => fi ^ 1,
    sides: (fi) => (fi < 2 ? [2, 3] : [0, 1]),
    /** the side face at the +t (sg 1) or -t end of face fi */
    end: (fi, sg) => (F[fi].al[0] ? (sg > 0 ? 0 : 1) : (sg > 0 ? 2 : 3)),
    /** t on face fi of local point (lx, lz) */
    tOf: (fi, x, z) => { const dx = x - b.x, dz = z - b.z; const lx = dx * c + dz * s, lz = -dx * s + dz * c; const f = F[fi]; return lx * f.al[0] + lz * f.al[1]; },
  };
  /** a wall rectangle on face fi: t0..t1, y0..y1, `o` out */
  fr.rect = (Bd, fi, t0, t1, y0, y1, o, col, inward = false) => {
    const N = fr.N(fi);
    Bd.quad(fr.P(fi, t0, y0, o), fr.P(fi, t1, y0, o), fr.P(fi, t1, y1, o), fr.P(fi, t0, y1, o), inward ? [-N[0], 0, -N[2]] : N, U0, col);
  };
  /** a box on face fi: centred t along it and o out, w along, d out, from y0 up h */
  fr.box = (Bd, fi, t, o, w, d, y0, h, col, opts) => {
    const [x, , z] = fr.P(fi, t, 0, o);
    Bd.box(x, y0, z, w, h, d, fr.rot(fi), col, opts);
  };
  fr.solid = (fi, t, o, w, d, y0, y1) => { const [x, , z] = fr.P(fi, t, 0, o); return { x, z, hw: w / 2, hd: d / 2, rot: fr.rot(fi), y0, y1 }; };
  return fr;
}

const hashI = (a, b) => { const s = Math.sin(a * 127.1 + b * 311.7) * 43758.5453; return s - Math.floor(s); };

// --- a fast-food pad's silhouette ---------------------------------------------------------
// The chains' current pads, each by what reads from the road: Tims' espresso
// fascia with its red line, stone base and piers and a wood-clad entrance
// tower; McDonald's grey box with the yellow "eyebrow" arch over the roof;
// Wendy's, Harvey's, A&W, Burger King and Starbucks' entrance towers (sloped
// where theirs are); KFC's red and white bucket stripes; DQ's and Popeyes'
// mansards. All of it into the pad's own cluster builder (no draw of its own).
const PAD_SIL = {
  tims: { stone: '#b5a891', tower: { w: 5.4, up: 1.8, slope: 0, col: '#6b4329', cap: '#c8102e', stone: true } },
  mcd: { eyebrow: '#ffbc0d', wood: '#8a5b3a' },
  wendys: { tower: { w: 4.2, up: 2.4, slope: 1.3, col: '#e2203d', cap: '#2b2b2b' } },
  harveys: { tower: { w: 4.8, up: 1.9, slope: 0.9, col: '#e21836', cap: '#ffd400' } },
  aw: { tower: { w: 4.8, up: 1.9, slope: 0, col: '#3d2b1f', cap: '#f26522' }, wood: '#7a5234' },
  bk: { tower: { w: 4.8, up: 1.6, slope: 0.8, col: '#502314', cap: '#ff8732' } },
  kfc: { stripes: ['#e4002b', '#f4f4f2'] },
  starbucks: { tower: { w: 3.8, up: 2.8, slope: 1.6, col: '#3b302a', cap: '#00704a' }, wood: '#8a6a4c' },
  dq: { mansard: '#c8102e' }, popeyes: { mansard: '#c8481c' },
};
const UP = [0, 1, 0];
const nrm = (x, y, z) => { const l = Math.hypot(x, y, z) || 1; return [x / l, y / l, z / l]; };
/**
 * A block on face fi from t0 to t1 along it and o0 to o1 out, from y0 up to a
 * top that runs from ya (at t0) to yb (at t1): a tower, or a sloped one.
 */
function slopeBlock(Bd, fr, fi, t0, t1, o0, o1, y0, ya, yb, col, sides = true) {
  const N = fr.N(fi), p0 = fr.P(fi, 0, 0, 0), p1 = fr.P(fi, 1, 0, 0);
  const al = [p1[0] - p0[0], 0, p1[2] - p0[2]];
  const yAt = (t) => ya + ((yb - ya) * (t - t0)) / (t1 - t0);
  for (const [o, s] of [[o1, 1], [o0, -1]]) {
    Bd.quad(fr.P(fi, t0, y0, o), fr.P(fi, t1, y0, o), fr.P(fi, t1, yb, o), fr.P(fi, t0, ya, o), [N[0] * s, 0, N[2] * s], U0, s > 0 ? col : shade(col, 0.8));
  }
  if (sides) {
    for (const [t, s] of [[t0, -1], [t1, 1]]) {
      const yt = yAt(t);
      Bd.quad(fr.P(fi, t, y0, o0), fr.P(fi, t, y0, o1), fr.P(fi, t, yt, o1), fr.P(fi, t, yt, o0), [al[0] * s, 0, al[2] * s], U0, shade(col, 0.88));
    }
  }
  const sl = (yb - ya) / (t1 - t0);
  Bd.quad(fr.P(fi, t0, ya, o0), fr.P(fi, t1, yb, o0), fr.P(fi, t1, yb, o1), fr.P(fi, t0, ya, o1), nrm(-al[0] * sl, 1, -al[2] * sl), U0, shade(col, 1.05));
}
/** A mansard round the whole box: from `out` past the walls at y0 up and in to `inn` inside them at y1. */
function mansard(Bd, fr, y0, y1, out, inn, col) {
  for (let fi = 0; fi < 4; fi++) {
    const h = fr.F[fi].len / 2, N = fr.N(fi);
    Bd.quad(fr.P(fi, -h - out, y0, out), fr.P(fi, h + out, y0, out), fr.P(fi, h - inn, y1, -inn), fr.P(fi, -h + inn, y1, -inn),
      nrm(N[0] * (y1 - y0), out + inn, N[2] * (y1 - y0)), U0, col);
    // its soffit
    Bd.quad(fr.P(fi, -h - out, y0, out), fr.P(fi, h + out, y0, out), fr.P(fi, h, y0, 0), fr.P(fi, -h, y0, 0), [0, -1, 0], U0, shade(col, 0.55));
  }
}
/**
 * McDonald's eyebrow: a yellow arch standing on the parapet, `W` across at t
 * tc on face fi, rising `rise`, its band `th` deep (radially) and o0..o1 out.
 */
function eyebrow(Bd, fr, fi, tc, W, rise, yb, th, o0, o1, col) {
  const N = fr.N(fi), p0 = fr.P(fi, 0, 0, 0), p1 = fr.P(fi, 1, 0, 0);
  const al = [p1[0] - p0[0], p1[2] - p0[2]];
  const n = 12, R = W / 2;
  const pt = (k, inner) => { const a = (Math.PI * k) / n, r = inner ? R - th : R, h = inner ? rise - th : rise;
    return [tc - r * Math.cos(a), yb + h * Math.sin(a), -Math.cos(a) / r, Math.sin(a) / h]; };
  for (let k = 0; k < n; k++) {
    const A = pt(k, false), B2 = pt(k + 1, false), a = pt(k, true), b2 = pt(k + 1, true);
    for (const [o, s] of [[o1, 1], [o0, -1]]) {
      Bd.quad(fr.P(fi, A[0], A[1], o), fr.P(fi, B2[0], B2[1], o), fr.P(fi, b2[0], b2[1], o), fr.P(fi, a[0], a[1], o), [N[0] * s, 0, N[2] * s], U0, s > 0 ? col : shade(col, 0.8));
    }
    // the outer (top) and inner (under) surfaces, normals out from the arch's centre
    const mo = nrm(al[0] * (A[2] + B2[2]), A[3] + B2[3], al[1] * (A[2] + B2[2]));
    Bd.quad(fr.P(fi, A[0], A[1], o0), fr.P(fi, B2[0], B2[1], o0), fr.P(fi, B2[0], B2[1], o1), fr.P(fi, A[0], A[1], o1), mo, U0, shade(col, 1.05));
    Bd.quad(fr.P(fi, a[0], a[1], o0), fr.P(fi, b2[0], b2[1], o0), fr.P(fi, b2[0], b2[1], o1), fr.P(fi, a[0], a[1], o1), [-mo[0], -mo[1], -mo[2]], U0, shade(col, 0.7));
  }
}
/** The chain's silhouette on a pad pad() drew: g = { fr, fi, L, gy, top, pt, Bd }. */
function padSilhouette(g, k) {
  const sil = PAD_SIL[k];
  if (!sil) return;
  const { fr, fi, L, gy, top, pt, Bd } = g, h = L / 2, back = fr.opp(fi);
  if (sil.stone) {
    // the stone wainscot all round (the piers are pad()'s, in the stone)
    const st = lin(sil.stone);
    for (let fj = 0; fj < 4; fj++) { const hs = fr.F[fj].len / 2; fr.rect(Bd, fj, -hs, hs, gy, gy + (fj === fi ? 0.45 : 1.25), 0.07, st); }
  }
  if (sil.wood) {
    // a wood-clad panel beside the glass at the far end of the front, under the fascia
    const wd = lin(sil.wood), t1 = h - 0.35, t0 = Math.max(-h + 2, h - Math.min(3.2, L * 0.22));
    fr.rect(Bd, fi, t0, t1, gy + 0.45, gy + 3.2, 0.12, wd);
    for (let t = t0 + 0.3; t < t1; t += 0.3) fr.rect(Bd, fi, t - 0.02, t + 0.02, gy + 0.45, gy + 3.2, 0.13, shade(wd, 0.7));
  }
  if (sil.stripes) {
    // the bucket's stripes round the parapet, above the fascia
    const cs = sil.stripes.map(lin);
    for (let fj = 0; fj < 4; fj++) {
      if (fj === back) continue;
      const hs = fr.F[fj].len / 2, n = Math.max(2, Math.round((2 * hs) / 0.8));
      for (let i = 0; i < n; i++) fr.rect(Bd, fj, -hs + (2 * hs * i) / n, -hs + (2 * hs * (i + 1)) / n, gy + 4.5, pt - 0.32, 0.1, cs[i & 1]);
    }
  }
  if (sil.mansard) mansard(Bd, fr, top - 0.55, pt + 0.55, 0.95, 0.35, lin(sil.mansard));
  if (sil.tower) {
    const T0 = sil.tower, w = Math.min(T0.w, L - 2), c = lin(T0.col), cap = lin(T0.cap);
    const ya = pt + T0.up, yb = ya + T0.slope;
    slopeBlock(Bd, fr, fi, -w / 2, w / 2, -0.6, 1.0, gy + 3.1, ya, yb, c);
    // the cap line along its top, on the face
    const N = fr.N(fi);
    Bd.quad(fr.P(fi, -w / 2, ya - 0.32, 1.02), fr.P(fi, w / 2, yb - 0.32, 1.02), fr.P(fi, w / 2, yb, 1.02), fr.P(fi, -w / 2, ya, 1.02), N, U0, cap);
    if (T0.stone) {
      // stone-clad corners down the tower's face (Tims)
      const st = lin(sil.stone);
      for (const s of [-1, 1]) fr.box(Bd, fi, s * (w / 2 - 0.35), 1.0, 0.7, 0.3, gy + 4.45, ya - 0.32 - gy - 4.45, st, { top: false });
    }
  }
  if (sil.eyebrow) {
    // the arch over the roof at the drive-through end of the front, standing on the parapet
    const W = Math.min(10, L * 0.55), tc = h - W / 2 - Math.min(2.5, L * 0.1);
    eyebrow(Bd, fr, fi, tc, W, 2.2, pt - 0.1, 0.7, -0.4, 0.35, lin(sil.eyebrow));
  }
}

/**
 * The shell every format shares: walls, base, piers, accent band, parapet and
 * its coping, the roof and its rooftop units. `front` is the storefront face.
 */
function shell(Bd, b, fr, front, A, opts = {}) {
  const gy = b.y, yb = gy - 2.2, top = b.y + b.h, par = opts.par || 1.0, pt = top + par;
  const wall = lin(A.wall), base = lin(A.base), cap = lin(A.cap), roof = lin(A.roof);
  const back = fr.opp(front);
  for (let fi = 0; fi < 4; fi++) {
    const L = fr.F[fi].len, h = L / 2;
    fr.rect(Bd, fi, -h, h, yb, pt, 0, [shade(wall, 0.82), shade(wall, 0.82), wall, wall]);
    fr.rect(Bd, fi, -h, h, yb, gy + (fi === front ? 0.6 : 1.1), 0.04, base);
    if (A.band && fi !== back) fr.rect(Bd, fi, -h, h, top - 1.75, top - 0.55, 0.05, lin(A.band));
    fr.rect(Bd, fi, -h, h, pt - 0.32, pt, 0.08, cap);
    // the panels' reveal lines (tilt-up / EIFS joints)
    if (fi !== back) for (let y = gy + 2.6; y < top - 2.2; y += 2.4) fr.rect(Bd, fi, -h, h, y, y + 0.09, 0.03, shade(wall, 0.72));
    fr.rect(Bd, fi, -h + 0.3, h - 0.3, top, pt, -0.3, shade(wall, 0.7), true);
    // the coping: the top of the parapet, inner face to outer
    const N = fr.N(fi);
    void N;
    Bd.quad(fr.P(fi, -h, pt, 0.08), fr.P(fi, h, pt, 0.08), fr.P(fi, h, pt, -0.3), fr.P(fi, -h, pt, -0.3), [0, 1, 0], U0, cap);
    if (A.pier && fi !== back && !opts.noPiers) {
      const np = Math.max(1, Math.round(L / (opts.pierEvery || 9)));
      const pc = lin(A.pier);
      for (let i = 0; i <= np; i++) {
        const t = -h + 0.45 + ((L - 0.9) * i) / np;
        if (opts.skipPier && opts.skipPier(fi, t)) continue;
        fr.box(Bd, fi, t, 0.17, 0.9, 0.36, yb, pt + 0.18 - yb, pc, { top: false });
      }
    }
  }
  // the roof, and its rooftop units in rows
  const [a0x, a0z] = fr.W(-b.w / 2 + 0.3, -b.d / 2 + 0.3), [a1x, a1z] = fr.W(b.w / 2 - 0.3, -b.d / 2 + 0.3);
  const [a2x, a2z] = fr.W(b.w / 2 - 0.3, b.d / 2 - 0.3), [a3x, a3z] = fr.W(-b.w / 2 + 0.3, b.d / 2 - 0.3);
  const ry = top + 0.02;
  Bd.quad([a0x, ry, a0z], [a1x, ry, a1z], [a2x, ry, a2z], [a3x, ry, a3z], [0, 1, 0], U0, roof);
  const area = b.w * b.d;
  const nu = Math.max(2, Math.min(opts.maxUnits || 16, Math.round(area / 700)));
  const cols = Math.max(1, Math.round(Math.sqrt(nu * b.w / b.d))), rows = Math.max(1, Math.ceil(nu / cols));
  for (let i = 0; i < cols; i++) for (let j = 0; j < rows; j++) {
    if (hashI(b.x + i, b.z + j) < 0.25) continue;
    const lx = -b.w / 2 + ((i + 0.5) / cols) * b.w + (hashI(i, b.z) - 0.5) * 3, lz = -b.d / 2 + ((j + 0.5) / rows) * b.d + (hashI(j, b.x) - 0.5) * 3;
    const [x, z] = fr.W(lx, lz);
    const k = 1.8 + hashI(b.x * 0.3 + i, j) * 1.4;
    Bd.box(x, top, z, k * 1.5, 1.2 + hashI(i, j) * 0.6, k, b.rot, RTU);
  }
  return { gy, yb, top, pt };
}

/** Loading docks across the back: doors, bumpers, a light over each. */
function docks(Bd, fr, fi, gy, n, len) {
  const sp = Math.min(5, (len - 6) / n);
  for (let i = 0; i < n; i++) {
    const t = (i - (n - 1) / 2) * sp;
    fr.rect(Bd, fi, t - 1.35, t + 1.35, gy + 1.1, gy + 4.0, 0.06, DOCK);
    fr.rect(Bd, fi, t - 1.5, t + 1.5, gy - 0.4, gy + 1.1, 0.06, shade(DOCK, 0.6));
    for (const s of [-1, 1]) fr.box(Bd, fi, t + s * 1.25, 0.2, 0.3, 0.3, gy + 0.6, 0.5, BLACK);
    fr.box(Bd, fi, t, 0.25, 3.2, 0.5, gy + 4.05, 0.25, FRAME);
  }
}

export function buildShops(ctx) {
  if (!S) return;
  const { addTo, city } = ctx;
  const A = new BrandAtlas();
  const TX = new TextAtlas();
  // what hangs on each storefront's fascia already: [t0, t1] along it (fasciaUse)
  const fascia = new Map();
  // a front merged into the next cell's cluster (prepShops `ck`): everything drawn on or by its
  // building goes to that cluster's builders (a 40 m grid of them, the building's reach)
  const redir = new Map();
  // (and a store past every cluster, prepShops `rk`, to its own range-culled 'kwr:' one)
  for (const b of city.buildings) {
    if (!b.kw) continue;
    const ck = b.kw.shop && b.kw.shop.ck, rk = (b.kw.shop && b.kw.shop.rk) || (b.kw.sign && b.kw.sign.rk);
    if (!ck && !rk) continue;
    const r = Math.max(b.w, b.d) / 2 + 3, k = rk || 'kwp' + Math.round(ck[0] / 1200) + ',' + Math.round(ck[1] / 1200);
    for (let gx = Math.floor((b.x - r) / 40); gx <= Math.floor((b.x + r) / 40); gx++) for (let gz = Math.floor((b.z - r) / 40); gz <= Math.floor((b.z + r) / 40); gz++) {
      const g = gx * 100000 + gz;
      let l = redir.get(g);
      if (!l) redir.set(g, (l = []));
      l.push({ b, r, k });
    }
  }
  // while a store past every cluster is drawn, everything it puts down (its road pylon too) is its cluster's
  let curKey = null;
  const key = (x, z) => {
    if (curKey) return curKey;
    if (redir.size) {
      const l = redir.get(Math.floor(x / 40) * 100000 + Math.floor(z / 40));
      if (l) for (const q of l) if (Math.abs(x - q.b.x) < q.r && Math.abs(z - q.b.z) < q.r) return q.k;
    }
    return 'kwp' + Math.round(x / 1200) + ',' + Math.round(z / 1200);
  };
  const geo = new Map(), logo = new Map();
  const bOf = (m, x, z, uv) => { const k = key(x, z); let b = m.get(k); if (!b) m.set(k, (b = new Builder(uv))); return b; };
  const Gb = (x, z) => bOf(geo, x, z, false);
  const Lb = (x, z) => bOf(logo, x, z, true);
  const stats = { stores: 0, portals: 0, walls: 0, fascia: 0, pylons: 0, built: 0, canopies: 0, osmCanopies: 0, prices: 0, plazaPylons: 0, skipped: 0, solids: 0 };
  const out = [];
  const dts = [];     // the drive-throughs (driveLane), for drivethru.js
  const solid = (s) => { ctx.solids.push(s); stats.solids++; };
  const rotOf = (nx, nz) => Math.atan2(-nx, nz);   // a box whose local z is (nx, nz)

  /** Logo of brand k on a wall, centred at (x, y, z) facing (nx, nz), at most w x h. */
  const putLogo = (k, x, y, z, nx, nz, w, h) => {
    const c = A.logo(k);
    if (!c) return;
    let lw = h * c.a, lh = h;
    if (lw > w) { lw = w; lh = w / c.a; }
    A.quad(Lb(x, z), c, x, y, z, nx, nz, lw, lh);
  };

  /** A pylon: posts, a cabinet in `col`, the logo cell on both faces. */
  const pylonAt = (k, x, z, yaw, opts = {}) => {
    const c = A.logo(k);
    if (!c) return;
    const br = B[k];
    const y0 = T(x, z);
    const ph = opts.h || (br.pole || 6.2);
    const lh = c.a < 1.8 ? 2.4 : 1.5, lw = Math.min(5.6, lh * c.a);
    const nx = Math.sin(yaw), nz = Math.cos(yaw);
    const rot = rotOf(nx, nz);
    const Bd = Gb(x, z);
    const ux = nz, uz = -nx;
    if (c.a < 1.8) Bd.box(x, y0 - 0.5, z, 0.45, ph + 0.5, 0.45, rot, STEEL);
    else for (const s of [-1, 1]) Bd.box(x + ux * s * (lw / 2 - 0.3), y0 - 0.5, z + uz * s * (lw / 2 - 0.3), 0.24, ph + 0.5, 0.24, rot, STEEL);
    Bd.box(x, y0 + ph, z, lw + 0.24, lh + 0.24, 0.42, rot, lin(br.band || '#333333'));
    for (const s of [1, -1]) A.quad(Lb(x, z), c, x + nx * s * 0.215, y0 + ph + 0.12 + lh / 2, z + nz * s * 0.215, nx * s, nz * s, lw, lh);
    solid({ x, z, r: 0.45, y0: y0 - 2, y1: y0 + ph + lh });
    stats.pylons++;
  };

  /** A spot by the road in front of (x, z) for a pylon: { x, z, yaw } or null. */
  const roadSpot = (x, z, r = 70, back = 3.6) => {
    const rd = faceRoad(city, x, z, r);
    if (!rd || rd.d < rd.hw + back + 1) return null;
    const px = rd.qx - Math.sin(rd.yaw) * (rd.hw + back), pz = rd.qz - Math.cos(rd.yaw) * (rd.hw + back);
    if (boxAt(city, px, pz, 1.5) || city.onRoad(px, pz, 1.2, true)) return null;
    return { x: px, z: pz, yaw: rd.yaw + Math.PI / 2 };
  };

  // --- gas stations
  const gas = (k, x, z, cx, cz) => {
    const br = B[k];
    let cb = cx !== null ? boxAt(city, cx, cz, 2) : null;
    if (cb && !(cb.kw && cb.kw.canopy)) cb = null;
    let w, d, rot, ox, oz;
    if (cb) {
      // OSM's canopy footprint: the long side along local x
      w = cb.w; d = cb.d; rot = cb.rot; ox = cb.x; oz = cb.z;
      if (d > w) { const t = w; w = d; d = t; rot += Math.PI / 2; }
      stats.osmCanopies++;
    } else {
      // our own, along the nearest street, if there is room
      const rd = faceRoad(city, x, z, 70);
      if (!rd || city.onRoad(x, z, 8, true) || boxAt(city, x, z, 8)) return null;
      w = 22; d = 11; ox = x; oz = z;
      rot = rotOf(Math.sin(rd.yaw), Math.cos(rd.yaw));
    }
    w = Math.max(10, Math.min(48, w)); d = Math.max(7, Math.min(16, d));
    const c = Math.cos(rot), sn = Math.sin(rot);
    const at = (lx, lz) => [ox + lx * c - lz * sn, oz + lx * sn + lz * c];
    let gy = -Infinity;
    for (const [lx, lz] of [[-w / 2, -d / 2], [w / 2, -d / 2], [w / 2, d / 2], [-w / 2, d / 2], [0, 0]]) gy = Math.max(gy, T(...at(lx, lz)));
    const y0 = gy + 5.0, th = 1.15;
    const Bd = Gb(ox, oz);
    const [c0, c1, c2] = br.canopy.map(lin);
    // the fascia: body colour with its two stripes, and the lit ceiling under it
    Bd.box(ox, y0, oz, w, th, d, rot, c0);
    Bd.box(ox, y0 + 0.08, oz, w + 0.06, 0.24, d + 0.06, rot, c1, { top: false });
    Bd.box(ox, y0 + 0.36, oz, w + 0.04, 0.12, d + 0.04, rot, c2, { top: false });
    const p = (lx, lz) => { const [qx, qz] = at(lx, lz); return [qx, y0 - 0.01, qz]; };
    Bd.quad(p(-w / 2, -d / 2), p(w / 2, -d / 2), p(w / 2, d / 2), p(-w / 2, d / 2), [0, -1, 0], [0, 0, 0, 0, 0, 0, 0, 0], CEIL);
    // columns and pump islands along the middle
    const nc = Math.max(2, Math.round(w / 9));
    for (let i = 0; i < nc; i++) {
      const lx = -w / 2 + (w / nc) * (i + 0.5);
      const [qx, qz] = at(lx, 0);
      const g0 = T(qx, qz);
      Bd.box(qx, g0 - 0.5, qz, 0.5, y0 - g0 + 0.5, 0.5, rot, lin('#f0f0ee'));
      Bd.box(qx, g0, qz, 1.3, 0.22, Math.min(d - 2, 6), rot, CONC);
      for (const s of [-1, 1]) {
        const [px, pz] = at(lx, s * 1.6);
        Bd.box(px, g0 + 0.22, pz, 0.7, 1.75, 0.5, rot, PUMP);
        Bd.box(px, g0 + 1.45, pz, 0.74, 0.32, 0.54, rot, c1 === CEIL ? c2 : c1);
      }
      solid({ x: qx, z: qz, hw: 0.65, hd: Math.min(d - 2, 6) / 2, rot, y0: g0 - 1, y1: g0 + 2 });
    }
    // the logo on each face of the canopy
    for (const s of [1, -1]) {
      const [fx, fz] = at(0, s * (d / 2 + 0.05));
      putLogo(k, fx, y0 + th / 2 + 0.02, fz, -sn * s, c * s, Math.min(w * 0.5, 9), th - 0.12);
      const [ex, ez] = at(s * (w / 2 + 0.05), 0);
      putLogo(k, ex, y0 + th / 2 + 0.02, ez, c * s, sn * s, d * 0.8, th - 0.12);
    }
    stats.canopies++;
    // the price pylon at the road
    const sp = roadSpot(ox, oz, 60, 3.4);
    if (sp) {
      const pc = A.price(k);
      if (pc) {
        const py = T(sp.x, sp.z), nx = Math.sin(sp.yaw), nz = Math.cos(sp.yaw), prot = rotOf(nx, nz);
        const pw = 2.1, ph = pw / pc.a, base = 1.4;
        const Bp = Gb(sp.x, sp.z);
        Bp.box(sp.x, py - 0.5, sp.z, pw + 0.5, 0.9, 0.7, prot, CONC);
        Bp.box(sp.x, py, sp.z, pw + 0.3, base + ph + 0.3, 0.5, prot, lin(br.price));
        for (const s of [1, -1]) A.quad(Lb(sp.x, sp.z), pc, sp.x + nx * s * 0.26, py + base + ph / 2, sp.z + nz * s * 0.26, nx * s, nz * s, pw, ph);
        solid({ x: sp.x, z: sp.z, hw: (pw + 0.5) / 2, hd: 0.4, rot: prot, y0: py - 2, y1: py + base + ph });
        stats.prices++;
      }
    }
    return { x: ox, z: oz };
  };

  // --- the formats' buildings (prepShops marked them)
  const gardenSign = TX.cell('GARDEN CENTRE', 46);
  /** On local face fi of frame fr: the t of the corner with face `se`'s outward side. */
  const cornerT = (fr, fi, se) => {
    const nf = fr.F[fi].n, al = fr.F[se].al;
    return (nf[0] * al[0] + nf[1] * al[1]) * fr.F[se].len / 2;
  };
  const roomFor = (b, pts, pad) => pts.every(([x, z]) => !city.onRoad(x, z, pad, true) && (() => { const o = boxAt(city, x, z, 1); return !o || o === b; })());

  const frontFace = (b, fr) => lotFront(city, b, fr);

  const bigBox = (b, k) => {
    const Ar = ARCH[k], br = B[k], sh = b.kw.shop;
    const fr = frameOf(b);
    const fi = frontFace(b, fr), L = fr.F[fi].len, Bd = Gb(b.x, b.z);
    const { gy, top, pt } = shell(Bd, b, fr, fi, Ar, { par: 1.2 });
    const N = fr.N(fi), nx = N[0], nz = N[2];
    const PW = Math.min(L * 0.3, br.fmt === 'big' ? 24 : 18, L - 6);
    let tP = Math.max(-L / 2 + PW / 2 + 3, Math.min(L / 2 - PW / 2 - 3, fr.tOf(fi, sh.x, sh.z)));
    if (Math.abs(tP) < L * 0.12) tP = 0;
    let face0 = 0;    // where the vestibules stand out from
    if (Ar.stripes) {
      // Costco: red over blue along the front and the sides, the sign on the wall
      for (const fj of [fi, ...fr.sides(fi)]) {
        const h = fr.F[fj].len / 2;
        fr.rect(Bd, fj, -h, h, top - 4.0, top - 3.55, 0.06, lin('#e31837'));
        fr.rect(Bd, fj, -h, h, top - 4.7, top - 4.25, 0.06, lin('#005daa'));
      }
      const [x, y, z] = fr.P(fi, tP, top - 1.9, 0.12);
      putLogo(k, x, y, z, nx, nz, Math.min(20, L - 4), 3.3);
      stats.walls++;
    } else {
      // the entrance portal: a raised block in the brand's colour, the logo high on it
      const D = 2.8, Hh = pt - gy + (Ar.tall || 2.6);
      fr.box(Bd, fi, tP, D / 2 - 0.3, PW, D, gy - 0.6, Hh + 0.6, lin(br.portal || Ar.cap));
      fr.box(Bd, fi, tP, D / 2 - 0.3, PW + 0.4, D + 0.4, gy + Hh - 0.7, 0.7, lin(br.trim || Ar.cap));
      const lh = Math.min(br.fmt === 'big' ? 3.6 : 2.8, Hh - 6);
      const [x, y, z] = fr.P(fi, tP, gy + 5.2 + (Hh - 5.9) / 2, D - 0.26);
      putLogo(k, x, y, z, nx, nz, PW - 1.4, lh);
      solid(fr.solid(fi, tP, D / 2 - 0.3, PW, D, gy - 2, gy + Hh));
      face0 = D - 0.3;
      // the parapet steps up either side of the portal
      for (const sgn of [-1, 1]) {
        const w2 = Math.min(L * 0.12, 16), t2 = tP + sgn * (PW / 2 + w2 / 2);
        if (Math.abs(t2) + w2 / 2 > L / 2 - 1) continue;
        fr.box(Bd, fi, t2, 0.3, w2, 0.7, pt - 0.5, 1.9, lin(Ar.pier || Ar.wall));
        fr.box(Bd, fi, t2, 0.3, w2 + 0.3, 0.95, pt + 1.4, 0.3, lin(Ar.cap));
      }
      stats.portals++;
    }
    // glass vestibules: one at the portal; a big box has a second door at the other end of the front
    const vts = Ar.vest === 2 ? [tP - Math.sign(tP || 1) * Math.min(PW / 2 + 16, L * 0.32), tP] : [tP];
    for (const t0 of vts) {
      const t = Math.max(-L / 2 + 6, Math.min(L / 2 - 6, t0));
      const o0 = Math.abs(t - tP) < PW / 2 ? face0 : 0;
      const col = lin(br.trim || Ar.cap);
      fr.box(Bd, fi, t, o0 + 1.6, 9, 3.2, gy - 0.3, 4.3, col);
      fr.rect(Bd, fi, t - 3.6, t + 3.6, gy + 0.05, gy + 3.5, o0 + 3.22, GLASS);
      fr.box(Bd, fi, t, o0 + 2.2, 10, 4.4, gy + 4.0, 0.4, lin(Ar.cap));
      solid(fr.solid(fi, t, o0 + 1.6, 9, 3.2, gy - 2, gy + 4.4));
    }
    // a supermarket's windows either side of the doors
    if (Ar.glass) {
      const G2 = Math.min(L * 0.24, 28);
      for (const s of [-1, 1]) {
        const ta = tP + s * (PW / 2 + 0.6), tb = Math.max(-L / 2 + 2, Math.min(L / 2 - 2, tP + s * G2));
        const t0 = Math.min(ta, tb), t1 = Math.max(ta, tb);
        if (t1 - t0 < 3) continue;
        fr.rect(Bd, fi, t0, t1, gy + 0.6, gy + 3.4, 0.07, GLASS);
        for (let t = t0; t <= t1; t += 3) fr.rect(Bd, fi, t - 0.06, t + 0.06, gy + 0.6, gy + 3.4, 0.1, FRAME);
        fr.rect(Bd, fi, t0 - 0.2, t1 + 0.2, gy + 3.4, gy + 3.7, 0.1, lin(Ar.cap));
      }
    }
    // the garden centre: a fenced yard off the end of the front away from the portal, its inner half roofed
    let gardenSide = 0;
    if (Ar.garden) {
      for (const sg of [tP > 0 ? -1 : 1, tP > 0 ? 1 : -1]) {
        const se = fr.end(fi, sg), SL = fr.F[se].len;
        const tF = cornerT(fr, fi, se), dir = -Math.sign(tF);
        const GL = Math.min(SL * 0.55, 44), GD = 16;
        const corners = [[tF, 1], [tF + dir * GL, 1], [tF, GD], [tF + dir * GL, GD], [tF + dir * GL / 2, GD / 2]].map(([t, o]) => { const p = fr.P(se, t, 0, o); return [p[0], p[2]]; });
        if (!roomFor(b, corners, 1.5)) continue;
        const gcol = lin(Ar.garden), wallc = lin(Ar.base);
        const edge = (t0, o0, t1, o1) => {
          const L2 = Math.hypot(t1 - t0, o1 - o0), n2 = Math.max(1, Math.round(L2 / 4));
          for (let i = 0; i <= n2; i++) {
            const t = t0 + ((t1 - t0) * i) / n2, o = o0 + ((o1 - o0) * i) / n2;
            fr.box(Bd, se, t, o, 0.2, 0.2, gy - 0.4, 5.0, gcol, { top: false });
          }
          // the block wall and the rails, as boxes along the edge
          const tm = (t0 + t1) / 2, om = (o0 + o1) / 2, along = Math.abs(t1 - t0) > Math.abs(o1 - o0);
          const w = along ? L2 : 0.3, d = along ? 0.3 : L2;
          fr.box(Bd, se, tm, om, w, d, gy - 0.4, 1.4, wallc);
          for (const y of [2.6, 4.5]) fr.box(Bd, se, tm, om, along ? L2 : 0.08, along ? 0.08 : L2, gy + y, 0.1, gcol);
          // the mesh: dark bars between the posts, a few to a bay
          for (let i = 0; i < n2; i++) {
            const u = (i + 0.5) / n2, t = t0 + (t1 - t0) * u, o = o0 + (o1 - o0) * u;
            fr.box(Bd, se, t, o, 0.05, 0.05, gy + 1.0, 3.6, gcol, { top: false });
          }
        };
        edge(tF, GD, tF + dir * GL, GD);
        edge(tF, 0.3, tF, GD);
        edge(tF + dir * GL, 0.3, tF + dir * GL, GD);
        fr.box(Bd, se, tF + dir * GL / 2, GD * 0.25, GL, GD * 0.5, gy + 4.9, 0.45, lin(Ar.canopy || Ar.cap));
        for (let i = 0; i <= Math.round(GL / 8); i++) fr.box(Bd, se, tF + dir * (GL * i) / Math.round(GL / 8), GD * 0.5 - 0.2, 0.3, 0.3, gy - 0.4, 5.3, gcol);
        // GARDEN CENTRE over the yard's gate, on the side toward the lot
        const [gx, , gz] = fr.P(se, tF + 0.02 * dir, 0, GD / 2);
        const Nf = fr.N(fi);
        if (gardenSign) TX.quad(A, Lb(gx, gz), gardenSign, '#ffffff', '#2f6b3a', gx + Nf[0] * 0.15, gy + 5.6, gz + Nf[2] * 0.15, Nf[0], Nf[2], Math.min(5.6, 0.95 * gardenSign.a), 0.95);
        fr.box(Bd, se, tF + dir * 0.0, GD / 2, 0.2, 6.2, gy + 5.05, 1.1, lin(Ar.cap));
        solid(fr.solid(se, tF + dir * GL / 2, GD / 2, GL, GD, gy - 2, gy + 5.4));
        gardenSide = sg;
        stats.gardens = (stats.gardens || 0) + 1;
        break;
      }
    }
    // service bays (auto service, Costco's tire centre) on the other end
    if (Ar.bays) {
      const sg = gardenSide ? -gardenSide : (tP > 0 ? -1 : 1);
      const se = fr.end(fi, sg), SL = fr.F[se].len, tF = cornerT(fr, fi, se), dir = -Math.sign(tF);
      const n = Math.min(Ar.bays, Math.floor((SL - 10) / 5));
      for (let i = 0; i < n; i++) {
        const t = tF + dir * (5 + i * 5);
        fr.rect(Bd, se, t - 1.8, t + 1.8, gy, gy + 4.2, 0.06, BAYDOOR);
        fr.rect(Bd, se, t - 1.6, t + 1.6, gy + 2.6, gy + 3.1, 0.08, GLASS);
        fr.box(Bd, se, t, 0.2, 4.2, 0.4, gy + 4.2, 0.3, lin(Ar.cap));
      }
    }
    docks(Bd, fr, fr.opp(fi), gy, Math.max(2, Math.min(6, Math.round(L / 18))), L);
    // cart corrals in the lot
    if (Ar.corral) {
      let nc = 0;
      for (const [dt, o] of [[-0.28, 30], [0.28, 30], [-0.12, 46], [0.12, 46], [0, 62]]) {
        if (nc >= 4) break;
        const t = tP + dt * L, p = fr.P(fi, t, 0, o);
        if (G.lotAt(p[0], p[2]) < 0 || city.onRoad(p[0], p[2], 2.5, true) || boxAt(city, p[0], p[2], 3)) continue;
        const g2 = T(p[0], p[2]);
        for (const s of [-1, 1]) {
          fr.box(Bd, fi, t + s * 0.8, o, 0.08, 6.5, g2 + 0.95, 0.08, STEEL);
          for (const oo of [-3, 3]) fr.box(Bd, fi, t + s * 0.8, o + oo, 0.08, 0.08, g2, 1.0, STEEL, { top: false });
        }
        fr.box(Bd, fi, t, o - 3.3, 1.8, 0.1, g2, 1.9, lin(Ar.corral));
        solid(fr.solid(fi, t, o, 1.8, 6.6, g2 - 1, g2 + 1.2));
        nc++;
      }
      stats.corrals = (stats.corrals || 0) + nc;
    }
    stats.bigbox = (stats.bigbox || 0) + 1;
    // where the plaza's other tenants in this box can sign: its front, clear of the portal
    const G2w = Ar.glass ? Math.min(L * 0.24, 28) : 0;
    sh.front = fi; sh.gy = gy; sh.top = top;
    sh.used = [[tP - Math.max(PW / 2 + 1, G2w + 0.5), tP + Math.max(PW / 2 + 1, G2w + 0.5)]];
    for (const t0 of vts) { const t = Math.max(-L / 2 + 6, Math.min(L / 2 - 6, t0)); sh.used.push([t - 5.2, t + 5.2]); }
    const [dx, , dz] = fr.P(fi, tP, 0, face0 + 4.5);
    return { x: dx, z: dz, door: { x: dx, z: dz } };
  };

  const unit = (b, k) => {
    const Ar = ARCH[k];
    const fr = frameOf(b);
    const fi = frontFace(b, fr), L = fr.F[fi].len, Bd = Gb(b.x, b.z);
    const { gy, top } = shell(Bd, b, fr, fi, Ar, { pierEvery: 6, maxUnits: 6, skipPier: (fj, t) => fj === fi && Math.abs(t) < 4.5 });
    // glass across the front, the doors in the middle under a canopy
    fr.rect(Bd, fi, -L / 2 + 1.2, L / 2 - 1.2, gy + 0.6, gy + 3.0, 0.07, GLASS);
    fr.rect(Bd, fi, -1.6, 1.6, gy, gy + 2.6, 0.09, shade(GLASS, 0.6));
    fr.box(Bd, fi, 0, 1.2, 6, 2.4, gy + 3.1, 0.35, lin(Ar.cap));
    const N = fr.N(fi);
    const [x, y, z] = fr.P(fi, 0, Math.min(top - 1.15, gy + 4.4), 0.12);
    putLogo(k, x, y, z, N[0], N[2], Math.min(L - 2, 9), 1.15);
    docks(Bd, fr, fr.opp(fi), gy, 1, fr.F[fi ^ 1].len);
    stats.units = (stats.units || 0) + 1;
    const [dx, , dz] = fr.P(fi, 0, 0, 2.5);
    return { x: dx, z: dz, door: { x: dx, z: dz } };
  };

  /** A plaza's strip building: the arcade, the parapet towers, the storefronts. */
  const stripBld = (b) => {
    const fi = b.kw.strip.face, fr = frameOf(b), L = fr.F[fi].len, Bd = Gb(b.x, b.z);
    const pi = b.kw.shop.plaza >= 0 ? b.kw.shop.plaza : b.kw.shop.front * 3 + 1;
    const pal = PLAZA_PAL[(pi * 7 + 3) % PLAZA_PAL.length];
    const Ar = { wall: pal[0], base: pal[1], pier: pal[2], cap: pal[4], roof: pal[5] };
    const { gy, pt } = shell(Bd, b, fr, fi, Ar, { pierEvery: 8, maxUnits: 5, noPiers: true });
    const h = L / 2;
    // the storefronts: glass with mullions and doors
    fr.rect(Bd, fi, -h + 0.6, h - 0.6, gy - 0.3, gy + 3.1, 0.06, GLASS);
    const nm = Math.max(1, Math.round((L - 1.2) / 3));
    for (let i = 0; i <= nm; i++) { const t = -h + 0.6 + ((L - 1.2) * i) / nm; fr.rect(Bd, fi, t - 0.06, t + 0.06, gy - 0.3, gy + 3.1, 0.1, FRAME); }
    // the arcade: the sign fascia on brick piers, its soffit
    const fasc = lin(pal[3]), pier = lin(pal[2]);
    fr.box(Bd, fi, 0, 0.92, L + 0.2, 1.84, gy + 3.2, 1.25, fasc);
    fr.rect(Bd, fi, -h - 0.1, h + 0.1, gy + 4.33, gy + 4.45, 1.86, lin(pal[4]));
    Bd.quad(fr.P(fi, -h, gy + 3.19, 0), fr.P(fi, h, gy + 3.19, 0), fr.P(fi, h, gy + 3.19, 1.8), fr.P(fi, -h, gy + 3.19, 1.8), [0, -1, 0], U0, SOFFIT);
    const nc = Math.max(2, Math.round(L / 7.5));
    for (let i = 0; i <= nc; i++) {
      const t = -h + 0.5 + ((L - 1.0) * i) / nc;
      fr.box(Bd, fi, t, 1.5, 0.62, 0.62, gy - 0.5, 3.72, pier, { top: false });
      const [x, , z] = fr.P(fi, t, 0, 1.5);
      solid({ x, z, r: 0.4, y0: gy - 2, y1: gy + 3.2 });
    }
    // parapet towers at the ends and every ~28 m: the step up in the roofline
    const tw = [];
    if (L > 14) { tw.push(-h + 4.2, h - 4.2); for (let t = -h + 28; t < h - 20; t += 28) tw.push(t); } else tw.push(0);
    for (const t of tw) {
      fr.box(Bd, fi, t, 0.4, 8, 0.8, pt - 0.4, 2.1, pier);
      fr.box(Bd, fi, t, 0.4, 8.5, 1.1, pt + 1.7, 0.3, lin(pal[4]));
      fr.box(Bd, fi, t, 0.4, 6.4, 0.9, pt + 0.1, 1.1, lin(pal[0]), { top: false });
    }
    // service doors at the back
    const bk = fr.opp(fi);
    for (let t = -h + 5; t < h - 3; t += 9) fr.rect(Bd, bk, t - 0.5, t + 0.5, gy, gy + 2.2, 0.05, DOCK);
    stats.strips = (stats.strips || 0) + 1;
  };

  // --- the storefronts outside the plazas (prepShops marked them from S.fronts)
  //
  //   s  a strip: stripBld's arcade, as the plazas'
  //   f  a fast-food or coffee pad: glass across the front, the brand's colour
  //      band wrapping the building under the parapet, the drive-through
  //      window and its canopy on one side, its pylon at the road
  //   b  a bank on its pad: stone pilasters, tall glass, the bank's band
  //   a  a lube shop / garage: overhead bay doors across the front, the office's glass at one end
  //   k  a gas station's kiosk: the brand's walls and stripes, glass, the logo
  //   c  a dealer: the showroom's double-height glass, the make's portal and
  //      its name, the dealer's name along the parapet, service bays at the side
  const letter = (Bd, c, fg, bgc, x, y, z, nx, nz, wMax, hMax) => {
    if (!c) return null;
    let lh = hMax, lw = hMax * c.a;
    if (lw > wMax) { lw = wMax; lh = wMax / c.a; }
    TX.quad(A, Bd, c, fg, bgc, x, y, z, nx, nz, lw, lh);
    return { lw, lh };
  };
  const pad = (b, look, opts = {}) => {
    const fi = b.kw.strip.face, fr = frameOf(b), L = fr.F[fi].len, Bd = Gb(b.x, b.z), h = L / 2;
    // the roof by what it is: a kiosk's white membrane, a bank's and a restaurant's grey ballast
    const kd = b.kw.shop && b.kw.shop.kind;
    const Ar = { wall: look.wall, base: look.base || '#6f6a62', cap: look.cap || look.band, roof: look.roof || (kd === 'k' ? '#e4e4e0' : kd === 'b' ? '#b3b0a8' : kd === 'f' ? '#a8a49b' : '#c9cac9'), pier: look.pier };
    const { gy, top, pt } = shell(Bd, b, fr, fi, Ar, { par: 0.8, maxUnits: 3, noPiers: !look.pier, pierEvery: 5, skipPier: (fj, t) => fj === fi && Math.abs(t) < h - 1.2 });
    // the front's glass, its mullions, the door
    const g0 = -h + 0.7, g1 = h - 0.7, gt = gy + (opts.glassTop || 3.05);
    fr.rect(Bd, fi, g0, g1, gy + 0.45, gt, 0.06, GLASS);
    const nm = Math.max(1, Math.round((g1 - g0) / 2.4));
    for (let i = 0; i <= nm; i++) { const t = g0 + ((g1 - g0) * i) / nm; fr.rect(Bd, fi, t - 0.06, t + 0.06, gy + 0.45, gt, 0.1, FRAME); }
    fr.rect(Bd, fi, -0.95, 0.95, gy, gy + 2.4, 0.11, shade(GLASS, 0.6));
    // the fascia: a canopy band where every sign here hangs (1.8 m out, 3.2-4.45 m up)
    fr.box(Bd, fi, 0, 0.92, L + 0.2, 1.84, gy + 3.2, 1.25, lin(look.band));
    Bd.quad(fr.P(fi, -h, gy + 3.19, 0), fr.P(fi, h, gy + 3.19, 0), fr.P(fi, h, gy + 3.19, 1.8), fr.P(fi, -h, gy + 3.19, 1.8), [0, -1, 0], U0, SOFFIT);
    fr.rect(Bd, fi, -h - 0.1, h + 0.1, gy + 4.33, gy + 4.45, 1.86, lin(look.accent || look.band));
    // the band wraps the sides and the back
    for (let fj = 0; fj < 4; fj++) if (fj !== fi) { const hs = fr.F[fj].len / 2; fr.rect(Bd, fj, -hs, hs, gy + 3.3, Math.min(gy + 4.4, top - 0.1), 0.05, lin(look.band)); }
    return { fr, fi, L, gy, top, pt, Bd };
  };
  // --- the drive-through: OSM's lane (service=drive-through, shops.json front[6]) painted
  // round the pad, the window where it passes closest, the menu board and the speaker
  // post before it, the DRIVE THRU sign where it starts. Returns what drivethru.js needs, or null.
  const PAINT = lin('#e9e7df'), PAINTY = lin('#e3bf3c');
  const flat = (Bd, a, b2, c, d, col) => {
    const y = (p) => [p[0], T(p[0], p[1]) + 0.05, p[1]];
    Bd.quad(y(a), y(b2), y(c), y(d), UP, U0, col);
  };
  const driveLane = (b, fr, fi, raw, gy, look, k, who) => {
    // resampled every ~1.5 m: x, z, s (metres along), tangent
    const P = [];
    let s = 0;
    for (let i = 0; i + 1 < raw.length; i++) {
      const [ax, az] = raw[i], [bx, bz] = raw[i + 1], l = Math.hypot(bx - ax, bz - az);
      if (l < 0.05) continue;
      const n = Math.max(1, Math.ceil(l / 1.5));
      for (let j = 0; j < n; j++) P.push({ x: ax + ((bx - ax) * j) / n, z: az + ((bz - az) * j) / n, s: s + (l * j) / n, tx: (bx - ax) / l, tz: (bz - az) / l });
      s += l;
    }
    if (P.length < 4 || s < 15) return null;
    const last = raw[raw.length - 1], pl = P[P.length - 1];
    P.push({ x: last[0], z: last[1], s, tx: pl.tx, tz: pl.tz });
    // the tangent across each sample (its neighbours'), so the edge lines turn a corner without a gap
    for (let i = 1; i + 1 < P.length; i++) {
      const dx = P[i + 1].x - P[i - 1].x, dz = P[i + 1].z - P[i - 1].z, l = Math.hypot(dx, dz);
      if (l > 0.01) { P[i].ux = dx / l; P[i].uz = dz / l; }
    }
    for (const p of P) if (p.ux === undefined) { p.ux = p.tx; p.uz = p.tz; }
    const len = s;
    // the box's local frame: how far outside it a point is
    const cr = Math.cos(b.rot), sr = Math.sin(b.rot);
    const loc = (x, z) => { const dx = x - b.x, dz = z - b.z; return [dx * cr + dz * sr, -dx * sr + dz * cr]; };
    const outside = (x, z) => { const [lx, lz] = loc(x, z); return Math.hypot(Math.max(0, Math.abs(lx) - b.w / 2), Math.max(0, Math.abs(lz) - b.d / 2)); };
    const inside = (x, z, pad) => { const [lx, lz] = loc(x, z); return Math.abs(lx) < b.w / 2 + pad && Math.abs(lz) < b.d / 2 + pad; };
    // the window: where the lane passes closest, with the building on the driver's (left) side
    let wi = -1, wd = 7.5;
    for (let i = 1; i < P.length - 1; i++) {
      const p = P[i], d = outside(p.x, p.z);
      const left = (p.tz * (b.x - p.x) - p.tx * (b.z - p.z)) > 0;
      if (left && d < wd) { wd = d; wi = i; }
    }
    if (wi < 0 || P[wi].s < 8) return null;
    let W = P[wi];
    const [wlx, wlz] = loc(W.x, W.z);
    const face = Math.abs(wlx) - b.w / 2 > Math.abs(wlz) - b.d / 2 ? (wlx > 0 ? 0 : 1) : (wlz > 0 ? 2 : 3);
    const FL = fr.F[face].len / 2;
    const tw = Math.max(-FL + 1.1, Math.min(FL - 1.1, fr.tOf(face, W.x, W.z)));
    // where a car stops for it: the lane's point nearest the window itself (it can be clamped off a corner)
    { const [qx, , qz] = fr.P(face, tw, 0, 0); let bd = Infinity;
      for (let i = Math.max(1, wi - 12); i < Math.min(P.length - 1, wi + 13); i++) { const e = Math.hypot(P[i].x - qx, P[i].z - qz); if (e < bd) { bd = e; W = P[i]; } } }
    const Bd = Gb(b.x, b.z), band = lin(look.band), N = fr.N(face);
    // the window, its frame and sill, and its canopy (a bump-out in the band's colour)
    fr.rect(Bd, face, tw - 0.85, tw + 0.85, gy + 0.95, gy + 2.25, 0.08, GLASS);
    fr.rect(Bd, face, tw - 0.95, tw + 0.95, gy + 0.85, gy + 0.95, 0.1, STEEL);
    for (const e of [-0.9, 0, 0.9]) fr.rect(Bd, face, tw + e - 0.04, tw + e + 0.04, gy + 0.95, gy + 2.25, 0.1, FRAME);
    fr.box(Bd, face, tw, 0.75, 3.8, 1.5, gy + 2.75, 0.32, band);
    fr.rect(Bd, face, tw - 1.9, tw + 1.9, gy + 2.75, gy + 2.84, 1.51, lin(look.accent || look.band));
    const [wx, , wz] = fr.P(face, tw, 0, 0.1);
    // the lane: its edge lines, arrows, and a stop bar at the window (off the building and off the street)
    const Gl = Bd;
    const ok = (x, z) => !inside(x, z, 0.3) && !city.onRoad(x, z, 0.2, true);
    for (const side of [1, -1]) {
      for (let i = 0; i + 1 < P.length; i++) {
        const p = P[i], q = P[i + 1];
        const lx0 = -p.uz * side * 1.75, lz0 = p.ux * side * 1.75, lx1 = -q.uz * side * 1.75, lz1 = q.ux * side * 1.75;
        const a = [p.x + lx0, p.z + lz0], c = [q.x + lx1, q.z + lz1];
        if (!ok(a[0], a[1]) || !ok(c[0], c[1])) continue;
        const ox = -p.uz * 0.07, oz = p.ux * 0.07, ox2 = -q.uz * 0.07, oz2 = q.ux * 0.07;
        flat(Gl, [a[0] - ox, a[1] - oz], [c[0] - ox2, c[1] - oz2], [c[0] + ox2, c[1] + oz2], [a[0] + ox, a[1] + oz], PAINTY);
      }
    }
    for (let sa = 5; sa < len - 3; sa += 13) {
      const i = P.findIndex((p) => p.s >= sa);
      if (i < 0 || Math.abs(sa - W.s) < 4) continue;
      const p = P[i], fx = p.tx, fz = p.tz, rx = -fz, rz = fx;
      const at = (f, r) => [p.x + fx * f + rx * r, p.z + fz * f + rz * r];
      if (!ok(...at(-1, 0)) || !ok(...at(1.4, 0))) continue;
      flat(Gl, at(-1.1, -0.13), at(0.5, -0.13), at(0.5, 0.13), at(-1.1, 0.13), PAINT);
      const h0 = at(0.5, -0.45), h1 = at(0.5, 0.45), h2 = at(1.45, 0);
      Gl.tri([h0[0], T(h0[0], h0[1]) + 0.05, h0[1]], [h1[0], T(h1[0], h1[1]) + 0.05, h1[1]], [h2[0], T(h2[0], h2[1]) + 0.05, h2[1]], UP, PAINT);
    }
    { const rx = -W.tz, rz = W.tx, fx = W.tx * 2.4, fz = W.tz * 2.4;
      const a = [W.x + fx - rx * 1.6, W.z + fz - rz * 1.6], c = [W.x + fx + rx * 1.6, W.z + fz + rz * 1.6];
      if (ok(...a) && ok(...c)) flat(Gl, [a[0] - W.tx * 0.15, a[1] - W.tz * 0.15], [c[0] - W.tx * 0.15, c[1] - W.tz * 0.15], [c[0] + W.tx * 0.15, c[1] + W.tz * 0.15], [a[0] + W.tx * 0.15, a[1] + W.tz * 0.15], PAINT); }
    // the menu board ~16 m before the window and the speaker post at it, on the driver's side
    let menu = null;
    for (const back of [16, 13, 19, 10]) {
      const sm = W.s - back;
      if (sm < 2.5) continue;
      const i = P.findIndex((p) => p.s >= sm), p = P[i];
      const lx = p.tz, lz = -p.tx;                         // the driver's left
      const mx = p.x + lx * 2.7, mz = p.z + lz * 2.7;
      if (inside(mx, mz, 0.8) || city.onRoad(mx, mz, 1.2, true)) continue;
      menu = { x: mx, z: mz, s: p.s, nx: -lx, nz: -lz, px: p.x, pz: p.z };
      break;
    }
    if (menu) {
      const { x: mx, z: mz, nx, nz } = menu, y0 = T(mx, mz), rot = rotOf(nx, nz), ux = nz, uz = -nx;
      const B2 = Gb(b.x, b.z), Wd = 2.3, Hh = 1.6, yb = y0 + 0.85;
      for (const s2 of [-1, 1]) B2.box(mx + ux * s2 * (Wd / 2 - 0.15), y0 - 0.3, mz + uz * s2 * (Wd / 2 - 0.15), 0.16, 1.2, 0.16, rot, FRAME);
      B2.box(mx, yb, mz, Wd + 0.16, Hh + 0.16, 0.3, rot, BLACK);
      B2.box(mx, yb + Hh + 0.08, mz, Wd + 0.3, 0.32, 0.4, rot, band);
      // the lit menu: four columns of photos and prices, brighter than the board
      const panel = (t0, t1, y1, y2, col) => B2.quad([mx + nx * 0.16 + ux * t0, y1, mz + nz * 0.16 + uz * t0], [mx + nx * 0.16 + ux * t1, y1, mz + nz * 0.16 + uz * t1],
        [mx + nx * 0.16 + ux * t1, y2, mz + nz * 0.16 + uz * t1], [mx + nx * 0.16 + ux * t0, y2, mz + nz * 0.16 + uz * t0], [nx, 0, nz], U0, col);
      panel(-Wd / 2 + 0.06, Wd / 2 - 0.06, yb + 0.06, yb + Hh - 0.06, lin('#2b2b2b'));
      const pcs = [lin('#f2e7d0'), lin('#d9a441'), lin('#c8573a'), lin('#efe9df')];
      for (let c = 0; c < 4; c++) for (let r = 0; r < 3; r++) {
        const t0 = -Wd / 2 + 0.12 + c * ((Wd - 0.24) / 4), t1 = t0 + (Wd - 0.24) / 4 - 0.07;
        const y1 = yb + 0.12 + r * ((Hh - 0.24) / 3), y2 = y1 + (Hh - 0.24) / 3 - 0.08;
        B2.quad([mx + nx * 0.17 + ux * t0, y1, mz + nz * 0.17 + uz * t0], [mx + nx * 0.17 + ux * t1, y1, mz + nz * 0.17 + uz * t1],
          [mx + nx * 0.17 + ux * t1, y2, mz + nz * 0.17 + uz * t1], [mx + nx * 0.17 + ux * t0, y2, mz + nz * 0.17 + uz * t0], [nx, 0, nz], U0, shade(pcs[(c + r * 3 + (k ? k.length : 0)) % 4], 1.6));
      }
      solid({ x: mx, z: mz, hw: Wd / 2 + 0.1, hd: 0.25, rot, y0: y0 - 2, y1: yb + Hh + 0.3 });
      // the speaker post just past the board, its little canopy in the band's colour
      const i = P.findIndex((p) => p.s >= menu.s + 3.2), p = P[Math.max(0, i)];
      const sx = p.x + p.tz * 2.1, sz = p.z - p.tx * 2.1;
      if (!inside(sx, sz, 0.5) && !city.onRoad(sx, sz, 0.8, true)) {
        const sy = T(sx, sz);
        B2.box(sx, sy - 0.3, sz, 0.14, 1.55, 0.14, rot, FRAME);
        B2.box(sx, sy + 0.95, sz, 0.42, 0.55, 0.3, rot, BLACK);
        B2.box(sx, sy + 2.3, sz, 1.1, 0.12, 1.1, rot, band);
        B2.box(sx - nx * 0.4, sy - 0.3, sz - nz * 0.4, 0.1, 2.7, 0.1, rot, FRAME);
        solid({ x: sx, z: sz, r: 0.3, y0: sy - 2, y1: sy + 2.4 });
      }
    }
    // DRIVE THRU at the lane's start, on a small sign to the driver's right
    const dtc = TX.cell('DRIVE THRU', 22);
    if (dtc) {
      const p = P[Math.min(P.length - 1, 2)], rx = -p.tz, rz = p.tx;
      const qx = p.x + rx * 2.6, qz = p.z + rz * 2.6;
      if (!inside(qx, qz, 0.8) && !city.onRoad(qx, qz, 0.8, true) && key(qx, qz) === key(b.x, b.z)) {
        const y0 = T(qx, qz), nx = -p.tx, nz = -p.tz, rot = rotOf(nx, nz), bgc = look.band;
        const B2 = Gb(b.x, b.z);
        B2.box(qx, y0 - 0.3, qz, 0.12, 1.6, 0.12, rot, STEEL);
        B2.box(qx, y0 + 1.25, qz, 1.5, 0.5, 0.12, rot, lin(bgc));
        letter(Lb(qx, qz), dtc, '#ffffff', bgc, qx + nx * 0.07, y0 + 1.5, qz + nz * 0.07, nx, nz, 1.36, 0.36);
        solid({ x: qx, z: qz, r: 0.2, y0: y0 - 2, y1: y0 + 1.8 });
      }
    }
    stats.lanes = (stats.lanes || 0) + 1;
    // for drivethru.js: the lane every 1.5 m (x, z, s), the window and the menu
    const pts = new Float32Array(P.length * 3);
    P.forEach((p, i) => { pts[i * 3] = p.x; pts[i * 3 + 1] = p.z; pts[i * 3 + 2] = p.s; });
    return { k, who, tims: k === 'tims' || /Tim Horton/.test(who), pts, len, sW: W.s, sM: menu ? menu.s : null,
      x: W.x, z: W.z, wall: [wx, wz], face, tw, b };
  };
  const frontBld = (b, sh, F) => {
    const kind = sh.kind, who = (F && F[4]) || '';
    const st = stats.fronts || (stats.fronts = {});
    st[kind] = (st[kind] || 0) + 1;
    if (kind === 'f') {
      const k = B[who] ? who : null;
      const kk = k || (/Tim Horton/.test(who) ? 'tims' : '');
      const look = FOOD_LOOK[kk] || chainLook(who);
      const g = pad(b, look);
      const { fr, fi, gy, Bd } = g;
      padSilhouette(g, kk);
      // a side's windows; the drive-through window where OSM's lane passes the pad (else the other side) under its canopy
      const [s1, s2] = fr.sides(fi);
      const dt = F[6] ? driveLane(b, fr, fi, F[6], gy, look, kk, who) : null;
      if (dt) dts.push(dt);
      const l1 = fr.F[s1].len / 2;
      if (l1 > 2.5 && !(dt && dt.face === s1)) fr.rect(Bd, s1, -l1 + 1.2, l1 - 1.2, gy + 0.8, gy + 2.9, 0.06, GLASS);
      if (!dt) {
        fr.rect(Bd, s2, -0.8, 0.8, gy + 0.9, gy + 2.2, 0.07, GLASS);
        fr.box(Bd, s2, 0, 0.6, 3.2, 1.2, gy + 2.6, 0.25, lin(look.band));
      }
      // a brand's pylon at the road (store() signs its fascia); a pad with no logo here its lettered one
      // (in the pad's own cluster: a pylon over the line would start a cluster, a draw, of its own)
      let sp = roadSpot(b.x, b.z, 70);
      if (sp && key(sp.x, sp.z) !== key(b.x, b.z)) sp = null;
      if (sp && k && B[k].fmt === 'food') pylonAt(k, sp.x, sp.z, sp.yaw);
      else if (sp && !k && who && !/Tim Horton/.test(who)) textPylon(who, sp.x, sp.z, sp.yaw);
      return;
    }
    if (kind === 'b') {
      const look = BANK_LOOK[who] || { wall: '#d6d1c4', band: chainCol(who)[0], accent: '#3a3f45' };
      pad(b, Object.assign({ base: '#6d6a64', pier: '#bfb8a8' }, look), { glassTop: 3.1 });
      return;
    }
    if (kind === 'k') {
      const br = B[who];
      const c3 = br && br.canopy ? br.canopy : ['#e8e6e1', '#3a3f45', '#3a3f45'];
      const band = c3[1] === '#ffffff' ? c3[0] : c3[1];
      const { fr, fi, L, gy } = pad(b, { wall: c3[0] === '#ffffff' ? '#ecebe7' : c3[0], band, accent: c3[2], base: '#6f6a62' });
      if (br) {
        // the station's logo at one end of the kiosk's fascia (the convenience store's name signs the rest)
        const c = A.logo(who);
        if (c) {
          const lh = 0.95, lw = Math.min(lh * c.a, L * 0.4), t = L / 2 - lw / 2 - 0.6;
          const [x, , z] = fr.P(fi, t, 0, 1.9), N = fr.N(fi);
          if (t - lw / 2 > -L / 2 + 0.4) { putLogo(who, x, gy + 3.82, z, N[0], N[2], lw, lh); fasciaUse(b, x, z, lw); }
        }
      }
      return;
    }
    if (kind === 'a') {
      const col = chainCol(who);
      const fi = b.kw.strip.face, fr = frameOf(b), L = fr.F[fi].len, Bd = Gb(b.x, b.z), h = L / 2;
      const { gy, top } = shell(Bd, b, fr, fi, { wall: '#d2cfc8', base: '#7a766f', cap: '#4a4e53', roof: '#8d9297' }, { par: 0.7, maxUnits: 2, noPiers: true });
      // the office's glass at one end, the bays across the rest
      const off = Math.min(5, L * 0.3);
      fr.rect(Bd, fi, -h + 0.5, -h + off, gy + 0.5, gy + 2.9, 0.06, GLASS);
      fr.rect(Bd, fi, -h + off - 1.6, -h + off - 0.6, gy, gy + 2.3, 0.08, shade(GLASS, 0.6));
      const n = Math.max(1, Math.min(5, Math.floor((L - off - 1) / 4.2)));
      const pitch = (L - off - 1.2) / n;
      for (let i = 0; i < n; i++) {
        const t = -h + off + 0.6 + pitch * (i + 0.5);
        fr.rect(Bd, fi, t - 1.6, t + 1.6, gy, gy + 3.2, 0.06, BAYDOOR);
        fr.rect(Bd, fi, t - 1.45, t + 1.45, gy + 1.9, gy + 2.3, 0.08, GLASS);
        for (let y = gy + 0.5; y < gy + 3.1; y += 0.55) fr.rect(Bd, fi, t - 1.6, t + 1.6, y, y + 0.04, 0.08, shade(BAYDOOR, 0.8));
      }
      // the sign band over the doors, flat on the wall (sh.sy / sh.so: where its lettering goes)
      fr.rect(Bd, fi, -h, h, gy + 3.45, Math.min(gy + 4.75, top - 0.05), 0.12, lin(col[0]));
      sh.sy = 4.1; sh.so = 0.2;
      return;
    }
    if (kind === 'c') { dealer(b, F); return; }
    stripBld(b);
  };
  // a pad's own name on a pylon by the road: a cabinet in its colour on two posts
  const textPylon = (name, x, z, yaw) => {
    const [bgc, fg] = chainCol(name);
    const c = TX.cell(name, 22);
    if (!c) return;
    const y0 = T(x, z), nx = Math.sin(yaw), nz = Math.cos(yaw), rot = rotOf(nx, nz), ux = nz, uz = -nx;
    const lh = 1.0, lw = Math.min(4.2, lh * c.a), ph = 5.0;
    const Bd = Gb(x, z);
    for (const s of [-1, 1]) Bd.box(x + ux * s * (lw / 2 - 0.25), y0 - 0.5, z + uz * s * (lw / 2 - 0.25), 0.22, ph + 0.5, 0.22, rot, STEEL);
    Bd.box(x, y0 + ph, z, lw + 0.3, lh + 0.3, 0.4, rot, lin(bgc));
    for (const s of [1, -1]) TX.quad(A, Lb(x, z), c, fg, bgc, x + nx * s * 0.205, y0 + ph + 0.15 + lh / 2, z + nz * s * 0.205, nx * s, nz * s, lw, lh);
    solid({ x, z, r: 0.4, y0: y0 - 2, y1: y0 + ph + lh });
    stats.pylons++;
  };
  const dealer = (b, F) => {
    const name = (F && F[3][0] && F[3][0][0]) || '', make = makeOf((F && F[4]) || name, name);
    const fi = b.kw.strip.face, fr = frameOf(b), L = fr.F[fi].len, Bd = Gb(b.x, b.z), h = L / 2, N = fr.N(fi);
    const { gy, top, pt } = shell(Bd, b, fr, fi, { wall: '#d9dbdc', base: '#5d6166', cap: '#9ea3a8', roof: '#cfd0cf' }, { par: 0.9, maxUnits: 6, noPiers: true });
    // the make's portal at one end of the front, the showroom's glass across the rest
    const PW = Math.max(5, Math.min(10, L * 0.24));
    const tp = h - PW / 2 - Math.min(3, L * 0.06);
    const g0 = -h + 0.8, g1 = tp - PW / 2 - 0.4, gt = Math.min(top - 1.6, gy + 5.2);
    if (g1 - g0 > 3) {
      fr.rect(Bd, fi, g0, g1, gy + 0.2, gt, 0.06, GLASS);
      const nm = Math.max(1, Math.round((g1 - g0) / 3));
      for (let i = 0; i <= nm; i++) { const t = g0 + ((g1 - g0) * i) / nm; fr.rect(Bd, fi, t - 0.07, t + 0.07, gy + 0.2, gt, 0.1, FRAME); }
      fr.rect(Bd, fi, g0, g1, gy + 2.85, gy + 2.97, 0.1, FRAME);
    }
    const ph = pt - gy + 1.6;
    fr.box(Bd, fi, tp, 1.0, PW, 2.0, gy - 0.5, ph + 0.5, lin(make.c));
    fr.rect(Bd, fi, tp - 1.6, tp + 1.6, gy, gy + 3.0, 2.02, shade(GLASS, 0.7));
    solid(fr.solid(fi, tp, 1.0, PW, 2.0, gy - 2, gy + ph));
    // the make, lettered high on the portal; the dealer's own name along the parapet over the glass
    const [mx, , mz] = fr.P(fi, tp, 0, 2.04);
    letter(Lb(mx, mz), TX.cell(make.t, 40), make.fg, make.c, mx, gy + ph - 1.3, mz, N[0], N[2], PW - 0.8, 1.5);
    if (name && name.toUpperCase() !== make.t && g1 - g0 > 6) {
      const tm = (g0 + g1) / 2, [nx2, , nz2] = fr.P(fi, tm, 0, 0.16);
      const y1 = Math.min(top + 0.6, gt + 2.0);
      fr.rect(Bd, fi, g0, g1, gt + 0.15, y1, 0.1, lin('#3a3f45'));
      letter(Lb(nx2, nz2), TX.cell(name, 32), '#ffffff', '#3a3f45', nx2, (gt + 0.15 + y1) / 2, nz2, N[0], N[2], g1 - g0 - 1, Math.min(1.3, y1 - gt - 0.4));
    }
    // the service bays on the side away from the portal
    const se = fr.end(fi, -1), SL = fr.F[se].len, tF = cornerT(fr, fi, se), dir = -Math.sign(tF);
    const n = Math.max(1, Math.min(4, Math.floor((SL - 6) / 5)));
    for (let i = 0; i < n; i++) {
      const t = tF + dir * (4.5 + i * 5);
      fr.rect(Bd, se, t - 1.9, t + 1.9, gy, gy + 4.2, 0.06, BAYDOOR);
      fr.rect(Bd, se, t - 1.7, t + 1.7, gy + 2.6, gy + 3.1, 0.08, GLASS);
    }
  };

  // --- the country's own stores
  // A farm market, a nursery's shop, a meat or cheese shop, a bakery out on the concession
  // roads: board-and-batten walls (barn red, white or weathered), a steel gable over the
  // long axis (green, red, galvanised or charcoal), a porch on posts along the storefront
  // under a shed roof, the glass and the doors under it, crates of produce out front, the
  // name on the wall over the porch (the independents' lettering, sh.sy / sh.so) and on a
  // board on two posts by the road.
  const MK_WALL = ['#8e2b22', '#ece8de', '#7d6c55', '#9b3a2a', '#e4dccb'];
  const MK_ROOF = ['#3d5e3a', '#7d2420', '#9aa0a3', '#3a3c3e', '#9aa0a3'];
  const farmMarket = (b, F) => {
    const sh = b.kw.shop, fi = b.kw.strip.face, fr = frameOf(b), L = fr.F[fi].len, h = L / 2, Bd = Gb(b.x, b.z);
    const hv = (k) => hashI(b.x * 0.37 + k, b.z * 0.21 - k);
    const wc = lin(MK_WALL[Math.floor(hv(1) * MK_WALL.length)]), rc = lin(MK_ROOF[Math.floor(hv(2) * MK_ROOF.length)]);
    const trim = wc[0] + wc[1] + wc[2] > 1.5 ? lin('#2f4a33') : lin('#efeae0');
    const gy = b.y, yb = gy - 2.2, eave = b.y + b.h;
    // the walls, the battens on them, a stone or block base
    for (let fj = 0; fj < 4; fj++) {
      const hs = fr.F[fj].len / 2;
      fr.rect(Bd, fj, -hs, hs, yb, eave, 0, [shade(wc, 0.8), shade(wc, 0.8), wc, wc]);
      fr.rect(Bd, fj, -hs, hs, yb, gy + 0.5, 0.04, lin('#8c877e'));
      for (let t = -hs + 0.35; t < hs; t += 0.6) fr.rect(Bd, fj, t - 0.035, t + 0.035, gy + 0.5, eave - 0.05, 0.03, shade(wc, 0.78));
      for (const sg of [-1, 1]) fr.rect(Bd, fj, sg * hs - 0.12, sg * hs + 0.12, gy + 0.5, eave, 0.05, trim);
    }
    // the gable: the ridge along the long axis
    const alongW = b.w >= b.d, span = alongW ? b.d : b.w, run = alongW ? b.w : b.d;
    const rise = Math.min(4.2, span * 0.42), ov = 0.5;
    const ridge = eave + rise;
    const W = (a, c) => (alongW ? fr.W(a, c) : fr.W(c, a));   // a along the ridge, c across it
    const P3 = (a, c, y) => { const [x, z] = W(a, c); return [x, y, z]; };
    const R = run / 2 + ov, S2 = span / 2 + ov, yE = eave - ov * (rise / (span / 2));
    for (const sg of [-1, 1]) {
      const [nx, nz] = (() => { const [x1, z1] = W(0, sg), [x0, z0] = W(0, 0); return [x1 - x0, z1 - z0]; })();
      const n = nrm(nx * rise, span / 2, nz * rise);
      Bd.quad(P3(-R, sg * S2, yE), P3(R, sg * S2, yE), P3(R, 0, ridge + 0.02), P3(-R, 0, ridge + 0.02), n, U0, rc);
      // the steel's ribs, every ~0.9 m down the slope
      for (let a = -R + 0.45; a < R; a += 0.9) Bd.quad(P3(a - 0.04, sg * S2, yE + 0.03), P3(a + 0.04, sg * S2, yE + 0.03), P3(a + 0.04, 0, ridge + 0.05), P3(a - 0.04, 0, ridge + 0.05), n, U0, shade(rc, 0.8));
      // the soffit under the overhang
      Bd.quad(P3(-R, sg * S2, yE - 0.01), P3(R, sg * S2, yE - 0.01), P3(R, sg * span / 2, eave - 0.01), P3(-R, sg * span / 2, eave - 0.01), [0, -1, 0], U0, shade(wc, 0.6));
      // the gable end's triangle, and its trim
      const [ax, az] = W(sg, 0), [ox, oz] = W(0, 0), en = [ax - ox, 0, az - oz];
      Bd.tri(P3(sg * run / 2, -span / 2, eave), P3(sg * run / 2, span / 2, eave), P3(sg * run / 2, 0, ridge), en, wc);
      Bd.tri(P3(sg * run / 2, -span / 2, eave), P3(sg * run / 2, span / 2, eave), P3(sg * run / 2, 0, ridge), [-en[0], 0, -en[2]], shade(wc, 0.7));
      // a loft window up the gable
      const [lx, lz] = W(sg * (run / 2 + 0.04), 0);
      Bd.box(lx, eave + rise * 0.25, lz, 0.9, Math.min(1.3, rise * 0.5), 0.9, b.rot, GLASS);
    }
    // the ridge cap
    { const [x0, z0] = W(-R, 0), [x1, z1] = W(R, 0); Bd.box((x0 + x1) / 2, ridge - 0.02, (z0 + z1) / 2, alongW ? 2 * R : 0.32, 0.12, alongW ? 0.32 : 2 * R, b.rot, shade(rc, 0.85)); }
    // the porch along the storefront: posts every ~3 m, a shed roof falling 2.4 m out
    const pD = 2.4, y0 = gy + 3.25, y1 = gy + 2.75;
    const N = fr.N(fi);
    Bd.quad(fr.P(fi, -h, y0, 0.05), fr.P(fi, h, y0, 0.05), fr.P(fi, h, y1, pD), fr.P(fi, -h, y1, pD), nrm(N[0] * 0.5, pD, N[2] * 0.5), U0, rc);
    Bd.quad(fr.P(fi, -h, y0 - 0.12, 0.05), fr.P(fi, h, y0 - 0.12, 0.05), fr.P(fi, h, y1 - 0.12, pD), fr.P(fi, -h, y1 - 0.12, pD), [0, -1, 0], U0, SOFFIT);
    fr.rect(Bd, fi, -h, h, y1 - 0.3, y1, pD, trim);
    const np = Math.max(2, Math.round(L / 3.2));
    for (let i = 0; i <= np; i++) {
      const t = -h + 0.3 + ((L - 0.6) * i) / np;
      fr.box(Bd, fi, t, pD - 0.15, 0.18, 0.18, gy - 0.3, y1 - gy + 0.3, trim, { top: false });
      const [x, , z] = fr.P(fi, t, 0, pD - 0.15);
      solid({ x, z, r: 0.15, y0: gy - 2, y1: y1 });
    }
    // the porch deck, the glass and the doors under it
    fr.box(Bd, fi, 0, pD / 2, L, pD, gy - 0.4, 0.55, lin('#8a7258'));
    const nw = Math.max(1, Math.floor((L - 4) / 3.2));
    for (let i = 0; i < nw; i++) {
      const t = -h + 2 + (i + 0.5) * ((L - 4) / nw);
      if (Math.abs(t) < 1.4) continue;
      fr.rect(Bd, fi, t - 0.75, t + 0.75, gy + 0.95, gy + 2.45, 0.06, GLASS);
      fr.rect(Bd, fi, t - 0.85, t + 0.85, gy + 0.85, gy + 2.55, 0.05, trim);
    }
    fr.rect(Bd, fi, -0.95, 0.95, gy + 0.15, gy + 2.45, 0.07, shade(GLASS, 0.7));
    fr.rect(Bd, fi, -1.05, 1.05, gy + 0.15, gy + 2.55, 0.06, trim);
    // crates and bins of what is in season out front (October: pumpkins, squash, apples)
    const CROP = [lin('#d9651a'), lin('#e8a33a'), lin('#9c1f1a'), lin('#6c8a2e')];
    for (const [t, k] of [[-h + 1.6, 0], [h - 1.6, 1], [-h + 3.4, 2], [h - 3.4, 3]]) {
      if (L < 9 && k > 1) continue;
      const [x, , z] = fr.P(fi, t, 0, pD + 0.9);
      if (city.onRoad(x, z, 0.8, true)) continue;
      const g2 = T(x, z);
      fr.box(Bd, fi, t, pD + 0.9, 1.1, 0.8, g2 - 0.1, 0.65, lin('#9a7a52'));
      fr.box(Bd, fi, t, pD + 0.9, 0.95, 0.65, g2 + 0.55, 0.16, CROP[k]);
    }
    sh.sy = 3.92; sh.so = 0.12;   // its name: on the wall over the porch roof (the independents' loop)
    // the board by the road
    const nm = (F && F[3][0] && F[3][0][0]) || (F && F[4]) || '';
    const sp = roadSpot(b.x, b.z, 60);
    if (sp && nm) woodBoard(nm, sp.x, sp.z, sp.yaw);
    stats.markets = (stats.markets || 0) + 1;
  };
  /** A name on a painted board on two wooden posts: a farm's sign at its lane. */
  const woodBoard = (name, x, z, yaw) => {
    const c = TX.cell(name, 22);
    if (!c) return;
    const y0 = T(x, z), nx = Math.sin(yaw), nz = Math.cos(yaw), rot = rotOf(nx, nz), ux = nz, uz = -nx;
    const lh = 0.6, lw = Math.min(3.0, lh * c.a), ph = 1.3, bgc = '#2f4a33';
    const Bd = Gb(x, z), post = lin('#6e5a40');
    for (const s2 of [-1, 1]) Bd.box(x + ux * s2 * (lw / 2 + 0.1), y0 - 0.4, z + uz * s2 * (lw / 2 + 0.1), 0.14, ph + lh + 0.7, 0.14, rot, post);
    Bd.box(x, y0 + ph, z, lw + 0.4, lh + 0.3, 0.08, rot, lin(bgc));
    for (const s2 of [1, -1]) TX.quad(A, Lb(x, z), c, '#f3ead2', bgc, x + nx * s2 * 0.045, y0 + ph + 0.15 + lh / 2, z + nz * s2 * 0.045, nx * s2, nz * s2, lw, lh);
    solid({ x, z, hw: lw / 2 + 0.2, hd: 0.1, rot, y0: y0 - 2, y1: y0 + ph + lh });
    stats.boards = (stats.boards || 0) + 1;
  };
  /** A store in a farm building farmstead.js draws: its name on a board on the street face, and by the road. */
  const farmSign = (b, sg, F) => {
    const nm = (F && F[3][0] && F[3][0][0]) || (F && F[4] && !B[F[4]] ? F[4] : '') || '';
    if (!nm) return;
    const fr = frameOf(b), fi = sg.face, L = fr.F[fi].len, N = fr.N(fi);
    const c = TX.cell(nm, 22);
    if (c) {
      const lh = Math.min(1.0, (L - 2) / c.a), lw = lh * c.a;
      if (lh >= 0.45) {
        // beside the barn's big doors (the middle of its face), not over them
        const y = b.y + Math.min(3.6, b.h * 0.5);
        const room = L / 2 - lw / 2 - 0.8, ts = Math.max(0, Math.min(room, Math.max(lw / 2 + 3, L / 4))) * (hashI(b.x, b.z) < 0.5 ? -1 : 1);
        const [x, , z] = fr.P(fi, ts, 0, 0.3);
        const Bd = Gb(b.x, b.z), bgc = '#2f4a33';
        fr.box(Bd, fi, ts, 0.27, lw + 0.5, 0.1, y - lh / 2 - 0.2, lh + 0.4, lin('#efeae0'));
        fr.box(Bd, fi, ts, 0.29, lw + 0.3, 0.1, y - lh / 2 - 0.1, lh + 0.2, lin(bgc));
        TX.quad(A, Lb(x, z), c, '#f3ead2', bgc, x + N[0] * 0.05, y, z + N[2] * 0.05, N[0], N[2], lw, lh);
        stats.farmSigns = (stats.farmSigns || 0) + 1;
      }
    }
    const sp = roadSpot(b.x, b.z, 70);
    if (sp) woodBoard(nm, sp.x, sp.z, sp.yaw);
  };

  for (const b of city.buildings) {
    const sh = b.kw && b.kw.shop;
    if (!sh || sh.fmt !== 'strip') continue;
    curKey = sh.rk || null;
    if (sh.front === undefined) stripBld(b);
    else if (sh.market) farmMarket(b, S.fronts[sh.front]);
    else frontBld(b, sh, S.fronts[sh.front]);
    curKey = null;
    if (sh.rk) stats.rural = (stats.rural || 0) + 1;
  }
  // a store in a farm building farmstead.js draws (prepShops b.kw.sign): a sign board on its
  // street face, and its name on a board on two posts by the road
  for (const b of city.buildings) {
    const sg = b.kw && b.kw.sign;
    if (!sg) continue;
    curKey = sg.rk || null;
    farmSign(b, sg, S.fronts[sg.front]);
    curKey = null;
  }

  // --- a store on its building
  const store = (k, x, z, bx, bz) => {
    const br = B[k];
    let b = bx !== null ? boxAt(city, bx, bz, 3) : null;
    if (b && b.kw && b.kw.skip && !b.kw.shop) { stats.skipped++; return null; }      // a place kwplaces.js draws itself
    if (b && b.kw && b.kw.shop && (b.kw.shop.fmt === 'bigbox' || b.kw.shop.fmt === 'unit')) {
      if (b.kw.shop.k !== k || b.kw.shop.done) {
        // another brand's store inside a big box (the LCBO beside the Zehrs, the
        // bank and the Subway in the Sobeys' row): its sign and storefront on the
        // front, once the box is drawn
        if (b.kw.shop.fmt === 'bigbox' && b.kw.shop.k !== k) { tenants.push({ k, x, z, b }); return { x, z, later: true }; }
        return null;
      }
      b.kw.shop.done = true;
      return b.kw.shop.fmt === 'bigbox' ? bigBox(b, k) : unit(b, k);
    }
    if (!b && bx === null) {
      // OSM has the store and no building: a small one of our own facing the street
      const rd = faceRoad(city, x, z, 90);
      if (!rd || city.onRoad(x, z, 9, true) || boxAt(city, x, z, 9)) return null;
      const yaw = rd.yaw, nx = Math.sin(yaw), nz = Math.cos(yaw), rot = rotOf(nx, nz);
      const W = 15, D = 11, H = 5.2, y0 = T(x, z);
      const Bd = Gb(x, z);
      Bd.box(x, y0 - 1.5, z, W, H + 1.5, D, rot, lin('#cfc6b4'), { ao: 0.2 });
      Bd.box(x, y0 + H - 1.3, z, W + 0.3, 1.3, D + 0.3, rot, lin(br.band || '#444444'));
      Bd.box(x, y0 + H, z, W + 0.5, 0.3, D + 0.5, rot, lin('#4a4846'));
      const gx = x + nx * (D / 2 + 0.03), gz = z + nz * (D / 2 + 0.03);
      Bd.box(gx, y0, gz, W * 0.7, 2.7, 0.06, rot, GLASS, { top: false });
      putLogo(k, x + nx * (D / 2 + 0.2), y0 + H - 0.65, z + nz * (D / 2 + 0.2), nx, nz, W * 0.7, 1.15);
      solid({ x, z, hw: W / 2, hd: D / 2, rot, y0: y0 - 2, y1: y0 + H + 0.3 });
      if (br.fmt === 'food') { const sp = roadSpot(x, z); if (sp) pylonAt(k, sp.x, sp.z, sp.yaw); }
      stats.built++;
      return { x, z, door: { x: x + nx * (D / 2 + 1.5), z: z + nz * (D / 2 + 1.5) } };
    }
    if (!b) return null;
    const P = b.kw && b.kw.poly;
    const area = P ? Math.abs(polyArea(P.pts)) : b.w * b.d;
    // the face, the wall point and the ground in front
    let f, top;
    if (P) {
      const pf = polyFace(P, x, z);
      if (!pf) return null;
      f = { x: pf.x, z: pf.z, nx: pf.nx, nz: pf.nz, len: pf.len, strip: P.retail, t: pf.t, ax: pf.ax, az: pf.az, ux: pf.ux, uz: pf.uz };
      top = T(b.x, b.z) + P.h;
    } else {
      if (b.h < 2.5) return null;
      const big = B[k].fmt === 'big' || B[k].fmt === 'groc';
      f = faceFor(city, b, x, z, big ? 20 : 6, !(b.kw && b.kw.strip) && area < 1500);
      if (!f) return null;
      top = b.y + b.h;
    }
    const gy = P ? T(f.x + f.nx * 2, f.z + f.nz * 2) : b.y;
    const nx = f.nx, nz = f.nz, ux = nz, uz = -nx, rot = rotOf(nx, nz);
    // keep the sign on the face (polyFace's t runs from its corner; faceFor already clamped)
    let sx = f.x, sz = f.z;
    const fit = (wid) => {
      if (!P) return;
      const t = Math.max(wid / 2 + 0.3, Math.min(f.len - wid / 2 - 0.3, f.t));
      sx = f.ax + f.ux * t; sz = f.az + f.uz * t;
    };
    const res = { x: sx, z: sz };
    const fmt = br.fmt;
    if ((fmt === 'big' || fmt === 'groc' || fmt === 'lcbo') && area > 2200 && br.portal && f.len > 18 && top - gy > 3) {
      // the entrance portal: a raised block in the brand's colour, the logo high on it
      const W = Math.min(f.len * 0.32, fmt === 'big' ? 24 : 18, f.len - 2), D = 2.7;
      fit(W);
      const Hh = Math.max(top - gy + 2.6, 8.6);
      const cx = sx + nx * (D / 2 - 0.3), cz = sz + nz * (D / 2 - 0.3);
      const Bd = Gb(cx, cz);
      Bd.box(cx, gy - 0.6, cz, W, Hh + 0.6, D, rot, lin(br.portal));
      Bd.box(cx, gy + Hh - 0.7, cz, W + 0.3, 0.7, D + 0.3, rot, lin(br.trim));
      // the doors: glass under a canopy, and the trim line over them
      const fx = sx + nx * (D - 0.27), fz = sz + nz * (D - 0.27);
      Bd.box(fx, gy - 0.3, fz, W * 0.62, 3.5, 0.06, rot, GLASS, { top: false });
      Bd.box(fx + nx * 0.9, gy + 3.5, fz + nz * 0.9, W * 0.7, 0.35, 1.8, rot, lin(br.trim));
      const lh = Math.min(fmt === 'big' ? 3.4 : 2.6, Hh - 5.3);
      putLogo(k, fx + nx * 0.06, gy + 4.2 + (Hh - 4.9) / 2, fz + nz * 0.06, nx, nz, W - 1.2, lh);
      solid({ x: cx, z: cz, hw: W / 2, hd: D / 2, rot, y0: gy - 2, y1: gy + Hh });
      res.x = fx + nx; res.z = fz + nz;
      stats.portals++;
    } else if (br.style === 'stripes') {
      // Costco: the red and blue lines along the whole front, the sign on the wall
      const L = f.len - 0.4;
      fit(Math.min(16, L));
      const mx = P ? sx : f.x, mz = P ? sz : f.z;
      const Bd = Gb(mx, mz);
      const yb = top - 2.2;
      if (!P) {
        // centre the stripes on the face: f is the sign spot, not the face's centre
        const [lx] = [(b.x - mx) * ux + (b.z - mz) * uz];
        const ccx = mx + ux * lx, ccz = mz + uz * lx;
        Bd.box(ccx + nx * 0.1, yb, ccz + nz * 0.1, L, 0.45, 0.2, rot, lin('#e31837'), { top: false });
        Bd.box(ccx + nx * 0.1, yb - 0.7, ccz + nz * 0.1, L, 0.45, 0.2, rot, lin('#005daa'), { top: false });
      }
      putLogo(k, mx + nx * 0.25, yb - 2.6, mz + nz * 0.25, nx, nz, Math.min(18, L), 3.4);
      stats.walls++;
    } else if (f.strip) {
      // on the strip's fascia (world._stripMall / kw.js meshPoly: 1.8 m out, 3.2-4.45 m up)
      // (a pad's one sign fills its canopy band)
      const pad1 = b.kw.shop && b.kw.shop.kind && b.kw.shop.kind !== 's';
      const lh = fmt === 'groc' || fmt === 'big' || pad1 ? 1.12 : 1.0;
      const lw = Math.min(lh * (A.logo(k) || { a: 3 }).a, f.len - 0.8, 9);
      fit(lw);
      putLogo(k, sx + nx * 1.9, gy + 3.82, sz + nz * 1.9, nx, nz, lw, lh);
      fasciaUse(b, sx, sz, lw);
      stats.fascia++;
    } else {
      // a wall sign; a store standing alone (an LCBO, a Beer Store, a bank) has its colour band
      const alone = area < 1600;
      const lh = Math.min(fmt === 'lcbo' ? 1.9 : 1.4, top - gy - 1.2);
      if (lh < 0.6) return null;
      const lw = Math.min(lh * (A.logo(k) || { a: 3 }).a, f.len - 1);
      fit(lw);
      const y = Math.min(top - lh / 2 - 0.35, gy + 3.9);
      if (alone && br.band) {
        const bw = Math.min(f.len - 0.2, Math.max(lw + 2, f.len * (fmt === 'lcbo' ? 1 : 0.6)));
        const Bd = Gb(sx, sz);
        // centred on the sign (it clamps on the face) but kept on it
        Bd.box(sx + nx * 0.12, y - lh / 2 - 0.3, sz + nz * 0.12, bw, lh + 0.6, 0.22, rot, lin(br.band));
      }
      putLogo(k, sx + nx * 0.26, y, sz + nz * 0.26, nx, nz, lw, lh);
      stats.walls++;
      if (fmt === 'food' && area < 700) { const sp = roadSpot(sx, sz); if (sp) pylonAt(k, sp.x, sp.z, sp.yaw); }
    }
    res.door = { x: sx + nx * 2.2, z: sz + nz * 2.2 };
    return res;
  };

  // what hangs on each plaza storefront's fascia already: [t0, t1] along it.
  // A storefront: a strip box's arcade face, or one wall of a store kw.js
  // draws from its outline (its own fascia, the same 1.8 m out, 3.2-4.45 m up)
  function boxFront(b) {
    const fr = frameOf(b), fi = b.kw.strip.face, L = fr.F[fi].len, N = fr.N(fi);
    const sh = b.kw.shop || {};
    // sy / so: where a sign's centre is, up from the floor and out from the wall (the fascia's face, else a flat band's)
    return { key: b, lo: -L / 2, hi: L / 2, nx: N[0], nz: N[2], y: b.y, sy: sh.sy || 3.82, so: sh.so || 1.9, one: !!sh.kind && sh.kind !== 's',
      tOf: (x, z) => fr.tOf(fi, x, z), at: (t, o) => { const p = fr.P(fi, t, 0, o); return [p[0], p[2]]; } };
  }
  function polyFront(f) {
    return { key: f.ax.toFixed(1) + ',' + f.az.toFixed(1), lo: 0, hi: f.len, nx: f.nx, nz: f.nz, y: T(f.x + f.nx * 2, f.z + f.nz * 2), sy: 3.82, so: 1.9,
      tOf: (x, z) => (x - f.ax) * f.ux + (z - f.az) * f.uz, at: (t, o) => [f.ax + f.ux * t + f.nx * o, f.az + f.uz * t + f.nz * o] };
  }
  function fasciaUse(b, x, z, w) {
    let sf = null;
    if (b.kw && b.kw.shop && b.kw.shop.fmt === 'strip' && b.kw.strip) sf = boxFront(b);
    else if (b.kw && b.kw.poly && b.kw.poly.retail) { const f = polyFace(b.kw.poly, x, z); if (f) sf = polyFront(f); }
    if (!sf) return;
    const t = sf.tOf(x, z);
    let u = fascia.get(sf.key);
    if (!u) fascia.set(sf.key, (u = []));
    u.push([t - w / 2 - 0.3, t + w / 2 + 0.3]);
  }
  {
    // kw.js's Tim Hortons and FreshCo signs (drawn later, from the same spots)
    const K = kwData();
    for (const [list, w] of [[K && K.tims, 5.2], [K && K.freshco, 9]]) for (const [x, z] of list || []) { const b = boxAt(city, x, z, 3); if (b) fasciaUse(b, x, z, w); }
  }
  const tenants = [];
  for (const [k, x, z, bx, bz, pi, addr, name] of S.stores) {
    const br = B[k];
    if (!br) continue;
    const r = br.fmt === 'gas' ? gas(k, x, z, bx, bz) : store(k, x, z, bx, bz);
    stats.stores++;
    const o = { k, x: r ? r.x : x, z: r ? r.z : z, addr, name, plaza: pi, drawn: !!r };
    if (r && r.later) tenants[tenants.length - 1].r = o;
    out.push(o);
  }

  // a marked building whose store matched a different box still gets drawn
  for (const b of city.buildings) {
    const sh = b.kw && b.kw.shop;
    if (!sh || sh.done || (sh.fmt !== 'bigbox' && sh.fmt !== 'unit')) continue;
    sh.done = true;
    if (sh.fmt === 'bigbox') bigBox(b, sh.k); else unit(b, sh.k);
  }

  // the tenants of the big boxes' rows: each a glass storefront and its lit sign
  // in its band, on the anchor's front where the store is (shifted clear of the
  // portal and of each other), the sign board under the parapet's accent band
  for (const tn of tenants) {
    const { k, x, z, b } = tn, sh = b.kw.shop, br = B[k];
    tn.r.drawn = false;
    if (sh.front === undefined) continue;
    const c = A.logo(k);
    if (!c) continue;
    const fr = frameOf(b), fi = sh.front, L = fr.F[fi].len, gy = sh.gy;
    const lh = br.fmt === 'groc' || br.fmt === 'big' || br.fmt === 'lcbo' ? 1.5 : 1.15;
    const lw = Math.min(lh * c.a, 9);
    const half = lw / 2 + 0.6;
    const want = fr.tOf(fi, x, z);
    // the free spot nearest where the store really is
    let t = null;
    for (let d = 0; d < L; d += 1.5) {
      for (const sg of d ? [1, -1] : [1]) {
        const c0 = want + sg * d;
        if (Math.abs(c0) + half > L / 2 - 1.5) continue;
        if (sh.used.some(([a, b2]) => c0 + half > a && c0 - half < b2)) continue;
        t = c0; break;
      }
      if (t !== null) break;
    }
    if (t === null) continue;
    sh.used.push([t - half - 0.4, t + half + 0.4]);
    const Bd = Gb(b.x, b.z), N = fr.N(fi);
    const ys = Math.min(sh.top - 2.2, gy + 5.4);
    // the sign band, the logo on it
    // (out past the piers' faces, 0.35 m, so a pier never cuts a sign)
    fr.box(Bd, fi, t, 0.21, 2 * half, 0.42, ys - lh / 2 - 0.25, lh + 0.5, lin(br.band || '#2a2c30'));
    const [sx, sy, sz] = fr.P(fi, t, ys, 0.46);
    putLogo(k, sx, sy, sz, N[0], N[2], lw, lh);
    // the storefront: glass, mullions, the door, a canopy
    fr.rect(Bd, fi, t - half, t + half, gy + 0.3, gy + 3.2, 0.07, GLASS);
    for (let q = t - half; q <= t + half + 0.01; q += Math.max(1.5, (2 * half) / Math.round(2 * half / 2.4))) fr.rect(Bd, fi, q - 0.06, q + 0.06, gy + 0.3, gy + 3.2, 0.1, FRAME);
    fr.rect(Bd, fi, t - 0.9, t + 0.9, gy, gy + 2.5, 0.11, shade(GLASS, 0.6));
    fr.box(Bd, fi, t, 0.9, 2 * half, 1.8, gy + 3.3, 0.3, lin(br.band && br.band !== '#ffffff' ? br.band : '#3a3f45'));
    const [dx, , dz] = fr.P(fi, t, 0, 2.4);
    tn.r.x = dx; tn.r.z = dz; tn.r.drawn = true;
    stats.tenants = (stats.tenants || 0) + 1;
  }


  // --- the plazas' pylons
  const pylons = [];
  for (const P of S.plazas || []) {
    if (!P.ten || P.ten.length < 3) continue;
    const o = P.o, n = o.length;
    // sample the outline; the best spot is nearest an arterial
    const cand = [];
    for (let i = 0; i < n; i++) {
      const a = o[i], b = o[(i + 1) % n];
      const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
      for (let t = 4; t < L - 4; t += 10) {
        const x = a[0] + ((b[0] - a[0]) * t) / L, z = a[1] + ((b[1] - a[1]) * t) / L;
        const rd = faceRoad(city, x, z, 45);
        if (!rd) continue;
        const e = rd;
        cand.push({ x, z, rd: e, s: rd.d - (rd.hw > 6 ? 12 : rd.hw > 4 ? 5 : 0) });
      }
    }
    cand.sort((p, q) => p.s - q.s);
    const want = (P.ten.length >= 8 || n > 14) ? 2 : 1;
    let placed = 0;
    for (const cd of cand) {
      if (placed >= want) break;
      const rd = cd.rd;
      const back = 4.2;
      const px = rd.qx - Math.sin(rd.yaw) * (rd.hw + back), pz = rd.qz - Math.cos(rd.yaw) * (rd.hw + back);
      if (pylons.some((q) => Math.hypot(q.x - px, q.z - pz) < (q.p === P ? 160 : 30))) continue;
      if (boxAt(city, px, pz, 2.5) || city.onRoad(px, pz, 1.8, true)) continue;
      plazaPylon(P, px, pz, rd.yaw + Math.PI / 2);
      pylons.push({ x: px, z: pz, p: P });
      placed++;
    }
  }
  function plazaPylon(P, x, z, yaw) {
    // each tenant's panel: its logo, else its name lettered
    const ten = [];
    let lettered = 0;
    for (const t of P.ten) {
      if (ten.length >= 6) break;
      const k = brandOf(t);
      if (!k && lettered >= 3) continue;
      const c = k ? A.logo(k) : TX.cell(t, 22);
      if (!k) lettered++;
      if (c) ten.push({ t, k, c });
    }
    const hc = TX.cell(P.n.toUpperCase(), 32, 560);
    if (!hc || ten.length < 2) return;
    const y0 = T(x, z), nx = Math.sin(yaw), nz = Math.cos(yaw), rot = rotOf(nx, nz), ux = nz, uz = -nx;
    const W = 3.6, rowH = 0.78, headH = 1.15, gap = 0.1, leg = 1.6;
    const H = headH + ten.length * (rowH + gap) + 0.3;
    const Bd = Gb(x, z);
    const FRAME = lin('#3b3f45'), CAP = lin('#c9c3b5'), HEAD = '#1d2a3a', ROW = '#2a2c30';
    for (const s of [-1, 1]) Bd.box(x + ux * s * (W / 2 + 0.15), y0 - 0.5, z + uz * s * (W / 2 + 0.15), 0.42, leg + H + 0.9, 0.62, rot, CAP);
    Bd.box(x, y0 + leg, z, W, H, 0.4, rot, FRAME);
    Bd.box(x, y0 + leg + H + 0.4, z, W + 1.0, 0.35, 0.75, rot, CAP);
    let y = y0 + leg + H - 0.15 - headH / 2;
    // a lettered panel: its colour behind, the lettering at its own aspect on it
    const panel = (c, fg, bgc, w, h, pw, ph) => {
      for (const s of [1, -1]) Bd.quad(...rowQuad(x, y, z, nx * s, nz * s, pw, ph, 0.205), [nx * s, 0, nz * s], U0, lin(bgc));
      let lw = w, lh = w / c.a;
      if (lh > h) { lh = h; lw = h * c.a; }
      for (const s of [1, -1]) TX.quad(A, Lb(x, z), c, fg, bgc, x + nx * s * 0.215, y, z + nz * s * 0.215, nx * s, nz * s, lw, lh);
    };
    panel(hc, '#ffffff', HEAD, W - 0.4, headH * 0.62, W - 0.2, headH - 0.1);
    y -= headH / 2 + gap + rowH / 2;
    for (const { k, c } of ten) {
      if (k) {
        const lw = Math.min(W - 0.3, rowH * c.a), lh = lw / c.a;
        for (const s of [1, -1]) Bd.quad(...rowQuad(x, y, z, nx * s, nz * s, W - 0.3, rowH, 0.205), [nx * s, 0, nz * s], U0, lin('#f4f4f2'));
        for (const s of [1, -1]) A.quad(Lb(x, z), c, x + nx * s * 0.215, y, z + nz * s * 0.215, nx * s, nz * s, lw, lh);
      } else panel(c, '#ffffff', ROW, W - 0.5, rowH * 0.8, W - 0.3, rowH);
      y -= rowH + gap;
    }
    solid({ x, z, hw: W / 2 + 0.4, hd: 0.45, rot, y0: y0 - 2, y1: y0 + leg + H + 0.7 });
    stats.plazaPylons++;
  }

  // other modules drawing into these clusters and this atlas (kwhome.js): the
  // same two materials, so what they add costs no draws where kwshops already has some
  for (const fn of SHOP_HOOKS) {
    try { fn({ A, Gb, Lb, ctx, solid, txt, bg, brandOf, logoOf: (k) => A.logo(k) }); } catch (e) { console.warn('kwshops hook: ' + (e.stack || e.message)); }
  }

  // the independents' signs: the plazas' tenants (plaza.sh) on their strips'
  // and outline-drawn stores' fascias, and every storefront's outside the
  // plazas (S.fronts) on its own -- every tenant OSM names with no brand drawn
  // here, outside kw.js's detail zones. Lettering (TextAtlas) in the chain's
  // colours, else a pair by name; each at the free spot on its fascia nearest
  // where the store really is (a pad's one tenant: the middle).
  {
    const rows = [];
    (S.plazas || []).forEach((P, pi) => (P.sh || []).forEach((r, i) => rows.push([i, pi, -1, ...r])));
    (S.fronts || []).forEach((F, fi) => { if (F[2] !== 'c') F[3].forEach((r, i) => rows.push([i, -1, fi, ...r])); });
    rows.sort((a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2]);
    let signed = 0, noRoom = 0, noFront = 0, plazaSigned = 0;
    const miss = [];
    const plazaPoly = (o) => o.kw.poly.pts;
    for (const [i, pi, fi, nm, x, z] of rows) {
      // a plaza's: the plaza building it is in, else the nearest one -- one of
      // its strips, or a store kw.js draws from its outline (an L- or U-shaped
      // plaza); a storefront's: its own building, else a store drawn from its outline
      let sf = null, bd = 30;
      for (const o of city.buildingsNear(x, z, 90)) {
        const sh = o.kw && o.kw.shop;
        if (sh && sh.fmt === 'strip' && o.kw.strip && (pi >= 0 ? sh.plaza === pi : sh.front === fi)) {
          const dx = x - o.x, dz = z - o.z, c = Math.cos(o.rot), sn = Math.sin(o.rot);
          const lx = Math.abs(dx * c + dz * sn) - o.w / 2, lz = Math.abs(-dx * sn + dz * c) - o.d / 2;
          const d = pi >= 0 ? Math.hypot(Math.max(0, lx), Math.max(0, lz)) : -1;
          if (d < bd) { bd = d; sf = boxFront(o); }
        } else if (o.kw && o.kw.poly && o.kw.poly.retail && !o.kw.skip && !o.kw.shop) {
          // (an L's centroid can lie outside it and outside the plaza: the tenant's 30 m decides)
          const f = polyFace(o.kw.poly, x, z);
          if (!f) continue;
          const d = inPoly(plazaPoly(o), x, z) ? 0 : Math.hypot(x - f.x, z - f.z);
          if (d < bd) { bd = d; sf = polyFront(f); }
        }
      }
      if (!sf) { noFront++; if (pi >= 0) miss.push(nm + "@" + Math.round(x) + "," + Math.round(z) + ":front"); continue; }
      const c = TX.cell(nm, 22);
      if (!c) break;      // the lettering is full: the rest go unsigned
      const room = sf.hi - sf.lo - 1.2;
      let lh = sf.one ? 1.0 : 0.92, lw = lh * c.a;
      if (lw > Math.min(9, room)) { lw = Math.min(9, room); lh = lw / c.a; }
      if (lh < 0.5) { noRoom++; if (pi >= 0) miss.push(nm + ":small"); continue; }
      let u = fascia.get(sf.key);
      if (!u) fascia.set(sf.key, (u = []));
      const want = sf.one && i === 0 ? (sf.lo + sf.hi) / 2 : sf.tOf(x, z);
      // the free spot nearest the store; a full fascia (a long row of small
      // units) takes its last names smaller, two-thirds size, packed closer
      let t = null, half = 0;
      for (const k of [1, 0.66]) {
        half = (lw * k) / 2 + 0.3 * k;
        for (let d = 0; d < sf.hi - sf.lo && t === null; d += 0.5) {
          for (const sg of d ? [1, -1] : [1]) {
            const c0 = want + sg * d;
            if (c0 - half < sf.lo + 0.4 || c0 + half > sf.hi - 0.4 || u.some(([a, b2]) => c0 + half > a && c0 - half < b2)) continue;
            t = c0; break;
          }
        }
        if (t !== null) { lw *= k; lh *= k; break; }
      }
      if (t === null) { noRoom++; if (pi >= 0) miss.push(nm + "@" + Math.round(x) + "," + Math.round(z) + ":full"); continue; }
      const [bgc, fg] = chainCol(nm);
      u.push([t - half, t + half]);
      const [px, pz] = sf.at(t, sf.so);
      TX.quad(A, Lb(px, pz), c, fg, bgc, px, sf.y + sf.sy, pz, sf.nx, sf.nz, lw, lh);
      signed++; if (pi >= 0) plazaSigned++;
    }
    stats.independents = { signed, noRoom, noFront, of: rows.length, plaza: [plazaSigned, rows.filter((q) => q[1] >= 0).length], miss };
  }


  const mat = A.finish(TX);
  const pm = polyMat();
  for (const [k, Bd] of geo) {
    if (Bd.empty) continue;
    const g = new THREE.Group();
    g.add(new THREE.Mesh(Bd.build(), pm));
    addTo(k, g);
  }
  for (const [k, Bd] of logo) {
    if (Bd.empty) continue;
    const g = new THREE.Group();
    g.add(new THREE.Mesh(Bd.build(), mat));
    addTo(k, g);
  }
  // GPU bytes with mips: the logos' RGBA atlas and the lettering's R8 one
  stats.atlas = { h: A.c.height, cells: A.cells.size, full: A.full, mb: +(A.bytes / 1048576).toFixed(1),
    text: { h: TX.H || 0, cells: TX.cells.size, full: TX.full, colours: TX.fg.length, mb: +(TX.bytes / 1048576).toFixed(1) } };
  stats.tris = 0;
  for (const m of [geo, logo]) for (const Bd of m.values()) stats.tris += Bd.idx.length / 3;
  // (build.js mergeByMaterial leaves a mesh of over 60k vertices unmerged: a draw of its own)
  stats.maxVerts = Math.max(0, ...[...geo.values()].map((Bd) => Bd.pos.length / 3));
  S.built = out;
  S.dts = dts;
  S.stats = stats;
  if (typeof window !== "undefined") window.__kwShops = { stats, built: out, atlas: A, dts };
}

/** The four corners of a w x h rectangle centred at (x, y, z) facing (nx, nz), `off` out. */
function rowQuad(x, y, z, nx, nz, w, h, off) {
  const rx = nz, rz = -nx, hw = w / 2, hh = h / 2;
  const cx = x + nx * off, cz = z + nz * off;
  return [[cx - rx * hw, y - hh, cz - rz * hw], [cx + rx * hw, y - hh, cz + rz * hw], [cx + rx * hw, y + hh, cz + rz * hw], [cx - rx * hw, y + hh, cz - rz * hw]];
}

function polyArea(p) {
  let a = 0;
  for (let i = 0; i < p.length; i++) { const j = (i + 1) % p.length; a += p[i][0] * p[j][1] - p[j][0] * p[i][1]; }
  return a / 2;
}

// a tenant's name -> the brand drawn for it (the names build_shops.py matched)
const NAME_KEY = {};
for (const [k, br] of Object.entries(B)) NAME_KEY[br.n.toLowerCase()] = k;
Object.assign(NAME_KEY, {
  'walmart supercentre': 'walmart', 'canadian tire': 'ct', 'the home depot': 'homedepot', rona: 'rona', 'rona+': 'rona', 'td': 'td',
  'rbc': 'rbc', 'rbc royal bank': 'rbc', 'the beer store': 'beer', "montana's bbq & bar": 'montanas', 'popeyes louisiana kitchen': 'popeyes',
  'td canada trust': 'td', 'bmo bank of montreal': 'bmo', 'costco wholesale': 'costco', 'canadian tire gas+': 'ctgas',
  '大統華 t&t supermarket': 'tnt', 't&t': 'tnt', chapters: 'indigo', 'home hardware building centre': 'homehardware', "mark's work wearhouse": 'marks',
});
function brandOf(name) { return NAME_KEY[(name || '').toLowerCase()] || null; }

// --- the map ------------------------------------------------------------------------------

const MAJOR = new Set(['walmart', 'costco', 'ct', 'homedepot', 'rona', 'lcbo', 'beer', 'bestbuy']);
const KIND = { lcbo: 'lcbo', beer: 'beer' };
export function shopPlaces() {
  if (!S || !S.built) return [];
  const out = [];
  for (const s of S.built) {
    if (!MAJOR.has(s.k)) continue;
    const br = B[s.k];
    out.push({ x: s.x, z: s.z, kind: KIND[s.k] || 'shop', name: br.n, near: false, foot: true,
      hello: `${s.name && s.name !== br.n && !/^the /i.test(s.name) ? s.name : br.n}${s.addr ? `, ${s.addr}` : ''}` });
  }
  for (const P of S.plazas || []) {
    if (!P.ten || P.ten.length < 4) continue;
    const anchors = P.ten.filter((t) => MAJOR.has(brandOf(t)) || /Zehrs|Sobeys|Food Basics|No Frills|Superstore|Independent|Farm Boy|Longo|T&T/.test(t));
    out.push({ x: P.x, z: P.z, kind: 'plaza', name: P.n, near: false, label: anchors.length ? P.n : false,
      hello: `${P.n} — ${P.ten.slice(0, 6).join(', ')}` });
  }
  return out;
}
export function shopStats() { return S ? S.stats : null; }
/** The fast-food pads' drive-throughs from OSM's lanes (buildShops driveLane): drivethru.js. */
export function driveThrus() { return (S && S.dts) || []; }
