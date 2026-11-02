// Auto KW: GTA-style CHEAT CODES, Waterloo flavoured. An Easter egg.
//
//   Desktop: type a code word anywhere while playing. A rolling buffer of the last 16 letters/digits typed
//     is matched against CODES by its ENDING, so only a whole code word fires. Nothing is swallowed or
//     prevented: W A S D (and the held keys H J K Q Z) still act while a half-typed code sits in the buffer.
//     The one exception is SWALLOW (in _key): a ONE-SHOT action letter (E F P T N G L R: get out, photo mode,
//     taxi, mission, siren, gear, radio) that continues a live code prefix of 2+ letters is not passed on, so
//     spelling a code never exits the car or opens photo mode. Every code STARTS with a letter outside that
//     set, so a first letter always acts as normal; the held keys fire harmlessly (a honk, a blip). Ignored while paused (menus, minigames,
//     every game.hold), with a modifier held, or with focus in a text field.
//   Phone: the pause menu's footer ("AUTO KW vN"): tap it 5 times within 4 s -> an "Enter code" box
//     (iOS keyboard); a good code resumes the game and fires. Same CODES, same effects.
//
//   Thirteen codes (below). A cheat toasts "CHEAT ACTIVATED: ..." with the pickup/cash chime, and is
//   remembered (localStorage autokw-cheats) for the pause menu's "Codes found n/13" row and list.
//   THE GTA RULE: the first cheat of a session sets sessionStorage `autokw-cheated`, and CHEAT.on turns
//   off the things that pay out or save progress: Golden eggs (kweggs.collect), stunt-jump discovery,
//   bonus money and unique-jump credit (stunts.js). Nothing is revoked from before. A new session (the
//   tab / PWA closed) is clean; a reload is not.
//
//   CLEANUP is the design. Timed effects go through timed(): ONE record each, a repeat extends it, and
//   its `end` restores exactly what `begin` took (weather, time of day, traffic's bounce, ION's clock,
//   the timbit rain). Spawned cars are ordinary traffic vehicles ('apron': parked, enterable, never
//   despawned) -- but capped at MAX_OWN, the oldest removed as new ones arrive, so a player who types
//   KWHEELS forty times has four cars, not forty. Nothing is held (no game.hold). IDLE COST: one keydown
//   listener (a string append and 13 endsWith on an alphanumeric key); tick() returns at once with
//   nothing active. Probe: tools/kw/cheatprobe.mjs.

import * as THREE from './three.js';
import * as G from './geo.js';

const KEY = 'autokw-cheats', SESSION = 'autokw-cheated';
const BUF = 16, MAX_OWN = 4;
const TAPS = 'EFPTNGLR';   // keys whose keydown is a one-shot action in main.js / controls.js

export const CHEAT = { on: false };
try { CHEAT.on = sessionStorage.getItem(SESSION) === '1'; } catch (e) { /* private mode */ }

const rnd = (a, b) => a + Math.random() * (b - a);
const pick = (a) => a[Math.floor(Math.random() * a.length)];

/** The codes: `code` is what you type. */
export const CODES = [
  { code: 'DOUBLEDOUBLE', name: 'Double-double: full health' },
  { code: 'UPTHERIM', name: 'Roll Up the Rim: a prize car' },
  { code: 'HONKHONK', name: 'A flock of Canada geese' },
  { code: 'BOXOFTIMBITS', name: 'It is raining Timbits' },
  { code: 'WINTERISCOMING', name: 'Winter is coming (snow)' },
  { code: 'AMBERHOUR', name: 'Golden hour (dusk)' },
  { code: 'BUMPYROAD', name: 'Pothole season (traffic bounces)' },
  { code: 'IONSPEED', name: 'ION at triple speed' },
  { code: 'UNWANTED', name: 'Wanted level cleared' },
  { code: 'WANTEDLEVEL5', name: 'Wanted level 5' },
  { code: 'KWHEELS', name: 'A very KW set of wheels' },
  { code: 'BUGGYTIME', name: 'Horse and buggy' },
  { code: 'WATERLOOPINK', name: 'Engineering pink' },
];

