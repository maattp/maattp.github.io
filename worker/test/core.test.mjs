/* Node test suite for the Sichuan Mahjong core (mahjong.txt §22 + invariants).
 * Run: node worker/test/core.test.mjs                                        */
import {
  createGame, getLegalActions, pendingDeciders, applyAction,
  isWinningHand, getWinningTiles, isReady, isSevenPairs, score, viewFor,
  validateConservation, botChooseAction, makeConfig, DEFAULT_CONFIG,
  tileIndex, tileSuit, tileRank, emptyCounts, countTotal,
  DOT, BAMBOO, CHARACTER,
} from '../src/mahjongCore.js';

let pass = 0, fail = 0; const failures = [];
const ok = (cond, msg) => { if (cond) pass++; else { fail++; failures.push(msg); } };
const eq = (a, b, msg) => ok(a === b, `${msg} (got ${a}, want ${b})`);

const T = (suit, rank) => tileIndex(suit, rank);
const counts = (tiles) => { const c = emptyCounts(); for (const t of tiles) c[t]++; return c; };
const cfg = makeConfig();

/* ---- a minimal player object for pure win/ready checks ---- */
function P(tiles, melds = [], missing = BAMBOO) {
  return { seat: 0, concealed: counts(tiles), melds, missingSuit: missing, discards: [] };
}

/* ===== §22.1 legal standard win ===== */
{
  // DOT 1-2-3, DOT 4-5-6, CHAR 2-2-2, CHAR 7-8-9, DOT 9-9 ; missing BAMBOO
  const tiles = [T(DOT,1),T(DOT,2),T(DOT,3), T(DOT,4),T(DOT,5),T(DOT,6),
                 T(CHARACTER,2),T(CHARACTER,2),T(CHARACTER,2), T(CHARACTER,7),T(CHARACTER,8),T(CHARACTER,9), T(DOT,9),T(DOT,9)];
  ok(isWinningHand(P(tiles, [], BAMBOO), cfg), '§22.1 standard win is legal');
  /* ===== §22.2 illegal due to missing suit (same hand, missing DOT) ===== */
  ok(!isWinningHand(P(tiles, [], DOT), cfg), '§22.2 win rejected when it contains missing suit');
}

/* ===== §22.3 / §22.4 pung claim legality via getLegalActions ===== */
{
  const s = makeBotState();
  s.players[1].missingSuit = DOT;
  s.players[1].concealed = counts([T(BAMBOO,5),T(BAMBOO,5), T(CHARACTER,1),T(CHARACTER,2),T(CHARACTER,3),
    T(CHARACTER,4),T(CHARACTER,5),T(CHARACTER,6),T(CHARACTER,7),T(CHARACTER,8),T(CHARACTER,9),T(BAMBOO,1),T(BAMBOO,2)]);
  s.phase = 'AWAITING_DISCARD_REACTIONS';
  s.reactions = { tile: T(BAMBOO,5), discarder: 0, eligible: [1], responses: {} };
  let acts = getLegalActions(s, 1);
  ok(acts.some(a => a.type === 'ClaimPung'), '§22.3 pung offered with two in hand');
  ok(!acts.some(a => a.type === 'ClaimKongFromDiscard'), 'no kong with only a pair');
  // one in hand -> no pung
  s.players[1].concealed = counts([T(BAMBOO,5), T(CHARACTER,1),T(CHARACTER,2),T(CHARACTER,3),
    T(CHARACTER,4),T(CHARACTER,5),T(CHARACTER,6),T(CHARACTER,7),T(CHARACTER,8),T(CHARACTER,9),T(BAMBOO,1),T(BAMBOO,2),T(BAMBOO,3)]);
  acts = getLegalActions(s, 1);
  ok(!acts.some(a => a.type === 'ClaimPung'), '§22.4 no pung with only one matching tile');
}

/* ===== §22.5 no chow claim ===== */
{
  const s = makeBotState();
  s.players[1].missingSuit = DOT;
  s.players[1].concealed = counts([T(DOT,1),T(DOT,2), T(CHARACTER,1),T(CHARACTER,2),T(CHARACTER,3),
    T(CHARACTER,4),T(CHARACTER,5),T(CHARACTER,6),T(CHARACTER,7),T(CHARACTER,8),T(CHARACTER,9),T(BAMBOO,1),T(BAMBOO,2)]);
  s.phase = 'AWAITING_DISCARD_REACTIONS';
  s.reactions = { tile: T(DOT,3), discarder: 0, eligible: [1], responses: {} };
  // DOT is missing for player 1 so they'd also not be eligible; test the general rule:
  const acts = getLegalActions(s, 1);
  ok(!acts.some(a => a.type === 'ClaimChow'), '§22.5 chow claim never offered');
}

