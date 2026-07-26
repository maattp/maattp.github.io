"""Draw the whole imported city top-down, so road layout can be eyeballed.

Rendering the graph from above is the cheapest way to find layout bugs, and none
of them are visible at street level.
"""

import os
import struct
import sys

import numpy as np
from PIL import Image, ImageDraw

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from proj import MAP_HALF  # noqa: E402

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "apps", "auto", "data")
PX = 2600
SCALE = PX / (MAP_HALF * 2)

STYLE = {  # cls -> (width px, colour)
    0: (3.0, "#f0c860"),   # hwy
    1: (2.0, "#d8dcd0"),   # art
    2: (1.4, "#9fa398"),   # st
    3: (0.9, "#71756c"),   # res
    4: (1.6, "#c8a24e"),   # ramp
}


def load_roads():
    with open(os.path.join(OUT, "roads.bin"), "rb") as f:
        buf = f.read()
    magic, ver, ncount, nodes_n, edges_n = struct.unpack_from("<4sHHII", buf, 0)
    assert magic == b"AUTR", magic
    o = 16
    nodes = np.frombuffer(buf, dtype=np.dtype([
        ("x", "<i4"), ("z", "<i4"), ("y", "<i2"), ("elev", "u1"), ("pad", "u1")]),
        count=nodes_n, offset=o)
    o += nodes_n * 12
    edges = np.frombuffer(buf, dtype=np.dtype([
        ("a", "<u4"), ("b", "<u4"), ("cls", "u1"), ("flags", "u1"),
        ("hw", "<u2"), ("name", "<u2"), ("pad", "<u2")]), count=edges_n, offset=o)
    return nodes, edges


def main():
    nodes, edges = load_roads()
    surf = np.asarray(Image.open(os.path.join(OUT, "surface.png")).convert("RGB"))
    water = surf[:, :, 0] > 0
    green = surf[:, :, 1] > 0

    base = np.zeros((water.shape[0], water.shape[1], 3), dtype=np.uint8)
    base[:] = (26, 32, 27)
    base[green] = (40, 66, 42)
    base[water] = (20, 42, 60)
    img = Image.fromarray(base).resize((PX, PX), Image.BILINEAR)
    d = ImageDraw.Draw(img)

    X = lambda v: (v / 10.0 + MAP_HALF) * SCALE  # noqa: E731
    for cls in (3, 2, 4, 1, 0):
        w, col = STYLE[cls]
        sel = edges[edges["cls"] == cls]
        for e in sel:
            a, b = nodes[e["a"]], nodes[e["b"]]
            d.line([X(a["x"]), X(a["z"]), X(b["x"]), X(b["z"])],
                   fill=col, width=max(1, int(round(w))))
    # bridges and elevated decks on top, in a colour that stands out
    for e in edges:
        if not (e["flags"] & 1):
            continue
        a, b = nodes[e["a"]], nodes[e["b"]]
        d.line([X(a["x"]), X(a["z"]), X(b["x"]), X(b["z"])], fill="#ff5b5b", width=2)

    p = os.path.join(os.path.dirname(os.path.abspath(__file__)), "data", "map.png")
    img.save(p)
    print(f"{p}  {PX}x{PX}  {os.path.getsize(p)/1e6:.1f} MB")


if __name__ == "__main__":
    main()
