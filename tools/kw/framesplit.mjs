// Auto KW: where main.js's frame() spends its time, by DIRECT callee (a CPU
// profile from perfaudit.mjs --view-prof --prof-out=DIR).
//
//   node tools/kw/framesplit.mjs <file.cpuprofile> [--frames=N] [--top=60] [--root='frame src/main.js']
//
// Each sample whose stack passes through the root is charged to the function
// the root called on the way down (inclusive: everything under that call), so
// the list reads as "ms per frame per system" -- secrets.update, exportYard.tick,
// hud.update, draw ... -- plus the root's own self time (its inline code). The
// per-system table in apps/autokw/CLAUDE.md ("Frame budget (CPU)") came from this.
import { readFileSync } from 'node:fs';

const file = process.argv[2];
const opt = (k, d) => { const a = process.argv.find((x) => x.startsWith(`--${k}=`)); return a ? a.slice(k.length + 3) : d; };
const FR = +opt('frames', 1), TOP = +opt('top', 60), ROOT = opt('root', 'frame src/main.js');
const prof = JSON.parse(readFileSync(file, 'utf8'));
const byId = new Map(prof.nodes.map((n) => [n.id, n]));
const parent = new Map();
for (const n of prof.nodes) for (const c of n.children || []) parent.set(c, n.id);
const key = (cf) => `${cf.functionName || '(anon)'} ${cf.url.replace(/^.*\/apps\/autokw\//, '')}:${cf.lineNumber + 1}`;
const by = new Map();
let tot = 0;
for (let i = 0; i < prof.samples.length; i++) {
  const us = prof.timeDeltas[i + 1] !== undefined ? prof.timeDeltas[i + 1] : 0;
  // walk up: the node just below the (outermost) root
  // (perfaudit's wrappers -- obj.<computed>, p.update -- are eval'd code with no
  // url: they are seen through, to the module function they wrap)
  const chain = [];
  for (let id = prof.samples[i]; id !== undefined; id = parent.get(id)) chain.push(id);
  let child = null, hit = false;
  for (let j = chain.length - 1; j >= 0; j--) {
    if (!key(byId.get(chain[j]).callFrame).includes(ROOT)) continue;
    hit = true;
    let c = j - 1;
    while (c > 0 && !byId.get(chain[c]).callFrame.url) c--;
    child = c >= 0 ? chain[c] : null;
    break;
  }
  if (!hit) continue;
  const k = child === null ? '(self) ' + ROOT : key(byId.get(child).callFrame);
  by.set(k, (by.get(k) || 0) + us);
  tot += us;
}
console.log(`${ROOT}: ${(tot / 1000 / FR).toFixed(2)} ms/frame`);
for (const [k, us] of [...by].sort((a, b) => b[1] - a[1]).slice(0, TOP)) {
  console.log(`  ${(us / 1000 / FR).toFixed(3).padStart(7)}  ${(us / tot * 100).toFixed(1).padStart(5)}%  ${k}`);
}
