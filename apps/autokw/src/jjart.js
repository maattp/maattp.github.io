// J&J's cards: the set and how it is drawn.
//
// "WATERLOO REGION LEGENDS, SERIES 1": 60 made-up locals (a crossing guard, a
// goose captain, a buggy and its horse, the Kissing Bridge...). No real person,
// team, league or game is on any of them -- the places are real, the "players"
// are not. Every card is drawn from this table on a canvas (a vector portrait,
// the name, the position and team, a stat line, a line of flavour text, the
// number and a border for its rarity); there are no image files.
//
// rarity: c common (30), u uncommon (14), r rare (9), h holo foil (6),
// g the Golden Goose (1). `paintCard` adds the live sheen on top of a cached
// base render -- a sweep on rares, a rainbow foil on holos, gold glitter on the
// goose -- following the tilt.
//
// Pure drawing plus data: no DOM at import time, so a harness can read SET.

export const RARITY = {
  c: { name: 'COMMON', col: '#aab2bf', dark: '#6f7886', rank: 0, sell: 1 },
  u: { name: 'UNCOMMON', col: '#4cb36a', dark: '#2a7a43', rank: 1, sell: 2 },
  r: { name: 'RARE', col: '#3b82e8', dark: '#1d4fa0', rank: 2, sell: 6 },
  h: { name: 'HOLO FOIL', col: '#b36ae8', dark: '#6a2fa0', rank: 3, sell: 20 },
  g: { name: 'GOLDEN GOOSE', col: '#f2c230', dark: '#a87a10', rank: 4, sell: 250 },
};

