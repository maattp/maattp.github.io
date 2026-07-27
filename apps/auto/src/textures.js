// Every texture in the game is drawn procedurally into a canvas at boot, so the
// app ships as code only and works offline with no image assets.
//
// Surfaces come as a set: albedo + normal + roughness (+ emissive for the ones
// with lit windows). The normal maps are derived from a purpose-drawn height
// pass rather than from the albedo, so window reveals actually read as recesses
// instead of just as dark paint.

import * as THREE from './three.js';
import { mulberry32 } from './util.js';

function canvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return { c, g: c.getContext('2d') };
}

// Ask for the most anisotropy any GPU offers; three clamps it to the device
// maximum on upload. Road surfaces are the case this exists for -- lane
// markings are 8-12 px lines in a 512 texture, seen at a grazing angle from eye
// height, and at anisotropy 8 they shimmered as you walked. Removing the albedo
// map dropped the frame-to-frame churn from a 4 mm camera move from 6.6% of
// pixels to 0.7%, so the flicker was all in this one map.
function tex(c, { repeat = true, aniso = 16, srgb = true, mips = true } = {}) {
  const t = new THREE.CanvasTexture(c);
  if (repeat) {
    t.wrapS = THREE.RepeatWrapping;
    t.wrapT = THREE.RepeatWrapping;
  }
  t.anisotropy = aniso;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.generateMipmaps = mips;
  if (!mips) t.minFilter = THREE.LinearFilter;
  return t;
}

function noise(g, w, h, amount, seed) {
  const r = mulberry32(seed);
  const img = g.getImageData(0, 0, w, h);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const n = (r() - 0.5) * amount;
    d[i] = Math.max(0, Math.min(255, d[i] + n));
    d[i + 1] = Math.max(0, Math.min(255, d[i + 1] + n));
    d[i + 2] = Math.max(0, Math.min(255, d[i + 2] + n));
  }
  g.putImageData(img, 0, 0);
}

/** Sobel a greyscale height canvas into a tangent-space normal map. */
function normalFrom(heightCanvas, strength = 2.0) {
  const w = heightCanvas.width, h = heightCanvas.height;
  const src = heightCanvas.getContext('2d').getImageData(0, 0, w, h).data;
  const lum = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) lum[i] = src[i * 4] / 255;
  const { c, g } = canvas(w, h);
  const img = g.createImageData(w, h);
  const d = img.data;
  const at = (x, y) => lum[(((y % h) + h) % h) * w + (((x % w) + w) % w)];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const dx = (at(x + 1, y) - at(x - 1, y)) * strength;
      // canvas Y runs down, texture V runs up, so the sign flips back here
      const dy = (at(x, y + 1) - at(x, y - 1)) * strength;
      let nx = -dx, ny = dy, nz = 1;
      const l = Math.hypot(nx, ny, nz);
      const i = (y * w + x) * 4;
      d[i] = ((nx / l) * 0.5 + 0.5) * 255;
      d[i + 1] = ((ny / l) * 0.5 + 0.5) * 255;
      d[i + 2] = ((nz / l) * 0.5 + 0.5) * 255;
      d[i + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  return tex(c, { srgb: false });
}

const grey = (v) => {
  const n = Math.max(0, Math.min(255, Math.round(v * 255)));
  return `rgb(${n},${n},${n})`;
};

// ---------------------------------------------------------------------------
// Facades. Each generator fills albedo / height / rough / emissive together.
// ---------------------------------------------------------------------------

