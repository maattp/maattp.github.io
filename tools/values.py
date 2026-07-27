"""Value structure of a beauty shot, in LINEAR luminance.

    tools/.venv/bin/python tools/values.py <tag> [tag2]

Four passes of albedo tuning were spent on what turned out to be a missing
ambient term, because everything was being judged from the raw scene pass or by
eye. The post chain -- AO, grade, vignette -- is a large part of the final value
structure, so the only honest measurement is of the composited PNG.

Reports the lower half of the frame (the ground/urban fabric, not the sky) and
the ratio between the lit and shadowed quartiles, which is the number that says
whether shadow is reading as shade or as night. Daylight open-worlds of the
target era ran roughly 2.2-3.3:1.
"""
import sys
from pathlib import Path
from PIL import Image

def to_linear(v):
    v /= 255.0
    return v / 12.92 if v <= 0.04045 else ((v + 0.055) / 1.055) ** 2.4

LUT = [to_linear(i) for i in range(256)]

def stats(path):
    im = Image.open(path).convert('RGB')
    w, h = im.size
    px = im.load()
    lum = []
    for y in range(h // 2, h, 2):
        for x in range(0, w, 2):
            r, g, b = px[x, y]
            lum.append(0.2126 * LUT[r] + 0.7152 * LUT[g] + 0.0722 * LUT[b])
    lum.sort()
    n = len(lum)
    q = lambda p: lum[int(n * p)]
    lo = lum[: n // 4]
    hi = lum[3 * n // 4 :]
    shadow = lo[len(lo) // 2]
    lit = hi[len(hi) // 2]
    clipped = sum(1 for y in range(0, h, 2) for x in range(0, w, 2)
                  if min(px[x, y]) > 250) / ((h // 2) * (w // 2))
    return dict(p5=q(0.05), median=q(0.5), p95=q(0.95),
                shadow=shadow, lit=lit, ratio=lit / max(shadow, 1e-5),
                clip=clipped * 100)

for tag in sys.argv[1:]:
    d = Path('tools/data/beauty') / tag
    print(f'--- {tag}')
    print(f'{"shot":<12}{"p5":>8}{"median":>9}{"p95":>8}{"shadowQ":>9}{"litQ":>8}{"ratio":>7}{"clip%":>7}')
    for p in sorted(d.glob('*.png')):
        s = stats(p)
        print(f'{p.stem:<12}{s["p5"]:>8.4f}{s["median"]:>9.4f}{s["p95"]:>8.4f}'
              f'{s["shadow"]:>9.4f}{s["lit"]:>8.4f}{s["ratio"]:>7.1f}{s["clip"]:>7.2f}')
