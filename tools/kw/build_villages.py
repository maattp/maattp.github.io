"""The villages' main streets -> apps/autokw/data/villages.json.

    tools/.venv/bin/python tools/kw/build_villages.py

src/kwvillages.js draws each village's main street from these: every
building with a wall on it (OSM footprint, levels, the shops OSM maps
inside it) as a small-town Ontario main-street building -- a converted
1880s house with a shop window and a sign board, a false front, or a
two-storey brick commercial block (kwplaces.js meshKing) -- plus St.
Jacobs' own: the mill at the King St bridge and the Village Silos.

  main   [{v, p, lv, n, bt, s, kind}]   v the village; kind 'block' or 'house'
  mill   St. Jacobs' mill (the footprint at the bridge, King and Front)

Only St. Jacobs' King Street is a real shopping street (`all`); in the other
villages a building on the main road is drawn only when OSM maps a shop in
it. Elmira, Wellesley, New Hamburg, Baden (Castle Kilbride), Ayr and Linwood
are off the map (it ends 15.6 km from its centre).
"""

import json
import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from build_kw import _clean, _levels, _in_poly, _area, _seg_dist, PLACE_SHOP_AMENITY  # noqa: E402

HERE = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.join(HERE, "data")
OUT = os.path.join(HERE, "..", "..", "apps", "autokw", "data")

# (key, streets, bbox x0 z0 x1 z1, every building or only those with a shop)
VILLAGES = [
    ("stjacobs", ("King Street North",), (-6470, -9875, -6300, -9440), True),
    ("conestogo", ("Sawmill Road", "Glasgow Street North", "Glasgow Street South"), (-2800, -10300, -2000, -9500), False),
    ("heidelberg", ("Lobsinger Line", "King Street"), (-12100, -8000, -11300, -7200), False),
    ("stclements", ("Lobsinger Line", "Herrgott Road"), (-14700, -8200, -13900, -7600), False),
    ("maryhill", ("Maryhill Road", "Saint Charles Street East", "Saint Charles Street West"), (6400, -9500, 7200, -8800), False),
    ("breslau", ("Woolwich Street South", "Woolwich Street North", "Fountain Street North"), (4600, -3100, 5600, -2000), False),
    ("newdundee", ("Main Street", "Queen Street", "Bridge Street"), (-5300, 11000, -4600, 11800), False),
]
MILL = (-6376, -9858)    # the St. Jacobs mill at the King St bridge (OSM: untagged)


def main():
    blds = json.load(open(os.path.join(DATA, "raw_buildings.json")))["buildings"]
    pois = json.load(open(os.path.join(DATA, "raw_pois.json")))["pois"]
    roads = json.load(open(os.path.join(DATA, "raw_roads.json")))["roads"]
    cen = lambda o: (sum(q[0] for q in o) / len(o), sum(q[1] for q in o) / len(o))  # noqa: E731
    shops = [p for p in pois if p.get("n") and (p["t"].get("shop") or p["t"].get("amenity") in PLACE_SHOP_AMENITY | {"post_office", "library", "ice_cream"})
             and p["t"].get("shop") != "vacant"]
    out = {"main": []}
    mill = None
    for b in blds:
        cx, cz = cen(b["o"])
        if math.hypot(cx - MILL[0], cz - MILL[1]) < 8:
            mill = {"p": _clean(b["o"])}
    assert mill, "the St. Jacobs mill's footprint is gone"
    out["mill"] = mill
    for v, names, (x0, z0, x1, z1), every in VILLAGES:
        lines = [r["p"] for r in roads if r.get("name") in names
                 and any(x0 - 50 < q[0] < x1 + 50 and z0 - 50 < q[1] < z1 + 50 for q in r["p"])]
        segs = [(l[i], l[i + 1]) for l in lines for i in range(len(l) - 1)]
        sh = [p for p in shops if x0 - 30 < p["x"] < x1 + 30 and z0 - 30 < p["z"] < z1 + 30]
        n0 = len(out["main"])
        for b in blds:
            o = b["o"]
            cx, cz = cen(o)
            if not (x0 < cx < x1 and z0 < cz < z1):
                continue
            if math.hypot(cx - MILL[0], cz - MILL[1]) < 8:
                continue
            bt = str(b.get("bt", "yes")).lower()
            if bt in ("parking", "roof", "garage", "garages", "service", "church", "shed", "school", "retail", "industrial"):
                continue
            pts = _clean(o)
            if len(pts) < 3:
                continue
            A = abs(_area(pts))
            if A < 45 or A > (2600 if every else 1500):
                continue
            if not segs or min(_seg_dist(q[0], q[1], a, c) for q in pts for a, c in segs) > 20:
                continue
            inside = []
            for p in sh:
                if _in_poly(pts, p["x"], p["z"]) or min(math.hypot(p["x"] - q[0], p["z"] - q[1]) for q in pts) < 2.5:
                    k = p["t"].get("shop") or p["t"].get("amenity")
                    if p["n"] not in [s[0] for s in inside]:
                        inside.append([p["n"], k, p["t"].get("brand", "")])
            if not every and not inside:
                continue
            # a two-storey commercial block, or an old house turned into a shop
            xs, zs = [q[0] for q in pts], [q[1] for q in pts]
            kind = "block" if A >= 330 or (b.get("n") and A >= 200) else "house"
            out["main"].append({"v": v, "p": pts, "lv": _levels(b.get("lv")), "n": b.get("n") or "", "bt": bt, "s": inside, "kind": kind})
            del xs, zs
        got = out["main"][n0:]
        print(f"  {v}: {len(got)} main-street buildings ({sum(1 for g in got if g['kind'] == 'block')} blocks), "
              f"{sum(len(g['s']) for g in got)} shops")
    p = os.path.join(OUT, "villages.json")
    with open(p, "w") as f:
        json.dump(out, f, separators=(",", ":"), ensure_ascii=False)
    print(f"villages.json {os.path.getsize(p) // 1024} KB")


if __name__ == "__main__":
    main()
