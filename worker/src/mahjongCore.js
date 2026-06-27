/* =====================================================================
 * Sichuan Mahjong — Bloody Battle (血战到底) Rules Engine Core
 * =====================================================================
 * Pure, deterministic, config-driven state machine. NO DOM, NO I/O.
 * Implements mahjong.txt (the formal spec) §1–27.
 *
 * This exact file is the single source of truth. The identical region
 * between CORE-START and CORE-END is inlined into apps/mahjong/index.html;
 * tests/core-sync.mjs asserts the two never drift. Only the `export`
 * block at the very bottom is worker-only.
 *
 * Design contract (so the same core backs LOCAL hot-seat AND online):
 *   - createGame(config, seed) -> state          (JSON-serializable)
 *   - getLegalActions(state, seat) -> Action[]    (the ONLY things allowed)
 *   - applyAction(state, seat, action) -> {ok, events, error}
 *   - The core AUTO-ADVANCES through draws and empty reaction windows;
 *     it stops only when a human/bot decision is actually required, i.e.
 *     whenever some seat has a non-empty getLegalActions(). Bots are a
 *     DRIVER concern (botChooseAction), never called by the core.
 *   - viewFor(state, seat) -> redacted view (hides other hands) for render.
 * ===================================================================== */

// ==CORE-START== (synced region — keep identical with index.html)

/* ---- tile model: suit 0=DOT(筒) 1=BAMBOO(条) 2=CHARACTER(萬), rank 1..9 ---- */
const DOT = 0, BAMBOO = 1, CHARACTER = 2;
const SUIT_GLYPH = ['筒', '条', '萬'];
const SUIT_NAME = ['Dots', 'Bamboo', 'Characters'];
const tileIndex = (suit, rank) => suit * 9 + (rank - 1);
const tileSuit = (t) => (t / 9) | 0;
const tileRank = (t) => (t % 9) + 1;
const NUM_TYPES = 27;

const emptyCounts = () => new Array(NUM_TYPES).fill(0);
const countTotal = (c) => { let s = 0; for (let i = 0; i < NUM_TYPES; i++) s += c[i]; return s; };

/* ---- deterministic RNG (mulberry32). state.rng is a serializable integer ---- */
function rngNext(state) {
  let x = (state.rng + 0x6D2B79F5) | 0;
  state.rng = x;
  x = Math.imul(x ^ (x >>> 15), 1 | x);
  x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x;
  return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
}
function rngInt(state, n) { return (rngNext(state) * n) | 0; }

/* ---- default table rules (spec §21.4 / §26 "common digital rules") ---- */
const DEFAULT_CONFIG = {
  allowSevenPairs: true,
  fourOfKindCountsAsTwoPairs: true,
  mustDiscardMissingSuitFirst: true,
  allowMeldsInMissingSuit: false,
  allowKongInMissingSuit: false,
  allowMultipleWinnersOnDiscard: true,
  allowRobKong: true,
  allowMultipleRobKongWinners: true,
  wonPlayersExcludedFromFuturePayments: true,
  fanLimit: 3,
  baseWinPoints: 1,
  selfDrawBonusFan: 1,
  robKongBonusFan: 1,
  kongBloomBonusFan: 1,
  rootFan: 1,
  allPungsFan: 1,
  pureOneSuitFan: 2,
  sevenPairsFan: 2,
  luxurySevenPairsExtraFanPerQuad: 1,
  lastTileFan: 1,
  heavenlyEarthlyFan: 3,       // table-limit
  enableMissingSuitPenaltyAtExhaustion: true,
  missingSuitPenalty: 2,
  kongExposedFromDiscard: 2,   // discarder pays
  kongAdded: 1,                // each non-won opponent pays
  kongConcealed: 2,            // each non-won opponent pays
  mode: 'bloody',              // 'bloody' | 'single'
};

/* ---- meld types ---- */
const PUNG = 'PUNG';
const KONG_EXPOSED_FROM_DISCARD = 'KONG_EXPOSED_FROM_DISCARD';
const KONG_ADDED = 'KONG_ADDED';
const KONG_CONCEALED = 'KONG_CONCEALED';
const isKong = (m) => m.type !== PUNG;
const meldPhysical = (m) => (m.type === PUNG ? 3 : 4);

/* ---- phases (spec §18) ---- */
const PHASE = {
  MISSING_SUIT: 'MISSING_SUIT_SELECTION',
  ACTIVE_TURN: 'ACTIVE_TURN',
  DISCARD_REACT: 'AWAITING_DISCARD_REACTIONS',
  ROB_REACT: 'AWAITING_ROB_KONG_REACTIONS',
  HAND_ENDED: 'HAND_ENDED',
};

/* =====================================================================
 * Game creation & dealing
 * ===================================================================== */
function makeConfig(overrides) { return Object.assign({}, DEFAULT_CONFIG, overrides || {}); }

function createGame(opts = {}) {
  const config = makeConfig(opts.config);
  const seed = (opts.seed != null ? opts.seed : 0x1a2b3c4d) | 0;
  const dealer = (opts.dealer || 0) % 4;
  const names = opts.names || ['East', 'South', 'West', 'North'];
  const seats = opts.seats || [
    { isBot: false, difficulty: 'normal' },
    { isBot: true, difficulty: 'normal' },
    { isBot: true, difficulty: 'normal' },
    { isBot: true, difficulty: 'normal' },
  ];

  const state = {
    config, seed, rng: seed, handNo: opts.handNo || 1,
    phase: PHASE.MISSING_SUIT, dealer, active: dealer,
    wall: [], wallHead: 0, wallTail: 0,
    players: [],
    pendingDiscard: null, reactions: null, robReactions: null,
    turnFlags: { needsDraw: false, drewFromKong: false, lastDrawn: null, firstTurn: false, lastTileExhausted: false },
    firstDiscardDone: false,
    winnersThisHand: [], firstDealerSeat: null,
    log: [],
    ended: false, endReason: null,
    seatScores: opts.seatScores || [0, 0, 0, 0],   // carry running scores across hands
  };

  for (let i = 0; i < 4; i++) {
    state.players.push({
      seat: i,
      name: names[i] || ('P' + (i + 1)),
      isBot: seats[i] ? !!seats[i].isBot : true,
      difficulty: seats[i] ? (seats[i].difficulty || 'normal') : 'normal',
      connected: true,
      concealed: emptyCounts(),
      melds: [],
      discards: [],
      missingSuit: null,
      hasWon: false,
      winOrder: null,
      winRecords: [],
      score: state.seatScores[i] || 0,
      isDealer: i === dealer,
    });
  }

  // build & shuffle the 108-tile wall (spec §3.1)
  const wall = [];
  for (let suit = 0; suit < 3; suit++)
    for (let rank = 1; rank <= 9; rank++)
      for (let k = 0; k < 4; k++) wall.push(tileIndex(suit, rank));
  for (let i = wall.length - 1; i > 0; i--) {
    const j = rngInt(state, i + 1);
    const tmp = wall[i]; wall[i] = wall[j]; wall[j] = tmp;
  }
  state.wall = wall;
  state.wallHead = 0;
  state.wallTail = wall.length;
  logEvent(state, { type: 'WallShuffled', seed });

  // deal: dealer 14, others 13 (spec §3.2)
  for (let i = 0; i < 4; i++) {
    const p = state.players[(dealer + i) % 4];
    const n = p.isDealer ? 14 : 13;
    for (let k = 0; k < n; k++) p.concealed[drawFront(state)]++;
  }
  logEvent(state, { type: 'TilesDealt' });

  // dealer keeps the 14th and acts first WITHOUT drawing (enables Heavenly Hand)
  state.turnFlags.needsDraw = false;
  state.turnFlags.firstTurn = true;
  return state;
}

