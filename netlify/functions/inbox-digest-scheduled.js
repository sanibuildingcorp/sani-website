// netlify/functions/inbox-digest-scheduled.js — the morning list, on the clock.
//
// Runs on the cron in netlify.toml and POSTs { mode: "daily" } to
// inbox-digest-background on this site, with the dashboard key from this
// function's own environment. The background function does the reading and
// the writing; this is only the alarm clock, kept apart for the same reason
// inbox-sync-scheduled is: a function on a schedule may not be reachable by
// URL, and the background one must be, for inbox-sync's alerts.
//
// Only the scheduler (its body carries next_run) may run it.

const JSON_HEADERS = { "Content-Type": "application/json", "Cache-Control": "no-store" };
const CALL_MS = 5000; /* a background function answers 202 at once */

exports.handler = async function (event) {
  let body = {};
  try { body = JSON.parse(event.body || "{}"); } catch (e) { body = {}; }
  if (!(body && body.next_run)) {
    return { statusCode: 401, headers: JSON_HEADERS, body: JSON.stringify({ error: "scheduler only" }) };
  }
  if (!process.env.DASHBOARD_KEY) {
    return { statusCode: 500, headers: JSON_HEADERS, body: JSON.stringify({ error: "DASHBOARD_KEY is not set" }) };
  }
  const base = (process.env.URL || "https://www.sanibuildingcorp.com").replace(/\/$/, "");
  const ctrl = typeof AbortController === "function" ? new AbortController() : null;
  const timer = ctrl ? setTimeout(function () { ctrl.abort(); }, CALL_MS) : null;
  try {
    const r = await fetch(base + "/.netlify/functions/inbox-digest-background", {
      method: "POST", headers: { "Content-Type": "application/json", "x-sbc-key": process.env.DASHBOARD_KEY },
      body: JSON.stringify({ mode: "daily" }), signal: ctrl ? ctrl.signal : undefined,
    });
    return { statusCode: 200, headers: JSON_HEADERS, body: JSON.stringify({ ok: r.ok || r.status === 202, status: r.status }) };
  } catch (e) {
    return { statusCode: 502, headers: JSON_HEADERS, body: JSON.stringify({ error: String((e && e.message) || e) }) };
  } finally {
    if (timer) clearTimeout(timer);
  }
};
