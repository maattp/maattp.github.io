// The graphics pass's same-boot A/B (apps/autokw/src/gfx.js): writes a views
// file for kwshots.mjs where each named view of tools/kw/gfxviews.json is shot
// twice, `<name>-off` with the switch set and `<name>-on` without it, and
// optionally joins each pair side by side (off | on) into one jpg.
//
//   node tools/kw/gfxab.mjs views <flag> <name,name...> > ab.json
//   cat tools/kw/artseat.js tools/kw/nightseat.js tools/kw/gfxseat.js > pre.js
//   VIEW_PRE_FILE=pre.js VIEWS=ab.json AUTO_GPU=1 [AUTO_PHONE=1] node tools/kw/kwshots.mjs <dir>
//   node tools/kw/gfxab.mjs join <dir> <out-prefix> [width]   (needs python3 + PIL: tools/.venv)
//
// <flag> is a gfx.js switch without its window. prefix (noCarCoat, noWaterFx,
// noDuskHaze, noLampGlow, noGfx).

import { readFileSync, readdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const [mode, a, b, c] = process.argv.slice(2);
if (mode === 'views') {
  const flag = a, names = b.split(',');
  const all = JSON.parse(readFileSync(join(here, 'gfxviews.json'), 'utf8'));
  const out = [];
  for (const n of names) {
    const v = all.find((x) => x.name === n);
    if (!v) throw new Error('no view ' + n);
    for (const off of [true, false]) {
      const e = { ...v, name: `${n}-${off ? 'off' : 'on'}` };
      e.eval = `window.__${flag} = ${off}; ` + (v.eval || '');
      out.push(e);
    }
  }
  process.stdout.write(JSON.stringify(out, null, 1));
} else if (mode === 'join') {
  const dir = a, prefix = b, width = +(c || 1600);
  const offs = readdirSync(dir).filter((f) => f.endsWith('-off.jpg'));
  const py = `
import sys
from PIL import Image, ImageDraw
d, pre, W = sys.argv[1], sys.argv[2], int(sys.argv[3])
for f in sys.argv[4:]:
    a = Image.open(f'{d}/{f}').convert('RGB'); bb = Image.open(f'{d}/{f.replace("-off.jpg", "-on.jpg")}').convert('RGB')
    h = int(a.height * (W / 2) / a.width)
    a = a.resize((W // 2, h), Image.LANCZOS); bb = bb.resize((W // 2, h), Image.LANCZOS)
    im = Image.new('RGB', (W, h)); im.paste(a, (0, 0)); im.paste(bb, (W // 2, 0))
    g = ImageDraw.Draw(im)
    for x, t in ((8, 'before'), (W // 2 + 8, 'after')):
        g.rectangle((x - 4, 4, x + 52, 22), fill=(0, 0, 0)); g.text((x, 7), t, fill=(255, 255, 255))
    name = f.replace('-off.jpg', '')
    im.save(f'{pre}{name}.jpg', quality=82)
    print(f'{pre}{name}.jpg')
`;
  const venv = join(here, '..', '.venv', 'bin', 'python');
  let pyBin = 'python3';
  try { readFileSync(venv); pyBin = venv; } catch { /* worktree: no venv here */ }
  if (process.env.GFX_PY) pyBin = process.env.GFX_PY;
  process.stdout.write(execFileSync(pyBin, ['-c', py, dir, prefix, String(width), ...offs]).toString());
} else {
  console.log('usage: gfxab.mjs views <flag> <names> | join <dir> <prefix> [width]');
}
