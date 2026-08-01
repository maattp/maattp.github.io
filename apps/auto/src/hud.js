// Minimap, full map and the on-screen readouts.

import * as G from './geo.js';
import { formatMoney, clamp } from './util.js';

const MAP_PX = 2048;
const SCALE = MAP_PX / (G.MAP_HALF * 2);

/** Renders the whole city once into an offscreen canvas; both maps sample it. */
export function buildMapCanvas(city) {
  const c = document.createElement('canvas');
  c.width = MAP_PX;
  c.height = MAP_PX;
  const g = c.getContext('2d');
  const X = (x) => (x + G.MAP_HALF) * SCALE;
  const Z = (z) => (z + G.MAP_HALF) * SCALE;

  // Ground, water and parks come straight off the imported masks. Drawing the
  // raster and letting the canvas scale it up beats stroking polygons: the
  // shoreline on the map is then the same shoreline the game drives on, pixel
  // for pixel, instead of a second hand-drawn copy of it that can disagree.
  const { water, green, n } = G.masks();
  const src = document.createElement('canvas');
  src.width = src.height = n;
  const sg = src.getContext('2d');
  const img = sg.createImageData(n, n);
  const px = img.data;
  const WATER_C = [29, 59, 82], PARK_C = [57, 96, 58];
  const GRASS_C = [43, 59, 48], BUILT_C = [74, 79, 70];
  for (let j = 0, i = 0, p = 0; j < n; j++) {
    for (let k = 0; k < n; k++, i++, p += 4) {
      let c;
      if (water[i]) c = WATER_C;
      else if (green[i]) c = PARK_C;
      else {
        const t = clamp(city.builtAt(-G.MAP_HALF + k * 10, -G.MAP_HALF + j * 10) / 0.2, 0, 1);
        c = [
          GRASS_C[0] + (BUILT_C[0] - GRASS_C[0]) * t,
          GRASS_C[1] + (BUILT_C[1] - GRASS_C[1]) * t,
          GRASS_C[2] + (BUILT_C[2] - GRASS_C[2]) * t,
        ];
      }
      px[p] = c[0]; px[p + 1] = c[1]; px[p + 2] = c[2]; px[p + 3] = 255;
    }
  }
  sg.putImageData(img, 0, 0);
  g.imageSmoothingEnabled = true;
  g.drawImage(src, 0, 0, MAP_PX, MAP_PX);

  // roads, thin classes first
  const order = ['res', 'st', 'ramp', 'art', 'hwy'];
  const styles = {
    res: { w: 1.2, c: '#6d7069' },
    st: { w: 1.7, c: '#8b8e86' },
    ramp: { w: 2.0, c: '#b7a05a' },
    art: { w: 2.8, c: '#c3c6bd' },
    hwy: { w: 4.4, c: '#e0c86a' },
  };
  g.lineCap = 'round';
  for (const cls of order) {
    const s = styles[cls];
    g.strokeStyle = s.c;
    g.lineWidth = s.w;
    g.beginPath();
    for (const e of city.edges) {
      if (e.cls !== cls) continue;
      const a = city.nodes[e.a], b = city.nodes[e.b];
      g.moveTo(X(a.x), Z(a.z));
      g.lineTo(X(b.x), Z(b.z));
    }
    g.stroke();
  }
  return c;
}

export class Hud {
  constructor(root, city, mapCanvas) {
    this.root = root;
    this.city = city;
    this.mapCanvas = mapCanvas;
    this.mini = root.querySelector('#minimap');
    this.mctx = this.mini.getContext('2d');
    this.stars = root.querySelector('#stars');
    this.money = root.querySelector('#money');
    this.healthFill = root.querySelector('#healthFill');
    this.armourRow = root.querySelector('#speedo');
    this.speedVal = root.querySelector('#speedVal');
    this.place = root.querySelector('#place');
    this.toast = root.querySelector('#toast');
    this.objective = root.querySelector('#objective');
    this.ammoEl = root.querySelector('#ammo');
    this.bigMap = root.querySelector('#bigMap');
    this.bigCtx = this.bigMap.getContext('2d');
    this.lastPlace = '';
    this.toastTimer = 0;
    this.resize();
  }

