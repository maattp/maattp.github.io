"""OSM's piers -> apps/auto/data/piers.json.

    tools/.venv/bin/python tools/build_piers.py

One scan of the state extract (~15 s): every man_made=pier way in the map
box -- closed ones are the deck's outline (Smith Cove's Piers 90 and 91, the
waterfront's piers, the ferry terminals), open ones a walkway, written with its
`width` tag or 3 m. Projected, simplified to ~0.5 m. landmarks.js/piers.js
builds each as a deck on piles and registers the deck as walkable ground.
"""

import json
import math
import os
import sys

import osmium

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from proj import to_world  # noqa: E402

HERE = os.path.dirname(os.path.abspath(__file__))
PBF = os.path.join(HERE, "data", "washington-latest.osm.pbf")
OUT = os.environ.get("AUTO_DATA_OUT") or os.path.join(HERE, "..", "apps", "auto", "data")
S, N, W, E = 47.490, 47.732, -122.515, -122.160


class Grab(osmium.SimpleHandler):
    def __init__(self):
        super().__init__()
        self.piers = []

    def way(self, w):
        t = w.tags
        if t.get("man_made") != "pier":
            return
        try:
            ll = [(nd.lat, nd.lon) for nd in w.nodes]
        except osmium.InvalidLocationError:
            return
        if not any(S < la < N and W < lo < E for la, lo in ll):
            return
        pts = [[round(v, 1) for v in to_world(la, lo)] for la, lo in ll]
        closed = w.nodes[0].ref == w.nodes[-1].ref and len(pts) >= 4
        try:
            width = float((t.get("width") or "3").split()[0])
        except ValueError:
            width = 3.0
        self.piers.append({"p": pts, "closed": closed, "w": width, "name": t.get("name")})


def area(p):
    return abs(sum(a[0] * b[1] - b[0] * a[1] for a, b in zip(p, p[1:] + p[:1]))) / 2


def main():
    g = Grab()
    g.apply_file(PBF, locations=True, idx="flex_mem")
    out = [q for q in g.piers if (area(q["p"]) > 60 if q["closed"] else sum(math.hypot(b[0] - a[0], b[1] - a[1]) for a, b in zip(q["p"], q["p"][1:])) > 8)]
    names = [q["name"] for q in out if q["name"]]
    big = sorted([q for q in out if q["closed"]], key=lambda q: -area(q["p"]))[:8]
    print(len(out), "piers,", sum(q["closed"] for q in out), "outlines; largest:", ", ".join(f"{q['name'] or '?'} {area(q['p']):.0f} m2" for q in big))
    assert len(out) > 50, "too few piers"
    path = os.path.join(OUT, "piers.json")
    with open(path, "w") as f:
        json.dump({"piers": out}, f, separators=(",", ":"))
    print("wrote", path, os.path.getsize(path) // 1024, "KB")


if __name__ == "__main__":
    main()
