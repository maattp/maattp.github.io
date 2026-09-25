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

// ONE DRAW FOR A CLUSTER'S PALETTE. After mergeByMaterial a cluster is still
// one mesh per P() colour -- 13-19 draws on screen downtown for ~9k triangles,
// on a target where the draw call is what costs. Every plain palette material
// (untextured, opaque, no shader of its own, not emissive) folds into one mesh:
// the colour becomes a vertex colour and roughness / metalness / env intensity
// ride per vertex (`lmA`), so each surface shades exactly as before.
const LM_PALETTE = (() => {
  const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, metalness: 0, envMapIntensity: 1 });
  m.onBeforeCompile = (sh) => {
    sh.vertexShader = 'attribute vec3 lmA;\nvarying vec3 vLmA;\n' + sh.vertexShader
      .replace('#include <begin_vertex>', '#include <begin_vertex>\n\tvLmA = lmA;');
    sh.fragmentShader = 'varying vec3 vLmA;\n' + sh.fragmentShader
      .replace('#include <envmap_physical_pars_fragment>', THREE.ShaderChunk.envmap_physical_pars_fragment
        .split('envMapColor.rgb * envMapIntensity;').join('envMapColor.rgb * envMapIntensity * vLmA.z;'))
      .replace('#include <metalnessmap_fragment>', '#include <metalnessmap_fragment>\n\tmetalnessFactor = vLmA.y;\n\troughnessFactor = vLmA.x;');
  };
  m.customProgramCacheKey = () => 'lmPalette';
  return m;
})();

function plainPalette(m, needleMats) {
  return m.isMeshStandardMaterial && m !== LM_PALETTE && !needleMats.has(m) && !m.map && !m.normalMap && !m.roughnessMap
    && !m.metalnessMap && !m.emissiveMap && !m.alphaMap && !m.aoMap && !m.transparent && m.side === THREE.FrontSide
    && m.onBeforeCompile === THREE.Material.prototype.onBeforeCompile && m.emissive.getHex() === 0 && !m.vertexColors
    && m.opacity === 1 && !(m.userData && m.userData.noShadow);
}

function mergePalette(group, needleMats) {
  // (only mergeByMaterial's own meshes, which are in world space: its large
  // pass-through meshes keep a transform of their own)
  const ident = (o) => o.position.lengthSq() === 0 && o.quaternion.w === 1 && o.scale.x === 1 && o.scale.y === 1 && o.scale.z === 1;
  const plain = group.children.filter((o) => o.isMesh && ident(o) && plainPalette(o.material, needleMats));
  if (plain.length < 2) return group;
  let n = 0, ni = 0;
  for (const o of plain) { n += o.geometry.attributes.position.count; ni += o.geometry.index.count; }
  const pos = new Float32Array(n * 3), nor = new Float32Array(n * 3), col = new Float32Array(n * 3);
  const uv = new Float32Array(n * 2), lmA = new Float32Array(n * 3);
  const idx = n > 65535 ? new Uint32Array(ni) : new Uint16Array(ni);
  let vb = 0, ib = 0;
  for (const o of plain) {
    const g = o.geometry, m = o.material, c = g.attributes.position.count;
    pos.set(g.attributes.position.array, vb * 3);
    nor.set(g.attributes.normal.array, vb * 3);
    if (g.attributes.uv) uv.set(g.attributes.uv.array, vb * 2);
    for (let i = 0; i < c; i++) {
      const k = (vb + i) * 3;
      col[k] = m.color.r; col[k + 1] = m.color.g; col[k + 2] = m.color.b;
      lmA[k] = m.roughness; lmA[k + 1] = m.metalness; lmA[k + 2] = m.envMapIntensity;
    }
    const ix = g.index.array;
    for (let i = 0; i < ix.length; i++) idx[ib + i] = ix[i] + vb;
    vb += c; ib += ix.length;
    group.remove(o);
    g.dispose();
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  geo.setAttribute('lmA', new THREE.BufferAttribute(lmA, 3));
  geo.setIndex(new THREE.BufferAttribute(idx, 1));
  group.add(new THREE.Mesh(geo, LM_PALETTE));
  return group;
}

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
    this.mat = new THREE.MeshBasicMaterial({ map: this.tex, transparent: true, alphaTest: 0.04, side: THREE.DoubleSide, forceSinglePass: true, toneMapped: false });
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
let monoRef = null;   // the Monorail, while buildLandmarks runs (MoPOP's passage)
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

// The monorail's passage through MoPOP, in the POI's frame: [[x, z, halfWidth]]
// along its midline (monorail.js passage()), set by buildLandmarks.
let mopopCut = null;
/** Push a skin vertex out of the monorail's passage, to the side its lobe's
 *  centre is on: the faces along the tracks come out flat, as the real
 *  building's valley walls are. */
function clearPassage(p, cx, cz) {
  if (!mopopCut) return p;
  let best = null;
  for (let i = 0; i < mopopCut.length - 1; i++) {
    const [ax, az, aw] = mopopCut[i], [bx, bz, bw] = mopopCut[i + 1];
    const dx = bx - ax, dz = bz - az, L2 = dx * dx + dz * dz || 1;
    const t = Math.max(0, Math.min(1, ((p[0] - ax) * dx + (p[2] - az) * dz) / L2));
    const qx = ax + dx * t, qz = az + dz * t;
    const d = Math.hypot(p[0] - qx, p[2] - qz);
    if (!best || d < best.d) best = { d, qx, qz, nx: -dz / Math.sqrt(L2), nz: dx / Math.sqrt(L2), hw: aw + (bw - aw) * t };
  }
  if (!best || best.d >= best.hw) return p;
  const side = Math.sign((cx - best.qx) * best.nx + (cz - best.qz) * best.nz) || 1;
  return [best.qx + best.nx * side * best.hw, p[1], best.qz + best.nz * side * best.hw];
}

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
      row.push(clearPassage([cx + lx * c - lz * s + lean[0] * y, y, cz + lx * s + lz * c + lean[1] * y], cx, cz));
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

function mopop(l) {
  const g = new THREE.Group();
  const pass = monoRef && monoRef.passage();
  const px = l.p ? l.p[0] : l.x, pz = l.p ? l.p[1] : l.z;
  mopopCut = pass ? pass.map(([x, z, w]) => [x - px, z - pz, w]) : null;
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
  mopopCut = null;
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
  // (the Wheel's deck is the end of Pier 57; `land` walks a boardwalk back to
  // the promenade across the water the 40 m DEM leaves between them)
  g.userData.decks = [{ x: -6, z: 0, hw: 23, hd: 18, top: 0, land: { x: 17, z: 0, dx: 1, dz: 0, w: 9 } }];
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
  // its south-east corner meets the bank 1.1-1.6 m under the deck
  g.userData.decks = [{ x: 0, z: 0, hw: 23, hd: 45, top: 0, land: { x: 23, z: -34, dx: 1, dz: 0, w: 7 } }];
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
  // (its sculpture, Changing Form, is a landmark of its own now)
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
  g.userData.decks = [{ x: 0, z: 0, hw: 20, hd: 30, top: 0 }];
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
// Boeing Field's pavement in the landmark's own frame, shared by airport()
// and airportSurface(): [across, along, width, length, top, crosswise]. The
// slabs stand `top` proud of the graded field; main.js installs this table's
// surface as `city.slabQuery`, which groundAt takes as the top surface. Before
// that every aircraft, then every car and walker, sat 35 cm into the apron.
const AIRPORT_RY = 0.52;
const AIRPORT_PAVE = [
  [0, 0, 46, 3048, 0.35],                      // runway 14R/32L
  [150, 0, 23, 2600, 0.35],                    // parallel taxiway, east
  ...[-2, -1, 0, 1, 2].map((k) => [75, k * 520, 18, 150, 0.33, true]),     // stubs joining them
  [-205, 70, 130, 380, 0.35],                  // GA apron, west
  [-120, 0, 20, 2900, 0.35],                   // full-length west taxiway
  ...[-1380, -900, -450, -40, 180, 620, 1100, 1380].map((kz) => [-60, kz, 16, 126, 0.33, true]),   // west stubs
  [0, -1500, 76, 60, 0.35], [0, 1500, 76, 60, 0.35],                     // threshold turnpads
];
// Where main.js parks the helicopters, painted as pads.
export const AIRPORT_HELIPADS = [[-165, -103], [-195, 232]];

/**
 * Height of Boeing Field's pavement at (x, z), or null off it. `ax, az` is
 * the landmark's position and `ay` the field elevation its group sits at.
 */
export function airportSurface(ax, az, ay) {
  const A = [Math.sin(AIRPORT_RY), Math.cos(AIRPORT_RY)], C = [Math.cos(AIRPORT_RY), -Math.sin(AIRPORT_RY)];
  let r2 = 0;
  for (const [dx, dz, w, len] of AIRPORT_PAVE) r2 = Math.max(r2, Math.hypot(Math.abs(dx) + w, Math.abs(dz) + len));
  r2 *= r2;
  return (x, z) => {
    const px = x - ax, pz = z - az;
    if (px * px + pz * pz > r2) return null;
    const u = px * C[0] + pz * C[1], v = px * A[0] + pz * A[1];   // across, along
    let top = null;
    for (const [dx, dz, w, len, t, cross] of AIRPORT_PAVE) {
      const hw = (cross ? len : w) / 2, hl = (cross ? w : len) / 2;
      if (Math.abs(u - dx) <= hw && Math.abs(v - dz) <= hl && (top === null || t > top)) top = t;
    }
    return top === null ? null : ay + top;
  };
}

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
  const mark = (dx, dz, w, len) => {
    const [lx, lz] = P2(dx, dz);
    g.add(box(w, 0.04, len, paintW, lx, 0.36, lz, RY));
  };
  // Runway, taxiways, stubs, apron, turnpads: AIRPORT_PAVE, which is also
  // the surface the aircraft stand on. A crosswise stub runs ACROSS, which
  // is box()'s local x at RY -- the stubs used to add a quarter turn on top,
  // the other convention's habit, and lay parallel to the runway in the
  // grass between it and the taxiways, joining nothing.
  for (const [dx, dz, w, len, top, cross] of AIRPORT_PAVE) {
    const [lx, lz] = P2(dx, dz);
    if (cross) g.add(box(len, 2.6, w, asphalt, lx, top - 2.6, lz, RY));
    else g.add(box(w, 2.6, len, asphalt, lx, top - 2.6, lz, RY));
  }
  // Helipads: a painted ring and an H. The ring's dashes are laid along
  // ALONG, so each is rotated into the ring by its own offset only -- short
  // enough (2.4 m on a 7.5 m radius) to read as a circle.
  for (const [hx, hz] of AIRPORT_HELIPADS) {
    for (let k = 0; k < 18; k++) {
      const a = (k / 18) * Math.PI * 2;
      const [lx, lz] = P2(hx + Math.cos(a) * 7.5, hz + Math.sin(a) * 7.5);
      g.add(box(0.45, 0.04, 2.4, paintW, lx, 0.36, lz, RY - a));
    }
    mark(hx - 1.6, hz, 0.6, 4.4); mark(hx + 1.6, hz, 0.6, 4.4); mark(hx, hz, 3.2, 0.6);
  }
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
 * The seaplane dock at Lake Union's south-west corner, where Kenmore Air's
 * real terminal is (47.6290 N, 122.3393 W; Westlake Ave N). Not an OSM
 * landmark -- the game's own fixture, placed by hand from the measured shore:
 * at z -1960 the terrain crosses the lake's 5.31 m surface at x -146 and the
 * water mask starts at x -120.
 *
 * It used to be a pier 900 m up the wrong shore at (-140, -2800), with the
 * floatplane parked alone at the real site, and its deck was drawn but not
 * walkable: groundAt answered the lakebed under it. Everything here is laid
 * out in WORLD axes (the group is never rotated), and the builder registers
 * the exact tops it draws as city platforms, so what you walk on is what is
 * drawn. The layout, west to east:
 *
 *   landing   x -158..-146, z -1968..-1952, top PIER_Y: runs into the bank,
 *             so walking down the lawn from Westlake you step straight on
 *   pier      x -146..-114, 4 m wide on z -1960, top PIER_Y, railed
 *   gangway   x -114..-102.5, 1.6 m wide, PIER_Y down to FLOAT_Y
 *   float     x -102.5..-99.5, z -1986..-1934, top FLOAT_Y, low curbs
 *
 * The rails and curbs are solids for walkers AND fenders for boats (a solid's
 * band reaches 2.5 m under its y0); the moorings below sit clear of them.
 */
const DOCK = { x: -130, z: -1960 };
export const LAKE_UNION_Y = 5.31;
const PIER_Y = 6.75, FLOAT_Y = LAKE_UNION_Y + 0.45;
const FLOAT_X0 = -102.5, FLOAT_X1 = -99.5, FLOAT_Z0 = -1986, FLOAT_Z1 = -1934;
export const SEAPLANE_DOCK = {
  x: -128, z: -1960, name: 'Lake Union Seaplane Dock',
  level: LAKE_UNION_Y,
  // [type, x, z, heading, colour]. Heading PI faces north (-z). Each centre
  // sits its collision circle (0.7 x radius) clear of the float's curb.
  moorings: [
    ['floatplane', FLOAT_X1 + 3.1, -1946, Math.PI, 0xe8c53a],
    ['floatplane', FLOAT_X0 - 3.1, -1944, 0, 0xd8dde2],
    ['boat', FLOAT_X1 + 2.2, -1968, Math.PI, 0xf2f2ee],
    ['boat', FLOAT_X0 - 2.2, -1974, 0, 0x1f3f6a],
  ],
};

function seaplaneDock() {
  const g = new THREE.Group();
  const O = DOCK;
  const L = (x, z) => [x - O.x, z - O.z];            // world -> group-local
  const plat = [];
  const deckA = M(0x8a6f4d), deckB = M(0x7c6245), joist = M(0x5a4631), pile = M(0x4a3a2b);
  const rail = P(0x9aa1a6, 0.45, 0.6, 0.8), hullM = M(0xd9dcd6), rubM = M(0x2b2e31);
  // Planked deck over [x0, x1] x [z0, z1] at top y (or sloping y0 -> y1 along
  // +x for the gangway). Boards run ACROSS the walkway, two tones alternating,
  // 1.2 m to a board pair, so the deck reads as timber from the street.
  const deck = (x0, x1, z0, z1, y0, y1 = y0, th = 0.28) => {
    const n = Math.max(1, Math.round((x1 - x0) / 0.6));
    const slope = (y1 - y0) / (x1 - x0);
    for (let i = 0; i < n; i++) {
      const a = x0 + ((x1 - x0) * i) / n, b = x0 + ((x1 - x0) * (i + 1)) / n;
      const mx = (a + b) / 2, yt = y0 + (mx - x0) * slope;
      const [lx, lz] = L(mx, (z0 + z1) / 2);
      const bd = box(b - a - 0.02, th, z1 - z0, i % 2 ? deckB : deckA, lx, yt - th, lz);
      if (slope) bd.rotation.z = Math.atan(slope);
      g.add(bd);
    }
    // One platform, exactly the top drawn. `v` runs along +x here: rot -PI/2
    // turns citygen's local v = (-sin rot, cos rot) into world (+1, 0).
    plat.push({ x: (x0 + x1) / 2, z: (z0 + z1) / 2, hw: (z1 - z0) / 2, hd: (x1 - x0) / 2, rot: -Math.PI / 2, y0, y1 });
  };
  // A solid wall segment in world coords with a height band.
  const wall = (ax, az, bx, bz, y0, y1, t = 0.3) => {
    const [la, lb] = L((ax + bx) / 2, (az + bz) / 2);
    solidBox(g, la, lb, Math.hypot(bx - ax, bz - az) / 2 + t / 2, t / 2, Math.atan2(bz - az, bx - ax), y1, y0);
  };
  // Railing: posts every ~2 m, a top rail and a mid rail, and its solid.
  const railing = (ax, az, bx, bz, ya, yb = ya) => {
    const len = Math.hypot(bx - ax, bz - az), n = Math.max(1, Math.round(len / 2));
    for (let i = 0; i <= n; i++) {
      const t = i / n, [lx, lz] = L(ax + (bx - ax) * t, az + (bz - az) * t);
      g.add(cyl(0.035, 0.035, 1.05, rail, lx, ya + (yb - ya) * t, lz, 6));
    }
    const ang = Math.atan2(bz - az, bx - ax), [mx, mz] = L((ax + bx) / 2, (az + bz) / 2);
    for (const h of [1.02, 0.55]) {
      const r = box(len, 0.05, 0.05, rail, mx, (ya + yb) / 2 + h, mz, -ang);
      r.rotation.z = Math.atan2(yb - ya, len) * Math.cos(ang);
      r.rotation.x = -Math.atan2(yb - ya, len) * Math.sin(ang);
      g.add(r);
    }
    wall(ax, az, bx, bz, Math.min(ya, yb) - 0.3, Math.max(ya, yb) + 1.2);
  };
  // Piles from the lakebed (or bank) up through the deck, capped.
  const pileAt = (x, z, top) => {
    const bed = G.terrainHeight(x, z) - 0.4, [lx, lz] = L(x, z);
    if (bed > top - 0.3) return;
    g.add(cyl(0.16, 0.18, top + 0.18 - bed, pile, lx, bed, lz, 7));
  };

  // --- landing and pier ----------------------------------------------------
  deck(-158, -146, -1968, -1952, PIER_Y);
  deck(-146, -114, -1962, -1958, PIER_Y);
  // Piles under the pier's two edges, and round the landing's water side --
  // never through the landing's floor, where their caps stood up as stumps.
  for (let x = -142; x <= -114; x += 4) for (const z of [-1962.1, -1957.9]) pileAt(x, z, PIER_Y);
  for (const z of [-1968.1, -1951.9]) for (const x of [-154, -150, -145.9]) pileAt(x, z, PIER_Y);
  for (const z of [-1964.5, -1955.5]) pileAt(-145.9, z, PIER_Y);
  // joists under the deck edge, so the pier has a fascia and not a floating plank sheet
  for (const z of [-1962.05, -1957.95]) {
    const [lx, lz] = L(-130, z);
    g.add(box(32, 0.34, 0.12, joist, lx, PIER_Y - 0.62, lz));
  }
  // Rails where the deck stands over the water or the steep bank. The
  // landing's west half runs into the ground and is left open, like its west
  // edge, so the lawn is the way on.
  railing(-152, -1968, -146, -1968, PIER_Y);
  railing(-152, -1952, -146, -1952, PIER_Y);
  railing(-146, -1968, -146, -1962.1, PIER_Y);
  railing(-146, -1957.9, -146, -1952, PIER_Y);
  railing(-146, -1962.1, -114, -1962.1, PIER_Y);
  railing(-146, -1957.9, -114, -1957.9, PIER_Y);

  // --- gangway down to the float ------------------------------------------
  deck(-114, FLOAT_X0, -1960.8, -1959.2, PIER_Y, FLOAT_Y, 0.16);
  railing(-114, -1960.9, FLOAT_X0, -1960.9, PIER_Y, FLOAT_Y);
  railing(-114, -1959.1, FLOAT_X0, -1959.1, PIER_Y, FLOAT_Y);

  // --- the float -----------------------------------------------------------
  // Pontoon body: white HDPE flanks to below the waterline, a black rub
  // strake along the top edge, the timber deck on top.
  {
    const [lx, lz] = L((FLOAT_X0 + FLOAT_X1) / 2, (FLOAT_Z0 + FLOAT_Z1) / 2);
    g.add(box(FLOAT_X1 - FLOAT_X0 - 0.1, FLOAT_Y - 0.22 - (LAKE_UNION_Y - 0.4), FLOAT_Z1 - FLOAT_Z0 - 0.1, hullM, lx, LAKE_UNION_Y - 0.4, lz));
    g.add(box(FLOAT_X1 - FLOAT_X0 + 0.12, 0.16, FLOAT_Z1 - FLOAT_Z0 + 0.12, rubM, lx, FLOAT_Y - 0.36, lz));
  }
  {
    // boards run across the float: x is its short axis, so lay them in z
    const n = Math.round((FLOAT_Z1 - FLOAT_Z0) / 0.6);
    for (let i = 0; i < n; i++) {
      const a = FLOAT_Z0 + ((FLOAT_Z1 - FLOAT_Z0) * i) / n, b = FLOAT_Z0 + ((FLOAT_Z1 - FLOAT_Z0) * (i + 1)) / n;
      const [lx, lz] = L((FLOAT_X0 + FLOAT_X1) / 2, (a + b) / 2);
      g.add(box(FLOAT_X1 - FLOAT_X0, 0.22, b - a - 0.02, i % 2 ? deckB : deckA, lx, FLOAT_Y - 0.22, lz));
    }
    plat.push({ x: (FLOAT_X0 + FLOAT_X1) / 2, z: (FLOAT_Z0 + FLOAT_Z1) / 2, hw: (FLOAT_X1 - FLOAT_X0) / 2,
      hd: (FLOAT_Z1 - FLOAT_Z0) / 2, rot: 0, y0: FLOAT_Y, y1: FLOAT_Y });
  }
  // Curbs (a 12 cm timber kerb round the edge -- what stops a walker, and a
  // boat, going over), cleats every 4 m, and the gap where the gangway lands.
  const curb = (ax, az, bx, bz) => {
    const len = Math.hypot(bx - ax, bz - az), [mx, mz] = L((ax + bx) / 2, (az + bz) / 2);
    const ang = Math.atan2(bz - az, bx - ax);
    g.add(box(len, 0.12, 0.14, joist, mx, FLOAT_Y, mz, -ang));
    wall(ax, az, bx, bz, FLOAT_Y - 0.3, FLOAT_Y + 1.0, 0.24);
  };
  curb(FLOAT_X1 - 0.07, FLOAT_Z0, FLOAT_X1 - 0.07, FLOAT_Z1);
  curb(FLOAT_X0 + 0.07, FLOAT_Z0, FLOAT_X0 + 0.07, -1961.0);
  curb(FLOAT_X0 + 0.07, -1959.0, FLOAT_X0 + 0.07, FLOAT_Z1);
  curb(FLOAT_X0, FLOAT_Z0 + 0.07, FLOAT_X1, FLOAT_Z0 + 0.07);
  curb(FLOAT_X0, FLOAT_Z1 - 0.07, FLOAT_X1, FLOAT_Z1 - 0.07);
  const cleatM = P(0x6d7378, 0.4, 0.7, 0.8);
  for (let z = FLOAT_Z0 + 3; z < FLOAT_Z1 - 1; z += 4) {
    for (const x of [FLOAT_X0 + 0.32, FLOAT_X1 - 0.32]) {
      const [lx, lz] = L(x, z);
      g.add(box(0.12, 0.1, 0.34, cleatM, lx, FLOAT_Y, lz));
    }
  }
  // Guide piles the float rides on, one at each end and two mid-way.
  for (const z of [FLOAT_Z0 - 0.35, -1960, FLOAT_Z1 + 0.35]) {
    for (const x of [FLOAT_X0 - 0.3, FLOAT_X1 + 0.3]) {
      if (z === -1960 && x < FLOAT_X0) continue;
      const bed = G.terrainHeight(x, z) - 0.4, [lx, lz] = L(x, z);
      g.add(cyl(0.2, 0.22, FLOAT_Y + 1.6 - bed, pile, lx, bed, lz, 8));
      g.add(cyl(0.23, 0.2, 0.08, rail, lx, FLOAT_Y + 1.6, lz, 8));
      solidCircle(g, lx, lz, 0.25, FLOAT_Y + 1.7, bed + 1.5);
    }
  }
  // Life ring and a fuel point on the float, the things that say "dock".
  {
    const [lx, lz] = L(FLOAT_X1 - 0.45, -1956);
    g.add(box(0.5, 1.2, 0.5, M(0xb8352a), lx, FLOAT_Y, lz));
    g.add(box(0.36, 0.14, 0.52, P(0x2f3438, 0.5, 0.3), lx, FLOAT_Y + 1.2, lz));
    solidBox(g, lx, lz, 0.28, 0.28, 0, FLOAT_Y + 1.4, FLOAT_Y - 0.3);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.32, 0.07, 6, 14), M(0xe86a1c));
    const [rx, rz] = L(-114.4, -1962.15);
    ring.position.set(rx, PIER_Y + 0.62, rz);
    g.add(ring);
  }

  // --- terminal kiosk on the landing ---------------------------------------
  {
    const [kx, kz] = L(-152.5, -1965.2);
    g.add(box(5.2, 2.7, 3.2, M(0xe4dfd2), kx, PIER_Y, kz));
    g.add(box(6.0, 0.22, 4.0, M(0x35505f), kx, PIER_Y + 2.7, kz));
    // windows and a door on the +z face, toward the walkway
    g.add(box(3.2, 1.0, 0.06, P(0x1d2a33, 0.15, 0.2, 1.2), kx - 0.6, PIER_Y + 1.1, kz + 1.61));
    g.add(box(0.9, 2.0, 0.06, M(0x35505f), kx + 1.7, PIER_Y, kz + 1.61));
    solidBox(g, kx, kz, 2.7, 1.7, 0, PIER_Y + 3, PIER_Y - 0.3);
    const s = sign('SEAPLANES · BOATS', 4.6, 0.62, '#1f3a4a', '#f4efe2', { px: 60 });
    s.position.set(kx, PIER_Y + 3.2, kz + 1.2);
    g.add(s);
    // a second sign facing the street, up on two posts at the lawn's edge
    const [sx, sz] = L(-161, -1960);
    for (const dz of [-1.6, 1.6]) g.add(cyl(0.06, 0.06, 2.6, rail, sx, G.terrainHeight(-161, -1960 + dz) - 0.2, sz + dz, 6));
    const s2 = sign('LAKE UNION\nSEAPLANE DOCK', 3.4, 1.3, '#1f3a4a', '#f4efe2', { px: 60 });
    s2.position.set(sx - 0.07, G.terrainHeight(-161, -1960) + 1.9, sz);
    s2.rotation.y = -Math.PI / 2;
    g.add(s2);
    solidCircle(g, sx, sz - 1.6, 0.12, G.terrainHeight(-161, -1960) + 3);
    solidCircle(g, sx, sz + 1.6, 0.12, G.terrainHeight(-161, -1960) + 3);
  }
  // benches along the landing's north side
  for (const x of [-156.2, -151]) {
    const [bx, bz] = L(x, -1953.2);
    g.add(box(1.8, 0.08, 0.5, deckA, bx, PIER_Y + 0.42, bz));
    g.add(box(1.8, 0.4, 0.08, deckB, bx, PIER_Y + 0.5, bz + 0.24));
    for (const d of [-0.75, 0.75]) g.add(box(0.08, 0.42, 0.44, rail, bx + d, PIER_Y, bz));
  }

  g.userData.platforms = plat;
  g.userData.worldAligned = true;
  return g;
}

