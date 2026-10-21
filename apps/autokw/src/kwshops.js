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
//     entrance listing its real tenants, anchors first.
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
    this.c.width = this.W; this.c.height = 2048;
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
    const h = br.a < 1.8 ? 136 : 96;
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
   * buildings and logos are one material and one draw a cluster.
   */
  finish() {
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
    for (const Bd of this.builders) for (let i = 1; i < Bd.uv.length; i += 2) Bd.uv[i] = 1 + Bd.uv[i] / H;
    this.tex = new THREE.CanvasTexture(this.c);
    this.tex.colorSpace = THREE.SRGBColorSpace;
    this.tex.anisotropy = 8;
    const m = polyMat();
    m.map = this.tex;
    m.needsUpdate = true;
    return m;
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
  // every strip building in a named plaza
  (S.plazas || []).forEach((P, pi) => {
    let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    for (const q of P.o) { x0 = Math.min(x0, q[0]); x1 = Math.max(x1, q[0]); z0 = Math.min(z0, q[1]); z1 = Math.max(z1, q[1]); }
    const rad = Math.hypot(x1 - x0, z1 - z0) / 2 + 20;
    for (const b of city.buildingsNear((x0 + x1) / 2, (z0 + z1) / 2, rad)) {
      if (!b.kw || !b.kw.strip || !free(b) || !inPoly(P.o, b.x, b.z)) continue;
      b.kw.skip = true;
      b.kw.shop = { fmt: 'strip', plaza: pi };
      r.strips++;
    }
  });
  return r;
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
  const key = (x, z) => 'kwp' + Math.round(x / 1200) + ',' + Math.round(z / 1200);
  const geo = new Map(), logo = new Map();
  const bOf = (m, x, z, uv) => { const k = key(x, z); let b = m.get(k); if (!b) m.set(k, (b = new Builder(uv))); return b; };
  const Gb = (x, z) => bOf(geo, x, z, false);
  const Lb = (x, z) => bOf(logo, x, z, true);
  const stats = { stores: 0, portals: 0, walls: 0, fascia: 0, pylons: 0, built: 0, canopies: 0, osmCanopies: 0, prices: 0, plazaPylons: 0, skipped: 0, solids: 0 };
  const out = [];
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
  const gardenSign = A.text('GARDEN CENTRE', '#ffffff', '#2f6b3a', 236, 46);
  /** On local face fi of frame fr: the t of the corner with face `se`'s outward side. */
  const cornerT = (fr, fi, se) => {
    const nf = fr.F[fi].n, al = fr.F[se].al;
    return (nf[0] * al[0] + nf[1] * al[1]) * fr.F[se].len / 2;
  };
  const roomFor = (b, pts, pad) => pts.every(([x, z]) => !city.onRoad(x, z, pad, true) && (() => { const o = boxAt(city, x, z, 1); return !o || o === b; })());

  /**
   * The storefront of a stand-alone store: the face with the most car park in
   * front of it (a big box's front is its lot; the street usually passes a
   * side or the back), a face right on a street counted down.
   */
  const frontFace = (b, fr) => {
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
  };

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
        A.quad(Lb(gx, gz), gardenSign, gx + Nf[0] * 0.15, gy + 5.6, gz + Nf[2] * 0.15, Nf[0], Nf[2], 5.6, 0.95);
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
    const pi = b.kw.shop.plaza;
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

  for (const b of city.buildings) if (b.kw && b.kw.shop && b.kw.shop.fmt === 'strip') stripBld(b);

  // --- a store on its building
  const store = (k, x, z, bx, bz) => {
    const br = B[k];
    let b = bx !== null ? boxAt(city, bx, bz, 3) : null;
    if (b && b.kw && b.kw.skip && !b.kw.shop) { stats.skipped++; return null; }      // a place kwplaces.js draws itself
    if (b && b.kw && b.kw.shop && (b.kw.shop.fmt === 'bigbox' || b.kw.shop.fmt === 'unit')) {
      if (b.kw.shop.k !== k || b.kw.shop.done) {
        // another brand's store inside a big box (a bank, a Tims): a sign by its door
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
      const lh = fmt === 'groc' || fmt === 'big' ? 1.1 : 1.0;
      const lw = Math.min(lh * (A.logo(k) || { a: 3 }).a, f.len - 0.8, 9);
      fit(lw);
      putLogo(k, sx + nx * 1.9, gy + 3.82, sz + nz * 1.9, nx, nz, lw, lh);
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

  for (const [k, x, z, bx, bz, pi, addr, name] of S.stores) {
    const br = B[k];
    if (!br) continue;
    const r = br.fmt === 'gas' ? gas(k, x, z, bx, bz) : store(k, x, z, bx, bz);
    stats.stores++;
    out.push({ k, x: r ? r.x : x, z: r ? r.z : z, addr, name, plaza: pi, drawn: !!r });
  }

  // a marked building whose store matched a different box still gets drawn
  for (const b of city.buildings) {
    const sh = b.kw && b.kw.shop;
    if (!sh || sh.done || (sh.fmt !== 'bigbox' && sh.fmt !== 'unit')) continue;
    sh.done = true;
    if (sh.fmt === 'bigbox') bigBox(b, sh.k); else unit(b, sh.k);
  }

  // --- the plazas' pylons
  const pylons = [];
  // every plaza's name first: the lettering that must not run out of atlas
  for (const P of S.plazas || []) if (P.ten && P.ten.length >= 3) A.text(P.n.toUpperCase(), '#ffffff', '#1d2a3a', 220, 40);
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
    // each tenant's panel: its logo, else its name lettered (rows the atlas has no room for are left off)
    const ten = [];
    let lettered = 0;
    for (const t of P.ten) {
      if (ten.length >= 6) break;
      const k = brandOf(t);
      if (!k && lettered >= 3) continue;
      const c = k ? A.logo(k) : A.text(t, '#ffffff', '#2a2c30');
      if (!k) lettered++;
      if (c) ten.push({ t, k, c });
    }
    const hc = A.text(P.n.toUpperCase(), '#ffffff', '#1d2a3a', 220, 40);
    if (!hc || ten.length < 2) return;
    const y0 = T(x, z), nx = Math.sin(yaw), nz = Math.cos(yaw), rot = rotOf(nx, nz), ux = nz, uz = -nx;
    const W = 3.6, rowH = 0.78, headH = 1.15, gap = 0.1, leg = 1.6;
    const H = headH + ten.length * (rowH + gap) + 0.3;
    const Bd = Gb(x, z);
    const FRAME = lin('#3b3f45'), CAP = lin('#c9c3b5');
    for (const s of [-1, 1]) Bd.box(x + ux * s * (W / 2 + 0.15), y0 - 0.5, z + uz * s * (W / 2 + 0.15), 0.42, leg + H + 0.9, 0.62, rot, CAP);
    Bd.box(x, y0 + leg, z, W, H, 0.4, rot, FRAME);
    Bd.box(x, y0 + leg + H + 0.4, z, W + 1.0, 0.35, 0.75, rot, CAP);
    let y = y0 + leg + H - 0.15 - headH / 2;
    for (const s of [1, -1]) A.quad(Lb(x, z), hc, x + nx * s * 0.21, y, z + nz * s * 0.21, nx * s, nz * s, W - 0.2, headH - 0.1);
    y -= headH / 2 + gap + rowH / 2;
    for (const { k, c } of ten) {
      let lw = W - 0.3, lh = rowH;
      if (k) { lw = Math.min(W - 0.3, rowH * c.a); lh = lw / c.a; }
      if (k) for (const s of [1, -1]) Bd.quad(...rowQuad(x, y, z, nx * s, nz * s, W - 0.3, rowH, 0.205), [nx * s, 0, nz * s], [0, 0, 0, 0, 0, 0, 0, 0], lin('#f4f4f2'));
      for (const s of [1, -1]) A.quad(Lb(x, z), c, x + nx * s * 0.215, y, z + nz * s * 0.215, nx * s, nz * s, lw, lh);
      y -= rowH + gap;
    }
    solid({ x, z, hw: W / 2 + 0.4, hd: 0.45, rot, y0: y0 - 2, y1: y0 + leg + H + 0.7 });
    stats.plazaPylons++;
  }

  const mat = A.finish();
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
  stats.atlas = { h: A.c.height, cells: A.cells.size, full: A.full };
  stats.tris = 0;
  for (const m of [geo, logo]) for (const Bd of m.values()) stats.tris += Bd.idx.length / 3;
  S.built = out;
  S.stats = stats;
  if (typeof window !== "undefined") window.__kwShops = { stats, built: out, atlas: A };
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
    const anchors = P.ten.filter((t) => MAJOR.has(brandOf(t)) || /Zehrs|Sobeys|Food Basics|No Frills|Superstore/.test(t));
    out.push({ x: P.x, z: P.z, kind: 'plaza', name: P.n, near: false, label: anchors.length ? P.n : false,
      hello: `${P.n} — ${P.ten.slice(0, 6).join(', ')}` });
  }
  return out;
}
export function shopStats() { return S ? S.stats : null; }
