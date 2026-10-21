"""Every GRT bus stop in the map's square, from OSM: where it stands, a shelter, a bench.

    tools/.venv/bin/python tools/kw/build_grtstops.py

OSM maps Grand River Transit's stops as nodes (highway=bus_stop, or
public_transport=platform + bus=yes) beside the kerb, most with `ref` (the
four-digit stop number on the marker), many with shelter= and bench=.
world.js (meshProps, `_grtStops`) stands each one at the kerb of its nearest
street: GRT's stop marker (orange for a local stop, green for an iXpress
one -- the route_ref's 2xx), and the glass shelter behind it where OSM says
shelter=yes.

Writes apps/autokw/data/grtstops.json: {"s": [[x, z, flags, ref], ...]},
x / z to 0.1 m, flags bit 0 shelter, bit 1 bench, bit 2 an iXpress stop;
ref the stop number or 0. ION platforms (railway=platform, train / tram /
light_rail) are left out: link.js draws those.
"""

import json
import os
import sys

import osmium

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from proj import to_world, MAP_HALF  # noqa: E402

HERE = os.path.dirname(os.path.abspath(__file__))
PBF = os.path.join(HERE, "data", "kw.osm.pbf")
OUT = os.path.join(HERE, "..", "..", "apps", "autokw", "data")


def main():
    out, seen = [], set()
    nsh = nb = nx = 0
    for n in osmium.FileProcessor(PBF):
        if not isinstance(n, osmium.osm.Node):
            continue
        t = n.tags
        bus = t.get("highway") == "bus_stop" or (t.get("public_transport") == "platform" and t.get("bus") == "yes")
        if not bus or t.get("railway") or t.get("light_rail") == "yes" or t.get("train") == "yes" or t.get("tram") == "yes":
            continue
        if (t.get("disused") or "") == "yes" or t.get("disused:highway"):
            continue
        try:
            x, z = to_world(n.location.lat, n.location.lon)
        except osmium.InvalidLocationError:
            continue
        if abs(x) > MAP_HALF - 60 or abs(z) > MAP_HALF - 60:
            continue
        k = (round(x), round(z))
        if k in seen:
            continue
        seen.add(k)
        sh = (t.get("shelter") or "") == "yes"
        be = (t.get("bench") or "") == "yes" or sh
        rr = (t.get("route_ref") or "").replace(",", ";").split(";")
        ix = any(r.strip().startswith("2") and len(r.strip()) == 3 for r in rr if r.strip())
        try:
            ref = int(str(t.get("ref") or "0").split(";")[0])
        except ValueError:
            ref = 0
        out.append([round(x, 1), round(z, 1), (1 if sh else 0) | (2 if be else 0) | (4 if ix else 0), ref])
        nsh += sh
        nb += be
        nx += ix
    out.sort()
    p = os.path.join(OUT, "grtstops.json")
    json.dump({"s": out}, open(p, "w"), separators=(",", ":"))
    print(f"wrote {p}: {len(out)} stops, {nsh} with a shelter, {nb} a bench, {nx} iXpress")


if __name__ == "__main__":
    main()
