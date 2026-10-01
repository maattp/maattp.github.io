"""Ferry routes, terminals and slip dolphins in the map from OSM -> tools/data/raw_ferry.json.

    tools/.venv/bin/python tools/extract_ferry.py

One full scan of the state extract (~75 s), like extract_rail.py. Keeps every
route=ferry way touching the map box (with its name, operator and node ids,
for stitching), every amenity=ferry_terminal (node or way, as a point), and the
man_made=dolphin / mooring structures near the water that a slip is built of.
build_ferry.py makes the game's route from this.
"""

import json
import os
import sys

import osmium

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from proj import to_world, bbox  # noqa: E402

HERE = os.path.dirname(os.path.abspath(__file__))
PBF = os.path.join(HERE, "data", "washington-latest.osm.pbf")
OUT = os.path.join(HERE, "data", "raw_ferry.json")
S, W, N, E = bbox(3000)
TAGS = ("route", "name", "operator", "ref", "duration", "motor_vehicle", "amenity", "man_made", "seamark:type")


def inside(ll):
    return any(S < la < N and W < lo < E for la, lo in ll)


class Grab(osmium.SimpleHandler):
    def __init__(self):
        super().__init__()
        self.routes, self.terminals, self.dolphins = [], [], []

    def node(self, n):
        t = n.tags
        if t.get("amenity") == "ferry_terminal" or t.get("man_made") in ("dolphin", "mooring"):
            la, lo = n.location.lat, n.location.lon
            if not (S < la < N and W < lo < E):
                return
            x, z = to_world(la, lo)
            rec = {"id": n.id, "x": round(x, 2), "z": round(z, 2), "t": {k: t.get(k) for k in TAGS if t.get(k) is not None}}
            (self.terminals if t.get("amenity") == "ferry_terminal" else self.dolphins).append(rec)

    def way(self, w):
        t = w.tags
        ferry = t.get("route") == "ferry"
        term = t.get("amenity") == "ferry_terminal"
        dol = t.get("man_made") in ("dolphin", "mooring")
        if not (ferry or term or dol):
            return
        try:
            ll = [(nd.lat, nd.lon) for nd in w.nodes]
        except osmium.InvalidLocationError:
            return
        if not inside(ll):
            return
        pts = [[round(v, 2) for v in to_world(la, lo)] for la, lo in ll]
        rec = {"id": w.id, "ids": [nd.ref for nd in w.nodes], "p": pts,
               "t": {k: t.get(k) for k in TAGS if t.get(k) is not None}}
        if ferry:
            self.routes.append(rec)
        elif term:
            self.terminals.append(rec)
        else:
            self.dolphins.append(rec)


if __name__ == "__main__":
    g = Grab()
    g.apply_file(PBF, locations=True, idx="flex_mem")
    print("routes", len(g.routes), "terminals", len(g.terminals), "dolphins", len(g.dolphins))
    for r in g.routes:
        print("  route", r["id"], r["t"].get("name"), len(r["p"]), "pts")
    for t in g.terminals:
        print("  terminal", t["id"], t["t"].get("name"), t.get("x", t["p"][0][0] if "p" in t else None))
    with open(OUT, "w") as f:
        json.dump({"routes": g.routes, "terminals": g.terminals, "dolphins": g.dolphins}, f)
    print("wrote", OUT, os.path.getsize(OUT) // 1024, "KB")
