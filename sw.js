// SBC Dashboard Service Worker
// v4 — robust scope-control loader with automatic refresh on activation.
const CACHE = 'sbc-v4-scope-control';
const DASHBOARD_EXT = '/js/customer-scope-loader-v2.js?v=2';

self.addEventListener('install', function(e) {
  e.waitUntil(
    caches.open(CACHE).then(function(c) {
      return c.addAll(['/dashboard.html', '/js/customer-scope-loader-v2.js']).catch(function() {});
    })
  );
  self.skipWaiting();
});

self.addEventListener('activate', function(e) {
  e.waitUntil((async function(){
    const keys = await caches.keys();
    await Promise.all(keys.filter(function(k){ return k !== CACHE; }).map(function(k){ return caches.delete(k); }));
    await self.clients.claim();
    // Existing open dashboard tabs may still be running the previous HTML response.
    // Refresh them once so this worker controls the navigation and injects v2.
    const clients = await self.clients.matchAll({ type:'window', includeUncontrolled:true });
    await Promise.all(clients.map(function(client){
      try {
        const u = new URL(client.url);
        if (u.pathname === '/dashboard' || u.pathname === '/dashboard.html') return client.navigate(client.url);
      } catch (_) {}
      return Promise.resolve();
    }));
  })());
});

function injectDashboardExtension(response, request) {
  if (!response || !response.ok) return Promise.resolve(response);
  var url = new URL(request.url);
  if (url.pathname !== '/dashboard' && url.pathname !== '/dashboard.html') return Promise.resolve(response);

  return response.text().then(function(html) {
    // Strip any previous injected scope-control script tags so only v2 runs.
    html = html.replace(/<script[^>]+customer-scope-control\.js[^>]*><\/script>\s*/gi, '');
    html = html.replace(/<script[^>]+customer-scope-loader-v2\.js[^>]*><\/script>\s*/gi, '');

    var tag = '<script src="' + DASHBOARD_EXT + '"></script>';
    var output = html.indexOf('</body>') !== -1
      ? html.replace('</body>', tag + '\n</body>')
      : html + tag;

    var headers = new Headers(response.headers);
    headers.delete('content-length');
    headers.set('cache-control','no-store, max-age=0');
    return new Response(output, {
      status: response.status,
      statusText: response.statusText,
      headers: headers
    });
  });
}

self.addEventListener('fetch', function(e) {
  const url = new URL(e.request.url);

  // Always network-first for API calls and Netlify functions.
  if (url.pathname.startsWith('/.netlify/') ||
      url.pathname.startsWith('/api/') ||
      e.request.method !== 'GET') {
    e.respondWith(fetch(e.request));
    return;
  }

  // Dashboard HTML: always network-first, then inject the isolated extension.
  if ((url.pathname === '/dashboard' || url.pathname === '/dashboard.html') &&
      e.request.headers.get('accept') && e.request.headers.get('accept').includes('text/html')) {
    e.respondWith(
      fetch(e.request, { cache:'no-store' })
        .then(function(res) {
          var cacheCopy = res.clone();
          caches.open(CACHE).then(function(c) { c.put(e.request, cacheCopy); });
          return injectDashboardExtension(res, e.request);
        })
        .catch(function() {
          return caches.match(e.request).then(function(cached) {
            return injectDashboardExtension(cached, e.request);
          });
        })
    );
    return;
  }

  // Other HTML pages stay network-first.
  if (e.request.headers.get('accept') && e.request.headers.get('accept').includes('text/html')) {
    e.respondWith(fetch(e.request).catch(function(){ return caches.match(e.request); }));
    return;
  }

  // Cache-first for static assets.
  e.respondWith(
    caches.match(e.request).then(function(cached) {
      if (cached) return cached;
      return fetch(e.request).then(function(res) {
        if (res.ok) {
          var clone = res.clone();
          caches.open(CACHE).then(function(c) { c.put(e.request, clone); });
        }
        return res;
      });
    })
  );
});