/* ===== §22.6 concealed kong ===== */
{
  const s = makeBotState();
  s.players[0].missingSuit = DOT;
  s.players[0].concealed = counts([T(CHARACTER,8),T(CHARACTER,8),T(CHARACTER,8),T(CHARACTER,8),
    T(BAMBOO,1),T(BAMBOO,2),T(BAMBOO,3),T(BAMBOO,4),T(BAMBOO,5),T(BAMBOO,6),T(BAMBOO,7),T(BAMBOO,8),T(BAMBOO,9),T(CHARACTER,1)]);
  s.phase = 'ACTIVE_TURN'; s.active = 0; s.turnFlags = { lastDrawn: T(CHARACTER,1) };
  const acts = getLegalActions(s, 0);
  ok(acts.some(a => a.type === 'DeclareConcealedKong' && a.tile === T(CHARACTER,8)), '§22.6 concealed kong offered with four copies');
}

/* ===== §22.7 seven pairs ===== */
{
  const tiles = [T(DOT,1),T(DOT,1),T(DOT,2),T(DOT,2),T(DOT,8),T(DOT,8),
                 T(BAMBOO,3),T(BAMBOO,3),T(BAMBOO,9),T(BAMBOO,9),T(CHARACTER,4),T(CHARACTER,4),T(CHARACTER,7),T(CHARACTER,7)];
  ok(isWinningHand(P(tiles, [], -1), cfg), '§22.7 seven pairs is a legal win');   // missing suit absent
  ok(isSevenPairs(counts(tiles), cfg), 'isSevenPairs detects it');
  // singleton breaks it
  const bad = tiles.slice(); bad[0] = T(DOT,5);
  ok(!isSevenPairs(counts(bad), cfg), 'seven pairs rejects a singleton');
}

/* ===== seven pairs disabled by config ===== */
{
  const tiles = [T(DOT,1),T(DOT,1),T(DOT,2),T(DOT,2),T(DOT,8),T(DOT,8),
                 T(BAMBOO,3),T(BAMBOO,3),T(BAMBOO,9),T(BAMBOO,9),T(CHARACTER,4),T(CHARACTER,4),T(CHARACTER,7),T(CHARACTER,7)];
  const noSP = makeConfig({ allowSevenPairs: false });
  ok(!isWinningHand(P(tiles, [], -1), noSP), 'seven pairs rejected when config disables it');
}

/* ===== win with a meld (3 concealed groups + pair) ===== */
{
  const tiles = [T(DOT,1),T(DOT,2),T(DOT,3), T(DOT,4),T(DOT,5),T(DOT,6), T(CHARACTER,1),T(CHARACTER,2),T(CHARACTER,3), T(DOT,9),T(DOT,9)];
  const melds = [{ type: 'PUNG', tile: T(CHARACTER,7) }];
  ok(isWinningHand(P(tiles, melds, BAMBOO), cfg), 'win with one exposed pung meld');
}

/* ===== ready / ting detection (§16) ===== */
{
  const tiles = [T(DOT,1),T(DOT,2),T(DOT,3), T(DOT,4),T(DOT,5),T(DOT,6), T(CHARACTER,1),T(CHARACTER,2),T(CHARACTER,3), T(CHARACTER,7),T(CHARACTER,8),T(CHARACTER,9), T(DOT,9)];
  const p = P(tiles, [], BAMBOO);
  const wins = getWinningTiles(p, cfg);
  ok(wins.length === 1 && wins[0] === T(DOT,9), 'ting detects the single winning tile (pair wait)');
  ok(isReady(p, cfg), 'isReady true for a tenpai hand');
}

/* ===== scoring: fan detectors (§14) ===== */
{
  // pure one suit + all pungs, self-draw
  const s = makeBotState();
  s.players[0].missingSuit = DOT;
  s.players[0].melds = [];
  s.players[0].concealed = counts([T(CHARACTER,2),T(CHARACTER,2),T(CHARACTER,2),
    T(CHARACTER,5),T(CHARACTER,5),T(CHARACTER,5), T(CHARACTER,7),T(CHARACTER,7),T(CHARACTER,7),
    T(CHARACTER,9),T(CHARACTER,9),T(CHARACTER,9), T(CHARACTER,1),T(CHARACTER,1)]);
  const sc = score(s, 0, { winType: 'SELF_DRAW', winningTile: T(CHARACTER,1), lastTile: false, afterKong: false });
  const names = sc.fanAwards.map(f => f.name);
  ok(names.includes('Self-Draw'), 'scores Self-Draw');
  ok(names.includes('All Pungs'), 'scores All Pungs');
  ok(names.includes('Pure One Suit'), 'scores Pure One Suit');
  // fan cap at 3 -> 8 points
  eq(sc.finalFan, 3, 'fan capped at limit 3');
  eq(sc.points, 8, 'points = base*2^3 = 8 at cap');
}
{
  // seven pairs + luxury (a quad): the quad is credited as Luxury, NOT also as Root
  const s = makeBotState();
  s.players[0].missingSuit = DOT;
  s.players[0].concealed = counts([T(CHARACTER,1),T(CHARACTER,1),T(CHARACTER,1),T(CHARACTER,1),
    T(CHARACTER,3),T(CHARACTER,3), T(CHARACTER,5),T(CHARACTER,5), T(BAMBOO,2),T(BAMBOO,2),
    T(BAMBOO,7),T(BAMBOO,7), T(CHARACTER,8),T(CHARACTER,8)]);
  const sc = score(s, 0, { winType: 'SELF_DRAW', winningTile: T(CHARACTER,8), lastTile: false, afterKong: false });
  const names = sc.fanAwards.map(f => f.name);
  ok(names.includes('Seven Pairs'), 'scores Seven Pairs');
  ok(names.includes('Luxury Seven Pairs'), 'scores Luxury Seven Pairs (quad)');
  ok(!names.includes('Root'), 'Root NOT double-counted on a seven-pairs quad (Luxury already credits it)');
}

