// netlify/functions/adopt-option.js
//
// ADD AN OPTION THE CUSTOMER CHOSE INTO THE ESTIMATE. CONTRACTOR ONLY.
//
// POST { ref, optionId }               header x-sbc-key: <DASHBOARD_KEY>
//
// The customer ticked "Option A — $3,850" on the quote page and approved. The
// work now has to appear in the estimate and on the invoice. The obvious move —
// press Regenerate and let the AI write it in — is the wrong one, and the
// contractor spotted why before anyone else did: the generator is not
// deterministic, so regenerating with nothing changed comes back with different
// prices, and the customer has already been promised the old ones.
//
// So this does it without an AI call. One line at exactly the quoted price, into
// the bucket the customer is actually shown, with the service card's subtotal
// and scope updated to match — and lib/adopt-option.js refuses the whole thing
// if the customer-facing total would land anywhere other than exactly the old
// total plus that option's price.
//
// Gated on DASHBOARD_KEY like every other write endpoint on a customer-facing
// record, refusing when the key is unset rather than falling open.

"use strict";

const { getStore } = require("@netlify/blobs");
const { adoptOption } = require("./lib/adopt-option");
const customerTotals = require("./lib/customer-total");

exports.handler = async function (event) {
  if (event.httpMethod === "OPTIONS") return { statusCode: 200, headers: cors(), body: "" };
  if (event.httpMethod !== "POST") return json(405, { error: "Method Not Allowed" });

  const secret = process.env.DASHBOARD_KEY;
  if (!secret) return json(500, { error: "DASHBOARD_KEY is not set in Netlify. Set it, then redeploy." });
  const given = event.headers["x-sbc-key"] || event.headers["X-Sbc-Key"] || event.headers["X-SBC-Key"] || "";
  if (given !== secret) return json(401, { error: "Bad or missing dashboard key" });

  let body;
  try { body = JSON.parse(event.body || "{}"); } catch (_) { return json(400, { error: "Bad JSON" }); }

  const ref = String(body.ref || "").trim();
  const optionId = String(body.optionId || "").trim();
  if (!ref) return json(400, { error: "Missing ref" });
  if (!optionId) return json(400, { error: "Missing optionId" });

  const store = getStore({ name: "estimates", siteID: process.env.MY_SITE_ID, token: process.env.MY_BLOBS_TOKEN });
  const record = await store.get(ref, { type: "json" });
  if (!record) return json(404, { error: "Estimate " + ref + " not found" });

  const result = adoptOption(record, optionId);
  if (!result.ok) {
    return json(409, { ok: false, reason: result.reason, customerTotalBefore: result.before, customerTotalAfter: result.after });
  }

  record.updatedAt = new Date().toISOString();
  record.optionAdoptedAt = record.updatedAt;
  await store.setJSON(ref, record);

  return json(200, {
    ok: true,
    ref: ref,
    label: result.option.label,
    price: result.option.price,
    section: result.option.section,
    bucket: result.bucket,
    customerTotalBefore: result.before,
    customerTotalAfter: result.after,
    /* Echoed so the dashboard can show the figure without recomputing it. */
    customerTotal: customerTotals(record.estimate || {}, record).customerTotal,
  });
};

function cors() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type, x-sbc-key",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Content-Type": "application/json",
    "Cache-Control": "no-store",
  };
}
function json(code, obj) {
  return { statusCode: code, headers: cors(), body: JSON.stringify(obj) };
}
