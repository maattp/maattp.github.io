// Read a V8 heap snapshot (memprobe.mjs --snapshot=FILE, or DevTools' Save)
// and say what holds the memory: self size by constructor, and the biggest
// RETAINED sizes (dominator tree) with the path from the window that keeps
// each one alive. Streams the file, so a multi-GB snapshot of this game's
// heap does not need to fit in one string.
//
//   node --max-old-space-size=12000 tools/heapsnap.mjs FILE [--top=40] [--paths=60] [--min=2]
//
//   --top    constructors listed by self size
//   --paths  objects listed by retained size (each with its retainer path),
//            skipping any whose dominator is already listed and holds >= 70 %
//   --min    MB: retained size below which an object is not listed
//
// ArrayBuffer backing stores are in the snapshot as "system / JSArrayBufferData"
// nodes under their buffer, so typed arrays count where they are held.
import { createReadStream, writeFileSync, readFileSync } from 'node:fs';

const FILE = process.argv[2];
const arg = (k, d) => { const a = process.argv.find((x) => x.startsWith(`--${k}=`)); return a ? +a.slice(k.length + 3) : d; };
const TOP = arg('top', 40), PATHS = arg('paths', 60), MIN = arg('min', 2) * 1e6;

// ---- streaming parse -------------------------------------------------------
let meta = null, nodes = null, edges = null, strings = [];
{
  let mode = 'head', head = '', arr = null, ai = 0, num = 0, inNum = false;
  let sBuf = [], inStr = false, esc = false, strDone = false;
  const grow = (a, n) => { if (n <= a.length) return a; const b = new Float64Array(Math.max(n, a.length * 2)); b.set(a); return b; };
  for await (const chunk of createReadStream(FILE, { highWaterMark: 1 << 24 })) {
    let i = 0;
    while (i < chunk.length) {
      if (mode === 'head') {
        // up to and including `"nodes":[`
        const s = chunk.toString('latin1', i, Math.min(chunk.length, i + (1 << 20)));
        head += s;
        const k = head.indexOf('"nodes":[');
        if (k < 0) { i += s.length; continue; }
        const hdr = head.slice(0, k);
        meta = JSON.parse(hdr.slice(hdr.indexOf('{', 1), hdr.lastIndexOf('}') + 1)).meta
          ? JSON.parse(hdr.slice(hdr.indexOf('{', 1), hdr.lastIndexOf('}') + 1))
          : JSON.parse(hdr.slice(hdr.indexOf('{', 1), hdr.lastIndexOf('}') + 1));
        const consumed = k + 9 - (head.length - s.length);
        i += consumed; head = '';
        nodes = new Float64Array(meta.node_count * meta.meta.node_fields.length + 16);
        arr = 'nodes'; ai = 0; mode = 'ints';
        continue;
      }
      if (mode === 'ints') {
        for (; i < chunk.length; i++) {
          const c = chunk[i];
          if (c >= 48 && c <= 57) { num = num * 10 + (c - 48); inNum = true; }
          else {
            if (inNum) { if (arr === 'nodes') { nodes = grow(nodes, ai + 1); nodes[ai++] = num; } else { edges = grow(edges, ai + 1); edges[ai++] = num; } num = 0; inNum = false; }
            if (c === 93) { // ]
              if (arr === 'nodes') { nodes = nodes.subarray(0, ai); mode = 'seekEdges'; }
              else { edges = edges.subarray(0, ai); mode = 'seekStrings'; }
              i++; head = ''; break;
            }
          }
        }
        continue;
      }
      if (mode === 'seekEdges' || mode === 'seekStrings') {
        const want = mode === 'seekEdges' ? '"edges":[' : '"strings":[';
        const s = chunk.toString('latin1', i, Math.min(chunk.length, i + (1 << 20)));
        head += s;
        const k = head.indexOf(want);
        if (k < 0) { i += s.length; if (head.length > 64) head = head.slice(-64); continue; }
        i += k + want.length - (head.length - s.length); head = '';
        if (mode === 'seekEdges') { edges = new Float64Array(meta.edge_count * meta.meta.edge_fields.length + 16); arr = 'edges'; ai = 0; mode = 'ints'; }
        else mode = 'strings';
        continue;
      }
      if (mode === 'strings') {
        for (; i < chunk.length; i++) {
          const c = chunk[i];
          if (!inStr) { if (c === 34) { inStr = true; sBuf = []; } else if (c === 93) { strDone = true; mode = 'done'; break; } continue; }
          if (esc) { sBuf.push(c); esc = false; continue; }
          if (c === 92) { sBuf.push(c); esc = true; continue; }
          if (c === 34) {
            inStr = false;
            const raw = Buffer.from(sBuf).toString('utf8');
            let v; try { v = JSON.parse('"' + raw + '"'); } catch { v = raw; }
            strings.push(v.length > 200 ? v.slice(0, 200) : v);
            continue;
          }
          sBuf.push(c);
        }
        continue;
      }
      break;
    }
    if (mode === 'done') break;
  }
  if (!strDone) console.warn('strings array did not close');
}
const NF = meta.meta.node_fields, EF = meta.meta.edge_fields;
const nfl = NF.length, efl = EF.length;
const N = nodes.length / nfl;
const nType = NF.indexOf('type'), nName = NF.indexOf('name'), nSelf = NF.indexOf('self_size'), nEC = NF.indexOf('edge_count');
const eType = EF.indexOf('type'), eName = EF.indexOf('name_or_index'), eTo = EF.indexOf('to_node');
const NT = meta.meta.node_types[0], ET = meta.meta.edge_types[0];
const WEAK = ET.indexOf('weak'), SHORTCUT = ET.indexOf('shortcut'), ELEM = ET.indexOf('element'), HIDDEN = ET.indexOf('hidden');
console.log(`${N} nodes, ${edges.length / efl} edges, ${strings.length} strings`);

