"""The food-delivery job's restaurants and doors -> apps/autokw/data/eats.json.

    tools/.venv/bin/python tools/kw/build_eats.py     (after extract_shops.py)

RESTAURANTS are real: the chain stores from raw_shops.json whose brand is in
CHAINS, and the local places in LOCAL by OSM name (every branch OSM maps),
plus the few OSM lacks (EXTRA, with the address they were checked at). Each
gets a food KIND, which sets how much a hard turn or a hard stop spoils it
(the game's `KINDS` table, src/kweats.js).

DOORS are real addressed homes: every OSM building in the box tagged as a
house / detached / semi / terrace / apartments / residential with
addr:housenumber + addr:street. The door is the point of the footprint
nearest to its own street (raw_roads.json, by name), so the courier pulls up
on the right street, at the right side of the house. One home is kept per
CELL m square (an apartment block wins its cell), which spreads them over
every neighbourhood at ~5 k doors instead of 28 k.

  r  [[name, x, z, kind], ...]
  s  [street, ...]                      street names, indexed by h
  h  [[x, z, number, street index, flats], ...]   door points; flats 1 = apartments
"""

import json
import math
import os
import sys
from collections import defaultdict

import osmium

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from proj import MAP_HALF, to_world  # noqa: E402

HERE = os.path.dirname(os.path.abspath(__file__))
PBF = os.path.join(HERE, "data", "kw.osm.pbf")
SHOPS = os.path.join(HERE, "data", "raw_shops.json")
ROADS = os.path.join(HERE, "data", "raw_roads.json")
OUT = os.path.join(HERE, "..", "..", "apps", "autokw", "data", "eats.json")

CELL = 170
HOMES = {"house", "detached", "semidetached_house", "terrace", "apartments", "residential", "bungalow"}

# brand (raw_shops brand / name) -> kind
CHAINS = {
    "Pizza Pizza": "pizza", "Swiss Chalet": "chicken", "Harvey's": "burger", "Popeyes": "chicken",
    "KFC": "chicken", "Boston Pizza": "pizza", "Wendy's": "burger", "A&W": "burger",
}
# OSM name (exact, or a prefix ending in '*') -> kind
LOCAL = {
    "Lazeez*": "shawarma", "Pita Pit": "pita", "Ennio's*": "pasta", "Morty's Pub": "wings",
    "Gino's Pizza": "pizza", "Mozy's Shawarma": "shawarma", "Shelby's Legendary Shawarma": "shawarma",
    "Campus Pizza": "pizza", "Kismet": "curry", "Ken Sushi": "sushi", "Bao Sandwich Bar": "sandwich",
    "Abe Erb": "burger", "Beertown Public House": "burger", "Lancaster Smokehouse": "bbq",
    "The Crazy Canuck": "wings", "Mel's Diner": "burger", "The Bauer Kitchen": "pasta",
    "Kinkaku Izakaya": "ramen",
}
# not in OSM (Oct 2026)
EXTRA = [
    # 170 University Ave W, University Shops Plaza (shopping-canada.com listing)
    ("Mr. Panino's Beijing House", 43.4717, -80.5380, "chinese"),
]


def match_local(name):
    for k, kind in LOCAL.items():
        if (k.endswith("*") and name.startswith(k[:-1])) or name == k:
            return kind
    return None


def restaurants():
    d = json.load(open(SHOPS))
    out, seen = [], set()
    for s in d["stores"]:
        t, n = s["t"], s["n"]
        if t.get("amenity") not in ("restaurant", "fast_food", "pub", "cafe"):
            continue
        kind = CHAINS.get(t.get("brand") or "") or CHAINS.get(n) or match_local(n)
        if not kind:
            continue
        key = (n, round(s["x"] / 30), round(s["z"] / 30))
        if key in seen or abs(s["x"]) > MAP_HALF - 200 or abs(s["z"]) > MAP_HALF - 200:
            continue
        seen.add(key)
        if n.startswith("Lazeez"):
            n = "Lazeez Shawarma"   # (one branch is mapped "Shwarma")
        out.append([t.get("brand") or n, round(s["x"], 1), round(s["z"], 1), kind])
    for n, lat, lon, kind in EXTRA:
        x, z = to_world(lat, lon)
        out.append([n, round(x, 1), round(z, 1), kind])
    return out


