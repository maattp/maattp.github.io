"""Bake the mountains on the horizon from real elevation data.

    python3 tools/build_mountains.py            -> apps/auto/data/mountains.bin

Source: the AWS Terrain Tiles "terrarium" PNGs (the same ones fetch_dem.py uses
for the city), which are USGS 3DEP / NED over Washington -- public domain, no
key. Zoom 10 (~104 m/px at 47.6 N) covers the Olympics and the Cascades out to
150 km; zoom 12 (~26 m/px) covers Mt Rainier. Tiles are cached in
tools/data/dem/ (git-ignored), so a re-run needs no network.

Two things are baked, both seen from the game's origin (Westlake Center) at sea
level, with the earth's curvature (and 13 % refraction) taken off:

1. THE SKYLINE. For each of 8192 bearings, a ray is marched from 16 km out to
   150 km and the highest thing on the sky is kept: its height above sea level
   (minus curvature) and its distance. This is the whole silhouette of the
   Olympics, the Cascades and Rainier, from the data, with no noise.
2. RAINIER'S FACE. A 400 x 100 view of the mountain: each texel is a ray at that
   bearing and elevation, marched against the 26 m DEM until it hits ground,
   storing the height, slope, sun-lit factor (lambert against the game's fixed
   sun, with cast shadows) and distance of what it hit. Foothills that stand in
   front of the lower slopes occlude them, exactly as they do from Seattle.

mountains.bin (little-endian):
    'AUTM'  u16 version(1)  u16 cols  u16 rw  u16 rh   (12 bytes)
    f32 b0  f32 span  f32 t0  f32 t1  f32 rdist        (rainier window: centre
        bearing deg, width deg, the tan(elevation) range the rows cover, in the
        game's stretched units, and the distance used to shift it for altitude)
    cols x 4 bytes   skyline:  R,G = tan(elevation) / 2e-6 (u16: the true angle from sea
                               level, curvature off, unstretched), B = distance /
                               0.6 km (smoothed over +-1 deg: it only drives haze and
                               the pixel's height, and the real value jumps between
                               near hills and far ridges column to column), A = 255
    rw*rh x 4 bytes  Rainier:  R = height/4500, G = slope/90 deg, B = lit,
                               A = (distance - 70 km) / 45 km      (row 0 = lowest)

Keep EXAG, the sun and the origin in step with src/mountains.js, src/main.js
(SUN_OFFSET) and src/geo.js.
"""

import math
import os
import struct
import sys
import time
import urllib.request
from concurrent.futures import ThreadPoolExecutor

import numpy as np
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
DEM_DIR = os.path.join(HERE, "data", "dem")
OUT = os.path.join(HERE, "..", "apps", "auto", "data", "mountains.bin")
URL = "https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png"

LAT0, LON0 = 47.61134, -122.33790          # geo.js: Westlake Center
R_EARTH = 6371000.0
R_EFF = R_EARTH / (1 - 0.13)
EXAG = 1.2                                  # mountains.js
SUN = np.array([-215.0, 150.0, 200.0])      # main.js SUN_OFFSET as (east, north, up)
SUN /= np.linalg.norm(SUN)

COLS = 8192
RAINIER = (46.8517, -121.7603)              # Wikipedia: Mount Rainier
RW, RH = 400, 100
R_SPAN = 10.0
T0, T1 = 0.0105, 0.0535
R_DIST = 94700.0


def deg2tile(lat, lon, z):
    n = 2 ** z
    x = (lon + 180.0) / 360.0 * n
    y = (1.0 - math.asinh(math.tan(math.radians(lat))) / math.pi) / 2.0 * n
    return x, y


