/* Integration drills for the 75 Hard backend against `wrangler dev`.
 * Setup:  npx wrangler kv key put --binding KV "__session:test-matt" "m.polkiewicz@gmail.com" --local
 *         npx wrangler kv key put --binding KV "__session:test-ting" "ting520143@gmail.com" --local
 *         npx wrangler dev --test-scheduled --port 8787
 * Run:    node worker/test/hard.integration.mjs
 * NOTE: mutates local .wrangler D1 state; wipe hard_* tables to re-run cleanly. */
import WebSocket from 'ws';

const API = 'http://localhost:8787';
const ORIGIN = 'http://localhost:8000';
let pass = 0, fail = 0; const failures = [];
const ok = (cond, msg) => { if (cond) pass++; else { fail++; failures.push(msg); } };
const eq = (a, b, msg) => ok(a === b, `${msg} (got ${JSON.stringify(a)}, want ${JSON.stringify(b)})`);

const uuid = () => crypto.randomUUID();
const api = async (token, method, path, body, raw) => {
  const res = await fetch(API + path, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      Origin: ORIGIN,
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  return raw ? res : { status: res.status, data: await res.json() };
};

const TZ = 'America/New_York';
// All fixture dates are relative to the run day so the suite never rots.
// D0 = matt's effective "today" under the default 180-min grace window.
const nyEff = (graceMin = 180) => new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(Date.now() - graceMin * 60000));
const D0 = nyEff();
const D = (n) => new Date(Date.parse(D0 + 'T12:00:00Z') + n * 86400000).toISOString().slice(0, 10);
// ~noon NY on a given date (16:00 UTC = 11:00 EST / 12:00 EDT — same local date either way)
const noonNY = (date) => Date.UTC(...date.split('-').map((v, i) => (i === 1 ? v - 1 : +v)), 16, 0);
const act = (type, payload, date, ts) => ({
  actionId: uuid(), type, payload, date, localTimestamp: ts ?? noonNY(date), timezone: TZ,
});
const completeDayActions = (date) => [
  act('set_task', { field: 'diet', value: true }, date),
  act('set_task', { field: 'reading', value: true, pages: 10 }, date),
  act('set_workout', { slot: 1, done: true, minutes: 45, outdoor: false }, date),
  act('set_workout', { slot: 2, done: true, minutes: 50, outdoor: true }, date),
  act('set_water', { oz: 128 }, date),
  act('attach_photo', { photoId: 'fake-photo-' + date }, date),
];

/* ===== auth gate ===== */
{
  const res = await fetch(API + '/hard/state', { headers: { Origin: ORIGIN } });
  eq(res.status, 401, 'no token → 401');
  const bad = await api('nope', 'GET', '/hard/state');
  eq(bad.status, 401, 'bad token → 401');
}

/* ===== start challenge with history: 07-03 ✓, 07-04 ✗(water), 07-05 empty, 07-06 ✓ ===== */
const startBatch = [
  act('start_challenge', { startDate: D(-5), mode: 'solo', timezone: TZ }, D(-5)),
  ...completeDayActions(D(-5)),
  // 07-04: everything but water
  ...completeDayActions(D(-4)).filter((a) => a.type !== 'set_water'),
  ...completeDayActions(D(-2)),
];
{
  const { status, data } = await api('test-matt', 'POST', '/hard/sync', { actions: startBatch });
  eq(status, 200, 'sync 200');
  ok(data.results.every((r) => r.status === 'applied'), 'all initial actions applied');
  // finalize hasn't run since the participant was created mid-call
}

/* ===== duplicate replay: same batch again → every action duplicate, state unchanged ===== */
{
  const { data } = await api('test-matt', 'POST', '/hard/sync', { actions: startBatch });
  ok(data.results.every((r) => r.status === 'duplicate'), 'full replay → all duplicate');
}

/* ===== lazy finalization on /state: misses on 07-04, 07-05, 07-07 → streak restarts today ===== */
{
  const { data: state } = await api('test-matt', 'GET', '/hard/state');
  eq(state.me.streakStartDate, D0, 'streak restarted today after misses');
  eq(state.me.dayNumber, 1, 'back to day 1');
  const byDate = Object.fromEntries(state.me.days.map((d) => [d.date, d]));
  eq(byDate[D(-5)]?.complete, 1, '07-03 finalized complete');
  eq(byDate[D(-5)]?.day_number, 1, '07-03 was day 1');
  eq(byDate[D(-4)]?.complete, 0, '07-04 finalized incomplete (water)');
  eq(byDate[D(-3)]?.complete, 0, '07-05 (no row) finalized incomplete');
  eq(byDate[D(-2)]?.complete, 1, '07-06 finalized complete');
  eq(byDate[D(-2)]?.day_number, 1, '07-06 renumbered day 1 after miss');
  ok(state.me.days.every((d) => d.date === D0 || d.finalized === 1), 'all past days finalized');
  ok(state.events.some((e) => e.type === 'reset' && e.payload.date === D(-4)), 'reset event for 07-04');
}

