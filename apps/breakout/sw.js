// Breakout service worker: one self-contained file, so caching the shell makes
// it fully playable offline. Stale-while-revalidate; bump CACHE when a deploy
// must invalidate old copies immediately.
const CACHE = 'breakout-v1';
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
        keys.filter(k => k.startsWith('breakout-') && k !== CACHE).map(k => caches.delete(k))
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
  e.waitUntil(refresh);
  e.respondWith(cached.then(hit => hit || refresh));
});
