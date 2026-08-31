/* Chat service worker. CACHE moves in lockstep with VERSION in index.html —
 * the repo-wide convention that makes a stale worker diagnosable. */
const CACHE = 'chat-v3';
const SHELL = ['./', './index.html', './manifest.webmanifest'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) =>
    Promise.all(keys.filter((k) => k.startsWith('chat-') && k !== CACHE).map((k) => caches.delete(k)))
  ).then(() => self.clients.claim()));
});

// Shell is cache-first so launch works offline. API calls are cross-origin
// (workers.dev) and pass straight through — message data lives in IndexedDB,
// not the HTTP cache (PLAN: Offline and PWA).
self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET' || new URL(e.request.url).origin !== location.origin) return;
  e.respondWith(
    caches.match(e.request).then((hit) => hit || fetch(e.request).then((res) => {
      if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(e.request, copy)); }
      return res;
    }))
  );
});

self.addEventListener('push', (e) => {
  let d = {};
  try { d = e.data.json(); } catch { d = { title: 'Chat', body: e.data ? e.data.text() : '' }; }
  e.waitUntil(self.registration.showNotification(d.title || 'Chat', {
    body: d.body || '',
    icon: '../icon.png',
    tag: 'chat-' + (d.thread || 'x'),   // coalesce per thread, don't stack
    data: { thread: d.thread },
  }));
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const url = new URL('./', location).href;
  e.waitUntil(clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
    for (const c of list) if (c.url.startsWith(url)) return c.focus();
    return clients.openWindow(url);
  }));
});
