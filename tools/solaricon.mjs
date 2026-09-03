// Renders apps/solar icons (180/192/512) as PNGs without a browser.
import { writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
const crcT = new Uint32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc = (b) => { let c = ~0; for (const x of b) c = crcT[(c ^ x) & 255] ^ (c >>> 8); return (~c) >>> 0; };
const chunk = (t, d) => { const l = Buffer.alloc(4); l.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(t), d]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([l, td, c]); };
function png(S, px) {
  const raw = Buffer.alloc((S * 4 + 1) * S);
  for (let y = 0; y < S; y++) { raw[y * (S * 4 + 1)] = 0; for (let x = 0; x < S; x++) { const [r, g, b] = px(x, y); const o = y * (S * 4 + 1) + 1 + x * 4; raw[o] = r; raw[o + 1] = g; raw[o + 2] = b; raw[o + 3] = 255; } }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(S, 0); ihdr.writeUInt32BE(S, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
const mix = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);
const sm = (e0, e1, x) => { const t = Math.max(0, Math.min(1, (x - e0) / (e1 - e0))); return t * t * (3 - 2 * t); };
for (const S of [180, 192, 512]) {
  const buf = png(S, (x, y) => {
    const u = (x + .5) / S, v = (y + .5) / S;
    let c = mix([6, 10, 30], [14, 22, 60], v);                                 // background
    // stars
    const h = Math.sin(x * 12.9898 + y * 78.233) * 43758.5453; const fr = h - Math.floor(h);
    if (fr > 0.997) c = mix(c, [230, 235, 255], 0.8);
    const dx = u - .5, dy = v - .5, d = Math.hypot(dx, dy);
    // sun glow + disc
    const sx = u - .36, sy = v - .40, sd = Math.hypot(sx, sy);
    c = mix(c, [255, 200, 90], Math.max(0, 1 - sd / .34) ** 2.2 * .75);
    c = mix(c, [255, 244, 210], sm(.13, .115, sd));
    // orbit ring (ellipse, tilted)
    const ca = Math.cos(-.5), sa = Math.sin(-.5), ex = (sx * ca - sy * sa) / .42, ey = (sx * sa + sy * ca) / .2;
    const er = Math.hypot(ex, ey);
    c = mix(c, [120, 230, 255], (1 - Math.min(1, Math.abs(er - 1) / .045)) * .9 * (ey > -0.15 ? 1 : 0.35));
    // planet on the ring (front)
    const px = .36 + (.42 * .92 * ca + .2 * .38 * sa), py = .40 + (-.42 * .92 * sa + .2 * .38 * ca);
    const pd = Math.hypot(u - px, v - py);
    const lit = Math.max(.25, 1 - Math.hypot(u - px + .03, v - py - .02) / .1);
    c = mix(c, mix([40, 80, 190], [110, 170, 255], lit), sm(.085, .078, pd));
    return c.map(Math.round);
  });
  writeFileSync(`apps/solar/icon-${S}.png`, buf);
}
console.log('icons written');
