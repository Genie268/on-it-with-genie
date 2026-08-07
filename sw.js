// On It With Genie — Service Worker
// CACHE_VERSION — bump on every deploy that must reach browsers immediately.
const CACHE_VERSION = 'oiwg-design5';

self.addEventListener('install', () => self.skipWaiting());

self.addEventListener('activate', event => event.waitUntil((async () => {
  // Drop every old cache so no stale admin JS/CSS can survive an update.
  const keys = await caches.keys();
  await Promise.all(keys.filter(k => k !== CACHE_VERSION).map(k => caches.delete(k)));
  await self.clients.claim();
})()));

// Network-first for all same-origin GETs so a new deploy always wins; the cache
// is only an offline fallback. This guarantees the admin route and the design
// editor assets are never served stale.
self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;
  let url;
  try { url = new URL(req.url); } catch (e) { return; }
  if (url.origin !== self.location.origin) return; // let cross-origin (Supabase/CDN) pass through untouched
  event.respondWith((async () => {
    try {
      const res = await fetch(req);
      try { const c = await caches.open(CACHE_VERSION); c.put(req, res.clone()); } catch (e) {}
      return res;
    } catch (e) {
      const cached = await caches.match(req);
      if (cached) return cached;
      throw e;
    }
  })());
});

self.addEventListener('push', event => {
  let data = { title: 'On It With Genie', body: '', tag: 'oiwg-msg', url: '/' };
  try { if (event.data) data = { ...data, ...event.data.json() }; } catch (e) {}

  const iconUrl = self.location.origin + '/icon-192.png';
  const badgeUrl = self.location.origin + '/badge-72.png';

  event.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body,
      icon: iconUrl,
      badge: badgeUrl,
      tag: data.tag,
      renotify: true,
      vibrate: [200, 100, 200],
      data: { url: data.url || '/' }
    })
  );
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  const url = event.notification.data?.url || '/';
  const fullUrl = self.location.origin + (url.startsWith('/') ? url : '/' + url);
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
      /* Find an existing tab on our domain */
      const existing = list.find(c => c.url.startsWith(self.location.origin) && 'focus' in c);
      if (existing) {
        /* Navigate the existing tab to the target URL so the app
           opens the right screen (e.g. dashboard for user notifications,
           admin for admin notifications) */
        return existing.focus().then(c => c.navigate(fullUrl));
      }
      return clients.openWindow(fullUrl);
    })
  );
});

self.addEventListener('pushsubscriptionchange', event => {
  event.waitUntil(
    self.registration.pushManager.subscribe(event.oldSubscription.options).then(sub => {
      const k = sub.toJSON().keys || {};
      return fetch('/api/push-resubscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ endpoint: sub.endpoint, p256dh: k.p256dh, auth: k.auth, old_endpoint: event.oldSubscription.endpoint })
      });
    }).catch(() => {})
  );
});
