"""Waterloo Region's local layer -> apps/autokw/data/kw.json.

    tools/.venv/bin/python tools/kw/build_kw.py

What src/kw.js puts on top of the imported city:
  named    every named OSM building: [name, x, z, building type]. kw.js finds
           the box each one became and gives the ones it knows a real look
           (campus buildings, schools) and a name sign.
  shops    named shops, cafes and restaurants inside the DETAIL zones (the
           plazas and main streets that get storefront signs): [name, x, z,
           kind, brand].
  tims     every Tim Hortons on the map: [x, z, address]. OSM's, deduped
           (a store is often both a building and a node), plus any the
           research list has that OSM lacks (EXTRA_TIMS).
  freshco  every FreshCo: [x, z, address].
"""

import json
import math
import os
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from proj import MAP_HALF, to_world  # noqa: E402

HERE = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.join(HERE, "data")
OUT = os.path.join(HERE, "..", "..", "apps", "autokw", "data")

# Storefront signs go up inside these circles: [name, lat, lon, radius m].
ZONES = [
    ("University of Waterloo Plaza", 43.47261, -80.53690, 170),
    ("University & Bridge", 43.48926, -80.49291, 220),
    ("Uptown Waterloo", 43.46500, -80.52280, 420),
    ("Downtown Kitchener", 43.45030, -80.49000, 520),
    ("Belmont Village", 43.44400, -80.51080, 180),
    ("Laurier / King St N", 43.47600, -80.52700, 300),
    ("Galt Main Street", 43.35880, -80.31430, 300),
    ("St. Jacobs", 43.53860, -80.55380, 260),
    ("Preston King St", 43.39620, -80.35300, 200),
    ("Hespeler Queen St", 43.43200, -80.31130, 170),
]

# Tim Hortons OSM is missing, from the research list (lat, lon, address).
EXTRA_TIMS = []
EXTRA_FRESHCO = []

SHOP_AMENITY = {"restaurant", "fast_food", "cafe", "pharmacy", "bank", "pub", "bar",
                "ice_cream", "fuel", "dentist", "clinic", "post_office", "library", "cinema"}


