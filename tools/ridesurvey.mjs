// Ride survey: how bumpy is every road in the city, measured the way a car
// feels it. A fixed-dt, paused-game ride along road chains of every class.
//
//   node tools/ridesurvey.mjs [--tag NAME] [--top N] [--cls a,b] [--max-km K]
//
// The game is paused and nothing is driven: a rider moves along each chain's
// centreline at a fixed speed per class (hwy 28, ramp 18, art 15, st 12,
// res 10 m/s) at dt = 1/60, and its height follows the ground EXACTLY the way
// Vehicle.update's vertical follow does -- four wheel samples (a sedan's
// 2.3 m half-length, 0.95 m half-width) through `city.groundAt` from the
// wheels (y + 0.45) with the centre's `roadLift`, averaged, the bore spike
// guard, an 18/s follow (fed forward with a steady descent) and the 22 m/s^2
// fall over a crest. Vertical acceleration is the second difference of that
// height. It is a REPLICA of the follow's arithmetic only: the real update
// also has collisions, ramps, lowDetail, a wheel-sample reference of its own
// and the car's real speed, and on hwy / ramp chains its air counts differ from
// the real Vehicle.update (graded ramps: 611 here, 42 there, measured with a
// checker that ran the real thing) -- trust it for acc30 / acc60 and the site
// ranking, tools/hillride.mjs for the real vehicle. If vehicles.js changes how
// a car follows the ground, change `ride()` below with it.
//
// A chain is the straightest same-class continuation through each node
// (within 45 deg), never through a tunnel; every non-tunnel edge is in exactly
// one chain. A rider is SEEDED ON THE EDGE'S OWN SURFACE ("A walker needs a
// seed", CLAUDE.md): its graded profile, its deck, or terrain + lift.
//
// Three measures, each per chain, per surface kind and per 60 m site:
//   acc30 / acc60   frames whose vertical acceleration is over 30 / 60 m/s^2
//                   (the first ~10 frames of a chain are a run-in, not counted)
//   hump            the ground under the centre, every metre: a crest that
//                   rises AND falls by more than 1 m within 30 m on each side
//                   (or a dip that falls and climbs back): "up and down"
//   break5 / break8 3 m steps whose grade changes by more than 5 % / 8 %
//   jump            frames where the averaged wheel ground moved over 0.5 m
//                   (a different surface took the car: a deck capture)
//
// Sites are ranked by score = acc30 + 4 acc60 + 10 x (hump metres over 1 m) +
// 25 x jumps, and printed worst first with the road's name and class; the
// whole record (per class, per chain, every site) goes to
// tools/data/ridesurvey-<tag>.json for a before/after.
//
// RIDE_PROBE='<expr>' evaluates an expression after the survey (same boot).
//
// Usage:  python3 -m http.server 8000; node tools/ridesurvey.mjs --tag base
import { launchChrome, GPU } from './chrome.mjs';
import { writeFileSync, mkdirSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';

const args = process.argv.slice(2);
function argVal(k) { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : undefined; }
const TAG = argVal('--tag') || 'run';
const TOP = +(argVal('--top') || 30);
const ONLY_CLS = argVal('--cls') || '';
const MAX_KM = +(argVal('--max-km') || 0);
// --legacy: the vertical follow as it was before v201 (a fall always started
// from vy = 0, so a steady 20 %+ descent hopped: air, land, lerp, air). The
// default is what vehicles.js does now; --legacy is for before/after.
const LEGACY = args.includes('--legacy');
const NOFF = args.includes('--noff');   // experiment: no feed-forward
// --at x,z[;x,z...]  trace every chain passing within 25 m of each point:
// one row per ~3 m, +-RANGE m around the point (--range, default 150)
const AT = argVal('--at') ? argVal('--at').split(';').map((p) => p.split(',').map(Number)) : null;
const RANGE = +(argVal('--range') || 150);
// --shots DIR (with --at): per point, a driver's eye and a raised view along
// the road, after the chunks there have streamed in. Names from
// --names a,b,...; AUTO_GPU=1 for the Mac's GPU (see tools/chrome.mjs).
const SHOTS = argVal('--shots');
const NAMES = (argVal('--names') || '').split(',');

// Pose the camera on (x, z)'s nearest drivable edge, looking along it.
const POSE = (x, z, view) => `(() => {
  const d = window.__dbg, c = d.city, w = d.world;
  const pending = () => [...w.chunks.values()].filter((k) => k.lod !== k.wantLod).length;
  for (let i = 0; i < 20000 && (i === 0 || pending() > 0); i++) w.update(${x}, ${z}, 9);
  let best = null, bd = 1e9;
  for (const ei of c.edgesNear(${x}, ${z}, 40)) {
    const e = c.edges[ei];
    if (e.tunnel) continue;
    const a = c.nodes[e.a];
    const t = Math.max(0, Math.min(1, ((${x} - a.x) * e.dx + (${z} - a.z) * e.dz) / e.len));
    const dd = Math.hypot(${x} - a.x - e.dx * e.len * t, ${z} - a.z - e.dz * e.len * t);
    if (dd < bd) { bd = dd; best = e; }
  }
  const ux = best ? best.dx : 1, uz = best ? best.dz : 0;
  const gy = c.groundAt(${x}, ${z}, null);
  const cam = d.camera;
  cam.up.set(0, 1, 0);
  // both look ALONG the road at the point: 'eye' from 2 m over the
  // carriageway 45 m back, 'raised' from 12 m up 80 m back
  const back = ${JSON.stringify(view)} === 'eye' ? 45 : 80, up = ${JSON.stringify(view)} === 'eye' ? 2 : 12;
  const px = ${x} - ux * back, pz = ${z} - uz * back;
  cam.position.set(px, c.groundAt(px, pz, null) + up, pz);
  cam.lookAt(${x}, gy + 1, ${z});
  d.sun.position.set(${x} - 150, gy + 230, ${z} - 110);
  d.sun.target.position.set(${x}, gy, ${z}); d.sun.target.updateMatrixWorld();
  cam.updateMatrixWorld(true);
  d.scene.updateMatrixWorld(true);
  return true;
})()`;
const HTTP_PORT = process.env.AUTO_HTTP_PORT || 8000;
const PORT = +process.env.AUTO_CDP_PORT || 9251;

// ---- page side --------------------------------------------------------------
function survey(opts) {
  const d = window.__dbg, c = d.city, G = d.G;
  d.game.paused = true;
  const SPEED = { hwy: 28, ramp: 18, art: 15, st: 12, res: 10 };
  const DT = 1 / 60, HALF_LEN = 2.3, HALF_WID = 0.95, REF = 0.45;
  const SITE = 60;
  const onlyCls = opts.onlyCls ? opts.onlyCls.split(',') : null;
  const kindOf = (e) => e.cls + (e.elev ? '-deck' : e.prof ? '-graded' : '');

  // --- chains ---
  const used = new Uint8Array(c.edges.length);
  const ok = (e) => !e.tunnel && e.len > 0.5 && SPEED[e.cls] && (!onlyCls || onlyCls.includes(e.cls));
  const chains = [];
  const extend = (ei, ni, out) => {
    // walk from edge ei out of node ni, appending [edge, fromNode]
    for (let guard = 0; guard < 400; guard++) {
      const e = c.edges[ei];
      const n = c.nodes[ni];
      const ix = ni === e.b ? e.dx : -e.dx, iz = ni === e.b ? e.dz : -e.dz;
      let best = -1, bc = Math.cos(Math.PI / 4);
      for (const oi of n.e) {
        if (used[oi] || oi === ei) continue;
        const o = c.edges[oi];
        if (!ok(o) || o.cls !== e.cls) continue;
        const ox = ni === o.a ? o.dx : -o.dx, oz = ni === o.a ? o.dz : -o.dz;
        const cc = ix * ox + iz * oz;
        if (cc > bc) { bc = cc; best = oi; }
      }
      if (best < 0) return;
      used[best] = 1;
      out.push([best, ni]);
      const o = c.edges[best];
      ei = best; ni = o.a === ni ? o.b : o.a;
    }
  };
  // Longest edges first, so a chain starts mid-road rather than at a stub.
  const order = c.edges.map((e, i) => i).filter((i) => ok(c.edges[i]))
    .sort((p, q) => c.edges[q].len - c.edges[p].len);
  for (const ei of order) {
    if (used[ei]) continue;
    used[ei] = 1;
    const e = c.edges[ei];
    const fwd = [], back = [];
    extend(ei, e.b, fwd);
    extend(ei, e.a, back);
    // back is walked away from e.a: reverse it into travel order
    const seq = [];
    for (let k = back.length - 1; k >= 0; k--) {
      const [bi, from] = back[k];
      const o = c.edges[bi];
      seq.push([bi, o.a === from ? o.b : o.a]);
    }
    seq.push([ei, e.a]);
    for (const s of fwd) seq.push(s);
    chains.push(seq);
  }

  // --- the rider ---
  const surfaceSeed = (e, from) => {
    const a = c.nodes[from];
    const atA = from === e.a;
    if (e.ph) return e.ph[atA ? 0 : e.pk];
    if (e.elev) return a.y + 0.09;
    return G.terrainHeight(a.x, a.z) + c.roadLift(a.x, a.z);
  };
  const sites = new Map();
  const site = (x, z) => {
    const k = Math.round(x / SITE) + ',' + Math.round(z / SITE);
    let s = sites.get(k);
    if (!s) sites.set(k, (s = { x: Math.round(x / SITE) * SITE, z: Math.round(z / SITE) * SITE,
      acc30: 0, acc60: 0, maxAcc: 0, hump: 0, humpM: 0, maxHump: 0, break8: 0, jump: 0, names: {}, kinds: {} }));
    return s;
  };
  const tagSite = (s, e) => {
    const nm = (e.name || '(unnamed)') + ' [' + kindOf(e) + ']';
    s.names[nm] = (s.names[nm] || 0) + 1;
    s.kinds[kindOf(e)] = (s.kinds[kindOf(e)] || 0) + 1;
  };
  const byKind = {};
  const kind = (k) => byKind[k] || (byKind[k] = { km: 0, frames: 0, acc30: 0, acc60: 0, humps: 0, humpM: 0, steps: 0, break5: 0, break8: 0, jump: 0, air: 0 });
  const chainOut = [];
  let totalM = 0;
  const traces = [];
  const nearAt = (P) => {
    if (!opts.at) return null;
    for (const [ax, az] of opts.at) {
      let bd = Infinity, bs = 0;
      for (let i = 1; i < P.length; i++) {
        const p = P[i - 1], q = P[i], L = q.s - p.s || 1;
        const t = Math.max(0, Math.min(1, ((ax - p.x) * (q.x - p.x) + (az - p.z) * (q.z - p.z)) / (L * L)));
        const dd = Math.hypot(ax - p.x - (q.x - p.x) * t, az - p.z - (q.z - p.z) * t);
        if (dd < bd) { bd = dd; bs = p.s + L * t; }
      }
      if (bd < 25) return { at: [ax, az], s: bs, d: bd };
    }
    return null;
  };

  for (const seq of chains) {
    // polyline in travel order
    const P = [];
    let len = 0;
    for (const [ei, from] of seq) {
      const e = c.edges[ei];
      const a = c.nodes[from], b = c.nodes[from === e.a ? e.b : e.a];
      if (!P.length) P.push({ x: a.x, z: a.z, s: 0, ei });
      len += e.len;
      P.push({ x: b.x, z: b.z, s: len, ei });
    }
    if (len < 40) continue;
    const near = nearAt(P);
    if (opts.at && !near) continue;
    const rows = near ? [] : null;
    if (opts.maxKm && totalM > opts.maxKm * 1000) break;
    totalM += len;
    const e0 = c.edges[seq[0][0]];
    const sp = SPEED[e0.cls];
    const step = sp * DT;
    let seg = 1;
    const at = (s) => {
      while (seg < P.length - 1 && P[seg].s < s) seg++;
      while (seg > 1 && P[seg - 1].s > s) seg--;
      const p = P[seg - 1], q = P[seg];
      const L = q.s - p.s || 1, t = Math.min(1, Math.max(0, (s - p.s) / L));
      return { x: p.x + (q.x - p.x) * t, z: p.z + (q.z - p.z) * t, fx: (q.x - p.x) / L, fz: (q.z - p.z) / L, ei: q.ei };
    };
    let y = surfaceSeed(e0, seq[0][1]), vy = 0, onGround = true;
    let carVy = 0, floorVy = 0, floorOk = false;
    let yPrev = y, vPrev = 0, tPrev = null;
    const ch = { cls: e0.cls, name: e0.name || '', len: Math.round(len), x0: Math.round(P[0].x), z0: Math.round(P[0].z),
      acc30: 0, acc60: 0, maxAcc: 0, maxAt: null, humps: 0, maxHump: 0, humpAt: null, break8: 0, jump: 0 };
    const prof = [];        // centre ground every frame: [s, y, ei]
    let frame = 0;
    for (let s = 0; s <= len; s += step, frame++) {
      const p = at(s), e = c.edges[p.ei];
      const lift = c.roadLift(p.x, p.z);
      const gAt = (ox, oz) => c.groundAt(p.x + ox, p.z + oz, y + REF, lift);
      const rx = p.fz, rz = -p.fx;
      const fh = gAt(p.fx * HALF_LEN, p.fz * HALF_LEN), bh = gAt(-p.fx * HALF_LEN, -p.fz * HALF_LEN);
      const lh = gAt(rx * HALF_WID, rz * HALF_WID), rh = gAt(-rx * HALF_WID, -rz * HALF_WID);
      let target = (fh + bh + lh + rh) / 4;
      if (target - y > 3 && G.terrainRaw(p.x, p.z) - y > 2.5) target = y;
      const cg = c.groundAt(p.x, p.z, y + REF, lift);
      prof.push(s, cg, p.ei);
      // Vehicle.update's vertical follow (no stunt ramps), v201: the floor's
      // steady descent is fed forward and a fall leaves with it (see "THE
      // GROUND'S OWN DESCENT IS NOT A FALL" in vehicles.js)
      const dT = tPrev === null ? 0 : target - tPrev;
      const slope = !opts.legacy && tPrev !== null && Math.abs(dT) < 0.25;
      let ffVy = 0;
      if (slope) {
        const raw = dT / DT;
        const before = floorOk ? floorVy : Math.max(-20, Math.min(0, raw));
        floorVy = floorOk ? before + (raw - before) * (1 - Math.exp(-DT / 0.12)) : before;
        ffVy = opts.noff ? 0 : Math.min(0, floorVy + 1.5) * Math.max(0, Math.min(1, (3 - Math.abs(raw - before)) / 2));
      } else floorVy = 0;
      floorOk = slope;
      let landed = false;
      if (y > target + 0.25) {
        if (onGround && vy <= 0 && !opts.legacy) vy = carVy;
        vy -= 22 * DT; y += vy * DT; onGround = false;
        if (y <= target) { y = target; vy = 0; onGround = true; landed = true; }
      } else {
        const rise = target - y;
        if (rise > 0.6 && sp > 6) vy = Math.min(6, rise * 4);
        y = (y + ffVy * DT) + (target - (y + ffVy * DT)) * (1 - Math.exp(-18 * DT));
        onGround = true;
      }
      carVy = onGround ? ffVy : vy;
      const K = kind(kindOf(e));
      K.frames++;
      if (!onGround) K.air++;
      const v = (y - yPrev) / DT;
      if (frame >= 2) {
        const acc = (v - vPrev) / DT;
        if (frame > 10) {
          const aa = Math.abs(acc);
          if (aa > ch.maxAcc) { ch.maxAcc = aa; ch.maxAt = [Math.round(p.x), Math.round(p.z)]; }
          if (aa > 30) {
            const st = site(p.x, p.z);
            ch.acc30++; K.acc30++; st.acc30++; tagSite(st, e);
            if (aa > 60) { ch.acc60++; K.acc60++; st.acc60++; }
            if (aa > st.maxAcc) st.maxAcc = aa;
          }
          if (tPrev !== null && Math.abs(target - tPrev) > 0.5) {
            const st = site(p.x, p.z);
            ch.jump++; K.jump++; st.jump++; tagSite(st, e);
          }
        }
      }
      if (rows && Math.abs(s - near.s) <= opts.range && frame % Math.max(1, Math.round(3 / step)) === 0) {
        const acc = frame >= 2 ? (v - vPrev) / DT : 0;
        rows.push([Math.round(s - near.s), Math.round(p.x), Math.round(p.z), p.ei, kindOf(e), +G.terrainHeight(p.x, p.z).toFixed(2),
          +lift.toFixed(2), +cg.toFixed(2), +target.toFixed(2), +y.toFixed(2), Math.round(acc), onGround ? '' : 'AIR']);
      }
      vPrev = v; yPrev = y; tPrev = target;
    }
    if (rows) { traces.push({ at: near.at, d: +near.d.toFixed(1), cls: e0.cls, name: e0.name || '', len: Math.round(len), rows }); continue; }
    // --- the profile: grade breaks on 3 m steps, humps on 1 m ---
    // resample prof (s, y) at 1 m
    const ys = [], es = [];
    {
      let j = 0;
      for (let s = 0; s <= len; s += 1) {
        while (j < prof.length / 3 - 2 && prof[(j + 1) * 3] < s) j++;
        const s0 = prof[j * 3], s1 = prof[(j + 1) * 3];
        const t = s1 > s0 ? Math.min(1, Math.max(0, (s - s0) / (s1 - s0))) : 0;
        ys.push(prof[j * 3 + 1] + (prof[(j + 1) * 3 + 1] - prof[j * 3 + 1]) * t);
        es.push(prof[j * 3 + 2]);
      }
    }
    const n = ys.length;
    for (let i = 6; i < n; i += 3) {
      const e = c.edges[es[i]];
      const K = kind(kindOf(e));
      const d0 = ys[i - 3] - ys[i - 6], d1 = ys[i] - ys[i - 3];
      if (Math.abs(d0) > 0.5 || Math.abs(d1) > 0.5) continue;    // a jump, counted above
      K.steps++;
      const dg = Math.abs(d1 - d0) / 3;
      if (dg > 0.05) K.break5++;
      if (dg > 0.08) {
        K.break8++; ch.break8++;
        const pt = at(i - 3); const st = site(pt.x, pt.z); st.break8++;
      }
    }
    // humps: prominence of a crest/dip against both sides within 30 m
    const W = 30;
    const loL = new Float64Array(n), loR = new Float64Array(n), hiL = new Float64Array(n), hiR = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      let mn = Infinity, mx = -Infinity;
      for (let j = Math.max(0, i - W); j <= i; j++) { if (ys[j] < mn) mn = ys[j]; if (ys[j] > mx) mx = ys[j]; }
      loL[i] = mn; hiL[i] = mx;
      mn = Infinity; mx = -Infinity;
      for (let j = i; j <= Math.min(n - 1, i + W); j++) { if (ys[j] < mn) mn = ys[j]; if (ys[j] > mx) mx = ys[j]; }
      loR[i] = mn; hiR[i] = mx;
    }
    // A run of points over the threshold is one hump: report its peak.
    let run = null;
    const flush = () => {
      if (!run) return;
      const pt = at(run.i), e = c.edges[es[run.i]];
      const K = kind(kindOf(e));
      K.humps++; K.humpM += run.prom;
      ch.humps++;
      if (run.prom > ch.maxHump) { ch.maxHump = +run.prom.toFixed(2); ch.humpAt = [Math.round(pt.x), Math.round(pt.z), run.crest ? 'crest' : 'dip']; }
      const st = site(pt.x, pt.z);
      st.hump++; st.humpM += run.prom; if (run.prom > st.maxHump) st.maxHump = run.prom;
      tagSite(st, e);
      run = null;
    };
    for (let i = W; i < n - W; i++) {
      // ignore anything a jump explains
      const crest = Math.min(ys[i] - loL[i], ys[i] - loR[i]);
      const dip = Math.min(hiL[i] - ys[i], hiR[i] - ys[i]);
      const prom = Math.max(crest, dip);
      if (prom > 1.0) {
        if (!run || i - run.last > 1) { flush(); run = { i, prom, last: i, crest: crest >= dip }; }
        else { run.last = i; if (prom > run.prom) { run.prom = prom; run.i = i; run.crest = crest >= dip; } }
      } else if (run && i - run.last > 1) flush();
    }
    flush();
    if (ch.acc30 || ch.humps || ch.jump || ch.break8) {
      ch.maxAcc = +ch.maxAcc.toFixed(1);
      chainOut.push(ch);
    }
    for (const [ei] of seq) kind(kindOf(c.edges[ei])).km += c.edges[ei].len / 1000;
  }

  if (opts.at) return JSON.stringify({ traces });
  const siteList = [...sites.values()].map((s) => {
    s.humpM = +s.humpM.toFixed(2); s.maxHump = +s.maxHump.toFixed(2); s.maxAcc = +s.maxAcc.toFixed(1);
    s.score = +(s.acc30 + 4 * s.acc60 + 10 * s.humpM + 25 * s.jump).toFixed(1);
    s.road = Object.entries(s.names).sort((p, q) => q[1] - p[1]).slice(0, 2).map((r) => r[0]).join(' / ');
    s.kind = Object.entries(s.kinds).sort((p, q) => q[1] - p[1])[0]?.[0] || '';
    delete s.names; delete s.kinds;
    return s;
  }).filter((s) => s.score > 0).sort((p, q) => q.score - p.score);
  for (const k in byKind) byKind[k].km = +byKind[k].km.toFixed(1), byKind[k].humpM = +byKind[k].humpM.toFixed(1);
  chainOut.sort((p, q) => (q.acc30 + 4 * q.acc60 + 10 * q.maxHump) - (p.acc30 + 4 * p.acc60 + 10 * p.maxHump));
  return JSON.stringify({ chains: chains.length, km: +(totalM / 1000).toFixed(1), byKind, sites: siteList, worstChains: chainOut.slice(0, 200) });
}