// [name, role, team, kind, params, [stat label, value], flavour, rarity]
// kind = a drawer below; params are its colours and options.
const D = [
  // ---- commons (1-30)
  ['Brenda "Stop Sign" Kowalski', 'Crossing Guard', 'Bridge St. Stoppers', 'person', { skin: '#e8b890', hair: '#6a4a2a', hs: 1, hat: 'visor', hc: '#f2d21c', top: '#f4a21c', vest: 1, prop: 'sign', bg: ['#9fd4f0', '#d8eef8'], pat: 'hills' }, ['CARS HALTED', '41,208'], 'Has never been run over. Has been honked at, twice.', 'c'],
  ['Gord Gallant', 'ION Operator', 'Region Rapid', 'train', { body: '#e8edf2', stripe: '#2a8ad8', bg: ['#f0b878', '#f8e0b0'], pat: 'rays' }, ['STOPS MADE', '19 (all of them)'], 'Rings the bell for every cyclist. Every single one.', 'c'],
  ['Dee Dee Doubleday', 'Double-Double Champion', 'Drive-Thru Dynamos', 'cup', { cup: '#f4f0e6', band: '#c8301c', sleeve: '#8a5a32', bg: ['#e8c898', '#f8ecd0'], pat: 'dots' }, ['DOUBLES DOWNED', '7,300'], 'Two cream, two sugar, zero chill.', 'c'],
  ['Onkel Hansi', 'Keg Tapper', 'Oktoberfest Old Guard', 'person', { skin: '#e8a888', hair: '#c8c8c8', hs: 1, hat: 'tyrol', hc: '#3a6a3a', top: '#f4f0e6', stache: '#d8d8d8', bg: ['#f2c868', '#fbe9b0'], pat: 'stripes' }, ['KEGS TAPPED', '112'], '"Ozapft is!" he says, at a calm, reasonable volume.', 'c'],
  ['Eli Bontrager', 'Buggy Speedster', 'Wellesley Wheelers', 'buggy', { bg: ['#a8d8f0', '#e8f4e0'], pat: 'hills' }, ['TOP SPEED', '22 km/h (downhill)'], 'Has a horse named Turbo. Turbo is not.', 'c'],
  ['Chip Chopperson', 'Lift Operator', 'Chicopee Chairs', 'chair', { bg: ['#9cc8f0', '#eef6fc'], pat: 'snow' }, ['CHAIRS RUN', '3,480'], 'Says "hold on" with total sincerity.', 'c'],
  ['Hawkins', 'Mascot', 'Purple & Gold Flock', 'hawk', { fur: '#5a3a2a', sash: '#5a2a8a', trim: '#f2c230', bg: ['#6a3aa0', '#a878d8'], pat: 'rays' }, ['HALFTIME HYPE', '11 / 10'], 'Does one flap per home game. It is a big flap.', 'c'],
  ['Big Bertha', 'Combine Harvester', 'Township Threshers', 'combine', { body: '#2f8a3a', bg: ['#f8d878', '#fcecb0'], pat: 'hills' }, ['ACRES CUT', '12,000'], 'Eats a field for breakfast, then a second field.', 'c'],
  ['The Kissing Bridge', 'Covered Bridge', 'West Montrose Wooden Wonders', 'bridge', { bg: ['#a8dcf0', '#e0f4e8'], pat: 'hills' }, ['SMOOCHES', 'uncounted'], 'Honk once if you love it. Honk twice if you are in the lane.', 'c'],
  ['Fran Fritter', 'Apple Fritter Slinger', "St. Jacobs Market Mob", 'person', { skin: '#f0c0a0', hair: '#a85a2a', hs: 2, hat: 'bonnet', hc: '#f4f0e6', top: '#8a4a8a', bg: ['#f0c8a0', '#fbe4cc'], pat: 'dots' }, ['FRITTERS SOLD', '88,000'], 'The line starts at the door. The door is far away.', 'c'],
  ['Pothole Pete', 'Weber Street Resident', 'The Road Hazards', 'pothole', { bg: ['#9a9aa4', '#c8c8d0'], pat: 'stripes' }, ['TIRES CLAIMED', '1,204'], 'Moved in during the thaw of 2019. Never left.', 'c'],
  ['Cone Carl', 'Lane Closure Specialist', 'The Orange Brigade', 'cone', { bg: ['#e8d8a8', '#f8f0d0'], pat: 'stripes' }, ['LANES CLOSED', 'yes'], 'Appears overnight. Disappears never.', 'c'],
  ['Sheila Snowplow', 'Plow Driver', 'Salt Belt Crew', 'plow', { bg: ['#b8c8e0', '#eef2f8'], pat: 'snow' }, ['SNOW MOVED', '9,001 t'], 'Buries your driveway out of love.', 'c'],
  ['Larry Leafblower', 'Fall Cleanup Pro', 'Maple Street Marauders', 'person', { skin: '#d8a078', hair: '#4a3a2a', hs: 1, hat: 'cap', hc: '#c8601c', top: '#3a7a3a', prop: 'blower', bg: ['#f0b050', '#f8dc98'], pat: 'dots' }, ['LEAVES DISPLACED', '1.4 million'], 'Just moves them next door. Peace through distance.', 'c'],
  ['Pretzel Paulie', 'Pretzel Twister', 'Oktoberfest Old Guard', 'pretzel', { bg: ['#9ac8f0', '#e4f2fc'], pat: 'rays' }, ['TWISTS', '1 (a good one)'], 'Salty. Warm. Slightly smug.', 'c'],
  ['Zed the Zamboni', 'Ice Resurfacer', 'Rink Rats', 'zamboni', { bg: ['#c8e4f4', '#f0f8fc'], pat: 'snow' }, ['LAPS', '9 per intermission'], 'Everyone watches. Nobody says why.', 'c'],
  ['Curds Cora', 'Poutine Inspector', 'Gravy Train', 'person', { skin: '#f0c0a0', hair: '#3a2a1a', hs: 2, hat: 'chef', hc: '#fafafa', top: '#fafafa', bg: ['#e8c890', '#f8e8c8'], pat: 'dots' }, ['SQUEAKS CHECKED', '6,600'], 'If it does not squeak, it does not ship.', 'c'],
  ['Randy Raccoon', 'Bin Bandit', 'The Alley Cats (Mostly)', 'raccoon', { bg: ['#38384a', '#6a6a80'], pat: 'stripes' }, ['BINS RAIDED', '304'], 'Treats the green bin as a buffet.', 'c'],
  ['Gosling Gus', 'Goose Cadet', 'UW Geese', 'goose', { hat: 'none', small: 1, bg: ['#9ed8a8', '#e0f4d8'], pat: 'hills' }, ['BREAD STOLEN', '6 slices'], 'Still learning to hiss. Getting there.', 'c'],
  ['Bus Driver Bev', 'Bus Operator', 'Transfer Station Titans', 'bus', { body: '#f4f4f4', stripe: '#1f5fa8', bg: ['#f0a0a0', '#fcd8d0'], pat: 'rays' }, ['TRANSFERS GIVEN', '60,000'], 'The doors close. Bev closes them. You are outside.', 'c'],
  ['Maple Marge', 'Syrup Boiler', 'Elmira Sap Sippers', 'syrup', { bg: ['#e8b870', '#f8e0b8'], pat: 'dots' }, ['SAP BOILED', '40 : 1'], 'Forty buckets for one little bottle. Worth it.', 'c'],
  ['Butter Tart Betty', 'Baker', 'The Raisin Debate', 'tart', { bg: ['#f0d8a8', '#fcf0d8'], pat: 'dots' }, ['RAISINS', 'contested'], 'Has strong opinions about raisins. So do you.', 'c'],
  ['Dale from the Stands', 'Rink Parent', 'Cold Coffee Club', 'person', { skin: '#e8b890', hair: '#6a4a2a', hs: 1, hat: 'toque', hc: '#c8301c', top: '#4a5a6a', prop: 'coffee', bg: ['#c8dff0', '#f0f8fc'], pat: 'snow' }, ['EARLY MORNINGS', '400'], 'Yells "SHOOT!" at the goalie. In his own kid.', 'c'],
  ['Squirrel Sully', 'Acorn Banker', 'Quad Rodents', 'squirrel', { bg: ['#a8d8a0', '#e4f4d0'], pat: 'hills' }, ['ACORNS BURIED', '9,040'], 'Forgot where. Every single time.', 'c'],
  ['Clara the Holstein', 'Heavyweight', 'The Back Forty', 'cow', { bg: ['#a8d8f0', '#d4efc0'], pat: 'hills' }, ['MOOS', 'frequent'], 'Has seen a combine up close. Remains unbothered.', 'c'],
  ['Bertie Beaver', 'Dam Builder', 'Laurel Creek Lumberjacks', 'beaver', { bg: ['#a8d0e8', '#dcf0e0'], pat: 'hills' }, ['LOGS CHEWED', '1,700'], 'Offered to fix the Region budget. Used only sticks.', 'c'],
  ['Paddle Pat', 'Canoeist', 'Grand River Paddlers', 'canoe', { bg: ['#a8d8f0', '#e8f6f8'], pat: 'hills' }, ['PORTAGES', '3 (reluctantly)'], 'The river goes one way. So does Pat.', 'c'],
  ['Balloon Barb', 'Hot-Air Pilot', 'Sunrise Drifters', 'balloon', { bg: ['#f8c8a0', '#fce8d4'], pat: 'rays' }, ['ALTITUDE', '1,000 ft'], 'Goes where the wind goes. Waves at your yard.', 'c'],
  ['Student Stu', 'Co-op Student', 'Term Four Terrors', 'person', { skin: '#d8a078', hair: '#2a2a2a', hs: 1, hat: 'none', top: '#c8a21a', glasses: 1, prop: 'laptop', bg: ['#2a2a4a', '#5a5a8a'], pat: 'dots' }, ['RESUMES SENT', '412'], 'Built a robot. The robot built a robot.', 'c'],
  ['Clocktower Clive', 'Market Timekeeper', 'Downtown Dials', 'clock', { bg: ['#a8c8e8', '#e4eef8'], pat: 'rays' }, ['MINUTES KEPT', '5.2 million'], 'Always right twice a day. Closer than that, usually.', 'c'],
  // ---- uncommons (31-44)
  ['Captain Honk', 'Goose Captain', 'UW Geese', 'goose', { hat: 'captain', bg: ['#7ab8e8', '#c8e4f8'], pat: 'rays' }, ['SALUTES RECEIVED', '0 (demanded 14)'], 'Commands the ring road. Has never lost a staring contest.', 'u'],
  ['Quilt Queen Edna', 'Quilt Auctioneer', 'Auction Aces', 'person', { skin: '#f0c8a8', hair: '#d8d8d8', hs: 2, hat: 'bonnet', hc: '#f4f0e6', top: '#6a8ac8', glasses: 1, bg: ['#d85a5a', '#f0a8a0'], pat: 'quilt' }, ['QUILTS SOLD', '2,350'], 'A stitch in time saves nine. A bid in time saves nothing.', 'u'],
  ['Auctioneer Al', 'Livestock Auctioneer', 'Sold-Sold-Sold Syndicate', 'person', { skin: '#e8b890', hair: '#6a4a2a', hs: 1, hat: 'straw', hc: '#d8b868', top: '#a83a2a', stache: '#6a4a2a', bg: ['#f0d898', '#fcf0cc'], pat: 'stripes' }, ['WORDS PER MINUTE', '410'], 'Speaks fluent numbers. Nobody else does.', 'u'],
  ['Mayor Maple Mac', 'Ribbon Cutter', 'The Honourable Scissors', 'person', { skin: '#e8b890', hair: '#9a9a9a', hs: 1, hat: 'none', top: '#2a3a6a', tie: '#c8301c', bg: ['#e8c050', '#f8e8a0'], pat: 'rays' }, ['RIBBONS CUT', '900'], 'Will attend the opening of anything with a ribbon.', 'u'],
  ['Dr. Wendy Quark', 'Physicist', 'Silver Lake Think Tank', 'person', { skin: '#f0c0a0', hair: '#2a1a1a', hs: 2, hat: 'none', top: '#fafafa', glasses: 1, prop: 'atom', bg: ['#1a1a3a', '#4a3a8a'], pat: 'dots' }, ['UNIVERSES CONSIDERED', '11'], 'Is thinking about black holes. Also about lunch.', 'u'],
  ['Thumb-Typist Theo', 'Hall-of-Fame Texter', 'Keyboard Clickers', 'person', { skin: '#d8a078', hair: '#1a1a1a', hs: 3, hat: 'none', top: '#3a3a3a', prop: 'phone', bg: ['#2a4a6a', '#6a9ac8'], pat: 'dots' }, ['WORDS PER MINUTE', '97 (one thumb)'], 'Had a phone with real buttons. Misses them like a limb.', 'u'],
  ['Sunday Driver Sid', 'Left-Lane Legend', 'The Region Roads Roll', 'car', { body: '#9ab8a0', hat: 'cap', bg: ['#c8d8e8', '#f0f4f8'], pat: 'hills' }, ['SPEED', '47 in a 70'], 'Signals a lane change a kilometre early. Then forgets.', 'u'],
  ['Dozer Dave', 'Road Crew', 'King Street Reno Crew', 'person', { skin: '#e0a880', hair: '#3a2a1a', hs: 0, hat: 'hardhat', hc: '#f2d21c', top: '#f4a21c', vest: 1, stache: '#3a2a1a', bg: ['#e8d8b8', '#f8f0dc'], pat: 'stripes' }, ['COFFEE BREAKS', '4 per hour'], 'One guy digs. Four guys supervise. That is Dave.', 'u'],
  ['Skater Sam', 'Rink Regular', 'Public Square Skaters', 'person', { skin: '#f0c0a0', hair: '#c85a2a', hs: 2, hat: 'toque', hc: '#2a8ad8', top: '#c8301c', bg: ['#b8dcf0', '#f0f8fc'], pat: 'snow' }, ['FALLS', '3 (cute ones)'], 'Skates backwards just to make a point.', 'u'],
  ['Liesl, Miss Oktoberfest', 'Reigning Queen', 'Festhalle Royals', 'person', { skin: '#f0c8a8', hair: '#e8c868', hs: 2, hat: 'crown', hc: '#f2c230', top: '#2a5a9a', bg: ['#f8c8d0', '#fce8d8'], pat: 'dots' }, ['PARADES WAVED', '1 (very long)'], 'The wave is a wrist-only motion. It takes years.', 'u'],
  ['Frosty Fred', 'Snowman', 'Chicopee Chill', 'snowman', { bg: ['#6a9ad0', '#c8e0f4'], pat: 'snow' }, ['LIFESPAN', 'until Thursday'], 'Wears a toque. Nobody asked him how he feels.', 'u'],
  ['Cranky Cabbie', 'Cab Driver', 'The Fare Share', 'car', { body: '#f2c21c', hat: 'visor', taxi: 1, bg: ['#3a3a5a', '#7a7aa0'], pat: 'dots' }, ['SHORTCUTS TAKEN', 'all of them'], 'Knows a back way. The back way is slower.', 'u'],
  ['Coop Cora', 'Fourth-Term Student', 'Term Four Terrors', 'person', { skin: '#f0c0a0', hair: '#7a3a2a', hs: 2, hat: 'none', top: '#f2c230', glasses: 1, prop: 'coffee', bg: ['#e8f0a0', '#f8fcd8'], pat: 'dots' }, ['TIMES SLEPT', 'ask later'], 'Two jobs. Three assignments. One strong coffee.', 'u'],
  ['Pickle-Pam', 'Pickleball Pro', 'Court Crashers', 'person', { skin: '#f0c0a0', hair: '#c8c8c8', hs: 1, hat: 'visor', hc: '#2a9a5a', top: '#f4f4f4', prop: 'paddle', bg: ['#a8d8a0', '#e0f4d0'], pat: 'stripes' }, ['DINKS', '10,000'], 'Her dink is a work of art. Her trash talk is, too.', 'u'],
  // ---- rares (45-53)
  ['Weenie Wagon Wes', 'Hot-Dog Driver', 'The Wiener Wheelers', 'sausage', { bg: ['#f0a050', '#fcd8a0'], pat: 'rays' }, ['MUSTARD', 'standard issue'], 'The only vehicle that is also lunch.', 'r'],
  ['Der Grosse Float', 'Parade Float', 'Oktoberfest Old Guard', 'float', { bg: ['#f2c868', '#fbe9b0'], pat: 'stripes' }, ['STEINS ON BOARD', '1 (giant)'], 'Moves at 4 km/h. Is somehow in a hurry.', 'r'],
  ['Turbo', 'Fastest Buggy Horse', 'Wellesley Wheelers', 'horse', { bg: ['#a8d8f0', '#dcefc4'], pat: 'hills' }, ['TOP SPEED', 'surprisingly fast'], 'Has never walked past a hay bale. Not once.', 'r'],
  ['Marvin the Moose', 'Highway 7 Mascot', 'The Antler Union', 'moose', { bg: ['#2a5a4a', '#7ab898'], pat: 'hills' }, ['CARS CROSSED', 'never again'], 'Stands in the road with total authority.', 'r'],
  ['Ulrich Under-Bridge', 'Bridge Troll', 'Toll Collectors', 'troll', { bg: ['#2a3a2a', '#5a7a5a'], pat: 'stripes' }, ['TOLLS COLLECTED', '3 goats'], 'Charges one toll. One. Fair, really.', 'r'],
  ['Spooky Sally', 'Ghost Tour Guide', 'Uptown Haunts', 'ghost', { bg: ['#1a1a3a', '#4a4a8a'], pat: 'rays' }, ['BOO COUNT', '88'], 'Has been dead since 1893. Still gets the tour times wrong.', 'r'],
  ['Ice King Isaac', 'Veteran Winger', 'Frozen Pond Legends', 'person', { skin: '#e8b890', hair: '#6a4a2a', hs: 1, hat: 'helmet', hc: '#2a5aa8', top: '#2a5aa8', stache: '#6a4a2a', bg: ['#b8dcf0', '#f0f8fc'], pat: 'rays' }, ['TEETH', '14 (original)'], 'Has played on every outdoor rink in the Region. Twice.', 'r'],
  ['Reginald the Pigeon', 'Mayor of King Street', 'The Crumb Council', 'pigeon', { bg: ['#9aa8c8', '#d8e0ee'], pat: 'dots' }, ['CRUMBS NEGOTIATED', 'many'], 'Has a seat at every table. Several tables.', 'r'],
  ['Rocket Rae', 'Bush Pilot', 'Sunrise Flyers', 'plane', { bg: ['#78b8f0', '#d0ecfc'], pat: 'rays' }, ['LOOPS', '3 (in a Cessna)'], 'Calls the cows by their first names from up there.', 'r'],
  // ---- holos (54-59)
  ['Elora Gorge Eternal', 'Natural Wonder', 'The Cliffside Choir', 'gorge', { bg: ['#78c8f0', '#f0e8c8'], pat: 'rays' }, ['DEPTH', '22 m of drama'], 'Carved by the Grand River while it waited for a bus.', 'h'],
  ['Visitor from Wilmot', 'Unidentified Flying Object', 'The Night-Sky Society', 'saucer', { bg: ['#0a0a2a', '#2a2a7a'], pat: 'stars' }, ['ABDUCTIONS', 'friendly'], 'Came for the butter tarts. Stayed for the rest.', 'h'],
  ['ION Starliner', 'Light Rail Legend', 'Region Rapid', 'train', { body: '#e8d8a8', stripe: '#f2c230', bg: ['#1a1a4a', '#5a3a9a'], pat: 'stars' }, ['PUNCTUALITY', '99.9% (ish)'], 'Hums at night. Glows at dawn. Rides the tracks like a comet.', 'h'],
  ['Cosmic Double-Double', 'Universal Beverage', 'Drive-Thru Dynamos', 'cup', { cup: '#f4f0e6', band: '#c8301c', sleeve: '#8a5a32', bg: ['#1a0a3a', '#6a2a9a'], pat: 'stars' }, ['COFFEES', 'infinite'], 'The big bang was an order for two creams and two sugars.', 'h'],
  ['The Leaf of Legend', 'Sacred Maple Leaf', 'Oldest Tree in Town', 'leaf', { bg: ['#f0a030', '#f8e0a0'], pat: 'rays' }, ['COLOUR', 'peak fall'], 'Falls once a year. Lands exactly where it means to.', 'h'],
  ['The Chicopee Yeti', 'Snow-Hill Cryptid', 'Chicopee Chill', 'yeti', { bg: ['#4a78b8', '#c8e4f8'], pat: 'snow' }, ['SIGHTINGS', 'four, all blurry'], 'Takes the lift in off-season. Pays in snowballs.', 'h'],
  // ---- the one (60)
  ['The Golden Goose', 'The Legend', 'The Whole Region', 'goose', { hat: 'crown', gold: 1, bg: ['#4a0a2a', '#c8501c'], pat: 'rays' }, ['EGGS', 'all of them, golden'], 'One in five hundred packs. Honk if you hit it.', 'g'],
];

export const SET = D.map((d, i) => ({ id: i + 1, name: d[0], role: d[1], team: d[2], kind: d[3], p: d[4], stat: d[5], flavour: d[6], r: d[7] }));
export const SET_SIZE = SET.length;
export const BY_RARITY = { c: [], u: [], r: [], h: [], g: [] };
for (const c of SET) BY_RARITY[c.r].push(c.id);

// ---------------------------------------------------------------------------------------------
// drawing primitives (all in a 120 x 100 box centred on the origin)