def main():
    pois = json.load(open(os.path.join(DATA, "raw_pois.json")))["pois"]
    blds = json.load(open(os.path.join(DATA, "raw_buildings.json")))["buildings"]
    inmap = lambda x, z: abs(x) < MAP_HALF - 50 and abs(z) < MAP_HALF - 50

    named = []
    for b in blds:
        n = b.get("n")
        if not n:
            continue
        xs = [q[0] for q in b["o"]]
        zs = [q[1] for q in b["o"]]
        x, z = sum(xs) / len(xs), sum(zs) / len(zs)
        if not inmap(x, z):
            continue
        named.append([n, round(x, 1), round(z, 1), b.get("bt", "yes")])

    zones = [(nm, *to_world(la, lo), r) for nm, la, lo, r in ZONES]
    shops = []
    for p in pois:
        t = p["t"]
        k = t.get("shop") or (t.get("amenity") if t.get("amenity") in SHOP_AMENITY else None)
        if not k or not inmap(p["x"], p["z"]):
            continue
        if not any(math.hypot(p["x"] - zx, p["z"] - zz) < r for _, zx, zz, r in zones):
            continue
        shops.append([p["n"], round(p["x"], 1), round(p["z"], 1), k, t.get("brand", "")])

    def brand(match):
        out = []
        for p in pois:
            t = p["t"]
            if not match(p["n"], t) or not inmap(p["x"], p["z"]):
                continue
            addr = " ".join(v for v in (t.get("addr:housenumber"), t.get("addr:street")) if v)
            # a store mapped as a building AND a node: keep one, the addressed one
            dup = next((o for o in out if math.hypot(o[0] - p["x"], o[1] - p["z"]) < 30), None)
            if dup:
                if addr and not dup[2]:
                    dup[2] = addr
                continue
            out.append([round(p["x"], 1), round(p["z"], 1), addr])
        return out

    # The stores themselves: the official lists, matched to OSM's buildings
    # (tools/kw/kw_stores.json) -- 94 open Tim Hortons, 8 FreshCo. OSM alone
    # missed some and kept two that are gone.
    stores = json.load(open(os.path.join(HERE, "kw_stores.json")))
    tims, fresh = [], []
    for la, lo, addr, *_ in stores["tims"]:
        x, z = to_world(la, lo)
        if inmap(x, z):
            tims.append([round(x, 1), round(z, 1), addr])
    for la, lo, addr in stores["freshco"]:
        x, z = to_world(la, lo)
        if inmap(x, z):
            fresh.append([round(x, 1), round(z, 1), addr])
    for la, lo, addr in EXTRA_TIMS:
        x, z = to_world(la, lo)
        if inmap(x, z) and not any(math.hypot(o[0] - x, o[1] - z) < 60 for o in tims):
            tims.append([round(x, 1), round(z, 1), addr])
    for la, lo, addr in EXTRA_FRESHCO:
        x, z = to_world(la, lo)
        if inmap(x, z) and not any(math.hypot(o[0] - x, o[1] - z) < 60 for o in fresh):
            fresh.append([round(x, 1), round(z, 1), addr])

    # Footprints drawn as their real polygons (kw.js buildPolys): the schools,
    # the universities and colleges, and the stores in the two plazas that
    # matter most. Everything else stays a box.
    POLY_ZONES = [z for z in zones if z[0] in ("University of Waterloo Plaza", "University & Bridge")]
    # (an untagged building=yes L with stores in it is a plaza too: 600 Hespeler Rd's HomeSense / PetSmart row)
    sp = os.path.join(DATA, "raw_shops.json")
    store_pts = [(s["x"], s["z"]) for s in json.load(open(sp))["stores"]] if os.path.exists(sp) else []
    polys = []
    for b in blds:
        bt = str(b.get("bt", "")).lower()
        n = b.get("n") or ""
        xs = [q[0] for q in b["o"]]
        zs = [q[1] for q in b["o"]]
        cx, cz = sum(xs) / len(xs), sum(zs) / len(zs)
        if not inmap(cx, cz) or len(b["o"]) < 4:
            continue
        keep = bt in ("school", "university", "college", "dormitory", "kindergarten", "stadium", "sports_centre",
                      "sports_hall", "civic", "public", "government", "townhall") \
            or re.search(r"Arena|Auditorium|Sportsplex|Recreation Complex|City Hall|Market|Perimeter|CIGI|Tannery|Google|Mill|Museum", n) \
            or re.search(r"School|Collegiate|College|University|Campus|Hall\b|Library|Centre for", n) \
            or (bt in ("retail", "commercial", "supermarket", "yes") and any(math.hypot(cx - zx, cz - zz) < r for _, zx, zz, r in POLY_ZONES)) \
            or _swallowing_box(b["o"], bt)
        # an untagged (building=yes) L or U with a row of stores in it is a plaza too (600 and 561 Hespeler Rd):
        # drawn as retail; a hotel, a tower or anything over two storeys is not
        if not keep and bt in ("", "yes") and str(b.get("lv") or "1")[:1] in "12" and len(str(b.get("lv") or "1")) == 1 \
                and not re.search(r"Hotel|Inn\b|Suites|Crowne|Tower|Apartment|Condo|Church", n) \
                and _swallowing_box(b["o"], "retail") and _holds_store(b["o"], store_pts):
            keep, bt = True, "retail"
        if not keep:
            continue
        pts = []
        for q in b["o"]:
            if not pts or math.hypot(q[0] - pts[-1][0], q[1] - pts[-1][1]) > 0.4:
                pts.append([round(q[0], 1), round(q[1], 1)])
        if len(pts) > 2 and pts[0] == pts[-1]:
            pts.pop()
        if len(pts) < 3:
            continue
        lv = b.get("lv")
        try:
            lv = float(str(lv).split(";")[0]) if lv else None
        except ValueError:
            lv = None
        polys.append([n, bt, lv, pts])

    # the airport's pavement, for kw.js's YKF (tools/kw/extract_aero.py)
    aero = {"runways": [], "taxiways": [], "aprons": [], "stands": []}
    ap = os.path.join(DATA, "raw_aero.json")
    if os.path.exists(ap):
        for o in json.load(open(ap))["aero"]:
            cx = sum(p[0] for p in o["p"]) / len(o["p"])
            cz = sum(p[1] for p in o["p"]) / len(o["p"])
            if not (5500 < cx < 9600 and -2600 < cz < 600):
                continue
            pts = [[round(p[0], 1), round(p[1], 1)] for p in o["p"]]
            if o["k"] == "runway" and o.get("ref"):
                aero["runways"].append({"ref": o["ref"], "w": float(o.get("w") or 45), "p": [pts[0], pts[-1]]})
            elif o["k"] == "taxiway":
                aero["taxiways"].append({"ref": o.get("ref") or "", "p": pts})
            elif o["k"] == "apron" and o.get("closed"):
                aero["aprons"].append({"n": o.get("n") or "", "p": pts[:-1]})
            elif o["k"] == "parking_position":
                aero["stands"].append({"ref": o.get("ref") or "", "p": [pts[0], pts[-1]]})

    # the two schools that matter: their sports fields, for kw.js buildSchools
    green = json.load(open(os.path.join(DATA, "raw_green.json")))["green"]
    # (St. David's colours are green, blue and white -- Wikipedia; St. Matthew's
    # Wildcats -- the WCDSB's school page. The monument sign stands where the
    # board's own OSM node puts it, when there is one.)
    SCHOOLS = [
        ("stmatt", "ST. MATTHEW", "CATHOLIC ELEMENTARY SCHOOL · HOME OF THE WILDCATS", "#0b3a7a", "#f2c230", -1542, -4808,
         "St Matthew Catholic Elementary School Sign"),
        ("stdavid", "ST. DAVID", "CATHOLIC SECONDARY SCHOOL · HOME OF THE CELTICS", "#0e6b3a", "#ffffff", -4399, -3569, None),
    ]
    pitch_pois = [p for p in pois if p["t"].get("leisure") == "pitch" and p["t"].get("sport")]
    schools = []
    for key, nm, sub, bg, fg, sx, sz, sign_name in SCHOOLS:
        pitches = []
        for g in green:
            if g.get("k") != "pitch":
                continue
            xs = [q[0] for q in g["o"]]; zs = [q[1] for q in g["o"]]
            cx, cz = sum(xs) / len(xs), sum(zs) / len(zs)
            if math.hypot(cx - sx, cz - sz) < 260:
                o = g["o"]
                # the sport: OSM's pitch node inside it (St. Matthew's are nodes beside unnamed ways)
                sp = next((p["t"]["sport"] for p in pitch_pois if _in_poly(o, p["x"], p["z"])), "")
                pitches.append({"n": g.get("n") or "", "s": sp, "p": [[round(q[0], 1), round(q[1], 1)] for q in o]})
        sc = {"key": key, "name": nm, "sub": sub, "bg": bg, "fg": fg, "x": sx, "z": sz, "pitches": pitches}
        sn = next((p for p in pois if sign_name and p.get("n") == sign_name), None)
        if sn:
            sc["sign"] = [round(sn["x"], 1), round(sn["z"], 1)]
        schools.append(sc)
        print(f"  {nm}: {len(pitches)} pitches ({', '.join(p['s'] or '?' for p in pitches)})")

    # Canadian flags (kwfun.js buildFlags): on the front lawns of the city
    # halls, schools, fire halls, police, hospitals, libraries, post offices,
    # community centres, the campuses and the Legions -- and the car dealers,
    # whose flags are the biggest on any street
    FLAG_AMENITY = {"townhall", "school", "fire_station", "police", "hospital", "post_office", "library",
                    "community_centre", "college", "university"}
    flags = []
    for p in pois:
        t = p["t"]
        a = t.get("amenity")
        kind = "car" if t.get("shop") == "car" else a if a in FLAG_AMENITY else "legion" if "Legion" in (p.get("n") or "") else None
        if not kind or not inmap(p["x"], p["z"]):
            continue
        if any(math.hypot(f[0] - p["x"], f[1] - p["z"]) < (80 if kind == "car" else 40) for f in flags):
            continue
        flags.append([round(p["x"], 1), round(p["z"], 1), kind])
    print(f"flags: {len(flags)} ({sum(1 for f in flags if f[2] == 'car')} at car dealers)")

    places = build_places(blds, pois, green)

    doc = {"named": named, "flags": flags, "schools": schools, "shops": shops, "tims": tims, "freshco": fresh, "polys": polys, "aero": aero,
           "places": places, "zones": [[nm, round(x), round(z), r] for nm, x, z, r in zones]}
    p = os.path.join(OUT, "kw.json")
    with open(p, "w") as f:
        json.dump(doc, f, separators=(",", ":"), ensure_ascii=False)
    print(f"  {len(polys)} footprints drawn as polygons")
    print(f"kw.json {os.path.getsize(p) // 1024} KB: {len(named)} named buildings, "
          f"{len(shops)} zone shops, {len(tims)} Tim Hortons, {len(fresh)} FreshCo")
    assert len(tims) > 40, "Tim Hortons missing"
    assert len(fresh) >= 4, "FreshCo missing"


