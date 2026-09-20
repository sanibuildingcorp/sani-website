// netlify/functions/gmail-callback.js — Google comes back here.
//
// PUBLIC BY NECESSITY: Google's browser redirect carries no dashboard key.
// What guards it is the STATE: a value signed by gmail-connect for a
// sign-in started from his dashboard, good for fifteen minutes. A callback
// with no valid state is sent back to the dashboard with an error and no
// token is exchanged, so a stranger cannot attach a mailbox by hitting this
// URL with a code of their own.
//
// With a good state: the code becomes a refresh token, the mailbox's own
// address is read from Google, both are stored (lib/gmail-accounts.js), and
// the browser lands on the dashboard with ?gmail=connected&email=…

"use strict";

const gmail = require("./lib/gmail-accounts");

function str(v) { return String(v == null ? "" : v).trim(); }
function back(params) {
  const base = str(process.env.URL || "https://www.sanibuildingcorp.com").replace(/\/$/, "");
  const q = Object.keys(params).map(function (k) { return k + "=" + encodeURIComponent(params[k]); }).join("&");
  return { statusCode: 302, headers: { Location: base + "/dashboard.html?" + q, "Cache-Control": "no-store" }, body: "" };
}

exports.handler = async function (event) {
  if (event.httpMethod !== "GET") return { statusCode: 405, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ error: "Method Not Allowed" }) };
  const q = event.queryStringParameters || {};
  if (!gmail.configured()) return back({ gmail: "error", msg: "Google sign-in is not set up in Netlify yet" });
  if (!gmail.checkState(q.state)) return back({ gmail: "error", msg: "That sign-in link was not started from the dashboard, or it expired. Press Connect again." });
  if (str(q.error)) return back({ gmail: "error", msg: "Google said: " + str(q.error).slice(0, 80) });
  if (!str(q.code)) return back({ gmail: "error", msg: "Google sent no code back" });
  try {
    const tok = await gmail.exchangeCode(q.code);
    if (!str(tok.refresh_token)) return back({ gmail: "error", msg: "Google gave no lasting permission. Remove the app under Google Account > Security > Third-party access, then press Connect again." });
    const email = await gmail.profile(str(tok.access_token));
    if (!email) return back({ gmail: "error", msg: "Could not read which mailbox that is" });
    await gmail.saveAccount(email, tok.refresh_token);
    return back({ gmail: "connected", email: email });
  } catch (e) {
    return back({ gmail: "error", msg: str(e && e.message).slice(0, 160) || "connection failed" });
  }
};
