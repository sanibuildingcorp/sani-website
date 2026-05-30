/* ============================================================
   SANI VISIT TRACKER
   Paste this whole block at the very BOTTOM of partials/site.js
   (it runs on every page because site.js loads everywhere).
   ============================================================ */
(function () {
  var ENDPOINT = '/.netlify/functions/track-visit';

  // Stable per-visit id (resets when the browser tab session ends)
  var sid, firstHit = false;
  try { sid = sessionStorage.getItem('sbc_sid'); } catch (e) {}
  if (!sid) {
    sid = 's_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
    firstHit = true;
    try { sessionStorage.setItem('sbc_sid', sid); } catch (e) {}
  }

  function qp(n) { try { return new URLSearchParams(location.search).get(n) || ''; } catch (e) { return ''; } }
  var utm = { source: qp('utm_source'), medium: qp('utm_medium'), campaign: qp('utm_campaign') };

  function deviceType() {
    var ua = navigator.userAgent || '';
    if (/iPad|Tablet|PlayBook|Silk/i.test(ua)) return 'tablet';
    if (/Mobi|Android|iPhone|iPod|Opera Mini|IEMobile/i.test(ua)) return 'mobile';
    if (window.matchMedia && window.matchMedia('(max-width:768px)').matches) return 'mobile';
    return 'desktop';
  }

  function send(type) {
    var body = {
      sid: sid, type: type,
      path: location.pathname,
      title: document.title,
      referrer: document.referrer || '',
      utmSource: utm.source, utmMedium: utm.medium, utmCampaign: utm.campaign,
      device: deviceType(),
      first: firstHit
    };
    firstHit = false;
    try {
      var data = JSON.stringify(body);
      if (navigator.sendBeacon) {
        navigator.sendBeacon(ENDPOINT, new Blob([data], { type: 'application/json' }));
      } else {
        fetch(ENDPOINT, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: data, keepalive: true });
      }
    } catch (e) {}
  }

  send('pageview'); // record this page load
  // Keep the session marked "live" every 20s while the tab is visible
  setInterval(function () { if (document.visibilityState === 'visible') send('heartbeat'); }, 20000);
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'visible') send('heartbeat');
  });
})();
