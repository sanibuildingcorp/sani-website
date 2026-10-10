// netlify/functions/handyman-hide.js
//
// DELETE A HANDYMAN ORDER (reversible). Contractor only (x-sbc-key).
// The booking row stays in the database (its signed agreement, crew job
// and history stay safe); the dashboard just stops showing it.
// GET                         -> { deleted: { ref: isoDate } }
// POST { ref, deleted:true }  -> moves it to Deleted
// POST { ref, deleted:false } -> restores it

"use strict";

const { requireDashboardKey } = require("./lib/require-dashboard-key");
const H = { "Content-Type": "application/json", "Cache-Control": "no-store", "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "Content-Type, x-sbc-key" };
const out = (code, body) => ({ statusCode: code, headers: H, body: JSON.stringify(body) });
function store() {
  const { getStore } = require("@netlify/blobs");
  return getStore({ name: "handyman-hidden", siteID: process.env.MY_SITE_ID, token: process.env.MY_BLOBS_TOKEN });
}
function apply(map, ref, on, now) {
  const m = Object.assign({}, map || {});
  if (on) m[ref] = now; else delete m[ref];
  return m;
}

exports.handler = async function (event) {
  if (event.httpMethod === "OPTIONS") return { statusCode: 200, headers: H, body: "" };
  const denied = requireDashboardKey(event);
  if (denied) return denied;
  try {
    const st = store();
    const map = (await st.get("refs", { type: "json" }).catch(() => null)) || {};
    if (event.httpMethod === "GET") return out(200, { deleted: map });
    if (event.httpMethod !== "POST") return out(405, { error: "GET or POST" });
    const b = JSON.parse(event.body || "{}");
    const ref = String(b.ref || "");
    if (!/^SBC-H-[A-Z0-9-]+$/i.test(ref)) return out(400, { error: "bad ref" });
    const next = apply(map, ref, !!b.deleted, new Date().toISOString());
    await st.setJSON("refs", next);
    return out(200, { ok: true, deleted: next });
  } catch (e) {
    return out(500, { error: String(e && e.message || e) });
  }
};
exports._test = { apply };
