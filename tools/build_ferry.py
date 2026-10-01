"""Washington State Ferries' Seattle-Bainbridge route -> apps/auto/data/ferry.json.

    tools/.venv/bin/python tools/build_ferry.py      (after extract_ferry.py)

From tools/data/raw_ferry.json (OSM route=ferry way 332476322, "Seattle-Bainbridge
Ferry", Colman Dock's slip 3 to Winslow's slip 2) and raw_roads.json (each slip's
own road, the trestle out to the transfer span, which gives its axis).

A slip is its road's end over the water and the direction the boat lies from
it (the road's last segment carried on). The path written is where the BOAT'S
CENTRE runs: from half a hull out of one slip to half a hull out of the other,
dead straight along each slip's axis for the first and last 350 m (a ferry
enters and leaves its slip in line with it), the OSM route between, its
corners rounded by ~600 m tangent arcs (fillets), resampled every 5 m.

Also the slips' dolphins (man_made=dolphin, OSM) near each end, and the
terminals' names.
"""

import json
import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from proj import MAP_HALF  # noqa: E402

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.environ.get("AUTO_DATA_OUT") or os.path.join(HERE, "..", "apps", "auto", "data")
ROUTE_ID = 332476322
# Jumbo Mark II: 460 ft 2 in (140.3 m) overall, plus the ~0.6 m the boat
# lies off the transfer span's apron
HALF = 140.3 / 2 + 0.6
STRAIGHT = 350.0
STEP = 5.0
MIN_R = 450.0
FILLET_R = 600.0


def norm(dx, dz):
    L = math.hypot(dx, dz) or 1.0
    return dx / L, dz / L


def slip_of(roads, end):
    """The road ending at `end`: its last segment gives the slip's axis."""
    best = None
    for r in roads:
        P = r["p"]
        for a, b in ((P[-2], P[-1]), (P[1], P[0])):
            d = math.hypot(b[0] - end[0], b[1] - end[1])
            if d < 3 and (best is None or d < best[0]):
                best = (d, a, b)
    if best is None:
        raise SystemExit(f"no slip road ends at {end}")
    _, a, b = best
    # step back along the road for a longer baseline (its last piece can be short)
    ox, oz = norm(b[0] - a[0], b[1] - a[1])
    return {"x": round(b[0], 2), "z": round(b[1], 2), "dx": round(ox, 5), "dz": round(oz, 5)}


def rdp(pts, eps):
    """Ramer-Douglas-Peucker: the route's corners, without its wobble."""
    if len(pts) < 3:
        return list(pts)
    a, b = pts[0], pts[-1]
    dx, dz = b[0] - a[0], b[1] - a[1]
    L = math.hypot(dx, dz) or 1.0
    i, dm = 0, -1.0
    for k in range(1, len(pts) - 1):
        d = abs((pts[k][0] - a[0]) * dz - (pts[k][1] - a[1]) * dx) / L
        if d > dm:
            i, dm = k, d
    if dm < eps:
        return [a, b]
    return rdp(pts[:i + 1], eps)[:-1] + rdp(pts[i:], eps)


def resample(pts, step):
    cum = [0.0]
    for a, b in zip(pts, pts[1:]):
        cum.append(cum[-1] + math.hypot(b[0] - a[0], b[1] - a[1]))
    L = cum[-1]
    out, j = [], 0
    n = max(1, int(round(L / step)))
    for k in range(n + 1):
        s = L * k / n
        while j < len(cum) - 2 and cum[j + 1] < s:
            j += 1
        t = (s - cum[j]) / ((cum[j + 1] - cum[j]) or 1)
        a, b = pts[j], pts[j + 1]
        out.append((a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t))
    return out, L


def min_radius(pts):
    worst = 1e9
    for a, b, c in zip(pts, pts[1:], pts[2:]):
        h1 = math.atan2(b[1] - a[1], b[0] - a[0])
        h2 = math.atan2(c[1] - b[1], c[0] - b[0])
        d = abs((h2 - h1 + math.pi) % (2 * math.pi) - math.pi)
        if d > 1e-6:
            worst = min(worst, math.hypot(c[0] - a[0], c[1] - a[1]) / 2 / d)
    return worst