// ---- node side --------------------------------------------------------------
async function main() {
  const chrome = launchChrome({ port: PORT, profile: `/tmp/auto-ridesurvey-${PORT}`, width: SHOTS ? 960 : 640, height: SHOTS ? 540 : 400 });
  try {
    let page;
    for (let i = 0; i < 90 && !page; i++) {
      try { page = (await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()).find((t) => t.type === 'page'); } catch { /* not up */ }
      if (!page) await sleep(300);
    }
    const ws = new WebSocket(page.webSocketDebuggerUrl);
    await new Promise((r, j) => { ws.addEventListener('open', r); ws.addEventListener('error', j); });
    let id = 0; const pend = new Map(); const errors = [];
    ws.addEventListener('message', (ev) => {
      const m = JSON.parse(ev.data);
      if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); }
      else if (m.method === 'Runtime.exceptionThrown') errors.push(m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text);
    });
    const send = (method, params = {}) => new Promise((res) => { ws.send(JSON.stringify({ id: ++id, method, params })); pend.set(id, res); });
    const evaluate = async (e) => {
      const r = await send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true });
      if (r.result?.exceptionDetails) throw new Error(r.result.exceptionDetails.exception?.description);
      return r.result?.result?.value;
    };
    await send('Runtime.enable'); await send('Page.enable'); await send('Network.enable');
    // Never through the service worker or the disk cache; a fresh profile also
    // means no boot cache (src/bootcache.js), so the city is always computed.
    await send('Network.setBypassServiceWorker', { bypass: true });
    await send('Network.setCacheDisabled', { cacheDisabled: true });
    await send('Page.addScriptToEvaluateOnNewDocument', { source: 'window.__noAutoQuality = true;'
      // RIDE_PROFDEBUG=1: gradeRoads publishes its per-sample intermediates (e.pdbg)
      + (process.env.RIDE_PROFDEBUG ? ' globalThis.__profDebug = true;' : '') });
    const t0 = Date.now();
    await send('Page.navigate', { url: `http://localhost:${HTTP_PORT}/apps/auto/` });
    for (let i = 0; i < 600; i++) { await sleep(500); if (await evaluate('!!(window.__dbg && window.__dbg.city)')) break; }
    console.log(`booted in ${((Date.now() - t0) / 1000).toFixed(0)} s`);
    const t1 = Date.now();
    const res = JSON.parse(await evaluate(`(${survey.toString()})(${JSON.stringify({ onlyCls: ONLY_CLS, maxKm: MAX_KM, at: AT, range: RANGE, legacy: LEGACY, noff: NOFF })})`));
    if (AT) {
      for (const t of res.traces) {
        console.log(`\n== near (${t.at}) ${t.d} m off: ${t.name || '(unnamed)'} [${t.cls}] chain ${t.len} m`);
        console.log('     s      x      z   edge kind           terr  lift  ground  target   car   acc');
        for (const r of t.rows) {
          console.log(`${String(r[0]).padStart(6)}${String(r[1]).padStart(7)}${String(r[2]).padStart(7)}${String(r[3]).padStart(7)} ${r[4].padEnd(13)}`
            + `${r[5].toFixed(2).padStart(7)}${r[6].toFixed(2).padStart(6)}${r[7].toFixed(2).padStart(8)}${r[8].toFixed(2).padStart(8)}${r[9].toFixed(2).padStart(8)}${String(r[10]).padStart(6)} ${r[11]}`);
        }
      }
      if (process.env.RIDE_PROBE) console.log(JSON.stringify(await evaluate(process.env.RIDE_PROBE), null, 2));
      if (SHOTS) {
        mkdirSync(SHOTS, { recursive: true });
        await evaluate(`(() => { for (const id of ['hud', 'pad', 'stickZone', 'lookZone', 'objective', 'toast', 'rotate', 'topBtns']) { const el = document.getElementById(id); if (el) el.style.display = 'none'; } return 1; })()`);
        for (let k = 0; k < AT.length; k++) {
          const [x, z] = AT[k];
          for (const view of ['eye', 'raised']) {
            await evaluate(POSE(x, z, view));
            await sleep(GPU ? 1500 : 8000);
            const r = await send('Page.captureScreenshot', { format: 'jpeg', quality: 72 });
            const f = `${SHOTS}/${NAMES[k] || x + '_' + z}-${view}.jpg`;
            writeFileSync(f, Buffer.from(r.result.data, 'base64'));
            console.log('wrote', f);
          }
        }
      }
      return;
    }
    console.log(`surveyed ${res.km} km in ${res.chains} chains in ${((Date.now() - t1) / 1000).toFixed(0)} s\n`);

    console.log('kind            km   frames  acc>30  acc>60 /1000fr  humps hump-m  brk>5%  brk>8%  jumps   air');
    const kinds = Object.keys(res.byKind).sort();
    const tot = { km: 0, frames: 0, acc30: 0, acc60: 0, humps: 0, humpM: 0, break5: 0, break8: 0, jump: 0, air: 0, steps: 0 };
    for (const k of kinds) {
      const r = res.byKind[k];
      for (const f in tot) tot[f] += r[f];
      console.log(`${k.padEnd(14)}${r.km.toFixed(0).padStart(5)}${String(r.frames).padStart(9)}${String(r.acc30).padStart(8)}${String(r.acc60).padStart(8)}`
        + `${(1000 * r.acc30 / Math.max(1, r.frames)).toFixed(2).padStart(8)}${String(r.humps).padStart(7)}${r.humpM.toFixed(0).padStart(7)}`
        + `${String(r.break5).padStart(8)}${String(r.break8).padStart(8)}${String(r.jump).padStart(7)}${String(r.air).padStart(6)}`);
    }
    console.log(`${'TOTAL'.padEnd(14)}${tot.km.toFixed(0).padStart(5)}${String(tot.frames).padStart(9)}${String(tot.acc30).padStart(8)}${String(tot.acc60).padStart(8)}`
      + `${(1000 * tot.acc30 / Math.max(1, tot.frames)).toFixed(2).padStart(8)}${String(tot.humps).padStart(7)}${tot.humpM.toFixed(0).padStart(7)}`
      + `${String(tot.break5).padStart(8)}${String(tot.break8).padStart(8)}${String(tot.jump).padStart(7)}${String(tot.air).padStart(6)}`);

    console.log(`\nworst ${TOP} sites (60 m cells; score = acc30 + 4 acc60 + 10 hump-m + 25 jumps)`);
    console.log('  score      x      z  acc30 acc60 maxAcc humps maxHump brk8 jumps  road');
    for (const s of res.sites.slice(0, TOP)) {
      console.log(`${s.score.toFixed(0).padStart(7)}${String(s.x).padStart(7)}${String(s.z).padStart(7)}${String(s.acc30).padStart(7)}${String(s.acc60).padStart(6)}`
        + `${s.maxAcc.toFixed(0).padStart(7)}${String(s.hump).padStart(6)}${s.maxHump.toFixed(2).padStart(8)}${String(s.break8).padStart(5)}${String(s.jump).padStart(6)}  ${s.road}`);
    }
    console.log(`\nRIDE ${TAG}: ${tot.km.toFixed(0)} km, acc>30 ${tot.acc30}, acc>60 ${tot.acc60}, humps ${tot.humps} (${tot.humpM.toFixed(0)} m), `
      + `breaks>8% ${tot.break8} of ${tot.steps}, jumps ${tot.jump}, sites ${res.sites.length}`);
    mkdirSync('tools/data', { recursive: true });
    const out = `tools/data/ridesurvey-${TAG}.json`;
    writeFileSync(out, JSON.stringify(res, null, 1));
    console.log(`wrote ${out}`);
    if (process.env.RIDE_PROBE) {
      console.log('\n--- probe ---');
      console.log(JSON.stringify(await evaluate(process.env.RIDE_PROBE), null, 2));
    }
    if (errors.length) { console.log('\nexceptions:\n' + errors.slice(0, 5).join('\n')); process.exitCode = 1; }
  } finally {
    chrome.kill('SIGKILL');
  }
}

main().catch((e) => { console.error('ridesurvey failed:', e.message); process.exitCode = 1; });
