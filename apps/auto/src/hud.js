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

  g.fillStyle = '#2b3b30';
  g.fillRect(0, 0, MAP_PX, MAP_PX);

  // land: district blocks
  g.fillStyle = '#4a4f46';
  for (const d of G.DISTRICTS) {
    g.beginPath();
    d.poly.forEach((p, i) => (i ? g.lineTo(X(p[0]), Z(p[1])) : g.moveTo(X(p[0]), Z(p[1]))));
    g.closePath();
    g.fill();
  }
  // parks
  g.fillStyle = '#39603a';
  for (const p of G.PARKS) {
    const px = p.p ? p.p[0] : p.x, pz = p.p ? p.p[1] : p.z;
    g.save();
    g.translate(X(px), Z(pz));
    g.rotate(p.rot);
    g.fillRect(-p.w / 2 * SCALE, -p.d / 2 * SCALE, p.w * SCALE, p.d * SCALE);
    g.restore();
  }
  // water
  g.fillStyle = '#1d3b52';
  for (const w of G.WATER) {
    g.beginPath();
    w.poly.forEach((p, i) => (i ? g.lineTo(X(p[0]), Z(p[1])) : g.moveTo(X(p[0]), Z(p[1]))));
    g.closePath();
    g.fill();
  }
  g.fillStyle = '#4a4f46';
  for (const isl of G.ISLANDS) {
    g.beginPath();
    isl.poly.forEach((p, i) => (i ? g.lineTo(X(p[0]), Z(p[1])) : g.moveTo(X(p[0]), Z(p[1]))));
    g.closePath();
    g.fill();
  }

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

  setObjective(text) {
    this.objective.textContent = text || '';
    this.objective.classList.toggle('show', !!text);
  }

  update(dt, game, player, traffic) {
    const p = player.position;
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
  }
}