function drawFront(state) {
  if (state.wallHead >= state.wallTail) return -1;
  return state.wall[state.wallHead++];
}
function drawBack(state) {
  if (state.wallTail <= state.wallHead) return -1;
  return state.wall[--state.wallTail];
}
const wallRemaining = (state) => state.wallTail - state.wallHead;

function logEvent(state, ev) { state.log.push(ev); return ev; }

/* =====================================================================
 * Winning-hand validation (spec §7)
 * ===================================================================== */
function canPartition(counts, groupsNeeded) {
  let i = 0; while (i < NUM_TYPES && counts[i] === 0) i++;
  if (i === NUM_TYPES) return groupsNeeded === 0;
  if (groupsNeeded === 0) return false;
  // pung
  if (counts[i] >= 3) {
    counts[i] -= 3;
    if (canPartition(counts, groupsNeeded - 1)) { counts[i] += 3; return true; }
    counts[i] += 3;
  }
  // chow (same suit, consecutive) — allowed in concealed shape only
  const r = i % 9;
  if (r <= 6 && counts[i + 1] > 0 && counts[i + 2] > 0) {
    counts[i]--; counts[i + 1]--; counts[i + 2]--;
    if (canPartition(counts, groupsNeeded - 1)) { counts[i]++; counts[i + 1]++; counts[i + 2]++; return true; }
    counts[i]++; counts[i + 1]++; counts[i + 2]++;
  }
  return false;
}
function isStandardShape(counts, groupsNeeded) {
  for (let p = 0; p < NUM_TYPES; p++) {
    if (counts[p] >= 2) {
      counts[p] -= 2;
      const ok = canPartition(counts, groupsNeeded);   // canPartition fully backtracks, so no copy needed
      counts[p] += 2;
      if (ok) return true;
    }
  }
  return false;
}
function isSevenPairs(counts, config) {
  if (countTotal(counts) !== 14) return false;
  let pairs = 0;
  for (let t = 0; t < NUM_TYPES; t++) {
    const c = counts[t];
    if (c === 1 || c === 3) return false;
    if (c === 2) pairs += 1;
    if (c === 4) pairs += (config.fourOfKindCountsAsTwoPairs ? 2 : -100);
  }
  return pairs === 7;
}
function hasMissingSuitInCounts(counts, missingSuit) {
  if (missingSuit == null) return false;
  for (let r = 0; r < 9; r++) if (counts[missingSuit * 9 + r] > 0) return true;
  return false;
}
/* Does player p's concealed counts (already at winning size) form a legal win? */
function isWinningCounts(counts, melds, missingSuit, config) {
  if (hasMissingSuitInCounts(counts, missingSuit)) return false;
  const groupsNeeded = 4 - melds.length;
  const total = countTotal(counts);
  if (total !== groupsNeeded * 3 + 2) return false;
  if (melds.length === 0 && config.allowSevenPairs && isSevenPairs(counts, config)) return true;
  return isStandardShape(counts.slice(), groupsNeeded);
}
/* Player-level helper: would adding `tile` (or nothing) make a win? */
function isWinningHand(player, config, addTile = null) {
  const c = player.concealed.slice();
  if (addTile != null) {
    if (tileSuit(addTile) === player.missingSuit) return false;
    c[addTile]++;
  }
  return isWinningCounts(c, player.melds, player.missingSuit, config);
}
const winsNow = (player, config) => isWinningHand(player, config, null);

/* ---- ready / ting detection (spec §16) ---- */
function getWinningTiles(player, config, state = null) {
  const tiles = [];
  if (hasMissingSuitInCounts(player.concealed, player.missingSuit)) return tiles;
  const pending = state && state.pendingDiscard ? state.pendingDiscard.tile : -1;
  for (let t = 0; t < NUM_TYPES; t++) {
    if (tileSuit(t) === player.missingSuit) continue;
    if (player.concealed[t] >= 4) continue;
    // a tile with 0 unseen copies is unreachable — UNLESS it's the tile sitting on the
    // table right now (the player can win on it this instant), so never filter that one out
    if (state && t !== pending && remainingOf(state, t, player.seat) <= 0) continue;
    if (isWinningHand(player, config, t)) tiles.push(t);
  }
  return tiles;
}
const isReady = (player, config, state = null) => getWinningTiles(player, config, state).length > 0;

/* count of tile-type t not visible to seat `me` (public info + own hand) */
function remainingOf(state, t, me) {
  let seen = 0;
  for (let s = 0; s < 4; s++) {
    const p = state.players[s];
    if (s === me) seen += p.concealed[t];
    for (const m of p.melds) if (m.tile === t) seen += meldPhysical(m);
    for (const d of p.discards) if (d === t) seen++;
  }
  if (state.pendingDiscard && state.pendingDiscard.tile === t) seen++;
  return 4 - seen;
}

/* =====================================================================
 * Legal-action generation (spec §17)
 * Action shapes:
 *   {type:'ChooseMissingSuit', suit}
 *   {type:'Discard', tile}      {type:'Pass'}
 *   {type:'ClaimPung', tile}    {type:'ClaimKongFromDiscard', tile}
 *   {type:'DeclareConcealedKong', tile}  {type:'DeclareAddedKong', tile}
 *   {type:'DeclareWinFromDiscard', tile} {type:'DeclareSelfDrawWin'}
 *   {type:'RobKong', tile}
 * ===================================================================== */
const missingCount = (p) => {
  if (p.missingSuit == null) return 0;
  let s = 0; for (let r = 0; r < 9; r++) s += p.concealed[p.missingSuit * 9 + r]; return s;
};
function legalDiscards(player, config) {
  const out = [];
  const holdsMissing = missingCount(player) > 0;
  for (let t = 0; t < NUM_TYPES; t++) {
    if (player.concealed[t] === 0) continue;
    if (config.mustDiscardMissingSuitFirst && holdsMissing && tileSuit(t) !== player.missingSuit) continue;
    out.push(t);
  }
  return out;
}

