/* Client↔server mirror guard for the 75 Hard day-boundary logic.
 * Extracts the ==MIRROR-START==/==MIRROR-END== block from the app's inline JS
 * and runs identical vectors through it and worker/src/hardlogic.ts — any
 * behavioral drift fails the build (same spirit as mahjong's core-sync).
 * Run: node --experimental-strip-types worker/test/hard-mirror.test.mjs      */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import * as server from '../src/hardlogic.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const html = readFileSync(join(root, 'apps/75hard/index.html'), 'utf8');
const m = html.match(/==MIRROR-START==[\s\S]*?={5,}\s*\*\/([\s\S]*?)\/\*\s*==MIRROR-END==/);
if (!m) { console.error('mirror markers not found in apps/75hard/index.html'); process.exit(1); }

const client = new Function(m[1] + `;
  return { localDateStr, dateToUTC, addDays, nextDay, prevDay, daysBetween, dayNumberOf,
           emptyDay, isDayComplete, missingTasks, remainingCount, applyDayActionM,
           WATER_GOAL_M, WORKOUT_MIN_M };`)();

let pass = 0, fail = 0; const failures = [];
const ok = (cond, msg) => { if (cond) pass++; else { fail++; failures.push(msg); } };
const eq = (a, b, msg) => ok(JSON.stringify(a) === JSON.stringify(b), `${msg} (client ${JSON.stringify(a)} vs server ${JSON.stringify(b)})`);

// deterministic PRNG so failures reproduce
let seed = 42;
const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
const rint = (lo, hi) => lo + Math.floor(rnd() * (hi - lo + 1));
const pick = (arr) => arr[rint(0, arr.length - 1)];

/* ===== constants ===== */
eq(client.WATER_GOAL_M, 128, 'water goal');
eq(client.WORKOUT_MIN_M, 45, 'workout minutes');

/* ===== date math (500 random vectors incl. DST-transition dates) ===== */
{
  const bases = ['2026-03-07', '2026-03-08', '2026-11-01', '2026-02-28', '2024-02-28', '2026-12-31', '2026-07-08'];
  for (let i = 0; i < 500; i++) {
    const base = pick(bases);
    const n = rint(-400, 400);
    const c = client.addDays(base, n), s = server.addDays(base, n);
    if (c !== s) { ok(false, `addDays(${base},${n}): ${c} vs ${s}`); continue; }
    ok(client.daysBetween(base, c) === server.daysBetween(base, s), `daysBetween(${base},${c})`);
    ok(client.dayNumberOf(base, c) === server.dayNumberOf(base, s), `dayNumberOf(${base},${c})`);
  }
  eq(client.nextDay('2026-03-08'), server.nextDay('2026-03-08'), 'nextDay across DST');
  eq(client.prevDay('2026-01-01'), server.prevDay('2026-01-01'), 'prevDay year edge');
}

/* ===== localDateStr vs server localDate in the host timezone ===== */
{
  const hostTZ = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const instants = [
    Date.UTC(2026, 6, 8, 3, 59), Date.UTC(2026, 6, 8, 4, 1),
    Date.UTC(2026, 2, 8, 6, 30), Date.UTC(2026, 2, 8, 7, 30),   // around US spring-forward
    Date.UTC(2026, 10, 1, 5, 30), Date.UTC(2026, 10, 1, 6, 30), // around US fall-back
    Date.UTC(2026, 0, 1, 0, 0), Date.now(),
  ];
  for (const ms of instants) {
    eq(client.localDateStr(ms), server.localDate(ms, hostTZ), `localDate @${ms}`);
  }
}

/* ===== day rows: completion / missing / remaining (400 random rows) ===== */
function randomRow() {
  const d = server.emptyDay('t@t', '2026-07-08');
  d.diet = rint(0, 1); d.reading_done = rint(0, 1);
  d.workout1_done = rint(0, 1); d.workout1_min = pick([0, 30, 44, 45, 46, 90]);
  d.workout1_outdoor = rint(0, 1);
  d.workout2_done = rint(0, 1); d.workout2_min = pick([0, 30, 44, 45, 46, 90]);
  d.workout2_outdoor = rint(0, 1);
  d.water_oz = pick([0, 64, 127, 128, 129, 200]);
  d.photo_id = rnd() > 0.5 ? 'p' : null;
  return d;
}
{
  eq(client.emptyDay('t@t', '2026-07-08'), server.emptyDay('t@t', '2026-07-08'), 'emptyDay shape');
  for (let i = 0; i < 400; i++) {
    const row = randomRow();
    if (client.isDayComplete(row) !== server.isDayComplete(row)) { ok(false, `isDayComplete drift: ${JSON.stringify(row)}`); continue; }
    ok(true, '');
    eq(client.missingTasks(row), server.missingTasks(row), `missingTasks drift: ${JSON.stringify(row)}`);
    eq(client.remainingCount(row), server.remainingCount(row), `remainingCount drift: ${JSON.stringify(row)}`);
  }
  eq(client.isDayComplete(null), server.isDayComplete(null), 'isDayComplete(null)');
  eq(client.missingTasks(undefined), server.missingTasks(undefined), 'missingTasks(undefined)');
  eq(client.remainingCount(null), server.remainingCount(null), 'remainingCount(null)');
}

/* ===== reducer: applyDayActionM vs applyDayAction (600 random actions) ===== */
function randomAction() {
  const type = pick(['set_task', 'set_workout', 'add_water', 'set_water', 'attach_photo', 'bogus']);
  const payloads = {
    set_task: () => pick([
      { field: 'diet', value: rnd() > 0.5 },
      { field: 'reading', value: rnd() > 0.5, pages: pick([undefined, 0, 10, 5000, -3]), bookId: pick([undefined, 'b1']) },
      { field: 'nope' },
    ]),
    set_workout: () => ({ slot: pick([1, 2, '1', '2', 3, undefined]), done: rnd() > 0.5, minutes: pick([0, 45, 601, -5, 'x']), outdoor: rnd() > 0.5 }),
    add_water: () => ({ oz: pick([8, -8, 513, -513, 99999, 'x']) }),
    set_water: () => ({ oz: pick([0, 128, 1025, -1, 3.7]) }),
    attach_photo: () => pick([{ photoId: 'p1' }, { photoId: '' }, {}]),
    bogus: () => ({}),
  };
  return { actionId: 'x', type, payload: payloads[type](), date: '2026-07-08', localTimestamp: 0, timezone: 'UTC' };
}
{
  for (let i = 0; i < 600; i++) {
    const row = randomRow();
    const a = randomAction();
    const c = client.applyDayActionM({ ...row }, a);
    const s = server.applyDayAction({ ...row }, a);
    eq(c, s, `reducer drift on ${a.type} ${JSON.stringify(a.payload)}`);
  }
}

console.log(`hard-mirror: ${pass} passed, ${fail} failed`);
if (fail) { for (const f of failures.slice(0, 10)) console.log('  FAIL:', f); process.exit(1); }
