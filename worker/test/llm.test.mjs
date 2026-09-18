/* Node test suite for the LLM route's free-model gate and request rebuilding.
 * Run: node --experimental-strip-types worker/test/llm.test.mjs               */
import { freeModels, isZeroPrice, parseChat, parseConv, CONV_ID_RE } from '../src/llm.ts';

let pass = 0, fail = 0; const failures = [];
const ok = (cond, msg) => { if (cond) pass++; else { fail++; failures.push(msg); } };

// --- free-model gate: the "never spend credits" rule ---
const model = (over) => ({
  id: 'x/free-one:free', name: 'X: Free One (free)', context_length: 262144, created: 100,
  pricing: { prompt: '0', completion: '0' },
  architecture: { input_modalities: ['text', 'image'], output_modalities: ['text'] },
  supported_parameters: ['max_tokens', 'reasoning'],
  ...over,
});
const free = freeModels([
  model(),
  model({ id: 'paid/one', pricing: { prompt: '0.000001', completion: '0.000002' } }),
  model({ id: 'paid/completion', pricing: { prompt: '0', completion: '0.0000001' } }),
  model({ id: 'paid/per-image', pricing: { prompt: '0', completion: '0', image: '0.04' } }),
  model({ id: 'music/gen', architecture: { input_modalities: ['text'], output_modalities: ['text', 'audio'] } }),
  model({ id: 'no/pricing', pricing: undefined }),
  model({ id: 'half/pricing', pricing: { prompt: '0' } }),
  model({ id: 'weird/pricing', pricing: { prompt: '0', completion: '0', tiers: {} } }),
  model({ id: 'blank/pricing', pricing: { prompt: '', completion: '0' } }),
  model({ id: 'spaces/pricing', pricing: { prompt: '0', completion: '   ' } }),
  model({ id: 'null/pricing', pricing: { prompt: '0', completion: '0', image: null } }),
  model({ id: 'newer/text:free', name: 'Newer', created: 200, architecture: { input_modalities: ['text'], output_modalities: ['text'] }, supported_parameters: [] }),
  { name: 'no id', pricing: { prompt: '0', completion: '0' } },
]);
ok(free.map((m) => m.id).join() === 'newer/text:free,x/free-one:free', 'only zero-priced text models survive, newest first: ' + free.map((m) => m.id).join());
ok(free[1].name === 'X: Free One', '"(free)" suffix stripped from the display name');
ok(free[1].vision && !free[0].vision, 'vision from input modalities');
ok(free[1].reasoning && !free[0].reasoning, 'reasoning from supported parameters');
ok(free[1].context === 262144, 'context length carried');
ok(freeModels([]).length === 0, 'empty catalogue -> no models');

// --- only a literal zero is free (Number('') === 0 must not leak through) ---
for (const p of ['0', '0.0', '0.000000', ' 0 ', 0]) ok(isZeroPrice(p), `zero price accepted: ${JSON.stringify(p)}`);
for (const p of ['', '   ', '0.000001', '-0', '0x0', '0e5', 'free', null, undefined, false, {}, [], NaN, 1e-9])
  ok(!isZeroPrice(p), `non-zero or malformed price rejected: ${String(JSON.stringify(p))}`);