function glassSurface() {
  const S = 512;
  const a = canvas(S, S), hgt = canvas(S, S), rgh = canvas(S, S), emi = canvas(S, S);
  const r = mulberry32(7);
  const cols = 8, rows = 8;
  const cw = S / cols, ch = S / rows;

  a.g.fillStyle = '#9fb0b9'; a.g.fillRect(0, 0, S, S);
  hgt.g.fillStyle = grey(0.75); hgt.g.fillRect(0, 0, S, S);
  rgh.g.fillStyle = grey(0.62); rgh.g.fillRect(0, 0, S, S);
  emi.g.fillStyle = '#000'; emi.g.fillRect(0, 0, S, S);

  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const px = x * cw, py = y * ch;
      // spandrel panel between floors
      a.g.fillStyle = '#8d9ba3';
      a.g.fillRect(px, py + ch * 0.72, cw, ch * 0.28);
      hgt.g.fillStyle = grey(0.82);
      hgt.g.fillRect(px, py + ch * 0.72, cw, ch * 0.28);

      const ix = px + 3, iy = py + 3, iw = cw - 6, ih = ch * 0.72 - 5;
      const v = r();
      // recessed pane
      hgt.g.fillStyle = grey(0.22);
      hgt.g.fillRect(ix, iy, iw, ih);
      rgh.g.fillStyle = grey(0.07);
      rgh.g.fillRect(ix, iy, iw, ih);

      const b = 0.6 + v * 0.4;
      a.g.fillStyle = `rgb(${Math.round(104 * b)},${Math.round(134 * b)},${Math.round(150 * b)})`;
      a.g.fillRect(ix, iy, iw, ih);
      const grad = a.g.createLinearGradient(ix, iy, ix, iy + ih);
      grad.addColorStop(0, 'rgba(226,242,252,0.55)');
      grad.addColorStop(0.4, 'rgba(150,182,204,0.12)');
      grad.addColorStop(1, 'rgba(24,38,50,0.34)');
      a.g.fillStyle = grad;
      a.g.fillRect(ix, iy, iw, ih);
      // blinds in some
      if (v > 0.55 && v < 0.78) {
        a.g.fillStyle = 'rgba(228,224,210,0.5)';
        a.g.fillRect(ix, iy, iw, ih * (0.2 + v * 0.4));
        rgh.g.fillStyle = grey(0.55);
        rgh.g.fillRect(ix, iy, iw, ih * (0.2 + v * 0.4));
      }
      if (v > 0.955) { // lit office
        a.g.fillStyle = 'rgba(255,232,178,0.6)';
        a.g.fillRect(ix, iy, iw, ih);
        emi.g.fillStyle = 'rgb(255,206,132)';
        emi.g.fillRect(ix, iy, iw, ih);
      }
      // mullions stand proud
      a.g.fillStyle = '#6e7c85';
      a.g.fillRect(px, py, 3, ch);
      a.g.fillRect(px, py + ch - 3, cw, 3);
      hgt.g.fillStyle = grey(1.0);
      hgt.g.fillRect(px, py, 3, ch);
      hgt.g.fillRect(px, py + ch - 3, cw, 3);
      rgh.g.fillStyle = grey(0.72);
      rgh.g.fillRect(px, py, 3, ch);
      rgh.g.fillRect(px, py + ch - 3, cw, 3);
    }
  }
  noise(a.g, S, S, 9, 3);
  return {
    map: tex(a.c), normalMap: normalFrom(hgt.c, 2.6),
    roughnessMap: tex(rgh.c, { srgb: false }), emissiveMap: tex(emi.c),
  };
}

