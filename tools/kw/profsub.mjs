// Auto KW: one function's subtree in a CPU profile (perfaudit.mjs --prof-out).
//
//   node tools/kw/profsub.mjs <file.cpuprofile> '<fn src/file.js:line>' [--frames=N] [--top=30] [--lines]
//
// Of the samples whose stack passes through the root function (matched as a
// substring of "name file:line", e.g. 'update src/traffic.js:1333'): each
// function's time inside it, self and inclusive, in ms (per frame with
// --frames, the view's frame count from perfaudit), and with --lines the
// hottest source lines by self time (the profile's positionTicks).
import { readFileSync } from 'node:fs';

const [file, rootQ] = process.argv.slice(2);
const opt = (k, d) => { const a = process.argv.find((x) => x.startsWith(`--${k}=`)); return a ? a.slice(k.length + 3) : d; };
const FR = +opt('frames', 1), TOP = +opt('top', 30);
const prof = JSON.parse(readFileSync(file, 'utf8'));
const byId = new Map(prof.nodes.map((n) => [n.id, n]));
const parent = new Map();
for (const n of prof.nodes) for (const c of n.children || []) parent.set(c, n.id);
const key = (cf) => `${cf.functionName || '(anon)'} ${cf.url.replace(/^.*\/apps\/autokw\//, '')}:${cf.lineNumber + 1}`;
// time per sample
const dtOf = new Map();
for (let i = 0; i < prof.samples.length; i++) {
  const us = prof.timeDeltas[i + 1] !== undefined ? prof.timeDeltas[i + 1] : 0;
  dtOf.set(prof.samples[i], (dtOf.get(prof.samples[i]) || 0) + us);
}
// node -> under root?
const under = new Map();
const isUnder = (id) => {
  if (under.has(id)) return under.get(id);
  const n = byId.get(id);
  const r = key(n.callFrame).includes(rootQ) ? true : parent.has(id) ? isUnder(parent.get(id)) : false;
  under.set(id, r);
  return r;
};
const self = new Map(), incl = new Map(), lines = new Map();
let total = 0;
for (const [id, us] of dtOf) {
  if (!isUnder(id)) continue;
  total += us;
  const n = byId.get(id), k = key(n.callFrame);
  self.set(k, (self.get(k) || 0) + us);
  const seen = new Set();
  for (let q = id; q !== undefined; q = parent.get(q)) {
    const kk = key(byId.get(q).callFrame);
    if (!seen.has(kk)) { seen.add(kk); incl.set(kk, (incl.get(kk) || 0) + us); }
    if (kk.includes(rootQ)) break;
  }
  // line ticks: share the node's time among its lines by tick count
  const pt = n.positionTicks;
  if (pt && pt.length) {
    const nt = pt.reduce((a, b) => a + b.ticks, 0);
    for (const p of pt) {
      const lk = `${n.callFrame.url.replace(/^.*\/apps\/autokw\//, '')}:${p.line} (${n.callFrame.functionName || 'anon'})`;
      lines.set(lk, (lines.get(lk) || 0) + us * p.ticks / nt);
    }
  }
}
const ms = (us) => (us / 1000 / FR).toFixed(FR > 1 ? 3 : 1);
const show = (m, title) => {
  console.log(title);
  for (const [k, us] of [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, TOP)) console.log(`  ${ms(us).padStart(8)}  ${(us / total * 100).toFixed(1).padStart(5)}%  ${k}`);
};
console.log(`${rootQ}: ${ms(total)} ms${FR > 1 ? '/frame' : ''} in all`);
show(incl, 'inclusive:');
show(self, 'self:');
if (process.argv.includes('--lines')) show(lines, 'hottest lines (self):');
