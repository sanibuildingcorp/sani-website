// netlify/functions/search-console.js
//
// GET                                   header x-sbc-key    CONTRACTOR ONLY
//   -> the Search Console report (lib/search-console.js), or { setup: true }
//      when no key file has been given yet.
// POST { action: "save-key", key: {...the service account JSON file...} }
//   -> checks it, keeps it in Netlify Blobs, answers with the account email
//      he must add in Search Console. The key is never sent back.
// POST { action: "forget-key" }
//
// GSC_SERVICE_ACCOUNT in Netlify (the JSON, or the JSON in base64) is used
// when set; the uploaded file otherwise. Netlify's 4 KB limit on function
// variables is why the upload exists.

"use strict";

const { getStore } = require("@netlify/blobs");
const { requireDashboardKey } = require("./lib/require-dashboard-key");
const gsc = require("./lib/search-console");

const BLOB = "gsc-service-account";

function cors() {
  return { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "Content-Type, x-sbc-key", "Access-Control-Allow-Methods": "GET, POST, OPTIONS", "Content-Type": "application/json", "Cache-Control": "no-store" };
}
function json(code, obj) { return { statusCode: code, headers: cors(), body: JSON.stringify(obj) }; }
function store() { return getStore({ name: "settings", siteID: process.env.MY_SITE_ID, token: process.env.MY_BLOBS_TOKEN }); }

async function creds() {
  if (process.env.GSC_SERVICE_ACCOUNT) { const k = gsc.parseKey(process.env.GSC_SERVICE_ACCOUNT); if (k) return k; }
  try { return gsc.parseKey(await store().get(BLOB, { type: "json" })); } catch (e) { return null; }
}

exports.handler = async function (event) {
  if (event.httpMethod === "OPTIONS") return { statusCode: 200, headers: cors(), body: "" };
  const denied = requireDashboardKey(event, cors());
  if (denied) return denied;

  if (event.httpMethod === "POST") {
    let body;
    try { body = JSON.parse(event.body || "{}"); } catch (e) { return json(400, { error: "Unreadable request" }); }
    if (body.action === "save-key") {
      const k = gsc.parseKey(body.key);
      if (!k) return json(400, { error: "That is not a Google service account key file (the .json file from Google Cloud > Service accounts > Keys)." });
      await store().setJSON(BLOB, { type: "service_account", client_email: k.client_email, private_key: k.private_key, project_id: k.project_id, savedAt: new Date().toISOString() });
      return json(200, { saved: true, account: k.client_email });
    }
    if (body.action === "forget-key") { await store().delete(BLOB); return json(200, { forgotten: true }); }
    return json(400, { error: "Unknown action" });
  }
  if (event.httpMethod !== "GET") return json(405, { error: "Method Not Allowed" });

  const k = await creds();
  if (!k) return json(200, { setup: true });
  try {
    const site = String(process.env.GSC_SITE_URL || "").trim() || undefined;
    return json(200, await gsc.report(fetch, k, { site: site }));
  } catch (err) {
    return json(200, { error: err.message, code: err.code || "", account: k.client_email });
  }
};