/**
 * Marinas and seaplane bases round the region: a timber pier off the bank, a
 * gangway down to a floating walkway with a T-head, and boats, jet skis and
 * floatplanes tied up alongside ('apron', like the seaplane dock's). Sited at
 * the real places (world coordinates from their lat/lon via tools/proj.py);
 * the shore itself comes from the water mask, so each is laid out from the
 * nearest shoreline outward, into water deep enough to float a hull.
 */
// ---------------------------------------------------------------------------
// BEACHES. The lot layer paints OSM's natural=beach as sand (build_lots.py);
// these are what stand on it, laid on the DRY sand of each beach in
// data/beaches.json by what that beach is. Puget Sound beaches carry the
// Northwest's signature, bleached driftwood logs above the tideline; Alki and
// Golden Gardens their sand volleyball courts and concrete fire rings; the
// lake swim beaches a lifeguard chair and a swim raft offshore. Every beach
// people use gets umbrellas and towels.
const BEACH_UMBRELLA = [0xd8352a, 0x2a6fd0, 0xf2c32a, 0x1f9e8f, 0xf07a1c, 0x7a3fc2, 0x2e8b3d];
const BEACH_TOWEL = [0xe84d6b, 0x3aa3e8, 0xf5d547, 0x6bd07a, 0xf08a3c, 0xffffff, 0x9b6bd8];
// Kits by name, or by where an unnamed beach is (Golden Gardens is not named
// in OSM). `lake` beaches are Seattle Parks' guarded swim beaches.
// Seattle Parks guards eight beaches, all on the lakes (seattle.gov/parks,
// swimming beaches, 2025); East Green Lake did not open in 2025, so it gets
// its raft and no chair.
const BEACH_KIT = [
  { match: /^Alki Beach$/, kit: 'alki' },
  { near: [-5000, -8900, 500], kit: 'golden' },
  { match: /Madison Park Beach|Matthews Beach|Magnuson Park Beach|Mount Baker Beach|Pritchard Island Beach|West Green Lake Beach|Madrona|Seward/, kit: 'lake' },
  { match: /East Green Lake Beach/, kit: 'lakeNoGuard' },
];
// Courts and fire pits where OSM maps them [lat, lon]: Alki's seven sand
// volleyball courts in a diagonal line (ways 262498251-257), Golden Gardens'
// four courts and seven fire pits north-west of the 1929 bathhouse (nodes
// 7009847730-736).
const BEACH_COURTS = {
  alki: { from: [47.58167, -122.40500], to: [47.58249, -122.40317], n: 7 },
  golden: { from: [47.69170, -122.40420], to: [47.69210, -122.40460], n: 4 },
};
const BEACH_FIRES = { golden: { from: [47.69217, -122.40488], to: [47.69313, -122.40578], n: 7 } };
function beachKit(b, cx, cz, fresh) {
  for (const k of BEACH_KIT) {
    if (k.match && k.match.test(b.name)) return k.kit;
    if (k.near && Math.hypot(cx - k.near[0], cz - k.near[1]) < k.near[2]) return k.kit;
  }
  // an unguarded beach on a lake: towels and umbrellas, no driftwood
  return fresh ? 'lakeside' : 'sound';
}

