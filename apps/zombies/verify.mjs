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
  // long enough to clear the semi-auto's fire cooldown several times over
  for (let i = 0; i < 40; i++) { __aim(z.pos); __dbg.hold('fire', i % 3 !== 0); __dbg.stepN(1); }
  __dbg.hold('fire', false);
  return { hit: !!rc, head: rc && rc.head, damaged: z.hp < hp0, scale: +z.scale.toFixed(3) };
});
check('level aim hits', aim.hit, aim);
check('level aim is a headshot', aim.head, aim);
check('shots do damage', aim.damaged, aim);

// 1b. HIT-SHAPE INVARIANT — a level shot must be a headshot at every body
//     scale. This is deterministic on purpose: the probabilistic shot test
//     above only caught the small-zombie miss about one run in four, because
//     whether it connected came down to random spread.
const rig = await page.evaluate(() => {
  const D = __dbg, P = D.Player.P;
  const w = D.Level.windows.find(x => x.zone === 'lobby');
  const eye = new D.THREE.Vector3(), dir = new D.THREE.Vector3();
  // sample the ACTUAL per-body scale jitter rather than hardcoding it, so
  // widening the range later cannot slip past this check
  D.start(); D.Zombies.reset();
  let lo = 9, hi = 0;
  for (let i = 0; i < 400; i++) {
    const z = D.Zombies.spawn(w, 1);
    if (!z) { D.Zombies.reset(); continue; }
    lo = Math.min(lo, z.scale); hi = Math.max(hi, z.scale);
  }
  D.Zombies.reset();
  const out = [];
  for (const sc of [lo, (lo + hi) / 2, hi]) {
    D.start(); D.Zombies.reset();
    const z = D.Zombies.spawn(w, 1);
    z.state = 'hunt'; z.scale = sc;
    z.pos.set(P.pos.x, 0, P.pos.z - 5);
    P.pitch = 0; P.yaw = 0;                       // forward = -z, straight at it
    D.stepN(1);
    D.Player.eyePos(eye); D.Player.forward(dir);
    const rc = D.Zombies.raycast(eye, dir, 40);
    out.push({ sc: +sc.toFixed(3), hit: !!rc, head: !!(rc && rc.head) });
  }
  return out;
});
check('level shot is a headshot at every body scale',
  rig.every(r => r.hit && r.head), rig);

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
const kills = soak.marks.map(m => m.kills);
check('rounds advance past 3 in a 3 min soak', soak.final.round >= 4, rounds);
/* Deadlock canary. Compare EVERY interval, not just first-vs-last: the bot is
   stochastic and a single slow stretch (a reload cycle against a crowd on the
   far side of a wall) made a first-vs-last comparison fail about one run in
   four. What actually distinguishes "wedged forever" from "having a bad
   minute" is whether progress resumes, so require most intervals to advance. */
const advancing = kills.filter((k, i) => i > 0 && k > kills[i - 1]).length;
check('kills keep accruing (no deadlock)', advancing >= kills.length - 3,
  { kills, advancing, needed: kills.length - 3 });

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

// 7b. EARLY-ROUND FAIRNESS -------------------------------------------------------
// A player reported round 2 being hard. The measurable form of that complaint:
// the starting kit must be able to clear the opening rounds at all. Round 3 is
// deliberately tight (that is the nudge to buy a wall gun); rounds 1-2 must not
// demand more ammunition than the M1911 carries.
const early = await page.evaluate(() => {
  const D = __dbg, w = D.WEAPONS.m1911;
  const carried = w.mag + w.res;
  const out = [];
  for (let r = 1; r <= 4; r++) {
    const hp = D.Zombies.healthFor(r), n = D.Zombies.countFor(r);
    out.push({ r, n, hp, carried,
      bodyNeeded: n * Math.ceil(hp / w.dmg),
      headNeeded: n * Math.ceil(hp / (w.dmg * w.head)) });
  }
  return out;
});
check('rounds 1-2 clearable on body shots with the starting pistol',
  early[0].bodyNeeded <= early[0].carried && early[1].bodyNeeded <= early[1].carried, early.slice(0, 2));
