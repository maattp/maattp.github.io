// Hand-built Seattle landmarks. These are always in the scene (no streaming) so
// the Needle is visible from Beacon Hill, the way it should be.
//
// The Space Needle is needle.js. The others are here, built to published
// dimensions where there are any and to the OSM footprint where the plan
// matters (the stadiums, MoPOP, the arena, the Spheres, the Market). The table
// below gives each number and where it came from; "est." means no source
// publishes it and it was set from the ratio or photograph named.
//
// | landmark | what | value | source |
// |---|---|---|---|
// | Great Wheel | overall height | 175 ft = 53.3 m | Wikipedia "Seattle Great Wheel"; observationwheeldirectory.com |
// | | wheel (gondola pivot) diameter | 158 ft = 48.2 m | seeingwashington.com |
// | | gondolas | 42, 8 seats each | Wikipedia; HistoryLink 11051 |
// | | overhang past the pier | ~40 ft = 12 m | Wikipedia; Puget Sound Steel |
// | | hub height | 28.4 m (est.: 53.3 - pivot radius - hanger) | derived |
// | | legs | two A-frames, one each side of the wheel (est., Chance R60 photos) | |
// | Climate Pledge Arena | roof plan | 400 ft square = 122 m | NHL/Kraken "Thiry of Relativity"; PCAD 5972 |
// | | peak | 110 ft = 33.5 m | PCAD |
// | | eaves, mid-side | ~30 ft = 9 m | ENR, "Keeping KeyArena's landmark lid" |
// | | form | 4 trusses, corners to peak, 4 hypar quadrants on 4 corner tripod buttresses | ENR; Kraken |
// | | corner height | 20 m (est., photographs) | |
// | | walls | glazed under the eaves, landmarked, 20 perimeter Y-columns | QA Historical Society; Wikipedia |
// | MoPOP | footprint | 35,000 sq ft; plan from OSM | Wikipedia; OSM way |
// | | height | 85 ft Sky Church ceiling; roofs to ~27 m (est.) | e-architect |
// | | skins | gold, silver, deep red, blue, purple ("Purple Haze") | Wikipedia; WikiArquitectura |
// | | which colour where | est., from photographs | |
// | Spheres | count | 3, largest in the centre | Wikipedia "Amazon Spheres" |
// | | largest | 130 ft = 39.6 m across, 90 ft = 27.4 m tall | Amazon press release 2018; Architectural Record |
// | | the other two | 80 ft = 24.4 m tall; 30 m across (est., from the OSM footprint lobes) | |
// | | frame | pentagonal hexecontahedron, 60 faces a sphere, white steel | Amazon PR |
// | Lumen Field | roof | 720 ft = 220 m between the end pylons, covers 70 % of seats | Wikipedia "Lumen Field"; stadium.org |
// | | arches | two tied arches, rise 200 ft = 61 m over the field | Wikipedia |
// | | open end | north, toward downtown; Hawks Nest + scoreboard there | Wikipedia; Stadiums of Pro Football |
// | | colours | salmon concrete, blue roof (2010) | Wikipedia |
// | T-Mobile Park | roof | 3 panels on rails along the N and S sides, parks EAST over the tracks | Wikipedia "T-Mobile Park"; Kiewit |
// | | roof height | top 82 m, underside 66 m, closed | Wikipedia |
// | | field | home plate SW, CF 401 ft NE, LF 331, RF 326, backstop 69 ft | Wikipedia; theshadium.com |
// | Husky Stadium | form | U open east to the lake; roofs over the N and S stands | Wikipedia "Husky Stadium" |
// | | orientation | 18.2 deg south of east | Wikipedia; matches the OSM footprint |
// | Smith Tower | height | 469 ft = 143 m to the pyramid, 484 ft = 148 m spire | Wikipedia "Smith Tower"; HistoryLink 4310 |
// | | floors | 38; base block 22 | Wikipedia |
// | | pyramid | 54.5 x 44 ft = 16.6 x 13.4 m, 70 ft = 21.3 m tall | Dialectrix; Wikipedia |
// | | globe | 8 ft = 2.4 m, lit blue | Wikipedia |
// | | cladding | white terra cotta over two storeys of granite | Wikipedia |
// | Pike Place | sign + clock | 1937, on the roof at Pike St & Pike Place, facing up Pike St | pikeplacemarket.org |
// | | sign position | the OSM "Public Market Clock" node | OSM |
// | | letter / clock sizes | est.: "PUBLIC MARKET" letters 2.2 m, clock 2.6 m | photographs |
// | | Main Arcade | plan from OSM (two ways); ~9 m over Pike Place (est.) | OSM; Wikipedia |
//
// Footprints are OpenStreetMap (ODbL), relative to the landmark's own point.

import * as THREE from './three.js';
import * as G from './geo.js';
import { mergeByMaterial } from './build.js';
import { spaceNeedle, NEEDLE_MATS, needleSolids } from './needle.js';

// --- materials -----------------------------------------------------------------
//
// Physically shaded, shared by colour, so every landmark's pieces fall into a
// handful of merged meshes. IBL is the ambient here (see "Rendering pipeline"),
// so envMapIntensity is the dial for how a surface reads in shade.

const _pc = new Map();
function P(color, rough = 0.85, metal = 0, env = 0.6, extra = null) {
  const key = `${color}|${rough}|${metal}|${env}|${extra ? JSON.stringify(Object.keys(extra)) + (extra.key || '') : ''}`;
  let m = _pc.get(key);
  if (!m) {
    const o = { color, roughness: rough, metalness: metal, envMapIntensity: env };
    if (extra) for (const k of Object.keys(extra)) if (k !== 'key' && k !== 'noShadow') o[k] = extra[k];
    m = new THREE.MeshStandardMaterial(o);
    if (extra && extra.noShadow) m.userData.noShadow = true;
    _pc.set(key, m);
  }
  return m;
}
// Every legacy call site asked for a matte colour.
const M = (c) => P(c, 0.85, 0, 0.55);

// A vertical mirror seen level or from above reflects the IBL's ground half and
// reads as dark paint; fold the reflected ray into the sky (needle.js, world.js).
const IBL_FROM = 'reflectVec = inverseTransformDirection( reflectVec, viewMatrix );';
function skyGlass(m, key) {
  m.onBeforeCompile = (sh) => {
    if (!THREE.ShaderChunk.envmap_physical_pars_fragment.includes(IBL_FROM)) return;
    sh.fragmentShader = sh.fragmentShader.replace('#include <envmap_physical_pars_fragment>',
      THREE.ShaderChunk.envmap_physical_pars_fragment.replace(IBL_FROM,
        `${IBL_FROM}\n\t\t\treflectVec = normalize( vec3( reflectVec.x, abs( reflectVec.y ) * 0.85 + 0.12, reflectVec.z ) );`));
  };
  m.customProgramCacheKey = () => key;
  m.userData.noShadow = true;
  return m;
}

const mat = {
  white: P(0xe9e6df, 0.6, 0.05, 0.6),
  cream: P(0xdcd2bf, 0.85, 0, 0.55),
  concrete: P(0xb4b2ab, 0.9, 0, 0.5),
  darkConcrete: P(0x8f8c85, 0.9, 0, 0.5),
  steel: P(0x9aa2a8, 0.45, 0.6, 0.8),
  darkSteel: P(0x4f575d, 0.55, 0.5, 0.7),
  whiteSteel: P(0xf0efea, 0.5, 0.1, 0.65),
  roofMetal: P(0xc4c8c6, 0.42, 0.55, 0.75),
  glass: skyGlass(new THREE.MeshStandardMaterial({ color: 0x55636b, roughness: 0.08, metalness: 0.5, envMapIntensity: 0.9 }), 'lmGlass'),
  glassSolid: skyGlass(new THREE.MeshStandardMaterial({ color: 0x8fb0bf, roughness: 0.15, metalness: 0.35, envMapIntensity: 0.9 }), 'lmGlassLight'),
  clearGlass: skyGlass(new THREE.MeshStandardMaterial({
    color: 0xd6eaec, roughness: 0.05, metalness: 0.3, envMapIntensity: 1.0,
    transparent: true, opacity: 0.3, depthWrite: false,
  }), 'lmClearGlass'),
  red: M(0xb5342c),
  neonBlue: new THREE.MeshBasicMaterial({ color: 0x4fc3f7 }),
  green: M(0x3f7f4a),
  grass: M(0x76a355),
  rust: P(0x8a5230, 0.8, 0.3, 0.5),
  brick: M(0x9b5b45),
  dark: M(0x3a3f45),
  wood: M(0x8a6b4a),
  wsfGreen: M(0x1c6b52),
  turf: M(0x3f8a3a),
  dirt: M(0x8a6c4a),
  foliage: P(0x3d6b35, 0.95, 0, 0.45),
};
mat.neonBlue.userData.noShadow = true;

// --- signs -----------------------------------------------------------------
//
// Every sign on every landmark is a rectangle of ONE canvas, so the lettering
// in the whole city is one material and, per cluster, one draw.

class SignAtlas {
  constructor() {
    this.c = document.createElement('canvas');
    this.c.width = 2048; this.c.height = 1024;
    this.g = this.c.getContext('2d');
    this.x = 0; this.y = 0; this.row = 0;
    this.tex = new THREE.CanvasTexture(this.c);
    this.tex.colorSpace = THREE.SRGBColorSpace;
    this.tex.anisotropy = 8;
    this.mat = new THREE.MeshBasicMaterial({ map: this.tex, transparent: true, alphaTest: 0.04, side: THREE.DoubleSide, toneMapped: false });
    this.mat.userData.noShadow = true;
  }
  /** Reserve a w x h pixel cell; returns [x, y] in canvas pixels. */
  alloc(w, h) {
    if (this.x + w > this.c.width) { this.x = 0; this.y += this.row + 2; this.row = 0; }
    const at = [this.x, this.y];
    this.x += w + 2; this.row = Math.max(this.row, h);
    return at;
  }
  /** A plane of w x h metres showing whatever `draw(g, W, H)` paints. */
  panel(w, h, px, draw) {
    const W = Math.min(1024, Math.max(32, Math.round(w * px))), H = Math.min(512, Math.max(16, Math.round(h * px)));
    const [x, y] = this.alloc(W, H);
    const g = this.g;
    g.save(); g.translate(x, y);
    g.beginPath(); g.rect(0, 0, W, H); g.clip();
    draw(g, W, H);
    g.restore();
    const geo = new THREE.PlaneGeometry(w, h);
    const uv = geo.attributes.uv;
    const u0 = (x + 0.5) / this.c.width, u1 = (x + W - 0.5) / this.c.width;
    const v0 = 1 - (y + H - 0.5) / this.c.height, v1 = 1 - (y + 0.5) / this.c.height;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) ? u1 : u0, uv.getY(i) ? v1 : v0);
    return new THREE.Mesh(geo, this.mat);
  }
  text(text, w, h, bg, fg, opts = {}) {
    return this.panel(w, h, opts.px || 24, (g, W, H) => {
      if (bg) { g.fillStyle = bg; g.fillRect(0, 0, W, H); } else g.clearRect(0, 0, W, H);
      g.fillStyle = fg;
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      const lines = text.split('\n');
      const fs = (H / lines.length) * (opts.fill || 0.62);
      g.font = `${opts.weight || 700} ${fs}px ${opts.font || 'Helvetica, Arial, sans-serif'}`;
      if (opts.stroke) { g.lineWidth = fs * 0.12; g.strokeStyle = opts.stroke; }
      if (opts.glow) { g.shadowColor = fg; g.shadowBlur = fs * 0.35; }
      lines.forEach((l, i) => {
        const ty = (H / lines.length) * (i + 0.5);
        if (opts.stroke) g.strokeText(l, W / 2, ty, W * 0.96);
        g.fillText(l, W / 2, ty, W * 0.96);
      });
    });
  }
}
let atlas = null;
const sign = (text, w, h, bg, fg, opts) => atlas.text(text, w, h, bg, fg, opts);

// --- textures --------------------------------------------------------------

function canvasTex(W, H, draw, repeat = true) {
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  draw(c.getContext('2d'), W, H);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 8;
  return t;
}

// Seat rows: one tile is one row deep (0.85 m) and one aisle wide (15 m).
let _seatTex = null;
const seatTex = () => _seatTex || (_seatTex = canvasTex(128, 16, (g, W, H) => {
  g.fillStyle = '#e8e8e8'; g.fillRect(0, 0, W, H);
  g.fillStyle = '#9a9a9a'; g.fillRect(0, H - 4, W, 4);
  g.fillStyle = '#5a5a5a'; g.fillRect(0, H - 1, W, 1);
  g.fillStyle = '#c9c9c9'; g.fillRect(0, 0, 3, H);
}));
const seatMats = new Map();
const seats = (color) => {
  let m = seatMats.get(color);
  if (!m) seatMats.set(color, (m = new THREE.MeshStandardMaterial({ color, map: seatTex(), roughness: 0.8, metalness: 0.05, envMapIntensity: 0.5 })));
  return m;
};