/** A beach umbrella: pole, eight-panel canopy in alternating colour and white. */
function umbrella(g, x, y, z, col, tilt, rnd) {
  const pole = P(0xf2f2ee, 0.5, 0.2, 0.6);
  const H = 2.15 + rnd() * 0.25, R = 1.05 + rnd() * 0.25;
  const top = V(x + Math.sin(tilt) * 0.35, y + H, z + Math.cos(tilt) * 0.35);
  g.add(strut(V(x, y - 0.3, z), top, 0.025, pole, 5));
  const a = P(col, 0.7, 0, 0.55), w = P(0xf4f2ea, 0.7, 0, 0.55);
  const N = 8;
  for (const [m, odd] of [[a, 0], [w, 1]]) {
    const pos = [];
    for (let i = odd; i < N; i += 2) {
      const t0 = (i / N) * Math.PI * 2, t1 = ((i + 1) / N) * Math.PI * 2;
      const drop = 0.42;
      pos.push(top.x, top.y + 0.12, top.z,
        top.x + Math.cos(t1) * R, top.y - drop, top.z + Math.sin(t1) * R,
        top.x + Math.cos(t0) * R, top.y - drop, top.z + Math.sin(t0) * R);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.computeVertexNormals();
    const mesh = new THREE.Mesh(geo, m);
    mesh.material = m;
    g.add(mesh);
  }
}

/** A driftwood log above the tideline: bleached trunk, darker cut ends, a root wad on the big ones. */
function driftLog(g, x, y, z, yaw, len, r, rnd) {
  const wood = P(0x9d968a, 0.95, 0, 0.5), end = P(0x6e675c, 0.95, 0, 0.45);
  const dx = Math.cos(yaw) * len / 2, dz = Math.sin(yaw) * len / 2;
  const sink = r * 0.35;
  const a = V(x - dx, y + r - sink, z - dz), b = V(x + dx, y + r * 0.8 - sink, z + dz);
  g.add(strut(a, b, r, wood, 7));
  const cap = (p, rr) => { const m = new THREE.Mesh(new THREE.SphereGeometry(rr, 7, 5), end); m.scale.set(1, 1, 1); m.position.copy(p); g.add(m); };
  cap(a, r * 0.97); cap(b, r * 0.78);
  if (len > 7 && rnd() < 0.5) {
    // the root wad: a knot of stubs at the thick end
    for (let k = 0; k < 5; k++) {
      const t = (k / 5) * Math.PI * 2;
      g.add(strut(a, V(a.x - Math.cos(yaw) * 0.6 + Math.cos(t) * r * 1.8, a.y + Math.sin(t) * r * 1.6 + r * 0.4, a.z - Math.sin(yaw) * 0.6 + Math.sin(t + 1) * r * 1.8), r * 0.28, wood, 5));
    }
  }
}

/** A towel laid flat, and sometimes a cooler beside it. */
function towel(g, x, y, z, yaw, col, rnd) {
  g.add(box(0.85, 0.02, 1.7, P(col, 0.95, 0, 0.5), x, y + 0.01, z, yaw));
  if (rnd() < 0.3) g.add(box(0.5, 0.36, 0.34, P(rnd() < 0.5 ? 0x2a6fd0 : 0xd8352a, 0.5, 0.1, 0.6), x + Math.cos(yaw) * 0.8, y, z - Math.sin(yaw) * 0.8, yaw));
}

/** Seattle Parks' concrete fire ring: a low ring with char in it. */
function fireRing(g, x, y, z) {
  const conc = P(0x8a8a86, 0.9, 0, 0.5), ash = P(0x2a2724, 1, 0, 0.3);
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.85, 0.16, 6, 16), conc);
  ring.rotation.x = Math.PI / 2; ring.position.set(x, y + 0.3, z);
  g.add(ring);
  g.add(cyl(0.72, 0.72, 0.36, conc, x, y - 0.05, z, 14));
  g.add(cyl(0.66, 0.66, 0.02, ash, x, y + 0.31, z, 12));
  solidCircle(g, x, z, 1.0, 0.5);
}

/** A sand volleyball court: two posts, a net, and a rope boundary 8 x 16 m. */
function volleyball(g, x, y, z, yaw) {
  const post = P(0xe8e8e2, 0.5, 0.3, 0.6), net = P(0x1b1b1b, 0.9, 0, 0.4), rope = P(0x2a6fd0, 0.8, 0, 0.5);
  const lx = Math.cos(yaw), lz = -Math.sin(yaw), fx = Math.sin(yaw), fz = Math.cos(yaw);
  for (const sd of [-1, 1]) {
    const px = x + lx * sd * 4.8, pz = z + lz * sd * 4.8;
    g.add(cyl(0.06, 0.06, 2.6, post, px, y - 0.2, pz, 6));
    solidCircle(g, px, pz, 0.15, 2.4);
  }
  g.add(box(9.6, 0.9, 0.02, net, x, y + 1.53, z, yaw));
  g.add(box(9.6, 0.06, 0.03, P(0xf4f4f0, 0.6, 0, 0.6), x, y + 2.43, z, yaw));
  for (const [du, dv, len, along] of [[0, 8, 8, 0], [0, -8, 8, 0], [4, 0, 16, 1], [-4, 0, 16, 1]]) {
    g.add(box(along ? 0.05 : len, 0.03, along ? len : 0.05, rope, x + lx * du + fx * dv, y, z + lz * du + fz * dv, yaw));
  }
}

/** A lifeguard chair: white A-frame with a seat 2 m up, a red rescue can. */
function lifeguardChair(g, x, y, z, yaw) {
  const wood = P(0xf2f2ee, 0.7, 0, 0.6), red = P(0xd8352a, 0.6, 0, 0.6);
  const lx = Math.cos(yaw), lz = -Math.sin(yaw), fx = Math.sin(yaw), fz = Math.cos(yaw);
  for (const sd of [-1, 1]) {
    const bx = x + lx * sd * 0.7, bz = z + lz * sd * 0.7;
    g.add(strut(V(bx - fx * 0.8, y, bz - fz * 0.8), V(bx - fx * 0.1, y + 2.1, bz - fz * 0.1), 0.06, wood, 5));
    g.add(strut(V(bx + fx * 0.6, y, bz + fz * 0.6), V(bx + fx * 0.1, y + 2.1, bz + fz * 0.1), 0.06, wood, 5));
  }
  g.add(box(1.5, 0.08, 0.7, wood, x, y + 2.1, z, yaw));
  g.add(box(1.5, 0.7, 0.06, wood, x - fx * 0.32, y + 2.18, z - fz * 0.32, yaw));
  for (let k = 0; k < 4; k++) g.add(box(1.4, 0.05, 0.08, wood, x - fx * (0.7 - k * 0.1), y + 0.4 + k * 0.45, z - fz * (0.7 - k * 0.1), yaw));
  g.add(box(0.2, 0.12, 0.8, red, x + lx * 0.5, y + 2.2, z + lz * 0.5, yaw));
  umbrella(g, x - fx * 0.2, y + 2.1, z - fz * 0.2, 0xd8352a, 0, () => 0.3);
  solidCircle(g, x, z, 0.9, 2.2);
}

/** A swim raft: white float with a ladder and a low diving board, on the water. */
function swimRaft(g, x, y, z, yaw) {
  const deck = P(0xeeeeea, 0.7, 0, 0.6), drum = P(0x3a3f44, 0.8, 0, 0.4);
  g.add(box(4.2, 0.35, 4.2, deck, x, y + 0.25, z, yaw));
  g.add(box(4.0, 0.3, 4.0, drum, x, y - 0.05, z, yaw));
  const fx = Math.sin(yaw), fz = Math.cos(yaw);
  g.add(box(0.5, 0.06, 2.4, P(0x2a6fd0, 0.5, 0.1, 0.6), x + fx * 1.4, y + 0.9, z + fz * 1.4, yaw));
  g.add(box(0.6, 0.35, 0.3, deck, x + fx * 0.6, y + 0.6, z + fz * 0.6, yaw));
  for (const sd of [-0.35, 0.35]) g.add(strut(V(x - fx * 2.1 + Math.cos(yaw) * sd, y - 0.6, z - fz * 2.1 - Math.sin(yaw) * sd), V(x - fx * 2.1 + Math.cos(yaw) * sd, y + 1.1, z - fz * 2.1 - Math.sin(yaw) * sd), 0.03, P(0xc9cdd1, 0.3, 0.9, 0.8), 5));
}

/**
 * The props for every beach: [{ key, g }] in world coordinates. `wl(x, z)`
 * is the local water surface (null on land). Only DRY sand counts -- the
 * lot is sand and the ground stands 0.3 m+ over the water beside it -- and
 * each prop keeps off roads and buildings.
 */
/**
 * Show the near-only landmark meshes (the beaches' props) within range of
 * `cam`. Returns whether any changed (the phone's shadow cache redraws then).
 */
export function updateLandmarkRange(root, cam) {
  let changed = false;
  for (const n of root.userData.near) {
    const c = n.s.center, d = n.r + n.s.radius;
    const dx = cam.x - c.x, dz = cam.z - c.z;
    const v = dx * dx + dz * dz < d * d;
    if (v !== n.o.visible) { n.o.visible = v; changed = true; }
  }
  return changed;
}

export function beachProps(beaches, city, wl) {
  const out = [];
  const SAND = G.LOT_KINDS.indexOf('sand');
  beaches.forEach((b, bi) => {
    let cx = 0, cz = 0;
    for (const [x, z] of b.o) { cx += x; cz += z; }
    cx /= b.o.length; cz /= b.o.length;
    // fresh water: the nearest water on the beach's outline stands above the sea
    let fresh = false;
    for (const [x, z] of b.o) { const w = wl(x, z); if (w !== null && G.isWater(x, z)) { fresh = w > 1; break; } }
    const kit = beachKit(b, cx, cz, fresh);
    // a seeded stream per beach, so the layout is the same every boot
    let seed = (bi * 9973 + 17) >>> 0;
    const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
    const surf = (x, z) => { const w = wl(x, z); return w === null ? 0 : w; };
    // level: the sand runs up Discovery Park's bluff, and nothing lies on that
    const level = (x, z) => Math.hypot(G.terrainHeight(x + 2, z) - G.terrainHeight(x - 2, z),
      G.terrainHeight(x, z + 2) - G.terrainHeight(x, z - 2)) < 4 * 0.2;
    const dry = (x, z) => G.lotAt(x, z) === SAND && G.terrainHeight(x, z) > surf(x, z) + 0.3 && level(x, z)
      && !(city && city.onRoad(x, z, 1.5)) && !(city && city.buildingsNear(x, z, 4).some((bd) => {
        const c = Math.cos(-bd.rot), sn = Math.sin(-bd.rot), dx = x - bd.x, dz = z - bd.z;
        return Math.abs(dx * c - dz * sn) < bd.w / 2 + 1.5 && Math.abs(dx * sn + dz * c) < bd.d / 2 + 1.5;
      }));
    // candidate points: a 2.5 m grid over the beach's box and its 10 m band
    let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    for (const [x, z] of b.o) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z); }
    const pts = [];
    for (let z = z0 - 10; z <= z1 + 10; z += 2.5) for (let x = x0 - 10; x <= x1 + 10; x += 2.5) {
      if (!dry(x, z)) continue;
      const sd = G.shoreDist(x, z);
      if (sd <= 0 || sd > 58) continue;
      pts.push([x, z, sd]);
    }
    if (pts.length < 6) return;
    const g = new THREE.Group();
    // which way is the water: down the shore-distance gradient
    const toWater = (x, z) => {
      const gx = G.shoreDist(x + 4, z) - G.shoreDist(x - 4, z), gz = G.shoreDist(x, z + 4) - G.shoreDist(x, z - 4);
      return Math.atan2(-gx, -gz);          // heading that faces the water
    };
    const maxSd = pts.reduce((m, p) => Math.max(m, p[2]), 0);
    const used = [];
    const free = (x, z, r) => used.every(([ux, uz, ur]) => Math.hypot(ux - x, uz - z) > ur + r);
    const pick = (filter, r, tries = 40) => {
      for (let t = 0; t < tries; t++) {
        const p = pts[Math.floor(rnd() * pts.length)];
        if (!filter(p) || !free(p[0], p[1], r)) continue;
        used.push([p[0], p[1], r]);
        return p;
      }
      return null;
    };
    const Y = (x, z) => G.terrainHeight(x, z);
    const dryArea = pts.length * 6.25;
    // Driftwood above the tideline on the Sound, lying along the shore
    if (kit === 'sound' || kit === 'alki' || kit === 'golden') {
      const n = Math.min(60, Math.round(dryArea / 180));
      for (let i = 0; i < n; i++) {
        const p = pick((q) => q[2] > maxSd * 0.55, 3.5);
        if (!p) break;
        const h = toWater(p[0], p[1]);
        driftLog(g, p[0], Y(p[0], p[1]), p[1], -h + (rnd() - 0.5) * 0.8, 4 + rnd() * 9, 0.22 + rnd() * 0.3, rnd);
      }
    }
    // Umbrellas and towels, mid-beach, facing the water
    const people = kit === 'sound' ? Math.min(10, Math.round(dryArea / 900)) : Math.min(36, Math.round(dryArea / 300));
    for (let i = 0; i < people; i++) {
      const p = pick((q) => q[2] > 3 && q[2] < maxSd * 0.8, 2.6);
      if (!p) break;
      const h = toWater(p[0], p[1]), y = Y(p[0], p[1]);
      if (rnd() < 0.7) umbrella(g, p[0], y, p[1], BEACH_UMBRELLA[Math.floor(rnd() * BEACH_UMBRELLA.length)], h + Math.PI, rnd);
      const k = 1 + Math.floor(rnd() * 2);
      for (let t = 0; t < k; t++) {
        const off = (t - (k - 1) / 2) * 1.1;
        towel(g, p[0] + Math.cos(h) * off + Math.sin(h) * 0.9, y, p[1] - Math.sin(h) * off + Math.cos(h) * 0.9, h, BEACH_TOWEL[Math.floor(rnd() * BEACH_TOWEL.length)], rnd);
      }
    }
    // Courts and fire pits at their mapped places, along the line OSM gives,
    // each nudged onto the nearest dry sand
    const along = (spec, fn) => {
      const [ax, az] = G.toWorld(spec.from[0], spec.from[1]), [bx, bz] = G.toWorld(spec.to[0], spec.to[1]);
      for (let i = 0; i < spec.n; i++) {
        const t = spec.n > 1 ? i / (spec.n - 1) : 0.5;
        let x = ax + (bx - ax) * t, z = az + (bz - az) * t;
        if (!dry(x, z)) {
          let best = null, bd = Infinity;
          for (const p of pts) { const d = Math.hypot(p[0] - x, p[1] - z); if (d < bd) { bd = d; best = p; } }
          if (!best || bd > 25) continue;
          [x, z] = best;
        }
        used.push([x, z, 5]);
        fn(x, z, Math.atan2(bx - ax, bz - az));
      }
    };
    if (BEACH_COURTS[kit]) along(BEACH_COURTS[kit], (x, z, h) => volleyball(g, x, Y(x, z), z, h + Math.PI / 2));
    if (BEACH_FIRES[kit]) along(BEACH_FIRES[kit], (x, z) => fireRing(g, x, Y(x, z), z));
    else if (kit === 'alki') {
      // Alki has fire rings too, first come; no count is published
      for (let i = 0; i < 8; i++) {
        const p = pick((q) => q[2] > maxSd * 0.45, 3);
        if (p) fireRing(g, p[0], Y(p[0], p[1]), p[1]);
      }
    }
    if (kit === 'lake' || kit === 'lakeNoGuard') {
      const p = pick((q) => q[2] > 4, 3, 80);
      if (p) {
        const h = toWater(p[0], p[1]);
        if (kit === 'lake') lifeguardChair(g, p[0], Y(p[0], p[1]), p[1], h);
        // the raft 30-40 m out, where it is deep enough to dive
        for (let d = 30; d <= 55; d += 5) {
          const rx = p[0] + Math.sin(h) * d, rz = p[1] + Math.cos(h) * d, w = wl(rx, rz);
          if (w !== null && G.isWater(rx, rz) && w - G.terrainHeight(rx, rz) > 2.5) { swimRaft(g, rx, w, rz, h); break; }
        }
      }
    }
    if (g.children.length) out.push({ key: `beach${bi}`, name: b.name, kit, g, x: cx, z: cz });
  });
  return out;
}

