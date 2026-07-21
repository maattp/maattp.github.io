// Spider-Man 3D service worker: shell-only stale-while-revalidate — instant
// load from cache, silently refreshed from the network for the next launch.
// Three.js comes from the CDN and is cached on first fetch below (runtime
// cache), so the game works offline after one online play.
// Bump CACHE when a deploy must invalidate old copies immediately.
const CACHE = 'spiderman3d-v8';
const SHELL = ['./', './index.html', './icon.png', './apple-touch-icon.png', './icon-192.png', './manifest.webmanifest'];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys.filter(k => k.startsWith('spiderman3d-') && k !== CACHE).map(k => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
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
