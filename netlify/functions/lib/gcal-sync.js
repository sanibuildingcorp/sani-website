// netlify/functions/lib/gcal-sync.js
//
//   "yes i want to add automatically"
//
// Automatic Google Calendar for site visits, without a Google Cloud project,
// a service account or an OAuth dance. A tiny Google Apps Script web app
// (google-calendar/Code.gs) runs AS HIM inside his own Google account, and
// this module POSTs each visit to it with a shared secret. The script writes
// the event with two phone reminders and answers with the event id, which is
// kept on the visit so a later change or delete finds the same event.
//
// TWO RULES:
//   1. A calendar failure NEVER loses a visit. The caller saves the visit
//      whatever this returns; the result is written next to it as `gcal`
//      and the dashboard shows a Sync button to try again.
//   2. Not configured (no GCAL_SYNC_URL / GCAL_SYNC_SECRET) is not an error.
//      It is "skipped", and the one-tap Add to Google Calendar link still works.
//
// Times: a visit's datetime is New York wall-clock with no zone. It is turned
// into an epoch here, so the script gets an instant and cannot misread it
// whatever timezone the script project happens to be set to.

"use strict";

const TZ = "America/New_York";
const TIMEOUT_MS = 6000;
const VISIT_MINUTES = 60;

/* What New York's clock shows at `epoch`, as parts. hourCycle h23 so
   midnight is 0, never 24. */
function nyParts(epoch) {
  const f = new Intl.DateTimeFormat("en-US", {
    timeZone: TZ, hourCycle: "h23",
    year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit",
  });
  const o = {};
  f.formatToParts(new Date(epoch)).forEach((p) => { if (p.type !== "literal") o[p.type] = Number(p.value); });
  return o;
}

/* New York offset from UTC at `epoch`, in ms (negative: -4h summer, -5h winter). */
function nyOffsetMs(epoch) {
  const p = nyParts(epoch);
  return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute) - Math.floor(epoch / 60000) * 60000;
}

/* "2026-09-17T14:00" (New York wall-clock) -> epoch ms. Two passes so a
   guess that lands on the wrong side of a DST change corrects itself. */
function nyWallToEpoch(wall) {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(String(wall || ""));
  if (!m) return null;
  const want = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]);
  let guess = want;
  for (let i = 0; i < 2; i++) guess = want - nyOffsetMs(guess);
  return guess;
}

function configured(env) {
  const e = env || process.env;
  return !!(e.GCAL_SYNC_URL && e.GCAL_SYNC_SECRET);
}

/* The body the Apps Script receives. Exported so a test can see exactly what
   leaves the server. */
function payloadFor(action, visit, env) {
  const e = env || process.env;
  const startMs = nyWallToEpoch(visit.datetime);
  return {
    secret: e.GCAL_SYNC_SECRET,
    action: action,
    id: visit.id || "",
    eventId: visit.gcalEventId || "",
    title: "Site visit: " + (visit.customer || ""),
    startMs: startMs,
    endMs: startMs == null ? null : startMs + VISIT_MINUTES * 60000,
    location: visit.address || "",
    description: (visit.reason || "") + (visit.ref ? "\nEstimate " + visit.ref : "") + (visit.id ? "\nVisit " + visit.id : ""),
    timeZone: TZ,
  };
}

/**
 * @param {'create'|'update'|'delete'} action
 * @param {object} visit
 * @param {{fetch?:Function, env?:object}} [opts]
 * @returns {Promise<{status:'ok'|'skipped'|'error', eventId?:string, message?:string, at:string}>}
 * Never throws.
 */
async function syncVisit(action, visit, opts) {
  const o = opts || {};
  const env = o.env || process.env;
  const at = new Date().toISOString();
  if (!configured(env)) return { status: "skipped", message: "Google Calendar sync is not connected", at };
  const doFetch = o.fetch || global.fetch;
  if (typeof doFetch !== "function") return { status: "error", message: "fetch is not available in this runtime", at };

  const payload = payloadFor(action, visit, env);
  if (action !== "delete" && payload.startMs == null) return { status: "error", message: "visit has no usable date/time", at };
  if (action === "delete" && !payload.eventId) return { status: "skipped", message: "visit was never in Google Calendar", at };

  const ctrl = typeof AbortController === "function" ? new AbortController() : null;
  const timer = ctrl ? setTimeout(() => ctrl.abort(), TIMEOUT_MS) : null;
  try {
    /* Apps Script answers a POST with a 302 to script.googleusercontent.com;
       the real body is behind the redirect, so it must be followed. */
    const r = await doFetch(env.GCAL_SYNC_URL, {
      method: "POST",
      redirect: "follow",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: ctrl ? ctrl.signal : undefined,
    });
    const text = await r.text();
    let j = null;
    try { j = JSON.parse(text); } catch (e) { j = null; }
    if (!j || typeof j !== "object") {
      const hint = /<html|<!doctype/i.test(text)
        ? "Google answered with a web page, not JSON. Is the web app deployed with access “Anyone” and executed as you?"
        : "Google answered with something that is not JSON";
      return { status: "error", message: hint + " (HTTP " + r.status + ")", at };
    }
    if (j.error) return { status: "error", message: String(j.error), at };
    if (!r.ok && !j.ok) return { status: "error", message: "HTTP " + r.status, at };
    return { status: "ok", eventId: String(j.eventId || visit.gcalEventId || ""), at };
  } catch (e) {
    const msg = e && e.name === "AbortError" ? "Google did not answer within " + (TIMEOUT_MS / 1000) + " s" : String((e && e.message) || e);
    return { status: "error", message: msg, at };
  } finally {
    if (timer) clearTimeout(timer);
  }
}

module.exports = { TZ, TIMEOUT_MS, VISIT_MINUTES, nyWallToEpoch, nyOffsetMs, configured, payloadFor, syncVisit };
