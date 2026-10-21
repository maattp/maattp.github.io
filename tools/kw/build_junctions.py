"""Waterloo Region's junction controls: signals, stops, roundabouts, crossings.

    tools/.venv/bin/python tools/kw/build_junctions.py

Reads tools/data/kw/kw.osm.pbf and writes apps/autokw/data/junctions.json,
which src/junctions.js matches onto the road graph (it has the geometry and a
class, never a node's tags). Everything is OSM's; nothing is invented here.

  sig   traffic signal INTERSECTIONS: highway=traffic_signals nodes on car
        ways, clustered (single linkage, 45 m) so a divided arterial's two or
        four signal nodes are one controller. Per cluster its centre, its
        member points, and `L`: the travel directions (unit x, z) arriving
        with a left-turn lane (turn:lanes[:forward|:backward] holding "left"
        on the way that arrives) -- those approaches get an advance arrow.
  stop  [x, z, jx, jz, ax, az, flags] every highway=stop (and give_way)
        sign: the sign's point, the
        junction node it controls (walked along its way to the nearest node
        shared with another car way, honouring direction=forward/backward,
        within 70 m), the travel direction arriving there (0, 0: unknown),
        flags 1 stop=all, 2 a give-way (yield) sign.
  rb    roundabouts: junction=roundabout|circular ways joined into rings;
        centre, mean radius, the most lanes on any piece, the class, and the
        ring's points. `mini`: highway=mini_roundabout nodes.
  xing  [x, z, dx, dz, flags] marked crossings on car ways: highway=crossing
        / crossing=* nodes with markings (zebra, ladder, lines, dots...), the
        road's direction there; flags 1 ladder/zebra bars (else two lines),
        2 a cycle crossing with elephant's feet (crossing:markings dots),
        4 at a signal.
"""

import json
import math
import os
import sys
from collections import defaultdict

import osmium

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from proj import to_world, MAP_HALF  # noqa: E402

HERE = os.path.dirname(os.path.abspath(__file__))
PBF = os.path.join(HERE, "data", "kw.osm.pbf")
OUT = os.path.join(HERE, "..", "..", "apps", "autokw", "data", "junctions.json")
LIM = MAP_HALF - 20

CAR = {"motorway", "motorway_link", "trunk", "trunk_link", "primary", "primary_link",
       "secondary", "secondary_link", "tertiary", "tertiary_link", "residential",
       "unclassified", "living_street"}


def inside(p):
    return abs(p[0]) <= LIM and abs(p[1]) <= LIM


def r1(v):
    return round(v, 1)


def unit(dx, dz):
    L = math.hypot(dx, dz) or 1e-9
    return [round(dx / L, 3), round(dz / L, 3)]


def has_left(v):
    return bool(v) and any("left" in s and "slight" not in s and "merge" not in s for s in str(v).split("|"))


