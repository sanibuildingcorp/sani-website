// netlify/functions/visits.js — site-visit appointments (Netlify Blobs)
const { getStore } = require("@netlify/blobs");

function store() {
  return getStore({ name: "visits", siteID: process.env.MY_SITE_ID, token: process.env.MY_BLOBS_TOKEN });
}
const JSON_HEADERS = { "Content-Type": "application/json" };

exports.handler = async function (event) {
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
      return { statusCode: 200, headers: JSON_HEADERS, body: JSON.stringify({ visits }) };
    }

    if (event.httpMethod === "POST") {
      const body = JSON.parse(event.body || "{}");
      const action = body.action;

      if (action === "create") {
        const v = body.visit || {};
        if (!v.customer || !v.datetime) {
          return { statusCode: 400, headers: JSON_HEADERS, body: JSON.stringify({ error: "customer and datetime required" }) };
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
        return { statusCode: 200, headers: JSON_HEADERS, body: JSON.stringify({ ok: true, visit }) };
      }

      if (action === "update") {
        const cur = await s.get(body.id, { type: "json" });
        if (!cur) return { statusCode: 404, headers: JSON_HEADERS, body: JSON.stringify({ error: "not found" }) };
        const patch = body.patch || {};
        ["customer", "address", "reason", "datetime", "notes", "done"].forEach(function (k) {
          if (patch[k] !== undefined) cur[k] = patch[k];
        });
        await s.set(body.id, JSON.stringify(cur));
        return { statusCode: 200, headers: JSON_HEADERS, body: JSON.stringify({ ok: true, visit: cur }) };
      }

      if (action === "delete") {
        await s.delete(body.id);
        return { statusCode: 200, headers: JSON_HEADERS, body: JSON.stringify({ ok: true }) };
      }

      return { statusCode: 400, headers: JSON_HEADERS, body: JSON.stringify({ error: "unknown action" }) };
    }

    return { statusCode: 405, body: "Method Not Allowed" };
  } catch (e) {
    return { statusCode: 500, headers: JSON_HEADERS, body: JSON.stringify({ error: e.message }) };
  }
};