export const MARINAS = [
  { name: 'Renton Seaplane Base', x: 9037, z: 12324, fleet: ['floatplane', 'floatplane', 'floatplane', 'boat'], seaplanes: true },
  { name: 'Seattle Seaplanes', x: 820, z: -2242, fleet: ['floatplane', 'floatplane', 'jetski'], seaplanes: true },
  { name: 'Shilshole Bay Marina', x: -5255, z: -7812, fleet: ['boat', 'jetski', 'boat', 'boat', 'jetski', 'boat'] },
  { name: 'Elliott Bay Marina', x: -4263, z: -2041, fleet: ['boat', 'boat', 'jetski', 'boat'] },
  { name: 'Bell Harbor Marina', x: -722, z: 205, fleet: ['boat', 'jetski', 'boat'] },
  { name: 'Leschi Marina', x: 3940, z: 1205, fleet: ['boat', 'jetski', 'jetski', 'boat'] },
  { name: 'Carillon Point', x: 9842, z: -4910, fleet: ['boat', 'boat', 'jetski'] },
  { name: 'Kirkland Marina Park', x: 9669, z: -7111, fleet: ['jetski', 'boat', 'jetski', 'boat'] },
  { name: 'Meydenbauer Bay Marina', x: 9766, z: -185, fleet: ['boat', 'boat', 'jetski', 'jetski'] },
  { name: 'Luther Burbank Park', x: 8413, z: 2317, fleet: ['jetski', 'boat', 'jetski'] },
];
const BOAT_PAINT = [0xf2f2ee, 0x1f3f6a, 0xb8352a, 0xe8e2d0, 0x2d5a45, 0x3c4450];
const SKI_PAINT = [0xf2c21a, 0x1e7fd0, 0xd8322a, 0x21b3a0, 0xf07a1c, 0x7a3fc2];

/**
 * Lay a marina out from its site. `wl(x, z)` is the local water surface or
 * null. Returns null when no shore with deep enough water is in reach.
 */
function marinaDock(spec, wl, idx) {
  const depth = (x, z) => {
    const w = G.isWater(x, z) ? wl(x, z) : null;
    return w === null ? -1 : w - G.terrainHeight(x, z);
  };
  // THE SHORE IS WHERE THE DRAWN GROUND MEETS THE WATER, not the water
  // mask's edge: the two disagree by tens of metres along a 40 m DEM, and a
  // dock sited on the mask stood out in the water, its pier reaching nothing.
  // Land nearest the site (ground over the local surface), then the deep water
  // nearest that, then the crossing between them.
  const lvl0 = (() => {
    for (let r = 0; r <= 320; r += 10) for (let k = 0; k < 16; k++) {
      const a = (k / 16) * Math.PI * 2, w = wl(spec.x + Math.cos(a) * r, spec.z + Math.sin(a) * r);
      if (w !== null && G.isWater(spec.x + Math.cos(a) * r, spec.z + Math.sin(a) * r)) return w;
    }
    return null;
  })();
  if (lvl0 === null) return null;
  const nearest = (cx, cz, R, ok) => {
    let bp = null, bd = Infinity;
    for (let dz = -R; dz <= R; dz += 4) for (let dx = -R; dx <= R; dx += 4) {
      const d2 = dx * dx + dz * dz;
      if (d2 < bd && ok(cx + dx, cz + dz)) { bd = d2; bp = [cx + dx, cz + dz]; }
    }
    return bp;
  };
  // real land, not a DEM pixel or a breakwater standing out of the water:
  // dry 25 m out in most directions too
  const dry = (x, z) => G.terrainHeight(x, z) > lvl0 + 0.5 && !G.isWater(x, z);
  const D = nearest(spec.x, spec.z, 320, (x, z) => {
    if (!dry(x, z)) return false;
    let n = 0;
    for (let k = 0; k < 8; k++) { const a = (k / 8) * Math.PI * 2; if (dry(x + Math.cos(a) * 25, z + Math.sin(a) * 25)) n++; }
    return n >= 4;
  });
  if (!D) return null;
  const W = nearest(D[0], D[1], 240, (x, z) => depth(x, z) >= 2.0);
  if (!W) return null;
  let nx = W[0] - D[0], nz = W[1] - D[1];
  const nl = Math.hypot(nx, nz) || 1; nx /= nl; nz /= nl;
  let S = D;
  for (let t = 0; t < nl; t += 1) {
    const x = D[0] + nx * t, z = D[1] + nz * t;
    if (G.terrainHeight(x, z) < lvl0 + 0.3) { S = [x, z]; break; }
  }
  const level = lvl0;
  const px = -nz, pz = nx;
  const at = (t, o = 0) => [S[0] + nx * t + px * o, S[1] + nz * t + pz * o];
  // the float starts where the water floats a hull, 8-40 m out
  let t0 = 8;
  while (t0 < 40 && depth(...at(t0)) < 1.4) t0 += 2;
  if (depth(...at(t0)) < 1.4) return null;
  let len = 10;
  while (len < 44 && depth(...at(t0 + len + 2)) >= 1.4 && depth(...at(t0 + len + 2, 10)) >= 1.0) len += 2;
  const FY = level + 0.45;
  const land = at(-5);
  const LY = Math.max(G.terrainHeight(land[0], land[1]) + 0.3, level + 1.3);
  // the pier runs from the bank to where the gangway starts down
  const gl = Math.max(5, Math.min(12, (LY - FY) / 0.22));
  const tp = Math.max(-1, t0 - gl);
  const g = new THREE.Group();
  const plat = [], solids = [];
  const yaw = Math.atan2(nx, nz), vrot = Math.atan2(-nx, nz);
  const deckA = M(0x8a6f4d), deckB = M(0x7c6245), pile = M(0x4a3a2b), hullM = M(0xd9dcd6);
  const rail = P(0x9aa1a6, 0.45, 0.6, 0.8), rub = M(0x2b2e31);
  // a strip of deck along n from ta to tb, across [o0, o1], top y0 -> y1
  const strip = (ta, tb, o0, o1, y0, y1, th, float) => {
    const n = Math.max(1, Math.round((tb - ta) / 2.4));
    for (let i = 0; i < n; i++) {
      const a = ta + ((tb - ta) * i) / n, b = ta + ((tb - ta) * (i + 1)) / n;
      const [cx, cz] = at((a + b) / 2, (o0 + o1) / 2);
      const yt = y0 + (y1 - y0) * (((a + b) / 2 - ta) / (tb - ta));
      const bd = box(o1 - o0, th, b - a - 0.03, i % 2 ? deckB : deckA, cx, yt - th, cz, yaw);
      if (y1 !== y0) { bd.rotation.order = 'YXZ'; bd.rotation.x = -Math.atan2(y1 - y0, tb - ta); }
      g.add(bd);
    }
    const [mx, mz] = at((ta + tb) / 2, (o0 + o1) / 2);
    // 6 cm longer at each end, so neighbouring pieces overlap: meeting
    // exactly, the joint belonged to neither and a walker fell through it
    const e = 0.06, k = (y1 - y0) / (tb - ta);
    plat.push({ x: mx, z: mz, hw: (o1 - o0) / 2, hd: (tb - ta) / 2 + e, rot: vrot, y0: y0 - k * e, y1: y1 + k * e });
    if (float) {
      g.add(box(o1 - o0 - 0.1, FY - 0.22 - (level - 0.4), tb - ta - 0.1, hullM, mx, level - 0.4, mz, yaw));
      g.add(box(o1 - o0 + 0.1, 0.14, tb - ta + 0.1, rub, mx, FY - 0.34, mz, yaw));
    }
  };
  // a wall along an edge (from ta to tb at offset o), for walkers and hulls
  const edge = (ta, tb, o, y0, y1) => {
    const [cx, cz] = at((ta + tb) / 2, o);
    solids.push({ x: cx, z: cz, hw: 0.15, hd: (tb - ta) / 2, rot: -yaw, y0, y1 });
  };
  // pier and its piles and rails
  strip(-5, tp, -1.4, 1.4, LY, LY, 0.3, false);
  for (let t = -3; t <= tp; t += 3) for (const o of [-1.5, 1.5]) {
    const [x, z] = at(t, o), bed = G.terrainHeight(x, z) - 0.4;
    if (bed < LY - 0.5) g.add(cyl(0.15, 0.17, LY - bed, pile, x, bed, z, 7));
  }
  // gangway
  strip(tp, t0, -0.8, 0.8, LY, FY, 0.16, false);
  for (const o of [-0.85, 0.85]) {
    const [ax, az] = at(tp, o), [bx, bz] = at(t0, o);
    const L = Math.hypot(bx - ax, bz - az);
    const r = box(0.05, 0.05, L, rail, (ax + bx) / 2, (LY + FY) / 2 + 1.0, (az + bz) / 2, yaw);
    r.rotation.order = 'YXZ'; r.rotation.x = -Math.atan2(FY - LY, t0 - tp);
    g.add(r);
    edge(tp, t0, o, Math.min(LY, FY) - 0.3, Math.max(LY, FY) + 1.2);
  }
  // the float and its T-head
  // A T-head only where floatplanes tie up off it: along a walkway the craft
  // lie bow-out, and a head across their bows pinned them to the float.
  const head = spec.seaplanes ? 30 : 2.6;
  strip(t0, t0 + len, -1.3, 1.3, FY, FY, 0.22, true);
  strip(t0 + len, t0 + len + 2.6, -head / 2, head / 2, FY, FY, 0.22, true);
  for (const o of [-1.3, 1.3]) edge(t0 + 0.2, t0 + len, o, FY - 0.3, FY + 0.9);
  solids.push({ ...(() => { const [cx, cz] = at(t0 + len + 2.6, 0); return { x: cx, z: cz }; })(), hw: head / 2, hd: 0.15, rot: -yaw, y0: FY - 0.3, y1: FY + 0.9 });
  // guide piles at the corners of the head and along the walkway
  for (const [t, o] of [[t0 + len + 1.3, -head / 2 - 0.3], [t0 + len + 1.3, head / 2 + 0.3], [t0 + len / 2, -1.6], [t0 + len / 2, 1.6]].filter(([, o]) => spec.seaplanes || Math.abs(o) < 2)) {
    const [x, z] = at(t, o), bed = G.terrainHeight(x, z) - 0.4;
    g.add(cyl(0.2, 0.22, FY + 1.6 - bed, pile, x, bed, z, 8));
    solids.push({ x, z, r: 0.25, y0: bed + 1.5, y1: FY + 1.7 });
  }
  // a sign at the head of the pier, facing the land
  {
    const [x, z] = at(-5.4, 1.8);
    for (const d of [-0.9, 0.9]) {
      const [qx, qz] = [x + px * d, z + pz * d];
      g.add(cyl(0.05, 0.05, 2.4, rail, qx, LY - 0.3, qz, 6));
    }
    const sg = sign(spec.name.toUpperCase(), 2.8, 0.6, '#1f3a4a', '#f4efe2', { px: 60 });
    sg.position.set(x, LY + 1.8, z);
    sg.rotation.y = yaw + Math.PI;
    g.add(sg);
  }
  // moorings: floatplanes off the head, the rest down both sides of the walk
  const moor = [];
  let si = 0, t = t0 + 3.5;
  const colour = (ty, k) => (ty === 'jetski' ? SKI_PAINT : BOAT_PAINT)[(idx * 3 + k) % 6];
  spec.fleet.forEach((ty, k) => {
    if (ty === 'floatplane') {
      // either end of the head, then off its middle further out
      const slot = si++ % 3, side = slot === 0 ? -1 : slot === 1 ? 1 : 0;
      const [x, z] = at(t0 + len + (side ? 7.5 : 14), side * (head / 2 - 5));
      if (depth(x, z) >= 1.0) moor.push([ty, x, z, yaw, [0xe8c53a, 0xd8dde2, 0xc8453a][k % 3]]);
      return;
    }
    const side = k % 2 ? 1 : -1;
    const off = ty === 'jetski' ? 1.3 + 1.1 : 1.3 + 1.6;
    const [x, z] = at(t, side * off);
    if (depth(x, z) >= 1.0) moor.push([ty, x, z, yaw, colour(ty, k)]);
    if (k % 2) t += ty === 'jetski' ? 4.5 : 7.5;
  });
  return { g, plat, solids, moor, x: S[0], z: S[1], level, land, n: [nx, nz], t0, tp };
}

export const LANDMARK_CLEAR = {
  spaceNeedle: 48, mopop: 62, arena: 95, spheres: 44, wheel: 9,
  // The Main Arcade's two OSM ways, which the model replaces; the Market's
  // own node is 220 m up the bluff from its sign.
  market: [[96.5, 99.5, 6], [143.5, 154.9, 6], [152.5, 141, 10], [122.5, 114.7, 10], [94.9, 85.5, 8]],
  aquarium: 48, ferry: 72, library: 48, pier: 52, troll: 18,
  // the park, and the Play Barn and picnic shelter's own OSM boxes, which the
  // model replaces (they stand ~110 m east of the park's point)
  gasworks: [[0, 0, 95], [101, -24, 30], [93, -45, 28]],
  // the Statue of Liberty stands 1.1 km from Alki Beach Park's point
  locks: 75, kerry: 30, ferriswheelPier: [[-818.8, 759.8, 5]], convention: 62,
  stadiumF: 135, stadiumB: 128, stadiumH: 122, smith: 6,
  // the tower/apron cluster only -- the runway lies over real open ground and
  // the hangars beside it are real buildings that must stay
  // the ring and its promenade, off the OSM point (the circle's centre is
  // 16 m north-west of it: -x is west, -z north)
  airport: 90, bellevueDT: [[-13.2, -8.5, 110]],
  westPoint: 10, alkiPoint: 9, lenin: 3, hammeringMan: 3, eagle: 8, echo: 5, eraser: 3,
  waterTower: 11, blackSun: 4, conservatory: 34, pergola: 11, totem: 2, changingForm: 3, daybreak: 30,
  rocket: 0.1,   // on a building's corner: that building stays
};

/**
 * Bellevue Downtown Park: a 10-acre lawn inside a circular canal, a half-mile
 * promenade round it under a double row of shade trees, and in the south-west
 * a reflecting pond fed over a wide stepped waterfall, with the canal's
 * straight arm running west beside it (bellevuewa.gov; the geometry below is
 * OSM's: the canal ring r 96.7-101.7 m, the pond and the channel as mapped,
 * relative to the circle's centre). The import left a 20 m crater there
 * (geo.js TERRAIN_FLATS levels it); nothing here was drawn before.
 */
// the circle's centre, from the terrain flat that levels it (geo.js)
const BDP = { get x() { return G.terrainFlat('bellevueDT').x; }, get z() { return G.terrainFlat('bellevueDT').z; } };
const BDP_POND = [[-95, 36], [-89, 48], [-83, 58], [-76, 67], [-67, 76], [-57, 84], [-49, 89], [-41, 93],
  [-33, 96], [-25, 98], [-21, 99], [-20, 89], [-18, 80], [-17, 73], [-23, 67], [-30, 54], [-39, 46],
  [-41, 35], [-95, 36]];
const BDP_CHANNEL = [[-98, 24], [-97, 28], [-95, 33], [-85, 32], [-37, 31], [-26, 31], [-26, 26],
  [-26, 21], [-95, 23]];
