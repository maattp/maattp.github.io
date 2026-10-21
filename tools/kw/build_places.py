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
OUT = os.path.join(HERE, "..", "..", "apps", "autokw", "data")

# kind -> (OSM name, hint lat, hint lon). The hint only has to be close enough
# to pick the right one out of the duplicates; it is never used as the position.
LANDMARKS = [
]

# Where the player starts, and where the hospital puts them back. Both are real
# places, and citygen keeps buildings off them (G.KEEP_CLEAR).
# Waterloo Public Square, on the courtyard by the rink's north end, looking
# south-west across the rink to the Shops at Waterloo Town Square's main
# entrance, the leaf shades and Beertown (kwplaces.js draws the square). The
# red coupe is at the nearest kerb, King St's west side (main.js).
# (Not on OSM's drinking fountain at (-3825.8, -1348.0), which it first was.)
SPAWN_LL = (43.464151, -80.522312)
SPAWN_HEADING = -0.72                 # rotation.y: toward the mall's entrance (-3857.7, -1316.1)
RESPAWN_LL = (43.45680, -80.51060)   # Grand River Hospital, KW campus


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

    # Landmarks whose hint IS the answer. The POI snap works when the node
    # names a building; an airport's POI is wherever the mapper dropped it --
    # here 783 m from the reference point, which would lay the runway across
    # the terminal. The ARP is a surveyed coordinate; trust it.
    PINNED = {"airport"}
    out_lm, missing = [], []
    for kind, name, lat, lon in LANDMARKS:
        p = best(pois["pois"], name, (lat, lon))
        if p is None and kind not in PINNED:
            missing.append(name)
            continue
        hx, hz = to_world(lat, lon)
        if kind in PINNED or p is None:
            out_lm.append({"kind": kind, "name": name, "x": hx, "z": hz, "rot": 0.0})
            print(f"  {kind:16s} {name[:34]:36s} ({hx:7.0f},{hz:7.0f})  pinned to the hint")
            continue
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
    heading = SPAWN_HEADING
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