// A masonry facade: one tile is one bay (tw) by one storey (th) of windows.
function facadeMat(key, wall, glass, tw, th, winW, winH, opts = {}) {
  let m = _pc.get('fac:' + key);
  if (m) return m;
  const map = canvasTex(128, 128, (g, W, H) => {
    g.fillStyle = wall; g.fillRect(0, 0, W, H);
    // a little weathering
    for (let i = 0; i < 160; i++) {
      g.fillStyle = `rgba(0,0,0,${0.015 + Math.random() * 0.03})`;
      g.fillRect(Math.random() * W, Math.random() * H, 2 + Math.random() * 8, 1 + Math.random() * 3);
    }
    const ww = W * winW / tw, wh = H * winH / th, x0 = (W - ww) / 2, y0 = (H - wh) * 0.42;
    g.fillStyle = opts.frame || 'rgba(0,0,0,0.25)';
    g.fillRect(x0 - 3, y0 - 3, ww + 6, wh + 6);
    const gr = g.createLinearGradient(0, y0, 0, y0 + wh);
    gr.addColorStop(0, glass[0]); gr.addColorStop(1, glass[1]);
    g.fillStyle = gr; g.fillRect(x0, y0, ww, wh);
    g.fillStyle = opts.mullion || wall;
    if (opts.split !== false) g.fillRect(x0 + ww / 2 - 1.5, y0, 3, wh);
    g.fillRect(x0, y0 + wh * 0.62, ww, 3);
    if (opts.band) { g.fillStyle = opts.band; g.fillRect(0, 0, W, 5); }
  });
  m = new THREE.MeshStandardMaterial({ color: 0xffffff, map, roughness: 0.78, metalness: 0.02, envMapIntensity: 0.55 });
  m.userData.tile = [tw, th];
  _pc.set('fac:' + key, m);
  return m;
}

/** A tiling wall material; `tile` is the metres one repeat covers. */
function panelMat(key, tile, draw, rough = 0.85) {
  let m = _pc.get('panel:' + key);
  if (m) return m;
  m = new THREE.MeshStandardMaterial({ color: 0xffffff, map: canvasTex(128, 128, draw), roughness: rough, metalness: 0.02, envMapIntensity: 0.5 });
  m.userData.tile = tile;
  _pc.set('panel:' + key, m);
  return m;
}
// T-Mobile's brick: a running bond, precast bands and an arched opening a bay.
const tmobBrick = () => panelMat('tmob-brick', [9, 13], (g, W, H) => {
  g.fillStyle = '#8b4a3b'; g.fillRect(0, 0, W, H);
  g.fillStyle = 'rgba(40,20,15,0.25)';
  for (let r = 0; r < 32; r++) g.fillRect(0, r * 4 + 3, W, 1);
  for (let r = 0; r < 32; r++) for (let k = 0; k < 8; k++) g.fillRect(k * 16 + (r % 2) * 8, r * 4, 1, 4);
  g.fillStyle = '#cfc6b4'; g.fillRect(0, 0, W, 8); g.fillRect(0, 70, W, 5);
  g.fillStyle = '#1d2226';
  g.beginPath(); g.moveTo(34, 128); g.lineTo(34, 98); g.arc(64, 98, 30, Math.PI, 0); g.lineTo(94, 128); g.fill();
  g.fillStyle = '#2b3338'; g.fillRect(40, 22, 48, 36);
  g.fillStyle = '#cfc6b4'; g.fillRect(62, 22, 4, 36);
});
// Lumen's salmon concrete: panel joints and the concourse openings.
const lumenWall = () => panelMat('lumen-wall', [12, 10], (g, W, H) => {
  g.fillStyle = '#b8917f'; g.fillRect(0, 0, W, H);
  g.fillStyle = 'rgba(60,30,20,0.18)'; g.fillRect(0, 63, W, 2); g.fillRect(63, 0, 2, H);
  g.fillStyle = '#24292d'; g.fillRect(10, 76, 108, 30);
  g.fillStyle = '#9aa6ad'; for (let k = 0; k < 6; k++) g.fillRect(12 + k * 18, 76, 3, 30);
  g.fillStyle = 'rgba(255,255,255,0.08)'; g.fillRect(0, 0, W, 10);
});

// Field paint drawn in WORLD metres: `draw(g)` gets a context whose units are
// the landmark's local x/z, so a yard line is drawn where the yard line is.
function fieldMat(key, bbox, pxPerM, draw) {
  let m = _pc.get('field:' + key);
  if (m) return m;
  const [x0, z0, x1, z1] = bbox;
  const W = Math.min(2048, Math.round((x1 - x0) * pxPerM)), H = Math.min(2048, Math.round((z1 - z0) * pxPerM));
  const map = canvasTex(W, H, (g) => {
    g.scale(W / (x1 - x0), H / (z1 - z0));
    g.translate(-x0, -z0);
    draw(g);
  }, false);
  m = new THREE.MeshStandardMaterial({ map, roughness: 0.92, metalness: 0, envMapIntensity: 0.45 });
  m.userData.bbox = bbox;
  _pc.set('field:' + key, m);
  return m;
}

// --- geometry helpers ------------------------------------------------------

const V = (x, y, z) => new THREE.Vector3(x, y, z);

function box(w, h, d, m, x = 0, y = 0, z = 0, ry = 0) {
  const o = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
  o.position.set(x, y + h / 2, z);
  o.rotation.y = ry;
  return o;
}
function cyl(rt, rb, h, m, x = 0, y = 0, z = 0, seg = 16) {
  const o = new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, seg), m);
  o.position.set(x, y + h / 2, z);
  return o;
}
/** A box whose UVs run in metres over a facade material's tile. */
function tbox(w, h, d, m, x = 0, y = 0, z = 0, ry = 0) {
  const geo = new THREE.BoxGeometry(w, h, d);
  const [tw, th] = (m.userData && m.userData.tile) || [1, 1];
  const uv = geo.attributes.uv;
  const faces = [[d, h], [d, h], [w, d], [w, d], [w, h], [w, h]];
  for (let f = 0; f < 6; f++) {
    const [fu, fv] = faces[f];
    for (let i = f * 4; i < f * 4 + 4; i++) uv.setXY(i, uv.getX(i) * fu / tw, uv.getY(i) * Math.round(fv / th) / 1);
  }
  const o = new THREE.Mesh(geo, m);
  o.position.set(x, y + h / 2, z);
  o.rotation.y = ry;
  return o;
}
/** A box beam between two points. */
function beam(p0, p1, w, h, m) {
  const len = p0.distanceTo(p1);
  const o = new THREE.Mesh(new THREE.BoxGeometry(w, h, len), m);
  o.position.copy(p0).add(p1).multiplyScalar(0.5);
  o.lookAt(p1);
  return o;
}
/** A round member between two points (6 sides unless told otherwise). */
function strut(p0, p1, r, m, seg = 6) {
  const len = p0.distanceTo(p1);
  const geo = new THREE.CylinderGeometry(r, r, len, seg, 1, true);
  geo.rotateX(Math.PI / 2);
  const o = new THREE.Mesh(geo, m);
  o.position.copy(p0).add(p1).multiplyScalar(0.5);
  o.lookAt(p1);
  return o;
}
/** A tube along a polyline of Vector3s. */
function tube(pts, r, m, rs = 6) {
  const curve = new THREE.CatmullRomCurve3(pts, false, 'centripetal');
  return new THREE.Mesh(new THREE.TubeGeometry(curve, Math.max(4, pts.length * 2), r, rs, false), m);
}
/** A prism from a plan polygon [[x, z], ...], from y0 to y1. */
function prism(poly, y0, y1, m) {
  const s = new THREE.Shape(poly.map(([x, z]) => new THREE.Vector2(x, -z)));
  const geo = new THREE.ExtrudeGeometry(s, { depth: y1 - y0, bevelEnabled: false, curveSegments: 1 });
  geo.rotateX(-Math.PI / 2);
  geo.translate(0, y0, 0);
  return new THREE.Mesh(geo, m);
}
/** A flat plan polygon at height y, facing up, UVs from `uvOf(x, z)`. */
function flat(poly, y, m, uvOf) {
  const s = new THREE.Shape(poly.map(([x, z]) => new THREE.Vector2(x, -z)));
  const geo = new THREE.ShapeGeometry(s);
  geo.rotateX(-Math.PI / 2);
  geo.translate(0, y, 0);
  if (uvOf) {
    const p = geo.attributes.position, uv = geo.attributes.uv;
    for (let i = 0; i < p.count; i++) { const [u, v] = uvOf(p.getX(i), p.getZ(i)); uv.setXY(i, u, v); }
  }
  return new THREE.Mesh(geo, m);
}

/**
 * Surface through rows of points: rows[k][i] = [x, y, z]. `closed` wraps
 * each row round. `expect(x, y, z)` returns the direction the surface should
 * face at a point; the whole sheet is flipped if it faces the other way.
 * `uvm` = [uMetres, vMetres]: UVs run in metres along rows (u) and across (v).
 */
function sheet(rows, m, { closed = false, expect = null, uvm = null } = {}) {
  const nr = rows.length, nc = rows[0].length + (closed ? 1 : 0);
  const pos = [], uv = [], idx = [];
  const vAcc = new Array(nc).fill(0);
  for (let k = 0; k < nr; k++) {
    let uAcc = 0;
    for (let i = 0; i < nc; i++) {
      const p = rows[k][i % rows[k].length];
      if (i > 0) { const q = rows[k][(i - 1) % rows[k].length]; uAcc += Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]); }
      if (k > 0) { const q = rows[k - 1][i % rows[k].length]; vAcc[i] += Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]); }
      pos.push(p[0], p[1], p[2]);
      if (uvm) uv.push(uAcc / uvm[0], vAcc[i] / uvm[1]);
      else uv.push(i / (nc - 1), k / Math.max(1, nr - 1));
    }
  }
  for (let k = 0; k < nr - 1; k++) {
    for (let i = 0; i < nc - 1; i++) {
      const a = k * nc + i, b = a + 1, c = a + nc, d = c + 1;
      idx.push(a, c, b, b, c, d);
    }
  }
  if (expect) {
    let score = 0;
    const A = V(), B = V(), C = V(), E = V(), F = V();
    for (let t = 0; t < idx.length; t += 3) {
      A.fromArray(pos, idx[t] * 3); B.fromArray(pos, idx[t + 1] * 3); C.fromArray(pos, idx[t + 2] * 3);
      F.subVectors(B, A).cross(E.subVectors(C, A));
      const e = expect((A.x + B.x + C.x) / 3, (A.y + B.y + C.y) / 3, (A.z + B.z + C.z) / 3);
      score += F.x * e[0] + F.y * e[1] + F.z * e[2];
    }
    if (score < 0) for (let t = 0; t < idx.length; t += 3) { const s = idx[t + 1]; idx[t + 1] = idx[t + 2]; idx[t + 2] = s; }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  return new THREE.Mesh(geo, m);
}
const UP = () => [0, 1, 0];
const OUT = (cx, cz) => (x, y, z) => [x - cx, 0, z - cz];
const IN = (cx, cz) => (x, y, z) => [cx - x, 0, cz - z];

/** Furthest crossing of a ray with a polygon's boundary, or -1. */
function rayPoly(cx, cz, dx, dz, poly) {
  let best = -1;
  for (let i = 0; i < poly.length; i++) {
    const [ax, az] = poly[i], [bx, bz] = poly[(i + 1) % poly.length];
    const ex = bx - ax, ez = bz - az;
    const den = dx * ez - dz * ex;
    if (Math.abs(den) < 1e-9) continue;
    const t = ((ax - cx) * ez - (az - cz) * ex) / den;
    const s = ((ax - cx) * dz - (az - cz) * dx) / den;
    if (t > 0 && s >= -1e-6 && s <= 1 + 1e-6 && t > best) best = t;
  }
  return best;
}
const offsetPoly = (poly, ox, oz) => poly.map(([x, z]) => [x + ox, z + oz]);
function roundRect(cx, cz, hx, hz, r, rot = 0, n = 6) {
  const pts = [];
  const c = Math.cos(rot), s = Math.sin(rot);
  for (const [sx, sz, a0] of [[1, 1, 0], [-1, 1, Math.PI / 2], [-1, -1, Math.PI], [1, -1, Math.PI * 1.5]]) {
    const ox = sx * (hx - r), oz = sz * (hz - r);
    for (let k = 0; k <= n; k++) {
      const a = a0 + (k / n) * Math.PI / 2;
      const x = ox + Math.cos(a) * r, z = oz + Math.sin(a) * r;
      pts.push([cx + x * c - z * s, cz + x * s + z * c]);
    }
  }
  return pts;
}

// --- solids ----------------------------------------------------------------
//
// Colliders go on g.userData.solids in the group's own frame (x, z, and y from
// its base); buildLandmarks turns them into world solids for citygen. Boxes use
// citygen's convention, u = (cos rot, sin rot) with half-extent hw.

function solid(g, s) { (g.userData.solids || (g.userData.solids = [])).push(s); }
const solidCircle = (g, x, z, r, y1, y0 = -2) => solid(g, { x, z, r, y0, y1 });
const solidBox = (g, x, z, hw, hd, rot, y1, y0 = -2) => solid(g, { x, z, hw, hd, rot, y0, y1 });
/** A wall along each edge of a polygon, `t` thick, centred on the edge. */
function solidOutline(g, poly, t, y1) {
  for (let i = 0; i < poly.length; i++) {
    const [ax, az] = poly[i], [bx, bz] = poly[(i + 1) % poly.length];
    const len = Math.hypot(bx - ax, bz - az);
    if (len < 0.5) continue;
    solidBox(g, (ax + bx) / 2, (az + bz) / 2, len / 2 + t / 2, t / 2, Math.atan2(bz - az, bx - ax), y1);
  }
}

// ---------------------------------------------------------------------------
// MoPOP. Gehry's volumes as six skins over the OSM plan, each a lofted blob
// that swells at mid-height and closes in a dome, leaning and twisting a
// little so no two read alike. World-aligned: the plan is in world axes.

