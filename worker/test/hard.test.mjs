/* Node test suite for the 75 Hard pure logic (day boundary, grace, finalize/reset).
 * Run: node --experimental-strip-types worker/test/hard.test.mjs              */
import {
  localDate, localMinutes, effectiveDate, addDays, nextDay, prevDay,
  daysBetween, dayNumberOf, isDayComplete, missingTasks, remainingCount,
  validateStamp, stampInWindow, applyDayAction, emptyDay, planFinalize,
  inQuietHours, notifEnabled, toMinutes,
} from '../src/hardlogic.ts';

let pass = 0, fail = 0; const failures = [];
const ok = (cond, msg) => { if (cond) pass++; else { fail++; failures.push(msg); } };
const eq = (a, b, msg) => ok(a === b, `${msg} (got ${a}, want ${b})`);

const NY = 'America/New_York';
const TPE = 'Asia/Taipei';
// helper: epoch ms for a local wall-clock time in a zone (search-based, DST-safe)
function zonedMs(date, hhmm, tz) {
  const [h, m] = hhmm.split(':').map(Number);
  let guess = Date.UTC(...date.split('-').map(Number).map((v, i) => (i === 1 ? v - 1 : v)), h, m);
  for (let i = 0; i < 4; i++) {
    const gotDate = localDate(guess, tz);
    const gotMin = localMinutes(guess, tz);
    const diff = (daysBetween(gotDate, date) * 1440) + (h * 60 + m) - gotMin;
    if (diff === 0) return guess;
    guess += diff * 60000;
  }
  return guess;
}

/* ===== local date / minutes ===== */
{
  const ms = zonedMs('2026-07-08', '23:30', NY);
  eq(localDate(ms, NY), '2026-07-08', 'localDate NY');
  eq(localMinutes(ms, NY), 23 * 60 + 30, 'localMinutes NY');
  // same instant is next morning in Taipei
  eq(localDate(ms, TPE), '2026-07-09', 'localDate Taipei crosses midnight');
}

/* ===== date arithmetic (incl. DST spring-forward) ===== */
{
  eq(nextDay('2026-02-28'), '2026-03-01', 'nextDay non-leap');
  eq(prevDay('2026-01-01'), '2025-12-31', 'prevDay year edge');
  eq(daysBetween('2026-03-07', '2026-03-09'), 2, 'daysBetween across US DST start');
  eq(dayNumberOf('2026-07-01', '2026-07-08'), 8, 'dayNumberOf');
}

/* ===== effectiveDate grace ===== */
{
  const g = 180;
  eq(effectiveDate(zonedMs('2026-07-09', '02:00', NY), NY, g), '2026-07-08', '02:00 with 3h grace is still yesterday');
  eq(effectiveDate(zonedMs('2026-07-09', '03:01', NY), NY, g), '2026-07-09', '03:01 past grace is today');
  eq(effectiveDate(zonedMs('2026-07-09', '00:30', NY), NY, 0), '2026-07-09', 'no grace rolls at midnight');
}

/* ===== isDayComplete / missing / remaining ===== */
{
  const full = { ...emptyDay('a@b.c', '2026-07-08'),
    diet: 1, reading_done: 1, water_oz: 128, photo_id: 'p1',
    workout1_done: 1, workout1_min: 45, workout1_outdoor: 0,
    workout2_done: 1, workout2_min: 60, workout2_outdoor: 1 };
  ok(isDayComplete(full), 'complete day');
  eq(remainingCount(full), 0, 'remaining 0');
  ok(!isDayComplete({ ...full, workout2_min: 44 }), '44-min workout fails');
  ok(!isDayComplete({ ...full, workout1_outdoor: 0, workout2_outdoor: 0 }), 'no outdoor fails');
  ok(!isDayComplete({ ...full, water_oz: 127 }), '127oz fails');
  ok(!isDayComplete(undefined), 'missing row fails');
  const m = missingTasks({ ...full, workout1_outdoor: 0, workout2_outdoor: 0, water_oz: 100 });
  ok(m.includes('outdoor workout') && m.some((x) => x.startsWith('water')), 'missingTasks lists outdoor+water');
  eq(remainingCount(undefined), 5, 'empty day has 5 remaining');
}

