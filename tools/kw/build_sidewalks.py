"""Which side of each street has a sidewalk, and whether a boulevard parts it from the kerb.

    tools/.venv/bin/python tools/kw/build_sidewalks.py

Kitchener, Waterloo and Cambridge have their sidewalks mapped in OSM as
separate ways (highway=footway + footway=sidewalk, ~2,700 km of them in the
map's square, against ~1,600 km of residential street), so which side of a
street has one -- both, one, or none, as a 1950s Westmount street or a
2000s Doon South crescent really has it -- is data, not a guess.

For every street edge of apps/autokw/data/roads.bin (res / st / art, not
elevated or in a tunnel) and each side of it, stations every 5 m along the
edge look for a mapped sidewalk running parallel (|cos| > 0.85) within
hw - 1.5 .. hw + 10 m of the centreline on that side. A side with a hit at
>= 35 % of its stations has a sidewalk; the median distance behind the kerb
line says whether it runs against the kerb (< BLVD_AT) or behind a grass
boulevard. Where no sidewalk is mapped within 120 m of the edge at all (an
unmapped corner of the region), the road's own `sidewalk=` tag decides, and
failing that the side is UNKNOWN and keeps the game's old pavement.

Writes apps/autokw/data/sidewalks.bin:
    'AUTS', u16 version 1, u16 0, u32 edge count, u32 check (the sum of every
    edge's a + b, mod 2^32: a roads.bin rebuilt since makes the game ignore
    this file), then 4 bits per edge, low nibble first: bits 0-1 the +p side
    (+p = (-dz, dx) of a -> b, world.js's sg = +1), bits 2-3 the -p side;
    0 none, 1 against the kerb, 2 behind a boulevard, 3 unknown.

Also writes apps/autokw/data/postboxes.json: OSM's Canada Post boxes in the
square, `c` the community mailboxes (post_box:type=community -- the grey
banks of locked boxes in the post-1985 subdivisions; OSM has ~65, most in
Hespeler's south-east and Guelph's south end) and `s` the red street letter
boxes (every other amenity=post_box), [x, z] each to 0.1 m.

Re-run after build_roads.py (the edge indices are roads.bin's).
"""

import json
import math
import os
import struct
import sys
from collections import defaultdict

import numpy as np
import osmium

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from proj import to_world, MAP_HALF  # noqa: E402

HERE = os.path.dirname(os.path.abspath(__file__))
PBF = os.path.join(HERE, "data", "kw.osm.pbf")
OUT = os.path.join(HERE, "..", "..", "apps", "autokw", "data")
CLS_NAME = ["hwy", "art", "st", "res", "ramp"]
CLASS_HW = {"hwy": 15.0, "art": 9.5, "st": 6.5, "res": 5.5, "ramp": 5.5}
F_ELEV, F_TUNNEL = 1, 2
CELL = 10.0
STEP = 3.0            # sidewalk sample spacing, m
BLVD_AT = 1.0         # median distance behind the kerb line over which a boulevard is drawn
NONE, KERB, BLVD, UNK = 0, 1, 2, 3


def load_roads():
    buf = open(os.path.join(OUT, "roads.bin"), "rb").read()
    magic, ver, ncount, nn, ne = struct.unpack_from("<4sHHII", buf, 0)
    assert magic == b"AUTR"
    o = 16
    nodes = np.frombuffer(buf, dtype=np.dtype([
        ("x", "<i4"), ("z", "<i4"), ("y", "<i2"), ("elev", "u1"), ("pad", "u1")]), count=nn, offset=o)
    o += nn * 12
    edges = np.frombuffer(buf, dtype=np.dtype([
        ("a", "<u4"), ("b", "<u4"), ("cls", "u1"), ("flags", "u1"),
        ("hw", "<u2"), ("name", "<u2"), ("pad", "<u2")]), count=ne, offset=o)
    return nodes, edges


