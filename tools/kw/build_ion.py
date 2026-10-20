"""ION light rail, Conestoga to Fairway -> apps/autokw/data/link.json.

    tools/.venv/bin/python tools/kw/build_ion.py      (after extract_rail.py)

Same format as Seattle's Link (tools/build_link.py; src/link.js reads it):
two tracks `sb` and `nb` as [x, z, flag] points, `sb2`/`nb2` the same rails
(ION has one line), and the stations at their s along each track.

ION's two tracks are not two clean OSM networks the way Link's are: north of
Uptown long stretches are mapped as one way per track that meet the other at
switches part-way along a way, and the tracks split onto Caroline and King
through Uptown. So the walk is on NODES, not ways: the shortest route from
the node nearest Conestoga station to the node nearest Fairway is the first
track, and the second is the shortest route with the first one's edges made
25 times as long -- it takes the other rails wherever there are two, and
shares the one where there is one.
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


def main():
    d = json.load(open(RAW))
    # running tracks, and the crossovers between them (dear: a route takes one
    # only to get to the other track at all)
    lr = [w for w in d["ways"] if w["t"].get("railway") == "light_rail" and w["t"].get("service") in (None, "crossover")]
    pos, adj = {}, collections.defaultdict(list)

    def flag(w):
        t = w["t"]
        return 1 if t.get("tunnel") in ("yes", "building_passage") else 2 if t.get("bridge") in ("yes", "viaduct") else 0
    for w in lr:
        f = flag(w)
        for (a, pa), (b, pb) in zip(zip(w["ids"], w["p"]), zip(w["ids"][1:], w["p"][1:])):
            pos[a], pos[b] = pa, pb
            L = math.hypot(pa[0] - pb[0], pa[1] - pb[1]) * (40 if w["t"].get("service") else 1)
            adj[a].append((b, L, f)); adj[b].append((a, L, f))
    # OSM has gaps where two ways of one track stop a few metres apart without
    # sharing a node (at Waterloo Public Square, 6 m and 25 m): a dead end
    # within 30 m of another track's node is joined to it.
    for n in [n for n in adj if len(adj[n]) == 1]:
        px, pz = pos[n]
        # not a node of its own track: anything within 120 m along the rails
        near, st = {n: 0.0}, [n]
        while st:
            u = st.pop()
            for v, L, _ in adj[u]:
                dv = near[u] + L
                if dv < 120 and dv < near.get(v, 1e9):
                    near[v] = dv; st.append(v)
        m = min((k for k in pos if k not in near), key=lambda k: (pos[k][0] - px) ** 2 + (pos[k][1] - pz) ** 2)
        L = math.hypot(pos[m][0] - px, pos[m][1] - pz)
        if L < 30:
            adj[n].append((m, L, 0)); adj[m].append((n, L, 0))
            print(f"joined a gap of {L:.1f} m at ({px:.0f}, {pz:.0f})")
    stops = {s["name"]: s for s in d["stops"] if s.get("name")}

    def nearest_node(name):
        s = stops[name]
        return min(pos, key=lambda n: math.hypot(pos[n][0] - s["x"], pos[n][1] - s["z"]))
    A, B = nearest_node("Conestoga"), nearest_node("Fairway")

    def route(pen):
        dist, prev, pq = {A: 0}, {}, [(0, A)]
        while pq:
            dd, n = heapq.heappop(pq)
            if n == B:
                break
            if dd > dist.get(n, 1e18):
                continue
            for m, L, f in adj[n]:
                nd = dd + L * (25.0 if (n, m) in pen or (m, n) in pen else 1.0)
                if nd < dist.get(m, 1e18):
                    dist[m] = nd; prev[m] = (n, f); heapq.heappush(pq, (nd, m))
        if B not in prev:
            sys.exit("ION: no route Conestoga -> Fairway")
        out, n = [], B
        while n != A:
            p, f = prev[n]
            out.append((n, f)); n = p
        out.append((A, 0))
        out.reverse()
        return out
    t1 = route(set())
    used = {(a, b) for (a, _), (b, _) in zip(t1, t1[1:])}
    t2 = route(used)
    pts = lambda t: [[round(pos[n][0], 2), round(pos[n][1], 2), f] for n, f in t]  # noqa: E731
    p1, p2 = pts(t1), pts(t2)
    # trains keep right: heading south-east (Conestoga -> Fairway) the right
    # hand track is the one to the south-west of the pair
    def side(p, q):
        # mean signed offset of q from p's direction of travel (+ = right)
        acc, n = 0.0, 0
        for i in range(0, len(p) - 1, 5):
            ax, az = p[i][0], p[i][1]
            dx, dz = p[i + 1][0] - ax, p[i + 1][1] - az
            L = math.hypot(dx, dz) or 1
            b = min(q, key=lambda r: (r[0] - ax) ** 2 + (r[1] - az) ** 2)
            acc += ((b[0] - ax) * (-dz) + (b[1] - az) * dx) / L
            n += 1
        return acc / max(1, n)
    # "sb" runs Conestoga -> Fairway on the right-hand track
    if side(p1, p2) > 0:
        sb, nb = p2, p1    # p2 lies to p1's right
    else:
        sb, nb = p1, p2
    out = {"sb": sb, "nb": nb, "sb2": sb, "nb2": nb}

    def near(track, x, z):
        best, bs, acc = 1e18, 0, 0
        for i in range(len(track) - 1):
            a, b = track[i], track[i + 1]
            ex, ez = b[0] - a[0], b[1] - a[1]
            L2 = ex * ex + ez * ez or 1
            t = max(0, min(1, ((x - a[0]) * ex + (z - a[1]) * ez) / L2))
            dd = math.hypot(a[0] + ex * t - x, a[1] + ez * t - z)
            if dd < best:
                best, bs = dd, acc + math.sqrt(L2) * t
            acc += math.sqrt(L2)
        return best, bs
    by = collections.defaultdict(list)
    for s in d["stops"]:
        if s.get("name") and (s.get("light_rail") == "yes" or s.get("station") == "light_rail"):
            by[s["name"]].append(s)
    stations = []
    for name, ss in by.items():
        x = sum(s["x"] for s in ss) / len(ss); z = sum(s["z"] for s in ss) / len(ss)
        st = {"name": name, "x": round(x, 1), "z": round(z, 1)}
        for k in ("sb", "nb", "sb2", "nb2"):
            dk, sk = near(out[k], x, z)
            if dk < 90:
                st["s_" + k] = round(sk, 1)
        if "s_sb" in st or "s_nb" in st:
            stations.append(st)
    stations.sort(key=lambda s: s.get("s_sb", s.get("s_nb", 0)))
    out["stations"] = stations
    for k in ("sb", "nb"):
        L = sum(math.hypot(a[0] - b[0], a[1] - b[1]) for a, b in zip(out[k], out[k][1:]))
        print(k, len(out[k]), "pts", round(L), "m")
    print(len(stations), "stations:", ", ".join(s["name"] for s in stations))
    assert len(stations) >= 17, "ION stations missing"
    with open(os.path.join(OUT, "link.json"), "w") as f:
        json.dump(out, f, separators=(",", ":"))
    print("wrote", os.path.getsize(os.path.join(OUT, "link.json")) // 1024, "KB")


if __name__ == "__main__":
    main()