function getLegalActions(state, seat) {
  const p = state.players[seat];
  if (state.phase === PHASE.HAND_ENDED) return [];
  if (p.hasWon) return [];

  if (state.phase === PHASE.MISSING_SUIT) {
    if (p.missingSuit != null) return [];
    return [
      { type: 'ChooseMissingSuit', suit: DOT },
      { type: 'ChooseMissingSuit', suit: BAMBOO },
      { type: 'ChooseMissingSuit', suit: CHARACTER },
    ];
  }

  if (state.phase === PHASE.ACTIVE_TURN) {
    if (seat !== state.active) return [];
    const acts = [];
    const holdsMissing = missingCount(p) > 0;
    const justDrew = state.turnFlags.lastDrawn != null || state.turnFlags.firstTurn;
    // self-draw win
    if (!holdsMissing && justDrew && winsNow(p, state.config)) acts.push({ type: 'DeclareSelfDrawWin' });
    // kongs only gate on the kong tile's suit (spec §6.7/§6.8), not on whether the
    // player has cleared their own missing suit (that rule restricts discards only, §8.2)
    if (!state.turnFlags.afterPung) {
      // concealed kong
      for (let t = 0; t < NUM_TYPES; t++) {
        if (p.concealed[t] === 4 && (state.config.allowKongInMissingSuit || tileSuit(t) !== p.missingSuit))
          acts.push({ type: 'DeclareConcealedKong', tile: t });
      }
      // added kong (upgrade an exposed pung)
      for (const m of p.melds) {
        if (m.type === PUNG && p.concealed[m.tile] >= 1 &&
            (state.config.allowKongInMissingSuit || tileSuit(m.tile) !== p.missingSuit))
          acts.push({ type: 'DeclareAddedKong', tile: m.tile });
      }
    }
    for (const t of legalDiscards(p, state.config)) acts.push({ type: 'Discard', tile: t });
    return acts;
  }

  if (state.phase === PHASE.DISCARD_REACT) {
    const r = state.reactions;
    if (!r || r.discarder === seat || r.responses[seat] != null || !r.eligible.includes(seat)) return [];
    const tile = r.tile;
    const acts = [];
    const holdsMissing = missingCount(p) > 0;
    if (!holdsMissing && tileSuit(tile) !== p.missingSuit && isWinningHand(p, state.config, tile))
      acts.push({ type: 'DeclareWinFromDiscard', tile });
    // peng/kong-from-discard gate on the claimed tile's suit only (spec §6.5/§6.6)
    const meldOk = (state.config.allowMeldsInMissingSuit || tileSuit(tile) !== p.missingSuit);
    if (meldOk && p.concealed[tile] >= 3) acts.push({ type: 'ClaimKongFromDiscard', tile });
    if (meldOk && p.concealed[tile] >= 2) acts.push({ type: 'ClaimPung', tile });
    acts.push({ type: 'Pass' });
    return acts;
  }

  if (state.phase === PHASE.ROB_REACT) {
    const r = state.robReactions;
    if (!r || r.declarer === seat || r.responses[seat] != null || !r.eligible.includes(seat)) return [];
    const tile = r.tile;
    const acts = [];
    if (state.config.allowRobKong && tileSuit(tile) !== p.missingSuit && isWinningHand(p, state.config, tile))
      acts.push({ type: 'RobKong', tile });
    acts.push({ type: 'Pass' });
    return acts;
  }

  return [];
}

/* Seats that currently owe a decision (driver: prompt humans, run bots). */
function pendingDeciders(state) {
  const out = [];
  if (state.phase === PHASE.HAND_ENDED) return out;
  for (let s = 0; s < 4; s++) if (getLegalActions(state, s).length > 0) out.push(s);
  return out;
}

const actionsEqual = (a, b) =>
  a && b && a.type === b.type && (a.tile ?? -1) === (b.tile ?? -1) && (a.suit ?? -1) === (b.suit ?? -1);

/* =====================================================================
 * applyAction — validates via getLegalActions, mutates state, cascades
 * through auto-advances, returns {ok, events, error}.
 * ===================================================================== */
function invalid(code, message, details, suggested) {
  return { ok: false, error: { code, message, details: details || '', suggestedActions: suggested || [] } };
}
function applyAction(state, seat, action) {
  // reject malformed input cleanly (untrusted over the wire) — never throw
  if (!action || typeof action.type !== 'string') return invalid('BAD_ACTION', 'Malformed action.');
  const legal = getLegalActions(state, seat);
  if (!legal.some((o) => actionsEqual(o, action))) {
    return invalid(...explainIllegal(state, seat, action));
  }
  const before = state.log.length;
  switch (action.type) {
    case 'ChooseMissingSuit': doChooseMissing(state, seat, action.suit); break;
    case 'Discard': doDiscard(state, seat, action.tile); break;
    case 'Pass': doReactionResponse(state, seat, action); break;
    case 'ClaimPung': doReactionResponse(state, seat, action); break;
    case 'ClaimKongFromDiscard': doReactionResponse(state, seat, action); break;
    case 'DeclareWinFromDiscard': doReactionResponse(state, seat, action); break;
    case 'RobKong': doRobResponse(state, seat, action); break;
    case 'DeclareConcealedKong': doConcealedKong(state, seat, action.tile); break;
    case 'DeclareAddedKong': doAddedKong(state, seat, action.tile); break;
    case 'DeclareSelfDrawWin': doSelfDrawWin(state, seat); break;
    default: return invalid('UNKNOWN_ACTION', 'Unknown action.');
  }
  return { ok: true, events: state.log.slice(before) };
}

/* ---- missing-suit selection (spec §3.3) ---- */
function doChooseMissing(state, seat, suit) {
  const p = state.players[seat];
  p.missingSuit = suit;
  logEvent(state, { type: 'MissingSuitChosen', seat, suit });
  if (state.players.every((q) => q.missingSuit != null)) {
    // begin play: dealer acts first with 14 tiles, no draw
    state.phase = PHASE.ACTIVE_TURN;
    state.active = state.dealer;
    state.turnFlags = { needsDraw: false, drewFromKong: false, lastDrawn: null, firstTurn: true, afterPung: false, lastTileExhausted: false };
  }
}

/* ---- begin a fresh turn for `seat`: draw (unless suppressed), maybe end ---- */
function beginTurn(state, seat, { draw = true, fromKong = false, afterPung = false } = {}) {
  // skip won players
  let guard = 0;
  while (state.players[seat].hasWon) {
    seat = (seat + 1) % 4;
    if (++guard > 4) { endHand(state, 'exhaustion'); return; }
  }
  state.active = seat;
  state.turnFlags = { needsDraw: false, drewFromKong: fromKong, lastDrawn: null, firstTurn: false, afterPung, lastTileExhausted: false };
  if (draw) {
    if (wallRemaining(state) <= 0) { endHand(state, 'exhaustion'); return; }
    const t = fromKong ? drawBack(state) : drawFront(state);
    state.players[seat].concealed[t]++;
    state.turnFlags.lastDrawn = t;
    state.turnFlags.lastTileExhausted = wallRemaining(state) <= 0;
    logEvent(state, { type: fromKong ? 'ReplacementTileDrawn' : 'TileDrawn', seat, tile: t });
  }
  state.phase = PHASE.ACTIVE_TURN;
}

/* next non-won seat after `from` (exclusive). returns -1 if none. */
function nextActiveSeat(state, from) {
  for (let k = 1; k <= 4; k++) {
    const s = (from + k) % 4;
    if (!state.players[s].hasWon) return s;
  }
  return -1;
}
const nonWonCount = (state) => state.players.filter((p) => !p.hasWon).length;

