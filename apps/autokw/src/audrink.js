// Auto KW: THE AUD'S BOWL, in 3D, for hockey.js. The game is hockeygame.js
// unchanged (feet and seconds, x along the rink, +y the near boards); this
// draws it inside the Kitchener Memorial Auditorium's main rink -- the Dom
// Cardillo Arena: a steep bowl of 22 rows right round the ice (the Aud's
// "steepest seats in the OHL" feel: 0.58 m rise a 0.85 m row, ~34 deg), the
// barrel roof on steel arch ribs, the centre-hung clock, the Rangers' banners
// over the west stands -- the OHL championships (J. Ross Robertson Cup 1981,
// 1982, 2003, 2008), the Memorial Cups (1982, 2003) and #1, retired for the
// fans -- and a full house (the Aud seats ~7,000) in Rangers red.
//
// Phone cost: nothing until the doors open. open() builds the scene (its own
// THREE.Scene, its own camera, rendered by the game's renderer while the
// city is not drawn), close() disposes every geometry, material and texture.
// While it is up the city draws nothing at all (main.js: the interior rule).

import * as THREE from './three.js';
import { Builder } from './build.js';
import { RINK, TEAMS } from './hockeygame.js';

const F = 0.3048;                       // feet to metres
const HX = RINK.hx * F, HY = RINK.hy * F, CR = RINK.corner * F;
const ROWS = 22, ROW_D = 0.85, ROW_H = 0.58, D0 = 2.3, Y0 = 1.25;
const SCALE = 1.25;                     // skaters drawn a little big, as broadcast games do
const lin = (h) => { const c = new THREE.Color(h); return [c.r, c.g, c.b]; };   // Color() is linear already
const shade = (c, k) => [c[0] * k, c[1] * k, c[2] * k];

/** The rink's rounded rectangle pushed out by `off`: points round it with outward normals, counter-clockwise. */
function ring(off, arcN = 10) {
  const out = [], hx = HX - CR, hy = HY - CR, r = CR + off;
  const corners = [[hx, hy, 0], [-hx, hy, Math.PI / 2], [-hx, -hy, Math.PI], [hx, -hy, Math.PI * 1.5]];
  for (const [cx, cy, a0] of corners) {
    for (let k = 0; k <= arcN; k++) {
      const a = a0 + (k / arcN) * Math.PI / 2;
      out.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r, Math.cos(a), Math.sin(a)]);
    }
  }
  return out;
}

/** Text on a canvas, fitted to a width. */
function fit(g, s, x, y, w, font) {
  g.font = font;
  const m = g.measureText(s).width;
  g.save(); g.translate(x, y); if (m > w) g.scale(w / m, 1); g.fillText(s, 0, 0); g.restore();
}

export class AudRink {
  /** opts: { renderer, phone } */
  constructor(opts) {
    this.o = opts;
    this.scene = null;
    this.stats = null;
  }

  get built() { return !!this.scene; }

  open() {
    if (!this.scene) this._build();
    this.camX = 0;
    this._board = '';
  }

