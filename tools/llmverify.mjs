// Headless verification for apps/llm. Needs the static server and a LOCAL
// worker with two seeded sessions and a dummy key:
//
//   python3 -m http.server 8000 &
//   cd worker
//   npx wrangler kv key put --binding KV --local __session:llmverify-matt m.polkiewicz@gmail.com
//   npx wrangler kv key put --binding KV --local __session:llmverify-ting ting520143@gmail.com
//   npx wrangler dev --port 8787 --var OPENROUTER_API_KEY:dummy-local-key &
//   node tools/llmverify.mjs
//
// The worker is real: sessions, the free-model gate (against OpenRouter's live
// catalogue), KV conversations, per-account isolation. Only /llm/chat and
// /llm/usage are mocked inside the page, because the dummy key can't reach
// OpenRouter. Screenshots land in tools/data/llmshots/.
import { spawn } from 'node:child_process';
import { writeFileSync, mkdirSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';

const PORT = 9231;
const ORIGIN = 'http://localhost:8000', WORKER = 'http://localhost:8787';
const APP = `${ORIGIN}/apps/llm/?api=${WORKER}`;
const MATT = 'llmverify-matt', TING = 'llmverify-ting';
const OUT = 'tools/data/llmshots'; mkdirSync(OUT, { recursive: true });
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

let fail = 0;
const check = (ok, msg) => { console.log((ok ? 'ok   ' : 'FAIL ') + msg); if (!ok) fail++; };

/* ---------- worker checks (no browser) ---------- */
const w = (path, session, init = {}) => fetch(WORKER + '/llm' + path, {
  ...init, headers: { Origin: ORIGIN, ...(session ? { Authorization: 'Bearer ' + session } : {}), ...(init.body ? { 'Content-Type': 'application/json' } : {}) },
});
check((await w('/me')).status === 401, 'worker: no session -> 401');
check((await w('/me', 'not-a-session')).status === 401, 'worker: unknown session -> 401');
check((await (await w('/me', MATT)).json()).email === 'm.polkiewicz@gmail.com', 'worker: matt session resolves');
check((await (await w('/me', TING)).json()).email === 'ting520143@gmail.com', 'worker: tingting session resolves (both allowlisted accounts)');
const { models } = await (await w('/models', MATT)).json();
check(models.length > 3, `worker: live free-model list (${models.length} models)`);
const freeId = models[0].id;
const paid = await w('/chat', MATT, { method: 'POST', body: JSON.stringify({ model: 'openai/gpt-4o', messages: [{ role: 'user', content: 'hi' }] }) });
check(paid.status === 400 && (await paid.json()).error === 'not a free model', 'worker: paid model refused before reaching OpenRouter');
const badKey = await w('/chat', MATT, { method: 'POST', body: JSON.stringify({ model: freeId, messages: [{ role: 'user', content: 'hi' }] }) });
const badKeyBody = await badKey.json();
check(badKey.status === 502 && badKeyBody.upstream === 401, `worker: OpenRouter 401 (dummy key) remapped to 502, not 401 (got ${badKey.status})`);
check((await w('/chat', MATT, { method: 'POST', body: '{"model":"x"}' })).status === 400, 'worker: malformed chat body -> 400');
const tingConv = crypto.randomUUID();
check((await w('/convs/' + tingConv, TING, { method: 'PUT', body: JSON.stringify({ title: 'ting only', model: freeId, messages: [{ role: 'user', content: 'x' }] }) })).ok, 'worker: tingting saves a chat');
check((await w('/convs/' + tingConv, MATT)).status === 404, "worker: matt can't read tingting's chat");
check(!(await (await w('/convs', MATT)).json()).convs.some((c) => c.id === tingConv), "worker: tingting's chat absent from matt's list");
check((await w('/convs/bad:id:here', MATT, { method: 'PUT', body: '{"messages":[]}' })).status === 400, 'worker: malformed conversation id rejected');

/* ---------- page mock for /llm/chat and /llm/usage ---------- */
const chunk = (delta, finish) => `data: ${JSON.stringify({ choices: [{ delta, finish_reason: finish ?? null }] })}\n\n`;
const CONTENT = '# Hello\n\nHere is code:\n\n```js\nconsole.log(1)\n```\n\n| a | b |\n|---|---|\n| 1 | 2 |\n\n<img src=x onerror="window.__xss=1"><script>window.__xss=2</script>\n\n[a link](https://example.com)';
const okStream = [': OPENROUTER PROCESSING\n\n', chunk({ reasoning: 'Let me think' }), chunk({ reasoning: ' about it.' })];
const body = chunk({ content: CONTENT });
okStream.push(body.slice(0, 40), body.slice(40)); // a data line split across reads
okStream.push(chunk({ content: '\n\nDone.' }, 'stop'), 'data: [DONE]\n\n');
const SCENARIOS = {
  ok: { chunks: okStream, delay: 150 },
  midstream: { chunks: [chunk({ content: 'Partial answer' }), `data: ${JSON.stringify({ error: { message: 'Provider returned error', code: 502 } })}\n\n`], delay: 30 },
  slow: { chunks: Array.from({ length: 80 }, (_, i) => chunk({ content: `word${i} ` })), delay: 120 },
};
const MOCK = `(() => {
  const SCENARIOS = ${JSON.stringify(SCENARIOS)};
  const real = window.fetch.bind(window), enc = new TextEncoder();
  window.__chatMode = 'ok'; window.__chatBodies = [];
  window.fetch = async (url, init = {}) => {
    const u = String(url);
    if (u.endsWith('/llm/usage')) return new Response(JSON.stringify({ free: { used: 3, limit: 50, remaining: 47 } }), { headers: { 'Content-Type': 'application/json' } });
    if (!u.endsWith('/llm/chat')) return real(url, init);
    window.__chatBodies.push(JSON.parse(init.body));
    if (window.__chatMode === '429') return new Response(JSON.stringify({ error: 'Rate limit exceeded: free-models-per-min' }), { status: 429 });
    const sc = SCENARIOS[window.__chatMode], signal = init.signal;
    return new Response(new ReadableStream({ async start(ctrl) {
      let dead = false;
      signal?.addEventListener('abort', () => { dead = true; ctrl.error(new DOMException('Aborted', 'AbortError')); });
      for (const c of sc.chunks) { await new Promise((r) => setTimeout(r, sc.delay)); if (dead) return; ctrl.enqueue(enc.encode(c)); }
      if (!dead) ctrl.close();
    } }), { headers: { 'Content-Type': 'text/event-stream' } });
  };
})();`;

/* ---------- CDP plumbing ---------- */
const chrome = spawn(CHROME, [`--remote-debugging-port=${PORT}`, '--headless=new', '--window-size=1280,800', '--no-first-run',
  '--user-data-dir=/tmp/llm-verify-profile', 'about:blank'], { stdio: 'ignore' });
async function target() {
  for (let i = 0; i < 60; i++) {
    try { const l = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json(); const p = l.find((t) => t.type === 'page'); if (p) return p; } catch {}
    await sleep(300);
  }
  throw new Error('no CDP target');
}
let id = 0, ws; const pending = new Map(), errors = [];
const send = (method, params = {}) => new Promise((res, rej) => { const i = ++id; pending.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method, params })); });
const ev = async (expression, awaitPromise = false) => {
  const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
  return r.result.value;
};
const waitFor = async (expr, what, ms = 8000) => {
  for (let t = 0; t < ms; t += 100) { try { if (await ev(expr)) return true; } catch {} await sleep(100); }
  check(false, 'timed out waiting for: ' + what); return false;
};
const shot = async (name) => { const r = await send('Page.captureScreenshot', { format: 'png' }); writeFileSync(`${OUT}/${name}.png`, Buffer.from(r.data, 'base64')); };
const nav = async (url) => { await send('Page.navigate', { url }); await sleep(300); await waitFor(`document.readyState === 'complete'`, 'load ' + url); };
const type = (sel, text) => ev(`(() => { const el = document.querySelector(${JSON.stringify(sel)}); el.value = ${JSON.stringify(text)}; el.dispatchEvent(new Event('input', { bubbles: true })); })()`);
const click = (sel) => ev(`document.querySelector(${JSON.stringify(sel)}).click()`);
// Waits on the reply landing rather than on S.streaming flipping true: a 429
// resolves inside one poll interval, so "streaming" is never observable.
const sendMsg = async (text) => {
  const n = await ev('S.conv.messages.length');
  await type('#input', text); await click('#sendbtn');
  await waitFor(`S.conv.messages.length === ${n + 2} && !S.streaming`, 'reply to: ' + text);
};
const ready = async () => waitFor(`!document.querySelector('#app').hidden && S.models.length > 0 && document.querySelector('#who').textContent`, 'app ready');