const WHEELS = ['delorean', 'zamboni', 'icecream', 'hearse', 'limo'];
const PINK = 0xf0589c;

// --- the timbit rain: one InstancedMesh, built when first asked for, off the scene when done ----------
class Timbits {
  constructor(scene, phone) {
    this.scene = scene; this.n = phone ? 90 : 160; this.mesh = null; this.live = false; this.rain = 0;
    this.p = null;
  }
  start(secs) {
    if (!this.mesh) {
      const geo = new THREE.IcosahedronGeometry(0.28, 1);
      const mat = new THREE.MeshStandardMaterial({ roughness: 0.85, metalness: 0 });
      const m = new THREE.InstancedMesh(geo, mat, this.n);
      m.frustumCulled = false; m.castShadow = false; m.receiveShadow = false; m.name = 'timbits';
      const cols = [0xd9a05b, 0x5a3418, 0xf2e8d2, 0xe8b04a], c = new THREE.Color();
      for (let i = 0; i < this.n; i++) m.setColorAt(i, c.setHex(cols[i % 4]));
      this.mesh = m; this.dummy = new THREE.Object3D();
      this.p = Array.from({ length: this.n }, () => ({ x: 0, y: -1e4, z: 0, vy: 0, g: 0, land: -1, a: 0, b: 0 }));
    }
    if (!this.mesh.parent) this.scene.add(this.mesh);
    this.mesh.visible = true;
    this.rain = secs; this.live = true;
    for (const q of this.p) { q.y = -1e4; q.land = -1; }   // land -1: waiting for a drop
  }
  drop(q, px, pz, py) {
    const a = Math.random() * 6.283, r = Math.sqrt(Math.random()) * 15;
    q.x = px + Math.cos(a) * r; q.z = pz + Math.sin(a) * r;
    q.y = py + rnd(8, 20); q.vy = -rnd(2, 5); q.land = 0; q.a = Math.random() * 6; q.b = Math.random() * 6;
    q.g = G.terrainHeight(q.x, q.z) + 0.2;
  }
  update(dt, px, pz, py) {
    if (!this.live) return;
    this.rain -= dt;
    let anyLive = false;
    const D = this.dummy, m = this.mesh;
    for (let i = 0; i < this.n; i++) {
      const q = this.p[i];
      if (q.land < 0) {
        // waiting: trickle in so they do not all fall at once
        if (this.rain > 0 && Math.random() < dt * this.n / 4) this.drop(q, px, pz, py);
        else { if (q.y > -9e3) { q.y = -1e4; D.position.set(0, -1e4, 0); D.scale.setScalar(1); D.updateMatrix(); m.setMatrixAt(i, D.matrix); } continue; }
      }
      if (q.land === 0) {
        q.vy -= 9 * dt; q.y += q.vy * dt;
        if (q.y <= q.g) { q.y = q.g; if (q.vy < -3) q.vy = -q.vy * 0.35; else { q.vy = 0; q.land = 1.2 + Math.random(); } }
        anyLive = true;
      } else {
        q.land -= dt;
        if (q.land <= 0) q.land = -1; else anyLive = true;
      }
      D.position.set(q.x, q.y, q.z); D.rotation.set(q.a + q.y * 0.5, q.b, 0); D.updateMatrix(); m.setMatrixAt(i, D.matrix);
    }
    m.instanceMatrix.needsUpdate = true;
    if (this.rain <= 0 && !anyLive) this.stop();
  }
  stop() {
    this.live = false;
    if (this.mesh) { this.scene.remove(this.mesh); this.mesh.visible = false; }
  }
}