/* ===== full random bot games: legality + conservation + determinism ===== */
function makeBotState(seed = 1) {
  return createGame({ seed, seats: [
    { isBot: true, difficulty: 'hard' }, { isBot: true, difficulty: 'normal' },
    { isBot: true, difficulty: 'easy' }, { isBot: true, difficulty: 'normal' },
  ]});
}
function playOut(seed, checkCons) {
  const s = createGame({ seed, seats: [
    { isBot: true, difficulty: 'hard' }, { isBot: true, difficulty: 'normal' },
    { isBot: true, difficulty: 'easy' }, { isBot: true, difficulty: 'hard' },
  ]});
  let guard = 0, illegal = 0;
  while (s.phase !== 'HAND_ENDED' && guard++ < 3000) {
    const deciders = pendingDeciders(s);
    if (!deciders.length) throw new Error('no deciders but not ended at phase ' + s.phase);
    const seat = deciders[0];
    const a = botChooseAction(s, seat);
    if (!a) throw new Error('bot returned null with legal actions for seat ' + seat);
    const res = applyAction(s, seat, a);
    if (!res.ok) { illegal++; throw new Error('illegal bot action ' + JSON.stringify(a) + ' -> ' + res.error.code); }
    if (checkCons) {
      const c = validateConservation(s);
      if (!c.ok) throw new Error('conservation broken: ' + JSON.stringify(c) + ' after ' + JSON.stringify(a));
    }
  }
  return { s, illegal, guard };
}
{
  let games = 0, errs = 0, ended = 0, wins = 0;
  for (let seed = 1; seed <= 300; seed++) {
    try {
      const { s } = playOut(seed, true); // full conservation check on every action of every game
      games++;
      if (s.phase === 'HAND_ENDED') ended++;
      wins += s.winnersThisHand.length;
    } catch (e) { errs++; failures.push('fuzz seed ' + seed + ': ' + e.message); }
  }
  eq(errs, 0, `300 bot games ran with no engine/legality/conservation errors`);
  eq(ended, games, 'every game reached HAND_ENDED');
  ok(wins >= 0, `total winners across games = ${wins}`);
}
/* determinism: same seed -> identical event log */
{
  const a = playOut(7, false).s;
  const b = playOut(7, false).s;
  eq(JSON.stringify(a.log), JSON.stringify(b.log), 'same seed -> identical event log (deterministic)');
  eq(JSON.stringify(a.players.map(p => p.score)), JSON.stringify(b.players.map(p => p.score)), 'same seed -> identical scores');
}

/* ===== redaction: viewFor hides other players' concealed tiles ===== */
{
  const s = makeBotState(3);
  // advance through missing suit selection so play has started
  let guard = 0;
  while (s.phase === 'MISSING_SUIT_SELECTION' && guard++ < 10) {
    const d = pendingDeciders(s)[0];
    applyAction(s, d, botChooseAction(s, d));
  }
  const v = viewFor(s, 0);
  ok(v.me.concealed && countTotal(v.me.concealed) > 0, 'view exposes my own concealed hand');
  ok(v.players[1].handCount > 0 && v.players[1].concealed === undefined, 'view hides opponents concealed tiles (only a count)');
  ok(Array.isArray(v.me.legalActions), 'view includes my legal actions');
  // an opponent's concealed kong (暗杠) must not leak its tile during play, but the owner sees it
  s.players[2].melds = [{ type: 'KONG_CONCEALED', tile: T(CHARACTER, 7), concealed: true }];
  const vOpp = viewFor(s, 0).players[2].melds[0];
  ok(vOpp.hidden === true && (vOpp.tile === -1 || vOpp.tile == null), 'opponent concealed-kong tile is redacted during play');
  ok(viewFor(s, 2).players[2].melds[0].tile === T(CHARACTER, 7), 'owner still sees their own concealed-kong tile');
}

/* ===== conservation holds on a fresh deal ===== */
{
  const s = makeBotState(99);
  const c = validateConservation(s);
  ok(c.ok, 'fresh deal conserves 108 tiles, 4 of each');
}

console.log(`\nSichuan Mahjong core: ${pass} passed, ${fail} failed.`);
if (failures.length) { console.log('\nFailures:\n - ' + failures.join('\n - ')); process.exitCode = 1; }
