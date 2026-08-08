// SBC Dashboard Service Worker
// v6 — auth split. Fixes the cache-first trap that froze the home-screen app.
//
// What changed from v5:
//   1. Dashboard HTML is matched by PATHNAME ONLY. v5 also required an
//      "accept: text/html" header, but dashboard-shell.html fetches
//      /dashboard.html?core=4 with plain fetch() which sends "accept: */*".
//      That request fell through to the cache-first branch at the bottom and
//      was cached permanently, so the installed app kept serving an old
//      dashboard forever while a normal browser tab loaded the new one.
//   2. /js/dashboard-auth.js is never cached. A stale copy of the auth helper
//      locks the contractor out of the dashboard with no way to recover from
//      the phone. Auth code always comes from the network.
//   3. Cache name bumped so activate() deletes every v5 entry.
const CACHE = 'sbc-v6-auth-split';

/* Any URL whose pathname must always come from the network, regardless of
   what accept header the request carries. Query strings are ignored. */
function isAlwaysFresh(pathname) {
  return pathname === '/dashboard' ||
         pathname === '/dashboard.html' ||
         pathname === '/dashboard-shell.html' ||
         pathname === '/js/dashboard-auth.js';
}

self.addEventListener('install', function(e) {
  // Nothing is pre-cached. The contractor dashboard must always load the
  // newest production HTML because the estimator and Scope Control change
  // frequently.
  self.skipWaiting();
});

self.addEventListener('activate', function(e) {
  e.waitUntil((async function(){
    const keys = await caches.keys();
    await Promise.all(keys.filter(function(k){ return k !== CACHE; }).map(function(k){ return caches.delete(k); }));
    await self.clients.claim();

    // Reload any already-open dashboard once so a stale cached copy is
    // replaced immediately instead of on the next cold start.
    const clients = await self.clients.matchAll({ type:'window', includeUncontrolled:true });
    await Promise.all(clients.map(function(client){
      try {
        const u = new URL(client.url);
        if (isAlwaysFresh(u.pathname)) {
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

  // Dashboard shell, dashboard HTML and the auth helper are strictly
  // network-only. Checked by pathname before any accept-header logic so the
  // shell's own fetch() of /dashboard.html?core=4 cannot slip past.
  if (isAlwaysFresh(url.pathname)) {
    e.respondWith(fetch(e.request, { cache:'no-store' }));
    return;
  }

  // Other HTML pages stay network-first with a cached fallback offline.
  if (e.request.headers.get('accept') && e.request.headers.get('accept').includes('text/html')) {
    e.respondWith(fetch(e.request).catch(function(){ return caches.match(e.request); }));
    return;
  }

  // Remaining static assets can stay cache-first.
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
