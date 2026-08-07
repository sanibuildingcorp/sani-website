// netlify/functions/save-estimate.js
// Saves contractor's edits (scope, line items, prices) back to Blobs.

const { getStore } = require("@netlify/blobs");

exports.handler = async function (event) {
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 200, headers: cors(), body: "" };
  }
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, headers: cors(), body: "Method Not Allowed" };
  }

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
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Content-Type": "application/json",
  };
}