def fetch(z, x, y):
    p = os.path.join(DEM_DIR, f"{z}_{x}_{y}.png")
    if os.path.exists(p) and os.path.getsize(p) > 0:
        return p
    for attempt in range(5):
        try:
            req = urllib.request.Request(URL.format(z=z, x=x, y=y), headers={"User-Agent": "auto-map-import/0.1"})
            with urllib.request.urlopen(req, timeout=60) as r:
                data = r.read()
            with open(p, "wb") as f:
                f.write(data)
            return p
        except Exception as e:  # noqa: BLE001
            if attempt == 4:
                sys.exit(f"failed {z}/{x}/{y}: {e}")
            time.sleep(1.5 * (attempt + 1))


class Mosaic:
    """A rectangle of terrarium tiles as one float array, sampled bilinearly."""

    def __init__(self, z, lat0, lat1, lon0, lon1):
        self.z = z
        x0, y1f = deg2tile(lat0, lon0, z)
        x1, y0f = deg2tile(lat1, lon1, z)
        self.tx0, self.ty0 = int(math.floor(x0)), int(math.floor(y0f))
        tx1, ty1 = int(math.floor(x1)), int(math.floor(y1f))
        self.nx, self.ny = tx1 - self.tx0 + 1, ty1 - self.ty0 + 1
        os.makedirs(DEM_DIR, exist_ok=True)
        todo = [(self.tx0 + i, self.ty0 + j) for j in range(self.ny) for i in range(self.nx)]
        print(f"z{z}: {self.nx} x {self.ny} tiles", flush=True)
        with ThreadPoolExecutor(8) as ex:
            paths = list(ex.map(lambda t: fetch(z, *t), todo))
        self.h = np.zeros((self.ny * 256, self.nx * 256), np.float32)
        for (tx, ty), p in zip(todo, paths):
            a = np.asarray(Image.open(p).convert("RGB"), np.float32)
            h = a[..., 0] * 256 + a[..., 1] + a[..., 2] / 256 - 32768
            i, j = tx - self.tx0, ty - self.ty0
            self.h[j * 256:(j + 1) * 256, i * 256:(i + 1) * 256] = h
        self.n = 2 ** z * 256

    def px(self, lat, lon):
        """Pixel coordinates in this mosaic (float)."""
        x = (lon + 180.0) / 360.0 * self.n - self.tx0 * 256
        y = (1.0 - np.arcsinh(np.tan(np.radians(lat))) / math.pi) / 2.0 * self.n - self.ty0 * 256
        return x, y

    def inside(self, x, y):
        return (x >= 0) & (y >= 0) & (x < self.nx * 256 - 1) & (y < self.ny * 256 - 1)

    def sample(self, lat, lon, arr=None):
        arr = self.h if arr is None else arr
        x, y = self.px(lat, lon)
        ok = self.inside(x, y)
        x = np.clip(x, 0, self.nx * 256 - 1.001)
        y = np.clip(y, 0, self.ny * 256 - 1.001)
        x0, y0 = np.floor(x).astype(int), np.floor(y).astype(int)
        fx, fy = x - x0, y - y0
        v = (arr[y0, x0] * (1 - fx) * (1 - fy) + arr[y0, x0 + 1] * fx * (1 - fy)
             + arr[y0 + 1, x0] * (1 - fx) * fy + arr[y0 + 1, x0 + 1] * fx * fy)
        return np.where(ok, v, -1000.0)

    def m_per_px(self, lat):
        return 40075016.686 * math.cos(math.radians(lat)) / self.n


def destination(bearing_deg, dist):
    """Great-circle destination from the origin: lat, lon in degrees."""
    b = np.radians(bearing_deg)
    d = dist / R_EARTH
    la1, lo1 = math.radians(LAT0), math.radians(LON0)
    la2 = np.arcsin(math.sin(la1) * np.cos(d) + math.cos(la1) * np.sin(d) * np.cos(b))
    lo2 = lo1 + np.arctan2(np.sin(b) * np.sin(d) * math.cos(la1), np.cos(d) - math.sin(la1) * np.sin(la2))
    return np.degrees(la2), np.degrees(lo2)


