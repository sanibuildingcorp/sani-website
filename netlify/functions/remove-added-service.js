// netlify/functions/remove-added-service.js — one added service, taken out whole.
//
//   "when i trying delate one duplicate painting service card, it's effect
//    to the bathroom price too but also it's not deleting until i click in
//    save to customer sees and after page refreshing its still shows double
//    painting services"
//
// POST { ref, index } (x-sbc-key): reverses estimate.addedServices[index] -
// its lines, its cards, its rows on the published scope and the draft, its
// scope text, and the stamped total shrinks by exactly what it grew. Saved
// at once. See lib/add-service.js removeAddedService. CONTRACTOR ONLY.

"use strict";

const { getStore } = require("@netlify/blobs");
const { requireDashboardKey } = require("./lib/require-dashboard-key");
const { removeAddedService } = require("./lib/add-service");

function str(v) { return String(v == null ? "" : v).trim(); }

exports.handler = async function (event) {
  if (event.httpMethod === "OPTIONS") return { statusCode: 200, headers: cors(), body: "" };
  if (event.httpMethod !== "POST") return json(405, { error: "Method Not Allowed" });
  const denied = requireDashboardKey(event, cors());
  if (denied) return denied;
  let body = {};
  try { body = JSON.parse(event.body || "{}"); } catch (e) { return json(400, { error: "Unreadable request" }); }
  const ref = str(body.ref).toUpperCase();
  if (!ref) return json(400, { error: "Missing ref" });
  try {
    const store = getStore({ name: "estimates", siteID: process.env.MY_SITE_ID, token: process.env.MY_BLOBS_TOKEN });
    const record = await store.get(ref, { type: "json" });
    if (!record) return json(404, { error: "Estimate not found" });
    const removed = removeAddedService(record, body.index);
    record.updatedAt = new Date().toISOString();
    await store.setJSON(ref, record);
    return json(200, { success: true, removed: removed, estimate: record.estimate, customerFinalTotal: record.customerFinalTotal });
  } catch (e) {
    const msg = str(e && e.message) || "failed";
    return json(/No added service|names no section|no estimate/.test(msg) ? 400 : 500, { error: msg });
  }
};

function cors() {
  return { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "Content-Type, x-sbc-key", "Access-Control-Allow-Methods": "POST, OPTIONS", "Content-Type": "application/json", "Cache-Control": "no-store" };
}
function json(code, obj) { return { statusCode: code, headers: cors(), body: JSON.stringify(obj) }; }