// OSM footprint, metres from the POI (world axes).
const MOPOP_PLAN = [[-35.0, -23.2], [-33.4, -17.5], [-26.4, -12.3], [-29.5, 1.7], [-25.9, 15.2], [-30.1, 14.9], [-30.3, 38.8], [-24.9, 48.9], [-18.3, 51.4], [0.6, 52.3], [8.4, 50.1], [10.4, 52.4], [15.2, 52.5], [16.8, 45.5], [21.5, 47.1], [27.2, 41.0], [25.8, 38.3], [28.3, 34.7], [27.2, 27.7], [32.3, 16.1], [34.6, -9.3], [32.7, -11.5], [32.9, -17.5], [36.5, -28.3], [33.8, -39.2], [37.6, -43.5], [29.7, -54.7], [18.0, -56.6], [5.5, -49.4], [-0.3, -38.2], [-17.8, -43.0], [-25.4, -42.1], [-30.2, -39.3]];

// Section stations up a skin: [height fraction, scale]. Walls near vertical
// and flaring a little, then a quick roll-over into a low crown -- a Gehry
// volume is a crumpled sheet, not a balloon.
const BLOB_PROFILE = [[-0.06, 0.93], [0.12, 0.96], [0.35, 1.02], [0.58, 1.07], [0.74, 1.06], [0.85, 0.96], [0.93, 0.76], [0.98, 0.46], [1.0, 0.08]];

function blob(cx, cz, rx, rz, rot, h, m, seed, lean = [0, 0], twist = 0) {
  const N = 40;
  const rows = [];
  const ph = [seed * 1.7, seed * 2.9, seed * 4.1, seed * 0.7];
  const c = Math.cos(rot), s = Math.sin(rot);
  for (const [f, sc] of BLOB_PROFILE) {
    const row = [];
    for (let i = 0; i < N; i++) {
      const a = (i / N) * Math.PI * 2 + twist * f;
      // Plan: an irregular oval with folds that deepen toward the top.
      const rr = 1 + 0.12 * Math.sin(2 * a + ph[0]) + 0.07 * Math.sin(3 * a + ph[1])
        + (0.03 + 0.05 * f) * Math.sin(7 * a + ph[2]);
      // The roofline rises to one side and dips to the other.
      const y = -1 + (h + 1) * f * (1 + 0.16 * Math.sin(a + ph[3]) * Math.max(0, f));
      const lx = Math.cos(a) * rx * rr * sc, lz = Math.sin(a) * rz * rr * sc;
      row.push([cx + lx * c - lz * s + lean[0] * y, y, cz + lx * s + lz * c + lean[1] * y]);
    }
    rows.push(row);
  }
  return sheet(rows, m, { closed: true, expect: (x, y, z) => [x - cx, 0.3, z - cz], uvm: [1.4, 0.7] });
}

// Shingles: the skins are thousands of cut panels, and without them the
// volumes read as inflatables.
let _shingle = null;
const shingleTex = () => _shingle || (_shingle = canvasTex(64, 64, (g, W, H) => {
  g.fillStyle = '#e4e4e4'; g.fillRect(0, 0, W, H);
  for (let r = 0; r < 4; r++) for (let k = 0; k < 2; k++) {
    const v = 200 + Math.floor(Math.random() * 55);
    g.fillStyle = `rgb(${v},${v},${v})`;
    g.fillRect(k * 32 + (r % 2) * 16, r * 16, 31, 15);
  }
  g.fillStyle = 'rgba(0,0,0,0.35)';
  for (let r = 0; r < 4; r++) g.fillRect(0, r * 16 + 15, W, 1);
}));
const skin = (color, rough, metal, env) => {
  let m = _pc.get('skin:' + color);
  if (!m) _pc.set('skin:' + color, (m = new THREE.MeshStandardMaterial({ color, map: shingleTex(), roughness: rough, metalness: metal, envMapIntensity: env })));
  return m;
};

function mopop() {
  const g = new THREE.Group();
  g.userData.worldAligned = true;
  const gold = skin(0xc79c45, 0.4, 0.8, 0.85);
  const silver = skin(0xc5c9cd, 0.36, 0.85, 0.9);
  const red = skin(0x9e2a2f, 0.5, 0.45, 0.7);
  const blue = skin(0x2f5ca3, 0.48, 0.45, 0.7);
  const purple = skin(0x6d4290, 0.42, 0.65, 0.8);
  // [cx, cz, rx, rz, rot, height, skin, lean]
  const LOBES = [
    [-8, -34, 22, 15, 0.35, 21, gold, [0.12, -0.05]],
    [-8, 4, 19, 21, -0.2, 27, silver, [-0.06, 0.04]],
    [-17, 32, 12, 17, 0.45, 18, blue, [-0.1, 0.08]],
    [18, 20, 15, 25, 0.1, 23, red, [0.12, 0.02]],
    [19, -32, 15, 19, -0.4, 19, purple, [0.08, -0.1]],
    [3, 43, 14, 9, 0.8, 13, gold, [0.02, 0.12]],
    [22, -6, 10, 12, 0.3, 15, silver, [0.1, 0]],
  ];
  LOBES.forEach(([cx, cz, rx, rz, rot, h, m, lean], i) => {
    g.add(blob(cx, cz, rx, rz, rot, h, m, i + 1, lean, 0.25 * (i % 2 ? 1 : -1)));
    solidCircle(g, cx, cz, Math.min(rx, rz) * 0.9, h);
  });
  // The ground floor between the skins: dark glazing and a plinth, so the
  // blobs stand on a building rather than on the lawn.
  const core = MOPOP_PLAN.map(([x, z]) => [x * 0.86, z * 0.86]);
  g.add(prism(core, -1, 4.5, mat.glass));
  g.add(prism(MOPOP_PLAN, -1.5, 0.25, mat.concrete));
  return g;
}

// ---------------------------------------------------------------------------
// Climate Pledge Arena: the 1962 roof. A 122 m square whose four trusses run
// from the corner buttresses up to a 33.5 m peak, each quadrant a hypar
// sagging to 9 m at mid-side, over a glazed wall and 20 Y-columns.

const ARENA = { cx: 4.5, cz: 1.0, a: 61, peak: 33.5, corner: 20, eave: 9, wall: 55 };
// The south atrium off Thomas St, from the OSM footprint.
const ARENA_ATRIUM = [[-50.9, 62.6], [-50.9, 82.0], [3.7, 92.4], [58.2, 82.7], [57.9, 63.3]];

function arenaRoofH(u, v) {
  const s = Math.max(Math.abs(u), Math.abs(v));
  if (s < 1e-6) return ARENA.peak;
  const t = Math.abs(u) >= Math.abs(v) ? v / s : u / s;
  const e = ARENA.eave + (ARENA.corner - ARENA.eave) * t * t;
  return ARENA.peak + (e - ARENA.peak) * Math.pow(s, 0.92);
}

function arena() {
  const g = new THREE.Group();
  g.userData.worldAligned = true;
  const { cx, cz, a, wall } = ARENA;
  const N = 24;
  const at = (i, j) => [-1 + (2 * i) / N, -1 + (2 * j) / N];
  const roofRows = (dy) => {
    const rows = [];
    for (let j = 0; j <= N; j++) {
      const row = [];
      for (let i = 0; i <= N; i++) { const [u, v] = at(i, j); row.push([cx + u * a, arenaRoofH(u, v) + dy, cz + v * a]); }
      rows.push(row);
    }
    return rows;
  };
  const roof = P(0xc9ccc8, 0.4, 0.6, 0.8);
  g.add(sheet(roofRows(0), roof, { expect: UP }));
  g.add(sheet(roofRows(-1.3), mat.white, { expect: () => [0, -1, 0] }));
  // Edge beam: the fascia round the eaves.
  const edge = [];
  for (const [i0, j0, di, dj] of [[0, 0, 1, 0], [N, 0, 0, 1], [N, N, -1, 0], [0, N, 0, -1]])
    for (let k = 0; k < N; k++) edge.push(at(i0 + di * k, j0 + dj * k));
  const fasciaTop = edge.map(([u, v]) => [cx + u * a, arenaRoofH(u, v) + 0.15, cz + v * a]);
  const fasciaBot = edge.map(([u, v]) => [cx + u * a, arenaRoofH(u, v) - 1.5, cz + v * a]);
  g.add(sheet([fasciaTop, fasciaBot], P(0x9da3a6, 0.5, 0.5, 0.7), { closed: true, expect: OUT(cx, cz) }));
  // The four trusses read on top as ridges from each corner to the peak.
  for (const [su, sv] of [[1, 1], [-1, 1], [-1, -1], [1, -1]]) {
    const pts = [];
    for (let k = 0; k <= 8; k++) { const f = k / 8; pts.push(V(cx + su * a * f, arenaRoofH(su * f, sv * f) + 0.35, cz + sv * a * f)); }
    g.add(tube(pts, 0.55, mat.whiteSteel, 6));
  }
  // Glazed walls under the eaves, set back to the wall line; mullion fins.
  const wf = wall / a;
  const wallRing = [], wallBot = [];
  for (const [i0, j0, di, dj] of [[0, 0, 1, 0], [N, 0, 0, 1], [N, N, -1, 0], [0, N, 0, -1]]) {
    for (let k = 0; k < N; k++) {
      const [u, v] = at(i0 + di * k, j0 + dj * k);
      wallRing.push([cx + u * wall, arenaRoofH(u * wf, v * wf) - 1.3, cz + v * wall]);
      wallBot.push([cx + u * wall, -1, cz + v * wall]);
    }
  }
  g.add(sheet([wallRing, wallBot], mat.glass, { closed: true, expect: OUT(cx, cz) }));
  for (let k = 0; k < wallRing.length; k++) {
    const [x, y, z] = wallRing[k];
    g.add(beam(V(x, -0.5, z), V(x, y, z), 0.35, 0.9, mat.white));
  }
  // Twenty Y-columns, five a side: a concrete stem that forks under the eave.
  for (let sd = 0; sd < 4; sd++) {
    for (let k = 1; k <= 5; k++) {
      const f = -1 + (2 * k) / 6;
      const [u, v] = [[f, -1], [1, f], [-f, 1], [-1, -f]][sd];
      const x = cx + u * (wall + 1.2), z = cz + v * (wall + 1.2);
      const top = arenaRoofH(u * (wall + 1.2) / a, v * (wall + 1.2) / a) - 1.3;
      const fork = top - 3.2;
      g.add(beam(V(x, -0.5, z), V(x, fork, z), 1.0, 1.0, mat.concrete));
      const tx = sd % 2 ? 0 : 1, tz = 1 - tx;
      for (const s of [-1, 1]) g.add(beam(V(x, fork, z), V(x + tx * s * 2.6, top, z + tz * s * 2.6), 0.7, 0.7, mat.concrete));
      solidCircle(g, x, z, 0.8, fork);
    }
  }
  // Corner tripods: three concrete legs from the ground to each roof corner.
  for (const [su, sv] of [[1, 1], [-1, 1], [-1, -1], [1, -1]]) {
    const top = V(cx + su * a * 0.985, ARENA.corner - 1.2, cz + sv * a * 0.985);
    for (const [fx, fz] of [[a + 8, a - 16], [a - 16, a + 8], [a + 7, a + 7]]) {
      const x = cx + su * fx, z = cz + sv * fz;
      g.add(beam(V(x, -0.8, z), top, 2.2, 2.2, mat.concrete));
      solidCircle(g, x, z, 1.6, 12);
    }
  }
  // Plinth, the south atrium, and the name.
  g.add(box(2 * wall + 8, 1.2, 2 * wall + 8, mat.darkConcrete, cx, -1, cz));
  g.add(prism(ARENA_ATRIUM, -1, 7.5, mat.glass));
  g.add(prism(ARENA_ATRIUM.map(([x, z]) => [x, z]), 7.5, 8.4, mat.white));
  const s = sign('CLIMATE PLEDGE ARENA', 44, 3.4, null, '#f4fbff', { stroke: 'rgba(20,40,50,0.55)' });
  s.position.set(4, 5.2, 92.7);
  g.add(s);
  const s2 = sign('CLIMATE PLEDGE ARENA', 40, 3.2, null, '#f4fbff', { stroke: 'rgba(20,40,50,0.55)' });
  s2.position.set(cx - wall - 0.4, 5.5, cz + 10);
  s2.rotation.y = -Math.PI / 2;
  g.add(s2);
  solidBox(g, cx, cz, wall + 0.5, wall + 0.5, 0, 34);
  solidBox(g, 3.5, 77, 54.5, 14.5, 0, 8.4);
  return g;
}

// ---------------------------------------------------------------------------
// The Spheres. Three truncated spheres on their OSM lobes, each a glass
// shell on a white pentagonal-hexecontahedron frame, full of planting.

