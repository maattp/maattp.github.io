// Core app drill: optimistic dispatch → sync drain, offline queue + offline
// reboot, duplicate protection, partner/history/settings screens, and the
// day-rollover reset takeover (via the __dbg.forceNow hook).
import { connect, sleep, report } from './cdp-lib.mjs';

const c = await connect();
await c.bootAs('test-matt', 'm.polkiewicz@gmail.com');
const r = {};

// self-seed: ensure an active challenge and a materialized partner row
// (fresh DB → skip the wizard; ting's row appears on her first /state)
await c.evl(`(async () => {
  document.querySelector('#ob').classList.remove('open');
  if (!state.view.me.started) {
    await dispatch('start_challenge', { startDate: state.ui.todayDate, mode: 'solo', timezone: deviceTZ() });
    await new Promise((x) => setTimeout(x, 2200));
  }
  await fetch(localStorage.getItem('hard75_api') + '/hard/state', { headers: { Authorization: 'Bearer test-ting' } });
  await syncNow('drill');
  render();
  return 'ok';
})()`);

// 1. optimistic dispatch + sync drain (dispatch is async — settle, then assert the flip)
const dietBefore = await c.evl(`today().diet`);
await c.evl(`ACTIONS.dietToggle(); 'ok'`);
await sleep(400);
r.dietOptimistic = (await c.evl(`today().diet`)) !== dietBefore;
r.queueRightAfter = await c.evl(`state.queue.length === 1`);
await sleep(2500);
r.queueAfterSync = await c.evl(`state.queue.length === 0`);
r.dietOnServer = (await c.evl(`state.server.me.today.diet`)) !== dietBefore;

// 2. offline: queue accumulates, pill flips, reboot restores from IDB
await c.send('Network.enable');
await c.send('Network.emulateNetworkConditions', { offline: true, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
await sleep(300);
const waterBefore = await c.evl(`today().water_oz`);
await c.evl(`ACTIONS.wadd('8'); ACTIONS.wadd('16'); 'ok'`);
await sleep(1500);
r.queueOffline = await c.evl(`state.queue.length === 2`);
r.waterOptimistic = (await c.evl(`today().water_oz`)) === waterBefore + 24;
r.pillOffline = await c.evl(`document.querySelector('#synctext').textContent.startsWith('Offline')`);
await c.send('Page.reload');
await sleep(2500);
r.offlineRebootQueue = await c.evl(`state.queue.length === 2`);
r.offlineRebootWater = (await c.evl(`today().water_oz`)) === waterBefore + 24;
await c.send('Network.emulateNetworkConditions', { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
await c.evl(`window.dispatchEvent(new Event('online')); 'ok'`);
await sleep(3000);
r.queueDrained = await c.evl(`state.queue.length === 0`);
r.waterOnServer = (await c.evl(`state.server.me.today.water_oz`)) === waterBefore + 24;

// 3. duplicate protection via direct replay
r.dupDrill = await c.evl(`(async () => {
  const a = { actionId: 'dup-' + Date.now(), type: 'add_water', payload: { oz: 4 }, date: state.ui.todayDate, localTimestamp: Date.now(), timezone: deviceTZ() };
  const post = () => apiFetch('/hard/sync', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ actions: [a] }) }).then((x) => x.json());
  const r1 = await post(); const r2 = await post();
  return r1.results[0].status === 'applied' && r2.results[0].status === 'duplicate';
})()`);

// 4. screens render
await c.evl(`location.hash = '#/partner'; 'ok'`); await sleep(800);
r.partnerRows = await c.evl(`document.querySelectorAll('.prow').length >= 6`);
await c.shot('drill-app-partner.png');
await c.evl(`location.hash = '#/history'; 'ok'`); await sleep(1200);
r.historyCells = await c.evl(`document.querySelectorAll('#calgrid .cday').length >= 1`);
await c.evl(`location.hash = '#/settings'; 'ok'`); await sleep(600);
r.settingsRows = await c.evl(`document.querySelectorAll('.srow').length >= 15`);

// 5. rollover → reset takeover (today is incomplete)
await c.evl(`location.hash = '#/today'; 'ok'`); await sleep(400);
r.rollover = await c.evl(`(() => {
  __dbg.forceNow(Date.now() + 24 * 3600 * 1000);
  const open = document.querySelector('#resetov').classList.contains('open');
  window.__forceNow = null; state.ui.resetShowing = false;
  document.querySelector('#resetov').classList.remove('open');
  __dbg.checkRollover();
  return open;
})()`);
await c.shot('drill-app-today.png');

await c.close();
report('drill-app', r, c.errors);
