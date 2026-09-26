// netlify/functions/lib/contractor-owned-fields.js
//
// THE SETTINGS A HUMAN MADE BY HAND, WHICH A REGENERATION MUST NOT EAT.
//
// The estimator replaces record.estimate wholesale — that is the point of
// regenerating. But an estimate object is not all AI: quote photos, the customer
// view mode, the contract settings, a manually set final total, finish groups,
// parked lines and the merge history were all chosen by the contractor, and the
// AI knows nothing about any of them.
//
// dashboard.html has always known this and restored them after a generation. The
// problem is WHERE it did it: in the browser, in memory, at the end of the poll
// loop. So the protection only existed while a browser was awake and watching.
//
//   Generate → lock the phone → the background function finishes on the server →
//   record.estimate is overwritten with an AI object that has no quotePhotos, no
//   contract, no customerFinalTotal → nothing is left running to put them back.
//
// The contractor comes back to a finished estimate with their photos gone. Ten
// seconds of a locked screen and hand-configured work is deleted.
//
// So the preservation moves to the server, where the overwrite actually happens.
// It now holds whether or not anyone is watching, which is also what makes it
// safe for the dashboard to reconnect to a generation it slept through.
//
// The dashboard keeps its own restore. It is now a no-op that re-applies the
// same values — a second latch on the same door, and the one that still covers
// the older non-background generate-estimate.js path.

"use strict";

const { SHARED_STOCK, sharedKey, tidyCards } = require("./shared-once");

/* MUST STAY IDENTICAL to CONTRACTOR_OWNED_ESTIMATE_FIELDS in dashboard.html.
   contractor-owned-fields.test.js parses that array straight out of the HTML and
   fails if the two lists ever drift, because a field present in one list and
   missing from the other is a field that survives a generation only when the
   browser happens to be awake — the exact bug this file exists to end. */
const CONTRACTOR_OWNED_ESTIMATE_FIELDS = [
  /* The engine writes this on every generation. Without it here, the next Save Draft
     rebuilds the estimate without it and the recommendation disappears. */
  "markupRecommendation",
  // Customer Scope Control
  "manualCustomerScopeDraft", "publishedCustomerScope", "customerScopePublished",
  "customerViewPublishedVersion",
  // Customer View Mode choices
  "showLaborCost", "showMaterialsCost", "showSectionSubtotals",
  "showLaborLines", "showMaterialLines",
  "showLaborLinePrices", "showMaterialLinePrices",
  // Manually set money + hand-built extras
  "customerFinalTotal", "finishGroups", "contract",
  "quotePhotos", "hiddenQuotePhotos", "savedMaterials", "materialsTotalEstimate",
  // Price lines parked by "Not included" - the money waiting to come back
  "parkedLines",
  // Snapshot that makes the last service merge reversible
  "lastMerge", "mergeHistory",
  // Which alternatives he checked to show the customer (none until he does)
  "offeredOptions"
];

/**
 * Carry the contractor's hand-made settings from the estimate being replaced
 * onto the one replacing it.
 *
 * Deliberately identical in behaviour to the dashboard's own restore, down to
 * the "only keys that actually exist" rule: a brand-new estimate has no previous
 * settings, so it keeps every default the estimator chose. Where a field exists
 * on both, the CONTRACTOR'S value wins — they set it on purpose, the AI did not
 * know it existed.
 *
 * @param {object|null} previous  record.estimate as it was before this run
 * @param {object} next           the estimate this run produced (mutated and returned)
 * @returns {object} next
 */
function preserveContractorFields(previous, next) {
  if (!next || typeof next !== "object") return next;
  if (!previous || typeof previous !== "object") return next;
  CONTRACTOR_OWNED_ESTIMATE_FIELDS.forEach(function (k) {
    if (previous[k] !== undefined && previous[k] !== null) next[k] = previous[k];
  });
  return next;
}

/* Which of them were actually carried across — for the dashboard to say so out
   loud rather than leaving the contractor to notice their photos are still there. */
function preservedFieldNames(previous) {
  if (!previous || typeof previous !== "object") return [];
  return CONTRACTOR_OWNED_ESTIMATE_FIELDS.filter(function (k) {
    return previous[k] !== undefined && previous[k] !== null;
  });
}

