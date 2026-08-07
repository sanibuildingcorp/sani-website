// SBC Dashboard Service Worker
// v2 adds one isolated dashboard extension without modifying the large dashboard.html file.
const CACHE = 'sbc-v2-scope-control';
const PRECACHE = [
  '/dashboard',
  '/dashboard.html',
  '/js/customer-scope-control.js',
  'https://fonts.googleapis.com/css2?family=Bebas+Neue&family=Inter:wght@400;500;600;700&display=swap'
];

self.addEventListener('install', function(e) {
  e.waitUntil(
    caches.open(CACHE).then(function(c) {
      return c.addAll(['/dashboard.html', '/js/customer-scope-control.js']).catch(function() {});
    })
  );
  self.skipWaiting();
});

self.addEventListener('activate', function(e) {
  e.waitUntil(
    caches.keys().then(function(keys) {
      return Promise.all(
        keys.filter(function(k) { return k !== CACHE; })
            .map(function(k) { return caches.delete(k); })
      );
    })
  );
  self.clients.claim();
});

function injectDashboardExtension(response, request) {
  if (!response || !response.ok) return Promise.resolve(response);
  var url = new URL(request.url);
  if (url.pathname !== '/dashboard' && url.pathname !== '/dashboard.html') return Promise.resolve(response);
  return response.text().then(function(html) {
    if (html.indexOf('/js/customer-scope-control.js') !== -1) {
      return new Response(html, { status: response.status, statusText: response.statusText, headers: response.headers });
    }
    var tag = '<script src="/js/customer-scope-control.js?v=1"></script>';
    var output = html.indexOf('</body>') !== -1 ? html.replace('</body>', tag + '\n</body>') : html + tag;
    var headers = new Headers(response.headers);
    headers.delete('content-length');
    return new Response(output, { status: response.status, statusText: response.statusText, headers: headers });
  });
}

self.addEventListener('fetch', function(e) {
  const url = new URL(e.request.url);

  // Always network-first for API calls and Netlify functions
  if (url.pathname.startsWith('/.netlify/') ||
      url.pathname.startsWith('/api/') ||
      e.request.method !== 'GET') {
    e.respondWith(fetch(e.request));
    return;
  }

  // Network-first for HTML pages (always fresh). For dashboard only, inject
  // the isolated scope-control script into the network response.
  if (e.request.headers.get('accept') && e.request.headers.get('accept').includes('text/html')) {
    e.respondWith(
      fetch(e.request)
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

  // Cache-first for fonts, images, static assets
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