const PHI = (1 + Math.sqrt(5)) / 2;
let _hexEdges = null;
/** The 150 edges of a pentagonal hexecontahedron, as pairs of unit vectors. */
function hexecontahedronEdges() {
  if (_hexEdges) return _hexEdges;
  const qmul = (a, b) => [
    a[0] * b[0] - a[1] * b[1] - a[2] * b[2] - a[3] * b[3],
    a[0] * b[1] + a[1] * b[0] + a[2] * b[3] - a[3] * b[2],
    a[0] * b[2] - a[1] * b[3] + a[2] * b[0] + a[3] * b[1],
    a[0] * b[3] + a[1] * b[2] - a[2] * b[1] + a[3] * b[0],
  ];
  const nrm = (v) => { const l = Math.hypot(v[0], v[1], v[2]); return [v[0] / l, v[1] / l, v[2] / l]; };
  const qax = (ax, ang) => { const [x, y, z] = nrm(ax), s = Math.sin(ang / 2); return [Math.cos(ang / 2), x * s, y * s, z * s]; };
  const rot = (q, v) => { const p = qmul(qmul(q, [0, ...v]), [q[0], -q[1], -q[2], -q[3]]); return [p[1], p[2], p[3]]; };
  // The chiral icosahedral group, by closure over a 5-fold and a 3-fold turn.
  const gens = [qax([0, 1, PHI], (2 * Math.PI) / 5), qax([1, 1, 1], (2 * Math.PI) / 3)];
  const grp = [[1, 0, 0, 0]];
  const key = (q) => { const s = q.find((x) => Math.abs(x) > 1e-6) < 0 ? -1 : 1; return q.map((x) => Math.round(x * s * 1e4)).join(','); };
  const seen = new Set([key(grp[0])]);
  for (let i = 0; i < grp.length; i++) for (const gq of gens) {
    const q = qmul(gq, grp[i]), k = key(q);
    if (!seen.has(k)) { seen.add(k); grp.push(q); }
  }
  const d = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
  const orbit = (v) => {
    const pts = [];
    for (const q of grp) { const p = rot(q, v); if (!pts.some((o) => d(o, p) < 1e-5)) pts.push(p); }
    return pts;
  };
  // Vertices: 12 on the 5-fold axes, 20 on the 3-fold, and 60 generic ones
  // (the orbit of one point near a 2-fold axis, twisted -- that is what makes
  // it the chiral Catalan solid). Each generic vertex meets its nearest 5-fold
  // vertex, its nearest 3-fold vertex and its twin: 60 + 60 + 30 = 150 edges.
  const A5 = orbit(nrm([0, 1, PHI])), A3 = orbit(nrm([1, 1, 1]));
  const a = A5[0];
  const nb = A5.filter((p) => p !== a).sort((p, q) => d(a, p) - d(a, q))[0];
  const two = nrm([(a[0] + nb[0]) / 2, (a[1] + nb[1]) / 2, (a[2] + nb[2]) / 2]);
  const e = nrm([nb[0] - a[0], nb[1] - a[1], nb[2] - a[2]]);
  const t = nrm([two[1] * e[2] - two[2] * e[1], two[2] * e[0] - two[0] * e[2], two[0] * e[1] - two[1] * e[0]]);
  const gv = orbit(nrm(two.map((x, i) => x + 0.15 * t[i] + 0.22 * (a[i] - two[i]))));
  const nearest = (p, set, skip) => set.reduce((b, q, j) => (j !== skip && (b < 0 || d(p, q) < d(p, set[b])) ? j : b), -1);
  const edges = [];
  gv.forEach((p, i) => {
    edges.push([p, A5[nearest(p, A5)]], [p, A3[nearest(p, A3)]]);
    const j = nearest(p, gv, i);
    if (j > i) edges.push([p, gv[j]]);
  });
  _hexEdges = edges;
  return edges;
}

// [x, z] of each sphere's centre in plan (world axes, from the OSM lobes),
// its radius and its height above the plaza.
const SPHERES = [[-3, -1, 19.8, 27.4], [-10.5, 17.5, 15.1, 24.4], [19, -15, 15.1, 24.4]];

function spheres() {
  const g = new THREE.Group();
  g.userData.worldAligned = true;
  const edges = hexecontahedronEdges();
  const frame = P(0xf3f2ee, 0.5, 0.15, 0.6);
  SPHERES.forEach(([x, z, R, h], si) => {
    const cy = h - R;
    const thMax = Math.acos(Math.max(-1, Math.min(1, -cy / R)));
    const sh = new THREE.Mesh(new THREE.SphereGeometry(R, 40, 22, 0, Math.PI * 2, 0, thMax), mat.clearGlass);
    sh.position.set(x, cy, z);
    g.add(sh);
    // Planting: a dark, rough mass inside, which is what the glass shows.
    const pl = new THREE.Mesh(new THREE.SphereGeometry(R * 0.8, 16, 10, 0, Math.PI * 2, 0, Math.acos(Math.max(-1, -cy / (R * 0.8)))), mat.foliage);
    pl.position.set(x, cy - 0.5, z);
    g.add(pl);
    // The frame, turned differently on each sphere, clipped at the plaza.
    const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(0.3 + si, si * 1.3, 0.2));
    const A = V(), B = V();
    for (const [p0, p1] of edges) {
      A.set(...p0).applyQuaternion(q); B.set(...p1).applyQuaternion(q);
      const segs = 2;
      let prev = null;
      for (let k = 0; k <= segs; k++) {
        const pt = A.clone().lerp(B, k / segs).normalize().multiplyScalar(R + 0.12).add(V(x, cy, z));
        if (prev && (prev.y > 0.2 || pt.y > 0.2)) {
          const a0 = prev.clone(), a1 = pt.clone();
          if (a0.y < 0.2) a0.lerp(a1, (0.2 - a0.y) / (a1.y - a0.y));
          if (a1.y < 0.2) a1.lerp(a0, (0.2 - a1.y) / (a0.y - a1.y));
          g.add(beam(a0, a1, 0.42, 0.6, frame));
        }
        prev = pt;
      }
    }
    const gr = Math.sqrt(Math.max(0, R * R - cy * cy));
    g.add(cyl(gr + 0.6, gr + 0.9, 1.2, mat.concrete, x, -0.8, z, 32));
    solidCircle(g, x, z, gr, h);
  });
  // The plaza round them.
  g.add(flat(roundRect(3, 0, 42, 40, 10), 0.08, P(0xa8a59e, 0.9, 0, 0.5)));
  return g;
}

// ---------------------------------------------------------------------------
// Pike Place Market: the Public Market Center sign and clock over the Main
// Arcade, at the foot of Pike Street. The group's origin is Pike Place's
// south end, where Pike Street meets it, and y = 0 is the street level there.
//
// The arcade is laid out along Pike Place rather than from its OSM ways:
// those run down the bluff and over Western Avenue, which in the game is a
// street at the foot of it -- the first cut stood a 20 m wall across Western.
// So it is a strip along the west kerb of Pike Place, from 6.5 m off the
// centreline out to 8 m short of Western's pavement (measured with
// city.onRoad along the street), and the bluff drops away behind it.

const MARKET_AT = [-198, 297];           // Pike Place at Pike St (OSM node)
const MARKET_STREET_Y = 33.5;            // Pike Place's surface there
const MARKET_U = [-0.748, -0.664];       // up Pike Place, north-west
const MARKET_W = [-0.664, 0.748];        // off its west kerb, toward the bay
const MARKET_CLOCK = [-9.4, 14.5];       // the OSM "Public Market Clock" node
// [s along Pike Place, outer offset] -- Western Avenue converges to the north.
const ARCADE_EDGE = [[-4, 24], [30, 26], [50, 26], [70, 23.5], [90, 18.5], [102, 15.5]];

function market() {
  const g = new THREE.Group();
  g.userData.worldAligned = true;
  g.userData.at = [MARKET_AT[0], MARKET_AT[1], MARKET_STREET_Y];
  const SO = (s, o) => [MARKET_U[0] * s + MARKET_W[0] * o, MARKET_U[1] * s + MARKET_W[1] * o];
  const wall = facadeMat('market', '#d9ceb5', ['#3c4a52', '#6f7f86'], 4.2, 3.6, 2.4, 2.0, { mullion: '#2f4a3a', band: '#8f836a' });
  const H = 9.5, IN = 6.5;
  // Up the outer side, south to north, and back down the kerb.
  const poly = [SO(-4, IN), SO(-4, 24), ...ARCADE_EDGE.slice(1).map(([s, o]) => SO(s, o)), SO(102, IN)];
  // The bluff: the arcade stands on the street and its lower storeys run
  // down the hill behind, which is why the prism goes to -14 m.
  const m = prism(poly, -14, H, wall);
  const uv = m.geometry.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) / 4.2, uv.getY(i) / 3.6);
  g.add(m);
  const roofTrim = P(0x7f8a7a, 0.7, 0.2, 0.6);
  g.add(prism(poly, H, H + 0.7, roofTrim));
  // The street face: a green canopy over the stalls, white columns under it,
  // the dark market hall behind, and the neon along the fascia.
  const ang = Math.atan2(-MARKET_U[1], MARKET_U[0]);          // box: local x up the street
  const faceN = Math.atan2(-MARKET_W[0], -MARKET_W[1]);       // plane: facing the street
  const L = 106, s0 = -4;
  {
    const [mx, mz] = SO(s0 + L / 2, IN - 1.7);
    g.add(box(L - 1, 0.35, 3.4, P(0x2f5a44, 0.6, 0.3, 0.6), mx, 4.2, mz, ang));
    const [dx, dz] = SO(s0 + L / 2, IN - 0.08);
    g.add(box(L - 2, 3.6, 0.2, P(0x2a2622, 0.9, 0, 0.3), dx, 0.2, dz, ang));
    for (let s = s0 + 2; s < s0 + L - 1; s += 6.5) {
      const [cx, cz] = SO(s, IN - 3.1);
      g.add(box(0.45, 4.2, 0.45, mat.white, cx, 0, cz, ang));
    }
    const fm = sign('FARMERS MARKET', 13, 1.5, '#1c2a24', '#ff4a36', { glow: true });
    const [fx, fz] = SO(16, IN - 0.12);
    fm.position.set(fx, 5.8, fz);
    fm.rotation.y = faceN;
    g.add(fm);
    const mp = sign('MEET THE PRODUCER', 11, 1.2, '#1c2a24', '#ff4a36', { glow: true });
    const [mx2, mz2] = SO(36, IN - 0.12);
    mp.position.set(mx2, 5.8, mz2);
    mp.rotation.y = faceN;
    g.add(mp);
  }
  // The sign faces up Pike Street; the clock stands to its left as you look.
  const f = [0.84, -0.54];                 // toward Pike St
  const side = [0.54, 0.84];               // viewer's left
  const fa = Math.atan2(f[0], f[1]);
  const S0 = [MARKET_CLOCK[0] - side[0] * 9.0, MARKET_CLOCK[1] - side[1] * 9.0];
  const sy = H + 1.2;
  // Steel frame the neon letters are mounted on.
  for (const s of [-7.4, -2.4, 2.4, 7.4]) {
    const x = S0[0] + side[0] * s, z = S0[1] + side[1] * s;
    g.add(beam(V(x, H + 0.6, z), V(x, sy + 5.8, z), 0.2, 0.2, mat.darkSteel));
  }
  g.add(beam(V(S0[0] - side[0] * 8, sy + 3.0, S0[1] - side[1] * 8), V(S0[0] + side[0] * 8, sy + 3.0, S0[1] + side[1] * 8), 0.16, 0.16, mat.darkSteel));
  const pm = sign('PUBLIC MARKET', 16.4, 3.3, null, '#ff2b1c', { glow: true, stroke: '#7a0d06', px: 40, fill: 0.9 });
  pm.position.set(S0[0] + f[0] * 0.25, sy + 4.1, S0[1] + f[1] * 0.25);
  pm.rotation.y = fa;
  g.add(pm);
  const ce = sign('CENTER', 7.3, 2.2, null, '#ff2b1c', { glow: true, stroke: '#7a0d06', px: 40, fill: 0.9 });
  ce.position.set(S0[0] + f[0] * 0.25, sy + 1.4, S0[1] + f[1] * 0.25);
  ce.rotation.y = fa;
  g.add(ce);
  // The clock: a round face on a steel mast, left of the sign.
  const C0 = MARKET_CLOCK;
  const cyy = sy + 6.4;
  g.add(cyl(0.16, 0.2, cyy - H, mat.darkSteel, C0[0], H, C0[1], 8));
  const face = atlas.panel(3.2, 3.2, 64, (c, W, Hh) => {
    const r = W / 2;
    c.clearRect(0, 0, W, Hh);
    c.fillStyle = '#f7ecd0'; c.beginPath(); c.arc(r, r, r * 0.96, 0, Math.PI * 2); c.fill();
    c.strokeStyle = '#1d1d1d'; c.lineWidth = r * 0.08; c.stroke();
    c.fillStyle = '#c4231a'; c.font = `700 ${r * 0.2}px Helvetica, Arial, sans-serif`; c.textAlign = 'center';
    c.fillText('PUBLIC', r, r * 0.62); c.fillText('MARKET', r, r * 1.56);
    c.fillStyle = '#1d1d1d'; c.font = `700 ${r * 0.18}px Georgia, serif`; c.textBaseline = 'middle';
    for (let k = 1; k <= 12; k++) {
      const a = (k / 12) * Math.PI * 2 - Math.PI / 2;
      c.fillText(String(k), r + Math.cos(a) * r * 0.76, r + Math.sin(a) * r * 0.76);
    }
    c.lineCap = 'round';
    const hand = (a, len, w) => { c.lineWidth = w; c.beginPath(); c.moveTo(r, r); c.lineTo(r + Math.cos(a) * len, r + Math.sin(a) * len); c.stroke(); };
    hand(-Math.PI / 2 + 0.2 * Math.PI * 2, r * 0.46, r * 0.07);
    hand(-Math.PI / 2 + 0.75 * Math.PI * 2, r * 0.68, r * 0.045);
  });
  face.position.set(C0[0] + f[0] * 0.2, cyy, C0[1] + f[1] * 0.2);
  face.rotation.y = fa;
  g.add(face);
  const rim = new THREE.Mesh(new THREE.TorusGeometry(1.62, 0.12, 6, 28), mat.darkSteel);
  rim.position.set(C0[0] + f[0] * 0.16, cyy, C0[1] + f[1] * 0.16);
  rim.rotation.y = fa;
  g.add(rim);
  {
    const cg = new THREE.CylinderGeometry(1.62, 1.62, 0.34, 24);
    cg.rotateX(Math.PI / 2);
    const cm = new THREE.Mesh(cg, mat.darkSteel);
    cm.position.set(C0[0], cyy, C0[1]);
    cm.rotation.y = fa;
    g.add(cm);
  }
  // Colliders: the arcade as boxes along the street, each as deep as the
  // strip is there.
  const rot = Math.atan2(MARKET_U[1], MARKET_U[0]);
  for (let k = 0; k < ARCADE_EDGE.length - 1; k++) {
    const [sa, oa] = ARCADE_EDGE[k], [sb, ob] = ARCADE_EDGE[k + 1];
    const o = Math.min(oa, ob);
    const [cx, cz] = SO((sa + sb) / 2, (IN + o) / 2);
    solidBox(g, cx, cz, (sb - sa) / 2, (o - IN) / 2, rot, H);
  }
  return g;
}

