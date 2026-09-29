"""The BNSF main line through Seattle -> apps/auto/data/freight.json.

    tools/.venv/bin/python tools/build_freight.py      (after extract_rail.py)

From tools/data/raw_rail.json: every railway=rail way, as a graph of NODES
(freight switches sit mid-way, and the two main tracks trade places through
crossovers), weighted so the main line is cheapest: usage=main 1x, a
crossover or siding 1.5x, anything else 4x. The first track is the shortest
path from the line's north end (the Scenic Subdivision past Golden Gardens,
north of the map) to its south end (the Seattle Subdivision toward Tukwila);
the second the same with the first's ways six times dearer, so it takes the
other main wherever there is one and shares the first where the line is single
track. Both are cropped to the map and written as points [x, z, flag] (flag 1
tunnel, 2 bridge), named for their direction of travel the way Link's are:
`sb` the western track, `nb` the eastern.

Also: the crew-change stop at Balmer Yard (Interbay), where you board, and the
yard's own tracks round it, drawn but not run on.
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
OUT = os.environ.get("AUTO_DATA_OUT") or os.path.join(HERE, "..", "apps", "auto", "data")
EDGE = MAP_HALF - 100.0
# Balmer Yard, Interbay: the densest cluster of yard tracks on the line
YARD_BOX = (-3700.0, -5500.0, -2700.0, -2800.0)      # x0, z0, x1, z1


def flag_of(t):
    return 1 if t.get("tunnel") in ("yes", "building_passage") else 2 if t.get("bridge") in ("yes", "viaduct", "movable") else 0


def main():
    d = json.load(open(RAW))
    W = [w for w in d["ways"] if w["t"].get("railway") == "rail"]
    pos = {}
    adj = collections.defaultdict(list)

    def cost(t):
        if t.get("usage") == "main" and not t.get("service"):
            return 1.0
        if t.get("service") in ("crossover", "siding"):
            return 1.5
        return 4.0
    for wi, w in enumerate(W):
        c = cost(w["t"])
        for n, p in zip(w["ids"], w["p"]):
            pos[n] = p
        for a, b, pa, pb in zip(w["ids"], w["ids"][1:], w["p"], w["p"][1:]):
            L = math.hypot(pa[0] - pb[0], pa[1] - pb[1])
            adj[a].append((b, L * c, wi, L))
            adj[b].append((a, L * c, wi, L))
    mains = [n for w in W if w["t"].get("usage") == "main" for n in w["ids"]]
    north = min(mains, key=lambda n: pos[n][1])
    south = max(mains, key=lambda n: pos[n][1])

    def path(pen=None):
        dist, prev, pq = {north: 0.0}, {}, [(0.0, north)]
        while pq:
            dd, n = heapq.heappop(pq)
            if n == south:
                break
            if dd > dist[n]:
                continue
            for m, c, wi, L in adj[n]:
                c2 = c * (pen.get(wi, 1) if pen else 1)
                if dd + c2 < dist.get(m, 1e18):
                    dist[m] = dd + c2
                    prev[m] = (n, wi)
                    heapq.heappush(pq, (dd + c2, m))
        out, n = [], south
        while n != north:
            a, wi = prev[n]
            out.append((n, wi))
            n = a
        out.append((north, None))
        out.reverse()
        return out
    p1 = path()
    used = {wi for _, wi in p1 if wi is not None}
    p2 = path({wi: 6 for wi in used})

    def points(p):
        pts = []
        for i, (n, wi) in enumerate(p):
            # a point carries the flag of the way it was reached by (link.js
            # reads a segment's flag off its END point, as build_link writes it)
            f = flag_of(W[wi]["t"]) if wi is not None else flag_of(W[p[1][1]]["t"])
            q = pos[n]
            if pts and abs(pts[-1][0] - q[0]) < 1e-6 and abs(pts[-1][1] - q[1]) < 1e-6:
                continue
            pts.append([q[0], q[1], f])
        inside = [abs(q[0]) < EDGE and abs(q[1]) < EDGE for q in pts]
        i0 = inside.index(True)
        i1 = len(inside) - 1 - inside[::-1].index(True)
        return pts[i0:i1 + 1]
    tracks = [points(p1), points(p2)]
    tracks.sort(key=lambda t: sum(q[0] for q in t) / len(t))
    out = {"sb": tracks[0], "nb": tracks[1]}

    # the crew-change stop: the point of the western main nearest the middle
    # of Balmer Yard's tracks
    x0, z0, x1, z1 = YARD_BOX
    yard = [w for w in W if w["t"].get("service") in ("yard", "siding", "spur") and w["t"].get("usage") != "main"
            and all(x0 < q[0] < x1 and z0 < q[1] < z1 for q in w["p"])]
    cx = sum(q[0] for w in yard for q in w["p"]) / max(1, sum(len(w["p"]) for w in yard))
    cz = sum(q[1] for w in yard for q in w["p"]) / max(1, sum(len(w["p"]) for w in yard))
    best = min(out["sb"], key=lambda q: math.hypot(q[0] - cx, q[1] - cz))
    out["yard"] = {"name": "Balmer Yard", "x": round(best[0], 1), "z": round(best[1], 1)}
    # the yard's tracks, simplified to ~4 m: drawn, not run on
    yt = []
    for w in yard:
        p = [w["p"][0]]
        for q in w["p"][1:]:
            if math.hypot(q[0] - p[-1][0], q[1] - p[-1][1]) >= 4 or q is w["p"][-1]:
                p.append(q)
        if len(p) >= 2 and sum(math.hypot(a[0] - b[0], a[1] - b[1]) for a, b in zip(p, p[1:])) > 30:
            yt.append([[round(q[0], 1), round(q[1], 1)] for q in p])
    out["yardTracks"] = yt

    for k in ("sb", "nb"):
        seg = list(zip(out[k], out[k][1:]))
        L = sum(math.hypot(a[0] - b[0], a[1] - b[1]) for a, b in seg)
        tun = sum(math.hypot(a[0] - b[0], a[1] - b[1]) for a, b in seg if b[2] == 1)
        br = sum(math.hypot(a[0] - b[0], a[1] - b[1]) for a, b in seg if b[2] == 2)
        out[k] = [[round(q[0], 2), round(q[1], 2), q[2]] for q in out[k]]
        print(k, len(out[k]), "pts", round(L), "m; tunnel", round(tun), "bridge", round(br))
    print("yard", out["yard"], len(yt), "yard tracks")
    with open(os.path.join(OUT, "freight.json"), "w") as f:
        json.dump(out, f, separators=(",", ":"))
    print("wrote", os.path.getsize(os.path.join(OUT, "freight.json")) // 1024, "KB")


if __name__ == "__main__":
    main()
