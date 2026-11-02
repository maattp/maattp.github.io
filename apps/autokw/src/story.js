// Auto KW: KW STORIES -- a short story campaign, GTA-style, in Waterloo Region.
//
// Gord Brubacher drove the lead float in the Oktoberfest parade for 31 years
// and runs a garage in the plaza at University Ave E & Bridge St W, Waterloo.
// A condo developer, Chad Vandermeer, wants his lot. Seven chapters, unlocked
// one after another, each a different mechanic on real streets:
//
//   1 The Double-Double Run  -- a tray of coffee from the Tim Hortons across the
//                               plaza to the Aud before it goes cold (timer + spill)
//   2 Goose Chase            -- the van that took Gerald the goose, from Waterloo
//                               Park (pursuit: ram it to a stop), then Gerald to
//                               Columbia Lake
//   3 Tail Lights            -- Chad's SUV from Uptown to the Tannery, close but
//                               not too close (a distance band and a suspicion meter)
//   4 Float Like a Pretzel   -- drive the parade float down King St from Uptown
//                               to Kitchener City Hall without wrecking it
//   5 The Golden Goose       -- snatch the Golden Goose card Chad swiped from J&J
//                               back from him (the police see a scuffle: two stars),
//                               lose the WRPS, a respray, then return the card to J&J
//   6 Civic Duty             -- race Kayla's Civic from Fairview Park to Preston
//   7 Prost!                 -- Chad's limo from the Aud to his jet at YKF: stop it,
//                               then the deed home; the float is yours
//
// HOW IT HOLDS TOGETHER
//   - The contact is a gold beam in the plaza's lot (and a star on the map);
//     stop in it (in anything, or on foot) and the next chapter starts. The
//     pause menu's KW STORIES rows show the progress, REPLAY a finished
//     chapter, and quit a running one; a failed chapter offers RETRY (a chip on
//     screen for a few seconds, and the menu).
//   - A chapter never starts during a job, an exam, a police/fire/paramedic
//     run, an activity, a race or with the law on you (`busy()` from main.js);
//     a random event in progress is stopped. While one runs `game.story` is
//     its id, and the jobs refuse to start (taxi, KW Eats, GRT, G2, police,
//     paramedic and fire MISSION, the map's activities).
//   - THE WORLD IS HELD ONLY FOR CUTSCENES: the intro and the finale
//     (game.hold('story'), in reapHolds' `live`). Everything else is subtitles
//     (a portrait card) over a running world.
//   - Machinery reused: the A* (taxi.js PathJob, through `router`), the
//     getaway driver (getaway.js) for the goose van, traffic's 'suspect' mode
//     (this wraps traffic.suspectDriver for its own cars: `v.story`), the LED
//     panel (grtbus.js LedPanel), hud.fare for the route and the pin,
//     hud.suspects for a target's diamond, game.setWanted, respray.js.
//   - Saved in localStorage `autokw-story`: { done: [ids], best: {id: s}, n: plays }.
//
// Phone cost with no chapter running: a distance test a frame; within 700 m of
// the garage the beam (1 draw, additive-ish basic material); within 160 m Gord
// (one pooled skinned humanoid, 1 draw) and the garage's sign (1 draw, built
// once). During a chapter: the beam, a cone over a target (1 draw), <= 1 story
// car, and the float's merged decoration (1 draw) in chapter 4.
//
// Harness: `__dbg.story` (`start(i, {skipIntro})`, `run`, `chapters`, `save`,
// `skipCut()`, `routeNow(x, z, tx, tz)`); the probe is tools/kw/storyprobe.mjs.

import * as THREE from './three.js';
import * as G from './geo.js';
import { clamp, angleWrap, formatMoney } from './util.js';
import { getaway, getawayState } from './getaway.js';
import { Feel } from './grtbus.js';
import { makeHumanoid, hailPose } from './peds.js';
import { CHEAT } from './cheats.js';
const KEY = 'autokw-story';
const TRIGGER_R = 7.5;        // stopped this close to the beam: the chapter starts
const BEAM_R = 700;           // the beam is drawn within this
const GIVER_R = 160;          // Gord stands at his door within this
const ROUTE_LIMIT = 90000;    // A* expansions before a route is given up
const ROUTE_BUDGET = 500;     // ...a frame
const STOP_R = 22, STOP_T = 2.2;   // a target stopped this close for this long: taken down

// The garage: the plaza's storefront at University Ave E & Bridge St W (its
// north face, on the lot). Gord at his door, the beam in the lot in front.
export const GARAGE = { x: -1613, z: -4199, gx: -1617, gz: -4186, face: -2.63, signX: -1617.5, signZ: -4175.65 };

