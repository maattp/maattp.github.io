"""How each arterial is laid out across: lanes each way, a two-way left-turn lane, bike lanes.

    tools/.venv/bin/python tools/kw/build_artlanes.py

roads.bin keeps one number of an OSM way's cross-section, its half-width
(from `lanes`). What the arterials of Waterloo Region look like from the
driver's seat is in the rest of the tags, and KW tags them well:
`lanes:forward` / `lanes:backward`, `lanes:both_ways=1` +
`turn:lanes:both_ways=left` (the painted two-way left-turn lane down
Victoria St N, Weber St N, King St E, Hespeler Rd), `cycleway*=lane` (the
painted bike lanes on University Ave, Fischer-Hallman, Ira Needles, Columbia).

For every art / st edge of apps/autokw/data/roads.bin, the OSM primary /
secondary / tertiary way it was built from is found again by geometry: the
segment of the same name (or any, failing that) nearest the edge's midpoint
within 4 m and parallel to it (|cos| > 0.95). Its tags are turned into the
edge's own a -> b sense.

Writes apps/autokw/data/artlanes.bin:
    'AUTA', u16 version 1, u16 0, u32 edge count, u32 check (the sum of every
    edge's a + b, mod 2^32, as sidewalks.bin: a roads.bin rebuilt since makes
    the game ignore this file), then 2 bytes per edge:
    byte 0: bits 0-2 lanes driven a -> b, bits 3-5 lanes driven b -> a
            (0 = not tagged), bit 6 a two-way left-turn lane, bit 7 matched
    byte 1: bits 0-1 the +p side's bike lane (+p = (-dz, dx) of a -> b, the
            right of a -> b; 0 none, 1 a painted lane), bits 2-3 the -p side's

Re-run after build_roads.py (the edge indices are roads.bin's).
"""

import math
import os
import struct
import sys
from collections import defaultdict

import numpy as np
import osmium

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from proj import to_world, MAP_HALF  # noqa: E402
from build_sidewalks import load_roads, CLS_NAME, OUT, PBF  # noqa: E402

CELL = 20.0
HWYS = ("primary", "secondary", "tertiary")


def num(v):
    try:
        return int(float(str(v).split(";")[0]))
    except (TypeError, ValueError):
        return None


def way_attrs(t):
    """(fwd lanes, bwd lanes, twltl, bike right, bike left) in the WAY's sense."""
    ow = (t.get("oneway") or "no").lower()
    one = ow in ("yes", "true", "1", "-1", "reverse") or (t.get("junction") or "") == "roundabout"
    ln = num(t.get("lanes"))
    lf, lb = num(t.get("lanes:forward")), num(t.get("lanes:backward"))
    bw = num(t.get("lanes:both_ways")) or 0
    twltl = bw == 1 and "left" in (t.get("turn:lanes:both_ways") or "")
    if one:
        fwd, bwd = (ln or 0), 0
        if ow in ("-1", "reverse"):
            fwd, bwd = 0, fwd
    else:
        if lf is not None or lb is not None:
            fwd, bwd = lf or 0, lb or 0
        elif ln is not None and ln - bw >= 2 and (ln - bw) % 2 == 0:
            fwd = bwd = (ln - bw) // 2
        else:
            fwd = bwd = 0
        # A junction's approach counts its turn bays in lanes:forward /
        # backward (Victoria St N at Frederick: 4 + 2 for 30 m, 2 + 3 past
        # it). Traffic drives every lane it is given straight on, so a bay
        # counted as a lane was a through lane that ended at the junction
        # (two cars into one lane), and the centre line jogged 5 m to make
        # room. Only the lanes that go straight on count; a bay is drawn as
        # kerbside width. (`turn:lanes:*`: '' / none / through / merge_*.)
        thru = lambda v: sum(1 for x in v.split("|")
                             if x in ("", "none") or "through" in x or "merge" in x)
        tf, tb = t.get("turn:lanes:forward"), t.get("turn:lanes:backward")
        if tf and fwd:
            fwd = min(fwd, max(1, thru(tf)))
        if tb and bwd:
            bwd = min(bwd, max(1, thru(tb)))
    lane =lambda v: (v or "").split(";")[0] in ("lane", "opposite_lane")
    c, cb = t.get("cycleway"), t.get("cycleway:both")
    cr, cl = t.get("cycleway:right"), t.get("cycleway:left")
    br = lane(cr) or lane(cb) or lane(c)
    # on a one-way street, cycleway=lane is the lane on the right of the traffic
    bl = lane(cl) or lane(cb) or (lane(c) and not one)
    return fwd, bwd, twltl, br, bl


