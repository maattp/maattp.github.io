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

const PORT = 9226;
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const OUT = 'tools/data/gait';
const SHOTS = process.argv.includes('--shots');

// Speed, and what a person actually does at it. Ranges are typical adult values
// from gait-analysis literature; they are targets to be judged against, not
// hard pass/fail lines, because this is a stylised character.
const REF = [
  { speed: 1.4, label: 'walk',      cadence: [100, 120], step: [0.68, 0.82], duty: [0.58, 0.65], bobCm: [3.5, 6],  kneeSwingDeg: [55, 75] },
  { speed: 2.2, label: 'brisk',     cadence: [120, 140], step: [0.85, 1.05], duty: [0.52, 0.60], bobCm: [4, 7],    kneeSwingDeg: [65, 85] },
  { speed: 3.5, label: 'jog',       cadence: [150, 170], step: [1.1, 1.4],   duty: [0.38, 0.48], bobCm: [6, 10],   kneeSwingDeg: [90, 120] },
  { speed: 5.5, label: 'run',       cadence: [165, 185], step: [1.6, 2.1],   duty: [0.30, 0.40], bobCm: [7, 11],   kneeSwingDeg: [110, 140] },
  { speed: 7.5, label: 'sprint',    cadence: [180, 210], step: [2.0, 2.6],   duty: [0.22, 0.32], bobCm: [8, 13],   kneeSwingDeg: [120, 155] },
];

function launch() {
  return spawn(CHROME, [
    `--remote-debugging-port=${PORT}`, '--headless=new', '--use-gl=swiftshader',
    '--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required',
    '--window-size=900,900', '--no-first-run',
    '--user-data-dir=/tmp/auto-gait-profile', 'about:blank',
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
    await send('Page.navigate', { url: 'http://localhost:8000/apps/auto/' });
    for (let i = 0; i < 400; i++) {
      await sleep(500);
      if (await evaluate('!!window.__dbg')) break;
    }
    console.log('booted\n');

    const rows = await evaluate(`(() => {
      const d = window.__dbg, peds = d.peds, THREE = d.THREE;
      const h = d.player.h;                       // the player's own humanoid
      // Measure the LAW, not one individual: per-person gait/swing variation
      // is legitimate but would push a single character out of a population band.
      h.gait = 1; h.swing = 1; h.lean = 0;
      const DT = 1 / 60, CYCLES = 14;
      const out = [];
      const specs = ${JSON.stringify(REF)};
      for (const spec of specs) {
        const sp = spec.speed;
        h.phase = 0;
        // Warm up a cycle so the measurement doesn't include the start pose.
        const amp = Math.max(0, Math.min(0.85, sp * 0.16));
        for (let i = 0; i < 240; i++) d.animateWalk(h, amp, DT, sp);
        const B = h.bones, b = h.bones;
        let t = 0, frames = 0;
        const bodyPerFrame = sp * DT;
        let contactFrames = 0, airFrames = 0, leftFrames = 0, doubleFrames = 0;
        let hipMin = 1e9, hipMax = -1e9, hipSum = 0;
        let kneeMax = 0, hipFlexMin = 1e9, hipFlexMax = -1e9, ankMin = 1e9, ankMax = -1e9;
        let armMin = 1e9, armMax = -1e9;
        let skate = 0, skateN = 0;
        let steps = 0, lastContact = h.contact;
        let prevFootWorld = null, prevContact = -2;
        const startPhase = h.phase;
        // Run until the phase has advanced CYCLES * PI (one step per PI).
        while (h.phase - startPhase < Math.PI * CYCLES && frames < 20000) {
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
            const wp = new THREE.Vector3(); fb.getWorldPosition(wp);
            if (prevFootWorld) {
              // The ankle covers ankleTrack of the body's travel; the foot rotates
              // through the rest, so the SOLE is still planted. Expect that, not 1.
              // The root does not translate in this rig, so a CORRECTLY planted
              // foot must travel backwards at exactly the body speed. Skate is
              // the departure from that, not the raw movement -- measuring the
              // raw movement reports a perfect gait as 100%.
              const moved = Math.hypot(wp.x - prevFootWorld.x, wp.z - prevFootWorld.z);
              skate += Math.abs(moved - bodyPerFrame * (h.ankleTrack || 1)); skateN++;
            }
            prevFootWorld = wp.clone();
          } else prevFootWorld = null;
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
          hipRangeDeg: +((hipFlexMax - hipFlexMin) * 57.2958).toFixed(0),
          ankleRangeDeg: +((ankMax - ankMin) * 57.2958).toFixed(0),
          armRangeDeg: +((armMax - armMin) * 57.2958).toFixed(0),
          skateMmPerFrame: +((skate / Math.max(1, skateN)) * 1000).toFixed(1),
          skatePctOfBody: +((skate / Math.max(1, skateN)) / bodyPerFrame * 100).toFixed(1),
        });
      }
      return out;
    })()`);

    const w = (s, n) => String(s).padStart(n);
    console.log('                cadence        step         duty        bob(cm)      knee-swing   skate');
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i], f = REF[i];
      console.log(
        `  ${r.label.padEnd(7)}${w(r.speed, 4)}m/s`
        + `  ${w(r.cadence, 4)}${band(r.cadence, f.cadence)}`
        + `  ${w(r.step, 5)}${band(r.step, f.step)}`
        + `  ${w(r.duty, 5)}${band(r.duty, f.duty)}`
        + `  ${w(r.bobCm, 5)}${band(r.bobCm, f.bobCm)}`
        + `  ${w(r.kneeSwingDeg, 4)}${band(r.kneeSwingDeg, f.kneeSwingDeg)}`
        + `  ${w(r.skatePctOfBody, 5)}%  air ${w(r.flight, 4)}  dbl ${w(r.dbl, 4)}  hip ${w(r.hipPct, 5)}%`
      );
    }
    console.log('\n  joint ranges (deg):');
    for (const r of rows) {
      console.log(`  ${r.label.padEnd(8)} hip ${w(r.hipRangeDeg, 3)}   ankle ${w(r.ankleRangeDeg, 3)}`
        + `   arm ${w(r.armRangeDeg, 3)}   skate ${w(r.skateMmPerFrame, 5)} mm/frame`);
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
