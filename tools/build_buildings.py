"""Pack OSM building footprints into chunk-tiled binary the game can stream.

Each real footprint is reduced to its **minimum-area oriented rectangle**, not
kept as a polygon. That is a deliberate trade. Buildings land in the right place
at the right size, orientation and height, which is what reads from a car; the
corner detail of 125k footprints does not. In exchange, world.js's existing
rectangle mesher, the facade/window system and the box collision all keep
working unchanged, and the file is a third the size a polygon build would be.

What it does buy over the old procedural blocks is that these rectangles are
where buildings really are -- so `roadFit`, the lot-shrinking pass and
`placeTower`'s search-outward hack all become unnecessary. A real footprint is
not standing in the road, because the road is real too.

Format (little-endian):
  'AUTB' u16 version, u16 nx, u16 nz, u16 pad
  u32 dir[nx*nz + 1]          prefix offsets into the record blob
  records, grouped by chunk (12 bytes each):
      u16 x, u16 z            0.1 m from the chunk origin minus MARGIN
      u16 w, u16 d            0.05 m
      u16 h                   0.05 m
      u8  rot                 rot * 256 / pi   (a box is symmetric under pi)
      u8  cls
"""

import json
import math
import os
import struct
import sys
from collections import defaultdict

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from proj import MAP_HALF  # noqa: E402

HERE = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.join(HERE, "data")
OUT = os.path.join(HERE, "..", "apps", "auto", "data")

CHUNK = 400                       # matches citygen.CHUNK
NX = NZ = (MAP_HALF * 2) // CHUNK  # 40 x 40
MARGIN = 200.0                    # a footprint centre may sit outside its chunk
MIN_AREA = 35.0                   # sheds, garages and bin stores
REC = 12

# cls: 0 house, 1 apartment, 2 commercial/office, 3 industrial, 4 civic
TYPE_CLS = {
    "house": 0, "detached": 0, "residential": 0, "bungalow": 0, "semidetached_house": 0,
    "terrace": 0, "static_caravan": 0, "cabin": 0,
    "apartments": 1, "dormitory": 1, "hotel": 1,
    "commercial": 2, "retail": 2, "office": 2, "supermarket": 2, "kiosk": 2, "shop": 2,
    "industrial": 3, "warehouse": 3, "manufacture": 3, "hangar": 3, "storage_tank": 3,
    "garage": 3, "garages": 3, "carport": 3, "roof": 3, "shed": 3, "service": 3,
    "church": 4, "cathedral": 4, "civic": 4, "school": 4, "university": 4, "college": 4,
    "hospital": 4, "public": 4, "government": 4, "train_station": 4, "stadium": 4,
    "museum": 4, "chapel": 4, "sports_centre": 4, "fire_station": 4,
}
CLS_STOREY_H = {0: 3.1, 1: 3.1, 2: 3.9, 3: 5.2, 4: 4.4}
CLS_DEFAULT_H = {0: 6.4, 1: 12.5, 2: 11.0, 3: 8.5, 4: 10.0}


def poly_area(p):
    a = 0.0
    for i in range(len(p)):
        j = (i + 1) % len(p)
        a += p[i][0] * p[j][1] - p[j][0] * p[i][1]
    return abs(a) / 2


def hull(pts):
    """Monotone chain convex hull."""
    pts = sorted(set(pts))
    if len(pts) <= 2:
        return pts
    cross = lambda o, a, b: ((a[0] - o[0]) * (b[1] - o[1])  # noqa: E731
                             - (a[1] - o[1]) * (b[0] - o[0]))
    lo = []
    for p in pts:
        while len(lo) >= 2 and cross(lo[-2], lo[-1], p) <= 0:
            lo.pop()
        lo.append(p)
    up = []
    for p in reversed(pts):
        while len(up) >= 2 and cross(up[-2], up[-1], p) <= 0:
            up.pop()
        up.append(p)
    return lo[:-1] + up[:-1]


def min_area_rect(pts):
    """(cx, cz, w, d, rot) of the smallest rectangle containing pts.

    Rotating calipers: the minimum-area rectangle always has a side flush with a
    hull edge, so trying each edge's direction is exhaustive, not a heuristic.
    """
    h = hull(pts)
    if len(h) < 3:
        xs = [p[0] for p in pts]
        zs = [p[1] for p in pts]
        return ((min(xs) + max(xs)) / 2, (min(zs) + max(zs)) / 2,
                max(1.0, max(xs) - min(xs)), max(1.0, max(zs) - min(zs)), 0.0)
    best = None
    for i in range(len(h)):
        ax, az = h[i]
        bx, bz = h[(i + 1) % len(h)]
        ex, ez = bx - ax, bz - az
        L = math.hypot(ex, ez)
        if L < 1e-9:
            continue
        ux, uz = ex / L, ez / L
        vx, vz = -uz, ux
        us = [p[0] * ux + p[1] * uz for p in h]
        vs = [p[0] * vx + p[1] * vz for p in h]
        u0, u1, v0, v1 = min(us), max(us), min(vs), max(vs)
        area = (u1 - u0) * (v1 - v0)
        if best is None or area < best[0]:
            cu, cv = (u0 + u1) / 2, (v0 + v1) / 2
            best = (area, cu * ux + cv * vx, cu * uz + cv * vz,
                    u1 - u0, v1 - v0, math.atan2(ux, uz))
    _, cx, cz, w, d, rot = best
    return cx, cz, max(1.0, w), max(1.0, d), rot


