// Solar service worker — same contract as ruin/sw.js: shell-only install
// (fast, so iOS standalone relaunches never abort it), pinned CDN files
// cached lazily and carried forward across cache bumps, and same-origin
// shell revalidated by URL with cache:'no-cache' (WebKit rejects refetching
// a navigation-mode Request).
const CACHE = 'solar-v1';
const PINNED = [
  'https://cdn.jsdelivr.net/npm/es-module-shims@1.10.0/dist/es-module-shims.js',
  'https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js',
];
const SHELL = ['./', './index.html', './manifest.webmanifest', './icon-180.png', './icon-192.png', './icon-512.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil((async () => {
    const keys = await caches.keys();
    const olds = keys.filter(k => k.startsWith('solar-') && k !== CACHE);
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
    e.respondWith(caches.match(url).then(hit => hit || fetch(e.request).then(res => {
      if (res && res.ok) { const copy = res.clone(); return caches.open(CACHE).then(c => c.put(url, copy)).then(() => res); }
      return res;
    }).catch(() => Response.error())));
    return;
  }
  if (new URL(url).origin !== self.location.origin) return;
  const cached = caches.match(e.request, { ignoreSearch: true });
  const refresh = cached.then(hit => fetch(url, { cache: 'no-cache' }).then(res => {
    if (res && res.ok) { const copy = res.clone(); return caches.open(CACHE).then(c => c.put(e.request, copy)).then(() => res); }
    return res;
  }).catch(() => hit));
  e.waitUntil(refresh);
  e.respondWith(cached.then(hit => hit || refresh));
});
