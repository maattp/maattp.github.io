/* PWA probe helper worker. Every message carries an `id`; the reply echoes it.
   It is a real same-origin file (not a blob) so the service worker serves it
   with the same COOP/COEP headers as the page, the way a game's worker would. */
let runInstance = null;

const CMDS = {
  async env() {
    const out = {
      crossOriginIsolated: self.crossOriginIsolated,
      SharedArrayBuffer: typeof SharedArrayBuffer,
      hardwareConcurrency: navigator.hardwareConcurrency,
      requestAnimationFrame: typeof self.requestAnimationFrame === 'function',
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

  // CPU scaling: load the integer-loop module once, then spin on demand.
  async load({ module }) {
    runInstance = await WebAssembly.instantiate(module);
    return {};
  },
  spin({ n }) {
    const t = performance.now();
    const r = runInstance.exports.run(n);
    return { ms: performance.now() - t, r };
  },
  echo() { return {}; },

  // OPFS sync access handles only exist in workers — the fast path for asset caches.
  async opfs({ mb }) {
    const root = await navigator.storage.getDirectory();
    const fh = await root.getFileHandle('probe-sync.bin', { create: true });
    if (!fh.createSyncAccessHandle) throw new Error('createSyncAccessHandle is undefined');
    const h = await fh.createSyncAccessHandle();
    const chunk = new Uint8Array(1 << 20).fill(3);
    let t = performance.now();
    for (let i = 0; i < mb; i++) h.write(chunk, { at: i << 20 });
    h.flush();
    const writeMs = performance.now() - t;
    t = performance.now();
    for (let i = 0; i < mb; i++) h.read(chunk, { at: i << 20 });
    const readMs = performance.now() - t;
    h.close();
    await root.removeEntry('probe-sync.bin');
    return { writeMs, readMs };
  },
};

self.onmessage = async ({ data: m }) => {
  try {
    self.postMessage({ id: m.id, ok: true, ...(await CMDS[m.cmd](m)) });
  } catch (e) {
    self.postMessage({ id: m.id, ok: false, error: `${e && e.name}: ${e && e.message}` });
  }
};
