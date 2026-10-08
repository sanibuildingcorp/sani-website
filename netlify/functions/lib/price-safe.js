// netlify/functions/lib/price-safe.js
//
// WHAT A CUSTOMER'S BROWSER MAY DOWNLOAD.
//   "hide the hours and rates from customer estimate data"
// The quote page never printed hours, rates or profit, but get-estimate sent the
// raw price lines (qty x rate, markupPct, totals.cost / totals.profit) and anyone
// could read them with the browser's developer tools. Every response that goes
// without the dashboard key now passes through here:
//   - each labor / material line becomes ONE customer amount: qty 1, rate = its
//     share of the customer price (markup baked in), markupPct 0. The page's
//     totals, service subtotals, cost breakdown and finish cards come out the
//     same, to the cent (the rounding cent goes on the biggest line).
//   - the timeline is computed here from the real hours (e.schedule) and the
//     page uses it as is (e.pricesBaked).
//   - book ids, factors, "why" notes, totals.cost / profit, merge history and the
//     AI's private reading are removed.
"use strict";
const { scheduleOf } = require("./schedule");

const KEEP = ["section", "item", "spec", "finish", "finishStatus", "link", "photo", "store", "custSupplied", "supplyKey"];
const r2 = (x) => Math.round((Number(x) || 0) * 100) / 100;
const A = (v) => (Array.isArray(v) ? v : []);
const LT = (l) => (Number(l && l.qty) || 0) * (Number(l && l.rate) || 0);

function slim(l, amount) {
  const o = {};
  KEEP.forEach((k) => { if (l && l[k] !== undefined) o[k] = l[k]; });
  o.qty = 1; o.rate = amount;
  return o;
}

function priceSafe(e) {
  if (!e || typeof e !== "object" || e.pricesBaked) return e;
  /* timeline from the real hours, before the hours go */
  let sch = null;
  try { if (A(e.labor).some((l) => Number(l && l.rate) > 0) || (e.scheduleEdit && e.scheduleEdit.workDays != null)) sch = scheduleOf(e); } catch (_) { sch = null; }
  if (sch && sch.workDays) e.schedule = sch;
  const k = 1 + (Number(e.markupPct) || 0) / 100;
  const raw = A(e.labor).concat(A(e.materials)).reduce((s, l) => s + LT(l), 0);
  const lines = [];
  ["labor", "materials"].forEach((key) => {
    if (!Array.isArray(e[key])) return;
    e[key] = A(e[key]).map((l) => { const s = slim(l, r2(LT(l) * k)); lines.push(s); return s; });
  });
  /* the page's grand total is r2((L+M) * k): the slimmed lines sum to exactly that */
  const diff = r2(r2(raw * k) - lines.reduce((s, l) => s + l.rate, 0));
  if (diff && lines.length) { const big = lines.reduce((a, b) => (b.rate > a.rate ? b : a)); big.rate = r2(big.rate + diff); }
  if (e.markupPct !== undefined) e.markupPct = 0;
  A(e.parkedLines).forEach((p) => { if (p && p.line) { const o = {}; ["item", "spec", "unit", "finish", "finishStatus", "link", "photo", "store", "section"].forEach((x) => { if (p.line[x] !== undefined) o[x] = p.line[x]; }); p.line = o; } });
  if (e.totals && typeof e.totals === "object") e.totals = { total: e.totals.total };
  ["markupRecommendation", "mergeHistory", "lastMerge", "v5Reading", "pricingReadiness", "warnings", "ownerNotes", "sitePhotos", "savedMaterials", "notes", "projectAnalysis", "validation", "internalScopeChecklist", "repairReport", "deterministicPricing", "estimateHealth"].forEach((x) => { delete e[x]; });
  e.pricesBaked = true;
  return e;
}

module.exports = { priceSafe };
