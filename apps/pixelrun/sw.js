// Pixel Run service worker: the game is one self-contained file, so caching the
// shell makes it fully playable offline. Strategy is stale-while-revalidate —
// instant load from cache, silently refreshed from the network for next launch.
// Bump CACHE when a deploy must invalidate old copies immediately.
const CACHE = 'pixelrun-v6';
const SHELL = ['./', './index.html', './icon.png', './apple-touch-icon.png'];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys.filter(k => k.startsWith('pixelrun-') && k !== CACHE).map(k => caches.delete(k))
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
  // keep the worker alive until the background revalidation lands — without this
  // the browser may kill the SW right after responding, so updates never stick
  e.waitUntil(refresh);
  e.respondWith(cached.then(hit => hit || refresh));
});
