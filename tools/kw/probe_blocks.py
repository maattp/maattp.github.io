"""Every building (and named area) in a box, with ALL its OSM tags.

    tools/.venv/bin/python tools/kw/probe_blocks.py out.json x0 z0 x1 z1 [x0 z0 x1 z1 ...]
    tools/.venv/bin/python tools/kw/probe_blocks.py out.json --name 'Galt Collegiate|Preston Springs'

A research aid for the building-by-building passes (kwuptown.js,
kwdowntown.js): osm_extract.py keeps only footprint, levels, height and
type, but a block's address, building:colour / material, its name and its
parts are what tie it to a heritage register entry and a photograph. Writes
[{c: [cx, cz], o: [[x, z], ...], t: {tags}}] sorted by box then x.
"""

import json
import os
import re
import sys

import osmium

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from osm_extract import ring_world, PBF  # noqa: E402


def main():
    out_path = sys.argv[1]
    rx = None
    boxes = []
    if sys.argv[2] == "--name":
        rx = re.compile(sys.argv[3], re.I)
    else:
        v = [float(a) for a in sys.argv[2:]]
        boxes = [v[i:i + 4] for i in range(0, len(v), 4)]
    out = []
    fp = osmium.FileProcessor(PBF).with_locations("flex_mem").with_areas()
    for obj in fp:
        t = obj.tags
        if isinstance(obj, osmium.osm.Node):
            if rx and rx.search(t.get("name", "")):
                from osm_extract import to_world
                x, z = to_world(obj.location.lat, obj.location.lon)
                out.append({"c": [round(x, 1), round(z, 1)], "o": None, "t": dict(t), "node": True})
            continue
        if not isinstance(obj, osmium.osm.Area):
            continue
        if rx:
            if not rx.search(t.get("name", "")):
                continue
        elif not (t.get("building") or t.get("building:part")):
            continue
        for ring in obj.outer_rings():
            try:
                pts = ring_world(ring)
            except osmium.InvalidLocationError:
                pts = None
            if not pts:
                continue
            cx = sum(q[0] for q in pts) / len(pts)
            cz = sum(q[1] for q in pts) / len(pts)
            if boxes and not any(b[0] <= cx <= b[2] and b[1] <= cz <= b[3] for b in boxes):
                continue
            out.append({"c": [round(cx, 1), round(cz, 1)], "o": pts, "t": dict(t)})
    out.sort(key=lambda r: r["c"][0])
    with open(out_path, "w") as f:
        json.dump(out, f, ensure_ascii=False)
    print(f"{len(out)} features -> {out_path}")


if __name__ == "__main__":
    main()
