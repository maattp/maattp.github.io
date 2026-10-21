"""Waterloo Region's golf courses, hole by hole -> apps/autokw/data/golf.json.

    tools/.venv/bin/python tools/kw/build_golf.py

From OSM (tools/kw/data/kw.osm.pbf), which maps the region's courses in
detail: golf=hole ways (ref, par) from the tee to the green, and golf=tee /
green / fairway / bunker / water_hazard / lateral_water_hazard / rough areas,
golf=pin nodes. src/golf.js plays them.

Every feature inside a course's boundary is given to the hole whose line
passes nearest it (practice greens and the range, far from every hole, are
dropped). Per hole: its number, par, the line (tee -> green, with its
doglegs), the tee it is played from (the tee box the line starts in) and the
other tee boxes, the green, the pin (OSM's pin, or where the line ends),
fairways, bunkers, water and rough. Polygons are simplified to 0.4 m.

Also prints how well each candidate course is mapped, which is how the two
played here were picked.
"""

import json
import math
import os
import sys

import osmium

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from proj import MAP_HALF, to_world  # noqa: E402

HERE = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.join(HERE, "data")
OUT = os.path.join(HERE, "..", "..", "apps", "autokw", "data")

# the candidates, by the name OSM gives the course's boundary
CANDIDATES = [
    "Rockway Municipal Golf Course",
    "Westmount Golf & Country Club",
    "Grey Silo Golf Course",
    "Doon Valley Golf Course",
    "Conestoga Golf Course",
    "Dundee Country Club",
    "Whistle Bear Golf",
    "Grand Valley Golf Course",
    "Deer Ridge Golf Course",
    "Beaverdale Golf Club",
    "Rebel Creek",
    "Ariss Valley Golf and Country Club",
    "#138183591",
    "Savannah Golf Links",
]
# the courses played: id, OSM name, the name on the board, options --
#   nines: a 27-hole club's nines (OSM's hole `name`), in the order played;
#          a hole is then keyed by its nine and ref, and carries `nine`
#   ways:  only these golf=hole ways (Doon Valley: OSM numbers a par-3 course
#          and part of the back nine 1-9 inside the same boundary)
#   refs:  {way id: hole number} for a hole OSM numbers wrong (Galt's 8th is
#          ref=9 name="Hole 8")
#   pars:  {hole number: par} for a hole OSM gives no par (Savannah's 15th,
#          a par 4 on the club's card)
#   short: the course on the HUD and the map, where the words before "Golf"
#          in its name are not it
# A course whose boundary has no name in OSM is "#<way id>" (Galt Country
# Club's, 138183591). A course is played only if every hole has a green
# mapped and the course lies inside the map (Elmira, Cambridge Golf Club,
# Puslinch Lake, Foxwood and Cutten Fields are past its edge).
# A course mapped as a multipolygon is in pieces (Grey Silo's 1st and 18th are
# across the creek from the rest): every outer ring is the course.
PLAYED = [
    ("rockway", "Rockway Municipal Golf Course", "Rockway Golf Course", {}),
    ("westmount", "Westmount Golf & Country Club", "Westmount Golf & Country Club", {}),
    ("conestoga", "Conestoga Golf Course", "Conestoga Golf Club",
     {"nines": ["The Village", "The Moors", "Goose Run"]}),
    ("greysilo", "Grey Silo Golf Course", "Grey Silo Golf Course", {}),
    ("doon", "Doon Valley Golf Course", "Doon Valley Golf Course",
     {"ways": [1451503428, 1451503429, 1451503430, 1451503431, 1451503432,
               1451503433, 1451503611, 1451503612, 1451503613]}),
    ("dundee", "Dundee Country Club", "Dundee Country Club", {"short": "Dundee"}),
    ("whistlebear", "Whistle Bear Golf", "Whistle Bear Golf Club", {}),
    ("grandvalley", "Grand Valley Golf Course", "Grand Valley Golf Course", {}),
    ("deerridge", "Deer Ridge Golf Course", "Deer Ridge Golf Club", {}),
    ("beaverdale", "Beaverdale Golf Club", "Beaverdale Golf Club", {}),
    ("rebelcreek", "Rebel Creek", "Rebel Creek Golf Club", {}),
    ("ariss", "Ariss Valley Golf and Country Club", "Ariss Valley Golf & Country Club", {}),
    ("galt", "#138183591", "Galt Country Club", {"short": "Galt", "refs": {1035796504: 8}}),
    ("savannah", "Savannah Golf Links", "Savannah Golf Links", {"pars": {15: 4}}),
]
AREA_KINDS = {"tee", "green", "fairway", "bunker", "water_hazard", "lateral_water_hazard", "rough"}
REACH = 120     # a feature further than this from every hole line is not a hole's