/* ===== stamp validation + window ===== */
{
  const now = zonedMs('2026-07-08', '22:00', NY);
  const act = (over = {}) => ({
    actionId: 'x', type: 'set_task', payload: {},
    date: '2026-07-08', localTimestamp: now, timezone: NY, ...over,
  });
  ok(validateStamp(act(), now).ok, 'valid stamp');
  ok(!validateStamp(act({ date: '2026-07-20' }), now).ok, 'date far from stamp rejected');
  ok(!validateStamp(act({ localTimestamp: now + 27 * 3600e3 }), now).ok, 'future stamp rejected');
  ok(!validateStamp(act({ timezone: 'Not/AZone' }), now).ok, 'bad tz rejected');

  ok(stampInWindow(act(), 0), 'same-day stamp in window');
  const lateMs = zonedMs('2026-07-09', '01:00', NY);
  ok(stampInWindow(act({ localTimestamp: lateMs }), 180), '01:00 next day inside 3h grace');
  ok(!stampInWindow(act({ localTimestamp: lateMs }), 0), '01:00 next day outside 0 grace');
  const wayLate = zonedMs('2026-07-10', '01:00', NY);
  ok(!stampInWindow(act({ localTimestamp: wayLate }), 180), 'two days later never in window');
}

/* ===== reducers ===== */
{
  let d = emptyDay('a@b.c', '2026-07-08');
  d = applyDayAction(d, { type: 'add_water', payload: { oz: 16 } });
  d = applyDayAction(d, { type: 'add_water', payload: { oz: 16 } });
  eq(d.water_oz, 32, 'add_water accumulates');
  d = applyDayAction(d, { type: 'set_water', payload: { oz: 128 } });
  eq(d.water_oz, 128, 'set_water absolute');
  d = applyDayAction(d, { type: 'set_workout', payload: { slot: 1, done: true, minutes: 50, outdoor: true } });
  eq(d.workout1_min, 50, 'set_workout slot 1');
  d = applyDayAction(d, { type: 'set_task', payload: { field: 'reading', value: true, pages: 12 } });
  eq(d.reading_done, 1, 'reading done');
  eq(d.pages, 12, 'pages noted');
  ok(applyDayAction(d, { type: 'set_task', payload: { field: 'nope' } }) === null, 'bad field rejected');
  ok(applyDayAction(d, { type: 'attach_photo', payload: {} }) === null, 'photo without id rejected');
  d = applyDayAction(d, { type: 'add_water', payload: { oz: 99999 } });
  eq(d.water_oz, 640, 'water delta clamped to 512');
}

/* ===== finalize: clean run, milestones, day 75 ===== */
{
  const completeRow = (date) => ({ ...emptyDay('a@b.c', date),
    diet: 1, reading_done: 1, water_oz: 128, photo_id: 'p',
    workout1_done: 1, workout1_min: 45, workout2_done: 1, workout2_min: 45, workout2_outdoor: 1 });
  const start = '2026-01-01';
  const days = new Map();
  for (let i = 0; i < 75; i++) { const dt = addDays(start, i); days.set(dt, completeRow(dt)); }
  const p = { email: 'a@b.c', start_date: start, streak_start_date: start, last_finalized_date: null, completed_at: null };
  const nowMs = zonedMs('2026-03-20', '12:00', NY); // way past day 75
  const plan = planFinalize(p, days, NY, 180, nowMs);
  eq(plan.steps.length, 75, 'finalizes exactly 75 days then stops');
  ok(plan.completed75, 'completed75 set');
  eq(plan.milestones.join(','), '25,50', 'milestones 25 and 50');
  eq(plan.resets.length, 0, 'no resets');
  eq(plan.lastFinalized, addDays(start, 74), 'cursor at day 75');
}

