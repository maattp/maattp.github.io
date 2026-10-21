"""Bake WHICH greenspace is woodland into surface.png's blue channel.

  apps/auto/data/surface.png  B = 255 wood, 170 scrub, 85 kept open (pitches,
                              beaches), 0 lawn / not green.  R and G untouched.

The green mask (G) was binary: a forest and a mown lawn were the same raster,
so Discovery Park -- 140 ha of Douglas fir and bigleaf maple -- was planted
like a golf course. OSM does say which is which: every greenspace polygon
osm_extract.py keeps carries its kind (`k`: wood, forest, scrub, park, pitch,
nature_reserve...). This reads raw_green.json and paints:

  wood   natural=wood, landuse=forest; a nature_reserve unless its name says
         it is a wetland (round here a preserve is forest: Schmitz, Camp Long,
         Gazzam Lake -- the exceptions are Union Bay's meadow and the sloughs);
         a park NAMED as woodland (... Woods, Forest, Ravine, Greenbelt,
         Natural Area, Preserve) or one of the few big wooded parks OSM maps as
         bare `park` (the Arboretum, Interlaken); and STEEP green -- in Seattle a
         park slope over ~14 degrees is a wooded ravine or bluff, not a lawn
         (Discovery's sand bluff is a lot, and trees keep off lots anyway).
  scrub  natural=scrub.
  open   leisure=pitch, natural=beach: a playing field has no trees on it.

Only where G is set (green, not water). Runs after build_raster.py, which
writes surface.png with B = 0:

    tools/.venv/bin/python tools/build_wood.py

geo.js folds B into the green mask's value (1 lawn, 2 wood, 3 scrub, 4 open),
so `inPark` is unchanged and the trees and the terrain shader can ask which.
"""
import json
import os
import re
import sys

import numpy as np
from PIL import Image, ImageDraw

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from proj import MAP_HALF  # noqa: E402

HERE = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.join(HERE, "data")
OUT = os.environ.get("AUTO_DATA_OUT") or os.path.join(HERE, "..", "..", "apps", "autokw", "data")
SRC = os.path.join(HERE, "..", "..", "apps", "autokw", "data")
MASK_STEP = 10
MASK_N = (MAP_HALF * 2) // MASK_STEP + 1
HF_STEP = 40

WOOD_KINDS = {"wood", "forest"}
WOODED_NAME = re.compile(r"\b(woods?|forest|ravine|greenbelt|natural area|preserve|arboretum)\b|^interlaken park$", re.I)
NOT_WOOD_NAME = re.compile(r"wetland|slough|marsh|pond|meadow|farm|union bay", re.I)
# A park slope steeper than this (rise over run, ~14 deg) is wooded.
STEEP = 0.25


def is_wood(p):
    k, n = p.get("k"), p.get("n") or ""
    if k in WOOD_KINDS:
        return True
    if k == "nature_reserve":
        return not NOT_WOOD_NAME.search(n)
    if k in ("park", "garden", "recreation_ground") and n:
        return bool(WOODED_NAME.search(n)) and not NOT_WOOD_NAME.search(n)
    return False


def paint(polys):
    im = Image.new("L", (MASK_N, MASK_N), 0)
    d = ImageDraw.Draw(im)
    tx = lambda pts: [((x + MAP_HALF) / MASK_STEP, (z + MAP_HALF) / MASK_STEP) for x, z in pts]
    for p in polys:
        d.polygon(tx(p["o"]), fill=255)
        for h in p.get("h", []):
            d.polygon(tx(h), fill=0)
    return np.asarray(im) > 0


