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
      u8  cls | roof << 3 | mat << 5      (Auto KW: the LOOK, see look_of)

The class byte's low 3 bits are the class (CLS below, + 5: an untagged box
too big for a house that no zone explains); bits 3-4 the roof OSM maps (0 not
mapped, 1 flat, 2 gabled, 3 hipped) and bits 5-7 the wall (0 not mapped,
1 red brick, 2 buff brick, 3 grey stone/block, 4 siding/wood, 5 concrete/
stucco, 6 metal cladding, 7 glass). citygen.js unpacks them into bd.look.
"""

import json
import math
import re
import os
import struct
import sys
from collections import defaultdict

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from proj import MAP_HALF  # noqa: E402

HERE = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.join(HERE, "data")
OUT = os.environ.get("AUTO_DATA_OUT") or os.path.join(HERE, "..", "..", "apps", "autokw", "data")

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
CLS_STOREY_H = {0: 3.1, 1: 3.1, 2: 3.9, 3: 5.2, 4: 4.4, 5: 3.1, 6: 3.4, 7: 4.4}
# farm buildings: barns, drive sheds and greenhouses are not houses
FARM_BT = {"barn", "farm_auxiliary", "greenhouse", "cowshed", "stable", "silo", "sty", "farm"}
# PARK BUILDINGS ARE LOW. OSM's beach bathhouses are bare building=yes with a
# name, which made them commercial at 11 m: Golden Gardens' 1929 bathhouse, the
# Green Lake Bath House and Madison's stood four storeys over the sand. An
# untagged building named like a park structure is one storey; so is an
# untagged small commercial/apartment-class box standing in a mapped park.
PARK_LOW_NAME = re.compile(r"bath ?house|comfort station|restroom|toilet|shelter|pavilion|"
                           r"field ?house|boat ?house|concession|picnic", re.I)
PARK_LOW_H = 5.0
PARK_SMALL_M2 = 1500
PARK_KINDS = {"park", "garden", "recreation_ground", "nature_reserve", "beach", "golf_course"}
CLS_DEFAULT_H = {0: 6.4, 1: 12.5, 2: 11.0, 3: 8.5, 4: 10.0, 5: 6.4, 6: 9.0, 7: 10.0}


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
    # Waterloo Region is suburban: an untagged store is a one-storey plaza
    # unit or a big box, not an 11 m block, and an office park is two or three.
    bt = str(b.get("bt", "")).lower()
    if bt in ("retail", "supermarket", "commercial", "shop", "kiosk"):
        return 6.0
    if bt == "office":
        return 10.0
    if bt in ("school", "church", "civic", "public"):
        return 8.0
    if cls == 2:
        return 6.5
    return CLS_DEFAULT_H[cls]


# --- Auto KW: the look -------------------------------------------------------
# An untagged box too big to be a house, in no zone: the game decides by size
# (citygen.js styleFor), as it always did.
CLS_UNKNOWN = 5
ZONE_CODE = {"residential": 1, "commercial": 2, "retail": 2, "industrial": 3}
# A building=yes in a residential zone is a house up to this footprint: KW's
# two-storey houses with a double garage are 200-400 m2 of roof.
HOUSE_MAX_M2 = 460
ROOF_CODE = {"flat": 1, "gabled": 2, "gambrel": 2, "saltbox": 2, "double_saltbox": 2,
             "quadruple_saltbox": 2, "crosspitched": 2, "half-hipped": 3, "hipped": 3,
             "pyramidal": 3, "hipped-and-gabled": 3, "mansard": 3}
MAT_CODE = {"brick": 1, "stone": 3, "limestone": 3, "sandstone": 3, "granite": 3,
            "concrete": 5, "stucco": 5, "plaster": 5, "cement_block": 3,
            "wood": 4, "timber_framing": 4, "siding": 4, "vinyl": 4, "plastic": 4,
            "metal": 6, "metal_plates": 6, "steel": 6, "glass": 7, "mirror": 7}
# building:colour, when the material says nothing finer (or nothing)
COL_CODE = {"red": 1, "brown": 1, "darkred": 1, "maroon": 1, "#ae9183": 1,
            "beige": 2, "yellow": 2, "tan": 2, "#ffffcc": 2, "#c3b091": 2, "#f4a460": 2, "cream": 2,
            "grey": 3, "gray": 3, "darkgrey": 3, "darkgray": 3,
            "white": 5, "lightgrey": 5, "lightgray": 5, "silver": 6}


def look_of(t):
    """(roof, mat) codes from a raw_looks.json entry."""
    if not t:
        return 0, 0
    roof = ROOF_CODE.get(str(t.get("rs", "")).lower(), 0)
    mat = MAT_CODE.get(str(t.get("mat", "")).lower(), 0)
    col = COL_CODE.get(str(t.get("col", "")).split(",")[0].strip().lower(), 0)
    # brick in a buff or grey colour is buff or grey brick
    if mat == 1 and col in (2, 3):
        mat = col
    elif not mat:
        mat = col
    return roof, mat


def zone_mask():
    """10 m raster of OSM's landuse zones (raw_looks.json): ZONE_CODE values;
    the biggest drawn first, so a retail parcel inside a residential area wins."""
    from PIL import Image, ImageDraw
    n = int(MAP_HALF * 2 / 10) + 1
    img = Image.new("L", (n, n), 0)
    p = os.path.join(DATA, "raw_looks.json")
    if not os.path.exists(p):
        print("  (no raw_looks.json: run extract_looks.py -- untagged buildings keep the old rule)")
        return img, n, {}
    L = json.load(open(p))
    d = ImageDraw.Draw(img)
    for z in sorted(L["zones"], key=lambda q: -poly_area(q["o"])):
        d.polygon([((x + MAP_HALF) / 10, (zz + MAP_HALF) / 10) for x, zz in z["o"]], fill=ZONE_CODE[z["k"]])
    return img, n, L["tags"]


def park_mask():
    """10 m raster of the mapped parks (raw_green.json), for park_low."""
    from PIL import Image, ImageDraw
    n = int(MAP_HALF * 2 / 10) + 1
    img = Image.new("L", (n, n), 0)
    d = ImageDraw.Draw(img)
    for p in json.load(open(os.path.join(DATA, "raw_green.json")))["green"]:
        if p.get("k") not in PARK_KINDS:
            continue
        d.polygon([((x + MAP_HALF) / 10, (z + MAP_HALF) / 10) for x, z in p["o"]], fill=1)
        for hole in p.get("h", []):
            d.polygon([((x + MAP_HALF) / 10, (z + MAP_HALF) / 10) for x, z in hole], fill=0)
    return img, n


# --- Auto KW: farmsteads and churches ------------------------------------------
# cls 6 is a FARM building, and for it bits 3-4 are not a roof but which one
# (citygen.js styleFor -> farmstead.js): 0 a barn, 1 an outbuilding (drive
# shed, implement shed, coverall, chicken house), 2 a silo, 3 the farmhouse.
# cls 7 is a church (a Christian place of worship: the steeple; mosques and
# temples stay civic). Before this every barn was cls 3, "industrial" --
# tilt-up panels and rooftop units in the middle of a Woolwich cornfield --
# and every untagged barn under 460 m2 a suburban house with a garage door.
CLS_FARM, CLS_CHURCH = 6, 7
F_BARN, F_SHED, F_SILO, F_HOUSE = 0, 1, 2, 3
FARM_TAGGED = {"barn", "farm_auxiliary", "cowshed", "stable", "sty", "silo"}
FARM_HOUSE_BT = {"farm", "house", "detached"}
FARM_UNTAGGED = {"", "yes", "shed"}
RURAL_R, RURAL_MAX = 150.0, 12   # a farmstead has a handful of buildings within 150 m; a village dozens
FARMHOUSE_BARN_R = 170.0


def farmyard_mask():
    """10 m raster of OSM's landuse=farmyard (raw_farms.json)."""
    from PIL import Image, ImageDraw
    n = int(MAP_HALF * 2 / 10) + 1
    img = Image.new("L", (n, n), 0)
    d = ImageDraw.Draw(img)
    p = os.path.join(DATA, "raw_farms.json")
    if os.path.exists(p):
        for f in json.load(open(p))["farms"]:
            if f["k"] == "farmyard":
                d.polygon([((x + MAP_HALF) / 10, (z + MAP_HALF) / 10) for x, z in f["o"]], fill=1)
    return img, n


