// netlify/functions/scope-pdf.js
//
// GET ?ref=SBC-…   ->  Scope-of-Work-SBC-….pdf
//
//   "Yes build the download PDF button"
//
// The scope of work as a file, for the "Download PDF" button on the scope
// page and the link in the scope email. Public, like get-estimate: it is
// gated by the ref, and it carries exactly what the scope page carries -
// get-estimate's own scopeView, which has already removed every price and
// every private matter (lib/scope-only.js). Laid out by lib/scope-pdf.js.

"use strict";

const { getStore } = require("@netlify/blobs");
const { scopeView } = require("./get-estimate");
const { buildScopePdf, fileName } = require("./lib/scope-pdf");

exports.handler = async function (event) {
  if (event.httpMethod === "OPTIONS") return { statusCode: 200, headers: cors(), body: "" };
  if (event.httpMethod !== "GET") return json(405, { error: "Method Not Allowed" });

  const ref = String((event.queryStringParameters && event.queryStringParameters.ref) || "").trim();
  if (!ref) return json(400, { error: "Missing ref" });

  try {
    const store = getStore({ name: "estimates", siteID: process.env.MY_SITE_ID, token: process.env.MY_BLOBS_TOKEN });
    const data = await store.get(ref, { type: "json" });
    if (!data) return json(404, { error: "Not found" });

    const view = scopeView(data);
    const pdf = buildScopePdf(view);
    return {
      statusCode: 200,
      headers: Object.assign(cors(), {
        "Content-Type": "application/pdf",
        "Content-Disposition": 'attachment; filename="' + fileName(view) + '"',
        "Cache-Control": "no-store",
      }),
      body: pdf.toString("base64"),
      isBase64Encoded: true,
    };
  } catch (err) {
    console.error("scope-pdf error:", err.message);
    return json(500, { error: err.message });
  }
};

function json(status, obj) {
  return { statusCode: status, headers: Object.assign(cors(), { "Content-Type": "application/json" }), body: JSON.stringify(obj) };
}
function cors() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
  };
}