// ---------------------------------------------------------------------------
// The Seattle Great Wheel: a Chance R60 at the end of Pier 57. Its plane runs
// along the pier (world x) so the west side hangs out over the bay; axle
// north-south, on two A-frames. y = 0 is the pier deck.

const WHEEL = { R: 24.1, Rp: 24.4, hub: 28.4, n: 42, deck: 2.4 };

function wheel() {
  const g = new THREE.Group();
  g.userData.baseY = WHEEL.deck;
  g.userData.worldAligned = true;
  const { R, Rp, hub, n } = WHEEL;
  const w = mat.whiteSteel;
  const ringPts = (r, z) => {
    const pts = [];
    for (let k = 0; k <= 84; k++) { const a = (k / 84) * Math.PI * 2; pts.push(V(Math.cos(a) * r, hub + Math.sin(a) * r, z)); }
    return pts;
  };
  // Rim: a triangular truss -- two outer rings and one inner, laced.
  for (const z of [-1.1, 1.1]) g.add(new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(ringPts(R, z), true), 84, 0.32, 6, true), w));
  g.add(new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(ringPts(R - 1.9, 0), true), 84, 0.26, 5, true), w));
  const hubZ = 2.6;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2, a2 = ((i + 0.5) / n) * Math.PI * 2;
    const o = (r, aa, z) => V(Math.cos(aa) * r, hub + Math.sin(aa) * r, z);
    g.add(strut(o(R, a, -1.1), o(R - 1.9, a2, 0), 0.12, w, 4));
    g.add(strut(o(R, a, 1.1), o(R - 1.9, a2, 0), 0.12, w, 4));
    g.add(strut(o(R, a, -1.1), o(R, a, 1.1), 0.1, w, 4));
    // Spokes: tension rods from both hub flanges to the rim.
    g.add(strut(o(1.9, a, -hubZ), o(R - 1.9, a, 0), 0.07, w, 3));
    g.add(strut(o(1.9, a2, hubZ), o(R - 1.9, a2, 0), 0.07, w, 3));
    // Gondola: hangs from a pivot just outside the rim.
    const px = Math.cos(a) * Rp, py = hub + Math.sin(a) * Rp;
    g.add(box(0.25, 0.9, 0.25, mat.darkSteel, px, py - 0.9, 0));
    g.add(box(2.3, 2.3, 2.1, mat.glassSolid, px, py - 3.2, 0));
    g.add(box(2.5, 0.35, 2.3, w, px, py - 0.95, 0));
    g.add(box(2.5, 0.3, 2.3, w, px, py - 3.45, 0));
  }
  // Hub and axle.
  const hubM = new THREE.Mesh(new THREE.CylinderGeometry(1.9, 1.9, 2 * hubZ + 0.4, 16), w);
  hubM.rotation.x = Math.PI / 2; hubM.position.set(0, hub, 0);
  g.add(hubM);
  const ax = new THREE.Mesh(new THREE.CylinderGeometry(0.7, 0.7, 9.6, 10), w);
  ax.rotation.x = Math.PI / 2; ax.position.set(0, hub, 0);
  g.add(ax);
  // The A-frames, one each side, their feet splayed along the pier.
  for (const s of [-1, 1]) {
    const top = V(0, hub, s * 4.6);
    for (const fx of [-13.5, 13.5]) {
      g.add(beam(V(fx, -0.2, s * 10.5), top, 1.25, 1.25, w));
      solidCircle(g, fx, s * 10.5, 1.1, 20);
    }
    g.add(beam(V(-9.1, 9.5, s * 8.6), V(9.1, 9.5, s * 8.6), 0.8, 0.8, w));
    g.add(beam(V(-4.6, 19.2, s * 6.6), V(4.6, 19.2, s * 6.6), 0.7, 0.7, w));
  }
  // The deck it stands on, on piles, joining the pier to the east, with the
  // boarding platform and a ticket booth.
  g.add(box(46, 1.2, 36, P(0x857058, 0.9, 0, 0.45), -6, -1.2, 0));
  for (let x = -27; x <= 15; x += 7) for (const z of [-16, -5, 5, 16]) g.add(cyl(0.35, 0.35, 6, mat.darkSteel, x, -7, z, 6));
  g.add(box(10, 1.0, 8, mat.concrete, 0, 0, 0));
  g.add(box(6, 3.2, 4, w, 12, 0, 12));
  g.add(box(6.6, 0.4, 4.6, mat.darkSteel, 12, 3.2, 12));
  const t = sign('SEATTLE GREAT WHEEL', 12, 1.3, '#0f2f4f', '#ffffff');
  t.position.set(15.2, 2.2, 12); t.rotation.y = Math.PI / 2;
  g.add(t);
  solidBox(g, 0, 0, 5, 4, 0, 1.0);
  solidBox(g, 12, 12, 3, 2, 0, 3.2);
  return g;
}

// ---------------------------------------------------------------------------
// Stadium bowls, shared by the three stadiums.
//
// A bowl is lofted between an INNER boundary (the front row) and an OUTER one
// (the OSM footprint) along rays from one centre, through stations of radial
// fraction and height: lower deck, concourse, suites, upper deck, rim, facade.
// `H(dx, dz)` gives the rim height for each ray, which is how an open end or a
// low outfield falls out of the same code.

function bowl(g, { c, inner, outer, n = 96, H, seat, facade, rim = mat.concrete, suites = mat.glass, stations }) {
  const [cx, cz] = c;
  const rays = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const dx = Math.cos(a), dz = Math.sin(a);
    const ti = rayPoly(cx, cz, dx, dz, inner), to = rayPoly(cx, cz, dx, dz, outer);
    if (ti < 0 || to < 0) continue;
    rays.push({ dx, dz, ti, to: Math.max(to, ti + 4), H: H(dx, dz) });
  }
  const ST = stations || [
    [0, 1.2, 0], [0.42, 0, 0.36], [0.46, 0, 0.36], [0.48, 0, 0.46], [0.96, 0, 1], [1, 0, 1], [1, -2, 0],
  ];
  const MAT = [seat, rim, suites, seat, rim, facade];
  const FACE = ['up', 'up', 'in', 'up', 'up', 'out'];
  const row = (k) => rays.map((r) => {
    const [s, a, b] = ST[k];
    const t = r.ti + (r.to - r.ti) * s;
    return [cx + r.dx * t, a + b * r.H, cz + r.dz * t];
  });
  for (let k = 0; k < ST.length - 1; k++) {
    const e = FACE[k] === 'up' ? UP : FACE[k] === 'in' ? IN(cx, cz) : OUT(cx, cz);
    const m = MAT[k];
    const isSeat = m === seat;
    g.add(sheet([row(k), row(k + 1)], m, { closed: true, expect: e, uvm: isSeat ? [15, 0.85] : (m.userData.tile || [4, 4]) }));
  }
  return rays;
}

function footballPaint(endA, endB) {
  return (g) => {
    g.fillStyle = '#3b7a34'; g.fillRect(-80, -50, 160, 100);
    for (let k = -12; k < 12; k++) { g.fillStyle = k % 2 ? '#428a3a' : '#39772f'; g.fillRect(k * 4.572, -24.4, 4.572, 48.8); }
    g.fillStyle = endA; g.fillRect(-54.86, -24.4, 9.144, 48.8);
    g.fillStyle = endB; g.fillRect(45.72, -24.4, 9.144, 48.8);
    g.strokeStyle = '#f4f4f0'; g.lineWidth = 0.18;
    g.strokeRect(-54.86, -24.4, 109.72, 48.8);
    for (let k = -10; k <= 10; k++) { g.beginPath(); g.moveTo(k * 4.572, -24.4); g.lineTo(k * 4.572, 24.4); g.stroke(); }
    g.lineWidth = 0.12;
    for (let k = -50; k <= 50; k++) for (const z of [-3.1, 3.1]) { g.beginPath(); g.moveTo(k * 0.9144, z - 0.3); g.lineTo(k * 0.9144, z + 0.3); g.stroke(); }
  };
}

/** A field plane over `poly` in the landmark's frame, painted by fieldMat. */
function fieldPlane(poly, m, y, xform) {
  const [x0, z0, x1, z1] = m.userData.bbox;
  return flat(poly, y, m, (x, z) => {
    const [fx, fz] = xform ? xform(x, z) : [x, z];
    return [(fx - x0) / (x1 - x0), 1 - (fz - z0) / (z1 - z0)];
  });
}

// ---------------------------------------------------------------------------
// Lumen Field. A U open to the north, the field running north-south, and the
// roof hung under two 220 m tied arches over the east and west stands.

// OSM footprint, metres from its centroid; the centroid is (-2.9, +27.8) from
// the stadium's POI.
const LUMEN_OFF = [-2.9, 27.8];
const LUMEN_PLAN = [[-126.1, -71.3], [-125.6, 50.9], [-106.7, 76.9], [-81.9, 97.5], [-52.8, 111.3], [-37.1, 115.4], [-21.1, 117.6], [11.1, 115.8], [13.1, 109.8], [26.7, 112.0], [56.1, 98.7], [75.8, 83.5], [91.7, 66.3], [99.2, 34.9], [102.9, 2.8], [102.9, -29.5], [99.0, -61.5], [91.4, -92.8], [73.6, -112.6], [51.7, -128.4], [34.9, -136.5], [34.9, -117.6], [26.4, -117.6], [19.4, -138.5], [-41.1, -138.7], [-48.6, -117.2], [-57.5, -117.1], [-57.4, -137.2], [-73.5, -129.9], [-88.4, -120.4], [-101.9, -108.9], [-113.6, -95.8], [-123.4, -81.2]];

function lumen() {
  const g = new THREE.Group();
  g.userData.worldAligned = true;
  const plan = offsetPoly(LUMEN_PLAN, ...LUMEN_OFF);
  const fc = [-11.5 + LUMEN_OFF[0], -10 + LUMEN_OFF[1]];
  // Field long axis is z (north-south): the inner edge is 74 x 128 m.
  const inner = roundRect(fc[0], fc[1], 37, 64, 13);
  const rays = bowl(g, {
    c: fc, inner, outer: plan,
    H: (dx, dz) => {
      const north = Math.max(0, -dz), south = Math.max(0, dz);
      return 38 - 23 * Math.pow(north, 3) - 4 * Math.pow(south, 2);
    },
    seat: seats(0x33485f), facade: lumenWall(), rim: mat.concrete,
  });
  const turf = fieldMat('football', [-64, -37, 64, 37], 8, footballPaint('#1d3e6e', '#1d3e6e'));
  g.add(fieldPlane(inner, turf, 0.35, (x, z) => [z - fc[1], x - fc[0]]));
  // The two arches: tri-chord trusses, end pylons 220 m apart, 61 m crown.
  const roofM = new THREE.MeshStandardMaterial({ color: 0x7f97ad, roughness: 0.55, metalness: 0.35, envMapIntensity: 0.6, side: THREE.DoubleSide });
  for (const sx of [-1, 1]) {
    const x = fc[0] + sx * 92;
    const archY = (z) => 26 + 35 * (1 - ((z - fc[1]) / 112) ** 2);
    const chords = [[0, 1.4], [-1.3, -0.9], [1.3, -0.9]];
    const zs = [];
    for (let k = 0; k <= 16; k++) zs.push(fc[1] - 112 + (224 * k) / 16);
    for (const [ox, oy] of chords) g.add(tube(zs.map((z) => V(x + ox, archY(z) + oy, z)), 0.45, mat.whiteSteel, 6));
    for (let k = 0; k < 16; k++) {
      const z0 = zs[k], z1 = zs[k + 1];
      g.add(strut(V(x, archY(z0) + 1.4, z0), V(x + (k % 2 ? 1.3 : -1.3), archY(z1) - 0.9, z1), 0.18, mat.whiteSteel, 4));
    }
    // End pylons.
    for (const sz of [-1, 1]) {
      const z = fc[1] + sz * 112;
      g.add(box(6, 27, 6, mat.concrete, x, -1, z));
      solidBox(g, x, z, 3.2, 3.2, 0, 26);
    }
    // Roof: from over the lower deck out to the rim, hung under the arch.
    const rows = [];
    for (let k = 0; k <= 12; k++) {
      const z = fc[1] - 96 + (200 * k) / 12;
      const row = [];
      for (let j = 0; j <= 4; j++) {
        const u = j / 4;
        const xx = fc[0] + sx * (52 + 60 * u);
        const y = 37 + 7 * (1 - ((z - fc[1]) / 112) ** 2) + 2.5 * (1 - u);
        row.push([xx, y, z]);
      }
      rows.push(row);
    }
    g.add(sheet(rows, roofM, { expect: UP }));
    // Hangers from the arch to the roof.
    for (let k = 1; k < 12; k += 1) {
      const z = fc[1] - 96 + (200 * k) / 12;
      const y = 37 + 7 * (1 - ((z - fc[1]) / 112) ** 2) + 2.5 * (1 - 40 / 60);
      g.add(strut(V(x, archY(z) - 1, z), V(x, y, z), 0.09, mat.darkSteel, 3));
    }
  }
  // Hawks Nest scoreboard over the open north end, and the south board.
  const nz = fc[1] - 120;
  for (const s of [-1, 1]) g.add(box(2, 22, 2, mat.darkSteel, fc[0] + s * 20, -1, nz));
  g.add(box(46, 12, 3, mat.darkSteel, fc[0], 18, nz));
  g.add(box(42, 9, 0.4, mat.glass, fc[0], 19.5, nz + 1.7));
  g.add(box(40, 9, 3, mat.darkSteel, fc[0], 30, fc[1] + 104));
  const s = sign('LUMEN FIELD', 42, 5.5, null, '#ffffff', { stroke: 'rgba(0,0,0,0.35)' });
  const r = rays.reduce((b, q) => (q.dx < b.dx ? q : b), rays[0]);
  s.position.set(fc[0] + r.dx * r.to - 0.6, 28, fc[1]);
  s.rotation.y = -Math.PI / 2;
  g.add(s);
  solidOutline(g, plan, 2, 34);
  return g;
}