function masonrySurface() {
  const S = 512;
  const a = canvas(S, S), hgt = canvas(S, S), rgh = canvas(S, S), emi = canvas(S, S);
  const r = mulberry32(21);
  a.g.fillStyle = '#b4a595'; a.g.fillRect(0, 0, S, S);
  hgt.g.fillStyle = grey(0.72); hgt.g.fillRect(0, 0, S, S);
  rgh.g.fillStyle = grey(0.88); rgh.g.fillRect(0, 0, S, S);
  emi.g.fillStyle = '#000'; emi.g.fillRect(0, 0, S, S);

  // stone courses
  for (let y = 0; y < S; y += 16) {
    a.g.fillStyle = 'rgba(0,0,0,0.05)';
    a.g.fillRect(0, y + 14, S, 2);
    hgt.g.fillStyle = grey(0.55);
    hgt.g.fillRect(0, y + 14, S, 2);
  }

  const cols = 4, rows = 4;
  const cw = S / cols, ch = S / rows;
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const px = x * cw + cw * 0.2, py = y * ch + ch * 0.16;
      const w = cw * 0.6, h = ch * 0.52;
      // surround
      a.g.fillStyle = '#c8bcab';
      a.g.fillRect(px - 6, py - 6, w + 12, h + 14);
      hgt.g.fillStyle = grey(0.95);
      hgt.g.fillRect(px - 6, py - 6, w + 12, h + 14);
      // recess
      hgt.g.fillStyle = grey(0.12);
      hgt.g.fillRect(px, py, w, h);
      rgh.g.fillStyle = grey(0.12);
      rgh.g.fillRect(px, py, w, h);
      const v = r();
      a.g.fillStyle = `rgb(${(36 + v * 26) | 0},${(48 + v * 30) | 0},${(58 + v * 34) | 0})`;
      a.g.fillRect(px, py, w, h);
      const grad = a.g.createLinearGradient(px, py, px, py + h);
      grad.addColorStop(0, 'rgba(214,232,244,0.42)');
      grad.addColorStop(1, 'rgba(0,0,0,0.3)');
      a.g.fillStyle = grad;
      a.g.fillRect(px, py, w, h);
      if (v > 0.94) {
        a.g.fillStyle = 'rgba(255,228,172,0.62)';
        a.g.fillRect(px, py, w, h);
        emi.g.fillStyle = 'rgb(250,198,124)';
        emi.g.fillRect(px, py, w, h);
      }
      // glazing bars
      a.g.fillStyle = 'rgba(220,214,200,0.7)';
      a.g.fillRect(px + w / 2 - 1.5, py, 3, h);
      hgt.g.fillStyle = grey(0.5);
      hgt.g.fillRect(px + w / 2 - 1.5, py, 3, h);
      // sill
      a.g.fillStyle = '#d3c7b4';
      a.g.fillRect(px - 8, py + h + 4, w + 16, 6);
      hgt.g.fillStyle = grey(1.0);
      hgt.g.fillRect(px - 8, py + h + 4, w + 16, 6);
    }
  }
  noise(a.g, S, S, 16, 9);
  noise(hgt.g, S, S, 10, 12);
  return {
    map: tex(a.c), normalMap: normalFrom(hgt.c, 2.2),
    roughnessMap: tex(rgh.c, { srgb: false }), emissiveMap: tex(emi.c),
  };
}

function industrialSurface() {
  const S = 512;
  const a = canvas(S, S), hgt = canvas(S, S), rgh = canvas(S, S);
  a.g.fillStyle = '#9ba2a6'; a.g.fillRect(0, 0, S, S);
  hgt.g.fillStyle = grey(0.5); hgt.g.fillRect(0, 0, S, S);
  rgh.g.fillStyle = grey(0.55); rgh.g.fillRect(0, 0, S, S);
  // corrugation
  for (let x = 0; x < S; x += 24) {
    const g1 = a.g.createLinearGradient(x, 0, x + 24, 0);
    g1.addColorStop(0, 'rgba(255,255,255,0.16)');
    g1.addColorStop(0.5, 'rgba(0,0,0,0.02)');
    g1.addColorStop(1, 'rgba(0,0,0,0.16)');
    a.g.fillStyle = g1;
    a.g.fillRect(x, 0, 24, S);
    const g2 = hgt.g.createLinearGradient(x, 0, x + 24, 0);
    g2.addColorStop(0, grey(0.95));
    g2.addColorStop(0.5, grey(0.5));
    g2.addColorStop(1, grey(0.08));
    hgt.g.fillStyle = g2;
    hgt.g.fillRect(x, 0, 24, S);
  }
  // banding rails
  for (const y of [70, 430]) {
    a.g.fillStyle = 'rgba(0,0,0,0.2)';
    a.g.fillRect(0, y, S, 8);
    hgt.g.fillStyle = grey(1.0);
    hgt.g.fillRect(0, y, S, 8);
  }
  const r = mulberry32(31);
  for (let i = 0; i < 5; i++) {
    const x = 30 + i * 96;
    a.g.fillStyle = '#39434c';
    a.g.fillRect(x, 24, 56, 38);
    hgt.g.fillStyle = grey(0.1);
    hgt.g.fillRect(x, 24, 56, 38);
    rgh.g.fillStyle = grey(0.18);
    rgh.g.fillRect(x, 24, 56, 38);
    a.g.fillStyle = r() > 0.6 ? 'rgba(30,40,50,0.8)' : 'rgba(196,220,236,0.6)';
    a.g.fillRect(x + 3, 27, 50, 32);
  }
  // rust streaks
  for (let i = 0; i < 26; i++) {
    const x = r() * S;
    a.g.fillStyle = `rgba(122,74,42,${0.04 + r() * 0.08})`;
    a.g.fillRect(x, r() * S * 0.6, 3 + r() * 8, 40 + r() * 160);
  }
  noise(a.g, S, S, 16, 5);
  return { map: tex(a.c), normalMap: normalFrom(hgt.c, 2.0), roughnessMap: tex(rgh.c, { srgb: false }) };
}

