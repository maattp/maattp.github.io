// Loads the imported Waterloo Region map: elevation, water, roads, buildings, places.
//
// Everything here is produced by tools/ from OpenStreetMap and USGS elevation
// data -- see apps/auto/CLAUDE.md. The formats are documented at the top of the
// tool that writes each one; the decoders below are the other half of those
// contracts, so if you change one, change both.
//
// The whole set is about 3.8 MB and is fetched once, then cached by the service
// worker in the same lazy tier as the Three.js build (never in SHELL -- a slow
// install pins iOS players to a stale worker forever).

import { decodeMountains } from './mountains.js';

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
  // These PNGs carry codes, not colours: no colour-space conversion, ever.
  const bmp = await createImageBitmap(blob, { colorSpaceConversion: 'none', premultiplyAlpha: 'none' });
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

  // THE WATER'S SURFACE, per 40 m vertex (tools/kw/build_raster.py
  // carve_water): flat over a lake, sloping down a river. Same encoding as
  // height.png, 0 where no water is drawn; blue = the vertex is wet.
  step('Reading the rivers');
  const wp = await pixels('wlevel.png');
  const wlevel = new Float32Array(wp.w * wp.h);
  for (let i = 0, p = 0; i < wlevel.length; i++, p += 4) {
    // only the WET vertices: a bank vertex's level (also in the file) would
    // spread the drawn water a cell over dry ground
    const q = (wp.data[p] << 8) | wp.data[p + 1];
    wlevel[i] = q && wp.data[p + 2] > 127 ? q / 10 - 100 : NaN;
  }

  step('Reading the shoreline');
  const sp = await pixels('surface.png');
  const water = new Uint8Array(sp.w * sp.h);
  const green = new Uint8Array(sp.w * sp.h);
  // Auto KW: outside the green, blue is a farm field's crop (build_wood.py)
  const farm = new Uint8Array(sp.w * sp.h);
  for (let i = 0, p = 0; i < water.length; i++, p += 4) {
    water[i] = sp.data[p] > 127 ? 1 : 0;
    // Green is non-zero; WHICH green rides in the value, from the blue
    // channel (tools/build_wood.py): 1 lawn, 2 wood, 3 scrub, 4 kept open.
    // Everything that only asks "is it green" tests for non-zero.
    const b = sp.data[p + 2];
    green[i] = sp.data[p + 1] > 127 ? (b > 212 ? 2 : b > 127 ? 3 : b > 42 ? 4 : 1) : 0;
    farm[i] = sp.data[p + 1] > 127 ? 0 : Math.round(b / 30);
  }

  // The lot layer: R = coverage of the sample's own cell by its code, G = the
  // code (kind + orientation), see tools/build_lots.py. Kept interleaved as the
  // raw bytes -- geo.js reconstructs from them, and the terrain shader samples
  // the same bytes as an RG texture.
  const lp = await pixels('lots.png');
  const lot = new Uint8Array(lp.w * lp.h * 2);
  for (let i = 0, p = 0; i < lp.w * lp.h; i++, p += 4) {
    lot[i * 2] = lp.data[p];
    lot[i * 2 + 1] = lp.data[p + 1];
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
  // The Seattle Center Monorail's beams, stations and platforms, from OSM
  // (tools/build_monorail.py); monorail.js builds the line from them.
  const opt = async (n) => { try { const r = await fetch(new URL(n, BASE)); return r.ok ? await r.json() : null; } catch (e) { return null; } };
  const monorail = await opt('monorail.json');
  // Link light rail's 1 Line, both tracks and the stations (tools/build_link.py)
  const link = await opt('link.json');
  // BNSF's main line through Seattle and Balmer Yard (tools/build_freight.py)
  const freight = await opt('freight.json');
  // OSM's beaches, for what stands on them (tools/build_beaches.py)
  const beaches = (await (await fetch(new URL('beaches.json', BASE))).json()).beaches;
  // benches, picnic tables, playgrounds and fountains (tools/build_parkprops.py)
  const parkprops = await (await fetch(new URL('parkprops.json', BASE))).json();
  // Seattle's bike paths (tools/build_bikepaths.py): bikes.js draws and rides them
  const bikepaths = await (await fetch(new URL('bikepaths.json', BASE))).json();
  // OSM's piers (tools/build_piers.py): piers.js builds the ones nothing else does
  const piers = await (await fetch(new URL('piers.json', BASE))).json();
  // WSF's Seattle-Bainbridge route and its slips (tools/build_ferry.py)
  const ferry = await opt('ferry.json');
  // trails off the street network: Chicopee's mountain-bike runs and the like
  const trails = await opt('trails.json');
  // Waterloo Region's local layer: named buildings, storefronts, every Tims (kw.js)
  const kw = await opt('kw.json');
  // Chicopee's runs, lifts and trails (chicopee.js)
  const chicopee = await opt('chicopee.json');
  // the golf courses, hole by hole (tools/kw/build_golf.py; golf.js)
  const golf = await opt('golf.json');
  // Erbsville Kartway's circuit and property (tools/kw/build_kart.py; kart.js)
  const kart = await opt('kart.json');
  // the townships' unpaved roads (tools/kw/build_gravel.py; gravel.js)
  const gravel = await opt('gravel.json');
  // downtown Kitchener, Cambridge, the malls... (tools/kw/build_sights.py; kwsights.js)
  const sights = await opt('sights.json');
  // the villages' main streets, St. Jacobs' mill and silos (tools/kw/build_villages.py; kwvillages.js)
  const villages = await opt('villages.json');
  // north-east Waterloo's plazas and schools, Conestoga Doon, the Bridgeport Bridge (tools/kw/build_home.py; kwhome.js)
  const home = await opt('home.json');
  // the chain stores, gas stations and plazas (tools/kw/build_shops.py; kwshops.js)
  const shops = await opt('shops.json');
  // the freeways as signed: exits, speed limits, lighting (tools/kw/build_hwy.py; highways.js)
  const hwy = await opt('hwy.json');
  // the University of Waterloo's campus, building by building (tools/kw/build_uw.py; uwcampus.js)
  const uw = await opt('uw.json');
  // signals, stop signs, roundabouts, crossings (tools/kw/build_junctions.py; junctions.js)
  const junctions = await opt('junctions.json');
  // GRT route sections and KW Eats' restaurants and doors (tools/kw/build_grt.py, build_eats.py)
  const grt = await opt('grt.json');
  const eats = await opt('eats.json');
  // The Olympics, Rainier and the Cascades as seen from here (tools/build_mountains.py).
  // Scenery only: a failed fetch costs the view, never the boot.
  let mountains = null;
  // (none: Waterloo Region's horizon is farmland)

  return {
    height, hfN: hp.w, wlevel,
    water, green, farm, maskN: sp.w, lot, lotN: lp.w,
    roads, buildings, places, lakes, monorail, link, freight, beaches, parkprops, bikepaths, piers, ferry, mountains, trails, kw, chicopee, golf, kart, gravel, sights, villages, shops, hwy, uw, home, junctions, grt, eats,
  };
}