# --- the places (src/kwplaces.js) -------------------------------------------------------

# King Street's centreline through Uptown Waterloo, William St (south) to past
# Bridgeport Rd (north), from OSM's King Street ways.
UPTOWN_KING = [(-3756, -1073), (-3772, -1150), (-3800, -1291), (-3813, -1356), (-3820, -1391), (-3834, -1465),
               (-3845, -1519), (-3855, -1557), (-3880, -1691), (-3889, -1738), (-3902, -1802)]
# Footprints kwplaces.js draws itself, by the OSM centroid each one has (+-4 m)
PLACE_BLDGS = {
    "townsq": (-3932, -1302),        # The Shops at Waterloo Town Square
    "mall": (-4177, -5080),          # Conestoga Mall
    "cinema": (-4110, -4930),        # Galaxy Cinemas Waterloo
    "seagram3": (-4024, -1154),      # Seagram Lofts, 3 Father David Bauer Dr (1905 barrel warehouse)
    "seagram5": (-4081, -1152),      # Seagram Lofts, 5 Father David Bauer Dr (1907)
    "school": (-4440, -1679),        # First School House in Waterloo (1820, log)
    "mill": (-4132, -1536),          # the Grist Mill replica (1998), Silver Lake's east end
    "potters": (-4420, -1759),       # Eby farmhouse, now the Waterloo Potters' Workshop
    "ebybarn": (-4586, -1692),       # the Eby Farmstead's barn
    "parkinn": (-4434, -1644),       # Park Inn concession
    "gazeboE": (-4271, -1662),       # East Gazebo
    "gazeboT": (-4403, -1491),       # Trans Canada Trail Pavilion
    "gazeboW": (-5046, -1399),       # Gazebo West
    "martinHouse": (-1618, -7177),   # Elam Martin farmstead: the house (1856) and the doddy house
    "martinBarn": (-1568, -7208),    # its bank barn
}
# Where the playing fields are drawn: RIM Park and Waterloo Park (x0, z0, x1, z1)
PITCH_BOXES = {"rim": (-2900, -7750, -1600, -6900), "wpark": (-4950, -2080, -4300, -1450)}
PLACE_SHOP_AMENITY = SHOP_AMENITY | {"nightclub", "theatre", "arts_centre", "bar", "fast_food", "bank", "cinema"}