/* ---- discard (spec §6.3) ---- */
function commitDiscardToPile(state) {
  // move the pending discard into the discarder's river (unclaimed); §19 keeps the
  // pending slot and the pile as distinct terms, so the tile lives in exactly one.
  const pd = state.pendingDiscard;
  if (!pd) return;
  state.players[pd.discarder].discards.push(pd.tile);
  state.pendingDiscard = null;
}
function doDiscard(state, seat, tile) {
  const p = state.players[seat];
  p.concealed[tile]--;
  const wasFirstDiscard = !state.firstDiscardDone;
  const dealerFirstDiscard = wasFirstDiscard && seat === state.dealer;
  state.firstDiscardDone = true;
  state.turnFlags.afterPung = false;
  const cameFromKongDiscard = state.turnFlags.drewFromKong; // 杠上炮 attribution
  state.pendingDiscard = { tile, discarder: seat, dealerFirstDiscard, afterKong: cameFromKongDiscard, lastTile: wallRemaining(state) <= 0 };
  logEvent(state, { type: 'TileDiscarded', seat, tile });

  // who can react? (non-won, non-discarder with a real option)
  const eligible = [];
  for (let k = 1; k <= 3; k++) {
    const s = (seat + k) % 4;
    const q = state.players[s];
    if (q.hasWon) continue;
    const opts = reactionOptions(state, s, tile);
    if (opts.win || opts.kong || opts.pung) eligible.push(s);
  }
  if (eligible.length === 0) { commitDiscardToPile(state); beginTurn(state, nextActiveSeat(state, seat)); return; }
  state.phase = PHASE.DISCARD_REACT;
  state.reactions = { tile, discarder: seat, eligible, responses: {} };
}
function reactionOptions(state, seat, tile) {
  const p = state.players[seat];
  const holdsMissing = missingCount(p) > 0;
  const meldOk = (state.config.allowMeldsInMissingSuit || tileSuit(tile) !== p.missingSuit);
  return {
    win: !holdsMissing && tileSuit(tile) !== p.missingSuit && isWinningHand(p, state.config, tile),
    kong: meldOk && p.concealed[tile] >= 3,
    pung: meldOk && p.concealed[tile] >= 2,
  };
}

/* ---- record a discard-reaction response; resolve when all responded ---- */
function doReactionResponse(state, seat, action) {
  state.reactions.responses[seat] = action;
  if (action.type !== 'Pass') logEvent(state, { type: 'Reaction', seat, action: action.type });
  const r = state.reactions;
  if (r.eligible.every((s) => r.responses[s] != null)) resolveDiscardReactions(state);
}
function resolveDiscardReactions(state) {
  const r = state.reactions;
  const tile = r.tile, discarder = r.discarder;
  const pd = state.pendingDiscard;
  // 1) wins (possibly multiple) — highest priority
  const winners = r.eligible.filter((s) => r.responses[s] && r.responses[s].type === 'DeclareWinFromDiscard');
  if (winners.length) {
    const ordered = state.config.allowMultipleWinnersOnDiscard ? winners : [nearestInOrder(discarder, winners)];
    state.reactions = null;
    commitDiscardToPile(state);   // the won tile stays visible in the river, counted once
    // §12.1: first winner becomes next dealer; if multiple win the same discard, the discarder does
    if (state.winnersThisHand.length === 0) state.firstDealerSeat = (ordered.length >= 2 ? discarder : ordered[0]);
    for (const w of ordered) {
      // The winning tile is scored VIRTUALLY (not added to concealed) so one physical
      // tile can feed multiple winners without breaking conservation (spec §19, §10.1).
      const ctx = { winType: 'DISCARD', winningTile: tile, source: discarder, lastTile: pd.lastTile, afterKong: pd.afterKong, isEarthly: pd.dealerFirstDiscard && w !== state.dealer };
      resolveWin(state, w, ctx);
    }
    if (!checkHandEnd(state)) beginTurn(state, nextActiveSeat(state, discarder));
    return;
  }
  // 2) kong (only one possible holder) — tile is consumed into the meld
  const konger = r.eligible.find((s) => r.responses[s] && r.responses[s].type === 'ClaimKongFromDiscard');
  if (konger != null) { state.reactions = null; state.pendingDiscard = null; claimKongFromDiscard(state, konger, tile, discarder); return; }
  // 3) pung (only one possible holder) — tile is consumed into the meld
  const punger = r.eligible.find((s) => r.responses[s] && r.responses[s].type === 'ClaimPung');
  if (punger != null) { state.reactions = null; state.pendingDiscard = null; claimPung(state, punger, tile, discarder); return; }
  // 4) all pass — tile joins the river
  state.reactions = null;
  commitDiscardToPile(state);
  beginTurn(state, nextActiveSeat(state, discarder));
}
function nearestInOrder(from, list) {
  for (let k = 1; k <= 3; k++) { const s = (from + k) % 4; if (list.includes(s)) return s; }
  return list[0];
}

/* ---- claim pung (spec §6.5): take discard, expose, must discard ---- */
function claimPung(state, seat, tile, discarder) {
  const p = state.players[seat];
  p.concealed[tile] -= 2;
  p.melds.push({ type: PUNG, tile, source: discarder, concealed: false });
  logEvent(state, { type: 'PungClaimed', seat, tile, source: discarder });
  state.active = seat;
  state.phase = PHASE.ACTIVE_TURN;
  state.turnFlags = { needsDraw: false, drewFromKong: false, lastDrawn: null, firstTurn: false, afterPung: true, lastTileExhausted: false };
}

/* ---- exposed kong from discard (spec §6.6) ---- */
function claimKongFromDiscard(state, seat, tile, discarder) {
  const p = state.players[seat];
  p.concealed[tile] -= 3;
  p.melds.push({ type: KONG_EXPOSED_FROM_DISCARD, tile, source: discarder, concealed: false });
  logEvent(state, { type: 'KongClaimedFromDiscard', seat, tile, source: discarder });
  payKong(state, seat, KONG_EXPOSED_FROM_DISCARD, discarder);
  beginTurn(state, seat, { draw: true, fromKong: true });   // replacement draw, may win/kong/discard
}

/* ---- concealed kong (spec §6.7) ---- */
function doConcealedKong(state, seat, tile) {
  const p = state.players[seat];
  p.concealed[tile] -= 4;
  p.melds.push({ type: KONG_CONCEALED, tile, source: null, concealed: true });
  logEvent(state, { type: 'ConcealedKongDeclared', seat, tile });
  payKong(state, seat, KONG_CONCEALED, null);
  beginTurn(state, seat, { draw: true, fromKong: true });
}