check('rounds 1-3 clearable on headshots with the starting pistol',
  early.slice(0, 3).every(e => e.headNeeded <= e.carried), early.slice(0, 3));
check('round 1 opens gently', early[0].n <= 6, early[0]);
check('round-to-round count growth stays sane early',
  early.every((e, i) => i === 0 || e.n / early[i - 1].n <= 1.5),
  early.map(e => e.n));

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

// 9. PERKS ---------------------------------------------------------------------
const perks = await page.evaluate(() => {
  const D = __dbg, P = D.Player.P, o = {};
  D.start(); D.points(99999); D.openAll(); D.power();
  for (let i = 0; i < 200; i++) D.stepN(1);
  o.baseHp = D.Player.maxHp();
  D.perk('jugg'); o.juggHp = D.Player.maxHp();
  D.give('bar');
  D.Player.gun().ammo = 0; D.tap('reload'); D.stepN(2);
  const before = P.reloadT; D.stepN(400);
  D.perk('speed');
  D.Player.gun().ammo = 0; D.tap('reload'); D.stepN(2);
  o.reloadFaster = P.reloadT < before - 0.4;
  D.stepN(400);
  D.perk('tap');
  o.owned = D.perks().length;
  return o;
});
check('Juggernog raises the health ceiling', perks.baseHp === 100 && perks.juggHp === 250, perks);
check('Speed Cola shortens the reload', perks.reloadFaster, perks);
check('all perks purchasable', perks.owned === 3, perks);

// 10. DOWN / SELF-REVIVE ---------------------------------------------------------
const revive = await page.evaluate(() => {
  const D = __dbg, P = D.Player.P, o = {};
  D.start(); D.points(99999); D.openAll(); D.power();
  for (let i = 0; i < 200; i++) D.stepN(1);
  D.perk('revive');
  D.Player.hurt(9999, null); D.stepN(2);
  o.down = P.down; o.alive = !P.dead; o.consumed = !D.Perks.has('revive');
  // a zombie must not be able to finish you while you are down
  D.Player.hurt(9999, null); D.stepN(2);
  o.immuneWhileDown = !P.dead;
  for (let i = 0; i < 60 * 7; i++) D.stepN(1);
  o.backUp = !P.down && !P.dead; o.hp = Math.round(P.hp);
  D.Player.hurt(9999, null); D.stepN(2);
  o.diesWithout = P.dead;
  return o;
});
check('Quick Revive downs you instead of killing you', revive.down && revive.alive, revive);
check('the perk is consumed on use', revive.consumed, revive);
check('a downed player cannot be finished off', revive.immuneWhileDown, revive);
check('you get back up on your own', revive.backUp && revive.hp > 0, revive);
check('without the perk a lethal hit ends the run', revive.diesWithout, revive);

// 10b. DOWN STATE GATES INTERACTION ------------------------------------------------
// Being down disables movement, firing and damage; interaction was left out, so
// a downed player could rebuild a barricade for free while untouchable.
const downLock = await page.evaluate(() => {
  const D = __dbg, P = D.Player.P, o = {};
  D.start(); D.points(99999); D.openAll(); D.power();
  for (let i = 0; i < 200; i++) D.stepN(1);
  D.perk('revive');
  // Isolate: with the round live, spawning zombies tear at the very window
  // under test and the assertion stops measuring what it claims to.
  D.Zombies.reset(); D.Round.R.phase = 'idle'; D.Round.R.timer = 1e9;
  const w = D.Level.windows.find(x => x.zone === 'lobby');
  w.planks = 0; D.Level.refreshPlanks(w);
  D.teleport(w.inside.x, w.inside.z); D.stepN(4);
  D.hold('useHeld', true); D.stepN(60);
  o.planksStanding = w.planks;
  o.repairsWhenUp = w.planks > 0;
  w.planks = 0; D.Level.refreshPlanks(w);
  D.Player.hurt(9999, null); D.stepN(2);
  o.isDown = P.down;
  const p0 = P.points;
  for (let i = 0; i < 60 * 3; i++) D.stepN(1);        // still holding repair
  o.planksWhileDown = w.planks;
  o.pointsWhileDown = P.points - p0;
  D.hold('useHeld', false);
  return o;
});
check('repair works while standing', downLock.repairsWhenUp, downLock);
check('a downed player cannot repair or earn from it',
  downLock.isDown && downLock.planksWhileDown === 0 && downLock.pointsWhileDown === 0, downLock);

