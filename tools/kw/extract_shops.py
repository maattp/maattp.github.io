"""Every shop, restaurant, bank and gas station in the box, and the named
retail plazas round them -> tools/data/kw/raw_shops.json.

    tools/.venv/bin/python tools/kw/extract_shops.py

osm_extract.py's raw_pois.json keeps a node or a polygon's centroid; the
chain stores (build_shops.py) need more: whether the store IS a building
polygon (and that polygon), brand:wikidata, and the plazas -- shop=mall and
named landuse=retail areas -- as outlines, so a store can be put in its plaza
and the plaza's pylon can list its tenants.

  stores  [{n, x, z, t: {tags}, o?: [[x, z], ...] (when the store is an area)}]
  plazas  [{n, t: {tags}, o: [[x, z], ...]}]
"""

import json
import os
import sys

import osmium

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from proj import MAP_HALF, to_world  # noqa: E402

HERE = os.path.dirname(os.path.abspath(__file__))
PBF = os.path.join(HERE, "data", "kw.osm.pbf")
OUT = os.path.join(HERE, "data", "raw_shops.json")

KEEP = ("name", "brand", "brand:wikidata", "operator", "shop", "amenity", "building", "landuse", "fuel:diesel",
        "addr:housenumber", "addr:street", "addr:city", "drive_through", "cuisine", "atm")
AMENITY = {"restaurant", "fast_food", "cafe", "pharmacy", "bank", "pub", "bar", "fuel", "ice_cream", "cinema"}


def is_store(t):
    if t.get("shop") and t.get("shop") not in ("vacant", "mall"):
        return True
    return t.get("amenity") in AMENITY


def is_plaza(t):
    return bool(t.get("name")) and (t.get("shop") == "mall" or t.get("landuse") == "retail")


class H(osmium.SimpleHandler):
    def __init__(self):
        super().__init__()
        self.stores, self.plazas = [], []

    def tags(self, t):
        return {k: t[k] for k in KEEP if k in t}

    def node(self, n):
        t = n.tags
        if not t.get("name") and not t.get("brand"):
            return
        if not is_store(t):
            return
        x, z = to_world(n.location.lat, n.location.lon)
        if abs(x) > MAP_HALF or abs(z) > MAP_HALF:
            return
        self.stores.append({"n": t.get("name") or t.get("brand"), "x": round(x, 1), "z": round(z, 1), "t": self.tags(t)})

    def area(self, a):
        t = a.tags
        store, plaza = is_store(t) and (t.get("name") or t.get("brand")), is_plaza(t)
        if not store and not plaza:
            return
        ring = next(iter(a.outer_rings()), None)
        if ring is None:
            return
        o = []
        for nd in ring:
            x, z = to_world(nd.lat, nd.lon)
            if not o or abs(x - o[-1][0]) + abs(z - o[-1][1]) > 0.3:
                o.append([round(x, 1), round(z, 1)])
        if len(o) > 2 and o[0] == o[-1]:
            o.pop()
        if len(o) < 3:
            return
        cx, cz = sum(q[0] for q in o) / len(o), sum(q[1] for q in o) / len(o)
        if abs(cx) > MAP_HALF or abs(cz) > MAP_HALF:
            return
        if plaza:
            self.plazas.append({"n": t.get("name"), "t": self.tags(t), "o": o})
        if store:
            self.stores.append({"n": t.get("name") or t.get("brand"), "x": round(cx, 1), "z": round(cz, 1), "t": self.tags(t), "o": o})


def main():
    h = H()
    h.apply_file(PBF, locations=True)
    with open(OUT, "w") as f:
        json.dump({"stores": h.stores, "plazas": h.plazas}, f, separators=(",", ":"))
    print(f"raw_shops.json: {len(h.stores)} stores, {len(h.plazas)} plazas")


if __name__ == "__main__":
    main()
