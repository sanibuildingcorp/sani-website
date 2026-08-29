// netlify/functions/lib/contract-total.js
//
// THE CONTRACT MUST STATE THE PRICE THE CUSTOMER IS ACTUALLY BEING CHARGED.
//
//   "I updated price in this project, customer requested and now i try update
//    contract too but it's still regenerate with old price"
//
// He is right about how it is supposed to work: the contract IS built from the
// scope of work and the estimate total. What it is not, is kept up to date.
//
// generate-contract-background reads the live customer total, writes it onto
// record.contract.total, and derives a payment schedule from it. That is correct
// on the day it runs. Then the price changes — the customer asks for more work,
// a line is corrected, an option is added — and NOTHING revisits the contract.
// It keeps the old total and the old payment rows, silently, and the only way to
// find out is to read it.
//
// On the live job that produced this file the estimate said $20,000.03 and the
// contract still said $10,000.01, split 4000 / 4000 / 2000.01. A customer would
// have signed for half the job.
//
// ── WHY NOT JUST REGENERATE IT ───────────────────────────────────────────────
// Because regenerating throws away every word the contractor edited by hand, and
// costs an AI call and a minute of waiting, to fix a NUMBER. The scope wording
// was already right. So the drift is detected here, and fixing it re-scales the
// money and leaves the prose alone.
//
// ── THE LINE THAT MUST NOT BE CROSSED ────────────────────────────────────────
// A SIGNED contract is a record of what somebody agreed to. It is never rescaled,
// never regenerated, never quietly corrected. If the price changed after signing,
// that is a new agreement and a human decision — this file only ever reports it.

"use strict";

const customerTotals = require("./customer-total");

function round2(n) { return Math.round((Number(n) || 0) * 100) / 100; }

/**
 * Has the estimate moved away from what the contract says?
 *
 * @param {object} record  the stored record
 * @returns {{
 *   hasContract:boolean, signed:boolean,
 *   contractTotal:number, estimateTotal:number,
 *   delta:number, drifted:boolean
 * }}
 */
function contractDrift(record) {
  const rec = record || {};
  const ct = rec.contract && typeof rec.contract === "object" ? rec.contract : null;
  const hasContract = !!(ct && ct.sections);
  const signed = !!(ct && ct.signed);

  const contractTotal = ct ? round2(ct.total) : 0;

  let estimateTotal = 0;
  try {
    estimateTotal = round2(customerTotals(rec.estimate || {}, rec).customerTotal);
  } catch (e) { estimateTotal = 0; }

  const delta = round2(estimateTotal - contractTotal);

  return {
    hasContract: hasContract,
    signed: signed,
    contractTotal: contractTotal,
    estimateTotal: estimateTotal,
    delta: delta,
    /* A dollar of tolerance, matching the schedule check the save already used:
       rounding across a markup and three payment rows lands a cent or two out and
       that is not a discrepancy anybody needs to be told about.
       A signed contract is never "drifted" — it is simply what was agreed. */
    drifted: hasContract && !signed && estimateTotal > 0 && Math.abs(delta) > 1,
  };
}

/* The split generate-contract-background uses when it has to build one itself.
   Kept identical on purpose: a rescaled schedule and a regenerated one should
   not disagree about how this contractor bills a job. */
function defaultSchedule(total) {
  const t = round2(total);
  if (t < 1000) return [{ label: "Payment in full — due upon completion", amount: t }];
  if (t <= 5000) {
    const half = round2(t * 0.5);
    return [
      { label: "Deposit — due upon signing", amount: half },
      { label: "Final payment — due upon completion", amount: round2(t - half) },
    ];
  }
  const a = round2(t * 0.4), b = round2(t * 0.4);
  return [
    { label: "Deposit — due upon signing", amount: a },
    { label: "Mid-project payment", amount: b },
    { label: "Final payment — due upon completion", amount: round2(t - a - b) },
  ];
}

/**
 * Move a payment schedule to a new total, keeping each row's share of the job
 * and every label the contractor wrote.
 *
 * The rows are what a customer plans their money around — "40% now, 40% at the
 * midpoint" — so the shape is preserved and only the amounts move. The rounding
 * remainder lands on the LAST row, so the schedule sums to the total exactly
 * rather than being a cent out on the signature page.
 */
function rescaleSchedule(schedule, newTotal) {
  const t = round2(newTotal);
  const rows = Array.isArray(schedule) ? schedule.filter(Boolean) : [];
  if (!rows.length || !(t > 0)) return defaultSchedule(t);

  const sum = rows.reduce(function (s, p) { return s + (Number(p.amount) || 0); }, 0);
  /* A schedule that sums to nothing has no shares to preserve — there is no
     honest way to scale zero into a price, so fall back to the standard split. */
  if (!(sum > 0)) return defaultSchedule(t);

  const f = t / sum;
  const out = rows.map(function (p) {
    return { label: String(p.label || "Payment"), amount: round2((Number(p.amount) || 0) * f) };
  });
  const got = out.reduce(function (s, p) { return s + p.amount; }, 0);
  out[out.length - 1].amount = round2(out[out.length - 1].amount + (t - got));
  return out;
}

/**
 * The contract, with its money brought up to date and its words untouched.
 * Returns null when there is nothing to do or nothing that may be done.
 */
function retotalContract(record) {
  const d = contractDrift(record);
  if (!d.hasContract || d.signed || !d.drifted) return null;

  const ct = record.contract;
  const next = Object.assign({}, ct, {
    total: d.estimateTotal,
    sections: Object.assign({}, ct.sections, {
      paymentSchedule: rescaleSchedule((ct.sections || {}).paymentSchedule, d.estimateTotal),
    }),
    /* Stamped so the panel can say when the money was last brought in line, and
       so this is distinguishable from a full regeneration. */
    retotaledAt: new Date().toISOString(),
    retotaledFrom: d.contractTotal,
  });
  return next;
}

module.exports = {
  contractDrift,
  rescaleSchedule,
  defaultSchedule,
  retotalContract,
};
