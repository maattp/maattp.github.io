"""Seattle world projection -- the single source of truth for lat/lon -> world.

Mirrored exactly by proj.mjs (JS) and geo.js's LAT0/LON0. World frame matches
the game: +X = east, +Z = south, Y = up, 1 unit = 1 metre, origin at Westlake
Center (4th Ave & Pine St).

The projection is a local equirectangular about the origin. Over the 8 km half
-width of the map the distortion is under 0.1 %, an order of magnitude below the
DEM's own 20 m resolution, so a conformal projection (UTM) would buy nothing.
"""

import math

LAT0 = 47.61134
LON0 = -122.33790

# WGS84 metres per degree at LAT0 (standard series approximation).
_p = math.radians(LAT0)
M_LAT = 111132.92 - 559.82 * math.cos(2 * _p) + 1.175 * math.cos(4 * _p) - 0.0023 * math.cos(6 * _p)
M_LON = 111412.84 * math.cos(_p) - 93.5 * math.cos(3 * _p) + 0.118 * math.cos(5 * _p)

MAP_HALF = 8000  # world spans -8000..8000 on both axes (16 km)


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
        ("Space Needle", 47.6205, -122.3493),
        ("Westlake Center", LAT0, LON0),
        ("Alki Point", 47.5763, -122.4207),
        ("Green Lake", 47.6807, -122.3287),
        ("Seward Park", 47.5506, -122.2536),
    ]:
        x, z = to_world(lat, lon)
        print(f"{name:18s} ({x:8.0f}, {z:8.0f})")
    print("bbox", bbox(3000))
