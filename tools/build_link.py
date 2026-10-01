"""Link light rail's 1 Line -> apps/auto/data/link.json.

    tools/.venv/bin/python tools/build_link.py      (after extract_rail.py)

From tools/data/raw_rail.json: the running tracks (railway=light_rail with no
`service` tag -- yards, crossovers and sidings are left out) form two
connected networks, one per track, each with three ends: the 1 Line's north
and south ends and the 2 Line's east end, joined at the junction south of
International District. Each track is walked north -> south as the path
between its two 1 Line ends, and north -> east for the 2 Line (`sb2`, `nb2`:
the same rails as far as the junction), cropped to the map, and written as
points [x, z, flag] (flag 1 tunnel, 2 bridge). Stations are the named light-rail
stops within 80 m of the line, at their s along each track.

The two tracks are named for their direction of travel: trains keep right, so
`sb` is the western (southbound) track and `nb` the eastern.
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


def main():
    d = json.load(open(RAW))
    lr = [w for w in d["ways"] if w["t"].get("railway") == "light_rail" and w["t"].get("service") is None]
    # A graph of WAYS joined at their end nodes: the two tracks share nodes
    # mid-way at switches, so a node-level graph welds them into one network;
    # joined only at way ends they stay two.
    adj = collections.defaultdict(list)
    for i, w in enumerate(lr):
        adj[w["ids"][0]].append(i); adj[w["ids"][-1]].append(i)

    def wlen(w):
        return sum(math.hypot(a[0] - b[0], a[1] - b[1]) for a, b in zip(w["p"], w["p"][1:]))

    def flag(w):
        t = w["t"]
        return 1 if t.get("tunnel") in ("yes", "building_passage") else 2 if t.get("bridge") in ("yes", "viaduct") else 0
    seen, comps = set(), []
    for i in range(len(lr)):
        if i in seen:
            continue
        st, comp = [i], []
        seen.add(i)
        while st:
            j = st.pop(); comp.append(j)
            for e in (lr[j]["ids"][0], lr[j]["ids"][-1]):
                for k in adj[e]:
                    if k not in seen:
                        seen.add(k); st.append(k)
        comps.append(comp)
    comps.sort(key=lambda c: -sum(wlen(lr[j]) for j in c))
    tracks = []
    branches = []   # per track: the 2 Line's route, north end -> east end
    for comp in comps[:2]:
        ends = collections.Counter()
        for j in comp:
            ends[lr[j]["ids"][0]] += 1; ends[lr[j]["ids"][-1]] += 1
        pos = {}
        for j in comp:
            pos[lr[j]["ids"][0]] = lr[j]["p"][0]; pos[lr[j]["ids"][-1]] = lr[j]["p"][-1]
        terms = [n for n, c in ends.items() if c == 1]
        north = min(terms, key=lambda n: pos[n][1])
        south = max(terms, key=lambda n: pos[n][1])
        east = max(terms, key=lambda n: pos[n][0])

        def walk(dst):
            dist, prev, pq = {north: 0}, {}, [(0, north)]
            while pq:
                dd, n = heapq.heappop(pq)
                if n == dst:
                    break
                if dd > dist.get(n, 1e18):
                    continue
                for j in adj[n]:
                    if j not in comp:
                        continue
                    w = lr[j]
                    m = w["ids"][-1] if w["ids"][0] == n else w["ids"][0]
                    nd = dd + wlen(w)
                    if nd < dist.get(m, 1e18):
                        dist[m] = nd; prev[m] = (n, j); heapq.heappush(pq, (nd, m))
            chain, n = [], dst
            while n != north:
                a, j = prev[n]
                chain.append((a, j)); n = a
            chain.reverse()
            pts = []
            for a, j in chain:
                w = lr[j]
                p = w["p"] if w["ids"][0] == a else list(reversed(w["p"]))
                f = flag(w)
                for q in (p if not pts else p[1:]):
                    pts.append([q[0], q[1], f])
            inside = [abs(p[0]) < EDGE and abs(p[1]) < EDGE for p in pts]
            i0 = inside.index(True)
            i1 = len(inside) - 1 - inside[::-1].index(True)
            return pts[i0:i1 + 1]
        tracks.append(walk(south))
        # The 2 Line: the same track from the north end to the junction south
        # of International District, then its own branch east across I-90
        branches.append(walk(east))
    # name them: the western one is southbound
    def mean_x(p):
        return sum(q[0] for q in p) / len(p)
    order = sorted(range(2), key=lambda i: mean_x(tracks[i]))
    out = {"sb": tracks[order[0]], "nb": tracks[order[1]],
           # a 2 Line track rides its 1 Line track's rails as far as the junction
           "sb2": branches[order[0]], "nb2": branches[order[1]]}
    # stations
    stops = [s for s in d["stops"] if s.get("name") and (s.get("light_rail") == "yes" or s.get("station") == "light_rail")]
    by = collections.defaultdict(list)
    for s in stops:
        by[s["name"].replace("International District/Chinatown", "International District Chinatown")].append(s)

    def near(track, x, z):
        best, bs, acc = 1e18, 0, 0
        for i in range(len(track) - 1):
            a, b = track[i], track[i + 1]
            ex, ez = b[0] - a[0], b[1] - a[1]
            L2 = ex * ex + ez * ez or 1
            t = max(0, min(1, ((x - a[0]) * ex + (z - a[1]) * ez) / L2))
            px, pz = a[0] + ex * t, a[1] + ez * t
            dd = math.hypot(px - x, pz - z)
            if dd < best:
                best, bs = dd, acc + math.sqrt(L2) * t
            acc += math.sqrt(L2)
        return best, bs
    stations = []
    KEYS = ("sb", "nb", "sb2", "nb2")
    for name, ss in by.items():
        x = sum(s["x"] for s in ss) / len(ss); z = sum(s["z"] for s in ss) / len(ss)
        st = {"name": name, "x": round(x, 1), "z": round(z, 1)}
        for k in KEYS:
            dk, sk = near(out[k], x, z)
            if dk < 80:
                st["s_" + k] = round(sk, 1)
        if not any("s_" + k in st for k in KEYS):
            continue
        # a station on the map's edge has no room for its platforms
        if max(abs(x), abs(z)) > EDGE - 70:
            continue
        stations.append(st)
    stations.sort(key=lambda s: s.get("s_sb", 1e6 + s.get("s_sb2", 0)))
    out["stations"] = stations
    for k in KEYS:
        L = sum(math.hypot(a[0] - b[0], a[1] - b[1]) for a, b in zip(out[k], out[k][1:]))
        tun = sum(math.hypot(a[0] - b[0], a[1] - b[1]) for a, b in zip(out[k], out[k][1:]) if a[2] == 1)
        br = sum(math.hypot(a[0] - b[0], a[1] - b[1]) for a, b in zip(out[k], out[k][1:]) if a[2] == 2)
        out[k] = [[round(p[0], 2), round(p[1], 2), p[2]] for p in out[k]]
        print(k, len(out[k]), "pts", round(L), "m; tunnel", round(tun), "bridge", round(br))
    print(len(stations), "stations:", ", ".join(s["name"] for s in stations))
    with open(os.path.join(OUT, "link.json"), "w") as f:
        json.dump(out, f, separators=(",", ":"))
    print("wrote", os.path.getsize(os.path.join(OUT, "link.json")) // 1024, "KB")


if __name__ == "__main__":
    main()
