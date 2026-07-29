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
function tex(c, { repeat = true, aniso = 16, srgb = true, mips = true, clampS = false } = {}) {
  const t = new THREE.CanvasTexture(c);
  if (repeat) {
    t.wrapS = clampS ? THREE.ClampToEdgeWrapping : THREE.RepeatWrapping;
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

/** Sobel a greyscale height canvas into a tangent-space normal map canvas. */
function normalCanvas(heightCanvas, strength = 2.0) {
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
  return c;
}

function normalFrom(heightCanvas, strength = 2.0) {
  return tex(normalCanvas(heightCanvas, strength), { srgb: false });
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

      // Per-pane value jitter has to be SMALL. At 0.6..1.0 the panes varied
      // more than the mullions separating them, so from any distance the
      // curtain wall resolved as mottled camouflage rather than as a window
      // grid -- the grid was there, it was just quieter than the noise on it.
      const b = 0.82 + v * 0.18;
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
      a.g.fillStyle = '#68767f';
      a.g.fillRect(px, py, 5, ch);
      a.g.fillRect(px, py + ch - 5, cw, 5);
      hgt.g.fillStyle = grey(1.0);
      hgt.g.fillRect(px, py, 5, ch);
      hgt.g.fillRect(px, py + ch - 5, cw, 5);
      rgh.g.fillStyle = grey(0.72);
      rgh.g.fillRect(px, py, 5, ch);
      rgh.g.fillRect(px, py + ch - 5, cw, 5);
    }
  }
  for (let y = 0; y < rows; y += 2) {
    a.g.fillStyle = 'rgba(46,56,64,0.5)';
    a.g.fillRect(0, y * ch + ch - 7, S, 9);
    hgt.g.fillStyle = grey(1.0);
    hgt.g.fillRect(0, y * ch + ch - 7, S, 9);
  }
  noise(a.g, S, S, 5, 3);
  return {
    map: tex(a.c), normalMap: normalFrom(hgt.c, 2.6),
    roughnessMap: tex(rgh.c, { srgb: false }), emissiveMap: tex(emi.c),
  };
}

/**
 * Wall surface generator, shared by the stone and brick materials.
 *
 * One texture with one per-building tint was not enough: a family colour can
 * only scale what the texture already is, so concrete, stucco and red brick
 * came out as three values of the same material and the whole city read as one
 * stone. What actually separates brick from stone at street distance is the
 * COURSING -- a fine mortar grid against a plain banded ashlar -- and no tint
 * can produce that. Two calls, two textures, one draw call each.
 *
 * `opts.course` is the mortar pitch in pixels; 0 draws smooth ashlar banding
 * instead. `opts.mortar` is the joint colour, which is what makes brick read
 * as brick from across a street.
 */
