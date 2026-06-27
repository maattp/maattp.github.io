#!/usr/bin/env node
/* Splice the canonical engine (worker/src/mahjongCore.js, the region between
 * ==CORE-START== and ==CORE-END==) into apps/mahjong/index.html between the
 * CORE-INLINE markers. Run from the repo root: `node apps/mahjong/build-core.mjs`.
 * tests/core-sync.mjs asserts the two regions stay byte-identical. */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const corePath = path.join(root, 'worker/src/mahjongCore.js');
const htmlPath = path.join(root, 'apps/mahjong/index.html');

const core = fs.readFileSync(corePath, 'utf8');
const m = core.match(/\/\/ ==CORE-START==[\s\S]*?\/\/ ==CORE-END==/);
if (!m) { console.error('CORE markers not found in mahjongCore.js'); process.exit(1); }
const region = m[0];

let html = fs.readFileSync(htmlPath, 'utf8');
const START = '/* CORE-INLINE-START */';
const END = '/* CORE-INLINE-END */';
const si = html.indexOf(START), ei = html.indexOf(END);
if (si < 0 || ei < 0) { console.error('CORE-INLINE markers not found in index.html'); process.exit(1); }
html = html.slice(0, si + START.length) + '\n' + region + '\n' + html.slice(ei);
fs.writeFileSync(htmlPath, html);
console.log(`Inlined core region (${region.length} bytes) into index.html`);
