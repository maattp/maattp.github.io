"""Waterloo Region's heavy rail -> apps/autokw/data/rail.json.

    tools/.venv/bin/python tools/kw/build_rail.py      (after extract_rail.py)

From tools/kw/data/raw_rail.json (every railway way in the box, OSM). The
lines trains RUN on, each one track as [x, z, flag] points (flag 1 tunnel,
2 bridge), walked on NODES like build_freight.py (switches sit mid-way):

  guelph  the Guelph Subdivision, west edge (CN, toward Baden and Stratford)
          through Kitchener station to the north-east edge (Metrolinx, toward
          Breslau and Guelph): GO, VIA and CN
  galt    CPKC's Galt Subdivision through Cambridge, edge to edge
  wsub    CPKC's Waterloo Subdivision, off the Galt Sub at Galt north to
          Kitchener's south end (a local)
  spur    the Waterloo Spur from the Waterloo Central Railway's Waterloo
          station (Northfield Dr) north through the St. Jacobs Farmers'
          Market and St. Jacobs to Elmira (the heritage train). South of
          Northfield the spur shares ION's track: that is ION's to draw.

`twins` are the other tracks that run beside a line for 250 m or more (a
second main, a passing siding, the station track), as raw points: the game
projects them onto the line (kwrail.js) and runs trains on them to pass.
`static` is every other track in the box (spurs, yards, the freight-only
spur through Kitchener to Uptown, the Huron Park and Fergus spurs): drawn,
never run on. `platforms` are OSM's railway=platform ways beside the lines,
`stops` the stations the trains call at.
"""

import collections
import heapq
import json
import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from proj import MAP_HALF  # noqa: E402

HERE = os.path.dirname(os.path.abspath(__file__))
RAW = os.path.join(HERE, "data", "raw_rail.json")
OUT = os.path.join(HERE, "..", "..", "apps", "autokw", "data")
EDGE = MAP_HALF - 100.0

LINES = [
    {"key": "guelph", "name": "Guelph Subdivision", "owner": "Metrolinx / CN",
     "names": {"Metrolinx Guelph Subdivision", "CN Guelph Subdivision", "Canadian National Railway - Guelph Subdivision"},
     "ends": "x"},
    {"key": "galt", "name": "Galt Subdivision", "owner": "CPKC", "names": {"Galt Subdivision"}, "ends": "hint",
     # OSM's named ways stop ~900 m short of the south edge: the line goes on
     "hint": [(15900, 8860), (3300, 16100)]},
    {"key": "wsub", "name": "Waterloo Subdivision", "owner": "CPKC", "names": {"Waterloo Subdivision"}, "ends": "far"},
    {"key": "spur", "name": "Waterloo Spur", "owner": "Region of Waterloo / WCR", "names": {"Waterloo Spur"},
     "ends": "from", "from": (-5578.9, -5166.15)},
]
# the stations trains call at, by OSM's name (raw_rail.json stops)
STOPS = {"guelph": ["Kitchener"], "spur": ["Waterloo", "Farmer's Market", "St. Jacobs Village", "Elmira"]}


def flag_of(t):
    return 1 if t.get("tunnel") in ("yes", "building_passage") else 2 if t.get("bridge") in ("yes", "viaduct", "movable") else 0


def seg_dist(px, pz, ax, az, bx, bz):
    sx, sz = bx - ax, bz - az
    l2 = sx * sx + sz * sz or 1e-9
    t = max(0.0, min(1.0, ((px - ax) * sx + (pz - az) * sz) / l2))
    return math.hypot(ax + sx * t - px, az + sz * t - pz)


class Near:
    """Distance from a point to a polyline, through a 50 m grid of its segments."""

    def __init__(self, pts):
        self.pts = pts
        self.g = collections.defaultdict(list)
        for i in range(len(pts) - 1):
            a, b = pts[i], pts[i + 1]
            for cx in range(int(math.floor(min(a[0], b[0]) / 50)) - 1, int(math.floor(max(a[0], b[0]) / 50)) + 2):
                for cz in range(int(math.floor(min(a[1], b[1]) / 50)) - 1, int(math.floor(max(a[1], b[1]) / 50)) + 2):
                    self.g[(cx, cz)].append(i)

    def d(self, x, z):
        best = 1e9
        for i in self.g.get((int(math.floor(x / 50)), int(math.floor(z / 50))), ()):
            a, b = self.pts[i], self.pts[i + 1]
            best = min(best, seg_dist(x, z, a[0], a[1], b[0], b[1]))
        return best


def plen(p):
    return sum(math.hypot(a[0] - b[0], a[1] - b[1]) for a, b in zip(p, p[1:]))


