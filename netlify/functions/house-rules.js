// netlify/functions/house-rules.js
//
// The contractor's own pricing rules — price bands, unit prices, production rates,
// minimum charges — kept in ONE place and applied to every estimate.
//
// Why this exists:
//   The estimator has always accepted a `houseRules` string, but there was nowhere to
//   type one, so it was always empty and the AI priced from general market knowledge.
//   That is what put 185 labor hours on a small bathroom: it knew $75/hr, it did not
//   know how long the work takes THIS contractor.
//
// Why a function rather than localStorage:
//   Zura works from a phone and a laptop. Rules written on one must be there on the
//   other, and must survive clearing browser data. One blob, one key, both devices.
//
// GET  -> { rules: "<text>", updatedAt: "<iso>" }
// POST { rules: "<text>" } -> saves and returns the same shape
//
// Auth: writes require the dashboard secret. Reads do not — the rules are the
// contractor's own pricing notes, never customer data, and the estimator function
// needs to read them server-side without carrying a browser session. If the wider
// function-auth work lands later, this should adopt the shared guard like any other.

const { getStore } = require("@netlify/blobs");

const KEY = "house-rules";
const MAX_LEN = 20000;   // generous; a full cost book in prose is well under this

exports.handler = async function (event) {
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 200, headers: cors(), body: "" };
  }

  try {
    const store = getStore({
      name: "estimates",
      siteID: process.env.MY_SITE_ID,
      token: process.env.MY_BLOBS_TOKEN,
    });

    if (event.httpMethod === "GET") {
      const data = await store.get(KEY, { type: "json" });
      return ok({ rules: (data && data.rules) || "", updatedAt: (data && data.updatedAt) || "" });
    }

    if (event.httpMethod === "POST") {
      let body = {};
      try { body = JSON.parse(event.body || "{}"); } catch (_) { body = {}; }

      /* Writes are gated by VISITS_KEY — the value dashboard-login hands back only
         after a correct password. The page itself no longer knows the password (that
         was the point of moving it server-side), so this session token is the right
         credential to present. A wrong or missing one must not silently discard the
         rules the contractor just typed — say so, and let the dashboard keep the text. */
      const expected = process.env.VISITS_KEY || process.env.DASHBOARD_PASSWORD || "";
      if (expected && String(body.key || "") !== expected) {
        return json(401, { error: "Not authorised — log in again, then save." });
      }

      const rules = String(body.rules == null ? "" : body.rules).slice(0, MAX_LEN);
      const record = { rules: rules, updatedAt: new Date().toISOString() };
      await store.setJSON(KEY, record);
      return ok(record);
    }

    return json(405, { error: "Method not allowed" });
  } catch (error) {
    console.error("house-rules error:", error && error.stack ? error.stack : error);
    return json(500, { error: (error && error.message) || "House rules request failed" });
  }
};

function cors() {
  return {
    "Content-Type": "application/json",
    "Cache-Control": "no-store",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
  };
}
function json(statusCode, obj) {
  return { statusCode, headers: cors(), body: JSON.stringify(obj) };
}
function ok(obj) { return json(200, obj); }