def pip(poly, x, z):
    c = False
    j = len(poly) - 1
    for i in range(len(poly)):
        xi, zi = poly[i]
        xj, zj = poly[j]
        if (zi > z) != (zj > z) and x < (xj - xi) * (z - zi) / (zj - zi) + xi:
            c = not c
        j = i
    return c


def seg_dist(px, pz, a, b):
    dx, dz = b[0] - a[0], b[1] - a[1]
    L2 = dx * dx + dz * dz or 1
    t = max(0.0, min(1.0, ((px - a[0]) * dx + (pz - a[1]) * dz) / L2))
    return math.hypot(px - (a[0] + dx * t), pz - (a[1] + dz * t))


def line_dist(px, pz, line):
    return min(seg_dist(px, pz, a, b) for a, b in zip(line, line[1:]))


def centroid(poly):
    a = cx = cz = 0.0
    n = len(poly)
    for i in range(n):
        x0, z0 = poly[i]
        x1, z1 = poly[(i + 1) % n]
        k = x0 * z1 - x1 * z0
        a += k
        cx += (x0 + x1) * k
        cz += (z0 + z1) * k
    if abs(a) < 1e-6:
        return [sum(p[0] for p in poly) / n, sum(p[1] for p in poly) / n]
    return [cx / (3 * a), cz / (3 * a)]


def area(poly):
    return abs(sum(poly[i][0] * poly[(i + 1) % len(poly)][1] - poly[(i + 1) % len(poly)][0] * poly[i][1]
                   for i in range(len(poly)))) / 2


def simplify(pts, tol):
    """Douglas-Peucker on an open polyline."""
    if len(pts) < 3:
        return pts
    a, b = pts[0], pts[-1]
    best, bi = -1, 0
    for i in range(1, len(pts) - 1):
        d = seg_dist(pts[i][0], pts[i][1], a, b)
        if d > best:
            best, bi = d, i
    if best <= tol:
        return [a, b]
    return simplify(pts[: bi + 1], tol)[:-1] + simplify(pts[bi:], tol)


def ring(pts, tol=0.4):
    if len(pts) > 1 and pts[0] == pts[-1]:
        pts = pts[:-1]
    if len(pts) < 3:
        return None
    # split the closed ring at its two furthest-apart points so DP keeps its extent
    far = max(range(len(pts)), key=lambda i: math.hypot(pts[i][0] - pts[0][0], pts[i][1] - pts[0][1]))
    s = simplify(pts[: far + 1], tol)[:-1] + simplify(pts[far:] + [pts[0]], tol)[:-1]
    s = s if len(s) >= 3 else pts
    return [[round(x, 1), round(z, 1)] for x, z in s]


class Reader(osmium.SimpleHandler):
    def __init__(self):
        super().__init__()
        self.courses = {}     # name -> its largest outer ring
        self.outers = {}      # name -> every outer ring (a multipolygon course is in pieces)
        self.areas = []       # (kind, ring)
        self.holes = []       # (tags, line, way id)
        self.pins = []        # (x, z)

    def area(self, a):
        t = {k.k: k.v for k in a.tags}
        golf = t.get("golf")
        course = t.get("leisure") == "golf_course"
        if not course and golf not in AREA_KINDS:
            return
        try:
            for outer in a.outer_rings():
                pts = [list(to_world(n.lat, n.lon)) for n in outer]
                if course:
                    # an unnamed course is known by its way id
                    nm = t.get("name") or f"#{a.orig_id()}"
                    self.outers.setdefault(nm, []).append(pts)
                    if nm not in self.courses or area(pts) > area(self.courses[nm]):
                        self.courses[nm] = pts
                else:
                    self.areas.append((golf, pts))
        except osmium.InvalidLocationError:
            pass

    def way(self, w):
        if w.tags.get("golf") != "hole":
            return
        try:
            line = [list(to_world(n.lat, n.lon)) for n in w.nodes]
        except osmium.InvalidLocationError:
            return
        if len(line) >= 2:
            self.holes.append(({k.k: k.v for k in w.tags}, line, w.id))

    def node(self, n):
        if n.tags.get("golf") == "pin":
            self.pins.append(list(to_world(n.location.lat, n.location.lon)))


