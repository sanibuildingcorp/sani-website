// netlify/functions/handyman-done.js
//
// THE DONE CARD. Contractor only (x-sbc-key).
// Money and follow-up for a finished handyman job, kept in blobs
// "handyman-done" keyed by ref (no database column needed).
//
// GET  ?ref=SBC-H-...                          -> { state }
// POST { ref, action:"deposit", on:true|false }  -> deposit received / not
// POST { ref, action:"paid",    on:true|false }  -> balance paid / not
// POST { ref, action:"invoice", total, deposit, lines[], note } -> emails the invoice
// POST { ref, action:"review",  text }          -> emails the Google review ask
//
// state = { depositPaid, depositAt, paid, paidAt, invoices:[{at,total,deposit,balance}], reviewAt, reviewBy }

"use strict";

const { requireDashboardKey } = require("./lib/require-dashboard-key");
const { sendResend, esc } = require("./lib/send-email");
const ADDR = require("./lib/addresses");

const H = { "Content-Type": "application/json", "Cache-Control": "no-store", "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "Content-Type, x-sbc-key" };
const out = (code, body) => ({ statusCode: code, headers: H, body: JSON.stringify(body) });
const REVIEW_URL = "https://g.page/r/CXtX_n13XF6aEBE/review";
const ZELLE = "sanibuildingcorp@gmail.com";

function store() {
  const { getStore } = require("@netlify/blobs");
  return getStore({ name: "handyman-done", siteID: process.env.MY_SITE_ID, token: process.env.MY_BLOBS_TOKEN });
}
async function supa(path) {
  const url = process.env.SUPABASE_URL, key = process.env.SUPABASE_SECRET_KEY;
  const r = await fetch(url + path, { headers: { apikey: key, Authorization: "Bearer " + key } });
  if (!r.ok) throw new Error("Supabase " + r.status);
  return r.json();
}
const money = (n) => "$" + Math.round(Number(n) || 0).toLocaleString("en-US");
const first = (n) => String(n || "").trim().split(/\s+/)[0] || "there";

/* The numbers on the invoice: total, deposit taken off only when it was received. */
function invoiceNumbers(total, deposit, depositPaid) {
  const t = Math.max(0, Math.round(Number(total) || 0));
  const d = depositPaid ? Math.min(t, Math.max(0, Math.round(Number(deposit) || 0))) : 0;
  return { total: t, deposit: d, balance: t - d };
}

function invoiceEmail(bk, n, lines, note) {
  const name = first(bk.customer_name);
  const list = (lines || []).map((x) => String(x).trim()).filter(Boolean).slice(0, 20);
  const text = "Hi " + name + ",\n\nThank you for choosing Sani Building Corp. Here is your invoice for the work we finished at " + (bk.customer_address || "your place") + ".\n\n" +
    (list.length ? "Work done:\n" + list.map((x) => "- " + x).join("\n") + "\n\n" : "") +
    "Total: " + money(n.total) + "\n" + (n.deposit ? "Deposit received: -" + money(n.deposit) + "\n" : "") + "Balance due: " + money(n.balance) + "\n\n" +
    "Pay with Zelle to " + ZELLE + " (memo: " + bk.ref + ").\n" + (note ? "\n" + note + "\n" : "") +
    "\nQuestions? Call or text us at (332) 277-0990.\n\nSani Building Corp";
  const row = (k, v, b) => '<tr><td style="padding:8px 0;color:#555">' + esc(k) + '</td><td style="padding:8px 0;text-align:right;' + (b ? "font-weight:800;font-size:18px;color:#14213d" : "") + '">' + esc(v) + "</td></tr>";
  const html = '<div style="font-family:-apple-system,Segoe UI,Arial,sans-serif;font-size:15px;line-height:1.6;color:#222;max-width:560px">' +
    '<div style="font-weight:800;letter-spacing:.08em;color:#14213d">SANI BUILDING CORP</div>' +
    '<div style="color:#8a6a1c;font-size:13px;margin-bottom:16px">Invoice · ' + esc(bk.ref) + "</div>" +
    "<p>Hi " + esc(name) + ",</p><p>Thank you for choosing Sani Building Corp. Here is your invoice for the work we finished at " + esc(bk.customer_address || "your place") + ".</p>" +
    (list.length ? '<p style="margin-bottom:4px"><b>Work done</b></p><ul style="margin-top:0">' + list.map((x) => "<li>" + esc(x) + "</li>").join("") + "</ul>" : "") +
    '<table style="width:100%;border-collapse:collapse;border-top:1px solid #eee;border-bottom:1px solid #eee;margin:14px 0">' +
    row("Total", money(n.total)) + (n.deposit ? row("Deposit received", "-" + money(n.deposit)) : "") + row("Balance due", money(n.balance), true) + "</table>" +
    "<p>Pay with Zelle to <b>" + esc(ZELLE) + "</b> (memo: " + esc(bk.ref) + ").</p>" +
    (note ? "<p>" + esc(note).replace(/\n/g, "<br>") + "</p>" : "") +
    '<p>Questions? Call or text us at <a href="tel:+13322770990">(332) 277-0990</a>.</p><p>Sani Building Corp</p></div>';
  return { text, html };
}

function reviewText(bk) {
  return "Hi " + first(bk.customer_name) + ", thank you for having us. If you're happy with the work, a short Google review would mean a lot to our small team: " + REVIEW_URL + "\n\nSani Building Corp";
}

exports.handler = async function (event) {
  if (event.httpMethod === "OPTIONS") return { statusCode: 200, headers: H, body: "" };
  const denied = requireDashboardKey(event);
  if (denied) return denied;
  try {
    const q = event.queryStringParameters || {};
    const b = event.httpMethod === "POST" ? JSON.parse(event.body || "{}") : {};
    const ref = String(q.ref || b.ref || "");
    if (!/^SBC-H-[A-Z0-9-]+$/i.test(ref)) return out(400, { error: "bad ref" });
    const st = store();
    const state = (await st.get(ref, { type: "json" }).catch(() => null)) || { invoices: [] };
    if (event.httpMethod === "GET") return out(200, { state, reviewText: null, reviewUrl: REVIEW_URL });
    if (event.httpMethod !== "POST") return out(405, { error: "GET or POST" });

    const now = new Date().toISOString();
    if (b.action === "deposit") { state.depositPaid = !!b.on; state.depositAt = b.on ? now : ""; }
    else if (b.action === "paid") { state.paid = !!b.on; state.paidAt = b.on ? now : ""; }
    else if (b.action === "invoice" || b.action === "review") {
      const rows = await supa("/rest/v1/bookings?ref=eq." + encodeURIComponent(ref));
      const bk = Array.isArray(rows) && rows[0];
      if (!bk) return out(404, { error: "Booking not found" });
      if (!bk.customer_email) return out(400, { error: "No customer email on this booking" });
      if (b.action === "invoice") {
        const n = invoiceNumbers(b.total, b.deposit, state.depositPaid);
        if (!n.total) return out(400, { error: "No price to invoice" });
        const m = invoiceEmail(bk, n, b.lines, String(b.note || "").slice(0, 600));
        await sendResend({ from: ADDR.FROM_SYSTEM, to: [bk.customer_email], reply_to: ADDR.replyTo(), bcc: [ADDR.alertsTo()],
          subject: "Your invoice · Sani Building Corp · " + ref, text: m.text, html: m.html });
        (state.invoices = state.invoices || []).push({ at: now, total: n.total, deposit: n.deposit, balance: n.balance });
      } else {
        const text = String(b.text || reviewText(bk)).replace(/\blicen[cs]ed?\b/gi, "fully insured").slice(0, 1500);
        await sendResend({ from: ADDR.FROM_SYSTEM, to: [bk.customer_email], reply_to: ADDR.replyTo(),
          subject: "How did we do? · Sani Building Corp", text,
          html: '<div style="font-family:-apple-system,Segoe UI,Arial,sans-serif;font-size:15px;line-height:1.6;color:#222;max-width:560px">' + esc(text).replace(/\n/g, "<br>").replace(esc(REVIEW_URL), '<a href="' + REVIEW_URL + '">Leave a Google review</a>') + "</div>" });
        state.reviewAt = now; state.reviewBy = "email";
      }
    } else if (b.action === "review-texted") { state.reviewAt = now; state.reviewBy = "text"; }
    else return out(400, { error: "Unknown action" });
    await st.setJSON(ref, state);
    return out(200, { ok: true, state });
  } catch (e) {
    return out(500, { error: String(e && e.message || e) });
  }
};

exports._test = { invoiceNumbers, invoiceEmail, reviewText, REVIEW_URL };