// first edge of each node
const firstEdge = new Uint32Array(N + 1);
for (let n = 0, e = 0; n < N; n++) { firstEdge[n] = e; e += nodes[n * nfl + nEC] * efl; firstEdge[N] = e; }
const selfOf = (n) => nodes[n * nfl + nSelf];
const typeOf = (n) => NT[nodes[n * nfl + nType]];
const nameOf = (n) => strings[nodes[n * nfl + nName]];
const label = (n) => {
  const t = typeOf(n), nm = nameOf(n);
  if (t === 'object' || t === 'native' || t === 'hidden' || t === 'synthetic') return nm;
  if (t === 'closure') return 'closure ' + nm;
  return '(' + t + ')';
};

// ---- self size by constructor ----------------------------------------------
{
  const by = new Map(); let tot = 0;
  for (let n = 0; n < N; n++) { const k = label(n); const s = selfOf(n); tot += s; const r = by.get(k) || [0, 0]; r[0] += s; r[1]++; by.set(k, r); }
  console.log(`\nself size ${(tot / 1e6).toFixed(1)} MB, by constructor:`);
  for (const [k, [s, c]] of [...by.entries()].sort((a, b) => b[1][0] - a[1][0]).slice(0, TOP))
    console.log(`  ${(s / 1e6).toFixed(1).padStart(8)} MB ${String(c).padStart(9)}  ${String(k).slice(0, 90)}`);
}

// ---- dominator tree (Cooper-Harvey-Kennedy over a DFS post-order) -----------
// Root is node 0; weak edges do not retain.
const revCount = new Uint32Array(N + 1);
const ok = (e) => { const t = edges[e + eType]; return t !== WEAK && t !== SHORTCUT; };
for (let e = 0; e < edges.length; e += efl) if (ok(e)) revCount[edges[e + eTo] / nfl]++;
const revStart = new Uint32Array(N + 1);
for (let n = 0, s = 0; n < N; n++) { revStart[n] = s; s += revCount[n]; revStart[N] = s; }
const revFrom = new Uint32Array(revStart[N]), fill = revStart.slice();
for (let n = 0; n < N; n++) for (let e = firstEdge[n]; e < firstEdge[n + 1]; e += efl) if (ok(e)) revFrom[fill[edges[e + eTo] / nfl]++] = n;
// post-order
const order = new Int32Array(N).fill(-1); const post = new Uint32Array(N); let pc = 0;
{
  const stack = new Uint32Array(N), it = new Uint32Array(N); let sp = 0;
  const seen = new Uint8Array(N); stack[sp++] = 0; seen[0] = 1; it[0] = firstEdge[0];
  while (sp) {
    const n = stack[sp - 1];
    let pushed = false;
    while (it[n] < firstEdge[n + 1]) {
      const e = it[n]; it[n] += efl;
      if (!ok(e)) continue;
      const m = edges[e + eTo] / nfl;
      if (!seen[m]) { seen[m] = 1; it[m] = firstEdge[m]; stack[sp++] = m; pushed = true; break; }
    }
    if (!pushed) { sp--; order[n] = pc; post[pc++] = n; }
  }
}
console.log(`reachable ${pc} of ${N}`);
const UNDEF = 0xffffffff;
const idom = new Uint32Array(N).fill(UNDEF); idom[0] = 0;
for (let changed = true, pass = 0; changed; pass++) {
  changed = false;
  for (let k = pc - 2; k >= 0; k--) {   // reverse post-order, root (pc-1) skipped
    const n = post[k];
    let nd = UNDEF;
    for (let r = revStart[n]; r < revStart[n + 1]; r++) {
      const p = revFrom[r];
      if (order[p] < 0 || idom[p] === UNDEF) continue;
      if (nd === UNDEF) { nd = p; continue; }
      let a = p, b = nd;
      while (a !== b) { while (order[a] < order[b]) a = idom[a]; while (order[b] < order[a]) b = idom[b]; }
      nd = a;
    }
    if (nd !== idom[n]) { idom[n] = nd; changed = true; }
  }
}
const retained = new Float64Array(N);
for (let k = 0; k < pc; k++) { const n = post[k]; retained[n] += selfOf(n); if (n !== 0) retained[idom[n]] += retained[n]; }
console.log(`retained by root ${(retained[0] / 1e6).toFixed(1)} MB`);