function houseSurface() {
  const S = 512;
  const a = canvas(S, S), hgt = canvas(S, S), rgh = canvas(S, S), emi = canvas(S, S);
  a.g.fillStyle = '#dcd8cf'; a.g.fillRect(0, 0, S, S);
  hgt.g.fillStyle = grey(0.6); hgt.g.fillRect(0, 0, S, S);
  rgh.g.fillStyle = grey(0.8); rgh.g.fillRect(0, 0, S, S);
  emi.g.fillStyle = '#000'; emi.g.fillRect(0, 0, S, S);
  // lap siding: each board casts a shadow line under it
  for (let y = 0; y < S; y += 22) {
    a.g.fillStyle = 'rgba(0,0,0,0.10)';
    a.g.fillRect(0, y + 18, S, 4);
    const g1 = hgt.g.createLinearGradient(0, y, 0, y + 22);
    g1.addColorStop(0, grey(0.35));
    g1.addColorStop(0.82, grey(0.95));
    g1.addColorStop(1, grey(0.1));
    hgt.g.fillStyle = g1;
    hgt.g.fillRect(0, y, S, 22);
  }
  const win = (x, y, w, h, lit) => {
    a.g.fillStyle = '#f6f4ee'; a.g.fillRect(x - 9, y - 9, w + 18, h + 18);
    hgt.g.fillStyle = grey(1.0); hgt.g.fillRect(x - 9, y - 9, w + 18, h + 18);
    hgt.g.fillStyle = grey(0.16); hgt.g.fillRect(x, y, w, h);
    rgh.g.fillStyle = grey(0.1); rgh.g.fillRect(x, y, w, h);
    a.g.fillStyle = '#28323d'; a.g.fillRect(x, y, w, h);
    const grad = a.g.createLinearGradient(x, y, x, y + h);
    grad.addColorStop(0, 'rgba(206,228,244,0.66)');
    grad.addColorStop(1, 'rgba(16,26,36,0.55)');
    a.g.fillStyle = grad; a.g.fillRect(x, y, w, h);
    if (lit) {
      a.g.fillStyle = 'rgba(255,226,164,0.7)'; a.g.fillRect(x, y, w, h);
      emi.g.fillStyle = 'rgb(252,206,140)'; emi.g.fillRect(x, y, w, h);
    }
    a.g.fillStyle = '#f6f4ee';
    a.g.fillRect(x + w / 2 - 3, y, 6, h);
    a.g.fillRect(x, y + h / 2 - 3, w, 6);
    hgt.g.fillStyle = grey(0.8);
    hgt.g.fillRect(x + w / 2 - 3, y, 6, h);
    hgt.g.fillRect(x, y + h / 2 - 3, w, 6);
  };
  win(80, 92, 112, 124, false);
  win(320, 92, 112, 124, true);
  win(80, 320, 112, 124, false);
  // front door with a step and a porch light
  a.g.fillStyle = '#6f4c35'; a.g.fillRect(316, 300, 112, 184);
  hgt.g.fillStyle = grey(0.3); hgt.g.fillRect(316, 300, 112, 184);
  a.g.fillStyle = '#f6f4ee'; a.g.fillRect(306, 292, 132, 10);
  hgt.g.fillStyle = grey(1.0); hgt.g.fillRect(306, 292, 132, 10);
  a.g.fillStyle = 'rgba(255,255,255,0.22)'; a.g.fillRect(330, 316, 84, 62);
  a.g.fillStyle = '#d8c07a'; a.g.fillRect(410, 396, 12, 12);
  noise(a.g, S, S, 11, 11);
  return {
    map: tex(a.c), normalMap: normalFrom(hgt.c, 2.4),
    roughnessMap: tex(rgh.c, { srgb: false }), emissiveMap: tex(emi.c),
  };
}

