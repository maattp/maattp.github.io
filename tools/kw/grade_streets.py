"""Fit the 40 m heightfield to the streets that drape it.

Called from build_raster.py, after the lakes are carved and the airfield is
graded, before height.png is written.

**Why.** Every street that is not a deck or a graded freeway is drawn on the
terrain mesh itself, and the mesh is a 40 m grid split into triangles. A
street running ALONG a hillside crosses that triangulation diagonally, and
on a curved slope -- a bluff edge, a hillside bench -- the triangles it
crosses alternate between the upper and the lower row of vertices. The road
saws up and down: Magnolia Boulevard West rode 43 -> 39 -> 48 -> 37 -> 50 m
in 60 m (an 8-10 m sawtooth on a road that is level in life), Bronson Way in
Renton 17 -> 26 -> 17 -> 26 m. The vertices are exact readings of the DEM;
the defect is that a 40 m lattice of them cannot describe the bench the
street is cut into.

**What.** The street's real height is known: the DEM tiles are ~6.4 m/px,
so sampling them ALONG the centreline reads the bench. Each street sample
(every 4 m of every ground-level way the road import keeps) asks that the
triangulated surface under it -- interpolated exactly as geo.terrainHeight()
and the terrain mesh do -- equal that height, smoothed along the way. The
vertices near streets are moved, in least squares, to satisfy those rows
together with two that keep the rest of the ground where it was:

    road      sum_v w_v(p) * d_v  =  road(p) - mesh(p)        (per sample)
    stay      W_STAY * d_v        =  0                         (per vertex)
    shape     W_SHAPE * lap(d)_v  =  0                         (per vertex)

d is each vertex's change. "shape" spreads a change over its neighbours, so
a vertex pulled 3 m does not stand up as a 40 m pyramid of grass.

Vertices under water or touching it, and any the lake carve or the airfield
grading set, never move: the lake beds, shores and the runway are facts
already corrected at the raster.

Everything downstream reads the result as the ground -- the terrain mesh,
every draped street strip, the junctions, buildings, graded freeways' floors
-- so the one-height-surface law holds by construction; nothing at runtime
changes and the game pays nothing for it.
"""

import json
import math
import os

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.join(HERE, "data")

SAMPLE = 4.0      # metres between road samples along a way
SMOOTH = 8.0      # sigma (m) of the along-way smoothing of the DEM reading
W_ABS = 1.0       # per sample: the mesh under it at the street's DEM height
W_CURV = 12.0     # per sample: ...and bending the way the street does (2nd difference)
W_STAY = 0.05     # per vertex: stay where the DEM put you
W_SHAPE = 0.2     # per vertex: keep the DEM's local shape (Laplacian of the change)
D_MAX = 8.0       # no vertex moves further than this
W_WET = 3.0       # per water cell the solve lifted: back under its level
WET_UNDER = 0.4   # ...by this much (the lake carve leaves its bed 1.2 m under)
MAX_ROUNDS = 6
# Freeways and their ramps are left out, AND the ground under them is left
# alone. They are graded at load (citygen gradeRoads) on the terrain as their
# floor. Fitted alongside the streets (at half weight) they fought them -- I-5
# downtown runs in a trench 10 m under the streets on its rim and the vertices
# between belong to both -- and left out but free, the streets beside them
# pulled crests up under them (graded freeway acc>30 +27 %).
W_CLASS = {"hwy": 0.0, "ramp": 0.0}
ABUT_R = 50.0     # metres round a bridge or tunnel end where a street asks nothing
CG_ITERS = 600


def _tri_weights(x, z, map_half, step, n):
    """Vertex indices and weights of geo.terrainHeight()'s triangle at (x, z).

    The cell (i, j) is split along tx + tz = 1, as world.js triangulates it:
    (a, c, b) and (b, c, d) with a = (j, i), b = (j, i+1), c = (j+1, i),
    d = (j+1, i+1). Returns (idx[k, 3], w[k, 3]) into the flattened grid.
    """
    fx = (x + map_half) / step
    fz = (z + map_half) / step
    i = np.clip(np.floor(fx).astype(np.int64), 0, n - 2)
    j = np.clip(np.floor(fz).astype(np.int64), 0, n - 2)
    tx = np.clip(fx - i, 0, 1)
    tz = np.clip(fz - j, 0, 1)
    a = j * n + i
    b = a + 1
    c = a + n
    d = c + 1
    lo = tx + tz <= 1
    idx = np.where(lo[:, None], np.stack([a, b, c], 1), np.stack([d, c, b], 1))
    w = np.where(lo[:, None], np.stack([1 - tx - tz, tx, tz], 1),
                 np.stack([tx + tz - 1, 1 - tx, 1 - tz], 1))
    return idx, w


