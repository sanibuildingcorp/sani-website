// SBC Dashboard Service Worker
// v5 — native dashboard Scope Control only. No legacy script injection.
const CACHE = 'sbc-v5-native-scope-control';

self.addEventListener('install', function(e) {
  // Do not pre-cache dashboard.html. The contractor dashboard must always load
  // the newest production HTML because its estimator and Scope Control change
  // frequently.
  self.skipWaiting();
});

self.addEventListener('activate', function(e) {
  e.waitUntil((async function(){
    const keys = await caches.keys();
    await Promise.all(keys.filter(function(k){ return k !== CACHE; }).map(function(k){ return caches.delete(k); }));
    await self.clients.claim();

    // Reload any already-open dashboard once so the legacy injected
    // customer-scope-loader-v2.js is removed from the live page immediately.
    const clients = await self.clients.matchAll({ type:'window', includeUncontrolled:true });
    await Promise.all(clients.map(function(client){
      try {
        const u = new URL(client.url);
        if (u.pathname === '/dashboard' || u.pathname === '/dashboard.html') {
          return client.navigate(client.url);
        }
      } catch (_) {}
      return Promise.resolve();
    }));
  })());
});

self.addEventListener('fetch', function(e) {
  const url = new URL(e.request.url);

  // API calls and writes always go straight to network.
  if (url.pathname.startsWith('/.netlify/') ||
      url.pathname.startsWith('/api/') ||
      e.request.method !== 'GET') {
    e.respondWith(fetch(e.request));
    return;
  }

  // Dashboard HTML is strictly network-first/no-store. Do not inject or cache
  // any Scope Control extension; dashboard.html owns the feature natively.
  if ((url.pathname === '/dashboard' || url.pathname === '/dashboard.html') &&
      e.request.headers.get('accept') &&
      e.request.headers.get('accept').includes('text/html')) {
    e.respondWith(fetch(e.request, { cache:'no-store' }));
    return;
  }

  // Other HTML pages stay network-first.
  if (e.request.headers.get('accept') && e.request.headers.get('accept').includes('text/html')) {
    e.respondWith(fetch(e.request).catch(function(){ return caches.match(e.request); }));
    return;
  }

  // Static assets can remain cache-first.
  e.respondWith(
    caches.match(e.request).then(function(cached) {
      if (cached) return cached;
      return fetch(e.request).then(function(res) {
        if (res.ok) {
          const clone = res.clone();
          caches.open(CACHE).then(function(c) { c.put(e.request, clone); });
        }
        return res;
      });
    })
  );
});
