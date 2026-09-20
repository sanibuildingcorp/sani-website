// netlify/functions/gmail-connect.js — "Connect a Gmail" starts here.
//
//   "if i will have a connect button in my dashboard and i will connect by
//    this button manually whatever email i need to connect"
//
// The dashboard POSTs here (x-sbc-key) and gets the Google sign-in URL to
// send the browser to: read-only Gmail permission, a signed state so the
// callback knows the sign-in was started from his dashboard. Google then
// returns to gmail-callback with a code.
//
// CONTRACTOR ONLY: anyone able to start a connection could attach a
// stranger's mailbox to his dashboard. Setup missing -> a plain message
// naming the two env vars, so the button says what to do instead of failing.

"use strict";

const { requireDashboardKey } = require("./lib/require-dashboard-key");
const gmail = require("./lib/gmail-accounts");

exports.handler = async function (event) {
  if (event.httpMethod === "OPTIONS") return { statusCode: 200, headers: cors(), body: "" };
  if (event.httpMethod !== "POST") return json(405, { error: "Method Not Allowed" });
  const denied = requireDashboardKey(event, cors());
  if (denied) return denied;
  if (!gmail.configured()) {
    return json(400, { error: "Google sign-in is not set up yet: add GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in Netlify (functions scope) and redeploy.", setup: false, redirectUri: gmail.redirectUri() });
  }
  return json(200, { ok: true, url: gmail.authUrl(gmail.signState()), redirectUri: gmail.redirectUri() });
};

function cors() {
  return { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "Content-Type, x-sbc-key", "Access-Control-Allow-Methods": "POST, OPTIONS", "Content-Type": "application/json", "Cache-Control": "no-store" };
}
function json(code, obj) { return { statusCode: code, headers: cors(), body: JSON.stringify(obj) }; }
