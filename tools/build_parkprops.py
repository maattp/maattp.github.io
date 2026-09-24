"""Park furniture from OSM -> apps/auto/data/parkprops.json.

    tools/.venv/bin/python tools/build_parkprops.py

One full scan of the state extract (~2-8 min), like build_monorail.py. It keeps
the small things people actually use in a park, as mapped: benches, picnic
tables, playgrounds and drinking fountains. osm_extract.py only keeps NAMED
points of interest, and none of these has a name. world.js draws them into
each chunk's own meshes (no draws), in parks and along the waterfronts.
"""

import json
import os
import sys

import osmium

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from proj import to_world, MAP_HALF  # noqa: E402

HERE = os.path.dirname(os.path.abspath(__file__))
PBF = os.path.join(HERE, "data", "washington-latest.osm.pbf")
OUT = os.environ.get("AUTO_DATA_OUT") or os.path.join(HERE, "..", "apps", "auto", "data")


def kind_of(t):
    if t.get("amenity") == "bench" or t.get("leisure") == "bench":
        return "bench"
    if t.get("leisure") == "picnic_table" or t.get("amenity") == "picnic_table" or t.get("tourism") == "picnic_site" and t.get("picnic_table"):
        return "picnic"
    if t.get("leisure") == "playground":
        return "playground"
    if t.get("amenity") == "drinking_water":
        return "fountain"
    return None


class Grab(osmium.SimpleHandler):
    def __init__(self):
        super().__init__()
        self.out = {"bench": [], "picnic": [], "playground": [], "fountain": []}

    def keep(self, k, lat, lon, extra=None):
        x, z = to_world(lat, lon)
        if abs(x) >= MAP_HALF - 5 or abs(z) >= MAP_HALF - 5:
            return
        rec = [round(x, 1), round(z, 1)]
        if extra is not None:
            rec += extra
        self.out[k].append(rec)

    def node(self, n):
        k = kind_of(n.tags)
        if k:
            d = n.tags.get("direction")
            try:
                d = float(d) if d is not None else None
            except ValueError:
                d = None
            self.keep(k, n.location.lat, n.location.lon, [round(d)] if (k == "bench" and d is not None) else None)

    def area(self, a):
        k = kind_of(a.tags)
        if k != "playground":
            return
        for ring in a.outer_rings():
            pts = [(nd.lat, nd.lon) for nd in ring]
            if len(pts) < 3:
                continue
            w = [to_world(la, lo) for la, lo in pts]
            cx = sum(p[0] for p in w) / len(w)
            cz = sum(p[1] for p in w) / len(w)
            s = 0.0
            for i in range(len(w) - 1):
                s += w[i][0] * w[i + 1][1] - w[i + 1][0] * w[i][1]
            r = (abs(s) / 2 / 3.14159) ** 0.5
            if abs(cx) >= MAP_HALF - 5 or abs(cz) >= MAP_HALF - 5:
                continue
            self.out["playground"].append([round(cx, 1), round(cz, 1), round(min(r, 40), 1)])
            break


def main():
    g = Grab()
    g.apply_file(PBF, locations=True)
    # a playground mapped as a point gets an 8 m radius
    g.out["playground"] = [p if len(p) == 3 else p + [8.0] for p in g.out["playground"]]
    for k in g.out:
        g.out[k].sort()
    with open(os.path.join(OUT, "parkprops.json"), "w") as f:
        json.dump({"source": "OpenStreetMap contributors (ODbL), via tools/build_parkprops.py", **g.out}, f, separators=(",", ":"))
    print("parkprops.json: " + ", ".join(f"{len(v)} {k}" for k, v in g.out.items()),
          f"{os.path.getsize(os.path.join(OUT, 'parkprops.json')) / 1e3:.0f} KB")


if __name__ == "__main__":
    main()