// ---------------------------------------------------------------------------
// The cast (all invented) and their portraits, drawn once on a canvas
// ---------------------------------------------------------------------------
export const CAST = {
  gord: { name: 'Gord', bg: '#1f4f8f', skin: '#e9b48c', hair: '#cfcfcf', bald: true, tache: '#e6e6e6', hat: '#2f5a2a', feather: '#c0392b' },
  priya: { name: 'Priya', bg: '#6b2b8f', skin: '#b67a52', hair: '#1a1210', long: true, glasses: true, phones: '#e84a9a' },
  chad: { name: 'Chad Vandermeer', bg: '#8f1f2b', skin: '#f0c8a2', hair: '#e8c45a', swoop: true, shades: true, grin: true },
  kayla: { name: 'Kayla "Hespeler Heat" Fortin', bg: '#b4461a', skin: '#d8a078', hair: '#5a2e1a', long: true, cap: '#c8102e' },
  gerald: { name: 'Gerald', bg: '#3a6a3a', goose: true },
  tims: { name: 'Tims crew', bg: '#c8102e', skin: '#c99068', hair: '#2a1a10', visor: '#7a0d1c' },
  runner: { name: "Chad's runner", bg: '#444c58', skin: '#efc39c', hair: '#3a2a18', hood: '#2b3644' },
};
const _portraits = {};
function portrait(who) {
  if (_portraits[who]) return _portraits[who];
  const c = CAST[who] || CAST.gord, S = 96;
  const cv = document.createElement('canvas'); cv.width = S; cv.height = S;
  const g = cv.getContext('2d');
  g.fillStyle = c.bg; g.beginPath(); g.arc(48, 48, 48, 0, Math.PI * 2); g.fill();
  g.save(); g.beginPath(); g.arc(48, 48, 46, 0, Math.PI * 2); g.clip();
  if (c.goose) {
    // a Canada goose in profile: grey body, black neck and head, the white chinstrap
    g.fillStyle = '#8a7a66'; g.beginPath(); g.ellipse(52, 84, 34, 20, 0, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#111'; g.fillRect(40, 30, 13, 48);
    g.beginPath(); g.ellipse(50, 30, 15, 11, -0.2, 0, Math.PI * 2); g.fill();
    g.beginPath(); g.moveTo(60, 27); g.lineTo(78, 31); g.lineTo(60, 36); g.fill();
    g.fillStyle = '#fff'; g.beginPath(); g.ellipse(44, 36, 7, 4, 0.5, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#fff'; g.beginPath(); g.arc(54, 26, 2.4, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#000'; g.beginPath(); g.arc(54.5, 26, 1.2, 0, Math.PI * 2); g.fill();
  } else {
    // shoulders, neck, face
    g.fillStyle = c.hood || (who === 'chad' ? '#f4f4f0' : who === 'gord' ? '#3a6fb0' : '#333a44');
    g.beginPath(); g.ellipse(48, 104, 40, 30, 0, 0, Math.PI * 2); g.fill();
    if (c.long) { g.fillStyle = c.hair; g.beginPath(); g.ellipse(48, 56, 27, 34, 0, 0, Math.PI * 2); g.fill(); }
    g.fillStyle = c.skin; g.fillRect(41, 60, 14, 16);
    g.beginPath(); g.ellipse(48, 46, 21, 25, 0, 0, Math.PI * 2); g.fill();
    // hair
    g.fillStyle = c.hair;
    if (c.bald) { g.beginPath(); g.ellipse(28, 44, 5, 11, 0, 0, Math.PI * 2); g.fill(); g.beginPath(); g.ellipse(68, 44, 5, 11, 0, 0, Math.PI * 2); g.fill(); }
    else if (c.swoop) { g.beginPath(); g.moveTo(26, 38); g.quadraticCurveTo(40, 6, 74, 22); g.quadraticCurveTo(70, 32, 66, 30); g.quadraticCurveTo(48, 24, 30, 42); g.fill(); }
    else { g.beginPath(); g.ellipse(48, 28, 22, 12, 0, Math.PI, Math.PI * 2); g.fill(); g.fillRect(26, 26, 44, 8); }
    // eyes / glasses / shades
    if (c.shades) { g.fillStyle = '#111'; g.fillRect(31, 40, 14, 7); g.fillRect(51, 40, 14, 7); g.fillRect(44, 42, 8, 2); }
    else {
      g.fillStyle = '#1a1a1a'; g.beginPath(); g.arc(40, 44, 2.6, 0, Math.PI * 2); g.arc(56, 44, 2.6, 0, Math.PI * 2); g.fill();
      if (c.glasses) { g.strokeStyle = '#222'; g.lineWidth = 2; g.strokeRect(33, 39, 13, 10); g.strokeRect(50, 39, 13, 10); g.beginPath(); g.moveTo(46, 43); g.lineTo(50, 43); g.stroke(); }
    }
    // the moustache, the grin, a plain mouth
    if (c.tache) { g.fillStyle = c.tache; g.beginPath(); g.ellipse(42, 56, 9, 4, 0.25, 0, Math.PI * 2); g.ellipse(54, 56, 9, 4, -0.25, 0, Math.PI * 2); g.fill(); }
    else if (c.grin) { g.fillStyle = '#fff'; g.beginPath(); g.ellipse(48, 58, 10, 4.5, 0, 0, Math.PI); g.fill(); g.strokeStyle = '#7a2a2a'; g.lineWidth = 1.5; g.stroke(); }
    else { g.strokeStyle = '#7a3a2a'; g.lineWidth = 2.2; g.beginPath(); g.arc(48, 54, 7, 0.2, Math.PI - 0.2); g.stroke(); }
    // headwear
    if (c.hat) {
      g.fillStyle = c.hat; g.beginPath(); g.ellipse(48, 26, 30, 6, 0, 0, Math.PI * 2); g.fill();
      g.beginPath(); g.moveTo(32, 26); g.quadraticCurveTo(36, 4, 48, 6); g.quadraticCurveTo(60, 4, 64, 26); g.fill();
      g.fillStyle = '#d9b54a'; g.fillRect(33, 20, 30, 3);
      g.strokeStyle = c.feather; g.lineWidth = 3; g.beginPath(); g.moveTo(62, 22); g.quadraticCurveTo(76, 6, 72, -2); g.stroke();
    }
    if (c.cap) { g.fillStyle = c.cap; g.beginPath(); g.ellipse(48, 25, 22, 12, 0, Math.PI, Math.PI * 2); g.fill(); g.fillRect(26, 24, 44, 5); g.fillRect(20, 26, 14, 4); }
    if (c.visor) { g.fillStyle = c.visor; g.fillRect(24, 22, 48, 7); g.fillRect(54, 26, 22, 5); }
    if (c.phones) { g.strokeStyle = c.phones; g.lineWidth = 4; g.beginPath(); g.arc(48, 44, 25, Math.PI * 1.05, Math.PI * 1.95); g.stroke(); g.fillStyle = c.phones; g.fillRect(19, 40, 7, 13); g.fillRect(70, 40, 7, 13); }
    if (c.hood) { g.strokeStyle = c.hood; g.lineWidth = 6; g.beginPath(); g.arc(48, 46, 26, Math.PI * 0.9, Math.PI * 2.1); g.stroke(); }
  }
  g.restore();
  return (_portraits[who] = cv.toDataURL());
}

// ---------------------------------------------------------------------------
// The chapters. A step is { k: kind, ...params, say: [lines] (when it starts),
// done: [lines] (when it is done) }; a line is [who, text].
// ---------------------------------------------------------------------------
const TIMS = [-1452, -4061];            // the Tim Hortons across the plaza (its lot, off Bridge St)
const AUD = [665, 623];                 // Kitchener Memorial Auditorium, on its lot
const WPARK = [-4427, -1453];           // Waterloo Park
const COLUMBIA = [-6448, -2202];        // Columbia Lake, UW north campus
const UPTOWN = [-3820, -1391];          // King & Erb, Uptown Waterloo
const TANNERY = [-1876, 100];           // the Tannery, downtown Kitchener
const CITYHALL = [-1466, 16];           // King St at Kitchener City Hall
const JJ = [-3583, -2825];              // J&J Cards & Collectibles, Weber St N
const FAIRVIEW = [2815, 2970];          // Kingsway Dr by CF Fairview Park
const PRESTON = [9486, 6270];           // King St, downtown Preston
const YKF = [7196, -371];               // YKF's terminal road

export const CHAPTERS = [
  {
    id: 'coffee', title: 'The Double-Double Run', pay: 500,
    intro: [
      ['gord', "So you're the driver Priya keeps talking about. Gord Brubacher. Thirty-one years driving the lead float in the Oktoberfest parade."],
      ['gord', "Parade committee meets at the Aud in a few minutes, and they don't listen to anybody who shows up without Tims."],
      ['gord', 'Eight double-doubles and forty Timbits. HOT. Do not make me look bad, kid.'],
    ],
    steps: [
      { k: 'go', at: TIMS, r: 26, stop: true, car: true, obj: 'Pick up the order at the Tim Hortons across the plaza',
        done: [['tims', 'Eight double-doubles, forty Timbits. Careful — they are HOT.']] },
      { k: 'go', at: AUD, r: 34, stop: true, car: true, obj: 'Get the coffee to the Aud while it is hot', time: (m) => Math.round(m / 12.5 + 35),
        cargo: { what: 'coffee', sens: 1.15, bad: 'Coffee sloshing everywhere!' }, timeFail: 'The coffee went cold. Gord will never live it down',
        done: [['gord', 'Hot coffee AND forty Timbits? They voted me back in as lead float driver! You are alright, kid.']] },
    ],
  },
  {
    id: 'goose', title: 'Goose Chase', pay: 800,
    intro: [
      ['priya', 'GORD! Gerald is gone!'],
      ['gord', 'Gerald has guarded this garage since 2009. Best goose in Waterloo. Bit my accountant twice.'],
      ['priya', 'Doorbell cam caught a white van heading for Waterloo Park. "Vandermeer Developments" on the side.'],
      ['gord', 'Chad Vandermeer. Wants my lot for "luxury micro-condos". Go get my goose.'],
    ],
    steps: [
      { k: 'go', at: WPARK, r: 160, car: true, obj: 'Find the van by Waterloo Park' },
      { k: 'chase', type: 'van', color: 0xf2f2ee, hp: 36, speed: 17.5, honk: true, obj: 'Ram the van to a stop',
        say: [['gerald', 'HONK. HONK HONK.'], ['priya', "That's him! Ram it — gently. Ish."]],
        done: [['gerald', 'HONK.'], ['gord', 'He climbed in your back seat? Take him to Columbia Lake to calm down. Windows down.']] },
      { k: 'go', at: COLUMBIA, r: 40, stop: true, car: true, obj: 'Take Gerald to Columbia Lake', goose: true,
        done: [['gerald', 'HONK!'], ['gord', 'He says thank you. Probably. Hard to tell with Gerald.']] },
    ],
  },
  {
    id: 'tail', title: 'Tail Lights', pay: 1000,
    intro: [
      ['priya', 'Chad\'s assistant just posted a story: "big meeting, big money". His SUV is in Uptown.'],
      ['gord', 'Follow him. Not too close — that man checks his mirrors more than his hair.'],
      ['gord', 'Not too far either. Ontario plates all look the same.'],
    ],
    steps: [
      { k: 'go', at: UPTOWN, r: 140, car: true, obj: "Get to Uptown Waterloo — Chad's SUV is parked on King" },
      { k: 'tail', type: 'suv', color: 0x14161a, speed: 12.5, from: UPTOWN, to: TANNERY, near: 22, far: 150, obj: "Tail Chad's SUV — stay back",
        say: [['priya', 'Black SUV, pulling out. Keep him in sight, and keep your distance.']],
        done: [['priya', "He's meeting the parade's insurance guy at the Tannery. He wants the float BANNED. \"Liability.\""], ['gord', 'Over my dead pretzel.']] },
    ],
  },
  {
    id: 'float', title: 'Float Like a Pretzel', pay: 1500,
    intro: [
      ['gord', "The float's at the marshalling lot in Uptown. My back's out, so you're driving."],
      ['gord', "Chad's insurance man is watching from City Hall. One good dent and the float is banned for life."],
      ['gord', 'King Street, nice and slow. Wave at the people. Do NOT hit the pretzel.'],
    ],
    steps: [
      { k: 'go', at: UPTOWN, r: 60, stop: false, obj: 'Get to the parade marshalling area in Uptown' },
      { k: 'board', type: 'pickup', at: UPTOWN, obj: 'Get in the float' },
      { k: 'parade', to: CITYHALL, obj: 'Drive the float down King St to Kitchener City Hall', limit: 15,
        say: [['gord', 'Under fifty, kid. The pretzel is load-bearing.']],
        done: [['gord', 'Not a scratch! The insurance man cried. Happy tears, I think.'], ['chad', 'This is not over, Brubacher.']] },
    ],
  },
  {
    id: 'card', title: 'The Golden Goose', pay: 2000,
    intro: [
      ['priya', "Chad swiped a Golden Goose card from J&J Cards on Weber. One in five hundred packs, and he just walked out with it."],
      ['gord', "Margaret on the parade committee has wanted that card since 1998. He's going to bribe her with it. A card that belongs in that shop."],
      ['priya', "He's still on the sidewalk outside J&J, showing it off. Grab it and go — it's his word against yours, and he knows people."],
      ['gord', 'Get it back to J&J where it belongs. And lose anybody who follows you.'],
    ],
    steps: [
      { k: 'go', at: JJ, r: 30, stop: true, car: true, obj: 'Get to J&J Cards on Weber St — Chad is outside', snatch: true,
        done: [['chad', 'HEY! That is MY one-in-five-hundred GOOSE! Officer! OFFICER! Somebody is mugging me!']] },
      { k: 'heat', stars: 2, obj: 'Lose the cops — they saw a scuffle' },
      { k: 'respray', obj: 'The cops know the car — get it resprayed (Gord is paying)' },
      { k: 'go', at: JJ, r: 30, stop: true, obj: 'Return the Golden Goose card to J&J Cards', thanks: true,
        done: [['gord', 'Back where it belongs. Margaret can buy her own pack like everybody else.']] },
    ],
  },
  {
    id: 'race', title: 'Civic Duty', pay: 2500,
    intro: [
      ['kayla', "So you're Gord's new driver. Kayla Fortin. Hespeler Heat."],
      ['kayla', "Chad's paying me to take your float's tow spot at the parade. Race me for it: Fairview Park to Preston."],
      ['gord', "Kayla's a good kid. Terrible influence. Win."],
    ],
    steps: [
      { k: 'go', at: FAIRVIEW, r: 30, stop: true, car: true, obj: 'Meet Kayla on Kingsway Drive by Fairview Park' },
      { k: 'race', type: 'civic', color: 0xd12a2a, to: PRESTON, speed: 31, obj: 'Beat Kayla to Preston',
        say: [['kayla', 'Hwy 8, King Street, down the hill into Preston. Try to keep up.']],
        done: [['kayla', "...Fine. The spot's yours. Tell Gord his float is still ugly."], ['gord', 'It is BEAUTIFUL.']] },
    ],
  },
  {
    id: 'prost', title: 'Prost!', pay: 10000,
    intro: [
      ['priya', 'Gord! Chad got the city to sign over the deed to your lot. He is at the Aud with it, and his jet is waiting at YKF!'],
      ['gord', 'Thirty-one parades. Fifty years in that garage. Not today, Chad.'],
      ['gord', 'Stop that limo before it gets to the airport. Then bring me my deed.'],
    ],
    steps: [
      { k: 'go', at: AUD, r: 130, car: true, obj: "Get to the Aud — Chad's limo is in the lot" },
      { k: 'flee', type: 'limo', color: 0x0c0c0e, hp: 70, speed: 24, from: AUD, to: YKF, obj: "Stop Chad's limo before YKF",
        say: [['chad', 'Do you know who I am? I have a PODCAST!']],
        done: [['chad', 'My lawyer will hear about this. My lawyer is also my brother-in-law. He will be SO upset.'], ['priya', 'Got the deed? Bring it home to Gord!']] },
      { k: 'go', at: [GARAGE.x, GARAGE.z], r: 12, stop: true, obj: "Bring the deed back to Gord's garage" },
    ],
    outro: [
      ['gord', 'My deed. My garage. My GOOSE.'],
      ['gerald', 'HONK.'],
      ['priya', 'And Chad is trending. #PodcastLimo.'],
      ['gord', "Kid — the float is yours. Every parade, you drive. It's parked out front whenever you want it."],
    ],
  },
];

function read() {
  try { const s = JSON.parse(localStorage.getItem(KEY) || 'null'); if (s && typeof s === 'object') return s; } catch (e) { /* private mode */ }
  return {};
}

const _lin = (hex) => { const c = new THREE.Color(hex); return [c.r, c.g, c.b]; };

/** The parade float's decorations, one vertex-coloured geometry (built once,
 *  shared): a blue-and-white diamond skirt, a giant pretzel, a stein of root
 *  beer and a wreath of hops, sitting on a pickup's bed (the cab is ahead). */
let _floatGeo = null;
function floatGeometry() {
  if (_floatGeo) return _floatGeo;
  const pos = [], nor = [], col = [];
  const m = new THREE.Matrix4(), nm = new THREE.Matrix3(), v = new THREE.Vector3();
  const add = (geo, mat, hex) => {
    const g = geo.index ? geo.toNonIndexed() : geo;
    nm.getNormalMatrix(mat);
    const P = g.attributes.position, N = g.attributes.normal, c = _lin(hex);
    for (let i = 0; i < P.count; i++) {
      v.fromBufferAttribute(P, i).applyMatrix4(mat); pos.push(v.x, v.y, v.z);
      v.fromBufferAttribute(N, i).applyMatrix3(nm).normalize(); nor.push(v.x, v.y, v.z);
      col.push(c[0], c[1], c[2]);
    }
    if (g !== geo) g.dispose();
    geo.dispose();
  };
  const T = (x, y, z, rx = 0, ry = 0, rz = 0, s = 1) => m.compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz)), new THREE.Vector3(s, s, s)).clone();
  // the deck over the bed: z from -2.95 (tail) to 0.1, y 1.05
  add(new THREE.BoxGeometry(2.3, 0.18, 3.1), T(0, 1.06, -1.4), 0xe8e4d8);
  // the skirt: blue and white diamonds (Bavarian), down both sides and the tail
  for (let i = 0; i < 8; i++) {
    const z = -2.85 + i * 0.4, c = i % 2 ? 0x1d5fb4 : 0xf4f4f4;
    for (const sx of [-1.17, 1.17]) add(new THREE.BoxGeometry(0.05, 0.62, 0.4), T(sx, 0.72, z), sx > 0 ? c : (i % 2 ? 0xf4f4f4 : 0x1d5fb4));
  }
  for (let i = 0; i < 6; i++) add(new THREE.BoxGeometry(0.39, 0.62, 0.05), T(-0.98 + i * 0.39, 0.72, -2.97), i % 2 ? 0x1d5fb4 : 0xf4f4f4);
  // the giant pretzel, standing up across the deck
  const brown = 0x9a5a22, salt = 0xf2efe6;
  add(new THREE.TorusGeometry(0.62, 0.17, 8, 18), T(-0.48, 2.25, -1.6, 0, 0, 0), brown);
  add(new THREE.TorusGeometry(0.62, 0.17, 8, 18), T(0.48, 2.25, -1.6, 0, 0, 0), brown);
  add(new THREE.TorusGeometry(0.9, 0.18, 8, 22, Math.PI), T(0, 2.05, -1.6, 0, 0, Math.PI), brown);
  add(new THREE.CylinderGeometry(0.17, 0.17, 1.2, 8), T(-0.3, 1.55, -1.6, 0, 0, 0.5), brown);
  add(new THREE.CylinderGeometry(0.17, 0.17, 1.2, 8), T(0.3, 1.55, -1.6, 0, 0, -0.5), brown);
  for (let i = 0; i < 14; i++) { const a = i * 0.9; add(new THREE.BoxGeometry(0.07, 0.07, 0.07), T(Math.cos(a) * 0.9 * (i % 2 ? 0.5 : 1), 2.25 + Math.sin(a) * 0.55, -1.42), salt); }
  // the stein (root beer, it is a family parade): glass, foam, handle, lid
  add(new THREE.CylinderGeometry(0.36, 0.33, 0.95, 12), T(0.62, 1.63, -2.55), 0xc89a3a);
  add(new THREE.CylinderGeometry(0.38, 0.38, 0.18, 12), T(0.62, 2.18, -2.55), 0xfaf6ea);
  add(new THREE.TorusGeometry(0.22, 0.06, 6, 10, Math.PI), T(0.98, 1.65, -2.55, 0, 0, -Math.PI / 2), 0xc89a3a);
  // the hops wreath at the front of the deck, behind the cab
  add(new THREE.TorusGeometry(0.42, 0.11, 6, 14), T(-0.6, 1.62, -0.2, 0, 0, 0), 0x5f8f2e);
  // two flagpoles with blue-and-white pennants
  for (const sx of [-1.0, 1.0]) {
    add(new THREE.CylinderGeometry(0.035, 0.035, 1.8, 5), T(sx, 2.0, -2.85), 0xd9d9d9);
    add(new THREE.BoxGeometry(0.03, 0.34, 0.55), T(sx, 2.7, -2.6), sx > 0 ? 0x1d5fb4 : 0xf4f4f4);
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  out.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  out.computeBoundingSphere();
  return (_floatGeo = out);
}
let _floatMat = null;
const floatMat = () => _floatMat || (_floatMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.75, metalness: 0 }));

