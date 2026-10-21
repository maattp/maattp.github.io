"""The University of Waterloo's main campus -> apps/autokw/data/uw.json.

    tools/.venv/bin/python tools/kw/build_uw.py

src/uwcampus.js draws the campus itself (its boxes go flat); this writes what
it draws from, all from OSM:

  b        every campus building: outline, name, ref (MC, DC, E5 ...),
           building:levels / height / min_level, colour and material, and its
           building:part ways (the stepped masses: Dana Porter's tower, MC's
           stair towers, E5's podium ...), each part attached to the building
           its centroid lies in.
  bridges  the enclosed pedestrian bridges (bridge=yes corridors/footways with
           layer >= 1 or covered/indoor): the E5 Bridge over Ring Road, the E6
           Bridge, MC-DC, MC-QNC, SLC-PAC, REV's ...
  ring     Ring Road's centreline, chained into one loop.
  pois     the campus's own things OSM has a node for: the University of
           Waterloo letters, the Plant Operations stack, the artworks, the
           flagpole by the library.

A building is campus if it is inside Ring Road, or a named university /
college / dormitory / chapel / sports building in the box round it, or one of
Village 1 / REV's residence blocks (OSM tags them building:colour #AE9183).

  wlu      WILFRID LAURIER UNIVERSITY's Waterloo campus, the same way: every
           building inside OSM's campus outline (amenity=university way
           226405688) or operated by Laurier in the box round it (the
           residences, the Athletic Complex, Martin Luther's seminary), with
           their parts; Alumni Field, University Stadium's field and track and
           the campus outline itself.
"""

import json
import math
import os
import sys

import osmium

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from proj import to_world  # noqa: E402

HERE = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.join(HERE, "data")
OUT = os.path.join(HERE, "..", "..", "apps", "autokw", "data")

# lat/lon box round main campus (+ the colleges, V1, REV, CIF, Optometry, E5-E7)
S, W, N, E = 43.462, -80.560, 43.480, -80.535
# world box the buildings' centroids must be in
BX0, BX1, BZ0, BZ1 = -6450.0, -5060.0, -2700.0, -1450.0
CAMPUS_BT = {"university", "college", "dormitory", "chapel", "sports_centre", "school", "yes", "industrial", "office",
             "residential", "church", "public", "civic"}
NOT_CAMPUS_BT = {"house", "detached", "semidetached_house", "apartments", "retail", "commercial", "garage", "garages",
                 "terrace", "roof", "service", "shed", "kiosk", "parking", "construction"}
KEEP = ("name", "ref", "short_name", "building", "building:part", "building:levels", "building:min_level", "height",
        "min_height", "roof:shape", "roof:height", "roof:levels", "building:colour", "building:material", "roof:colour",
        "layer", "operator", "amenity")
POI = {  # OSM node id -> key
    11272277599: "letters", 1503542106: "stack", 1933039915: "obelisk", 2342888588: "triad",
    2342888589: "dream", 2342888590: "boar", 2343722970: "sculptenv", 2926790159: "flag",
    3139407214: "radio", 1863224307: "board", 3139407177: "monument", 1926299762: "e2fountain",
    1551340118: "fountain", 7613131740: "rockgarden",
}


def inb(la, lo):
    return S < la < N and W < lo < E


def area(p):
    a = 0.0
    for i in range(len(p)):
        j = (i + 1) % len(p)
        a += p[i][0] * p[j][1] - p[j][0] * p[i][1]
    return a / 2


def cen(p):
    return sum(q[0] for q in p) / len(p), sum(q[1] for q in p) / len(p)


def in_poly(p, x, z):
    c = False
    j = len(p) - 1
    for i in range(len(p)):
        if (p[i][1] > z) != (p[j][1] > z) and x < (p[j][0] - p[i][0]) * (z - p[i][1]) / (p[j][1] - p[i][1]) + p[i][0]:
            c = not c
        j = i
    return c


# Laurier: the lat/lon box round the Waterloo campus (University Ave to
# Seagram Dr, Albert St to Regina St) and OSM's own campus outline
WS, WW, WN, WE = 43.468, -80.533, 43.479, -80.519
WLU_CAMPUS = 226405688
WLU_PITCH = {167410366: "alumni", 304036552: "stadium", 4051240: "track", 13694855: "bowl"}
WLU_HOUSE = {"house", "detached", "semidetached_house", "garage", "garages", "shed", "retail", "commercial", "roof"}


