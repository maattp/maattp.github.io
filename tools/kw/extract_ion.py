"""ION's street furniture from OSM -> tools/kw/data/raw_ion.json.

    tools/.venv/bin/python tools/kw/extract_ion.py      (then build_ion.py)

extract_rail.py keeps the tracks and the stations; this keeps what the
station and crossing builders need besides: every platform near a light-rail
line (railway=platform or public_transport=platform, as a line or an area,
with name / ref / area), every level crossing on one (railway=level_crossing
/ crossing with its crossing:barrier, :bell, :light tags), and the streets
that carry embedded rails (embedded_rails=*), so build_ion.py can say which
stretches run in the street.
"""

import json
import os
import sys

import osmium

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from proj import to_world, bbox  # noqa: E402

HERE = os.path.dirname(os.path.abspath(__file__))
PBF = os.path.join(HERE, "data", "kw.osm.pbf")
OUT = os.path.join(HERE, "data", "raw_ion.json")
S, W, N, E = bbox(500)
XTAGS = ("railway", "crossing", "crossing:barrier", "crossing:bell", "crossing:light", "crossing:saltire",
         "crossing:activation", "highway", "name")
PTAGS = ("railway", "public_transport", "name", "ref", "area", "light_rail", "train", "bus", "operator",
         "shelter", "bench", "covered", "tactile_paving", "local_ref")


class Grab(osmium.SimpleHandler):
    def __init__(self):
        super().__init__()
        self.platforms, self.crossings, self.embedded = [], [], []

    def node(self, n):
        t = n.tags
        if t.get("railway") not in ("level_crossing", "crossing"):
            return
        la, lo = n.location.lat, n.location.lon
        if not (S < la < N and W < lo < E):
            return
        x, z = to_world(la, lo)
        self.crossings.append({"id": n.id, "x": round(x, 2), "z": round(z, 2),
                               "t": {k: t.get(k) for k in XTAGS if t.get(k) is not None}})

    def way(self, w):
        t = w.tags
        plat = t.get("railway") == "platform" or (t.get("public_transport") == "platform" and t.get("bus") != "yes")
        emb = t.get("embedded_rails") is not None and t.get("highway") is not None
        if not (plat or emb):
            return
        try:
            ll = [(nd.lat, nd.lon) for nd in w.nodes]
        except osmium.InvalidLocationError:
            return
        if not any(S < la < N and W < lo < E for la, lo in ll):
            return
        pts = [[round(v, 2) for v in to_world(la, lo)] for la, lo in ll]
        if plat:
            self.platforms.append({"id": w.id, "p": pts, "closed": w.nodes[0].ref == w.nodes[-1].ref,
                                   "t": {k: t.get(k) for k in PTAGS if t.get(k) is not None}})
        if emb:
            self.embedded.append({"id": w.id, "p": pts, "t": {"highway": t.get("highway"), "name": t.get("name"),
                                                              "embedded_rails": t.get("embedded_rails")}})


if __name__ == "__main__":
    g = Grab()
    g.apply_file(PBF, locations=True, idx="flex_mem")
    print("platforms", len(g.platforms), "crossings", len(g.crossings), "embedded streets", len(g.embedded))
    with open(OUT, "w") as f:
        json.dump({"platforms": g.platforms, "crossings": g.crossings, "embedded": g.embedded}, f)
    print("wrote", OUT, os.path.getsize(OUT) // 1024, "KB")
