// Fable Kart service worker: solo play fully offline. The shell is one file
// plus icons — but the game ALSO needs Three.js r128 from cdnjs, so that URL
// is precached too (versioned upstream, safe to treat as immutable).
// Strategy: stale-while-revalidate for same-origin shell, cache-first for the
// pinned CDN script. Everything else (worker API, websockets, cross-origin)
// is deliberately NOT intercepted — multiplayer must never hit a stale cache.
// Bump CACHE when a deploy must invalidate old copies immediately.
const CACHE = 'fablekart-v1';
const THREE_CDN = 'https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js';
const SHELL = ['./', './index.html', './manifest.webmanifest',
  './icon-180.png', './icon-192.png', './icon-512.png'];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE)
      .then(c => Promise.all([c.addAll(SHELL), c.add(THREE_CDN)]))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys.filter(k => k.startsWith('fablekart-') && k !== CACHE).map(k => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  const url = new URL(e.request.url);
  // the pinned Three.js build never changes: cache-first, fetch only on miss
  if (e.request.url === THREE_CDN) {
    e.respondWith(
      caches.match(THREE_CDN).then(hit => hit ||
        fetch(e.request).then(res => {
          if (res && res.ok) {
            const copy = res.clone();
            return caches.open(CACHE).then(c => c.put(THREE_CDN, copy)).then(() => res);
          }
          return res;
        }))
    );
    return;
  }
  // only same-origin shell requests are served/cached; the multiplayer
  // worker API and anything else cross-origin goes straight to the network
  if (url.origin !== self.location.origin) return;
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
  // keep the worker alive until the background revalidation lands
  e.waitUntil(refresh);
  e.respondWith(cached.then(hit => hit || refresh));
});
