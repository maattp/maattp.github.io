"""Bake the lot layer -- parking, plazas, yards -- into surface.png's blue channel.

    tools/.venv/bin/python tools/osm_extract.py --lots   # only after a new .pbf
    tools/.venv/bin/python tools/build_lots.py

Reads tools/data/raw_lots.json and rewrites ONLY the blue channel of
apps/auto/data/surface.png; red (water) and green (parks) are kept as they are
and are the masks the lots are clipped against. build_raster.py calls `bake()`
too, so a raster re-run keeps the lots instead of zeroing them.

Why this exists: the ground only knew "park" or "not park", so every block's
open ground -- the lot behind the supermarket, Occidental Square, a SoDo yard --
rendered as lawn beside the buildings. OSM has those surfaces; they were never
brought in.

The blue byte, one per 10 m cell (same grid as water/green):

    0            nothing: the terrain's own ground tint
    1 + k*50 + a surface kind k, orientation a (0..49 over 0..pi, 3.6 deg)
        k = 0 parking   asphalt, bay striping
            1 asphalt   plain tarmac: forecourts, loading yards, drive aisles
            2 plaza     paving
            3 hard      concrete hardstanding: commercial / retail land
            4 rail      ballast and track: rail yards

The orientation is the lot's own (its minimum-area rectangle's long side), so
striping and paving joints line up with the lot rather than with world axes.
geo.js decodes it (`lotAt`), world.js's terrain shader draws it.
"""

import json
import math
import os
import sys

import numpy as np
from PIL import Image, ImageDraw

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from proj import MAP_HALF  # noqa: E402

HERE = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.join(HERE, "data")
OUT = os.path.join(HERE, "..", "apps", "auto", "data")
STEP = 10
N = (MAP_HALF * 2) // STEP + 1          # 2601, matches surface.png

KINDS = {"parking": 0, "asphalt": 1, "plaza": 2, "hard": 3, "rail": 4}
ANG = 50   # geo.js LOT_ANG
# Drawn in this order, so later kinds win where polygons overlap: a car park
# mapped inside a retail landuse is a car park, a plaza inside a commercial
# block is a plaza.
ORDER = ["hard", "rail", "asphalt_landuse", "aisle", "asphalt", "courts", "plaza", "parking"]
# Only these may pave over the park mask. A park's own car park is real tarmac,
# and so is a court or a square mapped as a park with a paved `surface`; a
# `landuse=commercial` polygon drawn loosely over a green is not.
OVER_GREEN = {"parking", "plaza", "courts"}
# ...but a paved-surface tag only counts on something square-sized, so a whole
# park carrying a stray `surface=paved` cannot turn to stone.
SURFACE_MAX_M2 = 30000
PAVED_SURFACE = {"asphalt", "concrete", "paving_stones", "paved", "sett", "bricks",
                 "concrete:plates", "brick", "stone"}
AISLE_W = 6.0   # metres; a two-way aisle
# Outlines that carry a lot tag but are planted (osm_extract.py filters these
# too; kept here so an older raw_lots.json bakes the same).
SKIP_LU = {"grass", "flowerbed", "traffic_island", "meadow", "village_green",
           "recreation_ground", "forest", "cemetery"}


def code(kind, ang):
    a = int(round((ang % math.pi) / math.pi * ANG)) % ANG
    return 1 + KINDS[kind] * ANG + a


def decode(c):
    c = np.asarray(c, dtype=np.int32)
    k = np.where(c > 0, (c - 1) // ANG, -1)
    return k


def orientation(pts):
    """Angle (0..pi) of the long side of the polygon's minimum-area rectangle.

    Rotating calipers over the convex hull, so no shapely dependency.
    """
    p = np.asarray(pts, dtype=np.float64)
    if len(p) < 3:
        return 0.0
    hull = convex_hull(p)
    best = None
    for i in range(len(hull)):
        a, b = hull[i], hull[(i + 1) % len(hull)]
        dx, dz = b - a
        L = math.hypot(dx, dz)
        if L < 1e-6:
            continue
        ux, uz = dx / L, dz / L
        u = hull @ np.array([ux, uz])
        v = hull @ np.array([-uz, ux])
        w, h = u.max() - u.min(), v.max() - v.min()
        area = w * h
        if best is None or area < best[0]:
            ang = math.atan2(uz, ux) if w >= h else math.atan2(ux, -uz)
            best = (area, ang)
    return (best[1] if best else 0.0) % math.pi


def convex_hull(p):
    pts = sorted(set(map(tuple, p)))
    if len(pts) < 3:
        return np.asarray(pts)

    def cross(o, a, b):
        return (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])
    lo, up = [], []
    for q in pts:
        while len(lo) >= 2 and cross(lo[-2], lo[-1], q) <= 0:
            lo.pop()
        lo.append(q)
    for q in reversed(pts):
        while len(up) >= 2 and cross(up[-2], up[-1], q) <= 0:
            up.pop()
        up.append(q)
    return np.asarray(lo[:-1] + up[:-1])