/** Dress a vehicle as the parade float (the decoration rides its body: v.tilt). */
export function dressFloat(v) {
  const mesh = new THREE.Mesh(floatGeometry(), floatMat());
  mesh.castShadow = true;
  mesh.userData.shared = true;   // traffic.remove: the geometry is everyone's
  mesh.name = 'storyFloat';
  (v.tilt || v.group).add(mesh);
  v.extra = mesh;
  v.isFloat = true;
  return mesh;
}

// ---------------------------------------------------------------------------
// A route as a polyline (Float32Array x, z pairs), with its running length
// ---------------------------------------------------------------------------
function makeLine(pts) {
  const n = pts.length / 2, cum = new Float32Array(n);
  for (let i = 1; i < n; i++) cum[i] = cum[i - 1] + Math.hypot(pts[i * 2] - pts[i * 2 - 2], pts[i * 2 + 1] - pts[i * 2 - 1]);
  return { pts: pts instanceof Float32Array ? pts : Float32Array.from(pts), cum, len: n > 1 ? cum[n - 1] : 0, n };
}
/** The point at distance s along a line (into `o`: x, z, and the direction dx, dz). */
function lineAt(L, s, o) {
  const n = L.n, P = L.pts, C = L.cum;
  s = clamp(s, 0, L.len);
  let i = 1;
  while (i < n - 1 && C[i] < s) i++;
  const l = C[i] - C[i - 1] || 1, t = (s - C[i - 1]) / l;
  const ax = P[i * 2 - 2], az = P[i * 2 - 1], bx = P[i * 2], bz = P[i * 2 + 1];
  o.x = ax + (bx - ax) * t; o.z = az + (bz - az) * t; o.dx = (bx - ax) / l; o.dz = (bz - az) / l;
  return o;
}
/** Where (x, z) projects onto the line, searching segments around index k0: { s, d, k }. */
function lineProj(L, x, z, k0, o) {
  const P = L.pts, n = L.n;
  let best = Infinity;
  const a0 = Math.max(0, k0 - 3), a1 = Math.min(n - 2, k0 + 12);
  for (let i = a0; i <= a1; i++) {
    const ax = P[i * 2], az = P[i * 2 + 1], sx = P[i * 2 + 2] - ax, sz = P[i * 2 + 3] - az, l2 = sx * sx + sz * sz || 1;
    const t = clamp(((x - ax) * sx + (z - az) * sz) / l2, 0, 1);
    const d = Math.hypot(ax + sx * t - x, az + sz * t - z);
    if (d < best) { best = d; o.s = L.cum[i] + t * Math.sqrt(l2); o.d = d; o.k = i; }
  }
  return o;
}
/** The polyline moved `off` m to the right of travel (a car keeps to its side). */
function offsetLine(L, off) {
  const P = L.pts, n = L.n, out = new Float32Array(n * 2);
  for (let i = 0; i < n; i++) {
    const i0 = Math.max(0, i - 1), i1 = Math.min(n - 1, i + 1);
    let tx = P[i1 * 2] - P[i0 * 2], tz = P[i1 * 2 + 1] - P[i0 * 2 + 1];
    const l = Math.hypot(tx, tz) || 1; tx /= l; tz /= l;
    // right of travel, in this frame (+x east, +z south, heading atan2(dx, dz)): (-tz, tx)
    out[i * 2] = P[i * 2] - tz * off; out[i * 2 + 1] = P[i * 2 + 1] + tx * off;
  }
  return makeLine(out);
}
const _o1 = {}, _o2 = {}, _o3 = {};

/** A driver along a route: pure pursuit, slowing for the turns ahead, backing
 *  out when wedged. `d.top` is its speed (m/s) this frame. */
function pathDrive(v, d, dt, cars) {
  const inp = d.inp;
  if (d.wait || !d.L) { inp.throttle = 0; inp.brake = 1; inp.steer = 0; inp.handbrake = 0; return inp; }
  const L = d.L, sp = Math.abs(v.vLong), f = v.forward;
  lineProj(L, v.x, v.z, d.k, _o1); d.k = _o1.k; d.s = _o1.s;
  const look = 7 + sp * 0.8;
  lineAt(L, d.s + look, _o2);
  lineAt(L, d.s + look + 30, _o3);
  // passing a car left standing in the lane: the aim point moves a lane to the left for a while
  if (d.passT > 0) { d.passT -= dt; _o2.x += _o2.dz * 3.4; _o2.z -= _o2.dx * 3.4; }
  const desired = Math.atan2(_o2.x - v.x, _o2.z - v.z);
  const err = angleWrap(desired - v.heading);
  const turn = Math.abs(angleWrap(Math.atan2(_o3.dx, _o3.dz) - Math.atan2(_o2.dx, _o2.dz)));
  let top = d.top * (v.health < (d.limpAt || 0) ? 0.55 : 1);
  top = Math.min(top, 8 + (1 - Math.min(1, turn / 1.4)) * (top - 8));
  if (Math.abs(err) > 0.5) top = Math.min(top, 9);
  if (d.s > L.len - 18) top = Math.min(top, Math.max(0, (L.len - d.s) * 0.6));
  // what is in the lane ahead: traffic that will move on (a polite driver -- the
  // tail's SUV, the race's Civic -- eases off for it, and after 6 s queued loses
  // patience for 4), or a car left standing (anyone pulls out and passes it)
  if (cars) {
    const t0 = top, polite = d.polite && (d.waitT || 0) < 6;
    for (let i = 0; i < cars.length; i++) {
      const o = cars[i];
      if (o === v) continue;
      const dx = o.x - v.x, dz = o.z - v.z;
      if (dx > 40 || dx < -40 || dz > 40 || dz < -40) continue;
      const al = dx * f.x + dz * f.z;
      if (al < 3 || al > 32 || Math.abs(dx * f.z - dz * f.x) > 2.4) continue;
      const moving = o.mode === 'traffic' || o.mode === 'police';
      if (moving && polite) top = Math.min(top, Math.max(0, Math.max(0, o.vLong) + (al - 9) * 0.5));
      else if (!moving && Math.abs(o.vLong) < 1 && al < 16 && !(d.passT > 0)) d.passT = 2.6;
    }
    if (d.polite) {
      if ((d.waitT || 0) < 6) d.waitT = top < 2.5 && t0 > 4 ? (d.waitT || 0) + dt : 0;
      else if ((d.waitT += dt) > 10) d.waitT = 0;
    }
  }
  inp.steer = clamp(err * 1.9, -1, 1);
  inp.handbrake = 0;
  if (d.revT > 0) { d.revT -= dt; inp.throttle = 0; inp.brake = 1; inp.steer = -inp.steer; return inp; }
  if (sp < 1 && top > 2) d.stuckT += dt; else d.stuckT = 0;
  if (d.stuckT > 1.6) { d.stuckT = 0; d.revT = 1.2; d.passT = 3; }
  inp.throttle = v.vLong < top ? clamp((top - v.vLong) * 0.35, 0.25, 1) : 0;
  inp.brake = v.vLong > top + 1.5 ? clamp((v.vLong - top) * 0.2, 0, 1) : top < 0.5 ? 1 : 0;
  return inp;
}

const fmtT = (s) => `${s < 0 ? '-' : ''}${Math.floor(Math.abs(s) / 60)}:${String(Math.floor(Math.abs(s) % 60)).padStart(2, '0')}`;
const fmtD = (m) => (m > 1000 ? `${(m / 1000).toFixed(1)} km` : `${Math.round(m / 10) * 10} m`);

