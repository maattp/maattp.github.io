"""Waterloo Region's landmarks beyond Uptown -> apps/autokw/data/sights.json.

    tools/.venv/bin/python tools/kw/build_sights.py

What src/kwsights.js draws from its real footprint, by the OSM centroid each
building has (the nearest footprint within 12 m):
  b        {key: {p, lv, ht, n, bt}} -- Kitchener City Hall, the Market,
           Centre in the Square, the Breithaupt Block (Google), the Tannery,
           Kaufman Lofts, Bauer Lofts, Victoria Park's pavilion, boathouse and
           island shelter, Schneider Haus, the Aud, Fairview Park, Bingemans,
           the Waterloo Region Museum, Homer Watson House, Toyota's plant,
           the Cambridge Mill, the Old Post Office (Idea Exchange), the Forbes
           mill in Hespeler.
  king     downtown Kitchener's King St and Galt's Main / Water / Ainslie St:
           every low building with a wall on the street and the shops OSM maps
           inside it, in kwplaces.js's `king` format ({p, lv, ht, n, bt, s}),
           `pal` 'stone' for Galt (the "Stone Town").
  doon     Doon Heritage Village's small unnamed buildings (the 1914 village).
  boardwalk  the Boardwalk's big boxes (named retail footprints).
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

SIGHTS = {
    "cityhall": (-1417, 34),       # Kitchener City Hall, 200 King St W (1993, KPMB)
    "market": (-700, 441),         # Kitchener Market, 300 King St E (2004)
    "centre": (-727, -268),        # Centre in the Square, 101 Queen St N (1980)
    "tannery": (-1879, 100),       # The Tannery, 151 Charles St W (Communitech)
    "bb1": (-1948, -243),          # Breithaupt Block, the 1903 Merchants Rubber factory (Google)
    "bb2": (-2046, -205),          # Breithaupt Block phase II
    "bb3": (-2075, -306),          # Breithaupt Block phase III, 11 storeys
    "kaufman": (-1788, -93),       # Kaufman Lofts, 410 King St W (Albert Kahn, 1907-25)
    "bauer": (-3536, -839),        # Bauer Lofts, 191 King St S, Waterloo (15 storeys)
    "bauerS1": (-3591, -847),      # the 1917 Bauer factory
    "bauerS2": (-3569, -869),
    "vicpav": (-1955, 700),        # Victoria Park Pavilion (1924)
    "boathouse": (-1672, 540),     # The Boathouse
    "island": (-1789, 589),        # the shelter on the island (building=roof)
    "schneider": (-1622, 788),     # Joseph Schneider Haus (1816)
    "aud": (638, 540),             # Kitchener Memorial Auditorium
    "fairview": (2909, 3087),      # CF Fairview Park
    "bing": (1816, -2536),         # Bingemans Conference Centre (Marshall Hall)
    "museum": (2938, 5724),        # Ken Seiling Waterloo Region Museum (2010)
    "homer": (4562, 6351),         # Homer Watson House & Gallery
    "toyota": (8474, 3676),        # TMMC, Cambridge
    "cmill": (12864, 9832),        # Cambridge Mill (the 1842 Dickson mill)
    "cmillpav": (12856, 9757),     # its pavilion
    "opo": (12908, 10406),         # Idea Exchange, the Old Post Office (1885)
    "forbes": (12492, 2740),       # Forbes Textile Mill, Hespeler
}

# Main streets drawn as heritage blocks: (name, streets, bbox x0 z0 x1 z1, palette)
MAIN_STREETS = [
    ("kitchener", ("King Street West", "King Street East", "King Street"), (-1900, -350, -350, 700), "brick"),
    ("galt", ("Main Street", "Water Street North", "Water Street South", "Ainslie Street North",
              "Ainslie Street South", "Dickson Street"), (12780, 10150, 13250, 10560), "stone"),
]
DOON = (2740, 5440, 3070, 5700)


def main():
    blds = json.load(open(os.path.join(DATA, "raw_buildings.json")))["buildings"]
    pois = json.load(open(os.path.join(DATA, "raw_pois.json")))["pois"]
    roads = json.load(open(os.path.join(DATA, "raw_roads.json")))["roads"]
    cen = lambda o: (sum(q[0] for q in o) / len(o), sum(q[1] for q in o) / len(o))
    out = {"b": {}}
    near = {}
    for b in blds:
        cx, cz = cen(b["o"])
        for key, (px, pz) in SIGHTS.items():
            d = math.hypot(cx - px, cz - pz)
            if d < 12 and (key not in near or d < near[key][0]):
                near[key] = (d, b)
    for key, (d, b) in near.items():
        out["b"][key] = {"p": _clean(b["o"]), "lv": _levels(b.get("lv")), "ht": b.get("ht"), "n": b.get("n") or "", "bt": b.get("bt", "")}
    missing = [k for k in SIGHTS if k not in out["b"]]
    assert not missing, f"sight footprints not found: {missing}"
    taken = [v["p"] for v in out["b"].values()]

    shops = [p for p in pois if p.get("n") and (p["t"].get("shop") or p["t"].get("amenity") in PLACE_SHOP_AMENITY)
             and p["t"].get("shop") != "vacant"]
    king = []
    for town, names, (x0, z0, x1, z1), pal in MAIN_STREETS:
        lines = [r["p"] for r in roads if r.get("name") in names
                 and any(x0 - 50 < q[0] < x1 + 50 and z0 - 50 < q[1] < z1 + 50 for q in r["p"])]
        segs = [(l[i], l[i + 1]) for l in lines for i in range(len(l) - 1)]
        sh = [p for p in shops if x0 - 30 < p["x"] < x1 + 30 and z0 - 30 < p["z"] < z1 + 30]
        n0 = len(king)
        for b in blds:
            o = b["o"]
            cx, cz = cen(o)
            if not (x0 < cx < x1 and z0 < cz < z1):
                continue
            bt = str(b.get("bt", "yes")).lower()
            if bt in ("parking", "roof", "garage", "garages", "service", "church", "shed", "civic", "public", "government"):
                continue
            lv = _levels(b.get("lv"))
            if lv and lv > 5:
                continue
            pts = _clean(o)
            if len(pts) < 3 or any(_in_poly(t, cx, cz) for t in taken):
                continue
            A = abs(_area(pts))
            if A < 40 or A > 1600:
                continue
            if min(_seg_dist(q[0], q[1], a, c) for q in pts for a, c in segs) > 22:
                continue
            inside = []
            for p in sh:
                if _in_poly(pts, p["x"], p["z"]) or min(math.hypot(p["x"] - q[0], p["z"] - q[1]) for q in pts) < 2.5:
                    k = p["t"].get("shop") or p["t"].get("amenity")
                    if p["n"] not in [s[0] for s in inside]:
                        inside.append([p["n"], k, p["t"].get("brand", "")])
            r = {"p": pts, "lv": lv, "ht": b.get("ht"), "n": b.get("n") or "", "bt": bt, "s": inside}
            if pal != "brick":
                r["pal"] = pal
            king.append(r)
        print(f"  {town}: {len(king) - n0} main-street buildings, {sum(len(k['s']) for k in king[n0:])} shops")
    out["king"] = king

    doon = []
    x0, z0, x1, z1 = DOON
    for b in blds:
        cx, cz = cen(b["o"])
        if x0 < cx < x1 and z0 < cz < z1 and not b.get("n"):
            pts = _clean(b["o"])
            A = abs(_area(pts))
            if 15 < A < 700 and len(pts) >= 4:
                doon.append({"p": pts, "bt": b.get("bt", "")})
    out["doon"] = doon
    print(f"  doon: {len(doon)} village buildings")

    bw = []
    for b in blds:
        cx, cz = cen(b["o"])
        if -7500 < cx < -6500 and 1400 < cz < 2700:
            pts = _clean(b["o"])
            if abs(_area(pts)) < 400:
                continue
            ins = [p["n"] for p in shops if _in_poly(pts, p["x"], p["z"]) and p["n"] != b.get("n")]
            if b.get("n") or ins:
                bw.append({"p": pts, "n": b.get("n") or "", "s": ins})
    out["boardwalk"] = bw
    print(f"  boardwalk: {len(bw)} named stores: " + ", ".join(b["n"] + str(b["s"]) for b in bw))

    p = os.path.join(OUT, "sights.json")
    with open(p, "w") as f:
        json.dump(out, f, separators=(",", ":"), ensure_ascii=False)
    print(f"sights.json {os.path.getsize(p) // 1024} KB: {len(out['b'])} landmarks")


if __name__ == "__main__":
    main()
