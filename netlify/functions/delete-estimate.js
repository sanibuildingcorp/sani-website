// netlify/functions/delete-estimate.js
//
// "if i need unwanted project delete add delete function"
// Delete = move to Trash, not gone. The record leaves the "estimates" store
// (so it drops off every list, search and customer link) and is kept whole in
// "estimates-trash" for 30 days. Restore puts it back exactly as it was.
// Delete forever is a separate, explicit action. Trash older than 30 days is
// cleared whenever the Trash is opened.
//
// POST { ref, action?: "trash" (default) | "restore" | "purge" | "list" }
// Dashboard key required - before this, anyone with a ref could delete a job.

const { getStore } = require("@netlify/blobs");
const { requireDashboardKey } = require("./lib/require-dashboard-key");

const DAYS = 30;
const open = (name) => getStore({ name, siteID: process.env.MY_SITE_ID, token: process.env.MY_BLOBS_TOKEN });

exports.handler = async function (event) {
  if (event.httpMethod === "OPTIONS") return { statusCode: 200, headers: cors(), body: "" };
  if (event.httpMethod !== "POST") return { statusCode: 405, headers: cors(), body: "Method Not Allowed" };
  const denied = requireDashboardKey(event, cors()); if (denied) return denied;

  try {
    const b = JSON.parse(event.body || "{}");
    const action = String(b.action || "trash"), ref = String(b.ref || "").trim();
    const live = open("estimates"), trash = open("estimates-trash");

    if (action === "list") {
      const { blobs } = await trash.list();
      const out = [], cutoff = Date.now() - DAYS * 864e5;
      for (const x of blobs) {
        const r = await trash.get(x.key, { type: "json" }).catch(() => null);
        if (!r) continue;
        if (Date.parse(r.deletedAt || 0) < cutoff) { await trash.delete(x.key); continue; }
        out.push({ ref: r.ref || x.key, deletedAt: r.deletedAt, customer: { name: (r.customer || {}).name || "", address: (r.customer || {}).address || "" },
          title: (r.estimate && r.estimate.projectTitle) || (r.request && r.request.service) || "", total: (r.estimate && r.estimate.grandTotal) || 0, status: r.status || "" });
      }
      out.sort((a, c) => String(c.deletedAt).localeCompare(String(a.deletedAt)));
      return ok({ items: out, days: DAYS });
    }

    if (!ref) return { statusCode: 400, headers: cors(), body: JSON.stringify({ error: "Missing ref" }) };

    if (action === "restore") {
      const r = await trash.get(ref, { type: "json" });
      if (!r) return { statusCode: 404, headers: cors(), body: JSON.stringify({ error: "Not in Trash" }) };
      if (await live.get(ref, { type: "json" })) return { statusCode: 409, headers: cors(), body: JSON.stringify({ error: "A project with this number already exists" }) };
      delete r.deletedAt;
      await live.setJSON(ref, r);
      await trash.delete(ref);
      return ok({ restored: ref });
    }

    if (action === "purge") { await trash.delete(ref); return ok({ purged: ref }); }

    // trash (default): copy first, then remove - never lose it halfway.
    const r = await live.get(ref, { type: "json" });
    if (!r) return ok({ success: true, missing: true });
    r.deletedAt = new Date().toISOString();
    await trash.setJSON(ref, r);
    const back = await trash.get(ref, { type: "json" });
    if (!back) throw new Error("Could not move to Trash - nothing was deleted");
    await live.delete(ref);
    return ok({ success: true, trashed: ref, days: DAYS });
  } catch (err) {
    return { statusCode: 500, headers: cors(), body: JSON.stringify({ error: err.message }) };
  }
};

function ok(body) { return { statusCode: 200, headers: cors(), body: JSON.stringify(body) }; }
function cors() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type, x-sbc-key",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Content-Type": "application/json",
  };
}