  resize() {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const r = this.mini.getBoundingClientRect();
    this.mini.width = Math.round(r.width * dpr);
    this.mini.height = Math.round(r.height * dpr);
    this.miniSize = this.mini.width;
  }

  showToast(text, ms = 2600) {
    this.toast.textContent = text;
    this.toast.classList.add('show');
    this.toastTimer = ms / 1000;
  }

  /** Race readout, plus the off-screen arrow to the next checkpoint. */
  setRace(r, player) {
    if (!this._rp) {
      this._rp = document.getElementById('racePanel');
      this._rn = document.getElementById('raceName');
      this._rt = document.getElementById('raceTime');
      this._rl = document.getElementById('raceLeft');
      this._rd = document.getElementById('raceDelta');
      this._rb = document.getElementById('raceBest');
    }
    if (!this._rp) return;
    this._rp.classList.toggle('on', !!r);
    if (!r) return;
    this._rn.textContent = r.name;
    this._rt.textContent = r.time;
    this._rl.textContent = r.left || '';
    this._rd.textContent = r.delta || '';
    this._rd.className = r.delta ? (r.ahead ? 'ahead' : 'behind') : '';
    this._rb.textContent = r.best ? `best ${r.best}` : '';
  }

  setObjective(text) {
    this.objective.textContent = text || '';
    this.objective.classList.toggle('show', !!text);
  }

