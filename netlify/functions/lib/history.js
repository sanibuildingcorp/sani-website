// netlify/functions/lib/history.js
//
// WHAT HAPPENED TO THIS ESTIMATE, IN ORDER.
//
//   "let him check old history too for analyze situation and knows what's
//    was change and whats need to change"
//
// A record kept no memory of itself: the latest sent version, the latest
// total, the latest wording - and nothing about how it got there. So the
// assistant could see the estimate but not its story: when it was sent and
// at what price, what the customer did, what was regenerated, reworded,
// added, removed, re-stamped. Every place that writes a record now leaves
// one line here: record.history, oldest first, capped. The assistant reads
// it on every question; the dashboard header can show it later.
//
//   note(record, kind, text, extra)   append one line (mutates record)
//   lines(record, n)                  the last n lines as text for a prompt
//   customerTotal(record)             the number the customer would see now
//
// Kinds: sent, accepted, review, question, declined, regenerated, added,
// removed, reworded, saved, total, customer, services.

"use strict";

const customerTotals = require("./customer-total");

const MAX = 80;

function str(v) { return String(v == null ? "" : v).trim(); }
function arr(v) { return Array.isArray(v) ? v : []; }
function money(n) { const x = Number(n); return Number.isFinite(x) ? "$" + x.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : ""; }

function customerTotal(record) {
  try { return customerTotals((record && record.estimate) || {}, record || {}).customerTotal; } catch (e) { return null; }
}

function note(record, kind, text, extra) {
  if (!record || typeof record !== "object") return null;
  const k = str(kind) || "note", t = str(text);
  if (!t) return null;
  const line = Object.assign({ at: new Date().toISOString(), kind: k, text: t.slice(0, 400) }, extra && typeof extra === "object" ? extra : {});
  record.history = arr(record.history).concat([line]).slice(-MAX);
  return line;
}

/* For the assistant: oldest first, the last n, one per line. */
function lines(record, n) {
  const h = arr(record && record.history).filter(function (x) { return x && x.text; });
  return h.slice(-(n || 25)).map(function (x) { return "  " + str(x.at).slice(0, 16).replace("T", " ") + " | " + str(x.kind) + " | " + str(x.text); });
}

/* "total $A -> $B" or just "total $B" when nothing to compare. */
function totalMove(from, to) {
  const a = from == null || from === "" ? NaN : Number(from), b = to == null || to === "" ? NaN : Number(to);
  if (Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) >= 0.005) return "total " + money(a) + " -> " + money(b);
  if (Number.isFinite(b)) return "total " + money(b);
  return "";
}

module.exports = { note, lines, customerTotal, totalMove, money, MAX };
