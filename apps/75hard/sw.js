// 75 Hard service worker.
// Strategy: network-first for HTML/navigations (fresh when online, cached
// shell as offline fallback), cache-first for static assets. Cross-origin
// (the worker API, Google Sign-In) is deliberately NOT intercepted — sync and
// auth must never hit a stale cache. Bump VERSION together with the app's
// APP_VER when a deploy must reach installed devices immediately.
//
// Push: iOS revokes the subscription if a push arrives without a visible
// notification, so the push handler ALWAYS calls showNotification. Payloads
// carry a `badge` count (remaining tasks today) for setAppBadge.

const VERSION = 'v1';
const CACHE = 'hard75-' + VERSION;
const SHELL = ['./', './index.html', './manifest.webmanifest', './icon-180.png', './icon-192.png', './icon-512.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE)
      .then((c) => Promise.all(SHELL.map((u) => c.add(u).catch(() => {}))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('hard75-') && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

function cachePut(event, req, res) {
  const clone = res.clone();
  event.waitUntil(caches.open(CACHE).then((c) => c.put(req, clone)).catch(() => {}));
}

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;           // API / GIS: network only
  if (!url.pathname.startsWith('/apps/75hard/')) return;

  const isHTML = req.mode === 'navigate' || url.pathname.endsWith('/') || url.pathname.endsWith('.html');
  if (isHTML) {
    e.respondWith(
      fetch(req)
        .then((res) => { if (res.ok) cachePut(e, './index.html', res); return res; })
        .catch(() => caches.match('./index.html'))
    );
  } else {
    e.respondWith(
      caches.match(req).then((hit) => hit || fetch(req).then((res) => { if (res.ok) cachePut(e, req, res); return res; }))
    );
  }
});

self.addEventListener('push', (e) => {
  let d = {};
  try { d = e.data.json(); } catch (err) { /* opaque payload */ }
  const jobs = [
    self.registration.showNotification(d.title || '75 Hard', {
      body: d.body || '',
      tag: d.tag || 'hard75',
      renotify: d.type === 'poke',
      data: { url: './', type: d.type || '' },
    }),
  ];
  if (typeof d.badge === 'number' && 'setAppBadge' in navigator) {
    jobs.push(navigator.setAppBadge(d.badge).catch(() => {}));
  }
  e.waitUntil(Promise.all(jobs));
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  e.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      for (const client of list) {
        if (client.url.includes('/apps/75hard/') && 'focus' in client) return client.focus();
      }
      return self.clients.openWindow('./');
    })
  );
});

// Belt-and-braces: iOS rarely fires this, so the app also re-subscribes and
// re-registers server-side on every launch.
self.addEventListener('pushsubscriptionchange', (e) => {
  e.waitUntil(
    self.registration.pushManager
      .subscribe(e.oldSubscription ? e.oldSubscription.options : { userVisibleOnly: true })
      .catch(() => {})
  );
});