def _ways(map_half, ends=None):
    """Ground-level road ways the import keeps, as (cls, [[x, z], ...]) runs.
    `ends`, a list, collects the end points of every bridge and tunnel way."""
    from build_roads import CLS, clip_runs
    ways = json.load(open(os.path.join(DATA, "raw_roads.json")))["roads"]
    out = []
    for w in ways:
        cls = CLS.get(w["cls"])
        if cls is None or str(w.get("acc", "")).lower() in ("private", "no"):
            continue
        if (str(w.get("br", "no")).lower() not in ("no", "")
                or str(w.get("tn", "no")).lower() not in ("no", "")):
            if ends is not None:
                ends.append(w["p"][0])
                ends.append(w["p"][-1])
            continue
        for run in clip_runs([tuple(p) for p in w["p"]]):
            out.append((cls, np.asarray(run, dtype=np.float64)))
    return out


def _near_ends(ends, map_half, r):
    """A 10 m grid marking everything within ~r of a bridge or tunnel end."""
    n = int(2 * map_half / 10) + 1
    g = np.zeros((n, n), dtype=bool)
    for x, z in ends:
        i, j = int(round((x + map_half) / 10)), int(round((z + map_half) / 10))
        if 0 <= i < n and 0 <= j < n:
            g[j, i] = True
    k = int(round(r / 10))
    out = g.copy()
    for dj in range(-k, k + 1):
        for di in range(-k, k + 1):
            if di * di + dj * dj > k * k:
                continue
            sh = np.roll(np.roll(g, dj, 0), di, 1)
            out |= sh
    return out


def _resample(pts):
    seg = np.hypot(np.diff(pts[:, 0]), np.diff(pts[:, 1]))
    s = np.concatenate([[0.0], np.cumsum(seg)])
    L = s[-1]
    if L < SAMPLE:
        return None, None
    k = max(2, int(round(L / SAMPLE)) + 1)
    ss = np.linspace(0, L, k)
    return np.stack([np.interp(ss, s, pts[:, 0]), np.interp(ss, s, pts[:, 1])], 1), ss


def _smooth(v, ds):
    """Gaussian along the way, renormalised at its ends."""
    r = int(math.ceil(2.5 * SMOOTH / ds))
    if r < 1 or len(v) < 3:
        return v
    k = np.exp(-0.5 * (np.arange(-r, r + 1) * ds / SMOOTH) ** 2)
    n = len(v)
    num = np.convolve(v, k, mode="full")[r:r + n]
    den = np.convolve(np.ones_like(v), k, mode="full")[r:r + n]
    return num / den


def _metrics(y):
    """(grade breaks over 8 % on 3 m steps, crests/dips over 1 m within 30 m
    either side) of a profile sampled every metre."""
    y3 = y[::3]
    g = np.diff(y3) / 3
    br = int((np.abs(np.diff(g)) > 0.08).sum())
    humps = 0
    if len(y) > 61:
        from numpy.lib.stride_tricks import sliding_window_view as swv
        win = swv(y, 31)
        lo = win.min(1)
        hi = win.max(1)
        c = y[30:-30]
        crest = np.minimum(c - lo[:-30], c - lo[30:])
        dip = np.minimum(hi[:-30] - c, hi[30:] - c)
        over = np.maximum(crest, dip) > 1.0
        humps = int((over[1:] & ~over[:-1]).sum() + (1 if over[0] else 0))
    return br, humps


