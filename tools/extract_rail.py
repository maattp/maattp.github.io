"""Every railway in the map from OSM -> tools/data/raw_rail.json.

    tools/.venv/bin/python tools/extract_rail.py

One full scan of the state extract (~75 s), like build_monorail.py. It keeps
railway ways of the kinds the game drives -- light_rail (Link), rail (the BNSF
and Union Pacific main lines, their yards and sidings), subway and tram -- that
touch the map box, with the tags that matter (usage, service, name, ref,
tunnel, bridge, layer, level, electrified, gauge), their node ids for
stitching and their projected points; and the stations and stops. Link is
built from this by build_link.py; the freight lines are in it too.
"""

import json
import os
import sys

import osmium

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from proj import to_world, bbox  # noqa: E402

HERE = os.path.dirname(os.path.abspath(__file__))
PBF = os.path.join(HERE, "data", "washington-latest.osm.pbf")
OUT = os.path.join(HERE, "data", "raw_rail.json")
# the map box and a little more (the crops below are against MAP_HALF)
S, W, N, E = bbox(500)
KEEP = {"light_rail", "rail", "subway", "tram", "narrow_gauge"}
TAGS = ("railway", "usage", "service", "name", "ref", "tunnel", "bridge", "layer", "level",
        "electrified", "gauge", "operator", "railway:preferred_direction", "covered", "embankment", "cutting")


class Grab(osmium.SimpleHandler):
    def __init__(self):
        super().__init__()
        self.ways, self.stops = [], []

    def node(self, n):
        t = n.tags
        rw = t.get("railway")
        pt = t.get("public_transport")
        if rw in ("station", "halt", "stop", "tram_stop") or (pt in ("station", "stop_position") and (t.get("light_rail") == "yes" or t.get("train") == "yes")):
            la, lo = n.location.lat, n.location.lon
            if not (S < la < N and W < lo < E):
                return
            x, z = to_world(la, lo)
            self.stops.append({"id": n.id, "name": t.get("name"), "railway": rw, "pt": pt, "light_rail": t.get("light_rail"),
                               "train": t.get("train"), "station": t.get("station"), "x": round(x, 2), "z": round(z, 2)})

    def way(self, w):
        t = w.tags
        rw = t.get("railway")
        if rw not in KEEP and not (rw == "platform"):
            return
        try:
            ll = [(nd.lat, nd.lon) for nd in w.nodes]
        except osmium.InvalidLocationError:
            return
        if not any(S < la < N and W < lo < E for la, lo in ll):
            return
        pts = [[round(v, 2) for v in to_world(la, lo)] for la, lo in ll]
        self.ways.append({"id": w.id, "ids": [nd.ref for nd in w.nodes], "p": pts,
                          "t": {k: t.get(k) for k in TAGS if t.get(k) is not None}})


if __name__ == "__main__":
    g = Grab()
    g.apply_file(PBF, locations=True, idx="flex_mem")
    kinds = {}
    for w in g.ways:
        kinds[w["t"].get("railway")] = kinds.get(w["t"].get("railway"), 0) + 1
    print("ways", len(g.ways), kinds, "stops", len(g.stops))
    with open(OUT, "w") as f:
        json.dump({"ways": g.ways, "stops": g.stops}, f)
    print("wrote", OUT, os.path.getsize(OUT) // 1024, "KB")
