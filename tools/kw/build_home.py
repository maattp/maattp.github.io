"""The north-east Waterloo the game's player grew up in, and Conestoga's Doon campus -> apps/autokw/data/home.json.

    tools/.venv/bin/python tools/kw/build_home.py

What src/kwhome.js draws from real footprints (OSM, checked against Esri
World Imagery with tools/kw/aerial.py), by the OSM centroid of each building
(the nearest footprint within 12 m):
  ub       the plaza at University Ave E & Bridge St W (425 University Ave E):
           its one 52-sided building and the shops OSM maps in it.
  uwp      the student plaza at University Ave W & Phillip St: every retail
           footprint (160 / 170 University Ave W west of Phillip, Campus
           Court's units east of it) and the shops inside or against each.
  stm      St. Matthew Catholic Elementary School (405 Pastern Trail, 1995),
           its two portables and the board's sign node.
  std      St. David Catholic Secondary School (4 High St, 1965).
  con      Conestoga College Doon: the Recreation Centre, the wings, the
           Doon residence (99 Conestoga College Blvd).
  bridge   the Bridgeport Bridge (Bridge St E over the Grand, 1934): its deck way.
"""

import json
import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from build_kw import _clean, _levels, _in_poly, _area, PLACE_SHOP_AMENITY  # noqa: E402

HERE = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.join(HERE, "data")
OUT = os.path.join(HERE, "..", "..", "apps", "autokw", "data")

BLDGS = {
    "ub": (-1373, -4134),          # 425 University Ave E: FreshCo, Rexall and the units
    "stm": (-1542, -4808),         # St. Matthew CES
    "stmP1": (-1604, -4814),       # its portables
    "stmP2": (-1614, -4807),
    "std": (-4404, -3570),         # St. David CSS
    "rec": (5473, 6993),           # Conestoga Student Recreation Centre
    "res": (5128, 7443),           # Conestoga's Doon residence, 99 Conestoga College Blvd
}
# the student plaza: every shop-like footprint in this box (x0, z0, x1, z1)
UWP_BOX = (-5140, -2420, -4850, -2180)
# Conestoga Doon's buildings, by name (the colours and heights kwhome.js gives them)
CON_BOX = (5200, 6600, 6100, 7150)
BRIDGE_WAY = 38742677


def main():
    blds = json.load(open(os.path.join(DATA, "raw_buildings.json")))["buildings"]
    pois = json.load(open(os.path.join(DATA, "raw_pois.json")))["pois"]
    roads = json.load(open(os.path.join(DATA, "raw_roads.json")))["roads"]
    cen = lambda o: (sum(q[0] for q in o) / len(o), sum(q[1] for q in o) / len(o))
    out = {}

    near = {}
    for b in blds:
        cx, cz = cen(b["o"])
        for key, (px, pz) in BLDGS.items():
            d = math.hypot(cx - px, cz - pz)
            if d < 12 and (key not in near or d < near[key][0]):
                near[key] = (d, b)
    missing = [k for k in BLDGS if k not in near]
    assert not missing, f"footprints not found: {missing}"
    for key, (d, b) in near.items():
        out[key] = {"p": _clean(b["o"]), "lv": _levels(b.get("lv")), "n": b.get("n") or ""}

    shops = [p for p in pois if p.get("n") and (p["t"].get("shop") or p["t"].get("amenity") in PLACE_SHOP_AMENITY
                                                or p["t"].get("amenity") in ("dentist", "post_office", "hookah_lounge", "driving_school"))
             and p["t"].get("shop") != "vacant"]

    def tenants(pts, pad=2.5):
        o = []
        for p in shops:
            if _in_poly(pts, p["x"], p["z"]) or min(math.hypot(p["x"] - q[0], p["z"] - q[1]) for q in pts) < pad:
                if p["n"] not in [s[0] for s in o]:
                    o.append([p["n"], round(p["x"], 1), round(p["z"], 1), p["t"].get("shop") or p["t"].get("amenity") or "", p["t"].get("brand", "")])
        return o

    # University & Bridge: the shops in the big building (not the Tims / 7-Eleven / Esso pads)
    out["ub"]["s"] = [s for s in tenants(out["ub"]["p"], 6) if not any(k in s[0] for k in ("Tim Hortons", "7-Eleven", "Esso"))]

    # the student plaza
    x0, z0, x1, z1 = UWP_BOX
    uwp = []
    for b in blds:
        cx, cz = cen(b["o"])
        if not (x0 < cx < x1 and z0 < cz < z1):
            continue
        bt = str(b.get("bt", "yes")).lower()
        if bt in ("apartments", "dormitory", "university", "parking", "roof", "house"):
            continue
        pts = _clean(b["o"])
        if len(pts) < 3 or abs(_area(pts)) < 60:
            continue
        uwp.append({"p": pts, "n": b.get("n") or "", "lv": _levels(b.get("lv")), "s": tenants(pts)})
    out["uwp"] = uwp

    # St. Matthew's sign (the board's own node)
    sign = next(p for p in pois if p.get("n") == "St Matthew Catholic Elementary School Sign")
    out["stm"]["sign"] = [round(sign["x"], 1), round(sign["z"], 1)]
    out["stm"]["port"] = [out.pop("stmP1")["p"], out.pop("stmP2")["p"]]

    # Conestoga Doon's named buildings
    x0, z0, x1, z1 = CON_BOX
    con = []
    for b in blds:
        cx, cz = cen(b["o"])
        if x0 < cx < x1 and z0 < cz < z1 and b.get("n"):
            con.append({"n": b["n"], "x": round(cx, 1), "z": round(cz, 1)})
    out["con"] = {"rec": out.pop("rec"), "res": out.pop("res"), "named": con}

    # the Bridgeport Bridge's deck
    br = next(r for r in roads if r["id"] == BRIDGE_WAY)
    out["bridge"] = {"p": [[round(q[0], 1), round(q[1], 1)] for q in br["p"]], "name": br.get("name")}

    p = os.path.join(OUT, "home.json")
    with open(p, "w") as f:
        json.dump(out, f, separators=(",", ":"), ensure_ascii=False)
    print(f"home.json {os.path.getsize(p) // 1024} KB: ub {len(out['ub']['s'])} shops, "
          f"uwp {len(uwp)} footprints / {sum(len(u['s']) for u in uwp)} shops, con {len(con)} named")


if __name__ == "__main__":
    main()