def to_px(pts):
    return [((x + MAP_HALF) / STEP, (z + MAP_HALF) / STEP) for x, z in pts]


def area(pts):
    s = 0.0
    for i in range(len(pts)):
        x0, z0 = pts[i]
        x1, z1 = pts[(i + 1) % len(pts)]
        s += x0 * z1 - x1 * z0
    return abs(s) / 2


def paint(img, p, c):
    """Fill one lot polygon, holes and all, over whatever is already drawn.

    A hole is whatever else is mapped there -- usually a building, sometimes a
    planted island -- so it must leave the layer UNDER this lot showing, not
    punch through to nothing. Hence a mask in the polygon's own bounding box
    rather than a fill of 0.
    """
    px = to_px(p["o"])
    xs, zs = [q[0] for q in px], [q[1] for q in px]
    x0, z0 = max(0, int(min(xs)) - 1), max(0, int(min(zs)) - 1)
    x1, z1 = min(N, int(max(xs)) + 2), min(N, int(max(zs)) + 2)
    if x1 <= x0 or z1 <= z0:
        return
    m = Image.new("L", (x1 - x0, z1 - z0), 0)
    dm = ImageDraw.Draw(m)
    dm.polygon([(x - x0, z - z0) for x, z in px], fill=255)
    for h in p.get("h", []):
        dm.polygon([(x - x0, z - z0) for x, z in to_px(h)], fill=0)
    img.paste(c, (x0, z0, x1, z1), m)


# Hardstanding round a non-residential building. Most of the city's paved
# ground is mapped as NOTHING -- no landuse, no car park, just the space between
# a warehouse and its street -- so where OSM has no polygon, the building's
# own type is the best evidence there is: a warehouse stands in a yard, an
# office block on a plaza, a house on a lawn. One ring of cells (~10 m) round
# the footprint, two for a big shed; lowest priority, and clipped by the park
# mask like everything else.
APRON_YARD = {"industrial", "warehouse", "hangar", "service", "transportation",
              "storage_tank", "manufacture", "depot"}
APRON_HARD = {"retail", "commercial", "office", "hotel", "hospital", "civic",
              "government", "public", "data_center", "parking", "fire_station",
              "school", "college", "university", "stadium", "construction",
              "supermarket", "train_station"}
APRON_YES_M2 = 1000     # an untyped `building=yes` this big is not a house
APRON_WIDE_M2 = 5000    # ...and this big gets a two-cell yard


def aprons():
    raw = json.load(open(os.path.join(DATA, "raw_buildings.json")))["buildings"]
    one = Image.new("L", (N, N), 0)
    two = Image.new("L", (N, N), 0)
    n = 0
    for p in raw:
        bt = p.get("bt", "yes")
        a = area(p["o"])
        if bt in APRON_YARD:
            kind = "asphalt"
        elif bt in APRON_HARD or (bt == "yes" and a >= APRON_YES_M2):
            kind = "hard"
        else:
            continue
        c = code(kind, 0.0 if kind == "asphalt" else orientation(p["o"]))
        paint(two if a >= APRON_WIDE_M2 else one, {"o": p["o"]}, c)
        n += 1

    def grow(a, r):
        # max filter over a (2r+1)^2 window: codes spread into the ring
        out = a.copy()
        for dz in range(-r, r + 1):
            for dx in range(-r, r + 1):
                if dx or dz:
                    out = np.maximum(out, np.roll(np.roll(a, dz, 0), dx, 1))
        return out
    g = np.maximum(grow(np.asarray(one, dtype=np.uint8), 1), grow(np.asarray(two, dtype=np.uint8), 2))
    print(f"aprons: {n} non-residential footprints, {(g > 0).sum() * STEP * STEP / 1e6:.1f} km2 incl. footprint")
    return g


# A downtown "park" is usually a paved square. Occidental Square, Westlake Park
# and Pioneer Square are all `leisure=park` with no surface tag, so the only
# thing that says they are hardscape is where they are: small, and ringed by
# commercial land. Those become plaza. A bigger park, or one in a residential
# street, stays lawn.
POCKET_MAX_M2 = 5500
POCKET_RING = 6          # cells (60 m) of surroundings looked at
POCKET_DEVELOPED = 0.33  # share of that ring already commercial / lot (streets count as not)


def pocket_squares(base):
    green = json.load(open(os.path.join(DATA, "raw_green.json")))["green"]
    out = Image.new("L", (N, N), 0)
    n = 0
    for p in green:
        if p.get("k") not in ("park", "garden") or area(p["o"]) > POCKET_MAX_M2 or p.get("h"):
            continue
        px = to_px(p["o"])
        xs, zs = [q[0] for q in px], [q[1] for q in px]
        x0, z0 = int(min(xs)) - POCKET_RING, int(min(zs)) - POCKET_RING
        x1, z1 = int(max(xs)) + POCKET_RING + 2, int(max(zs)) + POCKET_RING + 2
        if x0 < 0 or z0 < 0 or x1 > N or z1 > N:
            continue
        m = Image.new("L", (x1 - x0, z1 - z0), 0)
        ImageDraw.Draw(m).polygon([(x - x0, z - z0) for x, z in px], fill=255)
        inside = np.asarray(m) > 0
        if not inside.any():
            continue
        ring = ~inside
        sub = base[z0:z1, x0:x1]
        dev = (sub[ring] > 0).mean()
        if dev < POCKET_DEVELOPED:
            continue
        out.paste(code("plaza", orientation(p["o"])), (x0, z0, x1, z1), m)
        n += 1
    print(f"pocket squares: {n} small parks in developed land paved as plaza")
    return np.asarray(out, dtype=np.uint8)


