// netlify/functions/lib/scope-only.js
//
// THE SCOPE OF WORK, WITH EVERY PRICE TAKEN OUT.
//
//   "sometimes the building management need to see scope of work before they
//    approve permission, customers doesn't need to show them prices and i need
//    it for send just scope of work absolutely same everything just without
//    prices"
//
// quote.html?ref=…&sow=1 is the customer's own quote page with the money gone.
// The dashboard has offered that link for a long time; the page ignored the
// flag and showed the full priced quote. This is the server half: the record
// that reaches the page carries no number a building manager could read as a
// price, so the page cannot leak one by accident, and no private matter either
// - the conversation with the customer, the contract, their acceptance.
//
// Keys are matched by NAME, recursively, not by a list of places: a new priced
// field added somewhere tomorrow is stripped the day it appears. Dollar amounts
// typed into wording ("allowance $500 for fixtures") are scrubbed too.

"use strict";

/* Any key that holds money, or a money switch. `rate` is matched whole so a
   key like "rationale" is left alone. */
const MONEY_KEY = /price|cost|total|subtotal|markup|upgrade|amount|budget|band|margin|^rate$|Rate$/i;

/* Contractor-only material that has no business on a page for a third party. */
const INTERNAL_KEYS = [
  "notes", "projectAnalysis", "validation", "pricingReadiness", "internalScopeChecklist",
  "savedMaterials", "repairReport", "clarificationQuestions",
];

/* Everything about the customer's dealings with the contractor. */
const RECORD_PRIVATE_KEYS = [
  "thread", "threadRate", "contract", "signature", "customerResponse", "acceptedAt", "approvedAt",
  "declinedAt", "declineReason", "customerOptionSelections", "rejectedOptionSelections",
  "customerSelections", "customerMaterialSelections", "sentVersion", "sentVersionInfo",
  "reviewRequestedAt", "questionText", "lastQuestion",
];

const DOLLARS = /\$\s?\d[\d,]*(?:\.\d+)?/g;

function scrubText(s) {
  return String(s).replace(DOLLARS, "").replace(/\(\s*\)/g, "").replace(/[ \t]{2,}/g, " ").replace(/\s+([,.;:])/g, "$1").trim();
}

function strip(v, dropKeys) {
  if (Array.isArray(v)) return v.map(function (x) { return strip(x, dropKeys); });
  if (v && typeof v === "object") {
    const out = {};
    Object.keys(v).forEach(function (k) {
      if (MONEY_KEY.test(k) || dropKeys.indexOf(k) !== -1) return;
      out[k] = strip(v[k], dropKeys);
    });
    return out;
  }
  if (typeof v === "string") return scrubText(v);
  return v;
}

/**
 * The customer view, reduced to scope. Returns a NEW object.
 * @param {object} view  a customer view (already frozen to the sent version)
 */
function scopeOnlyView(view) {
  const src = view && typeof view === "object" ? view : {};
  const out = strip(src, RECORD_PRIVATE_KEYS.concat(INTERNAL_KEYS));
  out.estimate = out.estimate && typeof out.estimate === "object" ? out.estimate : {};
  /* The page must not read these as "priced" or "approved". */
  out.status = "scope";
  out.includeContractForCustomer = false;
  out.thread = [];
  out.scopeOnly = true;
  return out;
}

/* For tests and for anyone auditing: does this object still carry money? */
function findMoney(v, path) {
  const hits = [];
  const p = path || "";
  if (Array.isArray(v)) v.forEach(function (x, i) { hits.push.apply(hits, findMoney(x, p + "[" + i + "]")); });
  else if (v && typeof v === "object") Object.keys(v).forEach(function (k) {
    if (MONEY_KEY.test(k)) hits.push(p + "." + k);
    else hits.push.apply(hits, findMoney(v[k], p + "." + k));
  });
  else if (typeof v === "string" && DOLLARS.test(v)) { DOLLARS.lastIndex = 0; hits.push(p + ' = "' + v.slice(0, 40) + '"'); }
  DOLLARS.lastIndex = 0;
  return hits;
}

module.exports = { scopeOnlyView, findMoney, scrubText, MONEY_KEY };
