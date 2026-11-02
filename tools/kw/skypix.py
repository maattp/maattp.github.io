"""Pixel proof for the aurora: python3 tools/kw/skypix.py <dir with pix-on.jpg, pix-off.jpg>
(shots from `VIEWS=tools/kw/skypix.json kwshots.mjs <dir>`). Counts pixels the aurora changed
and their coverage of the frame."""
import sys
from PIL import Image, ImageChops
d = sys.argv[1].rstrip('/') + '/'
a = Image.open(d + 'pix-on.jpg').convert('RGB')
b = Image.open(d + 'pix-off.jpg').convert('RGB')
df = ImageChops.difference(a, b).convert('L')
n = sum(1 for p in df.getdata() if p > 12)
tot = df.size[0] * df.size[1]
print('pixels changed by the aurora: %d of %d = %.1f%%' % (n, tot, 100 * n / tot))
sys.exit(0 if n > 0.02 * tot else 1)
