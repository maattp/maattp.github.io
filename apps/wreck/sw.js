// KILL SWITCH. The original /apps/wreck/ service worker (V1) gated its
// update-install on multi-MB CDN downloads; iOS standalone apps aborted it on
// every quick relaunch, permanently pinning installed players to the stale V1
// shell — no fix served at this path could ever reach them. The game moved to
// /apps/ruin/. If any stuck client ever DOES manage to swap workers, this one
// deletes every wreck-* cache, unregisters itself, and reloads its windows so
// they land on the redirect page below.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => {
  e.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => k.startsWith('wreck-')).map(k => caches.delete(k)));
    await self.registration.unregister();
    const cs = await self.clients.matchAll({ type: 'window' });
    for (const c of cs) c.navigate(c.url).catch(() => {});
  })());
});
// no fetch handler: every request goes straight to the network