/* ---- added kong (spec §6.8) with rob window (spec §6.9) ---- */
function doAddedKong(state, seat, tile) {
  // open rob-the-kong window
  const eligible = [];
  for (let k = 1; k <= 3; k++) {
    const s = (seat + k) % 4;
    const q = state.players[s];
    if (q.hasWon) continue;
    if (state.config.allowRobKong && tileSuit(tile) !== q.missingSuit && isWinningHand(q, state.config, tile)) eligible.push(s);
  }
  logEvent(state, { type: 'AddedKongDeclared', seat, tile });
  if (eligible.length === 0) { finalizeAddedKong(state, seat, tile); return; }
  state.phase = PHASE.ROB_REACT;
  state.robReactions = { tile, declarer: seat, eligible, responses: {} };
}
function doRobResponse(state, seat, action) {
  state.robReactions.responses[seat] = action;
  const r = state.robReactions;
  if (r.eligible.every((s) => r.responses[s] != null)) resolveRobReactions(state);
}
function resolveRobReactions(state) {
  const r = state.robReactions;
  const tile = r.tile, declarer = r.declarer;
  const robbers = r.eligible.filter((s) => r.responses[s] && r.responses[s].type === 'RobKong');
  if (robbers.length) {
    const ordered = state.config.allowMultipleRobKongWinners ? robbers : [nearestInOrder(declarer, robbers)];
    state.robReactions = null;
    logEvent(state, { type: 'KongRobbed', declarer, tile });
    // The kong tile is consumed by the rob (like a discard handed to the winner):
    // remove it from the declarer's hand into their river so the declarer returns to
    // 13 effective tiles and conservation holds. The pung is NOT upgraded (kong cancelled).
    state.players[declarer].concealed[tile] -= 1;
    state.players[declarer].discards.push(tile);
    if (state.winnersThisHand.length === 0) state.firstDealerSeat = (ordered.length >= 2 ? declarer : ordered[0]);
    for (const w of ordered) {
      // winning tile scored virtually (it now lives in the declarer's river, counted once)
      resolveWin(state, w, { winType: 'ROB_KONG', winningTile: tile, source: declarer, lastTile: false, afterKong: false });
    }
    if (!checkHandEnd(state)) beginTurn(state, nextActiveSeat(state, declarer));
    return;
  }
  state.robReactions = null;
  finalizeAddedKong(state, declarer, tile);
}
function finalizeAddedKong(state, seat, tile) {
  const p = state.players[seat];
  const m = p.melds.find((x) => x.type === PUNG && x.tile === tile);
  m.type = KONG_ADDED;
  p.concealed[tile] -= 1;
  payKong(state, seat, KONG_ADDED, null);
  beginTurn(state, seat, { draw: true, fromKong: true });
}

/* ---- self-draw win (spec §6.11) ---- */
function doSelfDrawWin(state, seat) {
  const pd = state.turnFlags;
  const isHeavenly = state.turnFlags.firstTurn && seat === state.dealer && !state.firstDiscardDone;
  const ctx = { winType: 'SELF_DRAW', winningTile: state.turnFlags.lastDrawn, source: null,
    lastTile: state.turnFlags.lastTileExhausted, afterKong: pd.drewFromKong, isHeavenly };
  if (state.winnersThisHand.length === 0) state.firstDealerSeat = seat;
  resolveWin(state, seat, ctx);
  if (!checkHandEnd(state)) beginTurn(state, nextActiveSeat(state, seat));
}

/* =====================================================================
 * Win resolution & payments (spec §13)
 * ===================================================================== */
function resolveWin(state, seat, ctx) {
  const p = state.players[seat];
  const sc = score(state, seat, ctx);
  p.hasWon = true;
  p.winOrder = state.winnersThisHand.length;
  const rec = { winner: seat, winType: ctx.winType, winningTile: ctx.winningTile, source: ctx.source,
    fanAwards: sc.fanAwards, finalFan: sc.finalFan, points: sc.points, deltas: [0, 0, 0, 0] };
  // payments
  if (ctx.winType === 'SELF_DRAW') {
    for (let s = 0; s < 4; s++) {
      if (s === seat) continue;
      const o = state.players[s];
      if (state.config.wonPlayersExcludedFromFuturePayments && o.hasWon) continue;
      o.score -= sc.points; p.score += sc.points;
      rec.deltas[s] -= sc.points; rec.deltas[seat] += sc.points;
    }
  } else { // DISCARD or ROB_KONG — single payer
    const payer = state.players[ctx.source];
    payer.score -= sc.points; p.score += sc.points;
    rec.deltas[ctx.source] -= sc.points; rec.deltas[seat] += sc.points;
  }
  p.winRecords.push(rec);
  state.winnersThisHand.push(seat);
  logEvent(state, { type: 'WinResolved', seat, winType: ctx.winType, points: sc.points, fan: sc.finalFan, fanAwards: sc.fanAwards.map((f) => f.name) });
}

/* immediate kong payments (spec §11.3) */
function payKong(state, seat, kongType, discarder) {
  const g = state.players[seat];
  const cfg = state.config;
  let amount, log;
  if (kongType === KONG_EXPOSED_FROM_DISCARD) {
    amount = cfg.kongExposedFromDiscard;
    const d = state.players[discarder];
    if (!(cfg.wonPlayersExcludedFromFuturePayments && d.hasWon)) { d.score -= amount; g.score += amount; }
    log = 'exposed';
  } else {
    amount = (kongType === KONG_ADDED) ? cfg.kongAdded : cfg.kongConcealed;
    for (let s = 0; s < 4; s++) {
      if (s === seat) continue;
      const o = state.players[s];
      if (cfg.wonPlayersExcludedFromFuturePayments && o.hasWon) continue;
      o.score -= amount; g.score += amount;
    }
    log = (kongType === KONG_ADDED) ? 'added' : 'concealed';
  }
  logEvent(state, { type: 'KongScored', seat, kongType: log, amount });
}

/* =====================================================================
 * Scoring / fan detection (spec §14)
 * ===================================================================== */
