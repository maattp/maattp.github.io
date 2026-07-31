"""Bake the DEM tiles and OSM water/green polygons into the game's rasters.

Writes:
  apps/auto/data/height.png    401 x 401, 40 m grid. h = ((R<<8)|G)/10 - 100 m
  apps/auto/data/surface.png  1601 x 1601, 10 m grid. R = water, G = green

Rasters replace geo.js's hand-drawn HILLS and WATER polygons outright. A raster
cannot double back on itself, which is the failure that swallowed Magnolia, and
`isWater` becomes a lookup instead of a polygon walk.
"""

import json
import math
import os
import sys

import numpy as np
from PIL import Image, ImageDraw

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from proj import LAT0, LON0, M_LAT, M_LON, MAP_HALF  # noqa: E402

HERE = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.join(HERE, "data")
OUT = os.path.join(HERE, "..", "apps", "auto", "data")
DEM_DIR = os.path.join(DATA, "dem")
ZOOM = 14

# 40 m matches the terrain mesh's vertex spacing, and the two have to agree:
# the mesh IS the drawn surface and terrainHeight() is what everything stands
# on, so a finer query grid than the mesh would float roads over the bulges it
# resolves and the mesh doesn't. At 20 m the mesh would also cost 1.28M
# triangles across a 16 km map, which is the whole frame budget.
HF_STEP = 40
HF_N = (MAP_HALF * 2) // HF_STEP + 1          # 401
MASK_STEP = 10
MASK_N = (MAP_HALF * 2) // MASK_STEP + 1      # 1601

# The mask is flood-filled on a padded grid so the coastline barrier is closed
# well outside anything the player can reach.
PAD = 3000
# Points known to be open salt water, used to seed the coastline flood fill and
# again to decide which water is sea (level 0) rather than a lake.
SEA_SEEDS = [(47.6000, -122.3800), (47.6500, -122.4400), (47.5500, -122.4300),
             (47.6400, -122.4200), (47.5750, -122.3600)]
PAD_N = (MAP_HALF + PAD) * 2 // MASK_STEP + 1


def deg2tile_f(lat, lon, z):
    n = 2 ** z
    xt = (lon + 180.0) / 360.0 * n
    yt = (1.0 - np.arcsinh(np.tan(np.radians(lat))) / math.pi) / 2.0 * n
    return xt, yt


# ---------------------------------------------------------------------------
# Elevation
# ---------------------------------------------------------------------------

