/* Zombies regression gate.
 *
 *   python3 -m http.server 8765 &            # from the repo root
 *   node apps/zombies/verify.mjs             # needs playwright + a chromium
 *
 * Optional first arg overrides the URL. If your environment cannot reach
 * cdn.jsdelivr.net, serve a copy of the page with the importmap rewritten to a
 * local three.module.js (npm pack three@0.160.0) and point this at that copy —
 * everything asserted below is engine behaviour, not CDN behaviour.
 *
 * Exits non-zero on any failed check. Run it after touching navigation, the
 * round director, the hit shapes, or anything in the RIG.
 */
// default import, not named: playwright ships CJS and named-export interop
// is not reliable across install layouts
import pw from 'playwright';
const { chromium } = pw;

const URL = process.argv[2] || 'http://127.0.0.1:8765/apps/zombies/index.html?nosw=1';
const checks = [];
const check = (name, ok, detail) => { checks.push({ name, ok: !!ok, detail }); };

const browser = await chromium.launch({
  args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});
const page = await browser.newPage({ viewport: { width: 900, height: 420 } });
const pageErrors = [];
page.on('pageerror', e => pageErrors.push(String(e && e.stack || e)));
await page.goto(URL, { waitUntil: 'load' });
await page.waitForFunction(() => window.__dbg !== undefined, { timeout: 30000 }).catch(() => {});
if (!await page.evaluate(() => !!window.__dbg)) {
  console.error('BOOT FAILED\n' + pageErrors.join('\n'));
  console.error(await page.evaluate(() => document.getElementById('err')?.textContent || ''));
  await browser.close();
  process.exit(1);
}

/* A bot good enough to not report false failures. Two rules a human applies
   without thinking: only shoot what you can actually see, and stay on a target
   until it drops — re-picking the nearest body every frame in a crowd of 24
   spreads damage across all of them and kills none. */
await page.addScriptTag({ content: `
window.__aim = t => {
  const P = __dbg.Player.P;
  const want = Math.atan2(-(t.x - P.pos.x), -(t.z - P.pos.z));
  let d = want - P.yaw;
  while (d > Math.PI) d -= Math.PI * 2; while (d < -Math.PI) d += Math.PI * 2;
  __dbg.look(-d, 0);
  return Math.abs(d);
};
window.__botStep = (n, opts) => {
  opts = opts || {};
  const P = __dbg.Player.P;
  let maxAlive = 0;
  const visible = a => !a.dead && !__dbg.Level.losBlocked(P.pos.x, P.pos.z, a.pos.x, a.pos.z);
  for (let i = 0; i < n; i++) {
    if (!window.__tgt || !visible(window.__tgt)) {
      window.__tgt = __dbg.Zombies.list.filter(visible)
        .sort((a, b) => a.pos.distanceToSquared(P.pos) - b.pos.distanceToSquared(P.pos))[0] || null;
    }
    const z = window.__tgt;
    if (z) {
      const off = __aim(z.pos);
      const d = Math.hypot(z.pos.x - P.pos.x, z.pos.z - P.pos.z);
      __dbg.hold('fire', off < 0.18 && i % 3 !== 0);
      __dbg.move(0, d < 3.2 ? -1 : (d > 10 ? 0.7 : 0));
    } else { __dbg.hold('fire', false); __dbg.move(0, 0); }
    if (__dbg.Player.gun().ammo === 0) __dbg.tap('reload');
    if (opts.immortal) P.hp = 100;
    __dbg.stepN(1);
    if (opts.immortal) { P.hp = 100; P.dead = false; if (__dbg.Game.state === 'dying') __dbg.Game.state = 'play'; }
    maxAlive = Math.max(maxAlive, __dbg.Zombies.aliveCount);
  }
  return { maxAlive };
};
`});
await page.evaluate(() => __dbg.noRender(true));

// 1. a level shot at a body straight ahead must register as a headshot --------
const aim = await page.evaluate(() => {
  __dbg.start();
  const w = __dbg.Level.windows.find(x => x.zone === 'lobby');
  const z = __dbg.Zombies.spawn(w, 1);
  z.state = 'hunt'; z.pos.set(__dbg.Player.P.pos.x, 0, __dbg.Player.P.pos.z - 6);
  __dbg.Player.P.pitch = 0;
  __aim(z.pos); __dbg.stepN(1);
  const hp0 = z.hp;
  const eye = new __dbg.THREE.Vector3(), dir = new __dbg.THREE.Vector3();
  __dbg.Player.eyePos(eye); __dbg.Player.forward(dir);
  const rc = __dbg.Zombies.raycast(eye, dir, 60);
  for (let i = 0; i < 12; i++) { __dbg.hold('fire', i % 3 !== 0); __dbg.stepN(1); }
  __dbg.hold('fire', false);
  return { hit: !!rc, head: rc && rc.head, damaged: z.hp < hp0 };
});
check('level aim hits', aim.hit, aim);
check('level aim is a headshot', aim.head, aim);
check('shots do damage', aim.damaged, aim);

// 2. an idle player must die to round 1: spawn -> approach -> tear -> climb
//    -> hunt -> swing, the whole chain ---------------------------------------
const afk = await page.evaluate(() => {
  __dbg.start();
  for (let i = 0; i < 60 * 90; i++) { __dbg.stepN(1); if (__dbg.Player.P.dead) break; }
  const s = __dbg.snapshot();
  return { died: __dbg.Player.P.dead, t: s.time, torn: s.planks.filter(p => p < 6).length };
});
check('AFK player is killed by round 1', afk.died, afk);
check('zombies tear boards', afk.torn > 0, afk);

