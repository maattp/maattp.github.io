"""Waterloo Region's local layer -> apps/autokw/data/kw.json.

    tools/.venv/bin/python tools/kw/build_kw.py

What src/kw.js puts on top of the imported city:
  named    every named OSM building: [name, x, z, building type]. kw.js finds
           the box each one became and gives the ones it knows a real look
           (campus buildings, schools) and a name sign.
  shops    named shops, cafes and restaurants inside the DETAIL zones (the
           plazas and main streets that get storefront signs): [name, x, z,
           kind, brand].
  tims     every Tim Hortons on the map: [x, z, address]. OSM's, deduped
           (a store is often both a building and a node), plus any the
           research list has that OSM lacks (EXTRA_TIMS).
  freshco  every FreshCo: [x, z, address].
"""

import json
import math
import os
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from proj import MAP_HALF, to_world  # noqa: E402

HERE = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.join(HERE, "data")
OUT = os.path.join(HERE, "..", "..", "apps", "autokw", "data")

# Storefront signs go up inside these circles: [name, lat, lon, radius m].
ZONES = [
    ("University of Waterloo Plaza", 43.47261, -80.53690, 170),
    ("University & Bridge", 43.48926, -80.49291, 220),
    ("Uptown Waterloo", 43.46500, -80.52280, 420),
    ("Downtown Kitchener", 43.45030, -80.49000, 520),
    ("Belmont Village", 43.44400, -80.51080, 180),
    ("Laurier / King St N", 43.47600, -80.52700, 300),
    ("Galt Main Street", 43.35880, -80.31430, 300),
    ("St. Jacobs", 43.53860, -80.55380, 260),
    ("Preston King St", 43.39620, -80.35300, 200),
    ("Hespeler Queen St", 43.43200, -80.31130, 170),
]

# Tim Hortons OSM is missing, from the research list (lat, lon, address).
EXTRA_TIMS = []
EXTRA_FRESHCO = []

SHOP_AMENITY = {"restaurant", "fast_food", "cafe", "pharmacy", "bank", "pub", "bar",
                "ice_cream", "fuel", "dentist", "clinic", "post_office", "library", "cinema"}


