// Scene category breakdown on the phone profile: draws and triangles IN THE
// FRUSTUM by category (terrain is the 'other/ map vc' row), and the biggest
// meshes. A mesh counts the triangles it will draw (drawRange).
//
//   AUTO_HTTP_PORT=8000 AUTO_CDP_PORT=9461 [SPOTS='dt:305,-278;fly:305,-278,450'] [TERRAIN_LOD=off] node tools/tricats.mjs
//
// Each spot respawns the player there, settles the streamer, then counts. A
// third number is an altitude: the camera is lifted that far over the spot,
// looking south (the plane's view; the player stays on the ground). TERRAIN_LOD=off
// draws every terrain block at full detail, i.e. the terrain as it was before
// the LOD, for a before/after from one build.
import { setTimeout as sleep } from 'node:timers/promises';
import { launchChrome } from './chrome.mjs';
const HTTP_PORT = process.env.AUTO_HTTP_PORT || 8000;
const PORT = +process.env.AUTO_CDP_PORT || 9461;
const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 19_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/19.0 Mobile/15E148 Safari/604.1';
const SPOTS = (process.env.SPOTS || 'dt:305,-278').split(';').map((s) => { const [n, c] = s.split(':'); const [x, z, alt] = c.split(','); return { n, x: +x, z: +z, alt: alt ? +alt : 0 }; });
const chrome = launchChrome({ port: PORT, profile: `/tmp/auto-s5cats-${PORT}`, gpu: true, width: 874, height: 402, vsyncOff: true });
try {
  let page;
  for (let i = 0; i < 90 && !page; i++) { try { page = (await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()).find((t) => t.type === 'page'); } catch {} if (!page) await sleep(300); }
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((r, j) => { ws.addEventListener('open', r); ws.addEventListener('error', j); });
  let id = 0; const pend = new Map();
  ws.addEventListener('message', (e) => { const m = JSON.parse(e.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); } });
  const send = (m, p = {}) => new Promise((res) => { ws.send(JSON.stringify({ id: ++id, method: m, params: p })); pend.set(id, res); });
  const ev = async (e) => { const r = await send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true }); if (r.result?.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails).slice(0, 600)); return r.result?.result?.value; };
  await send('Runtime.enable'); await send('Page.enable'); await send('Network.enable');
  await send('Network.setBypassServiceWorker', { bypass: true });
  await send('Network.setCacheDisabled', { cacheDisabled: true });
  await send('Emulation.setDeviceMetricsOverride', { width: 874, height: 402, deviceScaleFactor: 3, mobile: true, screenWidth: 874, screenHeight: 402, screenOrientation: { type: 'landscapePrimary', angle: 90 } });
  await send('Emulation.setUserAgentOverride', { userAgent: UA, platform: 'iPhone' });
  await send('Page.addScriptToEvaluateOnNewDocument', { source: `window.__noAutoQuality = true; try { localStorage.setItem('auto-quality', 'high'); } catch (e) {}` });
  await send('Page.navigate', { url: `http://localhost:${HTTP_PORT}/apps/auto/` });
  for (let i = 0; i < 600; i++) { await sleep(500); try { if (await ev('!!window.__dbg')) break; } catch {} }
  for (let i = 0; i < 240; i++) { if (await ev('window.__dbg.sceneStats.calls > 0 && window.__dbg.traffic.cars.length > 0')) break; await sleep(500); }
  console.log('booted');
  for (const S of SPOTS) {
    console.log('spot', S.n);
    await ev(`(async () => { const d = window.__dbg; d.player.respawn(${S.x}, ${S.z});
      const t0 = performance.now(); while (performance.now() - t0 < 8000) await new Promise((r) => requestAnimationFrame(r));
      d.game.paused = true;
      const pend = () => [...d.world.chunks.values()].filter((c) => c.lod !== c.wantLod).length;
      for (let i = 0; i < 3000 && pend() > 0; i++) d.world.update(${S.x}, ${S.z}, 60);
      if (${S.alt}) {
        const g = Math.max(0, d.city.groundAt(${S.x}, ${S.z}, null));
        d.camera.position.set(${S.x}, g + ${S.alt}, ${S.z}); d.camera.lookAt(${S.x}, g + ${S.alt} * 0.6, ${S.z} + 1000); d.camera.updateMatrixWorld(true);
      }
      const L = d.world.terrainLod;
      if (${JSON.stringify(process.env.TERRAIN_LOD === 'off')}) { L.off = true; L.lv.fill(0); for (const T of L.tiles) { T.dirty = true; T.mesh.visible = true; T.live = T.bw * T.bd; } L.noCull = true; }
      for (let i = 0; i < 20; i++) await new Promise((r) => requestAnimationFrame(r)); })()`);
    const out = await ev(`(() => {
      const d = window.__dbg, THREE = d.THREE, cam = d.camera, scene = d.scene;
      scene.updateMatrixWorld(true); cam.updateMatrixWorld(true);
      const fr = new THREE.Frustum(); fr.setFromProjectionMatrix(new THREE.Matrix4().multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse));
      const sph = new THREE.Sphere();
      const rows = {};
      const topName = (o) => { let t = o; while (t.parent && t.parent !== scene) t = t.parent; return t; };
      let total = { calls: 0, tris: 0 };
      const chunkGroups = new Map(); for (const c of d.world.chunks.values()) if (c.group) chunkGroups.set(c.group, c.lod);
      scene.traverseVisible((o) => {
        if (!(o.isMesh || o.isLine || o.isPoints)) return;
        for (let p = o.parent; p; p = p.parent) if (!p.visible) return;
        const g = o.geometry; if (!g) return;
        if (o.frustumCulled !== false) {
          if (!g.boundingSphere) { try { g.computeBoundingSphere(); } catch (e) { return; } }
          sph.copy(g.boundingSphere).applyMatrix4(o.matrixWorld);
          if (!fr.intersectsSphere(sph)) return;
        }
        let tris = g.index ? g.index.count / 3 : (g.attributes.position ? g.attributes.position.count / 3 : 0);
        if (g.drawRange && g.drawRange.count !== Infinity) tris = Math.min(tris, g.drawRange.count / 3);
        if (o.isInstancedMesh) tris *= (o.count || 0);
        if (o.isLine || o.isPoints) tris = 0;
        const t = topName(o);
        let key = (t.name || t.constructor.name);
        if (key === 'Group' || key === 'Object3D' || key === '') {
          const m = o.material; let chunk = null; for (let p = o.parent; p; p = p.parent) { if (chunkGroups.has(p)) { chunk = p; break; } }
          const lod = chunk ? chunkGroups.get(chunk) : '-';
          key = (chunk ? 'chunk lod' + lod : 'other') + '/' + (m ? (m.name || '') + ' ' + (m.map ? 'map' : '') + (m.vertexColors ? ' vc' : '') + (m.isShaderMaterial ? ' shader' : '') + (o.isSkinnedMesh ? ' skinned' : '') + (o.castShadow ? ' cast' : '') : '');
        }
        const r = rows[key] || (rows[key] = { calls: 0, tris: 0, inst: 0, skinned: 0, shadowCasters: 0, mats: new Set() });
        r.calls++; r.tris += tris; if (o.isInstancedMesh) r.inst++; if (o.isSkinnedMesh) r.skinned++; if (o.castShadow) r.shadowCasters++;
        r.mats.add(o.material && (o.material.type + (o.material.transparent ? 't' : '')));
        total.calls++; total.tris += tris;
      });
      const top = Object.entries(rows).map(([k, r]) => ({ k, calls: r.calls, trisK: Math.round(r.tris / 1000), inst: r.inst, skinned: r.skinned, sc: r.shadowCasters, mats: [...r.mats].join(',') })).sort((a, b) => b.trisK - a.trisK);
      const I = d.renderer.info;
      return JSON.stringify({ cam: [cam.position.x|0, cam.position.z|0], total, top, geos: I.memory.geometries, texs: I.memory.textures, progs: I.programs.length, kids: scene.children.length });
    })()`);
    const big = await ev(`(() => { const d = window.__dbg, scene = d.scene; const THREE = d.THREE; const cam = d.camera;
      const fr = new THREE.Frustum(); fr.setFromProjectionMatrix(new THREE.Matrix4().multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse)); const sph = new THREE.Sphere();
      const rows = []; scene.traverseVisible((o) => { if (!o.isMesh || !o.geometry) return; for (let p = o.parent; p; p = p.parent) if (!p.visible) return;
        const g = o.geometry; if (!g.boundingSphere) return; sph.copy(g.boundingSphere).applyMatrix4(o.matrixWorld); if (o.frustumCulled !== false && !fr.intersectsSphere(sph)) return;
        const tris = (g.index ? g.index.count : g.attributes.position.count) / 3; const chain = []; for (let p = o; p && p !== scene; p = p.parent) chain.push((p.name || p.type) + (p.userData && Object.keys(p.userData).length ? '{' + Object.keys(p.userData).slice(0,3).join(',') + '}' : ''));
        rows.push({ tris: Math.round(tris / 1000), v: g.attributes.position.count, chain: chain.join(' < '), cast: o.castShadow, rec: o.receiveShadow, dist: Math.round(Math.hypot(sph.center.x - cam.position.x, sph.center.z - cam.position.z)), r: Math.round(sph.radius) }); });
      rows.sort((a, b) => b.tris - a.tris); return JSON.stringify(rows.slice(0, 16)); })()`);
    console.log(JSON.parse(big).map((r) => JSON.stringify(r)).join('\n'));
    const j = JSON.parse(out);
    console.log('cam', j.cam); console.log(`\n== ${S.n} (${S.x},${S.z}): in-frustum meshes ${j.total.calls}, ${Math.round(j.total.tris / 1000)}k tris; geos ${j.geos} texs ${j.texs} progs ${j.progs}`);
    for (const r of j.top.slice(0, 24)) console.log(`  ${String(r.trisK).padStart(6)}k  ${String(r.calls).padStart(4)} calls  inst ${r.inst} skin ${r.skinned} casters ${r.sc}  ${r.k}  [${r.mats.slice(0, 60)}]`);
  }
} catch (e) { console.log('ERR', e); } finally { chrome.kill(); process.exit(0); }
