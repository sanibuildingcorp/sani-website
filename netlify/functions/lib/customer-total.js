// netlify/functions/lib/customer-total.js
//
// THE CUSTOMER-FACING TOTAL. ONE DEFINITION.
//
// Before this file existed the same arithmetic was written out eight times -
// send-quote, quote-response, list-estimates, track-quote-open,
// generate-contract-background, deterministic-pricing, dashboard.html and
// quote.html - and under the old rule ("the customer always pays the grand
// total") seven of them happened to agree, so nothing ever surfaced.
//
// The rule is now: THE CUSTOMER PAYS WHAT THE CONTRACTOR CHOSE TO SHOW.
//
//     show labor only      -> the customer is quoted the labor total
//     show materials only  -> the materials total
//     show both            -> the grand total
//     show neither         -> the grand total
//
// Under that rule one job has three possible prices, and every consumer has to
// be told which one applies. The ones that were never told produced a contract
// for $47,117.50 against a quote the customer approved at $24,835.00.
//
// So: this is the only place that decides. Import it. Do not re-derive it.
//
// MARKUP IS NEVER A CUSTOMER-FACING NUMBER. It is baked into laborAmount,
// materialsAmount and customerTotal. `markup`, `markupPct`, `subtotal` and
// `grandTotal` are INTERNAL - they exist for the contractor's own totals box and
// must never reach an email, a quote page or a contract, on their own or as a
// figure another displayed number can be divided by.
//
// One exported function. Everything a caller needs is on its return value.

"use strict";

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function round2(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

function sumLines(lines) {
  return (Array.isArray(lines) ? lines : []).reduce(function (s, i) {
    return s + num(i && i.qty) * num(i && i.rate);
  }, 0);
}

/**
 * @param {object} estimate  record.estimate
 * @param {object} [record]  the whole record - only needed for customerFinalTotal
 * @returns {{
 *   labor:number, materials:number, subtotal:number,
 *   markupPct:number, markup:number, grandTotal:number,
 *   showLabor:boolean, showMaterials:boolean, bothHidden:boolean,
 *   laborAmount:number, materialsAmount:number,
 *   computedCustomerTotal:number, stampedTotal:(number|null),
 *   customerTotal:number, k:number
 * }}
 */
function customerTotals(estimate, record) {
  const est = estimate || {};

  const labor = sumLines(est.labor);
  const materials = sumLines(est.materials);
  const subtotal = labor + materials;
  const markupPct = num(est.markupPct);
  const k = 1 + markupPct / 100;
  const markup = subtotal * (markupPct / 100);
  const grandTotal = round2(subtotal + markup);

  /* Which buckets is the customer being shown? The booleans win when either one
     is set. displayMode is the older field and is still honoured so records
     written before the checkboxes existed keep rendering the same way. The final
     fallback is labor-only, which is what normalizeDisplayFlags() in
     dashboard.html also picks - the two must not disagree. */
  let showLabor, showMaterials;
  if (typeof est.showLaborCost === "boolean" || typeof est.showMaterialsCost === "boolean") {
    showLabor = est.showLaborCost !== false;
    showMaterials = est.showMaterialsCost === true;
  } else if (est.displayMode === "total") {
    showLabor = false;
    showMaterials = false;
  } else if (est.displayMode === "full") {
    showLabor = true;
    showMaterials = true;
  } else {
    showLabor = true;
    showMaterials = false;
  }
  const bothHidden = !showLabor && !showMaterials;

  /* Marked up. These are the only two figures that may appear as breakdown rows,
     and when both are shown they sum exactly to customerTotal. */
  const laborAmount = round2(labor * k);
  const materialsAmount = round2(materials * k);

  /* Hiding both means the customer sees one number and no breakdown - and that
     number is the whole job, not nothing. */
  const computedCustomerTotal = bothHidden
    ? grandTotal
    : round2((showLabor ? labor * k : 0) + (showMaterials ? materials * k : 0));

  /* record.customerFinalTotal is stamped when the customer accepts or signs. It
     arrives from the customer's own browser through quote-response, which is a
     public endpoint, so it is validated HERE rather than trusted at each of the
     four places that read it. A zero, a negative or an unparseable value is not a
     price; fall back to the lines. (The write side still needs its own guard -
     see quote-response.js - this only stops a bad stamp from being quoted.) */
  let stampedTotal = null;
  if (record && record.customerFinalTotal != null) {
    const n = Number(record.customerFinalTotal);
    if (Number.isFinite(n) && n > 0) stampedTotal = round2(n);
  }

  const customerTotal = stampedTotal != null ? stampedTotal : computedCustomerTotal;

  return {
    // internal - contractor only, never displayed to a customer
    labor: labor,
    materials: materials,
    subtotal: subtotal,
    markupPct: markupPct,
    markup: markup,
    grandTotal: grandTotal,
    k: k,
    // what the contractor chose to show
    showLabor: showLabor,
    showMaterials: showMaterials,
    bothHidden: bothHidden,
    // customer-facing, markup already baked in
    laborAmount: laborAmount,
    materialsAmount: materialsAmount,
    computedCustomerTotal: computedCustomerTotal,
    stampedTotal: stampedTotal,
    customerTotal: customerTotal,
  };
}

/* CommonJS for the Netlify functions; a plain global when this file is ever
   loaded into a page with a <script> tag, so a browser copy never has to exist. */
if (typeof module !== "undefined" && module.exports) {
  module.exports = customerTotals;
  module.exports.customerTotals = customerTotals;
} else if (typeof window !== "undefined") {
  window.sbcCustomerTotals = customerTotals;
}
