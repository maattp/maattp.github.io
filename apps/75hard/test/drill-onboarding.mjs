// Onboarding wizard drill. Run against a WIPED backend (see README) — the
// wizard only opens for a user with no active challenge. Wipes the local
// hard75 IndexedDB itself.
import { connect, sleep, report } from './cdp-lib.mjs';

const c = await connect();
await c.bootAs('test-ting', 'ting520143@gmail.com');
await c.evl(`(async () => { indexedDB.deleteDatabase('hard75'); await new Promise((x) => setTimeout(x, 400)); return 'ok'; })()`);
await c.send('Page.reload');
await sleep(3500);

const r = {};
r.wizardOpen = await c.evl(`document.querySelector('#ob').classList.contains('open')`);
await c.evl(`ACTIONS.obNext(); 'ok'`); await sleep(200); // install → name
await c.evl(`document.querySelector('#ob-name').value = 'Tingting'; ACTIONS.obNext(); 'ok'`); await sleep(200); // name → mode
await c.evl(`ACTIONS.obMode('team'); ACTIONS.obNext(); 'ok'`); await sleep(200); // mode → reward
await c.evl(`document.querySelector('#ob-reward').value = 'Weekend trip 🎁'; ACTIONS.obNext(); 'ok'`); await sleep(200);
await c.shot('drill-ob-start.png');
await c.evl(`ACTIONS.obFinish('today'); 'ok'`);
await sleep(3000);
r.started = await c.evl(`state.view.me.started === true`);
r.day1 = await c.evl(`state.view.me.dayNumber === 1`);
r.teamMode = await c.evl(`state.view.challenge.mode === 'team'`);
r.nameOnServer = await c.evl(`state.server?.me?.displayName === 'Tingting'`);
r.rewardSetOnServer = await c.evl(`state.server?.challenge?.rewardSet === true`);
r.rewardSealed = await c.evl(`state.server?.challenge?.rewardText === null`);
r.queueDrained = await c.evl(`state.queue.length === 0`);
await c.shot('drill-ob-done.png');

await c.close();
report('drill-onboarding', r, c.errors);