def inw(la, lo):
    return WS < la < WN and WW < lo < WE


class Grab(osmium.SimpleHandler):
    def __init__(self):
        super().__init__()
        self.areas, self.ways, self.nodes = [], [], {}
        self.wlu, self.wlu_out, self.wlu_pitch = [], None, {}

    def area(self, a):
        t = {k.k: k.v for k in a.tags}
        oid = a.orig_id()
        if (oid == WLU_CAMPUS and t.get("amenity") == "university") or (oid in WLU_PITCH and t.get("leisure")):
            for ring in a.outer_rings():
                p = [[round(c, 2) for c in to_world(n.lat, n.lon)] for n in ring][:-1]
                if oid == WLU_CAMPUS:
                    self.wlu_out = p
                else:
                    self.wlu_pitch[WLU_PITCH[oid]] = {"p": p, "n": t.get("name", ""), "sport": t.get("sport", "")}
                break
            return
        if not (t.get("building") or t.get("building:part")):
            return
        try:
            for ring in a.outer_rings():
                pts = [(n.lat, n.lon) for n in ring]
                if len(pts) < 4:
                    continue
                la = sum(q[0] for q in pts) / len(pts)
                lo = sum(q[1] for q in pts) / len(pts)
                if inw(la, lo):
                    self.wlu.append({"id": oid, "t": t, "p": [[round(c, 2) for c in to_world(*q)] for q in pts[:-1]]})
                if not inb(la, lo):
                    return
                p = [[round(c, 2) for c in to_world(*q)] for q in pts[:-1]]
                self.areas.append({"id": a.orig_id(), "t": t, "p": p})
                break
        except osmium.InvalidLocationError:
            pass

    def way(self, w):
        t = {k.k: k.v for k in w.tags}
        nm = t.get("name")
        if not (nm == "Ring Road" or (t.get("bridge") == "yes" and t.get("highway") in ("footway", "corridor", "cycleway"))):
            return
        try:
            pts = [(n.lat, n.lon) for n in w.nodes]
        except osmium.InvalidLocationError:
            return
        la = sum(q[0] for q in pts) / len(pts)
        lo = sum(q[1] for q in pts) / len(pts)
        if not inb(la, lo):
            return
        self.ways.append({"id": w.id, "t": t, "l": [[round(c, 2) for c in to_world(*q)] for q in pts]})

    def node(self, n):
        if n.id in POI:
            self.nodes[POI[n.id]] = [round(c, 2) for c in to_world(n.location.lat, n.location.lon)]


def chain(ways):
    """Ring Road's ways joined end to end into one loop (the longest chain)."""
    segs = [w["l"][:] for w in ways]
    loop = segs.pop(0)
    changed = True
    while segs and changed:
        changed = False
        for i, s in enumerate(segs):
            if math.dist(loop[-1], s[0]) < 0.5:
                loop += s[1:]
            elif math.dist(loop[-1], s[-1]) < 0.5:
                loop += s[::-1][1:]
            elif math.dist(loop[0], s[-1]) < 0.5:
                loop = s[:-1] + loop
            elif math.dist(loop[0], s[0]) < 0.5:
                loop = s[::-1][:-1] + loop
            else:
                continue
            segs.pop(i)
            changed = True
            break
    return loop


def laurier(g):
    """Wilfrid Laurier's Waterloo campus: its buildings (with parts), fields and outline."""
    camp = g.wlu_out or []
    blds = [a for a in g.wlu if a["t"].get("building") and not a["t"].get("building:part")]
    parts = [a for a in g.wlu if a["t"].get("building:part")]
    out = []
    for b in blds:
        t = b["t"]
        x, z = cen(b["p"])
        op = t.get("operator", "") + " " + t.get("office", "")
        laur = "Laurier" in op or "WLU" in op or "wilfrid" in op.lower() or "Martin Luther" in op
        inside = bool(camp) and in_poly(camp, x, z)
        if t.get("building") in WLU_HOUSE:
            continue
        if not (laur or inside or t.get("name") == "Martin Luther University College"):
            continue
        if abs(area(b["p"])) < 40:
            continue
        rec = {"id": b["id"], "p": b["p"] if area(b["p"]) > 0 else b["p"][::-1], "campus": "wlu"}
        rec.update({k: t[k] for k in KEEP if k in t})
        rec["parts"] = []
        out.append(rec)
    for p in parts:
        x, z = cen(p["p"])
        best = None
        for b in out:
            if in_poly(b["p"], x, z) and (best is None or abs(area(b["p"])) < abs(area(best["p"]))):
                best = b
        if best is None:
            continue
        rec = {"id": p["id"], "p": p["p"] if area(p["p"]) > 0 else p["p"][::-1]}
        rec.update({k: p["t"][k] for k in KEEP if k in p["t"]})
        best["parts"].append(rec)
    print(f"  Laurier: {len(out)} buildings ({sum(1 for b in out if b.get('name'))} named, "
          f"{sum(len(b['parts']) for b in out)} parts), fields {sorted(g.wlu_pitch)}, outline {len(camp)} pts")
    return {"b": out, "fields": g.wlu_pitch, "outline": camp}


