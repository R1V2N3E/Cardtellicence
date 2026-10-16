// Service worker: makes the app installable and keeps the last data available offline.
// - HTML, API and scanner data: network first, cached copy when offline.
// - Built assets: cache first. Card images are left to the browser's HTTP cache: caching
//   cross-origin (opaque) responses here could pin failed loads and exhaust Safari's quota.
const VERSION = 'v14';
const SHELL = `shell-${VERSION}`;

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(SHELL).then((c) => c.addAll(['/', '/manifest.webmanifest'])));
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => !k.endsWith(VERSION)).map((k) => caches.delete(k)))),
  );
  self.clients.claim();
});

async function networkFirst(req, cacheName) {
  const cache = await caches.open(cacheName);
  try {
    const res = await fetch(req);
    if (res.ok) cache.put(req, res.clone());
    return res;
  } catch {
    return (await cache.match(req)) || (req.mode === 'navigate' ? cache.match('/') : Response.error());
  }
}

async function cacheFirst(req, cacheName) {
  const cache = await caches.open(cacheName);
  const hit = await cache.match(req);
  if (hit) return hit;
  const res = await fetch(req);
  if (res.ok) cache.put(req, res.clone());
  return res;
}

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;
  if (url.pathname.startsWith('/assets/') || url.pathname.startsWith('/icons/')) {
    return e.respondWith(cacheFirst(req, SHELL));
  }
  if (req.mode === 'navigate') return e.respondWith(networkFirst(new Request('/'), SHELL));
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/data/')) {
    return e.respondWith(networkFirst(req, SHELL));
  }
});

// Push notifications (deals, watchlist restocks and price drops).
self.addEventListener('push', (e) => {
  let msg = { title: 'Cardtelligence', body: '', url: '/' };
  try {
    msg = { ...msg, ...e.data.json() };
  } catch {
    if (e.data) msg.body = e.data.text();
  }
  e.waitUntil(self.registration.showNotification(msg.title, { body: msg.body, icon: '/icons/icon-192.png', badge: '/icons/icon-192.png', data: { url: msg.url } }));
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const url = new URL(e.notification.data?.url || '/', location.origin).href;
  e.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      const open = list.find((c) => c.url.startsWith(location.origin));
      if (open) return open.navigate(url).then((c) => (c || open).focus());
      return self.clients.openWindow(url);
    }),
  );
});
