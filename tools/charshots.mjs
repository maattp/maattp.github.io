// Portrait sheet of the character model, from fixed angles.
//
//   node tools/charshots.mjs [tag] [seed]
//
// Full-length front / three-quarter / side / back, plus a head-and-shoulders
// close-up: the views a character artist turns a model around in, at the two
// distances the player actually sees -- across the street and in the mirror.
// The city is hidden and the ground is a plain plane, because the subject is
// the model. Sun placed with the camera, for the reason survey.mjs learned
// the hard way: a stale shadow map paints blotches that read as the bug
// being hunted.
//
// Same-seed discipline as vehshots: a before/after comparison is only honest
// if both sheets photograph the SAME variant, so the seed is pinned in the
// filename and defaults to 0.

import { spawn } from 'node:child_process';
import { writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';

const PORT = +process.env.AUTO_CDP_PORT || 9229;
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const HTTP_PORT = process.env.AUTO_HTTP_PORT || 8000;
const TAG = process.argv[2] || 'now';
const SEED = parseInt(process.argv[3] || '0', 10);
const OUT = `tools/data/char/${TAG}`;
// `lineup`: every pooled look (one seed per look, found the way makeHumanoid
// picks them) plus a cop, side by side at street distance -- a single seed
// says nothing about whether the POOL reads as a crowd of different people.
const LINEUP = process.argv.includes('lineup');
// CHAR_VIEWS=face,profile limits the sheet while iterating. CHAR_PROBE=
// 'face:350,120;360,140|profile:200,300' raycasts those pixels of those views
// back to the character and prints every surface along the ray -- which part
// drew it and where, in character space. Debug a pixel by what drew it, not by
// what it looks like.
const ONLY = process.env.CHAR_VIEWS ? process.env.CHAR_VIEWS.split(',') : null;
const PROBE = Object.fromEntries((process.env.CHAR_PROBE || '').split('|').filter(Boolean)
  .map((v) => { const [n, pts] = v.split(':'); return [n, pts.split(';').map((q) => q.split(',').map(Number))]; }));

// name, azimuth (0 = facing camera), target height, distance, fov, [speed]
// A speed poses the figure mid-stride at dt = 0 (a run for the hood and the
// long hair in motion); none is the standing idle.
const VIEWS = [
  ['front', 0, 0.90, 3.1, 35],
  ['three-quarter', 0.7, 0.90, 3.1, 35],
  ['side', Math.PI / 2, 0.90, 3.1, 35],
  ['back', Math.PI, 0.90, 3.1, 35],
  ['head', 0.35, 1.50, 0.85, 30],
  // the mirror distance: the face, its profile and a three-quarter
  ['face', 0, 1.61, 0.50, 30],
  ['face34', 0.62, 1.61, 0.50, 30],
  ['profile', Math.PI / 2, 1.61, 0.62, 30],
  // the whole head side on, nose to nape, for judging the profile's line
  ['profilehead', Math.PI / 2, 1.61, 0.85, 30],
  // framed on the right hand's own bone, wherever the pose put it
  ['hands', 0.45, 'hand', 0.42, 30],
  ['handback', -1.3, 'hand', 0.42, 30],
  // the rider's grip (gripHands), right arm reaching forward as onto the bars
  ['grip', -1.0, 'hand', 0.42, 30, 0, 'grip'],
  // a runner from behind and to the side: hood, nape, long hair
  ['run', 2.45, 1.30, 1.25, 35, 5.0],
];

function launch() {
  return spawn(CHROME, [
    `--remote-debugging-port=${PORT}`, '--headless=new', '--use-gl=swiftshader',
    '--enable-unsafe-swiftshader', LINEUP ? '--window-size=1600,640' : '--window-size=700,900', '--no-first-run',
    `--user-data-dir=/tmp/auto-charshot-profile-${PORT}`, 'about:blank',
  ], { stdio: 'ignore' });
}

async function main() {
  const chrome = launch();
  try {
    let page;
    for (let i = 0; i < 90 && !page; i++) {
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
    const evaluate = async (e) => {
      const r = await send('Runtime.evaluate', { expression: e, returnByValue: true });
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

    await evaluate(`(async () => {
      const d = window.__dbg;
      d.applyQuality('high', true);
      for (const id of ['hud','pad','stickZone','lookZone','objective','toast','rotate','topBtns','pauseMenu','loading'])
        { const e = document.getElementById(id); if (e) e.style.display = 'none'; }
      d.game.paused = true;
      // Hide EVERYTHING that is not a light: props, landmarks and helicopter
      // groups hang straight off the scene, not off world.group, so hiding the
      // named groups still left a tree floating over the model's shoulder.
      for (const o of d.scene.children) {
        if (o.isLight || o === d.sun.target) continue;
        o.visible = false;
      }
      const g = new d.THREE.Mesh(
        new d.THREE.PlaneGeometry(60, 60),
        new d.THREE.MeshStandardMaterial({ color: 0x6e7276, roughness: 0.95 }));
      g.rotation.x = -Math.PI / 2;
      g.position.set(0, 0.001, 0);
      g.receiveShadow = true;
      d.scene.add(g);
      const m = await import('./src/peds.js');
      // CHAR_OPTS='{"cop":true}' or '{"unique":true,"skin":[0.99,0.86,0.74]}'
      // photographs a look the civilian pool never deals (the lightest skin
      // tone is only on a cop and the bike rider).
      const h = m.makeHumanoid({ seed: ${SEED}, scale: 1, ...${process.env.CHAR_OPTS || '{}'} });
      h.mesh.castShadow = true;
      d.scene.add(h.group);
      h.group.position.set(0, 0, 0);
      m.animateWalk(h, 0, 0, 0);
      window.__subject = h;
      window.__animate = m.animateWalk;
      window.__grip = m.gripHands;
      // CHAR_EVAL: an experiment run on the posed subject before the views
      // (e.g. turn off shadows or the map) -- isolate a cause by removing it.
      ${process.env.CHAR_EVAL || ''}
    })()`);
    for (let i = 0; i < 20; i++) { await sleep(300); if (await evaluate('!!window.__subject')) break; }

    rmSync(OUT, { recursive: true, force: true });
    mkdirSync(OUT, { recursive: true });
    if (LINEUP) {
      await evaluate(`(async () => {
        const d = window.__dbg, m = await import('./src/peds.js');
        window.__subject.group.visible = false;
        const hash = (k, j) => { let h = (k * 374761393 + j * 668265263) | 0; h = (h ^ (h >>> 13)) * 1274126177; return ((h ^ (h >>> 16)) >>> 0) / 4294967296; };
        const seeds = [];
        for (let s = 1; seeds.length < 12 && s < 100000; s++) {
          if (Math.floor(hash(s, 9) * 12) % 12 === seeds.length) { seeds.push(s); s = 0; }
        }
        const all = seeds.map((s) => m.makeHumanoid({ seed: s, scale: 1 }));
        all.push(m.makeHumanoid({ seed: 5, scale: 1, cop: true }));
        all.forEach((h, i) => {
          h.mesh.castShadow = true;
          d.scene.add(h.group);
          h.group.position.set((i - 6) * 0.64, 0, 0);
          h.group.rotation.y = 0.30;
          m.animateWalk(h, 0, 0, 0);
        });
        d.camera.fov = 30; d.camera.updateProjectionMatrix();
        // 9 m at 30 deg vertical: in a 1600x640 frame that is ~12 m across,
        // room for thirteen people at 0.64 m and ~230 px each. At 16.5 m they
        // were matchsticks and neither hair nor collars could be judged.
        d.camera.position.set(0, 1.20, 9.0);
        d.camera.lookAt(0, 0.95, 0);
        d.camera.updateMatrixWorld(true);
        // Same direction as ever, but 300 m out: at 12.8 m the subject sat in
        // front of the shadow camera's 20 m near plane, so it was never in the
        // shadow map at all and the portraits could not show self-shadowing.
        d.sun.position.set(-6, 9, 8).normalize().multiplyScalar(300).add(new d.THREE.Vector3(0, 1, 0));
        d.sun.target.position.set(0, 1, 0);
        d.sun.target.updateMatrixWorld();
        d.scene.updateMatrixWorld(true);
        window.__lineup = true;
      })()`);
      for (let i = 0; i < 30; i++) { await sleep(300); if (await evaluate('!!window.__lineup')) break; }
      await sleep(6000);
      await evaluate(`(() => { const pm = document.getElementById('pauseMenu'); if (pm) pm.style.display = 'none'; })()`);
      const { result } = await send('Page.captureScreenshot', { format: 'png' });
      writeFileSync(`${OUT}/lineup.png`, Buffer.from(result.data, 'base64'));
      console.log(`lineup -> ${OUT}/lineup.png`);
      return;
    }
    for (const [name, az, th, dist, fov, spd = 0, pose = ''] of VIEWS) {
      if (ONLY && !ONLY.includes(name)) continue;
      await evaluate(`(() => {
        const d = window.__dbg, h = window.__subject;
        h.group.position.set(0, 0, 0);
        h.group.rotation.y = ${az};   // turn the subject, keep the light fixed
        h.phase = ${spd ? 1.1 : 0};
        if (window.__animate) window.__animate(h, ${spd ? 0.8 : 0}, 0, ${spd});
        if (${JSON.stringify(pose)} === 'grip' && window.__grip) {
          h.bones[9].rotation.set(-1.25, 0, 0.25); h.bones[10].rotation.set(-0.35, 0, 0);
          window.__grip(h);
        }
        // The game's 0.5 m near plane cuts a face shot at 0.5 m in half.
        d.camera.near = ${dist} < 1 ? 0.05 : 0.5;
        d.camera.fov = ${fov}; d.camera.updateProjectionMatrix();
        let tx = 0, cy = ${typeof th === 'number' ? th : 0};
        if (${JSON.stringify(th)} === 'hand') {
          h.group.updateMatrixWorld(true);
          const p = new d.THREE.Vector3(0, -0.07, 0.01);
          h.bones[11].localToWorld(p);
          tx = p.x; cy = p.y;
          d.camera.position.set(tx, cy + ${dist} * 0.10, p.z + ${dist});
          d.camera.lookAt(tx, cy, p.z);
        } else {
          d.camera.position.set(0, cy + ${dist} * 0.10, ${dist});
          d.camera.lookAt(0, cy, 0);
        }
        d.camera.updateMatrixWorld(true);
        // Same direction as ever, but 300 m out: at 12.8 m the subject sat in
        // front of the shadow camera's 20 m near plane, so it was never in the
        // shadow map at all and the portraits could not show self-shadowing.
        d.sun.position.set(-6, 9, 8).normalize().multiplyScalar(300).add(new d.THREE.Vector3(0, 1, 0));
        d.sun.target.position.set(0, 1, 0);
        d.sun.target.updateMatrixWorld();
        d.scene.updateMatrixWorld(true);
      })()`);
      await sleep(5000);
      // headless pages can fire visibilitychange, which opens the pause card
      await evaluate(`(() => { const pm = document.getElementById('pauseMenu'); if (pm) pm.style.display = 'none'; })()`);
      const { result } = await send('Page.captureScreenshot', { format: 'png' });
      writeFileSync(`${OUT}/${name}.png`, Buffer.from(result.data, 'base64'));
      console.log(`  ${name}`);
      if (PROBE[name]) {
        const out = await evaluate(`(() => {
          const d = window.__dbg, h = window.__subject, T = d.THREE;
          const parts = h.mesh.geometry.userData.parts || [];
          const rc = new T.Raycaster();
          return ${JSON.stringify(PROBE[name])}.map(([px, py]) => {
            rc.setFromCamera(new T.Vector2(px / innerWidth * 2 - 1, 1 - py / innerHeight * 2), d.camera);
            const hits = rc.intersectObject(h.mesh, false);
            return px + ',' + py + ': ' + hits.slice(0, 4).map((q) => {
              const pt = h.group.worldToLocal(q.point.clone());
              const pa = parts.find((r) => q.faceIndex >= r.tri0 && q.faceIndex < r.tri0 + r.tris);
              // and where that is on the BIND pose (the geometry as built), from
              // the triangle's corners and the hit's barycentric coordinates
              const P = h.mesh.geometry.attributes.position, f = q.face, bc = q.barycoord;
              const bind = [0, 1, 2].map((k) => (bc ? P.getComponent(f.a, k) * bc.x + P.getComponent(f.b, k) * bc.y + P.getComponent(f.c, k) * bc.z : P.getComponent(f.a, k)));
              return (pa ? pa.name : '?') + '#' + (pa ? q.faceIndex - pa.tri0 : q.faceIndex) + ' d=' + q.distance.toFixed(4)
                + ' bind(' + bind.map((v) => v.toFixed(4)).join(',') + ')';
            }).join('  |  ');
          }).join('\\n');
        })()`);
        console.log(out);
      }
    }
    console.log(`${VIEWS.length} views (seed ${SEED}) -> ${OUT}/`);
  } finally {
    chrome.kill('SIGKILL');
  }
}

main().catch((e) => { console.error('charshots failed:', e.message); process.exitCode = 1; });
