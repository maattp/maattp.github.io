// Auto service worker: full offline play. Everything is same-origin — the app
// shell, ~15 ES modules under src/, and the vendored Three.js build.
//
// INSTALL MUST STAY SHELL-ONLY AND FAST. Gating install on the 1.2 MB Three.js
// build would mean that on iOS standalone every quick launch/force-quit aborts
// the in-flight update install, leaving the OLD worker (and its stale shell)
// alive indefinitely. The engine and the src modules are cached lazily by the
// fetch handler instead, which is enough: the very first online launch imports
// all of them.
//
// PINNED holds files whose URL encodes their version, so they can never go
// stale: cache-first, and carried forward across CACHE bumps so a version bump
// never re-downloads them or breaks offline play.
//
// The rest of the same-origin shell is stale-while-revalidate. Revalidation
// fetches by URL with cache:'no-cache' — WebKit rejects fetch() of a
// navigation-mode Request, which would silently kill the refresh of './' on
// iOS, and no-cache skips GitHub Pages' 10-minute heuristic.
const CACHE = 'auto-v16';
const PINNED = ['vendor/three-0.160.0.module.js'];
const SHELL = ['./', './index.html', './manifest.webmanifest',
  './icon-180.png', './icon-192.png', './icon-512.png'];

const pinnedUrls = PINNED.map(p => new URL(p, self.location).href);

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil((async () => {
    const keys = await caches.keys();
    const olds = keys.filter(k => k.startsWith('auto-') && k !== CACHE);
    const c = await caches.open(CACHE);
    for (const url of pinnedUrls) {
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
  if (new URL(url).origin !== self.location.origin) return;

  if (pinnedUrls.includes(url.split('?')[0])) { // version is in the path: cache-first
    e.respondWith(
      caches.match(url, { ignoreSearch: true }).then(hit => hit ||
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
