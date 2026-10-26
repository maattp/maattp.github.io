// Auto KW: the phone performance audit. One build, the iPhone 17 Pro profile
// (UA, 874 x 402 landscape at dpr 3, so every ON_PHONE path runs), the Mac's
// GPU (vsync off), CDP CPU throttling as the phone's CPU stand-in.
//
//   python3 -m http.server 8105 &          (from a root that serves the build)
//   AUTO_CDP_PORT=9505 node tools/kw/perfaudit.mjs --url=http://localhost:8105/apps/autokw/
//        [--label=master] [--throttle=8] [--secs=20] [--json=out.json]
//        [--views=spawn,king,pkwy,plaza,campus,country] [--no-boot] [--no-views]
//        [--boot-prof] [--view-prof] [--prof-out=DIR] [--census] [--top=25] [--shots=DIR] [--boot-probe=FILE.js]
//        [--pre='<js>']
//
// Two parts, each in a FRESH profile (the boot cache is IndexedDB, per profile):
//
//  BOOT  the whole boot throttled (set before navigation, as tools/boottime.mjs):
//        time to the first drawn frame on a cold launch, then a reload in the same
//        profile (the boot cache this build wrote) for the warm one. Each launch
//        prints the boot log's steps that took longest (every __bootLog line,
//        timestamped from page start -- so a new boot pass shows by name), the
//        GC'd JS heap (objects + array buffers) and the GPU ledger (every buffer /
//        texture / renderbuffer the context allocated, minus deletes, plus the
//        drawing buffer). `--boot-prof` adds a sampling CPU profile of the warm
//        launch (what a player sees every time), top functions by self time.
//
//  VIEWS boot unthrottled, then for each view: put the player there (unthrottled,
//        until the streamer has settled), throttle, and let the game's own loop
//        run for --secs of wall clock with REAL input -- the car is steered by an
//        autopilot hooked in front of player.update (the input a stick would give,
//        as tools/perfcpu.mjs does) along a route walked off the road graph. Per
//        view: frame CPU (the whole rAF callback: mean, median, p90, p99), frames,
//        draws and triangles of the scene pass (renderer.info, mean), the shadow
//        pass's draws, per-system ms/frame (player, traffic, peds, world.update,
//        world.animate, hud, render ...), JS heap and GPU at the end.
//
// Views (the same ground in every build since v21):
//   spawn    the opening frame, standing on Waterloo Public Square
//   king     driving King St N/S through Uptown Waterloo at ~13 m/s
//   pkwy     the Conestoga Parkway at ~27 m/s (~97 km/h)
//   plaza    on foot in Fairway Plaza's lot by Fairview Park, looking at the stores
//   campus   driving Ring Road round the University of Waterloo at ~9 m/s
//   country  driving a concession road north-west of Waterloo at ~20 m/s
//
// Read the numbers as ratios between builds: the throttle charges its pauses to
// whatever runs (trust means, not spikes), and two harnesses at once on one Mac
// are not a comparison -- run builds one after another.