// the pond's east edge, north to south: where the waterfall comes down
const BDP_FALL = [[-41, 35], [-39, 46], [-30, 54], [-23, 67], [-17, 73], [-18, 80], [-20, 89]];
function bellevueDT() {
  const g = new THREE.Group();
  const f = G.terrainFlat('bellevueDT');
  g.userData.worldAligned = true;
  g.userData.at = [BDP.x, BDP.z, f.y];
  const water = P(0x2c5d74, 0.06, 0.1, 1.4);
  const stone = P(0xb3ad9f, 0.85);
  const pave = P(0xc2bba9, 0.9);
  const bark = P(0x5b4838, 0.9);
  const leaf = P(0x4d7838, 0.8);
  const leaf2 = P(0x5d8a3f, 0.8);
  // a flat ring between two radii, as one geometry
  const ring = (r0, r1, y, m, seg = 128) => {
    const geo = new THREE.RingGeometry(r0, r1, seg, 1);
    geo.rotateX(-Math.PI / 2);
    const o = new THREE.Mesh(geo, m);
    o.position.y = y;
    return o;
  };
  // a flat polygon (x, z pairs), and a coping wall round its edge
  const flatPoly = (pts, y, m) => {
    const sh = new THREE.Shape(pts.map(([x, z]) => new THREE.Vector2(x, -z)));
    const geo = new THREE.ShapeGeometry(sh);
    geo.rotateX(-Math.PI / 2);
    const o = new THREE.Mesh(geo, m);
    o.position.y = y;
    return o;
  };
  const coping = (pts, h, t) => {
    for (let i = 0; i < pts.length - 1; i++) {
      const [ax, az] = pts[i], [bx, bz] = pts[i + 1];
      const L = Math.hypot(bx - ax, bz - az);
      if (L < 0.2) continue;
      g.add(box(t, h, L + t, stone, (ax + bx) / 2, -0.1, (az + bz) / 2, Math.atan2(bx - ax, bz - az)));
    }
  };
  // The canal: water, and a stone kerb on both banks
  g.add(ring(96.7, 101.7, 0.2, water));
  g.add(ring(96.2, 96.7, 0.42, stone));
  g.add(ring(101.7, 102.3, 0.42, stone));
  for (const r of [96.2, 96.7, 101.7, 102.3]) {
    const geo = new THREE.CylinderGeometry(r, r, 0.52, 128, 1, true);
    const o = new THREE.Mesh(geo, stone);
    o.position.y = 0.16;
    g.add(o);
  }
  // The promenade, and its double row of shade trees
  g.add(ring(102.3, 109.5, 0.05, pave));
  for (const [r, off] of [[111.8, 0], [117.2, 0.5]]) {
    const n = Math.round((2 * Math.PI * r) / 11);
    for (let k = 0; k < n; k++) {
      const a = ((k + off) / n) * Math.PI * 2;
      const x = Math.cos(a) * r, z = Math.sin(a) * r;
      const hk = ((k * 7919 + r * 13) % 97) / 97;
      const h = 3.0 + hk * 1.2, cr = 2.8 + hk * 1.1;
      g.add(cyl(0.22, 0.3, h + 1, bark, x, 0, z, 6));
      const c = new THREE.Mesh(new THREE.SphereGeometry(cr, 9, 6), hk > 0.5 ? leaf : leaf2);
      c.scale.set(1, 0.82, 1);
      c.position.set(x, h + cr * 0.6, z);
      g.add(c);
      solidCircle(g, x, z, 0.35, h);
    }
  }
  // The straight arm and the reflecting pond, as mapped
  g.add(flatPoly(BDP_CHANNEL, 0.2, water));
  coping(BDP_CHANNEL, 0.52, 0.5);
  g.add(flatPoly(BDP_POND, 0.12, water));
  coping(BDP_POND, 0.5, 0.5);
  // The waterfall: three stone steps down the pond's east edge, a sheet of
  // falling water on each riser, the top one fed from a basin on the lawn.
  for (let i = 0; i < BDP_FALL.length - 1; i++) {
    const [ax, az] = BDP_FALL[i], [bx, bz] = BDP_FALL[i + 1];
    const L = Math.hypot(bx - ax, bz - az), ux = (bx - ax) / L, uz = (bz - az) / L;
    // away from the pond is east here
    let nx = -uz, nz = ux;
    if (nx < 0) { nx = -nx; nz = -nz; }
    const rot = Math.atan2(ux, uz);
    for (let k = 0; k < 3; k++) {
      const d = 0.8 + k * 1.3, top = 0.7 + k * 0.6;
      const cx = (ax + bx) / 2 + nx * d, cz = (az + bz) / 2 + nz * d;
      g.add(box(1.3, top, L + 0.6, stone, cx, 0, cz, rot));
      const sheet = new THREE.Mesh(new THREE.PlaneGeometry(L + 0.4, 0.62), P(0xdfeef5, 0.2, 0, 1.2));
      sheet.position.set(cx - nx * 0.67, top - 0.31, cz - nz * 0.67);
      sheet.rotation.y = Math.atan2(-nx, -nz);
      g.add(sheet);
      solidBox(g, cx, cz, 0.65, (L + 0.6) / 2, rot, top);
    }
    g.add(box(1.8, 0.1, L + 0.6, water, (ax + bx) / 2 + nx * 4.7, 1.9, (az + bz) / 2 + nz * 4.7, rot));
  }
  return g;
}

// ---------------------------------------------------------------------------
// THE SECOND PASS OF LANDMARKS (v118), each placed from its OSM node
// (geo.js EXTRA_LANDMARKS) and built to its published dimensions. `rot` in a
// builder's userData turns it (front = local +z): -pi/2 faces west, pi north.

const ft = (f) => f * 0.3048;
const HEADING = { west: -Math.PI / 2, north: Math.PI, east: Math.PI / 2, south: 0 };

/** A gabled roof over a w x d plan (ridge along z), eaves at y0, rise r. */
function gable(g, w, d, y0, r, m, x = 0, z = 0) {
  const hw = w / 2 + 0.3, hd = d / 2 + 0.3;
  const pos = [
    -hw, y0, -hd, 0, y0 + r, -hd, 0, y0 + r, hd, -hw, y0, -hd, 0, y0 + r, hd, -hw, y0, hd,
    hw, y0, -hd, hw, y0, hd, 0, y0 + r, hd, hw, y0, -hd, 0, y0 + r, hd, 0, y0 + r, -hd,
    -hw, y0, -hd, hw, y0, -hd, 0, y0 + r, -hd, -hw, y0, hd, 0, y0 + r, hd, hw, y0, hd,
  ];
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.computeVertexNormals();
  const o = new THREE.Mesh(geo, m);
  o.material.side = THREE.FrontSide;
  o.position.set(x, 0, z);
  g.add(o);
}

// West Point Light, Discovery Park (1881; historic-structures.com, HistoryLink
// 4183, Wikipedia): a square stuccoed-brick tower 10 ft a side, 23 ft tall, a
// bracketed catwalk at 19 ft, an octagonal iron lantern with a ball
// ventilator. White walls, red roofs, grey-green lantern and trim, a dark
// blue-grey base. The fog-signal building is on its west face, the workshop on
// its east -- the tower sits between them, 16 x 6 m in all, E-W, at the end
// of the sandy point.
function westPoint() {
  const g = new THREE.Group();
  const white = P(0xf1efe8, 0.75, 0, 0.6), red = P(0xa8322a, 0.7, 0, 0.55), trim = P(0x5e7a6c, 0.55, 0.3, 0.6);
  const base = P(0x3e4a55, 0.85, 0, 0.5);
  const T = ft(10), top = ft(19);
  g.add(box(16.4, 0.7, 6.4, base, 0, -0.3, 0));
  g.add(box(T, top, T, white, 0, 0.4, 0));
  // the catwalk on its brackets, and its rail
  g.add(box(T + 1.3, 0.14, T + 1.3, trim, 0, top + 0.4, 0));
  for (const [sx, sz] of [[1, 1], [-1, 1], [1, -1], [-1, -1]]) g.add(strut(V(sx * T / 2, top - 0.5, sz * T / 2), V(sx * (T / 2 + 0.55), top + 0.4, sz * (T / 2 + 0.55)), 0.05, trim, 4));
  for (let k = 0; k < 16; k++) {
    const a = (k / 16) * Math.PI * 2, r = (T + 1.2) / 2 / Math.max(Math.abs(Math.cos(a)), Math.abs(Math.sin(a)));
    g.add(cyl(0.025, 0.025, 1.0, trim, Math.cos(a) * r, top + 0.5, Math.sin(a) * r, 4));
  }
  const railRing = new THREE.Mesh(new THREE.TorusGeometry((T + 1.2) / 2 * 1.12, 0.03, 4, 4), trim);
  railRing.rotation.set(Math.PI / 2, 0, Math.PI / 4); railRing.position.y = top + 1.5; g.add(railRing);
  // octagonal lantern: glass between iron mullions, a domed roof, the ball
  const lamp = P(0xfff4d8, 0.3, 0, 1, { emissive: 0xfff0c8, emissiveIntensity: 0.7, key: 'wpLamp' });
  g.add(cyl(0.95, 0.95, 1.35, lamp, 0, top + 0.55, 0, 8));
  for (let k = 0; k < 8; k++) { const a = (k / 8) * Math.PI * 2 + Math.PI / 8; g.add(cyl(0.04, 0.04, 1.4, trim, Math.cos(a) * 0.97, top + 0.55, Math.sin(a) * 0.97, 4)); }
  g.add(cyl(0.2, 1.1, 0.75, trim, 0, top + 1.9, 0, 8));
  const ball = new THREE.Mesh(new THREE.SphereGeometry(0.2, 8, 6), trim); ball.position.y = top + 2.85; g.add(ball);
  // fog-signal building to the west (gabled, arched windows, "1881"), workshop east
  g.add(box(6.2, 3.3, 5.6, white, -4.7, 0.4, 0));
  gable(g, 6.2, 5.6, 3.7, 1.6, red, -4.7, 0);
  g.add(box(3.6, 3.0, 4.4, white, 3.8, 0.4, 0));
  gable(g, 3.6, 4.4, 3.4, 1.3, red, 3.8, 0);
  const s = sign('1881', 1.0, 0.36, null, '#5e7a6c', { px: 60 });
  s.position.set(-7.85, 3.1, 0); s.rotation.y = -Math.PI / 2; g.add(s);
  for (const x of [-6.2, -3.2]) for (const sd of [-1, 1]) g.add(box(0.9, 1.3, 0.05, trim, x, 1.4, sd * 2.83));
  solidBox(g, 0, 0, 8.2, 3.2, 0, 7);
  g.userData.rot = 0;
  return g;
}

// Alki Point Light (1913; Wikipedia, HistoryLink 4197, lighthousefriends): a
// 37 ft octagonal tower with lantern and gallery, focal height 39 ft,
// attached to a one-storey fog-signal building; white, red roofs, dark
// lantern, green window trim. Faces the Sound, west.
function alkiPoint() {
  const g = new THREE.Group();
  const white = P(0xf2f0ea, 0.75, 0, 0.6), red = P(0xa8322a, 0.7, 0, 0.55), black = P(0x23262a, 0.5, 0.4, 0.6), green = P(0x3d6b4f, 0.6, 0, 0.55);
  const H = ft(37);
  g.add(box(12.5, 0.6, 9, P(0x9a9892, 0.9, 0, 0.5), 0, -0.3, 0));
  // tower on the building's west end
  g.add(cyl(1.35, 1.6, H - 3.2, white, -3.6, 0.3, 0, 8));
  g.add(cyl(2.05, 2.05, 0.18, black, -3.6, H - 2.9, 0, 8));
  const lamp = P(0xfff4d8, 0.3, 0, 1, { emissive: 0xfff0c8, emissiveIntensity: 0.7, key: 'wpLamp' });
  g.add(cyl(1.0, 1.0, 1.4, lamp, -3.6, H - 2.7, 0, 8));
  for (let k = 0; k < 8; k++) { const a = (k / 8) * Math.PI * 2 + Math.PI / 8; g.add(cyl(0.05, 0.05, 1.45, black, -3.6 + Math.cos(a) * 1.02, H - 2.7, Math.sin(a) * 1.02, 4)); }
  g.add(cyl(0.2, 1.15, 0.9, black, -3.6, H - 1.3, 0, 8));
  for (let k = 0; k < 20; k++) { const a = (k / 20) * Math.PI * 2; g.add(cyl(0.025, 0.025, 0.9, black, -3.6 + Math.cos(a) * 1.95, H - 2.72, Math.sin(a) * 1.95, 4)); }
  // the fog-signal building, windows trimmed green
  g.add(box(8.5, 3.6, 6.4, white, 1.2, 0.3, 0));
  gable(g, 8.5, 6.4, 3.9, 1.5, red, 1.2, 0);
  for (const x of [-1.2, 1.2, 3.6]) for (const sd of [-1, 1]) g.add(box(1.0, 1.4, 0.05, green, x, 1.5, sd * 3.23));
  solidCircle(g, -3.6, 0, 1.8, H);
  solidBox(g, 1.2, 0, 4.3, 3.3, 0, 4);
  g.userData.rot = 0;
  return g;
}

// The Statue of Liberty at Alki (1952, recast in bronze 2007; Wikipedia): a
// 7.5 ft copper-green figure on a 4.5 ft pedestal, facing north over Elliott
// Bay, in its 2008 plaza. It used to stand 12 m tall at Alki Beach Park's
// centroid, a kilometre from where it is.
function statueLiberty() {
  const g = new THREE.Group();
  const cu = P(0x6aa597, 0.55, 0.35, 0.6), stone = P(0xb9b3a6, 0.9, 0, 0.5);
  const [ax, az] = G.toWorld(47.579376, -122.410632);
  g.userData.at = [ax, az, G.terrainHeight(ax, az)];
  g.add(cyl(4.2, 4.2, 0.15, P(0x9d978b, 0.9, 0, 0.5), 0, -0.05, 0, 20));
  g.add(box(1.5, ft(4.5), 1.5, stone, 0, 0, 0));
  g.add(box(1.8, 0.2, 1.8, stone, 0, ft(4.5), 0));
  const y0 = ft(4.5) + 0.2, S = ft(7.5) / 2.3;
  // robe to the waist, torso, head and crown, raised torch arm, tablet
  g.add(cyl(0.3 * S, 0.42 * S, 1.2 * S, cu, 0, y0, 0, 10));
  g.add(cyl(0.26 * S, 0.3 * S, 0.6 * S, cu, 0, y0 + 1.2 * S, 0, 10));
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.16 * S, 10, 8), cu); head.position.set(0, y0 + 1.97 * S, 0.02); g.add(head);
  for (let k = 0; k < 7; k++) { const a = -1.2 + k * 0.4; g.add(strut(V(Math.sin(a) * 0.12 * S, y0 + 2.07 * S, Math.cos(a) * 0.12 * S), V(Math.sin(a) * 0.3 * S, y0 + 2.22 * S, Math.cos(a) * 0.3 * S), 0.025 * S, cu, 3)); }
  g.add(strut(V(0.22 * S, y0 + 1.7 * S, 0), V(0.3 * S, y0 + 2.45 * S, 0.05 * S), 0.07 * S, cu, 6));
  g.add(cyl(0.1 * S, 0.06 * S, 0.22 * S, P(0xe6b54a, 0.35, 0.7, 0.8), 0.31 * S, y0 + 2.45 * S, 0.05 * S, 8));
  const flame = new THREE.Mesh(new THREE.ConeGeometry(0.08 * S, 0.2 * S, 6), P(0xf2c14e, 0.3, 0.8, 0.9));
  flame.position.set(0.31 * S, y0 + 2.75 * S, 0.05 * S); g.add(flame);
  g.add(box(0.28 * S, 0.4 * S, 0.06 * S, cu, -0.26 * S, y0 + 1.3 * S, 0.12 * S, 0.3));
  solidBox(g, 0, 0, 0.8, 0.8, 0, 2.6);
  g.userData.rot = HEADING.north;
  return g;
}

