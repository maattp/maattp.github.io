"""What the street-name signs at Waterloo Region's corners need to know.

    tools/.venv/bin/python tools/kw/build_streetsigns.py

Reads tools/data/kw/kw.osm.pbf and raw_roads.json, writes
apps/autokw/data/streetsigns.json for src/streetsigns.js:

  munis   every lower-tier municipality's boundary (OSM boundary=administrative
          admin_level=8: Waterloo, Kitchener, Cambridge, Woolwich, Wilmot,
          North Dumfries, Wellesley, and the neighbours the square reaches
          into), outer rings simplified to ~20 m. Which one a corner is in
          decides the blade's design (each signs its own streets).
  rr      the Regional Roads: per street name, points every ~60 m along each
          OSM way whose ref is "RR n" with the number, so a corner can say
          which Regional Road a street is (the white flowerpot on the post).
  addr    civic numbers on the township roads (Wilmot signs them on the
          blade: "<- 2982  2981 ->"), per street name [x, z, number], from
          every addr:housenumber + addr:street node and building in the
          townships.
  dtk     downtown Kitchener's four districts (the City's Downtown Districts
          map): a centre and a reach, where the white arched "district" blades
          stand instead of the green ones.

Everything is OSM's except the districts' reach, which is read off the City's
map by eye (see DISTRICTS).
"""

import json
import math
import os
import re
import sys
from collections import defaultdict

import osmium

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from proj import to_world, MAP_HALF  # noqa: E402

HERE = os.path.dirname(os.path.abspath(__file__))
PBF = os.path.join(HERE, "data", "kw.osm.pbf")
RAW_ROADS = os.path.join(HERE, "data", "raw_roads.json")
OUT = os.path.join(HERE, "..", "..", "apps", "autokw", "data", "streetsigns.json")
LIM = MAP_HALF + 2000
TOWNSHIPS = {"Township of Wilmot", "Wilmot", "Township of Woolwich", "Woolwich",
             "Township of North Dumfries", "North Dumfries", "Township of Wellesley", "Wellesley"}

# Downtown Kitchener's districts (City of Kitchener, "Downtown Districts", 2026):
# each is placed at a named intersection near its middle, with a reach read off
# the map. The white arched blade with the district's name under the street is
# the Market District's (photographed at King St E & Cedar St N); the other
# three are assumed to follow it.
DISTRICTS = [
    ("MARKET DISTRICT", "King Street East", "Cedar Street North", 260),
    ("CITY CENTRE DISTRICT", "King Street West", "Young Street", 250),
    ("CIVIC DISTRICT", "Queen Street North", "Ahrens Street East", 190),
    ("INNOVATION DISTRICT", "King Street West", "Victoria Street South", 330),
]


def simplify(pts, tol):
    if len(pts) < 3:
        return pts
    a, b = pts[0], pts[-1]
    dx, dz = b[0] - a[0], b[1] - a[1]
    L = math.hypot(dx, dz) or 1e-9
    best, bi = -1, 0
    for i in range(1, len(pts) - 1):
        p = pts[i]
        d = abs((p[0] - a[0]) * dz - (p[1] - a[1]) * dx) / L
        if d > best:
            best, bi = d, i
    if best <= tol:
        return [a, b]
    return simplify(pts[:bi + 1], tol)[:-1] + simplify(pts[bi:], tol)


def short_muni(n):
    n = re.sub(r"^(City|Township|Town|Municipality|County) of ", "", n)
    return n


