// ============================================================
//  get-visits.js  →  put in:  netlify/functions/get-visits.js
//  Returns live visitors (last 5 min) + last-24h stats to the
//  dashboard. Protected by a key so the data isn't public.
//  Env vars used: SUPABASE_URL, SUPABASE_SECRET_KEY, VISITS_KEY
// ============================================================

const SUPABASE_URL = process.env.SUPABASE_URL;
const KEY = process.env.SUPABASE_SECRET_KEY;
const VISITS_KEY = process.env.VISITS_KEY; // password the dashboard must send

const H = { apikey: KEY, Authorization: 'Bearer ' + KEY };

async function q(pathAndQuery) {
  const r = await fetch(SUPABASE_URL + '/rest/v1/' + pathAndQuery, { headers: H });
  if (!r.ok) return [];
  return await r.json();
}

exports.handler = async (event) => {
  const key = (event.queryStringParameters || {}).key || '';
  if (!VISITS_KEY || key !== VISITS_KEY) {
    return { statusCode: 401, body: JSON.stringify({ error: 'unauthorized' }) };
  }
  if (!SUPABASE_URL || !KEY) {
    return { statusCode: 500, body: JSON.stringify({ error: 'not configured' }) };
  }

  const now = Date.now();
  const fiveMinAgo = new Date(now - 5 * 60 * 1000).toISOString();
  const dayAgo = new Date(now - 24 * 60 * 60 * 1000).toISOString();

  try {
    const results = await Promise.all([
      q('visit_sessions?last_seen=gte.' + fiveMinAgo + '&order=last_seen.desc&limit=100'),
      q('visit_sessions?first_seen=gte.' + dayAgo + '&select=device,source&limit=2000'),
      q('visit_pageviews?created_at=gte.' + dayAgo + '&select=path&limit=5000')
    ]);
    const live = results[0], sessions24 = results[1], pv24 = results[2];

    function deviceSplit(rows) {
      const s = { mobile: 0, desktop: 0, tablet: 0 };
      rows.forEach(function (r) { if (s[r.device] !== undefined) s[r.device]++; else s.desktop++; });
      return s;
    }

    const counts = {};
    pv24.forEach(function (r) { const p = r.path || '/'; counts[p] = (counts[p] || 0) + 1; });
    const topPages = Object.keys(counts)
      .map(function (p) { return { path: p, count: counts[p] }; })
      .sort(function (a, b) { return b.count - a.count; })
      .slice(0, 12);

    const srcCounts = {};
    sessions24.forEach(function (r) { const k = r.source || 'Direct'; srcCounts[k] = (srcCounts[k] || 0) + 1; });
    const sources = Object.keys(srcCounts)
      .map(function (k) { return { source: k, count: srcCounts[k] }; })
      .sort(function (a, b) { return b.count - a.count; });

    const out = {
      liveCount: live.length,
      live: live.map(function (s) {
        return {
          path: s.current_path, title: s.current_title, device: s.device,
          city: s.city, region: s.region, country: s.country,
          source: s.source, referrer: s.referrer,
          firstSeen: s.first_seen, lastSeen: s.last_seen, entry: s.entry_path
        };
      }),
      liveDevices: deviceSplit(live),
      sessions24: sessions24.length,
      pageviews24: pv24.length,
      devices24: deviceSplit(sessions24),
      sources: sources,
      topPages: topPages,
      generatedAt: new Date().toISOString()
    };
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
      body: JSON.stringify(out)
    };
  } catch (e) {
    return { statusCode: 500, body: JSON.stringify({ error: 'query failed' }) };
  }
};
