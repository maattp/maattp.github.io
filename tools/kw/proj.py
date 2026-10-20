"""Waterloo Region world projection -- the single source of truth for lat/lon -> world.

Mirrored exactly by proj.mjs (JS) and geo.js's LAT0/LON0. World frame matches
the game: +X = east, +Z = south, Y = up, 1 unit = 1 metre, origin at the
middle of the map (Kitchener's east side, by Fairway Rd and Hwy 8), chosen so
the 31.2 km square holds St. Jacobs, Waterloo, Kitchener, Cambridge and the
airport.

Heights: everything in the game is ELEV_BASE metres below sea level-referenced
DEM heights, so the ground sits at ~10-150 m like Seattle's did (the Grand
River at Galt is ~262 m ASL -> ~12 m in game).

The projection is a local equirectangular about the origin. Over the 8 km half
-width of the map the distortion is under 0.1 %, an order of magnitude below the
DEM's own 20 m resolution, so a conformal projection (UTM) would buy nothing.
"""

import math

LAT0 = 43.45200
LON0 = -80.47500

# DEM metres above sea level -> game y. See the docstring.
ELEV_BASE = 250.0

# WGS84 metres per degree at LAT0 (standard series approximation).
_p = math.radians(LAT0)
M_LAT = 111132.92 - 559.82 * math.cos(2 * _p) + 1.175 * math.cos(4 * _p) - 0.0023 * math.cos(6 * _p)
M_LON = 111412.84 * math.cos(_p) - 93.5 * math.cos(3 * _p) + 0.118 * math.cos(5 * _p)

MAP_HALF = 15600  # world spans -15600..15600 on both axes (31.2 km)


def to_world(lat, lon):
    """(lat, lon) -> (x, z) in world metres. +Z is south, so z grows going south."""
    return (lon - LON0) * M_LON, (LAT0 - lat) * M_LAT


def to_latlon(x, z):
    return LAT0 - z / M_LAT, LON0 + x / M_LON


def bbox(margin=0.0):
    """(min_lat, min_lon, max_lat, max_lon) covering the map plus `margin` metres."""
    h = MAP_HALF + margin
    return (LAT0 - h / M_LAT, LON0 - h / M_LON, LAT0 + h / M_LAT, LON0 + h / M_LON)


if __name__ == "__main__":
    for name, lat, lon in [
        ("UW Dana Porter", 43.46970, -80.54220),
        ("Kitchener City Hall", 43.45150, -80.49200),
        ("Galt", 43.35860, -80.31440),
        ("YKF airport", 43.46080, -80.37860),
        ("St Jacobs", 43.53800, -80.55400),
    ]:
        x, z = to_world(lat, lon)
        print(f"{name:18s} ({x:8.0f}, {z:8.0f})")
    print("bbox", bbox(3000))
