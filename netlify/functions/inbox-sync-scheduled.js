// netlify/functions/inbox-sync-scheduled.js — the inbox syncs itself.
//
//   "in my email inbox it's coming as a new email separate from the previous
//    conversation emails or separate from estimate conversation portal"
//
// inbox-sync only ran when he opened the Customers tab or pressed "Sync
// inbox". A customer's reply could sit in Gmail for a day before it reached
// the estimate, the portal and the assistant. This runs every 15 minutes
// (netlify.toml) and simply POSTs to inbox-sync on this same site.
//
// WHY NOT SCHEDULE inbox-sync ITSELF. A function on a schedule may not be
// reachable by URL in production, and the dashboard's button calls
// inbox-sync directly. Keeping the schedule on this small caller leaves the
// button exactly as it was.
//
// Only the scheduler (its body carries next_run) may run it; anyone else
// gets 401, so the URL cannot be used to make the site hammer its own inbox.

const JSON_HEADERS = { "Content-Type": "application/json", "Cache-Control": "no-store" };
const CALL_MS = 25000; /* the scheduled limit is 30s; inbox-sync itself stops at ~8s */

exports.handler = async function (event) {
  let body = {};
  try { body = JSON.parse(event.body || "{}"); } catch (e) { body = {}; }
  if (!(body && body.next_run)) {
    return { statusCode: 401, headers: JSON_HEADERS, body: JSON.stringify({ error: "scheduler only" }) };
  }
  const base = (process.env.URL || "https://www.sanibuildingcorp.com").replace(/\/$/, "");
  const ctrl = typeof AbortController === "function" ? new AbortController() : null;
  const timer = ctrl ? setTimeout(function () { ctrl.abort(); }, CALL_MS) : null;
  try {
    const r = await fetch(base + "/.netlify/functions/inbox-sync", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}", signal: ctrl ? ctrl.signal : undefined });
    const text = await r.text();
    return { statusCode: 200, headers: JSON_HEADERS, body: JSON.stringify({ ok: r.ok, status: r.status, sync: text.slice(0, 2000) }) };
  } catch (e) {
    return { statusCode: 502, headers: JSON_HEADERS, body: JSON.stringify({ error: String((e && e.message) || e) }) };
  } finally {
    if (timer) clearTimeout(timer);
  }
};
