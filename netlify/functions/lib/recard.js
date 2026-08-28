// netlify/functions/lib/recard.js
//
// RE-FILE A STORED ESTIMATE'S CARDS. NEVER RE-PRICE IT.
//
// An engine fix is prospective. A record priced before the fix keeps whatever
// serviceBreakdown it was given, forever, and the customer keeps seeing it -
// which is how a phantom "Painting" card stayed on a live, approved,
// deposit-paid quote long after the code that created it was gone.
//
// The obvious remedy - "just regenerate it" - is the wrong one, and it is
// dangerous on exactly the jobs that need it most. Regenerating calls the AI
// again and replaces record.estimate wholesale: labor, materials, wording,
// serviceBreakdown and the TOTAL. On a quote the customer has already approved
// and paid a deposit against, that can change the number they agreed to.
//
// This does the narrow thing instead. It takes the lines that are already on the
// record, re-runs ONLY the card attribution through the current engine, and then
// refuses to return a result at all if the customer-facing total moved by so
// much as a cent. No AI call. No new prices. No new lines.
//
// THE GUARD IS THE POINT. If a repair cannot be made without moving the money,
// the correct outcome is to leave the record alone and say so.

"use strict";

const { consolidateCustomerPresentation } = require("./deterministic-pricing");
const customerTotals = require("./customer-total");

/* A cent. Everything downstream rounds to cents, so anything at or under this is
   representation, not money. */
const EPSILON = 0.005;

function clone(v) {
  return v == null ? v : JSON.parse(JSON.stringify(v));
}

function cardNames(estimate) {
  return ((estimate && estimate.serviceBreakdown) || [])
    .map(r => String((r && (r.title || r.name || r.section)) || "").trim())
    .filter(Boolean);
}

/* consolidateCustomerPresentation wants the estimator's `input` shape. It reads
   only request.description / request.service / request.selectedServices and the
   customer block, all of which the stored record already has - so it is rebuilt
   here rather than re-derived by anything that could call out to a model. */
function inputFromRecord(record) {
  const r = (record && record.request) || {};
  return {
    ref: (record && record.ref) || "",
    customer: clone((record && record.customer) || {}),
    request: {
      service: r.service || "",
      selectedServices: Array.isArray(r.selectedServices) ? r.selectedServices.slice() : [],
      description: r.description || "",
      propertyType: r.propertyType || "",
      sqft: r.sqft || "",
      customerSupplies: Array.isArray(r.customerSupplies) ? r.customerSupplies.slice() : [],
    },
  };
}

/**
 * Re-file the cards on one stored record.
 *
 * Pure: `record` is never mutated. The caller decides whether to persist
 * `result.estimate`, and should only do so when `result.ok` is true.
 *
 * @param {object} record  the estimate record as stored in Blobs
 * @returns {{
 *   ok:boolean, changed:boolean, reason:string,
 *   before:number, after:number, delta:number,
 *   cardsBefore:string[], cardsAfter:string[],
 *   estimate:(object|null)
 * }}
 */
function recardEstimate(record) {
  const out = {
    ok: false, changed: false, reason: "",
    before: 0, after: 0, delta: 0,
    cardsBefore: [], cardsAfter: [], estimate: null,
  };

  const estimate = record && record.estimate;
  if (!estimate) { out.reason = "This record has no estimate on it."; return out; }

  const hasLines = (Array.isArray(estimate.labor) && estimate.labor.length) ||
                   (Array.isArray(estimate.materials) && estimate.materials.length);
  if (!hasLines) {
    /* Without lines there is nothing to attribute, and the stored subtotals are
       the only record of the money. Re-running would produce empty cards and
       silently drop the lot. */
    out.reason = "This estimate has no labor or materials lines, so its cards cannot be re-derived without losing the totals.";
    return out;
  }

  out.cardsBefore = cardNames(estimate);
  const before = customerTotals(estimate, record);
  out.before = before.customerTotal;

  const working = clone(estimate);
  let next;
  try {
    next = consolidateCustomerPresentation(working, clone(record.projectAnalysis) || {}, inputFromRecord(record));
  } catch (e) {
    out.reason = "The engine could not re-file this estimate: " + String((e && e.message) || e).slice(0, 200);
    return out;
  }

  const after = customerTotals(next, record);
  out.after = after.customerTotal;
  out.delta = Math.round((out.after - out.before) * 100) / 100;
  out.cardsAfter = cardNames(next);

  /* ══ THE REFUSAL. ══════════════════════════════════════════════════════════
     A card repair that moves the customer's total is not a card repair. If this
     ever fires, something upstream changed the arithmetic and the record must be
     looked at by a human, not rewritten by this function. */
  if (Math.abs(out.after - out.before) > EPSILON) {
    out.reason = "Refused: re-filing would move the customer's total from $" +
      out.before.toFixed(2) + " to $" + out.after.toFixed(2) +
      ". The record has not been changed.";
    return out;
  }

  /* Lines are the source of the money. If the pass touched one, refuse too. */
  const lineSig = e => JSON.stringify([...(e.labor || []), ...(e.materials || [])]
    .map(l => [l && l.item, Number(l && l.qty) || 0, Number(l && l.rate) || 0]));
  if (lineSig(estimate) !== lineSig(next)) {
    out.reason = "Refused: re-filing altered the priced lines. The record has not been changed.";
    return out;
  }

  out.ok = true;
  out.changed = JSON.stringify(out.cardsBefore) !== JSON.stringify(out.cardsAfter) ||
                JSON.stringify((estimate.serviceBreakdown || []).map(r => Number(r.subtotal) || 0)) !==
                JSON.stringify((next.serviceBreakdown || []).map(r => Number(r.subtotal) || 0));
  out.reason = out.changed
    ? "Cards re-filed. The customer's total is unchanged at $" + out.after.toFixed(2) + "."
    : "Nothing to change — the cards are already correct.";
  out.estimate = next;
  return out;
}

module.exports = { recardEstimate, inputFromRecord, EPSILON };
