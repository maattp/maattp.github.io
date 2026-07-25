// Every texture in the game is drawn procedurally into a canvas at boot, so the
// app ships as code only and works offline with no image assets.

import * as THREE from './three.js';
import { mulberry32 } from './util.js';

function canvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return { c, g: c.getContext('2d') };
}

function tex(c, repeat = true, aniso = 8) {
  const t = new THREE.CanvasTexture(c);
  if (repeat) {
    t.wrapS = THREE.RepeatWrapping;
    t.wrapT = THREE.RepeatWrapping;
  }
  t.anisotropy = aniso;
  t.colorSpace = THREE.SRGBColorSpace;
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

// --- glass curtain wall -----------------------------------------------------
function glassTexture() {
  const S = 256, { c, g } = canvas(S, S);
  const r = mulberry32(7);
  g.fillStyle = '#a7b4bb';
  g.fillRect(0, 0, S, S);
  const cols = 8, rows = 8;
  const cw = S / cols, ch = S / rows;
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const px = x * cw, py = y * ch;
      // spandrel band under each window
      g.fillStyle = '#9aa6ad';
      g.fillRect(px, py, cw, ch);
      const v = r();
      const b = 0.62 + v * 0.44;
      const rr = Math.round(118 * b), gg = Math.round(148 * b), bb = Math.round(162 * b);
      g.fillStyle = `rgb(${rr},${gg},${bb})`;
      g.fillRect(px + 1.5, py + 2, cw - 3, ch - 6);
      // sky reflection gradient inside the pane
      const grad = g.createLinearGradient(px, py + 2, px, py + ch - 4);
      grad.addColorStop(0, 'rgba(220,238,248,0.45)');
      grad.addColorStop(0.45, 'rgba(150,180,200,0.10)');
      grad.addColorStop(1, 'rgba(30,45,55,0.30)');
      g.fillStyle = grad;
      g.fillRect(px + 1.5, py + 2, cw - 3, ch - 6);
      if (v > 0.93) {
        g.fillStyle = 'rgba(255,236,180,0.55)';
        g.fillRect(px + 1.5, py + 2, cw - 3, ch - 6);
      }
      // mullions
      g.fillStyle = '#6d7981';
      g.fillRect(px, py + ch - 4, cw, 4);
      g.fillRect(px, py, 1.5, ch);
    }
  }
  noise(g, S, S, 12, 3);
  return tex(c);
}

// --- masonry / concrete with punched windows --------------------------------
function masonryTexture() {
  const S = 256, { c, g } = canvas(S, S);
  const r = mulberry32(21);
  g.fillStyle = '#b0a191';
  g.fillRect(0, 0, S, S);
  // subtle horizontal course lines
  g.strokeStyle = 'rgba(0,0,0,0.06)';
  for (let y = 0; y < S; y += 8) {
    g.beginPath();
    g.moveTo(0, y + 0.5);
    g.lineTo(S, y + 0.5);
    g.stroke();
  }
  const cols = 5, rows = 5;
  const cw = S / cols, ch = S / rows;
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const px = x * cw + cw * 0.22, py = y * ch + ch * 0.2;
      const w = cw * 0.56, h = ch * 0.5;
      g.fillStyle = '#6b6257';
      g.fillRect(px - 2, py - 2, w + 4, h + 5);
      const v = r();
      g.fillStyle = v > 0.9 ? '#f0d79a' : `rgb(${40 + v * 26 | 0},${52 + v * 30 | 0},${62 + v * 34 | 0})`;
      g.fillRect(px, py, w, h);
      const grad = g.createLinearGradient(px, py, px, py + h);
      grad.addColorStop(0, 'rgba(210,228,240,0.35)');
      grad.addColorStop(1, 'rgba(0,0,0,0.25)');
      g.fillStyle = grad;
      g.fillRect(px, py, w, h);
      g.fillStyle = '#cbbfae';
      g.fillRect(px - 3, py + h + 2, w + 6, 3);
    }
  }
  noise(g, S, S, 20, 9);
  return tex(c);
}

// --- industrial / warehouse -------------------------------------------------
function industrialTexture() {
  const S = 256, { c, g } = canvas(S, S);
  g.fillStyle = '#9aa0a3';
  g.fillRect(0, 0, S, S);
  for (let x = 0; x < S; x += 16) {
    g.fillStyle = 'rgba(255,255,255,0.10)';
    g.fillRect(x, 0, 6, S);
    g.fillStyle = 'rgba(0,0,0,0.13)';
    g.fillRect(x + 10, 0, 5, S);
  }
  g.fillStyle = 'rgba(0,0,0,0.18)';
  g.fillRect(0, 40, S, 4);
  g.fillRect(0, 208, S, 4);
  const r = mulberry32(31);
  for (let i = 0; i < 6; i++) {
    const x = 12 + i * 40;
    g.fillStyle = '#3d4750';
    g.fillRect(x, 16, 26, 18);
    g.fillStyle = 'rgba(190,215,230,0.55)';
    g.fillRect(x + 2, 18, 22, 14);
    if (r() > 0.7) {
      g.fillStyle = 'rgba(0,0,0,0.35)';
      g.fillRect(x + 2, 18, 22, 14);
    }
  }
  noise(g, S, S, 22, 5);
  return tex(c);
}

