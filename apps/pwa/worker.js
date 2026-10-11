/* PWA probe helper worker. One command per message, one worker per command.
   It is a real same-origin file (not a blob) so the service worker serves it
   with the same COOP/COEP headers as the page, the way a game's worker would. */
const CMDS = {
  async env() {
    const out = {
      crossOriginIsolated: self.crossOriginIsolated,
      SharedArrayBuffer: typeof SharedArrayBuffer,
      hardwareConcurrency: navigator.hardwareConcurrency,
    };
    if (typeof OffscreenCanvas === 'undefined') {
      out.offscreenWebgl2 = 'OffscreenCanvas is undefined';
    } else {
      try {
        const gl = new OffscreenCanvas(4, 4).getContext('webgl2');
        out.offscreenWebgl2 = gl ? gl.getParameter(gl.VERSION) : 'getContext("webgl2") returned null';
      } catch (e) { out.offscreenWebgl2 = `threw ${e.name}: ${e.message}`; }
    }
    if (!navigator.gpu) {
      out.workerWebGPU = 'navigator.gpu is undefined';
    } else {
      try {
        const a = await navigator.gpu.requestAdapter();
        out.workerWebGPU = a ? `adapter ok (${a.info ? a.info.vendor : '?'})` : 'requestAdapter() returned null';
      } catch (e) { out.workerWebGPU = `threw ${e.name}: ${e.message}`; }
    }
    return out;
  },

  // Bump slot 1 so the page sees us, then block on slot 0 until the page notifies.
  sab({ sab }) {
    const a = new Int32Array(sab);
    Atomics.add(a, 1, 1);
    const t = performance.now();
    const wait = Atomics.wait(a, 0, 0, 5000);
    return { wait, waitedMs: performance.now() - t };
  },

  async wasm({ module, memory, n }) {
    const inst = await WebAssembly.instantiate(module, { e: { m: memory } });
    const t = performance.now();
    inst.exports.inc(n);
    return { ms: performance.now() - t };
  },
};

self.onmessage = async ({ data: m }) => {
  try {
    self.postMessage({ ok: true, ...(await CMDS[m.cmd](m)) });
  } catch (e) {
    self.postMessage({ ok: false, error: `${e && e.name}: ${e && e.message}` });
  }
};
