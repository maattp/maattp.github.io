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
OUT = os.environ.get("AUTO_DATA_OUT") or os.path.join(HERE, "..", "apps", "auto", "data")
SRC = os.path.join(HERE, "..", "apps", "auto", "data")
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
    surf[:, :, 2] = b
    Image.fromarray(surf, "RGB").save(os.path.join(OUT, "surface.png"), optimize=True)

    cell = MASK_STEP * MASK_STEP / 1e6
    print(f"wood {np.count_nonzero(b == 255) * cell:.1f} km2 (tagged {np.count_nonzero(grn & wood) * cell:.1f}, "
          f"steep green {np.count_nonzero(grn & steep & ~wood & ~open_) * cell:.1f}), "
          f"scrub {np.count_nonzero(b == 170) * cell:.1f}, open {np.count_nonzero(b == 85) * cell:.1f}, "
          f"lawn {np.count_nonzero(grn & (b == 0)) * cell:.1f} km2")
    # Probes: a named park's share of wood, against what it is. Asserted, like
    # the raster's own probes -- believe these over a screenshot.
    probes = [("Discovery Park", 0.55), ("Seward Park", 0.6), ("Schmitz Preserve Park", 0.9),
              ("Carkeek Park", 0.85), ("Washington Park Arboretum", 0.8), ("Camp Long", 0.9),
              ("Interlaken Park", 0.8), ("Lincoln Park", 0.6)]
    bad = 0
    for name, want in probes:
        m = paint([p for p in green if p.get("n") == name])
        share = np.count_nonzero(m & (b == 255)) / max(1, np.count_nonzero(m & grn))
        ok = share >= want
        bad += not ok
        print(f"  {'ok  ' if ok else 'FAIL'} {name}: {share * 100:.0f} % wood (want >= {want * 100:.0f} %)")
    for name in ("Green Lake Park", "Jefferson Park", "Woodland Park", "Volunteer Park", "Cal Anderson Park"):
        m = paint([p for p in green if p.get("n") == name])
        if np.count_nonzero(m):
            print(f"       {name}: {np.count_nonzero(m & (b == 255)) * 100 / max(1, np.count_nonzero(m & grn)):.0f} % wood, "
                  f"{np.count_nonzero(m & (b == 85)) * 100 / max(1, np.count_nonzero(m & grn)):.0f} % open")
    if bad:
        sys.exit(1)


if __name__ == "__main__":
    main()
