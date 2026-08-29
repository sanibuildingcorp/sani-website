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
  "quotePhotos", "savedMaterials", "materialsTotalEstimate",
  // Price lines parked by "Not included" - the money waiting to come back
  "parkedLines",
  // Snapshot that makes the last service merge reversible
  "lastMerge", "mergeHistory"
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

module.exports = {
  CONTRACTOR_OWNED_ESTIMATE_FIELDS,
  preserveContractorFields,
  preservedFieldNames,
};
