// Wreck & Ruin service worker: full offline play. The game needs five pinned
// CDN files (Three.js module + addons, Rapier physics with inlined WASM,
// es-module-shims) — all versioned upstream, immutable: cache-first, cached
// LAZILY by the fetch handler and copied forward across CACHE bumps.
//
// INSTALL MUST STAY SHELL-ONLY AND FAST. V1 gated install on Promise.all of
// the multi-MB CDN downloads: on iOS standalone every quick launch/force-quit
// aborted the in-flight update install, so the old worker (and its stale
// shell) survived indefinitely — players were stuck on V1 no matter how many
// times they relaunched. Pixel Run's tiny install never had this problem.
//
// Same-origin shell is stale-while-revalidate. The revalidation fetches by
// URL with cache:'no-cache' — WebKit rejects fetch() of a navigation-mode
// Request, which silently killed the V1 refresh of './' on iOS.
const CACHE = 'ruin-v1';
const PINNED = [
  'https://cdn.jsdelivr.net/npm/es-module-shims@1.10.0/dist/es-module-shims.js',
  'https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js',
  'https://cdn.jsdelivr.net/npm/three@0.160.0/examples/jsm/environments/RoomEnvironment.js',
  'https://cdn.jsdelivr.net/npm/three@0.160.0/examples/jsm/geometries/RoundedBoxGeometry.js',
  'https://cdn.jsdelivr.net/npm/@dimforge/rapier3d-compat@0.19.3/rapier.mjs',
];
const SHELL = ['./', './index.html', './manifest.webmanifest',
  './icon-180.png', './icon-192.png', './icon-512.png'];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil((async () => {
    const keys = await caches.keys();
    const olds = keys.filter(k => (k.startsWith('ruin-') || k.startsWith('wreck-')) && k !== CACHE);
    // carry the immutable CDN files over from any old cache so a version bump
    // never forces a multi-MB re-download (or breaks offline play)
    const c = await caches.open(CACHE);
    for (const url of PINNED) {
      if (await c.match(url)) continue;
      for (const old of olds) {
        const hit = await (await caches.open(old)).match(url);
        if (hit) { await c.put(url, hit); break; }
      }
    }
    await Promise.all(olds.map(k => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  const url = e.request.url;
  if (PINNED.includes(url)) {   // pinned versions never change: cache-first
    e.respondWith(
      caches.match(url).then(hit => hit ||
        fetch(e.request).then(res => {
          if (res && res.ok) {
            const copy = res.clone();
            return caches.open(CACHE).then(c => c.put(url, copy)).then(() => res);
          }
          return res;
        }))
    );
    return;
  }
  if (new URL(url).origin !== self.location.origin) return;
  const cached = caches.match(e.request, { ignoreSearch: true });
  // revalidate by URL, not by Request: WebKit rejects refetching a
  // navigation-mode Request, and cache:'no-cache' skips the 10-minute
  // GitHub Pages heuristic so the next launch really is fresh
  const refresh = cached.then(hit =>
    fetch(url, { cache: 'no-cache' }).then(res => {
      if (res && res.ok) {
        const copy = res.clone();
        return caches.open(CACHE).then(c => c.put(e.request, copy)).then(() => res);
      }
      return res;
    }).catch(() => hit)
  );
  e.waitUntil(refresh);
  e.respondWith(cached.then(hit => hit || refresh));
});
