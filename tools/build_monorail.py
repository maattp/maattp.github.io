"""The Seattle Center Monorail from OSM -> apps/auto/data/monorail.json.

    tools/.venv/bin/python tools/build_monorail.py

One full scan of the state extract (~8 min), like osm_extract.py, but it keeps
only the monorail: the two beams, the stations and their platforms. Each beam is
stitched from its OSM ways by shared node ids into one polyline running from the
Westlake Center buffer stop (s = 0) to the Seattle Center one, with a per-point
flag for the stretch through MoPOP (tunnel=building_passage). monorail.js lays
the guideway, the stations and the trains from it.

The beams are named for where they run on 5th Avenue: `west` (the Blue train,
"Spirit of Seattle") and `east` (the Red, "Spirit of Century 21") -- Seattle
Landmarks designation report, 2003.
"""

import json
import os
import sys

import osmium

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from proj import to_world  # noqa: E402

HERE = os.path.dirname(os.path.abspath(__file__))
PBF = os.path.join(HERE, "data", "washington-latest.osm.pbf")
OUT = os.environ.get("AUTO_DATA_OUT") or os.path.join(HERE, "..", "apps", "auto", "data")
# Westlake Center to Seattle Center, with room
S, W, N, E = 47.608, -122.356, 47.625, -122.334
# OSM ways of each beam (the viaduct along 5th Avenue names them apart)
VIADUCT = {"east": 293623341, "west": 916411049}


class Grab(osmium.SimpleHandler):
    def __init__(self):
        super().__init__()
        self.ways, self.platforms, self.stations = {}, [], []

    def node(self, n):
        t = n.tags
        if t.get("station") == "monorail" and t.get("railway") == "station":
            x, z = to_world(n.location.lat, n.location.lon)
            self.stations.append({"name": t.get("name"), "x": round(x, 2), "z": round(z, 2)})

    def way(self, w):
        t = w.tags
        try:
            ll = [(nd.lat, nd.lon) for nd in w.nodes]
        except osmium.InvalidLocationError:
            return
        if not any(S < la < N and W < lo < E for la, lo in ll):
            return
        pts = [[round(v, 2) for v in to_world(la, lo)] for la, lo in ll]
        if t.get("railway") == "monorail":
            self.ways[w.id] = {"ids": [nd.ref for nd in w.nodes], "p": pts,
                               "passage": t.get("tunnel") == "building_passage"}
        elif t.get("railway") == "platform" and t.get("monorail") == "yes" or (
                t.get("railway") == "platform" and t.get("public_transport") == "platform"
                and t.get("level") == "2" and t.get("layer") == "2"):
            self.platforms.append({"id": w.id, "p": pts[:-1] if pts[0] == pts[-1] else pts})


def stitch(ways, start_id):
    """Walk from one way through every way sharing an end node, into one line."""
    used = {start_id}
    first = ways[start_id]
    ids, pts = list(first["ids"]), [p + [1 if first["passage"] else 0] for p in first["p"]]
    grew = True
    while grew:
        grew = False
        for wid, w in ways.items():
            if wid in used:
                continue
            a, b = w["ids"][0], w["ids"][-1]
            wp = [p + [1 if w["passage"] else 0] for p in w["p"]]
            if a == ids[-1]:
                ids += w["ids"][1:]; pts += wp[1:]
            elif b == ids[-1]:
                ids += w["ids"][::-1][1:]; pts += wp[::-1][1:]
            elif b == ids[0]:
                ids = w["ids"][:-1] + ids; pts = wp[:-1] + pts
            elif a == ids[0]:
                ids = w["ids"][::-1][:-1] + ids; pts = wp[::-1][:-1] + pts
            else:
                continue
            used.add(wid)
            grew = True
    return pts


def main():
    g = Grab()
    g.apply_file(PBF, locations=True)
    wl = next(s for s in g.stations if "Westlake" in (s["name"] or ""))
    tracks = {}
    for name, wid in VIADUCT.items():
        pts = stitch(g.ways, wid)
        # s = 0 at Westlake
        if (pts[-1][0] - wl["x"]) ** 2 + (pts[-1][1] - wl["z"]) ** 2 < (pts[0][0] - wl["x"]) ** 2 + (pts[0][1] - wl["z"]) ** 2:
            pts.reverse()
        length = sum(((pts[i + 1][0] - pts[i][0]) ** 2 + (pts[i + 1][1] - pts[i][1]) ** 2) ** 0.5 for i in range(len(pts) - 1))
        print(f"{name}: {len(pts)} points, {length:.0f} m, {sum(p[2] for p in pts)} in MoPOP")
        tracks[name] = pts
    out = {"source": "OpenStreetMap contributors (ODbL), via tools/build_monorail.py",
           "tracks": tracks, "stations": g.stations, "platforms": g.platforms}
    with open(os.path.join(OUT, "monorail.json"), "w") as f:
        json.dump(out, f, separators=(",", ":"))
    print(f"monorail.json: {len(g.stations)} stations, {len(g.platforms)} platforms")


if __name__ == "__main__":
    main()