// ---------------------------------------------------------------------------
// T-Mobile Park. A baseball bowl, home plate at the south-west and centre
// field to the north-east, under a three-panel roof that parks EAST, stacked
// over the railway, on rails along the north and south sides.

const TMOB_BOWL = [[-61.8, 78.4], [-56.7, 91.5], [-47.1, 96.4], [-36.5, 96.9], [118, 97.1], [118, -105.6], [-4.5, -105.4], [-19.5, -86.2], [-41.2, -93.0], [-58.9, -93.0], [-59.1, 66.0], [-60.0, 71.5]];
const TMOB = { home: [-5, 40], cf: 122.2, lf: 100.9, rf: 99.4, back: 21, foul: 14, railN: -103, railS: 95, railY: 49 };

function tmobile() {
  const g = new THREE.Group();
  g.userData.worldAligned = true;
  const [hx, hz] = TMOB.home;
  // Bearings are measured from centre field (north-east), turning to the left
  // field line at -45 deg (north) and the right field line at +45 (east).
  const cfA = Math.atan2(-1, 1);          // world angle of centre field
  const inner = [];
  for (let k = 0; k < 120; k++) {
    const b = -Math.PI + (k / 120) * Math.PI * 2;
    const ab = Math.abs(b);
    let r;
    if (ab <= Math.PI / 4) {
      const t = (b + Math.PI / 4) / (Math.PI / 2);   // 0 at LF, 1 at RF
      r = TMOB.lf + (TMOB.rf - TMOB.lf) * t + (TMOB.cf - (TMOB.lf + TMOB.rf) / 2) * Math.sin(Math.PI * t);
    } else {
      const gma = ab - Math.PI / 4;
      const pole = b < 0 ? TMOB.lf : TMOB.rf;
      r = Math.max(TMOB.back, Math.min(pole, TMOB.foul / Math.sin(gma)));
    }
    const a = cfA + b;
    inner.push([hx + Math.cos(a) * r, hz + Math.sin(a) * r]);
  }
  bowl(g, {
    c: [hx, hz], inner, outer: TMOB_BOWL, n: 120,
    H: (dx, dz) => {
      const b = Math.abs(Math.atan2(Math.sin(Math.atan2(dz, dx) - cfA), Math.cos(Math.atan2(dz, dx) - cfA)));
      const f = Math.min(1, Math.max(0, (b - 0.55) / 0.45));
      return 13 + 29 * f * f * (3 - 2 * f);
    },
    seat: seats(0x0f3d5c), facade: tmobBrick(), rim: mat.concrete,
  });
  // Field: grass, dirt infield skin and the warning track.
  const rot = -Math.PI / 2 - cfA;         // turn the paint so CF is -z on the canvas
  const turf = fieldMat('baseball', [-130, -130, 130, 30], 5, (c) => {
    c.fillStyle = '#8a6a48'; c.fillRect(-130, -130, 260, 160);
    c.fillStyle = '#3f8237';
    c.beginPath(); c.moveTo(0, 0);
    c.arc(0, 0, TMOB.cf - 4.5, -Math.PI / 2 - Math.PI / 4 - 0.02, -Math.PI / 2 + Math.PI / 4 + 0.02);
    c.closePath(); c.fill();
    for (let k = 0; k < 14; k++) { c.fillStyle = k % 2 ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.05)'; c.beginPath(); c.arc(0, 0, 130 - k * 9, 0, Math.PI * 2); c.arc(0, 0, 125.5 - k * 9, 0, Math.PI * 2, true); c.fill(); }
    c.fillStyle = '#a07a52';
    c.beginPath(); c.arc(0, -18.44, 28.96, 0, Math.PI * 2); c.fill();
    c.fillStyle = '#3f8237';
    c.beginPath(); c.moveTo(0, -1.2); c.lineTo(-18.2, -19.4); c.lineTo(0, -37.6); c.lineTo(18.2, -19.4); c.closePath(); c.fill();
    c.fillStyle = '#a07a52'; c.beginPath(); c.arc(0, -18.44, 2.7, 0, Math.PI * 2); c.fill();
    c.beginPath(); c.arc(0, 0, 4, 0, Math.PI * 2); c.fill();
    c.strokeStyle = '#f4f4f0'; c.lineWidth = 0.2;
    c.beginPath(); c.moveTo(-72, -72); c.lineTo(0, 0); c.lineTo(72, -72); c.stroke();
  });
  const cr = Math.cos(rot), sr = Math.sin(rot);
  g.add(fieldPlane(inner, turf, 0.35, (x, z) => {
    const dx = x - hx, dz = z - hz;
    return [dx * cr - dz * sr, dx * sr + dz * cr];
  }));
  // The rails: box girders along the north and south sides, on trestles.
  const steel = P(0x3f5550, 0.55, 0.45, 0.65);
  for (const z of [TMOB.railN, TMOB.railS]) {
    g.add(box(242, 3.2, 3.2, steel, 57, TMOB.railY - 3.2, z));
    for (let x = -60; x <= 176; x += 29.5) {
      g.add(box(2.2, TMOB.railY - 3.2, 2.2, steel, x, -1, z));
      solidBox(g, x, z, 1.3, 1.3, 0, 40);
    }
  }
  // Three panels, open: stacked east over the tracks, panel 2 on top.
  const roofM = new THREE.MeshStandardMaterial({ color: 0xaab2b3, roughness: 0.5, metalness: 0.45, envMapIntensity: 0.7, side: THREE.DoubleSide });
  const zc = (TMOB.railN + TMOB.railS) / 2, zr = (TMOB.railS - TMOB.railN) / 2 + 1.5;
  for (const [x0, crown] of [[84, 63], [94, 66.5], [108, 71]]) {
    const w = 64, edge = TMOB.railY + (crown - 63) * 0.4;
    const rows = [];
    for (let k = 0; k <= 16; k++) {
      const z = zc - zr + (2 * zr * k) / 16, f = (z - zc) / zr;
      rows.push([0, 0.5, 1].map((u) => [x0 + u * w, edge + (crown - edge) * (1 - f * f), z]));
    }
    g.add(sheet(rows, roofM, { expect: UP }));
    for (const u of [0, 0.33, 0.67, 1]) {
      const pts = [];
      for (let k = 0; k <= 10; k++) { const z = zc - zr + (2 * zr * k) / 10, f = (z - zc) / zr; pts.push(V(x0 + u * w, edge + (crown - edge) * (1 - f * f) - 1.6, z)); }
      g.add(tube(pts, 0.8, steel, 5));
    }
    for (const z of [zc - zr, zc + zr]) g.add(box(w, 2.2, 2.4, steel, x0 + w / 2, edge - 1.2, z));
  }
  const s = sign('T-MOBILE PARK', 40, 5, null, '#ffffff', { stroke: 'rgba(0,0,0,0.35)' });
  s.position.set(-4, 24, 97.4);
  g.add(s);
  solidOutline(g, TMOB_BOWL, 2, 42);
  return g;
}

// ---------------------------------------------------------------------------
// Husky Stadium: a U open to the east, the field 18 deg south of east, with
// the steel roofs cantilevered over the north and south stands.

const HUSKY_PLAN = [[-112.8, 16.2], [-109.7, 44.7], [-108.1, 44.4], [-100.1, 78.0], [-61.4, 98.9], [-20.7, 115.5], [21.6, 127.6], [64.9, 135.2], [76.7, 64.0], [94.2, 72.8], [109.2, 36.2], [114.1, 10.3], [95.1, 8.0], [124.7, -44.7], [114.2, -49.6], [126.0, -74.2], [94.4, -88.5], [61.9, -100.5], [11.6, -113.8], [-5.4, -117.0], [-8.7, -101.3], [-38.6, -106.2], [-76.0, -75.0], [-93.5, -52.2], [-100.3, -39.5], [-109.5, -12.4]];

function husky() {
  const g = new THREE.Group();
  g.userData.worldAligned = true;
  const A = 0.305, ua = [Math.cos(A), Math.sin(A)], va = [-Math.sin(A), Math.cos(A)];
  const fc = [-2, 8];
  const inner = roundRect(fc[0], fc[1], 64, 37, 13, A);
  bowl(g, {
    c: fc, inner, outer: HUSKY_PLAN,
    H: (dx, dz) => {
      const along = dx * ua[0] + dz * ua[1];
      return along > 0 ? 44 - 34 * Math.pow(along, 2.2) : 44 - 12 * Math.pow(-along, 3);
    },
    seat: seats(0x4b2e83), facade: P(0xa8a49a, 0.9, 0, 0.5), rim: P(0xb7a57a, 0.8, 0.1, 0.55),
  });
  const turf = fieldMat('football-uw', [-64, -37, 64, 37], 8, footballPaint('#4b2e83', '#4b2e83'));
  g.add(fieldPlane(inner, turf, 0.35, (x, z) => {
    const dx = x - fc[0], dz = z - fc[1];
    return [dx * ua[0] + dz * ua[1], dx * va[0] + dz * va[1]];
  }));
  const roofM = new THREE.MeshStandardMaterial({ color: 0xd8d9d6, roughness: 0.45, metalness: 0.5, envMapIntensity: 0.7, side: THREE.DoubleSide });
  const P2 = (a, v) => [fc[0] + ua[0] * a + va[0] * v, fc[1] + ua[1] * a + va[1] * v];
  for (const s of [-1, 1]) {
    const rows = [];
    for (let k = 0; k <= 10; k++) {
      const a = -80 + (130 * k) / 10;
      rows.push([0, 0.5, 1].map((u) => { const [x, z] = P2(a, s * (50 + 48 * u)); return [x, 47 - 5 * u, z]; }));
    }
    g.add(sheet(rows, roofM, { expect: UP }));
    for (let k = 0; k <= 5; k++) {
      const a = -80 + (130 * k) / 5;
      const [x0, z0] = P2(a, s * 50), [x1, z1] = P2(a, s * 100);
      g.add(strut(V(x0, 47.2, z0), V(x1, 42.2, z1), 0.6, mat.darkSteel, 5));
      g.add(strut(V(x1, 42.2, z1), V(x1, 0, z1), 0.9, mat.darkSteel, 6));
    }
  }
  const sgn = sign('HUSKY STADIUM', 36, 4.5, null, '#ffffff', { stroke: 'rgba(40,20,80,0.6)' });
  const [sx, sz] = P2(-112, 0);
  sgn.position.set(sx, 30, sz);
  sgn.rotation.y = Math.atan2(-ua[0], -ua[1]);
  g.add(sgn);
  solidOutline(g, HUSKY_PLAN, 2, 44);
  return g;
}

// ---------------------------------------------------------------------------
// Smith Tower: a 22-storey terra-cotta block on two storeys of granite, the
// tower rising flush with its Yesler Way face to a pyramid, globe and spire.
// Local frame: +z is the Yesler (south-south-east) face.

const SMITH = { block: 76.5, tw: 16.6, td: 13.4, shaft: 121.7, pyr: 21.3, storey: 3.48 };
// OSM lot, metres from the POI (world axes): a parallelogram between Yesler
// Way (the straight south edge) and 2nd Avenue, which meets it at 58 deg.
const SMITH_PLAN = [[-25.6, -1.0], [-11.0, 23.3], [12.1, 23.3], [25.6, 13.6], [18.1, 1.4], [16.3, 2.5], [13.2, -2.5], [15.1, -3.7], [5.2, -19.8], [-8.7, -11.4], [-7.6, -9.6], [-12.7, -6.5], [-13.8, -8.3]];
const SMITH_AXIS = 1.02;                 // 2nd Avenue's bearing, atan2(dz, dx)
// The unnamed street along the lot's east side (OSM), metres from the POI.
const SMITH_EAST = [[2.3, -27.5], [40.3, 33.5]];

/** Clip a polygon to the side of line ab holding the origin, `off` metres clear. */
function clipHalf(poly, [a, b], off) {
  const ex = b[0] - a[0], ez = b[1] - a[1], L = Math.hypot(ex, ez);
  let nx = -ez / L, nz = ex / L;
  if ((0 - a[0]) * nx + (0 - a[1]) * nz < 0) { nx = -nx; nz = -nz; }
  const sd = ([x, z]) => (x - a[0]) * nx + (z - a[1]) * nz - off;
  const out = [];
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i], q = poly[(i + 1) % poly.length], dp = sd(p), dq = sd(q);
    if (dp >= 0) out.push(p);
    if ((dp >= 0) !== (dq >= 0)) { const t = dp / (dp - dq); out.push([p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t]); }
  }
  return out;
}