/* ===== late action: finalized day rejected as late ===== */
{
  const { data } = await api('test-matt', 'POST', '/hard/sync', {
    actions: [act('set_water', { oz: 128 }, D(-4))],
  });
  eq(data.results[0].status, 'late', 'action on finalized day → late');
  const day = data.state.me.days.find((d) => d.date === D(-4));
  eq(day.water_oz, 0, 'late action did not mutate the day');
}

/* ===== rejected: date too far from stamp / future stamp ===== */
{
  const far = { ...act('set_water', { oz: 8 }, D(-7)), localTimestamp: Date.now() };
  const future = act('set_water', { oz: 8 }, D0, Date.now() + 27 * 3600e3);
  const { data } = await api('test-matt', 'POST', '/hard/sync', { actions: [far, future] });
  eq(data.results[0].status, 'rejected', 'date far from stamp → rejected');
  eq(data.results[1].status, 'rejected', 'future stamp → rejected');
}

/* ===== today: water accumulates, task_done event on crossing 128 ===== */
{
  const today = D0;
  const now = Date.now();
  const r1 = await api('test-matt', 'POST', '/hard/sync', {
    actions: [act('add_water', { oz: 100 }, today, now), act('add_water', { oz: 28 }, today, now)],
  });
  eq(r1.data.state.me.today.water_oz, 128, 'water accumulated to 128');
  ok(r1.data.state.events.some((e) => e.type === 'task_done' && e.payload.task === 'water'), 'water task_done event');
}

/* ===== partner view: Ting sees Matt redacted; reactions + poke ===== */
{
  const { data: tingState } = await api('test-ting', 'GET', '/hard/state');
  eq(tingState.partner.email, 'm.polkiewicz@gmail.com', 'partner is matt');
  eq(tingState.partner.today.waterOz, 128, 'partner water visible');
  ok(!('photo_id' in tingState.partner.today), 'partner day is redacted (no raw row)');
  const { data: poke } = await api('test-ting', 'POST', '/hard/sync', {
    actions: [act('poke', {}, D0, Date.now()), act('react', { emoji: '🔥', targetDate: D0, task: 'water' }, D0, Date.now())],
  });
  ok(poke.results.every((r) => r.status === 'applied'), 'poke + reaction applied');
  ok(poke.state.events.some((e) => e.type === 'poke'), 'poke event exists');
  ok(poke.state.events.some((e) => e.type === 'reaction' && e.payload.emoji === '🔥'), 'reaction event exists');
}

/* ===== reward stays sealed ===== */
{
  const { data } = await api('test-matt', 'POST', '/hard/sync', {
    actions: [act('set_reward', { text: 'Trip to Kyoto' }, D0, Date.now())],
  });
  eq(data.state.challenge.rewardSet, true, 'reward set');
  eq(data.state.challenge.rewardText, null, 'reward text sealed until complete');
  ok(!JSON.stringify(data.state.events).includes('Kyoto'), 'reward text not leaked via events');
}