// --- chat request rebuilding ---
const img = 'data:image/jpeg;base64,/9j/4AAQ';
const req = parseChat({
  model: 'x/free-one:free',
  tools: [{ type: 'function' }], provider: { max_price: 99 }, stream: false,
  messages: [
    { role: 'system', content: 'be brief', name: 'sneaky' },
    { role: 'user', content: [{ type: 'text', text: 'what is this?' }, { type: 'image_url', image_url: { url: img, detail: 'high' } }] },
    { role: 'assistant', content: 'a cat' },
    { role: 'user', content: 'thanks' },
  ],
});
ok(typeof req === 'object', 'valid request parses');
ok(Object.keys(req).join() === 'model,messages', 'unknown top-level fields (tools, provider, stream) dropped');
ok(Object.keys(req.messages[0]).join() === 'role,content', 'unknown message fields dropped');
ok(req.messages[1].content[1].image_url.url === img && !('detail' in req.messages[1].content[1].image_url), 'image part rebuilt from url only');
ok(parseChat({ model: 'm', messages: [{ role: 'user', content: [{ type: 'image_url', image_url: { url: 'https://evil.example/x.png' } }] }] }) === 'bad content part', 'remote image URLs rejected');
ok(parseChat({ model: 'm', messages: [{ role: 'user', content: [{ type: 'image_url', image_url: { url: 'data:text/html;base64,PGI+' } }] }] }) === 'bad content part', 'non-image data URLs rejected');
ok(parseChat({ model: 'm', messages: [{ role: 'user', content: 'hi' }, { role: 'assistant', content: 'yo' }] }) === 'last message must be from the user', 'must end on a user turn');
ok(parseChat({ model: 'm', messages: [{ role: 'assistant', content: [{ type: 'text', text: 'x' }] }, { role: 'user', content: 'hi' }] }) === 'bad content', 'only user turns may carry parts');
ok(parseChat({ model: 'm', messages: [{ role: 'tool', content: 'x' }] }) === 'bad role', 'tool role rejected');
ok(parseChat({ model: 'm', messages: [] }) === 'bad messages', 'empty messages rejected');
ok(parseChat({ model: '', messages: [{ role: 'user', content: 'hi' }] }) === 'model required', 'model required');
ok(parseChat(null) === 'model required', 'null body rejected');
ok(parseChat({ model: 'm', messages: [{ role: 'user', content: [] }] }) === 'bad content', 'empty parts rejected');

// --- conversation parsing (feeds KV metadata, capped at 1024 bytes) ---
const metaBytes = (c) => new TextEncoder().encode(JSON.stringify({ title: c.title, updatedAt: Date.now(), model: c.model })).length;
const conv = parseConv(JSON.stringify({ title: '  ' + '漢'.repeat(300), model: 'x/free-one:free', createdAt: 5, messages: [{ any: 'thing' }] }));
ok(conv.title === '漢'.repeat(100) && conv.model === 'x/free-one:free' && conv.createdAt === 5, 'title truncated to 100 chars, model id and createdAt kept');
ok(parseConv(JSON.stringify({ title: '😀'.repeat(150), messages: [] })).title === '😀'.repeat(100), 'emoji title cut by code point, never mid-surrogate');
ok(parseConv(JSON.stringify({ model: 'm'.repeat(150), messages: [] })).model.length === 150, '150-char model id kept');
ok(parseConv(JSON.stringify({ model: 'm'.repeat(151), messages: [] })).model === '', 'over-long model id dropped, not truncated into a wrong id');
ok(parseConv(JSON.stringify({ model: '~anthropic/claude-sonnet-latest', messages: [] })).model === '~anthropic/claude-sonnet-latest', 'tilde-prefixed model id kept');
ok(parseConv(JSON.stringify({ model: 'a b"c', messages: [] })).model === '', 'model with spaces/quotes dropped');
// Worst cases for the KV metadata cap: escaped lone surrogates (6 bytes each) in the title, a max-length model id.
const worst = parseConv(JSON.stringify({ title: '\ud800'.repeat(400), model: '~'.repeat(150), messages: [] }));
ok(worst.title.length === 100 && metaBytes(worst) < 1024, `lone-surrogate title + max model fits KV 1024-byte cap (${metaBytes(worst)} bytes)`);
ok(metaBytes(parseConv(JSON.stringify({ title: '\ud800'.repeat(400), model: '\udfff'.repeat(400), messages: [] }))) < 1024, 'lone-surrogate model dropped, metadata still fits');
ok(metaBytes(parseConv(JSON.stringify({ title: '😀'.repeat(400), model: 'm'.repeat(150), messages: [] }))) < 1024, 'astral title + max model fits');
ok(parseConv(JSON.stringify({ title: '   ', messages: [] })).title === 'New chat', 'blank title defaults');
ok(parseConv(JSON.stringify({ title: 'x' })) === 'bad conversation', 'messages required');
ok(parseConv('{nope') === 'bad json', 'bad json rejected');
ok(parseConv('null') === 'bad conversation', 'null rejected');

// --- conversation ids: can't escape the email-scoped key prefix ---
ok(CONV_ID_RE.test(crypto.randomUUID()), 'uuid accepted');
ok(!CONV_ID_RE.test('abc:def:ghi'), 'colon rejected');
ok(!CONV_ID_RE.test('../../x/y/z'), 'path chars rejected');
ok(!CONV_ID_RE.test('short'), 'too short rejected');

console.log(`llm: ${pass} passed, ${fail} failed`);
if (fail) { for (const f of failures) console.log('  FAIL ' + f); process.exit(1); }