function decomposeAllPungs(counts, groupsNeeded) {
  // pair + only triplets (no chow). counts = concealed (winning size minus melds)
  for (let p = 0; p < NUM_TYPES; p++) {
    if (counts[p] >= 2) {
      const cc = counts.slice(); cc[p] -= 2;
      if (onlyTriplets(cc, groupsNeeded)) return true;
    }
  }
  return false;
}
function onlyTriplets(c, groups) {
  let i = 0; while (i < NUM_TYPES && c[i] === 0) i++;
  if (i === NUM_TYPES) return groups === 0;
  if (groups > 0 && c[i] >= 3) { c[i] -= 3; if (onlyTriplets(c, groups - 1)) { c[i] += 3; return true; } c[i] += 3; }
  return false;
}
function score(state, seat, ctx) {
  const cfg = state.config;
  const p = state.players[seat];
  // For SELF_DRAW the winning tile is already in concealed (drawn); for DISCARD /
  // ROB_KONG it is added virtually here only (never persisted) — see §10.1.
  const concealed = p.concealed.slice();
  if (ctx.winType !== 'SELF_DRAW' && ctx.winningTile != null) concealed[ctx.winningTile]++;
  const groupsNeeded = 4 - p.melds.length;
  const fanAwards = [];
  const add = (name, fan) => { if (fan > 0) fanAwards.push({ name, fan }); };

  // suits across full hand
  const suitsUsed = new Set();
  for (let t = 0; t < NUM_TYPES; t++) if (concealed[t] > 0) suitsUsed.add(tileSuit(t));
  for (const m of p.melds) suitsUsed.add(tileSuit(m.tile));

  const sevenP = p.melds.length === 0 && cfg.allowSevenPairs && isSevenPairs(concealed, cfg);

  fanAwards.push({ name: 'Base Win', fan: 0 });   // 平胡 — always shown, contributes 0
  if (ctx.winType === 'SELF_DRAW') add('Self-Draw', cfg.selfDrawBonusFan);
  if (sevenP) {
    add('Seven Pairs', cfg.sevenPairsFan);
    // a quad in a seven-pairs hand is credited here as Luxury Seven Pairs (龙七对);
    // it is NOT also counted as a Root below, which would double-credit the same tiles.
    let quads = 0; for (let t = 0; t < NUM_TYPES; t++) if (concealed[t] === 4) quads++;
    if (quads >= 1) add('Luxury Seven Pairs', cfg.luxurySevenPairsExtraFanPerQuad * quads);
  } else {
    // Sichuan has no chow melds, so every meld is already a pung/kong by construction
    if (decomposeAllPungs(concealed, groupsNeeded)) add('All Pungs', cfg.allPungsFan);
    // Root (根): four identical tiles in the hand (a kong, or 4 concealed) — standard hands only
    let roots = 0;
    for (let t = 0; t < NUM_TYPES; t++) {
      let phys = concealed[t];
      for (const m of p.melds) if (m.tile === t) phys += meldPhysical(m);
      if (phys === 4) roots++;
    }
    if (roots > 0) add('Root', cfg.rootFan * roots);
  }
  if (suitsUsed.size === 1) add('Pure One Suit', cfg.pureOneSuitFan);

  if (ctx.afterKong && ctx.winType === 'SELF_DRAW') add('Kong Bloom', cfg.kongBloomBonusFan);
  if (ctx.winType === 'ROB_KONG') add('Robbing a Kong', cfg.robKongBonusFan);
  if (ctx.lastTile) add(ctx.winType === 'SELF_DRAW' ? 'Last Tile Draw' : 'Last Discard Win', cfg.lastTileFan);
  if (ctx.isHeavenly) add('Heavenly Hand', cfg.heavenlyEarthlyFan);
  if (ctx.isEarthly) add('Earthly Hand', cfg.heavenlyEarthlyFan);

  let fan = fanAwards.reduce((s, f) => s + f.fan, 0);
  if (cfg.fanLimit != null) fan = Math.min(fan, cfg.fanLimit);
  const points = cfg.baseWinPoints * Math.pow(2, fan);
  return { fanAwards, finalFan: fan, points };
}

/* =====================================================================
 * End of hand (spec §9, §12)
 * ===================================================================== */
function checkHandEnd(state) {
  if (state.config.mode === 'single' && state.winnersThisHand.length >= 1) { endHand(state, 'win'); return true; }
  if (nonWonCount(state) <= 1) { endHand(state, 'win'); return true; }
  return false;
}
function endHand(state, reason) {
  if (state.phase === PHASE.HAND_ENDED) return;
  state.phase = PHASE.HAND_ENDED;
  state.ended = true; state.endReason = reason;
  state.pendingDiscard = null; state.reactions = null; state.robReactions = null;

  if (reason === 'exhaustion' && state.config.enableMissingSuitPenaltyAtExhaustion) {
    // 查花猪: players still holding missing suit pay each cleared / won player (spec §8.3)
    const pen = state.config.missingSuitPenalty;
    const holders = state.players.filter((p) => !p.hasWon && missingCount(p) > 0);
    for (const h of holders) {
      for (let s = 0; s < 4; s++) {
        const o = state.players[s];
        if (o === h) continue;
        if (!h.hasWon && (o.hasWon || missingCount(o) === 0)) { h.score -= pen; o.score += pen; }
      }
      logEvent(state, { type: 'EndPenaltyApplied', seat: h.seat, kind: 'missingSuit' });
    }
  }
  // next dealer (spec §12.1): the first winner (or discarder if the first win was a
  // simultaneous multi-winner discard, tracked in firstDealerSeat); else dealer repeats
  state.nextDealer = (state.firstDealerSeat != null) ? state.firstDealerSeat : state.dealer;
  state.seatScores = state.players.map((p) => p.score);
  logEvent(state, { type: 'HandEnded', reason, winners: state.winnersThisHand.slice() });
}

/* =====================================================================
 * Tile conservation invariant (spec §19)
 * ===================================================================== */
function validateConservation(state) {
  const total = emptyCounts();
  for (let i = state.wallHead; i < state.wallTail; i++) total[state.wall[i]]++;
  for (const p of state.players) {
    for (let t = 0; t < NUM_TYPES; t++) total[t] += p.concealed[t];
    for (const m of p.melds) total[m.tile] += meldPhysical(m);
    for (const d of p.discards) total[d]++;
  }
  if (state.pendingDiscard) total[state.pendingDiscard.tile]++;
  let sum = 0;
  for (let t = 0; t < NUM_TYPES; t++) { sum += total[t]; if (total[t] !== 4) return { ok: false, tile: t, count: total[t] }; }
  return { ok: sum === 108, sum };
}

/* =====================================================================
 * Redaction — per-seat view for rendering (hides others' concealed tiles)
 * ===================================================================== */
function viewFor(state, seat, opts = {}) {
  const me = state.players[seat];
  const myActions = getLegalActions(state, seat);
  const ready = (state.phase !== PHASE.HAND_ENDED) ? getWinningTiles(me, state.config, state) : [];
  const deciders = pendingDeciders(state);
  const view = {
    phase: state.phase,
    handNo: state.handNo,
    mode: state.config.mode,
    wallRemaining: wallRemaining(state),
    dealer: state.dealer,
    active: state.active,
    mySeat: seat,
    deciders,
    pendingDiscard: state.pendingDiscard ? { tile: state.pendingDiscard.tile, by: state.pendingDiscard.discarder } : null,
    lastDrawn: (seat === state.active && state.phase === PHASE.ACTIVE_TURN) ? state.turnFlags.lastDrawn : null,
    winnersThisHand: state.winnersThisHand.slice(),
    me: {
      seat,
      concealed: me.concealed.slice(),
      melds: me.melds.map((m) => ({ ...m })),
      missingSuit: me.missingSuit,
      discards: me.discards.slice(),
      hasWon: me.hasWon,
      winOrder: me.winOrder,
      score: me.score,
      legalActions: myActions,
      ready,
    },
    players: state.players.map((p) => ({
      seat: p.seat,
      name: p.name,
      isBot: p.isBot,
      connected: p.connected,
      missingSuit: p.missingSuit,             // public after selection (default)
      // an opponent's concealed kong (暗杠) stays hidden until the hand ends — never
      // leak its tile to other seats (this is a hidden-info game)
      melds: p.melds.map((m) =>
        (m.type === KONG_CONCEALED && p.seat !== seat && state.phase !== PHASE.HAND_ENDED)
          ? { type: m.type, tile: -1, hidden: true }
          : { ...m }),
      discards: p.discards.slice(),
      handCount: countTotal(p.concealed),
      hasWon: p.hasWon,
      winOrder: p.winOrder,
      score: p.score,
      isDealer: p.isDealer,
      isActive: p.seat === state.active && state.phase === PHASE.ACTIVE_TURN,
      mustDecide: deciders.includes(p.seat),
    })),
  };
  if (state.phase === PHASE.HAND_ENDED) {
    view.results = {
      reason: state.endReason,
      winners: state.winnersThisHand.slice(),
      records: state.players.flatMap((p) => p.winRecords),
      scores: state.players.map((p) => p.score),
      nextDealer: state.nextDealer,
    };
  }
  return view;
}

