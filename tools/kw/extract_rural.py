"""The countryside's and the villages' extra tags -> tools/data/kw/raw_rural.json.

    tools/.venv/bin/python tools/kw/extract_rural.py

osm_extract.py keeps a building's footprint, levels, height and type, and
extract_looks.py its roof and wall; this side pass keeps what
build_buildings.py needs to draw farms and churches:

  * `worship`: per building that is a place of worship (amenity=
    place_of_worship on the building, or building=church/chapel/cathedral),
    keyed by its ring's FIRST point exactly as osm_extract.py rounds it
    ("x,z"): religion, denomination, name;
  * `silos`: man_made=silo NODES (~150 in the region, most in North Dumfries
    and the Cambridge countryside): a silo is often mapped as a point, and
    a point has no footprint for the city to stand up;
  * `pow_nodes`: amenity=place_of_worship nodes (a church mapped as a point
    inside an untagged footprint: St. James Lutheran in St. Jacobs).

Writes tools/data/kw/raw_rural.json.
"""

import json
import os
import sys

import osmium

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from osm_extract import ring_world, PBF, DATA  # noqa: E402
from proj import to_world, MAP_HALF  # noqa: E402

CHURCH_BT = {"church", "chapel", "cathedral"}


def main():
    worship, silos, pow_nodes = {}, [], []
    fp = osmium.FileProcessor(PBF).with_locations("flex_mem").with_areas()
    for obj in fp:
        t = obj.tags
        if isinstance(obj, osmium.osm.Node):
            mm, am = t.get("man_made"), t.get("amenity")
            if mm != "silo" and am != "place_of_worship":
                continue
            x, z = to_world(obj.location.lat, obj.location.lon)
            if abs(x) > MAP_HALF or abs(z) > MAP_HALF:
                continue
            if mm == "silo":
                silos.append([round(x, 1), round(z, 1)])
            else:
                pow_nodes.append({"x": round(x, 1), "z": round(z, 1), "rel": t.get("religion") or "",
                                  "den": t.get("denomination") or "", "n": t.get("name") or ""})
            continue
        if not isinstance(obj, osmium.osm.Area):
            continue
        bld = t.get("building")
        if not bld:
            continue
        if t.get("amenity") != "place_of_worship" and bld not in CHURCH_BT:
            continue
        if t.get("religion") not in (None, "christian"):
            continue        # mosques, temples, gurdwaras: no steeple
        for ring in obj.outer_rings():
            try:
                pts = ring_world(ring)
            except osmium.InvalidLocationError:
                pts = None
            if pts:
                worship[f"{pts[0][0]},{pts[0][1]}"] = {"den": t.get("denomination") or "", "n": t.get("name") or "",
                                                       "mat": t.get("building:material") or ""}
    p = os.path.join(DATA, "raw_rural.json")
    with open(p, "w") as f:
        json.dump({"worship": worship, "silos": silos, "pow_nodes": pow_nodes}, f, separators=(",", ":"))
    print(f"raw_rural.json  {len(worship)} churches, {len(silos)} silo nodes, {len(pow_nodes)} worship nodes")


if __name__ == "__main__":
    main()
