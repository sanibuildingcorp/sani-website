// netlify/functions/lib/adopt-option.js
//
// TURN AN OPTION THE CUSTOMER CHOSE INTO PART OF THE ESTIMATE — WITHOUT ASKING
// THE AI ANYTHING.
//
// The problem this exists to solve, in the contractor's own words:
//
//   "if customer sees first generated estimate and they choose optional where
//    was fixed price but i do regenerate and it will then shows totally
//    different prices it will not be true"
//
// He is right, and it is the most serious thing in the estimate system. The
// generator is not deterministic: the same request, regenerated with nothing
// changed, comes back with different numbers. That is tolerable while an
// estimate is a draft nobody has seen. It stops being tolerable the moment a
// customer has looked at a price — and it becomes a broken promise the moment
// they have CHOSEN something at that price.
//
// So Regenerate is the wrong tool for "the customer took Option A". Adopting an
// option is not an estimating decision at all; the price was already decided and
// already shown. It is bookkeeping, and bookkeeping must be exact:
//
//   * the price is the one the customer saw, to the cent
//   * no AI call, so nothing else on the estimate can move
//   * the customer-facing total afterwards must equal the total before plus
//     exactly that price, or the whole adoption is refused
//
// That last rule is the same one recard.js lives by, and for the same reason: a
// change that silently moves a customer's price is worse than a change that
// refuses to happen.

"use strict";

const customerTotals = require("./customer-total");
const { collectOptions, optionLetter } = require("./quote-options");

/* A cent. Below this is float noise; at or above it, something real moved. */
const EPSILON = 0.005;

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}
function round2(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}
/* Line rates carry four decimals, not two. A rate is an input to the total, not
   a number the customer is ever shown, and rounding it to the cent BEFORE it is
   multiplied by the markup is what puts the answer a cent out: 3850 / 1.45 is
   2655.172413…, and 2655.17 × 1.45 is 3849.9965. */
function round4(n) {
  return Math.round((Number(n) || 0) * 10000) / 10000;
}
function norm(s) {
  return String(s == null ? "" : s).toLowerCase().replace(/\s+/g, " ").trim();
}

/* WHICH BUCKET THE MONEY HAS TO GO IN.
   The customer is shown labor only, materials only, or the grand total — see
   customer-total.js. Putting the line in a bucket the customer is not shown
   would add the work to the estimate and add nothing to their price, which is
   the contractor working for free. */
function targetBucket(totals) {
  if (totals.showLabor) return "labor";
  if (totals.showMaterials) return "materials";
  return "labor"; // both hidden: the grand total is shown, so either bucket lands
}

/* The line the option becomes. Priced BEFORE markup, because markupPct is
   applied to it downstream and the customer must end up paying the quoted
   figure, not the quoted figure plus markup. */
function optionLine(option, k) {
  const label = String(option.label || "").trim();
  /* "Option A — NY State Article 32 assessment" reads like a menu on an invoice.
     Strip the menu prefix and keep the work. */
  const item = label.replace(/^\s*option\s+[a-f]\s*[—–:-]\s*/i, "").trim() || label;
  return {
    section: option.section || "General",
    item: item.charAt(0).toUpperCase() + item.slice(1),
    qty: 1,
    unit: "ls",
    rate: round4(option.price / (k || 1)),
    adoptedOptionId: option.id,
  };
}

/**
 * Adopt one option into the estimate at the price the customer was shown.
 *
 * @param {object} record  the whole stored record (mutated on success)
 * @param {string} optionId
 * @returns {{ok:boolean, reason?:string, option?:object, before?:number, after?:number}}
 */
