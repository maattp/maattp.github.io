"""The landmarks pass (src/kwlandmarks2.js) -> apps/autokw/data/lm2.json.

    tools/.venv/bin/python tools/kw/build_lm2.py

Each landmark's OSM footprint, found as build_sights.py finds its own: the
footprint whose vertex centroid is nearest the point below (within 12 m; the
script asserts every one is found). The points are the centroids
tools/kw/probe_blocks.py printed for the named OSM ways (Oct 2026 extract).

  b   {key: {p, lv, ht, n, bt}}
"""

import json
import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from build_kw import _clean, _levels  # noqa: E402

HERE = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.join(HERE, "data")
OUT = os.path.join(HERE, "..", "..", "apps", "autokw", "data")

LANDMARKS = {
    # the hospitals (Waterloo Regional Health Network since April 2025)
    "grh": (-3014.0, -462.6),        # WRHN @ Midtown, formerly Grand River Hospital KW campus, 835 King St W
    "grhcc": (-2918.2, -375.4),      # its cancer centre wing, 40 Green St (OSM building=hospital)
    "stmary": (-2156.8, 1566.7),     # WRHN @ Queen's Blvd, formerly St. Mary's General, 911 Queen's Blvd
    "freeport": (5087.2, 2959.4),    # WRHN @ Chicopee, formerly GRH Freeport, 3570 King St E
    "cmh": (11893.0, 8220.0),        # Cambridge Memorial Hospital, 700 Coronation Blvd
    # Uptown's edge and the tech
    "pi": (-4285.9, -1484.9),        # Perimeter Institute, 31 Caroline St N (2004, + the Stephen Hawking Centre 2011)
    "cigi": (-4122.4, -1276.8),      # CIGI Campus, 67 Erb St W (KPMB 2011)
    "sunlife": (-3382.8, -644.0),    # Sun Life (the Mutual Life head office), 227 King St S, Waterloo
    "manulife": (-4133.8, -4354.1),  # Manulife's Canadian head office, 500 King St N, Waterloo
    "bbA": (-3222.6, -7186.3),       # BlackBerry A, 2300 University Ave E
    "bbB": (-3135.1, -7236.0),       # BlackBerry B, 2200 University Ave E
    "bbC": (-3131.6, -7023.9),       # BlackBerry C, 2240 University Ave E
    "bbD": (-3032.3, -7103.3),       # Building D
    # downtown Kitchener's civic buildings
    "court": (-867.9, 175.0),        # Waterloo Region Courthouse, 85 Frederick St (NORR 2013)
    "regionhq": (-778.4, -82.9),     # Region of Waterloo Administration, 150 Frederick St
    "station": (-1470.5, -398.2),    # Kitchener station (VIA / GO), 126 Weber St W (1897)
    "freight": (-1429.1, -420.6),    # the 1925 freight shed beside it
}


def main():
    blds = json.load(open(os.path.join(DATA, "raw_buildings.json")))["buildings"]
    near = {}
    for b in blds:
        o = b["o"]
        cx, cz = sum(q[0] for q in o) / len(o), sum(q[1] for q in o) / len(o)
        for key, (px, pz) in LANDMARKS.items():
            d = math.hypot(cx - px, cz - pz)
            if d < 12 and (key not in near or d < near[key][0]):
                near[key] = (d, b)
    missing = [k for k in LANDMARKS if k not in near]
    assert not missing, f"landmark footprints not found: {missing}"
    out = {"b": {}}
    for key in LANDMARKS:
        d, b = near[key]
        out["b"][key] = {"p": _clean(b["o"]), "lv": _levels(b.get("lv")), "ht": b.get("ht"), "n": b.get("n") or "", "bt": b.get("bt", "")}
        print(f"  {key:9s} {d:5.1f} m  {len(out['b'][key]['p']):3d} pts  {b.get('n') or ''}")
    p = os.path.join(OUT, "lm2.json")
    with open(p, "w") as f:
        json.dump(out, f, separators=(",", ":"), ensure_ascii=False)
    print(f"lm2.json {os.path.getsize(p) // 1024} KB: {len(out['b'])} footprints")


if __name__ == "__main__":
    main()