import { writeFileSync, mkdirSync, readFileSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';
import { launchChrome, assertRenderer } from '../chrome.mjs';

const arg = (k, d) => { const a = process.argv.find((x) => x.startsWith(`--${k}=`)); return a ? a.slice(k.length + 3) : d; };
const flag = (k) => process.argv.includes(`--${k}`);
const URL0 = arg('url', `http://localhost:${process.env.AUTO_HTTP_PORT || 8000}/apps/autokw/`);
const PORT = +process.env.AUTO_CDP_PORT || 9505;
const LABEL = arg('label', URL0);
const THROTTLE = +arg('throttle', 8);
const SECS = +arg('secs', 20);
const VIEWS = arg('views', 'spawn,king,pkwy,plaza,campus,country').split(',');
const JSON_OUT = arg('json', '');
const TOP = +arg('top', 25);
const SHOTS = arg('shots', '');
// a JS file (an expression) evaluated after each boot launch, printed: e.g. hashes
// to prove a boot-cache memo gives the cold launch's answer
const BOOT_PROBE = arg('boot-probe', '') ? readFileSync(arg('boot-probe', ''), 'utf8') : '';   // a directory: one jpg per view, at the end of its run
const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 19_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/19.0 Mobile/15E148 Safari/604.1';
const VIEW = { width: 874, height: 402, deviceScaleFactor: 3, mobile: true };

// Before any page script: the GPU ledger (tools/memprobe.mjs's, trimmed) and a
// timestamped copy of every boot-log line.
const INJECT = `window.__noAutoQuality = true;
try { localStorage.setItem('autokw-quality', 'high'); } catch (e) {}
(() => {
  const P = WebGL2RenderingContext.prototype;
  const L = window.__glMem = { buf: 0, tex: 0, rb: 0, peak: 0, bufs: new Map(), texs: new Map(), rbs: new Map() };
  const bound = new Map(), texBound = new Map(); let unit = 0, rbBound = null;
  const BPP = { 0x8058: 4, 0x8051: 3, 0x1908: 4, 0x1907: 3, 0x881A: 8, 0x8815: 6, 0x8814: 16, 0x822D: 2, 0x822E: 4, 0x822B: 2, 0x8229: 1, 0x1909: 1, 0x190A: 2, 0x1903: 1,
    0x88F0: 4, 0x81A6: 4, 0x81A5: 2, 0x8CAC: 4, 0x8CAD: 8, 0x8C43: 4, 0x8C41: 3, 0x8C3A: 4, 0x8D62: 2, 0x8056: 2, 0x8057: 2, 0x8F97: 4, 0x8230: 8, 0x822F: 4 };
  const bpp = (f) => BPP[f] || 4;
  const peak = () => { const t = L.buf + L.tex + L.rb; if (t > L.peak) L.peak = t; };
  const ob = P.bindBuffer; P.bindBuffer = function (t, b) { bound.set(t, b); return ob.call(this, t, b); };
  const bd = P.bufferData; P.bufferData = function (t, d, u, off, len) {
    const b = bound.get(t);
    const n = typeof d === 'number' ? d : d ? (len ? len * (d.BYTES_PER_ELEMENT || 1) : d.byteLength - (off || 0) * (d.BYTES_PER_ELEMENT || 1)) : 0;
    if (b) { L.buf += n - (L.bufs.get(b) || 0); L.bufs.set(b, n); peak(); }
    return bd.apply(this, arguments);
  };
  const db = P.deleteBuffer; P.deleteBuffer = function (b) { if (L.bufs.has(b)) { L.buf -= L.bufs.get(b); L.bufs.delete(b); } return db.call(this, b); };
  const at = P.activeTexture; P.activeTexture = function (u) { unit = u; return at.call(this, u); };
  const bt = P.bindTexture; P.bindTexture = function (t, x) { texBound.set(unit * 16 + (t & 15), x); return bt.call(this, t, x); };
  const cur = (t) => { const base = (t >= 0x8515 && t <= 0x851A) ? 0x8513 : t; return texBound.get(unit * 16 + (base & 15)); };
  const setLvl = (x, key, n) => { if (!x) return; let m = L.texs.get(x); if (!m) { m = new Map(); L.texs.set(x, m); } L.tex += n - (m.get(key) || 0); m.set(key, n); peak(); };
  const ti = P.texImage2D; P.texImage2D = function (t, lvl, ifmt) {
    let w, h;
    if (arguments.length >= 8) { w = arguments[3]; h = arguments[4]; }
    else { const s = arguments[5]; w = s.videoWidth || s.naturalWidth || s.width; h = s.videoHeight || s.naturalHeight || s.height; }
    setLvl(cur(t), t + ':' + lvl, w * h * bpp(ifmt));
    return ti.apply(this, arguments);
  };
  const ts = P.texStorage2D; P.texStorage2D = function (t, levels, ifmt, w, h) {
    let n = 0; for (let i = 0; i < levels; i++) n += Math.max(1, w >> i) * Math.max(1, h >> i) * bpp(ifmt) * (t === 0x8513 ? 6 : 1);
    setLvl(cur(t), 'storage', n); return ts.apply(this, arguments);
  };
  const t3 = P.texImage3D; P.texImage3D = function (t, lvl, ifmt, w, h, d) { setLvl(cur(t), t + ':' + lvl, w * h * d * bpp(ifmt)); return t3.apply(this, arguments); };
  const s3 = P.texStorage3D; P.texStorage3D = function (t, levels, ifmt, w, h, d) {
    let n = 0; for (let i = 0; i < levels; i++) n += Math.max(1, w >> i) * Math.max(1, h >> i) * d * bpp(ifmt);
    setLvl(cur(t), 'storage', n); return s3.apply(this, arguments);
  };
  const gm = P.generateMipmap; P.generateMipmap = function (t) {
    const x = cur(t), m = x && L.texs.get(x);
    if (m) { let base = 0; for (const [k, v] of m) if (k.endsWith(':0')) base += v; setLvl(x, 'mips', Math.round(base / 3)); }
    return gm.call(this, t);
  };
  const dt = P.deleteTexture; P.deleteTexture = function (x) { const m = L.texs.get(x); if (m) { for (const v of m.values()) L.tex -= v; L.texs.delete(x); } return dt.call(this, x); };
  const br = P.bindRenderbuffer; P.bindRenderbuffer = function (t, r) { rbBound = r; return br.call(this, t, r); };
  const rs = P.renderbufferStorage; P.renderbufferStorage = function (t, f, w, h) { if (rbBound) { L.rb += w * h * bpp(f) - (L.rbs.get(rbBound) || 0); L.rbs.set(rbBound, w * h * bpp(f)); peak(); } return rs.apply(this, arguments); };
  const dr = P.deleteRenderbuffer; P.deleteRenderbuffer = function (r) { if (L.rbs.has(r)) { L.rb -= L.rbs.get(r); L.rbs.delete(r); } return dr.call(this, r); };
  L.read = () => {
    const c = document.getElementById('gl'), fb = c ? c.width * c.height * 4 * 3 : 0;
    const MB = (b) => +(b / 1048576).toFixed(1);
    return { totalMB: MB(L.buf + L.tex + L.rb + fb), bufMB: MB(L.buf), texMB: MB(L.tex), rbMB: MB(L.rb + fb), peakMB: MB(L.peak + fb) };
  };
  // every boot-log line, timestamped (index.html defines __bootLog; wrap it as it is set)
  const B = window.__blAll = []; let f0 = null;
  Object.defineProperty(window, '__bootLog', { configurable: true,
    set(f) { f0 = f; }, get() { return (m) => { B.push([performance.now(), String(m)]); if (f0) return f0(m); }; } });
})();`;

// ---- the page side of the views ---------------------------------------------
function pageInstall() {
  const d = window.__dbg, c = d.city, p = d.player;
  const S = window.__pa = { on: false, sys: {}, frames: [] };
  const wrap = (obj, key, name) => {
    const f = obj && obj[key];
    if (typeof f !== 'function') return;
    obj[key] = function (...a) {
      if (!S.on) return f.apply(this, a);
      const t0 = performance.now();
      try { return f.apply(this, a); } finally { S.sys[name] = (S.sys[name] || 0) + performance.now() - t0; }
    };
  };
  wrap(d.traffic, 'update', 'traffic');
  wrap(d.peds, 'update', 'peds');
  wrap(d.world, 'update', 'world');
  wrap(d.world, 'animate', 'animate');
  wrap(d.hud, 'update', 'hud');
  wrap(d.audio, 'update', 'audio');
  if (d.acts) wrap(d.acts, 'update', 'activities');
  if (d.police) wrap(d.police, 'update', 'police');
  if (d.air) wrap(d.air, 'update', 'air');
  // the scene pass and the shadow pass separately (renderer.info resets after the shadow pass)
  wrap(d.renderer, 'render', 'render');
  const sm = d.renderer.shadowMap, smr = sm.render;
  S.shadowCalls = 0;
  sm.render = function (...a) {
    const c0 = d.renderer.info.render.calls, t0 = performance.now();
    try { return smr.apply(this, a); } finally {
      if (S.on) { S.sys.shadow = (S.sys.shadow || 0) + performance.now() - t0; S.shadowCalls += d.renderer.info.render.calls - c0; }
    }
  };
  // THE SCENE CENSUS (--census): on the next scene pass, after chunkCull /
  // lmCull hid what they hide, walk the scene as three's projectObject does:
  // objects visited (an invisible one counts, its subtree does not), meshes
  // frustum-tested (and how many of those pass), meshes drawn untested
  // (frustumCulled off), per top-level group (scene child / grandchild).
  // Tested-and-culled meshes in one group are what a whole-group cull saves.
  const rnd = d.renderer.render;
  S.census = () => new Promise((res) => { S._census = res; });
  d.renderer.render = function (scene, camera, ...a) {
    if (S._census && scene === d.scene) {
      const res = S._census; S._census = null;
      const T3 = d.THREE, fr = new T3.Frustum().setFromProjectionMatrix(new T3.Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse));
      const by = new Map(), tot = { visited: 0, tested: 0, passed: 0, untested: 0 };
      const walk = (o, k, depth) => {
        tot.visited++;
        let g = by.get(k);
        if (!g) by.set(k, (g = { k, visited: 0, tested: 0, passed: 0, untested: 0 }));
        g.visited++;
        if (o.visible === false) return;
        if (o.layers.test(camera.layers) && (o.isMesh || o.isLine || o.isPoints || o.isSprite)) {
          if (!o.frustumCulled) { g.untested++; tot.untested++; }
          else {
            g.tested++; tot.tested++;
            if (o.isSprite ? fr.intersectsSprite(o) : fr.intersectsObject(o)) { g.passed++; tot.passed++; }
          }
        }
        const ch = o.children;
        for (let i = 0; i < ch.length; i++) walk(ch[i], depth === 0 ? (ch[i].name || ch[i].type) : depth === 1 ? k + '/' + (ch[i].name || ch[i].type) : k, depth + 1);
      };
      walk(scene, 'scene', 0);
      const top = [...by.values()].sort((x, y) => (y.tested - y.passed) - (x.tested - x.passed) || y.visited - x.visited).slice(0, 14);
      res({ ...tot, culled: tot.tested - tot.passed, top });
    }
    return rnd.call(this, scene, camera, ...a);
  };
  const RAF0 = window.requestAnimationFrame.bind(window);
  let lastSys = {};
  window.requestAnimationFrame = (cb) => RAF0((ts) => {
    const t0 = performance.now();
    cb(ts);
    if (S.on) {
      const snap = {};
      for (const [k, v] of Object.entries(S.sys)) snap[k] = v - (lastSys[k] || 0);
      lastSys = { ...S.sys };
      S.frames.push([performance.now() - t0, ts, snap, d.sceneStats.calls, d.sceneStats.tris]);
    }
  });
  S.nextFrames = (n) => new Promise((res) => { let k = 0; const f = () => { if (++k >= n) res(); else RAF0(f); }; RAF0(f); });

  // --- routes (tools/perfcpu.mjs's walk of the graph) ---
  const wrapA = (a) => Math.atan2(Math.sin(a), Math.cos(a));
  const okDir = (e, from) => !e.oneway || ((e.a === from) !== !!e.onewayRev);
  const buildRoute = (x, z, test, len) => {
    let best = null, bd = 1e18;
    for (const ei of c.edgesNear(x, z, 600)) {
      const e = c.edges[ei];
      if (e.tunnel || !test(e) || e.len < 15) continue;
      const a = c.nodes[e.a];
      const dd = (a.x - x) ** 2 + (a.z - z) ** 2;
      if (dd < bd) { bd = dd; best = ei; }
    }
    if (best === null) return null;
    const e0 = c.edges[best];
    const from = okDir(e0, e0.a) ? e0.a : e0.b;
    const nodes = [from];
    let cur = from === e0.a ? e0.b : e0.a, prevE = best, s = e0.len;
    nodes.push(cur);
    let h = Math.atan2(c.nodes[cur].x - c.nodes[from].x, c.nodes[cur].z - c.nodes[from].z);
    const seen = new Set([best]);
    while (s < len) {
      let pick = null, pd = 1e9;
      for (const k of c.nodes[cur].e) {
        if (k === prevE || seen.has(k)) continue;
        const e = c.edges[k];
        if (e.tunnel || !test(e) || !okDir(e, cur)) continue;
        const o = e.a === cur ? e.b : e.a;
        const hh = Math.atan2(c.nodes[o].x - c.nodes[cur].x, c.nodes[o].z - c.nodes[cur].z);
        const dh = Math.abs(wrapA(hh - h));
        if (dh < pd) { pd = dh; pick = k; }
      }
      if (pick === null || pd > 1.2) break;
      const e = c.edges[pick];
      const o = e.a === cur ? e.b : e.a;
      h = Math.atan2(c.nodes[o].x - c.nodes[cur].x, c.nodes[o].z - c.nodes[cur].z);
      seen.add(pick); prevE = pick; s += e.len; cur = o; nodes.push(o);
    }
    const route = [];
    let acc = 0;
    for (let i = 0; i < nodes.length; i++) {
      const n = c.nodes[nodes[i]];
      if (i) acc += Math.hypot(n.x - route[i - 1].x, n.z - route[i - 1].z);
      route.push({ x: n.x, z: n.z, y: n.y, s: acc });
    }
    return route;
  };
  const street = (e) => e.cls !== 'hwy' && e.cls !== 'ramp' && !e.elev;
  S.spawn0 = { x: p.position.x, z: p.position.z, camYaw: p.camYaw };
  S.runs = {
    spawn: { spawn: true },
    king: { speed: 13, route: () => buildRoute(S.spawn0.x, S.spawn0.z, (e) => street(e) && /^King Street/.test(e.name || ''), 2400) },
    // (not in the default list) Caroline St behind Waterloo Public Square: ION,
    // the Clay and Glass Gallery, CIGI -- the player's slow street (v86)
    caroline: { speed: 10, route: () => buildRoute(-3960, -1210, (e) => street(e) && /^Caroline Street/.test(e.name || ''), 1400) },
    pkwy: { speed: 27, route: () => buildRoute(-1907, 3058, (e) => e.cls === 'hwy' && /Conestoga Parkway/.test(e.name || ''), 6000) },
    // Fairway Plaza (kwshops' plazas): the lot in front of the stores, looking at them
    plaza: { foot: [2250, 3604], lot: true },
    campus: { speed: 9, route: () => buildRoute(-5440, -2420, (e) => /^Ring Road/.test(e.name || ''), 2400) },
    // (not in the default list) a signalled arterial: 'art' streets from the
    // signal at (-1644, -157) west of Uptown, through its lights at ~15 m/s
    arterial: { speed: 15, route: () => buildRoute(-1644, -157, (e) => street(e) && e.cls === 'art', 2400) },
    country: { speed: 20, route: () => buildRoute(-8768, -11050, (e) => street(e) && e.len > 15, 4000) },
  };

  let R = null;
  const pointAt = (sq) => {
    const rt = R.route, tot = rt[rt.length - 1].s;
    sq = Math.max(0, Math.min(tot, sq));
    let i = R.seg || 0;
    while (i > 0 && rt[i].s > sq) i--;
    while (i < rt.length - 2 && rt[i + 1].s < sq) i++;
    const a = rt[i], b = rt[i + 1], f = (sq - a.s) / ((b.s - a.s) || 1);
    return { x: a.x + (b.x - a.x) * f, z: a.z + (b.z - a.z) * f, y: a.y + (b.y - a.y) * f, h: Math.atan2(b.x - a.x, b.z - a.z) };
  };
  const project = (x, z) => {
    const rt = R.route;
    let best = null;
    for (let i = Math.max(0, R.seg - 3); i < Math.min(rt.length - 1, R.seg + 6); i++) {
      const a = rt[i], b = rt[i + 1];
      const L = Math.hypot(b.x - a.x, b.z - a.z) || 1, ux = (b.x - a.x) / L, uz = (b.z - a.z) / L;
      const t = Math.max(0, Math.min(L, (x - a.x) * ux + (z - a.z) * uz));
      const dd = Math.hypot(x - a.x - ux * t, z - a.z - uz * t);
      if (!best || dd < best.d) best = { d: dd, i, s: a.s + t };
    }
    return best;
  };
  const placeCar = (sq, speed) => {
    const v = p.vehicle, q = pointAt(sq);
    v.x = q.x; v.z = q.z; v.heading = q.h;
    v.y = c.groundAt(q.x, q.z, q.y + 1.5);
    v.vy = 0; v.vLong = speed; v.vLat = 0;
    p.camYaw = q.h + Math.PI; p.camFloor = null;
    R.seg = Math.max(0, R.route.findIndex((k) => k.s > sq) - 1);
    R.hist = [];
  };
  const drive = (input, dt) => {
    const v = p.vehicle; if (!v || !R || !R.route) return;
    const pr = project(v.x, v.z);
    const tot = R.route[R.route.length - 1].s;
    R.t = (R.t || 0) + dt;
    if (pr) R.seg = pr.i;
    R.hist.push([R.t, pr ? pr.s : 0]);
    while (R.hist.length > 1 && R.hist[1][0] < R.t - 3) R.hist.shift();
    const stalled = R.hist.length > 1 && R.hist[0][0] < R.t - 2.9 && (pr ? pr.s : 0) - R.hist[0][1] < 3;
    if (!pr || pr.d > 18 || pr.s > tot - 40 || stalled || v.dead) {
      R.resets = (R.resets || 0) + 1;
      if (v.dead) { v.dead = false; v.health = 100; }
      placeCar(20, R.speed * 0.8);
      return;
    }
    const sp = Math.abs(v.vLong);
    const look = Math.max(10, Math.min(30, 8 + sp * 0.7));
    const tgt = pointAt(pr.s + look);
    const dh = wrapA(Math.atan2(tgt.x - v.x, tgt.z - v.z) - v.heading);
    input.x = Math.max(-1, Math.min(1, -dh * 3));
    const far = pointAt(pr.s + 50);
    const bend = Math.abs(wrapA(Math.atan2(far.x - v.x, far.z - v.z) - v.heading));
    const vt = R.speed * (bend > 0.5 ? 0.55 : bend > 0.25 ? 0.8 : 1);
    input.gas = sp < vt; input.gasAmt = sp < vt ? 1 : 0;
    input.brake = sp > vt + 4; input.brakeAmt = sp > vt + 4 ? 1 : 0;
    input.y = 0; input.hand = false; input.attack = false;
    if (v.health < 60) v.health = 100;
    d.game.wanted = 0; d.game.points = 0;
  };
  const pu = p.update;
  p.update = function (dt, input, ...rest) {
    if (R && R.route && p.vehicle) drive(input, dt);
    if (!S.on) return pu.call(this, dt, input, ...rest);
    const t0 = performance.now();
    try { return pu.call(this, dt, input, ...rest); } finally { S.sys.player = (S.sys.player || 0) + performance.now() - t0; }
  };

  S.setup = async (name) => {
    const cfg = S.runs[name];
    d.game.paused = false;
    R = null; S.footAt = null;
    if (cfg.spawn) {
      if (!p.onFoot && p.exitVehicle) p.exitVehicle();
      p.respawn(S.spawn0.x, S.spawn0.z);
      p.camYaw = S.spawn0.camYaw;
    } else if (cfg.foot) {
      if (!p.onFoot && p.exitVehicle) p.exitVehicle();
      let [x, z] = cfg.foot, look = null;
      if (cfg.lot) {
        // the open lot nearest the plaza's point, 45-110 m out: no building box
        // within 18 m; then face the point
        let best = null;
        for (let r = 45; r <= 110 && !best; r += 5) for (let k = 0; k < 24 && !best; k++) {
          const a = k / 24 * Math.PI * 2, qx = x + Math.sin(a) * r, qz = z + Math.cos(a) * r;
          if (c.buildingsNear(qx, qz, 18).length === 0 && !c.onRoad(qx, qz)) best = [qx, qz];
        }
        if (best) { look = [x, z]; [x, z] = best; }
      }
      p.respawn(x, z);
      if (look) { const h = Math.atan2(look[0] - x, look[1] - z); p.heading = h; p.camYaw = h + Math.PI; }
      S.footAt = [Math.round(x), Math.round(z)];
    } else {
      const route = cfg.route();
      if (!route || route.length < 3) return { error: 'no route' };
      R = { route, speed: cfg.speed, seg: 0, hist: [], t: 0, resets: 0 };
      if (!p.onFoot && p.exitVehicle) p.exitVehicle();
      const q0 = pointAt(0);
      p.respawn(q0.x, q0.z);
      const car = d.traffic.spawnAt(q0.x, q0.z, q0.h, 'sedan', 0x3366aa, 'free');
      p.enterVehicle(car);
      placeCar(20, cfg.speed * 0.8);
    }
    const t0 = performance.now();
    while (performance.now() - t0 < 4000) await S.nextFrames(10);
    const pend = () => [...d.world.chunks.values()].filter((q) => q.lod !== q.wantLod).length;
    while (pend() > 2 && performance.now() - t0 < 90000) await S.nextFrames(10);
    if (R) R.resets = 0;
    return { route: R ? Math.round(R.route[R.route.length - 1].s) : 0, settle: Math.round(performance.now() - t0), at: S.footAt || null };
  };
  const q = (a, f) => { if (!a.length) return NaN; const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(s.length * f))]; };
  S.time = async (secs) => {
    S.sys = {}; S.frames = []; S.shadowCalls = 0; lastSys = {}; S.on = true;
    const p0 = p.position; let dist = 0, last = [p0.x, p0.z];
    const t0 = performance.now();
    while (performance.now() - t0 < secs * 1000) {
      await S.nextFrames(5);
      const pp = p.position; dist += Math.hypot(pp.x - last[0], pp.z - last[1]); last = [pp.x, pp.z];
    }
    S.on = false;
    const F = S.frames.map((f) => f[0]);
    const n = F.length, mean = (a) => a.reduce((x, y) => x + y, 0) / Math.max(1, a.length);
    const out = { n, secs: +((performance.now() - t0) / 1000).toFixed(1),
      cpuMean: +mean(F).toFixed(2), cpuMed: +q(F, 0.5).toFixed(2), cpu90: +q(F, 0.9).toFixed(2), cpu99: +q(F, 0.99).toFixed(2),
      draws: Math.round(mean(S.frames.map((f) => f[3]))), trisK: Math.round(mean(S.frames.map((f) => f[4])) / 1000),
      shadowDraws: +(S.shadowCalls / Math.max(1, n)).toFixed(1),
      cars: d.traffic.cars.length, peds: d.peds.peds.length, moved: Math.round(dist), resets: R ? R.resets : 0, sys: {} };
    for (const [k, v] of Object.entries(S.sys)) out.sys[k] = +(v / Math.max(1, n)).toFixed(2);
    out.gpu = window.__glMem.read();
    out.programs = d.renderer.info.programs ? d.renderer.info.programs.length : 0;
    if (S.wantCensus) out.scene = await S.census();
    return out;
  };
  return true;
}

