/* Guard: the engine region inlined into apps/mahjong/index.html must stay
 * byte-identical to the canonical worker/src/mahjongCore.js. If this fails,
 * run `node apps/mahjong/build-core.mjs`. Run from repo root. */
import fs from 'node:fs';

const re = /\/\/ ==CORE-START==[\s\S]*?\/\/ ==CORE-END==/;
const core = fs.readFileSync('worker/src/mahjongCore.js', 'utf8').match(re);
const html = fs.readFileSync('apps/mahjong/index.html', 'utf8').match(re);

if (!core) { console.error('FAIL: CORE markers missing in worker/src/mahjongCore.js'); process.exit(1); }
if (!html) { console.error('FAIL: CORE-INLINE region missing in apps/mahjong/index.html'); process.exit(1); }

if (core[0] !== html[0]) {
  const a = core[0], b = html[0];
  let i = 0; while (i < a.length && i < b.length && a[i] === b[i]) i++;
  console.error('FAIL: inlined core has drifted from the canonical engine.');
  console.error(`First difference at offset ${i}:`);
  console.error('  canonical: …' + JSON.stringify(a.slice(i, i + 60)));
  console.error('  inlined:   …' + JSON.stringify(b.slice(i, i + 60)));
  console.error('Fix: node apps/mahjong/build-core.mjs');
  process.exit(1);
}
console.log(`core-sync OK — ${core[0].length} bytes identical in both files.`);
