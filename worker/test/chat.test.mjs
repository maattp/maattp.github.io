/* Node test suite for the chat identity + membership logic.
 * Run: node --experimental-strip-types worker/test/chat.test.mjs             */
import { parseSenderMap, memberOf, THREADS, DEVICE_OWNERS, mergeStreams } from '../src/chat.ts';
import { authorized } from '../src/ring.ts';

let pass = 0, fail = 0; const failures = [];
const ok = (cond, msg) => { if (cond) pass++; else { fail++; failures.push(msg); } };

// --- sender map parsing ---
const map = parseSenderMap('m.polkiewicz@gmail.com:matt,ting520143@gmail.com:tingting');
ok(map.get('m.polkiewicz@gmail.com') === 'matt', 'matt maps');
ok(map.get('ting520143@gmail.com') === 'tingting', 'tingting maps');
ok(map.get('attacker@evil.com') === undefined, 'unknown email maps to nothing');
ok(parseSenderMap(' M.Polkiewicz@Gmail.com : Matt ').get('m.polkiewicz@gmail.com') === 'matt', 'case+whitespace normalised');
ok(parseSenderMap('').size === 0, 'empty var -> empty map');
ok(parseSenderMap('garbage').size === 0, 'malformed entry ignored');

// --- membership: the dm-invisibility property ---
ok(memberOf('dm', 'matt'), 'matt in dm');
ok(memberOf('dm', 'claude'), 'claude in dm');
ok(!memberOf('dm', 'tingting'), 'tingting NOT in dm — the invisibility rule');
ok(memberOf('group', 'matt') && memberOf('group', 'tingting') && memberOf('group', 'claude'), 'all three in group');
ok(!memberOf('nope', 'matt'), 'unknown thread -> no one is a member');
ok(!memberOf('dm', ''), 'empty sender never a member');
ok(Object.keys(THREADS).length === 2, 'exactly two threads');

// --- claude token: same constant-time gate as the ring ---
const tok = 'a'.repeat(64);
ok(authorized(`Bearer ${tok}`, tok), 'correct token accepted');
ok(!authorized(`Bearer ${'b'.repeat(64)}`, tok), 'wrong token rejected');
ok(!authorized(tok, tok), 'missing Bearer prefix rejected');
ok(!authorized(`Bearer ${tok}`, ''), 'unset secret fails closed');
ok(!authorized(undefined, tok), 'no header rejected');

// --- device senders ---
ok(DEVICE_OWNERS.ring === 'matt', 'ring is owned by matt');
ok(!memberOf('dm', 'ring'), 'ring is not an API member — it posts via the trusted relay path only');

// --- merged sync stream (review issue #2) ---
const M = (seqs) => seqs.map(seq => ({ seq, kind: 'msg' + seq }));
const R = (seqs) => seqs.map(seq => ({ seq, kind: 'react' + seq }));

// The reviewer's scenario: a burst of reactions on old messages fills the
// reaction page (cap 3 here) while the message page reaches further ahead.
// A max-of-both cursor would skip reactions 4,5; the merged cut must not.
{
  const out = mergeStreams(M([10, 11, 12]), R([1, 2, 3]), 3, 0);
  ok(out.reactions.length === 3 && out.messages.length === 0, 'imbalanced: reactions win the early seqs');
  ok(out.next === 3, `cursor stops at the cut, not at max (got ${out.next})`);
  ok(out.more === true, 'more=true: message page was full');
}
{ // interleaved cut mid-stream
  const out = mergeStreams(M([1, 4, 6]), R([2, 3, 5]), 4, 0);
  ok(out.messages.map(m => m.seq).join() === '1,4' && out.reactions.map(r => r.seq).join() === '2,3', 'interleaved cut keeps seq order');
  ok(out.next === 4 && out.more === true, 'cursor + more correct mid-stream');
}
{ // everything fits
  const out = mergeStreams(M([1, 3]), R([2]), 10, 0);
  ok(out.next === 3 && out.more === false, 'short page: next=last, more=false');
}
{ // source page at its own cap counts as more even when merged page is short
  const out = mergeStreams(M([1, 2]), R([]), 2, 0);
  ok(out.more === true, 'full source page forces another round trip');
}
{ // empty
  const out = mergeStreams(M([]), R([]), 5, 42);
  ok(out.next === 42 && out.more === false, 'empty page keeps the cursor');
}

console.log(`chat.test: ${pass} passed, ${fail} failed`);
if (fail) { failures.forEach(f => console.log('  FAIL:', f)); process.exit(1); }
