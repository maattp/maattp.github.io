"""Contact sheet from tools/vehshots.mjs output.

    tools/.venv/bin/python tools/vsheet.py <tag> [outdir]

Front and rear three-quarter of every type, tiled into a couple of pages so a
judge can compare craftsmanship across the whole fleet in one look instead of
opening thirty files.
"""
import sys
from pathlib import Path
from PIL import Image, ImageDraw

tag = sys.argv[1]
src = Path('tools/data/vehicles') / tag
out = Path(sys.argv[2]) if len(sys.argv) > 2 else src
out.mkdir(parents=True, exist_ok=True)

names = sorted({p.stem.rsplit('-', 1)[0] for p in src.glob('*.png')})
CW, BAR, COLS = 440, 20, 3

def cell(name, view):
    p = src / f'{name}-{view}.png'
    im = Image.open(p).convert('RGB')
    return im.resize((CW, round(im.height * CW / im.width)), Image.LANCZOS)

probe = cell(names[0], 'front')
CH = probe.height
rows = (len(names) + COLS - 1) // COLS

for view in ('front', 'rear'):
    sheet = Image.new('RGB', (CW * COLS, (CH + BAR) * rows), (20, 21, 23))
    d = ImageDraw.Draw(sheet)
    for i, n in enumerate(names):
        cx, cy = (i % COLS) * CW, (i // COLS) * (CH + BAR)
        d.text((cx + 8, cy + 5), f'{n}  ({view} 3/4)', fill=(208, 212, 216))
        sheet.paste(cell(n, view), (cx, cy + BAR))
    p = out / f'sheet-{view}.jpg'
    sheet.save(p, quality=88, optimize=True)
    print(p, sheet.size)