def main():
    segs = defaultdict(list)      # cell -> [(x0, z0, x1, z1, name, attrs)]
    nway = 0
    lim = MAP_HALF + 200
    for w in osmium.FileProcessor(PBF).with_locations():
        if not isinstance(w, osmium.osm.Way):
            continue
        t = w.tags
        if t.get("highway") not in HWYS:
            continue
        try:
            pts = [to_world(n.location.lat, n.location.lon) for n in w.nodes]
        except osmium.InvalidLocationError:
            continue
        if not any(abs(x) < lim and abs(z) < lim for x, z in pts):
            continue
        nway += 1
        at = way_attrs(t)
        nm = t.get("name") or t.get("ref") or ""
        for i in range(len(pts) - 1):
            (x0, z0), (x1, z1) = pts[i], pts[i + 1]
            L = math.hypot(x1 - x0, z1 - z0)
            if L < 0.05:
                continue
            n = max(1, int(L // CELL) + 1)
            cells = set()
            for k in range(n + 1):
                x, z = x0 + (x1 - x0) * k / n, z0 + (z1 - z0) * k / n
                cells.add((int(x // CELL), int(z // CELL)))
            for c in cells:
                segs[c].append((x0, z0, x1, z1, nm, at))
    print(f"{nway} OSM primary/secondary/tertiary ways")

    nodes, edges = load_roads()
    buf = open(os.path.join(OUT, "roads.bin"), "rb").read()
    # names, to prefer the way of the edge's own name
    o = 16 + len(nodes) * 12 + len(edges) * 16
    names = []
    while o < len(buf):
        ln, = struct.unpack_from("<H", buf, o)
        names.append(buf[o + 2:o + 2 + ln].decode("utf-8"))
        o += 2 + ln
    ne = len(edges)
    NX = nodes["x"].astype(np.float64) / 10
    NZ = nodes["z"].astype(np.float64) / 10
    out = np.zeros((ne, 2), dtype=np.uint8)
    stats = defaultdict(float)
    for ei in range(ne):
        e = edges[ei]
        cls = CLS_NAME[e["cls"]] if e["cls"] < len(CLS_NAME) else "res"
        if cls not in ("art", "st"):
            continue
        ax, az, bx, bz = NX[e["a"]], NZ[e["a"]], NX[e["b"]], NZ[e["b"]]
        L = math.hypot(bx - ax, bz - az)
        if L < 1:
            continue
        dx, dz = (bx - ax) / L, (bz - az) / L
        nm = names[e["name"]] if e["name"] < len(names) else ""
        best, bd = None, 1e9
        for s in (0.5, 0.25, 0.75):
            mx, mz = ax + (bx - ax) * s, az + (bz - az) * s
            for (x0, z0, x1, z1, wn, at) in segs.get((int(mx // CELL), int(mz // CELL)), ()):
                sx, sz = x1 - x0, z1 - z0
                l2 = sx * sx + sz * sz
                cos = (sx * dx + sz * dz) / math.sqrt(l2)
                if abs(cos) < 0.95:
                    continue
                r = max(0.0, min(1.0, ((mx - x0) * sx + (mz - z0) * sz) / l2))
                d = math.hypot(x0 + sx * r - mx, z0 + sz * r - mz)
                if d > 4:
                    continue
                d += 0 if wn == nm else 3
                if d < bd:
                    bd, best = d, (cos > 0, at)
            if best:
                break
        stats[cls + " edges"] += L
        if not best:
            continue
        same, (fwd, bwd, twltl, br, bl) = best
        if not same:
            fwd, bwd, br, bl = bwd, fwd, bl, br
        out[ei, 0] = min(7, fwd) | (min(7, bwd) << 3) | (64 if twltl else 0) | 128
        out[ei, 1] = (1 if br else 0) | ((1 if bl else 0) << 2)
        stats[cls + " matched"] += L
        if fwd and bwd and fwd + bwd >= 4:
            stats[cls + " two-way multi-lane"] += L
        if twltl:
            stats[cls + " twltl"] += L
        if br or bl:
            stats[cls + " bike lane (either side)"] += L
    for k in sorted(stats):
        print(f"  {k:32s} {stats[k] / 1000:7.1f} km")

    check = int((edges["a"].astype(np.uint64) + edges["b"].astype(np.uint64)).sum() % (1 << 32))
    blob = struct.pack("<4sHHII", b"AUTA", 1, 0, ne, check) + out.tobytes()
    p = os.path.join(OUT, "artlanes.bin")
    open(p, "wb").write(blob)
    print(f"wrote {p} ({len(blob) / 1000:.0f} KB, {ne} edges)")


if __name__ == "__main__":
    main()
