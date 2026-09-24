"""The beaches, for the props that make them read as beaches -> data/beaches.json.

    python3 tools/build_beaches.py        # after osm_extract.py (reads raw_green.json)

OSM's natural=beach polygons, as the lot layer paints them (build_lots.py): each
with its name (street-end beaches carry the street's), its outline simplified to
~1.5 m, and its area. landmarks.js's beachProps lays umbrellas, towels,
driftwood, fire rings, volleyball nets and lifeguard chairs on the dry sand of
each, by what the beach is (see BEACH_KIT there).
"""

import json
import math
import os

HERE = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.join(HERE, "data")
OUT = os.environ.get("AUTO_DATA_OUT") or os.path.join(HERE, "..", "apps", "auto", "data")
MIN_M2 = 200   # below this it is a street end with a few square metres of gravel


def area(pts):
    s = 0.0
    for i in range(len(pts)):
        x0, z0 = pts[i]
        x1, z1 = pts[(i + 1) % len(pts)]
        s += x0 * z1 - x1 * z0
    return abs(s) / 2


def simplify(pts, tol):
    """Douglas-Peucker on a closed ring."""
    if len(pts) < 4:
        return pts

    def dp(a, b, seg):
        if len(seg) < 3:
            return [seg[0]]
        (ax, az), (bx, bz) = seg[0], seg[-1]
        L = math.hypot(bx - ax, bz - az) or 1e-9
        best, bi = -1, 0
        for i in range(1, len(seg) - 1):
            px, pz = seg[i]
            d = abs((bx - ax) * (az - pz) - (ax - px) * (bz - az)) / L
            if d > best:
                best, bi = d, i
        if best <= tol:
            return [seg[0]]
        return dp(a, bi, seg[:bi + 1]) + dp(bi, b, seg[bi:])
    half = len(pts) // 2
    return dp(0, half, pts[:half + 1]) + dp(half, len(pts), pts[half:] + [pts[0]])


def main():
    green = json.load(open(os.path.join(DATA, "raw_green.json")))["green"]
    out = []
    for p in green:
        if p.get("k") != "beach":
            continue
        a = area(p["o"])
        if a < MIN_M2:
            continue
        ring = p["o"][:-1] if p["o"][0] == p["o"][-1] else p["o"]
        ring = simplify([[round(x, 1), round(z, 1)] for x, z in ring], 1.5)
        out.append({"name": p.get("n") or "", "area": round(a), "o": ring})
    out.sort(key=lambda b: -b["area"])
    with open(os.path.join(OUT, "beaches.json"), "w") as f:
        json.dump({"source": "OpenStreetMap contributors (ODbL), natural=beach", "beaches": out}, f, separators=(",", ":"))
    print(f"beaches.json: {len(out)} beaches, {sum(b['area'] for b in out) / 1e6:.2f} km2, "
          f"{os.path.getsize(os.path.join(OUT, 'beaches.json')) / 1e3:.0f} KB")


if __name__ == "__main__":
    main()