def in_course(boundary, pts, others=()):
    c = centroid(pts)
    return pip(boundary, c[0], c[1]) or any(pip(o, c[0], c[1]) for o in others)


def course_holes(r, rings, opts=None):
    opts = opts or {}
    nines, ways = opts.get("nines"), opts.get("ways")
    refs, pars = opts.get("refs", {}), opts.get("pars", {})
    holes = {}
    inside = lambda p: any(pip(b, p[0], p[1]) for b in rings)  # noqa: E731
    for tags, line, wid in r.holes:
        if ways is not None and wid not in ways:
            continue
        if not inside(line[0]) and not inside(line[-1]):
            continue
        ref = str(refs.get(wid, tags.get("ref", "")))
        if not ref.isdigit():
            continue
        n = int(ref)
        par = tags.get("par", "")
        par = int(par) if par.isdigit() else pars.get(n)
        if not par:
            continue
        nine = tags.get("name") if nines else None
        if nines and nine not in nines:
            continue
        key = (nines.index(nine) if nines else 0, n)
        if key not in holes:      # the first mapped wins (a mis-tagged duplicate)
            holes[key] = {"n": n, "par": par, "line": line}
            if nine:
                holes[key]["nine"] = nine
    return [holes[k] for k in sorted(holes)]


def report(r):
    print("how well each candidate is mapped (features inside its boundary):")
    for name in CANDIDATES:
        b = r.courses.get(name)
        if not b:
            print(f"  {name}: no boundary found")
            continue
        cnt = {}
        for kind, pts in r.areas:
            if in_course(b, pts):
                cnt[kind] = cnt.get(kind, 0) + 1
        holes = course_holes(r, r.outers[name], next((c[3] for c in PLAYED if c[1] == name), {}))
        pins = sum(1 for p in r.pins if pip(b, p[0], p[1]))
        print(f"  {name}: {len(holes)} numbered holes with par {[h['n'] for h in holes]}, {pins} pins, "
              + ", ".join(f"{v} {k}" for k, v in sorted(cnt.items())))