def main():
    raw = json.load(open(os.path.join(HERE, "data", "raw_ferry.json")))
    roads = json.load(open(os.path.join(HERE, "data", "raw_roads.json")))["roads"]
    route = next(r for r in raw["routes"] if r["id"] == ROUTE_ID)
    P = route["p"]
    sea = slip_of(roads, P[0])
    bi = slip_of(roads, P[-1])
    sea["name"], sea["short"] = "Seattle (Colman Dock)", "Seattle"
    bi["name"], bi["short"] = "Bainbridge Island (Winslow)", "Bainbridge"
    # the boat's centre: half a hull out of each slip, straight along its axis
    A0 = (sea["x"] + sea["dx"] * HALF, sea["z"] + sea["dz"] * HALF)
    A1 = (A0[0] + sea["dx"] * STRAIGHT, A0[1] + sea["dz"] * STRAIGHT)
    B0 = (bi["x"] + bi["dx"] * HALF, bi["z"] + bi["dz"] * HALF)
    B1 = (B0[0] + bi["dx"] * STRAIGHT, B0[1] + bi["dz"] * STRAIGHT)
    # the OSM route between, from where it has left each straight
    def far(p, q, d):
        return math.hypot(p[0] - q[0], p[1] - q[1]) > d
    mid = [tuple(p) for p in P if far(p, (sea["x"], sea["z"]), STRAIGHT + HALF + 150) and far(p, (bi["x"], bi["z"]), STRAIGHT + HALF + 150)]
    ctrl = [A0, A1] + rdp(mid, 60.0) + [B1, B0]
    # Every corner rounded by a tangent arc (a fillet) of FILLET_R, less where
    # the legs are too short for it: continuous heading, straights kept.
    # (Smoothing the samples instead converges to straight lines between the
    # pinned straights and kinks where they start.)
    pts = [ctrl[0]]
    for i in range(1, len(ctrl) - 1):
        P0, V, P2 = pts[-1], ctrl[i], ctrl[i + 1]
        ux, uz = norm(V[0] - P0[0], V[1] - P0[1])
        wx, wz = norm(P2[0] - V[0], P2[1] - V[1])
        th = math.acos(max(-1.0, min(1.0, ux * wx + uz * wz)))
        if th < 1e-4:
            pts.append(V)
            continue
        Lin = math.hypot(V[0] - P0[0], V[1] - P0[1])
        Lout = math.hypot(P2[0] - V[0], P2[1] - V[1]) * (0.5 if i + 1 < len(ctrl) - 1 else 1.0)
        t = min(FILLET_R * math.tan(th / 2), Lin * 0.95, Lout * 0.95)
        R = t / math.tan(th / 2)
        s0 = (V[0] - ux * t, V[1] - uz * t)
        side = 1 if ux * wz - uz * wx > 0 else -1
        cx, cz = s0[0] - uz * R * side, s0[1] + ux * R * side
        a0 = math.atan2(s0[1] - cz, s0[0] - cx)
        n = max(2, int(R * th / 2))
        for k in range(n + 1):
            a = a0 + side * th * k / n
            pts.append((cx + math.cos(a) * R, cz + math.sin(a) * R))
    pts.append(ctrl[-1])
    pts, L = resample(pts, STEP)
    r = min_radius(pts)
    inside = all(abs(x) < MAP_HALF and abs(z) < MAP_HALF for x, z in pts)
    print(f"route {L:.0f} m, {len(pts)} points, tightest bend ~{r:.0f} m radius, inside the map {inside}")
    if r < MIN_R * 0.5:
        print("  (tight: check the route)")
    dol = []
    for d in raw["dolphins"]:
        if "p" in d:
            cx = sum(q[0] for q in d["p"]) / len(d["p"])
            cz = sum(q[1] for q in d["p"]) / len(d["p"])
        else:
            cx, cz = d["x"], d["z"]
        for s in (sea, bi):
            if math.hypot(cx - s["x"], cz - s["z"]) < 90:
                dol.append([round(cx, 1), round(cz, 1)])
    out = {"route": {"name": route["t"].get("name"), "operator": route["t"].get("operator"), "duration": route["t"].get("duration")},
           "slips": {"sea": sea, "bi": bi}, "len": round(L, 1),
           "path": [[round(x, 2), round(z, 2)] for x, z in pts], "dolphins": dol}
    with open(os.path.join(OUT, "ferry.json"), "w") as f:
        json.dump(out, f, separators=(",", ":"))
    print("slips", sea, bi, len(dol), "dolphins")
    print("wrote", os.path.getsize(os.path.join(OUT, "ferry.json")) // 1024, "KB")


if __name__ == "__main__":
    main()
