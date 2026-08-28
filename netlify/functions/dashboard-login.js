// ─────────────────────────────────────────────────────────────────────────────
//  dashboard-login
//  Verifies the dashboard password SERVER-SIDE so it never ships inside page
//  JavaScript. Before this existed the password was a const in dashboard.html,
//  bid-analyzer.html, page-editor.html, seo-content.html, keyword-volumes.html
//  and image-studio.html — readable by anyone who viewed source on the live
//  site, and by anyone reading this public repo.
//
//  Env vars used: DASHBOARD_PASSWORD  (required — the dashboard password)
//                 VISITS_KEY          (optional — handed back after a correct
//                                      password so the Live Visitors tab can
//                                      call get-visits; it is NOT public)
//                 DASHBOARD_KEY       (optional — handed back the same way, so
//                                      every contractor page can authenticate
//                                      to the gated write endpoints)
//
//  WHY DASHBOARD_KEY IS RETURNED HERE.
//  It was only ever obtainable by typing it into a box on dashboard.html ("Enter
//  the send key above (one time)") and it lived in localStorage from then on.
//  That worked for the one page that asked, and left every other contractor page
//  - image-studio, page-editor, seo-content - with no way to authenticate at
//  all, which is precisely why their endpoints were left ungated. Handing the
//  key back after a correct password puts every one of those pages on the same
//  footing as the reply box, so the endpoints CAN be gated without breaking a
//  tool the contractor uses. The hand-typed box still works and still wins; this
//  is a fallback, not a replacement.
//
//  This does put the key in the page's session after login. That is the same
//  exposure VISITS_KEY already has and the same one the typed key already had -
//  and it is bounded by the password, which is the actual gate. The alternative
//  on offer was leaving the endpoints open to the whole internet.
//
//  Fast by design: no AI, no network. Stays well inside the 10s synchronous
//  function limit (Law 1 in CLAUDE.md).
// ─────────────────────────────────────────────────────────────────────────────

const crypto = require('crypto');

const HEADERS = {
  'Content-Type': 'application/json',
  'Cache-Control': 'no-store'
};

function reply(statusCode, obj) {
  return { statusCode, headers: HEADERS, body: JSON.stringify(obj) };
}

// Constant-time compare so response timing can't be used to guess the password.
function safeEqual(a, b) {
  const ab = Buffer.from(String(a), 'utf8');
  const bb = Buffer.from(String(b), 'utf8');
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return reply(405, { ok: false, error: 'Method not allowed' });
  }

  const expected = process.env.DASHBOARD_PASSWORD;
  if (!expected) {
    // Explicit and diagnosable — a silent failure here looks like a wrong password.
    return reply(500, {
      ok: false,
      error: 'DASHBOARD_PASSWORD is not set. Netlify → Site settings → Environment variables, then redeploy.'
    });
  }

  let password = '';
  try {
    password = (JSON.parse(event.body || '{}') || {}).password || '';
  } catch (e) {
    password = '';
  }

  if (!password || !safeEqual(password, expected)) {
    return reply(401, { ok: false, error: 'Incorrect password' });
  }

  return reply(200, {
    ok: true,
    visitsKey: process.env.VISITS_KEY || '',
    dashboardKey: process.env.DASHBOARD_KEY || '',
  });
};