def build_height():
    tiles = {}
    for fn in os.listdir(DEM_DIR):
        if not fn.endswith(".png"):
            continue
        z, x, y = (int(v) for v in fn[:-4].split("_"))
        tiles[(x, y)] = fn
    if not tiles:
        sys.exit("no DEM tiles -- run tools/fetch_dem.py")
    xs = sorted({k[0] for k in tiles})
    ys = sorted({k[1] for k in tiles})
    x0, y0 = xs[0], ys[0]
    W, H = len(xs) * 256, len(ys) * 256
    mosaic = np.zeros((H, W), dtype=np.float32)
    for (x, y), fn in tiles.items():
        im = np.asarray(Image.open(os.path.join(DEM_DIR, fn)).convert("RGB"), dtype=np.float32)
        elev = im[:, :, 0] * 256.0 + im[:, :, 1] + im[:, :, 2] / 256.0 - 32768.0
        r, c = (y - y0) * 256, (x - x0) * 256
        mosaic[r:r + 256, c:c + 256] = elev
    print(f"DEM mosaic {W}x{H} px from {len(tiles)} tiles, "
          f"range {mosaic.min():.0f}..{mosaic.max():.0f} m")

    wx = np.linspace(-MAP_HALF, MAP_HALF, HF_N, dtype=np.float64)
    wz = np.linspace(-MAP_HALF, MAP_HALF, HF_N, dtype=np.float64)
    lon = LON0 + wx / M_LON
    lat = LAT0 - wz / M_LAT
    xt, _ = deg2tile_f(np.full_like(lon, LAT0), lon, ZOOM)
    _, yt = deg2tile_f(lat, np.full_like(lat, LON0), ZOOM)
    px = xt * 256.0 - x0 * 256.0
    py = yt * 256.0 - y0 * 256.0

    PX, PY = np.meshgrid(px, py)           # (HF_N, HF_N), row = z, col = x
    x_i = np.clip(np.floor(PX).astype(int), 0, W - 2)
    y_i = np.clip(np.floor(PY).astype(int), 0, H - 2)
    fx = np.clip(PX - x_i, 0, 1)
    fy = np.clip(PY - y_i, 0, 1)
    h = (mosaic[y_i, x_i] * (1 - fx) * (1 - fy) + mosaic[y_i, x_i + 1] * fx * (1 - fy)
         + mosaic[y_i + 1, x_i] * (1 - fx) * fy + mosaic[y_i + 1, x_i + 1] * fx * fy)

    # Terrarium carries ocean bathymetry, plus a scatter of nodata pixels that
    # decode to absurd depths (one tile hits -24 km). Neither is any use here --
    # a trench under Puget Sound only wastes terrain range -- so the sea bed is
    # clamped to a shallow floor.
    deep = int((h < -25).sum())
    h = np.maximum(h, -25.0)
    print(f"heightfield {HF_N}x{HF_N} @ {HF_STEP} m, range {h.min():.1f}..{h.max():.1f} m "
          f"({deep} samples clamped up to the -25 m sea-bed floor)")
    # The PNG is written after carve_lakes(), not here: the bed under standing
    # water has to be dug out before this is the surface anything stands on.
    return h


# ---------------------------------------------------------------------------
# Water + green masks
# ---------------------------------------------------------------------------

def to_px(pts, n, step, half):
    """world [[x, z], ...] -> pixel tuples on an n-wide grid centred on the origin."""
    return [((p[0] + half) / step, (p[1] + half) / step) for p in pts]


def build_masks():
    water = json.load(open(os.path.join(DATA, "raw_water.json")))
    green = json.load(open(os.path.join(DATA, "raw_green.json")))["green"]
    half = MAP_HALF + PAD

    # --- sea: flood fill bounded by the coastline ---------------------------
    # The barrier has to be *closed*, or the fill walks around the outside of the
    # coastline and the whole map comes back as ocean. Two things close it: the
    # coastline ways themselves (extracted whole, never clipped mid-way, so they
    # run right across the padded grid) and a sealed border ring. The border sits
    # 3 km outside anything the player can reach, so losing it costs nothing.
    sea = Image.new("L", (PAD_N, PAD_N), 0)
    d = ImageDraw.Draw(sea)
    for line in water["coast"]:
        d.line(to_px(line, PAD_N, MASK_STEP, half), fill=255, width=3)
    d.rectangle([0, 0, PAD_N - 1, PAD_N - 1], outline=255, width=2)

    # Seeding from known open water beats deriving the wet side from OSM's
    # land-on-the-left rule: it is one assertion instead of 2258 guesses, and if
    # it is wrong the probe below says so immediately.
    from proj import to_world
    seed_ll = SEA_SEEDS
    arr = np.asarray(sea, dtype=np.uint8).copy()
    seeds = []
    for lat, lon in seed_ll:
        sx, sz = to_world(lat, lon)
        seeds.append((int((sx + half) / MASK_STEP), int((sz + half) / MASK_STEP)))
    filled = flood(arr, seeds)
    # The barrier itself is coastline: count it as water so the shore is closed.
    filled |= np.asarray(sea, dtype=np.uint8) > 0
    print(f"sea flood: {filled.mean() * 100:.1f}% of the padded grid, "
          f"from {len(seeds)} open-water seeds")

    # --- lakes and everything else tagged as water --------------------------
    lakes = Image.new("L", (PAD_N, PAD_N), 0)
    dl = ImageDraw.Draw(lakes)
    for poly in water["water"]:
        dl.polygon(to_px(poly["o"], PAD_N, MASK_STEP, half), fill=255)
        for h in poly.get("h", []):
            dl.polygon(to_px(h, PAD_N, MASK_STEP, half), fill=0)
    wet = filled | (np.asarray(lakes, dtype=np.uint8) > 0)

    # --- green --------------------------------------------------------------
    gi = Image.new("L", (PAD_N, PAD_N), 0)
    dg = ImageDraw.Draw(gi)
    for poly in green:
        dg.polygon(to_px(poly["o"], PAD_N, MASK_STEP, half), fill=255)
        for h in poly.get("h", []):
            dg.polygon(to_px(h, PAD_N, MASK_STEP, half), fill=0)
    grn = np.asarray(gi, dtype=np.uint8) > 0

    # --- crop the padding off and emit --------------------------------------
    lo = PAD // MASK_STEP
    hi = lo + MASK_N
    wet_c, grn_c = wet[lo:hi, lo:hi], grn[lo:hi, lo:hi]
    grn_c = grn_c & ~wet_c
    img = np.zeros((MASK_N, MASK_N, 3), dtype=np.uint8)
    img[:, :, 0] = wet_c * 255
    img[:, :, 1] = grn_c * 255
    Image.fromarray(img, "RGB").save(os.path.join(OUT, "surface.png"), optimize=True)
    print(f"surface {MASK_N}x{MASK_N} @ {MASK_STEP} m: "
          f"water {wet_c.mean()*100:.1f}%, green {grn_c.mean()*100:.1f}%")
    return wet_c