// a retainer path: the shortest from the root (BFS distance), one hop at a
// time through a retainer one step nearer, naming the edge
const dist = new Uint32Array(N).fill(UNDEF);
{
  const q = new Uint32Array(N); let h = 0, t = 0; q[t++] = 0; dist[0] = 0;
  while (h < t) {
    const n = q[h++];
    for (let e = firstEdge[n]; e < firstEdge[n + 1]; e += efl) {
      if (!ok(e)) continue;
      const m = edges[e + eTo] / nfl;
      if (dist[m] === UNDEF) { dist[m] = dist[n] + 1; q[t++] = m; }
    }
  }
}
const edgeName = (from, to) => {
  for (let e = firstEdge[from]; e < firstEdge[from + 1]; e += efl) if (edges[e + eTo] / nfl === to && ok(e)) {
    const t = edges[e + eType];
    return t === ELEM || t === HIDDEN ? `[${edges[e + eName]}]` : '.' + strings[edges[e + eName]];
  }
  return '~';
};
const short = (n) => { const l = String(label(n)); return l.startsWith('system / Context') ? 'ctx' : l.replace(/^Window.*/, 'Window').slice(0, 24); };
const pathOf = (n) => {
  const parts = [];
  for (let x = n, g = 0; x !== 0 && g < 40; g++) {
    let best = UNDEF;
    for (let r = revStart[x]; r < revStart[x + 1]; r++) { const p = revFrom[r]; if (dist[p] < dist[x] && (best === UNDEF || dist[p] < dist[best])) best = p; }
    if (best === UNDEF) break;
    parts.unshift(edgeName(best, x));
    if (/^Window/.test(String(label(best))) || best === 0) { parts.unshift(short(best)); break; }
    parts.unshift(' ' + short(best));
    x = best;
  }
  const s = parts.join('');
  return s.length > 260 ? '...' + s.slice(-260) : s;
};

// biggest retainers, not counting ones mostly inside a listed one
const cand = [];
for (let n = 1; n < N; n++) if (retained[n] >= MIN && order[n] >= 0) cand.push(n);
cand.sort((a, b) => retained[b] - retained[a]);
const listed = new Set(); let shown = 0;
console.log(`\nretained >= ${MIN / 1e6} MB (skipping objects that are >= 70 % of a listed ancestor):`);
for (const n of cand) {
  let skip = false;
  for (let x = idom[n], g = 0; x !== 0 && g < 60; x = idom[x], g++) if (listed.has(x) && retained[n] >= 0.7 * retained[x]) { skip = true; break; }
  if (skip) continue;
  listed.add(n);
  console.log(`  ${(retained[n] / 1e6).toFixed(1).padStart(8)} MB  ${String(label(n)).slice(0, 40).padEnd(40)} ${pathOf(n)}`);
  if (++shown >= PATHS) break;
}

