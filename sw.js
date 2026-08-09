// SBC Dashboard Service Worker
// v7 — the service worker gets OUT OF THE WAY of API calls.
//
// What changed from v6, and why it matters:
//
//   v6 did this for every /.netlify/ call and every non-GET request:
//       e.respondWith(fetch(e.request));
//   That is a no-op in intent — it re-issues the same request unchanged — but it is
//   NOT a no-op in effect. Calling respondWith makes the service worker responsible
//   for the response, which keeps the request tied to the worker's lifetime.
//
//   iOS terminates an idle service worker aggressively. The estimator runs for
//   two to three minutes (OpenAI analysis, then Claude pricing, then an optional
//   repair pass), and the dashboard polls get-estimate throughout. When the worker
//   was killed mid-request the fetch aborted, and the only thing the page saw was
//       FetchEvent.respondWith received an error: TypeError: Load failed
//   which says nothing about the real cause. That is what killed "Regenerate with
//   AI" around 160 seconds and what broke Send to Customer.
//
//   The fix is to return WITHOUT calling respondWith. The browser then performs the
//   request natively, completely outside the worker, with no lifetime attached to it.
//   Nothing is lost: these requests were never cached and never modified.
//
// Everything from v6 is kept: dashboard HTML and the auth helper are matched by
// pathname only and never cached, because dashboard-shell.html fetches
// /dashboard.html?core=4 with `accept: */*` and v5 let that slip into the
// cache-first branch, freezing the installed app on an old dashboard.
const CACHE = 'sbc-v7-passthrough-api';

/* Always from the network, never from the cache. Query strings are ignored. */
function isAlwaysFresh(pathname) {
  return pathname === '/dashboard' ||
         pathname === '/dashboard.html' ||
         pathname === '/dashboard-shell.html' ||
         pathname === '/js/dashboard-auth.js';
}

self.addEventListener('install', function(e) {
  // Nothing is pre-cached. The contractor dashboard must always load the newest
  // production HTML because the estimator and Scope Control change frequently.
  self.skipWaiting();
});

self.addEventListener('activate', function(e) {
  e.waitUntil((async function(){
    const keys = await caches.keys();
    await Promise.all(keys.filter(function(k){ return k !== CACHE; }).map(function(k){ return caches.delete(k); }));
    await self.clients.claim();

    // Reload any already-open dashboard once, so a stale cached copy is replaced
    // immediately rather than on the next cold start.
    const clients = await self.clients.matchAll({ type:'window', includeUncontrolled:true });
    await Promise.all(clients.map(function(client){
      try {
        const u = new URL(client.url);
        if (isAlwaysFresh(u.pathname)) return client.navigate(client.url);
      } catch (_) {}
      return Promise.resolve();
    }));
  })());
});

self.addEventListener('fetch', function(e) {
  var url;
  try { url = new URL(e.request.url); }
  catch (_) { return; }                       // unparseable: leave it to the browser

  /* API calls and every write go straight to the browser. NOT respondWith(fetch(...)) —
     see the note at the top of this file. Long-running estimator calls must not be
     tied to this worker's lifetime. */
  if (url.pathname.startsWith('/.netlify/') ||
      url.pathname.startsWith('/api/') ||
      e.request.method !== 'GET') {
    return;
  }

  /* Cross-origin requests are none of our business either. */
  if (url.origin !== self.location.origin) return;

  /* Dashboard shell, dashboard HTML and the auth helper: network only. If the network
     fails, hand the failure back rather than a cached copy — a stale auth helper locks
     the contractor out with no way to recover from a phone. */
  if (isAlwaysFresh(url.pathname)) {
    e.respondWith(
      fetch(e.request, { cache:'no-store' }).catch(function (err) {
        return new Response('Offline — could not load ' + url.pathname,
          { status: 503, headers: { 'Content-Type': 'text/plain' } });
      })
    );
    return;
  }

  /* Other HTML pages: network first, cached copy as an offline fallback. */
  var accept = e.request.headers.get('accept') || '';
  if (accept.indexOf('text/html') !== -1) {
    e.respondWith(
      fetch(e.request).catch(function () {
        return caches.match(e.request).then(function (hit) {
          return hit || new Response('Offline', { status: 503, headers: { 'Content-Type': 'text/plain' } });
        });
      })
    );
    return;
  }

  /* Remaining static assets: cache first, then network. */
  e.respondWith(
    caches.match(e.request).then(function (cached) {
      if (cached) return cached;
      return fetch(e.request).then(function (res) {
        if (res && res.ok) {
          var clone = res.clone();
          caches.open(CACHE).then(function (c) { c.put(e.request, clone); }).catch(function () {});
        }
        return res;
      }).catch(function () {
        return new Response('', { status: 504, statusText: 'Offline' });
      });
    })
  );
});
