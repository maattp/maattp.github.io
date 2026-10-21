"""The chain stores where they really are -> apps/autokw/data/shops.json.

    tools/.venv/bin/python tools/kw/extract_shops.py     (once: raw_shops.json)
    tools/.venv/bin/python tools/kw/build_shops.py

Every LCBO, Beer Store, Walmart, Canadian Tire, Costco, Home Depot, RONA,
grocery store, pharmacy, big-box, chain restaurant, gas station and bank on
the map (BRANDS: OSM's brand tag, else its name), each matched to the
building it is in -- the OSM building polygon the store IS, else the one
containing its node, else the nearest shop-like building within 40 m -- and
the plaza it stands in (shop=mall or a named landuse=retail outline).
`tools/kw/kw_shops_official.json` (store locators, Oct 2026) adds the stores
of the brands that matter most that OSM lacks. src/kwshops.js draws them.

  stores  [key, x, z, bx, bz, plaza, addr, name]   bx/bz: the building's centroid
                                                    (null: no building, kwshops builds one)
          for a gas station bx/bz is its CANOPY (OSM building=roof), else null
  plazas  [{n, x, z, o: outline, ten: [tenant names, anchors first],
           sh?: [[name, x, z], ...] the independents (no brand here) outside kw.js's zones: their fascia signs}]
  names   lowercase brand/name strings handled here (kw.js's zone storefronts skip them)
  fronts  [[bx, bz, kind, [[name, x, z], ...], who, [dx, dz] toward the street it faces or null], ...] every other building with a store in it,
          outside the plazas and kw.js's zones (storefronts(): Hespeler Rd's strip, the pads, the dealers)
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
OUT = os.path.join(HERE, "..", "..", "apps", "autokw", "data", "shops.json")

# key: (brand strings, matched case-insensitively against brand then name)
BRANDS = {
    # big boxes and department stores
    "walmart": ["Walmart", "Walmart Supercentre", "Walmart Supercenter"],
    "costco": ["Costco", "Costco Wholesale"],
    "ct": ["Canadian Tire"],
    "homedepot": ["The Home Depot", "Home Depot"],
    "rona": ["Rona", "Rona+", "RONA", "RONA+", "Lowe's"],
    "bestbuy": ["Best Buy"],
    "staples": ["Staples"],
    "winners": ["Winners"],
    "homesense": ["HomeSense"],
    "marshalls": ["Marshalls"],
    "valuevillage": ["Value Village"],
    "dollarama": ["Dollarama"],
    "giant": ["Giant Tiger"],
    "sportchek": ["Sport Chek"],
    "shoppers": ["Shoppers Drug Mart"],
    "rexall": ["Rexall"],
    "pharmasave": ["Pharmasave"],
    "dollartree": ["Dollar Tree"],
    "bulkbarn": ["Bulk Barn"],
    "petvalu": ["Pet Valu"],
    "petsmart": ["PetSmart"],
    "michaels": ["Michaels"],
    "marks": ["Mark's", "Mark's Work Wearhouse"],
    "indigo": ["Indigo", "Chapters"],
    "homehardware": ["Home Hardware", "Home Hardware Building Centre"],
    "brick": ["The Brick"],
    "leons": ["Leon's"],
    "golftown": ["Golf Town"],
    # groceries
    "zehrs": ["Zehrs"],
    "sobeys": ["Sobeys"],
    "foodbasics": ["Food Basics"],
    "nofrills": ["No Frills"],
    "superstore": ["Real Canadian Superstore"],
    "independent": ["Your Independent Grocer"],
    "farmboy": ["Farm Boy"],
    "longos": ["Longo's"],
    "tnt": ["T&T Supermarket", "T&T", "大統華 T&T Supermarket"],
    # beer, wine and spirits
    "lcbo": ["LCBO"],
    "beer": ["The Beer Store", "Beer Store"],
    # restaurants
    "mcd": ["McDonald's"],
    "harveys": ["Harvey's"],
    "aw": ["A&W"],
    "swiss": ["Swiss Chalet"],
    "bp": ["Boston Pizza"],
    "montanas": ["Montana's", "Montana's BBQ & Bar"],
    "esm": ["East Side Mario's"],
    "starbucks": ["Starbucks"],
    "wendys": ["Wendy's"],
    "bk": ["Burger King"],
    "kfc": ["KFC"],
    "subway": ["Subway"],
    "dq": ["Dairy Queen"],
    "pizzapizza": ["Pizza Pizza"],
    "popeyes": ["Popeyes", "Popeyes Louisiana Kitchen"],
    # banks
    "td": ["TD", "TD Canada Trust", "TD Bank"],
    "rbc": ["RBC", "RBC Royal Bank", "Royal Bank of Canada"],
    "cibc": ["CIBC"],
    "bmo": ["BMO", "BMO Bank of Montreal", "Bank of Montreal"],
    "scotia": ["Scotiabank"],
}
# gas stations: amenity=fuel, by brand
GAS = {
    "esso": ["Esso"], "petro": ["Petro-Canada", "Petro Canada"], "shell": ["Shell"], "pioneer": ["Pioneer"],
    "ultramar": ["Ultramar"], "ctgas": ["Canadian Tire", "Canadian Tire Gas+", "Gas+"], "costcogas": ["Costco", "Costco Gasoline"],
    "mobil": ["Mobil"], "husky": ["Husky"], "circlek": ["Circle K"],
}
# a store inside another's (Costco's food court, Walmart's pharmacy): not a store of its own
INSIDE = re.compile(r"Pharmacy|Food Court|Tire Centre|Garden Centre|Optical|Photo|Bakery|Auto Centre|Express$|Mobile$", re.I)
# the brands a plaza's pylon lists first
ANCHOR = ["walmart", "costco", "ct", "homedepot", "rona", "zehrs", "sobeys", "foodbasics", "nofrills", "superstore", "independent",
          "farmboy", "longos", "tnt", "bestbuy", "winners", "homesense", "marshalls", "staples", "lcbo", "beer", "shoppers",
          "valuevillage", "sportchek", "michaels", "petsmart", "marks", "indigo", "brick", "leons", "homehardware", "golftown",
          "giant", "bulkbarn", "dollarama", "dollartree", "rexall", "pharmasave", "petvalu"]

# brands whose official list is complete (kw_shops_official.json): OSM stores off it are closed
AUTHORITATIVE = {"lcbo", "beer", "walmart", "costco", "homedepot", "zehrs"}

SHOPLIKE = {"yes", "retail", "commercial", "supermarket", "roof", "industrial", "warehouse", "office", "kiosk", "service"}


def norm(s):
    return re.sub(r"\s+", " ", (s or "").strip().lower().replace("’", "'"))


def table(d):
    out = {}
    for k, names in d.items():
        for n in names:
            out[norm(n)] = k
    return out


BT, GT = table(BRANDS), table(GAS)
# kw.js's detail zones (build_kw.py ZONES): their storefronts are signed there
from build_kw import ZONES  # noqa: E402
ZONES_W = [(*to_world(la, lo), r) for _, la, lo, r in ZONES]


def classify(s):
    t = s["t"]
    b, n = norm(t.get("brand")), norm(s["n"])
    if t.get("amenity") == "fuel":
        return GT.get(b) or GT.get(n)
    if INSIDE.search(s["n"]) and (b in BT or any(n.startswith(k) for k in BT)):
        return None
    k = BT.get(b) or BT.get(n)
    if not k:
        return None
    # a bank's brand on an ATM in a plaza is not a branch
    if t.get("amenity") == "atm":
        return None
    return k


def in_poly(p, x, z):
    c = False
    j = len(p) - 1
    for i in range(len(p)):
        if (p[i][1] > z) != (p[j][1] > z) and x < (p[j][0] - p[i][0]) * (z - p[i][1]) / (p[j][1] - p[i][1]) + p[i][0]:
            c = not c
        j = i
    return c


def area(p):
    a = 0.0
    for i in range(len(p)):
        j = (i + 1) % len(p)
        a += p[i][0] * p[j][1] - p[j][0] * p[i][1]
    return abs(a) / 2


def cen(p):
    return sum(q[0] for q in p) / len(p), sum(q[1] for q in p) / len(p)


def edge_dist(p, x, z):
    m = 1e9
    for i in range(len(p)):
        a, b = p[i], p[(i + 1) % len(p)]
        dx, dz = b[0] - a[0], b[1] - a[1]
        L2 = dx * dx + dz * dz or 1.0
        t = max(0.0, min(1.0, ((x - a[0]) * dx + (z - a[1]) * dz) / L2))
        m = min(m, math.hypot(x - a[0] - dx * t, z - a[1] - dz * t))
    return m


def simplify(p, tol=3.0):
    """Douglas-Peucker on a closed ring."""
    if len(p) < 8:
        return p
    def dp(pts):
        if len(pts) < 3:
            return pts
        a, b = pts[0], pts[-1]
        dx, dz = b[0] - a[0], b[1] - a[1]
        L = math.hypot(dx, dz) or 1.0
        best, bi = -1, 0
        for i in range(1, len(pts) - 1):
            d = abs((pts[i][0] - a[0]) * dz - (pts[i][1] - a[1]) * dx) / L
            if d > best:
                best, bi = d, i
        if best < tol:
            return [a, b]
        return dp(pts[:bi + 1])[:-1] + dp(pts[bi:])
    k = max(range(len(p)), key=lambda i: math.hypot(p[i][0] - p[0][0], p[i][1] - p[0][1]))
    out = dp(p[:k + 1])[:-1] + dp(p[k:] + [p[0]])[:-1]
    return out if len(out) >= 3 else p


class Grid:
    def __init__(self, items, cell=100):
        self.cell, self.g = cell, {}
        for i, it in enumerate(items):
            xs = [q[0] for q in it["o"]]
            zs = [q[1] for q in it["o"]]
            for gx in range(int(min(xs) // cell), int(max(xs) // cell) + 1):
                for gz in range(int(min(zs) // cell), int(max(zs) // cell) + 1):
                    self.g.setdefault((gx, gz), []).append(i)

    def near(self, x, z, r):
        c = self.cell
        out = set()
        for gx in range(int((x - r) // c), int((x + r) // c) + 1):
            for gz in range(int((z - r) // c), int((z + r) // c) + 1):
                out.update(self.g.get((gx, gz), ()))
        return out


# --- the storefronts outside the plazas ----------------------------------------
# Every building with a store in it that no named plaza holds (Hespeler Rd's
# strip, the fast-food pads, the dealers on the auto rows, the banks on their
# pads, the gas stations' kiosks): the building, what kind of front it has
# and its tenants' names, so kwshops.js draws it as a one-storey store with
# glass, a door and its signs instead of world.js's office or flats.
FRONT_BT = {"yes", "retail", "commercial", "supermarket", "shop", "kiosk", "service", "industrial", "warehouse"}
FOOD = {"fast_food", "cafe", "ice_cream"}
AUTO = {"car_repair", "tyres", "car_wash"}


def storefronts(raw, blds, BG, plazas, used, inmap):
    """[[bx, bz, kind, tenants, who, facing]] kind: s strip, f food pad, b bank, c dealer, a auto service, k gas kiosk.
    tenants: [[name, x, z], ...] the ones with no brand drawn here (they are lettered).
    who: a dealer's make (OSM brand, else its name), a kiosk's gas brand key, a pad's brand key or name."""
    def bld_at(x, z, r=12.0):
        best, bd = None, 1e9
        for i in BG.near(x, z, r + 5):
            b = blds[i]
            if b["A"] < 40 or b["A"] > 16000:
                continue
            if in_poly(b["o"], x, z):
                d = -1.0 / b["A"]
            else:
                d = edge_dist(b["o"], x, z)
                if d > r:
                    continue
            if d < bd:
                best, bd = i, d
        return best

    def ok_bld(b):
        if b.get("bt", "yes") not in FRONT_BT:
            return False
        try:
            if float(str(b.get("lv", "1")).split(";")[0]) >= 3:
                return False
        except ValueError:
            pass
        return not re.search(r"Motel|Hotel|Inn\b|Suites|Church|School|Hospital|Clinic|Centre for|Office|Tower|Apartments", b.get("n", ""))

    groups = {}
    in_used_plaza = lambda x, z: any(i in used and in_poly(plazas[i]["o"], x, z) for i in range(len(plazas)))
    for s in raw["stores"]:
        x, z, t, nm = s["x"], s["z"], s["t"], s["n"]
        if not inmap(x, z) or t.get("amenity") in ("atm",) or t.get("shop") in ("vacant", "mall") or len(nm) > 30:
            continue
        if any(math.hypot(x - zx, z - zz) < zr for zx, zz, zr in ZONES_W) or in_used_plaza(x, z):
            continue
        if INSIDE.search(nm):
            continue
        bi = bld_at(x, z)
        if bi is None or not ok_bld(blds[bi]):
            continue
        g = groups.setdefault(bi, {"t": [], "kinds": []})
        if any(norm(q[0]) == norm(nm) for q in g["t"]):
            continue
        g["t"].append([nm, round(x, 1), round(z, 1), classify(s) or "", t.get("shop") or t.get("amenity") or "", t.get("brand", ""), t.get("addr:street", "")])
    # the gas stations' kiosks: the small building by each station's canopy
    for s in raw["stores"]:
        if s["t"].get("amenity") != "fuel" or not inmap(s["x"], s["z"]):
            continue
        x, z = s["x"], s["z"]
        best, bd = None, 46.0
        for i in BG.near(x, z, 50):
            b = blds[i]
            if b.get("bt", "yes") in ("roof", "house", "residential", "garage", "garages", "shed", "carport") or not (35 < b["A"] < 800):
                continue
            cx, cz = cen(b["o"])
            d = math.hypot(cx - x, cz - z)
            if d < bd and ok_bld(b):
                best, bd = i, d
        if best is None:
            continue
        g = groups.setdefault(best, {"t": [], "kinds": []})
        g["gas"] = GT.get(norm(s["t"].get("brand"))) or GT.get(norm(s["n"])) or ""
    out = []
    for bi, g in groups.items():
        b = blds[bi]
        ten = g["t"]
        kinds = [q[4] for q in ten]
        if "gas" in g and len(ten) <= 2:
            kind = "k"
        elif "car" in kinds:
            kind = "c"
        elif len(ten) == 1 and kinds[0] == "bank" and b["A"] < 1400:
            kind = "b"
        elif len(ten) == 1 and b["A"] < 900 and (kinds[0] in FOOD or (kinds[0] == "restaurant" and b["A"] < 520)):
            kind = "f"
        elif ten and all(k in AUTO for k in kinds) and b["A"] < 3000:
            kind = "a"
        else:
            kind = "s"
        if kind == "s" and not ten:
            continue
        cx, cz = cen(b["o"])
        sh = [q[:3] for q in ten if not q[3] and not re.search(r"Tim Horton|FreshCo", q[0])]
        rec = [round(cx, 1), round(cz, 1), kind, sh]
        if kind == "c":
            car = next(q for q in ten if q[4] == "car")
            rec.append(car[5] or car[0])
        elif kind == "k":
            rec.append(g["gas"])
        elif kind in "fba":
            # a pad's one tenant: its brand drawn here (its colours), else its name
            rec.append(ten[0][3] or ten[0][0])
        else:
            rec.append("")
        # the street it faces: its tenants' addr:street, else the nearest street -- (dx, dz) toward it
        streets = [q[6] for q in ten if q[6]]
        d = toward(cx, cz, max(set(streets), key=streets.count) if streets else None)
        rec.append([round(d[0], 2), round(d[1], 2)] if d else None)
        out.append(rec)
    out.sort(key=lambda r: (r[0], r[1]))
    return out


