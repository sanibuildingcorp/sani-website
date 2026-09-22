// netlify/functions/mark-waiting.js
//
// POST { ref, waiting: true|false }   header x-sbc-key      CONTRACTOR ONLY
//
//   "In the request when i sent questions to the customer can we add mark
//    as waiting answer or something like this mark?"
//
// Marks an estimate as waiting for the customer's answer, or clears the
// mark. The mark is a flag on the record (waitingOnCustomer, waitingSince);
// lib/thread.js reads it together with the conversation, so the mark ends
// by itself when the customer writes back. The dashboard's conversation
// button and the assistant's "waiting" action both land here. One history
// line either way.

"use strict";

const { getStore } = require("@netlify/blobs");
const { requireDashboardKey } = require("./lib/require-dashboard-key");
const history = require("./lib/history");
const thread = require("./lib/thread");

exports.handler = async function (event) {
  if (event.httpMethod === "OPTIONS") return { statusCode: 200, headers: cors(), body: "" };
  if (event.httpMethod !== "POST") return json(405, { error: "Method Not Allowed" });
  const denied = requireDashboardKey(event, cors());
  if (denied) return denied;

  let body;
  try { body = JSON.parse(event.body || "{}"); } catch (e) { return json(400, { error: "Unreadable request" }); }
  const ref = String(body.ref || "").trim().toUpperCase();
  if (!ref) return json(400, { error: "Missing ref" });
  const waiting = body.waiting !== false;

  try {
    const store = getStore({ name: "estimates", siteID: process.env.MY_SITE_ID, token: process.env.MY_BLOBS_TOKEN });
    const record = await store.get(ref, { type: "json" });
    if (!record) return json(404, { error: "Estimate " + ref + " not found" });

    const now = new Date().toISOString();
    if (waiting) {
      record.waitingOnCustomer = true;
      record.waitingSince = now;
      history.note(record, "waiting", "Marked waiting for the customer's answer" + (String(body.by || "").trim() ? " (" + String(body.by).trim().slice(0, 40) + ")" : ""));
    } else {
      record.waitingOnCustomer = false;
      record.waitingCleared = now;
      history.note(record, "waiting", "No longer waiting for the customer");
    }
    record.updatedAt = now;
    await store.setJSON(ref, record);
    return json(200, { success: true, ref: ref, waitingOnCustomer: thread.waitingOnCustomer(record), waitingSince: record.waitingSince || null });
  } catch (err) {
    console.error("mark-waiting error:", err.message);
    return json(500, { error: err.message });
  }
};

function json(code, obj) { return { statusCode: code, headers: cors(), body: JSON.stringify(obj) }; }
function cors() {
  return { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "Content-Type, x-sbc-key", "Access-Control-Allow-Methods": "POST, OPTIONS", "Content-Type": "application/json", "Cache-Control": "no-store" };
}