function smith() {
  const g = new THREE.Group();
  g.userData.worldAligned = true;
  const tc = facadeMat('terracotta', '#ece6d8', ['#44525a', '#7d8c92'], 3.0, SMITH.storey, 1.7, 2.1, { mullion: '#e6dfcf' });
  const granite = P(0x8d8a86, 0.8, 0.05, 0.5);
  const trim = P(0xd9d2c1, 0.7, 0, 0.55);
  const { block, tw, td, shaft, pyr } = SMITH;
  const metres = (m, tile) => {
    const uv = m.geometry.attributes.uv;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) / tile[0], uv.getY(i) / tile[1]);
    return m;
  };
  // The block fills the lot: granite for two storeys, terra cotta above,
  // with a belt course and the cornice.
  // Clipped clear of the street along the east side: OSM's lot runs to its
  // centreline, so the east wall stood 1.8 m into the carriageway.
  const plan = clipHalf(SMITH_PLAN, SMITH_EAST, 4.8);
  const inset = plan.map(([x, z]) => [x * 0.985, z * 0.985]);
  g.add(prism(plan, -2, 6.5, granite));
  g.add(metres(prism(inset, 6.5, block, tc), [3.0, SMITH.storey]));
  g.add(prism(plan.map(([x, z]) => [x * 1.02, z * 1.02]), block, block + 1.1, trim));
  g.add(prism(plan.map(([x, z]) => [x * 1.005, z * 1.005]), 19, 19.6, trim));
  // The tower, square to 2nd Avenue, over the block's Yesler end.
  const tRot = Math.atan2(-Math.sin(SMITH_AXIS), Math.cos(SMITH_AXIS));   // box: local x along 2nd Ave
  const tx = -2.5, tz = 8.0;
  g.add(tbox(tw, shaft - block, td, tc, tx, block + 1.1, tz, tRot));
  g.add(box(tw + 1.2, 1.2, td + 1.2, trim, tx, shaft - 4, tz, tRot));
  g.add(box(tw + 1.6, 1.4, td + 1.6, trim, tx, shaft, tz, tRot));
  // Pyramid: a real square pyramid (see "A roof has to know which way its
  // house is facing"), with dormers, then the globe and the spire.
  const pg = new THREE.ConeGeometry(Math.SQRT1_2, 1, 4, 1);
  pg.rotateY(Math.PI / 4);
  pg.scale(tw, pyr, td);
  const pm = new THREE.Mesh(pg, P(0xe2dccd, 0.75, 0, 0.55));
  pm.position.set(tx, shaft + 1.4 + pyr / 2, tz);
  pm.rotation.y = tRot;
  g.add(pm);
  // Dormers up each face of the pyramid, in the tower's frame.
  const c = Math.cos(tRot), sn = Math.sin(tRot);
  const toW = (lx, lz) => [tx + lx * c + lz * sn, tz - lx * sn + lz * c];
  for (const [dx, dz] of [[0, 1], [1, 0], [0, -1], [-1, 0]]) {
    const half = dz ? td / 2 : tw / 2;
    for (const yy of [4, 10.5]) {
      const dist = half * (1 - yy / pyr) + 0.1;
      const [wx, wz] = toW(dx * dist, dz * dist);
      g.add(box(1.5, 2.6, 1.2, P(0x3c464c, 0.3, 0.5, 0.8), wx, shaft + 1.4 + yy - 1.3, wz, tRot + Math.atan2(dx, dz)));
    }
  }
  const globe = new THREE.Mesh(new THREE.SphereGeometry(1.2, 14, 10), P(0x6fa6d9, 0.2, 0.3, 0.9, { emissive: 0x2a5a8a, key: 'globe' }));
  globe.position.set(tx, shaft + 1.4 + pyr + 0.9, tz);
  g.add(globe);
  g.add(cyl(0.08, 0.2, 5, mat.darkSteel, tx, shaft + 1.4 + pyr + 1.8, tz, 6));
  solidOutline(g, inset.map(([x, z]) => [x * 0.97, z * 0.97]), 1, block);
  return g;
}

// ---------------------------------------------------------------------------
// The smaller landmarks, as they were, on physically shaded materials.

function library() {
  const g = new THREE.Group();
  const glass = mat.glassSolid;
  const parts = [
    [56, 14, 46, 0, 0, 0], [44, 12, 38, 8, 14, 4], [62, 18, 50, -6, 26, -3],
    [40, 14, 34, 10, 44, 6], [50, 10, 42, -2, 58, 0],
  ];
  const fr = P(0x2b4a52, 0.6, 0.4, 0.6);
  for (const [w, h, d, x, y, z] of parts) {
    g.add(box(w, h, d, glass, x, y, z, 0.06 * y));
    // the diagrid, as edges
    for (const [sx, sz] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
      const b = box(0.5, h, 0.5, fr, sx * w / 2, y, sz * d / 2);
      const c = Math.cos(0.06 * y), s = Math.sin(0.06 * y);
      b.position.set(x + (sx * w / 2) * c + (sz * d / 2) * s, y + h / 2, z - (sx * w / 2) * s + (sz * d / 2) * c);
      g.add(b);
    }
  }
  solidBox(g, 0, 0, 28, 23, 0, 14);
  return g;
}

function gasworks() {
  const g = new THREE.Group();
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    g.add(cyl(4.5, 5.5, 16 + (i % 3) * 6, mat.rust, Math.cos(a) * 12, 0, Math.sin(a) * 12, 12));
    solidCircle(g, Math.cos(a) * 12, Math.sin(a) * 12, 5.3, 16);
  }
  g.add(cyl(7, 8, 26, mat.rust, 0, 0, 0, 14));
  solidCircle(g, 0, 0, 7.8, 26);
  for (let i = 0; i < 5; i++) {
    g.add(box(24, 0.6, 0.6, mat.rust, 0, 10 + i * 3, 0, i * 0.6));
  }
  return g;
}

// The Fremont Troll (1990): an 18 ft = 5.5 m concrete troll coming up out of
// the ground under the Aurora Bridge, a hubcap for an eye, crushing a real VW
// Beetle in his left hand (Fremont Arts Council; Wikipedia "Fremont Troll").
// Faces south, up Troll Avenue.
function troll() {
  const g = new THREE.Group();
  const stone = P(0x8e8f89, 0.95, 0, 0.5);
  const dark = P(0x5d5e5a, 0.95, 0, 0.45);
  const ell = (r, sx, sy, sz, m, x, y, z, seg = 10) => {
    const o = new THREE.Mesh(new THREE.SphereGeometry(r, seg, Math.max(6, seg * 0.7 | 0)), m);
    o.scale.set(sx, sy, sz); o.position.set(x, y, z);
    return o;
  };
  // Head, buried to the jaw; the shaggy mane over the crown and back.
  g.add(ell(3.3, 1.15, 0.95, 1.0, stone, 0, 2.2, 0, 18));
  for (let k = 0; k < 16; k++) {
    const a = -0.4 + (k / 15) * (Math.PI + 0.8);
    const r = 1.0 + ((k * 37) % 5) * 0.12;
    g.add(ell(r, 1.1, 0.8, 1.0, dark, Math.cos(a) * 3.2, 3.6 + Math.sin(k * 1.3) * 0.5, -Math.sin(a) * 2.2 - 0.4, 7));
  }
  for (let k = 0; k < 6; k++) g.add(ell(0.8, 1.2, 0.7, 0.9, dark, -2.0 + k * 0.8, 4.7 - Math.abs(k - 2.5) * 0.15, 2.1, 10));
  // Brow, nose, mouth; the hubcap eye (left, as he looks) and the one hidden
  // under his hair.
  g.add(ell(1.0, 2.6, 0.45, 0.8, stone, 0, 3.75, 2.75, 12));
  g.add(ell(0.9, 0.85, 0.75, 1.55, stone, 0.25, 2.55, 3.45, 14));
  g.add(ell(0.8, 1.6, 0.28, 0.6, dark, 0.1, 1.25, 3.05, 12));
  const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.58, 0.58, 0.16, 18), P(0xc9cdd1, 0.25, 0.95, 0.9));
  cap.rotation.x = Math.PI / 2 - 0.2; cap.rotation.z = 0.1;
  cap.position.set(-1.25, 3.25, 2.95);
  g.add(cap);
  g.add(ell(0.42, 1, 0.7, 0.5, dark, 1.35, 3.2, 2.95, 10));
  // Left arm and hand, and the Beetle in it.
  g.add(ell(1.4, 2.4, 0.8, 1.1, stone, 3.9, 0.6, 0.9, 14));
  const car = new THREE.Group();
  const vw = P(0x7c8790, 0.8, 0.2, 0.55);
  car.add(ell(1, 0.85, 0.62, 2.05, vw, 0, 0.72, 0, 16));
  car.add(ell(1, 0.66, 0.5, 0.95, vw, 0, 1.22, -0.1, 12));
  for (const [x, z] of [[-0.8, 1.25], [0.8, 1.25], [-0.8, -1.25], [0.8, -1.25]]) car.add(ell(0.36, 0.5, 1, 1, dark, x, 0.36, z, 8));
  car.position.set(6.1, 0.1, 1.6);
  car.rotation.set(0.12, -0.35, 0.18);
  g.add(car);
  g.add(ell(1.25, 1.1, 0.7, 1.3, stone, 5.5, 1.2, 0.1, 14));
  for (let k = 0; k < 4; k++) {
    const f = new THREE.Mesh(new THREE.CapsuleGeometry(0.3, 1.9, 4, 8), stone);
    f.position.set(5.2 + k * 0.55, 1.95, 0.8 + k * 0.35);
    f.rotation.set(0.95, -0.35, 0.25);
    g.add(f);
  }
  g.add(ell(0.34, 1, 1, 1.9, stone, 4.6, 1.4, 1.8, 10));
  solidCircle(g, 0, 0.2, 3.6, 6);
  solidCircle(g, 5.6, 1.1, 2.4, 3);
  return g;
}

function locks() {
  const g = new THREE.Group();
  g.add(box(140, 5, 26, mat.concrete, 0, -2, 0));
  g.add(box(140, 3, 8, mat.concrete, 0, 3, -14));
  g.add(box(140, 3, 8, mat.concrete, 0, 3, 14));
  for (let i = -2; i <= 2; i++) g.add(box(3, 8, 26, mat.darkSteel, i * 30, 3, 0));
  return g;
}

function ferryTerminal() {
  const g = new THREE.Group();
  g.add(box(70, 8, 40, M(0xcfd6d9), 0, 0, 0));
  g.add(box(74, 1.4, 44, mat.dark, 0, 8, 0));
  g.add(box(30, 5, 24, M(0xdde3e6), 12, 9.4, 0));
  const s = sign('WASHINGTON STATE FERRIES', 30, 3.2, '#0d3b2e', '#ffffff');
  s.position.set(0, 11, 20.3);
  g.add(s);
  const boat = new THREE.Group();
  boat.add(box(24, 6, 78, mat.white, 0, -1.5, 0));
  boat.add(box(22, 5, 60, mat.wsfGreen, 0, 4.5, 0));
  boat.add(box(16, 4, 26, mat.white, 0, 9.5, 0));
  boat.add(box(8, 3.5, 10, mat.white, 0, 13.5, 0));
  boat.add(cyl(1.6, 1.6, 8, mat.wsfGreen, 0, 17, -6, 10));
  boat.position.set(-52, 0, 10);
  boat.rotation.y = 0.1;
  g.add(boat);
  solidBox(g, 0, 0, 35, 20, 0, 8);
  return g;
}

function pier() {
  const g = new THREE.Group();
  g.userData.baseY = 2.4;
  g.add(box(46, 2, 90, mat.wood, 0, -2, 0));
  g.add(box(30, 10, 60, M(0xd8d3c6), 0, 0, 0));
  g.add(box(34, 1.2, 64, mat.red, 0, 10, 0));
  for (let i = -2; i <= 2; i++)
    for (let j = -3; j <= 3; j++) g.add(cyl(0.7, 0.7, 12, mat.wood, i * 10, -13, j * 13, 6));
  solidBox(g, 0, 0, 15, 30, 0, 10);
  return g;
}

function kerryPark() {
  const g = new THREE.Group();
  g.add(box(50, 1, 16, mat.concrete, 0, -0.5, 0));
  for (let i = -5; i <= 5; i++) g.add(cyl(0.16, 0.16, 1.1, mat.darkSteel, i * 4.5, 0.5, 7, 6));
  g.add(box(46, 0.2, 0.2, mat.darkSteel, 0, 1.6, 7));
  const arch = new THREE.Mesh(new THREE.TorusGeometry(3.4, 0.5, 6, 14, Math.PI), M(0x6e747a));
  arch.position.set(-14, 1, 0);
  g.add(arch);
  return g;
}

function statueLiberty() {
  const g = new THREE.Group();
  const cu = P(0x66a89a, 0.6, 0.35, 0.6);
  g.add(box(6, 5, 6, mat.concrete, 0, 0, 0));
  g.add(cyl(1.2, 2.2, 7, cu, 0, 5, 0, 10));
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.9, 8, 8), cu);
  head.position.y = 12.6;
  g.add(head);
  const arm = new THREE.Mesh(new THREE.BoxGeometry(0.6, 4, 0.6), cu);
  arm.position.set(1.4, 12, 0);
  arm.rotation.z = -0.4;
  g.add(arm);
  const torch = new THREE.Mesh(new THREE.ConeGeometry(0.7, 1.4, 8), P(0xffcf6b, 0.4, 0.2, 0.6, { emissive: 0xffa640, key: 'torch' }));
  torch.position.set(2.6, 14.4, 0);
  g.add(torch);
  solidBox(g, 0, 0, 3, 3, 0, 5);
  return g;
}

