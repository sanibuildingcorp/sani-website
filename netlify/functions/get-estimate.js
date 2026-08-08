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

  // Deterministic pricing is the source of truth for which priced services still
  // exist. Old published wording may contain services that were later consolidated
  // into another parent service (for example Flooring/Painting into Bathroom). Those
  // stale zero-value services must never reappear on the customer quote.
  const deterministic = /^v8\.2-deterministic-four-service/i.test(String(estimate.customerPresentationVersion || ""));
  let allowedTitles = null;
  if (deterministic && Array.isArray(estimate.serviceBreakdown)) {
    allowedTitles = new Set(
      estimate.serviceBreakdown
        .filter(s => Number(s && s.subtotal) > 0.005)
        .map(s => normalizeTitle(s && (s.title || s.service || s.section || s.name)))
        .filter(Boolean)
    );
  }

  // Customer link gets a concise wording-only copy. The dashboard keeps the full,
  // editable contractor scope. This never changes pricing or stored source data.
  estimate.publishedCustomerScope = cleanCustomerScope(scope, allowedTitles);
  estimate.customerScopePublished = true;

  // Preserve deterministic pricing and its presentation-version marker.
  // Do NOT rebuild serviceBreakdown from manual scope: manual scope baseSubtotal can
  // be stale and is not the pricing source of truth.
  // quote.html applies publishedCustomerScope wording over the existing priced
  // serviceBreakdown without touching the subtotals.

  // Prevent legacy AI scope sources from being merged into customer-facing wording.
  // Labor/material lines remain intact so optional detailed breakdowns still work.
  estimate.scopeSections = [];
  estimate.customerSupplied = [];
  estimate.exclusions = [];

  data.estimate = estimate;
  return data;
}

function cleanCustomerScope(scope, allowedTitles) {
  const out = JSON.parse(JSON.stringify(scope || {}));
  out.services = (Array.isArray(out.services) ? out.services : [])
    .filter(service => {
      if (!(allowedTitles instanceof Set)) return true;
      const title = normalizeTitle(service && (service.name || service.title));
      return title && allowedTitles.has(title);
    })
    .map(service => {
      const title = String(service.name || service.title || "").trim();
      const included = uniq(service.included || []);
      service.included = compressIncluded(title, included);
      service.supplied = uniq(service.supplied || service.customerSupplies || []);
      service.excluded = uniq(service.excluded || service.notIncluded || []).filter(x => !/^option\s*b\b/i.test(String(x).trim()));
      return service;
    });
  return out;
}

function normalizeTitle(value) {
  return String(value == null ? "" : value).trim().toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function compressIncluded(title, lines) {
  const t = String(title || "").toLowerCase();
  if (!lines.length) return [];

  const defs = t.includes("bathroom") ? [
    [/protect|site protection|access path/i, "Protect bathroom, adjacent finishes and access path before work begins"],
    [/demol|remove existing|debris|disposal/i, "Remove specified existing bathroom finishes/fixtures and dispose of construction debris"],
    [/shower pan|drain inspect|inspect.*drain|pan inspection/i, "Inspect the existing shower pan and drain; preserve the existing pan unless an approved hidden-condition change is required"],
    [/substrate|backer|waterproof|membrane/i, "Prepare substrates; install backer board and waterproof shower wet areas as required"],
    [/tile|grout/i, "Install specified bathroom wall and floor tile, including layout, grout, sealant and finish work"],
    [/plumb|vanity|toilet|faucet|shower trim/i, "Install and connect customer-supplied bathroom fixtures in their existing plumbing locations"],
    [/glass|enclosure/i, "Measure, fabricate and install the frameless shower glass enclosure with minimal hardware"],
    [/clean|touch.?up|caulk|sealant/i, "Complete final caulking, touch-ups, cleanup and protection"]
  ] : t.includes("floor") ? [
    [/protect|receive|delivery/i, "Protect adjacent finishes and receive/inspect customer-supplied flooring"],
    [/inspect|prepare|subfloor|floor prep/i, "Inspect and prepare the existing floor surface for installation"],
    [/engineered hardwood|hardwood install|flooring install/i, "Install customer-supplied engineered hardwood flooring in the specified areas"],
    [/cut|fit|doorway|transition/i, "Complete required cuts and fitting at walls, doorways and transitions"],
    [/quarter.?round|1\/4.?round|trim/i, "Install 1/4-round trim where required"],
    [/clean|protection/i, "Complete final flooring cleanup and protection"]
  ] : t.includes("paint") ? [
    [/protect|mask/i, "Protect floors, fixtures and adjacent finished surfaces"],
    [/patch|sand|surface prep|preparation/i, "Perform minor patching, sanding and surface preparation as required"],
    [/prime/i, "Spot-prime repaired areas as needed"],
    [/paint.*wall|wall.*paint|ceiling|finish coat/i, "Apply customer-supplied finish paint to included walls and ceilings"],
    [/door|trim/i, "Paint included doors and trim as specified"],
    [/clean|touch.?up/i, "Complete final touch-ups and cleanup"]
  ] : t.includes("window") ? [
    [/remove|disposal|dispose/i, "Option A (base estimate): remove and dispose of the specified existing windows"],
    [/opening|prepare/i, "Prepare existing window openings for replacement installation"],
    [/install|replacement window/i, "Supply and install the specified standard aluminum replacement windows"],
    [/trim|casing|caulk|seal|weather/i, "Complete interior/exterior trim, caulking and weather-sealing as required"],
    [/test|adjust|operation/i, "Test window operation and complete final adjustments and cleanup"]
  ] : [];

  if (!defs.length) return lines;
  const joined = lines.join(" | ");
  const concise = defs.filter(([re]) => re.test(joined)).map(([, text]) => text);
  return concise.length ? uniq(concise) : lines;
}

function uniq(values) {
  const seen = new Set();
  const out = [];
  (Array.isArray(values) ? values : []).forEach(value => {
    const text = String(value == null ? "" : value).trim();
    const key = text.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
    if (text && !seen.has(key)) {
      seen.add(key);
      out.push(text);
    }
  });
  return out;
}

function cors() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Content-Type": "application/json",
  };
}