// Gas Works Park (Wikipedia; HistoryLink 20978; Landmarks Board 2025): the
// Seattle Gas Light Co. plant, 1906-56. Six generator towers in a N-S line
// (OSM ways 191328724-736) -- the 1937-38 pair at 80 and 75 ft, nearest the
// water; four of 1947 at 50 ft, 22 ft across -- steel shells on brick,
// rusted, with catwalks on three levels and the plant's pipework, inside a
// chain-link fence. East of them the exhauster-compressor house, now the
// Play Barn, with its machinery painted in reds, oranges and blues, and the
// boiler house, now the picnic shelter. Kite Hill (45 ft) carries the 1978
// sundial, an analemmatic dial ~13 m across where you are the gnomon.
function gasworks(l) {
  const g = new THREE.Group();
  g.userData.worldAligned = true;
  const px = l.p ? l.p[0] : l.x, pz = l.p ? l.p[1] : l.z;
  const W = (lat, lon) => { const [x, z] = G.toWorld(lat, lon); return [x - px, z - pz]; };
  const rust = P(0x7a4128, 0.85, 0.35, 0.5), rust2 = P(0x5e3322, 0.9, 0.3, 0.45), steel = P(0x3b3a38, 0.7, 0.5, 0.55);
  const Y0 = (x, z) => G.terrainHeight(x + px, z + pz) - G.terrainHeight(px, pz);
  // the towers, south (nearest the water) to north
  const [sx, sz] = W(47.64491, -122.33476), [nx, nz] = W(47.64543, -122.33476);
  const heights = [ft(80), ft(75), ft(50), ft(50), ft(50), ft(50)];
  const R = ft(22) / 2;
  const towers = [];
  for (let i = 0; i < 6; i++) {
    const t = i / 5, x = sx + (nx - sx) * t, z = sz + (nz - sz) * t, y = Y0(x, z), H = heights[i];
    towers.push([x, z, y, H]);
    g.add(cyl(R, R * 1.04, H * 0.82, rust, x, y, z, 18));
    g.add(cyl(R * 0.55, R, H * 0.18, rust2, x, y + H * 0.82, z, 18));          // the conical head
    g.add(cyl(0.45, 0.45, 1.6, rust2, x, y + H, z, 8));                        // the stack
    for (let b = 1; b < 5; b++) g.add(cyl(R * 1.03, R * 1.03, 0.14, rust2, x, y + (H * 0.82 * b) / 5, z, 18));
    // a caged ladder up the east face
    g.add(box(0.5, H * 0.8, 0.08, steel, x + R + 0.3, y + 0.5, z));
    solidCircle(g, x, z, R + 0.2, H);
  }
  // catwalks on three levels, tower to tower, and the pipes along the tops
  for (const f of [0.28, 0.52, 0.74]) {
    for (let i = 0; i < 5; i++) {
      const [ax, az, ay, ah] = towers[i], [bx, bz, by, bh] = towers[i + 1];
      const y = Math.max(ay, by) + Math.min(ah, bh) * f;
      g.add(box(1.1, 0.12, Math.hypot(bx - ax, bz - az), steel, (ax + bx) / 2 + R * 0.9, y, (az + bz) / 2, Math.atan2(bx - ax, bz - az)));
      g.add(box(0.05, 1.0, Math.hypot(bx - ax, bz - az), steel, (ax + bx) / 2 + R * 0.9 + 0.55, y, (az + bz) / 2, Math.atan2(bx - ax, bz - az)));
    }
  }
  for (let i = 0; i < 5; i++) {
    const [ax, az, ay, ah] = towers[i], [bx, bz, by, bh] = towers[i + 1];
    const y = Math.min(ay + ah, by + bh) * 0.9;
    g.add(strut(V(ax - R * 0.4, y, az), V(bx - R * 0.4, y, bz), 0.55, rust2, 8));
  }
  // the scrubbers and absorbers west of the line, piped to it
  for (const [ox, oz, h, r] of [[-11, 6, ft(68), ft(12) / 2], [-11, 22, ft(48), 2.2], [-12, 40, ft(40), 2.0]]) {
    const x = sx + ox, z = sz - oz, y = Y0(x, z);
    g.add(cyl(r, r, h, rust, x, y, z, 14));
    g.add(strut(V(x, y + h * 0.8, z), V(sx - R * 0.4, y + h * 0.8, z), 0.35, rust2, 6));
    solidCircle(g, x, z, r + 0.2, h);
  }
  // the chain-link fence round the compound
  {
    const x0 = sx - 18, x1 = sx + 9, z0 = nz - 9, z1 = sz + 9;
    const post = P(0x8e9398, 0.5, 0.6, 0.6);
    const mesh = P(0x7e848a, 0.6, 0.6, 0.5, { transparent: true, opacity: 0.35, depthWrite: false, key: 'chainlink' });
    for (const [a, b] of [[[x0, z0], [x1, z0]], [[x1, z0], [x1, z1]], [[x1, z1], [x0, z1]], [[x0, z1], [x0, z0]]]) {
      const L = Math.hypot(b[0] - a[0], b[1] - a[1]), n = Math.ceil(L / 3);
      for (let k = 0; k <= n; k++) { const x = a[0] + (b[0] - a[0]) * (k / n), z = a[1] + (b[1] - a[1]) * (k / n); g.add(cyl(0.05, 0.05, 2.4, post, x, Y0(x, z), z, 5)); }
      const mx = (a[0] + b[0]) / 2, mz = (a[1] + b[1]) / 2;
      const ry = Math.abs(b[1] - a[1]) > Math.abs(b[0] - a[0]) ? Math.PI / 2 : 0;
      g.add(box(L, 2.2, 0.03, mesh, mx, Y0(mx, mz), mz, ry));
      g.add(box(L, 0.05, 0.05, post, mx, Y0(mx, mz) + 2.3, mz, ry));
      solidBox(g, mx, mz, Math.abs(b[0] - a[0]) / 2 + 0.1, Math.abs(b[1] - a[1]) / 2 + 0.1, 0, 2.4);
    }
  }
  // The Play Barn (exhauster-compressor house) and the picnic shelter
  // (boiler house): open sides under a truss roof, the machinery kept and
  // painted. OSM ways 52137309 / 52137316, ~55 x 20 and 52 x 18 m, E-W.
  const shed = (lat, lon, L, D, painted) => {
    const [x, z] = W(lat, lon), y = Y0(x, z);
    g.add(box(L, 0.3, D, P(0x8f8a82, 0.9, 0, 0.5), x, y - 0.2, z));
    for (let k = 0; k <= Math.round(L / 6); k++) for (const sd of [-1, 1]) {
      const cx = x - L / 2 + (k * L) / Math.round(L / 6);
      g.add(box(0.45, 6.2, 0.45, P(0x6d3a2a, 0.8, 0.2, 0.5), cx, y, z + sd * (D / 2 - 0.3)));
      solidCircle(g, cx, z + sd * (D / 2 - 0.3), 0.35, 6);
    }
    const roofM = P(0x8b3b2a, 0.75, 0.2, 0.5);
    const rg = new THREE.Group(); gable(rg, D, L, 6.2, 3.2, roofM, 0, 0); rg.rotation.y = Math.PI / 2; rg.position.set(x, y, z); g.add(rg);
    if (!painted) return;
    // the painted machinery: compressor bodies, a great red flywheel, pipes
    const cols = [0xd8352a, 0xf07a1c, 0xf2c32a, 0x2a6fd0, 0x7a3fc2, 0x2e9e6a];
    for (let k = 0; k < 6; k++) {
      const cx = x - L / 2 + 6 + k * (L - 12) / 5;
      g.add(box(3.6, 2.4, 2.2, P(cols[k], 0.55, 0.3, 0.6), cx, y, z - 2));
      g.add(cyl(0.45, 0.45, 3.2, P(cols[(k + 2) % 6], 0.55, 0.3, 0.6), cx, y + 2.4, z - 2, 10));
      g.add(strut(V(cx, y + 3.2, z - 2), V(cx, y + 3.2, z + 3), 0.22, P(cols[(k + 3) % 6], 0.55, 0.3, 0.6), 6));
      solidBox(g, cx, z - 2, 1.9, 1.2, 0, 2.6);
    }
    const fly = new THREE.Mesh(new THREE.TorusGeometry(2.1, 0.28, 8, 24), P(0xd8352a, 0.5, 0.3, 0.6));
    fly.position.set(x + L / 2 - 5, y + 2.4, z + 3); g.add(fly);
    g.add(strut(V(x + L / 2 - 5, y + 2.4, z + 2.6), V(x + L / 2 - 5, y + 2.4, z + 3.4), 0.3, P(0x2a6fd0, 0.5, 0.3, 0.6), 8));
    solidCircle(g, x + L / 2 - 5, z + 3, 1.2, 4.6);
  };
  shed(47.645891, -122.333404, 55, 20, true);
  shed(47.646075, -122.333508, 52, 18, false);
  // the sundial on Kite Hill: a 13 m ellipse of mosaic, hour stones round it
  {
    const [x, z] = W(47.645321, -122.336361), y = Y0(x, z);
    const dial = atlas.panel(13, 11, 40, (c, Wd, Hd) => {
      c.fillStyle = '#b9a88c'; c.beginPath(); c.ellipse(Wd / 2, Hd / 2, Wd / 2 - 2, Hd / 2 - 2, 0, 0, Math.PI * 2); c.fill();
      const cols = ['#3d6b8c', '#c9a13a', '#8c3d3d', '#3d8c5e', '#e8e2d0', '#6b4a8c'];
      for (let k = 0; k < 220; k++) {
        const a = (k * 2.39996) % (Math.PI * 2), r = Math.sqrt(k / 220);
        c.fillStyle = cols[k % cols.length];
        c.beginPath(); c.arc(Wd / 2 + Math.cos(a) * r * (Wd / 2 - 8), Hd / 2 + Math.sin(a) * r * (Hd / 2 - 8), 3 + (k % 4), 0, Math.PI * 2); c.fill();
      }
      c.strokeStyle = '#4a3b2a'; c.lineWidth = 5;
      c.beginPath(); c.ellipse(Wd / 2, Hd / 2, Wd / 2 - 14, Hd / 2 - 14, 0, 0, Math.PI * 2); c.stroke();
    });
    dial.rotation.x = -Math.PI / 2; dial.position.set(x, y + 0.06, z);
    g.add(dial);
    for (let k = 0; k < 13; k++) { const a = Math.PI + (k / 12) * Math.PI; g.add(box(0.5, 0.3, 0.5, P(0x7a6a58, 0.9, 0, 0.5), x + Math.cos(a) * 6.2, y, z + Math.sin(a) * 5.2)); }
  }
  return g;
}

// Fremont Rocket (1994; Wikipedia, roadsideamerica): a 53 ft Cold War rocket
// fuselage built from a C-119's tail boom, mounted nose-up on the corner of
// Evanston Ave N and N 35th St, the Fremont crest and "De Libertas Quirkas".
function rocket() {
  const g = new THREE.Group();
  const body = P(0x3a3d40, 0.45, 0.6, 0.7), trimC = P(0xc9ccd0, 0.35, 0.8, 0.8), red = P(0xb5342c, 0.5, 0.2, 0.6);
  const H = ft(53);
  g.add(box(3.4, 1.2, 3.4, P(0x8f8c85, 0.9, 0, 0.5), 0, 0, 0));
  g.add(cyl(0.9, 0.9, H * 0.72, body, 0, 1.2, 0, 16));
  g.add(cyl(0.05, 0.9, H * 0.22, body, 0, 1.2 + H * 0.72, 0, 16));
  for (const f of [0.18, 0.45, 0.7]) g.add(cyl(0.93, 0.93, 0.25, trimC, 0, 1.2 + H * f, 0, 16));
  for (let k = 0; k < 4; k++) {
    const a = (k / 4) * Math.PI * 2;
    const fin = new THREE.Mesh(new THREE.BoxGeometry(0.12, 3.6, 2.0), red);
    fin.position.set(Math.cos(a) * 1.5, 2.4, Math.sin(a) * 1.5); fin.rotation.y = -a; g.add(fin);
  }
  const s = sign('F\nR\nE\nM\nO\nN\nT', 0.9, 7.5, null, '#e8e2d0', { px: 40, fill: 0.9 });
  s.position.set(0, 7.5, 0.93); g.add(s);
  solidCircle(g, 0, 0, 1.8, H);
  g.userData.rot = HEADING.south;
  return g;
}

// Lenin in Fremont (Emil Venkov; Wikipedia): 16 ft of bronze, the figure
// striding out of a ring of flames and guns, on a low plinth.
function lenin() {
  const g = new THREE.Group();
  const br = P(0x4a3a2a, 0.45, 0.7, 0.6);
  const S = ft(16) / 4.9;
  g.add(box(3.2, 0.9, 3.2, P(0x8f8c85, 0.9, 0, 0.5), 0, 0, 0));
  const y0 = 0.9;
  for (let k = 0; k < 9; k++) {
    const a = (k / 9) * Math.PI * 2, r = 0.9 * S;
    const f = new THREE.Mesh(new THREE.ConeGeometry(0.28 * S, (1.1 + (k % 3) * 0.4) * S, 5), br);
    f.position.set(Math.cos(a) * r, y0 + 0.6 * S, Math.sin(a) * r); f.rotation.z = Math.cos(a) * 0.35; f.rotation.x = -Math.sin(a) * 0.35; g.add(f);
  }
  for (const sd of [-1, 1]) g.add(strut(V(sd * 0.25 * S, y0, sd * 0.2 * S), V(sd * 0.18 * S, y0 + 2.0 * S, 0), 0.19 * S, br, 7));
  g.add(cyl(0.42 * S, 0.62 * S, 1.2 * S, br, 0, y0 + 1.3 * S, 0, 10));   // the coat
  g.add(cyl(0.38 * S, 0.42 * S, 1.0 * S, br, 0, y0 + 2.5 * S, 0, 10));
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.28 * S, 10, 8), br); head.position.set(0, y0 + 3.75 * S, 0.05 * S); g.add(head);
  g.add(strut(V(0.4 * S, y0 + 3.3 * S, 0), V(0.75 * S, y0 + 2.4 * S, 0.5 * S), 0.12 * S, br, 6));
  g.add(strut(V(-0.4 * S, y0 + 3.3 * S, 0), V(-0.6 * S, y0 + 2.3 * S, -0.1 * S), 0.12 * S, br, 6));
  solidCircle(g, 0, 0, 1.6, 5);
  g.userData.rot = HEADING.east;
  return g;
}