def main():
    d = json.load(open(RAW))
    W = [w for w in d["ways"] if w["t"].get("railway") == "rail" and "Ion" not in (w["t"].get("name") or "")
         and "ION" not in (w["t"].get("name") or "")]
    pos = {}
    for w in W:
        for n, p in zip(w["ids"], w["p"]):
            pos[n] = p

    def graph(names):
        adj = collections.defaultdict(list)
        for wi, w in enumerate(W):
            t = w["t"]
            c = 1.0 if t.get("name") in names and not t.get("service") else 2.0 if t.get("name") in names else 3.0 if t.get("service") in ("crossover", "siding") else 6.0
            for a, b, pa, pb in zip(w["ids"], w["ids"][1:], w["p"], w["p"][1:]):
                L = math.hypot(pa[0] - pb[0], pa[1] - pb[1])
                adj[a].append((b, L * c, wi))
                adj[b].append((a, L * c, wi))
        return adj

    def dijkstra(adj, src, dst=None):
        dist, prev, pq = {src: 0.0}, {}, [(0.0, src)]
        while pq:
            dd, n = heapq.heappop(pq)
            if n == dst:
                break
            if dd > dist[n]:
                continue
            for m, c, wi in adj[n]:
                if dd + c < dist.get(m, 1e18):
                    dist[m] = dd + c
                    prev[m] = (n, wi)
                    heapq.heappush(pq, (dd + c, m))
        return dist, prev

    out = {"lines": [], "static": [], "platforms": []}
    used_ways = set()
    line_pts = {}
    for L in LINES:
        names = L["names"]
        nodes = [n for w in W if w["t"].get("name") in names and not w["t"].get("service") for n in w["ids"]]
        nodes = [n for n in nodes if abs(pos[n][0]) < MAP_HALF + 400 and abs(pos[n][1]) < MAP_HALF + 400]
        adj = graph(names)
        if L["ends"] == "x":
            a = min(nodes, key=lambda n: pos[n][0]); b = max(nodes, key=lambda n: pos[n][0])
        elif L["ends"] == "hint":
            alln = [n for n in pos if n in adj]
            a, b = [min(alln, key=lambda n: math.hypot(pos[n][0] - hx, pos[n][1] - hz)) for hx, hz in L["hint"]]
        elif L["ends"] == "from":
            fx, fz = L["from"]
            a = min(nodes, key=lambda n: math.hypot(pos[n][0] - fx, pos[n][1] - fz))
            dist, _ = dijkstra(adj, a)
            b = max((n for n in nodes if n in dist), key=lambda n: dist[n])
        else:
            # the farthest pair along the track: two sweeps
            dist, _ = dijkstra(adj, nodes[0])
            a = max((n for n in nodes if n in dist), key=lambda n: dist[n])
            dist, _ = dijkstra(adj, a)
            b = max((n for n in nodes if n in dist), key=lambda n: dist[n])
        dist, prev = dijkstra(adj, a, b)
        path, n = [], b
        while n != a:
            m, wi = prev[n]
            path.append((n, wi))
            n = m
        path.append((a, None))
        path.reverse()
        pts = []
        for i, (n, wi) in enumerate(path):
            if wi is not None:
                used_ways.add(wi)
            f = flag_of(W[wi]["t"]) if wi is not None else flag_of(W[path[1][1]]["t"])
            q = pos[n]
            if pts and math.hypot(pts[-1][0] - q[0], pts[-1][1] - q[1]) < 0.05:
                continue
            pts.append([q[0], q[1], f])
        inside = [abs(q[0]) < EDGE and abs(q[1]) < EDGE for q in pts]
        i0 = inside.index(True)
        i1 = len(inside) - 1 - inside[::-1].index(True)
        # a segment leaving the box is cut at its edge, not dropped (OSM's ways
        # can be long: the Galt Sub's last node in the box is 900 m short)
        def clip(a, b):
            lo, hi = 0.0, 1.0
            for k in (0, 1):
                d0 = b[k] - a[k]
                for bound, sg in ((EDGE, 1), (-EDGE, -1)):
                    if abs(d0) < 1e-9:
                        continue
                    t = (bound - a[k]) / d0
                    if sg * d0 > 0:
                        hi = min(hi, t)
            return [a[0] + (b[0] - a[0]) * hi, a[1] + (b[1] - a[1]) * hi, b[2]]
        head = [clip(pts[i0], pts[i0 - 1])] if i0 > 0 else []
        tail = [clip(pts[i1], pts[i1 + 1])] if i1 < len(pts) - 1 else []
        pts = head[::-1] + pts[i0:i1 + 1] + tail
        # an end at the map's edge is where trains come and go; the line may
        # stop a few hundred metres short of it where the extract does
        at_edge = lambda q: max(abs(q[0]), abs(q[1])) > MAP_HALF - 700
        edge0, edge1 = at_edge(pts[0]), at_edge(pts[-1])

        # ...and carried straight on to it where OSM's ways (in the extract) stop
        def extend(a, b):
            dx, dz = b[0] - a[0], b[1] - a[1]
            dl = math.hypot(dx, dz) or 1
            dx, dz = dx / dl, dz / dl
            t = min((EDGE - abs(b[k])) / abs(v) for k, v in ((0, dx), (1, dz)) if abs(v) > 1e-6)
            return [b[0] + dx * t, b[1] + dz * t, 0] if t > 1 else None
        if edge1 and (e := extend(pts[-2], pts[-1])):
            pts.append(e)
        if edge0 and (e := extend(pts[1], pts[0])):
            pts.insert(0, e)
        # a westward / northward-running convention is not needed: s runs a -> b
        line_pts[L["key"]] = pts
        stops = []
        for nm in STOPS.get(L["key"], []):
            cand = [s for s in d["stops"] if s["name"] == nm and (s.get("train") == "yes" or s["railway"] == "station")]
            if cand:
                s = cand[0]
                stops.append({"name": nm, "x": s["x"], "z": s["z"]})
        out["lines"].append({"key": L["key"], "name": L["name"], "owner": L["owner"],
                             "ends": ["edge" if edge0 else "end", "edge" if edge1 else "end"],
                             "pts": [[round(q[0], 2), round(q[1], 2), q[2]] for q in pts], "stops": stops, "twins": []})
        print(L["key"], len(pts), "pts", round(plen(pts)), "m", "ends", edge0, edge1, "stops", [s["name"] for s in stops])

    nears = {k: Near(p) for k, p in line_pts.items()}
    lines_by_key = {l["key"]: l for l in out["lines"]}
    # every other track: a twin of a line where it runs beside it, else static
    static_len = 0
    for wi, w in enumerate(W):
        if wi in used_ways:
            continue
        p = w["p"]
        if not any(abs(q[0]) < EDGE and abs(q[1]) < EDGE for q in p):
            continue
        # densify to ~5 m so runs are measured by length
        dp = [p[0]]
        for q in p[1:]:
            a = dp[-1]
            L = math.hypot(q[0] - a[0], q[1] - a[1])
            k = max(1, int(L / 5))
            for j in range(1, k + 1):
                dp.append([a[0] + (q[0] - a[0]) * j / k, a[1] + (q[1] - a[1]) * j / k])
        tag = []
        for q in dp:
            best = None
            for k, nr in nears.items():
                dd = nr.d(q[0], q[1])
                if best is None or dd < best[1]:
                    best = (k, dd)
            if best[1] < 2.6:
                tag.append(("on", None))
            elif best[1] < 7.5:
                tag.append(("twin", best[0]))
            else:
                tag.append(("free", None))
        # runs
        i = 0
        while i < len(dp):
            j = i
            while j < len(dp) and tag[j] == tag[i]:
                j += 1
            run = dp[max(0, i - 1):min(len(dp), j + 1)] if tag[i][0] == "free" else dp[i:j]
            kind, k = tag[i]
            rl = plen(run)
            if kind == "twin" and rl >= 250:
                lines_by_key[k]["twins"].append([[round(q[0], 2), round(q[1], 2)] for q in run])
            elif kind != "on" and rl >= 25:
                # a short "twin" (a switch's approach, a stub) is static track
                if all(abs(q[0]) < MAP_HALF and abs(q[1]) < MAP_HALF for q in run):
                    sp = [run[0]]
                    for q in run[1:]:
                        if math.hypot(q[0] - sp[-1][0], q[1] - sp[-1][1]) >= 4 or q is run[-1]:
                            sp.append(q)
                    out["static"].append([[round(q[0], 1), round(q[1], 1)] for q in sp])
                    static_len += rl
            i = j
    for l in out["lines"]:
        print(l["key"], "twins", len(l["twins"]), [round(plen(t)) for t in l["twins"]])
    print("static", len(out["static"]), "pieces", round(static_len), "m")
    # platforms beside the running lines (Kitchener; WCR's Waterloo)
    for w in d["ways"]:
        if w["t"].get("railway") != "platform" or w["t"].get("operator") == "Grand River Transit":
            continue
        p = w["p"]
        dd = min(min(nr.d(q[0], q[1]) for nr in nears.values()) for q in p)
        if dd < 12:
            out["platforms"].append({"name": w["t"].get("name"), "pts": [[round(q[0], 2), round(q[1], 2)] for q in p]})
    print("platforms", [(p["name"], round(plen(p["pts"]))) for p in out["platforms"]])
    with open(os.path.join(OUT, "rail.json"), "w") as f:
        json.dump(out, f, separators=(",", ":"))
    print("wrote", os.path.getsize(os.path.join(OUT, "rail.json")) // 1024, "KB")


if __name__ == "__main__":
    main()
