"""Pass 1: OSM .pbf -> projected, clipped, filtered intermediate JSON.

Slow (one full scan of the state extract) and rarely re-run, which is why it is
separated from tools/build-map.mjs -- that step is fast and gets iterated on.

    tools/.venv/bin/python tools/osm_extract.py

Writes tools/data/raw_*.json in world metres. Everything is extracted with a
margin around the map so that coastline and water polygons are complete at the
edges; clipping to the map happens in the build step.
"""

import json
import os
import sys
import time

import osmium

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from proj import to_world, bbox, MAP_HALF  # noqa: E402

HERE = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.join(HERE, "data")
PBF = os.path.join(DATA, "washington-latest.osm.pbf")

MARGIN = 3000  # metres of slop around the map, so coastline rings close
LIMIT = MAP_HALF + MARGIN
MIN_LAT, MIN_LON, MAX_LAT, MAX_LON = bbox(MARGIN)

# Road classes we keep, in descending importance. `service` is deliberately
# absent: Seattle has tens of thousands of parking aisles and alleys tagged that
# way and they would swamp both the graph and the draw-call budget.
ROAD_CLASSES = {
    "motorway": 0, "motorway_link": 1,
    "trunk": 2, "trunk_link": 3,
    "primary": 4, "primary_link": 5,
    "secondary": 6, "secondary_link": 7,
    "tertiary": 8, "tertiary_link": 9,
    "residential": 10, "unclassified": 11, "living_street": 12,
    # Alleys only. Bare `service` would drag in every parking aisle and driveway
    # in the city; alleys are real streets that Seattle blocks are built around.
    "service": 13,
}

WATER_LANDUSE = {"reservoir", "basin"}
GREEN_LEISURE = {"park", "garden", "nature_reserve", "golf_course", "pitch", "recreation_ground"}
GREEN_LANDUSE = {"forest", "grass", "meadow", "recreation_ground", "village_green", "cemetery"}
GREEN_NATURAL = {"wood", "scrub", "grassland", "beach"}

# Developed ground that is not a building: the lots, plazas and yards between
# them. Without these a downtown block reads as a vacant lawn, because the only
# thing the ground knew was "not a park". Each maps to a surface kind that
# tools/build_lots.py rasterises into surface.png's blue channel.
#   parking  asphalt with bay striping
#   asphalt  plain tarmac: forecourts, loading yards, area:highway, aisles
#   plaza    paving: squares, pedestrian areas
#   hard     concrete / worn hardstanding: commercial, retail land
#   rail     ballast and track: rail yards
LOT_PARKING_SKIP = {"underground", "multi-storey", "rooftop"}
LOT_LANDUSE = {"retail": "hard", "commercial": "hard", "industrial": "asphalt",
               "railway": "rail", "port": "asphalt", "garages": "asphalt"}
PAVED_SURFACE = {"asphalt", "concrete", "paving_stones", "paved", "sett", "bricks",
                 "concrete:plates", "brick", "stone"}
# Parking aisles and untagged service ways are the drive lanes of lots the
# polygon layer often misses. Driveways are a car wide and would only speckle.
AISLE_SERVICE = {None, "parking_aisle"}

# Named places we want to be able to point a landmark mesh at.
POI_KEYS = ("tourism", "amenity", "leisure", "historic", "man_made", "aeroway", "building")


def in_box(lat, lon):
    return MIN_LAT <= lat <= MAX_LAT and MIN_LON <= lon <= MAX_LON


def ring_world(ring):
    """osmium ring -> [[x, z], ...] in world metres, or None if fully outside."""
    pts = []
    inside = False
    for n in ring:
        try:
            lat, lon = n.location.lat, n.location.lon
        except osmium.InvalidLocationError:
            continue
        x, z = to_world(lat, lon)
        pts.append([round(x, 1), round(z, 1)])
        if abs(x) <= LIMIT and abs(z) <= LIMIT:
            inside = True
    if not inside or len(pts) < 3:
        return None
    return pts


