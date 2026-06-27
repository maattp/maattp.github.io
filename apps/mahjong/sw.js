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
  './',                       // the start_url; GitHub Pages serves index.html (200) here
  './index.html',
  './manifest.webmanifest',
  './icon-180.png',
  './icon-192.png',
  './icon-512.png',
];

// Cache a response, keeping the SW alive until the write finishes (iOS can otherwise
// terminate it mid-write). Best-effort: never reject the request on a cache failure.
function cachePut(event, req, resClone) {
  event.waitUntil(caches.open(CACHE).then((c) => c.put(req, resClone)).catch(() => {}));
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE)
      // resilient: a single bad entry shouldn't fail the whole install
      .then((c) => Promise.all(SHELL.map((u) => c.add(u).catch(() => {}))))
      .then(() => self.skipWaiting())
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
    // network-first: fresh when online, cached index.html when offline
    event.respondWith(
      fetch(req)
        .then((res) => { if (res.ok) cachePut(event, req, res.clone()); return res; })
        .catch(() => caches.match(req).then((r) => r || caches.match('./index.html')))
    );
    return;
  }
  // static assets: cache-first, fill cache on first fetch
  event.respondWith(
    caches.match(req).then((cached) => {
      if (cached) return cached;
      return fetch(req)
        .then((res) => { if (res.ok) cachePut(event, req, res.clone()); return res; })
        .catch(() => new Response('Offline', { status: 503, statusText: 'Offline' }));
    })
  );
});