// ---------------------------------------------------------------------------
export class Story {
  /**
   * o: { scene, city, game, hud, audio, traffic, police, respray, router (taxi.js),
   *      panel (LedPanel), fx, camera, events, busy: () => string|null }
   */
  constructor(o) {
    this.o = o;
    this.scene = o.scene; this.city = o.city; this.game = o.game; this.hud = o.hud; this.audio = o.audio;
    this.traffic = o.traffic; this.panel = o.panel;
    this.chapters = CHAPTERS;
    this.save = Object.assign({ done: [], best: {}, n: 0 }, read());
    if (!Array.isArray(this.save.done)) this.save.done = [];
    this.run = null;          // the chapter being played
    this.cut = null;          // a cutscene (the world is held)
    this.lines = [];          // subtitles queued over the running world
    this.line = null;
    this.failed = null;       // the chapter that just failed (RETRY)
    this.stats = { started: 0, passed: 0, failed: 0 };
    this.log = [];            // what happened, for the probe
    this._routeQ = [];        // A* jobs, one at a time (the scratch is shared)
    this._hinted = false;
    this.prize = null;        // the float, parked at the garage once the story is done
    this._prizeT = 0;
    this.giver = null; this.sign = null;
    GARAGE.y = this.city.groundAt(GARAGE.x, GARAGE.z, null);
    // the beam (the contact, and a mission's destination): one open cylinder
    this.beam = new THREE.Mesh(new THREE.CylinderGeometry(3, 3, 26, 16, 1, true).translate(0, 13, 0), new THREE.MeshBasicMaterial({
      color: 0xffc21a, transparent: true, opacity: 0.32, side: THREE.DoubleSide, forceSinglePass: true, depthWrite: false,
    }));
    this.beam.frustumCulled = false; this.beam.visible = false; this.beam.name = 'storyBeam';
    this.scene.add(this.beam);
    // the arrow over a target car
    const cg = new THREE.ConeGeometry(0.75, 1.5, 4, 1); cg.rotateX(Math.PI);
    this.arrow = new THREE.Mesh(cg, new THREE.MeshBasicMaterial({ color: 0xffb21e, transparent: true, opacity: 0.92, depthWrite: false, fog: false }));
    this.arrow.frustumCulled = false; this.arrow.visible = false; this.arrow.name = 'storyArrow';
    this.scene.add(this.arrow);
    // our cars ride traffic's 'suspect' mode: drive the ones that are ours
    const T = this.traffic, prev = T.suspectDriver;
    T.suspectDriver = (v, dt, px, pz, pl) => (v.story ? this.drive(v, dt, px, pz) : prev ? prev(v, dt, px, pz, pl) : null);
    this.ui();
  }

  warmMeshes() {
    const a = new THREE.Mesh(this.beam.geometry, this.beam.material); a.frustumCulled = false;
    const b = new THREE.Mesh(this.arrow.geometry, this.arrow.material); b.frustumCulled = false;
    return [a, b];
  }

  // --- what the rest of the game reads -----------------------------------------
  get active() { return !!this.cut; }   // reapHolds: the 'story' hold is a cutscene's
  get next() { return this.chapters.findIndex((c) => !this.save.done.includes(c.id)); }
  get complete() { return this.next < 0; }

  places() {
    return [{ x: GARAGE.x, z: GARAGE.z, kind: 'story', name: "Brubacher's Garage (KW Stories)", near: false, hello: () => this.hello() }];
  }

  hello() {
    const n = this.next;
    if (n < 0) return "Brubacher's Garage — the story is done. The float is parked out front; REPLAY a chapter from the menu";
    return `Brubacher's Garage — stop in the gold beam: KW Stories, chapter ${n + 1}, "${this.chapters[n].title}"`;
  }

  /** The pause menu's rows: { i, title, state: 'done'|'next'|'locked'|'run', best, pay }. */
  rows() {
    const n = this.next;
    return this.chapters.map((c, i) => ({
      i, title: c.title, pay: c.pay,
      state: this.run && this.run.i === i ? 'run' : this.save.done.includes(c.id) ? 'done' : i === n ? 'next' : 'locked',
      best: this.save.best[c.id] || null,
    }));
  }

  // --- the frame -----------------------------------------------------------------
  update(dt, player) {
    this.player = player;
    this._routeStep();
    this.subtitles(dt);
    const p = player.position;
    const dg = Math.hypot(p.x - GARAGE.x, p.z - GARAGE.z);
    this.tendGarage(dt, dg);
    if (!this.run) {
      if (this.failed && (this.failed.t -= dt) <= 0) this.hideRetry();
      const show = !this.complete && dg < BEAM_R;
      this.beam.visible = show;
      if (show) this.placeBeam(GARAGE.x, GARAGE.z, GARAGE.y, dt);
      if (show && dg < TRIGGER_R) {
        const v = player.vehicle && !player.onFoot ? player.vehicle : null;
        if (!v || Math.abs(v.vLong) < 2) {
          const why = this.blocked();
          if (!why) this.start(this.next);
          else if (!this._hinted) { this._hinted = true; this.hud.showToast(`Gord: "${why}"`, 3200); }
        }
      } else if (dg > 25) this._hinted = false;
      return;
    }
    this.tick(dt, player);
  }

  /** Why a chapter cannot start now (null: it can). */
  blocked() {
    const g = this.game;
    if (g.dead || g.held) return 'Not now.';
    if (g.wanted > 0) return 'Lose the cops first, kid. I run a respectable garage.';
    const b = this.o.busy && this.o.busy();
    if (b) return `Finish your ${b} first.`;
    return null;
  }

  // --- a chapter -----------------------------------------------------------------
  start(i, opts = {}) {
    const ch = this.chapters[i];
    if (!ch || this.run) return false;
    const why = this.blocked();
    if (why && !opts.force) { this.hud.showToast(`Gord: "${why}"`, 3200); return false; }
    const ev = this.o.events && this.o.events();
    if (ev && ev.cur) ev.stop();
    this.hideRetry();
    this.failed = null;
    this.run = { i, ch, k: -1, st: null, t: 0, cars: [], money0: this.game.money, cargo: null };
    this.game.story = ch.id;
    this.stats.started++;
    this.save.n = (this.save.n || 0) + 1; this.persist();
    this.log.push(`start ${ch.id}`);
    // on foot at the garage, and the chapter wants a car: Gord's old Volvo, at the kerb of the
    // lot (an ordinary 'free' car: traffic takes it away once you leave it far behind)
    const pl = this.player;
    if (pl && pl.onFoot && ch.steps[0].car && Math.hypot(pl.position.x - GARAGE.x, pl.position.z - GARAGE.z) < 150) {
      try {
        const r = this.roadPt(GARAGE.x, GARAGE.z - 12, 60);
        this.traffic.spawnAt(r.x, r.z, this.roadHeading(r.x, r.z), 'volvo', 0x6b2a1f, 'free');
        this.say([['gord', 'Take my old Volvo, it is at the curb. Keys are in it. Do not touch the radio.']]);
      } catch (e) { /* no car: walk to one */ }
    }
    // the routes a chapter's AI drives are known now: find them while you get there
    for (const s of ch.steps) if (s.from && s.to) this.routeLater(s, s.from[0], s.from[1], s.to[0], s.to[1]);
    const go = () => {
      this.title(`${i + 1} · ${ch.title.toUpperCase()}`);
      this.nextStep();
    };
    if (opts.skipIntro || !ch.intro) { this.say(ch.intro ? ch.intro.slice(-1) : []); go(); }
    else this.cutscene(ch.intro, go);
    if (this.audio && this.audio.ready) this.audio.ui('start');
    return true;
  }

  nextStep() {
    const run = this.run;
    if (!run) return;
    if (run.st) this.endStep(run.st);
    run.k++;
    if (run.k >= run.ch.steps.length) { run.st = null; this.pass(); return; }
    const p = run.ch.steps[run.k];
    const st = run.st = { p, t: 0, kind: p.k };
    this.log.push(`step ${run.ch.id}.${run.k} ${p.k}`);
    if (p.say) this.say(p.say);
    STEPS[p.k].begin(this, st, this.player);
  }

  endStep(st) {
    const E = STEPS[st.kind];
    if (E && E.end) E.end(this, st);
    if (st.p.done && this.run && this.run.st === st && !st.failed) this.say(st.p.done);
  }

  tick(dt, player) {
    const run = this.run, st = run.st;
    run.t += dt;
    if (!st) return;
    st.t += dt;
    if (this.game.dead) { this.fail(this.game.busted ? 'BUSTED' : 'WASTED'); return; }
    const r = STEPS[st.kind].tick(this, st, dt, player);
    if (r === true) this.nextStep();
    else if (typeof r === 'string') this.fail(r);
    if (this.arrow.visible) { this.arrow.rotation.y += dt * 2; }
  }

  pass() {
    const run = this.run, ch = run.ch;
    if (ch.outro) {
      // the finale's party: held, at the garage, with fireworks
      this.cutscene(ch.outro, () => this.payOut(run), { party: true });
      return;
    }
    this.payOut(run);
  }

  payOut(run) {
    const ch = run.ch;
    const first = !this.save.done.includes(ch.id);
    const pay = CHEAT.on ? 0 : first ? ch.pay : Math.round(ch.pay / 4);   // (a cheated session earns no bonus money: cheats.js)
    this.game.money += pay;
    if (first) this.save.done.push(ch.id);
    const t = Math.round(run.t);
    if (!this.save.best[ch.id] || t < this.save.best[ch.id]) this.save.best[ch.id] = t;
    this.persist();
    this.stats.passed++;
    this.log.push(`pass ${ch.id} ${t}s`);
    this.cleanup();
    const last = this.complete && first && ch.id === 'prost';
    this.hud.showToast(`MISSION PASSED — ${ch.title} · ${formatMoney(pay)}${first ? '' : ' (replay)'}${last ? ' · THE FLOAT IS YOURS: parked at Brubacher\'s Garage' : ''}`, last ? 7000 : 4200);
    this.title(`MISSION PASSED`, formatMoney(pay));
    if (this.audio && this.audio.ready) { this.audio.cash(); this.audio.ui('go'); }
    const n = this.next;
    if (n >= 0 && first) setTimeout(() => { if (!this.run) this.hud.showToast(`KW Stories: chapter ${n + 1}, "${this.chapters[n].title}" — back at Brubacher's Garage`, 4200); }, 4600);
  }

  fail(why) {
    const run = this.run;
    if (!run) return;
    if (run.st) run.st.failed = true;
    this.stats.failed++;
    this.log.push(`fail ${run.ch.id}: ${why}`);
    const i = run.i;
    this.cleanup();
    this.failed = { i, why, t: 12 };
    this.hud.showToast(`MISSION FAILED — ${why}`, 4200);
    this.title('MISSION FAILED', why);
    this.showRetry(i);
    if (this.audio && this.audio.ready) this.audio.ui('fail');
  }

  /** Quit the chapter (the menu). */
  quit() { if (this.run) this.fail('You walked away from the job'); }

  replay(i) { if (this.run) return false; return this.start(i, { skipIntro: false }); }

  retry() {
    const f = this.failed;
    if (!f || this.run) return false;
    return this.start(f.i, { skipIntro: true });
  }

  /** Everything a chapter made goes: cars, markers, the route, the panel, the hold. */
  cleanup() {
    const run = this.run;
    if (run && run.st) { const E = STEPS[run.st.kind]; if (E && E.end) E.end(this, run.st); run.st = null; }
    if (run) {
      const pv = this.player && this.player.vehicle;
      for (const v of run.cars) {
        v.story = null; v.suspect = null;
        if (!this.traffic.cars.includes(v)) continue;
        // the car you are in stays yours; a wreck stays a wreck a while; the rest go
        if (v === pv) { if (v.mode === 'suspect') v.mode = 'free'; continue; }
        this.traffic.remove(v);
      }
      run.cars.length = 0;
    }
    this.run = null;
    this.game.story = null;
    this.game.storyPays = false;
    this.beam.visible = false;
    this.arrow.visible = false;
    this.hud.fare = null;
    this.hud.suspects = null;
    this.hud.setObjective('');
    if (this.panel) this.panel.hide();
    this._routeQ.length = 0;
    this.lines.length = 0;
    if (this.cut) this.endCut(true);
  }

