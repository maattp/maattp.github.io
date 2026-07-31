"""Turn the extracted OSM ways into the game's road graph.

OSM is already a planar graph -- every ground-level crossing shares a node, by
mapping convention -- so almost everything citygen.js used to do (planarize,
stitch, dedupeGrid, district grid conflict resolution) is unnecessary here. What
is left is clipping, simplification, and giving each node a height.

Writes apps/auto/data/roads.bin (binary, see PACKING below) and prints the
quality assertions that used to live in citygen's stats block.
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

HERE = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.join(HERE, "data")
OUT = os.path.join(HERE, "..", "apps", "auto", "data")

HF_STEP, HF_N = 40, (MAP_HALF * 2) // 40 + 1
MASK_STEP, MASK_N = 10, (MAP_HALF * 2) // 10 + 1

RIM = MAP_HALF - 40          # matches geo.clampToMap: the drivable rim
SIMPLIFY = 1.0               # metres of Douglas-Peucker tolerance
MAX_SEG = 50.0               # split long straights, so node spacing stays game-like
MIN_SEG = 4.0                # citygen's addEdge drops slivers below this anyway

# OSM highway= -> the game's five classes.
CLS = {
    "motorway": "hwy", "trunk": "hwy",
    "motorway_link": "ramp", "trunk_link": "ramp",
    "primary_link": "ramp", "secondary_link": "ramp", "tertiary_link": "ramp",
    "primary": "art", "secondary": "art",
    "tertiary": "st",
    "residential": "res", "unclassified": "res", "living_street": "res",
    "service": "res",   # alleys only -- the extractor drops every other service road
}
ALLEY_HW = 3.6
CLASS_HW = {"hwy": 15.0, "art": 9.5, "st": 6.5, "res": 5.5, "ramp": 5.5}
# Narrowest a class is allowed to get once lanes have had their say. A motorway
# carriageway is only ever half a freeway, so its floor is lower than the old
# whole-freeway CLASS_HW would suggest.
CLASS_MIN_HW = {"hwy": 7.0, "art": 6.0, "st": 5.0, "res": 4.2, "ramp": 3.4}
CLASS_ID = {"hwy": 0, "art": 1, "st": 2, "res": 3, "ramp": 4}
DEFAULT_LANES = {"hwy": 6, "art": 4, "st": 3, "res": 2, "ramp": 1}

F_ELEV, F_TUNNEL, F_ONEWAY, F_ONEWAY_REV = 1, 2, 4, 8


# ---------------------------------------------------------------------------

def load_rasters():
    h = np.asarray(Image.open(os.path.join(OUT, "height.png")).convert("RGB"), dtype=np.float32)
    height = (h[:, :, 0] * 256.0 + h[:, :, 1]) / 10.0 - 100.0
    w = np.asarray(Image.open(os.path.join(OUT, "surface.png")).convert("RGB"))
    return height, w[:, :, 0] > 0


def terrain_at(height, x, z):
    """Bilinear. This NO LONGER matches geo.terrainHeight().

    terrainHeight() now interpolates the way the terrain mesh is triangulated,
    which was the fix for grass showing through the road; bilinear differs from
    it by (a + d - b - c) / 4, up to 6.63 m on Seattle's grades. Node heights
    baked here are therefore corrected at load time in cityGenerator, which is
    where the runtime and the drawn geometry can be guaranteed to agree.

    Only the node heights are affected -- anything using this for a coarse
    land/water or grade decision is fine. If you make this triangulated to match,
    the load-time correction becomes a no-op rather than a conflict.
    """
    fx = min(max((x + MAP_HALF) / HF_STEP, 0), HF_N - 1.001)
    fz = min(max((z + MAP_HALF) / HF_STEP, 0), HF_N - 1.001)
    i, j = int(fx), int(fz)
    tx, tz = fx - i, fz - j
    return float(
        height[j, i] * (1 - tx) * (1 - tz) + height[j, i + 1] * tx * (1 - tz)
        + height[j + 1, i] * (1 - tx) * tz + height[j + 1, i + 1] * tx * tz
    )


def is_water(wet, x, z):
    i = int(round((x + MAP_HALF) / MASK_STEP))
    j = int(round((z + MAP_HALF) / MASK_STEP))
    if not (0 <= i < MASK_N and 0 <= j < MASK_N):
        return False
    return bool(wet[j, i])


# ---------------------------------------------------------------------------
# Geometry helpers
# ---------------------------------------------------------------------------

def clip_runs(pts):
    """Split a polyline into the runs that lie inside the map, clipping at the rim."""
    runs, cur = [], []
    inside = lambda p: abs(p[0]) <= RIM and abs(p[1]) <= RIM  # noqa: E731

    def cross(a, b):
        """Point where segment a->b crosses the rim, walking from a."""
        lo, hi = 0.0, 1.0
        for _ in range(24):
            m = (lo + hi) / 2
            p = (a[0] + (b[0] - a[0]) * m, a[1] + (b[1] - a[1]) * m)
            if inside(p):
                lo = m
            else:
                hi = m
        return (a[0] + (b[0] - a[0]) * lo, a[1] + (b[1] - a[1]) * lo)

    for i, p in enumerate(pts):
        if inside(p):
            if not cur and i > 0:
                cur.append(cross(p, pts[i - 1]))
            cur.append(p)
        else:
            if cur:
                cur.append(cross(pts[i - 1], p))
                runs.append(cur)
                cur = []
    if cur:
        runs.append(cur)
    return [r for r in runs if len(r) >= 2]


def simplify(pts, tol):
    """Douglas-Peucker, endpoints preserved."""
    if len(pts) <= 2:
        return pts
    keep = [False] * len(pts)
    keep[0] = keep[-1] = True
    stack = [(0, len(pts) - 1)]
    while stack:
        a, b = stack.pop()
        if b <= a + 1:
            continue
        ax, az = pts[a]
        bx, bz = pts[b]
        dx, dz = bx - ax, bz - az
        L = math.hypot(dx, dz)
        best, bi = -1.0, -1
        for i in range(a + 1, b):
            px, pz = pts[i]
            if L < 1e-9:
                d = math.hypot(px - ax, pz - az)
            else:
                d = abs((px - ax) * dz - (pz - az) * dx) / L
            if d > best:
                best, bi = d, i
        if best > tol:
            keep[bi] = True
            stack.append((a, bi))
            stack.append((bi, b))
    return [p for p, k in zip(pts, keep) if k]


def densify(pts, max_seg):
    """Insert vertices so no segment is longer than max_seg."""
    out = [pts[0]]
    for i in range(1, len(pts)):
        ax, az = pts[i - 1]
        bx, bz = pts[i]
        L = math.hypot(bx - ax, bz - az)
        n = max(1, int(math.ceil(L / max_seg)))
        for k in range(1, n + 1):
            t = k / n
            out.append((ax + (bx - ax) * t, az + (bz - az) * t))
    return out


# ---------------------------------------------------------------------------

class Builder:
    def __init__(self, height, wet):
        self.height = height
        self.wet = wet
        self.nodes = []                 # [x, z, y, elev]
        self.index = {}                 # rounded coord -> node id
        self.edges = []                 # [a, b, cls, flags, hw, name_id]
        self.names = {}
        self.name_list = []

    def name_id(self, name):
        if not name:
            return 0xFFFF
        if name not in self.names:
            self.names[name] = len(self.name_list)
            self.name_list.append(name)
        return min(self.names[name], 0xFFFE)

    def node(self, x, z, elev):
        # 0.1 m keying is what recovers OSM's shared intersection nodes: two ways
        # meeting at a junction reference the same OSM node, so they project to
        # bit-identical coordinates. Bridges never share coordinates with what
        # they cross, which is exactly the distinction we want.
        #
        # `elev` is deliberately NOT part of the key. A bridge and its approach
        # ramp share an OSM node, so keying on it would split that junction into
        # two nodes at the same spot and leave every deck disconnected from the
        # street network. Which nodes are really on a deck is decided afterwards,
        # from the edges: a node is elevated only if everything meeting it is.
        k = (round(x, 1), round(z, 1))
        i = self.index.get(k)
        if i is not None:
            return i
        self.nodes.append([x, z, 0.0, False])
        self.index[k] = len(self.nodes) - 1
        return len(self.nodes) - 1

    def edge(self, a, b, cls, flags, hw, name):
        if a == b:
            return
        ax, az = self.nodes[a][0], self.nodes[a][1]
        bx, bz = self.nodes[b][0], self.nodes[b][1]
        if math.hypot(bx - ax, bz - az) < MIN_SEG:
            return
        self.edges.append([a, b, CLASS_ID[cls], flags, hw, name])


def half_width(cls, tags):
    lanes = None
    if "ln" in tags:
        try:
            lanes = float(str(tags["ln"]).split(";")[0])
        except ValueError:
            lanes = None
    if "wd" in tags:
        try:
            return max(3.0, min(20.0, float(str(tags["wd"]).split()[0]) / 2))
        except ValueError:
            pass
    if lanes is None:
        lanes = DEFAULT_LANES[cls]
    # 3.6 m a lane plus a metre of shoulder each side.
    #
    # `lanes` counts the lanes on THIS way, and OSM splits a divided road into
    # one way per carriageway -- so a motorway way is half the freeway, not all
    # of it. The old floor (CLASS_HW * 0.72) was 10.8 m for anything tagged
    # motorway, which made every I-5 carriageway 21.6 m wide whether it carried
    # three lanes or six, and put the two carriageways' tarmac within 10 m of
    # touching across the median. Lane counts have to actually drive the width.
    hw = lanes * 1.8 + 1.0
    return max(CLASS_MIN_HW[cls], min(20.0, hw))


def main():
    height, wet = load_rasters()
    ways = json.load(open(os.path.join(DATA, "raw_roads.json")))["roads"]
    print(f"{len(ways)} OSM ways in")

    # --- junction detection, on the original OSM vertices --------------------
    seen, shared = set(), set()
    for w in ways:
        for p in w["p"]:
            k = (round(p[0], 1), round(p[1], 1))
            if k in seen:
                shared.add(k)
            else:
                seen.add(k)
    # A way's own endpoints are junction candidates too, so a dead end still gets
    # a node rather than being simplified away into its neighbour.
    for w in ways:
        for p in (w["p"][0], w["p"][-1]):
            shared.add((round(p[0], 1), round(p[1], 1)))
    print(f"{len(shared)} shared/terminal vertices out of {len(seen)}")

    b = Builder(height, wet)
    dropped_cls = defaultdict(int)
    tunnels = 0

    for w in ways:
        cls = CLS.get(w["cls"])
        if cls is None:
            dropped_cls[w["cls"]] += 1
            continue
        if str(w.get("acc", "")).lower() in ("private", "no"):
            dropped_cls["access=" + str(w.get("acc"))] += 1
            continue
        elev = str(w.get("br", "no")).lower() not in ("no", "")
        tun = str(w.get("tn", "no")).lower() not in ("no", "")
        if tun:
            tunnels += 1
        ow = str(w.get("ow", "no")).lower()
        flags = (F_ELEV if elev else 0) | (F_TUNNEL if tun else 0)
        if ow in ("yes", "true", "1"):
            flags |= F_ONEWAY
        elif ow in ("-1", "reverse"):
            flags |= F_ONEWAY | F_ONEWAY_REV
        if str(w.get("jn", "")).lower() == "roundabout":
            flags |= F_ONEWAY
        hw = ALLEY_HW if w["cls"] == "service" else half_width(cls, w)
        nid = b.name_id(w.get("name") or w.get("ref"))

        for run in clip_runs([tuple(p) for p in w["p"]]):
            # Split at junctions first, so simplification can never delete one.
            pieces, cur = [], [run[0]]
            for p in run[1:]:
                cur.append(p)
                if (round(p[0], 1), round(p[1], 1)) in shared:
                    pieces.append(cur)
                    cur = [p]
            if len(cur) >= 2:
                pieces.append(cur)
            for piece in pieces:
                pts = densify(simplify(piece, SIMPLIFY), MAX_SEG)
                prev = b.node(pts[0][0], pts[0][1], elev)
                for p in pts[1:]:
                    cur_id = b.node(p[0], p[1], elev)
                    b.edge(prev, cur_id, cls, flags, hw, nid)
                    prev = cur_id

    print(f"dropped classes: {dict(sorted(dropped_cls.items(), key=lambda x: -x[1])[:6])}")
    print(f"{len(b.nodes)} nodes, {len(b.edges)} edges, {tunnels} tunnel ways, "
          f"{len(b.name_list)} names")

    adj = build_adj(b)
    piers(b, adj)
    mark_elevated(b, adj)
    set_heights(b, adj, height, wet)
    ok = assertions(b, adj, wet)
    pack(b)
    return ok


def build_adj(b):
    adj = defaultdict(list)
    for ei, e in enumerate(b.edges):
        adj[e[0]].append(ei)
        adj[e[1]].append(ei)
    return adj


def mark_elevated(b, adj):
    """A node is on a deck only if every road meeting it is on a deck."""
    n = 0
    for ni, es in adj.items():
        if es and all(b.edges[e][3] & F_ELEV for e in es):
            b.nodes[ni][3] = True
            n += 1
    print(f"{n} elevated nodes ({sum(1 for e in b.edges if e[3] & F_ELEV)} elevated edges)")


def set_heights(b, adj, height, wet):
    """Ground nodes take the terrain. Decks are relaxed between their anchors.

    Repeatedly averaging each deck node against its neighbours while the ground
    nodes either end hold fixed is a Laplacian relaxation, which on a simple span
    converges to exactly the linear ramp you would interpolate by hand -- but it
    also does the right thing on a branching interchange, where "the two ends of
    the bridge" is not a well-defined pair.
    """
    for i, nd in enumerate(b.nodes):
        nd[2] = terrain_at(height, nd[0], nd[1])
    deck = [i for i, nd in enumerate(b.nodes) if nd[3]]
    if not deck:
        return
    # Floor: never below the ground it crosses, and enough clearance to look like
    # a bridge where it crosses water.
    # Clearance is measured from the local water surface, not from y=0. The
    # heightfield has already had a 7 m bed dug out under standing water, so the
    # surface is about terrain+7 -- and the lakes are not at sea level anyway
    # (Lake Union sits at 5 m, Green Lake at 50), so a fixed 5.5 m floor would
    # put a deck under the water it is supposed to cross.
    BED, CLEAR = 7.0, 2.5
    floor = {}
    for i in deck:
        x, z = b.nodes[i][0], b.nodes[i][1]
        g = terrain_at(height, x, z)
        floor[i] = g + BED + CLEAR if is_water(wet, x, z) else g + 0.6
        b.nodes[i][2] = floor[i]
    for _ in range(400):
        moved = 0.0
        for i in deck:
            s, c = 0.0, 0
            for ei in adj[i]:
                e = b.edges[ei]
                o = e[1] if e[0] == i else e[0]
                s += b.nodes[o][2]
                c += 1
            if not c:
                continue
            v = max(floor[i], s / c)
            moved = max(moved, abs(v - b.nodes[i][2]))
            b.nodes[i][2] = v
        if moved < 0.002:
            break
    hs = [b.nodes[i][2] for i in deck]
    print(f"deck heights: {min(hs):.1f}..{max(hs):.1f} m over {len(deck)} nodes")


def piers(b, adj):
    """Put ground-level roads that stand over water onto a low deck.

    citygen dropped these, because with a hand-drawn shoreline and hand-drawn
    polylines an edge over water meant one of the two had drifted. With both
    sides real, an edge over water is a pier or a seawall and it is *supposed*
    to be there -- Alaskan Way and Colman Dock are the ones that showed up.
    Dropping them tore a hole in the waterfront route. Absent is worse than
    built here, which is the opposite of the old rule and worth knowing.
    """
    n = 0
    names = defaultdict(int)
    for e in b.edges:
        if e[3] & (F_ELEV | F_TUNNEL):
            continue
        ax, az = b.nodes[e[0]][0], b.nodes[e[0]][1]
        bx, bz = b.nodes[e[1]][0], b.nodes[e[1]][1]
        if not is_water(b.wet, (ax + bx) / 2, (az + bz) / 2):
            continue
        e[3] |= F_ELEV
        names[b.name_list[e[5]] if e[5] < len(b.name_list) else "?"] += 1
        n += 1
    if n:
        print(f"{n} ground edges over water put on pier decks: "
              f"{sorted(names.items(), key=lambda x: -x[1])[:5]}")
    else:
        print("no ground edges over water")


# ---------------------------------------------------------------------------
# Quality assertions -- the numbers citygen used to print
# ---------------------------------------------------------------------------

def assertions(b, adj, wet):
    n = len(b.nodes)
    seen = [False] * n
    comps = []
    for s in range(n):
        if seen[s] or not adj[s]:
            continue
        q, seen[s], size, tag = deque([s]), True, 0, defaultdict(int)
        members = []
        while q:
            i = q.popleft()
            size += 1
            members.append(i)
            for ei in adj[i]:
                e = b.edges[ei]
                if e[5] < len(b.name_list):
                    tag[b.name_list[e[5]]] += 1
                o = e[1] if e[0] == i else e[0]
                if not seen[o]:
                    seen[o] = True
                    q.append(o)
        comps.append((size, max(tag, key=tag.get) if tag else "(unnamed)", members))
    comps.sort(key=lambda c: -c[0])
    live = sum(c[0] for c in comps)
    main = comps[0][0] if comps else 0

    at_rim = lambda i: abs(b.nodes[i][0]) > RIM - 60 or abs(b.nodes[i][1]) > RIM - 60  # noqa: E731
    dead = [i for i in range(n) if len(adj[i]) == 1 and not at_rim(i)]

    crossings = crossing_without_node(b)

    print("\n--- graph quality " + "-" * 50)
    print(f"  nodes on the network        {live}")
    print(f"  components                  {len(comps)}  (largest holds "
          f"{main / live * 100:.1f}%)")
    print(f"  nodes off the main network  {live - main}")
    print(f"  dead ends inside the map    {len(dead)}")
    print(f"  crossings with no junction  {crossings}")

    # Connectivity across the whole box understates the city: Mercer Island and
    # the Eastside sit at the map's east rim, reached by bridges whose far ends
    # are outside it. What actually matters for driving is the Seattle side of
    # Lake Washington, so that gets its own number.
    core = [i for i in range(n) if adj[i] and b.nodes[i][0] < 5200]
    core_set = set(comps[0][2])
    core_in = sum(1 for i in core if i in core_set)
    print(f"  west of Lake Washington     {core_in}/{len(core)} on the main network "
          f"({core_in / max(1, len(core)) * 100:.2f}%)")

    # A component that reaches the rim is stranded because its route out of the
    # box leaves the box -- Mercer Island and Medina both connect via bridges
    # whose far ends are off the map. That is honest clipping, not a broken
    # graph. A component stranded with no rim contact is the one to look at.
    inner = [c for c in comps[1:]
             if not any(max(abs(b.nodes[i][0]), abs(b.nodes[i][1])) > RIM - 60 for i in c[2])]
    inner_n = sum(c[0] for c in inner)
    biggest_inner = max((c[0] for c in inner), default=0)
    # These pockets are real streets reached in life through a driveway or a
    # parking aisle -- `service` roads, which the extractor drops on purpose
    # because including them would add tens of thousands of parking aisles.
    # They average about five nodes, they render, and you can drive on them; they
    # are just not routable. Deleting them would make the map *less* accurate, so
    # the gate is on a whole neighbourhood being cut off, not on the long tail.
    print(f"  stranded away from the rim  {inner_n} nodes in {len(inner)} pieces "
          f"(largest {biggest_inner})")
    print("  largest stranded pieces:")
    inner_sorted = sorted(inner, key=lambda c: -c[0])[:4]
    for s, nm, mem in inner_sorted:
        xs = [b.nodes[i][0] for i in mem]; zs = [b.nodes[i][1] for i in mem]
        print(f"    INNER {s:5d} nodes  {nm!r:34s} x {min(xs):7.0f}..{max(xs):7.0f} "
              f"z {min(zs):7.0f}..{max(zs):7.0f}")
    for s, nm, mem in comps[1:6]:
        xs = [b.nodes[i][0] for i in mem]
        zs = [b.nodes[i][1] for i in mem]
        rim = "rim" if max(max(abs(v) for v in xs), max(abs(v) for v in zs)) > RIM - 60 else "INNER"
        print(f"    {s:5d} nodes  {nm!r:34s} x {min(xs):7.0f}..{max(xs):7.0f} "
              f"z {min(zs):7.0f}..{max(zs):7.0f}  {rim}")
    # 120, raised from 80 with the 26 km box: the largest inner piece is now
    # Hunts Point (98 nodes) -- a real one-road peninsula off SR-520 whose sole
    # connector does not import. It renders and drives; it is not a severed
    # neighbourhood, it is a place that genuinely has one way in. The gate
    # still catches a real severing, which measured in the hundreds.
    ok = crossings < 60 and biggest_inner < 120
    print(f"  => {'OK' if ok else 'PROBLEM'}")
    return ok


def crossing_without_node(b):
    """Ground-level segment pairs that intersect but share no node.

    OSM's planarity convention means this should be near zero. What is left is
    genuinely unmapped -- and a level crossing with no junction is the bug that
    made the procedural city read as stacked scribble.
    """
    cell = 60.0
    grid = defaultdict(list)
    segs = []
    for ei, e in enumerate(b.edges):
        if e[3] & (F_ELEV | F_TUNNEL):
            continue
        ax, az = b.nodes[e[0]][0], b.nodes[e[0]][1]
        bx, bz = b.nodes[e[1]][0], b.nodes[e[1]][1]
        si = len(segs)
        segs.append((e[0], e[1], ax, az, bx, bz))
        for cx in range(int(min(ax, bx) // cell), int(max(ax, bx) // cell) + 1):
            for cz in range(int(min(az, bz) // cell), int(max(az, bz) // cell) + 1):
                grid[(cx, cz)].append(si)

    def hits(p, q, r, s):
        d = (q[0] - p[0]) * (s[1] - r[1]) - (q[1] - p[1]) * (s[0] - r[0])
        if abs(d) < 1e-12:
            return False
        t = ((r[0] - p[0]) * (s[1] - r[1]) - (r[1] - p[1]) * (s[0] - r[0])) / d
        u = ((r[0] - p[0]) * (q[1] - p[1]) - (r[1] - p[1]) * (q[0] - p[0])) / d
        return 1e-6 < t < 1 - 1e-6 and 1e-6 < u < 1 - 1e-6

    count, checked = 0, set()
    for ids in grid.values():
        for ai in range(len(ids)):
            for bi in range(ai + 1, len(ids)):
                i, j = ids[ai], ids[bi]
                if (i, j) in checked:
                    continue
                checked.add((i, j))
                A, B = segs[i], segs[j]
                if A[0] in (B[0], B[1]) or A[1] in (B[0], B[1]):
                    continue
                if hits((A[2], A[3]), (A[4], A[5]), (B[2], B[3]), (B[4], B[5])):
                    count += 1
    return count


# ---------------------------------------------------------------------------
# PACKING
#   header  'AUTR', u16 version, u16 nameCount, u32 nodeCount, u32 edgeCount
#   nodes   i32 x*10, i32 z*10, i16 y*10, u8 elev, u8 pad      (12 B)
#   edges   u32 a, u32 b, u8 cls, u8 flags, u16 hw*100, u16 name, u16 pad (16 B)
#   names   utf-8, u16 length prefix each
# ---------------------------------------------------------------------------

def pack(b):
    used = set()
    for e in b.edges:
        used.add(e[0])
        used.add(e[1])
    remap, nodes = {}, []
    for i, nd in enumerate(b.nodes):
        if i in used:
            remap[i] = len(nodes)
            nodes.append(nd)

    out = bytearray()
    out += struct.pack("<4sHHII", b"AUTR", 1, len(b.name_list), len(nodes), len(b.edges))
    for x, z, y, elev in nodes:
        out += struct.pack("<iihBB", int(round(x * 10)), int(round(z * 10)),
                           max(-32000, min(32000, int(round(y * 10)))), 1 if elev else 0, 0)
    for a, bb, cls, flags, hw, name in b.edges:
        out += struct.pack("<IIBBHHH", remap[a], remap[bb], cls, flags,
                           int(round(hw * 100)), name, 0)
    for s in b.name_list:
        e = s.encode("utf-8")[:255]
        out += struct.pack("<H", len(e)) + e

    p = os.path.join(OUT, "roads.bin")
    with open(p, "wb") as f:
        f.write(out)
    import gzip
    gz = len(gzip.compress(bytes(out), 9))
    print(f"\nroads.bin  {len(out)/1e6:.2f} MB raw, {gz/1e6:.2f} MB gzipped "
          f"({len(nodes)} nodes, {len(b.edges)} edges)")


if __name__ == "__main__":
    sys.exit(0 if main() else 1)