/* ===== finalize: miss → reset + renumbering ===== */
{
  const completeRow = (date) => ({ ...emptyDay('a@b.c', date),
    diet: 1, reading_done: 1, water_oz: 128, photo_id: 'p',
    workout1_done: 1, workout1_min: 45, workout2_done: 1, workout2_min: 45, workout2_outdoor: 1 });
  const days = new Map();
  days.set('2026-07-01', completeRow('2026-07-01'));
  days.set('2026-07-02', completeRow('2026-07-02'));
  // 07-03 missing entirely (a miss), 07-04 complete
  days.set('2026-07-04', completeRow('2026-07-04'));
  const p = { email: 'a@b.c', start_date: '2026-07-01', streak_start_date: '2026-07-01', last_finalized_date: null, completed_at: null };
  const plan = planFinalize(p, days, NY, 180, zonedMs('2026-07-05', '12:00', NY));
  eq(plan.steps.length, 4, 'four days finalized');
  eq(plan.resets.length, 1, 'one reset');
  eq(plan.resets[0].date, '2026-07-03', 'reset on the missing day');
  eq(plan.resets[0].dayNumber, 3, 'missed day was day 3');
  eq(plan.newStreakStart, '2026-07-04', 'streak restarts day after miss');
  eq(plan.steps[3].dayNumber, 1, '07-04 renumbered to day 1');
}

/* ===== finalize: grace holds yesterday open ===== */
{
  const p = { email: 'a@b.c', start_date: '2026-07-07', streak_start_date: '2026-07-07', last_finalized_date: null, completed_at: null };
  const early = planFinalize(p, new Map(), NY, 180, zonedMs('2026-07-08', '02:30', NY));
  eq(early.steps.length, 0, 'yesterday not finalized inside grace');
  const late = planFinalize(p, new Map(), NY, 180, zonedMs('2026-07-08', '03:30', NY));
  eq(late.steps.length, 1, 'yesterday finalized after grace');
  ok(!late.steps[0].complete, 'empty day finalizes incomplete');
}

/* ===== finalize: completed participant is inert; cursor respected ===== */
{
  const p1 = { email: 'a@b.c', start_date: '2026-01-01', streak_start_date: '2026-01-01', last_finalized_date: null, completed_at: '2026-03-17' };
  eq(planFinalize(p1, new Map(), NY, 0, zonedMs('2026-07-08', '12:00', NY)).steps.length, 0, 'completed user skipped');
  const p2 = { email: 'a@b.c', start_date: '2026-07-01', streak_start_date: '2026-07-06', last_finalized_date: '2026-07-02', completed_at: null };
  const plan = planFinalize(p2, new Map(), NY, 0, zonedMs('2026-07-08', '12:00', NY));
  eq(plan.steps[0].date, '2026-07-06', 'cursor clamps to streak start (team-reset skip)');
}

/* ===== real DST instants (America/New_York 2026: spring-forward Mar 8, fall-back Nov 1) ===== */
{
  // 2026-03-08 02:30 EST does not exist; 06:59 UTC is 01:59 EST, 07:01 UTC is 03:01 EDT
  eq(localDate(Date.UTC(2026, 2, 8, 6, 59), NY), '2026-03-08', 'pre-spring-forward date');
  eq(localMinutes(Date.UTC(2026, 2, 8, 6, 59), NY), 119, '01:59 EST minutes');
  eq(localMinutes(Date.UTC(2026, 2, 8, 7, 1), NY), 181, 'clock jumps to 03:01 EDT');
  // grace across the transition: 03:30 EDT − 180min lands before the 23-hour day's midnight
  eq(effectiveDate(Date.UTC(2026, 2, 8, 7, 30), NY, 180), '2026-03-07', '03:30 EDT with 3h grace is still Mar 7');
  eq(effectiveDate(Date.UTC(2026, 2, 8, 8, 30), NY, 180), '2026-03-08', '04:30 EDT past grace is Mar 8');
  // fall-back: 05:30 UTC = 01:30 EDT (first pass), 06:30 UTC = 01:30 EST (second pass) — same local date
  eq(localDate(Date.UTC(2026, 10, 1, 5, 30), NY), '2026-11-01', 'first 01:30 on fall-back day');
  eq(localDate(Date.UTC(2026, 10, 1, 6, 30), NY), '2026-11-01', 'second 01:30 on fall-back day');
  eq(daysBetween('2026-03-07', '2026-03-09'), 2, 'spring-forward day still counts as one');
  eq(daysBetween('2026-10-31', '2026-11-02'), 2, 'fall-back day still counts as one');
}