def main():
    munis = []
    addr_pts = []       # (street, x, z, number)
    fp = osmium.FileProcessor(PBF).with_locations("flex_mem").with_areas()
    for o in fp:
        tags = o.tags
        if isinstance(o, osmium.osm.Node):
            hn, st = tags.get("addr:housenumber"), tags.get("addr:street")
            if hn and st:
                x, z = to_world(o.location.lat, o.location.lon)
                addr_pts.append((st, x, z, hn))
            continue
        if not isinstance(o, osmium.osm.Area):
            continue
        hn, st = tags.get("addr:housenumber"), tags.get("addr:street")
        if hn and st and tags.get("building"):
            try:
                ring = next(iter(o.outer_rings()))
                xs = [to_world(n.lat, n.lon) for n in ring]
                cx = sum(p[0] for p in xs) / len(xs)
                cz = sum(p[1] for p in xs) / len(xs)
                addr_pts.append((st, cx, cz, hn))
            except Exception:
                pass
        if tags.get("boundary") == "administrative" and tags.get("admin_level") == "8" and tags.get("name"):
            rings = []
            try:
                for ring in o.outer_rings():
                    pts = [to_world(n.lat, n.lon) for n in ring]
                    if not any(abs(p[0]) < LIM and abs(p[1]) < LIM for p in pts):
                        continue
                    # a closed ring: Douglas-Peucker from its first point to
                    # the point farthest from it and back (end == start
                    # collapses it to nothing)
                    k = max(range(len(pts)), key=lambda i: (pts[i][0] - pts[0][0]) ** 2 + (pts[i][1] - pts[0][1]) ** 2)
                    pts = simplify(pts[:k + 1], 20)[:-1] + simplify(pts[k:], 20)
                    rings.append([[round(p[0], 1), round(p[1], 1)] for p in pts])
            except osmium.InvalidLocationError:
                continue
            if rings:
                munis.append({"n": short_muni(tags["name"]), "r": rings})
    print("munis:", [m["n"] for m in munis])

    roads = json.load(open(RAW_ROADS))["roads"]
    # --- Regional Roads -----------------------------------------------------
    rr = defaultdict(list)
    for r in roads:
        ref, name = r.get("ref") or "", r.get("name")
        if not name:
            continue
        m = re.search(r"RR (\d+[EW]?)", ref)
        if not m:
            continue
        num = m.group(1)
        p = r["p"]
        acc = 1e9
        for i in range(len(p)):
            if i:
                acc += math.hypot(p[i][0] - p[i - 1][0], p[i][1] - p[i - 1][1])
            if acc >= 60 or i == len(p) - 1:
                rr[name].append([round(p[i][0]), round(p[i][1]), num])
                acc = 0
    print("regional road names:", len(rr), "points:", sum(len(v) for v in rr.values()))

    # --- the townships' civic numbers ---------------------------------------
    def muni_at(x, z):
        for m in munis:
            for ring in m["r"]:
                if inside(ring, x, z):
                    return m["n"]
        return None

    addr = defaultdict(list)
    for st, x, z, hn in addr_pts:
        if abs(x) > MAP_HALF or abs(z) > MAP_HALF:
            continue
        mnum = re.match(r"^(\d+)", hn)
        if not mnum:
            continue
        if muni_at(x, z) not in ("Wilmot",):
            continue
        addr[st].append([round(x), round(z), int(mnum.group(1))])
    print("township addresses:", sum(len(v) for v in addr.values()), "on", len(addr), "streets")

    # --- downtown Kitchener's districts --------------------------------------
    byname = defaultdict(list)
    for r in roads:
        if r.get("name"):
            byname[r["name"]].append(r["p"])

    def meet(a, b):
        best = None
        for pa in byname.get(a, []):
            for pb in byname.get(b, []):
                for p in pa:
                    for q in pb:
                        d = (p[0] - q[0]) ** 2 + (p[1] - q[1]) ** 2
                        if best is None or d < best[0]:
                            best = (d, (p[0] + q[0]) / 2, (p[1] + q[1]) / 2)
        return best

    dtk = []
    for label, a, b, reach in DISTRICTS:
        m = meet(a, b)
        if not m or m[0] > 40 * 40:
            print("  district centre not found:", label, a, b, m and math.sqrt(m[0]))
            continue
        dtk.append({"d": label, "x": round(m[1]), "z": round(m[2]), "r": reach})
    print("districts:", dtk)

    out = {"munis": munis, "rr": rr, "addr": addr, "dtk": dtk}
    with open(OUT, "w") as f:
        json.dump(out, f, separators=(",", ":"))
    print("wrote", OUT, os.path.getsize(OUT), "bytes")


def inside(ring, x, z):
    c = False
    n = len(ring)
    j = n - 1
    for i in range(n):
        xi, zi = ring[i]
        xj, zj = ring[j]
        if (zi > z) != (zj > z) and x < (xj - xi) * (z - zi) / (zj - zi) + xi:
            c = not c
        j = i
    return c


if __name__ == "__main__":
    main()