def _min_rect_area(p):
    """The area of the smallest rectangle round p (one side along an edge)."""
    best = float("inf")
    for i in range(len(p)):
        a, b = p[i], p[(i + 1) % len(p)]
        dx, dz = b[0] - a[0], b[1] - a[1]
        L = math.hypot(dx, dz)
        if L < 1e-6:
            continue
        ux, uz = dx / L, dz / L
        us = [q[0] * ux + q[1] * uz for q in p]
        vs = [-q[0] * uz + q[1] * ux for q in p]
        best = min(best, (max(us) - min(us)) * (max(vs) - min(vs)))
    return best


def _swallowing_box(o, bt):
    """An L- or U-shaped plaza (St. Jacobs Outlets, Laurelwood, Westmount
    Place, Forest Glen...): its box, the outline's min-area rectangle, fills
    in its own car park (St. Jacobs Outlets: a 180 x 102 m white slab over
    the lot the L wraps). Drawn from its outline instead. The malls other
    modules draw from their own plans (Fairview, Conestoga, Cambridge Centre:
    over 40,000 m2) are left out."""
    if bt not in ("retail", "commercial", "supermarket") or len(o) < 5:
        return False
    A = abs(_area(o))
    return 1500 <= A <= 40000 and A / _min_rect_area(o) < 0.62


