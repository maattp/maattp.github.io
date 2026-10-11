/* PWA probe service worker. CACHE moves in lockstep with VERSION in index.html.

   Its real job is cross-origin isolation: GitHub Pages can't send headers, so
   every same-origin response passes through here and gets COOP/COEP added.
   Requests for ?coi=0 are left alone, for a with/without comparison.

   Network-first (a probe should always run the newest build when online),
   cache only as the offline copy. */
const CACHE = 'pwa-v1';
const SHELL = ['./', './manifest.webmanifest', './worker.js', '../icon.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE)
    .then((c) => c.addAll(SHELL.map((u) => new Request(u, { cache: 'reload' }))))
    .then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) =>
    Promise.all(keys.filter((k) => k.startsWith('pwa-v') && k !== CACHE).map((k) => caches.delete(k)))
  ).then(() => self.clients.claim()));
});

function isolate(res) {
  if (!res || res.type === 'opaque' || res.status === 0) return res;
  const h = new Headers(res.headers);
  h.set('Cross-Origin-Opener-Policy', 'same-origin');
  h.set('Cross-Origin-Embedder-Policy', 'require-corp');
  h.set('Cross-Origin-Resource-Policy', 'same-origin');
  h.set('X-Isolation-Source', 'service-worker');
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers: h });
}

self.addEventListener('fetch', (e) => {
  const req = e.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== location.origin) return;
  const nav = req.mode === 'navigate';
  const add = url.searchParams.get('coi') !== '0';
  const key = url.origin + url.pathname;
  // WebKit rejects fetch() of a navigation-mode Request: revalidate by URL.
  const net = nav ? fetch(req.url, { cache: 'no-cache' }) : fetch(req, { cache: 'no-cache' });
  e.respondWith(
    net.then((res) => {
      if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(key, copy)); }
      return res;
    }, () => caches.match(key))
      .then((res) => (add ? isolate(res) : res))
  );
});
