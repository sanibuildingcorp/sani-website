// ============================================================
//  track-visit.js  →  put in:  netlify/functions/track-visit.js
//  Receives a ping from every page load + heartbeat, looks up the
//  visitor's approximate location, and records it in Supabase.
//  Uses your existing env vars: SUPABASE_URL, SUPABASE_SECRET_KEY
// ============================================================

const SUPABASE_URL = process.env.SUPABASE_URL;
const KEY = process.env.SUPABASE_SECRET_KEY;

// Supabase needs BOTH headers or writes silently fail
const H = {
  apikey: KEY,
  Authorization: 'Bearer ' + KEY,
  'Content-Type': 'application/json'
};

// Approximate location from IP (free, no key). Best-effort — never blocks.
async function geoLookup(ip) {
  if (!ip) return {};
  try {
    const r = await fetch('https://ipapi.co/' + encodeURIComponent(ip) + '/json/');
    if (!r.ok) return {};
    const d = await r.json();
    return {
      country: d.country_name || null,
      region: d.region || null,
      city: d.city || null,
      lat: typeof d.latitude === 'number' ? d.latitude : null,
      lng: typeof d.longitude === 'number' ? d.longitude : null
    };
  } catch (e) {
    return {};
  }
}

// Work out where the visit came from, using UTM tags first, then the referrer.
function classifySource(referrer, utmSource, utmMedium) {
  if (utmSource) {
    var s = utmSource.toLowerCase();
    var m = (utmMedium || '').toLowerCase();
    if (s.indexOf('facebook') >= 0 || s === 'fb') return 'Facebook';
    if (s.indexOf('instagram') >= 0 || s === 'ig') return 'Instagram';
    if (s === 'gbp' || s.indexOf('google-business') >= 0 || s.indexOf('googlebusiness') >= 0 || m === 'gbp') return 'Google Business';
    if (s.indexOf('google') >= 0) return /cpc|ppc|paid/.test(m) ? 'Google Ads' : 'Google';
    if (s.indexOf('bing') >= 0) return 'Bing';
    if (s.indexOf('yelp') >= 0) return 'Yelp';
    if (s.indexOf('email') >= 0 || (utmMedium && /email/i.test(utmMedium))) return 'Email';
    if (s.indexOf('tiktok') >= 0) return 'TikTok';
    if (s.indexOf('nextdoor') >= 0) return 'Nextdoor';
    return utmSource.charAt(0).toUpperCase() + utmSource.slice(1);
  }
  if (!referrer) return 'Direct';
  var host = '';
  try { host = new URL(referrer).hostname.replace(/^www\./, '').toLowerCase(); } catch (e) { return 'Other'; }
  if (!host) return 'Direct';
  if (host.indexOf('sanibuildingcorp.com') >= 0) return 'Internal';
  var map = [
    ['maps.google', 'Google Maps'], ['google.', 'Google'], ['bing.', 'Bing'], ['yahoo.', 'Yahoo'],
    ['duckduckgo.', 'DuckDuckGo'], ['ecosia.', 'Ecosia'],
    ['facebook.', 'Facebook'], ['fb.', 'Facebook'], ['instagram.', 'Instagram'],
    ['t.co', 'X / Twitter'], ['twitter.', 'X / Twitter'], ['x.com', 'X / Twitter'],
    ['linkedin.', 'LinkedIn'], ['lnkd.in', 'LinkedIn'], ['youtube.', 'YouTube'],
    ['yelp.', 'Yelp'], ['nextdoor.', 'Nextdoor'], ['reddit.', 'Reddit'],
    ['pinterest.', 'Pinterest'], ['tiktok.', 'TikTok'],
    ['gmail.', 'Email'], ['mail.google', 'Email'], ['outlook.', 'Email']
  ];
  for (var i = 0; i < map.length; i++) { if (host.indexOf(map[i][0]) >= 0) return map[i][1]; }
  return 'Other';
}

exports.handler = async (event) => {
  const cors = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type'
  };
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: cors, body: '' };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers: cors, body: 'Method not allowed' };
  if (!SUPABASE_URL || !KEY) return { statusCode: 500, headers: cors, body: 'Not configured' };

  let b = {};
  try { b = JSON.parse(event.body || '{}'); } catch (e) { return { statusCode: 400, headers: cors, body: 'Bad JSON' }; }

  const sid = (b.sid || '').toString().slice(0, 80);
  if (!sid) return { statusCode: 400, headers: cors, body: 'No sid' };

  const type = b.type === 'heartbeat' ? 'heartbeat' : 'pageview';
  const nowIso = new Date().toISOString();
  const path = (b.path || '/').toString().slice(0, 300);
  const title = (b.title || '').toString().slice(0, 300);
  const device = ['mobile', 'tablet', 'desktop'].indexOf(b.device) >= 0 ? b.device : 'desktop';

  const hdrs = event.headers || {};
  const ip = (hdrs['x-nf-client-connection-ip'] || (hdrs['x-forwarded-for'] || '').split(',')[0] || '').trim();

  try {
    if (type === 'heartbeat') {
      // Just keep the session "alive" + note the page they're on now
      await fetch(SUPABASE_URL + '/rest/v1/visit_sessions?on_conflict=session_id', {
        method: 'POST',
        headers: Object.assign({}, H, { Prefer: 'resolution=merge-duplicates,return=minimal' }),
        body: JSON.stringify([{ session_id: sid, last_seen: nowIso, current_path: path, current_title: title }])
      });
      return { statusCode: 204, headers: cors, body: '' };
    }

    // PAGEVIEW — look up location only on the first hit of a session
    let geo = {};
    if (b.first === true) geo = await geoLookup(ip);

    const sessionRow = {
      session_id: sid,
      last_seen: nowIso,
      current_path: path,
      current_title: title,
      device: device,
      referrer: (b.referrer || '').toString().slice(0, 300)
    };
    if (b.first === true) {
      sessionRow.entry_path = path;
      sessionRow.country = geo.country || null;
      sessionRow.region = geo.region || null;
      sessionRow.city = geo.city || null;
      sessionRow.lat = (geo.lat === undefined ? null : geo.lat);
      sessionRow.lng = (geo.lng === undefined ? null : geo.lng);
      sessionRow.utm_source = (b.utmSource || '').toString().slice(0, 120) || null;
      sessionRow.utm_medium = (b.utmMedium || '').toString().slice(0, 120) || null;
      sessionRow.utm_campaign = (b.utmCampaign || '').toString().slice(0, 120) || null;
      sessionRow.source = classifySource(sessionRow.referrer, b.utmSource, b.utmMedium);
    }

    await fetch(SUPABASE_URL + '/rest/v1/visit_sessions?on_conflict=session_id', {
      method: 'POST',
      headers: Object.assign({}, H, { Prefer: 'resolution=merge-duplicates,return=minimal' }),
      body: JSON.stringify([sessionRow])
    });
    await fetch(SUPABASE_URL + '/rest/v1/visit_pageviews', {
      method: 'POST',
      headers: Object.assign({}, H, { Prefer: 'return=minimal' }),
      body: JSON.stringify([{ session_id: sid, path: path, title: title }])
    });

    return { statusCode: 204, headers: cors, body: '' };
  } catch (e) {
    // Fail open — tracking must never slow down or break the visitor's page
    return { statusCode: 200, headers: cors, body: 'ok' };
  }
};