function masonrySurface(opts = {}) {
  const {
    base = '#adaba6', mortar = null, course = 0, seedN = 21,
    surround = '#c2c0ba', sill = '#cdcbc4', flecks = 900,
  } = opts;
  const S = 512;
  const a = canvas(S, S), hgt = canvas(S, S), rgh = canvas(S, S), emi = canvas(S, S);
  const r = mulberry32(seedN);
  // The base has to be NEUTRAL. At the old warm tan (#b4a595) every family
  // colour multiplied through to the same beige-orange: concrete, painted
  // stucco and red brick were one material with three names, which is why a
  // street of five families still read as one. Grey lets the tints separate.
  a.g.fillStyle = base; a.g.fillRect(0, 0, S, S);
  hgt.g.fillStyle = grey(0.72); hgt.g.fillRect(0, 0, S, S);
  rgh.g.fillStyle = grey(0.88); rgh.g.fillRect(0, 0, S, S);
  emi.g.fillStyle = '#000'; emi.g.fillRect(0, 0, S, S);

  // Masonry grain: fine, irregular, and albedo-only.
  //
  // This used to be 32 hard courses per tile with a height notch under each.
  // The tile spans 13.6 m, so those "brick courses" were 42 cm apart and cut
  // 42 cm deep grooves -- at that pitch and depth they read as clapboard
  // siding lapped across a masonry wall, which is two material metaphors on
  // one surface. Real coursing at this texel density is sub-pixel, so it
  // belongs in the grain rather than as geometry-scale relief.
  if (course > 0) {
    // Brick: a real running bond. The mortar is drawn as its own colour rather
    // than as a black line, because a warm brick against a pale joint is most
    // of what the eye uses to name the material at a distance, and a grey line
    // just reads as dirt.
    const bw = course * 2.4;
    for (let y = 0, row = 0; y < S; y += course, row++) {
      a.g.fillStyle = mortar;
      a.g.fillRect(0, y + course - 2, S, 2);
      const off = (row % 2) * (bw / 2);
      for (let x = -bw; x < S + bw; x += bw) {
        a.g.fillRect(x + off, y, 2, course);
        // Per-brick value jitter, small enough to stay one material.
        a.g.fillStyle = r() > 0.5
          ? `rgba(255,255,255,${0.03 + r() * 0.06})`
          : `rgba(0,0,0,${0.03 + r() * 0.07})`;
        a.g.fillRect(x + off + 2, y, bw - 2, course - 2);
        a.g.fillStyle = mortar;
      }
      hgt.g.fillStyle = grey(0.5);
      hgt.g.fillRect(0, y + course - 2, S, 2);
    }
  } else {
    for (let y = 6; y < S; y += 6) {
      a.g.fillStyle = `rgba(0,0,0,${0.012 + r() * 0.016})`;
      a.g.fillRect(0, y, S, 1);
    }
    for (let i = 0; i < flecks; i++) {
      const bx = r() * S, by = ((r() * S) / 6 | 0) * 6;
      a.g.fillStyle = r() > 0.5 ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.05)';
      a.g.fillRect(bx, by, 8 + r() * 14, 5);
    }
  }

  // One spandrel band per storey -- an actual architectural feature at an
  // actual architectural pitch, unlike the courses it replaces.
  const storey = S / 4;
  for (let y = 0; y < S; y += storey) {
    a.g.fillStyle = 'rgba(0,0,0,0.07)';
    a.g.fillRect(0, y + storey - 7, S, 5);
    hgt.g.fillStyle = grey(0.58);
    hgt.g.fillRect(0, y + storey - 7, S, 5);
    hgt.g.fillStyle = grey(0.86);
    hgt.g.fillRect(0, y + storey - 10, S, 3);
  }

  const cols = 4, rows = 4;
  const cw = S / cols, ch = S / rows;
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const px = x * cw + cw * 0.2, py = y * ch + ch * 0.16;
      const w = cw * 0.6, h = ch * 0.52;
      // surround
      a.g.fillStyle = surround;
      a.g.fillRect(px - 6, py - 6, w + 12, h + 14);
      hgt.g.fillStyle = grey(0.95);
      hgt.g.fillRect(px - 6, py - 6, w + 12, h + 14);
      // recess
      hgt.g.fillStyle = grey(0.12);
      hgt.g.fillRect(px, py, w, h);
      rgh.g.fillStyle = grey(0.12);
      rgh.g.fillRect(px, py, w, h);
      const v = r();
      // Glazing is BRIGHT, not black.
      //
      // The panes were rgb(36,48,58) -- and the whole facade, windows
      // included, is then multiplied by the building's family colour, so on a
      // red brick block the windows came out at (29,18,16): solid black holes.
      // It is also just wrong. A window seen from outside in daylight is
      // mostly a reflection of the sky, which is the brightest thing around;
      // it only goes dark where the reveal shades it. Starting bright means
      // the tint darkens it to a believable place instead of to nothing.
      a.g.fillStyle = `rgb(${(122 + v * 34) | 0},${(144 + v * 34) | 0},${(164 + v * 32) | 0})`;
      a.g.fillRect(px, py, w, h);
      const grad = a.g.createLinearGradient(px, py, px, py + h);
      grad.addColorStop(0, 'rgba(226,240,250,0.55)');
      grad.addColorStop(0.55, 'rgba(150,172,190,0.15)');
      grad.addColorStop(1, 'rgba(28,38,48,0.42)');
      a.g.fillStyle = grad;
      a.g.fillRect(px, py, w, h);
      // Per-window content. Every window in the city being the identical unit
      // is what makes a facade read as wallpaper; a floor where one blind is
      // down and the next is half up is what makes it read as occupied.
      if (v > 0.30 && v < 0.62) {
        // blind, pulled to a different height in each
        const bh = h * (0.18 + v * 0.62);
        a.g.fillStyle = 'rgba(226,220,202,0.72)';
        a.g.fillRect(px, py, w, bh);
        rgh.g.fillStyle = grey(0.6);
        rgh.g.fillRect(px, py, w, bh);
      } else if (v > 0.72 && v < 0.80) {
        // dark interior, a room with nothing behind the glass
        a.g.fillStyle = 'rgba(22,26,32,0.55)';
        a.g.fillRect(px, py, w, h);
      }
      if (v > 0.94) {
        a.g.fillStyle = 'rgba(255,228,172,0.62)';
        a.g.fillRect(px, py, w, h);
        emi.g.fillStyle = 'rgb(250,198,124)';
        emi.g.fillRect(px, py, w, h);
      }
      // Air-conditioner in a few openings, hung on the sill.
      if (v > 0.86 && v < 0.92) {
        a.g.fillStyle = '#8d8f90';
        a.g.fillRect(px + w * 0.2, py + h * 0.62, w * 0.6, h * 0.38);
        hgt.g.fillStyle = grey(0.9);
        hgt.g.fillRect(px + w * 0.2, py + h * 0.62, w * 0.6, h * 0.38);
      }
      // glazing bars
      a.g.fillStyle = 'rgba(220,214,200,0.7)';
      a.g.fillRect(px + w / 2 - 1.5, py, 3, h);
      hgt.g.fillStyle = grey(0.5);
      hgt.g.fillRect(px + w / 2 - 1.5, py, 3, h);
      // sill
      a.g.fillStyle = sill;
      a.g.fillRect(px - 8, py + h + 4, w + 16, 6);
      hgt.g.fillStyle = grey(1.0);
      hgt.g.fillRect(px - 8, py + h + 4, w + 16, 6);
    }
  }
  noise(a.g, S, S, 16, 9);
  noise(hgt.g, S, S, 3, 12);
  return { albedo: a.c, height: hgt.c, rough: rgh.c, emissive: emi.c, nrm: 2.2 };
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
  return { albedo: a.c, height: hgt.c, rough: rgh.c, emissive: null, nrm: 2.0 };
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
  return { albedo: a.c, height: hgt.c, rough: rgh.c, emissive: emi.c, nrm: 2.4 };
}