function adoptOption(record, optionId) {
  const rec = record || {};
  const est = rec.estimate || {};

  const wanted = String(optionId || "").trim();
  if (!wanted) return { ok: false, reason: "no option id given" };

  const all = collectOptions(est);
  const option = all.filter(function (o) { return o.id === wanted; })[0];
  if (!option) {
    /* Adopting removes the option from the estimate, so a second attempt cannot
       find it — which is the protection working, not a missing record. Say so,
       because "no option with that id" reads like a bug. */
    const already = (Array.isArray(rec.customerOptionSelections) ? rec.customerOptionSelections : [])
      .some(function (s) { return s && s.id === wanted && s.adoptedAt; });
    return { ok: false, reason: already
      ? "that option is already in the estimate"
      : "this estimate has no option with that id" };
  }
  if (!(option.price > 0)) return { ok: false, reason: "that option has no price to add" };

  const before = num(customerTotals(est, {}).customerTotal);
  if (!(before > 0)) return { ok: false, reason: "this estimate has no total to add to" };

  const totals = customerTotals(est, {});
  const bucket = targetBucket(totals);
  const line = optionLine(option, totals.k);

  /* Already adopted? Adding it twice charges the customer twice. */
  const existing = (Array.isArray(est[bucket]) ? est[bucket] : [])
    .some(function (l) { return l && l.adoptedOptionId === option.id; });
  if (existing) return { ok: false, reason: "that option is already in the estimate" };

  /* ── the mutation ──────────────────────────────────────────────────────── */
  if (!Array.isArray(est[bucket])) est[bucket] = [];
  est[bucket] = est[bucket].concat([line]);

  /* The service card the customer reads. Its subtotal, its scope, and the
     alternatives list it is no longer in. */
  const secKey = norm(option.section);
  (Array.isArray(est.serviceBreakdown) ? est.serviceBreakdown : []).forEach(function (s) {
    const title = norm((s && (s.title || s.service || s.section || s.name)) || "");
    if (secKey && title !== secKey) return;
    if (!secKey && !title) return;
    s.subtotal = round2(num(s.subtotal) + option.price);
    if (!Array.isArray(s.included)) s.included = [];
    s.included = s.included.concat([line.item]);
    if (Array.isArray(s.options)) {
      s.options = s.options.filter(function (o) { return norm(o && o.label) !== norm(option.label); });
    }
    /* A "Not included" line whose only job was to point at this option is now a
       contradiction — the customer bought the thing it says they are not getting. */
    if (Array.isArray(s.notIncluded)) {
      const letter = optionLetter(option.label);
      const lab = norm(option.label);
      s.notIncluded = s.notIncluded.filter(function (x) {
        const t = norm(x);
        if (lab && t.indexOf(lab) !== -1) return false;
        if (letter && new RegExp("\\boption\\s+" + letter.toLowerCase() + "\\b").test(t)) return false;
        return true;
      });
    }
  });

  /* And out of the estimator's own options array, so it is never offered twice. */
  if (Array.isArray(est.options)) {
    est.options = est.options.filter(function (o) { return norm(o && o.label) !== norm(option.label); });
  }

  /* ══ LAND ON THE EXACT CENT, THEN CHECK. ══════════════════════════════════
     `before` is itself a rounded figure, so before + price is not always what
     the lines produce once they are rounded again — at 45% markup the true
     total came to $4,099.2549 while before + price said $4,099.26, and the
     guard below (correctly) refused the whole adoption over one cent.

     Rounding twice is the cause, so the fix is to correct for it rather than to
     loosen the guard: nudge this line's rate by whatever the difference works
     out to and recompute. It converges on the first pass; the loop is there so
     that a pathological display mode cannot spin. The guard still has the final
     word, and still refuses if the number is wrong. */
  const expected = round2(before + option.price);
  const setRate = function (r) {
    line.rate = r;
    est[bucket] = est[bucket].slice(0, -1).concat([line]);
    return num(customerTotals(est, {}).customerTotal);
  };

  /* One coarse step lands within a cent. */
  {
    const drift = expected - num(customerTotals(est, {}).customerTotal);
    if (Math.abs(drift) >= EPSILON) setRate(round4(line.rate + drift / (totals.k || 1)));
  }
  /* Then a fine scan, because the coarse step can straddle the cent it is aiming
     for: at 45% markup on an $1,180 option the two nearest rates produced
     $1,429.25 and $1,429.27, and a nudge-and-repeat loop simply oscillated
     between them forever. The rate grid is 0.0001, which moves the total by far
     less than a cent, so the wanted figure is always ON the grid — it just has
     to be searched for rather than jumped to. Outward from the current rate so
     the smallest correction wins. */
  if (Math.abs(num(customerTotals(est, {}).customerTotal) - expected) >= EPSILON) {
    const start = line.rate;
    let found = false;
    for (let step = 1; step <= 200 && !found; step++) {
      const up = round4(start + step * 0.0001);
      if (Math.abs(setRate(up) - expected) < EPSILON) { found = true; break; }
      const down = round4(start - step * 0.0001);
      if (Math.abs(setRate(down) - expected) < EPSILON) { found = true; break; }
    }
    if (!found) setRate(start);   // put it back and let the guard refuse
  }

  /* ── the check that makes this safe ────────────────────────────────────── */
  const after = num(customerTotals(est, {}).customerTotal);
  if (Math.abs(after - expected) >= EPSILON) {
    return {
      ok: false,
      reason: "refused: the customer's total would have become $" + after.toFixed(2) +
              " instead of $" + expected.toFixed(2),
      before: before,
      after: after,
    };
  }

  /* Mark the selection adopted rather than deleting it. What the customer chose
     and when is a fact about the job, and it stays on the record. */
  if (Array.isArray(rec.customerOptionSelections)) {
    rec.customerOptionSelections.forEach(function (s) {
      if (s && s.id === option.id) s.adoptedAt = new Date().toISOString();
    });
  }
  /* The stamped total the customer approved already included this option, so it
     is now equal to what the lines compute. Left exactly as it was: overwriting
     a figure a customer signed against is never this function's business. */

  rec.estimate = est;
  return { ok: true, option: option, before: before, after: after, bucket: bucket, line: line };
}

module.exports = { adoptOption, EPSILON, targetBucket, optionLine };