  persist() { try { localStorage.setItem(KEY, JSON.stringify(this.save)); } catch (e) { /* private mode */ } }

  /** Crash hook (main.js game.onCrash): a story step's cargo, a tail's cover. */
  onCrash(impact, other) {
    const st = this.run && this.run.st;
    if (!st) return;
    const E = STEPS[st.kind];
    if (E && E.crash) E.crash(this, st, impact, other);
  }

  // --- helpers the steps share -----------------------------------------------------
  placeBeam(x, z, y, dt) {
    this.beam.position.set(x, y != null ? y : this.city.groundAt(x, z, null), z);
    this.beam.visible = true;
    this.beam.rotation.y += (dt || 0) * 0.6;
    this.beam.material.opacity = 0.24 + Math.sin(performance.now() * 0.004) * 0.08;
  }

  setObj(t) { if (t !== this._obj) { this._obj = t; this.hud.setObjective(t); } }

  led(mid, bot) { if (this.panel && this.run) this.panel.show(`KW STORIES · ${this.run.i + 1} · ${this.run.ch.title}`, mid, bot || '', '#ffc21a'); }

  /** A road point near (x, z) (a kerb a car can stand at). */
  roadPt(x, z, r = 150) {
    const sp = this.city.respawnPointNear(x, z, r);
    return sp ? { x: sp.x, z: sp.z } : { x, z };
  }

  /** Spawn one of the chapter's cars (traffic 'suspect' mode, ours: v.story). */
  spawnCar(x, z, h, type, color, st) {
    const v = this.traffic.spawnAt(x, z, h, type, color, 'suspect');
    v.story = st || true;
    this.run.cars.push(v);
    return v;
  }

  /** The heading along the road at a road point: the edge nearest it. */
  roadHeading(x, z, tx, tz) {
    let best = null, bd = Infinity;
    for (const ei of this.city.edgesNear(x, z, 30)) {
      const e = this.city.edges[ei];
      if (e.elev || e.tunnel) continue;
      const a = this.city.nodes[e.a], b = this.city.nodes[e.b];
      const sx = b.x - a.x, sz = b.z - a.z, l2 = sx * sx + sz * sz || 1, t = clamp(((x - a.x) * sx + (z - a.z) * sz) / l2, 0, 1);
      const d = Math.hypot(a.x + sx * t - x, a.z + sz * t - z);
      if (d < bd) { bd = d; best = { sx, sz }; }
    }
    if (!best) return Math.atan2(tx - x, tz - z);
    let h = Math.atan2(best.sx, best.sz);
    if (tx != null && Math.cos(h - Math.atan2(tx - x, tz - z)) < 0) h += Math.PI;
    return h;
  }

  /** A street route from (x, z) to (tx, tz), found a little a frame; cb(line). */
  routeLater(key, x, z, tx, tz, cb) {
    const job = { key, x, z, tx, tz, cb, job: null, line: null, done: false };
    key.route = job;
    this._routeQ.push(job);
    return job;
  }

  _routeStep() {
    const q = this._routeQ[0];
    if (!q) return;
    const R = this.o.router;
    if (!q.job) {
      const from = R ? R.mainNode(q.x, q.z, 250) : -1, to = R ? R.mainNode(q.tx, q.tz, 300) : -1;
      if (from < 0 || to < 0 || from === to) { this._routeDone(q, null); return; }
      q.job = R.pathJob(from, to, ROUTE_LIMIT);
    }
    const r = q.job.step(ROUTE_BUDGET);
    if (r === 'run') return;
    this._routeDone(q, r === 'found' ? q.job.path : null);
  }

  _routeDone(q, path) {
    this._routeQ.shift();
    let pts;
    // (an AI's route ends on the street; a route on the map runs on to the place itself)
    if (path && path.length > 1) { pts = this.o.router.routeOf(path, q.x, q.z).pts; if (!q.key.from) pts.push(q.tx, q.tz); }
    else pts = [q.x, q.z, q.tx, q.tz];   // (no street route: the straight line)
    q.line = makeLine(Float32Array.from(pts));
    q.ok = !!path;
    q.done = true;
    if (q.cb) q.cb(q.line);
  }

  /** The same route, now (a probe): a line. */
  routeNow(x, z, tx, tz) {
    const R = this.o.router;
    const from = R.mainNode(x, z, 250), to = R.mainNode(tx, tz, 300);
    const path = from >= 0 && to >= 0 ? R.pathJob(from, to, ROUTE_LIMIT).finish() : null;
    const pts = path ? R.routeOf(path, x, z).pts : [x, z];
    pts.push(tx, tz);
    return makeLine(Float32Array.from(pts));
  }

  showRoute(line, dest) {
    this.hud.fare = { hail: null, dest: dest ? { x: dest.x, z: dest.z } : null, route: line ? line.pts : null };
  }

  /** The cone over a target car, scaled to read from a block away. */
  pointAt(v, dist) {
    const a = this.arrow;
    if (!v) { a.visible = false; return; }
    a.visible = true;
    a.position.set(v.x, v.y + (v.spec.roof || 1.5) + 1.8 + Math.sin(performance.now() * 0.005) * 0.25, v.z);
    a.scale.setScalar(clamp(dist / 70, 1, 4));
  }

  /** Our cars' driving (traffic.js, mode 'suspect' with `v.story`). */
  drive(v, dt, px, pz) {
    const d = v.storyDrive;
    if (!d) return IDLE;
    if (d.flee) return getaway(this.city, this.traffic, v, d.flee, dt, px, pz);
    return pathDrive(v, d, dt, this.traffic.cars);
  }

  // --- words -------------------------------------------------------------------------
  ui() {
    if (typeof document === 'undefined') return;
    const app = document.getElementById('app') || document.body;
    const css = document.createElement('style');
    // #storySub: centred, but never under the pad (its leftmost button, MISSION, is ~330 px in
    // from the right; a fire rig's WATER + MISSION ~414): on a phone the centre moves left
    css.textContent = `
#storySub{position:absolute;left:min(50%,calc(100% - 340px - env(safe-area-inset-right) - min(23vw,210px)));bottom:calc(14px + env(safe-area-inset-bottom));transform:translateX(-50%);display:none;align-items:center;gap:10px;
  max-width:min(46vw,420px);padding:7px 12px 7px 7px;border-radius:12px;background:rgba(10,14,20,0.78);border:1px solid rgba(255,194,26,0.35);
  color:#fff;font:600 13px/1.3 system-ui,sans-serif;pointer-events:none;z-index:7;backdrop-filter:blur(8px);-webkit-backdrop-filter:blur(8px)}
#app[data-fire="1"] #storySub{left:min(50%,calc(100% - 424px - env(safe-area-inset-right) - min(23vw,210px)))}
#storySub img{width:46px;height:46px;border-radius:50%;flex:none;border:2px solid rgba(255,255,255,0.7)}
#storySub b{display:block;font-size:11px;letter-spacing:.06em;color:#ffc21a;margin-bottom:1px}
#storyCut{position:absolute;inset:0;z-index:44;display:none;pointer-events:auto}
#storyCut .bar{position:absolute;left:0;right:0;height:11vh;background:#000}
#storyCut .top{top:0}#storyCut .bot{bottom:0}
#storyCut .card{position:absolute;left:50%;bottom:calc(13vh + env(safe-area-inset-bottom));transform:translateX(-50%);display:flex;gap:14px;align-items:center;
  width:min(80vw,640px);padding:12px 16px 12px 12px;border-radius:14px;background:rgba(10,14,20,0.82);border:1px solid rgba(255,194,26,0.45);color:#fff;font:600 16px/1.35 system-ui,sans-serif}
#storyCut .card img{width:72px;height:72px;border-radius:50%;flex:none;border:2px solid rgba(255,255,255,0.8)}
#storyCut .card b{display:block;font-size:12px;letter-spacing:.08em;color:#ffc21a;margin-bottom:2px}
#storyCut .ttl{position:absolute;left:0;right:0;top:calc(2.5vh + env(safe-area-inset-top));text-align:center;color:#ffc21a;font:900 14px system-ui,sans-serif;letter-spacing:.2em}
#storyCut .tap{position:absolute;right:calc(18px + env(safe-area-inset-right));bottom:calc(3.5vh + env(safe-area-inset-bottom));color:#fff;opacity:.7;font:600 12px system-ui,sans-serif}
#storyTitle{position:absolute;left:50%;top:46%;transform:translate(-50%,-50%);text-align:center;color:#ffc21a;font:900 min(7vw,44px) system-ui,sans-serif;letter-spacing:.08em;
  text-shadow:0 3px 14px rgba(0,0,0,0.85);pointer-events:none;opacity:0;transition:opacity .4s;z-index:7;white-space:nowrap}
#storyTitle small{display:block;font-size:min(3vw,17px);color:#fff;letter-spacing:.02em;margin-top:6px;font-weight:700}
#storyRetry{position:absolute;left:50%;top:calc(50% + 34px);transform:translateX(-50%);display:none;z-index:8;padding:10px 22px;border-radius:22px;
  background:rgba(200,140,10,0.85);border:1px solid #ffe08a;color:#fff;font:800 15px system-ui,sans-serif;letter-spacing:.1em}`;
    document.head.appendChild(css);
    const sub = document.createElement('div'); sub.id = 'storySub';
    sub.innerHTML = '<img alt=""><div><b></b><span></span></div>';
    const cut = document.createElement('div'); cut.id = 'storyCut';
    cut.innerHTML = '<div class="bar top"></div><div class="bar bot"></div><div class="ttl"></div><div class="card"><img alt=""><div><b></b><span></span></div></div><div class="tap">tap ▸</div>';
    const ttl = document.createElement('div'); ttl.id = 'storyTitle';
    const retry = document.createElement('button'); retry.id = 'storyRetry'; retry.textContent = 'RETRY';
    app.append(sub, cut, ttl, retry);
    this.el = { sub, subImg: sub.querySelector('img'), subWho: sub.querySelector('b'), subTxt: sub.querySelector('span'),
      cut, cutTtl: cut.querySelector('.ttl'), cutImg: cut.querySelector('.card img'), cutWho: cut.querySelector('.card b'), cutTxt: cut.querySelector('.card span'), ttl, retry };
    // a tap anywhere on the cutscene: the next line (pointerdown, never a held pointer)
    cut.addEventListener('pointerdown', (e) => { e.preventDefault(); e.stopPropagation(); this.advance(); });
    retry.addEventListener('pointerdown', (e) => { e.preventDefault(); e.stopPropagation(); this.retry(); });
    window.addEventListener('keydown', (e) => {
      if (this.cut && (e.code === 'Enter' || e.code === 'Space' || e.code === 'KeyF' || e.code === 'KeyE')) { e.preventDefault(); this.advance(); }
      else if (this.failed && !this.run && e.code === 'KeyY' && !e.repeat) this.retry();
    });
  }

  title(t, sub) {
    const el = this.el && this.el.ttl;
    if (!el) return;
    el.innerHTML = '';
    el.append(t);
    if (sub) { const s = document.createElement('small'); s.textContent = sub; el.append(s); }
    el.style.opacity = '1';
    clearTimeout(this._ttlT);
    this._ttlT = setTimeout(() => { el.style.opacity = '0'; }, 2600);
  }

  showRetry() { if (this.el) this.el.retry.style.display = 'block'; }
  hideRetry() { if (this.el) this.el.retry.style.display = 'none'; }

  /** Subtitles over the running world: one line at a time. */
  say(lines) { for (const l of lines || []) this.lines.push(l); }

