"""Landmarks, neighbourhood names and the fixed spawn points.

Landmark positions come from OSM rather than from a hand-typed table of
latitudes: the mesh for each one already exists in landmarks.js, and all this
has to do is put it where the real thing is. Matching is by exact name, with a
hint position to disambiguate -- there is a Museum of Pop Culture in Bellevue
too, and it is 10 km off the east edge of the map.
"""

import json
import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from proj import MAP_HALF, to_world  # noqa: E402

HERE = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.join(HERE, "data")
OUT = os.path.join(HERE, "..", "apps", "auto", "data")

# kind -> (OSM name, hint lat, hint lon). The hint only has to be close enough
# to pick the right one out of the duplicates; it is never used as the position.
LANDMARKS = [
    ("spaceNeedle", "Space Needle", 47.6205, -122.3493),
    ("mopop", "Museum of Pop Culture", 47.6215, -122.3481),
    ("arena", "Climate Pledge Arena", 47.6221, -122.3540),
    ("spheres", "The Spheres", 47.6155, -122.3391),
    ("market", "Pike Place Market", 47.6097, -122.3422),
    ("wheel", "Seattle Great Wheel", 47.6062, -122.3425),
    ("aquarium", "Seattle Aquarium", 47.6076, -122.3430),
    ("ferry", "Colman Dock, Map 1: Entry Building", 47.6019, -122.3387),
    ("library", "The Seattle Public Library - Central Library", 47.6067, -122.3325),
    ("stadiumF", "Lumen Field", 47.5952, -122.3316),
    ("stadiumB", "T-Mobile Park", 47.5914, -122.3325),
    ("gasworks", "Gas Works Park", 47.6456, -122.3344),
    ("troll", "Fremont Troll", 47.6510, -122.3474),
    ("locks", "Hiram M. Chittenden Locks", 47.6656, -122.3970),
    ("kerry", "Kerry Park", 47.6295, -122.3599),
    ("stadiumH", "Husky Stadium", 47.6503, -122.3016),
    ("ferriswheelPier", "Alki Beach Park", 47.5811, -122.4058),
    ("convention", "Seattle Convention Center Arch", 47.6116, -122.3316),
    ("pier", "Pier 66", 47.6113, -122.3494),
]

# Where the player starts, and where the hospital puts them back. Both are real
# places, and citygen keeps buildings off them (G.KEEP_CLEAR).
SPAWN_LL = (47.6186, -122.3510)      # 5th Ave N & Broad St, looking at the Needle
RESPAWN_LL = (47.6032, -122.3236)    # Harborview Medical Center


def best(pois, name, hint, radius=1500):
    hx, hz = to_world(*hint)
    cands = []
    for p in pois:
        if abs(p["x"]) > MAP_HALF or abs(p["z"]) > MAP_HALF:
            continue
        n = p["n"]
        if n == name or (name.lower() in n.lower() and len(n) < len(name) + 22):
            d = math.hypot(p["x"] - hx, p["z"] - hz)
            if d <= radius:
                cands.append((0 if n == name else 1, d, p))
    if not cands:
        return None
    cands.sort(key=lambda c: (c[0], c[1]))
    return cands[0][2]


def orientation(name, buildings):
    """Principal axis of the matching footprint, so the mesh faces the right way."""
    for b in buildings:
        if b.get("n") == name and len(b["o"]) >= 4:
            pts = b["o"]
            best_len, ang = 0.0, 0.0
            for i in range(len(pts) - 1):
                dx = pts[i + 1][0] - pts[i][0]
                dz = pts[i + 1][1] - pts[i][1]
                L = math.hypot(dx, dz)
                if L > best_len:
                    best_len, ang = L, math.atan2(dx, dz)
            return round(ang, 3)
    return 0.0


def main():
    pois = json.load(open(os.path.join(DATA, "raw_pois.json")))
    buildings = json.load(open(os.path.join(DATA, "raw_buildings.json")))["buildings"]
    named = [b for b in buildings if b.get("n")]

    out_lm, missing = [], []
    for kind, name, lat, lon in LANDMARKS:
        p = best(pois["pois"], name, (lat, lon))
        if p is None:
            missing.append(name)
            continue
        hx, hz = to_world(lat, lon)
        err = math.hypot(p["x"] - hx, p["z"] - hz)
        out_lm.append({"kind": kind, "name": name, "x": p["x"], "z": p["z"],
                       "rot": orientation(p["n"], named)})
        print(f"  {kind:16s} {p['n'][:34]:36s} ({p['x']:7.0f},{p['z']:7.0f})  "
              f"{err:5.0f} m from the hint")
    if missing:
        print(f"  MISSING: {missing}")

    places = [p for p in pois["places"]
              if abs(p["x"]) <= MAP_HALF and abs(p["z"]) <= MAP_HALF]
    # Neighbourhoods first: a `city` node would otherwise win the whole map.
    rank = {"neighbourhood": 0, "quarter": 1, "suburb": 2, "borough": 3, "locality": 4}
    places.sort(key=lambda p: rank.get(p["p"], 9))

    sx, sz = to_world(*SPAWN_LL)
    rx, rz = to_world(*RESPAWN_LL)
    needle = next((l for l in out_lm if l["kind"] == "spaceNeedle"), None)
    heading = 0.0
    if needle:
        # heading is a three.js rotation.y, so forward is (sin h, cos h).
        heading = round(math.atan2(needle["x"] - sx, needle["z"] - sz), 3)

    doc = {
        "landmarks": out_lm,
        "places": [{"n": p["n"], "x": p["x"], "z": p["z"]} for p in places],
        "spawn": {"x": round(sx, 1), "z": round(sz, 1), "heading": heading},
        "respawn": {"x": round(rx, 1), "z": round(rz, 1)},
    }
    p = os.path.join(OUT, "places.json")
    with open(p, "w") as f:
        json.dump(doc, f, separators=(",", ":"))
    print(f"\nplaces.json  {os.path.getsize(p)/1000:.0f} kB  "
          f"({len(out_lm)} landmarks, {len(places)} place names)")
    print(f"spawn ({sx:.0f},{sz:.0f}) heading {heading}   respawn ({rx:.0f},{rz:.0f})")
    return len(missing) == 0


if __name__ == "__main__":
    sys.exit(0 if main() else 1)
