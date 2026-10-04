// netlify/functions/follow-up-switch.js
//
// POST { ref, off: true|false }   header x-sbc-key      CONTRACTOR ONLY
//
// Turns the automatic follow-up emails off (or back on) for one estimate
// (lib/follow-up.js). One History line either way.

"use strict";

const { getStore } = require("@netlify/blobs");
const { requireDashboardKey } = require("./lib/require-dashboard-key");
const history = require("./lib/history");
const followUp = require("./lib/follow-up");

function cors() {
  return { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "Content-Type, x-sbc-key", "Access-Control-Allow-Methods": "POST, OPTIONS", "Content-Type": "application/json", "Cache-Control": "no-store" };
}
function json(code, obj) { return { statusCode: code, headers: cors(), body: JSON.stringify(obj) }; }

exports.handler = async function (event) {
  if (event.httpMethod === "OPTIONS") return { statusCode: 200, headers: cors(), body: "" };
  if (event.httpMethod !== "POST") return json(405, { error: "Method Not Allowed" });
  const denied = requireDashboardKey(event, cors());
  if (denied) return denied;
  let body;
  try { body = JSON.parse(event.body || "{}"); } catch (e) { return json(400, { error: "Unreadable request" }); }
  const ref = String(body.ref || "").trim().toUpperCase();
  if (!ref) return json(400, { error: "Missing ref" });
  const off = body.off === true;
  try {
    const store = getStore({ name: "estimates", siteID: process.env.MY_SITE_ID, token: process.env.MY_BLOBS_TOKEN });
    const record = await store.get(ref, { type: "json" });
    if (!record) return json(404, { error: "Estimate " + ref + " not found" });
    record.followUpOff = off;
    history.note(record, "followup", off ? "Automatic follow-up emails switched off" : "Automatic follow-up emails switched on");
    record.updatedAt = new Date().toISOString();
    await store.setJSON(ref, record);
    return json(200, { success: true, ref: ref, followUpOff: off, followUp: followUp.summary(record) });
  } catch (err) {
    return json(500, { error: err.message });
  }
};
