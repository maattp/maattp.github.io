"""Every drive-through lane in the box -> tools/data/kw/raw_drivethru.json.

    tools/.venv/bin/python tools/kw/extract_drivethru.py

OSM maps a drive-through as highway=service + service=drive-through, drawn
the way the cars go: from the lot, past the menu board, to the window and out.
build_shops.py hands each to the fast-food pad it wraps (shops.json `dt`).

  lanes  [{id, p: [[x, z], ...], oneway}]
"""

import json
import os
import sys

import osmium

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from proj import MAP_HALF, to_world  # noqa: E402

HERE = os.path.dirname(os.path.abspath(__file__))
PBF = os.path.join(HERE, "data", "kw.osm.pbf")
OUT = os.path.join(HERE, "data", "raw_drivethru.json")


class H(osmium.SimpleHandler):
    def __init__(self):
        super().__init__()
        self.lanes = []

    def way(self, w):
        t = w.tags
        if t.get("highway") != "service" or t.get("service") != "drive-through":
            return
        p = []
        try:
            for nd in w.nodes:
                x, z = to_world(nd.lat, nd.lon)
                if not p or abs(x - p[-1][0]) + abs(z - p[-1][1]) > 0.2:
                    p.append([round(x, 1), round(z, 1)])
        except osmium.InvalidLocationError:
            return
        if len(p) < 2:
            return
        cx, cz = sum(q[0] for q in p) / len(p), sum(q[1] for q in p) / len(p)
        if abs(cx) > MAP_HALF or abs(cz) > MAP_HALF:
            return
        ow = t.get("oneway")
        self.lanes.append({"id": w.id, "p": p, "oneway": -1 if ow == "-1" else (0 if ow == "no" else 1)})


def main():
    h = H()
    h.apply_file(PBF, locations=True)
    h.lanes.sort(key=lambda r: r["id"])
    with open(OUT, "w") as f:
        json.dump({"lanes": h.lanes}, f, separators=(",", ":"))
    print(f"raw_drivethru.json: {len(h.lanes)} lanes")


if __name__ == "__main__":
    main()