def flood(barrier, seeds):
    """Scanline flood fill over cells where `barrier` is 0. Returns a bool array."""
    n = barrier.shape[0]
    out = np.zeros_like(barrier, dtype=bool)
    stack = [(x, y) for (x, y) in seeds if barrier[y, x] == 0]
    while stack:
        x, y = stack.pop()
        if out[y, x] or barrier[y, x]:
            continue
        xl = x
        while xl > 0 and not barrier[y, xl - 1] and not out[y, xl - 1]:
            xl -= 1
        xr = x
        while xr < n - 1 and not barrier[y, xr + 1] and not out[y, xr + 1]:
            xr += 1
        out[y, xl:xr + 1] = True
        for ny in (y - 1, y + 1):
            if 0 <= ny < n:
                row_b = barrier[ny, xl:xr + 1]
                row_o = out[ny, xl:xr + 1]
                free = np.flatnonzero((row_b == 0) & (~row_o))
                if free.size:
                    # one seed per contiguous run is enough
                    breaks = np.flatnonzero(np.diff(free) > 1)
                    starts = np.concatenate(([0], breaks + 1))
                    for s in starts:
                        stack.append((xl + int(free[s]), ny))
    return out


def probe(h, wet):
    """Assert the map against reality at points whose truth we know."""
    # Negative indices wrap in numpy, so an off-map probe would quietly read the
    # far edge of the city and report a plausible-looking pass.
    def idx(v, step, n):
        i = int(round((v + MAP_HALF) / step))
        if not (0 <= i < n):
            raise IndexError(f"probe {v:.0f} m is outside the map")
        return i

    def at_h(x, z):
        return h[idx(z, HF_STEP, HF_N), idx(x, HF_STEP, HF_N)]

    def at_w(x, z):
        return bool(wet[idx(z, MASK_STEP, MASK_N), idx(x, MASK_STEP, MASK_N)])

    from proj import to_world
    # Heights are USGS NED 10 m readings, not guesses -- fetched from
    # api.opentopodata.org, which is an independent source from the terrain
    # tiles. Tolerance is 6 m, which is about two DEM cells of horizontal slop
    # on a Seattle hillside.
    checks = [
        # name,             lat,      lon,       water, NED height
        ("Westlake Center", 47.6114, -122.3379, False, 39.2),
        ("Kerry Park", 47.6295, -122.3599, False, 103.0),
        ("Queen Anne top", 47.6370, -122.3570, False, 119.0),
        ("Beacon Hill", 47.5790, -122.3110, False, 91.0),
        ("Alki (inland)", 47.5790, -122.4050, False, None),
        ("Magnolia", 47.6500, -122.4000, False, 59.2),
        ("Ballard", 47.6680, -122.3840, False, None),
        ("West Seattle", 47.5610, -122.3860, False, None),
        ("Capitol Hill", 47.6230, -122.3120, False, None),
        ("Harbor Island", 47.5860, -122.3480, False, None),
        ("Elliott Bay", 47.6000, -122.3800, True, None),
        ("Puget Sound W", 47.6400, -122.4200, True, None),
        ("Lake Union", 47.6400, -122.3350, True, None),
        ("Green Lake", 47.6790, -122.3380, True, None),
        ("Lake Washington", 47.6100, -122.2600, True, None),
        ("Salmon Bay", 47.6605, -122.3780, True, None),
        ("Montlake Cut", 47.6473, -122.3045, True, None),
        ("West Waterway", 47.5750, -122.3600, True, None),
    ]
    bad = 0
    for name, lat, lon, ew, eh in checks:
        x, z = to_world(lat, lon)
        w, hh = at_w(x, z), at_h(x, z)
        okw = w == ew
        okh = eh is None or abs(hh - eh) <= 6
        if not (okw and okh):
            bad += 1
        flag = "" if (okw and okh) else "  <-- FAIL"
        exp = f"expect {'water' if ew else 'land ':5s}" + (f" {eh:5.1f} m" if eh is not None else "")
        print(f"  {name:17s} ({x:6.0f},{z:6.0f})  {'water' if w else 'land ':5s} "
              f"{hh:6.1f} m   {exp}{flag}")
    print(f"probe: {len(checks) - bad}/{len(checks)} passed")
    return bad == 0


