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
    # round three
    "kci": (-2740.1, -395.4),        # Kitchener-Waterloo Collegiate (KCI), 787 King St W (OSM's footprint is unnamed, building=school, 4 levels)
    "cch": (13176.3, 10169.0),       # Cambridge City Hall, 50 Dickson St (Diamond Schmitt 2008)
    "inn": (-4460.0, -4251.2),       # The Inn of Waterloo (the Waterloo Inn), 475 King St N
    "delta": (-4329.0, -1257.7),     # Delta Waterloo, 110 Erb St W (2014, 9 levels)
    "hesp": (13374.5, 2346.8),       # Idea Exchange Hespeler, 5 Tannery St E (Kongats 2006: glass round the 1923 Carnegie library)
    # round four
    "mktsq": (-981.1, 294.7),        # Market Square, King St E & Frederick (the glass rotunda and the clock tower)
    "skywalk": (-996.9, 331.2),      # the skywalk over King St from Market Square to the hotel (building=bridge, min_level 1)
    "crowne": (-1002.7, 385.6),      # Crowne Plaza Kitchener-Waterloo, 105 King St E (built 1970, the Delta until 2014)
    "stmaryrc": (-1240.3, -22.1),    # St. Mary Our Lady of Seven Sorrows, 56 Duke St W (1900-03, Neo-Gothic), and its rectory
    "stpeter": (-1018.9, 89.9),      # St. Peter's Lutheran Church, 49 Queen St N (Kruschen & Dailey, 1966-68)
    "gaol": (-916.6, -15.9),         # the Waterloo County Gaol, 77 Queen St N (Mellish and Russell, 1853), and its yard
    "govhouse": (-939.5, -25.5),     # the Governor's House, 73 Queen St N (David W. Gingerich, 1878)
    "claygl": (-4150.5, -1442.1),    # the Canadian Clay and Glass Gallery, 25 Caroline St N (Patkau 1993)
    "wmrc": (-4654.4, -1366.9),      # the Waterloo Memorial Recreation Complex, 101 Father David Bauer Dr (OSM's outline is unnamed)
    "galtarena": (13621.9, 9884.9),  # Galt Arena Gardens, 98 Shade St, Cambridge (1922)
    # round five
    "qslib": (12690.9, 10279.9),     # Idea Exchange Queen's Square (the Cambridge library), 1 North Square
    "wci": (-4439.9, -3044.8),       # Waterloo Collegiate Institute, 300 Hazel St
    "zion": (-1112.6, -107.5),       # Zion Evangelical (Zion United 1968-2015), 32 Weber St W (1893)
    "stjohn": (-1509.8, -32.2),      # St. John the Evangelist (Anglican), 23 Water St N
    "stpaul": (-1251.9, 428.0),      # St. Paul's Evangelical Lutheran, 137 Queen St S (Jonas Knechtel, 1889)
    "trinity": (12791.5, 10102.3),   # Trinity Anglican, 12 Blair Rd, Galt (OSM names it "Trinity United", denomination anglican)
    "woodside": (-463.2, -1294.5),   # Woodside National Historic Site, 528 Wellington St N (Mackenzie King's boyhood home)
    "breit": (-1708.4, -1582.6),     # the Breithaupt Centre, 350 Margaret Ave
    "grrc": (3386.5, -429.5),        # the Grand River Recreation Complex and Lyle S. Hallman Pool (MJMA, 1988-91)
    "catalyst": (-3139.0, 87.3),     # Catalyst137, 137 Glasgow St (the 1957 Uniroyal tire warehouse, reclad 2017)
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