// 11. POWER-UPS -------------------------------------------------------------------
const drops = await page.evaluate(() => {
  const D = __dbg, P = D.Player.P, o = {};
  D.start(); D.points(99999); D.openAll(); D.power();
  D.give('bar'); D.Player.gun().res = 0;
  D.drop('maxammo', P.pos.x, P.pos.z); D.stepN(4);
  o.maxammo = D.Player.gun().res === D.WEAPONS[D.Player.gun().key].res;
  D.drop('points', P.pos.x, P.pos.z); D.stepN(4);
  o.doublePoints = D.Drops.pointsMult === 2;
  D.drop('instakill', P.pos.x, P.pos.z); D.stepN(4);
  o.instakill = D.Drops.instakill;
  for (const w of D.Level.windows) { w.planks = 0; D.Level.refreshPlanks(w); }
  D.drop('carpenter', P.pos.x, P.pos.z); D.stepN(4);
  o.carpenter = D.Level.windows.every(w => w.planks === 6);
  /* Point totals, not just side effects. Both reviews of #329 found that the
     Nuke and Carpenter bounties were being doubled by an active Double Points
     timer — the `raw` flag existed for exactly that and neither call site passed
     it. The old checks asserted only "planks went back up" / "nobody survived",
     so the bug sailed through. Double Points is deliberately still live here. */
  o.dpActive = D.Drops.pointsMult === 2;
  const pc0 = P.points;
  for (const w of D.Level.windows) { w.planks = 0; D.Level.refreshPlanks(w); }
  D.drop('carpenter', P.pos.x, P.pos.z); D.stepN(4);
  o.carpenterPaid = P.points - pc0;
  D.setRound(6);
  for (let i = 0; i < 60 * 25; i++) { P.hp = 100; P.dead = false; if (D.Game.state === 'dying') D.Game.state = 'play'; D.stepN(1); }
  // Track the exact bodies present when the nuke lands. Measuring aliveCount a
  // few frames later is wrong: the round keeps spawning, so a fresh zombie
  // walking in after the blast would read as a survivor.
  const present = D.Zombies.list.filter(z => !z.dead);
  o.before = present.length;
  const pn0 = P.points;
  D.drop('nuke', P.pos.x, P.pos.z); D.stepN(4);
  o.survivors = present.filter(z => !z.dead).length;
  // the flat bounty only — kills from a nuke pay nothing per body
  o.nukePaid = P.points - pn0;
  // a nuke must not cascade into more drops
  o.dropsAfterNuke = D.Drops.live.length;
  return o;
});
check('Max Ammo refills reserves', drops.maxammo, drops);
check('Double Points doubles the multiplier', drops.doublePoints, drops);
check('Insta-Kill arms', drops.instakill, drops);
check('Carpenter reboards every window', drops.carpenter, drops);
check('Nuke kills every body on the map', drops.before > 0 && drops.survivors === 0, drops);
check('Nuke does not cascade drops', drops.dropsAfterNuke === 0, drops);
check('flat bounties ignore Double Points',
  drops.dpActive && drops.carpenterPaid === 200 && drops.nukePaid === 400, drops);

