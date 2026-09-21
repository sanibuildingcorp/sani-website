// netlify/functions/dedupe-scope.js
//
// POST { ref, apply }   header x-sbc-key      CONTRACTOR ONLY
//
//   "check if there is duplicate services, or texts and remove all
//    duplicated"
//
// The assistant's "dedupe" action lands here. apply:false is a dry run: it
// answers with the repeated lines that WOULD go, one entry per distinct
// line with the number of places it repeats in, and the pairs that say the
// same work in different words. apply:true removes them from the scope
// text and from every card copy (lib/scope-dedupe.js), leaves a history
// line, saves, and returns the estimate for the page. Prices never move:
// the money fingerprint is checked inside the library.

"use strict";

const { getStore } = require("@netlify/blobs");
const { requireDashboardKey } = require("./lib/require-dashboard-key");
const history = require("./lib/history");
const { dedupeScope } = require("./lib/scope-dedupe");

exports.handler = async function (event) {
  if (event.httpMethod === "OPTIONS") return { statusCode: 200, headers: cors(), body: "" };
  if (event.httpMethod !== "POST") return json(405, { error: "Method Not Allowed" });
  const denied = requireDashboardKey(event, cors());
  if (denied) return denied;

  let body;
  try { body = JSON.parse(event.body || "{}"); } catch (e) { return json(400, { error: "Unreadable request" }); }
  const ref = String(body.ref || "").trim();
  if (!ref) return json(400, { error: "Missing ref" });
  const apply = body.apply === true;

  try {
    const store = getStore({ name: "estimates", siteID: process.env.MY_SITE_ID, token: process.env.MY_BLOBS_TOKEN });
    const record = await store.get(ref, { type: "json" });
    if (!record) return json(404, { error: "Estimate " + ref + " not found" });

    const target = apply ? record : JSON.parse(JSON.stringify(record));
    let result;
    try { result = dedupeScope(target); }
    catch (e) { return json(422, { error: String(e && e.message) }); }

    const out = { success: true, applied: false, changed: result.changed, count: result.count, lines: result.lines, similar: result.similar };
    if (!apply || !result.changed) return json(200, out);

    history.note(record, "removed", "Repeated lines removed (" + result.count + "): " + result.lines.slice(0, 4).map(function (l) { return "\"" + String(l.text).slice(0, 50) + "\""; }).join(", ") + (result.lines.length > 4 ? ", ..." : ""));
    record.updatedAt = new Date().toISOString();
    record.rewordedAt = record.updatedAt;
    await store.setJSON(ref, record);
    out.applied = true;
    out.estimate = record.estimate;
    return json(200, out);
  } catch (err) {
    console.error("dedupe-scope error:", err.message);
    return json(500, { error: err.message });
  }
};

function json(code, obj) { return { statusCode: code, headers: cors(), body: JSON.stringify(obj) }; }
function cors() {
  return { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "Content-Type, x-sbc-key", "Access-Control-Allow-Methods": "POST, OPTIONS", "Content-Type": "application/json", "Cache-Control": "no-store" };
}
