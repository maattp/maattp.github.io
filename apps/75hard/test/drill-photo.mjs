// Photo pipeline drill: file input → Day-N compositor → local save → upload →
// server day attach → thumb round-trip from R2. Requires an active challenge
// for test-matt (run drill-app.mjs or drill-onboarding.mjs first).
import { connect, sleep, report } from './cdp-lib.mjs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const c = await connect();
await c.bootAs('test-matt', 'm.polkiewicz@gmail.com');

const r = {};
const doc = await c.send('DOM.getDocument');
const input = await c.send('DOM.querySelector', { nodeId: doc.root.nodeId, selector: '#camfile' });
await c.send('DOM.setFileInputFiles', { nodeId: input.nodeId, files: [join(here, '..', 'icon-512.png')] });
await c.evl(`document.querySelector('#camfile').dispatchEvent(new Event('change', { bubbles: true })); 'ok'`);
await sleep(1800);
r.confirmOpen = await c.evl(`document.querySelector('#pconfirm').classList.contains('open')`);
await c.shot('drill-photo-confirm.png');
await c.evl(`document.querySelector('#pc-share').checked = true; 'ok'`);
await c.evl(`ACTIONS.pcSave(); 'ok'`);
await sleep(3500);
r.attachedLocally = await c.evl(`!!today().photo_id`);
r.attachedOnServer = await c.evl(`state.server.me.today.photo_id === today().photo_id`);
r.uploadedFlag = await c.evl(`idbAll('photos').then((a) => a.every((p) => p.uploaded === true))`);
r.sharedOnServer = await c.evl(`state.server.me.photosByDate[state.ui.todayDate]?.shared === 1`);
r.queueDrained = await c.evl(`state.queue.length === 0`);
r.thumbRoundTrip = await c.evl(`(async () => {
  const pid = state.server.me.today.photo_id;
  const res = await apiFetch('/hard/photos/' + pid + '/thumb');
  const b = await res.blob();
  return res.status === 200 && b.type === 'image/jpeg' && b.size > 500;
})()`);

await c.close();
report('drill-photo', r, c.errors);
