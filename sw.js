// On It With Genie — Service Worker

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', event => event.waitUntil(self.clients.claim()));

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
