// netlify/functions/generator-lab.js
//
// GET                          -> the test-mode settings and lessons
// POST { action: "mode", on }  -> test mode on or off
// POST { action: "add", text } -> a new lesson (switched on)
// POST { action: "toggle", id, on } / { action: "edit", id, text } / { action: "delete", id }
//
// header x-sbc-key. CONTRACTOR ONLY. See lib/generator-lab.js.

"use strict";

const { getStore } = require("@netlify/blobs");
const { requireDashboardKey } = require("./lib/require-dashboard-key");
const lab = require("./lib/generator-lab");

exports.handler = async function (event) {
  if (event.httpMethod === "OPTIONS") return { statusCode: 200, headers: cors(), body: "" };
  const denied = requireDashboardKey(event, cors());
  if (denied) return denied;
  try {
    const store = getStore({ name: "estimates", siteID: process.env.MY_SITE_ID, token: process.env.MY_BLOBS_TOKEN });
    if (event.httpMethod === "GET") return json(200, Object.assign({ ok: true }, await lab.load(store)));
    if (event.httpMethod !== "POST") return json(405, { error: "Method Not Allowed" });
    let body;
    try { body = JSON.parse(event.body || "{}"); } catch (e) { return json(400, { error: "Unreadable request" }); }
    let next;
    try { next = lab.change(await lab.load(store), body); } catch (e) { return json(400, { error: String(e.message) }); }
    return json(200, Object.assign({ ok: true }, await lab.save(store, next)));
  } catch (err) {
    console.error("generator-lab error:", err.message);
    return json(500, { error: err.message });
  }
};

function json(code, obj) { return { statusCode: code, headers: cors(), body: JSON.stringify(obj) }; }
function cors() {
  return { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "Content-Type, x-sbc-key", "Access-Control-Allow-Methods": "GET, POST, OPTIONS", "Content-Type": "application/json", "Cache-Control": "no-store" };
}
