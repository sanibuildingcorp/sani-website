// netlify/functions/crew.js
//
// THE CREW STEP. The owner sends a signed booking to one of his workers; the
// worker opens a private link (crew.html?t=...) with everything to do the job
// right, and NO prices.
//
// CONTRACTOR (x-sbc-key):
//   GET  ?roster=1                         -> { roster: [{id,name,phone}] }
//   POST { roster: [...] }                 -> saves his crew list
//   GET  ?ref=SBC-H-...                    -> { job } the current crew job for that booking
//   POST { action:"assign", ref, crewId, sharePhone, appointmentDate?, appointmentTime? }
//                                          -> { job, url, text }
// WORKER (token, no key):
//   GET  ?t=TOKEN                          -> { sheet, progress }
//   POST { t, action:"step", i, done }     -> ticks a step
//   POST { t, action:"photo", kind:"before"|"after", data:"data:image/jpeg;base64,..." }
//   POST { t, action:"done", note }        -> booking -> completed, owner gets an email

"use strict";

const crypto = require("crypto");
const { getStore } = require("@netlify/blobs");
const { requireDashboardKey } = require("./lib/require-dashboard-key");
const crewJob = require("./lib/crew-job");
const ADDR = require("./lib/addresses");

const H = { "Content-Type": "application/json", "Cache-Control": "no-store", "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "Content-Type, x-sbc-key" };
const out = (code, body) => ({ statusCode: code, headers: H, body: JSON.stringify(body) });
const s = (v, n) => String(v == null ? "" : v).trim().slice(0, n || 300);
const now = () => new Date().toISOString();
const opts = (name) => ({ name, siteID: process.env.MY_SITE_ID, token: process.env.MY_BLOBS_TOKEN });
const crewStore = () => getStore(opts("crew"));
const brainStore = () => getStore(opts("handyman-brain"));
const SITE = () => process.env.URL || "https://www.sanibuildingcorp.com";

async function supa(method, path, body) {
  const url = process.env.SUPABASE_URL, key = process.env.SUPABASE_SECRET_KEY;
  const r = await fetch(url + path, { method, headers: { apikey: key, Authorization: "Bearer " + key, "Content-Type": "application/json", Prefer: "return=representation" }, body: body ? JSON.stringify(body) : undefined });
  const j = await r.json().catch(() => null);
  if (!r.ok) throw new Error("Supabase " + r.status);
  return j;
}
async function booking(ref) {
  const rows = await supa("GET", "/rest/v1/bookings?ref=eq." + encodeURIComponent(ref));
  const b = Array.isArray(rows) && rows[0];
  if (!b) return null;
  try { b.agreements = await supa("GET", "/rest/v1/agreements?booking_ref=eq." + encodeURIComponent(ref) + "&order=created_at.desc"); } catch (_) { b.agreements = []; }
  return b;
}
async function planOf(ref) { const v = await brainStore().get(ref, { type: "json" }).catch(() => null); return (v && v.plan) || null; }

exports.handler = async function (event) {
  if (event.httpMethod === "OPTIONS") return { statusCode: 200, headers: H, body: "" };
  try {
    const q = event.queryStringParameters || {};
    let b = {};
    if (event.httpMethod === "POST") { try { b = JSON.parse(event.body || "{}"); } catch (_) {} }
    const token = s(q.t || b.t, 80);
    const st = crewStore();

    /* ── WORKER: by private link only ── */
    if (token) {
      if (!/^[a-f0-9]{32}$/.test(token)) return out(404, { error: "Link not found" });
      const job = await st.get("job:" + token, { type: "json" }).catch(() => null);
      if (!job) return out(404, { error: "This job link is not active any more. Call the office." });
      if (event.httpMethod === "GET") {
        const bk = await booking(job.ref);
        const sheet = crewJob.sheet(bk, await planOf(job.ref), job);
        return out(200, { sheet, progress: { steps: job.steps || {}, photos: job.photos || [], doneAt: job.doneAt || "" } });
      }
      if (job.doneAt && (b.action === "step" || b.action === "photo")) return out(409, { error: "This job is closed. Call the office to change anything." });
      if (b.action === "step") {
        job.steps = job.steps || {}; job.steps[String(Number(b.i) || 0)] = !!b.done;
      } else if (b.action === "photo") {
        const data = s(b.data, 3000000);
        if (!/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(data)) return out(400, { error: "Not a photo" });
        job.photos = (job.photos || []).slice(-19);
        const id = crypto.randomBytes(8).toString("hex");
        await st.set("photo:" + id, data);
        job.photos.push({ id, kind: b.kind === "before" ? "before" : "after", at: now() });
      } else if (b.action === "done") {
        job.doneAt = now(); job.doneNote = s(b.note, 1000);
        try { await supa("PATCH", "/rest/v1/bookings?ref=eq." + encodeURIComponent(job.ref), { status: "completed", completed_at: job.doneAt }); } catch (e) { console.error("crew done: status", e.message); }
        try {
          const { sendResend, esc } = require("./lib/send-email");
          await sendResend({ from: ADDR.FROM_SYSTEM, to: [ADDR.alertsTo ? ADDR.alertsTo() : ADDR.ALERTS_DEFAULT], subject: "Job done: " + job.ref + " (" + (job.crewName || "crew") + ")",
            html: "<p><b>" + esc(job.crewName || "Your crew") + "</b> marked job <b>" + esc(job.ref) + "</b> as done.</p>" + (job.doneNote ? "<p>Note: " + esc(job.doneNote) + "</p>" : "") + "<p>" + (job.photos || []).length + " photo(s) on the job page. Open the booking in your dashboard to check.</p>" });
        } catch (e) { console.error("crew done: email", e.message); }
      } else return out(400, { error: "Unknown action" });
      await st.setJSON("job:" + token, job);
      return out(200, { ok: true, progress: { steps: job.steps || {}, photos: job.photos || [], doneAt: job.doneAt || "" } });
    }

    /* Photo bytes for the worker page and the dashboard: by id, public but unguessable. */
    if (q.photo && /^[a-f0-9]{16}$/.test(q.photo)) {
      const data = await st.get("photo:" + q.photo).catch(() => null);
      if (!data) return { statusCode: 404, body: "" };
      const m = /^data:(image\/\w+);base64,(.*)$/.exec(data);
      return { statusCode: 200, headers: { "Content-Type": m[1], "Cache-Control": "private, max-age=86400" }, body: m[2], isBase64Encoded: true };
    }

    /* ── CONTRACTOR ── */
    const denied = requireDashboardKey(event);
    if (denied) return denied;
    const roster = (await st.get("roster", { type: "json" }).catch(() => null)) || [];

    if (event.httpMethod === "GET" && q.roster) return out(200, { roster });
    if (event.httpMethod === "GET" && q.ref) {
      const tok = await st.get("ref:" + s(q.ref, 40)).catch(() => null);
      const job = tok ? await st.get("job:" + tok, { type: "json" }).catch(() => null) : null;
      return out(200, { job: job ? Object.assign({}, job, { url: SITE() + "/crew.html?t=" + tok }) : null });
    }
    if (event.httpMethod === "POST" && Array.isArray(b.roster)) {
      const clean = b.roster.map((w) => ({ id: s(w && w.id, 20) || crypto.randomBytes(4).toString("hex"), name: s(w && w.name, 60), phone: s(w && w.phone, 30) })).filter((w) => w.name).slice(0, 30);
      await st.setJSON("roster", clean);
      return out(200, { roster: clean });
    }
    if (event.httpMethod === "POST" && b.action === "assign") {
      const ref = s(b.ref, 40);
      const w = roster.find((x) => x.id === s(b.crewId, 20));
      if (!/^SBC-H-[A-Z0-9-]+$/i.test(ref) || !w) return out(400, { error: "Pick a worker" });
      const bk = await booking(ref);
      if (!bk) return out(404, { error: "Booking not found" });
      /* One live link per booking: re-sending replaces the old one. */
      const old = await st.get("ref:" + ref).catch(() => null);
      if (old) await st.delete("job:" + old).catch(() => {});
      const tok = crypto.randomBytes(16).toString("hex");
      const job = { ref, crewId: w.id, crewName: w.name, crewPhone: w.phone, sharePhone: !!b.sharePhone, appointmentDate: s(b.appointmentDate, 20), appointmentTime: s(b.appointmentTime, 40), createdAt: now(), steps: {}, photos: [] };
      await st.setJSON("job:" + tok, job);
      await st.set("ref:" + ref, tok);
      try { if (String(bk.status || "new") === "new" || bk.status === "confirmed") await supa("PATCH", "/rest/v1/bookings?ref=eq." + encodeURIComponent(ref), { status: "in-progress" }); } catch (_) {}
      const url = SITE() + "/crew.html?t=" + tok;
      const sheet = crewJob.sheet(bk, await planOf(ref), job);
      return out(200, { job: Object.assign({}, job, { url }), url, text: crewJob.message(sheet, url), needsCrewSteps: !((await planOf(ref)) || {}).crew || !(((await planOf(ref)) || {}).crew.steps || []).length });
    }
    return out(400, { error: "Unknown request" });
  } catch (e) {
    return out(500, { error: String(e && e.message || e) });
  }
};
