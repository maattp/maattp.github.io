"""Grand River Transit route sections for the bus-driver job -> apps/autokw/data/grt.json.

    tools/.venv/bin/python tools/kw/build_grt.py

Reads OSM's GRT route relations (type=route, route=bus, network=Grand River
Transit; PTv2: the ways in order as role '' members, the stops as `platform*`
members in order) straight out of tools/data/kw/kw.osm.pbf. Each job in
SECTIONS is a run of 9-12 consecutive stops of one relation, starting at a
terminal, so a mission is ~4-6 km rather than the whole route.

Per section:
  stops  [[name, x, z], ...]   the platform (node, or a platform way's centroid)
  line   [[x, z], ...]         the relation's ways chained end to end and cut
                               from the first stop's projection to the last's
  at     [s, ...]              each stop's distance along `line`

A section whose stops cannot be found, or whose way chain breaks between its
first and last stop, fails the script (assert), so a re-import that loses a
stop is loud.
"""

import json
import math
import os
import sys

import osmium

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from proj import to_world  # noqa: E402

HERE = os.path.dirname(os.path.abspath(__file__))
PBF = os.path.join(HERE, "data", "kw.osm.pbf")
OUT = os.path.join(HERE, "..", "..", "apps", "autokw", "data", "grt.json")

# [id, relation, first stop index, last stop index, sign (the destination
# sign: route number and name), the route's colour on GRT's map, blurb]
SECTIONS = [
    ("7", 18720284, 0, 11, "7 King", "Waterloo Public Square", "#d6232a",
     "Conestoga Station down King St past Manulife and the universities to Uptown"),
    ("202", 18841689, 0, 8, "202 iXpress University", "University of Waterloo", "#f7941d",
     "The Boardwalk along Ira Needles and Erb to UW, iXpress stops only"),
    ("201", 18823456, 0, 9, "201 iXpress Fischer-Hallman", "Fischer-Hallman / Columbia", "#f7941d",
     "Conestoga Station by King and Columbia through UW Station to Fischer-Hallman"),
    ("57", 18697672, 0, 10, "57 Blair", "Blair / Bismark", "#0072bc",
     "Ainslie Terminal in Galt up Grand Ave, George and Sunset to Blair"),
]


class Rel(osmium.SimpleHandler):
    def __init__(self, ids):
        super().__init__()
        self.ids, self.rels = ids, {}

    def relation(self, r):
        if r.id in self.ids:
            self.rels[r.id] = [(m.type, m.ref, m.role) for m in r.members]


class Geo(osmium.SimpleHandler):
    def __init__(self, nodes, ways):
        super().__init__()
        self.want_n, self.want_w = nodes, ways
        self.n, self.w = {}, {}

    def node(self, n):
        if n.id in self.want_n:
            self.n[n.id] = (to_world(n.location.lat, n.location.lon), n.tags.get("name"))

    def way(self, w):
        if w.id in self.want_w:
            pts = []
            for nd in w.nodes:
                if nd.location.valid():
                    pts.append((nd.ref, to_world(nd.location.lat, nd.location.lon)))
            self.w[w.id] = (pts, w.tags.get("name"))


def chain(ways):
    """Ways (lists of (node id, (x, z))) in relation order -> one polyline.
    Each way is flipped to meet the previous one; a gap is bridged straight
    (OSM relations are sometimes split mid-way by a stop's own way)."""
    out = []
    for i, w in enumerate(ways):
        if not w:
            continue
        if not out:
            nxt = ways[i + 1] if i + 1 < len(ways) else None
            if nxt and (w[0][0] == nxt[0][0] or w[0][0] == nxt[-1][0]):
                w = w[::-1]
            out = list(w)
            continue
        end = out[-1][0]
        if w[-1][0] == end:
            w = w[::-1]
        elif w[0][0] != end:
            # not joined: take whichever end is nearer
            ex, ez = out[-1][1]
            d0 = math.hypot(w[0][1][0] - ex, w[0][1][1] - ez)
            d1 = math.hypot(w[-1][1][0] - ex, w[-1][1][1] - ez)
            if d1 < d0:
                w = w[::-1]
        out.extend(w[1:] if w[0][0] == end else w)
    return [p for _, p in out]