/* ===== WS: ticket + connect + live event on partner sync ===== */
{
  const { data: t } = await api('test-matt', 'POST', '/hard/ws-ticket');
  ok(!!t.ticket, 'got ws ticket');
  const ws = new WebSocket(`ws://localhost:8787/hard/ws?ticket=${t.ticket}`, { headers: { Origin: ORIGIN } });
  const frames = [];
  const opened = new Promise((res, rej) => { ws.on('open', res); ws.on('error', rej); });
  ws.on('message', (m) => frames.push(JSON.parse(m.toString())));
  await opened;
  await new Promise((r) => setTimeout(r, 800)); // initial state frame
  ok(frames.some((f) => f.t === 'state'), 'received initial state frame');
  // partner action while socket open → events + state broadcast
  await api('test-ting', 'POST', '/hard/sync', {
    actions: [act('start_challenge', { startDate: D0, mode: 'solo', timezone: 'Asia/Taipei' }, D0, Date.now())],
  });
  await new Promise((r) => setTimeout(r, 800));
  ok(frames.filter((f) => f.t === 'state').length >= 2, 'received live state broadcast after partner sync');
  ok(frames.some((f) => f.t === 'events' && f.events.some((e) => e.type === 'start')), 'received partner start event');
  // ping/pong keepalive
  ws.send(JSON.stringify({ t: 'ping' }));
  await new Promise((r) => setTimeout(r, 400));
  ok(frames.some((f) => f.t === 'pong'), 'ping → pong');
  // ticket reuse must fail
  const reuse = new WebSocket(`ws://localhost:8787/hard/ws?ticket=${t.ticket}`, { headers: { Origin: ORIGIN } });
  const reuseFailed = await new Promise((res) => { reuse.on('error', () => res(true)); reuse.on('open', () => res(false)); });
  ok(reuseFailed, 'ws ticket is single-use');
  ws.close();
}

/* ===== push endpoints ===== */
{
  const { data: v } = await api('test-matt', 'GET', '/hard/push/vapid');
  ok((v.publicKey ?? '').length > 60, 'vapid public key served');
  const bad = await api('test-matt', 'POST', '/hard/push/subscribe', { endpoint: 'http://not-https', keys: {} });
  eq(bad.status, 400, 'bad subscription rejected');
  const sub = await api('test-matt', 'POST', '/hard/push/subscribe', {
    endpoint: 'https://example.com/push/fake1', keys: { p256dh: 'BFake', auth: 'FakeAuth' },
  });
  eq(sub.status, 200, 'subscription stored');
  const test = await api('test-matt', 'POST', '/hard/push/test');
  eq(test.status, 200, 'push test endpoint survives a bogus subscription');
  const del = await api('test-matt', 'DELETE', '/hard/push/subscribe', { endpoint: 'https://example.com/push/fake1' });
  eq(del.status, 200, 'unsubscribe ok');
}

/* ===== cron: reminder exactly-once ===== */
{
  await api('test-matt', 'POST', '/hard/sync', {
    actions: [act('set_settings', { prefs: { reminderTimes: ['00:01'], bedtimeNudgeMin: 60 } }, D0, Date.now())],
  });
  const cron = () => fetch(API + '/__scheduled?cron=*%2F15+*+*+*+*').then((r) => r.status);
  eq(await cron(), 200, 'cron tick 1 ok');
  eq(await cron(), 200, 'cron tick 2 ok');
  // Two ticks must both succeed; the exactly-once guarantee itself is the
  // hard_notif_log PK + INSERT OR IGNORE (unit-verifiable only via D1 access,
  // which this HTTP-level suite doesn't have).
}

/* ===== history endpoint ===== */
{
  const { data } = await api('test-matt', 'GET', `/hard/history?from=${D(-10)}&to=${D(1)}`);
  ok(data.me.length >= 5, 'history has my rows');
  ok(data.partner.every((r) => Object.keys(r).sort().join(',') === 'complete,date,finalized'), 'partner history redacted');
}

/* ===== measurements: merge, validation, partner privacy ===== */
{
  const today = D0;
  // weight only, then fat only — must merge into one row
  const r1 = await api('test-matt', 'POST', '/hard/sync', {
    actions: [act('log_measurement', { weightKg: 82.5 }, today, Date.now())],
  });
  const r2 = await api('test-matt', 'POST', '/hard/sync', {
    actions: [act('log_measurement', { fatPct: 18.2 }, today, Date.now())],
  });
  const m = r2.data.state.me.measurements.find((x) => x.date === today);
  eq(m?.weight_kg, 82.5, 'weight persisted');
  eq(m?.fat_pct, 18.2, 'fat merged onto same row without erasing weight');
  // re-weigh updates
  const r3 = await api('test-matt', 'POST', '/hard/sync', {
    actions: [act('log_measurement', { weightKg: 82.1 }, today, Date.now())],
  });
  const m3 = r3.data.state.me.measurements.find((x) => x.date === today);
  eq(m3?.weight_kg, 82.1, 're-weigh updates the day');
  eq(m3?.fat_pct, 18.2, 're-weigh keeps fat %');
  // validation
  const bad = await api('test-matt', 'POST', '/hard/sync', {
    actions: [act('log_measurement', { weightKg: 999 }, today, Date.now()), act('log_measurement', {}, today, Date.now())],
  });
  eq(bad.data.results[0].status, 'rejected', 'absurd weight rejected');
  eq(bad.data.results[1].status, 'rejected', 'empty measurement rejected');
  // privacy: partner sees nothing until Matt opts in
  const ting1 = await api('test-ting', 'GET', '/hard/state');
  eq(ting1.data.partner.measurements, null, 'measurements private by default');
  await api('test-matt', 'POST', '/hard/sync', {
    actions: [act('set_settings', { prefs: { shareMeasurements: true } }, today, Date.now())],
  });
  const ting2 = await api('test-ting', 'GET', '/hard/state');
  ok(Array.isArray(ting2.data.partner.measurements) && ting2.data.partner.measurements.some((x) => x.weight_kg === 82.1),
    'shared measurements visible to partner after opt-in');
}

