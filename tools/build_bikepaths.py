"""Seattle's bike paths from OSM -> apps/auto/data/bikepaths.json.

    tools/.venv/bin/python tools/build_bikepaths.py

One full scan of the state extract (~15 s). Keeps what a cyclist rides that
the road import does not already carry: highway=cycleway, and paths,
footways, tracks and bridleways signed bicycle=designated (the Burke-Gilman,
the Elliott Bay Trail and the other multi-use trails are mapped both ways).
Painted lanes on a road (cycleway=lane) are the road's and are not here.

Each way is cropped to the map, simplified to ~0.8 m, and written as
{p: [[x, z], ...], a: first node id, b: last node id, n: name index,
f: flags} -- flags 1 bridge, 2 tunnel, 4 unpaved -- so bikes.js can join the
ways at shared end nodes into a network.
"""

import json
import math
import os
import sys

import osmium

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from proj import to_world, MAP_HALF  # noqa: E402

HERE = os.path.dirname(os.path.abspath(__file__))
PBF = os.path.join(HERE, "data", "washington-latest.osm.pbf")
OUT = os.environ.get("AUTO_DATA_OUT") or os.path.join(HERE, "..", "apps", "auto", "data")
S, N, W, E = 47.490, 47.732, -122.515, -122.160
EDGE = MAP_HALF - 50.0
PATHS = {"path", "footway", "track", "bridleway", "pedestrian"}
UNPAVED = {"unpaved", "gravel", "fine_gravel", "dirt", "ground", "compacted", "grass", "sand", "wood", "mud"}


def rdp(pts, eps):
    if len(pts) < 3:
        return pts
    ax, az = pts[0]; bx, bz = pts[-1]
    dx, dz = bx - ax, bz - az
    L = math.hypot(dx, dz) or 1e-9
    best, bi = 0.0, 0
    for i in range(1, len(pts) - 1):
        d = abs((pts[i][0] - ax) * dz - (pts[i][1] - az) * dx) / L
        if d > best:
            best, bi = d, i
    if best <= eps:
        return [pts[0], pts[-1]]
    return rdp(pts[:bi + 1], eps)[:-1] + rdp(pts[bi:], eps)


class Grab(osmium.SimpleHandler):
    def __init__(self):
        super().__init__()
        self.ways = []

    def way(self, w):
        t = w.tags
        hw = t.get("highway")
        if hw == "cycleway":
            pass
        elif hw in PATHS and t.get("bicycle") == "designated":
            pass
        else:
            return
        if t.get("area") == "yes" or t.get("access") in ("private", "no"):
            return
        try:
            ll = [(nd.lat, nd.lon) for nd in w.nodes]
        except osmium.InvalidLocationError:
            return
        if not any(S < la < N and W < lo < E for la, lo in ll):
            return
        pts = [to_world(la, lo) for la, lo in ll]
        f = (1 if t.get("bridge") not in (None, "no") else 0) | (2 if t.get("tunnel") not in (None, "no") else 0) \
            | (4 if t.get("surface") in UNPAVED else 0)
        self.ways.append({"ids": [w.nodes[0].ref, w.nodes[-1].ref], "p": pts, "name": t.get("name"), "f": f})


def main():
    g = Grab()
    g.apply_file(PBF, locations=True, idx="flex_mem")
    names, idx, out, km = [], {}, [], 0.0
    for w in g.ways:
        # crop to the map: keep the runs inside, split where it leaves
        runs, cur = [], []
        for x, z in w["p"]:
            if abs(x) < EDGE and abs(z) < EDGE:
                cur.append((x, z))
            elif cur:
                runs.append(cur); cur = []
        if cur:
            runs.append(cur)
        whole = len(runs) == 1 and len(runs[0]) == len(w["p"])
        for r in runs:
            if len(r) < 2:
                continue
            p = rdp(r, 0.8)
            n = w["name"]
            if n not in idx:
                idx[n] = len(names); names.append(n)
            km += sum(math.hypot(b[0] - a[0], b[1] - a[1]) for a, b in zip(p, p[1:])) / 1000
            out.append({"p": [[round(x, 1), round(z, 1)] for x, z in p],
                        "a": w["ids"][0] if whole else 0, "b": w["ids"][1] if whole else 0,
                        "n": idx[n], "f": w["f"]})
    assert len(out) > 500, f"only {len(out)} bike paths: the filter is wrong"
    assert km > 200, f"only {km:.0f} km of bike path"
    named = {}
    for w in out:
        nm = names[w["n"]]
        if nm:
            named[nm] = named.get(nm, 0) + sum(math.hypot(b[0] - a[0], b[1] - a[1]) for a, b in zip(w["p"], w["p"][1:]))
    for must in ("Burke-Gilman Trail", "Elliott Bay Trail"):
        assert named.get(must, 0) > 1000, f"{must} missing"
    top = sorted(named.items(), key=lambda kv: -kv[1])[:12]
    print(f"{len(out)} ways, {km:.0f} km; longest named:", ", ".join(f"{k} {v / 1000:.1f} km" for k, v in top))
    path = os.path.join(OUT, "bikepaths.json")
    with open(path, "w") as f:
        json.dump({"names": names, "paths": out}, f, separators=(",", ":"))
    print("wrote", path, os.path.getsize(path) // 1024, "KB")


if __name__ == "__main__":
    main()