def _holds_store(o, pts, n=2):
    """Two stores' nodes (raw_shops.json) inside outline o: a row of shops, not a
    building with a cafe in it (one store alone: a pad, left to its box)."""
    xs = [q[0] for q in o]
    zs = [q[1] for q in o]
    x0, x1, z0, z1 = min(xs), max(xs), min(zs), max(zs)
    return sum(1 for x, z in pts if x0 <= x <= x1 and z0 <= z <= z1 and _in_poly(o, x, z)) >= n


def _seg_dist(px, pz, a, b):
    dx, dz = b[0] - a[0], b[1] - a[1]
    L2 = dx * dx + dz * dz or 1.0
    t = max(0.0, min(1.0, ((px - a[0]) * dx + (pz - a[1]) * dz) / L2))
    return math.hypot(px - a[0] - dx * t, pz - a[1] - dz * t)


def _in_poly(p, x, z):
    c = False
    j = len(p) - 1
    for i in range(len(p)):
        if (p[i][1] > z) != (p[j][1] > z) and x < (p[j][0] - p[i][0]) * (z - p[i][1]) / (p[j][1] - p[i][1]) + p[i][0]:
            c = not c
        j = i
    return c


def _area(p):
    a = 0.0
    for i in range(len(p)):
        j = (i + 1) % len(p)
        a += p[i][0] * p[j][1] - p[j][0] * p[i][1]
    return a / 2


def _clean(o):
    pts = []
    for q in o:
        if not pts or math.hypot(q[0] - pts[-1][0], q[1] - pts[-1][1]) > 0.4:
            pts.append([round(q[0], 1), round(q[1], 1)])
    if len(pts) > 2 and pts[0] == pts[-1]:
        pts.pop()
    return pts


def _levels(lv):
    try:
        return float(str(lv).split(";")[0]) if lv else None
    except ValueError:
        return None


