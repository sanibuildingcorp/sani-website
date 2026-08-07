// netlify/functions/get-estimate.js
// Returns one full estimate (including photos & all answers) by ref.
//
// Customer-scope safety:
// - Dashboard/admin requests receive the untouched stored record.
// - quote.html receives a customer-view clone when a manual scope is published.
// - ?previewScope=1 on quote.html can preview the private scope draft without publishing it.
// This keeps the estimator's labor/material source data intact while allowing the
// contractor to control exactly what appears under Included / Customer Supplies /
// Not Included on the customer proposal.

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

    // Important: dashboard and all internal tools continue receiving the exact
    // stored estimate, including original labor/material descriptions.
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

  estimate.customerPresentationVersion = "v7-service-proposal";
  // Preview is enabled only in this response clone. It does not publish anything.
  if (previewDraft) {
    estimate.customerScopePublished = true;
    estimate.customerViewPublishedVersion = "v7";
  }

  estimate.serviceBreakdown = scope.services
    .filter((service) => service && String(service.title || "").trim())
    .map((service) => ({
      title: String(service.title || "").trim(),
      included: cleanList(service.included),
      customerSupplies: cleanList(service.customerSupplies),
      notIncluded: cleanList(service.notIncluded),
      subtotal: positiveNumber(service.baseSubtotal),
      options: Array.isArray(service.options) ? service.options : [],
      source: "contractor_manual_scope"
    }));

  // Prevent the customer page from re-inventing scope from AI-generated source
  // descriptions. Pricing math remains available through the original qty/rates,
  // but the item wording is neutralized in this response only.
  estimate.scopeSections = [];
  estimate.customerSupplied = [];
  estimate.exclusions = [];

  estimate.labor = (Array.isArray(estimate.labor) ? estimate.labor : []).map((line) => ({
    ...line,
    item: "Material allowance",
  }));
  estimate.materials = (Array.isArray(estimate.materials) ? estimate.materials : []).map((line) => ({
    ...line,
    item: "Material allowance",
  }));

  data.estimate = estimate;
  return data;
}

function cleanList(value) {
  const seen = new Set();
  const out = [];
  (Array.isArray(value) ? value : []).forEach((item) => {
    const text = String(item == null ? "" : item).trim();
    const key = text.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
    if (text && !seen.has(key)) {
      seen.add(key);
      out.push(text);
    }
  });
  return out;
}

function positiveNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : 0;
}

function cors() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Content-Type": "application/json",
  };
}
