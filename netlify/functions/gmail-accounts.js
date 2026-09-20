// netlify/functions/gmail-accounts.js — the connected mailboxes, listed and removed.
//
//   { action: "list" }               -> { accounts: [{ email, addedAt, lastSync, lastResult, error }] }
//   { action: "remove", email }      -> revokes the permission at Google, forgets the token
//
// Tokens never come out: the list carries addresses and sync notes only.
// CONTRACTOR ONLY (x-sbc-key).

"use strict";

const { requireDashboardKey } = require("./lib/require-dashboard-key");
const gmail = require("./lib/gmail-accounts");

function str(v) { return String(v == null ? "" : v).trim(); }

exports.handler = async function (event) {
  if (event.httpMethod === "OPTIONS") return { statusCode: 200, headers: cors(), body: "" };
  if (event.httpMethod !== "POST") return json(405, { error: "Method Not Allowed" });
  const denied = requireDashboardKey(event, cors());
  if (denied) return denied;
  let body = {};
  try { body = JSON.parse(event.body || "{}"); } catch (e) { return json(400, { error: "Unreadable request" }); }
  const action = str(body.action) || "list";
  try {
    if (action === "list") {
      return json(200, { ok: true, setup: gmail.configured(), redirectUri: gmail.redirectUri(), accounts: await gmail.listAccounts() });
    }
    if (action === "remove") {
      const email = str(body.email).toLowerCase();
      if (!email) return json(400, { error: "Which mailbox?" });
      const had = await gmail.removeAccount(email);
      return json(200, { ok: true, removed: had, accounts: await gmail.listAccounts() });
    }
    return json(400, { error: "Unknown action" });
  } catch (e) {
    return json(502, { error: str(e && e.message).slice(0, 200) || "failed" });
  }
};

function cors() {
  return { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "Content-Type, x-sbc-key", "Access-Control-Allow-Methods": "POST, OPTIONS", "Content-Type": "application/json", "Cache-Control": "no-store" };
}
function json(code, obj) { return { statusCode: code, headers: cors(), body: JSON.stringify(obj) }; }