  update(dt, game, player, traffic) {
    const p = player.position;
    this.setRace(this.race, player);
    // minimap
    const ctx = this.mctx;
    const S = this.miniSize;
    const zoom = player.onFoot ? 1.9 : 1.35;
    ctx.save();
    ctx.clearRect(0, 0, S, S);
    ctx.beginPath();
    ctx.arc(S / 2, S / 2, S / 2, 0, Math.PI * 2);
    ctx.clip();
    ctx.translate(S / 2, S / 2);
    // The map image is drawn world-aligned (+X right, +Z down). Rotating by
    // camYaw puts the camera's forward heading (camYaw + PI) at the top and,
    // because a larger heading is a left turn, also puts the player's
    // screen-right on the right of the dial.
    ctx.rotate(player.camYaw);
    ctx.scale(zoom, zoom);
    const sx = (p.x + G.MAP_HALF) * SCALE;
    const sz = (p.z + G.MAP_HALF) * SCALE;
    const half = S / (2 * zoom);
    ctx.drawImage(this.mapCanvas, sx - half, sz - half, half * 2, half * 2, -half, -half, half * 2, half * 2);

    const toMap = (x, z) => [((x - p.x) * SCALE), ((z - p.z) * SCALE)];
    // blips
    for (const v of traffic.cars) {
      if (v.mode !== 'police') continue;
      const [bx, bz] = toMap(v.x, v.z);
      ctx.fillStyle = '#ff4d4d';
      ctx.beginPath();
      ctx.arc(bx, bz, 3.4 / zoom, 0, Math.PI * 2);
      ctx.fill();
    }
    if (game.target) {
      const [bx, bz] = toMap(game.target.x, game.target.z);
      ctx.fillStyle = '#ffd24a';
      ctx.beginPath();
      ctx.arc(bx, bz, 4.5 / zoom, 0, Math.PI * 2);
      ctx.fill();
    }
    // Activity and collectible icons live on the MINIMAP, not as world meshes:
    // sixty markers would be sixty draws against a ~300 budget, and a canvas
    // dot is free. This is also the discoverability path -- you find things by
    // seeing them on the map, with no tutorial.
    for (const a of (this.activities || [])) {
      const [bx, bz] = toMap(a.x, a.z);
      if (Math.abs(bx) > S || Math.abs(bz) > S) continue;
      ctx.fillStyle = a.best ? (a.best.medal === 'gold' ? '#f4c542'
        : a.best.medal === 'silver' ? '#c8d0d8' : '#c0763c') : '#4fd0ff';
      ctx.beginPath();
      ctx.arc(bx, bz, 3.8 / zoom, 0, Math.PI * 2);
      ctx.fill();
    }
    for (const c of (this.finds || [])) {
      const [bx, bz] = toMap(c.x, c.z);
      if (Math.abs(bx) > S || Math.abs(bz) > S) continue;
      ctx.fillStyle = '#f4c542';
      ctx.fillRect(bx - 1.6 / zoom, bz - 1.6 / zoom, 3.2 / zoom, 3.2 / zoom);
    }
    ctx.restore();

    // player arrow, always upright at centre
    ctx.save();
    ctx.translate(S / 2, S / 2);
    const heading = player.onFoot ? player.heading : player.vehicle ? player.vehicle.heading : 0;
    const rel = player.camYaw + Math.PI - heading;
    ctx.rotate(rel);
    ctx.fillStyle = '#ffffff';
    ctx.strokeStyle = '#101418';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(0, -9);
    ctx.lineTo(6, 7);
    ctx.lineTo(0, 3.5);
    ctx.lineTo(-6, 7);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.restore();

    // North marker on the rim. The map is drawn world-aligned and then turned
    // by camYaw, and north is -Z (heading 0 faces +Z, which is south), so the
    // direction that was straight up before the rotation ends up here. Drawn
    // outside that transform so the letter stays upright at any bearing.
    ctx.save();
    ctx.translate(S / 2, S / 2);
    const nx = Math.sin(player.camYaw), nz = -Math.cos(player.camYaw);
    const rr = S / 2 - 10;
    ctx.beginPath();
    ctx.moveTo(nx * (rr + 7), nz * (rr + 7));
    ctx.lineTo(nx * rr - nz * 4.5, nz * rr + nx * 4.5);
    ctx.lineTo(nx * rr + nz * 4.5, nz * rr - nx * 4.5);
    ctx.closePath();
    ctx.fillStyle = '#ff5a4d';
    ctx.strokeStyle = 'rgba(16,20,24,0.9)';
    ctx.lineWidth = 1.2;
    ctx.fill();
    ctx.stroke();
    ctx.font = 'bold 11px system-ui, -apple-system, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineWidth = 2.6;
    ctx.strokeText('N', nx * (rr - 9), nz * (rr - 9));
    ctx.fillStyle = '#ffffff';
    ctx.fillText('N', nx * (rr - 9), nz * (rr - 9));
    ctx.restore();

    // readouts
    this.money.textContent = formatMoney(game.money);
    this.healthFill.style.width = `${clamp(player.health, 0, 100)}%`;
    this.healthFill.style.background = player.health > 45 ? '#4fd07a' : player.health > 20 ? '#f0b429' : '#e5484d';
    const kph = player.onFoot ? player.speed * 3.6 : Math.abs(player.vehicle ? player.vehicle.vLong : 0) * 3.6;
    this.speedVal.textContent = Math.round(kph);
    this.armourRow.classList.toggle('hidden', player.onFoot);
    this.ammoEl.classList.toggle('hidden', !(player.onFoot && player.armed));
    if (player.armed) this.ammoEl.textContent = `⌖ ${player.ammo}`;

    const stars = game.wanted;
    if (this.stars.dataset.n !== String(stars)) {
      this.stars.dataset.n = String(stars);
      this.stars.innerHTML = '';
      for (let i = 0; i < 5; i++) {
        const s = document.createElement('span');
        s.textContent = '★';
        s.className = i < stars ? 'star on' : 'star';
        this.stars.appendChild(s);
      }
    }

    const name = G.placeNameAt(p.x, p.z);
    if (name !== this.lastPlace) {
      this.lastPlace = name;
      this.place.textContent = name;
      this.place.classList.remove('flash');
      void this.place.offsetWidth;
      this.place.classList.add('flash');
    }

    if (this.toastTimer > 0) {
      this.toastTimer -= dt;
      if (this.toastTimer <= 0) this.toast.classList.remove('show');
    }
  }

