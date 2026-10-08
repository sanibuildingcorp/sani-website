// netlify/functions/product-search.js - read a product-search job (see product-search-background.js).
// GET ?job=ID   (dashboard key required)
const { getStore } = require("@netlify/blobs");
const { requireDashboardKey } = require("./lib/require-dashboard-key");
exports.handler = async function (event) {
  const h = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "Content-Type, x-sbc-key", "Content-Type": "application/json", "Cache-Control": "no-store" };
  if (event.httpMethod === "OPTIONS") return { statusCode: 200, headers: h, body: "" };
  const denied = requireDashboardKey(event, h); if (denied) return denied;
  const id = String((event.queryStringParameters || {}).job || "");
  if (!/^[A-Za-z0-9_-]{6,60}$/.test(id)) return { statusCode: 400, headers: h, body: JSON.stringify({ error: "bad job" }) };
  const s = getStore({ name: "product-search", siteID: process.env.MY_SITE_ID, token: process.env.MY_BLOBS_TOKEN });
  const j = await s.get(id, { type: "json" }).catch(() => null);
  return { statusCode: 200, headers: h, body: JSON.stringify(j || { status: "running" }) };
};