// ---------------------------------------------------------------------------
// Ground surfaces
// ---------------------------------------------------------------------------

function roadSurface() {
  const S = 512;
  const a = canvas(S, S), hgt = canvas(S, S), rgh = canvas(S, S);
  a.g.fillStyle = '#56595e'; a.g.fillRect(0, 0, S, S);
  hgt.g.fillStyle = grey(0.5); hgt.g.fillRect(0, 0, S, S);
  rgh.g.fillStyle = grey(0.72); rgh.g.fillRect(0, 0, S, S);
  const r = mulberry32(41);
  // aggregate
  for (let i = 0; i < 5200; i++) {
    const x = r() * S, y = r() * S, s = 1 + r() * 3;
    const l = 0.3 + r() * 0.5;
    a.g.fillStyle = `rgba(${(120 * l) | 0},${(124 * l) | 0},${(130 * l) | 0},0.5)`;
    a.g.fillRect(x, y, s, s);
    hgt.g.fillStyle = grey(0.45 + r() * 0.35);
    hgt.g.fillRect(x, y, s, s);
  }
  // patches and repairs, greyscale only so the asphalt never tints
  for (let i = 0; i < 26; i++) {
    const l = r() > 0.5 ? 255 : 0;
    a.g.fillStyle = `rgba(${l},${l},${l},0.03)`;
    a.g.fillRect(r() * S, r() * S, 40 + r() * 120, 16 + r() * 60);
  }
  // polished wheel tracks: darker and much glossier
  for (const cx of [S * 0.26, S * 0.74]) {
    const g1 = rgh.g.createLinearGradient(cx - 26, 0, cx + 26, 0);
    g1.addColorStop(0, grey(0.72));
    g1.addColorStop(0.5, grey(0.34));
    g1.addColorStop(1, grey(0.72));
    rgh.g.fillStyle = g1;
    rgh.g.fillRect(cx - 26, 0, 52, S);
  }
  // No lane markings in here.
  //
  // They used to be painted into this texture, which forced world.js to stretch
  // one repeat across the full road width so the lines landed at the edges and
  // the centre. That made the ASPHALT scale with the road too: a residential
  // street got 1.8 cm per texel and a 27 m highway got 5.3 cm, so on anything
  // wide the aggregate became gravel and the repair patches became 8 m smudges.
  // That is what the wide roads' "messy" surface was. The texture now tiles at a
  // fixed size in metres and world.js lays the markings down as geometry, which
  // also gets them the right real-world width and dash spacing on every class.
  return { map: tex(a.c), normalMap: normalFrom(hgt.c, 1.1), roughnessMap: tex(rgh.c, { srgb: false }) };
}

