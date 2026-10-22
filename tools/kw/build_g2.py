"""The G2 / G road test's data: DriveTest Kitchener, and the posted speed limits round it.

    tools/.venv/bin/python tools/kw/build_g2.py

The road graph (roads.bin) keeps a class and a half-width per edge, never OSM's
`maxspeed`, and the game's streets have no posted limit of their own -- only the
freeways do (build_hwy.py, highways.js). A road test is marked on the posted
limit, so this finds every graph edge within R of the centre again in OSM's
ways by geometry (raw_roads.json from osm_extract.py: the nearest segment
within 5 m of the edge's midpoint and parallel to it, |cos| > 0.93, its own
name preferred) and writes its `maxspeed` (km/h).

The centre is OSM's own node (amenity=driving_school "DriveTest",
1405 Ottawa Street North: the plaza at Ottawa St N and Lackner Blvd, with Food
Basics, a Rexall and Gino's Pizza), read from raw_pois.json.

Writes apps/autokw/data/g2.json:
    { v: 1, check (the sum of every edge's a + b mod 2^32, as artlanes.bin:
      a roads.bin rebuilt since makes the game fall back to class defaults),
      centre: { x, z, name, addr }, r,
      e: [edge index deltas, ascending], k: [km/h for each] }
It is fetched when a test starts (g2test.js), never at boot.

Re-run after build_roads.py (the edge indices are roads.bin's).
"""

import json
import math
import os
import struct
import sys
from collections import defaultdict

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from build_sidewalks import load_roads, CLS_NAME, OUT  # noqa: E402

HERE = os.path.dirname(os.path.abspath(__file__))
DATA = os.environ.get("KW_DATA") or os.path.join(HERE, "..", "data", "kw")
R = 6500.0          # edges this far from the centre (the G test's freeway leg reaches ~5 km)
CELL = 25.0
SNAP = 5.0
COS = 0.93


def num(v):
    try:
        return int(float(str(v).split(";")[0].split()[0]))
    except (TypeError, ValueError, IndexError):
        return None


def main():
    pois = json.load(open(os.path.join(DATA, "raw_pois.json")))
    pois = pois["pois"] if isinstance(pois, dict) else pois
    centre = None
    for p in pois:
        t = p.get("t") or {}
        if p.get("n") == "DriveTest" and t.get("addr:housenumber") == "1405" and "Ottawa" in (t.get("addr:street") or ""):
            centre = {"x": round(p["x"], 1), "z": round(p["z"], 1), "name": "DriveTest Kitchener",
                      "addr": "1405 Ottawa St N, Unit 11"}
    if not centre:
        sys.exit("no DriveTest at 1405 Ottawa Street North in raw_pois.json")
    cx, cz = centre["x"], centre["z"]
    print("centre", centre)

    roads = json.load(open(os.path.join(DATA, "raw_roads.json")))["roads"]
    segs = defaultdict(list)
    nsp = 0
    for r in roads:
        sp = num(r.get("sp"))
        if not sp or sp < 10 or sp > 120:
            continue
        p = r["p"]
        if min(math.hypot(x - cx, z - cz) for x, z in p) > R + 200:
            continue
        nsp += 1
        nm = r.get("name") or ""
        for i in range(len(p) - 1):
            (x0, z0), (x1, z1) = p[i], p[i + 1]
            L = math.hypot(x1 - x0, z1 - z0)
            if L < 0.05:
                continue
            n = max(1, int(L // CELL) + 1)
            cells = set()
            for k in range(n + 1):
                x, z = x0 + (x1 - x0) * k / n, z0 + (z1 - z0) * k / n
                cells.add((int(x // CELL), int(z // CELL)))
            for c in cells:
                segs[c].append((x0, z0, x1, z1, nm, sp))
    print(f"{nsp} OSM ways with a maxspeed within {R / 1000:.0f} km")

    nodes, edges = load_roads()
    buf = open(os.path.join(OUT, "roads.bin"), "rb").read()
    o = 16 + len(nodes) * 12 + len(edges) * 16
    names = []
    while o < len(buf):
        ln, = struct.unpack_from("<H", buf, o)
        names.append(buf[o + 2:o + 2 + ln].decode("utf-8"))
        o += 2 + ln
    NX = nodes["x"].astype(np.float64) / 10
    NZ = nodes["z"].astype(np.float64) / 10
    out_e, out_k = [], []
    stats = defaultdict(float)
    for ei in range(len(edges)):
        e = edges[ei]
        ax, az, bx, bz = NX[e["a"]], NZ[e["a"]], NX[e["b"]], NZ[e["b"]]
        mx, mz = (ax + bx) / 2, (az + bz) / 2
        if math.hypot(mx - cx, mz - cz) > R:
            continue
        L = math.hypot(bx - ax, bz - az)
        if L < 0.5:
            continue
        cls = CLS_NAME[e["cls"]] if e["cls"] < len(CLS_NAME) else "res"
        dx, dz = (bx - ax) / L, (bz - az) / L
        nm = names[e["name"]] if e["name"] < len(names) else ""
        best, bd = None, 1e9
        for s in (0.5, 0.25, 0.75):
            px, pz = ax + (bx - ax) * s, az + (bz - az) * s
            for (x0, z0, x1, z1, wn, sp) in segs.get((int(px // CELL), int(pz // CELL)), ()):
                sx, sz = x1 - x0, z1 - z0
                l2 = sx * sx + sz * sz
                if abs((sx * dx + sz * dz) / math.sqrt(l2)) < COS:
                    continue
                t = max(0.0, min(1.0, ((px - x0) * sx + (pz - z0) * sz) / l2))
                d = math.hypot(x0 + sx * t - px, z0 + sz * t - pz)
                if d > SNAP:
                    continue
                d += 0 if wn == nm else 2.5
                if d < bd:
                    bd, best = d, sp
            if best:
                break
        stats[cls + " km"] += L
        if not best:
            continue
        stats[cls + " km posted"] += L
        stats[f"{cls} {best}"] += L
        out_e.append(ei)
        out_k.append(best)
    for k in sorted(stats):
        print(f"  {k:24s} {stats[k] / 1000:8.1f} km")
    check = int((edges["a"].astype(np.uint64) + edges["b"].astype(np.uint64)).sum() % (1 << 32))
    de, prev = [], 0
    for ei in out_e:
        de.append(ei - prev)
        prev = ei
    doc = {"v": 1, "check": check, "centre": centre, "r": R, "e": de, "k": out_k}
    p = os.path.join(OUT, "g2.json")
    with open(p, "w") as f:
        json.dump(doc, f, separators=(",", ":"))
    print(f"wrote {p} ({os.path.getsize(p) / 1000:.0f} KB, {len(out_e)} edges posted)")


if __name__ == "__main__":
    main()