class Collector:
    def __init__(self):
        self.roads = []
        self.coast = []
        self.water = []
        self.green = []
        self.buildings = []
        self.pois = []
        self.places = []
        self.lots = []
        self.aisles = []
        self.seen_area = set()
        self.seen_lot = set()

    # --- ways -------------------------------------------------------------
    def way(self, w):
        t = w.tags
        hw = t.get("highway")
        if hw == "service" and t.get("service") != "alley":
            if t.get("service") in AISLE_SERVICE and t.get("area") != "yes" \
                    and t.get("tunnel") is None and t.get("bridge") is None:
                pts = self.line(w)
                if pts:
                    self.aisles.append({"p": pts, "s": t.get("service") or "service"})
            return
        if hw in ROAD_CLASSES:
            self.road(w, hw, t)
        elif t.get("natural") == "coastline":
            pts = self.line(w)
            if pts:
                self.coast.append(pts)

    def line(self, w):
        pts = []
        inside = False
        for n in w.nodes:
            try:
                lat, lon = n.location.lat, n.location.lon
            except osmium.InvalidLocationError:
                return None
            x, z = to_world(lat, lon)
            pts.append([round(x, 1), round(z, 1)])
            if abs(x) <= LIMIT and abs(z) <= LIMIT:
                inside = True
        return pts if inside and len(pts) >= 2 else None

    def road(self, w, hw, t):
        pts = self.line(w)
        if not pts:
            return
        r = {"id": w.id, "cls": hw, "p": pts}
        for k, out in (("name", "name"), ("oneway", "ow"), ("lanes", "ln"),
                       ("bridge", "br"), ("tunnel", "tn"), ("layer", "ly"),
                       ("junction", "jn"), ("maxspeed", "sp"), ("width", "wd"),
                       ("ref", "ref"), ("access", "acc")):
            v = t.get(k)
            if v is not None:
                r[out] = v
        self.roads.append(r)

    # --- areas (ways + multipolygon relations) ----------------------------
    def area(self, a):
        key = (a.orig_id(), a.from_way())
        if key in self.seen_area:
            return
        t = a.tags
        self.maybe_lot(a, t)
        kind = None
        if t.get("natural") in ("water", "bay", "strait") or t.get("waterway") == "riverbank" \
                or t.get("landuse") in WATER_LANDUSE or t.get("water"):
            kind = "water"
        elif t.get("leisure") in GREEN_LEISURE or t.get("landuse") in GREEN_LANDUSE \
                or t.get("natural") in GREEN_NATURAL:
            kind = "green"
        elif t.get("building"):
            kind = "building"

        if kind is None:
            self.maybe_poi_area(a, t)
            return
        self.seen_area.add(key)

        outers = []
        for ring in a.outer_rings():
            pts = ring_world(ring)
            if not pts:
                continue
            holes = []
            for ir in a.inner_rings(ring):
                h = ring_world(ir)
                if h:
                    holes.append(h)
            outers.append({"o": pts, "h": holes} if holes else {"o": pts})
        if not outers:
            return

        name = t.get("name")
        if kind == "water":
            for p in outers:
                if name:
                    p["n"] = name
                self.water.append(p)
        elif kind == "green":
            sub = t.get("leisure") or t.get("landuse") or t.get("natural")
            for p in outers:
                p["k"] = sub
                if name:
                    p["n"] = name
                self.green.append(p)
        else:
            h = t.get("height")
            lv = t.get("building:levels")
            for p in outers:
                p.pop("h", None)  # buildings don't need holes
                if h:
                    p["ht"] = h
                if lv:
                    p["lv"] = lv
                if name:
                    p["n"] = name
                bt = t.get("building")
                if bt and bt != "yes":
                    p["bt"] = bt
                self.buildings.append(p)
        if name:
            self.maybe_poi_area(a, t, centroid_of(outers[0]["o"]))

    def maybe_lot(self, a, t):
        """Paved ground that is not a building, as a lot polygon."""
        key = (a.orig_id(), a.from_way())
        if key in self.seen_lot or t.get("building"):
            return
        # An area:highway outline tagged as a planted island is a verge.
        if t.get("landuse") in GREEN_LANDUSE | {"flowerbed", "traffic_island"} \
                or t.get("area:highway") == "traffic_island":
            return
        am, lu, hw = t.get("amenity"), t.get("landuse"), t.get("highway")
        lk = None
        if am == "parking" and t.get("parking") not in LOT_PARKING_SKIP \
                and t.get("surface") not in ("grass", "grass_paver"):
            lk = "parking"
        elif t.get("place") == "square" or hw == "pedestrian" \
                or (hw == "footway" and t.get("area") == "yes") \
                or t.get("area:highway") in ("pedestrian", "footway") \
                or am == "marketplace":
            lk = "plaza"
        elif t.get("surface") in PAVED_SURFACE and (
                t.get("leisure") or am or t.get("place") or t.get("man_made")):
            # A paved square mapped as a park -- Occidental Square is
            # `leisure=park` + `surface=paving_stones`. build_lots.py caps the
            # size ("sf"), so a mis-tagged whole park cannot turn to stone.
            lk = "asphalt" if t.get("surface") == "asphalt" else "plaza"
        elif am == "fuel" or t.get("area:highway") is not None:
            lk = "asphalt"
        elif lu in LOT_LANDUSE:
            lk = LOT_LANDUSE[lu]
        if lk is None:
            return
        self.seen_lot.add(key)
        for ring in a.outer_rings():
            pts = ring_world(ring)
            if not pts:
                continue
            holes = [h for h in (ring_world(ir) for ir in a.inner_rings(ring)) if h]
            p = {"k": lk, "o": pts}
            if holes:
                p["h"] = holes
            if lu:
                p["lu"] = lu
            if t.get("surface"):
                p["sf"] = t.get("surface")
            if t.get("leisure"):
                p["le"] = t.get("leisure")
            self.lots.append(p)

    def maybe_poi_area(self, a, t, c=None):
        name = t.get("name")
        if not name:
            return
        if not any(k in t for k in POI_KEYS):
            return
        if c is None:
            ring = next(iter(a.outer_rings()), None)
            if ring is None:
                return
            pts = ring_world(ring)
            if not pts:
                return
            c = centroid_of(pts)
        if abs(c[0]) > LIMIT or abs(c[1]) > LIMIT:
            return
        self.pois.append({
            "n": name, "x": c[0], "z": c[1],
            "t": {k: t[k] for k in POI_KEYS if k in t},
        })

    # --- nodes ------------------------------------------------------------
    def node(self, n):
        t = n.tags
        if not t:
            return
        name = t.get("name")
        if not name:
            return
        lat, lon = n.location.lat, n.location.lon
        if not in_box(lat, lon):
            return
        x, z = to_world(lat, lon)
        if abs(x) > LIMIT or abs(z) > LIMIT:
            return
        place = t.get("place")
        if place in ("neighbourhood", "suburb", "quarter", "borough", "locality", "city", "town"):
            self.places.append({"n": name, "x": round(x, 1), "z": round(z, 1), "p": place})
        if any(k in t for k in POI_KEYS):
            self.pois.append({
                "n": name, "x": round(x, 1), "z": round(z, 1),
                "t": {k: t[k] for k in POI_KEYS if k in t},
            })