/* =====================================================================
 * Invalid-move explanations (spec §20)
 * ===================================================================== */
function explainIllegal(state, seat, action) {
  const p = state.players[seat];
  if (p.hasWon) return ['PLAYER_ALREADY_WON', 'You have already won this hand. In Bloody Battle, the remaining players continue without you.'];
  if (state.phase === PHASE.ACTIVE_TURN && seat !== state.active)
    return ['NOT_YOUR_TURN', 'You cannot do that because it is not your turn.'];
  if (action.type === 'ClaimPung')
    return ['PUNG_REQUIRES_TWO_IN_HAND', 'You need two matching tiles in your hand to claim a pung.'];
  if (action.type === 'ClaimKongFromDiscard')
    return ['KONG_REQUIRES_THREE_IN_HAND', 'You need three matching tiles in your hand to claim a kong from a discard.'];
  if (action.type === 'DeclareWinFromDiscard' || action.type === 'DeclareSelfDrawWin' || action.type === 'RobKong') {
    if (missingCount(p) > 0) {
      const ms = SUIT_NAME[p.missingSuit];
      return ['WIN_CONTAINS_MISSING_SUIT', 'You cannot win while holding tiles from your missing suit.', `Your missing suit is ${ms}.`, ['Discard your missing-suit tiles first.']];
    }
    return ['HAND_NOT_COMPLETE', 'This is not a legal winning hand.', 'A winning hand needs four groups and one pair (or seven pairs).'];
  }
  if (action.type === 'Discard' && state.config.mustDiscardMissingSuitFirst && missingCount(p) > 0)
    return ['MUST_DISCARD_MISSING_SUIT', 'You still have tiles from your missing suit. You must discard those before discarding other suits.'];
  return ['ILLEGAL_ACTION', 'That move is not available right now.'];
}

/* =====================================================================
 * BOT decision logic (driver-side; reads only public info + own hand)
 * Follows the addendum priority: win > mandatory > kong > meld > discard.
 * ===================================================================== */
function botChooseMissingSuit(player) {
  const cnt = [0, 0, 0];
  for (let t = 0; t < NUM_TYPES; t++) cnt[tileSuit(t)] += player.concealed[t];
  let best = 0, bestScore = Infinity;
  for (let s = 0; s < 3; s++) {
    let conn = 0;
    for (let r = 0; r < 9; r++) {
      const t = s * 9 + r, v = player.concealed[t];
      if (v && r < 8) conn += Math.min(v, player.concealed[t + 1]);
      if (v >= 2) conn += 1;
    }
    const sc = cnt[s] * 10 + conn;
    if (sc < bestScore) { bestScore = sc; best = s; }
  }
  return best;
}

