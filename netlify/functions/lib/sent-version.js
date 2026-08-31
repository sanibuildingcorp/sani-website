// netlify/functions/lib/sent-version.js
//
// WHAT THE CUSTOMER SEES STOPS MOVING THE MOMENT IT IS SENT.
//
//   "whatever i will do any taste updates in my dashboard i don't have to worry
//    in them side will not change anything till i sent them update estimate"
//
// The quote link renders LIVE from the record. Every edit in the dashboard —
// a rate tried out, a line half-typed, a total being experimented with, an AI
// regeneration mid-flight — appeared on the customer's page the instant it was
// saved, with no send and no warning.
//
// That is not a theoretical risk. On SBC-260821 a price was changed while the
// customer already held the link, and the whole afternoon went into working out
// which of several numbers they were actually looking at.
//
// ── THE SEAM ────────────────────────────────────────────────────────────────
// Not everything freezes, and picking the wrong line here would break the quote:
//
//   FROZEN — everything the CONTRACTOR writes: the labor and material lines, the
//   prices, the totals, the scope wording, the options offered, the contract.
//   These change only when he deliberately sends an update.
//
//   LIVE — everything the CUSTOMER does: their messages in the thread, the
//   options they tick, their acceptance and signature, whether they have opened
//   it. Freezing those would mean their own actions vanished from their own page.
//
// So a version is a snapshot of the contractor's side only, and the customer's
// side is always read from the record as it stands now.

"use strict";

/* Bumped when the SHAPE changes in a way older snapshots cannot satisfy. Stored
   on every version so a future reader can tell what it is looking at. */
const SNAPSHOT_VERSION = 1;

/* The contractor-authored fields the customer's page renders from. Anything not
   in here is either the customer's own (thread, selections, acceptance) or is
   internal and never reaches them. */
function snapshotEstimate(estimate) {
  return estimate && typeof estimate === "object" ? JSON.parse(JSON.stringify(estimate)) : {};
}

/**
 * Freeze what is about to be sent.
 *
 * @param {object} record  the stored record, as it is at the moment of sending
 * @param {number} n       which send this is (1 for the first)
 * @returns {object} the version to store on record.sentVersion
 */
function buildSentVersion(record, n) {
  const rec = record || {};
  return {
    snapshotVersion: SNAPSHOT_VERSION,
    n: Number(n) || 1,
    at: new Date().toISOString(),
    /* The whole contractor-authored estimate, copied. Deliberately a deep copy
       and not a reference: the live record goes on being edited immediately
       afterwards, and a reference would track those edits — which is the exact
       bug this file exists to prevent. */
    estimate: snapshotEstimate(rec.estimate),
    /* The price the customer was quoted. Kept beside the estimate because it
       overrides the line items everywhere, so a version without it would quote
       a different number than the one that was sent. */
    customerFinalTotal: rec.customerFinalTotal != null ? rec.customerFinalTotal : null,
    /* Whether a contract was part of this send, and the contract itself. */
    includeContractForCustomer: rec.includeContractForCustomer === true,
    contract: rec.contract && typeof rec.contract === "object" ? JSON.parse(JSON.stringify(rec.contract)) : null,
    projectAddress: rec.projectAddress || "",
    customer: rec.customer ? JSON.parse(JSON.stringify(rec.customer)) : {},
  };
}

/**
 * Serve the frozen contractor content, keeping everything the customer owns live.
 *
 * @param {object} record   the stored record
 * @param {object} view     the customer view being built from it (mutated)
 * @returns {object} view
 */
function applySentVersion(record, view) {
  const rec = record || {};
  const v = rec.sentVersion;
  if (!v || typeof v !== "object" || !v.estimate) return view;

  /* THE CONTRACTOR'S SIDE, AS SENT. */
  view.estimate = JSON.parse(JSON.stringify(v.estimate));
  if (v.customerFinalTotal != null) view.customerFinalTotal = v.customerFinalTotal;
  view.includeContractForCustomer = v.includeContractForCustomer === true;
  if (v.contract) view.contract = JSON.parse(JSON.stringify(v.contract));

  /* THE CUSTOMER'S SIDE, AS IT IS NOW. Their own messages, their own choices and
     their own signature must never be rolled back to a snapshot — a customer who
     ticked an option and then watched it disappear would rightly stop trusting
     the page. These are read from the live record on purpose.
     record.customerFinalTotal is the exception that proves the rule: when the
     CUSTOMER accepts or adds a paid option it is stamped live, and that stamp is
     theirs, so it wins over the version's copy. */
  if (rec.customerFinalTotal != null && rec.acceptedAt) view.customerFinalTotal = rec.customerFinalTotal;

  /* So the page can say which version this is. */
  view.sentVersionInfo = { n: v.n, at: v.at };
  return view;
}

/* Has the contractor edited anything since the customer's copy was sent?
   Compared on the contractor-authored content only — a customer replying in the
   thread is not the contractor changing the quote. */
function hasUnsentChanges(record) {
  const rec = record || {};
  const v = rec.sentVersion;
  if (!v || !v.estimate) return false;
  const now = JSON.stringify(snapshotEstimate(rec.estimate));
  const then = JSON.stringify(v.estimate);
  if (now !== then) return true;
  const nowTotal = rec.customerFinalTotal != null ? rec.customerFinalTotal : null;
  const thenTotal = v.customerFinalTotal != null ? v.customerFinalTotal : null;
  return nowTotal !== thenTotal;
}

module.exports = {
  SNAPSHOT_VERSION,
  buildSentVersion,
  applySentVersion,
  hasUnsentChanges,
};
