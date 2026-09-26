// netlify/functions/inbox-sync-background.js — the full inbox read, with time.
//
//   "He can't found emails" (Sep 26 2026)
//
// The same sync as inbox-sync.js, on the FULL clock (minutes, a wider
// window, more downloads, the index written as it goes). The 15-minute
// schedule runs this one; the dashboard's "Sync inbox" button still gets the
// quick answer from inbox-sync and starts this behind it. A background
// function answers 202 at once and its result is not returned, so the
// numbers a run found are in the function log only.
//
// Contractor-only: the scheduled caller and the dashboard send the key.

const { requireDashboardKey } = require("./lib/require-dashboard-key");
const sync = require("./inbox-sync");

exports.handler = async function (event) {
  const denied = requireDashboardKey(event);
  if (denied) return denied;
  const res = await sync.run(Object.assign({}, event, { httpMethod: "POST", queryStringParameters: {} }), sync.FULL);
  try { console.log("inbox-sync-background", res.statusCode, String(res.body || "").slice(0, 1500)); } catch (_) {}
  return res;
};
