// Does traffic drive WITH the flow? A fixed-dt, paused-game traffic sampler.
//
// The game is paused and the harness calls traffic.update itself at dt = 1/60
// in batches inside one evaluate, with the player parked at each of a set of
// sites across the city (downtown's one-way grid, I-5 and its express lanes,
// the SR-99 south portal, Capitol Hill, a residential grid, Northgate). At each
// site traffic is cleared, refilled for WARM seconds and then measured for
// MEASURE seconds; the last site runs a police pursuit (wanted 3).
//
// It measures the car, not the car's bookkeeping, so the same numbers mean the
// same thing on a build that has never heard of one-way streets: see H.judge.
// A car is AGAINST only when it is on a one-way carriageway and no carriageway
// under it allows its heading. Results are deterministic (fixed dt, seeded
// RNG), so a before/after on two builds is a like-for-like comparison.
//
//   against*     share of moving driven-car samples (traffic + police judged
//                separately) against an edge's allowed way. `Flags` reads only
//                F_ONEWAY / F_ONEWAY_REV; `Exp` also counts I-5's reversible
//                express lanes, which the importer leaves untagged (see
//                edgeFlow in traffic.js), as their drawn direction. `Fwy` is
//                the freeway/ramp share.
//   opp*PerMin   driven cars facing each other touching: `Wrongway` when one
//                is against a one-way, `Twoway` legal oncoming grazes, `Police`
//                a unit involved. headOn: of those, same lane (< 2 m across).
//   contacts     every new car-to-car contact event (one per pair until it has
//                been clear for 1 s), per minute, and by kind
//   parkedKnocked  parked cars shoved off the kerb, per minute
//   stuck        traffic cars under 0.5 m/s for 20 s straight (stuckAt says
//                where and what is ahead of them)
//   jam          most cars at once in one 25 m cluster all slow for 10 s+
//   near150      mean traffic cars within 150 m of the player; `all` = total
//
// Flags:  --dump FILE   edges and car samples at the downtown, I-5 and SR-99
//                       sites, for the top-down diagnostic render
//         --shot DIR    two in-game shots (downtown 4th Ave, SR-99 south of
//                       the tunnel), each also saved -tagged with every moving
//                       AI car in view ringed green / red (with / against)
//         --sites a,b   only these sites ('none' = shots only)
//         --warm S / --measure S   seconds per site (default 20 / 60)
//
// Usage:  python3 -m http.server 8000; node tools/trafficcheck.mjs
// Prints one line per site and a summary line starting "TRAFFIC".
import { spawn } from 'node:child_process';
import { writeFileSync, mkdirSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';

const args = process.argv.slice(2);
function argVal(k) { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : undefined; }
const DUMP = argVal('--dump');
const SHOT = argVal('--shot');
const WARM = +(argVal('--warm') || 20);
const MEASURE = +(argVal('--measure') || 60);
const ONLY = argVal('--sites');
const HTTP_PORT = process.env.AUTO_HTTP_PORT || 8000;
const PORT = +process.env.AUTO_CDP_PORT || 9245;
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
if (SHOT) mkdirSync(SHOT, { recursive: true });

// ---- page side --------------------------------------------------------------
function pageInit() {
  const d = window.__dbg, c = d.city, p = d.player, T = d.traffic;
  // The harness's own reading of the flags, so it judges a build that does
  // not read them at all. +1 a->b, -1 b->a, 0 both.
  const flowFlags = (e) => (e.oneway ? (e.onewayRev ? -1 : 1) : 0);
  const flowExp = (e) => flowFlags(e) || ((e.cls === 'ramp'
    || (e.cls === 'hwy' && /Express|Ship Canal Bridge/.test(e.name || ''))) ? 1 : 0);
  const H = window.__tc = { sites: [], dump: {}, flowExp };

  // Is car v driving against the flow of the carriageway it is physically on?
  // Every carriageway under the car (inside its half-width, at its height,
  // within 60 deg of its heading) is a candidate, and the car is AGAINST only
  // if at least one is one-way and none of them allows its heading. That is
  // conservative on purpose: SR-99's twin tubes and I-5's carriageways overlap
  // for kilometres, and a car on one must not be scored against the other.
  // Returns 0 not on a road, 1 with the flow / two-way, -1 against.
  H.judge = (v, flowOf) => {
    const f = v.forward;
    let any = false, oneway = false, legal = false;
    for (const ei of c.edgesNear(v.x, v.z, 30)) {
      const e = c.edges[ei], a = c.nodes[e.a], b = c.nodes[e.b];
      const t = Math.max(0, Math.min(1, ((v.x - a.x) * e.dx + (v.z - a.z) * e.dz) / e.len));
      const qx = a.x + e.dx * e.len * t, qz = a.z + e.dz * e.len * t;
      if (Math.hypot(v.x - qx, v.z - qz) > e.hw + 0.5) continue;
      // A tunnel edge is matched in plan only: where SR-99's twin decks are
      // blended the car rides metres off its own edge's node heights, and the
      // height test scored cars in the southbound tube against the northbound
      // one. Any other edge must be at the car's height.
      const ey = a.y + (b.y - a.y) * t;
      if (!e.tunnel && Math.abs(v.y - ey) > 3) continue;
      const dot = e.dx * f.x + e.dz * f.z;
      if (Math.abs(dot) < 0.5) continue;
      any = true;
      const fl = flowOf(e);
      if (fl === 0 || dot * fl > 0) legal = true;
      else oneway = true;
    }
    return !any ? 0 : legal ? 1 : oneway ? -1 : 1;
  };
  H.onFwy = (v) => {
    for (const ei of c.edgesNear(v.x, v.z, 30)) {
      const e = c.edges[ei];
      if (e.cls !== 'hwy' && e.cls !== 'ramp') continue;
      const a = c.nodes[e.a];
      const t = Math.max(0, Math.min(1, ((v.x - a.x) * e.dx + (v.z - a.z) * e.dz) / e.len));
      if (Math.hypot(v.x - a.x - e.dx * e.len * t, v.z - a.z - e.dz * e.len * t) < e.hw + 0.5) return true;
    }
    return false;
  };
  H.pickSites = () => {
    const near = (x, z, test) => {
      let best = null, bd = 1e18;
      for (const ei of c.edgesNear(x, z, 400)) {
        const e = c.edges[ei];
        if (!test(e)) continue;
        const a = c.nodes[e.a];
        const dd = (a.x - x) ** 2 + (a.z - z) ** 2;
        if (dd < bd) { bd = dd; best = a; }
      }
      return best ? { x: best.x, z: best.z } : { x, z };
    };
    // SR-99's southbound exit portal, the way tunnelride.mjs finds it.
    let sr = { x: 0, z: 1900 };
    for (let ni = 0; ni < c.nodes.length; ni++) {
      const n = c.nodes[ni];
      if (n.z < 0) continue;
      const tun = n.e.filter((k) => c.edges[k].tunnel && !c.edges[k].elev && c.edges[k].cls === 'hwy' && /99/.test(c.edges[k].name || ''));
      const surf = n.e.filter((k) => !c.edges[k].tunnel && c.edges[k].cls === 'hwy');
      if (!tun.length || !surf.length) continue;
      const e = c.edges[tun[0]];
      const exit = e.oneway && (e.a === ni) === !!e.onewayRev;   // the flow comes OUT here
      if (exit) { sr = { x: n.x, z: n.z }; break; }
    }
    // Stand 60 m down the surface road from the portal, where the exit merges.
    return [
      { name: 'downtown', ...near(0, 0, (e) => e.oneway && e.cls !== 'res'), dump: true },
      { name: 'i5', ...near(620, -60, (e) => e.cls === 'hwy'), dump: true },
      { name: 'sr99s', x: sr.x, z: sr.z + 60, dump: true },
      { name: 'capitol', ...near(1700, -300, () => true) },
      { name: 'wallingford', ...near(-200, -4600, (e) => e.cls === 'res') },
      { name: 'northgate', ...near(1250, -7000, (e) => e.cls === 'hwy') },
      { name: 'pursuit', ...near(0, 0, (e) => e.oneway && e.cls !== 'res'), wanted: 3 },
    ];
  };
  H.begin = (site) => {
    for (const v of [...T.cars]) if (v.mode !== 'apron') T.remove(v);
    p.respawn(site.x, site.z);
    // Take the player out of the traffic picture: on foot and standing on the
    // road, every car in the lane stops for them and queues forever, which
    // would score the harness as a jam. With no vehicle and not on foot,
    // traffic neither brakes for nor collides with the player.
    p.onFoot = false; p.vehicle = null;
    d.game.wanted = site.wanted || 0;
    H.site = site; H.t = 0; H.frames = 0;
    H.m = { mov: 0, agF: 0, agE: 0, agHwyE: 0, movHwy: 0, polMov: 0, polAgE: 0, polAgFwy: 0,
      headOn: 0, knocked: 0, oppPolice: 0, oppWrongway: 0, oppTwoway: 0, contacts: 0, mt: 0, stuck: 0, jam: 0, near150: 0, all: 0, samples: 0, offRoad: 0 };
    H.pairs = new Map();
    H.stuckList = [];
    H.oppList = [];
    H.knocked = new Set();
    H.slow = new Map();
    H.stuckSeen = new Set();
    H.agAt = {};
    if (site.dump) {
      const edges = [];
      for (const ei of c.edgesNear(site.x, site.z, 260)) {
        const e = c.edges[ei], a = c.nodes[e.a], b = c.nodes[e.b];
        if (Math.hypot((a.x + b.x) / 2 - site.x, (a.z + b.z) / 2 - site.z) > 260) continue;
        edges.push([+a.x.toFixed(1), +a.z.toFixed(1), +b.x.toFixed(1), +b.z.toFixed(1), flowExp(e), +e.hw.toFixed(1), e.cls, e.tunnel ? 1 : 0, e.elev ? 1 : 0]);
      }
      H.dump[site.name] = { x: site.x, z: site.z, edges, cars: [] };
    }
    return JSON.stringify({ site: site.name, x: Math.round(site.x), z: Math.round(site.z), place: d.G.placeNameAt(site.x, site.z) });
  };
  H.stepN = (n, measure) => {
    const dt = 1 / 60, site = H.site, m = H.m;
    for (let i = 0; i < n; i++) {
      // rotate the notional camera slowly so "off-screen" spawn preference
      // covers every side over a run
      const ang = H.t * 0.2;
      T.update(dt, site.x, site.z, { x: Math.sin(ang), z: Math.cos(ang) }, p);
      H.t += dt; H.frames++;
      if (measure) m.mt += dt;
      if (H.frames % 10 === 0) d.world.update(site.x, site.z, 2);
      if (!measure) continue;
      const cars = T.cars.filter((v) => v.mode === 'traffic' || v.mode === 'police' || v.mode === 'free');
      // Contacts, every frame. A pair in contact is pushed apart and touches
      // again next frame, so a contact is one EVENT until the pair has been
      // clear for a second.
      for (let a = 0; a < cars.length; a++) for (let b = a + 1; b < cars.length; b++) {
        const A = cars[a], B = cars[b];
        if (Math.abs((A.y || 0) - (B.y || 0)) > 3) continue;
        const rr = A.radius + B.radius;
        if ((A.x - B.x) ** 2 + (A.z - B.z) ** 2 > rr * rr) continue;
        const key = A.id + ':' + B.id;
        const last = H.pairs.get(key);
        H.pairs.set(key, H.t);
        if (last !== undefined && H.t - last < 1) continue;
        m.contacts++;
        const fa = A.forward, fb = B.forward;
        {
          const dd = fa.x * fb.x + fa.z * fb.z;
          const k = (A.mode === 'police' && B.mode === 'police') ? 'cPolPol' : (A.mode === 'police' || B.mode === 'police') ? 'cPolice'
            : (A.mode === 'free' || B.mode === 'free') ? 'cFree' : dd > 0.7 ? 'cSame' : dd < -0.7 ? 'cOpp' : 'cCross';
          m[k] = (m[k] || 0) + 1;
        }
        if (fa.x * fb.x + fa.z * fb.z < -0.7 && Math.abs(A.vLong) > 2 && Math.abs(B.vLong) > 2
          && A.mode !== 'free' && B.mode !== 'free') {
          // OPPOSING: two driven cars, moving and facing each other, touch.
          //   wrong-way: one of them is against a one-way carriageway -- the
          //              SR-99 shunt
          //   two-way:   legal oncoming traffic grazing past (the collision
          //              circle is wider than a narrow street's lane split)
          //   police:    a unit is involved (they may cut against the flow)
          // headOn: the wrong-way / two-way ones with centres under 2 m
          // apart across A's heading, i.e. in the same lane.
          const lat = Math.abs((B.x - A.x) * fa.z - (B.z - A.z) * fa.x);
          const pol = A.mode === 'police' || B.mode === 'police';
          const ow = H.judge(A, flowExp) === -1 || H.judge(B, flowExp) === -1;
          if (pol) m.oppPolice++;
          else if (ow) m.oppWrongway++;
          else m.oppTwoway++;
          if (!pol && lat < 2) m.headOn++;
          if (H.oppList.length < 10) {
            const tag = (v) => ({ mode: v.mode, edge: v.edge, sign: v.dirSign, flow: T.flow && v.edge != null ? T.flow[v.edge] : null,
              cls: v.edge != null ? c.edges[v.edge].cls : null, spd: +v.vLong.toFixed(1), panic: +(v.panic || 0).toFixed(1) });
            H.oppList.push({ x: Math.round(A.x), z: Math.round(A.z), y: +A.y.toFixed(1), lat: +lat.toFixed(1), ow, A: tag(A), B: tag(B) });
          }
        }
      }
      // parked cars knocked off the kerb (resolveCarCollisions turns a
      // shoved parked car 'free'), counted once each
      for (const v of T.cars) {
        if (v.slot == null || v.mode !== 'free' || H.knocked.has(v)) continue;
        H.knocked.add(v); m.knocked++;
      }
      // stuck, every frame
      for (const v of T.cars) {
        if (v.mode !== 'traffic') continue;
        const s = Math.abs(v.vLong) < 0.5 ? (H.slow.get(v.id) || 0) + dt : 0;
        H.slow.set(v.id, s);
        if (s > 20 && !H.stuckSeen.has(v.id)) {
          H.stuckSeen.add(v.id); m.stuck++;
          // what is it stuck on? the nearest car ahead, and the road
          let ahead = null;
          const f = v.forward;
          for (const o of T.cars) {
            if (o === v) continue;
            const rx = o.x - v.x, rz = o.z - v.z, fw = rx * f.x + rz * f.z;
            if (fw > 0 && fw < 15 && Math.abs(rx * f.z - rz * f.x) < 3 && (!ahead || fw < ahead.fw)) ahead = { fw: +fw.toFixed(1), mode: o.mode };
          }
          const e = v.edge != null ? c.edges[v.edge] : null;
          if (H.stuckList.length < 12) H.stuckList.push({ x: Math.round(v.x), z: Math.round(v.z), cls: e && e.cls,
            ow: e ? flowExp(e) !== 0 : null, ahead, tun: e && e.tunnel, elev: e && e.elev, y: +v.y.toFixed(1),
            cover: +(d.G.terrainRaw(v.x, v.z) - v.y).toFixed(1), hitBld: d.collideWithBuildings ? null : null,
            hdgErr: e ? +Math.acos(Math.max(-1, Math.min(1, (e.dx * f.x + e.dz * f.z) * (v.dirSign || 1)))).toFixed(2) : null,
            name: e && e.name, type: v.type || v.spec?.name });
        }
      }
      if (H.frames % 15) continue;
      // direction, density: every quarter second
      m.samples++;
      let near = 0, all = 0;
      const slowCars = [];
      for (const v of cars) {
        if (v.mode === 'traffic') {
          all++;
          if ((v.x - site.x) ** 2 + (v.z - site.z) ** 2 < 150 * 150) near++;
          if ((H.slow.get(v.id) || 0) > 10) slowCars.push(v);
        }
        // Direction is judged for the DRIVEN cars only; a 'free' car is a
        // shunted or abandoned one coasting wherever it was pushed.
        if (v.mode === 'free' || Math.abs(v.vLong) < 1) continue;
        const jE = H.judge(v, flowExp), jF = H.judge(v, flowFlags);
        if (jE === 0) { m.offRoad++; continue; }
        const agF = jF === -1, agE = jE === -1;
        const fwy = H.onFwy(v);
        if (v.mode === 'police') {
          m.polMov++; if (agE) m.polAgE++; if (agE && fwy) m.polAgFwy++;
        } else {
          m.mov++; if (agF) m.agF++; if (agE) m.agE++;
          // where it happens, 50 m cells, with the car's own bookkeeping
          if (agE) {
            const k = Math.round(v.x / 50) * 50 + ',' + Math.round(v.z / 50) * 50;
            const q = H.agAt[k] || (H.agAt[k] = { n: 0, mode: v.mode, y: +v.y.toFixed(1),
              edge: v.edge, dirSign: v.dirSign, flow: T.flow ? T.flow[v.edge] : null,
              cls: v.edge != null ? c.edges[v.edge].cls : null, tun: v.edge != null ? c.edges[v.edge].tunnel : null });
            q.n++;
          }
          if (fwy) { m.movHwy++; if (agE) m.agHwyE++; }
        }
        const D = site.dump && H.dump[site.name];
        if (D && H.frames % 30 === 0 && D.cars.length < 20000) {
          D.cars.push([+v.x.toFixed(1), +v.z.toFixed(1), agE ? -1 : 1, v.mode === 'police' ? 1 : 0,
            +v.forward.x.toFixed(2), +v.forward.z.toFixed(2)]);
        }
      }
      m.near150 += near; m.all += all;
      // jam: biggest cluster of cars all slow for 10 s+
      for (const v of slowCars) {
        let k = 0;
        for (const o of slowCars) if ((o.x - v.x) ** 2 + (o.z - v.z) ** 2 < 25 * 25) k++;
        if (k > m.jam) m.jam = k;
      }
    }
    return H.t;
  };
  H.finish = () => {
    const m = H.m, mins = m.mt / 60;
    const r = { site: H.site.name, simS: +m.mt.toFixed(0),
      againstFlags: +(m.agF / Math.max(1, m.mov)).toFixed(4), againstExp: +(m.agE / Math.max(1, m.mov)).toFixed(4),
      againstFwy: +(m.agHwyE / Math.max(1, m.movHwy)).toFixed(4), fwySamples: m.movHwy, samples: m.mov,
      polAgainst: m.polMov ? +(m.polAgE / m.polMov).toFixed(4) : null, polAgainstFwy: m.polMov ? +(m.polAgFwy / m.polMov).toFixed(4) : null,
      polSamples: m.polMov,
      headOnPerMin: +(m.headOn / mins).toFixed(2), oppWrongwayPerMin: +(m.oppWrongway / mins).toFixed(2), oppTwowayPerMin: +(m.oppTwoway / mins).toFixed(2), oppPolicePerMin: +(m.oppPolice / mins).toFixed(2), contactsPerMin: +(m.contacts / mins).toFixed(2),
      stuck: m.stuck, jam: m.jam, near150: +(m.near150 / Math.max(1, m.samples)).toFixed(1),
      all: +(m.all / Math.max(1, m.samples)).toFixed(1), offRoad: +(m.offRoad / Math.max(1, m.mov + m.offRoad)).toFixed(3),
      stuckAt: H.stuckList,
      oppAt: H.oppList,
      againstAt: Object.entries(H.agAt).sort((a, b) => b[1].n - a[1].n).slice(0, 6).map(([k, q]) => ({ at: k, ...q })),
      raw: m };
    H.sites.push(r);
    return JSON.stringify(r);
  };
  // In-game street shot: raised, looking down ~150 m of a downtown one-way
  // arterial the way it runs. The street is walked forward from the nearest
  // one-way arterial edge, taking the straightest one-way continuation.
  H.poseShot = (si, cls, len, up) => {
    const site = H.pickSites()[si];
    let best = null;
    for (const ei of c.edgesNear(site.x, site.z, 250)) {
      const e = c.edges[ei];
      if (!e.oneway || e.cls !== cls || e.elev || e.tunnel) continue;
      const a = c.nodes[e.a];
      const dd = Math.hypot(a.x - site.x, a.z - site.z);
      if (!best || dd < best.dd) best = { ei, dd };
    }
    let e = c.edges[best.ei], s = e.onewayRev ? -1 : 1;
    const from = c.nodes[s > 0 ? e.a : e.b];
    const ux = e.dx * s, uz = e.dz * s;
    let cur = s > 0 ? e.b : e.a, run = e.len, prev = best.ei;
    while (run < len) {
      let nx = -1, nd = 0.9;
      for (const oi of c.nodes[cur].e) {
        if (oi === prev) continue;
        const o = c.edges[oi];
        if (!o.oneway || o.elev || o.tunnel) continue;
        const os = (o.a === cur) !== !!o.onewayRev ? 1 : -1;
        if ((o.a === cur ? 1 : -1) !== os) continue;
        const dd = (o.dx * os) * ux + (o.dz * os) * uz;
        if (dd > nd) { nd = dd; nx = oi; }
      }
      if (nx < 0) break;
      const o = c.edges[nx];
      run += o.len; prev = nx; cur = o.a === cur ? o.b : o.a;
    }
    const end = c.nodes[cur];
    const cx = from.x - ux * 10, cz = from.z - uz * 10;
    return { cx, cz, lx: end.x, lz: end.z, mx: (from.x + end.x) / 2, mz: (from.z + end.z) / 2,
      ux, uz, up, run: Math.round(run), ei: best.ei, name: e.name };
  };
  return JSON.stringify(H.pickSites().map((s) => s.name));
}

// ---- node side ----------------------------------------------------------------
const chrome = spawn(CHROME, [`--remote-debugging-port=${PORT}`, '--headless=new',
  '--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--window-size=1100,650',
  '--no-first-run', `--user-data-dir=/tmp/auto-tcheck-${PORT}`, 'about:blank'], { stdio: 'ignore' });
let exitCode = 0;
try {
  let page;
  for (let i = 0; i < 90 && !page; i++) {
    try { page = (await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()).find((t) => t.type === 'page'); } catch {}
    if (!page) await sleep(300);
  }
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((r, j) => { ws.addEventListener('open', r); ws.addEventListener('error', j); });
  let id = 0; const pend = new Map();
  ws.addEventListener('message', (e) => { const m = JSON.parse(e.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); } });
  const send = (m, p = {}) => new Promise((res) => { ws.send(JSON.stringify({ id: ++id, method: m, params: p })); pend.set(id, res); });
  const ev = async (e) => {
    const r = await send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails || r.result?.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails || r.result.exceptionDetails).slice(0, 1500));
    return r.result?.result?.value;
  };
  await send('Runtime.enable'); await send('Page.enable'); await send('Network.enable');
  await send('Network.setBypassServiceWorker', { bypass: true });
  await send('Network.setCacheDisabled', { cacheDisabled: true });
  await send('Page.addScriptToEvaluateOnNewDocument', { source: 'window.__noAutoQuality = true;' });
  await send('Page.navigate', { url: `http://localhost:${HTTP_PORT}/apps/auto/` });
  for (let i = 0; i < 600; i++) { await sleep(500); try { if (await ev('!!window.__dbg')) break; } catch {} }
  await ev(`window.__dbg.applyQuality('low', true)`);
  await ev('window.__dbg.game.paused = true');
  // Vehicles need a stable id for the contact pairs.
  await ev(`(() => { let n = 0; const T = window.__dbg.traffic, add = T.add.bind(T);
    T.add = (v, mode) => { v.id = ++n; return add(v, mode); }; for (const v of T.cars) v.id = ++n; return 1; })()`);
  const sites = JSON.parse(await ev(`(${pageInit.toString()})()`));
  console.log('sites', sites.join(' '));
  const t0 = Date.now();
  for (let si = 0; si < sites.length; si++) {
    if (ONLY && !ONLY.split(',').includes(sites[si])) continue;
    console.log('begin', await ev(`window.__tc.begin(window.__tc.pickSites()[${si}])`));
    for (let t = 0; t < WARM * 60; t += 600) await ev(`window.__tc.stepN(600, false)`);
    for (let t = 0; t < MEASURE * 60; t += 600) await ev(`window.__tc.stepN(600, true)`);
    console.log('SITE', await ev('window.__tc.finish()'), Math.round((Date.now() - t0) / 1000) + 's');
  }
  const tot = JSON.parse(await ev(`(() => {
    const S = window.__tc.sites, civ = S.filter((s) => !s.site.startsWith('pursuit'));
    const sum = (k, L = S) => L.reduce((a, s) => a + s.raw[k], 0);
    const mins = S.reduce((a, s) => a + s.simS, 0) / 60, cmins = civ.reduce((a, s) => a + s.simS, 0) / 60;
    const T = window.__dbg.traffic;
    return JSON.stringify({ simMin: +mins.toFixed(1),
      againstFlags: +(sum('agF') / sum('mov')).toFixed(4), againstExp: +(sum('agE') / sum('mov')).toFixed(4),
      againstFwy: +(sum('agHwyE') / Math.max(1, sum('movHwy'))).toFixed(4),
      polAgainst: +(sum('polAgE') / Math.max(1, sum('polMov'))).toFixed(4),
      polAgainstFwy: +(sum('polAgFwy') / Math.max(1, sum('polMov'))).toFixed(4),
      headOnPerMin: +(sum('headOn') / mins).toFixed(2), oppWrongwayPerMin: +(sum('oppWrongway') / mins).toFixed(2), oppTwowayPerMin: +(sum('oppTwoway') / mins).toFixed(2), oppPolicePerMin: +(sum('oppPolice') / mins).toFixed(2), contactsPerMin: +(sum('contacts') / mins).toFixed(2), contactKinds: Object.fromEntries(['cSame', 'cCross', 'cOpp', 'cPolice', 'cPolPol', 'cFree'].map((k) => [k, +(S.reduce((a, s) => a + (s.raw[k] || 0), 0) / mins).toFixed(2)])),
      parkedKnockedPerMin: +(sum('knocked') / mins).toFixed(2), stuck: sum('stuck'), jamMax: Math.max(...S.map((s) => s.jam)),
      near150: +(civ.reduce((a, s) => a + s.near150, 0) / civ.length).toFixed(1),
      all: +(civ.reduce((a, s) => a + s.all, 0) / civ.length).toFixed(1),
      trafficStats: T.stats || null });
  })()`));
  console.log('TRAFFIC', JSON.stringify(tot));
  if (DUMP) {
    writeFileSync(DUMP, await ev('JSON.stringify(window.__tc.dump)'));
    console.log('dump', DUMP);
  }
  if (SHOT) {
    // Two in-game shots: down a downtown one-way arterial, and down SR-99's
    // southbound carriageway south of the tunnel's exit (the divided freeway
    // where the player met oncoming cars).
    for (const [name, si, cls, len, up] of [['street-downtown', 0, 'art', 420, 55], ['street-sr99', 2, 'hwy', 260, 14]]) {
      // Fill the streets round the shot and let them run for 25 s. Each build
      // spawns and drives with its OWN code; the extra spawns only raise the
      // density so one street shows several cars. Parked cars are left out,
      // so every car in frame is moving traffic.
      const pose = await ev(`(() => { const q = window.__tc.poseShot(${si}, '${cls}', ${len}, ${up}); const H = window.__tc, d = window.__dbg;
        H.begin({ name: 'shot', x: q.mx, z: q.mz });
        if (!H.noParked) { H.noParked = true; d.traffic.updateParked = () => {}; }
        for (const v of [...d.traffic.cars]) if (v.mode === 'parked') d.traffic.remove(v);
        for (let i = 0; i < 90; i++) d.traffic.spawnTraffic(q.mx, q.mz, null);
        H.stepN(1500, false);
        return JSON.stringify(q); })()`);
      const q = JSON.parse(pose);
      await ev(`(() => { const d = window.__dbg;
        for (const id of ['hud','pad','stickZone','lookZone','objective','toast','rotate','topBtns'])
          { const e = document.getElementById(id); if (e) e.style.display = 'none'; }
        const pending = () => [...d.world.chunks.values()].filter((c) => c.lod !== c.wantLod).length;
        d.world.update(${q.mx}, ${q.mz}, 60);
        for (let i = 0; i < 3000 && pending() > 0; i++) d.world.update(${q.mx}, ${q.mz}, 60);
        const gy = (x, z) => d.city.groundAt(x, z, null);
        d.camera.position.set(${q.cx}, gy(${q.cx}, ${q.cz}) + ${q.up}, ${q.cz});
        d.camera.lookAt(${q.lx}, gy(${q.lx}, ${q.lz}), ${q.lz});
        d.camera.updateMatrixWorld(true);
        d.sun.position.set(${q.mx} - 215, gy(${q.mx}, ${q.mz}) + 200, ${q.mz} - 150);
        d.sun.target.position.set(${q.mx}, gy(${q.mx}, ${q.mz}), ${q.mz});
        d.sun.target.updateMatrixWorld();
        return 1; })()`);
      await sleep(8000);
      let s = await send('Page.captureScreenshot', { format: 'png' });
      writeFileSync(`${SHOT}/${name}.png`, Buffer.from(s.result.data, 'base64'));
      // The same frame with a diagnostic layer: every moving AI car in view
      // ringed green (with the flow, or on a two-way street) or red (against
      // a one-way carriageway), with a tick along its heading.
      const tally = await ev(`(() => { const d = window.__dbg, H = window.__tc, THREE = d.THREE;
        let cv = document.getElementById('__tcov');
        if (!cv) { cv = document.createElement('canvas'); cv.id = '__tcov';
          cv.style.cssText = 'position:fixed;left:0;top:0;width:100vw;height:100vh;pointer-events:none;z-index:99999';
          document.body.appendChild(cv); }
        cv.width = innerWidth; cv.height = innerHeight;
        const g = cv.getContext('2d'); g.clearRect(0, 0, cv.width, cv.height);
        const P = (x, y, z) => { const v = new THREE.Vector3(x, y, z).project(d.camera);
          return v.z < 1 && Math.abs(v.x) < 1.05 && Math.abs(v.y) < 1.05 ? [(v.x + 1) / 2 * cv.width, (1 - v.y) / 2 * cv.height] : null; };
        let w = 0, a = 0;
        for (const v of d.traffic.cars) {
          if ((v.mode !== 'traffic' && v.mode !== 'police') || Math.abs(v.vLong) < 1) continue;
          const p0 = P(v.x, v.y + 1, v.z); if (!p0) continue;
          const f = v.forward, p1 = P(v.x + f.x * 7, v.y + 1, v.z + f.z * 7);
          const j = H.judge(v, H.flowExp); const col = j === -1 ? '#ff2020' : '#20d040';
          if (j === -1) a++; else w++;
          const r = Math.max(7, Math.min(26, 900 / Math.hypot(v.x - d.camera.position.x, v.z - d.camera.position.z)));
          g.lineWidth = 3; g.strokeStyle = col;
          g.beginPath(); g.arc(p0[0], p0[1], r, 0, Math.PI * 2); g.stroke();
          if (p1) { g.beginPath(); g.moveTo(p0[0], p0[1]); g.lineTo(p1[0], p1[1]); g.stroke(); }
        }
        g.fillStyle = 'rgba(0,0,0,0.6)'; g.fillRect(0, cv.height - 30, cv.width, 30);
        g.fillStyle = '#fff'; g.font = '16px sans-serif';
        g.fillText('moving AI cars in view: ' + w + ' with the flow (green), ' + a + ' AGAINST a one-way carriageway (red)', 10, cv.height - 10);
        return JSON.stringify({ w, a }); })()`);
      await sleep(500);
      s = await send('Page.captureScreenshot', { format: 'png' });
      writeFileSync(`${SHOT}/${name}-tagged.png`, Buffer.from(s.result.data, 'base64'));
      await ev(`document.getElementById('__tcov').remove()`);
      console.log('shot', `${SHOT}/${name}.png`, q.name, q.run + ' m', tally);
    }
  }
} catch (err) {
  console.log('ERROR', err.message);
  exitCode = 2;
} finally { chrome.kill(); }
process.exit(exitCode);