def height_of(b, cls, area):
    h = b.get("ht")
    if h:
        try:
            v = float(str(h).strip().lower().replace("m", "").strip().split()[0])
            # A small whole number on a big footprint is a storey count somebody
            # typed into `height`, not metres. Benaroya Hall is tagged height=4:
            # taken literally that is a 6100 m2 building four metres tall, and it
            # renders as a white plain across the middle of downtown. Six
            # buildings in the box trip this, and they are all landmarks.
            if v <= 12 and v == int(v) and area > 600 and not b.get("lv"):
                return v * CLS_STOREY_H[cls] + 1.0
            if 2.0 <= v <= 320.0:
                return v
        except (ValueError, IndexError):
            pass
    lv = b.get("lv")
    if lv:
        try:
            n = float(str(lv).split(";")[0])
            if 0.5 <= n <= 90:
                return n * CLS_STOREY_H[cls] + 1.0
        except ValueError:
            pass
    return CLS_DEFAULT_H[cls]


def main():
    raw = json.load(open(os.path.join(DATA, "raw_buildings.json")))["buildings"]
    print(f"{len(raw)} raw footprints")

    chunks = defaultdict(list)
    kept = tagged = dropped_small = outside = 0
    tallest = (0.0, "")
    for b in raw:
        ring = [tuple(p) for p in b["o"]]
        if len(ring) >= 2 and ring[0] == ring[-1]:
            ring = ring[:-1]
        if len(ring) < 3:
            continue
        area = poly_area(ring)
        if area < MIN_AREA:
            dropped_small += 1
            continue
        cx, cz, w, d, rot = min_area_rect(ring)
        if abs(cx) >= MAP_HALF - 5 or abs(cz) >= MAP_HALF - 5:
            outside += 1
            continue
        cls = TYPE_CLS.get(str(b.get("bt", "")).lower(), 2 if b.get("n") else 0)
        if b.get("ht") or b.get("lv"):
            tagged += 1
        h = height_of(b, cls, area)
        if h > tallest[0]:
            tallest = (h, b.get("n") or "(unnamed)")
        ci = int((cx + MAP_HALF) // CHUNK)
        cj = int((cz + MAP_HALF) // CHUNK)
        chunks[(ci, cj)].append((cx, cz, w, d, rot, h, cls))
        kept += 1

    print(f"{kept} kept ({dropped_small} under {MIN_AREA:.0f} m2, {outside} off-map), "
          f"{tagged} with a tagged height ({tagged/max(1,kept)*100:.0f}%)")
    print(f"tallest: {tallest[1]} at {tallest[0]:.0f} m")

    blob = bytearray()
    dirs = []
    clamped = 0
    for cj in range(NZ):
        for ci in range(NX):
            dirs.append(len(blob))
            ox = -MAP_HALF + ci * CHUNK - MARGIN
            oz = -MAP_HALF + cj * CHUNK - MARGIN
            for cx, cz, w, d, rot, h, cls in chunks.get((ci, cj), ()):
                qx, qz = int(round((cx - ox) * 10)), int(round((cz - oz) * 10))
                if not (0 <= qx <= 65535 and 0 <= qz <= 65535):
                    clamped += 1
                    qx, qz = max(0, min(65535, qx)), max(0, min(65535, qz))
                r = int(round((rot % math.pi) * 256 / math.pi)) & 255
                blob += struct.pack(
                    "<HHHHHBB", qx, qz,
                    max(1, min(65535, int(round(w * 20)))),
                    max(1, min(65535, int(round(d * 20)))),
                    max(1, min(65535, int(round(h * 20)))), r, cls)
    dirs.append(len(blob))

    out = bytearray()
    out += struct.pack("<4sHHHH", b"AUTB", 1, NX, NZ, 0)
    out += struct.pack(f"<{len(dirs)}I", *dirs)
    out += blob
    p = os.path.join(OUT, "buildings.bin")
    with open(p, "wb") as f:
        f.write(out)
    import gzip
    gz = len(gzip.compress(bytes(out), 9))
    busiest = max((len(v), k) for k, v in chunks.items())
    print(f"buildings.bin  {len(out)/1e6:.2f} MB raw, {gz/1e6:.2f} MB gzipped "
          f"({REC} B/record)")
    print(f"busiest chunk {busiest[1]} holds {busiest[0]} buildings; {clamped} clamped")
    return clamped == 0


if __name__ == "__main__":
    sys.exit(0 if main() else 1)