// Hammering Man (Jonathan Borofsky, 1992; Wikipedia): 48 ft of flat black
// steel, 7 in thick, a worker in profile whose motorised arm swings his hammer
// four times a minute, in front of the Seattle Art Museum on 1st Ave.
function hammeringMan() {
  const g = new THREE.Group();
  const black = P(0x151617, 0.6, 0.3, 0.45);
  const H = ft(48), k = H / 14.6;
  const sh = new THREE.Shape();
  const pts = [[-0.6, 0], [-0.2, 0], [0.1, 3.4], [0.4, 0], [0.8, 0], [0.55, 4.6], [0.7, 7.2], [0.9, 9.4], [0.55, 11.8],
    [0.6, 12.4], [0.95, 13.2], [0.75, 14.2], [0.2, 14.6], [-0.35, 14.2], [-0.4, 13.0], [-0.2, 12.4], [-0.55, 11.6],
    [-0.9, 9.0], [-0.8, 6.8], [-0.7, 4.6]];
  sh.moveTo(pts[0][0] * k, pts[0][1] * k);
  for (const [x, y] of pts.slice(1)) sh.lineTo(x * k, y * k);
  const geo = new THREE.ExtrudeGeometry(sh, { depth: ft(7 / 12), bevelEnabled: false });
  geo.rotateY(Math.PI / 2);
  g.add(new THREE.Mesh(geo, black));
  // the arm and hammer, raised mid-swing
  g.add(strut(V(0, 11.2 * k, 0.6 * k), V(0, 12.4 * k, 3.4 * k), 0.28 * k, black, 6));
  g.add(box(0.3, 0.6 * k, 1.4 * k, black, 0, 12.1 * k, 3.6 * k));
  solidBox(g, 0, 0, 0.5, 0.8, 0, 3);
  // broadside to 1st Ave (the downtown grid, ~32 deg west of north), so the
  // avenue sees his profile; he faces up it, toward Pike Place
  g.userData.rot = 0.558 - Math.PI;
  return g;
}

// The Eagle (Alexander Calder, 1971; Olympic Sculpture Park): red-painted
// steel plates, 465 x 390 x 390 in (11.8 m), on splayed legs.
function eagle() {
  const g = new THREE.Group();
  const red = P(0xc0281f, 0.45, 0.25, 0.6);
  const plate = (pts, depth, rx, ry, x, y, z) => {
    const sh = new THREE.Shape(); sh.moveTo(pts[0][0], pts[0][1]); for (const p of pts.slice(1)) sh.lineTo(p[0], p[1]);
    const o = new THREE.Mesh(new THREE.ExtrudeGeometry(sh, { depth, bevelEnabled: false }), red);
    o.rotation.set(rx, ry, 0); o.position.set(x, y, z); g.add(o);
  };
  plate([[-5, 0], [-3.4, 0], [0, 7.2], [3.4, 0], [5, 0], [0.8, 9.2], [-0.8, 9.2]], 0.12, 0, 0, 0, 0, -0.06);
  plate([[-4.2, 0], [-2.8, 0], [0, 6.2], [2.8, 0], [4.2, 0], [0.5, 7.6], [-0.5, 7.6]], 0.12, 0, Math.PI / 2, 0.06, 0, 0);
  plate([[0, 8.2], [4.8, 11.8], [3.2, 9.2], [0.4, 7.4]], 0.1, 0, 0.5, 0, 0, 0);
  plate([[0, 8.2], [-4.2, 11.2], [-2.8, 8.8], [-0.4, 7.4]], 0.1, 0, -0.6, 0, 0, 0);
  for (const [x, z] of [[-4.2, 0], [4.2, 0], [0, -3.5], [0, 3.5]]) solidCircle(g, x, z, 0.8, 4);
  return g;
}

// Echo (Jaume Plensa, 2011; Olympic Sculpture Park): a 46 ft head of a
// girl, eyes closed, elongated and flattened front to back, white marble
// dust on resin; she faces west, to the Sound.
function echo() {
  const g = new THREE.Group();
  const marble = P(0xf2f0ea, 0.55, 0, 0.7);
  const H = ft(46);
  const head = new THREE.Mesh(new THREE.SphereGeometry(1, 28, 20), marble);
  head.scale.set(2.4, H / 2 * 0.92, 1.55); head.position.y = H / 2 * 0.92 + 0.6; g.add(head);
  const nose = new THREE.Mesh(new THREE.SphereGeometry(1, 10, 8), marble);
  nose.scale.set(0.45, 1.5, 0.6); nose.position.set(0, H * 0.55, 1.4); g.add(nose);
  for (const sd of [-1, 1]) {
    const lid = new THREE.Mesh(new THREE.SphereGeometry(1, 10, 6), P(0xd9d6ce, 0.6, 0, 0.6));
    lid.scale.set(0.75, 0.12, 0.3); lid.position.set(sd * 0.95, H * 0.66, 1.25); g.add(lid);
  }
  const lips = new THREE.Mesh(new THREE.SphereGeometry(1, 10, 6), P(0xe4e0d8, 0.6, 0, 0.6));
  lips.scale.set(0.6, 0.18, 0.3); lips.position.set(0, H * 0.35, 1.3); g.add(lips);
  g.add(cyl(2.2, 2.4, 0.6, P(0x9d978b, 0.9, 0, 0.5), 0, 0, 0, 20));
  solidCircle(g, 0, 0, 2.3, H);
  g.userData.rot = HEADING.west;
  return g;
}

// Typewriter Eraser, Scale X (Oldenburg and van Bruggen; at Seattle Center
// since 2016, beside MoPOP): 19 ft 4 in of painted steel and fiberglass -- a
// pink eraser wheel tilted on its edge, its blue bristles sweeping up.
function eraser() {
  const g = new THREE.Group();
  const pink = P(0xe597a6, 0.5, 0.1, 0.6), blue = P(0x2f6fb8, 0.5, 0.2, 0.6), steel = P(0xb8bdc2, 0.35, 0.8, 0.8);
  const disc = new THREE.Mesh(new THREE.CylinderGeometry(1.45, 1.45, 0.5, 28), pink);
  disc.rotation.set(Math.PI / 2 - 0.35, 0, 0.25); disc.position.set(0, 1.3, 0); g.add(disc);
  g.add(strut(V(0, 1.4, 0), V(0.4, 3.4, -0.5), 0.12, steel, 8));
  for (let k = 0; k < 22; k++) {
    const a = -0.9 + (k / 21) * 1.8;
    g.add(strut(V(0.4, 3.4, -0.5), V(0.4 + Math.sin(a) * 1.5, 3.4 + 2.5 * Math.cos(a * 0.7), -0.5 - Math.cos(a) * 0.9), 0.06, blue, 4));
  }
  solidCircle(g, 0, 0, 1.4, 3);
  g.userData.rot = 0.4;
  return g;
}

// Volunteer Park Water Tower (1906; klarmanandzaugg, OSM way 40790430): 75 ft
// of round brick over a 60 ft standpipe, 106 steps to an observation deck
// with sixteen windows all round, a low pyramidal roof and finial, doors
// north and south.
function waterTower() {
  const g = new THREE.Group();
  const brick = P(0x8e4b35, 0.9, 0, 0.5), stone = P(0xc9bda6, 0.85, 0, 0.55), roofM = P(0x4d5a52, 0.6, 0.3, 0.55);
  const H = ft(75), R = 8.6;
  g.add(cyl(R + 0.4, R + 0.6, 1.2, stone, 0, 0, 0, 24));
  g.add(cyl(R, R, H - 4.6, brick, 0, 1.2, 0, 24));
  g.add(cyl(R + 0.35, R + 0.35, 0.5, stone, 0, H - 3.4, 0, 24));
  // the deck's sixteen windows between brick piers
  for (let k = 0; k < 16; k++) {
    const a = (k / 16) * Math.PI * 2;
    g.add(box(1.9, 2.4, 0.2, P(0x2c3a42, 0.2, 0.3, 0.8), Math.cos(a) * (R + 0.05), H - 6.6, Math.sin(a) * (R + 0.05), -a + Math.PI / 2));
  }
  g.add(cyl(R + 0.5, R + 0.5, 0.35, stone, 0, H - 4.0, 0, 24));
  g.add(cyl(0.4, R + 0.7, 3.0, roofM, 0, H - 2.9, 0, 16));
  g.add(cyl(0.12, 0.12, 1.4, roofM, 0, H + 0.1, 0, 6));
  for (const sd of [-1, 1]) g.add(box(2.2, 3.4, 0.2, P(0x3b2a20, 0.7, 0, 0.5), 0, 1.2, sd * (R + 0.05)));
  solidCircle(g, 0, 0, R + 0.4, H);
  return g;
}

// Black Sun (Isamu Noguchi, 1969): a 9 ft ring of black Brazilian granite,
// 12 tons, on Fred Bassetti's stone platform at the reservoir's east edge;
// looking due west through it frames the Space Needle.
function blackSun() {
  const g = new THREE.Group();
  const granite = P(0x121314, 0.25, 0.1, 0.9);
  g.add(box(6.5, 0.45, 4.5, P(0xa19d93, 0.9, 0, 0.5), 0, -0.1, 0));
  const ring = new THREE.Mesh(new THREE.TorusGeometry(ft(9) / 2 - 0.35, 0.42, 14, 36), granite);
  ring.position.y = ft(9) / 2 + 0.35; g.add(ring);
  solidBox(g, 0, 0, 1.6, 0.6, 0, 3);
  g.userData.rot = HEADING.east;   // the ring's plane across the E-W axis
  return g;
}

// Volunteer Park Conservatory (1912, Lord & Burnham; OSM way 40790435): a
// Victorian glass house 61 x 22 m, long axis E-W -- the Palm House's taller
// dome in the middle, glass wings either side, white-painted frames.
function conservatory() {
  const g = new THREE.Group();
  const frame = P(0xf2f2ee, 0.5, 0.1, 0.65);
  const pane = mat.clearGlass;
  const wing = (x, L, D, H) => {
    g.add(box(L, 0.8, D, P(0xb8b2a4, 0.9, 0, 0.5), x, 0, 0));
    g.add(box(L, H - 0.8, D, pane, x, 0.8, 0));
    const rf = new THREE.Mesh(new THREE.CylinderGeometry(D / 2, D / 2, L, 20, 1, false, 0, Math.PI), pane);
    rf.rotation.set(0, 0, Math.PI / 2); rf.position.set(x, H, 0); g.add(rf);
    for (let k = 0; k <= Math.round(L / 2.4); k++) {
      const fx = x - L / 2 + (k * L) / Math.round(L / 2.4);
      for (const sd of [-1, 1]) g.add(box(0.08, H, 0.08, frame, fx, 0, sd * D / 2));
      const arch = new THREE.Mesh(new THREE.TorusGeometry(D / 2, 0.05, 4, 16, Math.PI), frame);
      arch.rotation.y = Math.PI / 2; arch.position.set(fx, H, 0); g.add(arch);
    }
  };
  wing(-19, 22, 11, 5.5);
  wing(19, 22, 11, 5.5);
  // the Palm House: taller, a dome with a lantern
  g.add(box(16, 0.8, 22, P(0xb8b2a4, 0.9, 0, 0.5), 0, 0, 0));
  g.add(box(16, 7.2, 22, pane, 0, 0.8, 0));
  const dome = new THREE.Mesh(new THREE.SphereGeometry(8, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2), pane);
  dome.scale.set(1, 0.8, 1.35); dome.position.y = 8; g.add(dome);
  for (let k = 0; k < 12; k++) {
    const a = (k / 12) * Math.PI;
    const rib = new THREE.Mesh(new THREE.TorusGeometry(8, 0.06, 4, 20, Math.PI), frame);
    rib.scale.set(1, 0.8, 1.35); rib.rotation.y = a; rib.position.y = 8; g.add(rib);
  }
  g.add(cyl(1.2, 1.2, 1.6, pane, 0, 14.2, 0, 10));
  g.add(cyl(0.2, 1.3, 0.8, frame, 0, 15.8, 0, 10));
  solidBox(g, 0, 0, 30.5, 5.6, 0, 6);
  solidBox(g, 0, 0, 8, 11, 0, 8);
  return g;
}

// The Pioneer Square pergola (1909, Julian Everett; rebuilt 2001-02): 60 ft of
// cast iron and glass, 16 ft high, twelve Corinthian columns and sixteen
// arches, in the triangle of Pioneer Place at 1st Ave and Yesler Way.
function pergola() {
  const g = new THREE.Group();
  const iron = P(0x1f2a24, 0.5, 0.6, 0.6);
  const L = ft(60), H = ft(16), D = 4.2;
  for (let k = 0; k < 6; k++) for (const sd of [-1, 1]) {
    const z = -L / 2 + (k * L) / 5, x = sd * D / 2;
    g.add(cyl(0.16, 0.2, H - 1.6, iron, x, 0, z, 10));
    g.add(cyl(0.34, 0.2, 0.5, iron, x, H - 1.6, z, 10));
    solidCircle(g, x, z, 0.25, H);
  }
  for (let k = 0; k < 5; k++) for (const sd of [-1, 1]) {
    const z = -L / 2 + ((k + 0.5) * L) / 5;
    const arch = new THREE.Mesh(new THREE.TorusGeometry(L / 10, 0.08, 4, 14, Math.PI), iron);
    arch.position.set(sd * D / 2, H - 1.4, z); arch.rotation.y = Math.PI / 2; g.add(arch);
  }
  g.add(box(D + 0.8, 0.25, L + 0.6, iron, 0, H - 1.1, 0));
  const roof = new THREE.Mesh(new THREE.CylinderGeometry(D / 2 + 0.6, D / 2 + 0.6, L + 0.4, 14, 1, false, 0, Math.PI), mat.clearGlass);
  roof.rotation.x = Math.PI / 2; roof.rotation.z = Math.PI / 2; roof.scale.set(1, 1, 0.55); roof.position.y = H - 0.85; g.add(roof);
  for (let k = 0; k <= 10; k++) {
    const rib = new THREE.Mesh(new THREE.TorusGeometry(D / 2 + 0.6, 0.05, 4, 12, Math.PI), iron);
    rib.scale.set(1, 0.55, 1); rib.position.set(0, H - 0.85, -L / 2 + (k * L) / 10); g.add(rib);
  }
  g.userData.rot = 0;
  return g;
}

// The Pioneer Square totem pole (1940 replica, Charles Brown's Tlingit carvers;
// Wikipedia): 50 ft, black, red and blue-green -- Raven on top, the woman with
// the frog child, the frog husband, mink, raven, the whale with a seal, and
// Raven-at-the-Head-of-Nass at the foot.
function totem() {
  const g = new THREE.Group();
  const cedar = P(0x6b4a33, 0.9, 0, 0.5);
  const H = ft(50);
  const bands = [0x1a1a1a, 0xb5342c, 0x2e8b7a, 0x1a1a1a, 0xb5342c, 0x2e8b7a, 0x1a1a1a];
  g.add(cyl(0.42, 0.5, H - 2.2, cedar, 0, 0, 0, 12));
  for (let k = 0; k < 7; k++) {
    const y = 0.8 + (k * (H - 3.6)) / 7;
    g.add(cyl(0.46, 0.5, 0.5, P(bands[k], 0.7, 0, 0.5), 0, y, 0, 12));
    // a face on each figure: brows and eyes
    for (const sd of [-1, 1]) g.add(box(0.26, 0.12, 0.08, P(0x1a1a1a, 0.7, 0, 0.5), sd * 0.16, y + 1.1, 0.46));
    g.add(box(0.2, 0.3, 0.16, P(bands[(k + 1) % 7], 0.7, 0, 0.5), 0, y + 0.8, 0.48));
  }
  // Raven at the top, wings spread
  const rv = P(0x1a1a1a, 0.7, 0, 0.5);
  g.add(box(0.8, 1.2, 0.9, rv, 0, H - 2.2, 0));
  for (const sd of [-1, 1]) g.add(box(1.4, 0.7, 0.18, rv, sd * 1.0, H - 1.9, 0, 0));
  const beak = new THREE.Mesh(new THREE.ConeGeometry(0.18, 0.9, 6), rv); beak.rotation.x = Math.PI / 2; beak.position.set(0, H - 1.5, 0.8); g.add(beak);
  solidCircle(g, 0, 0, 0.55, H);
  g.userData.rot = HEADING.west;
  return g;
}

