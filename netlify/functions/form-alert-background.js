// netlify/functions/form-alert-background.js — "stopped at step", after a wait.
//
// form-alert starts this when the estimate form page goes hidden. It waits
// (FORM_ABANDON_WAIT_MIN, default 10 minutes), then reads the visit: if the
// customer came back, moved to another step or sent the request since, it
// does nothing. Otherwise it asks form-alert to send the alert (type
// "abandon", final:true, with the dashboard key). Contractor-only (x-sbc-key).

"use strict";

const { requireDashboardKey } = require("./lib/require-dashboard-key");
const formAlert = require("./form-alert");

function str(v) { return String(v == null ? "" : v).trim(); }
function cors() { return { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "Content-Type, x-sbc-key", "Access-Control-Allow-Methods": "POST, OPTIONS", "Content-Type": "application/json", "Cache-Control": "no-store" }; }

/* Was the visit really left? */
function stillGone(session, abandonAt) {
  const s = session || {};
  if (s.done === true) return false;
  if (str(s.abandonAt) && str(s.abandonAt) !== str(abandonAt)) return false;   /* a later hide owns the alert */
  if (str(s.lastSeenAt) && Date.parse(s.lastSeenAt) > Date.parse(abandonAt)) return false;
  return true;
}
exports.stillGone = stillGone;

exports.handler = async function (event) {
  if (event.httpMethod === "OPTIONS") return { statusCode: 200, headers: cors(), body: "" };
  const denied = requireDashboardKey(event, cors());
  if (denied) return denied;
  let body = {};
  try { body = JSON.parse(event.body || "{}"); } catch (e) { return { statusCode: 400, headers: cors(), body: "{}" }; }
  const sid = str(body.sid), at = str(body.abandonAt);
  if (!sid || !at) return { statusCode: 400, headers: cors(), body: JSON.stringify({ error: "sid and abandonAt" }) };
  const waitMs = Math.max(0, Number(process.env.FORM_ABANDON_WAIT_MIN || 10)) * 60000;
  await new Promise(function (r) { setTimeout(r, waitMs); });
  const session = await formAlert.readSession(sid);
  if (!stillGone(session, at)) {
    console.log("form-alert-background: came back, no alert", sid);
    return { statusCode: 200, headers: cors(), body: JSON.stringify({ sent: false }) };
  }
  const out = await formAlert.handler({ httpMethod: "POST", headers: { "x-sbc-key": process.env.DASHBOARD_KEY || "" }, body: JSON.stringify(Object.assign({}, body, { type: "abandon", final: true })) });
  return { statusCode: 200, headers: cors(), body: JSON.stringify({ sent: out.statusCode === 200 }) };
};
