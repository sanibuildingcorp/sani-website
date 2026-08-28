// netlify/functions/save-estimate.js
// Saves contractor's edits (scope, line items, prices) back to Blobs.
//
// CONTRACTOR ONLY. POST with header  x-sbc-key: <DASHBOARD_KEY>.
//
// This had no inbound gate of any kind. Anyone who knew the URL could POST a ref
// and overwrite that estimate's scope, line items and prices - on a job already
// quoted, accepted, or paid against. It is called from dashboard.html and from
// js/customer-scope-control.js and js/customer-scope-loader-v2.js, and despite
// their names those two load only in dashboard-shell.html, which is a contractor
// page. No customer flow touches this function, so gating it is safe.

const { getStore } = require("@netlify/blobs");
const { requireDashboardKey } = require("./lib/require-dashboard-key");

exports.handler = async function (event) {
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 200, headers: cors(), body: "" };
  }
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, headers: cors(), body: "Method Not Allowed" };
  }

  const denied = requireDashboardKey(event, cors());
  if (denied) return denied;

  try {
    const {
      ref,
      estimate,
      status,
      projectAnalysis,
      aiStatus,
      aiJobId,
      aiError,
      aiStartedAt,
      aiFinishedAt,
    } = JSON.parse(event.body);

    if (!ref) {
      return { statusCode: 400, headers: cors(), body: JSON.stringify({ error: "Missing ref" }) };
    }

    const store = getStore({ name: "estimates", siteID: process.env.MY_SITE_ID, token: process.env.MY_BLOBS_TOKEN });
    const existing = await store.get(ref, { type: "json" });
    if (!existing) {
      return { statusCode: 404, headers: cors(), body: JSON.stringify({ error: "Not found" }) };
    }

    if (estimate) {
      existing.estimate = { ...existing.estimate, ...estimate };
    }
    if (status) existing.status = status;
    if (projectAnalysis !== undefined) existing.projectAnalysis = projectAnalysis;
    if (aiStatus !== undefined) existing.aiStatus = aiStatus;
    if (aiJobId !== undefined) existing.aiJobId = aiJobId;
    if (aiError !== undefined) existing.aiError = aiError;
    if (aiStartedAt !== undefined) existing.aiStartedAt = aiStartedAt;
    if (aiFinishedAt !== undefined) existing.aiFinishedAt = aiFinishedAt;

    existing.updatedAt = new Date().toISOString();
    await store.setJSON(ref, existing);

    return { statusCode: 200, headers: cors(), body: JSON.stringify({ success: true }) };
  } catch (err) {
    console.error("save-estimate error:", err.message);
    return { statusCode: 500, headers: cors(), body: JSON.stringify({ error: err.message }) };
  }
};

function cors() {
  return {
    /* x-sbc-key must be advertised here or a cross-origin browser preflight
       rejects the request before the handler ever runs — the gate would look
       like a network error rather than a 401. */
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type, x-sbc-key",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Content-Type": "application/json",
    "Cache-Control": "no-store",
  };
}
