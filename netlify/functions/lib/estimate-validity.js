// netlify/functions/lib/estimate-validity.js
//
// AN ESTIMATE IS VALID FOR THIRTY DAYS.
//
//   "The estimate i need to shows ... 30 days expiration"
//   "Yes block approval after expiration and let them re-request updated
//    estimate"
//
// Issued the day it was sent (the frozen sent version's date, else sentAt).
// Thirty days later it expires: the customer can no longer approve it or
// sign its contract, and asks for an updated estimate instead. Sending the
// estimate again issues it again, so a fresh send is thirty fresh days. An
// estimate already approved never expires. A record never sent has no
// issue date and is never expired here.
//
// quote.html carries the same rule for the page; this is the one the
// server enforces.

"use strict";

const VALID_DAYS = 30;
const DAY_MS = 86400000;

function issuedAt(record) {
  const r = record || {};
  const v = r.sentVersion && typeof r.sentVersion === "object" ? r.sentVersion.at : "";
  const t = Date.parse(v || r.sentAt || "");
  return Number.isFinite(t) ? new Date(t) : null;
}

function validUntil(record) {
  const d = issuedAt(record);
  return d ? new Date(d.getTime() + VALID_DAYS * DAY_MS) : null;
}

function isApproved(record) {
  const r = record || {};
  return !!r.acceptedAt || /^(accepted|invoiced|paid|completed)$/i.test(String(r.status || "")) || !!(r.contract && r.contract.signed);
}

function isExpired(record, now) {
  if (isApproved(record)) return false;
  const until = validUntil(record);
  return !!until && (now == null ? Date.now() : Number(now)) > until.getTime();
}

function expiredMessage(record) {
  const until = validUntil(record);
  const day = until ? until.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "America/New_York" }) : "";
  return "This estimate expired" + (day ? " on " + day : "") + ". Please ask us for an updated estimate - we will send you a new one.";
}

module.exports = { VALID_DAYS, issuedAt, validUntil, isExpired, isApproved, expiredMessage };