  subtitles(dt) {
    if (this.line) {
      this.line.t -= dt;
      if (this.line.t > 0) return;
      this.line = null;
    }
    const l = this.lines.shift();
    if (!l) { if (this.el && this.el.sub.style.display !== 'none') this.el.sub.style.display = 'none'; return; }
    this.line = { l, t: Math.max(2.8, l[1].length * 0.06) };
    if (!this.el) return;
    const c = CAST[l[0]] || CAST.gord;
    this.el.subImg.src = portrait(l[0]);
    this.el.subWho.textContent = c.name.toUpperCase();
    this.el.subTxt.textContent = l[1];
    this.el.sub.style.display = 'flex';
    if (l[0] === 'gerald' && this.audio && this.audio.ready) this.audio.play('goose', { gain: 0.5 });
  }

  // --- cutscenes (the world held) --------------------------------------------------------
  cutscene(lines, onDone, opts = {}) {
    if (this.cut) this.endCut(true);
    this.game.hold('story');
    const p = this.player ? this.player.position : { x: GARAGE.x, z: GARAGE.z };
    const atGarage = Math.hypot(p.x - GARAGE.x, p.z - GARAGE.z) < 120;
    this.cut = { lines: lines.slice(), i: -1, t: 0, lt: 0, onDone, party: !!opts.party,
      cx: atGarage ? GARAGE.gx : p.x, cz: atGarage ? GARAGE.gz : p.z, a0: atGarage ? GARAGE.face : (this.player ? this.player.camYaw : 0) };
    if (atGarage) this.buildGiver();
    this.beam.visible = false;
    if (this.panel) this.panel.hide();
    if (this.el) { this.el.cut.style.display = 'block'; this.el.cutTtl.textContent = this.run ? `KW STORIES · ${this.run.i + 1} · ${this.run.ch.title.toUpperCase()}` : 'KW STORIES'; }
    if (this.el) this.el.sub.style.display = 'none';
    this.advance();
  }

  advance() {
    const C = this.cut;
    if (!C) return;
    if (C.i >= 0 && C.lt < 0.25) return;   // (a double tap is not two lines)
    C.i++; C.lt = 0;
    if (C.i >= C.lines.length) { this.endCut(false); return; }
    const l = C.lines[C.i], c = CAST[l[0]] || CAST.gord;
    if (this.el) {
      this.el.cutImg.src = portrait(l[0]);
      this.el.cutWho.textContent = c.name.toUpperCase();
      this.el.cutTxt.textContent = l[1];
    }
    if (l[0] === 'gerald' && this.audio && this.audio.ready) this.audio.play('goose', { gain: 0.6 });
    else if (this.audio && this.audio.ready) this.audio.ui('tick');
  }

  /** While held (main.js, before the pause check): the camera turns slowly round the scene. */
  cutUpdate(dt) {
    const C = this.cut;
    if (!C) return;
    C.t += dt; C.lt += dt;
    const ctl = this.o.controls;
    if (ctl && ctl.takeTap && ctl.takeTap()) this.advance();
    if (!this.cut) return;
    // a line reads itself out in its time, then moves on (a tap is quicker)
    const l = C.lines[C.i];
    if (l && C.lt > Math.max(4.5, l[1].length * 0.075)) this.advance();
    if (!this.cut) return;
    const cam = this.o.camera;
    if (cam) {
      // from the lot, a little to one side, drifting slowly
      const a = C.a0 + 0.42 + Math.sin(C.t * 0.12) * 0.22, R = 13 - Math.min(3, C.t * 0.12), gy = this.city.groundAt(C.cx, C.cz, null);
      cam.position.set(C.cx + Math.sin(a) * R, gy + 2.4, C.cz + Math.cos(a) * R);
      cam.lookAt(C.cx, gy + 2.0, C.cz);
    }
    if (this.giver) this.poseGiver(dt, true);
    if (C.party && this.o.fx) this.o.fx.update(dt);   // (the held world does not run fx)
    if (C.party && this.o.fx && (C.fw = (C.fw || 0) - dt) <= 0) {
      C.fw = 0.45;
      const f = this.o.fx, gy = this.city.groundAt(GARAGE.x, GARAGE.z, null);
      const x = GARAGE.gx + (Math.random() - 0.5) * 36, z = GARAGE.gz + 8 + Math.random() * 14;   // (over the garage's roof, in the cutscene's view)
      const col = [[1, 0.8, 0.2], [0.3, 0.6, 1], [1, 1, 1], [1, 0.3, 0.3]][Math.floor(Math.random() * 4)];
      f.emit(x, gy + 13 + Math.random() * 5, z, 40, { r: col[0], g: col[1], b: col[2], size: 0.5, life: 1.3, spread: 9, vy: 0, grav: 2.5, jitter: 4 });
      if (this.audio && this.audio.ready) this.audio.play('explosion', { x, y: gy + 25, z, gain: 0.35, rate: 1.3, send: 0.5 });
    }
  }

  endCut(abort) {
    const C = this.cut;
    this.cut = null;
    this.game.release('story');
    if (this.el) this.el.cut.style.display = 'none';
    if (!abort && C && C.onDone) C.onDone();
  }

  skipCut() { let n = 0; while (this.cut && n++ < 20) { if (this.cut) this.cut.lt = 1; this.advance(); } }

  // --- the garage: Gord at his door, the sign, the prize ------------------------------------
  buildGiver() {
    if (this.giver) return;
    // Gord: grey hair under a green Tyrolean-ish hat, a blue work shirt, dark trousers (his own geometry)
    const h = makeHumanoid({ unique: true, seed: 3121, hair: [0.72, 0.72, 0.7], shirt: [0.13, 0.27, 0.56], pants: [0.14, 0.14, 0.15], hat: [0.16, 0.3, 0.13] });
    const y = this.city.groundAt(GARAGE.gx, GARAGE.gz, null);
    h.group.position.set(GARAGE.gx, y, GARAGE.gz);
    h.group.rotation.y = GARAGE.face;
    h.group.name = 'storyGord';
    this.scene.add(h.group);
    this.giver = h;
    if (!this.sign) this.buildSign();
  }

  dropGiver() {
    if (!this.giver) return;
    this.scene.remove(this.giver.group);
    this.giver.dispose();
    this.giver = null;
  }

  poseGiver(dt, talk) {
    const h = this.giver;
    h.t += dt;
    if (talk || (this.player && Math.hypot(this.player.position.x - GARAGE.gx, this.player.position.z - GARAGE.gz) < 30)) hailPose(h, h.t);
  }

  buildSign() {
    const cv = document.createElement('canvas'); cv.width = 512; cv.height = 128;
    const g = cv.getContext('2d');
    g.fillStyle = '#1d3f73'; g.fillRect(0, 0, 512, 128);
    g.fillStyle = '#f4f4f4'; for (let i = 0; i < 16; i++) { g.beginPath(); const x = i * 32; g.moveTo(x, 104); g.lineTo(x + 16, 92); g.lineTo(x + 32, 104); g.lineTo(x + 16, 116); g.fill(); }
    g.fillStyle = '#ffc21a'; g.textAlign = 'center'; g.textBaseline = 'middle';
    let fs = 54; g.font = `900 ${fs}px Georgia, serif`;
    while (fs > 20 && g.measureText("BRUBACHER'S GARAGE").width > 484) { fs -= 2; g.font = `900 ${fs}px Georgia, serif`; }   // (fit the canvas: the name ran off both ends)
    g.fillText("BRUBACHER'S GARAGE", 256, 44);
    g.fillStyle = '#ffffff'; g.font = '700 17px system-ui, sans-serif'; g.fillText('FLOATS · REPAIRS · SINCE 1975', 256, 82);
    const tex = new THREE.CanvasTexture(cv);
    if (THREE.SRGBColorSpace) tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 4;
    const m = new THREE.Mesh(new THREE.PlaneGeometry(7.2, 1.8), new THREE.MeshBasicMaterial({ map: tex }));
    // up on the roof's front edge, over the arcade's fascia (the strip's wall is 6 m, its roof maybe more)
    const y = this.city.groundAt(GARAGE.signX, GARAGE.signZ, null);
    const roof = Math.max(y + 6, this.city.roofUnder(GARAGE.signX - Math.sin(GARAGE.face) * 2, GARAGE.signZ - Math.cos(GARAGE.face) * 2, y + 30, 0));
    m.position.set(GARAGE.signX - Math.sin(GARAGE.face) * 0.6, roof + 1.05, GARAGE.signZ - Math.cos(GARAGE.face) * 0.6);
    m.rotation.y = GARAGE.face;
    m.name = 'storySign';
    this.scene.add(m);
    this.sign = m;
  }

  /** Lazily: Gord within GIVER_R; the float parked out front once the story is done. */
  tendGarage(dt, dg) {
    if (dg < GIVER_R) { this.buildGiver(); if (!this.cut) this.poseGiver(dt, false); }
    else if (this.giver && !this.cut) this.dropGiver();
    if (this.sign) this.sign.visible = dg < 600;
    if (!this.complete || (this._prizeT -= dt) > 0) return;
    this._prizeT = 1;
    if (dg > 320) return;
    const v = this.prize, pv = this.player && this.player.vehicle;
    if (v && !v.dead && this.traffic.cars.includes(v)) return;
    if (v && v === pv) return;
    const x = GARAGE.x + 8, z = GARAGE.z - 6;
    try {
      const nv = this.traffic.spawnAt(x, z, GARAGE.face + Math.PI / 2, 'pickup', 0x1d5fb4, 'apron');
      dressFloat(nv); nv.vLong = 0;
      this.prize = nv;
    } catch (e) { this.prize = null; }
  }
}

const IDLE = { throttle: 0, brake: 1, steer: 0, handbrake: 0 };

// ---------------------------------------------------------------------------
// The step kinds: begin / tick (true: done, a string: failed) / end / crash
// ---------------------------------------------------------------------------
const roadCar = (pl) => { const v = pl.vehicle; return !!(v && !pl.onFoot && !v.dead && (v.spec.roadCar || v.spec.moto) && !v.spec.bicycle); };

