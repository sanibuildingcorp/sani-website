// netlify/functions/visits.js — site-visit appointments (Netlify Blobs)
//
// CONTRACTOR ONLY. Every call carries  x-sbc-key: <DASHBOARD_KEY>.
//
// A visit is a customer's name, their home address and the hour he will be
// standing at their door. That is exactly the data list-estimates was gated
// for, and this endpoint used to hand it out - and take deletes - from a bare
// GET or POST with no key at all. Same gate, same rules: no key set => 500.
const { getStore } = require("@netlify/blobs");
const { requireDashboardKey } = require("./lib/require-dashboard-key");

function store() {
  return getStore({ name: "visits", siteID: process.env.MY_SITE_ID, token: process.env.MY_BLOBS_TOKEN });
}
function cors() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type, x-sbc-key",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Content-Type": "application/json",
    "Cache-Control": "no-store",
  };
}

exports.handler = async function (event) {
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 200, headers: cors(), body: "" };
  }

  const denied = requireDashboardKey(event, cors());
  if (denied) return denied;

  try {
    const s = store();

    if (event.httpMethod === "GET") {
      const listing = await s.list();
      const visits = [];
      for (const b of (listing.blobs || [])) {
        try {
          const v = await s.get(b.key, { type: "json" });
          if (v) visits.push(v);
        } catch (e) { /* skip bad record */ }
      }
      visits.sort(function (a, b) { return (a.datetime || "").localeCompare(b.datetime || ""); });
      return { statusCode: 200, headers: cors(), body: JSON.stringify({ visits }) };
    }

    if (event.httpMethod === "POST") {
      const body = JSON.parse(event.body || "{}");
      const action = body.action;

      if (action === "create") {
        const v = body.visit || {};
        if (!v.customer || !v.datetime) {
          return { statusCode: 400, headers: cors(), body: JSON.stringify({ error: "customer and datetime required" }) };
        }
        const id = "V-" + Date.now().toString(36).toUpperCase() + Math.random().toString(36).slice(2, 5).toUpperCase();
        const visit = {
          id,
          customer: String(v.customer).slice(0, 120),
          address: String(v.address || "").slice(0, 200),
          reason: String(v.reason || "").slice(0, 300),
          ref: String(v.ref || "").slice(0, 40),
          datetime: String(v.datetime).slice(0, 25),   // ISO local "2026-07-11T14:00"
          notes: String(v.notes || "").slice(0, 500),
          done: false,
          createdAt: new Date().toISOString(),
        };
        await s.set(id, JSON.stringify(visit));
        return { statusCode: 200, headers: cors(), body: JSON.stringify({ ok: true, visit }) };
      }

      if (action === "update") {
        const cur = await s.get(body.id, { type: "json" });
        if (!cur) return { statusCode: 404, headers: cors(), body: JSON.stringify({ error: "not found" }) };
        const patch = body.patch || {};
        ["customer", "address", "reason", "datetime", "notes", "done"].forEach(function (k) {
          if (patch[k] !== undefined) cur[k] = patch[k];
        });
        await s.set(body.id, JSON.stringify(cur));
        return { statusCode: 200, headers: cors(), body: JSON.stringify({ ok: true, visit: cur }) };
      }

      if (action === "delete") {
        await s.delete(body.id);
        return { statusCode: 200, headers: cors(), body: JSON.stringify({ ok: true }) };
      }

      return { statusCode: 400, headers: cors(), body: JSON.stringify({ error: "unknown action" }) };
    }

    return { statusCode: 405, headers: cors(), body: JSON.stringify({ error: "Method Not Allowed" }) };
  } catch (e) {
    return { statusCode: 500, headers: cors(), body: JSON.stringify({ error: e.message }) };
  }
};