try {
  const t = await target();
  ws = new WebSocket(t.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.addEventListener('open', res); ws.addEventListener('error', rej); });
  ws.addEventListener('message', (m) => {
    const d = JSON.parse(m.data);
    if (d.id && pending.has(d.id)) { const p = pending.get(d.id); pending.delete(d.id); d.error ? p.rej(new Error(JSON.stringify(d.error))) : p.res(d.result); }
    if (d.method === 'Runtime.exceptionThrown') errors.push(d.params.exceptionDetails.exception?.description || d.params.exceptionDetails.text);
    if (d.method === 'Runtime.consoleAPICalled' && d.params.type === 'error') errors.push(d.params.args.map((a) => a.value ?? a.description).join(' '));
  });
  await send('Page.enable'); await send('Runtime.enable'); await send('Network.enable');
  await send('Network.setBypassServiceWorker', { bypass: true }); // always test the files on disk
  await send('Page.addScriptToEvaluateOnNewDocument', { source: MOCK });

  // Signed out -> sign-in screen
  await nav(`${ORIGIN}/apps/llm/`);
  await ev(`localStorage.clear()`);
  await nav(APP);
  check(await ev(`!document.querySelector('#signin').hidden && document.querySelector('#app').hidden`), 'no session -> sign-in screen');
  await shot('signin');

  // Signed in
  await ev(`localStorage.setItem('llm_session', '${MATT}')`);
  await nav(APP);
  await ready();
  check(await ev(`document.querySelector('#who').textContent`) === 'm.polkiewicz@gmail.com', 'drawer shows the signed-in email');
  check(await ev(`S.models.length`) === models.length, 'app loaded the same free-model list');
  check((await ev(`document.querySelector('#usage').textContent`)).includes('47 of 50'), 'empty state shows free quota');
  await shot('desktop-empty');

  // Model picker
  const vision = models.find((m) => m.vision);
  await click('#modelbtn');
  check(await ev(`document.querySelector('#sheet-models').classList.contains('open')`), 'model sheet opens');
  await type('#modelq', vision.id);
  check(await ev(`[...document.querySelectorAll('#modellist .model')].every((b) => (b.textContent).toLowerCase().includes(${JSON.stringify(vision.id.toLowerCase())}))`), 'model search filters');
  await shot('desktop-models');
  await click('#modellist .model');
  check(await ev(`S.model`) === vision.id && await ev(`localStorage.getItem('llm_model')`) === vision.id, `picked vision model ${vision.id} (persisted)`);
  check(await ev(`!document.querySelector('#sheet-models').classList.contains('open')`), 'model sheet closes on pick');

  // Custom instructions
  await click('#settingsbtn');
  await type('#systeminput', 'Be brief.');
  await click('#savesettings');
  check(await ev(`localStorage.getItem('llm_system')`) === 'Be brief.', 'custom instructions saved');

  // Image attachment + first message
  await ev(`(async () => { const c = document.createElement('canvas'); c.width = c.height = 40; c.getContext('2d').fillRect(0, 0, 20, 20);
    const blob = await new Promise((r) => c.toBlob(r, 'image/png')); await addImages([new File([blob], 'x.png', { type: 'image/png' })]); })()`, true);
  check(await ev(`document.querySelectorAll('#attachments .chip').length`) === 1, 'image attached');
  await type('#input', 'Explain this');
  await click('#sendbtn');
  await waitFor(`!!document.querySelector('#sendbtn.stop')`, 'stop button while streaming');
  await waitFor(`!!document.querySelector('.think')`, 'reasoning shown while streaming');
  await shot('desktop-streaming');
  await waitFor('!S.streaming', 'first reply done');
  const md = `document.querySelector('.msg.ai .md')`;
  check(await ev(`${md}.querySelector('h1')?.textContent`) === 'Hello', 'markdown heading rendered');
  check(await ev(`${md}.querySelector('.codeblock .codebar span')?.textContent`) === 'js', 'code block with language bar');
  check(await ev(`!!${md}.querySelector('.tablewrap table')`), 'table rendered and wrapped');
  check(await ev(`${md}.querySelector('a')?.target`) === '_blank', 'links open in a new tab');
  check(await ev(`window.__xss === undefined && !${md}.querySelector('img, script, [onerror]')`), 'model HTML sanitized (no img/script/onerror)');
  check(await ev(`!document.querySelector('.think').open && document.querySelector('.think summary').textContent === 'Thoughts'`), 'reasoning collapses when done');
  check((await ev(`document.querySelector('.msg.ai').textContent`)).includes('Done.'), 'content split across reads reassembled');
  check(await ev(`document.querySelector('.msg.ai .mlabel').textContent`) === vision.name, 'reply labelled with model name');
  const b0 = await ev(`__chatBodies[0]`);
  check(b0.model === vision.id, 'request names the picked model');
  check(b0.messages.length === 2 && b0.messages[0].role === 'system' && b0.messages[0].content === 'Be brief.', 'custom instructions sent as system message');
  check(Array.isArray(b0.messages[1].content) && b0.messages[1].content.some((p) => p.type === 'image_url' && p.image_url.url.startsWith('data:image/jpeg;base64,')), 'image sent as downscaled JPEG data URL');
  await waitFor(`S.convs.some((c) => c.id === S.conv.id)`, 'chat appears in drawer');
  const convId = await ev('S.conv.id');
  const saved = await (await w('/convs/' + convId, MATT)).json();
  check(saved.title === 'Explain this' && saved.messages.length === 2 && saved.messages[0].images?.length === 1, 'chat saved to KV with title, messages and image');
  await shot('desktop-reply');

  // Regenerate
  await ev(`document.querySelector('.msg.ai .actions [aria-label="Regenerate"]').click()`);
  await waitFor('!!S.streaming', 'regenerate start'); await waitFor('!S.streaming', 'regenerate end');
  check(await ev('S.conv.messages.length') === 2 && await ev('__chatBodies[1].messages.length') === 2, 'regenerate replaces the reply, request has no stale assistant turn');

  // Edit the user message
  await ev(`document.querySelector('.msg.user [aria-label="Edit"]').click()`);
  check(await ev(`!!document.querySelector('.editbox')`), 'edit box opens');
  await type('.editbox', 'Different question');
  await ev(`document.querySelector('.editbar .primary').click()`);
  await waitFor('!!S.streaming', 'edit resend start'); await waitFor('!S.streaming', 'edit resend end');
  check(await ev(`S.conv.messages.length === 2 && S.conv.messages[0].content === 'Different question' && S.conv.messages[0].images.length === 1`), 'edit truncates and resends, keeping the image');
  check(await ev(`S.conv.title`) === 'Explain this', 'editing the first message keeps the title');

  // Follow-up
  await sendMsg('Follow up');
  check((await ev(`__chatBodies.at(-1).messages.map((m) => m.role).join()`)) === 'system,user,assistant,user', 'follow-up carries the history');

  // 429 -> error card -> retry
  await ev(`window.__chatMode = '429'`);
  await sendMsg('Again');
  check((await ev(`document.querySelector('.msg.ai:last-child .error')?.textContent || ''`)).includes('20 requests a minute'), '429 shows a rate-limit explanation');
  check(await ev(`!!document.querySelector('.msg.ai:last-child [aria-label="Retry"]')`), 'error reply offers Retry');
  await shot('desktop-error');
  await ev(`window.__chatMode = 'ok'`);
  await ev(`document.querySelector('.msg.ai:last-child [aria-label="Retry"]').click()`);
  await waitFor('!!S.streaming', 'retry start'); await waitFor('!S.streaming', 'retry end');
  check(await ev(`!document.querySelector('.msg.ai:last-child .error') && S.conv.messages.length === 6`), 'retry replaces the error with a reply');
  check((await ev(`__chatBodies.at(-1).messages.map((m) => m.role).join()`)) === 'system,user,assistant,user,assistant,user', 'retry request ends on the user turn');

  // Error mid-stream keeps the partial answer
  await ev(`window.__chatMode = 'midstream'`);
  await sendMsg('Break');
  check((await ev(`document.querySelector('.msg.ai:last-child').textContent`)).includes('Partial answer') && (await ev(`document.querySelector('.msg.ai:last-child .error')?.textContent`)) === 'Provider returned error', 'mid-stream error keeps partial text and shows the error');

  // Stop
  await ev(`window.__chatMode = 'slow'`);
  await type('#input', 'Long one');
  await click('#sendbtn');
  await waitFor(`S.streaming && S.streaming.msg.content.length > 10`, 'slow stream producing');
  await click('#sendbtn');
  await waitFor('!S.streaming', 'stopped');
  check(await ev(`S.conv.messages.at(-1).stopped === true && document.querySelector('.msg.ai:last-child .note')?.textContent === 'Stopped.' && S.conv.messages.at(-1).content.length > 10`), 'stop keeps partial text, marks Stopped');
  await ev(`window.__chatMode = 'ok'`);
  await waitFor(`S.convs.find((c) => c.id === '${convId}')?.updatedAt >= S.conv.updatedAt`, 'save after stop');
  await sleep(300);
  check((await (await w('/convs/' + convId, MATT)).json()).messages.length === 10, 'stopped chat saved with all 10 messages');

  // Dark mode
  await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'dark' }] });
  await sleep(200); await shot('desktop-dark');
  await send('Emulation.setEmulatedMedia', { features: [] });

  // New chat + search + reload + reopen from the server
  await click('#newbtn');
  check(await ev(`!document.querySelector('#empty').hidden && S.conv.messages.length === 0`), 'new chat shows empty state');
  await type('#convq', 'Explain');
  check(await ev(`[...document.querySelectorAll('#convlist .ctitle')].map((b) => b.textContent).includes('Explain this') && [...document.querySelectorAll('#convlist .ctitle')].every((b) => b.textContent.includes('Explain'))`), 'chat search filters titles');
  await type('#convq', '');
  await nav(APP);
  await ready();
  await waitFor(`S.convs.some((c) => c.id === '${convId}')`, 'list loads after reload');
  await ev(`[...document.querySelectorAll('#convlist .ctitle')].find((b) => b.textContent === 'Explain this').click()`);
  await waitFor(`S.conv.id === '${convId}'`, 'open chat from drawer');
  check(await ev(`S.conv.messages.length === 10 && document.querySelectorAll('#thread .msg').length === 10`), 'reopened chat renders all messages from KV');
  check(await ev(`S.model`) === vision.id, 'opening a chat selects its model');

  // Rename
  await ev(`document.querySelector('#convlist .conv.on .cmore').click()`);
  await type('#renameinput', 'Renamed chat');
  await click('#renamebtn');
  await waitFor(`S.convs.find((c) => c.id === '${convId}')?.title === 'Renamed chat'`, 'rename reflected in list');
  await sleep(300);
  check((await (await w('/convs/' + convId, MATT)).json()).title === 'Renamed chat', 'rename saved to KV');

  // Phone
  await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 3, mobile: true });
  await sleep(400);
  check(await ev(`document.documentElement.scrollWidth <= innerWidth && document.querySelector('#thread').scrollWidth <= innerWidth`), 'phone: no horizontal overflow');
  check(await ev(`document.querySelector('#composer').getBoundingClientRect().bottom <= innerHeight + 1`), 'phone: composer on screen');
  check(await ev(`document.querySelector('#drawer').getBoundingClientRect().right <= 0`), 'phone: drawer hidden by default');
  await shot('phone-chat');
  await click('#menubtn');
  await sleep(350);
  check(await ev(`document.querySelector('#drawer').getBoundingClientRect().left >= 0`), 'phone: menu opens drawer');
  await shot('phone-drawer');
  await click('#scrim');
  await sleep(350);
  await click('#modelbtn');
  await sleep(100); await shot('phone-models');
  await ev('closeSheets()');
  await click('#newbtn');
  await shot('phone-empty');
  await send('Emulation.clearDeviceMetricsOverride');

  // Delete (two taps)
  await ev(`[...document.querySelectorAll('#convlist .conv')].find((c) => c.textContent.includes('Renamed chat')).querySelector('.cmore').click()`);
  await click('#delbtn');
  check(await ev(`document.querySelector('#sheet-conv').classList.contains('open') && document.querySelector('#delbtn').textContent === 'Tap again to delete'`), 'delete needs a second tap');
  await click('#delbtn');
  await waitFor(`!S.convs.some((c) => c.id === '${convId}')`, 'deleted chat leaves the list');
  await sleep(300);
  check((await w('/convs/' + convId, MATT)).status === 404, 'delete removed it from KV');

  // Tingting sees only her own
  await ev(`localStorage.setItem('llm_session', '${TING}')`);
  await nav(APP);
  await ready();
  await waitFor(`S.convs.length > 0`, 'tingting list loads');
  check(await ev(`document.querySelector('#who').textContent`) === 'ting520143@gmail.com', 'tingting signed in');
  check(await ev(`S.convs.some((c) => c.id === '${tingConv}') && S.convs.every((c) => c.title !== 'Renamed chat')`), "tingting's drawer lists her chat only");
  await w('/convs/' + tingConv, TING, { method: 'DELETE' });

  // Dead session -> signed out
  await ev(`localStorage.setItem('llm_session', 'revoked-session')`);
  await nav(APP);
  await waitFor(`!document.querySelector('#signin').hidden`, 'revoked session returns to sign-in');
  check(await ev(`localStorage.getItem('llm_session')`) === null, 'revoked session cleared');

  const real = errors.filter((e) => !/accounts\.google\.com|GSI_LOGGER|FedCM|401/.test(e));
  check(real.length === 0, 'no page errors' + (real.length ? ': ' + real.join(' | ') : ''));
} catch (e) {
  check(false, 'harness: ' + e.message);
} finally {
  ws?.close(); chrome.kill();
}
console.log(fail ? `\n${fail} FAILED` : '\nall checks passed');
process.exit(fail ? 1 : 0);
