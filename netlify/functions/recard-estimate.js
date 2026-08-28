// netlify/functions/recard-estimate.js
//
// REPAIR THE CARDS ON ONE STORED ESTIMATE. CONTRACTOR ONLY.
//
// POST { ref }                header  x-sbc-key: <DASHBOARD_KEY>   -> dry run
// POST { ref, apply: true }   header  x-sbc-key: <DASHBOARD_KEY>   -> writes
//
// An engine fix only helps estimates generated after it. This re-files the cards
// on an estimate generated BEFORE it, using the lines already on the record - no
// AI call, no new prices, no new lines - and lib/recard.js refuses outright if
// the customer-facing total would move by a cent.
//
// DRY RUN IS THE DEFAULT, AND DELIBERATELY SO.
// The estimates most in need of repair are the ones already in a customer's
// hands. Nothing is written unless the caller says `apply: true` in as many
// words, so the normal way to use this is to look first and decide second.
//
// THIS IS A WRITE ENDPOINT ON A CUSTOMER-FACING RECORD, so it is gated the way
// thread-reply.js is gated - on DASHBOARD_KEY, refusing when the key is unset
// rather than falling open. get-estimate stays public on purpose (every quote
// link ever sent depends on it); this is not that, and must never be that.

"use strict";

const { getStore } = require("@netlify/blobs");
const { recardEstimate } = require("./lib/recard");

exports.handler = async function (event) {
  if (event.httpMethod === "OPTIONS") return { statusCode: 200, headers: cors(), body: "" };
  if (event.httpMethod !== "POST") return json(405, { error: "Method Not Allowed" });

  const secret = process.env.DASHBOARD_KEY;
  if (!secret) return json(500, { error: "DASHBOARD_KEY is not set in Netlify. Set it, then redeploy." });
  const given = event.headers["x-sbc-key"] || event.headers["X-Sbc-Key"] || "";
  if (given !== secret) return json(401, { error: "Bad or missing dashboard key" });

  let body;
  try { body = JSON.parse(event.body || "{}"); } catch (_) { return json(400, { error: "Bad JSON" }); }

  const ref = String(body.ref || "").trim();
  if (!ref) return json(400, { error: "Missing ref" });
  const apply = body.apply === true;

  const store = getStore({ name: "estimates", siteID: process.env.MY_SITE_ID, token: process.env.MY_BLOBS_TOKEN });
  const record = await store.get(ref, { type: "json" });
  if (!record) return json(404, { error: "Estimate " + ref + " not found" });

  const result = recardEstimate(record);

  const payload = {
    ref: ref,
    ok: result.ok,
    applied: false,
    dryRun: !apply,
    changed: result.changed,
    reason: result.reason,
    customerTotalBefore: result.before,
    customerTotalAfter: result.after,
    delta: result.delta,
    cardsBefore: result.cardsBefore,
    cardsAfter: result.cardsAfter,
  };

  if (!result.ok) return json(409, payload);
  if (!apply || !result.changed) return json(200, payload);

  /* Only serviceBreakdown and the presentation fields the pass rewrote are
     carried over. Everything else on the record - status, deposit, contract,
     thread, the contractor's own choices - is left exactly as it was. */
  record.estimate = result.estimate;
  record.updatedAt = new Date().toISOString();
  record.cardsRepairedAt = record.updatedAt;
  await store.setJSON(ref, record);

  payload.applied = true;
  return json(200, payload);
};

function cors() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type, x-sbc-key",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Content-Type": "application/json",
    "Cache-Control": "no-store",
  };
}
function json(code, obj) {
  return { statusCode: code, headers: cors(), body: JSON.stringify(obj) };
}
