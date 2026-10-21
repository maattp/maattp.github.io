// Auto KW: the scenery cars' near LOD in the running game, for kwshots.mjs VIEW_PROBE_FILE.
//
//   VIEW_PROBE_FILE=tools/kw/scenerycars.js AUTO_PHONE=1 AUTO_GPU=1 node tools/kw/kwshots.mjs /tmp/x
//
// Respawns at four residential sites, unpauses, and counts one frame's scene-
// and shadow-pass draws (and the `sceneryCars` meshes' share of each) and the
// scenery cars drawn in their detailed model (traffic.js updateFarLod).
(async () => {
  const d = window.__dbg, R = d.renderer;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const SITES = window.__scSites || [['doonsouth', 3600, 8555], ['westmount', -3640, 190], ['activa', -2790, 4480], ['mthope', -1530, -775]];
  const out = [];
  for (const [name, x, z] of SITES) {
    d.player.respawn(x, z);
    d.game.paused = false;
    await sleep(7000);
    const g = { scene: 0, shadow: 0, sceneSc: 0, shadowSc: 0 };
    let on = false;
    const orig = R.renderBufferDirect;
    R.renderBufferDirect = function (camera, scene, geometry, material, object) {
      if (on) {
        const sh = camera !== d.camera, sc = object.name === 'sceneryCars';
        if (sh) { g.shadow++; if (sc) g.shadowSc++; } else { g.scene++; if (sc) g.sceneSc++; }
      }
      return orig.apply(this, arguments);
    };
    await new Promise((r) => requestAnimationFrame(() => { on = true; requestAnimationFrame(() => { on = false; r(); }); }));
    R.renderBufferDirect = orig;
    let nn = 0;
    for (const e of (d.traffic.nearMeshes || new Map()).values()) nn += e.mesh && e.mesh.visible ? e.n : 0;
    out.push(`${name}: scene ${g.scene} (sceneryCars ${g.sceneSc}), shadow ${g.shadow} (sceneryCars ${g.shadowSc}), near cars ${nn}, driveway cars kept ${d.dcars ? d.dcars.shown : '-'}`);
    d.game.paused = true;
  }
  return out.join('\n');
})()
