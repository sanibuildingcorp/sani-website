// netlify/functions/get-estimate.js
// Returns one full estimate (including photos & all answers) by ref.
//
// Customer-scope safety:
// - Dashboard/admin requests receive the untouched stored record.
// - quote.html receives a customer-view clone when a manual scope is published.
// - ?previewScope=1 on quote.html can preview the private scope draft without publishing it.
//
// IMPORTANT: customer-view transformation is WORDING ONLY. Deterministic pricing,
// serviceBreakdown subtotals, labor/material source lines, markup and totals must stay
// exactly as stored. quote.html is responsible for applying published wording.

const { getStore } = require("@netlify/blobs");

exports.handler = async function (event) {
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 200, headers: cors(), body: "" };
  }

  try {
    const ref = event.queryStringParameters?.ref;
    if (!ref) {
      return { statusCode: 400, headers: cors(), body: JSON.stringify({ error: "Missing ref" }) };
    }

    const store = getStore({ name: "estimates", siteID: process.env.MY_SITE_ID, token: process.env.MY_BLOBS_TOKEN });
    const data = await store.get(ref, { type: "json" });

    if (!data) {
      return { statusCode: 404, headers: cors(), body: JSON.stringify({ error: "Not found" }) };
    }

    const referer = String(event.headers?.referer || event.headers?.referrer || "");
    const isQuoteRequest = /\/quote(?:\.html)?(?:[?#]|$)/i.test(referer);
    const isDraftPreview = isQuoteRequest && /[?&]previewScope=1(?:&|$)/i.test(referer);

    if (isQuoteRequest) {
      return { statusCode: 200, headers: cors(), body: JSON.stringify(buildCustomerView(data, isDraftPreview)) };
    }

    // Dashboard and internal tools receive the exact stored estimate.
    return { statusCode: 200, headers: cors(), body: JSON.stringify(data) };
  } catch (err) {
    console.error("get-estimate error:", err.message);
    return { statusCode: 500, headers: cors(), body: JSON.stringify({ error: err.message }) };
  }
};

function buildCustomerView(source, previewDraft) {
  // Clone so customer rendering can never mutate the stored source record.
  const data = JSON.parse(JSON.stringify(source));
  const estimate = data.estimate || {};

  const scope = previewDraft
    ? estimate.manualCustomerScopeDraft
    : (estimate.customerScopePublished === true ? estimate.publishedCustomerScope : null);

  if (!scope || !Array.isArray(scope.services)) return data;

  // Preserve deterministic pricing and its presentation-version marker.
  // Do NOT rebuild serviceBreakdown from manual scope: manual scope baseSubtotal can
  // be stale and is not the pricing source of truth.
  // quote.html applies publishedCustomerScope wording over the existing priced
  // serviceBreakdown without touching the subtotals.
  if (previewDraft) {
    estimate.publishedCustomerScope = JSON.parse(JSON.stringify(scope));
    estimate.customerScopePublished = true;
  }

  // Prevent legacy AI scope sources from being merged into customer-facing wording.
  // Labor/material lines remain intact so optional detailed breakdowns still work.
  estimate.scopeSections = [];
  estimate.customerSupplied = [];
  estimate.exclusions = [];

  data.estimate = estimate;
  return data;
}

function cors() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Content-Type": "application/json",
  };
}
