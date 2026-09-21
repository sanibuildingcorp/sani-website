// netlify/functions/reword-estimate.js
//
// POST { ref, edits: [{ where, service, from, to }] }   header x-sbc-key
//
//   "Can you upgrade them in estimate without touching prices?"
//
// The assistant's "reword" action lands here: changes to the WORDS of an
// estimate - a line in a service card, the name of a price line, the
// summary, the scope, the title, the timeline - applied by lib/reword.js,
// which fingerprints every price, quantity and total before and after and
// refuses the whole request if any of them moved. CONTRACTOR ONLY.
//
// The customer's page keeps showing the SENT version until he sends an
// update; this edits the draft he is working on.

"use strict";

const { getStore } = require("@netlify/blobs");
const { requireDashboardKey } = require("./lib/require-dashboard-key");
const history = require("./lib/history");
const { applyEdits } = require("./lib/reword");

exports.handler = async function (event) {
  if (event.httpMethod === "OPTIONS") return { statusCode: 200, headers: cors(), body: "" };
  if (event.httpMethod !== "POST") return json(405, { error: "Method Not Allowed" });
  const denied = requireDashboardKey(event, cors());
  if (denied) return denied;

  let body;
  try { body = JSON.parse(event.body || "{}"); } catch (e) { return json(400, { error: "Unreadable request" }); }
  const ref = String(body.ref || "").trim();
  const edits = Array.isArray(body.edits) ? body.edits : [];
  if (!ref) return json(400, { error: "Missing ref" });
  if (!edits.length) return json(400, { error: "No edits" });

  try {
    const store = getStore({ name: "estimates", siteID: process.env.MY_SITE_ID, token: process.env.MY_BLOBS_TOKEN });
    const record = await store.get(ref, { type: "json" });
    if (!record) return json(404, { error: "Estimate " + ref + " not found" });

    let result;
    try { result = applyEdits(record, edits); }
    catch (e) { return json(422, { error: String(e && e.message) }); }
    if (!result.applied.length) return json(200, { success: false, applied: [], skipped: result.skipped, error: "Nothing matched: " + result.skipped.map(function (s) { return s.reason + " (" + (s.from || s.to) + ")"; }).join("; ") });

    history.note(record, "reworded", "Reworded (" + result.applied.length + " edit" + (result.applied.length === 1 ? "" : "s") + "): " + result.applied.map(function (e) { return String(e.where || "") + (e.service ? " on " + e.service : "") + (e.to ? ": \"" + String(e.to).slice(0, 60) + "\"" : " removed"); }).join("; ").slice(0, 300));
    record.updatedAt = new Date().toISOString();
    record.rewordedAt = record.updatedAt;
    await store.setJSON(ref, record);
    return json(200, { success: true, applied: result.applied, skipped: result.skipped, estimate: record.estimate, contract: record.contract || null });
  } catch (err) {
    console.error("reword-estimate error:", err.message);
    return json(500, { error: err.message });
  }
};

function json(code, obj) { return { statusCode: code, headers: cors(), body: JSON.stringify(obj) }; }
function cors() {
  return { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "Content-Type, x-sbc-key", "Access-Control-Allow-Methods": "POST, OPTIONS", "Content-Type": "application/json", "Cache-Control": "no-store" };
}
