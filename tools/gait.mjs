// Gait measurement rig.
//
//   node tools/gait.mjs [--shots]
//
// Drives one character's animateWalk() at a fixed timestep across a range of
// speeds and reports the numbers a gait lab would: cadence, step length, duty
// factor, vertical oscillation, joint ranges, foot skate. Reference values in
// REF are from published human gait analysis, not from this game -- the point
// is to have an outside standard to miss, rather than tuning until a screenshot
// looks acceptable.
//
// Fixed dt matters: SwiftShader runs ~4 fps, so anything measured in real time
// exaggerates per-frame deltas by an order of magnitude and is worthless for
// judging smoothness.

import { spawn } from 'node:child_process';
import { writeFileSync, mkdirSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';

const HTTP_PORT = process.env.AUTO_HTTP_PORT || 8000;
const PORT = +process.env.AUTO_CDP_PORT || 9226;
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const OUT = 'tools/data/gait';
const SHOTS = process.argv.includes('--shots');

// Speed, and what a person actually does at it. Ranges are typical adult values
// from gait-analysis literature; they are targets to be judged against, not
// hard pass/fail lines, because this is a stylised character.
const REF = [
// stanceKneeDeg: the MEAN knee flexion while that foot is down. Every other
// band passed while the whole stance was a crouch (36 deg at a walk, against a
// real ~10): see CLAUDE.md, "The gait plants feet".
  { speed: 1.4, label: 'walk',      cadence: [100, 120], step: [0.68, 0.82], duty: [0.58, 0.65], bobCm: [3.5, 6],  kneeSwingDeg: [55, 75],   stanceKneeDeg: [4, 20] },
  { speed: 2.2, label: 'brisk',     cadence: [120, 140], step: [0.85, 1.05], duty: [0.52, 0.60], bobCm: [4, 7],    kneeSwingDeg: [65, 85],   stanceKneeDeg: [5, 24] },
  { speed: 3.5, label: 'jog',       cadence: [150, 170], step: [1.1, 1.4],   duty: [0.38, 0.48], bobCm: [6, 10],   kneeSwingDeg: [90, 120],  stanceKneeDeg: [25, 50] },
  { speed: 5.5, label: 'run',       cadence: [165, 185], step: [1.6, 2.1],   duty: [0.30, 0.40], bobCm: [7, 11],   kneeSwingDeg: [110, 140], stanceKneeDeg: [28, 52] },
  { speed: 7.5, label: 'sprint',    cadence: [180, 210], step: [2.0, 2.6],   duty: [0.22, 0.32], bobCm: [8, 13],   kneeSwingDeg: [120, 155], stanceKneeDeg: [28, 55] },
];

function launch() {
  return spawn(CHROME, [
    `--remote-debugging-port=${PORT}`, '--headless=new', '--use-gl=swiftshader',
    '--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required',
    '--window-size=900,900', '--no-first-run',
    `--user-data-dir=/tmp/auto-gait-profile-${PORT}`, 'about:blank',
  ], { stdio: 'ignore' });
}

const band = (v, [lo, hi]) => (v >= lo && v <= hi ? '  ok ' : v < lo ? ' LOW ' : ' HIGH');

async function main() {
  const chrome = launch();
  try {
    let page;
    for (let i = 0; i < 80 && !page; i++) {
      try {
        page = (await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json())
          .find((t) => t.type === 'page');
      } catch { /* not up */ }
      if (!page) await sleep(300);
    }
    const ws = new WebSocket(page.webSocketDebuggerUrl);
    await new Promise((r, j) => { ws.addEventListener('open', r); ws.addEventListener('error', j); });
    let id = 0; const pend = new Map();
    ws.addEventListener('message', (ev) => {
      const m = JSON.parse(ev.data);
      if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); }
    });
    const send = (method, params = {}) => new Promise((res) => {
      ws.send(JSON.stringify({ id: ++id, method, params })); pend.set(id, res);
    });
    const evaluate = async (e, aw = false) => {
      const r = await send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: aw });
      if (r.result?.exceptionDetails) throw new Error(r.result.exceptionDetails.exception?.description);
      return r.result?.result?.value;
    };
    await send('Runtime.enable');
    await send('Page.enable');
    await send('Network.enable');
    await send('Network.setBypassServiceWorker', { bypass: true });
    await send('Network.setCacheDisabled', { cacheDisabled: true });
    await send('Page.addScriptToEvaluateOnNewDocument', { source: 'window.__noAutoQuality = true;' });
    await send('Page.navigate', { url: `http://localhost:${HTTP_PORT}/apps/auto/` });
    for (let i = 0; i < 400; i++) {
      await sleep(500);
      if (await evaluate('!!window.__dbg')) break;
    }
    console.log('booted\n');

    const { rows, ramp } = await evaluate(`(() => {
      const d = window.__dbg, peds = d.peds, THREE = d.THREE;
      const h = d.player.h;                       // the player's own humanoid
      // Measure the LAW, not one individual: per-person gait/swing variation
      // is legitimate but would push a single character out of a population band.
      h.gait = 1; h.swing = 1; h.lean = 0;
      const DT = 1 / 60, CYCLES = 14;
      // Heel and toe of the sole in world space, from the foot bone. The sole
      // box in buildCharacter bottoms out 6.75 cm under the ankle and runs from
      // 5.6 cm behind it to 15.6 cm ahead.
      const soleOf = (fb) => ({
        heel: new THREE.Vector3(0, -0.0675, -0.056).applyMatrix4(fb.matrixWorld),
        toe: new THREE.Vector3(0, -0.0675, 0.156).applyMatrix4(fb.matrixWorld),
      });
      // The root MOVES. animateWalk locks planted feet to world positions, so a
      // rig that holds the body still and expects the feet to slide backwards
      // at body speed measures a treadmill the game no longer runs.
      const stepRoot = (sp) => {
        const g = h.group, ry = g.rotation.y;
        g.position.x += Math.sin(ry) * sp * DT; g.position.z += Math.cos(ry) * sp * DT;
      };
      const out = [];
      const specs = ${JSON.stringify(REF)};
      for (const spec of specs) {
        const sp = spec.speed;
        h.phase = 0;
        // Warm up a cycle so the measurement doesn't include the start pose.
        const amp = Math.max(0, Math.min(0.85, sp * 0.16));
        for (let i = 0; i < 240; i++) { stepRoot(sp); d.animateWalk(h, amp, DT, sp); }
        const B = h.bones, b = h.bones;
        let t = 0, frames = 0;
        const bodyPerFrame = sp * DT;
        let contactFrames = 0, airFrames = 0, leftFrames = 0, doubleFrames = 0;
        let hipMin = 1e9, hipMax = -1e9, hipSum = 0;
        let stKnee = 0, stKneeN = 0;
        let kneeMax = 0, hipFlexMin = 1e9, hipFlexMax = -1e9, ankMin = 1e9, ankMax = -1e9;
        let armMin = 1e9, armMax = -1e9;
        let skate = 0, skateN = 0;
        let steps = 0, lastContact = h.contact;
        let prevFootWorld = null, prevContact = -2;
        const startPhase = h.phase;
        // Run until the phase has advanced CYCLES * PI (one step per PI).
        while (h.phase - startPhase < Math.PI * CYCLES && frames < 20000) {
          stepRoot(sp);
          d.animateWalk(h, amp, DT, sp);
          h.group.updateMatrixWorld(true);
          frames++; t += DT;
          if (h.contact >= 0) contactFrames++; else airFrames++;
          if (h.contactL) leftFrames++;
          if (h.contactL && h.contactR) doubleFrames++;
          if (h.contact !== lastContact && h.contact >= 0) steps++;
          lastContact = h.contact;
          hipMin = Math.min(hipMin, h.bones[1].position.y);
          hipMax = Math.max(hipMax, h.bones[1].position.y);
          hipSum += h.bones[1].position.y;
          const kneeL = h.bones[13].rotation.x, kneeR = h.bones[16].rotation.x;
          kneeMax = Math.max(kneeMax, Math.abs(kneeL), Math.abs(kneeR));
          if (h.contactL) { stKnee += kneeL; stKneeN++; }
          const hipL = h.bones[12].rotation.x;
          hipFlexMin = Math.min(hipFlexMin, hipL); hipFlexMax = Math.max(hipFlexMax, hipL);
          const ankL = h.bones[14].rotation.x;
          ankMin = Math.min(ankMin, ankL); ankMax = Math.max(ankMax, ankL);
          const shL = h.bones[6].rotation.x;
          armMin = Math.min(armMin, shL); armMax = Math.max(armMax, shL);
          // foot skate: world travel of the PLANTED foot against body travel
          if (h.contact !== prevContact) { prevFootWorld = null; prevContact = h.contact; }
          if (h.contact >= 0) {
            const fb = h.contact === 0 ? h.bones[14] : h.bones[17];
            // Watch the PIVOT -- heel before the foot rolls flat, toe after the
            // heel lifts -- not the ankle, which legitimately moves as the foot
            // rotates about it. Only a point compared with itself counts.
            const so = soleOf(fb), which = so.heel.y < so.toe.y ? 'heel' : 'toe', wp = so[which];
            if (prevFootWorld && prevFootWorld.which === which) {
              // The root translates in this rig, so a correctly planted pivot
              // does not move in world space at all: any movement is skate.
              const moved = Math.hypot(wp.x - prevFootWorld.x, wp.z - prevFootWorld.z);
              skate += moved; skateN++;
            }
            prevFootWorld = Object.assign(wp.clone(), { which });
          } else prevFootWorld = null;
        }
        // SOLE contact, which the ankle-based skate figure cannot see. A foot
        // whose ankle is on target but whose pitch has hit its clamp stands on
        // its toe or its heel, and that is visible even when every band passes.
        // Re-run one cycle and read the heel and toe of the sole in world space.
        const g0 = h.group.position.y;
        let soleErr = 0, soleN = 0, soleMax = 0, clearMin = 1e9, clamped = 0, pitchN = 0;
        // Per-foot swing buffers; null until the foot has been seen down, so a
        // swing the loop started in the middle of is not judged.
        const swingBuf = [null, null];
        const ph0 = h.phase;
        while (h.phase - ph0 < Math.PI * 4) {
          stepRoot(sp);
          d.animateWalk(h, amp, DT, sp);
          h.group.updateMatrixWorld(true);
          for (const [k, fb, down] of [[0, b[14], h.contactL], [1, b[17], h.contactR]]) {
            const s = soleOf(fb);
            const lo = Math.min(s.heel.y, s.toe.y) - g0;
            if (down) {
              soleErr += Math.abs(lo); soleN++; soleMax = Math.max(soleMax, Math.abs(lo));
              // MID-swing clearance only: both ends of a swing meet the ground
              // by design, so a minimum over the whole swing always reads ~0
              // and could not see a foot dragging through the middle.
              const sb = swingBuf[k];
              if (sb && sb.length > 4) {
                for (let i = Math.floor(sb.length * 0.3); i < Math.ceil(sb.length * 0.7); i++) clearMin = Math.min(clearMin, sb[i]);
              }
              swingBuf[k] = [];
            } else if (swingBuf[k]) swingBuf[k].push(lo);
            pitchN++;
            // the ankle limits in animateWalk's solveLeg
            if (Math.abs(fb.rotation.x - 1.00) < 1e-4 || Math.abs(fb.rotation.x + 0.80) < 1e-4) clamped++;
          }
        }
        const cadence = (steps / t) * 60;
        const stepLen = sp / (steps / t || 1);
        // PER-LIMB duty, which is what gait analysis reports. The contact flag
        // foot at a time, so this model has no double support at all -- a real
        // walk has ~10% of the cycle with both feet down.
        const duty = leftFrames / frames;
        const flight = airFrames / frames;
        out.push({
          label: spec.label, speed: sp,
          cadence: +cadence.toFixed(0),
          step: +stepLen.toFixed(2),
          duty: +duty.toFixed(2),
          flight: +flight.toFixed(2),
          dbl: +(doubleFrames / frames).toFixed(2),
          bobCm: +((hipMax - hipMin) * 100).toFixed(1),
          // Mean hip height against standing. A person walking sits about 3%
          // below their standing hip; much more than that is a crouch.
          hipPct: +((hipSum / frames) / 0.927 * 100).toFixed(1),
          kneeSwingDeg: +(kneeMax * 57.2958).toFixed(0),
          stanceKneeDeg: +(stKnee / Math.max(1, stKneeN) * 57.2958).toFixed(0),
          hipRangeDeg: +((hipFlexMax - hipFlexMin) * 57.2958).toFixed(0),
          ankleRangeDeg: +((ankMax - ankMin) * 57.2958).toFixed(0),
          armRangeDeg: +((armMax - armMin) * 57.2958).toFixed(0),
          skateMmPerFrame: +((skate / Math.max(1, skateN)) * 1000).toFixed(1),
          skatePctOfBody: +((skate / Math.max(1, skateN)) / bodyPerFrame * 100).toFixed(1),
          soleMeanCm: +((soleErr / Math.max(1, soleN)) * 100).toFixed(1),
          soleMaxCm: +(soleMax * 100).toFixed(1),
          clearCm: +(clearMin * 100).toFixed(1),
          clampPct: +((clamped / Math.max(1, pitchN)) * 100).toFixed(0),
        });
      }
      // SPEED CHANGES. Every figure above is taken at a constant speed, and a
      // player is almost never at one: the stick eases in, sprint toggles, a
      // wall stops you. Duty factor and step length both move with speed, so a
      // foot target at the same phase can land somewhere else the next frame.
      // Drive the root forward for real through the game's own ramps and
      // report the worst frame-to-frame jump of a PLANTED sole (should be ~0,
      // it is holding the ground) and of any foot at all (a pop).
      {
        h.phase = 0;
        // Start from rest for real. The smoothed gait speed, the foot locks
        // and the per-foot state all carry history, and without this the ramp
        // "started" at 0 m/s with the gait still running at 2 m/s from the
        // sprint row -- a speed cut no player can produce.
        h.gspd = null; h.locks = null; h.gst = null;
        const b = h.bones;
        const g = h.group, z0 = g.position.z, x0 = g.position.x, ry = g.rotation.y;
        g.rotation.y = 0;
        const plan = [[0, 0.5], [1.4, 1.5], [5.0, 1.5], [7.2, 1.5], [5.0, 1.0], [1.4, 1.0], [0, 1.0]];
        let v = 0, pz = z0;
        let plantJump = 0, anyJump = 0, plantAt = '', anyAt = '';
        let hist = [], detail = null, lastMax = 0;
        const prev = [null, null], prevDown = [false, false];
        for (const [tgt, dur] of plan) {
          for (let i = 0; i < dur / DT; i++) {
            // player.updateFoot's damp(speed, target, 9, dt)
            v += (tgt - v) * (1 - Math.exp(-9 * DT));
            pz += v * DT;
            g.position.z = pz;
            d.animateWalk(h, Math.max(0, Math.min(0.85, v * 0.16)), DT, v);
            g.updateMatrixWorld(true);
            [b[14], b[17]].forEach((fb, k) => {
              const down = k === 0 ? h.contactL : h.contactR;
              const s = soleOf(fb);
              // The lower of heel and toe swaps as the foot rolls past level;
              // comparing a heel to last frame's toe reads as a 21 cm jump that
              // is not there, so only compare a point with itself.
              const which = s.heel.y < s.toe.y ? 'heel' : 'toe';
              const p = s[which];
              const ank = new THREE.Vector3(); fb.getWorldPosition(ank);
              if (prev[k]) {
                // A POP is a change of velocity, not a speed: a sprinting swing
                // foot legitimately covers ~20 cm a frame. The second difference
                // is what a snap at touchdown or a phase jump shows up in.
                if (prev[k].pank) {
                  const j = Math.hypot(ank.x - 2 * prev[k].ank.x + prev[k].pank.x,
                    ank.y - 2 * prev[k].ank.y + prev[k].pank.y, ank.z - 2 * prev[k].ank.z + prev[k].pank.z);
                  if (j > anyJump) { anyJump = j; anyAt = tgt + ' m/s @' + v.toFixed(2); }
                }
                if (down && prevDown[k] && v > 0.3 && which === prev[k].which) {
                  const pj = Math.hypot(p.x - prev[k].p.x, p.z - prev[k].p.z);
                  if (pj > plantJump) { plantJump = pj; plantAt = tgt + ' m/s @' + v.toFixed(2); }
                }
              }
              prev[k] = { p: p.clone(), ank: ank.clone(), pank: prev[k] ? prev[k].ank : null, which };
              prevDown[k] = down;
              // Frame context, so a pop can be read instead of guessed at:
              // two guesses at the stop pop were wrong before this existed.
              if (k === 1) {
                const snap = {
                  v: +v.toFixed(3), gspd: h.gspd != null ? +h.gspd.toFixed(3) : null,
                  phase: +h.phase.toFixed(3), cL: h.contactL, cR: h.contactR,
                  gst: h.gst ? h.gst.map((q) => q && { st: q.st, u: +q.u.toFixed(3) }) : null,
                  locks: h.locks ? h.locks.map((q) => ({ on: q.on, ex: +q.ex.toFixed(3), ez: +q.ez.toFixed(3) })) : null,
                  hipY: +b[1].position.y.toFixed(3),
                  ankL: prev[0] ? [+(prev[0].ank.y - g.position.y).toFixed(3), +(prev[0].ank.z - g.position.z).toFixed(3)] : null,
                  ankR: [+(ank.y - g.position.y).toFixed(3), +(ank.z - g.position.z).toFixed(3)],
                };
                hist.push(snap); if (hist.length > 4) hist.shift();
                if (anyJump > lastMax) { lastMax = anyJump; detail = hist.slice(); }
              }
            });
          }
        }
        g.position.z = z0; g.position.x = x0; g.rotation.y = ry;
        out.ramp = { plantJumpCm: +(plantJump * 100).toFixed(1), plantAt,
          anyJumpCm: +(anyJump * 100).toFixed(1), anyAt, detail };
      }
      return { rows: out, ramp: out.ramp };
    })()`);

    const w = (s, n) => String(s).padStart(n);
    console.log('                cadence        step         duty        bob(cm)      knee-swing   stance-knee   skate');
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i], f = REF[i];
      console.log(
        `  ${r.label.padEnd(7)}${w(r.speed, 4)}m/s`
        + `  ${w(r.cadence, 4)}${band(r.cadence, f.cadence)}`
        + `  ${w(r.step, 5)}${band(r.step, f.step)}`
        + `  ${w(r.duty, 5)}${band(r.duty, f.duty)}`
        + `  ${w(r.bobCm, 5)}${band(r.bobCm, f.bobCm)}`
        + `  ${w(r.kneeSwingDeg, 4)}${band(r.kneeSwingDeg, f.kneeSwingDeg)}`
        + `  ${w(r.stanceKneeDeg, 4)}${band(r.stanceKneeDeg, f.stanceKneeDeg)}`
        + `  ${w(r.skatePctOfBody, 5)}%  air ${w(r.flight, 4)}  dbl ${w(r.dbl, 4)}  hip ${w(r.hipPct, 5)}%`
      );
    }
    console.log('\n  joint ranges (deg):');
    for (const r of rows) {
      console.log(`  ${r.label.padEnd(8)} hip ${w(r.hipRangeDeg, 3)}   ankle ${w(r.ankleRangeDeg, 3)}`
        + `   arm ${w(r.armRangeDeg, 3)}   skate ${w(r.skateMmPerFrame, 5)} mm/frame`);
    }
    // Sole: mean / worst gap between the planted sole's lowest point and the
    // ground, lowest swing clearance (negative = the toe goes through the
    // floor), and how often the ankle pitch sits on its limit.
    console.log('\n  sole contact:');
    for (const r of rows) {
      console.log(`  ${r.label.padEnd(8)} stance gap mean ${w(r.soleMeanCm, 4)} cm  worst ${w(r.soleMaxCm, 4)} cm`
        + `   mid-swing clearance ${w(r.clearCm, 5)} cm   ankle on limit ${w(r.clampPct, 3)}%`);
    }
    console.log(`\n  speed ramp 0 -> 1.4 -> 5 -> 7.2 -> 5 -> 1.4 -> 0:`
      + `  planted sole slip worst ${ramp.plantJumpCm} cm/frame (${ramp.plantAt})`
      + `   any ankle jump worst ${ramp.anyJumpCm} cm/frame (${ramp.anyAt})`);
    if (process.argv.includes('--trace') && ramp.detail) {
      console.log('  frames up to the worst jump:');
      for (const f of ramp.detail) console.log('   ', JSON.stringify(f));
    }
    console.log('\n  reference bands are typical adult values from gait-analysis literature');

    if (SHOTS) {
      mkdirSync(OUT, { recursive: true });
      for (const [name, sp, view] of [
        ['walk-side', 1.4, 'side'], ['walk-front', 1.4, 'front'],
        ['jog-side', 3.5, 'side'], ['run-side', 5.5, 'side'],
        ['sprint-side', 7.5, 'side'], ['run-front', 5.5, 'front'],
      ]) {
        await evaluate(`(() => {
          const d = window.__dbg;
          for (const id of ['hud','pad','stickZone','objective','lookZone'])
            { const e = document.getElementById(id); if (e) e.style.display='none'; }
          d.game.paused = true;
          const h = d.player.h, p = d.player.position;
          h.phase = 1.1;                       // mid-stance, a readable pose
          for (let i = 0; i < 30; i++) d.animateWalk(h, 1, 1/60, ${sp});
          const y = p.y + 0.9;
          const off = ${view === 'side' ? '[4.2, 0]' : '[0, -4.6]'};
          d.camera.position.set(p.x + off[0], y, p.z + off[1]);
          d.camera.lookAt(p.x, p.y + 0.85, p.z);
          d.sun.position.set(p.x - 8, p.y + 14, p.z - 6);
          d.sun.target.position.set(p.x, p.y, p.z);
          d.sun.target.updateMatrixWorld();
          d.camera.updateMatrixWorld(true);
        })()`);
        await sleep(3500);
        const { result } = await send('Page.captureScreenshot', { format: 'png' });
        writeFileSync(`${OUT}/${name}.png`, Buffer.from(result.data, 'base64'));
        console.log(`  shot ${OUT}/${name}.png`);
      }
    }
  } finally {
    chrome.kill('SIGKILL');
  }
}

main().catch((e) => { console.error('gait failed:', e.message); process.exitCode = 1; });
