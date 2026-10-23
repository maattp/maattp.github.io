"""An aerial photograph round a point of the game's world, to check a model against.

    tools/.venv/bin/python tools/kw/aerial.py <out.jpg> <x> <z> [half_size_m=250] [zoom=18]

Stitches Esri World Imagery tiles (no key) round world (x, z), north up, and
marks the game's grid every 100 m along the top and left edges, so a corner
read off the photograph is a world coordinate (kwsights.js's FAIR_* quads and
kwplaces.js's MALL_COURTS came from it). One pixel is (2 * half_size) / 1100 m.
"""

import io
import math
import os
import sys
import urllib.request

from PIL import Image, ImageDraw

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from proj import to_latlon  # noqa: E402

URL = "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"
SIZE = 1100


def tile_xy(lat, lon, zoom):
    n = 2 ** zoom
    tx = (lon + 180) / 360 * n
    ty = (1 - math.log(math.tan(math.radians(lat)) + 1 / math.cos(math.radians(lat))) / math.pi) / 2 * n
    return tx, ty


def main():
    out, x, z = sys.argv[1], float(sys.argv[2]), float(sys.argv[3])
    hs = float(sys.argv[4]) if len(sys.argv) > 4 else 250.0
    zoom = int(sys.argv[5]) if len(sys.argv) > 5 else 18
    tx0, ty0 = tile_xy(*to_latlon(x - hs, z - hs), zoom)   # north-west corner
    tx1, ty1 = tile_xy(*to_latlon(x + hs, z + hs), zoom)   # south-east
    fx, fy = math.floor(tx0), math.floor(ty0)
    im = Image.new("RGB", ((math.floor(tx1) - fx + 1) * 256, (math.floor(ty1) - fy + 1) * 256))
    for ty in range(fy, math.floor(ty1) + 1):
        for tx in range(fx, math.floor(tx1) + 1):
            req = urllib.request.Request(URL.format(z=zoom, y=ty, x=tx), headers={"User-Agent": "Mozilla/5.0"})
            try:
                im.paste(Image.open(io.BytesIO(urllib.request.urlopen(req, timeout=20).read())).convert("RGB"),
                         ((tx - fx) * 256, (ty - fy) * 256))
            except OSError as e:
                print("tile failed", tx, ty, e)
    im = im.crop((int((tx0 - fx) * 256), int((ty0 - fy) * 256), int((tx1 - fx) * 256), int((ty1 - fy) * 256))).resize((SIZE, SIZE))
    d = ImageDraw.Draw(im)
    k = SIZE / (2 * hs)
    for g in range(int((x - hs) // 100 + 1) * 100, int(x + hs), 100):
        X = (g - x + hs) * k
        d.line([(X, 0), (X, 10)], fill=(255, 255, 0))
        d.text((X + 2, 10), str(g), fill=(255, 255, 0))
    for g in range(int((z - hs) // 100 + 1) * 100, int(z + hs), 100):
        Z = (g - z + hs) * k
        d.line([(0, Z), (10, Z)], fill=(255, 255, 0))
        d.text((12, Z - 5), str(g), fill=(255, 255, 0))
    # AERIAL_FP=1: the importer's footprints (raw_buildings.json) in cyan and a 10 m grid,
    # so a part of a building read off the photograph is a world coordinate to the metre
    if os.environ.get("AERIAL_FP"):
        import json
        for g in range(int((x - hs) // 10 + 1) * 10, int(x + hs), 10):
            X = (g - x + hs) * k
            d.line([(X, 0), (X, SIZE)], fill=(255, 255, 0) if g % 50 == 0 else (110, 110, 60), width=1)
        for g in range(int((z - hs) // 10 + 1) * 10, int(z + hs), 10):
            Z = (g - z + hs) * k
            d.line([(0, Z), (SIZE, Z)], fill=(255, 255, 0) if g % 50 == 0 else (110, 110, 60), width=1)
        here = os.path.dirname(os.path.abspath(__file__))
        for b in json.load(open(os.path.join(here, "data", "raw_buildings.json")))["buildings"]:
            o = b["o"]
            if all(abs(q[0] - x) > hs or abs(q[1] - z) > hs for q in o):
                continue
            pts = [((q[0] - x + hs) * k, (q[1] - z + hs) * k) for q in o]
            d.line(pts + [pts[0]], fill=(0, 255, 255), width=2)
    im.save(out, quality=85)
    print(out)


if __name__ == "__main__":
    main()