def grade_airfield(h):
    """Flatten Boeing Field's movement area to its field elevation.

    The airfield is genuinely flat -- it was graded when it was built -- but
    the 40 m bare-earth DEM smears the 20 m bluff at its north boundary into
    the strip, so the imported ground climbs where the real runway does not.
    Same philosophy as carve_lakes: the raster is corrected to match a known
    physical fact about the place, at the raster, so every consumer (terrain
    mesh, roads, landmark pavement, taxiing planes) agrees for free.

    Rectangle matches the landmark layout in landmarks.js: ARP (2707, 9055),
    bearing -0.52 rad, half-extents 520 x 1680 m, blended out over 120 m so
    the field meets the surrounding ground with a shoulder instead of a cliff.
    """
    import numpy as np
    AX, AZ, RY = 2707.0, 9055.0, -0.52
    HW, HL, FIELD, BLEND = 520.0, 1680.0, 5.2, 120.0
    c, sn = math.cos(RY), math.sin(RY)
    n = h.shape[0]
    step = (2 * MAP_HALF) / (n - 1)
    xs = -MAP_HALF + np.arange(n) * step
    X, Z = np.meshgrid(xs, xs)   # Z rows, X cols -- match the raster layout
    dx, dz = X - AX, Z - AZ
    lx = dx * c + dz * sn
    lz = -dx * sn + dz * c
    dxo = np.maximum(np.abs(lx) - HW, 0)
    dzo = np.maximum(np.abs(lz) - HL, 0)
    d = np.hypot(dxo, dzo)
    w = np.clip(1 - d / BLEND, 0, 1)
    graded = np.where(w > 0, h * (1 - w) + FIELD * w, h)
    inside = w >= 1
    print(f"  airfield graded: {int(inside.sum())} cells set to {FIELD} m, "
          f"blend touched {int(((w > 0) & ~inside).sum())}")
    return graded


