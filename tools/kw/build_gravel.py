"""The unpaved roads of Waterloo Region -> apps/autokw/data/gravel.json.

    tools/.venv/bin/python tools/kw/build_gravel.py

The townships' concession roads and sideroads (Wellesley, Woolwich, Wilmot,
North Dumfries) are mapped `surface=gravel` / `unpaved` / `compacted` / ... in
OSM: ~140 km of the roads inside the map. raw_roads.json (osm_extract.py) does
not carry the surface tag, so this scans the .pbf once (~20 s) for the way ids
whose surface is loose, and writes the same polylines build_roads.py meshes
(raw_roads.json's geometry, cropped to the map and simplified the same way)
with the half-width build_roads gives them:

    {"w": [[hw, x0, z0, x1, z1, ...], ...], "n": count, "km": total length}

The game reads it in src/gravel.js: the road mesh is drawn in gravel's colour
without paint (world.js, `e.gravel`), and your car's tyres find gravel's grip
on it (vehicles.js SURFACES, `city.gravelAt`).
"""

import json
import math
import os
import sys

import osmium

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from build_roads import CLS, ALLEY_HW, SIMPLIFY, half_width, simplify, clip_runs  # noqa: E402

HERE = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.join(HERE, "data")
PBF = os.path.join(DATA, "kw.osm.pbf")
OUT = os.environ.get("AUTO_DATA_OUT") or os.path.join(HERE, "..", "..", "apps", "autokw", "data")

LOOSE = {"gravel", "fine_gravel", "unpaved", "compacted", "dirt", "ground", "earth", "pebblestone", "sand"}


class Surfaces(osmium.SimpleHandler):
    def __init__(self):
        super().__init__()
        self.ids = {}

    def way(self, w):
        if "highway" in w.tags and w.tags.get("surface") in LOOSE:
            self.ids[w.id] = w.tags.get("surface")


def main():
    h = Surfaces()
    h.apply_file(PBF)
    print(f"{len(h.ids)} loose-surface highway ways in the extract")
    roads = json.load(open(os.path.join(DATA, "raw_roads.json")))["roads"]
    out, km, kinds = [], 0.0, {}
    for w in roads:
        s = h.ids.get(w["id"])
        if not s:
            continue
        cls = CLS.get(w["cls"])
        if cls is None or str(w.get("acc", "")).lower() in ("private", "no"):
            continue
        if str(w.get("br", "no")).lower() not in ("no", "") or str(w.get("tn", "no")).lower() not in ("no", ""):
            continue
        hw = ALLEY_HW if w["cls"] == "service" else half_width(cls, w)
        for run in clip_runs([tuple(p) for p in w["p"]]):
            pts = simplify(run, SIMPLIFY)
            if len(pts) < 2:
                continue
            flat = [round(hw, 1)]
            for x, z in pts:
                flat += [round(x, 1), round(z, 1)]
            out.append(flat)
            L = sum(math.hypot(pts[i + 1][0] - pts[i][0], pts[i + 1][1] - pts[i][1]) for i in range(len(pts) - 1))
            km += L / 1000
            kinds[s] = kinds.get(s, 0) + L / 1000
    print(f"{len(out)} polylines, {km:.1f} km: " + ", ".join(f"{k} {v:.1f}" for k, v in sorted(kinds.items(), key=lambda kv: -kv[1])))
    with open(os.path.join(OUT, "gravel.json"), "w") as f:
        json.dump({"w": out, "n": len(out), "km": round(km, 1)}, f, separators=(",", ":"))


if __name__ == "__main__":
    main()
