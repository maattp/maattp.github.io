"""Diagnostics for the three road complaints: blocked roads, junk on the
carriageway, and whether you can actually drive I-5 end to end.

Runs against the built assets, so it is seconds rather than a browser session.
"""

import json
import math
import os
import struct
import sys
from collections import defaultdict, deque

import numpy as np
from PIL import Image

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from proj import MAP_HALF  # noqa: E402

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "apps", "auto", "data")
CLS_NAME = ["hwy", "art", "st", "res", "ramp"]
F_ELEV, F_TUNNEL = 1, 2
WALK = {"st": 2.6, "art": 3.2, "res": 2.6, "hwy": 0.0, "ramp": 0.0}


def load_roads():
    buf = open(os.path.join(OUT, "roads.bin"), "rb").read()
    magic, ver, ncount, nn, ne = struct.unpack_from("<4sHHII", buf, 0)
    assert magic == b"AUTR"
    o = 16
    nodes = np.frombuffer(buf, dtype=np.dtype([
        ("x", "<i4"), ("z", "<i4"), ("y", "<i2"), ("elev", "u1"), ("pad", "u1")]),
        count=nn, offset=o)
    o += nn * 12
    edges = np.frombuffer(buf, dtype=np.dtype([
        ("a", "<u4"), ("b", "<u4"), ("cls", "u1"), ("flags", "u1"),
        ("hw", "<u2"), ("name", "<u2"), ("pad", "<u2")]), count=ne, offset=o)
    o += ne * 16
    names = []
    for _ in range(ncount):
        ln = struct.unpack_from("<H", buf, o)[0]
        o += 2
        names.append(buf[o:o + ln].decode("utf-8"))
        o += ln
    return nodes, edges, names


def load_buildings():
    buf = open(os.path.join(OUT, "buildings.bin"), "rb").read()
    magic, ver, nx, nz, pad = struct.unpack_from("<4sHHHH", buf, 0)
    assert magic == b"AUTB"
    dl = nx * nz + 1
    dirs = struct.unpack_from(f"<{dl}I", buf, 12)
    base = 12 + dl * 4
    out = []
    CHUNK, MARGIN = 400, 200.0
    for cj in range(nz):
        for ci in range(nx):
            k = cj * nx + ci
            ox = -MAP_HALF + ci * CHUNK - MARGIN
            oz = -MAP_HALF + cj * CHUNK - MARGIN
            for o in range(dirs[k], dirs[k + 1], 12):
                qx, qz, w, d, h, r, cls = struct.unpack_from("<HHHHHBB", buf, base + o)
                out.append((ox + qx / 10, oz + qz / 10, w / 20, d / 20,
                            r * math.pi / 256, h / 20, cls))
    return out


def dist_to_seg(px, pz, ax, az, bx, bz):
    dx, dz = bx - ax, bz - az
    L2 = dx * dx + dz * dz
    t = 0.0 if L2 < 1e-9 else max(0.0, min(1.0, ((px - ax) * dx + (pz - az) * dz) / L2))
    qx, qz = ax + dx * t, az + dz * t
    return math.hypot(px - qx, pz - qz), qx, qz