// 12. MYSTERY BOX ------------------------------------------------------------------
const box = await page.evaluate(() => {
  const D = __dbg, P = D.Player.P, o = {};
  D.start(); D.points(999999); D.openAll(); D.power();
  o.startsReachable = D.Box.spot && D.Level.ZONES[D.Box.spot.zone].open;
  o.tileSolid = D.Level.solid[D.Level.at(D.Box.spot.c, D.Box.spot.r)] === 1;
  const g0 = P.guns.map(g => g.key).join(',');
  o.opened = D.boxOpen();
  for (let i = 0; i < 60 * 5; i++) D.stepN(1);
  o.offered = D.box().phase === 'offer';
  o.taken = D.boxTake();
  o.gaveWeapon = P.guns.map(g => g.key).join(',') !== g0;
  const first = D.Box.spot;
  for (let k = 0; k < 14 && D.Box.spot === first; k++) {
    D.points(999999);
    if (D.boxOpen()) { for (let i = 0; i < 60 * 5; i++) D.stepN(1); D.boxTake(); }
    for (let i = 0; i < 60 * 4; i++) D.stepN(1);
  }
  o.relocated = D.Box.spot !== first;
  o.oldTileClear = D.Level.solid[D.Level.at(first.c, first.r)] === 0;
  o.newTileSolid = D.Level.solid[D.Level.at(D.Box.spot.c, D.Box.spot.r)] === 1;
  o.rayGunBoxOnly = D.WEAPONS.raygun.box === true;
  return o;
});
check('box starts somewhere reachable', box.startsReachable, box);
check('box opens, offers, and gives a weapon', box.opened && box.offered && box.taken && box.gaveWeapon, box);
check('box relocates after its use limit', box.relocated, box);
check('relocation moves the solid tile with it', box.oldTileClear && box.newTileSolid, box);
check('Ray Gun is box-exclusive', box.rayGunBoxOnly, box);

// 12b. PACK-A-PUNCH ---------------------------------------------------------------
const pap = await page.evaluate(() => {
  const D = __dbg, o = {};
  D.start(); D.points(99999); D.openAll();
  o.refusedWithoutPower = D.papInsert() === false;      // the system, not just the prompt
  D.power(); for (let i = 0; i < 200; i++) D.stepN(1);
  D.give('thomp');
  const base = D.WEAPONS.thomp;
  o.inserted = D.papInsert();
  o.working = D.pap().phase === 'work';
  o.notUpgradedYet = D.Player.gun().pap !== true;       // must be collected first
  for (let i = 0; i < 60 * 5; i++) D.stepN(1);
  o.ready = D.pap().phase === 'ready';
  o.collected = D.papTake();
  const up = D.Player.specOf(D.Player.gun());
  o.renamed = up.name !== base.name;
  o.dmgRatio = +(up.dmg / base.dmg).toFixed(2);
  o.magBigger = up.mag > base.mag;
  o.ammoRefilled = D.Player.gun().ammo === up.mag;
  o.secondRefused = D.papInsert() === false;
  D.give('mp40');
  o.freshWeaponClean = D.Player.gun().pap !== true;
  D.Player.gun().res = 0;
  D.drop('maxammo', D.Player.P.pos.x, D.Player.P.pos.z); D.stepN(4);
  o.maxAmmoUsesEffective = D.Player.gun().res === D.Player.specOf(D.Player.gun()).res;
  return o;
});
check('Pack-a-Punch refuses without power', pap.refusedWithoutPower, pap);
check('Pack-a-Punch runs then offers the weapon', pap.inserted && pap.working && pap.ready && pap.collected, pap);
check('upgrade only lands once collected', pap.notUpgradedYet, pap);
check('upgraded weapon is renamed and stronger',
  pap.renamed && pap.dmgRatio > 2 && pap.magBigger && pap.ammoRefilled, pap);
check('an upgraded weapon cannot be upgraded twice', pap.secondRefused, pap);
check('a fresh weapon does not inherit the upgrade', pap.freshWeaponClean, pap);
check('Max Ammo honours upgraded reserves', pap.maxAmmoUsesEffective, pap);