def build(r, cid, name, label, opts):
    boundary = r.courses[name]
    holes = course_holes(r, r.outers[name], opts)
    assert len(holes) >= 9, f"{name}: only {len(holes)} holes"
    # a multipolygon course's other pieces: in play, and their features its own
    others = [p for p in r.outers.get(name, []) if p is not boundary]
    more = [ring(p, 1.0) for p in others]
    feats = [(k, p) for k, p in r.areas if in_course(boundary, p, others)]
    pins = [p for p in r.pins if any(pip(b, p[0], p[1]) for b in [boundary] + others)]
    out = []
    for h in holes:
        h["fairways"], h["bunkers"], h["water"], h["rough"], h["tees"], h["greens"] = [], [], [], [], [], []
    for kind, pts in feats:
        c = centroid(pts)
        # tees and greens go to the hole whose END is nearest (a tee box sits
        # beside the previous green), the rest to the nearest line
        if kind == "tee":
            d, h = min(((math.hypot(c[0] - h["line"][0][0], c[1] - h["line"][0][1]), h) for h in holes), key=lambda q: q[0])
            if d < 80:
                h["tees"].append(pts)
            continue
        if kind == "green":
            d, h = min(((math.hypot(c[0] - h["line"][-1][0], c[1] - h["line"][-1][1]), h) for h in holes), key=lambda q: q[0])
            if d < 60:
                h["greens"].append(pts)
            continue
        d, h = min(((line_dist(c[0], c[1], h["line"]), h) for h in holes), key=lambda q: q[0])
        if d > REACH:
            continue
        key = {"fairway": "fairways", "bunker": "bunkers", "rough": "rough"}.get(kind, "water")
        h[key].append(pts)
    for h in holes:
        line = h["line"]
        s, e = line[0], line[-1]
        # the tee played: the box the line starts in, or the nearest
        tee = next((t for t in h["tees"] if pip(t, s[0], s[1])), None)
        if tee is None and h["tees"]:
            tee = min(h["tees"], key=lambda t: math.hypot(centroid(t)[0] - s[0], centroid(t)[1] - s[1]))
        tee_at = s if tee is not None and pip(tee, s[0], s[1]) else (centroid(tee) if tee is not None else s)
        green = next((g for g in h["greens"] if pip(g, e[0], e[1])), None)
        if green is None and h["greens"]:
            green = min(h["greens"], key=lambda g: math.hypot(centroid(g)[0] - e[0], centroid(g)[1] - e[1]))
        if green is None:
            # a green two holes share (Savannah's 7th and 9th): the nearest
            # green of any hole, if the line ends within 60 m of it
            allg = [p for k, p in feats if k == "green"]
            if allg:
                g = min(allg, key=lambda g: math.hypot(centroid(g)[0] - e[0], centroid(g)[1] - e[1]))
                if math.hypot(centroid(g)[0] - e[0], centroid(g)[1] - e[1]) < 60:
                    green = g
        assert green is not None, f"{name} hole {h['n']}: no green"
        pin = next((p for p in pins if pip(green, p[0], p[1])), None)
        if pin is None:
            pin = e if pip(green, e[0], e[1]) else centroid(green)
            if not pip(green, pin[0], pin[1]):
                pin = green[0]
        # the line runs from the tee played to the pin
        line = [tee_at] + line[1:-1] + [pin]
        rnd = lambda p: [round(p[0], 1), round(p[1], 1)]  # noqa: E731
        out.append({
            "n": h["n"], "par": h["par"], **({"nine": h["nine"]} if h.get("nine") else {}),
            "line": [rnd(p) for p in line],
            "tee": rnd(tee_at),
            "teePoly": ring(tee) if tee is not None else None,
            "tees": [q for q in (ring(t) for t in h["tees"] if t is not tee) if q],
            "green": ring(green),
            "greens": [q for q in (ring(g) for g in h["greens"] if g is not green) if q],
            "pin": rnd(pin),
            "fairways": [q for q in map(ring, h["fairways"]) if q],
            "bunkers": [q for q in map(ring, h["bunkers"]) if q],
            "water": [q for q in map(ring, h["water"]) if q],
            "rough": [q for q in map(ring, h["rough"]) if q],
        })
    L = lambda p: sum(math.hypot(b[0] - a[0], b[1] - a[1]) for a, b in zip(p, p[1:]))  # noqa: E731
    print(f"  {label}: {len(out)} holes, par {sum(h['par'] for h in out)}; front three "
          + ", ".join(f"#{h['n']} par {h['par']} {L(h['line']) * 1.0936:.0f} yds" for h in out[:3]))
    doc = {"id": cid, "name": label, "boundary": ring(boundary, 1.0), "holes": out}
    if opts.get("short"):
        doc["short"] = opts["short"]
    edge = max(abs(v) for r_ in [boundary] + others for p in r_ for v in p)
    assert edge < MAP_HALF - 50, f"{name}: past the map's edge"
    if more:
        doc["more"] = more
    return doc


def main():
    r = Reader()
    r.apply_file(os.path.join(DATA, "kw.osm.pbf"), locations=True)
    report(r)
    print("played:")
    doc = {"courses": [build(r, *c) for c in PLAYED]}
    out = os.path.join(OUT, "golf.json")
    with open(out, "w") as f:
        json.dump(doc, f, separators=(",", ":"))
    print(f"golf.json {os.path.getsize(out) // 1024} KB")


if __name__ == "__main__":
    main()
