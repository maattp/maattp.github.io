// Wreck & Ruin service worker: full offline play. The game needs three pinned
// CDN files (Three.js module, Rapier physics with inlined WASM, es-module-shims)
// — all versioned upstream, safe to treat as immutable: cache-first.
// Same-origin shell is stale-while-revalidate. Bump CACHE to force-invalidate.
const CACHE = 'wreck-v2';
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
    caches.open(CACHE)
      .then(c => Promise.all([c.addAll(SHELL), ...PINNED.map(u => c.add(u))]))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys.filter(k => k.startsWith('wreck-') && k !== CACHE).map(k => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
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
  const refresh = cached.then(hit =>
    fetch(e.request).then(res => {
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