def build_places(blds, pois, green):
    out = {}
    cen = lambda o: (sum(q[0] for q in o) / len(o), sum(q[1] for q in o) / len(o))
    # named footprints, by their centroid (the nearest within 12 m: OSM's way
    # centroid counts the closing node, ours may not)
    near = {}
    for b in blds:
        cx, cz = cen(b["o"])
        for key, (px, pz) in PLACE_BLDGS.items():
            d = math.hypot(cx - px, cz - pz)
            if d < 12 and (key not in near or d < near[key][0]):
                near[key] = (d, b)
    for key, (d, b) in near.items():
        out[key] = {"p": _clean(b["o"]), "lv": _levels(b.get("lv")), "n": b.get("n") or ""}
    missing = [k for k in PLACE_BLDGS if k not in out]
    assert not missing, f"place footprints not found: {missing}"

    # Uptown's King Street: every low building with a wall on the street, and
    # the shops OSM maps inside it
    shops = [p for p in pois if p.get("n") and (p["t"].get("shop") or p["t"].get("amenity") in PLACE_SHOP_AMENITY)
             and -4000 < p["x"] < -3650 and -1850 < p["z"] < -1000]
    king = []
    for b in blds:
        o = b["o"]
        cx, cz = cen(o)
        if not (-3990 < cx < -3680 and -1830 < cz < -1040):
            continue
        bt = str(b.get("bt", "yes")).lower()
        n = b.get("n") or ""
        if bt in ("parking", "roof", "garage", "garages", "service", "church", "shed") or "Town Square" in n:
            continue
        lv = _levels(b.get("lv"))
        if lv and lv > 5:
            continue
        pts = _clean(o)
        if len(pts) < 3:
            continue
        A = abs(_area(pts))
        if A < 40 or A > 1600:
            continue
        d = min(_seg_dist(q[0], q[1], UPTOWN_KING[i], UPTOWN_KING[i + 1]) for q in pts for i in range(len(UPTOWN_KING) - 1))
        if d > 24:
            continue
        inside = []
        for p in shops:
            if p["t"].get("shop") == "vacant":
                continue
            if _in_poly(pts, p["x"], p["z"]) or min(math.hypot(p["x"] - q[0], p["z"] - q[1]) for q in pts) < 2.5:
                k = p["t"].get("shop") or p["t"].get("amenity")
                if p["n"] not in [s[0] for s in inside]:
                    inside.append([p["n"], k, p["t"].get("brand", "")])
        king.append({"p": pts, "lv": lv, "ht": b.get("ht"), "n": n, "bt": bt, "s": inside})
    out["king"] = king
    print(f"  uptown: {len(king)} King St buildings, {sum(len(k['s']) for k in king)} shops in them")

    # the playing fields: soccer pitches (rectangles) and ball diamonds (fans:
    # the polygon fills well under its oriented box)
    def obb_fill(pts):
        best = None
        for i in range(len(pts)):
            a, c = pts[i], pts[(i + 1) % len(pts)]
            L = math.hypot(c[0] - a[0], c[1] - a[1])
            if L < 1:
                continue
            ux, uz = (c[0] - a[0]) / L, (c[1] - a[1]) / L
            us = [q[0] * ux + q[1] * uz for q in pts]
            vs = [-q[0] * uz + q[1] * ux for q in pts]
            Ab = (max(us) - min(us)) * (max(vs) - min(vs))
            if best is None or Ab < best:
                best = Ab
        return abs(_area(pts)) / best if best else 1
    pitches = {k: [] for k in PITCH_BOXES}
    for g in green:
        if g.get("k") != "pitch":
            continue
        cx, cz = cen(g["o"])
        for key, (x0, z0, x1, z1) in PITCH_BOXES.items():
            if x0 < cx < x1 and z0 < cz < z1:
                pts = _clean(g["o"])
                A = abs(_area(pts))
                if A < 1500 or re.search(r"Skatepark|Bike Park", g.get("n") or ""):
                    continue
                pitches[key].append({"n": g.get("n") or "", "p": pts, "d": obb_fill(pts) < 0.86 and 6 < len(pts) <= 14})
    out["pitches"] = pitches
    print(f"  fields: " + ", ".join(f"{k} {len(v)} ({sum(1 for p in v if p['d'])} diamonds)" for k, v in pitches.items()))
    return out


if __name__ == "__main__":
    main()
