"""Bake the DEM tiles and OSM water/green polygons into the game's rasters.

Writes:
  apps/auto/data/height.png    401 x 401, 40 m grid. h = ((R<<8)|G)/10 - 100 m
  apps/auto/data/surface.png  2601 x 2601, 10 m grid. R = water, G = green
                              (lots: tools/build_lots.py -> lots.png)

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
from proj import LAT0, LON0, M_LAT, M_LON, MAP_HALF, ELEV_BASE  # noqa: E402

HERE = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.join(HERE, "data")
# AUTO_DATA_OUT writes somewhere else, to diff a change against the shipped data.
OUT = os.environ.get("AUTO_DATA_OUT") or os.path.join(HERE, "..", "..", "apps", "autokw", "data")
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
    # Waterloo Region stands 260-400 m above the sea; the game is built for
    # ground at 0-150 m, so every height comes down by ELEV_BASE (proj.py).
    mosaic -= ELEV_BASE
    h = h - ELEV_BASE
    deep = int((h < -25).sum())
    h = np.maximum(h, -25.0)
    print(f"heightfield {HF_N}x{HF_N} @ {HF_STEP} m, range {h.min():.1f}..{h.max():.1f} m "
          f"({deep} samples clamped up to the -25 m sea-bed floor)")
    # The PNG is written after carve_lakes(), not here: the bed under standing
    # water has to be dug out before this is the surface anything stands on.

    def hires(x, z):
        """The full-resolution mosaic at world (x, z), bilinear (vectorised)."""
        xt2, _ = deg2tile_f(np.full_like(x, LAT0), LON0 + x / M_LON, ZOOM)
        _, yt2 = deg2tile_f(LAT0 - z / M_LAT, np.full_like(z, LON0), ZOOM)
        qx = xt2 * 256.0 - x0 * 256.0
        qy = yt2 * 256.0 - y0 * 256.0
        xi = np.clip(np.floor(qx).astype(int), 0, W - 2)
        yi = np.clip(np.floor(qy).astype(int), 0, H - 2)
        ax = np.clip(qx - xi, 0, 1)
        ay = np.clip(qy - yi, 0, 1)
        return (mosaic[yi, xi] * (1 - ax) * (1 - ay) + mosaic[yi, xi + 1] * ax * (1 - ay)
                + mosaic[yi + 1, xi] * (1 - ax) * ay + mosaic[yi + 1, xi + 1] * ax * ay)
    return h, hires


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

    # No sea: Waterloo Region is 500 km from salt water. Every wet cell is a
    # lake, a pond or the Grand and Speed rivers (carve_water).
    filled = np.zeros((PAD_N, PAD_N), dtype=bool)

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
    # The lot layer (parking, plazas, yards) is NOT in here any more: it ships
    # as its own distance field, lots.png, from build_lots.py -- which reads
    # this file's red channel, so run it after this step.
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
    def idx(v, step, n):
        i = int(round((v + MAP_HALF) / step))
        if not (0 <= i < n):
            raise IndexError(f"probe {v:.0f} m is outside the map")
        return i

    def at_h(x, z):
        return h[idx(z, HF_STEP, HF_N), idx(x, HF_STEP, HF_N)]

    def near_w(x, z, r=30):
        j, i = idx(z, MASK_STEP, MASK_N), idx(x, MASK_STEP, MASK_N)
        k = r // MASK_STEP
        return bool(wet[max(0, j - k):j + k + 1, max(0, i - k):i + k + 1].any())

    from proj import to_world
    # Heights above sea level (published field / survey elevations, +-10 m:
    # the Canadian DEM under the terrain tiles is coarser than Seattle's NED).
    checks = [
        # name,                 lat,      lon,      water, ASL height
        ("YKF airport",         43.4608, -80.3786, False, 321.6),
        ("Kitchener City Hall", 43.4515, -80.4920, False, 331.0),
        ("UW Dana Porter",      43.4697, -80.5422, False, 335.0),
        ("Galt (Main St)",      43.3586, -80.3144, False, None),
        ("St. Jacobs",          43.5380, -80.5540, False, None),
        ("Grand R. Bridgeport", 43.47736, -80.47873, True, None),
        ("Grand R. Freeport",   43.41980, -80.41275, True, None),
        ("Grand R. Galt",       43.35600, -80.31586, True, None),
        ("Columbia Lake",       43.4732, -80.5562, True, None),
        ("Laurel Ck reservoir", 43.4800, -80.5800, True, None),
        ("Silver Lake",         43.4659, -80.5262, True, None),
        ("Victoria Park Lake",  43.4469, -80.4999, True, None),
    ]
    bad = 0
    for name, lat, lon, ew, eh in checks:
        x, z = to_world(lat, lon)
        w, hh = near_w(x, z, 150 if ew else 30), at_h(x, z) + ELEV_BASE
        okw = w == ew
        okh = eh is None or abs(hh - eh) <= 10
        if not (okw and okh):
            bad += 1
        flag = "" if (okw and okh) else "  <-- FAIL"
        exp = f"expect {'water' if ew else 'land ':5s}" + (f" {eh:5.1f} m" if eh is not None else "")
        print(f"  {name:20s} ({x:6.0f},{z:6.0f})  {'water' if w else 'land ':5s} "
              f"{hh:6.1f} m ASL   {exp}{flag}")
    print(f"probe: {len(checks) - bad}/{len(checks)} passed")
    return bad == 0


def _blur(a, sigma_cells):
    """Separable Gaussian blur (numpy only)."""
    r = max(1, int(3 * sigma_cells))
    k = np.exp(-0.5 * (np.arange(-r, r + 1) / sigma_cells) ** 2)
    k /= k.sum()
    out = np.apply_along_axis(lambda m: np.convolve(m, k, mode="same"), 0, a)
    return np.apply_along_axis(lambda m: np.convolve(m, k, mode="same"), 1, out)


def carve_water(h, wet):
    """Dig a bed under every water body and give every wet place its level.

    Seattle's water was a sea plane plus a flat plane per lake. Here there is
    no sea and the Grand River falls ~50 m across the map, so the surface is a
    FIELD: level[j, i] on the 40 m grid wherever there is water, flat across
    each lake and pond, sloping down each river. world.js draws one mesh from
    it and waterLevelAt() reads it (wlevel.png, same encoding as height.png,
    0 = dry).

    The level comes from the DEM itself, which reads a water surface as
    ground: the low quantile of the wet readings round each cell (the bank's
    trees read high, never low), smoothed along the water by a normalised
    Gaussian so a river slopes evenly instead of stepping at DEM noise.
    """
    from collections import deque
    k = MASK_STEP
    frac = np.zeros((HF_N, HF_N), dtype=np.float32)
    for j in range(HF_N):
        mj0 = max(0, j * HF_STEP // k - 2)
        mj1 = min(MASK_N, mj0 + 5)
        for i in range(HF_N):
            mi0 = max(0, i * HF_STEP // k - 2)
            frac[j, i] = wet[mj0:mj1, mi0:min(MASK_N, mi0 + 5)].mean()

    wetHF = frac > 0.05
    # low reading per wet cell: min over its wet 3x3 neighbourhood
    BIG = 1e6
    hw = np.where(wetHF, h, BIG)
    lo = hw.copy()
    for dj in (-1, 0, 1):
        for di in (-1, 0, 1):
            lo = np.minimum(lo, np.roll(np.roll(hw, dj, 0), di, 1))
    lo = np.where(wetHF, lo, 0.0)
    # normalised blur along the water only (~160 m)
    m = wetHF.astype(np.float64)
    num = _blur(lo * m, 4.0)
    den = _blur(m, 4.0)
    level = np.where(wetHF, num / np.maximum(den, 1e-6), 0.0)

    # Components: a lake (little fall across it) takes one flat level, its
    # median; a river keeps the slope.
    lab = np.full(wetHF.shape, -1, dtype=np.int32)
    comps = []
    for sj, si in np.argwhere(wetHF):
        if lab[sj, si] >= 0:
            continue
        cid = len(comps)
        q = deque([(sj, si)])
        lab[sj, si] = cid
        cells = []
        while q:
            y, x = q.popleft()
            cells.append((y, x))
            for ny in (y - 1, y, y + 1):
                for nx in (x - 1, x, x + 1):
                    if 0 <= ny < HF_N and 0 <= nx < HF_N and wetHF[ny, nx] and lab[ny, nx] < 0:
                        lab[ny, nx] = cid
                        q.append((ny, nx))
        ys = np.array([c[0] for c in cells]); xs = np.array([c[1] for c in cells])
        lv = level[ys, xs]
        fall = float(np.percentile(lv, 95) - np.percentile(lv, 5))
        kind = "river" if fall > 1.5 and len(cells) > 40 else "lake"
        if kind == "lake":
            level[ys, xs] = float(np.median(lv))
        comps.append({"kind": kind, "n": len(cells), "fall": round(fall, 1),
                      "level": round(float(np.median(lv)), 2),
                      "x": round(float(xs.mean() * HF_STEP - MAP_HALF)),
                      "z": round(float(ys.mean() * HF_STEP - MAP_HALF))})
    rivers = [c for c in comps if c["kind"] == "river"]
    print(f"water: {len(comps)} bodies, {len(rivers)} sloping "
          f"({', '.join(f'{c['fall']} m over {c['n']} cells' for c in sorted(rivers, key=lambda c: -c['n'])[:4])})")

    # Carve: the bed under the surface, as Seattle's lakes were.
    DEPTH = 3.5
    h = np.where(wetHF, np.minimum(h - DEPTH * frac, level - 1.0 - 1.5 * frac), h)
    # Banks: a dry vertex next to water stands at least 0.35 m over it, or
    # the field's mesh (drawn a cell past the water) floods the floodplain.
    near = np.zeros_like(wetHF)
    lvl_near = np.zeros_like(level)
    for dj in (-1, 0, 1):
        for di in (-1, 0, 1):
            sh = np.roll(np.roll(wetHF, dj, 0), di, 1)
            sl = np.roll(np.roll(level, dj, 0), di, 1)
            lvl_near = np.where(sh, np.maximum(lvl_near, sl), lvl_near)
            near |= sh
    bank = near & ~wetHF
    h = np.where(bank, np.maximum(h, lvl_near + 0.35), h)
    # the level a bank vertex's water would stand at, for the drawn mesh's edge
    level_out = np.where(wetHF, level, np.where(bank, lvl_near, 0.0))

    with open(os.path.join(OUT, "water.json"), "w") as f:
        json.dump({"lakes": [], "bodies": comps}, f, separators=(",", ":"))
    q = np.where(level_out != 0, np.clip(np.rint((level_out + 100.0) * 10.0), 1, 65535), 0).astype(np.uint32)
    img = np.zeros((HF_N, HF_N, 3), dtype=np.uint8)
    img[:, :, 0] = (q >> 8).astype(np.uint8)
    img[:, :, 1] = (q & 255).astype(np.uint8)
    img[:, :, 2] = (wetHF * 255).astype(np.uint8)
    Image.fromarray(img, "RGB").save(os.path.join(OUT, "wlevel.png"), optimize=True)
    print(f"wlevel.png: {int(wetHF.sum())} wet cells, {int(bank.sum())} bank cells")
    lake_level = np.where(wetHF, level, h)
    return h, lake_level, frac


LANDMARK_KEEP = 160.0   # metres round each landmark grade_streets leaves alone


def near_landmarks():
    """Vertices within LANDMARK_KEEP of a landmark in places.json.

    Read from the shipped data, not rebuilt: build_places.py runs after this
    step and its landmark positions come from OSM alone, not the terrain.
    Moving the ground under a landmark moves the landmark and nothing it was
    modelled against: MoPOP sank 1 m into the monorail's passage, the
    Central Library rose 5 m on its block."""
    out = np.zeros((HF_N, HF_N), dtype=bool)
    p = os.path.join(HERE, "..", "..", "apps", "autokw", "data", "places.json")
    xs = -MAP_HALF + np.arange(HF_N) * HF_STEP
    X, Z = np.meshgrid(xs, xs)
    if not os.path.exists(p):
        sys.exit("build_raster: %s is missing. grade_streets keeps clear of the "
                 "landmarks in the SHIPPED places.json; on a fresh import run "
                 "build_places.py once first, then this." % os.path.normpath(p))
    with open(p) as f:
        landmarks = json.load(f)["landmarks"]
    for l in landmarks:
        out |= np.hypot(X - l["x"], Z - l["z"]) <= LANDMARK_KEEP
    return out


def save_height(h):
    q = np.clip(np.rint((h + 100.0) * 10.0), 0, 65535).astype(np.uint32)
    img = np.zeros((HF_N, HF_N, 3), dtype=np.uint8)
    img[:, :, 0] = (q >> 8).astype(np.uint8)
    img[:, :, 1] = (q & 255).astype(np.uint8)
    Image.fromarray(img, "RGB").save(os.path.join(OUT, "height.png"), optimize=True)


if __name__ == "__main__":
    os.makedirs(OUT, exist_ok=True)
    h, hires = build_height()
    wet = build_masks()
    h0 = h.copy()
    h, lake_level, frac = carve_water(h, wet)
    air = np.zeros_like(h, dtype=bool)
    # Streets last. Never moved: the airfield, open water (over half the 50 m
    # round a vertex is wet), and the ground under the landmarks, which were
    # modelled on the DEM as it was. A shore vertex may move for a street on
    # the land beside it, but grade_streets keeps the water over the bed.
    hard = air | (frac >= 0.5) | near_landmarks()
    soft = (frac > 0) & ~hard
    from grade_streets import grade_streets
    h = grade_streets(h, hard, soft, wet, lake_level, hires, MAP_HALF, HF_STEP)
    save_height(h)
    ok = probe(h, wet)
    for fn in ("height.png", "surface.png"):
        print(f"{fn:14s} {os.path.getsize(os.path.join(OUT, fn))/1e6:6.2f} MB")
    sys.exit(0 if ok else 1)