const STEPS = {
  // Drive somewhere (a route on the map, the beam): optionally stop there, on a
  // clock, with cargo that spills (lateral g, hard braking, landings, crashes).
  go: {
    begin(S, st, pl) {
      const p = st.p, at = p.at;
      st.dest = { x: at[0], z: at[1] };
      st.cond = 100; st.warned = 0; st.feel = null; st.air = 0; st.cd = 0;
      st.left = null;
      const px = pl.position.x, pz = pl.position.z;
      S.showRoute(null, st.dest);
      S.routeLater(st, px, pz, st.dest.x, st.dest.z, (L) => {
        if (S.run && S.run.st === st) S.showRoute(L, st.dest);
        if (p.time) st.left = p.time(L.len);
      });
      if (p.time) st.left = p.time(Math.hypot(st.dest.x - px, st.dest.z - pz) * 1.35);   // until the route is in
      if (p.cargo && S.audio && S.audio.ready) S.audio.ui('check');
    },
    tick(S, st, dt, pl) {
      const p = st.p, pos = pl.position, v = pl.vehicle && !pl.onFoot ? pl.vehicle : null;
      S.placeBeam(st.dest.x, st.dest.z, null, dt);
      if (st.left != null) { st.left -= dt; if (st.left <= 0) return p.timeFail || 'Out of time'; }
      if (p.cargo && v) {
        st.cd -= dt;
        const f = (st.feel || (st.feel = new Feel())).step(dt, v);
        let loss = 0;
        if (Math.abs(v.vLong) > 3) {
          if (f.lat > 4.5) loss += (f.lat - 4.5) * 0.45 * dt;
          const dec = -f.along * Math.sign(v.vLong);
          if (dec > 8) loss += (dec - 8) * 0.4 * dt;
        }
        if (v.airborne) st.air += dt; else { if (st.air > 0.35) loss += 6 + st.air * 10; st.air = 0; }
        if (loss > 0) spill(S, st, loss);
        if (st.cond <= 0) return `You spilled the ${p.cargo.what}`;
      }
      if (p.goose && S.audio && S.audio.ready && (st.honk = (st.honk || 6) - dt) <= 0) { st.honk = 7 + Math.random() * 6; S.audio.play('goose', { gain: 0.35 }); }
      const d = Math.hypot(st.dest.x - pos.x, st.dest.z - pos.z);
      const there = d < p.r && (!p.stop || !v || Math.abs(v.vLong) < 2.5) && (!p.car || roadCar(pl) || !v);
      if (there && (!p.car || roadCar(pl))) {
        if (p.snatch) snatch(S, pl);
        if (p.thanks) thanks(S);
        if (p.goose) goodbyeGoose(S, pl);
        return true;
      }
      const tl = st.left != null ? ` · ${fmtT(st.left)}` : '';
      const cg = p.cargo ? ` · ${p.cargo.what} ${Math.round(st.cond)}%` : '';
      S.setObj(p.car && !roadCar(pl) ? 'Get a car' : p.obj);
      S.led(p.car && !roadCar(pl) ? 'Get a car' : p.obj, `${fmtD(d)}${tl}${cg}`);
      return null;
    },
    crash(S, st, impact) {
      if (!st.p.cargo || st.cd > 0 || impact < 4) return;
      st.cd = 0.8;
      spill(S, st, Math.min(45, impact * 2.2));
    },
  },

  // A car fleeing you (the getaway driver): ram it to a stop or a wreck.
  chase: {
    begin(S, st, pl) {
      const p = st.p, pos = pl.position, city = S.city, T = S.traffic;
      let spot = null;
      const pool = city.edgesNear(pos.x, pos.z, 360);
      for (let i = 0; i < 200 && !spot && pool.length; i++) {
        const ei = pool[Math.floor(Math.random() * pool.length)], e = city.edges[ei];
        if (!e || e.elev || e.tunnel || e.cls === 'hwy' || e.cls === 'ramp' || (e.cls === 'res' && i < 100) || e.noTraffic) continue;
        const a = city.nodes[e.a], b = city.nodes[e.b], x = (a.x + b.x) / 2, z = (a.z + b.z) / 2;
        const d = Math.hypot(x - pos.x, z - pos.z);
        if (d < 90 || d > 220 || (T.wet && T.wet(x, z))) continue;
        const sg = Math.hypot(b.x - pos.x, b.z - pos.z) > Math.hypot(a.x - pos.x, a.z - pos.z) ? 1 : -1;
        const far = city.nodes[sg > 0 ? e.b : e.a];
        if (!far || far.e.length < 3) continue;
        spot = { x, z, h: Math.atan2(e.dx * sg, e.dz * sg), node: sg > 0 ? e.b : e.a, prev: sg > 0 ? e.a : e.b };
      }
      if (!spot) { const r = S.roadPt(pos.x + 150, pos.z, 200); spot = { x: r.x, z: r.z, h: 0, node: -1, prev: -1 }; }
      const v = S.spawnCar(spot.x, spot.z, spot.h, p.type, p.color, st);
      v.health = p.hp; v.vLong = 10;
      const fl = getawayState(spot.node >= 0 ? spot.node : S.nearNode(spot.x, spot.z), spot.prev, p.speed, p.hp * 0.35);
      fl.stopT = 0;
      v.storyDrive = { flee: fl };
      v.suspect = fl;   // (traffic's hazards and main.js's "ramming a suspect is no crime" read it)
      st.v = v; st.stopT = 0; st.farT = 0;
      S.hud.suspects = [v];
    },
    tick(S, st, dt, pl) {
      const v = st.v, pos = pl.position;
      const gone = !S.traffic.cars.includes(v);
      const d = Math.hypot(v.x - pos.x, v.z - pos.z);
      if (v.dead || gone) return true;
      if (Math.abs(v.vLong) < 1.2 && d < STOP_R) st.stopT += dt; else st.stopT = Math.max(0, st.stopT - dt);
      v.storyDrive.flee.stopT = st.stopT;
      if (st.stopT > STOP_T) return true;
      if (d > 700) st.farT += dt; else st.farT = 0;
      if (st.farT > 15) return 'The van got away';
      if (st.p.honk && S.audio && S.audio.ready && d < 140 && (st.honk = (st.honk || 2) - dt) <= 0) { st.honk = 3 + Math.random() * 3; S.audio.play('goose', { gain: 0.6, x: v.x, y: v.y + 1, z: v.z }); }
      S.pointAt(v, d);
      S.setObj(st.p.obj);
      S.led(st.p.obj, `${fmtD(d)} · van ${Math.max(0, Math.round(v.health / st.p.hp * 100))}%${st.stopT > 0 ? ' · STOPPED' : ''}${st.farT > 0 ? ` · getting away ${Math.ceil(15 - st.farT)}` : ''}`);
      return null;
    },
    end(S, st) {
      const v = st.v;
      if (v) { v.storyDrive = null; v.suspect = null; if (S.traffic.cars.includes(v) && !v.dead) { v.mode = 'free'; v.vLong *= 0.3; } }
      S.hud.suspects = null; S.pointAt(null);
    },
  },

  // Follow a car along its route: inside `near` it gets suspicious, past `far` you lose it.
  tail: {
    begin(S, st, pl) { st.sus = 0; st.lostT = 0; st.v = null; st.grace = 4; },
    tick(S, st, dt, pl) {
      const p = st.p, pos = pl.position;
      if (!st.v) {
        const R = p.route;
        S.setObj('Wait for Chad to pull out');
        S.led('Chad is getting in his SUV…', '');
        if (!R || !R.done) return null;
        const L = offsetLine(R.line, 1.8);
        // (not on top of you: the first point along his way 40 m+ from you)
        let s0 = 0;
        for (; s0 < Math.min(400, L.len - 50); s0 += 10) { lineAt(L, s0, _o1); if (Math.hypot(_o1.x - pos.x, _o1.z - pos.z) > 40) break; }
        lineAt(L, s0, _o1);
        const v = S.spawnCar(_o1.x, _o1.z, Math.atan2(_o1.dx, _o1.dz), p.type, p.color, st);
        let k0 = 0;
        while (k0 < L.n - 2 && L.cum[k0 + 1] < s0) k0++;
        v.storyDrive = { L, k: k0, s: s0, top: p.speed, polite: true, inp: { throttle: 0, brake: 0, steer: 0, handbrake: 0 }, stuckT: 0, revT: 0 };
        v.health = 400;   // (a bump from traffic must not end the tail)
        st.v = v; st.L = L;
        S.showRoute(null, null);
        S.hud.suspects = [v];
        if (S.audio && S.audio.ready) S.audio.ui('ring');
        return null;
      }
      const v = st.v;
      if (v.dead || !S.traffic.cars.includes(v)) return 'You wrecked the car you were meant to follow';
      const d = Math.hypot(v.x - pos.x, v.z - pos.z);
      st.grace -= dt;
      if (st.grace <= 0) {
        if (d < p.near) st.sus += dt * 0.32 * (1 + (p.near - d) / p.near); else st.sus = Math.max(0, st.sus - dt * 0.06);
        if (d > p.far) st.lostT += dt; else st.lostT = Math.max(0, st.lostT - dt * 2);
      }
      if (st.sus >= 1) return 'Chad spotted you. The meeting is off';
      if (st.lostT > 10) return 'You lost Chad';
      const D = v.storyDrive;
      if (D.s > st.L.len - 14 && Math.abs(v.vLong) < 1) return d < p.far * 1.3 ? true : 'You lost Chad';
      S.pointAt(v, d);
      const bars = Math.round(st.sus * 5);
      S.setObj(p.obj);
      S.led(p.obj, `${Math.round(d)} m · suspicion [${'#'.repeat(bars)}${'-'.repeat(5 - bars)}]${d < p.near ? ' · TOO CLOSE' : d > p.far ? ` · losing him ${Math.ceil(10 - st.lostT)}` : ''}`);
      return null;
    },
    crash(S, st, impact, other) { if (other && other === st.v && st.grace <= 0) st.sus = 1; },
    end(S, st) { S.hud.suspects = null; S.pointAt(null); },
  },

  // The parade float is waiting: get in.
  board: {
    begin(S, st, pl) {
      const at = st.p.at, r = S.roadPt(at[0], at[1], 120);
      const h = S.roadHeading(r.x, r.z, CITYHALL[0], CITYHALL[1]);
      // (out of the way of the car you came in: a few metres along the kerb)
      const v = S.spawnCar(r.x, r.z, h, st.p.type, 0x1d5fb4, st);
      v.mode = 'apron'; v.story = st;
      dressFloat(v);
      S.run.float = v;
      st.v = v;
    },
    tick(S, st, dt, pl) {
      const v = st.v;
      if (v.dead || !S.traffic.cars.includes(v)) return 'The float is wrecked';
      if (pl.vehicle === v && !pl.onFoot) return true;
      const d = Math.hypot(v.x - pl.position.x, v.z - pl.position.z);
      S.placeBeam(v.x, v.z, null, dt);
      S.setObj(st.p.obj);
      S.led(st.p.obj, `${Math.round(d)} m · ${pl.onFoot ? 'ENTER to climb in' : 'get out of your car first'}`);
      return null;
    },
  },

  // Drive the float down King St, checkpoint to checkpoint, gently.
  parade: {
    begin(S, st, pl) {
      st.cond = 100; st.warned = 0; st.cps = null; st.cp = 0; st.cd = 0; st.fast = 0;
      const v = S.run.float;
      S.routeLater(st, v.x, v.z, st.p.to[0], st.p.to[1], (L) => {
        const cps = [];
        for (let s = 380; s < L.len - 120; s += 380) { lineAt(L, s, _o1); cps.push({ x: _o1.x, z: _o1.z }); }
        cps.push({ x: st.p.to[0], z: st.p.to[1] });
        st.cps = cps;
        if (S.run && S.run.st === st) S.showRoute(L, cps[cps.length - 1]);
      });
    },
    tick(S, st, dt, pl) {
      const fv = S.run.float, pos = pl.position;
      if (!fv || fv.dead || !S.traffic.cars.includes(fv)) return 'The float is wrecked — the parade is cancelled';
      const d = Math.hypot(fv.x - pos.x, fv.z - pos.z);
      if (pl.vehicle !== fv && d > 80) return 'You abandoned the float';
      st.cd -= dt;
      const sp = Math.abs(fv.vLong) * 3.6;
      if (pl.vehicle === fv && sp > 50) {
        st.fast += dt;
        damageFloat(S, st, (sp - 50) * 0.09 * dt);
        if (st.fast > 0.6 && st.warned < 1) { st.warned = 1; S.hud.showToast('Easy! The pretzel is wobbling — keep it under 50', 2400); }
      } else st.fast = 0;
      if (st.cond <= 0) return 'The float fell apart on King Street';
      if (!st.cps) { S.setObj(st.p.obj); S.led(st.p.obj, 'Lining up the parade…'); return null; }
      const c = st.cps[st.cp];
      S.placeBeam(c.x, c.z, null, dt);
      if (Math.hypot(c.x - fv.x, c.z - fv.z) < 22 && pl.vehicle === fv) {
        st.cp++;
        if (S.audio && S.audio.ready) S.audio.ui('check');
        if (st.cp >= st.cps.length) return true;
        S.hud.showToast(['The crowd cheers!', 'Somebody throws a pretzel at you. Lovingly.', 'A kid salutes the float.', 'The oompah band picks it up!', 'Free Timbit from the crowd!'][st.cp % 5], 1800);
      }
      S.setObj(pl.vehicle === fv ? st.p.obj : 'Get back in the float');
      S.led(pl.vehicle === fv ? st.p.obj : 'Get back in the float', `checkpoint ${st.cp + 1}/${st.cps.length} · ${Math.round(sp)} km/h · float ${Math.round(st.cond)}%`);
      return null;
    },
    crash(S, st, impact) {
      const pl = S.player;
      if (!pl || pl.vehicle !== S.run.float || st.cd > 0 || impact < 2.5) return;
      st.cd = 0.6;
      damageFloat(S, st, impact * 2.6);
    },
  },

  // Two stars: lose them.
  heat: {
    begin(S, st) { S.game.setWanted(st.p.stars); st.n0 = S.o.respray ? S.o.respray.stats.n : 0; S.run.spray0 = st.n0; S.game.storyPays = true; },
    tick(S, st, dt) {
      if (S.game.wanted === 0) return true;
      S.setObj(st.p.obj);
      S.led(st.p.obj, `${'★'.repeat(S.game.wanted)} · Golden Goose card in your pocket`);
      return null;
    },
  },

  // ...and paint the car the cops saw (any body shop; Gord pays).
  respray: {
    begin(S, st, pl) {
      const R = S.o.respray, p = pl.position;
      st.n0 = S.run.spray0 != null ? S.run.spray0 : R ? R.stats.n : 0;
      st.shop = null;
      if (R) { let bd = Infinity; for (const q of R.sites) { const d = Math.hypot(q.mx - p.x, q.mz - p.z); if (d < bd) { bd = d; st.shop = q; } } }
      if (st.shop) S.routeLater(st, p.x, p.z, st.shop.mx, st.shop.mz, (L) => { if (S.run && S.run.st === st) S.showRoute(L, { x: st.shop.mx, z: st.shop.mz }); });
    },
    tick(S, st, dt, pl) {
      const R = S.o.respray;
      if (!R || !st.shop) return true;   // (no body shops in this build: the step is a pass)
      if (R.stats.n > st.n0 && !R.active && S.game.wanted === 0) {
        const pr = R.last ? R.last.price : 0;
        S.game.storyPays = false;
        if (pr > 0) { S.game.money += pr; S.hud.showToast(`Gord covered the paint (${formatMoney(pr)})`, 2400); }   // (none while storyPays: the bay charges nothing)
        return true;
      }
      const d = Math.hypot(st.shop.mx - pl.position.x, st.shop.mz - pl.position.z);
      S.placeBeam(st.shop.mx, st.shop.mz, null, dt);
      S.setObj(S.game.wanted > 0 ? 'Lose the cops — or get resprayed where they cannot see you' : st.p.obj);
      S.led(st.p.obj, `${st.shop.shop.name} · ${fmtD(d)}`);
      return null;
    },
  },

  // A race to a finish down a route, checkpoint to checkpoint, against one rival.
  race: {
    begin(S, st, pl) { st.v = null; st.cp = 0; st.count = 3.5; st.go = false; },
    tick(S, st, dt, pl) {
      const p = st.p, pos = pl.position;
      if (!st.v) {
        if (!st.req) { st.req = 1; S.routeLater(st, pos.x, pos.z, p.to[0], p.to[1]); }
        S.setObj('Lining up with Kayla…'); S.led('Lining up with Kayla…', '');
        const R = p.route === undefined ? st.route : st.route;
        if (!R || !R.done) return null;
        const L = offsetLine(R.line, 1.8);
        // Kayla: beside you, on the start line
        lineAt(L, 6, _o1);
        const v = S.spawnCar(_o1.x - _o1.dz * 3.2, _o1.z + _o1.dx * 3.2, Math.atan2(_o1.dx, _o1.dz), p.type, p.color, st);
        v.health = 250;
        v.storyDrive = { L, k: 0, s: 0, top: p.speed, wait: true, polite: true, inp: { throttle: 0, brake: 0, steer: 0, handbrake: 0 }, stuckT: 0, revT: 0 };
        st.v = v; st.L = R.line;
        st.cps = [];
        for (let s = 520; s < R.line.len - 150; s += 520) { lineAt(R.line, s, _o1); st.cps.push({ x: _o1.x, z: _o1.z, s }); }
        st.cps.push({ x: p.to[0], z: p.to[1], s: R.line.len });
        S.showRoute(R.line, st.cps[st.cps.length - 1]);
        return null;
      }
      const v = st.v, D = v.storyDrive;
      if (!st.go) {
        const was = Math.ceil(st.count);
        st.count -= dt;
        const now = Math.ceil(st.count);
        if (now !== was && now > 0) { S.title(String(now)); if (S.audio && S.audio.ready) S.audio.ui('tick'); }
        if (st.count <= 0) { st.go = true; D.wait = false; S.title('GO!'); if (S.audio && S.audio.ready) S.audio.ui('go'); }
        S.setObj(p.obj); S.led(p.obj, `${Math.max(1, Math.ceil(st.count))}…`);
        return null;
      }
      if (v.dead || !S.traffic.cars.includes(v)) return true;   // (you put Kayla in a wall: that is a win, in Hespeler)
      const c = st.cps[st.cp];
      S.placeBeam(c.x, c.z, null, dt);
      if (Math.hypot(c.x - pos.x, c.z - pos.z) < 26) {
        st.cp++;
        if (S.audio && S.audio.ready) S.audio.ui('check');
        if (st.cp >= st.cps.length) return true;
      }
      // where you are along the route against Kayla, and the rubber band
      st.k = st.k || 0;
      lineProj(st.L, pos.x, pos.z, st.k, _o2); st.k = _o2.k;
      const mine = Math.max(_o2.s, st.cp ? st.cps[st.cp - 1].s : 0), hers = D.s;
      D.top = p.speed * (hers - mine > 160 ? 0.82 : mine - hers > 160 ? 1.12 : 1);
      if (hers >= D.L.len - 20) return 'Kayla got to Preston first';
      S.pointAt(v, Math.hypot(v.x - pos.x, v.z - pos.z));
      S.setObj(p.obj);
      S.led(p.obj, `checkpoint ${st.cp + 1}/${st.cps.length} · ${mine >= hers ? 'LEADING' : 'BEHIND'} by ${Math.round(Math.abs(mine - hers))} m`);
      return null;
    },
    end(S, st) { S.pointAt(null); },
  },

  // The finale: a car running a route to an airport. Wreck it or stop it first.
  flee: {
    begin(S, st, pl) { st.v = null; st.stopT = 0; st.farT = 0; },
    tick(S, st, dt, pl) {
      const p = st.p, pos = pl.position;
      if (!st.v) {
        const R = p.route;
        S.setObj("Chad's limo is in the lot"); S.led("Chad's limo is in the lot", '');
        if (!R || !R.done) return null;
        const L = offsetLine(R.line, 1.8);
        lineAt(L, 0, _o1);
        const v = S.spawnCar(_o1.x, _o1.z, Math.atan2(_o1.dx, _o1.dz), p.type, p.color, st);
        v.health = p.hp;
        v.storyDrive = { L, k: 0, s: 0, top: p.speed, limpAt: p.hp * 0.3, polite: true,   // (it does not wreck itself in traffic: that is your job)
           inp: { throttle: 0, brake: 0, steer: 0, handbrake: 0 }, stuckT: 0, revT: 0 };
        v.suspect = { stopT: 0 };
        st.v = v;
        S.showRoute(R.line, { x: p.to[0], z: p.to[1] });
        S.hud.suspects = [v];
        if (S.audio && S.audio.ready) S.audio.ui('start');
        return null;
      }
      const v = st.v, D = v.storyDrive;
      if (v.dead || !S.traffic.cars.includes(v)) return true;
      const d = Math.hypot(v.x - pos.x, v.z - pos.z);
      if (Math.abs(v.vLong) < 1.2 && d < STOP_R && D.revT <= 0) st.stopT += dt; else st.stopT = Math.max(0, st.stopT - dt);
      v.suspect.stopT = st.stopT;
      if (st.stopT > STOP_T) return true;
      if (D.s >= D.L.len - 25) return "Chad made it to YKF. His jet is wheels-up for Florida";
      if (d > 900) st.farT += dt; else st.farT = 0;
      if (st.farT > 15) return 'Chad got away';
      S.pointAt(v, d);
      S.setObj(p.obj);
      S.led(p.obj, `${fmtD(d)} · limo ${Math.max(0, Math.round(v.health / p.hp * 100))}% · YKF in ${fmtD(Math.max(0, D.L.len - D.s))}`);
      return null;
    },
    end(S, st) {
      const v = st.v;
      if (v) { v.storyDrive = null; v.suspect = null; if (S.traffic.cars.includes(v) && !v.dead) { v.mode = 'free'; v.vLong *= 0.3; } }
      S.hud.suspects = null; S.pointAt(null);
    },
  },
};

