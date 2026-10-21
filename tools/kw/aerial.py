"""An aerial photo of a spot, for checking a building's roof, layout and parking.

    tools/.venv/bin/python tools/kw/aerial.py <x> <z> <out.jpg> [zoom=18] [tiles=3]

(x, z) are world metres (tools/kw/proj.py). Esri World Imagery tiles (no key),
stitched tiles x tiles round the point. For looking, not for shipping: the
imagery is Esri's.
"""

import io
import math
import os
import sys
import urllib.request

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from proj import to_latlon  # noqa: E402
from PIL import Image  # noqa: E402

URL = "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"


def main():
    x, z, out = float(sys.argv[1]), float(sys.argv[2]), sys.argv[3]
    zoom = int(sys.argv[4]) if len(sys.argv) > 4 else 18
    n = int(sys.argv[5]) if len(sys.argv) > 5 else 3
    lat, lon = to_latlon(x, z)
    s = 2 ** zoom
    tx = (lon + 180) / 360 * s
    ty = (1 - math.log(math.tan(math.radians(lat)) + 1 / math.cos(math.radians(lat))) / math.pi) / 2 * s
    x0, y0 = int(tx) - n // 2, int(ty) - n // 2
    img = Image.new("RGB", (256 * n, 256 * n))
    for i in range(n):
        for j in range(n):
            req = urllib.request.Request(URL.format(z=zoom, y=y0 + j, x=x0 + i), headers={"User-Agent": "autokw-aerial/1"})
            data = urllib.request.urlopen(req, timeout=20).read()
            img.paste(Image.open(io.BytesIO(data)).convert("RGB"), (256 * i, 256 * j))
    img.save(out, quality=85)
    print(out, f"{lat:.5f},{lon:.5f}", f"{156543.03 * math.cos(math.radians(lat)) / s:.2f} m/px")


if __name__ == "__main__":
    main()