def main():
    pois = json.load(open(os.path.join(DATA, "raw_pois.json")))["pois"]
    blds = json.load(open(os.path.join(DATA, "raw_buildings.json")))["buildings"]
    inmap = lambda x, z: abs(x) < MAP_HALF - 50 and abs(z) < MAP_HALF - 50

    named = []
    for b in blds:
        n = b.get("n")
        if not n:
            continue
        xs = [q[0] for q in b["o"]]
        zs = [q[1] for q in b["o"]]
        x, z = sum(xs) / len(xs), sum(zs) / len(zs)
        if not inmap(x, z):
            continue
        named.append([n, round(x, 1), round(z, 1), b.get("bt", "yes")])

    zones = [(nm, *to_world(la, lo), r) for nm, la, lo, r in ZONES]
    shops = []
    for p in pois:
        t = p["t"]
        k = t.get("shop") or (t.get("amenity") if t.get("amenity") in SHOP_AMENITY else None)
        if not k or not inmap(p["x"], p["z"]):
            continue
        if not any(math.hypot(p["x"] - zx, p["z"] - zz) < r for _, zx, zz, r in zones):
            continue
        shops.append([p["n"], round(p["x"], 1), round(p["z"], 1), k, t.get("brand", "")])

    def brand(match):
        out = []
        for p in pois:
            t = p["t"]
            if not match(p["n"], t) or not inmap(p["x"], p["z"]):
                continue
            addr = " ".join(v for v in (t.get("addr:housenumber"), t.get("addr:street")) if v)
            # a store mapped as a building AND a node: keep one, the addressed one
            dup = next((o for o in out if math.hypot(o[0] - p["x"], o[1] - p["z"]) < 30), None)
            if dup:
                if addr and not dup[2]:
                    dup[2] = addr
                continue
            out.append([round(p["x"], 1), round(p["z"], 1), addr])
        return out

    tims = brand(lambda n, t: "tim horton" in (n + " " + t.get("brand", "")).lower())
    fresh = brand(lambda n, t: "freshco" in (n + " " + t.get("brand", "")).lower().replace(" ", ""))
    for la, lo, addr in EXTRA_TIMS:
        x, z = to_world(la, lo)
        if inmap(x, z) and not any(math.hypot(o[0] - x, o[1] - z) < 60 for o in tims):
            tims.append([round(x, 1), round(z, 1), addr])
    for la, lo, addr in EXTRA_FRESHCO:
        x, z = to_world(la, lo)
        if inmap(x, z) and not any(math.hypot(o[0] - x, o[1] - z) < 60 for o in fresh):
            fresh.append([round(x, 1), round(z, 1), addr])

    # Footprints drawn as their real polygons (kw.js buildPolys): the schools,
    # the universities and colleges, and the stores in the two plazas that
    # matter most. Everything else stays a box.
    POLY_ZONES = [z for z in zones if z[0] in ("University of Waterloo Plaza", "University & Bridge")]
    polys = []
    for b in blds:
        bt = str(b.get("bt", "")).lower()
        n = b.get("n") or ""
        xs = [q[0] for q in b["o"]]
        zs = [q[1] for q in b["o"]]
        cx, cz = sum(xs) / len(xs), sum(zs) / len(zs)
        if not inmap(cx, cz) or len(b["o"]) < 4:
            continue
        keep = bt in ("school", "university", "college", "dormitory", "kindergarten", "stadium", "sports_centre",
                      "sports_hall", "civic", "public", "government", "townhall") \
            or re.search(r"Arena|Auditorium|Sportsplex|Recreation Complex|City Hall|Market|Perimeter|CIGI|Tannery|Google|Mill|Museum", n) \
            or re.search(r"School|Collegiate|College|University|Campus|Hall\b|Library|Centre for", n) \
            or (bt in ("retail", "commercial", "supermarket", "yes") and any(math.hypot(cx - zx, cz - zz) < r for _, zx, zz, r in POLY_ZONES))
        if not keep:
            continue
        pts = []
        for q in b["o"]:
            if not pts or math.hypot(q[0] - pts[-1][0], q[1] - pts[-1][1]) > 0.4:
                pts.append([round(q[0], 1), round(q[1], 1)])
        if len(pts) > 2 and pts[0] == pts[-1]:
            pts.pop()
        if len(pts) < 3:
            continue
        lv = b.get("lv")
        try:
            lv = float(str(lv).split(";")[0]) if lv else None
        except ValueError:
            lv = None
        polys.append([n, bt, lv, pts])

    # the airport's pavement, for kw.js's YKF (tools/kw/extract_aero.py)
    aero = {"runways": [], "taxiways": [], "aprons": [], "stands": []}
    ap = os.path.join(DATA, "raw_aero.json")
    if os.path.exists(ap):
        for o in json.load(open(ap))["aero"]:
            cx = sum(p[0] for p in o["p"]) / len(o["p"])
            cz = sum(p[1] for p in o["p"]) / len(o["p"])
            if not (5500 < cx < 9600 and -2600 < cz < 600):
                continue
            pts = [[round(p[0], 1), round(p[1], 1)] for p in o["p"]]
            if o["k"] == "runway" and o.get("ref"):
                aero["runways"].append({"ref": o["ref"], "w": float(o.get("w") or 45), "p": [pts[0], pts[-1]]})
            elif o["k"] == "taxiway":
                aero["taxiways"].append({"ref": o.get("ref") or "", "p": pts})
            elif o["k"] == "apron" and o.get("closed"):
                aero["aprons"].append({"n": o.get("n") or "", "p": pts[:-1]})
            elif o["k"] == "parking_position":
                aero["stands"].append({"ref": o.get("ref") or "", "p": [pts[0], pts[-1]]})

    doc = {"named": named, "shops": shops, "tims": tims, "freshco": fresh, "polys": polys, "aero": aero,
           "zones": [[nm, round(x), round(z), r] for nm, x, z, r in zones]}
    p = os.path.join(OUT, "kw.json")
    with open(p, "w") as f:
        json.dump(doc, f, separators=(",", ":"), ensure_ascii=False)
    print(f"  {len(polys)} footprints drawn as polygons")
    print(f"kw.json {os.path.getsize(p) // 1024} KB: {len(named)} named buildings, "
          f"{len(shops)} zone shops, {len(tims)} Tim Hortons, {len(fresh)} FreshCo")
    assert len(tims) > 40, "Tim Hortons missing"
    assert len(fresh) >= 4, "FreshCo missing"


if __name__ == "__main__":
    main()
