"""Contact sheets from tools/bldshots.mjs output.

    tools/.venv/bin/python tools/bldsheet.py <shotdir> [outdir] [--groups=a,b] [--pair=<otherdir>]

One sheet per group: each sample is a row of its eye-level and aerial views,
labelled with the building's style, size and position. With --pair, each row
carries the same building from a second run (before | after), matched by the
building's position, so a fix is judged on identical framing.
"""
import json
import sys
from pathlib import Path
from PIL import Image, ImageDraw

argv = [a for a in sys.argv[1:] if not a.startswith('--')]
opt = {a.split('=')[0][2:]: a.split('=', 1)[1] for a in sys.argv[1:] if a.startswith('--') and '=' in a}
src = Path(argv[0])
out = Path(argv[1]) if len(argv) > 1 else src
out.mkdir(parents=True, exist_ok=True)
pair = Path(opt['pair']) if 'pair' in opt else None

index = json.load(open(src / 'index.json'))
pidx = json.load(open(pair / 'index.json')) if pair else None
groups = []
for r in index:
    if r['group'] not in groups:
        groups.append(r['group'])
if 'groups' in opt:
    groups = [g for g in groups if g in opt['groups'].split(',')]

CW, BAR = 400, 18


def cell(p):
    im = Image.open(p).convert('RGB')
    return im.resize((CW, round(im.height * CW / im.width)), Image.LANCZOS)


def find(ix, g, x, z, view):
    for r in ix:
        if r['group'] == g and r['view'] == view and abs(r['x'] - x) <= 1 and abs(r['z'] - z) <= 1:
            return r
    return None


for g in groups:
    rows = sorted({r['k'] for r in index if r['group'] == g})
    ncol = 4 if pair else 2
    probe = cell(src / next(r['file'] for r in index if r['group'] == g))
    CH = probe.height
    sheet = Image.new('RGB', (CW * ncol, (CH + BAR) * len(rows) + 24), (20, 21, 23))
    d = ImageDraw.Draw(sheet)
    hdr = f'{g}' + ('   [before | after]' if pair else '')
    d.text((8, 5), hdr, fill=(240, 240, 240))
    for ri, k in enumerate(rows):
        y = 24 + ri * (CH + BAR)
        for vi, view in enumerate(('eye', 'air')):
            r = next((q for q in index if q['group'] == g and q['k'] == k and q['view'] == view), None)
            if not r:
                continue
            cols = [(src, r)]
            if pair:
                cols.append((pair, find(pidx, g, r['x'], r['z'], view)))
            for ci, (dd, rr) in enumerate(cols):
                x = (vi * len(cols) + ci) * CW
                if rr is None:
                    d.text((x + 8, y + 4), '(no match)', fill=(200, 120, 120))
                    continue
                lab = f"{rr['style']} {rr['w']}x{rr['d']}x{rr['h']} m @({rr['x']},{rr['z']}) {view}"
                d.text((x + 8, y + 3), lab, fill=(208, 212, 216))
                sheet.paste(cell(dd / rr['file']), (x, y + BAR))
    p = out / f"{g.replace(':', '_').replace('>', '_')}.jpg"
    sheet.save(p, quality=82, optimize=True)
    print(p, sheet.size)