// --- house siding (one tile == one wall) ------------------------------------
function houseTexture() {
  const S = 256, { c, g } = canvas(S, S);
  g.fillStyle = '#d8d4cb';
  g.fillRect(0, 0, S, S);
  for (let y = 0; y < S; y += 11) {
    g.fillStyle = 'rgba(0,0,0,0.07)';
    g.fillRect(0, y + 8, S, 3);
  }
  const win = (x, y, w, h) => {
    g.fillStyle = '#f4f2ec';
    g.fillRect(x - 4, y - 4, w + 8, h + 8);
    g.fillStyle = '#2c3742';
    g.fillRect(x, y, w, h);
    const grad = g.createLinearGradient(x, y, x, y + h);
    grad.addColorStop(0, 'rgba(200,222,238,0.6)');
    grad.addColorStop(1, 'rgba(20,30,40,0.5)');
    g.fillStyle = grad;
    g.fillRect(x, y, w, h);
    g.fillStyle = '#f4f2ec';
    g.fillRect(x + w / 2 - 2, y, 4, h);
    g.fillRect(x, y + h / 2 - 2, w, 4);
  };
  win(40, 46, 56, 62);
  win(160, 46, 56, 62);
  win(40, 160, 56, 62);
  // front door
  g.fillStyle = '#6d4a34';
  g.fillRect(158, 150, 56, 92);
  g.fillStyle = 'rgba(255,255,255,0.25)';
  g.fillRect(164, 158, 44, 34);
  g.fillStyle = '#d9c47a';
  g.fillRect(204, 196, 6, 6);
  noise(g, S, S, 14, 11);
  return tex(c);
}

// --- road surface -----------------------------------------------------------
function roadTexture() {
  const S = 256, { c, g } = canvas(S, S);
  g.fillStyle = '#46484c';
  g.fillRect(0, 0, S, S);
  noise(g, S, S, 14, 17);
  // patchy asphalt -- greyscale only, or the random channels tint the road purple
  const r = mulberry32(41);
  for (let i = 0; i < 34; i++) {
    const l = r() > 0.5 ? 255 : 0;
    g.fillStyle = `rgba(${l},${l},${l},0.028)`;
    g.fillRect(r() * S, r() * S, 20 + r() * 60, 8 + r() * 30);
  }
  // U runs across the road width, V along its length
  g.fillStyle = '#e8e6dd';
  g.fillRect(6, 0, 4, S);
  g.fillRect(S - 10, 0, 4, S);
  g.fillStyle = '#e5c33d';
  for (let y = 0; y < S; y += 40) g.fillRect(S / 2 - 3, y, 6, 24);
  return tex(c);
}

function sidewalkTexture() {
  const S = 128, { c, g } = canvas(S, S);
  g.fillStyle = '#a8a49c';
  g.fillRect(0, 0, S, S);
  noise(g, S, S, 16, 23);
  g.strokeStyle = 'rgba(0,0,0,0.16)';
  g.lineWidth = 2;
  for (let i = 0; i <= S; i += 32) {
    g.beginPath(); g.moveTo(i, 0); g.lineTo(i, S); g.stroke();
    g.beginPath(); g.moveTo(0, i); g.lineTo(S, i); g.stroke();
  }
  return tex(c);
}

// Deliberately neutral: the terrain's per-vertex colour decides whether a patch
// reads as grass, pavement or beach, so this only supplies grain.
function groundTexture() {
  const S = 128, { c, g } = canvas(S, S);
  g.fillStyle = '#b0b0ac';
  g.fillRect(0, 0, S, S);
  const r = mulberry32(53);
  for (let i = 0; i < 1100; i++) {
    const v = 0.55 + r() * 0.6;
    const l = Math.round(150 * v);
    g.fillStyle = `rgba(${l},${l},${Math.round(l * 0.97)},0.45)`;
    g.fillRect(r() * S, r() * S, 2 + r() * 5, 2 + r() * 5);
  }
  noise(g, S, S, 22, 61);
  return tex(c);
}

function waterTexture() {
  const S = 256, { c, g } = canvas(S, S);
  g.fillStyle = '#33566b';
  g.fillRect(0, 0, S, S);
  const r = mulberry32(67);
  for (let i = 0; i < 500; i++) {
    const x = r() * S, y = r() * S, w = 8 + r() * 40;
    g.strokeStyle = `rgba(200,225,240,${0.03 + r() * 0.07})`;
    g.lineWidth = 1 + r() * 2;
    g.beginPath();
    g.moveTo(x, y);
    g.quadraticCurveTo(x + w / 2, y + (r() - 0.5) * 6, x + w, y);
    g.stroke();
  }
  return tex(c);
}

function skyTexture() {
  const W = 512, H = 256, { c, g } = canvas(W, H);
  const grad = g.createLinearGradient(0, 0, 0, H);
  grad.addColorStop(0.0, '#4d6f92');
  grad.addColorStop(0.42, '#8fa8bd');
  grad.addColorStop(0.62, '#c3cdd4');
  grad.addColorStop(0.78, '#d9dde0');
  grad.addColorStop(1.0, '#b9c3c9');
  g.fillStyle = grad;
  g.fillRect(0, 0, W, H);
  // soft overcast banks
  const r = mulberry32(83);
  for (let i = 0; i < 90; i++) {
    const x = r() * W, y = 20 + r() * 120, w = 60 + r() * 180, h = 12 + r() * 34;
    g.fillStyle = `rgba(255,255,255,${0.03 + r() * 0.07})`;
    g.beginPath();
    g.ellipse(x, y, w, h, 0, 0, Math.PI * 2);
    g.fill();
  }
  const t = tex(c, false, 2);
  t.wrapS = THREE.RepeatWrapping;
  t.wrapT = THREE.ClampToEdgeWrapping;
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
  return tex(c, false, 1);
}

export function buildTextures() {
  return {
    glass: glassTexture(),
    masonry: masonryTexture(),
    industrial: industrialTexture(),
    house: houseTexture(),
    road: roadTexture(),
    sidewalk: sidewalkTexture(),
    ground: groundTexture(),
    water: waterTexture(),
    sky: skyTexture(),
    particle: particleTexture(),
  };
}
