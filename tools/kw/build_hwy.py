"""Waterloo Region's freeways as signed: exits, entrances, speed limits, lighting.

    tools/.venv/bin/python tools/kw/build_hwy.py

Reads tools/data/kw/kw.osm.pbf and writes apps/autokw/data/hwy.json, which
src/highways.js reads to sign and furnish the motorways the road graph already
carries (it only has the geometry and a class):

  ways   every motorway / trunk carriageway in the map: ref, name, maxspeed,
         lit, lanes, oneway, and its polyline (Douglas-Peucker 1 m)
  exits  every place a motorway_link leaves a motorway: the diverge point, the
         main line's direction there, its ref, the junction's ref (exit
         number; the Conestoga Parkway's are unnumbered, `noref`), and what
         the ramp is signed for -- destination, destination:ref,
         destination:street -- taken from the ramp, or, when the ramp itself
         carries none, from the ramps it splits into
  merges every place a link joins a motorway (route reassurance markers and
         speed limits go after these)
  noise  barrier=wall + wall=noise_barrier lines

Exit numbers and destinations are OSM's (junction:ref on the node or the
ramp, destination* on the ramp). Nothing is invented: a ramp OSM signs for
nothing gets a sign with the street it lands on, if any, else none.
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
OUT = os.path.join(HERE, "..", "..", "apps", "autokw", "data", "hwy.json")
LIM = MAP_HALF - 40

MAIN = {"motorway", "trunk"}
LINK = {"motorway_link", "trunk_link"}


def inside(p):
    return abs(p[0]) <= LIM and abs(p[1]) <= LIM


def simplify(pts, tol):
    if len(pts) < 3:
        return pts
    a, b = pts[0], pts[-1]
    dx, dz = b[0] - a[0], b[1] - a[1]
    L = math.hypot(dx, dz) or 1e-9
    best, bi = -1, 0
    for i in range(1, len(pts) - 1):
        p = pts[i]
        d = abs((p[0] - a[0]) * dz - (p[1] - a[1]) * dx) / L
        if d > best:
            best, bi = d, i
    if best <= tol:
        return [a, b]
    return simplify(pts[:bi + 1], tol)[:-1] + simplify(pts[bi:], tol)


def semis(v):
    return [s.strip() for s in str(v).split(";") if s.strip()] if v else []


def main():
    ways = []          # (id, tags, [node ids], [(x, z)])
    junc = {}          # node id -> tags
    noise = []
    fp = osmium.FileProcessor(PBF).with_locations()
    for o in fp:
        if isinstance(o, osmium.osm.Node):
            if o.tags.get("highway") == "motorway_junction":
                x, z = to_world(o.location.lat, o.location.lon)
                if inside((x, z)):
                    junc[o.id] = dict(o.tags)
            continue
        if not isinstance(o, osmium.osm.Way):
            continue
        t = dict(o.tags)
        hw = t.get("highway")
        is_noise = t.get("barrier") == "wall" and t.get("wall") == "noise_barrier"
        if hw not in MAIN and hw not in LINK and not is_noise:
            continue
        try:
            ids = [n.ref for n in o.nodes]
            pts = [to_world(n.location.lat, n.location.lon) for n in o.nodes]
        except osmium.InvalidLocationError:
            continue
        if not any(inside(p) for p in pts):
            continue
        if is_noise:
            noise.append({"id": o.id, "h": t.get("height"), "p": [[round(x, 1), round(z, 1)] for x, z in pts]})
            continue
        if t.get("oneway") == "-1":
            ids, pts = ids[::-1], pts[::-1]
        ways.append((o.id, t, ids, pts))

    starts, ends, on_main = defaultdict(list), defaultdict(list), defaultdict(list)
    for w in ways:
        wid, t, ids, pts = w
        if t["highway"] in LINK:
            starts[ids[0]].append(w)
            ends[ids[-1]].append(w)
        else:
            for i, n in enumerate(ids):
                on_main[n].append((w, i))

    def dests(link, depth=0):
        """What a ramp is signed for: its own tags, else its branches'."""
        t = link[1]
        d = {"dest": semis(t.get("destination")), "dref": semis(t.get("destination:ref")),
             "street": semis(t.get("destination:street")), "jref": t.get("junction:ref"),
             "adv": t.get("maxspeed:advisory")}
        if (d["dest"] or d["dref"] or d["street"]) or depth > 3:
            return d
        for nxt in starts.get(link[2][-1], []):
            if nxt[1]["highway"] not in LINK:
                continue
            e = dests(nxt, depth + 1)
            for k in ("dest", "dref", "street"):
                for v in e[k]:
                    if v not in d[k]:
                        d[k].append(v)
            d["jref"] = d["jref"] or e["jref"]
            d["adv"] = d["adv"] or e["adv"]
        return d

    def main_dir(w, i):
        pts = w[3]
        a = pts[max(0, i - 1)]
        b = pts[min(len(pts) - 1, i + 1)]
        L = math.hypot(b[0] - a[0], b[1] - a[1]) or 1
        return [round((b[0] - a[0]) / L, 4), round((b[1] - a[1]) / L, 4)]

    exits, merges = [], []
    seen = set()
    for n, lst in starts.items():
        if n not in on_main:
            continue
        mw, i = on_main[n][0]
        x, z = mw[3][i]
        if not inside((x, z)):
            continue
        for link in lst:
            if (n, link[0]) in seen:
                continue
            seen.add((n, link[0]))
            d = dests(link)
            jt = junc.get(n, {})
            ref = jt.get("ref") or d["jref"]
            lp = link[3]
            # the ramp's own heading 60 m on, to tell which side it leaves by
            k = min(len(lp) - 1, 3)
            ux, uz = main_dir(mw, i)
            rx, rz = lp[k][0] - x, lp[k][1] - z
            side = "R" if (rx * -uz + rz * ux) > 0 else "L"
            exits.append({
                "x": round(x, 1), "z": round(z, 1), "u": [ux, uz], "main": mw[1].get("ref"),
                "mname": mw[1].get("name"), "ref": ref, "noref": jt.get("noref") == "yes",
                "dest": d["dest"], "dref": d["dref"], "street": d["street"], "adv": d["adv"],
                "side": side, "link": link[0], "mway": mw[0],
            })
    for n, lst in ends.items():
        if n not in on_main:
            continue
        mw, i = on_main[n][0]
        x, z = mw[3][i]
        if not inside((x, z)):
            continue
        merges.append({"x": round(x, 1), "z": round(z, 1), "u": main_dir(mw, i),
                       "main": mw[1].get("ref"), "mname": mw[1].get("name"), "mway": mw[0]})

    out_ways = []
    for wid, t, ids, pts in ways:
        if t["highway"] not in MAIN:
            continue
        sp = simplify([(round(x, 1), round(z, 1)) for x, z in pts], 1.0)
        out_ways.append({
            "id": wid, "ref": t.get("ref"), "name": t.get("name"), "cls": t["highway"],
            "sp": t.get("maxspeed"), "lit": t.get("lit"), "ln": t.get("lanes"),
            "ow": t.get("oneway", "yes" if t["highway"] == "motorway" else "no"),
            "br": t.get("bridge"), "p": [list(p) for p in sp],
        })
    data = {"ways": out_ways, "exits": exits, "merges": merges, "noise": noise}
    with open(OUT, "w") as f:
        json.dump(data, f, separators=(",", ":"))
    print(f"hwy.json: {len(out_ways)} carriageways, {len(exits)} exits "
          f"({sum(1 for e in exits if e['ref'])} numbered), {len(merges)} merges, "
          f"{len(noise)} noise walls, {os.path.getsize(OUT) / 1e3:.0f} KB")


if __name__ == "__main__":
    main()
