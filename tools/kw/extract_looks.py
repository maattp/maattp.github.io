"""What the buildings LOOK like: the OSM tags build_buildings.py turns into a look.

    tools/.venv/bin/python tools/kw/extract_looks.py

osm_extract.py keeps a building's footprint, levels, height and type; this
side pass (one quick scan of kw.osm.pbf) keeps the rest:

  * `tags`: per building, keyed by its ring's FIRST point exactly as
    osm_extract.py rounds it ("x,z"), whatever of roof:shape,
    building:material, building:colour and roof:colour is mapped (~1,500
    buildings in the region; most of them in Uptown, downtown Kitchener and
    the Galt core);
  * `zones`: the landuse=residential / industrial / commercial / retail
    polygons. 124,000 of the region's 190,000 footprints are bare
    building=yes, and the landuse they stand in is the best thing OSM says
    about what they are: a 300 m2 building=yes in a residential zone is a
    house with a double garage, the same box in an industrial one a unit in
    a flex building.

Writes tools/data/kw/raw_looks.json.
"""

import json
import os
import sys

import osmium

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from osm_extract import ring_world, PBF, DATA  # noqa: E402

ZONES = {"residential", "industrial", "commercial", "retail"}
TAGS = {"roof:shape": "rs", "building:material": "mat", "building:colour": "col", "roof:colour": "rc"}


def main():
    tags, zones = {}, []
    fp = osmium.FileProcessor(PBF).with_locations("flex_mem").with_areas()
    for obj in fp:
        if not isinstance(obj, osmium.osm.Area):
            continue
        t = obj.tags
        lu = t.get("landuse")
        bld = t.get("building")
        if lu in ZONES and not bld:
            for ring in obj.outer_rings():
                try:
                    pts = ring_world(ring)
                except osmium.InvalidLocationError:
                    pts = None
                if pts:
                    zones.append({"k": lu, "o": pts})
            continue
        if not bld:
            continue
        look = {v: t.get(k) for k, v in TAGS.items() if t.get(k)}
        if not look:
            continue
        for ring in obj.outer_rings():
            try:
                pts = ring_world(ring)
            except osmium.InvalidLocationError:
                pts = None
            if pts:
                tags[f"{pts[0][0]},{pts[0][1]}"] = look
    p = os.path.join(DATA, "raw_looks.json")
    with open(p, "w") as f:
        json.dump({"tags": tags, "zones": zones}, f, separators=(",", ":"))
    print(f"raw_looks.json  {len(tags)} tagged buildings, {len(zones)} landuse zones")


if __name__ == "__main__":
    main()