// 12c. HELLHOUNDS ------------------------------------------------------------------
const dogs = await page.evaluate(() => {
  const D = __dbg, P = D.Player.P, o = {};
  o.schedule = [1, 4, 5, 6, 9, 10, 15].map(r => D.Zombies.isDogRound(r));
  D.start(); D.points(99999); D.openAll(); D.power(); D.give('bar');
  D.setRound(5);
  o.flagged = D.snapshot().dogRound;
  for (let i = 0; i < 60 * 20; i++) { P.hp = 100; P.dead = false; if (D.Game.state === 'dying') D.Game.state = 'play'; D.stepN(1); }
  const s = D.snapshot();
  o.spawned = s.dogs;
  o.onlyDogs = s.alive === s.dogs;
  const live = D.Zombies.list.filter(z => !z.dead && z.kind === 'dog');
  o.skipBarricades = live.every(z => z.win === null);
  o.allReachable = live.every(z => D.navAt(z.pos.x, z.pos.z) < 1e5);
  o.fasterThanZombies = live.length > 0 && Math.min(...live.map(z => z.speed)) > D.Zombies.speedFor(5);
  // a dog must be hittable when you aim at its body
  if (live.length) {
    const z = live.sort((a, b) => a.pos.distanceToSquared(P.pos) - b.pos.distanceToSquared(P.pos))[0];
    P.yaw = Math.atan2(-(z.pos.x - P.pos.x), -(z.pos.z - P.pos.z));
    const d = Math.hypot(z.pos.x - P.pos.x, z.pos.z - P.pos.z);
    P.pitch = Math.atan2(D.Zombies.DRIG.bodyY * z.scale - 1.62, d);
    D.stepN(1);
    const eye = new D.THREE.Vector3(), dir = new D.THREE.Vector3();
    D.Player.eyePos(eye); D.Player.forward(dir);
    o.hittable = !!D.Zombies.raycast(eye, dir, 40);
    const hp0 = z.hp;
    for (let i = 0; i < 40; i++) { D.hold('fire', i % 3 !== 0); D.stepN(1); }
    D.hold('fire', false);
    o.damageable = z.hp < hp0 || z.dead;
  }
  // clearing a dog round pays a Max Ammo and the round advances
  D.Player.gun().res = 0;
  for (let i = 0; i < 60 * 40; i++) {
    P.hp = 100; P.dead = false; if (D.Game.state === 'dying') D.Game.state = 'play';
    if (D.Zombies.aliveCount > 0) D.killAll();
    D.stepN(1);
    if (D.snapshot().round > 5) break;
  }
  o.advanced = D.snapshot().round > 5;
  o.paidMaxAmmo = D.Player.gun().res > 0 || D.Drops.live.some(x => x.key === 'maxammo');
  return o;
});
check('dog rounds land on 5 and every 5th after', 
  JSON.stringify(dogs.schedule) === JSON.stringify([false, false, true, false, false, true, true]), dogs.schedule);
check('a dog round spawns only hellhounds', dogs.flagged && dogs.spawned > 0 && dogs.onlyDogs, dogs);
check('hellhounds ignore the barricades', dogs.skipBarricades, dogs);
check('hellhounds spawn somewhere that can reach you', dogs.allReachable, dogs);
check('hellhounds are faster than zombies of that round', dogs.fasterThanZombies, dogs);
check('hellhounds are hittable and take damage', dogs.hittable && dogs.damageable, dogs);
check('clearing a dog round advances and pays Max Ammo', dogs.advanced && dogs.paidMaxAmmo, dogs);