ABBR = {"rd": "road", "st": "street", "dr": "drive", "ave": "avenue", "av": "avenue", "blvd": "boulevard", "cres": "crescent",
        "ct": "court", "pkwy": "parkway", "hwy": "highway", "n": "north", "s": "south", "e": "east", "w": "west"}


def street_key(s):
    return " ".join(ABBR.get(w, w) for w in re.sub(r"[.,]", " ", norm(s)).split())


ROADS = None


def toward(x, z, street, r_named=250.0, r_any=120.0):
    """Unit (dx, dz) from (x, z) to the nearest point of the street of that name, else of any street; None if none near."""
    global ROADS
    if ROADS is None:
        rs = json.load(open(os.path.join(DATA, "raw_roads.json")))["roads"]
        keep = {"primary", "secondary", "tertiary", "unclassified", "residential", "trunk", "living_street"}
        ROADS = {"seg": [], "grid": {}}
        for r in rs:
            if r["cls"] not in keep:
                continue
            k = street_key(r.get("name") or "")
            for a, b in zip(r["p"], r["p"][1:]):
                i = len(ROADS["seg"])
                ROADS["seg"].append((a, b, k))
                for gx in range(int(min(a[0], b[0]) // 100), int(max(a[0], b[0]) // 100) + 1):
                    for gz in range(int(min(a[1], b[1]) // 100), int(max(a[1], b[1]) // 100) + 1):
                        ROADS["grid"].setdefault((gx, gz), []).append(i)
    want = street_key(street) if street else None
    best = {}
    R = int(r_named // 100) + 1
    seen = set()
    for gx in range(int(x // 100) - R, int(x // 100) + R + 1):
        for gz in range(int(z // 100) - R, int(z // 100) + R + 1):
            for i in ROADS["grid"].get((gx, gz), ()):
                if i in seen:
                    continue
                seen.add(i)
                a, b, k = ROADS["seg"][i]
                dx, dz = b[0] - a[0], b[1] - a[1]
                L2 = dx * dx + dz * dz or 1.0
                t = max(0.0, min(1.0, ((x - a[0]) * dx + (z - a[1]) * dz) / L2))
                qx, qz = a[0] + dx * t, a[1] + dz * t
                d = math.hypot(qx - x, qz - z)
                for tag in (("named",) if want and k == want else ()) + ("any",):
                    if d < best.get(tag, (1e9,))[0]:
                        best[tag] = (d, qx, qz)
    hit = best.get("named") if "named" in best and best["named"][0] < r_named else best.get("any") if "any" in best and best["any"][0] < r_any else None
    if not hit or hit[0] < 1:
        return None
    return ((hit[1] - x) / hit[0], (hit[2] - z) / hit[0])


def main():
    raw = json.load(open(os.path.join(DATA, "raw_shops.json")))
    blds = [b for b in json.load(open(os.path.join(DATA, "raw_buildings.json")))["buildings"] if len(b["o"]) >= 3]
    for b in blds:
        b["A"] = area(b["o"])
    BG = Grid(blds)
    inmap = lambda x, z: abs(x) < MAP_HALF - 60 and abs(z) < MAP_HALF - 60

    def building_for(x, z, poly=None, gas=False):
        """The building a store is in: (centroid, area) or None."""
        if poly is not None and not gas:
            return cen(poly), area(poly)
        best, bd = None, 1e9
        for i in BG.near(x, z, 45):
            b = blds[i]
            bt = b.get("bt", "yes")
            if gas:
                # the canopy: OSM's building=roof at the station
                if bt != "roof" or not (60 < b["A"] < 1500):
                    continue
                d = 0 if in_poly(b["o"], x, z) else edge_dist(b["o"], x, z)
                if d < 45 and d < bd:
                    best, bd = b, d
                continue
            if bt not in SHOPLIKE or bt == "roof" or b["A"] < 70:
                continue
            if in_poly(b["o"], x, z):
                d = -1.0 / b["A"]          # inside: the smallest that holds it
            else:
                d = edge_dist(b["o"], x, z)
                if d > 40:
                    continue
            if d < bd:
                best, bd = b, d
        return (cen(best["o"]), best["A"]) if best else None

    # the plazas
    plazas = []
    for p in raw["plazas"]:
        A = area(p["o"])
        if A < 3000 or p["t"].get("shop") == "car" or re.search(r"Nursery|Garden|Motors|GMC|Tesla|Night Club|Corporate|Business Centre|Equipment|Farm Market|Hardware", p["n"]):
            continue
        cx, cz = cen(p["o"])
        if not inmap(cx, cz):
            continue
        plazas.append({"n": p["n"], "x": round(cx, 1), "z": round(cz, 1), "o": [[round(q[0], 1), round(q[1], 1)] for q in simplify(p["o"])],
                       "A": A, "ten": [], "_t": [], "_s": []})
    plazas.sort(key=lambda p: p["A"])     # a point in two plazas belongs to the smaller

    def plaza_of(x, z):
        for i, p in enumerate(plazas):
            if in_poly(p["o"], x, z):
                return i
        return -1

    stores = []
    names = set()
    for s in raw["stores"]:
        x, z = s["x"], s["z"]
        if not inmap(x, z):
            continue
        k = classify(s)
        pi = plaza_of(x, z)
        nm = s["n"]
        if pi >= 0 and s["t"].get("amenity") != "fuel" and not INSIDE.search(nm) and nm.lower() not in ("atm",) and s["t"].get("amenity") != "atm":
            ten = plazas[pi]["_t"]
            if not any(norm(t[1]) == norm(nm) for t in ten):
                ten.append((ANCHOR.index(k) if k in ANCHOR else 50 + (0 if k else 20), nm))
            # the independents' storefront signs (kw.js signs the detail zones' own, and Tims and FreshCo)
            if not k and len(nm) <= 30 and not re.search(r"Tim Horton|FreshCo", nm) and not any(math.hypot(x - zx, z - zz) < zr for zx, zz, zr in ZONES_W):
                fas = plazas[pi]["_s"]
                if not any(norm(f[0]) == norm(nm) for f in fas):
                    fas.append([nm, round(x, 1), round(z, 1)])
        if not k:
            continue
        names.add(norm(s["t"].get("brand") or nm))
        names.add(norm(nm))
        t = s["t"]
        addr = " ".join(v for v in (t.get("addr:housenumber"), t.get("addr:street")) if v)
        gas = k in GAS
        poly = s.get("o") if (s.get("o") and t.get("building")) else None
        bl = building_for(x, z, poly, gas)
        dup = next((o for o in stores if o["k"] == k and math.hypot(o["x"] - x, o["z"] - z) < (90 if k in ANCHOR else 50)), None)
        rec = {"k": k, "x": x, "z": z, "b": bl, "p": pi, "addr": addr, "n": nm, "poly": poly is not None}
        if dup:
            # keep the one that is the building, then the addressed one
            better = (rec["poly"] and not dup["poly"]) or (bool(addr) and not dup["addr"] and rec["poly"] == dup["poly"])
            if better:
                dup.update(rec)
            elif addr and not dup["addr"]:
                dup["addr"] = addr
            continue
        stores.append(rec)

    # the official lists: stores OSM lacks (kw_shops_official.json, brand -> [[lat, lon, addr], ...])
    off_path = os.path.join(HERE, "kw_shops_official.json")
    added = {}
    if os.path.exists(off_path):
        off = json.load(open(off_path))
        for brand, rows in off.items():
            if not isinstance(rows, list):
                continue
            k = BT.get(norm(brand)) or GT.get(norm(brand))
            if not k:
                continue
            for la, lo, addr, *_ in rows:
                x, z = to_world(la, lo)
                if not inmap(x, z):
                    continue
                o = next((o for o in stores if o["k"] == k and math.hypot(o["x"] - x, o["z"] - z) < 160), None)
                if o:
                    if not o["addr"] or len(o["addr"]) < 6:
                        o["addr"] = addr.split(",")[0]
                    continue
                bl = building_for(x, z, None, k in GAS)
                stores.append({"k": k, "x": x, "z": z, "b": bl, "p": plaza_of(x, z), "addr": addr.split(",")[0], "n": brand, "poly": False})
                added[k] = added.get(k, 0) + 1

        # the complete official lists are authoritative: an OSM store none of
        # them has (The Beer Store at 130 Cedar St, Cambridge closed in 2025) is gone
        have = {BT.get(norm(b)) or GT.get(norm(b)) for b in off if isinstance(off[b], list) and off[b]}
        for k in AUTHORITATIVE & have:
            pts = [to_world(r[0], r[1]) for b, rows in off.items() if isinstance(rows, list) and (BT.get(norm(b)) or GT.get(norm(b))) == k for r in rows]
            keep = [o for o in stores if o["k"] != k or any(math.hypot(o["x"] - x, o["z"] - z) < 160 for x, z in pts)]
            if len(keep) < len(stores):
                print(f"  {k}: {len(stores) - len(keep)} OSM store(s) not on the official list dropped")
            stores = keep

    for p in plazas:
        p["ten"] = [n for _, n in sorted(p.pop("_t"), key=lambda t: t[0])][:12]
        fas = p.pop("_s")
        if fas:
            p["sh"] = fas[:18]
        p.pop("A")
    used = sorted({s["p"] for s in stores if s["p"] >= 0} | {i for i, p in enumerate(plazas) if len(p["ten"]) >= 3})
    remap = {o: i for i, o in enumerate(used)}
    out_plazas = [plazas[i] for i in used]
    fronts = storefronts(raw, blds, BG, plazas, set(used), inmap)
    out = []
    for s in stores:
        b = s["b"]
        out.append([s["k"], round(s["x"], 1), round(s["z"], 1), round(b[0][0], 1) if b else None, round(b[0][1], 1) if b else None,
                    remap.get(s["p"], -1), s["addr"], s["n"]])
    doc = {"stores": out, "plazas": out_plazas, "names": sorted(names), "fronts": fronts}
    with open(OUT, "w") as f:
        json.dump(doc, f, separators=(",", ":"), ensure_ascii=False)
    by = {}
    for s in out:
        by[s[0]] = by.get(s[0], 0) + 1
    print(f"shops.json {os.path.getsize(OUT) // 1024} KB: {len(out)} stores in {len(by)} brands, {len(out_plazas)} plazas; "
          f"{sum(1 for s in out if s[3] is None)} with no building")
    print("  " + ", ".join(f"{k} {v}" for k, v in sorted(by.items(), key=lambda kv: -kv[1])))
    fk = {}
    for f in fronts:
        fk[f[2]] = fk.get(f[2], 0) + 1
    print(f"  storefronts outside the plazas: {len(fronts)} buildings ({fk}), {sum(len(f[3]) for f in fronts)} names to letter")
    if added:
        print("  from the official lists: " + ", ".join(f"{k} +{v}" for k, v in added.items()))
    for k in ("lcbo", "beer", "walmart"):
        assert by.get(k, 0) >= 5, f"{k} missing"


if __name__ == "__main__":
    main()
