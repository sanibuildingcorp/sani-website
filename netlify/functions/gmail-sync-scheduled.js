// netlify/functions/gmail-sync-scheduled.js — the connected mailboxes sync themselves.
//
// Every fifteen minutes (netlify.toml), offset from inbox-sync so the two
// never run in the same second. POSTs to gmail-sync on this same site with
// the dashboard key from the environment: gmail-sync is contractor-only.
// Only the scheduler (its body carries next_run) may run this.

const JSON_HEADERS = { "Content-Type": "application/json", "Cache-Control": "no-store" };
const CALL_MS = 25000;

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
    const r = await fetch(base + "/.netlify/functions/gmail-sync", { method: "POST", headers: { "Content-Type": "application/json", "x-sbc-key": process.env.DASHBOARD_KEY }, body: "{}", signal: ctrl ? ctrl.signal : undefined });
    const text = await r.text();
    return { statusCode: 200, headers: JSON_HEADERS, body: JSON.stringify({ ok: r.ok, status: r.status, sync: text.slice(0, 2000) }) };
  } catch (e) {
    return { statusCode: 502, headers: JSON_HEADERS, body: JSON.stringify({ error: String((e && e.message) || e) }) };
  } finally {
    if (timer) clearTimeout(timer);
  }
};
