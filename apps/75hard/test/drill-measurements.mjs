// Scale measurements drill: entry via the Today inputs (lb→kg round-trip),
// client-side sanity bounds, trend charts + crosshair tooltip, unit switch,
// and partner privacy opt-in. Requires an active challenge for test-matt.
import { connect, sleep, report, API_URL } from './cdp-lib.mjs';

const c = await connect();
await c.bootAs('test-matt', 'm.polkiewicz@gmail.com');
const r = {};

// 1. log via the actual Today inputs (lb entry → kg storage → lb display)
r.viaInput = await c.evl(`(async () => {
  const w = document.querySelector('[data-change=measWeight]');
  w.value = '181.5';
  w.dispatchEvent(new Event('change', { bubbles: true }));
  const f = document.querySelector('[data-change=measFat]');
  f.value = '18.2';
  f.dispatchEvent(new Event('change', { bubbles: true }));
  await new Promise((x) => setTimeout(x, 2200));
  const m = state.server.me.measurements.find((x) => x.date === state.ui.todayDate);
  return m?.weight_kg === 82.33 && m?.fat_pct === 18.2
    && document.querySelector('[data-change=measWeight]').value === '181.5';
})()`);

// 2. absurd entry blocked client-side
r.absurdBlocked = await c.evl(`(async () => {
  const w = document.querySelector('[data-change=measWeight]');
  w.value = '9000';
  w.dispatchEvent(new Event('change', { bubbles: true }));
  await new Promise((x) => setTimeout(x, 300));
  return state.queue.every((a) => a.type !== 'log_measurement' || (a.payload.weightKg ?? 0) < 300);
})()`);

// 3. seed a descending two-week history through the real dispatch path
r.seeded = await c.evl(`(async () => {
  const today = state.ui.todayDate;
  for (let i = 14; i >= 1; i--) {
    const date = addDays(today, -i);
    window.__forceNow = dateToUTC(date) + 18 * 3600e3;
    await dispatch('log_measurement', { weightKg: 84.5 - (14 - i) * 0.18, fatPct: 20.5 - (14 - i) * 0.12 }, { date });
  }
  window.__forceNow = null;
  await new Promise((x) => setTimeout(x, 2500));
  return Object.keys(state.view.measurements).length >= 15;
})()`);

// 4. trend charts + crosshair tooltip
await c.evl(`location.hash = '#/history'; 'ok'`);
await sleep(1000);
r.twoCharts = await c.evl(`document.querySelectorAll('svg.trend').length === 2`);
r.endLabel = await c.evl(`!!document.querySelector('#tw text[font-weight="700"]')?.textContent`);
r.tooltip = await c.evl(`(() => {
  const svg = document.querySelector('#tw');
  const b = svg.getBoundingClientRect();
  svg.dispatchEvent(new PointerEvent('pointermove', { clientX: b.left + b.width * 0.4, clientY: b.top + 20, bubbles: true }));
  return document.querySelector('#charttip').style.display === 'block';
})()`);
await c.shot('drill-meas-trends.png');

// 5. unit switch converts the entry field
await c.evl(`location.hash = '#/settings'; 'ok'`); await sleep(500);
await c.evl(`const s = document.querySelector('[data-change=unitsSel]'); s.value = 'kg'; s.dispatchEvent(new Event('change', { bubbles: true })); 'ok'`);
await sleep(1200);
await c.evl(`location.hash = '#/today'; 'ok'`);
await sleep(500); // hashchange → renderToday is async
r.kgConversion = await c.evl(`document.querySelector('[data-change=measWeight]').value === '82.3'`);

// 6. partner privacy: hidden until opt-in
await c.evl(`(async () => { const p = clone(state.view.me.prefs); p.shareMeasurements = false; await dispatch('set_settings', { prefs: p }); await new Promise((x) => setTimeout(x, 1800)); })()`);
const ting = (t) => fetch(`${API_URL}/hard/state`, { headers: { Authorization: 'Bearer test-ting', Origin: 'http://localhost:8000' } }).then((x) => x.json()).then(t);
r.privateByDefault = await ting((st) => st.partner.measurements === null);
await c.evl(`(async () => { const p = clone(state.view.me.prefs); p.shareMeasurements = true; await dispatch('set_settings', { prefs: p }); await new Promise((x) => setTimeout(x, 1800)); })()`);
r.sharedAfterOptIn = await ting((st) => Array.isArray(st.partner.measurements) && st.partner.measurements.length >= 15);

await c.close();
report('drill-measurements', r, c.errors);