const TAU = Math.PI * 2;
const E = (g, x, y, rx, ry, c, rot = 0) => { g.fillStyle = c; g.beginPath(); g.ellipse(x, y, Math.max(0.01, rx), Math.max(0.01, ry), rot, 0, TAU); g.fill(); };
const R = (g, x, y, w, h, c, r = 0) => { g.fillStyle = c; g.beginPath(); if (g.roundRect && r) g.roundRect(x, y, w, h, r); else g.rect(x, y, w, h); g.fill(); };
const P = (g, pts, c) => { g.fillStyle = c; g.beginPath(); pts.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y))); g.closePath(); g.fill(); };
const L = (g, x1, y1, x2, y2, c, w = 1.5) => { g.strokeStyle = c; g.lineWidth = w; g.lineCap = 'round'; g.beginPath(); g.moveTo(x1, y1); g.lineTo(x2, y2); g.stroke(); };
const eyes = (g, x, y, gap, r = 3.4, look = 0) => {
  for (const s of [-1, 1]) { E(g, x + s * gap, y, r, r * 1.1, '#fff'); E(g, x + s * gap + look, y + 0.4, r * 0.55, r * 0.6, '#1a1a1a'); E(g, x + s * gap + look - 0.6, y - 0.6, r * 0.18, r * 0.18, '#fff'); }
};
const smile = (g, x, y, w, c = '#5a2a1a', up = 1) => { g.strokeStyle = c; g.lineWidth = 1.7; g.lineCap = 'round'; g.beginPath(); g.arc(x, y - up * w * 0.4, w, 0.2 * Math.PI, 0.8 * Math.PI); g.stroke(); };
const face = (g, x, y, s = 1) => { eyes(g, x, y, 5 * s, 3.2 * s); smile(g, x, y + 6 * s, 5 * s); };
const shade = (c, k) => {
  const m = /^#(..)(..)(..)$/.exec(c);
  if (!m) return c;
  const f = (h) => Math.max(0, Math.min(255, Math.round(parseInt(h, 16) * k))).toString(16).padStart(2, '0');
  return '#' + f(m[1]) + f(m[2]) + f(m[3]);
};

function background(g, p) {
  const gr = g.createLinearGradient(0, -50, 0, 50);
  gr.addColorStop(0, p.bg[0]); gr.addColorStop(1, p.bg[1]);
  g.fillStyle = gr; g.fillRect(-62, -52, 124, 104);
  const pat = p.pat;
  g.save();
  g.beginPath(); g.rect(-60, -50, 120, 100); g.clip();
  if (pat === 'rays') {
    g.fillStyle = 'rgba(255,255,255,.2)';
    for (let i = 0; i < 12; i++) { const a = (i / 12) * TAU, b = a + TAU / 24; g.beginPath(); g.moveTo(0, 8); g.lineTo(Math.cos(a) * 120, 8 + Math.sin(a) * 120); g.lineTo(Math.cos(b) * 120, 8 + Math.sin(b) * 120); g.closePath(); g.fill(); }
  } else if (pat === 'stripes') {
    g.fillStyle = 'rgba(255,255,255,.17)';
    for (let i = -8; i < 8; i++) { g.beginPath(); g.moveTo(i * 16, -50); g.lineTo(i * 16 + 8, -50); g.lineTo(i * 16 - 22, 50); g.lineTo(i * 16 - 30, 50); g.fill(); }
  } else if (pat === 'dots') {
    g.fillStyle = 'rgba(255,255,255,.2)';
    for (let y = -44; y < 50; y += 13) for (let x = -56 + ((y / 13) & 1) * 6; x < 60; x += 12) { g.beginPath(); g.arc(x, y, 2.6, 0, TAU); g.fill(); }
  } else if (pat === 'snow') {
    g.fillStyle = 'rgba(255,255,255,.8)';
    for (let i = 0; i < 26; i++) { g.beginPath(); g.arc(-58 + ((i * 37) % 118), -48 + ((i * 53) % 74), 0.9 + (i % 3) * 0.5, 0, TAU); g.fill(); }
    E(g, 0, 56, 80, 14, 'rgba(255,255,255,.9)');
  } else if (pat === 'stars') {
    g.fillStyle = 'rgba(255,255,255,.9)';
    for (let i = 0; i < 34; i++) { g.beginPath(); g.arc(-58 + ((i * 41) % 118), -48 + ((i * 59) % 96), 0.5 + (i % 4) * 0.35, 0, TAU); g.fill(); }
  } else if (pat === 'quilt') {
    for (let y = -50, j = 0; y < 50; y += 16, j++) for (let x = -64, i = 0; x < 64; x += 16, i++) { g.fillStyle = (i + j) & 1 ? 'rgba(255,255,255,.28)' : 'rgba(80,20,20,.18)'; g.fillRect(x, y, 16, 16); }
  } else {
    // hills
    E(g, -34, 54, 62, 26, shade(p.bg[1], 0.86)); E(g, 40, 58, 66, 26, shade(p.bg[1], 0.78));
  }
  g.restore();
}

// --- people ---------------------------------------------------------------------------------

function hat(g, kind, c) {
  c = c || '#c8301c';
  if (kind === 'toque') { E(g, 0, -22, 17.5, 10, c); R(g, -18, -22, 36, 7, shade(c, 0.78), 3); E(g, 0, -33, 5, 5, '#fff'); }
  else if (kind === 'hardhat') { g.fillStyle = c; g.beginPath(); g.ellipse(0, -21, 18, 14, 0, Math.PI, TAU); g.fill(); R(g, -22, -22, 44, 4.5, shade(c, 0.85), 2); R(g, -3, -34, 6, 13, shade(c, 0.88)); }
  else if (kind === 'cap') { g.fillStyle = c; g.beginPath(); g.ellipse(0, -21, 17.5, 13, 0, Math.PI, TAU); g.fill(); E(g, 13, -20, 14, 3.2, shade(c, 0.8)); }
  else if (kind === 'visor') { R(g, -18, -24, 36, 5, c, 2); E(g, 8, -20, 16, 3.2, shade(c, 0.85)); }
  else if (kind === 'tyrol') { R(g, -20, -23, 40, 4, shade(c, 0.75), 2); g.fillStyle = c; g.beginPath(); g.moveTo(-15, -22); g.lineTo(-10, -39); g.lineTo(10, -39); g.lineTo(15, -22); g.closePath(); g.fill(); R(g, -15, -27, 30, 3, '#c8a21a'); L(g, 9, -36, 20, -52, '#f4f0e6', 2.5); L(g, 9, -36, 17, -46, '#c8301c', 1.5); }
  else if (kind === 'straw') { E(g, 0, -21, 29, 6.5, c); g.fillStyle = shade(c, 0.9); g.beginPath(); g.ellipse(0, -23, 16, 14, 0, Math.PI, TAU); g.fill(); R(g, -16, -26, 32, 4, '#a83a2a'); }
  else if (kind === 'crown') { P(g, [[-14, -22], [-15, -37], [-7, -29], [0, -40], [7, -29], [15, -37], [14, -22]], c); E(g, 0, -33, 2, 2, '#c8301c'); E(g, -8, -27, 1.4, 1.4, '#2a8ad8'); E(g, 8, -27, 1.4, 1.4, '#2a8ad8'); }
  else if (kind === 'helmet') { g.fillStyle = c; g.beginPath(); g.ellipse(0, -18, 19, 15, 0, Math.PI, TAU); g.fill(); R(g, -19, -19, 38, 4, shade(c, 0.8)); E(g, 0, -28, 4, 3, '#fff'); }
  else if (kind === 'bonnet') { g.fillStyle = c; g.beginPath(); g.ellipse(0, -14, 19, 20, 0, Math.PI, TAU); g.fill(); E(g, 0, -12, 14, 12, 'rgba(0,0,0,0)'); R(g, -19, -14, 5, 22, c, 2); R(g, 14, -14, 5, 22, c, 2); L(g, -14, 4, -8, 22, '#8a8a9a', 1.2); }
  else if (kind === 'chef') { R(g, -16, -27, 32, 8, c, 2); E(g, -9, -32, 9, 8, c); E(g, 9, -32, 9, 8, c); E(g, 0, -37, 10, 8, c); }
  else if (kind === 'captain') { /* drawn by the goose */ }
}

