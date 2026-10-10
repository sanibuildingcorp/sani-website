// netlify/functions/handyman-decline.js
//
// "NOT FOR US". Contractor only (x-sbc-key).
// POST { ref, text }  -> emails the customer the text he read and edited
//                        (skipped when text is empty), then closes the job
//                        (status = cancelled). Reply-to is contact@.

"use strict";

const { requireDashboardKey } = require("./lib/require-dashboard-key");
const { sendResend, esc } = require("./lib/send-email");
const ADDR = require("./lib/addresses");

const H = { "Content-Type": "application/json", "Cache-Control": "no-store", "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "Content-Type, x-sbc-key" };
const out = (code, body) => ({ statusCode: code, headers: H, body: JSON.stringify(body) });

async function supa(method, path, body) {
  const url = process.env.SUPABASE_URL, key = process.env.SUPABASE_SECRET_KEY;
  const r = await fetch(url + path, { method, headers: { apikey: key, Authorization: "Bearer " + key, "Content-Type": "application/json", Prefer: "return=representation" }, body: body ? JSON.stringify(body) : undefined });
  if (!r.ok) throw new Error("Supabase " + r.status);
  return r.json().catch(() => null);
}

exports.handler = async function (event) {
  if (event.httpMethod === "OPTIONS") return { statusCode: 200, headers: H, body: "" };
  const denied = requireDashboardKey(event);
  if (denied) return denied;
  if (event.httpMethod !== "POST") return out(405, { error: "POST only" });
  try {
    const b = JSON.parse(event.body || "{}");
    const ref = String(b.ref || "");
    if (!/^SBC-H-[A-Z0-9-]+$/i.test(ref)) return out(400, { error: "bad ref" });
    const rows = await supa("GET", "/rest/v1/bookings?ref=eq." + encodeURIComponent(ref));
    const bk = Array.isArray(rows) && rows[0];
    if (!bk) return out(404, { error: "Booking not found" });
    const text = String(b.text || "").replace(/\blicen[cs]ed?\b/gi, "fully insured").trim().slice(0, 4000);
    let emailed = false;
    if (text && bk.customer_email) {
      await sendResend({
        from: ADDR.FROM_SYSTEM, to: [bk.customer_email], reply_to: ADDR.replyTo(), bcc: [ADDR.alertsTo()],
        subject: "About your request · Sani Building Corp",
        text,
        html: '<div style="font-family:-apple-system,Segoe UI,Arial,sans-serif;font-size:15px;line-height:1.6;color:#222;max-width:560px">' + esc(text).replace(/\n/g, "<br>") + "</div>",
      });
      emailed = true;
    }
    const note = "[" + new Date().toISOString().slice(0, 10) + "] Not for us" + (emailed ? " (customer emailed)" : "");
    await supa("PATCH", "/rest/v1/bookings?ref=eq." + encodeURIComponent(ref), { status: "cancelled", contractor_notes: [bk.contractor_notes, note].filter(Boolean).join("\n") });
    return out(200, { ok: true, emailed });
  } catch (e) {
    return out(500, { error: String(e && e.message || e) });
  }
};