def carve_lakes(h, wet):
    """Dig a bed under every water body, and report each body's surface level.

    A bare-earth DEM reports the *surface* of standing water as ground, so
    straight out of the tiles Lake Union is a 5 m plateau and Green Lake is a
    51 m one. The game draws a single sea-level water plane, so both of them
    rendered as solid grass you could drive across.

    Two halves to the fix. Here the terrain under water is dropped below the
    surface so there is a basin to fill, and each body above sea level is
    emitted with its own level for world.js to put a plane at. Puget Sound is
    not in the list: it is sea level, which is what the global plane already is.
    """
    from collections import deque
    from proj import to_world as to_world_local
    seed_ll_sea = SEA_SEEDS

    # mask (10 m) -> heightfield (40 m): a cell is wet by the fraction of the
    # mask cells inside it, so the shore ramps down instead of stepping.
    k = MASK_STEP  # 4 mask cells per heightfield cell each way
    frac = np.zeros((HF_N, HF_N), dtype=np.float32)
    for j in range(HF_N):
        mj0 = max(0, j * HF_STEP // k - 2)
        mj1 = min(MASK_N, mj0 + 5)
        for i in range(HF_N):
            mi0 = max(0, i * HF_STEP // k - 2)
            frac[j, i] = wet[mj0:mj1, mi0:min(MASK_N, mi0 + 5)].mean()

    surface = h.copy()

    # Connected water bodies standing above the sea, grouped on the mask grid.
    #
    # The mask has to be eroded first. At the shore the 40 m DEM blends land
    # into water, so the outermost ring of water cells reads well above sea
    # level -- and that ring is continuous, so without eroding it Lake
    # Washington, Lake Union and Puget Sound label as one 49 km2 body at 5.1 m.
    # Eroding 40 m also parts the ship canal, which is what separates the lakes
    # from the sea in the first place: that is what the locks do in reality.
    core = wet.copy()
    for _ in range(4):
        e = core.copy()
        e[1:, :] &= core[:-1, :]
        e[:-1, :] &= core[1:, :]
        e[:, 1:] &= core[:, :-1]
        e[:, :-1] &= core[:, 1:]
        core = e

    # What makes something a lake is that it is not connected to the sea, not
    # that it reads high in the DEM. Thresholding on height picks up chunks of
    # Puget Sound instead: terrarium has patches of the Sound at 2.7 to 5.7 m,
    # which is the same band Lake Washington sits in. Labelling connectivity and
    # throwing away whatever component holds an open-water seed has no such
    # overlap to get wrong.
    lakes = []
    above = core
    seen = np.zeros_like(above, dtype=bool)
    sea_seeds = set()
    for lat, lon in [(47.6000, -122.3800), (47.6500, -122.4400), (47.5500, -122.4300),
                     (47.6400, -122.4200), (47.5750, -122.3600)]:
        sx0, sz0 = to_world_local(lat, lon)
        sea_seeds.add((int(round((sz0 + MAP_HALF) / MASK_STEP)),
                       int(round((sx0 + MAP_HALF) / MASK_STEP))))
    idx = np.argwhere(above)
    for sy, sx in idx:
        if seen[sy, sx]:
            continue
        q = deque([(sy, sx)])
        seen[sy, sx] = True
        cells = []
        while q:
            y, x = q.popleft()
            cells.append((y, x))
            for ny, nx in ((y - 1, x), (y + 1, x), (y, x - 1), (y, x + 1)):
                if 0 <= ny < MASK_N and 0 <= nx < MASK_N and above[ny, nx] and not seen[ny, nx]:
                    seen[ny, nx] = True
                    q.append((ny, nx))
        if len(cells) * MASK_STEP * MASK_STEP < 20000:
            continue
        cellset = set(cells)
        if any(s in cellset for s in sea_seeds):
            continue  # this is the sea; the global plane at y=0 already covers it
        ys = np.array([c[0] for c in cells])
        xs = np.array([c[1] for c in cells])
        lvl = float(np.median(surface[np.clip(ys // 4, 0, HF_N - 1),
                                      np.clip(xs // 4, 0, HF_N - 1)]))
        # Grow the box back past the erosion, so the plane reaches the real shore.
        GROW = 80.0
        lakes.append({
            "level": round(lvl, 2),
            "x0": round(float(xs.min() * MASK_STEP - MAP_HALF) - GROW, 1),
            "z0": round(float(ys.min() * MASK_STEP - MAP_HALF) - GROW, 1),
            "x1": round(float(xs.max() * MASK_STEP - MAP_HALF) + GROW, 1),
            "z1": round(float(ys.max() * MASK_STEP - MAP_HALF) + GROW, 1),
            "area": int(len(cells) * MASK_STEP * MASK_STEP),
        })
    # Clamp the terrain below whatever water is on top of it.
    #
    # Subtracting a fixed depth is not enough: wherever the DEM disagrees with
    # the mask -- a bad terrain-tile pixel, a pond the flood fill reached -- land
    # is left standing in the middle of water. You could see islands in Puget
    # Sound that were not on the minimap, because the minimap is drawn from the
    # mask and the world from the DEM, so the two disagreeing is exactly what
    # that looks like. 938 sea cells stood above sea level.
    #
    # Each cell is clamped below its OWN water surface: 0 for anything connected
    # to the sea, the body's own level inside a labelled lake (Green Lake really
    # is at 50 m), and the local DEM for the small ponds that are too small to
    # label -- Volunteer Park Reservoir sits at 130 m and must not be dug to
    # sea level.
    level = np.where(frac > 0.05, surface, surface)   # default: local surface
    sea_reach = flood((~wet).astype(np.uint8), [
        (int((sx + MAP_HALF) / MASK_STEP), int((sz + MAP_HALF) / MASK_STEP))
        for sx, sz in [to_world_local(la, lo) for la, lo in seed_ll_sea]
    ])
    seaHF = sea_reach[::4, ::4][:HF_N, :HF_N]
    level = np.where(seaHF, 0.0, level)
    for l in lakes:
        i0 = max(0, int((l["x0"] + MAP_HALF) / HF_STEP))
        i1 = min(HF_N, int((l["x1"] + MAP_HALF) / HF_STEP) + 1)
        j0 = max(0, int((l["z0"] + MAP_HALF) / HF_STEP))
        j1 = min(HF_N, int((l["z1"] + MAP_HALF) / HF_STEP) + 1)
        sub = level[j0:j1, i0:i1]
        wetsub = frac[j0:j1, i0:i1] > 0.5
        level[j0:j1, i0:i1] = np.where(wetsub, l["level"], sub)
    DEPTH = 7.0
    h = np.where(frac > 0.05, np.minimum(h - DEPTH * frac, level - 1.2), h)
    h = np.maximum(h, -25.0)

    lakes.sort(key=lambda l: -l["area"])
    with open(os.path.join(OUT, "water.json"), "w") as f:
        json.dump({"lakes": lakes}, f, separators=(",", ":"))
    print(f"water.json: {len(lakes)} bodies above sea level")
    for l in lakes[:6]:
        print(f"    level {l['level']:6.1f} m  {l['area']/1e6:6.2f} km2  "
              f"x {l['x0']:7.0f}..{l['x1']:7.0f}  z {l['z0']:7.0f}..{l['z1']:7.0f}")
    return h


def save_height(h):
    q = np.clip(np.rint((h + 100.0) * 10.0), 0, 65535).astype(np.uint32)
    img = np.zeros((HF_N, HF_N, 3), dtype=np.uint8)
    img[:, :, 0] = (q >> 8).astype(np.uint8)
    img[:, :, 1] = (q & 255).astype(np.uint8)
    Image.fromarray(img, "RGB").save(os.path.join(OUT, "height.png"), optimize=True)


if __name__ == "__main__":
    os.makedirs(OUT, exist_ok=True)
    h = build_height()
    wet = build_masks()
    h = carve_lakes(h, wet)
    h = grade_airfield(h)
    save_height(h)
    ok = probe(h, wet)
    for fn in ("height.png", "surface.png"):
        print(f"{fn:14s} {os.path.getsize(os.path.join(OUT, fn))/1e6:6.2f} MB")
    sys.exit(0 if ok else 1)
