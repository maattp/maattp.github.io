# iPhone PWA capabilities for high-performance games

Measured with the probe in this folder (`/apps/pwa/`, v2), running as a
home-screen app (standalone) on the user's iPhone. Every number below came from
that device. Re-run the probe after an iOS update before relying on anything
marked as a limitation.

**Device:** iPhone 17 Pro class: 402×874 CSS px @3x = 1206×2622 physical px,
6 CPU cores (2 performance + 4 efficiency), Apple GPU. **iOS:** Safari 27.0.1
(the UA string is frozen at `iPhone OS 18_7` and doesn't show the real version).
Measured 2026-10-11 on home Wi-Fi, mostly in portrait, with Low Power Mode off.

## Rules of thumb

1. **WebGPU works.** It renders, runs compute shaders, and works from workers. Use it as
   the primary renderer; WebGL2 also works fully and is about as fast.
2. **Budget the GPU for when the phone is warm, not cold.** A heavy load went from 9.2 ms to
   16.3 ms of GPU time per frame after about 20 s. Plan on roughly half the cold numbers below.
3. **60 Hz is the ceiling.** `requestAnimationFrame` never ran faster than 60 Hz.
   Design for a 16.7 ms frame.
4. **Threads work, but only if the service worker adds COOP/COEP** (see Hosting).
   Use 4–5 workers, not `navigator.hardwareConcurrency` (it reports 4; 6 workers
   give about 5x speedup; 8 workers are slower than 6).
5. **Precompile every pipeline/program at load:** about 30 ms each, uncached.
6. **Start audio on the first tap.** The audio clock only starts moving about 240 ms after
   `resume()`.
7. **No fullscreen API, no orientation lock, no vibration.** Standalone is
   already chrome-free; handle orientation yourself; haptics via `<input switch>`.
8. **Keep total memory well under ~1.9 GB.** iOS kills the app (no exception,
   no `grow()` failure) once committed wasm memory passes ~1.9 GB.
9. **Pause on `visibilitychange`.** In the background, rendering stops and timers drop to
   about 1 per second, but connections and GPU contexts survive (tested for 14 s).

## Hosting: cross-origin isolation on GitHub Pages

GitHub Pages can't send headers. The probe's `sw.js` adds
`Cross-Origin-Opener-Policy: same-origin`, `Cross-Origin-Embedder-Policy:
require-corp` and `Cross-Origin-Resource-Policy: same-origin` to every
same-origin response. **WebKit honours headers added by a service worker:**
`crossOriginIsolated === true` in standalone mode and in a Safari tab.

Copy the pattern from `apps/pwa/sw.js` and the `boot()` function in `apps/pwa/index.html`:
- The first launch has no service worker yet, so the page isn't isolated. Register it, wait
  for `controllerchange`, and reload once (guard the reload with sessionStorage).
  The home-screen app and Safari have **separate storage**, so this happens once in each.
- With `require-corp`, every subresource must be same-origin or served with
  CORS/CORP. CDN scripts need `crossorigin` and a CORS-enabled CDN. `fetch()` to
  the Cloudflare worker (CORS) and WebSockets/WebRTC are unaffected.
- Isolation gives you SharedArrayBuffer, wasm threads, `Atomics.wait` in
  workers, and 20 µs `performance.now()` resolution.

## Display

| | Measured |
|---|---|
| Standalone detection | `navigator.standalone === true`, `(display-mode: standalone)` matches |
| Portrait safe areas | top 62, bottom 34, left/right 0 (CSS px) |
| Landscape safe areas | left 62, right 62, bottom 20, top 0 |
| Fullscreen API | absent (`requestFullscreen` / `webkitRequestFullscreen` undefined) |
| `screen.orientation.lock` | absent |
| Colour | `color-gamut: p3` and `dynamic-range: high` match |
| WebGPU canvas | `display-p3` works; **HDR works**: `rgba16float` + `toneMapping: {mode: 'extended'}` is accepted |

**Viewport quirk at launch.** On a fresh launch in portrait, `innerHeight`, the
`position:fixed; inset:0` box and `100dvh` all read **812**, not 874. That is
short by exactly the top inset. After one rotation, they read 874, and
`100lvh` is 874 from the start. Size the game canvas from `screen.width/height`
(swap them in landscape) or `100lvh`, and re-measure on `resize`. It hasn't been confirmed
that a canvas drawn into that bottom strip at launch actually appears on screen,
so check this visually before shipping.

Orientation can't be locked. A landscape-only game has to show its own
"rotate your phone" screen in portrait, and the manifest `orientation` field shouldn't be relied on.

## GPU

### WebGPU
Adapter `apple`, not a fallback. `requestDevice` takes under 2 ms. Notable features: `shader-f16`,
`float32-filterable`, `float32-blendable`, `float16-renderable`,
`rg11b10ufloat-renderable`, `texture-compression-astc` / `-etc2` / `-bc` (+ sliced 3D),
`timestamp-query`, `indirect-first-instance`, `depth32float-stencil8`,
`clip-distances`, `primitive-index`. Limits: 16384 max 2D texture, 2048 array layers,
11 bind groups, 44 sampled textures / 44 storage buffers per stage, 1 GiB max
buffer and storage/uniform binding, 1024 invocations per workgroup, 8 colour attachments.
4x MSAA with resolve works. WGSL language features:
`packed_4x8_integer_dot_product`, `pointer_composite_access`,
`readonly_and_readwrite_storage_textures`, `texture_formats_tier1`,
`unrestricted_pointer_parameters`. **No subgroups.**

| Benchmark (cold, 1206×2622) | Result |
|---|---|
| Full-screen pass, cheap shader, rgba16float (one pass per layer) | **0.35–0.46 ms** per pass |
| Full-screen pass, rgba8 | 0.48 ms |
| Alpha-blended overdraw, rgba16float | 0.20–0.24 ms per layer |
| Heavy fragment shader (64-iteration sin/fract loop) | 8.7 ms per full screen |
| Compute (fp32 FMA) | **~1.9 TFLOPS** |
| Draw calls with dynamic-offset uniforms | 0.07 µs CPU per draw; 10,000 draws = 0.7 ms CPU, 4.4 ms submit→done |
| `createRenderPipelineAsync`, large uncached shader | ~30 ms (first one ~45 ms) |
| `writeTexture` 2048² RGBA8 (16 MB) | ~5 ms |

### WebGL2
Works fully. ANGLE-on-Metal limits: 16384 textures, 8 MSAA samples, 16
texture units per stage, 1024 uniform vectors per stage, `MAX_UNIFORM_BLOCK_SIZE` 16 KB.
`EXT_color_buffer_float`, `EXT_color_buffer_half_float` and `OES_texture_float_linear` are
available, and **RGBA16F and RGBA32F render targets clear, read back and keep
values above 1.0**. Compressed textures: ASTC, ETC, ETC1, PVRTC, S3TC (+sRGB), BPTC, RGTC.
`KHR_parallel_shader_compile` is available: poll `COMPLETION_STATUS_KHR`, and don't block on link.

| Benchmark | Result |
|---|---|
| Blended overdraw, rgba16f, full screen | ~0.08 ms per layer |
| Heavy shader, full screen | 6.3 ms |
| 10,000 `uniform2f`+`drawArrays` | 0.7 ms CPU |
| Program compile+link (large shader) | ~32 ms (first ~60 ms) |
| `texImage2D` 2048² RGBA8 | ~1.2 ms |

Earlier projects here saw black screens on this iPhone with HalfFloat render targets
(see the `webgl_ios_halffloat` memory). A plain RGBA16F clear, blend and readback
works now. If a half-float pipeline goes black, look at filtering, blending or
format details before blaming the format, and keep an 8-bit fallback tier.

### Thermals (sustained 30 s, WebGPU, native resolution, one heavy pass per frame)

| Window | fps | GPU submit→done |
|---|---|---|
| 0–20 s | 60 | ~9.2 ms |
| 20–30 s | 60 | **~16.3 ms** |

The phone held 60 fps, but the same work took 1.8x longer once warm. Leave headroom
or build dynamic resolution scaling. `onSubmittedWorkDone` latency is a usable signal to
drive it.

### Workers
`OffscreenCanvas` WebGL2 **and** WebGPU both work in a dedicated worker, and
`requestAnimationFrame` exists in workers. A render worker is viable.

## CPU, threads, WebAssembly

| | Measured |
|---|---|
| JS vs wasm (30M-iteration integer loop) | 35 ms vs 29 ms: the JIT is on in standalone, and JS ≈ wasm |
| Parallel speedup (wasm spin, N workers) | 1→1.0x, 2→2.0x, 3→2.8x, 4→3.6x, 5→4.5x, **6→5.0x**, 8→4.7–5.0x |
| Worker spawn → first reply | ~1 ms (first ~2.5 ms) |
| `postMessage` round trip | 0.02 ms; 4 MB Float32Array clone ≈ 2 ms |
| SharedArrayBuffer + `Atomics.wait` in worker | works; `Atomics.waitAsync` present |
| Wasm threads (shared memory, atomics across workers) | exact |
| Shared `WebAssembly.Memory` reservation | maximum 256 MB / 1 / 2 / 4 GB all accepted (address space only) |
| **Committed wasm memory before iOS kills the app** | **~1.9 GB**: survived 1920 MB, killed while growing to 2048 MB (128 MB steps, every 4 KB page touched). `grow()` never threw; the process was terminated |
| Wasm SIMD128 | yes |
| Wasm proposals | **yes**: bulk memory, exceptions (legacy and exnref), tail calls, GC, JSPI, `WebAssembly.Tag`. **no**: relaxed SIMD, memory64, multi-memory |

Memory: the kill is silent, so the game can't catch it. The ~1.9 GB measured is for
wasm alone; JS heap, decoded images and GPU resources share the phone's unified
memory and count against the same limit. Target a total footprint under ~1.2–1.5 GB,
and set the wasm `maximum` to what you need, not 4 GB.

Toolchains: don't pass `-mrelaxed-simd` or `-sMEMORY64`. Emscripten with
`-pthread -msimd128 -fwasm-exceptions` matches what the phone supports. Rapier,
Jolt, Box2D and similar physics builds with SIMD and threads will run.

Scheduling: `scheduler.postTask`, `scheduler.yield`, `requestIdleCallback`
and long-task observers are **absent**. Nested `setTimeout(0)` clamps to 4 ms
and `setInterval(1)` runs every 8 ms. Use `MessageChannel` (0.04 ms round trip) or
workers to yield.

## Audio

- Create and `resume()` the AudioContext **inside the first tap**. `resume()`
  resolves in about 20 ms, but the clock only starts advancing **about 240 ms later**. After
  that it runs at real time (1.00 ± 0.02). Start audio during the title screen, not
  at race start.
- `navigator.audioSession.type = 'playback'` works and plays through the silent
  switch. Its default is `auto`.
- 48 kHz, `baseLatency` 2.7 ms, `outputLatency` 12.4 ms. (`outputLatency`
  has also read as nonsense — 95 million ms — right after launch; ignore values over 2 s.)
- AudioWorklet (blob-URL module) and `decodeAudioData` both work.
- An AudioContext playing a silent tone stayed `running` while the app was in the
  background.

## Input

| | Measured |
|---|---|
| Touch points | `maxTouchPoints` 5; multi-touch delivered |
| `touchmove` / `pointermove` | delivered roughly per frame |
| `getCoalescedEvents` | ~3.4 samples per pointermove (~80 Hz raw) — read them for smooth steering |
| `getPredictedEvents` | present and populated |
| Event timestamp → handler | median 12 ms, p95 21 ms |
| `preventDefault` on touch | stops scrolling |
| Device motion (tilt) | needs `DeviceMotionEvent.requestPermission()` in a tap; ~60 Hz. **`event.interval` is in seconds** (0.0167), not the ms the spec says |
| Vibration | `navigator.vibrate` absent. The hidden `<input type=checkbox switch>` toggle (iOS haptic tick) is detected |
| Gamepad API | present; not yet tested with a controller |

## Networking

| | Measured |
|---|---|
| WebRTC data channels (loopback) | open in ~60 ms; RTT 0.2 ms; unreliable (`ordered:false, maxRetransmits:0`) works; `sctp.maxMessageSize` 262144 |
| STUN (stun.cloudflare.com) | public (srflx) address found; host candidates are mDNS `.local` |
| **TURN** | **not configured** on the worker (`/sf/turn` returns STUN only). Phones behind carrier NAT may fail to connect P2P. Set `CF_TURN_KEY_ID` + `CF_TURN_API_TOKEN` on the worker to enable |
| WebSocket to the Cloudflare worker (Wi-Fi) | create room + connect ~700 ms; echo RTT median 13 ms |
| WebTransport | present (not yet tested against a server) |
| GitHub Pages download (5.5 MB file, Wi-Fi) | ~5 MB/s cold, ~25 MB/s warm; cellular not yet measured |

Signaling already exists: the `/sf/*` relay rooms on the worker (`POST
/sf/rooms`, WebSocket `/sf/rooms/:code/ws`: `hello`→`welcome`, `roster`, `rtc`
relayed peer-to-peer, `pp` echo, host `snap` / guest `input`). The probe's
`pairTest()` is a minimal working client.

**Phone-to-phone P2P has not been measured yet.** It works between two tabs on
one machine through the production worker (0% loss at 60 Hz, ~20 ms through the
relay vs ~1.5 ms direct). To fill this in, run the probe's Pair test on two phones,
one of them on cellular.

## Lifecycle (left the app for 14 s, then returned)

| | Behaviour |
|---|---|
| `requestAnimationFrame` | stops completely |
| `setInterval(100)` | throttled to ~1.2/s (not frozen) |
| WebRTC data channel | stayed open and kept delivering messages (~1/s, the throttled sends) |
| WebSocket to worker | stayed open (RTT on return 34 ms, then normal) |
| AudioContext | stayed `running` |
| WebGL context / WebGPU device | not lost; both worked on return |
| Events | `blur` + `visibilitychange → hidden` on leave; `focus` + `visibilitychange → visible` on return. No `pagehide`/`freeze` |

So a short app switch doesn't need to tear down a multiplayer session. Pause the
simulation on `hidden`, keep the connection, and resync on `visible`. Longer absences
(minutes, screen lock) have not been tested.

## Storage

| | Measured |
|---|---|
| Quota | ~39 GB (`navigator.storage.estimate`) |
| `navigator.storage.persist()` | **granted** in standalone (exempts the data from WebKit's 7-day eviction) |
| IndexedDB | 1 MB Blob round trip OK |
| Cache API | 32 MB put ~500 MB/s, read ~2 GB/s |
| OPFS (main thread `createWritable`) | works |
| OPFS sync access handle (worker) | 64 MB: write 1.1–2.3 GB/s, read ~15 GB/s, the fastest asset cache |
| Service worker | installs, controls the page, works offline |

Images: `createImageBitmap` decodes a 2048² JPEG in ~11 ms and a PNG in ~28 ms, and
`copyExternalImageToTexture` takes ~20 ms. Prefer **ASTC/KTX2** textures (no decode
step). `ImageDecoder` is absent; WebCodecs `VideoDecoder`/`AudioDecoder` are
present; gzip `CompressionStream`/`DecompressionStream` work. Canvas
`convertToBlob` can't encode WebP (WebP decoding wasn't tested).

## Not yet measured

- Phone-to-phone P2P over cellular (pair test), and whether TURN is needed.
- GPU memory ceiling: how much WebGPU buffer space can be allocated before an
  out-of-memory error or a kill (the probe's "Memory: GPU" button).
- Gamepad input with a real controller.
- Whether anything renders in the bottom strip of the short viewport at launch.
- 120 Hz: nothing tried got past 60 Hz. There may be no way.
- Backgrounding for minutes, or with the screen locked.

## Re-measuring

Open `https://polkiewicz.com/apps/pwa/` from the home-screen icon, let the
automatic checks finish, run the interactive tests (buttons), then **Copy results**.
`?coi=0` turns isolation off for comparison. Probe source: `apps/pwa/index.html`
(checks), `worker.js` (worker side), `sw.js` (isolation + offline).
