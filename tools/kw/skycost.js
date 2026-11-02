// Cost A/B of the night sky: frames drawn in 6 s with __noSky on / off, facing the aurora from the air.
//   AUTO_PHONE=1 VIEW_THROTTLE=8 AUTO_GPU=1 VIEW_PROBE_FILE=tools/kw/skycost.js node tools/kw/kwshots.mjs /tmp/x
// (headless is SwiftShader: fill-rate bound, so it is a fair stand-in for fragment cost, not for a phone's GPU)
(async () => {
  const d = window.__dbg, S = d.sky;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  window.__tod = 'night'; window.__weather = 'clear'; S.aurora(true); d.game.paused = false;
  d.camera.fov = 75; d.camera.updateProjectionMatrix();
  const frames = async (ms) => {
    let n = 0; let go = true;
    const f = () => { n++; if (go) requestAnimationFrame(f); };
    requestAnimationFrame(f);
    await sleep(ms); go = false; return n;
  };
  const res = [];
  for (let round = 0; round < 3; round++) {
    for (const off of [false, true]) {
      window.__noSky = off;
      const cam = d.player.vehicle || d.player;
      d.camera.position.set(-3200, 381, -900); d.camera.lookAt(-3200, 330, -1700);
      await sleep(800);
      const n = await frames(5000);
      res.push((off ? 'off ' : 'on  ') + (n / 5).toFixed(2) + ' fps  calls ' + d.sceneStats.calls);
    }
  }
  return res.join('\n');
})()
