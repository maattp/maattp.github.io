/* Zombies service worker.
 *
 * Strategy: stale-while-revalidate. The shell loads instantly from cache and is
 * refreshed in the background for the next launch.
 *
 * INSTALL MUST STAY SHELL-ONLY AND FAST. The pinned three.js module is ~1.2 MB
 * and is deliberately NOT in SHELL: gating install on a multi-megabyte download
 * means every quick launch-and-force-quit on iOS aborts the in-flight install,
 * which can pin an installed player to a stale worker permanently (this is what
 * happened to /apps/wreck — see apps/ruin/CLAUDE.md). The CDN module is cached
 * lazily by the fetch handler on first play and copied forward on every CACHE
 * bump, so the game is fully offline after one online launch and never pays for
 * the download twice.
 *
 * Bump CACHE when a deploy must reach installed players promptly.
 */
const CACHE = 'zombies-v6';
const SHELL = ['./', './index.html', './manifest.webmanifest', './icon-192.png', './icon-512.png', './icon-180.png'];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE)
      .then(c => Promise.all(SHELL.map(u => c.add(u).catch(() => {}))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.open(CACHE).then(fresh =>
      caches.keys().then(keys => Promise.all(keys.map(k => {
        if (k === CACHE || !k.startsWith('zombies-')) return null;
        // carry the big pinned CDN payloads across the bump rather than
        // re-downloading them, then drop the old cache
        return caches.open(k)
          .then(old => old.keys().then(reqs => Promise.all(
            reqs.filter(r => r.url.indexOf('cdn.jsdelivr.net') >= 0)
                .map(r => old.match(r).then(res => res && fresh.put(r, res))))))
          .then(() => caches.delete(k));
      })))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;

  // Pinned CDN assets never change: cache-first, no revalidation.
  if (req.url.indexOf('cdn.jsdelivr.net') >= 0) {
    e.respondWith(
      caches.match(req).then(hit => hit || fetch(req).then(res => {
        if (res && res.ok) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(req, copy)); }
        return res;
      }))
    );
    return;
  }

  const cached = caches.match(req, { ignoreSearch: true });
  const refresh = cached.then(hit =>
    // WebKit rejects re-fetching a navigation-mode Request, which silently
    // disables revalidation for './' on iOS — refetch by URL instead.
    fetch(req.mode === 'navigate' ? new Request(req.url, { cache: 'no-cache' }) : req)
      .then(res => {
        if (res && res.ok) {
          const copy = res.clone();
          return caches.open(CACHE).then(c => c.put(req, copy)).then(() => res);
        }
        return res;
      })
      .catch(() => hit)
  );
  // keep the worker alive until the background revalidation lands, or updates
  // never stick
  e.waitUntil(refresh);
  e.respondWith(cached.then(hit => hit || refresh));
});
