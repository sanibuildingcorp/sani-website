// netlify/functions/follow-ups-background.js — the follow-up emails, sent.
//
// Reads every estimate, and for each one lib/follow-up.js says is due, sends
// the short reminder (day 2, 5 or 10 after the send), threaded with the quote
// in the customer's inbox, and writes it on the record (followUps + one
// History line). Started once a day by follow-ups-scheduled. Contractor-only
// (x-sbc-key). { dryRun: true } lists what would go out and sends nothing.

"use strict";

const { getStore } = require("@netlify/blobs");
const { requireDashboardKey } = require("./lib/require-dashboard-key");
const { sendResend } = require("./lib/send-email");
const ADDR = require("./lib/addresses");
const followUp = require("./lib/follow-up");
const history = require("./lib/history");
const { threadHeaders } = require("./lib/message-email");

const MAX_PER_RUN = 25;

function str(v) { return String(v == null ? "" : v).trim(); }
function cors() {
  return { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "Content-Type, x-sbc-key", "Access-Control-Allow-Methods": "POST, OPTIONS", "Content-Type": "application/json", "Cache-Control": "no-store" };
}
function json(code, obj) { return { statusCode: code, headers: cors(), body: JSON.stringify(obj) }; }

exports.handler = async function (event) {
  if (event.httpMethod === "OPTIONS") return { statusCode: 200, headers: cors(), body: "" };
  if (event.httpMethod !== "POST") return json(405, { error: "Method Not Allowed" });
  const denied = requireDashboardKey(event, cors());
  if (denied) return denied;
  let body = {};
  try { body = JSON.parse(event.body || "{}"); } catch (e) { body = {}; }
  const dryRun = body.dryRun === true;
  const out = { checked: 0, sent: [], errors: [] };
  try {
    const store = getStore({ name: "estimates", siteID: process.env.MY_SITE_ID, token: process.env.MY_BLOBS_TOKEN });
    const { blobs } = await store.list();
    const siteUrl = process.env.SITE_URL || "https://www.sanibuildingcorp.com";
    for (const b of blobs || []) {
      if (out.sent.length >= MAX_PER_RUN) break;
      if (!/^SBC-/i.test(b.key)) continue;
      let record;
      try { record = await store.get(b.key, { type: "json" }); } catch (e) { continue; }
      if (!record) continue;
      out.checked++;
      const step = followUp.due(record, Date.now());
      if (!step) continue;
      const ref = str(record.ref) || b.key;
      if (dryRun) { out.sent.push(ref + " #" + step); continue; }
      const quoteUrl = siteUrl + "/quote.html?ref=" + encodeURIComponent(ref);
      const m = followUp.message(record, step, quoteUrl);
      try {
        await sendResend({ from: ADDR.FROM_ZURABI, to: [str(record.customer.email)], reply_to: ADDR.replyTo(), subject: m.subject, html: require("./lib/trust-footer").inject(m.html), text: m.text, headers: threadHeaders(ref) });
        /* Read again just before writing: the customer may have answered while
           this run was sending, and nothing of theirs is overwritten. */
        const fresh = (await store.get(b.key, { type: "json" })) || record;
        fresh.followUps = (Array.isArray(fresh.followUps) ? fresh.followUps : []).concat([{ step: step, at: new Date().toISOString(), basis: str(fresh.sentAt) }]);
        history.note(fresh, "followup", "Follow-up email " + step + " of " + followUp.DAYS.length + " sent to the customer (" + followUp.DAYS[step - 1] + " days after the estimate)");
        await store.setJSON(b.key, fresh);
        out.sent.push(ref + " #" + step);
      } catch (e) {
        out.errors.push(ref + ": " + str(e && e.message).slice(0, 160));
      }
    }
  } catch (e) {
    out.errors.push(str(e && e.message).slice(0, 200));
  }
  console.log("follow-ups", JSON.stringify(out));
  return json(200, out);
};