// 13. GAMEPAD ------------------------------------------------------------------------
// The review on #328 flagged that the controller path had zero regression
// coverage. Standard mapping is stubbed here so every binding is exercised.
await page.addScriptTag({ content: `
window.__pad = { axes:[0,0,0,0], buttons: Array.from({length:18},()=>({pressed:false,value:0})),
                 connected:true, index:0, mapping:'standard', id:'stub' };
navigator.getGamepads = () => [window.__pad, null, null, null];
window.__btn = (i,on) => { window.__pad.buttons[i] = { pressed:!!on, value:on?1:0 }; };
window.__ax  = (a,b,c,d) => { window.__pad.axes = [a,b,c,d]; };
window.__tapPad = i => { __btn(i,true); __dbg.stepN(3); __btn(i,false); __dbg.stepN(3); };
`});
const pad = await page.evaluate(() => {
  const D = __dbg, P = D.Player.P, o = {};
  D.Game.menu(); D.stepN(3);
  __tapPad(0); o.aStarts = D.Game.state === 'play';
  D.Zombies.reset(); D.Round.R.phase = 'idle'; D.Round.R.timer = 1e9;
  o.detected = D.Input.st.hasPad;
  const p0 = [P.pos.x, P.pos.z];
  __ax(0, -1, 0, 0); D.stepN(45); __ax(0, 0, 0, 0); D.stepN(4);
  o.moved = Math.hypot(P.pos.x - p0[0], P.pos.z - p0[1]) > 0.6;
  const y0 = P.yaw; __ax(0, 0, 1, 0); D.stepN(25); __ax(0, 0, 0, 0); D.stepN(2);
  o.turned = Math.abs(P.yaw - y0) > 0.3;
  const pit0 = P.pitch; __ax(0, 0, 0, -1); D.stepN(25); __ax(0, 0, 0, 0); D.stepN(2);
  o.looksUpOnStickUp = P.pitch > pit0 + 0.2;      // non-inverted default
  P.pitch = 0;
  const a0 = D.Player.gun().ammo;
  __btn(7, true); D.stepN(30); __btn(7, false); D.stepN(2);
  o.rtFires = D.Player.gun().ammo < a0;
  __tapPad(2); D.stepN(150);
  o.xReloads = D.Player.gun().ammo === D.WEAPONS[D.Player.gun().key].mag;
  __btn(6, true); D.stepN(30); o.ltAds = P.ads > 0.8; __btn(6, false); D.stepN(20);
  D.points(9999); D.give('mp40');
  const g0 = D.Player.gun().key; __tapPad(3); D.stepN(20);
  o.ySwaps = D.Player.gun().key !== g0;
  __tapPad(1); D.stepN(2); o.bKnifes = P.knifeT > 0; D.stepN(60);
  // R3 melee — a Call of Duty player's thumb goes here, not to B
  __tapPad(11); D.stepN(2); o.r3Melees = P.knifeT > 0; D.stepN(60);
  /* HOLD L3 to sprint. It was a toggle, which latches: you let go of the stick
     and stay "sprinting", so you round a corner already unable to shoot. */
  __btn(10, true); __ax(0, -1, 0, 0); D.stepN(10);
  o.sprintWhileHeld = P.sprinting;
  __btn(10, false); D.stepN(10);
  o.sprintStopsOnRelease = !P.sprinting;
  __ax(0, 0, 0, 0); D.stepN(4);
  const n0 = P.nades; __tapPad(5); D.stepN(40); o.rbNades = P.nades === n0 - 1;
  const wb = D.Level.wallbuys.find(w => w.char === 'a');
  D.teleport(wb.use.x, wb.use.z); D.points(9999); D.stepN(4);
  const owned = P.guns.map(g => g.key).join(',');
  __tapPad(0); D.stepN(6);
  o.aBuys = P.guns.map(g => g.key).join(',') !== owned;
  __tapPad(9); D.stepN(2); o.startPauses = D.Game.state === 'pause';
  __tapPad(0); D.stepN(3); o.aResumes = D.Game.state === 'play';
  return o;
});
check('gamepad is detected', pad.detected, pad);
check('left stick moves', pad.moved, pad);
check('right stick turns', pad.turned, pad);
check('stick up looks up (not inverted)', pad.looksUpOnStickUp, pad);
check('RT fires', pad.rtFires, pad);
check('X reloads', pad.xReloads, pad);
check('LT aims', pad.ltAds, pad);
check('Y swaps weapon', pad.ySwaps, pad);
check('B knifes', pad.bKnifes, pad);
check('R3 melees', pad.r3Melees, pad);
check('L3 sprints only while held', pad.sprintWhileHeld && pad.sprintStopsOnRelease, pad);
check('RB throws a frag', pad.rbNades, pad);
check('A buys at a wall-buy', pad.aBuys, pad);
check('Start pauses, A resumes', pad.startPauses && pad.aResumes, pad);
check('A starts a run from the title screen', pad.aStarts, pad);

