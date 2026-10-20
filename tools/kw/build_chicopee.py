"""Chicopee Ski & Summer Resort -> apps/autokw/data/chicopee.json.

    tools/.venv/bin/python tools/kw/build_chicopee.py

From OSM (tools/kw/data/raw_trails.json): the ski runs (piste:type=downhill),
which in October are the bike park's downhill lines; the chairlifts and
surface lifts; the tube park; and the paths through the woods round the hill,
which are the cross-country loop. src/chicopee.js draws and rides them.
"""

import json
import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from proj import to_world  # noqa: E402

HERE = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.join(HERE, "data")
OUT = os.path.join(HERE, "..", "..", "apps", "autokw", "data")

CENTRE = (43.42770, -80.42260)   # the hill, between the lodge and the summit
R = 900


def main():
    cx, cz = to_world(*CENTRE)
    trails = json.load(open(os.path.join(DATA, "raw_trails.json")))["trails"]
    near = lambda t: any(math.hypot(q[0] - cx, q[1] - cz) < R for q in t["p"])  # noqa: E731
    L = lambda p: sum(math.hypot(b[0] - a[0], b[1] - a[1]) for a, b in zip(p, p[1:]))  # noqa: E731
    runs, lifts, paths, tube = [], [], [], None
    for t in trails:
        if not near(t):
            continue
        p = [[round(x, 1), round(z, 1)] for x, z in t["p"]]
        if t.get("pi") == "downhill" and L(p) > 60:
            runs.append({"n": t.get("n") or "", "p": p})
        elif t.get("aw"):
            lifts.append({"n": t.get("n") or "", "k": t["aw"], "p": [p[0], p[-1]]})
        elif t.get("pi") == "sled":
            tube = {"n": t.get("n") or "Tube Park", "p": p}
        elif t["k"] in ("path", "track") and L(p) > 40:
            paths.append({"n": t.get("n") or "", "p": p})
    doc = {"centre": [round(cx), round(cz)], "runs": runs, "lifts": lifts, "paths": paths, "tube": tube}
    out = os.path.join(OUT, "chicopee.json")
    with open(out, "w") as f:
        json.dump(doc, f, separators=(",", ":"))
    print(f"chicopee.json {os.path.getsize(out) // 1024} KB: {len(runs)} runs, {len(lifts)} lifts, "
          f"{len(paths)} paths ({sum(L(q['p']) for q in paths) / 1000:.1f} km), tube {'yes' if tube else 'no'}")
    assert len(runs) >= 8 and len(lifts) >= 3


if __name__ == "__main__":
    main()