// Changing Form (Doris Totten Chase, 1971; Kerry Park): 15 ft of dark
// weathering steel, smooth curves pierced by round holes you can walk
// through, at the centre of the viewpoint.
function changingForm() {
  const g = new THREE.Group();
  const corten = P(0x4e3326, 0.7, 0.4, 0.5);
  const H = ft(15);
  const slab = (w, h, holes, rz, x, y, z, ry) => {
    const sh = new THREE.Shape();
    sh.absarc(0, 0, 1, 0, Math.PI * 2, false);
    const path = new THREE.Shape(); path.moveTo(-w / 2, 0); path.lineTo(w / 2, 0); path.quadraticCurveTo(w / 2 + 0.6, h / 2, w / 2, h); path.lineTo(-w / 2, h); path.quadraticCurveTo(-w / 2 - 0.6, h / 2, -w / 2, 0);
    for (const [hx, hy, hr] of holes) { const hole = new THREE.Path(); hole.absarc(hx, hy, hr, 0, Math.PI * 2, true); path.holes.push(hole); }
    const o = new THREE.Mesh(new THREE.ExtrudeGeometry(path, { depth: 0.35, bevelEnabled: true, bevelSize: 0.08, bevelThickness: 0.08, bevelSegments: 2, curveSegments: 18 }), corten);
    o.position.set(x, y, z); o.rotation.set(0, ry, rz); g.add(o);
  };
  slab(2.4, H, [[0, 1.5, 0.75], [0, 3.4, 0.5]], 0, 0, 0, -0.2, 0);
  slab(2.0, H * 0.7, [[0, 1.2, 0.65]], 0.1, 0.4, 0, 0.3, Math.PI / 2 - 0.3);
  solidBox(g, 0, 0, 1.4, 0.9, 0, H);
  g.userData.rot = 0;
  return g;
}

// Daybreak Star Indian Cultural Center (1977, Arai/Jackson with Lawney Reyes;
// HistoryLink 11237): 21,000 sq ft on an octagonal plan, its halves after a
// Coast Salish plank house, four raised geometric roofs for the Daybreak
// Star's four blossoms, cedar posts and big windows. OSM way 159915631,
// ~51 x 48 m.
function daybreak() {
  const g = new THREE.Group();
  const cedar = P(0x7a5236, 0.85, 0, 0.5), roofM = P(0x5b4a3c, 0.8, 0, 0.45), glassM = mat.glass;
  const R = 17;
  const oct = [];
  for (let k = 0; k < 8; k++) { const a = (k / 8) * Math.PI * 2 + Math.PI / 8; oct.push([Math.cos(a) * R, Math.sin(a) * R]); }
  g.add(prism(oct, -0.5, 0.4, P(0x9d978b, 0.9, 0, 0.5)));
  g.add(prism(oct.map(([x, z]) => [x * 0.97, z * 0.97]), 0.4, 4.6, cedar));
  // four wings out to the cardinal points, each under its own pyramid roof
  for (let k = 0; k < 4; k++) {
    const a = (k / 4) * Math.PI * 2, cx = Math.cos(a) * 16, cz = Math.sin(a) * 16;
    g.add(box(12, 4.4, 12, cedar, cx, 0.4, cz, -a));
    g.add(box(12.2, 2.2, 0.2, glassM, cx + Math.cos(a) * 6.05, 1.4, cz + Math.sin(a) * 6.05, -a + Math.PI / 2));
    const pyr = new THREE.Mesh(new THREE.ConeGeometry(9.2, 6.5, 4), roofM);
    pyr.rotation.y = Math.PI / 4 - a; pyr.position.set(cx, 4.8 + 3.25, cz); g.add(pyr);
    for (const sd of [-1, 1]) g.add(cyl(0.3, 0.3, 4.4, P(0x5a3a24, 0.85, 0, 0.5), cx + Math.cos(a) * 6.3 + Math.sin(a) * sd * 5.5, 0.4, cz + Math.sin(a) * 6.3 - Math.cos(a) * sd * 5.5, 8));
    solidBox(g, cx, cz, 6.2, 6.2, 0, 8, -a);
  }
  const centre = new THREE.Mesh(new THREE.ConeGeometry(R * 0.9, 7, 8), roofM);
  centre.rotation.y = Math.PI / 8; centre.position.y = 4.6 + 3.5; g.add(centre);
  solidCircle(g, 0, 0, R, 8);
  return g;
}

const BUILDERS = {
  spaceNeedle: () => { const g = spaceNeedle(); for (const s of needleSolids()) solid(g, s); return g; },
  mopop, arena, spheres, market, wheel, library, aquarium, gasworks, troll, locks,
  ferry: ferryTerminal, pier, kerry: kerryPark, ferriswheelPier: statueLiberty,
  convention, airport, stadiumF: lumen, stadiumB: tmobile, stadiumH: husky, smith,
  bellevueDT,
  westPoint, alkiPoint, rocket, lenin, hammeringMan, eagle, echo, eraser, waterTower, blackSun,
  conservatory, pergola, totem, changingForm, daybreak,
};

/**
 * A boardwalk from a pier deck's edge to the shore, in WORLD coordinates.
 * `land` is the edge point and outward direction in the landmark's frame;
 * from there it walks the terrain in 1 m steps to the first dry ground within
 * 0.9 m of the deck top (a walker's step), at most 70 m out, and lays a
 * sloped timber walk on piles with rails, top running from the deck's height
 * to 5 cm over that ground. Registered as one sloped platform (top linear
 * along its length), so what is walked is what is drawn. Returns null when
 * the deck already meets the ground or no ground is in reach.
 */
function gangway(land, px, top, pz, t, platforms) {
  const c = Math.cos(t), sn = Math.sin(t);
  const x0 = px + land.x * c + land.z * sn, z0 = pz - land.x * sn + land.z * c;
  const dx = land.dx * c + land.dz * sn, dz = -land.dx * sn + land.dz * c;
  let L = 0, endY = null;
  for (let d = 1; d <= 70; d++) {
    const x = x0 + dx * d, z = z0 + dz * d;
    const h = G.terrainHeight(x, z);
    if (!G.isWater(x, z) && h >= top - 0.9) { L = d + 1; endY = Math.min(top, h + 0.05); break; }
  }
  if (endY === null || L < 3) return null;
  const gw = new THREE.Group();
  const yaw = Math.atan2(dx, dz), pitch = Math.atan2(top - endY, L);
  const mx = x0 + dx * (L / 2), mz = z0 + dz * (L / 2), my = (top + endY) / 2;
  const slab = (w, h, off, lift, m) => {
    const o = new THREE.Mesh(new THREE.BoxGeometry(w, h, L / Math.cos(pitch)), m);
    o.rotation.order = 'YXZ';
    o.rotation.set(pitch, yaw, 0);
    // across (dz, -dx) by `off`; `lift` above the walking surface
    o.position.set(mx + dz * off, my + lift - h / 2, mz - dx * off);
    return o;
  };
  gw.add(slab(land.w, 0.35, 0, 0, mat.wood));
  for (const sd of [-1, 1]) {
    const off = sd * (land.w / 2 - 0.12);
    gw.add(slab(0.1, 0.1, off, 1.05, mat.darkSteel));
    gw.add(slab(0.06, 0.06, off, 0.55, mat.darkSteel));
    for (let d = 0; d <= L; d += 3) {
      const yy = top + (endY - top) * (d / L);
      gw.add(box(0.1, 1.05, 0.1, mat.darkSteel, x0 + dx * d + dz * off, yy, z0 + dz * d - dx * off));
    }
    for (let d = 2; d < L; d += 6) {
      const yy = top + (endY - top) * (d / L);
      gw.add(cyl(0.3, 0.3, yy + 6, mat.darkSteel, x0 + dx * d + dz * off * 0.8, -6.35, z0 + dz * d - dx * off * 0.8, 6));
    }
  }
  platforms.push({ x: mx, z: mz, hw: land.w / 2, hd: L / 2, rot: Math.atan2(-dx, dz), y0: top, y1: endY });
  return gw;
}

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
export function buildLandmarks(scene, city, waterLevelAt = null, monorail = null) {
  atlas = new SignAtlas();
  const clusters = new Map();
  const solids = [];
  const dropped = [];
  const addTo = (key, obj) => {
    let c = clusters.get(key);
    if (!c) clusters.set(key, (c = new THREE.Group()));
    c.add(obj);
  };
  // hand-placed fixtures first (see seaplaneDock's comment for why no
  // places.json). Its solids go through the same road test as a landmark's,
  // and its decks become walkable platforms.
  const platforms = [];
  {
    const d = seaplaneDock();
    d.position.set(DOCK.x, 0, DOCK.z);
    for (const s of d.userData.solids || []) {
      const w = worldSolid(s, DOCK.x, 0, DOCK.z, 0);
      if (city && onRoad(city, w)) { dropped.push(`seadock@${w.x.toFixed(0)},${w.z.toFixed(0)}`); continue; }
      solids.push(w);
    }
    platforms.push(...d.userData.platforms);
    addTo('seadock', d);
  }
  // The monorail's guideway and stations (monorail.js). Its columns stand in
  // 5th Avenue's median by design, so its solids skip the carriageway test
  // (monorail.js keeps them out of every lane instead); its lettering joins
  // the sign atlas and so the clusters, its structure is pre-merged.
  let mono = null;
  monoRef = monorail;
  if (monorail) {
    mono = monorail.buildStructure({ sign, glass: mat.glass });
    solids.push(...mono.solids);
    platforms.push(...mono.platforms);
    // each sign (and pane of glass) into the cluster it stands in, sharing
    // that cluster's atlas and glass draws rather than adding a cluster of
    // its own that spans 1.4 km and never culls
    for (const o of [...mono.signs.children]) {
      addTo(`${Math.round(o.position.x / 1200)},${Math.round(o.position.z / 1200)}`, o);
    }
  }
  const marinas = [];
  if (waterLevelAt) {
    MARINAS.forEach((m, i) => {
      const d = marinaDock(m, waterLevelAt, i);
      if (!d) { dropped.push(`marina:${m.name}`); return; }
      // through the same road test as every landmark solid: a curb or pile
      // on a carriageway would be an invisible wall in a lane
      for (const sd of d.solids) {
        if (city && onRoad(city, sd)) { dropped.push(`marina:${m.name}@${sd.x.toFixed(0)},${sd.z.toFixed(0)}`); continue; }
        solids.push(sd);
      }
      platforms.push(...d.plat);
      addTo(`marina${i}`, d.g);
      marinas.push({ name: m.name, x: d.x, z: d.z, level: d.level, moorings: d.moor, seaplanes: !!m.seaplanes,
        land: d.land, n: d.n, t0: d.t0, tp: d.tp });
    });
  }
  // the beaches' props (beachProps), each beach its own cluster
  const beaches = [];
  if (waterLevelAt && G.BEACHES) {
    for (const bp of beachProps(G.BEACHES, city, waterLevelAt)) {
      for (const s of bp.g.userData.solids || []) {
        const w = worldSolid(s, 0, 0, 0, 0);
        if (city && onRoad(city, w)) { dropped.push(`beach:${bp.name}@${w.x.toFixed(0)},${w.z.toFixed(0)}`); continue; }
        solids.push(w);
      }
      addTo(bp.key, bp.g);
      beaches.push({ name: bp.name, kit: bp.kit, x: bp.x, z: bp.z, props: bp.g.children.length });
    }
  }
  for (const l of G.LANDMARKS) {
    const b = BUILDERS[l.kind];
    if (!b) continue;
    const g = b(l);
    const at = g.userData.at;
    const x = at ? at[0] : (l.p ? l.p[0] : l.x);
    const z = at ? at[1] : (l.p ? l.p[1] : l.z);
    const y = at ? at[2] : g.userData.baseY !== undefined ? g.userData.baseY : G.terrainHeight(x, z);
    const t = g.userData.worldAligned ? 0 : g.userData.rot !== undefined ? g.userData.rot : (l.rot || 0);
    g.position.set(x, y, z);
    g.rotation.y = t;
    g.userData.landmark = l.name;
    for (const s of g.userData.solids || []) {
      const w = worldSolid(s, x, y, z, t);
      if (city && onRoad(city, w)) { dropped.push(`${l.kind}@${w.x.toFixed(0)},${w.z.toFixed(0)}`); continue; }
      solids.push(w);
    }
    // PIER DECKS ARE GROUND. They were drawn and not walkable: groundAt over
    // them answered the seabed, so stepping onto the Wheel's deck or a pier
    // dropped you into the bay. Each builder lists the tops it draws, in its
    // own frame (a box, the solid convention); they become city platforms
    // exactly as the seaplane dock's are.
    for (const dk of g.userData.decks || []) {
      const w = worldSolid({ x: dk.x, z: dk.z, hw: dk.hw, hd: dk.hd, rot: 0, y0: dk.top, y1: dk.top }, x, y, z, t);
      platforms.push({ x: w.x, z: w.z, hw: w.hw, hd: w.hd, rot: w.rot, y0: w.y0, y1: w.y1 });
      if (dk.land) {
        const gw = gangway(dk.land, x, y + dk.top, z, t, platforms);
        if (gw) addTo(l.kind === 'airport' ? 'airport' : `${Math.round(x / 1200)},${Math.round(z / 1200)}`, gw);
      }
    }
    addTo(l.kind === 'airport' ? 'airport' : `${Math.round(x / 1200)},${Math.round(z / 1200)}`, g);
  }
  atlas.tex.needsUpdate = true;

  const root = new THREE.Group();
  root.name = 'landmarks';
  const needleMats = new Set(Object.values(NEEDLE_MATS));
  let draws = 0;
  const near = [];
  for (const [key, grp] of clusters) {
    const merged = mergePalette(mergeByMaterial(grp), needleMats);
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
      // A beach's umbrellas and towels are a few pixels past 700 m; eleven far
      // beaches in one downtown view cost a draw each (updateLandmarkRange).
      if (key.startsWith('beach')) near.push({ o, s: o.geometry.boundingSphere, r: 700 });
      const ok = !(o.material.userData && o.material.userData.noShadow) && !o.material.transparent && !o.material.isMeshBasicMaterial;
      o.castShadow = ok;
      o.receiveShadow = ok || o.material.isMeshStandardMaterial;
    });
    root.add(merged);
  }
  if (mono) for (const m of mono.meshes) { root.add(m); draws++; }
  root.userData.draws = draws;
  root.userData.solids = solids.length;
  root.userData.solidsDropped = dropped;
  if (city && city.setLandmarkSolids) city.setLandmarkSolids(solids);
  if (city && city.setPlatforms) city.setPlatforms(platforms);
  // Bellevue Downtown Park's lawn and promenade are open ground: the builder
  // plants the promenade's own trees, so the scatter keeps out (citygen
  // jumpClear)
  if (city) city.clearCircles = [[BDP.x, BDP.z, 121], ...(mono ? mono.clear : [])];
  root.userData.platforms = platforms.length;
  root.userData.marinas = marinas;
  root.userData.beaches = beaches;
  root.userData.near = near;
  scene.add(root);
  return root;
}
