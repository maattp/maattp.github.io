"""Erbsville Kartway -> apps/autokw/data/kart.json.

    tools/.venv/bin/python tools/kw/build_kart.py

The outdoor go-kart track at 4057 Erbsville Rd, Waterloo (1959-2021). OSM
has its centreline as two `highway=raceway` ways named "Erbsville Kartway"
(CanVec's import): the circuit and the 20 m bridge that carries it over
itself -- it is a figure eight with an overpass. Here: the circuit as one
closed loop in race order (OSM's way order, the bridge last, from its far
end round to its start), which segment is the bridge, and the property's
outline (the tourism=attraction area). src/kart.js draws and races it.
"""

import json
import math
import os
import sys

import osmium

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from proj import to_world  # noqa: E402

HERE = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.join(HERE, "data")
OUT = os.path.join(HERE, "..", "..", "apps", "autokw", "data")
NAME = "Erbsville Kartway"


class Grab(osmium.SimpleHandler):
    def __init__(self):
        super().__init__()
        self.ways = []

    def way(self, w):
        if w.tags.get("name") != NAME:
            return
        try:
            p = [[round(c, 2) for c in to_world(n.lat, n.lon)] for n in w.nodes]
        except osmium.InvalidLocationError:
            return
        self.ways.append({"id": w.id, "tags": dict(w.tags), "p": p})


def main():
    g = Grab()
    g.apply_file(os.path.join(DATA, "kw.osm.pbf"), locations=True)
    race = [w for w in g.ways if w["tags"].get("highway") == "raceway"]
    loop = next(w for w in race if w["tags"].get("bridge") != "yes")
    bridge = next(w for w in race if w["tags"].get("bridge") == "yes")
    area = next(w for w in g.ways if w["tags"].get("tourism") == "attraction")
    line = loop["p"]
    # the bridge closes the loop: it runs from the circuit's last node to its first
    b0, b1 = bridge["p"][0], bridge["p"][-1]
    assert math.dist(b0, line[-1]) < 0.5 and math.dist(b1, line[0]) < 0.5, "bridge does not close the loop"
    L = sum(math.dist(line[i - 1], line[i]) for i in range(len(line)))
    doc = {
        "name": NAME,
        "line": line,               # closed: the last point joins the first over the bridge
        "bridge": len(line) - 1,    # segment line[i] -> line[i + 1 mod n] is the bridge
        "outline": area["p"],
    }
    out = os.path.join(OUT, "kart.json")
    with open(out, "w") as f:
        json.dump(doc, f, separators=(",", ":"))
    print(f"kart.json {os.path.getsize(out)} B: {len(line)} points, {L:.0f} m round, outline {len(area['p'])} points")
    assert 850 < L < 1100


if __name__ == "__main__":
    main()