def _breaks(h, runs, map_half, step, n, targets=None):
    """_metrics summed along every run on surface h (a flat grid), or on the
    runs' own target profiles."""
    br = humps = 0
    for k, pts in enumerate(runs):
        seg = np.hypot(np.diff(pts[:, 0]), np.diff(pts[:, 1]))
        s = np.concatenate([[0.0], np.cumsum(seg)])
        if s[-1] < 9:
            continue
        ss = np.arange(0, s[-1], 1.0)
        if targets is not None:
            ts, ty = targets[k]
            y = np.interp(ss, ts, ty)
        else:
            x = np.interp(ss, s, pts[:, 0])
            z = np.interp(ss, s, pts[:, 1])
            idx, w = _tri_weights(x, z, map_half, step, n)
            y = (h[idx] * w).sum(1)
        a, b = _metrics(y)
        br += a
        humps += b
    return br, humps


def _cgls(R, C, V, b, nf, iters):
    """min |A x - b| for A in COO form (rows R, cols C, values V)."""
    M = len(b)

    def Ax(x):
        return np.bincount(R, V * x[C], minlength=M)

    def ATy(y):
        return np.bincount(C, V * y[R], minlength=nf)

    x = np.zeros(nf)
    r = b.copy()
    s = ATy(r)
    p = s.copy()
    gamma = float(s @ s)
    g0 = gamma
    it = 0
    for it in range(iters):
        q = Ax(p)
        qq = float(q @ q)
        if qq == 0:
            break
        alpha = gamma / qq
        x += alpha * p
        r -= alpha * q
        s = ATy(r)
        gn = float(s @ s)
        if gn < 1e-12 * g0:
            break
        p = s + (gn / gamma) * p
        gamma = gn
    return x, it + 1