def main():
    nodes = {}         # id -> (tags, x, z) for the tagged nodes we want
    ways = []          # (id, tags, ids, pts)
    fp = osmium.FileProcessor(PBF).with_locations()
    for o in fp:
        if isinstance(o, osmium.osm.Node):
            t = o.tags
            hw = t.get("highway")
            if hw in ("traffic_signals", "stop", "give_way", "mini_roundabout", "crossing") or "crossing" in t:
                x, z = to_world(o.location.lat, o.location.lon)
                if inside((x, z)):
                    nodes[o.id] = (dict(t), x, z)
            continue
        if not isinstance(o, osmium.osm.Way):
            continue
        t = o.tags
        if t.get("highway") not in CAR or t.get("area") == "yes":
            continue
        try:
            ids = [n.ref for n in o.nodes]
            pts = [to_world(n.location.lat, n.location.lon) for n in o.nodes]
        except osmium.InvalidLocationError:
            continue
        if not any(inside(p) for p in pts):
            continue
        ways.append((o.id, dict(t), ids, pts))

    # node -> [(way index, position)], and how many car ways meet at it
    on = defaultdict(list)
    for wi, (_, _, ids, _) in enumerate(ways):
        for i, n in enumerate(ids):
            on[n].append((wi, i))

    def is_junction(n):
        occ = on.get(n, [])
        if len({wi for wi, _ in occ}) >= 2:
            return True
        # a way through itself (a loop) or a closed ring's seam
        return len(occ) >= 3

    # --- signals --------------------------------------------------------------
    sig_pts = [(nid, x, z) for nid, (t, x, z) in nodes.items()
               if t.get("highway") == "traffic_signals" and nid in on
               and t.get("traffic_signals") not in ("pedestrian_crossing", "ramp_meter", "blinker", "emergency")]
    # single-linkage clusters within 45 m (grid hashed)
    R = 45.0
    cell = defaultdict(list)
    for k, (_, x, z) in enumerate(sig_pts):
        cell[(int(x // R), int(z // R))].append(k)
    parent = list(range(len(sig_pts)))

    def find(a):
        while parent[a] != a:
            parent[a] = parent[parent[a]]
            a = parent[a]
        return a
    for k, (_, x, z) in enumerate(sig_pts):
        cx, cz = int(x // R), int(z // R)
        for dx in (-1, 0, 1):
            for dz in (-1, 0, 1):
                for j in cell.get((cx + dx, cz + dz), []):
                    if j > k and (sig_pts[j][1] - x) ** 2 + (sig_pts[j][2] - z) ** 2 < R * R:
                        parent[find(j)] = find(k)
    groups = defaultdict(list)
    for k in range(len(sig_pts)):
        groups[find(k)].append(k)
    sig = []
    for ks in groups.values():
        pts = [(sig_pts[k][1], sig_pts[k][2]) for k in ks]
        cx = sum(p[0] for p in pts) / len(pts)
        cz = sum(p[1] for p in pts) / len(pts)
        lefts = []
        for k in ks:
            nid = sig_pts[k][0]
            for wi, i in on[nid]:
                _, t, ids, wp = ways[wi]
                ow = t.get("oneway")
                # arriving along the way's order (from i-1): forward lanes
                if i > 0 and ow != "-1":
                    tl = t.get("turn:lanes:forward") or (t.get("turn:lanes") if ow in ("yes", "1") or t.get("junction") else None)
                    if has_left(tl):
                        lefts.append(unit(wp[i][0] - wp[i - 1][0], wp[i][1] - wp[i - 1][1]))
                # arriving against it (from i+1): backward lanes
                if i + 1 < len(ids) and ow not in ("yes", "1"):
                    tl = t.get("turn:lanes:backward") or (t.get("turn:lanes") if ow == "-1" else None)
                    if has_left(tl):
                        lefts.append(unit(wp[i][0] - wp[i + 1][0], wp[i][1] - wp[i + 1][1]))
        sig.append({"x": r1(cx), "z": r1(cz), "p": [[r1(x), r1(z)] for x, z in pts], "L": lefts})

    # --- stop and give-way signs ----------------------------------------------
    stop = []
    for nid, (t, x, z) in nodes.items():
        hw = t.get("highway")
        if hw not in ("stop", "give_way") or nid not in on:
            continue
        d = (t.get("direction") or "").lower()
        best = None
        for wi, i in on[nid]:
            _, wt, ids, wp = ways[wi]
            if is_junction(nid):
                # the sign is ON the junction node: its arriving direction is
                # the way's, by `direction`, else unknown (0, 0)
                if d == "forward" and i > 0:
                    a = unit(wp[i][0] - wp[i - 1][0], wp[i][1] - wp[i - 1][1])
                elif d == "backward" and i + 1 < len(ids):
                    a = unit(wp[i][0] - wp[i + 1][0], wp[i][1] - wp[i + 1][1])
                else:
                    a = [0, 0]
                best = (0, x, z, a)
                break
            for step in ((1,) if d == "forward" else (-1,) if d == "backward" else (1, -1)):
                j, run = i, 0.0
                while 0 <= j + step < len(ids) and run < 70:
                    run += math.hypot(wp[j + step][0] - wp[j][0], wp[j + step][1] - wp[j][1])
                    j += step
                    if is_junction(ids[j]):
                        if best is None or run < best[0]:
                            best = (run, wp[j][0], wp[j][1], unit(wp[j][0] - wp[j - step][0], wp[j][1] - wp[j - step][1]))
                        break
        if best is None:
            continue
        fl = (1 if (t.get("stop") == "all" or d == "all") else 0) | (2 if hw == "give_way" else 0)
        stop.append([r1(x), r1(z), r1(best[1]), r1(best[2]), best[3][0], best[3][1], fl])

    # --- roundabouts ------------------------------------------------------------
    rws = [w for w in ways if w[1].get("junction") in ("roundabout", "circular")]
    radj = defaultdict(set)
    for k, w in enumerate(rws):
        for n in w[2]:
            radj[n].add(k)
    seen = set()
    rb = []
    for k in range(len(rws)):
        if k in seen:
            continue
        comp, st = [], [k]
        seen.add(k)
        while st:
            a = st.pop()
            comp.append(a)
            for n in rws[a][2]:
                for b in radj[n]:
                    if b not in seen:
                        seen.add(b)
                        st.append(b)
        # chain the pieces into one ring by their end nodes
        pieces = [rws[a] for a in comp]
        by_start = {p[2][0]: p for p in pieces}
        ring_ids, ring_pts = [], []
        start = pieces[0]
        cur, guard = start, 0
        while cur is not None and guard < 50:
            guard += 1
            ring_ids += cur[2][:-1]
            ring_pts += cur[3][:-1]
            nxt = by_start.get(cur[2][-1])
            if nxt is start or nxt is None:
                if nxt is None:
                    ring_ids.append(cur[2][-1])
                    ring_pts.append(cur[3][-1])
                break
            cur = nxt
        closed = len(pieces) == guard and by_start.get(cur[2][-1]) is start
        pts = ring_pts
        if len(pts) < 4:
            continue
        cx = sum(p[0] for p in pts) / len(pts)
        cz = sum(p[1] for p in pts) / len(pts)
        rad = sum(math.hypot(p[0] - cx, p[1] - cz) for p in pts) / len(pts)
        if rad > 80 or rad < 4:
            continue
        lanes = 1
        cls = "residential"
        order = ["residential", "unclassified", "tertiary", "secondary", "primary", "trunk"]
        for p in pieces:
            try:
                lanes = max(lanes, int(str(p[1].get("lanes", "1")).split(";")[0]))
            except ValueError:
                pass
            c = p[1]["highway"].replace("_link", "")
            if c in order and order.index(c) > order.index(cls):
                cls = c
        # signed area: < 0 in (x, z) with +z south is ... report the sense
        area = 0.0
        for i in range(len(pts)):
            a, b = pts[i], pts[(i + 1) % len(pts)]
            area += a[0] * b[1] - b[0] * a[1]
        rb.append({"x": r1(cx), "z": r1(cz), "r": r1(rad), "ln": min(lanes, 3), "cls": cls,
                   "closed": 1 if closed else 0, "cw": 1 if area > 0 else 0,
                   "name": next((p[1].get("name") for p in pieces if p[1].get("name")), ""),
                   "p": [[r1(x), r1(z)] for x, z in pts]})
    mini = [{"x": r1(x), "z": r1(z)} for nid, (t, x, z) in nodes.items()
            if t.get("highway") == "mini_roundabout" and nid in on]

    # --- crossings --------------------------------------------------------------
    sig_ids = {nid for nid, _, _ in sig_pts}
    xing = []
    for nid, (t, x, z) in nodes.items():
        if nid not in on:
            continue
        hw = t.get("highway")
        cr = t.get("crossing")
        if hw not in ("crossing", "traffic_signals") and cr is None:
            continue
        if hw == "traffic_signals" and cr is None:
            continue
        mk = (t.get("crossing:markings") or "").lower()
        ref = (t.get("crossing_ref") or "").lower()
        if mk in ("no", "surface") or cr in ("unmarked", "no", "informal"):
            continue
        if not mk:
            if ref.startswith("zebra") or ref.startswith("pxo") or cr == "zebra":
                mk = "zebra"
            elif cr in ("traffic_signals", "marked", "uncontrolled", "pedestrian_signals"):
                mk = "lines"
            else:
                continue
        if mk == "yes":
            mk = "lines"
        k = 1 if ("zebra" in mk or "ladder" in mk) else 2
        b = 1 if "dots" in mk else 0
        # the road's direction at the node: the first car way through it
        wi, i = on[nid][0]
        wp = ways[wi][3]
        a = wp[max(0, i - 1)]
        c = wp[min(len(wp) - 1, i + 1)]
        u = unit(c[0] - a[0], c[1] - a[1])
        xing.append([r1(x), r1(z), u[0], u[1], (1 if k == 1 else 0) | (2 * b) | (4 if (nid in sig_ids or cr == "traffic_signals") else 0)])

    data = {"sig": sig, "stop": stop, "rb": rb, "mini": mini, "xing": xing}
    with open(OUT, "w") as f:
        json.dump(data, f, separators=(",", ":"))
    print(f"signals {len(sig_pts)} nodes -> {len(sig)} intersections ({sum(1 for s in sig if s['L'])} with left lanes)")
    print(f"stops {sum(1 for s in stop if not s[6] & 2)} (all-way {sum(1 for s in stop if s[6] & 1)}), give-way {sum(1 for s in stop if s[6] & 2)}")
    print(f"roundabouts {len(rb)} (2+ lanes {sum(1 for r in rb if r['ln'] >= 2)}, open rings {sum(1 for r in rb if not r['closed'])}, cw {sum(r['cw'] for r in rb)}), mini {len(mini)}")
    print(f"crossings {len(xing)} (ladder/zebra {sum(1 for c in xing if c[4] & 1)}, cycle dots {sum(1 for c in xing if c[4] & 2)})")
    print(f"wrote {OUT} ({os.path.getsize(OUT) // 1024} KB)")


if __name__ == "__main__":
    main()