def bearing_to(lat, lon):
    la1, lo1, la2, lo2 = map(math.radians, (LAT0, LON0, lat, lon))
    y = math.sin(lo2 - lo1) * math.cos(la2)
    x = math.cos(la1) * math.sin(la2) - math.sin(la1) * math.cos(la2) * math.cos(lo2 - lo1)
    return (math.degrees(math.atan2(y, x)) + 360) % 360


def drop(d):
    return d * d / (2 * R_EFF)


def skyline(mosaics, bearings, d0=16000.0, d1=150000.0, step=100.0):
    best_t = np.full(bearings.shape, -9.0)
    best_h = np.zeros(bearings.shape)
    best_d = np.full(bearings.shape, 90000.0)
    for d in np.arange(d0, d1, step):
        lat, lon = destination(bearings, d)
        h = None
        for m in mosaics:                       # finest first
            v = m.sample(lat, lon)
            h = v if h is None else np.where(h > -999, h, v)
        vis = h - drop(d)
        t = vis / d
        upd = (t > best_t) & (h > -999)
        best_t = np.where(upd, t, best_t)
        best_h = np.where(upd, vis, best_h)
        best_d = np.where(upd, d, best_d)
    return best_h, best_d


def smooth_circ(a, half):
    k = np.ones(2 * half + 1) / (2 * half + 1)
    ext = np.concatenate([a[-half:], a, a[:half]])
    return np.convolve(ext, k, mode="valid")