// ---------------------------------------------------------------------------
// Ground surfaces
// ---------------------------------------------------------------------------

function roadSurface() {
  const S = 512;
  const a = canvas(S, S), hgt = canvas(S, S), rgh = canvas(S, S);
  // Judge the asphalt by its MEAN, not by its base colour.
  //
  // The base was #56595e -- about 0.095 linear, which is right for tarmac --
  // but the aggregate, seams and patches painted on top all skew dark, and the
  // rendered mean came out at 0.043: less than half of real asphalt. Street
  // level got away with it because bright facades fill the frame; from the air,
  // where road is most of what you can see, the whole near-field went black
  // while the fogged skyline stayed bright and the city read inside-out.
  a.g.fillStyle = '#63666c'; a.g.fillRect(0, 0, S, S);
  hgt.g.fillStyle = grey(0.5); hgt.g.fillRect(0, 0, S, S);
  rgh.g.fillStyle = grey(0.72); rgh.g.fillRect(0, 0, S, S);
  const r = mulberry32(41);
  // aggregate
  for (let i = 0; i < 5200; i++) {
    const x = r() * S, y = r() * S, s = 1 + r() * 3;
    const l = 0.5 + r() * 0.55;
    a.g.fillStyle = `rgba(${(120 * l) | 0},${(124 * l) | 0},${(130 * l) | 0},0.5)`;
    a.g.fillRect(x, y, s, s);
    hgt.g.fillStyle = grey(0.45 + r() * 0.35);
    hgt.g.fillRect(x, y, s, s);
  }
  // Patches, repairs and crack seams. These were at 3% alpha, which is under
  // one 8-bit step -- literally invisible, so the asphalt was uniform pepper
  // noise over a flat value. Greyscale only, so the tarmac never tints.
  for (let i = 0; i < 8; i++) {
    const l = r() > 0.5 ? 190 : 70;
    a.g.fillStyle = `rgba(${l},${l},${l},${0.03 + r() * 0.03})`;
    const pw = 40 + r() * 130, ph = 20 + r() * 70;
    const px = r() * S, py = r() * S;
    a.g.fillRect(px, py, pw, ph);
    hgt.g.fillStyle = grey(0.42 + r() * 0.2);
    hgt.g.fillRect(px, py, pw, ph);
    rgh.g.fillStyle = grey(0.5 + r() * 0.3);
    rgh.g.fillRect(px, py, pw, ph);
  }
  // Crack seams: a FEW, faint.
  //
  // This was 30 seams per tile at 50 % opacity. The tile repeats every few
  // metres of road, so the whole city ended up under a dense net of black
  // squiggles and the tarmac read as dried mud rather than asphalt. A road has
  // the odd seam, not a craquelure.
  for (let i = 0; i < 5; i++) {
    let cx = r() * S, cy = r() * S;
    let ang = r() * Math.PI * 2;
    a.g.strokeStyle = 'rgba(38,38,42,0.20)';
    a.g.lineWidth = 1 + r() * 0.6;
    a.g.beginPath();
    a.g.moveTo(cx, cy);
    for (let k = 0; k < 4; k++) {
      ang += (r() - 0.5) * 0.9;
      cx += Math.cos(ang) * (14 + r() * 26);
      cy += Math.sin(ang) * (14 + r() * 26);
      a.g.lineTo(cx, cy);
    }
    a.g.stroke();
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
  // Large-scale staining, several times the tile period, so the eye stops
  // locking onto the 1 m slab grid repeating to the horizon.
  for (let i = 0; i < 14; i++) {
    const bx = r() * S, by = r() * S, br = 40 + r() * 90;
    const sg = a.g.createRadialGradient(bx, by, 0, bx, by, br);
    const dark = r() > 0.5;
    sg.addColorStop(0, dark ? 'rgba(96,94,88,0.20)' : 'rgba(206,203,194,0.18)');
    sg.addColorStop(1, 'rgba(0,0,0,0)');
    a.g.fillStyle = sg;
    a.g.beginPath();
    a.g.ellipse(bx, by, br, br * (0.6 + r() * 0.6), r() * 3.14, 0, Math.PI * 2);
    a.g.fill();
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
  // Chroma, at the luminance the sky already had.
  //
  // The stops were never the problem -- #88a8c2 is saturation 0.227. Measured
  // off the rendered frames, the sky arrives on screen at **0.010 to 0.020**:
  // achromatic grey across a third to a half of most frames, and it is also
  // 100 % of the image-based light, so every shaded facade and the whole surface
  // of Puget Sound were being lit by grey. The bleaching happens below, in the
  // cloud pass and the haze band. These stops keep their luminance and take
  // their hue back.
  grad.addColorStop(0.00, '#1f4f8c');
  grad.addColorStop(0.22, '#3f74ab');
  grad.addColorStop(0.42, '#7ba7cd');
  grad.addColorStop(0.50, '#b6cbdb');
  grad.addColorStop(0.54, '#c6d4dd');
  grad.addColorStop(0.70, '#8b979f');
  grad.addColorStop(1.00, '#5a6469');
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
  //
  // These used to be 390 ellipses squashed to about a fifteenth of their width
  // at 3-11 % alpha. Individually invisible, they stacked into continuous
  // horizontal streaks right across the equirect -- which reads in-game as a
  // banded, combed sky and was twice diagnosed as a dither or precision bug in
  // the post chain. It was never post. Fewer, larger, rounder banks with real
  // gaps between them, and enough alpha each to be a cloud rather than a wash.
  const r = mulberry32(83);
  for (let layer = 0; layer < 3; layer++) {
    const count = 14 + layer * 9;
    for (let i = 0; i < count; i++) {
      // Keep out of the zenith. Equirect x spans a full 360 deg at every
      // latitude, so a bank drawn near y=0 is stretched across an enormous arc
      // and renders as a grey swirl rather than a cloud. From about 25 deg
      // down to the horizon is the band a player actually looks at anyway.
      const y = H * 0.26 + Math.pow(r(), 0.8) * (H * 0.21);
      const x = r() * W;
      // Perspective still flattens a bank toward the horizon, but the floor is
      // high enough that the shape stays a cloud and not a line.
      const squash = 0.46 + (y / H) * 0.5;
      // Clamp the width. At 630 px this reached 110 degrees of azimuth, and a
      // bank that wide sitting 59 degrees up wraps the zenith region and reads
      // as one grey smear across the top of the frame -- visible in five of the
      // seven beauty shots. The comment below always said to keep out of the
      // zenith; nothing enforced it.
      const w = Math.min(W * 0.11, (110 + r() * 200) * (1 + layer * 0.3));
      const h = w * squash * (0.34 + r() * 0.3);
      const near = 1 - Math.abs(y - sy) / 900;
      const bright = 0.88 + Math.max(0, near) * 0.12;
      // Higher per-cloud, far fewer clouds. 228 banks over a 2048x307 band was
      // roughly thirty times overdraw at 0.12 alpha -- about an 80 % white wash
      // over the entire sky, which is what took the chroma out.
      const alpha = 0.16 + r() * 0.16;
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
      g.fillStyle = `rgba(138,150,162,${alpha * 0.42})`;
      g.beginPath();
      g.ellipse(x, y + h * 0.55, w * 0.8, h * 0.4, 0, 0, Math.PI * 2);
      g.fill();
    }
  }
  // horizon haze band
  // Narrower and much weaker, and tinted to scene.fog's own colour so the
  // horizon and the fog agree instead of meeting at a seam. At 0.85 alpha across
  // v 0.44-0.56 this was a near-opaque grey wash over the horizon plus or minus
  // 22 degrees -- which is exactly where every street-level shot points.
  const haze = g.createLinearGradient(0, H * 0.47, 0, H * 0.53);
  haze.addColorStop(0, 'rgba(185,195,207,0)');
  haze.addColorStop(0.5, 'rgba(185,195,207,0.35)');
  haze.addColorStop(1, 'rgba(185,195,207,0)');
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


/**
 * Signage atlas: a 4 x 4 grid of shopfront fascia plates.
 *
 * There was not one sign anywhere in the city, which is the single loudest
 * difference between this and an open world of the era -- a real street is
 * something like a third signage by visual weight. One texture with sixteen
 * designs lets every shopfront in the map pick a different one through its UVs
 * and still cost a single draw call for the whole chunk.
 *
 * Wordmarks are blocks, not glyphs. At the distance a fascia is ever read the
 * eye is resolving the rhythm of a word, not its letters, and blocks mip
 * cleanly where real type turns to mush.
 */
function signSurface() {
  const S = 512, N = 4, C = S / N;
  const a = canvas(S, S), emi = canvas(S, S), rgh = canvas(S, S);
  const r = mulberry32(313);
  a.g.fillStyle = '#1a1c1f'; a.g.fillRect(0, 0, S, S);
  emi.g.fillStyle = '#000'; emi.g.fillRect(0, 0, S, S);
  rgh.g.fillStyle = grey(0.6); rgh.g.fillRect(0, 0, S, S);

  // Plate colours a high street actually uses: saturated but not primary.
  const PLATES = [
    ['#1f3f6b', '#eef2f6'], ['#7a1f22', '#f2e6d2'], ['#1d4a35', '#f0efe6'],
    ['#e8e4d8', '#23282e'], ['#2b2f36', '#e6c568'], ['#8a4a12', '#f6efe0'],
    ['#4a2a5c', '#efe6f4'], ['#0f5566', '#e8f4f2'],
  ];
  for (let cy = 0; cy < N; cy++) {
    for (let cx = 0; cx < N; cx++) {
      const ox = cx * C, oy = cy * C;
      const [bg, fg] = PLATES[(cy * N + cx) % PLATES.length];
      a.g.fillStyle = bg;
      a.g.fillRect(ox, oy, C, C);
      // A frame, so the plate has an edge instead of bleeding into the wall.
      a.g.strokeStyle = 'rgba(0,0,0,0.45)';
      a.g.lineWidth = 3;
      a.g.strokeRect(ox + 1.5, oy + 1.5, C - 3, C - 3);

      // Wordmark: one or two words of block "letters" on the middle band.
      const lit = r() > 0.78;          // a fifth of them are illuminated
      const words = 1 + (r() > 0.55 ? 1 : 0);
      const bandY = oy + C * (words === 1 ? 0.40 : 0.30);
      let wy = bandY;
      for (let w = 0; w < words; w++) {
        const gh = C * (words === 1 ? 0.2 : 0.16);
        const nGlyph = 3 + Math.floor(r() * 5);
        const gw = C * 0.06 + r() * C * 0.02;
        const gap = gw * 0.36;
        const total = nGlyph * gw + (nGlyph - 1) * gap;
        let gx = ox + (C - total) / 2;
        for (let g = 0; g < nGlyph; g++) {
          const hh = gh * (0.72 + r() * 0.28);
          a.g.fillStyle = fg;
          a.g.fillRect(gx, wy + (gh - hh), gw, hh);
          if (lit) { emi.g.fillStyle = fg; emi.g.fillRect(gx, wy + (gh - hh), gw, hh); }
          gx += gw + gap;
        }
        wy += gh * 1.5;
      }
      if (lit) {
        // A lit plate glows a little all over, not only in the letters.
        emi.g.fillStyle = 'rgba(80,70,50,1)';
        emi.g.fillRect(ox + 4, oy + 4, C - 8, C - 8);
        rgh.g.fillStyle = grey(0.3);
        rgh.g.fillRect(ox, oy, C, C);
      }
      // Grime along the bottom lip, where every fascia collects it.
      const gg = a.g.createLinearGradient(ox, oy + C * 0.7, ox, oy + C);
      gg.addColorStop(0, 'rgba(0,0,0,0)');
      gg.addColorStop(1, 'rgba(0,0,0,0.32)');
      a.g.fillStyle = gg;
      a.g.fillRect(ox, oy + C * 0.7, C, C * 0.3);
    }
  }
  noise(a.g, S, S, 7, 5);
  return { albedo: a.c, height: null, rough: rgh.c, emissive: emi.c, nrm: 0 };
}

// ---------------------------------------------------------------------------
// Facade atlas
// ---------------------------------------------------------------------------

// Guard columns each side of a cell, filled with the cell's OWN opposite edge,
// so bilinear and the first three mip levels filter as if the tile wrapped
// rather than pulling in the neighbouring family. Eight is what covers mip 3;
// past that a whole cell is a handful of texels and the wall is a few pixels
// on screen.
const GUARD = 8;
const FS = 512;
const CELL_W = FS + GUARD * 2;

/**
 * Lay a list of 512-square cells out side by side, with wrap-padding.
 *
 * The strip is HORIZONTAL on purpose. GL repeat wraps the whole texture rather
 * than a sub-rect, so an atlas normally can't carry tiling surfaces at all --
 * but a strip one tile TALL still wraps correctly in V, so vertical repeats (a
 * 100 m tower is seven of them) cost nothing and only U has to be confined to a
 * cell. Builder.box pre-splits a face into one quad per horizontal repeat, so
 * every UV that reaches the sampler is already inside. That keeps this to plain
 * textures and plain UVs -- no onBeforeCompile, no sampler2DArray, nothing this
 * renderer has to take on trust on a phone, which is the same reason postfx.js
 * is 8-bit throughout.
 */
function stripAtlas(cells) {
  const { c, g } = canvas(CELL_W * cells.length, FS);
  cells.forEach((src, i) => {
    const ox = i * CELL_W;
    g.drawImage(src, ox + GUARD, 0);
    g.drawImage(src, FS - GUARD, 0, GUARD, FS, ox, 0, GUARD, FS);
    g.drawImage(src, 0, 0, GUARD, FS, ox + CELL_W - GUARD, 0, GUARD, FS);
  });
  return c;
}

function solidCell(css) {
  const { c, g } = canvas(FS, FS);
  g.fillStyle = css;
  g.fillRect(0, 0, FS, FS);
  return c;
}

const px = (src) => src.getContext('2d').getImageData(0, 0, FS, FS).data;

/**
 * Pre-scale a normal map's xy exactly the way `normalScale` would, so one
 * material can carry five families' relief strengths. The shader does
 * `mapN.xy *= normalScale` on the decoded [-1,1] vector and only then
 * normalises, so scaling by ns/nsMax here and setting normalScale to nsMax
 * reproduces each family's old value to the byte -- and every ratio is <= 1,
 * so nothing clips.
 */
function scaledNormal(heightCanvas, strength, k) {
  if (!heightCanvas) return solidCell('rgb(128,128,255)');
  const src = px(normalCanvas(heightCanvas, strength));
  const { c, g } = canvas(FS, FS);
  const img = g.createImageData(FS, FS);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    d[i] = Math.round(127.5 + (src[i] - 127.5) * k);
    d[i + 1] = Math.round(127.5 + (src[i + 1] - 127.5) * k);
    d[i + 2] = src[i + 2];
    d[i + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  return c;
}

/**
 * R = ambient occlusion, G = roughness, B = metalness -- one map read through
 * three slots.
 *
 * `roughness` and `metalness` are plain multipliers on their channels, so those
 * two bake exactly. `envMapIntensity` has no per-texel channel of its own, but
 * three's AO term multiplies the indirect (image-based) light, which is the
 * only thing env was ever dialling; putting each family's env ratio in R gets
 * the diffuse IBL back exactly and the indirect specular to within the
 * occlusion curve.
 */
function packedCell(roughCanvas, env, rough, metal) {
  const src = roughCanvas ? px(roughCanvas) : null;
  const { c, g } = canvas(FS, FS);
  const img = g.createImageData(FS, FS);
  const d = img.data;
  const r = Math.round(env * 255), b = Math.round(metal * 255);
  for (let i = 0; i < d.length; i += 4) {
    d[i] = r;
    d[i + 1] = Math.round((src ? src[i] : 255) * rough);
    d[i + 2] = b;
    d[i + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  return c;
}

const toLinear = (v) => (v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4));
const toSRGB = (v) => (v <= 0.0031308 ? v * 12.92 : 1.055 * Math.pow(v, 1 / 2.4) - 0.055);

/**
 * Scale an emissive cell in LINEAR space, so one `emissiveIntensity` covers
 * both a lit shop sign and a lit office window a hundred times fainter.
 *
 * The hundredfold gap is what makes this look impossible, and sRGB is what
 * makes it fine: the map is sRGB-encoded, so a window at 1/100 of a sign still
 * lands on texel 31 rather than on texel 2.
 */
function scaledEmissive(src, k) {
  if (!src || k === 0) return solidCell('#000');
  const s = px(src);
  const { c, g } = canvas(FS, FS);
  const img = g.createImageData(FS, FS);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    for (let ch = 0; ch < 3; ch++) {
      d[i + ch] = Math.round(toSRGB(toLinear(s[i + ch] / 255) * k) * 255);
    }
    d[i + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  return c;
}

/**
 * One material for every wall in the city.
 *
 * Six facade materials cost 139 draw calls a frame downtown to carry 34k
 * triangles -- 247 triangles a draw, on a target where draw calls are the
 * binding constraint and triangles are not. They are one material now, and the
 * per-family differences that used to force them apart are all baked into the
 * maps: relief into the normal's xy, roughness and metalness into their own
 * channels, env into AO, emissive brightness into the emissive canvas itself.
 * The coursing, the corrugation and the lap siding stay entirely distinct,
 * which is the part no tint could ever have produced.
 */
function facadeAtlas(fams) {
  const nsMax = Math.max(...fams.map((f) => f.ns));
  const envMax = Math.max(...fams.map((f) => f.env));
  const metalMax = Math.max(...fams.map((f) => f.metal));
  const emiMax = Math.max(...fams.map((f) => f.emissive));
  const W = CELL_W * fams.length;
  const cells = {};
  fams.forEach((f, i) => {
    cells[f.name] = [(i * CELL_W + GUARD) / W, FS / W];
  });
  return {
    map: tex(stripAtlas(fams.map((f) => f.s.albedo)), { clampS: true }),
    normalMap: tex(stripAtlas(fams.map((f) => scaledNormal(f.s.height, f.s.nrm, f.ns / nsMax))),
      { srgb: false, clampS: true }),
    packed: tex(stripAtlas(fams.map((f) => packedCell(f.s.rough, f.env / envMax, f.rough, f.metal / metalMax))),
      { srgb: false, clampS: true }),
    emissiveMap: tex(stripAtlas(fams.map((f) => scaledEmissive(f.s.emissive, f.emissive / emiMax))),
      { clampS: true }),
    cells, envMax, nsMax, metalMax, emiMax,
  };
}

export function buildTextures() {
  return {
    glass: glassSurface(),
    // Every family's old material parameters travel with it here; `facadeAtlas`
    // is what folds them into the one material's maps.
    facade: facadeAtlas([
      { name: 'masonry', s: masonrySurface(), env: 0.66, ns: 1.5, rough: 1, metal: 0, emissive: 0.015 },
      // Brick is its own cell, not a tint of the stone one. 11 px courses over
      // a 12 m tile is a ~26 cm brick -- coarser than life, because at 512 px a
      // true 7 cm course is sub-texel and mips straight to flat grey. What
      // separates brick from stone at street distance is the COURSING, and no
      // tint and no shared cell can produce that.
      {
        name: 'brick',
        s: masonrySurface({
          base: '#a89a90', mortar: '#c9c2b4', course: 11, seedN: 47,
          surround: '#cfc9bc', sill: '#d6d1c6',
        }),
        env: 0.60, ns: 1.5, rough: 1, metal: 0, emissive: 0.015,
      },
      { name: 'industrial', s: industrialSurface(), env: 0.5, ns: 1.7, rough: 1, metal: 0.25, emissive: 0 },
      { name: 'house', s: houseSurface(), env: 0.45, ns: 1.8, rough: 1, metal: 0, emissive: 0.015 },
      { name: 'signs', s: signSurface(), env: 0.5, ns: 0, rough: 0.62, metal: 0, emissive: 1.5 },
    ]),
    road: roadSurface(),
    sidewalk: sidewalkSurface(),
    ground: groundSurface(),
    water: waterSurface(),
    sky: skyEquirect(),
    particle: particleTexture(),
  };
}
