// netlify/functions/estimate-pdf.js
//
// GET ?ref=SBC-…&v=customer|internal   (header x-sbc-key)
//   ->  Estimate-<name>-<ref>.pdf  or  Internal-Estimate-<name>-<ref>.pdf
//
//   "I need download or print function in my dashboard for let me download
//    each estimate" - both versions, a PDF file.
//
// CONTRACTOR ONLY. The internal copy carries every rate and the markup, so the
// whole endpoint sits behind the dashboard key; the dashboard fetches the file
// with the key and saves it. Laid out by lib/estimate-pdf.js; the customer
// copy is get-estimate's customerPdfView (what the customer's page shows).

"use strict";

const { getStore } = require("@netlify/blobs");
const { requireDashboardKey } = require("./lib/require-dashboard-key");
const { customerPdfView } = require("./get-estimate");
const { buildCustomerPdf, buildInternalPdf, fileName } = require("./lib/estimate-pdf");

exports.handler = async function (event) {
  if (event.httpMethod === "OPTIONS") return { statusCode: 200, headers: cors(), body: "" };
  if (event.httpMethod !== "GET") return json(405, { error: "Method Not Allowed" });
  const denied = requireDashboardKey(event, cors());
  if (denied) return denied;

  const q = event.queryStringParameters || {};
  const ref = String(q.ref || "").trim();
  const version = q.v === "internal" ? "internal" : "customer";
  if (!ref) return json(400, { error: "Missing ref" });

  try {
    const store = getStore({ name: "estimates", siteID: process.env.MY_SITE_ID, token: process.env.MY_BLOBS_TOKEN });
    const data = await store.get(ref, { type: "json" });
    if (!data) return json(404, { error: "Not found" });
    const pdf = version === "internal" ? buildInternalPdf(data) : buildCustomerPdf(customerPdfView(data));
    return {
      statusCode: 200,
      headers: Object.assign(cors(), {
        "Content-Type": "application/pdf",
        "Content-Disposition": 'attachment; filename="' + fileName(data, version) + '"',
        "Cache-Control": "no-store",
      }),
      body: pdf.toString("base64"),
      isBase64Encoded: true,
    };
  } catch (err) {
    console.error("estimate-pdf error:", err.message);
    return json(500, { error: err.message });
  }
};

function json(status, obj) {
  return { statusCode: status, headers: Object.assign(cors(), { "Content-Type": "application/json", "Cache-Control": "no-store" }), body: JSON.stringify(obj) };
}
function cors() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type, x-sbc-key",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Expose-Headers": "Content-Disposition",
  };
}