def grade_streets(h, keep, soft, wet, level, hires, map_half, step):
    """Return h with the vertices near streets fitted to the streets' real
    profile. `keep` (bool, same shape) marks vertices that must not move;
    `soft` the shore vertices, which may, so long as every water cell
    (`wet`, the 10 m mask) in a triangle they make stays WET_UNDER below its
    water's `level` (per vertex); `hires(x, z)` samples the full-resolution
    DEM (vectorised)."""
    n = h.shape[0]
    H0 = h.astype(np.float64).ravel()
    ends = []
    runs = _ways(map_half, ends)
    # The DEM is bare earth: a bridge's deck is removed from it and so is the
    # fill its abutment stands on, and the street mapped as ground runs on for
    # tens of metres over what the DEM reads as the bank or the ravine below.
    # Pulled to that, Roosevelt Way fell 19 m at 55 % into the north end of
    # the University Bridge. Near a bridge or tunnel end the street does not
    # ask for anything; the ground there keeps its own shape.
    abut = _near_ends(ends, map_half, ABUT_R)

    # --- road samples ---
    P_idx, P_w, P_rhs, P_wt, P_run = [], [], [], [], []
    all_runs, all_targets = [], []
    for cls, pts in runs:
        if W_CLASS.get(cls, 1.0) <= 0:
            continue
        q, ss = _resample(pts)
        if q is None:
            continue
        all_runs.append(pts)
        target = _smooth(hires(q[:, 0], q[:, 1]), ss[1] - ss[0])
        all_targets.append((ss, target))
        idx, w = _tri_weights(q[:, 0], q[:, 1], map_half, step, n)
        P_idx.append(idx)
        P_w.append(w)
        P_rhs.append(target)
        ai = np.clip(np.round((q[:, 0] + map_half) / 10).astype(np.int64), 0, abut.shape[0] - 1)
        aj = np.clip(np.round((q[:, 1] + map_half) / 10).astype(np.int64), 0, abut.shape[0] - 1)
        P_wt.append(np.where(abut[aj, ai], 0.0, W_CLASS.get(cls, 1.0)))
        P_run.append(np.full(len(q), len(all_runs)))
    P_idx = np.concatenate(P_idx)
    P_w = np.concatenate(P_w)
    P_rhs = np.concatenate(P_rhs)
    P_wt = np.concatenate(P_wt)
    P_run = np.concatenate(P_run)
    # every vertex of a triangle a freeway or ramp crosses, and the ring round it
    fw = np.zeros(n * n, dtype=bool)
    for cls, pts in runs:
        if W_CLASS.get(cls, 1.0) > 0:
            continue
        q, ss = _resample(pts)
        if q is None:
            continue
        fw[_tri_weights(q[:, 0], q[:, 1], map_half, step, n)[0].ravel()] = True
    f2 = fw.reshape(n, n)
    g2 = f2.copy()
    g2[1:, :] |= f2[:-1, :]
    g2[:-1, :] |= f2[1:, :]
    g2[:, 1:] |= f2[:, :-1]
    g2[:, :-1] |= f2[:, 1:]
    keepf = keep.ravel() | g2.ravel()
    ns = len(P_idx)
    mesh0 = (H0[P_idx] * P_w).sum(1)
    resid0 = P_rhs - mesh0
    # consecutive triplets of one run (curvature rows)
    k1 = np.nonzero((P_run[:-2] == P_run[2:]))[0] + 1

    # --- unknowns: free vertices within one cell of a road sample ---
    touched = np.zeros(n * n, dtype=bool)
    touched[P_idx[~keepf[P_idx].all(1)].ravel()] = True
    t = touched.reshape(n, n)
    t2 = t.copy()
    t2[1:, :] |= t[:-1, :]
    t2[:-1, :] |= t[1:, :]
    t2[:, 1:] |= t[:, :-1]
    t2[:, :-1] |= t[:, 1:]
    free0 = t2.ravel() & ~keepf
    pinned = np.zeros(n * n)          # clamped changes, held fixed (see below)
    fixed = ~free0

    # --- the water stays wet ---
    # Every water cell in a triangle with a free vertex is a candidate; one
    # that a solve lifts above WET_UNDER under its water's level is held
    # there from then on (an active set: rounds below).
    ms = 10.0
    wj, wi = np.nonzero(wet)
    wx, wz = wi * ms - map_half, wj * ms - map_half
    widx, ww = _tri_weights(wx, wz, map_half, step, n)
    near_free = free0[widx].any(1)
    widx, ww = widx[near_free], ww[near_free]
    # ...or, where the 40 m grid already stood it over its water, no higher
    # than it stood: forcing those under dragged the banks down with them
    # (Roosevelt Way fell 19 m into the University Bridge's north end).
    wlev = np.maximum(level.ravel()[widx].min(1) - WET_UNDER, (H0[widx] * ww).sum(1))
    held = np.zeros(len(widx), dtype=bool)
    soft_n = int((soft.ravel() & free0).sum())

    for rnd in range(MAX_ROUNDS):
        free = free0 & ~fixed if rnd else free0
        col = np.full(n * n, -1, dtype=np.int64)
        col[free] = np.arange(int(free.sum()))
        nf = int(free.sum())
        base = H0 + pinned                       # the surface with clamps applied
        rows, cols, vals, rhs = [], [], [], []
        r0 = 0
        # absolute: the mesh under a sample at its DEM line
        pc = col[P_idx]
        m = pc >= 0
        rr = np.repeat(np.arange(ns)[:, None], 3, 1)
        wa = (P_w * (W_ABS * P_wt)[:, None])
        rows.append(rr[m] + r0)
        cols.append(pc[m])
        vals.append(wa[m])
        rhs.append((P_rhs - (base[P_idx] * P_w).sum(1)) * W_ABS * P_wt)
        r0 += ns
        # curvature: the second difference along the way at the DEM line's
        nk = len(k1)
        wc = W_CURV * P_wt[k1]
        for off, mul in ((-1, 1.0), (0, -2.0), (1, 1.0)):
            kk = k1 + off
            pc = col[P_idx[kk]]
            m = pc >= 0
            rows.append(np.repeat(np.arange(nk)[:, None], 3, 1)[m] + r0)
            cols.append(pc[m])
            vals.append((P_w[kk] * (mul * wc)[:, None])[m])
        mb = lambda kk: (base[P_idx[kk]] * P_w[kk]).sum(1)  # noqa: E731
        tc = P_rhs[k1 - 1] - 2 * P_rhs[k1] + P_rhs[k1 + 1]
        mc = mb(k1 - 1) - 2 * mb(k1) + mb(k1 + 1)
        rhs.append((tc - mc) * wc)
        r0 += nk
        # stay
        fv = np.nonzero(free)[0]
        rows.append(np.arange(nf) + r0)
        cols.append(col[fv])
        vals.append(np.full(nf, W_STAY))
        rhs.append(-pinned[fv] * W_STAY)
        r0 += nf
        # shape: 4-neighbour Laplacian of the change, centred on each free vertex
        jj, ii = fv // n, fv % n
        cnt = np.zeros(nf)
        lap_rhs = np.zeros(nf)
        for dj, di in ((-1, 0), (1, 0), (0, -1), (0, 1)):
            j2, i2 = jj + dj, ii + di
            ok = (j2 >= 0) & (j2 < n) & (i2 >= 0) & (i2 < n)
            cnt += ok
            nb = np.where(ok, j2 * n + i2, 0)
            c2 = np.where(ok, col[nb], -1)
            mm = c2 >= 0
            rows.append(np.arange(nf)[mm] + r0)
            cols.append(c2[mm])
            vals.append(np.full(int(mm.sum()), -W_SHAPE))
            # a pinned neighbour's change is a constant
            lap_rhs += np.where(ok & (c2 < 0), pinned[nb], 0) * W_SHAPE
        rows.append(np.arange(nf) + r0)
        cols.append(col[fv])
        vals.append(cnt * W_SHAPE)
        rhs.append(lap_rhs)
        r0 += nf
        # water held under its level
        hi = np.nonzero(held)[0]
        if len(hi):
            pc = col[widx[hi]]
            m = pc >= 0
            rows.append(np.repeat(np.arange(len(hi))[:, None], 3, 1)[m] + r0)
            cols.append(pc[m])
            vals.append((ww[hi] * W_WET)[m])
            rhs.append((wlev[hi] - (base[widx[hi]] * ww[hi]).sum(1)) * W_WET)
            r0 += len(hi)
        R = np.concatenate(rows)
        C = np.concatenate(cols)
        V = np.concatenate(vals)
        b = np.concatenate(rhs)
        x, iters = _cgls(R, C, V, b, nf, CG_ITERS)
        d = pinned.copy()
        d[free] += x
        # Nothing moves further than D_MAX: past it the vertex is pinned there
        # and the rest solve again around it.
        over = free & (np.abs(d) > D_MAX)
        wy = ((H0 + d)[widx] * ww).sum(1)
        dry = (wy > wlev + 0.02) & ~held
        if not over.any() and not dry.any():
            break
        pinned[over] = np.clip(d[over], -D_MAX, D_MAX)
        fixed |= over
        held |= dry

    H1 = H0 + d
    mesh1 = (H1[P_idx] * P_w).sum(1)
    resid1 = P_rhs - mesh1
    live = ~keepf[P_idx].all(1)          # samples off the shore
    resid0, resid1 = resid0[live], resid1[live]
    b0, hu0 = _breaks(H0, all_runs, map_half, step, n)
    b1, hu1 = _breaks(H1, all_runs, map_half, step, n)
    bt, hut = _breaks(None, all_runs, map_half, step, n, all_targets)
    ad = np.abs(d[free0])
    print(f"  streets graded: {len(all_runs)} runs, {ns} samples, {int(free0.sum())} vertices free, "
          f"{rnd + 1} rounds, CG {iters} iters, {int((np.abs(d) >= D_MAX - 1e-9).sum())} held at {D_MAX} m")
    wy = ((H0 + d)[widx] * ww).sum(1)
    wy0 = (H0[widx] * ww).sum(1)
    print(f"    shore: {soft_n} vertices free, {int(held.sum())} water cells held; of {len(widx)} near a free "
          f"vertex, raised over their water: {int((wy > np.maximum(wlev, wy0) + 0.05).sum())}")
    print(f"    road vs its DEM line: rms {np.sqrt((resid0 ** 2).mean()):.2f} -> {np.sqrt((resid1 ** 2).mean()):.2f} m, "
          f"over 1 m {int((np.abs(resid0) > 1).sum())} -> {int((np.abs(resid1) > 1).sum())}")
    print(f"    vertices moved: mean {ad.mean():.2f} m, p99 {np.percentile(ad, 99):.2f} m, max {ad.max():.2f} m; "
          f"over 2 m {int((ad > 2).sum())}")
    print(f"    along the streets: grade breaks > 8 % {b0} -> {b1}, humps > 1 m {hu0} -> {hu1} "
          f"(the DEM line itself: {bt}, {hut})")
    return H1.reshape(n, n)