// 13b. MENU CURSOR ------------------------------------------------------------------
/* The controller could confirm and go back long before it could show you WHAT
   it was about to confirm. `ringed` is the load-bearing assertion here: the
   first version of this cursor navigated perfectly and highlighted nothing,
   because the ring was gated on an input mode that button presses never set. */
const menuNav = await page.evaluate(() => {
  const D = __dbg, o = {};
  D.Game.menu(); D.stepN(4);
  __tapPad(13);
  o.first = D.menu();
  __tapPad(12);
  o.afterUp = D.menu().focused;
  __tapPad(12);
  o.wraps = D.menu().focused;                       // up from the top wraps round
  while (D.menu().focused !== 'CONTROLS') __tapPad(13);
  __tapPad(0); D.stepN(4);
  o.activatedHighlighted = D.Game.state === 'how';  // A pressed the ringed item
  o.ringOnHow = D.menu().ringed.length === 1;
  __tapPad(1); D.stepN(4);
  o.backedOut = D.Game.state === 'title';
  while (D.menu().focused !== 'BEGIN') __tapPad(13);
  __tapPad(0); D.stepN(4);
  o.started = D.Game.state === 'play';
  o.hudHiddenInMenu = (D.Game.menu(), D.stepN(2), document.body.classList.contains('inmenu'));
  D.Game.show(null); D.stepN(2);
  o.hudBackInGame = !document.body.classList.contains('inmenu');
  return o;
});
check('menu cursor moves and wraps',
  menuNav.first.focused === 'CONTROLS' && menuNav.afterUp === 'BEGIN' && menuNav.wraps === 'CONTROLS', menuNav);
check('the focused item is actually highlighted',
  menuNav.first.ringed.length === 1 && menuNav.first.ringed[0] === menuNav.first.focused, menuNav.first);
check('every screen gets its own highlight', menuNav.ringOnHow, menuNav);
check('A activates the highlighted item', menuNav.activatedHighlighted, menuNav);
check('B backs out', menuNav.backedOut, menuNav);
check('BEGIN still starts a run', menuNav.started, menuNav);
check('HUD is hidden behind menus and restored in game',
  menuNav.hudHiddenInMenu && menuNav.hudBackInGame, menuNav);

// 13c. AUDIO GRAPH ------------------------------------------------------------------
// Everything is synthesised, so a broken node graph is a silent runtime throw
// inside a one-shot rather than a missing file. Fire every voice at least once.
const audio = await page.evaluate(() => {
  const D = __dbg, S = D.Snd, o = {};
  S.boot();
  o.hasCtx = !!S.ctx;
  const P = D.Player.P.pos, yaw = 0;
  const calls = [
    () => S.shot(D.WEAPONS.m1911), () => S.shot(D.WEAPONS.trench), () => S.dryFire(),
    () => S.reloadClick(true), () => S.shellDrop(), () => S.knife(), () => S.explode(),
    () => S.groan(P, P, yaw), () => S.growl(P, P, yaw), () => S.hitFlesh(), () => S.headPop(),
    () => S.zombieHit(), () => S.plankTear(), () => S.plankFix(), () => S.buy(), () => S.deny(),
    () => S.points(true), () => S.doorOpen(), () => S.powerUp(), () => S.roundStart(7),
    () => S.hurt(), () => S.heartbeat(), () => S.step(true), () => S.death(),
    () => S.perkJingle(0), () => S.powerupDrop(), () => S.powerupGrab('nuke'),
    () => S.boxOpen(), () => S.boxCycle(), () => S.boxTake(), () => S.bear(),
    () => S.revive(), () => S.down(), () => S.dogRound(), () => S.ambience(true),
  ];
  const failed = [];
  calls.forEach((f, i) => { try { f(); } catch (e) { failed.push(i + ':' + e.message); } });
  S.ambience(false);
  o.voices = calls.length;
  o.failed = failed;
  return o;
});
check('audio context builds', audio.hasCtx, audio);
check('every synthesised voice plays without throwing', audio.failed.length === 0, audio);

// 14. no errors anywhere -------------------------------------------------------
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