def main():
    nodes, edges, names = load_roads()
    print(f"{len(nodes)} nodes, {len(edges)} edges, {len(names)} names\n")

    # ---- 1. buildings standing in the carriageway --------------------------
    CELL = 60.0
    grid = defaultdict(list)
    segs = []
    for e in edges:
        if e["flags"] & (F_ELEV | F_TUNNEL):
            continue
        a, b = nodes[e["a"]], nodes[e["b"]]
        ax, az, bx, bz = a["x"] / 10, a["z"] / 10, b["x"] / 10, b["z"] / 10
        hw = e["hw"] / 100
        si = len(segs)
        segs.append((ax, az, bx, bz, hw, CLS_NAME[e["cls"]]))
        x0, x1 = min(ax, bx) - hw, max(ax, bx) + hw
        z0, z1 = min(az, bz) - hw, max(az, bz) + hw
        for cx in range(int(x0 // CELL), int(x1 // CELL) + 1):
            for cz in range(int(z0 // CELL), int(z1 // CELL) + 1):
                grid[(cx, cz)].append(si)

    blds = load_buildings()
    worst = []
    n_over = 0
    depth_hist = defaultdict(int)
    for (bx, bz, w, d, rot, h, cls) in blds:
        hw2, hd2 = w / 2, d / 2
        rad = math.hypot(hw2, hd2)
        ux, uz = math.cos(rot), math.sin(rot)
        vx, vz = -math.sin(rot), math.cos(rot)
        cx0, cz0 = int((bx - rad) // CELL), int((bz - rad) // CELL)
        cx1, cz1 = int((bx + rad) // CELL), int((bz + rad) // CELL)
        deep = 0.0
        which = None
        for cx in range(cx0, cx1 + 1):
            for cz in range(cz0, cz1 + 1):
                for si in grid.get((cx, cz), ()):
                    ax, az, sbx, sbz, shw, scls = segs[si]
                    dd, qx, qz = dist_to_seg(bx, bz, ax, az, sbx, sbz)
                    if dd > rad + shw:
                        continue
                    # support function of the box along the line to the road
                    if dd < 1e-6:
                        reach = rad
                    else:
                        nx_, nz_ = (bx - qx) / dd, (bz - qz) / dd
                        reach = abs(hw2 * (ux * nx_ + uz * nz_)) + abs(hd2 * (vx * nx_ + vz * nz_))
                    pen = shw - (dd - reach)      # how far the box eats into the road
                    if pen > deep:
                        deep, which = pen, scls
        if deep > 0.5:
            n_over += 1
            depth_hist[min(int(deep), 20)] += 1
            worst.append((deep, bx, bz, w, d, which))
    worst.sort(reverse=True)
    print(f"--- buildings standing in a carriageway ---")
    print(f"  {n_over} of {len(blds)} ({n_over/len(blds)*100:.1f}%) overlap a road by >0.5 m")
    print(f"  worst 8:")
    for deep, bx, bz, w, d, c in worst[:8]:
        print(f"    {deep:5.1f} m into a {c:4s} at ({bx:7.0f},{bz:7.0f})  box {w:.0f}x{d:.0f} m")
    over3 = sum(v for k, v in depth_hist.items() if k >= 3)
    print(f"  {over3} overlap by more than 3 m (a lane and a half) -- these are the blockers")

    # ---- 2. is I-5 drivable end to end? ------------------------------------
    print(f"\n--- named through routes ---")
    by_name = defaultdict(list)
    for ei, e in enumerate(edges):
        if e["name"] < len(names):
            by_name[names[e["name"]]].append(ei)
    adj = defaultdict(list)
    for ei, e in enumerate(edges):
        adj[int(e["a"])].append(ei)
        adj[int(e["b"])].append(ei)

    for route in ["I 5", "I 90", "WA 520", "WA 99", "Aurora Avenue North",
                  "Alaskan Way", "15th Avenue Northwest", "East Marginal Way South"]:
        eids = by_name.get(route)
        if not eids:
            cand = [n for n in by_name if route.split()[0].lower() in n.lower()]
            print(f"  {route:24s} NOT FOUND (similar: {cand[:3]})")
            continue
        ns = set()
        for ei in eids:
            ns.add(int(edges[ei]["a"]))
            ns.add(int(edges[ei]["b"]))
        # connected components *within the route*
        seen, comps = set(), []
        for s in ns:
            if s in seen:
                continue
            q, cur = deque([s]), []
            seen.add(s)
            while q:
                i = q.popleft()
                cur.append(i)
                for ei in adj[i]:
                    if ei not in eids and edges[ei]["name"] != edges[eids[0]]["name"]:
                        continue
                    o = int(edges[ei]["b"]) if int(edges[ei]["a"]) == i else int(edges[ei]["a"])
                    if o in ns and o not in seen:
                        seen.add(o)
                        q.append(o)
            comps.append(cur)
        comps.sort(key=len, reverse=True)
        zs = [nodes[i]["z"] / 10 for i in ns]
        xs = [nodes[i]["x"] / 10 for i in ns]
        # the gap that matters: between the two biggest pieces
        gap = None
        if len(comps) > 1:
            A = [(nodes[i]["x"] / 10, nodes[i]["z"] / 10) for i in comps[0]]
            B = [(nodes[i]["x"] / 10, nodes[i]["z"] / 10) for i in comps[1]]
            gap = min(math.hypot(a[0] - b[0], a[1] - b[1]) for a in A for b in B)
        print(f"  {route:24s} {len(eids):5d} edges, {len(ns):5d} nodes, "
              f"{len(comps):3d} pieces (largest {len(comps[0])}), "
              f"z {min(zs):6.0f}..{max(zs):6.0f}"
              + (f", nearest gap {gap:.0f} m" if gap else ""))

    # ---- 3. how much green sits on a carriageway ---------------------------
    surf = np.asarray(Image.open(os.path.join(OUT, "surface.png")).convert("RGB"))
    green = surf[:, :, 1] > 0
    on_road_green = 0
    total = 0
    for (ax, az, bx, bz, hw, cls) in segs[::7]:      # sample every 7th segment
        for t in (0.25, 0.5, 0.75):
            px, pz = ax + (bx - ax) * t, az + (bz - az) * t
            i = int(round((px + MAP_HALF) / 10))
            j = int(round((pz + MAP_HALF) / 10))
            if 0 <= i < green.shape[1] and 0 <= j < green.shape[0]:
                total += 1
                if green[j, i]:
                    on_road_green += 1
    print(f"\n--- park/green mask over carriageways ---")
    print(f"  {on_road_green}/{total} sampled road centres ({on_road_green/max(1,total)*100:.1f}%) "
          f"sit inside the green mask -- that is where trees and grass land on the road")


if __name__ == "__main__":
    main()
