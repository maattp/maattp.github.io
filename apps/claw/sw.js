// Claw service worker: full offline play. Three pinned CDN files (Three.js
// module + addons, Rapier with inlined WASM, es-module-shims) — all immutable
// upstream, so cache-first, cached LAZILY by the fetch handler and copied
// forward across CACHE bumps.
//
// INSTALL MUST STAY SHELL-ONLY AND FAST. Gating install on the multi-MB CDN
// downloads pins iOS standalone players to the old worker forever: every quick
// launch/force-quit aborts the in-flight install (see apps/ruin/sw.js, which
// learned this the expensive way).
//
// Same-origin shell is stale-while-revalidate, revalidated by URL with
// cache:'no-cache' — WebKit rejects fetch() of a navigation-mode Request.
const CACHE = 'claw-v1';
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
    const olds = keys.filter(k => k.startsWith('claw-') && k !== CACHE);
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
  if (PINNED.includes(url)) {
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