class Homes(osmium.SimpleHandler):
    def __init__(self):
        super().__init__()
        self.h = []

    def way(self, w):
        t = w.tags
        if t.get("building") not in HOMES or "addr:housenumber" not in t or "addr:street" not in t:
            return
        try:
            pts = [to_world(n.location.lat, n.location.lon) for n in w.nodes]
        except osmium.InvalidLocationError:
            return
        if len(pts) < 4:
            return
        cx = sum(p[0] for p in pts) / len(pts)
        cz = sum(p[1] for p in pts) / len(pts)
        if abs(cx) > MAP_HALF - 300 or abs(cz) > MAP_HALF - 300:
            return
        self.h.append((cx, cz, pts, t["addr:housenumber"], t["addr:street"], t.get("building") == "apartments"))


def seg_near(px, pz, ax, az, bx, bz):
    dx, dz = bx - ax, bz - az
    l2 = dx * dx + dz * dz or 1e-9
    t = max(0.0, min(1.0, ((px - ax) * dx + (pz - az) * dz) / l2))
    qx, qz = ax + dx * t, az + dz * t
    return math.hypot(px - qx, pz - qz), qx, qz


def main():
    rs = restaurants()
    print(len(rs), "restaurants")
    roads = defaultdict(list)   # name -> grid cell -> segments
    G = 200
    for r in json.load(open(ROADS))["roads"]:
        n = r.get("name")
        if not n:
            continue
        p = r["p"]
        for i in range(len(p) - 1):
            (ax, az), (bx, bz) = p[i], p[i + 1]
            for cx in range(int(math.floor(min(ax, bx) / G)), int(math.floor(max(ax, bx) / G)) + 1):
                for cz in range(int(math.floor(min(az, bz) / G)), int(math.floor(max(az, bz) / G)) + 1):
                    roads[(n, cx, cz)].append((ax, az, bx, bz))
    H = Homes()
    H.apply_file(PBF, locations=True)
    print(len(H.h), "addressed homes")
    cells = {}
    miss = 0
    for cx, cz, pts, num, street, flats in H.h:
        # the street's nearest segment within 120 m
        best = None
        gx, gz = int(math.floor(cx / G)), int(math.floor(cz / G))
        for ix in (gx - 1, gx, gx + 1):
            for iz in (gz - 1, gz, gz + 1):
                for seg in roads.get((street, ix, iz), ()):
                    d, qx, qz = seg_near(cx, cz, *seg)
                    if best is None or d < best[0]:
                        best = (d, qx, qz)
        if not best or best[0] > 120:
            miss += 1
            continue
        _, qx, qz = best
        # the door: the footprint's outline point nearest the street
        door = None
        for i in range(len(pts) - 1):
            d, dx, dz = seg_near(qx, qz, pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1])
            if door is None or d < door[0]:
                door = (d, dx, dz)
        key = (int(cx // CELL), int(cz // CELL))
        cur = cells.get(key)
        if cur is None or (flats and not cur[5]):
            cells[key] = (door[1], door[2], num, street, flats, flats)
    print(miss, "without their street nearby")
    streets = sorted({c[3] for c in cells.values()})
    si = {s: i for i, s in enumerate(streets)}
    homes = [[round(x, 1), round(z, 1), num, si[st], 1 if fl else 0] for x, z, num, st, fl, _ in cells.values()]
    homes.sort(key=lambda h: (h[0], h[1]))
    print(len(homes), "doors kept,", sum(h[4] for h in homes), "apartment blocks,", len(streets), "streets")
    with open(OUT, "w") as f:
        json.dump({"src": "OpenStreetMap (ODbL)", "r": rs, "s": streets, "h": homes}, f, separators=(",", ":"))
    print("wrote", OUT, os.path.getsize(OUT), "bytes")


if __name__ == "__main__":
    main()