// ---- node side ----------------------------------------------------------------
async function session(fn) {
  const profile = `/tmp/autokw-perfaudit-${PORT}`;
  const chrome = launchChrome({ port: PORT, profile, gpu: true, headed: false, width: VIEW.width, height: VIEW.height, vsyncOff: true });
  try {
    let page;
    for (let i = 0; i < 90 && !page; i++) {
      try { page = (await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()).find((t) => t.type === 'page'); } catch {}
      if (!page) await sleep(300);
    }
    if (!page || page.url !== 'about:blank') throw new Error(`CDP port ${PORT} is not this run's Chrome`);
    const ws = new WebSocket(page.webSocketDebuggerUrl);
    await new Promise((r, j) => { ws.addEventListener('open', r); ws.addEventListener('error', j); });
    let id = 0; const pend = new Map(); const errs = [];
    ws.addEventListener('message', (e) => {
      const m = JSON.parse(e.data);
      if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); }
      else if (m.method === 'Runtime.exceptionThrown') errs.push(m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text);
    });
    const send = (m, p = {}) => new Promise((res) => { ws.send(JSON.stringify({ id: ++id, method: m, params: p })); pend.set(id, res); });
    const ev = async (e) => {
      const r = await send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true });
      if (r.result?.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails).slice(0, 600));
      return r.result?.result?.value;
    };
    await send('Runtime.enable'); await send('Page.enable'); await send('Network.enable');
    await send('Network.setBypassServiceWorker', { bypass: true });
    await send('Network.setCacheDisabled', { cacheDisabled: true });
    await send('Emulation.setDeviceMetricsOverride', { ...VIEW, screenWidth: VIEW.width, screenHeight: VIEW.height, screenOrientation: { type: 'landscapePrimary', angle: 90 } });
    await send('Emulation.setUserAgentOverride', { userAgent: UA, platform: 'iPhone' });
    await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
    await send('Page.addScriptToEvaluateOnNewDocument', { source: INJECT });
    const heap = async () => {
      await send('HeapProfiler.collectGarbage'); await send('HeapProfiler.collectGarbage');
      const h = (await send('Runtime.getHeapUsage')).result;
      return +((h.usedSize + (h.backingStorageSize || 0)) / 1048576).toFixed(0);
    };
    const launch = async () => {
      await send('Page.navigate', { url: URL0 });
      for (let i = 0; i < 2400; i++) {
        await sleep(250);
        try { const t = await ev('window.__dbg && window.__dbg.sceneStats && window.__dbg.sceneStats.calls > 0 ? performance.now() : 0'); if (t) return t; } catch {}
        if (errs.length > 3) break;
      }
      throw new Error('never drew a frame: ' + errs.slice(0, 3).join(' | '));
    };
    return await fn({ send, ev, errs, heap, launch });
  } finally { chrome.kill('SIGKILL'); await sleep(800); }
}

