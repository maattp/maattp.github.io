/* Integration drills for the chat backend against `wrangler dev`.
 * Setup:  npx wrangler kv key put --binding KV "__session:test-matt" "m.polkiewicz@gmail.com" --local
 *         npx wrangler kv key put --binding KV "__session:test-ting" "ting520143@gmail.com" --local
 *         .dev.vars needs CHAT_CLAUDE_TOKEN, RING_MCP_TOKEN, RING_WS_TOKEN
 *         npx wrangler dev --port 8787
 * Run:    node worker/test/chat.integration.mjs
 * NOTE: mutates local .wrangler D1 state; wipe chat_* tables (or rm -rf
 * .wrangler/state + re-apply schema-chat.sql) to re-run cleanly. */

const API = 'http://localhost:8787';
const MATT = 'test-matt', TING = 'test-ting';
const CLAUDE = process.env.CHAT_CLAUDE_TOKEN ?? 'chat-dev-token-0000000000000000';
let pass = 0, fail = 0; const failures = [];
const ok = (c, m) => { if (c) pass++; else { fail++; failures.push(m); } };
const uuid = () => crypto.randomUUID();
const api = async (token, method, path, body) => {
  const res = await fetch(API + '/chat' + path, {
    method,
    headers: { Authorization: `Bearer ${token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  let json = null; try { json = await res.json(); } catch { /* empty */ }
  return { status: res.status, body: json };
};

// --- identity ---
let r = await api(MATT, 'GET', '/me');
ok(r.body?.sender === 'matt' && r.body.threads.includes('dm'), 'matt resolves with dm');
r = await api(TING, 'GET', '/me');
ok(r.body?.sender === 'tingting' && !r.body.threads.includes('dm'), 'tingting cannot see dm in /me');
r = await api(TING, 'GET', '/dm/messages');
ok(r.status === 404, 'tingting gets 404 (not 403) on dm');
r = await api(MATT, 'POST', '/dm/send', { id: uuid(), body: 'spoof?', sender: 'claude' });
ok(r.body?.message?.sender === 'matt', 'body sender ignored; credential stamps');

// --- idempotency ---
const mid = uuid();
const first = await api(MATT, 'POST', '/dm/send', { id: mid, body: 'once' });
const dup = await api(MATT, 'POST', '/dm/send', { id: mid, body: 'once' });
ok(dup.body?.duplicate === true && dup.body.message.seq === first.body.message.seq, 'idempotent resend returns original seq');

// --- limit clamping (the ?limit=-1 unbounded-read bug) ---
r = await api(MATT, 'GET', '/dm/messages?limit=-1');
ok(r.status === 200 && Array.isArray(r.body.messages), 'limit=-1 does not error...');
r = await api(MATT, 'GET', '/dm/messages?after=0&limit=-1');
ok(r.status === 200, '...and after-mode too');
// prove the clamp with volume: 3 messages, limit=1 pages one at a time
for (let i = 0; i < 3; i++) await api(MATT, 'POST', '/dm/send', { id: uuid(), body: 'filler ' + i });
r = await api(MATT, 'GET', '/dm/messages?after=0&limit=1');
ok(r.body.messages.length + r.body.reactions.length === 1 && r.body.more === true, 'limit=1 pages singly with more=true');

// --- oversized body ---
r = await api(MATT, 'POST', '/dm/send', { id: uuid(), body: 'x'.repeat(9000) });
ok(r.status === 413, 'oversized body rejected 413, not truncated');

// --- reactions: explicit ops, tombstone revive cap ---
const target = (await api(MATT, 'POST', '/group/send', { id: uuid(), body: 'react target' })).body.message;
const react = (emoji, op) => api(MATT, 'POST', '/group/react', { messageId: target.id, emoji, op });
await react('🅰️', 'add'); await react('🅰️', 'remove');
for (const e of ['1️⃣','2️⃣','3️⃣','4️⃣','5️⃣','6️⃣','7️⃣','8️⃣']) await react(e, 'add');
r = await react('🅰️', 'add');
ok(r.status === 409, 'reviving tombstoned 9th emoji hits the cap');
r = await api(MATT, 'POST', '/group/react', { messageId: 'nonexistent', emoji: '👍', op: 'add' });
ok(r.status === 404, 'reacting to a missing message 404s');

// --- push scoping ---
r = await api(MATT, 'POST', '/push/subscribe', { endpoint: 'http://not-https/x', keys: { p256dh: 'a', auth: 'b' } });
ok(r.status === 400, 'non-https push endpoint rejected');
r = await api(CLAUDE, 'POST', '/push/subscribe', { endpoint: 'https://p.example/c', keys: { p256dh: 'a', auth: 'b' } });
ok(r.status === 400, "claude can't subscribe to push");
await api(MATT, 'POST', '/push/subscribe', { endpoint: 'https://p.example/m', keys: { p256dh: 'a', auth: 'b' } });
await api(TING, 'POST', '/push/unsubscribe', { endpoint: 'https://p.example/m' });
// survival proof: matt unsubscribes his own and it's the one that existed
r = await api(MATT, 'POST', '/push/unsubscribe', { endpoint: 'https://p.example/m' });
ok(r.status === 200, 'unsubscribe scoped per-caller (no cross-user delete)');

console.log(`chat.integration: ${pass} passed, ${fail} failed`);
if (fail) { failures.forEach(f => console.log('  FAIL:', f)); process.exit(1); }
