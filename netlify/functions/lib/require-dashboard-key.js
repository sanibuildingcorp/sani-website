// netlify/functions/lib/require-dashboard-key.js
//
// ONE GATE, ONE DEFINITION, FOR EVERY CONTRACTOR-ONLY ENDPOINT.
//
// Four functions were reachable by anyone who knew the URL:
//
//   list-estimates         every customer's name, address, phone, email, price
//   save-estimate          rewrite any estimate, on any job, at any time
//   seo-publish            holds GITHUB_TOKEN - commits to the repo
//   publish-image-to-page  holds GITHUB_TOKEN - commits to the repo
//
// No key, no password, no referer check. `contact-leads.js` is in the same state
// and is NOT the pattern to copy; `send-reply.js` and `thread-reply.js` are, and
// this is their check lifted into one place so a fifth endpoint cannot invent a
// fifth slightly-different version of it.
//
// TWO RULES THAT MUST NOT BE RELAXED:
//
//   1. NO KEY SET => REFUSE. If DASHBOARD_KEY is missing from the environment
//      the answer is 500, never "allow". A gate that opens when its secret is
//      absent is not a gate, and this is exactly the shape that leaves a site
//      wide open after an env var is renamed or a redeploy drops it.
//
//   2. THIS IS FOR CONTRACTOR ENDPOINTS ONLY. get-estimate must stay public:
//      every quote link ever sent to a customer calls it, and gating it breaks
//      all of them at once. quote-response must stay reachable too, because the
//      customer is the one who presses Accept. Where a customer flow and a
//      contractor flow share an endpoint, gate the FIELDS, not the endpoint.

"use strict";

/**
 * @param {object} event  the Netlify function event
 * @returns {null|{statusCode:number, headers:object, body:string}}
 *          null when the caller is authorised; a ready-to-return response when
 *          it is not. Callers must `return` it unchanged if it is not null.
 */
function requireDashboardKey(event, corsHeaders) {
  const headers = Object.assign(
    {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "Content-Type, x-sbc-key",
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
    },
    corsHeaders || {}
  );

  const secret = process.env.DASHBOARD_KEY;
  if (!secret) {
    return {
      statusCode: 500,
      headers: headers,
      body: JSON.stringify({
        error: "DASHBOARD_KEY is not set in Netlify. Set it under Site settings → Environment variables, then redeploy.",
      }),
    };
  }

  /* Netlify lowercases inbound header names, but a direct invocation or a test
     harness may not, so both spellings are read. */
  const h = event && event.headers ? event.headers : {};
  const given = h["x-sbc-key"] || h["X-Sbc-Key"] || h["X-SBC-Key"] || "";

  if (!given || !timingSafeEqual(given, secret)) {
    return {
      statusCode: 401,
      headers: headers,
      body: JSON.stringify({ error: "Bad or missing dashboard key" }),
    };
  }

  return null;
}

/* Constant-time compare, so response timing cannot be used to guess the key one
   character at a time. Falls back to a plain compare only if crypto is somehow
   unavailable - the comparison still has to happen. */
function timingSafeEqual(a, b) {
  try {
    const crypto = require("crypto");
    const ab = Buffer.from(String(a), "utf8");
    const bb = Buffer.from(String(b), "utf8");
    if (ab.length !== bb.length) return false;
    return crypto.timingSafeEqual(ab, bb);
  } catch (e) {
    return String(a) === String(b);
  }
}

module.exports = { requireDashboardKey };
