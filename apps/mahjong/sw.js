/* Sichuan Mahjong — offline service worker.
 *
 * The app is one self-contained index.html, so caching the app shell lets LOCAL
 * (hot-seat + bots) play run with no network at all — e.g. launched from the Home
 * Screen on a plane. Online multiplayer still needs the Cloudflare worker; those
 * cross-origin requests are passed straight through and just fail gracefully when
 * offline (the client already shows "Disconnected").
 *
 * Strategy:
 *   - HTML/navigations: network-first (you always get the latest build when online,
 *     matching the site's "always fresh" convention) with the cached copy as the
 *     offline fallback.
 *   - static assets (icons, manifest): cache-first, populated on first fetch.
 *
 * Bump VERSION on release to refresh the precached shell and drop old caches. */
const VERSION = 'v1';
const CACHE = 'mahjong-' + VERSION;
const SHELL = [
  './',
  './index.html',
  './manifest.webmanifest',
  './icon-180.png',
  './icon-192.png',
  './icon-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys.filter((k) => k.startsWith('mahjong-') && k !== CACHE).map((k) => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;                          // never touch POST/etc.
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;           // let online-play requests hit the network
  if (!url.pathname.startsWith('/apps/mahjong/')) return;    // only this app's scope

  const isHTML = req.mode === 'navigate' || (req.headers.get('accept') || '').includes('text/html');
  if (isHTML) {
    event.respondWith(
      fetch(req)
        .then((res) => { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); return res; })
        .catch(() => caches.match(req).then((r) => r || caches.match('./index.html')))
    );
    return;
  }
  event.respondWith(
    caches.match(req).then((cached) =>
      cached || fetch(req).then((res) => {
        const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); return res;
      }).catch(() => cached)
    )
  );
});