def in_ring(p, x, z):
    c = False
    j = len(p) - 1
    for i in range(len(p)):
        if (p[i][1] > z) != (p[j][1] > z) and x < (p[j][0] - p[i][0]) * (z - p[i][1]) / (p[j][1] - p[i][1]) + p[i][0]:
            c = not c
        j = i
    return c


def farm_kinds(raw, zones, zn):
    """{raw index: F_*} for every footprint that is part of a farmstead.

    A farm building is one OSM tags as one (barn, farm_auxiliary, silo...),
    or an untagged one standing in a farmyard, or in open country: outside
    every landuse zone with at most RURAL_MAX buildings within 150 m. Its
    kind is from its shape: round is a silo, long is a shed, big a barn; a
    house-sized one is the FARMHOUSE only if a barn stands within 170 m."""
    fy, fn = farmyard_mask()
    info, grid = [None] * len(raw), defaultdict(list)
    for i, b in enumerate(raw):
        ring = b["o"][:-1] if len(b["o"]) > 1 and b["o"][0] == b["o"][-1] else b["o"]
        if len(ring) < 3:
            continue
        cx = sum(q[0] for q in ring) / len(ring)
        cz = sum(q[1] for q in ring) / len(ring)
        A = poly_area(ring)
        per = sum(math.hypot(ring[k][0] - ring[k - 1][0], ring[k][1] - ring[k - 1][1]) for k in range(len(ring)))
        info[i] = (cx, cz, A, per, len(ring))
        grid[(int(cx // RURAL_R), int(cz // RURAL_R))].append(i)

    def near(cx, cz, r, pick=None):
        n, gi, gj = 0, int(cx // RURAL_R), int(cz // RURAL_R)
        k = int(math.ceil(r / RURAL_R))
        for a in range(gi - k, gi + k + 1):
            for c in range(gj - k, gj + k + 1):
                for j in grid.get((a, c), ()):
                    q = info[j]
                    if math.hypot(q[0] - cx, q[1] - cz) < r and (pick is None or pick(j)):
                        n += 1
        return n

    def px(m, mn, x, z):
        i, j = int((x + MAP_HALF) / 10), int((z + MAP_HALF) / 10)
        return m.getpixel((i, j)) if 0 <= i < mn and 0 <= j < mn else 0

    kinds = {}
    for i, b in enumerate(raw):
        if info[i] is None or b.get("n"):
            continue
        bt = str(b.get("bt", "")).lower()
        if bt not in FARM_TAGGED and bt not in FARM_HOUSE_BT and bt not in FARM_UNTAGGED:
            continue
        cx, cz, A, per, npts = info[i]
        if A < MIN_AREA:
            continue
        yard = px(fy, fn, cx, cz)
        if bt not in FARM_TAGGED and not yard:
            if px(zones, zn, cx, cz) or near(cx, cz, RURAL_R) > RURAL_MAX:
                continue
        _, _, w, d, _ = min_area_rect([tuple(q) for q in b["o"]])
        L, S = max(w, d), max(1.0, min(w, d))
        rnd = 4 * math.pi * A / max(1.0, per * per)
        if bt == "silo" or (rnd > 0.85 and npts >= 7 and A < 260):
            kinds[i] = F_SILO
        elif bt in FARM_TAGGED:
            kinds[i] = F_BARN if A >= 200 and L / S < 3.2 else F_SHED
        elif bt in FARM_HOUSE_BT:
            kinds[i] = F_HOUSE
        elif A >= 330 and L / S < 3.4:
            kinds[i] = F_BARN
        elif A < 75 or bt == "shed" or L / S >= 2.4:
            kinds[i] = F_SHED
        else:
            kinds[i] = F_HOUSE
    # One or two BARNS a farmstead: the biggest, and any other within 55 % of
    # it; the rest of what OSM calls farm_auxiliary is drive sheds, implement
    # sheds and coveralls (a Woolwich farm is one barn and three sheds).
    for i in [i for i, k in kinds.items() if k == F_BARN]:
        A = info[i][2]
        top = [0.0]

        def bigger(j, top=top):
            if kinds.get(j) == F_BARN and info[j][2] > top[0]:
                top[0] = info[j][2]
            return False
        near(info[i][0], info[i][1], 120.0, bigger)
        if A < 350 or A < 0.55 * top[0]:
            kinds[i] = F_SHED
    # a house is a farmhouse only with a barn (or a silo) near it
    big = lambda j: kinds.get(j) in (F_BARN, F_SILO)  # noqa: E731
    for i in [i for i, k in kinds.items() if k == F_HOUSE]:
        if not near(info[i][0], info[i][1], FARMHOUSE_BARN_R, big):
            del kinds[i]
    return kinds, info


def silo_nodes(raw_info):
    """man_made=silo nodes no footprint already covers: (x, z) each."""
    p = os.path.join(DATA, "raw_rural.json")
    if not os.path.exists(p):
        return []
    out = []
    pts = json.load(open(p))["silos"]
    cents = defaultdict(list)
    for q in raw_info:
        if q:
            cents[(int(q[0] // 50), int(q[1] // 50))].append(q)
    for x, z in pts:
        hit = False
        for a in range(int(x // 50) - 1, int(x // 50) + 2):
            for c in range(int(z // 50) - 1, int(z // 50) + 2):
                for q in cents.get((a, c), ()):
                    if math.hypot(q[0] - x, q[1] - z) < max(5.0, math.sqrt(q[2] / math.pi) + 1.5):
                        hit = True
        if not hit and all(math.hypot(x - o[0], z - o[1]) > 5 for o in out):
            out.append((x, z))
    return out


def barn_silos(raw, fkinds, rinfo):
    """Silos at the end of the bank barns OSM maps none beside: (x, z, r) each.

    Most of the region's silos are not mapped (163 points and 28 footprints
    for ~1,000 barns), and a dairy barn without one does not read as a farm.
    Two in five barns of 350-1500 m2 get one (a few two) off a gable end,
    where no other footprint or road is -- a judgement, like the hydro."""
    roads = json.load(open(os.path.join(DATA, "raw_roads.json")))["roads"]
    rg = defaultdict(list)
    for r in roads:
        if r.get("cls") in ("footway", "path", "cycleway", "steps", "track", "bridleway"):
            continue
        p = r["p"]
        for k in range(len(p) - 1):
            a, c = p[k], p[k + 1]
            for gx in range(int(min(a[0], c[0]) // 100), int(max(a[0], c[0]) // 100) + 1):
                for gz in range(int(min(a[1], c[1]) // 100), int(max(a[1], c[1]) // 100) + 1):
                    rg[(gx, gz)].append((a, c))

    def road_d(x, z):
        best = 1e9
        for a, c in rg.get((int(x // 100), int(z // 100)), ()):
            dx, dz = c[0] - a[0], c[1] - a[1]
            L2 = dx * dx + dz * dz or 1.0
            t = max(0.0, min(1.0, ((x - a[0]) * dx + (z - a[1]) * dz) / L2))
            best = min(best, math.hypot(x - a[0] - dx * t, z - a[1] - dz * t))
        return best
    cents = defaultdict(list)
    for q in rinfo:
        if q:
            cents[(int(q[0] // 60), int(q[1] // 60))].append(q)
    silo_near = set()
    for i, k in fkinds.items():
        if k == F_SILO:
            silo_near.add((int(rinfo[i][0] // 120), int(rinfo[i][1] // 120)))
    out = []
    for i, k in fkinds.items():
        if k != F_BARN:
            continue
        cx0, cz0, A, _, _ = rinfo[i]
        if not 350 <= A <= 1500:
            continue
        h = (math.sin(cx0 * 12.9898 + cz0 * 78.233) * 43758.5453) % 1.0
        if h > 0.4:
            continue
        gi, gj = int(cx0 // 120), int(cz0 // 120)
        if any((gi + a, gj + c) in silo_near for a in (-1, 0, 1) for c in (-1, 0, 1)):
            continue
        cx, cz, w, d, rot = min_area_rect([tuple(q) for q in raw[i]["o"]])
        ux, uz = (math.sin(rot), math.cos(rot)) if w >= d else (math.cos(rot), -math.sin(rot))
        L, S = max(w, d), min(w, d)
        vx, vz = -uz, ux
        n = 2 if h < 0.1 else 1
        r = 2.6 + (h * 37.0 % 1.0) * 0.6
        for e in ((1, -1) if h * 7 % 1.0 < 0.5 else (-1, 1)):
            put = []
            for k2 in range(n):
                lat = (S / 2 - r - 0.4) * (1 if k2 == 0 else -1) * (1 if h * 11 % 1.0 < 0.5 else -1)
                x = cx + ux * e * (L / 2 + r + 0.6) + vx * lat
                z = cz + uz * e * (L / 2 + r + 0.6) + vz * lat
                if road_d(x, z) < r + 9:
                    break
                ok = True
                for a in (-1, 0, 1):
                    for c in (-1, 0, 1):
                        for q in cents.get((int(x // 60) + a, int(z // 60) + c), ()):
                            if q[0] == cx0 and q[1] == cz0:
                                continue
                            if math.hypot(q[0] - x, q[1] - z) < math.sqrt(q[2]) * 0.62 + r + 1.0:
                                ok = False
                if not ok:
                    break
                put.append((x, z, r))
            if put:
                out += put
                break
    return out


def worship_tags():
    p = os.path.join(DATA, "raw_rural.json")
    if not os.path.exists(p):
        print("  (no raw_rural.json: run extract_rural.py -- no farms' silos or churches)")
        return {}, []
    R = json.load(open(p))
    return R["worship"], R["pow_nodes"]


def main():
    raw = json.load(open(os.path.join(DATA, "raw_buildings.json")))["buildings"]
    print(f"{len(raw)} raw footprints")
    parks, pn = park_mask()
    zones, zn, looks = zone_mask()
    fkinds, rinfo = farm_kinds(raw, zones, zn)
    worship, pow_nodes = worship_tags()
    print("farm buildings:", {n: sum(1 for v in fkinds.values() if v == k)
                              for n, k in (("barn", F_BARN), ("shed", F_SHED), ("silo", F_SILO), ("house", F_HOUSE))})
    churches = 0
    zoned = {}
    low_named = low_park = 0

    chunks = defaultdict(list)
    kept = tagged = dropped_small = outside = 0
    tallest = (0.0, "")
    pow_in = set()
    for q in pow_nodes:
        for i, inf in enumerate(rinfo):
            if inf and abs(inf[0] - q["x"]) < 60 and abs(inf[1] - q["z"]) < 60 and in_ring(raw[i]["o"], q["x"], q["z"]):
                pow_in.add(i)
    for bi, b in enumerate(raw):
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
        bt = str(b.get("bt", "")).lower()
        cls = TYPE_CLS.get(bt, 2 if b.get("n") else 0)
        flat_apt = False
        if not bt and not b.get("n"):
            # Auto KW: a bare building=yes is what its landuse zone says
            zi, zj = int((cx + MAP_HALF) / 10), int((cz + MAP_HALF) / 10)
            zc = zones.getpixel((zi, zj)) if 0 <= zi < zn and 0 <= zj < zn else 0
            if zc == 1:
                # a house; a long one a row of townhouses; else a walk-up
                if area <= HOUSE_MAX_M2 or (max(w, d) / max(1.0, min(w, d)) >= 2.2 and area <= 1600):
                    cls = 0
                else:
                    cls, flat_apt = 1, True
            elif zc in (2, 3):
                cls = zc
            elif area > HOUSE_MAX_M2:
                cls = CLS_UNKNOWN
            zoned[(zc, cls)] = zoned.get((zc, cls), 0) + 1
        elif bt in FARM_BT:
            cls = 3
        key = f"{b['o'][0][0]},{b['o'][0][1]}"
        church = (key in worship or bi in pow_in) and area >= 90
        if church:
            cls = CLS_CHURCH
            churches += 1
        if b.get("ht") or b.get("lv"):
            tagged += 1
        h = height_of(b, cls, area)
        if flat_apt and not (b.get("ht") or b.get("lv")):
            h = 9.5   # three storeys: a walk-up, a seniors' home, a co-op
        roof, mat = look_of(looks.get(key))
        if bi in fkinds and not church:
            # bits 3-4 are WHICH farm building (see CLS_FARM); the height is citygen's
            cls, roof = CLS_FARM, fkinds[bi]
        cls |= roof << 3 | mat << 5
        if not (b.get("ht") or b.get("lv")):
            i, j = int((cx + MAP_HALF) / 10), int((cz + MAP_HALF) / 10)
            in_park = 0 <= i < pn and 0 <= j < pn and parks.getpixel((i, j))
            if b.get("n") and PARK_LOW_NAME.search(b["n"]):
                h = min(h, PARK_LOW_H)
                low_named += 1
            elif in_park and cls in (1, 2) and area < PARK_SMALL_M2:
                h = min(h, PARK_LOW_H + 0.5)
                low_park += 1
        if h > tallest[0]:
            tallest = (h, b.get("n") or "(unnamed)")
        ci = int((cx + MAP_HALF) // CHUNK)
        cj = int((cz + MAP_HALF) // CHUNK)
        chunks[(ci, cj)].append((cx, cz, w, d, rot, h, cls))
        kept += 1
    # silos OSM maps as a point stand up as round 6 m footprints
    sn = 0
    for x, z in silo_nodes(rinfo):
        if abs(x) >= MAP_HALF - 5 or abs(z) >= MAP_HALF - 5:
            continue
        chunks[(int((x + MAP_HALF) // CHUNK), int((z + MAP_HALF) // CHUNK))].append(
            (x, z, 6.0, 6.0, 0.0, 20.0, CLS_FARM | F_SILO << 3))
        sn += 1
    bs = 0
    for x, z, r in barn_silos(raw, fkinds, rinfo):
        if abs(x) >= MAP_HALF - 5 or abs(z) >= MAP_HALF - 5:
            continue
        chunks[(int((x + MAP_HALF) // CHUNK), int((z + MAP_HALF) // CHUNK))].append(
            (x, z, 2 * r, 2 * r, 0.0, 20.0, CLS_FARM | F_SILO << 3))
        bs += 1
    print(f"{churches} churches; {sn} silos from OSM points, {bs} beside barns")

    print(f"{kept} kept ({dropped_small} under {MIN_AREA:.0f} m2, {outside} off-map), "
          f"{tagged} with a tagged height ({tagged/max(1,kept)*100:.0f}%)")
    print(f"tallest: {tallest[1]} at {tallest[0]:.0f} m")
    print("untagged by (zone, class):", dict(sorted(zoned.items())))
    print(f"with a mapped look: {sum(1 for v in chunks.values() for q in v if q[6] >> 3)}")
    print(f"park buildings one storey: {low_named} by name, {low_park} small untagged ones in parks")

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
                # min_area_rect's rot puts w along (sin rot, cos rot); the game's
                # boxes (build.js Builder.box, world.js off()) put w along
                # (cos rot, sin rot). Packed as the game reads it, or every box
                # is mirrored across the diagonal: a north-south plaza drawn
                # east-west, only boxes at 45 deg coming out right.
                r = int(round(((math.pi / 2 - rot) % math.pi) * 256 / math.pi)) & 255
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