export class Cheats {
  /** o: { scene, city, game, hud, audio, fx, traffic, player, phone, sys: () => ({ weather, tod, link, wildlife, rollup, police }) } */
  constructor(o) {
    this.o = o;
    this.buf = '';
    this.found = new Set();
    try { for (const c of JSON.parse(localStorage.getItem(KEY) || '[]')) if (CODES.some((k) => k.code === c)) this.found.add(c); } catch (e) { /* none */ }
    this.fx = [];                // the timed effects: { id, t, end }
    this.own = [];               // cars this made, oldest first
    this.timbits = new Timbits(o.scene, o.phone);
    this.last = '';              // the last activated code (the probe)
    this.log = [];
    this.bounced = [];           // cars POTHOLE has lifted (yVis)
    this.potT = 0;
    window.addEventListener('keydown', (e) => this._key(e), true);   // capture: before every other key handler (see SWALLOW)
    window.addEventListener('blur', () => { this.buf = ''; });
    this._footer();
  }

  get total() { return CODES.length; }
  get active() { return this.fx.map((f) => f.id); }

  // --- typing ---------------------------------------------------------------------------------
  _key(e) {
    if (e.repeat || e.ctrlKey || e.metaKey || e.altKey) return;
    const k = e.key;
    if (!k || k.length !== 1 || !/[a-z0-9]/i.test(k)) return;
    const t = e.target, tag = t && t.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || (t && t.isContentEditable)) return;
    if (this.o.game.paused || this.o.game.dead) return;
    const U = k.toUpperCase();
    // SWALLOW: a one-shot action letter (get out, photo mode, taxi, mission, siren, gear, radio) that continues
    // a live code (the typed tail, 2+ letters, is the start of a code) is kept from the game, so spelling a code
    // never fires it mid-word. Never W/A/S/D or the held keys: driving is untouched. Codes START with a letter
    // outside TAPS, so a first letter always acts as normal.
    if (TAPS.indexOf(U) >= 0) {
      const t = this.buf + U;
      for (let n = Math.min(t.length, BUF); n >= 2; n--) {
        const tail = t.slice(-n);
        if (CODES.some((c) => c.code.startsWith(tail))) { e.stopImmediatePropagation(); break; }
      }
    }
    this.buf = (this.buf + U).slice(-BUF);
    for (const c of CODES) {
      if (this.buf.endsWith(c.code)) { this.buf = ''; this.enter(c.code); return; }
    }
  }

  /** Run a code (typed or entered): true if it was one. */
  enter(text) {
    const code = String(text || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
    const c = CODES.find((k) => k.code === code);
    if (!c) return false;
    const msg = this._run(c.code);
    if (msg === false) return true;   // (needs something it has not got: said so, not counted)
    this.last = c.code; this.log.push(c.code);
    const first = !this.found.has(c.code);
    this.found.add(c.code);
    try { localStorage.setItem(KEY, JSON.stringify([...this.found])); } catch (e) { /* private mode */ }
    const wasOn = CHEAT.on;
    CHEAT.on = true;
    try { sessionStorage.setItem(SESSION, '1'); } catch (e) { /* private mode */ }
    const { hud, audio } = this.o;
    hud.showToast(`CHEAT ACTIVATED: ${msg}${wasOn ? '' : ' · eggs and stunt bonuses are off this session'}`, wasOn ? 3200 : 5200);
    if (audio && audio.ready) { try { audio.pickup(); audio.cash(); } catch (e) { /* sound only */ } }
    if (first && this.found.size === CODES.length) setTimeout(() => hud.showToast('All 13 codes found. Respect.', 3200), 3400);
    return true;
  }

  // --- the effects ----------------------------------------------------------------------------
  /** One timed effect per id: a repeat extends it. */
  timed(id, secs, begin, end) {
    const have = this.fx.find((f) => f.id === id);
    if (have) { have.t = secs; return; }
    begin();
    this.fx.push({ id, t: secs, end });
  }

  /** The kerb beside the road nearest (px, pz), a car's length ahead along (fx, fz): { x, z, h }. */
  _near(px, pz, fx, fz) {
    const city = this.o.city;
    let best = null;
    for (const ei of city.edgesNear(px, pz, 90)) {
      const e = city.edges[ei];
      if (e.elev || e.tunnel || e.prof || e.cls === 'hwy' || e.cls === 'ramp' || e.len < 24) continue;
      const a = city.nodes[e.a];
      const tp = (px - a.x) * e.dx + (pz - a.z) * e.dz;
      const q = tp + 12 * (Math.sign(fx * e.dx + fz * e.dz) || 1);
      const t = Math.max(10, Math.min(e.len - 10, q));
      const qx = a.x + e.dx * t, qz = a.z + e.dz * t, d = Math.hypot(px - qx, pz - qz);
      if (!best || d < best.d) best = { e, qx, qz, d };
    }
    if (best) {
      const { e, qx, qz } = best;
      const sg = (px - qx) * -e.dz + (pz - qz) * e.dx >= 0 ? 1 : -1;
      return { x: qx - e.dz * sg * (e.hw - 1.15), z: qz + e.dx * sg * (e.hw - 1.15), h: Math.atan2(e.dx * sg, e.dz * sg) };
    }
    return { x: px + fx * 9, z: pz + fz * 9, h: Math.atan2(fx, fz) };
  }

  _pose() {
    const { player } = this.o, v = player.onFoot ? null : player.vehicle;
    const p = player.position;
    const h = v ? v.heading : player.heading;
    return { x: p.x, z: p.z, fx: Math.sin(h), fz: Math.cos(h), v };
  }

  _clearKerb(s) {
    const { traffic } = this.o;
    for (const c of [...traffic.cars]) {
      if (c.mode !== 'parked' || Math.hypot(c.x - s.x, c.z - s.z) > 7) continue;
      if (typeof c.slot === 'number' && traffic.reservedSlots) traffic.reservedSlots.add(c.slot);
      traffic.remove(c);
    }
  }

  /** A new car beside the player, owned by traffic, capped at MAX_OWN. */
  _spawn(type, color) {
    const { traffic, fx } = this.o;
    const P = this._pose();
    const s = this._near(P.x, P.z, P.fx, P.fz);
    this._clearKerb(s);
    const v = traffic.spawnAt(s.x, s.z, s.h, type, color, 'apron');
    if (!v) return null;
    v.vLong = 0;
    this._own(v);
    if (fx && fx.emit) fx.emit(v.x, v.y + 1, v.z, 18, { r: 1, g: 0.8, b: 0.3, size: 0.45, life: 0.9, spread: 3, vy: 2, grav: 1.5, jitter: 0.5 });
    return v;
  }
  _own(v) {
    v.cheatCar = true;
    this.own.push(v);
    this._cap();
  }
  _drop(v) {
    const { traffic, player } = this.o;
    if (v === player.vehicle || !traffic.cars.includes(v)) return;
    traffic.remove(v);
    if (v.buggy && v.buggy.mesh && v.buggy.mesh.skeleton) v.buggy.mesh.skeleton.dispose();
  }
  _cap() {
    const { traffic } = this.o;
    this.own = this.own.filter((v) => traffic.cars.includes(v));
    while (this.own.length > MAX_OWN) this._drop(this.own.shift());
  }

  /** Do a code. Returns the toast text, or false if it could not be done (said so; not counted as found). */
  _run(code) {
    const { game, player, hud } = this.o;
    const S = this.o.sys();
    switch (code) {
      case 'DOUBLEDOUBLE': {
        player.health = 100;
        const v = player.onFoot ? null : player.vehicle;
        if (v) { try { v.repair(); } catch (e) { v.health = v.spec.hp || 100; } }
        return 'double-double, full health';
      }
      case 'UPTHERIM': {
        const r = S.rollup;
        if (!r || !r._parkPrize) { hud.showToast('No Tim Hortons around'); return false; }
        const P = this._pose();
        const s = this._near(P.x, P.z, P.fx, P.fz);
        const was = r.store;
        r.store = { x: s.x, z: s.z, door: null };   // (the prize parks at the kerb nearest its "store")
        let v = null;
        try { v = r._parkPrize(); } finally { r.store = was; }
        if (!v) return false;
        this._own(v);
        return 'Roll Up the Rim, a prize car at the kerb';
      }
      case 'HONKHONK': {
        const w = S.wildlife;
        if (!w || !w.spawnV) { hud.showToast('No geese today'); return false; }
        const P = this._pose();
        const h = Math.atan2(P.fx, P.fz);
        for (let i = 0; i < 2; i++) w.spawnV({ x: P.x, z: P.z, n: 11 + i * 4, alt: 22 + i * 14, run: 220, spd: 20, land: false, h: h + (i ? 0.9 : -0.6) });
        return 'honk honk, geese incoming';
      }
      case 'BOXOFTIMBITS': {
        this.timed('BOXOFTIMBITS', 10, () => this.timbits.start(10), () => this.timbits.stop());
        return 'it is raining Timbits';
      }
      case 'WINTERISCOMING': {
        const w = S.weather;
        if (!w) return false;
        this.timed('WINTERISCOMING', 90, () => w.set('snow', false), () => w.set(w.setting === 'auto' ? 'auto' : w.setting, false));
        return 'winter is coming';
      }
      case 'AMBERHOUR': {
        const t = S.tod;
        if (!t) return false;
        const set = (m) => { t.mode = m; t._realT = -1e9; t.solve(new Date()); t.apply(true); };
        this.timed('AMBERHOUR', 120, () => set('dusk'), () => set(t.setting));
        return 'golden hour';
      }
      case 'BUMPYROAD': {
        this.timed('BUMPYROAD', 30, () => { this.potT = 0; }, () => {
          for (const v of this.bounced) v.yVis = 0, v._pot = 0;
          this.bounced.length = 0;
        });
        return 'pothole season, traffic bounces for 30 s';
      }
      case 'IONSPEED': {
        const l = S.link;
        if (!l) return false;
        this.timed('IONSPEED', 60, () => { l.boostK = 3; }, () => { l.boostK = 1; });
        return 'ION at triple speed for 60 s';
      }
      case 'UNWANTED': {
        game.wanted = 0; game.points = 0; game.cool = 0;
        if (S.police && S.police.clear) S.police.clear();
        return 'no fun: wanted level cleared';
      }
      case 'WANTEDLEVEL5': {
        game.setWanted(5);
        return 'wanted level 5';
      }
      case 'KWHEELS': {
        const ty = pick(WHEELS);
        const v = this._spawn(ty, null);
        if (!v) return false;
        return `KWheels: a ${ty === 'delorean' ? 'DeLorean-alike' : ty === 'icecream' ? 'ice cream truck' : ty}`;
      }
      case 'BUGGYTIME': {
        const v = this._spawn('buggy', 0x141518);
        if (!v) return false;
        return 'buggy time';
      }
      case 'WATERLOOPINK': {
        const v = player.onFoot ? null : player.vehicle;
        if (!v || !v.respray || !v.respray(PINK)) { hud.showToast(v ? 'This one refuses pink' : 'PINKTIE: get in a car first'); return false; }
        return 'engineering pink';
      }
    }
    return false;
  }

  // --- per frame (returns at once when nothing is going) ---------------------------------------------
  tick(dt) {
    if (!this.fx.length) return;
    const { player, traffic } = this.o;
    const p = player.position;
    if (this.timbits.live) this.timbits.update(dt, p.x, p.z, p.y || 0);
    for (let i = this.fx.length - 1; i >= 0; i--) {
      const f = this.fx[i];
      f.t -= dt;
      if (f.id === 'BUMPYROAD') this._bounce(dt, p, traffic);
      if (f.t <= 0) { this.fx.splice(i, 1); try { f.end(); } catch (e) { console.warn('cheat end: ' + e.message); } }
    }
  }
  _bounce(dt, p, traffic) {
    this.potT += dt;
    const pv = this.o.player.vehicle;
    for (const v of traffic.cars) {
      if (v === pv || v.spec.plane || v.spec.heli || v.spec.boat) continue;
      const m = v.mode;
      if (m === 'parked' || m === 'apron') continue;
      if (Math.abs(v.x - p.x) > 160 || Math.abs(v.z - p.z) > 160) { if (v._pot) { v.yVis = 0; v._pot = 0; } continue; }
      if (!v._pot) { v._pot = 1; this.bounced.push(v); }
      v.yVis = Math.abs(Math.sin(this.potT * 5 + (v.x + v.z) * 0.37)) * 0.7;
    }
    if (this.bounced.length > 80) this.bounced = this.bounced.filter((v) => v._pot && traffic.cars.includes(v));
  }

  // --- the pause menu ----------------------------------------------------------------------------
  passportRows() { return [{ label: 'Codes found', done: this.found.size, total: CODES.length }]; }
  listHtml() {
    if (!this.found.size) return '';
    const rows = CODES.map((c) => this.found.has(c.code)
      ? `<div class="ppRow"><span>${c.code}</span><b>${c.name}</b></div>`
      : `<div class="ppRow"><span>${'?'.repeat(c.code.length)}</span><b></b></div>`);
    return `<div style="grid-column:1/-1;margin-top:6px;font-size:10px;letter-spacing:.04em">${rows.join('')}</div>`;
  }

  /** The footer on the pause card: tap the version 5 times for a code box (a phone has no keyboard to type on). */
  _footer() {
    const card = document.getElementById('pauseCard');
    if (!card) return;
    const f = document.createElement('div');
    f.id = 'cheatFoot';
    f.style.cssText = 'margin-top:10px;text-align:center;font-size:10px;letter-spacing:.14em;opacity:.35;padding:10px;-webkit-tap-highlight-color:transparent;user-select:none;-webkit-user-select:none';
    const b = document.getElementById('build');
    f.textContent = 'AUTO KW ' + (b ? b.textContent.trim() : '');
    const box = document.createElement('div');
    box.id = 'cheatBox';
    box.style.cssText = 'display:none;margin-top:6px;text-align:center';
    box.innerHTML = '<input id="cheatIn" type="text" autocomplete="off" autocapitalize="characters" autocorrect="off" spellcheck="false" placeholder="Enter code" '
      + 'style="font:16px monospace;letter-spacing:.12em;text-transform:uppercase;width:60%;padding:8px 10px;border-radius:8px;border:1px solid rgba(255,255,255,.3);background:rgba(0,0,0,.4);color:#fff">'
      + '<button id="cheatGo" class="segbtn" style="margin-left:8px">Go</button><div id="cheatMsg" style="font-size:11px;margin-top:6px;opacity:.7;min-height:14px"></div>';
    card.appendChild(f); card.appendChild(box);
    let taps = 0, last = 0;
    f.addEventListener('click', () => {
      const now = performance.now();
      taps = now - last > 4000 ? 1 : taps + 1; last = now;
      if (taps >= 5) { taps = 0; box.style.display = 'block'; this.inp.focus(); }
    });
    const inp = box.querySelector('#cheatIn'), msg = box.querySelector('#cheatMsg');
    const go = () => {
      const val = inp.value; inp.value = '';
      if (!val.trim()) return;
      const known = CODES.some((c) => c.code === val.toUpperCase().replace(/[^A-Z0-9]/g, ''));
      if (!known) { msg.textContent = 'Nothing happens.'; return; }
      msg.textContent = '';
      inp.blur();
      const r = document.getElementById('resumeBtn');
      if (r) r.click();      // back into the game, then the cheat (its toast is on the HUD)
      setTimeout(() => this.enter(val), 120);
    };
    box.querySelector('#cheatGo').addEventListener('click', go);
    inp.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter') go(); });
    inp.addEventListener('keyup', (e) => e.stopPropagation());
    this.box = box; this.inp = inp;
  }
}
