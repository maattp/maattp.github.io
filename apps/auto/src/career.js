// THE CAREER: the wallet that survives a launch, and the Seattle Passport.
//
// Every payout in the game lands in `game.money`, and until v194 it was a
// plain number that started at $250 on every launch -- so the shop (the
// DELIVERY buttons) was a thing you could only ever afford inside one sitting.
// This saves it (localStorage 'auto-career') and reads the rest of what the
// game already keeps -- coins, tech badges, stunt jumps, island finds, job
// medals, the mini-games' bests -- into one place with a rank on it.
//
// Saving is by polling at 1 Hz, not by hooking the ~25 places that pay out: a
// write whenever the number differs from what was last written, which is also
// the debounce. Plus a flush on `visibilitychange`/`pagehide`, because iOS
// kills a backgrounded PWA without an unload.
//
// What is NOT here: the shop's purchases are one-shot spawns (a car beside
// you, a pistol in your pocket), so there is no ownership to persist. And the
// rank gates nothing -- it is derived from progress and shown, never checked.
// The player must never lose access to something they can afford today.
//
// The passport's totals are read off the real lists (the coin list, the tech
// list, the ramp list, the Easter-egg list, the arcade's GAMES), never typed
// in here, so a new ramp or a new cabinet moves the percentages by itself.

import { GAMES } from './arcadegames.js';
import { EGGS } from './islands.js';

export const KEY = 'auto-career';
export const START_MONEY = 250;

/** Rank by overall completion (0..1): the mean of the categories' fractions. */
export const RANKS = [
  { name: 'Tourist', at: 0 },
  { name: 'Local', at: 0.10 },
  { name: 'Regular', at: 0.30 },
  { name: 'Insider', at: 0.55 },
  { name: 'Local Legend', at: 0.85 },
];

export function rankFor(frac) {
  let i = 0;
  for (let k = 0; k < RANKS.length; k++) if (frac >= RANKS[k].at) i = k;
  return i;
}

function read() {
  try { const s = JSON.parse(localStorage.getItem(KEY) || 'null'); if (s && typeof s === 'object') return s; } catch (e) { /* private mode / corrupt */ }
  return {};
}

/** The saved wallet, or the starting $250 when there is none (or it is junk). */
export function savedMoney() {
  const m = read().money;
  return typeof m === 'number' && isFinite(m) && m >= 0 ? Math.floor(m) : START_MONEY;
}

export class Career {
  /** sources: () => { acts, stunts, islands, missions, seafair, taxi, games: [{ id, best }], arcade } -- all optional */
  constructor(game, sources) {
    this.game = game;
    this.sources = sources || (() => ({}));
    const s = read();
    this.saved = savedMoney();
    game.money = this.saved;
    this.rank = Number.isInteger(s.rank) ? Math.max(0, Math.min(RANKS.length - 1, s.rank)) : 0;   // a hand-edited 99 would silence every toast
    this.hud = null;
    this.armed = false;     // false until the world is up: no toast for a rank earned last session
    this._timer = null;
    const flush = () => this.flush();
    document.addEventListener('visibilitychange', () => { if (document.hidden) flush(); });
    window.addEventListener('pagehide', flush);
  }

  /** Called once the HUD exists and the world has booted: start watching. */
  start(hud) {
    this.hud = hud;
    const p = this.passport();
    this.rank = Math.max(this.rank, p.rankIdx);
    this.armed = true;
    this.flush(true);
    if (!this._timer) this._timer = setInterval(() => this.tick(), 1000);
  }

  tick() {
    if (this.game.money !== this.saved) this.flush();
    if (!this.armed) return;
    const p = this.passport();
    if (p.rankIdx > this.rank) {
      this.rank = p.rankIdx;
      this.flush(true);
      if (this.hud) this.hud.showToast(`Seattle Passport: you are now ${/^[AEIOU]/i.test(p.rank) ? 'an' : 'a'} ${p.rank}`, 4500);
    }
  }

  /** Write now. `force` writes even when the money has not moved (a rank change). */
  flush(force) {
    const m = this.game.money;
    if (!(typeof m === 'number' && isFinite(m))) return;
    const money = Math.max(0, Math.floor(m));
    if (!force && money === this.saved) return;
    this.saved = money;
    try { localStorage.setItem(KEY, JSON.stringify({ money, rank: this.rank })); } catch (e) { /* private mode */ }
  }

  /**
   * The passport: rows of { id, label, done, total }, the overall fraction, and
   * the rank it earns. Every number is read from the live source, so the pause
   * menu and a test see the same thing.
   */
  passport() {
    const s = this.sources();
    const rows = [];
    const add = (id, label, done, total) => { if (total > 0) rows.push({ id, label, done: Math.min(done, total), total }); };
    const { acts, stunts, islands, missions, seafair, arcade, taxi } = s;
    if (acts) {
      add('coins', 'Landmark coins', acts.found.size, acts.coins.length);
      add('tech', 'Tech Tour badges', acts.techFound.size, acts.tech.length);
      const meds = acts.list.filter((a) => a.best && a.best.medal);
      add('jobs', 'Jobs completed', meds.filter((a) => a.best.medal !== 'none').length, acts.list.length);
      add('golds', 'Gold medals', meds.filter((a) => a.best.medal === 'gold').length, acts.list.length);
    }
    if (stunts) add('stunts', 'Stunt jumps', stunts.list.filter((j) => j.done).length, stunts.list.length);
    if (islands) add('islands', 'Island finds', EGGS.filter((k) => islands.found.has(k)).length, EGGS.length);
    if (s.games) add('games', 'Mini-games played', s.games.filter((g) => g.best > 0).length, s.games.length);
    if (arcade) add('arcade', 'Arcade cabinets', GAMES.filter((g) => arcade.hi[g.id] > 0).length, GAMES.length);
    const frac = rows.length ? rows.reduce((a, r) => a + r.done / r.total, 0) / rows.length : 0;
    const rankIdx = rankFor(frac);
    const next = RANKS[rankIdx + 1] || null;
    const extra = [];
    if (missions && missions.best) extra.push(`Vigilante level ${missions.best}`);
    if (taxi && taxi.stats.fares) extra.push(`Taxi fares ${taxi.stats.fares}`);
    if (seafair && seafair.series && seafair.series.cups) extra.push(`Seafair cups ${seafair.series.cups}`);
    return {
      money: Math.floor(this.game.money), rows, frac, pct: Math.floor(frac * 100),
      rankIdx, rank: RANKS[rankIdx].name,
      next: next ? { name: next.name, at: next.at, pct: Math.round(next.at * 100) } : null,
      extra,
    };
  }
}