function sidewalkSurface() {
  const S = 256;
  const a = canvas(S, S), hgt = canvas(S, S), rgh = canvas(S, S);
  a.g.fillStyle = '#bab7ae'; a.g.fillRect(0, 0, S, S);
  hgt.g.fillStyle = grey(0.85); hgt.g.fillRect(0, 0, S, S);
  rgh.g.fillStyle = grey(0.82); rgh.g.fillRect(0, 0, S, S);
  const r = mulberry32(23);
  for (let i = 0; i < 2600; i++) {
    const l = 0.55 + r() * 0.5;
    a.g.fillStyle = `rgba(${(168 * l) | 0},${(166 * l) | 0},${(158 * l) | 0},0.45)`;
    a.g.fillRect(r() * S, r() * S, 1 + r() * 3, 1 + r() * 3);
  }
  // expansion joints
  for (let i = 0; i <= S; i += 64) {
    a.g.fillStyle = 'rgba(0,0,0,0.22)';
    a.g.fillRect(i - 2, 0, 4, S);
    a.g.fillRect(0, i - 2, S, 4);
    hgt.g.fillStyle = grey(0.08);
    hgt.g.fillRect(i - 2, 0, 4, S);
    hgt.g.fillRect(0, i - 2, S, 4);
  }
  // stains
  for (let i = 0; i < 22; i++) {
    a.g.fillStyle = `rgba(60,58,54,${0.03 + r() * 0.06})`;
    a.g.beginPath();
    a.g.ellipse(r() * S, r() * S, 6 + r() * 22, 6 + r() * 18, 0, 0, Math.PI * 2);
    a.g.fill();
  }
  return { map: tex(a.c), normalMap: normalFrom(hgt.c, 1.6), roughnessMap: tex(rgh.c, { srgb: false }) };
}

// Neutral: the terrain's vertex colour decides grass vs pavement vs beach.
function groundSurface() {
  const S = 256;
  const a = canvas(S, S), hgt = canvas(S, S);
  a.g.fillStyle = '#b2b2ae'; a.g.fillRect(0, 0, S, S);
  hgt.g.fillStyle = grey(0.5); hgt.g.fillRect(0, 0, S, S);
  const r = mulberry32(53);
  for (let i = 0; i < 4200; i++) {
    const v = 0.78 + r() * 0.3;
    const l = Math.round(170 * v);
    a.g.fillStyle = `rgba(${l},${l},${Math.round(l * 0.98)},0.28)`;
    const s = 2 + r() * 5;
    a.g.fillRect(r() * S, r() * S, s, s);
    hgt.g.fillStyle = grey(0.42 + r() * 0.22);
    hgt.g.fillRect(r() * S, r() * S, s, s);
  }
  noise(a.g, S, S, 10, 61);
  return { map: tex(a.c), normalMap: normalFrom(hgt.c, 1.4) };
}

function waterSurface() {
  const S = 512;
  const hgt = canvas(S, S);
  hgt.g.fillStyle = grey(0.5); hgt.g.fillRect(0, 0, S, S);
  const r = mulberry32(67);
  // overlapping long swells + chop
  for (let i = 0; i < 900; i++) {
    const x = r() * S, y = r() * S, w = 30 + r() * 150, h = 2 + r() * 5;
    const g1 = hgt.g.createLinearGradient(0, y - h, 0, y + h);
    g1.addColorStop(0, grey(0.5));
    g1.addColorStop(0.5, grey(0.5 + (r() - 0.5) * 0.55));
    g1.addColorStop(1, grey(0.5));
    hgt.g.fillStyle = g1;
    hgt.g.beginPath();
    hgt.g.ellipse(x, y, w, h, (r() - 0.5) * 0.4, 0, Math.PI * 2);
    hgt.g.fill();
  }
  return { normalMap: normalFrom(hgt.c, 1.5) };
}

// ---------------------------------------------------------------------------
// Sky (equirectangular: doubles as the background and the IBL source)
// ---------------------------------------------------------------------------