def main():
    t_start = time.time()
    broad = Mosaic(10, 46.6, 49.0, -124.5, -120.3)
    fine = Mosaic(12, 46.55, 47.15, -122.30, -121.25)
    # --- skyline, from the whole data set; Rainier's columns again from the fine grid
    bearings = (np.arange(COLS) + 0.5) / COLS * 360.0
    print("skyline...", flush=True)
    H, D = skyline([broad], bearings)
    b0 = bearing_to(*RAINIER)
    sel = np.abs(((bearings - b0 + 180) % 360) - 180) < 7.0
    Hf, Df = skyline([fine, broad], bearings[sel], d0=70000.0, d1=125000.0, step=40.0)
    tb, tf = H[sel] / D[sel], Hf / Df
    pick = tf > tb
    H[np.where(sel)[0][pick]] = Hf[pick]
    D[np.where(sel)[0][pick]] = Df[pick]
    H = np.maximum(H, 0)
    TAN = H / D                                  # true tan(elevation) of the skyline
    # distance that drives haze and height: median-smoothed, then averaged
    from scipy.ndimage import median_filter
    Ds = smooth_circ(median_filter(D, size=61, mode="wrap"), 40)

    # --- Rainier's face
    print("rainier face...", flush=True)
    cols = b0 - R_SPAN / 2 + (np.arange(RW) + 0.5) * R_SPAN / RW
    rows_t = T0 + (np.arange(RH) + 0.5) * (T1 - T0) / RH
    B, TT = np.meshgrid(cols, rows_t)                  # (RH, RW)
    B, TT = B.ravel(), TT.ravel() / EXAG               # the ray's TRUE tan(elevation)
    hit_d = np.full(B.shape, np.nan)
    prev_gap = None
    prev_d = None
    step = 40.0
    for d in np.arange(55000.0, 130000.0, step):
        lat, lon = destination(B, d)
        h = fine.sample(lat, lon)
        h = np.where(h > -999, h, broad.sample(lat, lon))
        gap = d * TT - (h - drop(d))                   # >0: ray above ground
        if prev_gap is not None:
            hitnow = np.isnan(hit_d) & (gap <= 0) & (prev_gap > 0)
            f = prev_gap / np.maximum(prev_gap - gap, 1e-6)
            hit_d = np.where(hitnow, prev_d + f * step, hit_d)
        prev_gap, prev_d = gap, d
    ok = ~np.isnan(hit_d)
    dd = np.where(ok, hit_d, 95000.0)
    lat, lon = destination(B, dd)
    # smoothed DEM for normals and the shadow march
    from scipy.ndimage import gaussian_filter
    sm = gaussian_filter(fine.h, 1.2)
    mpp = fine.m_per_px(RAINIER[0])
    x, y = fine.px(lat, lon)
    xi, yi = np.clip(np.round(x).astype(int), 2, fine.nx * 256 - 3), np.clip(np.round(y).astype(int), 2, fine.ny * 256 - 3)
    gx = (sm[yi, xi + 1] - sm[yi, xi - 1]) / (2 * mpp)    # east
    gn = -(sm[yi + 1, xi] - sm[yi - 1, xi]) / (2 * mpp)   # north (rows grow southward)
    nrm = np.sqrt(gx * gx + gn * gn + 1)
    n_e, n_n, n_u = -gx / nrm, -gn / nrm, 1 / nrm
    lam = np.clip(n_e * SUN[0] + n_n * SUN[1] + n_u * SUN[2], 0, 1)
    slope = np.degrees(np.arccos(n_u))
    hz = fine.sample(lat, lon)
    # cast shadow toward the sun, horizontal direction (east, north) of SUN
    sh = np.hypot(SUN[0], SUN[1])
    se, sn = SUN[0] / sh, SUN[1] / sh
    stan = SUN[2] / sh
    shadow = np.zeros(B.shape, bool)
    dlat_per_m = 1 / 111132.0
    for s in np.arange(60.0, 14000.0, 60.0):
        la = lat + sn * s * dlat_per_m
        lo = lon + se * s * dlat_per_m / math.cos(math.radians(lat.mean()))
        hh = fine.sample(la, lo)
        shadow |= (hh > hz + s * stan + 4) & (hh > -999)
    lit = lam * np.where(shadow, 0.0, 1.0)
    img = np.zeros((RH, RW, 4), np.uint8)
    hz2 = hz.reshape(RH, RW)
    img[..., 0] = np.clip(hz2 / 4500 * 255, 0, 255)
    img[..., 1] = np.clip(slope.reshape(RH, RW) / 90 * 255, 0, 255)
    img[..., 2] = np.clip(lit.reshape(RH, RW) * 255, 0, 255)
    img[..., 3] = np.clip((dd.reshape(RH, RW) - 70000) / 45000 * 255, 0, 255)
    # rays that never touched ground (above the summit): copy the texel below
    okm = ok.reshape(RH, RW)
    for r in range(RH - 2, -1, -1):
        miss = ~okm[r]
        img[r][miss] = img[r + 1][miss]
        okm[r] |= miss & okm[r + 1]

    # --- write
    sky = np.zeros((COLS, 4), np.uint8)
    hv = np.clip(np.round(TAN / 2e-6), 0, 65535).astype(np.uint32)
    sky[:, 0], sky[:, 1] = hv >> 8, hv & 255
    sky[:, 2] = np.clip(np.round(Ds / 600), 0, 255)
    sky[:, 3] = 255
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "wb") as f:
        f.write(b"AUTM" + struct.pack("<HHHH", 1, COLS, RW, RH))
        f.write(struct.pack("<fffff", b0, R_SPAN, T0, T1, R_DIST))
        f.write(sky.tobytes())
        f.write(img.tobytes())
    print(f"wrote {OUT}: {os.path.getsize(OUT)} bytes, Rainier bearing {b0:.2f}, "
          f"rays hit {ok.mean() * 100:.0f} %, {time.time() - t_start:.0f} s")
    # a look at it
    prev = os.path.join(HERE, "data", "mountains_face.png")
    Image.fromarray(img[::-1, :, :3]).resize((RW * 2, RH * 4), Image.NEAREST).save(prev)
    print("preview:", prev)


if __name__ == "__main__":
    main()