/* ══ REGENERATE MEANS NEW WORDING. ══════════════════════════════════════════
     A regenerated Astoria estimate came back with new prices, a new summary
     and a new timeline - and the same stock lines on every card, because the
     Services draft saved from the FIRST generation was carried over as a
     contractor setting and the customer's page reads the draft.
   A draft (and its published copy) that only mirrors the AI's own cards is
   the AI's wording, not his: on a regenerate it is dropped and rebuilt from
   the new cards. A draft he actually edited - a line changed, added or
   removed, a service renamed, a price he typed on a card - is his, and it
   is kept (the panel says so and offers Rebuild draft from AI). */
const SCOPE_FIELDS = ["manualCustomerScopeDraft", "publishedCustomerScope", "customerScopePublished"];
function norm(v) { return String(v == null ? "" : v).replace(/\s+/g, " ").trim().toLowerCase(); }
function texts(a) { return (Array.isArray(a) ? a : []).map(function (x) { return norm(typeof x === "string" ? x : (x && (x.text || x.item))); }).filter(Boolean); }
function sameList(a, b) { const x = texts(a), y = texts(b); return x.length === y.length && x.every(function (t, i) { return t === y[i]; }); }
function scopeMirrorsAi(est) {
  const e = est || {};
  /* Compared the way both are shown - each point once (lib/shared-once.js) -
     so a draft the page tidied still counts as the AI's wording. */
  const cards = tidyCards(e.projectIncluded, JSON.parse(JSON.stringify(Array.isArray(e.serviceBreakdown) ? e.serviceBreakdown : [])), { sup: "customerSupplies", exc: "notIncluded" });
  const byName = {};
  cards.forEach(function (c) { byName[norm(c && (c.title || c.name || c.section))] = c; });
  /* Shared work said once (lib/shared-once.js) is taken off the cards when
     they are shown, so a draft missing only those lines still mirrors. */
  const sharedKeys = SHARED_STOCK.concat(Array.isArray(e.projectIncluded) ? e.projectIncluded : []).map(function (x) { return sharedKey(typeof x === "string" ? x : (x && (x.text || x.item))); });
  const unshared = function (list) { return (Array.isArray(list) ? list : []).filter(function (x) { return sharedKeys.indexOf(sharedKey(typeof x === "string" ? x : (x && (x.text || x.item)))) === -1; }); };
  const one = function (scope) {
    if (!scope || !Array.isArray(scope.services)) return true;
    const svcs = tidyCards(e.projectIncluded, JSON.parse(JSON.stringify(scope.services)), { sup: "supplied", exc: "excluded" });
    return svcs.every(function (s) {
      if (!s || s.pinned === true) return false;
      const c = byName[norm(s.name || s.title)];
      if (!c) return !texts(s.included).length && !texts(s.supplied || s.customerSupplies).length && !texts(s.excluded || s.notIncluded).length;
      return sameList(unshared(s.included), unshared(c.included)) && sameList(s.supplied || s.customerSupplies, c.customerSupplies || c.customerSupplied) && sameList(s.excluded || s.notIncluded, c.notIncluded || c.exclusions);
    });
  };
  return one(e.manualCustomerScopeDraft) && one(e.publishedCustomerScope);
}
/* The previous estimate as the generator should carry it: without the scope
   fields when they only mirror the AI. { previous, reset, kept } */
function forRegenerate(previous) {
  if (!previous || typeof previous !== "object") return { previous: previous, reset: false, kept: false };
  const has = SCOPE_FIELDS.some(function (k) { return previous[k] !== undefined && previous[k] !== null && previous[k] !== false; });
  if (!has) return { previous: previous, reset: false, kept: false };
  if (!scopeMirrorsAi(previous)) return { previous: previous, reset: false, kept: true };
  const copy = Object.assign({}, previous);
  SCOPE_FIELDS.forEach(function (k) { delete copy[k]; });
  return { previous: copy, reset: true, kept: false };
}

module.exports = {
  CONTRACTOR_OWNED_ESTIMATE_FIELDS,
  preserveContractorFields,
  preservedFieldNames,
  scopeMirrorsAi,
  forRegenerate,
  SCOPE_FIELDS,
};
