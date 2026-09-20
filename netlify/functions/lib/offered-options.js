// netlify/functions/lib/offered-options.js
//
// WHICH ALTERNATIVES THE CUSTOMER IS ALLOWED TO SEE.
//
//   "In this optional i need add check box for including or not including for
//    send to the customer, always keeps uncheck and if i decide then i will
//    check by my self"
//
// The estimator writes priced alternatives — "Option A — Crown molding
// premium, $1,350" — and every one of them went straight onto the customer's
// quote. The contractor now decides, one checkbox per alternative, which ones
// the customer gets to see. Nothing is offered until he checks it.
//
// The decision is stored on the estimate as `offeredOptions`: the normalized
// labels of the alternatives he checked. It travels with the estimate, so it is
// frozen into the sent version like every other contractor decision, and the
// customer keeps seeing what was sent until he sends an update.
//
//   undefined  -> he has never decided on this estimate.
//                 In a draft preview that means: show none (default unchecked).
//                 On a version frozen BEFORE this existed it means: show all,
//                 because that is what the customer was actually sent.
//   []         -> he decided: none.
//   ["..."]    -> he decided: these.

"use strict";

function norm(s) {
  return String(s == null ? "" : s).toLowerCase().replace(/\s+/g, " ").trim();
}

function labelOf(o) {
  return norm(o && (o.label || o.name));
}

/* null when he has never decided, a Set of normalized labels otherwise. */
function offeredSet(estimate) {
  const est = estimate || {};
  if (!Array.isArray(est.offeredOptions)) return null;
  const s = new Set();
  est.offeredOptions.forEach(function (l) { const k = norm(l); if (k) s.add(k); });
  return s;
}

function isOffered(estimate, label) {
  const s = offeredSet(estimate);
  return !!s && s.has(norm(label));
}

/* Check or uncheck one alternative. Returns the estimate. */
function setOffered(estimate, label, on) {
  const est = estimate;
  const k = norm(label);
  const cur = offeredSet(est) || new Set();
  if (on) cur.add(k); else cur.delete(k);
  est.offeredOptions = Array.from(cur);
  return est;
}

/* Every array on the estimate that quote.html reads alternatives from. */
function eachOptionList(est, fn) {
  if (Array.isArray(est.options)) est.options = fn(est.options);
  (Array.isArray(est.serviceBreakdown) ? est.serviceBreakdown : []).forEach(function (s) {
    if (s && Array.isArray(s.options)) s.options = fn(s.options);
  });
  Object.keys(est.optionSelections || {}).forEach(function (k) {
    const sel = est.optionSelections[k];
    if (sel && Array.isArray(sel.alternatives)) sel.alternatives = fn(sel.alternatives);
  });
  ((est.publishedCustomerScope && est.publishedCustomerScope.services) || []).forEach(function (sv) {
    if (sv && Array.isArray(sv.options)) sv.options = fn(sv.options);
  });
}

/**
 * Strip every alternative the contractor has not checked, in place.
 *
 * @param {object} estimate            the customer's copy (mutated)
 * @param {object} [opts]
 * @param {boolean} [opts.legacyAllowsAll]  an undecided estimate keeps everything
 *        (a version frozen before this existed). Off for draft previews.
 * @param {string[]} [opts.keep]       labels the customer already chose - those
 *        stay whatever the checkbox says, because they are on the customer's bill.
 * @returns {object} the estimate, with offeredOptions materialized as the labels kept
 */
function stripUnoffered(estimate, opts) {
  const est = estimate;
  if (!est || typeof est !== "object") return est;
  const o = opts || {};
  const keep = new Set((Array.isArray(o.keep) ? o.keep : []).map(norm).filter(Boolean));
  /* ALTERNATIVES ARE NO LONGER OFFERED, ON ANY RECORD. "I need to completely
     remove alternative offers, i never use them and remove from everywhere."
     Nothing is ever offered: not what a checkbox once allowed, not "all of
     them" on a record sent before the checkbox existed (legacyAllowsAll is
     accepted and ignored). Only an option the customer ALREADY ADDED to their
     bill (keep) survives, because its price is in the total they approved.
     The "alternative (not included in current total)" notes the old
     estimator printed beside an option go with it. */
  const set = new Set();
  const NOTE_RE = /\balternative \(not included in current total\)\s*$/i;
  const dropNotes = function (card) {
    if (!card) return;
    if (Array.isArray(card.notIncluded)) card.notIncluded = card.notIncluded.filter(function (t) { return !NOTE_RE.test(String(t || "")); });
    if (Array.isArray(card.excluded)) card.excluded = card.excluded.filter(function (t) { return !NOTE_RE.test(String(t || "")); });
  };
  (Array.isArray(est.serviceBreakdown) ? est.serviceBreakdown : []).forEach(dropNotes);
  ((est.publishedCustomerScope && est.publishedCustomerScope.services) || []).forEach(dropNotes);

  const allowed = function (x) { const k = labelOf(x); return !!k && (set.has(k) || keep.has(k)); };
  eachOptionList(est, function (list) { return list.filter(allowed); });
  est.offeredOptions = Array.from(new Set(Array.from(set).concat(Array.from(keep))));
  return est;
}

module.exports = { norm, offeredSet, isOffered, setOffered, stripUnoffered };
