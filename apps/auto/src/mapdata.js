// Loads the imported Seattle map: elevation, water, roads, buildings, places.
//
// Everything here is produced by tools/ from OpenStreetMap and USGS elevation
// data -- see apps/auto/CLAUDE.md. The formats are documented at the top of the
// tool that writes each one; the decoders below are the other half of those
// contracts, so if you change one, change both.
//
// The whole set is about 3.8 MB and is fetched once, then cached by the service
// worker in the same lazy tier as the Three.js build (never in SHELL -- a slow
// install pins iOS players to a stale worker forever).

const BASE = new URL('../data/', import.meta.url);

async function bytes(name, onProgress) {
  const res = await fetch(new URL(name, BASE));
  if (!res.ok) throw new Error(`${name}: HTTP ${res.status}`);
  // Content-Length is the *compressed* size when the server gzips, so it can't
  // drive a byte-accurate bar. It is only used to weight the step.
  const buf = await res.arrayBuffer();
  if (onProgress) onProgress(name, buf.byteLength);
  return buf;
}

/** Decode a PNG into raw RGBA. Canvas is the only PNG decoder a browser hands us. */
async function pixels(name) {
  const blob = new Blob([await bytes(name)], { type: 'image/png' });
  const bmp = await createImageBitmap(blob);
  const cv = typeof OffscreenCanvas !== 'undefined'
    ? new OffscreenCanvas(bmp.width, bmp.height)
    : Object.assign(document.createElement('canvas'), { width: bmp.width, height: bmp.height });
  const ctx = cv.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(bmp, 0, 0);
  // Read the size out before closing: close() zeroes width/height, and the
  // resulting "height.png is 0 wide" is a confusing way to learn that.
  const w = bmp.width, h = bmp.height;
  const d = ctx.getImageData(0, 0, w, h);
  bmp.close?.();
  return { w, h, data: d.data };
}

// ---------------------------------------------------------------------------

function decodeRoads(buf) {
  const dv = new DataView(buf);
  const magic = String.fromCharCode(dv.getUint8(0), dv.getUint8(1), dv.getUint8(2), dv.getUint8(3));
  if (magic !== 'AUTR') throw new Error('roads.bin: bad magic ' + magic);
  const nameCount = dv.getUint16(6, true);
  const nodeCount = dv.getUint32(8, true);
  const edgeCount = dv.getUint32(12, true);

  let o = 16;
  const nx = new Float32Array(nodeCount);
  const nz = new Float32Array(nodeCount);
  const ny = new Float32Array(nodeCount);
  const nElev = new Uint8Array(nodeCount);
  for (let i = 0; i < nodeCount; i++) {
    nx[i] = dv.getInt32(o, true) / 10;
    nz[i] = dv.getInt32(o + 4, true) / 10;
    ny[i] = dv.getInt16(o + 8, true) / 10;
    nElev[i] = dv.getUint8(o + 10);
    o += 12;
  }
  const ea = new Uint32Array(edgeCount);
  const eb = new Uint32Array(edgeCount);
  const ecls = new Uint8Array(edgeCount);
  const eflags = new Uint8Array(edgeCount);
  const ehw = new Float32Array(edgeCount);
  const ename = new Uint16Array(edgeCount);
  for (let i = 0; i < edgeCount; i++) {
    ea[i] = dv.getUint32(o, true);
    eb[i] = dv.getUint32(o + 4, true);
    ecls[i] = dv.getUint8(o + 8);
    eflags[i] = dv.getUint8(o + 9);
    ehw[i] = dv.getUint16(o + 10, true) / 100;
    ename[i] = dv.getUint16(o + 12, true);
    o += 16;
  }
  const dec = new TextDecoder();
  const names = new Array(nameCount);
  for (let i = 0; i < nameCount; i++) {
    const len = dv.getUint16(o, true);
    o += 2;
    names[i] = dec.decode(new Uint8Array(buf, o, len));
    o += len;
  }
  return { nodeCount, edgeCount, nx, nz, ny, nElev, ea, eb, ecls, eflags, ehw, ename, names };
}

// Must match tools/build_roads.py.
export const CLS_NAME = ['hwy', 'art', 'st', 'res', 'ramp'];
export const F_ELEV = 1, F_TUNNEL = 2, F_ONEWAY = 4, F_ONEWAY_REV = 8;

// ---------------------------------------------------------------------------

function decodeBuildings(buf) {
  const dv = new DataView(buf);
  const magic = String.fromCharCode(dv.getUint8(0), dv.getUint8(1), dv.getUint8(2), dv.getUint8(3));
  if (magic !== 'AUTB') throw new Error('buildings.bin: bad magic ' + magic);
  const nx = dv.getUint16(6, true);
  const nz = dv.getUint16(8, true);
  const dirLen = nx * nz + 1;
  const dir = new Uint32Array(buf, 12, dirLen);
  return { nx, nz, dir, blob: new DataView(buf, 12 + dirLen * 4) };
}

// ---------------------------------------------------------------------------

export async function loadMapData(onStep) {
  const step = onStep || (() => {});
  step('Reading the terrain');
  const hp = await pixels('height.png');
  const height = new Float32Array(hp.w * hp.h);
  for (let i = 0, p = 0; i < height.length; i++, p += 4) {
    height[i] = ((hp.data[p] << 8) | hp.data[p + 1]) / 10 - 100;
  }

  step('Reading the shoreline');
  const sp = await pixels('surface.png');
  const water = new Uint8Array(sp.w * sp.h);
  const green = new Uint8Array(sp.w * sp.h);
  for (let i = 0, p = 0; i < water.length; i++, p += 4) {
    water[i] = sp.data[p] > 127 ? 1 : 0;
    green[i] = sp.data[p + 1] > 127 ? 1 : 0;
  }

  step('Reading the streets');
  const roads = decodeRoads(await bytes('roads.bin'));

  step('Reading the buildings');
  const buildings = decodeBuildings(await bytes('buildings.bin'));

  step('Reading the places');
  const places = await (await fetch(new URL('places.json', BASE))).json();
  // `lakes`, not `water`: `water` is already the shoreline mask above, and a
  // second key of that name silently replaced it -- initGeo then got a JSON
  // object where it wanted the mask.
  const lakes = (await (await fetch(new URL('water.json', BASE))).json()).lakes;

  return {
    height, hfN: hp.w,
    water, green, maskN: sp.w,
    roads, buildings, places, lakes,
  };
}
