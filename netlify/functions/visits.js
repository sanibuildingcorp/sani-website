// netlify/functions/visits.js — site-visit appointments (Netlify Blobs)
//
// CONTRACTOR ONLY. Every call carries  x-sbc-key: <DASHBOARD_KEY>.
//
// A visit is a customer's name, their home address and the hour he will be
// standing at their door. That is exactly the data list-estimates was gated
// for, and this endpoint used to hand it out - and take deletes - from a bare
// GET or POST with no key at all. Same gate, same rules: no key set => 500.
//
// GOOGLE CALENDAR. Each create / change / delete is mirrored to his Google
// Calendar through lib/gcal-sync (an Apps Script web app in his account).
// The mirror can fail - not set up yet, Google slow, script mis-deployed -
// and a failed mirror NEVER loses the visit: the visit is saved first, the
// calendar result is written next to it as `gcal`, and the dashboard offers
// a Sync button to try again. `action: "sync"` is that button.
const { getStore } = require("@netlify/blobs");
const { requireDashboardKey } = require("./lib/require-dashboard-key");
const gcal = require("./lib/gcal-sync");

function store() {
  return getStore({ name: "visits", siteID: process.env.MY_SITE_ID, token: process.env.MY_BLOBS_TOKEN });
}
function cors() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type, x-sbc-key",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Content-Type": "application/json",
    "Cache-Control": "no-store",
  };
}

/* Write the mirror's answer onto the visit. Only the public part - never
   the payload, which carries the secret. */
function applyGcal(visit, res) {
  if (res.status === "ok" && res.eventId) visit.gcalEventId = res.eventId;
  visit.gcal = { status: res.status, message: res.message || "", at: res.at };
  return visit;
}

const CALENDAR_FIELDS = ["customer", "address", "reason", "datetime"];

exports.handler = async function (event) {
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 200, headers: cors(), body: "" };
  }

  const denied = requireDashboardKey(event, cors());
  if (denied) return denied;

  try {
    const s = store();

    if (event.httpMethod === "GET") {
      const listing = await s.list();
      const visits = [];
      for (const b of (listing.blobs || [])) {
        try {
          const v = await s.get(b.key, { type: "json" });
          if (v) visits.push(v);
        } catch (e) { /* skip bad record */ }
      }
      visits.sort(function (a, b) { return (a.datetime || "").localeCompare(b.datetime || ""); });
      return { statusCode: 200, headers: cors(), body: JSON.stringify({ visits, gcalConfigured: gcal.configured() }) };
    }

    if (event.httpMethod === "POST") {
      const body = JSON.parse(event.body || "{}");
      const action = body.action;

      if (action === "create") {
        const v = body.visit || {};
        if (!v.customer || !v.datetime) {
          return { statusCode: 400, headers: cors(), body: JSON.stringify({ error: "customer and datetime required" }) };
        }
        const id = "V-" + Date.now().toString(36).toUpperCase() + Math.random().toString(36).slice(2, 5).toUpperCase();
        const visit = {
          id,
          customer: String(v.customer).slice(0, 120),
          address: String(v.address || "").slice(0, 200),
          reason: String(v.reason || "").slice(0, 300),
          ref: String(v.ref || "").slice(0, 40),
          datetime: String(v.datetime).slice(0, 25),   // ISO local "2026-07-11T14:00"
          notes: String(v.notes || "").slice(0, 500),
          done: false,
          createdAt: new Date().toISOString(),
        };
        /* Saved BEFORE the calendar is asked, so a slow or broken Google
           cannot cost him the visit. Saved again after, with the answer. */
        await s.set(id, JSON.stringify(visit));
        const res = await gcal.syncVisit("create", visit);
        applyGcal(visit, res);
        await s.set(id, JSON.stringify(visit));
        return { statusCode: 200, headers: cors(), body: JSON.stringify({ ok: true, visit, gcal: visit.gcal }) };
      }

      if (action === "update") {
        const cur = await s.get(body.id, { type: "json" });
        if (!cur) return { statusCode: 404, headers: cors(), body: JSON.stringify({ error: "not found" }) };
        const patch = body.patch || {};
        let calendarChanged = false;
        ["customer", "address", "reason", "datetime", "notes", "done"].forEach(function (k) {
          if (patch[k] !== undefined) {
            if (CALENDAR_FIELDS.indexOf(k) !== -1 && cur[k] !== patch[k]) calendarChanged = true;
            cur[k] = patch[k];
          }
        });
        await s.set(body.id, JSON.stringify(cur));
        if (calendarChanged) {
          const res = await gcal.syncVisit(cur.gcalEventId ? "update" : "create", cur);
          applyGcal(cur, res);
          await s.set(body.id, JSON.stringify(cur));
        }
        return { statusCode: 200, headers: cors(), body: JSON.stringify({ ok: true, visit: cur, gcal: cur.gcal || null }) };
      }

      if (action === "sync") {
        const cur = await s.get(body.id, { type: "json" });
        if (!cur) return { statusCode: 404, headers: cors(), body: JSON.stringify({ error: "not found" }) };
        const res = await gcal.syncVisit(cur.gcalEventId ? "update" : "create", cur);
        applyGcal(cur, res);
        await s.set(body.id, JSON.stringify(cur));
        return { statusCode: 200, headers: cors(), body: JSON.stringify({ ok: true, visit: cur, gcal: cur.gcal }) };
      }

      if (action === "delete") {
        let cur = null;
        try { cur = await s.get(body.id, { type: "json" }); } catch (e) { cur = null; }
        let res = null;
        if (cur && cur.gcalEventId) res = await gcal.syncVisit("delete", cur);
        await s.delete(body.id);
        return { statusCode: 200, headers: cors(), body: JSON.stringify({ ok: true, gcal: res ? { status: res.status, message: res.message || "" } : null }) };
      }

      return { statusCode: 400, headers: cors(), body: JSON.stringify({ error: "unknown action" }) };
    }

    return { statusCode: 405, headers: cors(), body: JSON.stringify({ error: "Method Not Allowed" }) };
  } catch (e) {
    return { statusCode: 500, headers: cors(), body: JSON.stringify({ error: e.message }) };
  }
};
