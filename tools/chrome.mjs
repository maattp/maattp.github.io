// The one place the auto harnesses decide how Chrome is launched.
//
//   default       headless Chrome on SwiftShader (software GL, ~5 fps). Slow,
//                 but deterministic and identical on every machine.
//   AUTO_GPU=1    headless Chrome on the Mac's GPU through ANGLE's Metal
//                 backend. Headless DOES get the GPU with these flags (checked
//                 on an M2 Pro: UNMASKED_RENDERER_WEBGL reads "ANGLE Metal
//                 Renderer: Apple M2 Pro", and EXT_disjoint_timer_query_webgl2
//                 is exposed), so no headed window is needed.
//   AUTO_GPU_HEADED=1  (with AUTO_GPU=1) a visible window instead, with the
//                 background throttles off so rAF keeps running unfocused.
//
// **A pixel-exact before/after pair must use the SAME renderer on both
// sides.** SwiftShader and Metal differ in rasterisation, precision and
// texture filtering, so a SwiftShader "before" against a GPU "after" diffs on
// every edge in the frame and proves nothing. Pick one mode per comparison.
//
// `RENDERER_EXPR` / `assertRenderer(evaluate)` read WEBGL_debug_renderer_info
// off the game's own context: with AUTO_GPU=1 a SwiftShader answer means the
// GPU was not obtained, and the harness must stop rather than report
// software timings as GPU ones.

import { spawn } from 'node:child_process';
import { rmSync } from 'node:fs';

export const CHROME = process.env.AUTO_CHROME
  || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
export const GPU = process.env.AUTO_GPU === '1';
export const HEADED = GPU && process.env.AUTO_GPU_HEADED === '1';

/**
 * Chrome's argument list for a harness.
 *   port      CDP port
 *   profile   --user-data-dir (a /tmp path; removed by `launchChrome`'s kill)
 *   width/height  window size
 *   vsyncOff  uncap the frame rate (GPU mode only) so rAF intervals measure
 *             the frame, not the display
 *   extra     harness-specific flags (autoplay, precise memory info, ...)
 *   gpu/headed  override AUTO_GPU / AUTO_GPU_HEADED (perfbisect is GPU-only)
 */
export function chromeArgs({ port, profile, width = 1280, height = 720, vsyncOff = false, extra = [],
  gpu = GPU, headed = HEADED }) {
  const a = [`--remote-debugging-port=${port}`];
  if (!headed) a.push('--headless=new');
  if (gpu) {
    a.push('--use-gl=angle', '--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist',
      // Never let a hidden or unfocused page's rAF be throttled: every harness
      // drives the real game loop at least some of the time.
      '--disable-background-timer-throttling', '--disable-renderer-backgrounding',
      '--disable-backgrounding-occluded-windows');
    if (vsyncOff) a.push('--disable-gpu-vsync', '--disable-frame-rate-limit');
  } else {
    a.push('--disable-gpu-sandbox', '--use-gl=swiftshader', '--enable-unsafe-swiftshader');
  }
  a.push(`--window-size=${width},${height}`, '--no-first-run', '--no-default-browser-check',
    ...extra, `--user-data-dir=${profile}`, 'about:blank');
  return a;
}

/**
 * Spawn Chrome. The returned child's `kill()` also deletes the profile dir, so
 * a harness that kills its Chrome in `finally` leaves nothing behind in /tmp.
 */
export function launchChrome(opts) {
  const child = spawn(CHROME, chromeArgs(opts), { stdio: 'ignore', detached: false });
  const kill = child.kill.bind(child);
  child.kill = (sig = 'SIGKILL') => {
    const r = kill(sig);
    // Chrome writes to the profile until it is gone; retry the delete briefly.
    const rm = (n) => {
      try { rmSync(opts.profile, { recursive: true, force: true }); } catch (e) {
        if (n > 0) setTimeout(() => rm(n - 1), 300);
      }
    };
    child.once('exit', () => rm(5));
    if (child.exitCode !== null) rm(5);
    return r;
  };
  // Harnesses that process.exit() straight after kill() never see the child's
  // 'exit' event, so also kill and clean up synchronously on the way out.
  process.once('exit', () => {
    try { if (child.exitCode === null) kill('SIGKILL'); } catch (e) { /* gone */ }
    try { rmSync(opts.profile, { recursive: true, force: true }); } catch (e) { /* best effort */ }
  });
  return child;
}

/** Expression: the UNMASKED renderer string of the game's context (or a fresh one). */
export const RENDERER_EXPR = `(() => {
  const gl = (window.__dbg && window.__dbg.renderer && window.__dbg.renderer.getContext())
    || document.createElement('canvas').getContext('webgl2');
  if (!gl) return 'no-webgl';
  const e = gl.getExtension('WEBGL_debug_renderer_info');
  return e ? gl.getParameter(e.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
})()`;

/**
 * Read and check the renderer through the harness's own `evaluate(expr)`.
 * Throws under AUTO_GPU=1 when the context is SwiftShader after all.
 */
export async function assertRenderer(evaluate, log = console.log, gpu = GPU) {
  const name = String(await evaluate(RENDERER_EXPR));
  const soft = /swiftshader/i.test(name);
  log(`  renderer: ${name}${gpu ? ' [GPU]' : ''}`);
  if (gpu && soft) throw new Error(`AUTO_GPU=1 but the context is SwiftShader (${name})`);
  return name;
}