def project(line, x, z, s_min=0.0):
    """The nearest point of `line` to (x, z) at or after arc length s_min:
    (s, px, pz, dist). Stops come in order, so a route that passes the same
    corner twice matches each stop on its own pass."""
    best, s = None, 0.0
    for i in range(len(line) - 1):
        (ax, az), (bx, bz) = line[i], line[i + 1]
        dx, dz = bx - ax, bz - az
        L = math.hypot(dx, dz)
        if L < 1e-6:
            continue
        t = max(0.0, min(1.0, ((x - ax) * dx + (z - az) * dz) / (L * L)))
        px, pz = ax + dx * t, az + dz * t
        d = math.hypot(x - px, z - pz)
        if s + t * L >= s_min - 1 and (best is None or d < best[3]):
            best = (s + t * L, px, pz, d)
        s += L
    return best


def cut(line, s0, s1):
    out, s = [], 0.0
    for i in range(len(line) - 1):
        (ax, az), (bx, bz) = line[i], line[i + 1]
        L = math.hypot(bx - ax, bz - az)
        if s + L >= s0 and s <= s1:
            if not out:
                t = (s0 - s) / L if L else 0
                out.append((ax + (bx - ax) * t, az + (bz - az) * t))
            if s + L <= s1:
                out.append((bx, bz))
            else:
                t = (s1 - s) / L if L else 0
                out.append((ax + (bx - ax) * t, az + (bz - az) * t))
                break
        s += L
    return out


def simplify(pts, tol):
    """Douglas-Peucker."""
    if len(pts) < 3:
        return pts
    (ax, az), (bx, bz) = pts[0], pts[-1]
    dx, dz = bx - ax, bz - az
    L = math.hypot(dx, dz) or 1e-9
    k, dm = 0, -1
    for i in range(1, len(pts) - 1):
        x, z = pts[i]
        d = abs((x - ax) * dz - (z - az) * dx) / L
        if d > dm:
            k, dm = i, d
    if dm <= tol:
        return [pts[0], pts[-1]]
    return simplify(pts[:k + 1], tol)[:-1] + simplify(pts[k:], tol)


def main():
    ids = {s[1] for s in SECTIONS}
    R = Rel(ids)
    R.apply_file(PBF)
    assert set(R.rels) == ids, f"missing relations: {ids - set(R.rels)}"
    want_n, want_w = set(), set()
    for mem in R.rels.values():
        for ty, ref, role in mem:
            (want_n if ty == "n" else want_w).add(ref)
    G = Geo(want_n, want_w)
    G.apply_file(PBF, locations=True)

    out = []
    for sid, rid, i0, i1, sign, head, col, blurb in SECTIONS:
        mem = R.rels[rid]
        ways = [G.w.get(ref, ([], None))[0] for ty, ref, role in mem if ty == "w" and role == ""]
        line = chain(ways)
        stops = []
        for ty, ref, role in mem:
            if not (role.startswith("platform") or role.startswith("stop")):
                continue
            if ty == "n":
                (x, z), name = G.n[ref]
            else:
                pts, name = G.w[ref]
                x = sum(p[0] for _, p in pts) / len(pts)
                z = sum(p[1] for _, p in pts) / len(pts)
            stops.append((name, x, z))
        sec = stops[i0:i1 + 1]
        assert all(s[0] for s in sec), f"{sid}: an unnamed stop"
        at, s_min = [], 0.0
        for name, x, z in sec:
            pr = project(line, x, z, s_min)
            assert pr and pr[3] < 45, f"{sid}: {name} is {pr and pr[3]:.0f} m off the route"
            at.append(pr[0])
            s_min = pr[0]
        s0, s1 = at[0], at[-1]
        part = simplify(cut(line, s0, s1), 0.8)
        # arc lengths along the CUT line
        at2, s_min = [], 0.0
        for name, x, z in sec:
            pr = project(part, x, z, s_min)
            at2.append(round(pr[0], 1))
            s_min = pr[0]
        length = sum(math.hypot(part[i + 1][0] - part[i][0], part[i + 1][1] - part[i][1]) for i in range(len(part) - 1))
        print(f"{sign:30s} {len(sec):2d} stops  {length / 1000:.2f} km  {sec[0][0]} -> {sec[-1][0]}")
        out.append({
            "id": sid, "rel": rid, "sign": sign, "head": head, "col": col, "blurb": blurb,
            "stops": [[n, round(x, 1), round(z, 1)] for n, x, z in sec],
            "at": at2,
            "line": [[round(x, 1), round(z, 1)] for x, z in part],
        })
    with open(OUT, "w") as f:
        json.dump({"src": "OpenStreetMap GRT route relations (ODbL)", "routes": out}, f, separators=(",", ":"))
    print("wrote", OUT, os.path.getsize(OUT), "bytes")


if __name__ == "__main__":
    main()