def sample_line(pts, step):
    """[(x, z, dx, dz)] every `step` m along a polyline."""
    out = []
    for i in range(len(pts) - 1):
        (x0, z0), (x1, z1) = pts[i], pts[i + 1]
        L = math.hypot(x1 - x0, z1 - z0)
        if L < 0.01:
            continue
        dx, dz = (x1 - x0) / L, (z1 - z0) / L
        n = max(1, int(L // step))
        for k in range(n):
            t = (k + 0.5) / n
            out.append((x0 + (x1 - x0) * t, z0 + (z1 - z0) * t, dx, dz))
    return out


def main():
    walks = defaultdict(list)     # cell -> [(x, z, dx, dz)]
    boxes = {"c": [], "s": []}
    tags = defaultdict(list)      # cell -> [(x, z, dx, dz, tag)]
    nwalk = ntag = 0
    lim = MAP_HALF + 200
    fp = osmium.FileProcessor(PBF).with_locations()
    for w in fp:
        if isinstance(w, osmium.osm.Node):
            t = w.tags
            if t.get("amenity") == "post_box" and t.get("operator", "Canada Post") == "Canada Post":
                x, z = to_world(w.location.lat, w.location.lon)
                if abs(x) < MAP_HALF and abs(z) < MAP_HALF:
                    k = "c" if (t.get("post_box:type") or "").lower() == "community" else "s"
                    boxes[k].append([round(x, 1), round(z, 1)])
            continue
        if not isinstance(w, osmium.osm.Way):
            continue
        t = w.tags
        h = t.get("highway")
        if not h:
            continue
        is_walk = (h == "footway" and t.get("footway") == "sidewalk") or (h == "path" and t.get("footway") == "sidewalk")
        sw = t.get("sidewalk") or t.get("sidewalk:both")
        if not sw and (t.get("sidewalk:left") or t.get("sidewalk:right")):
            l, r = t.get("sidewalk:left", "no"), t.get("sidewalk:right", "no")
            l, r = l not in ("no", "none"), r not in ("no", "none")
            sw = "both" if l and r else "left" if l else "right" if r else "no"
        if not is_walk and not (sw and h in ("residential", "unclassified", "living_street", "tertiary", "secondary", "primary")):
            continue
        try:
            pts = [to_world(n.location.lat, n.location.lon) for n in w.nodes]
        except osmium.InvalidLocationError:
            continue
        if not any(abs(x) < lim and abs(z) < lim for x, z in pts):
            continue
        if is_walk:
            for s in sample_line(pts, STEP):
                walks[(int(s[0] // CELL), int(s[1] // CELL))].append(s)
                nwalk += 1
        else:
            if sw == "separate":
                continue
            v = "no" if sw in ("no", "none") else sw if sw in ("both", "left", "right") else None
            if not v:
                continue
            for s in sample_line(pts, 10.0):
                tags[(int(s[0] // CELL), int(s[1] // CELL))].append(s + (v,))
                ntag += 1
    print(f"sidewalk samples {nwalk} ({nwalk * STEP / 1000:.0f} km), road tag samples {ntag}")

    nodes, edges = load_roads()
    ne = len(edges)
    NX = nodes["x"].astype(np.float64) / 10
    NZ = nodes["z"].astype(np.float64) / 10
    code = np.full((ne, 2), UNK, dtype=np.uint8)
    stats = defaultdict(float)
    offs = []

    def near(grid, x, z, r):
        c0, c1 = int((x - r) // CELL), int((x + r) // CELL)
        d0, d1 = int((z - r) // CELL), int((z + r) // CELL)
        for cx in range(c0, c1 + 1):
            for cz in range(d0, d1 + 1):
                yield from grid.get((cx, cz), ())

    for ei in range(ne):
        e = edges[ei]
        cls = CLS_NAME[e["cls"]] if e["cls"] < len(CLS_NAME) else "res"
        if cls not in ("res", "st", "art") or e["flags"] & (F_ELEV | F_TUNNEL):
            continue
        ax, az, bx, bz = NX[e["a"]], NZ[e["a"]], NX[e["b"]], NZ[e["b"]]
        L = math.hypot(bx - ax, bz - az)
        if L < 1:
            continue
        dx, dz = (bx - ax) / L, (bz - az) / L
        px, pz = -dz, dx
        hw = e["hw"] / 100 or CLASS_HW[cls]
        mx, mz = (ax + bx) / 2, (az + bz) / 2
        # is the neighbourhood's sidewalk mapped at all?
        mapped = sum(1 for _ in near(walks, mx, mz, 120 + L / 2)) >= 12
        if L < 14:
            st = [L / 2]
        else:
            n = int((L - 12) // 5) + 1
            st = [6 + (L - 12) * (k + 0.5) / n for k in range(n)]
        for si, sg in enumerate((1, -1)):
            hits, ds = 0, []
            for s in st:
                sx, sz = ax + dx * s, az + dz * s
                best = None
                for (x, z, ux, uz) in near(walks, sx, sz, hw + 10):
                    rx, rz = x - sx, z - sz
                    if abs(rx * dx + rz * dz) > 3:
                        continue
                    o = (rx * px + rz * pz) * sg
                    if o < hw - 1.5 or o > hw + 10:
                        continue
                    if abs(ux * dx + uz * dz) < 0.85:
                        continue
                    if best is None or o < best:
                        best = o
                if best is not None:
                    hits += 1
                    ds.append(best - hw)
            if mapped:
                if hits >= 0.35 * len(st):
                    med = sorted(ds)[len(ds) // 2]
                    offs.append(med)
                    code[ei, si] = BLVD if med > BLVD_AT else KERB
                else:
                    code[ei, si] = NONE
        if not mapped:
            # the road's own sidewalk= tag, if one lies along it
            for (x, z, ux, uz, v) in near(tags, mx, mz, 6):
                if abs((x - mx) * px + (z - mz) * pz) > 3 or abs(ux * dx + uz * dz) < 0.85:
                    continue
                same = ux * dx + uz * dz > 0
                # +p = (-dz, dx) is the RIGHT of travel (x east, z south): facing
                # north (0, -1), +p is (1, 0), east. OSM's right is the way's.
                if v == "no":
                    code[ei] = (NONE, NONE)
                elif v == "both":
                    code[ei] = (BLVD, BLVD)
                else:
                    right_is_p = same
                    side_p = (v == "right") == right_is_p
                    code[ei] = (BLVD, NONE) if side_p else (NONE, BLVD)
                break
        for si in range(2):
            stats[(cls, int(code[ei, si]))] += L

    for cls in ("res", "st", "art"):
        tot = sum(v for (c, k), v in stats.items() if c == cls) or 1
        print(f"{cls:4s} " + "  ".join(f"{['none', 'kerb', 'blvd', 'unk'][k]} {stats[(cls, k)] / tot * 100:4.1f}%" for k in range(4))
              + f"   ({tot / 2000:.0f} km)")
    if offs:
        h = np.histogram(np.clip(offs, -2, 8), bins=20, range=(-2, 8))[0]
        print("distance behind the kerb line, -2..8 m by 0.5:", " ".join(str(v) for v in h))

    check = int((edges["a"].astype(np.uint64) + edges["b"].astype(np.uint64)).sum() % (1 << 32))
    packed = bytearray((ne + 1) // 2)
    for ei in range(ne):
        v = int(code[ei, 0]) | (int(code[ei, 1]) << 2)
        packed[ei >> 1] |= v << (4 * (ei & 1))
    blob = struct.pack("<4sHHII", b"AUTS", 1, 0, ne, check) + bytes(packed)
    p = os.path.join(OUT, "sidewalks.bin")
    open(p, "wb").write(blob)
    print(f"wrote {p} ({len(blob) / 1000:.0f} KB, {ne} edges)")
    p = os.path.join(OUT, "postboxes.json")
    json.dump(boxes, open(p, "w"), separators=(",", ":"))
    print(f"wrote {p}: {len(boxes['c'])} community mailboxes, {len(boxes['s'])} street letter boxes")


if __name__ == "__main__":
    main()
