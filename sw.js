// SBC Dashboard Service Worker
// v6 — native Scope Control + isolated internal market-audit loader.
// The injected market-audit script is dashboard-only, read-only, and never touches customer pages.
const CACHE = 'sbc-v6-market-audit';
const MARKET_AUDIT_SCRIPT = '<script data-market-audit-loader="1" src="/js/dashboard-market-audit.js?v=1"></script>';

self.addEventListener('install', function(e) {
  // Do not pre-cache dashboard.html. The contractor dashboard must always load
  // the newest production HTML because its estimator and Scope Control change frequently.
  self.skipWaiting();
});

self.addEventListener('activate', function(e) {
  e.waitUntil((async function(){
    const keys = await caches.keys();
    await Promise.all(keys.filter(function(k){ return k !== CACHE; }).map(function(k){ return caches.delete(k); }));
    await self.clients.claim();

    // Reload already-open dashboard tabs once after a service-worker update so
    // the newest internal market-audit loader becomes active immediately.
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

async function dashboardResponse(request) {
  const res = await fetch(request, { cache:'no-store' });
  if (!res.ok) return res;
  const type = res.headers.get('content-type') || '';
  if (!type.includes('text/html')) return res;

  let html = await res.text();
  // Keep Scope Control native. Inject only the isolated read-only pricing-audit UI.
  if (!html.includes('data-market-audit-loader="1"') && !html.includes('/js/dashboard-market-audit.js')) {
    if (html.includes('</body>')) html = html.replace('</body>', MARKET_AUDIT_SCRIPT + '\n</body>');
    else html += MARKET_AUDIT_SCRIPT;
  }

  const headers = new Headers(res.headers);
  headers.delete('content-length');
  headers.delete('content-encoding');
  headers.set('cache-control','no-store');
  headers.set('x-sbc-dashboard-audit','v1');
  return new Response(html, { status:res.status, statusText:res.statusText, headers:headers });
}

self.addEventListener('fetch', function(e) {
  const url = new URL(e.request.url);

  // API calls and writes always go straight to network.
  if (url.pathname.startsWith('/.netlify/') ||
      url.pathname.startsWith('/api/') ||
      e.request.method !== 'GET') {
    e.respondWith(fetch(e.request));
    return;
  }

  // Dashboard HTML is network-first/no-store. Only the isolated internal
  // market-audit script is injected; Scope Control and all native dashboard logic remain untouched.
  if ((url.pathname === '/dashboard' || url.pathname === '/dashboard.html') &&
      e.request.headers.get('accept') &&
      e.request.headers.get('accept').includes('text/html')) {
    e.respondWith(dashboardResponse(e.request));
    return;
  }

  // Other HTML pages stay network-first and are NEVER injected.
  if (e.request.headers.get('accept') && e.request.headers.get('accept').includes('text/html')) {
    e.respondWith(fetch(e.request).catch(function(){ return caches.match(e.request); }));
    return;
  }

  // Static assets can remain cache-first, except the market-audit loader which
  // must update immediately while this pricing system is being calibrated.
  if (url.pathname === '/js/dashboard-market-audit.js') {
    e.respondWith(fetch(e.request, { cache:'no-store' }));
    return;
  }

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