function convention() {
  const g = new THREE.Group();
  const glass = mat.glassSolid;
  g.add(box(120, 26, 70, glass, 0, 0, 0));
  const vault = new THREE.Mesh(new THREE.CylinderGeometry(36, 36, 118, 16, 1, false, 0, Math.PI), glass);
  vault.rotation.z = Math.PI / 2;
  vault.position.set(0, 26, 0);
  g.add(vault);
  solidBox(g, 0, 0, 60, 35, 0, 26);
  return g;
}

function aquarium() {
  const g = new THREE.Group();
  g.userData.baseY = 2.4;
  g.add(box(40, 2, 60, mat.wood, 0, -2, 0));
  g.add(box(30, 9, 44, M(0x4b6f86), 0, 0, 0));
  g.add(box(34, 1.2, 48, mat.white, 0, 9, 0));
  const s = sign('SEATTLE AQUARIUM', 22, 3, '#0f3d55', '#ffffff');
  s.position.set(0, 11, 24.2);
  g.add(s);
  solidBox(g, 0, 0, 15, 22, 0, 9);
  return g;
}

/**
 * Radius, in metres, that each landmark needs to itself -- or a list of
 * [dx, dz, r] circles offset from its point, for one whose model does not sit
 * on it.
 *
 * OSM has footprints for these too -- the Space Needle is a 38 x 38 m building
 * tagged 184 m tall -- so without this the importer draws a generic grey tower
 * in exactly the same place as the hand-built mesh and swallows it whole. That
 * is where the Space Needle went. This file owns the meshes, so it is the file
 * that knows how much room each one takes; keep a new entry here whenever a
 * landmark is added or `buildLandmarks` will quietly be building it inside a box.
 */

/**
 * Boeing Field. The ARP sits mid-airfield and the runway is laid out in real
 * metres from it: 14R/32L is 3048 m on a ~150 deg true bearing, which in this
 * frame (+X east, +Z south) is a yaw of about -0.52 rad. The hangars along the
 * east apron are real OSM buildings and arrive on their own; what this builds
 * is the pavement the data has no layer for -- runway, parallel taxiway,
 * apron -- plus the tower, a windsock, and threshold markings, so it reads as
 * an airfield from the air. The apron's parked planes are spawned by main.js.
 */
function airport() {
  const g = new THREE.Group();
  const asphalt = P(0x53565b, 0.9, 0, 0.45, { noShadow: true });
  const paintW = new THREE.MeshBasicMaterial({ color: 0xe8e8e2 });
  paintW.userData.noShadow = true;
  // Axes SPELLED OUT, because two rotation conventions meet here and they
  // disagree in the sign of x. landmark box() rotates a THREE mesh: its
  // rotation.y = t maps local +z to (sin t, cos t). build.js's box() maps
  // local +z to (-sin t, cos t). A helper derived from the wrong one laid the
  // whole 3 km runway along bearing 210 instead of 150 -- present, raycastable,
  // and buried under the un-graded hillside 60 degrees away from its markings.
  // ALONG is the runway direction (bearing 150), ACROSS is 90 right of it.
  const RY = 0.52;                       // THREE rotation.y: sin/cos = (0.497, 0.868)
  const ALONG = [Math.sin(RY), Math.cos(RY)];
  const ACROSS = [Math.cos(RY), -Math.sin(RY)];
  const off = (dx, dz) => [dx * ACROSS[0] + dz * ALONG[0], dx * ACROSS[1] + dz * ALONG[1]];
  // The raster grades the field dead flat at 5.2 m (build_raster's
  // grade_airfield), so pavement is SINGLE slabs -- the earlier per-section
  // drape existed for undulating ground and its seams read as jagged teeth
  // once the ground stopped undulating. Local frame: group origin sits at the
  // field elevation, so a slab top at +0.35 is 35 cm proud everywhere.
  const P2 = (dx, dz) => off(dx, dz);
  const pav = (dx, dz, w, len) => {
    const [lx, lz] = P2(dx, dz);
    g.add(box(w, 2.6, len, asphalt, lx, 0.35 - 2.6, lz, RY));
  };
  const mark = (dx, dz, w, len) => {
    const [lx, lz] = P2(dx, dz);
    g.add(box(w, 0.04, len, paintW, lx, 0.36, lz, RY));
  };
  pav(0, 0, 46, 3048);                       // runway 14R/32L
  pav(150, 0, 23, 2600);                     // parallel taxiway, east
  for (let k = -2; k <= 2; k++) {            // stubs joining them
    const [sx, sz] = P2(75, k * 520);
    g.add(box(150, 2.6, 18, asphalt, sx, 0.33 - 2.6, sz, RY + Math.PI / 2));
  }
  pav(-205, 70, 130, 380);                   // GA apron, west
  pav(-120, 0, 20, 2900);                    // full-length west taxiway
  for (const kz of [-1380, -900, -450, -40, 180, 620, 1100, 1380]) {
    const [sx, sz] = P2(-60, kz);            // stubs: west taxiway <-> runway
    g.add(box(126, 2.6, 16, asphalt, sx, 0.33 - 2.6, sz, RY + Math.PI / 2));
  }
  for (const e of [-1, 1]) pav(0, e * 1500, 76, 60);   // threshold turnpads
  for (let k = -22; k <= 22; k++) mark(0, k * 66, 0.9, 30);          // centreline
  for (const e of [-1, 1]) for (let j = -3; j <= 3; j++) mark(j * 5.4, e * 1470, 1.8, 40);
  for (const e of [-1, 1]) for (const sdx of [-21.5, 21.5])          // edge stripes
    mark(sdx, e * 762, 0.7, 1500);

  // tower on the apron edge
  const [twx, twz] = off(-300, -190);
  g.add(box(9, 26, 9, mat.concrete, twx, 13, twz, RY));
  g.add(box(12, 4.4, 12, mat.glassSolid, twx, 28.2, twz, RY + 0.4));
  g.add(box(13, 0.7, 13, mat.darkSteel, twx, 30.7, twz, RY + 0.4));
  solidBox(g, twx, twz, 4.5, 4.5, -RY, 40, 0);
  // windsock
  const [wx, wz] = off(-120, -900);
  g.add(cyl(0.12, 0.12, 7, mat.darkSteel, wx, 3.5, wz, 6));
  g.add(cyl(0.02, 0.55, 2.2, M(0xd9601f), wx, 6.6, wz, 8).rotateZ(Math.PI / 2));
  return g;
}

/**
 * A small floatplane dock on Lake Union's west shore. Not an OSM landmark --
 * it is the game's own fixture, so it is placed by hand from measured
 * shoreline coordinates (land ends at x -160 near z -2800; the lake sits at
 * 5.31 m) rather than through places.json.
 */
function seadock() {
  const g = new THREE.Group();
  const deckM = M(0x8a6f4d), postM = M(0x5b4632);
  // pier: from the shore out over the water, planked
  g.add(box(44, 0.5, 4.6, deckM, 2, 0.9, 0));
  for (let k = -4; k <= 4; k++) {
    g.add(cyl(0.18, 0.18, 2.6, postM, -18 + (k + 4) * 5, -0.4, 2.0, 6));
    g.add(cyl(0.18, 0.18, 2.6, postM, -18 + (k + 4) * 5, -0.4, -2.0, 6));
  }
  // L-head at the end, where the plane ties up
  g.add(box(4.6, 0.5, 16, deckM, 22, 0.9, 6));
  // a small shed and a fuel drum at the shore end
  g.add(box(4.4, 3.0, 3.6, M(0x77593c), -16, 2.5, 0));
  g.add(box(5.0, 0.4, 4.2, M(0x64492f), -16, 4.1, 0));
  g.add(cyl(0.55, 0.55, 1.3, M(0xa33d2a), -12.5, 1.7, 1.2, 10));
  return g;
}

export const LANDMARK_CLEAR = {
  spaceNeedle: 48, mopop: 62, arena: 95, spheres: 44, wheel: 9,
  // The Main Arcade's two OSM ways, which the model replaces; the Market's
  // own node is 220 m up the bluff from its sign.
  market: [[96.5, 99.5, 6], [143.5, 154.9, 6], [152.5, 141, 10], [122.5, 114.7, 10], [94.9, 85.5, 8]],
  aquarium: 48, ferry: 72, library: 48, pier: 52, gasworks: 95, troll: 18,
  locks: 75, kerry: 30, ferriswheelPier: 42, convention: 62,
  stadiumF: 135, stadiumB: 128, stadiumH: 122, smith: 6,
  // the tower/apron cluster only -- the runway lies over real open ground and
  // the hangars beside it are real buildings that must stay
  airport: 90, bellevueDT: 40,
};

const BUILDERS = {
  spaceNeedle: () => { const g = spaceNeedle(); for (const s of needleSolids()) solid(g, s); return g; },
  mopop, arena, spheres, market, wheel, library, aquarium, gasworks, troll, locks,
  ferry: ferryTerminal, pier, kerry: kerryPark, ferriswheelPier: statueLiberty,
  convention, airport, stadiumF: lumen, stadiumB: tmobile, stadiumH: husky, smith,
};

/** Group-local solid -> world, through the group's yaw `t` and position. */
function worldSolid(s, px, py, pz, t) {
  const c = Math.cos(t), sn = Math.sin(t);
  const o = { x: px + s.x * c + s.z * sn, z: pz - s.x * sn + s.z * c, y0: py + s.y0, y1: py + s.y1 };
  if (s.r !== undefined) o.r = s.r;
  else { o.hw = s.hw; o.hd = s.hd; o.rot = s.rot - t; }
  return o;
}

/** Does a solid stand on a carriageway? Sampled over its footprint. */
function onRoad(city, s) {
  const pts = [];
  if (s.r !== undefined) {
    pts.push([s.x, s.z]);
    for (let k = 0; k < 6; k++) pts.push([s.x + Math.cos(k) * s.r * 0.8, s.z + Math.sin(k) * s.r * 0.8]);
  } else {
    const c = Math.cos(s.rot), sn = Math.sin(s.rot);
    const nu = Math.max(1, Math.ceil(s.hw / 4)), nv = Math.max(1, Math.ceil(s.hd / 4));
    for (let i = -nu; i <= nu; i++) for (let j = -nv; j <= nv; j++) {
      const u = (i / nu) * s.hw * 0.9, v = (j / nv) * s.hd * 0.9;
      pts.push([s.x + u * c - v * sn, s.z + u * sn + v * c]);
    }
  }
  return pts.some(([x, z]) => city.onRoad(x, z, 0.3, false));
}

/**
 * Build every landmark into the scene. Landmarks within ~1.2 km of each other
 * merge by material into one cluster, which culls on its own bounds -- so a
 * view of the stadiums does not pay for Seattle Center. With `city`, their
 * colliders are installed through city.setLandmarkSolids; without it (the
 * cost harness) nothing outside the scene is touched.
 */
export function buildLandmarks(scene, city) {
  atlas = new SignAtlas();
  const clusters = new Map();
  const solids = [];
  const dropped = [];
  const addTo = (key, obj) => {
    let c = clusters.get(key);
    if (!c) clusters.set(key, (c = new THREE.Group()));
    c.add(obj);
  };
  // hand-placed fixtures first (see seadock's comment for why no places.json)
  {
    const d = seadock();
    d.position.set(-140, 5.31, -2800);
    addTo('seadock', d);
  }
  for (const l of G.LANDMARKS) {
    const b = BUILDERS[l.kind];
    if (!b) continue;
    const g = b(l);
    const at = g.userData.at;
    const x = at ? at[0] : (l.p ? l.p[0] : l.x);
    const z = at ? at[1] : (l.p ? l.p[1] : l.z);
    const y = at ? at[2] : g.userData.baseY !== undefined ? g.userData.baseY : G.terrainHeight(x, z);
    const t = g.userData.worldAligned ? 0 : (l.rot || 0);
    g.position.set(x, y, z);
    g.rotation.y = t;
    g.userData.landmark = l.name;
    for (const s of g.userData.solids || []) {
      const w = worldSolid(s, x, y, z, t);
      if (city && onRoad(city, w)) { dropped.push(`${l.kind}@${w.x.toFixed(0)},${w.z.toFixed(0)}`); continue; }
      solids.push(w);
    }
    addTo(l.kind === 'airport' ? 'airport' : `${Math.round(x / 1200)},${Math.round(z / 1200)}`, g);
  }
  atlas.tex.needsUpdate = true;

  const root = new THREE.Group();
  root.name = 'landmarks';
  const needleMats = new Set(Object.values(NEEDLE_MATS));
  let draws = 0;
  for (const [key, grp] of clusters) {
    const merged = mergeByMaterial(grp);
    merged.traverse((o) => {
      if (!o.isMesh) return;
      draws++;
      o.geometry.computeBoundingSphere();
      o.frustumCulled = true;
      if (needleMats.has(o.material)) {
        // The Needle alone: it takes part in shadowing -- a 184 m tower that
        // neither casts nor receives a shadow reads as pasted on.
        o.name = 'spaceNeedle';
        const opaque = o.material !== NEEDLE_MATS.barrier && o.material !== NEEDLE_MATS.beacon;
        o.castShadow = opaque; o.receiveShadow = opaque;
        return;
      }
      o.name = `landmarks:${key}`;
      const ok = !(o.material.userData && o.material.userData.noShadow) && !o.material.transparent && !o.material.isMeshBasicMaterial;
      o.castShadow = ok;
      o.receiveShadow = ok || o.material.isMeshStandardMaterial;
    });
    root.add(merged);
  }
  root.userData.draws = draws;
  root.userData.solids = solids.length;
  root.userData.solidsDropped = dropped;
  if (city && city.setLandmarkSolids) city.setLandmarkSolids(solids);
  scene.add(root);
  return root;
}
