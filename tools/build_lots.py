"""Bake the lot layer -- parking, plazas, yards -- into apps/auto/data/lots.png.

    tools/.venv/bin/python tools/osm_extract.py --lots   # only after a new .pbf
    tools/.venv/bin/python tools/build_lots.py           # after build_raster.py

Reads tools/data/raw_lots.json (plus raw_green.json, raw_buildings.json and
surface.png's water channel, which the lots are clipped against).

Why this exists: the ground only knew "park" or "not park", so every block's
open ground -- the lot behind the supermarket, Occidental Square, a SoDo yard --
rendered as lawn beside the buildings. OSM has those surfaces; they were never
brought in.

Everything is painted at 3.33 m, then sampled onto a 1801^2 grid (14.4 m) as
two bytes per sample, R and G of an RGB PNG (B unused):

    G  the sample's code: 0 nothing, else 1 + k*50 + a -- kind k, orientation a
       (0..49 over 0..pi, 3.6 deg)
        k = 0 parking   asphalt, bay striping
            1 asphalt   plain tarmac: forecourts, loading yards, drive aisles
            2 plaza     paving
            3 hard      concrete hardstanding: commercial / retail land
            4 rail      ballast and track: rail yards
            5 sand      a beach (OSM natural=beach, from raw_green.json):
                        one code, 251, no orientation -- 1 + 5*50 + 49
                        would not fit the byte
    R  the share of the sample's own 14.4 m cell that has that code (box
       filter, 32 levels) -- what lets the edge be reconstructed between
       samples instead of snapped to them (see sample_coverage)

The orientation is the lot's own (its minimum-area rectangle's long side), so
striping and paving joints line up with the lot rather than with world axes.
geo.js reconstructs it (`lotCodeAt`) exactly as world.js's terrain shader does.
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
# AUTO_DATA_OUT writes somewhere else, to diff a change against the shipped data
# (surface.png is still read from the shipped data).
OUT_W = os.environ.get("AUTO_DATA_OUT") or OUT
MASK_STEP = 10
MASK_N = (MAP_HALF * 2) // MASK_STEP + 1   # 2601, surface.png
# Everything is PAINTED at 3.33 m (a third of the mask cell), so the edge the
# coverage is measured against is not the 10 m staircase that showed from the
# air, then SAMPLED onto the shipped grid below.
STEP = MASK_STEP / 3
N = (MASK_N - 1) * 3 + 1                   # 7801
# The shipped grid: 1801^2 samples, 14.4 m apart, two bytes each (coverage,
# code) -- 6.5 MB on the GPU against the 6.8 MB the 10 m code texture was.
LOT_N = 1801
LOT_STEP = MAP_HALF * 2 / (LOT_N - 1)
COVER_LEVELS = 32   # coverage is quantised: 0.45 m of edge position, and it compresses

KINDS = {"parking": 0, "asphalt": 1, "plaza": 2, "hard": 3, "rail": 4, "sand": 5}
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
    img = Image.new("L", (N, N), 0)
    d = ImageDraw.Draw(img)
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
        # The footprint plus a stroke round it: a ring of APRON_M metres.
        ring = 20.0 if a >= APRON_WIDE_M2 else 10.0
        px = to_px(p["o"])
        d.polygon(px, fill=c)
        d.line(px + [px[0]], fill=c, width=max(1, round(2 * ring / STEP)), joint="curve")
        n += 1
    g = np.asarray(img, dtype=np.uint8)
    print(f"aprons: {n} non-residential footprints, {(g > 0).sum() * STEP * STEP / 1e6:.1f} km2 incl. footprint")
    return g


# A downtown "park" is usually a paved square. Occidental Square, Westlake Park
# and Pioneer Square are all `leisure=park` with no surface tag, so the only
# thing that says they are hardscape is where they are: small, and ringed by
# commercial land. Those become plaza. A bigger park, or one in a residential
# street, stays lawn.
POCKET_MAX_M2 = 5500
POCKET_RING = int(round(60 / STEP))   # 60 m of surroundings looked at
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
    """-> (N, N) uint8 fine code raster, clipped against the water and park masks."""
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
    # BEACHES ARE SAND. OSM maps them (natural=beach) and the park mask took
    # them in with the grass, so Alki, Golden Gardens and Discovery Park's
    # beaches were lawn down to the water, with trees on them. Sand goes over
    # everything else here, and the water clip below still trims it.
    sand = Image.new("L", (N, N), 0)
    nb = 0
    # OSM draws a Puget Sound beach mostly SEAWARD of the coastline -- it is
    # the intertidal -- so Discovery Park's South Beach kept almost nothing on
    # land. Each beach also takes a 10 m band round its outline, which
    # reaches up to the drawn shore.
    # A small beach -- a lake's swim beach, a street end -- is a strip along
    # the waterline, and the lakes' drawn shores run up to a cell inland of it
    # (geo.js liftBeaches brings the ground back up), so it takes a 30 m band.
    ds = ImageDraw.Draw(sand)
    for p in json.load(open(os.path.join(DATA, "raw_green.json")))["green"]:
        a = area(p["o"])
        if p.get("k") != "beach" or a < 60:
            continue
        paint(sand, p, code("sand", 0.0))
        px = to_px(p["o"])
        band = max(1, round((60 if a < 3000 else 20) / STEP))
        ds.line(px + [px[0]], fill=code("sand", 0.0), width=band, joint="curve")
        nb += 1
    sand = np.asarray(sand, dtype=np.uint8)
    stats["beach"] = nb
    # Discovery Park's South Bluff is bare sand and clay, 50-70 m of it
    # falling to South Beach; the 40 m DEM sees it as slopes of 0.45-1.0 there.
    bluff = bluff_mask()
    sand = np.where(bluff & (sand == 0), code("sand", 0.0), sand).astype(np.uint8)
    stats["bluff"] = int(bluff.sum())
    out[wet] = 0
    # ...and NOT clipped by the water: the shore you see is where the 40 m
    # terrain rises through the water plane, and much of that band is on
    # cells the 10 m water mask calls wet -- clipped there, the waterline
    # stayed grass. Under the water the sand is simply not seen.
    out = np.where(sand > 0, sand, out)
    k = decode(out)
    land = ~wet
    print("lots: " + "  ".join(f"{g}={n}" for g, n in stats.items()))
    print(f"lot cells {int((out > 0).sum())} ({(out > 0)[land].mean() * 100:.1f}% of land): "
          + "  ".join(f"{name} {(k == i).sum() * STEP * STEP / 1e6:.2f} km2"
                      for name, i in KINDS.items()))
    return out


BLUFFS = [(-7000, -5500, -6000, -4700)]   # x0, z0, x1, z1: Discovery Park's South Bluff
BLUFF_SLOPE = 0.42


def bluff_mask():
    """Fine-grid mask of the exposed sea bluffs: steep DEM cells, above the
    tide and under 100 m, inside BLUFFS."""
    im = np.asarray(Image.open(os.path.join(OUT, "height.png")).convert("RGB")).astype(np.float64)
    h = (im[..., 0] * 256 + im[..., 1]) / 10 - 100
    hs = MAP_HALF * 2 / (h.shape[0] - 1)
    gz, gx = np.gradient(h, hs)
    ok = (np.hypot(gx, gz) > BLUFF_SLOPE) & (h > 1) & (h < 100)
    box = np.zeros_like(ok)
    for x0, z0, x1, z1 in BLUFFS:
        i0, i1 = int((x0 + MAP_HALF) / hs), int((x1 + MAP_HALF) / hs) + 1
        j0, j1 = int((z0 + MAP_HALF) / hs), int((z1 + MAP_HALF) / hs) + 1
        box[j0:j1, i0:i1] = True
    m = Image.fromarray(((ok & box) * 255).astype(np.uint8))
    # heightfield vertex i (pixel centre i + 0.5) is world i * hs - MAP_HALF;
    # fine pixel j's centre is (j + 0.5) * STEP - MAP_HALF
    f = hs / STEP
    b0, b1 = 0.5, 0.5 + N / f
    return np.asarray(m.resize((N, N), Image.BILINEAR, box=(b0, b0, b1, b1))) > 110


def fine_masks():
    """Water and park masks on the fine grid.

    Water comes from surface.png's red channel (the flood fill lives in
    build_raster.py), upsampled BILINEAR and re-thresholded so a lot's shoreline
    edge is a curve, not the 10 m staircase. Parks are re-rasterised from the
    polygons, the way build_raster.py draws them, at this resolution.
    """
    im = Image.open(os.path.join(OUT, "surface.png")).convert("RGB")
    if im.size[0] != MASK_N:
        sys.exit(f"surface.png is {im.size[0]} wide, expected {MASK_N}")
    r = im.getchannel(0)
    # pixel centres: mask cell i sits at fine pixel 3i, so scale by 3 about them
    # (PIL maps output pixel j's centre to box0 + (j + 0.5) * scale; mask cell
    # i's centre is at i + 0.5, and fine pixel j is mask position j / 3.)
    b0, b1 = 1 / 3, 1 / 3 + N / 3
    wet = np.asarray(r.resize((N, N), Image.BILINEAR, box=(b0, b0, b1, b1))) > 127
    gi = Image.new("L", (N, N), 0)
    dg = ImageDraw.Draw(gi)
    for poly in json.load(open(os.path.join(DATA, "raw_green.json")))["green"]:
        dg.polygon(to_px(poly["o"]), fill=255)
        for h in poly.get("h", []):
            dg.polygon(to_px(h), fill=0)
    green = (np.asarray(gi) > 0) & ~wet
    return wet, green


def sample_coverage(fine):
    """Fine code raster -> the shipped grid: (own-code coverage byte, code).

    Each sample carries its own code (the nearest fine pixel's) and the share of
    its own 14.4 m cell -- a box filter, exact to the sub-pixel -- that has that
    code. Away from an edge that is 255 everywhere, which is why this ships at
    under two thirds of the size a distance field did (694 KB: a distance is
    never saturated in a city where every point is within 20 m of some lot edge). The shader
    rebuilds, per candidate code, `sum(w * (tap has it ? a - 0.5 : 0.5 - a))`
    over its four neighbours: the half-contour of a bilinear box-filtered
    coverage is the classic anti-aliased edge reconstruction, a straight line
    where the polygon edge was straight, not a 10 m staircase.
    """
    g = np.arange(LOT_N) * (LOT_STEP / STEP)          # sample positions, fine px
    xs = g.astype(np.float64)
    xi = np.rint(xs).astype(np.int32)
    fx = xs - xi
    half = LOT_STEP / STEP / 2                        # box half-width, fine px
    K = int(math.ceil(half + 0.5))
    # per-axis overlap weights of pixel k with [f - half, f + half]
    W = [np.clip(np.minimum(k + 0.5, fx + half) - np.maximum(k - 0.5, fx - half), 0, 1)
         for k in range(-K, K + 1)]
    XI = np.clip(xi, 0, N - 1)
    c0 = fine[XI[:, None], XI[None, :]]
    acc = np.zeros(c0.shape, dtype=np.float32)
    for a, kz in enumerate(range(-K, K + 1)):
        rows = np.clip(xi + kz, 0, N - 1)
        wz = W[a].astype(np.float32)[:, None]
        for b, kx in enumerate(range(-K, K + 1)):
            cols = np.clip(xi + kx, 0, N - 1)
            wx = W[b].astype(np.float32)[None, :]
            acc += (fine[rows[:, None], cols[None, :]] == c0) * (wz * wx)
    acc /= (2 * half) ** 2
    q = np.rint(np.clip(acc, 0, 1) * (COVER_LEVELS - 1)) * (255 / (COVER_LEVELS - 1))
    return np.rint(q).astype(np.uint8), c0


def main():
    wet, green = fine_masks()
    fine = bake(wet, green)
    del wet, green
    cover, codes = sample_coverage(fine)
    img = np.zeros((LOT_N, LOT_N, 3), dtype=np.uint8)
    img[:, :, 0] = cover
    img[:, :, 1] = codes
    p = os.path.join(OUT_W, "lots.png")
    Image.fromarray(img, "RGB").save(p, optimize=True)
    print(f"lots.png {LOT_N}x{LOT_N} @ {LOT_STEP:.2f} m: {os.path.getsize(p) / 1e3:.0f} KB")


if __name__ == "__main__":
    main()