def main():
    green = json.load(open(os.path.join(DATA, "raw_green.json")))["green"]
    surf = np.array(Image.open(os.path.join(SRC, "surface.png")).convert("RGB"))
    assert surf.shape[0] == MASK_N, f"surface.png is {surf.shape[0]} wide, expected {MASK_N}"
    grn = surf[:, :, 1] > 127

    wood = paint([p for p in green if is_wood(p)])
    scrub = paint([p for p in green if p.get("k") == "scrub"])
    open_ = paint([p for p in green if p.get("k") in ("pitch", "beach")])

    # Steep green: the slope of the shipped 40 m heightfield, read at each
    # 10 m cell's nearest height sample.
    hp = np.array(Image.open(os.path.join(SRC, "height.png")).convert("RGB")).astype(np.float64)
    h = ((hp[:, :, 0] * 256) + hp[:, :, 1]) / 10 - 100
    gz, gx = np.gradient(h, HF_STEP)
    slope = np.hypot(gx, gz)
    idx = np.clip(np.round(np.arange(MASK_N) * MASK_STEP / HF_STEP).astype(int), 0, h.shape[0] - 1)
    steep = slope[np.ix_(idx, idx)] > STEEP
    steep &= h[np.ix_(idx, idx)] > 2.0   # not the shore band

    b = np.zeros((MASK_N, MASK_N), dtype=np.uint8)
    b[grn & scrub] = 170
    b[grn & (wood | (steep & ~open_))] = 255
    b[grn & open_ & ~wood] = 85
    # Auto KW: THE FIELDS. Outside the green, blue is which crop a farm
    # field (OSM landuse=farmland) stands in this October -- geo.farmAt,
    # world.groundTint: 30 standing corn, 60 soybeans gone gold, 90 wheat
    # stubble, 120 ploughed, 150 hay and pasture, 180 winter wheat up green,
    # 210 a farmyard. Picked per field from its OSM id, weighted to what
    # Waterloo Region grows.
    farms_p = os.path.join(DATA, "raw_farms.json")
    nf = 0
    if os.path.exists(farms_p):
        CROPS = [30, 30, 30, 60, 60, 60, 90, 90, 120, 120, 150, 150, 180]
        fim = Image.new("L", (MASK_N, MASK_N), 0)
        fd = ImageDraw.Draw(fim)
        tx = lambda pts: [((x + MAP_HALF) / MASK_STEP, (z + MAP_HALF) / MASK_STEP) for x, z in pts]
        farms = json.load(open(farms_p))["farms"]
        # biggest first, so a farmyard drawn inside a field stays on top
        for f in sorted(farms, key=lambda f: -abs(sum(a[0] * b[1] - b[0] * a[1] for a, b in zip(f["o"], f["o"][1:] + f["o"][:1])))):
            code = 210 if f["k"] == "farmyard" else 150 if f["k"] in ("orchard", "vineyard", "plant_nursery") \
                else CROPS[(f["id"] * 2654435761 >> 7) % len(CROPS)]
            fd.polygon(tx(f["o"]), fill=code)
            nf += 1
        farm = np.asarray(fim)
        wet = surf[:, :, 0] > 127
        mask = (~grn) & (~wet) & (farm > 0)
        b[mask] = farm[mask]
        print(f"fields: {nf} farm polygons, {mask.mean() * 100:.1f} % of the map")
        # THE FREEWAYS' RIGHT-OF-WAY, 240 (geo.farmAt 8): mown grass, no
        # crop. OSM's farmland polygons run to the highway's centreline, so
        # standing corn and soy (crops.js, whose far blocks are flat-topped
        # beige walls) grew to the edge of Hwy 7/8's embankment -- "the beige
        # slab beside Hwy 7/8 west" -- and the open country's township parcels
        # (world.groundTint) did the same where OSM maps no field. A 400-series
        # highway's fence is ~15 m past the shoulder (highways.js's clear zone,
        # CLEAR_MAIN / CLEAR_RAMP, is the same band for the trees); the strip
        # inside it is mown verge. Widths as build_roads.py's half_width.
        ROW = {"motorway": (7.0, 6, 15.0), "trunk": (7.0, 6, 15.0),
               "motorway_link": (3.4, 1, 9.0), "trunk_link": (3.4, 1, 9.0)}
        rim = Image.new("L", (MASK_N, MASK_N), 0)
        rd = ImageDraw.Draw(rim)
        nrow = 0
        for r in json.load(open(os.path.join(DATA, "raw_roads.json")))["roads"]:
            if r["cls"] not in ROW or r.get("tn") in ("yes", "building_passage"):
                continue
            mn, dl, clear = ROW[r["cls"]]
            try:
                ln = float(str(r.get("ln", dl)).split(";")[0])
            except ValueError:
                ln = dl
            hw = max(mn, min(20.0, ln * 1.8 + 1.0))
            px = (hw + clear) / MASK_STEP
            pts = tx(r["p"])
            rd.line(pts, fill=255, width=max(1, int(round(2 * px))))
            for x, y in pts:
                rd.ellipse([x - px, y - px, x + px, y + px], fill=255)
            nrow += 1
        row = (np.asarray(rim) > 0) & (~grn) & (~wet)
        b[row] = 240
        print(f"right-of-way: {nrow} freeway ways, {row.mean() * 100:.2f} % of the map kept mown")
    surf[:, :, 2] = b
    Image.fromarray(surf, "RGB").save(os.path.join(OUT, "surface.png"), optimize=True)

    cell = MASK_STEP * MASK_STEP / 1e6
    print(f"wood {np.count_nonzero(b == 255) * cell:.1f} km2 (tagged {np.count_nonzero(grn & wood) * cell:.1f}, "
          f"steep green {np.count_nonzero(grn & steep & ~wood & ~open_) * cell:.1f}), "
          f"scrub {np.count_nonzero(b == 170) * cell:.1f}, open {np.count_nonzero(b == 85) * cell:.1f}, "
          f"lawn {np.count_nonzero(grn & (b == 0)) * cell:.1f} km2")
    # Probes: a named park's share of wood, against what it is. Asserted, like
    # the raster's own probes -- believe these over a screenshot.
    probes = [("Huron Natural Area", 0.0), ("Homer Watson Park", 0.0), ("Waterloo Park", 0.0),
              ("Victoria Park", 0.0), ("Bechtel Park", 0.0), ("Laurel Creek Conservation Area", 0.0),
              ("Riverside Park", 0.0), ("Breithaupt Park", 0.0)]
    bad = 0
    for name, want in probes:
        m = paint([p for p in green if p.get("n") == name])
        share = np.count_nonzero(m & (b == 255)) / max(1, np.count_nonzero(m & grn))
        ok = share >= want
        bad += not ok
        print(f"  {'ok  ' if ok else 'FAIL'} {name}: {share * 100:.0f} % wood (want >= {want * 100:.0f} %)")
    for name in ():
        m = paint([p for p in green if p.get("n") == name])
        if np.count_nonzero(m):
            print(f"       {name}: {np.count_nonzero(m & (b == 255)) * 100 / max(1, np.count_nonzero(m & grn)):.0f} % wood, "
                  f"{np.count_nonzero(m & (b == 85)) * 100 / max(1, np.count_nonzero(m & grn)):.0f} % open")
    if bad:
        sys.exit(1)


if __name__ == "__main__":
    main()