def main():
    g = Grab()
    g.apply_file(os.path.join(DATA, "kw.osm.pbf"), locations=True, idx="flex_mem")
    ring_ways = [w for w in g.ways if w["t"].get("name") == "Ring Road" and w["t"].get("highway")]
    # the loop proper: the long ways (the short spurs at Seagram Dr fall out of the chain)
    ring = chain(sorted(ring_ways, key=lambda w: -len(w["l"])))
    closed = math.dist(ring[0], ring[-1]) < 1
    print(f"  Ring Road: {len(ring_ways)} ways, loop of {len(ring)} points, closed={closed}")

    blds = [a for a in g.areas if a["t"].get("building") and not a["t"].get("building:part")]
    parts = [a for a in g.areas if a["t"].get("building:part")]
    out = []
    for b in blds:
        t = b["t"]
        x, z = cen(b["p"])
        if not (BX0 < x < BX1 and BZ0 < z < BZ1):
            continue
        A = abs(area(b["p"]))
        bt = t.get("building")
        named = bool(t.get("name") or t.get("ref"))
        inside = in_poly(ring, x, z)
        v1 = t.get("building:colour", "").upper() == "#AE9183"
        uw = "Waterloo" in t.get("operator", "") or bt in ("university", "college", "dormitory", "chapel")
        if bt in NOT_CAMPUS_BT and not uw:
            continue
        if not (inside or v1 or uw or (named and bt in CAMPUS_BT and (t.get("ref") or bt != "office"))):
            continue
        if A < 40:
            continue
        if bt == "office" and not t.get("ref"):
            continue   # the research park's offices north of Columbia
        rec = {"id": b["id"], "p": b["p"] if area(b["p"]) > 0 else b["p"][::-1]}
        rec.update({k: t[k] for k in KEEP if k in t})
        rec["parts"] = []
        out.append(rec)
    # every part goes to the building its centroid is in (the smallest such)
    for p in parts:
        x, z = cen(p["p"])
        best = None
        for b in out:
            if in_poly(b["p"], x, z) and (best is None or abs(area(b["p"])) < abs(area(best["p"]))):
                best = b
        if best is None:
            continue
        rec = {"id": p["id"], "p": p["p"] if area(p["p"]) > 0 else p["p"][::-1]}
        rec.update({k: p["t"][k] for k in KEEP if k in p["t"]})
        best["parts"].append(rec)
    bridges = []
    for w in g.ways:
        t = w["t"]
        if t.get("bridge") != "yes":
            continue
        lay = int(t.get("layer", "1") or 1) if t.get("layer", "1").lstrip("-").isdigit() else 1
        enclosed = t.get("covered") == "yes" or t.get("indoor") == "yes" or t.get("highway") == "corridor"
        if not enclosed:
            continue
        L = sum(math.dist(w["l"][i], w["l"][i + 1]) for i in range(len(w["l"]) - 1))
        if L < 5:
            continue
        bridges.append({"id": w["id"], "n": t.get("name", ""), "layer": lay, "l": w["l"]})
    doc = {"b": out, "bridges": bridges, "ring": ring, "pois": g.nodes, "wlu": laurier(g)}
    os.makedirs(OUT, exist_ok=True)
    with open(os.path.join(OUT, "uw.json"), "w") as f:
        json.dump(doc, f, separators=(",", ":"))
    named = sum(1 for b in out if b.get("name"))
    print(f"  {len(out)} campus buildings ({named} named, {sum(len(b['parts']) for b in out)} parts), "
          f"{len(bridges)} bridges, pois {sorted(g.nodes)}")
    print(f"  -> {os.path.join(OUT, 'uw.json')} ({os.path.getsize(os.path.join(OUT, 'uw.json')) // 1024} KB)")


if __name__ == "__main__":
    main()
