"""Fetch AWS terrain tiles covering the map and cache them under tools/data/dem.

Terrarium PNGs: elevation = (R * 256 + G + B / 256) - 32768 metres. Public
domain (USGS 3DEP / NED), no key, no rate limit worth worrying about.

Zoom 14 is ~6.4 m/px at Seattle's latitude, comfortably finer than the 20 m
heightfield the game bakes it into.
"""

import math
import os
import sys
import time
import urllib.request

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from proj import bbox  # noqa: E402

ZOOM = 14
MARGIN = 800  # metres of slop so bilinear sampling never runs off the edge
DEM_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "data", "dem")
URL = "https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png"


def deg2tile(lat, lon, z):
    n = 2 ** z
    xt = (lon + 180.0) / 360.0 * n
    r = math.radians(lat)
    yt = (1.0 - math.asinh(math.tan(r)) / math.pi) / 2.0 * n
    return xt, yt


def tile_range(z=ZOOM):
    min_lat, min_lon, max_lat, max_lon = bbox(MARGIN)
    x0, y0 = deg2tile(max_lat, min_lon, z)  # north-west
    x1, y1 = deg2tile(min_lat, max_lon, z)  # south-east
    return int(math.floor(x0)), int(math.floor(y0)), int(math.floor(x1)), int(math.floor(y1))


def main():
    os.makedirs(DEM_DIR, exist_ok=True)
    x0, y0, x1, y1 = tile_range()
    tiles = [(x, y) for x in range(x0, x1 + 1) for y in range(y0, y1 + 1)]
    print(f"zoom {ZOOM}: x {x0}..{x1}, y {y0}..{y1}  ({len(tiles)} tiles)")
    got = 0
    for i, (x, y) in enumerate(tiles):
        p = os.path.join(DEM_DIR, f"{ZOOM}_{x}_{y}.png")
        if os.path.exists(p) and os.path.getsize(p) > 0:
            continue
        for attempt in range(4):
            try:
                req = urllib.request.Request(URL.format(z=ZOOM, x=x, y=y),
                                             headers={"User-Agent": "auto-map-import/0.1"})
                with urllib.request.urlopen(req, timeout=45) as r:
                    data = r.read()
                with open(p, "wb") as f:
                    f.write(data)
                got += 1
                break
            except Exception as e:  # noqa: BLE001
                if attempt == 3:
                    sys.exit(f"failed {x},{y}: {e}")
                time.sleep(1.5 * (attempt + 1))
        if (i + 1) % 20 == 0:
            print(f"  {i+1}/{len(tiles)}", flush=True)
    print(f"fetched {got}, cached {len(tiles) - got}, total {len(tiles)} in {DEM_DIR}")


if __name__ == "__main__":
    main()