function skyEquirect() {
  const W = 2048, H = 1024;
  const { c, g } = canvas(W, H);
  const grad = g.createLinearGradient(0, 0, 0, H);
  grad.addColorStop(0.00, '#2f5680');
  grad.addColorStop(0.22, '#4a749a');
  grad.addColorStop(0.42, '#88a8c2');
  grad.addColorStop(0.50, '#c2ced6');
  grad.addColorStop(0.54, '#cdd6db');
  grad.addColorStop(0.70, '#8e969b');
  grad.addColorStop(1.00, '#5d6469');
  g.fillStyle = grad;
  g.fillRect(0, 0, W, H);
  // Sun: placed to match the key light direction so speculars line up.
  const sx = 207, sy = 221;
  const halo = g.createRadialGradient(sx, sy, 0, sx, sy, 460);
  halo.addColorStop(0, 'rgba(255,247,228,0.95)');
  halo.addColorStop(0.06, 'rgba(255,240,206,0.55)');
  halo.addColorStop(0.3, 'rgba(226,232,236,0.22)');
  halo.addColorStop(1, 'rgba(226,232,236,0)');
  g.fillStyle = halo;
  g.fillRect(0, 0, W, H);
  const disc = g.createRadialGradient(sx, sy, 0, sx, sy, 42);
  disc.addColorStop(0, 'rgba(255,255,250,1)');
  disc.addColorStop(0.6, 'rgba(255,250,232,0.9)');
  disc.addColorStop(1, 'rgba(255,246,220,0)');
  g.fillStyle = disc;
  g.fillRect(0, 0, W, H);

  // Broken overcast: soft banks, flattened and denser toward the horizon.
  const r = mulberry32(83);
  for (let layer = 0; layer < 3; layer++) {
    const count = 120 + layer * 90;
    for (let i = 0; i < count; i++) {
      const y = 40 + Math.pow(r(), 0.6) * (H * 0.46);
      const x = r() * W;
      const squash = 0.12 + (y / H) * 0.5;
      const w = (90 + r() * 340) * (1 + layer * 0.4);
      const h = w * squash * (0.2 + r() * 0.35);
      const near = 1 - Math.abs(y - sy) / 900;
      const bright = 0.72 + Math.max(0, near) * 0.28;
      const alpha = 0.035 + r() * 0.075;
      const cg = g.createRadialGradient(x, y, 0, x, y, w);
      const t = Math.round(255 * bright);
      cg.addColorStop(0, `rgba(${t},${t},${Math.round(t * 0.99)},${alpha})`);
      cg.addColorStop(0.55, `rgba(${t},${t},${t},${alpha * 0.5})`);
      cg.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = cg;
      g.beginPath();
      g.ellipse(x, y, w, h, 0, 0, Math.PI * 2);
      g.fill();
      // undersides
      g.fillStyle = `rgba(96,110,124,${alpha * 0.5})`;
      g.beginPath();
      g.ellipse(x, y + h * 0.55, w * 0.8, h * 0.4, 0, 0, Math.PI * 2);
      g.fill();
    }
  }
  // horizon haze band
  const haze = g.createLinearGradient(0, H * 0.44, 0, H * 0.56);
  haze.addColorStop(0, 'rgba(206,216,222,0)');
  haze.addColorStop(0.5, 'rgba(206,216,222,0.85)');
  haze.addColorStop(1, 'rgba(206,216,222,0)');
  g.fillStyle = haze;
  g.fillRect(0, 0, W, H);

  const t = tex(c, { repeat: false, aniso: 4, mips: true });
  t.mapping = THREE.EquirectangularReflectionMapping;
  t.wrapS = THREE.RepeatWrapping;
  return t;
}

function particleTexture() {
  const S = 64, { c, g } = canvas(S, S);
  const grad = g.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.4, 'rgba(255,255,255,0.5)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, S, S);
  return tex(c, { repeat: false, aniso: 1, mips: false });
}

export function buildTextures() {
  return {
    glass: glassSurface(),
    masonry: masonrySurface(),
    industrial: industrialSurface(),
    house: houseSurface(),
    road: roadSurface(),
    sidewalk: sidewalkSurface(),
    ground: groundSurface(),
    water: waterSurface(),
    sky: skyEquirect(),
    particle: particleTexture(),
  };
}