def centroid_of(pts):
    n = len(pts)
    return [round(sum(p[0] for p in pts) / n, 1), round(sum(p[1] for p in pts) / n, 1)]


def main():
    # `--lots` rescans for the lot layer alone and leaves every other raw_*.json
    # untouched, so adding it did not force a re-import of the road graph.
    only_lots = "--lots" in sys.argv
    if not os.path.exists(PBF):
        sys.exit(f"missing {PBF} -- download the Geofabrik Washington extract first")
    c = Collector()
    t0 = time.time()
    n = 0
    fp = osmium.FileProcessor(PBF).with_locations("flex_mem").with_areas()
    for obj in fp:
        n += 1
        if n % 2_000_000 == 0:
            print(f"  {n/1e6:.0f}M objects  {time.time()-t0:.0f}s  "
                  f"roads={len(c.roads)} water={len(c.water)} bld={len(c.buildings)}", flush=True)
        try:
            if isinstance(obj, osmium.osm.Area):
                c.area(obj)
            elif isinstance(obj, osmium.osm.Way):
                c.way(obj)
            elif isinstance(obj, osmium.osm.Node):
                c.node(obj)
        except osmium.InvalidLocationError:
            continue

    os.makedirs(DATA, exist_ok=True)
    out = {
        "raw_roads.json": {"roads": c.roads},
        "raw_water.json": {"water": c.water, "coast": c.coast},
        "raw_green.json": {"green": c.green},
        "raw_buildings.json": {"buildings": c.buildings},
        "raw_pois.json": {"pois": c.pois, "places": c.places},
        "raw_lots.json": {"lots": c.lots, "aisles": c.aisles},
    }
    if only_lots:
        out = {"raw_lots.json": out["raw_lots.json"]}
    for fn, payload in out.items():
        p = os.path.join(DATA, fn)
        with open(p, "w") as f:
            json.dump(payload, f, separators=(",", ":"))
        print(f"{fn:22s} {os.path.getsize(p)/1e6:7.1f} MB")
    print(f"roads={len(c.roads)} coast={len(c.coast)} water={len(c.water)} "
          f"green={len(c.green)} buildings={len(c.buildings)} pois={len(c.pois)} "
          f"places={len(c.places)} lots={len(c.lots)} aisles={len(c.aisles)}  in {time.time()-t0:.0f}s")


if __name__ == "__main__":
    main()