// ---- owners: every node's self size charged to the first hops of its BFS
// path from the window (`--depth`, default 4), arrays' indices folded to [],
// objects carrying a `name` string named by it. Answers "which subsystem holds
// the bytes" where the dominator tree only says "the window".
{
  const D = arg('depth', 4), OWN = arg('owners', 50);
  const keyOf = new Int32Array(N).fill(-1), depthOf = new Uint8Array(N);
  const keys = ['(outside the window)'], keyIdx = new Map([[keys[0], 0]]);
  const kid = (s) => { let k = keyIdx.get(s); if (k === undefined) { k = keys.length; keys.push(s); keyIdx.set(s, k); } return k; };
  const strName = (n) => {
    for (let e = firstEdge[n]; e < firstEdge[n + 1]; e += efl) if (edges[e + eType] !== ELEM && edges[e + eType] !== HIDDEN && strings[edges[e + eName]] === 'name') {
      const m = edges[e + eTo] / nfl; const t = typeOf(m);
      if (t === 'string' || t === 'concatenated string' || t === 'sliced string') { const v = nameOf(m); return v ? v.slice(0, 24) : ''; }
    }
    return '';
  };
  // the window's own objects first, so a subsystem reached both from the
  // window and from a module scope is charged to its window path
  const q = new Uint32Array(N); let h = 0, t = 0;
  const seen = new Uint8Array(N);
  for (let n = 1; n < N; n++) if (typeOf(n) === 'object' && /^Window/.test(String(nameOf(n)))) { q[t++] = n; seen[n] = 1; keyOf[n] = 0; }
  q[t++] = 0; keyOf[0] = kid('root'); seen[0] = 1;   // the rest, by its path from the root
  while (h < t) {
    const n = q[h++];
    const inWin = keyOf[n] > 0 || /^Window/.test(String(label(n)));
    for (let e = firstEdge[n]; e < firstEdge[n + 1]; e += efl) {
      if (!ok(e)) continue;
      const m = edges[e + eTo] / nfl;
      if (seen[m]) continue;
      seen[m] = 1; q[t++] = m;
      if (!inWin) { keyOf[m] = 0; continue; }
      if (keyOf[n] <= 0) { keyOf[m] = kid('window'); depthOf[m] = 0; }
      else { keyOf[m] = keyOf[n]; depthOf[m] = depthOf[n]; }
      if (keyOf[n] > 0 && depthOf[n] < D) {
        const et = edges[e + eType];
        let seg = et === ELEM ? '[]' : et === HIDDEN ? '' : '.' + strings[edges[e + eName]];
        if (seg === '.context') seg = '()';
        const nm = strName(m);
        if (nm) seg += ':' + nm;
        if (seg) { keyOf[m] = kid(keys[keyOf[n]] + seg); depthOf[m] = depthOf[n] + 1; }
      }
    }
  }
  // roll each key up into its prefixes, so a subtree's total reads directly
  const tot = new Map(), ab = new Map();
  for (let n = 0; n < N; n++) {
    if (keyOf[n] < 0) continue;
    const k = keys[keyOf[n]], s = selfOf(n);
    tot.set(k, (tot.get(k) || 0) + s);
    if (nameOf(n) === 'system / JSArrayBufferData') ab.set(k, (ab.get(k) || 0) + s);
  }
  const roll = new Map(), rollAB = new Map();
  for (const [k, s] of tot) {
    let p = k;
    for (;;) {
      roll.set(p, (roll.get(p) || 0) + s); rollAB.set(p, (rollAB.get(p) || 0) + (ab.get(k) || 0));
      const i = Math.max(p.lastIndexOf('.'), p.lastIndexOf('['), p.lastIndexOf('()'));
      if (i <= 0) break;
      p = p.slice(0, i);
    }
  }
  // --json=FILE keeps this rollup; --diff=FILE prints the change from one kept
  // earlier (a boot snapshot against one after a flight: what grew)
  const sarg = (k) => { const a = process.argv.find((x) => x.startsWith(`--${k}=`)); return a ? a.slice(k.length + 3) : ''; };
  if (sarg('json')) writeFileSync(sarg('json'), JSON.stringify(Object.fromEntries(roll)));
  if (sarg('diff')) {
    const before = JSON.parse(readFileSync(sarg('diff'), 'utf8'));
    const keys = new Set([...Object.keys(before), ...roll.keys()]);
    const d = [...keys].map((k) => [k, (roll.get(k) || 0) - (before[k] || 0)]).filter(([, v]) => Math.abs(v) > 0.5e6);
    console.log(`\ngrowth since ${sarg('diff')} (MB, rolled up):`);
    for (const [k, v] of d.sort((a, b) => Math.abs(b[1]) - Math.abs(a[1])).slice(0, OWN)) console.log(`  ${(v / 1e6).toFixed(1).padStart(8)}  ${k.slice(0, 120)}`);
  }
  console.log(`\nowners (self size rolled up the first ${D} hops from the window; ab = array buffer bytes):`);
  for (const [k, s] of [...roll.entries()].sort((a, b) => b[1] - a[1]).slice(0, OWN))
    console.log(`  ${(s / 1e6).toFixed(1).padStart(8)} MB  ab ${((rollAB.get(k) || 0) / 1e6).toFixed(1).padStart(7)}  ${k.slice(0, 120)}`);
}