function bootSteps(rows, done) {
  // each line's time is until the next line: what ran after it was logged
  const out = [];
  for (let i = 0; i < rows.length; i++) {
    const end = i + 1 < rows.length ? rows[i + 1][0] : done;
    out.push({ t: +(rows[i][0] / 1000).toFixed(2), ms: Math.round(end - rows[i][0]), m: rows[i][1].slice(0, 110) });
  }
  return out;
}

function profileTop(prof, top) {
  const byId = new Map(prof.nodes.map((n) => [n.id, n]));
  const parent = new Map(); for (const n of prof.nodes) for (const c of (n.children || [])) parent.set(c, n.id);
  const key = (cf) => `${cf.functionName || '(anon)'} ${cf.url.replace(/^.*\/apps\/autokw\//, '')}:${cf.lineNumber + 1}`;
  const self = new Map(), incl = new Map(); let total = 0;
  for (let i = 0; i < prof.samples.length; i++) {
    const us = prof.timeDeltas[i + 1] !== undefined ? prof.timeDeltas[i + 1] : 0;
    const cf = byId.get(prof.samples[i]).callFrame;
    if (cf.functionName === '(idle)' || cf.functionName === '(program)') continue;
    const k = key(cf);
    self.set(k, (self.get(k) || 0) + us); total += us;
    const seen = new Set();
    for (let nid = prof.samples[i]; nid !== undefined; nid = parent.get(nid)) {
      const q = key(byId.get(nid).callFrame); if (seen.has(q)) continue; seen.add(q); incl.set(q, (incl.get(q) || 0) + us);
    }
  }
  const list = (m) => [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, top).map(([k, us]) => ({ fn: k, ms: Math.round(us / 1000), pct: +(us / total * 100).toFixed(1) }));
  return { self: list(self), incl: list(new Map([...incl].filter(([k]) => !/^\((root|anon)\) :0$/.test(k)))) };
}