  close() {
    if (!this.scene) return;
    // free it all: geometry, materials, textures
    this.scene.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
      const ms = o.material ? (Array.isArray(o.material) ? o.material : [o.material]) : [];
      for (const m of ms) { for (const k of ['map', 'emissiveMap', 'alphaMap']) if (m[k]) m[k].dispose(); m.dispose(); }
    });
    this.scene = null; this.cam = null; this.players = null;
  }

  newGame(game) {
    this.game = game;
    if (this.scene) this._dress();
  }

  // --- building ----------------------------------------------------------------------------

  _build() {
    const t0 = performance.now();
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x0c0d12);
    scene.fog = new THREE.Fog(0x0c0d12, 70, 140);
    this.scene = scene;
    this.cam = new THREE.PerspectiveCamera(46, 2, 0.3, 200);
    scene.add(new THREE.HemisphereLight(0xfff4e8, 0x40404a, 2.2));
    const key = new THREE.DirectionalLight(0xffffff, 2.4); key.position.set(10, 40, 18); scene.add(key);
    const mat = new THREE.MeshLambertMaterial({ vertexColors: true });
    let tris = 0;
    const add = (B, m = mat) => { const mesh = new THREE.Mesh(B.build(), m); mesh.matrixAutoUpdate = false; scene.add(mesh); tris += B.idx.length / 3; return mesh; };

    // --- the ice: markings drawn top-down on a canvas, the rounded rectangle cut from a shape
    const ice = this._iceTexture();
    const sh = new THREE.Shape();
    const pr = ring(0, 12);
    sh.moveTo(pr[0][0], -pr[0][1]);
    for (const p of pr.slice(1)) sh.lineTo(p[0], -p[1]);
    const ig = new THREE.ShapeGeometry(sh);
    ig.rotateX(-Math.PI / 2);                                   // shape (x, -z) -> (x, 0, z)
    const ip = ig.attributes.position, uv = new Float32Array(ip.count * 2);
    for (let i = 0; i < ip.count; i++) { uv[i * 2] = (ip.getX(i) + HX) / (2 * HX); uv[i * 2 + 1] = 1 - (ip.getZ(i) + HY) / (2 * HY); }
    ig.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    const iceMesh = new THREE.Mesh(ig, new THREE.MeshLambertMaterial({ map: ice, color: 0xffffff }));
    scene.add(iceMesh);

    // --- the boards (white, yellow kick plate, a red cap), the bowl, the concourse floor
    const B = new Builder(false);
    const WHITE = lin('#eeeeea'), KICK = lin('#e8c830'), CAP = lin('#c8102e'), CONC = lin('#77787a'), SEAT = lin('#a3182a'), SEAT2 = lin('#16264a');
    const wallRing = (pts, y0, y1, col, inward = true) => {
      for (let i = 0; i < pts.length; i++) {
        const a = pts[i], b = pts[(i + 1) % pts.length];
        const n = inward ? [-(a[2] + b[2]) / 2, 0, -(a[3] + b[3]) / 2] : [(a[2] + b[2]) / 2, 0, (a[3] + b[3]) / 2];
        B.quad([a[0], y0, a[1]], [b[0], y0, b[1]], [b[0], y1, b[1]], [a[0], y1, a[1]], n, [0, 0, 0, 0, 0, 0, 0, 0], col);
      }
    };
    const flatRing = (pa, pb, y, col) => {
      for (let i = 0; i < pa.length; i++) {
        const j = (i + 1) % pa.length;
        B.quad([pa[i][0], y, pa[i][1]], [pa[j][0], y, pa[j][1]], [pb[j][0], y, pb[j][1]], [pb[i][0], y, pb[i][1]], [0, 1, 0], [0, 0, 0, 0, 0, 0, 0, 0], col);
      }
    };
    const r0 = ring(0), r1 = ring(0.25);
    wallRing(r0, 0, 0.22, KICK); wallRing(r0, 0.22, 1.07, WHITE);
    flatRing(r0, r1, 1.07, CAP);
    wallRing(r1, 0, 1.07, WHITE, false);
    // between the boards and the first row: the rubber floor, benches' wall
    const rD = ring(D0);
    flatRing(r1, rD, 0.02, lin('#2a2b30'));
    // the bowl: 22 rows, riser then tread; sections in red seats, the end zones navy
    let prev = rD, py = 0;
    for (let i = 0; i < ROWS; i++) {
      const y = Y0 + i * ROW_H, cur = ring(D0 + i * ROW_D), nxt = ring(D0 + (i + 1) * ROW_D);
      // riser: concrete
      for (let k = 0; k < cur.length; k++) {
        const a = cur[k], b = cur[(k + 1) % cur.length];
        B.quad([a[0], py, a[1]], [b[0], py, b[1]], [b[0], y, b[1]], [a[0], y, a[1]], [-(a[2] + b[2]) / 2, 0, -(a[3] + b[3]) / 2], [0, 0, 0, 0, 0, 0, 0, 0], i === 0 ? lin('#30323a') : CONC);
      }
      // tread: seat colour by where round the bowl (the ends navy), a band of darker seats every 7 rows
      for (let k = 0; k < cur.length; k++) {
        const j = (k + 1) % cur.length, mx = (cur[k][0] + cur[j][0]) / 2;
        const col = Math.abs(mx) > HX - CR * 0.4 ? SEAT2 : SEAT;
        B.quad([cur[k][0], y, cur[k][1]], [cur[j][0], y, cur[j][1]], [nxt[j][0], y, nxt[j][1]], [nxt[k][0], y, nxt[k][1]], [0, 1, 0], [0, 0, 0, 0, 0, 0, 0, 0], i % 7 === 6 ? shade(col, 0.7) : col);
      }
      prev = cur; py = y;
    }
    void prev;
    const topY = Y0 + (ROWS - 1) * ROW_H, rTop = ring(D0 + ROWS * ROW_D);
    // the concourse: from the top row out to the building's rectangle
    const WX = HX + D0 + ROWS * ROW_D + 3.5, WZ = HY + D0 + ROWS * ROW_D + 3.5;
    const toRect = (p) => {
      const tx = p[2] ? (Math.sign(p[2]) * WX - p[0]) / p[2] : Infinity, tz = p[3] ? (Math.sign(p[3]) * WZ - p[1]) / p[3] : Infinity;
      const t = Math.min(Math.abs(tx), Math.abs(tz));
      return [Math.max(-WX, Math.min(WX, p[0] + p[2] * t)), Math.max(-WZ, Math.min(WZ, p[1] + p[3] * t))];
    };
    flatRing(rTop, rTop.map(toRect), topY, lin('#5a5a5e'));
    // the walls up to the eave, and the barrel roof on its arch ribs (the Aud's 1951 roof)
    const EAVE = topY + 3.2, RISE = 10;
    const WALL = lin('#8d8a84');
    for (const s of [-1, 1]) {
      B.quad([-WX, topY, s * WZ], [WX, topY, s * WZ], [WX, EAVE, s * WZ], [-WX, EAVE, s * WZ], [0, 0, -s], [0, 0, 0, 0, 0, 0, 0, 0], WALL);
      B.quad([s * WX, topY, -WZ], [s * WX, topY, WZ], [s * WX, EAVE, WZ], [s * WX, EAVE, -WZ], [-s, 0, 0], [0, 0, 0, 0, 0, 0, 0, 0], WALL);
    }
    const NA = 14, arch = (k) => { const a = Math.PI * (k / NA); return [-Math.cos(a) * WZ, EAVE + Math.sin(a) * RISE]; };
    const ROOF = lin('#3a3936'), RIB = lin('#9a9890');
    for (let k = 0; k < NA; k++) {
      const [z0, y0] = arch(k), [z1, y1] = arch(k + 1);
      const am = Math.PI * ((k + 0.5) / NA);     // the inward normal: toward the vault's axis
      B.quad([-WX, y0, z0], [WX, y0, z0], [WX, y1, z1], [-WX, y1, z1], [0, -Math.sin(am), Math.cos(am)], [0, 0, 0, 0, 0, 0, 0, 0], k % 2 ? ROOF : shade(ROOF, 0.9));
      // the end walls' lunettes
      for (const s of [-1, 1]) B.tri([s * WX, EAVE, 0], [s * WX, y0, z0], [s * WX, y1, z1], [-s, 0, 0], WALL);
    }
    for (let x = -WX + 4; x < WX; x += 7.2) {
      for (let k = 0; k < NA; k++) {
        const [z0, y0] = arch(k), [z1, y1] = arch(k + 1);
        B.quad([x - 0.25, y0 - 0.9, z0], [x + 0.25, y0 - 0.9, z0], [x + 0.25, y1 - 0.9, z1], [x - 0.25, y1 - 0.9, z1], [0, -1, 0], [0, 0, 0, 0, 0, 0, 0, 0], RIB);
        B.quad([x - 0.25, y0 - 0.9, z0], [x - 0.25, y1 - 0.9, z1], [x - 0.25, y1, z1], [x - 0.25, y0, z0], [-1, 0, 0], [0, 0, 0, 0, 0, 0, 0, 0], shade(RIB, 0.8));
      }
      // a row of lamps along each rib, over the ice
      for (const z of [-HY * 0.7, 0, HY * 0.7]) {
        const a = Math.acos(Math.max(-1, Math.min(1, -z / WZ))), y = EAVE + Math.sin(a) * RISE - 1.3;
        if (Math.abs(x) < HX + 6) B.box(x, y, z, 1.0, 0.35, 1.0, 0, [4, 4, 3.6]);
      }
    }
    // portals (vomitories) through the bowl: dark mouths every ~16 m of the side rows
    for (const s of [-1, 1]) for (let x = -HX + 8; x <= HX - 8; x += 15.5) {
      const z = s * (HY + D0 + 7 * ROW_D), y = Y0 + 6 * ROW_H;
      B.box(x, y - 2.3, z + s * 1.0, 2.6, 2.4, 2.0, 0, lin('#07070a'), { top: false });
    }
    add(B);

    // --- the glass over the boards
    const GB = new Builder(false);
    const gl = ring(0.1);
    for (let i = 0; i < gl.length; i++) {
      const a = gl[i], b = gl[(i + 1) % gl.length], end = Math.abs(a[0]) > HX - CR;
      GB.quad([a[0], 1.07, a[1]], [b[0], 1.07, b[1]], [b[0], end ? 3.6 : 2.5, b[1]], [a[0], end ? 3.6 : 2.5, a[1]], [-a[2], 0, -a[3]], [0, 0, 0, 0, 0, 0, 0, 0], [0.9, 0.95, 1]);
    }
    const glass = add(GB, new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.1, depthWrite: false, side: THREE.DoubleSide }));
    glass.renderOrder = 2;

    // --- ads on the boards, the banners, the scoreboard: canvases
    tris += this._ads(scene);
    tris += this._banners(scene, WZ, EAVE, RISE);
    this._scoreboard(scene, EAVE);
    // --- nets
    const NB = new Builder(false), NM = new Builder(false);
    for (const sd of [-1, 1]) {
      const gx = sd * RINK.goalX * F, bx = sd * (RINK.goalX + RINK.netDepth) * F, w = RINK.netHalf * F, h = 1.22;
      const red = lin('#d8242c');
      NB.tube([gx, 0, -w], [gx, h, -w], 0.04, 6, red); NB.tube([gx, 0, w], [gx, h, w], 0.04, 6, red); NB.tube([gx, h, -w], [gx, h, w], 0.04, 6, red);
      NB.tube([gx, 0, -w], [bx, 0, -w * 0.8], 0.03, 5, red); NB.tube([gx, 0, w], [bx, 0, w * 0.8], 0.03, 5, red); NB.tube([bx, 0, -w * 0.8], [bx, 0, w * 0.8], 0.03, 5, red);
      const W = [1, 1, 1];
      NM.quad([bx, 0, -w * 0.8], [bx, 0, w * 0.8], [gx + (bx - gx) * 0.3, h, w], [gx + (bx - gx) * 0.3, h, -w], [sd, 0.3, 0], [0, 0, 0, 0, 0, 0, 0, 0], W);
      for (const s of [-1, 1]) NM.quad([gx, 0, s * w], [bx, 0, s * w * 0.8], [gx + (bx - gx) * 0.3, h, s * w], [gx, h, s * w], [0, 0, s], [0, 0, 0, 0, 0, 0, 0, 0], W);
      NM.quad([gx, h, -w], [gx, h, w], [gx + (bx - gx) * 0.3, h, w], [gx + (bx - gx) * 0.3, h, -w], [0, 1, 0], [0, 0, 0, 0, 0, 0, 0, 0], W);
    }
    add(NB);
    const nm = add(NM, new THREE.MeshLambertMaterial({ vertexColors: true, transparent: true, opacity: 0.55, side: THREE.DoubleSide, depthWrite: false }));
    nm.renderOrder = 1;

    tris += this._crowd(scene, topY);
    // --- the skaters and the puck
    this.players = [];
    const pm = new THREE.MeshLambertMaterial({ vertexColors: true });
    this.pmat = pm;
    for (let i = 0; i < 12; i++) {
      const root = new THREE.Group(), body = new THREE.Mesh(new THREE.BufferGeometry(), pm), stick = new THREE.Mesh(new THREE.BufferGeometry(), pm);
      body.add(stick);
      root.add(body);
      root.scale.setScalar(SCALE);
      scene.add(root);
      this.players.push({ root, body, stick });
    }
    this.puck = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.11, 0.06, 12), new THREE.MeshLambertMaterial({ color: 0x050505 }));
    scene.add(this.puck);
    const mk = new THREE.Mesh(new THREE.RingGeometry(0.75, 1.0, 20), new THREE.MeshBasicMaterial({ color: 0xffe83a, transparent: true, opacity: 0.85, depthWrite: false }));
    mk.rotation.x = -Math.PI / 2;
    mk.renderOrder = 3;
    scene.add(mk);
    this.marker = mk;
    const shp = new THREE.Mesh(new THREE.CircleGeometry(0.5, 12), new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.25, depthWrite: false }));
    shp.rotation.x = -Math.PI / 2; this.puckShadow = shp; scene.add(shp);
    if (this.game) this._dress();
    scene.traverse((o) => { if (o.isMesh && o.matrixAutoUpdate === false) o.updateMatrix(); });
    this.stats = { tris: Math.round(tris), ms: Math.round(performance.now() - t0), crowd: this.crowdN };
    if (typeof window !== 'undefined') window.__aud = this.stats;
  }

  _iceTexture() {
    const W = 1024, H = Math.round(W * HY / HX);
    const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
    const g = cv.getContext('2d');
    const sx = (x) => (x + RINK.hx) / (2 * RINK.hx) * W, sy = (y) => (y + RINK.hy) / (2 * RINK.hy) * H, k = W / (2 * RINK.hx);
    g.fillStyle = '#eef4f8'; g.fillRect(0, 0, W, H);
    // scuffs
    let sd = 7; const rnd = () => { sd = (sd * 16807) % 2147483647; return sd / 2147483647; };
    for (let i = 0; i < 1400; i++) { g.fillStyle = rnd() < 0.5 ? 'rgba(180,200,210,0.25)' : 'rgba(255,255,255,0.5)'; g.fillRect(rnd() * W, rnd() * H, 2 + rnd() * 9, 1); }
    const vline = (x, col, w) => { g.fillStyle = col; g.fillRect(sx(x) - w * k / 2, 0, w * k, H); };
    vline(0, '#c8202a', 1); vline(RINK.blue, '#1a4ab0', 1); vline(-RINK.blue, '#1a4ab0', 1);
    vline(RINK.goalX, '#c8202a', 0.17); vline(-RINK.goalX, '#c8202a', 0.17);
    const circ = (x, y, r, col, fill, lw = 0.17) => { g.beginPath(); g.arc(sx(x), sy(y), r * k, 0, Math.PI * 2); if (fill) { g.fillStyle = col; g.fill(); } else { g.strokeStyle = col; g.lineWidth = lw * k; g.stroke(); } };
    circ(0, 0, 15, '#1a4ab0'); circ(0, 0, 0.5, '#1a4ab0', true);
    for (const x of [-69, 69]) for (const y of [-22, 22]) { circ(x, y, 15, '#c8202a'); circ(x, y, 1, '#c8202a', true); }
    for (const x of [-20, 20]) for (const y of [-22, 22]) circ(x, y, 1, '#c8202a', true);
    // the creases
    for (const s of [-1, 1]) {
      g.beginPath(); g.arc(sx(s * RINK.goalX), sy(0), 6 * k, s > 0 ? Math.PI / 2 : -Math.PI / 2, s > 0 ? Math.PI * 1.5 : Math.PI / 2); g.closePath();
      g.fillStyle = '#7aaee8'; g.fill(); g.strokeStyle = '#c8202a'; g.lineWidth = 0.17 * k; g.stroke();
    }
    // centre ice: the Rangers' crest -- a red disc, a navy ring, the script name
    circ(0, 0, 10.5, '#0b2350', true); circ(0, 0, 9.4, '#c8102e', true);
    g.fillStyle = '#ffffff'; g.textAlign = 'center'; g.textBaseline = 'middle';
    fit(g, 'Rangers', sx(0), sy(0), 16 * k, `italic 900 ${Math.round(6 * k)}px Georgia, serif`);
    g.font = `800 ${Math.round(2 * k)}px Helvetica, Arial, sans-serif`;
    g.fillText('KITCHENER', sx(0), sy(-5.8));
    // the neutral zone's lettering
    g.globalAlpha = 0.5; g.fillStyle = '#c8102e';
    for (const s of [-1, 1]) { g.save(); g.translate(sx(s * 45), sy(0)); g.rotate(s * Math.PI / 2); fit(g, 'THE AUD', 0, 0, 30 * k, `900 ${Math.round(6 * k)}px Helvetica, Arial, sans-serif`); g.restore(); }
    g.globalAlpha = 1;
    const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
    return t;
  }

  _ads(scene) {
    const ads = [['Tim Hortons', '#c8102e', '#ffffff'], ['FreshCo', '#4c9a2a', '#ffffff'], ['BINGEMANS', '#1a3a8a', '#ffd23a'], ['ION', '#ffffff', '#0072bc'], ['OKTOBERFEST', '#1a5aa8', '#ffffff'],
      ['Communitech', '#f26722', '#ffffff'], ['CHICOPEE', '#1d3b6b', '#ffffff'], ['GRT', '#ffffff', '#0b3a8c'], ['Home Hardware', '#d8242c', '#ffffff'], ['Waterloo Taxi', '#ffd23a', '#111111'],
      ['KW Surplus', '#3a4a2a', '#ffffff'], ['Schneiders', '#ffffff', '#c8102e']];
    const cv = document.createElement('canvas'); cv.width = 512; cv.height = 64 * ads.length;
    const g = cv.getContext('2d');
    g.textAlign = 'center'; g.textBaseline = 'middle';
    ads.forEach(([s, bg, fg], i) => { g.fillStyle = bg; g.fillRect(0, i * 64, 512, 64); g.fillStyle = fg; fit(g, s, 256, i * 64 + 34, 470, `900 44px Helvetica, Arial, sans-serif`); });
    const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 4;
    const pos = [], uvs = [], nor = [], idx = [];
    let n = 0;
    const panel = (x0, z0, x1, z1, nx, nz, ad) => {
      const v0 = 1 - (ad + 1) / ads.length, v1 = 1 - ad / ads.length;
      for (const [x, y, z, u, v] of [[x0, 0.3, z0, 0, v0], [x1, 0.3, z1, 1, v0], [x1, 1.0, z1, 1, v1], [x0, 1.0, z0, 0, v1]]) { pos.push(x + nx * 0.01, y, z + nz * 0.01); uvs.push(u, v); nor.push(nx, 0, nz); }
      idx.push(n, n + 1, n + 2, n, n + 2, n + 3); n += 4;
    };
    let ad = 0;
    // the sides: panels 5.6 m long, inward faces; the near side reads left to right from the camera
    for (const s of [-1, 1]) for (let x = -HX + CR; x + 5.6 <= HX - CR + 0.01; x += 5.8) {
      const z = s * HY;
      if (s > 0) panel(x + 5.6, z, x, z, 0, -1, ad++ % ads.length); else panel(x, z, x + 5.6, z, 0, 1, ad++ % ads.length);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    geo.setIndex(idx);
    // ...on the far side they face the camera, and read the right way round from it
    const m = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ map: tex, side: THREE.DoubleSide }));
    scene.add(m);
    return idx.length / 3;
  }

  _banners(scene, WZ, EAVE, RISE) {
    // the Rangers' banners over the far (west) stands: red, a navy border, white lettering
    const list = [
      ['OHL CHAMPIONS', 'J. ROSS ROBERTSON CUP', '1981'], ['MEMORIAL CUP', 'CHAMPIONS', '1982'], ['OHL CHAMPIONS', 'J. ROSS ROBERTSON CUP', '1982'],
      ['#1', 'THE FANS', 'RETIRED'],
      ['OHL CHAMPIONS', 'J. ROSS ROBERTSON CUP', '2003'], ['MEMORIAL CUP', 'CHAMPIONS', '2003'], ['OHL CHAMPIONS', 'J. ROSS ROBERTSON CUP', '2008'],
    ];
    const BW = 160, BH = 280;
    const cv = document.createElement('canvas'); cv.width = BW * list.length; cv.height = BH;
    const g = cv.getContext('2d');
    g.textAlign = 'center'; g.textBaseline = 'middle';
    list.forEach(([a, b, c], i) => {
      const x = i * BW, fans = a === '#1';
      g.fillStyle = '#0b2350'; g.fillRect(x, 0, BW, BH);
      g.fillStyle = fans ? '#ffffff' : '#c8102e'; g.fillRect(x + 8, 8, BW - 16, BH - 16);
      const fg = fans ? '#c8102e' : '#ffffff';
      g.fillStyle = fg;
      if (fans) {
        fit(g, '1', x + BW / 2, 112, BW - 30, '900 150px Helvetica, Arial, sans-serif');
        g.fillStyle = '#0b2350'; fit(g, 'THE FANS', x + BW / 2, 214, BW - 30, '900 28px Helvetica, Arial, sans-serif');
        return;
      }
      fit(g, 'KITCHENER', x + BW / 2, 34, BW - 30, '800 18px Helvetica, Arial, sans-serif');
      fit(g, 'Rangers', x + BW / 2, 74, BW - 26, 'italic 900 40px Georgia, serif');
      fit(g, a, x + BW / 2, 126, BW - 26, '900 22px Helvetica, Arial, sans-serif');
      fit(g, b, x + BW / 2, 156, BW - 26, '700 15px Helvetica, Arial, sans-serif');
      fit(g, c, x + BW / 2, 214, BW - 30, '900 58px Helvetica, Arial, sans-serif');
    });
    const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 4;
    const pos = [], uvs = [], idx = [];
    const w = 3.0, h = 5.25, z = -(WZ - 5), n = list.length;
    // hung from the roof over the far rows, high enough to clear the arch's springing
    const a = Math.acos(Math.max(-1, Math.min(1, -z / WZ))), top = EAVE + Math.sin(a) * RISE - 1.6;
    list.forEach((_, i) => {
      const x = (i - (n - 1) / 2) * (w + 1.6), u0 = i / n, u1 = (i + 1) / n, k = i * 4;
      pos.push(x - w / 2, top - h, z, x + w / 2, top - h, z, x + w / 2, top, z, x - w / 2, top, z);
      uvs.push(u0, 0, u1, 0, u1, 1, u0, 1);
      idx.push(k, k + 1, k + 2, k, k + 2, k + 3);
    });
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    scene.add(new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ map: tex, side: THREE.DoubleSide, emissive: 0x222222 })));
    return idx.length / 3;
  }

  _scoreboard(scene, EAVE) {
    const cv = document.createElement('canvas'); cv.width = 512; cv.height = 256;
    this.sbCv = cv; this.sbG = cv.getContext('2d');
    const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace;
    this.sbTex = tex;
    const grp = new THREE.Group();
    const face = new THREE.MeshBasicMaterial({ map: tex });
    const dark = new THREE.MeshLambertMaterial({ color: 0x15161a });
    const box = new THREE.Mesh(new THREE.BoxGeometry(6.4, 3.2, 4.2), [face, face, dark, dark, face, face]);
    grp.add(box);
    const crown = new THREE.Mesh(new THREE.CylinderGeometry(2.6, 2.6, 0.9, 16), new THREE.MeshLambertMaterial({ color: 0xc8102e, emissive: 0x400008 }));
    crown.position.y = 2.05; grp.add(crown);
    grp.position.set(0, EAVE + 1.2, 0);
    scene.add(grp);
  }

  _drawBoard(gm) {
    const g = this.sbG, c = Math.max(0, Math.ceil(gm.clock)), per = gm.period > 3 ? 'OT' : String(gm.period);
    const key = `${gm.score[0]}|${gm.score[1]}|${c}|${per}|${TEAMS[1].abbr}`;
    if (key === this._board) return;
    this._board = key;
    g.fillStyle = '#050505'; g.fillRect(0, 0, 512, 256);
    g.strokeStyle = '#c8102e'; g.lineWidth = 8; g.strokeRect(4, 4, 504, 248);
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillStyle = '#ff3a2a'; g.font = '900 42px Helvetica, Arial, sans-serif';
    g.fillText('RANGERS', 128, 46); g.fillText(TEAMS[1].nick || TEAMS[1].name, 384, 46);
    g.fillStyle = '#ffd23a'; g.font = '900 120px Courier New, monospace';
    g.fillText(String(gm.score[0]), 128, 150); g.fillText(String(gm.score[1]), 384, 150);
    g.fillStyle = '#ffffff'; g.font = '900 44px Courier New, monospace';
    g.fillText(`${Math.floor(c / 60)}:${String(c % 60).padStart(2, '0')}`, 256, 120);
    g.fillStyle = '#7ae8ff'; g.font = '900 30px Helvetica, Arial, sans-serif';
    g.fillText(`PER ${per}`, 256, 176);
    this.sbTex.needsUpdate = true;
  }

  _crowd(scene, topY) {
    // a seated fan: shirt and head, 24 triangles; every seat a hash says is sold
    const B = new Builder(false);
    B.box(0, 0.25, 0, 0.42, 0.62, 0.3, 0, [1, 1, 1]);
    B.box(0, 0.9, -0.02, 0.2, 0.24, 0.22, 0, [0.95, 0.8, 0.68]);
    const geo = B.build();
    const phone = !!this.o.phone;
    const fill = phone ? 0.55 : 0.88;
    const cols = ['#c8102e', '#c8102e', '#c8102e', '#ffffff', '#0b2350', '#0b2350', '#d03a3a', '#2a2a2e', '#7a7a80', '#e8e0d0', '#3a5a8a', '#00703c'].map((h) => new THREE.Color(h));
    const skin = ['#f0c8a0', '#c89870', '#8a5a3a', '#e8b890'];
    void skin;
    let sd = 99; const rnd = () => { sd = (sd * 16807) % 2147483647; return sd / 2147483647; };
    const spots = [];
    for (let i = 0; i < ROWS; i++) {
      const y = Y0 + i * ROW_H, d = D0 + i * ROW_D + ROW_D * 0.55;
      const pts = ring(d, 24);
      for (let k = 0; k < pts.length; k++) {
        const a = pts[k], b = pts[(k + 1) % pts.length];
        const L = Math.hypot(b[0] - a[0], b[1] - a[1]), n = Math.floor(L / 0.56);
        for (let j = 0; j < n; j++) {
          const t = (j + 0.5) / n, x = a[0] + (b[0] - a[0]) * t, z = a[1] + (b[1] - a[1]) * t;
          // aisles every ~14 m of the side rows, and the portals' mouths
          if (Math.abs(z) > HY && (((x + 200) % 15.5) < 1.3)) continue;
          if (Math.abs(z) > HY && i >= 4 && i <= 7 && Math.abs(((x + HX - 8) % 15.5 + 15.5) % 15.5 - 0) < 1.6) continue;
          if (rnd() > fill) continue;
          const nx = (a[2] + b[2]) / 2, nz = (a[3] + b[3]) / 2;
          spots.push([x, y, z, Math.atan2(-nx, -nz)]);
        }
      }
    }
    void topY;
    const N = spots.length;
    const mat = new THREE.MeshLambertMaterial({ vertexColors: true });
    const U = { uJump: { value: 0 }, uTime: { value: 0 } };
    this.crowdU = U;
    mat.onBeforeCompile = (sh) => {
      sh.uniforms.uJump = U.uJump; sh.uniforms.uTime = U.uTime;
      sh.vertexShader = 'uniform float uJump; uniform float uTime;\n' + sh.vertexShader.replace('#include <begin_vertex>',
        `#include <begin_vertex>
        float ph = fract(sin(float(gl_InstanceID) * 12.9898) * 43758.5453);
        transformed.y += max(0.0, sin(uTime * 12.0 + ph * 6.283)) * (0.08 + uJump * 0.35);`);
    };
    const im = new THREE.InstancedMesh(geo, mat, N);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), s = new THREE.Vector3(1, 1, 1), p = new THREE.Vector3();
    for (let i = 0; i < N; i++) {
      const [x, y, z, yaw] = spots[i];
      e.set(0, yaw, 0); q.setFromEuler(e); p.set(x, y, z);
      s.set(0.9 + rnd() * 0.2, 0.9 + rnd() * 0.2, 1);
      m.compose(p, q, s); im.setMatrixAt(i, m);
      im.setColorAt(i, cols[Math.floor(rnd() * cols.length)]);
    }
    im.frustumCulled = false;
    scene.add(im);
    this.crowdN = N;
    return N * geo.index.count / 3;
  }

  /** Each skater's mesh in his team's colours (re-dressed for each game's visitors). */
  _dress() {
    const gm = this.game;
    if (!gm || !this.players) return;
    gm.players.forEach((pl, i) => {
      const tm = TEAMS[pl.team], v = this.players[i];
      const J = lin(tm.jersey), T = lin(tm.trim), P = lin(tm.pants), H = lin(tm.helmet), SK = [0.04, 0.04, 0.045], FACE = lin('#e0b08a');
      const B = new Builder(false);
      if (pl.goalie) {
        const PAD = [0.92, 0.92, 0.9];
        for (const s of [-1, 1]) { B.box(0.05, 0, s * 0.17, 0.34, 0.85, 0.26, 0, PAD); B.box(0.05, 0.4, s * 0.17, 0.36, 0.08, 0.28, 0, T); }
        B.box(-0.02, 0.85, 0, 0.42, 0.3, 0.6, 0, P);
        B.box(-0.02, 1.12, 0, 0.46, 0.6, 0.78, 0, J);
        B.box(-0.02, 1.3, 0, 0.47, 0.1, 0.79, 0, T);
        B.box(0.28, 1.05, 0.42, 0.12, 0.36, 0.28, 0, PAD);       // the blocker
        B.box(0.26, 1.15, -0.44, 0.28, 0.3, 0.3, 0, T);           // the glove
        B.box(0.0, 1.72, 0, 0.3, 0.32, 0.28, 0, [0.95, 0.95, 0.95]);   // the mask
        B.box(0.15, 1.78, 0, 0.02, 0.14, 0.2, 0, [0.15, 0.15, 0.15]);
      } else {
        for (const s of [-1, 1]) {
          B.box(0.02, 0, s * 0.12, 0.34, 0.1, 0.1, 0, SK);
          B.box(0, 0.1, s * 0.12, 0.14, 0.62, 0.14, 0, P);
          B.box(0, 0.42, s * 0.12, 0.15, 0.08, 0.15, 0, T);
        }
        B.box(0, 0.72, 0, 0.3, 0.3, 0.44, 0, P);
        B.box(0, 1.0, 0, 0.32, 0.56, 0.52, 0, J);
        B.box(0, 1.1, 0, 0.33, 0.08, 0.53, 0, T);
        for (const s of [-1, 1]) B.box(0.12, 1.05, s * 0.3, 0.42, 0.14, 0.13, 0.25 * s, J);
        B.box(0.02, 1.57, 0, 0.26, 0.17, 0.24, 0, FACE);
        B.box(0, 1.7, 0, 0.29, 0.14, 0.27, 0, H);
      }
      v.body.geometry.dispose();
      v.body.geometry = B.build();
      const S = new Builder(false), WOOD = lin('#8a6a40');
      if (pl.goalie) { S.box(0.55, 0, 0.1, 0.9, 0.06, 0.1, 0, WOOD); S.box(0.35, 0.05, 0.1, 0.06, 0.7, 0.08, 0, WOOD); }
      else { S.tube([0.3, 1.0, 0.25], [1.15, 0.05, 0.28], 0.025, 5, WOOD); S.box(1.22, 0, 0.3, 0.3, 0.07, 0.06, 0, [0.06, 0.06, 0.06]); }
      v.stick.geometry.dispose();
      v.stick.geometry = S.build();
    });
  }

  // --- the frame ---------------------------------------------------------------------------

  /** Pose everything from the game and draw it with the game's renderer. */
  render(gm, dt, st) {
    if (!this.scene) return;
    const r = this.o.renderer;
    if (gm !== this.game) this.newGame(gm);
    this._drawBoard(gm);
    // skaters
    gm.players.forEach((pl, i) => {
      const v = this.players[i];
      v.root.position.set(pl.x * F, 0, pl.y * F);
      v.root.rotation.y = -pl.face;
      const sp = Math.hypot(pl.vx, pl.vy), ph = pl.stride * Math.PI * 2;
      if (pl.down > 0) { v.body.rotation.set(0, 0, Math.PI / 2 * 0.92); v.body.position.set(-0.9, 0.18, 0); }
      else if (pl.goalie) {
        const sv = pl.save > 0;
        v.body.rotation.set(0, 0, sv ? -0.1 : -0.18); v.body.position.set(0, sv ? -0.25 : 0, 0);
        v.body.scale.set(1, sv ? 0.8 : 1, sv ? 1.3 : 1);
      } else {
        const lean = 0.15 + Math.min(1, sp / 25) * 0.3;
        v.body.rotation.set(sp > 2 ? Math.sin(ph) * 0.12 : 0, 0, -lean);
        v.body.position.set(0, sp > 2 ? Math.abs(Math.sin(ph)) * 0.05 : 0, sp > 2 ? Math.sin(ph) * 0.06 : 0);
      }
      // the stick: up on a wind-up, down on the ice otherwise
      const wu = pl.windup > 0 ? Math.min(1, pl.windup / 0.4) : 0;
      v.stick.rotation.set(0, 0, wu * 1.6);
      v.stick.position.set(-wu * 0.3, wu * 0.5, 0);
    });
    const ctl = gm.ctl;
    if (ctl && gm.human === ctl.team) {
      this.marker.visible = true;
      this.marker.position.set(ctl.x * F, 0.03, ctl.y * F);
      this.marker.material.opacity = gm.puck.owner === ctl || Math.floor(gm.t * 6) % 2 === 0 ? 0.9 : 0.4;
    } else this.marker.visible = false;
    // the puck (held over the dot by the linesman before the drop)
    const pk = gm.puck;
    const held = gm.state === 'faceoff' && gm.stateT < gm.fo.drop;
    this.puck.position.set(pk.x * F, held ? 1.25 : 0.04 + pk.z * F, pk.y * F);
    this.puckShadow.position.set(pk.x * F, 0.02, pk.y * F);
    this.puckShadow.visible = !held;
    // the crowd stands up on a goal
    this.crowdU.uTime.value = gm.t;
    this.crowdU.uJump.value += ((st.flash > 0 ? 1 : 0) - this.crowdU.uJump.value) * Math.min(1, dt * 4);
    // the broadcast camera, high in the near stands, leading the puck; the
    // intro walks in through a portal and climbs to it
    const want = Math.max(-HX + 16, Math.min(HX - 16, (pk.x + pk.vx * 0.25) * F));
    this.camX += (want - this.camX) * Math.min(1, dt * 3);
    const W = r.domElement.clientWidth || 800, H = r.domElement.clientHeight || 400;
    const aspect = W / H, narrow = aspect < 1.4;
    const bx = this.camX * (narrow ? 1 : 0.92), by = narrow ? 22 : 14.5, bz = narrow ? 30 : 27.5;
    let cx = bx, cy = by, cz = bz, tx = this.camX * 0.94, ty = 0, tz = narrow ? 0 : -1.5;
    if (st.intro >= 0) {
      const k = Math.min(1, st.intro / 3.2), e = k * k * (3 - 2 * k);
      const sx = -7, sy = Y0 + 5 * ROW_H + 1.6, sz = HY + D0 + 6 * ROW_D;
      cx = sx + (bx - sx) * e; cy = sy + (by - sy) * e; cz = sz + (bz - sz) * e;
      tx = 6 * (1 - e) + tx * e; ty = 2.5 * (1 - e); tz = -HY * (1 - e) + tz * e;
    }
    const cam = this.cam;
    cam.aspect = aspect; cam.fov = narrow ? 60 : 44; cam.updateProjectionMatrix();
    cam.position.set(cx, cy, cz); cam.lookAt(tx, ty, tz);
    r.setRenderTarget(null);
    r.render(this.scene, cam);
    this.lastCalls = r.info.render.calls; this.lastTris = r.info.render.triangles;
  }
}
