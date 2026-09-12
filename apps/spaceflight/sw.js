// Space Flight service worker: shell-only, fast install (iOS standalone aborts
// slow installs on quick relaunches); the pinned Three.js r128 CDN build is
// cached lazily and copied forward across CACHE bumps. Same-origin shell is
// stale-while-revalidate, revalidated by URL with cache:'no-cache' (WebKit
// rejects refetching a navigation Request). Bump CACHE alongside SF_VER.
const CACHE = 'spaceflight-v29';
const PINNED = ['https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js'];
const SHELL = ['./', './index.html', './manifest.webmanifest', './icon-180.png', './icon-192.png', './icon-512.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    const keys = await caches.keys();
    const olds = keys.filter((k) => k.startsWith('spaceflight-') && k !== CACHE);
    const c = await caches.open(CACHE);
    for (const url of PINNED) {
      if (await c.match(url)) continue;
      for (const old of olds) { const hit = await (await caches.open(old)).match(url); if (hit) { await c.put(url, hit); break; } }
    }
    await Promise.all(olds.map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});
self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  const url = e.request.url;
  if (PINNED.includes(url)) {
    e.respondWith(caches.match(url).then((hit) => hit || fetch(e.request).then((res) => {
      if (res && res.ok) { const copy = res.clone(); return caches.open(CACHE).then((c) => c.put(url, copy)).then(() => res); }
      return res;
    })));
    return;
  }
  if (new URL(url).origin !== self.location.origin) return;
  const cached = caches.match(e.request, { ignoreSearch: true });
  const refresh = cached.then((hit) => fetch(url, { cache: 'no-cache' }).then((res) => {
    if (res && res.ok) { const copy = res.clone(); return caches.open(CACHE).then((c) => c.put(e.request, copy)).then(() => res); }
    return res;
  }).catch(() => hit));
  e.waitUntil(refresh);
  e.respondWith(cached.then((hit) => hit || refresh));
});