/* ===== concurrency: same actionId raced in parallel → applied exactly once ===== */
{
  const todayNY = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  const before = (await api('test-matt', 'GET', '/hard/state')).data.me.today.water_oz;
  const a = act('add_water', { oz: 4 }, todayNY, Date.now());
  const [r1, r2] = await Promise.all([
    api('test-matt', 'POST', '/hard/sync', { actions: [a] }),
    api('test-matt', 'POST', '/hard/sync', { actions: [a] }),
  ]);
  const statuses = [r1.data.results[0].status, r2.data.results[0].status].sort();
  eq(statuses.join('/'), 'applied/duplicate', 'raced identical action: exactly one applied');
  const after = (await api('test-matt', 'GET', '/hard/state')).data.me.today.water_oz;
  eq(after, before + 4, 'raced water delta counted exactly once');
}

/* ===== concurrency: finalize raced against apply/state → no duplicate reset events ===== */
{
  await Promise.all([
    api('test-matt', 'GET', '/hard/state'),
    api('test-ting', 'GET', '/hard/state'),
    api('test-matt', 'GET', '/hard/state'),
    api('test-ting', 'GET', '/hard/state'),
  ]);
  const { data } = await api('test-matt', 'GET', '/hard/state');
  const resets = data.events.filter((e) => e.type === 'reset');
  const keys = resets.map((e) => `${e.email}|${e.payload.date ?? 'partner'}|${e.payload.causedByPartner ?? false}`);
  eq(new Set(keys).size, keys.length, 'no duplicate reset events after racing finalizes');
}

/* ===== team mode: BOTH partners miss in the same pass → streaks reconciled to today ===== */
{
  const todayOf = (tz) => new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  const back = (date, n) => new Date(Date.parse(date + 'T12:00:00Z') - n * 86400000).toISOString().slice(0, 10);
  const now = Date.now();
  const mToday = todayOf(TZ), tToday = todayOf('Asia/Taipei');
  // both restart the challenge 3 days in the past with no logging → both have misses
  await api('test-matt', 'POST', '/hard/sync', {
    actions: [
      { actionId: uuid(), type: 'start_challenge', payload: { startDate: back(mToday, 3), mode: 'team', timezone: TZ }, date: mToday, localTimestamp: now, timezone: TZ },
      { actionId: uuid(), type: 'set_settings', payload: { graceMinutes: 0 }, date: mToday, localTimestamp: now, timezone: TZ },
    ],
  });
  await api('test-ting', 'POST', '/hard/sync', {
    actions: [
      { actionId: uuid(), type: 'start_challenge', payload: { startDate: back(tToday, 3), timezone: 'Asia/Taipei' }, date: tToday, localTimestamp: now, timezone: 'Asia/Taipei' },
      { actionId: uuid(), type: 'set_settings', payload: { graceMinutes: 0 }, date: tToday, localTimestamp: now, timezone: 'Asia/Taipei' },
    ],
  });
  // lazy finalize on the next reads
  const m = (await api('test-matt', 'GET', '/hard/state')).data;
  const t = (await api('test-ting', 'GET', '/hard/state')).data;
  eq(m.me.streakStartDate, todayOf(TZ), 'matt reconciled to his local today');
  eq(t.me.streakStartDate, todayOf('Asia/Taipei'), 'ting reconciled to her local today');
  eq(m.me.dayNumber, 1, 'matt back at day 1');
  eq(t.me.dayNumber, 1, 'ting back at day 1');
}

console.log(`hard.integration: ${pass} passed, ${fail} failed`);
if (fail) { for (const f of failures) console.log('  FAIL:', f); process.exit(1); }
