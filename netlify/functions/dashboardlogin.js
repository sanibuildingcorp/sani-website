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

  return reply(200, { ok: true, visitsKey: process.env.VISITS_KEY || '' });
};