def bake(wet, green):
    """-> (N, N) uint8 blue channel, clipped against the water and park masks."""
    raw = json.load(open(os.path.join(DATA, "raw_lots.json")))
    lots, aisles = raw["lots"], raw["aisles"]
    groups = {g: [] for g in ORDER}
    for p in lots:
        k = p["k"]
        if p.get("lu") in SKIP_LU:
            continue
        if k == "hard" and p.get("lu") == "railway":
            k = "rail"   # an older raw_lots.json called rail land `hard`
        if k == "asphalt" and p.get("lu"):
            groups["asphalt_landuse"].append(p)
        elif k == "asphalt" and p.get("sf") in PAVED_SURFACE and p.get("le"):
            if area(p["o"]) <= SURFACE_MAX_M2:
                groups["courts"].append(p)
        elif k == "plaza" and p.get("le") and area(p["o"]) > SURFACE_MAX_M2:
            continue
        else:
            groups[k].append(p)

    img = Image.new("L", (N, N), 0)
    # What may pave over a park goes in its own layer, so the green clip can be
    # applied to everything else alone.
    stats = {}
    layer_over = Image.new("L", (N, N), 0)
    for g in ORDER:
        kind = "asphalt" if g in ("asphalt_landuse", "aisle", "courts") else g
        dst = layer_over if g in OVER_GREEN else None
        n = 0
        if g == "aisle":
            # Aisles go in their own layer and survive only where it makes
            # sense. A `parking_aisle` is the drive lane of a car park, mapped or
            # not, so it stands anywhere off the park mask. A bare `service` way
            # is as often a private drive through a housing estate as a loading
            # road, and painted 10 m wide it laid tarmac ribbons across the
            # suburbs -- so it only counts on land already developed.
            la = Image.new("L", (N, N), 0)
            ls = Image.new("L", (N, N), 0)
            da, ds = ImageDraw.Draw(la), ImageDraw.Draw(ls)
            wpx = max(1, round(AISLE_W / STEP))
            ac = code("asphalt", 0.0)
            for a in aisles:
                (da if a["s"] == "parking_aisle" else ds).line(to_px(a["p"]), fill=ac, width=wpx)
                n += 1
            aisle_any = np.asarray(la, dtype=np.uint8)
            aisle_dev = np.asarray(ls, dtype=np.uint8)
            cur = np.asarray(img, dtype=np.uint8)
            merged = np.where(aisle_any > 0, aisle_any,
                              np.where((aisle_dev > 0) & (cur > 0), aisle_dev, cur))
            img = Image.fromarray(merged.astype(np.uint8), "L")
        else:
            for p in groups[g]:
                if area(p["o"]) < 60:
                    continue
                # Plain tarmac has no direction anyone can see, and a constant
                # byte compresses: only striped and jointed kinds carry one.
                c = code(kind, 0.0 if kind == "asphalt" else orientation(p["o"]))
                paint(dst if dst is not None else img, p, c)
                n += 1
        stats[g] = n

    base = np.asarray(img, dtype=np.uint8).copy()
    # The pocket-square test is tuned against MAPPED lots only; aprons are an
    # inference and would talk it into paving residential parks.
    squares = pocket_squares(base)
    base = np.where(base > 0, base, aprons())
    base[green] = 0
    over = np.asarray(layer_over, dtype=np.uint8)
    out = np.where(over > 0, over, np.where(squares > 0, squares, base))
    out[wet] = 0
    k = decode(out)
    land = ~wet
    print("lots: " + "  ".join(f"{g}={n}" for g, n in stats.items()))
    print(f"lot cells {int((out > 0).sum())} ({(out > 0)[land].mean() * 100:.1f}% of land): "
          + "  ".join(f"{name} {(k == i).sum() * STEP * STEP / 1e6:.2f} km2"
                      for name, i in KINDS.items()))
    return out


def main():
    p = os.path.join(OUT, "surface.png")
    im = np.asarray(Image.open(p).convert("RGB")).copy()
    if im.shape[0] != N:
        sys.exit(f"surface.png is {im.shape[0]} wide, expected {N}")
    wet, green = im[:, :, 0] > 127, im[:, :, 1] > 127
    before = os.path.getsize(p)
    im[:, :, 2] = bake(wet, green)
    Image.fromarray(im, "RGB").save(p, optimize=True)
    print(f"surface.png {before / 1e3:.0f} KB -> {os.path.getsize(p) / 1e3:.0f} KB")


if __name__ == "__main__":
    main()