/* ===== finalize: consecutive misses collapse into one restart ===== */
{
  const p = { email: 'a@b.c', start_date: '2026-07-01', streak_start_date: '2026-07-01', last_finalized_date: null, completed_at: null };
  // no rows at all: 07-01..07-04 all missed
  const plan = planFinalize(p, new Map(), NY, 0, zonedMs('2026-07-05', '12:00', NY));
  eq(plan.steps.length, 4, 'four missed days finalized');
  eq(plan.resets.length, 4, 'each miss recorded');
  eq(plan.newStreakStart, '2026-07-05', 'streak lands on today after consecutive misses');
  eq(plan.resets[0].dayNumber, 1, 'first miss was day 1');
  eq(plan.resets[1].dayNumber, 1, 'renumbered: second miss is day 1 of the next streak');
}

/* ===== finalize: day 75 reached on a streak that restarted mid-challenge ===== */
{
  const completeRow = (date) => ({ ...emptyDay('a@b.c', date),
    diet: 1, reading_done: 1, water_oz: 128, photo_id: 'p',
    workout1_done: 1, workout1_min: 45, workout2_done: 1, workout2_min: 45, workout2_outdoor: 1 });
  const start = '2026-01-01';
  const days = new Map();
  // days 1-9 complete, day 10 missed, then 75 complete days
  for (let i = 0; i < 9; i++) { const dt = addDays(start, i); days.set(dt, completeRow(dt)); }
  const restart = addDays(start, 10);
  for (let i = 0; i < 75; i++) { const dt = addDays(restart, i); days.set(dt, completeRow(dt)); }
  const p = { email: 'a@b.c', start_date: start, streak_start_date: start, last_finalized_date: null, completed_at: null };
  const plan = planFinalize(p, days, NY, 0, zonedMs('2026-07-01', '12:00', NY));
  ok(plan.completed75, 'completed 75 after a mid-challenge restart');
  eq(plan.resets.length, 1, 'one reset along the way');
  eq(plan.newStreakStart, restart, 'streak start moved to the restart');
  eq(plan.lastFinalized, addDays(restart, 74), 'walk stops at the new day 75');
  eq(plan.milestones.join(','), '25,50', 'milestones renumbered against the restarted streak');
}

/* ===== quiet hours / prefs ===== */
{
  const prefs = { quietHours: { start: '22:30', end: '07:00' } };
  ok(inQuietHours(prefs, toMinutes('23:15')), '23:15 quiet (wraps)');
  ok(inQuietHours(prefs, toMinutes('06:59')), '06:59 quiet');
  ok(!inQuietHours(prefs, toMinutes('12:00')), 'noon not quiet');
  ok(!inQuietHours({}, 0), 'no quiet hours configured');
  ok(notifEnabled({}, 'poke'), 'notif default on');
  ok(!notifEnabled({ notif: { poke: false } }, 'poke'), 'notif off respected');
}

console.log(`hard.test: ${pass} passed, ${fail} failed`);
if (fail) { for (const f of failures) console.log('  FAIL:', f); process.exit(1); }