function spill(S, st, n) {
  st.cond = Math.max(0, st.cond - n * st.p.cargo.sens);
  const lvl = st.cond < 30 ? 3 : st.cond < 55 ? 2 : st.cond < 80 ? 1 : 0;
  if (lvl > st.warned) {
    st.warned = lvl;
    S.hud.showToast(lvl === 3 ? `The ${st.p.cargo.what} is nearly gone…` : st.p.cargo.bad, 2200);
    if (S.audio && S.audio.ready) S.audio.play('slosh', { gain: 0.4 });
  }
}

function damageFloat(S, st, n) {
  st.cond = Math.max(0, st.cond - n);
  const lvl = st.cond < 25 ? 3 : st.cond < 50 ? 2 : st.cond < 80 ? 1 : 0;
  if (lvl > (st.hurt || 0)) {
    st.hurt = lvl;
    S.hud.showToast(['', 'A Timbit-sized dent in the pretzel…', 'The stein is cracked! Gord is going to cry', 'The float is coming apart!'][lvl], 2400);
  }
}

/** Chapter 5: the card back out of Chad's hand, and the law on you. */
function snatch(S) {
  S.hud.showToast('You snatched the Golden Goose card back from Chad', 3000);
  if (S.audio && S.audio.ready) S.audio.ui('check');
}

/** Chapter 5: the card goes home to J&J. */
function thanks(S) {
  S.hud.showToast('J&J Cards: "You found it! Thank you -- it goes in the case today."', 3600);
  if (S.audio && S.audio.ready) S.audio.ui('check');
}

/** Chapter 2: Gerald goes back to the lake (feathers). */
function goodbyeGoose(S, pl) {
  const fx = S.o.fx, p = pl.position;
  if (fx) fx.emit(p.x, p.y + 1.5, p.z, 30, { r: 0.95, g: 0.95, b: 0.92, size: 0.35, life: 1.6, spread: 2, vy: 2.5, grav: 1.2, jitter: 1.2 });
}

Story.prototype.nearNode = function (x, z) {
  let best = -1, bd = Infinity;
  for (const ei of this.city.edgesNear(x, z, 60)) {
    const e = this.city.edges[ei];
    for (const n of [e.a, e.b]) { const N = this.city.nodes[n], d = Math.hypot(N.x - x, N.z - z); if (d < bd) { bd = d; best = n; } }
  }
  return best;
};
