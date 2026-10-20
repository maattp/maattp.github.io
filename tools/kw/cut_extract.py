"""Ontario extract -> the map's box (plus margin), referentially complete.

    tools/.venv/bin/python tools/kw/cut_extract.py

Every later scan (osm_extract, bike paths, piers, park props, rail) reads the
small file instead of all of Ontario: about 10x faster each.
"""
import os
import sys
import time

import osmium

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from proj import bbox  # noqa: E402

HERE = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(HERE, "data", "ontario-latest.osm.pbf")
OUT = os.path.join(HERE, "data", "kw.osm.pbf")

if __name__ == "__main__":
    s, w, n, e = bbox(4000)
    if os.path.exists(OUT):
        os.remove(OUT)
    t0 = time.time()
    k = 0
    with osmium.ForwardReferenceWriter(OUT, SRC, back_references=True) as wr:
        for o in osmium.FileProcessor(SRC, osmium.osm.NODE):
            if s <= o.location.lat <= n and w <= o.location.lon <= e:
                wr.add_node(o)
                k += 1
    print(f"{k} nodes in the box, {os.path.getsize(OUT)/1e6:.0f} MB in {time.time()-t0:.0f}s")