// 3. economy ------------------------------------------------------------------
const econ = await page.evaluate(() => {
  __dbg.start(); __dbg.points(20000);
  const before = __dbg.snapshot().zones.length;
  const after = __dbg.openAll().zones.length;
  __dbg.power();
  for (let i = 0; i < 200; i++) __dbg.stepN(1);
  __dbg.give('bar'); __dbg.give('trench');
  return { before, after, power: __dbg.snapshot().power, guns: __dbg.Player.P.guns.length };
});
check('barriers open every zone', econ.before === 1 && econ.after === 6, econ);
check('power turns on and fades in', econ.power, econ);
check('carrying two weapons max', econ.guns === 2, econ);

// 4. barricade repair pays out ------------------------------------------------
const repair = await page.evaluate(() => {
  __dbg.start();
  const w = __dbg.Level.windows.find(x => x.zone === 'lobby');
  w.planks = 0; __dbg.Level.refreshPlanks(w);
  __dbg.teleport(w.inside.x, w.inside.z);
  const p0 = __dbg.Player.P.points;
  __dbg.hold('useHeld', true);
  for (let i = 0; i < 60 * 5; i++) __dbg.stepN(1);
  __dbg.hold('useHeld', false);
  return { planks: w.planks, gained: __dbg.Player.P.points - p0 };
});
check('boards rebuild to full', repair.planks === 6, repair);
check('repair pays 10/board', repair.gained === 60, repair);

// 5. every window must be routable to the player from anywhere ----------------
const nav = await page.evaluate(() => {
  __dbg.start(); __dbg.openAll();
  const probe = () => __dbg.Level.windows
    .filter(w => !(__dbg.navAt(w.inside.x, w.inside.z) < 1e5)).map(w => w.id + ':' + w.zone);
  const out = {};
  __dbg.teleport(__dbg.Level.spawnPos.x, __dbg.Level.spawnPos.z); out.spawn = probe();
  __dbg.teleport(__dbg.Level.wx(5), __dbg.Level.wz(5)); out.lab = probe();
  __dbg.teleport(__dbg.Level.wx(37), __dbg.Level.wz(11)); out.gen = probe();
  return out;
});
check('all windows routable from spawn', nav.spawn.length === 0, nav.spawn);
check('all windows routable from lab', nav.lab.length === 0, nav.lab);
check('all windows routable from generator', nav.gen.length === 0, nav.gen);

// 6. rounds must keep advancing — this is the deadlock canary -----------------
const soak = await page.evaluate(() => {
  __dbg.start(); __dbg.points(999999); __dbg.openAll(); __dbg.power(); __dbg.give('bar');
  const marks = [];
  for (let c = 0; c < 9; c++) {
    __botStep(60 * 20, { immortal: true });
    const s = __dbg.snapshot();
    marks.push({ t: s.time | 0, round: s.round, kills: s.kills });
    __dbg.Player.gun().res = 9999;
  }
  return { marks, final: __dbg.snapshot() };
});
const rounds = soak.marks.map(m => m.round);
check('rounds advance past 3 in a 3 min soak', soak.final.round >= 4, rounds);
check('kills keep accruing (no deadlock)',
  soak.marks[soak.marks.length - 1].kills > soak.marks[3].kills, soak.marks.map(m => m.kills));

// 7. round scaling is monotonic and matches the classic curve -----------------
const ladder = await page.evaluate(() => {
  const Z = __dbg.Zombies, out = [];
  for (let r = 1; r <= 40; r++) out.push([r, Z.countFor(r), Z.healthFor(r)]);
  return out;
});
check('zombie count strictly increases', ladder.every((x, i) => i === 0 || x[1] > ladder[i - 1][1]));
check('health strictly increases', ladder.every((x, i) => i === 0 || x[2] > ladder[i - 1][2]));
check('round 1 health is 150', ladder[0][2] === 150, ladder[0]);
check('health compounds after round 9', ladder[19][2] > 2000 && ladder[29][2] > 6000,
  { r20: ladder[19][2], r30: ladder[29][2] });

// 8. death and restart --------------------------------------------------------
const death = await page.evaluate(() => {
  __dbg.start();
  __dbg.Player.hurt(999, null);
  const a = __dbg.snapshot();
  __dbg.start();
  const b = __dbg.snapshot();
  return { dying: a.state === 'dying', state: b.state, hp: b.hp, round: b.round,
           alive: b.alive, planks: b.planks.every(p => p === 6), zones: b.zones.length };
});
check('death enters the dying state', death.dying, death);
check('restart resets everything',
  death.state === 'play' && death.hp === 100 && death.round === 0 && death.alive === 0
  && death.planks && death.zones === 1, death);

// 9. no errors anywhere -------------------------------------------------------
const gameErrors = await page.evaluate(() => __dbg.errors);
check('no in-game errors', gameErrors.length === 0, gameErrors);
check('no uncaught page errors', pageErrors.length === 0, pageErrors);

await browser.close();

let failed = 0;
for (const c of checks) {
  if (!c.ok) failed++;
  console.log(`${c.ok ? 'PASS' : 'FAIL'}  ${c.name}${c.ok ? '' : '  ' + JSON.stringify(c.detail)}`);
}
console.log(`\n${checks.length - failed}/${checks.length} passed`);
process.exit(failed ? 1 : 0);