function person(g, p) {
  const skin = p.skin || '#e8b890';
  // shoulders
  E(g, 0, 54, 35, 25, p.top || '#4a6a9a');
  if (p.vest) { P(g, [[-22, 40], [-9, 36], [-9, 80], [-30, 80]], '#f2e21c'); P(g, [[22, 40], [9, 36], [9, 80], [30, 80]], '#f2e21c'); R(g, -26, 52, 18, 3.5, '#e8e8e8'); R(g, 8, 52, 18, 3.5, '#e8e8e8'); }
  else { P(g, [[-6, 30], [0, 42], [6, 30]], '#f4f4f4'); }
  if (p.tie) P(g, [[-2.5, 32], [2.5, 32], [4, 52], [0, 56], [-4, 52]], p.tie);
  R(g, -6, 12, 12, 14, shade(skin, 0.86));
  if (p.hs === 2 || p.hs === 3) { E(g, 0, -4, 22, 24, p.hair || '#4a3a2a'); }
  E(g, -17, -4, 3.6, 5.2, shade(skin, 0.92)); E(g, 17, -4, 3.6, 5.2, shade(skin, 0.92));
  E(g, 0, -6, 17, 20, skin);
  if (p.hs) {
    g.fillStyle = p.hair || '#4a3a2a';
    g.beginPath(); g.ellipse(0, -10, 18.5, 16, 0, Math.PI, TAU); g.fill();
    if (p.hs === 3) { for (const [x, y] of [[-14, -22], [-6, -26], [3, -27], [12, -24], [17, -16]]) E(g, x, y, 7, 6, p.hair); }
    else if (p.hs === 2) { g.beginPath(); g.ellipse(-12, -7, 7, 14, 0.2, 0, TAU); g.fill(); }
  }
  eyes(g, 0, -7, 7.5, 3.2);
  if (p.glasses) { g.strokeStyle = '#1a1a1a'; g.lineWidth = 1.4; for (const s of [-1, 1]) { g.beginPath(); g.arc(s * 7.5, -7, 5.2, 0, TAU); g.stroke(); } L(g, -2.4, -7, 2.4, -7, '#1a1a1a', 1.2); }
  E(g, 0, -1, 2.4, 3, shade(skin, 0.88));
  if (p.stache) { E(g, -4.5, 4, 5.5, 2.6, p.stache, 0.2); E(g, 4.5, 4, 5.5, 2.6, p.stache, -0.2); }
  smile(g, 0, 8.5, 6);
  hat(g, p.hat, p.hc);
  // props held up at the right
  const pr = p.prop;
  if (pr === 'sign') { R(g, 34, -4, 3, 60, '#8a8a8a'); const a = (i) => [47 + Math.cos(Math.PI / 8 + i * Math.PI / 4) * 14, -14 + Math.sin(Math.PI / 8 + i * Math.PI / 4) * 14]; P(g, [0, 1, 2, 3, 4, 5, 6, 7].map(a), '#d8202a'); g.fillStyle = '#fff'; g.font = 'bold 8px sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('STOP', 47, -14); }
  else if (pr === 'blower') { R(g, 24, 32, 30, 8, '#e8a21c', 3); R(g, 50, 28, 12, 6, '#555', 2); E(g, 24, 38, 7, 8, '#c8301c'); }
  else if (pr === 'coffee') { P(g, [[28, 28], [40, 28], [38, 46], [30, 46]], '#f4f0e6'); R(g, 27, 25, 14, 4, '#c8301c', 1.5); }
  else if (pr === 'laptop') { P(g, [[-28, 54], [28, 54], [32, 68], [-32, 68]], '#9a9aa4'); R(g, -22, 36, 44, 19, '#2a2a3a', 2); R(g, -19, 39, 38, 13, '#4ac8f0', 1); }
  else if (pr === 'atom') { g.strokeStyle = '#6ad8ff'; g.lineWidth = 1.5; for (const r of [0, 1, 2]) { g.beginPath(); g.ellipse(42, -24, 13, 5, r * Math.PI / 3, 0, TAU); g.stroke(); } E(g, 42, -24, 3, 3, '#ffd23a'); }
  else if (pr === 'phone') { R(g, 24, 22, 14, 26, '#222', 3); R(g, 26, 25, 10, 16, '#4ac8f0', 1); for (let i = 0; i < 6; i++) E(g, 27 + (i % 3) * 3.2, 44 + Math.floor(i / 3) * 2.4, 1, 1, '#aaa'); }
  else if (pr === 'paddle') { R(g, 32, -10, 4, 28, '#8a5a32'); E(g, 34, -22, 11, 14, '#2a9a5a'); E(g, 34, -22, 8, 11, '#3ab86a'); E(g, 44, -4, 4, 4, '#f4f4f0'); }
}

// --- animals --------------------------------------------------------------------------------

function goose(g, p) {
  const gold = p.gold, white = gold ? '#ffe27a' : '#fafafa', shadow = gold ? '#e8a820' : '#d0d6de', S = p.small ? 0.78 : 1;
  g.save(); g.scale(S, S); g.translate(0, p.small ? 12 : 0);
  E(g, -4, 28, 36, 22, white); E(g, -34, 16, 14, 6, white, -0.5); E(g, -6, 30, 22, 12, shadow);
  g.strokeStyle = white; g.lineWidth = 12; g.lineCap = 'round'; g.beginPath(); g.moveTo(14, 20); g.bezierCurveTo(30, 10, 4, -14, 16, -28); g.stroke();
  g.strokeStyle = shadow; g.lineWidth = 2; g.beginPath(); g.moveTo(8, 18); g.bezierCurveTo(22, 8, -4, -14, 8, -28); g.stroke();
  E(g, 18, -30, 10, 8.5, white);
  P(g, [[26, -35], [44, -29], [27, -25]], gold ? '#d87a10' : '#f08a1c'); L(g, 27, -30, 42, -29.5, '#a8500c', 1);
  E(g, 21, -32, 2.4, 2.6, '#fff'); E(g, 21.6, -32, 1.4, 1.6, '#111'); L(g, 17, -37, 25, -34.5, '#222', 1.6);
  E(g, 14, -30, 3, 2, 'rgba(255,120,120,.3)');
  if (p.hat === 'captain') { E(g, 17, -39, 12, 3, '#f4f4f4'); R(g, 7, -47, 21, 9, '#1f3a6a', 3); R(g, 7, -41, 21, 3, '#f2c230'); E(g, 17, -43, 3, 2.5, '#f2c230'); }
  if (p.hat === 'crown') { P(g, [[8, -37], [8, -50], [13, -44], [18, -53], [23, -44], [28, -50], [28, -37]], '#f2c230'); E(g, 18, -44, 1.8, 1.8, '#c8301c'); }
  L(g, -10, 48, -10, 58, '#f08a1c', 3); L(g, 4, 48, 4, 58, '#f08a1c', 3); P(g, [[-16, 58], [-4, 58], [-9, 54]], '#f08a1c'); P(g, [[-2, 58], [10, 58], [4, 54]], '#f08a1c');
  if (gold) { g.fillStyle = 'rgba(255,255,255,.85)'; for (const [x, y] of [[-24, 18], [8, 28], [-8, 36], [30, 24], [26, -26]]) { P(g, [[x, y - 4], [x + 1.2, y - 1.2], [x + 4, y], [x + 1.2, y + 1.2], [x, y + 4], [x - 1.2, y + 1.2], [x - 4, y], [x - 1.2, y - 1.2]], 'rgba(255,255,255,.9)'); } }
  g.restore();
}

function critter(g, p, t) {
  const fur = { raccoon: '#8a8a96', squirrel: '#c8782a', beaver: '#7a4a2a', cow: '#fafafa', moose: '#6a4a2a', pigeon: '#9aa0b4', hawk: p.fur }[t];
  E(g, 0, 56, 36, 28, shade(fur, 0.9));
  if (t === 'squirrel') { g.strokeStyle = fur; g.lineWidth = 18; g.lineCap = 'round'; g.beginPath(); g.moveTo(34, 50); g.bezierCurveTo(60, 30, 56, -20, 36, -22); g.stroke(); g.strokeStyle = shade(fur, 1.2); g.lineWidth = 8; g.beginPath(); g.moveTo(34, 50); g.bezierCurveTo(60, 30, 56, -20, 36, -22); g.stroke(); }
  if (t === 'moose') { for (const s of [-1, 1]) { g.fillStyle = '#c8a870'; g.beginPath(); g.moveTo(s * 10, -18); g.lineTo(s * 32, -36); g.lineTo(s * 52, -34); g.lineTo(s * 56, -46); g.lineTo(s * 46, -44); g.lineTo(s * 44, -52); g.lineTo(s * 36, -44); g.lineTo(s * 30, -50); g.lineTo(s * 28, -40); g.lineTo(s * 12, -10); g.closePath(); g.fill(); } }
  if (t === 'cow') { for (const s of [-1, 1]) { P(g, [[s * 12, -22], [s * 22, -34], [s * 17, -20]], '#e8d8a8'); } }
  const ears = t === 'raccoon' ? [[-14, -22, 7, 8], [14, -22, 7, 8]] : t === 'squirrel' ? [[-12, -24, 5, 8], [12, -24, 5, 8]] : t === 'beaver' ? [[-15, -21, 5, 5], [15, -21, 5, 5]] : t === 'cow' ? [[-22, -14, 9, 5], [22, -14, 9, 5]] : t === 'moose' ? [[-20, -12, 8, 5], [20, -12, 8, 5]] : [];
  for (const [x, y, rx, ry] of ears) { E(g, x, y, rx, ry, shade(fur, 0.85)); E(g, x, y, rx * 0.55, ry * 0.55, '#e8a0a0'); }
  if (t === 'moose') { E(g, 0, 6, 15, 30, fur); E(g, 0, 22, 12, 12, '#8a6a4a'); E(g, -5, 24, 2, 3, '#222'); E(g, 5, 24, 2, 3, '#222'); eyes(g, 0, -8, 9, 2.6); }
  else if (t === 'pigeon') {
    E(g, 0, 0, 20, 19, fur); E(g, 0, 22, 14, 10, '#6a7a9a'); E(g, -18, 14, 7, 7, '#6a7a9a'); E(g, 16, 4, 8, 6, '#b8e8a8'); E(g, -14, 2, 4, 7, 'rgba(120,200,160,.8)'); P(g, [[6, -4], [22, 0], [6, 4]], '#f0a040'); eyes(g, -5, -6, 5.5, 2.8); g.fillStyle = '#d8a8c0';
  } else if (t === 'hawk') {
    E(g, 0, 0, 22, 21, fur); E(g, 0, 6, 15, 12, '#f4e8d0'); P(g, [[-12, 10], [-4, 14], [-18, 32]], p.sash); P(g, [[12, 10], [4, 14], [18, 32]], p.sash);
    P(g, [[-22, -10], [-34, -28], [-14, -16]], fur); P(g, [[22, -10], [34, -28], [14, -16]], fur);
    P(g, [[-5, -2], [5, -2], [0, 12]], '#f2c230'); P(g, [[-2, 6], [2, 6], [0, 14]], '#d8a010');
    eyes(g, 0, -9, 8, 3.4); L(g, -13, -16, -3, -12, '#222', 2); L(g, 13, -16, 3, -12, '#222', 2);
    R(g, -30, 40, 60, 5, p.trim);
  } else {
    // round-headed critters: raccoon, squirrel, beaver, cow
    E(g, 0, -4, 21, 19, fur);
    if (t === 'raccoon') { E(g, -9, -6, 9, 6, '#222'); E(g, 9, -6, 9, 6, '#222'); E(g, 0, 6, 11, 8, '#e8e8f0'); eyes(g, 0, -6, 9, 2.8); E(g, 0, 4, 3, 2.2, '#222'); smile(g, 0, 11, 4, '#333'); }
    if (t === 'squirrel') { E(g, 0, 7, 11, 8, '#f4d8a8'); eyes(g, 0, -7, 8.5, 3); E(g, 0, 3, 2.6, 2, '#222'); R(g, -2.5, 9, 5, 5, '#fff', 1); }
    if (t === 'beaver') { E(g, 0, 7, 12, 9, '#c8a070'); eyes(g, 0, -7, 8.5, 3); E(g, 0, 3, 4, 3, '#222'); R(g, -4, 8, 8, 8, '#fff', 1); L(g, 0, 8, 0, 16, '#bbb', 1); }
    if (t === 'cow') { E(g, -9, -14, 6, 5, '#222'); E(g, 12, 2, 5, 6, '#222'); E(g, 0, 8, 14, 10, '#f0a8a8'); E(g, -5, 9, 2.4, 3, '#a85a5a'); E(g, 5, 9, 2.4, 3, '#a85a5a'); eyes(g, 0, -7, 11, 3.4); E(g, -22, 50, 8, 8, '#222'); E(g, 20, 60, 9, 7, '#222'); }
  }
}

function horse(g) {
  E(g, 0, 58, 32, 24, '#7a4a2a');
  g.strokeStyle = '#7a4a2a'; g.lineWidth = 24; g.lineCap = 'round'; g.beginPath(); g.moveTo(-6, 40); g.lineTo(2, -10); g.stroke();
  E(g, 12, -16, 16, 22, '#7a4a2a', -0.5); E(g, 22, 0, 10, 12, '#8a5a3a', -0.3);
  P(g, [[-4, -32], [2, -48], [8, -30]], '#5a3a1a'); P(g, [[8, -32], [14, -46], [18, -30]], '#5a3a1a');
  g.strokeStyle = '#2a1a0a'; g.lineWidth = 7; g.beginPath(); g.moveTo(-4, -26); g.quadraticCurveTo(-18, -4, -10, 24); g.stroke();
  E(g, 10, -18, 3, 3.4, '#fff'); E(g, 10.6, -18, 1.8, 2, '#111'); E(g, 26, 6, 1.6, 2.4, '#222'); smile(g, 22, 8, 5, '#3a1a0a');
  R(g, 6, -30, 14, 3, '#c8301c'); E(g, 18, -24, 1.6, 1.6, '#f2c230');
  E(g, 2, 56, 3, 14, '#f4f0e6'); // blaze
}

// --- vehicles -------------------------------------------------------------------------------

const wheel = (g, x, y, r) => { E(g, x, y, r, r, '#1a1a1a'); E(g, x, y, r * 0.55, r * 0.55, '#bfc4cc'); E(g, x, y, r * 0.2, r * 0.2, '#555'); };
const road = (g, y = 44) => { R(g, -62, y, 124, 12, '#4a4a54'); for (let x = -56; x < 60; x += 22) R(g, x, y + 5, 12, 2, '#f2d21c'); };

function train(g, p) {
  road(g, 40); R(g, -62, 40, 124, 3, '#8a8a92');
  L(g, -62, -34, 62, -34, '#555', 1); // wire
  L(g, 4, -34, 10, -22, '#444', 1.6);
  R(g, -56, -22, 112, 52, p.body, 12); R(g, -56, 8, 112, 8, p.stripe);
  R(g, -50, -14, 24, 20, '#2a3a4a', 4); R(g, -22, -14, 24, 20, '#2a3a4a', 4); R(g, 6, -14, 24, 20, '#2a3a4a', 4);
  P(g, [[36, -14], [54, -4], [54, 6], [36, 6]], '#2a3a4a');
  E(g, 52, 20, 3, 3, '#fff6c0'); E(g, 44, 20, 3, 3, '#fff6c0');
  R(g, -56, 28, 112, 4, '#555'); wheel(g, -36, 34, 5); wheel(g, 36, 34, 5);
  eyes(g, 45, -4, 4.5, 2.3);
}
function buggy(g) {
  road(g, 46); R(g, -62, 46, 124, 4, '#3a3a40');
  // horse in front (right), buggy behind
  R(g, -50, -16, 46, 44, '#1a1a1a', 4); R(g, -44, -10, 14, 18, '#7a8a9a'); R(g, -26, -10, 14, 18, '#7a8a9a');
  P(g, [[-60, -16], [-44, -26], [-4, -26], [-4, -16]], '#2a2a2a');
  P(g, [[-58, 10], [-50, 10], [-54, 22]], '#f08a1c'); P(g, [[-56, 13], [-52, 13], [-54, 19]], '#c8301c');
  wheel(g, -44, 36, 11); wheel(g, -8, 36, 11);
  L(g, -4, 26, 20, 22, '#4a2a0a', 2.5);
  E(g, 30, 14, 20, 12, '#7a4a2a'); E(g, 30, 30, 4, 18, '#7a4a2a'); E(g, 18, 30, 4, 18, '#7a4a2a'); E(g, 46, 6, 8, 10, '#7a4a2a', -0.5); E(g, 52, 12, 6, 6, '#8a5a3a'); E(g, 48, 6, 1.6, 1.8, '#111'); P(g, [[44, -2], [47, -9], [49, -1]], '#5a3a1a');
}
function combine(g, p) {
  road(g, 46);
  R(g, -56, 8, 40, 10, '#e8c21c'); for (let x = -54; x < -18; x += 6) L(g, x, 8, x + 2, 18, '#a88a10', 1.5);
  P(g, [[-60, -10], [-52, -10], [-30, 6], [-60, 6]], '#c89a10'); // reel arm
  R(g, -18, -4, 60, 36, p.body, 6); R(g, 6, -26, 30, 30, p.body, 4); R(g, 10, -22, 22, 20, '#9ad8f0', 3);
  R(g, 36, 0, 18, 6, p.body); L(g, 34, -10, 56, -30, '#8a8a8a', 6);
  R(g, -12, 6, 28, 8, shade(p.body, 0.8)); E(g, 21, -12, 5, 5, '#fff'); E(g, 21, -12, 2.2, 2.2, '#1a1a1a');
  wheel(g, -2, 36, 13); wheel(g, 38, 40, 8);
}
function plow(g) {
  road(g, 46); E(g, 0, 56, 70, 14, '#fff');
  P(g, [[-60, 18], [-44, 6], [-40, 40], [-60, 44]], '#f2c21c'); L(g, -60, 18, -40, 40, '#a88a10', 2);
  R(g, -34, 4, 50, 36, '#e86a1c', 5); R(g, 16, -12, 34, 52, '#e86a1c', 6); R(g, 22, -6, 24, 18, '#9ad8f0', 3);
  R(g, 22, -20, 24, 6, '#f2c21c', 2); E(g, 30, -17, 2.4, 2.4, '#fff'); E(g, 40, -17, 2.4, 2.4, '#fff');
  E(g, 54, 36, 3, 4, '#fff6c0'); wheel(g, -16, 40, 10); wheel(g, 38, 40, 10);
  eyes(g, 34, 0, 5, 3);
}
function bus(g, p) {
  road(g, 44); R(g, -58, -16, 116, 52, p.body, 6); R(g, -58, 8, 116, 7, p.stripe);
  for (let i = 0; i < 5; i++) R(g, -52 + i * 20, -8, 15, 14, '#2a3a4a', 2);
  R(g, 44, -12, 10, 36, '#2a3a4a', 2); R(g, -44, -22, 28, 7, '#222', 2); g.fillStyle = '#f2a21c'; g.font = 'bold 6px monospace'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('7 KING', -30, -18.5);
  E(g, 54, 26, 2.6, 2.6, '#fff6c0'); wheel(g, -36, 38, 8); wheel(g, 30, 38, 8);
}
function zamboni(g) {
  R(g, -62, 38, 124, 14, '#e4f2fa'); L(g, -62, 38, 62, 38, '#b8d8ec', 1);
  R(g, -48, -4, 64, 38, '#2a6ac0', 4); R(g, -54, -22, 28, 20, '#cfd8e0', 2); // tank
  R(g, 10, -14, 34, 48, '#d8e0e8', 5); R(g, 14, -10, 26, 20, '#9ad8f0', 3); R(g, 44, 20, 14, 14, '#8a8a92', 2);
  R(g, -56, 22, 20, 12, '#4a4a54'); E(g, -50, 40, 14, 3, 'rgba(120,180,220,.6)');
  wheel(g, -28, 34, 8); wheel(g, 26, 34, 8); face(g, 27, 4, 0.8);
  R(g, -40, 6, 40, 4, '#f2c21c');
}
function car(g, p) {
  road(g, 46); E(g, 0, 50, 54, 5, 'rgba(0,0,0,.25)');
  R(g, -52, 10, 104, 28, p.body, 9); P(g, [[-30, 10], [-20, -12], [22, -12], [36, 10]], p.body);
  P(g, [[-25, 8], [-17, -8], [-4, -8], [-4, 8]], '#9ad8f0'); P(g, [[0, 8], [0, -8], [18, -8], [28, 8]], '#9ad8f0');
  // the driver
  E(g, -9, -1, 6, 7, '#e8b890'); eyes(g, -9, -2, 2.6, 1.5); if (p.hat === 'cap') { g.fillStyle = '#aa4a2a'; g.beginPath(); g.ellipse(-9, -4, 6.5, 5, 0, Math.PI, TAU); g.fill(); } else if (p.hat === 'visor') { R(g, -16, -8, 14, 3, '#222', 1); }
  if (p.taxi) { R(g, -10, -17, 20, 6, '#fff', 2); g.fillStyle = '#222'; g.font = 'bold 5px sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('TAXI', 0, -14); R(g, -52, 22, 104, 3, '#222'); }
  E(g, 49, 20, 3, 3.6, '#fff6c0'); R(g, -52, 22, 5, 6, '#c8301c'); wheel(g, -32, 38, 10); wheel(g, 32, 38, 10);
  R(g, 40, 32, 12, 4, '#8a8a8a');
}
function sausage(g) {
  road(g, 46); R(g, -52, -8, 104, 42, '#f0c070', 20); R(g, -48, -6, 96, 24, '#c83a2a', 12);
  g.strokeStyle = '#f2d21c'; g.lineWidth = 2.5; g.beginPath(); g.moveTo(-40, 6); for (let x = -40; x < 40; x += 10) g.quadraticCurveTo(x + 2.5, 0, x + 5, 6), g.quadraticCurveTo(x + 7.5, 12, x + 10, 6); g.stroke();
  R(g, 10, -4, 22, 14, '#9ad8f0', 4); eyes(g, -14, 4, 7, 4); smile(g, -14, 14, 6, '#5a1a0a');
  wheel(g, -30, 40, 9); wheel(g, 30, 40, 9); E(g, 47, 20, 3, 3.6, '#fff6c0');
}
function float(g) {
  R(g, -58, 26, 116, 12, '#6a4a2a'); R(g, -58, 38, 116, 4, '#3a2a1a'); wheel(g, -36, 44, 9); wheel(g, 36, 44, 9);
  R(g, -52, 18, 104, 8, '#c8301c'); for (let x = -50; x < 50; x += 12) { P(g, [[x, 18], [x + 6, 18], [x + 3, 12]], '#f4f0e6'); }
  // a giant stein
  R(g, -20, -26, 40, 46, '#f2c21c', 5); R(g, -20, -30, 40, 10, '#fafafa', 5); for (let x = -16; x < 20; x += 9) E(g, x + 3, -30, 5, 4, '#fafafa');
  g.strokeStyle = '#d8a010'; g.lineWidth = 6; g.beginPath(); g.arc(26, -4, 12, -Math.PI / 2, Math.PI / 2); g.stroke();
  eyes(g, 0, -6, 8, 4); smile(g, 0, 8, 7);
  for (const [x, c] of [[-46, '#2a8ad8'], [-38, '#fafafa'], [46, '#2a8ad8'], [38, '#fafafa']]) { L(g, x, 18, x, -20, '#8a6a3a', 1.6); P(g, [[x, -20], [x + (x < 0 ? 9 : -9), -15], [x, -10]], c); }
}
function plane(g) {
  g.save(); g.rotate(-0.18);
  E(g, 0, 4, 44, 11, '#f4f0e6'); P(g, [[-40, 0], [-56, -14], [-48, 6]], '#c8301c'); R(g, -10, -6, 6, 36, '#f4f0e6'); P(g, [[-12, 4], [8, 4], [-2, 34], [-14, 34]], '#e0d8c8');
  E(g, 14, -2, 12, 6, '#9ad8f0'); eyes(g, 14, -2, 4, 2.4); R(g, 42, -7, 4, 22, '#4a4a4a'); R(g, 38, 6, 12, 3, '#c8301c');
  L(g, -2, 30, 4, 30, '#444', 3); g.restore();
  g.save(); g.fillStyle = 'rgba(255,255,255,.7)'; E(g, -46, 30, 18, 6, 'rgba(255,255,255,.7)'); E(g, 40, -36, 14, 5, 'rgba(255,255,255,.7)'); g.restore();
}
function saucer(g) {
  P(g, [[-12, 22], [12, 22], [34, 54], [-34, 54]], 'rgba(160,255,200,.3)');
  E(g, 0, 8, 46, 12, '#8a98b0'); E(g, 0, 4, 40, 8, '#b8c8dc'); E(g, 0, -6, 22, 18, 'rgba(140,230,255,.75)');
  for (let i = -3; i <= 3; i++) E(g, i * 12, 12, 2.2, 2.2, i & 1 ? '#ffd23a' : '#ff6aa8');
  E(g, 0, -4, 8, 9, '#6ad86a'); eyes(g, 0, -6, 3.6, 2.2); E(g, -7, -18, 2.4, 2, '#fff');
}
function balloon(g) {
  const cols = ['#d8302a', '#f2c21c', '#2a8ad8', '#2a9a5a', '#f4f0e6', '#d8302a'];
  for (let i = 0; i < 6; i++) { g.fillStyle = cols[i]; g.beginPath(); g.moveTo(-30 + i * 10, -4); g.bezierCurveTo(-34 + i * 10 - 8, -34, -20 + i * 5, -50, 0, -50); g.bezierCurveTo(20 - i * 5, -50, 34 - (5 - i) * 10 + 8, -34, -30 + (i + 1) * 10, -4); g.closePath(); g.fill(); }
  g.fillStyle = cols[0]; g.beginPath(); g.ellipse(0, -22, 31, 28, 0, 0, TAU); g.fill();
  for (let i = 0; i < 6; i++) { g.save(); g.beginPath(); g.ellipse(0, -22, 31, 28, 0, 0, TAU); g.clip(); R(g, -31 + i * 10.4, -52, 10.4, 56, cols[i]); g.restore(); }
  P(g, [[-12, 6], [12, 6], [8, 18], [-8, 18]], '#d8302a'); L(g, -12, 4, -8, 18, '#444', 1.2); L(g, 12, 4, 8, 18, '#444', 1.2);
  R(g, -9, 18, 18, 12, '#8a5a32', 2); E(g, 0, 17, 4, 4, '#e8b890'); eyes(g, 0, 17, 1.8, 1);
}
function canoe(g) {
  E(g, 0, 40, 70, 8, 'rgba(255,255,255,.4)'); for (const x of [-40, 0, 40]) E(g, x, 46, 14, 2.4, '#fff');
  g.fillStyle = '#c8301c'; g.beginPath(); g.moveTo(-58, 18); g.quadraticCurveTo(0, 54, 58, 18); g.quadraticCurveTo(0, 30, -58, 18); g.fill();
  R(g, -3, 20, 6, 20, '#8a8a8a'); // fishing nothing
  P(g, [[-16, 4], [16, 4], [20, 28], [-20, 28]], '#2a8a4a');
  E(g, 0, -10, 12, 13, '#e8b890'); eyes(g, 0, -11, 5, 2.6); smile(g, 0, -4, 4); E(g, 0, -20, 14, 5, '#a8884a'); g.fillStyle = '#a8884a'; g.beginPath(); g.ellipse(0, -22, 8, 8, 0, Math.PI, TAU); g.fill();
  L(g, 20, -10, 6, 50, '#8a5a32', 3); P(g, [[2, 46], [14, 52], [8, 62], [0, 54]], '#8a5a32');
}

// --- things with faces ---------------------------------------------------------------------------

function cup(g, p) {
  E(g, 0, 50, 36, 6, 'rgba(0,0,0,.2)');
  P(g, [[-30, -22], [30, -22], [22, 48], [-22, 48]], p.cup); R(g, -34, -32, 68, 12, shade(p.cup, 0.9), 5); R(g, -29, -37, 58, 8, '#e8e4d8', 4);
  P(g, [[-27, -2], [27, -2], [24, 26], [-24, 26]], p.sleeve); R(g, -27, 0, 54, 6, p.band);
  face(g, 0, 12, 1.1); E(g, -13, 18, 3.4, 2, 'rgba(255,100,100,.4)'); E(g, 13, 18, 3.4, 2, 'rgba(255,100,100,.4)');
  g.strokeStyle = 'rgba(255,255,255,.7)'; g.lineWidth = 2; g.beginPath(); g.moveTo(-8, -52); g.quadraticCurveTo(-14, -60, -8, -66); g.stroke();
}
function cone(g) {
  E(g, 0, 50, 36, 7, '#3a3a40'); R(g, -32, 42, 64, 8, '#2a2a30', 2);
  P(g, [[-8, -40], [8, -40], [30, 42], [-30, 42]], '#f06a1c'); P(g, [[-14, -14], [14, -14], [19, 4], [-19, 4]], '#fafafa'); P(g, [[-22, 20], [22, 20], [26, 33], [-26, 33]], '#fafafa');
  E(g, 0, -40, 8, 3, '#d85a14'); face(g, 0, 10, 0.9);
}
function pretzel(g) {
  g.strokeStyle = '#9a5a22'; g.lineWidth = 11; g.lineCap = 'round'; g.beginPath(); g.moveTo(-24, 34); g.bezierCurveTo(-52, -6, -20, -40, 0, -10); g.bezierCurveTo(20, -40, 52, -6, 24, 34); g.moveTo(-24, 34); g.bezierCurveTo(-10, 14, 10, 14, 24, 34); g.stroke();
  g.strokeStyle = '#c47a3a'; g.lineWidth = 5; g.beginPath(); g.moveTo(-24, 34); g.bezierCurveTo(-52, -6, -20, -40, 0, -10); g.bezierCurveTo(20, -40, 52, -6, 24, 34); g.stroke();
  g.fillStyle = '#fffbe8'; for (const [x, y] of [[-34, 6], [-22, -26], [-6, -16], [10, -26], [30, 6], [4, 24], [-14, 26], [20, 22]]) R(g, x, y, 4, 2, '#fffbe8', 1);
  eyes(g, 0, -4, 7, 3.4); smile(g, 0, 6, 6);
}
function bridge(g) {
  E(g, 0, 50, 70, 10, 'rgba(60,120,180,.5)');
  R(g, -58, 28, 116, 7, '#6a4a2a'); R(g, -52, -14, 104, 42, '#b8301c', 2);
  P(g, [[-60, -14], [0, -42], [60, -14]], '#4a3a30'); P(g, [[-60, -14], [0, -42], [60, -14], [0, -34]], '#5a4a40');
  g.fillStyle = '#1a1a1a'; g.beginPath(); g.moveTo(-26, 28); g.lineTo(-26, 4); g.quadraticCurveTo(0, -14, 26, 4); g.lineTo(26, 28); g.closePath(); g.fill();
  g.fillStyle = '#6a4a2a'; for (let x = -24; x < 26; x += 8) R(g, x, 24, 4, 4, '#3a2a1a');
  for (const x of [-44, 44]) R(g, x - 5, -8, 10, 16, '#1a1a1a', 1);
  // two little hearts
  for (const [x, y, s] of [[-8, -4, 1], [10, -8, 1.3]]) { g.fillStyle = '#ff6a8a'; g.beginPath(); g.moveTo(x, y + 3 * s); g.bezierCurveTo(x - 6 * s, y - 3 * s, x - 2 * s, y - 7 * s, x, y - 2 * s); g.bezierCurveTo(x + 2 * s, y - 7 * s, x + 6 * s, y - 3 * s, x, y + 3 * s); g.fill(); }
  eyes(g, 0, 14, 5, 2.4);
}
function pothole(g) {
  R(g, -62, -50, 124, 100, '#585862'); for (let i = 0; i < 18; i++) E(g, -56 + ((i * 47) % 112), -44 + ((i * 29) % 92), 1.2, 1, '#6a6a76');
  R(g, -62, 38, 124, 3, '#e8c21c'); L(g, -62, -12, -40, -12, '#e8c21c', 2);
  E(g, 0, 18, 46, 22, '#2a2a30'); E(g, 0, 14, 40, 17, '#16161a'); E(g, 0, 30, 36, 8, '#4a4a58', 0);
  for (const [x, y] of [[-36, 8], [-30, 24], [36, 10], [30, 26]]) P(g, [[x, y], [x + 8, y - 4], [x + 5, y + 6]], '#585862');
  eyes(g, 0, 8, 12, 5.4, 1); E(g, 0, 26, 12, 4, '#0a0a0e'); R(g, -6, 24, 3, 4, '#fafafa', 1); R(g, 3, 24, 3, 4, '#fafafa', 1);
}
function chair(g) {
  R(g, -62, -38, 124, 3, '#3a3a44'); L(g, -62, -37, 62, -29, '#555', 1.4);
  L(g, 0, -34, 0, -10, '#555', 2.5); R(g, -4, -12, 8, 4, '#c8301c');
  P(g, [[-26, -8], [26, -8], [24, 6], [-24, 6]], '#c8301c'); R(g, -26, 6, 52, 6, '#7a1a14', 2); R(g, -26, 12, 8, 18, '#555'); R(g, 18, 12, 8, 18, '#555');
  E(g, 0, -4, 10, 8, '#3a6a9a'); E(g, 0, -18, 9, 10, '#e8b890'); eyes(g, 0, -19, 4, 2.2); smile(g, 0, -13, 3.4); g.fillStyle = '#2a8ad8'; g.beginPath(); g.ellipse(0, -22, 9.5, 7, 0, Math.PI, TAU); g.fill(); E(g, 0, -30, 3, 3, '#fff');
  L(g, -8, 6, -9, 36, '#2a5a8a', 6); L(g, 8, 6, 9, 36, '#2a5a8a', 6); E(g, -9, 38, 6, 3, '#222'); E(g, 9, 38, 6, 3, '#222');
  L(g, -24, 22, -34, 36, '#e8c21c', 2); L(g, -34, 36, -30, 38, '#e8c21c', 2);
}
function syrup(g) {
  P(g, [[-14, -26], [14, -26], [22, 6], [24, 44], [-24, 44], [-22, 6]], '#c8781c'); P(g, [[-10, -22], [10, -22], [16, 6], [18, 40], [-18, 40], [-16, 6]], '#e8a028');
  R(g, -9, -40, 18, 15, '#4a2a0a', 3); R(g, -22, 8, 44, 22, '#f4f0e6', 3);
  const lf = [[0, -1], [0.3, -0.4], [0.9, -0.2], [0.4, 0.2], [0.5, 0.9], [0, 0.5], [-0.5, 0.9], [-0.4, 0.2], [-0.9, -0.2], [-0.3, -0.4]]; P(g, lf.map(([x, y]) => [x * 7, 19 + y * 7]), '#d8201c');
  eyes(g, 0, -4, 6, 3); smile(g, 0, 2, 4);
  g.fillStyle = '#d8902a'; g.beginPath(); g.moveTo(-14, -26); g.quadraticCurveTo(-18, -20, -14, -14); g.fill();
}
function tart(g) {
  E(g, 0, 40, 46, 8, 'rgba(0,0,0,.2)'); P(g, [[-40, 18], [40, 18], [34, 42], [-34, 42]], '#d8a050'); for (let x = -36; x < 36; x += 8) L(g, x, 18, x + 1, 42, '#b8803a', 1.4);
  E(g, 0, 18, 42, 12, '#e0aa5a'); E(g, 0, 16, 36, 9, '#a85a14'); E(g, 0, 15, 30, 7, '#c8781c'); E(g, -14, 12, 6, 2.4, 'rgba(255,255,255,.4)');
  for (const [x, y] of [[-16, 17], [14, 18], [2, 12]]) E(g, x, y, 3, 1.8, '#5a2a14');
  eyes(g, 0, 14, 11, 3.6); smile(g, 0, 22, 7);
}
function clock(g) {
  R(g, -18, -10, 36, 66, '#a8482a', 2); P(g, [[-24, -10], [0, -40], [24, -10]], '#4a6a5a'); R(g, -2, -50, 4, 12, '#c8a21a');
  E(g, 0, 8, 17, 17, '#f8f4e8'); E(g, 0, 8, 17, 17, 'rgba(0,0,0,0)'); g.strokeStyle = '#3a2a1a'; g.lineWidth = 2.4; g.beginPath(); g.arc(0, 8, 17, 0, TAU); g.stroke();
  for (let i = 0; i < 12; i++) { const a = (i / 12) * TAU; L(g, Math.sin(a) * 14, 8 - Math.cos(a) * 14, Math.sin(a) * 16, 8 - Math.cos(a) * 16, '#3a2a1a', 1.4); }
  L(g, 0, 8, 6, 2, '#3a2a1a', 2.2); L(g, 0, 8, -2, -4, '#3a2a1a', 1.6); eyes(g, 0, 14, 5, 2); R(g, -10, 38, 20, 18, '#3a2a1a', 8); for (const y of [30, 48]) R(g, -18, y, 36, 3, '#8a3a1a');
}
function snowman(g) {
  E(g, 0, 36, 28, 26, '#fafafa'); E(g, 0, 6, 20, 18, '#fafafa'); E(g, 0, -22, 14, 13, '#fafafa');
  E(g, -6, 40, 28, 22, 'rgba(180,200,230,.35)'); eyes(g, 0, -24, 5, 2.4); P(g, [[0, -21], [14, -18], [0, -17]], '#f08a1c');
  for (const x of [-4, -1.4, 1.4, 4]) E(g, x, -13 + Math.abs(x) * 0.2, 1, 1, '#222');
  for (const y of [2, 12, 24]) E(g, 0, y, 2.4, 2.4, '#222');
  R(g, -14, -12, 28, 5, '#c8301c', 2); R(g, 8, -12, 6, 18, '#c8301c', 2);
  E(g, 0, -34, 13, 4, '#2a3a4a'); R(g, -9, -48, 18, 14, '#2a3a4a', 2); R(g, -9, -39, 18, 4, '#c8301c');
  L(g, -18, 6, -42, -10, '#5a3a1a', 3); L(g, 18, 6, 42, -8, '#5a3a1a', 3); L(g, -36, -6, -42, -16, '#5a3a1a', 2);
}
function ghost(g) {
  g.fillStyle = 'rgba(255,255,255,.92)'; g.beginPath(); g.moveTo(-26, 50); g.lineTo(-26, -8); g.bezierCurveTo(-26, -42, 26, -42, 26, -8); g.lineTo(26, 50); g.quadraticCurveTo(18, 40, 13, 50); g.quadraticCurveTo(6, 40, 0, 50); g.quadraticCurveTo(-6, 40, -13, 50); g.quadraticCurveTo(-18, 40, -26, 50); g.fill();
  E(g, -9, -10, 5, 7, '#1a1a3a'); E(g, 9, -10, 5, 7, '#1a1a3a'); E(g, 0, 8, 6, 9, '#1a1a3a'); E(g, -8, -12, 1.4, 1.4, '#fff'); E(g, 10, -12, 1.4, 1.4, '#fff');
  E(g, -16, 2, 5, 3, 'rgba(255,120,160,.4)'); E(g, 16, 2, 5, 3, 'rgba(255,120,160,.4)');
  g.fillStyle = 'rgba(255,255,255,.4)'; g.beginPath(); g.ellipse(-38, 20, 8, 5, 0.4, 0, TAU); g.fill();
  R(g, 20, 14, 18, 24, '#e8d8a8', 2); L(g, 24, 20, 34, 20, '#8a6a3a', 1.2); L(g, 24, 25, 34, 25, '#8a6a3a', 1.2); L(g, 24, 30, 31, 30, '#8a6a3a', 1.2);
}
function leaf(g) {
  const Pt = [[0, -46], [8, -26], [20, -33], [16, -10], [38, -20], [32, -4], [48, -2], [34, 12], [40, 20], [14, 18], [18, 32], [3, 26], [3, 52], [-3, 52], [-3, 26], [-18, 32], [-14, 18], [-40, 20], [-34, 12], [-48, -2], [-32, -4], [-38, -20], [-16, -10], [-20, -33], [-8, -26]];
  P(g, Pt.map(([x, y]) => [x, y]), '#d8301c'); P(g, Pt.map(([x, y]) => [x * 0.8, y * 0.8 + 2]), '#f06a1c');
  g.strokeStyle = 'rgba(160,30,10,.7)'; g.lineWidth = 1.4; for (const [x, y] of [[0, -40], [-26, -14], [26, -14], [-30, 10], [30, 10]]) { g.beginPath(); g.moveTo(0, 20); g.lineTo(x, y); g.stroke(); }
  eyes(g, 0, 0, 8, 3.6); smile(g, 0, 10, 6);
}
function gorge(g) {
  P(g, [[-62, -50], [-18, -50], [-14, 10], [-24, 52], [-62, 52]], '#8a7a62'); P(g, [[62, -50], [20, -50], [16, 6], [26, 52], [62, 52]], '#7a6a52');
  for (const [x, y] of [[-30, -30], [-40, -4], [-44, 26], [34, -26], [38, 8], [42, 34]]) R(g, x, y, 14, 3, 'rgba(0,0,0,.18)');
  P(g, [[-18, -50], [20, -50], [16, 6], [26, 52], [-24, 52], [-14, 10]], '#6ac8e8'); P(g, [[-6, -10], [10, -10], [14, 52], [-12, 52]], '#a8e8f8');
  for (let i = 0; i < 6; i++) E(g, -2 + (i % 2) * 6, 24 + i * 5, 8 - i * 0.4, 1.8, 'rgba(255,255,255,.8)');
  for (const [x, y] of [[-52, -44], [-44, -46], [50, -44], [44, -48]]) { E(g, x, y, 8, 12, '#2a7a3a'); }
  for (const [x, y] of [[-48, -34], [-34, -40], [46, -34], [34, -40]]) { E(g, x, y, 6, 9, '#c8601c'); }
}

const DRAW = {
  person, goose, horse, train, buggy, combine, plow, bus, zamboni, car, sausage, float, plane, saucer, balloon, canoe,
  cup, cone, pretzel, bridge, pothole, chair, syrup, tart, clock, snowman, ghost, leaf, gorge,
  hawk: (g, p) => critter(g, p, 'hawk'), raccoon: (g, p) => critter(g, p, 'raccoon'), squirrel: (g, p) => critter(g, p, 'squirrel'),
  beaver: (g, p) => critter(g, p, 'beaver'), cow: (g, p) => critter(g, p, 'cow'), moose: (g, p) => critter(g, p, 'moose'), pigeon: (g, p) => critter(g, p, 'pigeon'),
  troll: (g, p) => person(g, { skin: '#7ab05a', hair: '#3a4a2a', hs: 3, hat: 'none', top: '#4a3a2a', stache: null, bg: p.bg, pat: p.pat }),
  yeti: (g) => {
    E(g, 0, 56, 40, 30, '#f0f6fa'); E(g, 0, -4, 24, 24, '#f0f6fa'); for (const [x, y] of [[-20, -22], [-8, -28], [6, -28], [20, -22]]) E(g, x, y, 8, 7, '#f0f6fa');
    E(g, 0, 0, 14, 14, '#a8c8e0'); E(g, -7, -8, 7, 5, '#fff'); E(g, 7, -8, 7, 5, '#fff'); E(g, -6, -8, 2.4, 2.6, '#111'); E(g, 8, -8, 2.4, 2.6, '#111');
    L(g, -12, -14, -3, -11, '#6a8aa8', 2.2); L(g, 12, -14, 3, -11, '#6a8aa8', 2.2); E(g, 0, 8, 7, 4.4, '#7a4a5a'); for (const x of [-4, 0, 4]) R(g, x - 1, 6, 2, 4, '#fff', 0.5);
    P(g, [[-46, 8], [-60, 36], [-38, 30]], '#f0f6fa'); P(g, [[46, 8], [60, 36], [38, 30]], '#f0f6fa');
  },
};

/** The portrait for a card, drawn into a 120 x 100 box at (0,0) of the current transform. */
export function drawPortrait(g, card) {
  const p = card.p;
  background(g, p);
  g.save();
  g.beginPath(); g.rect(-60, -50, 120, 100); g.clip();
  const d = DRAW[card.kind];
  if (d) d(g, p);
  g.restore();
}

// ---------------------------------------------------------------------------------------------
// the card itself: 300 x 420 base units

export const CARD_W = 300, CARD_H = 420;
const SERIF = 'Georgia, "Times New Roman", serif';
const SANS = '-apple-system, "Helvetica Neue", Arial, sans-serif';
const BLOCK = '"Arial Black", "Helvetica Neue", Impact, Arial, sans-serif';

function rr(g, x, y, w, h, r) { g.beginPath(); if (g.roundRect) g.roundRect(x, y, w, h, r); else g.rect(x, y, w, h); }

function wrap(g, text, maxW, maxLines) {
  const words = text.split(' '), lines = [];
  let cur = '';
  for (const w of words) {
    const t = cur ? cur + ' ' + w : w;
    if (g.measureText(t).width > maxW && cur) { lines.push(cur); cur = w; } else cur = t;
  }
  if (cur) lines.push(cur);
  return lines.slice(0, maxLines);
}

/** Draw card `card`'s base (no sheen) into a W x H area at the origin of g. */
export function drawCardBase(g, card, W = CARD_W, H = CARD_H) {
  const R0 = RARITY[card.r];
  g.save();
  g.scale(W / CARD_W, H / CARD_H);
  // border
  rr(g, 0, 0, CARD_W, CARD_H, 20);
  const bg = g.createLinearGradient(0, 0, CARD_W, CARD_H);
  if (card.r === 'g') { bg.addColorStop(0, '#fff2a8'); bg.addColorStop(0.35, '#f2c230'); bg.addColorStop(0.7, '#c8901c'); bg.addColorStop(1, '#ffe27a'); }
  else if (card.r === 'h') { bg.addColorStop(0, '#d8a8ff'); bg.addColorStop(0.5, '#7a3ac8'); bg.addColorStop(1, '#b8d8ff'); }
  else { bg.addColorStop(0, R0.col); bg.addColorStop(1, R0.dark); }
  g.fillStyle = bg; g.fill();
  rr(g, 8, 8, CARD_W - 16, CARD_H - 16, 14); g.fillStyle = '#fbf6e6'; g.fill();
  // header
  rr(g, 8, 8, CARD_W - 16, 50, 14); const hb = g.createLinearGradient(0, 8, 0, 58); hb.addColorStop(0, R0.col); hb.addColorStop(1, R0.dark); g.fillStyle = hb; g.fill();
  g.fillStyle = '#fbf6e6'; g.fillRect(8, 40, CARD_W - 16, 18); g.fillStyle = 'rgba(0,0,0,0)';
  g.fillStyle = hb; g.fillRect(8, 40, CARD_W - 16, 0);
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillStyle = '#fff'; g.font = `800 ${card.name.length > 24 ? 17 : 20}px ${SERIF}`;
  g.shadowColor = 'rgba(0,0,0,.5)'; g.shadowBlur = 3; g.shadowOffsetY = 1;
  g.fillText(card.name, CARD_W / 2, 27, CARD_W - 40);
  g.shadowColor = 'transparent'; g.shadowBlur = 0; g.shadowOffsetY = 0;
  g.fillStyle = R0.dark; g.font = `700 11px ${SANS}`; g.fillText(card.role.toUpperCase(), CARD_W / 2, 49, CARD_W - 36);
  // art window
  const ax = 22, ay = 62, aw = CARD_W - 44, ah = 184;
  rr(g, ax - 3, ay - 3, aw + 6, ah + 6, 8); g.fillStyle = R0.dark; g.fill();
  g.save(); rr(g, ax, ay, aw, ah, 5); g.clip();
  g.translate(ax + aw / 2, ay + ah / 2); const sc = Math.min(aw / 120, ah / 100) * 1.05; g.scale(sc * 1.0, sc * 1.0);
  // stretch the 120x100 portrait box to the window width
  g.save(); g.scale(aw / (120 * sc) * 1.0, ah / (100 * sc) * 1.0); g.restore();
  g.save(); g.scale(1.0, 1.0);
  g.beginPath(); g.rect(-aw / sc / 2, -ah / sc / 2, aw / sc, ah / sc); g.clip();
  // the portrait is 120 x 100; the window is wider: extend the background
  g.save(); const k = Math.max(1, (aw / sc) / 120); g.scale(k * 1.0, 1.0); drawPortrait(g, card); g.restore();
  g.restore();
  g.restore();
  // team ribbon
  g.fillStyle = R0.dark; g.fillRect(ax - 3, ay + ah + 8, aw + 6, 20);
  g.fillStyle = '#fff'; g.font = `700 11px ${SANS}`; g.fillText(card.team.toUpperCase(), CARD_W / 2, ay + ah + 18.5, aw - 10);
  // stat
  const sy = ay + ah + 36;
  rr(g, ax, sy, aw, 30, 6); g.fillStyle = '#efe6cc'; g.fill(); g.strokeStyle = R0.col; g.lineWidth = 1.5; g.stroke();
  g.textAlign = 'left'; g.fillStyle = '#6a5a3a'; g.font = `800 10px ${SANS}`; g.fillText(card.stat[0], ax + 9, sy + 15, aw * 0.45);
  g.textAlign = 'right'; g.fillStyle = '#2a1a0a'; g.font = `900 14px ${BLOCK}`; g.fillText(card.stat[1], ax + aw - 9, sy + 15, aw * 0.5);
  // flavour
  g.textAlign = 'center'; g.fillStyle = '#4a3a22'; g.font = `italic 600 11.5px ${SERIF}`;
  const lines = wrap(g, card.flavour, aw - 6, 3);
  lines.forEach((l, i) => g.fillText(l, CARD_W / 2, sy + 44 + i * 13.5, aw));
  // footer
  g.font = `800 10px ${SANS}`; g.textAlign = 'left'; g.fillStyle = R0.dark;
  g.fillText(`#${String(card.id).padStart(2, '0')}/${SET_SIZE}`, 20, CARD_H - 18);
  g.textAlign = 'right'; g.fillText(R0.name, CARD_W - 20, CARD_H - 18);
  g.textAlign = 'center'; g.fillStyle = '#7a6a4a'; g.font = `700 8.5px ${SANS}`; g.fillText('J&J · SERIES 1', CARD_W / 2, CARD_H - 18, 90);
  g.restore();
}

/** The back of every card: royal blue, a red band, a gold J&J. */
export function drawCardBack(g, W = CARD_W, H = CARD_H) {
  g.save(); g.scale(W / CARD_W, H / CARD_H);
  rr(g, 0, 0, CARD_W, CARD_H, 20); g.fillStyle = '#f2c230'; g.fill();
  rr(g, 7, 7, CARD_W - 14, CARD_H - 14, 15); const gr = g.createLinearGradient(0, 0, 0, CARD_H); gr.addColorStop(0, '#2a74e0'); gr.addColorStop(1, '#14409a'); g.fillStyle = gr; g.fill();
  g.save(); rr(g, 7, 7, CARD_W - 14, CARD_H - 14, 15); g.clip();
  g.strokeStyle = 'rgba(255,255,255,.1)'; g.lineWidth = 8;
  for (let i = -CARD_H; i < CARD_W + CARD_H; i += 26) { g.beginPath(); g.moveTo(i, 0); g.lineTo(i + CARD_H, CARD_H); g.stroke(); }
  g.fillStyle = '#a3191c'; g.fillRect(0, CARD_H * 0.42, CARD_W, 62);
  g.fillStyle = '#f2c230'; g.fillRect(0, CARD_H * 0.42 - 4, CARD_W, 4); g.fillRect(0, CARD_H * 0.42 + 62, CARD_W, 4);
  g.restore();
  // battlements across the top and bottom
  g.fillStyle = '#f2c230'; for (let x = 24; x < CARD_W - 30; x += 22) { g.fillRect(x, 20, 12, 12); g.fillRect(x, CARD_H - 32, 12, 12); }
  g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillStyle = '#fff';
  g.font = `italic 800 62px ${SERIF}`; g.shadowColor = 'rgba(0,0,0,.5)'; g.shadowBlur = 6; g.fillText('J&J', CARD_W / 2, CARD_H * 0.42 + 31);
  g.shadowBlur = 0; g.fillStyle = '#f2c230'; g.font = `800 14px ${SANS}`; g.fillText('WATERLOO REGION', CARD_W / 2, CARD_H * 0.2); g.font = `italic 800 30px ${SERIF}`; g.fillText('Legends', CARD_W / 2, CARD_H * 0.2 + 30);
  g.fillStyle = '#fff'; g.font = `800 12px ${SANS}`; g.fillText('SERIES 1 · 60 CARDS', CARD_W / 2, CARD_H * 0.72); g.fillStyle = '#f2c230'; g.font = `700 11px ${SANS}`; g.fillText('230 WEBER ST N', CARD_W / 2, CARD_H * 0.8);
  g.restore();
}

const rainbow = (g, x, y, w, h, phase, ang, a) => {
  const cx = x + w / 2, cy = y + h / 2, L2 = Math.hypot(w, h) * 0.62, dx = Math.cos(ang) * L2, dy = Math.sin(ang) * L2;
  const gr = g.createLinearGradient(cx - dx, cy - dy, cx + dx, cy + dy);
  for (let i = 0; i <= 10; i++) { const o = i / 10, hue = ((o * 2 + phase) * 360) % 360; gr.addColorStop(o, `hsla(${hue.toFixed(0)},95%,${i & 1 ? 62 : 55}%,${(a * (i & 1 ? 1 : 0.35)).toFixed(3)})`); }
  g.fillStyle = gr; g.fillRect(x, y, w, h);
};

/**
 * The live sheen over a face-up card drawn at (x, y, w, h): `tx, ty` in -1..1 is where the
 * light comes from (the pointer, or a slow drift), `t` seconds.
 */
export function sheen(g, card, x, y, w, h, tx, ty, t) {
  const r = card.r;
  g.save();
  rr(g, x, y, w, h, 20 * w / CARD_W); g.clip();
  g.globalCompositeOperation = 'lighter';
  const ph = tx * 0.55 + ty * 0.3 + t * 0.045;
  if (r === 'h') {
    rainbow(g, x, y, w, h, ph, 0.9 + tx * 0.3, 0.17);
    const ax = x + w * 22 / CARD_W, ay = y + h * 62 / CARD_H;
    g.globalCompositeOperation = 'overlay';
    rainbow(g, ax, ay, w * 256 / CARD_W, h * 184 / CARD_H, ph * 1.3 + 0.2, 2.2 - tx * 0.5, 0.8);
    g.globalCompositeOperation = 'lighter';
  } else if (r === 'r') {
    const sw = ((t * 0.22 + tx * 0.25) % 1.6) - 0.3;
    const gr = g.createLinearGradient(x + w * (sw - 0.25), y, x + w * (sw + 0.25), y + h * 0.7);
    gr.addColorStop(0, 'rgba(255,255,255,0)'); gr.addColorStop(0.5, 'rgba(210,235,255,.34)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr; g.fillRect(x, y, w, h);
  } else if (r === 'g') {
    rainbow(g, x, y, w, h, ph * 1.4, 0.7 + tx * 0.4, 0.12);
    const sw = ((t * 0.3) % 1.7) - 0.35;
    const gr = g.createLinearGradient(x + w * (sw - 0.2), y, x + w * (sw + 0.2), y + h);
    gr.addColorStop(0, 'rgba(255,240,160,0)'); gr.addColorStop(0.5, 'rgba(255,240,170,.3)'); gr.addColorStop(1, 'rgba(255,240,160,0)');
    g.fillStyle = gr; g.fillRect(x, y, w, h);
    for (let i = 0; i < 18; i++) {
      const s = Math.sin(t * 2.4 + i * 7.13) * 0.5 + 0.5;
      if (s < 0.55) continue;
      const px = x + w * (((i * 0.37 + 0.11) % 1) * 0.9 + 0.05), py = y + h * (((i * 0.61 + 0.07) % 1) * 0.8 + 0.1), q = (2 + s * 4) * w / CARD_W;
      g.fillStyle = `rgba(255,248,200,${(s - 0.4).toFixed(2)})`;
      g.beginPath(); g.moveTo(px, py - q); g.lineTo(px + q * 0.25, py - q * 0.25); g.lineTo(px + q, py); g.lineTo(px + q * 0.25, py + q * 0.25); g.lineTo(px, py + q); g.lineTo(px - q * 0.25, py + q * 0.25); g.lineTo(px - q, py); g.lineTo(px - q * 0.25, py - q * 0.25); g.closePath(); g.fill();
    }
  }
  // a glare that follows the light
  g.globalCompositeOperation = 'soft-light';
  const gx = x + w * (0.5 + tx * 0.5), gy = y + h * (0.4 + ty * 0.5);
  const rg = g.createRadialGradient(gx, gy, 0, gx, gy, w * 0.8);
  rg.addColorStop(0, `rgba(255,255,255,${r === 'c' ? 0.22 : 0.34})`); rg.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = rg; g.fillRect(x, y, w, h);
  g.restore();
}

/** A card-shaped silhouette for one not yet collected. */
export function drawSilhouette(g, card, W = CARD_W, H = CARD_H) {
  g.save(); g.scale(W / CARD_W, H / CARD_H);
  rr(g, 0, 0, CARD_W, CARD_H, 20); g.fillStyle = '#1a2a4a'; g.fill();
  rr(g, 10, 10, CARD_W - 20, CARD_H - 20, 14); g.fillStyle = '#233a64'; g.fill(); g.strokeStyle = 'rgba(255,255,255,.12)'; g.lineWidth = 2; g.setLineDash([8, 8]); g.stroke(); g.setLineDash([]);
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillStyle = 'rgba(255,255,255,.14)'; g.font = `900 120px ${BLOCK}`; g.fillText('?', CARD_W / 2, CARD_H * 0.43);
  g.fillStyle = 'rgba(255,255,255,.4)'; g.font = `800 26px ${BLOCK}`; g.fillText(`#${String(card.id).padStart(2, '0')}`, CARD_W / 2, CARD_H * 0.8);
  g.fillStyle = RARITY[card.r].col; g.globalAlpha = 0.55; g.font = `800 12px ${SANS}`; g.fillText(RARITY[card.r].name, CARD_W / 2, CARD_H * 0.88); g.globalAlpha = 1;
  g.restore();
}

// ---------------------------------------------------------------------------------------------
// the pack

/** Draw a wrapper at (cx, cy) w x h. `tear` 0..1: how far the top strip has come off. */
export function drawPack(g, cx, cy, w, h, tear = 0, t = 0) {
  g.save();
  g.translate(cx - w / 2, cy - h / 2);
  const sh = h * 0.1;
  const body = () => {
    const sk = 0.025 * w;
    g.beginPath(); g.moveTo(sk, 0); g.lineTo(w - sk, 0); g.lineTo(w, h * 0.04); g.lineTo(w, h * 0.96); g.lineTo(w - sk, h); g.lineTo(sk, h); g.lineTo(0, h * 0.96); g.lineTo(0, h * 0.04); g.closePath();
  };
  const paint = () => {
    body();
    const gr = g.createLinearGradient(0, 0, w, h); gr.addColorStop(0, '#3a86f0'); gr.addColorStop(0.5, '#1c54c0'); gr.addColorStop(1, '#123a8a'); g.fillStyle = gr; g.fill();
    g.save(); body(); g.clip();
    // red and gold diagonal bands
    g.fillStyle = '#a3191c'; g.beginPath(); g.moveTo(0, h * 0.5); g.lineTo(w, h * 0.34); g.lineTo(w, h * 0.5); g.lineTo(0, h * 0.66); g.fill();
    g.fillStyle = '#f2c230'; g.beginPath(); g.moveTo(0, h * 0.66); g.lineTo(w, h * 0.5); g.lineTo(w, h * 0.52); g.lineTo(0, h * 0.68); g.fill();
    g.beginPath(); g.moveTo(0, h * 0.48); g.lineTo(w, h * 0.32); g.lineTo(w, h * 0.34); g.lineTo(0, h * 0.5); g.fill();
    // crimps
    g.fillStyle = 'rgba(255,255,255,.14)'; for (let x = 0; x < w; x += w / 24) { g.fillRect(x, 0, w / 48, sh * 0.9); g.fillRect(x, h - sh * 0.9, w / 48, sh * 0.9); }
    g.fillStyle = 'rgba(0,0,0,.18)'; g.fillRect(0, sh * 0.92, w, 2); g.fillRect(0, h - sh * 0.95, w, 2);
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillStyle = '#f2c230'; g.font = `800 ${w * 0.074}px ${SANS}`; g.fillText('WATERLOO REGION', w / 2, h * 0.19, w * 0.9);
    g.font = `italic 800 ${w * 0.2}px ${SERIF}`; g.shadowColor = 'rgba(0,0,0,.5)'; g.shadowBlur = 4; g.fillText('Legends', w / 2, h * 0.28, w * 0.92); g.shadowBlur = 0;
    g.fillStyle = '#fff'; g.font = `italic 800 ${w * 0.3}px ${SERIF}`; g.save(); g.translate(w / 2, h * 0.6); g.rotate(-0.09); g.shadowColor = 'rgba(0,0,0,.6)'; g.shadowBlur = 6; g.fillText('J&J', 0, 0, w * 0.9); g.restore(); g.shadowBlur = 0;
    g.fillStyle = '#fff'; g.font = `800 ${w * 0.062}px ${SANS}`; g.fillText('SERIES 1  ·  6 CARDS', w / 2, h * 0.82, w * 0.86);
    g.fillStyle = '#f2c230'; g.font = `700 ${w * 0.05}px ${SANS}`; g.fillText('60 TO COLLECT  ·  1 GOLDEN GOOSE', w / 2, h * 0.88, w * 0.9);
    // foil shimmer
    const sx = ((t * 0.18) % 2.2 - 0.6) * w;
    const sg = g.createLinearGradient(sx - w * 0.2, 0, sx + w * 0.2, h); sg.addColorStop(0, 'rgba(255,255,255,0)'); sg.addColorStop(0.5, 'rgba(255,255,255,.28)'); sg.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = sg; g.fillRect(0, 0, w, h);
    g.restore();
    body(); g.strokeStyle = 'rgba(255,255,255,.55)'; g.lineWidth = 2; g.stroke();
  };
  if (tear <= 0) { paint(); g.restore(); return; }
  // the strip tears off from the left: the cut at x = tx
  const tx = Math.min(1, tear) * w;
  g.save();
  g.beginPath(); g.rect(0, sh, w, h); g.rect(tx, 0, w, sh); g.clip();
  paint();
  g.restore();
  // the open mouth
  g.save(); g.beginPath(); g.rect(0, 0, tx, sh); g.clip(); g.fillStyle = '#0a1a40'; g.fillRect(0, sh * 0.5, tx, sh * 0.5); g.restore();
  // the torn strip: swung up round the cut
  g.save();
  g.translate(tx, sh * 0.5);
  g.rotate(-Math.min(1.0, tear * 0.9) * (tear >= 1 ? 1.4 : 1));
  g.translate(-tx, -sh * 0.5);
  g.beginPath(); g.rect(0, 0, tx, sh); g.clip(); paint(); g.restore();
  // a zig-zag along the cut
  g.strokeStyle = '#fff'; g.lineWidth = 1.5; g.beginPath(); g.moveTo(0, sh);
  for (let x = 0; x < tx; x += 5) g.lineTo(x + 2.5, sh + (((x / 5) & 1) ? 3 : -1)); g.stroke();
  g.restore();
}

/** Deterministic PRNG (mulberry32) for the harness. */
export function seeded(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
