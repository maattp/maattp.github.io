// A getaway driver: a car fleeing a point over the street graph.
// tools/wantedcheck.mjs's player drives this way, fleeing the police at each
// wanted level.
//
// Node to node: at each node the next is the one leading furthest from the
// pursuer, plus some randomness, never straight back; flat out on the
// straights, braking from 35 m out for the turn waiting at the next node;
// backing out, wheel reversed, when wedged; at half speed when badly hurt.
// Legal or not: one-ways either way, but never a freeway or a ramp against
// its flow (that is the head-on).

import { clamp, angleWrap } from './util.js';

/** A driver's state, starting toward `node` from `prev`, at up to topV m/s;
 *  limping at half speed once its health is under `limpAt`. */
export function getawayState(node, prev, topV, limpAt = 30) {
  return { node, prev, next: -1, topV, limpAt, stopT: 0, stuckT: 0, revT: 0,
    inp: { throttle: 0, brake: 0, steer: 0, handbrake: 0 } };
}

function pick(city, T, from, prev, px, pz) {
  const n = city.nodes[from];
  let best = -1, bs = -Infinity;
  for (const ei of n.e) {
    const e = city.edges[ei];
    if (e.noTraffic) continue;
    const to = e.a === from ? e.b : e.a;
    const sign = e.a === from ? 1 : -1;
    if ((e.cls === 'hwy' || e.cls === 'ramp') && !T.allowed(ei, sign)) continue;
    const m = city.nodes[to];
    const dx = m.x - n.x, dz = m.z - n.z, l = Math.hypot(dx, dz) || 1;
    const ax = n.x - px, az = n.z - pz, al = Math.hypot(ax, az) || 1;
    let sc = (dx * ax + dz * az) / (l * al) + Math.random() * 0.7;
    if (to === prev) sc -= 3;
    if (e.cls === 'res') sc -= 0.15;
    if (sc > bs) { bs = sc; best = to; }
  }
  return best < 0 ? prev : best;
}

/**
 * This frame's pedals for car v (state s) fleeing (px, pz): the AI input
 * Vehicle.update takes, s.inp, reused. `s.stopT` > 0 (a caller's "stopped
 * by the pursuer" clock) suspends the wedge detection, so a car you have stopped does
 * not reverse away from you.
 */
export function getaway(city, T, v, s, dt, px, pz) {
  const inp = s.inp;
  if (s.next < 0) s.next = pick(city, T, s.node, s.prev, px, pz);
  const n1 = city.nodes[s.node];
  if (Math.hypot(n1.x - v.x, n1.z - v.z) < 12) {
    s.prev = s.node; s.node = s.next; s.next = pick(city, T, s.node, s.prev, px, pz);
  }
  const a = city.nodes[s.node], b = city.nodes[s.next];
  const desired = Math.atan2(a.x - v.x, a.z - v.z);
  const err = angleWrap(desired - v.heading);
  // the turn waiting at the node: slow for it from 35 m out
  const turn = Math.abs(angleWrap(Math.atan2(b.x - a.x, b.z - a.z) - desired));
  const dn = Math.hypot(a.x - v.x, a.z - v.z);
  let top = s.topV * (v.health < s.limpAt ? 0.5 : 1);
  const corner = 9 + (1 - Math.min(1, turn / 1.6)) * (top - 9);
  if (dn < 35) top = Math.min(top, corner + (dn / 35) * (top - corner));
  if (Math.abs(err) > 0.5) top = Math.min(top, 10);
  inp.steer = clamp(err * 1.8, -1, 1);
  inp.handbrake = 0;
  // wedged: back out (at a standstill the brake is reverse), wheel reversed
  if (s.revT > 0) {
    s.revT -= dt;
    inp.throttle = 0; inp.brake = 1; inp.steer = -inp.steer;
    return inp;
  }
  if (Math.abs(v.vLong) < 1 && s.stopT === 0) s.stuckT += dt; else s.stuckT = 0;
  if (s.stuckT > 1.5) { s.stuckT = 0; s.revT = 1.3; }
  inp.throttle = v.vLong < top ? clamp((top - v.vLong) * 0.4, 0.3, 1) : 0;
  inp.brake = v.vLong > top + 2 ? clamp((v.vLong - top) * 0.15, 0, 1) : 0;
  return inp;
}
