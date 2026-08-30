/* Node test suite for the chat identity + membership logic.
 * Run: node --experimental-strip-types worker/test/chat.test.mjs             */
import { parseSenderMap, memberOf, THREADS } from '../src/chat.ts';
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

console.log(`chat.test: ${pass} passed, ${fail} failed`);
if (fail) { failures.forEach(f => console.log('  FAIL:', f)); process.exit(1); }