  drawBigMap(player, game) {
    const c = this.bigMap;
    const r = c.getBoundingClientRect();
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    c.width = Math.round(r.width * dpr);
    c.height = Math.round(r.height * dpr);
    const ctx = this.bigCtx;
    const size = Math.min(c.width, c.height);
    ctx.clearRect(0, 0, c.width, c.height);
    const ox = (c.width - size) / 2, oy = (c.height - size) / 2;
    ctx.drawImage(this.mapCanvas, 0, 0, MAP_PX, MAP_PX, ox, oy, size, size);
    const p = player.position;
    const toC = (x, z) => [ox + ((x + G.MAP_HALF) / (G.MAP_HALF * 2)) * size, oy + ((z + G.MAP_HALF) / (G.MAP_HALF * 2)) * size];
    // Remember the projection so a tap can be turned back into world metres.
    // The map is letterboxed inside the canvas and the canvas is scaled by dpr,
    // so neither offset can be inferred from the element's size alone.
    this._mapView = { ox, oy, size, dpr, w: c.width, h: c.height };

    ctx.font = `${Math.round(size * 0.013)}px -apple-system, Helvetica, sans-serif`;
    ctx.fillStyle = 'rgba(255,255,255,0.72)';
    ctx.textAlign = 'center';
    for (const l of G.LANDMARKS) {
      const [lx, lz] = toC(l.p ? l.p[0] : l.x, l.p ? l.p[1] : l.z);
      ctx.fillStyle = 'rgba(255,255,255,0.85)';
      ctx.beginPath();
      ctx.arc(lx, lz, size * 0.004, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.55)';
      ctx.fillText(l.name, lx, lz - size * 0.008);
    }
    if (game.target) {
      const [tx, tz] = toC(game.target.x, game.target.z);
      ctx.fillStyle = '#ffd24a';
      ctx.beginPath();
      ctx.arc(tx, tz, size * 0.008, 0, Math.PI * 2);
      ctx.fill();
    }
    const [px, pz] = toC(p.x, p.z);
    ctx.save();
    ctx.translate(px, pz);
    // North-up map: heading 0 faces +Z, which is south, i.e. down the page.
    ctx.rotate(Math.PI - (player.onFoot ? player.heading : player.vehicle ? player.vehicle.heading : 0));
    ctx.fillStyle = '#ffffff';
    ctx.strokeStyle = '#000';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(0, -size * 0.012);
    ctx.lineTo(size * 0.008, size * 0.009);
    ctx.lineTo(0, size * 0.004);
    ctx.lineTo(-size * 0.008, size * 0.009);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.restore();

    // Warp crosshair: where the tap landed, and the road it snapped to.
    if (this.warp) {
      const [wx, wz] = toC(this.warp.x, this.warp.z);
      const r = size * 0.016;
      ctx.strokeStyle = this.warp.ok ? '#7ee0a4' : '#e5645d';
      ctx.lineWidth = Math.max(1.5, size * 0.0022);
      ctx.beginPath();
      ctx.arc(wx, wz, r, 0, Math.PI * 2);
      ctx.moveTo(wx - r * 1.7, wz); ctx.lineTo(wx - r * 0.5, wz);
      ctx.moveTo(wx + r * 0.5, wz); ctx.lineTo(wx + r * 1.7, wz);
      ctx.moveTo(wx, wz - r * 1.7); ctx.lineTo(wx, wz - r * 0.5);
      ctx.moveTo(wx, wz + r * 0.5); ctx.lineTo(wx, wz + r * 1.7);
      ctx.stroke();
      if (this.warp.ok && this.warp.snap) {
        // Draw the leg from the tap to the road it actually snapped to, so a
        // long snap is visible rather than a surprise on arrival.
        const [sx, sz] = toC(this.warp.snap.x, this.warp.snap.z);
        ctx.setLineDash([size * 0.008, size * 0.006]);
        ctx.beginPath();
        ctx.moveTo(wx, wz);
        ctx.lineTo(sx, sz);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle = '#7ee0a4';
        ctx.beginPath();
        ctx.arc(sx, sz, size * 0.006, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }

  /**
   * Canvas/client point -> world metres, or null outside the map square.
   * Inverse of drawBigMap's toC(); it needs the view drawBigMap recorded.
   */
  mapToWorld(clientX, clientY) {
    const v = this._mapView;
    if (!v) return null;
    const r = this.bigMap.getBoundingClientRect();
    const cx = (clientX - r.left) * (v.w / r.width);
    const cy = (clientY - r.top) * (v.h / r.height);
    const u = (cx - v.ox) / v.size;
    const w = (cy - v.oy) / v.size;
    if (u < 0 || u > 1 || w < 0 || w > 1) return null;
    return { x: u * G.MAP_HALF * 2 - G.MAP_HALF, z: w * G.MAP_HALF * 2 - G.MAP_HALF };
  }
}
