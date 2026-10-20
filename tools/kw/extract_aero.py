"""Every aeroway in the box -> tools/kw/data/raw_aero.json (runways, taxiways, aprons, helipads)."""
import json
import os
import sys

import osmium

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from proj import to_world  # noqa: E402

HERE = os.path.dirname(os.path.abspath(__file__))
PBF = os.path.join(HERE, "data", "kw.osm.pbf")
OUT = os.path.join(HERE, "data", "raw_aero.json")


class Grab(osmium.SimpleHandler):
    def __init__(self):
        super().__init__()
        self.out = []

    def way(self, w):
        a = w.tags.get("aeroway")
        if not a:
            return
        try:
            pts = [[round(v, 1) for v in to_world(n.lat, n.lon)] for n in w.nodes]
        except osmium.InvalidLocationError:
            return
        self.out.append({"k": a, "ref": w.tags.get("ref"), "n": w.tags.get("name"), "w": w.tags.get("width"),
                         "sf": w.tags.get("surface"), "closed": w.nodes[0].ref == w.nodes[-1].ref, "p": pts})


if __name__ == "__main__":
    g = Grab()
    g.apply_file(PBF, locations=True, idx="flex_mem")
    json.dump({"aero": g.out}, open(OUT, "w"))
    import collections
    print(len(g.out), collections.Counter(o["k"] for o in g.out))
    for o in g.out:
        if o["k"] == "runway":
            print("runway", o["ref"], o["w"], o["sf"], o["p"][0], o["p"][-1])