const out = { label: LABEL, url: URL0, throttle: THROTTLE, boot: null, views: {} };
const build = (/id="build">([^<]*)</.exec(await (await fetch(URL0 + 'index.html')).text()) || [])[1];
out.build = build;
console.log(`perfaudit ${LABEL}  build ${build}  iPhone 17 Pro profile  CPU ${THROTTLE}x`);
let code = 0;
try {
  if (!flag('no-boot')) {
    out.boot = await session(async ({ send, ev, errs, heap, launch }) => {
      await assertRenderer(ev, console.log, true).catch(() => {});
      await send('Emulation.setCPUThrottlingRate', { rate: THROTTLE });
      const res = {};
      for (const kind of ['cold', 'warm']) {
        if (kind === 'warm' && flag('boot-prof')) { await send('Profiler.enable'); await send('Profiler.setSamplingInterval', { interval: 1000 }); await send('Profiler.start'); }
        const done = await launch();
        let prof = null;
        if (kind === 'warm' && flag('boot-prof')) prof = (await send('Profiler.stop')).result.profile;
        const rows = await ev('window.__blAll');
        await send('Emulation.setCPUThrottlingRate', { rate: 1 });
        await sleep(2500);   // let the cache's IndexedDB commit land
        const r = { firstFrameS: +(done / 1000).toFixed(1), heapMB: await heap(), gpu: await ev('window.__glMem.read()'),
          programs: await ev('window.__dbg.renderer.info.programs.length'),
          extraMs: await ev('window.__dbg.lmRoot && window.__dbg.lmRoot.userData.extraMs || null'),
          memo: await ev('window.__dbg.memoStats ? window.__dbg.memoStats.hit + "/" + (window.__dbg.memoStats.hit + window.__dbg.memoStats.miss) : "-"'),
          steps: bootSteps(rows, done) };
        if (prof) r.profile = profileTop(prof, TOP);
        if (BOOT_PROBE) { r.probe = await ev(BOOT_PROBE); console.log(`  probe (${kind}): ${typeof r.probe === 'string' ? r.probe : JSON.stringify(r.probe)}`); }
        await send('Emulation.setCPUThrottlingRate', { rate: THROTTLE });
        res[kind] = r;
        console.log(`\n[boot ${kind}] first frame ${r.firstFrameS} s  heap ${r.heapMB} MB  GPU ${r.gpu.totalMB} MB (buffers ${r.gpu.bufMB}, textures ${r.gpu.texMB}, targets ${r.gpu.rbMB})  programs ${r.programs}  memo ${r.memo}`);
        for (const s of [...r.steps].sort((a, b) => b.ms - a.ms).slice(0, 14)) console.log(`  ${String(s.ms).padStart(6)} ms  @${s.t}s  ${s.m}`);
        if (r.extraMs) console.log('  landmark extras (build ms, road-test ms, solids): ' + Object.entries(r.extraMs).sort((a, b) => b[1][0] + b[1][1] - a[1][0] - a[1][1]).slice(0, 12).map(([k, v]) => `${k} ${v.join('/')}`).join('  '));
        if (r.profile) {
          console.log('  hottest (self ms):'); for (const t of r.profile.self) console.log(`    ${String(t.ms).padStart(6)}  ${String(t.pct).padStart(5)}%  ${t.fn}`);
          console.log('  inclusive (ms):'); for (const t of r.profile.incl) console.log(`    ${String(t.ms).padStart(6)}  ${String(t.pct).padStart(5)}%  ${t.fn}`);
        }
      }
      res.exceptions = errs.length;
      if (errs.length) console.log('  exceptions: ' + errs.slice(0, 3).join(' | '));
      return res;
    });
  }
  if (!flag('no-views')) {
    await session(async ({ send, ev, errs, heap, launch }) => {
      await launch();
      await assertRenderer(ev, console.log, true);
      for (let i = 0; i < 120; i++) { if (await ev('window.__dbg.traffic.cars.length > 0')) break; await sleep(500); }
      await ev(`(() => { const d = window.__dbg; d.applyQuality('high', true);
        for (const k of ['pad','stickZone','lookZone','rotate']) { const e = document.getElementById(k); if (e) e.style.display = 'none'; } })()`);
      await ev(`(${pageInstall.toString()})()`);
      // --pre='<js>': evaluated once before the views (switch something off for an A/B in one build)
      if (flag('census')) await ev('window.__pa.wantCensus = true');
      if (arg('pre', '')) console.log('  pre: ' + JSON.stringify(await ev(arg('pre', ''))));
      out.bootHeapMB = await heap();
      for (const v of VIEWS) {
        await send('Emulation.setCPUThrottlingRate', { rate: 1 });
        const st = await ev(`window.__pa.setup(${JSON.stringify(v)})`);
        if (st.error) { console.log(`\n[${v}] ${st.error}`); out.views[v] = st; continue; }
        await send('Emulation.setCPUThrottlingRate', { rate: THROTTLE });
        if (flag('view-prof')) { await send('Profiler.enable'); await send('Profiler.setSamplingInterval', { interval: 500 }); await send('Profiler.start'); }
        const T = await ev(`window.__pa.time(${SECS})`);
        if (flag('view-prof')) {
          const prof = (await send('Profiler.stop')).result.profile;
          T.profile = profileTop(prof, TOP);
          // --prof-out=DIR: the raw profile too (DevTools opens .cpuprofile;
          // tools/kw/profsub.mjs breaks one function's subtree down)
          if (arg('prof-out', '')) { mkdirSync(arg('prof-out', ''), { recursive: true }); writeFileSync(`${arg('prof-out', '')}/${v}.cpuprofile`, JSON.stringify(prof)); }
        }
        await send('Emulation.setCPUThrottlingRate', { rate: 1 });
        if (SHOTS) {
          const { result } = await send('Page.captureScreenshot', { format: 'jpeg', quality: 70 });
          mkdirSync(SHOTS, { recursive: true });
          writeFileSync(`${SHOTS}/${v}.jpg`, Buffer.from(result.data, 'base64'));
        }
        T.heapMB = await heap();
        T.setup = st;
        out.views[v] = T;
        const sys = Object.entries(T.sys).sort((a, b) => b[1] - a[1]).map(([k, x]) => `${k} ${x}`).join('  ');
        console.log(`\n[${v}] ${st.route ? 'route ' + st.route + ' m, ' : ''}${st.at ? 'at ' + st.at + ', ' : ''}moved ${T.moved} m, resets ${T.resets}; ${T.cars} cars, ${T.peds} peds`);
        console.log(`  frame CPU mean ${T.cpuMean}  median ${T.cpuMed}  p90 ${T.cpu90}  p99 ${T.cpu99} ms  (${T.n} frames in ${T.secs} s)`);
        console.log(`  draws ${T.draws}  tris ${T.trisK}k  shadow-pass draws ${T.shadowDraws}  programs ${T.programs}`);
        console.log(`  by system (ms/frame; render includes shadow): ${sys}`);
        if (T.scene) {
          const C = T.scene;
          console.log(`  scene census: ${C.visited} objects visited, ${C.tested} meshes frustum-tested (${C.passed} pass, ${C.culled} culled), ${C.untested} untested`);
          for (const g of C.top) console.log(`    ${String(g.tested - g.passed).padStart(5)} culled ${String(g.passed).padStart(4)} drawn ${String(g.untested).padStart(4)} untested ${String(g.visited).padStart(6)} visited  ${g.k}`);
        }
        if (T.profile) {
          const pf = (l) => l.map((t) => `    ${(t.ms / T.n).toFixed(2).padStart(6)}  ${String(t.pct).padStart(5)}%  ${t.fn}`).join('\n');
          console.log('  hottest (self ms/frame):\n' + pf(T.profile.self));
          console.log('  inclusive (ms/frame):\n' + pf(T.profile.incl));
        }
        console.log(`  heap ${T.heapMB} MB  GPU ${T.gpu.totalMB} MB (buffers ${T.gpu.bufMB}, textures ${T.gpu.texMB}, peak ${T.gpu.peakMB})`);
      }
      out.viewExceptions = errs.length;
      if (errs.length) { console.log(`\n${errs.length} exception(s): ` + errs.slice(0, 3).join(' | ')); code = 1; }
    });
  }
  if (JSON_OUT) writeFileSync(JSON_OUT, JSON.stringify(out, null, 1));
} catch (e) {
  console.log('ERROR', e.message);
  code = 2;
}
process.exit(code);