/* shanten estimate (standard + seven pairs), ignoring missing-suit dead tiles */
function shantenOf(player) {
  const c = player.concealed.slice();
  if (player.missingSuit != null) for (let r = 0; r < 9; r++) c[player.missingSuit * 9 + r] = 0;
  let st = stdShanten(c, player.melds.length);
  if (player.melds.length === 0) st = Math.min(st, sevenPairsShanten(c));
  return st;
}
function sevenPairsShanten(c) {
  let pairs = 0, kinds = 0;
  for (let t = 0; t < NUM_TYPES; t++) { if (c[t] > 0) kinds++; if (c[t] >= 2) pairs++; }
  let sh = 6 - pairs; if (kinds < 7) sh += 7 - kinds; return sh;
}
function stdShanten(c0, openMelds) {
  let best = 8; const c = c0.slice();
  function rec(i, melds, partials, pairUsed) {
    while (i < NUM_TYPES && c[i] === 0) i++;
    if (i === NUM_TYPES) {
      let m = melds + openMelds, part = partials;
      if (m + part > 4) part = 4 - m;
      const sh = (4 - m) * 2 - part - (pairUsed ? 1 : 0);
      if (sh < best) best = sh; return;
    }
    if (c[i] >= 3) { c[i] -= 3; rec(i, melds + 1, partials, pairUsed); c[i] += 3; }
    if (i % 9 <= 6 && c[i + 1] > 0 && c[i + 2] > 0) { c[i]--; c[i + 1]--; c[i + 2]--; rec(i, melds + 1, partials, pairUsed); c[i]++; c[i + 1]++; c[i + 2]++; }
    if (!pairUsed && c[i] >= 2) { c[i] -= 2; rec(i, melds, partials, true); c[i] += 2; }
    if (c[i] >= 2) { c[i] -= 2; rec(i, melds, partials + 1, pairUsed); c[i] += 2; }
    if (i % 9 <= 7 && c[i + 1] > 0) { c[i]--; c[i + 1]--; rec(i, melds, partials + 1, pairUsed); c[i]++; c[i + 1]++; }
    if (i % 9 <= 6 && c[i + 2] > 0) { c[i]--; c[i + 2]--; rec(i, melds, partials + 1, pairUsed); c[i]++; c[i + 2]++; }
    c[i]--; rec(i, melds, partials, pairUsed); c[i]++;
  }
  rec(0, 0, 0, false);
  return best;
}
function ukeireOf(state, player) {
  const base = shantenOf(player);
  let total = 0;
  for (let t = 0; t < NUM_TYPES; t++) {
    if (tileSuit(t) === player.missingSuit) continue;
    if (player.concealed[t] >= 4) continue;
    const rem = remainingOf(state, t, player.seat);
    if (rem <= 0) continue;
    player.concealed[t]++; const sh = shantenOf(player); player.concealed[t]--;
    if (sh < base) total += rem;
  }
  return total;
}
function opponentDanger(state, seat) {
  let worst = 0;
  for (let s = 0; s < 4; s++) {
    if (s === seat) continue;
    const o = state.players[s];
    if (o.hasWon) continue;
    // PUBLIC signals only — never inspect an opponent's concealed hand. We infer
    // "has cleared their missing suit" from their discard river: they discarded
    // missing-suit tiles earlier and their recent discards are no longer that suit.
    const dumpedMissing = o.missingSuit != null && o.discards.some((t) => tileSuit(t) === o.missingSuit);
    const recentOffMissing = o.discards.slice(-2).every((t) => o.missingSuit == null || tileSuit(t) !== o.missingSuit);
    const voidedLikely = dumpedMissing && recentOffMissing && o.discards.length >= 3;
    const d = o.melds.length * 0.2 + (voidedLikely ? 0.15 : 0) + Math.min(o.discards.length, 12) * 0.02;
    worst = Math.max(worst, Math.min(1, d));
  }
  return worst;
}
function discardPreference(player, t) {
  const r = tileRank(t), c = player.concealed;
  let s = 0;
  const l2 = r > 2 ? c[t - 2] : 0, l1 = r > 1 ? c[t - 1] : 0, r1 = r < 9 ? c[t + 1] : 0, r2 = r < 8 ? c[t + 2] : 0;
  const nb = l2 + l1 + r1 + r2;
  if (nb === 0 && c[t] === 1) s += 30;
  if ((r === 1 || r === 9) && c[t] === 1) s += 10;
  if (c[t] >= 2) s -= 25;
  if (l1 && r1) s -= 18;
  if (l1 || r1) s -= 6;
  s -= Math.abs(r - 5);
  return s;
}
function botChooseDiscard(state, seat, candidates, difficulty) {
  const p = state.players[seat];
  const miss = candidates.filter((t) => tileSuit(t) === p.missingSuit);
  if (miss.length) candidates = miss;                       // forced clear first
  if (difficulty === 'easy' && rngNext(state) < 0.35) return candidates[rngInt(state, candidates.length)];
  const danger = difficulty === 'hard' ? opponentDanger(state, seat) : 0;   // constant across candidates — hoisted
  let best = candidates[0], bestScore = -Infinity;
  for (const t of candidates) {
    p.concealed[t]--;
    const sh = shantenOf(p);
    const accept = (difficulty !== 'easy') ? ukeireOf(state, p) : 0;
    p.concealed[t]++;
    let sc = -sh * 1000 + accept * 4 + discardPreference(p, t);
    if (difficulty === 'hard') sc -= tileDanger(state, seat, t) * 60 * danger;
    if (sc > bestScore) { bestScore = sc; best = t; }
  }
  return best;
}
function tileDanger(state, seat, t) {
  // a tile never seen in any river is more likely to be a live wait — count it ONCE
  let seenRivers = 0;
  for (const q of state.players) for (const d of q.discards) if (d === t) seenRivers++;
  let danger = (seenRivers === 0 ? 0.5 : 0.1);
  for (let s = 0; s < 4; s++) {
    if (s === seat) continue;
    const o = state.players[s];
    if (o.hasWon) continue;
    if (o.missingSuit != null && tileSuit(t) === o.missingSuit) danger -= 0.4;  // safe vs that opponent
  }
  return Math.max(0, danger);
}
function botChooseAction(state, seat, difficulty) {
  difficulty = difficulty || state.players[seat].difficulty || 'normal';
  const acts = getLegalActions(state, seat);
  if (!acts.length) return null;
  const p = state.players[seat];

  // missing-suit selection
  const choose = acts.filter((a) => a.type === 'ChooseMissingSuit');
  if (choose.length) return { type: 'ChooseMissingSuit', suit: botChooseMissingSuit(p) };

  // 1. winning move
  const win = acts.find((a) => a.type === 'DeclareSelfDrawWin' || a.type === 'DeclareWinFromDiscard' || a.type === 'RobKong');
  if (win) return win;

  // reaction window (no win): consider pung/kong, else pass
  if (state.phase === PHASE.DISCARD_REACT) {
    const pung = acts.find((a) => a.type === 'ClaimPung');
    const kong = acts.find((a) => a.type === 'ClaimKongFromDiscard');
    const m = botChooseMeld(state, seat, pung, kong, difficulty);
    return m || acts.find((a) => a.type === 'Pass');
  }
  if (state.phase === PHASE.ROB_REACT) return acts.find((a) => a.type === 'Pass');

  // 3. kong decisions on own turn
  const kongs = acts.filter((a) => a.type === 'DeclareConcealedKong' || a.type === 'DeclareAddedKong');
  if (kongs.length) {
    const g = botChooseKong(state, seat, kongs, difficulty);
    if (g) return g;
  }
  // 5. best discard
  const discards = acts.filter((a) => a.type === 'Discard').map((a) => a.tile);
  if (discards.length) return { type: 'Discard', tile: botChooseDiscard(state, seat, discards, difficulty) };
  return acts[0];
}
function botChooseKong(state, seat, kongs, difficulty) {
  const p = state.players[seat];
  if (difficulty === 'easy') return rngNext(state) < 0.7 ? kongs[0] : null;
  const before = shantenOf(p);
  for (const g of kongs) {
    const snap = p.concealed.slice();
    if (g.type === 'DeclareConcealedKong') p.concealed[g.tile] -= 4; else p.concealed[g.tile] -= 1;
    const after = shantenOf(p);
    p.concealed = snap;
    if (after <= before) return g;
  }
  if (difficulty === 'hard') return kongs.find((g) => g.type === 'DeclareConcealedKong') || null;
  return null;
}
function botChooseMeld(state, seat, pung, kong, difficulty) {
  const p = state.players[seat];
  if (!pung && !kong) return null;
  const tile = (pung || kong).tile;
  if (tileSuit(tile) === p.missingSuit) return null;
  if (difficulty === 'easy') { if (rngNext(state) < 0.45) return null; return pung || kong; }
  const before = shantenOf(p);
  // simulate removing `remove` copies into a meld; return resulting shanten + tenpai
  const evalClaim = (remove) => {
    const snap = p.concealed.slice(), msnap = p.melds.map((m) => ({ ...m }));
    p.concealed[tile] -= remove; p.melds.push({ type: remove === 2 ? PUNG : KONG_EXPOSED_FROM_DISCARD, tile });
    const after = shantenOf(p), ready = isReady(p, state.config);
    p.concealed = snap; p.melds = msnap;
    return { after, ready };
  };
  // primary claim decision uses the pung (keeps a spare); fall back to kong if no pung
  const primary = pung ? evalClaim(2) : evalClaim(3);
  const claimGood = primary.after < before || primary.ready;
  if (!claimGood) {
    if (difficulty === 'hard') return null;
    return primary.after <= before && rngNext(state) < 0.25 ? (pung || kong) : null;
  }
  if (difficulty === 'hard' && primary.after >= before && opponentDanger(state, seat) > 0.6) return null;
  // both offered (3 in hand): take the kong for its replacement draw when the spare
  // tile the pung would keep isn't improving the hand anyway.
  if (pung && kong && evalClaim(3).after <= primary.after) return kong;
  return pung || kong;
}

// ==CORE-END== (synced region)

export {
  DOT, BAMBOO, CHARACTER, SUIT_GLYPH, SUIT_NAME, NUM_TYPES,
  tileIndex, tileSuit, tileRank, emptyCounts, countTotal,
  DEFAULT_CONFIG, makeConfig, createGame,
  getLegalActions, pendingDeciders, applyAction, actionsEqual,
  isWinningHand, winsNow, getWinningTiles, isReady, isSevenPairs,
  score, viewFor, validateConservation, remainingOf, missingCount,
  botChooseAction, botChooseMissingSuit, shantenOf,
  PHASE, PUNG, KONG_CONCEALED, KONG_ADDED, KONG_EXPOSED_FROM_DISCARD,
};
